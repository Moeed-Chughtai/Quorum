import time
import uuid
from decimal import Decimal, InvalidOperation

from billing_db import connect, init_db


def _now_s() -> int:
    return int(time.time())


def _to_microdollars(usd: float | int | str | Decimal) -> int:
    try:
        d = usd if isinstance(usd, Decimal) else Decimal(str(usd))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid USD amount")
    return int((d * Decimal("1000000")).to_integral_value(rounding="ROUND_HALF_UP"))


def _ensure_user_and_wallet(conn, user_id: str) -> None:
    now = _now_s()
    conn.execute(
        "INSERT OR IGNORE INTO users(id, created_at) VALUES(?, ?)",
        (user_id, now),
    )
    conn.execute(
        "INSERT OR IGNORE INTO wallets(user_id, available_microdollars, pending_microdollars, updated_at) VALUES(?, 0, 0, ?)",
        (user_id, now),
    )


def get_wallet_balance_microdollars(user_id: str) -> int:
    conn = connect()
    try:
        init_db(conn)
        row = conn.execute(
            "SELECT available_microdollars FROM wallets WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return 0
        return int(row["available_microdollars"])
    finally:
        conn.close()


def record_topup_credit(
    user_id: str,
    amount_usd: float | int | str | Decimal,
    stripe_payment_intent_id: str | None = None,
) -> dict:
    conn = connect()
    try:
        init_db(conn)
        conn.execute("BEGIN IMMEDIATE")
        _ensure_user_and_wallet(conn, user_id)

        if stripe_payment_intent_id:
            exists = conn.execute(
                "SELECT 1 FROM wallet_ledger_entries WHERE type = 'topup' AND stripe_payment_intent_id = ?",
                (stripe_payment_intent_id,),
            ).fetchone()
            if exists:
                conn.execute("COMMIT")
                return {"status": "noop", "reason": "already_recorded"}

        delta = _to_microdollars(amount_usd)
        entry_id = str(uuid.uuid4())
        now = _now_s()
        conn.execute(
            "INSERT INTO wallet_ledger_entries(id, user_id, type, amount_microdollars, stripe_payment_intent_id, created_at) "
            "VALUES(?, ?, 'topup', ?, ?, ?)",
            (entry_id, user_id, delta, stripe_payment_intent_id, now),
        )
        conn.execute(
            "UPDATE wallets SET available_microdollars = available_microdollars + ?, updated_at = ? WHERE user_id = ?",
            (delta, now, user_id),
        )
        row = conn.execute(
            "SELECT available_microdollars FROM wallets WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.execute("COMMIT")
        return {"status": "credited", "entry_id": entry_id, "balance_microdollars": int(row["available_microdollars"])}
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        conn.close()


def record_usage_debit(
    user_id: str,
    subtask_id: int,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_cost_usd: float | int | str | Decimal,
) -> dict:
    conn = connect()
    try:
        init_db(conn)
        conn.execute("BEGIN IMMEDIATE")
        _ensure_user_and_wallet(conn, user_id)

        exists = conn.execute(
            "SELECT 1 FROM wallet_ledger_entries WHERE type = 'usage' AND user_id = ? AND subtask_id = ?",
            (user_id, subtask_id),
        ).fetchone()
        if exists:
            row = conn.execute(
                "SELECT available_microdollars FROM wallets WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            conn.execute("COMMIT")
            return {"status": "noop", "reason": "already_recorded", "balance_microdollars": int(row["available_microdollars"])}

        cost = _to_microdollars(total_cost_usd)
        debit = -abs(int(cost))
        now = _now_s()

        row = conn.execute(
            "SELECT available_microdollars FROM wallets WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        current = int(row["available_microdollars"]) if row else 0
        if current + debit < 0:
            conn.execute("ROLLBACK")
            return {
                "status": "insufficient_funds",
                "required_microdollars": abs(debit),
                "balance_microdollars": current,
            }

        entry_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO wallet_ledger_entries("
            "id, user_id, type, subtask_id, model, input_tokens, output_tokens, amount_microdollars, created_at"
            ") VALUES(?, ?, 'usage', ?, ?, ?, ?, ?, ?)",
            (entry_id, user_id, subtask_id, model, int(input_tokens), int(output_tokens), debit, now),
        )
        conn.execute(
            "UPDATE wallets SET available_microdollars = available_microdollars + ?, updated_at = ? WHERE user_id = ?",
            (debit, now, user_id),
        )
        row2 = conn.execute(
            "SELECT available_microdollars FROM wallets WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.execute("COMMIT")
        return {"status": "debited", "entry_id": entry_id, "balance_microdollars": int(row2["available_microdollars"])}
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        conn.close()

