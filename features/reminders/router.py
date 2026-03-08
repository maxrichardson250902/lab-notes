"""Reminders feature."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.database import register_table, get_db

register_table("reminders", """CREATE TABLE IF NOT EXISTS reminders (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    text      TEXT NOT NULL,
    due_date  TEXT DEFAULT NULL,
    done      INTEGER NOT NULL DEFAULT 0,
    source    TEXT DEFAULT NULL,
    created   TEXT NOT NULL)""")

class AddReminder(BaseModel):
    text:     str
    due_date: Optional[str] = None
    source:   str = "manual"

router = APIRouter(prefix="/api", tags=["reminders"])

@router.get("/reminders")
def get_reminders(include_done: bool = False):
    with get_db() as conn:
        if include_done:
            rows = conn.execute("SELECT * FROM reminders ORDER BY due_date ASC, created DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM reminders WHERE done=0 ORDER BY due_date ASC, created DESC").fetchall()
    return {"reminders": [dict(r) for r in rows]}

@router.post("/reminders")
def add_reminder(body: AddReminder):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (text,due_date,done,source,created) VALUES (?,?,0,?,?)",
            (body.text, body.due_date, body.source, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM reminders WHERE id=?", (cur.lastrowid,)).fetchone())
    return row

@router.put("/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: dict):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,)).fetchone()
        if not row: raise HTTPException(404, "Not found")
        r = dict(row)
        if "done"     in body: r["done"]     = int(body["done"])
        if "text"     in body: r["text"]     = body["text"]
        if "due_date" in body: r["due_date"] = body["due_date"]
        conn.execute("UPDATE reminders SET text=?,due_date=?,done=? WHERE id=?",
                     (r["text"], r["due_date"], r["done"], reminder_id))
        conn.commit()
    return r

@router.delete("/reminders/{reminder_id}")
def delete_reminder(reminder_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
        conn.commit()
    return {"deleted": reminder_id}
