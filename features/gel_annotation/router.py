"""Gel Annotation Station — upload gel images, label lanes, mark ladders, link to inventory."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os, json, uuid
from core.database import register_table, get_db

UPLOAD_DIR = "/data/gel_images"
os.makedirs(UPLOAD_DIR, exist_ok=True)

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
