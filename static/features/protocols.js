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
    '.proto-search-bar{margin-bottom:12px}',
    '.proto-search-bar input{width:100%;max-width:360px}',
    '.protocol-card{border:1px solid #d5cec0;border-radius:8px;background:#faf8f4;margin-bottom:10px;overflow:hidden}',
    '.protocol-header{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;user-select:none}',
    '.protocol-header:hover{background:#f0ebe3}',
    '.protocol-title{font-weight:600;font-size:14px;color:#4a4139;margin-bottom:2px}',
    '.protocol-url{font-size:11px;color:#8a7f72;margin-bottom:4px;word-break:break-all}',
    '.protocol-body{display:none;padding:0 16px 16px;border-top:1px solid #e8e2d8}',
    '.protocol-card.open .protocol-body{display:block}',
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
    '.recipe-add-row{display:flex;gap:8px;margin-top:8px;align-items:center}',
    '.recipe-edit-actions{display:flex;gap:6px;align-items:center}',
    '.proto-card-actions{display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap}',
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
    /* run history inside card */
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
    '.run-detail-deviation{font-size:11px;color:#c97b3c;margin-left:4px}'
  ].join('');
  document.head.appendChild(s);
})();

// ── state ─────────────────────────────────────────────────────────────────────
var DEFAULT_RECIPE = { columns: ['Component', 'Stock conc.', 'Volume (uL)', 'Final conc.'], rows: [] };
var _recipeState = {};
var _manualSteps = [''];
var _manualRecipes = []; // array of {name, columns, rows}
var _UNITS = ['uL', 'mL', 'L', 'ng', 'ug', 'mg', 'g', 'nM', 'uM', 'mM', 'M', 'U', 'x', '%', 'units'];

function _parseRecipe(raw) {
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_RECIPE));
  try {
    var r = JSON.parse(raw);
    // new format: array of tables
    if (Array.isArray(r) && r.length && r[0].columns) return r[0]; // return first for compat
    // old format: single object
    if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) return r;
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_RECIPE));
}

function _parseAllRecipes(raw) {
  if (!raw) return null;
  try {
    var r = JSON.parse(raw);
    if (Array.isArray(r) && r.length && r[0].columns) return r;
    if (r && Array.isArray(r.columns)) return null; // single table, use old display
  } catch(e) {}
  return null;
}

function _isUnitCol(n) { return /vol|amount|conc|stock|final|mass|weight/i.test(n); }

function _parseAmountUnit(val) {
  val = (val || '').trim();
  var m = val.match(/^([\d.,]*)\s*(.*)$/);
  return { num: m ? m[1] : '', unit: m ? m[2].trim() : '' };
}

function _manualUnitCellHTML(ri, ci, val) {
  var p = _parseAmountUnit(val);
  var unitOpts = _UNITS.map(function(u) { return '<option value="' + u + '"' + (p.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
  return '<td style="padding:0"><div style="display:flex;align-items:center">' +
    '<input type="number" value="' + esc(p.num) + '" min="0" step="any" placeholder="0" ' +
      'style="width:68px;border:none;background:transparent;padding:6px 4px 6px 8px;font-size:13px;font-family:inherit;color:#4a4139;outline:none" ' +
      'oninput="manualRecipeCellUnit(' + ri + ',' + ci + ',this.value,this.nextElementSibling.value)"/>' +
    '<select style="border:none;background:transparent;font-size:12px;color:#8a7f72;font-family:inherit;padding:0 4px 0 0;cursor:pointer;outline:none" ' +
      'onchange="manualRecipeCellUnit(' + ri + ',' + ci + ',this.previousElementSibling.value,this.value)">' +
      '<option value="">-</option>' + unitOpts +
    '</select></div></td>';
}

function _recipeDisplayHTML(raw) {
  var tables = _parseAllRecipes(raw);
  if (tables) {
    // multi-table display
    return tables.map(function(t) {
      return '<div style="margin-bottom:10px">' +
        (t.name ? '<div style="font-size:11px;font-weight:600;color:#8a7f72;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">' + esc(t.name) + '</div>' : '') +
        _recipeReadHTML(t) +
      '</div>';
    }).join('');
  }
  return _recipeReadHTML(_parseRecipe(raw));
}

function _recipeReadHTML(recipe) {
  if (!recipe.rows.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic">No components yet.</div>';
  var html = '<div class="recipe-wrap"><table class="recipe-table"><thead><tr>';
  recipe.columns.forEach(function(c) { html += '<th>' + esc(c) + '</th>'; });
  html += '</tr></thead><tbody>';
  recipe.rows.forEach(function(row) {
    html += '<tr>';
    recipe.columns.forEach(function(_, ci) { html += '<td style="padding:6px 10px">' + esc(row[ci] || '') + '</td>'; });
    html += '</tr>';
  });
  return html + '</tbody></table></div>';
}

function _recipeEditHTML(pid, recipe) {
  var html = '<div class="recipe-wrap"><table class="recipe-table" id="rtbl-' + pid + '"><thead><tr>';
  recipe.columns.forEach(function(c, ci) { html += '<th>' + esc(c) + '<button class="del-col" onclick="protoDelCol(' + pid + ',' + ci + ')">&#215;</button></th>'; });
  html += '<th style="width:32px"></th></tr></thead><tbody>';
  recipe.rows.forEach(function(row, ri) {
    html += '<tr id="rrow-' + pid + '-' + ri + '">';
    recipe.columns.forEach(function(_, ci) { html += '<td><input type="text" value="' + esc(row[ci] || '') + '" oninput="protoRecipeCell(' + pid + ',' + ri + ',' + ci + ',this.value)"/></td>'; });
    html += '<td><button class="del-row" onclick="protoDelRow(' + pid + ',' + ri + ')">&#215;</button></td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="recipe-add-row"><button class="btn" onclick="protoAddRow(' + pid + ')">+ Row</button><button class="btn" onclick="protoAddCol(' + pid + ')">+ Column</button></div>';
  return html;
}

// ── active runs helpers ───────────────────────────────────────────────────────
function _getActiveRuns() { try { return JSON.parse(localStorage.getItem('lab_proto_runs') || '[]'); } catch(e) { return []; } }

function _activeRunsHTML() {
  var runs = _getActiveRuns(); if (!runs.length) return '';
  var html = '<div style="margin-bottom:20px"><div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px">Active Runs</div>';
  runs.forEach(function(run) {
    var done = run.steps.filter(function(s) { return s.done; }).length;
    var pct  = Math.round((done / run.steps.length) * 100);
    var devs = run.steps.filter(function(s) { return s.deviation && s.deviation.trim(); }).length;
    html += '<div class="active-run-card">' +
      '<div class="active-run-info">' +
        '<div class="active-run-title">&#9654; ' + esc(run.protocol.title) + '</div>' +
        '<div class="active-run-meta">' + done + '/' + run.steps.length + ' steps' + (devs ? ' &nbsp;&#183;&nbsp; ' + devs + ' deviation' + (devs > 1 ? 's' : '') : '') + ' &nbsp;&#183;&nbsp; &#128193; ' + esc(run.group_name) + '</div>' +
        '<div class="active-run-bar"><div class="active-run-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
        '<button class="btn primary" style="font-size:12px" onclick="spResumeRunById(\'' + run.runId + '\')">&#9654; Resume</button>' +
        '<button class="btn" style="font-size:12px" onclick="spSaveRunToEntry(\'' + run.runId + '\')">Save to Entry</button>' +
        '<button class="btn" style="font-size:12px;color:#c0392b" onclick="spDiscardRunById(\'' + run.runId + '\')">Discard</button>' +
      '</div>' +
    '</div>';
  });
  return html + '</div>';
}

// ── run history helpers ───────────────────────────────────────────────────────
function _runHistoryRowHTML(run) {
  var pct  = run.steps_total ? Math.round((run.steps_done / run.steps_total) * 100) : 0;
  var date = run.date || run.created.split('T')[0];

  // build step-by-step detail
  var steps = [];
  try { steps = JSON.parse(run.steps_json || '[]'); } catch(e) {}
  var stepsHtml = '';
  if (steps.length) {
    stepsHtml = '<ol class="run-detail-steps">';
    steps.forEach(function(step) {
      stepsHtml += '<li class="' + (step.done ? 'done' : '') + '">' + esc(step.text);
      if (step.deviation && step.deviation.trim()) {
        stepsHtml += ' <span class="run-detail-deviation">&#8594; ' + esc(step.deviation) + '</span>';
      }
      stepsHtml += '</li>';
    });
    stepsHtml += '</ol>';
  }

  // recipe if present
  var recipeHtml = '';
  try {
    var recipe = JSON.parse(run.recipe_json || 'null');
    if (recipe && recipe.rows && recipe.rows.length) {
      recipeHtml = '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin:10px 0 6px">Recipe used</div>';
      recipeHtml += '<div style="overflow-x:auto"><table class="recipe-table"><thead><tr>';
      recipe.columns.forEach(function(c) { recipeHtml += '<th>' + esc(c) + '</th>'; });
      recipeHtml += '</tr></thead><tbody>';
      recipe.rows.forEach(function(row) {
        recipeHtml += '<tr>';
        recipe.columns.forEach(function(_, ci) { recipeHtml += '<td style="padding:5px 10px;font-size:12px">' + esc(row[ci] || '') + '</td>'; });
        recipeHtml += '</tr>';
      });
      recipeHtml += '</tbody></table></div>';
    }
  } catch(e) {}

  return '<div class="run-history-row" id="rhr-' + run.id + '">' +
    '<div class="run-history-summary" onclick="protoToggleRunDetail(' + run.id + ')">' +
      '<div class="run-history-date">' + esc(date) + '</div>' +
      '<div class="run-history-pct">' + pct + '% done</div>' +
      (run.deviations ? '<div class="run-history-devs">' + run.deviations + ' deviation' + (run.deviations > 1 ? 's' : '') + '</div>' : '') +
      '<div class="run-history-group">&#128193; ' + esc(run.group_name) + '</div>' +
      '<div style="font-size:11px;color:#b0a898">&#9660;</div>' +
    '</div>' +
    '<div class="run-history-detail">' +
      stepsHtml + recipeHtml +
      (run.entry_id ? '<div style="margin-top:10px"><button class="btn" style="font-size:12px" onclick="protoViewEntry(' + run.entry_id + ')">&#128196; View notebook entry</button></div>' : '') +
    '</div>' +
  '</div>';
}

function protoToggleRunDetail(runId) {
  document.getElementById('rhr-' + runId)?.classList.toggle('open');
}

function protoViewEntry(entryId) {
  // navigate to notebook and highlight the entry
  if (typeof setView === 'function') {
    S._jumpToEntry = entryId;
    setView('notebook');
  }
}

// ── main view ─────────────────────────────────────────────────────────────────
async function renderProtocols(el) {
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];

  var html = _activeRunsHTML();
  html += '<div class="proto-import-box">' + _buildImportUI() + '</div>';
  if (!S.protocols.length) {
    html += '<div class="empty"><big>&#128196;</big>No protocols yet.</div>';
  } else {
    html += '<div class="proto-search-bar"><input type="text" id="proto-search" placeholder="Search protocols..." oninput="protoFilter()" spellcheck="false"/></div>';
    html += '<div id="proto-list">' + S.protocols.map(_protoCard).join('') + '</div>';
  }
  el.innerHTML = html;
}

function _buildImportUI() {
  return '<div class="proto-import-tabs">' +
    '<button class="proto-tab active" onclick="protoTab(\'url\',this)">URL</button>' +
    '<button class="proto-tab" onclick="protoTab(\'paste\',this)">Paste text</button>' +
    '<button class="proto-tab" onclick="protoTab(\'file\',this)">Upload file</button>' +
    '<button class="proto-tab" onclick="protoTab(\'manual\',this)">Write manually</button>' +
    '</div>' +
    '<div id="pt-url"><div class="proto-import-row">' +
      '<input type="text" id="proto-url" placeholder="https://www.protocols.io/..." spellcheck="false"/>' +
      '<input type="text" id="proto-title-url" placeholder="Protocol name" style="width:200px" spellcheck="false"/>' +
      '<button class="btn primary" onclick="protoAddUrl()">Fetch + Extract</button>' +
    '</div></div>' +
    '<div id="pt-paste" style="display:none"><div class="proto-import-col">' +
      '<input type="text" id="proto-title-paste" placeholder="Protocol name" spellcheck="false"/>' +
      '<textarea id="proto-paste-text" placeholder="Paste protocol text here..."></textarea>' +
      '<div style="text-align:right"><button class="btn primary" onclick="protoAddPaste()">Extract Steps</button></div>' +
    '</div></div>' +
    '<div id="pt-file" style="display:none"><div class="proto-import-row">' +
      '<input type="text" id="proto-title-file" placeholder="Protocol name" spellcheck="false"/>' +
      '<input type="file" id="proto-file" accept=".txt,.md,.pdf,.docx"/>' +
      '<button class="btn primary" onclick="protoAddFile()">Upload + Extract</button>' +
    '</div></div>' +
    '<div id="pt-manual" style="display:none"><div class="proto-import-col">' +
      '<input type="text" id="proto-title-manual" placeholder="Protocol name" spellcheck="false"/>' +
      '<div id="manual-steps-list"></div>' +
      '<div><button class="btn" onclick="manualAddStep()">+ Step</button></div>' +
      '<div class="manual-recipe-section">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
          '<div class="manual-recipe-label">Reaction Tables <span style="font-weight:400;text-transform:none;font-size:11px">(optional)</span></div>' +
          '<button class="btn" onclick="manualAddTable()">+ Add table</button>' +
        '</div>' +
        '<div id="manual-recipe-body"></div>' +
      '</div>' +
      '<div style="text-align:right;margin-top:10px"><button class="btn primary" onclick="protoAddManual()">Save Protocol</button></div>' +
    '</div></div>';
}

function protoTab(name, btn) {
  document.querySelectorAll('.proto-tab').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  ['url', 'paste', 'file', 'manual'].forEach(function(t) {
    var el = document.getElementById('pt-' + t);
    if (el) el.style.display = (t === name) ? '' : 'none';
  });
  if (name === 'manual') { _manualSteps = ['']; _manualRecipes = []; _refreshManualSteps(); _refreshManualRecipe(); }
}

function protoFilter() {
  var q = (document.getElementById('proto-search')?.value || '').toLowerCase();
  document.querySelectorAll('.protocol-card').forEach(function(c) { c.style.display = (!q || c.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
}

function _protoCard(p) {
  var tags = JSON.parse(p.tags || '[]');
  var steps = [], isStructured = false;
  try {
    var parsed = JSON.parse(p.steps || '[]');
    if (Array.isArray(parsed) && parsed.length && typeof parsed[0].text !== 'undefined') { steps = parsed; isStructured = true; }
  } catch(e) {}

  var stepsHtml = '';
  if (!p.steps || p.steps === '[]') {
    stepsHtml = '<div style="color:#8a7f72;font-size:13px;font-style:italic">No steps yet — click Extract steps to pull from source.</div>';
  } else if (isStructured) {
    stepsHtml = '<ol class="steps-list">' + steps.map(function(s) { return '<li>' + esc(s.text) + '</li>'; }).join('') + '</ol>';
  } else {
    stepsHtml = '<div class="steps-text">' + esc(p.steps) + '</div>';
  }

  var recipe = _parseRecipe(p.recipe);
  _recipeState[p.id] = JSON.parse(JSON.stringify(recipe));

  return '<div class="protocol-card" id="pc-' + p.id + '">' +
    '<div class="protocol-header" onclick="protoToggle(' + p.id + ')">' +
      '<div style="flex:1">' +
        '<div class="protocol-title">' + esc(p.title) + '</div>' +
        (p.url ? '<div class="protocol-url">' + esc(p.url) + '</div>' : '') +
        (p.source_type === 'manual' ? '<div style="font-size:11px;color:#8a7f72">manually entered</div>' : '') +
        (tags.length ? '<div class="tags">' + tags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="proto-card-actions">' +
        '<button class="btn" style="color:#5b7a5e" onclick="event.stopPropagation();protoOpenRun(' + p.id + ')">&#9654; Run</button>' +
        (p.source_type !== 'manual' ? '<button class="btn" style="color:#5b7a5e" onclick="event.stopPropagation();protoReExtract(' + p.id + ')">&#10227; Extract steps</button>' : '') +
        (p.url ? '<a class="btn" href="' + esc(p.url) + '" target="_blank" onclick="event.stopPropagation()">&#8599;</a>' : '') +
        '<button class="btn" style="color:#c0392b" onclick="event.stopPropagation();protoDelete(' + p.id + ')">&#128465; Delete</button>' +
      '</div>' +
    '</div>' +
    '<div class="protocol-body" id="pb-' + p.id + '">' +
      stepsHtml +
      '<div class="recipe-section">' +
        '<div class="recipe-section-head"><span>Reaction Recipe</span>' +
          '<div class="recipe-edit-actions" id="recipe-actions-' + p.id + '">' +
            '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + p.id + ')">Edit</button>' +
          '</div>' +
        '</div>' +
        '<div id="recipe-body-' + p.id + '">' + _recipeDisplayHTML(p.recipe) + '</div>' +
      '</div>' +
      '<div class="run-history-section">' +
        '<div class="run-history-head">Run History</div>' +
        '<div id="run-history-' + p.id + '"><div style="color:#8a7f72;font-size:13px;font-style:italic">Loading...</div></div>' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
        '<label>Notes / modifications</label>' +
        '<textarea id="pn-' + p.id + '" placeholder="Your modifications, tips, observations...">' + esc(p.notes) + '</textarea>' +
      '</div>' +
      '<div class="save-row"><button class="btn primary" onclick="event.stopPropagation();protoSave(' + p.id + ')">Save notes</button></div>' +
    '</div>' +
  '</div>';
}

function protoToggle(id) {
  var card = document.getElementById('pc-' + id);
  if (!card) return;
  card.classList.toggle('open');
  // load run history when card opens
  if (card.classList.contains('open')) protoLoadRunHistory(id);
}

async function protoLoadRunHistory(pid) {
  var container = document.getElementById('run-history-' + pid); if (!container) return;
  try {
    var data = await api('GET', '/api/protocols/' + pid + '/runs');
    var runs = data.runs || [];
    if (!runs.length) {
      container.innerHTML = '<div style="color:#8a7f72;font-size:13px;font-style:italic">No runs recorded yet.</div>';
    } else {
      container.innerHTML = runs.map(_runHistoryRowHTML).join('');
    }
  } catch(e) {
    container.innerHTML = '<div style="color:#8a7f72;font-size:13px;font-style:italic">Could not load run history.</div>';
  }
}

// ── recipe editing ─────────────────────────────────────────────────────────────
function protoRecipeEdit(pid) {
  var recipe = _recipeState[pid] || JSON.parse(JSON.stringify(DEFAULT_RECIPE));
  _recipeState[pid] = recipe;
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, recipe);
  document.getElementById('recipe-actions-' + pid).innerHTML =
    '<button class="btn primary" onclick="event.stopPropagation();protoRecipeSave(' + pid + ')">Save recipe</button>' +
    '<button class="btn" onclick="event.stopPropagation();protoRecipeCancel(' + pid + ')">Cancel</button>';
}

function protoRecipeCancel(pid) {
  var p = (S.protocols || []).find(function(x) { return x.id === pid; }); if (!p) return;
  var recipe = _parseRecipe(p.recipe);
  _recipeState[pid] = JSON.parse(JSON.stringify(recipe));
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeReadHTML(recipe);
  document.getElementById('recipe-actions-' + pid).innerHTML = '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + pid + ')">Edit</button>';
}

async function protoRecipeSave(pid) {
  var recipe = _recipeState[pid]; if (!recipe) return;
  await api('PUT', '/api/protocols/' + pid, { recipe: JSON.stringify(recipe) });
  var p = (S.protocols || []).find(function(x) { return x.id === pid; });
  if (p) p.recipe = JSON.stringify(recipe);
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeReadHTML(recipe);
  document.getElementById('recipe-actions-' + pid).innerHTML = '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + pid + ')">Edit</button>';
  toast('Recipe saved');
}

function protoRecipeCell(pid, ri, ci, value) { if (_recipeState[pid] && _recipeState[pid].rows[ri]) _recipeState[pid].rows[ri][ci] = value; }

function protoAddRow(pid) {
  var r = _recipeState[pid]; if (!r) return;
  r.rows.push(r.columns.map(function() { return ''; }));
  var ri = r.rows.length - 1;
  var tbody = document.querySelector('#rtbl-' + pid + ' tbody'); if (!tbody) return;
  var tr = document.createElement('tr'); tr.id = 'rrow-' + pid + '-' + ri;
  var inner = '';
  r.columns.forEach(function(_, ci) { inner += '<td><input type="text" value="" oninput="protoRecipeCell(' + pid + ',' + ri + ',' + ci + ',this.value)"/></td>'; });
  inner += '<td><button class="del-row" onclick="protoDelRow(' + pid + ',' + ri + ')">&#215;</button></td>';
  tr.innerHTML = inner; tbody.appendChild(tr);
}

function protoDelRow(pid, ri) { var r = _recipeState[pid]; if (!r) return; r.rows.splice(ri, 1); document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r); }
function protoAddCol(pid) { var name = prompt('Column name:'); if (!name) return; var r = _recipeState[pid]; if (!r) return; r.columns.push(name); r.rows.forEach(function(row) { row.push(''); }); document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r); }
function protoDelCol(pid, ci) { var r = _recipeState[pid]; if (!r || r.columns.length <= 1) { toast('Need at least one column', true); return; } r.columns.splice(ci, 1); r.rows.forEach(function(row) { row.splice(ci, 1); }); document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r); }

// ── manual entry helpers ──────────────────────────────────────────────────────
function _manualTableHTML(ti) {
  var t = _manualRecipes[ti];
  var html = '<div class="manual-table-wrap" id="mtw-' + ti + '" style="margin-bottom:14px;border:1px solid #d5cec0;border-radius:6px;overflow:hidden">';
  html += '<div style="display:flex;align-items:center;background:#f0ebe3;padding:6px 10px;gap:8px">';
  html += '<input type="text" value="' + esc(t.name) + '" placeholder="Table name (e.g. PCR Mix)" spellcheck="false" ' +
    'style="flex:1;font-size:12px;font-weight:600;border:none;background:transparent;color:#4a4139;outline:none" ' +
    'oninput="manualTableRename(' + ti + ',this.value)"/>';
  html += '<button class="btn" style="font-size:11px;color:#c0392b" onclick="manualDelTable(' + ti + ')">&#215; Remove table</button>';
  html += '</div>';
  html += '<div style="padding:8px 10px">';
  if (!t.rows.length) {
    html += '<div style="color:#8a7f72;font-size:13px;font-style:italic;margin-bottom:6px">No components yet</div>';
  } else {
    html += '<div style="overflow-x:auto"><table class="recipe-table" style="margin-bottom:6px"><thead><tr>';
    t.columns.forEach(function(c, ci) {
      html += '<th>' + esc(c) + '<button class="del-col" onclick="manualTableDelCol(' + ti + ',' + ci + ')">&#215;</button></th>';
    });
    html += '<th style="width:28px"></th></tr></thead><tbody>';
    t.rows.forEach(function(row, ri) {
      html += '<tr>';
      t.columns.forEach(function(col, ci) {
        if (_isUnitCol(col)) { html += _manualUnitCellHTMLT(ti, ri, ci, row[ci] || ''); }
        else { html += '<td><input type="text" value="' + esc(row[ci] || '') + '" oninput="manualTableCell(' + ti + ',' + ri + ',' + ci + ',this.value)"/></td>'; }
      });
      html += '<td><button class="del-row" onclick="manualTableDelRow(' + ti + ',' + ri + ')">&#215;</button></td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '<div class="recipe-add-row">' +
    '<button class="btn" onclick="manualTableAddRow(' + ti + ')">+ Row</button>' +
    '<button class="btn" onclick="manualTableAddCol(' + ti + ')">+ Column</button>' +
  '</div></div></div>';
  return html;
}

function _manualUnitCellHTMLT(ti, ri, ci, val) {
  var p = _parseAmountUnit(val);
  var unitOpts = _UNITS.map(function(u) { return '<option value="' + u + '"' + (p.unit === u ? ' selected' : '') + '>' + u + '</option>'; }).join('');
  return '<td style="padding:0"><div style="display:flex;align-items:center">' +
    '<input type="number" value="' + esc(p.num) + '" min="0" step="any" placeholder="0" ' +
      'style="width:68px;border:none;background:transparent;padding:6px 4px 6px 8px;font-size:13px;font-family:inherit;color:#4a4139;outline:none" ' +
      'oninput="manualTableCellUnit(' + ti + ',' + ri + ',' + ci + ',this.value,this.nextElementSibling.value)"/>' +
    '<select style="border:none;background:transparent;font-size:12px;color:#8a7f72;font-family:inherit;padding:0 4px 0 0;cursor:pointer;outline:none" ' +
      'onchange="manualTableCellUnit(' + ti + ',' + ri + ',' + ci + ',this.previousElementSibling.value,this.value)">' +
      '<option value="">-</option>' + unitOpts +
    '</select></div></td>';
}

function _refreshManualRecipe() {
  var el = document.getElementById('manual-recipe-body'); if (!el) return;
  if (!_manualRecipes.length) { el.innerHTML = '<div style="color:#8a7f72;font-size:13px;font-style:italic">No tables yet — click + Add table above.</div>'; return; }
  el.innerHTML = _manualRecipes.map(function(_, ti) { return _manualTableHTML(ti); }).join('');
}

function manualAddTable() {
  _manualRecipes.push({ name: 'Table ' + (_manualRecipes.length + 1), columns: ['Component', 'Stock conc.', 'Volume (uL)', 'Final conc.'], rows: [] });
  _refreshManualRecipe();
}
function manualDelTable(ti) { _manualRecipes.splice(ti, 1); _refreshManualRecipe(); }
function manualTableRename(ti, name) { if (_manualRecipes[ti]) _manualRecipes[ti].name = name; }
function manualTableCell(ti, ri, ci, value) { if (_manualRecipes[ti] && _manualRecipes[ti].rows[ri]) _manualRecipes[ti].rows[ri][ci] = value; }
function manualTableCellUnit(ti, ri, ci, num, unit) { var v = (num || '').trim() + (unit ? ' ' + unit : ''); if (_manualRecipes[ti] && _manualRecipes[ti].rows[ri]) _manualRecipes[ti].rows[ri][ci] = v.trim(); }
function manualTableAddRow(ti) { var t = _manualRecipes[ti]; if (!t) return; t.rows.push(t.columns.map(function() { return ''; })); _refreshManualRecipe(); }
function manualTableDelRow(ti, ri) { var t = _manualRecipes[ti]; if (!t) return; t.rows.splice(ri, 1); _refreshManualRecipe(); }
function manualTableAddCol(ti) { var name = prompt('Column name:'); if (!name) return; var t = _manualRecipes[ti]; if (!t) return; t.columns.push(name); t.rows.forEach(function(r) { r.push(''); }); _refreshManualRecipe(); }
function manualTableDelCol(ti, ci) { var t = _manualRecipes[ti]; if (!t || t.columns.length <= 1) { toast('Need at least one column', true); return; } t.columns.splice(ci, 1); t.rows.forEach(function(r) { r.splice(ci, 1); }); _refreshManualRecipe(); }

// keep old single-table functions as no-ops for compatibility
function _manualRecipeState() { return _manualRecipes[0] || JSON.parse(JSON.stringify(DEFAULT_RECIPE)); }
function manualRecipeCell(ri, ci, value) { manualTableCell(0, ri, ci, value); }
function manualRecipeCellUnit(ri, ci, num, unit) { manualTableCellUnit(0, ri, ci, num, unit); }
function manualRecipeAddRow() { manualTableAddRow(0); }
function manualRecipeDelRow(ri) { manualTableDelRow(0, ri); }
function manualRecipeAddCol() { manualTableAddCol(0); }
function manualRecipeDelCol(ci) { manualTableDelCol(0, ci); }

function _manualStepRowHTML(idx, value) {
  return '<div class="manual-step-row" id="msr-' + idx + '">' +
    '<span class="manual-step-num">' + (idx + 1) + '.</span>' +
    '<input type="text" value="' + esc(value || '') + '" placeholder="Describe this step..." spellcheck="false" ' +
      'oninput="manualStepUpdate(' + idx + ',this.value)" ' +
      'onkeydown="if(event.key==\'Enter\'){event.preventDefault();manualAddStep();}" />' +
    '<button class="manual-del-step" onclick="manualDelStep(' + idx + ')">&#215;</button>' +
  '</div>';
}

function _manualRecipeHTML() {
  var r = _manualRecipeState();
  if (!r.rows.length) {
    return '<div style="display:flex;gap:6px;align-items:center">' +
      '<span style="color:#8a7f72;font-size:13px;font-style:italic">No components yet</span>' +
      '<button class="btn" onclick="manualRecipeAddRow()">+ Add component</button>' +
      '<button class="btn" onclick="manualRecipeAddCol()">+ Column</button>' +
    '</div>';
  }
  var html = '<div style="overflow-x:auto"><table class="recipe-table" style="margin-bottom:6px"><thead><tr>';
  r.columns.forEach(function(c, ci) { html += '<th>' + esc(c) + '<button class="del-col" onclick="manualRecipeDelCol(' + ci + ')">&#215;</button></th>'; });
  html += '<th style="width:28px"></th></tr></thead><tbody>';
  r.rows.forEach(function(row, ri) {
    html += '<tr>';
    r.columns.forEach(function(col, ci) {
      if (_isUnitCol(col)) { html += _manualUnitCellHTML(ri, ci, row[ci] || ''); }
      else { html += '<td><input type="text" value="' + esc(row[ci] || '') + '" oninput="manualRecipeCell(' + ri + ',' + ci + ',this.value)"/></td>'; }
    });
    html += '<td><button class="del-row" onclick="manualRecipeDelRow(' + ri + ')">&#215;</button></td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="recipe-add-row"><button class="btn" onclick="manualRecipeAddRow()">+ Row</button><button class="btn" onclick="manualRecipeAddCol()">+ Column</button></div>';
  return html;
}

function _refreshManualSteps() {
  var list = document.getElementById('manual-steps-list'); if (!list) return;
  list.innerHTML = _manualSteps.map(function(v, i) { return _manualStepRowHTML(i, v); }).join('');
  var last = document.querySelector('#msr-' + (_manualSteps.length - 1) + ' input');
  if (last) last.focus();
}


function manualStepUpdate(idx, value) { _manualSteps[idx] = value; }
function manualAddStep() {
  _manualSteps.push('');
  var list = document.getElementById('manual-steps-list'); if (!list) return;
  var idx = _manualSteps.length - 1;
  var wrap = document.createElement('div'); wrap.innerHTML = _manualStepRowHTML(idx, '');
  list.appendChild(wrap.firstChild);
  var inp = document.querySelector('#msr-' + idx + ' input'); if (inp) inp.focus();
}
function manualDelStep(idx) { if (_manualSteps.length <= 1) { _manualSteps[0] = ''; _refreshManualSteps(); return; } _manualSteps.splice(idx, 1); _refreshManualSteps(); }
// single-table compat shims now in multi-table section above

async function protoAddManual() {
  var title = (document.getElementById('proto-title-manual')?.value || '').trim();
  if (!title) { toast('Add a title', true); return; }
  var steps = _manualSteps.filter(function(s) { return s.trim(); });
  if (!steps.length) { toast('Add at least one step', true); return; }
  var recipe = _manualRecipes.length ? JSON.stringify(_manualRecipes) : null;
  var btn = document.querySelector('#pt-manual .btn.primary');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
  try {
    await api('POST', '/api/protocols/from-manual', { title: title, steps: steps, recipe: recipe, tags: [] });
    _manualSteps = ['']; _manualRecipes = [];
    await loadView(); toast('Protocol saved');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Save Protocol'; btn.disabled = false; } }
}

// ── import actions ─────────────────────────────────────────────────────────────
async function protoAddUrl() {
  var url = document.getElementById('proto-url')?.value.trim();
  var title = document.getElementById('proto-title-url')?.value.trim();
  if (!url) { toast('Paste a URL first', true); return; }
  if (!title) { toast('Add a title', true); return; }
  var btn = document.querySelector('#pt-url .btn.primary');
  if (btn) { btn.textContent = 'Fetching...'; btn.disabled = true; }
  try {
    await api('POST', '/api/protocols', { title: title, url: url, tags: [] });
    document.getElementById('proto-url').value = ''; document.getElementById('proto-title-url').value = '';
    await loadView(); toast('Protocol saved');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Fetch + Extract'; btn.disabled = false; } }
}

async function protoAddPaste() {
  var title = document.getElementById('proto-title-paste')?.value.trim();
  var text  = document.getElementById('proto-paste-text')?.value.trim();
  if (!title) { toast('Add a title', true); return; }
  if (!text)  { toast('Paste some text first', true); return; }
  var btn = document.querySelector('#pt-paste .btn.primary');
  if (btn) { btn.textContent = 'Extracting...'; btn.disabled = true; }
  try {
    await api('POST', '/api/protocols/from-paste', { title: title, text: text, tags: [] });
    document.getElementById('proto-title-paste').value = ''; document.getElementById('proto-paste-text').value = '';
    await loadView(); toast('Protocol saved');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Extract Steps'; btn.disabled = false; } }
}

async function protoAddFile() {
  var title = document.getElementById('proto-title-file')?.value.trim();
  var fileInput = document.getElementById('proto-file');
  var file = fileInput?.files[0];
  if (!title) { toast('Add a title', true); return; }
  if (!file)  { toast('Choose a file first', true); return; }
  var btn = document.querySelector('#pt-file .btn.primary');
  if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }
  try {
    var fd = new FormData(); fd.append('title', title); fd.append('file', file); fd.append('tags', '[]');
    var resp = await fetch('/api/protocols/from-file', { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    document.getElementById('proto-title-file').value = ''; fileInput.value = '';
    await loadView(); toast('Protocol saved');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Upload + Extract'; btn.disabled = false; } }
}

async function protoReExtract(id) {
  toast('Re-extracting steps \u2014 waking 3090...');
  try { await api('POST', '/api/protocols/' + id + '/re-extract'); await loadView(); toast('Steps updated'); }
  catch(e) { toast('Re-extract failed: ' + e.message, true); }
}

async function protoSave(id) {
  var notes = document.getElementById('pn-' + id)?.value || '';
  await api('PUT', '/api/protocols/' + id, { notes: notes }); toast('Saved');
}

async function protoDelete(id) {
  if (!confirm('Delete this protocol?')) return;
  await api('DELETE', '/api/protocols/' + id); await loadView(); toast('Deleted');
}

function protoOpenRun(protocolId) {
  var p = (S.protocols || []).find(function(x) { return x.id === protocolId; }); if (!p) return;
  var steps = [];
  try { var parsed = JSON.parse(p.steps || '[]'); if (Array.isArray(parsed) && parsed.length && typeof parsed[0].text !== 'undefined') steps = parsed; } catch(e) {}
  if (!steps.length) { toast('No structured steps yet \u2014 extract them first', true); return; }
  if (typeof spLaunchRunDirect === 'function') spLaunchRunDirect(p, null);
  else toast('Open the Scratch pad to run protocols', true);
}

registerView('protocols', renderProtocols);
