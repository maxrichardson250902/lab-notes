"""Hours-log feature — track work time in per-hour blocks per day, with
optional file attachments and cross-links to workflow days.

Data model:
- hours_entries: one row per activity block. (date_iso, start_hour, end_hour,
  category, notes, workflow_day_date). end_hour is exclusive, so a 9-11
  entry means "9am block + 10am block" = 2 hours. end_hour can be 24 for
  activities that run to midnight. No cross-midnight support; split into
  two entries if needed.
- hours_attachments: files pinned to a specific entry. Files stored on
  disk under HOURS_FILES_DIR with UUIDed names; original filename kept in
  the DB row for display and download.

Categories are hardcoded here rather than user-configurable — kept small
and colour-mapped so the UI can render deterministically without an extra
lookup call. If you need custom categories later, expose an /api/hours/
categories POST and reflect it in the frontend colour map.
"""
import os
import uuid
import mimetypes
from pathlib import Path
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.database import register_table, get_db, ensure_column


# ── storage ─────────────────────────────────────────────────────────────────
# Mirrors cloning's /data/gb_files pattern — /data is the persistent volume
# in the docker-compose setup so files survive container rebuilds.
HOURS_FILES_DIR = Path("/data/hours_files")
HOURS_FILES_DIR.mkdir(parents=True, exist_ok=True)

# Cap uploads at 25MB per file. Higher than typical MD/txt but bounded so a
# runaway upload can't fill the volume. Adjust here if PDFs exceed this.
MAX_FILE_BYTES = 25 * 1024 * 1024


# ── categories (hardcoded — kept small and colour-mapped) ───────────────────
# Frontend duplicates the key list for the dropdown; keep in sync if edited.
# Colours picked to be distinguishable at a glance in the week-grid heatmap.
CATEGORIES = [
    {"key": "research",    "label": "Research (lab)",      "color": "#5b7a5e"},
    {"key": "learning",    "label": "Learning / reading",  "color": "#4a6fa5"},
    {"key": "writing",     "label": "Writing",             "color": "#8a6fb8"},
    {"key": "experiments", "label": "Experiments",         "color": "#c98a4a"},
    {"key": "meetings",    "label": "Meetings",            "color": "#7a7268"},
    {"key": "admin",       "label": "Admin",               "color": "#b8a047"},
    {"key": "other",       "label": "Other",               "color": "#9a8a7c"},
]
VALID_CATEGORIES = {c["key"] for c in CATEGORIES}


# ── tables ──────────────────────────────────────────────────────────────────
register_table("hours_entries", """CREATE TABLE IF NOT EXISTS hours_entries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date_iso         TEXT NOT NULL,
    start_hour       INTEGER NOT NULL,
    end_hour         INTEGER NOT NULL,
    category         TEXT NOT NULL,
    notes            TEXT DEFAULT NULL,
    workflow_day_date TEXT DEFAULT NULL,
    created          TEXT NOT NULL
)""")

register_table("hours_attachments", """CREATE TABLE IF NOT EXISTS hours_attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created     TEXT NOT NULL,
    FOREIGN KEY(entry_id) REFERENCES hours_entries(id) ON DELETE CASCADE
)""")


# ── models ──────────────────────────────────────────────────────────────────
class EntryIn(BaseModel):
    date_iso: str
    start_hour: int
    end_hour: int
    category: str
    notes: Optional[str] = None
    workflow_day_date: Optional[str] = None


class EntryPatch(BaseModel):
    start_hour: Optional[int] = None
    end_hour: Optional[int] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    workflow_day_date: Optional[str] = None


router = APIRouter(prefix="/api/hours", tags=["hours"])


# ── helpers ─────────────────────────────────────────────────────────────────
def _validate_hours(start_hour: int, end_hour: int) -> None:
    """start ∈ [0,23], end ∈ [1,24], end > start. No cross-midnight."""
    if not (0 <= start_hour <= 23):
        raise HTTPException(400, "start_hour must be 0..23")
    if not (1 <= end_hour <= 24):
        raise HTTPException(400, "end_hour must be 1..24")
    if end_hour <= start_hour:
        raise HTTPException(400, "end_hour must be > start_hour (split cross-midnight into two entries)")


def _validate_date(s: str) -> None:
    try:
        date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"date must be YYYY-MM-DD, got {s!r}")


def _entry_with_attachments(conn, row) -> dict:
    """Attach a list of attachment metadata to a raw entry row."""
    e = dict(row)
    atts = conn.execute(
        "SELECT id, filename, mime_type, size_bytes, created "
        "FROM hours_attachments WHERE entry_id=? ORDER BY id",
        (e["id"],)
    ).fetchall()
    e["attachments"] = [dict(a) for a in atts]
    return e


# ── endpoints ───────────────────────────────────────────────────────────────
@router.get("/categories")
def list_categories():
    """Static category list — see CATEGORIES module-level constant."""
    return {"categories": CATEGORIES}


@router.get("/entries")
def list_entries(start: str, end: str):
    """List all entries in [start, end] inclusive. Both required to bound
    the query — the week grid always knows its date range, and unbounded
    scans get slow once the log has years of history."""
    _validate_date(start)
    _validate_date(end)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM hours_entries WHERE date_iso >= ? AND date_iso <= ? "
            "ORDER BY date_iso, start_hour",
            (start, end)
        ).fetchall()
        return {"entries": [_entry_with_attachments(conn, r) for r in rows]}


@router.get("/entries/{entry_id}")
def get_entry(entry_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hours_entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "entry not found")
        return _entry_with_attachments(conn, row)


@router.post("/entries")
def create_entry(entry: EntryIn):
    _validate_date(entry.date_iso)
    _validate_hours(entry.start_hour, entry.end_hour)
    if entry.category not in VALID_CATEGORIES:
        raise HTTPException(400, f"category must be one of {sorted(VALID_CATEGORIES)}")
    if entry.workflow_day_date:
        _validate_date(entry.workflow_day_date)
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO hours_entries (date_iso, start_hour, end_hour, category, notes, "
            "workflow_day_date, created) VALUES (?,?,?,?,?,?,?)",
            (entry.date_iso, entry.start_hour, entry.end_hour, entry.category,
             entry.notes, entry.workflow_day_date, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM hours_entries WHERE id=?", (cur.lastrowid,)).fetchone()
        return _entry_with_attachments(conn, row)


@router.patch("/entries/{entry_id}")
def update_entry(entry_id: int, patch: EntryPatch):
    fields = []
    values: List = []
    if patch.start_hour is not None or patch.end_hour is not None:
        # Need both to validate together — read current values for any missing side.
        with get_db() as conn:
            row = conn.execute(
                "SELECT start_hour, end_hour FROM hours_entries WHERE id=?", (entry_id,)
            ).fetchone()
            if not row:
                raise HTTPException(404, "entry not found")
            s = patch.start_hour if patch.start_hour is not None else row["start_hour"]
            e = patch.end_hour if patch.end_hour is not None else row["end_hour"]
            _validate_hours(s, e)
    if patch.category is not None:
        if patch.category not in VALID_CATEGORIES:
            raise HTTPException(400, f"category must be one of {sorted(VALID_CATEGORIES)}")
    if patch.workflow_day_date is not None and patch.workflow_day_date != "":
        _validate_date(patch.workflow_day_date)

    for k, v in patch.model_dump(exclude_unset=True).items():
        # Empty-string workflow_day_date is the "unset" signal — normalise to NULL.
        if k == "workflow_day_date" and v == "":
            v = None
        fields.append(f"{k}=?")
        values.append(v)
    if not fields:
        return get_entry(entry_id)  # no-op patch
    values.append(entry_id)
    with get_db() as conn:
        cur = conn.execute(
            f"UPDATE hours_entries SET {', '.join(fields)} WHERE id=?", values
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "entry not found")
        conn.commit()
        row = conn.execute("SELECT * FROM hours_entries WHERE id=?", (entry_id,)).fetchone()
        return _entry_with_attachments(conn, row)


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int):
    # Delete files on disk before the row so we can't orphan them if the DB
    # commit fails. FK cascade handles the attachment rows.
    with get_db() as conn:
        atts = conn.execute(
            "SELECT file_path FROM hours_attachments WHERE entry_id=?", (entry_id,)
        ).fetchall()
        for a in atts:
            p = HOURS_FILES_DIR / a["file_path"]
            try:
                p.unlink()
            except FileNotFoundError:
                pass  # already gone, still fine
        cur = conn.execute("DELETE FROM hours_attachments WHERE entry_id=?", (entry_id,))
        cur = conn.execute("DELETE FROM hours_entries WHERE id=?", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "entry not found")
        conn.commit()
    return {"deleted": entry_id}


@router.post("/entries/{entry_id}/attachments")
async def upload_attachment(entry_id: int, file: UploadFile = File(...)):
    """Files stored on disk with a UUIDed name to sidestep filename collisions;
    original filename kept in the row for display and download."""
    with get_db() as conn:
        row = conn.execute("SELECT id FROM hours_entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(404, "entry not found")

    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, f"file exceeds {MAX_FILE_BYTES // (1024*1024)}MB limit")

    original = file.filename or "upload"
    # Preserve the extension so downloads work naturally; UUID the stem so
    # two files called "notes.md" don't collide on disk.
    suffix = Path(original).suffix
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    (HOURS_FILES_DIR / stored_name).write_bytes(content)

    mt = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO hours_attachments (entry_id, filename, file_path, mime_type, "
            "size_bytes, created) VALUES (?,?,?,?,?,?)",
            (entry_id, original, stored_name, mt, len(content), now)
        )
        conn.commit()
        return {
            "id": cur.lastrowid, "entry_id": entry_id,
            "filename": original, "mime_type": mt, "size_bytes": len(content),
            "created": now
        }


@router.get("/attachments/{att_id}")
def download_attachment(att_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM hours_attachments WHERE id=?", (att_id,)).fetchone()
    if not row:
        raise HTTPException(404, "attachment not found")
    p = HOURS_FILES_DIR / row["file_path"]
    if not p.exists():
        raise HTTPException(410, "file missing on disk (may have been externally deleted)")
    return FileResponse(str(p), filename=row["filename"], media_type=row["mime_type"])


@router.delete("/attachments/{att_id}")
def delete_attachment(att_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT file_path FROM hours_attachments WHERE id=?", (att_id,)).fetchone()
        if not row:
            raise HTTPException(404, "attachment not found")
        p = HOURS_FILES_DIR / row["file_path"]
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        conn.execute("DELETE FROM hours_attachments WHERE id=?", (att_id,))
        conn.commit()
    return {"deleted": att_id}


@router.get("/workflow-day-suggestions")
def workflow_day_suggestions(date: str):
    """Given a date, tell the client whether a workflow day exists for it.
    Frontend uses this to auto-fill the workflow_day_date field. Also
    returns nearby dates (±3 days) that have workflow days, in case the
    user was writing up work from an adjacent day."""
    _validate_date(date)
    with get_db() as conn:
        # Exact match
        exact = conn.execute(
            "SELECT date, LENGTH(content) AS size FROM day_documents WHERE date=?", (date,)
        ).fetchone()
        # Nearby (±3 days), excluding exact
        from datetime import date as _d, timedelta as _td
        anchor = _d.fromisoformat(date)
        window_start = (anchor - _td(days=3)).isoformat()
        window_end = (anchor + _td(days=3)).isoformat()
        nearby = conn.execute(
            "SELECT date, LENGTH(content) AS size FROM day_documents "
            "WHERE date >= ? AND date <= ? AND date != ? ORDER BY date DESC",
            (window_start, window_end, date)
        ).fetchall()
    return {
        "exact": dict(exact) if exact else None,
        "nearby": [dict(r) for r in nearby]
    }
