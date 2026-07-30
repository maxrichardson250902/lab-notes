"""Reminders feature — project-aware todo list with pipeline + workflow integration.

Schema additions (May 2026):
- priority: TEXT, one of 'high'/'med'/'low', default 'med'
- notes:    TEXT, optional longer-form details

Both added via core.database.ensure_column so existing DBs migrate on startup
without data loss. New rows default priority to 'med'.

The view exposed on the frontend is titled 'Todos' (kanban) — endpoint paths
stay /api/reminders to avoid breaking other features (workflow's task_done
sync, pipeline's blocked-by lookup) that reference the same table.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta
from core.database import register_table, get_db, register_seed, ensure_column

register_table("reminders", """CREATE TABLE IF NOT EXISTS reminders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    text             TEXT NOT NULL,
    due_date         TEXT DEFAULT NULL,
    done             INTEGER NOT NULL DEFAULT 0,
    source           TEXT DEFAULT NULL,
    group_name       TEXT DEFAULT NULL,
    pipeline_step_id INTEGER DEFAULT NULL,
    priority         TEXT NOT NULL DEFAULT 'med',
    notes            TEXT DEFAULT NULL,
    created          TEXT NOT NULL)""")


def _migrate_reminders(conn):
    """Add priority + notes columns to existing reminders tables. Safe on first
    run too — ensure_column is idempotent (checks PRAGMA table_info first)."""
    ensure_column(conn, "reminders", "priority", "TEXT NOT NULL DEFAULT 'med'")
    ensure_column(conn, "reminders", "notes",    "TEXT DEFAULT NULL")


register_seed(_migrate_reminders)


VALID_PRIORITIES = {"high", "med", "low"}


class AddReminder(BaseModel):
    text:             str
    due_date:         Optional[str] = None
    source:           str = "manual"
    group_name:       Optional[str] = None
    pipeline_step_id: Optional[int] = None
    priority:         Optional[str] = "med"
    notes:            Optional[str] = None


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
        # Order: priority high→low, then due date asc (NULLs last), then created desc.
        # CASE expression maps text priorities to a sortable number.
        rows = conn.execute(
            f"""SELECT * FROM reminders {where}
                ORDER BY
                  CASE priority WHEN 'high' THEN 0 WHEN 'med' THEN 1 WHEN 'low' THEN 2 ELSE 1 END ASC,
                  CASE WHEN due_date IS NULL OR due_date='' THEN 1 ELSE 0 END ASC,
                  due_date ASC,
                  created DESC""",
            params).fetchall()
        reminders = [dict(r) for r in rows]

        # Compute blocked status for pipeline-linked reminders
        _annotate_blocked(conn, reminders)

    return {"reminders": reminders}


@router.get("/reminders/due-today")
def get_reminders_due_today():
    """Reminders that should appear in the daily check-in popup.
    Criteria: not done AND (due_date IS NOT NULL AND due_date <= today).
    Includes overdue items — they need attention more than just-today ones."""
    today = date.today().isoformat()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM reminders
               WHERE done = 0
                 AND due_date IS NOT NULL
                 AND due_date != ''
                 AND due_date <= ?
               ORDER BY due_date ASC,
                        CASE priority WHEN 'high' THEN 0 WHEN 'med' THEN 1 WHEN 'low' THEN 2 ELSE 1 END ASC""",
            (today,)).fetchall()
        reminders = [dict(r) for r in rows]
        _annotate_blocked(conn, reminders)

    # Tag each with 'overdue' / 'today' for the frontend to render differently
    for r in reminders:
        r["urgency"] = "overdue" if r["due_date"] < today else "today"

    return {"reminders": reminders, "today": today}


@router.get("/reminders/dependencies")
def get_reminder_dependencies():
    """Return edges between reminders that share a pipeline dependency.
    Result: [{from_id, to_id}] where both ids are reminder ids linked via
    pipeline_step_id and their steps are connected in pipeline_edges.
    Used by the kanban 'show deps' overlay to draw arrows between cards."""
    with get_db() as conn:
        rems = conn.execute(
            "SELECT id, pipeline_step_id FROM reminders "
            "WHERE done=0 AND pipeline_step_id IS NOT NULL").fetchall()
        if not rems:
            return {"edges": []}
        # step_id -> [reminder_ids] (one step may have multiple linked reminders)
        step_to_rems = {}
        step_ids = []
        for r in rems:
            sid = r["pipeline_step_id"]
            step_ids.append(sid)
            step_to_rems.setdefault(sid, []).append(r["id"])
        # Fetch edges for these steps. Both endpoints must be in step_ids
        # (we only draw arrows visible on the current board).
        ph = ",".join("?" * len(step_ids))
        try:
            edges = conn.execute(
                f"SELECT from_step, to_step FROM pipeline_edges "
                f"WHERE from_step IN ({ph}) AND to_step IN ({ph})",
                step_ids + step_ids).fetchall()
        except Exception:
            return {"edges": []}
        out = []
        for e in edges:
            for fid in step_to_rems.get(e["from_step"], []):
                for tid in step_to_rems.get(e["to_step"], []):
                    out.append({"from_id": fid, "to_id": tid})
    return {"edges": out}


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
    prio = (body.priority or "med").lower()
    if prio not in VALID_PRIORITIES:
        prio = "med"
    notes = body.notes.strip() if body.notes else None
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (text,due_date,done,source,group_name,pipeline_step_id,priority,notes,created) "
            "VALUES (?,?,0,?,?,?,?,?,?)",
            (body.text, body.due_date, body.source, gn, body.pipeline_step_id, prio, notes, now))
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
        if "priority"         in body:
            p = (body["priority"] or "med").lower()
            r["priority"] = p if p in VALID_PRIORITIES else "med"
        if "notes"            in body:
            n = body["notes"]
            r["notes"] = n.strip() if n else None

        conn.execute(
            "UPDATE reminders SET text=?,due_date=?,done=?,group_name=?,pipeline_step_id=?,priority=?,notes=? WHERE id=?",
            (r["text"], r["due_date"], r["done"], r.get("group_name"),
             r.get("pipeline_step_id"), r.get("priority", "med"), r.get("notes"),
             reminder_id))
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


class SnoozeReminder(BaseModel):
    days: Optional[int] = 1


@router.post("/reminders/{reminder_id}/snooze")
def snooze_reminder(reminder_id: int, body: SnoozeReminder):
    """Push due_date forward by N days. If the item has no due_date, set it to
    (today + days). Used by the popup's 'snooze 1d' button."""
    days = max(1, min(body.days or 1, 365))
    with get_db() as conn:
        row = conn.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        current = row["due_date"]
        # If no current due date, anchor from today. If overdue, also anchor
        # from today — bumping an already-past date by +1d is meaningless.
        today = date.today()
        if not current:
            base = today
        else:
            try:
                base = date.fromisoformat(current)
                if base < today:
                    base = today
            except ValueError:
                base = today
        new_due = (base + timedelta(days=days)).isoformat()
        conn.execute("UPDATE reminders SET due_date=? WHERE id=?", (new_due, reminder_id))
        conn.commit()
    return {"id": reminder_id, "due_date": new_due}


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
    try:
        edges = conn.execute(
            f"SELECT to_step, from_step FROM pipeline_edges WHERE to_step IN ({placeholders})",
            step_ids).fetchall()
    except Exception:
        # pipeline_edges may not exist on a fresh DB before pipeline feature ran.
        for r in reminders:
            r["blocked"] = False
            r["blocked_by"] = []
        return

    # Collect all upstream step ids
    upstream_ids = list(set(e["from_step"] for e in edges))

    # Get upstream step statuses and names
    status_map = {}
    name_map = {}
    if upstream_ids:
        up_ph = ",".join("?" * len(upstream_ids))
        try:
            ups = conn.execute(
                f"SELECT id, name, status FROM pipeline_steps WHERE id IN ({up_ph})",
                upstream_ids).fetchall()
            for u in ups:
                status_map[u["id"]] = u["status"] or "pending"
                name_map[u["id"]] = u["name"]
        except Exception:
            pass

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
    try:
        conn.execute(
            "INSERT INTO workflow_entries (date, time, type, content, group_name, created, updated) "
            "VALUES (?,?,?,?,?,?,?)",
            (today, now_time, "task_done", text, group_name, now_iso, now_iso))
        conn.commit()
    except Exception:
        pass
