# Lab Notes

An opinionated, self-hosted electronic lab notebook for molecular biology /
synthetic biology workflows. Combines a daily workflow log, a notebook,
DNA / plasmid / primer inventory, protocols with run-tracking, a cloning
workbench (sequence viewer, primer design, assembly), gel annotation,
circuit design, and Sanger validation in one app.

Built single-user — one person per instance — see "Hosting for a lab" below
for what running it for several people would actually involve.

---

## Quick orientation: what's where

The sidebar groups views into:

- **Workflow** — daily lab notebook. Type as you work; tag blocks by project.
  At end of day, "Process day" sends the document to an LLM that formats it
  into one structured notebook entry per project group.
- **Notebook** — long-term archive. Group → day → entry hierarchy. Each entry
  has title, notes, results, yields, issues + image and gel attachments.
- **Protocols** — protocol library with steps + recipe tables. Protocols can
  be run (creating an "active run") which tracks step completion + recipe
  values, then saved as a notebook entry on completion.
- **Cloning Workbench** — sequence viewer (powered by SeqViz), feature
  editor, primer design (custom / PCR / sequencing / KLD), assembly designer
  (Gibson / Golden Gate / digest-ligate), restriction digest, ORF finder,
  in-silico PCR. Multi-tab — keep several sequences open at once.
- **Circuits** — SBOL-style genetic circuit designer. Drag parts in (loaded
  from your DNA inventory), reorder, save back as plasmids / parts / gBlocks
  with annotations preserved.
- **DNA Manager** — inventory: plasmids, primers, gBlocks, kit parts, parts,
  storage boxes. Each entry can carry a `.gb` file with annotations.
- **Gel Annotation** — upload a gel image, draw lanes, annotate bands using
  a ladder. Link gels back to notebook entries.
- **Sanger** — upload an `.ab1` chromatogram, align against a reference from
  your inventory, see mismatches.
- **Timeline / Predictions / Summaries** — read-only project views
  generated from notebook entries.
- **Settings** — UI preferences (width cap, default view, sidebar behaviour,
  auto-save delay).

The app expects a **`Ctrl+K` global search** (notebook entries, protocols,
all DNA tables) — works from any view.

---

## Daily usage in one paragraph

Open the app, land on the **Workflow** view (or whatever you set as default).
Type as you work. Press Enter for a new line — a timestamp chip auto-appears.
Select a block and press `Ctrl+G` (or click "Groups…" in the toolbar) to tag
it with one or more project groups. At the end of the day, press
"Process · today" — the day's document gets sent to the project's LLM
formatter, which produces one structured notebook entry per group.

When running a protocol, click "Run a protocol" in the workflow view, pick
the protocol + group, and a side-panel appears showing the recipe. Step
through the protocol — completion is tracked. When done, click "Finish" on
the sidebar card (or from the workflow). The run gets saved to the notebook
with its step list and any deviations.

If you forget to finish a protocol and reload the app the next day, a
**daily check-in popup** asks "are you still running this?" for each
unfinished run from previous days. Snooze for 24h, mark done (with date
override), or cancel.

For sequence work, go to **Cloning**, pick a sequence from the sidebar.
Multiple sequences can be open in tabs. Use the viewer to inspect features,
the primer design panel to make oligos, the assembly designer to plan
cloning reactions. Save designs back as plasmids → they appear in DNA
Manager with the `.gb` file attached.

---

## Architecture

### Big picture

```
┌─────────────────────────────────────────────┐
│  Browser                                    │
│   index.html (a single bundled SPA)         │
│   ├── core.js          (S state, boot, nav) │
│   └── features/*.js    (one per view)       │
└──────────────────┬──────────────────────────┘
                   │ HTTP /api/*
┌──────────────────▼──────────────────────────┐
│  FastAPI (uvicorn) in Docker                │
│   main.py                                   │
│   ├── auto-discovers features/*/router.py   │
│   ├── mounts /static/ for the SPA           │
│   └── shared core/ (db, ssh, llm helpers)   │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┼─────────────────────────────┐
        │          │                             │
        ▼          ▼                             ▼
   SQLite      /data/gb_files/             Optional: SSH to
   /data/      (GenBank files for          another machine
   lab.db      every DNA entry)            for LLM (3090)
```

The whole frontend is bundled into a single `index.html` by `build.py` —
~22000 lines of inlined JS/CSS. There's no webpack / no bundler in the
traditional sense; build.py is a Python script that concatenates files
and inlines them between `<script>` tags. Crude but fast and dependency-free.

### Modular feature pattern

Both frontend and backend follow the same convention: one folder/file per
feature. Adding a new feature is **three small steps**, no edits to
`main.py` or the build infrastructure.

**Backend:**
```
features/
└── my_feature/
    ├── __init__.py     # empty
    └── router.py       # FastAPI APIRouter + register_table calls
```
`features/__init__.py` auto-imports every subfolder on startup; its
router is mounted. `register_table` calls run at import time, so any
new tables are created automatically on first boot.

**Frontend:**
```
static/features/my_feature.js
```
Add `"my_feature"` to `FEATURE_ORDER` in `build.py` AND add a
`<script>` tag in `static/index.dev.html` (yes, two places — minor
papercut; see "Known limitations"). Then in the file:

```js
async function renderMyFeature(el) {
  el.innerHTML = '<h2>Hello</h2>';
}
registerView('my_feature', renderMyFeature, {wide: true});
```

A sidebar nav entry needs to be added manually in `static/index.dev.html`:

```html
<div class="nav-item" id="nav-my_feature" onclick="setView('my_feature')">
  <span>🔬</span><span>My Feature</span>
</div>
```

### Key conventions

- **`registerView(name, fn, opts)`** — `opts.wide:true` makes the view
  span the wide-content max-width (currently set in Settings)
- **`registerTable(name, SQL)`** — runs at import time, idempotent
- **`register_seed(fn)`** — runs once at startup, for data migrations
  (used e.g. for the `workflow_entries → day_documents` migration)
- **`ensure_column(conn, table, col, decl)`** — idempotent column-add
  for evolving schemas without breaking existing data
- **`api(method, path, body)`** — frontend helper, fetch wrapper. Throws on
  non-2xx; returns parsed JSON.
- **`registerView`'s `opts.wide`** + the `--wide-cap` CSS variable
  drive layout width. Default views are narrow (max ~1100px for
  readability); wide views (cloning, workflow doc, gel) span up to the
  user's configured cap.

### Frontend state

There's a global `S` object holding session state — current view,
filters, settings, etc. Most features also hold their own module-level
state (`_cl` for cloning, `_dna` for DNA manager, `_wf*` for workflow,
etc.). State persists across view switches because modules aren't
unloaded; the DOM gets rebuilt from state on every render.

Cloning specifically uses a **tab manager** (`_clTabs`, `_clActiveTab`)
that snapshots per-tab state in and out of `_cl` on tab switch. Tab
metadata persists to localStorage so tabs survive page reload.

### Critical helpers

- **`core/database.py`** — SQLite connection pool, `get_db()` context
  manager. Uses WAL mode + `busy_timeout=5000` to avoid lock errors
  under light concurrent access.
- **`core/ssh.py`** — wakes the 3090 over Wake-on-LAN, runs commands
  over SSH, calls a local llama.cpp server for LLM inference.
- **`core/llm.py`** — text fetching for URL-based protocol extraction.

---

## Running it

### Prerequisites

- A Linux machine (or any machine with Docker + Docker Compose)
- Docker Compose v2
- An SSH key + a separate machine to run the LLM on (optional — workflow
  processing won't work without it, but the rest of the app does)

### Deploy

```bash
git clone <repo-url> ~/services/lab-notes
cd ~/services/lab-notes

# Edit docker-compose.yml — set PC_IP, PC_USER, PC_MAC for your LLM machine,
# OR remove those env vars if you don't have one (workflow processing will
# fail gracefully with a "3090 offline" toast).
$EDITOR docker-compose.yml

# Build and start
docker compose up -d --build lab-notes

# Confirm it's running
docker compose ps
docker compose logs lab-notes --tail 20
```

The app is now on port 3003 (host networking). Open
`http://<server-ip>:3003` in a browser.

### Where the data lives

- **`lab-data` Docker volume** → `/data/` inside the container
  - `/data/lab.db` — SQLite database (all tables)
  - `/data/gb_files/` — `.gb` files for plasmids, primers, gBlocks, parts, kit parts
  - `/data/gel_images/`, `/data/entry_images/` — uploaded images
  - `/data/sanger_files/` — `.ab1` traces

To back up, just back up the volume:

```bash
docker run --rm -v lab-data:/data -v $PWD:/backup busybox \
  tar -czf /backup/lab-data-$(date +%Y%m%d).tar.gz -C / data
```

The **Backup** view in the app also exports / restores via Google Drive
(rclone). Configure rclone on the host and mount its config (see
docker-compose.yml).

### Deploy after code changes

The static directory is bind-mounted so JS/CSS changes take effect on the
next browser refresh. Python changes need a rebuild:

```bash
# JS/CSS only:
python3 build.py
docker compose restart lab-notes

# Python (anything under features/*.py, core/*.py, main.py):
python3 build.py
docker compose up -d --build lab-notes
```

When in doubt, the rebuild path always works (takes ~10 seconds).

---

## Hosting for a lab — honest considerations

The app is **single-user by design.** Every API endpoint operates on a
shared global dataset. There's no authentication, no permissions, no
user concept. If multiple people log into one instance, they all see
each other's data and can edit/delete it.

Three realistic paths:

### 1. Self-host per person (recommended)

Each lab member runs their own instance on their own machine or VM.
Their data stays separate, their settings are their own, no auth needed
because the server is only accessible to them.

The Docker Compose setup makes this feasible for technically-comfortable
users. Less-technical members would need help with the initial setup.

This avoids the security/maintenance burden on you entirely.

### 2. Multi-instance behind a reverse proxy

You host N separate containers, one per person, each with its own
volume / DB / port. A reverse proxy (Caddy, nginx) maps
`alice.lab-notes.example.com` to alice's container, `bob.…` to bob's.
Add HTTP basic auth or OAuth at the proxy level.

This works *without code changes* — but you're now operating a service
for N people. Backups, "I broke my data", "the LLM stopped working" —
all your problems.

### 3. Make it truly multi-user

A real multi-user rewrite is **weeks of careful work**:

- Add a `user_id` column to every table (entries, protocols, primers,
  plasmids, parts, gblocks, kit_parts, day_documents, active_runs,
  protocol_runs, settings, gels, sanger_runs, reminders, scratch,
  workflow_migration_log… and more)
- Add `WHERE user_id = ?` to every SQL query (~hundreds across the
  codebase)
- Add authentication middleware to every route
- Build login / signup / session management UI
- Per-user settings (already a feature but it's single-row right now)
- Decide what's shared: protocols library? DNA inventory? Or fully
  isolated per user?
- The SSH-to-3090 integration would need rethinking (per-user creds?
  shared queue?)
- Security audit: this is now a multi-tenant web service holding
  research data

**Honest recommendation:** don't do (3) unless someone is willing to
own it as a real project. (1) or (2) is much more sustainable.

---

## Known limitations

Things I'm aware of but haven't fixed:

- **`build.py` and `index.dev.html` are two sources of truth** for the
  frontend feature list. Adding a feature means updating both. A
  future build.py could glob `static/features/*.js` and have
  `index.dev.html` use a marker comment instead.
- **`cloning.js` is 6300+ lines.** Should be split into
  `cloning_primers.js`, `cloning_assembly.js`, etc. Pure structural
  work, no user value — left for a rainy day.
- **Three different type-string conventions** float through the
  codebase: `kit_part` (DB table) vs `kitpart` (file prefix) vs
  `kitParts` (frontend state key). A small `core/types.py` translator
  would clean this up.
- **`_ssh.enrich_running` is a process-level boolean.** If an LLM job
  dies between setting it true and the `try/finally` restoring it,
  subsequent jobs may get rejected. Workaround: restart the container.
- **Tab dirty tracking in cloning is best-effort.** `featuresDirty` is
  set in obvious edit paths but may miss subtler ones. The "close
  unsaved tab?" warning may not fire for every kind of unsaved change.
- **No URL routing** — refreshing the page loses your view selection
  unless `default_view` is set. The check-in popup and workflow
  navigate-back-to-this-view patterns work around this for the
  specific cases that mattered.
- **OneNote import** is disabled by default and was a one-off
  migration helper. Not maintained.

---

## Development

### Adding a setting

1. Edit `features/settings/router.py`: add a key + default to `DEFAULTS`.
   Add type coercion in `update_settings()` if it's not a bool/string.
2. Edit `static/features/settings.js`: add an entry to `SETTINGS_SPEC`.
3. Edit `static/core.js`: add the default to `S.settings` so code that
   reads it before boot completes has a value.
4. Wire the behaviour — wherever the setting takes effect, read from
   `S.settings.your_key`. If the change needs a visible immediate
   effect, update `applySettings()` to apply it.

### Adding a backend table

```python
# Anywhere in your feature's router.py:
from core.database import register_table

register_table("my_table", """CREATE TABLE IF NOT EXISTS my_table (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    created TEXT NOT NULL)""")
```

Idempotent — runs on every startup, does nothing if the table exists.

### Evolving a schema

For column additions, use `ensure_column`:

```python
from core.database import register_seed, ensure_column

register_seed(lambda conn:
    ensure_column(conn, "my_table", "new_col", "TEXT DEFAULT NULL"))
```

The seed runs once at startup, idempotent.

### Adding a view

See "Modular feature pattern" above. The shortest possible new view:

1. Create `static/features/hello.js`:
   ```js
   async function renderHello(el) {
     el.innerHTML = '<h2>Hello</h2>';
   }
   registerView('hello', renderHello);
   ```
2. Add `"hello"` to `FEATURE_ORDER` in `build.py`.
3. Add `<script src="/static/features/hello.js"></script>` to
   `static/index.dev.html`.
4. Add a nav entry in `static/index.dev.html`:
   ```html
   <div class="nav-item" id="nav-hello" onclick="setView('hello')">
     <span>👋</span><span>Hello</span>
   </div>
   ```
5. `python3 build.py && docker compose restart lab-notes`

### Testing

There are no automated tests. Manual testing through the UI is the
only verification path. If you're making backend changes, the easiest
sanity check is hitting endpoints directly:

```bash
curl http://localhost:3003/api/stats
curl http://localhost:3003/api/settings
```

---

## Frequently useful commands

```bash
# Inspect the DB from inside the container
docker compose exec lab-notes python3 -c "
import sqlite3; c = sqlite3.connect('/data/lab.db'); c.row_factory = sqlite3.Row
for r in c.execute('SELECT name FROM sqlite_master WHERE type=\"table\"'):
    print(r['name'])
"

# Logs
docker compose logs lab-notes --tail 100 -f

# Reset settings if you broke them via a bad value
curl -X POST http://localhost:3003/api/settings/reset

# What's running on the LLM machine
docker compose exec lab-notes ssh -i /root/.ssh/boltz_key max@$PC_IP \
  "pgrep -af llama_cpp || echo 'not running'"
```

---

## Credits

Built solo by Max Richardson with extensive Claude-assisted development.
Uses [SeqViz](https://github.com/Lattice-Automation/seqviz) for sequence
visualization and [OpenCloning](https://github.com/manulera/OpenCloning_backend)
for plasmid assembly simulation.
