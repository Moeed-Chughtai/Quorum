# Stripe Micropayments Plan (Per-Agent-Step Token Billing)

## Goal
Charge users for agent execution based on token consumption, with a billing event after each completed subtask (agent step). The billing must be safe, reliable, and work even when per-step charges are very small.

## Key Constraints and Stripe Reality Check
- Stripe’s support for “microtransactions” varies by market. In markets where it is not available, Stripe recommends bundling multiple microtransactions into a single larger charge.
- Standard card processing fees make direct per-step card charges impractical for very small amounts.
- The practical solution is to treat each step as a metered event in your app, then bundle those events into fewer Stripe charges (wallet/top-ups or periodic invoicing), while still showing users per-step costs.

## Recommended Approach (Matches Micropayments Best Practices)
Implement an in-app prepaid balance (“wallet”) funded by Stripe charges (top-ups). After each agent step completes, decrement wallet balance by the computed token-based price for that step.

Why this fits micropayments:
- Users pre-fund a small balance, and your system authorizes many tiny “purchases” without paying Stripe fees per step.
- You can still trigger a “micropayment” after each step from the user’s wallet (internal ledger entry), even if Stripe sees fewer aggregated charges.
- You can support auto top-up (off-session) to keep execution flowing.

## What You Already Have in This Codebase
- Each agent completion event now emits `input_tokens`, `output_tokens`, and per-step costs (`input_cost`, `output_cost`, `total_cost`) via the backend execution stream.
- Per-model pricing is currently in [model_specialization.json](file:///Users/jalliet/GitHub/Personal/Hacks/HackEurope/backend/model_specialization.json) under `pricing_per_1m_tokens`.

This means the missing piece is Stripe customer setup, wallet funding, and a ledger, plus guardrails and UI.

## Billing Model
### Internal pricing
- The execution backend already computes per-step pricing when each agent completes a subtask and emits it in the `agent_completed` SSE event:
  - `input_tokens`, `output_tokens`
  - `input_cost`, `output_cost`, `total_cost` (USD)
- Billing should treat these emitted values as the source of truth. Do not recompute pricing in the billing subsystem or in the frontend.
- Convert the emitted USD values into your wallet’s smallest unit:
  - Preferred: store as integer “microunits” (for example, microdollars where `1 microdollar = $0.000001`) to avoid rounding drift.
  - Alternative: store as `Decimal` in USD with fixed precision.
- Handling sub-cent amounts:
  - Many steps will cost less than $0.01. Accumulate fractional value in the wallet ledger using micro-units (or Decimal USD).
  - Only decrement wallet “available cents” when the accumulated amount crosses 1 cent.
  - This prevents losing money due to rounding and keeps Stripe-compatible integer charging.

### Stripe charging strategy
- Top-ups are the only Stripe charges.
- Top-up amounts should be meaningful: e.g. $5, $10, $20, and optional auto top-up when balance < threshold.
- If microtransaction support is available in your market, you can still keep wallet as primary approach; it remains the simplest and most reliable.

## User Flows
### 1) First-time setup
1. User enters the app.
2. User is asked to add a payment method and fund wallet (top-up) before executing agents.
3. On success, wallet balance is credited, and execution can start.

### 2) Execute agents (per-step microbilling)
1. User clicks “Execute all agents”.
2. Backend executes subtasks and streams SSE events.
3. For each `agent_completed` event:
   - Record a “usage line item” with token counts and computed cost.
   - Decrement user wallet by the step’s cost (fractional handling as needed).
   - Emit updated wallet balance and per-model totals to the UI.

### 3) Insufficient balance behavior
When balance is too low:
- If auto top-up is enabled and user has a saved payment method, perform an off-session Stripe PaymentIntent for the configured top-up amount, then continue.
- Otherwise, pause execution and show “Top up to continue”.

### 4) Refunds and dispute handling
- Wallet system must preserve a detailed audit trail per step and per top-up.
- If you refund a top-up, you should reverse corresponding wallet credits and mark affected usage as settled/refunded, depending on policy.

## Stripe Setup (Account + Keys + Webhooks)
### 1) Create Stripe account and get keys
- Create a Stripe account.
- Obtain:
  - Secret key: `STRIPE_SECRET_KEY`
  - Publishable key: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### 2) Webhook endpoint
You must implement a webhook to safely confirm:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- Optionally `charge.refunded`, `dispute.created`

Store:
- `STRIPE_WEBHOOK_SECRET` per environment.

### 3) Products and pricing (optional)
For top-ups you can use either:
- PaymentIntents directly (no Stripe Products needed), or
- Checkout Sessions with predefined top-up “products/prices”.

Simplest:
- Use PaymentIntents directly for variable top-up amounts.

## Data Model (Backend)
Add persistent storage. Even if you start with SQLite, design for Postgres.

Tables (suggested):
- `users`
  - `id`
  - `stripe_customer_id`
  - `default_payment_method_id` (optional)
  - `auto_topup_enabled` (bool)
  - `auto_topup_amount_cents` (int)
  - `auto_topup_threshold_cents` (int)

- `wallets`
  - `user_id`
  - `available_cents` (int)
  - `pending_microcents` (int) or `pending_usd_decimal`

- `wallet_ledger_entries`
  - `id`
  - `user_id`
  - `type` = `topup` | `usage` | `adjustment` | `refund`
  - `subtask_id` (nullable)
  - `model` (nullable)
  - `input_tokens`, `output_tokens` (nullable)
  - `amount_cents` (signed int, usage negative)
  - `microcents_delta` (signed)
  - `stripe_payment_intent_id` (nullable)
  - `created_at`

## Backend API Changes (FastAPI)
### 1) Stripe SDK and config
- Add `stripe` Python SDK.
- Read env vars:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

### 2) Customer + payment method
Endpoints:
- `POST /api/billing/create_customer`
  - Create Stripe Customer and store `stripe_customer_id`.
- `POST /api/billing/create_setup_intent`
  - Create SetupIntent so the frontend can collect a card and save it.
- `POST /api/billing/enable_auto_topup`
  - Store auto top-up settings.

### 3) Top-up
Two options:
- `POST /api/billing/create_topup_intent`
  - Create PaymentIntent for `amount_cents` and return `client_secret`.
  - On webhook success, credit wallet.

Or use Stripe Checkout:
- `POST /api/billing/create_topup_checkout_session`

### 4) Webhook
- `POST /api/stripe/webhook`
  - Verify signature with `STRIPE_WEBHOOK_SECRET`.
  - On `payment_intent.succeeded`: credit wallet and write a ledger entry.
  - On `payment_intent.payment_failed`: mark top-up failed and notify frontend (polling or SSE).

### 5) Usage deduction during execution
Modify the execution engine (the component that produces SSE):
- When emitting `agent_completed`, also:
  - Write a `wallet_ledger_entries` row for usage.
  - Decrement wallet balance in a transaction.
  - If insufficient funds:
    - Attempt auto top-up (off-session PI) and continue, or
    - Emit an SSE event like `billing_required` and pause execution.

Important reliability requirements:
- Use idempotency keys when creating PaymentIntents (e.g. per top-up request).
- Use DB transactions to ensure “agent completed” and “wallet deducted” cannot partially apply.

## Frontend Changes (Next.js)
### 1) Stripe.js integration
- Add Stripe.js and Elements.
- Collect payment method via SetupIntent.
- Store a “billing ready” state for the user.

### 2) Wallet UI
- Show wallet balance in the UI.
- Show running per-model totals:
  - Input tokens total
  - Output tokens total
  - Total price

### 3) Execution flow integration
- Before starting execution:
  - Ensure wallet has sufficient funds for an estimated minimum, or prompt top-up.
- During execution:
  - If backend emits `billing_required`, show a modal prompting top-up, then resume.

## Security and Compliance Checklist
- Do not store card numbers. Use Stripe Elements + SetupIntent, store only Stripe IDs.
- Verify webhook signatures.
- Use least-privilege secret handling (.env files not committed).
- Prevent tampering:
  - Token counts and prices must be computed server-side.
  - Frontend display is informational only.

## Testing Plan
### Unit tests
- Pricing computation and rounding behavior (microcents).
- Ledger balance updates for top-ups and usage.

### Integration tests (Stripe test mode)
- Setup payment method.
- Top up wallet.
- Run multi-step execution:
  - Validate per-step ledger entries.
  - Validate per-model totals match sum of steps.

### Failure mode tests
- Payment fails, wallet not credited.
- Insufficient wallet triggers pause.
- Auto top-up succeeds and resumes.
- Webhook replay does not double-credit (idempotency).

## Rollout Plan
1. Implement wallet ledger without Stripe, simulate top-ups.
2. Add Stripe top-up PaymentIntents and webhook crediting.
3. Add SetupIntent + saved payment methods.
4. Add auto top-up and “pause/resume” behavior.
5. Add admin/audit tools to inspect ledger and charges.

## “Per-Step Stripe Charge” Alternative (Not Recommended)
You can charge a PaymentIntent after each step if:
- You have microtransaction pricing support in your market, and
- Users have saved payment methods and you handle SCA requirements.

But it will be fragile and expensive due to fees and repeated off-session charges. The wallet approach is the practical way to achieve the product experience, while keeping Stripe usage sustainable.
