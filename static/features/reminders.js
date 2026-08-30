// ── REMINDERS ─────────────────────────────────────────────────────────────────
let reminderGroups = [];
let reminderFilterGroup = '__all__';
let showDoneReminders = false;

// Bulk-mode state for the composer's quick-date buttons. When set to
// 'this_week' or 'next_week', submitReminder loops and posts one
// reminder per day of that week. 'today' / 'tomorrow' / 'next_mon' /
// 'custom' all resolve to a single date via _remComputeDates.
let _remBulkMode = 'today';

// LocalStorage key + slot cache for the notification poller. See
// _remindersCheckAndNotify. Timestamp of the most recent slot for which
// we've shown the pop-up, stored as ISO string. Persists across reloads
// so the modal doesn't re-fire the moment you refresh the page after
// dismissing it.
const _REM_LAST_NOTIFY_KEY = '_lab_reminders_last_notify_ts';

// Scheduled pop-up slots (24h clock, local time). User asked for
// "every 6 hours from 7am". Adjust here if the pattern changes.
const _REM_NOTIFY_SLOTS = [7, 13, 19];

// ── date helpers ──────────────────────────────────────────────────────────
function _remIso(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function _remAdd(d, n) {
  var out = new Date(d.getTime());
  out.setDate(out.getDate() + n);
  return out;
}
// The Monday strictly after `d`. If d IS a Monday, returns d + 7.
function _remNextMon(d) {
  var day = d.getDay();       // 0 = Sun, 1 = Mon, ...
  var offset = (day === 1) ? 7 : ((8 - day) % 7);
  if (offset === 0) offset = 7;
  return _remAdd(d, offset);
}
// The Monday of the week containing d (this week's Monday).
function _remMondayOf(d) {
  var day = d.getDay();
  var offset = (day === 0) ? -6 : (1 - day);  // Sunday counts as end-of-week
  return _remAdd(d, offset);
}

// Resolve the current bulk mode into a list of ISO date strings. For
// single modes returns one; for 'this_week' / 'next_week' returns 7.
// 'custom' reads the raw date input.
function _remComputeDates(mode) {
  var now = new Date();
  if (mode === 'custom') {
    var v = document.getElementById('rem-date').value;
    return v ? [v] : [];
  }
  if (mode === 'today')     return [_remIso(now)];
  if (mode === 'tomorrow')  return [_remIso(_remAdd(now, 1))];
  if (mode === 'next_mon')  return [_remIso(_remNextMon(now))];
  if (mode === 'this_week' || mode === 'next_week') {
    var start = (mode === 'this_week') ? _remMondayOf(now) : _remNextMon(now);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(_remIso(_remAdd(start, i)));
    return out;
  }
  return [];
}

// Called from the quick buttons and from the raw date input's onchange.
// Updates the bulk-mode state, syncs the date field to reflect the
// current choice, highlights the active button, and shows a hint below.
function _remSetQuick(mode) {
  _remBulkMode = mode;
  var dates = _remComputeDates(mode);
  var dateEl = document.getElementById('rem-date');
  if (dateEl && mode !== 'custom' && dates.length === 1) {
    dateEl.value = dates[0];
  }
  // Highlight the active button
  document.querySelectorAll('.rem-quick').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-mode') === mode);
  });
  // Hint below the row
  var hint = document.getElementById('rem-bulk-hint');
  if (hint) {
    if (dates.length === 0) {
      hint.textContent = 'Pick a date or a quick option.';
    } else if (dates.length === 1) {
      hint.textContent = 'One reminder on ' + dates[0] + '.';
    } else {
      hint.textContent = dates.length + ' reminders — one per day from ' +
                         dates[0] + ' to ' + dates[dates.length - 1] + '.';
    }
  }
}

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

  // Always-visible reminder composer at the top. Landing on the Reminders
  // view now shows a ready-to-type input rather than a "click to expand"
  // button — user asked for this specifically. The date field is a plain
  // <input type="date"> plus a row of quick-set buttons (Today, Tomorrow,
  // Mon, This week, Next week) that either fill the single-date field or
  // switch to bulk mode.
  //
  // The 'This week' / 'Next week' buttons put us into bulk mode: on
  // submit, we POST one reminder per day of the target week. Bulk mode
  // is tracked in the module var _remBulkMode ('none' | 'this_week' |
  // 'next_week').
  var todayIso = _remIso(new Date());
  var tomorrowIso = _remIso(_remAdd(new Date(), 1));
  var nextMonIso = _remIso(_remNextMon(new Date()));
  var html = '<div class="rem-composer" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
      '<input type="text" id="rem-text" placeholder="What to remember..." spellcheck="false" style="flex:1;min-width:200px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:4px;outline:none;font-family:var(--sans);font-size:14px" onkeydown="if(event.key===\'Enter\')submitReminder()"/>' +
      '<input type="text" id="rem-group" list="rem-groups-dl" placeholder="Project (optional)" style="width:160px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/>' +
      '<datalist id="rem-groups-dl">' + groupOpts + '</datalist>' +
      '<button class="btn primary" onclick="submitReminder()" style="padding:8px 16px">Add</button>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<span style="font-size:11px;color:var(--dim);margin-right:4px">When:</span>' +
      '<button class="rem-quick" data-mode="today"     onclick="_remSetQuick(\'today\')">Today</button>' +
      '<button class="rem-quick" data-mode="tomorrow"  onclick="_remSetQuick(\'tomorrow\')">Tomorrow</button>' +
      '<button class="rem-quick" data-mode="next_mon"  onclick="_remSetQuick(\'next_mon\')">Next Mon</button>' +
      '<button class="rem-quick" data-mode="this_week" onclick="_remSetQuick(\'this_week\')">Every day this week</button>' +
      '<button class="rem-quick" data-mode="next_week" onclick="_remSetQuick(\'next_week\')">Every day next week</button>' +
      '<input type="date" id="rem-date" value="" onchange="_remSetQuick(\'custom\')" style="margin-left:8px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:4px;outline:none;font-family:var(--sans);font-size:12px"/>' +
    '</div>' +
    '<div id="rem-bulk-hint" style="font-size:11px;color:var(--dim);margin-top:6px;min-height:14px"></div>' +
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
  // After render: seed the quick-mode state (defaults to 'today') so
  // the button gets highlighted and the hint text is populated, and
  // put focus in the text field so the user can start typing immediately.
  _remSetQuick(_remBulkMode);
  setTimeout(function() {
    var t = document.getElementById('rem-text');
    if (t) t.focus();
  }, 0);
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
      // Papers references button — attaches papers to this reminder.
      // Guarded so reminders still work if the papers feature is disabled.
      '<button class="btn" style="padding:2px 8px;font-size:12px" onclick="openReminderRefs(' + r.id + ',this)" title="References">&#128206;</button>' +
      '<button class="btn" style="padding:2px 8px;font-size:12px" onclick="editReminderPrompt(' + r.id + ')" title="Edit">&#9998;</button>' +
      '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteReminder(' + r.id + ')">&#215;</button>' +
    '</div>';
  }).join('');
}

// Open a modal listing papers attached to this reminder + letting the user
// add/remove. Falls back to a toast if the papers feature isn't loaded.
function openReminderRefs(reminderId, btn) {
  if (typeof window.papersOpenRefsModal !== 'function') {
    toast('Papers feature is not available', true);
    return;
  }
  // Use the containing row's reminder-text as the modal title (best-effort).
  var titleText = '';
  var row = btn && btn.closest('.reminder-item');
  if (row) {
    var t = row.querySelector('.reminder-text');
    if (t) {
      titleText = t.textContent.trim();
      // Trim the group_name badge text off the end if present — it's inside
      // the same .reminder-text and would appear duplicated in the title.
      if (titleText.length > 60) titleText = titleText.slice(0, 57) + '…';
    }
  }
  window.papersOpenRefsModal('reminder', String(reminderId), titleText);
}

async function submitReminder() {
  var textEl = document.getElementById('rem-text');
  var text = textEl ? textEl.value.trim() : '';
  var group = document.getElementById('rem-group')?.value.trim() || null;
  if (!text) { toast('Add some text', true); return; }

  // Resolve dates from the current bulk mode. Empty list means no date
  // picked and no quick option — post one dateless reminder.
  var dates = _remComputeDates(_remBulkMode);
  if (dates.length === 0) dates = [null];

  try {
    if (dates.length === 1) {
      await api('POST', '/api/reminders', {
        text: text, due_date: dates[0], source: 'manual', group_name: group
      });
      toast('Reminder added');
    } else {
      // Bulk: one POST per date. Small N (max 7), sequential is fine and
      // avoids any race on the same table.
      for (var i = 0; i < dates.length; i++) {
        await api('POST', '/api/reminders', {
          text: text, due_date: dates[i], source: 'manual', group_name: group
        });
      }
      toast(dates.length + ' reminders added');
    }
  } catch (e) {
    toast('Add failed: ' + (e.message || e), true);
    return;
  }

  // Reset composer for the next entry but leave the bulk-mode/date
  // selection as-is — user often adds several with the same schedule.
  textEl.value = '';
  textEl.focus();
  await load();
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
      '<div class="field"><label>Project</label><input type="text" id="edit-rem-group" list="global-projects" value="' + safeGroup + '" placeholder="Optional" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/>' +
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

// ── notifications ──────────────────────────────────────────────────────────
// Two channels: an in-app modal that always fires (works while the site
// is open, even if reminders isn't the current view) and a browser
// Notification (best-effort — requires permission, works even when tab
// is backgrounded).
//
// Firing rules:
//   1. On site load, IF the current time is past today's most recent
//      slot (7am/1pm/7pm) AND we haven't already notified for that
//      slot, fire.
//   2. Every minute a poller re-checks the same condition — this
//      catches the boundary crossings during a long session.
//
// The "most recent slot" logic: at 08:00 the slot is today 07:00. At
// 13:30 the slot is today 13:00. At 06:00 the slot is yesterday 19:00.
// We store the ISO of the slot we last fired against, so reload doesn't
// re-fire and we advance cleanly at each boundary.

function _remMostRecentSlot(now) {
  // Returns a Date object for the most recent scheduled slot <= now.
  // If we're before today's first slot, returns yesterday's LAST slot.
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (var i = _REM_NOTIFY_SLOTS.length - 1; i >= 0; i--) {
    var candidate = new Date(today.getTime());
    candidate.setHours(_REM_NOTIFY_SLOTS[i], 0, 0, 0);
    if (candidate <= now) return candidate;
  }
  // Before today's earliest slot — reach back to yesterday's last one.
  var yesterday = _remAdd(today, -1);
  yesterday.setHours(_REM_NOTIFY_SLOTS[_REM_NOTIFY_SLOTS.length - 1], 0, 0, 0);
  return yesterday;
}

async function _remindersCheckAndNotify() {
  var now = new Date();
  var slot = _remMostRecentSlot(now);
  var slotIso = slot.toISOString();
  // Have we already notified for this slot?
  var lastIso;
  try { lastIso = localStorage.getItem(_REM_LAST_NOTIFY_KEY); } catch (e) { lastIso = null; }
  if (lastIso && lastIso >= slotIso) return;  // already notified this slot

  // Fetch reminders and filter to due-today + overdue + not-done.
  var todayIso = _remIso(now);
  var payload;
  try {
    payload = await api('GET', '/api/reminders');
  } catch (e) { return; }  // silent — network trouble shouldn't spam

  var items = (payload.reminders || []).filter(function(r) {
    if (r.done) return false;
    if (!r.due_date) return false;
    return r.due_date <= todayIso;  // today or earlier = due
  });

  if (!items.length) {
    // Mark this slot as "handled" so we don't check again until next slot.
    // Empty case still counts as handled: user has an empty list, no
    // need to poll again for hours.
    try { localStorage.setItem(_REM_LAST_NOTIFY_KEY, slotIso); } catch (e) {}
    return;
  }

  _remShowNotifyModal(items);
  _remFireBrowserNotification(items);
  try { localStorage.setItem(_REM_LAST_NOTIFY_KEY, slotIso); } catch (e) {}
}

function _remShowNotifyModal(items) {
  // If a modal already exists, don't stack. Just skip.
  if (document.getElementById('rem-notify-modal')) return;

  var overdue = items.filter(function(r) { return r.due_date < _remIso(new Date()); });
  var today = items.filter(function(r) { return r.due_date === _remIso(new Date()); });

  var listHtml = '';
  function renderGroup(label, group) {
    if (!group.length) return '';
    var h = '<div class="rem-notify-group-label">' + label + '</div>';
    group.forEach(function(r) {
      h += '<div class="rem-notify-item" data-id="' + r.id + '">' +
        '<input type="checkbox" onchange="_remindersNotifyToggle(' + r.id + ', this.checked)"/>' +
        '<span>' + esc(r.text) + '</span>' +
        (r.group_name ? '<span class="rem-notify-badge">' + esc(r.group_name) + '</span>' : '') +
      '</div>';
    });
    return h;
  }
  listHtml += renderGroup('Overdue', overdue);
  listHtml += renderGroup('Due today', today);

  var modal = document.createElement('div');
  modal.id = 'rem-notify-modal';
  modal.className = 'rem-notify-backdrop';
  modal.innerHTML =
    '<div class="rem-notify-card">' +
      '<div class="rem-notify-header">' +
        '<h3>&#128276; ' + items.length + ' reminder' + (items.length === 1 ? '' : 's') + '</h3>' +
        '<button onclick="_remindersNotifyDismiss()" title="Dismiss">&times;</button>' +
      '</div>' +
      '<div class="rem-notify-body">' + listHtml + '</div>' +
      '<div class="rem-notify-footer">' +
        '<button class="btn" onclick="_remindersNotifyDismiss()">Dismiss</button>' +
        '<button class="btn primary" onclick="setView(\'reminders\');_remindersNotifyDismiss()">Open reminders</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

function _remindersNotifyDismiss() {
  var m = document.getElementById('rem-notify-modal');
  if (m) m.remove();
}

async function _remindersNotifyToggle(id, done) {
  // Mark done inline from the modal without navigating away. Silent on
  // failure — user can retry from the main view.
  try {
    await api('PUT', '/api/reminders/' + id, { done: !!done });
    var item = document.querySelector('#rem-notify-modal .rem-notify-item[data-id="' + id + '"]');
    if (item) item.classList.toggle('done', !!done);
    // If they check off the last visible one, close the modal.
    var remaining = document.querySelectorAll('#rem-notify-modal .rem-notify-item:not(.done)');
    if (remaining.length === 0) _remindersNotifyDismiss();
  } catch (e) {
    toast('Update failed', true);
  }
}

function _remFireBrowserNotification(items) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    _remDoBrowserNotify(items);
  } else if (Notification.permission !== 'denied') {
    // Ask for permission. If granted, fire immediately.
    Notification.requestPermission().then(function(perm) {
      if (perm === 'granted') _remDoBrowserNotify(items);
    });
  }
}

function _remDoBrowserNotify(items) {
  var title = items.length + ' reminder' + (items.length === 1 ? '' : 's') + ' due';
  var body = items.slice(0, 3).map(function(r) { return r.text; }).join(' \u00b7 ');
  if (items.length > 3) body += ' \u00b7 +' + (items.length - 3) + ' more';
  var n = new Notification(title, {
    body: body,
    tag: 'lab-notes-reminders',  // replaces any prior notification, no stacking
    icon: '/static/favicon.svg',
  });
  n.onclick = function() {
    try { window.focus(); } catch (e) {}
    setView('reminders');
    n.close();
  };
}

// ── boot hook + poller ──────────────────────────────────────────────────
// Runs at module load (bundled scripts execute at page load). Kicks off
// an initial check + a 60s poller. The poller is cheap: a localStorage
// read and a fetch only when a slot boundary is crossed.
(function _remindersBootstrap() {
  // Initial check on next tick — gives core.js a moment to finish loading
  // settings and setting up S, so api() calls have any needed context.
  setTimeout(_remindersCheckAndNotify, 1500);
  // Poll every minute
  setInterval(_remindersCheckAndNotify, 60 * 1000);
})();

// CSS for the composer quick buttons + notification modal.
(function _remInjectStyles() {
  var css = [
    '.rem-quick{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:14px;cursor:pointer;font-size:12px;font-family:var(--sans)}',
    '.rem-quick:hover{border-color:var(--accent)}',
    '.rem-quick.active{background:var(--accent);color:#fff;border-color:var(--accent)}',
    '.rem-notify-backdrop{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999}',
    '.rem-notify-card{background:var(--bg);border:1px solid var(--border);border-radius:8px;width:min(480px,90vw);max-height:80vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,.3)}',
    '.rem-notify-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}',
    '.rem-notify-header h3{margin:0;font-size:16px;font-weight:600}',
    '.rem-notify-header button{background:none;border:none;font-size:22px;cursor:pointer;color:var(--dim);padding:0 4px}',
    '.rem-notify-body{padding:12px 16px}',
    '.rem-notify-group-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin:8px 0 4px;font-weight:600}',
    '.rem-notify-item{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px}',
    '.rem-notify-item.done{opacity:.5;text-decoration:line-through}',
    '.rem-notify-badge{font-size:10px;background:var(--surface2);color:var(--accent);padding:1px 6px;border-radius:3px;margin-left:auto}',
    '.rem-notify-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}',
  ].join('');
  var s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
})();
