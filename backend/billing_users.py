import time

from billing_db import connect, init_db


def _now_s() -> int:
    return int(time.time())


def get_stripe_customer_id(user_id: str) -> str | None:
    conn = connect()
    try:
        init_db(conn)
        row = conn.execute(
            "SELECT stripe_customer_id FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return None
        return row["stripe_customer_id"]
    finally:
        conn.close()


def set_stripe_customer_id(user_id: str, stripe_customer_id: str) -> None:
    conn = connect()
    try:
        init_db(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "INSERT OR IGNORE INTO users(id, created_at) VALUES(?, ?)",
            (user_id, _now_s()),
        )
        conn.execute(
            "UPDATE users SET stripe_customer_id = ? WHERE id = ?",
            (stripe_customer_id, user_id),
        )
        conn.execute("COMMIT")
    except Exception:
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        conn.close()

