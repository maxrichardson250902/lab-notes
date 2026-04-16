"""Cloning feature — sequence viewer + OpenCloning bridge + primer design suite."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os, json, math

from core.database import register_table, get_db

try:
    from jobs import submit_job, get_job
except ImportError:
    from core.jobs import submit_job, get_job

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
class PrimerCriteria(BaseModel):
    dimer_dg_max: Optional[float] = -6.0    # early exit threshold
    dimer_dg_warn: Optional[float] = -6.0   # amber coloring
    dimer_dg_fail: Optional[float] = -9.0   # red coloring
    tm_deviation: Optional[float] = 3.0     # max °C from target before warning
    gc_min: Optional[float] = 40.0          # %
    gc_max: Optional[float] = 60.0          # %
    penalize_hairpin: Optional[bool] = True
    gc_clamp_weight: Optional[float] = 6.0  # penalty for no 3' G/C (0 = off)
    junction_gc_weight: Optional[float] = 5.0  # KLD: penalty for AT-rich ligation junction (0 = off)

class KLDRequest(BaseModel):
    template_seq: str
    insert_seq: str
    # Keep insertion_pos for safety, but add the new ones
    insertion_pos: Optional[int] = 0 
    start_pos: Optional[int] = None
    end_pos: Optional[int] = None
    optimize: Optional[bool] = False
    exhaustive: Optional[bool] = False
    annealing_tm_target: Optional[float] = 62.0
    max_primer_length: Optional[int] = 60
    mg_conc: Optional[float] = 1.5
    criteria: Optional[PrimerCriteria] = None

class CustomPrimerRequest(BaseModel):
    template_seq: str
    start: int
    end: int
    direction: str  # "forward" or "reverse"
    tail: Optional[str] = ""  # 5' overhang/extension
    tail_orientation: Optional[str] = "oligo"  # "oligo" = as-is on oligo, "product" = auto-RC for reverse

class InSilicoPCRRequest(BaseModel):
    template_seq: str
    primer1: str
    primer2: str
    primer1_name: Optional[str] = "Primer 1"
    primer2_name: Optional[str] = "Primer 2"
    circular: Optional[bool] = True
    max_mismatches: Optional[int] = 2
    annotations: Optional[List[dict]] = []
    template_name: Optional[str] = "template"

class PCRPrimerRequest(BaseModel):
    template_seq: str
    target_start: int
    target_end: int
    tm_target: Optional[float] = 62.0
    criteria: Optional[PrimerCriteria] = None

class SeqPrimerRequest(BaseModel):
    template_seq: str
    region_start: int
    region_end: int
    read_length: Optional[int] = 900
    tm_target: Optional[float] = 62.0
    criteria: Optional[PrimerCriteria] = None

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
    start_pos: Optional[int] = None
    end_pos: Optional[int] = None
    insert_seq: Optional[str] = None
    insert_label: Optional[str] = "insert"
    # PCR fields
    target_start: Optional[int] = None
    target_end: Optional[int] = None

class SaveProductRequest(BaseModel):
    mode: str
    template_seq: Optional[str] = None
    annotations: Optional[List[dict]] = []
    product_seq: Optional[str] = None  # Assembly: pre-built product sequence
    product_annotations: Optional[List[dict]] = None  # Assembly: pre-built annotations
    save_as: Optional[str] = "plasmid"  # "plasmid", "gblock", or "kitpart"
    overwrite: Optional[bool] = False  # Overwrite existing by name
    topology: Optional[str] = None  # "circular" or "linear" (auto if None)
    template_name: Optional[str] = "template"
    template_topology: Optional[str] = "circular"
    product_name: str
    insertion_pos: Optional[int] = None
    start_pos: Optional[int] = None
    end_pos: Optional[int] = None
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
    annotations: Optional[List[dict]] = None
    no_overlap: Optional[bool] = False  # If true, primers for this fragment get no tails
    remove_stop: Optional[bool] = False   # Remove stop codon at 3' end of selected CDS
    remove_start: Optional[bool] = False  # Remove start codon at 5' end of selected CDS

class GibsonRequest(BaseModel):
    fragments: List[FragmentInput]
    circular: Optional[bool] = True
    overlap_length: Optional[int] = 25
    tm_target: Optional[float] = 62.0
    criteria: Optional[PrimerCriteria] = None
    gblock_mode: Optional[bool] = False  # Output extended fragments instead of primers
    gblock_indices: Optional[List[int]] = None  # Which fragment indices get gBlock treatment (None = all)

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
    criteria: Optional[PrimerCriteria] = None

class DigestLigateRequest(BaseModel):
    vector: FragmentInput
    insert: FragmentInput
    enzyme1: str
    enzyme2: Optional[str] = None
    vector_cut1_pos: Optional[int] = None
    vector_cut2_pos: Optional[int] = None
    design_primers: Optional[bool] = True
    tm_target: Optional[float] = 62.0
    criteria: Optional[PrimerCriteria] = None


class RunGibsonAssemblyRequest(BaseModel):
    fragments: List[FragmentInput]
    circular: Optional[bool] = True
    min_overlap: Optional[int] = 15
    max_overlap_scan: Optional[int] = 60
    min_identity: Optional[float] = 90.0  # percent

class RunGoldenGateAssemblyRequest(BaseModel):
    fragments: List[FragmentInput]
    vector: Optional[FragmentInput] = None
    enzyme: Optional[str] = "BsaI"


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


def _check_primer_quality(seq: str, tm: float, criteria: dict = None, tm_target: float = None) -> list:
    """Evaluate a primer against standard design rules. Returns list of
    {level: 'pass'|'warn'|'error', rule: str, detail: str}.
    If criteria dict is provided, uses its gc_min/gc_max/tm_deviation thresholds."""
    checks = []
    s = seq.upper()
    length = len(s)
    gc_lo = criteria.get("gc_min", 40) if criteria else 40
    gc_hi = criteria.get("gc_max", 60) if criteria else 60
    tm_dev = criteria.get("tm_deviation", 3) if criteria else 3

    # Length
    if length < 18:
        checks.append({"level": "error", "rule": "Length", "detail": f"{length}bp — minimum 18bp recommended"})
    elif length > 30:
        checks.append({"level": "warn", "rule": "Length", "detail": f"{length}bp — 18-25bp is typical"})
    else:
        checks.append({"level": "pass", "rule": "Length", "detail": f"{length}bp"})

    # GC content
    gc = _gc_content(s) * 100
    if gc < gc_lo or gc > gc_hi:
        checks.append({"level": "warn", "rule": "GC Content", "detail": f"{gc:.0f}% — {gc_lo:.0f}-{gc_hi:.0f}% recommended"})
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
    if tm_target is not None and tm_dev:
        # Use criteria-based Tm check relative to target
        delta = abs(tm - tm_target)
        if tm < 55:
            checks.append({"level": "error", "rule": "Tm", "detail": f"{tm}°C — below 55°C, too low"})
        elif delta > tm_dev:
            checks.append({"level": "warn", "rule": "Tm", "detail": f"{tm}°C — {delta:.1f}°C from target {tm_target}°C (max ±{tm_dev}°C)"})
        else:
            checks.append({"level": "pass", "rule": "Tm", "detail": f"{tm}°C"})
    else:
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
                              min_len: int = 18, max_len: int = 40, hard_max_len: int = None,
                              criteria: dict = None) -> dict:
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

    quality = _check_primer_quality(best_seq, best_tm, criteria=criteria, tm_target=tm_target)
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

def design_kld_primers(template_seq: str, insert_seq: str = "",
                       start_pos: int = 0, end_pos: int = None,
                       optimize: bool = False, exhaustive: bool = False,
                       tm_target: float = 62.0, max_len: int = 60,
                       mg_conc: float = 1.5, criteria: dict = None, _progress=None):
    import time
    t0 = time.time()
    if _progress is None:
        _progress = lambda pct, msg="": None  # no-op when called synchronously
    # Resolve criteria with defaults
    _crit = _resolve_criteria(criteria)
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    insert_seq = (insert_seq or "").upper().replace(" ", "").replace("\n", "")
    if end_pos is None:
        end_pos = start_pos

    if not template_seq:
        raise HTTPException(400, "Template sequence is empty")

    tpl_len = len(template_seq)
    ins_len = len(insert_seq)
    split_points = list(range(ins_len + 1)) if ins_len > 0 else [0]

    print(f"[KLD] start={start_pos} end={end_pos} insert={ins_len}bp optimize={optimize} "
          f"exhaustive={exhaustive} range={end_pos-start_pos+1} splits={len(split_points)} "
          f"max_len={max_len} mg_conc={mg_conc}", flush=True)

    best_overall_score = -float('inf')
    best_result = None

    search_stats = {"junction_pairs": 0, "split_points": len(split_points),
                    "candidates_generated": 0, "pairs_scored": 0}

    # ── Helper: full-analysis scoring for a (start, end, split) combo
    def _score_combo(s, e, sp):
        nonlocal best_overall_score, best_result
        fwd_tail = insert_seq[sp:]
        rev_tail = _reverse_complement(insert_seq[:sp])
        f_max_ann = max_len - len(fwd_tail)
        r_max_ann = max_len - len(rev_tail)
        if f_max_ann < 12 or r_max_ann < 12:
            return

        f_cands = _generate_primer_candidates(
            template_seq, e, "forward", fwd_tail, tm_target,
            min_len=12, max_len=f_max_ann, max_total=max_len, lightweight=False, mg_conc=mg_conc, criteria=_crit)
        r_cands = _generate_primer_candidates(
            template_seq, s, "reverse", rev_tail, tm_target,
            min_len=12, max_len=r_max_ann, max_total=max_len, lightweight=False, mg_conc=mg_conc, criteria=_crit)
        search_stats["candidates_generated"] += len(f_cands) + len(r_cands)
        if not f_cands or not r_cands:
            return

        f, r = f_cands[0], r_cands[0]

        # Check annealing overlap on circular template
        amplicon_space = tpl_len - (e - s)
        if amplicon_space < len(f['annealing']) + len(r['annealing']):
            return

        tm_err = abs(f['tm'] - tm_target) + abs(r['tm'] - tm_target)
        tm_delta = abs(f['tm'] - r['tm'])
        ss_penalty = 0
        if _crit["penalize_hairpin"] and (f.get('hairpin') or r.get('hairpin')): ss_penalty += 25
        if f.get('homodimer_dg', 0) < _crit["dimer_dg_fail"]: ss_penalty += 15
        score = -(tm_err * 2) - (tm_delta * 4) - ss_penalty
        search_stats["pairs_scored"] += 1

        if score > best_overall_score:
            best_overall_score = score
            best_result = {
                "fwd_all": f_cands, "rev_all": r_cands,
                "actual_start": s, "actual_end": e,
                "split": sp,
            }

    # ══════════════════════════════════════════════════════════════
    # PHASE 1: Baseline — full analysis at the exact (start, end)
    # This always runs, so optimize can only improve on it.
    # ══════════════════════════════════════════════════════════════
    _progress(2, "Running baseline analysis…")
    for sp in split_points:
        _score_combo(start_pos, end_pos, sp)
    search_stats["junction_pairs"] = 1

    baseline_score = best_overall_score
    _progress(10, "Baseline complete")
    print(f"[KLD] baseline done in {time.time()-t0:.2f}s  score={baseline_score:.1f}  "
          f"candidates={search_stats['candidates_generated']}", flush=True)

    # ══════════════════════════════════════════════════════════════
    # PHASE 2: Top-K independent ranking with cross-join
    #
    #   Step A — Pre-rank annealing regions by Tm+GC+palindrome (cheap,
    #            independent of insert split). Keep top-M per direction.
    #   Step B — For each split point, append tail to top-M annealing
    #            regions, run primer3 homodimer (expensive). Keep top-K.
    #   Step C — Cross-join K×K pairs, score combined metrics.
    #   Step D — Select best overall + build Pareto front.
    #
    #   Cost: S × (2·M primer3 calls + K² pair checks)
    #   With M=80, K=50, S=37 → ~5,920 primer3 calls + ~92,500 pair checks
    # ══════════════════════════════════════════════════════════════
    pareto_pairs = []  # populated only when optimize runs

    if optimize and (end_pos - start_pos) > 0:
        positions = list(range(start_pos, end_pos + 1))
        n_pos = len(positions)
        # Tuning knobs — scale with problem size
        LENGTHS_PER_POS = 5  # keep top-N annealing lengths per position
        TOP_K = 50           # candidates per direction per split after primer3

        print(f"[KLD] top-K cross-join: {n_pos} positions, {len(split_points)} splits, "
              f"LENGTHS_PER_POS={LENGTHS_PER_POS} TOP_K={TOP_K} exhaustive={exhaustive}", flush=True)

        # ── Step A: Pre-rank annealing regions (cheap, no tail dependency) ──
        #   Keep top-N lengths per position so every position gets equal
        #   representation regardless of range size. This avoids the bug where
        #   a large range starves positions of length variants (adjacent positions
        #   share 90%+ of sequence and crowd the global top-M).
        _progress(12, "Pre-ranking annealing regions…")

        fwd_anneal_pool = []
        rev_anneal_pool = []

        _gc_w = _crit["gc_clamp_weight"]

        for pos in positions:
            fwd_at_pos = []
            rev_at_pos = []
            for anneal_len in range(12, max_len + 1):
                # Forward at this position
                a_seq = _get_seq_region(template_seq, pos, anneal_len)
                a_tm = _calc_tm(a_seq)
                a_gc = round(_gc_content(a_seq) * 100, 1)
                a_sc = abs(a_tm - tm_target) * 2.0 + max(0, abs(a_gc - 50) - 10) * 0.5 + _self_comp_penalty(a_seq) + _gc_clamp_penalty(a_seq, _gc_w)
                fwd_at_pos.append((a_sc, pos, a_seq, anneal_len, a_tm, a_gc))

                # Reverse at this position
                bases = []
                for i in range(anneal_len):
                    bases.append(template_seq[(pos - 1 - i) % tpl_len])
                r_seq = _reverse_complement("".join(bases))
                r_tm = _calc_tm(r_seq)
                r_gc = round(_gc_content(r_seq) * 100, 1)
                r_sc = abs(r_tm - tm_target) * 2.0 + max(0, abs(r_gc - 50) - 10) * 0.5 + _self_comp_penalty(r_seq) + _gc_clamp_penalty(r_seq, _gc_w)
                rev_at_pos.append((r_sc, pos, r_seq, anneal_len, r_tm, r_gc))

            # Keep top-N lengths at this position
            fwd_at_pos.sort()
            rev_at_pos.sort()
            fwd_anneal_pool.extend(fwd_at_pos[:LENGTHS_PER_POS])
            rev_anneal_pool.extend(rev_at_pos[:LENGTHS_PER_POS])

        # Sort final pools by score
        fwd_anneal_pool.sort()
        rev_anneal_pool.sort()
        top_fwd_anneals = fwd_anneal_pool  # already pruned: n_pos × LENGTHS_PER_POS
        top_rev_anneals = rev_anneal_pool

        TOP_M = len(top_fwd_anneals)  # for stats reporting

        search_stats["candidates_generated"] += len(fwd_anneal_pool) + len(rev_anneal_pool)
        search_stats["top_m"] = TOP_M
        search_stats["top_k"] = TOP_K
        search_stats["lengths_per_pos"] = LENGTHS_PER_POS
        search_stats["algorithm"] = "top_k_cross_join"
        fwd_positions = len(set(e[1] for e in top_fwd_anneals))
        rev_positions = len(set(e[1] for e in top_rev_anneals))

        print(f"[KLD] Step A done: {n_pos} pos × {LENGTHS_PER_POS} lengths = "
              f"{TOP_M} per direction (fwd:{fwd_positions} pos, rev:{rev_positions} pos)  "
              f"({time.time()-t0:.2f}s)", flush=True)

        # ── Step B+C: Per-split evaluation + cross-join ──
        _progress(22, "Evaluating primer pairs…")
        primer3_calls = 0
        all_scored_pairs = []   # (combined, f_dict, r_dict, s_pos, e_pos, split)
        _dg_warn_val = _crit["dimer_dg_warn"]
        _dg_fail_val = _crit["dimer_dg_fail"]
        _pen_hp = _crit["penalize_hairpin"]

        for si, sp in enumerate(split_points):
            fwd_tail = insert_seq[sp:]
            rev_tail = _reverse_complement(insert_seq[:sp])

            if max_len - len(fwd_tail) < 12 or max_len - len(rev_tail) < 12:
                continue

            # Evaluate top-M forward annealing regions with this split's tail
            fwd_scored = []
            for _, pos, anneal_seq, anneal_len, tm, gc in top_fwd_anneals:
                full_seq = fwd_tail.lower() + anneal_seq.upper()
                if len(full_seq) > max_len:
                    continue
                hd, hd_tm = _calc_homodimer_dg(full_seq, temp_c=25.0, dv_conc=mg_conc)
                hp = _has_hairpin(full_seq, dv_conc=mg_conc, annealing_tm=tm_target)
                primer3_calls += 1
                dp = max(0, -hd + _dg_warn_val) * 3.0
                if hd_tm is not None and hd_tm < (tm_target - 10):
                    dp *= 0.2  # dimer melts well below annealing — discount
                hp_p = (5.0 if hp else 0.0) if _pen_hp else 0.0
                gc_cp = _gc_clamp_penalty(full_seq, _gc_w)
                sc = abs(tm - tm_target) * 2.0 + max(0, abs(gc - 50) - 10) * 0.5 + dp + hp_p + gc_cp
                fwd_scored.append({
                    "pos": pos, "anneal_seq": anneal_seq, "anneal_len": anneal_len,
                    "full_seq": full_seq, "tail": fwd_tail.lower(),
                    "tm": tm, "gc": gc, "homodimer_dg": hd, "homodimer_tm": hd_tm, "hairpin": hp,
                    "score": round(sc, 2),
                })

            # Evaluate top-M reverse annealing regions with this split's tail
            rev_scored = []
            for _, pos, anneal_seq, anneal_len, tm, gc in top_rev_anneals:
                full_seq = rev_tail.lower() + anneal_seq.upper()
                if len(full_seq) > max_len:
                    continue
                hd, hd_tm = _calc_homodimer_dg(full_seq, temp_c=25.0, dv_conc=mg_conc)
                hp = _has_hairpin(full_seq, dv_conc=mg_conc, annealing_tm=tm_target)
                primer3_calls += 1
                dp = max(0, -hd + _dg_warn_val) * 3.0
                if hd_tm is not None and hd_tm < (tm_target - 10):
                    dp *= 0.2  # dimer melts well below annealing — discount
                hp_p = (5.0 if hp else 0.0) if _pen_hp else 0.0
                gc_cp = _gc_clamp_penalty(full_seq, _gc_w)
                sc = abs(tm - tm_target) * 2.0 + max(0, abs(gc - 50) - 10) * 0.5 + dp + hp_p + gc_cp
                rev_scored.append({
                    "pos": pos, "anneal_seq": anneal_seq, "anneal_len": anneal_len,
                    "full_seq": full_seq, "tail": rev_tail.lower(),
                    "tm": tm, "gc": gc, "homodimer_dg": hd, "homodimer_tm": hd_tm, "hairpin": hp,
                    "score": round(sc, 2),
                })

            # Keep top-K per direction for cross-join
            fwd_scored.sort(key=lambda c: c["score"])
            rev_scored.sort(key=lambda c: c["score"])
            fwd_topk = fwd_scored[:TOP_K]
            rev_topk = rev_scored[:TOP_K]

            # Cross-join K × K
            for f in fwd_topk:
                for r in rev_topk:
                    # Constraint: rev_pos <= fwd_pos (deletion region)
                    if r["pos"] > f["pos"]:
                        continue
                    # Check annealing overlap on circular template
                    amplicon_space = tpl_len - (f["pos"] - r["pos"])
                    if amplicon_space < f["anneal_len"] + r["anneal_len"]:
                        continue

                    tm_err = abs(f["tm"] - tm_target) + abs(r["tm"] - tm_target)
                    tm_delta = abs(f["tm"] - r["tm"])
                    ss_pen = 0
                    if _pen_hp and (f["hairpin"] or r["hairpin"]):
                        ss_pen += 25
                    if f["homodimer_dg"] < _dg_fail_val:
                        ss_pen += 15
                    if r["homodimer_dg"] < _dg_fail_val:
                        ss_pen += 15

                    # Junction GC penalty: penalise AT-rich bases at ligation junction
                    jgc_pen = 0
                    _jgc_w = _crit.get("junction_gc_weight", 5.0)
                    if _jgc_w > 0 and ins_len > 0:
                        # Insert split: check 2bp either side of split point
                        left_end = insert_seq[max(0, sp-2):sp].upper() if sp > 0 else ""
                        right_start = insert_seq[sp:min(ins_len, sp+2)].upper() if sp < ins_len else ""
                        junc_bases = left_end + right_start
                        if junc_bases:
                            jgc_frac = sum(1 for b in junc_bases if b in "GC") / len(junc_bases)
                            jgc_pen = _jgc_w * (1.0 - jgc_frac)  # 0 if all GC, full weight if all AT
                    elif _jgc_w > 0:
                        # Pure deletion: check template bases at primer 5' ends
                        t_left = template_seq[max(0, r["pos"]-2):r["pos"]].upper()
                        t_right = template_seq[f["pos"]:min(tpl_len, f["pos"]+2)].upper()
                        junc_bases = t_left + t_right
                        if junc_bases:
                            jgc_frac = sum(1 for b in junc_bases if b in "GC") / len(junc_bases)
                            jgc_pen = _jgc_w * (1.0 - jgc_frac)

                    combined = -(tm_err * 2) - (tm_delta * 4) - ss_pen - jgc_pen
                    search_stats["pairs_scored"] += 1

                    all_scored_pairs.append((combined, f, r, r["pos"], f["pos"], sp))

            # Progress
            split_pct = (si + 1) / len(split_points)
            _progress(22 + split_pct * 65, f"Split {si+1}/{len(split_points)} — {primer3_calls} analyses")
            if (si + 1) % max(1, len(split_points) // 5) == 0 or si == len(split_points) - 1:
                print(f"[KLD]   split {si+1}/{len(split_points)}: "
                      f"elapsed={time.time()-t0:.1f}s  primer3={primer3_calls}  "
                      f"pairs={search_stats['pairs_scored']}", flush=True)

        search_stats["primer3_calls"] = primer3_calls

        # ── Step D: Select best + build Pareto front ──
        _progress(90, "Computing heterodimers & building Pareto front…")

        if all_scored_pairs:
            all_scored_pairs.sort(key=lambda x: -x[0])

            # Compute heterodimer ΔG for top candidates and re-rank
            _top_n = min(500, len(all_scored_pairs))
            cand_pool = all_scored_pairs[:_top_n]
            het_cache = {}  # (fwd_seq, rev_seq) → dg
            reranked = []
            for entry in cand_pool:
                comb, f, r, s_pos, e_pos, sp = entry
                cache_key = (f["full_seq"].upper(), r["full_seq"].upper())
                if cache_key not in het_cache:
                    het_cache[cache_key] = _calc_heterodimer_dg(f["full_seq"], r["full_seq"], dv_conc=mg_conc)
                het_dg = het_cache[cache_key]
                het_pen = max(0, -het_dg + _dg_warn_val) * 4.0
                adjusted = comb - het_pen
                reranked.append((adjusted, het_dg, f, r, s_pos, e_pos, sp))

            reranked.sort(key=lambda x: -x[0])
            search_stats["heterodimer_calls"] = len(het_cache)

            # Update best_result with the winning pair
            _, best_het_dg, bf, br, bs, be, bsp = reranked[0]
            winning_combined = reranked[0][0]

            if winning_combined > best_overall_score:
                best_overall_score = winning_combined
                # Regenerate full candidates at winning positions for alternatives table
                w_fwd_tail = insert_seq[bsp:]
                w_rev_tail = _reverse_complement(insert_seq[:bsp])
                fwd_all = _generate_primer_candidates(
                    template_seq, be, "forward", w_fwd_tail, tm_target,
                    min_len=12, max_len=max_len - len(w_fwd_tail), max_total=max_len,
                    lightweight=False, mg_conc=mg_conc, criteria=_crit)
                rev_all = _generate_primer_candidates(
                    template_seq, bs, "reverse", w_rev_tail, tm_target,
                    min_len=12, max_len=max_len - len(w_rev_tail), max_total=max_len,
                    lightweight=False, mg_conc=mg_conc, criteria=_crit)
                best_result = {
                    "fwd_all": fwd_all, "rev_all": rev_all,
                    "actual_start": bs, "actual_end": be,
                    "split": bsp,
                    "heterodimer_dg": best_het_dg,
                }

            # ── Pareto front: best on each dimension (now includes heterodimer) ──
            def _pair_metrics(entry):
                adj, het_dg, f, r, s, e, sp = entry
                return {
                    "combined": adj,
                    "worst_dimer": min(f["homodimer_dg"], r["homodimer_dg"]),
                    "best_dimer": max(f["homodimer_dg"], r["homodimer_dg"]),
                    "heterodimer_dg": het_dg,
                    "tm_match": round(abs(f["tm"] - r["tm"]), 1),
                    "fwd_tm": f["tm"], "rev_tm": r["tm"],
                    "fwd_dimer": f["homodimer_dg"], "rev_dimer": r["homodimer_dg"],
                    "fwd_seq": f["full_seq"], "rev_seq": r["full_seq"],
                    "fwd_anneal": f["anneal_seq"], "rev_anneal": r["anneal_seq"],
                    "fwd_gc": f["gc"], "rev_gc": r["gc"],
                    "fwd_hairpin": f["hairpin"], "rev_hairpin": r["hairpin"],
                    "start": s, "end": e, "split": sp,
                }

            # Find Pareto-optimal pairs (4 dims: combined, worst_dimer, heterodimer, tm_match)
            metrics_pool = [_pair_metrics(p) for p in reranked]

            pareto_front = []
            for i, pi in enumerate(metrics_pool):
                dominated = False
                for j, pj in enumerate(metrics_pool):
                    if i == j:
                        continue
                    # pj dominates pi if strictly better on all 4 dimensions
                    if (pj["combined"] >= pi["combined"] and
                        pj["worst_dimer"] >= pi["worst_dimer"] and
                        pj["heterodimer_dg"] >= pi["heterodimer_dg"] and
                        pj["tm_match"] <= pi["tm_match"] and
                        (pj["combined"] > pi["combined"] or
                         pj["worst_dimer"] > pi["worst_dimer"] or
                         pj["heterodimer_dg"] > pi["heterodimer_dg"] or
                         pj["tm_match"] < pi["tm_match"])):
                        dominated = True
                        break
                if not dominated:
                    pareto_front.append(pi)

            # Label the best on each axis + overall for the user
            if pareto_front:
                # Sort by combined score as tiebreaker
                pareto_front.sort(key=lambda p: -p["combined"])
                # De-duplicate: unique by (start, end, split, fwd_seq, rev_seq)
                seen = set()
                unique_pareto = []
                for p in pareto_front:
                    key = (p["start"], p["end"], p["split"], p["fwd_seq"], p["rev_seq"])
                    if key not in seen:
                        seen.add(key)
                        unique_pareto.append(p)

                # Assign labels
                labelled = {}
                # Best overall (first by combined)
                labelled["best_overall"] = unique_pareto[0]
                # Best dimer (highest worst_dimer)
                best_dimer_p = max(unique_pareto, key=lambda p: p["worst_dimer"])
                labelled["best_dimer"] = best_dimer_p
                # Best heterodimer (highest heterodimer_dg = least negative)
                best_het_p = max(unique_pareto, key=lambda p: (p["heterodimer_dg"], p["combined"]))
                labelled["best_heterodimer"] = best_het_p
                # Best Tm match (lowest tm_match)
                best_tm_p = min(unique_pareto, key=lambda p: (p["tm_match"], -p["combined"]))
                labelled["best_tm_match"] = best_tm_p

                # Build output list, avoiding duplicates
                output_keys = set()
                for label, p in labelled.items():
                    key = (p["start"], p["end"], p["split"], p["fwd_seq"], p["rev_seq"])
                    if key not in output_keys:
                        output_keys.add(key)
                        pp = dict(p)
                        pp["label"] = label
                        pareto_pairs.append(pp)

                # Fill remaining slots from the Pareto front (up to 5 total)
                for p in unique_pareto:
                    if len(pareto_pairs) >= 5:
                        break
                    key = (p["start"], p["end"], p["split"], p["fwd_seq"], p["rev_seq"])
                    if key not in output_keys:
                        output_keys.add(key)
                        pp = dict(p)
                        pp["label"] = "pareto"
                        pareto_pairs.append(pp)

            search_stats["pareto_size"] = len(pareto_front)

        if exhaustive:
            search_stats["exhaustive"] = True

        print(f"[KLD] optimize done in {time.time()-t0:.2f}s  "
              f"baseline={baseline_score:.1f} -> final={best_overall_score:.1f}  "
              f"primer3={primer3_calls}  pairs_scored={search_stats['pairs_scored']}  "
              f"pareto={len(pareto_pairs)}", flush=True)

    if not best_result:
        raise HTTPException(400, "No viable primers found in this range.")

    fwd_primer = _pick_best_with_alternatives(best_result["fwd_all"], "Forward", max_alternatives=None)
    rev_primer = _pick_best_with_alternatives(best_result["rev_all"], "Reverse", max_alternatives=None)

    # Construct result product
    product = template_seq[:best_result["actual_start"]] + insert_seq + template_seq[best_result["actual_end"]:]

    split = best_result["split"]

    # Build warnings
    warnings = []
    # Compute heterodimer for the winning pair
    het_dg = best_result.get("heterodimer_dg")
    if het_dg is None:
        het_dg = _calc_heterodimer_dg(fwd_primer.get("full_seq", ""), rev_primer.get("full_seq", ""), dv_conc=mg_conc)
    if abs(fwd_primer['tm'] - rev_primer['tm']) > _crit["tm_deviation"]:
        warnings.append(f"Tm mismatch > {_crit['tm_deviation']}°C")
    fwd_dimer = fwd_primer.get('homodimer_dg', 0)
    rev_dimer = rev_primer.get('homodimer_dg', 0)
    _dg_fail = _crit["dimer_dg_fail"]
    _dg_warn = _crit["dimer_dg_warn"]
    if fwd_dimer < _dg_fail:
        warnings.append(f"Forward primer has strong self-dimer (\u0394G = {fwd_dimer} kcal/mol)")
    elif fwd_dimer < _dg_warn:
        warnings.append(f"Forward primer has moderate self-dimer (\u0394G = {fwd_dimer} kcal/mol)")
    if rev_dimer < _dg_fail:
        warnings.append(f"Reverse primer has strong self-dimer (\u0394G = {rev_dimer} kcal/mol)")
    elif rev_dimer < _dg_warn:
        warnings.append(f"Reverse primer has moderate self-dimer (\u0394G = {rev_dimer} kcal/mol)")
    if het_dg < _dg_fail:
        warnings.append(f"Strong heterodimer between primers (\u0394G = {het_dg} kcal/mol) — risk of primer-dimer or base skipping")
    elif het_dg < _dg_warn:
        warnings.append(f"Moderate heterodimer between primers (\u0394G = {het_dg} kcal/mol)")
    amplicon_space = tpl_len - (best_result["actual_end"] - best_result["actual_start"])
    fwd_ann_len = len(fwd_primer.get('annealing', ''))
    rev_ann_len = len(rev_primer.get('annealing', ''))
    gap = amplicon_space - fwd_ann_len - rev_ann_len
    if gap < 10:
        warnings.append(f"Tight primer spacing — only {gap}bp gap between annealing regions")

    print(f"[KLD] DONE in {time.time()-t0:.2f}s  start_used={best_result['actual_start']} "
          f"end_used={best_result['actual_end']} split={split} score={best_overall_score:.1f}", flush=True)

    _progress(98, "Done")

    return {
        "forward": fwd_primer,
        "reverse": rev_primer,
        "start_used": best_result["actual_start"],
        "end_used": best_result["actual_end"],
        "insert_split": split,
        "split_position": split,
        "insert_length": len(insert_seq),
        "split_gc_score": round(_score_split(insert_seq, split), 2) if insert_seq else 0.0,
        "product_length": len(product),
        "search_stats": search_stats,
        "warnings": warnings,
        "heterodimer_dg": het_dg,
        "pareto_pairs": pareto_pairs,
    }



# ---------------------------------------------------------------------------
# In Silico PCR
# ---------------------------------------------------------------------------
def _find_primer_bindings(anneal_seq, template, tpl_len, circular=True, max_mm=2, min_seed=12):
    """Find all positions where a primer anneals on template (both strands).
    Returns list of {pos, end, strand, mismatches}."""
    anneal = anneal_seq.upper()
    rc_anneal = _reverse_complement(anneal)
    n = len(anneal)
    seed_len = min(n, max(min_seed, 10))
    search_seq = template + (template[:n] if circular else "")
    search_len = len(search_seq)
    sites = []

    # Forward strand: primer matches template directly, extends rightward
    seed = anneal[-seed_len:]  # 3' end must match
    for i in range(search_len - seed_len + 1):
        if search_seq[i:i + seed_len] == seed:
            # Seed matches — check full primer with mismatch tolerance
            full_start = i - (n - seed_len)
            if full_start < 0:
                continue
            if full_start + n > search_len:
                continue
            full_region = search_seq[full_start:full_start + n]
            mm = sum(1 for a, b in zip(anneal, full_region) if a != b)
            if mm <= max_mm:
                pos = full_start % tpl_len
                end = (full_start + n) % tpl_len
                if not circular and full_start + n > tpl_len:
                    continue
                sites.append({
                    "pos": pos, "end": end if end != 0 or not circular else tpl_len,
                    "strand": "fwd", "mismatches": mm,
                })

    # Reverse strand: RC of primer matches template, primer extends leftward
    seed_rc = rc_anneal[:seed_len]  # 5' of RC = 3' of original primer
    for i in range(search_len - seed_len + 1):
        if search_seq[i:i + seed_len] == seed_rc:
            full_end = i + n
            if full_end > search_len:
                continue
            full_region = search_seq[i:full_end]
            mm = sum(1 for a, b in zip(rc_anneal, full_region) if a != b)
            if mm <= max_mm:
                pos = i % tpl_len
                end = (i + n) % tpl_len
                if not circular and i + n > tpl_len:
                    continue
                sites.append({
                    "pos": pos, "end": end if end != 0 or not circular else tpl_len,
                    "strand": "rev", "mismatches": mm,
                })

    return sites


def in_silico_pcr(template_seq, primer1, primer2, circular=True, max_mismatches=2,
                  annotations=None, template_name="template",
                  primer1_name="Primer 1", primer2_name="Primer 2"):
    """Simulate PCR: find binding sites, generate products with overhangs."""
    template = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template)

    # Split primers into tail + annealing based on case
    def _split_primer(seq):
        tail = ""
        for c in seq:
            if c.islower():
                tail += c
            else:
                break
        anneal = seq[len(tail):].upper() if tail else seq.upper()
        return tail, anneal

    p1_tail, p1_anneal = _split_primer(primer1)
    p2_tail, p2_anneal = _split_primer(primer2)

    if len(p1_anneal) < 10 or len(p2_anneal) < 10:
        raise HTTPException(400, "Primer annealing regions must be at least 10bp")

    # Find all binding sites for each primer
    p1_sites = _find_primer_bindings(p1_anneal, template, tpl_len, circular, max_mismatches)
    p2_sites = _find_primer_bindings(p2_anneal, template, tpl_len, circular, max_mismatches)

    if not p1_sites and not p2_sites:
        raise HTTPException(400, "Neither primer binds the template (even with mismatches)")
    if not p1_sites:
        raise HTTPException(400, f"Primer 1 does not bind the template")
    if not p2_sites:
        raise HTTPException(400, f"Primer 2 does not bind the template")

    # Find valid products: one fwd + one rev, facing each other
    products = []
    all_sites = [(1, s) for s in p1_sites] + [(2, s) for s in p2_sites]
    fwd_sites = [(pid, s) for pid, s in all_sites if s["strand"] == "fwd"]
    rev_sites = [(pid, s) for pid, s in all_sites if s["strand"] == "rev"]

    for fwd_pid, fwd in fwd_sites:
        for rev_pid, rev in rev_sites:
            if fwd_pid == rev_pid and len(fwd_sites) > 1 and len(rev_sites) > 1:
                continue  # prefer using different primers for fwd/rev

            # Product: from fwd binding start to rev binding end
            fwd_start = fwd["pos"]
            rev_end = rev["end"]

            if circular:
                if fwd_start <= rev_end:
                    amplicon_len = rev_end - fwd_start
                else:
                    amplicon_len = (tpl_len - fwd_start) + rev_end
            else:
                if fwd_start >= rev_end:
                    continue  # wrong orientation
                amplicon_len = rev_end - fwd_start

            if amplicon_len < 20 or amplicon_len > 50000:
                continue

            # Get tails for the correct primers
            if fwd_pid == 1:
                fwd_tail, rev_tail = p1_tail, p2_tail
                fwd_name, rev_name = primer1_name, primer2_name
            else:
                fwd_tail, rev_tail = p2_tail, p1_tail
                fwd_name, rev_name = primer2_name, primer1_name

            # Build product sequence
            if fwd_start <= rev_end or not circular:
                amplicon = template[fwd_start:rev_end]
            else:
                amplicon = template[fwd_start:] + template[:rev_end]

            rc_rev_tail = _reverse_complement(rev_tail.upper()) if rev_tail else ""
            product_seq = fwd_tail.lower() + amplicon.upper() + rc_rev_tail.lower()

            # Calculate Tms
            fwd_anneal = p1_anneal if fwd_pid == 1 else p2_anneal
            rev_anneal = p2_anneal if fwd_pid == 1 else p1_anneal
            fwd_tm = _calc_tm(fwd_anneal)
            rev_tm = _calc_tm(rev_anneal)

            products.append({
                "fwd_primer": fwd_name,
                "rev_primer": rev_name,
                "fwd_pos": fwd_start,
                "rev_pos": rev["pos"],
                "rev_end": rev_end,
                "fwd_strand": "fwd",
                "rev_strand": "rev",
                "fwd_mismatches": fwd["mismatches"],
                "rev_mismatches": rev["mismatches"],
                "amplicon_length": amplicon_len,
                "product_length": len(product_seq),
                "product_seq": product_seq,
                "fwd_tail": fwd_tail.lower(),
                "rev_tail_rc": rc_rev_tail.lower(),
                "fwd_tm": fwd_tm,
                "rev_tm": rev_tm,
                "tm_diff": round(abs(fwd_tm - rev_tm), 1),
                "total_mismatches": fwd["mismatches"] + rev["mismatches"],
            })

    if not products:
        raise HTTPException(400, "No valid PCR products found — primers may face the same direction or be too far apart")

    # Sort: exact matches first, then by total mismatches, then by amplicon size
    products.sort(key=lambda p: (p["total_mismatches"], p["amplicon_length"]))

    # Primary product: best scoring
    primary = products[0]

    # Remap annotations onto primary product
    product_anns = []
    src_anns = annotations or []
    fwd_s = primary["fwd_pos"]
    rev_e = primary["rev_end"]
    tail_offset = len(primary["fwd_tail"])
    for a in src_anns:
        a_start = a.get("start", 0)
        a_end = a.get("end", 0)
        if circular and fwd_s > rev_e:
            # Cross-origin product
            if a_start >= fwd_s:
                ns = tail_offset + (a_start - fwd_s)
                ne = tail_offset + (a_end - fwd_s)
            elif a_end <= rev_e:
                ns = tail_offset + (tpl_len - fwd_s) + a_start
                ne = tail_offset + (tpl_len - fwd_s) + a_end
            else:
                continue
        else:
            if a_end <= fwd_s or a_start >= rev_e:
                continue
            cs = max(a_start, fwd_s)
            ce = min(a_end, rev_e)
            ns = tail_offset + (cs - fwd_s)
            ne = tail_offset + (ce - fwd_s)
        if ne > ns and ne <= len(primary["product_seq"]):
            product_anns.append({
                "name": a.get("name", "?"), "start": ns, "end": ne,
                "direction": a.get("direction", 1), "color": a.get("color", "#95A5A6"),
                "type": a.get("type", "misc_feature"),
            })

    # Add primer annotations: annealing (solid) + overhang (transparent)
    fwd_anneal_len = len(p1_anneal if primary["fwd_primer"] == primer1_name else p2_anneal)
    rev_anneal_len = len(p2_anneal if primary["fwd_primer"] == primer1_name else p1_anneal)
    fwd_tail_len = len(primary["fwd_tail"])
    rev_tail_len = len(primary["rev_tail_rc"])
    prod_len = len(primary["product_seq"])

    # Forward primer overhang (5' tail — transparent)
    if fwd_tail_len > 0:
        product_anns.append({
            "name": primary["fwd_primer"] + " overhang",
            "start": 0, "end": fwd_tail_len,
            "direction": 1, "color": "rgba(41,128,185,0.25)", "type": "overhang",
        })
    # Forward primer annealing (solid)
    product_anns.append({
        "name": primary["fwd_primer"] + " (fwd)",
        "start": fwd_tail_len, "end": fwd_tail_len + fwd_anneal_len,
        "direction": 1, "color": "#2980b9", "type": "primer_bind",
    })
    # Reverse primer annealing (solid)
    product_anns.append({
        "name": primary["rev_primer"] + " (rev)",
        "start": prod_len - rev_tail_len - rev_anneal_len,
        "end": prod_len - rev_tail_len,
        "direction": -1, "color": "#8e44ad", "type": "primer_bind",
    })
    # Reverse primer overhang (3' RC tail — transparent)
    if rev_tail_len > 0:
        product_anns.append({
            "name": primary["rev_primer"] + " overhang",
            "start": prod_len - rev_tail_len, "end": prod_len,
            "direction": -1, "color": "rgba(142,68,173,0.25)", "type": "overhang",
        })

    primary["product_annotations"] = product_anns

    # Warnings
    warnings = []
    if primary["tm_diff"] > 3:
        warnings.append(f"Tm difference between primers is {primary['tm_diff']}°C")
    if primary["fwd_mismatches"] > 0:
        warnings.append(f"Forward primer has {primary['fwd_mismatches']} mismatch(es) with template")
    if primary["rev_mismatches"] > 0:
        warnings.append(f"Reverse primer has {primary['rev_mismatches']} mismatch(es) with template")

    off_targets = products[1:10] if len(products) > 1 else []
    if off_targets:
        warnings.append(f"{len(products) - 1} additional off-target product(s) possible")

    return {
        "primary": primary,
        "off_targets": [{"amplicon_length": p["amplicon_length"], "product_length": p["product_length"],
                        "fwd_pos": p["fwd_pos"], "rev_pos": p["rev_pos"],
                        "fwd_mismatches": p["fwd_mismatches"], "rev_mismatches": p["rev_mismatches"],
                        "fwd_primer": p["fwd_primer"], "rev_primer": p["rev_primer"]}
                       for p in off_targets],
        "p1_bindings": len(p1_sites),
        "p2_bindings": len(p2_sites),
        "total_products": len(products),
        "warnings": warnings,
    }

# ---------------------------------------------------------------------------
# Custom Primer Evaluation
# ---------------------------------------------------------------------------
def evaluate_custom_primer(template_seq, start, end, direction, tail="", tail_orientation="oligo"):
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template_seq)
    tail = (tail or "").replace(" ", "").replace("\n", "")

    if start < 0 or end < 0 or start >= tpl_len or end > tpl_len:
        raise HTTPException(400, f"Positions out of range (0-{tpl_len})")
    if start >= end:
        raise HTTPException(400, "Start must be less than end")
    if direction not in ("forward", "reverse"):
        raise HTTPException(400, "Direction must be 'forward' or 'reverse'")

    region = template_seq[start:end]

    if direction == "reverse":
        anneal_seq = _reverse_complement(region)
    else:
        anneal_seq = region

    # Handle tail orientation: if user entered in product orientation, RC for reverse primers
    effective_tail = tail
    if tail and tail_orientation == "product" and direction == "reverse":
        effective_tail = _reverse_complement(tail.upper())

    full_seq = effective_tail.lower() + anneal_seq.upper()
    anneal_tm = _calc_tm(anneal_seq)
    quality = _check_primer_quality(anneal_seq, anneal_tm)
    _hd_dg, _hd_tm = _calc_homodimer_dg(full_seq, temp_c=25.0)
    hairpin = _has_hairpin(full_seq, annealing_tm=anneal_tm) if tail else _has_hairpin(full_seq)

    return {
        "primer_seq": anneal_seq,
        "full_seq": full_seq,
        "tail": effective_tail.lower(),
        "tail_input": tail,
        "tail_orientation": tail_orientation,
        "annealing": anneal_seq.upper(),
        "template_region": region,
        "start": start,
        "end": end,
        "direction": direction,
        "tm": anneal_tm,
        "length": len(full_seq),
        "gc_percent": round(_gc_content(anneal_seq) * 100, 1),
        "delta_g": _calc_delta_g(anneal_seq, temp_c=anneal_tm if anneal_tm > 0 else 60.0),
        "homodimer_dg": _hd_dg,
        "homodimer_tm": _hd_tm,
        "hairpin": hairpin,
        "self_dimer": _has_self_dimer(full_seq),
        "quality": quality,
    }


# ---------------------------------------------------------------------------
# PCR Primer Design
# ---------------------------------------------------------------------------
def design_pcr_primers(template_seq, target_start, target_end, tm_target=62.0, criteria=None):
    _crit = _resolve_criteria(criteria)
    template_seq = template_seq.upper().replace(" ", "").replace("\n", "")
    tpl_len = len(template_seq)

    if target_start < 0 or target_end > tpl_len or target_start >= target_end:
        raise HTTPException(400, f"Invalid target region ({target_start}-{target_end}), template is {tpl_len}bp")

    # Design forward primer candidates at target_start (no tail for PCR)
    fwd_candidates = _generate_primer_candidates(template_seq, target_start, "forward", "", tm_target, criteria=_crit)
    fwd = _pick_best_with_alternatives(fwd_candidates, "Forward")

    # Design reverse primer candidates at target_end
    rev_candidates = _generate_primer_candidates(template_seq, target_end, "reverse", "", tm_target, criteria=_crit)
    rev = _pick_best_with_alternatives(rev_candidates, "Reverse")

    total_amplicon = target_end - target_start

    # Tm difference between primers
    tm_diff = abs(fwd["tm"] - rev["tm"])
    warnings = []
    _dg_fail = _crit["dimer_dg_fail"]
    if tm_diff > _crit["tm_deviation"]:
        warnings.append(f"Tm difference between primers is {tm_diff:.1f}°C — ideally <{_crit['tm_deviation']}°C")
    if fwd.get("hairpin"):
        warnings.append("Forward primer may form hairpin")
    if fwd.get("homodimer_dg", 0) < _dg_fail:
        warnings.append(f"Forward primer has strong self-dimer (ΔG = {fwd['homodimer_dg']} kcal/mol)")
    if rev.get("hairpin"):
        warnings.append("Reverse primer may form hairpin")
    if rev.get("homodimer_dg", 0) < _dg_fail:
        warnings.append(f"Reverse primer has strong self-dimer (ΔG = {rev['homodimer_dg']} kcal/mol)")
    het_dg = _calc_heterodimer_dg(fwd.get("full_seq", ""), rev.get("full_seq", ""))
    if het_dg < _dg_fail:
        warnings.append(f"Strong heterodimer between primers (\u0394G = {het_dg} kcal/mol)")
    elif het_dg < _crit["dimer_dg_warn"]:
        warnings.append(f"Moderate heterodimer between primers (\u0394G = {het_dg} kcal/mol)")

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
def design_seq_primers(template_seq, region_start, region_end, read_length=900, tm_target=62.0, criteria=None):
    _crit = _resolve_criteria(criteria)
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
        candidates = _generate_primer_candidates(template_seq, pos, "forward", "", tm_target, criteria=_crit)
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
                   target_start=None, target_end=None,
                   start_pos=None, end_pos=None):
    """Build a product sequence with remapped annotations.
    Returns SeqViz-compatible dict with name, seq, annotations, length, topology."""
    template_seq = template_seq.upper()
    anns = annotations or []

    if mode == "kld":
        # Support both old single insertion_pos and new start/end range
        kld_start = start_pos if start_pos is not None else (insertion_pos if insertion_pos is not None else None)
        kld_end = end_pos if end_pos is not None else kld_start
        if kld_start is None or insert_seq is None:
            raise HTTPException(400, "KLD mode requires start_pos (or insertion_pos) and insert_seq")
        insert_seq = insert_seq.upper().replace(" ", "").replace("\n", "")
        ins_len = len(insert_seq)
        deleted_len = kld_end - kld_start  # 0 for pure insertion
        product_seq = template_seq[:kld_start] + insert_seq + template_seq[kld_end:]
        if deleted_len > 0 and ins_len > 0:
            product_name = f"{template_name}_KLD_replace_{kld_start}-{kld_end}_{insert_label}"
        elif deleted_len > 0:
            product_name = f"{template_name}_KLD_del_{kld_start}-{kld_end}"
        else:
            product_name = f"{template_name}_KLD_{insert_label}"
        topology = template_topology  # stays circular

        # Net shift = insert_length - deleted_length
        net_shift = ins_len - deleted_len

        # Remap annotations
        new_anns = []
        for a in anns:
            s, e = a.get("start", 0), a.get("end", 0)
            if e <= kld_start:
                # Entirely before affected region — unchanged
                new_anns.append(dict(a))
            elif s >= kld_end:
                # Entirely after affected region — shift by net change
                na = dict(a)
                na["start"] = s + net_shift
                na["end"] = e + net_shift
                new_anns.append(na)
            else:
                # Overlaps affected region — mark as disrupted
                na = dict(a)
                na["end"] = max(na["start"] + 1, e + net_shift)
                na["name"] = a.get("name", "?") + " (disrupted)"
                na["color"] = "#e74c3c"
                new_anns.append(na)

        # Add insert as a feature (only if there's actual insert sequence)
        if ins_len > 0:
            new_anns.append({
                "name": insert_label or "insert",
                "start": kld_start,
                "end": kld_start + ins_len,
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
                  tm_target: float = 62.0, criteria: dict = None, gblock_mode: bool = False,
                  gblock_indices: list = None) -> dict:
    """Design a Gibson assembly — primers with overlapping tails for each junction."""
    _crit = _resolve_criteria(criteria)
    if len(fragments) < 2:
        raise HTTPException(400, "Gibson assembly requires at least 2 fragments")
    n_frags = len(fragments)
    if overlap_length < 20 or overlap_length > 60:
        raise HTTPException(400, "Overlap length must be 20-60 bp")

    seqs = []
    for f in fragments:
        s = f["seq"].upper().replace(" ", "").replace("\n", "")
        if len(s) < 20:
            raise HTTPException(400, f"Fragment '{f['name']}' is too short (min 20bp)")
        seqs.append(s)

    warnings = []

    # ── Stop / start codon removal ──
    STOP_CODONS_SET = {"TAA", "TAG", "TGA"}
    for i, f in enumerate(fragments):
        if f.get("remove_stop"):
            last3 = seqs[i][-3:]
            if last3 in STOP_CODONS_SET:
                seqs[i] = seqs[i][:-3]
                warnings.append(f"'{f['name']}': removed 3ʹ stop codon ({last3}) for tag readthrough")
            else:
                warnings.append(f"⚠ '{f['name']}': remove_stop enabled but last 3bp ({last3}) is not a stop codon")
        if f.get("remove_start"):
            first3 = seqs[i][:3]
            if first3 == "ATG":
                seqs[i] = seqs[i][3:]
                # Shift annotations by -3 so they stay aligned
                if f.get("annotations"):
                    for a in f["annotations"]:
                        a["start"] = max(0, a.get("start", 0) - 3)
                        a["end"] = max(0, a.get("end", 0) - 3)
                warnings.append(f"'{f['name']}': removed 5ʹ start codon (ATG) for N-terminal tag fusion")
            else:
                warnings.append(f"⚠ '{f['name']}': remove_start enabled but first 3bp ({first3}) is not ATG")

    junctions = []
    all_primers = []
    ol_per_side = overlap_length  # full overlap per side (NEB: "15-25bp overlap with adjacent fragment")

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

        # Overlap = last ol_per_side of upstream + first ol_per_side of downstream
        up_tail = up_seq[-ol_per_side:] if len(up_seq) >= ol_per_side else up_seq
        down_tail = down_seq[:ol_per_side] if len(down_seq) >= ol_per_side else down_seq
        overlap_seq = up_tail + down_tail

        # Check Tm of each overlap tail individually (relevant for Gibson annealing)
        up_tm = _calc_tm(up_tail) if len(up_tail) >= 8 else 0
        down_tm = _calc_tm(down_tail) if len(down_tail) >= 8 else 0
        overlap_tm = round(min(up_tm, down_tm), 1)  # weakest side determines junction strength
        if overlap_tm < 48:
            warnings.append(f"Junction {up_name}→{down_name} overlap Tm ({overlap_tm}°C) is low — may reduce assembly efficiency")
        elif overlap_tm > 72:
            warnings.append(f"Junction {up_name}→{down_name} overlap Tm ({overlap_tm}°C) is high")

        # Determine which fragments carry overlaps
        down_no_ol = fragments[down_idx].get("no_overlap", False)
        up_no_ol = fragments[up_idx].get("no_overlap", False)

        # Forward primer for downstream fragment: tail = end of upstream (unless downstream has no_overlap)
        fwd_tail = "" if down_no_ol else up_tail
        fwd_extras = [s for si, s in enumerate(seqs) if si != down_idx]
        fwd_candidates = _generate_primer_candidates(
            template=down_seq, pos=0, direction="forward", tail=fwd_tail, 
            tm_target=tm_target, min_len=12, max_len=60, max_total=60, criteria=_crit,
            extra_templates=fwd_extras
        )
        fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{down_name}_Fwd", max_alternatives=None)

        # Reverse primer for upstream fragment: tail = RC of start of downstream (unless upstream has no_overlap)
        rev_tail = "" if up_no_ol else _reverse_complement(down_tail)
        rev_extras = [s for si, s in enumerate(seqs) if si != up_idx]
        rev_candidates = _generate_primer_candidates(
            template=up_seq, pos=len(up_seq), direction="reverse", tail=rev_tail, 
            tm_target=tm_target, min_len=12, max_len=60, max_total=60, criteria=_crit,
            extra_templates=rev_extras
        )
        rev_primer = _pick_best_with_alternatives(rev_candidates, f"{up_name}_Rev", max_alternatives=None)

        # Warn if both sides have no_overlap at this junction
        if down_no_ol and up_no_ol:
            warnings.append(f"Junction {up_name}\u2192{down_name}: both fragments have no-overlap \u2014 no homology at this junction!")

        for p, pname in [(fwd_primer, f"{down_name}_Fwd"), (rev_primer, f"{up_name}_Rev")]:
            if p and p.get("hairpin"):
                warnings.append(f"{pname} may form hairpin")
            if p and p.get("off_target_count", 0) > 0:
                warnings.append(f"{pname} has {p['off_target_count']} off-target binding site(s) — risk of mispriming")
            if p and p.get("homodimer_dg", 0) < _crit["dimer_dg_fail"]:
                warnings.append(f"{pname} has strong self-dimer (ΔG = {p['homodimer_dg']} kcal/mol)")
        # NOTE: cross-junction heterodimer (fwd vs rev at same junction) is NOT checked
        # because these primers are in different PCR tubes. The designed overlap tails
        # are complementary by design and produce misleading ΔG values (-30 to -40).
        # Within-fragment PCR pair checks are done after the junction loop.

        junctions.append({
            "name": f"{up_name}→{down_name}",
            "overlap_seq": overlap_seq,
            "overlap_tm": overlap_tm,
            "fwd_primer": fwd_primer,
            "rev_primer": rev_primer,
        })
        all_primers.append(fwd_primer)
        all_primers.append(rev_primer)

    # ── Within-fragment heterodimer check (actual PCR pairs) ──
    # Fragment i is amplified by: fwd from junction (i-1) + rev from junction i
    # These are the primers that share a PCR tube, so heterodimer matters here.
    for i in range(n):
        # Find fwd primer for fragment i: it's the fwd_primer at junction (i-1)%n
        # (where fragment i is the downstream fragment)
        fwd_junc_idx = (i - 1 + junction_count) % junction_count if circular else i - 1
        rev_junc_idx = i if i < junction_count else -1

        if not circular:
            # Linear: first fragment has no fwd junction, last has no rev junction
            if i == 0:
                fwd_junc_idx = -1
            if i == n - 1:
                rev_junc_idx = -1

        frag_fwd = junctions[fwd_junc_idx]["fwd_primer"] if 0 <= fwd_junc_idx < len(junctions) else None
        frag_rev = junctions[rev_junc_idx]["rev_primer"] if 0 <= rev_junc_idx < len(junctions) else None

        if frag_fwd and frag_rev:
            # Check using annealing regions only — tails are from different junctions
            # and won't form problematic dimers (they're not complementary to each other)
            het_dg = _calc_heterodimer_dg(frag_fwd.get("full_seq", ""), frag_rev.get("full_seq", ""))
            if het_dg < _crit["dimer_dg_fail"]:
                fname = fragments[i]["name"]
                warnings.append(f"{fname} PCR pair: strong heterodimer (\u0394G = {het_dg} kcal/mol) — primers may form dimer during amplification")
            elif het_dg < _crit["dimer_dg_warn"]:
                fname = fragments[i]["name"]
                warnings.append(f"{fname} PCR pair: moderate heterodimer (\u0394G = {het_dg} kcal/mol)")

    # ── Frame check for tag readthrough ──
    for i, f in enumerate(fragments):
        if f.get("remove_stop") or f.get("remove_start"):
            if overlap_length % 3 != 0:
                warnings.append(
                    f"⚠ '{f['name']}': overlap length ({overlap_length}bp) is not divisible by 3 — "
                    f"C-terminal/N-terminal tag may be out of frame (consider {overlap_length - (overlap_length % 3)} or {overlap_length + 3 - (overlap_length % 3)}bp)"
                )

    # Build product sequence (concatenate all fragments)
    product_seq = "".join(seqs)
    product_annotations = []
    frag_colors = ["#4682B4", "#2ecc71", "#e67e22", "#9b59b6", "#e74c3c", "#1abc9c"]
    offset = 0
    for i, f in enumerate(fragments):
        flen = len(seqs[i])
        # Fragment boundary annotation
        product_annotations.append({
            "name": f["name"], "start": offset, "end": offset + flen,
            "direction": 1, "color": frag_colors[i % len(frag_colors)],
            "type": "fragment",
        })
        # Remap source annotations from the fragment onto the product
        src_anns = f.get("annotations") or []
        for a in src_anns:
            a_start = a.get("start", 0)
            a_end = a.get("end", 0)
            if a_end <= a_start or a_end > flen:
                continue  # skip invalid
            product_annotations.append({
                "name": a.get("name", "?"),
                "start": offset + a_start,
                "end": offset + a_end,
                "direction": a.get("direction", 1),
                "color": a.get("color", "#95A5A6"),
                "type": a.get("type", "misc_feature"),
            })
        offset += flen

    # ── Compute extended fragments for any gBlock-marked fragments ──
    gb_set = set(gblock_indices or []) if (gblock_mode or gblock_indices) else set()
    extended_fragments = []
    if gb_set:
        for i, f in enumerate(fragments):
            if i not in gb_set:
                continue
            fseq = seqs[i]
            fname = f["name"]
            f_no_ol = f.get("no_overlap", False)

            # Find 5' overlap (from upstream junction) — skip if no_overlap
            prefix = ""
            if not f_no_ol and (circular or i > 0):
                junc_idx = (i - 1) % len(junctions) if circular else i - 1
                if 0 <= junc_idx < len(junctions):
                    # This fragment is the downstream of junction junc_idx
                    # 5' overhang = end of upstream fragment
                    up_idx = (i - 1) % n_frags
                    prefix = seqs[up_idx][-ol_per_side:] if len(seqs[up_idx]) >= ol_per_side else seqs[up_idx]

            # Find 3' overlap (from downstream junction) — skip if no_overlap
            suffix = ""
            if not f_no_ol and (circular or i < n_frags - 1):
                junc_idx = i % len(junctions) if circular else i
                if 0 <= junc_idx < len(junctions):
                    # This fragment is the upstream of junction junc_idx
                    # 3' overhang = start of downstream fragment
                    down_idx = (i + 1) % n_frags
                    suffix = seqs[down_idx][:ol_per_side] if len(seqs[down_idx]) >= ol_per_side else seqs[down_idx]

            extended_seq = prefix.lower() + fseq.upper() + suffix.lower()

            # Remap annotations
            ext_anns = []
            prefix_len = len(prefix)
            # 5' overhang annotation
            if prefix_len > 0:
                ext_anns.append({
                    "name": "5\u2032 overlap", "start": 0, "end": prefix_len,
                    "direction": 1, "color": "rgba(41,128,185,0.3)", "type": "overhang",
                })
            # Original fragment features
            for a in (f.get("annotations") or []):
                a_s, a_e = a.get("start", 0), a.get("end", 0)
                if a_e > a_s:
                    ext_anns.append({
                        "name": a.get("name", "?"),
                        "start": prefix_len + a_s, "end": prefix_len + a_e,
                        "direction": a.get("direction", 1),
                        "color": a.get("color", "#95A5A6"),
                        "type": a.get("type", "misc_feature"),
                    })
            # Fragment body annotation
            ext_anns.append({
                "name": fname, "start": prefix_len, "end": prefix_len + len(fseq),
                "direction": 1, "color": frag_colors[i % len(frag_colors)], "type": "fragment",
            })
            # 3' overhang annotation
            suffix_len = len(suffix)
            if suffix_len > 0:
                ext_anns.append({
                    "name": "3\u2032 overlap", "start": prefix_len + len(fseq),
                    "end": prefix_len + len(fseq) + suffix_len,
                    "direction": 1, "color": "rgba(142,68,173,0.3)", "type": "overhang",
                })

            extended_fragments.append({
                "name": fname,
                "original_length": len(fseq),
                "extended_length": len(extended_seq),
                "extended_seq": extended_seq,
                "prefix": prefix.lower(),
                "suffix": suffix.lower(),
                "annotations": ext_anns,
            })

    return {
        "junctions": junctions,
        "primers": all_primers,
        "product_length": len(product_seq),
        "product_seq": product_seq,
        "product_annotations": product_annotations,
        "num_fragments": len(fragments),
        "warnings": warnings,
        "gblock_indices": list(gb_set) if gb_set else [],
        "extended_fragments": extended_fragments if extended_fragments else [],
    }


def _ensure_gc_clamp(seq, max_len=60):
    """Append a G to the 3' end if it doesn't already end with G or C."""
    if seq[-1] in "GC":
        return seq
    if len(seq) < max_len:
        return seq + "G"
    return seq


def _has_hairpin(seq, min_stem=4, min_loop=3, dv_conc=0.0, annealing_tm=None):
    """Check whether seq can form a hairpin (stem-loop).
    Uses primer3 for accuracy, falls back to pattern search.
    If annealing_tm is provided, only flags hairpins with Tm within 10°C of it
    (IDT-style: hairpins that melt well below annealing temp are irrelevant)."""
    try:
        import primer3
        result = primer3.calc_hairpin(
            seq.upper(), mv_conc=50, dv_conc=dv_conc, dntp_conc=0, dna_conc=250, temp_c=25)
        if not result.structure_found or result.dg >= -2000:
            return False
        # If we know the annealing Tm, only flag if hairpin persists near it
        if annealing_tm is not None and hasattr(result, 'tm'):
            return result.tm > (annealing_tm - 10)
        return True  # conservative fallback: flag any stable hairpin
    except Exception:
        pass
    # Fallback
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

def _calc_homodimer_dg(seq: str, temp_c: float = 25.0, dv_conc: float = 0.0):
    """Calculate self-dimer ΔG using primer3 (same engine as IDT OligoAnalyzer).
    Returns (dg_kcal, tm_celsius) tuple. Falls back to NN sliding-window (tm=None)."""
    seq = seq.upper()
    if len(seq) < 4:
        return (0.0, None)
    try:
        import primer3
        result = primer3.calc_homodimer(
            seq, mv_conc=50, dv_conc=dv_conc, dntp_conc=0, dna_conc=250, temp_c=temp_c)
        dg = round(result.dg / 1000.0, 2)
        tm = round(result.tm, 1) if hasattr(result, 'tm') and result.tm > 0 else None
        return (dg, tm)
    except Exception:
        pass

    # Fallback: NN sliding-window (less accurate, ignores mismatches)
    rc = _reverse_complement(seq)
    n = len(seq)
    best_dg = 0.0
    temp_k = temp_c + 273.15
    INIT_DH = 0.2
    INIT_DS = -5.7

    for offset in range(-(n - 4), n - 3):
        if offset < 0:
            s_start, r_start = 0, -offset
        else:
            s_start, r_start = offset, 0
        overlap_len = min(n - s_start, n - r_start)
        if overlap_len < 4:
            continue

        stretch_dh = 0.0
        stretch_ds = 0.0
        stretch_len = 0
        alignment_total_dg = 0.0

        for i in range(overlap_len - 1):
            sb = seq[s_start + i]
            rb = rc[r_start + i]
            sb2 = seq[s_start + i + 1]
            rb2 = rc[r_start + i + 1]
            if sb == rb and sb2 == rb2:
                pair = sb + sb2
                if pair in NN_THERMO:
                    h, s = NN_THERMO[pair]
                    stretch_dh += h
                    stretch_ds += s
                stretch_len += 1
            else:
                if stretch_len >= 1:
                    dg = (stretch_dh + INIT_DH) - (temp_k * (stretch_ds + INIT_DS) / 1000.0)
                    if dg < 0:
                        alignment_total_dg += dg
                stretch_dh = 0.0
                stretch_ds = 0.0
                stretch_len = 0

        if stretch_len >= 1:
            dg = (stretch_dh + INIT_DH) - (temp_k * (stretch_ds + INIT_DS) / 1000.0)
            if dg < 0:
                alignment_total_dg += dg

        if alignment_total_dg < best_dg:
            best_dg = alignment_total_dg

    return (round(best_dg, 2), None)  # no Tm from fallback


def _calc_heterodimer_dg(seq1: str, seq2: str, temp_c: float = 25.0, dv_conc: float = 0.0) -> float:
    """Calculate heterodimer ΔG between two primers using primer3 (preferred)
    or NN sliding-window fallback. Returns kcal/mol (more negative = stronger dimer).
    Catches 3'/3' extension dimers, 3'/internal mispriming, and 5' tail complementarity."""
    seq1 = seq1.upper()
    seq2 = seq2.upper()
    if len(seq1) < 4 or len(seq2) < 4:
        return 0.0
    try:
        import primer3
        result = primer3.calc_heterodimer(
            seq1, seq2, mv_conc=50, dv_conc=dv_conc, dntp_conc=0, dna_conc=250, temp_c=temp_c)
        return round(result.dg / 1000.0, 2)  # cal/mol → kcal/mol
    except Exception:
        pass

    # Fallback: slide RC(seq2) along seq1, find best NN alignment
    rc2 = _reverse_complement(seq2)
    n1 = len(seq1)
    n2 = len(rc2)
    best_dg = 0.0
    temp_k = temp_c + 273.15
    INIT_DH = 0.2
    INIT_DS = -5.7

    for offset in range(-(n2 - 4), n1 - 3):
        if offset < 0:
            s1_start, s2_start = 0, -offset
        else:
            s1_start, s2_start = offset, 0
        overlap_len = min(n1 - s1_start, n2 - s2_start)
        if overlap_len < 4:
            continue

        stretch_dh = 0.0
        stretch_ds = 0.0
        stretch_len = 0
        alignment_total_dg = 0.0

        for i in range(overlap_len - 1):
            b1 = seq1[s1_start + i]
            b2 = rc2[s2_start + i]
            b1n = seq1[s1_start + i + 1]
            b2n = rc2[s2_start + i + 1]
            if b1 == b2 and b1n == b2n:
                pair = b1 + b1n
                if pair in NN_THERMO:
                    h, s = NN_THERMO[pair]
                    stretch_dh += h
                    stretch_ds += s
                stretch_len += 1
            else:
                if stretch_len >= 1:
                    dg = (stretch_dh + INIT_DH) - (temp_k * (stretch_ds + INIT_DS) / 1000.0)
                    if dg < 0:
                        alignment_total_dg += dg
                stretch_dh = 0.0
                stretch_ds = 0.0
                stretch_len = 0

        if stretch_len >= 1:
            dg = (stretch_dh + INIT_DH) - (temp_k * (stretch_ds + INIT_DS) / 1000.0)
            if dg < 0:
                alignment_total_dg += dg

        if alignment_total_dg < best_dg:
            best_dg = alignment_total_dg

    return round(best_dg, 2)


def _self_comp_penalty(seq: str) -> float:
    """Fast O(L) penalty for self-complementary regions in a primer.
    Catches palindromes (GGATCC, AGATCT, etc.) that cause homodimers,
    especially dangerous at the 3' end where polymerase extends.
    Returns 0 (clean) to ~20+ (severe self-complementarity)."""
    seq = seq.upper()
    n = len(seq)
    if n < 6:
        return 0.0
    rc = _reverse_complement(seq)
    penalty = 0.0

    # Check for palindromic stretches (seq[i:i+w] == RC[i:i+w])
    # These are the exact regions that form homodimers
    for w in range(4, min(9, n // 2 + 1)):
        for i in range(n - w + 1):
            kmer = seq[i:i + w]
            if kmer == _reverse_complement(kmer):
                # It's a palindrome — penalty scaled by length and 3' proximity
                base_pen = (w - 3) * 1.5  # 4bp=1.5, 5bp=3, 6bp=4.5, 7bp=6, 8bp=7.5
                # 3' end is worse (last 8 bases)
                dist_from_3 = n - (i + w)
                if dist_from_3 < 8:
                    base_pen *= 2.0
                penalty += base_pen

    # Also check for 3' end matching the RC of anywhere else in the primer
    tail_3 = seq[-6:]
    rc_tail = _reverse_complement(tail_3)
    if rc_tail in seq[:-4]:
        penalty += 5.0

    return min(penalty, 30.0)  # cap


def _resolve_criteria(criteria: dict = None) -> dict:
    """Merge user-provided criteria with defaults. Used by all primer design functions."""
    _crit = {
        "dimer_dg_max": -6.0, "dimer_dg_warn": -6.0, "dimer_dg_fail": -9.0,
        "tm_deviation": 3.0, "gc_min": 40.0, "gc_max": 60.0,
        "penalize_hairpin": True, "gc_clamp_weight": 6.0, "junction_gc_weight": 5.0,
    }
    if criteria:
        _crit.update({k: v for k, v in criteria.items() if v is not None})
    return _crit


def _gc_clamp_penalty(seq: str, weight: float = 6.0) -> float:
    """Soft penalty for weak 3' GC clamp.
    0 G/C in last 2 bases → full weight (bad: no clamp)
    1 G/C in last 2 bases → 0 (acceptable clamp)
    2 G/C with strong 3' run (≥4 of last 5) → weight/3 (mispriming risk)
    Returns 0.0 when weight is 0 (feature off)."""
    if weight <= 0 or len(seq) < 2:
        return 0.0
    s = seq.upper()
    last2 = s[-2:]
    gc_count = sum(1 for b in last2 if b in "GC")
    if gc_count == 0:
        return weight  # no clamp at all
    if gc_count == 2 and len(s) >= 5 and sum(1 for b in s[-5:] if b in "GC") >= 4:
        return round(weight / 3.0, 2)  # strong 3' GC run → mispriming
    return 0.0  # good clamp


def _generate_primer_candidates(template: str, pos: int, direction: str, tail: str,
                                 tm_target: float, min_len: int = 18, max_len: int = 40,
                                 max_total: int = 60, lightweight: bool = False,
                                 mg_conc: float = 0.0, criteria: dict = None,
                                 extra_templates: list = None) -> list:
    """Generate multiple primer candidates with different annealing lengths.
    Returns a list of candidate dicts sorted by score (best first), each containing
    full primer properties including dimer/hairpin/ΔG analysis.
    
    lightweight=True skips expensive homodimer/hairpin/quality analysis — used for
    fast scanning in the optimize loop.  Only Tm and GC are computed.
    
    extra_templates: optional list of additional sequences to check for off-target
    binding (e.g. other fragments in an assembly)."""
    tpl_len = len(template)
    candidates = []
    _cr = criteria or {}
    _dg_warn = _cr.get("dimer_dg_warn", -6.0)
    _pen_hp = _cr.get("penalize_hairpin", True)
    _gc_w = _cr.get("gc_clamp_weight", 6.0)

    # Build search pool for off-target checking (template + extras, both strands)
    tpl_upper = template.upper()
    tpl_rc = _reverse_complement(tpl_upper)
    _search_seqs = [tpl_upper, tpl_rc]
    for et in (extra_templates or []):
        et_upper = et.upper()
        _search_seqs.append(et_upper)
        _search_seqs.append(_reverse_complement(et_upper))

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

        full_seq = tail.lower() + anneal_seq.upper()
        tm = _calc_tm(anneal_seq)
        gc = round(_gc_content(full_seq) * 100, 1)

        # Score: lower is better
        tm_penalty = abs(tm - tm_target) * 2.0
        gc_penalty = max(0, abs(gc - 50) - 10) * 0.5
        clamp_penalty = _gc_clamp_penalty(full_seq, _gc_w)

        if lightweight:
            # Fast path: skip expensive primer3 analysis but check palindromes
            selfcomp_pen = _self_comp_penalty(full_seq)
            score = tm_penalty + gc_penalty + selfcomp_pen + clamp_penalty
            candidates.append({
                "full_seq": full_seq,
                "tail": tail.lower(),
                "annealing": anneal_seq,
                "tm": tm,
                "length": len(full_seq),
                "gc_percent": gc,
                "selfcomp_penalty": round(selfcomp_pen, 1),
                "score": round(score, 2),
            })
        else:
            # Full path: complete thermodynamic analysis
            dg = _calc_delta_g(anneal_seq, temp_c=tm if tm > 0 else 60.0)
            homodimer_dg, homodimer_tm = _calc_homodimer_dg(full_seq, temp_c=25.0, dv_conc=mg_conc)
            hairpin = _has_hairpin(full_seq, dv_conc=mg_conc, annealing_tm=tm_target)
            self_dimer = _has_self_dimer(full_seq)
            quality = _check_primer_quality(anneal_seq, tm, criteria=criteria, tm_target=tm_target)

            # Off-target check: search for annealing in all templates (both strands)
            # Strategy: check full annealing first (definite off-target if found elsewhere),
            # then progressively shorter 3' suffixes (partial off-target risk).
            # Longer annealing is more specific → fewer off-targets → better score.
            off_target_count = 0
            ann_upper = anneal_seq.upper()
            ann_len = len(ann_upper)

            if ann_len >= 15:
                # Level 1: full annealing exact match (strongest off-target signal)
                full_hits = 0
                for _ss in _search_seqs:
                    _start = 0
                    while True:
                        _hit = _ss.find(ann_upper, _start)
                        if _hit < 0:
                            break
                        full_hits += 1
                        _start = _hit + 1
                full_off = max(0, full_hits - 1)  # subtract intended site
                off_target_count = full_off

                # Level 2: if no full match off-target, check last 15bp (weaker signal)
                if full_off == 0 and ann_len > 15:
                    _3p = ann_upper[-15:]
                    partial_hits = 0
                    for _ss in _search_seqs:
                        _start = 0
                        while True:
                            _hit = _ss.find(_3p, _start)
                            if _hit < 0:
                                break
                            partial_hits += 1
                            _start = _hit + 1
                    partial_off = max(0, partial_hits - 1)
                    # Partial off-targets get reduced penalty (longer annealing reduces risk)
                    off_target_count = partial_off

            # Penalty scales: full-length off-target is severe, partial is moderate
            # Longer annealing that eliminates off-targets → lower penalty → preferred
            off_target_penalty = off_target_count * 15.0
            dimer_penalty = max(0, -homodimer_dg + _dg_warn) * 3.0
            if homodimer_tm is not None and homodimer_tm < (tm_target - 10):
                dimer_penalty *= 0.2  # dimer melts well below annealing — discount
            hairpin_penalty = (5.0 if hairpin else 0.0) if _pen_hp else 0.0
            score = tm_penalty + dimer_penalty + hairpin_penalty + gc_penalty + clamp_penalty + off_target_penalty

            candidates.append({
                "full_seq": full_seq,
                "tail": tail.lower(),
                "annealing": anneal_seq,
                "tm": tm,
                "length": len(full_seq),
                "gc_percent": gc,
                "delta_g": dg,
                "homodimer_dg": homodimer_dg,
                "homodimer_tm": homodimer_tm,
                "hairpin": hairpin,
                "self_dimer": self_dimer,
                "quality": quality,
                "off_target_count": off_target_count,
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
                       tm_target: float = 62.0, criteria: dict = None) -> dict:
    """Design a Golden Gate assembly with type IIS enzyme.

    Supports positional bins — each bin holds 1+ fragment options.
    Overhangs are assigned per junction (between bins), so every fragment
    in a given bin gets the same flanking overhangs, enabling combinatorial
    assembly in a single reaction.

    If `bins` is None but `fragments` is provided, each fragment becomes a
    single-option bin (backward compatibility).
    """
    _crit = _resolve_criteria(criteria)
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
    STOP_CODONS_SET = {"TAA", "TAG", "TGA"}
    for b in bins:
        for f in b["fragments"]:
            s = f["seq"].upper().replace(" ", "").replace("\n", "")
            # Stop / start codon removal
            if f.get("remove_stop"):
                last3 = s[-3:]
                if last3 in STOP_CODONS_SET:
                    s = s[:-3]
                    warnings.append(f"'{f['name']}': removed 3ʹ stop codon ({last3}) for tag readthrough")
                else:
                    warnings.append(f"⚠ '{f['name']}': remove_stop enabled but last 3bp ({last3}) is not a stop codon")
            if f.get("remove_start"):
                first3 = s[:3]
                if first3 == "ATG":
                    s = s[3:]
                    warnings.append(f"'{f['name']}': removed 5ʹ start codon (ATG) for N-terminal tag fusion")
                else:
                    warnings.append(f"⚠ '{f['name']}': remove_start enabled but first 3bp ({first3}) is not ATG")
            f["_seq"] = s  # store cleaned version
            if len(s) < 15:
                raise HTTPException(400, f"Fragment '{f['name']}' in bin '{b['name']}' is too short (min 15bp)")
            positions = _check_internal_sites(s, site, rc_site)
            if positions:
                internal_sites.append({"fragment": f["name"], "bin": b["name"], "positions": positions})
                warnings.append(f"'{f['name']}' (bin {b['name']}) has {len(positions)} internal {enzyme} site(s)")

    # Vector check — detect pre-made GG cloning vectors with existing enzyme sites
    vec_seq = None
    vec_precut = False
    vec_left_oh = None   # 5' boundary overhang (first bin's left)
    vec_right_oh = None  # 3' boundary overhang (last bin's right)
    vec_tag_info = None  # tag readthrough detection results
    if vector and vector.get("seq"):
        vec_seq = vector["seq"].upper().replace(" ", "").replace("\n", "")
        vec_sites = _find_type_iis_sites(vec_seq, site, rc_site)

        if len(vec_sites) == 2:
            # ── Pre-made GG vector with existing cloning cassette ──
            vec_precut = True
            s1, s2 = vec_sites[0], vec_sites[1]
            cut1 = _compute_sticky_end(vec_seq, s1, enz)
            cut2 = _compute_sticky_end(vec_seq, s2, enz)
            if cut1 and cut2:
                # Determine orientation: the site that produces a "right" sticky end
                # near the 5' boundary gives us the left overhang for the first bin,
                # and vice versa. Sort by cut position.
                cuts_sorted = sorted([cut1, cut2], key=lambda c: c["cut_pos"])
                # 5' cut (first in sequence) → its sticky end is the left overhang of bin 0
                # 3' cut (second in sequence) → its sticky end is the right overhang of last bin
                vec_left_oh = cuts_sorted[0]["sticky_end"]
                vec_right_oh = cuts_sorted[1]["sticky_end"]

                warnings.append(
                    f"Vector '{vector.get('name', 'vector')}' has 2 {enzyme} sites — "
                    f"using existing overhangs: 5ʹ={vec_left_oh}, 3ʹ={vec_right_oh} (no vector primers needed)"
                )

                # ── Tag / stop codon detection downstream of 3' site ──
                # The 3' cut is where the insert's C-terminus meets the vector.
                # Scan downstream for stop codons and known tag sequences.
                cut3_end = cuts_sorted[1]["cut_pos"] + enz["overhang_len"]
                # Handle circular: the downstream region wraps around
                downstream_len = 150  # scan window
                if cut3_end + downstream_len <= len(vec_seq):
                    downstream = vec_seq[cut3_end:cut3_end + downstream_len]
                else:
                    downstream = vec_seq[cut3_end:] + vec_seq[:max(0, downstream_len - (len(vec_seq) - cut3_end))]

                # Check for stop codons in the reading frame aligned with the overhang
                oh_len_val = enz["overhang_len"]
                # Frame 0 = the reading frame that would be in-frame with the insert
                # (overhang is part of the CDS, so frame starts at position 0 of downstream)
                stop_pos_in_frame = None
                STOP_SET = {"TAA", "TAG", "TGA"}
                for ci in range(0, min(len(downstream) - 2, downstream_len), 3):
                    codon = downstream[ci:ci + 3]
                    if codon in STOP_SET:
                        stop_pos_in_frame = ci
                        break

                # Known C-terminal tag patterns
                KNOWN_TAGS = {
                    "His6":    "CACCACCACCACCACCAC",
                    "His8":    "CACCACCACCACCACCACCACCACCAC",
                    "FLAG":    "GACTACAAGGACGACGACGACAAG",
                    "HA":      "TACCCATACGATGTTCCAGATTACGCT",
                    "Myc":     "GAACAAAAACTCATCTCAGAAGAGGATCTG",
                    "Strep":   "TGGAGCCACCCGCAGTTCGAAAAG",
                    "StrepII": "TGGAGCCACCCGCAGTTCGAAAAG",
                    "V5":      "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG",
                }
                detected_tags = []
                for tag_name, tag_seq in KNOWN_TAGS.items():
                    if tag_seq in downstream[:100]:
                        detected_tags.append(tag_name)

                # Also check upstream of 5' site for N-terminal tags
                cut5_start = cuts_sorted[0]["cut_pos"]
                upstream_len = 150
                if cut5_start >= upstream_len:
                    upstream = vec_seq[cut5_start - upstream_len:cut5_start]
                else:
                    upstream = vec_seq[:cut5_start]
                detected_ntags = []
                for tag_name, tag_seq in KNOWN_TAGS.items():
                    if tag_seq in upstream:
                        detected_ntags.append(tag_name)

                has_downstream_stop = stop_pos_in_frame is not None
                vec_tag_info = {
                    "precut": True,
                    "left_overhang": vec_left_oh,
                    "right_overhang": vec_right_oh,
                    "downstream_stop_pos": stop_pos_in_frame,
                    "has_downstream_stop": has_downstream_stop,
                    "c_terminal_tags": detected_tags,
                    "n_terminal_tags": detected_ntags,
                    "frame_ok": oh_len_val % 3 == 0,
                    "overhang_len": oh_len_val,
                }

                if detected_tags:
                    tag_str = ", ".join(detected_tags)
                    warnings.append(f"Vector has C-terminal tag(s): {tag_str}")
                    if has_downstream_stop and stop_pos_in_frame > 0:
                        # Stop codon found after tag — readthrough will work if in-frame
                        if oh_len_val % 3 != 0:
                            warnings.append(
                                f"⚠ {enzyme} overhang ({oh_len_val}bp) is not divisible by 3 — "
                                f"C-terminal tag may be out of frame. Consider using a different enzyme or adjusting the overhang."
                            )
                    if not has_downstream_stop:
                        warnings.append(
                            f"⚠ No in-frame stop codon found downstream of insert site — "
                            f"check vector reading frame manually"
                        )
                if detected_ntags:
                    tag_str = ", ".join(detected_ntags)
                    warnings.append(f"Vector has N-terminal tag(s): {tag_str}")

                # Auto-set remove_stop hint for fragments if C-terminal tags detected
                if detected_tags:
                    for b in bins:
                        for f in b["fragments"]:
                            if not f.get("remove_stop") and not f.get("_remove_stop_warned"):
                                f["_remove_stop_warned"] = True
                                s_upper = f.get("_seq", f["seq"].upper())
                                last3 = s_upper[-3:] if len(s_upper) >= 3 else ""
                                if last3 in STOP_SET:
                                    warnings.append(
                                        f"'{f['name']}' ends with stop codon ({last3}) — "
                                        f"enable 'Remove stop' for C-terminal {', '.join(detected_tags)} tag readthrough"
                                    )

            else:
                vec_precut = False
                warnings.append(f"Vector '{vector.get('name', 'vector')}' has 2 {enzyme} sites but cut positions are invalid — designing vector primers instead")

        elif len(vec_sites) == 0:
            # No sites — will design primers to add them
            pass
        elif len(vec_sites) == 1:
            warnings.append(f"Vector '{vector.get('name', 'vector')}' has only 1 {enzyme} site — need 0 (add via primers) or 2 (pre-made)")
        else:
            warnings.append(f"Vector '{vector.get('name', 'vector')}' has {len(vec_sites)} {enzyme} sites — expected ≤2")

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

    if vec_precut:
        # Pre-made vector: boundary overhangs come from the vector's existing sites
        # We only need to assign intermediate overhangs between bins
        n_intermediate = max(0, n_bins - 1)
        if n_intermediate > len(GOLDEN_OVERHANGS):
            raise HTTPException(400, f"Too many bins — max {len(GOLDEN_OVERHANGS)} intermediate overhangs available")
        intermediate_ohs = GOLDEN_OVERHANGS[:n_intermediate]
        # Build full overhang list: [vec_left_oh, ...intermediates..., vec_right_oh]
        # Position 0 = vec→bin0 boundary (vec_right_oh wraps to close the circle)
        # Actually: overhangs[oh_offset] = left_oh of bin 0 = vec_left_oh
        #           overhangs[oh_offset + n_bins] = right_oh of last bin = vec_right_oh
        # For the circular case with vector:
        #   overhangs = [closing_oh, vec_left_oh, inter1, inter2, ..., vec_right_oh]
        # The closing_oh = vec_right_oh (it closes the circle: last bin → vector → first bin)
        # But that's the same as vec_right_oh for position 0 and vec_left_oh for position 1
        # Simplify: build the list explicitly
        overhangs = [vec_right_oh, vec_left_oh] + list(intermediate_ohs)
        if n_bins > 1:
            overhangs.append(vec_right_oh)  # close the circle
        # Ensure we have enough overhangs
        while len(overhangs) < n_overhangs:
            overhangs.append(vec_right_oh)
        overhangs = overhangs[:n_overhangs]
    else:
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
            fwd_candidates = _generate_primer_candidates(s, 0, "forward", fwd_tail, tm_target, criteria=_crit)
            fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{f['name']}_Fwd_{enzyme}")

            # Reverse primer: spacer + RC(site) + RC(right_overhang) + annealing
            rev_tail = spacer + rc_site + _reverse_complement(right_oh)
            rev_candidates = _generate_primer_candidates(s, len(s), "reverse", rev_tail, tm_target, criteria=_crit)
            rev_primer = _pick_best_with_alternatives(rev_candidates, f"{f['name']}_Rev_{enzyme}")

            # Add hairpin/dimer warnings
            for p, pname in [(fwd_primer, f"{f['name']}_Fwd"), (rev_primer, f"{f['name']}_Rev")]:
                if p and p.get("hairpin"):
                    warnings.append(f"{pname} may form hairpin")
                if p and p.get("homodimer_dg", 0) < _crit["dimer_dg_fail"]:
                    warnings.append(f"{pname} has strong self-dimer (ΔG = {p['homodimer_dg']} kcal/mol)")
            if fwd_primer and rev_primer:
                het_dg = _calc_heterodimer_dg(fwd_primer.get("full_seq", ""), rev_primer.get("full_seq", ""))
                if het_dg < _crit["dimer_dg_fail"]:
                    warnings.append(f"{f['name']}: strong heterodimer (\u0394G = {het_dg} kcal/mol)")

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

    # ── Frame check for tag readthrough ──
    oh_len = enz["overhang_len"]
    for b in bins:
        for f in b["fragments"]:
            if f.get("remove_stop") or f.get("remove_start"):
                if oh_len % 3 != 0:
                    warnings.append(
                        f"⚠ '{f['name']}': {enzyme} overhang length ({oh_len}bp) is not divisible by 3 — "
                        f"tag fusion may be out of frame"
                    )

    # ── Vector primers (if provided and NOT pre-cut)
    vec_primers = None
    if has_vec and not vec_precut:
        # Vector fwd: after last bin → vector start
        vec_fwd_tail = spacer + site + overhangs[0]
        vec_fwd_candidates = _generate_primer_candidates(vec_seq, 0, "forward", vec_fwd_tail, tm_target, criteria=_crit)
        vec_fwd = _pick_best_with_alternatives(vec_fwd_candidates, f"{vector.get('name', 'Vector')}_Fwd_{enzyme}")

        # Vector rev: before first bin → vector end
        vec_rev_oh_idx = oh_offset  # = 1
        vec_rev_tail = spacer + rc_site + _reverse_complement(overhangs[vec_rev_oh_idx])
        vec_rev_candidates = _generate_primer_candidates(vec_seq, len(vec_seq), "reverse", vec_rev_tail, tm_target, criteria=_crit)
        vec_rev = _pick_best_with_alternatives(vec_rev_candidates, f"{vector.get('name', 'Vector')}_Rev_{enzyme}")

        vec_primers = {"fwd": vec_fwd, "rev": vec_rev}
        all_primers.append(vec_primers["fwd"])
        all_primers.append(vec_primers["rev"])
    elif vec_precut:
        warnings.append(f"No vector primers needed — '{vector.get('name', 'vector')}' is ready to cut with {enzyme}")

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

    # Build product annotations from source fragments
    product_annotations = []
    frag_colors = ["#4682B4", "#2ecc71", "#e67e22", "#9b59b6", "#e74c3c", "#1abc9c"]
    p_offset = len(vec_seq) if has_vec else 0
    if has_vec:
        product_annotations.append({
            "name": vector.get("name", "Vector"), "start": 0, "end": len(vec_seq),
            "direction": 1, "color": "#4682B4", "type": "fragment",
        })
        for a in (vector.get("annotations") or []):
            a_s, a_e = a.get("start", 0), a.get("end", 0)
            if a_e > a_s and a_e <= len(vec_seq):
                product_annotations.append({
                    "name": a.get("name", "?"), "start": a_s, "end": a_e,
                    "direction": a.get("direction", 1), "color": a.get("color", "#95A5A6"),
                    "type": a.get("type", "misc_feature"),
                })
    for bi, b in enumerate(bins):
        f = b["fragments"][0]
        fseq = f["_seq"]
        flen = len(fseq)
        product_annotations.append({
            "name": f["name"], "start": p_offset, "end": p_offset + flen,
            "direction": 1, "color": frag_colors[(bi + 1) % len(frag_colors)], "type": "fragment",
        })
        for a in (f.get("annotations") or []):
            a_s, a_e = a.get("start", 0), a.get("end", 0)
            if a_e > a_s and a_e <= flen:
                product_annotations.append({
                    "name": a.get("name", "?"), "start": p_offset + a_s, "end": p_offset + a_e,
                    "direction": a.get("direction", 1), "color": a.get("color", "#95A5A6"),
                    "type": a.get("type", "misc_feature"),
                })
        p_offset += flen

    return {
        "enzyme": {"name": enzyme, "site": site, "cut_offset": enz["cut_offset"]},
        "bins": bin_results,
        "overhang_map": overhang_map,
        "vector_primers": vec_primers,
        "vector_precut": vec_precut,
        "vector_tag_info": vec_tag_info,
        "vector_name": vector.get("name", "Vector") if vector else None,
        "primers": all_primers,
        "product_length": len(product_seq),
        "product_seq": product_seq,
        "product_annotations": product_annotations,
        "combo_count": combo_count,
        "num_bins": n_bins,
        "warnings": warnings,
        "internal_sites": internal_sites,
    }


def design_digest_ligate(vector: dict, insert: dict, enzyme1: str, enzyme2: str = None,
                         design_primers: bool = True, tm_target: float = 62.0,
                         vector_cut1_pos: int = None, vector_cut2_pos: int = None,
                         criteria: dict = None) -> dict:
    """Design a digest-ligate cloning strategy."""
    _crit = _resolve_criteria(criteria)
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
        fwd_candidates = _generate_primer_candidates(ins_seq, 0, "forward", fwd_tail, tm_target, criteria=_crit)
        fwd_primer = _pick_best_with_alternatives(fwd_candidates, f"{ins_name}_Fwd_{enzyme1}")
        if fwd_primer:
            primers.append(fwd_primer)
            if fwd_primer.get("hairpin"):
                warnings.append(f"{ins_name}_Fwd may form hairpin")
            if fwd_primer.get("homodimer_dg", 0) < _crit["dimer_dg_fail"]:
                warnings.append(f"{ins_name}_Fwd has strong self-dimer (ΔG = {fwd_primer['homodimer_dg']} kcal/mol)")

        # Reverse primer: RE site + annealing to insert end
        e2_name = enzyme2 or enzyme1
        e2_info_dict = enzyme_info.get(e2_name, {})
        e2_site = e2_info_dict.get("site", "")
        rev_tail = "GA" + _reverse_complement(e2_site) if e2_site else "GA"
        rev_candidates = _generate_primer_candidates(ins_seq, len(ins_seq), "reverse", rev_tail, tm_target, criteria=_crit)
        rev_primer = _pick_best_with_alternatives(rev_candidates, f"{ins_name}_Rev_{e2_name}")
        if rev_primer:
            primers.append(rev_primer)
            if rev_primer.get("hairpin"):
                warnings.append(f"{ins_name}_Rev may form hairpin")
            if rev_primer.get("homodimer_dg", 0) < _crit["dimer_dg_fail"]:
                warnings.append(f"{ins_name}_Rev has strong self-dimer (ΔG = {rev_primer['homodimer_dg']} kcal/mol)")
        # Heterodimer check between fwd and rev
        if len(primers) >= 2:
            het_dg = _calc_heterodimer_dg(primers[0].get("full_seq", ""), primers[1].get("full_seq", ""))
            if het_dg < _crit["dimer_dg_fail"]:
                warnings.append(f"Strong heterodimer between insert primers (\u0394G = {het_dg} kcal/mol)")

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
    primer_prefix = "MR"
    plasmid_prefix = "pMR"
    try:
        with get_db() as conn:
            settings = conn.execute("SELECT primer_prefix, plasmid_prefix FROM dna_settings WHERE id=1").fetchone()
            if settings:
                d = dict(settings)
                primer_prefix = d.get("primer_prefix") or "MR"
                plasmid_prefix = d.get("plasmid_prefix") or "pMR"
    except Exception:
        pass
    return {
        "opencloning_url": OC_DEFAULT_URL,
        "primer_prefix": primer_prefix,
        "plasmid_prefix": plasmid_prefix,
        "gblock_prefix": "g" + primer_prefix,
    }


@router.get("/cloning/sequences")
def list_sequences():
    with get_db() as conn:
        primers = conn.execute(
            "SELECT id, name, sequence, use, box_number, gb_file, created "
            "FROM primers WHERE (gb_file IS NOT NULL AND gb_file != '') "
            "OR (sequence IS NOT NULL AND sequence != '') "
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

        # gBlocks — include all with sequence OR gb_file
        try:
            gblocks = conn.execute(
                "SELECT id, name, sequence, length, project, use, gb_file, created "
                "FROM gblocks WHERE (sequence IS NOT NULL AND sequence != '') OR (gb_file IS NOT NULL AND gb_file != '') "
                "ORDER BY name"
            ).fetchall()
        except Exception:
            gblocks = []

        # Parts — include all with sequence OR gb_file
        try:
            parts = conn.execute(
                "SELECT id, name, sequence, length, project, part_type, description, subcategory, gb_file, created "
                "FROM parts WHERE (sequence IS NOT NULL AND sequence != '') OR (gb_file IS NOT NULL AND gb_file != '') "
                "ORDER BY name"
            ).fetchall()
        except Exception:
            parts = []

    items = []
    for p in primers:
        d = dict(p)
        d["type"] = "primer"
        fpath = os.path.join(GB_DIR, f"primer_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        d["has_seq"] = bool(d.get("sequence"))
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
    for g in gblocks:
        d = dict(g)
        d["type"] = "gblock"
        fpath = os.path.join(GB_DIR, f"gblock_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        d["has_seq"] = bool(d.get("sequence"))
        items.append(d)
    for p in parts:
        d = dict(p)
        d["type"] = "part"
        fpath = os.path.join(GB_DIR, f"part_{d['id']}.gb")
        d["has_file"] = os.path.isfile(fpath)
        d["has_seq"] = bool(d.get("sequence"))
        items.append(d)

    return {"items": items}


@router.get("/cloning/sequences/{seq_type}/{seq_id}/parse")
def parse_sequence(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', 'kitpart', 'gblock', or 'part'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if os.path.isfile(fpath):
        return parse_genbank(fpath)
    # Fallback for gblocks (and others) without .gb — read sequence from DB
    if seq_type == "gblock":
        with get_db() as conn:
            row = conn.execute("SELECT name, sequence, use, project FROM gblocks WHERE id=?", (seq_id,)).fetchone()
        if not row:
            raise HTTPException(404, "gBlock not found")
        d = dict(row)
        seq = (d.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
        if not seq:
            raise HTTPException(400, "gBlock has no sequence")
        return {
            "name": d.get("name", f"gblock_{seq_id}"),
            "description": d.get("use") or d.get("project") or "",
            "seq": seq,
            "annotations": [],
            "length": len(seq),
            "topology": "linear",
        }
    if seq_type == "part":
        with get_db() as conn:
            row = conn.execute("SELECT name, sequence, description, project, part_type FROM parts WHERE id=?", (seq_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Part not found")
        d = dict(row)
        seq = (d.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
        if not seq:
            raise HTTPException(400, "Part has no sequence")
        return {
            "name": d.get("name", f"part_{seq_id}"),
            "description": d.get("description") or d.get("project") or "",
            "seq": seq,
            "annotations": [],
            "length": len(seq),
            "topology": "linear",
        }
    raise HTTPException(404, f"GenBank file not found for {seq_type}_{seq_id}")


@router.get("/cloning/sequences/{seq_type}/{seq_id}/raw")
def raw_sequence(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', 'kitpart', 'gblock', or 'part'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if not os.path.isfile(fpath):
        raise HTTPException(404, "GenBank file not found")
    with open(fpath, "r") as f:
        return PlainTextResponse(f.read(), media_type="text/plain")


class UpdateFeaturesRequest(BaseModel):
    annotations: List[dict]
    seq: Optional[str] = None  # Sequence (used when no .gb file exists yet)
    topology: Optional[str] = "linear"
    name: Optional[str] = None


@router.post("/cloning/sequences/{seq_type}/{seq_id}/update-features")
def update_features(seq_type: str, seq_id: int, body: UpdateFeaturesRequest):
    """Update annotations in a .gb file, preserving the sequence."""
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', 'kitpart', 'gblock', or 'part'")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")

    from Bio import SeqIO as _SeqIO
    from Bio.Seq import Seq
    from Bio.SeqRecord import SeqRecord
    from Bio.SeqFeature import SeqFeature, FeatureLocation
    from io import StringIO

    if os.path.isfile(fpath):
        # Read existing record to preserve sequence + metadata
        records = list(_SeqIO.parse(fpath, "genbank"))
        if not records:
            raise HTTPException(400, "No records found in GenBank file")
        rec = records[0]
    else:
        # No .gb file — create from sequence provided in request (or DB fallback)
        seq_str = (body.seq or "").upper().replace(" ", "").replace("\n", "")
        rec_name = body.name or f"{seq_type}_{seq_id}"
        rec_topo = body.topology or "linear"

        # DB fallback if no sequence in request
        if not seq_str:
            with get_db() as conn:
                if seq_type == "gblock":
                    row = conn.execute("SELECT name, sequence FROM gblocks WHERE id=?", (seq_id,)).fetchone()
                    if row:
                        d = dict(row)
                        seq_str = (d.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
                        rec_name = d.get("name", rec_name)
                elif seq_type == "primer":
                    row = conn.execute("SELECT name, sequence FROM primers WHERE id=?", (seq_id,)).fetchone()
                    if row:
                        d = dict(row)
                        seq_str = (d.get("sequence") or "").upper().replace(" ", "").replace("\n", "")
                        rec_name = d.get("name", rec_name)

        if not seq_str:
            raise HTTPException(404, f"No sequence available to create .gb for {seq_type}_{seq_id}. Try reloading the sequence.")

        rec = SeqRecord(Seq(seq_str), id=rec_name[:16], name=rec_name[:16], description="")
        rec.annotations["molecule_type"] = "DNA"
        rec.annotations["topology"] = rec_topo

        # Mark gb_file in DB
        with get_db() as conn:
            if seq_type == "gblock":
                conn.execute("UPDATE gblocks SET gb_file=? WHERE id=?", (f"gblock_{seq_id}.gb", seq_id))
                conn.commit()
            elif seq_type == "kitpart":
                conn.execute("UPDATE kit_parts SET gb_file=? WHERE id=?", (f"kitpart_{seq_id}.gb", seq_id))
                conn.commit()
            elif seq_type == "plasmid":
                conn.execute("UPDATE plasmids SET gb_file=? WHERE id=?", (f"plasmid_{seq_id}.gb", seq_id))
                conn.commit()

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
    os.makedirs(GB_DIR, exist_ok=True)
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
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', 'kitpart', 'gblock', or 'part'")
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
    frags = [{"name": f.name, "seq": f.seq, "start": f.start, "end": f.end, "annotations": f.annotations or [], "no_overlap": f.no_overlap or False, "remove_stop": f.remove_stop or False, "remove_start": f.remove_start or False} for f in body.fragments]
    return design_gibson(
        fragments=frags,
        circular=body.circular if body.circular is not None else True,
        overlap_length=body.overlap_length or 25,
        tm_target=body.tm_target or 62.0,
        criteria=body.criteria.dict() if body.criteria else None,
        gblock_mode=body.gblock_mode or False,
        gblock_indices=body.gblock_indices,
    )


@router.post("/cloning/design-goldengate")
def goldengate_endpoint(body: GoldenGateRequest):
    """Design a Golden Gate assembly with type IIS enzyme."""
    bins_data = None
    frags_data = None
    vec_data = None

    if body.bins:
        bins_data = [{"name": b.name, "fragments": [{"name": f.name, "seq": f.seq, "annotations": f.annotations or [], "remove_stop": f.remove_stop or False, "remove_start": f.remove_start or False} for f in b.fragments]} for b in body.bins]
    elif body.fragments:
        frags_data = [{"name": f.name, "seq": f.seq, "annotations": f.annotations or [], "remove_stop": f.remove_stop or False, "remove_start": f.remove_start or False} for f in body.fragments]

    if body.vector and body.vector.seq:
        vec_data = {"name": body.vector.name, "seq": body.vector.seq, "annotations": body.vector.annotations or []}

    return design_golden_gate(
        bins=bins_data,
        fragments=frags_data,
        vector=vec_data,
        enzyme=body.enzyme or "BsaI",
        circular=body.circular if body.circular is not None else True,
        tm_target=body.tm_target or 62.0,
        criteria=body.criteria.dict() if body.criteria else None,
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
        criteria=body.criteria.dict() if body.criteria else None,
    )


# ---------------------------------------------------------------------------
# Primer design endpoints
# ---------------------------------------------------------------------------
@router.post("/cloning/design-kld-primers")
def kld_endpoint(body: KLDRequest):
    # If the user didn't provide start/end (old UI), fallback to insertion_pos
    s_pos = body.start_pos if body.start_pos is not None else body.insertion_pos
    e_pos = body.end_pos if body.end_pos is not None else body.insertion_pos
    
    return design_kld_primers(
        template_seq=body.template_seq,
        insert_seq=body.insert_seq,
        start_pos=s_pos,
        end_pos=e_pos,
        optimize=body.optimize,
        exhaustive=body.exhaustive,
        tm_target=body.annealing_tm_target or 62.0,
        max_len=body.max_primer_length or 60,
        mg_conc=body.mg_conc if body.mg_conc is not None else 1.5,
        criteria=body.criteria.dict() if body.criteria else None,
    )


@router.post("/cloning/design-kld-primers-async")
def kld_async_endpoint(body: KLDRequest):
    """Submit KLD primer design as a background job. Returns job_id for polling."""
    s_pos = body.start_pos if body.start_pos is not None else body.insertion_pos
    e_pos = body.end_pos if body.end_pos is not None else body.insertion_pos

    job_id = submit_job(
        design_kld_primers,
        template_seq=body.template_seq,
        insert_seq=body.insert_seq,
        start_pos=s_pos,
        end_pos=e_pos,
        optimize=body.optimize,
        exhaustive=body.exhaustive,
        tm_target=body.annealing_tm_target or 62.0,
        max_len=body.max_primer_length or 60,
        mg_conc=body.mg_conc if body.mg_conc is not None else 1.5,
        criteria=body.criteria.dict() if body.criteria else None,
    )
    return {"job_id": job_id}


@router.get("/cloning/job/{job_id}")
def poll_job(job_id: str):
    """Poll a background job for status and result."""
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.post("/cloning/evaluate-primer")
def custom_primer_endpoint(body: CustomPrimerRequest):
    return evaluate_custom_primer(
        template_seq=body.template_seq,
        start=body.start,
        end=body.end,
        direction=body.direction,
        tail=body.tail or "",
        tail_orientation=body.tail_orientation or "oligo",
    )


@router.post("/cloning/in-silico-pcr")
def in_silico_pcr_endpoint(body: InSilicoPCRRequest):
    return in_silico_pcr(
        template_seq=body.template_seq,
        primer1=body.primer1,
        primer2=body.primer2,
        circular=body.circular if body.circular is not None else True,
        max_mismatches=body.max_mismatches or 2,
        annotations=body.annotations or [],
        template_name=body.template_name or "template",
        primer1_name=body.primer1_name or "Primer 1",
        primer2_name=body.primer2_name or "Primer 2",
    )




class SaveFragmentRequest(BaseModel):
    name: str
    seq: str
    annotations: Optional[List[dict]] = None
    save_as: Optional[str] = "gblock"  # "gblock", "kitpart", "plasmid"
    topology: Optional[str] = "linear"
    overwrite: Optional[bool] = True  # Overwrite existing by name
    use: Optional[str] = ""  # use description (gblock/plasmid)
    project: Optional[str] = ""  # project name (gblock)
    description: Optional[str] = ""  # description (kitpart)


@router.post("/cloning/save-fragment")
def save_fragment(body: SaveFragmentRequest):
    """Save a single fragment (gBlock/kitpart/plasmid) with optional overwrite by name."""
    gb_content = _write_genbank({
        "name": body.name,
        "seq": body.seq,
        "length": len(body.seq),
        "annotations": body.annotations or [],
        "topology": body.topology or "linear",
    })

    now = datetime.utcnow().isoformat()
    save_as = (body.save_as or "gblock").lower()
    os.makedirs(GB_DIR, exist_ok=True)

    _use = body.use or ""
    _project = body.project or ""
    _desc = body.description or _use

    with get_db() as conn:
        if save_as == "gblock":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM gblocks WHERE name=?", (body.name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"gblock_{item_id}.gb"
                conn.execute(
                    "UPDATE gblocks SET sequence=?, length=?, use=?, project=?, gb_file=?, created=? WHERE id=?",
                    (body.seq, len(body.seq), _use, _project, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO gblocks (name, sequence, length, use, project, gb_file, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (body.name, body.seq, len(body.seq), _use, _project, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"gblock_{item_id}.gb"
                conn.execute("UPDATE gblocks SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"gblock_{item_id}.gb")
        elif save_as == "kitpart":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM kit_parts WHERE name=?", (body.name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"kitpart_{item_id}.gb"
                conn.execute(
                    "UPDATE kit_parts SET kit_name=?, part_type=?, description=?, gb_file=?, created=? WHERE id=?",
                    ("Cloning", "gBlock", _desc, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO kit_parts (name, kit_name, part_type, description, gb_file, created) VALUES (?, ?, ?, ?, ?, ?)",
                    (body.name, "Cloning", "gBlock", _desc, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"kitpart_{item_id}.gb"
                conn.execute("UPDATE kit_parts SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"kitpart_{item_id}.gb")
        elif save_as == "part":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM parts WHERE name=?", (body.name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"part_{item_id}.gb"
                conn.execute(
                    "UPDATE parts SET sequence=?, length=?, description=?, project=?, gb_file=?, created=? WHERE id=?",
                    (body.seq, len(body.seq), _desc, _project, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO parts (name, sequence, length, description, project, gb_file, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (body.name, body.seq, len(body.seq), _desc, _project, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"part_{item_id}.gb"
                conn.execute("UPDATE parts SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"part_{item_id}.gb")
        else:
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM plasmids WHERE name=?", (body.name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"plasmid_{item_id}.gb"
                conn.execute(
                    "UPDATE plasmids SET use=?, gb_file=?, created=? WHERE id=?",
                    (_use, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO plasmids (name, use, gb_file, created) VALUES (?, ?, ?, ?)",
                    (body.name, _use, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"plasmid_{item_id}.gb"
                conn.execute("UPDATE plasmids SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")

    with open(gb_path, "w") as f:
        f.write(gb_content)

    return {"id": item_id, "name": body.name, "save_as": save_as, "overwritten": bool(existing) if body.overwrite else False}



class GibsonCombinatorialRequest(BaseModel):
    vector: Optional[FragmentInput] = None
    bins: List[BinInput]  # reuse GG BinInput: each bin has name + fragments[]
    circular: Optional[bool] = True
    overlap_length: Optional[int] = 25
    tm_target: Optional[float] = 62.0
    criteria: Optional[PrimerCriteria] = None
    gblock_indices: Optional[List[int]] = None  # which positions get gBlock treatment


@router.post("/cloning/design-gibson-combinatorial")
def gibson_combinatorial_endpoint(body: GibsonCombinatorialRequest):
    """Design Gibson assembly for all combinations of bin options."""
    from itertools import product as itertools_product

    if not body.bins or len(body.bins) < 1:
        raise HTTPException(400, "Need at least 1 bin")

    # Build all combinations
    bin_options = []
    for b in body.bins:
        if not b.fragments or len(b.fragments) == 0:
            raise HTTPException(400, f"Bin '{b.name}' has no fragments")
        bin_options.append([(f.name, f.seq, f.annotations or [], f.no_overlap or False) for f in b.fragments])

    combinations = list(itertools_product(*bin_options))
    if len(combinations) > 96:
        raise HTTPException(400, f"Too many combinations ({len(combinations)}). Max 96.")

    # Design each combination
    all_results = []
    unique_parts = {}  # seq_upper -> {name, seq, type, source_combos}

    vec_data = None
    if body.vector and body.vector.seq:
        vec_data = {"name": body.vector.name, "seq": body.vector.seq, "annotations": body.vector.annotations or [], "no_overlap": body.vector.no_overlap or False}

    gb_indices = body.gblock_indices or []

    for ci, combo in enumerate(combinations):
        frags = []
        combo_label = " + ".join([c[0] for c in combo])
        if vec_data:
            frags.append(dict(vec_data))
        for fi, (fname, fseq, fanns, fno_ol) in enumerate(combo):
            frags.append({"name": fname, "seq": fseq, "annotations": fanns, "no_overlap": fno_ol})

        try:
            result = design_gibson(
                fragments=frags,
                circular=body.circular if body.circular is not None else True,
                overlap_length=body.overlap_length or 25,
                tm_target=body.tm_target or 62.0,
                criteria=body.criteria.dict() if body.criteria else None,
                gblock_indices=gb_indices,
            )
            # Collect unique parts
            for p in (result.get("primers") or []):
                if p and p.get("full_seq"):
                    key = p["full_seq"].upper()
                    if key not in unique_parts:
                        unique_parts[key] = {
                            "name": p.get("name", "primer"),
                            "seq": p["full_seq"],
                            "type": "primer",
                            "combos": [],
                        }
                    unique_parts[key]["combos"].append(ci)

            for ef in (result.get("extended_fragments") or []):
                if ef and ef.get("extended_seq"):
                    key = ef["extended_seq"].upper()
                    if key not in unique_parts:
                        unique_parts[key] = {
                            "name": ef.get("name", "gblock"),
                            "seq": ef["extended_seq"],
                            "type": "gblock",
                            "combos": [],
                        }
                    unique_parts[key]["combos"].append(ci)

            all_results.append({
                "combo_index": ci,
                "combo_label": combo_label,
                "fragments": [c[0] for c in combo],
                "product_length": result.get("product_length", 0),
                "warnings": result.get("warnings", []),
            })
        except Exception as e:
            all_results.append({
                "combo_index": ci,
                "combo_label": combo_label,
                "fragments": [c[0] for c in combo],
                "error": str(e),
            })

    # Build deduplicated parts list
    parts_list = sorted(unique_parts.values(), key=lambda p: (p["type"], p["name"]))

    return {
        "combinations": all_results,
        "num_combinations": len(combinations),
        "parts_list": parts_list,
        "num_unique_parts": len(parts_list),
        "warnings": [],
    }


class BulkSaveRequest(BaseModel):
    items: List[dict]  # [{name, seq, type: "primer"|"gblock"|"plasmid", annotations?, topology?}]
    overwrite: Optional[bool] = True


@router.post("/cloning/bulk-save")
def bulk_save(body: BulkSaveRequest):
    """Save multiple items to DNA Manager at once."""
    now = datetime.utcnow().isoformat()
    os.makedirs(GB_DIR, exist_ok=True)
    saved = []

    with get_db() as conn:
        for item in body.items:
            name = item.get("name", "unnamed")
            seq = item.get("seq", "")
            item_type = item.get("type", "primer")
            anns = item.get("annotations", [])
            topo = item.get("topology", "linear")

            # Write .gb content
            gb_content = _write_genbank({
                "name": name, "seq": seq, "length": len(seq),
                "annotations": anns, "topology": topo,
            })

            if item_type == "gblock":
                existing = None
                if body.overwrite:
                    existing = conn.execute("SELECT id FROM gblocks WHERE name=?", (name,)).fetchone()
                if existing:
                    item_id = dict(existing)["id"]
                    gb_fname = f"gblock_{item_id}.gb"
                    conn.execute(
                        "UPDATE gblocks SET sequence=?, length=?, gb_file=?, created=? WHERE id=?",
                        (seq, len(seq), gb_fname, now, item_id))
                else:
                    cur = conn.execute(
                        "INSERT INTO gblocks (name, sequence, length, gb_file, created) VALUES (?, ?, ?, ?, ?)",
                        (name, seq, len(seq), "pending", now))
                    item_id = cur.lastrowid
                    gb_fname = f"gblock_{item_id}.gb"
                    conn.execute("UPDATE gblocks SET gb_file=? WHERE id=?", (gb_fname, item_id))
                gb_path = os.path.join(GB_DIR, gb_fname)

            elif item_type == "primer":
                existing = None
                if body.overwrite:
                    existing = conn.execute("SELECT id FROM primers WHERE name=?", (name,)).fetchone()
                if existing:
                    item_id = dict(existing)["id"]
                    gb_fname = f"primer_{item_id}.gb"
                    conn.execute(
                        "UPDATE primers SET sequence=?, gb_file=?, created=? WHERE id=?",
                        (seq, gb_fname, now, item_id))
                else:
                    cur = conn.execute(
                        "INSERT INTO primers (name, sequence, gb_file, created) VALUES (?, ?, ?, ?)",
                        (name, seq, "pending", now))
                    item_id = cur.lastrowid
                    gb_fname = f"primer_{item_id}.gb"
                    conn.execute("UPDATE primers SET gb_file=? WHERE id=?", (gb_fname, item_id))
                gb_path = os.path.join(GB_DIR, gb_fname)

            elif item_type == "part":
                existing = None
                if body.overwrite:
                    existing = conn.execute("SELECT id FROM parts WHERE name=?", (name,)).fetchone()
                if existing:
                    item_id = dict(existing)["id"]
                    conn.execute(
                        "UPDATE parts SET sequence=?, length=?, created=? WHERE id=?",
                        (seq, len(seq), now, item_id))
                else:
                    cur = conn.execute(
                        "INSERT INTO parts (name, sequence, length, description, project, created) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (name, seq, len(seq),
                         item.get("description", "Gibson assembly fragment"),
                         item.get("project", ""), now))
                    item_id = cur.lastrowid
                gb_path = None  # parts table doesn't use .gb files by default

            elif item_type == "kitpart":
                existing = None
                if body.overwrite:
                    existing = conn.execute("SELECT id FROM kit_parts WHERE name=?", (name,)).fetchone()
                if existing:
                    item_id = dict(existing)["id"]
                    gb_fname = f"kitpart_{item_id}.gb"
                    conn.execute(
                        "UPDATE kit_parts SET gb_file=?, created=? WHERE id=?",
                        (gb_fname, now, item_id))
                else:
                    cur = conn.execute(
                        "INSERT INTO kit_parts (name, kit_name, part_type, description, gb_file, created) "
                        "VALUES (?, ?, ?, ?, ?, ?)",
                        (name, item.get("kit_name", "Gibson Assembly"), "",
                         item.get("description", "Assembly fragment"), "pending", now))
                    item_id = cur.lastrowid
                    gb_fname = f"kitpart_{item_id}.gb"
                    conn.execute("UPDATE kit_parts SET gb_file=? WHERE id=?", (gb_fname, item_id))
                gb_path = os.path.join(GB_DIR, gb_fname)

            else:  # plasmid
                cur = conn.execute(
                    "INSERT INTO plasmids (name, gb_file, created) VALUES (?, ?, ?)",
                    (name, "pending", now))
                item_id = cur.lastrowid
                gb_fname = f"plasmid_{item_id}.gb"
                conn.execute("UPDATE plasmids SET gb_file=? WHERE id=?", (gb_fname, item_id))
                gb_path = os.path.join(GB_DIR, gb_fname)

            if gb_path:
                with open(gb_path, "w") as f:
                    f.write(gb_content)

            saved.append({"id": item_id, "name": name, "type": item_type})

        conn.commit()

    return {"saved": saved, "count": len(saved)}


@router.post("/cloning/design-pcr-primers")
def pcr_endpoint(body: PCRPrimerRequest):
    return design_pcr_primers(
        template_seq=body.template_seq,
        target_start=body.target_start,
        target_end=body.target_end,
        tm_target=body.tm_target or 62.0,
        criteria=body.criteria.dict() if body.criteria else None,
    )


@router.post("/cloning/design-seq-primers")
def seq_primer_endpoint(body: SeqPrimerRequest):
    return design_seq_primers(
        template_seq=body.template_seq,
        region_start=body.region_start,
        region_end=body.region_end,
        read_length=body.read_length or 900,
        tm_target=body.tm_target or 62.0,
        criteria=body.criteria.dict() if body.criteria else None,
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
        start_pos=body.start_pos,
        end_pos=body.end_pos,
        insert_seq=body.insert_seq,
        insert_label=body.insert_label,
        target_start=body.target_start,
        target_end=body.target_end,
    )


@router.post("/cloning/save-product")
def save_product(body: SaveProductRequest):
    """Generate product .gb file, save as a new plasmid, return parse data."""
    if body.product_seq:
        # Assembly product: use pre-built sequence directly
        topo = body.topology or "circular"
        product = {
            "name": body.product_name,
            "seq": body.product_seq,
            "length": len(body.product_seq),
            "annotations": body.product_annotations or [],
            "topology": topo,
        }
    else:
        product = _build_product(
            mode=body.mode,
            template_seq=body.template_seq,
            annotations=body.annotations or [],
            template_name=body.template_name or "template",
            template_topology=body.template_topology or "circular",
            insertion_pos=body.insertion_pos,
            start_pos=body.start_pos,
            end_pos=body.end_pos,
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
    method = {"kld": "KLD", "pcr": "PCR", "gibson": "Gibson", "goldengate": "Golden Gate", "digestligate": "Digest-Ligate"}.get(body.mode, body.mode)
    use_desc = f"{method} product" + (f" from {body.template_name}" if body.template_name else "")

    save_as = (body.save_as or "plasmid").lower()
    item_name = body.product_name or "product"
    seq_text = product.get("seq", "")

    with get_db() as conn:
        if save_as == "gblock":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM gblocks WHERE name=?", (item_name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"gblock_{item_id}.gb"
                conn.execute(
                    "UPDATE gblocks SET sequence=?, length=?, use=?, gb_file=?, created=? WHERE id=?",
                    (seq_text, len(seq_text), use_desc, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO gblocks (name, sequence, length, use, gb_file, created) VALUES (?, ?, ?, ?, ?, ?)",
                    (item_name, seq_text, len(seq_text), use_desc, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"gblock_{item_id}.gb"
                conn.execute("UPDATE gblocks SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"gblock_{item_id}.gb")
        elif save_as == "kitpart":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM kit_parts WHERE name=?", (item_name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"kitpart_{item_id}.gb"
                conn.execute(
                    "UPDATE kit_parts SET kit_name=?, part_type=?, description=?, gb_file=?, created=? WHERE id=?",
                    ("Cloning", method, use_desc, gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO kit_parts (name, kit_name, part_type, description, gb_file, created) VALUES (?, ?, ?, ?, ?, ?)",
                    (item_name, "Cloning", method, use_desc, "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"kitpart_{item_id}.gb"
                conn.execute("UPDATE kit_parts SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"kitpart_{item_id}.gb")
        elif save_as == "part":
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM parts WHERE name=?", (item_name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"part_{item_id}.gb"
                conn.execute(
                    "UPDATE parts SET sequence=?, length=?, description=?, project=?, gb_file=?, created=? WHERE id=?",
                    (seq_text, len(seq_text), use_desc, "", gb_fname, now, item_id),
                )
            else:
                cur = conn.execute(
                    "INSERT INTO parts (name, sequence, length, description, project, gb_file, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (item_name, seq_text, len(seq_text), use_desc, "", "pending", now),
                )
                item_id = cur.lastrowid
                gb_fname = f"part_{item_id}.gb"
                conn.execute("UPDATE parts SET gb_file=? WHERE id=?", (gb_fname, item_id))
            conn.commit()
            gb_path = os.path.join(GB_DIR, f"part_{item_id}.gb")
        else:
            # Default: plasmid
            existing = None
            if body.overwrite:
                existing = conn.execute("SELECT id FROM plasmids WHERE name=?", (item_name,)).fetchone()
            if existing:
                item_id = dict(existing)["id"]
                gb_fname = f"plasmid_{item_id}.gb"
                conn.execute(
                    "UPDATE plasmids SET use=?, gb_file=?, created=? WHERE id=?",
                    (use_desc, gb_fname, now, item_id),
                )
                conn.commit()
                gb_path = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")
            else:
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
              if not body.product_name:
                  item_name = f"{prefix}{next_num}"
              cur = conn.execute(
                  "INSERT INTO plasmids (name, use, gb_file, created) VALUES (?, ?, ?, ?)",
                  (item_name, use_desc, "pending", now),
              )
              conn.commit()
              item_id = cur.lastrowid
              gb_fname = f"plasmid_{item_id}.gb"
              conn.execute("UPDATE plasmids SET gb_file=? WHERE id=?", (gb_fname, item_id))
              conn.commit()
              gb_path = os.path.join(GB_DIR, f"plasmid_{item_id}.gb")

    # Save .gb file
    os.makedirs(GB_DIR, exist_ok=True)
    with open(gb_path, "w") as f:
        f.write(gb_content)

    return {
        "plasmid_id": item_id,
        "plasmid_name": item_name,
        "save_as": save_as,
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


@router.get("/cloning/sequences/{seq_type}/{seq_id}/download-gb")
def download_gb(seq_type: str, seq_id: int):
    """Download .gb file for any sequence type. Creates one from DB if needed."""
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "Invalid sequence type")
    fpath = os.path.join(GB_DIR, f"{seq_type}_{seq_id}.gb")
    if os.path.isfile(fpath):
        from starlette.responses import FileResponse
        return FileResponse(fpath, filename=f"{seq_type}_{seq_id}.gb", media_type="application/octet-stream")
    # No .gb file — generate from parsed data
    parsed = parse_sequence(seq_type, seq_id)
    gb_content = _write_genbank(parsed)
    from starlette.responses import Response
    return Response(content=gb_content, media_type="application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename={seq_type}_{seq_id}.gb"})


@router.get("/cloning/export/{seq_type}/{seq_id}")
def export_single(seq_type: str, seq_id: int):
    if seq_type not in ("primer", "plasmid", "kitpart", "gblock", "part"):
        raise HTTPException(400, "seq_type must be 'primer', 'plasmid', 'kitpart', 'gblock', or 'part'")
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


# ---------------------------------------------------------------------------
# In Silico Assembly — Gibson
# ---------------------------------------------------------------------------
def _find_best_overlap(seq_a: str, seq_b: str, min_overlap: int = 15,
                       max_scan: int = 60, min_identity: float = 90.0) -> dict | None:
    """Find the best overlap between the 3' end of seq_a and the 5' end of seq_b.

    Uses a sliding window: take the last *w* bp of A and search for a match
    in the first *max_scan* bp of B, for w from max_scan down to min_overlap.
    Returns the best hit (longest, then highest identity, then highest Tm),
    or None if nothing meets the thresholds.
    """
    a_upper = seq_a.upper()
    b_upper = seq_b.upper()
    a_len = len(a_upper)
    b_len = len(b_upper)
    scan_a = min(max_scan, a_len)
    scan_b = min(max_scan, b_len)
    tail_a = a_upper[-scan_a:]  # 3' region of A
    head_b = b_upper[:scan_b]   # 5' region of B

    best = None
    # Try every possible window length from longest to shortest
    for w in range(min(scan_a, scan_b), min_overlap - 1, -1):
        query = tail_a[-w:]  # last w bp of A
        # Slide query across head of B
        for offset in range(scan_b - w + 1):
            target = head_b[offset:offset + w]
            matches = sum(1 for x, y in zip(query, target) if x == y)
            identity = (matches / w) * 100
            if identity >= min_identity:
                # Compute Tm of the overlap region (use the query sequence)
                overlap_seq = seq_a[-(w + (scan_a - len(tail_a))):] if False else seq_a[-w:]
                # Get actual sequences (preserve case from originals)
                overlap_from_a = seq_a[a_len - w:]
                overlap_from_b = seq_b[offset:offset + w]
                tm = _calc_tm(query)
                score = w * 10 + identity + tm * 0.1
                if best is None or score > best["score"]:
                    best = {
                        "overlap_len": w,
                        "identity": round(identity, 1),
                        "mismatches": w - matches,
                        "tm": round(tm, 1),
                        "a_start": a_len - w,  # position in A where overlap starts
                        "a_end": a_len,
                        "b_start": offset,  # position in B where overlap starts
                        "b_end": offset + w,
                        "overlap_seq": query,
                        "score": score,
                    }
                # For each window length, once we found the best offset, move on
                # (we want longest first, then best identity within same length)
                if best and best["overlap_len"] == w:
                    break  # found a good match at this length
        if best and best["overlap_len"] == w:
            break  # longest wins — don't search shorter
    return best


def _remap_annotations(annotations: list, offset: int, source_len: int,
                       trim_start: int = 0, trim_end: int = None) -> list:
    """Remap annotations from a source fragment onto the product.

    - offset: bp position in product where this fragment starts
    - trim_start: bp trimmed from the start of the fragment
    - trim_end: bp position in fragment to stop (exclusive); None = full length
    """
    if trim_end is None:
        trim_end = source_len
    result = []
    for ann in (annotations or []):
        a_start = ann.get("start", 0)
        a_end = ann.get("end", 0)
        # Skip annotations entirely outside the kept region
        if a_end <= trim_start or a_start >= trim_end:
            continue
        # Clip to kept region
        new_start = max(a_start, trim_start) - trim_start + offset
        new_end = min(a_end, trim_end) - trim_start + offset
        if new_end > new_start:
            result.append({
                "name": ann.get("name", "feature"),
                "start": new_start,
                "end": new_end,
                "direction": ann.get("direction", 1),
                "color": ann.get("color", "#95A5A6"),
                "type": ann.get("type", "misc_feature"),
            })
    return result


def run_gibson_assembly(fragments: list, circular: bool = True,
                        min_overlap: int = 15, max_scan: int = 60,
                        min_identity: float = 90.0) -> dict:
    """Simulate Gibson assembly: find overlaps between adjacent fragments,
    trim duplicates, concatenate, and return the assembled product."""
    n = len(fragments)
    if n < 2:
        raise HTTPException(400, "Gibson assembly requires at least 2 fragments")

    warnings = []
    junctions = []

    # Determine which pairs to check
    pairs = []
    for i in range(n - 1):
        pairs.append((i, i + 1))
    if circular and n >= 2:
        pairs.append((n - 1, 0))  # last → first for circularization

    # Find overlaps for each junction
    overlap_info = {}  # keyed by (i, j)
    for (i, j) in pairs:
        frag_a = fragments[i]
        frag_b = fragments[j]
        hit = _find_best_overlap(
            frag_a["seq"], frag_b["seq"],
            min_overlap=min_overlap, max_scan=max_scan,
            min_identity=min_identity
        )
        overlap_info[(i, j)] = hit
        junc_name = f"{frag_a['name']} → {frag_b['name']}"
        if hit is None:
            warnings.append(f"No overlap found between {junc_name} (min {min_overlap}bp, ≥{min_identity}% identity)")
            junctions.append({
                "name": junc_name,
                "from_idx": i, "to_idx": j,
                "found": False,
            })
        else:
            junc = {
                "name": junc_name,
                "from_idx": i, "to_idx": j,
                "found": True,
                "overlap_len": hit["overlap_len"],
                "identity": hit["identity"],
                "mismatches": hit["mismatches"],
                "tm": hit["tm"],
                "overlap_seq": hit["overlap_seq"],
                "a_start": hit["a_start"],
                "b_start": hit["b_start"],
                "b_end": hit["b_end"],
            }
            junctions.append(junc)
            # Warnings for marginal overlaps
            if hit["overlap_len"] < 20:
                warnings.append(f"Short overlap at {junc_name}: {hit['overlap_len']}bp (recommend ≥20bp)")
            if hit["tm"] < 48:
                warnings.append(f"Low overlap Tm at {junc_name}: {hit['tm']}°C (recommend ≥48°C)")
            if hit["mismatches"] > 0:
                warnings.append(f"Mismatches in overlap at {junc_name}: {hit['mismatches']}bp ({hit['identity']}% identity)")

    # Check if all junctions were found
    all_found = all(j["found"] for j in junctions)
    if not all_found:
        return {
            "success": False,
            "product_seq": None,
            "product_annotations": [],
            "product_length": 0,
            "junctions": junctions,
            "warnings": warnings,
            "topology": "circular" if circular else "linear",
        }

    # ── Assemble the product ──
    # For each fragment, determine how much to trim:
    #   - Trim the 3' end where it overlaps with the next fragment
    #   - The overlap region from fragment B's 5' end gets trimmed (we keep A's copy)
    #
    # Strategy: for each fragment i, include from b_end of incoming junction to a_start + overlap of outgoing junction
    # Simpler: concatenate fragment sequences, trimming the overlap from the END of each fragment
    # (the next fragment's 5' starts at b_end, skipping the overlap portion)

    product_seq = ""
    product_annotations = []
    cursor = 0  # current position in product

    for i in range(n):
        frag = fragments[i]
        frag_seq = frag["seq"]
        frag_len = len(frag_seq)
        frag_anns = frag.get("annotations", []) or []

        # Determine trim at 5' (start) — from incoming junction
        trim_5 = 0
        incoming_key = None
        for (a, b) in pairs:
            if b == i:
                incoming_key = (a, b)
                break
        if incoming_key and overlap_info.get(incoming_key):
            hit = overlap_info[incoming_key]
            trim_5 = hit["b_end"]  # skip the overlap portion at fragment's 5' end

        # Determine trim at 3' (end) — we keep full 3' (next fragment trims its 5')
        # BUT for circular: last fragment's 3' overlaps with first fragment's 5'
        # We keep up to the end of the fragment

        # Extract the portion we keep
        kept_start = trim_5
        kept_end = frag_len
        kept_seq = frag_seq[kept_start:kept_end]

        if len(kept_seq) > 0:
            # Remap annotations
            remapped = _remap_annotations(frag_anns, cursor, frag_len, trim_start=kept_start, trim_end=kept_end)
            product_annotations.extend(remapped)

            product_seq += kept_seq
            cursor += len(kept_seq)

        # Add junction annotation at the overlap point
        outgoing_key = None
        for (a, b) in pairs:
            if a == i:
                outgoing_key = (a, b)
                break
        if outgoing_key and overlap_info.get(outgoing_key):
            hit = overlap_info[outgoing_key]
            # The junction is at the 3' end of this fragment's contribution
            junc_start = cursor - hit["overlap_len"] if cursor >= hit["overlap_len"] else cursor
            junc_end = cursor
            # Only add junction annotation for non-last fragment, or if circular for last→first
            junc_idx = [idx for idx, (a, b) in enumerate(pairs) if (a, b) == outgoing_key][0]
            product_annotations.append({
                "name": f"Junction {junc_idx + 1}: {junctions[junc_idx]['name']}",
                "start": junc_start,
                "end": junc_end,
                "direction": 1,
                "color": "rgba(41,128,185,0.3)",
                "type": "overlap",
            })

    topology = "circular" if circular else "linear"
    product_name = "Gibson Assembly"
    if len(fragments) <= 4:
        product_name = " + ".join(f["name"] for f in fragments)

    return {
        "success": True,
        "product_seq": product_seq,
        "product_annotations": product_annotations,
        "product_length": len(product_seq),
        "product_name": product_name,
        "junctions": junctions,
        "warnings": warnings,
        "topology": topology,
        "num_fragments": n,
    }


@router.post("/cloning/run-gibson-assembly")
def run_gibson_assembly_endpoint(body: RunGibsonAssemblyRequest):
    """Simulate Gibson assembly on pre-made fragments with overlaps."""
    frags = [{
        "name": f.name,
        "seq": f.seq,
        "annotations": f.annotations or [],
    } for f in body.fragments]
    return run_gibson_assembly(
        fragments=frags,
        circular=body.circular if body.circular is not None else True,
        min_overlap=body.min_overlap or 15,
        max_scan=body.max_overlap_scan or 60,
        min_identity=body.min_identity or 90.0,
    )


# ---------------------------------------------------------------------------
# In Silico Assembly — Golden Gate
# ---------------------------------------------------------------------------
def _find_type_iis_sites(seq: str, site: str, rc_site: str) -> list:
    """Find all occurrences of a Type IIS recognition site (both orientations).
    Returns list of dicts with position, orientation ('fwd' or 'rev'), and the site."""
    seq_upper = seq.upper()
    sites = []
    for pattern, orient in [(site.upper(), "fwd"), (rc_site.upper(), "rev")]:
        pos = 0
        while True:
            idx = seq_upper.find(pattern, pos)
            if idx == -1:
                break
            sites.append({"pos": idx, "orientation": orient, "site": pattern, "site_len": len(pattern)})
            pos = idx + 1
    sites.sort(key=lambda s: s["pos"])
    return sites


def _compute_sticky_end(seq: str, site_info: dict, enz: dict) -> dict | None:
    """Compute the sticky end generated by a Type IIS enzyme cut at a given site.

    For a forward site (5'→3' on top strand):
      cut is at site_pos + cut_offset on top strand
      bottom strand cut is at site_pos + cut_offset + overhang_len
      sticky end = seq[cut_offset : cut_offset + overhang_len] from the site position

    For a reverse complement site (enzyme binds bottom strand):
      cut is upstream of the site
      sticky end is on the 5' side
    """
    seq_upper = seq.upper()
    pos = site_info["pos"]
    orient = site_info["orientation"]
    cut_offset = enz["cut_offset"]
    oh_len = enz["overhang_len"]
    site_len = site_info["site_len"]

    if orient == "fwd":
        # Enzyme on top strand, cuts downstream
        cut_top = pos + site_len + (cut_offset - site_len)  # = pos + cut_offset for most enzymes
        # Actually: for BsaI site=GGTCTC (6bp), cut_offset=7 means cut 1bp after end of site
        # Top strand cut at pos + cut_offset, bottom at pos + cut_offset + oh_len
        cut_pos = pos + cut_offset
        if cut_pos + oh_len > len(seq_upper):
            return None
        sticky = seq_upper[cut_pos:cut_pos + oh_len]
        return {
            "sticky_end": sticky,
            "cut_pos": cut_pos,
            "side": "right",  # sticky end is on the right/downstream side
            "site_pos": pos,
            "orientation": orient,
        }
    else:
        # Reverse complement site — enzyme on bottom strand, cuts upstream
        # For rc_site at position pos, the cut is upstream
        # The recognition is on the bottom strand, reading 3'→5'
        # Cut position: pos - (cut_offset - site_len)
        # Actually for BsaI: rc_site=GAGACC, cut_offset=7, site_len=6
        # Bottom strand cut at pos - 1, top strand cut at pos - 1 - oh_len
        cut_pos = pos - (cut_offset - site_len)
        if cut_pos - oh_len < 0:
            return None
        sticky = seq_upper[cut_pos - oh_len:cut_pos]
        return {
            "sticky_end": sticky,
            "cut_pos": cut_pos - oh_len,
            "side": "left",  # sticky end is on the left/upstream side
            "site_pos": pos,
            "orientation": orient,
        }


def run_golden_gate_assembly(fragments: list, vector: dict = None,
                             enzyme: str = "BsaI") -> dict:
    """Simulate Golden Gate assembly: find Type IIS sites, compute sticky ends,
    match compatible fragments, and ligate."""
    if enzyme not in TYPE_IIS_ENZYMES:
        raise HTTPException(400, f"Unknown enzyme: {enzyme}. Supported: {', '.join(TYPE_IIS_ENZYMES.keys())}")

    enz = TYPE_IIS_ENZYMES[enzyme]
    site = enz["site"].upper()
    rc_site = enz["rc_site"].upper()
    oh_len = enz["overhang_len"]
    warnings = []

    # Collect all pieces (vector + fragments)
    all_pieces = []
    if vector and vector.get("seq"):
        all_pieces.append({"name": vector["name"], "seq": vector["seq"],
                           "annotations": vector.get("annotations", []) or [], "is_vector": True})
    for f in fragments:
        all_pieces.append({"name": f["name"], "seq": f["seq"],
                           "annotations": f.get("annotations", []) or [], "is_vector": False})

    if len(all_pieces) < 2:
        raise HTTPException(400, "Golden Gate assembly requires at least 2 pieces (fragments + optional vector)")

    # For each piece, find enzyme sites and compute sticky ends
    piece_cuts = []  # list of {piece_idx, name, left_sticky, right_sticky, insert_seq, insert_anns}
    for pi, piece in enumerate(all_pieces):
        seq = piece["seq"]
        sites = _find_type_iis_sites(seq, site, rc_site)

        if len(sites) < 2:
            warnings.append(f"{piece['name']}: found {len(sites)} {enzyme} site(s), need at least 2")
            piece_cuts.append({"piece_idx": pi, "name": piece["name"], "valid": False, "sites": len(sites)})
            continue

        # Check for internal sites (more than 2)
        if len(sites) > 2:
            warnings.append(f"{piece['name']}: found {len(sites)} {enzyme} sites (expected 2) — using outermost pair")

        # Use first and last site for cutting
        # The first site should produce a left sticky end (upstream)
        # The last site should produce a right sticky end (downstream)
        site_left = sites[0]
        site_right = sites[-1]

        cut_left = _compute_sticky_end(seq, site_left, enz)
        cut_right = _compute_sticky_end(seq, site_right, enz)

        if not cut_left or not cut_right:
            warnings.append(f"{piece['name']}: enzyme cuts fall outside sequence boundaries")
            piece_cuts.append({"piece_idx": pi, "name": piece["name"], "valid": False, "sites": len(sites)})
            continue

        # The insert region is between the two cuts
        # For a typical part: [site_fwd]---INSERT---[site_rev]
        # After cutting: left_sticky + INSERT + right_sticky
        # Determine which end is left and which is right based on cut positions
        if cut_left["cut_pos"] > cut_right["cut_pos"]:
            cut_left, cut_right = cut_right, cut_left

        # Extract the insert region between cuts (including sticky ends)
        left_pos = cut_left["cut_pos"]
        right_pos = cut_right["cut_pos"] + oh_len

        left_sticky = seq[left_pos:left_pos + oh_len].upper()
        right_sticky = seq[right_pos - oh_len:right_pos].upper()
        insert_seq = seq[left_pos + oh_len:right_pos - oh_len]

        # Remap annotations onto the insert region
        insert_anns = _remap_annotations(
            piece["annotations"],
            0,  # offset will be set during assembly
            len(seq),
            trim_start=left_pos + oh_len,
            trim_end=right_pos - oh_len,
        )

        piece_cuts.append({
            "piece_idx": pi,
            "name": piece["name"],
            "valid": True,
            "sites": len(sites),
            "left_sticky": left_sticky,
            "right_sticky": right_sticky,
            "insert_seq": insert_seq,
            "insert_anns": insert_anns,
            "insert_len": len(insert_seq),
            "is_vector": piece.get("is_vector", False),
        })

    # Check for palindromic overhangs
    valid_pieces = [p for p in piece_cuts if p.get("valid")]
    all_stickies = set()
    for p in valid_pieces:
        for s in [p["left_sticky"], p["right_sticky"]]:
            rc = _reverse_complement(s)
            if s == rc:
                warnings.append(f"Palindromic overhang '{s}' on {p['name']} — may cause mis-assembly")
            all_stickies.add(s)

    if len(valid_pieces) < 2:
        return {
            "success": False,
            "product_seq": None,
            "product_annotations": [],
            "product_length": 0,
            "pieces": piece_cuts,
            "assembly_order": [],
            "warnings": warnings,
        }

    # ── Determine assembly order by matching sticky ends ──
    # Build a graph: right_sticky of piece A → left_sticky of piece B
    # (right_sticky of A should match left_sticky of B for ligation)
    # In Golden Gate, matching means the overhangs are complementary
    # Actually, they're identical (not complementary) — the enzyme creates
    # compatible cohesive ends where the top strand overhang of the downstream
    # cut matches the top strand overhang of the upstream cut on the next piece.
    # So: right_sticky of piece A == left_sticky of piece B

    # Try to find a linear or circular ordering
    assembled_order = []
    used = set()

    # Start with vector if present, else find a starting piece
    start_piece = None
    for p in valid_pieces:
        if p.get("is_vector"):
            start_piece = p
            break
    if not start_piece:
        start_piece = valid_pieces[0]

    assembled_order.append(start_piece)
    used.add(start_piece["piece_idx"])
    current = start_piece

    # Greedily match right_sticky → left_sticky
    max_iterations = len(valid_pieces) + 1
    for _ in range(max_iterations):
        found_next = False
        for p in valid_pieces:
            if p["piece_idx"] in used:
                continue
            if p["left_sticky"] == current["right_sticky"]:
                assembled_order.append(p)
                used.add(p["piece_idx"])
                current = p
                found_next = True
                break
        if not found_next:
            break

    # Check if we used all valid pieces
    unused = [p for p in valid_pieces if p["piece_idx"] not in used]
    if unused:
        for p in unused:
            warnings.append(f"Unmatched fragment: {p['name']} (left: {p['left_sticky']}, right: {p['right_sticky']})")

    # Check circularization: last piece's right_sticky should match first piece's left_sticky
    is_circular = False
    if len(assembled_order) >= 2:
        if assembled_order[-1]["right_sticky"] == assembled_order[0]["left_sticky"]:
            is_circular = True
        else:
            warnings.append(
                f"Cannot circularize: last overhang '{assembled_order[-1]['right_sticky']}' "
                f"≠ first overhang '{assembled_order[0]['left_sticky']}'"
            )

    # ── Build the product sequence ──
    product_seq = ""
    product_annotations = []
    cursor = 0
    assembly_map = []

    for oi, piece in enumerate(assembled_order):
        insert = piece["insert_seq"]
        insert_len = len(insert)

        # Remap annotations with correct offset
        for ann in piece.get("insert_anns", []):
            product_annotations.append({
                "name": ann["name"],
                "start": ann["start"] + cursor,
                "end": ann["end"] + cursor,
                "direction": ann.get("direction", 1),
                "color": ann.get("color", "#95A5A6"),
                "type": ann.get("type", "misc_feature"),
            })

        product_seq += insert

        # Add overhang junction annotation
        if oi < len(assembled_order) - 1 or is_circular:
            next_piece = assembled_order[(oi + 1) % len(assembled_order)]
            overhang = piece["right_sticky"]
            # Add the overhang bases between pieces
            product_seq += overhang
            oh_start = cursor + insert_len
            oh_end = oh_start + len(overhang)
            product_annotations.append({
                "name": f"Overhang: {overhang}",
                "start": oh_start,
                "end": oh_end,
                "direction": 1,
                "color": "rgba(46,204,113,0.3)",
                "type": "overhang",
            })
            assembly_map.append({
                "from": piece["name"],
                "to": next_piece["name"],
                "overhang": overhang,
                "position": oh_start,
            })
            cursor = oh_end
        else:
            cursor += insert_len

    topology = "circular" if is_circular else "linear"
    product_name = f"GG Assembly ({enzyme})"
    if len(assembled_order) <= 4:
        product_name = " + ".join(p["name"] for p in assembled_order)

    return {
        "success": True,
        "product_seq": product_seq,
        "product_annotations": product_annotations,
        "product_length": len(product_seq),
        "product_name": product_name,
        "pieces": piece_cuts,
        "assembly_order": [{"name": p["name"], "left": p["left_sticky"], "right": p["right_sticky"]} for p in assembled_order],
        "assembly_map": assembly_map,
        "warnings": warnings,
        "topology": topology,
        "enzyme": enzyme,
        "is_circular": is_circular,
        "num_fragments": len(assembled_order),
    }


@router.post("/cloning/run-golden-gate-assembly")
def run_golden_gate_assembly_endpoint(body: RunGoldenGateAssemblyRequest):
    """Simulate Golden Gate assembly on fragments with existing Type IIS sites."""
    frags = [{
        "name": f.name,
        "seq": f.seq,
        "annotations": f.annotations or [],
    } for f in body.fragments]
    vec = None
    if body.vector and body.vector.seq:
        vec = {"name": body.vector.name, "seq": body.vector.seq,
               "annotations": body.vector.annotations or []}
    return run_golden_gate_assembly(
        fragments=frags,
        vector=vec,
        enzyme=body.enzyme or "BsaI",
    )

