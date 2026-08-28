// ── DAILY WORKFLOW ───────────────────────────────────────────────────────────
var _workflowDate = new Date().toISOString().slice(0, 10);
var _wfNotebookGroups = [];    // cached from /api/entries
var _wfSubgroupMap = {};       // {group: {subgroup: true}}
var _wfProcessJobId = null;    // active process-day job ID
var _wfPollTimer = null;       // polling interval handle

/* ── Read/Write mode state ────────────────────────────────────────────────
   Write mode is the existing single-day editor. Read mode is a scrolling
   book of past days (newest at top), 30-day windows, print-to-PDF as backup.
   Switching modes calls loadView() which re-runs renderWorkflow, which
   branches on _workflowMode at the top. */
var _workflowMode = 'write';   // 'write' | 'read'
var _readWindowEnd = new Date().toISOString().slice(0, 10);  // ISO date; newest day in the window
var _readWindowDays = 30;      // window size

/* ── Active project selector ────────────────────────────────────────────────
   Sticky dropdown at the top of Write mode. When set, every newly-created
   empty block (Enter at end of a block, or first empty <p> at doc start) gets
   `data-groups="<project>"` automatically. Existing blocks are never touched
   — user's rule: "existing blocks should stay as they were, new blocks
   should be the new project until changed".
   Persisted in localStorage so it survives page reload / mode switch. */
var _wfActiveProject = null;         // string project name, or null = untagged
var _wfKnownProjects = [];           // [{name, day_count}, ...] from /api/workflow/projects

// ── Chip auto-insert idle tracker ───────────────────────────────────────────
// Timestamp of the user's last content-producing keydown (character keys,
// Backspace/Delete). Enter and pure modifier keys DON'T update this — Enter
// is what we're gating on, and modifier-only presses aren't "activity".
//
// The Enter handler compares (now - _wfLastActivityAt) against the user's
// configured wf_chip_idle_minutes threshold. If below threshold → user was
// recently active, don't stamp another chip. If above → insert chip and
// bump _wfLastActivityAt so the next Enter doesn't immediately re-stamp.
//
// Initial value = load time so the first Enter after loading the app
// (probably a while after last real activity, since docs aren't edited
// while the app is closed) will get a chip.
var _wfLastActivityAt = Date.now();

// Keys that DON'T count as "activity" for the idle tracker. Enter is what
// we gate on; modifiers/nav don't produce content; F-keys and Escape are
// meta. Backspace/Delete are intentionally NOT here — deleting is
// activity.
var _WF_NON_ACTIVITY_KEYS = {
  Enter: 1, Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1,
  ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  Tab: 1, Escape: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1,
  F1: 1, F2: 1, F3: 1, F4: 1, F5: 1, F6: 1, F7: 1, F8: 1, F9: 1, F10: 1, F11: 1, F12: 1
};

// Fire-and-forget log to /api/time-events so the chip shows up in hours
// copy-from-workflow immediately, without waiting for the debounced doc
// save. Deduped on read against the live-parsed chip from the doc HTML,
// so no double-count.
function _wfLogChipEvent(dateIso, hh, mm, followingText) {
  var ts = dateIso + 'T' + hh + ':' + mm + ':00';
  fetch('/api/time-events/log', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      ts_iso: ts,
      event_type: 'workflow_chip',
      source_type: 'workflow_day',
      source_id: dateIso,
      content: (followingText || '').substring(0, 500)
    })
  }).catch(function() { /* silent — save+reparse will catch it later */ });
}

function _wfGetActiveProject() {
  if (_wfActiveProject !== null) return _wfActiveProject;
  try { _wfActiveProject = localStorage.getItem('wf-active-project') || ''; }
  catch (e) { _wfActiveProject = ''; }
  return _wfActiveProject;
}

function _wfSetActiveProject(name) {
  _wfActiveProject = (name || '').trim();
  try { localStorage.setItem('wf-active-project', _wfActiveProject); } catch (e) {}
  // Repaint the button label without a full re-render
  var btn = document.getElementById('wf-active-project-btn');
  if (btn) btn.innerHTML = _wfActiveProjectBtnLabel();
}

function _wfActiveProjectBtnLabel() {
  var p = _wfGetActiveProject();
  if (!p) return '&#127991; No project &#9662;';
  return '&#127991; ' + esc(p) + ' &#9662;';
}

async function _wfLoadKnownProjects() {
  try {
    var d = await api('GET', '/api/projects');
    _wfKnownProjects = d.projects || [];
    _wfInjectProjectColorCss();
  } catch (e) { _wfKnownProjects = []; }
}


function _wfProjectHue(name) {
  /* djb2 string hash → 0..359 hue. MUST match the server's _hash_hue so a
     block rendered server-side (PDFs) picks the same colour as the browser. */
  var h = 5381;
  for (var i = 0; i < name.length; i++) {
    h = (h * 33 + name.charCodeAt(i)) >>> 0;  // keep as unsigned 32-bit
  }
  return h % 360;
}


function _wfInjectProjectColorCss() {
  /* Generate one CSS block per project with per-project HSL colours and
     append it to <head>. Called after loading projects, before rendering
     blocks. Uses attribute selectors covering all four positions
     (exact / first / last / middle) since data-groups is comma-separated
     — a substring match would false-positive across similar project names
     like `pMR15` and `MR15`. */
  var styleEl = document.getElementById('wf-project-colors');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'wf-project-colors';
    document.head.appendChild(styleEl);
  }
  var rules = [];
  _wfKnownProjects.forEach(function(p) {
    if (!p.name) return;
    var nameEsc = p.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var selectors = [
      '[data-groups="' + nameEsc + '"]',
      '[data-groups^="' + nameEsc + ',"]',
      '[data-groups$=",' + nameEsc + '"]',
      '[data-groups*=",' + nameEsc + ',"]',
    ].join(', ');
    var primary, tint, pillBg, pillFg, pillBorder;
    if (p.color_override) {
      /* Explicit override: use it directly for the border. Tint via a fixed
         5% alpha derivation. Pill uses the override tinted lighter. */
      primary = p.color_override;
      tint    = p.color_override + '10';  /* naïve alpha via hex — works for #RRGGBB */
      pillBg  = p.color_override + '22';
      pillFg  = p.color_override;
      pillBorder = p.color_override;
    } else {
      var hue = (p.hue != null) ? p.hue : _wfProjectHue(p.name);
      primary    = 'hsl('  + hue + ', 42%, 42%)';
      tint       = 'hsla(' + hue + ', 42%, 42%, 0.06)';
      pillBg     = 'hsl('  + hue + ', 45%, 90%)';
      pillFg     = 'hsl('  + hue + ', 55%, 25%)';
      pillBorder = 'hsl('  + hue + ', 42%, 55%)';
    }
    rules.push(
      selectors + ' {' +
        ' --wf-tag-primary: ' + primary + ';' +
        ' --wf-tag-tint: '    + tint    + ';' +
        ' --wf-tag-pill-bg: ' + pillBg  + ';' +
        ' --wf-tag-pill-fg: ' + pillFg  + ';' +
        ' --wf-tag-pill-border: ' + pillBorder + ';' +
      ' }'
    );
  });
  styleEl.textContent = rules.join('\n');
}

function _wfOpenProjectPicker(anchorEl) {
  // Close any existing picker
  var existing = document.getElementById('wf-proj-pop');
  if (existing) { existing.remove(); return; }

  var pop = document.createElement('div');
  pop.id = 'wf-proj-pop';
  pop.className = 'wf-proj-pop';
  var r = anchorEl.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.left = (window.scrollX + r.left) + 'px';
  pop.style.zIndex = 1200;

  var current = _wfGetActiveProject();
  var h = '<div class="wf-proj-head">Auto-tag new blocks with:</div>';
  h += '<div class="wf-proj-list">';
  h += '<div class="wf-proj-item' + (current === '' ? ' wf-proj-selected' : '') + '" data-name="">' +
       '<span style="color:#8a7f72">&mdash; None (leave blocks untagged) &mdash;</span></div>';
  _wfKnownProjects.forEach(function(p) {
    var selCls = (p.name === current) ? ' wf-proj-selected' : '';
    var color;
    if (p.color_override) {
      color = p.color_override;
    } else {
      var hue = (p.hue != null) ? p.hue : _wfProjectHue(p.name);
      color = 'hsl(' + hue + ', 42%, 55%)';
    }
    /* Compute a hex value the native <input type="color"> can accept when
       the user opens the picker on an auto-coloured project. */
    var initialHex;
    if (p.color_override) {
      initialHex = p.color_override;
    } else {
      var hue = (p.hue != null) ? p.hue : _wfProjectHue(p.name);
      initialHex = _wfHslToHex(hue, 42, 55);
    }
    h += '<div class="wf-proj-item' + selCls + '" data-name="' + esc(p.name) + '">' +
         '<label class="wf-proj-swatch-wrap" style="background:' + color + '" ' +
                'title="Click to change colour for \'' + esc(p.name).replace(/'/g, "&#39;") + '\'" ' +
                'onclick="event.stopPropagation()">' +
           '<input type="color" value="' + esc(initialHex) + '" class="wf-proj-swatch-input" ' +
                  'onchange="_wfProjectSetColor(\'' + esc(p.name).replace(/'/g, "\\'") + '\', this.value)">' +
         '</label>' +
         '<span class="wf-proj-name">' + esc(p.name) + '</span>' +
         '<span class="wf-proj-count">' + (p.day_count || 0) + ' day' + (p.day_count === 1 ? '' : 's') + '</span>' +
         '</div>';
  });
  h += '</div>';
  h += '<div class="wf-proj-new">' +
    '<input type="text" id="wf-proj-new-input" placeholder="+ New project&hellip;" ' +
      'onkeydown="if(event.key===\'Enter\'){event.preventDefault();_wfProjectPickerAddNew();}">' +
    '<button class="wf-tool-btn" onclick="_wfProjectPickerAddNew()">Add</button>' +
    '</div>';
  pop.innerHTML = h;
  document.body.appendChild(pop);

  pop.querySelectorAll('.wf-proj-item').forEach(function(item) {
    item.addEventListener('click', function() {
      _wfSetActiveProject(this.dataset.name);
      pop.remove();
      document.removeEventListener('mousedown', outside, { capture: true });
    });
  });

  function outside(e) {
    if (pop.contains(e.target) || anchorEl.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', outside, { capture: true });
  }
  setTimeout(function() {
    document.addEventListener('mousedown', outside, { capture: true });
  }, 0);
}

function _wfProjectPickerAddNew() {
  var inp = document.getElementById('wf-proj-new-input');
  if (!inp) return;
  var name = inp.value.trim();
  if (!name) return;
  /* Register with the projects backend so it becomes globally visible in
     other views (notebook, etc.) and gets a stable colour. Best-effort —
     fall through to local list if the API is down. */
  api('POST', '/api/projects', { name: name })
    .catch(function(e) { console.warn('projects POST failed:', e); })
    .finally(function() {
      var already = _wfKnownProjects.some(function(p) { return p.name === name; });
      if (!already) {
        _wfKnownProjects.push({ name: name, day_count: 0, entry_count: 0,
                                 hue: _wfProjectHue(name), color_override: null });
      }
      _wfInjectProjectColorCss();
      _wfSetActiveProject(name);
      var pop = document.getElementById('wf-proj-pop');
      if (pop) pop.remove();
    });
}

function _wfHslToHex(h, s, l) {
  /* HSL → hex, matching _projMgrHueToRgbHex in projects.js so <input type="color">
     can be pre-filled correctly when opening the swatch on an auto-coloured
     project. Kept small: no error handling — inputs come from our own hash. */
  s = s / 100; l = l / 100;
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2;
  var r, g, b;
  if (h < 60)      { r = c; g = x; b = 0; }
  else if (h < 120){ r = x; g = c; b = 0; }
  else if (h < 180){ r = 0; g = c; b = x; }
  else if (h < 240){ r = 0; g = x; b = c; }
  else if (h < 300){ r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  function hh(v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); }
  return '#' + hh(r) + hh(g) + hh(b);
}


async function _wfProjectSetColor(name, hex) {
  /* Called from the inline colour picker in the workflow project selector.
     Writes the override to /api/projects/{name}, then refreshes local
     caches so the pill / border colours update immediately without a
     page reload. Silent-fail — a broken save just leaves the picker
     open and the old colour visible. */
  try {
    await api('PUT', '/api/projects/' + encodeURIComponent(name),
              { color_override: hex });
    await _wfLoadKnownProjects();
    if (typeof _refreshGlobalProjects === 'function') await _refreshGlobalProjects();
    /* Reopen the popover if it was closed by any auto-hide during the fetch */
    var pop = document.getElementById('wf-proj-pop');
    if (pop) pop.remove();
  } catch (e) { console.warn('colour save failed:', e); }
}


function _wfSwitchMode(mode) {
  if (mode !== 'write' && mode !== 'read') return;
  _workflowMode = mode;
  if (mode === 'read') {
    // Snap the read window to end at whatever day the user was viewing
    _readWindowEnd = _workflowDate;
  } else {
    // Coming back to Write mode — sync the editor to the window's end date
    _workflowDate = _readWindowEnd;
  }
  loadView();
}

function _wfShiftReadWindow(delta) {
  /* delta = number of days to shift. Positive = newer, negative = older.
     Capped at today for the newer end. */
  var dt = new Date(_readWindowEnd + 'T12:00:00');
  dt.setDate(dt.getDate() + delta);
  var today = new Date().toISOString().slice(0, 10);
  var iso = dt.toISOString().slice(0, 10);
  if (iso > today) iso = today;
  _readWindowEnd = iso;
  loadView();
}

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
  if (_workflowMode === 'read') {
    return _wfRenderReadMode(el);
  }
  var data    = await api('GET', '/api/workflow/' + _workflowDate);
  var entries = data.entries || [];
  var today   = new Date().toISOString().slice(0, 10);
  await _loadWfNotebookGroups();
  await _wfLoadKnownProjects();

  var html = '<div class="day-nav">' +
    '<button onclick="shiftDay(-1)">&#8592; Prev</button>' +
    '<div class="day-label"><button class="wf-date-btn" onclick="_wfOpenCalendar(this, \'write\')" title="Jump to a date">' + formatDate(_workflowDate) + ' &#9662;</button></div>' +
    (_workflowDate < today
      ? '<button onclick="shiftDay(1)">Next &#8594;</button>'
      : '<button disabled style="opacity:.3">Next &#8594;</button>') +
    '<button class="btn" onclick="_wfSwitchMode(\'read\')" title="Switch to Read mode (scrolling book of past days)" style="margin-left:10px">&#128218; Read mode</button>' +
    /* Active project selector — sticky dropdown; every NEW empty block gets
       auto-tagged with the selected project. Existing blocks are unchanged. */
    '<button class="btn wf-active-project-btn" id="wf-active-project-btn" ' +
      'onclick="_wfOpenProjectPicker(this)" ' +
      'title="Auto-tag new blocks with this project. Change any time; existing blocks stay tagged as they were." ' +
      'style="margin-left:6px">' + _wfActiveProjectBtnLabel() + '</button>' +
    /* Redact mode toggle — only shown when editing a past day. On today's
       page, no track-changes and no redact concept. */
    (_wfIsPastDay()
      ? '<button class="btn wf-redact-btn" id="wf-redact-btn" ' +
          'onclick="_wfToggleRedactMode()" ' +
          'title="Track-changes is ON by default for past days: deletions become strikethrough (Word-style). Toggle redact mode to make deletions permanent instead (for IP-sensitive content that should not appear in the audit trail)." ' +
          'style="margin-left:6px">' + _wfRedactBtnLabel() + '</button>'
      : '') +
    /* Short date for the button — full date in the title attribute. Two formats
       to keep the button compact: today shows "today", any other day shows
       "6 May" style. */
    (function() {
      var todayStr = new Date().toISOString().slice(0, 10);
      var label;
      if (_workflowDate === todayStr) {
        label = '&#9881; Process today';
      } else {
        var dt = new Date(_workflowDate + 'T00:00:00');
        var short = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        label = '&#9881; Process \u00b7 ' + short;
      }
      return '<button class="btn" id="wf-process-btn" onclick="processWorkflowDay()" ' +
        'title="Send notes for ' + esc(_workflowDate) + ' to the 3090 to format into notebook entries" ' +
        'style="margin-left:10px">' + label + '</button>';
    })() +
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

  /* ── Unified day-document layout ──────────────────────────────────────
     Left column: the editable document.
     Right column: group sidebar (tag current block, show legend, project totals).
     Bottom of left column: the document toolbar.
  */
  html += '<div class="wf-doc-layout">' +
    '<div class="wf-doc-main">' +
      '<div id="wf-doc" data-placeholder="Start typing your day\u2019s notes \u2014 a timestamp will appear on every new line. Tab inserts a table. Paste / drop / + Image for images. Select a block + use the Groups menu to tag it."></div>' +
      '<div class="wf-doc-toolbar">' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.cmd(\'bold\')" title="Bold"><strong>B</strong></button>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.cmd(\'italic\')" title="Italic"><em>I</em></button>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.cmd(\'underline\')" title="Underline"><u>U</u></button>' +
        '<div class="wf-tool-sep"></div>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.cmd(\'insertUnorderedList\')">&bull; List</button>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.insertTable()" title="Insert 2x2 table (or press Tab)">&#9783; Table</button>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.insertImage()">&#128247; Image</button>' +
        '<button class="wf-tool-btn" onclick="_wfDocApi.insertGel()">&#129516; Gel</button>' +
        '<div class="wf-tool-sep"></div>' +
        '<button class="wf-tool-btn" onclick="wfInsertTimeChip()" title="Insert current time (Ctrl+T)">&#128338; Time</button>' +
        '<div class="wf-tool-sep"></div>' +
        '<button class="wf-tool-btn wf-tool-btn-primary" onclick="wfOpenTagPicker()" title="Tag the current block (Ctrl+G)">&#127991; Groups\u2026</button>' +
        '<div style="flex:1"></div>' +
        '<div id="wf-doc-saved" style="font-size:11px;color:#8a7f72">\u00a0</div>' +
      '</div>' +
      '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
        '<div id="wf-proto-picker-wrap">' +
          '<button class="btn" style="color:#5b7a5e;font-size:12px" onclick="wfShowProtoPicker()">&#9654; Run a protocol</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="wf-doc-side">' +
      '<div class="wf-doc-side-h">Groups in this day</div>' +
      '<div id="wf-doc-side-groups" style="min-height:60px"></div>' +
      /* Active protocol runs land here. Refreshed on render, on storage events,
         and when a run is started/completed elsewhere. Stays hidden if no runs. */
      '<div id="wf-doc-side-runs-wrap" style="display:none">' +
        '<div class="wf-doc-side-h" style="margin-top:14px">Active protocol runs</div>' +
        '<div id="wf-doc-side-runs"></div>' +
      '</div>' +
      '<div class="wf-doc-side-h" style="margin-top:14px">Untagged blocks</div>' +
      '<div id="wf-doc-side-untagged" style="font-size:12px;color:#8a7f72"></div>' +
      '<div class="wf-doc-side-help">' +
        'Click a block then <strong>Groups\u2026</strong> to tag it. ' +
        'Untagged content is included as context with every group at end-of-day processing.' +
      '</div>' +
    '</div>' +
  '</div>';

  el.innerHTML = html;
  _wfInjectDocStyles();
  setTimeout(function() {
    var docEl = document.getElementById('wf-doc');
    if (!docEl) return;
    window._wfDocApi = wfEditorAttach(docEl, {
      placeholder: docEl.getAttribute('data-placeholder'),
      minHeight: '280px',
      onChange: function() {
        _wfDocDebouncedSave();
        _wfRefreshSidebar();
      },
      onBlur: function(html) { _wfSaveDoc(html); },
    });
    docEl.addEventListener('keydown', _wfDocKeydownExtras);
    docEl.addEventListener('click', _wfRefreshCurrentBlock);
    docEl.addEventListener('keyup', _wfRefreshCurrentBlock);
    /* If redact mode was toggled on before this render (e.g., user was on
       an older day, clicked Redact ON, then navigated to another past day),
       restore the visual indicator. Reset the flag if we're now on today. */
    if (!_wfIsPastDay()) _wfRedactMode = false;
    if (_wfRedactMode && _wfIsPastDay()) docEl.classList.add('wf-redact-active');
    _wfLoadDoc();
    _wfRefreshActiveRuns();
    /* Listen for cross-tab run state changes (localStorage events fire only in
       OTHER tabs, but spLaunchRunDirect inside this tab updates DOM directly
       and we re-render on every doc save anyway). */
    window.addEventListener('storage', function(e) {
      if (e.key === 'lab_proto_runs') _wfRefreshActiveRuns();
    });
  }, 50);
}

/* ── Doc layout CSS (injected once) ───────────────────────────── */
var _wfDocStylesInjected = false;
function _wfInjectDocStyles() {
  if (_wfDocStylesInjected) return;
  _wfDocStylesInjected = true;
  var s = document.createElement('style');
  s.textContent = [
    '.wf-doc-layout { display:flex; gap:14px; margin-top:8px; align-items:flex-start; }',
    '.wf-doc-main { flex:1; min-width:0; background:var(--surface,#faf8f4); border:1px solid var(--border,#d5cec0); border-radius:6px; padding:12px 14px; }',
    /* Sidebar widens automatically when there are active runs (data-has-runs attr toggled below) */
    '.wf-doc-side { width:240px; flex-shrink:0; background:var(--surface,#faf8f4); border:1px solid var(--border,#d5cec0); border-radius:6px; padding:12px; font-size:12.5px; max-height:calc(100vh - 140px); overflow-y:auto; position:sticky; top:8px; }',
    '.wf-doc-side[data-has-runs="1"] { width:380px; }',
    '.wf-doc-side[data-has-runs="2"] { width:440px; }',
    '.wf-doc-side[data-has-runs="3"] { width:500px; }',
    '.wf-doc-side-h { font-variant:small-caps; font-size:11px; letter-spacing:.08em; color:#8a7f72; font-weight:600; margin-bottom:6px; }',
    '.wf-doc-side-help { margin-top:14px; padding-top:10px; border-top:1px solid #ece7dd; font-size:11px; color:#8a7f72; line-height:1.5; }',
    /* Active-run card in sidebar */
    '.wf-run-card { background:#fff; border:1px solid #d5cec0; border-radius:5px; padding:8px 10px; margin-bottom:8px; }',
    '.wf-run-card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; margin-bottom:4px; }',
    '.wf-run-card-title { font-size:12.5px; font-weight:600; color:#4a4139; line-height:1.25; flex:1; min-width:0; }',
    '.wf-run-card-group { font-size:10px; color:#8a7f72; font-family:"SF Mono",Monaco,Consolas,monospace; margin-top:2px; }',
    '.wf-run-progress-bar { height:3px; background:#ece7dd; border-radius:2px; overflow:hidden; margin:6px 0 4px 0; }',
    '.wf-run-progress-fill { height:100%; background:#5b7a5e; transition:width .2s; }',
    '.wf-run-progress-text { font-size:10.5px; color:#8a7f72; }',
    /* Compact recipe table — read-only summary, no inputs */
    '.wf-run-recipe { margin-top:6px; max-height:200px; overflow:auto; border:1px solid #ece7dd; border-radius:3px; }',
    '.wf-run-recipe table { width:100%; border-collapse:collapse; font-size:11px; }',
    '.wf-run-recipe th { background:#f0ebe3; padding:3px 6px; text-align:left; font-weight:600; color:#8a7f72; border-bottom:1px solid #e0d9cd; position:sticky; top:0; }',
    '.wf-run-recipe td { padding:3px 6px; border-bottom:1px solid #f0ebe3; color:#4a4139; white-space:nowrap; }',
    '.wf-run-recipe tr:last-child td { border-bottom:none; }',
    '.wf-run-resume { background:#5b7a5e; color:#fff; border:none; padding:5px; border-radius:3px; cursor:pointer; font-size:11px; }',
    '.wf-run-resume:hover { background:#4a6b4d; }',
    '.wf-run-finish { background:#faf8f4; color:#5b7a5e; border:1px solid #5b7a5e; padding:5px; border-radius:3px; cursor:pointer; font-size:11px; }',
    '.wf-run-finish:hover { background:#e8f0e8; }',
    '.wf-doc-toolbar { display:flex; gap:4px; align-items:center; flex-wrap:wrap; padding:6px 0 4px 0; margin-top:4px; border-top:1px solid #ece7dd; }',
    '.wf-tool-btn-primary { background:#5b7a5e !important; color:#fff !important; border-color:#5b7a5e !important; }',
    '#wf-doc .wf-block, #wf-doc p[data-groups], #wf-doc table[data-groups], #wf-doc ul[data-groups], #wf-doc ol[data-groups] { padding-left:8px; border-left:3px solid transparent; transition:border-color .15s; }',
    '#wf-doc [data-groups] { border-left-color: var(--wf-tag-primary, #7a9e7e); background: var(--wf-tag-tint, rgba(122,158,126,0.04)); position:relative; margin-top:14px; }',
    '#wf-doc .wf-task-done { border-left-color:#b89a3a; background:rgba(184,154,58,0.06); }',
    '#wf-doc .wf-protocol { border-left-color:#5b7aa0; background:rgba(91,122,160,0.06); }',
    /* Project-tag pill — floats just above the top-right edge of each tagged block.
       Pure CSS via ::after so it doesn't live in the DOM (contenteditable-safe,
       doesn't get copied out when the user selects and copies block text).
       Colours pulled from CSS custom properties set by _wfInjectProjectColorCss,
       with green fallback for untagged / unknown projects. */
    '#wf-doc [data-groups]::after { content: attr(data-groups); position:absolute; top:-9px; right:6px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:10px; line-height:1; color: var(--wf-tag-pill-fg, #3a5a3d); background: var(--wf-tag-pill-bg, #e8f0e8); border:1px solid var(--wf-tag-pill-border, #7a9e7e); padding:2px 8px 3px 8px; border-radius:9px; pointer-events:none; z-index:1; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '#wf-doc .wf-current-block { box-shadow: -3px 0 0 0 #5b7a5e inset; }',
    '.wf-time { display:inline-block; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.8em; padding:1px 6px; background:#f0ebe3; border-radius:3px; color:#8a7f72; user-select:none; margin-right:4px; }',
    '.wf-group-chip { display:inline-block; padding:2px 8px; background:#e8f0e8; color:#3a5a3d; border:1px solid #b5ccb5; border-radius:10px; font-size:11px; margin:2px 3px 2px 0; cursor:pointer; }',
    '.wf-group-chip.active { background:#5b7a5e; color:#fff; border-color:#5b7a5e; }',
    '.wf-tag-modal { position:fixed; inset:0; z-index:1100; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; }',
    '.wf-tag-modal-inner { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:420px; max-width:92vw; padding:14px 16px; }',

    /* ── Date button (opens calendar picker) ─────────────────────────────── */
    '.wf-date-btn { background:transparent; border:1px solid transparent; padding:2px 8px; border-radius:4px; font:inherit; color:inherit; cursor:pointer; }',
    '.wf-date-btn:hover { background:#f0ebe3; border-color:#d5cec0; }',

    /* ── Active project selector button + popover ────────────────────────── */
    '.wf-active-project-btn { background:#e8f0e8; border:1px solid #b5ccb5; color:#4a4139; }',
    '.wf-active-project-btn:hover { background:#d8e5d8; }',
    /* ── Redact-mode button (only on past days) ──────────────────────────── */
    '.wf-redact-btn { background:#f5f0e8; border:1px solid #d5c8b0; color:#4a4139; }',
    '.wf-redact-btn:hover { background:#efe8d8; }',
    /* Editor gets a red-tinged border when redact mode is active, so the user
       can\'t forget they\'re about to make permanent deletions. */
    '#wf-doc.wf-redact-active { border:2px solid #c0392b; background:rgba(192,57,43,0.02); }',
    '#wf-doc.wf-redact-active::before { content: "REDACT MODE \u2014 deletions are permanent"; position:sticky; top:0; display:block; background:#c0392b; color:#fff; padding:2px 8px; font-size:11px; font-family:"SF Mono",Monaco,Consolas,monospace; letter-spacing:.05em; text-align:center; z-index:10; margin:-8px -8px 8px -8px; }',
    /* Track-changes strikethrough in the editor. Uses a slightly muted colour
       to match the print CSS + read-mode rendering. */
    '#wf-doc del, #wf-doc s { color:#8a7f72; text-decoration:line-through; text-decoration-thickness:1px; }',
    '.wf-read-day-body del, .wf-read-day-body s { color:#8a7f72; text-decoration:line-through; text-decoration-thickness:1px; }',
    '.wf-proj-pop { background:#faf8f4; border:1px solid #d5cec0; border-radius:6px; padding:8px 0 6px 0; box-shadow:0 4px 18px rgba(60,52,42,.15); width:280px; max-height:400px; overflow-y:auto; font-size:13px; }',
    '.wf-proj-head { padding:2px 12px 8px 12px; font-size:11px; color:#8a7f72; font-variant:small-caps; letter-spacing:.05em; border-bottom:1px solid #ece7dd; }',
    '.wf-proj-list { padding:4px 0; }',
    '.wf-proj-item { display:flex; align-items:center; gap:8px; padding:5px 12px; cursor:pointer; }',
    '.wf-proj-item:hover { background:#f0ebe3; }',
    '.wf-proj-selected { background:#d8e5d8; }',
    '.wf-proj-selected:hover { background:#c8d8c8; }',
    '.wf-proj-swatch { display:inline-block; width:10px; height:10px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); flex-shrink:0; }',
    /* Interactive colour swatch: <label> is the visible circle; the invisible
       <input type="color"> inside it captures the click and opens the native
       picker. Matches static swatch dimensions but adds cursor + hover-ring. */
    '.wf-proj-swatch-wrap { display:inline-block; width:12px; height:12px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); flex-shrink:0; cursor:pointer; position:relative; transition:box-shadow .1s; }',
    '.wf-proj-swatch-wrap:hover { box-shadow: 0 0 0 2px rgba(122,158,126,0.35); }',
    '.wf-proj-swatch-input { position:absolute; inset:0; opacity:0; width:100%; height:100%; cursor:pointer; padding:0; border:none; }',
    '.wf-proj-name { color:#4a4139; flex:1; }',
    '.wf-proj-count { font-size:11px; color:#8a7f72; }',
    '.wf-proj-new { display:flex; gap:4px; padding:8px 12px 4px 12px; border-top:1px solid #ece7dd; margin-top:4px; }',
    '.wf-proj-new input { flex:1; padding:4px 8px; border:1px solid #d5cec0; border-radius:3px; font-family:inherit; font-size:12px; }',

    /* ── Calendar picker popover ─────────────────────────────────────────── */
    '.wf-cal-pop { background:#faf8f4; border:1px solid #d5cec0; border-radius:6px; padding:10px 12px; box-shadow:0 4px 18px rgba(60,52,42,.15); font-size:12.5px; width:260px; }',
    '.wf-cal-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }',
    '.wf-cal-title { font-weight:600; color:#4a4139; }',
    '.wf-cal-nav { background:transparent; border:none; padding:2px 8px; cursor:pointer; color:#5b7a5e; font-size:14px; border-radius:3px; }',
    '.wf-cal-nav:hover { background:#e8f0e8; }',
    '.wf-cal-dow { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; margin-bottom:4px; font-size:10px; color:#8a7f72; text-align:center; font-variant:small-caps; }',
    '.wf-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }',
    '.wf-cal-day, .wf-cal-blank { aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:12px; border-radius:3px; position:relative; }',
    '.wf-cal-day { cursor:pointer; color:#4a4139; }',
    '.wf-cal-day:hover { background:#e8f0e8; }',
    '.wf-cal-today { border:1px solid #5b7a5e; font-weight:600; }',
    '.wf-cal-selected { background:#5b7a5e; color:#fff; }',
    '.wf-cal-selected:hover { background:#4a6b4d; }',
    '.wf-cal-populated::after { content:""; position:absolute; bottom:3px; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:50%; background:#b89a3a; }',
    '.wf-cal-selected.wf-cal-populated::after { background:#faf8f4; }',
    '.wf-cal-future { color:#c0b8a8; cursor:default; }',
    '.wf-cal-future:hover { background:transparent; }',
    '.wf-cal-legend { margin-top:8px; padding-top:8px; border-top:1px solid #ece7dd; font-size:10px; color:#8a7f72; display:flex; align-items:center; gap:2px; flex-wrap:wrap; }',
    '.wf-cal-dot { display:inline-block; width:4px; height:4px; border-radius:50%; background:#b89a3a; margin-right:2px; }',
    '.wf-cal-today-mark { display:inline-block; width:10px; height:10px; border:1px solid #5b7a5e; border-radius:2px; margin-right:2px; vertical-align:middle; }',

    /* ── Read mode (scrolling book of past days) ─────────────────────────── */
    '.wf-read-nav { align-items:center; }',
    '.wf-read-book { max-width:820px; margin:12px auto; }',
    '.wf-read-day { background:var(--surface,#faf8f4); border:1px solid var(--border,#d5cec0); border-radius:6px; padding:14px 18px; margin-bottom:16px; }',
    '.wf-read-day-h { display:flex; align-items:baseline; gap:10px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #ece7dd; }',
    '.wf-read-day-h h2 { margin:0; font-size:15px; color:#4a4139; font-weight:600; }',
    '.wf-read-day-iso { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:11px; color:#8a7f72; }',
    '.wf-read-src-tag { font-size:9.5px; color:#8a7f72; background:#f0ebe3; padding:1px 6px; border-radius:2px; font-variant:small-caps; letter-spacing:.05em; margin-left:auto; }',
    '.wf-read-day-body { font-size:13.5px; line-height:1.55; color:#4a4139; }',
    '.wf-read-day-body img { max-width:100%; height:auto; border-radius:3px; }',
    '.wf-read-day-body table { border-collapse:collapse; margin:6px 0; }',
    '.wf-read-day-body td, .wf-read-day-body th { border:1px solid #d5cec0; padding:3px 8px; }',
    /* Reuse the same block coloring rules from the editor for consistency */
    '.wf-read-day-body [data-groups] { padding-left:8px; border-left:3px solid var(--wf-tag-primary, #7a9e7e); background: var(--wf-tag-tint, rgba(122,158,126,0.04)); position:relative; margin-top:14px; }',
    '.wf-read-day-body .wf-task-done { border-left:3px solid #b89a3a; background:rgba(184,154,58,0.06); padding-left:8px; }',
    '.wf-read-day-body .wf-protocol { border-left:3px solid #5b7aa0; background:rgba(91,122,160,0.06); padding-left:8px; }',
    /* Project pill in Read mode / Notebook — identical to Workflow view so
       what you see in editing is what you see in review + PDF. */
    '.wf-read-day-body [data-groups]::after { content: attr(data-groups); position:absolute; top:-9px; right:6px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:10px; line-height:1; color: var(--wf-tag-pill-fg, #3a5a3d); background: var(--wf-tag-pill-bg, #e8f0e8); border:1px solid var(--wf-tag-pill-border, #7a9e7e); padding:2px 8px 3px 8px; border-radius:9px; pointer-events:none; z-index:1; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',

    /* ── Print styles ─────────────────────────────────────────────────────
       When Read mode is printed (or window.print() invoked from anywhere),
       hide chrome and put each day on its own page. Applies globally — a
       Write mode print won\'t look great but that\'s not the intended flow. */
    '@media print {',
    '  body { background:#fff !important; }',
    '  .day-nav, .wf-read-nav, #wf-read-status, .wf-doc-toolbar, .wf-doc-side, .btn, button { display:none !important; }',
    '  .wf-read-book { max-width:none; margin:0; }',
    '  .wf-read-day { border:none; padding:0; margin:0 0 20mm 0; page-break-after:always; box-shadow:none; }',
    '  .wf-read-day:last-child { page-break-after:auto; }',
    '  .wf-read-day-h { border-bottom:1px solid #999; }',
    '  .wf-read-day-body img { max-width:100% !important; page-break-inside:avoid; }',
    '  .wf-read-day-body table { page-break-inside:avoid; }',
    '  .wf-read-src-tag { display:none !important; }',
    '  .wf-cal-pop { display:none !important; }',
    '}',
  ].join('\n');
  document.head.appendChild(s);
}

/* ── Document load / save ─────────────────────────────────────────────── */

var _wfDocSaveTimer = null;
var _wfCurrentBlock = null;
async function _wfLoadDoc() {
  try {
    var data = await api('GET', '/api/workflow/' + _workflowDate + '/document');
    if (window._wfDocApi) {
      window._wfDocApi.setHtml(data.content || '');
      _wfRefreshSidebar();
    }
  } catch(e) {}
}
function _wfDocDebouncedSave() {
  if (_wfDocSaveTimer) clearTimeout(_wfDocSaveTimer);
  /* Delay comes from user settings (auto_save_delay_ms); fall back to 1500ms
     if settings aren't loaded yet for any reason. */
  var delay = (S.settings && S.settings.auto_save_delay_ms) || 1500;
  _wfDocSaveTimer = setTimeout(function() {
    if (window._wfDocApi) _wfSaveDoc(window._wfDocApi.getHtml());
  }, delay);
}
async function _wfSaveDoc(html) {
  if (!window._wfDocApi) return;
  var saveEl = document.getElementById('wf-doc-saved');
  if (saveEl) saveEl.textContent = 'Saving\u2026';
  try {
    var resp = await fetch('/api/workflow/' + _workflowDate + '/document', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: html }),
    });
    if (!resp.ok) throw new Error(resp.statusText);
    window._wfDocApi.markClean();
    if (saveEl) saveEl.textContent = 'Saved \u00b7 ' + new Date().toLocaleTimeString();
  } catch(e) {
    if (saveEl) saveEl.textContent = 'Save failed';
  }
}

/* Time chip — inserts current HH:MM as a non-editable chip. Called both
   from the toolbar button (no args) and from the Ctrl+T keydown handler
   ({manual: true}). Manual insert bypasses the idle-threshold check
   (auto-insert enforces it separately in _wfDocKeydownExtras Enter path).
   Always fires the time_events log for immediate hours-copy visibility. */
function wfInsertTimeChip(opts) {
  if (!window._wfDocApi) return;
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var chip = '<span class="wf-time" contenteditable="false">' + hh + ':' + mm + '</span>&nbsp;';
  document.execCommand('insertHTML', false, chip);
  _wfLastActivityAt = now.getTime();  /* manual insert counts as activity */
  var dateIso = (typeof _workflowDate !== 'undefined' && _workflowDate)
                ? _workflowDate : now.toISOString().slice(0, 10);
  // Following text is best-effort — take the containing block's text.
  var sel = window.getSelection();
  var followingText = '';
  if (sel && sel.anchorNode) {
    var b = sel.anchorNode.parentNode;
    while (b && b.id !== 'wf-doc' && !(b.matches && b.matches('p, div, h3, h4, blockquote'))) {
      b = b.parentNode;
    }
    if (b && b.id !== 'wf-doc') followingText = (b.textContent || '').trim();
  }
  _wfLogChipEvent(dateIso, hh, mm, followingText);
}

/* Doc-specific keydown: Ctrl+T (time), Ctrl+G (tag picker), Enter auto-time-chip */
/* ── Track changes on past-day edits ────────────────────────────────────────
   When editing a workflow day older than today, Backspace/Delete are
   intercepted: instead of removing text, the affected content is wrapped in
   <del> so the original writing stays visible with strikethrough. Insertions
   are plain — the "not-struck" text IS the new content.
   Redact mode toggles this off for the current session — while active,
   deletions work normally (permanent). Used for IP-sensitive content the
   user doesn't want in an audit trail.
   Editing today's page is never tracked (redact mode is irrelevant then). */
var _wfRedactMode = false;

function _wfIsPastDay() {
  var today = new Date().toISOString().slice(0, 10);
  return _workflowDate < today;
}

function _wfIsTrackingActive() {
  return _wfIsPastDay() && !_wfRedactMode;
}

function _wfToggleRedactMode() {
  if (!_wfIsPastDay()) {
    toast('Redact mode only applies when editing past days');
    return;
  }
  _wfRedactMode = !_wfRedactMode;
  var btn = document.getElementById('wf-redact-btn');
  if (btn) btn.innerHTML = _wfRedactBtnLabel();
  var doc = document.getElementById('wf-doc');
  if (doc) doc.classList.toggle('wf-redact-active', _wfRedactMode);
  toast(_wfRedactMode
    ? 'Redact mode ON — deletions will be permanent'
    : 'Redact mode OFF — deletions will be tracked as strikethrough');
}

function _wfRedactBtnLabel() {
  if (!_wfIsPastDay()) return '';   /* button hidden on today's page */
  return _wfRedactMode
    ? '<span style="color:#c0392b">\u{1F513} Redact mode: ON</span>'
    : '\u{1F512} Redact mode: OFF';
}


function _wfWrapRangeAsDeleted(range) {
  /* Wrap the range's selected content in a <del> element. Handles the common
     case where the range is inside a single block; multi-block ranges get
     approximated (wrap each contained element separately if needed).
     Returns the <del> element so caller can position caret after it. */
  var contents = range.extractContents();
  var del = document.createElement('del');
  del.appendChild(contents);
  range.insertNode(del);
  /* Place caret after the <del> */
  var sel = window.getSelection();
  var newRange = document.createRange();
  newRange.setStartAfter(del);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return del;
}


function _wfHandleTrackedDelete(direction) {
  /* direction: 'backward' (Backspace) or 'forward' (Delete).
     If selection is non-empty, wrap the whole selection in <del>.
     If empty, extend by one character in `direction` and wrap.
     Skips over content already inside <del> (avoids double-wrapping). */
  var sel = window.getSelection();
  if (!sel.rangeCount) return false;
  var range = sel.getRangeAt(0);

  /* If caret is already inside a <del>, let default behaviour happen — user
     is likely trying to remove already-struck content, which is fine. */
  var ancestor = range.startContainer.parentElement;
  while (ancestor && ancestor.tagName !== 'DEL' && ancestor.id !== 'wf-doc') {
    ancestor = ancestor.parentElement;
  }
  if (ancestor && ancestor.tagName === 'DEL') return false;

  if (!range.collapsed) {
    _wfWrapRangeAsDeleted(range);
    return true;
  }

  /* Empty selection — extend by one char and wrap.
     modify() is a WebKit/Blink API that grows the selection by a unit.
     Fallback: manual range extension for the current text node. */
  if (typeof sel.modify === 'function') {
    sel.modify('extend', direction === 'backward' ? 'backward' : 'forward', 'character');
    var r2 = sel.getRangeAt(0);
    if (!r2.collapsed) {
      _wfWrapRangeAsDeleted(r2);
      return true;
    }
    return false;
  }

  /* Fallback: same-text-node char step */
  var node = range.startContainer;
  var off  = range.startOffset;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (direction === 'backward') {
    if (off <= 0) return false;
    range.setStart(node, off - 1);
    range.setEnd(node, off);
  } else {
    if (off >= (node.textContent || '').length) return false;
    range.setStart(node, off);
    range.setEnd(node, off + 1);
  }
  _wfWrapRangeAsDeleted(range);
  return true;
}


function _wfDocKeydownExtras(e) {
  /* Update the last-activity tracker on any content-producing keypress.
     Excludes Enter (that's what we gate on) and pure modifier keys
     (Shift/Ctrl/Alt/Meta/CapsLock — pressing Shift alone isn't "activity").
     Arrow keys and Tab are also excluded because caret navigation without
     input isn't real editing. Backspace/Delete DO count — user is
     actively modifying content. */
  if (!_WF_NON_ACTIVITY_KEYS[e.key]) {
    _wfLastActivityAt = Date.now();
  }

  /* Track-changes interception FIRST — must run before Ctrl+T / Enter etc.
     Only Backspace/Delete are affected. Only active for past days when
     redact mode is OFF. */
  if (_wfIsTrackingActive() && (e.key === 'Backspace' || e.key === 'Delete')) {
    var handled = _wfHandleTrackedDelete(e.key === 'Backspace' ? 'backward' : 'forward');
    if (handled) {
      e.preventDefault();
      if (window._wfDocApi) _wfDocDebouncedSave();
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T')) {
    /* Manual chip insert — bypasses the idle-threshold check. User asked
       for it explicitly, so we insert unconditionally. */
    e.preventDefault(); wfInsertTimeChip({manual: true}); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault(); wfOpenTagPicker(); return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    var sel = window.getSelection();
    if (!sel.anchorNode) return;
    var inLi = sel.anchorNode.parentNode && sel.anchorNode.parentNode.closest && sel.anchorNode.parentNode.closest('li, td, th');
    if (inLi) return;
    setTimeout(function() {
      var s = window.getSelection();
      if (!s.anchorNode) return;
      var block = s.anchorNode.parentNode;
      while (block && block.id !== 'wf-doc' && !(block.matches && block.matches('p, div, h3, h4, blockquote'))) {
        block = block.parentNode;
      }
      if (!block || block.id === 'wf-doc') return;

      /* ── Auto-tag with active project ────────────────────────────────────
         Runs FIRST — independent of the time-chip logic below. Only tags
         "empty" blocks so mid-block Enter splits (where the second half has
         inherited text) don't get their tags overridden.
         Empty = no user text, tolerating a browser-inserted <br> and any
         already-existing time chip. */
      var activeProj = _wfGetActiveProject();
      if (activeProj) {
        var text = (block.textContent || '').trim();
        // Strip any existing time-chip text before deciding empty-ness
        var chipEls = block.querySelectorAll('.wf-time');
        for (var ci = 0; ci < chipEls.length; ci++) {
          text = text.replace(chipEls[ci].textContent, '').trim();
        }
        if (text === '') {
          block.setAttribute('data-groups', activeProj);
          if (window._wfDocApi) _wfDocDebouncedSave();
        }
      }

      if (block.querySelector && block.querySelector('.wf-time')) return;

      /* ── Idle-threshold check ────────────────────────────────────────
         Stamp a chip only if the user has been idle at least
         wf_chip_idle_minutes minutes. Reference point is the user's last
         content-producing keystroke (_wfLastActivityAt), NOT the max
         chip time in the doc. This means continuous typing never
         inserts more chips, and returning after a real break always
         gets one. */
      var thresholdMin = (window.S && S.settings && S.settings.wf_chip_idle_minutes) || 5;
      var now = new Date();
      var idleMs = now.getTime() - _wfLastActivityAt;
      if (idleMs < thresholdMin * 60 * 1000) return;

      var hh = String(now.getHours()).padStart(2, '0');
      var mm = String(now.getMinutes()).padStart(2, '0');
      var chip = document.createElement('span');
      chip.className = 'wf-time';
      chip.contentEditable = 'false';
      chip.textContent = hh + ':' + mm;
      var spaceNode = document.createTextNode(' ');
      block.insertBefore(chip, block.firstChild);
      block.insertBefore(spaceNode, chip.nextSibling);

      /* Bump activity timestamp so the next Enter after this doesn't
         immediately try to insert again (idle since this chip = 0). */
      _wfLastActivityAt = now.getTime();

      /* Log to time_events immediately so hours copy-from-workflow sees
         this chip without waiting for the debounced doc save. Deduped
         against the eventual live-parsed chip so no double-count. */
      var dateIso = (typeof _workflowDate !== 'undefined' && _workflowDate)
                    ? _workflowDate : (new Date()).toISOString().slice(0, 10);
      _wfLogChipEvent(dateIso, hh, mm, (block.textContent || '').trim());

      /* ── Cursor fix ───────────────────────────────────────────────────
         Previously the caret stayed at position 0 (before the chip) so the
         next character typed went BEFORE the timestamp. Move caret to
         after the trailing space so typing continues normally after the chip. */
      try {
        var range = document.createRange();
        range.setStartAfter(spaceNode);
        range.collapse(true);
        var newSel = window.getSelection();
        newSel.removeAllRanges();
        newSel.addRange(range);
      } catch (ex) { /* selection API can be flaky mid-input; chip inserted regardless */ }

      if (window._wfDocApi) _wfDocDebouncedSave();
    }, 0);
  }
}

/* Track current top-level block under caret */
function _wfRefreshCurrentBlock() {
  var sel = window.getSelection();
  if (!sel.anchorNode) { _wfCurrentBlock = null; return; }
  var docRoot = document.getElementById('wf-doc');
  if (!docRoot) return;
  var node = sel.anchorNode;
  while (node && node !== docRoot) {
    if (node.nodeType === 1 && /^(P|DIV|UL|OL|TABLE|PRE|BLOCKQUOTE|H3|H4)$/.test(node.tagName)) {
      while (node.parentNode && node.parentNode !== docRoot) node = node.parentNode;
      _wfCurrentBlock = node;
      Array.prototype.forEach.call(docRoot.querySelectorAll('.wf-current-block'), function(el) {
        el.classList.remove('wf-current-block');
      });
      node.classList.add('wf-current-block');
      return;
    }
    node = node.parentNode;
  }
  _wfCurrentBlock = null;
}

/* Sidebar refresh */
function _wfRefreshSidebar() {
  var docRoot = document.getElementById('wf-doc');
  if (!docRoot) return;
  var blocks = Array.prototype.filter.call(docRoot.children, function(c) {
    return /^(P|DIV|UL|OL|TABLE|PRE|BLOCKQUOTE|H3|H4)$/.test(c.tagName);
  });
  var counts = {};
  var untagged = 0;
  blocks.forEach(function(b) {
    var gs = (b.getAttribute('data-groups') || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    if (!gs.length) { untagged++; return; }
    gs.forEach(function(g) { counts[g] = (counts[g] || 0) + 1; });
  });
  var listEl = document.getElementById('wf-doc-side-groups');
  if (listEl) {
    var names = Object.keys(counts).sort();
    if (!names.length) {
      listEl.innerHTML = '<div style="color:#8a7f72;font-size:11px;font-style:italic">No tagged blocks yet</div>';
    } else {
      listEl.innerHTML = names.map(function(g) {
        return '<div style="display:flex;justify-content:space-between;padding:3px 0">' +
               '<span class="wf-group-chip active">' + esc(g) + '</span>' +
               '<span style="color:#8a7f72;font-size:11px">' + counts[g] + ' block' + (counts[g] > 1 ? 's' : '') + '</span>' +
               '</div>';
      }).join('');
    }
  }
  var untaggedEl = document.getElementById('wf-doc-side-untagged');
  if (untaggedEl) {
    untaggedEl.textContent = untagged === 0
      ? 'None \u2014 everything tagged.'
      : untagged + ' untagged block' + (untagged > 1 ? 's' : '') + ' (will be context for all groups).';
  }
}

/* ── Active-runs panel ──────────────────────────────────────────────────
   Reads lab_proto_runs from localStorage, renders one card per active run
   with a compact read-only recipe table. Resume button hands off to the
   protocol scratch view. Sidebar width auto-expands with run count. */
function _wfRefreshActiveRuns() {
  var wrap = document.getElementById('wf-doc-side-runs-wrap');
  var list = document.getElementById('wf-doc-side-runs');
  var side = document.querySelector('.wf-doc-side');
  if (!wrap || !list || !side) return;

  var runs = [];
  try { runs = JSON.parse(localStorage.getItem('lab_proto_runs') || '[]'); } catch(_) {}
  if (!runs.length) {
    wrap.style.display = 'none';
    side.removeAttribute('data-has-runs');
    return;
  }
  wrap.style.display = '';
  /* Cap data attribute at 3 so CSS doesn't need every integer — 3+ runs all use the 500px width */
  side.setAttribute('data-has-runs', String(Math.min(runs.length, 3)));

  list.innerHTML = runs.map(_wfRenderRunCard).join('');
}

function _wfRenderRunCard(run) {
  /* Defensive — older run objects may not have all fields. */
  if (!run || !run.protocol) return '';
  var steps = run.steps || [];
  var done = steps.filter(function(s) { return s.done; }).length;
  var pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  var html = '<div class="wf-run-card">';
  html += '<div class="wf-run-card-head">';
  html += '<div><div class="wf-run-card-title">' + esc(run.protocol.title || 'Protocol') + '</div>';
  if (run.group_name) {
    html += '<div class="wf-run-card-group">' + esc(run.group_name) +
            (run.subgroup ? ' / ' + esc(run.subgroup) : '') + '</div>';
  }
  html += '</div></div>';
  html += '<div class="wf-run-progress-bar"><div class="wf-run-progress-fill" style="width:' + pct + '%"></div></div>';
  html += '<div class="wf-run-progress-text">' + done + ' / ' + steps.length + ' steps \u00b7 ' + pct + '%</div>';

  /* Recipe — render only if there's actual data. Don't show empty tables. */
  if (run.recipe && run.recipe.rows && run.recipe.rows.length && run.recipe.cols && run.recipe.cols.length) {
    html += '<div class="wf-run-recipe"><table><thead><tr>';
    run.recipe.cols.forEach(function(c) {
      html += '<th>' + esc(c.label || c.name || '') + '</th>';
    });
    html += '</tr></thead><tbody>';
    run.recipe.rows.forEach(function(row) {
      html += '<tr>';
      run.recipe.cols.forEach(function(c) {
        var key = c.key || c.name || c.label || '';
        var val = row[key];
        if (val === undefined || val === null || val === '') val = '\u2014';
        html += '<td>' + esc(String(val)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
  }

  /* Two-button row: Resume keeps the run going; Finish jumps to scratch view
     and highlights the save-to-entry button for one-tap completion. */
  var rid = esc(run.runId).replace(/\'/g, '&#39;');
  html += '<div style="display:flex;gap:4px;margin-top:6px">';
  html += '<button class="wf-run-resume" onclick="wfResumeRun(\'' + rid + '\')" style="flex:1">Resume</button>';
  html += '<button class="wf-run-finish" onclick="wfFinishRun(\'' + rid + '\')" title="Mark protocol finished" style="flex:1">\u2713 Finish</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function wfFinishRun(runId) {
  /* Hand off to scratch.js. spResumeAndFinish loads the run state, switches
     to the scratch view, and highlights the Save-to-Entry button. */
  if (typeof spResumeAndFinish === 'function') {
    spResumeAndFinish(runId);
  } else if (typeof setView === 'function') {
    /* Fallback: just resume into scratch view */
    if (typeof spResumeRunById === 'function') spResumeRunById(runId);
    else { setView('scratch'); }
  }
}
window.wfFinishRun = wfFinishRun;

/* Tag picker modal */
async function wfOpenTagPicker() {
  if (!_wfCurrentBlock) {
    toast('Click on a block first', true);
    return;
  }
  var candidates = {};
  _wfNotebookGroups.forEach(function(g) { candidates[g] = true; });
  var docRoot = document.getElementById('wf-doc');
  if (docRoot) {
    Array.prototype.forEach.call(docRoot.querySelectorAll('[data-groups]'), function(el) {
      (el.getAttribute('data-groups') || '').split(',').forEach(function(g) {
        g = g.trim(); if (g) candidates[g] = true;
      });
    });
  }
  var current = (_wfCurrentBlock.getAttribute('data-groups') || '').split(',')
    .map(function(s) { return s.trim(); }).filter(Boolean);
  var currentSet = {}; current.forEach(function(g) { currentSet[g] = true; });

  var existing = document.getElementById('wf-tag-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'wf-tag-modal';
  modal.className = 'wf-tag-modal';
  modal.onclick = function(e) { if (e.target === modal) wfCloseTagPicker(); };
  var groupNames = Object.keys(candidates).sort();
  var chipsHtml = groupNames.length
    ? groupNames.map(function(g) {
        var cls = 'wf-group-chip' + (currentSet[g] ? ' active' : '');
        return '<span class="' + cls + '" onclick="wfToggleTag(this, \'' + esc(g).replace(/'/g, '&#39;') + '\')">' + esc(g) + '</span>';
      }).join('')
    : '<div style="color:#8a7f72;font-size:12px">No groups yet \u2014 type one below.</div>';
  modal.innerHTML =
    '<div class="wf-tag-modal-inner">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div style="font-weight:600">Tag this block</div>' +
        '<span style="cursor:pointer;color:#8a7f72;font-size:1.2rem" onclick="wfCloseTagPicker()">&times;</span>' +
      '</div>' +
      '<div style="font-size:11.5px;color:#8a7f72;margin-bottom:8px">Click to toggle. Multiple allowed.</div>' +
      '<div id="wf-tag-chips" style="min-height:40px;padding:6px;background:#fff;border:1px solid #e0d9cd;border-radius:4px;margin-bottom:10px">' + chipsHtml + '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:10px">' +
        '<input id="wf-tag-new" type="text" list="global-projects" placeholder="New group name\u2026" ' +
          'style="flex:1;padding:5px 8px;border:1px solid #d5cec0;border-radius:4px;font-family:inherit" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();wfAddNewTag();}">' +
        /* datalist provides native browser autocomplete — uses candidate names
           gathered above (notebook groups + already used in this doc). */
        '<datalist id="wf-tag-suggestions">' +
        groupNames.map(function(g) { return '<option value="' + esc(g) + '">'; }).join('') +
        '</datalist>' +
        '<button class="wf-tool-btn" onclick="wfAddNewTag()">+ Add</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:6px">' +
        '<button class="wf-tool-btn" onclick="wfCloseTagPicker()">Cancel</button>' +
        '<button class="wf-tool-btn wf-tool-btn-primary" onclick="wfApplyTags()">Apply</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  setTimeout(function() { var inp = document.getElementById('wf-tag-new'); if (inp) inp.focus(); }, 50);
}

function wfCloseTagPicker() { var m = document.getElementById('wf-tag-modal'); if (m) m.remove(); }
function wfToggleTag(chipEl, name) {
  if (chipEl.classList.contains('active')) chipEl.classList.remove('active');
  else chipEl.classList.add('active');
}
function wfAddNewTag() {
  var inp = document.getElementById('wf-tag-new');
  if (!inp || !inp.value.trim()) return;
  var name = inp.value.trim();
  var existing = document.querySelectorAll('#wf-tag-chips .wf-group-chip');
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].textContent.replace(/×/g, '').trim() === name) {
      existing[i].classList.add('active'); inp.value = ''; return;
    }
  }
  var holder = document.getElementById('wf-tag-chips');
  if (holder) {
    var chip = document.createElement('span');
    chip.className = 'wf-group-chip active';
    chip.textContent = name;
    chip.onclick = function() { wfToggleTag(chip, name); };
    holder.appendChild(chip);
  }
  inp.value = '';
}
function wfApplyTags() {
  if (!_wfCurrentBlock) { wfCloseTagPicker(); return; }
  var active = document.querySelectorAll('#wf-tag-chips .wf-group-chip.active');
  var names = [];
  Array.prototype.forEach.call(active, function(c) { names.push(c.textContent.replace(/×/g, '').trim()); });
  if (names.length) {
    _wfCurrentBlock.setAttribute('data-groups', names.join(','));
  } else {
    _wfCurrentBlock.removeAttribute('data-groups');
  }
  wfCloseTagPicker();
  _wfDocDebouncedSave();
  _wfRefreshSidebar();
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

  /* Append a protocol-start block to today's document, tagged with the chosen group.
     Refresh the editor afterwards so the user sees the new line. */
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var html = '<p class="wf-block wf-protocol">' +
             '<span class="wf-time" contenteditable="false">' + hh + ':' + mm + '</span> ' +
             '<strong>\u25b6 Started protocol:</strong> ' + esc(p.title) +
             '</p>';
  api('POST', '/api/workflow/document/append', {
    html: html,
    groups: [group],
  }).then(function() {
    /* Reload doc so the new block appears in the editor */
    if (typeof _wfLoadDoc === 'function') _wfLoadDoc();
  });

  if (typeof spLaunchRunDirect === 'function') {
    spLaunchRunDirect(p, group, subgroup);
    /* spLaunchRunDirect writes to localStorage. Refresh the sidebar so the
       new run appears without needing a page reload. */
    setTimeout(function() { _wfRefreshActiveRuns(); }, 100);
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
  var grpInp = document.getElementById('wf-group');
  var group  = grpInp?.value.trim() || null;
  if (!window._wfInputApi) {
    /* Defensive fallback — should never hit in practice */
    return;
  }
  var html = window._wfInputApi.getHtml().trim();
  if (!html) return;
  /* If the content is just plain text (no HTML tags other than perhaps a stray <br>),
     send it as plain so old-style entries stay simple. Otherwise send as html
     so the server keeps the formatting and the LLM-strip helper kicks in later. */
  var textOnly = html.replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').trim();
  var hasRichContent = /<(img|table|ul|ol|strong|em|u|b|i|a)\b/i.test(html);
  if (hasRichContent) {
    await api('POST', '/api/workflow', { content: html, format: 'html', type: 'note', group_name: group });
  } else {
    /* Plain text with at most line breaks. Strip the wrapping <div>/<p>
       contenteditable adds, send as plain. */
    await api('POST', '/api/workflow', { content: textOnly, type: 'note', group_name: group });
  }
  window._wfInputApi.clear();
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
  var isHtml = el.getAttribute('data-format') === 'html';
  if (isHtml) {
    /* Rich edit — replace the rendered HTML with a contenteditable rich editor. */
    var current = el.innerHTML;
    /* Strip the wrapping .wf-rich-render div we added at render time so the editor
       starts with just the inner content. */
    var inner = current.replace(/^<div class="wf-rich-render">/, '').replace(/<\/div>$/, '');
    el.innerHTML = '<div id="we-rich-' + id + '"></div>' +
                   '<div style="margin-top:6px;font-size:11px;color:#8a7f72">Press Esc to cancel, Ctrl+Enter to save</div>';
    var area = document.getElementById('we-rich-' + id);
    var api = wfEditorAttach(area, {
      initialHtml: inner,
      minHeight: '40px',
    });
    api.focus();
    area.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { e.preventDefault(); loadView(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveWorkflowEntry(id, api.getHtml(), 'html');
      }
    });
  } else {
    /* Plain edit — original behaviour */
    var current = el.textContent;
    el.innerHTML = '<textarea id="we-ta-' + id + '" style="min-height:60px;width:100%;background:transparent;border:none;border-bottom:1px solid var(--accent);color:var(--text);font-family:var(--sans);font-size:14px;outline:none;resize:none;padding:2px 0">' + esc(current) + '</textarea>';
    var ta = el.querySelector('textarea'); ta.focus();
    ta.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveWorkflowEntry(id, this.value, 'plain'); }
      if (e.key === 'Escape') loadView();
    });
  }
}

async function saveWorkflowEntry(id, content, format) {
  var body = { content: content };
  if (format) body.format = format;
  await api('PUT', '/api/workflow/' + id, body);
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

registerView('workflow', renderWorkflow, {wide:true});
window.processWorkflowDay = processWorkflowDay;
window.wfResetProcessDay  = wfResetProcessDay;


/* ══════════════════════════════════════════════════════════════════════════
   READ MODE — scrolling book of past days
   ────────────────────────────────────────────────────────────────────────
   Not an editor. Renders a 30-day window of day content, newest at top.
   Populated by GET /api/workflow/documents/range which prefers day_documents
   but falls back to synthesising from workflow_entries.
   ══════════════════════════════════════════════════════════════════════════ */

async function _wfRenderReadMode(el) {
  var today = new Date().toISOString().slice(0, 10);
  var end = _readWindowEnd;
  var days = _readWindowDays;
  // Compute window start for the label
  var startDt = new Date(end + 'T12:00:00');
  startDt.setDate(startDt.getDate() - (days - 1));
  var start = startDt.toISOString().slice(0, 10);

  // Newer button caps at today
  var canGoNewer = end < today;

  var html = '<div class="day-nav wf-read-nav">' +
    '<button onclick="_wfShiftReadWindow(-' + days + ')" title="Older 30 days">&#8592; Older</button>' +
    '<div class="day-label"><button class="wf-date-btn" onclick="_wfOpenCalendar(this, \'read\')" title="Jump to a date (window will end on that date)">' +
      formatDate(start) + ' &ndash; ' + formatDate(end) + ' &#9662;</button></div>' +
    (canGoNewer
      ? '<button onclick="_wfShiftReadWindow(' + days + ')" title="Newer 30 days">Newer &#8594;</button>'
      : '<button disabled style="opacity:.3">Newer &#8594;</button>') +
    '<button class="btn" onclick="_wfSwitchMode(\'write\')" title="Switch back to Write mode (edit today\'s notes)" style="margin-left:10px">&#9998; Write mode</button>' +
    '<button class="btn" onclick="_wfPrintPdf()" title="Print this 30-day window to PDF (save from your browser\'s print dialog)" style="margin-left:6px">&#128424; Print PDF</button>' +
    '</div>';

  html += '<div id="wf-read-status" style="font-size:12px;color:#8a7f72;margin:6px 2px">Loading&hellip;</div>';
  html += '<div id="wf-read-book" class="wf-read-book"></div>';

  el.innerHTML = html;
  _wfInjectDocStyles();

  var resp;
  try {
    resp = await api('GET', '/api/workflow/documents/range?end=' + encodeURIComponent(end) + '&days=' + days);
  } catch (ex) {
    document.getElementById('wf-read-status').textContent = 'Failed to load: ' + (ex.message || ex);
    return;
  }

  var docs = resp.documents || [];
  var status = document.getElementById('wf-read-status');
  if (docs.length === 0) {
    status.innerHTML = 'No content in this 30-day window (' + esc(start) + ' &ndash; ' + esc(end) + '). ' +
      'Try an earlier window with the Older button.';
    return;
  }
  status.innerHTML = docs.length + ' day' + (docs.length === 1 ? '' : 's') + ' with content &middot; window ' + esc(start) + ' &ndash; ' + esc(end);

  var book = document.getElementById('wf-read-book');
  var pages = docs.map(function(d) {
    var srcTag = d.source === 'synth_workflow_entries'
      ? '<span class="wf-read-src-tag" title="Synthesised from workflow_entries (day_document not created yet)">legacy</span>'
      : '';
    return '<article class="wf-read-day">' +
      '<header class="wf-read-day-h">' +
        '<h2>' + esc(formatDate(d.date)) + '</h2>' +
        '<span class="wf-read-day-iso">' + esc(d.date) + '</span>' +
        srcTag +
      '</header>' +
      '<div class="wf-read-day-body">' + (d.content || '') + '</div>' +
    '</article>';
  });
  book.innerHTML = pages.join('');
}


/* ══════════════════════════════════════════════════════════════════════════
   CALENDAR PICKER — month view, dots for days with content, click to jump
   ────────────────────────────────────────────────────────────────────────
   Used by both Write and Read modes. Anchored to the button that opened it,
   fetches populated dates for the visible month via the dates-with-content
   endpoint, and calls _workflowDate (write) or _readWindowEnd (read) on pick.
   ══════════════════════════════════════════════════════════════════════════ */

var _wfCalState = { anchor: null, mode: null, viewYear: 0, viewMonth: 0, populated: {} };

async function _wfOpenCalendar(anchorEl, mode) {
  // Close any existing calendar
  _wfCloseCalendar();
  var startingDate = mode === 'read' ? _readWindowEnd : _workflowDate;
  var dt = new Date(startingDate + 'T12:00:00');
  _wfCalState.anchor = anchorEl;
  _wfCalState.mode = mode;
  _wfCalState.viewYear = dt.getFullYear();
  _wfCalState.viewMonth = dt.getMonth();  // 0-11

  var pop = document.createElement('div');
  pop.id = 'wf-calendar-pop';
  pop.className = 'wf-cal-pop';
  document.body.appendChild(pop);
  _wfCalPositionPop(anchorEl, pop);

  await _wfCalRender();

  // Close on outside click / Escape
  setTimeout(function() {
    document.addEventListener('mousedown', _wfCalOutsideClick, { capture: true });
    document.addEventListener('keydown', _wfCalKeydown);
  }, 0);
}

function _wfCloseCalendar() {
  var pop = document.getElementById('wf-calendar-pop');
  if (pop) pop.remove();
  document.removeEventListener('mousedown', _wfCalOutsideClick, { capture: true });
  document.removeEventListener('keydown', _wfCalKeydown);
  _wfCalState.anchor = null;
}

function _wfCalOutsideClick(e) {
  var pop = document.getElementById('wf-calendar-pop');
  if (!pop) return;
  if (pop.contains(e.target)) return;
  if (_wfCalState.anchor && _wfCalState.anchor.contains(e.target)) return;
  _wfCloseCalendar();
}

function _wfCalKeydown(e) {
  if (e.key === 'Escape') _wfCloseCalendar();
}

function _wfCalPositionPop(anchor, pop) {
  var r = anchor.getBoundingClientRect();
  pop.style.position = 'absolute';
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.style.left = (window.scrollX + r.left) + 'px';
  pop.style.zIndex = 1200;
}

async function _wfCalRender() {
  var pop = document.getElementById('wf-calendar-pop');
  if (!pop) return;
  var y = _wfCalState.viewYear;
  var m = _wfCalState.viewMonth;
  var firstOfMonth = new Date(y, m, 1);
  var lastOfMonth = new Date(y, m + 1, 0);
  var monthStart = firstOfMonth.toISOString().slice(0, 10);
  var monthEnd = lastOfMonth.toISOString().slice(0, 10);

  // Fetch populated dates for this month
  var populated = {};
  try {
    var resp = await api('GET', '/api/workflow/documents/dates-with-content?start=' + monthStart + '&end=' + monthEnd);
    (resp.dates || []).forEach(function(d) { populated[d] = true; });
  } catch(ex) { /* silent — dots just won't show */ }
  _wfCalState.populated = populated;

  var today = new Date().toISOString().slice(0, 10);
  var selectedDate = _wfCalState.mode === 'read' ? _readWindowEnd : _workflowDate;

  var monthNames = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

  var h = '<div class="wf-cal-head">' +
    '<button class="wf-cal-nav" onclick="_wfCalShiftMonth(-1)" title="Previous month">&#8592;</button>' +
    '<div class="wf-cal-title">' + monthNames[m] + ' ' + y + '</div>' +
    '<button class="wf-cal-nav" onclick="_wfCalShiftMonth(1)" title="Next month">&#8594;</button>' +
    '</div>';
  h += '<div class="wf-cal-dow">';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(d) { h += '<div>' + d + '</div>'; });
  h += '</div>';
  h += '<div class="wf-cal-grid">';
  // Grid starts on Monday. JS getDay(): Sun=0..Sat=6. Convert to Mon=0..Sun=6.
  var firstDow = (firstOfMonth.getDay() + 6) % 7;
  // Leading blanks
  for (var i = 0; i < firstDow; i++) h += '<div class="wf-cal-blank"></div>';
  // Days
  for (var d = 1; d <= lastOfMonth.getDate(); d++) {
    var iso = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var cls = 'wf-cal-day';
    if (iso === today) cls += ' wf-cal-today';
    if (iso === selectedDate) cls += ' wf-cal-selected';
    if (populated[iso]) cls += ' wf-cal-populated';
    if (iso > today) cls += ' wf-cal-future';
    var clickAttr = iso > today ? '' : ' onclick="_wfCalPickDate(\'' + iso + '\')"';
    h += '<div class="' + cls + '"' + clickAttr + '>' + d + '</div>';
  }
  h += '</div>';
  h += '<div class="wf-cal-legend">' +
    '<span class="wf-cal-dot"></span> has content &nbsp;·&nbsp; ' +
    '<span class="wf-cal-today-mark"></span> today' +
    '</div>';
  pop.innerHTML = h;
}

function _wfCalShiftMonth(delta) {
  var y = _wfCalState.viewYear;
  var m = _wfCalState.viewMonth + delta;
  while (m < 0)  { m += 12; y -= 1; }
  while (m > 11) { m -= 12; y += 1; }
  _wfCalState.viewYear = y;
  _wfCalState.viewMonth = m;
  _wfCalRender();
}

function _wfCalPickDate(iso) {
  var mode = _wfCalState.mode;
  _wfCloseCalendar();
  if (mode === 'read') {
    _readWindowEnd = iso;
  } else {
    _workflowDate = iso;
  }
  loadView();
}


/* ══════════════════════════════════════════════════════════════════════════
   PRINT to PDF — uses the browser's print dialog
   ════════════════════════════════════════════════════════════════════════ */

function _wfPrintPdf() {
  // Just calls window.print(). Print CSS (added in _wfInjectDocStyles) hides
  // nav/status/toolbar/sidebar and starts each day on a new page.
  window.print();
}


/* Expose read-mode entrypoints for inline handlers */
window._wfSwitchMode          = _wfSwitchMode;
window._wfShiftReadWindow     = _wfShiftReadWindow;
window._wfOpenCalendar        = _wfOpenCalendar;
window._wfCalShiftMonth       = _wfCalShiftMonth;
window._wfCalPickDate         = _wfCalPickDate;
window._wfPrintPdf            = _wfPrintPdf;
window._wfOpenProjectPicker   = _wfOpenProjectPicker;
window._wfProjectPickerAddNew = _wfProjectPickerAddNew;
window._wfProjectSetColor     = _wfProjectSetColor;
window._wfToggleRedactMode    = _wfToggleRedactMode;
