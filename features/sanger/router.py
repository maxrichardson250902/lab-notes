"""Sanger Sequencing — AB1 trace alignment and chromatogram viewer."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from core.database import register_table, register_seed, ensure_column, get_db
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

# Rotation offset added later. When the batch's stored ref_sequence has
# been rotated to avoid wrap-splitting reads, this records the amount
# rotated (bp) so the frontend can translate back to original .gb
# coords for tooltips. 0 = not rotated / same as source .gb.
register_seed(lambda conn: ensure_column(conn, "sanger_batches",
                                         "rotation_offset",
                                         "INTEGER NOT NULL DEFAULT 0"))

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
        # Tables that also carry a plain 'sequence' column — items in
        # these can be aligned even when they have no .gb file on disk
        # (DNA Manager entries with sequences imported as text rather
        # than as annotated GenBank). Circularity is unknown from a
        # bare sequence so we treat them as linear.
        SEQUENCE_ONLY_OK = {"gblocks", "primers", "parts"}
        has_seq_col = ref_source in SEQUENCE_ONLY_OK
        with get_db() as conn:
            cols = "name, gb_file" + (", sequence" if has_seq_col else "")
            row = conn.execute(
                f"SELECT {cols} FROM {ref_source} WHERE id=?", (ref_id,)
            ).fetchone()
        if not row:
            raise HTTPException(404, f"{ref_source} id {ref_id} not found")
        # Prefer the .gb file (has annotations + topology). Fall back
        # to the bare sequence column if there is one.
        prefix = TABLE_TO_PREFIX.get(ref_source, ref_source.rstrip("s"))
        gb_path = None
        if row["gb_file"]:
            candidates = [
                pathlib.Path(f"/data/gb_files/{prefix}_{ref_id}.gb"),
                pathlib.Path(f"/data/gb_files/{row['gb_file']}"),
            ]
            for c in candidates:
                if c.exists():
                    gb_path = c
                    break
        if gb_path:
            record = SeqIO.read(gb_path, "genbank")
            annotations = parse_gb_annotations(record)
            is_circular = _is_circular(record)
            return str(record.seq), row["name"] or record.name or f"{ref_source}_{ref_id}", annotations, is_circular
        if has_seq_col and row["sequence"] and row["sequence"].strip():
            seq = row["sequence"].strip().upper().replace("\n", "").replace(" ", "")
            return seq, row["name"] or f"{ref_source}_{ref_id}", [], False
        raise HTTPException(
            404,
            f"No sequence available for {ref_source} id {ref_id} "
            "(no .gb file and no sequence column value)",
        )
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
    SEQUENCE_ONLY_OK = {"gblocks", "primers", "parts"}
    gb_dir = pathlib.Path("/data/gb_files")
    with get_db() as conn:
        for table, label, prefix, meta_cols in tables:
            # SELECT id, name, gb_file, (sequence if present), <meta_cols>.
            # Include tables' 'sequence' column when they have one (DNA
            # Manager items may have plain sequences without a .gb file).
            # Defensive against older schemas missing newer columns.
            try:
                existing_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            except Exception:
                continue
            has_seq_col = table in SEQUENCE_ONLY_OK and "sequence" in existing_cols
            present_meta = [c for c in meta_cols if c in existing_cols]
            select_cols = ["id", "name", "gb_file"] + (["sequence"] if has_seq_col else []) + present_meta
            try:
                rows = conn.execute(f"SELECT {', '.join(select_cols)} FROM {table}").fetchall()
            except Exception:
                continue
            for r in rows:
                # Include the item if it has EITHER an on-disk .gb OR a
                # non-empty sequence column. Items with neither are
                # unusable as refs and stay out of the list.
                has_gb = bool(r["gb_file"]) and (
                    (gb_dir / f"{prefix}_{r['id']}.gb").exists() or
                    (gb_dir / r["gb_file"]).exists()
                )
                has_seq = has_seq_col and r["sequence"] and str(r["sequence"]).strip()
                if not (has_gb or has_seq):
                    continue
                meta_parts = []
                for c in present_meta:
                    v = r[c]
                    if v is not None and str(v).strip():
                        meta_parts.append(str(v).strip())
                # Mark seq-only items so the UI can hint (e.g. "no annotations").
                if not has_gb and has_seq:
                    meta_parts.append("seq only")
                items.append({
                    "id": r["id"],
                    "name": r["name"],
                    "type": table,
                    "label": label,
                    "meta": " / ".join(meta_parts),
                    "source_kind": "gb" if has_gb else "sequence",
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


def _piece_covers_circular(pieces, ref_len):
    """Given the list-of-pieces returned by do_alignment for ONE read,
    return the coverage interval in linear coord space [rs, re) where
    re may exceed ref_len (meaning: the read wraps origin, covered
    region is [rs, ref_len) ∪ [0, re-ref_len)). For single-piece
    alignments returns just (piece.ref_start, piece.ref_end)."""
    if not pieces:
        return None
    if len(pieces) == 1:
        p = pieces[0]
        return (int(p["ref_start"]), int(p["ref_end"]))
    # Wrap-split from _split_wrap_alignment: piece 0 ends at ref_len,
    # piece 1 starts at 0. Reconstruct as [piece0.ref_start,
    # piece1.ref_end + ref_len). Piece order = query order.
    # Sort by query_start just in case, so we don't mis-identify which
    # side is which.
    sorted_pieces = sorted(pieces, key=lambda p: int(p["query_start"]))
    return (int(sorted_pieces[0]["ref_start"]),
            int(sorted_pieces[1]["ref_end"]) + ref_len)


def _pick_rotation_offset(coverage_ranges, ref_len):
    """Given [(start, end), ...] coverage on a circular ref of length
    ref_len (end may exceed ref_len for wrap-covering reads), pick a
    rotation offset that places the new position 0 in the MIDDLE of
    the largest uncovered gap. Returns 0 (no rotation) if every point
    is covered, or if the offset would land exactly at 0 already.

    Strategy: convert everything to a set of covered arcs on the
    circle, merge overlapping arcs, then find the largest gap between
    consecutive arc ends and arc starts (going forwards around the
    circle). Rotation offset = midpoint of that gap."""
    if not coverage_ranges or ref_len <= 0:
        return 0
    # Convert each (start, end) range to on-circle arcs [s, e) with
    # 0 <= s < e <= ref_len. Wrap-covering ranges (end > ref_len) split
    # into two arcs.
    arcs = []
    for rs, re in coverage_ranges:
        if re <= rs or re <= 0:
            continue
        rs = max(0, rs)
        if re <= ref_len:
            arcs.append((rs, re))
        else:
            arcs.append((rs, ref_len))
            wrapped_end = re - ref_len
            if wrapped_end > ref_len:
                # A single read longer than the whole plasmid — degenerate.
                # Treat as full coverage: nothing to rotate to.
                return 0
            arcs.append((0, wrapped_end))
    if not arcs:
        return 0
    arcs.sort()
    # Merge overlapping / touching arcs
    merged = [list(arcs[0])]
    for s, e in arcs[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    # If the last arc touches ref_len and the first arc starts at 0,
    # they're actually connected on the circle — merge them.
    if len(merged) > 1 and merged[0][0] == 0 and merged[-1][1] == ref_len:
        merged[0][0] = merged[-1][0] - ref_len   # allow negative start
        merged.pop()
    # Now find the largest GAP walking around the circle. Gaps sit
    # between consecutive merged arcs; add one more between the last
    # arc's end and the first arc's start + ref_len (going around).
    best_gap_len = 0
    best_gap_mid = None
    for i in range(len(merged)):
        arc_end = merged[i][1]
        next_start = merged[(i + 1) % len(merged)][0]
        if i == len(merged) - 1:
            next_start += ref_len  # wrap for last→first gap
        gap = next_start - arc_end
        if gap > best_gap_len:
            best_gap_len = gap
            best_gap_mid = (arc_end + gap // 2) % ref_len
    # If everything is covered (best_gap_len == 0) there's no good
    # rotation — leave as-is.
    if best_gap_mid is None or best_gap_len < 1:
        return 0
    return int(best_gap_mid)


def _rotate_ref_and_annos(ref_seq, annos, offset, ref_len):
    """Return (rotated_seq, rotated_annos) where rotated_seq starts at
    the input's `offset` position on the circle. Annotations are
    shifted by -offset (mod ref_len); features that would span the new
    origin are split into two annotations sharing the label, so the
    frontend sees them as two ordinary linear ranges."""
    offset = offset % ref_len
    if offset == 0:
        return ref_seq, annos
    rotated = ref_seq[offset:] + ref_seq[:offset]
    new_annos = []
    for a in annos:
        s = (int(a["start"]) - offset) % ref_len
        e_raw = int(a["end"]) - offset
        # e_raw can now be negative (feature entirely in the pre-offset
        # window) — normalise.
        length = int(a["end"]) - int(a["start"])
        if length <= 0:
            continue
        # If the feature entirely fits without spanning the new origin
        # (i.e. shifted start + length <= ref_len), emit one piece.
        if s + length <= ref_len:
            new_annos.append({**a, "start": s, "end": s + length})
        else:
            # Splits across the rotated origin. Emit head + tail.
            head_len = ref_len - s
            new_annos.append({**a, "start": s, "end": ref_len})
            new_annos.append({**a, "start": 0, "end": length - head_len})

    # ── Merge adjacent same-feature pieces ────────────────────────
    # Features that wrap the ORIGINAL origin arrive as multiple parts
    # from Biopython's CompoundLocation (parse_gb_annotations iterates
    # feat.location.parts). Each part gets rotated independently; when
    # the rotation makes them CONTIGUOUS in the new frame, they must
    # be merged back into one piece — otherwise the frontend renders
    # them as multiple stripes on different rows (row-placement treats
    # 'touching' as 'overlapping'), which is the "stretching" the user
    # is seeing on wrap-spanning annotations.
    #
    # Legitimate wraps of the NEW origin are NOT merged: their tail is
    # at start=0 and head ends at end=ref_len, so head.end == ref_len
    # ≠ tail.start = 0 (unless ref_len == 0, impossible). Merge only
    # fires on true adjacency, not on pieces that touch the boundary.
    return rotated, _merge_adjacent_annos(new_annos)


def _merge_adjacent_annos(annos):
    """Merge annotations that (a) share label, type, strand, and colour,
    and (b) sit end-to-end (piece[i].end == piece[i+1].start). Preserves
    input order for unmerged annotations by keying groups on identity."""
    if not annos:
        return annos
    # Group indices by identity signature (label + type + strand + color)
    from collections import defaultdict
    groups = defaultdict(list)
    for idx, a in enumerate(annos):
        key = (a.get("label", ""), a.get("type", ""),
               a.get("strand", 0), a.get("color", None))
        groups[key].append(idx)

    # For each group, sort by start, merge adjacent pieces. Mark merged
    # pieces so they can be filtered out of the final list. Absorb into
    # the earliest piece so output order roughly follows input order.
    absorbed = set()
    for indices in groups.values():
        if len(indices) < 2:
            continue
        # Sort a copy by (start, end) — we mutate annos[keep] in place
        # to extend its end, and mark the later pieces absorbed.
        indices_by_start = sorted(indices, key=lambda i: (annos[i]["start"], annos[i]["end"]))
        keep = indices_by_start[0]
        for nxt in indices_by_start[1:]:
            if annos[nxt]["start"] == annos[keep]["end"]:
                # Extend the keeper's end and mark nxt absorbed
                annos[keep] = {**annos[keep], "end": annos[nxt]["end"]}
                absorbed.add(nxt)
            else:
                # Gap — this piece stands alone. Reset keep to nxt for
                # any further adjacency chain.
                keep = nxt
    return [a for idx, a in enumerate(annos) if idx not in absorbed]


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

    # ── Read all ab1 payloads FIRST so we can do a two-pass alignment if
    # any read wraps the current linearization. Store bytes + trimmed
    # sequences up-front; parse each once, align (up to) twice.
    # (Previous behaviour: single-pass alignment per file, wrap-splitting
    # each into two DB rows. That's still what happens for linear refs
    # and for circular refs where no read wraps. See _pick_rotation_offset
    # + _rotate_ref_and_annos for the rotate-and-re-align path.)
    file_states = []  # each: {filename, stored_name, ab1_path, query_seq, trim_start, trim_end, error}
    for file in ab1:
        content = await file.read()
        safe_name = file.filename.replace("/", "_").replace("\\", "_")
        stored_name = f"{ts}_{safe_name}"
        ab1_path = AB1_DIR / stored_name
        ab1_path.write_bytes(content)
        st = {"filename": file.filename, "stored_name": stored_name,
              "ab1_path": ab1_path, "query_seq": None,
              "trim_start": 0, "trim_end": 0, "error": None}
        try:
            trace_data = parse_ab1(ab1_path)
        except Exception as e:
            st["error"] = f"Parse failed: {e}"
            ab1_path.unlink(missing_ok=True)
            file_states.append(st)
            continue
        query_seq = trace_data["bases"]
        if not query_seq:
            st["error"] = "No base calls"
            ab1_path.unlink(missing_ok=True)
            file_states.append(st)
            continue
        trim_threshold = trim_qual if trim_qual and trim_qual > 0 else 0
        trim_start_idx, trim_end_idx = 0, len(query_seq)
        if trim_threshold > 0:
            query_seq, trim_start_idx, trim_end_idx = quality_trim(
                query_seq, trace_data["quals"], threshold=trim_threshold
            )
            if not query_seq:
                st["error"] = "No bases left after trimming"
                ab1_path.unlink(missing_ok=True)
                file_states.append(st)
                continue
        st["query_seq"] = query_seq
        st["trim_start"] = trim_start_idx
        st["trim_end"] = trim_end_idx
        file_states.append(st)

    # ── Pass 1: align every readable file against the ORIGINAL ref.
    # If any alignment wraps origin (returned >1 piece), we pick a
    # rotation offset that puts the new position 0 in a gap none of
    # the reads cover, then re-align in pass 2 against the rotated ref.
    # No wrapping reads → skip rotation entirely, use pass-1 pieces.
    pass1 = []   # list of pieces per file (None if error)
    any_wraps = False
    ref_len = len(ref_seq)
    for st in file_states:
        if st["error"] or st["query_seq"] is None:
            pass1.append(None)
            continue
        pieces = do_alignment(st["query_seq"], ref_seq, is_circular=is_circular)
        pass1.append(pieces)
        if pieces and len(pieces) > 1:
            any_wraps = True

    rotation_offset = 0
    aligned_pieces = pass1
    if any_wraps and is_circular:
        # Collect coverage from pass 1 to find the best rotation.
        coverage = []
        for pieces in pass1:
            if not pieces:
                continue
            rng = _piece_covers_circular(pieces, ref_len)
            if rng:
                coverage.append(rng)
        rotation_offset = _pick_rotation_offset(coverage, ref_len)
        if rotation_offset != 0:
            rotated_ref, rotated_annos = _rotate_ref_and_annos(
                ref_seq, ref_annos, rotation_offset, ref_len)
            # Pass 2: re-align every file against the rotated ref.
            pass2 = []
            for st in file_states:
                if st["error"] or st["query_seq"] is None:
                    pass2.append(None)
                    continue
                pieces = do_alignment(st["query_seq"], rotated_ref,
                                      is_circular=is_circular)
                pass2.append(pieces)
            aligned_pieces = pass2
            ref_seq = rotated_ref
            ref_annos = rotated_annos
        # If _pick_rotation_offset returned 0 (all points covered),
        # fall through to pass 1 pieces — split rendering is the best
        # we can do.

    # Store batch reference (possibly rotated) + rotation offset.
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sanger_batches (batch_id, ref_sequence, ref_annotations, "
            "ref_name, rotation_offset, created) VALUES (?,?,?,?,?,?)",
            (batch_id, ref_seq, json.dumps(ref_annos), ref_label,
             rotation_offset, now),
        )
        conn.commit()

    results = []
    errors = []

    for st, pieces in zip(file_states, aligned_pieces):
        if st["error"]:
            errors.append({"file": st["filename"], "error": st["error"]})
            continue
        if not pieces:
            st["ab1_path"].unlink(missing_ok=True)
            errors.append({"file": st["filename"], "error": "No valid alignment"})
            continue

        base_name = st["stored_name"].replace(ts + "_", "", 1).replace(".ab1", "").replace(".abi", "")
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
                    (batch_id, piece_name, st["stored_name"], ref_source, ref_label,
                     piece["identity_pct"], piece["aligned_query"], piece["aligned_ref"],
                     piece["score"], piece["query_start"], piece["query_end"],
                     piece["ref_start"], piece["ref_end"],
                     piece["num_mismatches"], piece["num_gaps"], is_rev,
                     st["trim_start"], st["trim_end"], now),
                )
                conn.commit()
                row = dict(conn.execute(
                    "SELECT * FROM sanger_alignments WHERE id=?", (cur.lastrowid,)
                ).fetchone())
            results.append(row)

    if not results and errors:
        raise HTTPException(400, f"All files failed: {errors[0]['error']}")

    return {"items": results, "errors": errors, "batch_id": batch_id,
            "rotation_offset": rotation_offset}


# ── Bulk screen: N .ab1 files × M refs, ephemeral matrix ────────────────────
# Purpose: "did my sequencing lab mix up my tubes?" Try each read against
# a set of candidate refs, see where the identity spikes. Nothing is written
# to sanger_alignments — clicking through a matrix cell calls the normal
# /sanger/align endpoint for that one (file, ref) pair to persist it.

@router.post("/sanger/screen")
async def screen_ab1_multi_ref(
    ab1: List[UploadFile] = File(...),
    refs: str = Form(...),
    trim_qual: Optional[int] = Form(20),
):
    """POST multi-file × multi-ref → matrix of scores. `refs` is a JSON
    array of {source, id?, text?} objects, same schema as
    get_reference_sequence's params (inventory table names, or
    genbank/fasta/raw + text). Returns per-file rows with per-ref
    scored results; the best hit per file is flagged. Alignments are
    NOT written to the DB."""
    try:
        ref_specs = json.loads(refs)
        assert isinstance(ref_specs, list) and ref_specs
    except (json.JSONDecodeError, AssertionError, TypeError):
        raise HTTPException(400, "refs must be a non-empty JSON array")

    # Resolve every ref up-front so a bad ref-spec fails cleanly before
    # we start reading potentially many AB1 files.
    resolved_refs = []
    for i, spec in enumerate(ref_specs):
        try:
            seq, name, _annos, is_circ = get_reference_sequence(
                spec.get("source"), spec.get("id"), spec.get("text"))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"ref[{i}] failed to parse: {e}")
        resolved_refs.append({
            "source": spec.get("source"),
            "id": spec.get("id"),
            "name": name,
            "seq": seq,
            "is_circular": is_circ,
            "length": len(seq),
        })

    file_rows = []
    trim_threshold = trim_qual if trim_qual and trim_qual > 0 else 0

    for file in ab1:
        # Parse the .ab1 in-memory (no disk write — this is ephemeral).
        content = await file.read()
        try:
            trace_record = SeqIO.read(io.BytesIO(content), "abi")
            query_seq_raw = str(trace_record.seq)
            quals_raw = list(trace_record.letter_annotations["phred_quality"])
        except Exception as e:
            file_rows.append({"file": file.filename, "error": f"Parse failed: {e}",
                              "results": []})
            continue
        if not query_seq_raw:
            file_rows.append({"file": file.filename, "error": "No base calls",
                              "results": []})
            continue
        if trim_threshold > 0:
            query_seq, trim_start, trim_end = quality_trim(
                query_seq_raw, quals_raw, threshold=trim_threshold)
            if not query_seq:
                file_rows.append({"file": file.filename,
                                  "error": "No bases left after trimming",
                                  "results": []})
                continue
        else:
            query_seq, trim_start, trim_end = query_seq_raw, 0, len(query_seq_raw)

        results = []
        for r in resolved_refs:
            pieces = do_alignment(query_seq, r["seq"], is_circular=r["is_circular"])
            if not pieces:
                results.append({
                    "ref_source": r["source"], "ref_id": r["id"], "ref_name": r["name"],
                    "score": 0.0, "identity_pct": 0.0,
                    "ref_start": None, "ref_end": None, "is_reverse": None,
                    "num_pieces": 0, "coverage_bp": 0, "ref_length": r["length"],
                })
                continue
            # Sum coverage across pieces (wrap-split); use max identity.
            total_cov = sum(int(p["ref_end"]) - int(p["ref_start"]) for p in pieces)
            best_id = max(float(p["identity_pct"]) for p in pieces)
            results.append({
                "ref_source": r["source"], "ref_id": r["id"], "ref_name": r["name"],
                "score": float(pieces[0]["score"]),
                "identity_pct": round(best_id, 2),
                "ref_start": int(pieces[0]["ref_start"]),
                "ref_end": int(pieces[-1]["ref_end"]),
                "is_reverse": bool(pieces[0].get("is_reverse")),
                "num_pieces": len(pieces),
                "coverage_bp": total_cov,
                "ref_length": r["length"],
            })
        # Flag the best hit by score (identity is a fine tiebreak but score
        # accounts for length — a 100% id on 200bp isn't a better hit than
        # 98% on 5kb).
        if results:
            best_idx = max(range(len(results)), key=lambda i: results[i]["score"])
            results[best_idx]["is_best"] = True
        file_rows.append({
            "file": file.filename,
            "query_length": len(query_seq),
            "trim_start": trim_start,
            "trim_end": trim_end,
            "results": results,
        })

    return {"files": file_rows, "refs": [
        {"source": r["source"], "id": r["id"], "name": r["name"], "length": r["length"]}
        for r in resolved_refs
    ]}


# ── Compare two sequences (both stored or pasted), no chromatogram ─────────
class CompareRequest(BaseModel):
    query_source: str
    query_id: Optional[str] = None
    query_text: Optional[str] = None
    ref_source: str
    ref_id: Optional[str] = None
    ref_text: Optional[str] = None


@router.post("/sanger/compare")
def compare_sequences(body: CompareRequest):
    """Align two sequences and return the result. Both sides come from
    inventory (source=plasmids|gblocks|primers|kit_parts|parts + id) or
    from pasted text (source=genbank|fasta|raw + text). Ephemeral —
    nothing is stored. No trace, no batch record."""
    try:
        q_seq, q_name, _q_annos, q_circ = get_reference_sequence(
            body.query_source, body.query_id, body.query_text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Query failed to parse: {e}")
    try:
        r_seq, r_name, _r_annos, r_circ = get_reference_sequence(
            body.ref_source, body.ref_id, body.ref_text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Reference failed to parse: {e}")

    if not q_seq or not r_seq:
        raise HTTPException(400, "Both query and reference must have sequence")

    # If either side is circular, treat the alignment as circular so a query
    # spanning the ref's origin doesn't fragment. Query circularity doesn't
    # affect the aligner (we align query bytes as a linear string) — only
    # ref circularity matters for wrap handling.
    pieces = do_alignment(q_seq, r_seq, is_circular=r_circ)
    if not pieces:
        raise HTTPException(400, "No alignment could be found")

    is_rev = bool(pieces[0].get("is_reverse"))
    total_cov = sum(int(p["ref_end"]) - int(p["ref_start"]) for p in pieces)
    return {
        "query_name": q_name,
        "query_length": len(q_seq),
        "ref_name": r_name,
        "ref_length": len(r_seq),
        "ref_is_circular": r_circ,
        "is_reverse": is_rev,
        "num_pieces": len(pieces),
        "coverage_bp": total_cov,
        "pieces": [
            {
                "aligned_ref": p["aligned_ref"],
                "aligned_query": p["aligned_query"],
                "identity_pct": p["identity_pct"],
                "score": p["score"],
                "num_mismatches": p["num_mismatches"],
                "num_gaps": p["num_gaps"],
                "ref_start": int(p["ref_start"]),
                "ref_end": int(p["ref_end"]),
                "query_start": int(p["query_start"]),
                "query_end": int(p["query_end"]),
            }
            for p in pieces
        ],
    }


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
