// DNA Manager feature — primers, plasmids, .gb files, auto-linking, sequence editor

var _dna = {
  tab: 'primers', primers: [], plasmids: [],
  importState: {},
  settings: { primer_prefix: '', plasmid_prefix: '' },
  linkRegex: null,
  showSettings: false,
  search: { primers: '', plasmids: '' },
  sort: {
    primers: { col: 'name', dir: 'asc' },
    plasmids: { col: 'name', dir: 'asc' }
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  SORTING & FILTERING HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _dnaFilterItems(items, query, fields) {
  if (!query) return items;
  var lc = query.toLowerCase();
  return items.filter(function(item) {
    for (var i = 0; i < fields.length; i++) {
      var val = (item[fields[i]] || '').toLowerCase();
      if (val.indexOf(lc) !== -1) return true;
    }
    return false;
  });
}

function _dnaSortItems(items, col, dir) {
  var sorted = items.slice();
  sorted.sort(function(a, b) {
    var va = (a[col] || '').toLowerCase();
    var vb = (b[col] || '').toLowerCase();
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
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
  wrap.innerHTML = (_dna.tab === 'primers') ? _dnaPrimerTable() : _dnaPlasmidTable();
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
  html += '<button class="btn" onclick="_dnaToggleSettings()" style="font-size:.85rem">\u2699 Settings</button>';
  html += '<button class="btn" onclick="_dnaShowImport()" style="font-size:.85rem">Import CSV / Excel</button>';
  html += '</div></div>';

  // settings panel
  html += '<div id="dna-settings-panel" style="display:' + (_dna.showSettings ? '' : 'none') + '">';
  html += _dnaSettingsPanel();
  html += '</div>';

  // tabs
  html += '<div class="dna-tabs">';
  html += '<span class="dna-tab' + (_dna.tab === 'primers' ? ' active' : '') + '" onclick="_dnaSetTab(\x27primers\x27)">Primers <small class="muted">(' + _dna.primers.length + ')</small></span>';
  html += '<span class="dna-tab' + (_dna.tab === 'plasmids' ? ' active' : '') + '" onclick="_dnaSetTab(\x27plasmids\x27)">Plasmids <small class="muted">(' + _dna.plasmids.length + ')</small></span>';
  html += '</div>';

  html += '<div id="dna-table-area">';
  html += (_dna.tab === 'primers') ? _dnaPrimerTable() : _dnaPlasmidTable();
  html += '</div>';

  html += '</div>';

  // import modal (hidden)
  html += '<div id="dna-import-overlay" style="display:none">' + _dnaImportModal() + '</div>';

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
  try { _dna.settings = await api('GET', '/api/dna/settings'); } catch(e) {}
  _dnaBuildRegex();
}

function _dnaSetTab(t) { _dna.tab = t; _dnaRefresh(); }

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
//  SEARCH BAR
// ══════════════════════════════════════════════════════════════════════════════

function _dnaSearchBar(tab, totalCount, filteredCount) {
  var query = _dna.search[tab] || '';
  var countLabel = '';
  if (query && filteredCount !== totalCount) {
    countLabel = filteredCount + ' of ' + totalCount + ' items';
  } else {
    countLabel = totalCount + ' items';
  }
  var html = '<div class="dna-search-bar">';
  html += '<span class="dna-search-count">' + esc(countLabel) + '</span>';
  html += '<div class="dna-search-input-wrap">';
  html += '<input id="dna-search-' + tab + '" class="dna-input dna-search-input" type="text" placeholder="Search\u2026" value="' + esc(query) + '" oninput="_dnaOnSearch(\x27' + tab + '\x27)">';
  if (query) {
    html += '<span class="dna-search-clear" onclick="_dnaClearSearch(\x27' + tab + '\x27)">\u00d7</span>';
  }
  html += '</div></div>';
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRIMER TABLE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaPrimerTable() {
  var allItems = _dna.primers;
  var searchFields = ['name', 'sequence', 'use', 'box_number'];
  var filtered = _dnaFilterItems(allItems, _dna.search.primers, searchFields);
  var s = _dna.sort.primers;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">PRIMERS</div>';
  html += _dnaSearchBar('primers', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No primers yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No primers match your search.</div>';
  } else {
    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27name\x27)">Name' + _dnaSortIndicator('primers', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27sequence\x27)">Sequence' + _dnaSortIndicator('primers', 'sequence') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27use\x27)">Use' + _dnaSortIndicator('primers', 'use') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27primers\x27,\x27box_number\x27)">Box #' + _dnaSortIndicator('primers', 'box_number') + '</th>';
    html += '<th>Tm</th><th>.gb</th><th style="width:2.5rem"></th>';
    html += '</tr></thead><tbody>';
    items.forEach(function(p) {
      var seq = esc(p.sequence || '');
      html += '<tr>';
      html += '<td class="dna-cell-name">' + esc(p.name) + '</td>';
      html += '<td class="dna-cell-seq" title="Click to edit \u2014 ' + seq + '" onclick="_dnaEditSeq(' + p.id + ')" style="cursor:pointer"><code>' + _dnaStyledSeqShort(p.sequence || '') + '</code></td>';
      html += '<td>' + esc(p.use || '') + '</td>';
      html += '<td>' + esc(p.box_number || '') + '</td>';
      html += '<td>' + (p.tm ? '<span title="' + esc(p.tm_polymerase || '') + '">' + Number(p.tm).toFixed(1) + '\u00b0</span>' : '<span class="muted">\u2014</span>') + '</td>';
      html += '<td>' + _dnaGbCell('primer', p) + '</td>';
      html += '<td><span class="dna-del" onclick="_dnaDeletePrimer(' + p.id + ')" title="Delete">\u00d7</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '<div class="dna-add-row">';
  html += '<input id="dna-p-name" placeholder="Primer name" class="dna-input" style="flex:2">';
  html += '<input id="dna-p-seq" placeholder="Sequence" class="dna-input" style="flex:3">';
  html += '<input id="dna-p-use" placeholder="Use" class="dna-input" style="flex:2">';
  html += '<input id="dna-p-box" placeholder="Box #" class="dna-input" style="flex:1">';
  html += '<button class="btn btn-sm" onclick="_dnaAddPrimer()">Add</button>';
  html += '</div>';
  return html;
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
      box_number: (document.getElementById('dna-p-box') || {}).value || ''
    });
    toast('Primer added.'); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

async function _dnaDeletePrimer(id) {
  if (!confirm('Delete this primer?')) return;
  try { await api('DELETE', '/api/primers/' + id); toast('Deleted.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PLASMID TABLE — now includes Antibiotic Resistance column
// ══════════════════════════════════════════════════════════════════════════════

function _dnaPlasmidTable() {
  var allItems = _dna.plasmids;
  var searchFields = ['name', 'use', 'box_location', 'glycerol_location'];
  var filtered = _dnaFilterItems(allItems, _dna.search.plasmids, searchFields);
  var s = _dna.sort.plasmids;
  var items = _dnaSortItems(filtered, s.col, s.dir);

  var html = '<div class="dna-section-hdr">PLASMIDS</div>';
  html += _dnaSearchBar('plasmids', allItems.length, filtered.length);

  if (!allItems.length) {
    html += '<div class="dna-empty">No plasmids yet \u2014 add one below or import from a file.</div>';
  } else if (!items.length) {
    html += '<div class="dna-empty">No plasmids match your search.</div>';
  } else {
    // Check if any plasmid has resistance data
    var anyGb = allItems.some(function(p) { return p.gb_file; });

    html += '<div class="dna-table-wrap"><table class="dna-table"><thead><tr>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27name\x27)">Name' + _dnaSortIndicator('plasmids', 'name') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27use\x27)">Use' + _dnaSortIndicator('plasmids', 'use') + '</th>';
    html += '<th>Resistance</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27box_location\x27)">Box Location' + _dnaSortIndicator('plasmids', 'box_location') + '</th>';
    html += '<th class="dna-th-sort" onclick="_dnaSortBy(\x27plasmids\x27,\x27glycerol_location\x27)">Glycerol' + _dnaSortIndicator('plasmids', 'glycerol_location') + '</th>';
    html += '<th>.gb</th><th style="width:2.5rem"></th>';
    html += '</tr></thead><tbody>';
    items.forEach(function(p) {
      html += '<tr>';
      html += '<td class="dna-cell-name">' + esc(p.name) + '</td>';
      html += '<td>' + esc(p.use || '') + '</td>';
      html += '<td>' + _dnaResistanceCell(p) + '</td>';
      html += '<td>' + esc(p.box_location || '') + '</td>';
      html += '<td>' + esc(p.glycerol_location || '') + '</td>';
      html += '<td>' + _dnaGbCell('plasmid', p) + '</td>';
      html += '<td><span class="dna-del" onclick="_dnaDeletePlasmid(' + p.id + ')" title="Delete">\u00d7</span></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Rescan button — useful for populating resistance on existing .gb files
    if (anyGb) {
      html += '<div style="margin-top:.3rem;text-align:right">';
      html += '<button class="btn btn-sm" onclick="_dnaRescanResistance()" title="Re-parse all .gb files for antibiotic resistance annotations" style="font-size:.78rem;color:#8a7f72">\u{1F50D} Rescan .gb files for resistance</button>';
      html += '</div>';
    }
  }

  html += '<div class="dna-add-row">';
  html += '<input id="dna-pl-name" placeholder="Plasmid name" class="dna-input" style="flex:2">';
  html += '<input id="dna-pl-use" placeholder="Use" class="dna-input" style="flex:2">';
  html += '<input id="dna-pl-box" placeholder="Box location" class="dna-input" style="flex:1.5">';
  html += '<input id="dna-pl-gly" placeholder="Glycerol location" class="dna-input" style="flex:1.5">';
  html += '<button class="btn btn-sm" onclick="_dnaAddPlasmid()">Add</button>';
  html += '</div>';
  return html;
}

function _dnaResistanceCell(p) {
  var res = p.antibiotic_resistance || '';
  if (!res) {
    if (p.gb_file) return '<span class="muted" style="font-size:.78rem">none detected</span>';
    return '<span class="muted">\u2014</span>';
  }
  // Show as styled badges
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
      glycerol_location: (document.getElementById('dna-pl-gly') || {}).value || ''
    });
    toast('Plasmid added.'); _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

async function _dnaDeletePlasmid(id) {
  if (!confirm('Delete this plasmid?')) return;
  try { await api('DELETE', '/api/plasmids/' + id); toast('Deleted.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  .GB FILE CELL + UPLOAD
// ══════════════════════════════════════════════════════════════════════════════

function _dnaGbCell(type, item) {
  if (item.gb_file) {
    return '<a href="/api/' + type + 's/' + item.id + '/gb" class="dna-gb-link" title="Download ' + esc(item.gb_file) + '">\u2b07 ' + esc(item.gb_file) + '</a>' +
           ' <span class="dna-del" onclick="_dnaRemoveGb(\x27' + type + '\x27,' + item.id + ')" title="Remove .gb">\u00d7</span>';
  }
  return '<label class="dna-gb-upload" title="Attach .gb file">\u{1F4CE}' +
         '<input type="file" accept=".gb,.gbk,.genbank" style="display:none" onchange="_dnaUploadGb(\x27' + type + '\x27,' + item.id + ',this)">' +
         '</label>';
}

async function _dnaUploadGb(type, id, input) {
  if (!input.files.length) return;
  var fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    var resp = await fetch('/api/' + type + 's/' + id + '/gb', { method: 'POST', body: fd });
    if (!resp.ok) { var e = await resp.json().catch(function(){return {};}); toast(e.detail || 'Upload failed'); return; }
    var result = await resp.json();
    // Show resistance info in toast if detected on a plasmid
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
  try { await api('DELETE', '/api/' + type + 's/' + id + '/gb'); toast('Removed.'); _dnaRefresh(); }
  catch(e) { toast('Error: ' + e.message); }
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
        '<span class="dna-del" onclick="_dnaCloseSeqEdit()" style="font-size:1.4rem">\u00d7</span>' +
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

function _dnaCloseSeqEdit() {
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
    '<code style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.85rem;word-break:break-all;line-height:1.6">' + styled + '</code>' +
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
    _dnaCloseSeqEdit();
    _dnaRefresh();
  } catch(e) { toast('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  IMPORT MODAL
// ══════════════════════════════════════════════════════════════════════════════

function _dnaImportModal() {
  return (
    '<div class="dna-modal">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
        '<h3 style="margin:0">Import from File</h3>' +
        '<span class="dna-del" onclick="_dnaCloseImport()" style="font-size:1.4rem">\u00d7</span>' +
      '</div>' +
      '<p class="muted" style="margin:.6rem 0 1rem">Upload a .csv, .tsv, or .xlsx file and map its columns.</p>' +
      '<div id="dna-import-body">' + _dnaImportUploadStep() + '</div>' +
    '</div>'
  );
}

function _dnaShowImport() {
  _dna.importState = {};
  var ov = document.getElementById('dna-import-overlay');
  if (ov) { ov.innerHTML = _dnaImportModal(); ov.style.display = ''; }
}
function _dnaCloseImport() {
  var ov = document.getElementById('dna-import-overlay');
  if (ov) ov.style.display = 'none';
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
  var html = '<option value="-1"' + (selectedIdx === -1 ? ' selected' : '') + '>\u2014 skip \u2014</option>';
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

  var html = '<div class="dna-section-hdr" style="margin-top:0">COLUMN MAPPING \u2014 ' + esc(s.filename) + '</div>';

  html += '<div style="margin-bottom:1rem"><label>Import as <select id="dna-imp-type" onchange="_dnaImpTypeChanged()">' +
          '<option value="primer">Primers</option><option value="plasmid">Plasmids</option></select></label></div>';

  html += '<div id="dna-imp-cols-primer" class="dna-col-grid">';
  html += '<label>Name<select id="dna-imp-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Sequence<select id="dna-imp-seq">' + _buildOpts(h, gSeq) + '</select></label>';
  html += '<label>Use<select id="dna-imp-use">' + _buildOpts(h, gUse) + '</select></label>';
  html += '<label>Box #<select id="dna-imp-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '</div>';

  html += '<div id="dna-imp-cols-plasmid" class="dna-col-grid" style="display:none">';
  html += '<label>Name<select id="dna-imp-pl-name">' + _buildOpts(h, gName) + '</select></label>';
  html += '<label>Use<select id="dna-imp-pl-use">' + _buildOpts(h, gUse) + '</select></label>';
  html += '<label>Box Location<select id="dna-imp-pl-box">' + _buildOpts(h, gBox) + '</select></label>';
  html += '<label>Glycerol<select id="dna-imp-pl-gly">' + _buildOpts(h, gGly) + '</select></label>';
  html += '</div>';

  html += _dnaImportPreview(h, s.preview || []);
  html += '<div style="margin-top:1rem;display:flex;gap:.5rem">';
  html += '<button class="btn btn-sm" style="background:#5b7a5e;color:#fff" onclick="_dnaImportExecute()">Import</button>';
  html += '<button class="btn btn-sm" onclick="_dnaCloseImport()">Cancel</button></div>';

  var body = document.getElementById('dna-import-body');
  if (body) body.innerHTML = html;
}

function _dnaImpTypeChanged() {
  var t = document.getElementById('dna-imp-type').value;
  var ep = document.getElementById('dna-imp-cols-primer');
  var epl = document.getElementById('dna-imp-cols-plasmid');
  if (ep) ep.style.display = (t === 'primer') ? '' : 'none';
  if (epl) epl.style.display = (t === 'plasmid') ? '' : 'none';
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

async function _dnaImportExecute() {
  var s = _dna.importState;
  var recType = document.getElementById('dna-imp-type').value;
  var body = { temp_id: s.temp_id, ext: s.ext, filename: s.filename, record_type: recType };

  if (recType === 'primer') {
    body.col_name = parseInt(document.getElementById('dna-imp-name').value, 10);
    body.col_sequence = parseInt(document.getElementById('dna-imp-seq').value, 10);
    body.col_use = parseInt(document.getElementById('dna-imp-use').value, 10);
    body.col_box_number = parseInt(document.getElementById('dna-imp-box').value, 10);
    if (body.col_name < 0) { toast('Please select a Name column.'); return; }
    if (body.col_sequence < 0) body.col_sequence = null;
    if (body.col_use < 0) body.col_use = null;
    if (body.col_box_number < 0) body.col_box_number = null;
  } else {
    body.col_name = parseInt(document.getElementById('dna-imp-pl-name').value, 10);
    body.col_use = parseInt(document.getElementById('dna-imp-pl-use').value, 10);
    body.col_box_location = parseInt(document.getElementById('dna-imp-pl-box').value, 10);
    body.col_glycerol_location = parseInt(document.getElementById('dna-imp-pl-gly').value, 10);
    if (body.col_name < 0) { toast('Please select a Name column.'); return; }
    if (body.col_use < 0) body.col_use = null;
    if (body.col_box_location < 0) body.col_box_location = null;
    if (body.col_glycerol_location < 0) body.col_glycerol_location = null;
  }

  try {
    var data = await api('POST', '/api/import/execute', body);
    toast(data.record_count + ' ' + data.record_type + '(s) imported.');
    _dnaCloseImport();
    _dna.tab = (data.record_type === 'primer') ? 'primers' : 'plasmids';
    _dnaRefresh();
  } catch(e) { toast('Import failed: ' + (e.message || 'Unknown error')); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO-LINKING ENGINE
// ══════════════════════════════════════════════════════════════════════════════

function _dnaBuildRegex() {
  var parts = [];
  var pp = (_dna.settings.plasmid_prefix || '').trim();
  var pr = (_dna.settings.primer_prefix || '').trim();
  if (pp && pr && pp.length >= pr.length) { parts.push(_dnaEscRe(pp)); parts.push(_dnaEscRe(pr)); }
  else if (pr && pp) { parts.push(_dnaEscRe(pp)); parts.push(_dnaEscRe(pr)); }
  else if (pp) { parts.push(_dnaEscRe(pp)); }
  else if (pr) { parts.push(_dnaEscRe(pr)); }

  if (!parts.length) { _dna.linkRegex = null; return; }
  _dna.linkRegex = new RegExp('\\b(' + parts.join('|') + ')(\\d+)\\b', 'g');
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

// ── Scan all existing content for linkification ─────────────────────────────

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
//  POPOVER
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('click', function(e) {
  var link = e.target.closest('.dna-link');
  if (!link) { _dnaClosePopover(); return; }
  e.preventDefault();
  e.stopPropagation();
  _dnaShowPopover(link);
});

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') _dnaClosePopover(); });

function _dnaShowPopover(linkEl) {
  var name = linkEl.dataset.dnaName;
  if (!name) return;

  var pp = (_dna.settings.plasmid_prefix || '').trim();
  var pr = (_dna.settings.primer_prefix || '').trim();
  var type = null, item = null;

  if (pp && name.indexOf(pp) === 0) {
    type = 'plasmid';
    item = _dnaFindByName(_dna.plasmids, name);
  } else if (pr && name.indexOf(pr) === 0) {
    type = 'primer';
    item = _dnaFindByName(_dna.primers, name);
  }

  var pop = document.getElementById('dna-popover');
  if (!pop) return;

  var html = '<div class="dna-pop-header">';
  html += '<strong>' + esc(name) + '</strong>';
  html += '<span class="dna-del" onclick="_dnaClosePopover()" style="font-size:1.1rem">\u00d7</span>';
  html += '</div>';

  if (!item) {
    html += '<div class="dna-pop-body"><span class="muted">Not found in database.</span></div>';
  } else if (type === 'primer') {
    html += '<div class="dna-pop-body">';
    html += '<div class="dna-pop-type">PRIMER</div>';
    if (item.sequence) html += '<div class="dna-pop-row"><span class="dna-pop-label">Sequence</span><code class="dna-pop-seq">' + esc(item.sequence) + '</code></div>';
    if (item.use) html += '<div class="dna-pop-row"><span class="dna-pop-label">Use</span>' + esc(item.use) + '</div>';
    if (item.box_number) html += '<div class="dna-pop-row"><span class="dna-pop-label">Box #</span>' + esc(item.box_number) + '</div>';
    if (item.tm) html += '<div class="dna-pop-row"><span class="dna-pop-label">Tm</span>' + Number(item.tm).toFixed(1) + '\u00b0C</div>';
    if (item.gb_file) html += '<div class="dna-pop-row"><a href="/api/primers/' + item.id + '/gb" class="dna-gb-link">\u2b07 ' + esc(item.gb_file) + '</a></div>';
    html += '</div>';
  } else {
    html += '<div class="dna-pop-body">';
    html += '<div class="dna-pop-type">PLASMID</div>';
    if (item.use) html += '<div class="dna-pop-row"><span class="dna-pop-label">Use</span>' + esc(item.use) + '</div>';
    if (item.antibiotic_resistance) html += '<div class="dna-pop-row"><span class="dna-pop-label">Resistance</span>' + esc(item.antibiotic_resistance) + '</div>';
    if (item.box_location) html += '<div class="dna-pop-row"><span class="dna-pop-label">Box</span>' + esc(item.box_location) + '</div>';
    if (item.glycerol_location) html += '<div class="dna-pop-row"><span class="dna-pop-label">Glycerol</span>' + esc(item.glycerol_location) + '</div>';
    if (item.gb_file) html += '<div class="dna-pop-row"><a href="/api/plasmids/' + item.id + '/gb" class="dna-gb-link">\u2b07 ' + esc(item.gb_file) + '</a></div>';
    html += '</div>';
  }

  html += '<div class="dna-pop-footer"><a href="#" onclick="_dnaGoToManager(\x27' + esc(type || '') + '\x27);return false;">View in DNA Manager \u2192</a></div>';

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
  if (type === 'plasmid') _dna.tab = 'plasmids';
  else _dna.tab = 'primers';
  if (typeof setView === 'function') setView('import_data');
}

// ══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════════════════════════════════════

function _dnaStyles() {
  return '<style>' +
    '.dna-manager { max-width: 960px; }' +
    '.dna-tabs { display:flex; gap:0; margin-bottom:0; border-bottom:1px solid #d5cec0; }' +
    '.dna-tab { padding:.55rem 1.2rem; cursor:pointer; font-size:.9rem; color:#8a7f72; border-bottom:2px solid transparent; transition:all .15s; }' +
    '.dna-tab:hover { color:#5a5148; }' +
    '.dna-tab.active { color:#4a4139; border-bottom-color:#8a7f72; font-weight:600; }' +
    '.dna-tab small { font-weight:400; }' +
    '.dna-section-hdr { font-size:.72rem; letter-spacing:.12em; color:#8a7f72; text-transform:uppercase; padding:.6rem 0 .5rem; margin-top:.8rem; border-bottom:1px solid #d5cec0; margin-bottom:.6rem; }' +
    '.dna-table-wrap { overflow-x:auto; margin-bottom:.5rem; }' +
    '.dna-table { width:100%; border-collapse:collapse; font-size:.88rem; }' +
    '.dna-table th { text-align:left; padding:.45rem .6rem; color:#8a7f72; font-weight:500; font-size:.78rem; letter-spacing:.05em; text-transform:uppercase; border-bottom:1px solid #d5cec0; }' +
    '.dna-table td { padding:.5rem .6rem; border-bottom:1px solid #e8e2d8; color:#4a4139; }' +
    '.dna-table tr:hover td { background:#f5f1eb; }' +
    '.dna-cell-name { font-weight:600; }' +
    '.dna-cell-seq code { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.82rem; color:#6b614f; background:#f0ebe3; padding:.1rem .3rem; border-radius:3px; }' +
    '.dna-empty { color:#a89e90; padding:2rem 1rem; text-align:center; font-style:italic; }' +
    '.dna-add-row { display:flex; gap:.4rem; align-items:center; margin-top:.6rem; padding-top:.6rem; border-top:1px solid #e8e2d8; }' +
    '.dna-input { padding:.35rem .5rem; border:1px solid #d5cec0; border-radius:4px; font-size:.85rem; background:#faf8f4; color:#4a4139; }' +
    '.dna-input:focus { outline:none; border-color:#8a7f72; }' +
    '.dna-del { cursor:pointer; color:#b09e8e; font-size:1.1rem; line-height:1; }' +
    '.dna-del:hover { color:#c0392b; }' +
    '.dna-setting-label { display:flex; flex-direction:column; font-size:.82rem; color:#8a7f72; gap:.2rem; }' +

    /* search bar */
    '.dna-search-bar { display:flex; align-items:center; justify-content:space-between; gap:.8rem; margin-bottom:.5rem; }' +
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
    '.dna-gb-link { color:#5b7a5e; font-size:.82rem; text-decoration:none; }' +
    '.dna-gb-link:hover { text-decoration:underline; }' +
    '.dna-gb-upload { cursor:pointer; color:#b09e8e; font-size:.95rem; }' +
    '.dna-gb-upload:hover { color:#5b7a5e; }' +

    /* sequence editor */
    '.dna-seq-textarea { width:100%; min-height:80px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.88rem; padding:.5rem; border:1px solid #d5cec0; border-radius:4px; background:#faf8f4; color:#4a4139; resize:vertical; letter-spacing:.05em; line-height:1.5; }' +
    '.dna-seq-textarea:focus { outline:none; border-color:#8a7f72; }' +

    /* import overlay */
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
    api('GET', '/api/plasmids').catch(function() { return {items:[]}; })
  ]).then(function(results) {
    _dna.settings = results[0] || {};
    _dna.primers = (results[1] && results[1].items) || [];
    _dna.plasmids = (results[2] && results[2].items) || [];
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
