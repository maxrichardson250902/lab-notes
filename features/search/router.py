"""Global search across the database.

Single endpoint that fans out to every searchable table, normalises terms, and
returns ranked unified results. Designed for the Ctrl+K modal — fast enough to
run on every keystroke (after a 200ms debounce in the frontend).

Implementation choice: keyword `LIKE '%term%'` rather than FTS5.
FTS5 would be the "right" answer for >10k rows, but at this scale (typically a
few hundred per table) it's overkill, and the trigger-based sync needed to keep
the virtual table consistent adds real complexity for no perceptible gain.
We get cheap pseudo-stemming by lowercasing both sides and stripping trailing 's'
from query terms, which handles the only stem case that comes up in practice
(plurals).
"""

from fastapi import APIRouter, Query
from typing import Optional
import re

from core.database import get_db

router = APIRouter(prefix="/api", tags=["search"])


def _normalise_terms(q: str) -> list[str]:
    """Split query into AND-able terms. Trailing 's' is stripped so 'primers'
    matches 'primer'. Empty terms (e.g. multiple spaces) are filtered out.
    Very short terms (<2 chars) are kept — sometimes you do search for 'a' or
    'b' if it's part of a gene name like 'pET28a'."""
    q = (q or "").strip().lower()
    if not q:
        return []
    # Split on whitespace + common punctuation, keep alphanumerics + a few
    # bio-relevant chars (hyphen, underscore, dot).
    raw = re.split(r"[\s,;:()/\\\\]+", q)
    out = []
    for t in raw:
        t = t.strip()
        if not t:
            continue
        # Strip trailing 's' for naive plural matching, but only if length > 2
        # — don't strip 's' from 'is' or 'as'.
        if len(t) > 2 and t.endswith("s"):
            t = t[:-1]
        out.append(t)
    return out


def _matches(row_text: str, terms: list[str]) -> bool:
    """All terms must appear in the row text (AND semantics).
    Case-insensitive — caller's row_text is already lowercased."""
    if not terms:
        return False
    return all(t in row_text for t in terms)


# Per-source query config:
#   table:    SQLite table name
#   id_col:   primary key column
#   cols:     columns whose text content is searched (concatenated for matching)
#   title:    column to use as the result title
#   subtitle: column to use as subtitle (or None)
#   kind:     category label returned to the frontend
#   nav:      hint for click-through: {view: 'notebook', params: {entry_id: <id>}}
_SOURCES = [
    {
        "table": "entries", "id_col": "id",
        "cols": ["title", "group_name", "subgroup", "notes", "results", "issues", "yields"],
        "title": "title", "subtitle": "group_name",
        "kind": "Notebook entry", "view": "notebook",
    },
    {
        "table": "protocols", "id_col": "id",
        "cols": ["title", "notes", "tags", "source_text"],
        "title": "title", "subtitle": None,
        "kind": "Protocol", "view": "protocols",
    },
    {
        "table": "primers", "id_col": "id",
        "cols": ["name", "sequence", "use", "project"],
        "title": "name", "subtitle": "use",
        "kind": "Primer", "view": "import_data",
    },
    {
        "table": "plasmids", "id_col": "id",
        "cols": ["name", "use", "project"],
        "title": "name", "subtitle": "use",
        "kind": "Plasmid", "view": "import_data",
    },
    {
        "table": "gblocks", "id_col": "id",
        "cols": ["name", "sequence", "use", "notes", "project"],
        "title": "name", "subtitle": "project",
        "kind": "gBlock", "view": "import_data",
    },
    {
        "table": "kit_parts", "id_col": "id",
        "cols": ["name", "kit_name", "part_type", "description"],
        "title": "name", "subtitle": "kit_name",
        "kind": "Kit part", "view": "import_data",
    },
    {
        "table": "parts", "id_col": "id",
        "cols": ["name", "description", "sequence", "project", "subcategory", "part_type", "notes"],
        "title": "name", "subtitle": "project",
        "kind": "Part", "view": "import_data",
    },
]


def _safe_get(row, col):
    """Some tables don't have all columns we list; handle missing gracefully."""
    try:
        return row[col] if row[col] is not None else ""
    except (IndexError, KeyError):
        return ""


def _row_text(row, cols) -> str:
    """Lowercase concatenation of all search columns, used for matching."""
    return " ".join(str(_safe_get(row, c)) for c in cols).lower()


def _score(row_text: str, terms: list[str], title_lc: str) -> int:
    """Rough relevance score. Higher = better.
       +10 per term found at all
       +5 per term in title
       +20 if title starts with the first term (e.g. searching 'gfp' finds 'GFP_var1' first)"""
    s = 0
    for t in terms:
        if t in row_text:
            s += 10
        if t in title_lc:
            s += 5
    if terms and title_lc.startswith(terms[0]):
        s += 20
    return s


@router.get("/search")
def global_search(q: str = Query(""), limit: int = Query(40)):
    """Search across all configured sources. Returns up to `limit` results,
    ranked. Empty/short queries return an empty result set rather than
    flooding the response with random data."""
    terms = _normalise_terms(q)
    if not terms or all(len(t) < 2 for t in terms):
        return {"q": q, "results": [], "categories": {}}

    # SQL-side pre-filter using the LONGEST term as a LIKE filter — drastically
    # narrows the row count before Python-side AND-matching against all terms.
    # Picking the longest term gives the most selectivity (e.g. "expression" is
    # a stronger filter than "of").
    pivot = max(terms, key=len)
    pivot_pat = f"%{pivot}%"

    results: list[dict] = []

    with get_db() as conn:
        for src in _SOURCES:
            # Build a LIKE across all search cols using the pivot term.
            like_clauses = " OR ".join(
                [f"LOWER(COALESCE({c}, '')) LIKE ?" for c in src["cols"]]
            )
            sql = (
                f"SELECT * FROM {src['table']} "
                f"WHERE {like_clauses} "
                f"LIMIT 200"  # cap per-table to keep things fast
            )
            params = [pivot_pat] * len(src["cols"])
            try:
                rows = conn.execute(sql, params).fetchall()
            except Exception:
                # Table doesn't exist or column missing — skip silently.
                continue

            for r in rows:
                text_blob = _row_text(r, src["cols"])
                if not _matches(text_blob, terms):
                    continue
                title = str(_safe_get(r, src["title"]) or "(no title)")
                subtitle = (
                    str(_safe_get(r, src["subtitle"]) or "")
                    if src["subtitle"] else ""
                )
                title_lc = title.lower()
                results.append({
                    "kind": src["kind"],
                    "table": src["table"],
                    "id": r[src["id_col"]],
                    "title": title,
                    "subtitle": subtitle,
                    "view": src["view"],
                    "score": _score(text_blob, terms, title_lc),
                })

    # Sort by score desc, then title for stability
    results.sort(key=lambda x: (-x["score"], x["title"].lower()))
    results = results[:limit]

    # Bucket by category for the frontend's filter tabs
    categories: dict[str, int] = {}
    for r in results:
        categories[r["kind"]] = categories.get(r["kind"], 0) + 1

    return {"q": q, "results": results, "categories": categories}
