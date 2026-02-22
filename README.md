# Quorum — Carbon-Aware Multi-Agent Orchestration

**HackEurope · Sustainability Track**

Break down any task into subtasks, route each to the smallest capable model, run them in parallel, and track cost and CO₂ savings in real time. Built with a Next.js frontend and a Python (FastAPI) backend, using **Ollama Cloud** or local Ollama for inference, plus optional Stripe wallet top-ups for per-agent billing.

---

## What it does

- **Task decomposition** — A single prompt is decomposed into subtasks; each subtask is assigned a model (by parameter size/capability) and optional dependencies.
- **Parallel execution** — Agents run concurrently where the dependency graph allows; progress streams to the UI (graph view, timeline, live output).
- **Carbon tracking** — Pipeline CO₂ (gCO₂) is estimated from token counts and GPU energy models; compared to a 70B single-model baseline. Real-time grid intensity (France by default) from [Electricity Maps](https://www.electricitymaps.com/) or a built-in fallback.
- **Green window scheduling** — Optional “run when grid is cleaner” using 24h history + 8h forecast (when Electricity Maps key is set).
- **Billing** — Demo wallet (SQLite ledger); optional Stripe integration for top-ups and payment-method storage. Backend seeds the demo user with $15 on first run.

---

## Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+
- **Ollama** — [ollama.com](https://ollama.com): either local install or an [Ollama Cloud API key](https://ollama.com/settings/keys)
- **Stripe** (optional, for real top-ups): account + Stripe CLI for local webhooks

---

## Quick start

### 1. Clone and environment

Clone the repo. Create a **`.env`** file in the **project root** (same folder as `backend/` and `frontend/`). Backend and frontend read from this file.

**Required for basic run:**

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**For Ollama Cloud (recommended):**

```env
OLLAMA_API_KEY=your_ollama_api_key
```

**For Stripe top-ups (optional):**

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

**For live carbon intensity (optional):**

```env
ELECTRICITY_MAPS_API_KEY=your_em_key
```

Without `ELECTRICITY_MAPS_API_KEY`, the app uses a France fallback intensity (~65 gCO₂/kWh).

### 2. Backend (Python)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

- **Ollama Cloud:** set `OLLAMA_API_KEY` in `.env`; no local Ollama needed.
- **Local Ollama only:** leave `OLLAMA_API_KEY` unset, run [Ollama](https://ollama.com) locally, and pull models (e.g. `ollama pull llama3.2`).

On first run, the backend seeds the demo user with **$15** so you can run agents without Stripe. Health: [http://localhost:8000/api/health](http://localhost:8000/api/health).

### 3. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Stripe webhooks (only if using Stripe top-ups)

Stripe cannot reach `localhost`. Use the Stripe CLI to forward events:

```bash
./scripts/setup-stripe.sh            # one-time: download CLI + log in
./scripts/setup-stripe.sh --listen   # forward webhooks (run in a separate terminal)
```

Use the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET` in `.env`. To only print the secret: `./scripts/setup-stripe.sh --print-secret`.

---

## Run order (summary)

| Order | Terminal | Command |
|-------|----------|--------|
| 1 | (optional) Stripe | `./scripts/setup-stripe.sh --listen` |
| 2 | Backend | `cd backend && source .venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000` |
| 3 | Frontend | `cd frontend && npm run dev` |

---

## Demo wallet (no Stripe)

- Backend seeds **demo** with $15 on first start.
- To add more without Stripe, call the demo top-up API:

```bash
curl -X POST http://localhost:8000/api/billing/topup \
  -H "Content-Type: application/json" \
  -d '{"user_id":"demo","amount_usd":5}'
```

---

## API (concise)

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/health` | Backend status; `ollama_cloud` flag |
| GET | `/api/models` | List Ollama models (cloud or local) |
| GET | `/api/carbon-intensity?zone=FR` | Current grid carbon intensity (gCO₂/kWh) |
| GET | `/api/carbon-forecast?zone=FR` | 24h history + 8h forecast (+ green window) |
| GET | `/api/billing/balance?user_id=demo` | Wallet balance (microdollars + USD) |
| POST | `/api/decompose` | Decompose prompt → subtasks + routing |
| POST | `/api/execute` | Run subtasks (SSE stream: progress, carbon summary) |
| POST | `/api/chat` | Chat completion (single model) |
| POST | `/api/billing/topup` | Demo top-up (no Stripe) |
| POST | `/api/billing/create_customer` | Create/fetch Stripe customer |
| POST | `/api/billing/create_setup_intent` | SetupIntent for saving payment method |
| POST | `/api/billing/create_topup_intent` | PaymentIntent for wallet top-up |
| POST | `/api/stripe/webhook` | Stripe webhook (signature verified) |

---

## Stripe (production)

- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env` (use `sk_live_...` / `pk_live_...` for production).
- In Stripe Dashboard → Developers → Webhooks, add an endpoint: `https://YOUR_BACKEND_DOMAIN/api/stripe/webhook`.
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`.
- Wallet credits occur only for `payment_intent.succeeded` with metadata `purpose=wallet_topup` and `user_id`; the app sets these when creating top-ups via `POST /api/billing/create_topup_intent`.

---

## Tech stack

- **Frontend:** Next.js 15, React 19, Tailwind, React Flow (graph), Stripe React/JS.
- **Backend:** FastAPI, Ollama (cloud or local), SQLite (billing ledger + user→Stripe mapping), Stripe, Electricity Maps (optional).
- **Carbon:** Energy model from GPU TDP/throughput; carbon intensity from Electricity Maps or zone fallbacks; 70B baseline comparison and green-window suggestion.
