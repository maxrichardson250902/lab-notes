"""Daily workflow feature — timeline of daily notes and task completions."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import json, re

from core.database import register_table, get_db
from core.ssh import (enrich_running, elog, ensure_pc_online, start_llm,
                      call_llm_3090, ssh_run)
import core.ssh as _ssh

register_table("workflow_entries", """CREATE TABLE IF NOT EXISTS workflow_entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    time      TEXT NOT NULL,
    type      TEXT NOT NULL DEFAULT 'note',
    content   TEXT NOT NULL,
    group_name TEXT DEFAULT NULL,
    task_id   INTEGER DEFAULT NULL,
    created   TEXT NOT NULL,
    updated   TEXT NOT NULL)""")

register_table("day_summaries", """CREATE TABLE IF NOT EXISTS day_summaries (
    date      TEXT PRIMARY KEY,
    summary   TEXT NOT NULL DEFAULT '',
    updated   TEXT NOT NULL)""")

class AddWorkflowEntry(BaseModel):
    date:       Optional[str] = None
    time:       Optional[str] = None
    type:       str = "note"
    content:    str
    group_name: Optional[str] = None
    task_id:    Optional[int] = None

class UpdateWorkflowEntry(BaseModel):
    content:    Optional[str] = None
    group_name: Optional[str] = None

router = APIRouter(prefix="/api", tags=["workflow"])

@router.get("/workflow/{date}")
def get_workflow(date: str):
    with get_db() as conn:
        entries = [dict(r) for r in conn.execute(
            "SELECT * FROM workflow_entries WHERE date=? ORDER BY time ASC, created ASC",
            (date,)).fetchall()]
        summary = conn.execute(
            "SELECT summary FROM day_summaries WHERE date=?", (date,)).fetchone()
    return {
        "date": date,
        "entries": entries,
        "summary": summary["summary"] if summary else None
    }

@router.get("/workflow")
def list_workflow_dates():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT date FROM workflow_entries ORDER BY date DESC LIMIT 30"
        ).fetchall()
    return {"dates": [r["date"] for r in rows]}

@router.post("/workflow")
def add_workflow_entry(body: AddWorkflowEntry):
    now = datetime.utcnow().isoformat()
    date = body.date or datetime.utcnow().strftime("%Y-%m-%d")
    time_ = body.time or datetime.utcnow().strftime("%H:%M")
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO workflow_entries (date,time,type,content,group_name,task_id,created,updated) VALUES (?,?,?,?,?,?,?,?)",
            (date, time_, body.type, body.content, body.group_name, body.task_id, now, now))
        conn.commit()
        entry = dict(conn.execute("SELECT * FROM workflow_entries WHERE id=?", (cur.lastrowid,)).fetchone())
    return entry

@router.put("/workflow/{entry_id}")
def update_workflow_entry(entry_id: int, body: UpdateWorkflowEntry):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM workflow_entries WHERE id=?", (entry_id,)).fetchone()
        if not row: raise HTTPException(404, "Not found")
        e = dict(row)
        if body.content    is not None: e["content"]    = body.content
        if body.group_name is not None: e["group_name"] = body.group_name
        conn.execute("UPDATE workflow_entries SET content=?,group_name=?,updated=? WHERE id=?",
                     (e["content"], e["group_name"], now, entry_id))
        conn.commit()
    return e

@router.delete("/workflow/{entry_id}")
def delete_workflow_entry(entry_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM workflow_entries WHERE id=?", (entry_id,))
        conn.commit()
    return {"deleted": entry_id}

@router.post("/workflow/process-day")
async def process_workflow_day(body: dict):
    date = body.get("date", datetime.utcnow().strftime("%Y-%m-%d"))
    if _ssh.enrich_running:
        return {"error": "Enrichment already running"}

    with get_db() as conn:
        entries = [dict(r) for r in conn.execute(
            "SELECT * FROM workflow_entries WHERE date=? ORDER BY time ASC", (date,)).fetchall()]
    if not entries:
        return {"error": "No workflow entries for this day"}

    _ssh.enrich_running = True
    created = []
    try:
        elog(f"Processing workflow for {date}...")
        if not ensure_pc_online():
            return {"error": "3090 offline"}
        if not start_llm():
            return {"error": "LLM failed to start"}

        by_group = {}
        for e in entries:
            g = e.get("group_name") or "General"
            by_group.setdefault(g, []).append(e)

        for group, notes in by_group.items():
            notes_text = "\n".join(
                f"[{n['time']}] {'[TASK DONE] ' if n['type']=='task_done' else ''}{n['content']}"
                for n in notes
            )
            try:
                result = call_llm_3090(
                    "You are a lab notebook formatter. Take these rough daily workflow notes "
                    "and format them into a structured notebook entry. "
                    "Reply in JSON: {\"title\":\"short title\",\"notes\":\"formatted notes\","
                    "\"results\":\"any results/data mentioned\",\"issues\":\"any problems mentioned\"}. "
                    "Keep the original detail. Put most content in notes. "
                    "Only fill results/issues if clearly relevant. Reply JSON only.",
                    f"Date: {date}\nProject: {group}\n\nWorkflow notes:\n{notes_text}",
                    max_tokens=500
                )
                match = re.search(r'\{.*\}', result, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    now = datetime.utcnow().isoformat()
                    with get_db() as conn:
                        cur = conn.execute(
                            "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (data.get("title", f"Workflow {date}"), group, "Notes",
                             date, str(data.get("notes", "")), str(data.get("results", "")), "",
                             str(data.get("issues", "")), now, now))
                        conn.commit()
                        created.append({"id": cur.lastrowid, "group": group, "title": data.get("title", "")})
            except Exception as e:
                elog(f"  Process workflow for {group} failed: {e}")

        ssh_run("pkill -f llama_cpp.server", check=False)
        elog(f"Processed workflow into {len(created)} entries")
    except Exception as e:
        elog(f"Workflow processing failed: {e}")
    finally:
        _ssh.enrich_running = False

    return {"created": created, "count": len(created)}

@router.post("/workflow/task-done")
def workflow_task_done(body: dict):
    now = datetime.utcnow().isoformat()
    date = datetime.utcnow().strftime("%Y-%m-%d")
    time_ = datetime.utcnow().strftime("%H:%M")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO workflow_entries (date,time,type,content,group_name,task_id,created,updated) VALUES (?,?,?,?,?,?,?,?)",
            (date, time_, "task_done", body.get("text", ""), body.get("group_name", ""),
             body.get("task_id"), now, now))
        conn.commit()
    return {"added": True}
