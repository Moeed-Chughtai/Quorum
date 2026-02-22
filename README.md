# HackEurope

Next.js frontend + Python (FastAPI) backend with **Ollama Cloud** (and optional local Ollama) support, plus per-agent-step billing via Stripe wallet top-ups.

## Quick start

### 1. Environment

Copy `.env.example` to `.env` in the repo root and fill in:

```
OLLAMA_API_KEY=your_ollama_api_key
NEXT_PUBLIC_API_URL=http://localhost:8000
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 2. Stripe CLI (webhook forwarding)

Stripe webhooks cannot reach `localhost` directly. The setup script downloads the Stripe CLI and authenticates:

```bash
./scripts/setup-stripe.sh            # downloads CLI + opens browser login
./scripts/setup-stripe.sh --listen    # starts webhook forwarding (run in its own terminal)
```

The `--listen` command prints a `whsec_...` secret. Set it as `STRIPE_WEBHOOK_SECRET` in `.env`.

To just print the webhook secret without blocking:

```bash
./scripts/setup-stripe.sh --print-secret
```

### 3. Backend (Python)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Ollama Cloud** (recommended): create an [API key](https://ollama.com/settings/keys) and set `OLLAMA_API_KEY` in `.env`.

**Local Ollama only:** run [Ollama](https://ollama.com) locally (omit `OLLAMA_API_KEY`), then start the backend as above. Pull models with e.g. `ollama pull llama3.2`.

### 4. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Seed wallet balance (first run)

The demo user starts with $0 balance. Seed it so agents can execute:

```bash
cd backend
python -c "
from billing_ledger import record_topup_credit
print(record_topup_credit('demo', 10.0, 'seed_initial'))
"
```

## Running order

Start everything in three separate terminals:

| Order | Terminal | Command |
|-------|----------|---------|
| 1     | Stripe   | `./scripts/setup-stripe.sh --listen` |
| 2     | Backend  | `cd backend && source .venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000` |
| 3     | Frontend | `cd frontend && npm run dev` |

## API

- `GET /api/health` -- backend health and whether Cloud is used.
- `GET /api/models` -- list Ollama models (cloud or local).
- `POST /api/chat` -- chat completion (body: `{ "model": "...", "messages": [...], "stream": false }`).
- `POST /api/decompose` -- decompose a prompt into subtasks (body: `{ "prompt": "...", "orchestrator_model": "gemma3:12b" }`).
- `POST /api/execute` -- execute subtasks via agents, SSE stream (body: `{ "original_prompt": "...", "subtasks": [...], "user_id": "demo" }`).
- `GET /api/billing/balance?user_id=demo` -- current wallet balance (microdollars + USD).
- `POST /api/billing/create_customer` -- create or fetch a Stripe Customer (body: `{ "user_id": "...", "email": "..." }`).
- `POST /api/billing/create_setup_intent` -- create a SetupIntent to save a payment method (body: `{ "user_id": "..." }`).
- `POST /api/billing/create_topup_intent` -- create a PaymentIntent for wallet top-ups (body: `{ "user_id": "...", "amount_cents": 500 }`).
- `POST /api/stripe/webhook` -- Stripe webhook receiver (signature verified).

## Stripe setup (production)

### Backend env vars

Set these in repo root `.env` (never commit secrets):

- `STRIPE_SECRET_KEY` -- use `sk_test_...` in test mode, `sk_live_...` in production
- `STRIPE_WEBHOOK_SECRET` -- the endpoint signing secret (`whsec_...`)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` -- your publishable key (`pk_test_...` or `pk_live_...`)

### Create the webhook endpoint in Stripe Dashboard

1. Stripe Dashboard > Developers > Webhooks.
2. Add endpoint pointing to `https://YOUR_BACKEND_DOMAIN/api/stripe/webhook`.
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`.
4. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

### Local development

Use the setup script instead of the dashboard:

```bash
./scripts/setup-stripe.sh            # one-time: downloads CLI + logs in
./scripts/setup-stripe.sh --listen    # forwards webhook events to localhost:8000
```

### Wallet top-up webhook behavior

Wallet credits happen only for `payment_intent.succeeded` events where the PaymentIntent metadata includes:
- `purpose=wallet_topup`
- `user_id=<your user id>`

This metadata is set automatically when creating top-ups via `POST /api/billing/create_topup_intent`.

## Ollama Cloud models

With `OLLAMA_API_KEY` set, the backend uses `https://ollama.com` and you can use [cloud models](https://ollama.com/search?c=cloud) (e.g. `gpt-oss:120b-cloud`). Without the key, it uses local Ollama at `http://localhost:11434`.
