"""Projects — the app's canonical registry of project/group names.

Design notes:
- Name is the primary key. Other tables (entries, workflow_entries, reminders,
  data-groups in day_documents, etc.) reference by name string, not by id. This
  is loose coupling — no destructive migration needed, and renaming a project
  is intentionally not supported (would require cross-table string updates).
- The table stores metadata: colour override, description. If a name appears
  in data-groups or entries but has no row here, treat it as an implicit
  project — the list endpoint surfaces both together.
- On first startup, `_seed_projects` populates the table with every name
  found across the existing data sources so users don't have to re-add them.
  Idempotent — only inserts names not already in the table.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import re

from core.database import register_table, register_seed, get_db


register_table("projects", """CREATE TABLE IF NOT EXISTS projects (
    name           TEXT PRIMARY KEY,
    color_override TEXT,
    description    TEXT NOT NULL DEFAULT '',
    created        TEXT NOT NULL,
    updated        TEXT NOT NULL)""")


def _seed_projects(conn):
    """One-off seed on startup: bring across every project/group name that
    already exists in the app so the registry starts populated. Runs each
    startup but only touches names not already registered."""
    now = datetime.utcnow().isoformat()
    known: set[str] = set()

    def _safe(sql: str, params: tuple = ()):
        try:
            for r in conn.execute(sql, params):
                # First column value — index-access works for both sqlite3.Row
                # and plain tuple rows. Avoid `.get()` which sqlite3.Row lacks.
                try:
                    v = r[0]
                except (IndexError, KeyError):
                    v = None
                if v and isinstance(v, str) and v.strip():
                    known.add(v.strip())
        except Exception:
            # Table might not exist yet on very fresh DBs — silent skip
            pass

    _safe("SELECT DISTINCT group_name FROM entries WHERE group_name IS NOT NULL AND group_name != ''")
    _safe("SELECT DISTINCT group_name FROM workflow_entries WHERE group_name IS NOT NULL AND group_name != ''")
    _safe("SELECT DISTINCT group_name FROM reminders WHERE group_name IS NOT NULL AND group_name != ''")
    _safe("SELECT name FROM pipelines")
    # DNA-domain tables use `project` (not `group_name`) as the column name —
    # same concept, different history. Union everything into one registry.
    for tbl in ("primers", "plasmids", "gblocks", "kit_parts", "parts"):
        _safe(f"SELECT DISTINCT project FROM {tbl} WHERE project IS NOT NULL AND project != ''")

    # Scan day_documents.content for data-groups attributes.
    try:
        for r in conn.execute("SELECT content FROM day_documents WHERE content != ''"):
            content = r[0] if not hasattr(r, 'keys') else r["content"]
            if not content:
                continue
            for m in re.finditer(r'data-groups="([^"]+)"', content):
                for g in m.group(1).split(","):
                    g = g.strip()
                    if g:
                        known.add(g)
    except Exception:
        pass

    for name in sorted(known):
        conn.execute(
            "INSERT OR IGNORE INTO projects (name, color_override, description, created, updated) "
            "VALUES (?, NULL, '', ?, ?)",
            (name, now, now)
        )


register_seed(_seed_projects)


router = APIRouter(prefix="/api", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    color_override: Optional[str] = None
    description: Optional[str] = ""


class ProjectUpdate(BaseModel):
    color_override: Optional[str] = None
    description: Optional[str] = None


def _hash_hue(name: str) -> int:
    """Deterministic name → hue 0..359. Matches the client-side hash exactly
    (djb2 variant) so a project rendered server-side (PDFs) picks the same
    colour as the browser."""
    h = 5381
    for ch in name:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    return h % 360


def _collect_project_stats() -> dict:
    """Return {name: {day_count, entry_count, dna_count}} for every name that
    appears anywhere in the app, whether or not it's in the projects table.
    Also returns a parallel {name: [subcategories]} dict for DNA-domain
    subcategories, so callers (e.g., DNA project pickers) can preserve their
    subcategory autocomplete."""
    stats: dict = {}
    subcategories: dict = {}

    def _ensure(name: str):
        if name not in stats:
            stats[name] = {"day_count": 0, "entry_count": 0, "dna_count": 0}

    with get_db() as conn:
        for r in conn.execute("SELECT content FROM day_documents WHERE content != ''"):
            content = r[0] if not hasattr(r, 'keys') else r["content"]
            if not content:
                continue
            seen_this_day: set[str] = set()
            for m in re.finditer(r'data-groups="([^"]+)"', content):
                for g in m.group(1).split(","):
                    g = g.strip()
                    if g and g not in seen_this_day:
                        seen_this_day.add(g)
                        _ensure(g)
                        stats[g]["day_count"] += 1

        try:
            for r in conn.execute(
                "SELECT group_name, COUNT(*) as c FROM entries "
                "WHERE group_name IS NOT NULL AND group_name != '' GROUP BY group_name"
            ):
                name = r[0]
                count = r[1]
                _ensure(name)
                stats[name]["entry_count"] = count
        except Exception:
            pass

        # DNA-domain: count items per project across primers/plasmids/gblocks/kit_parts/parts
        # and collect subcategories per project.
        for tbl in ("primers", "plasmids", "gblocks", "kit_parts", "parts"):
            try:
                for r in conn.execute(
                    f"SELECT project, subcategory, COUNT(*) as c FROM {tbl} "
                    f"WHERE project IS NOT NULL AND project != '' "
                    f"GROUP BY project, subcategory"
                ):
                    name = r[0]
                    sub  = r[1] or ""
                    count = r[2]
                    _ensure(name)
                    stats[name]["dna_count"] += count
                    if sub:
                        subcategories.setdefault(name, set()).add(sub)
            except Exception:
                pass

    # Convert subcategory sets to sorted lists
    subcategories_out = {k: sorted(v) for k, v in subcategories.items()}
    return {"stats": stats, "subcategories": subcategories_out}


@router.get("/projects")
def list_projects():
    """Return every known project name with metadata + usage stats. Merges the
    `projects` table (registry) with implicit references (data-groups, DNA-domain
    project columns, entries.group_name). Also includes subcategories per
    project so DNA-view pickers can populate their two-level autocomplete."""
    stats_bundle = _collect_project_stats()
    stats = stats_bundle["stats"]
    subcategories = stats_bundle["subcategories"]
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY name ASC").fetchall()

    # Merge: start from the registry table, then fold in stats. Any stats-only
    # names (present in data-groups but not registered yet) come next.
    projects = {}
    for r in rows:
        d = dict(r)
        s = stats.get(d["name"], {})
        d["day_count"]   = s.get("day_count", 0)
        d["entry_count"] = s.get("entry_count", 0)
        d["dna_count"]   = s.get("dna_count", 0)
        d["hue"] = _hash_hue(d["name"])  # client can override with color_override
        projects[d["name"]] = d

    for name, s in stats.items():
        if name not in projects:
            projects[name] = {
                "name": name,
                "color_override": None,
                "description": "",
                "created": None,
                "updated": None,
                "day_count":   s["day_count"],
                "entry_count": s["entry_count"],
                "dna_count":   s["dna_count"],
                "hue": _hash_hue(name),
            }

    items = list(projects.values())
    # Sort: most-used first (across all sources), then alphabetical
    items.sort(key=lambda x: (-(x["day_count"] + x["entry_count"] + x["dna_count"]),
                              x["name"].lower()))
    return {"projects": items, "subcategories": subcategories}


@router.post("/projects")
def create_project(body: ProjectCreate):
    """Add a project to the registry. Idempotent via INSERT OR IGNORE."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO projects (name, color_override, description, created, updated) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, body.color_override, body.description or "", now, now)
        )
        row = conn.execute("SELECT * FROM projects WHERE name = ?", (name,)).fetchone()
    d = dict(row) if row else {"name": name}
    d["hue"] = _hash_hue(name)
    return d


@router.put("/projects/{name}")
def update_project(name: str, body: ProjectUpdate):
    """Update color_override or description. Auto-creates the row if absent so
    calling PUT with a colour on an implicit-only project just works."""
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM projects WHERE name = ?", (name,)).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO projects (name, color_override, description, created, updated) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, body.color_override, body.description or "", now, now)
            )
        else:
            fields, values = [], []
            if body.color_override is not None:
                fields.append("color_override = ?")
                values.append(body.color_override or None)  # empty string → NULL, treats "" as clear
            if body.description is not None:
                fields.append("description = ?")
                values.append(body.description)
            if fields:
                fields.append("updated = ?")
                values.append(now)
                values.append(name)
                conn.execute(f"UPDATE projects SET {', '.join(fields)} WHERE name = ?", values)
        row = conn.execute("SELECT * FROM projects WHERE name = ?", (name,)).fetchone()
    d = dict(row)
    d["hue"] = _hash_hue(name)
    return d


@router.delete("/projects/{name}")
def delete_project(name: str):
    """Remove metadata row for a project. Does NOT touch data-groups values
    in any block, or any entries.group_name references — those are strings
    pointing at nothing, effectively an "implicit" project again."""
    with get_db() as conn:
        cur = conn.execute("DELETE FROM projects WHERE name = ?", (name,))
    return {"deleted": cur.rowcount}
