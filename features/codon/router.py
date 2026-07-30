"""Codon tools feature — usage viewer, optimisation (3 strategies), CAI scoring,
and codon harmonisation, with pluggable per-organism usage tables.

Codon tables live as JSON files in data/codon_tables/. E. coli W3110 ships built
in; users can add more by uploading/pasting a Kazusa/CUTG-format table, which is
parsed to the same schema and written as a new JSON file.
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List, Dict
import os, json, re, random, math

router = APIRouter(prefix="/api", tags=["codon"])

# ── Paths / built-in table ───────────────────────────────────────────────────
# Codon tables live in the persistent /data volume so user-added organisms
# survive rebuilds. NOTE: the repo's .dockerignore excludes data/ from the
# image, so the built-in E. coli table is embedded here as a literal and
# written into the volume at startup if absent (rather than COPY-seeded).
TABLES_DIR = os.environ.get("CODON_TABLES_DIR", "/data/codon_tables")
os.makedirs(TABLES_DIR, exist_ok=True)

_BUILTIN_ECOLI = json.loads('{"id": "ecoli_w3110", "name": "E. coli W3110", "taxid": "316407", "source": "Kazusa CUTG (GenBank gbbct); 4332 CDS / 1,372,057 codons", "genetic_code": 1, "coding_gc": 51.93, "codons": {"TTT": {"aa": "F", "fraction": 0.57, "per_thousand": 22.2}, "TCT": {"aa": "S", "fraction": 0.15, "per_thousand": 8.4}, "TAT": {"aa": "Y", "fraction": 0.57, "per_thousand": 16.1}, "TGT": {"aa": "C", "fraction": 0.44, "per_thousand": 5.1}, "TTC": {"aa": "F", "fraction": 0.43, "per_thousand": 16.5}, "TCC": {"aa": "S", "fraction": 0.15, "per_thousand": 8.6}, "TAC": {"aa": "Y", "fraction": 0.43, "per_thousand": 12.2}, "TGC": {"aa": "C", "fraction": 0.56, "per_thousand": 6.4}, "TTA": {"aa": "L", "fraction": 0.13, "per_thousand": 13.8}, "TCA": {"aa": "S", "fraction": 0.12, "per_thousand": 7.0}, "TAA": {"aa": "*", "fraction": 0.64, "per_thousand": 2.0}, "TGA": {"aa": "*", "fraction": 0.29, "per_thousand": 0.9}, "TTG": {"aa": "L", "fraction": 0.13, "per_thousand": 13.6}, "TCG": {"aa": "S", "fraction": 0.15, "per_thousand": 8.9}, "TAG": {"aa": "*", "fraction": 0.07, "per_thousand": 0.2}, "TGG": {"aa": "W", "fraction": 1.0, "per_thousand": 15.2}, "CTT": {"aa": "L", "fraction": 0.1, "per_thousand": 11.0}, "CCT": {"aa": "P", "fraction": 0.16, "per_thousand": 7.0}, "CAT": {"aa": "H", "fraction": 0.57, "per_thousand": 13.0}, "CGT": {"aa": "R", "fraction": 0.38, "per_thousand": 21.0}, "CTC": {"aa": "L", "fraction": 0.1, "per_thousand": 11.1}, "CCC": {"aa": "P", "fraction": 0.12, "per_thousand": 5.5}, "CAC": {"aa": "H", "fraction": 0.43, "per_thousand": 9.8}, "CGC": {"aa": "R", "fraction": 0.4, "per_thousand": 22.3}, "CTA": {"aa": "L", "fraction": 0.04, "per_thousand": 3.8}, "CCA": {"aa": "P", "fraction": 0.19, "per_thousand": 8.4}, "CAA": {"aa": "Q", "fraction": 0.35, "per_thousand": 15.4}, "CGA": {"aa": "R", "fraction": 0.06, "per_thousand": 3.5}, "CTG": {"aa": "L", "fraction": 0.5, "per_thousand": 53.1}, "CCG": {"aa": "P", "fraction": 0.53, "per_thousand": 23.4}, "CAG": {"aa": "Q", "fraction": 0.65, "per_thousand": 29.0}, "CGG": {"aa": "R", "fraction": 0.1, "per_thousand": 5.4}, "ATT": {"aa": "I", "fraction": 0.51, "per_thousand": 30.4}, "ACT": {"aa": "T", "fraction": 0.16, "per_thousand": 8.8}, "AAT": {"aa": "N", "fraction": 0.45, "per_thousand": 17.6}, "AGT": {"aa": "S", "fraction": 0.15, "per_thousand": 8.7}, "ATC": {"aa": "I", "fraction": 0.42, "per_thousand": 25.2}, "ACC": {"aa": "T", "fraction": 0.44, "per_thousand": 23.5}, "AAC": {"aa": "N", "fraction": 0.55, "per_thousand": 21.6}, "AGC": {"aa": "S", "fraction": 0.28, "per_thousand": 16.1}, "ATA": {"aa": "I", "fraction": 0.07, "per_thousand": 4.2}, "ACA": {"aa": "T", "fraction": 0.13, "per_thousand": 6.9}, "AAA": {"aa": "K", "fraction": 0.76, "per_thousand": 33.6}, "AGA": {"aa": "R", "fraction": 0.04, "per_thousand": 2.0}, "ATG": {"aa": "M", "fraction": 1.0, "per_thousand": 27.8}, "ACG": {"aa": "T", "fraction": 0.27, "per_thousand": 14.4}, "AAG": {"aa": "K", "fraction": 0.24, "per_thousand": 10.3}, "AGG": {"aa": "R", "fraction": 0.02, "per_thousand": 1.1}, "GTT": {"aa": "V", "fraction": 0.26, "per_thousand": 18.2}, "GCT": {"aa": "A", "fraction": 0.16, "per_thousand": 15.2}, "GAT": {"aa": "D", "fraction": 0.63, "per_thousand": 32.2}, "GGT": {"aa": "G", "fraction": 0.34, "per_thousand": 24.7}, "GTC": {"aa": "V", "fraction": 0.22, "per_thousand": 15.3}, "GCC": {"aa": "A", "fraction": 0.27, "per_thousand": 25.7}, "GAC": {"aa": "D", "fraction": 0.37, "per_thousand": 19.1}, "GGC": {"aa": "G", "fraction": 0.41, "per_thousand": 29.8}, "GTA": {"aa": "V", "fraction": 0.15, "per_thousand": 10.9}, "GCA": {"aa": "A", "fraction": 0.21, "per_thousand": 20.1}, "GAA": {"aa": "E", "fraction": 0.69, "per_thousand": 39.7}, "GGA": {"aa": "G", "fraction": 0.11, "per_thousand": 7.9}, "GTG": {"aa": "V", "fraction": 0.37, "per_thousand": 26.3}, "GCG": {"aa": "A", "fraction": 0.36, "per_thousand": 33.9}, "GAG": {"aa": "E", "fraction": 0.31, "per_thousand": 18.0}, "GGG": {"aa": "G", "fraction": 0.15, "per_thousand": 11.0}}}')

def _seed_builtin_tables():
    """Write embedded built-in tables into the persistent dir if absent."""
    try:
        dst = os.path.join(TABLES_DIR, _BUILTIN_ECOLI["id"] + ".json")
        if not os.path.isfile(dst):
            with open(dst, "w") as f:
                json.dump(_BUILTIN_ECOLI, f, indent=2)
    except Exception as e:
        print(f"  [codon] seed warning: {e}")

_seed_builtin_tables()

# Standard genetic code (code 1), DNA alphabet. Used for translation and to know
# the synonymous-codon groups when a usage table is loaded.
CODON_TO_AA = {
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

AA_TO_CODONS: Dict[str, List[str]] = {}
for _c, _a in CODON_TO_AA.items():
    AA_TO_CODONS.setdefault(_a, []).append(_c)

# Common Type IIS / restriction sites worth avoiding during optimisation. The
# Golden Gate enzymes are first; users can add more via the request.
DEFAULT_AVOID = {
    "BsaI": "GGTCTC", "BsmBI": "CGTCTC", "BbsI": "GAAGAC",
    "SapI": "GCTCTTC", "AarI": "CACCTGC",
    "EcoRI": "GAATTC", "BamHI": "GGATCC", "XhoI": "CTCGAG",
    "NdeI": "CATATG", "HindIII": "AAGCTT", "NcoI": "CCATGG",
}


def _revcomp(s: str) -> str:
    return s.translate(str.maketrans("ACGTN", "TGCAN"))[::-1]


# ── Table loading ────────────────────────────────────────────────────────────
def _list_tables() -> List[dict]:
    out = []
    if not os.path.isdir(TABLES_DIR):
        return out
    for fn in sorted(os.listdir(TABLES_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(TABLES_DIR, fn)) as f:
                t = json.load(f)
            out.append({"id": t.get("id", fn[:-5]), "name": t.get("name", fn[:-5]),
                        "source": t.get("source", ""), "taxid": t.get("taxid", "")})
        except Exception:
            continue
    return out


def _load_table(table_id: str) -> dict:
    path = os.path.join(TABLES_DIR, f"{table_id}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, f"Codon table '{table_id}' not found")
    with open(path) as f:
        return json.load(f)


def _relative_weights(table: dict) -> Dict[str, float]:
    """Per-codon 'w' weight for CAI = fraction / max(fraction within its AA group).
    Returns codon -> w in (0,1]."""
    codons = table["codons"]
    # max fraction per amino acid
    max_by_aa: Dict[str, float] = {}
    for cod, info in codons.items():
        aa = info["aa"]
        max_by_aa[aa] = max(max_by_aa.get(aa, 0.0), info["fraction"])
    w = {}
    for cod, info in codons.items():
        m = max_by_aa.get(info["aa"], 0.0)
        w[cod] = (info["fraction"] / m) if m > 0 else 0.0
    return w


# ── Translation ──────────────────────────────────────────────────────────────
def _clean_dna(seq: str) -> str:
    return "".join(ch for ch in (seq or "").upper() if ch.isalpha()).replace("U", "T")


def _translate(dna: str) -> str:
    dna = _clean_dna(dna)
    aa = []
    for i in range(0, len(dna) - 2, 3):
        aa.append(CODON_TO_AA.get(dna[i:i+3], "X"))
    return "".join(aa)


# ── CAI / usage scoring ──────────────────────────────────────────────────────
def _cai(dna: str, table: dict) -> Optional[float]:
    """Codon Adaptation Index (Sharp & Li 1987): geometric mean of per-codon w,
    excluding Met, Trp (single-codon) and stops."""
    w = _relative_weights(table)
    dna = _clean_dna(dna)
    logs = []
    for i in range(0, len(dna) - 2, 3):
        cod = dna[i:i+3]
        aa = CODON_TO_AA.get(cod)
        if aa in (None, "*", "M", "W"):
            continue
        wi = w.get(cod, 0.0)
        if wi > 0:
            logs.append(math.log(wi))
    if not logs:
        return None
    return round(math.exp(sum(logs) / len(logs)), 4)


def _gc(seq: str) -> float:
    seq = _clean_dna(seq)
    if not seq:
        return 0.0
    return round(100.0 * sum(1 for c in seq if c in "GC") / len(seq), 1)


# ── Constraint helpers for optimisation ──────────────────────────────────────
def _has_site(window: str, sites: List[str]) -> bool:
    for s in sites:
        if s in window or _revcomp(s) in window:
            return True
    return False


def _gc_window_ok(seq: str, win: int, lo: float, hi: float) -> bool:
    if len(seq) < win:
        g = _gc(seq)
        return lo <= g <= hi
    for i in range(0, len(seq) - win + 1):
        g = _gc(seq[i:i+win])
        if g < lo or g > hi:
            return False
    return True


def _homopolymer_ok(seq: str, max_run: int) -> bool:
    run = 1
    for i in range(1, len(seq)):
        if seq[i] == seq[i-1]:
            run += 1
            if run > max_run:
                return False
        else:
            run = 1
    return True


# ── Optimisation strategies ──────────────────────────────────────────────────
def _pick_codon(aa, table, strategy, rng, rank_target=None):
    """Choose a synonymous codon for an amino acid under a strategy.
    strategy: 'max' | 'sampled' | 'harmonise'.
    rank_target: for harmonise, the source-host fraction to match in rank."""
    cands = [c for c in AA_TO_CODONS.get(aa, []) if c in table["codons"] and CODON_TO_AA[c] != "*"]
    if not cands:
        return None
    fracs = {c: table["codons"][c]["fraction"] for c in cands}
    if strategy == "max":
        return max(cands, key=lambda c: fracs[c])
    if strategy == "sampled":
        total = sum(fracs.values()) or 1.0
        r = rng.random() * total
        acc = 0.0
        for c in sorted(cands, key=lambda c: -fracs[c]):
            acc += fracs[c]
            if r <= acc:
                return c
        return cands[0]
    if strategy == "harmonise":
        # match by rank: pick the host codon whose rank position equals the
        # source codon's rank (preserves relative rarity, not absolute identity)
        host_sorted = sorted(cands, key=lambda c: -fracs[c])
        if rank_target is None:
            return host_sorted[0]
        return host_sorted[min(rank_target, len(host_sorted) - 1)]
    return max(cands, key=lambda c: fracs[c])


def optimise_cds(protein_or_dna: str, table: dict, strategy: str = "sampled",
                 avoid_sites: Optional[List[str]] = None,
                 gc_lo: float = 30.0, gc_hi: float = 70.0, gc_win: int = 50,
                 max_homopolymer: int = 6, enforce_constraints: bool = True,
                 add_stop: bool = True, seed: int = 0,
                 source_table: Optional[dict] = None) -> dict:
    """Build an optimised CDS for a protein (or re-optimise an input CDS).

    If input looks like DNA (CDS), it is translated first; harmonise needs the
    source CDS so each codon's source-host rank can be preserved.
    Returns the optimised DNA plus before/after metrics and any constraint notes.
    """
    avoid_sites = avoid_sites or []
    rng = random.Random(seed)

    raw = _clean_dna(protein_or_dna)
    is_dna = bool(raw) and set(raw) <= set("ACGTN") and len(raw) % 3 == 0 and \
        sum(1 for i in range(0, len(raw) - 2, 3) if CODON_TO_AA.get(raw[i:i+3]) not in (None, None)) > 0
    # crude protein detection: contains amino-acid letters outside ACGTN
    looks_protein = bool(re.search(r"[^ACGTNU\s]", (protein_or_dna or "").upper()))

    source_codons = None
    if looks_protein:
        protein = "".join(ch for ch in protein_or_dna.upper() if ch.isalpha())
    else:
        protein = _translate(raw)
        source_codons = [raw[i:i+3] for i in range(0, len(raw) - 2, 3)]
    protein = protein.rstrip("*")

    # For harmonise: compute source-host rank for each source codon
    source_ranks = None
    if strategy == "harmonise":
        if not source_codons or not source_table:
            raise HTTPException(400, "Harmonise needs the original CDS (DNA) and a source organism table.")
        src_fr = source_table["codons"]
        source_ranks = []
        for cod in source_codons:
            aa = CODON_TO_AA.get(cod, "X")
            grp = [c for c in AA_TO_CODONS.get(aa, []) if c in src_fr and CODON_TO_AA[c] != "*"]
            grp_sorted = sorted(grp, key=lambda c: -src_fr[c]["fraction"])
            source_ranks.append(grp_sorted.index(cod) if cod in grp_sorted else 0)

    out = []
    notes = []
    for idx, aa in enumerate(protein):
        if aa not in AA_TO_CODONS:
            notes.append(f"position {idx+1}: unknown residue '{aa}' skipped")
            continue
        rank_target = source_ranks[idx] if source_ranks else None
        # Try a codon; if constraints on, attempt a few alternatives to avoid sites
        chosen = _pick_codon(aa, table, strategy, rng, rank_target)
        if chosen is None:
            continue
        if enforce_constraints and (avoid_sites or True):
            cands = sorted([c for c in AA_TO_CODONS[aa] if c in table["codons"] and CODON_TO_AA[c] != "*"],
                           key=lambda c: -table["codons"][c]["fraction"])
            for attempt in [chosen] + cands:
                tail = "".join(out[-3:]) + attempt   # check the new junction window
                if avoid_sites and _has_site(tail + "NN", avoid_sites):
                    continue
                if not _homopolymer_ok("".join(out[-6:]) + attempt, max_homopolymer):
                    continue
                chosen = attempt
                break
        out.append(chosen)

    dna = "".join(out)
    if add_stop:
        # use the host's most-frequent stop
        stops = sorted([c for c in AA_TO_CODONS["*"]],
                       key=lambda c: -table["codons"].get(c, {}).get("fraction", 0))
        dna += stops[0] if stops else "TAA"

    # Post-hoc constraint report
    site_hits = []
    for s in avoid_sites:
        for m in re.finditer(re.escape(s), dna):
            site_hits.append({"site": s, "pos": m.start(), "strand": "+"})
        for m in re.finditer(re.escape(_revcomp(s)), dna):
            site_hits.append({"site": s, "pos": m.start(), "strand": "-"})

    return {
        "dna": dna,
        "protein": protein,
        "length": len(dna),
        "strategy": strategy,
        "cai": _cai(dna, table),
        "gc": _gc(dna),
        "gc_window_ok": _gc_window_ok(dna, gc_win, gc_lo, gc_hi),
        "homopolymer_ok": _homopolymer_ok(dna, max_homopolymer),
        "remaining_sites": site_hits,
        "notes": notes,
    }


# ── Per-codon analysis for the viewer (heat-map data) ────────────────────────
def analyse_cds(dna: str, table: dict) -> dict:
    dna = _clean_dna(dna)
    w = _relative_weights(table)
    codons_info = table["codons"]
    per_codon = []
    rare_count = 0
    for i in range(0, len(dna) - 2, 3):
        cod = dna[i:i+3]
        aa = CODON_TO_AA.get(cod, "X")
        info = codons_info.get(cod, {})
        frac = info.get("fraction", 0.0)
        wi = w.get(cod, 0.0)
        is_rare = wi > 0 and wi < 0.2
        if is_rare:
            rare_count += 1
        per_codon.append({
            "i": i // 3, "codon": cod, "aa": aa,
            "fraction": frac, "w": round(wi, 3),
            "per_thousand": info.get("per_thousand", 0.0),
            "rare": is_rare,
        })
    return {
        "n_codons": len(per_codon),
        "cai": _cai(dna, table),
        "gc": _gc(dna),
        "rare_codons": rare_count,
        "per_codon": per_codon,
    }


# ── Kazusa / CUTG table parser (for 'add organism') ──────────────────────────
def parse_kazusa(text: str, name: str, table_id: str) -> dict:
    """Parse a pasted Kazusa-style block. Accepts the two common layouts:
       'UUU 19.7( 101)'  or  'UUU F 0.57 22.2 ( 30462)'.
    Computes per-AA fractions if not present. Returns the JSON-table dict."""
    text = text.replace("(", " ( ").replace(")", " ) ")
    tokens = text.split()
    counts: Dict[str, float] = {}
    perk: Dict[str, float] = {}
    n = len(tokens)
    codon_re = re.compile(r"^[ACGUTacgut]{3}$")
    float_re = re.compile(r"^\d+(\.\d+)?$")
    i = 0
    while i < n:
        tk = tokens[i]
        if not codon_re.match(tk):
            i += 1
            continue
        cod = tk.upper().replace("U", "T")
        if cod not in CODON_TO_AA:
            i += 1
            continue
        j = i + 1
        # optional amino-acid token (single letter A-Z or '*')
        if j < n and re.match(r"^[A-Za-z*]$", tokens[j]):
            j += 1
        # collect floats up to the '(' ; the float just before '(' is per-thousand
        floats = []
        while j < n and tokens[j] != "(" and not codon_re.match(tokens[j]):
            if float_re.match(tokens[j]):
                floats.append(float(tokens[j]))
            j += 1
        per_thousand = floats[-1] if floats else None   # last float before '(' is per-thousand
        count = None
        if j < n and tokens[j] == "(":
            k = j + 1
            while k < n and tokens[k] != ")":
                if float_re.match(tokens[k]):
                    count = float(tokens[k])
                k += 1
            j = k + 1 if k < n else k
        # store count if present, else fall back to per-thousand as the weight basis
        if count is not None:
            counts[cod] = count
        elif per_thousand is not None:
            counts[cod] = per_thousand
        if per_thousand is not None:
            perk[cod] = per_thousand
        i = j
    if len([c for c in counts if c in CODON_TO_AA]) < 60:
        raise HTTPException(400, "Could not parse at least 60 codons — check the pasted format.")
    total = sum(counts.values()) or 1.0
    # per-AA fraction
    by_aa: Dict[str, float] = {}
    for cod, n in counts.items():
        aa = CODON_TO_AA.get(cod, "X")
        by_aa[aa] = by_aa.get(aa, 0.0) + n
    codons = {}
    for cod in CODON_TO_AA:
        n = counts.get(cod, 0.0)
        aa = CODON_TO_AA[cod]
        frac = (n / by_aa[aa]) if by_aa.get(aa, 0) > 0 else 0.0
        codons[cod] = {"aa": aa,
                       "fraction": round(frac, 3),
                       "per_thousand": round(perk.get(cod, 1000.0 * n / total), 1)}
    return {"id": table_id, "name": name, "taxid": "",
            "source": "user upload (Kazusa/CUTG format)", "genetic_code": 1,
            "coding_gc": None, "codons": codons}


# ── Request models ───────────────────────────────────────────────────────────
class AnalyseRequest(BaseModel):
    sequence: str
    table_id: str = "ecoli_w3110"

class OptimiseRequest(BaseModel):
    sequence: str                       # protein (1-letter) or CDS DNA
    table_id: str = "ecoli_w3110"
    strategy: str = "sampled"           # 'max' | 'sampled' | 'harmonise'
    source_table_id: Optional[str] = None  # required for harmonise
    avoid_sites: Optional[List[str]] = None      # names from DEFAULT_AVOID or raw seqs
    enforce_constraints: bool = True
    gc_lo: float = 30.0
    gc_hi: float = 70.0
    gc_win: int = 50
    max_homopolymer: int = 6
    add_stop: bool = True
    seed: int = 0

class AddTableRequest(BaseModel):
    name: str
    table_id: str
    text: str                            # pasted Kazusa block


class BatchOptimiseItem(BaseModel):
    name: Optional[str] = ""
    sequence: str

class BatchOptimiseRequest(BaseModel):
    items: List[BatchOptimiseItem]
    table_id: str = "ecoli_w3110"
    strategy: str = "sampled"
    source_table_id: Optional[str] = None
    avoid_sites: Optional[List[str]] = None   # defaults to ["BsaI"] for Bin-readiness if None
    enforce_constraints: bool = True
    gc_lo: float = 30.0
    gc_hi: float = 70.0
    gc_win: int = 50
    max_homopolymer: int = 6
    add_stop: bool = True
    seed: int = 0


def _parse_named_seq_text(text: str, delimiter: str = ",", has_header: bool = False) -> List[dict]:
    """Parse one entry per line. The FIRST token is the name, the rest is the
    sequence. Splits on comma, tab, or any whitespace — so 'name,SEQ', 'name\\tSEQ',
    and 'name   SEQ' all work, matching however the user's design list is formatted.

    A line with only one token is treated as a bare sequence (name left blank,
    flagged downstream). If a line's first token already looks like sequence
    (all DNA/protein letters) AND there's no second token, it's sequence-only.
    """
    out = []
    lines = [ln for ln in (text or "").splitlines() if ln.strip()]
    if has_header and lines:
        lines = lines[1:]
    for ln in lines:
        # split on comma first if present, else any whitespace
        if "," in ln:
            parts = [p.strip() for p in ln.split(",") if p.strip()]
        else:
            parts = ln.split()  # any run of whitespace (tabs/spaces)
        if not parts:
            continue
        if len(parts) == 1:
            # single token: treat as bare sequence (no name)
            out.append({"name": "", "sequence": parts[0]})
        else:
            # first token = name, everything after = sequence (joined, in case
            # the sequence itself had internal spaces/wrapping)
            name = parts[0]
            seq = "".join(parts[1:])
            out.append({"name": name, "sequence": seq})
    return out


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/codon/tables")
def list_tables():
    return {"tables": _list_tables(), "avoid_presets": DEFAULT_AVOID}


@router.get("/codon/tables/{table_id}")
def get_table(table_id: str):
    t = _load_table(table_id)
    # attach derived weights so the viewer can show "best codon" per AA
    t["weights"] = _relative_weights(t)
    return t


@router.post("/codon/analyse")
def analyse(body: AnalyseRequest):
    table = _load_table(body.table_id)
    seq = _clean_dna(body.sequence)
    if len(seq) < 3:
        raise HTTPException(400, "Provide a CDS of at least one codon.")
    res = analyse_cds(seq, table)
    res["protein"] = _translate(seq)
    res["table"] = {"id": table["id"], "name": table["name"]}
    return res


@router.post("/codon/optimise")
def optimise(body: OptimiseRequest):
    table = _load_table(body.table_id)
    src_table = _load_table(body.source_table_id) if body.source_table_id else None

    # resolve avoid-site names to sequences
    sites = []
    for s in (body.avoid_sites or []):
        s = s.strip()
        if not s:
            continue
        sites.append(DEFAULT_AVOID.get(s, s.upper()))

    result = optimise_cds(
        body.sequence, table, strategy=body.strategy, avoid_sites=sites,
        gc_lo=body.gc_lo, gc_hi=body.gc_hi, gc_win=body.gc_win,
        max_homopolymer=body.max_homopolymer,
        enforce_constraints=body.enforce_constraints, add_stop=body.add_stop,
        seed=body.seed, source_table=src_table,
    )

    # before/after comparison if input was DNA
    raw = _clean_dna(body.sequence)
    looks_protein = bool(re.search(r"[^ACGTNU\s]", (body.sequence or "").upper()))
    if not looks_protein and len(raw) >= 3:
        result["before"] = {"cai": _cai(raw, table), "gc": _gc(raw),
                            "length": len(raw)}
    result["table"] = {"id": table["id"], "name": table["name"]}
    return result


def _resolve_avoid(names):
    sites = []
    for s in (names or []):
        s = (s or "").strip()
        if s:
            sites.append(DEFAULT_AVOID.get(s, s.upper()))
    return sites


@router.post("/codon/optimise-batch")
def optimise_batch(body: BatchOptimiseRequest):
    """Optimise many sequences at once. Defaults to avoiding BsaI so the output
    is ready to paste into the gBlock Bin (where BsaI overhangs get added).
    Returns per-item optimised DNA + metrics and a ready-to-copy TSV list."""
    table = _load_table(body.table_id)
    src_table = _load_table(body.source_table_id) if body.source_table_id else None
    # Bin-ready default: if caller didn't specify avoid_sites, avoid BsaI.
    avoid = _resolve_avoid(body.avoid_sites if body.avoid_sites is not None else ["BsaI"])

    results = []
    for i, it in enumerate(body.items):
        name = (it.name or f"seq_{i+1}").strip()
        item = {"name": name, "ok": False, "dna": None, "length": 0,
                "cai": None, "gc": None, "warnings": [], "blocking": False}
        seq = (it.sequence or "").strip()
        if not seq:
            item["warnings"].append("empty sequence")
            item["blocking"] = True
            results.append(item)
            continue
        try:
            r = optimise_cds(seq, table, strategy=body.strategy, avoid_sites=avoid,
                             gc_lo=body.gc_lo, gc_hi=body.gc_hi, gc_win=body.gc_win,
                             max_homopolymer=body.max_homopolymer,
                             enforce_constraints=body.enforce_constraints,
                             add_stop=body.add_stop, seed=body.seed + i,
                             source_table=src_table)
        except HTTPException as e:
            item["warnings"].append(str(e.detail))
            item["blocking"] = True
            results.append(item)
            continue
        item.update({"dna": r["dna"], "length": r["length"], "cai": r["cai"], "gc": r["gc"]})
        # Hard problems (block OK): an avoided enzyme site that could not be removed
        # — these break gBlock-Bin readiness. Soft warnings (do NOT block OK): GC
        # window excursions, which are informational for ordering.
        blocking = False
        if r.get("remaining_sites"):
            item["warnings"].append(f"{len(r['remaining_sites'])} avoided site(s) could not be removed")
            blocking = True
        if r.get("gc_window_ok") is False:
            item["warnings"].append("GC window out of bounds (informational)")
        item["blocking"] = blocking
        item["ok"] = not blocking
        results.append(item)

    n_ok = sum(1 for r in results if r["ok"])
    tsv = "\n".join(f"{r['name']},{r['dna']}" for r in results if r["dna"])
    return {
        "table": {"id": table["id"], "name": table["name"]},
        "strategy": body.strategy,
        "avoided": avoid,
        "n": len(results), "n_ok": n_ok, "n_flagged": len(results) - n_ok,
        "results": results,
        "tsv": tsv,
    }


@router.post("/codon/parse-upload")
async def codon_parse_upload(file: UploadFile = File(...),
                             name_header: str = Form(None),
                             seq_header: str = Form(None)):
    """Parse an uploaded CSV/TSV/Excel into [{name, sequence}] for batch optimise.
    Columns matched by header (name / sequence) with sensible fallbacks."""
    import io, csv as _csv
    contents = await file.read()
    ext = os.path.splitext(file.filename or "upload")[1].lower()
    if ext in (".xlsx", ".xls"):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(400, "Excel support requires openpyxl on the server.")
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            raise HTTPException(400, "Spreadsheet is empty")
        headers = [str(c) if c is not None else f"Column {i+1}" for i, c in enumerate(rows[0])]
        data = rows[1:]
    elif ext in (".csv", ".tsv"):
        text = contents.decode("utf-8-sig", errors="replace")
        delim = "\t" if ext == ".tsv" else ","
        allr = list(_csv.reader(io.StringIO(text), delimiter=delim))
        if not allr:
            raise HTTPException(400, "File is empty")
        headers = [c if c.strip() else f"Column {i+1}" for i, c in enumerate(allr[0])]
        data = allr[1:]
    else:
        raise HTTPException(400, "Unsupported file type. Upload .csv, .tsv, or .xlsx.")

    low = [str(h).strip().lower() for h in headers]
    def _match(cands):
        for c in cands:
            if c in low:
                return low.index(c)
        for i, h in enumerate(low):
            for c in cands:
                if c in h:
                    return i
        return None
    name_col = headers.index(name_header) if (name_header and name_header in headers) else _match(["name", "id", "design", "construct", "part"])
    seq_col = headers.index(seq_header) if (seq_header and seq_header in headers) else _match(["sequence", "seq", "dna", "protein", "aa", "nt"])
    if seq_col is None:
        return {"ok": False, "headers": headers, "items": [],
                "reason": "Could not find a sequence column — pick one manually."}
    items = []
    for row in data:
        cells = list(row)
        nm = str(cells[name_col]).strip() if (name_col is not None and name_col < len(cells) and cells[name_col] is not None) else ""
        sq = str(cells[seq_col]).strip() if (seq_col < len(cells) and cells[seq_col] is not None) else ""
        if not sq:
            continue
        items.append({"name": nm, "sequence": sq})
    return {"ok": True, "headers": headers, "items": items, "n": len(items)}


@router.post("/codon/parse-paste")
def codon_parse_paste(body: dict):
    text = body.get("text", "")
    delim = body.get("delimiter", ",")
    has_header = bool(body.get("has_header", False))
    items = _parse_named_seq_text(text, delim, has_header)
    return {"ok": True, "items": items, "n": len(items)}


@router.post("/codon/add-table")
def add_table(body: AddTableRequest):
    tid = re.sub(r"[^a-z0-9_]", "_", body.table_id.lower().strip())
    if not tid:
        raise HTTPException(400, "Provide a valid table id (letters/numbers/underscore).")
    path = os.path.join(TABLES_DIR, f"{tid}.json")
    table = parse_kazusa(body.text, body.name.strip() or tid, tid)
    with open(path, "w") as f:
        json.dump(table, f, indent=2)
    return {"ok": True, "id": tid, "name": table["name"], "n_codons": len(table["codons"])}


@router.post("/codon/add-table-upload")
async def add_table_upload(file: UploadFile = File(...),
                           name: str = Form(...), table_id: str = Form(...)):
    contents = (await file.read()).decode("utf-8", errors="replace")
    return add_table(AddTableRequest(name=name, table_id=table_id, text=contents))


@router.delete("/codon/tables/{table_id}")
def delete_table(table_id: str):
    if table_id == "ecoli_w3110":
        raise HTTPException(400, "The built-in E. coli table cannot be deleted.")
    path = os.path.join(TABLES_DIR, f"{table_id}.json")
    if not os.path.isfile(path):
        raise HTTPException(404, "Not found")
    os.remove(path)
    return {"ok": True, "deleted": table_id}
