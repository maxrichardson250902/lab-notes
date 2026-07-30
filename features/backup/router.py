"""Backup — back up lab data to local storage, rclone (Google Drive) and SMB network share."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional, List, Tuple
from datetime import datetime, date, timedelta
import os, json, tarfile, sqlite3, shutil, tempfile, threading, time, io, subprocess, html as html_lib

from core.database import register_table, get_db
# For synthesising HTML from workflow_entries for dates that haven't been migrated
# to day_documents yet. Reuses the same builder the migration and read-mode use.
from features.workflow.router import _synth_day_html_from_entries

BACKUP_DIR   = "/data/backups"
PDF_DIR      = "/data/backups/pdfs"
DB_PATH      = "/data/lab.db"
GB_FILES_DIR = "/data/gb_files"

# URL chromium uses to hit the running FastAPI app when rendering PDFs. Inside
# the container both processes share the same network namespace, so 127.0.0.1
# is always reachable. Overridable via env if the port ever changes.
INTERNAL_URL = os.environ.get("INTERNAL_URL", "http://127.0.0.1:3003")

os.makedirs(BACKUP_DIR,    exist_ok=True)
os.makedirs(PDF_DIR,       exist_ok=True)
os.makedirs(GB_FILES_DIR,  exist_ok=True)

register_table("backup_settings", """CREATE TABLE IF NOT EXISTS backup_settings (
    id               INTEGER PRIMARY KEY,
    rclone_remote    TEXT DEFAULT 'gdrive',
    rclone_path      TEXT DEFAULT 'lab_backups',
    smb_host         TEXT,
    smb_share        TEXT,
    smb_user         TEXT,
    smb_password     TEXT,
    smb_path         TEXT DEFAULT 'lab_backups',
    daily_enabled    INTEGER DEFAULT 0,
    daily_time       TEXT DEFAULT '02:00',
    created          TEXT NOT NULL)""")

register_table("backups", """CREATE TABLE IF NOT EXISTS backups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    filename        TEXT NOT NULL,
    size_bytes      INTEGER DEFAULT 0,
    destinations    TEXT DEFAULT '[]',
    status          TEXT DEFAULT 'ok',
    notes           TEXT,
    created         TEXT NOT NULL)""")


# ── PDF chunk generation ─────────────────────────────────────────────────────
# Generates 30-day PDFs of the workflow's day-book, walking backwards from today
# until the earliest date with content. Uses headless chromium against a
# print-html endpoint served by this same app. PDFs land in /data/backups/pdfs/
# and get both (a) bundled into the tarball archive and (b) uploaded individually
# to rclone-Drive under <rclone_path>/pdfs/, per user choice.

_PDF_PRINT_CSS = """
  @page { size: A4; margin: 15mm 12mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #fff; color: #4a4139; margin: 0; padding: 0; }
  .cover { text-align: center; padding: 30mm 0 10mm 0; page-break-after: always; }
  .cover h1 { font-size: 22px; margin: 0 0 8px 0; font-weight: 600; }
  .cover .range { font-size: 14px; color: #666; margin-bottom: 4px; }
  .cover .meta { font-size: 11px; color: #999; }
  .wf-read-day { page-break-after: always; }
  .wf-read-day:last-child { page-break-after: auto; }
  .wf-read-day-h { border-bottom: 1px solid #999; padding-bottom: 6px; margin-bottom: 12px;
                    display: flex; align-items: baseline; gap: 10px; }
  .wf-read-day-h h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .wf-read-day-iso { font-family: "SF Mono", Monaco, Consolas, monospace;
                     font-size: 11px; color: #8a7f72; }
  .wf-read-day-body { font-size: 12.5px; line-height: 1.55; }
  .wf-read-day-body img { max-width: 100%; height: auto; page-break-inside: avoid; }
  .wf-read-day-body table { border-collapse: collapse; margin: 6px 0; page-break-inside: avoid; }
  .wf-read-day-body td, .wf-read-day-body th { border: 1px solid #d5cec0; padding: 3px 8px; }
  .wf-read-day-body [data-groups] { padding-left: 8px; border-left: 3px solid var(--wf-tag-primary, #7a9e7e);
                                     background: var(--wf-tag-tint, rgba(122,158,126,0.04)); position: relative;
                                     margin-top: 16px; }
  .wf-read-day-body .wf-task-done { padding-left: 8px; border-left: 3px solid #b89a3a;
                                     background: rgba(184,154,58,0.06); }
  .wf-read-day-body .wf-protocol { padding-left: 8px; border-left: 3px solid #5b7aa0;
                                    background: rgba(91,122,160,0.06); }
  /* Project pill on tagged blocks — identical look to the web UI so the PDF
     reads like a snapshot of what you saw. Uses ::after with attr(); no DOM
     manipulation needed. Colours come from --wf-tag-* variables set by
     the per-project CSS rules generated in _build_project_color_css. */
  .wf-read-day-body [data-groups]::after {
    content: attr(data-groups);
    position: absolute; top: -9px; right: 6px;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 9px; line-height: 1; color: var(--wf-tag-pill-fg, #3a5a3d);
    background: var(--wf-tag-pill-bg, #e8f0e8);
    border: 1px solid var(--wf-tag-pill-border, #7a9e7e);
    padding: 2px 7px 3px 7px; border-radius: 8px;
    max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .wf-time { display: inline-block; font-family: "SF Mono", Monaco, Consolas, monospace;
             font-size: .8em; padding: 1px 6px; background: #f0ebe3; border-radius: 3px;
             color: #8a7f72; margin-right: 4px; }
  /* Track-changes (once track-changes feature ships): historical deletions render struck */
  del, s { color: #999; text-decoration: line-through; }
  ins { color: #2a5a2d; text-decoration: none; background: rgba(122,158,126,0.15); padding: 0 2px; }
"""


def _range_docs(conn, start_iso: str, end_iso: str) -> List[Tuple[str, str]]:
    """Return [(date, html)] for all dates in [start, end] that have content.
    Prefers day_documents, falls back to workflow_entries synthesis. Newest first."""
    docs = {}
    for r in conn.execute(
        "SELECT date, content FROM day_documents "
        "WHERE date >= ? AND date <= ? AND content != ''",
        (start_iso, end_iso)
    ):
        docs[r["date"]] = r["content"]
    for r in conn.execute(
        "SELECT DISTINCT date FROM workflow_entries "
        "WHERE date >= ? AND date <= ? "
        "AND date NOT IN (SELECT date FROM day_documents WHERE content != '')",
        (start_iso, end_iso)
    ):
        synth = _synth_day_html_from_entries(conn, r["date"])
        if synth:
            docs[r["date"]] = synth
    return sorted(docs.items(), key=lambda x: x[0], reverse=True)


def _format_pretty_date(iso: str) -> str:
    try:
        d = datetime.strptime(iso, "%Y-%m-%d").date()
        return d.strftime("%A, %d %B %Y")
    except Exception:
        return iso


def _build_project_color_css() -> str:
    """Generate per-project CSS rules matching the browser side. Reads the
    projects registry — for names not registered, computes a hue from a djb2
    hash of the name (same algorithm as the client). Returns a CSS string
    (may be empty)."""
    def _djb2_hue(name: str) -> int:
        h = 5381
        for ch in name:
            h = (h * 33 + ord(ch)) & 0xFFFFFFFF
        return h % 360

    rules = []
    names_seen = set()
    try:
        with get_db() as conn:
            # Registered projects (with any overrides)
            for r in conn.execute("SELECT name, color_override FROM projects"):
                name = r["name"]
                if not name:
                    continue
                names_seen.add(name)
                rules.append(_project_css_rule(name, r["color_override"], _djb2_hue))
            # Fold in any names in data-groups that aren't registered yet
            for r in conn.execute("SELECT content FROM day_documents WHERE content != ''"):
                content = r["content"] or ""
                for m in re.finditer(r'data-groups="([^"]+)"', content):
                    for g in m.group(1).split(","):
                        g = g.strip()
                        if g and g not in names_seen:
                            names_seen.add(g)
                            rules.append(_project_css_rule(g, None, _djb2_hue))
    except Exception:
        pass
    return "\n".join(rules)


def _project_css_rule(name: str, color_override, hue_fn) -> str:
    """Build the CSS block that sets --wf-tag-* variables for one project.
    Uses four attribute selectors to correctly match multi-tagged blocks
    regardless of position (comma-separated, so a substring match would
    cross-fire between e.g. `MR15` and `pMR15`)."""
    esc_name = name.replace("\\", "\\\\").replace('"', '\\"')
    sel = ", ".join([
        f'[data-groups="{esc_name}"]',
        f'[data-groups^="{esc_name},"]',
        f'[data-groups$=",{esc_name}"]',
        f'[data-groups*=",{esc_name},"]',
    ])
    if color_override:
        primary = color_override
        tint    = color_override + "10"
        pill_bg = color_override + "22"
        pill_fg = color_override
        pill_bd = color_override
    else:
        hue = hue_fn(name)
        primary = f'hsl({hue}, 42%, 42%)'
        tint    = f'hsla({hue}, 42%, 42%, 0.06)'
        pill_bg = f'hsl({hue}, 45%, 90%)'
        pill_fg = f'hsl({hue}, 55%, 25%)'
        pill_bd = f'hsl({hue}, 42%, 55%)'
    return (
        f"{sel} {{"
        f"--wf-tag-primary: {primary}; "
        f"--wf-tag-tint: {tint}; "
        f"--wf-tag-pill-bg: {pill_bg}; "
        f"--wf-tag-pill-fg: {pill_fg}; "
        f"--wf-tag-pill-border: {pill_bd};"
        f"}}"
    )


def _build_print_html(docs: List[Tuple[str, str]], start_iso: str, end_iso: str) -> str:
    """Build the full HTML doc that chromium renders to PDF."""
    generated_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    cover = (f'<div class="cover">'
             f'<h1>Lab Notes</h1>'
             f'<div class="range">{html_lib.escape(_format_pretty_date(start_iso))} '
             f'&ndash; {html_lib.escape(_format_pretty_date(end_iso))}</div>'
             f'<div class="meta">Generated {generated_at} &middot; {len(docs)} day'
             f'{"s" if len(docs)!=1 else ""} with content</div>'
             f'</div>')
    day_blocks = []
    for iso, content in docs:
        day_blocks.append(
            f'<article class="wf-read-day">'
            f'<header class="wf-read-day-h">'
            f'<h2>{html_lib.escape(_format_pretty_date(iso))}</h2>'
            f'<span class="wf-read-day-iso">{html_lib.escape(iso)}</span>'
            f'</header>'
            f'<div class="wf-read-day-body">{content}</div>'
            f'</article>'
        )
    project_css = _build_project_color_css()
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f'<title>Lab Notes {start_iso} to {end_iso}</title>'
        f'<style>{_PDF_PRINT_CSS}\n{project_css}</style>'
        '</head><body>'
        + cover + '\n'.join(day_blocks)
        + '</body></html>'
    )


def _generate_pdf_for_range(end_iso: str, days: int = 30) -> Optional[str]:
    """Render a 30-day window to a PDF file. Returns the filepath or None if
    no content exists in the range."""
    end_dt = datetime.strptime(end_iso, "%Y-%m-%d").date()
    start_dt = end_dt - timedelta(days=days - 1)
    start_iso = start_dt.strftime("%Y-%m-%d")

    with get_db() as conn:
        docs = _range_docs(conn, start_iso, end_iso)
    if not docs:
        return None

    output_path = os.path.join(PDF_DIR, f"lab-notes_{start_iso}_to_{end_iso}.pdf")
    # Chromium goes over the loopback interface to fetch the print-html view and
    # any images referenced in the day content (they live at /api/workflow/image
    # etc. on the same server). --headless=new is the Chrome 112+ flag set;
    # --no-sandbox required inside a container. --virtual-time-budget lets
    # images finish loading before the print snapshot is taken.
    url = f"{INTERNAL_URL}/api/backup/print-html?end={end_iso}&days={days}"
    try:
        result = subprocess.run(
            [
                "chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
                "--disable-dev-shm-usage",
                "--hide-scrollbars",
                "--virtual-time-budget=15000",
                "--run-all-compositor-stages-before-draw",
                f"--print-to-pdf={output_path}",
                "--no-pdf-header-footer",
                url,
            ],
            capture_output=True, timeout=90,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"chromium exit {result.returncode}: "
                f"{result.stderr.decode(errors='replace')[:400]}"
            )
    except FileNotFoundError:
        raise RuntimeError("chromium binary not found — rebuild the image with the updated Dockerfile")
    if not os.path.exists(output_path):
        raise RuntimeError("chromium ran but no PDF was written (URL unreachable? check uvicorn workers > 1)")
    return output_path


def _earliest_content_date() -> Optional[date]:
    with get_db() as conn:
        row = conn.execute(
            "SELECT MIN(date) as earliest FROM ("
            "  SELECT date FROM day_documents WHERE content != '' "
            "  UNION SELECT DISTINCT date FROM workflow_entries"
            ") WHERE date IS NOT NULL"
        ).fetchone()
    if not row or not row[0]:
        return None
    try:
        return datetime.strptime(row[0], "%Y-%m-%d").date()
    except Exception:
        return None


def _generate_all_pdf_chunks() -> Tuple[List[str], List[str]]:
    """Walk backwards from today in 30-day windows until we've covered all
    content. Return (generated_filepaths, errors)."""
    earliest = _earliest_content_date()
    if not earliest:
        return [], []
    # Clear stale PDFs so a shrunk history doesn't leave orphans on disk
    for f in os.listdir(PDF_DIR):
        if f.startswith("lab-notes_") and f.endswith(".pdf"):
            try: os.remove(os.path.join(PDF_DIR, f))
            except Exception: pass

    generated, errors = [], []
    end_dt = date.today()
    while end_dt >= earliest:
        try:
            pdf = _generate_pdf_for_range(end_dt.strftime("%Y-%m-%d"), days=30)
            if pdf:
                generated.append(pdf)
        except Exception as e:
            errors.append(f"{end_dt.isoformat()}: {e}")
        end_dt = end_dt - timedelta(days=30)
    return generated, errors


def _get_settings():
    with get_db() as conn:
        row = conn.execute("SELECT * FROM backup_settings WHERE id=1").fetchone()
    return dict(row) if row else {}


def _create_archive(label: str = ""):
    ts        = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    suffix    = ("_" + label.replace(" ", "_")[:20]) if label else ""
    filename  = f"lab_backup_{ts}{suffix}.tar.gz"
    filepath  = os.path.join(BACKUP_DIR, filename)

    src       = sqlite3.connect(DB_PATH)
    sql_bytes = "\n".join(src.iterdump()).encode("utf-8")
    src.close()

    with tarfile.open(filepath, "w:gz") as tar:
        info      = tarfile.TarInfo(name="lab.sql")
        info.size = len(sql_bytes)
        tar.addfile(info, io.BytesIO(sql_bytes))
        if os.path.isdir(GB_FILES_DIR):
            tar.add(GB_FILES_DIR, arcname="gb_files")
        # PDF chunks live in /data/backups/pdfs/ — include them under pdfs/
        # inside the tarball. They're separately uploaded to rclone in
        # _run_backup_sync so this is the "also inside the bundle" copy.
        if os.path.isdir(PDF_DIR):
            tar.add(PDF_DIR, arcname="pdfs")

    return filepath, filename


def _rclone_available():
    try:
        r = subprocess.run(["rclone", "version"], capture_output=True, timeout=5)
        return r.returncode == 0
    except FileNotFoundError:
        return False


def _rclone_remote_configured(remote: str):
    try:
        r = subprocess.run(["rclone", "listremotes"], capture_output=True, text=True, timeout=5)
        return (remote + ":") in r.stdout
    except Exception:
        return False


def _upload_rclone(filepath: str, settings: dict):
    remote = settings.get("rclone_remote", "gdrive")
    path   = settings.get("rclone_path", "lab_backups")
    dest   = f"{remote}:{path}"
    result = subprocess.run(
        ["rclone", "copy", filepath, dest],
        capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "rclone copy failed")


def _upload_rclone_pdfs(settings: dict):
    """Sync /data/backups/pdfs/ to <remote>:<path>/pdfs/. Uses rclone sync so
    removed local chunks (e.g. after regeneration with a shrunk history) are
    also removed on the remote. Idempotent — unchanged PDFs aren't re-uploaded."""
    if not os.path.isdir(PDF_DIR) or not os.listdir(PDF_DIR):
        return
    remote = settings.get("rclone_remote", "gdrive")
    path   = settings.get("rclone_path", "lab_backups")
    dest   = f"{remote}:{path}/pdfs"
    result = subprocess.run(
        ["rclone", "sync", PDF_DIR, dest],
        capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "rclone sync (pdfs) failed")


def _upload_smb(filepath: str, filename: str, settings: dict):
    import smbclient
    server   = settings["smb_host"]
    share    = settings["smb_share"]
    user     = settings.get("smb_user", "")
    password = settings.get("smb_password", "")
    subpath  = settings.get("smb_path", "lab_backups")

    smbclient.register_session(server, username=user, password=password)
    remote_dir  = f"\\\\{server}\\{share}\\{subpath}"
    remote_file = f"{remote_dir}\\{filename}"
    try:
        smbclient.makedirs(remote_dir, exist_ok=True)
    except Exception:
        pass
    with open(filepath, "rb") as local:
        with smbclient.open_file(remote_file, mode="wb") as remote:
            remote.write(local.read())


def _run_backup_sync(destinations: List[str], label: str = "") -> dict:
    errors = []
    # ── Regenerate PDF chunks BEFORE the archive so they get bundled in ─────
    # PDF generation errors don't abort the backup — they get recorded in
    # `notes` and the DB tarball still goes through. Chromium is heavy so
    # this adds meaningful time to backup runs (roughly 1–2 s per chunk).
    pdf_files, pdf_errors = _generate_all_pdf_chunks()
    for e in pdf_errors:
        errors.append(f"PDF: {e}")

    filepath, filename = _create_archive(label)
    size     = os.path.getsize(filepath)
    settings = _get_settings()

    done_dests = ["local"]

    if "gdrive" in destinations:
        if not _rclone_available():
            errors.append("GDrive: rclone not installed in container")
        else:
            remote = settings.get("rclone_remote", "gdrive") if settings else "gdrive"
            if not _rclone_remote_configured(remote):
                errors.append(f"GDrive: rclone remote '{remote}' not configured")
            else:
                try:
                    _upload_rclone(filepath, settings)
                    done_dests.append("gdrive")
                except Exception as e:
                    errors.append(f"GDrive: {e}")
                # Independently sync PDFs to <remote>:<path>/pdfs/. If the
                # tarball upload above failed, we still try the PDFs — they're
                # separate artifacts and one shouldn't gate the other.
                try:
                    _upload_rclone_pdfs(settings)
                except Exception as e:
                    errors.append(f"GDrive PDFs: {e}")

    if "smb" in destinations and settings.get("smb_host"):
        try:
            _upload_smb(filepath, filename, settings)
            done_dests.append("smb")
        except Exception as e:
            errors.append(f"SMB: {e}")

    now    = datetime.utcnow().isoformat()
    status = "ok" if not errors else "partial"
    notes_parts = []
    if pdf_files:
        notes_parts.append(f"{len(pdf_files)} PDF chunk(s) generated")
    if errors:
        notes_parts.extend(errors)
    notes = "\n".join(notes_parts) if notes_parts else None

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO backups (filename, size_bytes, destinations, status, notes, created) "
            "VALUES (?,?,?,?,?,?)",
            (filename, size, json.dumps(done_dests), status, notes, now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM backups WHERE id=?", (cur.lastrowid,)).fetchone())

    row["destinations"] = json.loads(row["destinations"])
    return row


# ── scheduler ─────────────────────────────────────────────────────────────────

_sched_active = False

def _scheduler():
    global _sched_active
    last_run_minute = ""
    while _sched_active:
        try:
            s = _get_settings()
            if s and s.get("daily_enabled"):
                target     = s.get("daily_time", "02:00")
                now_minute = datetime.utcnow().strftime("%H:%M")
                if now_minute == target and now_minute != last_run_minute:
                    last_run_minute = now_minute
                    _run_backup_sync(["local", "gdrive", "smb"], label="scheduled")
        except Exception:
            pass
        time.sleep(60)

def _start_scheduler():
    global _sched_active
    if not _sched_active:
        _sched_active = True
        threading.Thread(target=_scheduler, daemon=True).start()

_start_scheduler()


# ── Pydantic models ───────────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    rclone_remote: Optional[str]  = None
    rclone_path:   Optional[str]  = None
    smb_host:      Optional[str]  = None
    smb_share:     Optional[str]  = None
    smb_user:      Optional[str]  = None
    smb_password:  Optional[str]  = None
    smb_path:      Optional[str]  = None
    daily_enabled: Optional[bool] = None
    daily_time:    Optional[str]  = None

class RunBody(BaseModel):
    destinations: List[str] = ["local"]
    label: str = ""


# ── router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/settings")
def get_settings_route():
    s = _get_settings()
    base = {
        "daily_enabled":     False,
        "daily_time":        "02:00",
        "rclone_remote":     "gdrive",
        "rclone_path":       "lab_backups",
        "rclone_available":  _rclone_available(),
        "rclone_configured": False,
        "smb_host":          None,
    }
    if not s:
        return base
    out = dict(s)
    if out.get("smb_password"):
        out["smb_password"] = "***"
    out["daily_enabled"]     = bool(out.get("daily_enabled"))
    out["rclone_available"]  = _rclone_available()
    out["rclone_configured"] = _rclone_remote_configured(out.get("rclone_remote", "gdrive"))
    return out


@router.post("/settings")
def update_settings(body: SettingsBody):
    now      = datetime.utcnow().isoformat()
    existing = _get_settings()
    data     = body.dict(exclude_none=True)
    if "daily_enabled" in data:
        data["daily_enabled"] = 1 if data["daily_enabled"] else 0
    with get_db() as conn:
        if not existing:
            conn.execute(
                "INSERT INTO backup_settings (id, rclone_remote, rclone_path, "
                "smb_host, smb_share, smb_user, smb_password, smb_path, "
                "daily_enabled, daily_time, created) VALUES (1,?,?,?,?,?,?,?,?,?,?)",
                (data.get("rclone_remote", "gdrive"), data.get("rclone_path", "lab_backups"),
                 data.get("smb_host"), data.get("smb_share"),
                 data.get("smb_user"), data.get("smb_password"),
                 data.get("smb_path", "lab_backups"),
                 data.get("daily_enabled", 0), data.get("daily_time", "02:00"), now))
        elif data:
            sets = ", ".join(f"{k}=?" for k in data)
            conn.execute(f"UPDATE backup_settings SET {sets} WHERE id=1", list(data.values()))
        conn.commit()
    return {"ok": True}


@router.post("/settings/clear-smb")
def clear_smb():
    with get_db() as conn:
        conn.execute(
            "UPDATE backup_settings SET smb_host=NULL, smb_share=NULL, "
            "smb_user=NULL, smb_password=NULL WHERE id=1")
        conn.commit()
    return {"ok": True}


@router.get("/list")
def list_backups():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM backups ORDER BY created DESC").fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["destinations"] = json.loads(d.get("destinations") or "[]")
        d["exists"]       = os.path.exists(os.path.join(BACKUP_DIR, d["filename"]))
        items.append(d)
    return {"items": items}


@router.post("/run")
def run_backup(body: RunBody):
    try:
        return _run_backup_sync(body.destinations, body.label)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{backup_id}/download")
def download_backup(backup_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM backups WHERE id=?", (backup_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Backup not found")
    path = os.path.join(BACKUP_DIR, row["filename"])
    if not os.path.exists(path):
        raise HTTPException(404, "Backup file missing from disk")
    return FileResponse(path, filename=row["filename"], media_type="application/gzip")


@router.delete("/{backup_id}")
def delete_backup(backup_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM backups WHERE id=?", (backup_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Backup not found")
        path = os.path.join(BACKUP_DIR, row["filename"])
        if os.path.exists(path):
            os.remove(path)
        conn.execute("DELETE FROM backups WHERE id=?", (backup_id,))
        conn.commit()
    return {"ok": True}


@router.post("/{backup_id}/restore")
def restore_backup(backup_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM backups WHERE id=?", (backup_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Backup not found")
    path = os.path.join(BACKUP_DIR, row["filename"])
    if not os.path.exists(path):
        raise HTTPException(404, "Backup file missing from disk")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            with tarfile.open(path, "r:gz") as tar:
                tar.extractall(tmp)
            sql_path = os.path.join(tmp, "lab.sql")
            gb_src   = os.path.join(tmp, "gb_files")
            if os.path.exists(sql_path):
                with open(sql_path, "r", encoding="utf-8") as f:
                    sql = f.read()
                rc = sqlite3.connect(DB_PATH)
                rc.executescript(sql)
                rc.close()
            if os.path.exists(gb_src):
                if os.path.isdir(GB_FILES_DIR):
                    shutil.rmtree(GB_FILES_DIR)
                shutil.copytree(gb_src, GB_FILES_DIR)
    except Exception as e:
        raise HTTPException(500, f"Restore failed: {e}")
    return {"ok": True, "message": "Restore complete. Please reload the page."}


@router.post("/test-rclone")
def test_rclone():
    if not _rclone_available():
        raise HTTPException(400, "rclone is not installed in the container — add it to your Dockerfile")
    s      = _get_settings()
    remote = s.get("rclone_remote", "gdrive") if s else "gdrive"
    if not _rclone_remote_configured(remote):
        raise HTTPException(400, f"rclone remote '{remote}' not configured — run 'rclone config' on the host first")
    try:
        result = subprocess.run(
            ["rclone", "about", f"{remote}:"],
            capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        return {"ok": True, "info": result.stdout.strip()}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/test-smb")
def test_smb():
    s = _get_settings()
    if not s or not s.get("smb_host"):
        raise HTTPException(400, "No SMB host configured")
    try:
        import smbclient
        smbclient.register_session(
            s["smb_host"],
            username=s.get("smb_user", ""),
            password=s.get("smb_password", ""))
        smbclient.listdir(f"\\\\{s['smb_host']}\\{s['smb_share']}")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


# ── PDF chunk endpoints ──────────────────────────────────────────────────────

@router.get("/print-html", response_class=HTMLResponse)
def backup_print_html(end: str, days: int = 30):
    """Print-ready HTML view for chromium to render to PDF. Not intended for
    browser use directly (chrome fetches it internally over 127.0.0.1). Returns
    an HTML doc with cover page, print CSS, and one section per day in the
    window."""
    try:
        datetime.strptime(end, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "end must be YYYY-MM-DD")
    if days < 1 or days > 366:
        raise HTTPException(400, "days must be between 1 and 366")
    end_dt = datetime.strptime(end, "%Y-%m-%d").date()
    start_iso = (end_dt - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with get_db() as conn:
        docs = _range_docs(conn, start_iso, end)
    return HTMLResponse(content=_build_print_html(docs, start_iso, end))


@router.post("/generate-pdfs")
def generate_pdfs():
    """Manually trigger PDF chunk regeneration across the full history.
    Returns which chunks were produced and any per-chunk errors. Backups
    also trigger this automatically."""
    pdf_files, errs = _generate_all_pdf_chunks()
    return {
        "generated": [os.path.basename(p) for p in pdf_files],
        "count": len(pdf_files),
        "errors": errs,
    }


@router.get("/pdfs")
def list_pdfs():
    """List PDF chunks currently on disk, with size and mtime. Used by the
    backup UI to show what's ready to sync."""
    if not os.path.isdir(PDF_DIR):
        return {"pdfs": []}
    out = []
    for fn in sorted(os.listdir(PDF_DIR), reverse=True):
        if not fn.endswith(".pdf"):
            continue
        p = os.path.join(PDF_DIR, fn)
        try:
            st = os.stat(p)
            out.append({
                "filename": fn,
                "size_bytes": st.st_size,
                "modified": datetime.utcfromtimestamp(st.st_mtime).isoformat(),
            })
        except Exception:
            pass
    return {"pdfs": out}


@router.get("/pdfs/{filename}")
def download_pdf(filename: str):
    """Serve a specific PDF chunk. Filename must be exact — no path traversal."""
    if "/" in filename or ".." in filename or not filename.endswith(".pdf"):
        raise HTTPException(400, "invalid filename")
    p = os.path.join(PDF_DIR, filename)
    if not os.path.exists(p):
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="application/pdf", filename=filename)
