import os
import sqlite3
from pathlib import Path


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  default_payment_method_id TEXT,
  auto_topup_enabled INTEGER NOT NULL DEFAULT 0,
  auto_topup_amount_cents INTEGER,
  auto_topup_threshold_cents INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available_microdollars INTEGER NOT NULL DEFAULT 0,
  pending_microdollars INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subtask_id INTEGER,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  amount_microdollars INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created_at
  ON wallet_ledger_entries(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_pi
  ON wallet_ledger_entries(stripe_payment_intent_id);
"""


def _db_path() -> str:
    p = os.getenv("BILLING_DB_PATH")
    if p:
        return p
    return str(Path(__file__).resolve().parent / "billing.db")


def connect():
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn) -> None:
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def init_billing_db() -> None:
    conn = connect()
    try:
        init_db(conn)
    finally:
        conn.close()

