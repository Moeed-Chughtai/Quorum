from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent
# Load project root .env first, then backend/.env so backend overrides work
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ollama_client import get_ollama_client, is_cloud
from task_decomposer import decompose_and_route


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm: ensure client can list models (validates connection)
    try:
        client = get_ollama_client()
        client.list()
    except Exception:
        pass  # Optional: log that Ollama isn't available yet
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
