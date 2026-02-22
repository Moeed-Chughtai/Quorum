# HackEurope

Next.js frontend + Python (FastAPI) backend with **Ollama Cloud** (and optional local Ollama) support.

## Quick start

### 1. Backend (Python)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**Ollama Cloud** (recommended): create an [API key](https://ollama.com/settings/keys), then:

```bash
export OLLAMA_API_KEY=your_api_key
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Local Ollama only:** run [Ollama](https://ollama.com) locally (no `OLLAMA_API_KEY`), then start the backend as above. Pull models with e.g. `ollama pull llama3.2`.

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI lists available models and lets you chat.

### 3. Environment

- Copy `.env.example` to `.env` in the repo root (or set vars in the shell).
- Backend: `OLLAMA_API_KEY` for Cloud; omit for local.
- Frontend: `NEXT_PUBLIC_API_URL=http://localhost:8000` if the API is elsewhere.

## API

- `GET /api/health` — backend health and whether Cloud is used.
- `GET /api/models` — list Ollama models (cloud or local).
- `POST /api/chat` — chat completion (body: `{ "model": "...", "messages": [...], "stream": false }`).
- `POST /api/billing/create_customer` — create or fetch a Stripe Customer (body: `{ "user_id": "...", "email": "..." }`).
- `POST /api/billing/create_setup_intent` — create a SetupIntent to save a payment method (body: `{ "user_id": "..." }`).
- `POST /api/billing/create_topup_intent` — create a PaymentIntent for wallet top-ups (body: `{ "user_id": "...", "amount_cents": 500 }`).
- `POST /api/stripe/webhook` — Stripe webhook receiver (signature verified).

## Stripe setup (before launch)

### Backend env vars

Set these in repo root `.env` or `backend/.env` (never commit secrets):

- `STRIPE_SECRET_KEY` (use `sk_test_...` in test mode, `sk_live_...` in live mode)
- `STRIPE_WEBHOOK_SECRET` (the endpoint signing secret, `whsec_...`)

### Create the webhook endpoint in Stripe Dashboard

1. Stripe Dashboard → Developers → Webhooks (or Event destinations in the new UI).
2. Add endpoint (Webhook destination) pointing to:
   - `https://YOUR_BACKEND_DOMAIN/api/stripe/webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

### Local development (webhook forwarding)

Stripe can’t call `localhost` directly. Use the Stripe CLI to forward events:

```bash
./.tools/stripe-cli/stripe listen --forward-to http://localhost:8000/api/stripe/webhook
```

The CLI prints a `whsec_...` secret for local forwarding; set it as `STRIPE_WEBHOOK_SECRET` locally.

### Wallet top-up webhook behavior

Wallet credits happen only for `payment_intent.succeeded` events where the PaymentIntent metadata includes:
- `purpose=wallet_topup`
- `user_id=<your user id>`

This metadata is set automatically when creating top-ups via `POST /api/billing/create_topup_intent`.

## Ollama Cloud models

With `OLLAMA_API_KEY` set, the backend uses `https://ollama.com` and you can use [cloud models](https://ollama.com/search?c=cloud) (e.g. `gpt-oss:120b-cloud`). Without the key, it uses local Ollama at `http://localhost:11434`.
