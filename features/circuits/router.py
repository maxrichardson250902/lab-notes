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
    # 'circular' | 'linear'. The frontend chooses based on target (auto-defaults
    # to circular when target is plasmid) or via the user toggle in the save modal.
    topology: Optional[str] = "linear"

class SavePartInput(BaseModel):
    name: str
    sequence: str
    part_type: Optional[str] = ""
    source: Optional[str] = ""
    direction: Optional[int] = 1

class SaveToDBRequest(BaseModel):
    target: str  # parts, kit_parts, plasmids, primers, gblocks
    circuit_name: str
    extra: Optional[dict] = {}
    parts: List[SavePartInput]
    # If true, write a .gb file alongside the DB row and set gb_file on the row.
    # Defaults true because losing annotations on save is the bug we're fixing.
    write_gb: Optional[bool] = True
    # 'circular' | 'linear'. Used when write_gb=True. Defaults to circular for
    # plasmids, linear otherwise — but the frontend should pass an explicit value
    # based on the save-modal toggle.
    topology: Optional[str] = None

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
    """Return all DNA inventory items that have .gb files on disk.
    Five types are surfaced: plasmid, primer, kitpart, gblock, part.
    Items without a corresponding .gb file are filtered out — circuits operates
    on parsed GenBank annotations, so an entry without a file is unusable here."""
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
        try:
            gblocks = conn.execute(
                "SELECT id, name, sequence, length, use, gb_file, project, created "
                "FROM gblocks WHERE gb_file IS NOT NULL AND gb_file != '' ORDER BY name"
            ).fetchall()
        except Exception:
            gblocks = []
        try:
            parts = conn.execute(
                "SELECT id, name, sequence, length, project, subcategory, part_type, gb_file, created "
                "FROM parts WHERE gb_file IS NOT NULL AND gb_file != '' ORDER BY name"
            ).fetchall()
        except Exception:
            parts = []

    items = []
    # Each type maps to a (table_rows, type_string, file_prefix) triple.
    # The file_prefix matches the on-disk naming convention used by import_data.
    for rows, tname, prefix in (
        (plasmids,  "plasmid",  "plasmid"),
        (primers,   "primer",   "primer"),
        (kit_parts, "kitpart",  "kitpart"),
        (gblocks,   "gblock",   "gblock"),
        (parts,     "part",     "part"),
    ):
        for p in rows:
            d = dict(p)
            d["type"] = tname
            d["has_file"] = os.path.isfile(os.path.join(GB_DIR, f"{prefix}_{d['id']}.gb"))
            items.append(d)

    return {"items": items}


# Allowed type strings for the parse / reindex endpoints. Kept in sync with
# the list_sequences output so any type returned by it can be re-fetched.
_VALID_SEQ_TYPES = ("primer", "plasmid", "kitpart", "gblock", "part")


# ---------------------------------------------------------------------------
# Sequence parsing
# ---------------------------------------------------------------------------
@router.get("/circuits/sequences/{seq_type}/{seq_id}/parse")
def parse_sequence(seq_type: str, seq_id: int):
    if seq_type not in _VALID_SEQ_TYPES:
        raise HTTPException(400, f"seq_type must be one of: {', '.join(_VALID_SEQ_TYPES)}")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    return parse_genbank(fpath)


# ---------------------------------------------------------------------------
# Reindex (rotate circular sequence origin)
# ---------------------------------------------------------------------------
@router.post("/circuits/reindex")
def reindex_sequence(body: ReindexRequest):
    """Rotate a circular sequence so new_origin becomes position 0."""
    if body.seq_type not in _VALID_SEQ_TYPES:
        raise HTTPException(400, f"seq_type must be one of: {', '.join(_VALID_SEQ_TYPES)}")
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
# Helper: build a GenBank string from a list of parts
# ---------------------------------------------------------------------------
def _build_genbank(parts: list, name: str, topology: str = "linear") -> tuple[str, int]:
    """Concatenate `parts` (each having .name, .seq/.sequence, .direction, .type,
    .color optional) into one GenBank record. Returns (gb_string, length)."""
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from Bio import SeqIO as _SeqIO
    from io import StringIO

    if topology not in ("linear", "circular"):
        topology = "linear"

    full_seq = ""
    features = []

    for p in parts:
        # Tolerate both ExportPartInput (.seq) and SavePartInput (.sequence) shapes
        raw = getattr(p, "seq", None) or getattr(p, "sequence", "") or ""
        seq_clean = raw.upper().replace(" ", "").replace("\n", "")
        if not seq_clean:
            continue
        start = len(full_seq)
        full_seq += seq_clean
        end = len(full_seq)
        direction = getattr(p, "direction", 1) or 1
        strand = 1 if direction == 1 else -1
        part_type = getattr(p, "type", None) or getattr(p, "part_type", None) or "misc"
        gb_type = PART_TO_GB_TYPE.get(part_type, "misc_feature")
        color = getattr(p, "color", None) or "#95A5A6"

        feat = SeqFeature(
            FeatureLocation(start, end, strand=strand),
            type=gb_type,
            qualifiers={
                "label": [p.name],
                "ApEinfo_fwdcolor": [color],
                "ApEinfo_revcolor": [color],
            },
        )
        features.append(feat)

    if not full_seq:
        raise HTTPException(400, "No parts have sequences")

    safe_name = name.replace(" ", "_")[:16]
    rec = SeqRecord(
        Seq(full_seq),
        id=safe_name,
        name=safe_name,
        description=name,
        annotations={"molecule_type": "DNA", "topology": topology},
    )
    source = SeqFeature(
        FeatureLocation(0, len(full_seq)),
        type="source",
        qualifiers={"mol_type": ["other DNA"], "organism": ["synthetic construct"]},
    )
    rec.features = [source] + features

    output = StringIO()
    _SeqIO.write(rec, output, "genbank")
    return output.getvalue(), len(full_seq)


# ---------------------------------------------------------------------------
# Export circuit as a GenBank string (download from frontend)
# ---------------------------------------------------------------------------
@router.post("/circuits/export-gb")
def export_gb(body: ExportGBRequest):
    """Concatenate part sequences and export as a GenBank string."""
    parts_with_seq = [p for p in body.parts if p.seq]
    if not parts_with_seq:
        raise HTTPException(400, "No parts have sequences")
    gb_content, length = _build_genbank(parts_with_seq, body.name,
                                        topology=body.topology or "linear")
    return {
        "gb_content": gb_content,
        "length": length,
        "num_parts": len(parts_with_seq),
    }


# ---------------------------------------------------------------------------
# Save circuit parts to any DB table (with annotations preserved as .gb files)
# ---------------------------------------------------------------------------
VALID_TARGETS = ("parts", "kit_parts", "plasmids", "primers", "gblocks")

# Map target → on-disk .gb filename prefix (matches import_data's convention).
_TARGET_TO_PREFIX = {
    "parts":     "part",
    "kit_parts": "kitpart",
    "plasmids":  "plasmid",
    "primers":   "primer",
    "gblocks":   "gblock",
}
# Map target → the cloning view's type string (singular). Frontend can use
# this to build a "View in cloning" link via the existing cross-view nav.
_TARGET_TO_CLONING_TYPE = {
    "parts":     "part",
    "kit_parts": "kitpart",
    "plasmids":  "plasmid",
    "primers":   "primer",
    "gblocks":   "gblock",
}


def _write_circuit_gb(target: str, row_id: int, parts: list, name: str,
                      topology: str) -> str:
    """Build a .gb for the given parts and persist it at /data/gb_files/<prefix>_<id>.gb.
    Returns the filename used (for the gb_file column)."""
    gb_content, _length = _build_genbank(parts, name, topology=topology)
    prefix = _TARGET_TO_PREFIX[target]
    fname = f"{prefix}_{row_id}.gb"
    fpath = os.path.join(GB_DIR, fname)
    os.makedirs(GB_DIR, exist_ok=True)
    with open(fpath, "w") as f:
        f.write(gb_content)
    return fname


@router.post("/circuits/save-to-db")
def save_to_db(body: SaveToDBRequest):
    """Save circuit parts to the chosen DB table, writing a .gb per row so the
    annotations are preserved and the new entry is browsable in cloning view.

    Combining rules:
      - target='plasmids' with multiple parts → ONE row containing the whole
        concatenated circuit (because "one plasmid per part" makes no sense).
      - any other target → one row per part.
    Frontend's "save single" mode just sends one part either way."""
    if body.target not in VALID_TARGETS:
        raise HTTPException(400, f"Invalid target: {body.target}. Must be one of {VALID_TARGETS}")

    # Decide topology: explicit > default-circular-for-plasmids > linear
    topology = body.topology
    if topology not in ("linear", "circular"):
        topology = "circular" if body.target == "plasmids" else "linear"

    now = datetime.utcnow().isoformat()
    extra = body.extra or {}

    # Filter out parts with no sequence — they're not savable
    usable_parts = [p for p in body.parts if (p.sequence or "").strip()]
    if not usable_parts:
        raise HTTPException(400, "No parts have sequences")

    # Decide save strategy
    combine_all = (body.target == "plasmids" and len(usable_parts) > 1)
    save_groups = [usable_parts] if combine_all else [[p] for p in usable_parts]

    saved = []
    with get_db() as conn:
        for group in save_groups:
            # Build the row name. Combined: use the circuit name. Single-part: use the part name.
            row_name = body.circuit_name if combine_all else group[0].name
            # Concatenate sequences for the row
            full_seq = "".join((p.sequence or "").upper().replace(" ", "").replace("\n", "")
                               for p in group)
            if not full_seq:
                continue

            # Insert the row first (we need the id to name the .gb file)
            direction_label = "forward" if group[0].direction == 1 else "reverse"
            source_desc = (
                f"Circuit: {body.circuit_name} ({len(group)} parts)" if combine_all else
                (f"From {group[0].source}" if group[0].source else f"Circuit: {body.circuit_name}")
            )
            part_type = group[0].part_type if not combine_all else "circuit"

            if body.target == "parts":
                cur = conn.execute(
                    "INSERT INTO parts (name, description, sequence, length, project, "
                    "subcategory, part_type, notes, created) VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        row_name,
                        source_desc,
                        full_seq,
                        len(full_seq),
                        extra.get("project", body.circuit_name),
                        extra.get("subcategory", ""),
                        part_type or "",
                        extra.get("notes", f"{part_type} ({direction_label})"),
                        now,
                    ),
                )
            elif body.target == "kit_parts":
                cur = conn.execute(
                    "INSERT INTO kit_parts (name, kit_name, part_type, description, created) "
                    "VALUES (?,?,?,?,?)",
                    (
                        row_name,
                        extra.get("kit_name", "Circuit Design"),
                        part_type or "",
                        source_desc,
                        now,
                    ),
                )
            elif body.target == "plasmids":
                cur = conn.execute(
                    "INSERT INTO plasmids (name, use, project, created) VALUES (?,?,?,?)",
                    (
                        row_name,
                        extra.get("use", source_desc),
                        extra.get("project", body.circuit_name),
                        now,
                    ),
                )
            elif body.target == "primers":
                cur = conn.execute(
                    "INSERT INTO primers (name, sequence, use, created) VALUES (?,?,?,?)",
                    (
                        row_name,
                        full_seq,
                        extra.get("use", source_desc),
                        now,
                    ),
                )
            elif body.target == "gblocks":
                cur = conn.execute(
                    "INSERT INTO gblocks (name, sequence, length, project, use, notes, created) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (
                        row_name,
                        full_seq,
                        len(full_seq),
                        extra.get("project", body.circuit_name),
                        extra.get("use", source_desc),
                        extra.get("notes", ""),
                        now,
                    ),
                )

            row_id = cur.lastrowid

            # Write the .gb file if requested. Failures here roll back the
            # row insert so we don't end up with DB rows pointing at missing files.
            gb_filename = None
            if body.write_gb:
                try:
                    gb_filename = _write_circuit_gb(
                        body.target, row_id, group, row_name, topology
                    )
                    conn.execute(
                        f"UPDATE {body.target} SET gb_file=? WHERE id=?",
                        (gb_filename, row_id),
                    )
                except Exception as e:
                    # Roll back this row's insert so DB stays consistent.
                    conn.execute(f"DELETE FROM {body.target} WHERE id=?", (row_id,))
                    raise HTTPException(500, f"Failed to write .gb for {row_name}: {e}")

            saved.append({
                "id": row_id,
                "name": row_name,
                "length": len(full_seq),
                "target": body.target,
                "cloning_type": _TARGET_TO_CLONING_TYPE[body.target],
                "gb_file": gb_filename,
            })
        conn.commit()
    return {"saved": saved, "count": len(saved), "topology": topology, "combined": combine_all}
