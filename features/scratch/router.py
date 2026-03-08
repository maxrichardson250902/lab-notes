"""Scratch pad feature — quick capture of notes/images for later processing."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import base64

from core.database import register_table, get_db

register_table("scratch", """CREATE TABLE IF NOT EXISTS scratch (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    type      TEXT NOT NULL DEFAULT 'text',
    content   TEXT NOT NULL DEFAULT '',
    filename  TEXT DEFAULT NULL,
    image_data TEXT DEFAULT NULL,
    processed INTEGER NOT NULL DEFAULT 0,
    result_type TEXT DEFAULT NULL,
    result_group TEXT DEFAULT NULL,
    result_entry_id INTEGER DEFAULT NULL,
    result_todo_id  INTEGER DEFAULT NULL,
    analysis  TEXT DEFAULT NULL,
    created   TEXT NOT NULL)""")

class AddScratch(BaseModel):
    type:       str = "text"
    content:    str = ""
    filename:   Optional[str] = None
    image_data: Optional[str] = None

router = APIRouter(prefix="/api", tags=["scratch"])

@router.get("/scratch")
def get_scratch(include_processed: bool = False):
    with get_db() as conn:
        if include_processed:
            rows = conn.execute("SELECT * FROM scratch ORDER BY created DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scratch WHERE processed=0 ORDER BY created DESC").fetchall()
    entries = [dict(r) for r in rows]
    for e in entries:
        if e.get("image_data"):
            e["has_image"] = True
            del e["image_data"]
    return {"entries": entries}

@router.get("/scratch/{scratch_id}/image")
def get_scratch_image(scratch_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT image_data, filename FROM scratch WHERE id=?", (scratch_id,)).fetchone()
    if not row or not row["image_data"]: raise HTTPException(404, "No image")
    return {"image_data": row["image_data"], "filename": row["filename"]}

@router.get("/scratch/{scratch_id}/image-raw")
def get_scratch_image_raw(scratch_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT image_data, filename FROM scratch WHERE id=?", (scratch_id,)).fetchone()
    if not row or not row["image_data"]: raise HTTPException(404, "No image")
    img_bytes = base64.b64decode(row["image_data"])
    fn = (row["filename"] or "").lower()
    if fn.endswith(".png"):                       mt = "image/png"
    elif fn.endswith(".jpg") or fn.endswith(".jpeg"): mt = "image/jpeg"
    elif fn.endswith(".gif"):                     mt = "image/gif"
    elif fn.endswith(".pdf"):                     mt = "application/pdf"
    else:                                          mt = "image/jpeg"
    return Response(content=img_bytes, media_type=mt)

@router.post("/scratch")
def add_scratch(body: AddScratch):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO scratch (type,content,filename,image_data,created) VALUES (?,?,?,?,?)",
            (body.type, body.content, body.filename, body.image_data, now))
        conn.commit()
        row = dict(conn.execute(
            "SELECT id,type,content,filename,processed,created FROM scratch WHERE id=?",
            (cur.lastrowid,)).fetchone())
    return row

@router.delete("/scratch/{scratch_id}")
def delete_scratch(scratch_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM scratch WHERE id=?", (scratch_id,))
        conn.commit()
    return {"deleted": scratch_id}

@router.post("/scratch/process-results")
def receive_scratch_results(body: dict):
    results = body.get("results", [])
    now = datetime.utcnow().isoformat()
    processed = []
    for item in results:
        sid = item.get("id")
        if not sid: continue
        with get_db() as conn:
            row = conn.execute("SELECT * FROM scratch WHERE id=?", (sid,)).fetchone()
            if not row: continue
            s = dict(row)
        result_type  = item.get("result_type", "note")
        result_group = item.get("result_group", "")
        analysis     = item.get("analysis", "")
        entry_id     = None
        if result_type in ("note", "task"):
            en = datetime.utcnow().strftime("%Y-%m-%d")
            with get_db() as conn:
                cur = conn.execute(
                    "INSERT INTO entries (title,group_name,subgroup,date,notes,created,updated) VALUES (?,?,?,?,?,?,?)",
                    (item.get("title", s["content"][:60]),
                     result_group, item.get("subgroup", "Notes"), en, analysis or s["content"], now, now))
                conn.commit()
                entry_id = cur.lastrowid
        if result_type == "reminder":
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO reminders (text,due_date,done,source,created) VALUES (?,?,0,'scratch',?)",
                    (s["content"][:200], item.get("due_date"), now))
                conn.commit()
        with get_db() as conn:
            conn.execute(
                "UPDATE scratch SET processed=1,result_type=?,result_group=?,result_entry_id=?,analysis=? WHERE id=?",
                (result_type, result_group, entry_id, analysis, sid))
            conn.commit()
        processed.append(sid)
    return {"processed": processed}

@router.post("/scratch/save-day-summary")
def save_day_summary(body: dict):
    date    = body.get("date", datetime.utcnow().strftime("%Y-%m-%d"))
    summary = body.get("summary", "")
    now     = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO day_summaries (date,summary,updated) VALUES (?,?,?)",
            (date, summary, now))
        conn.commit()
    return {"saved": date}
