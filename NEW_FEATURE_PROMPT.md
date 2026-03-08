# Adding a New Feature to Lab Notes

## Architecture Overview

Lab Notes uses a modular plugin architecture. Each feature is self-contained in two places:

```
features/<feature_name>/        ← Backend (Python)
    __init__.py                 ← Empty
    router.py                   ← FastAPI router + Pydantic models + DB tables

static/features/<feature_name>.js  ← Frontend (vanilla JS)
```

Features are **auto-discovered** at startup — no need to edit `main.py` or `index.html`.


## How It Works

### Backend
- `features/__init__.py` walks all sub-packages and looks for a `router` attribute (an `APIRouter`).
- Each feature calls `register_table()` at import time to declare its DB schema.
- Tables are created on app startup via `init_all_tables()`.

### Frontend
- Each feature JS file calls `registerView('name', renderFunction)` to plug into the view system.
- `core.js` provides shared helpers: `api()`, `S` (global state), `esc()`, `toast()`, `formatDate()`, `relTime()`.
- The `loadView()` function dispatches to whichever renderer was registered for `S.view`.

### Sidebar Navigation
For an existing nav slot, just match the view name (e.g. `setView('myfeature')`).
For new nav items, either add a `<div>` to `index.html` or call `registerNav()` in your JS file.


## Core APIs Available

### Python (`core/`)
```python
from core.database import register_table, get_db
from core.llm import llm, fetch_url_text
from core.ssh import (elog, ensure_pc_online, start_llm,
                      call_llm_3090, ssh_run, title_similarity)
import core.ssh as _ssh  # for _ssh.enrich_running
```

### JavaScript (`core.js` globals)
```javascript
api(method, path, body)    // → Promise<json>
S                          // Global state: {view, filterGroup, entries, stats, ...}
esc(str)                   // HTML-escape
toast(msg, isError?)       // Show toast notification
formatDate(dateStr)        // "Monday, 1 January 2025"
relTime(isoStr)            // "3h ago"
registerView(name, fn)     // Register a view renderer
registerNav(name, opts)    // Add sidebar nav item
```

---

## Example Prompt for Generating a New Feature

Copy and paste the following prompt into Claude (or any LLM) along with the two
template files below. The LLM only needs ~150 lines of context, not the entire codebase.

---

### Prompt:

```
I'm adding a new feature to my Lab Notes app. The app uses a modular plugin
architecture. I need you to generate TWO files:

1. `features/<name>/router.py`  — FastAPI backend
2. `static/features/<name>.js`  — Vanilla JS frontend

## Rules:
- Backend: use `from core.database import register_table, get_db`
  to declare tables and access the DB. Use `APIRouter(prefix="/api", tags=["<name>"])`.
- Frontend: call `registerView('<name>', renderFunction)` at the bottom.
  Use `api(method, path, body)` for fetch calls. Use `esc()` to escape HTML.
  Use `toast(msg)` for notifications.
- No edits to main.py or index.html needed (auto-discovery handles it).
- If I need a sidebar link, tell me the one line to add to index.html.

## Feature I want:
<DESCRIBE YOUR FEATURE HERE>

## Backend template for reference:
```python
"""<Feature name> feature — <description>."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.database import register_table, get_db

register_table("<table_name>", """CREATE TABLE IF NOT EXISTS <table_name> (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ...
    created TEXT NOT NULL)""")

class Create<Item>(BaseModel):
    ...

router = APIRouter(prefix="/api", tags=["<name>"])

@router.get("/<items>")
def list_items():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM <table> ORDER BY created DESC").fetchall()
    return {"items": [dict(r) for r in rows]}

@router.post("/<items>")
def create_item(body: Create<Item>):
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        cur = conn.execute("INSERT INTO <table> (...) VALUES (...)", (..., now))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM <table> WHERE id=?", (cur.lastrowid,)).fetchone())
    return row
```

## Frontend template for reference:
```javascript
// <Feature name> feature
async function render<Name>(el) {
  var data = await api('GET', '/api/<items>');
  var items = data.items || [];

  var html = '';
  if (!items.length) {
    html += '<div class="empty">No items yet.</div>';
  } else {
    items.forEach(function(item) {
      html += '<div class="card">' + esc(item.title) + '</div>';
    });
  }
  el.innerHTML = html;
}

// Register with core
registerView('<name>', render<Name>);
```
```

---

## Step-by-Step: Adding a Feature Manually

1. **Create the backend:**
   ```
   mkdir features/my_feature
   touch features/my_feature/__init__.py
   ```
   Write `features/my_feature/router.py` — declare tables, models, routes.

2. **Create the frontend:**
   Write `static/features/my_feature.js` — render function + `registerView()`.

3. **Add sidebar link** (if needed) — one line in `static/index.html`:
   ```html
   <div class="nav-item" id="nav-myfeature" onclick="setView('myfeature')">
     <span>🔬</span><span>My Feature</span>
   </div>
   ```

4. **Add script tag** in `static/index.dev.html` (inside the SCRIPTS markers):
   ```html
   <script src="/static/features/my_feature.js"></script>
   ```
   Also add `"my_feature"` to the `FEATURE_ORDER` list in `build.py`.

5. **Build and restart** — the build step inlines all JS/CSS into index.html:
   ```bash
   python build.py                    # or Docker does this automatically
   docker compose build --no-cache
   docker compose up -d
   ```

That's it. No changes to `main.py`, `core.js`, or any other feature file.


## File Size Comparison

| Before (monolith) | After (modular) |
|---|---|
| `main.py` — 2,242 lines | `main.py` — 25 lines |
| `index.html` — 1,619 lines | `index.html` — 100 lines |
| Total context needed: **~3,800 lines** | Context for new feature: **~150 lines** (templates + core API docs) |
