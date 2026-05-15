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
    _wfLoadDoc();
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
    '.wf-doc-side { width:240px; background:var(--surface,#faf8f4); border:1px solid var(--border,#d5cec0); border-radius:6px; padding:12px; font-size:12.5px; }',
    '.wf-doc-side-h { font-variant:small-caps; font-size:11px; letter-spacing:.08em; color:#8a7f72; font-weight:600; margin-bottom:6px; }',
    '.wf-doc-side-help { margin-top:14px; padding-top:10px; border-top:1px solid #ece7dd; font-size:11px; color:#8a7f72; line-height:1.5; }',
    '.wf-doc-toolbar { display:flex; gap:4px; align-items:center; flex-wrap:wrap; padding:6px 0 4px 0; margin-top:4px; border-top:1px solid #ece7dd; }',
    '.wf-tool-btn-primary { background:#5b7a5e !important; color:#fff !important; border-color:#5b7a5e !important; }',
    '#wf-doc .wf-block, #wf-doc p[data-groups], #wf-doc table[data-groups], #wf-doc ul[data-groups], #wf-doc ol[data-groups] { padding-left:8px; border-left:3px solid transparent; transition:border-color .15s; }',
    '#wf-doc [data-groups] { border-left-color:#7a9e7e; background:rgba(122,158,126,0.04); }',
    '#wf-doc .wf-task-done { border-left-color:#b89a3a; background:rgba(184,154,58,0.06); }',
    '#wf-doc .wf-protocol { border-left-color:#5b7aa0; background:rgba(91,122,160,0.06); }',
    '#wf-doc .wf-current-block { box-shadow: -3px 0 0 0 #5b7a5e inset; }',
    '.wf-time { display:inline-block; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.8em; padding:1px 6px; background:#f0ebe3; border-radius:3px; color:#8a7f72; user-select:none; margin-right:4px; }',
    '.wf-group-chip { display:inline-block; padding:2px 8px; background:#e8f0e8; color:#3a5a3d; border:1px solid #b5ccb5; border-radius:10px; font-size:11px; margin:2px 3px 2px 0; cursor:pointer; }',
    '.wf-group-chip.active { background:#5b7a5e; color:#fff; border-color:#5b7a5e; }',
    '.wf-tag-modal { position:fixed; inset:0; z-index:1100; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; }',
    '.wf-tag-modal-inner { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:420px; max-width:92vw; padding:14px 16px; }',
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
  _wfDocSaveTimer = setTimeout(function() {
    if (window._wfDocApi) _wfSaveDoc(window._wfDocApi.getHtml());
  }, 1500);
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

/* Time chip — inserts current HH:MM as a non-editable chip */
function wfInsertTimeChip() {
  if (!window._wfDocApi) return;
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var chip = '<span class="wf-time" contenteditable="false">' + hh + ':' + mm + '</span>&nbsp;';
  document.execCommand('insertHTML', false, chip);
}

/* Doc-specific keydown: Ctrl+T (time), Ctrl+G (tag picker), Enter auto-time-chip */
function _wfDocKeydownExtras(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 't' || e.key === 'T')) {
    e.preventDefault(); wfInsertTimeChip(); return;
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
      if (block.querySelector && block.querySelector('.wf-time')) return;
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, '0');
      var mm = String(now.getMinutes()).padStart(2, '0');
      var chip = document.createElement('span');
      chip.className = 'wf-time';
      chip.contentEditable = 'false';
      chip.textContent = hh + ':' + mm;
      block.insertBefore(chip, block.firstChild);
      block.insertBefore(document.createTextNode(' '), chip.nextSibling);
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
        '<input id="wf-tag-new" type="text" placeholder="New group name\u2026" style="flex:1;padding:5px 8px;border:1px solid #d5cec0;border-radius:4px;font-family:inherit" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();wfAddNewTag();}">' +
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

registerView('workflow', renderWorkflow);
window.processWorkflowDay = processWorkflowDay;
window.wfResetProcessDay  = wfResetProcessDay;
