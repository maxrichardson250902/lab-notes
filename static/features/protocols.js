// ── PROTOCOLS ─────────────────────────────────────────────────────────────────

(function injectProtoStyles() {
  if (document.getElementById('proto-styles')) return;
  var s = document.createElement('style');
  s.id = 'proto-styles';
  s.textContent = `
    .proto-import-box{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:16px;margin-bottom:20px}
    .proto-import-tabs{display:flex;gap:6px;margin-bottom:14px}
    .proto-tab{background:none;border:1px solid #d5cec0;border-radius:5px;padding:5px 14px;font-size:12px;cursor:pointer;color:#8a7f72;font-family:inherit}
    .proto-tab.active{background:#faf8f4;color:#4a4139;border-color:#b0a898;font-weight:600}
    .proto-import-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .proto-import-row input[type=text]{flex:1;min-width:160px}
    .proto-import-col{display:flex;flex-direction:column;gap:8px}
    .proto-import-col input[type=text]{width:100%}
    .proto-import-col textarea{width:100%;min-height:100px;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:12px;resize:vertical}
    .proto-search-bar{margin-bottom:12px}
    .proto-search-bar input{width:100%;max-width:360px}

    /* cards */
    .protocol-card{border:1px solid #d5cec0;border-radius:8px;background:#faf8f4;margin-bottom:10px;overflow:hidden}
    .protocol-header{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;user-select:none}
    .protocol-header:hover{background:#f0ebe3}
    .protocol-title{font-weight:600;font-size:14px;color:#4a4139;margin-bottom:2px}
    .protocol-url{font-size:11px;color:#8a7f72;margin-bottom:4px;word-break:break-all}
    .protocol-body{display:none;padding:0 16px 16px;border-top:1px solid #e8e2d8}
    .protocol-card.open .protocol-body{display:block}
    .steps-list{margin:12px 0 0;padding-left:22px;color:#4a4139;font-size:13px;line-height:1.7}
    .steps-list li{margin-bottom:2px}
    .steps-text{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:12px;background:#f0ebe3;border-radius:5px;padding:10px 12px;white-space:pre-wrap;color:#4a4139;margin-top:12px}

    /* recipe table */
    .recipe-section{margin-top:18px}
    .recipe-section-head{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between}
    .recipe-wrap{overflow-x:auto}
    .recipe-table{border-collapse:collapse;font-size:13px;color:#4a4139;min-width:100%}
    .recipe-table th{background:#f0ebe3;border:1px solid #d5cec0;padding:6px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap;position:relative}
    .recipe-table td{border:1px solid #e8e2d8;padding:0}
    .recipe-table td input{width:100%;border:none;background:transparent;padding:6px 10px;font-size:13px;font-family:inherit;color:#4a4139;outline:none;min-width:80px}
    .recipe-table td input:focus{background:#fff8f0}
    .recipe-table th .del-col{position:absolute;top:2px;right:3px;background:none;border:none;cursor:pointer;font-size:10px;color:#c0b8b0;padding:0;line-height:1}
    .recipe-table th .del-col:hover{color:#c0392b}
    .recipe-table .del-row{background:none;border:none;cursor:pointer;font-size:13px;color:#c0b8b0;padding:4px 8px;width:100%;height:100%}
    .recipe-table .del-row:hover{color:#c0392b;background:#fff0f0}
    .recipe-add-row{display:flex;gap:8px;margin-top:8px;align-items:center}
    .recipe-edit-actions{display:flex;gap:6px;align-items:center}
  `;
  document.head.appendChild(s);
})();

// ── recipe helpers ────────────────────────────────────────────────────────────
var DEFAULT_RECIPE = {
  columns: ['Component', 'Stock conc.', 'Volume (µL)', 'Final conc.'],
  rows: []
};

function _parseRecipe(raw) {
  if (!raw) return JSON.parse(JSON.stringify(DEFAULT_RECIPE));
  try {
    var r = JSON.parse(raw);
    if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) return r;
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_RECIPE));
}

// render a read-only recipe table (for protocol card display)
function _recipeReadHTML(recipe) {
  if (!recipe.rows.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic">No components yet — click Edit to add rows.</div>';
  var html = '<div class="recipe-wrap"><table class="recipe-table"><thead><tr>';
  recipe.columns.forEach(function(c) { html += '<th>' + esc(c) + '</th>'; });
  html += '</tr></thead><tbody>';
  recipe.rows.forEach(function(row) {
    html += '<tr>';
    recipe.columns.forEach(function(_, ci) {
      html += '<td style="padding:6px 10px">' + esc(row[ci] || '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// render an editable recipe table (for protocol card edit mode)
function _recipeEditHTML(pid, recipe) {
  var html = '<div class="recipe-wrap"><table class="recipe-table" id="rtbl-' + pid + '"><thead><tr>';
  recipe.columns.forEach(function(c, ci) {
    html += '<th>' + esc(c) +
      '<button class="del-col" title="Remove column" onclick="protoDelCol(' + pid + ',' + ci + ')">&#215;</button>' +
    '</th>';
  });
  html += '<th style="width:32px"></th></tr></thead><tbody>';

  recipe.rows.forEach(function(row, ri) {
    html += '<tr id="rrow-' + pid + '-' + ri + '">';
    recipe.columns.forEach(function(_, ci) {
      html += '<td><input type="text" value="' + esc(row[ci] || '') +
        '" oninput="protoRecipeCell(' + pid + ',' + ri + ',' + ci + ',this.value)"/></td>';
    });
    html += '<td><button class="del-row" onclick="protoDelRow(' + pid + ',' + ri + ')" title="Remove row">&#215;</button></td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  html += '<div class="recipe-add-row">' +
    '<button class="btn" onclick="protoAddRow(' + pid + ')">+ Row</button>' +
    '<button class="btn" onclick="protoAddCol(' + pid + ')">+ Column</button>' +
  '</div>';
  return html;
}

// per-protocol in-memory recipe state while editing
var _recipeState = {}; // pid -> {columns, rows}

function _getRecipeState(pid) {
  return _recipeState[pid];
}

// ── main view ─────────────────────────────────────────────────────────────────
async function renderProtocols(el) {
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];

  var html = '<div class="proto-import-box">' + _buildImportUI() + '</div>';
  if (!S.protocols.length) {
    html += '<div class="empty"><big>&#128196;</big>No protocols yet — import one above.</div>';
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
    '</div></div>';
}

function protoTab(name, btn) {
  document.querySelectorAll('.proto-tab').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  ['url','paste','file'].forEach(function(t) {
    var el = document.getElementById('pt-' + t);
    if (el) el.style.display = (t === name) ? '' : 'none';
  });
}

function protoFilter() {
  var q = (document.getElementById('proto-search')?.value || '').toLowerCase();
  document.querySelectorAll('.protocol-card').forEach(function(c) {
    c.style.display = (!q || c.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function _protoCard(p) {
  var tags = JSON.parse(p.tags || '[]');
  var steps = [];
  var isStructured = false;
  try {
    var parsed = JSON.parse(p.steps || '[]');
    if (Array.isArray(parsed) && parsed.length && parsed[0].text) { steps = parsed; isStructured = true; }
  } catch(e) {}

  var stepsHtml = '';
  if (!p.steps) {
    stepsHtml = '<div style="color:#8a7f72;font-size:13px;font-style:italic">No steps yet — click &#10227; to extract.</div>';
  } else if (isStructured) {
    stepsHtml = '<ol class="steps-list">' + steps.map(function(s) { return '<li>' + esc(s.text) + '</li>'; }).join('') + '</ol>';
  } else {
    stepsHtml = '<div class="steps-text">' + esc(p.steps) + '</div>';
  }

  var recipe = _parseRecipe(p.recipe);
  // initialise state so edits work immediately
  _recipeState[p.id] = JSON.parse(JSON.stringify(recipe));

  return '<div class="protocol-card" id="pc-' + p.id + '">' +
    '<div class="protocol-header" onclick="protoToggle(' + p.id + ')">' +
      '<div style="flex:1">' +
        '<div class="protocol-title">' + esc(p.title) + '</div>' +
        (p.url ? '<div class="protocol-url">' + esc(p.url) + '</div>' : '') +
        (tags.length ? '<div class="tags">' + tags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="entry-actions" style="flex-shrink:0">' +
        '<button class="btn" style="color:#5b7a5e" title="Run protocol" onclick="event.stopPropagation();protoOpenRun(' + p.id + ')">&#9654; Run</button>' +
        '<button class="btn" title="Re-extract steps" onclick="event.stopPropagation();protoReExtract(' + p.id + ')">&#10227;</button>' +
        (p.url ? '<a class="btn" href="' + esc(p.url) + '" target="_blank" onclick="event.stopPropagation()">&#8599;</a>' : '') +
        '<button class="btn" style="color:var(--red,#c0392b)" onclick="event.stopPropagation();protoDelete(' + p.id + ')">&#215;</button>' +
      '</div>' +
    '</div>' +
    '<div class="protocol-body" id="pb-' + p.id + '">' +
      stepsHtml +

      // ── recipe section ──
      '<div class="recipe-section">' +
        '<div class="recipe-section-head">' +
          '<span>Reaction Recipe</span>' +
          '<div class="recipe-edit-actions" id="recipe-actions-' + p.id + '">' +
            '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + p.id + ')">Edit</button>' +
          '</div>' +
        '</div>' +
        '<div id="recipe-body-' + p.id + '">' + _recipeReadHTML(recipe) + '</div>' +
      '</div>' +

      '<div class="field" style="margin-top:14px">' +
        '<label>Notes / modifications</label>' +
        '<textarea id="pn-' + p.id + '" placeholder="Your modifications, tips, observations...">' + esc(p.notes) + '</textarea>' +
      '</div>' +
      '<div class="save-row">' +
        '<button class="btn primary" onclick="event.stopPropagation();protoSave(' + p.id + ')">Save notes</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function protoToggle(id) { document.getElementById('pc-' + id)?.classList.toggle('open'); }

// ── recipe editing ─────────────────────────────────────────────────────────────
function protoRecipeEdit(pid) {
  var bodyEl    = document.getElementById('recipe-body-' + pid);
  var actionsEl = document.getElementById('recipe-actions-' + pid);
  if (!bodyEl) return;
  var recipe = _recipeState[pid] || JSON.parse(JSON.stringify(DEFAULT_RECIPE));
  _recipeState[pid] = recipe;
  bodyEl.innerHTML = _recipeEditHTML(pid, recipe);
  actionsEl.innerHTML =
    '<button class="btn primary" onclick="event.stopPropagation();protoRecipeSave(' + pid + ')">Save recipe</button>' +
    '<button class="btn" onclick="event.stopPropagation();protoRecipeCancel(' + pid + ')">Cancel</button>';
}

function protoRecipeCancel(pid) {
  var p = (S.protocols || []).find(function(x) { return x.id === pid; });
  if (!p) return;
  var recipe = _parseRecipe(p.recipe);
  _recipeState[pid] = JSON.parse(JSON.stringify(recipe));
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeReadHTML(recipe);
  document.getElementById('recipe-actions-' + pid).innerHTML =
    '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + pid + ')">Edit</button>';
}

async function protoRecipeSave(pid) {
  var recipe = _recipeState[pid];
  if (!recipe) return;
  await api('PUT', '/api/protocols/' + pid, { recipe: JSON.stringify(recipe) });
  // update local cache
  var p = (S.protocols || []).find(function(x) { return x.id === pid; });
  if (p) p.recipe = JSON.stringify(recipe);
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeReadHTML(recipe);
  document.getElementById('recipe-actions-' + pid).innerHTML =
    '<button class="btn" onclick="event.stopPropagation();protoRecipeEdit(' + pid + ')">Edit</button>';
  toast('Recipe saved ✓');
}

function protoRecipeCell(pid, ri, ci, value) {
  var r = _recipeState[pid];
  if (!r || !r.rows[ri]) return;
  r.rows[ri][ci] = value;
}

function protoAddRow(pid) {
  var r = _recipeState[pid];
  if (!r) return;
  r.rows.push(r.columns.map(function() { return ''; }));
  var ri = r.rows.length - 1;
  var tbody = document.querySelector('#rtbl-' + pid + ' tbody');
  if (!tbody) return;
  var tr = document.createElement('tr');
  tr.id = 'rrow-' + pid + '-' + ri;
  var inner = '';
  r.columns.forEach(function(_, ci) {
    inner += '<td><input type="text" value="" oninput="protoRecipeCell(' + pid + ',' + ri + ',' + ci + ',this.value)"/></td>';
  });
  inner += '<td><button class="del-row" onclick="protoDelRow(' + pid + ',' + ri + ')" title="Remove row">&#215;</button></td>';
  tr.innerHTML = inner;
  tbody.appendChild(tr);
}

function protoDelRow(pid, ri) {
  var r = _recipeState[pid];
  if (!r) return;
  r.rows.splice(ri, 1);
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r);
}

function protoAddCol(pid) {
  var name = prompt('Column name:');
  if (!name) return;
  var r = _recipeState[pid];
  if (!r) return;
  r.columns.push(name);
  r.rows.forEach(function(row) { row.push(''); });
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r);
}

function protoDelCol(pid, ci) {
  var r = _recipeState[pid];
  if (!r || r.columns.length <= 1) { toast('Need at least one column', true); return; }
  r.columns.splice(ci, 1);
  r.rows.forEach(function(row) { row.splice(ci, 1); });
  document.getElementById('recipe-body-' + pid).innerHTML = _recipeEditHTML(pid, r);
}

// ── import actions ─────────────────────────────────────────────────────────────
async function protoAddUrl() {
  var url   = document.getElementById('proto-url')?.value.trim();
  var title = document.getElementById('proto-title-url')?.value.trim();
  if (!url)   { toast('Paste a URL first', true); return; }
  if (!title) { toast('Add a title', true); return; }
  var btn = document.querySelector('#pt-url .btn.primary');
  if (btn) { btn.textContent = 'Fetching...'; btn.disabled = true; }
  try {
    await api('POST', '/api/protocols', { title, url, tags: [] });
    document.getElementById('proto-url').value = '';
    document.getElementById('proto-title-url').value = '';
    await loadView(); toast('Protocol saved ✓');
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
    await api('POST', '/api/protocols/from-paste', { title, text, tags: [] });
    document.getElementById('proto-title-paste').value = '';
    document.getElementById('proto-paste-text').value = '';
    await loadView(); toast('Protocol saved ✓');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Extract Steps'; btn.disabled = false; } }
}

async function protoAddFile() {
  var title     = document.getElementById('proto-title-file')?.value.trim();
  var fileInput = document.getElementById('proto-file');
  var file      = fileInput?.files[0];
  if (!title) { toast('Add a title', true); return; }
  if (!file)  { toast('Choose a file first', true); return; }
  var btn = document.querySelector('#pt-file .btn.primary');
  if (btn) { btn.textContent = 'Uploading...'; btn.disabled = true; }
  try {
    var fd = new FormData();
    fd.append('title', title); fd.append('file', file); fd.append('tags', '[]');
    var resp = await fetch('/api/protocols/from-file', { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(await resp.text());
    document.getElementById('proto-title-file').value = '';
    fileInput.value = '';
    await loadView(); toast('Protocol saved ✓');
  } catch(e) { toast('Failed: ' + e.message, true); }
  finally { if (btn) { btn.textContent = 'Upload + Extract'; btn.disabled = false; } }
}

async function protoReExtract(id) {
  toast('Re-extracting steps...');
  try { await api('POST', '/api/protocols/' + id + '/re-extract'); await loadView(); toast('Steps updated ✓'); }
  catch(e) { toast('Re-extract failed: ' + e.message, true); }
}

async function protoSave(id) {
  var notes = document.getElementById('pn-' + id)?.value || '';
  await api('PUT', '/api/protocols/' + id, { notes });
  toast('Saved ✓');
}

async function protoDelete(id) {
  if (!confirm('Delete this protocol?')) return;
  await api('DELETE', '/api/protocols/' + id);
  await loadView(); toast('Deleted');
}

// ── run modal (kept for openProtocolPicker global compat) ─────────────────────
function protoOpenRun(protocolId) {
  var p = (S.protocols || []).find(function(x) { return x.id === protocolId; });
  if (!p) return;
  var steps = [];
  try {
    var parsed = JSON.parse(p.steps || '[]');
    if (Array.isArray(parsed) && parsed.length && parsed[0].text) steps = parsed;
  } catch(e) {}
  if (!steps.length) { toast('No structured steps yet — click &#10227; to extract first', true); return; }
  // delegate to scratch runner
  if (typeof spLaunchRunDirect === 'function') {
    spLaunchRunDirect(p);
  } else {
    toast('Open the Scratch pad to run protocols', true);
  }
}

registerView('protocols', renderProtocols);
