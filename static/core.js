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
  /* We don't pass the date forward right now — the existing scratch save flow
     uses "today" for the notebook entry's date. Document the limitation:
     to honour the chosen completion date you'd need to extend spSaveRunToEntry
     to accept a date override. For now this is a TODO; the user still gets to
     review the run before saving. */
  _ciClose();
  _checkInQueue.shift();
  if (typeof spResumeAndFinish === 'function') {
    spResumeAndFinish(run.run_id);
  } else if (typeof setView === 'function') {
    if (typeof spResumeRunById === 'function') spResumeRunById(run.run_id);
    else setView('scratch');
  }
  /* Don't auto-advance to the next check-in here — the user is now navigating
     to scratch to finish this one. They'll see remaining check-ins next time
     they reload (or you could re-fire here after the save completes, but that
     gets complicated). For now, one-at-a-time per page load. */
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
