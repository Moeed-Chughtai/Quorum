import logging
import os

import stripe

log = logging.getLogger(__name__)


def configure_stripe() -> None:
    key = os.getenv("STRIPE_SECRET_KEY")
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not set")
    stripe.api_key = key


def webhook_secret() -> str:
    secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is not set")
    return secret


# ------------------------------------------------------------------ #
# Stripe Customer Balance helpers                                      #
# ------------------------------------------------------------------ #
# Stripe convention: negative customer.balance = credit in customer's  #
# favour.  We expose helpers that speak in *positive* cents so callers #
# don't need to flip signs.                                            #
# ------------------------------------------------------------------ #


def _ensure_stripe() -> None:
    """Ensure stripe.api_key is set (idempotent)."""
    if not stripe.api_key:
        configure_stripe()


def get_stripe_balance_cents(customer_id: str) -> int:
    """Return the customer's available credit in positive cents."""
    _ensure_stripe()
    cust = stripe.Customer.retrieve(customer_id)
    # Negative balance = credit → flip sign for our positive-credit model
    return max(0, -(cust.get("balance", 0) or 0))


def credit_stripe_balance(customer_id: str, amount_cents: int) -> None:
    """Credit the customer's Stripe balance (add funds)."""
    if amount_cents <= 0:
        return
    _ensure_stripe()
    stripe.Customer.create_balance_transaction(
        customer_id,
        amount=-amount_cents,   # negative = credit
        currency="usd",
        description="Wallet top-up",
    )
    log.info("Stripe balance credited %d cents for %s", amount_cents, customer_id)


def debit_stripe_balance(customer_id: str, amount_cents: int) -> None:
    """Debit the customer's Stripe balance (usage charge)."""
    if amount_cents <= 0:
        return
    _ensure_stripe()
    stripe.Customer.create_balance_transaction(
        customer_id,
        amount=amount_cents,    # positive = debit
        currency="usd",
        description="Agent usage debit",
    )
    log.info("Stripe balance debited %d cents for %s", amount_cents, customer_id)

