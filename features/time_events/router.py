"""Unified time-event stream — answers "what happened when" across three sources
that would otherwise each need bespoke parsing.

Sources:
  1. Step ticks in protocol runs — stored in this table because scratch's
     active_runs only holds current state (steps_json), not history. When
     a step gets toggled, the frontend POSTs to /api/time-events/log with
     the current wall-clock timestamp. Honest logging: what got recorded
     is when the user clicked, even if they were catching up on ticks
     they'd forgotten.
  2. Hours entries — re-parsed live from hours_entries table. Not stored
     here because there's already a source of truth; duplicating would
     create sync drift.
  3. Workflow doc time chips — re-parsed live from day_documents.content.
     Same reason: source of truth is the doc.

The read endpoints merge all three chronologically so callers see a
single unified stream.

Filtering for hours workflow-copy:
  When consecutive step_done events from the same run land within 60s of
  each other, the read endpoint collapses them into one summary event.
  This is the "spam-catchup" case where the user forgot to tick and is
  now rapidly hitting the checkbox on multiple steps at once — display
  as "Steps 3-7 marked done" rather than five noisy time-adjacent
  lines.
"""
import re
import json
import html as html_lib
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.database import register_table, get_db


# ── constants ───────────────────────────────────────────────────────────────
# Threshold below which consecutive same-run step_done events are collapsed
# into one summary event on read. 60s handles typical spam-catchup while
# still separating meaningfully-spaced ticks.
COLLAPSE_THRESHOLD_SECONDS = 60

# Time-chip regex: <span class="wf-time" ...>HH:MM</span>  content
# The chip sits at the start of a block, followed by the block's content.
# We extract time + everything up to the next chip or closing tag.
TIME_CHIP_RE = re.compile(
    r'<span[^>]*class="wf-time"[^>]*>\s*([^<]+?)\s*</span>\s*(.*?)(?=<span[^>]*class="wf-time"|</(?:p|div)>|$)',
    re.DOTALL | re.IGNORECASE
)

# Valid event_types — extendable. Kept as a set so unknown types get rejected
# at write time rather than silently accepted.
VALID_EVENT_TYPES = {
    "step_done", "step_undone",
    # hours_period_* and workflow_chip are synthesised on read (not written)
}
VALID_SOURCE_TYPES = {
    "protocol_run", "hours_entry", "workflow_day"
}


# ── table ───────────────────────────────────────────────────────────────────
register_table("time_events", """CREATE TABLE IF NOT EXISTS time_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_iso        TEXT NOT NULL,
    date_iso      TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    source_type   TEXT NOT NULL,
    source_id     TEXT NOT NULL,
    content       TEXT DEFAULT '',
    group_name    TEXT DEFAULT NULL,
    metadata_json TEXT DEFAULT NULL
)""")

# Indexes for the two most common query shapes: by-date (dashboard, hours
# copy-from-workflow) and by-source (rebuild a run's step-tick history).
def _ensure_indexes(conn):
    conn.execute("CREATE INDEX IF NOT EXISTS ix_time_events_date ON time_events(date_iso)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_time_events_ts   ON time_events(ts_iso)")
    conn.execute("CREATE INDEX IF NOT EXISTS ix_time_events_source ON time_events(source_type, source_id)")

from core.database import register_seed
register_seed(_ensure_indexes)


# ── models ──────────────────────────────────────────────────────────────────
class EventIn(BaseModel):
    ts_iso: str
    event_type: str
    source_type: str
    source_id: str
    content: Optional[str] = ""
    group_name: Optional[str] = None
    metadata: Optional[dict] = None


router = APIRouter(prefix="/api/time-events", tags=["time-events"])


# ── helpers ─────────────────────────────────────────────────────────────────
def _validate_ts(ts: str) -> str:
    """Accept ISO-8601 with or without timezone. Extract YYYY-MM-DD for indexing."""
    try:
        # datetime.fromisoformat handles both naive and aware ISO.
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"ts_iso must be ISO-8601, got {ts!r}")
    return dt.date().isoformat()


def _hhmm_to_minutes(hhmm: str) -> Optional[int]:
    """'10:30' -> 630. Returns None on unparseable input so we can drop
    junk chips without crashing the whole endpoint."""
    m = re.match(r"^(\d{1,2}):(\d{2})", (hhmm or "").strip())
    if not m:
        return None
    h, mm = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mm <= 59):
        return None
    return h * 60 + mm


def _strip_html(s: str) -> str:
    """Fast, lossy HTML→text for chip content. Fine for hours notes; we're
    not trying to preserve markup."""
    return re.sub(r"<[^>]+>", "", s or "").strip()


def _parse_workflow_chips(day_iso: str, doc_html: str) -> List[dict]:
    """Extract wf-time chips from a workflow day document.

    Returns synthetic events in the same shape as stored ones so the read
    endpoint can merge without special-casing. Chips whose time can't be
    parsed are dropped."""
    events = []
    for match in TIME_CHIP_RE.finditer(doc_html or ""):
        time_str, following = match.group(1), match.group(2)
        minutes = _hhmm_to_minutes(time_str)
        if minutes is None:
            continue
        # Synthesise a full ISO timestamp on the day's date. Timezone-naive
        # because the source chip is naive; downstream comparisons stay
        # internally consistent.
        h, mm = divmod(minutes, 60)
        ts = f"{day_iso}T{h:02d}:{mm:02d}:00"
        events.append({
            "id": None,  # synthetic
            "ts_iso": ts,
            "date_iso": day_iso,
            "event_type": "workflow_chip",
            "source_type": "workflow_day",
            "source_id": day_iso,
            "content": _strip_html(following)[:500],  # truncate paranoia
            "group_name": None,
            "metadata_json": None,
        })
    return events


def _hours_entries_as_events(conn, day_iso: str) -> List[dict]:
    """Turn hours_entries rows for a date into synthetic events. One event
    per entry, timestamped at start_hour."""
    rows = conn.execute(
        "SELECT * FROM hours_entries WHERE date_iso=?",
        (day_iso,)
    ).fetchall()
    events = []
    for r in rows:
        d = dict(r)
        ts = f"{day_iso}T{d['start_hour']:02d}:00:00"
        content = f"[{d['category']}]"
        if d.get("notes"):
            content += f" {d['notes'][:200]}"
        events.append({
            "id": None,
            "ts_iso": ts,
            "date_iso": day_iso,
            "event_type": "hours_period",
            "source_type": "hours_entry",
            "source_id": str(d["id"]),
            "content": content,
            "group_name": None,
            "metadata_json": json.dumps({
                "start_hour": d["start_hour"], "end_hour": d["end_hour"],
                "category": d["category"], "workflow_day_date": d.get("workflow_day_date"),
            }),
        })
    return events


def _collapse_step_events(events: List[dict]) -> List[dict]:
    """Collapse consecutive step_done events from the same source_id within
    COLLAPSE_THRESHOLD_SECONDS. The catch-up case: rapid clicking to mark
    several steps done at once should read as one "Steps X-Y done" line.

    events must be pre-sorted by ts_iso ascending."""
    if not events:
        return events
    out = []
    buf: List[dict] = []

    def flush():
        if not buf:
            return
        if len(buf) == 1:
            out.append(buf[0])
        else:
            # Extract step numbers from content ("Step N: ...") for the summary.
            step_nums = []
            for e in buf:
                m = re.match(r"Step (\d+)", e.get("content") or "")
                if m:
                    step_nums.append(int(m.group(1)))
            if step_nums:
                nums_sorted = sorted(set(step_nums))
                nums_str = f"{nums_sorted[0]}-{nums_sorted[-1]}" if len(nums_sorted) > 1 else str(nums_sorted[0])
                summary = f"Steps {nums_str} marked done"
            else:
                summary = f"{len(buf)} steps marked done"
            first = buf[0]
            out.append({
                **first,
                "content": summary,
                "metadata_json": json.dumps({"collapsed_count": len(buf)}),
            })

    for e in events:
        if e.get("event_type") != "step_done":
            flush(); buf = []
            out.append(e)
            continue
        if not buf:
            buf.append(e)
            continue
        prev = buf[-1]
        if prev.get("source_id") != e.get("source_id"):
            flush(); buf = [e]
            continue
        try:
            t_prev = datetime.fromisoformat(prev["ts_iso"].replace("Z", "+00:00"))
            t_cur  = datetime.fromisoformat(e["ts_iso"].replace("Z", "+00:00"))
        except ValueError:
            flush(); buf = [e]
            continue
        if (t_cur - t_prev).total_seconds() <= COLLAPSE_THRESHOLD_SECONDS:
            buf.append(e)
        else:
            flush(); buf = [e]
    flush()
    return out


def _load_day_doc(conn, day_iso: str) -> str:
    row = conn.execute(
        "SELECT content FROM day_documents WHERE date=?", (day_iso,)
    ).fetchone()
    return row["content"] if row else ""


# ── endpoints ───────────────────────────────────────────────────────────────
@router.post("/log")
def log_event(event: EventIn):
    """Write a single event. Currently used by scratch.js on step toggle;
    generic enough for future writers."""
    if event.event_type not in VALID_EVENT_TYPES:
        raise HTTPException(400, f"event_type must be one of {sorted(VALID_EVENT_TYPES)}")
    if event.source_type not in VALID_SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be one of {sorted(VALID_SOURCE_TYPES)}")
    date_iso = _validate_ts(event.ts_iso)
    meta = json.dumps(event.metadata) if event.metadata is not None else None
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO time_events (ts_iso, date_iso, event_type, source_type, "
            "source_id, content, group_name, metadata_json) VALUES (?,?,?,?,?,?,?,?)",
            (event.ts_iso, date_iso, event.event_type, event.source_type,
             event.source_id, event.content or "", event.group_name, meta)
        )
        conn.commit()
        return {"id": cur.lastrowid}


@router.get("/for-date")
def events_for_date(date: str, collapse: bool = False):
    """All events for a calendar date, merged from all three sources,
    chronologically sorted. Set collapse=true to fold same-run step_done
    within COLLAPSE_THRESHOLD_SECONDS into summary events."""
    try:
        date_iso = datetime.fromisoformat(date).date().isoformat()
    except ValueError:
        raise HTTPException(400, f"date must be YYYY-MM-DD, got {date!r}")

    with get_db() as conn:
        # Stored events (step ticks)
        stored = [dict(r) for r in conn.execute(
            "SELECT * FROM time_events WHERE date_iso=? ORDER BY ts_iso ASC",
            (date_iso,)
        ).fetchall()]
        # Synthetic: hours entries on this date
        hours_evs = _hours_entries_as_events(conn, date_iso)
        # Synthetic: workflow chips from doc
        doc = _load_day_doc(conn, date_iso)
        chip_evs = _parse_workflow_chips(date_iso, doc) if doc else []

    merged = stored + hours_evs + chip_evs
    merged.sort(key=lambda e: e["ts_iso"])
    if collapse:
        merged = _collapse_step_events(merged)
    return {"date": date_iso, "events": merged}


@router.get("/for-hour-range")
def events_for_hour_range(date: str, start_hour: int, end_hour: int):
    """Filter events to a specific hour range and format as a text block
    ready for pasting into an hours entry's notes field. Always collapses
    step_done spam-catchup. Excludes hours_period events (recursive).
    """
    if not (0 <= start_hour <= 23):
        raise HTTPException(400, "start_hour must be 0..23")
    if not (1 <= end_hour <= 24):
        raise HTTPException(400, "end_hour must be 1..24")
    if end_hour <= start_hour:
        raise HTTPException(400, "end_hour must be > start_hour")

    payload = events_for_date(date, collapse=True)
    date_iso = payload["date"]
    filtered = []
    for e in payload["events"]:
        # Exclude hours_period so a copy-into-notes doesn't recurse into
        # another hours entry's own content.
        if e.get("source_type") == "hours_entry":
            continue
        try:
            t = datetime.fromisoformat(e["ts_iso"].replace("Z", "+00:00"))
        except ValueError:
            continue
        h = t.hour
        if start_hour <= h < end_hour:
            filtered.append(e)

    # Render as plain text lines. Chip events → "HH:MM content", step events →
    # "HH:MM [protocol_title] content".
    lines = []
    for e in filtered:
        try:
            t = datetime.fromisoformat(e["ts_iso"].replace("Z", "+00:00"))
        except ValueError:
            continue
        stamp = t.strftime("%H:%M")
        content = e.get("content") or ""
        if e.get("event_type") in ("step_done", "step_undone"):
            proto = ""
            try:
                if e.get("metadata_json"):
                    m = json.loads(e["metadata_json"])
                    if m.get("protocol_title"):
                        proto = f"[{m['protocol_title']}] "
            except (ValueError, TypeError):
                pass
            lines.append(f"{stamp} — {proto}{content}")
        else:
            lines.append(f"{stamp} — {content}")

    rendered_text = "\n".join(lines) if lines else ""
    return {"date": date_iso, "start_hour": start_hour, "end_hour": end_hour,
            "events": filtered, "rendered_text": rendered_text}


@router.delete("/by-source/{source_type}/{source_id}")
def delete_events_by_source(source_type: str, source_id: str):
    """Cascade cleanup — used when a protocol run is abandoned or an
    hours entry deleted, to remove its stored events."""
    if source_type not in VALID_SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be one of {sorted(VALID_SOURCE_TYPES)}")
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM time_events WHERE source_type=? AND source_id=?",
            (source_type, source_id)
        )
        conn.commit()
    return {"deleted": cur.rowcount}
