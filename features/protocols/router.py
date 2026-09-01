"""Protocols feature - protocol library with manual entry, Claude round-trip import,
recipe tables, and run history."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import json, re, uuid

from core.database import register_table, register_seed, ensure_column, get_db

register_table("protocols", """CREATE TABLE IF NOT EXISTS protocols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'url',
    url         TEXT DEFAULT NULL,
    source_text TEXT DEFAULT NULL,
    steps       TEXT DEFAULT NULL,
    recipe      TEXT DEFAULT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

register_table("active_runs", """CREATE TABLE IF NOT EXISTS active_runs (
    run_id       TEXT PRIMARY KEY,
    protocol_id  INTEGER NOT NULL,
    protocol_json TEXT NOT NULL,
    steps_json   TEXT NOT NULL DEFAULT '[]',
    recipe_json  TEXT DEFAULT NULL,
    group_name   TEXT NOT NULL DEFAULT '',
    subgroup     TEXT NOT NULL DEFAULT '',
    scaling      INTEGER NOT NULL DEFAULT 0,
    scale_factor REAL NOT NULL DEFAULT 1.0,
    started_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL)""")

# Idempotent column-add for the "Are you still running this?" daily check-in.
# Stores ISO-8601 timestamp until which we should NOT prompt; null/empty = ask.
register_seed(lambda conn: ensure_column(conn, "active_runs",
                                         "snoozed_until", "TEXT DEFAULT NULL"))

# Protocol metadata schema: JSON blob describing custom fields the user
# fills in when running this protocol (primers/temps for PCR, sample lists
# for gels, etc). Null/empty = protocol has no schema; run panel skips the
# metadata side-panel. Shape:
#   {"fields": [
#      {"id":"primer_fwd","label":"Forward primer","type":"text","default":""},
#      {"id":"wells","label":"Wells","type":"table",
#       "columns":[{"id":"lane","label":"Lane","type":"number"},
#                  {"id":"sample","label":"Sample","type":"text"}]}
#   ]}
register_seed(lambda conn: ensure_column(conn, "protocols",
                                         "metadata_schema", "TEXT DEFAULT NULL"))

# Filled-in metadata values for a given run of a protocol. Shape matches
# the schema — scalar fields get scalar values, table fields get a list
# of row-dicts. Saved through the same PUT /active-runs/{id} flow as
# steps_json / recipe_json.
register_seed(lambda conn: ensure_column(conn, "active_runs",
                                         "metadata_values", "TEXT DEFAULT NULL"))

# Linked-runs group id. When two or more runs share the same
# linked_group_id, changes to steps_json / recipe_json / scaling /
# scale_factor made to any one propagate to all siblings via the PUT
# handler. metadata_values does NOT propagate — that's the whole point
# (two colony PCRs with different primers, same physical wetwork).
# NULL = standalone run. Set via POST /active-runs/{id}/duplicate-linked;
# cleared to null via PUT with linked_group_id="".
register_seed(lambda conn: ensure_column(conn, "active_runs",
                                         "linked_group_id", "TEXT DEFAULT NULL"))

# Protocol pre-flight warnings: JSON array of short strings the user
# needs reminding of every time this protocol is opened. Displayed as
# a persistent banner at the top of a run in the scratch view. Not
# dismissable per-run — the whole point is "check this every time".
# Shape: ["make sure primers don't add overhang", "anneal to matching bit only"]
# Empty array = no warnings; banner hidden.
register_seed(lambda conn: ensure_column(conn, "protocols",
                                         "warnings", "TEXT NOT NULL DEFAULT '[]'"))

register_table("protocol_runs", """CREATE TABLE IF NOT EXISTS protocol_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol_id  INTEGER NOT NULL,
    date         TEXT NOT NULL,
    group_name   TEXT NOT NULL DEFAULT '',
    steps_done   INTEGER NOT NULL DEFAULT 0,
    steps_total  INTEGER NOT NULL DEFAULT 0,
    deviations   INTEGER NOT NULL DEFAULT 0,
    steps_json   TEXT DEFAULT NULL,
    recipe_json  TEXT DEFAULT NULL,
    entry_id     INTEGER DEFAULT NULL,
    created      TEXT NOT NULL)""")

def _migrate():
    with get_db() as conn:
        for stmt in [
            "ALTER TABLE protocols ADD COLUMN source_type TEXT NOT NULL DEFAULT 'url'",
            "ALTER TABLE protocols ADD COLUMN recipe TEXT DEFAULT NULL",
            "ALTER TABLE protocols ADD COLUMN auto_complete TEXT NOT NULL DEFAULT 'manual'",
        ]:
            try:
                conn.execute(stmt)
                conn.commit()
            except Exception:
                pass
_migrate()

# --------------------------------------------------------------------------- #
#  Claude import helpers
#
#  Flow: user pastes Claude's formatted output (steps + recipe tables + notes,
#  each in a delimited block) into either "From Claude" on the create panel
#  or "Import from Claude" on an existing protocol. The parser below splits
#  those blocks into the shapes stored in the `steps` and `recipe` columns.
# --------------------------------------------------------------------------- #


def _split_claude_sections(formatted: str) -> dict:
    """Split a Claude-formatted import block on === DELIMITER === markers.
    Returns dict with keys 'STEPS', 'RECIPES', 'NOTES' (missing sections → '')."""
    # Match "=== NAME ===" at the start of a line
    parts = re.split(r'(?m)^===\s*([A-Z]+)\s*===\s*$', formatted)
    # re.split with a capturing group produces: [pre, name1, body1, name2, body2, ...]
    out = {"STEPS": "", "RECIPES": "", "NOTES": ""}
    for i in range(1, len(parts) - 1, 2):
        name = parts[i].strip().upper()
        body = parts[i + 1].strip()
        if name in out:
            out[name] = body
    return out


def _parse_steps_block(block: str) -> str:
    """Turn a numbered/bulleted list of steps into the JSON shape stored in
    the `steps` column: [{"text": "..."}]."""
    steps = []
    for raw in block.splitlines():
        line = raw.strip()
        # Strip leading "1.", "1)", "- ", "* ", etc.
        line = re.sub(r'^(?:\d+[\.\)]|[-*•])\s*', '', line)
        if line and len(line) > 2:
            steps.append({"text": line})
    return json.dumps(steps)


def _parse_markdown_table(lines: list) -> Optional[dict]:
    """Parse a markdown pipe-table into {columns, rows}. Returns None if the
    lines don't look like a valid table."""
    # Keep only lines that contain a pipe — Claude sometimes leaves blank
    # lines between the table and surrounding text
    rows = [l.strip() for l in lines if '|' in l]
    if len(rows) < 2:
        return None

    def split_row(r):
        # Strip leading/trailing pipes then split
        r = r.strip()
        if r.startswith('|'):
            r = r[1:]
        if r.endswith('|'):
            r = r[:-1]
        return [c.strip() for c in r.split('|')]

    header = split_row(rows[0])
    # rows[1] is usually the |---|---| separator; skip any row that's just
    # dashes/colons/pipes/whitespace
    body_rows = []
    for r in rows[1:]:
        if re.fullmatch(r'[\s\-:|]+', r):
            continue
        cells = split_row(r)
        # Pad short rows, trim long ones, so every row matches header width
        if len(cells) < len(header):
            cells += [''] * (len(header) - len(cells))
        elif len(cells) > len(header):
            cells = cells[:len(header)]
        body_rows.append(cells)

    if not header:
        return None
    return {"columns": header, "rows": body_rows}


def _parse_recipes_block(block: str) -> Optional[str]:
    """Turn a RECIPES block (multiple '## Name' sections each with a markdown
    table) into the JSON stored in the `recipe` column.

    Returns single-table shape {name, columns, rows} if only one table,
    array [{name, columns, rows}, ...] if multiple, or None if empty."""
    if not block.strip():
        return None

    # Split on level-2 headers. Anything before the first '## ' is discarded.
    chunks = re.split(r'(?m)^##\s+(.+?)\s*$', block)
    # chunks = [preamble, name1, body1, name2, body2, ...]
    tables = []
    for i in range(1, len(chunks) - 1, 2):
        name = chunks[i].strip()
        body_lines = chunks[i + 1].splitlines()
        parsed = _parse_markdown_table(body_lines)
        if parsed and parsed["columns"]:
            parsed["name"] = name or "Recipe"
            tables.append(parsed)

    # Fallback: no '## Name' headers, but there might still be a bare markdown
    # table (Claude occasionally omits the header for single-table protocols)
    if not tables:
        parsed = _parse_markdown_table(block.splitlines())
        if parsed and parsed["columns"]:
            parsed["name"] = "Recipe"
            tables.append(parsed)

    if not tables:
        return None
    if len(tables) == 1:
        return json.dumps(tables[0])
    return json.dumps(tables)

DEFAULT_RECIPE = {
    "columns": ["Component", "Stock conc.", "Volume (uL)", "Final conc."],
    "rows": []
}

# --------------------------------------------------------------------------- #
#  Models
# --------------------------------------------------------------------------- #
class ClaudeProtocol(BaseModel):
    title:     str
    formatted: str
    notes:     str = ""
    tags:      List[str] = []
    auto_complete: str = "manual"

class ManualProtocol(BaseModel):
    title:  str
    steps:  List[str] = []
    recipe: Optional[str] = None
    notes:  str = ""
    tags:   List[str] = []
    auto_complete: str = "manual"

class UpdateProtocol(BaseModel):
    title:  Optional[str] = None
    notes:  Optional[str] = None
    tags:   Optional[List[str]] = None
    steps:  Optional[str] = None
    recipe: Optional[str] = None
    auto_complete: Optional[str] = None
    # JSON string. Frontend sends it pre-serialised so we don't need to
    # dict-validate here (schema shape is a client-side concern).
    metadata_schema: Optional[str] = None
    # List of short reminder strings shown as a banner when the protocol
    # is opened as a run in scratch. Empty list clears the warnings.
    warnings: Optional[List[str]] = None

class ActiveRunCreate(BaseModel):
    run_id:       str
    protocol_id:  int
    protocol_json: str
    steps_json:   str = '[]'
    recipe_json:  Optional[str] = None
    group_name:   str = ''
    subgroup:     str = ''
    scaling:      bool = False
    scale_factor: float = 1.0
    started_at:   str

class ActiveRunUpdate(BaseModel):
    steps_json:   Optional[str] = None
    recipe_json:  Optional[str] = None
    scaling:      Optional[bool] = None
    scale_factor: Optional[float] = None
    # Client-side JSON of filled-in schema values. Shape mirrors the
    # protocol's metadata_schema — scalars for scalar fields, list of
    # row-dicts for table fields.
    metadata_values: Optional[str] = None
    # Group id for linked runs. Pass "" (empty string) to unlink this
    # run from its group. Passing a value only sets the id on THIS
    # run — the propagation logic (steps/recipe/scaling) reads whatever
    # linked_group_id is currently set post-write.
    linked_group_id: Optional[str] = None

class SaveRun(BaseModel):
    protocol_id: int
    date:        str
    group_name:  str
    steps_json:  str
    recipe_json: Optional[str] = None
    entry_id:    Optional[int] = None

# --------------------------------------------------------------------------- #
#  Router
# --------------------------------------------------------------------------- #
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
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)

@router.get("/protocols/{protocol_id}/runs")
def get_protocol_runs(protocol_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM protocol_runs WHERE protocol_id=? ORDER BY created DESC",
            (protocol_id,)).fetchall()
    return {"runs": [dict(r) for r in rows]}

@router.post("/protocol-runs")
def save_protocol_run(body: SaveRun):
    now = datetime.utcnow().isoformat()
    steps = json.loads(body.steps_json) if body.steps_json else []
    done  = sum(1 for s in steps if s.get("done"))
    devs  = sum(1 for s in steps if s.get("deviation", "").strip())
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocol_runs (protocol_id,date,group_name,steps_done,steps_total,"
            "deviations,steps_json,recipe_json,entry_id,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (body.protocol_id, body.date, body.group_name, done, len(steps),
             devs, body.steps_json, body.recipe_json, body.entry_id, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocol_runs WHERE id=?", (cur.lastrowid,)).fetchone())


@router.delete("/protocol-runs/{run_id}")
def delete_protocol_run(run_id: int):
    """Remove a protocol_run row. Does NOT delete the linked notebook entry —
    that's the user's data and they can delete it separately if they want.
    Useful for cleaning up accidentally-duplicated runs."""
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM protocol_runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Protocol run not found")
        conn.execute("DELETE FROM protocol_runs WHERE id=?", (run_id,))
        conn.commit()
    return {"deleted": run_id}



@router.get("/active-runs")
def list_active_runs():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM active_runs ORDER BY updated_at DESC").fetchall()
    return {"runs": [dict(r) for r in rows]}

@router.post("/active-runs")
def create_active_run(body: ActiveRunCreate):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute("""INSERT OR REPLACE INTO active_runs
            (run_id,protocol_id,protocol_json,steps_json,recipe_json,
             group_name,subgroup,scaling,scale_factor,started_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (body.run_id, body.protocol_id, body.protocol_json, body.steps_json,
             body.recipe_json, body.group_name, body.subgroup,
             1 if body.scaling else 0, body.scale_factor, body.started_at, now))
        conn.commit()
    return {"run_id": body.run_id}

@router.put("/active-runs/{run_id}")
def update_active_run(run_id: str, body: ActiveRunUpdate):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM active_runs WHERE run_id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Active run not found")
        r = dict(row)
        if body.steps_json      is not None: r["steps_json"]      = body.steps_json
        if body.recipe_json     is not None: r["recipe_json"]     = body.recipe_json
        if body.scaling         is not None: r["scaling"]         = 1 if body.scaling else 0
        if body.scale_factor    is not None: r["scale_factor"]    = body.scale_factor
        if body.metadata_values is not None: r["metadata_values"] = body.metadata_values
        # Empty string on linked_group_id = unlink. None = leave as-is.
        if body.linked_group_id is not None:
            r["linked_group_id"] = body.linked_group_id or None
        conn.execute("""UPDATE active_runs SET
            steps_json=?, recipe_json=?, scaling=?, scale_factor=?,
            metadata_values=?, linked_group_id=?, updated_at=?
            WHERE run_id=?""",
            (r["steps_json"], r["recipe_json"], r["scaling"],
             r["scale_factor"], r.get("metadata_values"),
             r.get("linked_group_id"), now, run_id))
        conn.commit()

        # ── Propagation to linked siblings ──────────────────────────
        # If this run is in a linked group, propagate the "shared"
        # fields (steps/recipe/scaling — NOT metadata_values) to every
        # other run in the group. Fields the client didn't send are
        # left unchanged on the siblings (only overwrite what changed).
        # metadata_values is deliberately excluded — that's the whole
        # point of linked runs (same wetwork, different samples).
        gid = r.get("linked_group_id")
        if gid:
            sibling_rows = conn.execute(
                "SELECT run_id FROM active_runs WHERE linked_group_id=? AND run_id != ?",
                (gid, run_id)
            ).fetchall()
            if sibling_rows:
                # Build the SET clause dynamically based on what actually
                # changed on this write, so a metadata-only save doesn't
                # trigger a spurious steps propagation.
                sets = []
                vals = []
                if body.steps_json   is not None:
                    sets.append("steps_json=?");   vals.append(body.steps_json)
                if body.recipe_json  is not None:
                    sets.append("recipe_json=?");  vals.append(body.recipe_json)
                if body.scaling      is not None:
                    sets.append("scaling=?");      vals.append(1 if body.scaling else 0)
                if body.scale_factor is not None:
                    sets.append("scale_factor=?"); vals.append(body.scale_factor)
                if sets:
                    sets.append("updated_at=?"); vals.append(now)
                    sibling_ids = [s["run_id"] for s in sibling_rows]
                    placeholders = ",".join("?" * len(sibling_ids))
                    conn.execute(
                        f"UPDATE active_runs SET {', '.join(sets)} WHERE run_id IN ({placeholders})",
                        vals + sibling_ids
                    )
                    conn.commit()
    return {"run_id": run_id}

@router.delete("/active-runs/{run_id}")
def delete_active_run(run_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM active_runs WHERE run_id=?", (run_id,))
        conn.commit()
    return {"deleted": run_id}


@router.post("/active-runs/{run_id}/duplicate-linked")
def duplicate_active_run_linked(run_id: str):
    """Create a linked-sibling run: same protocol, same current step
    progress, same recipe scaling, EMPTY metadata_values. Both runs
    (source + new) share a linked_group_id — future writes to shared
    fields (steps/recipe/scaling) on either run propagate to both.

    Use case: user is running two colony PCRs together in the same
    thermocycler. Ticking off "add master mix" in one should tick it
    in both, but each has its own primer names / sample list."""
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        src = conn.execute(
            "SELECT * FROM active_runs WHERE run_id=?", (run_id,)).fetchone()
        if not src:
            raise HTTPException(404, "Source run not found")
        src = dict(src)

        # If source has no group id yet, mint one and set it on source too.
        # The new run then joins that group. This is the common case —
        # user clicks "duplicate as linked" on a standalone run.
        gid = src.get("linked_group_id")
        if not gid:
            gid = "lg_" + uuid.uuid4().hex[:12]
            conn.execute(
                "UPDATE active_runs SET linked_group_id=?, updated_at=? WHERE run_id=?",
                (gid, now, run_id))

        new_run_id = src["run_id"] + "_dup_" + uuid.uuid4().hex[:6]
        conn.execute("""INSERT INTO active_runs
            (run_id, protocol_id, protocol_json, steps_json, recipe_json,
             group_name, subgroup, scaling, scale_factor, metadata_values,
             linked_group_id, started_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (new_run_id, src["protocol_id"], src["protocol_json"],
             src["steps_json"], src["recipe_json"],
             src.get("group_name") or "", src.get("subgroup") or "",
             src.get("scaling", 0), src.get("scale_factor", 1.0),
             # Fresh metadata — this is the whole point of "linked but
             # different samples". Client re-seeds defaults from the
             # protocol's metadata_schema on load.
             None,
             gid, now, now))
        conn.commit()
        new_row = conn.execute(
            "SELECT * FROM active_runs WHERE run_id=?", (new_run_id,)).fetchone()
    return {"new_run_id": new_run_id, "linked_group_id": gid, "run": dict(new_row)}


# ── Daily check-in support ──────────────────────────────────────────────────
# Runs started on previous calendar days trigger a blocking popup on app load.
# The user can mark them done, snooze (don't ask again for 24h), or cancel.

@router.get("/active-runs/stale")
def list_stale_runs():
    """Return runs that should trigger the 'are you still running this?' prompt.
    Criteria: started before today (local date — but we compare ISO strings, see note)
    AND (snoozed_until IS NULL OR snoozed_until < now).

    Note on date comparison: started_at is stored as UTC ISO. We compare its
    date prefix to today's UTC date. If you're in a timezone where 'today' differs
    by hour, edge cases near midnight may misfire — acceptable trade-off for keeping
    this lightweight and avoiding a tz library."""
    now = datetime.utcnow()
    today = now.strftime("%Y-%m-%d")
    now_iso = now.isoformat()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM active_runs "
            "WHERE substr(started_at, 1, 10) < ? "
            "  AND (snoozed_until IS NULL OR snoozed_until = '' OR snoozed_until < ?) "
            "ORDER BY started_at ASC",
            (today, now_iso)
        ).fetchall()
    return {"runs": [dict(r) for r in rows]}


class SnoozeRequest(BaseModel):
    hours: Optional[int] = 24


@router.post("/active-runs/{run_id}/snooze")
def snooze_active_run(run_id: str, body: SnoozeRequest):
    """Suppress the daily prompt for this run for `hours` hours.
    Used when the user clicks 'Still running' — long-running things like
    overnight cultures should be able to defer the question."""
    hours = max(1, min(body.hours or 24, 24 * 14))  # clamp to 1h..14d for sanity
    until = (datetime.utcnow() + timedelta(hours=hours)).isoformat()
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM active_runs WHERE run_id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Active run not found")
        conn.execute(
            "UPDATE active_runs SET snoozed_until=?, updated_at=? WHERE run_id=?",
            (until, now, run_id)
        )
        conn.commit()
    return {"run_id": run_id, "snoozed_until": until}


class CancelRunRequest(BaseModel):
    reason: Optional[str] = ""
    date:   Optional[str] = None   # YYYY-MM-DD; defaults to today


@router.post("/active-runs/{run_id}/cancel")
def cancel_active_run(run_id: str, body: CancelRunRequest):
    """Cancel a run: save a notebook entry marked CANCELLED, delete the active
    run record. Notebook entry preserves the partial step progress + recipe so
    you can see what was done before cancellation."""
    now = datetime.utcnow().isoformat()
    date = body.date or datetime.utcnow().strftime("%Y-%m-%d")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM active_runs WHERE run_id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Active run not found")
        r = dict(row)

    # Reconstruct steps + recipe for the notebook entry
    try:
        protocol = json.loads(r.get("protocol_json") or "{}")
    except Exception:
        protocol = {}
    try:
        steps = json.loads(r.get("steps_json") or "[]")
    except Exception:
        steps = []
    done_steps = [s for s in steps if s.get("done")]
    devs = [s.get("deviation", "") for s in steps if s.get("deviation")]

    # Build notes body. "[CANCELLED]" prefix makes it grep-friendly in the
    # notebook so you can find these later.
    title = protocol.get("title") or f"Protocol #{r.get('protocol_id')}"
    lines = [
        f"[CANCELLED] Protocol: {title}",
        f"Started: {(r.get('started_at') or '')[:16].replace('T', ' ')}",
        f"Cancelled: {now[:16].replace('T', ' ')}",
        f"Progress: {len(done_steps)} / {len(steps)} steps completed before cancellation",
    ]
    if body.reason:
        lines.append(f"Reason: {body.reason}")
    if done_steps:
        lines.append("\nSteps completed before cancellation:")
        for s in done_steps:
            lines.append(f"- {s.get('text', '')}")
            if s.get("deviation"):
                lines.append(f"  ↳ deviation: {s['deviation']}")
    notes_body = "\n".join(lines)

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO entries (title,group_name,subgroup,date,notes,results,yields,issues,created,updated) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                f"[CANCELLED] {title}",
                r.get("group_name") or "",
                r.get("subgroup") or "",
                date,
                notes_body,
                "",
                "",
                f"Run cancelled. Reason: {body.reason or '(none given)'}",
                now, now,
            ),
        )
        entry_id = cur.lastrowid
        # Also save a protocol_runs row marked cancelled — keeps the protocol
        # history honest (you can see what happened).
        conn.execute(
            "INSERT INTO protocol_runs (protocol_id,date,group_name,steps_done,steps_total,"
            "deviations,steps_json,recipe_json,entry_id,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                r.get("protocol_id"),
                date,
                r.get("group_name") or "",
                len(done_steps),
                len(steps),
                "\n".join(devs) + (f"\n[CANCELLED: {body.reason or '(no reason given)'}]"),
                r.get("steps_json") or "[]",
                r.get("recipe_json"),
                entry_id,
                now,
            ),
        )
        conn.execute("DELETE FROM active_runs WHERE run_id=?", (run_id,))
        conn.commit()
    return {"cancelled": run_id, "entry_id": entry_id}

@router.post("/protocols/from-claude")
async def create_from_claude(body: ClaudeProtocol):
    """Create a protocol from a pasted Claude-formatted block.

    Parses the same delimited format as POST /protocols/{id}/import-from-claude
    (=== STEPS ===, === RECIPES ===, === NOTES ===) but into a brand-new row
    rather than updating an existing one."""
    now = datetime.utcnow().isoformat()

    sections = _split_claude_sections(body.formatted)
    if not any(sections.values()):
        raise HTTPException(400,
            "Could not find any === STEPS ===, === RECIPES ===, or === NOTES === "
            "delimiters in the pasted text")

    steps_json  = _parse_steps_block(sections["STEPS"])   if sections["STEPS"]   else json.dumps([])
    recipe_json = _parse_recipes_block(sections["RECIPES"]) if sections["RECIPES"] else json.dumps(DEFAULT_RECIPE)

    # Notes from the pasted block get merged with any notes the user typed in
    # the form field (form notes come first, Claude notes appended).
    combined_notes = body.notes.strip()
    if sections["NOTES"].strip():
        addition = sections["NOTES"].strip()
        combined_notes = (combined_notes + "\n\n---\n\n" + addition) if combined_notes else addition

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, "claude", None, None, steps_json, recipe_json,
             combined_notes, json.dumps(body.tags), body.auto_complete, now, now))
        conn.commit()
        proto = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

    # Report counts so the UI toast can be specific.
    try:
        step_count = len(json.loads(steps_json))
    except Exception:
        step_count = 0
    try:
        r = json.loads(recipe_json) if recipe_json else None
        table_count = len(r) if isinstance(r, list) else (1 if isinstance(r, dict) and r.get("columns") and r.get("rows") else 0)
    except Exception:
        table_count = 0

    return {**proto, "steps_parsed": step_count, "tables_parsed": table_count,
            "notes_appended": bool(sections["NOTES"].strip())}


@router.post("/protocols/from-manual")
async def create_manual(body: ManualProtocol):
    now    = datetime.utcnow().isoformat()
    steps  = json.dumps([{"text": s.strip()} for s in body.steps if s.strip()])
    recipe = body.recipe or json.dumps(DEFAULT_RECIPE)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, "manual", None, None, steps, recipe, body.notes, json.dumps(body.tags), body.auto_complete, now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.put("/protocols/{protocol_id}")
async def update_protocol(protocol_id: int, body: UpdateProtocol):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        p = dict(row)
        if body.title  is not None: p["title"]  = body.title
        if body.notes  is not None: p["notes"]  = body.notes
        if body.steps  is not None: p["steps"]  = body.steps
        if body.recipe is not None: p["recipe"] = body.recipe
        if body.tags   is not None: p["tags"]   = json.dumps(body.tags)
        if body.auto_complete is not None: p["auto_complete"] = body.auto_complete
        if body.metadata_schema is not None: p["metadata_schema"] = body.metadata_schema
        if body.warnings is not None:
            # Coerce to list of non-empty stripped strings so trailing blank
            # rows from the editor don't render as empty banner items.
            clean = [str(w).strip() for w in body.warnings if str(w).strip()]
            p["warnings"] = json.dumps(clean)
        p["updated"] = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE protocols SET title=?,notes=?,steps=?,recipe=?,tags=?,auto_complete=?,metadata_schema=?,warnings=?,updated=? WHERE id=?",
            (p["title"], p["notes"], p["steps"], p["recipe"], p["tags"],
             p.get("auto_complete", "manual"), p.get("metadata_schema"),
             p.get("warnings", "[]"),
             p["updated"], protocol_id))
        conn.commit()
    return p

@router.delete("/protocols/{protocol_id}")
def delete_protocol(protocol_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM protocols WHERE id=?", (protocol_id,))
        conn.commit()
    return {"deleted": protocol_id}


class ImportFromClaude(BaseModel):
    formatted: str


@router.post("/protocols/{protocol_id}/import-from-claude")
def import_from_claude(protocol_id: int, body: ImportFromClaude):
    """Parse a Claude-formatted delimited block and overwrite steps + recipe;
    append the NOTES section to existing notes (separator preserves prior notes).
    Returns the updated protocol row."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)

    sections = _split_claude_sections(body.formatted)
    if not any(sections.values()):
        raise HTTPException(400,
            "Could not find any === STEPS ===, === RECIPES ===, or === NOTES === "
            "delimiters in the pasted text")

    steps_json = _parse_steps_block(sections["STEPS"]) if sections["STEPS"] else None
    recipe_json = _parse_recipes_block(sections["RECIPES"]) if sections["RECIPES"] else None

    # Notes: append with a separator so any manual context already there survives.
    new_notes = p.get("notes") or ""
    if sections["NOTES"]:
        addition = sections["NOTES"].strip()
        if new_notes.strip():
            new_notes = new_notes.rstrip() + "\n\n---\n\n" + addition
        else:
            new_notes = addition

    now = datetime.utcnow().isoformat()
    final_steps  = steps_json  if steps_json  is not None else p.get("steps")
    final_recipe = recipe_json if recipe_json is not None else p.get("recipe")

    with get_db() as conn:
        conn.execute(
            "UPDATE protocols SET steps=?, recipe=?, notes=?, updated=? WHERE id=?",
            (final_steps, final_recipe, new_notes, now, protocol_id))
        conn.commit()
        updated = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone())

    # Report what got parsed so the UI can toast a summary
    try:
        step_count = len(json.loads(final_steps or "[]"))
    except Exception:
        step_count = 0
    try:
        r = json.loads(final_recipe) if final_recipe else None
        table_count = len(r) if isinstance(r, list) else (1 if isinstance(r, dict) and r.get("columns") else 0)
    except Exception:
        table_count = 0

    return {"protocol": updated, "steps_parsed": step_count,
            "tables_parsed": table_count,
            "notes_appended": bool(sections["NOTES"].strip())}


@router.post("/protocols/{protocol_id}/clone")
def clone_protocol(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (p["title"] + " (copy)", p["source_type"], p["url"], p["source_text"],
             p["steps"], p["recipe"], "", p["tags"], p.get("auto_complete", "manual"), now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.post("/active-runs/check-expiry")
def check_run_expiry():
    """Auto-complete active runs whose protocol's auto_complete window has elapsed."""
    now = datetime.utcnow()
    today = now.date().isoformat()
    completed = []
    with get_db() as conn:
        runs = conn.execute("SELECT * FROM active_runs").fetchall()
        for run_row in runs:
            run = dict(run_row)
            proto = conn.execute("SELECT auto_complete FROM protocols WHERE id=?",
                                 (run["protocol_id"],)).fetchone()
            if not proto:
                continue
            ac = (dict(proto).get("auto_complete") or "manual")
            if ac == "manual":
                continue
            started = run["started_at"][:10]
            start_date = datetime.fromisoformat(started).date() if 'T' in started else datetime.strptime(started, "%Y-%m-%d").date()
            if ac == "end_of_day":
                expiry = start_date
            else:
                # parse "Xd" format
                try:
                    days = int(ac.replace("d", ""))
                except ValueError:
                    continue
                expiry = start_date + timedelta(days=days)
            if now.date() > expiry:
                # auto-complete: save to protocol_runs, remove from active_runs
                steps = json.loads(run.get("steps_json") or "[]")
                done = sum(1 for s in steps if s.get("done"))
                devs = sum(1 for s in steps if s.get("deviation", "").strip())
                conn.execute(
                    "INSERT INTO protocol_runs (protocol_id,date,group_name,steps_done,steps_total,"
                    "deviations,steps_json,recipe_json,entry_id,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (run["protocol_id"], started, run.get("group_name", ""),
                     done, len(steps), devs, run.get("steps_json"),
                     run.get("recipe_json"), None, now.isoformat()))
                conn.execute("DELETE FROM active_runs WHERE run_id=?", (run["run_id"],))
                completed.append({"run_id": run["run_id"], "protocol_id": run["protocol_id"]})
        if completed:
            conn.commit()
    return {"completed": completed, "checked": len(runs) if 'runs' in dir() else 0}


# ══════════════════════════════════════════════════════════════════════════
# METADATA SCHEMA PRESETS
# ══════════════════════════════════════════════════════════════════════════
# Starter templates for common protocols. User picks one when creating /
# editing a protocol; it seeds `metadata_schema` and they can then edit
# fields freely. The library lives here (not in the DB) so version-
# controlled changes ship with the code.
#
# Field types:
#   text    — single-line free-text
#   number  — numeric input (optional unit for display only, no coercion)
#   table   — repeating rows with `columns`, each column is a text/number
#             field. Values stored as list-of-dicts.
#
# `default` on scalar fields pre-fills the run's metadata_values when the
# run is started. Tables start empty regardless.

METADATA_PRESETS = {
    "colony_pcr": {
        "label": "Colony PCR",
        "schema": {"fields": [
            {"id": "primer_fwd",  "label": "Forward primer",  "type": "text"},
            {"id": "primer_rev",  "label": "Reverse primer",  "type": "text"},
            {"id": "template",    "label": "Template / expected product", "type": "text"},
            {"id": "anneal_c",    "label": "Annealing (°C)",  "type": "number", "default": 55},
            {"id": "extension_s", "label": "Extension (sec)", "type": "number", "default": 30},
            {"id": "cycles",      "label": "Cycles",          "type": "number", "default": 30},
            {"id": "polymerase",  "label": "Polymerase",      "type": "text",   "default": "Taq"},
            {"id": "colonies",    "label": "Colonies screened", "type": "table",
             "columns": [
                {"id": "colony", "label": "Colony #",  "type": "number"},
                {"id": "result", "label": "Result",    "type": "text"},
                {"id": "notes",  "label": "Notes",     "type": "text"},
             ]},
        ]},
    },
    "standard_pcr": {
        "label": "Standard PCR",
        "schema": {"fields": [
            {"id": "primer_fwd",   "label": "Forward primer", "type": "text"},
            {"id": "primer_rev",   "label": "Reverse primer", "type": "text"},
            {"id": "template",     "label": "Template",       "type": "text"},
            {"id": "template_ng",  "label": "Template (ng)",  "type": "number"},
            {"id": "anneal_c",     "label": "Annealing (°C)", "type": "number", "default": 60},
            {"id": "extension_s",  "label": "Extension (sec)", "type": "number", "default": 60},
            {"id": "cycles",       "label": "Cycles",         "type": "number", "default": 30},
            {"id": "polymerase",   "label": "Polymerase",     "type": "text",   "default": "Q5"},
            {"id": "expected_bp",  "label": "Expected size (bp)", "type": "number"},
        ]},
    },
    "dna_gel": {
        "label": "DNA gel",
        "schema": {"fields": [
            {"id": "agarose_pct", "label": "Agarose %",  "type": "number", "default": 1.0},
            {"id": "buffer",      "label": "Buffer",     "type": "text",   "default": "TAE"},
            {"id": "voltage",     "label": "Voltage",    "type": "number", "default": 100},
            {"id": "time_min",    "label": "Run time (min)", "type": "number", "default": 30},
            {"id": "ladder",      "label": "Ladder",     "type": "text",   "default": "1 kb Plus"},
            {"id": "wells",       "label": "Wells",      "type": "table",
             "columns": [
                {"id": "lane",     "label": "Lane",      "type": "number"},
                {"id": "sample",   "label": "Sample",    "type": "text"},
                {"id": "vol_ul",   "label": "Volume (µL)", "type": "number"},
                {"id": "expected", "label": "Expected size (bp)", "type": "text"},
             ]},
        ]},
    },
    "sds_page": {
        "label": "SDS-PAGE gel",
        "schema": {"fields": [
            {"id": "gel_pct",     "label": "Gel %",       "type": "number", "default": 12},
            {"id": "buffer",      "label": "Running buffer", "type": "text", "default": "MES"},
            {"id": "voltage",     "label": "Voltage",     "type": "number", "default": 200},
            {"id": "time_min",    "label": "Run time (min)", "type": "number", "default": 35},
            {"id": "ladder",      "label": "Ladder",      "type": "text",   "default": "PageRuler Plus"},
            {"id": "stain",       "label": "Stain",       "type": "text",   "default": "Coomassie"},
            {"id": "wells",       "label": "Wells",       "type": "table",
             "columns": [
                {"id": "lane",   "label": "Lane",         "type": "number"},
                {"id": "sample", "label": "Sample",       "type": "text"},
                {"id": "vol_ul", "label": "Volume (µL)",  "type": "number"},
                {"id": "notes",  "label": "Notes",        "type": "text"},
             ]},
        ]},
    },
    "transformation": {
        "label": "Bacterial transformation",
        "schema": {"fields": [
            {"id": "strain",       "label": "Competent strain", "type": "text", "default": "DH5α"},
            {"id": "plasmid",      "label": "Plasmid",       "type": "text"},
            {"id": "dna_ng",       "label": "DNA (ng)",      "type": "number"},
            {"id": "antibiotic",   "label": "Selection",     "type": "text",   "default": "Amp"},
            {"id": "recovery_min", "label": "Recovery (min)", "type": "number", "default": 60},
            {"id": "vol_plated",   "label": "Plated (µL)",   "type": "number", "default": 100},
            {"id": "colonies_obs", "label": "Colonies observed", "type": "number"},
        ]},
    },
    "miniprep": {
        "label": "Miniprep",
        "schema": {"fields": [
            {"id": "kit",           "label": "Kit",            "type": "text", "default": "Monarch"},
            {"id": "culture_ml",    "label": "Culture volume (mL)", "type": "number", "default": 5},
            {"id": "samples",       "label": "Samples",        "type": "table",
             "columns": [
                {"id": "id",       "label": "Sample ID",       "type": "text"},
                {"id": "yield",    "label": "Yield (ng/µL)",   "type": "number"},
                {"id": "a260_280", "label": "A260/A280",       "type": "number"},
                {"id": "a260_230", "label": "A260/A230",       "type": "number"},
             ]},
        ]},
    },
    "restriction_digest": {
        "label": "Restriction digest",
        "schema": {"fields": [
            {"id": "enzyme_1",   "label": "Enzyme 1",         "type": "text"},
            {"id": "enzyme_2",   "label": "Enzyme 2",         "type": "text"},
            {"id": "buffer",     "label": "Buffer",           "type": "text",   "default": "CutSmart"},
            {"id": "template",   "label": "Template",         "type": "text"},
            {"id": "template_ng", "label": "Template (ng)",   "type": "number", "default": 500},
            {"id": "temp_c",     "label": "Incubation (°C)",  "type": "number", "default": 37},
            {"id": "time_min",   "label": "Time (min)",       "type": "number", "default": 60},
            {"id": "final_vol_ul", "label": "Final volume (µL)", "type": "number", "default": 20},
        ]},
    },
}


@router.get("/protocol-metadata-presets")
def list_metadata_presets():
    """Return the metadata schema preset library. Frontend uses this to
    populate the 'Load from preset ▼' dropdown in the protocol edit view.
    Presets are starter schemas — user adopts one then edits fields."""
    return {"presets": METADATA_PRESETS}


# ── PDF export ─────────────────────────────────────────────────────────────
# `GET /protocols/{id}/pdf` returns a bench-printable PDF of the protocol.
# Contents in order: title + created date + tags, notes (if any),
# warnings banner (if any), metadata schema (fields with defaults; table
# fields as sub-tables), recipe (each recipe_json entry as its own
# named table), steps (numbered). Uses reportlab's Platypus flowables
# so wrapping and page-breaks are handled by the layout engine.

def _build_protocol_pdf(protocol: dict) -> bytes:
    """Render a protocol as a printable PDF. Returns the bytes."""
    # Local imports so a missing reportlab install doesn't crash module
    # load for the rest of the protocols endpoints.
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        KeepTogether, PageBreak,
    )
    from reportlab.lib.enums import TA_LEFT

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=protocol.get("title", "Protocol"),
    )
    ss = getSampleStyleSheet()
    # Compact styles tuned for a lab-notebook feel — dense but readable.
    styles = {
        "title": ParagraphStyle("title", parent=ss["Title"], fontSize=18,
                                leading=22, spaceAfter=4, alignment=TA_LEFT),
        "meta":  ParagraphStyle("meta",  parent=ss["Normal"], fontSize=8,
                                textColor=colors.HexColor("#8a7f72"), spaceAfter=10),
        "h2":    ParagraphStyle("h2",    parent=ss["Heading2"], fontSize=12,
                                spaceBefore=10, spaceAfter=4,
                                textColor=colors.HexColor("#4a4139")),
        "body":  ParagraphStyle("body",  parent=ss["Normal"], fontSize=10,
                                leading=14),
        "warn":  ParagraphStyle("warn",  parent=ss["Normal"], fontSize=10,
                                leading=14, textColor=colors.HexColor("#7a4a10")),
        "notes": ParagraphStyle("notes", parent=ss["Normal"], fontSize=10,
                                leading=14, fontName="Helvetica-Oblique",
                                textColor=colors.HexColor("#5a5148")),
        "step":  ParagraphStyle("step",  parent=ss["Normal"], fontSize=10,
                                leading=14, leftIndent=16, bulletIndent=0),
    }

    def esc(s):
        # reportlab paragraphs use minimal HTML; escape angle-brackets and &
        # so raw protocol text doesn't accidentally parse as markup.
        return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    story = []
    # ── Title + meta line ────────────────────────────────────────
    story.append(Paragraph(esc(protocol.get("title") or "Protocol"), styles["title"]))
    meta_parts = []
    if protocol.get("created"):
        meta_parts.append("Created " + protocol["created"][:10])
    if protocol.get("source_type") and protocol.get("url"):
        meta_parts.append(f'Source: <a href="{esc(protocol["url"])}">{esc(protocol["url"])}</a>')
    try:
        tags = json.loads(protocol.get("tags") or "[]")
    except Exception:
        tags = []
    if tags:
        meta_parts.append("Tags: " + ", ".join(esc(t) for t in tags))
    if meta_parts:
        story.append(Paragraph(" · ".join(meta_parts), styles["meta"]))

    # ── Notes (freeform, may be multi-paragraph) ─────────────────
    notes = (protocol.get("notes") or "").strip()
    if notes:
        story.append(Paragraph("Notes", styles["h2"]))
        for para in notes.split("\n\n"):
            if para.strip():
                story.append(Paragraph(esc(para).replace("\n", "<br/>"), styles["notes"]))

    # ── Pre-flight warnings ──────────────────────────────────────
    try:
        warnings = json.loads(protocol.get("warnings") or "[]")
    except Exception:
        warnings = []
    if warnings:
        # Warnings boxed in amber so they stand out on the printed page.
        rows = [[Paragraph("⚠ " + esc(w), styles["warn"])] for w in warnings]
        tbl = Table(rows, colWidths=[doc.width])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0, 0), (-1, -1), colors.HexColor("#faf1de")),
            ("BOX",         (0, 0), (-1, -1), 0.75, colors.HexColor("#d5b070")),
            ("INNERGRID",   (0, 0), (-1, -1), 0.25, colors.HexColor("#e2c890")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",(0, 0), (-1, -1), 8),
            ("TOPPADDING",  (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
        ]))
        story.append(Paragraph("Pre-flight warnings", styles["h2"]))
        story.append(tbl)
        story.append(Spacer(1, 6))

    # ── Metadata schema ──────────────────────────────────────────
    try:
        schema = json.loads(protocol.get("metadata_schema") or "null")
    except Exception:
        schema = None
    if schema and schema.get("fields"):
        story.append(Paragraph("Metadata to fill in", styles["h2"]))
        scalar_rows = []
        table_fields = []
        for f in schema["fields"]:
            if f.get("type") == "table":
                table_fields.append(f)
            else:
                default = str(f.get("default", "") or "")
                scalar_rows.append([
                    Paragraph("<b>" + esc(f.get("label") or f.get("id")) + "</b>", styles["body"]),
                    Paragraph(esc(f.get("type") or "text") + (f" · default: {esc(default)}" if default else ""), styles["body"]),
                ])
        if scalar_rows:
            t = Table(scalar_rows, colWidths=[doc.width * 0.4, doc.width * 0.6])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f5f0e5")),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d5cec0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.append(t)
            story.append(Spacer(1, 6))
        for tf in table_fields:
            story.append(Paragraph(
                "<i>Table:</i> <b>" + esc(tf.get("label") or tf.get("id")) + "</b>",
                styles["body"]))
            cols = tf.get("columns") or []
            if cols:
                header = [Paragraph("<b>" + esc(c.get("label") or c.get("id")) + "</b>", styles["body"])
                          for c in cols]
                # One blank row so the printed page shows an empty grid to fill in
                blank = [Paragraph("", styles["body"]) for _ in cols]
                t = Table([header, blank, blank, blank], colWidths=[doc.width / len(cols)] * len(cols))
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f5f0e5")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#a89f8f")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]))
                story.append(t)
                story.append(Spacer(1, 6))

    # ── Recipe (one Table per named recipe entry) ────────────────
    try:
        recipe = json.loads(protocol.get("recipe") or "null")
    except Exception:
        recipe = None
    if recipe:
        story.append(Paragraph("Recipe", styles["h2"]))
        # Legacy shape: {name, columns, rows}. Newer shape: list of those.
        recipe_list = recipe if isinstance(recipe, list) else [recipe]
        for rec in recipe_list:
            if not isinstance(rec, dict): continue
            cols = rec.get("columns") or []
            rows = rec.get("rows") or []
            if not cols: continue
            name = rec.get("name") or "Reagents"
            story.append(Paragraph("<b>" + esc(name) + "</b>", styles["body"]))
            data = [
                [Paragraph("<b>" + esc(c) + "</b>", styles["body"]) for c in cols]
            ]
            for row in rows:
                data.append([Paragraph(esc(row[i] if i < len(row) else ""), styles["body"])
                             for i in range(len(cols))])
            t = Table(data, colWidths=[doc.width / len(cols)] * len(cols), repeatRows=1)
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f5f0e5")),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d5cec0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            story.append(t)
            story.append(Spacer(1, 6))

    # ── Steps ────────────────────────────────────────────────────
    try:
        steps = json.loads(protocol.get("steps") or "[]")
    except Exception:
        steps = []
    if steps:
        story.append(Paragraph("Steps", styles["h2"]))
        for i, s in enumerate(steps):
            text = s.get("text", "") if isinstance(s, dict) else str(s)
            # Bulleted list would need a ListFlowable; simpler to prefix
            # each step with its number as part of the paragraph.
            story.append(Paragraph(
                "<b>" + str(i + 1) + ".</b> " + esc(text).replace("\n", "<br/>"),
                styles["step"]))

    doc.build(story)
    return buf.getvalue()


@router.get("/protocols/{protocol_id}/pdf")
def download_protocol_pdf(protocol_id: int):
    from fastapi.responses import Response
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Protocol not found")
    protocol = dict(row)
    try:
        pdf_bytes = _build_protocol_pdf(protocol)
    except ImportError:
        raise HTTPException(
            500,
            "reportlab is not installed. Add 'reportlab' to requirements.txt "
            "and rebuild the container."
        )
    # Clean up filename — avoid slashes, quotes, and control chars.
    safe_title = "".join(c if c.isalnum() or c in "-_. " else "_"
                         for c in (protocol.get("title") or f"protocol_{protocol_id}"))
    safe_title = safe_title.strip().replace(" ", "_") or f"protocol_{protocol_id}"
    filename = f"{safe_title}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
