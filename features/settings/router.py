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
    # Delay (ms) before the auto-hidden sidebar peeks out when the user hovers
    # the left edge. Lower = snappier; higher = avoids accidental triggers.
    "sidebar_peek_delay_ms": 150,
    # Debounce for auto-save in editors (workflow doc, scratch). Milliseconds.
    "auto_save_delay_ms": 1500,
    # ── Workflow chip auto-insertion ───────────────────────────────────────
    # On Enter in the workflow doc, insert a time chip only if the user has
    # been idle for at least this long. Prevents spam during active typing
    # while still stamping natural break points. Manual Ctrl+T always
    # inserts regardless of this setting.
    "wf_chip_idle_minutes": 5,
    # ── Archived DNA entries ──────────────────────────────────────────────
    # Show archived DNA entries (plasmids, primers, gblocks, kit parts, parts).
    # When off (default), rows with private=1 are filtered out at both the
    # frontend list render AND the backend query WHERE clause. When on, they
    # come through and each entry gets a per-row archive toggle in the UI.
    # Deliberately named blandly — this is the visible label in the Settings
    # view. Also serves as the visibility gate for personal work-in-progress
    # / IP-sensitive entries the user doesn't want a shared viewer to see.
    "show_archived_items": False,
    # ── Reminders boot delay ──────────────────────────────────────────────
    # Milliseconds to wait after page load before checking for due
    # reminders and firing the pop-up notification. Higher = less chance
    # of interrupting whatever you were about to do. Lower = pop-up
    # appears sooner. The 60s poll after boot is unaffected.
    "reminder_boot_delay_ms": 1500,
    # ── LLM backend selection ──────────────────────────────────────────────
    # Which LLM backend the app uses for enrichment, protocol
    # extraction, Process Day, etc. "3090" = local GPU (free); "claude" =
    # Anthropic API (costs money, capped below); "local" = alias for 3090.
    "llm_backend": "3090",
    # Which Claude model to use when llm_backend is "claude".
    "claude_model": "claude-haiku-4-5-20251001",
    # Daily Anthropic budget you allot overall, in USD. The app may spend at
    # most app_budget_fraction of this per day; past that it falls back to the
    # 3090. (The API key itself is an env var, never stored here.)
    "app_daily_budget_usd": 1.0,
    # Fraction of app_daily_budget_usd this app is allowed to consume per day.
    # 0.15 = 15%. When reached, LLM calls fall back to the local 3090.
    "app_budget_fraction": 0.15,
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
        elif k == "sidebar_peek_delay_ms":
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            # 0..3000ms — 0 = instant, 3s is the upper bound before it stops
            # feeling like a hover and starts feeling broken.
            v = max(0, min(v, 3000))
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


@router.get("/llm-spend")
def llm_spend():
    """Today's Claude API usage for this app: calls, tokens, cost, and how much
    of the app's daily ceiling has been consumed. Lets the Settings UI show a
    little 'used $0.03 / $0.15 today' indicator."""
    try:
        from core.claude import spend_today, current_backend, _api_key
        d = spend_today()
        d["backend"] = current_backend()
        d["api_key_present"] = bool(_api_key())
        return d
    except Exception as e:
        return {"error": str(e), "backend": "3090", "api_key_present": False,
                "calls": 0, "cost_usd": 0.0, "ceiling_usd": 0.0, "fraction_used": 0.0}
