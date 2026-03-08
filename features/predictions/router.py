"""Task predictions feature — LLM-powered next-task suggestions."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import json, re, httpx, os

from core.database import register_table, get_db
from core.ssh import (elog, ensure_pc_online, start_llm, call_llm_3090,
                      ssh_run, title_similarity)
import core.ssh as _ssh

TODO_API_URL = os.getenv("TODO_API_URL", "http://localhost:3000")

register_table("predictions", """CREATE TABLE IF NOT EXISTS predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name  TEXT NOT NULL,
    text        TEXT NOT NULL,
    reasoning   TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created     TEXT NOT NULL)""")

class PredictionAction(BaseModel):
    action: str
    text: Optional[str] = None
    group_name: Optional[str] = None
    subgroup: Optional[str] = None

router = APIRouter(prefix="/api", tags=["predictions"])

@router.get("/predictions")
def get_predictions():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM predictions WHERE status='pending' ORDER BY created DESC").fetchall()
    return {"predictions": [dict(r) for r in rows]}

@router.post("/predictions/generate")
async def generate_predictions():
    if _ssh.enrich_running:
        return {"error": "Enrichment already running — try again after"}

    _ssh.enrich_running = True
    generated = []
    try:
        elog("Starting prediction generation...")
        if not ensure_pc_online():
            elog("3090 offline")
            return {"error": "3090 offline"}
        if not start_llm():
            elog("LLM failed to start")
            return {"error": "LLM failed to start"}

        with get_db() as conn:
            rejected = [dict(r) for r in conn.execute(
                "SELECT group_name, text FROM predictions WHERE status='rejected' ORDER BY created DESC LIMIT 50"
            ).fetchall()]
            pending = [dict(r) for r in conn.execute(
                "SELECT group_name, text FROM predictions WHERE status='pending'"
            ).fetchall()]
            groups = [r["group_name"] for r in conn.execute(
                "SELECT group_name, COUNT(*) as c FROM entries WHERE group_name!='' GROUP BY group_name HAVING c >= 2 ORDER BY c DESC"
            ).fetchall()]

        rejected_by_group = {}
        for r in rejected:
            rejected_by_group.setdefault(r["group_name"], []).append(r["text"])
        pending_texts = set(p["text"].lower().strip() for p in pending)

        for group in groups[:8]:
            try:
                elog(f"Predicting for: {group}")
                with get_db() as conn:
                    recent = [dict(r) for r in conn.execute(
                        "SELECT title, date, notes, results, issues FROM entries WHERE group_name=? ORDER BY date DESC LIMIT 10",
                        (group,)).fetchall()]
                    older = [dict(r) for r in conn.execute(
                        "SELECT title, date FROM entries WHERE group_name=? ORDER BY date DESC LIMIT 10 OFFSET 10",
                        (group,)).fetchall()]

                if not recent:
                    continue

                recent_txt = "\n".join(
                    f"[{e['date']}] {e['title']}"
                    + (f"\n  Notes: {e['notes'][:150]}" if e.get('notes') else "")
                    + (f"\n  Results: {e['results'][:100]}" if e.get('results') else "")
                    + (f"\n  Issues: {e['issues'][:100]}" if e.get('issues') else "")
                    for e in reversed(recent)
                )
                older_txt = "\n".join(
                    f"[{e['date']}] {e['title']}" for e in reversed(older)
                ) if older else ""

                group_rejected = rejected_by_group.get(group, [])
                rejected_txt = ""
                if group_rejected:
                    rejected_txt = "\n\nPREVIOUSLY REJECTED (do NOT suggest these again):\n" + \
                        "\n".join(f"- {r}" for r in group_rejected[:10])

                result = call_llm_3090(
                    "You are a scientific project manager. Based on the timeline of completed work, "
                    "predict the 3-5 most likely NEXT tasks. Include BOTH:\n"
                    "1. Science tasks: next experiments, analysis, troubleshooting\n"
                    "2. Organisation tasks: making glycerol stocks, updating plasmid records, "
                    "ordering reagents, backing up data, labelling samples, cleaning up\n\n"
                    "Focus especially on the most RECENT entries — what logically follows from "
                    "what was just done in the last few days.\n"
                    "DO NOT suggest anything from the rejected list.\n"
                    "Reply in JSON only: {\"predictions\":[{\"task\":\"...\",\"reasoning\":\"...\"}]}",
                    f"Project: {group}\n\n"
                    + (f"Older context:\n{older_txt}\n\n" if older_txt else "")
                    + f"Recent work (most important):\n{recent_txt}"
                    + rejected_txt
                    + "\n\nWhat should be done next?",
                    max_tokens=500
                )

                match = re.search(r'\{.*\}', result, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    now = datetime.utcnow().isoformat()
                    for pred in data.get("predictions", [])[:5]:
                        task_text = pred.get("task", "").strip()
                        reasoning = pred.get("reasoning", "").strip()
                        if not task_text or len(task_text) < 5:
                            continue
                        if task_text.lower().strip() in pending_texts:
                            continue
                        is_rejected = any(
                            title_similarity(task_text.lower(), r.lower()) > 0.7
                            for r in group_rejected
                        )
                        if is_rejected:
                            elog(f"  Skipping (previously rejected): {task_text[:50]}")
                            continue
                        with get_db() as conn:
                            conn.execute(
                                "INSERT INTO predictions (group_name,text,reasoning,status,created) VALUES (?,?,?,?,?)",
                                (group, task_text, reasoning, "pending", now))
                            conn.commit()
                        generated.append({"group": group, "task": task_text})
                        pending_texts.add(task_text.lower().strip())
            except Exception as e:
                elog(f"  Prediction for {group} failed: {e}")

        ssh_run("pkill -f llama_cpp.server", check=False)
        elog(f"Generated {len(generated)} predictions")
    except Exception as e:
        elog(f"Prediction generation failed: {e}")
    finally:
        _ssh.enrich_running = False

    return {"generated": generated, "count": len(generated)}

@router.put("/predictions/{pred_id}")
async def act_on_prediction(pred_id: int, body: PredictionAction):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM predictions WHERE id=?", (pred_id,)).fetchone()
        if not row: raise HTTPException(404, "Not found")
        pred = dict(row)

    if body.action == "reject":
        with get_db() as conn:
            conn.execute("UPDATE predictions SET status='rejected' WHERE id=?", (pred_id,))
            conn.commit()
        return {"rejected": pred_id}

    if body.action == "edit":
        with get_db() as conn:
            conn.execute("UPDATE predictions SET text=? WHERE id=?",
                         (body.text or pred["text"], pred_id))
            conn.commit()
        return {"edited": pred_id}

    if body.action == "approve":
        task_text = body.text or pred["text"]
        group = body.group_name or pred["group_name"]
        subgroup = body.subgroup or "Experiments"
        todo_task = None
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{TODO_API_URL}/api/tasks", json={
                    "text": task_text, "group_name": group,
                    "subgroup": subgroup, "predict_deps": False,
                })
                if resp.status_code == 200:
                    todo_task = resp.json()
        except Exception as e:
            return {"error": f"Could not reach todo app: {e}"}

        with get_db() as conn:
            conn.execute("UPDATE predictions SET status='approved' WHERE id=?", (pred_id,))
            conn.commit()
        return {"approved": pred_id, "todo_task": todo_task}

    raise HTTPException(400, "Unknown action")
