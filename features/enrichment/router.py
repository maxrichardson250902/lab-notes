"""Enrichment feature — 3090-powered batch processing pipeline."""
from fastapi import APIRouter
from datetime import datetime
import json, re, concurrent.futures, asyncio

from core.database import get_db
from core.ssh import (elog, ensure_pc_online, start_llm, call_llm_3090,
                      ssh_run, title_similarity)
import core.ssh as _ssh

router = APIRouter(prefix="/api", tags=["enrichment"])


async def run_enrichment():
    if _ssh.enrich_running:
        return
    _ssh.enrich_running = True
    try:
        elog("Starting lab notes enrichment...")
        if not ensure_pc_online():
            elog("3090 offline — enrichment cancelled")
            return
        if not start_llm():
            elog("LLM failed to start")
            return

        # Phase 1: Fill out empty notebook entries
        elog("Phase 1: filling out notebook entries...")
        with get_db() as conn:
            empty_entries = [dict(r) for r in conn.execute(
                "SELECT * FROM entries WHERE notes='' AND title!='' ORDER BY created DESC LIMIT 20"
            ).fetchall()]
        filled = 0
        for entry in empty_entries:
            try:
                with get_db() as conn:
                    context_rows = conn.execute(
                        "SELECT title, notes FROM entries WHERE group_name=? AND notes!='' ORDER BY date DESC LIMIT 5",
                        (entry["group_name"],)).fetchall()
                context = "\n".join(
                    f"- {r['title']}: {r['notes'][:100]}" for r in context_rows
                ) if context_rows else "No previous entries."
                result = call_llm_3090(
                    "You are a lab notebook assistant for a scientist. "
                    "Given a completed task, write brief but useful notebook notes. "
                    "Include: what was likely done, key steps, what to record. "
                    "Be specific to the science. Reply in plain text, 2-4 sentences.",
                    f"Completed task: {entry['title']}\n"
                    f"Project: {entry['group_name']}/{entry['subgroup']}\n"
                    f"Date: {entry['date']}\n"
                    f"Previous entries in this project:\n{context}\n\n"
                    f"Write brief notebook notes for this completed task:",
                    max_tokens=200
                )
                if result and len(result) > 10:
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE entries SET notes=?, updated=? WHERE id=?",
                            (result, datetime.utcnow().isoformat(), entry["id"]))
                        conn.commit()
                    filled += 1
            except Exception as e:
                elog(f"  Entry {entry['id']} failed: {e}")
        elog(f"Filled {filled}/{len(empty_entries)} entries")

        # Phase 2: Summarise entries
        elog("Phase 2: summarising entries...")
        with get_db() as conn:
            unsummarised = [dict(r) for r in conn.execute(
                "SELECT * FROM entries WHERE summary IS NULL AND notes!='' ORDER BY created DESC LIMIT 15"
            ).fetchall()]
        summarised = 0
        for entry in unsummarised:
            try:
                parts = [f"Task: {entry['title']}", f"Group: {entry['group_name']}/{entry['subgroup']}"]
                if entry["notes"]:   parts.append(f"Notes: {entry['notes']}")
                if entry["results"]: parts.append(f"Results: {entry['results']}")
                if entry["yields"]:  parts.append(f"Yields: {entry['yields']}")
                if entry["issues"]:  parts.append(f"Issues: {entry['issues']}")
                summary = call_llm_3090(
                    "Summarise this lab notebook entry in 2-3 sentences. "
                    "Focus on what was done, key results, and any issues. Be concise and scientific.",
                    "\n".join(parts), max_tokens=150
                )
                if summary and len(summary) > 10:
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE entries SET summary=?, updated=? WHERE id=?",
                            (summary, datetime.utcnow().isoformat(), entry["id"]))
                        conn.commit()
                    summarised += 1
            except Exception as e:
                elog(f"  Summary {entry['id']} failed: {e}")
        elog(f"Summarised {summarised}/{len(unsummarised)} entries")

        # Phase 3: Process pending scratch pad
        elog("Phase 3: processing scratch pad...")
        with get_db() as conn:
            pending_scratch = [dict(r) for r in conn.execute(
                "SELECT * FROM scratch WHERE processed=0").fetchall()]
        processed = 0
        for item in pending_scratch:
            try:
                content = item["content"] or item["filename"] or ""
                if not content and not item.get("image_data"):
                    continue
                result = call_llm_3090(
                    "You classify lab notes into categories. Reply in JSON only.\n"
                    "result_type: 'note' (lab observation), 'task' (something to do), or 'reminder' (time-sensitive)\n"
                    "group: project name if identifiable, else ''\n"
                    "title: short title (max 60 chars)\n"
                    "analysis: expanded/cleaned version of the note (2-3 sentences)",
                    f"Classify this scratch note:\n{content[:500]}",
                    max_tokens=200
                )
                match = re.search(r'\{.*\}', result, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    result_type = data.get("result_type", "note")
                    result_group = data.get("group", "")
                    analysis = data.get("analysis", content)
                    title = data.get("title", content[:60])
                    now = datetime.utcnow().isoformat()
                    entry_id = None
                    if result_type in ("note", "task"):
                        date = datetime.utcnow().strftime("%Y-%m-%d")
                        with get_db() as conn:
                            cur = conn.execute(
                                "INSERT INTO entries (title,group_name,subgroup,date,notes,created,updated) VALUES (?,?,?,?,?,?,?)",
                                (title, result_group, "Notes", date, analysis, now, now))
                            conn.commit()
                            entry_id = cur.lastrowid
                    if result_type == "reminder":
                        with get_db() as conn:
                            conn.execute(
                                "INSERT INTO reminders (text,due_date,done,source,created) VALUES (?,?,0,'scratch',?)",
                                (content[:200], data.get("due_date"), now))
                            conn.commit()
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE scratch SET processed=1,result_type=?,result_group=?,result_entry_id=?,analysis=? WHERE id=?",
                            (result_type, result_group, entry_id, analysis, item["id"]))
                        conn.commit()
                    processed += 1
            except Exception as e:
                elog(f"  Scratch {item['id']} failed: {e}")
        elog(f"Processed {processed}/{len(pending_scratch)} scratch items")

        # Phase 4: Project summaries
        elog("Phase 4: project summaries...")
        with get_db() as conn:
            groups = [r["group_name"] for r in conn.execute(
                "SELECT DISTINCT group_name FROM entries WHERE group_name!='' ORDER BY group_name"
            ).fetchall()]
        for group in groups[:6]:
            try:
                with get_db() as conn:
                    recent = [dict(r) for r in conn.execute(
                        "SELECT title, notes, results, issues, date FROM entries WHERE group_name=? ORDER BY date DESC LIMIT 10",
                        (group,)).fetchall()]
                if len(recent) < 2: continue
                entries_txt = "\n".join(
                    f"[{e['date']}] {e['title']}: {(e['notes'] or '')[:80]} | Results: {(e['results'] or '')[:60]}"
                    for e in recent
                )
                result = call_llm_3090(
                    "You are a scientific project manager. Summarise the current state of this project "
                    "and suggest next steps. Reply in JSON: {\"summary\":\"...\",\"next_steps\":[\"...\",\"...\"]}",
                    f"Project: {group}\nRecent entries:\n{entries_txt}",
                    max_tokens=300
                )
                match = re.search(r'\{.*\}', result, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    now = datetime.utcnow().isoformat()
                    with get_db() as conn:
                        existing = conn.execute(
                            "SELECT id FROM project_summaries WHERE group_name=?", (group,)).fetchone()
                        if existing:
                            conn.execute(
                                "UPDATE project_summaries SET summary=?, next_steps=?, updated=? WHERE group_name=?",
                                (data.get("summary", ""), json.dumps(data.get("next_steps", [])), now, group))
                        else:
                            conn.execute(
                                "INSERT INTO project_summaries (group_name,summary,next_steps,updated) VALUES (?,?,?,?)",
                                (group, data.get("summary", ""), json.dumps(data.get("next_steps", [])), now))
                        conn.commit()
            except Exception as e:
                elog(f"  Summary for {group} failed: {e}")
        elog("Project summaries done")

        # Phase 5: Protocol extraction
        elog("Phase 5: protocol extraction...")
        with get_db() as conn:
            existing_protocols = [dict(r) for r in conn.execute(
                "SELECT id, title, steps FROM protocols ORDER BY created DESC").fetchall()]
            candidates = [dict(r) for r in conn.execute(
                "SELECT id, title, notes, group_name FROM entries WHERE notes!='' AND length(notes) > 50 ORDER BY created DESC LIMIT 30"
            ).fetchall()]
        if candidates:
            existing_titles = [p["title"].lower().strip() for p in existing_protocols]
            existing_summary = "\n".join(
                f"- {p['title']}" for p in existing_protocols[:20]
            ) if existing_protocols else "None yet."
            batch_text = "\n\n".join(
                f"ENTRY {e['id']} [{e['group_name']}]: {e['title']}\n{(e['notes'] or '')[:300]}"
                for e in candidates[:15]
            )
            try:
                result = call_llm_3090(
                    "You are a lab protocol curator. Scan these notebook entries for any recipes, "
                    "methods, or procedures that should be saved as reusable protocols. "
                    "DO NOT suggest protocols that already exist in the list below. "
                    "Only suggest genuinely new or significantly different methods. "
                    "A PCR with slightly different primers is NOT a new protocol \u2014 it's the same PCR protocol. "
                    "Reply in JSON: {\"protocols\":[{\"title\":\"...\",\"from_entry_id\":N,\"steps\":\"...\"}]} "
                    "or {\"protocols\":[]} if nothing new.",
                    f"EXISTING PROTOCOLS:\n{existing_summary}\n\n"
                    f"NOTEBOOK ENTRIES TO SCAN:\n{batch_text}",
                    max_tokens=500
                )
                match = re.search(r'\{.*\}', result, re.DOTALL)
                if match:
                    data = json.loads(match.group())
                    new_protocols = 0
                    for proto in data.get("protocols", [])[:5]:
                        ptitle = proto.get("title", "").strip()
                        psteps = proto.get("steps", "").strip()
                        if not ptitle or not psteps or len(psteps) < 20:
                            continue
                        ptitle_lower = ptitle.lower()
                        is_dup = any(
                            ptitle_lower in et or et in ptitle_lower
                            or title_similarity(ptitle_lower, et) > 0.7
                            for et in existing_titles
                        )
                        if is_dup:
                            elog(f"  Skipping duplicate: {ptitle}")
                            continue
                        now = datetime.utcnow().isoformat()
                        with get_db() as conn:
                            conn.execute(
                                "INSERT INTO protocols (title,url,source_text,steps,notes,tags,created,updated) VALUES (?,?,?,?,?,?,?,?)",
                                (ptitle, None, "", psteps, f"Auto-extracted from entry #{proto.get('from_entry_id', '')}",
                                 '["auto-extracted"]', now, now))
                            conn.commit()
                        new_protocols += 1
                        elog(f"  New protocol: {ptitle}")
                    elog(f"Extracted {new_protocols} new protocols")
            except Exception as e:
                elog(f"  Protocol extraction failed: {e}")
        else:
            elog("No candidate entries for protocol extraction")

        ssh_run("pkill -f llama_cpp.server", check=False)
        elog("Enrichment complete!")
    except Exception as e:
        elog(f"Enrichment failed: {e}")
    finally:
        _ssh.enrich_running = False


def run_enrichment_sync():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(run_enrichment())
    finally:
        loop.close()


@router.post("/enrich")
async def trigger_enrich():
    if _ssh.enrich_running:
        return {"running": True, "message": "Already running"}
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    asyncio.get_event_loop().run_in_executor(executor, run_enrichment_sync)
    return {"triggered": True}

@router.get("/enrich-status")
async def enrich_status():
    return {
        "enrichment_running": _ssh.enrich_running,
        "recent_log": _ssh.enrich_log,
    }

@router.get("/enrich-log")
async def enrich_log_endpoint():
    return {"log": _ssh.enrich_log}
