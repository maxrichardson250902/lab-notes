"""Plan Converter — Parse experimental plans into pipelines using the 3090 LLM."""
from fastapi import APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from core.database import register_table, get_db
from core.ssh import ensure_pc_online, start_llm, call_llm_3090, elog
import core.ssh as _ssh
import json, re

# ── Tables ────────────────────────────────────────────────────────────────────

register_table("plan_templates", """CREATE TABLE IF NOT EXISTS plan_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    plan_text   TEXT NOT NULL,
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

register_table("plan_conv_state", """CREATE TABLE IF NOT EXISTS plan_conv_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    stage       TEXT NOT NULL DEFAULT 'idle',
    result      TEXT,
    error       TEXT,
    updated     TEXT NOT NULL)""")

# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["plan_converter"])

# ── SQLite-backed conversion state (shared across workers) ────────────────────

def _get_state() -> dict:
    """Read conversion state from DB."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM plan_conv_state WHERE id=1").fetchone()
        if not row:
            return {"stage": "idle", "result": None, "error": None}
        result = None
        if row["result"]:
            try:
                result = json.loads(row["result"])
            except (json.JSONDecodeError, TypeError):
                result = row["result"]
        return {"stage": row["stage"], "result": result, "error": row["error"]}


_UNSET = object()  # sentinel to distinguish "not provided" from "set to None"


def _set_state(stage: str, result=_UNSET, error=_UNSET):
    """Write conversion state to DB (upsert)."""
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM plan_conv_state WHERE id=1").fetchone()
        if existing:
            parts = ["stage=?", "updated=?"]
            vals = [stage, now]
            if result is not _UNSET:
                parts.append("result=?")
                vals.append(json.dumps(result) if result is not None else None)
            if error is not _UNSET:
                parts.append("error=?")
                vals.append(error)
            vals.append(1)
            conn.execute(f"UPDATE plan_conv_state SET {', '.join(parts)} WHERE id=?", vals)
        else:
            result_json = json.dumps(result) if (result is not _UNSET and result is not None) else None
            error_val = error if error is not _UNSET else None
            conn.execute(
                "INSERT INTO plan_conv_state (id, stage, result, error, updated) VALUES (1,?,?,?,?)",
                (stage, result_json, error_val, now))
        conn.commit()


PLAN_SYSTEM = """You are a lab experiment planner. Parse the following experimental plan into a structured pipeline. Return JSON only, no other text.

Format:
{
  "name": "short pipeline name",
  "description": "brief description of the overall goal",
  "steps": [
    {
      "title": "short step title",
      "description": "detailed description of what to do",
      "day": 1,
      "end_day": 1,
      "duration_hours": 2,
      "dependencies": [],
      "category": "cloning|transformation|culture|purification|analysis|sequencing|other",
      "materials": ["list", "of", "materials"],
      "linked_protocols": ["protocol names if recognisable"],
      "linked_dna": ["primer/plasmid names if mentioned"]
    }
  ],
  "estimated_days": 6,
  "notes": "any overall notes or warnings"
}

Rules:
- Be thorough: split multi-part steps into separate steps.
- Identify dependencies: which steps must complete before others can start. Use 0-based indices.
- Recognise common lab protocol names (miniprep, transformation, gel electrophoresis, etc.).
- CRITICAL — day scheduling must be REALISTIC:
  - Overnight cultures: start Day N, results ready Day N+1 (not same day).
  - Transformations: plate Day N, colonies appear Day N+1 at earliest.
  - Sequencing: send Day N, results back Day N+3 to N+5 typically.
  - Protein expression: induction to harvest is often 4-16 hours or overnight.
  - Waiting steps (incubation, shipping, sequencing turnaround) MUST have their own day gap.
  - Do NOT compress multi-day processes into the same day.
  - If the plan says "Day 4-5: Wait for sequencing", those are real days — use day 4 and day 5.
  - When in doubt, add a buffer day rather than compress.
- Use "end_day" for multi-day steps: overnight culture day=1 end_day=2, sequencing wait day=4 end_day=6. Single-day steps: end_day equals day.
- Return ONLY valid JSON, no markdown fences, no preamble.
- Keep the total JSON under 3000 tokens — abbreviate descriptions if needed."""


def _parse_llm_json(raw: str):
    """Try to parse JSON from LLM output, with fallbacks."""
    if not raw:
        return None
    start = raw.find("{")
    if start == -1:
        return None
    txt = raw[start:]
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    last_complete = txt.rfind("},")
    if last_complete > 0:
        salvaged = txt[:last_complete + 1] + "]}"
        try:
            return json.loads(salvaged)
        except json.JSONDecodeError:
            pass
    return None


def _do_convert(plan_text: str):
    """Background: wake 3090 → start LLM → parse plan."""
    try:
        _ssh.enrich_running = True

        _set_state("waking")
        elog("Plan converter: waking 3090...")
        if not ensure_pc_online():
            _set_state("error", error="Could not wake 3090 — is it plugged in?")
            return

        _set_state("starting_llm")
        elog("Plan converter: starting LLM...")
        if not start_llm():
            _set_state("error", error="Could not start LLM server on 3090")
            return

        _set_state("parsing")
        elog("Plan converter: sending plan to LLM...")
        raw = call_llm_3090(PLAN_SYSTEM, plan_text, max_tokens=4000)

        parsed = _parse_llm_json(raw)
        if parsed and "steps" in parsed:
            for step in parsed["steps"]:
                for k in ("title", "description", "category"):
                    if k in step:
                        step[k] = str(step[k])
                for k in ("materials", "linked_protocols", "linked_dna", "dependencies"):
                    if k in step and isinstance(step[k], list):
                        step[k] = [str(x) for x in step[k]]
            _set_state("done", result=parsed)
            elog(f"Plan converter: parsed {len(parsed['steps'])} steps")
        else:
            _set_state("error", result={"raw": str(raw)},
                       error="LLM returned invalid JSON — you can still create steps manually")
            elog("Plan converter: invalid JSON from LLM")
    except Exception as e:
        _set_state("error", error=str(e))
        elog(f"Plan converter error: {e}")
    finally:
        _ssh.enrich_running = False


# ── Conversion endpoints ──────────────────────────────────────────────────────

class ConvertReq(BaseModel):
    plan_text: str


@router.post("/plan-converter/convert")
def start_convert(body: ConvertReq, bg: BackgroundTasks):
    state = _get_state()
    if state["stage"] not in ("idle", "done", "error"):
        raise HTTPException(409, "Conversion already in progress")
    _set_state("waking", result=None, error=None)
    bg.add_task(_do_convert, body.plan_text)
    return {"status": "started"}


@router.get("/plan-converter/status")
def conv_status():
    return _get_state()


@router.post("/plan-converter/reset")
def conv_reset():
    _set_state("idle", result=None, error=None)
    return {"ok": True}


# ── File upload ───────────────────────────────────────────────────────────────

@router.post("/plan-converter/upload")
async def upload_plan(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".txt", ".md")):
        raise HTTPException(400, "Only .txt and .md files accepted")
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    return {"text": text, "filename": file.filename}


# ── Templates CRUD ────────────────────────────────────────────────────────────

class TemplateSave(BaseModel):
    name: str
    plan_text: str


@router.get("/plan-converter/templates")
def list_templates():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM plan_templates ORDER BY updated DESC").fetchall()
    return {"items": [dict(r) for r in rows]}


@router.post("/plan-converter/templates")
def save_template(body: TemplateSave):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO plan_templates (name, plan_text, created, updated) VALUES (?,?,?,?)",
            (body.name, body.plan_text, now, now))
        conn.commit()
        row = dict(conn.execute(
            "SELECT * FROM plan_templates WHERE id=?", (cur.lastrowid,)).fetchone())
    return row


@router.put("/plan-converter/templates/{tid}")
def update_template(tid: int, body: TemplateSave):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute(
            "UPDATE plan_templates SET name=?, plan_text=?, updated=? WHERE id=?",
            (body.name, body.plan_text, now, tid))
        conn.commit()
        row = conn.execute(
            "SELECT * FROM plan_templates WHERE id=?", (tid,)).fetchone()
        if not row:
            raise HTTPException(404, "Template not found")
    return dict(row)


@router.delete("/plan-converter/templates/{tid}")
def delete_template(tid: int):
    with get_db() as conn:
        conn.execute("DELETE FROM plan_templates WHERE id=?", (tid,))
        conn.commit()
    return {"ok": True}


# ── Smart matching helpers ────────────────────────────────────────────────────

@router.get("/plan-converter/match-protocols")
def match_protocols(q: str = ""):
    with get_db() as conn:
        try:
            rows = conn.execute(
                "SELECT id, title FROM protocols WHERE LOWER(title) LIKE ? ORDER BY title LIMIT 10",
                (f"%{q.lower()}%",)).fetchall()
            return {"items": [dict(r) for r in rows]}
        except Exception:
            return {"items": []}


@router.get("/plan-converter/match-dna")
def match_dna(q: str = ""):
    with get_db() as conn:
        try:
            rows = conn.execute(
                "SELECT id, name, type FROM dna_items WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 10",
                (f"%{q.lower()}%",)).fetchall()
            return {"items": [dict(r) for r in rows]}
        except Exception:
            return {"items": []}


@router.get("/plan-converter/all-protocols")
def all_protocols():
    with get_db() as conn:
        try:
            rows = conn.execute("SELECT id, title FROM protocols ORDER BY title").fetchall()
            return {"items": [dict(r) for r in rows]}
        except Exception:
            return {"items": []}


@router.get("/plan-converter/dna-prefixes")
def dna_prefixes():
    with get_db() as conn:
        try:
            row = conn.execute(
                "SELECT value FROM settings WHERE key='dna_prefixes'").fetchone()
            if row:
                return {"prefixes": json.loads(row["value"])}
        except Exception:
            pass
    return {"prefixes": {"primer": ["MR", "PR"], "plasmid": ["pMR", "pPR", "p"]}}
