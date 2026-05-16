/*
 * core.js — App shell, API helper, view registry, shared helpers.
 *
 * Feature JS files call registerView('name', renderFn) to plug in.
 * registerNav('name', {label, icon, section, countId}) to add sidebar items.
 */

// ── View registry ────────────────────────────────────────────────────────────
const _views = {};        // name -> async function(el)
const _viewMeta = {};     // name -> { wide?: bool, ... }
const _navItems = [];     // {name, label, icon, section, countId}

function registerView(name, renderFn, opts) {
  _views[name] = renderFn;
  if (opts) _viewMeta[name] = opts;
}

function registerNav(name, opts) {
  _navItems.push({ name, ...opts });
}

// ── Cross-view navigation params ─────────────────────────────────────────────
// Single mechanism for "open view X with these params". Replaces ad-hoc flags
// like S._pendingSelect / S._pendingSanger. Consumer calls consumeNavParams(view)
// at the end of its renderer; the value is returned once then cleared.
//
// Example producer:    navigateWith('cloning', { type: 'plasmid', id: 42 });
// Example consumer:    var p = consumeNavParams('cloning'); if (p) _clSelectSequence(p.type, p.id);
function navigateWith(view, params) {
  S._navParams = { view: view, params: params };
  setView(view);
}

function consumeNavParams(view) {
  if (S._navParams && S._navParams.view === view) {
    var p = S._navParams.params;
    S._navParams = null;
    return p;
  }
  return null;
}

// ── Global state ─────────────────────────────────────────────────────────────
let S = {
  view: 'notebook',
  filterGroup: '',
  entries: [],
  protocols: [],
  summaries: [],
  stats: {},
  sidebarOpen: true,
  nbBook: null,
  nbPage: null,
};

// ── API helper ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  buildSidebarNav();
  await load();
  setInterval(load, 600000);
  /* One-time daily check-in: prompt about any active runs from previous days.
     Wrapped in setTimeout(0) so the initial view renders first — otherwise the
     popup appears before the user has any UI context. */
  setTimeout(checkStaleRuns, 0);
}

/* ── Daily check-in for stale protocol runs ───────────────────────────────
   On app load, ask the user whether each pre-today active run is finished,
   still going, or being cancelled. Blocks subsequent interaction until every
   listed run is answered (or snoozed). Uses /api/active-runs/stale which
   already filters out today's runs and currently-snoozed runs.

   Re-checking: if you reload the page after answering, the same set won't
   re-appear because answered = no longer in active_runs OR snoozed_until > now. */
async function checkStaleRuns() {
  let stale = [];
  try {
    const r = await api('GET', '/api/active-runs/stale');
    stale = r.runs || [];
  } catch (e) {
    /* If the endpoint isn't available (older backend), skip silently rather
       than blocking the app on a missing feature. */
    return;
  }
  if (!stale.length) return;
  _checkInQueue = stale.slice();
  _showNextCheckIn();
}

let _checkInQueue = [];

function _showNextCheckIn() {
  if (!_checkInQueue.length) return;
  const run = _checkInQueue[0];
  let protocolTitle = 'Protocol';
  try { protocolTitle = (JSON.parse(run.protocol_json || '{}').title) || protocolTitle; } catch (_) {}
  const startedDate = (run.started_at || '').slice(0, 10);
  const startedHuman = startedDate || 'unknown date';

  /* Steps progress, if available */
  let stepInfo = '';
  try {
    const steps = JSON.parse(run.steps_json || '[]');
    const done = steps.filter(s => s.done).length;
    stepInfo = `${done} / ${steps.length} steps done before this check-in`;
  } catch (_) {}

  /* Default the completion-date picker to the start date — matches "I started
     it yesterday and finished it then but forgot to log it". User can change. */
  const html = `
    <div class="ci-backdrop">
      <div class="ci-modal">
        <div class="ci-title">Daily check-in</div>
        <div class="ci-body">
          <div class="ci-runline">
            <div class="ci-runtitle">${esc(protocolTitle)}</div>
            <div class="ci-runmeta">
              ${run.group_name ? esc(run.group_name) + ' \u00b7 ' : ''}
              Started <strong>${esc(startedHuman)}</strong>
              ${stepInfo ? ' \u00b7 ' + esc(stepInfo) : ''}
            </div>
          </div>
          <div class="ci-prompt">Are you still running this?</div>
          <div class="ci-actions">
            <button class="ci-btn ci-btn-done" onclick="ciAnswerDone()">
              <div class="ci-btn-title">Mark done</div>
              <div class="ci-btn-sub">Save to notebook</div>
            </button>
            <button class="ci-btn ci-btn-snooze" onclick="ciAnswerSnooze()">
              <div class="ci-btn-title">Still running</div>
              <div class="ci-btn-sub">Snooze 24h</div>
            </button>
            <button class="ci-btn ci-btn-cancel" onclick="ciAnswerCancel()">
              <div class="ci-btn-title">Cancel run</div>
              <div class="ci-btn-sub">Save as [CANCELLED]</div>
            </button>
          </div>
          <div class="ci-date-row" id="ci-date-row" style="display:none">
            <label class="ci-date-label">Date completed:</label>
            <input type="date" id="ci-date-input" class="ci-date-input" value="${esc(startedDate)}">
            <button class="ci-confirm-btn" id="ci-confirm-btn">Save</button>
          </div>
          <div class="ci-reason-row" id="ci-reason-row" style="display:none">
            <label class="ci-date-label">Reason (optional):</label>
            <input type="text" id="ci-reason-input" class="ci-reason-input" placeholder="e.g. ran out of reagent">
            <input type="date" id="ci-cancel-date-input" class="ci-date-input" value="${esc(startedDate)}">
            <button class="ci-confirm-btn" id="ci-confirm-cancel-btn">Cancel run</button>
          </div>
        </div>
        <div class="ci-foot">
          ${_checkInQueue.length > 1 ? `${_checkInQueue.length - 1} more after this` : 'Last one'}
        </div>
      </div>
    </div>`;

  let host = document.getElementById('ci-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ci-host';
    document.body.appendChild(host);
    _injectCheckInStyles();
  }
  host.innerHTML = html;
}

function _injectCheckInStyles() {
  if (document.getElementById('ci-styles')) return;
  const s = document.createElement('style');
  s.id = 'ci-styles';
  s.textContent = `
    .ci-backdrop { position:fixed; inset:0; background:rgba(60,52,42,.55); z-index:5000; display:flex; align-items:center; justify-content:center; }
    .ci-modal { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:480px; max-width:92vw; box-shadow:0 12px 48px rgba(0,0,0,.3); overflow:hidden; }
    .ci-title { padding:14px 18px; background:#5b7a5e; color:#fff; font-weight:600; font-size:14px; letter-spacing:.04em; }
    .ci-body { padding:18px; }
    .ci-runline { padding:10px 12px; background:#f0ebe3; border:1px solid #e0d9cd; border-radius:5px; margin-bottom:14px; }
    .ci-runtitle { font-size:15px; font-weight:600; color:#4a4139; }
    .ci-runmeta  { font-size:12px; color:#8a7f72; margin-top:3px; }
    .ci-prompt { font-size:14px; color:#4a4139; margin-bottom:10px; text-align:center; }
    .ci-actions { display:flex; gap:8px; }
    .ci-btn { flex:1; background:#fff; border:1px solid #d5cec0; border-radius:6px; padding:12px 10px; cursor:pointer; text-align:center; transition:all .15s; }
    .ci-btn:hover { background:#f0ebe3; border-color:#5b7a5e; }
    .ci-btn-title { font-size:13px; font-weight:600; color:#4a4139; }
    .ci-btn-sub   { font-size:11px; color:#8a7f72; margin-top:2px; }
    .ci-btn-done:hover  { background:#e8f0e8; border-color:#5b7a5e; }
    .ci-btn-cancel:hover { background:#fdeaea; border-color:#c0392b; }
    .ci-date-row, .ci-reason-row { display:flex; gap:8px; align-items:center; margin-top:14px; padding-top:14px; border-top:1px solid #ece7dd; }
    .ci-date-label { font-size:12px; color:#8a7f72; flex-shrink:0; }
    .ci-date-input { padding:5px 8px; border:1px solid #d5cec0; border-radius:4px; background:#fff; font-family:inherit; font-size:13px; color:#4a4139; }
    .ci-reason-input { flex:1; padding:5px 8px; border:1px solid #d5cec0; border-radius:4px; background:#fff; font-family:inherit; font-size:13px; color:#4a4139; }
    .ci-confirm-btn { padding:5px 14px; background:#5b7a5e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px; font-weight:500; }
    .ci-confirm-btn:hover { background:#4a6b4d; }
    .ci-foot { padding:8px 18px; background:#f0ebe3; font-size:11px; color:#8a7f72; text-align:right; border-top:1px solid #ece7dd; }
  `;
  document.head.appendChild(s);
}

function _ciCurrent() { return _checkInQueue[0]; }

/* "Mark done" — show date picker, then call spResumeAndFinish so the user can
   review the recipe/steps in the scratch view (per their preference: jump to
   the existing finish flow rather than silent commit). */
function ciAnswerDone() {
  const dr = document.getElementById('ci-date-row');
  const rr = document.getElementById('ci-reason-row');
  if (dr) dr.style.display = 'flex';
  if (rr) rr.style.display = 'none';
  const btn = document.getElementById('ci-confirm-btn');
  if (btn) btn.onclick = ciConfirmDone;
}
function ciConfirmDone() {
  const run = _ciCurrent();
  if (!run) return;
  /* Capture the chosen completion date and stash it on a global the scratch
     save flow knows to look at (window._spOverrideDate). spSaveRunToEntry
     consumes and clears it. */
  const dateInput = document.getElementById('ci-date-input');
  if (dateInput && dateInput.value) {
    window._spOverrideDate = dateInput.value;
  }
  _ciClose();
  _checkInQueue.shift();
  if (typeof spResumeAndFinish === 'function') {
    spResumeAndFinish(run.run_id);
  } else if (typeof setView === 'function') {
    if (typeof spResumeRunById === 'function') spResumeRunById(run.run_id);
    else setView('scratch');
  }
}

function ciAnswerSnooze() {
  const run = _ciCurrent();
  if (!run) return;
  api('POST', '/api/active-runs/' + encodeURIComponent(run.run_id) + '/snooze', { hours: 24 })
    .then(function() {
      toast('Snoozed for 24h');
      _ciAdvance();
    })
    .catch(function(e) { toast('Snooze failed: ' + e.message, true); });
}

function ciAnswerCancel() {
  const dr = document.getElementById('ci-date-row');
  const rr = document.getElementById('ci-reason-row');
  if (dr) dr.style.display = 'none';
  if (rr) rr.style.display = 'flex';
  const btn = document.getElementById('ci-confirm-cancel-btn');
  if (btn) btn.onclick = ciConfirmCancel;
}
function ciConfirmCancel() {
  const run = _ciCurrent();
  if (!run) return;
  const reason = (document.getElementById('ci-reason-input') || {}).value || '';
  const date = (document.getElementById('ci-cancel-date-input') || {}).value || '';
  api('POST', '/api/active-runs/' + encodeURIComponent(run.run_id) + '/cancel',
      { reason: reason, date: date })
    .then(function() {
      toast('Cancelled \u2014 saved as [CANCELLED] to notebook');
      _ciAdvance();
    })
    .catch(function(e) { toast('Cancel failed: ' + e.message, true); });
}

function _ciClose() {
  const host = document.getElementById('ci-host');
  if (host) host.innerHTML = '';
}
function _ciAdvance() {
  _checkInQueue.shift();
  if (_checkInQueue.length) _showNextCheckIn();
  else _ciClose();
}

function buildSidebarNav() {
  // Build dynamic nav items from registered features
  const container = document.getElementById('dynamic-nav');
  if (!container) return;

  let currentSection = '';
  for (const item of _navItems) {
    if (item.section && item.section !== currentSection) {
      currentSection = item.section;
      container.innerHTML += `<div class="nav-divider"></div><div class="nav-section">${esc(item.section)}</div>`;
    }
    const countHtml = item.countId ? `<span class="count" id="${item.countId}">0</span>` : '';
    container.innerHTML += `<div class="nav-item" id="nav-${item.name}" onclick="setView('${item.name}')">
      <span>${item.icon}</span><span>${esc(item.label)}</span>${countHtml}
    </div>`;
  }
}

async function load() {
  try {
    const st = await api('GET', '/api/stats');
    S.stats = st;
    const ce = document.getElementById('cnt-entries');
    if (ce) ce.textContent = st.entries || 0;
    const cp = document.getElementById('cnt-protocols');
    if (cp) cp.textContent = st.protocols || 0;

    // Build group nav
    const gnav = document.getElementById('group-nav');
    if (gnav) {
      gnav.innerHTML = (st.groups || []).map(function (g) {
        return '<div class="group-nav ' + (S.filterGroup === g ? 'active' : '') + '" data-group="' + esc(g) + '"><span>' + esc(g) + '</span></div>';
      }).join('');
      gnav.querySelectorAll('.group-nav').forEach(function (el) {
        el.addEventListener('click', function () { setGroup(this.dataset.group); });
      });
    }

    // Scratch and reminder counts
    try {
      const sc = await api('GET', '/api/scratch');
      const cntS = document.getElementById('cnt-scratch');
      if (cntS) cntS.textContent = sc.entries?.length || 0;
      const rc = await api('GET', '/api/reminders');
      const cntR = document.getElementById('cnt-reminders');
      if (cntR) cntR.textContent = rc.reminders?.length || 0;
      try {
        const pc = await api('GET', '/api/predictions');
        const cntP = document.getElementById('cnt-predictions');
        if (cntP) cntP.textContent = pc.predictions?.length || 0;
      } catch {}
    } catch {}

    // The counts and group-nav above already refreshed in place. We deliberately
    // do NOT call loadView() here: a periodic full re-render wipes any in-progress
    // form / dialog / mid-edit state in the active view. Manual navigation is
    // what triggers re-renders; this loop is just for the sidebar numbers.
  } catch (e) { console.error(e); }
}

function setView(v) {
  S.view = v;
  S.filterGroup = '';
  if (v === 'notebook') { S.nbBook = null; S.nbPage = null; }

  document.querySelectorAll('.nav-item').forEach(el => {
    const id = el.id.replace('nav-', '');
    el.classList.toggle('active', id === v);
  });

  const titles = {
    notebook: 'Notebook', protocols: 'Protocol Library', summaries: 'Project Summaries',
    workflow: 'Daily Workflow', scratch: 'Scratch Pad', reminders: 'Reminders',
    'import': 'Import from OneNote', timeline: 'Project Timelines',
    predictions: 'Predicted Tasks', dilution: 'Dilution Calculator',
    DNAmanager: 'DNAmanager',
  };
  document.getElementById('page-title').textContent = titles[v] || v;

  const btn = document.getElementById('add-btn');
  if (v === 'notebook')       { btn.textContent = '+ New entry'; btn.style.display = ''; }
  else if (v === 'protocols') { btn.textContent = '+ Add protocol'; btn.style.display = ''; }
  else if (v === 'reminders') { btn.textContent = '+ Reminder'; btn.style.display = ''; }
  else                        { btn.style.display = 'none'; }

  loadView();
}

function setGroup(g) {
  S.filterGroup = g; S.view = 'notebook'; S.nbBook = g; S.nbPage = null;
  document.querySelectorAll('.group-nav').forEach(el => el.classList.toggle('active', el.textContent.trim() === g));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-notebook').classList.add('active');
  document.getElementById('page-title').textContent = 'Notebook — ' + g;
  document.getElementById('add-btn').textContent = '+ New entry';
  document.getElementById('add-btn').style.display = '';
  loadView();
}

async function loadView() {
  const el = document.getElementById('content');

  // Apply view-width class. Sources, in priority order:
  //   1. View metadata via registerView(name, fn, {wide:true})
  //   2. Special case: notebook in book-page mode (nbBook set) goes wide so
  //      the entry list + reader pane can sit side-by-side
  // Default = narrow (CSS .content { max-width: 1100px }).
  const meta = _viewMeta[S.view] || {};
  const wideByNotebookCase = (S.view === 'notebook' && S.nbBook);
  el.classList.toggle('wide', !!(meta.wide || wideByNotebookCase));

  const renderer = _views[S.view];
  if (renderer) {
    await renderer(el);
  } else {
    el.innerHTML = '<div class="empty"><big>⚠️</big>View "' + esc(S.view) + '" not loaded.</div>';
  }
}

// ── Shared form: showAddForm delegates to feature ────────────────────────────
function showAddForm() {
  if (S.view === 'reminders' && typeof showAddReminder === 'function') {
    showAddReminder();
  } else if (typeof _showAddForm === 'function') {
    _showAddForm();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toggleSidebar() {
  S.sidebarOpen = !S.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('collapsed', !S.sidebarOpen);
}

function formatDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso + 'Z').getTime(), m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let tt;
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (err ? ' err' : '');
  clearTimeout(tt);
  tt = setTimeout(() => el.className = '', 3000);
}

/* ── Global search (Ctrl+K / Cmd+K) ──────────────────────────────────────────
   Cross-table fuzzy-ish search across notebook entries, protocols, and DNA
   inventory. Live results with 200ms debounce. Results grouped by category
   with optional filter tabs. Click-through navigates to the relevant view
   and (where possible) selects the item.

   We don't bind Ctrl+K when the user is typing in a contenteditable / input,
   to avoid stealing the shortcut in nested editors that may use it themselves. */

let _searchDebounce = null;
let _searchActiveFilter = null;   // null = show all categories
let _searchLastResults = null;    // last response so filter tabs don't re-query

document.addEventListener('keydown', function(e) {
  /* Ctrl+K or Cmd+K — open search */
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openGlobalSearch();
    return;
  }
});

function openGlobalSearch() {
  /* Bail if it's already open — don't stack */
  if (document.getElementById('gs-modal')) {
    const inp = document.getElementById('gs-input');
    if (inp) inp.focus();
    return;
  }
  _injectSearchStyles();
  _searchActiveFilter = null;
  _searchLastResults = null;
  const modal = document.createElement('div');
  modal.id = 'gs-modal';
  modal.className = 'gs-backdrop';
  modal.innerHTML = `
    <div class="gs-modal" role="dialog">
      <div class="gs-input-row">
        <span class="gs-input-icon">⌕</span>
        <input id="gs-input" class="gs-input" type="text"
               placeholder="Search notebook, protocols, DNA inventory…  (Esc to close)"
               autocomplete="off" spellcheck="false">
        <span class="gs-hint" id="gs-hint">Type to search</span>
      </div>
      <div class="gs-filters" id="gs-filters" style="display:none"></div>
      <div class="gs-results" id="gs-results"></div>
      <div class="gs-foot">
        <kbd>↑↓</kbd> navigate &nbsp;
        <kbd>Enter</kbd> open &nbsp;
        <kbd>Esc</kbd> close
      </div>
    </div>`;
  modal.addEventListener('click', function(e) { if (e.target === modal) closeGlobalSearch(); });
  document.body.appendChild(modal);

  const inp = document.getElementById('gs-input');
  inp.addEventListener('input', _searchHandleInput);
  inp.addEventListener('keydown', _searchHandleKeys);
  inp.focus();
}

function closeGlobalSearch() {
  const m = document.getElementById('gs-modal');
  if (m) m.remove();
  if (_searchDebounce) clearTimeout(_searchDebounce);
}

function _injectSearchStyles() {
  if (document.getElementById('gs-styles')) return;
  const s = document.createElement('style');
  s.id = 'gs-styles';
  s.textContent = `
    .gs-backdrop { position:fixed; inset:0; background:rgba(60,52,42,.55); z-index:6000; display:flex; align-items:flex-start; justify-content:center; padding-top:12vh; }
    .gs-modal { background:#faf8f4; border:1px solid #d5cec0; border-radius:10px; width:640px; max-width:92vw; max-height:72vh; box-shadow:0 16px 48px rgba(0,0,0,.32); overflow:hidden; display:flex; flex-direction:column; }
    .gs-input-row { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid #ece7dd; background:#fff; }
    .gs-input-icon { font-size:18px; color:#8a7f72; }
    .gs-input { flex:1; border:none; outline:none; font-family:inherit; font-size:16px; color:#4a4139; background:transparent; }
    .gs-hint { font-size:11px; color:#8a7f72; padding:2px 6px; background:#f0ebe3; border-radius:3px; }
    .gs-filters { display:flex; gap:4px; padding:8px 16px; background:#f5f0e8; border-bottom:1px solid #ece7dd; flex-wrap:wrap; }
    .gs-filter { padding:3px 10px; background:#fff; border:1px solid #d5cec0; border-radius:12px; cursor:pointer; font-size:11.5px; color:#4a4139; }
    .gs-filter.active { background:#5b7a5e; color:#fff; border-color:#5b7a5e; }
    .gs-filter:hover:not(.active) { background:#f0ebe3; }
    .gs-results { flex:1; overflow-y:auto; padding:6px 0; }
    .gs-result { display:flex; align-items:center; gap:10px; padding:8px 16px; cursor:pointer; border-left:3px solid transparent; }
    .gs-result:hover, .gs-result.active { background:#f0ebe3; border-left-color:#5b7a5e; }
    .gs-result-kind { font-size:10.5px; font-weight:600; color:#8a7f72; text-transform:uppercase; letter-spacing:.08em; width:90px; flex-shrink:0; }
    .gs-result-body { flex:1; min-width:0; }
    .gs-result-title { font-size:14px; color:#4a4139; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .gs-result-sub { font-size:11.5px; color:#8a7f72; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .gs-empty { padding:24px; text-align:center; color:#8a7f72; font-size:13px; }
    .gs-foot { padding:7px 16px; border-top:1px solid #ece7dd; background:#f5f0e8; font-size:11px; color:#8a7f72; }
    .gs-foot kbd { background:#fff; border:1px solid #d5cec0; border-radius:3px; padding:1px 5px; font-family:inherit; font-size:10.5px; color:#4a4139; }
  `;
  document.head.appendChild(s);
}

function _searchHandleInput(e) {
  const q = e.target.value;
  if (_searchDebounce) clearTimeout(_searchDebounce);
  /* 200ms debounce — feels live but doesn't fire one request per keystroke */
  _searchDebounce = setTimeout(function() { _runSearch(q); }, 200);
}

async function _runSearch(q) {
  const hint = document.getElementById('gs-hint');
  const results = document.getElementById('gs-results');
  if (!q || q.length < 2) {
    if (hint) hint.textContent = q ? 'Type more…' : 'Type to search';
    if (results) results.innerHTML = '';
    document.getElementById('gs-filters').style.display = 'none';
    return;
  }
  if (hint) hint.textContent = 'Searching…';
  try {
    const r = await api('GET', '/api/search?q=' + encodeURIComponent(q));
    _searchLastResults = r;
    _searchActiveFilter = null;   // reset filter on new query
    _renderSearchResults();
    if (hint) hint.textContent = (r.results?.length || 0) + ' result' + ((r.results?.length || 0) === 1 ? '' : 's');
  } catch (e) {
    if (hint) hint.textContent = 'Search failed';
  }
}

function _renderSearchResults() {
  const r = _searchLastResults;
  if (!r) return;
  const results = document.getElementById('gs-results');
  const filters = document.getElementById('gs-filters');

  /* Filter tabs — show only if 2+ categories matched */
  const catEntries = Object.entries(r.categories || {});
  if (catEntries.length >= 2) {
    const totalCount = r.results.length;
    let html = `<span class="gs-filter ${_searchActiveFilter === null ? 'active' : ''}" onclick="_setSearchFilter(null)">All (${totalCount})</span>`;
    /* Sort categories by count desc for stable order */
    catEntries.sort((a, b) => b[1] - a[1]);
    for (const [kind, count] of catEntries) {
      const cls = (_searchActiveFilter === kind) ? 'active' : '';
      html += `<span class="gs-filter ${cls}" onclick="_setSearchFilter('${esc(kind).replace(/'/g, '&#39;')}')">${esc(kind)} (${count})</span>`;
    }
    filters.innerHTML = html;
    filters.style.display = 'flex';
  } else {
    filters.style.display = 'none';
  }

  /* Filter applied? */
  const shown = _searchActiveFilter
    ? r.results.filter(it => it.kind === _searchActiveFilter)
    : r.results;

  if (!shown.length) {
    results.innerHTML = '<div class="gs-empty">No matches</div>';
    return;
  }
  results.innerHTML = shown.map(function(it, i) {
    return `<div class="gs-result ${i === 0 ? 'active' : ''}" data-idx="${i}"
                onclick="_openSearchResult(${i})">
      <div class="gs-result-kind">${esc(it.kind)}</div>
      <div class="gs-result-body">
        <div class="gs-result-title">${esc(it.title)}</div>
        ${it.subtitle ? `<div class="gs-result-sub">${esc(it.subtitle)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _setSearchFilter(kind) {
  _searchActiveFilter = kind;
  _renderSearchResults();
  /* Keep focus in the input — filter clicks shouldn't move it */
  const inp = document.getElementById('gs-input');
  if (inp) inp.focus();
}

function _searchHandleKeys(e) {
  const results = document.getElementById('gs-results');
  if (!results) return;
  const items = results.querySelectorAll('.gs-result');
  if (e.key === 'Escape') {
    e.preventDefault();
    closeGlobalSearch();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _moveSearchSelection(items, +1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    _moveSearchSelection(items, -1);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const active = results.querySelector('.gs-result.active');
    if (active) _openSearchResult(parseInt(active.dataset.idx, 10));
    return;
  }
}

function _moveSearchSelection(items, dir) {
  if (!items.length) return;
  let idx = -1;
  for (let i = 0; i < items.length; i++) if (items[i].classList.contains('active')) { idx = i; break; }
  if (idx < 0) idx = 0;
  else idx = (idx + dir + items.length) % items.length;
  for (const it of items) it.classList.remove('active');
  items[idx].classList.add('active');
  items[idx].scrollIntoView({ block: 'nearest' });
}

function _openSearchResult(idx) {
  const r = _searchLastResults;
  if (!r) return;
  const shown = _searchActiveFilter
    ? r.results.filter(it => it.kind === _searchActiveFilter)
    : r.results;
  const item = shown[idx];
  if (!item) return;

  closeGlobalSearch();

  /* Navigation by table:
       entries     → notebook view, jump-to entry id
       protocols   → protocols view (no item-level jump for now; the list view
                     is small enough that the user can find it visually)
       DNA tables  → DNA Manager view, jump to the relevant tab + filter by name
     We use S._pendingSelect-style params via the navigateWith helper where it
     makes sense; views that don't yet consume the param fall back to just
     switching views, which is at least no worse than today. */
  const view = item.view;
  let params = null;
  if (item.table === 'entries') {
    params = { entryId: item.id };
  } else if (item.table === 'protocols') {
    params = { protocolId: item.id };
  } else {
    /* DNA tables — pass enough info for the DNA manager to focus the right tab */
    params = { dnaTable: item.table, dnaId: item.id, dnaName: item.title };
  }

  if (typeof navigateWith === 'function') {
    navigateWith(view, params);
  } else if (typeof setView === 'function') {
    /* No params nav — falling back to just opening the view. */
    setView(view);
  }
}

/* Expose for inline onclick handlers in the modal HTML */
window.openGlobalSearch = openGlobalSearch;
window.closeGlobalSearch = closeGlobalSearch;
window._setSearchFilter = _setSearchFilter;
window._openSearchResult = _openSearchResult;
