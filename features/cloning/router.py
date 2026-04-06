"""Cloning feature — sequence viewer + OpenCloning bridge + primer design suite."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os, json, math

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
class KLDRequest(BaseModel):
    template_seq: str
    insert_seq: str
    # Keep insertion_pos for safety, but add the new ones
    insertion_pos: Optional[int] = 0 
    start_pos: Optional[int] = None
    end_pos: Optional[int] = None
    optimize: Optional[bool] = False
    annealing_tm_target: Optional[float] = 62.0
    max_primer_length: Optional[int] = 60

class CustomPrimerRequest(BaseModel):
    template_seq: str
    start: int
    end: int
    direction: str  # "forward" or "reverse"

class PCRPrimerRequest(BaseModel):
    template_seq: str
    target_start: int
    target_end: int
    tm_target: Optional[float] = 62.0

class SeqPrimerRequest(BaseModel):
    template_seq: str
    region_start: int
    region_end: int
    read_length: Optional[int] = 900
    tm_target: Optional[float] = 62.0

class SavePrimersRequest(BaseModel):
    primers: List[dict]  # [{seq, use_desc}, ...]
    plasmid_name: str

class ProductPreviewRequest(BaseModel):
    mode: str  # "kld" or "pcr"
    template_seq: str
    annotations: Optional[List[dict]] = []
    template_name: Optional[str] = "template"
    template_topology: Optional[str] = "circular"
    # KLD fields
    insertion_pos: Optional[int] = None
    insert_seq: Optional[str] = None
    insert_label: Optional[str] = "insert"
    # PCR fields
    target_start: Optional[int] = None
    target_end: Optional[int] = None

class SaveProductRequest(BaseModel):
    mode: str
    template_seq: str
    annotations: Optional[List[dict]] = []
    template_name: Optional[str] = "template"
    template_topology: Optional[str] = "circular"
    product_name: str
    insertion_pos: Optional[int] = None
    insert_seq: Optional[str] = None
    insert_label: Optional[str] = "insert"
    target_start: Optional[int] = None
    target_end: Optional[int] = None

class FindOrfsRequest(BaseModel):
    seq: str
    min_length: Optional[int] = 100  # minimum ORF length in bp
    circular: Optional[bool] = True

class TranslateRequest(BaseModel):
    seq: str
    frame: Optional[int] = 1  # 1,2,3 fwd; -1,-2,-3 rev

class RestrictionRequest(BaseModel):
    seq: str
    enzymes: Optional[List[str]] = None  # None = common commercial set
    circular: Optional[bool] = True

class TmCalcRequest(BaseModel):
    seq: str

class SeqToolRequest(BaseModel):
    seq: str
    operation: str  # 'rc' | 'complement' | 'reverse' | 'translate'

class DigestRequest(BaseModel):
    seq: str
    enzymes: List[str]  # 1-3 enzyme names
    circular: Optional[bool] = True

class BlastRequest(BaseModel):
    seq: str
    program: Optional[str] = "blastn"  # blastn, blastp, blastx, tblastn, tblastx
    database: Optional[str] = "nt"     # nt, nr, swissprot, etc.
    max_hits: Optional[int] = 10

class ScanFeaturesRequest(BaseModel):
    seq: str
    circular: Optional[bool] = True


# Assembly designer models
class FragmentInput(BaseModel):
    name: str = "fragment"
    seq: str
    start: Optional[int] = None
    end: Optional[int] = None

class GibsonRequest(BaseModel):
    fragments: List[FragmentInput]
    circular: Optional[bool] = True
    overlap_length: Optional[int] = 25
    tm_target: Optional[float] = 62.0

class BinInput(BaseModel):
    name: str = "Bin"
    fragments: List[FragmentInput]

class GoldenGateRequest(BaseModel):
    bins: Optional[List[BinInput]] = None          # new: positional bins with multiple fragments each
    fragments: Optional[List[FragmentInput]] = None # legacy: flat fragment list (converted to 1-per-bin)
    vector: Optional[FragmentInput] = None          # optional backbone vector
    enzyme: Optional[str] = "BsaI"
    circular: Optional[bool] = True
    tm_target: Optional[float] = 62.0

class DigestLigateRequest(BaseModel):
    vector: FragmentInput
    insert: FragmentInput
    enzyme1: str
    enzyme2: Optional[str] = None
    vector_cut1_pos: Optional[int] = None
    vector_cut2_pos: Optional[int] = None
    design_primers: Optional[bool] = True
    tm_target: Optional[float] = 62.0


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
# Shared primer utilities
# ---------------------------------------------------------------------------
def _reverse_complement(seq: str) -> str:
    comp = {"A": "T", "T": "A", "G": "C", "C": "G",
            "a": "t", "t": "a", "g": "c", "c": "g",
            "N": "N", "n": "n"}
    return "".join(comp.get(b, "N") for b in reversed(seq))


def _gc_content(seq: str) -> float:
    if not seq:
        return 0.0
    s = seq.upper()
    gc = sum(1 for b in s if b in "GC")
    return gc / len(s)


def _calc_tm(seq: str) -> float:
    """Nearest-neighbour Tm via BioPython, with simple fallback."""
    seq_upper = seq.upper()
    try:
        from Bio.SeqUtils.MeltingTemp import Tm_NN, DNA_NN4
        from Bio.Seq import Seq
        tm = Tm_NN(Seq(seq_upper), nn_table=DNA_NN4)
        return round(tm, 1)
    except Exception:
        pass
    a = seq_upper.count("A")
    t = seq_upper.count("T")
    g = seq_upper.count("G")
    c = seq_upper.count("C")
    length = a + t + g + c
    if length == 0:
        return 0.0
    if length <= 13:
        return float((a + t) * 2 + (g + c) * 4)
    return round(64.9 + 41 * (g + c - 16.4) / length, 1)

# Nearest-Neighbor thermodynamics for DNA/DNA (SantaLucia 1998)
# Values are (Delta H in kcal/mol, Delta S in cal/K/mol)
NN_THERMO = {
    "AA": (-7.9, -22.2), "TT": (-7.9, -22.2),
    "AT": (-7.2, -20.4), "TA": (-7.2, -21.3),
    "CA": (-8.5, -22.7), "TG": (-8.5, -22.7),
    "GT": (-8.4, -22.4), "AC": (-8.4, -22.4),
    "CT": (-7.8, -21.0), "AG": (-7.8, -21.0),
    "GA": (-8.2, -22.2), "TC": (-8.2, -22.2),
    "CG": (-10.6, -27.2), "GC": (-9.8, -24.4),
    "GG": (-8.0, -19.9), "CC": (-8.0, -19.9),
}

def _calc_delta_g(seq: str, temp_c: float = 60.0) -> float:
    """Calculate the Gibbs Free Energy (ΔG) in kcal/mol for a given sequence."""
    seq = seq.upper()
    if len(seq) < 2:
        return 0.0

    dH, dS = 0.0, 0.0
    for i in range(len(seq) - 1):
        pair = seq[i:i+2]
        if pair in NN_THERMO:
            h, s = NN_THERMO[pair]
            dH += h
            dS += s

    # Basic initiation parameters
    if seq[0] in "GC":
        dH += 0.1; dS -= 2.8
    else:
        dH += 2.3; dS += 4.1

    if seq[-1] in "GC":
        dH += 0.1; dS -= 2.8
    else:
        dH += 2.3; dS += 4.1

    # ΔG = ΔH - TΔS (convert temperature to Kelvin and dS to kcal)
    temp_k = temp_c + 273.15
    dG = dH - (temp_k * dS / 1000.0)
    return round(dG, 2)
def _get_seq_region(template: str, start: int, length: int) -> str:
    """Get a region from template, wrapping around for circular sequences."""
    tpl_len = len(template)
    out = []
    for i in range(length):
        out.append(template[(start + i) % tpl_len])
    return "".join(out)


def _check_primer_quality(seq: str, tm: float) -> list:
    """Evaluate a primer against standard design rules. Returns list of
    {level: 'pass'|'warn'|'error', rule: str, detail: str}."""
    checks = []
    s = seq.upper()
    length = len(s)

    # Length
    if length < 18:
        checks.append({"level": "error", "rule": "Length", "detail": f"{length}bp — minimum 18bp recommended"})
    elif length > 30:
        checks.append({"level": "warn", "rule": "Length", "detail": f"{length}bp — 18-25bp is typical"})
    else:
        checks.append({"level": "pass", "rule": "Length", "detail": f"{length}bp"})

    # GC content
    gc = _gc_content(s) * 100
    if gc < 40 or gc > 60:
        checks.append({"level": "warn", "rule": "GC Content", "detail": f"{gc:.0f}% — 40-60% recommended"})
    else:
        checks.append({"level": "pass", "rule": "GC Content", "detail": f"{gc:.0f}%"})

    # GC clamp — last 2 bases at 3' end
    if length >= 2:
        last2 = s[-2:]
        gc_clamp = sum(1 for b in last2 if b in "GC")
        if gc_clamp == 0:
            checks.append({"level": "warn", "rule": "GC Clamp", "detail": f"3' end is {last2} — no G/C in last 2 bases"})
        elif gc_clamp == 2 and length >= 5 and sum(1 for b in s[-5:] if b in "GC") >= 4:
            checks.append({"level": "warn", "rule": "GC Clamp", "detail": "Strong 3' GC run — may cause mispriming"})
        else:
            checks.append({"level": "pass", "rule": "GC Clamp", "detail": f"3' end: ...{last2}"})

    # Homopolymer runs (4+ of same base)
    max_run_base = ""
    max_run_len = 0
    for base in "ATGC":
        run = 4
        while base * run in s:
            run += 1
        run -= 1
        if run >= 4 and run > max_run_len:
            max_run_len = run
            max_run_base = base
    if max_run_len >= 4:
        checks.append({"level": "warn", "rule": "Homopolymer", "detail": f"{max_run_len}× {max_run_base} run detected"})
    else:
        checks.append({"level": "pass", "rule": "Homopolymer", "detail": "No runs ≥4"})

    # Tm
    if tm < 55:
        checks.append({"level": "error", "rule": "Tm", "detail": f"{tm}°C — below 55°C, too low"})
    elif tm < 58 or tm > 68:
        checks.append({"level": "warn", "rule": "Tm", "detail": f"{tm}°C — 58-65°C ideal"})
    else:
        checks.append({"level": "pass", "rule": "Tm", "detail": f"{tm}°C"})

    # Self-complementarity
    if length >= 6:
        tail = s[-6:]
        rc_tail = _reverse_complement(tail)
        if rc_tail in s:
            checks.append({"level": "warn", "rule": "Self-dimer", "detail": "3' end complement found within primer"})
        else:
            checks.append({"level": "pass", "rule": "Self-dimer", "detail": "No obvious 3' self-dimer"})

    # NEW: 3' End Thermodynamic Stability (Energy Density)
    if length >= 5:
        last5 = s[-5:]
        # Calculate ΔG at 37°C which is the standard baseline for 3' end stability analysis
        last5_dg = _calc_delta_g(last5, temp_c=37.0)
        if last5_dg > -4.0:
            checks.append({"level": "warn", "rule": "3' Stability (ΔG)", "detail": f"Weak 3' end ({last5_dg} kcal/mol) — may reduce priming efficiency"})
        elif last5_dg < -10.0:
            checks.append({"level": "warn", "rule": "3' Stability (ΔG)", "detail": f"Over-stable 3' end ({last5_dg} kcal/mol) — may cause mispriming"})
        else:
            checks.append({"level": "pass", "rule": "3' Stability (ΔG)", "detail": f"{last5_dg} kcal/mol"})

    return checks


def _design_annealing_region(template: str, pos: int, direction: str, tm_target: float,
                              min_len: int = 18, max_len: int = 40, hard_max_len: int = None) -> dict:
    """Design an annealing region starting from pos in given direction, targeting tm_target.
    direction: 'forward' (5'->3' on top strand) or 'reverse' (5'->3' on bottom strand, upstream)."""
    if hard_max_len is not None:
        max_len = hard_max_len
    tpl_len = len(template)
    best_seq = ""
    best_tm = 0.0

    for anneal_len in range(min_len, max_len + 1):
        if direction == "forward":
            candidate = _get_seq_region(template, pos, anneal_len)
        else:
            # Reverse: go upstream from pos, then RC
            bases = []
            for i in range(anneal_len):
                bases.append(template[(pos - 1 - i) % tpl_len])
            candidate = _reverse_complement("".join(bases))

        tm = _calc_tm(candidate)
        if tm > best_tm:
            best_seq = candidate
            best_tm = tm
        if tm >= tm_target:
            break

    quality = _check_primer_quality(best_seq, best_tm)
    return {
        "seq": best_seq,
        "tm": best_tm,
        "delta_g": _calc_delta_g(best_seq, best_tm), # NEW
        "length": len(best_seq),
        "gc_percent": round(_gc_content(best_seq) * 100, 1),
        "quality": quality,
    }


# ---------------------------------------------------------------------------
# KLD Primer Design
# ---------------------------------------------------------------------------
def _score_split(insert_seq: str, pos: int) -> float:
    if pos <= 0 or pos >= len(insert_seq):
        return 0.0
    left_start = max(0, pos - 2)
    right_end = min(len(insert_seq), pos + 2)
    window = insert_seq[left_start:right_end].upper()
    if not window:
        return 0.0
    return sum(1 for b in window if b in "GC") / len(window)

def design_kld_primers(body: dict):
    # Expecting: template, insert, start_pos, end_pos, optimize, tm_target
    template_seq = body.get("template", "").upper().replace(" ", "")
    insert_seq = body.get("insert", "").upper().replace(" ", "")
    start_pos = int(body.get("start_pos", 0))
    end_pos = int(body.get("end_pos", start_pos)) # Default to same as start (insertion)
    tm_target = float(body.get("tm_target", 62.0))
    optimize = body.get("optimize", False)
    max_len = 60

    if not template_seq:
        raise HTTPException(400, "Template sequence is empty")

    best_overall_score = -float('inf')
    best_result = None

    # Determine the range of template junctions to test
    # If not optimizing, we only check the specific start/end provided
    search_range = range(start_pos, end_pos + 1) if optimize else [start_pos]

    for t_junction in search_range:
        # actual_start is where the REVERSE primer anneals (facing left)
        # actual_end is where the FORWARD primer anneals (facing right)
        # The sequence between them is what gets DELETED.
        actual_start = t_junction
        actual_end = t_junction if optimize else end_pos

        ins_len = len(insert_seq)
        split_points = range(ins_len + 1) if ins_len > 0 else [0]

        for sp in split_points:
            # The Forward primer gets the END of the insert
            fwd_tail = insert_seq[sp:]
            # The Reverse primer gets the START of the insert (RC'd)
            rev_tail = _reverse_complement(insert_seq[:sp])
            
            f_max_ann = max_len - len(fwd_tail)
            r_max_ann = max_len - len(rev_tail)
            
            if f_max_ann < 12 or r_max_ann < 12: continue
            
            # Fwd anneals to the template AFTER the deleted region
            f_cands = _generate_primer_candidates(
                template_seq, actual_end, "forward", fwd_tail, tm_target,
                min_len=12, max_len=f_max_ann, max_total=max_len
            )
            # Rev anneals to the template BEFORE the deleted region
            r_cands = _generate_primer_candidates(
                template_seq, actual_start, "reverse", rev_tail, tm_target,
                min_len=12, max_len=r_max_ann, max_total=max_len
            )
            
            if not f_cands or not r_cands: continue
            
            f, r = f_cands[0], r_cands[0]
            
            # Scoring
            tm_err = abs(f['tm'] - tm_target) + abs(r['tm'] - tm_target)
            tm_delta = abs(f['tm'] - r['tm'])
            ss_penalty = 0
            if f.get('hairpin') or r.get('hairpin'): ss_penalty += 25
            if f.get('homodimer_dg', 0) < -8.0: ss_penalty += 15
            
            score = -(tm_err * 2) - (tm_delta * 4) - ss_penalty
            
            if score > best_overall_score:
                best_overall_score = score
                best_result = {
                    "fwd_all": f_cands, "rev_all": r_cands,
                    "actual_start": actual_start, "actual_end": actual_end,
                    "split": sp
                }

    if not best_result:
        raise HTTPException(400, "No viable primers found in this range.")

    fwd_primer = _pick_best_with_alternatives(best_result["fwd_all"], "Forward", max_alternatives=None)
    rev_primer = _pick_best_with_alternatives(best_result["rev_all"], "Reverse", max_alternatives=None)

    # Construct result product
    product = template_seq[:best_result["actual_start"]] + insert_seq + template_seq[best_result["actual_end"]:]

    return {
        "forward": fwd_primer,
        "reverse": rev_primer,
        "start_used": best_result["actual_start"],
        "end_used": best_result["actual_end"],
        "insert_split": best_result["split"],
        "product_length": len(product),
        "warnings": ["Tm mismatch > 3C"] if abs(fwd_primer['tm'] - rev_primer['tm']) > 3 else []
    }


# ---------------------------------------------------------------------------
# Custom Primer Evaluation
# ---------------------------------------------------------------------------
def evaluate_custom_primer(template_seq, start, end, direction):
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template_seq)

    if start < 0 or end < 0 or start >= tpl_len or end > tpl_len:
        raise HTTPException(400, f"Positions out of range (0-{tpl_len})")
    if start >= end:
        raise HTTPException(400, "Start must be less than end")
    if direction not in ("forward", "reverse"):
        raise HTTPException(400, "Direction must be 'forward' or 'reverse'")

    region = template_seq[start:end]

    if direction == "reverse":
        primer_seq = _reverse_complement(region)
    else:
        primer_seq = region

    tm = _calc_tm(primer_seq)
    quality = _check_primer_quality(primer_seq, tm)

    return {
        "primer_seq": primer_seq,
        "template_region": region,
        "start": start,
        "end": end,
        "direction": direction,
        "tm": tm,
        "length": len(primer_seq),
        "gc_percent": round(_gc_content(primer_seq) * 100, 1),
        "delta_g": _calc_delta_g(primer_seq, temp_c=tm if tm > 0 else 60.0),
        "homodimer_dg": _calc_homodimer_dg(primer_seq, temp_c=60.0),
        "hairpin": _has_hairpin(primer_seq),
        "self_dimer": _has_self_dimer(primer_seq),
        "quality": quality,
    }


# ---------------------------------------------------------------------------
# PCR Primer Design
# ---------------------------------------------------------------------------
def design_pcr_primers(template_seq, target_start, target_end, tm_target=62.0):
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template_seq)

    if target_start < 0 or target_end > tpl_len or target_start >= target_end:
        raise HTTPException(400, f"Invalid target region ({target_start}-{target_end}), template is {tpl_len}bp")

    # Design forward primer candidates at target_start (no tail for PCR)
    fwd_candidates = _generate_primer_candidates(template_seq, target_start, "forward", "", tm_target)
    fwd = _pick_best_with_alternatives(fwd_candidates, "Forward")

    # Design reverse primer candidates at target_end
    rev_candidates = _generate_primer_candidates(template_seq, target_end, "reverse", "", tm_target)
    rev = _pick_best_with_alternatives(rev_candidates, "Reverse")

    total_amplicon = target_end - target_start

    # Tm difference between primers
    tm_diff = abs(fwd["tm"] - rev["tm"])
    warnings = []
    if tm_diff > 5:
        warnings.append(f"Tm difference between primers is {tm_diff:.1f}°C — ideally <5°C")
    if fwd.get("hairpin"):
        warnings.append("Forward primer may form hairpin")
    if fwd.get("homodimer_dg", 0) < -7.0:
        warnings.append(f"Forward primer has strong self-dimer (ΔG = {fwd['homodimer_dg']} kcal/mol)")
    if rev.get("hairpin"):
        warnings.append("Reverse primer may form hairpin")
    if rev.get("homodimer_dg", 0) < -7.0:
        warnings.append(f"Reverse primer has strong self-dimer (ΔG = {rev['homodimer_dg']} kcal/mol)")

    # Add seq alias and position for frontend compatibility
    fwd["seq"] = fwd["full_seq"]
    fwd["position"] = target_start
    rev["seq"] = rev["full_seq"]
    rev["position"] = target_end

    return {
        "forward": fwd,
        "reverse": rev,
        "amplicon_length": total_amplicon,
        "target_length": target_end - target_start,
        "tm_diff": round(tm_diff, 1),
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Sequencing Primer Design
# ---------------------------------------------------------------------------
def design_seq_primers(template_seq, region_start, region_end, read_length=900, tm_target=62.0):
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template_seq)

    if region_start < 0 or region_end > tpl_len or region_start >= region_end:
        raise HTTPException(400, f"Invalid region ({region_start}-{region_end}), template is {tpl_len}bp")

    region_length = region_end - region_start

    # Usable read: first ~50bp often low quality, so effective read = read_length - 50
    effective_read = read_length - 50
    # Overlap between reads for confidence: ~100bp
    step = effective_read - 100  # ~750bp between primer starts

    if step < 200:
        step = 200

    primers = []
    pos = region_start

    # First primer placed ~50bp upstream of region start to cover the start
    first_pos = max(0, region_start - 50)
    pos = first_pos

    idx = 0
    while pos < region_end:
        # Design primer candidates at this position (no tail for sequencing primers)
        candidates = _generate_primer_candidates(template_seq, pos, "forward", "", tm_target)
        best = _pick_best_with_alternatives(candidates, f"Seq_{idx + 1}")
        read_start = pos
        read_end = min(pos + read_length, tpl_len)

        if best:
            # Add seq alias and sequencing-specific fields for frontend compatibility
            best["seq"] = best["full_seq"]
            best["index"] = idx + 1
            best["position"] = pos
            best["direction"] = "forward"
            best["read_covers"] = f"{read_start}-{read_end}"
            best["effective_start"] = pos + 50
            best["effective_end"] = min(pos + read_length, tpl_len)
            primers.append(best)

        pos += step
        idx += 1

        # Safety: don't design more than 20 primers
        if idx >= 20:
            break

    # Check coverage
    total_coverage = region_length
    if len(primers) > 0:
        last = primers[-1]
        covered_end = last["effective_end"]
        if covered_end < region_end:
            gap = region_end - covered_end
            # Note about incomplete coverage
            pass

    return {
        "primers": primers,
        "num_primers": len(primers),
        "region_length": region_length,
        "read_length": read_length,
        "step_size": step,
    }


# ---------------------------------------------------------------------------
# Product Generation (KLD / PCR)
# ---------------------------------------------------------------------------
def _build_product(mode, template_seq, annotations, template_name="template",
                   template_topology="circular",
                   insertion_pos=None, insert_seq=None, insert_label="insert",
                   target_start=None, target_end=None):
    """Build a product sequence with remapped annotations.
    Returns SeqViz-compatible dict with name, seq, annotations, length, topology."""
    template_seq = template_seq.upper()
    anns = annotations or []

    if mode == "kld":
        if insertion_pos is None or insert_seq is None:
            raise HTTPException(400, "KLD mode requires insertion_pos and insert_seq")
        insert_seq = insert_seq.upper().replace(" ", "").replace("\n", "")
        ins_len = len(insert_seq)
        product_seq = template_seq[:insertion_pos] + insert_seq + template_seq[insertion_pos:]
        product_name = f"{template_name}_KLD_{insert_label}"
        topology = template_topology  # stays circular

        # Remap annotations
        new_anns = []
        for a in anns:
            s, e = a.get("start", 0), a.get("end", 0)
            if e <= insertion_pos:
                # Entirely before insertion — unchanged
                new_anns.append(dict(a))
            elif s >= insertion_pos:
                # Entirely after insertion — shift by insert length
                na = dict(a)
                na["start"] = s + ins_len
                na["end"] = e + ins_len
                new_anns.append(na)
            else:
                # Spans insertion point — split or extend
                # Keep the original but mark as disrupted
                na = dict(a)
                na["end"] = e + ins_len
                na["name"] = a.get("name", "?") + " (disrupted)"
                na["color"] = "#e74c3c"
                new_anns.append(na)

        # Add insert as a feature
        new_anns.append({
            "name": insert_label or "insert",
            "start": insertion_pos,
            "end": insertion_pos + ins_len,
            "direction": 1,
            "color": "#27ae60",
            "type": "misc_feature",
        })

    elif mode == "pcr":
        if target_start is None or target_end is None:
            raise HTTPException(400, "PCR mode requires target_start and target_end")
        product_seq = template_seq[target_start:target_end]
        product_name = f"{template_name}_PCR_{target_start}-{target_end}"
        topology = "linear"  # PCR products are linear

        # Remap annotations — keep only those within amplicon
        new_anns = []
        for a in anns:
            s, e = a.get("start", 0), a.get("end", 0)
            if s >= target_start and e <= target_end:
                # Fully inside amplicon — shift
                na = dict(a)
                na["start"] = s - target_start
                na["end"] = e - target_start
                new_anns.append(na)
            elif s < target_end and e > target_start:
                # Partially overlapping — trim to amplicon bounds
                na = dict(a)
                na["start"] = max(0, s - target_start)
                na["end"] = min(len(product_seq), e - target_start)
                if na["end"] > na["start"]:
                    na["name"] = a.get("name", "?") + " (trimmed)"
                    new_anns.append(na)
    else:
        raise HTTPException(400, f"Unknown mode: {mode}")

    return {
        "name": product_name,
        "description": f"Expected product from {mode.upper()} on {template_name}",
        "seq": product_seq,
        "annotations": new_anns,
        "length": len(product_seq),
        "topology": topology,
    }


def _write_genbank(product_data: dict) -> str:
    """Write a product dict to GenBank-format string using BioPython."""
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from io import StringIO

    record = SeqRecord(
        Seq(product_data["seq"]),
        id=product_data["name"][:16],  # GenBank ID max 16 chars
        name=product_data["name"][:16],
        description=product_data.get("description", ""),
    )
    record.annotations["molecule_type"] = "DNA"
    record.annotations["topology"] = product_data.get("topology", "linear")

    for a in product_data.get("annotations", []):
        strand = 1 if a.get("direction", 1) == 1 else -1
        feat = SeqFeature(
            FeatureLocation(a["start"], a["end"], strand=strand),
            type=a.get("type", "misc_feature"),
            qualifiers={
                "label": [a.get("name", "feature")],
                "ApEinfo_fwdcolor": [a.get("color", "#95A5A6")],
            },
        )
        record.features.append(feat)

    output = StringIO()
    from Bio import SeqIO as _SeqIO
    _SeqIO.write(record, output, "genbank")
    return output.getvalue()


# ---------------------------------------------------------------------------
# ORF Finder
# ---------------------------------------------------------------------------
CODON_TABLE = {
    'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L', 'CTT': 'L', 'CTC': 'L',
    'CTA': 'L', 'CTG': 'L', 'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M',
    'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V', 'TCT': 'S', 'TCC': 'S',
    'TCA': 'S', 'TCG': 'S', 'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
    'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T', 'GCT': 'A', 'GCC': 'A',
    'GCA': 'A', 'GCG': 'A', 'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*',
    'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q', 'AAT': 'N', 'AAC': 'N',
    'AAA': 'K', 'AAG': 'K', 'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
    'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W', 'CGT': 'R', 'CGC': 'R',
    'CGA': 'R', 'CGG': 'R', 'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
    'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G',
}
STOP_CODONS = {'TAA', 'TAG', 'TGA'}


def _translate_seq(seq: str) -> str:
    """Translate a DNA sequence to protein (standard code)."""
    seq = seq.upper()
    protein = []
    for i in range(0, len(seq) - 2, 3):
        codon = seq[i:i + 3]
        aa = CODON_TABLE.get(codon, 'X')
        protein.append(aa)
    return "".join(protein)


def find_orfs(seq: str, min_length: int = 100, circular: bool = True) -> list:
    """Find all ORFs (ATG to stop) in all 6 frames."""
    seq = seq.upper()
    slen = len(seq)
    # For circular sequences, search with wrap-around
    search_seq = seq + seq if circular else seq
    search_len = len(search_seq)

    orfs = []
    # Forward frames 1,2,3
    for frame_offset in range(3):
        i = frame_offset
        in_orf = False
        orf_start = 0
        while i + 2 < search_len:
            codon = search_seq[i:i + 3]
            if not in_orf:
                if codon == 'ATG':
                    in_orf = True
                    orf_start = i
            else:
                if codon in STOP_CODONS:
                    orf_end = i + 3
                    orf_len = orf_end - orf_start
                    if orf_len >= min_length:
                        # Normalise positions for circular
                        real_start = orf_start % slen
                        real_end = orf_end % slen if orf_end <= slen else orf_end % slen
                        orf_seq = search_seq[orf_start:orf_end]
                        protein = _translate_seq(orf_seq)
                        orfs.append({
                            "frame": frame_offset + 1,
                            "direction": 1,
                            "start": real_start,
                            "end": real_end if real_end > 0 else slen,
                            "length_bp": orf_len,
                            "length_aa": len(protein) - 1,  # minus stop
                            "protein": protein.rstrip('*'),
                        })
                    in_orf = False
                    # Don't skip, next ATG might start right after
            i += 3
            # For circular, stop searching once we've gone past one full length
            if circular and orf_start >= slen:
                break
            if circular and i >= slen * 2:
                break

    # Reverse complement frames
    rc_seq = _reverse_complement(seq)
    search_rc = rc_seq + rc_seq if circular else rc_seq
    search_rc_len = len(search_rc)

    for frame_offset in range(3):
        i = frame_offset
        in_orf = False
        orf_start = 0
        while i + 2 < search_rc_len:
            codon = search_rc[i:i + 3]
            if not in_orf:
                if codon == 'ATG':
                    in_orf = True
                    orf_start = i
            else:
                if codon in STOP_CODONS:
                    orf_end = i + 3
                    orf_len = orf_end - orf_start
                    if orf_len >= min_length:
                        # Map back to top strand coordinates
                        rc_start = orf_start % slen
                        rc_end = orf_end % slen if orf_end <= slen else orf_end % slen
                        # On top strand: start = slen - rc_end, end = slen - rc_start
                        top_start = (slen - (orf_end % slen)) % slen
                        top_end = (slen - (orf_start % slen)) % slen
                        if top_end == 0:
                            top_end = slen
                        orf_seq = search_rc[orf_start:orf_end]
                        protein = _translate_seq(orf_seq)
                        orfs.append({
                            "frame": -(frame_offset + 1),
                            "direction": -1,
                            "start": top_start,
                            "end": top_end,
                            "length_bp": orf_len,
                            "length_aa": len(protein) - 1,
                            "protein": protein.rstrip('*'),
                        })
                    in_orf = False
            i += 3
            if circular and orf_start >= slen:
                break
            if circular and i >= slen * 2:
                break

    # Sort by length descending
    orfs.sort(key=lambda o: o["length_bp"], reverse=True)
    # Deduplicate (circular can produce duplicates)
    seen = set()
    unique = []
    for o in orfs:
        key = (o["start"], o["end"], o["direction"])
        if key not in seen:
            seen.add(key)
            unique.append(o)
    return unique


# ---------------------------------------------------------------------------
# Restriction Enzyme Analysis
# ---------------------------------------------------------------------------
# Common commercial enzymes for quick analysis
COMMON_ENZYMES = [
    "EcoRI", "BamHI", "HindIII", "XhoI", "NdeI", "NcoI", "SalI", "XbaI",
    "PstI", "SphI", "KpnI", "SacI", "SacII", "NotI", "EcoRV", "ClaI",
    "BglII", "NheI", "MluI", "ApaI", "SpeI", "BsrGI", "AflII", "AscI",
    "FseI", "PacI", "SwaI", "PmeI", "SfiI", "SmaI", "AgeI", "BspEI",
    "MfeI", "AvrII", "BsiWI", "BlpI", "BstBI", "DraI", "StuI", "ScaI",
]


def find_restriction_sites(seq: str, enzyme_names: list = None, circular: bool = True) -> dict:
    """Find restriction enzyme cut sites using BioPython."""
    seq = seq.upper()
    try:
        from Bio.Seq import Seq
        from Bio.Restriction import RestrictionBatch, Analysis, AllEnzymes
    except ImportError:
        raise HTTPException(500, "BioPython Restriction module not available")

    if enzyme_names:
        # Filter to valid enzyme names
        batch = RestrictionBatch()
        for name in enzyme_names:
            try:
                batch.add(name)
            except (ValueError, KeyError):
                pass  # skip unknown enzymes
        if not batch:
            raise HTTPException(400, "No valid enzyme names provided")
    else:
        # Use common set
        batch = RestrictionBatch()
        for name in COMMON_ENZYMES:
            try:
                batch.add(name)
            except (ValueError, KeyError):
                pass

    bio_seq = Seq(seq)
    analysis = Analysis(batch, bio_seq, linear=not circular)
    results = analysis.full()

    enzymes = []
    for enzyme, positions in results.items():
        if positions:  # Only include enzymes that cut
            enzymes.append({
                "name": str(enzyme),
                "cut_positions": sorted(positions),
                "num_cuts": len(positions),
                "overhang": str(enzyme.ovhg) if hasattr(enzyme, 'ovhg') else "?",
                "site": str(enzyme.site) if hasattr(enzyme, 'site') else "?",
            })

    # Sort by number of cuts (single cutters first, most useful)
    enzymes.sort(key=lambda e: (e["num_cuts"], e["name"]))

    # Summary stats
    non_cutters = sum(1 for _, p in results.items() if not p)
    single_cutters = [e for e in enzymes if e["num_cuts"] == 1]

    return {
        "enzymes": enzymes,
        "total_cutters": len(enzymes),
        "non_cutters": non_cutters,
        "single_cutters": len(single_cutters),
        "seq_length": len(seq),
    }


# ---------------------------------------------------------------------------
# Digest Simulator
# ---------------------------------------------------------------------------
def simulate_digest(seq: str, enzyme_names: list, circular: bool = True) -> dict:
    """Simulate a restriction digest and return fragment sizes."""
    seq = seq.upper()
    slen = len(seq)

    try:
        from Bio.Seq import Seq
        from Bio.Restriction import RestrictionBatch, Analysis
    except ImportError:
        raise HTTPException(500, "BioPython Restriction module not available")

    if not enzyme_names or len(enzyme_names) < 1:
        raise HTTPException(400, "Provide at least one enzyme")
    if len(enzyme_names) > 3:
        raise HTTPException(400, "Maximum 3 enzymes for digest simulation")

    batch = RestrictionBatch()
    valid_enzymes = []
    for name in enzyme_names:
        try:
            batch.add(name.strip())
            valid_enzymes.append(name.strip())
        except (ValueError, KeyError):
            pass
    if not batch:
        raise HTTPException(400, "No valid enzyme names provided")

    bio_seq = Seq(seq)
    analysis = Analysis(batch, bio_seq, linear=not circular)
    results = analysis.full()

    # Collect all cut positions from all enzymes
    all_cuts = []
    enzyme_info = []
    for enzyme, positions in results.items():
        ename = str(enzyme)
        enzyme_info.append({
            "name": ename,
            "cuts": len(positions),
            "positions": sorted(positions),
            "site": str(enzyme.site) if hasattr(enzyme, 'site') else "?",
        })
        for p in positions:
            all_cuts.append({"pos": p, "enzyme": ename})

    # Sort cuts by position
    all_cuts.sort(key=lambda c: c["pos"])
    cut_positions = [c["pos"] for c in all_cuts]

    if not cut_positions:
        # No cuts — one fragment = whole sequence
        return {
            "enzymes": enzyme_info,
            "fragments": [{"size": slen, "start": 0, "end": slen}],
            "num_fragments": 1,
            "num_cuts": 0,
            "total_cuts": cut_positions,
            "circular": circular,
        }

    # Calculate fragments
    fragments = []
    if circular:
        # Circular: fragments between consecutive cuts, wrapping around
        for i in range(len(cut_positions)):
            start = cut_positions[i]
            end = cut_positions[(i + 1) % len(cut_positions)]
            if end > start:
                size = end - start
            else:
                size = (slen - start) + end  # wrap around
            fragments.append({"size": size, "start": start, "end": end})
    else:
        # Linear: fragments include ends
        # First fragment: 0 to first cut
        fragments.append({"size": cut_positions[0], "start": 0, "end": cut_positions[0]})
        # Middle fragments
        for i in range(len(cut_positions) - 1):
            size = cut_positions[i + 1] - cut_positions[i]
            fragments.append({"size": size, "start": cut_positions[i], "end": cut_positions[i + 1]})
        # Last fragment: last cut to end
        fragments.append({"size": slen - cut_positions[-1], "start": cut_positions[-1], "end": slen})

    # Remove zero-size fragments
    fragments = [f for f in fragments if f["size"] > 0]

    # Sort by size descending (for gel display)
    fragments.sort(key=lambda f: f["size"], reverse=True)

    return {
        "enzymes": enzyme_info,
        "fragments": fragments,
        "num_fragments": len(fragments),
        "num_cuts": len(cut_positions),
        "total_cuts": cut_positions,
        "circular": circular,
    }


# ---------------------------------------------------------------------------
# BLAST Search (NCBI)
# ---------------------------------------------------------------------------
def run_blast(seq: str, program: str = "blastn", database: str = "nt",
              max_hits: int = 10) -> dict:
    """Run a BLAST search against NCBI and return parsed results."""
    seq = seq.upper().replace(" ", "").replace("\n", "")
    if len(seq) < 10:
        raise HTTPException(400, "Sequence too short for BLAST (minimum 10bp)")
    if len(seq) > 10000:
        raise HTTPException(400, "Sequence too long for web BLAST (maximum 10000bp)")

    try:
        from Bio.Blast import NCBIWWW, NCBIXML
    except ImportError:
        raise HTTPException(500, "BioPython BLAST module not available")

    valid_programs = ["blastn", "blastp", "blastx", "tblastn", "tblastx"]
    if program not in valid_programs:
        raise HTTPException(400, f"Invalid program. Use: {', '.join(valid_programs)}")

    try:
        result_handle = NCBIWWW.qblast(
            program, database, seq,
            hitlist_size=max_hits,
            expect=10.0,
        )
        blast_records = NCBIXML.parse(result_handle)
        record = next(blast_records)
    except Exception as e:
        raise HTTPException(502, f"BLAST query failed: {str(e)}")

    hits = []
    for alignment in record.alignments[:max_hits]:
        for hsp in alignment.hsps[:1]:  # Top HSP per hit
            identity_pct = round(hsp.identities / hsp.align_length * 100, 1) if hsp.align_length > 0 else 0
            hits.append({
                "title": alignment.title[:200],
                "accession": alignment.accession,
                "length": alignment.length,
                "score": hsp.score,
                "bits": round(hsp.bits, 1),
                "evalue": f"{hsp.expect:.2e}",
                "identity": f"{hsp.identities}/{hsp.align_length}",
                "identity_pct": identity_pct,
                "gaps": hsp.gaps,
                "query_start": hsp.query_start,
                "query_end": hsp.query_end,
                "subject_start": hsp.sbjct_start,
                "subject_end": hsp.sbjct_end,
                "query_seq": str(hsp.query)[:500],
                "match_seq": str(hsp.match)[:500],
                "subject_seq": str(hsp.sbjct)[:500],
                "strand": "Plus/Plus" if hsp.strand == (None, None) else f"{hsp.strand[0] or 'Plus'}/{hsp.strand[1] or 'Plus'}",
            })

    return {
        "program": program,
        "database": database,
        "query_length": len(seq),
        "hits": hits,
        "num_hits": len(hits),
    }


# ---------------------------------------------------------------------------
# Known Features / Motif Scanner
# ---------------------------------------------------------------------------
KNOWN_FEATURES = [
    # Purification tags
    {"name": "6xHis tag", "seq": "CATCACCATCACCATCAC", "type": "CDS", "category": "Purification tag", "color": "#E67E22"},
    {"name": "6xHis tag (alt)", "seq": "CACCACCACCACCACCAC", "type": "CDS", "category": "Purification tag", "color": "#E67E22"},
    {"name": "8xHis tag", "seq": "CATCACCATCACCATCACCATCACCATCAC", "type": "CDS", "category": "Purification tag", "color": "#E67E22"},
    {"name": "FLAG tag", "seq": "GACTACAAGGACGATGACGATAAGTAA", "type": "CDS", "category": "Purification tag", "color": "#E74C3C"},
    {"name": "HA tag", "seq": "TACCCTTACGACGTGCCTGACTACGCC", "type": "CDS", "category": "Purification tag", "color": "#9B59B6"},
    {"name": "Myc tag", "seq": "GAACAAAAACTCATCTCAGAAGAGGATCTG", "type": "CDS", "category": "Purification tag", "color": "#3498DB"},
    {"name": "V5 tag", "seq": "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG", "type": "CDS", "category": "Purification tag", "color": "#1ABC9C"},
    {"name": "Strep-tag II", "seq": "TGGAGCCACCCGCAGTTCGAAAAG", "type": "CDS", "category": "Purification tag", "color": "#F39C12"},
    # Protease sites
    {"name": "TEV site", "seq": "GAAAACCTGTATTTTCAGGGC", "type": "CDS", "category": "Protease site", "color": "#C0392B"},
    {"name": "Thrombin site", "seq": "CTGGTTCCGCGTGGATCC", "type": "CDS", "category": "Protease site", "color": "#C0392B"},
    {"name": "Factor Xa site", "seq": "ATCGAGGGAAGA", "type": "CDS", "category": "Protease site", "color": "#C0392B"},
    {"name": "PreScission site", "seq": "CTGGAAGTTCTGTTCCAGGGGCCC", "type": "CDS", "category": "Protease site", "color": "#C0392B"},
    # Promoters
    {"name": "T7 promoter", "seq": "TAATACGACTCACTATAGGG", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "T7 promoter (consensus)", "seq": "TAATACGACTCACTATA", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "SP6 promoter", "seq": "ATTTAGGTGACACTATAG", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "T3 promoter", "seq": "AATTAACCCTCACTAAAGGG", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "lac promoter", "seq": "TTTACACTTTATGCTTCCGGCTCGTATGTTG", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "tac promoter", "seq": "TTGACAATTAATCATCGGCTCGTATAATG", "type": "promoter", "category": "Promoter", "color": "#E8A838"},
    {"name": "CMV promoter (core)", "seq": "GTTGACATTGATTATTGACTAG", "type": "promoter", "category": "Promoter", "color": "#D4AC0D"},
    # Terminators
    {"name": "T7 terminator", "seq": "GCTAGTTATTGCTCAGCGG", "type": "terminator", "category": "Terminator", "color": "#C0392B"},
    {"name": "rrnB T1 terminator", "seq": "CAAATAAAACGAAAGGCTCAGTCGAAAGAC", "type": "terminator", "category": "Terminator", "color": "#C0392B"},
    # RBS / translation signals
    {"name": "Shine-Dalgarno (E. coli)", "seq": "AAGGAG", "type": "RBS", "category": "RBS", "color": "#D4AC0D"},
    {"name": "Kozak (mammalian)", "seq": "GCCACCATGG", "type": "regulatory", "category": "RBS", "color": "#D4AC0D"},
    {"name": "Kozak (strong)", "seq": "GCCGCCACCATGG", "type": "regulatory", "category": "RBS", "color": "#D4AC0D"},
    # Operators / regulatory
    {"name": "lac operator", "seq": "AATTGTGAGCGGATAACAATT", "type": "regulatory", "category": "Regulatory", "color": "#8E44AD"},
    {"name": "tet operator", "seq": "TCCCTATCAGTGATAGAGA", "type": "regulatory", "category": "Regulatory", "color": "#8E44AD"},
    # Origins
    {"name": "pBR322 ori (partial)", "seq": "TTCTCATGTTTGACAGCTTATCATCG", "type": "rep_origin", "category": "Origin", "color": "#8E44AD"},
    {"name": "f1 ori (partial)", "seq": "ACGCGCCCTGTAGCGGCGCATTAAGCGCGG", "type": "rep_origin", "category": "Origin", "color": "#8E44AD"},
    # Resistance markers (short signature regions)
    {"name": "AmpR (bla signal)", "seq": "ATGAGTATTCAACATTTCCGTGTCGCCCTTAT", "type": "CDS", "category": "Resistance", "color": "#4682B4"},
    {"name": "KanR (aph start)", "seq": "ATGATTGAACAAGATGGATTGCACGCAGG", "type": "CDS", "category": "Resistance", "color": "#4682B4"},
    {"name": "CmR (cat start)", "seq": "ATGGAGAAAAAAATCACTGGATATACC", "type": "CDS", "category": "Resistance", "color": "#4682B4"},
    # Recombination / cloning
    {"name": "loxP", "seq": "ATAACTTCGTATAGCATACATTATACGAAGTTAT", "type": "misc_feature", "category": "Recombination", "color": "#1ABC9C"},
    {"name": "FRT", "seq": "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC", "type": "misc_feature", "category": "Recombination", "color": "#1ABC9C"},
    {"name": "attB1", "seq": "ACAAGTTTGTACAAAAAAGCAGGCT", "type": "misc_feature", "category": "Recombination", "color": "#1ABC9C"},
    {"name": "attB2", "seq": "ACCACTTTGTACAAGAAAGCTGGGT", "type": "misc_feature", "category": "Recombination", "color": "#1ABC9C"},
]


def scan_known_features(seq: str, circular: bool = True) -> list:
    """Scan sequence for known molecular biology features on both strands."""
    seq = seq.upper()
    slen = len(seq)
    search_seq = seq + seq[:50] if circular else seq  # small wrap for circular
    rc_search = _reverse_complement(search_seq)

    found = []
    for feat in KNOWN_FEATURES:
        motif = feat["seq"].upper()
        mlen = len(motif)

        # Forward strand
        pos = 0
        while True:
            idx = search_seq.find(motif, pos)
            if idx == -1 or idx >= slen:
                break
            found.append({
                "name": feat["name"],
                "start": idx,
                "end": idx + mlen,
                "direction": 1,
                "strand": "fwd",
                "type": feat["type"],
                "category": feat["category"],
                "color": feat["color"],
                "motif_seq": motif,
            })
            pos = idx + 1

        # Reverse complement strand
        pos = 0
        while True:
            idx = rc_search.find(motif, pos)
            if idx == -1 or idx >= slen:
                break
            # Map back to top strand coordinates
            top_start = slen - (idx + mlen)
            top_end = slen - idx
            if top_start < 0:
                top_start += slen
            found.append({
                "name": feat["name"],
                "start": top_start,
                "end": top_end,
                "direction": -1,
                "strand": "rc",
                "type": feat["type"],
                "category": feat["category"],
                "color": feat["color"],
                "motif_seq": motif,
            })
            pos = idx + 1

    # Sort by position
    found.sort(key=lambda f: f["start"])

    # Group by category for summary
    categories = {}
    for f in found:
        cat = f["category"]
        if cat not in categories:
            categories[cat] = 0
        categories[cat] += 1

    return {"features": found, "count": len(found), "categories": categories}


# ---------------------------------------------------------------------------
# Assembly Designer — Gibson, Golden Gate, Digest-Ligate
# ---------------------------------------------------------------------------

# Type IIS enzyme definitions for Golden Gate
TYPE_IIS_ENZYMES = {
    "BsaI":  {"site": "GGTCTC", "cut_offset": 7, "overhang_len": 4, "rc_site": "GAGACC"},
    "BbsI":  {"site": "GAAGAC", "cut_offset": 8, "overhang_len": 4, "rc_site": "GTCTTC"},
    "BpiI":  {"site": "GAAGAC", "cut_offset": 8, "overhang_len": 4, "rc_site": "GTCTTC"},
    "SapI":  {"site": "GCTCTTC", "cut_offset": 8, "overhang_len": 3, "rc_site": "GAAGAGC"},
    "BsmBI": {"site": "CGTCTC", "cut_offset": 7, "overhang_len": 4, "rc_site": "GAGACG"},
}

# Validated high-fidelity overhang sets (NEB)
GOLDEN_OVERHANGS = ["AATG", "AGGT", "GCTT", "TACA", "TTCG", "CAGT", "GATC", "ACGA", "TGAC", "CTGA"]


def _check_internal_sites(seq: str, site: str, rc_site: str) -> list:
    """Check for internal enzyme recognition sites in a fragment."""
    seq_upper = seq.upper()
    positions = []
    for pattern in [site, rc_site]:
        pos = 0
        while True:
            idx = seq_upper.find(pattern, pos)
            if idx == -1:
                break
            positions.append(idx)
            pos = idx + 1
    return positions


def design_gibson(fragments: list, circular: bool = True, overlap_length: int = 25,
                  tm_target: float = 62.0) -> dict:
    """Design a Gibson assembly — primers with overlapping tails for each junction."""
    if len(fragments) < 2:
        raise HTTPException(400, "Gibson assembly requires at least 2 fragments")
    if overlap_length < 15 or overlap_length > 60:
        raise HTTPException(400, "Overlap length must be 15-60 bp")

    seqs = []
    for f in fragments:
        s = f["seq"].upper().replace(" ", "").replace("\n", "")
        if len(s) < 20:
            raise HTTPException(400, f"Fragment '{f['name']}' is too short (min 20bp)")
        seqs.append(s)

    warnings = []
    junctions = []
    all_primers = []
    half_overlap = overlap_length // 2

    # Determine junctions
    n = len(seqs)
    junction_count = n if circular else n - 1

    for j in range(junction_count):
        up_idx = j
        down_idx = (j + 1) % n
        up_seq = seqs[up_idx]
        down_seq = seqs[down_idx]
        up_name = fragments[up_idx]["name"]
        down_name = fragments[down_idx]["name"]

        # Overlap = last half_overlap of upstream + first half_overlap of downstream
        up_tail = up_seq[-half_overlap:] if len(up_seq) >= half_overlap else up_seq
        down_tail = down_seq[:half_overlap] if len(down_seq) >= half_overlap else down_seq
        overlap_seq = up_tail + down_tail

        overlap_tm = _calc_tm(overlap_seq)
        if overlap_tm < 45:
            warnings.append(f"Junction {up_name}→{down_name} overlap Tm ({overlap_tm}°C) is low — may reduce assembly efficiency")
        elif overlap_tm > 72:
            warnings.append(f"Junction {up_name}→{down_name} overlap Tm ({overlap_tm}°C) is high")

        # Forward primer for downstream fragment: tail = end of upstream, annealing = start of downstream
        fwd_tail = up_tail
        fwd_candidates = _generate_primer_candidates(
            template=down_seq, pos=0, direction="forward", tail=fwd_tail, 
            tm_target=tm_target, min_len=12, max_len=60, max_total=60
        )
        fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{down_name}_Fwd", max_alternatives=None)

        # Reverse primer for upstream fragment: tail = RC of start of downstream, annealing = RC of end of upstream
        rev_tail = _reverse_complement(down_tail)
        rev_candidates = _generate_primer_candidates(
            template=up_seq, pos=len(up_seq), direction="reverse", tail=rev_tail, 
            tm_target=tm_target, min_len=12, max_len=60, max_total=60
        )
        rev_primer = _pick_best_with_alternatives(rev_candidates, f"{up_name}_Rev", max_alternatives=None)

        for p, pname in [(fwd_primer, f"{down_name}_Fwd"), (rev_primer, f"{up_name}_Rev")]:
            if p and p.get("hairpin"):
                warnings.append(f"{pname} may form hairpin")
            if p and p.get("homodimer_dg", 0) < -7.0:
                warnings.append(f"{pname} has strong self-dimer (ΔG = {p['homodimer_dg']} kcal/mol)")

        junctions.append({
            "name": f"{up_name}→{down_name}",
            "overlap_seq": overlap_seq,
            "overlap_tm": overlap_tm,
            "fwd_primer": fwd_primer,
            "rev_primer": rev_primer,
        })
        all_primers.append(fwd_primer)
        all_primers.append(rev_primer)

    # Build product sequence (concatenate all fragments)
    product_seq = "".join(seqs)
    product_annotations = []
    offset = 0
    for i, f in enumerate(fragments):
        flen = len(seqs[i])
        product_annotations.append({
            "name": f["name"], "start": offset, "end": offset + flen,
            "direction": 1, "color": ["#4682B4", "#2ecc71", "#e67e22", "#9b59b6", "#e74c3c", "#1abc9c"][i % 6],
            "type": "misc_feature",
        })
        offset += flen

    return {
        "junctions": junctions,
        "primers": all_primers,
        "product_length": len(product_seq),
        "product_seq": product_seq,
        "product_annotations": product_annotations,
        "num_fragments": len(fragments),
        "warnings": warnings,
    }


def _ensure_gc_clamp(seq, max_len=60):
    """Append a G to the 3' end if it doesn't already end with G or C."""
    if seq[-1] in "GC":
        return seq
    if len(seq) < max_len:
        return seq + "G"
    return seq


def _has_hairpin(seq, min_stem=4, min_loop=3):
    """Check whether seq can form a hairpin (stem-loop)."""
    n = len(seq)
    for stem_len in range(min_stem, min(8, n // 2)):
        for i in range(n - 2 * stem_len - min_loop + 1):
            stem = seq[i:i + stem_len]
            loop_start = i + stem_len + min_loop
            complement = seq[loop_start:loop_start + stem_len]
            if stem == _reverse_complement(complement):
                return True
    return False


def _has_self_dimer(seq, min_match=4):
    """Check whether the primer can form a self-dimer (3' overlap with its own RC)."""
    rc = _reverse_complement(seq)
    n = len(seq)
    for i in range(n - min_match + 1):
        kmer = seq[i:i + min_match]
        if kmer in rc:
            return True
    return False

def _calc_homodimer_dg(seq: str, temp_c: float = 60.0) -> float:
    """Calculate the most stable self-dimer ΔG by sliding the primer against its own RC.
    In a self-dimer, two copies of the same primer align antiparallel. This is
    equivalent to aligning seq against reverse_complement(seq) and finding positions
    where bases are IDENTICAL (meaning the original bases are Watson-Crick pairs).
    Returns the most negative (most stable) ΔG found across all alignments."""
    seq = seq.upper()
    rc = _reverse_complement(seq)
    n = len(seq)
    if n < 4:
        return 0.0

    best_dg = 0.0  # 0 = no interaction; more negative = worse dimer

    # Slide rc across seq in all possible alignments (at least 4bp overlap)
    for offset in range(-(n - 4), n - 3):
        # Determine overlap region
        if offset < 0:
            s_start = 0
            r_start = -offset
        else:
            s_start = offset
            r_start = 0
        overlap_len = min(n - s_start, n - r_start)
        if overlap_len < 4:
            continue

        # Find contiguous matched stretches and compute ΔG
        match_dh = 0.0
        match_ds = 0.0
        match_count = 0

        for i in range(overlap_len - 1):
            sb = seq[s_start + i]
            rb = rc[r_start + i]
            sb2 = seq[s_start + i + 1]
            rb2 = rc[r_start + i + 1]
            # Self-dimer base pair: seq base equals RC base → original bases are complementary
            if sb == rb and sb2 == rb2:
                pair = sb + sb2
                if pair in NN_THERMO:
                    h, s = NN_THERMO[pair]
                    match_dh += h
                    match_ds += s
                match_count += 1

        if match_count >= 2:
            temp_k = temp_c + 273.15
            dg = match_dh - (temp_k * match_ds / 1000.0)
            if dg < best_dg:
                best_dg = dg

    return round(best_dg, 2)


def _generate_primer_candidates(template: str, pos: int, direction: str, tail: str,
                                 tm_target: float, min_len: int = 18, max_len: int = 40,
                                 max_total: int = 60) -> list:
    """Generate multiple primer candidates with different annealing lengths.
    Returns a list of candidate dicts sorted by score (best first), each containing
    full primer properties including dimer/hairpin/ΔG analysis."""
    tpl_len = len(template)
    candidates = []

    # Constrain annealing length so total primer doesn't exceed max_total
    tail_len = len(tail)
    effective_max = min(max_len, max_total - tail_len)
    if effective_max < min_len:
        effective_max = min_len  # at least try one

    for anneal_len in range(min_len, effective_max + 1):
        if direction == "forward":
            anneal_seq = _get_seq_region(template, pos, anneal_len)
        else:
            bases = []
            for i in range(anneal_len):
                bases.append(template[(pos - 1 - i) % tpl_len])
            anneal_seq = _reverse_complement("".join(bases))

        full_seq = tail + anneal_seq
        tm = _calc_tm(anneal_seq)
        gc = round(_gc_content(full_seq) * 100, 1)
        dg = _calc_delta_g(anneal_seq, temp_c=tm if tm > 0 else 60.0)
        homodimer_dg = _calc_homodimer_dg(full_seq, temp_c=60.0)
        hairpin = _has_hairpin(full_seq)
        self_dimer = _has_self_dimer(full_seq)
        quality = _check_primer_quality(anneal_seq, tm)

        # Score: lower is better
        # Penalise Tm deviation, strong homodimers, hairpins, poor GC
        tm_penalty = abs(tm - tm_target) * 2.0
        dimer_penalty = max(0, -homodimer_dg - 5.0) * 3.0  # penalise ΔG < -5 kcal/mol
        hairpin_penalty = 5.0 if hairpin else 0.0
        gc_penalty = max(0, abs(gc - 50) - 10) * 0.5  # penalise GC outside 40-60
        score = tm_penalty + dimer_penalty + hairpin_penalty + gc_penalty

        candidates.append({
            "full_seq": full_seq,
            "tail": tail,
            "annealing": anneal_seq,
            "tm": tm,
            "length": len(full_seq),
            "gc_percent": gc,
            "delta_g": dg,
            "homodimer_dg": homodimer_dg,
            "hairpin": hairpin,
            "self_dimer": self_dimer,
            "quality": quality,
            "score": round(score, 2),
        })

    # Sort by score (best first)
    candidates.sort(key=lambda c: c["score"])
    return candidates


def _pick_best_with_alternatives(candidates: list, name: str, max_alternatives: int = None) -> dict:
    """From a sorted list of candidates, pick the best and attach ALL other candidates
    as alternatives (filtered by Tm >= 55) so the user can compare trade-offs.
    Returns the best candidate dict with a 'name' and 'alternatives' key added."""
    if not candidates:
        return None
        
    # Always keep the absolute best candidate to prevent returning None 
    # if the sequence is highly AT-rich and nothing hits 55°C.
    best = dict(candidates[0])
    best["name"] = name
    alts = []
    
    for c in candidates[1:]:
        # Filter out alternatives with a Tm below 55°C
        if c.get("tm", 0) < 55.0:
            continue
            
        # Allow max_alternatives to be None to return an unlimited list
        if max_alternatives is not None and len(alts) >= max_alternatives:
            break
            
        alt = dict(c)
        alt["name"] = name
        alts.append(alt)
        
    best["alternatives"] = alts
    return best


def design_golden_gate(bins: list = None, fragments: list = None, vector: dict = None,
                       enzyme: str = "BsaI", circular: bool = True,
                       tm_target: float = 62.0) -> dict:
    """Design a Golden Gate assembly with type IIS enzyme.

    Supports positional bins — each bin holds 1+ fragment options.
    Overhangs are assigned per junction (between bins), so every fragment
    in a given bin gets the same flanking overhangs, enabling combinatorial
    assembly in a single reaction.

    If `bins` is None but `fragments` is provided, each fragment becomes a
    single-option bin (backward compatibility).
    """
    # ── Normalise input to bins
    if bins is None and fragments is not None:
        bins = [{"name": f.get("name", f"Part {i+1}"), "fragments": [f]} for i, f in enumerate(fragments)]
    if not bins or len(bins) < 1:
        raise HTTPException(400, "Golden Gate assembly requires at least 1 bin with fragments")
    for b in bins:
        if not b.get("fragments"):
            raise HTTPException(400, f"Bin '{b.get('name', '?')}' has no fragments")

    if enzyme not in TYPE_IIS_ENZYMES:
        raise HTTPException(400, f"Unknown enzyme: {enzyme}. Supported: {', '.join(TYPE_IIS_ENZYMES.keys())}")

    enz = TYPE_IIS_ENZYMES[enzyme]
    site = enz["site"]
    rc_site = enz["rc_site"]
    spacer = "A"

    warnings = []
    internal_sites = []

    # ── Validate every fragment in every bin & check internal sites
    for b in bins:
        for f in b["fragments"]:
            s = f["seq"].upper().replace(" ", "").replace("\n", "")
            f["_seq"] = s  # store cleaned version
            if len(s) < 15:
                raise HTTPException(400, f"Fragment '{f['name']}' in bin '{b['name']}' is too short (min 15bp)")
            positions = _check_internal_sites(s, site, rc_site)
            if positions:
                internal_sites.append({"fragment": f["name"], "bin": b["name"], "positions": positions})
                warnings.append(f"'{f['name']}' (bin {b['name']}) has {len(positions)} internal {enzyme} site(s)")

    # Vector check
    vec_seq = None
    if vector and vector.get("seq"):
        vec_seq = vector["seq"].upper().replace(" ", "").replace("\n", "")
        positions = _check_internal_sites(vec_seq, site, rc_site)
        # Vector is *expected* to have exactly 2 sites (flanking the insert cassette)
        # but extra sites are a problem
        if len(positions) > 2:
            warnings.append(f"Vector '{vector.get('name', 'vector')}' has {len(positions)} {enzyme} sites — expected ≤2")

    # ── Assign overhangs to junctions
    # Junctions: [vec→bin0], bin0→bin1, bin1→bin2, ..., [binN→vec]
    # With vector & circular: N_bins + 1 overhangs (one per junction including wrap)
    # Without vector & circular: N_bins overhangs
    # Without vector & linear: N_bins - 1 overhangs (+ start/end don't need matching)
    n_bins = len(bins)
    has_vec = vec_seq is not None

    if circular or has_vec:
        n_junctions = n_bins + (1 if has_vec else 0)
    else:
        n_junctions = n_bins - 1

    n_overhangs = n_junctions + (1 if circular or has_vec else 0)
    if n_overhangs > len(GOLDEN_OVERHANGS):
        raise HTTPException(400, f"Too many positions — max {len(GOLDEN_OVERHANGS)} overhangs available, need {n_overhangs}")
    overhangs = GOLDEN_OVERHANGS[:n_overhangs]

    # ── Design primers for every fragment in every bin
    # Each bin i has:
    #   left_overhang  = overhangs[i]      (or overhangs[i+1] with vector offset)
    #   right_overhang = overhangs[i+1]    (wrapping for circular)
    bin_results = []
    all_primers = []

    oh_offset = 1 if has_vec else 0  # shift bin overhangs if vector takes position 0

    for bi, b in enumerate(bins):
        left_oh = overhangs[(bi + oh_offset) % len(overhangs)]
        right_oh = overhangs[(bi + oh_offset + 1) % len(overhangs)]

        frag_results = []
        for f in b["fragments"]:
            s = f["_seq"]
            # Forward primer: spacer + site + left_overhang + annealing
            fwd_tail = spacer + site + left_oh
            fwd_candidates = _generate_primer_candidates(s, 0, "forward", fwd_tail, tm_target)
            fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{f['name']}_Fwd_{enzyme}")

            # Reverse primer: spacer + RC(site) + RC(right_overhang) + annealing
            rev_tail = spacer + rc_site + _reverse_complement(right_oh)
            rev_candidates = _generate_primer_candidates(s, len(s), "reverse", rev_tail, tm_target)
            rev_primer = _pick_best_with_alternatives(rev_candidates, f"{f['name']}_Rev_{enzyme}")

            # Add hairpin/dimer warnings
            for p, pname in [(fwd_primer, f"{f['name']}_Fwd"), (rev_primer, f"{f['name']}_Rev")]:
                if p and p.get("hairpin"):
                    warnings.append(f"{pname} may form hairpin")
                if p and p.get("homodimer_dg", 0) < -7.0:
                    warnings.append(f"{pname} has strong self-dimer (ΔG = {p['homodimer_dg']} kcal/mol)")

            frag_results.append({
                "name": f["name"],
                "length": len(s),
                "fwd_primer": fwd_primer,
                "rev_primer": rev_primer,
            })
            all_primers.append(fwd_primer)
            all_primers.append(rev_primer)

        bin_results.append({
            "name": b["name"],
            "left_overhang": left_oh,
            "right_overhang": right_oh,
            "num_options": len(b["fragments"]),
            "fragments": frag_results,
        })

    # ── Vector primers (if provided)
    vec_primers = None
    if has_vec:
        # Vector fwd: after last bin → vector start
        vec_fwd_tail = spacer + site + overhangs[0]
        vec_fwd_candidates = _generate_primer_candidates(vec_seq, 0, "forward", vec_fwd_tail, tm_target)
        vec_fwd = _pick_best_with_alternatives(vec_fwd_candidates, f"{vector.get('name', 'Vector')}_Fwd_{enzyme}")

        # Vector rev: before first bin → vector end
        vec_rev_oh_idx = oh_offset  # = 1
        vec_rev_tail = spacer + rc_site + _reverse_complement(overhangs[vec_rev_oh_idx])
        vec_rev_candidates = _generate_primer_candidates(vec_seq, len(vec_seq), "reverse", vec_rev_tail, tm_target)
        vec_rev = _pick_best_with_alternatives(vec_rev_candidates, f"{vector.get('name', 'Vector')}_Rev_{enzyme}")

        vec_primers = {"fwd": vec_fwd, "rev": vec_rev}
        all_primers.append(vec_primers["fwd"])
        all_primers.append(vec_primers["rev"])

    # ── Combinatorial stats
    combo_count = 1
    for b in bins:
        combo_count *= len(b["fragments"])

    if combo_count > 1:
        warnings.insert(0, f"Combinatorial assembly: {combo_count} possible construct{'s' if combo_count > 1 else ''}")

    # ── Build default product (first fragment from each bin)
    default_seqs = []
    for b in bins:
        default_seqs.append(b["fragments"][0]["_seq"])
    if has_vec:
        product_seq = vec_seq + "".join(default_seqs)
    else:
        product_seq = "".join(default_seqs)

    # ── Overhang map for display
    overhang_map = []
    for i in range(len(overhangs)):
        if has_vec and i == 0:
            label = f"Vector → {bins[0]['name']}" if len(bins) > 0 else "Vector start"
        elif has_vec:
            left_name = bins[i - 1]["name"] if i - 1 < len(bins) else "Vector"
            right_name = bins[i]["name"] if i < len(bins) else "Vector"
            label = f"{left_name} → {right_name}"
        else:
            left_name = bins[i]["name"] if i < len(bins) else bins[-1]["name"]
            right_name = bins[(i + 1) % len(bins)]["name"] if (i + 1) < len(bins) else bins[0]["name"]
            label = f"{left_name} → {right_name}"
        overhang_map.append({"overhang": overhangs[i], "label": label})

    return {
        "enzyme": {"name": enzyme, "site": site, "cut_offset": enz["cut_offset"]},
        "bins": bin_results,
        "overhang_map": overhang_map,
        "vector_primers": vec_primers,
        "vector_name": vector.get("name", "Vector") if vector else None,
        "primers": all_primers,
        "product_length": len(product_seq),
        "product_seq": product_seq,
        "combo_count": combo_count,
        "num_bins": n_bins,
        "warnings": warnings,
        "internal_sites": internal_sites,
    }


def design_digest_ligate(vector: dict, insert: dict, enzyme1: str, enzyme2: str = None,
                         design_primers: bool = True, tm_target: float = 62.0,
                         vector_cut1_pos: int = None, vector_cut2_pos: int = None) -> dict:
    """Design a digest-ligate cloning strategy."""
    from Bio.Seq import Seq as BioSeq
    from Bio.Restriction import RestrictionBatch, Analysis

    vec_seq = vector["seq"].upper().replace(" ", "").replace("\n", "")
    ins_seq = insert["seq"].upper().replace(" ", "").replace("\n", "")
    vec_name = vector.get("name", "vector")
    ins_name = insert.get("name", "insert")

    if not vec_seq or not ins_seq:
        raise HTTPException(400, "Both vector and insert sequences are required")

    enzymes_to_use = [enzyme1]
    if enzyme2:
        enzymes_to_use.append(enzyme2)

    # Validate enzymes and get properties
    batch = RestrictionBatch()
    enz_objects = {}
    for ename in enzymes_to_use:
        try:
            batch.add(ename.strip())
        except (ValueError, KeyError):
            raise HTTPException(400, f"Unknown enzyme: {ename}")

    # Analyse vector
    bio_vec = BioSeq(vec_seq)
    vec_analysis = Analysis(batch, bio_vec, linear=False)
    vec_results = vec_analysis.full()

    # Analyse insert
    bio_ins = BioSeq(ins_seq)
    ins_analysis = Analysis(batch, bio_ins, linear=True)
    ins_results = ins_analysis.full()

    warnings = []
    enzyme_info = {}
    sticky_ends = {}

    for enzyme_obj, positions in vec_results.items():
        ename = str(enzyme_obj)
        ovhg = int(enzyme_obj.ovhg) if hasattr(enzyme_obj, 'ovhg') else 0
        site_str = str(enzyme_obj.site) if hasattr(enzyme_obj, 'site') else "?"
        enzyme_info[ename] = {
            "name": ename, "site": site_str, "overhang": ovhg,
            "vector_cuts": sorted(positions), "num_vector_cuts": len(positions),
        }
        # Determine sticky end type
        if ovhg > 0:
            sticky_ends[ename] = {"type": "5_prime", "length": ovhg}
        elif ovhg < 0:
            sticky_ends[ename] = {"type": "3_prime", "length": abs(ovhg)}
        else:
            sticky_ends[ename] = {"type": "blunt", "length": 0}

        if len(positions) == 0:
            warnings.append(f"{ename} does not cut the vector")
        elif len(positions) > 2:
            warnings.append(f"{ename} cuts the vector {len(positions)} times — may fragment the backbone")

    for enzyme_obj, positions in ins_results.items():
        ename = str(enzyme_obj)
        if ename in enzyme_info:
            enzyme_info[ename]["insert_cuts"] = sorted(positions)
            enzyme_info[ename]["num_insert_cuts"] = len(positions)

    # Simulate vector digest
    vec_digest = simulate_digest(vec_seq, enzymes_to_use, circular=True)

    # Determine backbone (largest fragment)
    vec_frags = vec_digest.get("fragments", [])
    backbone = vec_frags[0] if vec_frags else {"size": len(vec_seq), "start": 0, "end": len(vec_seq)}

    # Check compatibility
    compatible = True
    if enzyme2:
        # Two-enzyme: directional cloning
        if not (enzyme1 in [str(e) for e in vec_results] and enzyme2 in [str(e) for e in vec_results]):
            compatible = False
            warnings.append("Not all enzymes cut the vector")
    else:
        # Single enzyme
        e1_info = enzyme_info.get(enzyme1, {})
        if e1_info.get("num_vector_cuts", 0) < 1:
            compatible = False

    # Design primers to add RE sites to insert if requested
    primers = []
    if design_primers and compatible:
        # Forward primer: RE site + annealing to insert start
        e1_info_dict = enzyme_info.get(enzyme1, {})
        e1_site = e1_info_dict.get("site", "")
        fwd_tail = "GA" + e1_site  # spacer + recognition site
        fwd_candidates = _generate_primer_candidates(ins_seq, 0, "forward", fwd_tail, tm_target)
        fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{ins_name}_Fwd_{enzyme1}")
        if fwd_primer:
            primers.append(fwd_primer)
            if fwd_primer.get("hairpin"):
                warnings.append(f"{ins_name}_Fwd may form hairpin")
            if fwd_primer.get("homodimer_dg", 0) < -7.0:
                warnings.append(f"{ins_name}_Fwd has strong self-dimer (ΔG = {fwd_primer['homodimer_dg']} kcal/mol)")

        # Reverse primer: RE site + annealing to insert end
        e2_name = enzyme2 or enzyme1
        e2_info_dict = enzyme_info.get(e2_name, {})
        e2_site = e2_info_dict.get("site", "")
        rev_tail = "GA" + _reverse_complement(e2_site) if e2_site else "GA"
        rev_candidates = _generate_primer_candidates(ins_seq, len(ins_seq), "reverse", rev_tail, tm_target)
        rev_primer = _pick_best_with_alternatives(rev_candidates, f"{ins_name}_Rev_{e2_name}")
        if rev_primer:
            primers.append(rev_primer)
            if rev_primer.get("hairpin"):
                warnings.append(f"{ins_name}_Rev may form hairpin")
            if rev_primer.get("homodimer_dg", 0) < -7.0:
                warnings.append(f"{ins_name}_Rev has strong self-dimer (ΔG = {rev_primer['homodimer_dg']} kcal/mol)")

    # Build ligation product
    product_seq = vec_seq  # simplified: backbone + insert
    product_len = backbone["size"] + len(ins_seq)
    ligation_product = {
        "seq_length": product_len,
        "topology": "circular",
    }

    # Build product sequence and annotations for preview
    # Simplified: insert placed at first cut site in backbone
    cut_pos = vec_digest.get("total_cuts", [0])[0] if vec_digest.get("total_cuts") else 0
    product_seq = vec_seq[:cut_pos] + ins_seq + vec_seq[cut_pos:]
    product_annotations = [
        {"name": vec_name + " backbone", "start": 0, "end": cut_pos, "direction": 1, "color": "#4682B4", "type": "misc_feature"},
        {"name": ins_name, "start": cut_pos, "end": cut_pos + len(ins_seq), "direction": 1, "color": "#2ecc71", "type": "misc_feature"},
        {"name": vec_name + " cont.", "start": cut_pos + len(ins_seq), "end": len(product_seq), "direction": 1, "color": "#4682B4", "type": "misc_feature"},
    ]

    return {
        "vector_digest": vec_digest,
        "enzyme_info": enzyme_info,
        "compatible": compatible,
        "ligation_product": ligation_product,
        "product_seq": product_seq,
        "product_length": len(product_seq),
        "product_annotations": product_annotations,
        "primers": primers,
        "warnings": warnings,
        "sticky_ends": sticky_ends,
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api", tags=["cloning"])

GB_DIR = "/data/gb_files"
OC_DEFAULT_URL = os.environ.get("OPENCLONING_URL", "http://localhost:8001")


@router.get("/cloning/config")
def get_config():
    return {"opencloning_url": OC_DEFAULT_URL}


@router.get("/cloning/sequences")
def list_sequences():
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
        # Kit parts
        try:
            kit_parts = conn.execute(
                "SELECT id, name, kit_name, part_type, description, gb_file, created "
                "FROM kit_parts WHERE gb_file IS NOT NULL AND gb_file != '' "
                "ORDER BY kit_name, name"
            ).fetchall()
        except Exception:
            kit_parts = []  # table may not exist yet

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
    for p in kit_parts:
        d = dict(p)
        d["type"] = "kitpart"
        fpath = os.path.join(GB_DIR, f"kitpart_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        items.append(d)

    return {"items": items}


@router.get("/cloning/sequences/{seq_type}/{seq_id}/parse")
def parse_sequence(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', or 'kitpart'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    return parse_genbank(fpath)


@router.get("/cloning/sequences/{seq_type}/{seq_id}/raw")
def raw_sequence(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', or 'kitpart'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        raise HTTPException(404, "GenBank file not found")
    with open(fpath, "r") as f:
        return PlainTextResponse(f.read(), media_type="text/plain")


class UpdateFeaturesRequest(BaseModel):
    annotations: List[dict]


@router.post("/cloning/sequences/{seq_type}/{seq_id}/update-features")
def update_features(seq_type: str, seq_id: int, body: UpdateFeaturesRequest):
    """Update annotations in a .gb file, preserving the sequence."""
    if seq_type not in ("primer", "plasmid"):
        raise HTTPException(400, "seq_type must be 'primer' or 'plasmid'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        raise HTTPException(404, "GenBank file not found")

    from Bio import SeqIO as _SeqIO
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from io import StringIO

    # Read existing record to preserve sequence + metadata
    records = list(_SeqIO.parse(fpath, "genbank"))
    if not records:
        raise HTTPException(400, "No records found in GenBank file")
    rec = records[0]

    # Clear existing features
    rec.features = []

    # Add source feature spanning whole sequence
    source = SeqFeature(
        FeatureLocation(0, len(rec.seq)),
        type="source",
        qualifiers={"mol_type": ["other DNA"], "organism": ["synthetic construct"]},
    )
    rec.features.append(source)

    # Add user-provided features
    for a in body.annotations:
        strand = 1 if a.get("direction", 1) == 1 else -1
        start = int(a.get("start", 0))
        end = int(a.get("end", 0))
        if start < 0 or end > len(rec.seq) or start >= end:
            continue  # skip invalid
        feat = SeqFeature(
            FeatureLocation(start, end, strand=strand),
            type=a.get("type", "misc_feature"),
            qualifiers={
                "label": [a.get("name", "feature")],
                "ApEinfo_fwdcolor": [a.get("color", "#95A5A6")],
                "ApEinfo_revcolor": [a.get("color", "#95A5A6")],
            },
        )
        rec.features.append(feat)

    # Write back
    output = StringIO()
    _SeqIO.write(rec, output, "genbank")
    with open(fpath, "w") as f:
        f.write(output.getvalue())

    return {"ok": True, "count": len(body.annotations)}


class ReindexRequest(BaseModel):
    new_origin: int


@router.post("/cloning/sequences/{seq_type}/{seq_id}/reindex")
def reindex_sequence(seq_type: str, seq_id: int, body: ReindexRequest):
    """Reindex a circular sequence — rotate so new_origin becomes position 0.
    Remaps all feature coordinates and rewrites the .gb file."""
    if seq_type not in ("primer", "plasmid", "kitpart"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', or 'kitpart'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
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
        return parse_genbank(fpath)  # no change needed

    # Rotate sequence
    new_seq = seq_str[origin:] + seq_str[:origin]
    rec.seq = Seq(new_seq)

    # Remap features
    new_features = []
    for feat in rec.features:
        start = int(feat.location.start)
        end = int(feat.location.end)
        new_start = (start - origin) % slen
        new_end = (end - origin) % slen

        # Skip source features — we'll regenerate
        if feat.type == "source":
            continue

        # If the feature doesn't wrap origin after reindex, keep it simple
        if new_start < new_end:
            new_feat = SeqFeature(
                FeatureLocation(new_start, new_end, strand=feat.location.strand),
                type=feat.type,
                qualifiers=dict(feat.qualifiers),
            )
            new_features.append(new_feat)
        else:
            # Feature now wraps origin — BioPython can't represent this in a simple
            # FeatureLocation, so store as-is (start < end by using the larger span)
            # This is a known GenBank limitation for wrapped features
            new_feat = SeqFeature(
                FeatureLocation(new_start, slen, strand=feat.location.strand),
                type=feat.type,
                qualifiers=dict(feat.qualifiers),
            )
            new_features.append(new_feat)

    # Rebuild feature list with source
    rec.features = [SeqFeature(
        FeatureLocation(0, slen),
        type="source",
        qualifiers={"mol_type": ["other DNA"], "organism": ["synthetic construct"]},
    )] + new_features

    # Write back
    output = StringIO()
    _SeqIO.write(rec, output, "genbank")
    with open(fpath, "w") as f:
        f.write(output.getvalue())

    # Return freshly parsed data
    return parse_genbank(fpath)


# ---------------------------------------------------------------------------
# Sequence analysis endpoints
# ---------------------------------------------------------------------------
@router.post("/cloning/find-orfs")
def find_orfs_endpoint(body: FindOrfsRequest):
    """Find open reading frames in all 6 frames."""
    orfs = find_orfs(
        seq=body.seq,
        min_length=body.min_length or 100,
        circular=body.circular if body.circular is not None else True,
    )
    return {"orfs": orfs, "count": len(orfs)}


@router.post("/cloning/restriction-analysis")
def restriction_endpoint(body: RestrictionRequest):
    """Find restriction enzyme cut sites."""
    return find_restriction_sites(
        seq=body.seq,
        enzyme_names=body.enzymes,
        circular=body.circular if body.circular is not None else True,
    )


@router.post("/cloning/seq-tool")
def seq_tool_endpoint(body: SeqToolRequest):
    """Perform sequence operations: rc, complement, reverse, translate."""
    seq = body.seq.upper().replace(" ", "").replace("\n", "")
    op = body.operation
    if op == "rc":
        return {"result": _reverse_complement(seq), "operation": "reverse_complement"}
    elif op == "complement":
        comp = {"A": "T", "T": "A", "G": "C", "C": "G", "N": "N"}
        return {"result": "".join(comp.get(b, "N") for b in seq), "operation": "complement"}
    elif op == "reverse":
        return {"result": seq[::-1], "operation": "reverse"}
    elif op == "translate":
        protein = _translate_seq(seq)
        return {"result": protein, "operation": "translate", "length_aa": len(protein)}
    else:
        raise HTTPException(400, f"Unknown operation: {op}. Use: rc, complement, reverse, translate")


@router.post("/cloning/tm-calc")
def tm_calc_endpoint(body: TmCalcRequest):
    """Calculate Tm for a sequence."""
    seq = body.seq.upper().replace(" ", "").replace("\n", "")
    tm = _calc_tm(seq)
    gc = _gc_content(seq) * 100
    return {"tm": tm, "gc_percent": round(gc, 1), "length": len(seq)}


@router.post("/cloning/digest")
def digest_endpoint(body: DigestRequest):
    """Simulate a restriction digest."""
    return simulate_digest(
        seq=body.seq,
        enzyme_names=body.enzymes,
        circular=body.circular if body.circular is not None else True,
    )


@router.post("/cloning/blast")
def blast_endpoint(body: BlastRequest):
    """Run a BLAST search against NCBI. This can take 30-120 seconds."""
    return run_blast(
        seq=body.seq,
        program=body.program or "blastn",
        database=body.database or "nt",
        max_hits=body.max_hits or 10,
    )


@router.post("/cloning/scan-features")
def scan_features_endpoint(body: ScanFeaturesRequest):
    """Scan for known molecular biology features (tags, promoters, etc.)."""
    return scan_known_features(
        seq=body.seq,
        circular=body.circular if body.circular is not None else True,
    )


# ---------------------------------------------------------------------------
# Assembly design endpoints
# ---------------------------------------------------------------------------
@router.post("/cloning/design-gibson")
def gibson_endpoint(body: GibsonRequest):
    """Design a Gibson assembly with overlapping primers."""
    frags = [{"name": f.name, "seq": f.seq, "start": f.start, "end": f.end} for f in body.fragments]
    return design_gibson(
        fragments=frags,
        circular=body.circular if body.circular is not None else True,
        overlap_length=body.overlap_length or 25,
        tm_target=body.tm_target or 62.0,
    )


@router.post("/cloning/design-goldengate")
def goldengate_endpoint(body: GoldenGateRequest):
    """Design a Golden Gate assembly with type IIS enzyme."""
    bins_data = None
    frags_data = None
    vec_data = None

    if body.bins:
        bins_data = [{"name": b.name, "fragments": [{"name": f.name, "seq": f.seq} for f in b.fragments]} for b in body.bins]
    elif body.fragments:
        frags_data = [{"name": f.name, "seq": f.seq} for f in body.fragments]

    if body.vector and body.vector.seq:
        vec_data = {"name": body.vector.name, "seq": body.vector.seq}

    return design_golden_gate(
        bins=bins_data,
        fragments=frags_data,
        vector=vec_data,
        enzyme=body.enzyme or "BsaI",
        circular=body.circular if body.circular is not None else True,
        tm_target=body.tm_target or 62.0,
    )


@router.post("/cloning/design-digest-ligate")
def digest_ligate_endpoint(body: DigestLigateRequest):
    """Design a digest-ligate cloning strategy."""
    vec = {"name": body.vector.name, "seq": body.vector.seq}
    ins = {"name": body.insert.name, "seq": body.insert.seq}
    return design_digest_ligate(
        vector=vec, insert=ins,
        enzyme1=body.enzyme1,
        enzyme2=body.enzyme2,
        design_primers=body.design_primers if body.design_primers is not None else True,
        tm_target=body.tm_target or 62.0,
        vector_cut1_pos=body.vector_cut1_pos,
        vector_cut2_pos=body.vector_cut2_pos,
    )


# ---------------------------------------------------------------------------
# Primer design endpoints
# ---------------------------------------------------------------------------
@router.post("/cloning/design-kld-primers")
def kld_endpoint(body: KLDRequest):
    # We map the Pydantic model fields to the new design_kld_primers function.
    # We use 'start_pos' and 'end_pos' for the range logic.
    return design_kld_primers(
        template_seq=body.template_seq,
        insert_seq=body.insert_seq,
        # Use start/end if provided, otherwise fallback to insertion_pos
        start_pos=getattr(body, 'start_pos', body.insertion_pos),
        end_pos=getattr(body, 'end_pos', body.insertion_pos),
        # Use the optimize flag if your KLDRequest model has it, else False
        optimize=getattr(body, 'optimize', False),
        tm_target=body.annealing_tm_target or 62.0,
        max_len=body.max_primer_length or 60,
    )


@router.post("/cloning/evaluate-primer")
def custom_primer_endpoint(body: CustomPrimerRequest):
    return evaluate_custom_primer(
        template_seq=body.template_seq,
        start=body.start,
        end=body.end,
        direction=body.direction,
    )


@router.post("/cloning/design-pcr-primers")
def pcr_endpoint(body: PCRPrimerRequest):
    return design_pcr_primers(
        template_seq=body.template_seq,
        target_start=body.target_start,
        target_end=body.target_end,
        tm_target=body.tm_target or 62.0,
    )


@router.post("/cloning/design-seq-primers")
def seq_primer_endpoint(body: SeqPrimerRequest):
    return design_seq_primers(
        template_seq=body.template_seq,
        region_start=body.region_start,
        region_end=body.region_end,
        read_length=body.read_length or 900,
        tm_target=body.tm_target or 62.0,
    )


@router.post("/cloning/save-primers")
def save_primers(body: SavePrimersRequest):
    """Save one or more designed primers to the primers table."""
    now = datetime.utcnow().isoformat()

    with get_db() as conn:
        settings = conn.execute("SELECT primer_prefix FROM dna_settings WHERE id=1").fetchone()
        prefix = dict(settings)["primer_prefix"] if settings else "P"

        last = conn.execute(
            "SELECT name FROM primers WHERE name LIKE ? ORDER BY id DESC LIMIT 1",
            (prefix + "%",)
        ).fetchone()
        next_num = 1
        if last:
            last_name = dict(last)["name"]
            digits = "".join(c for c in last_name[len(prefix):] if c.isdigit())
            if digits:
                next_num = int(digits) + 1

        saved = []
        for p in body.primers:
            name = f"{prefix}{next_num}"
            seq = p.get("seq", "")
            use_desc = p.get("use_desc", "")
            conn.execute(
                "INSERT INTO primers (name, sequence, use, created) VALUES (?, ?, ?, ?)",
                (name, seq, use_desc, now),
            )
            saved.append({"name": name, "seq": seq})
            next_num += 1

        conn.commit()

    return {"saved": saved}


# ---------------------------------------------------------------------------
# Product generation endpoints
# ---------------------------------------------------------------------------
@router.post("/cloning/product-preview")
def product_preview(body: ProductPreviewRequest):
    """Generate product sequence with remapped features for SeqViz preview."""
    return _build_product(
        mode=body.mode,
        template_seq=body.template_seq,
        annotations=body.annotations or [],
        template_name=body.template_name or "template",
        template_topology=body.template_topology or "circular",
        insertion_pos=body.insertion_pos,
        insert_seq=body.insert_seq,
        insert_label=body.insert_label,
        target_start=body.target_start,
        target_end=body.target_end,
    )


@router.post("/cloning/save-product")
def save_product(body: SaveProductRequest):
    """Generate product .gb file, save as a new plasmid, return parse data."""
    product = _build_product(
        mode=body.mode,
        template_seq=body.template_seq,
        annotations=body.annotations or [],
        template_name=body.template_name or "template",
        template_topology=body.template_topology or "circular",
        insertion_pos=body.insertion_pos,
        insert_seq=body.insert_seq,
        insert_label=body.insert_label,
        target_start=body.target_start,
        target_end=body.target_end,
    )

    # Override name with user-provided name
    product["name"] = body.product_name

    # Write GenBank file
    gb_content = _write_genbank(product)

    now = datetime.utcnow().isoformat()
    method = "KLD" if body.mode == "kld" else "PCR"
    use_desc = f"{method} product from {body.template_name or 'template'}"

    with get_db() as conn:
        # Get plasmid prefix
        settings = conn.execute("SELECT plasmid_prefix FROM dna_settings WHERE id=1").fetchone()
        prefix = dict(settings)["plasmid_prefix"] if settings else "pMR"

        last = conn.execute(
            "SELECT name FROM plasmids WHERE name LIKE ? ORDER BY id DESC LIMIT 1",
            (prefix + "%",)
        ).fetchone()
        next_num = 1
        if last:
            last_name = dict(last)["name"]
            digits = "".join(c for c in last_name[len(prefix):] if c.isdigit())
            if digits:
                next_num = int(digits) + 1

        plasmid_name = body.product_name or f"{prefix}{next_num}"

        cur = conn.execute(
            "INSERT INTO plasmids (name, use, gb_file, created) VALUES (?, ?, ?, ?)",
            (plasmid_name, use_desc, "yes", now),
        )
        conn.commit()
        plasmid_id = cur.lastrowid

    # Save .gb file
    os.makedirs(GB_DIR, exist_ok=True)
    gb_path = os.path.join(GB_DIR, f"plasmid_{plasmid_id}.gb")
    with open(gb_path, "w") as f:
        f.write(gb_content)

    return {
        "plasmid_id": plasmid_id,
        "plasmid_name": plasmid_name,
        "product": product,
    }


# ---------------------------------------------------------------------------
# OpenCloning CloningStrategy JSON export
# ---------------------------------------------------------------------------
def _build_oc_entry(seq_type, seq_id, source_id, seq_obj_id):
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        return None
    with open(fpath, "r") as f:
        gb_content = f.read()
    fname = f"{seq_type}_{seq_id}.gb"
    circular = "circular" in gb_content[:500].lower()
    source = {"id": source_id, "type": "UploadedFileSource", "input": [],
              "file_name": fname, "index_in_file": 0, "sequence_file_format": "genbank"}
    sequence = {"id": seq_obj_id, "type": "TextFileSequence",
                "source": {"id": source_id}, "file_content": gb_content, "circular": circular}
    file_entry = {"file_name": fname, "file_content": gb_content}
    return source, sequence, file_entry


@router.get("/cloning/export/{seq_type}/{seq_id}")
def export_single(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid"):
        raise HTTPException(400, "seq_type must be 'primer' or 'plasmid'")
    result = _build_oc_entry(seq_type, seq_id, 1, 2)
    if not result:
        raise HTTPException(404, "GenBank file not found")
    source, sequence, file_entry = result
    return {"sources": [source], "sequences": [sequence], "primers": [], "files": [file_entry]}


@router.get("/cloning/export-all")
def export_all():
    with get_db() as conn:
        primers = conn.execute("SELECT id FROM primers WHERE gb_file IS NOT NULL AND gb_file != ''").fetchall()
        plasmids = conn.execute("SELECT id FROM plasmids WHERE gb_file IS NOT NULL AND gb_file != ''").fetchall()
    sources, sequences, files = [], [], []
    sid = 1
    for row in plasmids:
        result = _build_oc_entry("plasmid", row["id"], sid, sid + 1)
        if result:
            sources.append(result[0]); sequences.append(result[1]); files.append(result[2]); sid += 2
    for row in primers:
        result = _build_oc_entry("primer", row["id"], sid, sid + 1)
        if result:
            sources.append(result[0]); sequences.append(result[1]); files.append(result[2]); sid += 2
    if not sources:
        raise HTTPException(404, "No sequences with GenBank files found")
    return {"sources": sources, "sequences": sequences, "primers": [], "files": files}


# ---------------------------------------------------------------------------
# Cloning project CRUD
# ---------------------------------------------------------------------------
@router.get("/cloning/projects")
def list_projects():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cloning_projects ORDER BY updated DESC").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/cloning/projects")
def create_project(body: CreateProject):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO cloning_projects (name, description, method, sequences, notes, created, updated) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (body.name, body.description, body.method, body.sequences, body.notes, now, now))
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
             existing["sequences"], existing["notes"], existing["status"], now, pid))
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
