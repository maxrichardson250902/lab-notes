// ── SCRATCH PAD ───────────────────────────────────────────────────────────────

var _scratchProtoRun = null;
var _RUNS_KEY = 'lab_proto_runs'; // localStorage cache key
var _dbSaveTimer = null;          // debounce timer for DB writes

// ── run persistence: localStorage (fast) + DB (cross-machine) ────────────────

function _getAllRunsLocal() {
  try { return JSON.parse(localStorage.getItem(_RUNS_KEY) || '[]'); } catch(e) { return []; }
}

function _saveLocalOnly(run) {
  if (!run || !run.runId) return;
  var runs = _getAllRunsLocal();
  var idx = -1; runs.forEach(function(r, i) { if (r.runId === run.runId) idx = i; });
  if (idx >= 0) runs[idx] = run; else runs.push(run);
  try { localStorage.setItem(_RUNS_KEY, JSON.stringify(runs)); } catch(e) {}
}

function _removeLocal(runId) {
  try { localStorage.setItem(_RUNS_KEY, JSON.stringify(_getAllRunsLocal().filter(function(r) { return r.runId !== runId; }))); } catch(e) {}
}

function _getRunByIdLocal(runId) {
  return _getAllRunsLocal().find(function(r) { return r.runId === runId; }) || null;
}

// save to localStorage immediately + debounced DB write 800ms later
function _saveRun(run) {
  if (!run || !run.runId) return;
  _saveLocalOnly(run);
  if (_dbSaveTimer) clearTimeout(_dbSaveTimer);
  _dbSaveTimer = setTimeout(function() { _saveRunToDb(run); }, 800);
}

async function _saveRunToDb(run) {
  try {
    await api('PUT', '/api/active-runs/' + encodeURIComponent(run.runId), {
      steps_json:   JSON.stringify(run.steps),
      recipe_json:  JSON.stringify(run.recipe),
      scaling:      run.scaling || false,
      scale_factor: run.scaleFactor || 1.0,
      // Metadata values (side-panel form). Send even when empty ({}) so
      // clearing a field actually persists rather than reverting to
      // whatever was on disk. run.metadata is a plain object.
      metadata_values: JSON.stringify(run.metadata || {})
    });
  } catch(e) {
    // record may not exist yet - create it
    try {
      await api('POST', '/api/active-runs', {
        run_id:        run.runId,
        protocol_id:   run.protocol.id,
        protocol_json: JSON.stringify(run.protocol),
        steps_json:    JSON.stringify(run.steps),
        recipe_json:   JSON.stringify(run.recipe),
        group_name:    run.group_name || '',
        subgroup:      run.subgroup || '',
        scaling:       run.scaling || false,
        scale_factor:  run.scaleFactor || 1.0,
        started_at:    run.startedAt
      });
    } catch(e2) {}
  }
}

async function _removeRun(runId) {
  _removeLocal(runId);
  try { await api('DELETE', '/api/active-runs/' + encodeURIComponent(runId)); } catch(e) {}
}

// fetch from DB (source of truth), fall back to localStorage
async function _getAllRuns() {
  try {
    var data = await api('GET', '/api/active-runs');
    var dbRuns = (data.runs || []).map(function(r) {
      var meta = {};
      try { meta = JSON.parse(r.metadata_values || '{}') || {}; } catch (e) { meta = {}; }
      return {
        runId:       r.run_id,
        protocol:    JSON.parse(r.protocol_json),
        steps:       JSON.parse(r.steps_json || '[]'),
        recipe:      JSON.parse(r.recipe_json || 'null') || _parseRecipeRun(null),
        scaling:     !!r.scaling,
        scaleFactor: r.scale_factor || 1.0,
        group_name:  r.group_name || 'Protocols',
        subgroup:    r.subgroup || '',
        startedAt:   r.started_at,
        // Filled-in metadata values (side-panel form). Empty object when
        // the run is new or the schema was blank.
        metadata:    meta
      };
    });
    try { localStorage.setItem(_RUNS_KEY, JSON.stringify(dbRuns)); } catch(e) {}
    return dbRuns;
  } catch(e) {
    return _getAllRunsLocal();
  }
}

(function injectScratchProtoStyles() {
  if (document.getElementById('scratch-proto-styles')) return;
  var s = document.createElement('style');
  s.id = 'scratch-proto-styles';
  s.textContent = [
    '.sp-picker{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:14px;margin-top:14px}',
    '.sp-picker-row{display:flex;gap:8px;align-items:center}',
    '.sp-picker-row input{flex:1}',
    '.sp-picker select{width:100%;margin-top:8px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:inherit;font-size:13px;padding:4px;color:#4a4139}',
    '.sp-run-header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid #e8e2d8;margin-bottom:14px}',
    '.sp-run-title{font-weight:700;font-size:15px;color:#4a4139}',
    '.sp-run-meta{font-size:12px;color:#8a7f72;margin-top:2px}',
    '.sp-run-group-badge{display:inline-block;font-size:11px;background:#e8f0e8;color:#5b7a5e;border:1px solid #c8d8c8;border-radius:3px;padding:1px 7px;margin-top:4px;font-weight:600}',
    '.sp-progress{height:4px;background:#e8e2d8;border-radius:2px;margin-bottom:18px}',
    '.sp-progress-fill{height:100%;background:#5b7a5e;border-radius:2px;transition:width .25s ease}',
    '.sp-recipe-section{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:14px;margin-bottom:18px}',
    '.sp-recipe-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}',
    '.sp-recipe-label{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72}',
    '.sp-scale-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#4a4139}',
    '.sp-scale-row input[type=checkbox]{accent-color:#5b7a5e;width:14px;height:14px}',
    '.sp-scale-row input[type=number]{width:70px;padding:3px 6px;border:1px solid #d5cec0;border-radius:4px;font-size:13px;font-family:inherit}',
    '.sp-recipe-wrap{overflow-x:auto}',
    '.sp-recipe-table{border-collapse:collapse;font-size:13px;color:#4a4139;min-width:100%;background:#faf8f4}',
    '.sp-recipe-table th{background:#e8e2d8;border:1px solid #d5cec0;padding:6px 10px;text-align:left;font-weight:600;font-size:12px;white-space:nowrap}',
    '.sp-recipe-table td{border:1px solid #e8e2d8;padding:0}',
    '.sp-recipe-table td input{width:100%;border:none;background:transparent;padding:6px 10px;font-size:13px;font-family:inherit;color:#4a4139;outline:none;min-width:70px}',
    '.sp-recipe-table td input:focus{background:#fff8f0}',
    '.sp-recipe-table td.vol-cell input{font-weight:600;color:#5b7a5e}',
    '.sp-recipe-table td.vol-cell input[readonly]{color:#8a7f72;background:#f0f4f0}',
    '.sp-recipe-add{margin-top:7px;display:flex;gap:6px}',

    /* Per-row "added" checkbox column — sits at the far left of every recipe
       table. State stored in rs.recipe._addedTables[tableIndex][rowIndex],
       persisted via the existing recipe_json blob (no schema change). */
    '.sp-recipe-table th.sp-recipe-check-cell{width:32px;text-align:center;padding:6px 4px}',
    '.sp-recipe-table td.sp-recipe-check-cell{width:32px;text-align:center;padding:6px 4px;background:#f0ebe3}',
    '.sp-recipe-table td.sp-recipe-check-cell input[type=checkbox]{margin:0;cursor:pointer;accent-color:#5b7a5e;width:15px;height:15px;vertical-align:middle}',
    /* Added row: green tint on every cell, muted text so it reads as "done" */
    '.sp-recipe-table tr.added td{background:#e8f0e8}',
    '.sp-recipe-table tr.added td input{color:#5b7a5e}',
    '.sp-recipe-table tr.added td.vol-cell input{color:#5b7a5e}',
    '.sp-recipe-table tr.added td.sp-recipe-check-cell{background:#d8e8d8}',

    /* Totals row (tfoot). Slightly darker than headers so it reads as an
       endcap. The Σ label sits in the checkbox column so it doesn't crowd
       the first data column. Warning ⚠ has red dotted underline (see
       inline style in _computeColTotal output). */
    '.sp-recipe-table tfoot td.sp-recipe-total-cell{background:#e0d8c8;border:1px solid #d5cec0;padding:6px 10px;font-size:12px;font-weight:600;color:#4a4139;white-space:nowrap}',
    '.sp-recipe-table tfoot td.sp-recipe-total-label{text-align:center;color:#8a7f72;font-size:14px}',
    '.sp-step{border:1px solid #e8e2d8;border-radius:6px;padding:10px 12px;margin-bottom:7px;background:#fff;transition:background .15s,border-color .15s}',
    '.sp-step.done{background:#f0f4f0;border-color:#c8d8c8}',
    '.sp-step.has-dev{border-left:3px solid #c97b3c}',
    '.sp-step-check{display:flex;gap:10px;align-items:flex-start;cursor:pointer}',
    '.sp-step-check input[type=checkbox]{margin-top:3px;flex-shrink:0;accent-color:#5b7a5e;width:15px;height:15px}',
    '.sp-step-text{font-size:13px;color:#4a4139;line-height:1.55;flex:1}',
    '.sp-step.done .sp-step-text{color:#8a7f72}',
    '.sp-dev-btn{background:none;border:none;font-size:11px;color:#8a7f72;cursor:pointer;padding:4px 0 0 25px;text-decoration:underline dotted;display:block}',
    '.sp-dev-btn:hover{color:#4a4139}',
    '.sp-dev-note{display:none;margin-top:7px;padding-left:25px}',
    '.sp-dev-note.open{display:block}',
    '.sp-dev-note textarea{width:100%;font-size:12px;font-family:inherit;border:1px solid #d5cec0;border-radius:4px;padding:6px 8px;background:#fdf6ee;color:#4a4139;resize:vertical;min-height:44px}',
    '.sp-dev-note textarea::placeholder{color:#b0a898}',
    '.sp-summary{background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:16px;margin-top:18px}',
    '.sp-summary-head{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px}',
    '.sp-summary-list{margin:0 0 10px 16px;padding:0;font-size:13px;color:#4a4139;line-height:1.6}',
    '.sp-summary-list li{margin-bottom:6px}',
    '.sp-dev-orig{color:#8a7f72;font-size:12px}',
    '.sp-dev-orig s{text-decoration:line-through}',
    '.sp-dev-new{color:#b85c1a;font-size:12px;margin-top:1px}',
    '.sp-summary-clean{font-size:13px;color:#5b7a5e;font-style:italic}',
    '.sp-run-footer{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',

    '.sp-runtabs{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e8e2d8}',
    '.sp-runtab{display:inline-flex;align-items:center;gap:8px;background:#f0ebe3;border:1px solid #d5cec0;border-radius:6px 6px 0 0;padding:6px 10px 6px 12px;font-size:12px;color:#8a7f72;cursor:pointer;transition:background 120ms}',
    '.sp-runtab:hover{background:#e6dfd0}',
    '.sp-runtab.active{background:#faf8f4;color:#4a4139;font-weight:600;border-bottom-color:#faf8f4;position:relative;top:1px}',
    '.sp-runtab-title{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.sp-runtab-count{font-size:10px;background:#e8f0e8;color:#5b7a5e;padding:1px 6px;border-radius:8px;font-weight:600}',
    '.sp-runtab-x{background:none;border:none;color:#8a7f72;cursor:pointer;padding:0 2px;font-size:14px;line-height:1;font-weight:600}',
    '.sp-runtab-x:hover{color:#c0392b}',
    '.sp-runtab-add{background:#fff;border-style:dashed;color:#5b7a5e;border-radius:6px;font-weight:600}',
    '.sp-runtab-add:hover{background:#e8f0e8}',
    '.sp-inline-picker{width:100%;background:#faf8f4;border:1px solid #d5cec0;border-radius:6px;padding:10px;margin-top:8px;display:flex;flex-direction:column;gap:6px}',
    '.sp-inline-picker input,.sp-inline-picker select{width:100%;box-sizing:border-box;padding:6px 10px;border:1px solid #d5cec0;border-radius:4px;font-size:13px;color:#4a4139;background:#fff;font-family:inherit}',

    /* Step timer button — all timer state (running/paused/expired/countdown)
       lives in the floating widget (static/proto-timer.js). This is a plain
       "start" affordance. Clicking hands off to protoTimerAdd. */
    '.sp-timer-btn{background:none;border:1px solid #d5cec0;border-radius:4px;font-size:11px;color:#8a7f72;cursor:pointer;padding:2px 8px;margin-left:25px;margin-top:4px;display:inline-flex;align-items:center;gap:4px}',
    '.sp-timer-btn:hover{background:#f0ebe3;color:#4a4139}',
    /* Brief highlight when navigated here via "Finish" from dashboard */
    '@keyframes sp-finish-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(91,122,94,.4); } 50% { box-shadow: 0 0 0 8px rgba(91,122,94,0); } }',
    '.sp-finish-highlight { animation: sp-finish-pulse 1.1s ease-in-out 2; }'
  ].join('');
  document.head.appendChild(s);
})();


// ── recipe helpers ────────────────────────────────────────────────────────────
var _DEFAULT_RECIPE = { columns: ['Component', 'Stock conc.', 'Volume (uL)', 'Final conc.'], rows: [] };

// ── timer helpers (delegates to floating proto-timer widget) ─────────────────
// All timer state, persistence, and countdown ticking live in
// /static/proto-timer.js. From this file we only:
//   - detect a duration from step.text (or prompt),
//   - build a label with the step number,
//   - hand off to window.protoTimerAdd(label, seconds, protocol, runId).
// Timers are TAGGED with the active run's runId so we can selectively remove
// only that run's timers on Abandon / DiscardRunTab, without touching timers
// from other concurrent runs.

function _parseDurationFromText(text) {
  // Prefer the widget's parser — one source of truth. Fall back to a local
  // regex if the widget hasn't loaded yet (boot-order safety).
  if (typeof window.protoTimerParseDuration === 'function') {
    return window.protoTimerParseDuration(text);
  }
  var t = (text || '').toLowerCase(); var m;
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s|$)/))) return Math.round(parseFloat(m[1]) * 3600);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*min(?:utes?)?(?:\s|$)/))) return Math.round(parseFloat(m[1]) * 60);
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?(?:\s|$)/))) return Math.round(parseFloat(m[1]));
  return 0;
}

function _fmtDurShortSp(sec) {
  if (sec >= 3600) { var h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60); return h + 'h' + (m ? m + 'm' : ''); }
  if (sec >= 60) { var m = Math.floor(sec/60), s = sec % 60; return m + 'm' + (s ? s + 's' : ''); }
  return sec + 's';
}

// Prompt-input parser — used only for the fallback prompt() when the step
// text has no parseable duration. Kept local because prompt() is synchronous
// and the widget doesn't expose an equivalent public parser for this format.
function _parseInputDurationSp(input) {
  input = (input || '').trim().toLowerCase();
  var m;
  if ((m = input.match(/^(\d+(?:\.\d+)?)\s*h/))) return Math.round(parseFloat(m[1]) * 3600);
  if ((m = input.match(/^(\d+(?:\.\d+)?)\s*m/))) return Math.round(parseFloat(m[1]) * 60);
  if ((m = input.match(/^(\d+(?:\.\d+)?)\s*s/))) return Math.round(parseFloat(m[1]));
  if ((m = input.match(/^(\d+)$/))) return parseInt(m[1]);
  return 0;
}

// Wired to the ⏱ button on each step. Only the ACTIVE run's steps are
// visible in the DOM at any time (multi-run tabs swap _scratchProtoRun on
// switch and re-render), so tagging with the active run's runId gives an
// unambiguous "which run owns this timer" association.
function spStartTimer(stepId) {
  var rs = _scratchProtoRun; if (!rs) return;
  var idx = rs.steps.findIndex(function(s){ return s.id === stepId; });
  if (idx < 0) return;
  var step = rs.steps[idx];

  if (typeof window.protoTimerAdd !== 'function') {
    toast('Timer widget not loaded — try refreshing the page', true);
    return;
  }

  var duration = step.duration || _parseDurationFromText(step.text);
  if (!duration) {
    var input = prompt('Timer duration for this step (e.g. 30min, 1h, 45sec):');
    if (!input) return;
    duration = _parseInputDurationSp(input);
    if (!duration) { toast('Could not parse duration', true); return; }
    step.duration = duration;
    if (typeof _saveRun === 'function') _saveRun(rs);
  }

  var shortText = (step.text || '').replace(/\s+/g, ' ').trim();
  if (shortText.length > 60) shortText = shortText.substring(0, 57) + '...';
  var label = 'Step ' + (idx + 1) + (shortText ? ': ' + shortText : '');
  var protoTitle = (rs.protocol && rs.protocol.title) || '';

  window.protoTimerAdd(label, duration, protoTitle, rs.runId);
  toast('Timer started: ' + _fmtDurShortSp(duration));
}

// Rendered inside each step row. Each click starts a NEW timer in the
// widget — pause / reset / countdown display are the widget's job now.
function _getTimerHTML(step) {
  var dur = step.duration || _parseDurationFromText(step.text);
  var label = dur ? _fmtDurShortSp(dur) : 'Timer';
  return '<button class="sp-timer-btn" onclick="spStartTimer(' + step.id + ')" title="Start timer in the floating widget">' +
    '&#9202; ' + label +
    '</button>';
}

function _parseRecipeRun(raw) {
  if (!raw) return JSON.parse(JSON.stringify(_DEFAULT_RECIPE));
  try {
    var r = JSON.parse(raw);
    if (Array.isArray(r) && r.length && r[0].columns) return r[0];
    if (r && Array.isArray(r.columns) && Array.isArray(r.rows)) return r;
  } catch(e) {}
  return JSON.parse(JSON.stringify(_DEFAULT_RECIPE));
}

function _parseAllRecipesRun(raw) {
  if (!raw) return null;
  try {
    var r = JSON.parse(raw);
    if (Array.isArray(r) && r.length && r[0].columns) return r;
  } catch(e) {}
  return null;
}

function _volColIndex(columns) {
  for (var i = 0; i < columns.length; i++) { if (/vol|µl|ul/i.test(columns[i])) return i; }
  return -1;
}

// Detect "up to N units" / "q.s. to N" style fill-to-volume cells so scaling
// multiplies through them (e.g. "up to 25 uL" at 2× → "up to 50 uL") and so
// the display can show them distinctly from summable values.
function _matchFillToVolume(val) {
  var s = (val || '').trim();
  if (!s) return null;
  var m = s.match(/^((?:up\s+to|q\.?s\.?(?:\s+to)?|(?:fill|bring|adjust)\s+to|to))\s+([\d.,]+)\s*(.*)$/i);
  if (!m) return null;
  var n = parseFloat(m[2].replace(/,/g, ''));
  if (isNaN(n)) return null;
  return { prefix: m[1], num: n, tail: m[3] };
}

// ── unit-aware column totals ─────────────────────────────────────────────────
// Every recipe column gets a total row when possible. Values are parsed for
// number + unit, categorized into a family, and summed within-family only.
// Mixed families in the same column produce a warning ("g + mL don't sum").
// Non-additive families (concentration, ratio, %) get no total — summing
// concentrations across components is meaningless.
//
// `factor` in _UNIT_TABLE is the multiplier to the family's base unit:
//   volume base = L, mass base = g, mole base = mol, molar base = M.
// This means "largest unit" = the entry with the biggest factor, which is
// where the total gets displayed.
var _UNIT_TABLE = {
  // volume (base L)
  'l':{family:'volume',factor:1}, 'liter':{family:'volume',factor:1}, 'liters':{family:'volume',factor:1}, 'litre':{family:'volume',factor:1}, 'litres':{family:'volume',factor:1},
  'ml':{family:'volume',factor:1e-3}, 'milliliter':{family:'volume',factor:1e-3}, 'milliliters':{family:'volume',factor:1e-3}, 'millilitre':{family:'volume',factor:1e-3}, 'millilitres':{family:'volume',factor:1e-3},
  'ul':{family:'volume',factor:1e-6}, 'μl':{family:'volume',factor:1e-6}, 'µl':{family:'volume',factor:1e-6}, 'microliter':{family:'volume',factor:1e-6}, 'microliters':{family:'volume',factor:1e-6},
  'nl':{family:'volume',factor:1e-9}, 'nanoliter':{family:'volume',factor:1e-9}, 'nanoliters':{family:'volume',factor:1e-9},
  'pl':{family:'volume',factor:1e-12},

  // mass (base g)
  'kg':{family:'mass',factor:1e3},
  'g':{family:'mass',factor:1}, 'gram':{family:'mass',factor:1}, 'grams':{family:'mass',factor:1},
  'mg':{family:'mass',factor:1e-3}, 'milligram':{family:'mass',factor:1e-3}, 'milligrams':{family:'mass',factor:1e-3},
  'ug':{family:'mass',factor:1e-6}, 'μg':{family:'mass',factor:1e-6}, 'µg':{family:'mass',factor:1e-6}, 'microgram':{family:'mass',factor:1e-6}, 'micrograms':{family:'mass',factor:1e-6},
  'ng':{family:'mass',factor:1e-9}, 'nanogram':{family:'mass',factor:1e-9},
  'pg':{family:'mass',factor:1e-12},

  // amount (base mol)
  'mol':{family:'mole',factor:1}, 'moles':{family:'mole',factor:1},
  'mmol':{family:'mole',factor:1e-3},
  'umol':{family:'mole',factor:1e-6}, 'μmol':{family:'mole',factor:1e-6}, 'µmol':{family:'mole',factor:1e-6},
  'nmol':{family:'mole',factor:1e-9},
  'pmol':{family:'mole',factor:1e-12},
  'fmol':{family:'mole',factor:1e-15},

  // molar concentration — NOT additive (kept in family for detection only)
  'm':{family:'conc_molar',factor:1}, 'mm':{family:'conc_molar',factor:1e-3},
  'um':{family:'conc_molar',factor:1e-6}, 'μm':{family:'conc_molar',factor:1e-6}, 'µm':{family:'conc_molar',factor:1e-6},
  'nm':{family:'conc_molar',factor:1e-9}, 'pm':{family:'conc_molar',factor:1e-12},

  // ratios / percent — NOT additive
  'x':{family:'ratio',factor:1}, '×':{family:'ratio',factor:1},
  '%':{family:'percent',factor:1}
};

// Families where a sum is scientifically meaningful.
var _ADDITIVE_FAMILIES = { volume:1, mass:1, mole:1, unitless:1 };

function _lookupUnit(str) {
  if (!str) return null;
  return _UNIT_TABLE[_normalizeUnit(str)] || null;
}

// Normalize a unit string so "UL", "uL", "Ul", "μL", "µL" all map together.
// Merges lowercase-ing, Unicode micro sign U+00B5, Greek mu U+03BC, and
// ASCII 'u' when used as a micro prefix. Only used for canonical grouping —
// display strings keep the user's original casing.
function _normalizeUnit(str) {
  return String(str || '').toLowerCase().replace(/\u00b5|\u03bc/g, 'u');
}

// Parse a cell value into { number, unit, family, factor, isFillTo }.
// Returns null for empty. `number: null` marks a non-numeric cell (e.g. a
// component name) — those get filtered out of totals.
function _parseValueUnit(raw) {
  if (raw == null) return null;
  var s = String(raw).trim();
  if (!s) return null;

  var fill = _matchFillToVolume(s);
  if (fill) {
    var fUnit = _lookupUnit(fill.tail || '');
    return {
      number: fill.num, unit: fill.tail || '',
      family: fUnit ? fUnit.family : 'unitless',
      factor: fUnit ? fUnit.factor : 1,
      isFillTo: true
    };
  }

  var m = s.match(/^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(.*)$/);
  if (!m) return { number: null, unit: '', family: 'unknown' };
  var num = parseFloat(m[1]);
  var unitStr = (m[2] || '').trim();
  if (!unitStr) return { number: num, unit: '', family: 'unitless', factor: 1 };
  // Compound units like "mg/mL" — mass-per-volume concentration, non-additive
  if (/^[a-zμµ]+\/[a-zμµ]+$/i.test(unitStr)) {
    return { number: num, unit: unitStr, family: 'conc_massvol', factor: 1 };
  }
  var info = _lookupUnit(unitStr);
  if (info) return { number: num, unit: unitStr, family: info.family, factor: info.factor };
  return { number: num, unit: unitStr, family: 'unknown', factor: 1 };
}

// Compute a single column's total. Returns null if no total should be shown
// (all cells empty/non-numeric, or column is a non-additive concentration/
// ratio/percent). Returns { text, warn, tip } otherwise; warn=true triggers
// the ⚠ icon.
function _computeColTotal(parsedCells, scaleFactor) {
  var sf = scaleFactor || 1;
  var cells = parsedCells.filter(function(p) { return p && p.number !== null; });
  if (!cells.length) return null;

  // Fill-to shortcut: any fill-to row IS the total for this column.
  var fill = cells.filter(function(p) { return p.isFillTo; })[0];
  if (fill) {
    var val = _fmtTotalNum(fill.number * sf);
    return { text: val + (fill.unit ? ' ' + fill.unit : ''), warn: false, isFillTo: true };
  }

  var families = {};
  cells.forEach(function(p) { families[p.family] = (families[p.family] || 0) + 1; });
  var famList = Object.keys(families);

  // All same family and non-additive → no total (concentrations don't sum).
  if (famList.length === 1 && !_ADDITIVE_FAMILIES[famList[0]]) return null;

  // Mixed families → warn, no numeric total. Includes cases like "one row
  // has a unit, another is bare number" (unitless + volume) — user's fix
  // is to add a unit or convert.
  if (famList.length > 1) {
    return {
      text: '—', warn: true,
      tip: 'Column has mixed unit types (' + famList.join(', ') + ') — cannot sum'
    };
  }

  // Single additive family. Sum in the largest unit encountered.
  var totalInBase = 0, largestFactor = 0, largestUnit = '';
  cells.forEach(function(p) {
    var f = p.factor || 1;
    totalInBase += p.number * f;
    if (f > largestFactor) { largestFactor = f; largestUnit = p.unit; }
  });
  var displayTotal = (totalInBase / (largestFactor || 1)) * sf;
  var text = _fmtTotalNum(displayTotal) + (largestUnit ? ' ' + largestUnit : '');

  // Warn if units were mixed within the family (uL + mL) — sum is correct
  // but user should sanity-check. Compare by canonical form so "UL" vs
  // "uL" doesn't count as mixed.
  var canonUnits = {};
  cells.forEach(function(p) { canonUnits[_normalizeUnit(p.unit) || '(none)'] = 1; });
  var mixed = Object.keys(canonUnits).length > 1;
  return {
    text: text, warn: mixed,
    tip: mixed ? 'Converted mixed units (' + Object.keys(canonUnits).join(', ') + ') to ' + (largestUnit || 'dimensionless') : ''
  };
}

function _fmtTotalNum(n) {
  if (!isFinite(n)) return '?';
  // Trim trailing zeros; keep up to 4 significant fractional digits.
  return parseFloat(n.toFixed(4)).toString();
}

function _renderSingleTable(recipe, scaling, factor, tableIndex) {
  var volCol = _volColIndex(recipe.columns);
  if (!recipe.rows.length) return '<div style="color:#8a7f72;font-size:13px;font-style:italic">No components defined.</div>';
  // Lazy-read added flags off the run's recipe (piggybacked storage). Missing
  // entries default to false so pre-existing runs render unchecked without a
  // migration step.
  var rs = _scratchProtoRun;
  var addedTables = (rs && rs.recipe && rs.recipe._addedTables) || {};
  var addedRow = addedTables[String(tableIndex || 0)] || [];
  var html = '<div class="sp-recipe-wrap"><table class="sp-recipe-table"><thead><tr>';
  // Checkbox column header — no label; the column speaks for itself with an
  // icon at column-header height would be visually noisy against real headers.
  html += '<th class="sp-recipe-check-cell" title="Mark row as added">&#10003;</th>';
  recipe.columns.forEach(function(c) { html += '<th>' + esc(c) + '</th>'; });
  html += '</tr></thead><tbody>';
  recipe.rows.forEach(function(row, ri) {
    var isAdded = !!addedRow[ri];
    html += '<tr' + (isAdded ? ' class="added"' : '') + '>';
    // Checkbox cell — always present, always clickable, even for read-only
    // (multi-table protocol) rows since the whole point is to track additions
    // to buffer recipes that come from the protocol definition.
    html += '<td class="sp-recipe-check-cell">' +
      '<input type="checkbox"' + (isAdded ? ' checked' : '') +
      ' onchange="spToggleRecipeRow(' + (tableIndex || 0) + ',' + ri + ',this.checked)"' +
      ' title="Mark this component as added"/></td>';
    recipe.columns.forEach(function(_, ci) {
      var rawVal = row[ci] || '', isVol = (ci === volCol), displayVal = rawVal;
      if (isVol && scaling && factor && rawVal) {
        // Fill-to-volume ("up to 25 uL"): scale the embedded number, keep the
        // "up to" prefix and unit tail so the semantics survive scaling.
        var fill = _matchFillToVolume(rawVal);
        if (fill) {
          var scaledN = (fill.num * factor).toFixed(2).replace(/\.00$/, '');
          displayVal = fill.prefix + ' ' + scaledN + (fill.tail ? ' ' + fill.tail : '');
        } else {
          var num = parseFloat(rawVal);
          if (!isNaN(num)) displayVal = (num * factor).toFixed(2).replace(/\.00$/, '');
        }
      }
      var cc = isVol ? ' class="vol-cell"' : '';
      if (isVol && scaling) {
        html += '<td' + cc + '><input type="text" value="' + esc(displayVal) + '" readonly/></td>';
      } else {
        html += '<td' + cc + '><input type="text" value="' + esc(displayVal) + '" oninput="spRecipeCell(' + ri + ',' + ci + ',this.value)"/></td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody>';

  // Totals row. Each column gets computed independently. Scaling only affects
  // the volume column (matching existing per-cell scaling logic above).
  html += '<tfoot><tr>';
  html += '<td class="sp-recipe-total-cell sp-recipe-total-label" title="Column totals — unit-aware">&Sigma;</td>';
  recipe.columns.forEach(function(_, ci) {
    var parsedCol = recipe.rows.map(function(row) { return _parseValueUnit(row[ci] || ''); });
    var sf = (ci === volCol && scaling && factor) ? factor : 1;
    var t = _computeColTotal(parsedCol, sf);
    var cellHtml = '';
    var extraStyle = '';
    if (t) {
      var text = esc(t.text);
      if (t.isFillTo) {
        cellHtml = '<span title="Fill-to-volume: the &quot;up to X&quot; value is the total" style="color:#5b7a5e;font-weight:600">' + text + '</span>';
      } else if (t.warn) {
        cellHtml = '<span title="' + esc(t.tip) + '" style="border-bottom:1.5px dotted #c0392b;cursor:help">' + text + ' &#9888;</span>';
      } else {
        cellHtml = text;
      }
    }
    html += '<td class="sp-recipe-total-cell"' + extraStyle + '>' + cellHtml + '</td>';
  });
  html += '</tr></tfoot>';

  return html + '</table></div>';
}

function _renderRunRecipe() {
  var rs = _scratchProtoRun; if (!rs) return '';
  var scaling = rs.scaling, factor = rs.scaleFactor || 1;
  var tables = _parseAllRecipesRun(rs.protocol.recipe);
  var html = '<div class="sp-recipe-section"><div class="sp-recipe-head"><span class="sp-recipe-label">Reaction Recipe</span>';
  html += '<div class="sp-scale-row"><input type="checkbox" id="sp-scale-toggle"' + (scaling ? ' checked' : '') +
    ' onchange="spToggleScale(this.checked)"/> <label for="sp-scale-toggle" style="cursor:pointer">Scale</label>';
  if (scaling) html += '&nbsp;&times;&nbsp;<input type="number" id="sp-scale-factor" value="' + factor + '" min="0.01" step="0.1" style="width:65px" oninput="spUpdateScale(this.value)"/>';
  html += '</div></div>';
  if (tables && tables.length > 1) {
    tables.forEach(function(t, ti) {
      html += '<div style="margin-bottom:12px">';
      if (t.name) html += '<div style="font-size:11px;font-weight:600;color:#8a7f72;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">' + esc(t.name) + '</div>';
      html += _renderSingleTable(ti === 0 ? rs.recipe : t, scaling, factor, ti);
      html += '</div>';
    });
    html += '<div class="sp-recipe-add"><button class="btn" onclick="spAddRecipeRow()">+ Row (table 1)</button><button class="btn" onclick="spAddRecipeCol()">+ Column</button></div>';
  } else {
    html += _renderSingleTable(rs.recipe, scaling, factor, 0);
    html += '<div class="sp-recipe-add"><button class="btn" onclick="spAddRecipeRow()">+ Row</button><button class="btn" onclick="spAddRecipeCol()">+ Column</button></div>';
  }
  return html + '</div>';
}

function spToggleScale(c) { if (!_scratchProtoRun) return; _scratchProtoRun.scaling = c; if (c && !_scratchProtoRun.scaleFactor) _scratchProtoRun.scaleFactor = 1; _saveRun(_scratchProtoRun); document.getElementById('sp-recipe-wrap').innerHTML = _renderRunRecipe(); }
function spUpdateScale(v) { if (!_scratchProtoRun) return; var n = parseFloat(v); _scratchProtoRun.scaleFactor = isNaN(n) ? 1 : n; _saveRun(_scratchProtoRun); document.getElementById('sp-recipe-wrap').innerHTML = _renderRunRecipe(); }
function spRecipeCell(ri, ci, value) { if (_scratchProtoRun && _scratchProtoRun.recipe.rows[ri]) { _scratchProtoRun.recipe.rows[ri][ci] = value; _saveRun(_scratchProtoRun); } }
function spAddRecipeRow() {
  if (!_scratchProtoRun) return;
  var r = _scratchProtoRun.recipe;
  r.rows.push(r.columns.map(function() { return ''; }));
  // Keep the parallel added-flags array in sync for table 0 so the new row
  // starts unchecked (rather than reading past the end of the array).
  if (r._addedTables && r._addedTables['0']) r._addedTables['0'].push(false);
  _saveRun(_scratchProtoRun);
  document.getElementById('sp-recipe-wrap').innerHTML = _renderRunRecipe();
}
function spAddRecipeCol() { var name = prompt('Column name:'); if (!name || !_scratchProtoRun) return; var r = _scratchProtoRun.recipe; r.columns.push(name); r.rows.forEach(function(row) { row.push(''); }); _saveRun(_scratchProtoRun); document.getElementById('sp-recipe-wrap').innerHTML = _renderRunRecipe(); }

// Toggle a single row's "added" state. Called from the checkbox onchange in
// _renderSingleTable. State lives on rs.recipe._addedTables so it piggybacks
// on the existing recipe_json serialisation — no schema migration.
//
// We deliberately mutate only the tr's class rather than re-rendering the
// whole recipe section. Re-rendering would reset every open text-input's
// caret position and IME state — bad UX when the user is mid-edit.
function spToggleRecipeRow(tableIndex, rowIndex, checked) {
  var rs = _scratchProtoRun; if (!rs || !rs.recipe) return;
  if (!rs.recipe._addedTables) rs.recipe._addedTables = {};
  var key = String(tableIndex);
  if (!rs.recipe._addedTables[key]) rs.recipe._addedTables[key] = [];
  rs.recipe._addedTables[key][rowIndex] = !!checked;
  _saveRun(rs);
  // Find the specific tr the click came from and toggle its class in-place.
  // Query scoped to #sp-recipe-wrap so we don't accidentally hit an unrelated
  // table elsewhere on the page.
  var wrap = document.getElementById('sp-recipe-wrap');
  if (!wrap) return;
  var tables = wrap.querySelectorAll('table.sp-recipe-table');
  var tbl = tables[tableIndex]; if (!tbl) return;
  var tr = tbl.querySelectorAll('tbody tr')[rowIndex]; if (!tr) return;
  tr.classList.toggle('added', !!checked);
}

// ── main render ───────────────────────────────────────────────────────────────
async function renderScratch(el) {
  if (_scratchProtoRun) { _renderProtoRunInScratch(el); return; }
  var data = await api('GET', '/api/scratch');
  var entries = data.entries || [];
  var html = '<div class="scratch-area">' +
    '<div class="section-label">Quick note</div>' +
    '<div class="scratch-quick"><input type="text" id="sq-input" placeholder="Type and hit Enter - gets filed overnight" spellcheck="false"/><button onclick="addScratchQuick()">Dump it</button></div>' +
    '<div class="section-label" style="margin-top:14px">Brain dump</div>' +
    '<textarea class="scratch-big" id="sb-input" placeholder="Dump everything here — rough notes, observations, half-formed ideas."></textarea>' +
    '<div style="display:flex;justify-content:flex-end"><button class="btn primary" onclick="addScratchBig()">Save dump</button></div>' +
    '<div class="section-label" style="margin-top:14px">Run a protocol</div>' +
    '<div id="sp-proto-picker-wrap"><button class="btn" style="color:#5b7a5e" onclick="spShowPicker()">&#9654; Pick &amp; run a protocol</button></div>' +
    '<div class="section-label" style="margin-top:14px">Drop a figure</div>' +
    '<div class="drop-zone" id="drop-zone" onclick="triggerFileInput()" ondrop="handleDrop(event)">' +
      '<input type="file" id="file-input" accept="image/*,.pdf" onchange="handleFileSelect(event)"/>' +
      '&#128247; Drop a gel, western blot, SEC trace, or any figure here' +
    '</div>';
  if (entries.length) {
    html += '<div class="section-label" style="margin-top:14px">Pending (' + entries.length + ')</div><div class="scratch-list">' +
      entries.map(function(e) {
        return '<div class="scratch-item ' + (e.has_image ? 'has-image' : '') + '">' +
          (e.has_image ? '<img class="scratch-thumb" src="/api/scratch/' + e.id + '/image-raw" onerror="this.style.display=\'none\'" onclick="viewScratchImage(' + e.id + ')"/>' : '') +
          '<div class="scratch-item-content">' + esc((e.content || e.filename || 'image').slice(0, 200)) + '</div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><div class="scratch-item-time">' + relTime(e.created) + '</div>' +
          '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteScratch(' + e.id + ')">&#215;</button></div></div>';
      }).join('') + '</div>';
  } else {
    html += '<div style="margin-top:8px;color:var(--muted);font-size:13px;font-style:italic">&#10003; All clear.</div>';
  }
  html += '</div>';
  el.innerHTML = html;
  setTimeout(function() {
    initDropZone();
    var sq = document.getElementById('sq-input');
    if (sq) sq.addEventListener('keydown', function(e) { if (e.key === 'Enter') addScratchQuick(); });
  }, 50);
}

// ── picker ────────────────────────────────────────────────────────────────────
async function spShowPicker() {
  var wrap = document.getElementById('sp-proto-picker-wrap'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading...</div>';
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];
  if (!S.protocols.length) { wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;font-style:italic">No protocols saved yet.</div>'; return; }
  var opts = S.protocols.map(function(p) { return '<option value="' + p.id + '">' + esc(p.title) + '</option>'; }).join('');
  wrap.innerHTML = '<div class="sp-picker">' +
    '<div class="sp-picker-row"><input type="text" id="sp-pk-q" placeholder="Search protocols..." spellcheck="false" oninput="spPickerFilter()"/><button class="btn" onclick="spHidePicker()">Cancel</button></div>' +
    '<select id="sp-pk-sel" size="5">' + opts + '</select>' +
    '<div style="margin-top:8px;text-align:right"><button class="btn primary" onclick="spLaunchRun()">&#9654; Start run</button></div>' +
    '</div>';
  document.getElementById('sp-pk-q')?.focus();
}

function spHidePicker() {
  var wrap = document.getElementById('sp-proto-picker-wrap');
  if (wrap) wrap.innerHTML = '<button class="btn" style="color:#5b7a5e" onclick="spShowPicker()">&#9654; Pick &amp; run a protocol</button>';
}

function spPickerFilter() {
  var q = (document.getElementById('sp-pk-q')?.value || '').toLowerCase();
  document.querySelectorAll('#sp-pk-sel option').forEach(function(o) { o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
}

function spLaunchRun() {
  var sel = document.getElementById('sp-pk-sel');
  if (!sel || !sel.value) { toast('Select a protocol first', true); return; }
  var p = (S.protocols || []).find(function(x) { return x.id === parseInt(sel.value); });
  if (p) spLaunchRunDirect(p, null, null);
}

// ── shared launch ─────────────────────────────────────────────────────────────
function spLaunchRunDirect(p, group, subgroup) {
  var steps = [];
  try { var parsed = JSON.parse(p.steps || '[]'); if (Array.isArray(parsed) && parsed.length && typeof parsed[0].text !== 'undefined') steps = parsed; } catch(e) {}
  if (!steps.length) { toast('No structured steps yet', true); return; }

  _scratchProtoRun = {
    runId:       p.id + '_' + Date.now(),
    protocol:    p,
    steps:       steps.map(function(s, i) { return { id: i, text: s.text, done: false, deviation: '' }; }),
    recipe:      JSON.parse(JSON.stringify(_parseRecipeRun(p.recipe))),
    scaling:     false,
    scaleFactor: 1,
    group_name:  group || 'Protocols',
    subgroup:    subgroup || '',
    startedAt:   new Date().toISOString(),
    // Seed metadata with defaults from the protocol's schema so scalar
    // fields with a default show pre-filled in the side panel. Table
    // fields start empty (the "Add row" button is how they grow).
    metadata:    _spSeedMetadataFromSchema(p.metadata_schema)
  };

  // create in DB immediately (non-blocking)
  api('POST', '/api/active-runs', {
    run_id:        _scratchProtoRun.runId,
    protocol_id:   p.id,
    protocol_json: JSON.stringify(p),
    steps_json:    JSON.stringify(_scratchProtoRun.steps),
    recipe_json:   JSON.stringify(_scratchProtoRun.recipe),
    group_name:    _scratchProtoRun.group_name,
    subgroup:      _scratchProtoRun.subgroup,
    scaling:       false,
    scale_factor:  1.0,
    started_at:    _scratchProtoRun.startedAt
  }).catch(function() {});

  _saveLocalOnly(_scratchProtoRun);
  // Notification permission is requested lazily by protoTimerAdd on first use.

  if (S.view === 'scratch') {
    var el = document.getElementById('content');
    if (el) { _renderProtoRunInScratch(el); return; }
  }
  if (typeof setView === 'function') setView('scratch');
}

// resume by runId — fetches from DB so works across machines
async function spResumeRunById(runId) {
  try {
    var data = await api('GET', '/api/active-runs');
    var dbRun = (data.runs || []).find(function(r) { return r.run_id === runId; });
    if (dbRun) {
      var meta = {};
      try { meta = JSON.parse(dbRun.metadata_values || '{}') || {}; } catch(e) { meta = {}; }
      _scratchProtoRun = {
        runId:       dbRun.run_id,
        protocol:    JSON.parse(dbRun.protocol_json),
        steps:       JSON.parse(dbRun.steps_json || '[]'),
        recipe:      JSON.parse(dbRun.recipe_json || 'null') || _parseRecipeRun(null),
        scaling:     !!dbRun.scaling,
        scaleFactor: dbRun.scale_factor || 1.0,
        group_name:  dbRun.group_name || 'Protocols',
        subgroup:    dbRun.subgroup || '',
        startedAt:   dbRun.started_at,
        metadata:    meta
      };
      _saveLocalOnly(_scratchProtoRun);
      if (typeof setView === 'function') setView('scratch');
      return;
    }
  } catch(e) {}
  // fallback to localStorage
  var local = _getRunByIdLocal(runId);
  if (local) { _scratchProtoRun = local; if (typeof setView === 'function') setView('scratch'); return; }
  toast('Run not found', true);
}

/* Resume a run and immediately scroll to the finish-button context.
   Used by the "Finish" button on the workflow sidebar — keeps the user inside
   the regular save flow (so they can review recipe/steps) rather than committing
   silently from another view. */
async function spResumeAndFinish(runId) {
  await spResumeRunById(runId);
  /* Give the scratch view a moment to render, then scroll the finish button
     into view so it's obvious what to do next. */
  setTimeout(function() {
    var btn = document.querySelector('[data-sp-finish]') || document.querySelector('.sp-finish-btn');
    if (btn) {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.classList.add('sp-finish-highlight');
      setTimeout(function() { btn.classList.remove('sp-finish-highlight'); }, 2200);
    }
  }, 300);
}
window.spResumeAndFinish = spResumeAndFinish;

async function spDiscardRunById(runId) {
  if (!confirm('Discard this run? Progress will be lost.')) return;
  await _removeRun(runId);
  if (_scratchProtoRun && _scratchProtoRun.runId === runId) _scratchProtoRun = null;
  loadView();
}

// ── run view ──────────────────────────────────────────────────────────────────
function _renderProtoRunInScratch(el) {
  var rs = _scratchProtoRun; if (!rs) return;
  var done = rs.steps.filter(function(s) { return s.done; }).length;
  var pct  = Math.round((done / rs.steps.length) * 100);
  var stepsHtml = rs.steps.map(function(step) {
    var hasDev = step.deviation.trim().length > 0;
    return '<div class="sp-step' + (step.done ? ' done' : '') + (hasDev ? ' has-dev' : '') + '" id="sps-' + step.id + '">' +
      '<label class="sp-step-check"><input type="checkbox"' + (step.done ? ' checked' : '') + ' onchange="spToggleStep(' + step.id + ',this.checked)"/>' +
      '<span class="sp-step-text">' + esc(step.text) + '</span></label>' +
      '<div style="display:flex;gap:0;align-items:center;flex-wrap:wrap">' +
        _getTimerHTML(step) +
        '<button class="sp-dev-btn" style="margin-left:8px" onclick="spToggleDev(' + step.id + ')">' + (hasDev ? '&#9998; deviation noted' : '+ deviation note') + '</button>' +
      '</div>' +
      '<div class="sp-dev-note' + (hasDev ? ' open' : '') + '" id="spd-' + step.id + '"><textarea placeholder="What did you change?" oninput="spUpdateDev(' + step.id + ',this.value)">' + esc(step.deviation) + '</textarea></div>' +
    '</div>';
  }).join('');
  var groupLabel = rs.group_name + (rs.subgroup ? ' / ' + rs.subgroup : '');
  el.innerHTML =
    _renderRunTabs() +
    '<div class="sp-run-layout" style="display:grid;grid-template-columns:1fr 340px;gap:20px;padding:0 0 24px;align-items:start">' +
      '<div class="sp-run-main">' +
        '<div class="sp-run-header">' +
          '<div>' +
            '<div class="sp-run-title">&#9654; ' + esc(rs.protocol.title) + '</div>' +
            '<div class="sp-run-meta" id="sp-run-meta">' + done + ' / ' + rs.steps.length + ' steps &nbsp;&#183;&nbsp; started ' + new Date(rs.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</div>' +
            '<span class="sp-run-group-badge">&#128193; ' + esc(groupLabel) + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn" onclick="spSaveAndExit()">&#9632; Save &amp; exit</button>' +
            '<button class="btn" style="color:#c0392b" onclick="spAbandonRun()">&#215; Abandon</button>' +
          '</div>' +
        '</div>' +
        '<div class="sp-progress"><div class="sp-progress-fill" id="sp-pfill" style="width:' + pct + '%"></div></div>' +
        '<div id="sp-recipe-wrap">' + _renderRunRecipe() + '</div>' +
        '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px">Steps</div>' +
        '<div id="sp-steps-list">' + stepsHtml + '</div>' +
        '<div id="sp-summary-wrap"></div>' +
        '<div class="sp-run-footer">' +
          '<button class="btn" onclick="spShowSummary()">View summary</button>' +
          '<button class="btn" onclick="spSaveAndExit()">&#9632; Save &amp; exit</button>' +
          '<button class="btn primary sp-finish-btn" data-sp-finish="1" onclick="spSaveToEntry()">&#10003; Save to Entry &amp; finish</button>' +
        '</div>' +
      '</div>' +
      '<aside class="sp-meta-panel" id="sp-meta-panel">' +
        _spRenderMetaPanel(rs) +
      '</aside>' +
    '</div>';
}

// ── Metadata side panel (protocol-run details) ───────────────────────────
// Renders the protocol's metadata_schema as form inputs, bound to
// _scratchProtoRun.metadata. On any change: _saveRun() writes the whole
// run object to /active-runs/{id}, which now accepts metadata_values.
// If the protocol has no schema, panel shows a "no fields defined" hint
// with a link to the protocol edit view.
function _spRenderMetaPanel(rs) {
  var schema = _spParseSchema(rs.protocol && rs.protocol.metadata_schema);
  var h = '<div class="sp-meta-h">Run details</div>';
  if (!schema || !schema.fields || !schema.fields.length) {
    h += '<div class="sp-meta-empty">' +
      'This protocol has no metadata fields defined.' +
      '<br><br>' +
      '<a href="#" onclick="event.preventDefault();spEditProtocol(' + (rs.protocol.id || 0) + ')" style="color:#5b7a5e;text-decoration:underline">Edit protocol</a> to add a schema, or pick a preset (Colony PCR, Gel, etc).' +
    '</div>';
    return h;
  }
  if (!rs.metadata) rs.metadata = {};
  schema.fields.forEach(function(f) {
    h += _spRenderMetaField(f, rs.metadata);
  });
  return h;
}

// Parse metadata_schema — protocols API returns it as a JSON string,
// but tolerate a pre-parsed object too (in case something upstream
// deserialised for us). Returns null on any failure.
function _spParseSchema(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Seed a run.metadata object from a schema's defaults. Scalars with a
// `default` get pre-filled; table fields start as empty arrays. Fields
// without a default and non-table fields are omitted (frontend renders
// them as empty inputs).
function _spSeedMetadataFromSchema(rawSchema) {
  var schema = _spParseSchema(rawSchema);
  var out = {};
  if (!schema || !schema.fields) return out;
  schema.fields.forEach(function(f) {
    if (f.type === 'table') out[f.id] = [];
    else if (f.default !== undefined) out[f.id] = f.default;
  });
  return out;
}

// Render a run's filled-in metadata as HTML for the workflow log. Called
// during Save-to-Entry so the workflow doc records what the run actually
// used (primers/temps/samples). Skipped silently if schema or metadata
// are empty — no visual clutter when there's nothing to say.
function _spRenderMetaForWorkflow(rs) {
  var schema = _spParseSchema(rs.protocol && rs.protocol.metadata_schema);
  var meta = rs.metadata || {};
  if (!schema || !schema.fields || !schema.fields.length) return '';
  // Split into scalars (rendered as inline definition list) and tables
  // (rendered as HTML tables). Skip fields the user didn't fill.
  var scalarRows = [];
  var tableBlocks = [];
  schema.fields.forEach(function(f) {
    var v = meta[f.id];
    if (v == null || v === '') return;  // unfilled — omit
    if (f.type === 'table') {
      if (!Array.isArray(v) || v.length === 0) return;
      var cols = f.columns || [];
      var thead = '<tr>' + cols.map(function(c) {
        return '<th style="text-align:left;font-size:11px;color:#6a5f52;font-weight:600;padding:3px 8px;border-bottom:1px solid #d5cec0">' + _gelEsc(c.label || c.id) + '</th>';
      }).join('') + '</tr>';
      var tbody = v.map(function(row) {
        return '<tr>' + cols.map(function(c) {
          return '<td style="padding:3px 8px;font-size:12px">' + _gelEsc(row[c.id] == null ? '' : String(row[c.id])) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      tableBlocks.push(
        '<div style="margin-top:6px"><strong style="font-size:12px;color:#6a5f52">' + _gelEsc(f.label || f.id) + '</strong>' +
        '<table style="border-collapse:collapse;margin-top:2px"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>'
      );
    } else {
      scalarRows.push(
        '<span style="margin-right:14px"><strong style="color:#6a5f52">' + _gelEsc(f.label || f.id) + ':</strong> ' + _gelEsc(String(v)) + '</span>'
      );
    }
  });
  if (!scalarRows.length && !tableBlocks.length) return '';
  var out = '<div class="wf-block wf-proto-meta" style="margin:6px 0 8px;padding:8px 12px;background:#faf8f4;border-left:3px solid #5b7aa0;border-radius:0 4px 4px 0;font-family:inherit">';
  if (scalarRows.length) out += '<div style="font-size:12px;line-height:1.7">' + scalarRows.join('') + '</div>';
  tableBlocks.forEach(function(t) { out += t; });
  out += '</div>';
  return out;
}

function _spRenderMetaField(f, values) {
  var cur = values[f.id];
  if (cur === undefined && f.default !== undefined) {
    cur = f.default;
    values[f.id] = cur;
  }
  if (f.type === 'table') {
    return _spRenderMetaTable(f, values);
  }
  var inputType = (f.type === 'number') ? 'number' : 'text';
  var val = cur == null ? '' : String(cur);
  return '<div class="sp-meta-field">' +
    '<label>' + esc(f.label || f.id) + '</label>' +
    '<input type="' + inputType + '" value="' + esc(val) +
      '" oninput="_spMetaSet(\'' + esc(f.id) + '\', this.value, \'' + inputType + '\')"/>' +
  '</div>';
}

function _spRenderMetaTable(f, values) {
  if (!Array.isArray(values[f.id])) values[f.id] = [];
  var rows = values[f.id];
  var cols = f.columns || [];
  var h = '<div class="sp-meta-field sp-meta-table">' +
    '<label>' + esc(f.label || f.id) + ' <span style="color:#8a7f72;font-weight:normal">(' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')</span></label>' +
    '<table><thead><tr>';
  cols.forEach(function(c) {
    h += '<th>' + esc(c.label || c.id) + '</th>';
  });
  h += '<th style="width:20px"></th></tr></thead><tbody>';
  rows.forEach(function(row, ri) {
    h += '<tr>';
    cols.forEach(function(c) {
      var v = row[c.id] == null ? '' : String(row[c.id]);
      var t = (c.type === 'number') ? 'number' : 'text';
      h += '<td><input type="' + t + '" value="' + esc(v) +
           '" oninput="_spMetaSetTableCell(\'' + esc(f.id) + '\',' + ri + ',\'' + esc(c.id) + '\', this.value, \'' + t + '\')"/></td>';
    });
    h += '<td><button class="sp-meta-x" onclick="_spMetaTableRemoveRow(\'' + esc(f.id) + '\',' + ri + ')" title="Remove row">&times;</button></td>';
    h += '</tr>';
  });
  h += '</tbody></table>' +
    '<button class="sp-meta-addrow" onclick="_spMetaTableAddRow(\'' + esc(f.id) + '\')">+ Add row</button>' +
  '</div>';
  return h;
}

// State mutations — all funnel through _saveRun so debounce handles
// batching, and the same code path handles disk persistence.
function _spMetaSet(fieldId, value, inputType) {
  var rs = _scratchProtoRun; if (!rs) return;
  if (!rs.metadata) rs.metadata = {};
  var v = value;
  if (inputType === 'number' && v !== '') {
    var n = parseFloat(v);
    v = isNaN(n) ? value : n;
  }
  rs.metadata[fieldId] = v;
  _saveRun(rs);
}

function _spMetaTableAddRow(fieldId) {
  var rs = _scratchProtoRun; if (!rs) return;
  if (!rs.metadata) rs.metadata = {};
  if (!Array.isArray(rs.metadata[fieldId])) rs.metadata[fieldId] = [];
  rs.metadata[fieldId].push({});
  _saveRun(rs);
  // Re-render just the meta panel so the new row appears.
  var el = document.getElementById('sp-meta-panel');
  if (el) el.innerHTML = _spRenderMetaPanel(rs);
}

function _spMetaTableRemoveRow(fieldId, rowIdx) {
  var rs = _scratchProtoRun; if (!rs) return;
  if (!rs.metadata || !Array.isArray(rs.metadata[fieldId])) return;
  rs.metadata[fieldId].splice(rowIdx, 1);
  _saveRun(rs);
  var el = document.getElementById('sp-meta-panel');
  if (el) el.innerHTML = _spRenderMetaPanel(rs);
}

function _spMetaSetTableCell(fieldId, rowIdx, colId, value, inputType) {
  var rs = _scratchProtoRun; if (!rs) return;
  if (!rs.metadata || !Array.isArray(rs.metadata[fieldId])) return;
  var v = value;
  if (inputType === 'number' && v !== '') {
    var n = parseFloat(v); v = isNaN(n) ? value : n;
  }
  if (!rs.metadata[fieldId][rowIdx]) rs.metadata[fieldId][rowIdx] = {};
  rs.metadata[fieldId][rowIdx][colId] = v;
  _saveRun(rs);
}

// Navigate to protocol edit — called from the empty-state link.
function spEditProtocol(protocolId) {
  if (!protocolId) return;
  if (typeof setView === 'function') {
    setView('protocols');
    // Best-effort: signal the protocols view to open this protocol's edit.
    setTimeout(function() {
      if (typeof _openProtocolEdit === 'function') _openProtocolEdit(protocolId);
    }, 100);
  }
}

// Inject side-panel CSS once at module load.
(function _spInjectMetaCss() {
  var css = [
    '.sp-meta-panel{background:#faf8f4;border:1px solid #e8e2d8;border-radius:6px;padding:12px 14px;position:sticky;top:12px;max-height:calc(100vh - 40px);overflow-y:auto;font-size:12px}',
    '.sp-meta-h{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#8a7f72;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e8e2d8}',
    '.sp-meta-empty{color:#8a7f72;line-height:1.5}',
    '.sp-meta-field{margin-bottom:10px}',
    '.sp-meta-field label{display:block;font-size:11px;color:#6a5f52;font-weight:600;margin-bottom:3px}',
    '.sp-meta-field input{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #d5cec0;border-radius:3px;background:#fff;font-size:12px;color:#4a4139;font-family:inherit}',
    '.sp-meta-field input:focus{outline:none;border-color:#5b7a5e}',
    '.sp-meta-table table{width:100%;border-collapse:collapse;margin-top:4px}',
    '.sp-meta-table th{font-size:10px;color:#8a7f72;text-transform:uppercase;letter-spacing:.05em;font-weight:600;padding:2px 4px;text-align:left;border-bottom:1px solid #e8e2d8}',
    '.sp-meta-table td{padding:2px}',
    '.sp-meta-table input{padding:3px 6px;font-size:11px}',
    '.sp-meta-x{background:none;border:none;color:#c0796a;cursor:pointer;font-size:14px;padding:0}',
    '.sp-meta-addrow{margin-top:6px;padding:4px 10px;font-size:11px;background:#fff;border:1px solid #d5cec0;border-radius:3px;color:#5b7a5e;cursor:pointer}',
    '.sp-meta-addrow:hover{background:#5b7a5e;color:#fff}',
    '@media (max-width:1000px){.sp-run-layout{grid-template-columns:1fr !important}.sp-meta-panel{position:static;max-height:none}}',
  ].join('');
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();

// ── multi-run tabs ─────────────────────────────────────────────────────
// The scratch pad historically showed ONE run at a time — you had to save
// or abandon to start a new one. Underlying storage (localStorage +
// /api/active-runs) already supported multiple concurrent runs; the workflow
// sidebar could see them all. These functions expose that in the scratch UI:
// a tab bar shows every active run, click switches, × discards, "+ Run
// another" opens the picker inline without losing your current run.

function _renderRunTabs() {
  var allRuns = _getAllRunsLocal();
  var activeId = _scratchProtoRun && _scratchProtoRun.runId;
  // Ensure the active run appears in the list even if localStorage was
  // out of sync (e.g. cross-tab race). Idempotent since dedupe below.
  if (activeId && !allRuns.some(function(r){return r.runId === activeId;})) {
    allRuns.push(_scratchProtoRun);
  }
  var seen = {}; allRuns = allRuns.filter(function(r){
    if (!r || !r.runId || seen[r.runId]) return false;
    seen[r.runId] = true; return true;
  });
  var tabs = allRuns.map(function(r) {
    var isActive = r.runId === activeId;
    var doneCount = (r.steps || []).filter(function(s){return s.done;}).length;
    var total = (r.steps || []).length;
    var title = (r.protocol && r.protocol.title) || 'Untitled';
    return '<div class="sp-runtab' + (isActive ? ' active' : '') + '" ' +
                'onclick="spSwitchRun(\'' + esc(r.runId) + '\')" ' +
                'title="' + esc(title) + ' — ' + doneCount + '/' + total + ' steps">' +
      '<span class="sp-runtab-title">' + esc(title) + '</span>' +
      '<span class="sp-runtab-count">' + doneCount + '/' + total + '</span>' +
      '<button class="sp-runtab-x" onclick="event.stopPropagation();spDiscardRunTab(\'' + esc(r.runId) + '\')" title="Discard this run">&#215;</button>' +
    '</div>';
  }).join('');
  return '<div class="sp-runtabs">' + tabs +
    '<button class="sp-runtab sp-runtab-add" onclick="spShowRunPickerInline()" title="Start another run alongside this one">+ Run another</button>' +
    '<div id="sp-runpicker-inline" style="flex-basis:100%"></div>' +
    '</div>';
}

async function spSwitchRun(runId) {
  if (!runId || (_scratchProtoRun && _scratchProtoRun.runId === runId)) return;
  // Save (but don't remove) the current run before swapping. _saveRun writes
  // to localStorage synchronously and schedules a DB write; safe to switch away.
  // Timers are NOT cleared on tab switch — the whole point of the floating
  // widget is that timers persist across view changes.
  if (_scratchProtoRun) _saveRun(_scratchProtoRun);
  var target = _getRunByIdLocal(runId);
  if (!target) {
    // Fall back to the DB — the run might exist there but not in this tab's
    // localStorage (cross-machine / cross-tab).
    try {
      var data = await api('GET', '/api/active-runs');
      var dbRun = (data.runs || []).find(function(r){return r.run_id === runId;});
      if (dbRun) {
        target = {
          runId:       dbRun.run_id,
          protocol:    JSON.parse(dbRun.protocol_json),
          steps:       JSON.parse(dbRun.steps_json || '[]'),
          recipe:      JSON.parse(dbRun.recipe_json || 'null') || _parseRecipeRun(null),
          scaling:     !!dbRun.scaling,
          scaleFactor: dbRun.scale_factor || 1.0,
          group_name:  dbRun.group_name || 'Protocols',
          subgroup:    dbRun.subgroup || '',
          startedAt:   dbRun.started_at
        };
        _saveLocalOnly(target);
      }
    } catch (e) {}
  }
  if (!target) { toast('Run not found', true); return; }
  _scratchProtoRun = target;
  var el = document.getElementById('content');
  if (el) _renderProtoRunInScratch(el);
}

async function spDiscardRunTab(runId) {
  if (!runId) return;
  if (!confirm('Discard this run? Progress will be lost.')) return;
  var wasActive = _scratchProtoRun && _scratchProtoRun.runId === runId;
  // Only this run's timers should die — timers from other runs, or ad-hoc
  // ones started outside a run, stay put. The `wasActive` gate is retained
  // for the render-fallback logic below, not for timer scope.
  if (typeof window.protoTimerRemoveByTag === 'function') {
    window.protoTimerRemoveByTag(runId);
  }
  await _removeRun(runId);
  if (wasActive) {
    // Fall through to next remaining run, or back to picker if none left.
    var remaining = _getAllRunsLocal();
    _scratchProtoRun = remaining.length ? remaining[0] : null;
  }
  var el = document.getElementById('content');
  if (el) { if (_scratchProtoRun) _renderProtoRunInScratch(el); else renderScratch(el); }
}

async function spShowRunPickerInline() {
  var wrap = document.getElementById('sp-runpicker-inline'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px">Loading...</div>';
  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];
  if (!S.protocols.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:6px;font-style:italic">No protocols saved yet.</div>';
    return;
  }
  // Filter out protocols already running (dedup by protocol.id)
  var runningPids = _getAllRunsLocal()
    .map(function(r){return r.protocol && r.protocol.id;})
    .filter(function(x){return x != null;});
  var choices = S.protocols.filter(function(p){return runningPids.indexOf(p.id) === -1;});
  var opts = choices.map(function(p){return '<option value="' + p.id + '">' + esc(p.title) + '</option>';}).join('');
  wrap.innerHTML =
    '<div class="sp-inline-picker">' +
      '<input type="text" id="sp-inline-q" placeholder="Filter protocols..." spellcheck="false" oninput="spInlinePickerFilter()"/>' +
      '<select id="sp-inline-sel" size="4">' + (opts || '<option disabled>All protocols already running</option>') + '</select>' +
      '<div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">' +
        '<button class="btn" onclick="spHideRunPickerInline()">Cancel</button>' +
        '<button class="btn primary" onclick="spLaunchInline()">&#9654; Start run</button>' +
      '</div>' +
    '</div>';
  document.getElementById('sp-inline-q')?.focus();
}
function spInlinePickerFilter() {
  var q = (document.getElementById('sp-inline-q')?.value || '').toLowerCase();
  document.querySelectorAll('#sp-inline-sel option').forEach(function(o){o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none';});
}
function spHideRunPickerInline() {
  var wrap = document.getElementById('sp-runpicker-inline'); if (wrap) wrap.innerHTML = '';
}
function spLaunchInline() {
  var sel = document.getElementById('sp-inline-sel');
  if (!sel || !sel.value) { toast('Select a protocol first', true); return; }
  var p = (S.protocols || []).find(function(x){return x.id === parseInt(sel.value);});
  if (!p) return;
  // spLaunchRunDirect swaps _scratchProtoRun to the new run and re-renders.
  // The tab bar picks up the new run automatically.
  spLaunchRunDirect(p, null, null);
}

function spSaveAndExit() {
  // Deliberately do NOT clear timers. Save & exit means "I'll come back to
  // this later" — a running incubation should keep counting in the widget.
  if (_scratchProtoRun) _saveRun(_scratchProtoRun);
  _scratchProtoRun = null;
  if (typeof setView === 'function') setView('protocols'); else loadView();
  toast('Run saved \u2014 resume from any machine via the Protocols page');
}

function spAbandonRun() {
  if (!confirm('Abandon this run? Progress will be lost.')) return;
  // Abandon means "this run isn't happening anymore" — its timers are stale
  // and should be removed. Other runs' timers stay put.
  if (_scratchProtoRun && typeof window.protoTimerRemoveByTag === 'function') {
    window.protoTimerRemoveByTag(_scratchProtoRun.runId);
  }
  if (_scratchProtoRun) _removeRun(_scratchProtoRun.runId);
  _scratchProtoRun = null;
  if (typeof setView === 'function') setView('protocols'); else loadView();
}

function spToggleStep(id, checked) {
  if (!_scratchProtoRun) return;
  var step = _scratchProtoRun.steps.find(function(s) { return s.id === id; }); if (!step) return;
  step.done = checked; _saveRun(_scratchProtoRun);
  document.getElementById('sps-' + id)?.classList.toggle('done', checked);
  var done = _scratchProtoRun.steps.filter(function(s) { return s.done; }).length;
  var fill = document.getElementById('sp-pfill'); if (fill) fill.style.width = Math.round((done / _scratchProtoRun.steps.length) * 100) + '%';
  var meta = document.getElementById('sp-run-meta'); if (meta) meta.textContent = done + ' / ' + _scratchProtoRun.steps.length + ' steps \xb7 started ' + new Date(_scratchProtoRun.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

  // Honest time-event log — records the moment the click happened, not
  // some inferred "when the step was actually done" time. Fire-and-forget;
  // if the log endpoint fails or is missing (older backend), the tick
  // itself still persists via _saveRun. The read side collapses
  // spam-catchup ticks so this doesn't produce noise.
  var idx = _scratchProtoRun.steps.findIndex(function(s) { return s.id === id; });
  var stepNumber = idx >= 0 ? (idx + 1) : id;
  var shortText = (step.text || '').replace(/\s+/g, ' ').trim();
  if (shortText.length > 80) shortText = shortText.substring(0, 77) + '...';
  fetch('/api/time-events/log', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      ts_iso: new Date().toISOString(),
      event_type: checked ? 'step_done' : 'step_undone',
      source_type: 'protocol_run',
      source_id: _scratchProtoRun.runId,
      content: 'Step ' + stepNumber + ': ' + shortText,
      metadata: {
        protocol_id: _scratchProtoRun.protocol && _scratchProtoRun.protocol.id,
        protocol_title: _scratchProtoRun.protocol && _scratchProtoRun.protocol.title,
        step_id: id,
        step_number: stepNumber
      }
    })
  }).catch(function() { /* silent — the tick already persisted via _saveRun */ });
}

function spToggleDev(id) {
  var n = document.getElementById('spd-' + id); if (!n) return;
  if (n.classList.toggle('open')) n.querySelector('textarea')?.focus();
}

function spUpdateDev(id, value) {
  if (!_scratchProtoRun) return;
  var step = _scratchProtoRun.steps.find(function(s) { return s.id === id; }); if (step) step.deviation = value;
  _saveRun(_scratchProtoRun);
  var el = document.getElementById('sps-' + id); if (!el) return;
  el.classList.toggle('has-dev', value.trim().length > 0);
  var btn = el.querySelector('.sp-dev-btn'); if (btn) btn.textContent = value.trim() ? '\u270e deviation noted' : '+ deviation note';
}

function spShowSummary() {
  var wrap = document.getElementById('sp-summary-wrap'); if (!wrap || !_scratchProtoRun) return;
  var rs = _scratchProtoRun;
  var devs = rs.steps.filter(function(s) { return s.deviation.trim(); });
  var inc  = rs.steps.filter(function(s) { return !s.done; });
  var html = '<div class="sp-summary"><div class="sp-summary-head">Run summary</div>';
  if (devs.length) {
    html += '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin-bottom:6px">Deviations</div><ul class="sp-summary-list">';
    devs.forEach(function(s) { html += '<li><div class="sp-dev-orig"><s>' + esc(s.text) + '</s></div><div class="sp-dev-new">&#8594; ' + esc(s.deviation) + '</div></li>'; });
    html += '</ul>';
  } else { html += '<div class="sp-summary-clean">No deviations.</div>'; }
  if (inc.length) {
    html += '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin:12px 0 6px">Incomplete</div><ul class="sp-summary-list">';
    inc.forEach(function(s) { html += '<li style="color:#8a7f72">' + esc(s.text) + '</li>'; });
    html += '</ul>';
  }
  html += '</div>';
  wrap.innerHTML = html;
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── save to entry + record completed run ──────────────────────────────────────
async function spSaveRunToEntry(runId) {
  var rs = null;
  if (runId) {
    // fetch from DB first
    try {
      var data = await api('GET', '/api/active-runs');
      var dbRun = (data.runs || []).find(function(r) { return r.run_id === runId; });
      if (dbRun) rs = { runId: dbRun.run_id, protocol: JSON.parse(dbRun.protocol_json), steps: JSON.parse(dbRun.steps_json || '[]'), recipe: JSON.parse(dbRun.recipe_json || 'null') || _parseRecipeRun(null), scaling: !!dbRun.scaling, scaleFactor: dbRun.scale_factor || 1.0, group_name: dbRun.group_name || 'Protocols', subgroup: dbRun.subgroup || '', startedAt: dbRun.started_at };
    } catch(e) {}
    if (!rs) rs = _getRunByIdLocal(runId);
  } else {
    rs = _scratchProtoRun;
  }
  if (!rs) { toast('Run not found', true); return; }

  var done  = rs.steps.filter(function(s) { return s.done; }).length;
  var devs  = rs.steps.filter(function(s) { return s.deviation.trim(); });
  var inc   = rs.steps.filter(function(s) { return !s.done; });
  /* Default to today, but honour an override date set by the daily check-in
     popup (window._spOverrideDate). The override is consumed once and cleared. */
  var today = new Date().toISOString().split('T')[0];
  if (window._spOverrideDate) {
    today = window._spOverrideDate;
    window._spOverrideDate = null;
  }
  var volCol = _volColIndex(rs.recipe.columns);

  var lines = ['## Protocol Run: ' + rs.protocol.title, '', '**Date:** ' + new Date(rs.startedAt).toLocaleString(), '**Progress:** ' + done + ' / ' + rs.steps.length + ' steps completed', ''];

  if (rs.recipe.rows.length) {
    lines.push('### Reaction Recipe');
    if (rs.scaling && rs.scaleFactor !== 1) lines.push('_Scale factor: x' + rs.scaleFactor + '_');
    lines.push('| ' + rs.recipe.columns.join(' | ') + ' |');
    lines.push('| ' + rs.recipe.columns.map(function() { return '---'; }).join(' | ') + ' |');
    rs.recipe.rows.forEach(function(row) {
      var cells = rs.recipe.columns.map(function(_, ci) {
        var val = row[ci] || '';
        if (ci === volCol && rs.scaling && rs.scaleFactor && val) { var n = parseFloat(val); if (!isNaN(n)) val = (n * rs.scaleFactor).toFixed(2).replace(/\.00$/, '') + ' (scaled)'; }
        return val;
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    });
    lines.push('');
  }

  lines.push('### Steps');
  rs.steps.forEach(function(step, i) {
    lines.push((i + 1) + '. [' + (step.done ? 'x' : ' ') + '] ' + step.text);
    if (step.deviation) lines.push('   _\u21b3 ' + step.deviation + '_');
  });
  if (devs.length) { lines.push('', '### Deviation Log'); devs.forEach(function(s) { lines.push('- ~~' + s.text + '~~'); lines.push('  \u2192 ' + s.deviation); }); }
  if (inc.length) { lines.push('', '### Not completed'); inc.forEach(function(s) { lines.push('- ' + s.text); }); }

  try {
    var entry = await api('POST', '/api/entries', {
      title: 'Protocol Run: ' + rs.protocol.title,
      date: today, group_name: rs.group_name, subgroup: rs.subgroup || '',
      notes: lines.join('\n'), summary: ''
    });
    await api('POST', '/api/protocol-runs', {
      protocol_id: rs.protocol.id, date: today, group_name: rs.group_name,
      steps_json: JSON.stringify(rs.steps), recipe_json: JSON.stringify(rs.recipe),
      entry_id: entry.id || null
    });
    /* Append a completion block to today's workflow document. List the completed
       steps (no times per user pref) plus any deviations. Tagged with the run's
       group so process-day pulls it into the right notebook entry. */
    try {
      var doneSteps = rs.steps.filter(function(s) { return s.done; });
      var devSteps = rs.steps.filter(function(s) { return s.deviation && s.deviation.trim(); });
      var stepHtml = '';
      if (doneSteps.length) {
        stepHtml += '<ul>' + doneSteps.map(function(s) {
          var line = _gelEsc(s.text);
          if (s.deviation && s.deviation.trim()) {
            line += '<br><em style="color:#b89a3a">\u21b3 ' + _gelEsc(s.deviation) + '</em>';
          }
          return '<li>' + line + '</li>';
        }).join('') + '</ul>';
      }
      var completionHtml =
        '<p class="wf-block wf-protocol">' +
          '<strong>\u2713 Completed protocol:</strong> ' + _gelEsc(rs.protocol.title) +
          ' (' + doneSteps.length + ' / ' + rs.steps.length + ' steps' +
          (devSteps.length ? ', ' + devSteps.length + ' deviation' + (devSteps.length > 1 ? 's' : '') : '') +
          ')' +
        '</p>' + _spRenderMetaForWorkflow(rs) + stepHtml;
      await api('POST', '/api/workflow/document/append', {
        date: today,
        html: completionHtml,
        groups: rs.group_name ? [rs.group_name] : null,
      });
    } catch(_appendErr) {
      /* Non-fatal — notebook entry already saved successfully */
    }
    toast('Saved to ' + rs.group_name + ' \u2713');
    await _removeRun(rs.runId);
    if (_scratchProtoRun && _scratchProtoRun.runId === rs.runId) _scratchProtoRun = null;
    if (typeof setView === 'function') setView('protocols'); else loadView();
  } catch(e) { toast('Save failed: ' + e.message, true); }
}

/* Tiny local HTML escaper so we don't depend on workflow.js loading first */
function _gelEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function spSaveToEntry() { spSaveRunToEntry(null); }

// expose for protocols.js active runs section
async function spGetActiveRuns() { return await _getAllRuns(); }

// ── original scratch functions ────────────────────────────────────────────────
async function addScratchQuick() {
  var inp = document.getElementById('sq-input');
  var text = inp?.value.trim(); if (!text) return;
  await api('POST', '/api/scratch', { type: 'text', content: text });
  inp.value = ''; await load(); toast('Noted');
}
async function addScratchBig() {
  var ta = document.getElementById('sb-input');
  var text = ta?.value.trim(); if (!text) return;
  await api('POST', '/api/scratch', { type: 'text', content: text });
  ta.value = ''; await load(); toast('Saved');
}
function viewScratchImage(id) { var w = window.open('', '_blank', 'width=800,height=600'); w.document.write('<img src="/api/scratch/' + id + '/image-raw" style="max-width:100%;max-height:100vh"/>'); }
async function deleteScratch(id) { await api('DELETE', '/api/scratch/' + id); await load(); }
function triggerFileInput() { document.getElementById('file-input').click(); }
function initDropZone() {
  var dz = document.getElementById('drop-zone'); if (!dz) return;
  dz.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', function() { dz.classList.remove('dragover'); });
}
function handleDrop(e) { e.preventDefault(); document.getElementById('drop-zone').classList.remove('dragover'); var file = e.dataTransfer.files[0]; if (file) uploadScratchFile(file); }
function handleFileSelect(e) { var file = e.target.files[0]; if (file) uploadScratchFile(file); }
async function uploadScratchFile(file) {
  var reader = new FileReader();
  reader.onload = async function(e) {
    var b64 = e.target.result.split(',')[1];
    await api('POST', '/api/scratch', { type: 'image', content: '', filename: file.name, image_data: b64 });
    await load(); toast('Figure saved');
  };
  reader.readAsDataURL(file);
}

registerView('scratch', renderScratch);
