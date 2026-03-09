"""Backup — back up lab data to local storage, rclone (Google Drive) and SMB network share."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os, json, tarfile, sqlite3, shutil, tempfile, threading, time, io, subprocess

from core.database import register_table, get_db

BACKUP_DIR   = "/data/backups"
DB_PATH      = "/data/lab.db"
GB_FILES_DIR = "/data/gb_files"

os.makedirs(BACKUP_DIR,    exist_ok=True)
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


# ── helpers ───────────────────────────────────────────────────────────────────

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
    filepath, filename = _create_archive(label)
    size     = os.path.getsize(filepath)
    settings = _get_settings()

    done_dests = ["local"]
    errors     = []

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

    if "smb" in destinations and settings.get("smb_host"):
        try:
            _upload_smb(filepath, filename, settings)
            done_dests.append("smb")
        except Exception as e:
            errors.append(f"SMB: {e}")

    now    = datetime.utcnow().isoformat()
    status = "ok" if not errors else "partial"
    notes  = "\n".join(errors) if errors else None

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
