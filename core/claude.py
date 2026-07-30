"""
Anthropic Claude API backend — an alternative to the local 3090 for the
features that call an LLM (enrichment, predictions, plan converter, protocol
extraction, workflow Process Day, entry summaries).

Design notes
------------
* The API key lives ONLY in the environment (ANTHROPIC_API_KEY), never in the
  database — so it can't leak into DB backups.
* Everything else (which backend to use, the daily budget, the app's % share,
  the model) is read from user_settings so it's toggleable in the Settings UI
  with no code edit / restart.
* Real token usage from each API response is accumulated per-day in the
  llm_spend table, and cost is computed from per-model rates. The app is
  capped at `app_budget_fraction` of `app_daily_budget_usd` (default 15% of
  $1.00). When the ceiling is hit, call_claude() raises CapReachedError so the
  dispatcher in core.ssh can fall back to the 3090 automatically.
* Synchronous (httpx sync client) to match call_llm_3090's signature, so the
  five blocking call sites need no change.
"""
import os, json, datetime
import httpx

from core.database import register_table, get_db

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_BASE    = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
ANTHROPIC_VERSION = "2023-06-01"


def _api_key() -> str:
    """Read the key live from the env each call. Normally fixed at container
    start, but reading live means a runtime change (or a test) is honoured and
    the module never caches a stale/empty value."""
    return os.getenv("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY) or ""

# Per-million-token rates (input, output) in USD. Used to convert the token
# counts the API returns into a dollar figure for the budget. Update if pricing
# changes; unknown models fall back to the Sonnet rate as a safe over-estimate.
MODEL_RATES = {
    "claude-opus-4-8":          (5.0, 25.0),
    "claude-opus-4-7":          (5.0, 25.0),
    "claude-opus-4-6":          (5.0, 25.0),
    "claude-sonnet-4-6":        (3.0, 15.0),
    "claude-haiku-4-5-20251001":(1.0,  5.0),
}
_DEFAULT_RATE = (3.0, 15.0)

# Mirror of the few settings this module reads. Kept here as a fallback so the
# module works even if the settings row is empty; the real defaults also live
# in features/settings/router.py DEFAULTS and are the source of truth for the
# UI. Keep the two in sync.
_SETTING_FALLBACKS = {
    "llm_backend":          "3090",   # "3090" | "claude" | "local"
    "claude_model":         "claude-haiku-4-5-20251001",
    "app_daily_budget_usd": 1.0,
    "app_budget_fraction":  0.15,
}

register_table("llm_spend", """CREATE TABLE IF NOT EXISTS llm_spend (
    day        TEXT PRIMARY KEY,
    calls      INTEGER NOT NULL DEFAULT 0,
    in_tokens  INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd   REAL NOT NULL DEFAULT 0.0,
    updated    TEXT NOT NULL)""")


class CapReachedError(Exception):
    """Raised when the app's daily spend ceiling is reached. The dispatcher
    treats this as a signal to fall back to the 3090."""


class ClaudeNotConfigured(Exception):
    """Raised when ANTHROPIC_API_KEY is missing."""


def _settings() -> dict:
    """Read the relevant settings directly from the DB (no import of the
    settings feature, to avoid a core→features circular import)."""
    out = dict(_SETTING_FALLBACKS)
    try:
        with get_db() as conn:
            row = conn.execute("SELECT config FROM user_settings WHERE id=1").fetchone()
        if row and row["config"]:
            cfg = json.loads(row["config"])
            for k in _SETTING_FALLBACKS:
                if k in cfg and cfg[k] is not None:
                    out[k] = cfg[k]
    except Exception:
        pass
    return out


def _today() -> str:
    return datetime.date.today().isoformat()


def current_backend() -> str:
    return str(_settings().get("llm_backend", "3090"))


def spend_today() -> dict:
    """Return {calls, in_tokens, out_tokens, cost_usd, ceiling_usd, fraction_used}."""
    s = _settings()
    ceiling = float(s["app_daily_budget_usd"]) * float(s["app_budget_fraction"])
    with get_db() as conn:
        row = conn.execute("SELECT * FROM llm_spend WHERE day=?", (_today(),)).fetchone()
    spent = float(row["cost_usd"]) if row else 0.0
    return {
        "calls":      int(row["calls"]) if row else 0,
        "in_tokens":  int(row["in_tokens"]) if row else 0,
        "out_tokens": int(row["out_tokens"]) if row else 0,
        "cost_usd":   round(spent, 4),
        "ceiling_usd": round(ceiling, 4),
        "fraction_used": round(spent / ceiling, 3) if ceiling > 0 else 1.0,
    }


def _cost_for(model: str, in_tok: int, out_tok: int) -> float:
    rate_in, rate_out = MODEL_RATES.get(model, _DEFAULT_RATE)
    return (in_tok / 1_000_000.0) * rate_in + (out_tok / 1_000_000.0) * rate_out


def _record(model: str, in_tok: int, out_tok: int) -> None:
    cost = _cost_for(model, in_tok, out_tok)
    now = datetime.datetime.utcnow().isoformat()
    day = _today()
    with get_db() as conn:
        exists = conn.execute("SELECT 1 FROM llm_spend WHERE day=?", (day,)).fetchone()
        if exists:
            conn.execute(
                "UPDATE llm_spend SET calls=calls+1, in_tokens=in_tokens+?, "
                "out_tokens=out_tokens+?, cost_usd=cost_usd+?, updated=? WHERE day=?",
                (in_tok, out_tok, cost, now, day))
        else:
            conn.execute(
                "INSERT INTO llm_spend (day,calls,in_tokens,out_tokens,cost_usd,updated) "
                "VALUES (?,?,?,?,?,?)",
                (day, 1, in_tok, out_tok, cost, now))
        conn.commit()


def _ceiling_reached() -> bool:
    s = _settings()
    ceiling = float(s["app_daily_budget_usd"]) * float(s["app_budget_fraction"])
    if ceiling <= 0:
        return True   # a zero/negative budget means "never spend"
    with get_db() as conn:
        row = conn.execute("SELECT cost_usd FROM llm_spend WHERE day=?", (_today(),)).fetchone()
    return bool(row) and float(row["cost_usd"]) >= ceiling


def call_claude(system: str, prompt: str, max_tokens: int = 300,
                model: str | None = None) -> str:
    """Call the Anthropic Messages API. Signature matches call_llm_3090 so the
    blocking feature call sites can use it interchangeably.

    Raises:
        ClaudeNotConfigured — no API key in env.
        CapReachedError     — the app's daily spend ceiling is already hit.
    Returns "" on a transient API error (callers treat that like 3090 offline).
    """
    if not _api_key():
        raise ClaudeNotConfigured("ANTHROPIC_API_KEY is not set")

    # Check the ceiling BEFORE spending. If we're at/over it, signal fallback.
    if _ceiling_reached():
        raise CapReachedError("Daily Claude budget ceiling reached for this app")

    mdl = model or str(_settings().get("claude_model", _SETTING_FALLBACKS["claude_model"]))
    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                f"{ANTHROPIC_BASE}/v1/messages",
                headers={
                    "x-api-key": _api_key(),
                    "anthropic-version": ANTHROPIC_VERSION,
                    "content-type": "application/json",
                },
                json={
                    "model": mdl,
                    "max_tokens": max_tokens,
                    "system": system or "",
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except Exception:
        return ""

    if resp.status_code != 200:
        # Don't record spend for a failed call; let caller fall back to "".
        return ""

    data = resp.json()
    usage = data.get("usage", {}) or {}
    in_tok = int(usage.get("input_tokens", 0))
    out_tok = int(usage.get("output_tokens", 0))
    _record(mdl, in_tok, out_tok)

    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()
