// ── REMINDERS ─────────────────────────────────────────────────────────────────
let reminderGroups = [];
let reminderFilterGroup = '__all__';
let showDoneReminders = false;

async function loadReminderGroups() {
  var res = await api('GET', '/api/reminders/groups');
  reminderGroups = res.groups || [];
}

async function renderReminders(el) {
  await loadReminderGroups();
  var params = new URLSearchParams();
  if (showDoneReminders) params.set('include_done', 'true');
  if (reminderFilterGroup && reminderFilterGroup !== '__all__' && reminderFilterGroup !== '__none__') {
    params.set('group', reminderFilterGroup);
  }
  var data = await api('GET', '/api/reminders?' + params.toString());
  var reminders = data.reminders || [];
  if (reminderFilterGroup === '__none__') {
    reminders = reminders.filter(function(r) { return !r.group_name; });
  }
  var today = new Date().toISOString().slice(0, 10);

  // Group datalist
  var groupOpts = '';
  for (var gi = 0; gi < reminderGroups.length; gi++) {
    groupOpts += '<option value="' + esc(reminderGroups[gi]) + '">';
  }

  // Filter dropdown
  var filterOpts = '<option value="__all__"' + (reminderFilterGroup === '__all__' ? ' selected' : '') + '>All projects</option>';
  filterOpts += '<option value="__none__"' + (reminderFilterGroup === '__none__' ? ' selected' : '') + '>General only</option>';
  for (var fi = 0; fi < reminderGroups.length; fi++) {
    var fg = reminderGroups[fi];
    filterOpts += '<option value="' + esc(fg) + '"' + (reminderFilterGroup === fg ? ' selected' : '') + '>' + esc(fg) + '</option>';
  }

  // Add reminder form
  var html = '<div id="add-reminder-form" style="display:none;background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:16px;margin-bottom:16px">' +
    '<div class="field-grid">' +
      '<div class="field full"><label>Reminder text</label><input type="text" id="rem-text" placeholder="What to remember..." spellcheck="false"/></div>' +
      '<div class="field"><label>Due date (optional)</label><input type="date" id="rem-date" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/></div>' +
      '<div class="field"><label>Project (optional)</label><input type="text" id="rem-group" list="rem-groups-dl" placeholder="e.g. NorV, Pol I..." style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/>' +
        '<datalist id="rem-groups-dl">' + groupOpts + '</datalist></div>' +
    '</div>' +
    '<div class="save-row"><button class="btn" onclick="closeReminderForm()">Cancel</button><button class="btn primary" onclick="submitReminder()">Add reminder</button></div>' +
  '</div>';

  // Filter bar
  html += '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:12px">';
  html += '<select onchange="filterReminderGroup(this.value)" style="font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);font-family:var(--sans)">' + filterOpts + '</select>';
  html += '<label style="font-size:11px;color:var(--dim);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" ' + (showDoneReminders ? 'checked' : '') + ' onchange="toggleShowDone(this.checked)"> show done</label>';
  html += '</div>';

  // Group and render
  if (!reminders.length) {
    html += '<div class="empty"><big>&#128276;</big>No reminders' + (reminderFilterGroup !== '__all__' ? ' for this filter' : '') + '</div>';
  } else {
    var grouped = {};
    var general = [];
    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      if (r.group_name) {
        if (!grouped[r.group_name]) grouped[r.group_name] = [];
        grouped[r.group_name].push(r);
      } else {
        general.push(r);
      }
    }
    var groupKeys = Object.keys(grouped).sort();

    if (reminderFilterGroup !== '__all__' && reminderFilterGroup !== '__none__') {
      html += renderReminderList(reminders, today);
    } else {
      for (var ki = 0; ki < groupKeys.length; ki++) {
        html += renderReminderSection(groupKeys[ki], grouped[groupKeys[ki]], today, false);
      }
      if (general.length > 0) {
        html += renderReminderSection('General', general, today, true);
      }
    }
  }

  el.innerHTML = html;
}

function renderReminderSection(title, items, today, isGeneral) {
  var color = isGeneral ? 'var(--dim)' : 'var(--accent)';
  var s = '<div style="margin-bottom:16px">';
  s += '<div style="font-variant:small-caps;font-size:11px;letter-spacing:.1em;color:' + color + ';padding:4px 0;border-bottom:1.5px solid var(--border);margin-bottom:2px;display:flex;justify-content:space-between">';
  s += '<span>' + esc(title) + '</span>';
  s += '<span style="font-variant:normal;font-size:10px;color:var(--dim);letter-spacing:0">' + items.length + '</span>';
  s += '</div>';
  s += renderReminderList(items, today);
  s += '</div>';
  return s;
}

function renderReminderList(items, today) {
  return items.map(function(r) {
    var due = r.due_date;
    var dueClass = 'future', dueText = '';
    if (due) {
      if (due < today) { dueClass = 'overdue'; dueText = 'Overdue: ' + due; }
      else if (due === today) { dueClass = 'today'; dueText = 'Due today'; }
      else { dueClass = 'future'; dueText = 'Due: ' + due; }
    }

    var isBlocked = r.blocked && !r.done;
    var isPipeline = !!r.pipeline_step_id;

    // Badges
    var badges = '';
    if (r.group_name) {
      badges += '<span style="font-size:10px;background:var(--surface2);color:var(--accent);padding:1px 6px;border-radius:3px;margin-left:6px;font-family:var(--sans)">' + esc(r.group_name) + '</span>';
    }
    if (isPipeline) {
      badges += '<span style="font-size:10px;background:#e8e2d8;color:#8a7f72;padding:1px 6px;border-radius:3px;margin-left:4px" title="Linked to pipeline step">&#9741;</span>';
    }

    // Blocked indicator
    var blockedHtml = '';
    if (isBlocked && r.blocked_by && r.blocked_by.length > 0) {
      blockedHtml = '<div style="font-size:10px;color:#c0796a;font-family:var(--mono);margin-top:2px">&#9208; waiting on: ' + r.blocked_by.map(function(b) { return esc(b); }).join(', ') + '</div>';
    }

    var itemStyle = isBlocked ? 'opacity:.55;' : '';
    var doneClass = r.done ? ' done-reminder' : '';

    return '<div class="reminder-item' + doneClass + '" style="' + itemStyle + '">' +
      '<div class="reminder-check" onclick="toggleReminder(' + r.id + ',' + r.done + ',' + (isBlocked ? 'true' : 'false') + ')">' + (r.done ? '&#10003;' : (isBlocked ? '&#9208;' : '')) + '</div>' +
      '<div style="flex:1">' +
        '<div class="reminder-text">' + esc(r.text) + badges + '</div>' +
        (dueText ? '<div class="reminder-due ' + dueClass + '">' + esc(dueText) + '</div>' : '') +
        blockedHtml +
        (r.source && r.source !== 'manual' && r.source !== 'pipeline' ? '<div style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-top:2px">from: ' + esc(r.source) + '</div>' : '') +
      '</div>' +
      '<button class="btn" style="padding:2px 8px;font-size:12px" onclick="editReminderPrompt(' + r.id + ')" title="Edit">&#9998;</button>' +
      '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteReminder(' + r.id + ')">&#215;</button>' +
    '</div>';
  }).join('');
}

function closeReminderForm() { document.getElementById('add-reminder-form').style.display = 'none'; }
function showAddReminder() {
  document.getElementById('add-reminder-form').style.display = 'block';
  document.getElementById('rem-text')?.focus();
}

async function submitReminder() {
  var text = document.getElementById('rem-text')?.value.trim();
  var date = document.getElementById('rem-date')?.value || null;
  var group = document.getElementById('rem-group')?.value.trim() || null;
  if (!text) { toast('Add some text', true); return; }
  await api('POST', '/api/reminders', { text: text, due_date: date, source: 'manual', group_name: group });
  document.getElementById('add-reminder-form').style.display = 'none';
  document.getElementById('rem-text').value = '';
  document.getElementById('rem-group').value = '';
  await load(); toast('Reminder added');
}

async function toggleReminder(id, done, blocked) {
  if (blocked && !done) {
    toast('Blocked — finish upstream steps first', true);
    return;
  }
  var res = await api('PUT', '/api/reminders/' + id, { done: !done });
  if (res.workflow_created) {
    toast('Added to ' + res.group_name + ' workflow');
  }
  await load();
}

async function deleteReminder(id) {
  if (!confirm('Delete this reminder?')) return;
  await api('DELETE', '/api/reminders/' + id); await load();
}

function editReminderPrompt(id) {
  api('GET', '/api/reminders?include_done=true').then(function(data) {
    var reminders = data.reminders || [];
    var r = null;
    for (var i = 0; i < reminders.length; i++) {
      if (reminders[i].id === id) { r = reminders[i]; break; }
    }
    if (!r) return;
    showEditReminderModal(r);
  });
}

function showEditReminderModal(r) {
  var groupOpts = '';
  for (var i = 0; i < reminderGroups.length; i++) {
    groupOpts += '<option value="' + esc(reminderGroups[i]) + '">';
  }

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(60,52,42,.35);display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  var modal = document.createElement('div');
  modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;width:380px;max-width:90vw';
  modal.onclick = function(e) { e.stopPropagation(); };

  var safeText = esc(r.text).replace(/"/g, '&quot;');
  var safeGroup = esc(r.group_name || '').replace(/"/g, '&quot;');
  var pipelineNote = r.pipeline_step_id
    ? '<div style="font-size:11px;color:#8a7f72;margin-bottom:10px;font-family:var(--mono)">&#9741; linked to pipeline step #' + r.pipeline_step_id + '</div>'
    : '';

  modal.innerHTML =
    '<div style="font-variant:small-caps;font-size:11px;letter-spacing:.1em;color:var(--dim);margin-bottom:14px">edit reminder</div>' +
    pipelineNote +
    '<div class="field-grid">' +
      '<div class="field full"><label>Text</label><input type="text" id="edit-rem-text" value="' + safeText + '" spellcheck="false"/></div>' +
      '<div class="field"><label>Due date</label><input type="date" id="edit-rem-date" value="' + (r.due_date || '') + '" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/></div>' +
      '<div class="field"><label>Project</label><input type="text" id="edit-rem-group" list="edit-groups-dl" value="' + safeGroup + '" placeholder="Optional" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/>' +
        '<datalist id="edit-groups-dl">' + groupOpts + '</datalist></div>' +
    '</div>' +
    '<div class="save-row">' +
      '<button class="btn" id="edit-rem-cancel">Cancel</button>' +
      '<button class="btn primary" id="edit-rem-save">Save</button>' +
    '</div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('edit-rem-cancel').onclick = function() { overlay.remove(); };
  document.getElementById('edit-rem-save').onclick = async function() {
    await api('PUT', '/api/reminders/' + r.id, {
      text: document.getElementById('edit-rem-text').value.trim(),
      due_date: document.getElementById('edit-rem-date').value || null,
      group_name: document.getElementById('edit-rem-group').value.trim() || null
    });
    overlay.remove();
    toast('Updated');
    await load();
  };
}

function filterReminderGroup(val) {
  reminderFilterGroup = val;
  load();
}

function toggleShowDone(val) {
  showDoneReminders = val;
  load();
}

registerView('reminders', renderReminders);
