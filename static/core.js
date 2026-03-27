/*
 * core.js — App shell, API helper, view registry, shared helpers.
 *
 * Feature JS files call registerView('name', renderFn) to plug in.
 * registerNav('name', {label, icon, section, countId}) to add sidebar items.
 */

// ── View registry ────────────────────────────────────────────────────────────
const _views = {};        // name -> async function(el)
const _navItems = [];     // {name, label, icon, section, countId}

function registerView(name, renderFn) {
  _views[name] = renderFn;
}

function registerNav(name, opts) {
  _navItems.push({ name, ...opts });
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

    // Don't re-render if user is typing
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (!typing) await loadView();
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
  if ((S.view === 'notebook' && S.nbBook) || S.view === 'cloning' || S.view === 'pipeline' || S.view === 'sanger' || S.view === 'gel_annotation') {
    el.style.maxWidth = 'none'; el.style.padding = '0 12px';
  } else {
    el.style.maxWidth = ''; el.style.padding = '';
  }

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
