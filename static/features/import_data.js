// DNA Manager feature — primers, plasmids, gBlocks, kit parts, storage boxes, .gb files, auto-linking

var _dna = {
  tab: 'primers',
  primers: [], plasmids: [], gblocks: [], kitParts: [], parts: [], boxes: [],
  projects: [],
  subcategories: {},  // project -> [subcategories]
  groupByProject: false,
  importState: {},
  settings: { primer_prefix: '', plasmid_prefix: '' },
  linkRegex: null,
  showSettings: false,
  search: { primers: '', plasmids: '', gblocks: '', kitParts: '', parts: '', boxes: '' },
  sort: {
    primers: { col: 'name', dir: 'asc' },
    plasmids: { col: 'name', dir: 'asc' },
    gblocks: { col: 'name', dir: 'asc' },
    kitParts: { col: 'name', dir: 'asc' },
    parts: { col: 'name', dir: 'asc' },
    boxes: { col: 'name', dir: 'asc' }
  },
  filter: { project: '', kit_name: '', part_type: '' },
  selected: { primers: {}, plasmids: {}, gblocks: {}, kitParts: {}, parts: {} },
  boxView: null,        // currently viewed box id
  boxAssignCell: null   // cell being assigned {row, col}
};

// ══════════════════════════════════════════════════════════════════════════════
//  SORTING & FILTERING HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _dnaFilterItems(items, query, fields) {
  if (!query) return items;
  var lc = query.toLowerCase();
  return items.filter(function(item) {
    for (var i = 0; i < fields.length; i++) {
      var val = (item[fields[i]] || '').toString().toLowerCase();
      if (val.indexOf(lc) !== -1) return true;
    }
    return false;
  });
}

function _dnaFilterByProject(items) {
  var proj = _dna.filter.project;
  if (!proj) return items;
  return items.filter(function(item) { return (item.project || '') === proj; });
}

function _dnaSortItems(items, col, dir) {
  var sorted = items.slice();
  sorted.sort(function(a, b) {
    var va = (a[col] || '').toString();
    var vb = (b[col] || '').toString();
    var cmp = _dnaNaturalCmp(va, vb);
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

function _dnaNaturalCmp(a, b) {
  // Split strings into runs of non-digits and digits
  var ra = a.match(/(\d+|\D+)/g) || [];
  var rb = b.match(/(\d+|\D+)/g) || [];
  var len = Math.min(ra.length, rb.length);
  for (var i = 0; i < len; i++) {
    var pa = ra[i], pb = rb[i];
    var na = parseInt(pa, 10), nb = parseInt(pb, 10);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      var la = pa.toLowerCase(), lb = pb.toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
    }
  }
  return ra.length - rb.length;
}

function _dnaSortBy(tab, col) {
  var s = _dna.sort[tab];
  if (s.col === col) {
    s.dir = (s.dir === 'asc') ? 'desc' : 'asc';
  } else {
    s.col = col;
    s.dir = 'asc';
  }
  _dnaRenderTable();
}

function _dnaSortIndicator(tab, col) {
  var s = _dna.sort[tab];
  if (s.col !== col) return ' <span class="dna-sort-arrow dna-sort-neutral">\u2195</span>';
  if (s.dir === 'asc') return ' <span class="dna-sort-arrow">\u25B2</span>';
  return ' <span class="dna-sort-arrow">\u25BC</span>';
}

function _dnaOnSearch(tab) {
  var input = document.getElementById('dna-search-' + tab);
  _dna.search[tab] = input ? input.value : '';
  _dnaRenderTable();
}

function _dnaClearSearch(tab) {
  _dna.search[tab] = '';
  var input = document.getElementById('dna-search-' + tab);
  if (input) input.value = '';
  _dnaRenderTable();
}

function _dnaRenderTable() {
  var wrap = document.getElementById('dna-table-area');
  if (!wrap) return;
  var t = _dna.tab;
  if (t === 'primers') wrap.innerHTML = _dnaPrimerTable();
  else if (t === 'plasmids') wrap.innerHTML = _dnaPlasmidTable();
  else if (t === 'gblocks') wrap.innerHTML = _dnaGblockTable();
  else if (t === 'kitParts') wrap.innerHTML = _dnaKitPartTable();
  else if (t === 'parts') wrap.innerHTML = _dnaPartsTable();
  else if (t === 'boxes') wrap.innerHTML = _dnaBoxViewContent();
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════════════════════════════

async function renderDnaManager(el) {
  await _dnaLoadAll();

  var html = '<div class="dna-manager">';

  // header
  html += '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.2rem">';
  html += '<h2 style="margin:0;font-weight:600">DNA Manager</h2>';
  html += '<div style="display:flex;gap:.4rem">';
  html += '<button class="btn' + (_dna.groupByProject ? ' dna-btn-active' : '') + '" onclick="_dnaToggleGroup()" style="font-size:.85rem">\uD83D\uDCC1 Group by Project</button>';
  html += '<button class="btn" onclick="_dnaToggleSettings()" style="font-size:.85rem">\u2699 Settings</button>';
  html += '<button class="btn" onclick="_dnaShowImport()" style="font-size:.85rem">Import CSV / Excel</button>';
  html += '</div></div>';

  // settings panel
  html += '<div id="dna-settings-panel" style="display:' + (_dna.showSettings ? '' : 'none') + '">';
  html += _dnaSettingsPanel();
  html += '</div>';

  // tabs
  html += '<div class="dna-tabs">';
  var tabs = [
    { key: 'primers', label: 'Primers', count: _dna.primers.length },
    { key: 'plasmids', label: 'Plasmids', count: _dna.plasmids.length },
    { key: 'gblocks', label: 'gBlocks', count: _dna.gblocks.length },
    { key: 'kitParts', label: 'Kit Parts', count: _dna.kitParts.length },
    { key: 'parts', label: 'Parts', count: _dna.parts.length },
    { key: 'boxes', label: 'Box View', count: _dna.boxes.length }
  ];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    html += '<span class="dna-tab' + (_dna.tab === t.key ? ' active' : '') + '" onclick="_dnaSetTab(\x27' + t.key + '\x27)">' + t.label + ' <small class="muted">(' + t.count + ')</small></span>';
  }
  html += '</div>';

  html += '<div id="dna-table-area">';
  if (_dna.tab === 'primers') html += _dnaPrimerTable();
  else if (_dna.tab === 'plasmids') html += _dnaPlasmidTable();
  else if (_dna.tab === 'gblocks') html += _dnaGblockTable();
  else if (_dna.tab === 'kitParts') html += _dnaKitPartTable();
  else if (_dna.tab === 'parts') html += _dnaPartsTable();
  else if (_dna.tab === 'boxes') html += _dnaBoxViewContent();
  html += '</div>';

  html += '</div>';

  // overlay (for modals)
  html += '<div id="dna-import-overlay" style="display:none"></div>';

  // popover container
  if (!document.getElementById('dna-popover')) {
    var pop = document.createElement('div');
    pop.id = 'dna-popover';
    pop.className = 'dna-popover';
    pop.style.display = 'none';
    document.body.appendChild(pop);
  }

  html += _dnaStyles();
  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════════════════════════════════════════

async function _dnaLoadAll() {
  try { _dna.primers = (await api('GET', '/api/primers')).items || []; } catch(e) { _dna.primers = []; }
  try { _dna.plasmids = (await api('GET', '/api/plasmids')).items || []; } catch(e) { _dna.plasmids = []; }
  try { _dna.gblocks = (await api('GET', '/api/gblocks')).items || []; } catch(e) { _dna.gblocks = []; }
  try { _dna.kitParts = (await api('GET', '/api/kit-parts')).items || []; } catch(e) { _dna.kitParts = []; }
  try { _dna.parts = (await api('GET', '/api/parts')).items || []; } catch(e) { _dna.parts = []; }
  try { _dna.boxes = (await api('GET', '/api/boxes')).items || []; } catch(e) { _dna.boxes = []; }
  try { _dna.settings = await api('GET', '/api/dna/settings'); } catch(e) {}
  try {
    var projData = await api('GET', '/api/dna/projects');
    _dna.projects = projData.projects || [];
    _dna.subcategories = projData.subcategories || {};
  } catch(e) { _dna.projects = []; _dna.subcategories = {}; }
  _dnaBuildRegex();
}

function _dnaSetTab(t) {
  _dna.selected = { primers: {}, plasmids: {}, gblocks: {}, kitParts: {}, parts: {} };
  _dna.tab = t;
  _dnaRefresh();
}

async function _dnaRefresh() {
  await _dnaLoadAll();
  var el = document.querySelector('.dna-manager');
  if (el) renderDnaManager(el.parentElement || el);
}

// ══════════════════════════════════════════════════════════════════════════════
//  SETTINGS PANEL
// ══════════════════════════════════════════════════════════════════════════════

function _dnaToggleSettings() {
  _dna.showSettings = !_dna.showSettings;
  var p = document.getElementById('dna-settings-panel');
  if (p) p.style.display = _dna.showSettings ? '' : 'none';
}

function _dnaSettingsPanel() {
  var s = _dna.settings;
  return (
    '<div class="card" style="margin-bottom:1rem;padding:1rem">' +
      '<div class="dna-section-hdr" style="margin-top:0">AUTO-LINK SETTINGS</div>' +
      '<p class="muted" style="font-size:.82rem;margin:.3rem 0 .8rem">Set prefixes so names like <code>pMR1</code> or <code>MR5</code> auto-link in notebook entries.</p>' +
      '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:end">' +
        '<label class="dna-setting-label">Primer prefix<input id="dna-set-primer" class="dna-input" value="' + esc(s.primer_prefix || '') + '" placeholder="e.g. MR" style="width:8rem"></label>' +
        '<label class="dna-setting-label">Plasmid prefix<input id="dna-set-plasmid" class="dna-input" value="' + esc(s.plasmid_prefix || '') + '" placeholder="e.g. pMR" style="width:8rem"></label>' +
        '<button class="btn btn-sm" onclick="_dnaSaveSettings()">Save</button>' +
      '</div>' +
      '<p class="muted" style="font-size:.78rem;margin-top:.5rem">Primer prefix + number (e.g. MR5) links to primers. Plasmid prefix + number (e.g. pMR1) links to plasmids.</p>' +
    '</div>'
  );
}

async function _dnaSaveSettings() {
  var pp = (document.getElementById('dna-set-primer') || {}).value || '';
  var pl = (document.getElementById('dna-set-plasmid') || {}).value || '';
  try {
    _dna.settings = await api('POST', '/api/dna/settings', { primer_prefix: pp.trim(), plasmid_prefix: pl.trim() });
    _dnaBuildRegex();
    toast('Settings saved.');
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SEARCH BAR + PROJECT FILTER
// ══════════════════════════════════════════════════════════════════════════════

function _dnaSearchBar(tab, totalCount, filteredCount) {
  var query = _dna.search[tab] || '';
  var countLabel = '';
  if (filteredCount !== totalCount) {
    countLabel = filteredCount + ' of ' + totalCount + ' items';
  } else {
    countLabel = totalCount + ' items';
  }
  var html = '<div class="dna-search-bar">';
  html += '<span class="dna-search-count">' + esc(countLabel) + '</span>';
  html += '<div style="display:flex;gap:.5rem;align-items:center">';

  // project filter
  if (_dna.projects.length > 0) {
    html += '<select class="dna-input" style="font-size:.82rem;padding:.25rem .4rem" onchange="_dnaFilterProject(this.value)">';
    html += '<option value="">All projects</option>';
    for (var i = 0; i < _dna.projects.length; i++) {
      var sel = _dna.filter.project === _dna.projects[i] ? ' selected' : '';
      html += '<option value="' + esc(_dna.projects[i]) + '"' + sel + '>' + esc(_dna.projects[i]) + '</option>';
    }
    html += '</select>';
  }

  html += '<div class="dna-search-input-wrap">';
  html += '<input id="dna-search-' + tab + '" class="dna-input dna-search-input" type="text" placeholder="Search\u2026" value="' + esc(query) + '" oninput="_dnaOnSearch(\x27' + tab + '\x27)">';
  if (query) {
    html += '<span class="dna-search-clear" onclick="_dnaClearSearch(\x27' + tab + '\x27)">\u00d7</span>';
  }
  html += '</div></div></div>';
  return html;
}

function _dnaFilterProject(val) {
  _dna.filter.project = val;
  _dnaRenderTable();
}

// ══════════════════════════════════════════════════════════════════════════════
//  MULTI-SELECT & BULK DELETE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaToggleSel(tab, id) {
  var sel = _dna.selected[tab];
  if (sel[id]) delete sel[id];
  else sel[id] = true;
  _dnaRenderTable();
}

function _dnaToggleAll(tab, ids) {
  var sel = _dna.selected[tab];
  var allChecked = ids.length > 0 && ids.every(function(id) { return sel[id]; });
  if (allChecked) {
    ids.forEach(function(id) { delete sel[id]; });
  } else {
    ids.forEach(function(id) { sel[id] = true; });
  }
  _dnaRenderTable();
}

function _dnaSelCount(tab) {
  return Object.keys(_dna.selected[tab]).length;
}

function _dnaClearSel(tab) {
  _dna.selected[tab] = {};
}

var _dnaBulkTypeMap = {
  primers: 'primer', plasmids: 'plasmid', gblocks: 'gblock', kitParts: 'kit_part', parts: 'part'
};
var _dnaBulkTypeLabels = [
  { key: 'primer', label: 'Primers' },
  { key: 'plasmid', label: 'Plasmids' },
  { key: 'gblock', label: 'gBlocks' },
  { key: 'kit_part', label: 'Kit Parts' },
  { key: 'part', label: 'Parts' }
];

function _dnaBulkBar(tab, endpoint) {
  var count = _dnaSelCount(tab);
  if (count === 0) return '';
  var fromType = _dnaBulkTypeMap[tab] || tab;

  var html = '<div class="dna-bulk-bar">';
  html += '<span class="dna-bulk-count">' + count + ' selected</span>';

  // Set Project dropdown
  html += '<div class="dna-bulk-group">';
  html += '<select id="dna-bulk-proj-' + tab + '" class="dna-input dna-bulk-select"><option value="">Set project\u2026</option>';
  for (var i = 0; i < _dna.projects.length; i++) {
    html += '<option value="' + esc(_dna.projects[i]) + '">' + esc(_dna.projects[i]) + '</option>';
  }
  html += '<option value="__clear__">\u2014 Clear project \u2014</option>';
  html += '</select>';
  html += '<button class="btn btn-sm dna-bulk-apply" onclick="_dnaBulkSetField(\x27' + tab + '\x27,\x27' + endpoint + '\x27,\x27project\x27,\x27dna-bulk-proj-' + tab + '\x27)">Apply</button>';
  html += '</div>';

  // Set Subcategory dropdown
  var allSubs = {};
  Object.keys(_dna.subcategories).forEach(function(p) {
    (_dna.subcategories[p] || []).forEach(function(s) { allSubs[s] = 1; });
  });
  var subList = Object.keys(allSubs).sort();
  if (subList.length > 0) {
    html += '<div class="dna-bulk-group">';
    html += '<select id="dna-bulk-sub-' + tab + '" class="dna-input dna-bulk-select"><option value="">Set subcategory\u2026</option>';
    for (var j = 0; j < subList.length; j++) {
      html += '<option value="' + esc(subList[j]) + '">' + esc(subList[j]) + '</option>';
    }
    html += '<option value="__clear__">\u2014 Clear \u2014</option>';
    html += '</select>';
    html += '<button class="btn btn-sm dna-bulk-apply" onclick="_dnaBulkSetField(\x27' + tab + '\x27,\x27' + endpoint + '\x27,\x27subcategory\x27,\x27dna-bulk-sub-' + tab + '\x27)">Apply</button>';
    html += '</div>';
  }

  // Move to type dropdown
  html += '<div class="dna-bulk-group">';
  html += '<select id="dna-bulk-move-' + tab + '" class="dna-input dna-bulk-select"><option value="">Move to\u2026</option>';
  _dnaBulkTypeLabels.forEach(function(t) {
    if (t.key !== fromType) {
      html += '<option value="' + t.key + '">' + esc(t.label) + '</option>';
    }
  });
  html += '</select>';
  html += '<button class="btn btn-sm dna-bulk-apply" onclick="_dnaBulkMove(\x27' + tab + '\x27,\x27dna-bulk-move-' + tab + '\x27)">Move</button>';
  html += '</div>';

  html += '<div style="flex:1"></div>';
  html += '<button class="btn btn-sm" style="background:#c0392b;color:#fff;font-size:.76rem" onclick="_dnaBulkDelete(\x27' + tab + '\x27,\x27' + endpoint + '\x27)">Delete</button>';
  html += '<button class="btn btn-sm" style="font-size:.76rem" onclick="_dnaClearSel(\x27' + tab + '\x27);_dnaRenderTable()">\u00d7 Clear</button>';
  html += '</div>';
  return html;
}

async function _dnaBulkSetField(tab, endpoint, field, selectId) {
  var sel = _dna.selected[tab];
  var ids = Object.keys(sel).map(Number);
  if (!ids.length) return;
  var dropdown = document.getElementById(selectId);
  if (!dropdown || !dropdown.value) { toast('Select a value first.'); return; }
  var value = dropdown.value === '__clear__' ? '' : dropdown.value;
  var errors = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      var body = {};
      body[field] = value;
      await api('PUT', '/api/' + endpoint + '/' + ids[i], body);
    } catch(e) { errors++; }
  }
  _dna.selected[tab] = {};
  if (errors) toast(errors + ' item(s) failed to update.', true);
  else toast(ids.length + ' item(s) updated.');
  _dnaRefresh();
}

async function _dnaBulkMove(tab, selectId) {
  var sel = _dna.selected[tab];
  var ids = Object.keys(sel).map(Number);
  if (!ids.length) return;
  var dropdown = document.getElementById(selectId);
  if (!dropdown || !dropdown.value) { toast('Select a destination type.'); return; }
  var toType = dropdown.value;
  var fromType = _dnaBulkTypeMap[tab];
  if (!confirm('Move ' + ids.length + ' item(s) to ' + toType + '?')) return;
  var errors = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      await api('POST', '/api/dna/move', { from_type: fromType, from_id: ids[i], to_type: toType });
    } catch(e) { errors++; }
  }
  _dna.selected[tab] = {};
  if (errors) toast(errors + ' item(s) failed to move.', true);
  else toast(ids.length + ' item(s) moved.');
  var tabMap = { primer: 'primers', plasmid: 'plasmids', gblock: 'gblocks', kit_part: 'kitParts', part: 'parts' };
  _dna.tab = tabMap[toType] || _dna.tab;
  _dnaRefresh();
}

async function _dnaBulkDelete(tab, endpoint) {
  var sel = _dna.selected[tab];
  var ids = Object.keys(sel).map(Number);
  if (!ids.length) return;
  if (!confirm('Delete ' + ids.length + ' item(s)? This cannot be undone.')) return;
  var errors = 0;
  for (var i = 0; i < ids.length; i++) {
    try {
      await api('DELETE', '/api/' + endpoint + '/' + ids[i]);
    } catch(e) { errors++; }
  }
  _dna.selected[tab] = {};
  if (errors) toast(errors + ' item(s) failed to delete.', true);
  else toast(ids.length + ' item(s) deleted.');
  _dnaRefresh();
}

function _dnaCheckboxTh(tab, visibleIds) {
  var sel = _dna.selected[tab];
  var allChecked = visibleIds.length > 0 && visibleIds.every(function(id) { return sel[id]; });
  return '<th style="width:2rem;text-align:center"><input type="checkbox" ' + (allChecked ? 'checked' : '') + ' onchange="_dnaToggleAll(\x27' + tab + '\x27,' + JSON.stringify(visibleIds) + ')"></th>';
}

function _dnaCheckboxTd(tab, id) {
  var checked = _dna.selected[tab][id] ? ' checked' : '';
  return '<td style="text-align:center"><input type="checkbox"' + checked + ' onchange="_dnaToggleSel(\x27' + tab + '\x27,' + id + ')"></td>';
}

// ══════════════════════════════════════════════════════════════════════════════
//  STOCK STATUS (traffic lights)
// ══════════════════════════════════════════════════════════════════════════════

var _dnaStockColors = { green: '#5b7a5e', amber: '#d4a017', red: '#c0392b', blue: '#4682B4' };
var _dnaStockLabels = { stock_dna: 'DNA', stock_glycerol: 'Glycerol', stock_verified: 'Verified' };
var _dnaStockTitles = { blue: 'Not made / On order', green: 'Have / Arrived', amber: 'Low / Running out', red: 'Out / Failed' };
var _dnaStockStates = ['', 'blue', 'green', 'amber', 'red'];

function _dnaStockDot(endpoint, id, field, value) {
  var color = _dnaStockColors[value] || '#d5cec0';
  var label = _dnaStockLabels[field] || field;
  var title = label + ': ' + (_dnaStockTitles[value] || 'Not set');
  return '<span class="dna-stock-dot" style="color:' + color + '" title="' + esc(title) + '" ' +
    'onclick="event.stopPropagation();_dnaStockCycle(\x27' + endpoint + '\x27,' + id + ',\x27' + field + '\x27,\x27' + (value || '') + '\x27)">\u25CF</span>';
}

function _dnaStockCell(endpoint, item, fields) {
  return fields.map(function(f) {
    return _dnaStockDot(endpoint, item.id, f, item[f] || '');
  }).join('');
}

function _dnaStockHeader(fields) {
  var tips = fields.map(function(f) { return _dnaStockLabels[f] || f; });
  return '<th title="' + esc(tips.join(' / ')) + '" style="white-space:nowrap">Stock <span class="muted" style="font-size:.68rem">(' + tips.join('/') + ')</span></th>';
}

async function _dnaStockCycle(endpoint, id, field, current) {
  var idx = _dnaStockStates.indexOf(current || '');
  var next = _dnaStockStates[(idx + 1) % _dnaStockStates.length];
  var body = {};
  body[field] = next;
  try {
    await api('PUT', '/api/' + endpoint + '/' + id, body);
    // Update local data without full refresh for snappy feel
    var lists = { primers: _dna.primers, plasmids: _dna.plasmids, gblocks: _dna.gblocks, 'kit-parts': _dna.kitParts, parts: _dna.parts };
    var list = lists[endpoint];
    if (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list[i][field] = next; break; }
      }
    }
    _dnaRenderTable();
  } catch(e) { toast('Error updating stock status', true); }
}

// Stock status for edit modals
function _dnaStockEditRow(item, fields) {
  var html = '<div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap">';
  html += '<span class="muted" style="font-size:.82rem">Stock:</span>';
  fields.forEach(function(f) {
    var val = item[f] || '';
    var label = _dnaStockLabels[f] || f;
    html += '<label class="dna-stock-edit-label">' + label;
    html += '<select id="dna-ed-' + f + '" class="dna-input" style="font-size:.82rem;padding:.2rem .3rem">';
    html += '<option value=""' + (!val ? ' selected' : '') + '>\u2014</option>';
    html += '<option value="blue"' + (val === 'blue' ? ' selected' : '') + '>\uD83D\uDD35 Not made</option>';
    html += '<option value="green"' + (val === 'green' ? ' selected' : '') + '>\uD83D\uDFE2 Have</option>';
    html += '<option value="amber"' + (val === 'amber' ? ' selected' : '') + '>\uD83D\uDFE1 Low</option>';
    html += '<option value="red"' + (val === 'red' ? ' selected' : '') + '>\uD534 Out</option>';
    html += '</select></label>';
  });
  html += '</div>';
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CROSS-LINK BUTTONS
// ══════════════════════════════════════════════════════════════════════════════

function _dnaCrossLinks(type, item) {
  var html = '';
  if (item.gb_file || item.sequence) {
    var cloningType = type === 'kit_part' ? 'kitpart' : type;
    html += '<span class="dna-xlink" onclick="_dnaGoCloning(\x27' + cloningType + '\x27,' + item.id + ')" title="View in Cloning">\uD83E\uDDEC</span>';
    html += '<span class="dna-xlink" onclick="_dnaGoSanger(\x27' + cloningType + '\x27,' + item.id + ')" title="Align (Sanger)">\uD83D\uDCCA</span>';
  }
  return html;
}

function _dnaGoCloning(type, id) {
  if (typeof S !== 'undefined') S._pendingSelect = { type: type, id: id };
  if (typeof setView === 'function') setView('cloning');
}

function _dnaGoSanger(type, id) {
  if (typeof S !== 'undefined') S._pendingSanger = { type: type, id: id };
  if (typeof setView === 'function') setView('sanger');
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRIMER TABLE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaPrimerTable() {
  var allItems = _dna.primers;
  var projFiltered = _dnaFilterByProject(allItems);
  var searchFields = ['name', 'sequence', 'use', 'box_number', 'project'];
  var filtered = _dnaFilterItems(projFiltered, _dna.search.primers, searchFields);
  var s = _dna.sort.primers;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">PRIMERS</div>';
  html += _dnaSearchBar('primers', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No primers yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No primers match your search.</div>';
  } else {
    var visibleIds = items.map(function(p) { return p.id; });
    html += _dnaBulkBar('primers', 'primers');
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += _dnaCheckboxTh('primers', visibleIds);
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27name\x27)">Name' + _dnaSortIndicator('primers', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27sequence\x27)">Sequence' + _dnaSortIndicator('primers', 'sequence') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27use\x27)">Use' + _dnaSortIndicator('primers', 'use') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27project\x27)">Project' + _dnaSortIndicator('primers', 'project') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27box_number\x27)">Box #' + _dnaSortIndicator('primers', 'box_number') + '</th>';
    html += '<th>Tm</th>';
    html += _dnaStockHeader(['stock_dna']);
    html += '<th>.gb</th><th>Links</th><th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    html += _dnaRenderRows(items, function(p) {
      var row = '<tr>';
      row += _dnaCheckboxTd('primers', p.id);
      row += '<td class="dna-cell-name dna-editable" onclick="_dnaEditPrimer(' + p.id + ')">' + esc(p.name) + '</td>';
      row += '<td class="dna-cell-seq" title="Click to edit" onclick="_dnaEditSeq(' + p.id + ')" style="cursor:pointer"><code>' + _dnaStyledSeqShort(p.sequence || '') + '</code></td>';
      row += '<td>' + esc(p.use || '') + '</td>';
      row += '<td>' + _dnaProjBadge(p) + '</td>';
      row += '<td>' + esc(p.box_number || '') + ' ' + _dnaBoxPositionBadges('primer', p.id) + '</td>';
      row += '<td>' + (p.tm ? '<span title="' + esc(p.tm_polymerase || '') + '">' + Number(p.tm).toFixed(1) + '\u00b0</span>' : '<span class="muted">\u2014</span>') + '</td>';
      row += '<td>' + _dnaStockCell('primers', p, ['stock_dna']) + '</td>';
      row += '<td>' + _dnaGbCell('primer', p) + '</td>';
      row += '<td>' + _dnaCrossLinks('primer', p) + '</td>';
      row += '<td><span class="dna-del" onclick="_dnaDeleteItem(\x27primers\x27,' + p.id + ')" title="Delete">\u00d7</span></td>';
      row += '</tr>';
      return row;
    });
    html += '</tbody></table></div>';
  }

  html += _dnaAddPrimerRow();
  html += '<div style="margin-top:.3rem;text-align:right">' + _dnaReindexButton('primers') + '</div>';
  return html;
}

function _dnaAddPrimerRow() {
  var html = '<div class="dna-add-row">';
  html += '<input id="dna-p-name" placeholder="Primer name" class="dna-input" style="flex:2">';
  html += '<input id="dna-p-seq" placeholder="Sequence" class="dna-input" style="flex:3">';
  html += '<input id="dna-p-use" placeholder="Use" class="dna-input" style="flex:2">';
  html += '<input id="dna-p-project" placeholder="Project" class="dna-input" style="flex:1" list="dna-proj-list">';
  html += '<input id="dna-p-box" placeholder="Box #" class="dna-input" style="flex:1">';
  html += '<button class="btn btn-sm" onclick="_dnaAddPrimer()">Add</button>';
  html += '</div>';
  html += _dnaProjectDatalist();
  return html;
}

function _dnaProjectDatalist() {
  var html = '<datalist id="dna-proj-list">';
  for (var i = 0; i < _dna.projects.length; i++) {
    html += '<option value="' + esc(_dna.projects[i]) + '">';
  }
  html += '</datalist>';
  // subcategory datalist — all known subcategories across all projects
  html += '<datalist id="dna-sub-list">';
  var allSubs = {};
  Object.keys(_dna.subcategories).forEach(function(proj) {
    (_dna.subcategories[proj] || []).forEach(function(s) { allSubs[s] = 1; });
  });
  Object.keys(allSubs).sort().forEach(function(s) {
    html += '<option value="' + esc(s) + '">';
  });
  html += '</datalist>';
  return html;
}

function _dnaToggleGroup() {
  _dna.groupByProject = !_dna.groupByProject;
  _dnaRefresh();
}

// Group items by project > subcategory, returns [{project, subcategory, items}]
function _dnaGroupItems(items) {
  var groups = {};
  items.forEach(function(item) {
    var proj = item.project || '';
    var sub = item.subcategory || '';
    var key = proj + '|||' + sub;
    if (!groups[key]) groups[key] = { project: proj, subcategory: sub, items: [] };
    groups[key].items.push(item);
  });
  // Sort: items with project first, then by project name, then subcategory
  var result = Object.values(groups);
  result.sort(function(a, b) {
    if (a.project && !b.project) return -1;
    if (!a.project && b.project) return 1;
    var cp = _dnaNaturalCmp(a.project, b.project);
    if (cp !== 0) return cp;
    return _dnaNaturalCmp(a.subcategory, b.subcategory);
  });
  return result;
}

function _dnaGroupHeader(project, subcategory, count) {
  var label = project || 'Ungrouped';
  if (subcategory) label += ' \u203A ' + subcategory;
  return '<tr class="dna-group-row"><td colspan="99"><span class="dna-group-label">' +
    esc(label) + '</span> <span class="muted" style="font-size:.76rem">(' + count + ')</span></td></tr>';
}

function _dnaRenderRows(items, rowFn) {
  var html = '';
  if (!_dna.groupByProject) {
    items.forEach(function(item) { html += rowFn(item); });
  } else {
    var groups = _dnaGroupItems(items);
    groups.forEach(function(g) {
      html += _dnaGroupHeader(g.project, g.subcategory, g.items.length);
      g.items.forEach(function(item) { html += rowFn(item); });
    });
  }
  return html;
}

function _dnaProjBadge(item) {
  if (!item.project) return '<span class="muted">\u2014</span>';
  var label = esc(item.project);
  if (item.subcategory) label += ' <span class="dna-sub-sep">\u203A</span> ' + esc(item.subcategory);
  return '<span class="dna-project-badge">' + label + '</span>';
}

function _dnaStyledSeqShort(seq) {
  var out = '';
  var count = 0;
  for (var i = 0; i < seq.length; i++) {
    var c = seq[i];
    if (!'ACGTacgt'.includes(c)) continue;
    if (count >= 40) { out += '...'; break; }
    if (c === c.toLowerCase() && c !== c.toUpperCase()) {
      out += '<span style="color:#c0a88a">' + esc(c) + '</span>';
    } else {
      out += esc(c);
    }
    count++;
  }
  return out;
}

async function _dnaAddPrimer() {
  var name = (document.getElementById('dna-p-name') || {}).value || '';
  if (!name.trim()) { toast('Primer name is required.'); return; }
  try {
    await api('POST', '/api/primers', {
      name: name.trim(),
      sequence: (document.getElementById('dna-p-seq') || {}).value || '',
      use: (document.getElementById('dna-p-use') || {}).value || '',
      box_number: (document.getElementById('dna-p-box') || {}).value || '',
      project: (document.getElementById('dna-p-project') || {}).value || ''
    });
    toast('Primer added.'); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PLASMID TABLE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaPlasmidTable() {
  var allItems = _dna.plasmids;
  var projFiltered = _dnaFilterByProject(allItems);
  var searchFields = ['name', 'use', 'box_location', 'glycerol_location', 'project', 'antibiotic_resistance'];
  var filtered = _dnaFilterItems(projFiltered, _dna.search.plasmids, searchFields);
  var s = _dna.sort.plasmids;
  var items = _dnaSortItems(filtered, s.col, s.dir);
  var anyGb = allItems.some(function(p) { return p.gb_file; });

  var html = '<div class="dna-section-hdr">PLASMIDS</div>';
  html += _dnaSearchBar('plasmids', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No plasmids yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No plasmids match your search.</div>';
  } else {
    var visibleIds = items.map(function(p) { return p.id; });
    html += _dnaBulkBar('plasmids', 'plasmids');
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += _dnaCheckboxTh('plasmids', visibleIds);
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27name\x27)">Name' + _dnaSortIndicator('plasmids', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27use\x27)">Use' + _dnaSortIndicator('plasmids', 'use') + '</th>';
    html += '<th>Resistance</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27project\x27)">Project' + _dnaSortIndicator('plasmids', 'project') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27box_location\x27)">Box' + _dnaSortIndicator('plasmids', 'box_location') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27glycerol_location\x27)">Glycerol' + _dnaSortIndicator('plasmids', 'glycerol_location') + '</th>';
    html += _dnaStockHeader(['stock_dna', 'stock_glycerol', 'stock_verified']);
    html += '<th>.gb</th><th>Links</th><th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    html += _dnaRenderRows(items, function(p) {
      var row = '<tr>';
      row += _dnaCheckboxTd('plasmids', p.id);
      row += '<td class="dna-cell-name dna-editable" onclick="_dnaEditPlasmid(' + p.id + ')">' + esc(p.name) + '</td>';
      row += '<td>' + esc(p.use || '') + '</td>';
      row += '<td>' + _dnaResistanceCell(p) + '</td>';
      row += '<td>' + _dnaProjBadge(p) + '</td>';
      row += '<td>' + esc(p.box_location || '') + ' ' + _dnaBoxPositionBadges('plasmid', p.id) + '</td>';
      row += '<td>' + esc(p.glycerol_location || '') + '</td>';
      row += '<td>' + _dnaStockCell('plasmids', p, ['stock_dna', 'stock_glycerol', 'stock_verified']) + '</td>';
      row += '<td>' + _dnaGbCell('plasmid', p) + '</td>';
      row += '<td>' + _dnaCrossLinks('plasmid', p) + '</td>';
      row += '<td><span class="dna-del" onclick="_dnaDeleteItem(\x27plasmids\x27,' + p.id + ')" title="Delete">\u00d7</span></td>';
      row += '</tr>';
      return row;
    });
    html += '</tbody></table></div>';

    if (anyGb) {
      html += '<div style="margin-top:.3rem;text-align:right">';
      html += '<button class="btn btn-sm" onclick="_dnaRescanResistance()" title="Re-parse all .gb files" style="font-size:.78rem;color:#8a7f72">\uD83D\uDD0D Rescan .gb files for resistance</button>';
      html += '</div>';
    }
  }

  html += '<div class="dna-add-row">';
  html += '<input id="dna-pl-name" placeholder="Plasmid name" class="dna-input" style="flex:2">';
  html += '<input id="dna-pl-use" placeholder="Use" class="dna-input" style="flex:2">';
  html += '<input id="dna-pl-project" placeholder="Project" class="dna-input" style="flex:1" list="dna-proj-list">';
  html += '<input id="dna-pl-box" placeholder="Box location" class="dna-input" style="flex:1">';
  html += '<input id="dna-pl-gly" placeholder="Glycerol" class="dna-input" style="flex:1">';
  html += '<button class="btn btn-sm" onclick="_dnaAddPlasmid()">Add</button>';
  html += '</div>';
  html += '<div style="margin-top:.3rem;text-align:right">' + _dnaReindexButton('plasmids') + '</div>';
  html += _dnaProjectDatalist();
  return html;
}

function _dnaResistanceCell(p) {
  var res = p.antibiotic_resistance || '';
  if (!res) {
    if (p.gb_file) return '<span class="muted" style="font-size:.78rem">none detected</span>';
    return '<span class="muted">\u2014</span>';
  }
  var parts = res.split(',');
  var html = '';
  parts.forEach(function(r) {
    r = r.trim();
    if (r) html += '<span class="dna-resist-badge">' + esc(r) + '</span> ';
  });
  return html;
}

async function _dnaRescanResistance() {
  try {
    var data = await api('POST', '/api/plasmids/rescan-resistance');
    toast(data.updated + ' plasmid(s) rescanned.');
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

async function _dnaAddPlasmid() {
  var name = (document.getElementById('dna-pl-name') || {}).value || '';
  if (!name.trim()) { toast('Plasmid name is required.'); return; }
  try {
    await api('POST', '/api/plasmids', {
      name: name.trim(),
      use: (document.getElementById('dna-pl-use') || {}).value || '',
      box_location: (document.getElementById('dna-pl-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-pl-gly') || {}).value || '',
      project: (document.getElementById('dna-pl-project') || {}).value || ''
    });
    toast('Plasmid added.'); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GBLOCK TABLE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaGblockTable() {
  var allItems = _dna.gblocks;
  var projFiltered = _dnaFilterByProject(allItems);
  var searchFields = ['name', 'sequence', 'use', 'project', 'supplier', 'order_id', 'box_number', 'notes'];
  var filtered = _dnaFilterItems(projFiltered, _dna.search.gblocks, searchFields);
  var s = _dna.sort.gblocks;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">GBLOCKS</div>';
  html += _dnaSearchBar('gblocks', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No gBlocks yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No gBlocks match your search.</div>';
  } else {
    var visibleIds = items.map(function(g) { return g.id; });
    html += _dnaBulkBar('gblocks', 'gblocks');
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += _dnaCheckboxTh('gblocks', visibleIds);
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27gblocks\x27,\x27name\x27)">Name' + _dnaSortIndicator('gblocks', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27gblocks\x27,\x27length\x27)">Length' + _dnaSortIndicator('gblocks', 'length') + '</th>';
    html += '<th>GC%</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27gblocks\x27,\x27use\x27)">Use' + _dnaSortIndicator('gblocks', 'use') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27gblocks\x27,\x27project\x27)">Project' + _dnaSortIndicator('gblocks', 'project') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27gblocks\x27,\x27supplier\x27)">Supplier' + _dnaSortIndicator('gblocks', 'supplier') + '</th>';
    html += '<th>Order ID</th><th>Box #</th>';
    html += _dnaStockHeader(['stock_dna']);
    html += '<th>.gb</th><th>Links</th><th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    html += _dnaRenderRows(items, function(g) {
      var gc = _dnaCalcGC(g.sequence || '');
      var row = '<tr>';
      row += _dnaCheckboxTd('gblocks', g.id);
      row += '<td class="dna-cell-name dna-editable" onclick="_dnaEditGblock(' + g.id + ')">' + esc(g.name) + '</td>';
      row += '<td>' + (g.length || 0) + ' bp</td>';
      row += '<td>' + gc + '%</td>';
      row += '<td>' + esc(g.use || '') + '</td>';
      row += '<td>' + _dnaProjBadge(g) + '</td>';
      row += '<td>' + esc(g.supplier || '') + '</td>';
      row += '<td>' + esc(g.order_id || '') + '</td>';
      row += '<td>' + esc(g.box_number || '') + ' ' + _dnaBoxPositionBadges('gblock', g.id) + '</td>';
      row += '<td>' + _dnaStockCell('gblocks', g, ['stock_dna']) + '</td>';
      row += '<td>' + _dnaGbCell('gblock', g) + '</td>';
      row += '<td>' + _dnaCrossLinks('gblock', g) + '</td>';
      row += '<td><span class="dna-del" onclick="_dnaDeleteItem(\x27gblocks\x27,' + g.id + ')" title="Delete">\u00d7</span></td>';
      row += '</tr>';
      return row;
    });
    html += '</tbody></table></div>';
  }

  html += '<div style="margin-top:.6rem;display:flex;justify-content:space-between;align-items:center"><button class="btn btn-sm" onclick="_dnaShowGblockForm()">\u002B Add gBlock</button>' + _dnaReindexButton('gblocks') + '</div>';
  return html;
}

function _dnaCalcGC(seq) {
  var clean = seq.replace(/[^ACGTacgt]/g, '');
  if (!clean.length) return '0.0';
  var gc = clean.replace(/[^GCgc]/g, '').length;
  return (gc / clean.length * 100).toFixed(1);
}

function _dnaShowGblockForm() {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;
  var html = '<div class="dna-modal" style="max-width:600px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">Add gBlock</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:1rem">';
  html += '<input id="dna-gb-name" class="dna-input" placeholder="Name (e.g. gBlock_GFP_spacer_RFP)">';
  html += '<textarea id="dna-gb-seq" class="dna-seq-textarea" placeholder="Paste DNA sequence\u2026" rows="4"></textarea>';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-gb-use" class="dna-input" placeholder="Use" style="flex:2">';
  html += '<input id="dna-gb-project" class="dna-input" placeholder="Project" style="flex:1" list="dna-proj-list">';
  html += '</div>';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-gb-supplier" class="dna-input" placeholder="Supplier" value="IDT" style="flex:1">';
  html += '<input id="dna-gb-order" class="dna-input" placeholder="Order ID" style="flex:1">';
  html += '<input id="dna-gb-box" class="dna-input" placeholder="Box #" style="flex:1">';
  html += '</div>';
  html += '<textarea id="dna-gb-notes" class="dna-input" placeholder="Notes" rows="2" style="resize:vertical"></textarea>';
  html += '<div style="display:flex;gap:.5rem;align-items:center">';
  html += '<label class="dna-gb-upload-label"><span class="dna-gb-upload-btn">\uD83D\uDCCE Attach .gb file</span><input type="file" id="dna-gb-file" accept=".gb,.gbk,.genbank" style="display:none" onchange="_dnaFormFileLabel(this,\x27dna-gb-file-name\x27)"></label>';
  html += '<span id="dna-gb-file-name" class="muted" style="font-size:.82rem"></span>';
  html += '</div>';
  html += '<button class="btn btn-sm" style="align-self:flex-start;background:#5b7a5e;color:#fff" onclick="_dnaSubmitGblock()">Save gBlock</button>';
  html += '</div>';
  html += _dnaProjectDatalist();
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

async function _dnaSubmitGblock() {
  var name = (document.getElementById('dna-gb-name') || {}).value || '';
  if (!name.trim()) { toast('Name is required.'); return; }
  try {
    var item = await api('POST', '/api/gblocks', {
      name: name.trim(),
      sequence: (document.getElementById('dna-gb-seq') || {}).value || '',
      use: (document.getElementById('dna-gb-use') || {}).value || '',
      project: (document.getElementById('dna-gb-project') || {}).value || '',
      supplier: (document.getElementById('dna-gb-supplier') || {}).value || 'IDT',
      order_id: (document.getElementById('dna-gb-order') || {}).value || '',
      box_number: (document.getElementById('dna-gb-box') || {}).value || '',
      notes: (document.getElementById('dna-gb-notes') || {}).value || ''
    });
    // Upload .gb file if selected
    var fileInput = document.getElementById('dna-gb-file');
    if (fileInput && fileInput.files.length && item.id) {
      await _dnaUploadGbForNew('gblocks', item.id, fileInput);
    }
    toast('gBlock added.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  KIT PARTS TABLE
// ══════════════════════════════════════════════════════════════════════════════

var _dnaKitNames = ['MoClo Toolkit', 'iGEM Distribution Kit', 'CIDAR MoClo', 'Custom'];
var _dnaPartTypes = ['Level 0', 'Level 1', 'Level 2', 'Promoter', 'RBS', 'CDS', 'Terminator', 'Connector', 'Resistance Marker', 'Origin', 'Other'];

function _dnaKitPartTable() {
  var allItems = _dna.kitParts;
  var projFiltered = _dnaFilterByProject(allItems);

  // additional kit/type filters
  var afterKit = projFiltered;
  if (_dna.filter.kit_name) {
    afterKit = afterKit.filter(function(p) { return (p.kit_name || '') === _dna.filter.kit_name; });
  }
  if (_dna.filter.part_type) {
    afterKit = afterKit.filter(function(p) { return (p.part_type || '') === _dna.filter.part_type; });
  }

  var searchFields = ['name', 'kit_name', 'part_type', 'description', 'project', 'resistance', 'notes'];
  var filtered = _dnaFilterItems(afterKit, _dna.search.kitParts, searchFields);
  var s = _dna.sort.kitParts;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">KIT PARTS</div>';

  // filter chips row
  html += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.5rem">';
  // kit name chips
  var kits = {};
  allItems.forEach(function(p) { if (p.kit_name) kits[p.kit_name] = 1; });
  var kitList = Object.keys(kits).sort();
  kitList.forEach(function(k) {
    var active = _dna.filter.kit_name === k;
    html += '<span class="dna-chip' + (active ? ' active' : '') + '" onclick="_dnaToggleKitFilter(\x27kit_name\x27,\x27' + k.replace(/'/g, '\x27') + '\x27)">' + esc(k) + '</span>';
  });
  // part type chips
  var types = {};
  allItems.forEach(function(p) { if (p.part_type) types[p.part_type] = 1; });
  var typeList = Object.keys(types).sort();
  typeList.forEach(function(t) {
    var active = _dna.filter.part_type === t;
    html += '<span class="dna-chip dna-chip-type' + (active ? ' active' : '') + '" onclick="_dnaToggleKitFilter(\x27part_type\x27,\x27' + t.replace(/'/g, '\x27') + '\x27)">' + esc(t) + '</span>';
  });
  if (_dna.filter.kit_name || _dna.filter.part_type) {
    html += '<span class="dna-chip dna-chip-clear" onclick="_dnaClearKitFilters()">Clear filters \u00d7</span>';
  }
  html += '</div>';

  html += _dnaSearchBar('kitParts', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No kit parts yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No kit parts match your filters.</div>';
  } else {
    var visibleIds = items.map(function(p) { return p.id; });
    html += _dnaBulkBar('kitParts', 'kit-parts');
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += _dnaCheckboxTh('kitParts', visibleIds);
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27kitParts\x27,\x27name\x27)">Name' + _dnaSortIndicator('kitParts', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27kitParts\x27,\x27kit_name\x27)">Kit' + _dnaSortIndicator('kitParts', 'kit_name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27kitParts\x27,\x27part_type\x27)">Type' + _dnaSortIndicator('kitParts', 'part_type') + '</th>';
    html += '<th>Description</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27kitParts\x27,\x27project\x27)">Project' + _dnaSortIndicator('kitParts', 'project') + '</th>';
    html += '<th>Resistance</th>';
    html += '<th>Box</th>';
    html += _dnaStockHeader(['stock_dna', 'stock_glycerol', 'stock_verified']);
    html += '<th>.gb</th><th>Links</th><th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    html += _dnaRenderRows(items, function(p) {
      var row = '<tr>';
      row += _dnaCheckboxTd('kitParts', p.id);
      row += '<td class="dna-cell-name"><span class="dna-editable" onclick="_dnaEditKitPart(' + p.id + ')">' + esc(p.name) + '</span>';
      if (p.source_url) row += ' <a href="' + esc(p.source_url) + '" target="_blank" title="Source" class="dna-ext-link">\u2197</a>';
      row += '</td>';
      row += '<td>' + esc(p.kit_name || '') + '</td>';
      row += '<td>' + (p.part_type ? '<span class="dna-type-badge">' + esc(p.part_type) + '</span>' : '') + '</td>';
      row += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.description || '') + '">' + esc(p.description || '') + '</td>';
      row += '<td>' + _dnaProjBadge(p) + '</td>';
      row += '<td>' + esc(p.resistance || '') + '</td>';
      row += '<td>' + esc(p.box_location || '') + ' ' + _dnaBoxPositionBadges('kit_part', p.id) + '</td>';
      row += '<td>' + _dnaStockCell('kit-parts', p, ['stock_dna', 'stock_glycerol', 'stock_verified']) + '</td>';
      row += '<td>' + _dnaGbCell('kit-part', p, 'kitpart') + '</td>';
      row += '<td>' + _dnaCrossLinks('kit_part', p) + '</td>';
      row += '<td><span class="dna-del" onclick="_dnaDeleteItem(\x27kit-parts\x27,' + p.id + ')" title="Delete">\u00d7</span></td>';
      row += '</tr>';
      return row;
    });
    html += '</tbody></table></div>';
  }

  html += '<div style="margin-top:.6rem;display:flex;justify-content:space-between;align-items:center"><button class="btn btn-sm" onclick="_dnaShowKitPartForm()">\u002B Add Kit Part</button>' + _dnaReindexButton('kitParts') + '</div>';
  return html;
}

function _dnaToggleKitFilter(key, val) {
  if (_dna.filter[key] === val) _dna.filter[key] = '';
  else _dna.filter[key] = val;
  _dnaRenderTable();
}

function _dnaClearKitFilters() {
  _dna.filter.kit_name = '';
  _dna.filter.part_type = '';
  _dnaRenderTable();
}

function _dnaShowKitPartForm() {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;
  var html = '<div class="dna-modal" style="max-width:600px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">Add Kit Part</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:1rem">';
  html += '<input id="dna-kp-name" class="dna-input" placeholder="Name (e.g. pGT400, J23100)">';
  html += '<div style="display:flex;gap:.5rem">';
  html += '<select id="dna-kp-kit" class="dna-input" style="flex:1"><option value="">Kit\u2026</option>';
  _dnaKitNames.forEach(function(k) { html += '<option value="' + esc(k) + '">' + esc(k) + '</option>'; });
  html += '</select>';
  html += '<select id="dna-kp-type" class="dna-input" style="flex:1"><option value="">Part type\u2026</option>';
  _dnaPartTypes.forEach(function(t) { html += '<option value="' + esc(t) + '">' + esc(t) + '</option>'; });
  html += '</select>';
  html += '</div>';
  html += '<input id="dna-kp-desc" class="dna-input" placeholder="Description">';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-kp-project" class="dna-input" placeholder="Project" style="flex:1" list="dna-proj-list">';
  html += '<input id="dna-kp-resist" class="dna-input" placeholder="Resistance (e.g. Amp)" style="flex:1">';
  html += '</div>';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-kp-box" class="dna-input" placeholder="Box location" style="flex:1">';
  html += '<input id="dna-kp-gly" class="dna-input" placeholder="Glycerol location" style="flex:1">';
  html += '</div>';
  html += '<input id="dna-kp-url" class="dna-input" placeholder="Source URL (e.g. Addgene link)">';
  html += '<textarea id="dna-kp-notes" class="dna-input" placeholder="Notes" rows="2" style="resize:vertical"></textarea>';
  html += '<div style="display:flex;gap:.5rem;align-items:center">';
  html += '<label class="dna-gb-upload-label"><span class="dna-gb-upload-btn">\uD83D\uDCCE Attach .gb file</span><input type="file" id="dna-kp-file" accept=".gb,.gbk,.genbank" style="display:none" onchange="_dnaFormFileLabel(this,\x27dna-kp-file-name\x27)"></label>';
  html += '<span id="dna-kp-file-name" class="muted" style="font-size:.82rem"></span>';
  html += '</div>';
  html += '<button class="btn btn-sm" style="align-self:flex-start;background:#5b7a5e;color:#fff" onclick="_dnaSubmitKitPart()">Save Kit Part</button>';
  html += '</div>';
  html += _dnaProjectDatalist();
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

async function _dnaSubmitKitPart() {
  var name = (document.getElementById('dna-kp-name') || {}).value || '';
  if (!name.trim()) { toast('Name is required.'); return; }
  try {
    var item = await api('POST', '/api/kit-parts', {
      name: name.trim(),
      kit_name: (document.getElementById('dna-kp-kit') || {}).value || '',
      part_type: (document.getElementById('dna-kp-type') || {}).value || '',
      description: (document.getElementById('dna-kp-desc') || {}).value || '',
      project: (document.getElementById('dna-kp-project') || {}).value || '',
      resistance: (document.getElementById('dna-kp-resist') || {}).value || '',
      box_location: (document.getElementById('dna-kp-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-kp-gly') || {}).value || '',
      source_url: (document.getElementById('dna-kp-url') || {}).value || '',
      notes: (document.getElementById('dna-kp-notes') || {}).value || ''
    });
    // Upload .gb file if selected
    var fileInput = document.getElementById('dna-kp-file');
    if (fileInput && fileInput.files.length && item.id) {
      await _dnaUploadGbForNew('kit-parts', item.id, fileInput);
    }
    toast('Kit part added.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PARTS TABLE (assembled/constructed parts)
// ══════════════════════════════════════════════════════════════════════════════

function _dnaPartsTable() {
  var allItems = _dna.parts;
  var projFiltered = _dnaFilterByProject(allItems);
  var searchFields = ['name', 'description', 'sequence', 'project', 'subcategory', 'part_type', 'source_feature', 'notes'];
  var filtered = _dnaFilterItems(projFiltered, _dna.search.parts, searchFields);
  var s = _dna.sort.parts;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">PARTS</div>';
  html += _dnaSearchBar('parts', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No parts yet \u2014 add one below or build from the Circuit Builder.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No parts match your search.</div>';
  } else {
    var visibleIds = items.map(function(p) { return p.id; });
    html += _dnaBulkBar('parts', 'parts');
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += _dnaCheckboxTh('parts', visibleIds);
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27parts\x27,\x27name\x27)">Name' + _dnaSortIndicator('parts', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27parts\x27,\x27part_type\x27)">Type' + _dnaSortIndicator('parts', 'part_type') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27parts\x27,\x27length\x27)">Length' + _dnaSortIndicator('parts', 'length') + '</th>';
    html += '<th>Description</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27parts\x27,\x27project\x27)">Project' + _dnaSortIndicator('parts', 'project') + '</th>';
    html += '<th>Source</th>';
    html += '<th>Box</th>';
    html += _dnaStockHeader(['stock_dna', 'stock_glycerol', 'stock_verified']);
    html += '<th>.gb</th><th>Links</th><th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    html += _dnaRenderRows(items, function(p) {
      var row = '<tr>';
      row += _dnaCheckboxTd('parts', p.id);
      row += '<td class="dna-cell-name dna-editable" onclick="_dnaEditPart(' + p.id + ')">' + esc(p.name) + '</td>';
      row += '<td>' + (p.part_type ? '<span class="dna-type-badge">' + esc(p.part_type) + '</span>' : '') + '</td>';
      row += '<td>' + (p.length || 0) + ' bp</td>';
      row += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.description || '') + '">' + esc(p.description || '') + '</td>';
      row += '<td>' + _dnaProjBadge(p) + '</td>';
      row += '<td>' + esc(p.source_feature || '') + '</td>';
      row += '<td>' + esc(p.box_location || '') + ' ' + _dnaBoxPositionBadges('part', p.id) + '</td>';
      row += '<td>' + _dnaStockCell('parts', p, ['stock_dna', 'stock_glycerol', 'stock_verified']) + '</td>';
      row += '<td>' + _dnaGbCell('part', p) + '</td>';
      row += '<td>' + _dnaCrossLinks('part', p) + '</td>';
      row += '<td><span class="dna-del" onclick="_dnaDeleteItem(\x27parts\x27,' + p.id + ')" title="Delete">\u00d7</span></td>';
      row += '</tr>';
      return row;
    });
    html += '</tbody></table></div>';
  }

  html += '<div style="margin-top:.6rem;display:flex;justify-content:space-between;align-items:center"><button class="btn btn-sm" onclick="_dnaShowPartForm()">\u002B Add Part</button>' + _dnaReindexButton('parts') + '</div>';
  return html;
}

function _dnaShowPartForm() {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;
  var typeOpts = ['Assembled', 'Construct', 'Module', 'Cassette', 'Fragment', 'Other'];
  var html = '<div class="dna-modal" style="max-width:600px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">Add Part</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:1rem">';
  html += '<input id="dna-pt-name" class="dna-input" placeholder="Name">';
  html += '<div style="display:flex;gap:.5rem">';
  html += '<select id="dna-pt-type" class="dna-input" style="flex:1"><option value="">Part type\u2026</option>';
  typeOpts.forEach(function(t) { html += '<option value="' + esc(t) + '">' + esc(t) + '</option>'; });
  html += '</select>';
  html += '<input id="dna-pt-source" class="dna-input" placeholder="Source (e.g. Circuit Builder)" style="flex:1">';
  html += '</div>';
  html += '<input id="dna-pt-desc" class="dna-input" placeholder="Description">';
  html += '<textarea id="dna-pt-seq" class="dna-seq-textarea" placeholder="Paste DNA sequence\u2026" rows="3"></textarea>';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-pt-project" class="dna-input" placeholder="Project" style="flex:1" list="dna-proj-list">';
  html += '<input id="dna-pt-sub" class="dna-input" placeholder="Subcategory" style="flex:1" list="dna-sub-list">';
  html += '</div>';
  html += '<div style="display:flex;gap:.5rem;flex-wrap:wrap">';
  html += '<input id="dna-pt-box" class="dna-input" placeholder="Box location" style="flex:1">';
  html += '<input id="dna-pt-gly" class="dna-input" placeholder="Glycerol location" style="flex:1">';
  html += '</div>';
  html += '<textarea id="dna-pt-notes" class="dna-input" placeholder="Notes" rows="2" style="resize:vertical"></textarea>';
  html += '<div style="display:flex;gap:.5rem;align-items:center">';
  html += '<label class="dna-gb-upload-label"><span class="dna-gb-upload-btn">\uD83D\uDCCE Attach .gb file</span><input type="file" id="dna-pt-file" accept=".gb,.gbk,.genbank" style="display:none" onchange="_dnaFormFileLabel(this,\x27dna-pt-file-name\x27)"></label>';
  html += '<span id="dna-pt-file-name" class="muted" style="font-size:.82rem"></span>';
  html += '</div>';
  html += '<button class="btn btn-sm" style="align-self:flex-start;background:#5b7a5e;color:#fff" onclick="_dnaSubmitPart()">Save Part</button>';
  html += '</div>';
  html += _dnaProjectDatalist();
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

async function _dnaSubmitPart() {
  var name = (document.getElementById('dna-pt-name') || {}).value || '';
  if (!name.trim()) { toast('Name is required.'); return; }
  try {
    var item = await api('POST', '/api/parts', {
      name: name.trim(),
      part_type: (document.getElementById('dna-pt-type') || {}).value || '',
      source_feature: (document.getElementById('dna-pt-source') || {}).value || '',
      description: (document.getElementById('dna-pt-desc') || {}).value || '',
      sequence: (document.getElementById('dna-pt-seq') || {}).value || '',
      project: (document.getElementById('dna-pt-project') || {}).value || '',
      subcategory: (document.getElementById('dna-pt-sub') || {}).value || '',
      box_location: (document.getElementById('dna-pt-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-pt-gly') || {}).value || '',
      notes: (document.getElementById('dna-pt-notes') || {}).value || ''
    });
    var fileInput = document.getElementById('dna-pt-file');
    if (fileInput && fileInput.files.length && item.id) {
      await _dnaUploadGbForNew('parts', item.id, fileInput);
    }
    toast('Part added.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  BOX VIEW
// ══════════════════════════════════════════════════════════════════════════════

function _dnaBoxViewContent() {
  if (_dna.boxView !== null) {
    var box = null;
    for (var i = 0; i < _dna.boxes.length; i++) {
      if (_dna.boxes[i].id === _dna.boxView) { box = _dna.boxes[i]; break; }
    }
    if (box) return _dnaBoxGrid(box);
    _dna.boxView = null;
  }
  return _dnaBoxList();
}

function _dnaBoxList() {
  var allItems = _dna.boxes;

  // Add computed fields for sorting
  var items = allItems.map(function(b) {
    var layout = b.layout || {};
    var count = Object.keys(layout).length;
    var total = (b.rows || 9) * (b.cols || 9);
    return {
      id: b.id, name: b.name, rows: b.rows, cols: b.cols,
      box_type: b.box_type || 'mixed', location: b.location || '',
      count: count, total: total, layout: layout,
      _size: b.rows + 'x' + b.cols,
      _fill: count + '/' + total
    };
  });

  // Search
  var query = _dna.search.boxes || '';
  if (query) {
    var lc = query.toLowerCase();
    items = items.filter(function(b) {
      return b.name.toLowerCase().indexOf(lc) !== -1 ||
             b.box_type.toLowerCase().indexOf(lc) !== -1 ||
             b.location.toLowerCase().indexOf(lc) !== -1;
    });
  }

  // Sort
  var s = _dna.sort.boxes;
  items = _dnaSortItems(items, s.col, s.dir);

  var html = '<div class="dna-section-hdr">STORAGE BOXES</div>';
  html += _dnaSearchBar('boxes', allItems.length, items.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No storage boxes yet \u2014 create one to start tracking physical locations.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No boxes match your search.</div>';
  } else {
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27boxes\x27,\x27name\x27)">Name' + _dnaSortIndicator('boxes', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27boxes\x27,\x27_size\x27)">Size' + _dnaSortIndicator('boxes', '_size') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27boxes\x27,\x27box_type\x27)">Type' + _dnaSortIndicator('boxes', 'box_type') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27boxes\x27,\x27location\x27)">Location' + _dnaSortIndicator('boxes', 'location') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27boxes\x27,\x27count\x27)">Items' + _dnaSortIndicator('boxes', 'count') + '</th>';
    html += '<th style="width:2rem"></th>';
    html += '</tr></thead><tbody>';
    items.forEach(function(b) {
      html += '<tr style="cursor:pointer" onclick="_dnaOpenBox(' + b.id + ')">';
      html += '<td class="dna-cell-name">' + esc(b.name) + '</td>';
      html += '<td>' + b.rows + ' \u00d7 ' + b.cols + '</td>';
      html += '<td>' + esc(b.box_type) + '</td>';
      html += '<td>' + esc(b.location) + '</td>';
      html += '<td>' + b.count + ' / ' + b.total + '</td>';
      html += '<td><span class="dna-del" onclick="event.stopPropagation();_dnaDeleteBox(' + b.id + ')" title="Delete">\u00d7</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '<div style="margin-top:.6rem"><button class="btn btn-sm" onclick="_dnaShowBoxForm()">\u002B Add Box</button></div>';
  return html;
}

function _dnaOpenBox(id) {
  _dna.boxView = id;
  _dnaRenderTable();
}

function _dnaBackToBoxList() {
  _dna.boxView = null;
  _dnaRenderTable();
}

function _dnaBoxGrid(box) {
  var layout = box.layout || {};
  var nRows = box.rows || 9;
  var nCols = box.cols || 9;

  var html = '<div style="display:flex;align-items:baseline;gap:.8rem;margin-bottom:.8rem">';
  html += '<span class="dna-back-link" onclick="_dnaBackToBoxList()">\u2190 All Boxes</span>';
  html += '<h3 style="margin:0;font-weight:600">' + esc(box.name) + '</h3>';
  if (box.location) html += '<span class="muted" style="font-size:.85rem">' + esc(box.location) + '</span>';
  html += '</div>';

  // color legend
  html += '<div style="display:flex;gap:.8rem;margin-bottom:.6rem;font-size:.78rem;color:#8a7f72">';
  html += '<span>\u25A0 <span style="color:#7bafd4">Primer</span></span>';
  html += '<span>\u25A0 <span style="color:#7aad7e">Plasmid</span></span>';
  html += '<span>\u25A0 <span style="color:#d4a95a">gBlock</span></span>';
  html += '<span>\u25A0 <span style="color:#a98bd4">Kit Part</span></span>';
  html += '<span>\u25A0 <span style="color:#d4905a">Part</span></span>';
  html += '</div>';

  html += '<div class="dna-box-grid-wrap"><table class="dna-box-grid"><thead><tr><th></th>';
  for (var c = 1; c <= nCols; c++) {
    html += '<th>' + c + '</th>';
  }
  html += '</tr></thead><tbody>';

  for (var r = 0; r < nRows; r++) {
    var rowLetter = String.fromCharCode(65 + r);
    html += '<tr><td class="dna-box-row-label">' + rowLetter + '</td>';
    for (var cc = 1; cc <= nCols; cc++) {
      var key = rowLetter + cc;
      var cell = layout[key];
      if (cell) {
        var itemName = _dnaLookupBoxItem(cell.type, cell.id);
        var colorClass = 'dna-box-' + (cell.type || 'mixed');
        html += '<td class="dna-box-cell occupied ' + colorClass + '" title="' + esc(key + ': ' + itemName) + '" onclick="_dnaBoxCellClick(\x27' + rowLetter + '\x27,' + cc + ',' + box.id + ')">';
        html += '<span class="dna-box-cell-name">' + esc(_dnaTruncate(itemName, 6)) + '</span>';
        html += '</td>';
      } else {
        html += '<td class="dna-box-cell empty" onclick="_dnaBoxCellClick(\x27' + rowLetter + '\x27,' + cc + ',' + box.id + ')">&nbsp;</td>';
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

function _dnaTruncate(s, max) {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max) + '\u2026';
}

function _dnaLookupBoxItem(type, id) {
  var list = [];
  if (type === 'primer') list = _dna.primers;
  else if (type === 'plasmid') list = _dna.plasmids;
  else if (type === 'gblock') list = _dna.gblocks;
  else if (type === 'kit_part') list = _dna.kitParts;
  else if (type === 'part') list = _dna.parts;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i].name || ('ID ' + id);
  }
  return type + ' #' + id;
}

function _dnaBoxCellClick(row, col, boxId) {
  var box = null;
  for (var i = 0; i < _dna.boxes.length; i++) {
    if (_dna.boxes[i].id === boxId) { box = _dna.boxes[i]; break; }
  }
  if (!box) return;
  var key = row + col;
  var layout = box.layout || {};
  var cell = layout[key];

  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;

  if (cell) {
    // occupied — show details + all positions of this item in this box
    var itemName = _dnaLookupBoxItem(cell.type, cell.id);
    var otherCells = [];
    Object.keys(layout).forEach(function(k) {
      if (k !== key && layout[k].type === cell.type && layout[k].id === cell.id) {
        otherCells.push(k);
      }
    });
    otherCells.sort(function(a, b) { return _dnaNaturalCmp(a, b); });

    var html = '<div class="dna-modal" style="max-width:400px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
    html += '<h3 style="margin:0">Cell ' + esc(key) + '</h3>';
    html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
    html += '</div>';
    html += '<div style="margin-top:.8rem">';
    html += '<p><strong>' + esc(itemName) + '</strong> <span class="muted">(' + esc(cell.type) + ')</span></p>';
    if (otherCells.length > 0) {
      html += '<p class="muted" style="font-size:.82rem;margin-top:.4rem">Also in ' + otherCells.length + ' other cell(s): <strong>' + esc(otherCells.join(', ')) + '</strong></p>';
    }
    // All positions across all boxes
    var allPos = _dnaFindAllBoxPositions(cell.type, cell.id);
    var otherBoxPos = allPos.filter(function(p) { return p.box_id !== boxId; });
    if (otherBoxPos.length > 0) {
      html += '<p class="muted" style="font-size:.78rem;margin-top:.3rem">Other boxes: ';
      otherBoxPos.forEach(function(p, i) {
        if (i > 0) html += ', ';
        html += esc(p.box_name) + ' ' + esc(p.cell);
      });
      html += '</p>';
    }
    html += '<div style="display:flex;gap:.4rem;margin-top:.6rem">';
    html += '<button class="btn btn-sm" style="background:#c0392b;color:#fff" onclick="_dnaRemoveCell(' + boxId + ',\x27' + row + '\x27,' + col + ')">Remove from cell</button>';
    html += '<button class="btn btn-sm" onclick="_dnaRemoveAllOfItem(' + boxId + ',\x27' + cell.type + '\x27,' + cell.id + ')">Remove all in this box</button>';
    html += '</div>';
    html += '</div></div>';
    ov.innerHTML = html;
    ov.style.display = '';
  } else {
    // empty — assign modal
    _dna.boxAssignCell = { row: row, col: col, boxId: boxId };
    _dnaShowAssignModal(boxId, row, col);
  }
}

// Find all box positions for an item across all loaded boxes
function _dnaFindAllBoxPositions(type, id) {
  var positions = [];
  _dna.boxes.forEach(function(box) {
    var layout = box.layout || {};
    Object.keys(layout).forEach(function(key) {
      if (layout[key].type === type && layout[key].id === id) {
        positions.push({ box_id: box.id, box_name: box.name, cell: key });
      }
    });
  });
  return positions;
}

// Get a display string of box positions for an item (for table views)
function _dnaBoxPositionBadges(type, id) {
  var positions = _dnaFindAllBoxPositions(type, id);
  if (positions.length === 0) return '';
  var html = '';
  positions.forEach(function(p) {
    html += '<span class="dna-box-pos-badge" title="' + esc(p.box_name) + '">' + esc(p.cell) + '</span>';
  });
  return html;
}

function _dnaShowAssignModal(boxId, row, col) {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;

  var allItems = _dnaGetAllItems();

  var html = '<div class="dna-modal" style="max-width:420px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">Assign to ' + esc(row + col) + '</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div style="display:flex;gap:.5rem;align-items:center;margin-top:.8rem">';
  html += '<input id="dna-box-assign-search" class="dna-input" placeholder="Search items\u2026" oninput="_dnaBoxAssignFilter()" style="flex:1">';
  html += '<label style="font-size:.78rem;color:#8a7f72;white-space:nowrap">Qty <input id="dna-box-assign-qty" type="number" min="1" max="99" value="1" class="dna-input" style="width:3rem;text-align:center"></label>';
  html += '</div>';
  html += '<div id="dna-box-assign-list" style="max-height:300px;overflow-y:auto;margin-top:.5rem">';
  html += _dnaBoxAssignList(allItems, '');
  html += '</div></div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

function _dnaGetAllItems() {
  var allItems = [];
  _dna.primers.forEach(function(p) { allItems.push({ type: 'primer', id: p.id, name: p.name }); });
  _dna.plasmids.forEach(function(p) { allItems.push({ type: 'plasmid', id: p.id, name: p.name }); });
  _dna.gblocks.forEach(function(g) { allItems.push({ type: 'gblock', id: g.id, name: g.name }); });
  _dna.kitParts.forEach(function(k) { allItems.push({ type: 'kit_part', id: k.id, name: k.name }); });
  _dna.parts.forEach(function(p) { allItems.push({ type: 'part', id: p.id, name: p.name }); });
  return allItems;
}

function _dnaBoxAssignFilter() {
  var q = (document.getElementById('dna-box-assign-search') || {}).value || '';
  var el = document.getElementById('dna-box-assign-list');
  if (el) el.innerHTML = _dnaBoxAssignList(_dnaGetAllItems(), q);
}

function _dnaBoxAssignList(allItems, query) {
  var lc = (query || '').toLowerCase();
  var filtered = allItems;
  if (lc) {
    filtered = allItems.filter(function(it) {
      return it.name.toLowerCase().indexOf(lc) !== -1 || it.type.indexOf(lc) !== -1;
    });
  }
  if (!filtered.length) return '<div class="dna-empty" style="padding:.5rem">No matching items.</div>';
  var html = '';
  filtered.forEach(function(it) {
    // Show existing box positions next to name
    var posCount = _dnaFindAllBoxPositions(it.type, it.id).length;
    html += '<div class="dna-box-assign-item" onclick="_dnaAssignCell(\x27' + it.type + '\x27,' + it.id + ')">';
    html += '<span class="dna-cell-name">' + esc(it.name) + '</span>';
    html += '<span class="muted" style="font-size:.78rem;margin-left:.4rem">' + esc(it.type) + '</span>';
    if (posCount > 0) html += '<span class="muted" style="font-size:.72rem;margin-left:auto">' + posCount + ' in boxes</span>';
    html += '</div>';
  });
  return html;
}

async function _dnaAssignCell(type, id) {
  var c = _dna.boxAssignCell;
  if (!c) return;
  var qty = parseInt((document.getElementById('dna-box-assign-qty') || {}).value, 10) || 1;

  if (qty <= 1) {
    // Single cell assign
    try {
      await api('PUT', '/api/boxes/' + c.boxId + '/cell', {
        row: c.row, col: c.col, item_type: type, item_id: id
      });
      toast('Assigned to ' + c.row + c.col + '.');
    } catch(e) { toast('Error: ' + e.message); }
  } else {
    // Multi-cell: fill consecutive empty cells starting from the clicked one
    var box = null;
    for (var i = 0; i < _dna.boxes.length; i++) {
      if (_dna.boxes[i].id === c.boxId) { box = _dna.boxes[i]; break; }
    }
    if (!box) return;
    var layout = box.layout || {};
    var nRows = box.rows || 9;
    var nCols = box.cols || 9;

    // Build ordered list of all cells starting from the clicked one
    var startRowIdx = c.row.charCodeAt(0) - 65;
    var startColIdx = c.col - 1;
    var cells = [];
    for (var ri = 0; ri < nRows; ri++) {
      for (var ci = 0; ci < nCols; ci++) {
        // Start from the clicked cell, wrap around
        var r = (startRowIdx + Math.floor((startColIdx + ri * nCols + ci) / nCols)) % nRows;
        var cc = (startColIdx + ci) % nCols;
        // Simpler: iterate row-by-row starting from clicked position
        cells.push({ r: ri, c: ci });
      }
    }
    // Actually, just iterate all cells in order from the clicked position
    var emptyCells = [];
    for (var row = startRowIdx; row < nRows && emptyCells.length < qty; row++) {
      var colStart = (row === startRowIdx) ? startColIdx : 0;
      for (var col = colStart; col < nCols && emptyCells.length < qty; col++) {
        var key = String.fromCharCode(65 + row) + (col + 1);
        if (!layout[key]) {
          emptyCells.push({ row: String.fromCharCode(65 + row), col: col + 1 });
        }
      }
    }

    if (emptyCells.length === 0) { toast('No empty cells available.', true); return; }
    try {
      await api('PUT', '/api/boxes/' + c.boxId + '/multi-cell', {
        cells: emptyCells, item_type: type, item_id: id
      });
      toast(emptyCells.length + ' cell(s) assigned.');
    } catch(e) { toast('Error: ' + e.message); }
  }

  _dna.boxAssignCell = null;
  _dnaCloseOverlay();
  _dnaRefresh();
}

async function _dnaRemoveCell(boxId, row, col) {
  try {
    await api('DELETE', '/api/boxes/' + boxId + '/cell', { row: row, col: col });
    toast('Cell cleared.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

async function _dnaRemoveAllOfItem(boxId, type, id) {
  var box = null;
  for (var i = 0; i < _dna.boxes.length; i++) {
    if (_dna.boxes[i].id === boxId) { box = _dna.boxes[i]; break; }
  }
  if (!box) return;
  var layout = box.layout || {};
  var cellsToRemove = [];
  Object.keys(layout).forEach(function(key) {
    if (layout[key].type === type && layout[key].id === id) {
      var match = key.match(/^([A-Z])(\d+)$/);
      if (match) cellsToRemove.push({ row: match[1], col: parseInt(match[2], 10) });
    }
  });
  if (!cellsToRemove.length) return;
  if (!confirm('Remove from all ' + cellsToRemove.length + ' cell(s) in this box?')) return;
  var errors = 0;
  for (var i = 0; i < cellsToRemove.length; i++) {
    try {
      await api('DELETE', '/api/boxes/' + boxId + '/cell', cellsToRemove[i]);
    } catch(e) { errors++; }
  }
  toast(cellsToRemove.length + ' cell(s) cleared.');
  _dnaCloseOverlay();
  _dnaRefresh();
}

function _dnaShowBoxForm() {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;
  var html = '<div class="dna-modal" style="max-width:420px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">New Storage Box</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;gap:.6rem;margin-top:1rem">';
  html += '<input id="dna-bx-name" class="dna-input" placeholder="Box name (e.g. Primer Box 1)">';
  html += '<div style="display:flex;gap:.5rem">';
  html += '<label class="dna-setting-label">Rows<input id="dna-bx-rows" class="dna-input" type="number" value="9" min="1" max="26" style="width:4rem"></label>';
  html += '<label class="dna-setting-label">Cols<input id="dna-bx-cols" class="dna-input" type="number" value="9" min="1" max="26" style="width:4rem"></label>';
  html += '</div>';
  html += '<select id="dna-bx-type" class="dna-input"><option value="mixed">Mixed</option><option value="primer">Primer</option><option value="plasmid">Plasmid</option><option value="gblock">gBlock</option><option value="kit_part">Kit Part</option><option value="part">Part</option></select>';
  html += '<input id="dna-bx-loc" class="dna-input" placeholder="Location (e.g. -20\u00b0C Freezer 1, Shelf 2)">';
  html += '<button class="btn btn-sm" style="align-self:flex-start;background:#5b7a5e;color:#fff" onclick="_dnaSubmitBox()">Create Box</button>';
  html += '</div></div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

async function _dnaSubmitBox() {
  var name = (document.getElementById('dna-bx-name') || {}).value || '';
  if (!name.trim()) { toast('Box name is required.'); return; }
  try {
    await api('POST', '/api/boxes', {
      name: name.trim(),
      rows: parseInt((document.getElementById('dna-bx-rows') || {}).value, 10) || 9,
      cols: parseInt((document.getElementById('dna-bx-cols') || {}).value, 10) || 9,
      box_type: (document.getElementById('dna-bx-type') || {}).value || 'mixed',
      location: (document.getElementById('dna-bx-loc') || {}).value || ''
    });
    toast('Box created.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

async function _dnaDeleteBox(id) {
  if (!confirm('Delete this storage box?')) return;
  try { await api('DELETE', '/api/boxes/' + id); toast('Box deleted.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  REINDEX (close naming gaps)
// ══════════════════════════════════════════════════════════════════════════════

var _dnaReindexDefaults = {
  primers: function() { return _dna.settings.primer_prefix || 'MR'; },
  plasmids: function() { return _dna.settings.plasmid_prefix || 'pMR'; },
  gblocks: function() { return 'gBlock_'; },
  kitParts: function() { return ''; },
  parts: function() { return ''; }
};
var _dnaReindexEndpoints = {
  primers: 'primers', plasmids: 'plasmids', gblocks: 'gblocks', kitParts: 'kit_parts', parts: 'parts'
};

function _dnaShowReindex(tab) {
  var endpoint = _dnaReindexEndpoints[tab] || tab;
  var defaultPrefix = (_dnaReindexDefaults[tab] || function() { return ''; })();

  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;

  var html = '<div class="dna-modal" style="max-width:520px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">Reindex \u2014 Close Naming Gaps</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<p class="muted" style="font-size:.82rem;margin:.5rem 0">Renumber items matching a prefix to close gaps (e.g. MR1, MR3, MR7 \u2192 MR1, MR2, MR3).</p>';
  html += '<div style="display:flex;gap:.6rem;align-items:end;margin-bottom:.8rem">';
  html += '<label class="dna-edit-label">Prefix<input id="dna-reindex-prefix" class="dna-input" value="' + esc(defaultPrefix) + '" style="width:8rem"></label>';
  html += '<label class="dna-edit-label">Start at<input id="dna-reindex-start" class="dna-input" type="number" min="1" value="1" style="width:5rem"></label>';
  html += '<button class="btn btn-sm" style="background:#5b7a5e;color:#fff" onclick="_dnaReindexPreview(\x27' + endpoint + '\x27)">Preview</button>';
  html += '</div>';
  html += '<div id="dna-reindex-preview"></div>';
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

async function _dnaReindexPreview(endpoint) {
  var prefix = (document.getElementById('dna-reindex-prefix') || {}).value || '';
  var startNum = parseInt((document.getElementById('dna-reindex-start') || {}).value, 10) || 1;
  if (!prefix.trim()) { toast('Enter a prefix.'); return; }

  var el = document.getElementById('dna-reindex-preview');
  if (!el) return;
  el.innerHTML = '<div class="muted" style="padding:.5rem">Loading preview\u2026</div>';

  try {
    var data = await api('POST', '/api/dna/reindex', {
      table: endpoint, prefix: prefix.trim(), start_num: startNum, execute: false
    });

    if (!data.changes || data.changes.length === 0) {
      el.innerHTML = '<div class="muted" style="padding:.5rem">' +
        (data.total_items ? 'No gaps found \u2014 ' + data.total_items + ' items already sequential.' : 'No items match prefix "' + esc(prefix) + '".') +
        '</div>';
      return;
    }

    var html = '<div style="font-size:.82rem;margin-bottom:.5rem"><strong>' + data.changes.length + '</strong> rename(s) needed out of ' + data.total_items + ' items:</div>';
    html += '<div style="max-height:250px;overflow-y:auto;border:1px solid #e8e2d8;border-radius:4px">';
    html += '<table class="dna-table" style="font-size:.82rem"><thead><tr><th>Current</th><th></th><th>New</th></tr></thead><tbody>';
    data.changes.forEach(function(c) {
      html += '<tr>';
      html += '<td><code style="color:#c0392b">' + esc(c.old_name) + '</code></td>';
      html += '<td style="text-align:center;color:#8a7f72">\u2192</td>';
      html += '<td><code style="color:#5b7a5e">' + esc(c.new_name) + '</code></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div style="margin-top:.6rem;display:flex;gap:.4rem">';
    html += '<button class="btn btn-sm" style="background:#c0392b;color:#fff" onclick="_dnaReindexExecute(\x27' + endpoint + '\x27)">Apply Renames</button>';
    html += '<button class="btn btn-sm" onclick="_dnaCloseOverlay()">Cancel</button>';
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="muted" style="color:#c0392b;padding:.5rem">Error: ' + esc(e.message || 'Unknown') + '</div>';
  }
}

async function _dnaReindexExecute(endpoint) {
  var prefix = (document.getElementById('dna-reindex-prefix') || {}).value || '';
  var startNum = parseInt((document.getElementById('dna-reindex-start') || {}).value, 10) || 1;
  try {
    var data = await api('POST', '/api/dna/reindex', {
      table: endpoint, prefix: prefix.trim(), start_num: startNum, execute: true
    });
    toast(data.renamed + ' item(s) renamed.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Reindex failed: ' + (e.message || 'Unknown'), true); }
}

function _dnaReindexButton(tab) {
  return '<button class="btn btn-sm" onclick="_dnaShowReindex(\x27' + tab + '\x27)" style="font-size:.78rem;color:#8a7f72" title="Close naming gaps">\u{1F522} Reindex</button>';
}

// ══════════════════════════════════════════════════════════════════════════════
//  EDIT MODALS (with subcategory + move)
// ══════════════════════════════════════════════════════════════════════════════

function _dnaEditField(id, label, value, opts) {
  opts = opts || {};
  var tag = opts.tag || 'input';
  var extra = opts.extra || '';
  var html = '<label class="dna-edit-label">' + esc(label);
  if (tag === 'textarea') {
    html += '<textarea id="' + id + '" class="dna-input" rows="' + (opts.rows || 2) + '" style="resize:vertical' + (opts.mono ? ';font-family:SF Mono,Monaco,Consolas,monospace;font-size:.85rem' : '') + '"' + extra + '>' + esc(value || '') + '</textarea>';
  } else if (tag === 'select') {
    html += '<select id="' + id + '" class="dna-input"' + extra + '>';
    (opts.options || []).forEach(function(o) {
      var ov = typeof o === 'object' ? o.value : o;
      var ol = typeof o === 'object' ? o.label : o;
      html += '<option value="' + esc(ov) + '"' + (ov === value ? ' selected' : '') + '>' + esc(ol) + '</option>';
    });
    html += '</select>';
  } else {
    html += '<input id="' + id + '" class="dna-input" value="' + esc(value || '') + '"' + extra + (opts.list ? ' list="' + opts.list + '"' : '') + '>';
  }
  html += '</label>';
  return html;
}

function _dnaEditRow() {
  var parts = Array.prototype.slice.call(arguments);
  return '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' + parts.join('') + '</div>';
}

function _dnaProjSubRow(project, subcategory) {
  return _dnaEditRow(
    _dnaEditField('dna-ed-project', 'Project', project, { list: 'dna-proj-list' }),
    _dnaEditField('dna-ed-sub', 'Subcategory', subcategory, { list: 'dna-sub-list' })
  );
}

function _dnaMoveSection(fromType, fromId) {
  var types = [
    { value: 'primer', label: 'Primer' },
    { value: 'plasmid', label: 'Plasmid' },
    { value: 'gblock', label: 'gBlock' },
    { value: 'kit_part', label: 'Kit Part' },
    { value: 'part', label: 'Part' }
  ].filter(function(t) { return t.value !== fromType; });
  var html = '<div class="dna-move-section">';
  html += '<span class="muted" style="font-size:.78rem">Move to:</span> ';
  types.forEach(function(t) {
    html += '<button class="btn btn-sm dna-move-btn" onclick="_dnaMoveTo(\x27' + fromType + '\x27,' + fromId + ',\x27' + t.value + '\x27)">' + t.label + '</button> ';
  });
  html += '</div>';
  return html;
}

function _dnaEditModal(title, fieldsHtml, saveFn, moveHtml) {
  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;
  var html = '<div class="dna-modal" style="max-width:560px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
  html += '<h3 style="margin:0">' + title + '</h3>';
  html += '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>';
  html += '</div>';
  html += '<div class="dna-edit-form">' + fieldsHtml + '</div>';
  html += '<div style="display:flex;gap:.5rem;margin-top:1rem">';
  html += '<button class="btn btn-sm" style="background:#5b7a5e;color:#fff" onclick="' + saveFn + '">Save</button>';
  html += '<button class="btn btn-sm" onclick="_dnaCloseOverlay()">Cancel</button>';
  html += '</div>';
  if (moveHtml) html += moveHtml;
  html += _dnaProjectDatalist();
  html += '</div>';
  ov.innerHTML = html;
  ov.style.display = '';
}

function _dnaFindById(arr, id) {
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i];
  }
  return null;
}

async function _dnaMoveTo(fromType, fromId, toType) {
  if (!confirm('Move this item to ' + toType + '? Common fields will be preserved.')) return;
  try {
    await api('POST', '/api/dna/move', { from_type: fromType, from_id: fromId, to_type: toType });
    toast('Moved to ' + toType + '.');
    _dnaCloseOverlay();
    var tabMap = { primer: 'primers', plasmid: 'plasmids', gblock: 'gblocks', kit_part: 'kitParts', part: 'parts' };
    _dna.tab = tabMap[toType] || _dna.tab;
    _dnaRefresh();
  } catch(e) { toast('Move failed: ' + (e.message || 'unknown error'), true); }
}

// ── Edit Primer ──

function _dnaEditPrimer(id) {
  var p = _dnaFindById(_dna.primers, id);
  if (!p) return;
  var html = '';
  html += _dnaEditField('dna-ed-name', 'Name', p.name);
  html += _dnaEditField('dna-ed-seq', 'Sequence', p.sequence, { tag: 'textarea', rows: 3, mono: true });
  html += _dnaEditRow(
    _dnaEditField('dna-ed-use', 'Use', p.use),
    _dnaEditField('dna-ed-box', 'Box #', p.box_number)
  );
  html += _dnaProjSubRow(p.project, p.subcategory);
  html += _dnaStockEditRow(p, ['stock_dna']);
  _dnaEditModal('Edit Primer \u2014 ' + esc(p.name), html, '_dnaEditPrimerSave(' + id + ')', _dnaMoveSection('primer', id));
}

async function _dnaEditPrimerSave(id) {
  try {
    await api('PUT', '/api/primers/' + id, {
      name: (document.getElementById('dna-ed-name') || {}).value || '',
      sequence: (document.getElementById('dna-ed-seq') || {}).value || '',
      use: (document.getElementById('dna-ed-use') || {}).value || '',
      project: (document.getElementById('dna-ed-project') || {}).value || '',
      subcategory: (document.getElementById('dna-ed-sub') || {}).value || '',
      box_number: (document.getElementById('dna-ed-box') || {}).value || '',
      stock_dna: (document.getElementById('dna-ed-stock_dna') || {}).value || ''
    });
    toast('Primer updated.'); _dnaCloseOverlay(); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Edit Plasmid ──

function _dnaEditPlasmid(id) {
  var p = _dnaFindById(_dna.plasmids, id);
  if (!p) return;
  var html = '';
  html += _dnaEditField('dna-ed-name', 'Name', p.name);
  html += _dnaEditField('dna-ed-use', 'Use', p.use);
  html += _dnaEditRow(
    _dnaEditField('dna-ed-resist', 'Antibiotic Resistance', p.antibiotic_resistance),
    _dnaEditField('dna-ed-box', 'Box Location', p.box_location)
  );
  html += _dnaEditField('dna-ed-gly', 'Glycerol Location', p.glycerol_location);
  html += _dnaProjSubRow(p.project, p.subcategory);
  html += _dnaStockEditRow(p, ['stock_dna', 'stock_glycerol', 'stock_verified']);
  _dnaEditModal('Edit Plasmid \u2014 ' + esc(p.name), html, '_dnaEditPlasmidSave(' + id + ')', _dnaMoveSection('plasmid', id));
}

async function _dnaEditPlasmidSave(id) {
  try {
    await api('PUT', '/api/plasmids/' + id, {
      name: (document.getElementById('dna-ed-name') || {}).value || '',
      use: (document.getElementById('dna-ed-use') || {}).value || '',
      project: (document.getElementById('dna-ed-project') || {}).value || '',
      subcategory: (document.getElementById('dna-ed-sub') || {}).value || '',
      antibiotic_resistance: (document.getElementById('dna-ed-resist') || {}).value || '',
      box_location: (document.getElementById('dna-ed-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-ed-gly') || {}).value || '',
      stock_dna: (document.getElementById('dna-ed-stock_dna') || {}).value || '',
      stock_glycerol: (document.getElementById('dna-ed-stock_glycerol') || {}).value || '',
      stock_verified: (document.getElementById('dna-ed-stock_verified') || {}).value || ''
    });
    toast('Plasmid updated.'); _dnaCloseOverlay(); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Edit gBlock ──

function _dnaEditGblock(id) {
  var g = _dnaFindById(_dna.gblocks, id);
  if (!g) return;
  var html = '';
  html += _dnaEditField('dna-ed-name', 'Name', g.name);
  html += _dnaEditField('dna-ed-seq', 'Sequence', g.sequence, { tag: 'textarea', rows: 3, mono: true });
  html += _dnaEditRow(
    _dnaEditField('dna-ed-use', 'Use', g.use),
    _dnaEditField('dna-ed-supplier', 'Supplier', g.supplier)
  );
  html += _dnaEditRow(
    _dnaEditField('dna-ed-order', 'Order ID', g.order_id),
    _dnaEditField('dna-ed-box', 'Box #', g.box_number)
  );
  html += _dnaProjSubRow(g.project, g.subcategory);
  html += _dnaEditField('dna-ed-notes', 'Notes', g.notes, { tag: 'textarea', rows: 2 });
  html += _dnaStockEditRow(g, ['stock_dna']);
  _dnaEditModal('Edit gBlock \u2014 ' + esc(g.name), html, '_dnaEditGblockSave(' + id + ')', _dnaMoveSection('gblock', id));
}

async function _dnaEditGblockSave(id) {
  try {
    await api('PUT', '/api/gblocks/' + id, {
      name: (document.getElementById('dna-ed-name') || {}).value || '',
      sequence: (document.getElementById('dna-ed-seq') || {}).value || '',
      use: (document.getElementById('dna-ed-use') || {}).value || '',
      project: (document.getElementById('dna-ed-project') || {}).value || '',
      subcategory: (document.getElementById('dna-ed-sub') || {}).value || '',
      supplier: (document.getElementById('dna-ed-supplier') || {}).value || '',
      order_id: (document.getElementById('dna-ed-order') || {}).value || '',
      box_number: (document.getElementById('dna-ed-box') || {}).value || '',
      notes: (document.getElementById('dna-ed-notes') || {}).value || '',
      stock_dna: (document.getElementById('dna-ed-stock_dna') || {}).value || ''
    });
    toast('gBlock updated.'); _dnaCloseOverlay(); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Edit Kit Part ──

function _dnaEditKitPart(id) {
  var p = _dnaFindById(_dna.kitParts, id);
  if (!p) return;
  var kitOpts = ['', 'MoClo Toolkit', 'iGEM Distribution Kit', 'CIDAR MoClo', 'Custom'].map(function(k) { return { value: k, label: k || 'Kit\u2026' }; });
  var typeOpts = ['', 'Level 0', 'Level 1', 'Level 2', 'Promoter', 'RBS', 'CDS', 'Terminator', 'Connector', 'Resistance Marker', 'Origin', 'Other'].map(function(t) { return { value: t, label: t || 'Part type\u2026' }; });
  var html = '';
  html += _dnaEditField('dna-ed-name', 'Name', p.name);
  html += _dnaEditRow(
    _dnaEditField('dna-ed-kit', 'Kit', p.kit_name, { tag: 'select', options: kitOpts }),
    _dnaEditField('dna-ed-type', 'Part Type', p.part_type, { tag: 'select', options: typeOpts })
  );
  html += _dnaEditField('dna-ed-desc', 'Description', p.description);
  html += _dnaEditRow(
    _dnaEditField('dna-ed-resist', 'Resistance', p.resistance),
    _dnaEditField('dna-ed-box', 'Box Location', p.box_location)
  );
  html += _dnaEditField('dna-ed-gly', 'Glycerol Location', p.glycerol_location);
  html += _dnaEditField('dna-ed-url', 'Source URL', p.source_url);
  html += _dnaProjSubRow(p.project, p.subcategory);
  html += _dnaEditField('dna-ed-notes', 'Notes', p.notes, { tag: 'textarea', rows: 2 });
  html += _dnaStockEditRow(p, ['stock_dna', 'stock_glycerol', 'stock_verified']);
  _dnaEditModal('Edit Kit Part \u2014 ' + esc(p.name), html, '_dnaEditKitPartSave(' + id + ')', _dnaMoveSection('kit_part', id));
}

async function _dnaEditKitPartSave(id) {
  try {
    await api('PUT', '/api/kit-parts/' + id, {
      name: (document.getElementById('dna-ed-name') || {}).value || '',
      kit_name: (document.getElementById('dna-ed-kit') || {}).value || '',
      part_type: (document.getElementById('dna-ed-type') || {}).value || '',
      description: (document.getElementById('dna-ed-desc') || {}).value || '',
      project: (document.getElementById('dna-ed-project') || {}).value || '',
      subcategory: (document.getElementById('dna-ed-sub') || {}).value || '',
      resistance: (document.getElementById('dna-ed-resist') || {}).value || '',
      box_location: (document.getElementById('dna-ed-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-ed-gly') || {}).value || '',
      source_url: (document.getElementById('dna-ed-url') || {}).value || '',
      notes: (document.getElementById('dna-ed-notes') || {}).value || '',
      stock_dna: (document.getElementById('dna-ed-stock_dna') || {}).value || '',
      stock_glycerol: (document.getElementById('dna-ed-stock_glycerol') || {}).value || '',
      stock_verified: (document.getElementById('dna-ed-stock_verified') || {}).value || ''
    });
    toast('Kit part updated.'); _dnaCloseOverlay(); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Edit Part ──

function _dnaEditPart(id) {
  var p = _dnaFindById(_dna.parts, id);
  if (!p) return;
  var typeOpts = ['', 'Assembled', 'Construct', 'Module', 'Cassette', 'Fragment', 'Other'].map(function(t) { return { value: t, label: t || 'Part type\u2026' }; });
  var html = '';
  html += _dnaEditField('dna-ed-name', 'Name', p.name);
  html += _dnaEditRow(
    _dnaEditField('dna-ed-type', 'Part Type', p.part_type, { tag: 'select', options: typeOpts }),
    _dnaEditField('dna-ed-source', 'Source', p.source_feature)
  );
  html += _dnaEditField('dna-ed-desc', 'Description', p.description);
  html += _dnaEditField('dna-ed-seq', 'Sequence', p.sequence, { tag: 'textarea', rows: 3, mono: true });
  html += _dnaEditRow(
    _dnaEditField('dna-ed-box', 'Box Location', p.box_location),
    _dnaEditField('dna-ed-gly', 'Glycerol Location', p.glycerol_location)
  );
  html += _dnaProjSubRow(p.project, p.subcategory);
  html += _dnaEditField('dna-ed-notes', 'Notes', p.notes, { tag: 'textarea', rows: 2 });
  html += _dnaStockEditRow(p, ['stock_dna', 'stock_glycerol', 'stock_verified']);
  _dnaEditModal('Edit Part \u2014 ' + esc(p.name), html, '_dnaEditPartSave(' + id + ')', _dnaMoveSection('part', id));
}

async function _dnaEditPartSave(id) {
  try {
    await api('PUT', '/api/parts/' + id, {
      name: (document.getElementById('dna-ed-name') || {}).value || '',
      part_type: (document.getElementById('dna-ed-type') || {}).value || '',
      source_feature: (document.getElementById('dna-ed-source') || {}).value || '',
      description: (document.getElementById('dna-ed-desc') || {}).value || '',
      sequence: (document.getElementById('dna-ed-seq') || {}).value || '',
      project: (document.getElementById('dna-ed-project') || {}).value || '',
      subcategory: (document.getElementById('dna-ed-sub') || {}).value || '',
      box_location: (document.getElementById('dna-ed-box') || {}).value || '',
      glycerol_location: (document.getElementById('dna-ed-gly') || {}).value || '',
      notes: (document.getElementById('dna-ed-notes') || {}).value || '',
      stock_dna: (document.getElementById('dna-ed-stock_dna') || {}).value || '',
      stock_glycerol: (document.getElementById('dna-ed-stock_glycerol') || {}).value || '',
      stock_verified: (document.getElementById('dna-ed-stock_verified') || {}).value || ''
    });
    toast('Part updated.'); _dnaCloseOverlay(); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GENERIC DELETE
// ══════════════════════════════════════════════════════════════════════════════

async function _dnaDeleteItem(endpoint, id) {
  if (!confirm('Delete this item?')) return;
  try { await api('DELETE', '/api/' + endpoint + '/' + id); toast('Deleted.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  .GB FILE CELL + UPLOAD (generic)
// ══════════════════════════════════════════════════════════════════════════════

function _dnaGbCell(apiType, item, filePrefix) {
  // apiType: 'primer', 'plasmid', 'gblock', 'kit-part'
  // filePrefix: override for file storage (e.g. 'kitpart')
  var plural = apiType + 's';
  if (apiType === 'kit-part') plural = 'kit-parts';
  if (item.gb_file) {
    return '<a href="/api/' + plural + '/' + item.id + '/gb" class="dna-gb-link" title="Download ' + esc(item.gb_file) + '">\u2b07 ' + esc(item.gb_file) + '</a>' +
           ' <span class="dna-del" onclick="_dnaRemoveGb(\x27' + apiType + '\x27,' + item.id + ')" title="Remove .gb">\u00d7</span>';
  }
  return '<label class="dna-gb-upload" title="Attach .gb file">\uD83D\uDCCE' +
         '<input type="file" accept=".gb,.gbk,.genbank" style="display:none" onchange="_dnaUploadGb(\x27' + apiType + '\x27,' + item.id + ',this)">' +
         '</label>';
}

async function _dnaUploadGb(type, id, input) {
  if (!input.files.length) return;
  var plural = type + 's';
  if (type === 'kit-part') plural = 'kit-parts';
  var fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    var resp = await fetch('/api/' + plural + '/' + id + '/gb', { method: 'POST', body: fd });
    if (!resp.ok) { var e = await resp.json().catch(function(){return {};}); toast(e.detail || 'Upload failed'); return; }
    var result = await resp.json();
    if (type === 'plasmid' && result.antibiotic_resistance) {
      toast('.gb file attached \u2014 resistance detected: ' + result.antibiotic_resistance);
    } else {
      toast('.gb file attached.');
    }
    _dnaRefresh();
  } catch(e) { toast('Upload error: ' + e.message); }
}

async function _dnaRemoveGb(type, id) {
  if (!confirm('Remove .gb file?')) return;
  var plural = type + 's';
  if (type === 'kit-part') plural = 'kit-parts';
  try { await api('DELETE', '/api/' + plural + '/' + id + '/gb'); toast('Removed.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
}

// Helper: upload .gb file after creating a new item
async function _dnaUploadGbForNew(endpoint, id, fileInput) {
  var fd = new FormData();
  fd.append('file', fileInput.files[0]);
  try {
    var resp = await fetch('/api/' + endpoint + '/' + id + '/gb', { method: 'POST', body: fd });
    if (!resp.ok) {
      var e = await resp.json().catch(function() { return {}; });
      toast('.gb upload failed: ' + (e.detail || 'unknown error'), true);
    }
  } catch(e) { toast('.gb upload error: ' + e.message, true); }
}

// Helper: show selected filename next to file input
function _dnaFormFileLabel(input, labelId) {
  var el = document.getElementById(labelId);
  if (!el) return;
  if (input.files.length) {
    el.textContent = input.files[0].name;
  } else {
    el.textContent = '';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SEQUENCE CASE EDITOR (overhang / annealing)
// ══════════════════════════════════════════════════════════════════════════════

function _dnaEditSeq(id) {
  var primer = null;
  for (var i = 0; i < _dna.primers.length; i++) {
    if (_dna.primers[i].id === id) { primer = _dna.primers[i]; break; }
  }
  if (!primer) return;

  var ov = document.getElementById('dna-import-overlay');
  if (!ov) return;

  var html =
    '<div class="dna-modal" style="max-width:540px">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<h3 style="margin:0">Edit Sequence \u2014 ' + esc(primer.name) + '</h3>' +
        '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>' +
      '</div>' +
      '<p class="muted" style="font-size:.82rem;margin:.4rem 0 .8rem">' +
        'Select bases then click a button. <strong>UPPERCASE</strong> = annealing region, ' +
        '<span style="color:#c0a88a">lowercase</span> = overhang (ignored for Tm calculation).' +
      '</p>' +
      '<textarea id="dna-seq-editor" class="dna-seq-textarea" spellcheck="false">' + esc(primer.sequence || '') + '</textarea>' +
      '<div style="display:flex;gap:.5rem;margin-top:.6rem;flex-wrap:wrap">' +
        '<button class="btn btn-sm" onclick="_dnaSeqSetCase(false)" style="background:#c0a88a;color:#fff">Make Overhang</button>' +
        '<button class="btn btn-sm" onclick="_dnaSeqSetCase(true)" style="background:#5b7a5e;color:#fff">Make Annealing</button>' +
        '<button class="btn btn-sm" onclick="_dnaSeqAllUpper()">All Annealing</button>' +
        '<button class="btn btn-sm" onclick="_dnaSeqAllLower()">All Overhang</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" onclick="_dnaSeqSave(' + id + ')" style="background:#4a4139;color:#fff">Save</button>' +
      '</div>' +
      '<div id="dna-seq-preview" style="margin-top:.8rem"></div>' +
    '</div>';

  ov.innerHTML = html;
  ov.style.display = '';

  _dnaSeqUpdatePreview();
  document.getElementById('dna-seq-editor').addEventListener('input', _dnaSeqUpdatePreview);
}

function _dnaCloseOverlay() {
  var ov = document.getElementById('dna-import-overlay');
  if (ov) { ov.innerHTML = ''; ov.style.display = 'none'; }
}

function _dnaSeqSetCase(upper) {
  var ta = document.getElementById('dna-seq-editor');
  if (!ta) return;
  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  if (start === end) { toast('Select some bases first.'); return; }
  var before = ta.value.slice(0, start);
  var selected = ta.value.slice(start, end);
  var after = ta.value.slice(end);
  ta.value = before + (upper ? selected.toUpperCase() : selected.toLowerCase()) + after;
  ta.setSelectionRange(start, end);
  ta.focus();
  _dnaSeqUpdatePreview();
}

function _dnaSeqAllUpper() {
  var ta = document.getElementById('dna-seq-editor');
  if (!ta) return;
  ta.value = ta.value.toUpperCase();
  _dnaSeqUpdatePreview();
}

function _dnaSeqAllLower() {
  var ta = document.getElementById('dna-seq-editor');
  if (!ta) return;
  ta.value = ta.value.toLowerCase();
  _dnaSeqUpdatePreview();
}

function _dnaSeqUpdatePreview() {
  var ta = document.getElementById('dna-seq-editor');
  var prev = document.getElementById('dna-seq-preview');
  if (!ta || !prev) return;
  var seq = ta.value;
  var anneal = seq.replace(/[^ACGT]/g, '');
  var over = seq.replace(/[^acgt]/g, '');
  var total = anneal.length + over.length;
  var gc = anneal.length ? (anneal.replace(/[^GC]/g, '').length / anneal.length * 100).toFixed(1) : '0.0';
  var styled = '';
  for (var i = 0; i < seq.length; i++) {
    var c = seq[i];
    if (!'ACGTacgt'.includes(c)) continue;
    if (c === c.toLowerCase() && c !== c.toUpperCase()) {
      styled += '<span style="color:#c0a88a">' + esc(c) + '</span>';
    } else {
      styled += '<strong>' + esc(c) + '</strong>';
    }
  }
  prev.innerHTML =
    '<div class="dna-section-hdr" style="margin-top:0">PREVIEW</div>' +
    '<code style="font-family:' + "'SF Mono'" + ',Monaco,Consolas,monospace;font-size:.85rem;word-break:break-all;line-height:1.6">' + styled + '</code>' +
    '<div class="muted" style="font-size:.78rem;margin-top:.4rem">' +
      total + ' bp total \u00b7 ' + anneal.length + ' bp annealing \u00b7 ' + over.length + ' bp overhang \u00b7 ' + gc + '% GC (annealing)' +
    '</div>';
}

async function _dnaSeqSave(id) {
  var ta = document.getElementById('dna-seq-editor');
  if (!ta) return;
  try {
    await api('PUT', '/api/primers/' + id, { sequence: ta.value });
    toast('Sequence updated.');
    _dnaCloseOverlay();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  IMPORT MODAL — extended for all 4 types
// ══════════════════════════════════════════════════════════════════════════════

function _dnaShowImport() {
  _dna.importState = {};
  var ov = document.getElementById('dna-import-overlay');
  if (ov) { ov.innerHTML = _dnaImportModal(); ov.style.display = ''; }
}

function _dnaImportModal() {
  return (
    '<div class="dna-modal">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<h3 style="margin:0">Import from File</h3>' +
        '<span class="dna-del" onclick="_dnaCloseOverlay()" style="font-size:1.4rem">\u00d7</span>' +
      '</div>' +
      '<p class="muted" style="margin:.6rem 0 1rem">Upload a .csv, .tsv, or .xlsx file and map its columns.</p>' +
      '<div id="dna-import-body">' + _dnaImportUploadStep() + '</div>' +
    '</div>'
  );
}

function _dnaImportUploadStep() {
  return '<div><input type="file" id="dna-import-file" accept=".csv,.tsv,.xlsx,.xls"> ' +
         '<button class="btn btn-sm" onclick="_dnaImportUpload()">Upload &amp; Preview</button></div>';
}

async function _dnaImportUpload() {
  var input = document.getElementById('dna-import-file');
  if (!input || !input.files.length) { toast('Select a file first.'); return; }
  var fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    var resp = await fetch('/api/import/upload', { method: 'POST', body: fd });
    if (!resp.ok) { var e = {}; try{e=await resp.json();}catch(x){} toast(e.detail||'Upload failed'); return; }
    _dna.importState = await resp.json();
    _dnaImportShowMapping();
  } catch(e) { toast('Upload error: ' + e.message); }
}

function _buildOpts(headers, selectedIdx) {
  var html = '<option value="-1">\u2014 skip \u2014</option>';
  for (var i = 0; i < headers.length; i++) {
    html += '<option value="' + i + '"' + (i === selectedIdx ? ' selected' : '') + '>' + esc(headers[i]) + '</option>';
  }
  return html;
}

function _guessCol(headers, patterns) {
  for (var j = 0; j < headers.length; j++) {
    var lc = (headers[j] || '').toLowerCase();
    for (var p = 0; p < patterns.length; p++) { if (lc.indexOf(patterns[p]) !== -1) return j; }
  }
  return -1;
}

function _dnaImportShowMapping() {
  var s = _dna.importState, h = s.headers || [];
  var gName = _guessCol(h, ['name']);
  var gSeq  = _guessCol(h, ['seq']);
  var gUse  = _guessCol(h, ['use', 'purpose', 'application', 'note']);
  var gBox  = _guessCol(h, ['box']);
  var gGly  = _guessCol(h, ['glycerol', 'gly']);
  var gProj = _guessCol(h, ['project', 'proj']);
  var gKit  = _guessCol(h, ['kit']);
  var gType = _guessCol(h, ['type', 'part_type']);
  var gDesc = _guessCol(h, ['desc']);
  var gRes  = _guessCol(h, ['resist']);
  var gSupp = _guessCol(h, ['supplier', 'vendor']);
  var gOrd  = _guessCol(h, ['order']);
  var gNotes = _guessCol(h, ['note']);
  var gUrl  = _guessCol(h, ['url', 'link', 'source']);

  var html = '<div class="dna-section-hdr" style="margin-top:0">COLUMN MAPPING \u2014 ' + esc(s.filename) + '</div>';

  html += '<div style="margin-bottom:1rem"><label>Import as <select id="dna-imp-type" onchange="_dnaImpTypeChanged()">' +
          '<option value="primer">Primers</option><option value="plasmid">Plasmids</option>' +
          '<option value="gblock">gBlocks</option><option value="kit_part">Kit Parts</option>' +
          '<option value="part">Parts</option></select></label></div>';

  // Primer columns
  html += '<div id="dna-imp-cols-primer" class="dna-col-grid">';
  html += '<label>Name<select id="dna-imp-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Sequence<select id="dna-imp-seq">' + _buildOpts(h, gSeq) + '</select></label>';
  html += '<label>Use<select id="dna-imp-use">' + _buildOpts(h, gUse) + '</select></label>';
  html += '<label>Box #<select id="dna-imp-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Project<select id="dna-imp-proj">' + _buildOpts(h, gProj) + '</select></label>';
  html += '</div>';

  // Plasmid columns
  html += '<div id="dna-imp-cols-plasmid" class="dna-col-grid" style="display:none">';
  html += '<label>Name<select id="dna-imp-pl-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Use<select id="dna-imp-pl-use">' + _buildOpts(h, gUse) + '</select></label>';
  html += '<label>Box Location<select id="dna-imp-pl-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Glycerol<select id="dna-imp-pl-gly">' + _buildOpts(h, gGly) + '</select></label>';
  html += '<label>Project<select id="dna-imp-pl-proj">' + _buildOpts(h, gProj) + '</select></label>';
  html += '</div>';

  // gBlock columns
  html += '<div id="dna-imp-cols-gblock" class="dna-col-grid" style="display:none">';
  html += '<label>Name<select id="dna-imp-gb-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Sequence<select id="dna-imp-gb-seq">' + _buildOpts(h, gSeq) + '</select></label>';
  html += '<label>Use<select id="dna-imp-gb-use">' + _buildOpts(h, gUse) + '</select></label>';
  html += '<label>Supplier<select id="dna-imp-gb-supp">' + _buildOpts(h, gSupp) + '</select></label>';
  html += '<label>Order ID<select id="dna-imp-gb-ord">' + _buildOpts(h, gOrd) + '</select></label>';
  html += '<label>Box #<select id="dna-imp-gb-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Project<select id="dna-imp-gb-proj">' + _buildOpts(h, gProj) + '</select></label>';
  html += '<label>Notes<select id="dna-imp-gb-notes">' + _buildOpts(h, gNotes) + '</select></label>';
  html += '</div>';

  // Kit Part columns
  html += '<div id="dna-imp-cols-kit_part" class="dna-col-grid" style="display:none">';
  html += '<label>Name<select id="dna-imp-kp-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Kit<select id="dna-imp-kp-kit">' + _buildOpts(h, gKit) + '</select></label>';
  html += '<label>Part Type<select id="dna-imp-kp-type">' + _buildOpts(h, gType) + '</select></label>';
  html += '<label>Description<select id="dna-imp-kp-desc">' + _buildOpts(h, gDesc) + '</select></label>';
  html += '<label>Resistance<select id="dna-imp-kp-resist">' + _buildOpts(h, gRes) + '</select></label>';
  html += '<label>Box<select id="dna-imp-kp-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Glycerol<select id="dna-imp-kp-gly">' + _buildOpts(h, gGly) + '</select></label>';
  html += '<label>Source URL<select id="dna-imp-kp-url">' + _buildOpts(h, gUrl) + '</select></label>';
  html += '<label>Project<select id="dna-imp-kp-proj">' + _buildOpts(h, gProj) + '</select></label>';
  html += '<label>Notes<select id="dna-imp-kp-notes">' + _buildOpts(h, gNotes) + '</select></label>';
  html += '</div>';

  // Part columns
  html += '<div id="dna-imp-cols-part" class="dna-col-grid" style="display:none">';
  html += '<label>Name<select id="dna-imp-pt-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Description<select id="dna-imp-pt-desc">' + _buildOpts(h, gDesc) + '</select></label>';
  html += '<label>Sequence<select id="dna-imp-pt-seq">' + _buildOpts(h, gSeq) + '</select></label>';
  html += '<label>Part Type<select id="dna-imp-pt-type">' + _buildOpts(h, gType) + '</select></label>';
  html += '<label>Box<select id="dna-imp-pt-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Glycerol<select id="dna-imp-pt-gly">' + _buildOpts(h, gGly) + '</select></label>';
  html += '<label>Project<select id="dna-imp-pt-proj">' + _buildOpts(h, gProj) + '</select></label>';
  html += '<label>Notes<select id="dna-imp-pt-notes">' + _buildOpts(h, gNotes) + '</select></label>';
  html += '</div>';

  html += _dnaImportPreview(h, s.preview || []);
  html += '<div style="margin-top:1rem;display:flex;gap:.5rem">';
  html += '<button class="btn btn-sm" style="background:#5b7a5e;color:#fff" onclick="_dnaImportExecute()">Import</button>';
  html += '<button class="btn btn-sm" onclick="_dnaCloseOverlay()">Cancel</button></div>';

  var body = document.getElementById('dna-import-body');
  if (body) body.innerHTML = html;
}

function _dnaImpTypeChanged() {
  var t = document.getElementById('dna-imp-type').value;
  var types = ['primer', 'plasmid', 'gblock', 'kit_part', 'part'];
  types.forEach(function(ty) {
    var el = document.getElementById('dna-imp-cols-' + ty);
    if (el) el.style.display = (ty === t) ? '' : 'none';
  });
}

function _dnaImportPreview(headers, rows) {
  if (!rows.length) return '<p class="muted">No data rows in file.</p>';
  var html = '<div style="overflow-x:auto;margin-top:.8rem"><table class="dna-table"><thead><tr>';
  for (var i = 0; i < headers.length; i++) html += '<th>' + esc(headers[i]) + '</th>';
  html += '</tr></thead><tbody>';
  for (var r = 0; r < rows.length; r++) {
    html += '<tr>';
    for (var c = 0; c < headers.length; c++) {
      var v = (rows[r] && rows[r][c] != null) ? String(rows[r][c]) : '';
      html += '<td>' + esc(v) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += '<p class="muted" style="font-size:.8rem">Preview: first ' + rows.length + ' row(s)</p>';
  return html;
}

function _impVal(id) {
  var v = parseInt((document.getElementById(id) || {}).value, 10);
  return isNaN(v) || v < 0 ? null : v;
}

async function _dnaImportExecute() {
  var s = _dna.importState;
  var recType = document.getElementById('dna-imp-type').value;
  var body = { temp_id: s.temp_id, ext: s.ext, filename: s.filename, record_type: recType };

  if (recType === 'primer') {
    body.col_name = _impVal('dna-imp-name');
    body.col_sequence = _impVal('dna-imp-seq');
    body.col_use = _impVal('dna-imp-use');
    body.col_box_number = _impVal('dna-imp-box');
    body.col_project = _impVal('dna-imp-proj');
    if (body.col_name === null) { toast('Please select a Name column.'); return; }
  } else if (recType === 'plasmid') {
    body.col_name = _impVal('dna-imp-pl-name');
    body.col_use = _impVal('dna-imp-pl-use');
    body.col_box_location = _impVal('dna-imp-pl-box');
    body.col_glycerol_location = _impVal('dna-imp-pl-gly');
    body.col_project = _impVal('dna-imp-pl-proj');
    if (body.col_name === null) { toast('Please select a Name column.'); return; }
  } else if (recType === 'gblock') {
    body.col_name = _impVal('dna-imp-gb-name');
    body.col_sequence = _impVal('dna-imp-gb-seq');
    body.col_use = _impVal('dna-imp-gb-use');
    body.col_supplier = _impVal('dna-imp-gb-supp');
    body.col_order_id = _impVal('dna-imp-gb-ord');
    body.col_box_number = _impVal('dna-imp-gb-box');
    body.col_project = _impVal('dna-imp-gb-proj');
    body.col_notes = _impVal('dna-imp-gb-notes');
    if (body.col_name === null) { toast('Please select a Name column.'); return; }
  } else if (recType === 'kit_part') {
    body.col_name = _impVal('dna-imp-kp-name');
    body.col_kit_name = _impVal('dna-imp-kp-kit');
    body.col_part_type = _impVal('dna-imp-kp-type');
    body.col_description = _impVal('dna-imp-kp-desc');
    body.col_resistance = _impVal('dna-imp-kp-resist');
    body.col_box_location = _impVal('dna-imp-kp-box');
    body.col_glycerol_location = _impVal('dna-imp-kp-gly');
    body.col_source_url = _impVal('dna-imp-kp-url');
    body.col_project = _impVal('dna-imp-kp-proj');
    body.col_notes = _impVal('dna-imp-kp-notes');
    if (body.col_name === null) { toast('Please select a Name column.'); return; }
  } else if (recType === 'part') {
    body.col_name = _impVal('dna-imp-pt-name');
    body.col_description = _impVal('dna-imp-pt-desc');
    body.col_sequence = _impVal('dna-imp-pt-seq');
    body.col_part_type = _impVal('dna-imp-pt-type');
    body.col_box_location = _impVal('dna-imp-pt-box');
    body.col_glycerol_location = _impVal('dna-imp-pt-gly');
    body.col_project = _impVal('dna-imp-pt-proj');
    body.col_notes = _impVal('dna-imp-pt-notes');
    if (body.col_name === null) { toast('Please select a Name column.'); return; }
  }

  try {
    var data = await api('POST', '/api/import/execute', body);
    toast(data.record_count + ' ' + data.record_type + '(s) imported.');
    _dnaCloseOverlay();
    var tabMap = { primer: 'primers', plasmid: 'plasmids', gblock: 'gblocks', kit_part: 'kitParts', part: 'parts' };
    _dna.tab = tabMap[data.record_type] || 'primers';
    _dnaRefresh();
  } catch(e) { toast('Import failed: ' + (e.message || 'Unknown error')); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO-LINKING ENGINE (all DNA types)
// ══════════════════════════════════════════════════════════════════════════════

function _dnaBuildRegex() {
  var patterns = [];

  // 1. Prefix-based patterns for primers/plasmids (e.g. MR5, pMR1)
  var pp = (_dna.settings.plasmid_prefix || '').trim();
  var pr = (_dna.settings.primer_prefix || '').trim();
  if (pp) patterns.push(_dnaEscRe(pp) + '\\d+');
  if (pr) patterns.push(_dnaEscRe(pr) + '\\d+');

  // 2. All named items (exact match) — skip names with spaces or too short
  _dna.nameLookup = {};
  var lists = [
    { arr: _dna.primers, type: 'primer' },
    { arr: _dna.plasmids, type: 'plasmid' },
    { arr: _dna.gblocks, type: 'gblock' },
    { arr: _dna.kitParts, type: 'kit_part' },
    { arr: _dna.parts, type: 'part' }
  ];
  var nameSet = {};
  lists.forEach(function(l) {
    l.arr.forEach(function(item) {
      var n = (item.name || '').trim();
      if (n.length >= 2 && n.indexOf(' ') === -1) {
        nameSet[n] = true;
      }
      // Always add to lookup (even names with spaces — for popover)
      if (n) _dna.nameLookup[n.toLowerCase()] = { type: l.type, item: item };
    });
  });

  // Sort by length descending so longer names match first
  var names = Object.keys(nameSet).sort(function(a, b) { return b.length - a.length; });
  names.forEach(function(n) { patterns.push(_dnaEscRe(n)); });

  if (!patterns.length) { _dna.linkRegex = null; return; }
  _dna.linkRegex = new RegExp('\\b(' + patterns.join('|') + ')\\b', 'g');
}

function _dnaEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _dnaLinkifyElement(el) {
  if (!_dna.linkRegex) return;
  if (el.dataset && el.dataset.dnaLinked) return;
  if (el.closest && (el.closest('.dna-manager') || el.closest('.dna-popover') || el.closest('.dna-modal'))) return;
  var tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'script' || tag === 'style' || tag === 'code') return;

  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: function(n) {
      var p = n.parentElement;
      if (!p) return NodeFilter.FILTER_ACCEPT;
      var pt = p.tagName.toLowerCase();
      if (pt === 'script' || pt === 'style' || pt === 'textarea' || pt === 'input' || pt === 'code') return NodeFilter.FILTER_REJECT;
      if (p.classList && p.classList.contains('dna-link')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  }, false);

  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(function(node) {
    var text = node.textContent;
    _dna.linkRegex.lastIndex = 0;
    if (!_dna.linkRegex.test(text)) return;
    _dna.linkRegex.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var lastIdx = 0;
    var match;
    while ((match = _dna.linkRegex.exec(text)) !== null) {
      if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      var a = document.createElement('a');
      a.className = 'dna-link';
      a.href = '#';
      a.dataset.dnaName = match[0];
      a.textContent = match[0];
      frag.appendChild(a);
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx > 0) {
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    }
  });

  if (el.dataset) el.dataset.dnaLinked = '1';
}

function _dnaLinkifyAll() {
  if (!_dna.linkRegex) return;
  var target = document.getElementById('main') || document.getElementById('content') || document.body;
  var candidates = target.querySelectorAll('.card, .entry, .entry-content, [class*="content"], p, div, td, li, span, h1, h2, h3, h4');
  for (var i = 0; i < candidates.length; i++) {
    _dnaLinkifyElement(candidates[i]);
  }
}

var _dnaObserver = null;

function _dnaStartObserver() {
  if (_dnaObserver) return;
  var target = document.getElementById('main') || document.getElementById('content') || document.body;
  _dnaObserver = new MutationObserver(function(mutations) {
    if (!_dna.linkRegex) return;
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) _dnaLinkifyElement(node);
      });
    });
  });
  _dnaObserver.observe(target, { childList: true, subtree: true });
  _dnaLinkifyAll();
}

var _dnaOrigSetView = null;

function _dnaHookSetView() {
  if (_dnaOrigSetView) return;
  if (typeof setView !== 'function') return;
  _dnaOrigSetView = setView;
  setView = function(name) {
    _dnaOrigSetView(name);
    setTimeout(_dnaLinkifyAll, 200);
    setTimeout(_dnaLinkifyAll, 800);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  POPOVER (all DNA types)
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('click', function(e) {
  var link = e.target.closest('.dna-link');
  if (!link) { _dnaClosePopover(); return; }
  e.preventDefault();
  e.stopPropagation();
  _dnaShowPopover(link);
});

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { _dnaClosePopover(); _dnaCloseOverlay(); } });

function _dnaShowPopover(linkEl) {
  var name = linkEl.dataset.dnaName;
  if (!name) return;

  // Look up in unified name map
  var lookup = (_dna.nameLookup || {})[name.toLowerCase()];
  var type = lookup ? lookup.type : null;
  var item = lookup ? lookup.item : null;

  var pop = document.getElementById('dna-popover');
  if (!pop) return;

  var html = '<div class="dna-pop-header">';
  html += '<strong>' + esc(name) + '</strong>';
  html += '<span class="dna-del" onclick="_dnaClosePopover()" style="font-size:1.1rem">\u00d7</span>';
  html += '</div>';

  if (!item) {
    html += '<div class="dna-pop-body"><span class="muted">Not found in database.</span></div>';
  } else {
    var typeLabels = { primer: 'PRIMER', plasmid: 'PLASMID', gblock: 'GBLOCK', kit_part: 'KIT PART', part: 'PART' };
    html += '<div class="dna-pop-body">';
    html += '<div class="dna-pop-type">' + (typeLabels[type] || type) + '</div>';
    // Common fields
    if (item.sequence) html += '<div class="dna-pop-row"><span class="dna-pop-label">Sequence</span><code class="dna-pop-seq">' + esc((item.sequence || '').substring(0, 60)) + (item.sequence.length > 60 ? '\u2026' : '') + '</code></div>';
    if (item.use || item.description) html += '<div class="dna-pop-row"><span class="dna-pop-label">Use</span>' + esc(item.use || item.description || '') + '</div>';
    if (item.project) html += '<div class="dna-pop-row"><span class="dna-pop-label">Project</span>' + esc(item.project) + (item.subcategory ? ' \u203A ' + esc(item.subcategory) : '') + '</div>';
    if (item.antibiotic_resistance) html += '<div class="dna-pop-row"><span class="dna-pop-label">Resistance</span>' + esc(item.antibiotic_resistance) + '</div>';
    if (item.resistance) html += '<div class="dna-pop-row"><span class="dna-pop-label">Resistance</span>' + esc(item.resistance) + '</div>';
    if (item.kit_name) html += '<div class="dna-pop-row"><span class="dna-pop-label">Kit</span>' + esc(item.kit_name) + '</div>';
    if (item.part_type) html += '<div class="dna-pop-row"><span class="dna-pop-label">Type</span>' + esc(item.part_type) + '</div>';
    if (item.box_number) html += '<div class="dna-pop-row"><span class="dna-pop-label">Box #</span>' + esc(item.box_number) + '</div>';
    if (item.box_location) html += '<div class="dna-pop-row"><span class="dna-pop-label">Box</span>' + esc(item.box_location) + '</div>';
    if (item.tm) html += '<div class="dna-pop-row"><span class="dna-pop-label">Tm</span>' + Number(item.tm).toFixed(1) + '\u00b0C</div>';
    if (item.length) html += '<div class="dna-pop-row"><span class="dna-pop-label">Length</span>' + item.length + ' bp</div>';
    // Box grid positions
    var boxPos = _dnaFindAllBoxPositions(type, item.id);
    if (boxPos.length) {
      html += '<div class="dna-pop-row"><span class="dna-pop-label">Grid</span>';
      boxPos.forEach(function(p) { html += '<span class="dna-box-pos-badge">' + esc(p.box_name) + ' ' + esc(p.cell) + '</span> '; });
      html += '</div>';
    }
    // .gb download
    var endpoints = { primer: 'primers', plasmid: 'plasmids', gblock: 'gblocks', kit_part: 'kit-parts', part: 'parts' };
    if (item.gb_file) html += '<div class="dna-pop-row"><a href="/api/' + (endpoints[type] || type + 's') + '/' + item.id + '/gb" class="dna-gb-link">\u2b07 ' + esc(item.gb_file) + '</a></div>';
    html += '</div>';

    // Footer with links
    html += '<div class="dna-pop-footer" style="display:flex;gap:.8rem">';
    html += '<a href="#" onclick="_dnaGoToManager(\x27' + esc(type || '') + '\x27);return false;">DNA Manager \u2192</a>';
    if (item.gb_file || item.sequence) {
      var cloningType = type === 'kit_part' ? 'kitpart' : type;
      html += '<a href="#" onclick="_dnaGoCloning(\x27' + cloningType + '\x27,' + item.id + ');_dnaClosePopover();return false;">View in Cloning \u2192</a>';
    }
    html += '</div>';
  }

  pop.innerHTML = html;
  var rect = linkEl.getBoundingClientRect();
  pop.style.display = '';
  var popW = pop.offsetWidth || 280;
  var popH = pop.offsetHeight || 200;
  var left = rect.left + window.scrollX;
  var top = rect.bottom + window.scrollY + 6;
  if (left + popW > window.innerWidth - 16) left = window.innerWidth - popW - 16;
  if (left < 8) left = 8;
  if (top + popH > window.innerHeight + window.scrollY - 16) top = rect.top + window.scrollY - popH - 6;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function _dnaClosePopover() {
  var pop = document.getElementById('dna-popover');
  if (pop) pop.style.display = 'none';
}

function _dnaFindByName(arr, name) {
  var lc = name.toLowerCase();
  for (var i = 0; i < arr.length; i++) {
    if ((arr[i].name || '').toLowerCase() === lc) return arr[i];
  }
  return null;
}

function _dnaGoToManager(type) {
  _dnaClosePopover();
  var tabMap = { primer: 'primers', plasmid: 'plasmids', gblock: 'gblocks', kit_part: 'kitParts', part: 'parts' };
  _dna.tab = tabMap[type] || 'primers';
  if (typeof setView === 'function') setView('import_data');
}

// ══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════════════════════════════════════

function _dnaStyles() {
  return '<style>' +
    '.dna-manager { }' +
    '.dna-tabs { display:flex; gap:0; margin-bottom:0; border-bottom:1px solid #d5cec0; flex-wrap:wrap; }' +
    '.dna-tab { padding:.55rem 1rem; cursor:pointer; font-size:.88rem; color:#8a7f72; border-bottom:2px solid transparent; transition:all .15s; white-space:nowrap; }' +
    '.dna-tab:hover { color:#5a5148; }' +
    '.dna-tab.active { color:#4a4139; border-bottom-color:#8a7f72; font-weight:600; }' +
    '.dna-tab small { font-weight:400; }' +
    '.dna-section-hdr { font-size:.72rem; letter-spacing:.12em; color:#8a7f72; text-transform:uppercase; padding:.6rem 0 .5rem; margin-top:.8rem; border-bottom:1px solid #d5cec0; margin-bottom:.6rem; }' +
    '.dna-table-wrap { overflow-x:auto; margin-bottom:.5rem; }' +
    '.dna-table { width:100%; border-collapse:collapse; font-size:.86rem; }' +
    '.dna-table th { text-align:left; padding:.45rem .5rem; color:#8a7f72; font-weight:500; font-size:.76rem; letter-spacing:.05em; text-transform:uppercase; border-bottom:1px solid #d5cec0; }' +
    '.dna-table td { padding:.45rem .5rem; border-bottom:1px solid #e8e2d8; color:#4a4139; }' +
    '.dna-table tr:hover td { background:#f5f1eb; }' +
    '.dna-cell-name { font-weight:600; white-space:nowrap; }' +
    '.dna-editable { cursor:pointer; border-bottom:1px dashed #d5cec0; }' +
    '.dna-editable:hover { color:#5b7a5e; border-bottom-color:#5b7a5e; }' +
    '.dna-edit-form { display:flex; flex-direction:column; gap:.6rem; margin-top:1rem; }' +
    '.dna-edit-label { display:flex; flex-direction:column; font-size:.82rem; color:#8a7f72; gap:.2rem; flex:1; min-width:120px; }' +
    '.dna-cell-seq code { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.82rem; color:#6b614f; background:#f0ebe3; padding:.1rem .3rem; border-radius:3px; }' +
    '.dna-empty { color:#a89e90; padding:2rem 1rem; text-align:center; font-style:italic; }' +
    '.dna-add-row { display:flex; gap:.4rem; align-items:center; margin-top:.6rem; padding-top:.6rem; border-top:1px solid #e8e2d8; }' +
    '.dna-input { padding:.35rem .5rem; border:1px solid #d5cec0; border-radius:4px; font-size:.85rem; background:#faf8f4; color:#4a4139; }' +
    '.dna-input:focus { outline:none; border-color:#8a7f72; }' +
    '.dna-del { cursor:pointer; color:#b09e8e; font-size:1.1rem; line-height:1; }' +
    '.dna-del:hover { color:#c0392b; }' +
    '.dna-setting-label { display:flex; flex-direction:column; font-size:.82rem; color:#8a7f72; gap:.2rem; }' +

    /* project badge */
    '.dna-project-badge { display:inline-block; font-size:.74rem; padding:.12rem .4rem; background:#e8e2d8; color:#5a5148; border-radius:3px; font-weight:500; white-space:nowrap; }' +
    '.dna-sub-sep { color:#b09e8e; margin:0 .1rem; }' +

    /* active toggle button */
    '.dna-btn-active { background:#5b7a5e !important; color:#fff !important; border-color:#5b7a5e !important; }' +

    /* group rows */
    '.dna-group-row td { background:#f0ebe3; padding:.4rem .6rem; border-bottom:1px solid #d5cec0; }' +
    '.dna-group-label { font-size:.78rem; font-weight:600; color:#5a5148; letter-spacing:.04em; }' +

    /* move section */
    '.dna-move-section { margin-top:.8rem; padding-top:.8rem; border-top:1px solid #e8e2d8; display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }' +
    '.dna-move-btn { font-size:.76rem !important; padding:.2rem .5rem !important; }' +

    /* type badge for kit parts */
    '.dna-type-badge { display:inline-block; font-size:.74rem; padding:.12rem .4rem; background:#ede8f5; color:#6b5a8e; border-radius:3px; font-weight:500; white-space:nowrap; }' +

    /* filter chips */
    '.dna-chip { display:inline-block; font-size:.76rem; padding:.2rem .5rem; background:#f0ebe3; color:#6b614f; border:1px solid #d5cec0; border-radius:12px; cursor:pointer; transition:all .15s; }' +
    '.dna-chip:hover { background:#e8e2d8; }' +
    '.dna-chip.active { background:#5b7a5e; color:#fff; border-color:#5b7a5e; }' +
    '.dna-chip-type { background:#ede8f5; border-color:#d4cee8; color:#6b5a8e; }' +
    '.dna-chip-type.active { background:#7b6a9e; border-color:#7b6a9e; color:#fff; }' +
    '.dna-chip-clear { background:transparent; border-color:#c0392b; color:#c0392b; font-size:.74rem; }' +
    '.dna-chip-clear:hover { background:#c0392b; color:#fff; }' +

    /* cross-link icons */
    '.dna-xlink { cursor:pointer; font-size:.95rem; margin-right:.2rem; opacity:.7; transition:opacity .15s; }' +
    '.dna-xlink:hover { opacity:1; }' +

    /* external link */
    '.dna-ext-link { color:#5b7a5e; text-decoration:none; font-size:.8rem; }' +
    '.dna-ext-link:hover { text-decoration:underline; }' +

    /* back link */
    '.dna-back-link { cursor:pointer; color:#5b7a5e; font-size:.88rem; }' +
    '.dna-back-link:hover { text-decoration:underline; }' +

    /* search bar */
    '.dna-search-bar { display:flex; align-items:center; justify-content:space-between; gap:.8rem; margin-bottom:.5rem; }' +

    /* bulk action bar */
    '.dna-bulk-bar { display:flex; align-items:center; gap:.5rem; padding:.5rem .7rem; margin-bottom:.5rem; background:#fef3e2; border:1px solid #f0d9a8; border-radius:4px; font-size:.8rem; color:#6b5a2e; flex-wrap:wrap; }' +
    '.dna-bulk-count { font-weight:600; white-space:nowrap; }' +
    '.dna-bulk-group { display:flex; align-items:center; gap:.2rem; }' +
    '.dna-bulk-select { font-size:.76rem !important; padding:.2rem .3rem !important; max-width:140px; }' +
    '.dna-bulk-apply { font-size:.72rem !important; padding:.18rem .4rem !important; background:#6b5a2e; color:#fff; border-color:#6b5a2e; }' +
    '.dna-bulk-apply:hover { background:#5a4a1e; }' +
    '.dna-search-count { font-size:.8rem; color:#8a7f72; white-space:nowrap; }' +
    '.dna-search-input-wrap { position:relative; }' +
    '.dna-search-input { width:14rem; padding-right:1.6rem !important; }' +
    '.dna-search-clear { position:absolute; right:.4rem; top:50%; transform:translateY(-50%); cursor:pointer; color:#b09e8e; font-size:1rem; line-height:1; }' +
    '.dna-search-clear:hover { color:#c0392b; }' +

    /* sortable headers */
    '.dna-th-sort { cursor:pointer; user-select:none; white-space:nowrap; }' +
    '.dna-th-sort:hover { color:#4a4139; }' +
    '.dna-sort-arrow { font-size:.65rem; vertical-align:middle; margin-left:.15rem; }' +
    '.dna-sort-neutral { color:#ccc5b8; }' +

    /* resistance badges */
    '.dna-resist-badge { display:inline-block; font-size:.75rem; padding:.15rem .45rem; background:#e8f0e8; color:#3d5a3f; border:1px solid #b8cfb8; border-radius:3px; font-weight:500; letter-spacing:.02em; white-space:nowrap; }' +

    /* .gb */
    '.dna-gb-link { color:#5b7a5e; font-size:.82rem; text-decoration:none; white-space:nowrap; }' +
    '.dna-gb-link:hover { text-decoration:underline; }' +
    '.dna-gb-upload { cursor:pointer; color:#b09e8e; font-size:.95rem; }' +
    '.dna-gb-upload:hover { color:#5b7a5e; }' +
    '.dna-gb-upload-label { cursor:pointer; }' +
    '.dna-gb-upload-btn { display:inline-block; padding:.3rem .6rem; border:1px dashed #b8cfb8; border-radius:4px; font-size:.82rem; color:#5b7a5e; transition:all .15s; }' +
    '.dna-gb-upload-btn:hover { background:#eef4ee; border-style:solid; }' +

    /* sequence editor */
    '.dna-seq-textarea { width:100%; min-height:80px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.88rem; padding:.5rem; border:1px solid #d5cec0; border-radius:4px; background:#faf8f4; color:#4a4139; resize:vertical; letter-spacing:.05em; line-height:1.5; }' +
    '.dna-seq-textarea:focus { outline:none; border-color:#8a7f72; }' +

    /* overlay + modal */
    '#dna-import-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; z-index:999; }' +
    '.dna-modal { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; padding:1.5rem 2rem; max-width:720px; width:90vw; max-height:85vh; overflow-y:auto; box-shadow:0 8px 30px rgba(60,52,42,.18); }' +
    '.dna-col-grid { display:flex; flex-wrap:wrap; gap:.8rem; margin-bottom:.5rem; }' +
    '.dna-col-grid label { display:flex; flex-direction:column; font-size:.82rem; color:#8a7f72; gap:.2rem; }' +
    '.dna-col-grid select { padding:.3rem .4rem; border:1px solid #d5cec0; border-radius:4px; font-size:.85rem; background:#fff; color:#4a4139; }' +

    /* auto-link */
    'a.dna-link { color:#5b7a5e; text-decoration:none; border-bottom:1px dashed #5b7a5e; cursor:pointer; font-weight:500; }' +
    'a.dna-link:hover { color:#3d5a3f; border-bottom-style:solid; }' +

    /* popover */
    '.dna-popover { position:absolute; z-index:1000; background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; box-shadow:0 6px 24px rgba(60,52,42,.18); width:280px; font-size:.88rem; }' +
    '.dna-pop-header { display:flex; justify-content:space-between; align-items:center; padding:.7rem 1rem; border-bottom:1px solid #e8e2d8; }' +
    '.dna-pop-body { padding:.7rem 1rem; }' +
    '.dna-pop-type { font-size:.7rem; letter-spacing:.1em; text-transform:uppercase; color:#8a7f72; margin-bottom:.4rem; }' +
    '.dna-pop-row { margin-bottom:.35rem; color:#4a4139; }' +
    '.dna-pop-label { color:#8a7f72; font-size:.78rem; margin-right:.4rem; }' +
    '.dna-pop-seq { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.78rem; color:#6b614f; background:#f0ebe3; padding:.1rem .3rem; border-radius:3px; word-break:break-all; }' +
    '.dna-pop-footer { padding:.5rem 1rem; border-top:1px solid #e8e2d8; }' +
    '.dna-pop-footer a { color:#5b7a5e; text-decoration:none; font-size:.82rem; }' +
    '.dna-pop-footer a:hover { text-decoration:underline; }' +

    /* box grid */
    '.dna-box-grid-wrap { overflow-x:auto; }' +
    '.dna-box-grid { border-collapse:collapse; }' +
    '.dna-box-grid th { font-size:.72rem; color:#8a7f72; padding:.2rem .1rem; text-align:center; min-width:3.2rem; }' +
    '.dna-box-row-label { font-size:.72rem; color:#8a7f72; font-weight:600; padding:.2rem .4rem; text-align:center; }' +
    '.dna-box-cell { width:3.2rem; height:2.6rem; text-align:center; vertical-align:middle; border:1px solid #e8e2d8; cursor:pointer; transition:background .15s; font-size:.7rem; }' +
    '.dna-box-cell.empty { background:#f8f6f2; }' +
    '.dna-box-cell.empty:hover { background:#ede8df; }' +
    '.dna-box-cell.occupied:hover { filter:brightness(.95); }' +
    '.dna-box-cell-name { font-weight:600; font-size:.68rem; line-height:1.1; word-break:break-all; }' +
    '.dna-box-primer { background:#d6eaf8; color:#2e6da0; }' +
    '.dna-box-plasmid { background:#d5f5d5; color:#2d6a30; }' +
    '.dna-box-gblock { background:#fde8c8; color:#8a6a2e; }' +
    '.dna-box-kit_part { background:#e8ddf5; color:#5a3d8a; }' +
    '.dna-box-part { background:#f5e0d0; color:#8a5a3d; }' +
    '.dna-box-mixed { background:#e8e2d8; color:#5a5148; }' +

    /* box assign list */
    '.dna-box-assign-item { padding:.4rem .6rem; cursor:pointer; border-bottom:1px solid #e8e2d8; transition:background .1s; }' +
    '.dna-box-assign-item:hover { background:#f5f1eb; }' +

    /* box position badges in tables */
    '.dna-box-pos-badge { display:inline-block; font-size:.68rem; padding:.1rem .3rem; background:#e8e2d8; color:#5a5148; border-radius:2px; margin-right:.2rem; font-family:"SF Mono",Monaco,Consolas,monospace; }' +

    /* stock status dots */
    '.dna-stock-dot { cursor:pointer; font-size:1rem; margin-right:.15rem; transition:transform .1s; display:inline-block; line-height:1; }' +
    '.dna-stock-dot:hover { transform:scale(1.3); }' +
    '.dna-stock-edit-label { display:flex; flex-direction:column; font-size:.78rem; color:#8a7f72; gap:.15rem; }' +
  '</style>';
}

// ══════════════════════════════════════════════════════════════════════════════
//  INIT — deferred to avoid calling api() before core.js loads
// ══════════════════════════════════════════════════════════════════════════════

function _dnaInitLinking() {
  if (typeof api !== 'function') return;
  Promise.all([
    api('GET', '/api/dna/settings').catch(function() { return {}; }),
    api('GET', '/api/primers').catch(function() { return {items:[]}; }),
    api('GET', '/api/plasmids').catch(function() { return {items:[]}; }),
    api('GET', '/api/gblocks').catch(function() { return {items:[]}; }),
    api('GET', '/api/kit-parts').catch(function() { return {items:[]}; }),
    api('GET', '/api/parts').catch(function() { return {items:[]}; })
  ]).then(function(results) {
    _dna.settings = results[0] || {};
    _dna.primers = (results[1] && results[1].items) || [];
    _dna.plasmids = (results[2] && results[2].items) || [];
    _dna.gblocks = (results[3] && results[3].items) || [];
    _dna.kitParts = (results[4] && results[4].items) || [];
    _dna.parts = (results[5] && results[5].items) || [];
    _dnaBuildRegex();
    _dnaStartObserver();
    _dnaHookSetView();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _dnaInitLinking);
} else {
  setTimeout(_dnaInitLinking, 0);
}

// Register with core
registerView('import_data', renderDnaManager);
