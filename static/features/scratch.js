// ── SCRATCH PAD ───────────────────────────────────────────────────────────────

var _scratchProtoRun = null;

(function injectScratchProtoStyles() {
  if (document.getElementById('scratch-proto-styles')) return;
  var s = document.createElement('style');
  s.id = 'scratch-proto-styles';
  s.textContent = `
    .sp-picker{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:14px;margin-top:14px}
    .sp-picker-row{display:flex;gap:8px;align-items:center}
    .sp-picker-row input{flex:1}
    .sp-picker select{width:100%;margin-top:8px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:inherit;font-size:13px;padding:4px;color:#4a4139}

    .sp-run-header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid #e8e2d8;margin-bottom:14px}
    .sp-run-title{font-weight:700;font-size:15px;color:#4a4139}
    .sp-run-meta{font-size:12px;color:#8a7f72;margin-top:2px}
    .sp-progress{height:4px;background:#e8e2d8;border-radius:2px;margin-bottom:18px}
    .sp-progress-fill{height:100%;background:#5b7a5e;border-radius:2px;transition:width .25s ease}

    /* recipe in run */
    .sp-recipe-section{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:14px;margin-bottom:18px}
    .sp-recipe-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .sp-recipe-label{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72}
    .sp-scale-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a4139}
    .sp-scale-row input[type=checkbox]{accent-color:#5b7a5e;width:14px;height:14px}
    .sp-scale-row input[type=number]{width:70px;padding:3px 6px;border:1px solid #d5cec0;border-radius:4px;font-size:13px;font-family:inherit}
    .sp-recipe-wrap{overflow-x:auto}
    .sp-recipe-table{border-collapse:collapse;font-size:13px;color:#4a4139;min-width:100%;background:#faf8f4;border-radius:6px;overflow:hidden}
    .sp-recipe-table th{background:#e8e2d8;border:1px solid #d5cec0;padding:6px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap}
    .sp-recipe-table td{border:1px solid #e8e2d8;padding:0}
    .sp-recipe-table td input{width:100%;border:none;background:transparent;padding:6px 10px;font-size:13px;font-family:inherit;color:#4a4139;outline:none;min-width:70px}
    .sp-recipe-table td input:focus{background:#fff8f0}
    .sp-recipe-table td.vol-cell input{font-weight:600;color:#5b7a5e}
    .sp-recipe-table td.vol-cell input[readonly]{color:#8a7f72;background:#f0f4f0}
    .sp-recipe-add{margin-top:7px;display:flex;gap:6px}

    /* steps */
    .sp-step{border:1px solid #e8e2d8;border-radius:6px;padding:10px 12px;margin-bottom:7px;background:#fff;transition:background .15s,border-color .15s}
    .sp-step.done{background:#f0f4f0;border-color:#c8d8c8}
    .sp-step.has-dev{border-left:3px solid #c97b3c}
    .sp-step-check{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
    .sp-step-check input[type=checkbox]{margin-top:3px;flex-shrink:0;accent-color:#5b7a5e;width:15px;height:15px}
    .sp-step-text{font-size:13px;color:#4a4139;line-height:1.55;flex:1}
    .sp-step.done .sp-step-text{color:#8a7f72}
    .sp-dev-btn{background:none;border:none;font-size:11px;color:#8a7f72;cursor:pointer;padding:4px 0 0 25px;text-decoration:underline dotted;display:block}
    .sp-dev-btn:hover{color:#4a4139}
    .sp-dev-note{display:none;margin-top:7px;padding-left:25px}
    .sp-dev-note.open{display:block}
    .sp-dev-note textarea{width:100%;font-size:12px;font-family:inherit;border:1px solid #d5cec0;border-radius:4px;padding:6px 8px;background:#fdf6ee;color:#4a4139;resize:vertical;min-height:44px}
    .sp-dev-note textarea::placeholder{color:#b0a898}

    /* summary */
    .sp-summary{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:16px;margin-top:18px}
    .sp-summary-head{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px}
    .sp-summary-list{margin:0 0 10px 16px;padding:0;font-size:13px;color:#4a4139;line-height:1.6}
    .sp-summary-list li{margin-bottom:6px}
    .sp-dev-orig{color:#8a7f72;font-size:12px}
    .sp-dev-orig s{text-decoration:line-through}
    .sp-dev-new{color:#b85c1a;font-size:12px;margin-top:1px}
    .sp-summary-clean{font-size:13px;color:#5b7a5e;font-style:italic}
    .sp-run-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
  `;
  document.head.appendChild(s);
})();

// ── recipe helpers (run-time) ─────────────────────────────────────────────────
var _DEFAULT_RECIPE = { columns: ['Component', 'Stock conc.', 'Volume (µL)', 'Final conc.'], rows: [] };

function _parseRecipeRun(raw) {
  if (!raw) return JSON.parse(JSON.stringify(_DEFAULT_RECIPE));
  try {
    var r = JSON.parse(raw);
    if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) return r;
  } catch(e) {}
  return JSON.parse(JSON.stringify(_DEFAULT_RECIPE));
}

// find which column index is the volume column
function _volColIndex(columns) {
  for (var i = 0; i < columns.length; i++) {
    if (columns[i].toLowerCase().indexOf('vol') !== -1 ||
        columns[i].toLowerCase().indexOf('µl') !== -1 ||
        columns[i].toLowerCase().indexOf('ul') !== -1) return i;
  }
  return -1;
}

function _renderRunRecipe() {
  var rs = _scratchProtoRun;
  if (!rs) return '';
  var recipe = rs.recipe;
  var scaling = rs.scaling;
  var factor  = rs.scaleFactor || 1;
  var volCol  = _volColIndex(recipe.columns);

  var html = '<div class="sp-recipe-section">';
  html += '<div class="sp-recipe-head">';
  html += '<span class="sp-recipe-label">Reaction Recipe</span>';
  html += '<div class="sp-scale-row">';
  html += '<input type="checkbox" id="sp-scale-toggle"' + (scaling ? ' checked' : '') +
    ' onchange="spToggleScale(this.checked)"/> <label for="sp-scale-toggle" style="cursor:pointer">Scale</label>';
  if (scaling) {
    html += '&nbsp;&times;&nbsp;<input type="number" id="sp-scale-factor" value="' + factor +
      '" min="0.01" step="0.1" style="width:65px" oninput="spUpdateScale(this.value)"/>';
  }
  html += '</div></div>';

  if (recipe.rows.length === 0 && !scaling) {
    html += '<div style="color:#8a7f72;font-size:13px;font-style:italic">No components defined — add rows or edit the template in Protocols.</div>';
  } else {
    html += '<div class="sp-recipe-wrap"><table class="sp-recipe-table"><thead><tr>';
    recipe.columns.forEach(function(c) { html += '<th>' + esc(c) + '</th>'; });
    html += '</tr></thead><tbody>';

    recipe.rows.forEach(function(row, ri) {
      html += '<tr>';
      recipe.columns.forEach(function(_, ci) {
        var rawVal = row[ci] || '';
        var isVol  = (ci === volCol);
        var displayVal = rawVal;
        if (isVol && scaling && factor && rawVal) {
          var num = parseFloat(rawVal);
          if (!isNaN(num)) displayVal = (num * factor).toFixed(2).replace(/\.00$/, '');
        }
        var cellClass = isVol ? ' class="vol-cell"' : '';
        // vol col: show computed value readonly when scaling, editable when not
        if (isVol && scaling) {
          html += '<td' + cellClass + '><input type="text" value="' + esc(displayVal) +
            '" readonly title="Scaled from ' + esc(rawVal) + ' × ' + factor + '"/></td>';
        } else {
          html += '<td' + cellClass + '><input type="text" value="' + esc(displayVal) +
            '" oninput="spRecipeCell(' + ri + ',' + ci + ',this.value)"/></td>';
        }
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
  }

  html += '<div class="sp-recipe-add">' +
    '<button class="btn" onclick="spAddRecipeRow()">+ Row</button>' +
    '<button class="btn" onclick="spAddRecipeCol()">+ Column</button>' +
  '</div>';
  html += '</div>';
  return html;
}

function spToggleScale(checked) {
  if (!_scratchProtoRun) return;
  _scratchProtoRun.scaling = checked;
  if (checked && !_scratchProtoRun.scaleFactor) _scratchProtoRun.scaleFactor = 1;
  _refreshRunRecipe();
}

function spUpdateScale(val) {
  if (!_scratchProtoRun) return;
  var n = parseFloat(val);
  _scratchProtoRun.scaleFactor = isNaN(n) ? 1 : n;
  _refreshRunRecipe();
}

function spRecipeCell(ri, ci, value) {
  if (!_scratchProtoRun || !_scratchProtoRun.recipe.rows[ri]) return;
  _scratchProtoRun.recipe.rows[ri][ci] = value;
}

function spAddRecipeRow() {
  if (!_scratchProtoRun) return;
  var r = _scratchProtoRun.recipe;
  r.rows.push(r.columns.map(function() { return ''; }));
  _refreshRunRecipe();
}

function spAddRecipeCol() {
  var name = prompt('Column name:');
  if (!name) return;
  var r = _scratchProtoRun.recipe;
  r.columns.push(name);
  r.rows.forEach(function(row) { row.push(''); });
  _refreshRunRecipe();
}

function _refreshRunRecipe() {
  var wrap = document.getElementById('sp-recipe-wrap');
  if (wrap) wrap.innerHTML = _renderRunRecipe();
}

// ── main render ───────────────────────────────────────────────────────────────
async function renderScratch(el) {
  if (_scratchProtoRun) { _renderProtoRunInScratch(el); return; }

  var data = await api('GET', '/api/scratch');
  var entries = data.entries || [];

  var html = '<div class="scratch-area">' +
    '<div class="section-label">Quick note</div>' +
    '<div class="scratch-quick">' +
      '<input type="text" id="sq-input" placeholder="Type and hit Enter - gets filed overnight" spellcheck="false"/>' +
      '<button onclick="addScratchQuick()">Dump it</button>' +
    '</div>' +
    '<div class="section-label" style="margin-top:14px">Brain dump</div>' +
    '<textarea class="scratch-big" id="sb-input" placeholder="Dump everything here — rough notes, observations, half-formed ideas. Hit Save and forget it. Gets sorted overnight."></textarea>' +
    '<div style="display:flex;justify-content:flex-end"><button class="btn primary" onclick="addScratchBig()">Save dump</button></div>' +

    '<div class="section-label" style="margin-top:14px">Run a protocol</div>' +
    '<div id="sp-proto-picker-wrap">' +
      '<button class="btn" style="color:#5b7a5e" onclick="spShowPicker()">&#9654; Pick &amp; run a protocol</button>' +
    '</div>' +

    '<div class="section-label" style="margin-top:14px">Drop a figure</div>' +
    '<div class="drop-zone" id="drop-zone" onclick="triggerFileInput()" ondrop="handleDrop(event)">' +
      '<input type="file" id="file-input" accept="image/*,.pdf" onchange="handleFileSelect(event)"/>' +
      '&#128247; Drop a gel, western blot, SEC trace, or any figure here<br>' +
      '<span style="font-size:12px;color:var(--dim)">Images get analysed by the 3090 overnight and filed to the right project</span>' +
    '</div>';

  if (entries.length) {
    html += '<div class="section-label" style="margin-top:14px">Pending — awaiting overnight processing (' + entries.length + ')</div>' +
      '<div class="scratch-list">' +
      entries.map(function(e) {
        return '<div class="scratch-item ' + (e.has_image ? 'has-image' : '') + '">' +
          (e.has_image ? '<img class="scratch-thumb" src="/api/scratch/' + e.id + '/image-raw" onerror="this.style.display=\'none\'" onclick="viewScratchImage(' + e.id + ')"/>' : '') +
          '<div class="scratch-item-content">' + esc((e.content || e.filename || 'image').slice(0, 200)) + '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
            '<div class="scratch-item-time">' + relTime(e.created) + '</div>' +
            '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteScratch(' + e.id + ')">&#215;</button>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
  } else {
    html += '<div style="margin-top:8px;color:var(--muted);font-size:13px;font-style:italic">&#10003; All clear — nothing waiting to be processed.</div>';
  }
  html += '</div>';
  el.innerHTML = html;
  setTimeout(function() {
    initDropZone();
    var sqInp = document.getElementById('sq-input');
    if (sqInp) sqInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') addScratchQuick(); });
  }, 50);
}

// ── picker ────────────────────────────────────────────────────────────────────
async function spShowPicker() {
  var wrap = document.getElementById('sp-proto-picker-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading protocols...</div>';
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];
  if (!S.protocols.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;font-style:italic">No protocols saved yet — add one in the Protocols page first.</div>';
    return;
  }
  var opts = S.protocols.map(function(p) {
    return '<option value="' + p.id + '">' + esc(p.title) + '</option>';
  }).join('');
  wrap.innerHTML =
    '<div class="sp-picker">' +
      '<div class="sp-picker-row">' +
        '<input type="text" id="sp-pk-q" placeholder="Search protocols..." spellcheck="false" oninput="spPickerFilter()"/>' +
        '<button class="btn" onclick="spHidePicker()">Cancel</button>' +
      '</div>' +
      '<select id="sp-pk-sel" size="5">' + opts + '</select>' +
      '<div style="margin-top:8px;text-align:right">' +
        '<button class="btn primary" onclick="spLaunchRun()">&#9654; Start run</button>' +
      '</div>' +
    '</div>';
  document.getElementById('sp-pk-q')?.focus();
}

function spHidePicker() {
  var wrap = document.getElementById('sp-proto-picker-wrap');
  if (wrap) wrap.innerHTML = '<button class="btn" style="color:#5b7a5e" onclick="spShowPicker()">&#9654; Pick &amp; run a protocol</button>';
}

function spPickerFilter() {
  var q = (document.getElementById('sp-pk-q')?.value || '').toLowerCase();
  document.querySelectorAll('#sp-pk-sel option').forEach(function(o) {
    o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function spLaunchRun() {
  var sel = document.getElementById('sp-pk-sel');
  if (!sel || !sel.value) { toast('Select a protocol first', true); return; }
  var p = (S.protocols || []).find(function(x) { return x.id === parseInt(sel.value); });
  if (p) spLaunchRunDirect(p);
}

// called from protocols.js ▶ Run button too
function spLaunchRunDirect(p) {
  var steps = [];
  try {
    var parsed = JSON.parse(p.steps || '[]');
    if (Array.isArray(parsed) && parsed.length && parsed[0].text) steps = parsed;
  } catch(e) {}
  if (!steps.length) { toast('No structured steps yet — open Protocols and click ⟳ to extract first', true); return; }

  var recipe = _parseRecipeRun(p.recipe);

  _scratchProtoRun = {
    protocol:    p,
    steps:       steps.map(function(s, i) { return { id: i, text: s.text, done: false, deviation: '' }; }),
    recipe:      JSON.parse(JSON.stringify(recipe)),  // editable copy
    scaling:     false,
    scaleFactor: 1,
    startedAt:   new Date().toISOString()
  };

  var el = document.getElementById('content');
  if (el) _renderProtoRunInScratch(el);
  else if (typeof setView === 'function') setView('scratch');
}

// ── run view ──────────────────────────────────────────────────────────────────
function _renderProtoRunInScratch(el) {
  var rs = _scratchProtoRun;
  if (!rs) return;
  var done = rs.steps.filter(function(s) { return s.done; }).length;
  var pct  = Math.round((done / rs.steps.length) * 100);

  var stepsHtml = rs.steps.map(function(step) {
    var hasDev = step.deviation.trim().length > 0;
    return '<div class="sp-step' + (step.done ? ' done' : '') + (hasDev ? ' has-dev' : '') + '" id="sps-' + step.id + '">' +
      '<label class="sp-step-check">' +
        '<input type="checkbox"' + (step.done ? ' checked' : '') + ' onchange="spToggleStep(' + step.id + ',this.checked)"/>' +
        '<span class="sp-step-text">' + esc(step.text) + '</span>' +
      '</label>' +
      '<button class="sp-dev-btn" onclick="spToggleDev(' + step.id + ')">' +
        (hasDev ? '&#9998; deviation noted' : '+ deviation note') +
      '</button>' +
      '<div class="sp-dev-note' + (hasDev ? ' open' : '') + '" id="spd-' + step.id + '">' +
        '<textarea placeholder="What did you change or observe?" oninput="spUpdateDev(' + step.id + ',this.value)">' +
          esc(step.deviation) +
        '</textarea>' +
      '</div>' +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div style="padding:0 0 24px">' +
      '<div class="sp-run-header">' +
        '<div>' +
          '<div class="sp-run-title">&#9654; ' + esc(rs.protocol.title) + '</div>' +
          '<div class="sp-run-meta" id="sp-run-meta">' + done + ' / ' + rs.steps.length + ' steps &nbsp;·&nbsp; started ' +
            new Date(rs.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) +
          '</div>' +
        '</div>' +
        '<button class="btn" onclick="spAbandonRun()" title="Return to scratch">&#8592; Back</button>' +
      '</div>' +
      '<div class="sp-progress"><div class="sp-progress-fill" id="sp-pfill" style="width:' + pct + '%"></div></div>' +

      // recipe lives in its own div so we can refresh it without re-rendering steps
      '<div id="sp-recipe-wrap">' + _renderRunRecipe() + '</div>' +

      '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px">Steps</div>' +
      '<div id="sp-steps-list">' + stepsHtml + '</div>' +
      '<div id="sp-summary-wrap"></div>' +
      '<div class="sp-run-footer">' +
        '<button class="btn" onclick="spShowSummary()">View summary</button>' +
        '<button class="btn primary" onclick="spSaveToEntry()">&#10003; Save to Entry &amp; finish</button>' +
      '</div>' +
    '</div>';
}

function spAbandonRun() {
  var rs    = _scratchProtoRun;
  var dirty = rs && rs.steps.some(function(s) { return s.done || s.deviation.trim(); });
  if (dirty && !confirm('Abandon this run? Progress will be lost.')) return;
  _scratchProtoRun = null;
  loadView();
}

// ── step interaction ──────────────────────────────────────────────────────────
function spToggleStep(id, checked) {
  if (!_scratchProtoRun) return;
  var step = _scratchProtoRun.steps.find(function(s) { return s.id === id; });
  if (!step) return;
  step.done = checked;
  var el = document.getElementById('sps-' + id);
  if (el) el.classList.toggle('done', checked);
  var done = _scratchProtoRun.steps.filter(function(s) { return s.done; }).length;
  var pct  = Math.round((done / _scratchProtoRun.steps.length) * 100);
  var fill = document.getElementById('sp-pfill');
  if (fill) fill.style.width = pct + '%';
  var meta = document.getElementById('sp-run-meta');
  if (meta) meta.textContent = done + ' / ' + _scratchProtoRun.steps.length + ' steps · started ' +
    new Date(_scratchProtoRun.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function spToggleDev(id) {
  var noteEl = document.getElementById('spd-' + id);
  if (!noteEl) return;
  var open = noteEl.classList.toggle('open');
  if (open) noteEl.querySelector('textarea')?.focus();
}

function spUpdateDev(id, value) {
  if (!_scratchProtoRun) return;
  var step = _scratchProtoRun.steps.find(function(s) { return s.id === id; });
  if (step) step.deviation = value;
  var el = document.getElementById('sps-' + id);
  if (el) {
    el.classList.toggle('has-dev', value.trim().length > 0);
    var btn = el.querySelector('.sp-dev-btn');
    if (btn) btn.textContent = value.trim() ? '\u270e deviation noted' : '+ deviation note';
  }
}

// ── summary ───────────────────────────────────────────────────────────────────
function spShowSummary() {
  var wrap = document.getElementById('sp-summary-wrap');
  if (!wrap || !_scratchProtoRun) return;
  var rs   = _scratchProtoRun;
  var devs = rs.steps.filter(function(s) { return s.deviation.trim(); });
  var inc  = rs.steps.filter(function(s) { return !s.done; });

  var html = '<div class="sp-summary">';
  html += '<div class="sp-summary-head">Run summary</div>';
  if (devs.length) {
    html += '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin-bottom:6px">Deviations</div>';
    html += '<ul class="sp-summary-list">';
    devs.forEach(function(step) {
      html += '<li><div class="sp-dev-orig"><s>' + esc(step.text) + '</s></div>' +
        '<div class="sp-dev-new">&#8594; ' + esc(step.deviation) + '</div></li>';
    });
    html += '</ul>';
  } else {
    html += '<div class="sp-summary-clean">No deviations — ran exactly as written.</div>';
  }
  if (inc.length) {
    html += '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin:12px 0 6px">Incomplete steps</div>';
    html += '<ul class="sp-summary-list">';
    inc.forEach(function(s) { html += '<li style="color:#8a7f72">' + esc(s.text) + '</li>'; });
    html += '</ul>';
  }
  html += '</div>';
  wrap.innerHTML = html;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── save to entry ─────────────────────────────────────────────────────────────
async function spSaveToEntry() {
  var rs = _scratchProtoRun;
  if (!rs) return;
  var done  = rs.steps.filter(function(s) { return s.done; }).length;
  var devs  = rs.steps.filter(function(s) { return s.deviation.trim(); });
  var inc   = rs.steps.filter(function(s) { return !s.done; });
  var today = new Date().toISOString().split('T')[0];
  var volCol = _volColIndex(rs.recipe.columns);

  var lines = [
    '## Protocol Run: ' + rs.protocol.title, '',
    '**Date:** ' + new Date(rs.startedAt).toLocaleString(),
    '**Progress:** ' + done + ' / ' + rs.steps.length + ' steps completed', ''
  ];

  // recipe table as markdown
  if (rs.recipe.rows.length) {
    lines.push('### Reaction Recipe');
    if (rs.scaling && rs.scaleFactor !== 1) {
      lines.push('_Scale factor: ×' + rs.scaleFactor + '_');
    }
    var header = '| ' + rs.recipe.columns.join(' | ') + ' |';
    var sep    = '| ' + rs.recipe.columns.map(function() { return '---'; }).join(' | ') + ' |';
    lines.push(header, sep);
    rs.recipe.rows.forEach(function(row) {
      var cells = rs.recipe.columns.map(function(_, ci) {
        var val = row[ci] || '';
        if (ci === volCol && rs.scaling && rs.scaleFactor && val) {
          var num = parseFloat(val);
          if (!isNaN(num)) val = (num * rs.scaleFactor).toFixed(2).replace(/\.00$/, '') + ' (scaled)';
        }
        return val;
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    });
    lines.push('');
  }

  lines.push('### Steps');
  rs.steps.forEach(function(step, i) {
    lines.push((i + 1) + '. [' + (step.done ? 'x' : ' ') + '] ' + step.text);
    if (step.deviation) lines.push('   _↳ ' + step.deviation + '_');
  });

  if (devs.length) {
    lines.push('', '### Deviation Log');
    devs.forEach(function(step) {
      lines.push('- ~~' + step.text + '~~');
      lines.push('  → ' + step.deviation);
    });
  }

  if (inc.length) {
    lines.push('', '### Not completed');
    inc.forEach(function(s) { lines.push('- ' + s.text); });
  }

  try {
    await api('POST', '/api/entries', {
      title:      'Protocol Run: ' + rs.protocol.title,
      date:       today,
      group_name: 'Protocols',
      subgroup:   '',
      content:    lines.join('\n'),
      summary:    ''
    });
    toast('Saved to lab notebook ✓');
    _scratchProtoRun = null;
    loadView();
  } catch(e) { toast('Save failed: ' + e.message, true); }
}

// ── original scratch functions ────────────────────────────────────────────────
async function addScratchQuick() {
  var inp = document.getElementById('sq-input');
  var text = inp?.value.trim(); if (!text) return;
  await api('POST', '/api/scratch', { type: 'text', content: text });
  inp.value = ''; await load(); toast('Noted — will be filed overnight');
}

async function addScratchBig() {
  var ta = document.getElementById('sb-input');
  var text = ta?.value.trim(); if (!text) return;
  await api('POST', '/api/scratch', { type: 'text', content: text });
  ta.value = ''; await load(); toast('Saved — will be sorted overnight');
}

function viewScratchImage(id) {
  var w = window.open('', '_blank', 'width=800,height=600');
  w.document.write('<img src="/api/scratch/' + id + '/image-raw" style="max-width:100%;max-height:100vh"/>');
}

async function deleteScratch(id) {
  await api('DELETE', '/api/scratch/' + id); await load();
}

function triggerFileInput() { document.getElementById('file-input').click(); }

function initDropZone() {
  var dz = document.getElementById('drop-zone');
  if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('dragover'); });
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dragover');
  var file = e.dataTransfer.files[0];
  if (file) uploadScratchFile(file);
}

function handleFileSelect(e) {
  var file = e.target.files[0];
  if (file) uploadScratchFile(file);
}

async function uploadScratchFile(file) {
  var reader = new FileReader();
  reader.onload = async function(e) {
    var b64 = e.target.result.split(',')[1];
    await api('POST', '/api/scratch', { type: 'image', content: '', filename: file.name, image_data: b64 });
    await load(); toast('Figure saved — will be analysed overnight');
  };
  reader.readAsDataURL(file);
}

registerView('scratch', renderScratch);
