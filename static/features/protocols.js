// ── PROTOCOLS ─────────────────────────────────────────────────────────────────

(function injectProtoStyles() {
  if (document.getElementById('proto-styles')) return;
  var s = document.createElement('style');
  s.id = 'proto-styles';
  s.textContent = [
    '.proto-import-box{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:16px;margin-bottom:20px}',
    '.proto-import-tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}',
    '.proto-tab{background:none;border:1px solid #d5cec0;border-radius:5px;padding:5px 14px;font-size:12px;cursor:pointer;color:#8a7f72;font-family:inherit}',
    '.proto-tab.active{background:#faf8f4;color:#4a4139;border-color:#b0a898;font-weight:600}',
    '.proto-import-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.proto-import-row input[type=text]{flex:1;min-width:160px}',
    '.proto-import-col{display:flex;flex-direction:column;gap:8px}',
    '.proto-import-col input[type=text]{width:100%}',
    '.proto-import-col textarea{width:100%;min-height:100px;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:12px;resize:vertical}',
    '.proto-search-bar{margin-bottom:10px}',
    '.proto-search-bar input{width:100%}',
    '.steps-list{margin:12px 0 0;padding-left:22px;color:#4a4139;font-size:13px;line-height:1.7}',
    '.steps-list li{margin-bottom:2px}',
    '.steps-text{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:12px;background:#f0ebe3;border-radius:5px;padding:10px 12px;white-space:pre-wrap;color:#4a4139;margin-top:12px}',
    '.recipe-section{margin-top:18px}',
    '.recipe-section-head{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}',
    '.recipe-wrap{overflow-x:auto}',
    '.recipe-table{border-collapse:collapse;font-size:13px;color:#4a4139;min-width:100%}',
    '.recipe-table th{background:#f0ebe3;border:1px solid #d5cec0;padding:6px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap;position:relative}',
    '.recipe-table td{border:1px solid #e8e2d8;padding:0}',
    '.recipe-table td input{width:100%;border:none;background:transparent;padding:6px 10px;font-size:13px;font-family:inherit;color:#4a4139;outline:none;min-width:80px}',
    '.recipe-table td input:focus{background:#fff8f0}',
    '.recipe-table th .del-col{position:absolute;top:2px;right:3px;background:none;border:none;cursor:pointer;font-size:10px;color:#c0b8b0;padding:0;line-height:1}',
    '.recipe-table th .del-col:hover{color:#c0392b}',
    '.recipe-table .del-row{background:none;border:none;cursor:pointer;font-size:13px;color:#c0b8b0;padding:4px 8px;width:100%;height:100%}',
    '.recipe-table .del-row:hover{color:#c0392b;background:#fff0f0}',
    '.recipe-table th input.col-rename{border:none;background:transparent;font-size:12px;font-weight:600;font-family:inherit;color:#4a4139;outline:none;width:100%;padding:0}',
    '.recipe-table th input.col-rename:focus{background:#fff8f0;border-radius:2px}',
    '.recipe-add-row{display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap}',
    '.row-mv{background:none;border:none;cursor:pointer;font-size:10px;color:#c0b8b0;padding:1px 3px;line-height:1}',
    '.row-mv:hover{color:#4a4139}',
    '.row-mv:disabled{color:#e8e2d8;cursor:default}',
    '.col-mv{background:none;border:none;cursor:pointer;font-size:8px;color:#c0b8b0;padding:0 1px;line-height:1;flex-shrink:0}',
    '.col-mv:hover{color:#4a4139}',
    '.col-mv:disabled{color:#e8e2d8;cursor:default}',
    '.recipe-edit-actions{display:flex;gap:6px;align-items:center}',
    '.recipe-table-wrap{margin-bottom:14px;border:1px solid #d5cec0;border-radius:6px;overflow:hidden}',
    '.recipe-table-header{display:flex;align-items:center;background:#f0ebe3;padding:6px 10px;gap:8px}',
    '.recipe-table-header input{flex:1;font-size:12px;font-weight:600;border:none;background:transparent;color:#4a4139;outline:none}',
    '.recipe-table-header input:focus{background:#faf8f4;border-radius:2px}',
    '.recipe-table-body{padding:8px 10px}',
    '.recipe-totals-row td{font-weight:600;font-size:12px;color:#5b7a5e;background:#f0f6f0;padding:4px 10px;border:1px solid #e8e2d8}',
    '.manual-step-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}',
    '.manual-step-row input{flex:1;font-size:13px}',
    '.manual-step-num{font-size:12px;color:#8a7f72;min-width:20px;text-align:right;flex-shrink:0}',
    '.manual-del-step{background:none;border:none;cursor:pointer;color:#c0b8b0;font-size:16px;padding:0 4px;flex-shrink:0;line-height:1}',
    '.manual-del-step:hover{color:#c0392b}',
    '.manual-recipe-section{margin-top:14px;border-top:1px solid #d5cec0;padding-top:14px}',
    '.manual-recipe-label{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:8px}',
    '.active-run-card{background:#fff8e8;border:1px solid #e8d8a0;border-radius:8px;padding:12px 16px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '.active-run-info{flex:1;min-width:180px}',
    '.active-run-title{font-weight:600;font-size:13px;color:#4a4139}',
    '.active-run-meta{font-size:12px;color:#8a7f72;margin-top:2px}',
    '.active-run-bar{height:4px;background:#e8e2d8;border-radius:2px;margin-top:6px}',
    '.active-run-fill{height:100%;background:#5b7a5e;border-radius:2px}',
    '.proto-link-badge{display:inline-flex;align-items:center;gap:4px;background:#e8f0e8;color:#5b7a5e;border:1px solid #c8d8c8;border-radius:3px;padding:1px 7px;font-size:11px;cursor:pointer;font-weight:600;vertical-align:middle;margin:0 2px}',
    '.proto-link-badge:hover{background:#d0e4d0}',
    '.proto-edit-step{display:flex;gap:6px;align-items:center;margin-bottom:6px;padding:4px;border-radius:4px;border:1px solid transparent}',
    '.proto-edit-step input{flex:1;font-size:13px}',
    '.proto-edit-step .link-btn{font-size:11px;color:#5b7a5e;background:none;border:1px solid #c8d8c8;border-radius:3px;padding:2px 7px;cursor:pointer;white-space:nowrap}',
    '.proto-edit-step .link-btn:hover{background:#e8f0e8}',
    '.proto-edit-step .move-btn{background:none;border:none;cursor:pointer;color:#b0a898;font-size:14px;padding:0 2px;line-height:1}',
    '.proto-edit-step .move-btn:hover{color:#4a4139}',
    '.proto-edit-step .move-btn:disabled{color:#e0dcd6;cursor:default}',
    '.proto-edit-mode-banner{background:#e8f0e8;border:1px solid #c8d8c8;border-radius:6px;padding:8px 14px;margin-bottom:12px;font-size:12px;color:#3d5e3f;display:flex;align-items:center;gap:8px}',
    '.run-history-section{margin-top:18px;border-top:1px solid #e8e2d8;padding-top:14px}',
    '.run-history-head{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:8px}',
    '.run-history-row{border:1px solid #e8e2d8;border-radius:6px;margin-bottom:6px;overflow:hidden;background:#fff}',
    '.run-history-summary{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;user-select:none}',
    '.run-history-summary:hover{background:#f8f6f2}',
    '.run-history-date{font-size:12px;font-weight:600;color:#4a4139;min-width:80px}',
    '.run-history-pct{font-size:12px;color:#5b7a5e;min-width:60px}',
    '.run-history-devs{font-size:12px;color:#c97b3c}',
    '.run-history-group{font-size:11px;color:#8a7f72;flex:1}',
    '.run-history-detail{display:none;padding:10px 14px 12px;border-top:1px solid #e8e2d8;background:#faf8f4}',
    '.run-history-row.open .run-history-detail{display:block}',
    '.run-detail-steps{margin:0;padding-left:18px;font-size:12px;color:#4a4139;line-height:1.7}',
    '.run-detail-steps li{margin-bottom:2px}',
    '.run-detail-steps li.done{color:#8a7f72}',
    '.run-detail-steps li.done::marker{content:"\\2713  "}',
    '.run-detail-deviation{font-size:11px;color:#c97b3c;margin-left:4px}',
    '.copy-tbl-btn{background:none;border:1px solid #d5cec0;border-radius:4px;padding:2px 8px;font-size:11px;color:#8a7f72;cursor:pointer;white-space:nowrap}',
    '.copy-tbl-btn:hover{background:#f0ebe3;color:#4a4139}',
    '.proto-spinner{display:inline-block;width:14px;height:14px;border:2px solid #c8d8c8;border-top-color:#5b7a5e;border-radius:50%;animation:proto-spin .8s linear infinite;flex-shrink:0}',
    '@keyframes proto-spin{to{transform:rotate(360deg)}}',
    '.proto-layout{display:flex;gap:0;min-height:500px;border:1px solid #d5cec0;border-radius:8px;overflow:hidden;background:#faf8f4}',
    '.proto-sidebar{width:280px;min-width:220px;max-width:340px;border-right:1px solid #d5cec0;background:#f0ebe3;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;resize:horizontal}',
    '.proto-sidebar-inner{flex:1;overflow-y:auto;padding:10px}',
    '.proto-panels{flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden}',
    '.proto-panel-tabs{display:flex;gap:0;background:#e8e2d8;border-bottom:1px solid #d5cec0;overflow-x:auto;flex-shrink:0;min-height:34px}',
    '.proto-ptab{display:flex;align-items:center;gap:6px;padding:7px 14px;font-size:12px;color:#8a7f72;cursor:pointer;border-right:1px solid #d5cec0;white-space:nowrap;max-width:200px;user-select:none}',
    '.proto-ptab:hover{background:#f0ebe3}',
    '.proto-ptab.active{background:#faf8f4;color:#4a4139;font-weight:600;border-bottom:2px solid #5b7a5e}',
    '.proto-ptab .ptab-close{background:none;border:none;cursor:pointer;color:#c0b8b0;font-size:14px;padding:0;line-height:1;flex-shrink:0}',
    '.proto-ptab .ptab-close:hover{color:#c0392b}',
    '.proto-ptab-title{overflow:hidden;text-overflow:ellipsis}',
    '.proto-panel-content{flex:1;overflow-y:auto;padding:18px 20px}',
    '.proto-panel-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#b0a898;font-size:14px;font-style:italic}',
    '.proto-panel{display:none}',
    '.proto-panel.active{display:block}',
    '.pli{padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;transition:background .1s}',
    '.pli:hover{background:#faf8f4;border-color:#d5cec0}',
    '.pli.selected{background:#faf8f4;border-color:#5b7a5e}',
    '.pli-title{font-weight:600;font-size:13px;color:#4a4139;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pli-meta{font-size:11px;color:#8a7f72;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.pli-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600}',
    '.pli-badge.extracting{background:#fff3cd;color:#856404;animation:proto-pulse 1.5s ease-in-out infinite}',
    '.pli-badge.no-steps{background:#f8d7da;color:#721c24}',
    '@keyframes proto-pulse{0%,100%{opacity:1}50%{opacity:.5}}',
    '.tag-input-wrap{display:flex;flex-wrap:wrap;gap:4px;align-items:center;border:1px solid #d5cec0;border-radius:5px;padding:4px 8px;background:#faf8f4;min-height:30px}',
    '.tag-chip{display:inline-flex;align-items:center;gap:3px;background:#e8f0e8;color:#3d5e3f;border-radius:3px;padding:2px 6px;font-size:11px;font-weight:600}',
    '.tag-chip button{background:none;border:none;cursor:pointer;color:#5b7a5e;font-size:12px;padding:0;line-height:1}',
    '.tag-chip button:hover{color:#c0392b}',
    '.tag-input-wrap input{border:none;outline:none;background:transparent;font-size:12px;font-family:inherit;flex:1;min-width:80px;padding:2px 0}',
    '.proto-edit-step.dragging{opacity:.4}',
    '.proto-edit-step.drag-over{border-top:2px solid #5b7a5e}',
    '.proto-edit-step .drag-handle{cursor:grab;color:#c0b8b0;font-size:14px;padding:0 4px;user-select:none;flex-shrink:0}',
    '.proto-edit-step .drag-handle:active{cursor:grabbing}',
    '.extraction-banner{background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#856404;display:flex;align-items:center;gap:8px}',
    '.proto-timer-btn{display:inline-flex;align-items:center;gap:3px;background:#e8f0e8;color:#5b7a5e;border:1px solid #c8d8c8;border-radius:3px;padding:1px 7px;font-size:11px;cursor:pointer;font-weight:600;vertical-align:middle;margin-left:4px;font-family:inherit}',
    '.proto-timer-btn:hover{background:#d0e4d0}',
    /* review modal */
    '.prv-overlay{position:fixed;inset:0;background:rgba(60,52,42,.45);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px}',
    '.prv-modal{background:#faf8f4;border:1px solid #d5cec0;border-radius:10px;width:100%;max-width:700px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}',
    '.prv-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#f0ebe3;border-bottom:1px solid #d5cec0}',
    '.prv-header h3{margin:0;font-size:15px;color:#4a4139}',
    '.prv-body{flex:1;overflow-y:auto;padding:16px 18px}',
    '.prv-item{border:1px solid #e8e2d8;border-radius:8px;margin-bottom:12px;overflow:hidden;background:#fff}',
    '.prv-item.accepted{border-color:#c8d8c8;background:#f0f8f0}',
    '.prv-item.rejected{opacity:.5}',
    '.prv-item-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#faf8f4;border-bottom:1px solid #e8e2d8}',
    '.prv-badge{padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase}',
    '.prv-badge.step{background:#e8f0e8;color:#3d5e3f}',
    '.prv-badge.table{background:#e8e0f0;color:#5e3d7a}',
    '.prv-badge.general{background:#f0ebe3;color:#8a7f72}',
    '.prv-reason{font-size:12px;color:#8a7f72;flex:1}',
    '.prv-diff{padding:12px 14px;display:flex;gap:12px}',
    '.prv-diff-col{flex:1;min-width:0}',
    '.prv-diff-label{font-size:10px;font-weight:700;text-transform:uppercase;color:#8a7f72;margin-bottom:4px}',
    '.prv-diff-text{font-size:13px;color:#4a4139;background:#f0ebe3;border-radius:4px;padding:8px 10px;white-space:pre-wrap;word-break:break-word;font-family:"SF Mono",Monaco,Consolas,monospace;min-height:36px}',
    '.prv-diff-col.new .prv-diff-text{background:#e8f0e8;border:1px solid #c8d8c8}',
    '.prv-item-actions{padding:8px 14px;display:flex;gap:6px;justify-content:flex-end;border-top:1px solid #e8e2d8}',
    '@media(max-width:700px){.proto-layout{flex-direction:column;min-height:auto}.proto-sidebar{width:100%!important;max-width:none;border-right:none;border-bottom:1px solid #d5cec0;max-height:220px;resize:none}}'
  ].join('');
  document.head.appendChild(s);
})();

// ── state ─────────────────────────────────────────────────────────────────────
var DEFAULT_RECIPE = { columns: ['Component', 'Stock conc.', 'Volume (uL)', 'Final conc.'], rows: [] };
var _recipeState = {};
var _manualSteps = [''];
var _manualRecipes = [];
var _UNITS = ['uL', 'mL', 'L', 'ng', 'ug', 'mg', 'g', 'nM', 'uM', 'mM', 'M', 'U', 'x', '%', 'units'];
var _editState = {};
var _openPanels = [];
var _activePanel = null;
var _extractionPollInterval = null;
var _tagState = {};

// ── extraction polling ────────────────────────────────────────────────────────
function _startExtractionPoll() {
  if (_extractionPollInterval) return;
  _extractionPollInterval = setInterval(_pollExtractions, 2000);
}
function _stopExtractionPoll() { if (_extractionPollInterval) { clearInterval(_extractionPollInterval); _extractionPollInterval = null; } }

async function _pollExtractions() {
  try {
    var resp = await fetch('/api/3090/status');
    if (!resp.ok) return;
    var data = await resp.json();
    var ext = data.extracting || {};
    var anyActive = false;
    (S.protocols || []).forEach(function(p) {
      var stage = ext[p.id];
      var banner = document.getElementById('extract-banner-' + p.id);
      var li = document.getElementById('pli-' + p.id);
      if (stage && stage !== 'done') {
        anyActive = true;
        if (li) _updateListItemBadge(li, stage);
        if (banner) { banner.innerHTML = '<span class="proto-spinner"></span> ' + _stageLabel(stage); banner.style.display = ''; }
      } else if (stage === 'done') {
        _reloadProtocol(p.id);
      } else {
        if (li) _updateListItemBadge(li, null);
        if (banner) banner.style.display = 'none';
      }
    });
    if (!anyActive) _stopExtractionPoll();
  } catch(e) {}
}

function _stageLabel(stage) {
  return { waking: 'Waking 3090...', steps: 'Extracting steps...', tables: 'Extracting tables...', failed: 'Extraction failed' }[stage] || 'Processing...';
}

function _updateListItemBadge(li, stage) {
  var badge = li.querySelector('.pli-badge');
  if (!stage) { if (badge) badge.remove(); return; }
  if (!badge) { badge = document.createElement('span'); badge.className = 'pli-badge'; var meta = li.querySelector('.pli-meta'); if (meta) meta.appendChild(badge); }
  badge.className = 'pli-badge' + (stage === 'failed' ? ' no-steps' : ' extracting');
  badge.textContent = _stageLabel(stage);
}

async function _reloadProtocol(pid) {
  try {
    var data = await api('GET', '/api/protocols/' + pid);
    var idx = (S.protocols || []).findIndex(function(p) { return p.id === pid; });
    if (idx >= 0) S.protocols[idx] = data;
    var li = document.getElementById('pli-' + pid);
    if (li) { var w = document.createElement('div'); w.innerHTML = _compactCard(data); li.replaceWith(w.firstChild); }
    if (_openPanels.indexOf(pid) >= 0) {
      var panel = document.getElementById('pp-' + pid);
      if (panel) { panel.innerHTML = _panelBody(data); _recipeState[pid] = JSON.parse(JSON.stringify(_parseRecipeArray(data.recipe))); protoLoadRunHistory(pid); }
      _refreshPanelTab(pid);
    }
  } catch(e) {}
}

// ── recipe parsing ────────────────────────────────────────────────────────────
function _parseRecipeArray(raw) {
  if (!raw) return [{ name: 'Recipe', columns: DEFAULT_RECIPE.columns.slice(), rows: [] }];
  try {
    var r = JSON.parse(raw);
    if (Array.isArray(r) && r.length && r[0] && r[0].columns) return r.map(function(t) { return { name: t.name || 'Recipe', columns: (t.columns || []).map(String), rows: (t.rows || []).map(function(row) { return Array.isArray(row) ? row.map(String) : []; }) }; });
    if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) return [{ name: r.name || 'Recipe', columns: r.columns.map(String), rows: r.rows.map(function(row) { return Array.isArray(row) ? row.map(String) : []; }) }];
  } catch(e) {}
  return [{ name: 'Recipe', columns: DEFAULT_RECIPE.columns.slice(), rows: [] }];
}
function _parseRecipe(raw) { return _parseRecipeArray(raw)[0] || JSON.parse(JSON.stringify(DEFAULT_RECIPE)); }
function _isUnitCol(n) { return /vol|amount|conc|stock|final|mass|weight/i.test(n); }
function _parseAmountUnit(val) { val = (val || '').trim(); var m = val.match(/^([\d.,]*)\s*(.*)$/); return { num: m ? m[1] : '', unit: m ? m[2].trim() : '' }; }
function _serializeRecipeState(tables) { if (!tables || !tables.length) return JSON.stringify(DEFAULT_RECIPE); return tables.length === 1 ? JSON.stringify(tables[0]) : JSON.stringify(tables); }

// ── recipe display ────────────────────────────────────────────────────────────
function _recipeDisplayHTML(raw) {
  var tables = _parseRecipeArray(raw);
  if (!tables.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic">No tables.</div>';
  return tables.map(function(t, ti) {
    var hasData = t.rows && t.rows.length > 0;
    var btns = (hasData ? '<button class="copy-tbl-btn" onclick="protoCopyTable(event,' + ti + ')">&#128203; Copy</button>' : '') +
      '<button class="copy-tbl-btn" onclick="protoPasteTable(event,' + ti + ')">&#128203; Paste</button>';
    var nameHtml = tables.length > 1 || (t.name && t.name !== 'Recipe')
      ? '<div style="font-size:11px;font-weight:600;color:#8a7f72;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;display:flex;align-items:center;gap:8px">' + esc(t.name || 'Table ' + (ti + 1)) + btns + '</div>'
      : '<div style="margin-bottom:4px">' + btns + '</div>';
    return '<div style="margin-bottom:10px">' + nameHtml + _recipeReadHTML(t) + '</div>';
  }).join('');
}

function _recipeReadHTML(recipe) {
  if (!recipe.rows || !recipe.rows.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic">No components yet.</div>';
  var html = '<div class="recipe-wrap"><table class="recipe-table"><thead><tr>';
  recipe.columns.forEach(function(c) { html += '<th>' + esc(c) + '</th>'; });
  html += '</tr></thead><tbody>';
  recipe.rows.forEach(function(row) { html += '<tr>'; recipe.columns.forEach(function(_, ci) { html += '<td style="padding:6px 10px">' + esc(row[ci] || '') + '</td>'; }); html += '</tr>'; });
  var hasTotals = false;
  var totals = recipe.columns.map(function(col, ci) {
    if (!_isUnitCol(col) || recipe.rows.length < 2) return '';
    var sum = 0, found = false;
    recipe.rows.forEach(function(row) { var n = parseFloat(_parseAmountUnit(row[ci] || '').num); if (!isNaN(n)) { sum += n; found = true; } });
    if (found) { hasTotals = true; return sum % 1 === 0 ? String(sum) : sum.toFixed(2); }
    return '';
  });
  if (hasTotals) {
    html += '<tr class="recipe-totals-row">' + totals.map(function(v, ci) { return '<td style="padding:4px 10px;font-weight:600;font-size:12px;color:#5b7a5e;background:#f0f6f0;border:1px solid #e8e2d8">' + (ci === 0 && !v ? 'Total' : esc(v)) + '</td>'; }).join('') + '</tr>';
  }
  return html + '</tbody></table></div>';
}

function protoCopyTable(evt, tableIdx) {
  evt.stopPropagation();
  var panel = evt.target.closest('.proto-panel');
  var pid = panel ? parseInt((panel.id || '').replace('pp-', '')) : null;
  var tables = pid && _recipeState[pid] ? _recipeState[pid] : [];
  if (!tables.length && pid) { var p = (S.protocols || []).find(function(x) { return x.id === pid; }); tables = p ? _parseRecipeArray(p.recipe) : []; }
  var t = tables[tableIdx]; if (!t) { toast('Table not found', true); return; }
  var lines = []; if (t.name) lines.push(t.name);
  lines.push(t.columns.join('\t'));
  t.rows.forEach(function(row) { lines.push(t.columns.map(function(_, ci) { return row[ci] || ''; }).join('\t')); });
  navigator.clipboard.writeText(lines.join('\n')).then(function() { toast('Table copied'); }).catch(function() { toast('Copy failed', true); });
}

// ── paste table helpers ───────────────────────────────────────────────────────
function _parseClipboardTable(text) {
  // Parses tab-separated text from copy button or spreadsheet paste
  // Format: optional name line, then header row, then data rows
  // Also handles comma-separated if no tabs found
  if (!text || !text.trim()) return null;
  var lines = text.trim().split('\n').map(function(l) { return l.replace(/\r$/, ''); });
  if (lines.length < 1) return null;

  var sep = '\t';
  // detect separator: if first data-looking line has tabs use tabs, else try comma
  var testLine = lines.length > 1 ? lines[1] : lines[0];
  if (testLine.indexOf('\t') < 0 && testLine.indexOf(',') >= 0) sep = ',';

  var splitLine = function(l) {
    if (sep === ',') {
      // basic CSV: split on comma but respect quoted fields
      var fields = [], field = '', inQ = false;
      for (var i = 0; i < l.length; i++) {
        var c = l[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { fields.push(field.trim()); field = ''; }
        else { field += c; }
      }
      fields.push(field.trim());
      return fields;
    }
    return l.split('\t');
  };

  // heuristic: if first line has fewer columns than second line, it's a table name
  var name = '';
  var headerIdx = 0;
  if (lines.length >= 2) {
    var firstCols = splitLine(lines[0]).length;
    var secondCols = splitLine(lines[1]).length;
    if (firstCols === 1 && secondCols > 1) {
      name = lines[0].trim();
      headerIdx = 1;
    }
  }

  var columns = splitLine(lines[headerIdx]);
  if (columns.length < 1) return null;

  var rows = [];
  for (var i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var cells = splitLine(lines[i]);
    // pad or trim to match column count
    while (cells.length < columns.length) cells.push('');
    if (cells.length > columns.length) cells = cells.slice(0, columns.length);
    rows.push(cells);
  }

  return { name: name || 'Pasted table', columns: columns, rows: rows };
}

async function _readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch(e) {
    // fallback: prompt
    var text = prompt('Paste table data (tab or comma separated):');
    return text || '';
  }
}

async function protoPasteTable(evt, tableIdx) {
  // Paste over an existing table in view mode (saves immediately)
  evt.stopPropagation();
  var panel = evt.target.closest('.proto-panel');
  var pid = panel ? parseInt((panel.id || '').replace('pp-', '')) : null;
  if (!pid) return;

  var text = await _readClipboard();
  var parsed = _parseClipboardTable(text);
  if (!parsed) { toast('Could not parse clipboard — copy a table or paste tab/comma-separated data', true); return; }

  // init recipe state if needed
  var p = (S.protocols || []).find(function(x) { return x.id === pid; });
  if (!_recipeState[pid] && p) _recipeState[pid] = JSON.parse(JSON.stringify(_parseRecipeArray(p.recipe)));

  var tables = _recipeState[pid];
  if (!tables) return;

  if (tableIdx >= 0 && tableIdx < tables.length) {
    // replace existing table, keep name if parsed name is generic
    var oldName = tables[tableIdx].name;
    tables[tableIdx] = parsed;
    if (parsed.name === 'Pasted table' && oldName) tables[tableIdx].name = oldName;
  } else {
    tables.push(parsed);
  }

  // save
  var recipeJson = _serializeRecipeState(tables);
  await api('PUT', '/api/protocols/' + pid, { recipe: recipeJson });
  if (p) p.recipe = recipeJson;
  // refresh panel
  if (p) {
    var panelEl = document.getElementById('pp-' + pid);
    if (panelEl) { panelEl.innerHTML = _panelBody(p); protoLoadRunHistory(pid); }
  }
  toast('Table pasted (' + parsed.rows.length + ' rows)');
}

async function protoTblPasteInto(pid, ti) {
  // Paste into a table in edit mode — replaces the table content
  var text = await _readClipboard();
  var parsed = _parseClipboardTable(text);
  if (!parsed) { toast('Could not parse clipboard', true); return; }

  var tables = _recipeState[pid];
  if (!tables || !tables[ti]) return;

  var oldName = tables[ti].name;
  tables[ti].columns = parsed.columns;
  tables[ti].rows = parsed.rows;
  if (parsed.name !== 'Pasted table') tables[ti].name = parsed.name;

  _refreshRecipeEdit(pid);
  toast('Pasted ' + parsed.rows.length + ' rows into table');
}

async function protoPasteNewTable(pid) {
  // Paste clipboard as a brand new table in edit mode
  var text = await _readClipboard();
  var parsed = _parseClipboardTable(text);
  if (!parsed) { toast('Could not parse clipboard', true); return; }

  var tables = _recipeState[pid];
  if (!tables) return;
  tables.push(parsed);
  _refreshRecipeEdit(pid);
  toast('New table pasted (' + parsed.rows.length + ' rows)');
}

// ── recipe editing ────────────────────────────────────────────────────────────
function _recipeEditAllHTML(pid, tables) {
  var html = '';
  tables.forEach(function(t, ti) {
    html += '<div class="recipe-table-wrap" id="rtw-' + pid + '-' + ti + '"><div class="recipe-table-header">' +
      '<input type="text" value="' + esc(t.name || '') + '" placeholder="Table name" spellcheck="false" oninput="protoRenameTable(' + pid + ',' + ti + ',this.value)"/>';
    if (tables.length > 1) html += '<button class="btn" style="font-size:11px" onclick="protoMoveTable(' + pid + ',' + ti + ',-1)"' + (ti===0?' disabled':'') + '>&#9650;</button><button class="btn" style="font-size:11px" onclick="protoMoveTable(' + pid + ',' + ti + ',1)"' + (ti===tables.length-1?' disabled':'') + '>&#9660;</button>';
    html += '<button class="btn" style="font-size:11px" onclick="protoSplitTable(' + pid + ',' + ti + ')" title="Split table at a row">&#9986; Split</button>';
    html += '<button class="btn" style="font-size:11px;color:#c0392b" onclick="protoDelTable(' + pid + ',' + ti + ')">&#215; Remove</button></div><div class="recipe-table-body">' + _singleTableEditHTML(pid, ti, t) + '</div></div>';
  });
  return html + '<div style="margin-top:8px;display:flex;gap:6px"><button class="btn" onclick="protoAddTable(' + pid + ')">+ Add table</button><button class="btn" style="color:#5b7a5e" onclick="protoPasteNewTable(' + pid + ')">&#128203; Paste as new table</button></div>';
}

function _singleTableEditHTML(pid, ti, t) {
  if (!t.rows.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic;margin-bottom:6px">No components yet</div><div class="recipe-add-row"><button class="btn" onclick="protoTblAddRow(' + pid + ',' + ti + ',-1)">+ Row</button><button class="btn" onclick="protoTblAddCol(' + pid + ',' + ti + ',-1)">+ Column</button></div>';
  var nc = t.columns.length;
  var html = '<div class="recipe-wrap"><table class="recipe-table"><thead><tr>';
  // column headers with move left/right
  t.columns.forEach(function(c, ci) {
    html += '<th><div style="display:flex;align-items:center;gap:2px">';
    html += '<button class="col-mv" onclick="protoTblMoveCol(' + pid + ',' + ti + ',' + ci + ',-1)" title="Move left"' + (ci===0?' disabled':'') + '>&#9664;</button>';
    html += '<input class="col-rename" type="text" value="' + esc(c) + '" oninput="protoTblRenameCol(' + pid + ',' + ti + ',' + ci + ',this.value)"/>';
    html += '<button class="col-mv" onclick="protoTblMoveCol(' + pid + ',' + ti + ',' + ci + ',1)" title="Move right"' + (ci===nc-1?' disabled':'') + '>&#9654;</button>';
    html += '<button class="del-col" onclick="protoTblDelCol(' + pid + ',' + ti + ',' + ci + ')">&#215;</button>';
    html += '</div></th>';
  });
  html += '<th style="width:80px"></th></tr></thead><tbody>';
  // rows with move up/down + insert above
  t.rows.forEach(function(row, ri) {
    html += '<tr>';
    t.columns.forEach(function(_, ci) {
      html += '<td><input type="text" value="' + esc(row[ci] || '') + '" oninput="protoTblCell(' + pid + ',' + ti + ',' + ri + ',' + ci + ',this.value)"/></td>';
    });
    html += '<td style="padding:0;white-space:nowrap"><div style="display:flex;gap:1px;align-items:center;justify-content:center">';
    html += '<button class="row-mv" onclick="protoTblMoveRow(' + pid + ',' + ti + ',' + ri + ',-1)" title="Move up"' + (ri===0?' disabled':'') + '>&#9650;</button>';
    html += '<button class="row-mv" onclick="protoTblMoveRow(' + pid + ',' + ti + ',' + ri + ',1)" title="Move down"' + (ri===t.rows.length-1?' disabled':'') + '>&#9660;</button>';
    html += '<button class="row-mv" onclick="protoTblAddRow(' + pid + ',' + ti + ',' + ri + ')" title="Insert row below">&#10010;</button>';
    html += '<button class="del-row" style="width:auto;height:auto;padding:2px 4px" onclick="protoTblDelRow(' + pid + ',' + ti + ',' + ri + ')">&#215;</button>';
    html += '</div></td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="recipe-add-row">';
  html += '<button class="btn" onclick="protoTblAddRow(' + pid + ',' + ti + ',-1)">+ Row at end</button>';
  html += '<button class="btn" onclick="protoTblAddCol(' + pid + ',' + ti + ',-1)">+ Column at end</button>';
  html += '<button class="btn" onclick="protoTblInsertColAt(' + pid + ',' + ti + ')">+ Column at position...</button>';
  html += '<button class="btn" style="color:#5b7a5e" onclick="protoTblPasteInto(' + pid + ',' + ti + ')">&#128203; Paste into table</button>';
  html += '</div>';
  return html;
}

function protoTblCell(pid, ti, ri, ci, v) { if (_recipeState[pid]&&_recipeState[pid][ti]&&_recipeState[pid][ti].rows[ri]) _recipeState[pid][ti].rows[ri][ci]=v; }
function protoTblRenameCol(pid, ti, ci, v) { if (_recipeState[pid]&&_recipeState[pid][ti]) _recipeState[pid][ti].columns[ci]=v; }
function protoRenameTable(pid, ti, v) { if (_recipeState[pid]&&_recipeState[pid][ti]) _recipeState[pid][ti].name=v; }

function protoTblAddRow(pid, ti, afterRi) {
  var t=(_recipeState[pid]||[])[ti]; if(!t)return;
  var newRow = t.columns.map(function(){return '';});
  if (afterRi < 0) t.rows.push(newRow);
  else t.rows.splice(afterRi + 1, 0, newRow);
  _refreshRecipeEdit(pid);
}
function protoTblDelRow(pid, ti, ri) { var t=(_recipeState[pid]||[])[ti]; if(!t)return; t.rows.splice(ri,1); _refreshRecipeEdit(pid); }
function protoTblMoveRow(pid, ti, ri, dir) {
  var t=(_recipeState[pid]||[])[ti]; if(!t)return;
  var ni = ri + dir; if(ni<0||ni>=t.rows.length) return;
  var tmp = t.rows[ri]; t.rows[ri] = t.rows[ni]; t.rows[ni] = tmp;
  _refreshRecipeEdit(pid);
}

function protoTblAddCol(pid, ti, afterCi) {
  var n=prompt('Column name:'); if(!n)return;
  var t=(_recipeState[pid]||[])[ti]; if(!t)return;
  if (afterCi < 0) {
    t.columns.push(n); t.rows.forEach(function(r){r.push('');});
  } else {
    t.columns.splice(afterCi + 1, 0, n);
    t.rows.forEach(function(r){r.splice(afterCi + 1, 0, '');});
  }
  _refreshRecipeEdit(pid);
}
function protoTblInsertColAt(pid, ti) {
  var t=(_recipeState[pid]||[])[ti]; if(!t)return;
  var pos = prompt('Insert before column number (1-' + (t.columns.length + 1) + '):');
  if (!pos) return;
  var idx = parseInt(pos) - 1;
  if (isNaN(idx) || idx < 0) idx = 0;
  if (idx > t.columns.length) idx = t.columns.length;
  var n = prompt('Column name:'); if(!n)return;
  t.columns.splice(idx, 0, n);
  t.rows.forEach(function(r){r.splice(idx, 0, '');});
  _refreshRecipeEdit(pid);
}
function protoTblDelCol(pid, ti, ci) { var t=(_recipeState[pid]||[])[ti]; if(!t||t.columns.length<=1){toast('Need at least one column',true);return;} t.columns.splice(ci,1); t.rows.forEach(function(r){r.splice(ci,1);}); _refreshRecipeEdit(pid); }
function protoTblMoveCol(pid, ti, ci, dir) {
  var t=(_recipeState[pid]||[])[ti]; if(!t)return;
  var ni = ci + dir; if(ni<0||ni>=t.columns.length) return;
  // swap column headers
  var tmpC = t.columns[ci]; t.columns[ci] = t.columns[ni]; t.columns[ni] = tmpC;
  // swap data in every row
  t.rows.forEach(function(r) { var tmpV = r[ci]; r[ci] = r[ni]; r[ni] = tmpV; });
  _refreshRecipeEdit(pid);
}

function protoSplitTable(pid, ti) {
  var t=(_recipeState[pid]||[])[ti]; if(!t||t.rows.length<2){toast('Need at least 2 rows to split',true);return;}
  var pos = prompt('Split after row number (1-' + (t.rows.length - 1) + '):');
  if (!pos) return;
  var splitAt = parseInt(pos);
  if (isNaN(splitAt) || splitAt < 1 || splitAt >= t.rows.length) { toast('Invalid row number', true); return; }
  var topRows = t.rows.slice(0, splitAt);
  var bottomRows = t.rows.slice(splitAt);
  // update existing table
  t.rows = topRows;
  // insert new table after this one
  var newTable = {
    name: (t.name || 'Table') + ' (cont.)',
    columns: t.columns.slice(),
    rows: bottomRows.map(function(r) { return r.slice(); })
  };
  _recipeState[pid].splice(ti + 1, 0, newTable);
  _refreshRecipeEdit(pid);
  toast('Table split into two');
}

function protoAddTable(pid) { var t=_recipeState[pid]; if(!t)return; t.push({name:'Table '+(t.length+1),columns:DEFAULT_RECIPE.columns.slice(),rows:[]}); _refreshRecipeEdit(pid); }
function protoDelTable(pid, ti) { var t=_recipeState[pid]; if(!t||t.length<=1){toast('Need at least one table',true);return;} t.splice(ti,1); _refreshRecipeEdit(pid); }
function protoMoveTable(pid, ti, dir) { var t=_recipeState[pid]; if(!t)return; var ni=ti+dir; if(ni<0||ni>=t.length)return; var tmp=t[ti]; t[ti]=t[ni]; t[ni]=tmp; _refreshRecipeEdit(pid); }
function _refreshRecipeEdit(pid) { var b=document.getElementById('recipe-body-'+pid); if(b&&_recipeState[pid]) b.innerHTML=_recipeEditAllHTML(pid,_recipeState[pid]); }

// ── active runs ───────────────────────────────────────────────────────────────
function _getActiveRuns() { try { return JSON.parse(localStorage.getItem('lab_proto_runs')||'[]'); } catch(e) { return []; } }
async function _loadAndRenderActiveRuns() {
  var c=document.getElementById('active-runs-container'); if(!c)return;
  try { var runs=typeof spGetActiveRuns==='function'?await spGetActiveRuns():_getActiveRuns(); c.innerHTML=runs.length?_buildActiveRunsHTML(runs):''; } catch(e){c.innerHTML='';}
}
function _buildActiveRunsHTML(runs) {
  if(!runs.length)return '';
  var h='<div style="margin-bottom:20px"><div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px">Active Runs</div>';
  runs.forEach(function(run){
    var done=run.steps.filter(function(s){return s.done;}).length, pct=Math.round((done/run.steps.length)*100);
    h+='<div class="active-run-card"><div class="active-run-info"><div class="active-run-title">&#9654; '+esc(run.protocol.title)+'</div><div class="active-run-meta">'+done+'/'+run.steps.length+' steps &nbsp;&#183;&nbsp; &#128193; '+esc(run.group_name)+'</div><div class="active-run-bar"><div class="active-run-fill" style="width:'+pct+'%"></div></div></div><div style="display:flex;gap:6px;flex-shrink:0"><button class="btn primary" style="font-size:12px" data-runid="'+esc(run.runId)+'" onclick="spResumeRunById(this.dataset.runid)">&#9654; Resume</button><button class="btn" style="font-size:12px;color:#c0392b" data-runid="'+esc(run.runId)+'" onclick="spDiscardRunById(this.dataset.runid)">Discard</button></div></div>';
  });
  return h+'</div>';
}

// ── run history ───────────────────────────────────────────────────────────────
function _runHistoryRowHTML(run) {
  var pct=run.steps_total?Math.round((run.steps_done/run.steps_total)*100):0, date=run.date||run.created.split('T')[0];
  var steps=[]; try{steps=JSON.parse(run.steps_json||'[]');}catch(e){}
  var sh=''; if(steps.length){sh='<ol class="run-detail-steps">'; steps.forEach(function(s){sh+='<li class="'+(s.done?'done':'')+'">'+esc(s.text);if(s.deviation&&s.deviation.trim())sh+=' <span class="run-detail-deviation">&#8594; '+esc(s.deviation)+'</span>';sh+='</li>';}); sh+='</ol>';}
  var rh=''; try{_parseRecipeArray(run.recipe_json).forEach(function(rec){if(rec&&rec.rows&&rec.rows.length){rh+='<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin:10px 0 6px">'+esc(rec.name||'Recipe')+'</div><div style="overflow-x:auto"><table class="recipe-table"><thead><tr>';rec.columns.forEach(function(c){rh+='<th>'+esc(c)+'</th>';});rh+='</tr></thead><tbody>';rec.rows.forEach(function(row){rh+='<tr>';rec.columns.forEach(function(_,ci){rh+='<td style="padding:5px 10px;font-size:12px">'+esc(row[ci]||'')+'</td>';});rh+='</tr>';});rh+='</tbody></table></div>';}});}catch(e){}
  return '<div class="run-history-row" id="rhr-'+run.id+'"><div class="run-history-summary" onclick="protoToggleRunDetail('+run.id+')"><div class="run-history-date">'+esc(date)+'</div><div class="run-history-pct">'+pct+'% done</div>'+(run.deviations?'<div class="run-history-devs">'+run.deviations+' dev</div>':'')+'<div class="run-history-group">&#128193; '+esc(run.group_name)+'</div><div style="font-size:11px;color:#b0a898">&#9660;</div></div><div class="run-history-detail">'+sh+rh+(run.entry_id?'<div style="margin-top:10px"><button class="btn" style="font-size:12px" onclick="protoViewEntry('+run.entry_id+')">&#128196; View entry</button></div>':'')+'</div></div>';
}
function protoToggleRunDetail(id) { document.getElementById('rhr-'+id)?.classList.toggle('open'); }
function protoViewEntry(id) { if(typeof setView==='function'){S._jumpToEntry=id;setView('notebook');} }

// ── tag input ─────────────────────────────────────────────────────────────────
function _tagInputHTML(key, initial) {
  _tagState[key]=initial||[];
  return '<div class="tag-input-wrap" id="tags-'+key+'">'+_tagChipsHTML(key)+'<input type="text" placeholder="Add tag, press Enter" spellcheck="false" onkeydown="_tagKeydown(event,\''+key+'\')"/></div>';
}
function _tagChipsHTML(key) { return (_tagState[key]||[]).map(function(t,i){return '<span class="tag-chip">'+esc(t)+'<button onclick="_removeTag(\''+key+'\','+i+')">&#215;</button></span>';}).join(''); }
function _tagKeydown(e, key) { if(e.key!=='Enter'&&e.key!==',')return; e.preventDefault(); var v=e.target.value.trim().replace(/,/g,''); if(!v)return; if(_tagState[key].indexOf(v)<0)_tagState[key].push(v); _refreshTags(key); }
function _removeTag(key, idx) { _tagState[key].splice(idx,1); _refreshTags(key); }
function _refreshTags(key) { var w=document.getElementById('tags-'+key); if(!w)return; w.innerHTML=_tagChipsHTML(key)+'<input type="text" placeholder="Add tag, press Enter" spellcheck="false" onkeydown="_tagKeydown(event,\''+key+'\')"/>'; w.querySelector('input')?.focus(); }
function _getTags(key) { return _tagState[key]||[]; }

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
function protoOpenPanel(pid) {
  if (_openPanels.indexOf(pid) < 0) {
    _openPanels.push(pid);
    var p = (S.protocols||[]).find(function(x){return x.id===pid;});
    if (p) {
      _recipeState[pid] = JSON.parse(JSON.stringify(_parseRecipeArray(p.recipe)));
      var content = document.getElementById('proto-panel-content');
      if (content) {
        var empty = content.querySelector('.proto-panel-empty'); if (empty) empty.remove();
        var div = document.createElement('div'); div.id = 'pp-'+pid; div.className = 'proto-panel';
        div.innerHTML = _panelBody(p); content.appendChild(div);
      }
    }
  }
  _activePanel = pid;
  _refreshPanelTabs(); _showActivePanel();
  document.querySelectorAll('.pli').forEach(function(el){el.classList.toggle('selected',el.id==='pli-'+pid);});
  protoLoadRunHistory(pid);
}

function protoClosePanel(pid) {
  var idx = _openPanels.indexOf(pid); if (idx<0) return;
  _openPanels.splice(idx, 1); delete _editState[pid];
  var panel = document.getElementById('pp-'+pid); if (panel) panel.remove();
  if (_activePanel===pid) _activePanel = _openPanels.length ? _openPanels[_openPanels.length-1] : null;
  _refreshPanelTabs(); _showActivePanel();
  document.querySelectorAll('.pli').forEach(function(el){el.classList.toggle('selected',_activePanel&&el.id==='pli-'+_activePanel);});
}

function protoSwitchPanel(pid) {
  _activePanel = pid; _refreshPanelTabs(); _showActivePanel();
  document.querySelectorAll('.pli').forEach(function(el){el.classList.toggle('selected',el.id==='pli-'+pid);});
}

function _refreshPanelTabs() {
  var tabs = document.getElementById('proto-panel-tabs'); if (!tabs) return;
  if (!_openPanels.length) { tabs.innerHTML = ''; return; }
  tabs.innerHTML = _openPanels.map(function(pid) {
    var p = (S.protocols||[]).find(function(x){return x.id===pid;});
    var title = p ? p.title : '#'+pid; if (title.length>28) title = title.substring(0,26)+'...';
    return '<div class="proto-ptab'+(pid===_activePanel?' active':'')+'" onclick="protoSwitchPanel('+pid+')" data-pid="'+pid+'"><span class="proto-ptab-title">'+esc(title)+'</span><button class="ptab-close" onclick="event.stopPropagation();protoClosePanel('+pid+')">&#215;</button></div>';
  }).join('');
}

function _refreshPanelTab(pid) {
  var tab = document.querySelector('.proto-ptab[data-pid="'+pid+'"] .proto-ptab-title');
  if (tab) { var p=(S.protocols||[]).find(function(x){return x.id===pid;}); if(p){var t=p.title;tab.textContent=t.length>28?t.substring(0,26)+'...':t;} }
}

function _showActivePanel() {
  document.querySelectorAll('.proto-panel').forEach(function(el){el.classList.remove('active');});
  if (_activePanel) { var p=document.getElementById('pp-'+_activePanel); if(p) p.classList.add('active'); }
  var content = document.getElementById('proto-panel-content');
  if (content && !_openPanels.length && !content.querySelector('.proto-panel-empty')) {
    content.innerHTML = '<div class="proto-panel-empty">Select a protocol to view it</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN VIEW
// ═══════════════════════════════════════════════════════════════════════════════
async function renderProtocols(el) {
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];
  var html = '<div id="active-runs-container"></div>';
  html += '<div class="proto-import-box">' + _buildImportUI() + '</div>';
  html += '<div class="proto-layout"><div class="proto-sidebar"><div class="proto-sidebar-inner">';
  html += '<div class="proto-search-bar"><input type="text" id="proto-search" placeholder="Search..." oninput="protoFilter()" spellcheck="false"/></div>';
  html += S.protocols.length ? '<div id="proto-list">'+S.protocols.map(_compactCard).join('')+'</div>' : '<div style="color:#8a7f72;font-size:13px;text-align:center;padding:20px">No protocols yet</div>';
  html += '</div></div><div class="proto-panels"><div class="proto-panel-tabs" id="proto-panel-tabs"></div>';
  html += '<div class="proto-panel-content" id="proto-panel-content"><div class="proto-panel-empty">Select a protocol to view it</div></div></div></div>';
  el.innerHTML = html;
  // restore panels
  var prev = _openPanels.slice(), prevA = _activePanel;
  _openPanels = []; _activePanel = null;
  prev.forEach(function(pid){ if((S.protocols||[]).some(function(p){return p.id===pid;})) protoOpenPanel(pid); });
  if (prevA && _openPanels.indexOf(prevA)>=0) protoSwitchPanel(prevA);
  _loadAndRenderActiveRuns();
  try { var r=await fetch('/api/3090/status'); if(r.ok){var d=await r.json(); if(d.extracting&&Object.keys(d.extracting).length>0) _startExtractionPoll();} } catch(e){}
}

function _compactCard(p) {
  var tags = JSON.parse(p.tags||'[]');
  var hasSteps = p.steps && p.steps !== '[]' && p.steps !== 'null';
  var icon = {manual:'&#9998;',file:'&#128196;',paste:'&#128203;'}[p.source_type] || '&#127760;';
  return '<div class="pli'+(_activePanel===p.id?' selected':'')+'" id="pli-'+p.id+'" onclick="protoOpenPanel('+p.id+')">' +
    '<div class="pli-title">'+esc(p.title)+'</div><div class="pli-meta"><span>'+icon+'</span>'+
    (!hasSteps?'<span class="pli-badge no-steps">no steps</span>':'')+
    tags.map(function(t){return '<span class="tag" style="font-size:10px">'+esc(t)+'</span>';}).join('')+
    '</div></div>';
}

function _panelBody(p) {
  var steps=[], isStructured=false;
  try{var parsed=JSON.parse(p.steps||'[]');if(Array.isArray(parsed)&&parsed.length&&typeof parsed[0].text!=='undefined'){steps=parsed;isStructured=true;}}catch(e){}
  var hasSteps=p.steps&&p.steps!=='[]'&&p.steps!=='null';
  var tags=JSON.parse(p.tags||'[]');
  var estTime = _estimateTime(steps);
  var ac = p.auto_complete || 'manual';
  var h='<div class="extraction-banner" id="extract-banner-'+p.id+'" style="display:none"><span class="proto-spinner"></span> Checking...</div>';
  // header
  h+='<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap"><div style="flex:1;min-width:200px">';
  h+='<div style="font-weight:700;font-size:16px;color:#4a4139;margin-bottom:4px">'+esc(p.title)+'</div>';
  if(p.url) h+='<div style="font-size:11px;color:#8a7f72;word-break:break-all"><a href="'+esc(p.url)+'" target="_blank">'+esc(p.url)+'</a></div>';
  // meta row: tags, est time, auto-complete
  h+='<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px">';
  if(tags.length) h+=tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>';}).join('');
  if(estTime>0) h+='<span style="color:#5b7a5e;font-weight:600">&#9202; ~'+_fmtDurShort(estTime)+'</span>';
  if(ac!=='manual') h+='<span style="color:#856404;font-weight:600;background:#fff3cd;padding:1px 6px;border-radius:3px">&#10003; '+_acLabel(ac)+'</span>';
  h+='</div>';
  h+='</div><div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">';
  h+='<button class="btn" style="color:#5b7a5e" onclick="protoOpenRun('+p.id+')">&#9654; Run</button>';
  h+='<button class="btn" onclick="protoEdit('+p.id+')">&#9998; Edit</button>';
  if(p.source_type!=='manual') h+='<button class="btn" style="color:#5b7a5e" onclick="protoReExtract('+p.id+')">&#10227; Re-extract</button>';
  h+='<button class="btn" onclick="protoReparseTables('+p.id+')">&#128295; Fix tables</button>';
  h+='<button class="btn" style="color:#5b7a5e" onclick="protoReview('+p.id+')">&#129302; Review</button>';
  h+='<button class="btn" onclick="protoClone('+p.id+')">&#128464; Clone</button>';
  h+='<button class="btn" style="color:#c0392b" onclick="protoDelete('+p.id+')">&#128465; Delete</button>';
  h+='</div></div>';
  // steps
  if(!hasSteps) h+='<div style="color:#8a7f72;font-size:13px;font-style:italic;margin-bottom:16px">No steps yet — extract or add manually.</div>';
  else if(isStructured) h+='<ol class="steps-list">'+steps.map(function(s){return '<li>'+_renderStepText(s.text)+(s.note?'<div style="font-size:11px;color:#8a7f72;margin:2px 0 4px;padding-left:4px;border-left:2px solid #e8e2d8">'+esc(s.note)+'</div>':'')+'</li>';}).join('')+'</ol>';
  else h+='<div class="steps-text">'+esc(p.steps)+'</div>';
  // recipe
  h+='<div class="recipe-section"><div class="recipe-section-head"><span>Reaction Tables</span><div class="recipe-edit-actions" id="recipe-actions-'+p.id+'"><button class="btn" onclick="protoRecipeEdit('+p.id+')">Edit tables</button></div></div>';
  h+='<div id="recipe-body-'+p.id+'">'+_recipeDisplayHTML(p.recipe)+'</div></div>';
  // history
  h+='<div class="run-history-section"><div class="run-history-head">Run History</div><div id="run-history-'+p.id+'"><div style="color:#8a7f72;font-size:13px;font-style:italic">Loading...</div></div></div>';
  // notes
  h+='<div class="field" style="margin-top:14px"><label>Notes / modifications</label><textarea id="pn-'+p.id+'" placeholder="Your modifications, tips, observations...">'+esc(p.notes)+'</textarea></div>';
  h+='<div class="save-row"><button class="btn primary" onclick="protoSave('+p.id+')">Save notes</button></div>';
  return h;
}

// ── import UI ─────────────────────────────────────────────────────────────────
function _buildImportUI() {
  return '<div class="proto-import-tabs">' +
    '<button class="proto-tab active" onclick="protoTab(\'url\',this)">URL</button>' +
    '<button class="proto-tab" onclick="protoTab(\'paste\',this)">Paste text</button>' +
    '<button class="proto-tab" onclick="protoTab(\'file\',this)">Upload file</button>' +
    '<button class="proto-tab" onclick="protoTab(\'manual\',this)">Write manually</button></div>' +
  '<div id="pt-url"><div class="proto-import-col"><div class="proto-import-row"><input type="text" id="proto-url" placeholder="https://www.protocols.io/..." spellcheck="false"/><input type="text" id="proto-title-url" placeholder="Protocol name" style="width:200px" spellcheck="false"/></div>' +
    '<div style="font-size:11px;color:#8a7f72">Tags</div>'+_tagInputHTML('import-url',[])+'<div style="text-align:right"><button class="btn primary" onclick="protoAddUrl()">Fetch + Extract</button></div></div></div>' +
  '<div id="pt-paste" style="display:none"><div class="proto-import-col"><input type="text" id="proto-title-paste" placeholder="Protocol name" spellcheck="false"/><textarea id="proto-paste-text" placeholder="Paste protocol text here..."></textarea>' +
    '<div style="font-size:11px;color:#8a7f72">Tags</div>'+_tagInputHTML('import-paste',[])+'<div style="text-align:right"><button class="btn primary" onclick="protoAddPaste()">Extract Steps</button></div></div></div>' +
  '<div id="pt-file" style="display:none"><div class="proto-import-col"><div class="proto-import-row"><input type="text" id="proto-title-file" placeholder="Protocol name" spellcheck="false"/><input type="file" id="proto-file" accept=".txt,.md,.pdf,.docx"/></div>' +
    '<div style="font-size:11px;color:#8a7f72">Tags</div>'+_tagInputHTML('import-file',[])+'<div style="text-align:right"><button class="btn primary" onclick="protoAddFile()">Upload + Extract</button></div></div></div>' +
  '<div id="pt-manual" style="display:none"><div class="proto-import-col"><input type="text" id="proto-title-manual" placeholder="Protocol name" spellcheck="false"/><div id="manual-steps-list"></div>' +
    '<div style="display:flex;gap:6px"><button class="btn" onclick="manualAddStep()">+ Step</button><button class="btn" style="color:#5b7a5e" onclick="manualLinkProtocol()">&#8599; Link protocol</button></div>' +
    '<div class="manual-recipe-section"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div class="manual-recipe-label">Reaction Tables <span style="font-weight:400;text-transform:none;font-size:11px">(optional)</span></div><button class="btn" onclick="manualAddTable()">+ Add table</button></div><div id="manual-recipe-body"></div></div>' +
    '<div style="font-size:11px;color:#8a7f72;margin-top:8px">Tags</div>'+_tagInputHTML('import-manual',[])+'<div style="text-align:right;margin-top:10px"><button class="btn primary" onclick="protoAddManual()">Save Protocol</button></div></div></div>';
}

function protoTab(name, btn) {
  document.querySelectorAll('.proto-import-tabs .proto-tab').forEach(function(t){t.classList.remove('active');});
  btn.classList.add('active');
  ['url','paste','file','manual'].forEach(function(t){var el=document.getElementById('pt-'+t);if(el)el.style.display=(t===name)?'':'none';});
  if(name==='manual'){_manualSteps=[''];_manualRecipes=[];_refreshManualSteps();_refreshManualRecipe();}
}

function protoFilter() {
  var q=(document.getElementById('proto-search')?.value||'').toLowerCase();
  document.querySelectorAll('.pli').forEach(function(c){c.style.display=(!q||c.textContent.toLowerCase().includes(q))?'':'none';});
}

async function protoLoadRunHistory(pid) {
  var c=document.getElementById('run-history-'+pid); if(!c)return;
  try{var d=await api('GET','/api/protocols/'+pid+'/runs'); c.innerHTML=(d.runs||[]).length?(d.runs||[]).map(_runHistoryRowHTML).join(''):'<div style="color:#8a7f72;font-size:13px;font-style:italic">No runs yet.</div>';}
  catch(e){c.innerHTML='<div style="color:#8a7f72;font-size:13px;font-style:italic">Could not load history.</div>';}
}

// ── recipe edit/save/cancel ───────────────────────────────────────────────────
function protoRecipeEdit(pid) {
  var p=(S.protocols||[]).find(function(x){return x.id===pid;});
  _recipeState[pid]=JSON.parse(JSON.stringify(p?_parseRecipeArray(p.recipe):_recipeState[pid]||[{name:'Recipe',columns:DEFAULT_RECIPE.columns.slice(),rows:[]}]));
  document.getElementById('recipe-body-'+pid).innerHTML=_recipeEditAllHTML(pid,_recipeState[pid]);
  document.getElementById('recipe-actions-'+pid).innerHTML='<button class="btn primary" onclick="protoRecipeSave('+pid+')">Save tables</button><button class="btn" onclick="protoRecipeCancel('+pid+')">Cancel</button>';
}
function protoRecipeCancel(pid) {
  var p=(S.protocols||[]).find(function(x){return x.id===pid;}); if(!p)return;
  _recipeState[pid]=JSON.parse(JSON.stringify(_parseRecipeArray(p.recipe)));
  document.getElementById('recipe-body-'+pid).innerHTML=_recipeDisplayHTML(p.recipe);
  document.getElementById('recipe-actions-'+pid).innerHTML='<button class="btn" onclick="protoRecipeEdit('+pid+')">Edit tables</button>';
}
async function protoRecipeSave(pid) {
  var rj=_serializeRecipeState(_recipeState[pid]);
  await api('PUT','/api/protocols/'+pid,{recipe:rj});
  var p=(S.protocols||[]).find(function(x){return x.id===pid;}); if(p) p.recipe=rj;
  document.getElementById('recipe-body-'+pid).innerHTML=_recipeDisplayHTML(rj);
  document.getElementById('recipe-actions-'+pid).innerHTML='<button class="btn" onclick="protoRecipeEdit('+pid+')">Edit tables</button>';
  toast('Tables saved');
}

// ── manual entry ──────────────────────────────────────────────────────────────
function _manualTableHTML(ti) {
  var t=_manualRecipes[ti];
  var h='<div class="recipe-table-wrap"><div class="recipe-table-header"><input type="text" value="'+esc(t.name)+'" placeholder="Table name" spellcheck="false" oninput="manualTableRename('+ti+',this.value)"/><button class="btn" style="font-size:11px;color:#c0392b" onclick="manualDelTable('+ti+')">&#215; Remove</button></div><div class="recipe-table-body">';
  if(!t.rows.length) h+='<div style="color:#8a7f72;font-size:13px;font-style:italic;margin-bottom:6px">No components yet</div>';
  else{h+='<div style="overflow-x:auto"><table class="recipe-table" style="margin-bottom:6px"><thead><tr>';t.columns.forEach(function(c,ci){h+='<th>'+esc(c)+'<button class="del-col" onclick="manualTableDelCol('+ti+','+ci+')">&#215;</button></th>';});h+='<th style="width:28px"></th></tr></thead><tbody>';t.rows.forEach(function(row,ri){h+='<tr>';t.columns.forEach(function(col,ci){if(_isUnitCol(col)){var p=_parseAmountUnit(row[ci]||'');var uo=_UNITS.map(function(u){return '<option value="'+u+'"'+(p.unit===u?' selected':'')+'>'+u+'</option>';}).join('');h+='<td style="padding:0"><div style="display:flex;align-items:center"><input type="number" value="'+esc(p.num)+'" min="0" step="any" placeholder="0" style="width:68px;border:none;background:transparent;padding:6px 4px 6px 8px;font-size:13px;font-family:inherit;color:#4a4139;outline:none" oninput="manualTableCellUnit('+ti+','+ri+','+ci+',this.value,this.nextElementSibling.value)"/><select style="border:none;background:transparent;font-size:12px;color:#8a7f72;font-family:inherit;cursor:pointer;outline:none" onchange="manualTableCellUnit('+ti+','+ri+','+ci+',this.previousElementSibling.value,this.value)"><option value="">-</option>'+uo+'</select></div></td>';}else{h+='<td><input type="text" value="'+esc(row[ci]||'')+'" oninput="manualTableCell('+ti+','+ri+','+ci+',this.value)"/></td>';}});h+='<td><button class="del-row" onclick="manualTableDelRow('+ti+','+ri+')">&#215;</button></td></tr>';});h+='</tbody></table></div>';}
  return h+'<div class="recipe-add-row"><button class="btn" onclick="manualTableAddRow('+ti+')">+ Row</button><button class="btn" onclick="manualTableAddCol('+ti+')">+ Column</button></div></div></div>';
}
function _refreshManualRecipe(){var el=document.getElementById('manual-recipe-body');if(!el)return;el.innerHTML=_manualRecipes.length?_manualRecipes.map(function(_,ti){return _manualTableHTML(ti);}).join(''):'<div style="color:#8a7f72;font-size:13px;font-style:italic">No tables yet.</div>';}
function manualAddTable(){_manualRecipes.push({name:'Table '+(_manualRecipes.length+1),columns:['Component','Stock conc.','Volume (uL)','Final conc.'],rows:[]});_refreshManualRecipe();}
function manualDelTable(ti){_manualRecipes.splice(ti,1);_refreshManualRecipe();}
function manualTableRename(ti,n){if(_manualRecipes[ti])_manualRecipes[ti].name=n;}
function manualTableCell(ti,ri,ci,v){if(_manualRecipes[ti]&&_manualRecipes[ti].rows[ri])_manualRecipes[ti].rows[ri][ci]=v;}
function manualTableCellUnit(ti,ri,ci,num,unit){var v=(num||'').trim()+(unit?' '+unit:'');if(_manualRecipes[ti]&&_manualRecipes[ti].rows[ri])_manualRecipes[ti].rows[ri][ci]=v.trim();}
function manualTableAddRow(ti){var t=_manualRecipes[ti];if(!t)return;t.rows.push(t.columns.map(function(){return'';}));_refreshManualRecipe();}
function manualTableDelRow(ti,ri){var t=_manualRecipes[ti];if(!t)return;t.rows.splice(ri,1);_refreshManualRecipe();}
function manualTableAddCol(ti){var n=prompt('Column name:');if(!n)return;var t=_manualRecipes[ti];if(!t)return;t.columns.push(n);t.rows.forEach(function(r){r.push('');});_refreshManualRecipe();}
function manualTableDelCol(ti,ci){var t=_manualRecipes[ti];if(!t||t.columns.length<=1){toast('Need at least one column',true);return;}t.columns.splice(ci,1);t.rows.forEach(function(r){r.splice(ci,1);});_refreshManualRecipe();}

function _manualStepRowHTML(idx,value){return '<div class="manual-step-row" id="msr-'+idx+'"><span class="manual-step-num">'+(idx+1)+'.</span><input type="text" value="'+esc(value||'')+'" placeholder="Describe this step..." spellcheck="false" data-stepidx="'+idx+'" oninput="manualStepUpdate('+idx+',this.value)"/><button class="manual-del-step" onclick="manualDelStep('+idx+')">&#215;</button></div>';}
function _attachManualStepListeners(){var l=document.getElementById('manual-steps-list');if(!l)return;l.querySelectorAll('input[data-stepidx]').forEach(function(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();manualAddStep();}});});}
function _refreshManualSteps(){var l=document.getElementById('manual-steps-list');if(!l)return;l.innerHTML=_manualSteps.map(function(v,i){return _manualStepRowHTML(i,v);}).join('');_attachManualStepListeners();var last=document.querySelector('#msr-'+(_manualSteps.length-1)+' input');if(last)last.focus();}
function manualStepUpdate(idx,value){_manualSteps[idx]=value;}
function manualAddStep(){_manualSteps.push('');var l=document.getElementById('manual-steps-list');if(!l)return;var idx=_manualSteps.length-1;var w=document.createElement('div');w.innerHTML=_manualStepRowHTML(idx,'');l.appendChild(w.firstChild);var inp=document.querySelector('#msr-'+idx+' input');if(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();manualAddStep();}});inp.focus();}}
function manualDelStep(idx){if(_manualSteps.length<=1){_manualSteps[0]='';_refreshManualSteps();return;}_manualSteps.splice(idx,1);_refreshManualSteps();}

// ── import actions ────────────────────────────────────────────────────────────
async function protoAddUrl() {
  var url=document.getElementById('proto-url')?.value.trim(), title=document.getElementById('proto-title-url')?.value.trim();
  if(!url){toast('Paste a URL first',true);return;} if(!title){toast('Add a title',true);return;}
  var btn=document.querySelector('#pt-url .btn.primary'); if(btn){btn.textContent='Saving...';btn.disabled=true;}
  try{await api('POST','/api/protocols',{title:title,url:url,tags:_getTags('import-url')});document.getElementById('proto-url').value='';document.getElementById('proto-title-url').value='';_tagState['import-url']=[];_startExtractionPoll();await loadView();toast('Protocol saved — extracting in background');}
  catch(e){toast('Failed: '+e.message,true);} finally{if(btn){btn.textContent='Fetch + Extract';btn.disabled=false;}}
}

async function protoAddPaste() {
  var title=document.getElementById('proto-title-paste')?.value.trim(), text=document.getElementById('proto-paste-text')?.value.trim();
  if(!title){toast('Add a title',true);return;} if(!text){toast('Paste some text first',true);return;}
  var btn=document.querySelector('#pt-paste .btn.primary'); if(btn){btn.textContent='Saving...';btn.disabled=true;}
  try{await api('POST','/api/protocols/from-paste',{title:title,text:text,tags:_getTags('import-paste')});document.getElementById('proto-title-paste').value='';document.getElementById('proto-paste-text').value='';_tagState['import-paste']=[];_startExtractionPoll();await loadView();toast('Protocol saved — extracting in background');}
  catch(e){toast('Failed: '+e.message,true);} finally{if(btn){btn.textContent='Extract Steps';btn.disabled=false;}}
}

async function protoAddFile() {
  var title=document.getElementById('proto-title-file')?.value.trim(), fi=document.getElementById('proto-file'), file=fi?.files[0];
  if(!title){toast('Add a title',true);return;} if(!file){toast('Choose a file first',true);return;}
  var btn=document.querySelector('#pt-file .btn.primary'); if(btn){btn.textContent='Uploading...';btn.disabled=true;}
  try{var fd=new FormData();fd.append('title',title);fd.append('file',file);fd.append('tags',JSON.stringify(_getTags('import-file')));var resp=await fetch('/api/protocols/from-file',{method:'POST',body:fd});if(!resp.ok)throw new Error(await resp.text());document.getElementById('proto-title-file').value='';fi.value='';_tagState['import-file']=[];_startExtractionPoll();await loadView();toast('Protocol saved — extracting in background');}
  catch(e){toast('Failed: '+e.message,true);} finally{if(btn){btn.textContent='Upload + Extract';btn.disabled=false;}}
}

async function protoAddManual() {
  var title=(document.getElementById('proto-title-manual')?.value||'').trim();
  if(!title){toast('Add a title',true);return;}
  var steps=_manualSteps.filter(function(s){return s.trim();});
  if(!steps.length){toast('Add at least one step',true);return;}
  var recipe=_manualRecipes.length?JSON.stringify(_manualRecipes):null;
  var btn=document.querySelector('#pt-manual .btn.primary'); if(btn){btn.textContent='Saving...';btn.disabled=true;}
  try{await api('POST','/api/protocols/from-manual',{title:title,steps:steps,recipe:recipe,tags:_getTags('import-manual')});_manualSteps=[''];_manualRecipes=[];_tagState['import-manual']=[];await loadView();toast('Protocol saved');}
  catch(e){toast('Failed: '+e.message,true);} finally{if(btn){btn.textContent='Save Protocol';btn.disabled=false;}}
}

// ── protocol actions ──────────────────────────────────────────────────────────
async function protoReExtract(pid) {
  try{await api('POST','/api/protocols/'+pid+'/re-extract');_startExtractionPoll();var b=document.getElementById('extract-banner-'+pid);if(b){b.innerHTML='<span class="proto-spinner"></span> Starting extraction...';b.style.display='';}toast('Re-extracting in background');}
  catch(e){toast('Re-extract failed: '+e.message,true);}
}

async function protoSave(pid) { await api('PUT','/api/protocols/'+pid,{notes:document.getElementById('pn-'+pid)?.value||''}); toast('Saved'); }

async function protoDelete(pid) {
  if(!confirm('Delete this protocol?'))return;
  await api('DELETE','/api/protocols/'+pid); protoClosePanel(pid); await loadView(); toast('Deleted');
}

async function protoClone(pid) {
  try{var d=await api('POST','/api/protocols/'+pid+'/clone');await loadView();protoOpenPanel(d.id);toast('Cloned — editing copy');}
  catch(e){toast('Clone failed: '+e.message,true);}
}

async function protoReparseTables(pid) {
  if(!confirm('Send this protocol back to the LLM to fix/regenerate the tables?')) return;
  toast('Reparsing tables...');
  try {
    var data = await api('POST', '/api/protocols/' + pid + '/reparse-tables');
    if (data.recipe) {
      // Show in review modal as a single table diff
      var p = (S.protocols||[]).find(function(x){return x.id===pid;});
      var oldRecipe = p ? (p.recipe || '') : '';
      _showTableReparseReview(pid, oldRecipe, data.recipe, data.tables_count);
    }
  } catch(e) { toast('Reparse failed: ' + e.message, true); }
}

function _showTableReparseReview(pid, oldRecipe, newRecipe, count) {
  var div = document.createElement('div');
  div.className = 'prv-overlay';
  div.id = 'prv-overlay';
  div.innerHTML = '<div class="prv-modal">' +
    '<div class="prv-header"><h3>&#128295; Table Reparse — ' + count + ' table(s) found</h3>' +
    '<div style="display:flex;gap:6px"><button class="btn primary" onclick="protoAcceptReparse('+pid+')">Accept new tables</button><button class="btn" onclick="document.getElementById(\'prv-overlay\').remove()">Keep original</button></div></div>' +
    '<div class="prv-body"><div class="prv-diff">' +
      '<div class="prv-diff-col"><div class="prv-diff-label">Current tables</div><div class="prv-diff-text" style="max-height:300px;overflow-y:auto">' + _recipePreviewText(oldRecipe) + '</div></div>' +
      '<div class="prv-diff-col new"><div class="prv-diff-label">Reparsed tables</div><div class="prv-diff-text" style="max-height:300px;overflow-y:auto">' + _recipePreviewText(newRecipe) + '</div></div>' +
    '</div></div></div>';
  document.body.appendChild(div);
  // store for accept
  div._newRecipe = newRecipe;
}

function _recipePreviewText(raw) {
  var tables = _parseRecipeArray(raw);
  return tables.map(function(t) {
    var lines = [esc(t.name || 'Recipe')];
    lines.push(t.columns.map(function(c){return esc(c);}).join(' | '));
    lines.push(t.columns.map(function(){return '---';}).join(' | '));
    t.rows.forEach(function(row) {
      lines.push(t.columns.map(function(_,ci){return esc(row[ci]||'');}).join(' | '));
    });
    return lines.join('\n');
  }).join('\n\n');
}

async function protoAcceptReparse(pid) {
  var overlay = document.getElementById('prv-overlay');
  var newRecipe = overlay ? overlay._newRecipe : null;
  if (!newRecipe) return;
  overlay.remove();
  await api('PUT', '/api/protocols/' + pid, { recipe: newRecipe });
  var p = (S.protocols||[]).find(function(x){return x.id===pid;});
  if (p) p.recipe = newRecipe;
  _recipeState[pid] = JSON.parse(JSON.stringify(_parseRecipeArray(newRecipe)));
  _reloadProtocol(pid);
  var panel = document.getElementById('pp-'+pid);
  if (panel && p) { panel.innerHTML = _panelBody(p); protoLoadRunHistory(pid); }
  toast('Tables updated');
}

async function protoReview(pid) {
  toast('Sending protocol for LLM review...');
  try {
    var data = await api('POST', '/api/protocols/' + pid + '/review');
    if (data.suggestions && data.suggestions.length) {
      _showReviewModal(pid, data.suggestions);
    } else {
      toast('No suggestions — protocol looks good!');
    }
  } catch(e) { toast('Review failed: ' + e.message, true); }
}

var _reviewState = {}; // pid -> {suggestions, accepted: Set, rejected: Set}

function _showReviewModal(pid, suggestions) {
  _reviewState[pid] = { suggestions: suggestions, accepted: {}, rejected: {} };
  var div = document.createElement('div');
  div.className = 'prv-overlay';
  div.id = 'prv-overlay';
  div.innerHTML = '<div class="prv-modal">' +
    '<div class="prv-header"><h3>&#129302; Protocol Review — ' + suggestions.length + ' suggestion(s)</h3>' +
    '<div style="display:flex;gap:6px"><button class="btn primary" onclick="protoApplyReview('+pid+')">Apply accepted</button><button class="btn" onclick="protoAcceptAllReview('+pid+')">Accept all</button><button class="btn" onclick="document.getElementById(\'prv-overlay\').remove()">Close</button></div></div>' +
    '<div class="prv-body" id="prv-body-'+pid+'">' + _buildReviewItems(pid) + '</div></div>';
  document.body.appendChild(div);
}

function _buildReviewItems(pid) {
  var rs = _reviewState[pid]; if (!rs) return '';
  return rs.suggestions.map(function(s, i) {
    var accepted = rs.accepted[i];
    var rejected = rs.rejected[i];
    var cls = accepted ? ' accepted' : (rejected ? ' rejected' : '');
    var typeBadge = '<span class="prv-badge ' + (s.type||'general') + '">' + esc(s.type||'general') + (s.index != null ? ' #'+(s.index+1) : '') + '</span>';
    return '<div class="prv-item'+cls+'" id="prv-item-'+pid+'-'+i+'">' +
      '<div class="prv-item-head">' + typeBadge + '<div class="prv-reason">' + esc(s.reason) + '</div></div>' +
      '<div class="prv-diff">' +
        (s.original ? '<div class="prv-diff-col"><div class="prv-diff-label">Before</div><div class="prv-diff-text">' + esc(s.original) + '</div></div>' : '') +
        '<div class="prv-diff-col new"><div class="prv-diff-label">' + (s.original ? 'After' : 'Add') + '</div><div class="prv-diff-text">' + esc(s.suggested) + '</div></div>' +
      '</div>' +
      '<div class="prv-item-actions">' +
        (accepted ? '<span style="color:#5b7a5e;font-size:12px;font-weight:600">&#10003; Accepted</span>' :
         rejected ? '<span style="color:#c0392b;font-size:12px">Rejected</span>' :
         '<button class="btn primary" style="font-size:12px" onclick="protoReviewAccept('+pid+','+i+')">&#10003; Accept</button><button class="btn" style="font-size:12px" onclick="protoReviewReject('+pid+','+i+')">&#10007; Reject</button>') +
      '</div></div>';
  }).join('');
}

function protoReviewAccept(pid, idx) {
  var rs = _reviewState[pid]; if (!rs) return;
  rs.accepted[idx] = true; delete rs.rejected[idx];
  var body = document.getElementById('prv-body-'+pid);
  if (body) body.innerHTML = _buildReviewItems(pid);
}

function protoReviewReject(pid, idx) {
  var rs = _reviewState[pid]; if (!rs) return;
  rs.rejected[idx] = true; delete rs.accepted[idx];
  var body = document.getElementById('prv-body-'+pid);
  if (body) body.innerHTML = _buildReviewItems(pid);
}

function protoAcceptAllReview(pid) {
  var rs = _reviewState[pid]; if (!rs) return;
  rs.suggestions.forEach(function(_, i) { rs.accepted[i] = true; delete rs.rejected[i]; });
  var body = document.getElementById('prv-body-'+pid);
  if (body) body.innerHTML = _buildReviewItems(pid);
}

async function protoApplyReview(pid) {
  var rs = _reviewState[pid]; if (!rs) return;
  var p = (S.protocols||[]).find(function(x){return x.id===pid;}); if (!p) return;

  // Apply accepted step suggestions
  var steps = [];
  try { steps = JSON.parse(p.steps || '[]'); } catch(e) {}
  var changed = false;

  rs.suggestions.forEach(function(s, i) {
    if (!rs.accepted[i]) return;
    if (s.type === 'step' && s.index != null && s.field === 'text' && steps[s.index]) {
      steps[s.index].text = s.suggested;
      changed = true;
    } else if (s.type === 'step' && s.index != null && s.field === 'note') {
      if (steps[s.index]) { steps[s.index].note = s.suggested; changed = true; }
    } else if (s.type === 'step' && s.field === 'new_step') {
      // insert after the referenced index, or at end
      var insertAt = (s.index != null && s.index < steps.length) ? s.index + 1 : steps.length;
      steps.splice(insertAt, 0, { text: s.suggested, note: s.reason });
      changed = true;
    }
    // general suggestions are informational — user applies manually
  });

  if (changed) {
    var stepsJson = JSON.stringify(steps);
    await api('PUT', '/api/protocols/' + pid, { steps: stepsJson });
    p.steps = stepsJson;
  }

  document.getElementById('prv-overlay')?.remove();
  delete _reviewState[pid];

  // refresh panel
  var panel = document.getElementById('pp-'+pid);
  if (panel) { panel.innerHTML = _panelBody(p); protoLoadRunHistory(pid); }
  _reloadProtocol(pid);
  toast(changed ? 'Review changes applied' : 'No step changes to apply');
}

function protoOpenRun(pid) {
  var p=(S.protocols||[]).find(function(x){return x.id===pid;}); if(!p)return;
  var steps=[]; try{var parsed=JSON.parse(p.steps||'[]');if(Array.isArray(parsed)&&parsed.length&&typeof parsed[0].text!=='undefined')steps=parsed;}catch(e){}
  if(!steps.length){toast('No structured steps yet — extract first',true);return;}
  if(typeof spLaunchRunDirect==='function') spLaunchRunDirect(p,null);
  else toast('Open the Scratch pad to run protocols',true);
}

// ── protocol link rendering + timer detection ─────────────────────────────────
function _renderStepText(text) {
  var rendered = text.split(/(\[@[^\]]+\]\(proto:\d+\))/g).map(function(part){
    var m=part.match(/^\[@([^\]]+)\]\(proto:(\d+)\)$/);
    if(m) return '<span class="proto-link-badge" onclick="protoOpenPanel('+m[2]+')" title="Open '+esc(m[1])+'">&#8599; '+esc(m[1])+'</span>';
    return esc(part);
  }).join('');
  // detect duration and add timer button
  if (typeof protoTimerParseDuration === 'function') {
    var dur = protoTimerParseDuration(text);
    if (dur > 0) {
      var label = text.length > 60 ? text.substring(0, 57) + '...' : text;
      rendered += ' <button class="proto-timer-btn" onclick="event.stopPropagation();protoTimerAdd(\'' + esc(label).replace(/'/g, "\\'") + '\',' + dur + ')" title="Start ' + _fmtDurShort(dur) + ' timer">&#9202; ' + _fmtDurShort(dur) + '</button>';
    }
  }
  return rendered;
}

function _fmtDurShort(sec) {
  if (sec >= 3600) { var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60); return h + 'h' + (m ? m + 'm' : ''); }
  if (sec >= 60) { var m = Math.floor(sec/60), s = sec % 60; return m + 'm' + (s ? s + 's' : ''); }
  return sec + 's';
}

function _estimateTime(steps) {
  if (!steps || !steps.length || typeof protoTimerParseDuration !== 'function') return 0;
  var total = 0;
  steps.forEach(function(s) { total += protoTimerParseDuration(s.text || ''); });
  return total;
}

var _AC_OPTIONS = [
  ['manual', 'Manual (never)'],
  ['end_of_day', 'End of day'],
  ['1d', 'After 1 day'],
  ['2d', 'After 2 days'],
  ['3d', 'After 3 days'],
  ['5d', 'After 5 days'],
  ['7d', 'After 7 days'],
  ['14d', 'After 14 days']
];

function _acLabel(val) {
  var opt = _AC_OPTIONS.find(function(o) { return o[0] === val; });
  return opt ? opt[1] : val;
}

function _acDropdownHTML(id, current) {
  return '<select id="'+id+'" style="font-size:12px;border:1px solid #d5cec0;border-radius:4px;padding:3px 8px;background:#faf8f4;font-family:inherit;color:#4a4139">' +
    _AC_OPTIONS.map(function(o) { return '<option value="'+o[0]+'"'+(current===o[0]?' selected':'')+'>'+o[1]+'</option>'; }).join('') + '</select>';
}

// ── link picker ───────────────────────────────────────────────────────────────
function _showLinkPicker(callback, excludePid) {
  var protos=(S.protocols||[]).filter(function(x){return x.id!==excludePid;});
  if(!protos.length){toast('No other protocols',true);return;}
  var opts=protos.map(function(p){return '<option value="'+p.id+'">'+esc(p.title)+'</option>';}).join('');
  var div=document.createElement('div'); div.id='proto-link-picker';
  div.style.cssText='position:fixed;inset:0;background:rgba(60,52,42,.35);display:flex;align-items:center;justify-content:center;z-index:2000';
  div.innerHTML='<div style="background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;padding:20px;min-width:320px;max-width:440px;width:100%"><div style="font-weight:600;font-size:14px;margin-bottom:10px">Link to protocol</div><input type="text" id="plp-q" placeholder="Search..." spellcheck="false" style="width:100%;margin-bottom:8px" oninput="plpFilter()"/><select id="plp-sel" size="6" style="width:100%;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-family:inherit;font-size:13px">'+opts+'</select><div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end"><button class="btn" onclick="document.getElementById(\'proto-link-picker\').remove()">Cancel</button><button class="btn primary" id="plp-confirm">Insert link</button></div></div>';
  document.body.appendChild(div);
  document.getElementById('plp-confirm').onclick=function(){var sel=document.getElementById('plp-sel');if(!sel||!sel.value){toast('Select a protocol',true);return;}var p=protos.find(function(x){return x.id===parseInt(sel.value);});if(!p)return;div.remove();callback(p.id,p.title);};
  document.getElementById('plp-q')?.focus();
}
function plpFilter(){var q=(document.getElementById('plp-q')?.value||'').toLowerCase();document.querySelectorAll('#plp-sel option').forEach(function(o){o.style.display=(!q||o.textContent.toLowerCase().includes(q))?'':'none';});}
function manualLinkProtocol(){
  var protos=(S.protocols||[]);if(!protos.length){toast('No protocols to link yet',true);return;}
  var focused=document.querySelector('#manual-steps-list input:focus');
  var targetInput=focused||document.querySelector('#manual-steps-list input:last-of-type');
  var targetIdx=targetInput?parseInt((targetInput.closest('[id^=msr-]')||{}).id?.replace('msr-','')||'0'):0;
  _showLinkPicker(function(pid,title){
    var link='[@'+title+'](proto:'+pid+')';
    var inp=document.querySelector('#msr-'+targetIdx+' input');
    if(inp){inp.value=inp.value?inp.value+' '+link:link;manualStepUpdate(targetIdx,inp.value);}
    else{_manualSteps.push(link);_refreshManualSteps();}
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INLINE EDIT MODE (with drag-and-drop)
// ═══════════════════════════════════════════════════════════════════════════════
var _dragPid = null, _dragIdx = null;

function protoEdit(pid) {
  var p=(S.protocols||[]).find(function(x){return x.id===pid;}); if(!p)return;
  var panel=document.getElementById('pp-'+pid); if(!panel)return;
  var steps=[]; try{var parsed=JSON.parse(p.steps||'[]');if(Array.isArray(parsed)&&parsed.length&&typeof parsed[0].text!=='undefined')steps=parsed;}catch(e){}
  _editState[pid]={title:p.title,steps:steps.map(function(s){return{text:s.text,note:s.note||''};})};
  if(!_editState[pid].steps.length) _editState[pid].steps=[{text:'',note:''}];
  var h='<div class="proto-edit-mode-banner">&#9998; <strong>Editing mode</strong> — drag steps to reorder, edit inline</div>';
  h+='<div style="margin-bottom:12px"><input id="pe-title-'+pid+'" type="text" value="'+esc(p.title)+'" style="font-weight:700;font-size:16px;color:#4a4139;border:none;border-bottom:2px solid #5b7a5e;background:transparent;outline:none;width:100%" oninput="_editState['+pid+'].title=this.value"/></div>';
  h+='<div id="pe-steps-'+pid+'">'+_buildEditStepsHTML(pid)+'</div>';
  h+='<div class="recipe-section" style="margin-top:16px"><div class="recipe-section-head"><span>Reaction Tables</span><div class="recipe-edit-actions" id="recipe-actions-'+pid+'"><button class="btn" onclick="protoRecipeEdit('+pid+')">Edit tables</button></div></div><div id="recipe-body-'+pid+'">'+_recipeDisplayHTML(p.recipe)+'</div></div>';
  // auto-complete setting
  h+='<div style="margin-top:16px;display:flex;align-items:center;gap:10px"><span style="font-size:12px;font-weight:600;color:#8a7f72">Auto-complete runs:</span>'+_acDropdownHTML('pe-ac-'+pid, p.auto_complete||'manual')+'</div>';
  h+='<div style="display:flex;gap:8px;margin-top:16px;border-top:1px solid #e8e2d8;padding-top:12px"><button class="btn primary" onclick="protoSaveEdit('+pid+')">&#10003; Save all</button><button class="btn" onclick="protoCancelEdit('+pid+')">Cancel</button></div>';
  panel.innerHTML=h;
  _attachEditStepListeners(pid); _attachDragHandlers(pid);
}

function _buildEditStepsHTML(pid) {
  var es=_editState[pid]; if(!es)return '';
  var arr=es.steps, h='';
  arr.forEach(function(step,i){
    h+='<div class="proto-edit-step" id="pes-'+pid+'-'+i+'" draggable="true" data-idx="'+i+'">'+
      '<span class="drag-handle" title="Drag to reorder">&#9776;</span>'+
      '<span style="font-size:12px;color:#8a7f72;min-width:20px;text-align:right">'+(i+1)+'.</span>'+
      '<div style="flex:1;display:flex;flex-direction:column;gap:2px">'+
        '<input type="text" value="'+esc(step.text)+'" spellcheck="false" placeholder="Step description..." data-editpid="'+pid+'" data-editidx="'+i+'" oninput="_editState['+pid+'].steps['+i+'].text=this.value"/>'+
        '<input type="text" value="'+esc(step.note||'')+'" spellcheck="false" placeholder="Note (optional)" style="font-size:11px;color:#8a7f72;border:1px dashed #d5cec0;background:transparent;padding:3px 8px;border-radius:3px" oninput="_editState['+pid+'].steps['+i+'].note=this.value"/>'+
      '</div>'+
      '<button class="move-btn" onclick="protoEditMoveStep('+pid+','+i+',-1)" title="Move up"'+(i===0?' disabled':'')+'>&#9650;</button>'+
      '<button class="move-btn" onclick="protoEditMoveStep('+pid+','+i+',1)" title="Move down"'+(i===arr.length-1?' disabled':'')+'>&#9660;</button>'+
      '<button class="link-btn" onclick="protoEditLinkStep('+pid+','+i+')">&#8599; Link</button>'+
      '<button style="background:none;border:none;cursor:pointer;color:#c0b8b0;font-size:16px;padding:0 4px" onclick="protoEditDelStep('+pid+','+i+')">&#215;</button>'+
    '</div>';
  });
  h+='<div style="margin-top:6px;display:flex;gap:6px"><button class="btn" onclick="protoEditAddStep('+pid+',-1)">+ Step</button><button class="btn" style="color:#5b7a5e" onclick="protoEditLinkStep('+pid+',-1)">&#8599; Link protocol</button></div>';
  return h;
}

function _attachDragHandlers(pid) {
  var c=document.getElementById('pe-steps-'+pid); if(!c)return;
  c.querySelectorAll('.proto-edit-step[draggable]').forEach(function(el){
    el.addEventListener('dragstart',function(e){_dragPid=pid;_dragIdx=parseInt(el.dataset.idx);el.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    el.addEventListener('dragend',function(){el.classList.remove('dragging');_dragPid=null;_dragIdx=null;c.querySelectorAll('.drag-over').forEach(function(x){x.classList.remove('drag-over');});});
    el.addEventListener('dragover',function(e){e.preventDefault();e.dataTransfer.dropEffect='move';c.querySelectorAll('.drag-over').forEach(function(x){x.classList.remove('drag-over');});el.classList.add('drag-over');});
    el.addEventListener('dragleave',function(){el.classList.remove('drag-over');});
    el.addEventListener('drop',function(e){e.preventDefault();c.querySelectorAll('.drag-over').forEach(function(x){x.classList.remove('drag-over');});if(_dragPid!==pid)return;var toIdx=parseInt(el.dataset.idx);if(_dragIdx===toIdx)return;var es=_editState[pid];if(!es)return;var item=es.steps.splice(_dragIdx,1)[0];es.steps.splice(toIdx,0,item);_refreshEditSteps(pid);_attachDragHandlers(pid);});
  });
}

function protoEditMoveStep(pid,idx,dir){var es=_editState[pid];if(!es)return;var ni=idx+dir;if(ni<0||ni>=es.steps.length)return;var tmp=es.steps[idx];es.steps[idx]=es.steps[ni];es.steps[ni]=tmp;_refreshEditSteps(pid);_attachDragHandlers(pid);}
function protoEditAddStep(pid,afterIdx){var es=_editState[pid];if(!es)return;if(afterIdx<0)es.steps.push({text:'',note:''});else es.steps.splice(afterIdx+1,0,{text:'',note:''});_refreshEditSteps(pid);_attachDragHandlers(pid);setTimeout(function(){var idx=afterIdx<0?es.steps.length-1:afterIdx+1;document.querySelector('#pes-'+pid+'-'+idx+' input')?.focus();},50);}
function protoEditDelStep(pid,idx){var es=_editState[pid];if(!es)return;if(es.steps.length<=1){es.steps[0]={text:'',note:''};_refreshEditSteps(pid);_attachDragHandlers(pid);return;}es.steps.splice(idx,1);_refreshEditSteps(pid);_attachDragHandlers(pid);}
function protoEditLinkStep(pid,afterIdx){_showLinkPicker(function(linkPid,title){var link='[@'+title+'](proto:'+linkPid+')';var es=_editState[pid];if(!es)return;if(afterIdx<0)es.steps.push({text:link,note:''});else es.steps.splice(afterIdx+1,0,{text:link,note:''});_refreshEditSteps(pid);_attachDragHandlers(pid);},pid);}

function _attachEditStepListeners(pid){var c=document.getElementById('pe-steps-'+pid);if(!c)return;c.querySelectorAll('input[data-editpid]').forEach(function(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();protoEditAddStep(parseInt(inp.dataset.editpid),parseInt(inp.dataset.editidx));}});});}
function _refreshEditSteps(pid){var c=document.getElementById('pe-steps-'+pid);if(!c)return;c.innerHTML=_buildEditStepsHTML(pid);_attachEditStepListeners(pid);}

async function protoSaveEdit(pid) {
  var es=_editState[pid]; if(!es)return;
  var steps=es.steps.filter(function(s){return s.text.trim();});
  var sj=JSON.stringify(steps.map(function(s){var o={text:s.text};if(s.note&&s.note.trim())o.note=s.note.trim();return o;}));
  var ti=document.getElementById('pe-title-'+pid);
  var title=ti?ti.value.trim():es.title; if(!title){toast('Title cannot be empty',true);return;}
  var rj=_serializeRecipeState(_recipeState[pid]);
  var acSel=document.getElementById('pe-ac-'+pid);
  var ac=acSel?acSel.value:'manual';
  await api('PUT','/api/protocols/'+pid,{title:title,steps:sj,recipe:rj,auto_complete:ac});
  var p=(S.protocols||[]).find(function(x){return x.id===pid;});
  if(p){p.title=title;p.steps=sj;p.recipe=rj;p.auto_complete=ac;}
  delete _editState[pid];
  if(p){var panel=document.getElementById('pp-'+pid);if(panel){panel.innerHTML=_panelBody(p);protoLoadRunHistory(pid);}}
  _reloadProtocol(pid); _refreshPanelTab(pid); toast('Protocol updated');
}

async function protoCancelEdit(pid) {
  delete _editState[pid];
  var p=(S.protocols||[]).find(function(x){return x.id===pid;});
  if(p){var panel=document.getElementById('pp-'+pid);if(panel){panel.innerHTML=_panelBody(p);protoLoadRunHistory(pid);}}
}

registerView('protocols', renderProtocols);
