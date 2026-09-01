/* ── Plan a Protocol (Workflow → Planning tab) ────────────────────────────
 *
 * "+ Plan a protocol" flow:
 *   1. wfShowPlanPicker()  — modal listing all protocols
 *   2. On pick → _wfPlanOpenMetaForm(protocolId)
 *   3. Renders the protocol's metadata_schema as a fillable form:
 *        - scalar fields (text / number) → single input
 *        - table fields → editable rows with + row / × delete
 *   4. On Insert → build a self-contained wf-plan-block HTML card and
 *      insertHtmlAtCaret into the active Planning-tab editor
 *
 * Explicitly SIMPLE (Option A from the design discussion): fresh
 * renderer, no reuse of scratch's _spRenderMetaPanel, no defaults
 * propagation, no cross-run persistence. The block is reference
 * material — when the user actually starts the run in scratch, they
 * eyeball the plan block and re-enter values there.
 *
 * The rendered block uses only tags + classes the sanitizer preserves
 * (see features/workflow/router.py sanitize_html): div, span, strong,
 * table/tr/th/td, all classes prefixed "wf-".
 * ────────────────────────────────────────────────────────────────────────── */

(function() {
'use strict';

var _planPickerOpenFor = null;   // 'planning' (only Planning tab uses this)
var _planFormState = null;       // { protocol, values } while modal open

/* ── Picker: list protocols, click to open the metadata form ─────────── */

window.wfShowPlanPicker = async function() {
  // The Planning tab is the only caller today, but stash the tab name
  // so if we later add a "plan from another tab" path the insert target
  // stays correct.
  _planPickerOpenFor = (typeof _wfActiveTab !== 'undefined') ? _wfActiveTab : 'planning';
  var existing = document.getElementById('wf-plan-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'wf-plan-modal';
  modal.className = 'wf-plan-modal';
  modal.onclick = function(e) { if (e.target === modal) _wfPlanClose(); };
  modal.innerHTML =
    '<div class="wf-plan-modal-inner">' +
      '<div class="wf-plan-modal-hdr"><span>Plan a protocol</span>' +
        '<span style="cursor:pointer;color:#8a7f72;font-size:1.2rem" onclick="_wfPlanClose()">&times;</span>' +
      '</div>' +
      '<div class="wf-plan-modal-body" id="wf-plan-modal-body">Loading&hellip;</div>' +
    '</div>';
  document.body.appendChild(modal);
  _wfPlanInjectStyles();
  try {
    var data = await api('GET', '/api/protocols');
    var body = document.getElementById('wf-plan-modal-body');
    if (!body) return;
    var items = data.items || data.protocols || data || [];
    if (!items.length) {
      body.innerHTML = '<div style="color:#8a7f72;padding:12px">No protocols yet. Add one in the Protocol Library first.</div>';
      return;
    }
    var html = '';
    items.forEach(function(p) {
      // Show a hint if this protocol has no metadata schema — planning
      // still works, you just get a title-only block.
      var hasSchema = false;
      if (p.metadata_schema) {
        try { hasSchema = !!(JSON.parse(p.metadata_schema).fields || []).length; } catch(e) {}
      }
      html += '<div class="wf-plan-pick" onclick="_wfPlanPick(' + p.id + ')">';
      html += '<div style="font-weight:600;color:#4a4139">' + _wfPlanEsc(p.title) + '</div>';
      html += '<div style="font-size:11px;color:#8a7f72">' +
              (hasSchema ? 'has metadata form' : 'no metadata schema — will insert title only') +
              '</div>';
      html += '</div>';
    });
    body.innerHTML = html;
  } catch (e) {
    var body = document.getElementById('wf-plan-modal-body');
    if (body) body.innerHTML = '<div style="color:#c25a4a;padding:12px">Failed to load protocols.</div>';
  }
};

window._wfPlanClose = function() {
  var m = document.getElementById('wf-plan-modal');
  if (m) m.remove();
  _planPickerOpenFor = null;
  _planFormState = null;
};

window._wfPlanPick = async function(protocolId) {
  // Fetch the single protocol to get its full metadata_schema. The list
  // endpoint already returns it in items, but we re-fetch to be safe
  // in case the list ever slims down (and for future-proof consistency).
  try {
    var p = await api('GET', '/api/protocols/' + protocolId);
    _wfPlanOpenMetaForm(p);
  } catch (e) {
    toast('Could not load protocol', true);
  }
};

/* ── Metadata form (fresh renderer, no scratch reuse) ─────────────────── */

function _wfPlanOpenMetaForm(protocol) {
  var schema = null;
  try {
    if (protocol.metadata_schema) {
      var parsed = JSON.parse(protocol.metadata_schema);
      if (parsed && Array.isArray(parsed.fields)) schema = parsed;
    }
  } catch (e) {}
  var fields = (schema && schema.fields) ? schema.fields : [];

  // Seed values: scalars from field.default (or ''); tables start with one empty row.
  var values = {};
  fields.forEach(function(f) {
    if (f.type === 'table') {
      var row = {};
      (f.columns || []).forEach(function(c) { row[c.id] = ''; });
      values[f.id] = [row];
    } else {
      values[f.id] = (f.default != null) ? String(f.default) : '';
    }
  });
  _planFormState = { protocol: protocol, schema: schema, fields: fields, values: values, note: '' };

  var body = document.getElementById('wf-plan-modal-body');
  if (!body) return;
  document.querySelector('#wf-plan-modal .wf-plan-modal-hdr span:first-child').textContent =
    'Plan: ' + protocol.title;
  body.innerHTML = _wfPlanRenderForm();
}

function _wfPlanRenderForm() {
  var st = _planFormState;
  if (!st) return '';
  var html = '';
  if (!st.fields.length) {
    html += '<div style="color:#8a7f72;padding:6px 0 12px 0">' +
            'This protocol has no metadata schema. A title-only block will be inserted.' +
            '</div>';
  }
  st.fields.forEach(function(f, i) {
    html += '<div class="wf-plan-fld">';
    html += '<label class="wf-plan-fld-lbl">' + _wfPlanEsc(f.label || f.id) + '</label>';
    if (f.type === 'table') {
      html += _wfPlanRenderTable(f, i);
    } else {
      var inputType = (f.type === 'number') ? 'number' : 'text';
      html += '<input type="' + inputType + '"' +
              ' class="wf-plan-fld-inp"' +
              ' value="' + _wfPlanEsc(st.values[f.id]) + '"' +
              ' oninput="_wfPlanSetScalar(\'' + _wfPlanEsc(f.id) + '\', this.value)"/>';
    }
    html += '</div>';
  });
  // Free-text note goes on every plan regardless of schema.
  html += '<div class="wf-plan-fld">' +
          '<label class="wf-plan-fld-lbl">Note (optional)</label>' +
          '<textarea class="wf-plan-fld-inp" rows="2" placeholder="e.g. check Buffer B is not expired"' +
          ' oninput="_wfPlanSetNote(this.value)">' + _wfPlanEsc(st.note) + '</textarea>' +
          '</div>';
  html += '<div class="wf-plan-actions">' +
    '<button class="btn" onclick="_wfPlanClose()">Cancel</button>' +
    '<button class="btn primary" onclick="_wfPlanInsert()">Insert into Planning</button>' +
    '</div>';
  return html;
}

function _wfPlanRenderTable(field, fieldIdx) {
  var st = _planFormState;
  var rows = st.values[field.id] || [];
  var cols = field.columns || [];
  var h = '<div class="wf-plan-tbl-wrap">';
  h += '<table class="wf-plan-tbl-edit"><thead><tr>';
  cols.forEach(function(c) { h += '<th>' + _wfPlanEsc(c.label || c.id) + '</th>'; });
  h += '<th style="width:24px"></th></tr></thead><tbody>';
  rows.forEach(function(row, r) {
    h += '<tr>';
    cols.forEach(function(c) {
      var v = row[c.id] != null ? String(row[c.id]) : '';
      var inputType = (c.type === 'number') ? 'number' : 'text';
      h += '<td><input type="' + inputType + '" value="' + _wfPlanEsc(v) +
           '" oninput="_wfPlanSetCell(\'' + _wfPlanEsc(field.id) + '\',' + r + ',\'' + _wfPlanEsc(c.id) + '\',this.value)"/></td>';
    });
    h += '<td><button class="wf-plan-x" onclick="_wfPlanDelRow(\'' + _wfPlanEsc(field.id) + '\',' + r + ')" title="Delete row">&times;</button></td>';
    h += '</tr>';
  });
  h += '</tbody></table>';
  h += '<button class="btn" style="margin-top:4px" onclick="_wfPlanAddRow(\'' + _wfPlanEsc(field.id) + '\')">+ row</button>';
  h += '</div>';
  return h;
}

/* ── Form state mutators (called from inline oninput / onclick) ──────── */

window._wfPlanSetScalar = function(fieldId, val) {
  if (_planFormState) _planFormState.values[fieldId] = val;
};
window._wfPlanSetNote = function(val) {
  if (_planFormState) _planFormState.note = val;
};
window._wfPlanSetCell = function(fieldId, rowIdx, colId, val) {
  var st = _planFormState; if (!st) return;
  var rows = st.values[fieldId]; if (!rows || !rows[rowIdx]) return;
  rows[rowIdx][colId] = val;
};
window._wfPlanAddRow = function(fieldId) {
  var st = _planFormState; if (!st) return;
  var field = st.fields.filter(function(f){return f.id === fieldId;})[0];
  if (!field) return;
  var row = {};
  (field.columns || []).forEach(function(c){ row[c.id] = ''; });
  if (!st.values[fieldId]) st.values[fieldId] = [];
  st.values[fieldId].push(row);
  document.getElementById('wf-plan-modal-body').innerHTML = _wfPlanRenderForm();
};
window._wfPlanDelRow = function(fieldId, rowIdx) {
  var st = _planFormState; if (!st) return;
  var rows = st.values[fieldId]; if (!rows) return;
  rows.splice(rowIdx, 1);
  // Keep at least one row so the "+ row" button is discoverable.
  if (rows.length === 0) {
    var field = st.fields.filter(function(f){return f.id === fieldId;})[0];
    var row = {};
    (field.columns || []).forEach(function(c){ row[c.id] = ''; });
    rows.push(row);
  }
  document.getElementById('wf-plan-modal-body').innerHTML = _wfPlanRenderForm();
};

/* ── Insert: build the wf-plan-block HTML and drop it into the editor ── */

window._wfPlanInsert = function() {
  var st = _planFormState;
  if (!st) return;
  // Editor must exist — user opened this from the Planning tab.
  var docEl = document.getElementById('wf-doc');
  if (!docEl || !window._wfDocApi) {
    toast('No editor to insert into', true);
    return;
  }
  var html = _wfPlanBuildBlockHtml(st);
  docEl.focus();
  // Reuse the editor's insert-at-caret helper (via execCommand under the
  // hood in wfEditorAttach). Falls back to appending if no selection.
  document.execCommand('insertHTML', false, html);
  // Trigger a save-and-refresh so the block persists immediately.
  if (typeof _wfDocDebouncedSave === 'function') _wfDocDebouncedSave();
  _wfPlanClose();
  toast('Plan inserted');
};

// The block is entirely made of tags/classes the sanitizer preserves:
// div, span, strong, table/thead/tbody/tr/th/td, all classes prefixed
// wf-. contenteditable="false" on the outer div makes the block behave
// as a single unit — click into surrounding paragraphs works but the
// inner labels/values aren't accidentally editable.
function _wfPlanBuildBlockHtml(st) {
  var titleEsc = _wfPlanEsc(st.protocol.title || 'Untitled');
  var h = '<div class="wf-plan-block" contenteditable="false">';
  h += '<div class="wf-plan-head"><span>&#128203;</span><strong>' + titleEsc + '</strong></div>';

  // Scalar fields → simple two-column table
  var scalarRows = [];
  var tableFields = [];
  st.fields.forEach(function(f) {
    if (f.type === 'table') tableFields.push(f);
    else {
      var v = st.values[f.id];
      if (v && String(v).trim()) {
        scalarRows.push('<tr><th>' + _wfPlanEsc(f.label || f.id) + '</th><td>' + _wfPlanEsc(v) + '</td></tr>');
      }
    }
  });
  if (st.note && st.note.trim()) {
    scalarRows.push('<tr><th>Note</th><td>' + _wfPlanEsc(st.note.trim()) + '</td></tr>');
  }
  if (scalarRows.length) {
    h += '<table class="wf-plan-meta"><tbody>' + scalarRows.join('') + '</tbody></table>';
  }

  // Table fields → nested table each, skip if all rows empty
  tableFields.forEach(function(f) {
    var rows = st.values[f.id] || [];
    var nonEmpty = rows.filter(function(row) {
      return (f.columns || []).some(function(c) {
        return row[c.id] != null && String(row[c.id]).trim() !== '';
      });
    });
    if (!nonEmpty.length) return;
    h += '<div style="margin-top:6px">';
    h += '<div style="font-size:12px;color:#8a7f72;font-weight:600;margin-bottom:2px">' + _wfPlanEsc(f.label || f.id) + '</div>';
    h += '<table class="wf-plan-tbl"><thead><tr>';
    (f.columns || []).forEach(function(c) { h += '<th>' + _wfPlanEsc(c.label || c.id) + '</th>'; });
    h += '</tr></thead><tbody>';
    nonEmpty.forEach(function(row) {
      h += '<tr>';
      (f.columns || []).forEach(function(c) {
        h += '<td>' + _wfPlanEsc(row[c.id] || '') + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  });

  h += '</div><p><br></p>';   // trailing empty paragraph → caret lands after the block
  return h;
}

function _wfPlanEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* ── Modal styles (injected once) ────────────────────────────────────── */

var _planStylesInjected = false;
function _wfPlanInjectStyles() {
  if (_planStylesInjected) return;
  _planStylesInjected = true;
  var s = document.createElement('style');
  s.textContent = [
    '.wf-plan-modal { position:fixed; inset:0; z-index:1000; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; }',
    '.wf-plan-modal-inner { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:560px; max-width:92vw; max-height:85vh; display:flex; flex-direction:column; }',
    '.wf-plan-modal-hdr { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #ece7dd; font-weight:600; }',
    '.wf-plan-modal-body { padding:14px; overflow-y:auto; }',
    '.wf-plan-pick { padding:8px 10px; cursor:pointer; border-radius:4px; margin-bottom:2px; }',
    '.wf-plan-pick:hover { background:#f0ebe3; }',
    '.wf-plan-fld { margin-bottom:12px; }',
    '.wf-plan-fld-lbl { display:block; font-size:11px; font-weight:600; color:#8a7f72; letter-spacing:.06em; text-transform:uppercase; margin-bottom:4px; }',
    '.wf-plan-fld-inp { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid #d5cec0; border-radius:3px; background:#fff; font-size:13px; color:#4a4139; font-family:inherit; }',
    '.wf-plan-fld-inp:focus { border-color:#5b7a5e; outline:none; }',
    '.wf-plan-tbl-wrap { }',
    '.wf-plan-tbl-edit { border-collapse:collapse; font-size:12px; margin:0 0 4px 0; width:100%; }',
    '.wf-plan-tbl-edit th, .wf-plan-tbl-edit td { border:1px solid #d5cec0; padding:0; text-align:left; }',
    '.wf-plan-tbl-edit th { background:#e8e2d8; padding:4px 8px; font-weight:600; color:#8a7f72; font-size:11px; }',
    '.wf-plan-tbl-edit td input { width:100%; box-sizing:border-box; border:none; background:transparent; padding:4px 8px; font-size:12px; font-family:inherit; color:#4a4139; outline:none; }',
    '.wf-plan-tbl-edit td input:focus { background:#fff8f0; }',
    '.wf-plan-x { background:transparent; border:none; cursor:pointer; color:#c0b8b0; font-size:14px; padding:2px 6px; }',
    '.wf-plan-x:hover { color:#c0392b; }',
    '.wf-plan-actions { display:flex; justify-content:flex-end; gap:6px; margin-top:12px; padding-top:10px; border-top:1px solid #ece7dd; }',
  ].join('\n');
  document.head.appendChild(s);
}

})();
