"""
Core database helpers — shared across all features.
Each feature calls register_table() at import time to declare its schema.
Tables are created during app startup via init_all_tables().
"""
import sqlite3, os
from contextlib import contextmanager

DB_PATH = "/data/lab.db"

# ── Table registry ────────────────────────────────────────────────────────────
# Features append (table_name, create_sql) tuples here at import time.
_table_registry: list[tuple[str, str]] = []
# Seed callbacks: each is a callable that takes a sqlite3.Connection and may
# insert default rows. Run AFTER all tables are created. Idempotent by contract
# (every callback is responsible for not duplicating its own rows).
_seed_callbacks: list = []


def register_table(name: str, create_sql: str):
    """Register a CREATE TABLE IF NOT EXISTS statement to run at startup."""
    _table_registry.append((name, create_sql))


def register_seed(fn):
    """Register a function to populate default rows after table creation.
    Callback signature: fn(conn) -> None. Called inside the init transaction;
    must be idempotent (re-run safely on every startup)."""
    _seed_callbacks.append(fn)


def ensure_column(conn, table: str, column: str, decl: str):
    """Idempotently add a column to an existing table. `decl` is the SQL type
    plus any constraints, e.g. "TEXT NOT NULL DEFAULT 'plain'". SQLite doesn't
    support IF NOT EXISTS on ADD COLUMN, so we introspect PRAGMA table_info."""
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column in cols:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_all_tables():
    """Create /data dir and run every registered CREATE TABLE statement,
    then run every registered seed callback."""
    os.makedirs("/data", exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        # WAL mode lets readers and writers coexist instead of locking the whole DB,
        # which matters when uvicorn runs multiple workers against the same SQLite file.
        # busy_timeout makes brief lock contention wait instead of erroring out.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        for _name, sql in _table_registry:
            conn.execute(sql)
        conn.commit()
        # Seeds need Row factory so callbacks can use named columns if they want.
        conn.row_factory = sqlite3.Row
        for fn in _seed_callbacks:
            fn(conn)
        conn.commit()


@contextmanager
def get_db():
    """Yields a sqlite3 connection with Row factory. Auto-closes."""
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.row_factory = sqlite3.Row
    # Per-connection busy_timeout (PRAGMAs in WAL mode are per-DB but busy_timeout is per-connection).
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
    finally:
        conn.close()
