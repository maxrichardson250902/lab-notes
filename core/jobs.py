"""Lightweight background job runner for long-running tasks.

Usage:
    from jobs import submit_job, get_job, list_jobs

    job_id = submit_job(my_function, arg1, arg2, kwarg1=val)
    # Returns immediately with a job ID

    status = get_job(job_id)
    # Returns {"id": ..., "status": "running"|"done"|"error", "progress": 0-100,
    #          "result": ..., "error": ..., "started": ..., "finished": ...}

Progress reporting:
    The target function receives an optional `_progress` callback as a kwarg.
    Call _progress(pct, message) to update progress from inside the function.
"""

import threading
import uuid
import time
import traceback

_jobs = {}  # job_id -> job dict
_lock = threading.Lock()

# Auto-cleanup: discard finished jobs older than this (seconds)
_JOB_TTL = 1500  # 25 minutes


def _cleanup():
    """Remove expired finished jobs."""
    now = time.time()
    with _lock:
        expired = [
            jid for jid, j in _jobs.items()
            if j["status"] in ("done", "error") and j.get("finished")
            and (now - j["finished"]) > _JOB_TTL
        ]
        for jid in expired:
            del _jobs[jid]


def submit_job(fn, *args, **kwargs):
    """Submit a function to run in a background thread.
    Returns a job ID string immediately."""
    _cleanup()

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "status": "running",
        "progress": 0,
        "message": "Starting…",
        "result": None,
        "error": None,
        "started": time.time(),
        "finished": None,
    }

    with _lock:
        _jobs[job_id] = job

    def _progress(pct, message=""):
        with _lock:
            if job_id in _jobs:
                _jobs[job_id]["progress"] = min(100, max(0, pct))
                if message:
                    _jobs[job_id]["message"] = message

    def _run():
        try:
            kwargs["_progress"] = _progress
            result = fn(*args, **kwargs)
            with _lock:
                _jobs[job_id]["status"] = "done"
                _jobs[job_id]["result"] = result
                _jobs[job_id]["progress"] = 100
                _jobs[job_id]["message"] = "Complete"
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[JOB {job_id}] ERROR: {e}\n{tb}", flush=True)
            with _lock:
                _jobs[job_id]["status"] = "error"
                _jobs[job_id]["error"] = str(e)
                _jobs[job_id]["message"] = f"Failed: {e}"
        finally:
            with _lock:
                if job_id in _jobs:
                    _jobs[job_id]["finished"] = time.time()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return job_id


def get_job(job_id):
    """Get current status of a job. Returns None if not found."""
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        # Return a copy so callers can't mutate internal state
        return {
            "id": job["id"],
            "status": job["status"],
            "progress": job["progress"],
            "message": job["message"],
            "result": job["result"],
            "error": job["error"],
            "elapsed": round(time.time() - job["started"], 1) if job["started"] else 0,
        }


def list_jobs():
    """List all active jobs (for debugging)."""
    _cleanup()
    with _lock:
        return [
            {"id": j["id"], "status": j["status"], "progress": j["progress"],
             "message": j["message"], "elapsed": round(time.time() - j["started"], 1)}
            for j in _jobs.values()
        ]
