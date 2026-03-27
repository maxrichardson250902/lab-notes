"""Reminders feature — project-aware todo list with pipeline + workflow integration."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date
from core.database import register_table, get_db

register_table("reminders", """CREATE TABLE IF NOT EXISTS reminders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    text             TEXT NOT NULL,
    due_date         TEXT DEFAULT NULL,
    done             INTEGER NOT NULL DEFAULT 0,
    source           TEXT DEFAULT NULL,
    group_name       TEXT DEFAULT NULL,
    pipeline_step_id INTEGER DEFAULT NULL,
    created          TEXT NOT NULL)""")


class AddReminder(BaseModel):
    text:             str
    due_date:         Optional[str] = None
    source:           str = "manual"
    group_name:       Optional[str] = None
    pipeline_step_id: Optional[int] = None


router = APIRouter(prefix="/api", tags=["reminders"])


@router.get("/reminders")
def get_reminders(include_done: bool = False, group: str = None):
    with get_db() as conn:
        clauses = []
        params = []
        if not include_done:
            clauses.append("done=0")
        if group:
            clauses.append("group_name=?")
            params.append(group)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        rows = conn.execute(
            f"SELECT * FROM reminders {where} ORDER BY due_date ASC, created DESC",
            params).fetchall()
        reminders = [dict(r) for r in rows]

        # Compute blocked status for pipeline-linked reminders
        _annotate_blocked(conn, reminders)

    return {"reminders": reminders}


@router.get("/reminders/groups")
def get_reminder_groups():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT group_name FROM reminders "
            "WHERE group_name IS NOT NULL AND group_name != '' "
            "ORDER BY group_name").fetchall()
    return {"groups": [r["group_name"] for r in rows]}


@router.post("/reminders")
def add_reminder(body: AddReminder):
    now = datetime.utcnow().isoformat()
    gn = body.group_name.strip() if body.group_name else None
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (text,due_date,done,source,group_name,pipeline_step_id,created) "
            "VALUES (?,?,0,?,?,?,?)",
            (body.text, body.due_date, body.source, gn, body.pipeline_step_id, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM reminders WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.put("/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: dict):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        r = dict(row)
        was_done = r["done"]
        if "done"             in body: r["done"]             = int(body["done"])
        if "text"             in body: r["text"]             = body["text"]
        if "due_date"         in body: r["due_date"]         = body["due_date"]
        if "group_name"       in body:
            gn = body["group_name"]
            r["group_name"] = gn.strip() if gn else None
        if "pipeline_step_id" in body: r["pipeline_step_id"] = body["pipeline_step_id"]

        conn.execute(
            "UPDATE reminders SET text=?,due_date=?,done=?,group_name=?,pipeline_step_id=? WHERE id=?",
            (r["text"], r["due_date"], r["done"], r.get("group_name"),
             r.get("pipeline_step_id"), reminder_id))
        conn.commit()

        # Sync pipeline step status when toggling done
        workflow_created = False
        if r["done"] and not was_done:
            if r.get("pipeline_step_id"):
                _mark_step_status(conn, r["pipeline_step_id"], "done")
            if r.get("group_name"):
                _create_workflow_entry(conn, r["text"], r["group_name"])
                workflow_created = True
        elif not r["done"] and was_done:
            if r.get("pipeline_step_id"):
                _mark_step_status(conn, r["pipeline_step_id"], "pending")

    r["workflow_created"] = workflow_created
    return r


@router.delete("/reminders/{reminder_id}")
def delete_reminder(reminder_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
        conn.commit()
    return {"deleted": reminder_id}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _annotate_blocked(conn, reminders):
    """Add 'blocked' and 'blocked_by' fields to pipeline-linked reminders."""
    step_ids = [r["pipeline_step_id"] for r in reminders if r.get("pipeline_step_id")]
    if not step_ids:
        for r in reminders:
            r["blocked"] = False
            r["blocked_by"] = []
        return

    placeholders = ",".join("?" * len(step_ids))

    # Get incoming edges for these steps
    edges = conn.execute(
        f"SELECT to_step, from_step FROM pipeline_edges WHERE to_step IN ({placeholders})",
        step_ids).fetchall()

    # Collect all upstream step ids
    upstream_ids = list(set(e["from_step"] for e in edges))

    # Get upstream step statuses and names
    status_map = {}
    name_map = {}
    if upstream_ids:
        up_ph = ",".join("?" * len(upstream_ids))
        ups = conn.execute(
            f"SELECT id, name, status FROM pipeline_steps WHERE id IN ({up_ph})",
            upstream_ids).fetchall()
        for u in ups:
            status_map[u["id"]] = u["status"] or "pending"
            name_map[u["id"]] = u["name"]

    # Build deps map: step_id -> [upstream_step_ids]
    deps = {}
    for e in edges:
        deps.setdefault(e["to_step"], []).append(e["from_step"])

    # Annotate each reminder
    for r in reminders:
        sid = r.get("pipeline_step_id")
        if not sid or sid not in deps:
            r["blocked"] = False
            r["blocked_by"] = []
            continue
        undone = [uid for uid in deps[sid] if status_map.get(uid, "pending") != "done"]
        r["blocked"] = len(undone) > 0
        r["blocked_by"] = [name_map.get(uid, "?") for uid in undone]


def _mark_step_status(conn, step_id, status):
    """Update a pipeline step's status."""
    try:
        conn.execute("UPDATE pipeline_steps SET status=? WHERE id=?", (status, step_id))
        conn.commit()
    except Exception:
        pass


def _create_workflow_entry(conn, text, group_name):
    """Insert a task_done entry into workflow_entries."""
    today = date.today().isoformat()
    now_time = datetime.now().strftime("%H:%M")
    now_iso = datetime.now().isoformat()
    conn.execute(
        "INSERT INTO workflow_entries (date, time, type, content, group_name, created, updated) "
        "VALUES (?,?,?,?,?,?,?)",
        (today, now_time, "task_done", text, group_name, now_iso, now_iso))
    conn.commit()
