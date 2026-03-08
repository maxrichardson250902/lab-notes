"""Tm Calculator feature — melting temperatures for primer pairs with different polymerases."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from core.database import register_table, get_db
import math

# ── Tables ───────────────────────────────────────────────────────────────────

register_table("tm_calculations", """CREATE TABLE IF NOT EXISTS tm_calculations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    primer_fwd  TEXT NOT NULL,
    seq_fwd     TEXT NOT NULL,
    primer_rev  TEXT NOT NULL,
    seq_rev     TEXT NOT NULL,
    polymerase  TEXT NOT NULL,
    tm_fwd      REAL NOT NULL,
    tm_rev      REAL NOT NULL,
    ta          REAL NOT NULL,
    created     TEXT NOT NULL)""")

# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["tm_calc"])

# ── Nearest-neighbor parameters (SantaLucia 1998) ────────────────────────────
# dH in kcal/mol, dS in cal/(mol·K)

NN_DH = {
    "AA": -7.9, "TT": -7.9, "AT": -7.2, "TA": -7.2,
    "CA": -8.5, "TG": -8.5, "GT": -8.4, "AC": -8.4,
    "CT": -7.8, "AG": -7.8, "GA": -8.2, "TC": -8.2,
    "CG": -10.6, "GC": -9.8, "GG": -8.0, "CC": -8.0,
}

NN_DS = {
    "AA": -22.2, "TT": -22.2, "AT": -20.4, "TA": -21.3,
    "CA": -22.7, "TG": -22.7, "GT": -22.4, "AC": -22.4,
    "CT": -21.0, "AG": -21.0, "GA": -22.2, "TC": -22.2,
    "CG": -27.2, "GC": -24.4, "GG": -19.9, "CC": -19.9,
}

INIT_DH = {"A": 2.3, "T": 2.3, "G": 0.1, "C": 0.1}
INIT_DS = {"A": 4.1, "T": 4.1, "G": -2.8, "C": -2.8}

# ── Polymerase buffer conditions ─────────────────────────────────────────────

POLYMERASES = {
    "q5": {
        "name": "Q5 High-Fidelity",
        "vendor": "NEB",
        "monovalent_mm": 70,
        "mg_mm": 2.0,
        "dntp_mm": 0.8,
        "ta_method": "lowest",
        "notes": "Use lowest Tm of the pair. For large Tm differences consider a 2-step protocol.",
    },
    "phusion": {
        "name": "Phusion High-Fidelity",
        "vendor": "Thermo Fisher",
        "monovalent_mm": 50,
        "mg_mm": 1.5,
        "dntp_mm": 0.8,
        "ta_method": "lowest",
        "notes": "Use lowest Tm of the pair for annealing temperature.",
    },
    "gotaq": {
        "name": "GoTaq G2",
        "vendor": "Promega",
        "monovalent_mm": 50,
        "mg_mm": 1.5,
        "dntp_mm": 0.8,
        "ta_method": "minus5",
        "notes": "Standard Taq-based. Ta = lowest Tm \u2212 5\u00b0C.",
    },
    "taq": {
        "name": "Standard Taq",
        "vendor": "Various",
        "monovalent_mm": 50,
        "mg_mm": 1.5,
        "dntp_mm": 0.8,
        "ta_method": "minus5",
        "notes": "Basic Taq polymerase. Ta = lowest Tm \u2212 5\u00b0C.",
    },
    "kapa_hifi": {
        "name": "KAPA HiFi",
        "vendor": "Roche",
        "monovalent_mm": 50,
        "mg_mm": 2.0,
        "dntp_mm": 0.8,
        "ta_method": "minus3",
        "notes": "High-fidelity. Ta = lowest Tm \u2212 3\u00b0C.",
    },
    "pfu": {
        "name": "Pfu Ultra II",
        "vendor": "Agilent",
        "monovalent_mm": 50,
        "mg_mm": 2.0,
        "dntp_mm": 0.8,
        "ta_method": "minus5",
        "notes": "Proofreading polymerase. Ta = lowest Tm \u2212 5\u00b0C.",
    },
    "dreamtaq": {
        "name": "DreamTaq",
        "vendor": "Thermo Fisher",
        "monovalent_mm": 50,
        "mg_mm": 2.0,
        "dntp_mm": 0.8,
        "ta_method": "minus5",
        "notes": "Enhanced Taq. Ta = lowest Tm \u2212 5\u00b0C.",
    },
    "platinum_ii": {
        "name": "Platinum II Hot-Start",
        "vendor": "Thermo Fisher",
        "monovalent_mm": 50,
        "mg_mm": 2.0,
        "dntp_mm": 0.8,
        "ta_method": "minus3",
        "notes": "Fast hot-start Taq. Ta = lowest Tm \u2212 3\u00b0C.",
    },
}


def _calc_nn_tm(seq: str, monovalent_mm: float, mg_mm: float, dntp_mm: float,
                primer_nm: float = 250.0) -> float:
    """Nearest-neighbor Tm with Owczarzy salt/Mg2+ correction."""
    seq = "".join(c for c in seq.upper() if c in "ACGT")
    if len(seq) < 6:
        raise ValueError("Sequence too short (need >= 6 bases)")

    dh = 0.0
    ds = 0.0
    for i in range(len(seq) - 1):
        pair = seq[i:i + 2]
        dh += NN_DH.get(pair, 0.0)
        ds += NN_DS.get(pair, 0.0)

    dh += INIT_DH.get(seq[0], 0) + INIT_DH.get(seq[-1], 0)
    ds += INIT_DS.get(seq[0], 0) + INIT_DS.get(seq[-1], 0)

    dh_cal = dh * 1000.0
    ct = primer_nm * 1e-9
    R = 1.987

    # basic Tm (1M salt)
    tm_basic = dh_cal / (ds + R * math.log(ct / 4.0)) - 273.15

    # free Mg2+
    free_mg = max(mg_mm - (dntp_mm * 0.5), 0.1)
    mono_m = monovalent_mm / 1000.0
    mg_m = free_mg / 1000.0
    ratio = math.sqrt(mg_m) / mono_m if mono_m > 0 else 10.0

    gc = sum(1 for c in seq if c in "GC") / len(seq)
    n = len(seq)

    if ratio < 0.22:
        # monovalent dominant
        ln_na = math.log(mono_m)
        inv_tm = (1.0 / (tm_basic + 273.15) +
                  (4.29 * gc - 3.95) * 1e-5 * ln_na +
                  9.40e-6 * ln_na * ln_na)
    else:
        # Mg2+ dominant (Owczarzy 2008)
        ln_mg = math.log(mg_m)
        a, b, c, d, e = 3.92e-5, -9.11e-6, 6.26e-5, 1.42e-5, -4.82e-4
        f_val, g = 5.25e-4, 8.31e-5
        inv_tm = (1.0 / (tm_basic + 273.15) +
                  a + b * ln_mg + gc * (c + d * ln_mg) +
                  (1.0 / (2.0 * (n - 1))) * (e + f_val * ln_mg + g * ln_mg * ln_mg))

    return round(1.0 / inv_tm - 273.15, 1)


def _calc_ta(tm_fwd: float, tm_rev: float, method: str) -> float:
    low = min(tm_fwd, tm_rev)
    if method == "lowest":
        return round(low, 1)
    elif method == "minus3":
        return round(low - 3.0, 1)
    else:
        return round(low - 5.0, 1)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/tm/polymerases")
def list_polymerases():
    result = []
    for key, p in POLYMERASES.items():
        result.append({"id": key, "name": p["name"], "vendor": p["vendor"], "notes": p["notes"]})
    return {"items": result}


class TmRequest(BaseModel):
    primer_fwd_id: Optional[int] = None
    primer_rev_id: Optional[int] = None
    seq_fwd: Optional[str] = None
    seq_rev: Optional[str] = None
    polymerase: str
    primer_nm: Optional[float] = 250.0


@router.post("/tm/calculate")
def calculate_tm(body: TmRequest):
    if body.polymerase not in POLYMERASES:
        raise HTTPException(400, f"Unknown polymerase: {body.polymerase}")

    poly = POLYMERASES[body.polymerase]
    fwd_name, rev_name = "Custom", "Custom"
    fwd_seq = (body.seq_fwd or "").strip()
    rev_seq = (body.seq_rev or "").strip()

    if body.primer_fwd_id:
        with get_db() as conn:
            row = conn.execute("SELECT name, sequence FROM primers WHERE id=?",
                               (body.primer_fwd_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Forward primer not found")
            fwd_name = row["name"]
            fwd_seq = row["sequence"] or ""

    if body.primer_rev_id:
        with get_db() as conn:
            row = conn.execute("SELECT name, sequence FROM primers WHERE id=?",
                               (body.primer_rev_id,)).fetchone()
            if not row:
                raise HTTPException(404, "Reverse primer not found")
            rev_name = row["name"]
            rev_seq = row["sequence"] or ""

    if not fwd_seq or not rev_seq:
        raise HTTPException(400, "Both primer sequences are required")

    # uppercase = annealing region, lowercase = overhang (ignored for Tm)
    fwd_full = "".join(c for c in fwd_seq if c in "ACGTacgt")
    rev_full = "".join(c for c in rev_seq if c in "ACGTacgt")
    fwd_clean = "".join(c for c in fwd_seq if c in "ACGT")  # annealing only
    rev_clean = "".join(c for c in rev_seq if c in "ACGT")  # annealing only
    fwd_overhang = len(fwd_full) - len(fwd_clean)
    rev_overhang = len(rev_full) - len(rev_clean)

    if len(fwd_clean) < 6 or len(rev_clean) < 6:
        raise HTTPException(400, "Annealing region must be at least 6 uppercase bases. Use lowercase for overhangs.")

    try:
        tm_fwd = _calc_nn_tm(fwd_clean, poly["monovalent_mm"], poly["mg_mm"],
                             poly["dntp_mm"], body.primer_nm or 250.0)
        tm_rev = _calc_nn_tm(rev_clean, poly["monovalent_mm"], poly["mg_mm"],
                             poly["dntp_mm"], body.primer_nm or 250.0)
    except ValueError as e:
        raise HTTPException(400, str(e))

    ta = _calc_ta(tm_fwd, tm_rev, poly["ta_method"])

    now = datetime.utcnow().isoformat()
    poly_label = f"{poly['name']} ({poly['vendor']})"
    with get_db() as conn:
        conn.execute(
            "INSERT INTO tm_calculations (primer_fwd, seq_fwd, primer_rev, seq_rev, "
            "polymerase, tm_fwd, tm_rev, ta, created) VALUES (?,?,?,?,?,?,?,?,?)",
            (fwd_name, fwd_seq, rev_name, rev_seq, body.polymerase, tm_fwd, tm_rev, ta, now))
        # save Tm back to primer records
        if body.primer_fwd_id:
            conn.execute("UPDATE primers SET tm=?, tm_polymerase=? WHERE id=?",
                         (tm_fwd, poly_label, body.primer_fwd_id))
        if body.primer_rev_id:
            conn.execute("UPDATE primers SET tm=?, tm_polymerase=? WHERE id=?",
                         (tm_rev, poly_label, body.primer_rev_id))
        conn.commit()

    return {
        "fwd": {"name": fwd_name, "sequence": fwd_seq, "length": len(fwd_full),
                "annealing_len": len(fwd_clean), "overhang_len": fwd_overhang,
                "gc": round(sum(1 for c in fwd_clean if c in "GC") / len(fwd_clean) * 100, 1),
                "tm": tm_fwd},
        "rev": {"name": rev_name, "sequence": rev_seq, "length": len(rev_full),
                "annealing_len": len(rev_clean), "overhang_len": rev_overhang,
                "gc": round(sum(1 for c in rev_clean if c in "GC") / len(rev_clean) * 100, 1),
                "tm": tm_rev},
        "polymerase": {"id": body.polymerase, "name": poly["name"], "vendor": poly["vendor"],
                       "notes": poly["notes"]},
        "ta": ta,
        "tm_diff": round(abs(tm_fwd - tm_rev), 1),
    }


@router.get("/tm/history")
def tm_history():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM tm_calculations ORDER BY created DESC LIMIT 50").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.delete("/tm/history/{calc_id}")
def delete_tm_calc(calc_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM tm_calculations WHERE id=?", (calc_id,))
        conn.commit()
    return {"ok": True}
