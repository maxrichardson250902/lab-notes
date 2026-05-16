"""User settings — single-row table of UI preferences.

One row, accessed via id=1 (enforced by CHECK constraint). Stored as a JSON
blob so adding settings later doesn't require schema changes. Defaults are
applied server-side so the frontend always sees a complete settings object,
even on a fresh install."""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime
import json

from core.database import register_table, get_db

router = APIRouter(prefix="/api", tags=["settings"])

# Single-row table — CHECK constraint enforces id=1 only.
register_table("user_settings", """CREATE TABLE IF NOT EXISTS user_settings (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    config  TEXT NOT NULL DEFAULT '{}',
    updated TEXT NOT NULL)""")

# Defaults. Adding new keys later is safe — the frontend merges these on top
# of stored config, so users with old data get sensible values for new keys.
DEFAULTS = {
    # Wide-view max width in px. Applies to views registered with {wide:true}.
    # Narrow views are unaffected. 0 means "no cap" (fills viewport).
    "wide_view_max_px": 1800,
    # Which view to load on app boot
    "default_view": "notebook",
    # Sidebar auto-hide on view change with hover-to-reveal
    "sidebar_auto_hide": False,
    # Debounce for auto-save in editors (workflow doc, scratch). Milliseconds.
    "auto_save_delay_ms": 1500,
}


def _get_config() -> dict:
    """Read config from DB, falling back to defaults. Returns a *merged* dict
    so callers always see every key."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT config FROM user_settings WHERE id=1"
        ).fetchone()
    stored = {}
    if row and row["config"]:
        try:
            stored = json.loads(row["config"])
        except json.JSONDecodeError:
            # Corrupted — treat as empty, defaults take over.
            stored = {}
    return {**DEFAULTS, **stored}


def _write_config(config: dict) -> None:
    """Persist the config dict. Upserts the single row."""
    now = datetime.utcnow().isoformat()
    blob = json.dumps(config)
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM user_settings WHERE id=1"
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE user_settings SET config=?, updated=? WHERE id=1",
                (blob, now),
            )
        else:
            conn.execute(
                "INSERT INTO user_settings (id, config, updated) VALUES (1, ?, ?)",
                (blob, now),
            )
        conn.commit()


@router.get("/settings")
def get_settings():
    """Return the full settings object — defaults merged with stored values."""
    return _get_config()


class SettingsUpdate(BaseModel):
    # Single setting set: {"key": "wide_view_max_px", "value": 2400}
    key: Optional[str] = None
    value: Optional[Any] = None
    # Bulk update: {"settings": {...}}
    settings: Optional[dict] = None


@router.put("/settings")
def update_settings(body: SettingsUpdate):
    """Update one or many settings. Unknown keys are accepted (forward-compat
    with frontend additions) but validated against simple type constraints."""
    config = _get_config()
    updates = {}
    if body.settings:
        updates.update(body.settings)
    if body.key is not None:
        updates[body.key] = body.value
    # Coerce types where we know what they should be.
    for k, v in updates.items():
        if k == "wide_view_max_px":
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            # Clamp: 800 minimum (anything smaller is silly), no max (let user
            # do full-width if they want).
            v = max(800, v) if v > 0 else 0  # 0 = no cap
        elif k == "auto_save_delay_ms":
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            # Clamp 300ms..10s — anything outside this range is a mistake.
            v = max(300, min(v, 10_000))
        elif k == "sidebar_auto_hide":
            v = bool(v)
        elif k == "default_view":
            # Keep as string. Any unknown view will just fail to render later;
            # we don't validate against the view registry here because it's a
            # frontend concept.
            v = str(v)
        config[k] = v
    _write_config(config)
    return config


@router.post("/settings/reset")
def reset_settings():
    """Reset all settings to defaults. Useful escape hatch if the user gets
    into a weird state via a bad setting."""
    _write_config({})
    return _get_config()
