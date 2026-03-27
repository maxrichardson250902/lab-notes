// ── DAILY WORKFLOW ───────────────────────────────────────────────────────────
var _workflowDate = new Date().toISOString().slice(0, 10);
var _wfNotebookGroups = [];    // cached from /api/entries
var _wfSubgroupMap = {};       // {group: {subgroup: true}}
var _wfProcessJobId = null;    // active process-day job ID
var _wfPollTimer = null;       // polling interval handle

async function _loadWfNotebookGroups() {
  try {
    var data = await api('GET', '/api/entries');
    var seen = {}, subMap = {};
    (data.entries || []).forEach(function(e) {
      if (e.group_name) {
        seen[e.group_name] = true;
        if (e.subgroup) {
          if (!subMap[e.group_name]) subMap[e.group_name] = {};
          subMap[e.group_name][e.subgroup] = true;
        }
      }
    });
    _wfNotebookGroups = Object.keys(seen).sort();
    _wfSubgroupMap = subMap;
  } catch(ex) { _wfNotebookGroups = []; _wfSubgroupMap = {}; }
}

async function renderWorkflow(el) {
  var data    = await api('GET', '/api/workflow/' + _workflowDate);
  var entries = data.entries || [];
  var today   = new Date().toISOString().slice(0, 10);
  await _loadWfNotebookGroups();

  var html = '<div class="day-nav">' +
    '<button onclick="shiftDay(-1)">&#8592; Prev</button>' +
    '<div class="day-label">' + formatDate(_workflowDate) + '</div>' +
    (_workflowDate < today
      ? '<button onclick="shiftDay(1)">Next &#8594;</button>'
      : '<button disabled style="opacity:.3">Next &#8594;</button>') +
    '<button class="btn" id="wf-process-btn" onclick="processWorkflowDay()" title="Send this day\x27s notes to the 3090 to format into notebook entries" style="margin-left:10px">&#9881; Process day</button>' +
  '</div>';

  // ── process-day progress overlay ──────────────────────────────────────────
  html += '<div id="wf-process-status" style="display:none;margin:8px 0;padding:14px 16px;background:#e8f0e8;border:1px solid #b5ccb5;border-radius:6px">' +
    // phase steps
    '<div id="wf-ps-phases" style="display:flex;align-items:center;gap:0;margin-bottom:10px;font-size:11px;font-weight:600">' +
      '<div class="wf-phase" id="wf-ph-waking" data-label="Wake 3090" style="flex:1;text-align:center">' +
        '<div class="wf-phase-dot" style="width:10px;height:10px;border-radius:50%;border:2px solid #b5ccb5;background:#faf8f4;margin:0 auto 3px"></div>' +
        '<div style="color:#8a7f72">Wake 3090</div>' +
      '</div>' +
      '<div style="flex:0 0 auto;height:2px;width:24px;background:#d5cec0;margin-bottom:14px"></div>' +
      '<div class="wf-phase" id="wf-ph-llm" data-label="Start LLM" style="flex:1;text-align:center">' +
        '<div class="wf-phase-dot" style="width:10px;height:10px;border-radius:50%;border:2px solid #b5ccb5;background:#faf8f4;margin:0 auto 3px"></div>' +
        '<div style="color:#8a7f72">Start LLM</div>' +
      '</div>' +
      '<div style="flex:0 0 auto;height:2px;width:24px;background:#d5cec0;margin-bottom:14px"></div>' +
      '<div class="wf-phase" id="wf-ph-processing" data-label="Format entries" style="flex:1;text-align:center">' +
        '<div class="wf-phase-dot" style="width:10px;height:10px;border-radius:50%;border:2px solid #b5ccb5;background:#faf8f4;margin:0 auto 3px"></div>' +
        '<div style="color:#8a7f72">Format entries</div>' +
      '</div>' +
      '<div style="flex:0 0 auto;height:2px;width:24px;background:#d5cec0;margin-bottom:14px"></div>' +
      '<div class="wf-phase" id="wf-ph-done" data-label="Done" style="flex:1;text-align:center">' +
        '<div class="wf-phase-dot" style="width:10px;height:10px;border-radius:50%;border:2px solid #b5ccb5;background:#faf8f4;margin:0 auto 3px"></div>' +
        '<div style="color:#8a7f72">Done</div>' +
      '</div>' +
    '</div>' +
    // main progress bar
    '<div style="height:6px;background:#c8d8c8;border-radius:3px;margin-bottom:8px;overflow:hidden">' +
      '<div id="wf-ps-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#5b7a5e,#7a9e7e);border-radius:3px;transition:width 0.5s ease"></div>' +
    '</div>' +
    // stage text and detail
    '<div style="display:flex;align-items:baseline;justify-content:space-between">' +
      '<div id="wf-ps-stage" style="font-size:13px;color:#4a4139"></div>' +
      '<div id="wf-ps-pct" style="font-size:12px;color:#8a7f72;font-variant-numeric:tabular-nums"></div>' +
    '</div>' +
    '<div id="wf-ps-detail" style="font-size:12px;color:#8a7f72;margin-top:4px"></div>' +
  '</div>';

  if (data.summary) html += '<div class="day-summary">' + esc(data.summary) + '</div>';

  html += '<div class="timeline" id="workflow-timeline">';
  if (!entries.length) {
    html += '<div style="padding:32px 0 32px 82px;color:var(--muted);font-size:14px;font-style:italic">No entries yet — jot notes below, they get processed into formatted notebook entries.</div>';
  } else {
    // snapshot active runs from localStorage for cross-referencing
    var _activeRunsNow = [];
    try { _activeRunsNow = JSON.parse(localStorage.getItem('lab_proto_runs') || '[]'); } catch(_e) {}

    html += entries.map(function(e) {
      var isTask  = e.type === 'task_done';
      var isProto = e.type === 'protocol_run';

      // for protocol_run entries, extract protocol title from content and find active run
      var protoActions = '';
      if (isProto) {
        // content is "Running protocol: <title>" — extract title
        var protoTitle = e.content.replace(/^Running protocol:\s*/i, '').trim();
        // find matching active run by protocol title
        var activeRun = _activeRunsNow.find(function(r) {
          return r.protocol && r.protocol.title === protoTitle;
        });
        if (activeRun) {
          var done = activeRun.steps.filter(function(s) { return s.done; }).length;
          var pct  = Math.round((done / activeRun.steps.length) * 100);
          protoActions = '<div style="margin-top:6px;padding:6px 8px;background:#e8f0e8;border-radius:4px;display:flex;align-items:center;gap:8px">' +
            '<div style="flex:1">' +
              '<div style="font-size:11px;font-weight:600;color:#5b7a5e">&#9654; In progress &nbsp;&#183;&nbsp; ' + done + '/' + activeRun.steps.length + ' steps (' + pct + '%)</div>' +
              '<div style="height:3px;background:#c8d8c8;border-radius:2px;margin-top:3px"><div style="height:100%;width:' + pct + '%;background:#5b7a5e;border-radius:2px"></div></div>' +
            '</div>' +
            '<button class="btn primary" style="font-size:11px;padding:3px 10px" onclick="wfResumeRun(\x27' + activeRun.runId + '\x27)">Resume</button>' +
          '</div>';
        } else {
          // run completed or not started yet — link to protocol history
          protoActions = '<div style="margin-top:6px">' +
            '<button class="btn" style="font-size:11px;color:#5b7a5e" onclick="wfViewProtocolHistory(\x27' + esc(protoTitle) + '\x27)">&#128196; View protocol history</button>' +
          '</div>';
        }
      }

      return '<div class="timeline-entry" id="we-' + e.id + '">' +
        '<div class="timeline-time">' + esc(e.time || '') + '</div>' +
        '<div class="timeline-dot ' + (isTask ? 'task' : isProto ? 'protocol' : 'note') + '"></div>' +
        '<div class="timeline-body">' +
          '<div class="timeline-card ' + (isTask ? 'task-card' : isProto ? 'protocol-card-tl' : 'note-card') + '">' +
            (e.group_name ? '<div class="timeline-card-group">' + esc(e.group_name) + '</div>' : '') +
            '<div class="timeline-card-text" id="wt-' + e.id + '">' + esc(e.content) + '</div>' +
            protoActions +
            '<div class="timeline-actions">' +
              '<button class="btn" onclick="editWorkflowEntry(' + e.id + ')">Edit</button>' +
              '<button class="btn" onclick="tagWorkflowEntry(' + e.id + ')" title="Set project group">Tag</button>' +
              '<button class="btn" style="color:var(--red)" onclick="deleteWorkflowEntry(' + e.id + ')">&#215;</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  html += '</div>';

  // ── group input — dropdown if groups exist, text if not ───────────────────
  var groupControl;
  if (_wfNotebookGroups.length) {
    var groupOpts = '<option value="">Project (optional)</option>' +
      _wfNotebookGroups.map(function(g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('');
    groupControl = '<select id="wf-group" ' +
      'style="background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:4px;outline:none">' +
      groupOpts + '</select>';
  } else {
    groupControl = '<input type="text" id="wf-group" placeholder="Project (optional)" spellcheck="false" ' +
      'style="width:140px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:4px;outline:none"/>';
  }

  html += '<div style="margin-top:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px">' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' + groupControl + '</div>' +
    '<div class="add-inline" style="padding:0">' +
      '<input type="text" id="wf-input" placeholder="Jot down what you\x27re doing..." spellcheck="false"/>' +
      '<button onclick="addWorkflowNote()">Add</button>' +
    '</div>' +
    '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
      '<div id="wf-proto-picker-wrap">' +
        '<button class="btn" style="color:#5b7a5e;font-size:12px" onclick="wfShowProtoPicker()">&#9654; Run a protocol</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  el.innerHTML = html;
  setTimeout(function() {
    var wfInp = document.getElementById('wf-input');
    if (wfInp) {
      wfInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') addWorkflowNote(); });
      wfInp.focus();
    }
  }, 50);
}

// ── protocol picker ───────────────────────────────────────────────────────────
async function wfShowProtoPicker() {
  var wrap = document.getElementById('wf-proto-picker-wrap'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading...</div>';

  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];
  if (!S.protocols.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;font-style:italic">No protocols saved yet — add one in the Protocols page first.</div>';
    return;
  }

  var currentGroup = document.getElementById('wf-group')?.value.trim() || '';
  var opts = S.protocols.map(function(p) { return '<option value="' + p.id + '">' + esc(p.title) + '</option>'; }).join('');

  // group dropdown for the picker
  var groupOpts = '<option value="">Select group...</option>' +
    _wfNotebookGroups.map(function(g) {
      return '<option value="' + esc(g) + '"' + (g === currentGroup ? ' selected' : '') + '>' + esc(g) + '</option>';
    }).join('');

  wrap.innerHTML =
    '<div style="background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:12px;margin-top:6px">' +
      '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">' +
        '<input type="text" id="wf-pk-q" placeholder="Search protocols..." spellcheck="false" style="flex:1" oninput="wfPickerFilter()"/>' +
        '<button class="btn" onclick="wfHideProtoPicker()">Cancel</button>' +
      '</div>' +
      '<select id="wf-pk-sel" size="4" style="width:100%;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:inherit;font-size:13px;margin-bottom:10px">' +
        opts +
      '</select>' +
      '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<div style="flex:1">' +
          '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin-bottom:4px">Notebook group</div>' +
          '<select id="wf-pk-group" style="width:100%;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:inherit;font-size:13px;padding:5px 8px" onchange="wfPickerGroupChanged()">' +
            groupOpts +
          '</select>' +
        '</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin-bottom:4px">Subgroup <span style="font-weight:400;text-transform:none;font-size:10px">(optional)</span></div>' +
          '<input type="text" id="wf-pk-subgroup" placeholder="e.g. protein expression testing" spellcheck="false" style="width:100%" list="wf-pk-subgroup-dl"/>' +
          '<datalist id="wf-pk-subgroup-dl"></datalist>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<button class="btn primary" onclick="wfLaunchProtoRun()">&#9654; Start run</button>' +
      '</div>' +
    '</div>';

  document.getElementById('wf-pk-q')?.focus();
  // pre-populate subgroup suggestions if group already selected
  if (currentGroup) wfPickerGroupChanged();
}

function wfHideProtoPicker() {
  var wrap = document.getElementById('wf-proto-picker-wrap');
  if (wrap) wrap.innerHTML = '<button class="btn" style="color:#5b7a5e;font-size:12px" onclick="wfShowProtoPicker()">&#9654; Run a protocol</button>';
}

function wfPickerFilter() {
  var q = (document.getElementById('wf-pk-q')?.value || '').toLowerCase();
  document.querySelectorAll('#wf-pk-sel option').forEach(function(o) { o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none'; });
}

function wfPickerGroupChanged() {
  var group    = document.getElementById('wf-pk-group')?.value || '';
  var datalist = document.getElementById('wf-pk-subgroup-dl'); if (!datalist) return;
  var subs = Object.keys(_wfSubgroupMap[group] || {});
  datalist.innerHTML = subs.map(function(s) { return '<option value="' + esc(s) + '">'; }).join('');
}

function wfLaunchProtoRun() {
  var sel      = document.getElementById('wf-pk-sel');
  var group    = (document.getElementById('wf-pk-group')?.value || '').trim();
  var subgroup = (document.getElementById('wf-pk-subgroup')?.value || '').trim();
  if (!sel || !sel.value) { toast('Select a protocol first', true); return; }
  if (!group) { toast('Select a notebook group', true); document.getElementById('wf-pk-group')?.focus(); return; }

  var p = (S.protocols || []).find(function(x) { return x.id === parseInt(sel.value); });
  if (!p) return;

  // log in timeline
  api('POST', '/api/workflow', {
    content:    'Running protocol: ' + p.title,
    type:       'protocol_run',
    group_name: group
  });

  if (typeof spLaunchRunDirect === 'function') {
    spLaunchRunDirect(p, group, subgroup);
  } else {
    toast('scratch.js not loaded', true);
  }
}

// ── workflow helpers ──────────────────────────────────────────────────────────
function shiftDay(d) {
  var dt = new Date(_workflowDate + 'T12:00:00');
  dt.setDate(dt.getDate() + d);
  _workflowDate = dt.toISOString().slice(0, 10);
  loadView();
}

async function addWorkflowNote() {
  var inp    = document.getElementById('wf-input');
  var grpInp = document.getElementById('wf-group');
  var text   = inp?.value.trim(); if (!text) return;
  var group  = grpInp?.value.trim() || null;
  await api('POST', '/api/workflow', { content: text, type: 'note', group_name: group });
  inp.value = '';
  await loadView();
}

function tagWorkflowEntry(id) {
  var group = prompt('Set project group for this entry (leave empty to clear):');
  if (group === null) return;
  api('PUT', '/api/workflow/' + id, { group_name: group || null }).then(function() { loadView(); toast('Tagged'); });
}

// ── Process Day — non-blocking with progress polling ────────────────────────

async function processWorkflowDay() {
  if (!confirm('Send all notes for ' + _workflowDate + ' to the 3090 for formatting into notebook entries?')) return;

  var btn = document.getElementById('wf-process-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

  _wfShowProcessStatus('Starting...');

  try {
    var resp = await api('POST', '/api/workflow/process-day', { date: _workflowDate });

    if (resp.error) {
      _wfShowProcessError(resp.error, resp.job_id);
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      return;
    }

    if (!resp.job_id) {
      _wfShowProcessError('No job ID returned — unexpected server response');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      return;
    }

    _wfProcessJobId = resp.job_id;
    _wfStartPolling(resp.job_id);

  } catch(e) {
    _wfShowProcessError('Request failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

function _wfStartPolling(jobId) {
  if (_wfPollTimer) clearInterval(_wfPollTimer);
  _wfAnimStart = Date.now();
  _wfAnimPhase = 'starting';
  _wfAnimTarget = 0;
  _wfAnimCurrent = 0;
  _wfPollTimer = setInterval(function() { _wfPollStatus(jobId); }, 2000);
  // smooth animation ticker — advances the bar between polls
  if (_wfAnimTimer) cancelAnimationFrame(_wfAnimTimer);
  _wfAnimTick();
}

function _wfStopPolling() {
  if (_wfPollTimer) { clearInterval(_wfPollTimer); _wfPollTimer = null; }
  if (_wfAnimTimer) { cancelAnimationFrame(_wfAnimTimer); _wfAnimTimer = null; }
}

// ── Progress animation state ────────────────────────────────────────────────
// Phase layout (% of overall bar):
//   waking:     0 – 30  (est ~30s)
//   llm_start: 30 – 50  (est ~20s)
//   processing: 50 – 95  (real progress from backend)
//   done:       100
var _wfAnimStart   = 0;
var _wfAnimPhase   = 'starting';
var _wfAnimTarget  = 0;     // target % from backend phase
var _wfAnimCurrent = 0;     // rendered %
var _wfAnimTimer   = null;

function _wfPhaseTarget(phase, progress, total) {
  // Maps backend phase to an overall 0–100 target %
  if (phase === 'starting')      return 2;
  if (phase === 'waking')        return Math.min(28, 5 + _wfElapsedPct(30, 23));   // creep 5→28 over 30s
  if (phase === 'waking_done')   return 30;
  if (phase === 'llm_starting')  return Math.min(48, 32 + _wfElapsedPct(20, 16));  // creep 32→48 over 20s
  if (phase === 'llm_ready')     return 50;
  if (phase === 'processing' && total > 0) return 50 + Math.round((progress / total) * 45);
  if (phase === 'processing')    return 52;
  if (phase === 'done')          return 100;
  return _wfAnimCurrent; // hold current on unknown
}

function _wfElapsedPct(estSeconds, range) {
  // Returns how much of `range` to fill based on time elapsed since phase started
  var elapsed = (Date.now() - _wfPhaseStartTime) / 1000;
  // ease-out curve: fast start, slows as it approaches the cap
  var t = Math.min(elapsed / estSeconds, 1);
  var eased = 1 - Math.pow(1 - t, 2);
  return Math.round(eased * range);
}

var _wfPhaseStartTime = Date.now();
var _wfLastPhase = '';

function _wfAnimTick() {
  // Smoothly approach target
  if (_wfAnimCurrent < _wfAnimTarget) {
    _wfAnimCurrent = Math.min(_wfAnimTarget, _wfAnimCurrent + 0.5);
  }
  var bar = document.getElementById('wf-ps-bar');
  var pctEl = document.getElementById('wf-ps-pct');
  if (bar) bar.style.width = Math.round(_wfAnimCurrent) + '%';
  if (pctEl) pctEl.textContent = Math.round(_wfAnimCurrent) + '%';

  // During estimated phases, keep recalculating target based on elapsed time
  if (_wfAnimPhase === 'waking' || _wfAnimPhase === 'llm_starting') {
    _wfAnimTarget = _wfPhaseTarget(_wfAnimPhase, 0, 0);
  }

  _wfAnimTimer = requestAnimationFrame(_wfAnimTick);
}

function _wfSetActivePhase(phase) {
  if (phase !== _wfLastPhase) {
    _wfPhaseStartTime = Date.now();
    _wfLastPhase = phase;
  }
  _wfAnimPhase = phase;

  // Update phase dots
  var phaseMap = {
    'starting':     [],
    'waking':       ['waking'],
    'waking_done':  ['waking'],
    'llm_starting': ['waking', 'llm'],
    'llm_ready':    ['waking', 'llm'],
    'processing':   ['waking', 'llm', 'processing'],
    'done':         ['waking', 'llm', 'processing', 'done']
  };
  var activeMap = {
    'waking':       'waking',
    'waking_done':  'waking',
    'llm_starting': 'llm',
    'llm_ready':    'llm',
    'processing':   'processing',
    'done':         'done'
  };

  var completed = phaseMap[phase] || [];
  var active    = activeMap[phase] || '';

  ['waking', 'llm', 'processing', 'done'].forEach(function(p) {
    var el = document.getElementById('wf-ph-' + p);
    if (!el) return;
    var dot   = el.querySelector('.wf-phase-dot');
    var label = el.querySelector('div:last-child');
    if (completed.indexOf(p) >= 0) {
      // completed or active
      if (p === active && phase !== 'done') {
        // currently active — pulsing
        dot.style.background = '#5b7a5e';
        dot.style.borderColor = '#5b7a5e';
        dot.style.boxShadow = '0 0 0 3px rgba(91,122,94,0.25)';
        label.style.color = '#4a4139';
        label.style.fontWeight = '700';
      } else {
        // completed
        dot.style.background = '#5b7a5e';
        dot.style.borderColor = '#5b7a5e';
        dot.style.boxShadow = 'none';
        label.style.color = '#5b7a5e';
        label.style.fontWeight = '600';
      }
    } else {
      // upcoming
      dot.style.background = '#faf8f4';
      dot.style.borderColor = '#b5ccb5';
      dot.style.boxShadow = 'none';
      label.style.color = '#8a7f72';
      label.style.fontWeight = '600';
    }
  });
}

async function _wfPollStatus(jobId) {
  try {
    var job = await api('GET', '/api/workflow/process-day/' + jobId);

    var stageEl = document.getElementById('wf-ps-stage');
    var detail  = document.getElementById('wf-ps-detail');
    var phase   = job.phase || 'starting';

    // Update phase dots and animation target
    _wfSetActivePhase(phase);
    _wfAnimTarget = _wfPhaseTarget(phase, job.progress || 0, job.total || 0);

    if (stageEl) stageEl.textContent = job.stage || 'Working...';

    // Show group progress during processing
    if (phase === 'processing' && job.total > 0 && detail) {
      detail.textContent = (job.progress || 0) + ' of ' + job.total + ' groups processed';
    }

    if (job.status === 'done') {
      _wfAnimTarget = 100;
      _wfAnimCurrent = 100;
      _wfStopPolling();

      // Force bar to 100
      var bar = document.getElementById('wf-ps-bar');
      if (bar) bar.style.width = '100%';
      var pctEl = document.getElementById('wf-ps-pct');
      if (pctEl) pctEl.textContent = '100%';

      var results = job.results || [];
      var errors  = job.errors || [];
      var msg = 'Created ' + results.length + ' notebook entries';
      if (errors.length) msg += ' (' + errors.length + ' failed)';
      if (stageEl) stageEl.textContent = msg;

      // Show per-group detail
      var detailParts = [];
      results.forEach(function(r) {
        detailParts.push('<span style="color:#5b7a5e">&#10003; ' + esc(r.group) + '</span>');
      });
      errors.forEach(function(e) {
        detailParts.push('<span style="color:#c0392b">&#10007; ' + esc(e.group) + ': ' + esc(e.error) + '</span>');
      });
      if (detail) detail.innerHTML = detailParts.join('<br>');

      // Auto-hide after 10 seconds
      setTimeout(function() {
        var statusEl = document.getElementById('wf-process-status');
        if (statusEl) statusEl.style.display = 'none';
        var btn = document.getElementById('wf-process-btn');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      }, 10000);

      toast(msg);
      loadView();

    } else if (job.status === 'failed') {
      _wfStopPolling();
      _wfShowProcessError(job.stage || 'Processing failed');
      var btn = document.getElementById('wf-process-btn');
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }

  } catch(e) {
    // Network error during poll — keep trying
    console.warn('Poll error:', e);
  }
}

function _wfShowProcessStatus(msg) {
  var statusEl = document.getElementById('wf-process-status');
  if (!statusEl) return;
  statusEl.style.display = '';
  statusEl.style.background = '#e8f0e8';
  statusEl.style.borderColor = '#b5ccb5';

  var stageEl = document.getElementById('wf-ps-stage');
  if (stageEl) { stageEl.textContent = msg; stageEl.style.color = '#4a4139'; }

  var bar = document.getElementById('wf-ps-bar');
  if (bar) bar.style.width = '0%';

  var pctEl = document.getElementById('wf-ps-pct');
  if (pctEl) pctEl.textContent = '0%';

  var detail = document.getElementById('wf-ps-detail');
  if (detail) detail.innerHTML = '';

  // Reset all phase dots
  _wfSetActivePhase('starting');
}

function _wfShowProcessError(msg, stuckJobId) {
  _wfStopPolling();
  var statusEl = document.getElementById('wf-process-status');
  if (!statusEl) return;
  statusEl.style.display = '';
  statusEl.style.background = '#fce8e8';
  statusEl.style.borderColor = '#e0b5b5';

  var stageEl = document.getElementById('wf-ps-stage');
  if (stageEl) { stageEl.textContent = msg; stageEl.style.color = '#c0392b'; }

  var pctEl = document.getElementById('wf-ps-pct');
  if (pctEl) pctEl.textContent = '';

  var detail = document.getElementById('wf-ps-detail');
  if (detail) {
    detail.innerHTML = '<button class="btn" style="font-size:11px;margin-top:4px;color:#c0392b" onclick="wfResetProcessDay()">Reset stuck job</button>' +
      '&nbsp;&nbsp;<button class="btn" style="font-size:11px;margin-top:4px" onclick="document.getElementById(\x27wf-process-status\x27).style.display=\x27none\x27">Dismiss</button>';
  }

  toast(msg, true);
}

async function wfResetProcessDay() {
  try {
    await api('POST', '/api/workflow/process-day/reset');
    toast('Process-day state reset');
    var statusEl = document.getElementById('wf-process-status');
    if (statusEl) statusEl.style.display = 'none';
    var btn = document.getElementById('wf-process-btn');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  } catch(e) {
    toast('Reset failed: ' + e.message, true);
  }
}

function editWorkflowEntry(id) {
  var el = document.getElementById('wt-' + id); if (!el) return;
  var current = el.textContent;
  el.innerHTML = '<textarea id="we-ta-' + id + '" style="min-height:60px;width:100%;background:transparent;border:none;border-bottom:1px solid var(--accent);color:var(--text);font-family:var(--sans);font-size:14px;outline:none;resize:none;padding:2px 0">' + esc(current) + '</textarea>';
  var ta = el.querySelector('textarea'); ta.focus();
  ta.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveWorkflowEntry(id, this.value); }
    if (e.key === 'Escape') loadView();
  });
}

async function saveWorkflowEntry(id, content) {
  await api('PUT', '/api/workflow/' + id, { content: content });
  await loadView(); toast('Saved');
}

async function deleteWorkflowEntry(id) {
  await api('DELETE', '/api/workflow/' + id);
  await loadView();
}

function wfResumeRun(runId) {
  if (typeof spResumeRunById === 'function') spResumeRunById(runId);
  else toast('Could not resume', true);
}

function wfViewProtocolHistory(protoTitle) {
  // navigate to protocols page and open the matching card
  if (!S.protocols || !S.protocols.length) {
    api('GET', '/api/protocols').then(function(data) {
      S.protocols = data.protocols || [];
      _wfJumpToProtocol(protoTitle);
    });
  } else {
    _wfJumpToProtocol(protoTitle);
  }
}

function _wfJumpToProtocol(title) {
  var p = (S.protocols || []).find(function(x) { return x.title === title; });
  if (!p) { toast('Protocol not found', true); return; }
  if (typeof setView === 'function') {
    setView('protocols');
    // open the card after render
    setTimeout(function() {
      var card = document.getElementById('pc-' + p.id);
      if (card) {
        if (!card.classList.contains('open') && typeof protoToggle === 'function') protoToggle(p.id);
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 300);
  }
}

registerView('workflow', renderWorkflow);
window.processWorkflowDay = processWorkflowDay;
window.wfResetProcessDay  = wfResetProcessDay;
