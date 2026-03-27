"""Daily workflow feature — timeline of daily notes and task completions."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import json, re, uuid, threading

from core.database import register_table, get_db
from core.ssh import (elog, ensure_pc_online, start_llm,
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

# ── Job tracking in SQLite (works across --workers 4) ────────────────────────
register_table("process_day_jobs", """CREATE TABLE IF NOT EXISTS process_day_jobs (
    job_id    TEXT PRIMARY KEY,
    status    TEXT NOT NULL DEFAULT 'running',
    phase     TEXT NOT NULL DEFAULT 'starting',
    stage     TEXT NOT NULL DEFAULT 'Starting...',
    progress  INTEGER NOT NULL DEFAULT 0,
    total     INTEGER NOT NULL DEFAULT 0,
    date      TEXT NOT NULL,
    results   TEXT NOT NULL DEFAULT '[]',
    errors    TEXT NOT NULL DEFAULT '[]',
    created   TEXT NOT NULL,
    updated   TEXT NOT NULL)""")


def _set_job(job_id: str, **kwargs):
    """Update job fields in SQLite. results/errors are stored as JSON strings."""
    if "results" in kwargs:
        kwargs["results"] = json.dumps(kwargs["results"])
    if "errors" in kwargs:
        kwargs["errors"] = json.dumps(kwargs["errors"])
    kwargs["updated"] = datetime.utcnow().isoformat()
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [job_id]
    try:
        with get_db() as conn:
            conn.execute(f"UPDATE process_day_jobs SET {sets} WHERE job_id=?", vals)
            conn.commit()
    except Exception as e:
        elog(f"[job {job_id[:8]}] Failed to update job state: {e}")


def _get_job(job_id: str) -> dict | None:
    """Read job from SQLite. Returns dict or None."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM process_day_jobs WHERE job_id=?", (job_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    try:
        d["results"] = json.loads(d.get("results", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["results"] = []
    try:
        d["errors"] = json.loads(d.get("errors", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["errors"] = []
    return d


def _create_job(job_id: str, date: str):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO process_day_jobs (job_id,status,phase,stage,progress,total,date,results,errors,created,updated) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (job_id, "running", "starting", "Starting...", 0, 0, date, "[]", "[]", now, now))
        conn.commit()


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


# ── Process Day — background worker ─────────────────────────────────────────

def _process_day_worker(job_id: str, date: str, entries: list[dict]):
    """Runs in a background thread. Updates job state in SQLite as it progresses."""
    _ssh.enrich_running = True
    try:
        # ── Wake 3090 ────────────────────────────────────────────────────
        _set_job(job_id, phase="waking", stage="Sending wake-on-LAN to 3090...")
        elog(f"[job {job_id[:8]}] Processing workflow for {date}...")
        if not ensure_pc_online():
            _set_job(job_id, status="failed", phase="waking", stage="3090 is offline — could not wake it after timeout")
            return
        _set_job(job_id, phase="waking_done", stage="3090 is online")

        # ── Start LLM ───────────────────────────────────────────────────
        _set_job(job_id, phase="llm_starting", stage="Starting LLM on 3090...")
        if not start_llm():
            _set_job(job_id, status="failed", phase="llm_starting", stage="LLM failed to start on 3090")
            return
        _set_job(job_id, phase="llm_ready", stage="LLM is ready")

        # ── Group entries ────────────────────────────────────────────────
        by_group: dict[str, list[dict]] = {}
        for e in entries:
            g = e.get("group_name") or "General"
            by_group.setdefault(g, []).append(e)

        group_names = list(by_group.keys())
        total = len(group_names)
        created = []
        errors = []

        for idx, group in enumerate(group_names):
            _set_job(job_id, phase="processing", stage=f"Processing {group}...", progress=idx, total=total)

            notes = by_group[group]
            notes_text = "\n".join(
                f"[{n['time']}] {'[TASK DONE] ' if n['type']=='task_done' else ''}{n['content']}"
                for n in notes
            )

            # ── Call LLM with retry ──────────────────────────────────────
            last_err = None
            result_data = None
            for attempt in range(3):
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
                        result_data = json.loads(match.group())
                        break
                    else:
                        last_err = f"LLM returned no JSON (attempt {attempt + 1})"
                        elog(f"  {group}: {last_err}")
                except json.JSONDecodeError as e:
                    last_err = f"Malformed JSON from LLM (attempt {attempt + 1}): {e}"
                    elog(f"  {group}: {last_err}")
                except Exception as e:
                    last_err = f"LLM call failed (attempt {attempt + 1}): {e}"
                    elog(f"  {group}: {last_err}")

            if result_data is None:
                errors.append({"group": group, "error": last_err or "Unknown error after 3 attempts"})
                continue

            # ── Insert entry — wrap every field in str() ─────────────────
            try:
                now = datetime.utcnow().isoformat()
                title = str(result_data.get("title", "")) or f"Workflow {date}"
                with get_db() as conn:
                    cur = conn.execute(
                        "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (title, group, "Notes", date,
                         str(result_data.get("notes", "")),
                         str(result_data.get("results", "")),
                         "",
                         str(result_data.get("issues", "")),
                         now, now))
                    conn.commit()
                    created.append({"id": cur.lastrowid, "group": group, "title": title})
            except Exception as e:
                errors.append({"group": group, "error": f"DB insert failed: {e}"})
                elog(f"  {group}: DB insert failed: {e}")

        # ── Cleanup ──────────────────────────────────────────────────────
        ssh_run("pkill -f llama_cpp.server", check=False)
        elog(f"[job {job_id[:8]}] Processed workflow into {len(created)} entries ({len(errors)} errors)")

        _set_job(job_id,
                 status="done", phase="done",
                 stage=f"Done — {len(created)} entries created",
                 progress=total, total=total,
                 results=created, errors=errors)

    except Exception as e:
        elog(f"[job {job_id[:8]}] Workflow processing failed: {e}")
        _set_job(job_id, status="failed", phase="failed", stage=f"Unexpected error: {e}")
    finally:
        _ssh.enrich_running = False


@router.post("/workflow/process-day")
def process_workflow_day(body: dict):
    """Kicks off background processing and returns a job ID immediately."""
    date = body.get("date", datetime.utcnow().strftime("%Y-%m-%d"))

    # Check if a job is already running (in SQLite, visible to all workers)
    with get_db() as conn:
        running = conn.execute(
            "SELECT job_id, created FROM process_day_jobs WHERE status='running' LIMIT 1"
        ).fetchone()
    if running:
        return {"error": f"A job is already running (started {running['created']})",
                "job_id": running["job_id"]}

    with get_db() as conn:
        entries = [dict(r) for r in conn.execute(
            "SELECT * FROM workflow_entries WHERE date=? ORDER BY time ASC", (date,)).fetchall()]
    if not entries:
        return {"error": "No workflow entries for this date"}

    job_id = uuid.uuid4().hex[:12]
    _create_job(job_id, date)

    thread = threading.Thread(target=_process_day_worker, args=(job_id, date, entries), daemon=True)
    thread.start()

    return {"job_id": job_id}


@router.get("/workflow/process-day/{job_id}")
def process_day_status(job_id: str):
    """Poll this endpoint to get progress updates. Any worker can serve this."""
    job = _get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/workflow/process-day/reset")
def process_day_reset():
    """Emergency reset: clears the enrich_running flag and marks running jobs as failed."""
    _ssh.enrich_running = False
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "UPDATE process_day_jobs SET status='failed', stage='Manually reset by user', updated=? "
            "WHERE status='running'", (now,))
        conn.commit()
    elog("Process-day reset: cleared flag, failed all running jobs in DB")
    return {"reset": True}


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
