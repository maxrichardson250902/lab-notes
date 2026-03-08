"""Project summaries feature."""
from fastapi import APIRouter
from datetime import datetime
import json

from core.database import register_table, get_db

register_table("project_summaries", """CREATE TABLE IF NOT EXISTS project_summaries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name  TEXT NOT NULL UNIQUE,
    summary     TEXT NOT NULL DEFAULT '',
    next_steps  TEXT NOT NULL DEFAULT '[]',
    updated     TEXT NOT NULL)""")

router = APIRouter(prefix="/api", tags=["summaries"])

@router.get("/summaries")
def get_summaries():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM project_summaries ORDER BY updated DESC").fetchall()
    return {"summaries": [dict(r) for r in rows]}

@router.put("/summaries/{group_name}")
def upsert_summary(group_name: str, body: dict):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM project_summaries WHERE group_name=?",
                                (group_name,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE project_summaries SET summary=?, next_steps=?, updated=? WHERE group_name=?",
                (body.get("summary", ""), json.dumps(body.get("next_steps", [])), now, group_name))
        else:
            conn.execute(
                "INSERT INTO project_summaries (group_name,summary,next_steps,updated) VALUES (?,?,?,?)",
                (group_name, body.get("summary", ""), json.dumps(body.get("next_steps", [])), now))
        conn.commit()
    return {"updated": group_name}
