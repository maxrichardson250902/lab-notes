/* ═══════════════════════════════════════════════════
   Plan Converter — Experimental plan → Pipeline
   ═══════════════════════════════════════════════════ */

(function () {

/* ── inject styles once ────────────────────────────── */
if (!document.getElementById('pc-css')) {
  var _css = document.createElement('style');
  _css.id = 'pc-css';
  _css.textContent = `
/* ── layout ── */
.pc-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.pc-tabs {
  display: flex; gap: 0; border-bottom: 1px solid #d5cec0;
  background: #faf8f4; flex-shrink: 0; padding: 0 16px;
}
.pc-tab {
  padding: 10px 18px; font-size: .81rem; font-weight: 600; color: #8a7f72;
  cursor: pointer; border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s; background: none; border-top: none;
  border-left: none; border-right: none; font-family: inherit;
}
.pc-tab:hover { color: #4a4139; }
.pc-tab-on { color: #5b7a5e; border-bottom-color: #5b7a5e; }
.pc-body { flex: 1; overflow-y: auto; padding: 20px 24px 40px; }
.pc-sec { font-size: .67rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #8a7f72; margin-bottom: 10px; }

/* ── input area ── */
.pc-input-wrap { max-width: 720px; }
.pc-ta {
  width: 100%; min-height: 160px; box-sizing: border-box;
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 7px;
  padding: 12px 14px; font-size: .84rem; color: #4a4139;
  font-family: "SF Mono",Monaco,Consolas,monospace; line-height: 1.55;
  resize: vertical; outline: none;
}
.pc-ta:focus { border-color: #5b7a5e; }
.pc-ta::placeholder { color: #b5aca0; }
.pc-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

/* ── buttons ── */
.pc-btn {
  padding: 7px 14px; border-radius: 6px; font-size: .79rem; font-family: inherit;
  border: 1px solid #d5cec0; background: #faf8f4; color: #4a4139;
  cursor: pointer; transition: background .12s, border-color .12s; white-space: nowrap;
}
.pc-btn:hover { background: #f0ebe3; }
.pc-btn-p { background: #5b7a5e; border-color: #5b7a5e; color: #fff; }
.pc-btn-p:hover { background: #4a6a4d; }
.pc-btn-p:disabled { opacity: .5; cursor: not-allowed; }
.pc-btn-sm { padding: 4px 10px; font-size: .73rem; }
.pc-btn-del { border-color: #c0796a; color: #c0796a; }
.pc-btn-del:hover { background: #c0796a14; }
.pc-btn-ghost { background: transparent; border: none; color: #8a7f72; padding: 4px 8px; font-size: .78rem; }
.pc-btn-ghost:hover { color: #4a4139; background: #f0ebe3; }

/* ── template dropdown ── */
.pc-tpl-wrap { position: relative; }
.pc-tpl-dd {
  position: absolute; top: 100%; left: 0; z-index: 10;
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 7px;
  box-shadow: 0 4px 16px rgba(60,52,42,.12); min-width: 220px;
  max-height: 260px; overflow-y: auto; margin-top: 4px;
}
.pc-tpl-item {
  padding: 8px 12px; cursor: pointer; font-size: .79rem; color: #4a4139;
  border-bottom: 1px solid #ede8df; display: flex; align-items: center; justify-content: space-between;
}
.pc-tpl-item:hover { background: #f0ebe3; }
.pc-tpl-item:last-child { border-bottom: none; }
.pc-tpl-empty { padding: 14px; text-align: center; color: #8a7f72; font-size: .78rem; }

/* ── progress ── */
.pc-prog { margin-top: 16px; max-width: 720px; }
.pc-prog-bar {
  height: 6px; background: #ede8df; border-radius: 4px; overflow: hidden;
}
.pc-prog-fill {
  height: 100%; background: #5b7a5e; border-radius: 4px;
  transition: width .4s ease;
}
.pc-prog-fill-err { background: #c0796a; }
.pc-prog-label { font-size: .76rem; color: #8a7f72; margin-top: 6px; }
.pc-prog-err { font-size: .76rem; color: #c0796a; margin-top: 4px; }

/* ── preview cards ── */
.pc-preview { max-width: 900px; margin-top: 20px; }
.pc-day-group { margin-bottom: 18px; }
.pc-day-label {
  font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: #5b7a5e; margin-bottom: 8px; padding-left: 2px;
}
.pc-card {
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 8px;
  padding: 12px 14px; margin-bottom: 8px; position: relative;
  transition: border-color .14s;
}
.pc-card:hover { border-color: #b5aca0; }
.pc-card-sel { border-color: #5b7a5e; background: #f4f8f4; }
.pc-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.pc-card-title { font-size: .88rem; font-weight: 600; color: #4a4139; }
.pc-card-cat {
  font-size: .65rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 4px; white-space: nowrap;
}
.pc-cat-cloning      { background: #e4ede4; color: #3a5a3d; }
.pc-cat-transformation { background: #dce8f0; color: #3a5a7d; }
.pc-cat-culture      { background: #f0e8dc; color: #7d5a3a; }
.pc-cat-purification { background: #e8dce8; color: #5a3a5a; }
.pc-cat-analysis     { background: #f0f0dc; color: #5a5a3a; }
.pc-cat-sequencing   { background: #dcf0f0; color: #3a5a5a; }
.pc-cat-other        { background: #ede8df; color: #6a6050; }
.pc-card-desc { font-size: .78rem; color: #6a6050; margin-top: 5px; line-height: 1.45; }
.pc-card-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.pc-chip {
  font-size: .7rem; padding: 2px 8px; border-radius: 10px;
  border: 1px solid #d5cec0; background: #f0ebe3; color: #6a6050;
  cursor: default; white-space: nowrap;
}
.pc-chip-dna { border-color: #7a9bb5; background: #e4ecf2; color: #3a5a7d; cursor: pointer; }
.pc-chip-dna:hover { background: #d4dfe8; }
.pc-chip-proto { border-color: #5b7a5e; background: #e4ede4; color: #3a5a3d; cursor: pointer; }
.pc-chip-proto:hover { background: #d4e6d4; }
.pc-chip-mat { border-color: #d5cec0; }
.pc-deps { font-size: .7rem; color: #8a7f72; margin-top: 4px; }
.pc-card-btns { display: flex; gap: 3px; margin-top: 6px; }

/* ── inline day control ── */
.pc-day-inline {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: .7rem; color: #8a7f72; margin-right: 8px;
}
.pc-day-nudge {
  background: none; border: 1px solid #d5cec0; border-radius: 3px;
  width: 20px; height: 20px; cursor: pointer; font-size: .7rem;
  color: #8a7f72; display: inline-flex; align-items: center; justify-content: center;
  padding: 0; font-family: inherit;
}
.pc-day-nudge:hover { background: #f0ebe3; color: #4a4139; }
.pc-day-val { font-weight: 600; color: #5b7a5e; min-width: 14px; text-align: center; }

/* ── bulk shift bar ── */
.pc-bulk-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: #f0ebe3; border: 1px solid #d5cec0; border-radius: 7px;
  padding: 8px 12px; margin-bottom: 14px;
}
.pc-bulk-bar label { font-size: .74rem; color: #6a6050; font-weight: 600; }
.pc-bulk-inp {
  width: 50px; padding: 4px 6px; border: 1px solid #d5cec0; border-radius: 4px;
  font-size: .76rem; text-align: center; background: #faf8f4; font-family: inherit;
}

/* ── edit form ── */
.pc-edit {
  background: #f0ebe3; border: 1px solid #d5cec0; border-radius: 8px;
  padding: 14px; margin-bottom: 8px;
}
.pc-edit-row { display: flex; gap: 8px; margin-bottom: 6px; }
.pc-edit-row > * { flex: 1; }
.pc-inp {
  width: 100%; box-sizing: border-box;
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 5px;
  padding: 6px 9px; font-size: .8rem; color: #4a4139;
  font-family: inherit; outline: none; display: block;
}
.pc-inp:focus { border-color: #5b7a5e; }
.pc-inp-sm { padding: 5px 8px; font-size: .76rem; }

/* ── timeline / gantt ── */
.pc-timeline { margin-top: 16px; max-width: 900px; }
.pc-tl-row { display: flex; align-items: stretch; margin-bottom: 2px; min-height: 32px; }
.pc-tl-label {
  width: 140px; min-width: 140px; font-size: .73rem; color: #4a4139;
  padding: 5px 8px 5px 0; text-align: right; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-tl-track { flex: 1; position: relative; display: flex; align-items: center; }
.pc-tl-bar {
  height: 22px; border-radius: 4px; position: absolute;
  display: flex; align-items: center; padding: 0 6px;
  font-size: .65rem; font-weight: 600; color: #fff; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  min-width: 20px;
}
.pc-tl-head { display: flex; margin-bottom: 6px; }
.pc-tl-head-spacer { width: 140px; min-width: 140px; }
.pc-tl-head-days { flex: 1; display: flex; }
.pc-tl-day-col {
  flex: 1; text-align: center; font-size: .67rem; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: #8a7f72;
  border-left: 1px solid #e8e2d8; padding: 4px 0;
}
.pc-tl-day-col:first-child { border-left: none; }
.pc-tl-grid { flex: 1; position: relative; }
.pc-tl-gridline {
  position: absolute; top: 0; bottom: 0; width: 1px; background: #e8e2d8;
}
.pc-tl-arrow {
  position: absolute; top: 50%; height: 2px; background: #bfb8ae;
  transform: translateY(-50%); z-index: 1;
}
.pc-tl-arrow::after {
  content: ''; position: absolute; right: -4px; top: -3px;
  border: 4px solid transparent; border-left-color: #bfb8ae;
}

/* ── colours for gantt bars ── */
.pc-bar-cloning       { background: #5b7a5e; }
.pc-bar-transformation { background: #5a7a9b; }
.pc-bar-culture       { background: #9b7a5a; }
.pc-bar-purification  { background: #7a5a7a; }
.pc-bar-analysis      { background: #7a7a5a; }
.pc-bar-sequencing    { background: #5a7a7a; }
.pc-bar-other         { background: #8a7f72; }

/* ── summary ── */
.pc-summary {
  background: #f0ebe3; border: 1px solid #d5cec0; border-radius: 8px;
  padding: 14px 16px; margin-bottom: 14px;
}
.pc-summary-name { font-size: .95rem; font-weight: 700; color: #4a4139; }
.pc-summary-desc { font-size: .79rem; color: #6a6050; margin-top: 3px; }
.pc-summary-stats { font-size: .74rem; color: #8a7f72; margin-top: 6px; }
.pc-summary-notes { font-size: .76rem; color: #8a7f72; margin-top: 6px; font-style: italic; }

/* ── save template modal ── */
.pc-modal-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(60,52,42,.35); z-index: 100;
  display: flex; align-items: center; justify-content: center;
}
.pc-modal {
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 8px;
  padding: 20px 24px; min-width: 340px; box-shadow: 0 8px 32px rgba(60,52,42,.18);
}
.pc-modal-title { font-size: .88rem; font-weight: 700; color: #4a4139; margin-bottom: 12px; }

/* ── view toggle ── */
.pc-view-toggle { display: flex; gap: 0; margin-bottom: 14px; }
.pc-vt-btn {
  padding: 6px 14px; font-size: .76rem; font-family: inherit; font-weight: 600;
  border: 1px solid #d5cec0; background: #faf8f4; color: #8a7f72;
  cursor: pointer; transition: all .12s;
}
.pc-vt-btn:first-child { border-radius: 5px 0 0 5px; }
.pc-vt-btn:last-child  { border-radius: 0 5px 5px 0; border-left: none; }
.pc-vt-on { background: #5b7a5e; border-color: #5b7a5e; color: #fff; }
.pc-vt-on:hover { background: #4a6a4d; }

.pc-empty { text-align: center; color: #8a7f72; font-size: .81rem; padding: 28px 16px; line-height: 1.65; }

/* file input hidden */
.pc-file-inp { display: none; }
`;
  document.head.appendChild(_css);
}

/* ═══════════════ STATE ═══════════════ */
var PC = {
  templates: [],
  showTplDD: false,
  planText: '',
  stage: 'idle',
  error: null,
  result: null,        // parsed LLM output
  steps: [],           // editable steps array (derived from result)
  pipelineName: '',
  pipelineDesc: '',
  pipelineNotes: '',
  estDays: 0,
  editingIdx: null,    // index in steps[] being edited
  previewView: 'cards', // 'cards' | 'timeline'
  protocols: [],       // all protocols for matching
  dnaPrefixes: {},     // from dna_settings
  matchedProtos: {},   // stepIdx -> [{id, title}]
  matchedDna: {},      // stepIdx -> [{name, type}]
  pollTimer: null,
  showSaveTpl: false,
  tplName: '',
};

var _pcEl = null;

/* ═══════════════ HELPERS ═══════════════ */
var CAT_COLORS = {
  cloning: '#5b7a5e', transformation: '#5a7a9b', culture: '#9b7a5a',
  purification: '#7a5a7a', analysis: '#7a7a5a', sequencing: '#5a7a7a', other: '#8a7f72'
};

function catClass(cat) { return 'pc-cat-' + (cat || 'other'); }
function barClass(cat) { return 'pc-bar-' + (cat || 'other'); }

/* ═══════════════ POLLING ═══════════════ */
function pcStartPoll() {
  pcStopPoll();
  PC.pollTimer = setInterval(async function () {
    try {
      var s = await api('GET', '/api/plan-converter/status');
      PC.stage = s.stage;
      PC.error = s.error;
      if (s.stage === 'done' && s.result) {
        PC.result = s.result;
        pcBuildSteps(s.result);
        pcStopPoll();
      } else if (s.stage === 'error') {
        if (s.result && s.result.raw) PC.result = s.result;
        pcStopPoll();
      }
      pcDraw();
    } catch (e) { /* ignore poll errors */ }
  }, 2000);
}
function pcStopPoll() {
  if (PC.pollTimer) { clearInterval(PC.pollTimer); PC.pollTimer = null; }
}

/* ═══════════════ BUILD STEPS FROM LLM ═══════════════ */
function pcBuildSteps(data) {
  PC.pipelineName = data.name || 'Untitled Pipeline';
  PC.pipelineDesc = data.description || '';
  PC.pipelineNotes = data.notes || '';
  PC.estDays = data.estimated_days || 0;
  PC.steps = (data.steps || []).map(function (s, i) {
    var startDay = s.day || s.start_day || 1;
    var endDay = s.end_day || s.day || startDay;
    if (endDay < startDay) endDay = startDay;
    return {
      title: s.title || 'Step ' + (i + 1),
      description: s.description || '',
      day: startDay,
      end_day: endDay,
      duration_hours: s.duration_hours || 2,
      dependencies: (s.dependencies || []).map(Number),
      category: s.category || 'other',
      materials: s.materials || [],
      linked_protocols: s.linked_protocols || [],
      linked_dna: s.linked_dna || []
    };
  });
  pcSmartMatch();
}

/* ═══════════════ SMART MATCHING ═══════════════ */
function pcSmartMatch() {
  PC.matchedProtos = {};
  PC.matchedDna = {};
  PC.steps.forEach(function (step, idx) {
    // Protocol matching
    var protos = [];
    step.linked_protocols.forEach(function (pname) {
      var lower = pname.toLowerCase();
      var found = PC.protocols.find(function (p) {
        return p.title.toLowerCase() === lower ||
               p.title.toLowerCase().indexOf(lower) !== -1 ||
               lower.indexOf(p.title.toLowerCase()) !== -1;
      });
      if (found) protos.push(found);
    });
    // Also scan description for protocol names
    PC.protocols.forEach(function (p) {
      var already = protos.find(function (x) { return x.id === p.id; });
      if (!already) {
        var re = new RegExp('\\b' + p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(step.description) || re.test(step.title)) {
          protos.push(p);
        }
      }
    });
    if (protos.length) PC.matchedProtos[idx] = protos;

    // DNA matching via prefixes
    var dnaItems = [];
    var text = step.title + ' ' + step.description + ' ' + step.linked_dna.join(' ');
    Object.keys(PC.dnaPrefixes).forEach(function (type) {
      (PC.dnaPrefixes[type] || []).forEach(function (prefix) {
        var re = new RegExp('\\b(' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z0-9_-]+)', 'g');
        var m;
        while ((m = re.exec(text)) !== null) {
          var name = m[1];
          var exists = dnaItems.find(function (d) { return d.name === name; });
          if (!exists) dnaItems.push({ name: name, type: type });
        }
      });
    });
    if (dnaItems.length) PC.matchedDna[idx] = dnaItems;
  });
}

/* ═══════════════ DRAW ═══════════════ */
function pcDraw() {
  if (!_pcEl) return;
  var h = '<div class="pc-root">';
  h += pcTabs();
  h += '<div class="pc-body">';
  if (PC.steps.length > 0 || PC.stage === 'done') {
    h += pcPreview();
  } else {
    h += pcInput();
  }
  h += '</div>';
  if (PC.showSaveTpl) h += pcSaveTplModal();
  h += '</div>';
  _pcEl.innerHTML = h;
  pcBind();
}

/* ── tabs ── */
function pcTabs() {
  return '<div class="pc-tabs">' +
    '<button class="pc-tab" onclick="setView(\x27pipeline\x27)">Pipelines</button>' +
    '<button class="pc-tab pc-tab-on">Plan \u2192 Pipeline</button>' +
    '</div>';
}

/* ── input view ── */
function pcInput() {
  var h = '<div class="pc-input-wrap">';
  h += '<div class="pc-sec">Experimental Plan</div>';
  h += '<textarea class="pc-ta" id="pc-plan" placeholder="Paste or type your experimental plan here...\n\nExample:\nDay 1: Transform pMR1 into DH5\u03b1 competent cells. Plate on LB+Amp.\nDay 2: Pick 3 colonies, inoculate in 5ml LB+Amp overnight.\nDay 3: Miniprep all 3 cultures...">' + esc(PC.planText) + '</textarea>';
  h += '<div class="pc-actions">';
  var canConvert = PC.stage === 'idle' || PC.stage === 'done' || PC.stage === 'error';
  h += '<button class="pc-btn pc-btn-p" id="pc-convert"' + (canConvert ? '' : ' disabled') + '>\uD83E\uDDE0 Convert to Pipeline</button>';
  h += '<label class="pc-btn" for="pc-file-upload">\u21E1 Upload .md/.txt</label>';
  h += '<input type="file" class="pc-file-inp" id="pc-file-upload" accept=".md,.txt">';
  h += '<div class="pc-tpl-wrap">';
  h += '<button class="pc-btn" id="pc-tpl-btn">\u25BC Templates</button>';
  if (PC.showTplDD) h += pcTplDropdown();
  h += '</div>';
  h += '</div>';

  // Progress
  if (PC.stage !== 'idle') {
    h += pcProgress();
  }
  h += '</div>';
  return h;
}

function pcTplDropdown() {
  var h = '<div class="pc-tpl-dd">';
  if (!PC.templates.length) {
    h += '<div class="pc-tpl-empty">No templates saved yet</div>';
  } else {
    PC.templates.forEach(function (t) {
      h += '<div class="pc-tpl-item" data-tid="' + t.id + '">';
      h += '<span>' + esc(t.name) + '</span>';
      h += '<button class="pc-btn-ghost pc-tpl-del" data-tid="' + t.id + '" title="Delete">\u2715</button>';
      h += '</div>';
    });
  }
  h += '</div>';
  return h;
}

/* ── progress bar ── */
function pcProgress() {
  var stages = { idle: 0, waking: 20, starting_llm: 50, parsing: 80, done: 100, error: 100 };
  var labels = {
    idle: '', waking: 'Waking 3090\u2026', starting_llm: 'Starting LLM server\u2026',
    parsing: 'Parsing experimental plan\u2026', done: 'Done!', error: 'Error'
  };
  var pct = stages[PC.stage] || 0;
  var isErr = PC.stage === 'error';
  var h = '<div class="pc-prog">';
  h += '<div class="pc-prog-bar"><div class="pc-prog-fill' + (isErr ? ' pc-prog-fill-err' : '') + '" style="width:' + pct + '%"></div></div>';
  h += '<div class="pc-prog-label">' + (labels[PC.stage] || PC.stage) + '</div>';
  if (isErr && PC.error) {
    h += '<div class="pc-prog-err">' + esc(PC.error) + '</div>';
    h += '<div style="margin-top:8px"><button class="pc-btn pc-btn-sm" id="pc-retry">Try again</button></div>';
  }
  h += '</div>';
  return h;
}

/* ── preview view ── */
function pcPreview() {
  var h = '<div class="pc-preview">';

  // Summary
  h += '<div class="pc-summary">';
  h += '<div class="pc-summary-name" contenteditable="true" id="pc-pname">' + esc(PC.pipelineName) + '</div>';
  h += '<div class="pc-summary-desc" contenteditable="true" id="pc-pdesc">' + esc(PC.pipelineDesc || 'Click to add description') + '</div>';
  h += '<div class="pc-summary-stats">' + PC.steps.length + ' steps \u00B7 ~' + PC.estDays + ' days</div>';
  if (PC.pipelineNotes) h += '<div class="pc-summary-notes">' + esc(PC.pipelineNotes) + '</div>';
  h += '</div>';

  // View toggle + actions
  h += '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px">';
  h += '<div class="pc-view-toggle">';
  h += '<button class="pc-vt-btn' + (PC.previewView === 'cards' ? ' pc-vt-on' : '') + '" data-pv="cards">\u2630 Steps</button>';
  h += '<button class="pc-vt-btn' + (PC.previewView === 'timeline' ? ' pc-vt-on' : '') + '" data-pv="timeline">\u2500 Timeline</button>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  h += '<button class="pc-btn" id="pc-add-step">+ Add Step</button>';
  h += '<button class="pc-btn" id="pc-back-edit">\u270E Edit Plan</button>';
  h += '<button class="pc-btn" id="pc-save-tpl">\u2B27 Save as Template</button>';
  h += '<button class="pc-btn pc-btn-p" id="pc-save-pipeline">\u2714 Create Pipeline</button>';
  h += '</div></div>';

  if (PC.previewView === 'cards') {
    // Bulk shift bar
    h += '<div class="pc-bulk-bar">';
    h += '<label>Shift days:</label>';
    h += '<span style="font-size:.74rem;color:#8a7f72">From day</span>';
    h += '<input class="pc-bulk-inp" id="pc-shift-from" type="number" min="1" value="1">';
    h += '<span style="font-size:.74rem;color:#8a7f72">onward by</span>';
    h += '<input class="pc-bulk-inp" id="pc-shift-by" type="number" value="1">';
    h += '<span style="font-size:.74rem;color:#8a7f72">days</span>';
    h += '<button class="pc-btn pc-btn-sm" id="pc-shift-go">Shift</button>';
    h += '</div>';
    h += pcCardView();
  } else {
    h += pcTimelineView();
  }
  h += '</div>';
  return h;
}

/* ── card view (grouped by day) ── */
function pcCardView() {
  if (!PC.steps.length) return '<div class="pc-empty">No steps yet. Add one to begin.</div>';

  // Group by day
  var days = {};
  PC.steps.forEach(function (s, i) {
    var d = s.day || 1;
    if (!days[d]) days[d] = [];
    days[d].push({ step: s, idx: i });
  });
  var sortedDays = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });

  var h = '';
  sortedDays.forEach(function (day) {
    h += '<div class="pc-day-group">';
    h += '<div class="pc-day-label">Day ' + day + '</div>';
    days[day].forEach(function (item) {
      if (PC.editingIdx === item.idx) {
        h += pcEditCard(item.step, item.idx);
      } else {
        h += pcStepCard(item.step, item.idx);
      }
    });
    h += '</div>';
  });
  return h;
}

function pcStepCard(s, idx) {
  var h = '<div class="pc-card" data-idx="' + idx + '">';
  h += '<div class="pc-card-head">';
  h += '<div class="pc-card-title">' + esc(s.title) + '</div>';
  h += '<span class="pc-card-cat ' + catClass(s.category) + '">' + esc(s.category) + '</span>';
  h += '</div>';
  if (s.description) h += '<div class="pc-card-desc">' + esc(s.description) + '</div>';

  // Chips: protocols, DNA, materials
  var chips = [];
  var protos = PC.matchedProtos[idx] || [];
  protos.forEach(function (p) {
    chips.push('<span class="pc-chip pc-chip-proto" data-proto="' + p.id + '">\u2B21 ' + esc(p.title) + '</span>');
  });
  var dna = PC.matchedDna[idx] || [];
  dna.forEach(function (d) {
    chips.push('<span class="pc-chip pc-chip-dna" data-dna="' + esc(d.name) + '" data-dtype="' + esc(d.type) + '">\uD83E\uDDEC ' + esc(d.name) + '</span>');
  });
  (s.materials || []).forEach(function (m) {
    chips.push('<span class="pc-chip pc-chip-mat">' + esc(m) + '</span>');
  });
  if (chips.length) h += '<div class="pc-card-meta">' + chips.join('') + '</div>';

  // Dependencies
  if (s.dependencies && s.dependencies.length) {
    var depNames = s.dependencies.map(function (d) {
      var dep = PC.steps[d];
      return dep ? dep.title : 'Step ' + (d + 1);
    });
    h += '<div class="pc-deps">\u2190 depends on: ' + depNames.join(', ') + '</div>';
  }

  // Bottom row: day controls + action buttons
  h += '<div class="pc-card-btns">';
  h += '<span class="pc-day-inline">';
  h += '<button class="pc-day-nudge" data-daydn="' + idx + '" title="Start day earlier">\u2212</button>';
  var dayLabel = s.end_day > s.day ? 'D' + s.day + '\u2013' + s.end_day : 'D' + s.day;
  h += '<span class="pc-day-val">' + dayLabel + '</span>';
  h += '<button class="pc-day-nudge" data-dayup="' + idx + '" title="Start day later">+</button>';
  h += '<span style="margin:0 2px;color:#d5cec0">|</span>';
  h += '<button class="pc-day-nudge" data-enddn="' + idx + '" title="Shorten">\u2212</button>';
  h += '<span style="font-size:.65rem;color:#8a7f72">' + (s.end_day - s.day + 1) + 'd</span>';
  h += '<button class="pc-day-nudge" data-endup="' + idx + '" title="Extend">+</button>';
  h += '</span>';
  h += '<span style="flex:1"></span>';
  h += '<button class="pc-btn-ghost" data-edit="' + idx + '" title="Edit">\u270E</button>';
  h += '<button class="pc-btn-ghost" style="color:#c0796a" data-del="' + idx + '" title="Delete">\u2715</button>';
  h += '</div>';

  h += '</div>';
  return h;
}

function pcEditCard(s, idx) {
  var cats = ['cloning','transformation','culture','purification','analysis','sequencing','other'];
  var h = '<div class="pc-edit">';
  h += '<div class="pc-edit-row">';
  h += '<input class="pc-inp" id="pc-e-title" value="' + esc(s.title) + '" placeholder="Step title">';
  h += '<select class="pc-inp" id="pc-e-cat" style="max-width:160px">';
  cats.forEach(function (c) {
    h += '<option value="' + c + '"' + (s.category === c ? ' selected' : '') + '>' + c + '</option>';
  });
  h += '</select></div>';
  h += '<textarea class="pc-inp" id="pc-e-desc" rows="2" placeholder="Description">' + esc(s.description) + '</textarea>';
  h += '<div class="pc-edit-row">';
  h += '<input class="pc-inp pc-inp-sm" id="pc-e-day" type="number" min="1" value="' + s.day + '" placeholder="Start day" style="max-width:80px" title="Start day">';
  h += '<input class="pc-inp pc-inp-sm" id="pc-e-endday" type="number" min="1" value="' + (s.end_day || s.day) + '" placeholder="End day" style="max-width:80px" title="End day">';
  h += '<input class="pc-inp pc-inp-sm" id="pc-e-hrs" type="number" min="0.5" step="0.5" value="' + s.duration_hours + '" placeholder="Hours/day" style="max-width:80px" title="Hours per day">';
  h += '<input class="pc-inp pc-inp-sm" id="pc-e-mats" value="' + esc((s.materials || []).join(', ')) + '" placeholder="Materials (comma separated)">';
  h += '</div>';
  h += '<div style="display:flex;gap:6px;margin-top:6px">';
  h += '<button class="pc-btn pc-btn-p pc-btn-sm" id="pc-e-save">Save</button>';
  h += '<button class="pc-btn pc-btn-sm" id="pc-e-cancel">Cancel</button>';
  h += '</div></div>';
  return h;
}

/* ── timeline / gantt view ── */
function pcTimelineView() {
  if (!PC.steps.length) return '<div class="pc-empty">No steps to show.</div>';

  var maxDay = Math.max.apply(null, PC.steps.map(function (s) { return s.end_day || s.day || 1; }));
  maxDay = Math.max(maxDay, PC.estDays || maxDay);
  var numDays = maxDay;

  var h = '<div class="pc-timeline">';

  // Header with day columns
  h += '<div class="pc-tl-head">';
  h += '<div class="pc-tl-head-spacer"></div>';
  h += '<div class="pc-tl-head-days">';
  for (var d = 1; d <= numDays; d++) {
    h += '<div class="pc-tl-day-col">D' + d + '</div>';
  }
  h += '</div></div>';

  // Rows
  PC.steps.forEach(function (s, idx) {
    var startDay = (s.day || 1) - 1; // 0-indexed
    var endDay = (s.end_day || s.day || 1); // 1-indexed
    var spanDays = endDay - startDay; // how many day-columns it spans
    var leftPct = (startDay / numDays * 100).toFixed(2);
    var widthPct = Math.max(3, (spanDays / numDays * 100)).toFixed(2);

    h += '<div class="pc-tl-row">';
    h += '<div class="pc-tl-label" title="' + esc(s.title) + '">' + esc(s.title) + '</div>';
    h += '<div class="pc-tl-track">';

    // Gridlines
    for (var g = 1; g < numDays; g++) {
      h += '<div class="pc-tl-gridline" style="left:' + (g / numDays * 100).toFixed(2) + '%"></div>';
    }

    h += '<div class="pc-tl-bar ' + barClass(s.category) + '" style="left:' + leftPct + '%;width:' + widthPct + '%">' + esc(s.title) + '</div>';
    h += '</div></div>';
  });

  h += '</div>';
  return h;
}

/* ── save template modal ── */
function pcSaveTplModal() {
  var h = '<div class="pc-modal-overlay" id="pc-modal-bg">';
  h += '<div class="pc-modal">';
  h += '<div class="pc-modal-title">Save as Template</div>';
  h += '<input class="pc-inp" id="pc-tpl-name" placeholder="Template name" value="' + esc(PC.tplName) + '">';
  h += '<div style="display:flex;gap:8px;margin-top:10px">';
  h += '<button class="pc-btn pc-btn-p" id="pc-tpl-save-go">Save</button>';
  h += '<button class="pc-btn" id="pc-tpl-save-x">Cancel</button>';
  h += '</div></div></div>';
  return h;
}

/* ═══════════════ EVENT BINDING ═══════════════ */
function pcBind() {
  // Convert button
  var cvt = document.getElementById('pc-convert');
  if (cvt) cvt.addEventListener('click', pcConvert);

  // File upload
  var fInp = document.getElementById('pc-file-upload');
  if (fInp) fInp.addEventListener('change', pcUploadFile);

  // Template dropdown toggle
  var tBtn = document.getElementById('pc-tpl-btn');
  if (tBtn) tBtn.addEventListener('click', function () {
    PC.showTplDD = !PC.showTplDD; pcDraw();
  });

  // Template items
  _pcEl.querySelectorAll('.pc-tpl-item').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target.classList.contains('pc-tpl-del')) return;
      var tid = parseInt(el.dataset.tid);
      var tpl = PC.templates.find(function (t) { return t.id === tid; });
      if (tpl) {
        PC.planText = tpl.plan_text;
        PC.showTplDD = false;
        pcDraw();
        toast('Loaded: ' + tpl.name);
      }
    });
  });

  // Template delete buttons
  _pcEl.querySelectorAll('.pc-tpl-del').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var tid = parseInt(btn.dataset.tid);
      if (confirm('Delete this template?')) {
        api('DELETE', '/api/plan-converter/templates/' + tid).then(function () {
          PC.templates = PC.templates.filter(function (t) { return t.id !== tid; });
          toast('Template deleted');
          pcDraw();
        });
      }
    });
  });

  // Close dropdown on outside click
  if (PC.showTplDD) {
    setTimeout(function () {
      document.addEventListener('click', function handler(e) {
        if (!e.target.closest('.pc-tpl-wrap')) {
          PC.showTplDD = false; pcDraw();
        }
        document.removeEventListener('click', handler);
      });
    }, 0);
  }

  // Retry button
  var retry = document.getElementById('pc-retry');
  if (retry) retry.addEventListener('click', function () {
    api('POST', '/api/plan-converter/reset').then(function () {
      PC.stage = 'idle'; PC.error = null; PC.result = null; pcDraw();
    });
  });

  // Preview view toggle
  _pcEl.querySelectorAll('.pc-vt-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      PC.previewView = b.dataset.pv; pcDraw();
    });
  });

  // Edit buttons on cards
  _pcEl.querySelectorAll('[data-edit]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      PC.editingIdx = parseInt(b.dataset.edit); pcDraw();
    });
  });

  // Delete step
  _pcEl.querySelectorAll('[data-del]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(b.dataset.del);
      if (confirm('Delete "' + PC.steps[idx].title + '"?')) {
        PC.steps.splice(idx, 1);
        // Fix dependency indices
        PC.steps.forEach(function (s) {
          s.dependencies = s.dependencies.filter(function (d) { return d !== idx; })
            .map(function (d) { return d > idx ? d - 1 : d; });
        });
        pcSmartMatch();
        pcDraw(); toast('Step removed');
      }
    });
  });

  // Day nudge buttons (- / + for start day, moves end_day in sync)
  _pcEl.querySelectorAll('[data-daydn]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(b.dataset.daydn);
      var s = PC.steps[idx];
      if (s.day > 1) {
        var span = (s.end_day || s.day) - s.day;
        s.day -= 1;
        s.end_day = s.day + span;
        pcDraw();
      }
    });
  });
  _pcEl.querySelectorAll('[data-dayup]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(b.dataset.dayup);
      var s = PC.steps[idx];
      var span = (s.end_day || s.day) - s.day;
      s.day += 1;
      s.end_day = s.day + span;
      pcDraw();
    });
  });

  // End day nudge (extend / shorten duration)
  _pcEl.querySelectorAll('[data-endup]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(b.dataset.endup);
      var s = PC.steps[idx];
      s.end_day = (s.end_day || s.day) + 1;
      pcDraw();
    });
  });
  _pcEl.querySelectorAll('[data-enddn]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = parseInt(b.dataset.enddn);
      var s = PC.steps[idx];
      if ((s.end_day || s.day) > s.day) {
        s.end_day = s.end_day - 1;
        pcDraw();
      }
    });
  });

  // Bulk shift
  var shiftGo = document.getElementById('pc-shift-go');
  if (shiftGo) shiftGo.addEventListener('click', function () {
    var fromDay = parseInt(document.getElementById('pc-shift-from').value) || 1;
    var shiftBy = parseInt(document.getElementById('pc-shift-by').value) || 0;
    if (shiftBy === 0) return;
    var moved = 0;
    PC.steps.forEach(function (s) {
      if (s.day >= fromDay) {
        s.day = Math.max(1, s.day + shiftBy);
        s.end_day = Math.max(s.day, (s.end_day || s.day) + shiftBy);
        moved++;
      }
    });
    toast('Shifted ' + moved + ' steps by ' + shiftBy + ' days');
    pcDraw();
  });

  // Edit form save/cancel
  var eSave = document.getElementById('pc-e-save');
  if (eSave) eSave.addEventListener('click', pcSaveEdit);
  var eCancel = document.getElementById('pc-e-cancel');
  if (eCancel) eCancel.addEventListener('click', function () { PC.editingIdx = null; pcDraw(); });

  // Add step
  var addBtn = document.getElementById('pc-add-step');
  if (addBtn) addBtn.addEventListener('click', function () {
    var maxDay = PC.steps.length ? Math.max.apply(null, PC.steps.map(function (s) { return s.day; })) : 1;
    PC.steps.push({
      title: 'New Step', description: '', day: maxDay, end_day: maxDay,
      duration_hours: 2, dependencies: [], category: 'other',
      materials: [], linked_protocols: [], linked_dna: []
    });
    PC.editingIdx = PC.steps.length - 1;
    pcSmartMatch();
    pcDraw();
  });

  // Back to edit plan
  var backBtn = document.getElementById('pc-back-edit');
  if (backBtn) backBtn.addEventListener('click', function () {
    PC.steps = []; PC.result = null; PC.stage = 'idle'; PC.error = null;
    api('POST', '/api/plan-converter/reset'); pcDraw();
  });

  // Save as template
  var saveTpl = document.getElementById('pc-save-tpl');
  if (saveTpl) saveTpl.addEventListener('click', function () {
    PC.showSaveTpl = true; PC.tplName = PC.pipelineName; pcDraw();
    setTimeout(function () { var e = document.getElementById('pc-tpl-name'); if (e) e.focus(); }, 0);
  });

  // Save template modal
  var tplSaveGo = document.getElementById('pc-tpl-save-go');
  if (tplSaveGo) tplSaveGo.addEventListener('click', pcDoSaveTemplate);
  var tplSaveX = document.getElementById('pc-tpl-save-x');
  if (tplSaveX) tplSaveX.addEventListener('click', function () { PC.showSaveTpl = false; pcDraw(); });
  var modalBg = document.getElementById('pc-modal-bg');
  if (modalBg) modalBg.addEventListener('click', function (e) {
    if (e.target === modalBg) { PC.showSaveTpl = false; pcDraw(); }
  });

  // Create pipeline
  var savePl = document.getElementById('pc-save-pipeline');
  if (savePl) savePl.addEventListener('click', pcCreatePipeline);

  // Save plan text on input
  var ta = document.getElementById('pc-plan');
  if (ta) ta.addEventListener('input', function () { PC.planText = ta.value; });

  // Editable pipeline name/desc
  var pname = document.getElementById('pc-pname');
  if (pname) pname.addEventListener('blur', function () {
    var v = pname.textContent.trim();
    if (v) PC.pipelineName = v;
  });
  var pdesc = document.getElementById('pc-pdesc');
  if (pdesc) pdesc.addEventListener('blur', function () {
    PC.pipelineDesc = pdesc.textContent.trim();
  });

  // DNA chip clicks
  _pcEl.querySelectorAll('.pc-chip-dna').forEach(function (chip) {
    chip.addEventListener('click', function () {
      toast('DNA: ' + chip.dataset.dna + ' (' + chip.dataset.dtype + ')');
      // Could navigate: S._pendingSelect = {type: chip.dataset.dtype, name: chip.dataset.dna}; setView('import_data');
    });
  });

  // Protocol chip clicks
  _pcEl.querySelectorAll('.pc-chip-proto').forEach(function (chip) {
    chip.addEventListener('click', function () {
      toast('Protocol: linked (id ' + chip.dataset.proto + ')');
    });
  });
}

/* ═══════════════ ACTIONS ═══════════════ */

async function pcConvert() {
  var ta = document.getElementById('pc-plan');
  if (ta) PC.planText = ta.value;
  if (!PC.planText.trim()) { toast('Please enter an experimental plan', true); return; }
  try {
    await api('POST', '/api/plan-converter/convert', { plan_text: PC.planText });
    pcStartPoll();
    pcDraw();
  } catch (e) {
    toast('Failed to start conversion: ' + e.message, true);
  }
}

async function pcUploadFile() {
  var inp = document.getElementById('pc-file-upload');
  if (!inp || !inp.files.length) return;
  var fd = new FormData();
  fd.append('file', inp.files[0]);
  try {
    var resp = await fetch('/api/plan-converter/upload', { method: 'POST', body: fd });
    if (!resp.ok) { var err = await resp.json().catch(function () { return {}; }); toast(err.detail || 'Upload failed', true); return; }
    var data = await resp.json();
    PC.planText = data.text;
    toast('Loaded: ' + data.filename);
    pcDraw();
  } catch (e) {
    toast('Upload error: ' + e.message, true);
  }
}

function pcSaveEdit() {
  var idx = PC.editingIdx;
  if (idx === null) return;
  var s = PC.steps[idx];
  var title  = document.getElementById('pc-e-title');
  var cat    = document.getElementById('pc-e-cat');
  var desc   = document.getElementById('pc-e-desc');
  var day    = document.getElementById('pc-e-day');
  var endday = document.getElementById('pc-e-endday');
  var hrs    = document.getElementById('pc-e-hrs');
  var mats   = document.getElementById('pc-e-mats');
  if (title)  s.title = title.value.trim() || s.title;
  if (cat)    s.category = cat.value;
  if (desc)   s.description = desc.value.trim();
  if (day)    s.day = Math.max(1, parseInt(day.value) || 1);
  if (endday) s.end_day = Math.max(s.day, parseInt(endday.value) || s.day);
  if (hrs)    s.duration_hours = Math.max(0.5, parseFloat(hrs.value) || 2);
  if (mats)   s.materials = mats.value.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
  PC.editingIdx = null;
  pcSmartMatch();
  pcDraw();
  toast('Step updated');
}

async function pcDoSaveTemplate() {
  var nameEl = document.getElementById('pc-tpl-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { toast('Template name required', true); return; }
  try {
    var tpl = await api('POST', '/api/plan-converter/templates', {
      name: name, plan_text: PC.planText
    });
    PC.templates.unshift(tpl);
    PC.showSaveTpl = false;
    toast('Template saved: ' + name);
    pcDraw();
  } catch (e) {
    toast('Save failed: ' + e.message, true);
  }
}

async function pcCreatePipeline() {
  if (!PC.steps.length) { toast('No steps to save', true); return; }

  try {
    // 1. Create the pipeline
    var pl = await api('POST', '/api/pipelines', {
      name: PC.pipelineName,
      description: PC.pipelineDesc
    });
    var pid = pl.id;

    // 2. Create all steps with positions (arranged by day)
    var dayGroups = {};
    PC.steps.forEach(function (s, i) {
      var d = s.day || 1;
      if (!dayGroups[d]) dayGroups[d] = [];
      dayGroups[d].push({ step: s, origIdx: i });
    });
    var sortedDays = Object.keys(dayGroups).map(Number).sort(function (a, b) { return a - b; });

    var stepIdMap = {}; // origIdx -> server step id
    var xBase = 80;
    var yBase = 80;

    for (var di = 0; di < sortedDays.length; di++) {
      var day = sortedDays[di];
      var group = dayGroups[day];
      for (var gi = 0; gi < group.length; gi++) {
        var item = group[gi];
        var s = item.step;

        // Find protocol match
        var protoId = null;
        var protos = PC.matchedProtos[item.origIdx];
        if (protos && protos.length) protoId = protos[0].id;

        var notes = s.description || '';
        if (s.end_day && s.end_day > s.day) {
          notes += (notes ? '\n' : '') + 'Duration: Day ' + s.day + '\u2013' + s.end_day + ' (' + (s.end_day - s.day + 1) + ' days)';
        }
        if (s.materials && s.materials.length) {
          notes += (notes ? '\n' : '') + 'Materials: ' + s.materials.join(', ');
        }

        var created = await api('POST', '/api/pipelines/' + pid + '/steps', {
          name: s.title,
          notes: notes,
          protocol_id: protoId,
          pos_x: xBase + di * 240,
          pos_y: yBase + gi * 100
        });
        stepIdMap[item.origIdx] = created.id;
      }
    }

    // 3. Create edges from dependencies
    for (var i = 0; i < PC.steps.length; i++) {
      var deps = PC.steps[i].dependencies || [];
      for (var j = 0; j < deps.length; j++) {
        var fromId = stepIdMap[deps[j]];
        var toId   = stepIdMap[i];
        if (fromId && toId) {
          await api('POST', '/api/pipelines/' + pid + '/edges', {
            from_step: fromId, to_step: toId
          });
        }
      }
    }

    // 4. Also create sequential edges for steps on consecutive days (if no explicit deps)
    for (var i2 = 0; i2 < PC.steps.length; i2++) {
      if (PC.steps[i2].dependencies && PC.steps[i2].dependencies.length) continue;
      // Find previous day's last step
      var myDay = PC.steps[i2].day || 1;
      if (myDay <= 1) continue;
      for (var p = i2 - 1; p >= 0; p--) {
        if ((PC.steps[p].day || 1) < myDay) {
          var fid = stepIdMap[p];
          var tid = stepIdMap[i2];
          if (fid && tid) {
            await api('POST', '/api/pipelines/' + pid + '/edges', {
              from_step: fid, to_step: tid
            }).catch(function () {}); // ignore duplicate edge errors
          }
          break;
        }
      }
    }

    toast('Pipeline created: ' + PC.pipelineName);

    // 5. Navigate to pipeline view
    setTimeout(function () {
      setView('pipeline');
      // Open the newly created pipeline after a brief delay
      setTimeout(function () {
        if (typeof plOpen === 'function') plOpen(pid);
      }, 300);
    }, 200);

  } catch (e) {
    toast('Failed to create pipeline: ' + e.message, true);
  }
}

/* ═══════════════ REGISTER ═══════════════ */
async function renderPlanConverter(el) {
  _pcEl = el;
  // Load templates, protocols, dna prefixes
  try {
    var results = await Promise.all([
      api('GET', '/api/plan-converter/templates').catch(function () { return { items: [] }; }),
      api('GET', '/api/plan-converter/all-protocols').catch(function () { return { items: [] }; }),
      api('GET', '/api/plan-converter/dna-prefixes').catch(function () { return { prefixes: {} }; }),
      api('GET', '/api/plan-converter/status').catch(function () { return { stage: 'idle' }; })
    ]);
    PC.templates = results[0].items || [];
    PC.protocols = results[1].items || [];
    PC.dnaPrefixes = results[2].prefixes || {};
    var status = results[3];
    PC.stage = status.stage || 'idle';
    PC.error = status.error;
    if (status.stage === 'done' && status.result) {
      PC.result = status.result;
      if (!PC.steps.length) pcBuildSteps(status.result);
    }
    if (['waking', 'starting_llm', 'parsing'].indexOf(status.stage) !== -1) {
      pcStartPoll();
    }
  } catch (e) {
    /* continue with defaults */
  }
  pcDraw();
}

registerView('plan_converter', renderPlanConverter);

})(); /* end IIFE */
