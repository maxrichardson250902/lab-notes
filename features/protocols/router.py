"""Protocols feature - protocol library with LLM extraction, manual entry, recipe tables, and run history."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import json, re, io, asyncio

# Only one LLM extraction at a time to prevent OOM from concurrent SSH+LLM calls
_llm_semaphore = asyncio.Semaphore(1)

# Track protocols currently being extracted in background
_extracting: dict[int, str] = {}   # pid -> stage description

from core.database import register_table, get_db
from core.llm import fetch_url_text
from core.ssh import ensure_pc_online, start_llm, call_llm_3090, enrich_log, elog, detected_os, active_backend

register_table("protocols", """CREATE TABLE IF NOT EXISTS protocols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'url',
    url         TEXT DEFAULT NULL,
    source_text TEXT DEFAULT NULL,
    steps       TEXT DEFAULT NULL,
    recipe      TEXT DEFAULT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    created     TEXT NOT NULL,
    updated     TEXT NOT NULL)""")

register_table("active_runs", """CREATE TABLE IF NOT EXISTS active_runs (
    run_id       TEXT PRIMARY KEY,
    protocol_id  INTEGER NOT NULL,
    protocol_json TEXT NOT NULL,
    steps_json   TEXT NOT NULL DEFAULT '[]',
    recipe_json  TEXT DEFAULT NULL,
    group_name   TEXT NOT NULL DEFAULT '',
    subgroup     TEXT NOT NULL DEFAULT '',
    scaling      INTEGER NOT NULL DEFAULT 0,
    scale_factor REAL NOT NULL DEFAULT 1.0,
    started_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL)""")

register_table("protocol_runs", """CREATE TABLE IF NOT EXISTS protocol_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol_id  INTEGER NOT NULL,
    date         TEXT NOT NULL,
    group_name   TEXT NOT NULL DEFAULT '',
    steps_done   INTEGER NOT NULL DEFAULT 0,
    steps_total  INTEGER NOT NULL DEFAULT 0,
    deviations   INTEGER NOT NULL DEFAULT 0,
    steps_json   TEXT DEFAULT NULL,
    recipe_json  TEXT DEFAULT NULL,
    entry_id     INTEGER DEFAULT NULL,
    created      TEXT NOT NULL)""")

def _migrate():
    with get_db() as conn:
        for stmt in [
            "ALTER TABLE protocols ADD COLUMN source_type TEXT NOT NULL DEFAULT 'url'",
            "ALTER TABLE protocols ADD COLUMN recipe TEXT DEFAULT NULL",
            "ALTER TABLE protocols ADD COLUMN auto_complete TEXT NOT NULL DEFAULT 'manual'",
        ]:
            try:
                conn.execute(stmt)
                conn.commit()
            except Exception:
                pass
_migrate()

# --------------------------------------------------------------------------- #
#  LLM helpers
# --------------------------------------------------------------------------- #
_EXTRACT_SYSTEM = (
    "You are a lab notebook assistant. Extract the procedural steps from the protocol below. "
    "Return a JSON array of objects, each with a single key 'text'. "
    "Rules: "
    "- Include every action step with volumes, temperatures, times, and speeds. "
    "- Skip steps that only list ingredients or describe how to make a buffer/solution - those are captured separately. "
    "- Be concise but complete - preserve all numerical values. "
    "- Return ONLY the JSON array, no markdown fences, no commentary. "
    'Example: [{"text":"Add 1 uL template DNA to PCR tube"},{"text":"Thermocycle: 98C 30s, 35x(98C 10s/60C 30s/72C 20s/kb), 72C 2min"}]'
)

# Pass 1: enumerate all tables in the document
_ENUMERATE_TABLES_SYSTEM = (
    "You are a lab notebook assistant. Read this protocol and list every distinct reaction mixture, "
    "buffer, solution, or reagent setup it describes. "
    "Return ONLY a JSON array of short descriptive names, one per table. "
    'Example: ["50x TAE buffer", "PCR master mix", "SDS-PAGE running buffer", "Western transfer buffer"] '
    "If there are no component lists at all, return []. "
    "JSON array only, no markdown."
)

# Pass 2: extract one specific named table
_EXTRACT_ONE_TABLE_SYSTEM = (
    "You are a lab notebook assistant. Extract the complete component list for the table named below from this protocol. "
    "Return a JSON object with: "
    "  'columns': array of column header strings (use relevant subset of: Component, Stock conc., Volume (uL), Final conc., Weight, Notes) "
    "  'rows': array of arrays, one per component, matching the columns order. "
    "Include every component, reagent, and chemical mentioned for this specific table. "
    "Then output /// on its own line to signal completion. "
    "Output the JSON object first, then ///, nothing else."
)

# ── Reparse tables from source text ──────────────────────────────────────────
_REPARSE_TABLES_SYSTEM = (
    "You are a lab notebook assistant. The user has a protocol with messy or incorrect reagent tables. "
    "Given the original source text and the current (possibly broken) tables, produce corrected tables. "
    "Return a JSON array of table objects. Each has: "
    "  'name': descriptive table name, "
    "  'columns': array of column headers, "
    "  'rows': array of arrays matching column order. "
    "Fix: misaligned data, wrong columns, missing components, inconsistent units, duplicate rows. "
    "Preserve all original data — only restructure and correct, don't remove real components. "
    "Return ONLY the JSON array, no markdown fences."
)

# ── Protocol review — suggest improvements ───────────────────────────────────
_REVIEW_SYSTEM = (
    "You are an expert lab protocol reviewer. Analyse the protocol below and suggest improvements. "
    "For each suggestion, return a JSON object in an array. Each object has: "
    "  'type': 'step' | 'table' | 'general', "
    "  'index': step number (0-based) or table index, or null for general, "
    "  'field': which part to change — 'text', 'note', 'cell', or 'new_step', "
    "  'original': the current text (empty string for new additions), "
    "  'suggested': the improved text, "
    "  'reason': 1-sentence explanation of why this change helps. "
    "Focus on: "
    "- Missing temperatures, times, volumes, or speeds "
    "- Ambiguous instructions that could cause errors "
    "- Missing centrifugation speeds or incubation conditions "
    "- Steps that should be split for clarity "
    "- Common best practices for this type of protocol "
    "- Table errors: wrong units, missing reagents, impossible concentrations "
    "Return 3-10 suggestions, ordered by importance. "
    "Return ONLY the JSON array, no markdown fences, no commentary."
)

def _clean_source_text(text: str, truncate: int = 0) -> str:
    """Strip HTML/entities. Pass truncate>0 to limit length for LLM calls."""
    if not text:
        return ""
    text = re.sub(r'<style[^>]*>.*?</style>', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&[a-z]+;', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:truncate] if truncate else text

def _parse_steps_raw(raw: str) -> str:
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    try:
        steps = json.loads(cleaned)
        if isinstance(steps, list):
            parsed = [{"text": str(s["text"])} for s in steps if "text" in s and str(s["text"]).strip()]
            if parsed:
                return json.dumps(parsed)
    except Exception:
        pass
    steps = []
    for line in raw.splitlines():
        line = re.sub(r"^\d+[\.\)]\s*", "", line.strip())
        if line and len(line) > 4:
            steps.append({"text": line})
    return json.dumps(steps) if steps else json.dumps([])

def _parse_recipe_raw(raw: str):
    if "///" in raw:
        raw = raw[:raw.index("///")]
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    m = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if m:
        cleaned = m.group()
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict) and "columns" in data and "rows" in data:
            cols = [str(c) for c in data["columns"] if str(c).strip()]
            rows = []
            for row in data["rows"]:
                if isinstance(row, list):
                    rows.append([str(c) for c in row])
            if cols:
                return json.dumps({"columns": cols, "rows": rows})
    except Exception:
        pass
    return None

async def _ensure_3090_ready() -> bool:
    """Wake the 3090 and start the LLM once. Subsequent calls are near-instant."""
    loop = asyncio.get_event_loop()
    def _init():
        try:
            elog("Protocol extraction: checking 3090...")
            if not ensure_pc_online():
                elog("Protocol extraction: 3090 failed to come online")
                return False
            if not start_llm():
                elog("Protocol extraction: LLM failed to start")
                return False
            elog("Protocol extraction: 3090 ready")
            return True
        except Exception as e:
            elog(f"Protocol extraction: init error — {e}")
            return False
    return await loop.run_in_executor(None, _init)

async def _call_3090(system: str, prompt: str, max_tokens: int) -> str:
    """Run a single LLM call on the 3090. Assumes _ensure_3090_ready() was called."""
    loop = asyncio.get_event_loop()
    def _call():
        try:
            return call_llm_3090(system, prompt, max_tokens=max_tokens) or ""
        except Exception as e:
            elog(f"LLM call failed: {e}")
            return ""
    async with _llm_semaphore:
        return await loop.run_in_executor(None, _call)

async def extract_steps(title: str, source_text: str) -> str:
    clean_text = _clean_source_text(source_text, truncate=5000)
    prompt = "Protocol: " + title + "\n\nText:\n" + clean_text
    elog("Extracting steps...")
    raw = await _call_3090(_EXTRACT_SYSTEM, prompt, max_tokens=2000)
    if raw:
        result = _parse_steps_raw(raw)
        if result != "[]":
            elog("Steps extracted OK")
            return result
    elog("Step extraction returned empty")
    return json.dumps([])


async def extract_recipe(title: str, source_text: str) -> str:
    clean_text = _clean_source_text(source_text)
    # ── Pass 1: enumerate table names ────────────────────────────────────────
    elog("Enumerating recipe tables...")
    enum_prompt = "Protocol: " + title + "\n\nText:\n" + clean_text
    raw_names = await _call_3090(_ENUMERATE_TABLES_SYSTEM, enum_prompt, max_tokens=400)

    # parse the table name list
    table_names = []
    try:
        cleaned = re.sub(r"^```[a-z]*\n?", "", raw_names.strip())
        cleaned = re.sub(r"\n?```$", "", cleaned.strip())
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            table_names = [str(n).strip() for n in parsed if str(n).strip()]
    except Exception:
        pass

    if not table_names:
        # fallback: single-table extraction
        elog("No named tables found, trying single-table extraction...")
        single_prompt = "Protocol: " + title + "\n\nText:\n" + clean_text
        raw = await _call_3090(
            "Extract the reaction/reagent table as JSON {columns:[...], rows:[[...],...]} then ///.",
            single_prompt, max_tokens=600)
        result = _parse_recipe_raw(raw)
        return result if result else json.dumps(DEFAULT_RECIPE)

    # ── Pass 2: extract each table individually ───────────────────────────────
    elog(f"Found {len(table_names)} table(s), extracting each...")
    tables = []
    for i, name in enumerate(table_names[:10]):
        elog(f"Extracting table {i+1}/{min(len(table_names), 10)}: {name}")
        tbl_prompt = (
            "Table to extract: " + name + "\n\n"
            "Protocol: " + title + "\n\nText:\n" + clean_text
        )
        raw = await _call_3090(_EXTRACT_ONE_TABLE_SYSTEM, tbl_prompt, max_tokens=1200)
        result = _parse_recipe_raw(raw)
        if result:
            try:
                tbl = json.loads(result)
                if tbl.get("rows"):  # only include tables with actual data
                    tbl["name"] = name
                    tables.append(tbl)
            except Exception:
                pass

    if not tables:
        return json.dumps(DEFAULT_RECIPE)
    if len(tables) == 1:
        return json.dumps(tables[0])  # single table — store without array wrapper
    return json.dumps(tables)  # multi-table array

async def _bg_extract(pid: int, title: str, source_text: str):
    """Background extraction — saves steps + recipe into the DB when done."""
    _extracting[pid] = "waking"
    try:
        if not await _ensure_3090_ready():
            elog(f"Background extraction failed for #{pid}: 3090 unavailable")
            _extracting[pid] = "failed"
            return
        _extracting[pid] = "steps"
        steps = await extract_steps(title, source_text)
        _extracting[pid] = "tables"
        recipe = await extract_recipe(title, source_text)
        with get_db() as conn:
            conn.execute("UPDATE protocols SET steps=?, recipe=?, updated=? WHERE id=?",
                         (steps, recipe, datetime.utcnow().isoformat(), pid))
            conn.commit()
        elog(f"Background extraction complete for #{pid}")
        _extracting[pid] = "done"
    except Exception as e:
        elog(f"Background extraction error for #{pid}: {e}")
        _extracting[pid] = "failed"
    finally:
        # Clear status after a few seconds so the frontend can read the final state
        await asyncio.sleep(5)
        _extracting.pop(pid, None)

async def _text_from_upload(file: UploadFile) -> str:
    content = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".pdf"):
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            return " ".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            raise HTTPException(400, "pypdf not installed")
    if fname.endswith(".docx"):
        try:
            import docx
            from docx.oxml.ns import qn
            doc = docx.Document(io.BytesIO(content))
            lines = []
            for p in doc.paragraphs:
                t = p.text.strip()
                if t:
                    lines.append(t)
            for table in doc.tables:
                for row in table.rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        lines.append(" | ".join(cells))
            for el in doc.element.body.iter():
                if el.tag == qn('w:txbxContent'):
                    for child in el.iter(qn('w:t')):
                        t = (child.text or "").strip()
                        if t:
                            lines.append(t)
            extracted = "\n".join(lines).strip()
            if not extracted:
                raise HTTPException(400, "Could not extract text from this .docx")
            return extracted
        except HTTPException:
            raise
        except ImportError:
            raise HTTPException(400, "python-docx not installed")
        except Exception as e:
            raise HTTPException(400, "Failed to read .docx: " + str(e))
    return content.decode("utf-8", errors="ignore")

DEFAULT_RECIPE = {
    "columns": ["Component", "Stock conc.", "Volume (uL)", "Final conc."],
    "rows": []
}

# --------------------------------------------------------------------------- #
#  Models
# --------------------------------------------------------------------------- #
class CreateProtocol(BaseModel):
    title: str
    url:   Optional[str] = None
    notes: str = ""
    tags:  List[str] = []
    auto_complete: str = "manual"

class PasteProtocol(BaseModel):
    title: str
    text:  str
    notes: str = ""
    tags:  List[str] = []
    auto_complete: str = "manual"

class ManualProtocol(BaseModel):
    title:  str
    steps:  List[str] = []
    recipe: Optional[str] = None
    notes:  str = ""
    tags:   List[str] = []
    auto_complete: str = "manual"

class UpdateProtocol(BaseModel):
    title:  Optional[str] = None
    notes:  Optional[str] = None
    tags:   Optional[List[str]] = None
    steps:  Optional[str] = None
    recipe: Optional[str] = None
    auto_complete: Optional[str] = None

class ActiveRunCreate(BaseModel):
    run_id:       str
    protocol_id:  int
    protocol_json: str
    steps_json:   str = '[]'
    recipe_json:  Optional[str] = None
    group_name:   str = ''
    subgroup:     str = ''
    scaling:      bool = False
    scale_factor: float = 1.0
    started_at:   str

class ActiveRunUpdate(BaseModel):
    steps_json:   Optional[str] = None
    recipe_json:  Optional[str] = None
    scaling:      Optional[bool] = None
    scale_factor: Optional[float] = None

class SaveRun(BaseModel):
    protocol_id: int
    date:        str
    group_name:  str
    steps_json:  str
    recipe_json: Optional[str] = None
    entry_id:    Optional[int] = None

# --------------------------------------------------------------------------- #
#  Router
# --------------------------------------------------------------------------- #
router = APIRouter(prefix="/api", tags=["protocols"])

@router.get("/protocols")
def list_protocols(tag: str = ""):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM protocols ORDER BY created DESC").fetchall()
    protocols = [dict(r) for r in rows]
    if tag:
        protocols = [p for p in protocols if tag in json.loads(p.get("tags") or "[]")]
    return {"protocols": protocols}

@router.get("/protocols/{protocol_id}")
def get_protocol(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)

@router.get("/protocols/{protocol_id}/runs")
def get_protocol_runs(protocol_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM protocol_runs WHERE protocol_id=? ORDER BY created DESC",
            (protocol_id,)).fetchall()
    return {"runs": [dict(r) for r in rows]}

@router.post("/protocol-runs")
def save_protocol_run(body: SaveRun):
    now = datetime.utcnow().isoformat()
    steps = json.loads(body.steps_json) if body.steps_json else []
    done  = sum(1 for s in steps if s.get("done"))
    devs  = sum(1 for s in steps if s.get("deviation", "").strip())
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocol_runs (protocol_id,date,group_name,steps_done,steps_total,"
            "deviations,steps_json,recipe_json,entry_id,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (body.protocol_id, body.date, body.group_name, done, len(steps),
             devs, body.steps_json, body.recipe_json, body.entry_id, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocol_runs WHERE id=?", (cur.lastrowid,)).fetchone())

@router.get("/active-runs")
def list_active_runs():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM active_runs ORDER BY updated_at DESC").fetchall()
    return {"runs": [dict(r) for r in rows]}

@router.post("/active-runs")
def create_active_run(body: ActiveRunCreate):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        conn.execute("""INSERT OR REPLACE INTO active_runs
            (run_id,protocol_id,protocol_json,steps_json,recipe_json,
             group_name,subgroup,scaling,scale_factor,started_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (body.run_id, body.protocol_id, body.protocol_json, body.steps_json,
             body.recipe_json, body.group_name, body.subgroup,
             1 if body.scaling else 0, body.scale_factor, body.started_at, now))
        conn.commit()
    return {"run_id": body.run_id}

@router.put("/active-runs/{run_id}")
def update_active_run(run_id: str, body: ActiveRunUpdate):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM active_runs WHERE run_id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Active run not found")
        r = dict(row)
        if body.steps_json   is not None: r["steps_json"]   = body.steps_json
        if body.recipe_json  is not None: r["recipe_json"]  = body.recipe_json
        if body.scaling      is not None: r["scaling"]      = 1 if body.scaling else 0
        if body.scale_factor is not None: r["scale_factor"] = body.scale_factor
        conn.execute("""UPDATE active_runs SET
            steps_json=?, recipe_json=?, scaling=?, scale_factor=?, updated_at=?
            WHERE run_id=?""",
            (r["steps_json"], r["recipe_json"], r["scaling"],
             r["scale_factor"], now, run_id))
        conn.commit()
    return {"run_id": run_id}

@router.delete("/active-runs/{run_id}")
def delete_active_run(run_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM active_runs WHERE run_id=?", (run_id,))
        conn.commit()
    return {"deleted": run_id}

@router.post("/protocols")
async def create_from_url(body: CreateProtocol):
    now = datetime.utcnow().isoformat()
    source_text = ""
    if body.url:
        source_text = await fetch_url_text(body.url)
        if source_text and source_text.startswith("Error"):
            source_text = ""
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, "url", body.url, source_text, None, json.dumps(DEFAULT_RECIPE), body.notes, json.dumps(body.tags), body.auto_complete, now, now))
        conn.commit()
        proto = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())
    if source_text:
        asyncio.create_task(_bg_extract(proto["id"], body.title, source_text))
    return proto

@router.post("/protocols/from-paste")
async def create_from_paste(body: PasteProtocol):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, "paste", None, body.text[:50000], None, json.dumps(DEFAULT_RECIPE), body.notes, json.dumps(body.tags), body.auto_complete, now, now))
        conn.commit()
        proto = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())
    asyncio.create_task(_bg_extract(proto["id"], body.title, body.text))
    return proto

@router.post("/protocols/from-file")
async def create_from_file(
    title: str = Form(...),
    notes: str = Form(""),
    tags:  str = Form("[]"),
    auto_complete: str = Form("manual"),
    file:  UploadFile = File(...),
):
    now         = datetime.utcnow().isoformat()
    source_text = await _text_from_upload(file)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (title, "file", None, source_text[:50000], None, json.dumps(DEFAULT_RECIPE), notes, tags, auto_complete, now, now))
        conn.commit()
        proto = dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())
    asyncio.create_task(_bg_extract(proto["id"], title, source_text))
    return proto

@router.post("/protocols/from-manual")
async def create_manual(body: ManualProtocol):
    now    = datetime.utcnow().isoformat()
    steps  = json.dumps([{"text": s.strip()} for s in body.steps if s.strip()])
    recipe = body.recipe or json.dumps(DEFAULT_RECIPE)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (body.title, "manual", None, None, steps, recipe, body.notes, json.dumps(body.tags), body.auto_complete, now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.put("/protocols/{protocol_id}")
async def update_protocol(protocol_id: int, body: UpdateProtocol):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        p = dict(row)
        if body.title  is not None: p["title"]  = body.title
        if body.notes  is not None: p["notes"]  = body.notes
        if body.steps  is not None: p["steps"]  = body.steps
        if body.recipe is not None: p["recipe"] = body.recipe
        if body.tags   is not None: p["tags"]   = json.dumps(body.tags)
        if body.auto_complete is not None: p["auto_complete"] = body.auto_complete
        p["updated"] = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE protocols SET title=?,notes=?,steps=?,recipe=?,tags=?,auto_complete=?,updated=? WHERE id=?",
            (p["title"], p["notes"], p["steps"], p["recipe"], p["tags"], p.get("auto_complete", "manual"), p["updated"], protocol_id))
        conn.commit()
    return p

@router.delete("/protocols/{protocol_id}")
def delete_protocol(protocol_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM protocols WHERE id=?", (protocol_id,))
        conn.commit()
    return {"deleted": protocol_id}

@router.post("/protocols/{protocol_id}/re-extract")
async def re_extract_steps(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)
    source = p.get("source_text") or ""
    if not source:
        try:
            existing = json.loads(p.get("steps") or "[]")
            if existing:
                source = " ".join(s.get("text","") for s in existing if s.get("text"))
        except Exception:
            pass
    if not source:
        raise HTTPException(400, "No source text stored - re-import the protocol")
    asyncio.create_task(_bg_extract(protocol_id, p["title"], source))
    return {"status": "extracting", "protocol_id": protocol_id}

@router.post("/protocols/{protocol_id}/reparse-tables")
async def reparse_tables(protocol_id: int):
    """Re-send source text to the LLM to regenerate cleaner tables."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)
    source = p.get("source_text") or ""
    current_tables = p.get("recipe") or ""
    if not source and not current_tables:
        raise HTTPException(400, "No source text or tables to reparse")
    if not await _ensure_3090_ready():
        raise HTTPException(503, "3090 is unavailable")

    prompt = "Protocol: " + p["title"] + "\n\n"
    if current_tables:
        prompt += "Current tables (may have errors):\n" + current_tables + "\n\n"
    if source:
        prompt += "Original source text:\n" + _clean_source_text(source, truncate=5000)

    elog(f"Reparsing tables for #{protocol_id}...")
    raw = await _call_3090(_REPARSE_TABLES_SYSTEM, prompt, max_tokens=2000)
    if not raw:
        raise HTTPException(500, "LLM returned empty response")

    # Try to parse as array of tables
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    try:
        tables = json.loads(cleaned)
        if isinstance(tables, list) and len(tables) and isinstance(tables[0], dict):
            # validate structure
            valid = []
            for t in tables:
                if "columns" in t and "rows" in t:
                    valid.append({
                        "name": t.get("name", "Recipe"),
                        "columns": [str(c) for c in t["columns"]],
                        "rows": [[str(c) for c in row] for row in t["rows"] if isinstance(row, list)]
                    })
            if valid:
                recipe_json = json.dumps(valid[0]) if len(valid) == 1 else json.dumps(valid)
                elog(f"Reparsed {len(valid)} table(s) for #{protocol_id}")
                return {"recipe": recipe_json, "tables_count": len(valid)}
    except Exception:
        pass
    # fallback: try single table parse
    result = _parse_recipe_raw(raw)
    if result:
        return {"recipe": result, "tables_count": 1}
    raise HTTPException(500, "Could not parse LLM response into valid tables")

@router.post("/protocols/{protocol_id}/review")
async def review_protocol(protocol_id: int):
    """Send the protocol to the LLM for quality review and improvement suggestions."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)
    if not await _ensure_3090_ready():
        raise HTTPException(503, "3090 is unavailable")

    # Build a comprehensive prompt with steps + tables
    prompt = "Protocol: " + p["title"] + "\n\n"
    steps_data = []
    try:
        steps_data = json.loads(p.get("steps") or "[]")
    except Exception:
        pass
    if steps_data:
        prompt += "Steps:\n"
        for i, s in enumerate(steps_data):
            text = s.get("text", "") if isinstance(s, dict) else str(s)
            note = s.get("note", "") if isinstance(s, dict) else ""
            prompt += f"  {i+1}. {text}"
            if note:
                prompt += f" [Note: {note}]"
            prompt += "\n"
    recipe = p.get("recipe") or ""
    if recipe and recipe != json.dumps(DEFAULT_RECIPE):
        prompt += "\nReaction tables:\n" + recipe + "\n"
    source = p.get("source_text") or ""
    if source:
        prompt += "\nOriginal source (for reference):\n" + _clean_source_text(source, truncate=3000)

    elog(f"Reviewing protocol #{protocol_id}...")
    raw = await _call_3090(_REVIEW_SYSTEM, prompt, max_tokens=2000)
    if not raw:
        raise HTTPException(500, "LLM returned empty response")

    # Parse suggestions
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    try:
        suggestions = json.loads(cleaned)
        if isinstance(suggestions, list):
            # validate each suggestion
            valid = []
            for s in suggestions:
                if isinstance(s, dict) and "suggested" in s:
                    valid.append({
                        "type": s.get("type", "general"),
                        "index": s.get("index"),
                        "field": s.get("field", "text"),
                        "original": s.get("original", ""),
                        "suggested": s.get("suggested", ""),
                        "reason": s.get("reason", ""),
                    })
            elog(f"Review complete: {len(valid)} suggestion(s)")
            return {"suggestions": valid}
    except Exception:
        pass
    # fallback: return raw text as a single general suggestion
    return {"suggestions": [{"type": "general", "index": None, "field": "text",
                             "original": "", "suggested": raw.strip(), "reason": "LLM review output"}]}

@router.post("/protocols/{protocol_id}/clone")
def clone_protocol(protocol_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM protocols WHERE id=?", (protocol_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    p = dict(row)
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,auto_complete,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (p["title"] + " (copy)", p["source_type"], p["url"], p["source_text"],
             p["steps"], p["recipe"], "", p["tags"], p.get("auto_complete", "manual"), now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.post("/active-runs/check-expiry")
def check_run_expiry():
    """Auto-complete active runs whose protocol's auto_complete window has elapsed."""
    now = datetime.utcnow()
    today = now.date().isoformat()
    completed = []
    with get_db() as conn:
        runs = conn.execute("SELECT * FROM active_runs").fetchall()
        for run_row in runs:
            run = dict(run_row)
            proto = conn.execute("SELECT auto_complete FROM protocols WHERE id=?",
                                 (run["protocol_id"],)).fetchone()
            if not proto:
                continue
            ac = (dict(proto).get("auto_complete") or "manual")
            if ac == "manual":
                continue
            started = run["started_at"][:10]
            start_date = datetime.fromisoformat(started).date() if 'T' in started else datetime.strptime(started, "%Y-%m-%d").date()
            if ac == "end_of_day":
                expiry = start_date
            else:
                # parse "Xd" format
                try:
                    days = int(ac.replace("d", ""))
                except ValueError:
                    continue
                expiry = start_date + timedelta(days=days)
            if now.date() > expiry:
                # auto-complete: save to protocol_runs, remove from active_runs
                steps = json.loads(run.get("steps_json") or "[]")
                done = sum(1 for s in steps if s.get("done"))
                devs = sum(1 for s in steps if s.get("deviation", "").strip())
                conn.execute(
                    "INSERT INTO protocol_runs (protocol_id,date,group_name,steps_done,steps_total,"
                    "deviations,steps_json,recipe_json,entry_id,created) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (run["protocol_id"], started, run.get("group_name", ""),
                     done, len(steps), devs, run.get("steps_json"),
                     run.get("recipe_json"), None, now.isoformat()))
                conn.execute("DELETE FROM active_runs WHERE run_id=?", (run["run_id"],))
                completed.append({"run_id": run["run_id"], "protocol_id": run["protocol_id"]})
        if completed:
            conn.commit()
    return {"completed": completed, "checked": len(runs) if 'runs' in dir() else 0}

@router.get("/protocols/{protocol_id}/extraction-status")
def extraction_status(protocol_id: int):
    stage = _extracting.get(protocol_id)
    return {"extracting": stage is not None, "stage": stage}

@router.get("/3090/status")
def get_3090_status():
    """Return current 3090 backend state and recent log entries for progress polling."""
    return {
        "backend": active_backend,
        "os": detected_os,
        "log": enrich_log[-15:],
        "extracting": dict(_extracting),
    }
