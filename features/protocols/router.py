"""Protocols feature — protocol library with LLM step extraction, run mode, and recipe tables."""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json, re, io

from core.database import register_table, get_db
from core.llm import llm, fetch_url_text

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

def _migrate():
    with get_db() as conn:
        for stmt in [
            "ALTER TABLE protocols ADD COLUMN source_type TEXT NOT NULL DEFAULT 'url'",
            "ALTER TABLE protocols ADD COLUMN recipe TEXT DEFAULT NULL",
        ]:
            try:
                conn.execute(stmt)
                conn.commit()
            except Exception:
                pass
_migrate()

# ── LLM step extraction ───────────────────────────────────────────────────────
_EXTRACT_SYSTEM = (
    "You are a lab protocol parser. Extract every step from the provided protocol text. "
    "Return ONLY a valid JSON array — no markdown fences, no explanation, nothing else. "
    "Each element must be a JSON object with a single key 'text' containing one step. "
    "Include reagents, volumes, temperatures, and timings in the step text. "
    'Example output: [{"text":"Add 50 µL Buffer EB to spin column"},{"text":"Incubate 1 min at RT"}]'
)

async def extract_steps(title: str, source_text: str) -> str:
    raw = await llm(
        f"Protocol: {title}\n\nText:\n{source_text[:4000]}",
        _EXTRACT_SYSTEM,
        max_tokens=1500,
    )
    cleaned = re.sub(r"^```[a-z]*\n?", "", raw.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())
    try:
        steps = json.loads(cleaned)
        if isinstance(steps, list):
            return json.dumps([{"text": str(s["text"])} for s in steps if "text" in s])
    except Exception:
        pass
    steps = []
    for line in raw.splitlines():
        line = re.sub(r"^\d+[\.\)]\s*", "", line.strip())
        if line and len(line) > 4:
            steps.append({"text": line})
    return json.dumps(steps) if steps else json.dumps([{"text": raw.strip()}])


async def _text_from_upload(file: UploadFile) -> str:
    content = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".pdf"):
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            return " ".join(page.extract_text() or "" for page in reader.pages)[:6000]
        except ImportError:
            raise HTTPException(400, "pypdf not installed")
    if fname.endswith(".docx"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:6000]
        except ImportError:
            raise HTTPException(400, "python-docx not installed")
    return content.decode("utf-8", errors="ignore")[:6000]


# ── default recipe template ───────────────────────────────────────────────────
DEFAULT_RECIPE = {
    "columns": ["Component", "Stock conc.", "Volume (µL)", "Final conc."],
    "rows": []
}

# ── models ────────────────────────────────────────────────────────────────────
class CreateProtocol(BaseModel):
    title: str
    url:   Optional[str] = None
    notes: str = ""
    tags:  List[str] = []

class PasteProtocol(BaseModel):
    title: str
    text:  str
    notes: str = ""
    tags:  List[str] = []

class UpdateProtocol(BaseModel):
    title:  Optional[str] = None
    notes:  Optional[str] = None
    tags:   Optional[List[str]] = None
    steps:  Optional[str] = None
    recipe: Optional[str] = None

# ── router ────────────────────────────────────────────────────────────────────
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

@router.post("/protocols")
async def create_from_url(body: CreateProtocol):
    now = datetime.utcnow().isoformat()
    source_text, steps = "", None
    if body.url:
        source_text = await fetch_url_text(body.url)
        if source_text and not source_text.startswith("Error"):
            steps = await extract_steps(body.title, source_text)
    recipe = json.dumps(DEFAULT_RECIPE)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (body.title, "url", body.url, source_text, steps, recipe, body.notes, json.dumps(body.tags), now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.post("/protocols/from-paste")
async def create_from_paste(body: PasteProtocol):
    now = datetime.utcnow().isoformat()
    steps  = await extract_steps(body.title, body.text)
    recipe = json.dumps(DEFAULT_RECIPE)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (body.title, "paste", None, body.text, steps, recipe, body.notes, json.dumps(body.tags), now, now))
        conn.commit()
        return dict(conn.execute("SELECT * FROM protocols WHERE id=?", (cur.lastrowid,)).fetchone())

@router.post("/protocols/from-file")
async def create_from_file(
    title: str = Form(...),
    notes: str = Form(""),
    tags:  str = Form("[]"),
    file:  UploadFile = File(...),
):
    now = datetime.utcnow().isoformat()
    source_text = await _text_from_upload(file)
    steps  = await extract_steps(title, source_text)
    recipe = json.dumps(DEFAULT_RECIPE)
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO protocols (title,source_type,url,source_text,steps,recipe,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (title, "file", None, source_text, steps, recipe, notes, tags, now, now))
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
        p["updated"] = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE protocols SET title=?,notes=?,steps=?,recipe=?,tags=?,updated=? WHERE id=?",
            (p["title"], p["notes"], p["steps"], p["recipe"], p["tags"], p["updated"], protocol_id))
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
    if not p["source_text"]:
        raise HTTPException(400, "No source text stored")
    steps = await extract_steps(p["title"], p["source_text"])
    with get_db() as conn:
        conn.execute("UPDATE protocols SET steps=?, updated=? WHERE id=?",
                     (steps, datetime.utcnow().isoformat(), protocol_id))
        conn.commit()
    return {"steps": steps}
