"""Cloning feature — sequence viewer + OpenCloning bridge."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os, json

from core.database import register_table, get_db

# ---------------------------------------------------------------------------
# DB table for saved cloning projects / assembly plans
# ---------------------------------------------------------------------------
register_table("cloning_projects", """CREATE TABLE IF NOT EXISTS cloning_projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    method      TEXT,
    sequences   TEXT,
    notes       TEXT,
    status      TEXT NOT NULL DEFAULT 'draft',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL
)""")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class CreateProject(BaseModel):
    name: str
    description: Optional[str] = ""
    method: Optional[str] = ""
    sequences: Optional[str] = "[]"
    notes: Optional[str] = ""

class UpdateProject(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    method: Optional[str] = None
    sequences: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None

# ---------------------------------------------------------------------------
# GenBank parser (uses BioPython)
# ---------------------------------------------------------------------------
FEATURE_COLORS = {
    "CDS": "#4682B4",
    "gene": "#5b7a5e",
    "promoter": "#E8A838",
    "terminator": "#C0392B",
    "rep_origin": "#8E44AD",
    "primer_bind": "#E67E22",
    "misc_feature": "#7F8C8D",
    "regulatory": "#E8A838",
    "protein_bind": "#1ABC9C",
    "RBS": "#D4AC0D",
    "enhancer": "#F39C12",
    "polyA_signal": "#C0392B",
    "sig_peptide": "#3498DB",
    "source": "#BDC3C7",
}


def parse_genbank(filepath: str) -> dict:
    """Parse a GenBank file and return SeqViz-compatible JSON."""
    try:
        from Bio import SeqIO
    except ImportError:
        raise HTTPException(500, "BioPython not installed — add 'biopython' to requirements.txt")

    if not os.path.isfile(filepath):
        raise HTTPException(404, f"File not found: {filepath}")

    records = list(SeqIO.parse(filepath, "genbank"))
    if not records:
        raise HTTPException(400, "No records found in GenBank file")

    rec = records[0]
    seq = str(rec.seq)

    annotations = []
    for feat in rec.features:
        if feat.type == "source":
            continue
        name = (
            feat.qualifiers.get("label", [None])[0]
            or feat.qualifiers.get("gene", [None])[0]
            or feat.qualifiers.get("product", [None])[0]
            or feat.qualifiers.get("note", [None])[0]
            or feat.type
        )
        color = feat.qualifiers.get("ApEinfo_fwdcolor", [None])[0] or FEATURE_COLORS.get(feat.type, "#95A5A6")
        annotations.append({
            "name": name,
            "start": int(feat.location.start),
            "end": int(feat.location.end),
            "direction": 1 if feat.location.strand == 1 else -1,
            "color": color,
            "type": feat.type,
        })

    return {
        "name": rec.name or rec.id or "Unknown",
        "description": rec.description or "",
        "seq": seq,
        "annotations": annotations,
        "length": len(seq),
        "topology": rec.annotations.get("topology", "linear"),
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api", tags=["cloning"])

GB_DIR = "/data/gb_files"
OC_DEFAULT_URL = os.environ.get("OPENCLONING_URL", "http://localhost:8001")


@router.get("/cloning/config")
def get_config():
    """Return OpenCloning URL and feature config."""
    return {"opencloning_url": OC_DEFAULT_URL}


@router.get("/cloning/sequences")
def list_sequences():
    """List all primers and plasmids that have a .gb file attached."""
    with get_db() as conn:
        primers = conn.execute(
            "SELECT id, name, sequence, use, box_number, gb_file, created "
            "FROM primers WHERE gb_file IS NOT NULL AND gb_file != '' "
            "ORDER BY name"
        ).fetchall()
        plasmids = conn.execute(
            "SELECT id, name, use, box_location, glycerol_location, gb_file, created "
            "FROM plasmids WHERE gb_file IS NOT NULL AND gb_file != '' "
            "ORDER BY name"
        ).fetchall()

    items = []
    for p in primers:
        d = dict(p)
        d["type"] = "primer"
        fpath = os.path.join(GB_DIR, f"primer_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        items.append(d)
    for p in plasmids:
        d = dict(p)
        d["type"] = "plasmid"
        fpath = os.path.join(GB_DIR, f"plasmid_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        items.append(d)

    return {"items": items}


@router.get("/cloning/sequences/{seq_type}/{seq_id}/parse")
def parse_sequence(seq_type: str, seq_id: int):
    """Parse a .gb file and return SeqViz-compatible data."""
    if seq_type not in ("primer", "plasmid"):
        raise HTTPException(400, "seq_type must be 'primer' or 'plasmid'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    return parse_genbank(fpath)


@router.get("/cloning/sequences/{seq_type}/{seq_id}/raw")
def raw_sequence(seq_type: str, seq_id: int):
    """Return the raw GenBank file content as text."""
    if seq_type not in ("primer", "plasmid"):
        raise HTTPException(400, "seq_type must be 'primer' or 'plasmid'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        raise HTTPException(404, "GenBank file not found")
    with open(fpath, "r") as f:
        return PlainTextResponse(f.read(), media_type="text/plain")


# ---------------------------------------------------------------------------
# OpenCloning CloningStrategy JSON export
# ---------------------------------------------------------------------------
def _build_oc_entry(seq_type: str, seq_id: int, source_id: int, seq_obj_id: int):
    """Build one source + sequence + file entry for a CloningStrategy JSON."""
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        return None
    with open(fpath, "r") as f:
        gb_content = f.read()
    fname = f"{seq_type}_{seq_id}.gb"

    # Detect topology
    circular = "circular" in gb_content[:500].lower()

    source = {
        "id": source_id,
        "type": "UploadedFileSource",
        "input": [],
        "file_name": fname,
        "index_in_file": 0,
        "sequence_file_format": "genbank",
    }
    sequence = {
        "id": seq_obj_id,
        "type": "TextFileSequence",
        "source": {"id": source_id},
        "file_content": gb_content,
        "circular": circular,
    }
    file_entry = {
        "file_name": fname,
        "file_content": gb_content,
    }
    return source, sequence, file_entry


@router.get("/cloning/export/{seq_type}/{seq_id}")
def export_single(seq_type: str, seq_id: int):
    """Export a single sequence as an OpenCloning CloningStrategy JSON."""
    if seq_type not in ("primer", "plasmid"):
        raise HTTPException(400, "seq_type must be 'primer' or 'plasmid'")
    result = _build_oc_entry(seq_type, seq_id, 1, 2)
    if not result:
        raise HTTPException(404, "GenBank file not found")
    source, sequence, file_entry = result
    return {
        "sources": [source],
        "sequences": [sequence],
        "primers": [],
        "files": [file_entry],
    }


@router.get("/cloning/export-all")
def export_all():
    """Export all sequences with .gb files as a single CloningStrategy JSON."""
    with get_db() as conn:
        primers = conn.execute(
            "SELECT id FROM primers WHERE gb_file IS NOT NULL AND gb_file != ''"
        ).fetchall()
        plasmids = conn.execute(
            "SELECT id FROM plasmids WHERE gb_file IS NOT NULL AND gb_file != ''"
        ).fetchall()

    sources, sequences, files = [], [], []
    sid = 1
    for row in plasmids:
        result = _build_oc_entry("plasmid", row["id"], sid, sid + 1)
        if result:
            sources.append(result[0])
            sequences.append(result[1])
            files.append(result[2])
            sid += 2
    for row in primers:
        result = _build_oc_entry("primer", row["id"], sid, sid + 1)
        if result:
            sources.append(result[0])
            sequences.append(result[1])
            files.append(result[2])
            sid += 2

    if not sources:
        raise HTTPException(404, "No sequences with GenBank files found")

    return {
        "sources": sources,
        "sequences": sequences,
        "primers": [],
        "files": files,
    }


# ---------------------------------------------------------------------------
# Cloning project CRUD
# ---------------------------------------------------------------------------
@router.get("/cloning/projects")
def list_projects():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM cloning_projects ORDER BY updated DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/cloning/projects")
def create_project(body: CreateProject):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO cloning_projects (name, description, method, sequences, notes, created, updated) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.name, body.description, body.method, body.sequences, body.notes, now, now),
        )
        conn.commit()
        row = dict(conn.execute("SELECT * FROM cloning_projects WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.put("/cloning/projects/{pid}")
def update_project(pid: int, body: UpdateProject):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM cloning_projects WHERE id=?", (pid,)).fetchone()
        if not existing:
            raise HTTPException(404, "Project not found")
        existing = dict(existing)
        updates = body.dict(exclude_unset=True)
        for k, v in updates.items():
            existing[k] = v
        conn.execute(
            "UPDATE cloning_projects SET name=?, description=?, method=?, sequences=?, notes=?, status=?, updated=? WHERE id=?",
            (existing["name"], existing["description"], existing["method"],
             existing["sequences"], existing["notes"], existing["status"], now, pid),
        )
        conn.commit()
        row = dict(conn.execute("SELECT * FROM cloning_projects WHERE id=?", (pid,)).fetchone())
    return row


@router.delete("/cloning/projects/{pid}")
def delete_project(pid: int):
    with get_db() as conn:
        r = conn.execute("DELETE FROM cloning_projects WHERE id=?", (pid,))
        conn.commit()
    if r.rowcount == 0:
        raise HTTPException(404, "Project not found")
    return {"deleted": True}
