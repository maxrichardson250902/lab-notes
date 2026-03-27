"""Pipeline — Experimental pipeline dependency graph builder."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from core.database import register_table, get_db

register_table("pipelines", """CREATE TABLE IF NOT EXISTS pipelines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

register_table("pipeline_steps", """CREATE TABLE IF NOT EXISTS pipeline_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,
    name        TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    protocol_id INTEGER,
    pos_x       REAL NOT NULL DEFAULT 100,
    pos_y       REAL NOT NULL DEFAULT 100,
    status      TEXT NOT NULL DEFAULT 'pending',
    created     TEXT NOT NULL)""")

register_table("pipeline_edges", """CREATE TABLE IF NOT EXISTS pipeline_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,
    from_step   INTEGER NOT NULL,
    to_step     INTEGER NOT NULL,
    created     TEXT NOT NULL)""")


class CreatePipeline(BaseModel):
    name: str
    description: str = ''

class UpdatePipeline(BaseModel):
    name: str
    description: str = ''

class CreateStep(BaseModel):
    name: str
    notes: str = ''
    protocol_id: Optional[int] = None
    pos_x: float = 100.0
    pos_y: float = 100.0

class UpdateStep(BaseModel):
    name: str
    notes: str = ''
    protocol_id: Optional[int] = None
    pos_x: float = 100.0
    pos_y: float = 100.0

class UpdatePos(BaseModel):
    pos_x: float
    pos_y: float

class CreateEdge(BaseModel):
    from_step: int
    to_step: int


router = APIRouter(prefix="/api", tags=["pipeline"])


@router.get("/pipelines")
def list_pipelines():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM pipelines ORDER BY updated DESC").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/pipelines")
def create_pipeline(body: CreatePipeline):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO pipelines (name, description, created, updated) VALUES (?,?,?,?)",
            (body.name, body.description, now, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM pipelines WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.get("/pipelines/{pid}")
def get_pipeline(pid: int):
    with get_db() as conn:
        p = conn.execute("SELECT * FROM pipelines WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "Not found")
        steps = conn.execute(
            "SELECT * FROM pipeline_steps WHERE pipeline_id=? ORDER BY created", (pid,)).fetchall()
        edges = conn.execute(
            "SELECT * FROM pipeline_edges WHERE pipeline_id=?", (pid,)).fetchall()
    return {
        "pipeline": dict(p),
        "steps": [dict(s) for s in steps],
        "edges": [dict(e) for e in edges]
    }


@router.put("/pipelines/{pid}")
def update_pipeline(pid: int, body: UpdatePipeline):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "UPDATE pipelines SET name=?, description=?, updated=? WHERE id=?",
            (body.name, body.description, now, pid))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM pipelines WHERE id=?", (pid,)).fetchone())
    return row


@router.delete("/pipelines/{pid}")
def delete_pipeline(pid: int):
    with get_db() as conn:
        # Also remove linked reminders
        step_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM pipeline_steps WHERE pipeline_id=?", (pid,)).fetchall()]
        if step_ids:
            ph = ",".join("?" * len(step_ids))
            conn.execute(
                f"DELETE FROM reminders WHERE pipeline_step_id IN ({ph})", step_ids)
        conn.execute("DELETE FROM pipeline_edges WHERE pipeline_id=?", (pid,))
        conn.execute("DELETE FROM pipeline_steps WHERE pipeline_id=?", (pid,))
        conn.execute("DELETE FROM pipelines WHERE id=?", (pid,))
        conn.commit()
    return {"ok": True}


@router.post("/pipelines/{pid}/steps")
def add_step(pid: int, body: CreateStep):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO pipeline_steps (pipeline_id, name, notes, protocol_id, pos_x, pos_y, created) VALUES (?,?,?,?,?,?,?)",
            (pid, body.name, body.notes, body.protocol_id, body.pos_x, body.pos_y, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM pipeline_steps WHERE id=?", (cur.lastrowid,)).fetchone())
    _touch(pid)
    return row


@router.put("/pipelines/{pid}/steps/{sid}")
def update_step(pid: int, sid: int, body: UpdateStep):
    with get_db() as conn:
        conn.execute(
            "UPDATE pipeline_steps SET name=?, notes=?, protocol_id=?, pos_x=?, pos_y=? WHERE id=? AND pipeline_id=?",
            (body.name, body.notes, body.protocol_id, body.pos_x, body.pos_y, sid, pid))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM pipeline_steps WHERE id=?", (sid,)).fetchone())
        # If this step has a linked reminder, update its text too
        conn.execute(
            "UPDATE reminders SET text=? WHERE pipeline_step_id=?", (body.name, sid))
        conn.commit()
    return row


@router.delete("/pipelines/{pid}/steps/{sid}")
def delete_step(pid: int, sid: int):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM pipeline_edges WHERE pipeline_id=? AND (from_step=? OR to_step=?)",
            (pid, sid, sid))
        conn.execute("DELETE FROM pipeline_steps WHERE id=? AND pipeline_id=?", (sid, pid))
        # Remove linked reminder
        conn.execute("DELETE FROM reminders WHERE pipeline_step_id=?", (sid,))
        conn.commit()
    return {"ok": True}


@router.patch("/pipelines/{pid}/steps/{sid}/pos")
def update_pos(pid: int, sid: int, body: UpdatePos):
    with get_db() as conn:
        conn.execute(
            "UPDATE pipeline_steps SET pos_x=?, pos_y=? WHERE id=? AND pipeline_id=?",
            (body.pos_x, body.pos_y, sid, pid))
        conn.commit()
    return {"ok": True}


@router.post("/pipelines/{pid}/edges")
def add_edge(pid: int, body: CreateEdge):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM pipeline_edges WHERE pipeline_id=? AND from_step=? AND to_step=?",
            (pid, body.from_step, body.to_step)).fetchone()
        if existing:
            return dict(existing)
        cur = conn.execute(
            "INSERT INTO pipeline_edges (pipeline_id, from_step, to_step, created) VALUES (?,?,?,?)",
            (pid, body.from_step, body.to_step, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM pipeline_edges WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.delete("/pipelines/{pid}/edges/{eid}")
def delete_edge(pid: int, eid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM pipeline_edges WHERE id=? AND pipeline_id=?", (eid, pid))
        conn.commit()
    return {"ok": True}


# ── Sync to reminders ─────────────────────────────────────────────────────────

@router.post("/pipelines/{pid}/sync-reminders")
def sync_reminders(pid: int):
    """Create reminders for all steps that don't already have one.
    Uses pipeline.name as group_name. Idempotent — skips steps already linked."""
    with get_db() as conn:
        p = conn.execute("SELECT * FROM pipelines WHERE id=?", (pid,)).fetchone()
        if not p:
            raise HTTPException(404, "Pipeline not found")
        steps = conn.execute(
            "SELECT * FROM pipeline_steps WHERE pipeline_id=? ORDER BY created", (pid,)).fetchall()

        # Find which steps already have linked reminders
        step_ids = [s["id"] for s in steps]
        existing = set()
        if step_ids:
            ph = ",".join("?" * len(step_ids))
            rows = conn.execute(
                f"SELECT pipeline_step_id FROM reminders WHERE pipeline_step_id IN ({ph})",
                step_ids).fetchall()
            existing = set(r["pipeline_step_id"] for r in rows)

        now = datetime.utcnow().isoformat()
        created = 0
        for s in steps:
            if s["id"] in existing:
                continue
            conn.execute(
                "INSERT INTO reminders (text,due_date,done,source,group_name,pipeline_step_id,created) "
                "VALUES (?,NULL,?,?,?,?,?)",
                (s["name"], 1 if (s.get("status") or "pending") == "done" else 0,
                 "pipeline", p["name"], s["id"], now))
            created += 1
        conn.commit()

    return {"synced": created, "total_steps": len(steps), "group_name": p["name"]}


@router.get("/pipeline/protocols")
def get_protocols():
    """Fetch protocol titles for linking to steps."""
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT id, title FROM protocols ORDER BY title").fetchall()
        return {"items": [dict(r) for r in rows]}
    except Exception:
        return {"items": []}


def _touch(pid):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute("UPDATE pipelines SET updated=? WHERE id=?", (now, pid))
        conn.commit()
