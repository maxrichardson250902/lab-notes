"""Sanger Sequencing — AB1 trace alignment and chromatogram viewer."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional, List
from datetime import datetime
from core.database import register_table, get_db
from Bio import SeqIO
import io, json, pathlib, uuid

try:
    from Bio import Align
    USE_NEW_ALIGNER = True
except ImportError:
    USE_NEW_ALIGNER = False

try:
    from Bio import pairwise2
    USE_LEGACY_ALIGNER = True
except ImportError:
    USE_LEGACY_ALIGNER = False

AB1_DIR = pathlib.Path("/data/ab1_files")
AB1_DIR.mkdir(parents=True, exist_ok=True)

register_table("sanger_alignments", """CREATE TABLE IF NOT EXISTS sanger_alignments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        TEXT,
    name            TEXT NOT NULL,
    ab1_filename    TEXT NOT NULL,
    ref_source      TEXT NOT NULL,
    ref_name        TEXT NOT NULL,
    identity_pct    REAL,
    aligned_query   TEXT,
    aligned_ref     TEXT,
    alignment_score REAL,
    query_start     INTEGER,
    query_end       INTEGER,
    ref_start       INTEGER,
    ref_end         INTEGER,
    num_mismatches  INTEGER,
    num_gaps        INTEGER,
    is_reverse      INTEGER DEFAULT 0,
    trim_start      INTEGER DEFAULT 0,
    trim_end        INTEGER DEFAULT 0,
    created         TEXT NOT NULL)""")

register_table("sanger_batches", """CREATE TABLE IF NOT EXISTS sanger_batches (
    batch_id        TEXT PRIMARY KEY,
    ref_sequence    TEXT NOT NULL,
    ref_annotations TEXT,
    ref_name        TEXT,
    created         TEXT NOT NULL)""")

router = APIRouter(prefix="/api", tags=["sanger"])


# ── AB1 parsing ──────────────────────────────────────────

def parse_ab1(filepath):
    """Extract trace data, base calls, quality, and peak positions from an AB1 file."""
    record = SeqIO.read(filepath, "abi")
    bases = str(record.seq)
    quals = list(record.letter_annotations.get("phred_quality", []))
    raw = record.annotations.get("abif_raw", {})
    trace_g = list(raw.get("DATA9", raw.get("DATA1", [])))
    trace_a = list(raw.get("DATA10", raw.get("DATA2", [])))
    trace_t = list(raw.get("DATA11", raw.get("DATA3", [])))
    trace_c = list(raw.get("DATA12", raw.get("DATA4", [])))
    peaks = list(raw.get("PLOC1", raw.get("PLOC2", [])))
    return {
        "bases": bases,
        "quals": quals,
        "traces": {"G": trace_g, "A": trace_a, "T": trace_t, "C": trace_c},
        "peaks": peaks,
    }


def quality_trim(bases, quals, threshold=20, window=10):
    """Trim low-quality bases from both ends using a sliding window approach.
    Returns (trimmed_bases, trim_start, trim_end) where trim_start/end are
    indices into the original sequence."""
    n = len(quals)
    if n == 0:
        return bases, 0, 0

    # Find start: first position where a window of bases averages above threshold
    trim_start = 0
    for i in range(n - window + 1):
        w = quals[i:i + window]
        if sum(w) / len(w) >= threshold:
            trim_start = i
            break
    else:
        trim_start = 0

    # Find end: last position where a window of bases averages above threshold
    trim_end = n
    for i in range(n - 1, window - 2, -1):
        w = quals[i - window + 1:i + 1]
        if sum(w) / len(w) >= threshold:
            trim_end = i + 1
            break
    else:
        trim_end = n

    if trim_start >= trim_end:
        # Couldn't find good region, use full sequence
        return bases, 0, n

    return bases[trim_start:trim_end], trim_start, trim_end


# ── Reference parsing ────────────────────────────────────

def parse_gb_annotations(record):
    """Extract all meaningful annotations from a BioPython SeqRecord.

    Iterates location.parts so that features written as a CompoundLocation
    (origin-wrapping features on circular sequences) emit one annotation per
    part instead of collapsing to the outer [min_start, max_end] bounds, which
    would visually paint a single feature across the whole plasmid.
    """
    annos = []
    seen = set()  # deduplicate overlapping gene/CDS with same label+span
    for feat in record.features:
        if feat.type == "source":
            continue
        label = ""
        for key in ("label", "gene", "product", "name", "locus_tag",
                     "standard_name", "note", "ApEinfo_label"):
            if key in feat.qualifiers:
                val = feat.qualifiers[key]
                label = val[0] if isinstance(val, list) else str(val)
                break
        if not label:
            label = feat.type
        strand = feat.location.strand
        color = _get_feat_color(feat)
        ftype = feat.type
        # A plain FeatureLocation exposes a one-item .parts list, so this
        # handles both plain and compound locations uniformly.
        for part in feat.location.parts:
            try:
                start = int(part.start)
                end = int(part.end)
            except Exception:
                continue
            if end <= start:
                continue
            # Deduplicate: if a gene and CDS share the same label and span, keep one.
            # Dedup is per-part-span, so the two halves of a wrapping feature aren't
            # collapsed into a single row.
            key = (label, start, end)
            if key in seen:
                continue
            seen.add(key)
            annos.append({
                "type": ftype,
                "label": label,
                "start": start,
                "end": end,
                "strand": strand,
                "color": color,
            })
    return annos


def _get_feat_color(feat):
    """Try to extract color from SnapGene/ApE qualifiers."""
    for key in ("ApEinfo_fwdcolor", "ApEinfo_revcolor", "color"):
        if key in feat.qualifiers:
            val = feat.qualifiers[key]
            c = val[0] if isinstance(val, list) else str(val)
            if c.startswith("#") or c.startswith("rgb"):
                return c
    return None


def _is_circular(record):
    """Read topology from a BioPython SeqRecord. Defaults to linear if unset."""
    topo = record.annotations.get("topology", "linear")
    return isinstance(topo, str) and topo.lower() == "circular"


def get_reference_sequence(ref_source, ref_id=None, ref_text=None):
    """Get reference sequence, name, annotations, and topology flag.
    Returns (seq_str, name, annotations_list, is_circular_bool)."""
    annotations = []
    is_circular = False
    # Handle inventory items — ref_source is the table name, ref_id is the row id
    INVENTORY_TABLES = {"plasmids", "gblocks", "kit_parts", "parts", "primers"}
    # Map table name to singular prefix used in file naming
    TABLE_TO_PREFIX = {
        "plasmids": "plasmid", "gblocks": "gblock", "kit_parts": "kit_part",
        "parts": "part", "primers": "primer",
    }
    if ref_source in INVENTORY_TABLES and ref_id:
        with get_db() as conn:
            row = conn.execute(
                f"SELECT name, gb_file FROM {ref_source} WHERE id=?", (ref_id,)
            ).fetchone()
        if not row or not row["gb_file"]:
            raise HTTPException(404, f"No .gb file for {ref_source} id {ref_id}")
        # Try {prefix}_{id}.gb first (standard naming), then original gb_file value
        prefix = TABLE_TO_PREFIX.get(ref_source, ref_source.rstrip("s"))
        candidates = [
            pathlib.Path(f"/data/gb_files/{prefix}_{ref_id}.gb"),
            pathlib.Path(f"/data/gb_files/{row['gb_file']}"),
        ]
        gb_path = None
        for c in candidates:
            if c.exists():
                gb_path = c
                break
        if not gb_path:
            raise HTTPException(404, f".gb file not found for {ref_source} id {ref_id}")
        record = SeqIO.read(gb_path, "genbank")
        annotations = parse_gb_annotations(record)
        is_circular = _is_circular(record)
        return str(record.seq), row["name"] or record.name or f"{ref_source}_{ref_id}", annotations, is_circular
    elif ref_source == "fasta" and ref_text:
        record = SeqIO.read(io.StringIO(ref_text), "fasta")
        return str(record.seq), record.id, annotations, False
    elif ref_source == "genbank" and ref_text:
        record = SeqIO.read(io.StringIO(ref_text), "genbank")
        annotations = parse_gb_annotations(record)
        is_circular = _is_circular(record)
        return str(record.seq), record.name or record.id, annotations, is_circular
    elif ref_source == "raw" and ref_text:
        seq = ref_text.strip().upper().replace("\n", "").replace(" ", "")
        return seq, "manual_sequence", annotations, False
    raise HTTPException(400, "Invalid reference source")


@router.get("/sanger/references")
def list_references():
    """Return all DNA items with .gb files across all inventory tables.
    Each item carries a `meta` string with table-specific disambiguating context
    (project, kit_name, subcategory) so similarly-named items can be told apart
    in the dropdown."""
    items = []
    # Each tuple: (table, label, prefix, [meta_cols]). meta_cols are columns to
    # join (filtering blanks) into the meta hint shown after the name.
    tables = [
        ("plasmids",  "Plasmid",  "plasmid",  ["project"]),
        ("kit_parts", "Kit Part", "kit_part", ["kit_name", "part_type"]),
        ("parts",     "Part",     "part",     ["project", "subcategory", "part_type"]),
        ("gblocks",   "gBlock",   "gblock",   ["project"]),
        ("primers",   "Primer",   "primer",   ["project", "use"]),
    ]
    gb_dir = pathlib.Path("/data/gb_files")
    with get_db() as conn:
        for table, label, prefix, meta_cols in tables:
            # SELECT id, name, gb_file, <meta_cols>. Build dynamically but only
            # include columns we know exist for this table (defensive against
            # older schemas missing newer columns).
            try:
                existing_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            except Exception:
                continue
            present_meta = [c for c in meta_cols if c in existing_cols]
            select_cols = ["id", "name", "gb_file"] + present_meta
            try:
                rows = conn.execute(
                    f"SELECT {', '.join(select_cols)} FROM {table} "
                    f"WHERE gb_file IS NOT NULL AND gb_file != ''"
                ).fetchall()
            except Exception:
                continue
            for r in rows:
                has_file = (
                    (gb_dir / f"{prefix}_{r['id']}.gb").exists() or
                    (gb_dir / r["gb_file"]).exists()
                )
                if not has_file:
                    continue
                meta_parts = []
                for c in present_meta:
                    v = r[c]
                    if v is not None and str(v).strip():
                        meta_parts.append(str(v).strip())
                items.append({
                    "id": r["id"],
                    "name": r["name"],
                    "type": table,
                    "label": label,
                    "meta": " / ".join(meta_parts),
                })
    return {"items": items}


# ── Alignment ────────────────────────────────────────────

COMP = str.maketrans("ACGTacgt", "TGCAtgca")

def reverse_complement(seq):
    return seq.translate(COMP)[::-1]


def _split_wrap_alignment(result, ref_len):
    """Take a single alignment result computed against a DOUBLED reference and
    return a list of pieces normalised to real ref coordinates [0, ref_len).

    Three cases:
      (a) Alignment sits entirely in the first copy → 1 piece, unchanged.
      (b) Alignment sits entirely in the second copy → 1 piece, coords - ref_len.
      (c) Alignment spans the origin (ref_start < ref_len <= ref_end) → 2 pieces:
          piece 1 covers [ref_start, ref_len), piece 2 covers [0, ref_end - ref_len).
    """
    rs = int(result["ref_start"])
    re = int(result["ref_end"])

    # Case (a): all in first copy
    if re <= ref_len:
        return [result]

    # Case (b): all in second copy → shift coords back
    if rs >= ref_len:
        result["ref_start"] = rs - ref_len
        result["ref_end"] = re - ref_len
        return [result]

    # Case (c): wraps origin. Walk aligned strings to find the column where
    # ref position transitions from ref_len-1 to ref_len.
    aligned_ref = result["aligned_ref"]
    aligned_query = result["aligned_query"]
    ref_pos = rs
    split_col = None
    for i, ch in enumerate(aligned_ref):
        if ref_pos == ref_len:
            split_col = i
            break
        if ch != "-":
            ref_pos += 1
    if split_col is None:
        # Shouldn't happen given rs < ref_len <= re, but be defensive.
        result["ref_start"] = rs
        result["ref_end"] = re if re <= ref_len else ref_len
        return [result]

    # Where does the query position stand at split_col?
    q_at_split = int(result["query_start"])
    for i in range(split_col):
        if aligned_query[i] != "-":
            q_at_split += 1

    def _stats(ref_str, qry_str, r_start, r_end, q_start, q_end):
        matches = sum(1 for a, b in zip(ref_str, qry_str) if a == b and a != "-")
        mismatches = sum(1 for a, b in zip(ref_str, qry_str)
                         if a != b and a != "-" and b != "-")
        gaps = ref_str.count("-") + qry_str.count("-")
        total = matches + mismatches
        identity = (matches / total * 100) if total > 0 else 0.0
        return {
            "aligned_ref": ref_str,
            "aligned_query": qry_str,
            "score": result["score"],  # share the aligner's score across pieces
            "identity_pct": round(identity, 2),
            "num_mismatches": mismatches,
            "num_gaps": gaps,
            "ref_start": int(r_start),
            "ref_end": int(r_end),
            "query_start": int(q_start),
            "query_end": int(q_end),
        }

    piece1 = _stats(
        aligned_ref[:split_col], aligned_query[:split_col],
        rs, ref_len, int(result["query_start"]), q_at_split,
    )
    piece2 = _stats(
        aligned_ref[split_col:], aligned_query[split_col:],
        0, re - ref_len, q_at_split, int(result["query_end"]),
    )
    return [piece1, piece2]


def do_alignment(query_seq, ref_seq, is_circular=False):
    """Try forward and reverse-complement alignment, pick the best.

    For circular references, aligns against a DOUBLED reference (ref+ref) so
    reads that span the origin get a single contiguous alignment; then splits
    origin-spanning hits into two pieces normalised to real ref coordinates.

    Returns a list of alignment pieces (list of 1 for normal cases, list of 2
    when a read spans the origin), or None if no alignment could be found.
    Each piece dict has 'is_reverse' set.
    """
    if is_circular:
        ref_len = len(ref_seq)
        target = ref_seq + ref_seq
        fwd = _do_align(query_seq, target)
        rc_seq = reverse_complement(query_seq)
        rev = _do_align(rc_seq, target)
    else:
        ref_len = None
        fwd = _do_align(query_seq, ref_seq)
        rc_seq = reverse_complement(query_seq)
        rev = _do_align(rc_seq, ref_seq)

    if fwd and rev:
        picked, is_rev = (fwd, False) if fwd["score"] >= rev["score"] else (rev, True)
    elif fwd:
        picked, is_rev = fwd, False
    elif rev:
        picked, is_rev = rev, True
    else:
        return None

    pieces = _split_wrap_alignment(picked, ref_len) if is_circular else [picked]
    for p in pieces:
        p["is_reverse"] = is_rev
    return pieces


def _do_align(query_seq, ref_seq):
    if USE_NEW_ALIGNER:
        return _align_new(query_seq, ref_seq)
    elif USE_LEGACY_ALIGNER:
        return _align_legacy(query_seq, ref_seq)
    raise HTTPException(500, "No alignment module available")


def _align_new(query_seq, ref_seq):
    aligner = Align.PairwiseAligner()
    aligner.mode = "local"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -5
    aligner.extend_gap_score = -0.5
    alignments = aligner.align(ref_seq, query_seq)
    try:
        best = alignments[0]
    except (IndexError, StopIteration):
        return None

    aligned_pairs = best.aligned
    ref_intervals = [list(map(int, iv)) for iv in aligned_pairs[0]]
    query_intervals = [list(map(int, iv)) for iv in aligned_pairs[1]]

    ref_aln = []
    qry_aln = []

    for i in range(len(ref_intervals)):
        r_start, r_end = ref_intervals[i]
        q_start, q_end = query_intervals[i]
        r_len = r_end - r_start
        q_len = q_end - q_start
        if r_len == q_len:
            ref_aln.extend(list(ref_seq[r_start:r_end]))
            qry_aln.extend(list(query_seq[q_start:q_end]))
        elif r_len > q_len:
            ref_aln.extend(list(ref_seq[r_start:r_end]))
            qry_aln.extend(list(query_seq[q_start:q_end]))
            qry_aln.extend(["-"] * (r_len - q_len))
        else:
            ref_aln.extend(list(ref_seq[r_start:r_end]))
            ref_aln.extend(["-"] * (q_len - r_len))
            qry_aln.extend(list(query_seq[q_start:q_end]))
        if i < len(ref_intervals) - 1:
            next_r = ref_intervals[i + 1][0]
            next_q = query_intervals[i + 1][0]
            gap_r = next_r - r_end
            gap_q = next_q - q_end
            if gap_r > 0 and gap_q == 0:
                ref_aln.extend(list(ref_seq[r_end:next_r]))
                qry_aln.extend(["-"] * gap_r)
            elif gap_q > 0 and gap_r == 0:
                ref_aln.extend(["-"] * gap_q)
                qry_aln.extend(list(query_seq[q_end:next_q]))
            elif gap_r > 0 and gap_q > 0:
                mx = max(gap_r, gap_q)
                ref_aln.extend(list(ref_seq[r_end:next_r]))
                ref_aln.extend(["-"] * (mx - gap_r))
                qry_aln.extend(list(query_seq[q_end:next_q]))
                qry_aln.extend(["-"] * (mx - gap_q))

    ref_str = "".join(ref_aln)
    qry_str = "".join(qry_aln)
    return _calc_stats(ref_str, qry_str, float(best.score),
                       ref_intervals, query_intervals)


def _align_legacy(query_seq, ref_seq):
    alns = pairwise2.align.localms(ref_seq, query_seq, 2, -1, -5, -0.5)
    if not alns:
        return None
    best = alns[0]
    # Trim unaligned flanks
    r, q = best.seqA, best.seqB
    s = 0
    while s < len(r) and r[s] == "-" and q[s] == "-":
        s += 1
    e = len(r)
    while e > s and r[e - 1] == "-" and q[e - 1] == "-":
        e -= 1
    ref_str, qry_str = r[s:e], q[s:e]
    return _calc_stats(ref_str, qry_str, best.score,
                       [[s, e]], [[0, len(query_seq)]])


def _calc_stats(ref_str, qry_str, score, ref_ivs, qry_ivs):
    matches = sum(1 for a, b in zip(ref_str, qry_str) if a == b and a != "-")
    mismatches = sum(1 for a, b in zip(ref_str, qry_str) if a != b and a != "-" and b != "-")
    gaps = ref_str.count("-") + qry_str.count("-")
    total = matches + mismatches
    identity = (matches / total * 100) if total > 0 else 0
    return {
        "aligned_ref": ref_str,
        "aligned_query": qry_str,
        "score": score,
        "identity_pct": round(identity, 2),
        "num_mismatches": mismatches,
        "num_gaps": gaps,
        "ref_start": int(ref_ivs[0][0]) if ref_ivs else 0,
        "ref_end": int(ref_ivs[-1][1]) if ref_ivs else 0,
        "query_start": int(qry_ivs[0][0]) if qry_ivs else 0,
        "query_end": int(qry_ivs[-1][1]) if qry_ivs else 0,
    }


# ── Endpoints ────────────────────────────────────────────

@router.get("/sanger/alignments")
def list_alignments():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM sanger_alignments ORDER BY created DESC"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


@router.get("/sanger/alignments/{aid}")
def get_alignment(aid: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sanger_alignments WHERE id=?", (aid,)).fetchone()
    if not row:
        raise HTTPException(404, "Alignment not found")
    return dict(row)


@router.get("/sanger/alignments/{aid}/trace")
def get_trace(aid: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT ab1_filename, is_reverse, trim_start, trim_end FROM sanger_alignments WHERE id=?", (aid,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Alignment not found")
    ab1_path = AB1_DIR / row["ab1_filename"]
    if not ab1_path.exists():
        raise HTTPException(404, "AB1 file not found")
    data = parse_ab1(ab1_path)
    is_rev = row["is_reverse"] if "is_reverse" in row.keys() else 0
    total_bases = len(data["bases"])

    # Get trim values (handle missing columns gracefully)
    try:
        ts = row["trim_start"] or 0
        te = row["trim_end"] or total_bases
    except (KeyError, IndexError):
        ts, te = 0, total_bases

    if is_rev:
        data["bases"] = reverse_complement(data["bases"])
        data["quals"] = list(reversed(data["quals"]))
        trace_len = max(len(data["traces"]["G"]), len(data["traces"]["A"]),
                       len(data["traces"]["T"]), len(data["traces"]["C"]), 1)
        g, a, t, c = data["traces"]["G"], data["traces"]["A"], data["traces"]["T"], data["traces"]["C"]
        data["traces"]["G"] = list(reversed(c))
        data["traces"]["C"] = list(reversed(g))
        data["traces"]["A"] = list(reversed(t))
        data["traces"]["T"] = list(reversed(a))
        data["peaks"] = [trace_len - 1 - p for p in reversed(data["peaks"])]
        # Reverse trim indices
        new_ts = total_bases - te
        new_te = total_bases - ts
        ts, te = new_ts, new_te

    data["trim_start"] = ts
    data["trim_end"] = te
    return data


@router.post("/sanger/align")
async def align_ab1(
    ab1: List[UploadFile] = File(...),
    ref_source: str = Form(...),
    ref_id: Optional[str] = Form(None),
    ref_text: Optional[str] = Form(None),
    name: Optional[str] = Form(None),
    trim_qual: Optional[int] = Form(20),
):
    try:
        ref_seq, ref_label, ref_annos, is_circular = get_reference_sequence(
            ref_source, ref_id, ref_text
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Failed to parse reference: {e}")

    batch_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    # Store batch reference data
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sanger_batches (batch_id, ref_sequence, ref_annotations, ref_name, created) VALUES (?,?,?,?,?)",
            (batch_id, ref_seq, json.dumps(ref_annos), ref_label, now),
        )
        conn.commit()

    results = []
    errors = []

    for file in ab1:
        content = await file.read()
        safe_name = file.filename.replace("/", "_").replace("\\", "_")
        stored_name = f"{ts}_{safe_name}"
        ab1_path = AB1_DIR / stored_name
        ab1_path.write_bytes(content)

        try:
            trace_data = parse_ab1(ab1_path)
        except Exception as e:
            ab1_path.unlink(missing_ok=True)
            errors.append({"file": file.filename, "error": f"Parse failed: {e}"})
            continue

        query_seq = trace_data["bases"]
        if not query_seq:
            ab1_path.unlink(missing_ok=True)
            errors.append({"file": file.filename, "error": "No base calls"})
            continue

        # Quality trim
        trim_threshold = trim_qual if trim_qual and trim_qual > 0 else 0
        trim_start_idx = 0
        trim_end_idx = len(query_seq)
        if trim_threshold > 0:
            query_seq, trim_start_idx, trim_end_idx = quality_trim(
                query_seq, trace_data["quals"], threshold=trim_threshold
            )
            if not query_seq:
                ab1_path.unlink(missing_ok=True)
                errors.append({"file": file.filename, "error": "No bases left after trimming"})
                continue

        pieces = do_alignment(query_seq, ref_seq, is_circular=is_circular)
        if not pieces:
            ab1_path.unlink(missing_ok=True)
            errors.append({"file": file.filename, "error": "No valid alignment"})
            continue

        base_name = safe_name.replace(".ab1", "").replace(".abi", "")
        if name and len(ab1) == 1:
            base_name = name
        is_rev = 1 if pieces[0].get("is_reverse") else 0
        if is_rev:
            base_name += " (RC)"

        # One DB row per piece; origin-split reads become 2 rows sharing an AB1.
        for idx, piece in enumerate(pieces):
            piece_name = base_name
            if len(pieces) > 1:
                piece_name = f"{base_name} (part {idx + 1}/{len(pieces)})"

            with get_db() as conn:
                cur = conn.execute(
                    """INSERT INTO sanger_alignments
                       (batch_id, name, ab1_filename, ref_source, ref_name, identity_pct,
                        aligned_query, aligned_ref, alignment_score,
                        query_start, query_end, ref_start, ref_end,
                        num_mismatches, num_gaps, is_reverse, trim_start, trim_end, created)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (batch_id, piece_name, stored_name, ref_source, ref_label,
                     piece["identity_pct"], piece["aligned_query"], piece["aligned_ref"],
                     piece["score"], piece["query_start"], piece["query_end"],
                     piece["ref_start"], piece["ref_end"],
                     piece["num_mismatches"], piece["num_gaps"], is_rev,
                     trim_start_idx, trim_end_idx, now),
                )
                conn.commit()
                row = dict(conn.execute(
                    "SELECT * FROM sanger_alignments WHERE id=?", (cur.lastrowid,)
                ).fetchone())
            results.append(row)

    if not results and errors:
        raise HTTPException(400, f"All files failed: {errors[0]['error']}")

    return {"items": results, "errors": errors, "batch_id": batch_id}


@router.get("/sanger/batch/{batch_id}")
def get_batch(batch_id: str):
    with get_db() as conn:
        batch = conn.execute(
            "SELECT * FROM sanger_batches WHERE batch_id=?", (batch_id,)
        ).fetchone()
        rows = conn.execute(
            "SELECT * FROM sanger_alignments WHERE batch_id=? ORDER BY name",
            (batch_id,),
        ).fetchall()
    if not rows:
        raise HTTPException(404, "Batch not found")
    batch_data = dict(batch) if batch else {}
    if batch_data.get("ref_annotations"):
        batch_data["ref_annotations"] = json.loads(batch_data["ref_annotations"])
    return {
        "items": [dict(r) for r in rows],
        "ref_sequence": batch_data.get("ref_sequence", ""),
        "ref_annotations": batch_data.get("ref_annotations", []),
        "ref_name": batch_data.get("ref_name", ""),
    }


@router.delete("/sanger/batch/{batch_id}")
def delete_batch(batch_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT ab1_filename FROM sanger_alignments WHERE batch_id=?", (batch_id,)
        ).fetchall()
        for row in rows:
            (AB1_DIR / row["ab1_filename"]).unlink(missing_ok=True)
        conn.execute("DELETE FROM sanger_alignments WHERE batch_id=?", (batch_id,))
        conn.execute("DELETE FROM sanger_batches WHERE batch_id=?", (batch_id,))
        conn.commit()
    return {"ok": True}


@router.delete("/sanger/alignments/{aid}")
def delete_alignment(aid: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT ab1_filename FROM sanger_alignments WHERE id=?", (aid,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Alignment not found")
        ab1_filename = row["ab1_filename"]
        conn.execute("DELETE FROM sanger_alignments WHERE id=?", (aid,))
        # Only remove the AB1 file if no sibling alignment still references it
        # (origin-split reads produce two rows sharing one AB1).
        still_used = conn.execute(
            "SELECT 1 FROM sanger_alignments WHERE ab1_filename=? LIMIT 1",
            (ab1_filename,),
        ).fetchone()
        if not still_used:
            (AB1_DIR / ab1_filename).unlink(missing_ok=True)
        conn.commit()
    return {"ok": True}
