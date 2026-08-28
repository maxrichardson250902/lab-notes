"""Papers / Literature — a lightweight reference library.

Design constraints (V0):
  - Metadata + URL only. No PDF storage — papers open in the user's browser
    via their URL/DOI. This removes an entire class of disk/backup concerns.
  - The value here isn't storing papers (Zotero does that better) — it's
    LINKING: a paper_links(paper_id, entity_type, entity_id) table lets any
    feature (protocols today, workflow later, whatever else) attach papers
    to entities and enumerate backlinks the other way.
  - DOI lookup via Crossref's public REST API auto-fills title/authors/
    journal/year from a single paste-and-click.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json, re, urllib.request, urllib.error, urllib.parse

from core.database import register_table, register_seed, get_db


# ── Schema ──────────────────────────────────────────────────────────────────

register_table("papers", """CREATE TABLE IF NOT EXISTS papers (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    doi      TEXT,
    title    TEXT NOT NULL,
    authors  TEXT NOT NULL DEFAULT '[]',
    journal  TEXT NOT NULL DEFAULT '',
    year     INTEGER,
    url      TEXT NOT NULL DEFAULT '',
    abstract TEXT NOT NULL DEFAULT '',
    notes    TEXT NOT NULL DEFAULT '',
    tags     TEXT NOT NULL DEFAULT '[]',
    added    TEXT NOT NULL,
    updated  TEXT NOT NULL)""")

# Generic linking table — any entity that wants to reference papers just
# stores (entity_type, entity_id) tuples. No schema changes needed to add
# new linkable entity types later.
register_table("paper_links", """CREATE TABLE IF NOT EXISTS paper_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id    INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    added       TEXT NOT NULL,
    UNIQUE(paper_id, entity_type, entity_id))""")

# Indexes: unique DOI (only where present — a paper without a DOI should still
# be storable, and multiple NULL-DOI rows must be allowed), plus fast reverse
# lookups from either direction of the link.
def _seed_indexes(conn):
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS papers_doi_unique "
        "ON papers(doi) WHERE doi IS NOT NULL AND doi != ''"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS paper_links_entity "
        "ON paper_links(entity_type, entity_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS paper_links_paper "
        "ON paper_links(paper_id)"
    )
register_seed(_seed_indexes)


router = APIRouter(prefix="/api", tags=["papers"])


# ── Helpers ─────────────────────────────────────────────────────────────────

def _normalise_doi(raw: Optional[str]) -> Optional[str]:
    """Accept a DOI in many forms and reduce to a bare "10.xxxx/yyy".
    Returns None for empty/unparseable input."""
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    # Strip common prefixes users paste from browser address bars.
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^doi:\s*", "", s, flags=re.IGNORECASE)
    s = s.strip()
    # A DOI must start with "10." and contain a slash. Be permissive after.
    if not re.match(r"^10\.\d{2,}/", s):
        return None
    return s


def _row_to_paper(row) -> dict:
    """Turn a sqlite Row into a JSON-ready dict, parsing the JSON columns."""
    d = dict(row)
    for jcol in ("authors", "tags"):
        try:
            d[jcol] = json.loads(d.get(jcol) or "[]")
        except Exception:
            d[jcol] = []
    return d


# ── Crossref lookup ─────────────────────────────────────────────────────────
# Public API, no auth. Polite-pool guidance says to include a contact email in
# the User-Agent. We don't have one to hand so send a generic identifier.

_CROSSREF_UA = "lab-notes/1.0 (mailto:user@example.com)"


def _fetch_crossref(doi: str) -> dict:
    """Look up a DOI on Crossref and return a normalised metadata dict.
    Raises HTTPException on failure — callers decide whether to surface it."""
    url = f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='/')}"
    req = urllib.request.Request(url, headers={"User-Agent": _CROSSREF_UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(404, f"DOI not found on Crossref: {doi}")
        raise HTTPException(502, f"Crossref returned HTTP {e.code}")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"Could not reach Crossref: {e.reason}")
    except Exception as e:
        raise HTTPException(502, f"Crossref request failed: {e}")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(502, "Crossref returned non-JSON response")

    msg = payload.get("message") or {}

    # Title is an array; take the first non-empty.
    title = ""
    for t in (msg.get("title") or []):
        if t and t.strip():
            title = t.strip()
            break

    # Authors: list of {given, family} objects (with variations). Reduce to
    # display strings, preserving order.
    authors = []
    for a in (msg.get("author") or []):
        family = (a.get("family") or "").strip()
        given = (a.get("given") or "").strip()
        if family and given:
            authors.append(f"{given} {family}")
        elif family:
            authors.append(family)
        elif a.get("name"):
            authors.append(a["name"].strip())

    # Journal: container-title is preferred, fall back to short-container-title.
    journal = ""
    for key in ("container-title", "short-container-title"):
        arr = msg.get(key) or []
        if arr and arr[0]:
            journal = arr[0].strip()
            break

    # Year: try issued.date-parts, then published-print, then published-online.
    year = None
    for key in ("issued", "published-print", "published-online", "created"):
        obj = msg.get(key)
        if not obj:
            continue
        parts = (obj.get("date-parts") or [[None]])[0]
        if parts and parts[0]:
            try:
                year = int(parts[0])
                break
            except (TypeError, ValueError):
                continue

    # URL: Crossref returns a canonical DOI URL — use it directly.
    doi_url = msg.get("URL") or f"https://doi.org/{doi}"

    abstract = (msg.get("abstract") or "").strip()
    # Crossref abstracts often come wrapped in <jats:p> tags. Strip crudely.
    if abstract:
        abstract = re.sub(r"</?jats:[^>]+>", "", abstract)
        abstract = re.sub(r"</?p>", "", abstract, flags=re.IGNORECASE).strip()

    return {
        "doi": doi,
        "title": title,
        "authors": authors,
        "journal": journal,
        "year": year,
        "url": doi_url,
        "abstract": abstract,
    }


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/papers/lookup-doi")
def lookup_doi(body: dict):
    """Look up a DOI on Crossref and return metadata for form pre-fill.
    Does NOT save anything. Also reports whether a paper with this DOI already
    exists in the library so the frontend can offer to open it instead."""
    doi = _normalise_doi(body.get("doi"))
    if not doi:
        raise HTTPException(400, "Not a valid DOI. Expected form like 10.xxxx/yyyy.")

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id, title FROM papers WHERE doi=?", (doi,)
        ).fetchone()

    meta = _fetch_crossref(doi)
    return {
        "metadata": meta,
        "existing": dict(existing) if existing else None,
    }


class PaperCreate(BaseModel):
    doi: Optional[str] = None
    title: str
    authors: Optional[List[str]] = None
    journal: Optional[str] = ""
    year: Optional[int] = None
    url: Optional[str] = ""
    abstract: Optional[str] = ""
    notes: Optional[str] = ""
    tags: Optional[List[str]] = None


@router.post("/papers")
def create_paper(body: PaperCreate):
    if not body.title or not body.title.strip():
        raise HTTPException(400, "Title is required")

    doi = _normalise_doi(body.doi) if body.doi else None
    now = datetime.utcnow().isoformat()
    authors_json = json.dumps(body.authors or [])
    tags_json = json.dumps(body.tags or [])

    with get_db() as conn:
        # If a DOI is present, dedupe silently by returning the existing row.
        # This makes "add from picker" idempotent without confusing the user
        # with a scary UNIQUE violation.
        if doi:
            existing = conn.execute(
                "SELECT * FROM papers WHERE doi=?", (doi,)
            ).fetchone()
            if existing:
                return {"paper": _row_to_paper(existing), "duplicate": True}

        cur = conn.execute(
            """INSERT INTO papers
               (doi, title, authors, journal, year, url, abstract, notes, tags, added, updated)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (doi, body.title.strip(), authors_json,
             (body.journal or "").strip(), body.year,
             (body.url or "").strip(), (body.abstract or "").strip(),
             (body.notes or "").strip(), tags_json, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM papers WHERE id=?", (cur.lastrowid,)).fetchone()

    return {"paper": _row_to_paper(row), "duplicate": False}


@router.get("/papers")
def list_papers(q: Optional[str] = None, tag: Optional[str] = None, limit: int = 200):
    """List all papers. Optional case-insensitive search over title/authors/journal.
    Optional tag filter (exact match on any tag)."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM papers ORDER BY year DESC, added DESC"
        ).fetchall()
    items = [_row_to_paper(r) for r in rows]

    if q:
        ql = q.strip().lower()
        def _matches(p):
            if ql in (p["title"] or "").lower():
                return True
            if ql in (p["journal"] or "").lower():
                return True
            for a in p["authors"]:
                if ql in a.lower():
                    return True
            if p.get("doi") and ql in p["doi"].lower():
                return True
            return False
        items = [p for p in items if _matches(p)]

    if tag:
        items = [p for p in items if tag in (p.get("tags") or [])]

    return {"items": items[:limit], "total": len(items)}


@router.get("/papers/{paper_id}")
def get_paper(paper_id: int):
    """Return a paper along with its links (backlinks to protocols, workflow entries, etc)."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM papers WHERE id=?", (paper_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Paper not found")
        link_rows = conn.execute(
            "SELECT id, entity_type, entity_id, added "
            "FROM paper_links WHERE paper_id=? ORDER BY added DESC",
            (paper_id,),
        ).fetchall()

    return {
        "paper": _row_to_paper(row),
        "links": [dict(r) for r in link_rows],
    }


class PaperUpdate(BaseModel):
    doi: Optional[str] = None
    title: Optional[str] = None
    authors: Optional[List[str]] = None
    journal: Optional[str] = None
    year: Optional[int] = None
    url: Optional[str] = None
    abstract: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


@router.put("/papers/{paper_id}")
def update_paper(paper_id: int, body: PaperUpdate):
    now = datetime.utcnow().isoformat()
    fields = []
    values = []

    def set_col(col, val):
        fields.append(f"{col}=?")
        values.append(val)

    if body.doi is not None:
        set_col("doi", _normalise_doi(body.doi))
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "Title cannot be empty")
        set_col("title", title)
    if body.authors is not None:
        set_col("authors", json.dumps(body.authors))
    if body.journal is not None:
        set_col("journal", body.journal.strip())
    if body.year is not None:
        set_col("year", body.year)
    if body.url is not None:
        set_col("url", body.url.strip())
    if body.abstract is not None:
        set_col("abstract", body.abstract.strip())
    if body.notes is not None:
        set_col("notes", body.notes.strip())
    if body.tags is not None:
        set_col("tags", json.dumps(body.tags))

    if not fields:
        raise HTTPException(400, "Nothing to update")

    set_col("updated", now)
    values.append(paper_id)

    with get_db() as conn:
        # Fields is built from a small allow-list above, so the join is safe.
        conn.execute(f"UPDATE papers SET {', '.join(fields)} WHERE id=?", values)
        if conn.total_changes == 0:
            raise HTTPException(404, "Paper not found")
        conn.commit()
        row = conn.execute("SELECT * FROM papers WHERE id=?", (paper_id,)).fetchone()

    return {"paper": _row_to_paper(row)}


@router.delete("/papers/{paper_id}")
def delete_paper(paper_id: int):
    """Delete a paper. Cascades to its links (so protocols/entries just lose
    the reference — they don't error). If you want to protect against
    accidental deletes when links exist, catch this in the UI, not the API."""
    with get_db() as conn:
        row = conn.execute("SELECT id FROM papers WHERE id=?", (paper_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Paper not found")
        conn.execute("DELETE FROM paper_links WHERE paper_id=?", (paper_id,))
        conn.execute("DELETE FROM papers WHERE id=?", (paper_id,))
        conn.commit()
    return {"ok": True}


# ── Links ───────────────────────────────────────────────────────────────────

class LinkCreate(BaseModel):
    entity_type: str
    entity_id: str   # stored as TEXT so it works for INTEGER PKs, date strings, UUIDs alike


# Basic sanity guard so callers can't invent arbitrary entity types by accident.
# Extend as new features want to link to papers.
_ALLOWED_ENTITY_TYPES = {
    "protocol",
    "workflow_day",
    "workflow_entry",
    "pipeline_step",   # a single step inside a pipeline (DAG node)
    "reminder",        # a todo item
    "project",         # a project identified by its group_name string
}


@router.post("/papers/{paper_id}/links")
def add_link(paper_id: int, body: LinkCreate):
    et = body.entity_type.strip()
    ei = body.entity_id.strip()
    if et not in _ALLOWED_ENTITY_TYPES:
        raise HTTPException(400, f"entity_type must be one of {sorted(_ALLOWED_ENTITY_TYPES)}")
    if not ei:
        raise HTTPException(400, "entity_id is required")

    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        # Confirm the paper exists — the FK isn't enforced by SQLite by default
        # (foreign_keys pragma not set on this connection).
        pap = conn.execute("SELECT id FROM papers WHERE id=?", (paper_id,)).fetchone()
        if not pap:
            raise HTTPException(404, "Paper not found")

        # UNIQUE constraint makes duplicate links a no-op rather than an error.
        conn.execute(
            "INSERT OR IGNORE INTO paper_links "
            "(paper_id, entity_type, entity_id, added) VALUES (?,?,?,?)",
            (paper_id, et, ei, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, paper_id, entity_type, entity_id, added FROM paper_links "
            "WHERE paper_id=? AND entity_type=? AND entity_id=?",
            (paper_id, et, ei),
        ).fetchone()

    return {"link": dict(row) if row else None}


@router.delete("/papers/links/{link_id}")
def delete_link(link_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM paper_links WHERE id=?", (link_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Link not found")
        conn.execute("DELETE FROM paper_links WHERE id=?", (link_id,))
        conn.commit()
    return {"ok": True}


@router.get("/papers/for-entity/{entity_type}/{entity_id}")
def papers_for_entity(entity_type: str, entity_id: str):
    """List papers linked to a given entity. Used by other features to render
    their "References" section without knowing anything about the papers
    schema — just call this and render the returned list."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT p.*, pl.id AS link_id, pl.added AS linked_at
               FROM paper_links pl
               JOIN papers p ON p.id = pl.paper_id
               WHERE pl.entity_type = ? AND pl.entity_id = ?
               ORDER BY pl.added DESC""",
            (entity_type, entity_id),
        ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        for jcol in ("authors", "tags"):
            try:
                d[jcol] = json.loads(d.get(jcol) or "[]")
            except Exception:
                d[jcol] = []
        items.append(d)
    return {"items": items}


@router.get("/papers/tags/all")
def list_all_tags():
    """Return every distinct tag across the library, sorted by frequency."""
    counts: dict[str, int] = {}
    with get_db() as conn:
        rows = conn.execute("SELECT tags FROM papers").fetchall()
    for r in rows:
        try:
            for t in json.loads(r["tags"] or "[]"):
                if t:
                    counts[t] = counts.get(t, 0) + 1
        except Exception:
            continue
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    return {"tags": [{"tag": t, "count": c} for t, c in ordered]}
