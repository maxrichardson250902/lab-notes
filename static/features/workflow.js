// ── DAILY WORKFLOW ───────────────────────────────────────────────────────────
var _workflowDate = new Date().toISOString().slice(0, 10);

async function renderWorkflow(el) {
  var data    = await api('GET', '/api/workflow/' + _workflowDate);
  var entries = data.entries || [];
  var today   = new Date().toISOString().slice(0, 10);

  var html = '<div class="day-nav">' +
    '<button onclick="shiftDay(-1)">&#8592; Prev</button>' +
    '<div class="day-label">' + formatDate(_workflowDate) + '</div>' +
    (_workflowDate < today
      ? '<button onclick="shiftDay(1)">Next &#8594;</button>'
      : '<button disabled style="opacity:.3">Next &#8594;</button>') +
    '<button class="btn" onclick="processWorkflowDay()" title="Send this day\'s notes to the 3090 to format into notebook entries" style="margin-left:10px">&#9881; Process day</button>' +
  '</div>';

  if (data.summary) {
    html += '<div class="day-summary">' + esc(data.summary) + '</div>';
  }

  html += '<div class="timeline" id="workflow-timeline">';
  if (!entries.length) {
    html += '<div style="padding:32px 0 32px 82px;color:var(--muted);font-size:14px;font-style:italic">No entries yet — jot notes below, they get processed into formatted notebook entries.</div>';
  } else {
    html += entries.map(function(e) {
      var isTask = e.type === 'task_done';
      var isProto = e.type === 'protocol_run';
      return '<div class="timeline-entry" id="we-' + e.id + '">' +
        '<div class="timeline-time">' + esc(e.time || '') + '</div>' +
        '<div class="timeline-dot ' + (isTask ? 'task' : isProto ? 'protocol' : 'note') + '"></div>' +
        '<div class="timeline-body">' +
          '<div class="timeline-card ' + (isTask ? 'task-card' : isProto ? 'protocol-card-tl' : 'note-card') + '">' +
            (e.group_name ? '<div class="timeline-card-group">' + esc(e.group_name) + '</div>' : '') +
            '<div class="timeline-card-text" id="wt-' + e.id + '">' + esc(e.content) + '</div>' +
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

  // ── input area ──────────────────────────────────────────────────────────────
  html += '<div style="margin-top:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px">' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<input type="text" id="wf-group" placeholder="Project (optional)" spellcheck="false" ' +
        'style="width:140px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:4px;outline:none"/>' +
    '</div>' +
    '<div class="add-inline" style="padding:0">' +
      '<input type="text" id="wf-input" placeholder="Jot down what you\'re doing..." spellcheck="false"/>' +
      '<button onclick="addWorkflowNote()">Add</button>' +
    '</div>' +

    // ── protocol runner section ──
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

// ── protocol picker (workflow) ────────────────────────────────────────────────
async function wfShowProtoPicker() {
  var wrap = document.getElementById('wf-proto-picker-wrap'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading...</div>';

  var data = await api('GET', '/api/protocols');
  S.protocols = data.protocols || [];

  if (!S.protocols.length) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;font-style:italic">No protocols saved yet — add one in the Protocols page first.</div>';
    return;
  }

  // collect existing groups from today's workflow for quick-select
  var data2     = await api('GET', '/api/workflow/' + _workflowDate);
  var seenGroups = [];
  (data2.entries || []).forEach(function(e) {
    if (e.group_name && seenGroups.indexOf(e.group_name) === -1) seenGroups.push(e.group_name);
  });
  // also grab the current group input value
  var currentGroup = document.getElementById('wf-group')?.value.trim();
  if (currentGroup && seenGroups.indexOf(currentGroup) === -1) seenGroups.unshift(currentGroup);

  var opts = S.protocols.map(function(p) {
    return '<option value="' + p.id + '">' + esc(p.title) + '</option>';
  }).join('');

  var groupSuggestions = seenGroups.length
    ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">' +
        seenGroups.map(function(g) {
          return '<button class="btn" style="font-size:11px;padding:2px 8px" onclick="document.getElementById(\'wf-pk-group\').value=\'' + esc(g) + '\'">' + esc(g) + '</button>';
        }).join('') +
      '</div>'
    : '';

  wrap.innerHTML =
    '<div style="background:#f0ebe3;border:1px solid #d5cec0;border-radius:8px;padding:12px;margin-top:6px">' +
      '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">' +
        '<input type="text" id="wf-pk-q" placeholder="Search protocols..." spellcheck="false" ' +
          'style="flex:1" oninput="wfPickerFilter()"/>' +
        '<button class="btn" onclick="wfHideProtoPicker()">Cancel</button>' +
      '</div>' +
      '<select id="wf-pk-sel" size="4" style="width:100%;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:inherit;font-size:13px;margin-bottom:8px">' +
        opts +
      '</select>' +
      '<div style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;margin-bottom:4px">Save entry to group</div>' +
      groupSuggestions +
      '<input type="text" id="wf-pk-group" placeholder="e.g. Cloning, Gibson, Western..." spellcheck="false" ' +
        'style="width:100%;margin-bottom:8px" value="' + esc(currentGroup) + '"/>' +
      '<div style="text-align:right">' +
        '<button class="btn primary" onclick="wfLaunchProtoRun()">&#9654; Start run</button>' +
      '</div>' +
    '</div>';

  document.getElementById('wf-pk-q')?.focus();
}

function wfHideProtoPicker() {
  var wrap = document.getElementById('wf-proto-picker-wrap');
  if (wrap) wrap.innerHTML = '<button class="btn" style="color:#5b7a5e;font-size:12px" onclick="wfShowProtoPicker()">&#9654; Run a protocol</button>';
}

function wfPickerFilter() {
  var q = (document.getElementById('wf-pk-q')?.value || '').toLowerCase();
  document.querySelectorAll('#wf-pk-sel option').forEach(function(o) {
    o.style.display = (!q || o.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function wfLaunchProtoRun() {
  var sel   = document.getElementById('wf-pk-sel');
  var group = (document.getElementById('wf-pk-group')?.value || '').trim();
  if (!sel || !sel.value) { toast('Select a protocol first', true); return; }
  if (!group) { toast('Enter a group name to file the entry under', true); document.getElementById('wf-pk-group')?.focus(); return; }

  var p = (S.protocols || []).find(function(x) { return x.id === parseInt(sel.value); });
  if (!p) return;

  // log a marker in today's workflow timeline
  api('POST', '/api/workflow', {
    content:    'Running protocol: ' + p.title,
    type:       'protocol_run',
    group_name: group
  });

  // launch via scratch.js runner with the chosen group
  if (typeof spLaunchRunDirect === 'function') {
    spLaunchRunDirect(p, group);
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

async function processWorkflowDay() {
  if (!confirm('Send all notes for ' + _workflowDate + ' to the 3090 for formatting into notebook entries?')) return;
  toast('Processing — waking 3090...');
  try {
    var resp = await api('POST', '/api/workflow/process-day', { date: _workflowDate });
    if (resp.error) { toast(resp.error, true); return; }
    toast('Created ' + resp.count + ' notebook entries from workflow');
    await load();
  } catch(e) { toast('Failed: ' + e.message, true); }
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
  await api('PUT', '/api/workflow/' + id, { content });
  await loadView(); toast('Saved');
}

async function deleteWorkflowEntry(id) {
  await api('DELETE', '/api/workflow/' + id);
  await loadView();
}

registerView('workflow', renderWorkflow);
window.processWorkflowDay = processWorkflowDay;
