"""Daily workflow feature — timeline of daily notes and task completions."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
import json, re, uuid, threading, os, html as html_lib

from core.database import register_table, register_seed, ensure_column, get_db
from core.ssh import (elog, ensure_pc_online, start_llm,
                      call_llm_3090, ssh_run)
import core.ssh as _ssh

WF_IMG_DIR = "/data/wf_images"
os.makedirs(WF_IMG_DIR, exist_ok=True)

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

# Idempotent column add: existing rows get 'plain', new ones can store 'html'.
# Run as a seed callback so it executes after the CREATE TABLE above.
register_seed(lambda conn: ensure_column(conn, "workflow_entries",
                                         "format", "TEXT NOT NULL DEFAULT 'plain'"))

register_table("day_summaries", """CREATE TABLE IF NOT EXISTS day_summaries (
    date      TEXT PRIMARY KEY,
    summary   TEXT NOT NULL DEFAULT '',
    updated   TEXT NOT NULL)""")

# Per-day scratchpad (legacy; kept for backward-compat data, no longer the UI).
# In the unified-document model the scratchpad merges into day_documents.
register_table("day_scratch", """CREATE TABLE IF NOT EXISTS day_scratch (
    date      TEXT PRIMARY KEY,
    content   TEXT NOT NULL DEFAULT '',
    updated   TEXT NOT NULL)""")

# ── Unified day document ────────────────────────────────────────────────────
# One HTML blob per date. Blocks within may carry data-groups="g1,g2" attrs
# to assign them to project groups. The "Process Day" pipeline groups blocks
# by tag and feeds them to the LLM.
register_table("day_documents", """CREATE TABLE IF NOT EXISTS day_documents (
    date      TEXT PRIMARY KEY,
    content   TEXT NOT NULL DEFAULT '',
    updated   TEXT NOT NULL)""")

# Tracks which dates have been migrated from workflow_entries → day_documents
# so the migration runs at most once per date.
register_table("workflow_migration_log", """CREATE TABLE IF NOT EXISTS workflow_migration_log (
    date      TEXT PRIMARY KEY,
    migrated_at TEXT NOT NULL)""")


def _build_block_from_entry(time_: str, etype: str, content: str,
                            group: str, fmt: str) -> str:
    """Turn a single workflow_entries row into the same block HTML the migration
    would produce. Used both by the migration and by the Read-mode range
    endpoint (when a date has workflow_entries but no day_document yet)."""
    fmt = (fmt or 'plain').lower()
    tag_attr = f' data-groups="{html_lib.escape(group)}"' if group else ''
    time_chip = (f'<span class="wf-time" contenteditable="false">'
                 f'{html_lib.escape((time_ or "").strip())}</span> ') if time_ else ''
    cls = 'wf-block'
    if etype == 'task_done':
        cls += ' wf-task-done'
    elif etype == 'protocol_run':
        cls += ' wf-protocol'

    if fmt == 'html':
        body = re.sub(r'^<div class="wf-rich-render">', '', content or '')
        body = re.sub(r'</div>\s*$', '', body)
        return f'<div class="{cls}"{tag_attr}>{time_chip}{body}</div>'
    else:
        safe = html_lib.escape(content or '').replace('\n', '<br>')
        return f'<p class="{cls}"{tag_attr}>{time_chip}{safe}</p>'


def _synth_day_html_from_entries(conn, date: str) -> str:
    """Concat all workflow_entries for a date into a day_document-shaped HTML
    string, without touching the DB. Returns '' if no entries.

    This is what the migration produces, minus the writes — used by Read mode
    to render dates whose workflow_entries haven't been migrated yet."""
    entries = conn.execute(
        "SELECT time, type, content, group_name, format "
        "FROM workflow_entries WHERE date=? ORDER BY time ASC, created ASC",
        (date,)
    ).fetchall()
    blocks = []
    for e in entries:
        time_ = e['time'] if hasattr(e, 'keys') else e[0]
        etype = e['type'] if hasattr(e, 'keys') else e[1]
        content = e['content'] if hasattr(e, 'keys') else e[2]
        group = e['group_name'] if hasattr(e, 'keys') else e[3]
        fmt = e['format'] if hasattr(e, 'keys') else e[4]
        blocks.append(_build_block_from_entry(time_, etype, content, group, fmt))
    # Include any day_scratch content, matching the migration's behaviour.
    scratch = conn.execute("SELECT content FROM day_scratch WHERE date=?", (date,)).fetchone()
    if scratch:
        sc = scratch[0] if not hasattr(scratch, 'keys') else scratch['content']
        if sc:
            blocks.append(f'<div class="wf-block wf-block-scratch">{sc}</div>')
    return '\n'.join(blocks)


def _migrate_entries_to_documents(conn):
    """For each date with workflow_entries but no entry in workflow_migration_log,
    concat its entries into a day_documents row. Idempotent — re-runs are no-ops.
    Preserves the original workflow_entries rows so a rollback is possible."""
    # Find candidate dates: have entries, not yet migrated, and not already in day_documents
    # (the day_documents check covers the case where someone hand-created one).
    candidates = conn.execute("""
        SELECT DISTINCT we.date
        FROM workflow_entries we
        WHERE we.date NOT IN (SELECT date FROM workflow_migration_log)
          AND we.date NOT IN (SELECT date FROM day_documents)
        ORDER BY we.date
    """).fetchall()

    migrated_count = 0
    for row in candidates:
        date = row[0] if not hasattr(row, 'keys') else row['date']
        entries = conn.execute(
            "SELECT time, type, content, group_name, format "
            "FROM workflow_entries WHERE date=? ORDER BY time ASC, created ASC",
            (date,)
        ).fetchall()

        blocks = []
        for e in entries:
            time_ = e['time'] if hasattr(e, 'keys') else e[0]
            etype = e['type'] if hasattr(e, 'keys') else e[1]
            content = e['content'] if hasattr(e, 'keys') else e[2]
            group = e['group_name'] if hasattr(e, 'keys') else e[3]
            fmt = e['format'] if hasattr(e, 'keys') else e[4]
            blocks.append(_build_block_from_entry(time_, etype, content, group, fmt))

        # Also append any existing day_scratch content (preserving the previous round's work).
        scratch = conn.execute("SELECT content FROM day_scratch WHERE date=?", (date,)).fetchone()
        if scratch and (scratch[0] if not hasattr(scratch, 'keys') else scratch['content']):
            sc_content = scratch[0] if not hasattr(scratch, 'keys') else scratch['content']
            blocks.append(f'<div class="wf-block wf-block-scratch">{sc_content}</div>')

        doc_html = '\n'.join(blocks) if blocks else ''
        now = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO day_documents (date, content, updated) VALUES (?,?,?)",
            (date, doc_html, now)
        )
        conn.execute(
            "INSERT INTO workflow_migration_log (date, migrated_at) VALUES (?,?)",
            (date, now)
        )
        migrated_count += 1

    # Also handle dates that have only scratch (no workflow_entries) — those should
    # become day_documents too, otherwise the user's scratchpad content is orphaned.
    scratch_only = conn.execute("""
        SELECT date, content FROM day_scratch
        WHERE date NOT IN (SELECT date FROM workflow_migration_log)
          AND date NOT IN (SELECT date FROM day_documents)
          AND content != ''
    """).fetchall()
    for r in scratch_only:
        date = r[0] if not hasattr(r, 'keys') else r['date']
        sc = r[1] if not hasattr(r, 'keys') else r['content']
        now = datetime.utcnow().isoformat()
        conn.execute(
            "INSERT INTO day_documents (date, content, updated) VALUES (?,?,?)",
            (date, f'<div class="wf-block wf-block-scratch">{sc}</div>', now)
        )
        conn.execute(
            "INSERT INTO workflow_migration_log (date, migrated_at) VALUES (?,?)",
            (date, now)
        )
        migrated_count += 1


register_seed(_migrate_entries_to_documents)


# ── HTML sanitizer ───────────────────────────────────────────────────────────
# Single-user app on a private network, but clipboard HTML from any website is
# untrusted. Whitelist tags + attributes; everything else is dropped (not
# escaped — pasted Word documents are full of cruft we don't want preserved).

_ALLOWED_TAGS = {
    "p", "br", "div", "span",
    "strong", "b", "em", "i", "u",
    "ul", "ol", "li",
    "h3", "h4",
    "code", "pre",
    "table", "thead", "tbody", "tr", "td", "th",
    "img", "a",
    "blockquote",
    "del", "s",  # track-changes: strikethrough for retroactive deletions
}
# Attributes allowed per tag. Anything else is stripped silently.
_ALLOWED_ATTRS = {
    "img": {"src", "alt"},
    "a":   {"href", "class", "data-gel-id", "data-entry-id", "title"},
    "td":  {"colspan", "rowspan"},
    "th":  {"colspan", "rowspan"},
    # Block-level tags can carry data-groups (comma-separated project group names)
    # for the unified-document tagging UI.
    "div": {"data-groups", "contenteditable"},
    "p":   {"data-groups"},
    "ul":  {"data-groups"},
    "ol":  {"data-groups"},
    "table": {"data-groups"},
    "pre": {"data-groups"},
    "blockquote": {"data-groups"},
    "h3":  {"data-groups"},
    "h4":  {"data-groups"},
    # span gets contenteditable for the time-chip widget (so it's not editable text)
    "span": {"contenteditable"},
    # generic class allowlist for our own styling hooks
    "*":   {"class"},
}
# Permitted img/href URL prefixes. Same-origin only. Blocks javascript:, data:,
# external scripts, etc. The wf_images endpoint serves uploads; gel_images for
# embedded gels; relative anchors are fine.
_SAFE_URL_PREFIXES = ("/api/wf_images/", "/api/gel_images/", "/api/ladder_images/",
                      "#", "/static/")
_SAFE_CLASS_PREFIXES = ("wf-",)  # only our own classes survive

# Block-level tags that should always start fresh after sanitization
_VOID_TAGS = {"br", "img"}


def _attr_allowed(tag: str, attr: str) -> bool:
    if attr in _ALLOWED_ATTRS.get(tag, set()):
        return True
    if attr in _ALLOWED_ATTRS.get("*", set()):
        return True
    return False


def _safe_url(val: str) -> bool:
    if not val:
        return False
    v = val.strip().lower()
    if v.startswith("javascript:") or v.startswith("data:") or v.startswith("vbscript:"):
        return False
    return any(v.startswith(p) for p in _SAFE_URL_PREFIXES) or v.startswith("/")


def _safe_class(val: str) -> str:
    """Keep only classes with allowed prefixes."""
    parts = [c for c in (val or "").split() if any(c.startswith(p) for p in _SAFE_CLASS_PREFIXES)]
    return " ".join(parts)


def sanitize_html(raw: str) -> str:
    """Allowlist-based HTML sanitizer. Strips disallowed tags entirely (drops
    content too, for <script> etc.), keeps text content of unknown inline tags,
    and filters attributes per tag. Not bulletproof against every novel attack
    but adequate for single-user pasting from random websites."""
    if not raw:
        return ""

    # Strip block-with-content tags entirely so their content vanishes too
    DROP_WHOLE = ("script", "style", "iframe", "object", "embed", "form",
                  "input", "button", "select", "textarea", "link", "meta")
    for tag in DROP_WHOLE:
        raw = re.sub(rf"<{tag}\b[^>]*>.*?</{tag}\s*>", "", raw,
                     flags=re.IGNORECASE | re.DOTALL)
        # Self-closing variants too
        raw = re.sub(rf"<{tag}\b[^>]*/?>", "", raw, flags=re.IGNORECASE)

    out = []
    pos = 0
    tag_re = re.compile(r"<\s*(/?)([a-zA-Z0-9]+)((?:\s+[^>]*)?)\s*(/?)>", re.DOTALL)

    for m in tag_re.finditer(raw):
        # Text before this tag — keep but trust HTML escaping is already done by the source
        out.append(raw[pos:m.start()])
        pos = m.end()

        closing, tag, attrs_raw, self_close = m.groups()
        tag = tag.lower()

        if tag not in _ALLOWED_TAGS:
            # Drop the tag wrapper but keep any text content (handled by the loop)
            continue

        if closing:
            out.append(f"</{tag}>")
            continue

        # Parse attributes
        safe_attrs = []
        attr_re = re.compile(r'([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))')
        for am in attr_re.finditer(attrs_raw or ""):
            name = am.group(1).lower()
            val = am.group(2) if am.group(2) is not None else (am.group(3) if am.group(3) is not None else am.group(4) or "")
            if name.startswith("on"):  # drop all event handlers
                continue
            if not _attr_allowed(tag, name):
                continue
            if name in ("src", "href"):
                if not _safe_url(val):
                    continue
            if name == "contenteditable":
                # Only allow contenteditable="false" — used by widget-style chips
                # (time stamps). "true" or empty values are rejected to keep the
                # editor's normal behaviour predictable.
                if val.strip().lower() != "false":
                    continue
            if name == "data-groups":
                # Normalise: comma-separated, no spaces around commas, no empty entries.
                parts = [p.strip() for p in val.split(",") if p.strip()]
                val = ",".join(parts)
                if not val:
                    continue
            if name == "class":
                val = _safe_class(val)
                if not val:
                    continue
            # Escape attribute value's quotes
            safe_val = val.replace('"', "&quot;")
            safe_attrs.append(f'{name}="{safe_val}"')

        attrs_str = (" " + " ".join(safe_attrs)) if safe_attrs else ""
        if tag in _VOID_TAGS or self_close:
            out.append(f"<{tag}{attrs_str}/>")
        else:
            out.append(f"<{tag}{attrs_str}>")

    out.append(raw[pos:])
    return "".join(out)


def html_to_plain_text(html: str) -> str:
    """Convert sanitized workflow HTML to plain text for the LLM. Tables
    become tab-separated lines; images become [image] tokens; everything else
    becomes its text content with line breaks at block boundaries."""
    if not html:
        return ""
    # Convert structural tags to text equivalents BEFORE stripping
    s = html
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"</(p|div|li|tr|h3|h4|blockquote)\s*>", "\n", s, flags=re.IGNORECASE)
    s = re.sub(r"</(td|th)\s*>", "\t", s, flags=re.IGNORECASE)
    s = re.sub(r"<li\b[^>]*>", "- ", s, flags=re.IGNORECASE)
    s = re.sub(r"<img\b[^>]*>", "[image]", s, flags=re.IGNORECASE)
    s = re.sub(r"<a\b[^>]*data-gel-id=\"(\d+)\"[^>]*>(.*?)</a>", r"[gel: \2]", s,
               flags=re.IGNORECASE | re.DOTALL)
    # Strip remaining tags
    s = re.sub(r"<[^>]+>", "", s)
    # Decode entities
    s = html_lib.unescape(s)
    # Collapse whitespace
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

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
    format:     str = "plain"            # 'plain' | 'html'
    group_name: Optional[str] = None
    task_id:    Optional[int] = None

class UpdateWorkflowEntry(BaseModel):
    content:    Optional[str] = None
    format:     Optional[str] = None     # if updating from plain to html, pass 'html'
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
    fmt = body.format if body.format in ("plain", "html") else "plain"
    # Sanitize on the way in, not on the way out. Storage is the trust boundary;
    # display can render directly.
    content = sanitize_html(body.content) if fmt == "html" else body.content
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO workflow_entries (date,time,type,content,format,group_name,task_id,created,updated) VALUES (?,?,?,?,?,?,?,?,?)",
            (date, time_, body.type, content, fmt, body.group_name, body.task_id, now, now))
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
        # Format can be changed independently (e.g. promoting a plain entry to html).
        if body.format is not None and body.format in ("plain", "html"):
            e["format"] = body.format
        if body.content is not None:
            e["content"] = sanitize_html(body.content) if e.get("format") == "html" else body.content
        if body.group_name is not None:
            e["group_name"] = body.group_name
        conn.execute("UPDATE workflow_entries SET content=?,format=?,group_name=?,updated=? WHERE id=?",
                     (e["content"], e.get("format", "plain"), e["group_name"], now, entry_id))
        conn.commit()
    return e

@router.delete("/workflow/{entry_id}")
def delete_workflow_entry(entry_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM workflow_entries WHERE id=?", (entry_id,))
        conn.commit()
    return {"deleted": entry_id}


# ── Day document (unified rich doc per date) ─────────────────────────────────

@router.get("/workflow/{date}/document")
def get_document(date: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT content, updated FROM day_documents WHERE date=?", (date,)
        ).fetchone()
    if not row:
        return {"date": date, "content": "", "updated": None}
    return {"date": date, "content": row["content"], "updated": row["updated"]}


# ── Read-mode support: fetch a range of day_documents in one shot ────────────
# The Workflow view's "Read" mode renders a scrolling book of past days. Rather
# than 30 round-trips, one endpoint returns the whole window. `end` is the
# newest date in the window; `days` is how many to include walking backwards.
# Empty days (no day_document row) are OMITTED — the client renders only days
# that actually have content, so gaps don't create empty page-eating dividers.

@router.get("/workflow/documents/range")
def get_document_range(end: str, days: int = 30):
    """Return all day content in the window [end - days + 1, end], newest
    first. Prefers day_documents rows; falls back to synthesising HTML from
    workflow_entries for dates that haven't been migrated yet (either because
    the app hasn't restarted since they were added, or because they were
    added by the legacy addWorkflowNote flow that still writes to
    workflow_entries directly).

    Only dates with actual content are included."""
    try:
        end_dt = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "end must be YYYY-MM-DD")
    if days < 1 or days > 366:
        raise HTTPException(400, "days must be between 1 and 366")
    start_dt = end_dt - timedelta(days=days - 1)
    start_s = start_dt.strftime("%Y-%m-%d")

    with get_db() as conn:
        # Pull day_documents rows for the window
        doc_rows = conn.execute(
            "SELECT date, content, updated FROM day_documents "
            "WHERE date >= ? AND date <= ? AND content != ''",
            (start_s, end),
        ).fetchall()
        by_date = {r["date"]: (r["content"], r["updated"]) for r in doc_rows}

        # Also find dates with workflow_entries in the window that DON'T have a
        # day_document — those need on-the-fly synthesis.
        we_dates = conn.execute(
            "SELECT DISTINCT date FROM workflow_entries "
            "WHERE date >= ? AND date <= ? "
            "AND date NOT IN (SELECT date FROM day_documents WHERE content != '') "
            "ORDER BY date DESC",
            (start_s, end),
        ).fetchall()

        for r in we_dates:
            date = r["date"]
            synth = _synth_day_html_from_entries(conn, date)
            if synth:
                # Mark synthesised content with `updated=None` so the client
                # can tell it wasn't loaded from a day_document. (Purely
                # informational — not used to gate rendering.)
                by_date[date] = (synth, None)

    documents = [
        {"date": d, "content": c, "updated": u, "source": "day_document" if u else "synth_workflow_entries"}
        for d, (c, u) in by_date.items()
    ]
    documents.sort(key=lambda x: x["date"], reverse=True)  # newest first
    return {
        "start": start_s,
        "end": end,
        "days": days,
        "documents": documents,
    }


@router.get("/workflow/documents/dates-with-content")
def dates_with_content(start: str, end: str):
    """Return the set of dates in [start, end] that have content — either as
    a day_document row or as workflow_entries. Used by the calendar picker
    to mark populated days."""
    try:
        datetime.strptime(start, "%Y-%m-%d")
        datetime.strptime(end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "start and end must be YYYY-MM-DD")
    with get_db() as conn:
        dd = conn.execute(
            "SELECT date FROM day_documents "
            "WHERE date >= ? AND date <= ? AND content != ''",
            (start, end),
        ).fetchall()
        we = conn.execute(
            "SELECT DISTINCT date FROM workflow_entries "
            "WHERE date >= ? AND date <= ?",
            (start, end),
        ).fetchall()
    dates = sorted({r["date"] for r in dd} | {r["date"] for r in we})
    return {"dates": dates}


# ── Project / group listing + block-by-group extraction ─────────────────────
# These back the active-project selector in workflow view and the notebook
# view's read-from-tagged-blocks rewrite.

@router.get("/workflow/projects")
def list_known_projects():
    """Return the union of project/group names known anywhere in the data:
    - entries.group_name  (Process Day output; legacy)
    - workflow_entries.group_name  (legacy input pathway)
    - data-groups attributes across all day_documents.content
    Also reports how many day_documents currently contain each group. Sorted
    by day count desc, then name asc."""
    groups: dict[str, int] = {}
    with get_db() as conn:
        for r in conn.execute("SELECT DISTINCT group_name FROM entries WHERE group_name IS NOT NULL AND group_name != ''"):
            groups.setdefault(r["group_name"], 0)
        for r in conn.execute("SELECT DISTINCT group_name FROM workflow_entries WHERE group_name IS NOT NULL AND group_name != ''"):
            groups.setdefault(r["group_name"], 0)
        # Scan day_documents.content for data-groups attributes. This is coarse
        # but effective — the sanitizer only lets data-groups sit on block-level
        # tags, so a substring hit is a real tag.
        for r in conn.execute("SELECT date, content FROM day_documents WHERE content != ''"):
            seen_in_this_day: set[str] = set()
            for m in re.finditer(r'data-groups="([^"]+)"', r["content"]):
                for g in m.group(1).split(","):
                    g = g.strip()
                    if g and g not in seen_in_this_day:
                        seen_in_this_day.add(g)
                        groups[g] = groups.get(g, 0) + 1
    items = [{"name": n, "day_count": c} for n, c in groups.items()]
    items.sort(key=lambda x: (-x["day_count"], x["name"].lower()))
    return {"projects": items}


@router.get("/workflow/blocks-by-group")
def blocks_by_group(group: str, limit: int = 200):
    """For the given project/group name, walk day_documents newest first and
    return the matching top-level blocks per day. Also falls back to
    workflow_entries synthesis for dates without a day_document, so
    unmigrated legacy days still show up.

    Returns {"group": str, "days": [{"date": str, "blocks": [html, ...]}]}.
    Days without any matching block are omitted."""
    if not group.strip():
        raise HTTPException(400, "group is required")
    group = group.strip()
    if limit < 1 or limit > 5000:
        raise HTTPException(400, "limit out of range")

    days: dict[str, list[str]] = {}
    with get_db() as conn:
        # 1) day_documents — the primary source
        for r in conn.execute(
            "SELECT date, content FROM day_documents WHERE content != '' ORDER BY date DESC LIMIT ?",
            (limit,)
        ):
            hits = _extract_blocks_html_for_group(r["content"], group)
            if hits:
                days[r["date"]] = hits
        # 2) workflow_entries fallback for dates NOT in day_documents. Only
        # entries whose group_name matches — no block scanning needed.
        we_dates = conn.execute(
            "SELECT DISTINCT date FROM workflow_entries "
            "WHERE group_name = ? AND date NOT IN "
            "(SELECT date FROM day_documents WHERE content != '') "
            "ORDER BY date DESC LIMIT ?",
            (group, limit)
        ).fetchall()
        for r in we_dates:
            synth = _synth_day_html_from_entries(conn, r["date"])
            if not synth:
                continue
            hits = _extract_blocks_html_for_group(synth, group)
            if not hits:
                # workflow_entries may have carried the group in `group_name`
                # while the synthesised HTML doesn't (blocks with no
                # data-groups). Show the whole synthesised day in that case
                # rather than lose the content.
                hits = [synth]
            days[r["date"]] = hits

    out = sorted(days.items(), key=lambda x: x[0], reverse=True)
    return {
        "group": group,
        "days": [{"date": d, "blocks": b} for d, b in out],
    }


class DocumentUpdate(BaseModel):
    content: str


@router.put("/workflow/{date}/document")
def update_document(date: str, body: DocumentUpdate):
    now = datetime.utcnow().isoformat()
    clean = sanitize_html(body.content)
    with get_db() as conn:
        existing = conn.execute("SELECT 1 FROM day_documents WHERE date=?", (date,)).fetchone()
        if existing:
            conn.execute("UPDATE day_documents SET content=?, updated=? WHERE date=?",
                         (clean, now, date))
        else:
            conn.execute("INSERT INTO day_documents (date, content, updated) VALUES (?,?,?)",
                         (date, clean, now))
        # Mark as migrated so a startup re-migration doesn't try to re-fill it.
        conn.execute(
            "INSERT OR IGNORE INTO workflow_migration_log (date, migrated_at) VALUES (?,?)",
            (date, now))
        conn.commit()
    return {"date": date, "content": clean, "updated": now}


class AppendBlock(BaseModel):
    """Used by protocol-run / task-done auto-inserts: append a block to today's
    document instead of inserting a workflow_entries row."""
    date:    Optional[str] = None
    html:    str
    groups:  Optional[list[str]] = None    # list of group names to tag with


@router.post("/workflow/document/append")
def append_to_document(body: AppendBlock):
    """Append HTML to a day's document. Used for protocol starts/completions
    and task completions. The caller passes pre-built HTML (sanitized server-side)."""
    date = body.date or datetime.utcnow().strftime("%Y-%m-%d")
    now = datetime.utcnow().isoformat()
    clean_block = sanitize_html(body.html)
    # If groups were specified, splice them into the top-level block tag(s)
    if body.groups:
        groups_attr = ','.join(body.groups)
        clean_block = re.sub(
            r'^<(div|p|ul|ol|table|pre|blockquote|h3|h4)\b',
            rf'<\1 data-groups="{html_lib.escape(groups_attr)}"',
            clean_block, count=1
        )
    with get_db() as conn:
        row = conn.execute("SELECT content FROM day_documents WHERE date=?", (date,)).fetchone()
        if row:
            new_content = (row["content"] or '') + '\n' + clean_block
            conn.execute("UPDATE day_documents SET content=?, updated=? WHERE date=?",
                         (new_content, now, date))
        else:
            conn.execute("INSERT INTO day_documents (date, content, updated) VALUES (?,?,?)",
                         (date, clean_block, now))
        conn.execute(
            "INSERT OR IGNORE INTO workflow_migration_log (date, migrated_at) VALUES (?,?)",
            (date, now))
        conn.commit()
    return {"date": date, "appended": True}


def _extract_blocks_for_llm(html: str) -> list[dict]:
    """Walk the document, split into top-level blocks, extract their data-groups
    and plain-text content. Returns [{groups: [str], text: str}, ...]."""
    if not html:
        return []
    # Match top-level block-level elements with optional data-groups.
    # This is a coarse parser — we only care about top-level blocks, and we accept
    # that nested blocks (tables inside divs, etc.) get their groups from the
    # parent. That matches the editor UX where group-tagging is per top-level block.
    pattern = re.compile(
        r'<(?P<tag>div|p|ul|ol|table|pre|blockquote|h3|h4)'
        r'(?P<attrs>[^>]*)>(?P<body>.*?)</(?P=tag)\s*>',
        re.IGNORECASE | re.DOTALL
    )
    blocks = []
    pos = 0
    for m in pattern.finditer(html):
        attrs = m.group('attrs') or ''
        grp_m = re.search(r'data-groups="([^"]*)"', attrs)
        groups = [g.strip() for g in (grp_m.group(1) if grp_m else '').split(',') if g.strip()]
        # Rebuild the block tag so html_to_plain_text sees the full element
        full = m.group(0)
        text = html_to_plain_text(full).strip()
        if text:
            blocks.append({'groups': groups, 'text': text})
        pos = m.end()
    return blocks


def _extract_blocks_html_for_group(html: str, target_group: str) -> list[str]:
    """Same top-level block parser as _extract_blocks_for_llm, but returns the
    RAW HTML of each matching block (not plain text) so the client can render
    it faithfully in the notebook view. Case-sensitive group match. Blocks
    with no data-groups attribute are never matched (they're "untagged", not
    "everything")."""
    if not html or not target_group:
        return []
    pattern = re.compile(
        r'<(?P<tag>div|p|ul|ol|table|pre|blockquote|h3|h4)'
        r'(?P<attrs>[^>]*)>(?P<body>.*?)</(?P=tag)\s*>',
        re.IGNORECASE | re.DOTALL
    )
    out = []
    for m in pattern.finditer(html):
        grp_m = re.search(r'data-groups="([^"]*)"', m.group('attrs') or '')
        if not grp_m:
            continue
        groups = [g.strip() for g in grp_m.group(1).split(',') if g.strip()]
        if target_group in groups:
            out.append(m.group(0))
    return out


# ── Image upload + serve ─────────────────────────────────────────────────────

@router.post("/workflow/image")
async def upload_wf_image(image: UploadFile = File(...)):
    """Receive an image (from paste, drag, or file picker) and return the URL.
    Images are content-addressable by random uuid — no dedup, but disk is cheap."""
    ext = os.path.splitext(image.filename or "img.png")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        # Most clipboard pastes come as PNG, so this is rarely hit. Default to png
        # rather than rejecting — the browser usually labels these correctly.
        ext = ".png"
    fname = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(WF_IMG_DIR, fname), "wb") as f:
        f.write(await image.read())
    return {"filename": fname, "url": f"/api/wf_images/{fname}"}


@router.get("/wf_images/{filename}")
def serve_wf_image(filename: str):
    # Strip any path traversal attempts (defense-in-depth — FastAPI normalises but be paranoid)
    filename = os.path.basename(filename)
    fpath = os.path.join(WF_IMG_DIR, filename)
    if not os.path.exists(fpath):
        raise HTTPException(404, "Image not found")
    return FileResponse(fpath)


# ── Process Day — background worker ─────────────────────────────────────────

def _process_day_worker(job_id: str, date: str, blocks: list[dict]):
    """Runs in a background thread. Updates job state in SQLite as it progresses.
    `blocks` is a list of {groups: [str], text: str} produced by _extract_blocks_for_llm.
    """
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

        # ── Partition blocks by tag ──────────────────────────────────────
        # Tagged blocks → one bucket per group they're tagged with (multi-tag
        # means the block goes into every named bucket).
        # Untagged blocks → shared "context" appended to every bucket's prompt.
        by_group: dict[str, list[str]] = {}
        untagged: list[str] = []
        for b in blocks:
            if not b['groups']:
                untagged.append(b['text'])
                continue
            for g in b['groups']:
                by_group.setdefault(g, []).append(b['text'])

        # If nothing is tagged but there's untagged content, fall back to a single
        # "General" notebook entry — otherwise the LLM has nothing to write.
        if not by_group and untagged:
            by_group["General"] = []   # will be filled from untagged below

        if not by_group:
            _set_job(job_id, status="failed", phase="done",
                     stage="Day document is empty — nothing to process")
            return

        group_names = list(by_group.keys())
        total = len(group_names)
        created = []
        errors = []
        untagged_text = "\n\n".join(untagged) if untagged else ""

        for idx, group in enumerate(group_names):
            _set_job(job_id, phase="processing", stage=f"Processing {group}...", progress=idx, total=total)

            tagged_text = "\n\n".join(by_group[group])
            # Build the prompt body. Untagged content is included as context but
            # marked as such so the LLM treats it as supporting info rather than
            # the primary record.
            if untagged_text and tagged_text:
                notes_text = (
                    f"=== Notes tagged for {group} ===\n{tagged_text}\n\n"
                    f"=== General context for the day (untagged) ===\n{untagged_text}"
                )
            elif untagged_text:
                notes_text = f"=== Day's notes (untagged) ===\n{untagged_text}"
            else:
                notes_text = tagged_text

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

    # Read the day document and split into blocks for per-group processing.
    with get_db() as conn:
        doc_row = conn.execute(
            "SELECT content FROM day_documents WHERE date=?", (date,)).fetchone()
    doc_html = (doc_row["content"] if doc_row else "") or ""
    blocks = _extract_blocks_for_llm(doc_html)
    if not blocks:
        return {"error": "Day document is empty — nothing to process"}

    job_id = uuid.uuid4().hex[:12]
    _create_job(job_id, date)

    thread = threading.Thread(target=_process_day_worker, args=(job_id, date, blocks), daemon=True)
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
    """Auto-append a task-completed block to today's document."""
    now = datetime.utcnow().isoformat()
    date = datetime.utcnow().strftime("%Y-%m-%d")
    time_ = datetime.utcnow().strftime("%H:%M")
    text = body.get("text", "") or ""
    group = body.get("group_name") or None

    # Build the HTML block. The time chip is contenteditable=false so it doesn't
    # interleave with the user's typing.
    safe_text = html_lib.escape(text)
    groups_attr = f' data-groups="{html_lib.escape(group)}"' if group else ''
    time_chip = f'<span class="wf-time" contenteditable="false">{html_lib.escape(time_)}</span> '
    block = (
        f'<p class="wf-block wf-task-done"{groups_attr}>'
        f'{time_chip}<strong>\u2713 Task done:</strong> {safe_text}'
        f'</p>'
    )

    clean_block = sanitize_html(block)
    with get_db() as conn:
        row = conn.execute("SELECT content FROM day_documents WHERE date=?", (date,)).fetchone()
        if row:
            new_content = (row["content"] or '') + '\n' + clean_block
            conn.execute("UPDATE day_documents SET content=?, updated=? WHERE date=?",
                         (new_content, now, date))
        else:
            conn.execute("INSERT INTO day_documents (date, content, updated) VALUES (?,?,?)",
                         (date, clean_block, now))
        conn.execute(
            "INSERT OR IGNORE INTO workflow_migration_log (date, migrated_at) VALUES (?,?)",
            (date, now))
        conn.commit()
    return {"added": True}
