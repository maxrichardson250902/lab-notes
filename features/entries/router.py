"""
Entries feature — notebook entries CRUD, images, summarisation, today dashboard, stats.
"""
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import base64, json

from core.database import register_table, get_db
from core.llm import llm

# ── Tables ────────────────────────────────────────────────────────────────────

register_table("entries", """CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    group_name  TEXT NOT NULL DEFAULT '',
    subgroup    TEXT NOT NULL DEFAULT '',
    date        TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    results     TEXT NOT NULL DEFAULT '',
    yields      TEXT NOT NULL DEFAULT '',
    issues      TEXT NOT NULL DEFAULT '',
    todo_task_id INTEGER DEFAULT NULL,
    boltz_job_id TEXT DEFAULT NULL,
    summary     TEXT DEFAULT NULL,
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

register_table("entry_images", """CREATE TABLE IF NOT EXISTS entry_images (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    INTEGER NOT NULL,
    filename    TEXT NOT NULL DEFAULT '',
    image_data  TEXT NOT NULL,
    media_type  TEXT NOT NULL DEFAULT 'image/png',
    created     TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE)""")

# ── Models ────────────────────────────────────────────────────────────────────

class CreateEntry(BaseModel):
    title:        str
    group_name:   str = ""
    subgroup:     str = ""
    date:         Optional[str] = None
    notes:        str = ""
    results:      str = ""
    yields:       str = ""
    issues:       str = ""
    todo_task_id: Optional[int] = None
    boltz_job_id: Optional[str] = None

class UpdateEntry(BaseModel):
    title:        Optional[str] = None
    notes:        Optional[str] = None
    results:      Optional[str] = None
    yields:       Optional[str] = None
    issues:       Optional[str] = None
    date:         Optional[str] = None
    group_name:   Optional[str] = None
    subgroup:     Optional[str] = None
    boltz_job_id: Optional[str] = None

# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["entries"])

@router.get("/entries")
def list_entries(group: str = "", limit: int = 50, offset: int = 0):
    with get_db() as conn:
        if group:
            rows = conn.execute(
                "SELECT * FROM entries WHERE group_name=? ORDER BY date DESC, created DESC LIMIT ? OFFSET ?",
                (group, limit, offset)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM entries WHERE group_name=?", (group,)).fetchone()[0]
        else:
            rows = conn.execute(
                "SELECT * FROM entries ORDER BY date DESC, created DESC LIMIT ? OFFSET ?",
                (limit, offset)).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    return {"entries": [dict(r) for r in rows], "total": total}

@router.get("/entries/{entry_id}")
def get_entry(entry_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)

@router.post("/entries")
async def create_entry(body: CreateEntry):
    now = datetime.utcnow().isoformat()
    date = body.date or datetime.utcnow().strftime("%Y-%m-%d")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,todo_task_id,boltz_job_id,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, body.group_name, body.subgroup, date,
             body.notes, body.results, body.yields, body.issues,
             body.todo_task_id, body.boltz_job_id, now, now))
        conn.commit()
        entry = dict(conn.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)).fetchone())
    return entry

@router.put("/entries/{entry_id}")
async def update_entry(entry_id: int, body: UpdateEntry):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        e = dict(row)
        if body.title        is not None: e["title"]        = body.title
        if body.notes        is not None: e["notes"]        = body.notes
        if body.results      is not None: e["results"]      = body.results
        if body.yields       is not None: e["yields"]       = body.yields
        if body.issues       is not None: e["issues"]       = body.issues
        if body.date         is not None: e["date"]         = body.date
        if body.group_name   is not None: e["group_name"]   = body.group_name
        if body.subgroup     is not None: e["subgroup"]     = body.subgroup
        if body.boltz_job_id is not None: e["boltz_job_id"] = body.boltz_job_id
        e["updated"] = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE entries SET title=?,notes=?,results=?,yields=?,issues=?,date=?,group_name=?,subgroup=?,boltz_job_id=?,updated=? WHERE id=?",
            (e["title"], e["notes"], e["results"], e["yields"], e["issues"],
             e["date"], e["group_name"], e["subgroup"], e["boltz_job_id"], e["updated"], entry_id))
        conn.commit()
    return e

@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
        conn.commit()
    return {"deleted": entry_id}

@router.delete("/entries/group/{group_name}")
def delete_group_entries(group_name: str):
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM entries WHERE group_name=?", (group_name,)).fetchone()[0]
        conn.execute("DELETE FROM entries WHERE group_name=?", (group_name,))
        conn.commit()
    return {"deleted_group": group_name, "count": count}

# ── Images ────────────────────────────────────────────────────────────────────

@router.get("/entries/{entry_id}/images")
def get_entry_images(entry_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, entry_id, filename, media_type, created FROM entry_images WHERE entry_id=? ORDER BY created ASC",
            (entry_id,)).fetchall()
    return {"images": [dict(r) for r in rows]}

@router.get("/entry-images/{image_id}/raw")
def get_entry_image_raw(image_id: int):
    from fastapi.responses import Response
    with get_db() as conn:
        row = conn.execute("SELECT image_data, media_type, filename FROM entry_images WHERE id=?", (image_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    img_bytes = base64.b64decode(row["image_data"])
    return Response(content=img_bytes, media_type=row["media_type"])

@router.post("/entries/{entry_id}/images")
async def upload_entry_image(entry_id: int, file: UploadFile = File(...)):
    content = await file.read()
    b64 = base64.b64encode(content).decode()
    fname = file.filename or "image"
    fl = fname.lower()
    if fl.endswith(".png"):               mt = "image/png"
    elif fl.endswith((".jpg", ".jpeg")):   mt = "image/jpeg"
    elif fl.endswith(".gif"):              mt = "image/gif"
    else:                                  mt = "image/png"
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO entry_images (entry_id,filename,image_data,media_type,created) VALUES (?,?,?,?,?)",
            (entry_id, fname, b64, mt, now))
        conn.commit()
    return {"id": cur.lastrowid, "entry_id": entry_id, "filename": fname}

@router.delete("/entry-images/{image_id}")
def delete_entry_image(image_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM entry_images WHERE id=?", (image_id,))
        conn.commit()
    return {"deleted": image_id}

# ── Summarise ─────────────────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/summarise")
async def summarise_entry(entry_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    e = dict(row)
    parts = [f"Task: {e['title']}", f"Group: {e['group_name']}/{e['subgroup']}"]
    if e["notes"]:   parts.append(f"Notes: {e['notes']}")
    if e["results"]: parts.append(f"Results: {e['results']}")
    if e["yields"]:  parts.append(f"Yields: {e['yields']}")
    if e["issues"]:  parts.append(f"Issues: {e['issues']}")
    summary = await llm(
        "\n".join(parts),
        "Summarise this lab notebook entry in 2-3 sentences. Focus on what was done, key results, and any issues. Be concise and scientific.",
        max_tokens=150
    )
    with get_db() as conn:
        conn.execute("UPDATE entries SET summary=?, updated=? WHERE id=?",
                     (summary, datetime.utcnow().isoformat(), entry_id))
        conn.commit()
    return {"summary": summary}

# ── Today dashboard ───────────────────────────────────────────────────────────

@router.get("/today")
def get_today():
    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    with get_db() as conn:
        entries = [dict(r) for r in conn.execute(
            "SELECT * FROM entries WHERE date=? ORDER BY created DESC", (today_str,)).fetchall()]
        recent = [dict(r) for r in conn.execute(
            "SELECT * FROM entries WHERE date >= date(?, '-7 days') ORDER BY date DESC, created DESC LIMIT 10",
            (today_str,)).fetchall()]
        reminders = [dict(r) for r in conn.execute(
            "SELECT * FROM reminders WHERE done=0 ORDER BY due_date ASC, created DESC").fetchall()]
        scratch_count = conn.execute("SELECT COUNT(*) FROM scratch WHERE processed=0").fetchone()[0]
        try:
            pred_count = conn.execute("SELECT COUNT(*) FROM predictions WHERE status='pending'").fetchone()[0]
        except:
            pred_count = 0
        workflow = [dict(r) for r in conn.execute(
            "SELECT * FROM workflow_entries WHERE date=? ORDER BY time ASC", (today_str,)).fetchall()]
    return {
        "date": today_str,
        "entries_today": entries,
        "recent_entries": recent,
        "reminders": reminders,
        "scratch_pending": scratch_count,
        "predictions_pending": pred_count,
        "workflow": workflow,
    }

# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def stats():
    with get_db() as conn:
        entries   = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        protocols = conn.execute("SELECT COUNT(*) FROM protocols").fetchone()[0]
        groups    = conn.execute("SELECT DISTINCT group_name FROM entries WHERE group_name != ''").fetchall()
    return {"entries": entries, "protocols": protocols,
            "groups": [r["group_name"] for r in groups]}

# ── Webhook from todo app ────────────────────────────────────────────────────

@router.post("/task-completed")
async def task_completed(body: dict):
    task_id    = body.get("task_id")
    task_text  = body.get("text", "")
    group_name = body.get("group_name", "")
    subgroup   = body.get("subgroup", "")
    date       = datetime.utcnow().strftime("%Y-%m-%d")

    skip_groups = ["Personal", "Links", "Urgent"]
    if group_name in skip_groups:
        return {"created": False, "reason": "skipped group"}

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM entries WHERE todo_task_id=?", (task_id,)).fetchone()
        if existing:
            return {"created": False, "reason": "already exists", "entry_id": existing["id"]}

    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,todo_task_id,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (task_text, group_name, subgroup, date, "", "", "", "", task_id, now, now))
        conn.commit()
        entry = dict(conn.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)).fetchone())

    # Also add to today's workflow timeline
    with get_db() as conn:
        wf_now = datetime.utcnow().isoformat()
        wf_time = datetime.utcnow().strftime("%H:%M")
        conn.execute(
            "INSERT INTO workflow_entries (date,time,type,content,group_name,task_id,created,updated) VALUES (?,?,?,?,?,?,?,?)",
            (date, wf_time, "task_done", task_text, group_name, task_id, wf_now, wf_now))
        conn.commit()

    return {"created": True, "entry_id": entry["id"], "entry": entry}
