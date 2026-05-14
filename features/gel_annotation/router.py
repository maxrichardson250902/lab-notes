"""Gel Annotation Station — upload gel images, label lanes, mark ladders, link to inventory."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os, json, uuid, re
from core.database import register_table, register_seed, get_db

UPLOAD_DIR = "/data/gel_images"
LADDER_IMG_DIR = "/data/ladder_images"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(LADDER_IMG_DIR, exist_ok=True)

register_table("gels", """CREATE TABLE IF NOT EXISTS gels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    image_file  TEXT NOT NULL,
    gel_type    TEXT DEFAULT 'dna',
    ladder_type TEXT,
    entry_id    INTEGER,
    annotations TEXT DEFAULT '{}',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL
)""")

register_table("gel_lanes", """CREATE TABLE IF NOT EXISTS gel_lanes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    gel_id        INTEGER NOT NULL,
    lane_number   INTEGER NOT NULL,
    sample_name   TEXT,
    is_ladder     INTEGER DEFAULT 0,
    primer_id     INTEGER,
    plasmid_id    INTEGER,
    expected_size TEXT,
    observed_size TEXT,
    notes         TEXT,
    x_position    REAL,
    created       TEXT NOT NULL
)""")

# Ladder catalogue. `slug` is the stable id used by gels.ladder_type. Sizes are
# stored as JSON of integers, top-of-gel first (i.e. largest first for DNA;
# largest-protein-first for protein ladders by convention).
register_table("gel_ladders", """CREATE TABLE IF NOT EXISTS gel_ladders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'dna',
    sizes_json  TEXT NOT NULL,
    image_file  TEXT,
    is_preset   INTEGER NOT NULL DEFAULT 0,
    created     TEXT NOT NULL
)""")


# ── Preset seed ──────────────────────────────────────────────────────────────
# Seeded on first startup. is_preset=1 so the UI hides destructive actions,
# but the user can still edit sizes / attach images on top of them.
_LADDER_PRESETS = [
    ("1kb_plus", "1 kb Plus DNA Ladder", "dna",
     [15000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100]),
    ("1kb", "1 kb DNA Ladder", "dna",
     [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500, 250]),
    ("100bp", "100 bp DNA Ladder", "dna",
     [1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]),
    ("hyperladder_1kb", "HyperLadder 1kb", "dna",
     [10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 800, 600, 400, 200]),
    ("pageruler", "PageRuler Prestained (Protein)", "protein",
     [250, 130, 100, 70, 55, 35, 25, 15, 10]),
    ("pageruler_plus", "PageRuler Plus Prestained (Protein)", "protein",
     [250, 130, 100, 70, 55, 35, 25, 15, 10]),
]


def _seed_ladders(conn):
    """Insert preset ladders if not already present. Run on every startup —
    safe to run repeatedly because of the UNIQUE constraint on slug."""
    now = datetime.utcnow().isoformat()
    for slug, name, kind, sizes in _LADDER_PRESETS:
        existing = conn.execute("SELECT id FROM gel_ladders WHERE slug=?", (slug,)).fetchone()
        if existing:
            continue
        conn.execute(
            "INSERT INTO gel_ladders (slug, name, kind, sizes_json, is_preset, created) VALUES (?,?,?,?,1,?)",
            (slug, name, kind, json.dumps(sizes), now),
        )


register_seed(_seed_ladders)


router = APIRouter(prefix="/api", tags=["gel_annotation"])


@router.get("/gels")
def list_gels(entry_id: int = None):
    with get_db() as conn:
        if entry_id is not None:
            rows = conn.execute("""
                SELECT g.*, COUNT(l.id) as lane_count
                FROM gels g LEFT JOIN gel_lanes l ON l.gel_id = g.id
                WHERE g.entry_id = ?
                GROUP BY g.id ORDER BY g.created DESC
            """, (entry_id,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT g.*, COUNT(l.id) as lane_count
                FROM gels g LEFT JOIN gel_lanes l ON l.gel_id = g.id
                GROUP BY g.id ORDER BY g.created DESC
            """).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/gels/{gel_id}")
def get_gel(gel_id: int):
    with get_db() as conn:
        gel = conn.execute("SELECT * FROM gels WHERE id=?", (gel_id,)).fetchone()
        if not gel:
            raise HTTPException(404, "Gel not found")
        lanes = conn.execute(
            "SELECT * FROM gel_lanes WHERE gel_id=? ORDER BY lane_number",
            (gel_id,),
        ).fetchall()
    result = dict(gel)
    result["lanes"] = [dict(l) for l in lanes]
    return result


@router.post("/gels")
async def create_gel(
    title: str = Form(...),
    description: str = Form(""),
    gel_type: str = Form("dna"),
    image: UploadFile = File(...),
):
    ext = os.path.splitext(image.filename or "img.png")[1] or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    content = await image.read()
    with open(filepath, "wb") as f:
        f.write(content)
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO gels (title, description, image_file, gel_type, annotations, created, updated) VALUES (?,?,?,?,?,?,?)",
            (title, description, filename, gel_type, "{}", now, now),
        )
        conn.commit()
        row = dict(conn.execute("SELECT * FROM gels WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.put("/gels/{gel_id}")
def update_gel(gel_id: int, body: dict):
    with get_db() as conn:
        gel = conn.execute("SELECT * FROM gels WHERE id=?", (gel_id,)).fetchone()
        if not gel:
            raise HTTPException(404, "Gel not found")
        now = datetime.utcnow().isoformat()
        fields = []
        values = []
        for key in ["title", "description", "gel_type", "ladder_type", "entry_id", "annotations"]:
            if key in body:
                val = body[key]
                if key == "annotations" and isinstance(val, (dict, list)):
                    val = json.dumps(val)
                fields.append(f"{key}=?")
                values.append(val)
        if fields:
            fields.append("updated=?")
            values.append(now)
            values.append(gel_id)
            conn.execute(f"UPDATE gels SET {', '.join(fields)} WHERE id=?", values)
            conn.commit()
        row = dict(conn.execute("SELECT * FROM gels WHERE id=?", (gel_id,)).fetchone())
    return row


@router.post("/gels/{gel_id}/lanes")
def save_lanes(gel_id: int, body: dict):
    """Replace all lanes for a gel with the provided list."""
    lanes = body.get("lanes", [])
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        gel = conn.execute("SELECT * FROM gels WHERE id=?", (gel_id,)).fetchone()
        if not gel:
            raise HTTPException(404, "Gel not found")
        conn.execute("DELETE FROM gel_lanes WHERE gel_id=?", (gel_id,))
        for lane in lanes:
            conn.execute(
                """INSERT INTO gel_lanes
                   (gel_id, lane_number, sample_name, is_ladder, primer_id, plasmid_id,
                    expected_size, observed_size, notes, x_position, created)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    gel_id,
                    lane.get("lane_number", 0),
                    lane.get("sample_name", ""),
                    1 if lane.get("is_ladder") else 0,
                    lane.get("primer_id") or None,
                    lane.get("plasmid_id") or None,
                    lane.get("expected_size", ""),
                    lane.get("observed_size", ""),
                    lane.get("notes", ""),
                    lane.get("x_position", 0),
                    now,
                ),
            )
        conn.execute("UPDATE gels SET updated=? WHERE id=?", (now, gel_id))
        conn.commit()
        result = conn.execute(
            "SELECT * FROM gel_lanes WHERE gel_id=? ORDER BY lane_number", (gel_id,)
        ).fetchall()
    return {"lanes": [dict(r) for r in result]}


@router.delete("/gels/{gel_id}")
def delete_gel(gel_id: int):
    with get_db() as conn:
        gel = conn.execute("SELECT * FROM gels WHERE id=?", (gel_id,)).fetchone()
        if not gel:
            raise HTTPException(404, "Gel not found")
        conn.execute("DELETE FROM gel_lanes WHERE gel_id=?", (gel_id,))
        conn.execute("DELETE FROM gels WHERE id=?", (gel_id,))
        conn.commit()
    filepath = os.path.join(UPLOAD_DIR, gel["image_file"])
    if os.path.exists(filepath):
        os.remove(filepath)
    return {"ok": True}


@router.get("/gel_images/{filename}")
def serve_gel_image(filename: str):
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Image not found")
    return FileResponse(filepath)


# ── Ladder catalogue ─────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Lowercase, replace non-alnum with underscores, collapse repeats."""
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "ladder"


def _ladder_row(row) -> dict:
    """Hydrate a gel_ladders row, parsing sizes_json."""
    d = dict(row)
    try:
        d["sizes"] = json.loads(d.pop("sizes_json"))
    except Exception:
        d["sizes"] = []
        d.pop("sizes_json", None)
    return d


@router.get("/ladders")
def list_ladders():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM gel_ladders ORDER BY is_preset DESC, name ASC"
        ).fetchall()
    return {"items": [_ladder_row(r) for r in rows]}


@router.post("/ladders")
async def create_ladder(
    name: str = Form(...),
    kind: str = Form("dna"),
    sizes: str = Form(...),           # JSON array
    image: Optional[UploadFile] = File(None),
):
    if kind not in ("dna", "protein"):
        raise HTTPException(400, "kind must be 'dna' or 'protein'")
    try:
        size_list = json.loads(sizes)
        if not isinstance(size_list, list) or not all(isinstance(s, (int, float)) for s in size_list):
            raise ValueError
        size_list = [int(s) for s in size_list]
        if not size_list:
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(400, "sizes must be a non-empty JSON array of numbers")

    image_fname = None
    if image and image.filename:
        ext = os.path.splitext(image.filename)[1].lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            raise HTTPException(400, "Unsupported image format")
        image_fname = f"{uuid.uuid4().hex}{ext}"
        with open(os.path.join(LADDER_IMG_DIR, image_fname), "wb") as f:
            f.write(await image.read())

    # Generate a unique slug. If a custom ladder's name collides with an
    # existing slug (e.g. another custom by the same name), append a digit.
    base = _slugify(name)
    slug = base
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        n = 2
        while conn.execute("SELECT 1 FROM gel_ladders WHERE slug=?", (slug,)).fetchone():
            slug = f"{base}_{n}"
            n += 1
        cur = conn.execute(
            "INSERT INTO gel_ladders (slug, name, kind, sizes_json, image_file, is_preset, created) VALUES (?,?,?,?,?,0,?)",
            (slug, name, kind, json.dumps(size_list), image_fname, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM gel_ladders WHERE id=?", (cur.lastrowid,)).fetchone()
    return _ladder_row(row)


@router.put("/ladders/{ladder_id}")
async def update_ladder(
    ladder_id: int,
    name: Optional[str] = Form(None),
    kind: Optional[str] = Form(None),
    sizes: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None),
    clear_image: Optional[str] = Form(None),
):
    """Partial update. is_preset and slug are immutable so the existing
    gels.ladder_type references stay valid."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM gel_ladders WHERE id=?", (ladder_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Ladder not found")

        fields, values = [], []
        if name is not None:
            fields.append("name=?"); values.append(name)
        if kind is not None:
            if kind not in ("dna", "protein"):
                raise HTTPException(400, "kind must be 'dna' or 'protein'")
            fields.append("kind=?"); values.append(kind)
        if sizes is not None:
            try:
                size_list = json.loads(sizes)
                size_list = [int(s) for s in size_list]
                if not size_list:
                    raise ValueError
            except (json.JSONDecodeError, ValueError, TypeError):
                raise HTTPException(400, "sizes must be a non-empty JSON array of numbers")
            fields.append("sizes_json=?"); values.append(json.dumps(size_list))

        # Image handling: replace, or explicitly clear.
        old_image = row["image_file"]
        new_image_fname = None
        if image and image.filename:
            ext = os.path.splitext(image.filename)[1].lower() or ".png"
            if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                raise HTTPException(400, "Unsupported image format")
            new_image_fname = f"{uuid.uuid4().hex}{ext}"
            with open(os.path.join(LADDER_IMG_DIR, new_image_fname), "wb") as f:
                f.write(await image.read())
            fields.append("image_file=?"); values.append(new_image_fname)
        elif clear_image == "1":
            fields.append("image_file=?"); values.append(None)

        if fields:
            values.append(ladder_id)
            conn.execute(f"UPDATE gel_ladders SET {', '.join(fields)} WHERE id=?", values)
            conn.commit()

        # Best-effort cleanup of replaced image file. Skip if delete fails — the
        # next preset-image upload will succeed and orphans are harmless.
        if (new_image_fname or clear_image == "1") and old_image:
            try:
                os.remove(os.path.join(LADDER_IMG_DIR, old_image))
            except OSError:
                pass

        row = conn.execute("SELECT * FROM gel_ladders WHERE id=?", (ladder_id,)).fetchone()
    return _ladder_row(row)


@router.delete("/ladders/{ladder_id}")
def delete_ladder(ladder_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM gel_ladders WHERE id=?", (ladder_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Ladder not found")
        if row["is_preset"]:
            raise HTTPException(400, "Cannot delete preset ladders. Edit their sizes if you need to.")
        # Soft-check: are any gels still pointing at this ladder?
        in_use = conn.execute(
            "SELECT COUNT(*) AS n FROM gels WHERE ladder_type=?", (row["slug"],)
        ).fetchone()["n"]
        if in_use:
            raise HTTPException(
                409,
                f"Ladder is used by {in_use} gel(s). Reassign them first, or rename instead of deleting.",
            )
        conn.execute("DELETE FROM gel_ladders WHERE id=?", (ladder_id,))
        conn.commit()
    if row["image_file"]:
        try:
            os.remove(os.path.join(LADDER_IMG_DIR, row["image_file"]))
        except OSError:
            pass
    return {"ok": True}


@router.get("/ladder_images/{filename}")
def serve_ladder_image(filename: str):
    filepath = os.path.join(LADDER_IMG_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Image not found")
    return FileResponse(filepath)
