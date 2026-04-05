"""Genetic Circuit Designer — SBOL Visual circuit drawing with sequence assignment."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os, json

from core.database import register_table, get_db

# ---------------------------------------------------------------------------
# DB table for saved circuit designs
# ---------------------------------------------------------------------------
register_table("circuit_designs", """CREATE TABLE IF NOT EXISTS circuit_designs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    parts    TEXT NOT NULL,
    created  TEXT NOT NULL,
    updated  TEXT NOT NULL
)""")

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ReindexRequest(BaseModel):
    seq_type: str
    seq_id: int
    new_origin: int

class CreateDesign(BaseModel):
    name: str
    parts: str  # JSON string

class UpdateDesign(BaseModel):
    name: Optional[str] = None
    parts: Optional[str] = None

class ExportPartInput(BaseModel):
    name: str
    seq: str
    type: str
    color: Optional[str] = "#95A5A6"
    direction: Optional[int] = 1

class ExportGBRequest(BaseModel):
    name: str
    parts: List[ExportPartInput]

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
    try:
        from Bio import SeqIO
    except ImportError:
        raise HTTPException(500, "BioPython not installed")

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
        color = (
            feat.qualifiers.get("ApEinfo_fwdcolor", [None])[0]
            or FEATURE_COLORS.get(feat.type, "#95A5A6")
        )
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
# Part type → GenBank feature type mapping
# ---------------------------------------------------------------------------
PART_TO_GB_TYPE = {
    "cds": "CDS",
    "promoter": "promoter",
    "terminator": "terminator",
    "rbs": "RBS",
    "operator": "regulatory",
    "insulator": "regulatory",
    "origin": "rep_origin",
    "riboswitch": "regulatory",
    "spacer": "misc_feature",
    "scar": "misc_feature",
    "backbone": "misc_feature",
    "tag": "CDS",
    "misc": "misc_feature",
}

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api", tags=["circuits"])

GB_DIR = "/data/gb_files"


# ---------------------------------------------------------------------------
# Sequence listing
# ---------------------------------------------------------------------------
@router.get("/circuits/sequences")
def list_sequences():
    """Return all plasmids, primers, kit_parts that have .gb files."""
    with get_db() as conn:
        plasmids = conn.execute(
            "SELECT id, name, use, box_location, glycerol_location, gb_file, created "
            "FROM plasmids WHERE gb_file IS NOT NULL AND gb_file != '' ORDER BY name"
        ).fetchall()
        primers = conn.execute(
            "SELECT id, name, sequence, use, box_number, gb_file, created "
            "FROM primers WHERE gb_file IS NOT NULL AND gb_file != '' ORDER BY name"
        ).fetchall()
        try:
            kit_parts = conn.execute(
                "SELECT id, name, kit_name, part_type, description, gb_file, created "
                "FROM kit_parts WHERE gb_file IS NOT NULL AND gb_file != '' "
                "ORDER BY kit_name, name"
            ).fetchall()
        except Exception:
            kit_parts = []

    items = []
    for p in plasmids:
        d = dict(p)
        d["type"] = "plasmid"
        d["has_file"] = os.path.isfile(os.path.join(GB_DIR, f"plasmid_{d['id']}.gb"))
        items.append(d)
    for p in primers:
        d = dict(p)
        d["type"] = "primer"
        d["has_file"] = os.path.isfile(os.path.join(GB_DIR, f"primer_{d['id']}.gb"))
        items.append(d)
    for p in kit_parts:
        d = dict(p)
        d["type"] = "kitpart"
        d["has_file"] = os.path.isfile(os.path.join(GB_DIR, f"kitpart_{d['id']}.gb"))
        items.append(d)

    return {"items": items}


# ---------------------------------------------------------------------------
# Sequence parsing
# ---------------------------------------------------------------------------
@router.get("/circuits/sequences/{seq_type}/{seq_id}/parse")
def parse_sequence(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', or 'kitpart'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    return parse_genbank(fpath)


# ---------------------------------------------------------------------------
# Reindex (rotate circular sequence origin)
# ---------------------------------------------------------------------------
@router.post("/circuits/reindex")
def reindex_sequence(body: ReindexRequest):
    """Rotate a circular sequence so new_origin becomes position 0."""
    if body.seq_type not in ("primer", "plasmid", "kitpart"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', or 'kitpart'")
    fpath = os.path.join(GB_DIR, f"{body.seq_type}_{body.seq_id}.gb")
    if not os.path.isfile(fpath):
        raise HTTPException(404, "GenBank file not found")

    from Bio import SeqIO as _SeqIO
    from Bio.Seq import Seq
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from io import StringIO

    records = list(_SeqIO.parse(fpath, "genbank"))
    if not records:
        raise HTTPException(400, "No records found in GenBank file")
    rec = records[0]
    seq_str = str(rec.seq)
    slen = len(seq_str)

    topology = rec.annotations.get("topology", "linear")
    if topology != "circular":
        raise HTTPException(400, "Reindexing is only supported for circular sequences")

    origin = body.new_origin % slen
    if origin == 0:
        return parse_genbank(fpath)

    # Rotate sequence
    new_seq = seq_str[origin:] + seq_str[:origin]
    rec.seq = Seq(new_seq)

    # Remap features
    new_features = []
    for feat in rec.features:
        if feat.type == "source":
            continue
        start = int(feat.location.start)
        end = int(feat.location.end)
        new_start = (start - origin) % slen
        new_end = (end - origin) % slen

        if new_start < new_end:
            new_feat = SeqFeature(
                FeatureLocation(new_start, new_end, strand=feat.location.strand),
                type=feat.type,
                qualifiers=dict(feat.qualifiers),
            )
            new_features.append(new_feat)
        else:
            # Feature wraps origin — store the first portion
            new_feat = SeqFeature(
                FeatureLocation(new_start, slen, strand=feat.location.strand),
                type=feat.type,
                qualifiers=dict(feat.qualifiers),
            )
            new_features.append(new_feat)

    rec.features = [SeqFeature(
        FeatureLocation(0, slen),
        type="source",
        qualifiers={"mol_type": ["other DNA"], "organism": ["synthetic construct"]},
    )] + new_features

    output = StringIO()
    _SeqIO.write(rec, output, "genbank")
    with open(fpath, "w") as f:
        f.write(output.getvalue())

    return parse_genbank(fpath)


# ---------------------------------------------------------------------------
# Circuit designs CRUD
# ---------------------------------------------------------------------------
@router.get("/circuits/designs")
def list_designs():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM circuit_designs ORDER BY updated DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/circuits/designs")
def create_design(body: CreateDesign):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO circuit_designs (name, parts, created, updated) VALUES (?,?,?,?)",
            (body.name, body.parts, now, now),
        )
        conn.commit()
        row = dict(conn.execute(
            "SELECT * FROM circuit_designs WHERE id=?", (cur.lastrowid,)
        ).fetchone())
    return row


@router.get("/circuits/designs/{did}")
def get_design(did: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM circuit_designs WHERE id=?", (did,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Design not found")
    return dict(row)


@router.put("/circuits/designs/{did}")
def update_design(did: int, body: UpdateDesign):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM circuit_designs WHERE id=?", (did,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Design not found")
        existing = dict(existing)
        if body.name is not None:
            existing["name"] = body.name
        if body.parts is not None:
            existing["parts"] = body.parts
        conn.execute(
            "UPDATE circuit_designs SET name=?, parts=?, updated=? WHERE id=?",
            (existing["name"], existing["parts"], now, did),
        )
        conn.commit()
        row = dict(conn.execute(
            "SELECT * FROM circuit_designs WHERE id=?", (did,)
        ).fetchone())
    return row


@router.delete("/circuits/designs/{did}")
def delete_design(did: int):
    with get_db() as conn:
        r = conn.execute("DELETE FROM circuit_designs WHERE id=?", (did,))
        conn.commit()
    if r.rowcount == 0:
        raise HTTPException(404, "Design not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Export GenBank
# ---------------------------------------------------------------------------
@router.post("/circuits/export-gb")
def export_gb(body: ExportGBRequest):
    """Concatenate part sequences and export as a GenBank string."""
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from Bio import SeqIO as _SeqIO
    from io import StringIO

    parts_with_seq = [p for p in body.parts if p.seq]
    if not parts_with_seq:
        raise HTTPException(400, "No parts have sequences")

    full_seq = ""
    features = []

    for p in parts_with_seq:
        start = len(full_seq)
        full_seq += p.seq.upper().replace(" ", "").replace("\n", "")
        end = len(full_seq)

        strand = 1 if p.direction == 1 else -1
        gb_type = PART_TO_GB_TYPE.get(p.type, "misc_feature")

        feat = SeqFeature(
            FeatureLocation(start, end, strand=strand),
            type=gb_type,
            qualifiers={
                "label": [p.name],
                "ApEinfo_fwdcolor": [p.color or "#95A5A6"],
                "ApEinfo_revcolor": [p.color or "#95A5A6"],
            },
        )
        features.append(feat)

    # Build record
    safe_name = body.name.replace(" ", "_")[:16]
    rec = SeqRecord(
        Seq(full_seq),
        id=safe_name,
        name=safe_name,
        description=body.name,
        annotations={"molecule_type": "DNA", "topology": "linear"},
    )

    # Add source feature
    source = SeqFeature(
        FeatureLocation(0, len(full_seq)),
        type="source",
        qualifiers={"mol_type": ["other DNA"], "organism": ["synthetic construct"]},
    )
    rec.features = [source] + features

    output = StringIO()
    _SeqIO.write(rec, output, "genbank")

    return {
        "gb_content": output.getvalue(),
        "length": len(full_seq),
        "num_parts": len(parts_with_seq),
    }
