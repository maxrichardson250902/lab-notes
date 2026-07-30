"""Project Plans feature — versioned markdown plans that show how a project
evolves over time.

Model: a `plan` is a named project plan, optionally linked to a pipeline.
Every change — whether typed in-app or uploaded from a file — appends a new
immutable row to `plan_versions`. Nothing is ever edited in place, so the
version list IS the evolution history. Diffs are computed on demand between
any two versions with difflib (no dependencies)."""
import difflib
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.database import register_table, get_db, ensure_column, register_seed
from features.plans import plan_parser

register_table("plans", """CREATE TABLE IF NOT EXISTS plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    pipeline_id INTEGER,
    status      TEXT NOT NULL DEFAULT 'idea',
    project     TEXT NOT NULL DEFAULT '',
    subproject  TEXT NOT NULL DEFAULT '',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

# Migrations for DBs created before these columns existed. Idempotent.
register_seed(lambda conn: ensure_column(conn, "plans", "status", "TEXT NOT NULL DEFAULT 'idea'"))
register_seed(lambda conn: ensure_column(conn, "plans", "project", "TEXT NOT NULL DEFAULT ''"))
register_seed(lambda conn: ensure_column(conn, "plans", "subproject", "TEXT NOT NULL DEFAULT ''"))

# Allowed workflow states for a plan.
PLAN_STATUSES = ("idea", "planned", "active", "done")

# Append-only. version_no is per-plan and monotonic. source is 'edit' | 'upload'.
register_table("plan_versions", """CREATE TABLE IF NOT EXISTS plan_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id     INTEGER NOT NULL,
    version_no  INTEGER NOT NULL,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'edit',
    note        TEXT NOT NULL DEFAULT '',
    created     TEXT NOT NULL)""")


# ── Models ────────────────────────────────────────────────────────────────────
class CreatePlan(BaseModel):
    name: str
    pipeline_id: Optional[int] = None
    status: str = "idea"
    project: str = ""
    subproject: str = ""
    content: str = ""
    note: str = ""


class AddVersion(BaseModel):
    content: str
    note: str = ""


class UpdatePlanMeta(BaseModel):
    name: Optional[str] = None
    pipeline_id: Optional[int] = None
    status: Optional[str] = None
    project: Optional[str] = None
    subproject: Optional[str] = None


router = APIRouter(prefix="/api", tags=["plans"])


def _now():
    return datetime.utcnow().isoformat()


def _next_version_no(conn, plan_id):
    row = conn.execute(
        "SELECT MAX(version_no) AS m FROM plan_versions WHERE plan_id=?",
        (plan_id,)).fetchone()
    return (row["m"] or 0) + 1


def _append_version(conn, plan_id, content, source, note):
    vno = _next_version_no(conn, plan_id)
    now = _now()
    conn.execute(
        "INSERT INTO plan_versions (plan_id, version_no, content, source, note, created) "
        "VALUES (?,?,?,?,?,?)",
        (plan_id, vno, content, source, note, now))
    conn.execute("UPDATE plans SET updated=? WHERE id=?", (now, plan_id))
    return vno


# ── Plans ─────────────────────────────────────────────────────────────────────
@router.get("/plans")
def list_plans():
    """List plans with version count, latest version no, and linked pipeline name."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*,
                   (SELECT COUNT(*) FROM plan_versions v WHERE v.plan_id=p.id) AS version_count,
                   (SELECT MAX(version_no) FROM plan_versions v WHERE v.plan_id=p.id) AS latest_version,
                   (SELECT name FROM pipelines pl WHERE pl.id=p.pipeline_id) AS pipeline_name
            FROM plans p
            ORDER BY p.updated DESC""").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/plans")
def create_plan(body: CreatePlan):
    now = _now()
    status = body.status if body.status in PLAN_STATUSES else "idea"
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO plans (name, pipeline_id, status, project, subproject, created, updated) "
            "VALUES (?,?,?,?,?,?,?)",
            (body.name, body.pipeline_id, status, body.project or "", body.subproject or "", now, now))
        plan_id = cur.lastrowid
        # First version is always recorded so the timeline starts at v1.
        _append_version(conn, plan_id, body.content, "edit", body.note or "Initial version")
        conn.commit()
        row = dict(conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone())
    return row


@router.get("/plans/project-options")
def project_options():
    """Union of project/subproject names across the app so the plan modal's
    dropdowns share the same vocabulary as the notebook and DNA store.

    Sources: notebook entries (group_name/subgroup), DNA tables
    (project/subcategory), and existing plans (project/subproject). Each source
    is wrapped in try/except so a missing table never breaks the endpoint."""
    projects = set()
    subs = {}  # project -> set(subproject)

    def _add(proj, sub):
        proj = (proj or "").strip()
        sub = (sub or "").strip()
        if not proj:
            return
        projects.add(proj)
        if sub:
            subs.setdefault(proj, set()).add(sub)

    with get_db() as conn:
        # notebook
        try:
            for r in conn.execute(
                "SELECT DISTINCT group_name, subgroup FROM entries "
                "WHERE group_name IS NOT NULL AND group_name != ''").fetchall():
                _add(r["group_name"], r["subgroup"])
        except Exception:
            pass
        # DNA tables
        for tbl in ("primers", "plasmids", "gblocks", "kit_parts", "parts"):
            try:
                for r in conn.execute(
                    f"SELECT DISTINCT project, subcategory FROM {tbl} "
                    f"WHERE project IS NOT NULL AND project != ''").fetchall():
                    _add(r["project"], r["subcategory"])
            except Exception:
                pass
        # existing plans
        try:
            for r in conn.execute(
                "SELECT DISTINCT project, subproject FROM plans "
                "WHERE project IS NOT NULL AND project != ''").fetchall():
                _add(r["project"], r["subproject"])
        except Exception:
            pass

    return {
        "projects": sorted(projects),
        "subprojects": {k: sorted(v) for k, v in subs.items()},
        "all_subprojects": sorted({s for v in subs.values() for s in v}),
    }


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int):
    """Plan metadata + full version list (newest first), without version bodies."""
    with get_db() as conn:
        p = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Plan not found")
        plan = dict(p)
        if plan.get("pipeline_id"):
            pl = conn.execute("SELECT name FROM pipelines WHERE id=?",
                              (plan["pipeline_id"],)).fetchone()
            plan["pipeline_name"] = pl["name"] if pl else None
        versions = conn.execute(
            "SELECT id, version_no, source, note, created, LENGTH(content) AS size "
            "FROM plan_versions WHERE plan_id=? ORDER BY version_no DESC",
            (plan_id,)).fetchall()
        plan["versions"] = [dict(v) for v in versions]
    return plan


@router.patch("/plans/{plan_id}")
def update_plan_meta(plan_id: int, body: UpdatePlanMeta):
    with get_db() as conn:
        p = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Plan not found")
        name = body.name if body.name is not None else p["name"]
        pid = body.pipeline_id if body.pipeline_id is not None else p["pipeline_id"]
        status = p["status"]
        if body.status is not None and body.status in PLAN_STATUSES:
            status = body.status
        project = body.project if body.project is not None else p["project"]
        subproject = body.subproject if body.subproject is not None else p["subproject"]
        conn.execute("UPDATE plans SET name=?, pipeline_id=?, status=?, project=?, subproject=?, updated=? WHERE id=?",
                     (name, pid, status, project, subproject, _now(), plan_id))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone())
    return row


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM plan_versions WHERE plan_id=?", (plan_id,))
        conn.execute("DELETE FROM plans WHERE id=?", (plan_id,))
        conn.commit()
    return {"ok": True}


# ── Versions ──────────────────────────────────────────────────────────────────
@router.get("/plans/{plan_id}/versions/{version_id}")
def get_version(plan_id: int, version_id: int):
    with get_db() as conn:
        v = conn.execute(
            "SELECT * FROM plan_versions WHERE id=? AND plan_id=?",
            (version_id, plan_id)).fetchone()
        if not v:
            raise HTTPException(404, "Version not found")
    return dict(v)


@router.post("/plans/{plan_id}/versions")
def add_version(plan_id: int, body: AddVersion):
    """Append a new version from an in-app edit."""
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM plans WHERE id=?", (plan_id,)).fetchone():
            raise HTTPException(404, "Plan not found")
        vno = _append_version(conn, plan_id, body.content, "edit", body.note)
        conn.commit()
    return {"plan_id": plan_id, "version_no": vno}


@router.post("/plans/{plan_id}/upload")
async def upload_version(plan_id: int,
                         file: UploadFile = File(...),
                         note: str = Form("")):
    """Append a new version from an uploaded .md/.txt file."""
    if not file.filename.lower().endswith((".md", ".txt", ".markdown")):
        raise HTTPException(400, "Only .md, .markdown and .txt files accepted")
    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM plans WHERE id=?", (plan_id,)).fetchone():
            raise HTTPException(404, "Plan not found")
        note = note or ("Uploaded " + file.filename)
        vno = _append_version(conn, plan_id, text, "upload", note)
        conn.commit()
    return {"plan_id": plan_id, "version_no": vno, "filename": file.filename}


@router.get("/plans/{plan_id}/diff")
def diff_versions(plan_id: int, a: int, b: int):
    """Unified-ish diff between version a (old) and version b (new), by version id.
    Returns structured lines so the frontend renders without a diff library."""
    with get_db() as conn:
        va = conn.execute("SELECT * FROM plan_versions WHERE id=? AND plan_id=?",
                          (a, plan_id)).fetchone()
        vb = conn.execute("SELECT * FROM plan_versions WHERE id=? AND plan_id=?",
                          (b, plan_id)).fetchone()
    if not va or not vb:
        raise HTTPException(404, "Version not found")
    old_lines = va["content"].splitlines()
    new_lines = vb["content"].splitlines()
    sm = difflib.SequenceMatcher(a=old_lines, b=new_lines)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for line in old_lines[i1:i2]:
                out.append({"type": "context", "text": line})
        elif tag == "delete":
            for line in old_lines[i1:i2]:
                out.append({"type": "del", "text": line})
        elif tag == "insert":
            for line in new_lines[j1:j2]:
                out.append({"type": "add", "text": line})
        elif tag == "replace":
            for line in old_lines[i1:i2]:
                out.append({"type": "del", "text": line})
            for line in new_lines[j1:j2]:
                out.append({"type": "add", "text": line})
    adds = sum(1 for l in out if l["type"] == "add")
    dels = sum(1 for l in out if l["type"] == "del")
    return {
        "a": {"id": va["id"], "version_no": va["version_no"]},
        "b": {"id": vb["id"], "version_no": vb["version_no"]},
        "lines": out,
        "added": adds,
        "removed": dels,
    }


# ── Plan → pipeline graph (two-phase: preview, then commit) ────────────────────
class ToPipeline(BaseModel):
    version_id: Optional[int] = None  # default: latest version


def _version_for(conn, plan_id, version_id):
    if version_id:
        return conn.execute("SELECT * FROM plan_versions WHERE id=? AND plan_id=?",
                            (version_id, plan_id)).fetchone()
    return conn.execute(
        "SELECT * FROM plan_versions WHERE plan_id=? ORDER BY version_no DESC LIMIT 1",
        (plan_id,)).fetchone()


@router.post("/plans/{plan_id}/pipeline-preview")
def pipeline_preview(plan_id: int, body: ToPipeline):
    """Dry run: parse a version and reconcile against the plan's linked pipeline
    (position-matched). Writes nothing. Returns the proposed change list so the
    UI can show a review dialog before committing."""
    with get_db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(404, "Plan not found")
        v = _version_for(conn, plan_id, body.version_id)
        if not v:
            raise HTTPException(404, "No version to convert")

        parsed = plan_parser.parse_plan(v["content"])
        if not parsed["steps"]:
            raise HTTPException(
                422, "No steps found. Use '## N. Title' headings (see the planning prompt).")

        existing = []
        target_pid = plan["pipeline_id"]
        if target_pid:
            existing = [dict(r) for r in conn.execute(
                "SELECT id, name, notes, pos_x, pos_y FROM pipeline_steps "
                "WHERE pipeline_id=? ORDER BY id", (target_pid,)).fetchall()]

        actions = plan_parser.reconcile(parsed["steps"], existing)

    # serialise actions for the client (new step -> notes preview)
    out = []
    for a in actions:
        out.append({
            "action": a["action"], "pos": a["pos"],
            "old_title": a["old"]["name"] if a["old"] else None,
            "new_title": a["new"]["title"] if a["new"] else None,
            "old_notes": a["old"]["notes"] if a["old"] else None,
            "new_notes": plan_parser.build_notes(a["new"]) if a["new"] else None,
        })
    counts = {k: sum(1 for a in actions if a["action"] == k)
              for k in ("keep", "change", "add", "remove")}
    return {
        "has_existing": bool(target_pid),
        "pipeline_id": target_pid,
        "version_no": v["version_no"],
        "actions": out,
        "counts": counts,
    }


@router.post("/plans/{plan_id}/pipeline-commit")
def pipeline_commit(plan_id: int, body: ToPipeline):
    """Apply reconciliation to the plan's linked pipeline in place (or create a
    new pipeline if none is linked). Unchanged steps keep their positions;
    changed steps keep position but update title+notes; added steps are
    auto-placed; removed steps (and their edges) are deleted. Edges are rebuilt
    from the new plan's dependencies."""
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(404, "Plan not found")
        v = _version_for(conn, plan_id, body.version_id)
        if not v:
            raise HTTPException(404, "No version to convert")
        parsed = plan_parser.parse_plan(v["content"])
        steps = parsed["steps"]
        if not steps:
            raise HTTPException(422, "No steps found.")
        pos = plan_parser.layout_positions(steps, parsed["edges"])

        target_pid = plan["pipeline_id"]
        if not target_pid:
            # no linked pipeline yet — create one
            pname = plan["name"] + " (from plan)"
            cur = conn.execute(
                "INSERT INTO pipelines (name, description, created, updated) VALUES (?,?,?,?)",
                (pname, "Auto-generated from plan #" + str(plan_id), now, now))
            target_pid = cur.lastrowid

        existing = [dict(r) for r in conn.execute(
            "SELECT id, name, notes, pos_x, pos_y FROM pipeline_steps "
            "WHERE pipeline_id=? ORDER BY id", (target_pid,)).fetchall()]
        actions = plan_parser.reconcile(steps, existing)

        # author step-number -> db step id (built as we go, used for edges)
        no_to_id = {}
        for a in actions:
            if a["action"] == "keep":
                # refresh notes silently, keep position
                conn.execute("UPDATE pipeline_steps SET notes=? WHERE id=?",
                             (plan_parser.build_notes(a["new"]), a["old"]["id"]))
                no_to_id[a["new"]["no"]] = a["old"]["id"]
            elif a["action"] == "change":
                conn.execute(
                    "UPDATE pipeline_steps SET name=?, notes=? WHERE id=?",
                    (a["new"]["title"], plan_parser.build_notes(a["new"]), a["old"]["id"]))
                no_to_id[a["new"]["no"]] = a["old"]["id"]
            elif a["action"] == "add":
                x, y = pos.get(a["new"]["no"], (100.0, 100.0))
                cur = conn.execute(
                    "INSERT INTO pipeline_steps (pipeline_id, name, notes, protocol_id, pos_x, pos_y, created) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (target_pid, a["new"]["title"], plan_parser.build_notes(a["new"]),
                     None, x, y, now))
                no_to_id[a["new"]["no"]] = cur.lastrowid
            elif a["action"] == "remove":
                sid = a["old"]["id"]
                conn.execute(
                    "DELETE FROM pipeline_edges WHERE pipeline_id=? AND (from_step=? OR to_step=?)",
                    (target_pid, sid, sid))
                conn.execute("DELETE FROM pipeline_steps WHERE id=?", (sid,))

        # rebuild edges from the new plan's dependencies
        conn.execute("DELETE FROM pipeline_edges WHERE pipeline_id=?", (target_pid,))
        for frm, to in parsed["edges"]:
            if frm in no_to_id and to in no_to_id:
                conn.execute(
                    "INSERT INTO pipeline_edges (pipeline_id, from_step, to_step, created) VALUES (?,?,?,?)",
                    (target_pid, no_to_id[frm], no_to_id[to], now))

        conn.execute("UPDATE pipelines SET updated=? WHERE id=?", (now, target_pid))
        conn.execute("UPDATE plans SET pipeline_id=?, updated=? WHERE id=?",
                     (target_pid, now, plan_id))
        conn.commit()

    counts = {k: sum(1 for a in actions if a["action"] == k)
              for k in ("keep", "change", "add", "remove")}
    return {"pipeline_id": target_pid, "version_no": v["version_no"], "counts": counts}
