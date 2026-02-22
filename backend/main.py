from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent
# Load project root .env first, then backend/.env so backend overrides work
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env")

from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import stripe

from billing_db import init_billing_db
from billing_ledger import record_topup_credit
from billing_stripe import configure_stripe, webhook_secret
from billing_users import get_stripe_customer_id, set_stripe_customer_id
from ollama_client import get_ollama_client, is_cloud
from task_decomposer import decompose_and_route
from agent_executor import ExecutionEngine
from carbon_tracker import get_carbon_intensity, get_carbon_forecast


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    stream: bool = False


class ChatResponse(BaseModel):
    message: ChatMessage
    done: bool = True


class DecomposeRequest(BaseModel):
    prompt: str
    orchestrator_model: str = "gemma3:12b"


class ExecuteRequest(BaseModel):
    original_prompt: str
    subtasks: list[dict]
    orchestrator_model: str = "gemma3:12b"
    user_id: str = "demo"

class BillingCreateCustomerRequest(BaseModel):
    user_id: str
    email: str | None = None


class BillingCreateSetupIntentRequest(BaseModel):
    user_id: str


class BillingCreateTopupIntentRequest(BaseModel):
    user_id: str
    amount_cents: int
    currency: str = "usd"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm Ollama connection
    try:
        client = get_ollama_client()
        client.list()
    except Exception:
        pass  # Optional: log that Ollama isn't available yet
    try:
        init_billing_db()
    except Exception:
        pass
    # Pre-fetch carbon intensity (caches for the process lifetime)
    try:
        get_carbon_intensity("FR")
    except Exception:
        pass
    yield


app = FastAPI(
    title="HackEurope API",
    description="Python backend with Ollama Cloud (and local) support",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "ollama_cloud": is_cloud()}


@app.get("/api/carbon-intensity")
def carbon_intensity_endpoint(zone: str = "FR"):
    """Return real-time grid carbon intensity for the given zone."""
    intensity = get_carbon_intensity(zone)
    source = "electricity_maps" if __import__("os").environ.get("ELECTRICITY_MAPS_API_KEY") else "fallback"
    return {"intensity": intensity, "zone": zone, "source": source}


@app.get("/api/carbon-forecast")
def carbon_forecast_endpoint(zone: str = "FR"):
    """Return 24 h historical + 8 h forecast carbon intensity for the given zone."""
    return get_carbon_forecast(zone)


@app.get("/api/models")
def list_models():
    """List available Ollama models (cloud or local). Returns empty list + error message if unreachable."""
    source = "cloud" if is_cloud() else "local"
    try:
        client = get_ollama_client()
        resp = client.list()
        # ollama-python returns ListResponse with .models
        model_list = getattr(resp, "models", None) or (resp.get("models", []) if isinstance(resp, dict) else [])
        models = []
        for m in model_list:
            d = m.model_dump() if hasattr(m, "model_dump") else (m if isinstance(m, dict) else {})
            models.append({
                "name": d.get("name") or d.get("model", ""),
                "size": d.get("size"),
                "modified": d.get("modified_at"),
            })
        return {"models": models, "source": source}
    except Exception as e:
        msg = str(e)
        # Log so you see the real error in the server terminal
        import logging
        logging.getLogger("uvicorn.error").warning("Ollama list_models failed: %s", msg)
        return {"models": [], "source": source, "error": msg}


@app.post("/api/decompose")
def decompose(req: DecomposeRequest):
    """Decompose a high-level task into subtasks and route each to the best agent."""
    try:
        result = decompose_and_route(req.prompt, orchestrator_model=req.orchestrator_model)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/execute")
async def execute(req: ExecuteRequest):
    """Execute all subtasks via their assigned agents, streaming progress as SSE."""
    import asyncio
    import json as _json
    from fastapi.responses import StreamingResponse

    intensity = get_carbon_intensity("FR")
    engine = ExecutionEngine(
        original_prompt=req.original_prompt,
        subtasks=req.subtasks,
        orchestrator_model=req.orchestrator_model,
        user_id=req.user_id,
        carbon_intensity=intensity,
        zone="FR",
    )

    async def event_stream():
        # Run the engine as a concurrent background task so we can pull events
        # from the queue at the same time. No run_in_executor needed — engine
        # is fully async and never blocks the event loop.
        runner = asyncio.create_task(engine.run())
        try:
            while True:
                event = await engine.events.get()
                if event is None:
                    break
                yield f"event: {event['event']}\ndata: {_json.dumps(event['data'])}\n\n"
        finally:
            runner.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat", response_model=Optional[ChatResponse])
def chat(req: ChatRequest):
    """Send a chat completion request. Non-streaming only for simplicity."""
    try:
        client = get_ollama_client()
        messages = [{"role": m.role, "content": m.content} for m in req.messages]
        if req.stream:
            # Return streaming via SSE or similar; for now we collect and return
            full_content = []
            for part in client.chat(req.model, messages=messages, stream=True):
                full_content.append(part.get("message", {}).get("content", "") or "")
            return ChatResponse(
                message=ChatMessage(role="assistant", content="".join(full_content)),
                done=True,
            )
        resp = client.chat(req.model, messages=messages, stream=False)
        msg = resp.get("message", {})
        return ChatResponse(
            message=ChatMessage(
                role=msg.get("role", "assistant"),
                content=msg.get("content", ""),
            ),
            done=resp.get("done", True),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/billing/create_customer")
def billing_create_customer(req: BillingCreateCustomerRequest):
    try:
        existing = get_stripe_customer_id(req.user_id)
        if existing:
            return {"customer_id": existing}
        configure_stripe()
        customer = stripe.Customer.create(
            email=req.email,
            metadata={"user_id": req.user_id},
        )
        set_stripe_customer_id(req.user_id, customer["id"])
        return {"customer_id": customer["id"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/billing/create_setup_intent")
def billing_create_setup_intent(req: BillingCreateSetupIntentRequest):
    try:
        existing = get_stripe_customer_id(req.user_id)
        if not existing:
            configure_stripe()
            customer = stripe.Customer.create(metadata={"user_id": req.user_id})
            set_stripe_customer_id(req.user_id, customer["id"])
            existing = customer["id"]
        configure_stripe()
        si = stripe.SetupIntent.create(
            customer=existing,
            payment_method_types=["card"],
            usage="off_session",
            metadata={"user_id": req.user_id},
        )
        return {"customer_id": existing, "setup_intent_id": si["id"], "client_secret": si["client_secret"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/billing/create_topup_intent")
def billing_create_topup_intent(req: BillingCreateTopupIntentRequest):
    if req.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="amount_cents must be > 0")
    currency = (req.currency or "usd").lower()
    if currency != "usd":
        raise HTTPException(status_code=400, detail="Only usd is supported")
    try:
        existing = get_stripe_customer_id(req.user_id)
        if not existing:
            configure_stripe()
            customer = stripe.Customer.create(metadata={"user_id": req.user_id})
            set_stripe_customer_id(req.user_id, customer["id"])
            existing = customer["id"]
        configure_stripe()
        pi = stripe.PaymentIntent.create(
            amount=req.amount_cents,
            currency=currency,
            customer=existing,
            automatic_payment_methods={"enabled": True},
            metadata={"user_id": req.user_id, "purpose": "wallet_topup"},
        )
        return {"payment_intent_id": pi["id"], "client_secret": pi["client_secret"], "customer_id": existing}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None, alias="Stripe-Signature")):
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")
    try:
        payload = await request.body()
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=stripe_signature,
            secret=webhook_secret(),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if event.get("type") == "payment_intent.succeeded":
        obj = event.get("data", {}).get("object", {})
        metadata = obj.get("metadata", {}) or {}
        if metadata.get("purpose") == "wallet_topup":
            user_id = metadata.get("user_id")
            if user_id:
                amount = obj.get("amount")
                currency = (obj.get("currency") or "").lower()
                if currency == "usd" and isinstance(amount, int) and amount > 0:
                    record_topup_credit(
                        user_id=user_id,
                        amount_usd=amount / 100,
                        stripe_payment_intent_id=obj.get("id"),
                    )
    return {"received": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
    uvicorn.run(app, host="0.0.0.0", port=8000)
