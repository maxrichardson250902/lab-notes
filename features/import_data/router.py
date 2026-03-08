"""DNA Manager feature — primers, plasmids, .gb files, and auto-linking."""

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from core.database import register_table, get_db
import csv
import io
import os
import uuid

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

# ── Tables ───────────────────────────────────────────────────────────────────

register_table("imports", """CREATE TABLE IF NOT EXISTS imports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filename     TEXT NOT NULL,
    record_type  TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    created      TEXT NOT NULL)""")

register_table("primers", """CREATE TABLE IF NOT EXISTS primers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id  INTEGER,
    name       TEXT NOT NULL,
    sequence   TEXT,
    use        TEXT,
    box_number TEXT,
    gb_file    TEXT,
    created    TEXT NOT NULL)""")

register_table("plasmids", """CREATE TABLE IF NOT EXISTS plasmids (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id         INTEGER,
    name              TEXT NOT NULL,
    use               TEXT,
    box_location      TEXT,
    glycerol_location TEXT,
    gb_file           TEXT,
    created           TEXT NOT NULL)""")

register_table("dna_settings", """CREATE TABLE IF NOT EXISTS dna_settings (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    primer_prefix   TEXT NOT NULL DEFAULT '',
    plasmid_prefix  TEXT NOT NULL DEFAULT '',
    created         TEXT NOT NULL)""")

# ── Storage directories ──────────────────────────────────────────────────────

UPLOAD_DIR = "/data/imports"
GB_DIR = "/data/gb_files"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(GB_DIR, exist_ok=True)

# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["dna_manager"])

# ══════════════════════════════════════════════════════════════════════════════
#  PRIMERS CRUD
# ══════════════════════════════════════════════════════════════════════════════

class CreatePrimer(BaseModel):
    name: str
    sequence: Optional[str] = ""
    use: Optional[str] = ""
    box_number: Optional[str] = ""

class UpdatePrimer(BaseModel):
    name: Optional[str] = None
    sequence: Optional[str] = None
    use: Optional[str] = None
    box_number: Optional[str] = None

@router.get("/primers")
def list_primers():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM primers ORDER BY created DESC").fetchall()
    return {"items": [dict(r) for r in rows]}

@router.post("/primers")
def create_primer(body: CreatePrimer):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO primers (name, sequence, use, box_number, created) VALUES (?,?,?,?,?)",
            (body.name, body.sequence, body.use, body.box_number, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM primers WHERE id=?", (cur.lastrowid,)).fetchone())
    return row

@router.put("/primers/{item_id}")
def update_primer(item_id: int, body: UpdatePrimer):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM primers WHERE id=?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Primer not found")
        fields = {k: v for k, v in body.dict().items() if v is not None}
        if not fields:
            return dict(existing)
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE primers SET {sets} WHERE id=?", (*fields.values(), item_id))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM primers WHERE id=?", (item_id,)).fetchone())
    return row

@router.delete("/primers/{item_id}")
def delete_primer(item_id: int):
    # also remove .gb file
    path = os.path.join(GB_DIR, f"primer_{item_id}.gb")
    if os.path.exists(path):
        os.remove(path)
    with get_db() as conn:
        conn.execute("DELETE FROM primers WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}

# ── Primer .gb file ──────────────────────────────────────────────────────────

@router.post("/primers/{item_id}/gb")
async def upload_primer_gb(item_id: int, file: UploadFile = File(...)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM primers WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Primer not found")
    contents = await file.read()
    stored = os.path.join(GB_DIR, f"primer_{item_id}.gb")
    with open(stored, "wb") as f:
        f.write(contents)
    with get_db() as conn:
        conn.execute("UPDATE primers SET gb_file=? WHERE id=?", (file.filename, item_id))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM primers WHERE id=?", (item_id,)).fetchone())
    return row

@router.get("/primers/{item_id}/gb")
def download_primer_gb(item_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM primers WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Primer not found")
    stored = os.path.join(GB_DIR, f"primer_{item_id}.gb")
    if not os.path.exists(stored):
        raise HTTPException(404, "No .gb file attached")
    return FileResponse(stored, filename=row["gb_file"] or f"primer_{item_id}.gb",
                        media_type="application/octet-stream")

@router.delete("/primers/{item_id}/gb")
def delete_primer_gb(item_id: int):
    stored = os.path.join(GB_DIR, f"primer_{item_id}.gb")
    if os.path.exists(stored):
        os.remove(stored)
    with get_db() as conn:
        conn.execute("UPDATE primers SET gb_file=NULL WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}

# ══════════════════════════════════════════════════════════════════════════════
#  PLASMIDS CRUD
# ══════════════════════════════════════════════════════════════════════════════

class CreatePlasmid(BaseModel):
    name: str
    use: Optional[str] = ""
    box_location: Optional[str] = ""
    glycerol_location: Optional[str] = ""

class UpdatePlasmid(BaseModel):
    name: Optional[str] = None
    use: Optional[str] = None
    box_location: Optional[str] = None
    glycerol_location: Optional[str] = None

@router.get("/plasmids")
def list_plasmids():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM plasmids ORDER BY created DESC").fetchall()
    return {"items": [dict(r) for r in rows]}

@router.post("/plasmids")
def create_plasmid(body: CreatePlasmid):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO plasmids (name, use, box_location, glycerol_location, created) VALUES (?,?,?,?,?)",
            (body.name, body.use, body.box_location, body.glycerol_location, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM plasmids WHERE id=?", (cur.lastrowid,)).fetchone())
    return row

@router.put("/plasmids/{item_id}")
def update_plasmid(item_id: int, body: UpdatePlasmid):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM plasmids WHERE id=?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Plasmid not found")
        fields = {k: v for k, v in body.dict().items() if v is not None}
        if not fields:
            return dict(existing)
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE plasmids SET {sets} WHERE id=?", (*fields.values(), item_id))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM plasmids WHERE id=?", (item_id,)).fetchone())
    return row

@router.delete("/plasmids/{item_id}")
def delete_plasmid(item_id: int):
    path = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")
    if os.path.exists(path):
        os.remove(path)
    with get_db() as conn:
        conn.execute("DELETE FROM plasmids WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}

# ── Plasmid .gb file ─────────────────────────────────────────────────────────

@router.post("/plasmids/{item_id}/gb")
async def upload_plasmid_gb(item_id: int, file: UploadFile = File(...)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM plasmids WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Plasmid not found")
    contents = await file.read()
    stored = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")
    with open(stored, "wb") as f:
        f.write(contents)
    with get_db() as conn:
        conn.execute("UPDATE plasmids SET gb_file=? WHERE id=?", (file.filename, item_id))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM plasmids WHERE id=?", (item_id,)).fetchone())
    return row

@router.get("/plasmids/{item_id}/gb")
def download_plasmid_gb(item_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM plasmids WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Plasmid not found")
    stored = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")
    if not os.path.exists(stored):
        raise HTTPException(404, "No .gb file attached")
    return FileResponse(stored, filename=row["gb_file"] or f"plasmid_{item_id}.gb",
                        media_type="application/octet-stream")

@router.delete("/plasmids/{item_id}/gb")
def delete_plasmid_gb(item_id: int):
    stored = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")
    if os.path.exists(stored):
        os.remove(stored)
    with get_db() as conn:
        conn.execute("UPDATE plasmids SET gb_file=NULL WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}

# ══════════════════════════════════════════════════════════════════════════════
#  DNA LINK SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

class DnaSettings(BaseModel):
    primer_prefix: str = ""
    plasmid_prefix: str = ""

@router.get("/dna/settings")
def get_dna_settings():
    with get_db() as conn:
        row = conn.execute("SELECT * FROM dna_settings WHERE id=1").fetchone()
    if not row:
        return {"primer_prefix": "", "plasmid_prefix": ""}
    return dict(row)

@router.post("/dna/settings")
def save_dna_settings(body: DnaSettings):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM dna_settings WHERE id=1").fetchone()
        if existing:
            conn.execute("UPDATE dna_settings SET primer_prefix=?, plasmid_prefix=? WHERE id=1",
                         (body.primer_prefix, body.plasmid_prefix))
        else:
            conn.execute("INSERT INTO dna_settings (id, primer_prefix, plasmid_prefix, created) VALUES (1,?,?,?)",
                         (body.primer_prefix, body.plasmid_prefix, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM dna_settings WHERE id=1").fetchone())
    return row

# ══════════════════════════════════════════════════════════════════════════════
#  IMPORT (CSV / XLSX)
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/import/upload")
async def upload_for_preview(file: UploadFile = File(...)):
    contents = await file.read()
    original_name = file.filename or "upload"
    ext = os.path.splitext(original_name)[1].lower()

    if ext not in (".csv", ".tsv", ".xlsx", ".xls"):
        raise HTTPException(400, "Unsupported file type. Upload .csv, .tsv, or .xlsx.")
    if ext in (".xlsx", ".xls") and not HAS_OPENPYXL:
        raise HTTPException(400, "Excel support requires openpyxl. Add to requirements.txt or upload .csv.")

    temp_id = uuid.uuid4().hex
    temp_path = os.path.join(UPLOAD_DIR, f"{temp_id}{ext}")
    with open(temp_path, "wb") as f:
        f.write(contents)

    try:
        headers, preview = _parse_preview(contents, ext)
    except Exception as e:
        os.remove(temp_path)
        raise HTTPException(400, f"Could not parse file: {e}")

    return {"temp_id": temp_id, "filename": original_name, "ext": ext,
            "headers": headers, "preview": preview}


class ImportRequest(BaseModel):
    temp_id: str
    ext: str
    filename: str = ""
    record_type: str
    col_name: int
    col_sequence: Optional[int] = None
    col_use: Optional[int] = None
    col_box_number: Optional[int] = None
    col_box_location: Optional[int] = None
    col_glycerol_location: Optional[int] = None


@router.post("/import/execute")
def execute_import(body: ImportRequest):
    if body.record_type not in ("primer", "plasmid"):
        raise HTTPException(400, "record_type must be 'primer' or 'plasmid'")

    temp_path = os.path.join(UPLOAD_DIR, f"{body.temp_id}{body.ext}")
    if not os.path.exists(temp_path):
        raise HTTPException(404, "Upload not found — please re-upload.")

    with open(temp_path, "rb") as f:
        contents = f.read()

    data_rows = _parse_data_rows(contents, body.ext)
    now = datetime.utcnow().isoformat()
    display_name = body.filename or os.path.basename(temp_path)

    inserted = 0
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO imports (filename, record_type, record_count, created) VALUES (?,?,?,?)",
            (display_name, body.record_type, 0, now))
        import_id = cur.lastrowid

        for row in data_rows:
            name = _cell(row, body.col_name)
            if not name:
                continue
            if body.record_type == "primer":
                conn.execute(
                    "INSERT INTO primers (import_id, name, sequence, use, box_number, created) "
                    "VALUES (?,?,?,?,?,?)",
                    (import_id, name, _cell(row, body.col_sequence),
                     _cell(row, body.col_use), _cell(row, body.col_box_number), now))
            else:
                conn.execute(
                    "INSERT INTO plasmids (import_id, name, use, box_location, glycerol_location, created) "
                    "VALUES (?,?,?,?,?,?)",
                    (import_id, name, _cell(row, body.col_use),
                     _cell(row, body.col_box_location), _cell(row, body.col_glycerol_location), now))
            inserted += 1

        conn.execute("UPDATE imports SET record_count=? WHERE id=?", (inserted, import_id))
        conn.commit()

    return {"import_id": import_id, "record_count": inserted, "record_type": body.record_type}


@router.get("/import/history")
def import_history():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM imports ORDER BY created DESC").fetchall()
    return {"items": [dict(r) for r in rows]}

@router.delete("/import/{import_id}")
def delete_import(import_id: int):
    with get_db() as conn:
        imp = conn.execute("SELECT * FROM imports WHERE id=?", (import_id,)).fetchone()
        if not imp:
            raise HTTPException(404, "Import not found")
        table = "primers" if imp["record_type"] == "primer" else "plasmids"
        conn.execute(f"DELETE FROM {table} WHERE import_id=?", (import_id,))
        conn.execute("DELETE FROM imports WHERE id=?", (import_id,))
        conn.commit()
    return {"ok": True}


# ── Parse helpers ────────────────────────────────────────────────────────────

def _cell(row, idx):
    if idx is None or idx < 0 or idx >= len(row):
        return ""
    return str(row[idx]).strip()

def _parse_preview(contents: bytes, ext: str):
    if ext in (".xlsx", ".xls"):
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            raise ValueError("Spreadsheet is empty")
        headers = [str(c) if c is not None else f"Column {i+1}" for i, c in enumerate(rows[0])]
        preview = [[str(c) if c is not None else "" for c in row] for row in rows[1:6]]
    else:
        text = contents.decode("utf-8-sig")
        delimiter = "\t" if ext == ".tsv" else ","
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        all_rows = list(reader)
        if not all_rows:
            raise ValueError("CSV is empty")
        headers = [c if c.strip() else f"Column {i+1}" for i, c in enumerate(all_rows[0])]
        preview = all_rows[1:6]
    return headers, preview

def _parse_data_rows(contents: bytes, ext: str):
    if ext in (".xlsx", ".xls"):
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))[1:]
        wb.close()
        return [[str(c) if c is not None else "" for c in row] for row in rows]
    else:
        text = contents.decode("utf-8-sig")
        delimiter = "\t" if ext == ".tsv" else ","
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        return list(reader)[1:]
