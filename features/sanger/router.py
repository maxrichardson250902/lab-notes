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
    """Extract all meaningful annotations from a BioPython SeqRecord."""
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
        try:
            start = int(feat.location.start)
            end = int(feat.location.end)
        except Exception:
            continue
        if end <= start:
            continue
        # Deduplicate: if a gene and CDS share the same label and span, keep one
        key = (label, start, end)
        if key in seen:
            continue
        seen.add(key)
        # Map SnapGene/ApE feature types to standard types
        ftype = feat.type
        annos.append({
            "type": ftype,
            "label": label,
            "start": start,
            "end": end,
            "strand": feat.location.strand,
            "color": _get_feat_color(feat),
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


def get_reference_sequence(ref_source, ref_id=None, ref_text=None):
    """Get reference sequence, name, and annotations."""
    annotations = []
    if ref_source == "plasmid" and ref_id:
        gb_path = pathlib.Path(f"/data/gb_files/plasmid_{ref_id}.gb")
        if not gb_path.exists():
            raise HTTPException(404, "Plasmid .gb file not found")
        record = SeqIO.read(gb_path, "genbank")
        annotations = parse_gb_annotations(record)
        return str(record.seq), record.name or f"plasmid_{ref_id}", annotations
    elif ref_source == "fasta" and ref_text:
        record = SeqIO.read(io.StringIO(ref_text), "fasta")
        return str(record.seq), record.id, annotations
    elif ref_source == "genbank" and ref_text:
        record = SeqIO.read(io.StringIO(ref_text), "genbank")
        annotations = parse_gb_annotations(record)
        return str(record.seq), record.name or record.id, annotations
    elif ref_source == "raw" and ref_text:
        seq = ref_text.strip().upper().replace("\n", "").replace(" ", "")
        return seq, "manual_sequence", annotations
    raise HTTPException(400, "Invalid reference source")


# ── Alignment ────────────────────────────────────────────

COMP = str.maketrans("ACGTacgt", "TGCAtgca")

def reverse_complement(seq):
    return seq.translate(COMP)[::-1]


def do_alignment(query_seq, ref_seq):
    """Try both forward and reverse complement, return best."""
    fwd = _do_align(query_seq, ref_seq)
    rc_seq = reverse_complement(query_seq)
    rev = _do_align(rc_seq, ref_seq)

    if fwd and rev:
        result = fwd if fwd["score"] >= rev["score"] else rev
    elif fwd:
        result = fwd
    elif rev:
        result = rev
    else:
        return None

    if result is rev and rev is not None:
        result["is_reverse"] = True
    else:
        result["is_reverse"] = False
    return result


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
        ref_seq, ref_label, ref_annos = get_reference_sequence(ref_source, ref_id, ref_text)
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

        result = do_alignment(query_seq, ref_seq)
        if not result:
            ab1_path.unlink(missing_ok=True)
            errors.append({"file": file.filename, "error": "No valid alignment"})
            continue

        aln_name = safe_name.replace(".ab1", "").replace(".abi", "")
        if name and len(ab1) == 1:
            aln_name = name
        is_rev = 1 if result.get("is_reverse") else 0
        if is_rev:
            aln_name += " (RC)"

        with get_db() as conn:
            cur = conn.execute(
                """INSERT INTO sanger_alignments
                   (batch_id, name, ab1_filename, ref_source, ref_name, identity_pct,
                    aligned_query, aligned_ref, alignment_score,
                    query_start, query_end, ref_start, ref_end,
                    num_mismatches, num_gaps, is_reverse, trim_start, trim_end, created)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (batch_id, aln_name, stored_name, ref_source, ref_label,
                 result["identity_pct"], result["aligned_query"], result["aligned_ref"],
                 result["score"], result["query_start"], result["query_end"],
                 result["ref_start"], result["ref_end"],
                 result["num_mismatches"], result["num_gaps"], is_rev,
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
        (AB1_DIR / row["ab1_filename"]).unlink(missing_ok=True)
        conn.execute("DELETE FROM sanger_alignments WHERE id=?", (aid,))
        conn.commit()
    return {"ok": True}
