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


def register_table(name: str, create_sql: str):
    """Register a CREATE TABLE IF NOT EXISTS statement to run at startup."""
    _table_registry.append((name, create_sql))


def init_all_tables():
    """Create /data dir and run every registered CREATE TABLE statement."""
    os.makedirs("/data", exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        for _name, sql in _table_registry:
            conn.execute(sql)
        conn.commit()


@contextmanager
def get_db():
    """Yields a sqlite3 connection with Row factory. Auto-closes."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
