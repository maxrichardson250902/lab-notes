"""Protocols feature — protocol library CRUD with LLM step extraction."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json

from core.database import register_table, get_db
from core.llm import llm, fetch_url_text

register_table("protocols", """CREATE TABLE IF NOT EXISTS protocols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    url         TEXT DEFAULT NULL,
    source_text TEXT DEFAULT NULL,
    steps       TEXT DEFAULT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

class CreateProtocol(BaseModel):
    title: str
    url:   Optional[str] = None
    notes: str = ""
    tags:  List[str] = []

class UpdateProtocol(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    tags:  Optional[List[str]] = None
    steps: Optional[str] = None

router = APIRouter(prefix="/api", tags=["protocols"])

@router.get("/protocols")
def list_protocols(tag: str = ""):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM protocols ORDER BY created DESC").fetchall()
    protocols = [dict(r) for r in rows]
    if tag:
        protocols = [p for p in protocols if tag in json.loads(p.get("tags") or "[]")]
    return {"protocols": protocols}

@router.get("/protocols/{protocol_id}")
def get_protocol(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row: raise HTTPException(404, "Not found")
    return dict(row)

@router.post("/protocols")
async def create_protocol(body: CreateProtocol):
    now = datetime.utcnow().isoformat()
    source_text = ""
    steps = None
    if body.url:
        source_text = await fetch_url_text(body.url)
        if source_text and not source_text.startswith("Error"):
            steps = await llm(
                f"Protocol title: {body.title}\n\nSource text:\n{source_text}",
                "Extract the key protocol steps from this text. Format as a numbered list. "
                "Include reagents, volumes, temperatures, and timings where mentioned. "
                "Be concise but complete. If this is not a protocol, say so.",
                max_tokens=600
            )
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,url,source_text,steps,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?)",
            (body.title, body.url, source_text, steps, body.notes, json.dumps(body.tags), now, now))
        conn.commit()
        protocol = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())
    return protocol

@router.put("/protocols/{protocol_id}")
async def update_protocol(protocol_id: int, body: UpdateProtocol):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
        if not row: raise HTTPException(404, "Not found")
        p = dict(row)
        if body.title is not None: p["title"] = body.title
        if body.notes is not None: p["notes"] = body.notes
        if body.steps is not None: p["steps"] = body.steps
        if body.tags  is not None: p["tags"]  = json.dumps(body.tags)
        p["updated"] = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE protocols SET title=?,notes=?,steps=?,tags=?,updated=? WHERE id=?",
            (p["title"], p["notes"], p["steps"], p["tags"], p["updated"], protocol_id))
        conn.commit()
    return p

@router.delete("/protocols/{protocol_id}")
def delete_protocol(protocol_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM protocols WHERE id=?", (protocol_id,))
        conn.commit()
    return {"deleted": protocol_id}

@router.post("/protocols/{protocol_id}/re-extract")
async def re_extract_steps(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row: raise HTTPException(404, "Not found")
    p = dict(row)
    if not p["source_text"]:
        raise HTTPException(400, "No source text stored")
    steps = await llm(
        f"Protocol: {p['title']}\n\n{p['source_text']}",
        "Extract the key protocol steps as a numbered list with reagents, volumes, temperatures, and timings.",
        max_tokens=600
    )
    with get_db() as conn:
        conn.execute("UPDATE protocols SET steps=?, updated=? WHERE id=?",
                     (steps, datetime.utcnow().isoformat(), protocol_id))
        conn.commit()
    return {"steps": steps}
