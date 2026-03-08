"""Pipeline memory feature — shared learned pipeline data from todo app."""
from fastapi import APIRouter
from datetime import datetime
import json

from core.database import register_table, get_db

register_table("pipeline_memory", """CREATE TABLE IF NOT EXISTS pipeline_memory (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name  TEXT NOT NULL UNIQUE,
    sequence    TEXT NOT NULL DEFAULT '[]',
    observation TEXT NOT NULL DEFAULT '',
    updated     TEXT NOT NULL)""")

router = APIRouter(prefix="/api", tags=["pipeline_memory"])

@router.get("/pipeline-memory")
def get_pipeline_memory():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM pipeline_memory ORDER BY updated DESC").fetchall()
    return {"memory": [dict(r) for r in rows]}

@router.put("/pipeline-memory")
def update_pipeline_memory(body: dict):
    group = body.get("group_name", "")
    sequence = body.get("sequence", "[]")
    observation = body.get("observation", "")
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM pipeline_memory WHERE group_name=?", (group,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE pipeline_memory SET sequence=?, observation=?, updated=? WHERE group_name=?",
                (sequence, observation, now, group))
        else:
            conn.execute(
                "INSERT INTO pipeline_memory (group_name, sequence, observation, updated) VALUES (?,?,?,?)",
                (group, sequence, observation, now))
        conn.commit()
    return {"updated": group}
