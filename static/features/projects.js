/* Projects management view — the single point-of-contact for editing the
   colours, descriptions, and lifecycle of every project name known to the
   app. Reads/writes through /api/projects. Colours edited here propagate
   to Workflow (block borders + pill), Notebook, Read mode, and PDFs. */

var _projMgr = {
  projects: [],
  filter: '',
  editing: null,   // project name currently being edited (inline)
};


async function renderProjects(el) {
  await _projMgrLoad();
  _projMgrInjectStyles();

  var projs = _projMgr.projects;
  if (_projMgr.filter) {
    var q = _projMgr.filter.toLowerCase();
    projs = projs.filter(function(p) { return p.name.toLowerCase().indexOf(q) !== -1; });
  }

  var html = '<div class="pm-container">';

  /* ── Header ────────────────────────────────────────────────────── */
  html += '<div class="pm-head">' +
    '<div>' +
      '<div class="pm-title">Projects</div>' +
      '<div class="pm-sub">Manage colours and descriptions for every project tag across the app. Colours here drive the block borders, pills, notebook, and printed PDFs.</div>' +
    '</div>' +
    '<div class="pm-head-actions">' +
      '<input id="pm-filter" placeholder="Filter\u2026" value="' + esc(_projMgr.filter) + '" class="pm-filter">' +
      '<button class="pm-btn pm-btn-primary" onclick="_projMgrShowNew()">+ New project</button>' +
    '</div>' +
  '</div>';

  /* ── New-project inline form (hidden by default) ─────────────────── */
  html += '<div id="pm-new-form" class="pm-new-form" style="display:none">' +
    '<input id="pm-new-name" placeholder="Project name" class="pm-inp">' +
    '<input id="pm-new-desc" placeholder="Description (optional)" class="pm-inp">' +
    '<input id="pm-new-color" type="color" value="#7a9e7e" class="pm-color-inp" title="Colour (leave default to use hash-based colour)">' +
    '<label class="pm-check"><input id="pm-new-usecolor" type="checkbox"> Use this colour</label>' +
    '<button class="pm-btn pm-btn-primary" onclick="_projMgrCreate()">Create</button>' +
    '<button class="pm-btn" onclick="_projMgrHideNew()">Cancel</button>' +
  '</div>';

  /* ── Project list ────────────────────────────────────────────────── */
  if (!projs.length) {
    html += '<div class="pm-empty">' +
      (_projMgr.filter
        ? 'No projects match "' + esc(_projMgr.filter) + '".'
        : 'No projects yet. They\'ll appear here as soon as any block, entry, or DNA item references one.') +
      '</div>';
  } else {
    html += '<div class="pm-list">';
    projs.forEach(function(p) {
      html += _projMgrRowHtml(p);
    });
    html += '</div>';
  }

  html += '</div>';
  el.innerHTML = html;

  /* ── Wiring ──────────────────────────────────────────────────────── */
  var fi = document.getElementById('pm-filter');
  if (fi) {
    fi.addEventListener('input', function() {
      _projMgr.filter = this.value;
      /* Re-render just the list, keep focus/cursor on the filter box */
      var caret = this.selectionStart;
      renderProjects(el).then(function() {
        var f = document.getElementById('pm-filter');
        if (f) { f.focus(); f.setSelectionRange(caret, caret); }
      });
    });
  }
}


function _projMgrRowHtml(p) {
  var isEditing = _projMgr.editing === p.name;
  var effectiveColor = p.color_override || _projMgrHueToRgb(p.hue, 42, 45);
  var swatch = '<span class="pm-swatch" style="background:' + effectiveColor + '" ' +
    'onclick="_projMgrToggleEdit(\'' + esc(p.name).replace(/'/g, "\\'") + '\')"></span>';
  var counts =
    p.day_count   + ' day'   + (p.day_count === 1 ? '' : 's')   + ' \u00b7 ' +
    p.entry_count + ' entr'  + (p.entry_count === 1 ? 'y' : 'ies') + ' \u00b7 ' +
    p.dna_count   + ' DNA';

  if (!isEditing) {
    return '<div class="pm-row" data-name="' + esc(p.name) + '">' +
      swatch +
      '<div class="pm-info">' +
        '<div class="pm-name">' + esc(p.name) + '</div>' +
        '<div class="pm-desc">' + (p.description ? esc(p.description) : '<span class="pm-noneset">no description</span>') + '</div>' +
      '</div>' +
      '<div class="pm-counts">' + counts + '</div>' +
      '<div class="pm-actions">' +
        '<button class="pm-btn pm-btn-mini" onclick="_projMgrToggleEdit(\'' + esc(p.name).replace(/'/g, "\\'") + '\')">edit</button>' +
        '<button class="pm-btn pm-btn-mini pm-btn-del" onclick="_projMgrDelete(\'' + esc(p.name).replace(/'/g, "\\'") + '\')">\u00d7</button>' +
      '</div>' +
    '</div>';
  }

  /* Editing row */
  var overrideColor = p.color_override || _projMgrHueToRgbHex(p.hue, 42, 45);
  var hasOverride = !!p.color_override;
  return '<div class="pm-row pm-row-edit" data-name="' + esc(p.name) + '">' +
    swatch +
    '<div class="pm-edit-form">' +
      '<div class="pm-edit-name">' + esc(p.name) + '</div>' +
      '<div class="pm-edit-row">' +
        '<label class="pm-check"><input type="checkbox" id="pm-e-usecolor" ' + (hasOverride ? 'checked' : '') + ' onchange="_projMgrToggleColorFieldEnabled(this)"> Colour override</label>' +
        '<input type="color" id="pm-e-color" value="' + esc(overrideColor) + '" class="pm-color-inp" ' + (hasOverride ? '' : 'disabled') + '>' +
        '<span class="pm-hint">' + (hasOverride ? '' : '(hash-based auto-colour: hue ' + p.hue + ')') + '</span>' +
      '</div>' +
      '<textarea id="pm-e-desc" placeholder="Description" class="pm-desc-inp">' + esc(p.description || '') + '</textarea>' +
      '<div class="pm-edit-actions">' +
        '<button class="pm-btn pm-btn-primary" onclick="_projMgrSave(\'' + esc(p.name).replace(/'/g, "\\'") + '\')">Save</button>' +
        '<button class="pm-btn" onclick="_projMgrToggleEdit(null)">Cancel</button>' +
      '</div>' +
    '</div>' +
    '<div class="pm-counts">' + counts + '</div>' +
  '</div>';
}


/* ── Data operations ─────────────────────────────────────────────── */

async function _projMgrLoad() {
  try {
    var d = await api('GET', '/api/projects');
    _projMgr.projects = d.projects || [];
  } catch (e) {
    _projMgr.projects = [];
    toast('Failed to load projects: ' + (e.message || String(e)), true);
  }
}

function _projMgrToggleEdit(name) {
  _projMgr.editing = name;
  var el = document.getElementById('content');
  if (el) renderProjects(el);
}

function _projMgrToggleColorFieldEnabled(cb) {
  var color = document.getElementById('pm-e-color');
  if (color) color.disabled = !cb.checked;
}

async function _projMgrSave(name) {
  var useColor = document.getElementById('pm-e-usecolor').checked;
  var color    = document.getElementById('pm-e-color').value;
  var desc     = document.getElementById('pm-e-desc').value;
  var body = {
    description: desc,
    color_override: useColor ? color : '',
  };
  try {
    await api('PUT', '/api/projects/' + encodeURIComponent(name), body);
    _projMgr.editing = null;
    /* Bump the global datalist / refresh caches so other views see any
       colour change immediately without a browser reload. */
    if (typeof _refreshGlobalProjects === 'function') await _refreshGlobalProjects();
    if (typeof _wfLoadKnownProjects === 'function') await _wfLoadKnownProjects();
    var el = document.getElementById('content');
    if (el) renderProjects(el);
    toast('Saved "' + name + '"');
  } catch (e) {
    toast('Save failed: ' + (e.message || String(e)), true);
  }
}

async function _projMgrDelete(name) {
  if (!confirm('Remove metadata for "' + name + '"?\n\nThis clears the colour override and description, but does NOT touch any block, entry, DNA item, or other reference to this project name. The name reverts to hash-based colouring.')) return;
  try {
    await api('DELETE', '/api/projects/' + encodeURIComponent(name));
    if (typeof _refreshGlobalProjects === 'function') await _refreshGlobalProjects();
    if (typeof _wfLoadKnownProjects === 'function') await _wfLoadKnownProjects();
    var el = document.getElementById('content');
    if (el) renderProjects(el);
    toast('Removed metadata for "' + name + '"');
  } catch (e) {
    toast('Delete failed: ' + (e.message || String(e)), true);
  }
}

function _projMgrShowNew() {
  var form = document.getElementById('pm-new-form');
  if (form) { form.style.display = 'flex'; setTimeout(function() { document.getElementById('pm-new-name').focus(); }, 0); }
}
function _projMgrHideNew() {
  var form = document.getElementById('pm-new-form');
  if (form) form.style.display = 'none';
}

async function _projMgrCreate() {
  var name  = document.getElementById('pm-new-name').value.trim();
  var desc  = document.getElementById('pm-new-desc').value.trim();
  var use   = document.getElementById('pm-new-usecolor').checked;
  var color = document.getElementById('pm-new-color').value;
  if (!name) { toast('Name required', true); return; }
  var body = { name: name, description: desc };
  if (use) body.color_override = color;
  try {
    await api('POST', '/api/projects', body);
    _projMgrHideNew();
    if (typeof _refreshGlobalProjects === 'function') await _refreshGlobalProjects();
    if (typeof _wfLoadKnownProjects === 'function') await _wfLoadKnownProjects();
    var el = document.getElementById('content');
    if (el) renderProjects(el);
    toast('Created "' + name + '"');
  } catch (e) {
    toast('Create failed: ' + (e.message || String(e)), true);
  }
}


/* ── Hue → hex helpers (client-only, for swatch display) ─────────── */

function _projMgrHueToRgb(h, s, l) {
  return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
}

function _projMgrHueToRgbHex(h, s, l) {
  /* Convert HSL to hex so <input type="color"> can be pre-filled correctly
     when the user opens the edit form on an auto-coloured project. HSL→RGB
     algorithm from wikipedia; s/l as percentages, h in degrees. */
  s = s / 100;
  l = l / 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2;
  var r, g, b;
  if (h < 60)      { r = c; g = x; b = 0; }
  else if (h < 120){ r = x; g = c; b = 0; }
  else if (h < 180){ r = 0; g = c; b = x; }
  else if (h < 240){ r = 0; g = x; b = c; }
  else if (h < 300){ r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  function hh(v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); }
  return '#' + hh(r) + hh(g) + hh(b);
}


/* ── Styles ──────────────────────────────────────────────────────── */

function _projMgrInjectStyles() {
  if (document.getElementById('pm-styles')) return;
  var s = document.createElement('style');
  s.id = 'pm-styles';
  s.textContent = [
    '.pm-container { max-width: 900px; margin: 0 auto; padding: 20px 4px; }',
    '.pm-head { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; margin-bottom:18px; }',
    '.pm-title { font-size:22px; font-weight:600; color:#4a4139; }',
    '.pm-sub { font-size:12.5px; color:#8a7f72; margin-top:4px; max-width:520px; line-height:1.45; }',
    '.pm-head-actions { display:flex; gap:8px; align-items:center; }',
    '.pm-filter { padding:6px 10px; border:1px solid #d5cec0; border-radius:4px; font-size:13px; background:#faf8f4; min-width:180px; }',
    '.pm-btn { background:#f0ebe3; border:1px solid #d5cec0; color:#4a4139; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:13px; font-family:inherit; }',
    '.pm-btn:hover { background:#e5dfd4; }',
    '.pm-btn-primary { background:#5b7a5e; color:#fff; border-color:#4a6b4d; }',
    '.pm-btn-primary:hover { background:#4a6b4d; }',
    '.pm-btn-mini { padding:3px 8px; font-size:11.5px; }',
    '.pm-btn-del { color:#c0392b; padding:2px 8px; font-size:14px; }',
    '.pm-btn-del:hover { background:#f5d5cf; }',
    '.pm-new-form { display:flex; gap:8px; align-items:center; padding:12px; background:#faf8f4; border:1px solid #d5cec0; border-radius:6px; margin-bottom:14px; flex-wrap:wrap; }',
    '.pm-inp { padding:5px 8px; border:1px solid #d5cec0; border-radius:3px; font-size:13px; }',
    '.pm-color-inp { width:36px; height:28px; padding:0; border:1px solid #d5cec0; border-radius:3px; cursor:pointer; }',
    '.pm-color-inp:disabled { opacity:.4; cursor:not-allowed; }',
    '.pm-check { display:flex; align-items:center; gap:5px; font-size:12px; color:#4a4139; }',
    '.pm-list { display:flex; flex-direction:column; gap:2px; }',
    '.pm-row { display:grid; grid-template-columns:22px 1fr auto auto; gap:12px; align-items:center; padding:10px 12px; background:#faf8f4; border:1px solid transparent; border-radius:4px; transition:background .1s; }',
    '.pm-row:hover { background:#f5f0e8; border-color:#e5dfd4; }',
    '.pm-row-edit { grid-template-columns:22px 1fr auto; align-items:flex-start; background:#f0ebe3; border-color:#c8bfae; padding:14px; }',
    '.pm-swatch { display:inline-block; width:16px; height:16px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px #d5cec0; cursor:pointer; margin-top:2px; }',
    '.pm-info { min-width:0; }',
    '.pm-name { font-weight:600; font-size:14px; color:#4a4139; font-family:"SF Mono",Monaco,Consolas,monospace; }',
    '.pm-desc { font-size:12px; color:#8a7f72; margin-top:2px; line-height:1.4; }',
    '.pm-noneset { font-style:italic; color:#b8ac9c; }',
    '.pm-counts { font-size:11px; color:#8a7f72; font-family:"SF Mono",Monaco,Consolas,monospace; white-space:nowrap; }',
    '.pm-actions { display:flex; gap:4px; }',
    '.pm-edit-form { flex:1; display:flex; flex-direction:column; gap:8px; }',
    '.pm-edit-name { font-weight:600; font-size:15px; color:#4a4139; font-family:"SF Mono",Monaco,Consolas,monospace; }',
    '.pm-edit-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }',
    '.pm-desc-inp { padding:6px 8px; border:1px solid #d5cec0; border-radius:3px; font-size:13px; min-height:50px; font-family:inherit; resize:vertical; }',
    '.pm-edit-actions { display:flex; gap:6px; }',
    '.pm-hint { font-size:11px; color:#8a7f72; font-style:italic; }',
    '.pm-empty { text-align:center; padding:36px 20px; color:#8a7f72; font-style:italic; }',
  ].join('\n');
  document.head.appendChild(s);
}


registerView('projects', renderProjects);
/* Label deliberately NOT "Projects" — index.html has a hard-coded
   <div class="nav-section">Projects</div> further down the sidebar for the
   group filter shortcuts. Using "Project settings" here keeps the two
   distinct so users don't see "Projects" twice in the sidebar. */
registerNav('projects', { name: 'projects', label: 'Project settings', icon: '\ud83c\udfa8', section: '' });

window._projMgrToggleEdit = _projMgrToggleEdit;
window._projMgrSave       = _projMgrSave;
window._projMgrDelete     = _projMgrDelete;
window._projMgrShowNew    = _projMgrShowNew;
window._projMgrHideNew    = _projMgrHideNew;
window._projMgrCreate     = _projMgrCreate;
window._projMgrToggleColorFieldEnabled = _projMgrToggleColorFieldEnabled;
