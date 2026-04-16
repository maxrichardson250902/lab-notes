/* Genetic Circuit Designer — SBOL Visual circuit drawing with sequence assignment */
/* global api, esc, toast, registerView */

// ── SBOL part definitions ──────────────────────────────────────────────
var SBOL_PARTS = [
  { key: 'promoter',    name: 'Promoter',       color: '#E8A838' },
  { key: 'rbs',         name: 'RBS',            color: '#D4AC0D' },
  { key: 'cds',         name: 'CDS',            color: '#4682B4' },
  { key: 'terminator',  name: 'Terminator',     color: '#C0392B' },
  { key: 'operator',    name: 'Operator',       color: '#8E44AD' },
  { key: 'insulator',   name: 'Insulator',      color: '#1ABC9C' },
  { key: 'origin',      name: 'Origin of Rep',  color: '#8E44AD' },
  { key: 'riboswitch',  name: 'Riboswitch',     color: '#E67E22' },
  { key: 'spacer',      name: 'Spacer',         color: '#BDC3C7' },
  { key: 'scar',        name: 'Scar',           color: '#95A5A6' },
  { key: 'backbone',    name: 'Backbone',       color: '#7F8C8D' },
  { key: 'tag',         name: 'Tag',            color: '#E67E22' },
  { key: 'misc',        name: 'Misc Feature',   color: '#95A5A6' },
];

// ── State ──────────────────────────────────────────────────────────────
var _cd = {
  sequences: [],
  seqFilter: '',
  seqvizReady: false,
  browseType: null,
  browseParsed: null,
  browseLoading: false,
  browseSel: { start: 0, end: 0, crossesOrigin: false },
  parts: [],
  selectedIdx: null,
  nextId: 1,
  name: 'New Circuit',
  dirty: false,
  savedId: null,
  seqPanelOpen: false,
  seqPanelTarget: null,
  savedDesigns: [],
  dragIdx: null,
  dragStartX: 0,
  compositeOpen: false,
};

// ── Cross-feature inbox ────────────────────────────────────────────────
window._circuitInbox = window._circuitInbox || [];

// ── Helpers ────────────────────────────────────────────────────────────
function _cdActiveParts() {
  return _cd.parts.filter(function(p) { return p.seq && p.enabled !== false; });
}
function _cdGetSelSeq(seq, start, end) {
  if (start <= end) return seq.substring(start, end);
  return seq.substring(start) + seq.substring(0, end);
}
function _cdSelLen(seq, start, end) {
  if (start <= end) return end - start;
  return (seq.length - start) + end;
}

// ── Script loading ─────────────────────────────────────────────────────
function _loadScript(src) {
  return new Promise(function(resolve, reject) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) { resolve(); return; }
    var s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = function() { reject(new Error('Failed: ' + src)); };
    document.head.appendChild(s);
  });
}

var _cdScriptsLoaded = false;
function _cdEnsureScripts() {
  if (_cdScriptsLoaded) return Promise.resolve();
  var chain = Promise.resolve();
  if (!window.seqviz) chain = chain.then(function() { return _loadScript('https://unpkg.com/seqviz'); });
  return chain.then(function() {
      _cdScriptsLoaded = true;
      _cd.seqvizReady = true;
    })
    .catch(function(e) { console.error('SeqViz load failed:', e); });
}

// ── SVG Symbol Drawing ─────────────────────────────────────────────────
function _cdDrawSymbol(type, x, y, color, direction, hasSeq) {
  var fill = hasSeq ? color : 'none';
  var stroke = color;
  var dash = hasSeq ? '' : ' stroke-dasharray="4,3"';
  var sw = ' stroke-width="2"';
  var g = '';
  var tx = (direction === -1) ? ' transform="translate(' + (2 * x + 50) + ',0) scale(-1,1)"' : '';

  switch (type) {
    case 'promoter':
      g = '<g' + tx + '>'
        + '<line x1="' + x + '" y1="' + y + '" x2="' + (x + 20) + '" y2="' + y + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '<line x1="' + (x + 20) + '" y1="' + y + '" x2="' + (x + 20) + '" y2="' + (y - 25) + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '<polygon points="' + (x + 20) + ',' + (y - 25) + ' ' + (x + 45) + ',' + (y - 25) + ' ' + (x + 40) + ',' + (y - 30) + '" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'rbs':
      g = '<g' + tx + '>'
        + '<path d="M ' + x + ' ' + y + ' A 15 15 0 0 1 ' + (x + 30) + ' ' + y + '" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'cds':
      var pts = x + ',' + (y - 18) + ' ' + (x + 35) + ',' + (y - 18) + ' ' + (x + 50) + ',' + y + ' ' + (x + 35) + ',' + (y + 18) + ' ' + x + ',' + (y + 18);
      g = '<g' + tx + '><polygon points="' + pts + '" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/></g>';
      break;
    case 'terminator':
      g = '<g' + tx + '>'
        + '<line x1="' + (x + 25) + '" y1="' + y + '" x2="' + (x + 25) + '" y2="' + (y - 28) + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '<line x1="' + (x + 10) + '" y1="' + (y - 28) + '" x2="' + (x + 40) + '" y2="' + (y - 28) + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'operator':
      var dp = 'M ' + (x + 25) + ' ' + (y - 18) + ' L ' + (x + 43) + ' ' + y + ' L ' + (x + 25) + ' ' + (y + 18) + ' L ' + (x + 7) + ' ' + y + ' Z';
      g = '<g' + tx + '><path d="' + dp + '" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/></g>';
      break;
    case 'insulator':
      g = '<g' + tx + '>'
        + '<rect x="' + (x + 8) + '" y="' + (y - 18) + '" width="14" height="36" rx="2" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '<rect x="' + (x + 28) + '" y="' + (y - 18) + '" width="14" height="36" rx="2" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'origin':
      g = '<g' + tx + '><circle cx="' + (x + 25) + '" cy="' + (y - 5) + '" r="16" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/></g>';
      break;
    case 'riboswitch':
      g = '<g' + tx + '>'
        + '<path d="M ' + x + ' ' + y + ' Q ' + (x + 12) + ' ' + (y - 30) + ' ' + (x + 25) + ' ' + (y - 15) + ' Q ' + (x + 38) + ' ' + y + ' ' + (x + 50) + ' ' + y + '" fill="none" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'spacer':
      g = '<g' + tx + '>'
        + '<line x1="' + x + '" y1="' + y + '" x2="' + (x + 50) + '" y2="' + y + '" stroke="' + stroke + '" stroke-width="2" stroke-dasharray="6,4"/>'
        + '</g>';
      break;
    case 'scar':
      g = '<g' + tx + '>'
        + '<line x1="' + (x + 15) + '" y1="' + (y - 12) + '" x2="' + (x + 35) + '" y2="' + (y + 12) + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '<line x1="' + (x + 35) + '" y1="' + (y - 12) + '" x2="' + (x + 15) + '" y2="' + (y + 12) + '" stroke="' + stroke + '"' + sw + dash + '/>'
        + '</g>';
      break;
    case 'tag':
      var fp = x + ',' + (y - 16) + ' ' + (x + 40) + ',' + (y - 16) + ' ' + (x + 40) + ',' + (y + 8) + ' ' + (x + 20) + ',' + (y + 16) + ' ' + x + ',' + (y + 8);
      g = '<g' + tx + '><polygon points="' + fp + '" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/></g>';
      break;
    case 'backbone':
    case 'misc':
    default:
      g = '<g' + tx + '><rect x="' + (x + 5) + '" y="' + (y - 16) + '" width="40" height="32" rx="3" fill="' + fill + '" stroke="' + stroke + '"' + sw + dash + '/></g>';
      break;
  }
  return g;
}

// ── Canvas SVG ─────────────────────────────────────────────────────────
function _cdRenderCanvas() {
  var el = document.getElementById('cd-canvas');
  if (!el) return;
  var parts = _cd.parts;
  var gap = 5;
  var partW = 55;
  var totalW = Math.max(parts.length * partW + 80, 400);
  var h = 140;
  var baseY = 70;

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="' + h + '" viewBox="0 0 ' + totalW + ' ' + h + '" style="cursor:default">';

  // Backbone line
  if (parts.length > 0) {
    var x1 = 15;
    var x2 = parts.length * partW + 25;
    svg += '<line x1="' + x1 + '" y1="' + baseY + '" x2="' + x2 + '" y2="' + baseY + '" stroke="#8a7f72" stroke-width="2.5"/>';
  }

  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    var px = 20 + i * partW;
    var isDisabled = p.enabled === false;
    var opacity = isDisabled ? '0.3' : '1';

    // Selection highlight
    if (_cd.selectedIdx === i) {
      svg += '<rect x="' + (px - 2) + '" y="' + (baseY - 35) + '" width="54" height="70" rx="5" fill="' + p.color + '" fill-opacity="0.13" stroke="' + p.color + '" stroke-width="1.5" stroke-dasharray="4,2"/>';
    }

    // Hit target (invisible, for clicks)
    svg += '<rect x="' + px + '" y="' + (baseY - 35) + '" width="50" height="70" fill="transparent" data-idx="' + i + '" style="cursor:pointer"/>';

    // Symbol + label with opacity for disabled
    svg += '<g opacity="' + opacity + '">';
    svg += _cdDrawSymbol(p.type, px, baseY, p.color, p.direction, !!p.seq);

    // Label
    var lbl = esc(p.name.length > 8 ? p.name.substring(0, 7) + '\u2026' : p.name);
    svg += '<text x="' + (px + 25) + '" y="' + (baseY + 38) + '" text-anchor="middle" font-size="10" font-family="SF Mono,Monaco,Consolas,monospace" fill="#4a4139">' + lbl + '</text>';
    svg += '</g>';
  }

  svg += '</svg>';
  el.innerHTML = svg;

  // Attach click/dblclick/drag handlers
  var rects = el.querySelectorAll('rect[data-idx]');
  for (var j = 0; j < rects.length; j++) {
    (function(rect) {
      var idx = parseInt(rect.getAttribute('data-idx'), 10);
      rect.addEventListener('click', function(e) {
        e.stopPropagation();
        _cdSelectPart(idx);
      });
      rect.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        _cdOpenSeqPanel(idx);
      });
      rect.addEventListener('mousedown', function(e) {
        _cd.dragIdx = idx;
        _cd.dragStartX = e.clientX;
      });
    })(rects[j]);
  }

  // Click on empty = deselect
  el.addEventListener('click', function(e) {
    if (!e.target.getAttribute('data-idx')) {
      _cd.selectedIdx = null;
      _cdRenderInspector();
      _cdRenderCanvas();
    }
  });
}

// Drag-to-reorder
document.addEventListener('mousemove', function(e) {
  if (_cd.dragIdx === null) return;
  var dx = e.clientX - _cd.dragStartX;
  if (Math.abs(dx) > 30) {
    var dir = dx > 0 ? 1 : -1;
    var newIdx = _cd.dragIdx + dir;
    if (newIdx >= 0 && newIdx < _cd.parts.length) {
      var tmp = _cd.parts[_cd.dragIdx];
      _cd.parts[_cd.dragIdx] = _cd.parts[newIdx];
      _cd.parts[newIdx] = tmp;
      if (_cd.selectedIdx === _cd.dragIdx) _cd.selectedIdx = newIdx;
      _cd.dragIdx = newIdx;
      _cd.dragStartX = e.clientX;
      _cd.dirty = true;
      _cdRenderCanvas();
    }
  }
});
document.addEventListener('mouseup', function() {
  _cd.dragIdx = null;
});

// ── Part operations ────────────────────────────────────────────────────
function _cdAddPart(key) {
  var def = SBOL_PARTS.find(function(p) { return p.key === key; });
  if (!def) return;
  _cd.parts.push({
    id: _cd.nextId++,
    type: key,
    name: def.name,
    color: def.color,
    seq: '',
    seqSource: '',
    direction: 1,
    enabled: true,
  });
  _cd.dirty = true;
  _cd.selectedIdx = _cd.parts.length - 1;
  _cdRenderCanvas();
  _cdRenderInspector();
  _cdRenderComposite();
}
window.cdAddPart = _cdAddPart;

function _cdSelectPart(idx) {
  _cd.selectedIdx = idx;
  _cdRenderCanvas();
  _cdRenderInspector();
}

function _cdDeletePart() {
  if (_cd.selectedIdx === null) return;
  _cd.parts.splice(_cd.selectedIdx, 1);
  _cd.selectedIdx = null;
  _cd.dirty = true;
  _cdRenderCanvas();
  _cdRenderInspector();
  _cdRenderComposite();
}
window.cdDeletePart = _cdDeletePart;

// ── Inspector panel ────────────────────────────────────────────────────
function _cdRenderInspector() {
  var el = document.getElementById('cd-inspector');
  if (!el) return;
  if (_cd.selectedIdx === null || !_cd.parts[_cd.selectedIdx]) {
    el.innerHTML = '<div style="color:#8a7f72;padding:18px;text-align:center;font-size:.85rem">Click a part on the canvas to inspect it</div>';
    return;
  }
  var p = _cd.parts[_cd.selectedIdx];
  var idx = _cd.selectedIdx;
  var seqInfo = p.seq
    ? '<span style="color:#5b7a5e;font-weight:600">' + p.seq.length + ' bp</span>' + (p.seqSource ? ' <span style="color:#8a7f72">from ' + esc(p.seqSource) + '</span>' : '')
    : '<span style="color:#8a7f72">No sequence assigned</span>';

  var seqPreview = '';
  if (p.seq) {
    var displaySeq = p.seq.length > 200 ? p.seq.substring(0, 100) + ' ... ' + p.seq.substring(p.seq.length - 100) : p.seq;
    seqPreview = '<div style="margin-top:10px;border-top:1px solid #d5cec0;padding-top:8px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">'
      + '<span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Sequence</span>'
      + '<button onclick="cdCopyPartSeq()" style="padding:2px 8px;border:1px solid #d5cec0;border-radius:3px;background:#faf8f4;cursor:pointer;font-size:.75rem;color:#4a4139">Copy</button>'
      + '</div>'
      + '<div style="background:#f0ebe3;border:1px solid #d5cec0;border-radius:4px;padding:6px 8px;font-family:SF Mono,Monaco,Consolas,monospace;font-size:.75rem;color:#4a4139;max-height:80px;overflow-y:auto;word-break:break-all;line-height:1.4">' + esc(displaySeq) + '</div>'
      + '</div>';
  }

  var enabledChecked = p.enabled !== false ? 'checked' : '';

  el.innerHTML = '<div style="padding:12px 16px">'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<input id="cd-part-enabled" type="checkbox" ' + enabledChecked + ' onchange="cdToggleEnabled()" title="Include in composite" style="width:16px;height:16px;cursor:pointer" />'
    + '<label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Name</label>'
    + '<input id="cd-part-name" type="text" value="' + esc(p.name) + '" style="flex:1;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-family:SF Mono,Monaco,Consolas,monospace;font-size:.85rem;color:#4a4139" />'
    + '<label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Color</label>'
    + '<input id="cd-part-color" type="color" value="' + p.color + '" style="width:32px;height:28px;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;background:none" />'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
    + '<label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Direction</label>'
    + '<button onclick="cdSetDir(1)" style="padding:3px 10px;border:1px solid ' + (p.direction === 1 ? '#5b7a5e' : '#d5cec0') + ';border-radius:4px;background:' + (p.direction === 1 ? '#5b7a5e' : '#faf8f4') + ';color:' + (p.direction === 1 ? '#fff' : '#4a4139') + ';cursor:pointer;font-size:.85rem">\u2192 Fwd</button>'
    + '<button onclick="cdSetDir(-1)" style="padding:3px 10px;border:1px solid ' + (p.direction === -1 ? '#5b7a5e' : '#d5cec0') + ';border-radius:4px;background:' + (p.direction === -1 ? '#5b7a5e' : '#faf8f4') + ';color:' + (p.direction === -1 ? '#fff' : '#4a4139') + ';cursor:pointer;font-size:.85rem">\u2190 Rev</button>'
    + '<span style="margin-left:auto">' + seqInfo + '</span>'
    + '</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button onclick="cdOpenSeqPanel()" style="padding:5px 12px;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.82rem">\uD83D\uDCC2 Assign Sequence</button>'
    + '<button onclick="cdPasteSeq()" style="padding:5px 12px;background:#faf8f4;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;font-size:.82rem;color:#4a4139">\uD83D\uDCCB Paste</button>'
    + '<button onclick="cdClearSeq()" style="padding:5px 12px;background:#faf8f4;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;font-size:.82rem;color:#4a4139">\u2715 Clear Seq</button>'
    + (p.seq ? '<button onclick="cdSavePartToDB()" style="padding:5px 12px;background:#faf8f4;border:1px solid #5b7a5e;border-radius:4px;cursor:pointer;font-size:.82rem;color:#5b7a5e">\uD83D\uDCBE Save to DB</button>' : '')
    + '<button onclick="cdDeletePart()" style="padding:5px 12px;background:#faf8f4;border:1px solid #C0392B;border-radius:4px;cursor:pointer;font-size:.82rem;color:#C0392B;margin-left:auto">\uD83D\uDDD1 Delete</button>'
    + '</div>'
    + seqPreview
    + '</div>';

  // Bind change events
  var nameInput = document.getElementById('cd-part-name');
  var colorInput = document.getElementById('cd-part-color');
  if (nameInput) {
    nameInput.addEventListener('input', function() {
      if (_cd.parts[idx]) { _cd.parts[idx].name = this.value; _cd.dirty = true; _cdRenderCanvas(); }
    });
  }
  if (colorInput) {
    colorInput.addEventListener('input', function() {
      if (_cd.parts[idx]) { _cd.parts[idx].color = this.value; _cd.dirty = true; _cdRenderCanvas(); }
    });
  }
}

function _cdSetDir(d) {
  if (_cd.selectedIdx !== null && _cd.parts[_cd.selectedIdx]) {
    _cd.parts[_cd.selectedIdx].direction = d;
    _cd.dirty = true;
    _cdRenderCanvas();
    _cdRenderInspector();
  }
}
window.cdSetDir = _cdSetDir;

function _cdToggleEnabled() {
  if (_cd.selectedIdx !== null && _cd.parts[_cd.selectedIdx]) {
    _cd.parts[_cd.selectedIdx].enabled = !(_cd.parts[_cd.selectedIdx].enabled !== false);
    _cd.dirty = true;
    _cdRenderCanvas();
    _cdRenderInspector();
    _cdRenderComposite();
  }
}
window.cdToggleEnabled = _cdToggleEnabled;

function _cdSaveComposite() {
  var active = _cdActiveParts();
  if (!active.length) { toast('No enabled parts with sequences'); return; }
  var fullSeq = active.map(function(p) { return p.seq; }).join('');
  // Build annotations at part boundaries
  var anns = [];
  var offset = 0;
  active.forEach(function(p) {
    anns.push({ name: p.name, start: offset, end: offset + p.seq.length, direction: p.direction, color: p.color, type: p.type });
    offset += p.seq.length;
  });
  // Use the circuits save-to-db endpoint
  api('POST', '/api/circuits/export-gb', {
    name: _cd.name || 'Circuit',
    parts: active.map(function(p) {
      return { name: p.name, seq: p.seq, type: p.type, color: p.color, direction: p.direction };
    }),
  }).then(function(r) {
    // Save as plasmid via cloning bulk-save
    var saveName = prompt('Save composite as:', _cd.name || 'Circuit');
    if (!saveName) return;
    return api('POST', '/api/cloning/bulk-save', {
      items: [{
        name: saveName,
        seq: fullSeq,
        type: 'plasmid',
        annotations: anns,
        topology: 'linear',
      }],
      overwrite: true,
    });
  }).then(function(data) {
    if (data) toast('Saved composite: ' + data.saved[0].name + ' (' + data.saved[0].type + ')');
  }).catch(function(e) { toast('Save failed: ' + e.message); });
}
window.cdSaveComposite = _cdSaveComposite;

function _cdClearSeq() {
  if (_cd.selectedIdx !== null && _cd.parts[_cd.selectedIdx]) {
    _cd.parts[_cd.selectedIdx].seq = '';
    _cd.parts[_cd.selectedIdx].seqSource = '';
    _cd.dirty = true;
    _cdRenderCanvas();
    _cdRenderInspector();
    _cdRenderComposite();
  }
}
window.cdClearSeq = _cdClearSeq;

function _cdCopyPartSeq() {
  if (_cd.selectedIdx !== null && _cd.parts[_cd.selectedIdx] && _cd.parts[_cd.selectedIdx].seq) {
    navigator.clipboard.writeText(_cd.parts[_cd.selectedIdx].seq).then(function() { toast('Sequence copied'); });
  }
}
window.cdCopyPartSeq = _cdCopyPartSeq;

// ── Save-to-DB modal ──────────────────────────────────────────────────
var SAVE_TARGETS = [
  { key: 'parts',     label: 'Parts',     fields: ['name','description','sequence','project','subcategory','part_type','notes'] },
  { key: 'kit_parts', label: 'Kit Parts', fields: ['name','kit_name','part_type','description'] },
  { key: 'plasmids',  label: 'Plasmids',  fields: ['name','use'] },
  { key: 'primers',   label: 'Primers',   fields: ['name','sequence','use'] },
];

function _cdOpenSaveModal(mode) {
  // mode: 'single' or 'all'
  if (mode === 'single') {
    if (_cd.selectedIdx === null || !_cd.parts[_cd.selectedIdx] || !_cd.parts[_cd.selectedIdx].seq) {
      toast('No sequence to save'); return;
    }
  } else {
    var withSeq = _cdActiveParts();
    if (!withSeq.length) { toast('No parts have sequences'); return; }
  }
  _cd._saveMode = mode;
  _cd._saveTarget = 'parts';
  _cdRenderSaveModal();
}
window.cdSavePartToDB = function() { _cdOpenSaveModal('single'); };
window.cdSaveAllPartsToDB = function() { _cdOpenSaveModal('all'); };

function _cdCloseSaveModal() {
  var el = document.getElementById('cd-save-modal');
  if (el) el.remove();
}
window.cdCloseSaveModal = _cdCloseSaveModal;

function _cdSetSaveTarget(key) {
  _cd._saveTarget = key;
  _cdRenderSaveModal();
}
window.cdSetSaveTarget = _cdSetSaveTarget;

function _cdRenderSaveModal() {
  _cdCloseSaveModal();
  var mode = _cd._saveMode;
  var targetKey = _cd._saveTarget;
  var target = SAVE_TARGETS.find(function(t) { return t.key === targetKey; });

  // Gather parts to save
  var partsToSave = [];
  if (mode === 'single') {
    partsToSave = [_cd.parts[_cd.selectedIdx]];
  } else {
    partsToSave = _cdActiveParts();
  }

  var overlay = document.createElement('div');
  overlay.id = 'cd-save-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(60,52,42,.35);z-index:2000;display:flex;align-items:center;justify-content:center';

  var partsList = partsToSave.map(function(p) {
    return '<div style="padding:4px 0;font-size:.85rem"><span style="color:#5b7a5e;font-weight:600">' + esc(p.name) + '</span> <span style="color:#8a7f72">' + p.seq.length + ' bp</span></div>';
  }).join('');

  // Target selector tabs
  var tabs = SAVE_TARGETS.map(function(t) {
    var active = t.key === targetKey;
    return '<button onclick="cdSetSaveTarget(\x27' + t.key + '\x27)" style="padding:5px 12px;border:1px solid ' + (active ? '#5b7a5e' : '#d5cec0') + ';border-radius:4px;background:' + (active ? '#5b7a5e' : '#faf8f4') + ';color:' + (active ? '#fff' : '#4a4139') + ';cursor:pointer;font-size:.82rem">' + t.label + '</button>';
  }).join('');

  // Extra fields based on target
  var extraFields = '';
  if (targetKey === 'parts') {
    extraFields = '<div style="display:flex;gap:8px;margin-bottom:8px">'
      + '<div style="flex:1"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Project</label>'
      + '<input id="cd-save-project" type="text" value="' + esc(_cd.name) + '" style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>'
      + '<div style="flex:1"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Subcategory</label>'
      + '<input id="cd-save-subcategory" type="text" value="" style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>'
      + '</div>'
      + '<div style="margin-bottom:8px"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Notes</label>'
      + '<input id="cd-save-notes" type="text" value="" placeholder="Optional notes..." style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>';
  } else if (targetKey === 'kit_parts') {
    extraFields = '<div style="display:flex;gap:8px;margin-bottom:8px">'
      + '<div style="flex:1"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Kit Name</label>'
      + '<input id="cd-save-kit" type="text" value="Circuit Design" style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>'
      + '</div>';
  } else if (targetKey === 'plasmids') {
    extraFields = '<div style="margin-bottom:8px"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Use / Description</label>'
      + '<input id="cd-save-use" type="text" value="Circuit design: ' + esc(_cd.name) + '" style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>';
  } else if (targetKey === 'primers') {
    extraFields = '<div style="margin-bottom:8px"><label style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Use / Description</label>'
      + '<input id="cd-save-use" type="text" value="Circuit design: ' + esc(_cd.name) + '" style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.85rem;color:#4a4139;box-sizing:border-box;margin-top:2px" /></div>';
  }

  overlay.innerHTML = '<div style="background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;padding:20px;width:480px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18)">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'
    + '<span style="font-weight:700;font-size:1rem;color:#4a4139">Save ' + (mode === 'single' ? 'Part' : partsToSave.length + ' Parts') + ' to Database</span>'
    + '<button onclick="cdCloseSaveModal()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#8a7f72">\u2715</button>'
    + '</div>'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;margin-bottom:6px">Save to</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">' + tabs + '</div>'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;margin-bottom:6px">' + (mode === 'single' ? 'Part' : 'Parts') + ' to save</div>'
    + '<div style="background:#f0ebe3;border:1px solid #d5cec0;border-radius:4px;padding:8px 10px;margin-bottom:14px;max-height:120px;overflow-y:auto">' + partsList + '</div>'
    + extraFields
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">'
    + '<button onclick="cdCloseSaveModal()" style="padding:6px 16px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.85rem;color:#4a4139">Cancel</button>'
    + '<button onclick="cdConfirmSave()" style="padding:6px 16px;border:none;border-radius:4px;background:#5b7a5e;color:#fff;cursor:pointer;font-size:.85rem">\uD83D\uDCBE Save</button>'
    + '</div>'
    + '</div>';

  document.body.appendChild(overlay);
  // Close on overlay click
  overlay.addEventListener('click', function(e) { if (e.target === overlay) _cdCloseSaveModal(); });
}

function _cdConfirmSave() {
  var mode = _cd._saveMode;
  var targetKey = _cd._saveTarget;
  var partsToSave = [];
  if (mode === 'single') {
    partsToSave = [_cd.parts[_cd.selectedIdx]];
  } else {
    partsToSave = _cdActiveParts();
  }

  // Gather extra fields
  var extra = {};
  if (targetKey === 'parts') {
    var projEl = document.getElementById('cd-save-project');
    var subEl = document.getElementById('cd-save-subcategory');
    var notesEl = document.getElementById('cd-save-notes');
    extra.project = projEl ? projEl.value : _cd.name;
    extra.subcategory = subEl ? subEl.value : '';
    extra.notes = notesEl ? notesEl.value : '';
  } else if (targetKey === 'kit_parts') {
    var kitEl = document.getElementById('cd-save-kit');
    extra.kit_name = kitEl ? kitEl.value : 'Circuit Design';
  } else if (targetKey === 'plasmids' || targetKey === 'primers') {
    var useEl = document.getElementById('cd-save-use');
    extra.use = useEl ? useEl.value : '';
  }

  api('POST', '/api/circuits/save-to-db', {
    target: targetKey,
    circuit_name: _cd.name,
    extra: extra,
    parts: partsToSave.map(function(p) {
      return {
        name: p.name,
        sequence: p.seq,
        part_type: p.type,
        source: p.seqSource || '',
        direction: p.direction,
      };
    }),
  }).then(function(r) {
    _cdCloseSaveModal();
    var targetLabel = (SAVE_TARGETS.find(function(t) { return t.key === targetKey; }) || {}).label || targetKey;
    toast('Saved ' + r.count + ' to ' + targetLabel);
  }).catch(function(e) { toast('Save failed: ' + e.message); });
}
window.cdConfirmSave = _cdConfirmSave;

function _cdPasteSeq() {
  _cdOpenSeqPanel(_cd.selectedIdx, true);
}
window.cdPasteSeq = _cdPasteSeq;

// ── Composite bar ──────────────────────────────────────────────────────
function _cdRenderComposite() {
  var el = document.getElementById('cd-composite');
  if (!el) return;
  var withSeq = _cdActiveParts();
  var totalBp = 0;
  withSeq.forEach(function(p) { totalBp += p.seq.length; });

  var vizBtnStyle = _cd.compositeOpen
    ? 'padding:4px 10px;border:1px solid #4682B4;border-radius:4px;background:#4682B4;color:#fff;cursor:pointer;font-size:.82rem'
    : 'padding:4px 10px;border:1px solid #4682B4;border-radius:4px;background:#faf8f4;color:#4682B4;cursor:pointer;font-size:.82rem';

  el.innerHTML = '<div style="padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
    + '<span style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72">Composite</span>'
    + '<span style="font-weight:600;color:#4a4139">' + totalBp.toLocaleString() + ' bp</span>'
    + '<span style="color:#8a7f72">(' + withSeq.length + '/' + _cd.parts.length + ' parts with sequence)</span>'
    + '<span style="margin-left:auto;display:flex;gap:6px">'
    + (withSeq.length > 0 ? '<button onclick="cdToggleCompositeViz()" style="' + vizBtnStyle + '">\uD83E\uDDEC ' + (_cd.compositeOpen ? 'Hide' : 'View') + ' Map</button>' : '')
    + '<button onclick="cdCopyComposite()" style="padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">Copy</button>'
    + '<button onclick="cdExportGB()" style="padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">Export .gb</button>'
    + '<button onclick="cdExportSVG()" style="padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">Export SVG</button>'
    + (withSeq.length > 0 ? '<button onclick="cdSaveComposite()" style="padding:4px 10px;border:1px solid #4682B4;border-radius:4px;background:#4682B4;color:#fff;cursor:pointer;font-size:.82rem">\uD83D\uDCBE Save Circuit</button>' : '')
    + '<button onclick="cdSaveAllPartsToDB()" style="padding:4px 10px;border:1px solid #5b7a5e;border-radius:4px;background:#5b7a5e;color:#fff;cursor:pointer;font-size:.82rem">\uD83D\uDCBE Save Parts</button>'
    + '</span>'
    + '</div>';

  // Render or hide composite SeqViz
  _cdRenderCompositeViz();
}

// ── Composite SeqViz viewer ────────────────────────────────────────────
function _cdToggleCompositeViz() {
  _cd.compositeOpen = !_cd.compositeOpen;
  _cdRenderComposite();
}
window.cdToggleCompositeViz = _cdToggleCompositeViz;

function _cdRenderCompositeViz() {
  var el = document.getElementById('cd-composite-seqviz');
  if (!el) return;

  if (!_cd.compositeOpen) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  var withSeq = _cdActiveParts();
  if (!withSeq.length) {
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.innerHTML = '<div style="border-top:1px solid #d5cec0;padding:8px 16px 4px">'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;margin-bottom:6px">\uD83E\uDDEC Composite Sequence Map</div>'
    + '</div>'
    + '<div id="cd-composite-mount" style="height:400px;border:1px solid #d5cec0;margin:0 16px 16px;border-radius:4px;overflow:hidden"></div>';

  // Build concatenated sequence + annotations at part boundaries
  var fullSeq = '';
  var annotations = [];
  withSeq.forEach(function(p) {
    var start = fullSeq.length;
    fullSeq += p.seq;
    var end = fullSeq.length;
    annotations.push({
      name: p.name,
      start: start,
      end: end,
      direction: p.direction || 1,
      color: p.color || '#95A5A6',
    });
  });

  // Load seqviz and render
  _cdEnsureScripts().then(function() {
    var mount = document.getElementById('cd-composite-mount');
    if (!mount || !window.seqviz || typeof window.seqviz.Viewer !== 'function') return;
    mount.innerHTML = '';
    try {
      var viewer = window.seqviz.Viewer('cd-composite-mount', {
        name: _cd.name || 'Circuit',
        seq: fullSeq,
        annotations: annotations,
        style: { height: '100%', width: '100%' },
        viewer: 'both',
        showComplement: true,
        showIndex: true,
      });
      viewer.render();
    } catch (err) {
      console.error('[circuits] Composite SeqViz error:', err);
      mount.innerHTML = '<div style="padding:20px;color:#C0392B">SeqViz error: ' + esc(err.message) + '</div>';
    }
  });
}

// ── Inbox draining (from cloning feature) ──────────────────────────────
function _cdDrainInbox() {
  var inbox = window._circuitInbox;
  if (!inbox || !inbox.length) return;
  var added = 0;
  while (inbox.length > 0) {
    var item = inbox.shift();
    if (!item || !item.seq) continue;
    var sbolType = item.type || 'misc';
    var def = SBOL_PARTS.find(function(p) { return p.key === sbolType; }) || SBOL_PARTS[SBOL_PARTS.length - 1];
    _cd.parts.push({
      id: _cd.nextId++,
      type: sbolType,
      name: item.name || def.name,
      color: def.color,
      seq: item.seq,
      seqSource: item.source || '',
      direction: 1,
      enabled: true,
    });
    added++;
  }
  if (added > 0) {
    _cd.dirty = true;
    _cd.selectedIdx = _cd.parts.length - 1;
    toast(added === 1 ? 'Part added from Cloning' : added + ' parts added from Cloning');
  }
}

function _cdCopyComposite() {
  var seq = _cdActiveParts().map(function(p) { return p.seq; }).join('');
  if (!seq) { toast('No sequences to copy'); return; }
  navigator.clipboard.writeText(seq).then(function() { toast('Composite sequence copied'); });
}
window.cdCopyComposite = _cdCopyComposite;

function _cdExportGB() {
  var partsWithSeq = _cdActiveParts();
  if (!partsWithSeq.length) { toast('No parts have sequences'); return; }
  api('POST', '/api/circuits/export-gb', {
    name: _cd.name,
    parts: partsWithSeq.map(function(p) {
      return { name: p.name, seq: p.seq, type: p.type, color: p.color, direction: p.direction };
    }),
  }).then(function(r) {
    var blob = new Blob([r.gb_content], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (_cd.name || 'circuit').replace(/\s+/g, '_') + '.gb';
    a.click();
    toast('GenBank exported (' + r.length + ' bp, ' + r.num_parts + ' parts)');
  }).catch(function(e) { toast('Export failed: ' + e.message); });
}
window.cdExportGB = _cdExportGB;

function _cdExportSVG() {
  var svgEl = document.querySelector('#cd-canvas svg');
  if (!svgEl) { toast('No canvas to export'); return; }
  var clone = svgEl.cloneNode(true);
  // Remove hit targets
  var trans = clone.querySelectorAll('rect[data-idx]');
  for (var i = 0; i < trans.length; i++) {
    if (trans[i].getAttribute('fill') === 'transparent') trans[i].remove();
  }
  // Remove selection highlights (dashed rects with fill-opacity)
  var rects = clone.querySelectorAll('rect[fill-opacity]');
  for (var j = 0; j < rects.length; j++) rects[j].remove();

  var blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (_cd.name || 'circuit').replace(/\s+/g, '_') + '.svg';
  a.click();
  toast('SVG exported');
}
window.cdExportSVG = _cdExportSVG;

// ── Sequence browser panel ─────────────────────────────────────────────
function _cdOpenSeqPanel(idx, pasteMode) {
  if (idx === undefined || idx === null) idx = _cd.selectedIdx;
  if (idx === null) return;
  _cd.seqPanelTarget = idx;
  _cd.seqPanelOpen = true;
  _cd.browseSel = { start: 0, end: 0, crossesOrigin: false };
  _cdRenderSeqPanel(!!pasteMode);
  // Load sequences if not loaded
  if (!_cd.sequences.length) {
    api('GET', '/api/circuits/sequences').then(function(r) {
      _cd.sequences = (r.items || []).filter(function(s) { return s.has_file; });
      _cdRenderSeqList();
    });
  }
}
window.cdOpenSeqPanel = function() { _cdOpenSeqPanel(_cd.selectedIdx); };

function _cdCloseSeqPanel() {
  _cd.seqPanelOpen = false;
  var el = document.getElementById('cd-seq-panel');
  if (el) el.style.display = 'none';
}
window.cdCloseSeqPanel = _cdCloseSeqPanel;

function _cdRenderSeqPanel(pasteMode) {
  var el = document.getElementById('cd-seq-panel');
  if (!el) return;
  var part = _cd.parts[_cd.seqPanelTarget];
  if (!part) return;
  el.style.display = 'flex';

  el.innerHTML = '<div style="display:flex;flex-direction:column;width:100%;height:100%">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid #d5cec0;background:#f0ebe3">'
    + '<span style="font-weight:600;color:#4a4139">Assign Sequence to: <em>' + esc(part.name) + '</em></span>'
    + '<button onclick="cdCloseSeqPanel()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#8a7f72">\u2715</button>'
    + '</div>'
    + '<div style="display:flex;flex:1;overflow:hidden">'
    // Left sidebar: sequence list
    + '<div id="cd-seq-sidebar" style="width:220px;min-width:180px;border-right:1px solid #d5cec0;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="padding:8px"><input id="cd-seq-filter" type="text" placeholder="Filter..." style="width:100%;padding:4px 8px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;box-sizing:border-box" /></div>'
    + '<div id="cd-seq-list" style="flex:1;overflow-y:auto;padding:0 4px"></div>'
    + '</div>'
    // Right: viewer + controls
    + '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden">'
    + '<div id="cd-seqviz-mount" style="flex:1;overflow:auto;min-height:350px;height:350px;position:relative"></div>'
    + '<div id="cd-seq-controls" style="padding:10px 16px;border-top:1px solid #d5cec0;background:#f0ebe3">'
    + '<div id="cd-sel-info" style="margin-bottom:8px;font-size:.85rem;color:#8a7f72">Select a sequence from the sidebar, then drag to select a region</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button id="cd-btn-reindex" onclick="cdReindex()" style="display:none;padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">\uD83D\uDD04 Reindex</button>'
    + '<button onclick="cdUseSelection()" style="padding:4px 10px;border:1px solid #5b7a5e;border-radius:4px;background:#5b7a5e;color:#fff;cursor:pointer;font-size:.82rem">Use Selection</button>'
    + '<button onclick="cdUseFull()" style="padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">Use Full Sequence</button>'
    + '</div>'
    + '<div style="margin-top:10px;border-top:1px solid #d5cec0;padding-top:10px">'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;margin-bottom:4px">Or paste sequence</div>'
    + '<textarea id="cd-paste-seq" rows="3" placeholder="Paste ATCG sequence..." style="width:100%;padding:6px 8px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-family:SF Mono,Monaco,Consolas,monospace;font-size:.82rem;color:#4a4139;resize:vertical;box-sizing:border-box"></textarea>'
    + '<button onclick="cdUsePasted()" style="margin-top:4px;padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.82rem;color:#4a4139">Use Pasted Sequence</button>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';

  // Filter binding
  var filterInput = document.getElementById('cd-seq-filter');
  if (filterInput) {
    filterInput.addEventListener('input', function() {
      _cd.seqFilter = this.value.toLowerCase();
      _cdRenderSeqList();
    });
  }

  _cdRenderSeqList();

  // If we already had a sequence loaded, re-render it
  if (_cd.browseParsed && !pasteMode) {
    _cdEnsureScripts().then(function() { _cdRenderSeqViz(_cd.browseParsed); });
  }

  // Focus paste area if paste mode
  if (pasteMode) {
    setTimeout(function() {
      var ta = document.getElementById('cd-paste-seq');
      if (ta) ta.focus();
    }, 100);
  }
}

function _cdRenderSeqList() {
  var el = document.getElementById('cd-seq-list');
  if (!el) return;
  var filter = _cd.seqFilter;
  var groups = { kitpart: [], plasmid: [], primer: [] };
  _cd.sequences.forEach(function(s) {
    if (filter && s.name.toLowerCase().indexOf(filter) === -1 && (s.kit_name || '').toLowerCase().indexOf(filter) === -1) return;
    if (groups[s.type]) groups[s.type].push(s);
  });

  var html = '';
  var sections = [
    { key: 'kitpart', label: 'Kit Parts', icon: '\uD83E\uDDF0' },
    { key: 'plasmid', label: 'Plasmids', icon: '\uD83E\uDDEC' },
    { key: 'primer', label: 'Primers', icon: '\uD83E\uDD8A' },
  ];
  sections.forEach(function(sec) {
    var items = groups[sec.key];
    if (!items || !items.length) return;
    html += '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;padding:6px 8px;margin-top:4px">' + sec.icon + ' ' + sec.label + '</div>';
    items.forEach(function(s) {
      var active = _cd.browseType && _cd.browseType.type === s.type && _cd.browseType.id === s.id;
      html += '<div data-stype="' + s.type + '" data-sid="' + s.id + '" style="padding:5px 10px;cursor:pointer;border-radius:4px;margin:1px 4px;font-size:.82rem;color:#4a4139;background:' + (active ? '#e8e2d8' : 'transparent') + '" onmouseover="this.style.background=\x27#e8e2d8\x27" onmouseout="this.style.background=\x27' + (active ? '#e8e2d8' : 'transparent') + '\x27">'
        + esc(s.name)
        + (s.kit_name ? ' <span style="color:#8a7f72;font-size:.75rem">(' + esc(s.kit_name) + ')</span>' : '')
        + '</div>';
    });
  });

  if (!html) html = '<div style="padding:12px;color:#8a7f72;font-size:.82rem;text-align:center">No sequences found</div>';
  el.innerHTML = html;

  // Bind clicks
  var clickable = el.querySelectorAll('[data-stype]');
  for (var i = 0; i < clickable.length; i++) {
    (function(item) {
      item.addEventListener('click', function() {
        var stype = item.getAttribute('data-stype');
        var sid = parseInt(item.getAttribute('data-sid'), 10);
        _cdLoadSequence(stype, sid);
      });
    })(clickable[i]);
  }
}

function _cdLoadSequence(stype, sid) {
  if (_cd.browseLoading) return;
  _cd.browseLoading = true;
  _cd.browseType = { type: stype, id: sid };
  _cd.browseSel = { start: 0, end: 0, crossesOrigin: false };
  var infoEl = document.getElementById('cd-sel-info');
  if (infoEl) infoEl.innerHTML = 'Loading...';

  _cdEnsureScripts().then(function() {
    return api('GET', '/api/circuits/sequences/' + stype + '/' + sid + '/parse');
  }).then(function(parsed) {
    _cd.browseParsed = parsed;
    _cd.browseLoading = false;
    _cdRenderSeqViz(parsed);
    _cdRenderSeqList();
    // Show/hide reindex button
    var btn = document.getElementById('cd-btn-reindex');
    if (btn) btn.style.display = (parsed.topology || '').toLowerCase() === 'circular' ? 'inline-block' : 'none';
    if (infoEl) infoEl.innerHTML = esc(parsed.name) + ' \u2014 ' + parsed.length + ' bp (' + parsed.topology + ')';
  }).catch(function(e) {
    _cd.browseLoading = false;
    toast('Failed to load sequence: ' + e.message);
    if (infoEl) infoEl.innerHTML = 'Error loading sequence';
  });
}

// ── SeqViz rendering ───────────────────────────────────────────────────
function _cdRenderSeqViz(parsed) {
  var el = document.getElementById('cd-seqviz-mount');
  if (!el || !parsed || !window.seqviz || typeof window.seqviz.Viewer !== 'function') return;

  el.innerHTML = '';
  var annotations = (parsed.annotations || []).map(function(a) {
    return { name: a.name, start: a.start, end: a.end, direction: a.direction || 1, color: a.color || '#95A5A6' };
  });
  try {
    var viewer = window.seqviz.Viewer('cd-seqviz-mount', {
      name: parsed.name,
      seq: parsed.seq,
      annotations: annotations,
      style: { height: '100%', width: '100%' },
      viewer: 'both',
      showComplement: true,
      showIndex: true,
      onSelection: _cdOnSelection,
    });
    viewer.render();
    _cd._viewer = viewer; // keep ref for setState on re-renders
  } catch (err) {
    console.error('[circuits] SeqViz render error:', err);
    el.innerHTML = '<div style="padding:20px;color:#C0392B">SeqViz error: ' + esc(err.message) + '</div>';
  }
}

function _cdOnSelection(sel) {
  var start, end;
  if (sel && typeof sel.start === 'number') { start = sel.start; end = sel.end; }
  else if (sel && sel.selection) { start = sel.selection.start; end = sel.selection.end; }
  else return;
  if (start === end && start === 0) return;
  var isCircular = _cd.browseParsed && (_cd.browseParsed.topology || '').toLowerCase() === 'circular';
  var crossesOrigin = false;
  if (start > end) {
    if (isCircular) { crossesOrigin = true; }
    else { var tmp = start; start = end; end = tmp; }
  }
  _cd.browseSel = { start: start, end: end, crossesOrigin: crossesOrigin };
  var infoEl = document.getElementById('cd-sel-info');
  if (infoEl && _cd.browseParsed) {
    var len = _cdSelLen(_cd.browseParsed.seq, start, end);
    infoEl.innerHTML = crossesOrigin
      ? 'Selected ' + start + '\u2192ori\u2192' + end + ' (' + len + ' bp, wraps origin)'
      : 'Selected ' + start + '\u2013' + end + ' (' + len + ' bp)';
  }
}

// ── Use sequence actions ───────────────────────────────────────────────
function _cdUseSelection() {
  if (!_cd.browseParsed || !_cd.browseSel || (_cd.browseSel.start === 0 && _cd.browseSel.end === 0)) {
    toast('No region selected'); return;
  }
  var seq = _cdGetSelSeq(_cd.browseParsed.seq, _cd.browseSel.start, _cd.browseSel.end);
  var len = _cdSelLen(_cd.browseParsed.seq, _cd.browseSel.start, _cd.browseSel.end);
  var srcName = _cd.browseParsed.name || 'sequence';
  var srcLabel = srcName + ' (' + _cd.browseSel.start + '\u2013' + _cd.browseSel.end + ')';
  _cdAssignSeq(seq, srcLabel, srcName);
}
window.cdUseSelection = _cdUseSelection;

function _cdUseFull() {
  if (!_cd.browseParsed) { toast('No sequence loaded'); return; }
  var seq = _cd.browseParsed.seq;
  var srcName = _cd.browseParsed.name || 'sequence';
  _cdAssignSeq(seq, srcName + ' (full, ' + seq.length + ' bp)', srcName);
}
window.cdUseFull = _cdUseFull;

function _cdUsePasted() {
  var ta = document.getElementById('cd-paste-seq');
  if (!ta) return;
  var raw = ta.value.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!raw) { toast('Paste a sequence first'); return; }
  _cdAssignSeq(raw, 'Pasted (' + raw.length + ' bp)', '');
}
window.cdUsePasted = _cdUsePasted;

function _cdAssignSeq(seq, source, seqName) {
  var idx = _cd.seqPanelTarget;
  if (idx === null || !_cd.parts[idx]) return;
  _cd.parts[idx].seq = seq;
  _cd.parts[idx].seqSource = source;
  // Auto-update name if it's still the default type name
  if (seqName) {
    var def = SBOL_PARTS.find(function(p) { return p.key === _cd.parts[idx].type; });
    if (def && _cd.parts[idx].name === def.name) {
      _cd.parts[idx].name = seqName;
    }
  }
  _cd.dirty = true;
  _cdCloseSeqPanel();
  _cdRenderCanvas();
  _cdRenderInspector();
  _cdRenderComposite();
  toast('Sequence assigned (' + seq.length + ' bp)');
}

// ── Reindex ────────────────────────────────────────────────────────────
function _cdReindex() {
  if (!_cd.browseType || !_cd.browseParsed) return;
  var origin = _cd.browseSel.start || 0;
  var newOrigin = prompt('New origin position:', origin);
  if (newOrigin === null) return;
  newOrigin = parseInt(newOrigin, 10);
  if (isNaN(newOrigin)) return;

  api('POST', '/api/circuits/reindex', {
    seq_type: _cd.browseType.type,
    seq_id: _cd.browseType.id,
    new_origin: newOrigin,
  }).then(function(parsed) {
    _cd.browseParsed = parsed;
    _cd.browseSel = { start: 0, end: 0, crossesOrigin: false };
    _cdRenderSeqViz(parsed);
    toast('Reindexed to position ' + newOrigin);
  }).catch(function(e) { toast('Reindex failed: ' + e.message); });
}
window.cdReindex = _cdReindex;

// ── Save / Load ────────────────────────────────────────────────────────
function _cdSave() {
  var partsJson = JSON.stringify(_cd.parts);
  if (_cd.savedId) {
    api('PUT', '/api/circuits/designs/' + _cd.savedId, { name: _cd.name, parts: partsJson })
      .then(function() { _cd.dirty = false; toast('Circuit saved'); _cdLoadDesignList(); })
      .catch(function(e) { toast('Save failed: ' + e.message); });
  } else {
    api('POST', '/api/circuits/designs', { name: _cd.name, parts: partsJson })
      .then(function(r) { _cd.savedId = r.id; _cd.dirty = false; toast('Circuit saved'); _cdLoadDesignList(); })
      .catch(function(e) { toast('Save failed: ' + e.message); });
  }
}
window.cdSave = _cdSave;

function _cdNew() {
  if (_cd.dirty && !confirm('Discard unsaved changes?')) return;
  _cd.parts = [];
  _cd.selectedIdx = null;
  _cd.nextId = 1;
  _cd.name = 'New Circuit';
  _cd.dirty = false;
  _cd.savedId = null;
  _cdRender();
}
window.cdNew = _cdNew;

function _cdLoadDesign(id) {
  api('GET', '/api/circuits/designs/' + id).then(function(r) {
    if (_cd.dirty && !confirm('Discard unsaved changes?')) return;
    _cd.name = r.name;
    _cd.parts = JSON.parse(r.parts || '[]');
    _cd.savedId = r.id;
    _cd.selectedIdx = null;
    _cd.dirty = false;
    // Ensure nextId is above existing IDs
    var maxId = 0;
    _cd.parts.forEach(function(p) { if (p.id > maxId) maxId = p.id; });
    _cd.nextId = maxId + 1;
    _cdRender();
    toast('Loaded: ' + r.name);
  }).catch(function(e) { toast('Load failed: ' + e.message); });
}
window.cdLoadDesign = _cdLoadDesign;

function _cdDeleteDesign(id) {
  if (!confirm('Delete this saved design?')) return;
  api('DELETE', '/api/circuits/designs/' + id).then(function() {
    if (_cd.savedId === id) { _cd.savedId = null; _cd.dirty = true; }
    toast('Design deleted');
    _cdLoadDesignList();
  }).catch(function(e) { toast('Delete failed: ' + e.message); });
}
window.cdDeleteDesign = _cdDeleteDesign;

function _cdLoadDesignList() {
  api('GET', '/api/circuits/designs').then(function(r) {
    _cd.savedDesigns = r.items || [];
    _cdRenderLoadDropdown();
  });
}

function _cdToggleLoadDropdown() {
  var dd = document.getElementById('cd-load-dropdown');
  if (!dd) return;
  if (dd.style.display === 'none' || !dd.style.display) {
    _cdLoadDesignList();
    dd.style.display = 'block';
  } else {
    dd.style.display = 'none';
  }
}
window.cdToggleLoadDropdown = _cdToggleLoadDropdown;

function _cdRenderLoadDropdown() {
  var dd = document.getElementById('cd-load-dropdown');
  if (!dd) return;
  if (!_cd.savedDesigns.length) {
    dd.innerHTML = '<div style="padding:12px;color:#8a7f72;font-size:.82rem">No saved designs</div>';
    return;
  }
  var html = '';
  _cd.savedDesigns.forEach(function(d) {
    var parts = [];
    try { parts = JSON.parse(d.parts || '[]'); } catch(e) {}
    html += '<div style="display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid #e8e2d8">'
      + '<div style="flex:1;cursor:pointer" onclick="cdLoadDesign(' + d.id + ')">'
      + '<div style="font-weight:600;font-size:.85rem;color:#4a4139">' + esc(d.name) + '</div>'
      + '<div style="font-size:.75rem;color:#8a7f72">' + parts.length + ' parts \u2022 ' + d.updated.substring(0, 10) + '</div>'
      + '</div>'
      + '<button onclick="cdDeleteDesign(' + d.id + ')" style="background:none;border:none;cursor:pointer;color:#C0392B;font-size:.9rem" title="Delete">\uD83D\uDDD1</button>'
      + '</div>';
  });
  dd.innerHTML = html;
}

// ── Name editing ───────────────────────────────────────────────────────
function _cdOnNameChange(val) {
  _cd.name = val;
  _cd.dirty = true;
}
window.cdOnNameChange = _cdOnNameChange;

// ── Main render ────────────────────────────────────────────────────────
function _cdRender() {
  var container = document.getElementById('circuits-view');
  if (!container) return;

  // Drain inbox from cloning feature
  _cdDrainInbox();

  container.innerHTML = '<div style="background:#faf8f4;min-height:100vh;color:#4a4139;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">'
    // Top bar
    + '<div style="display:flex;align-items:center;padding:12px 20px;border-bottom:1px solid #d5cec0;gap:12px;flex-wrap:wrap">'
    + '<span style="font-weight:700;font-size:1.05rem;color:#4a4139">Genetic Circuit Designer</span>'
    + '<input id="cd-name-input" type="text" value="' + esc(_cd.name) + '" style="padding:4px 10px;border:1px solid #d5cec0;border-radius:4px;background:#f0ebe3;font-size:.9rem;color:#4a4139;min-width:180px" />'
    + '<span style="margin-left:auto;display:flex;gap:6px">'
    + '<button onclick="cdSave()" style="padding:5px 14px;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:.85rem">Save</button>'
    + '<span style="position:relative">'
    + '<button onclick="cdToggleLoadDropdown()" style="padding:5px 14px;background:#faf8f4;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;font-size:.85rem;color:#4a4139">Load \u25BE</button>'
    + '<div id="cd-load-dropdown" style="display:none;position:absolute;right:0;top:100%;width:280px;background:#faf8f4;border:1px solid #d5cec0;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.1);z-index:100;max-height:320px;overflow-y:auto"></div>'
    + '</span>'
    + '<button onclick="cdNew()" style="padding:5px 14px;background:#faf8f4;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;font-size:.85rem;color:#4a4139">New</button>'
    + '</span>'
    + '</div>'
    // Body
    + '<div style="display:flex">'
    // Left palette
    + '<div style="width:140px;min-width:120px;border-right:1px solid #d5cec0;padding:10px 8px">'
    + '<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#8a7f72;margin-bottom:8px">SBOL Parts</div>'
    + _cdRenderPaletteButtons()
    + '</div>'
    // Main area
    + '<div style="flex:1;display:flex;flex-direction:column;min-width:0">'
    + '<div id="cd-canvas" style="padding:16px;border-bottom:1px solid #d5cec0;overflow-x:auto;min-height:140px"></div>'
    + '<div id="cd-inspector" style="border-bottom:1px solid #d5cec0;min-height:60px"></div>'
    + '<div id="cd-composite" style="min-height:40px"></div>'
    + '<div id="cd-composite-seqviz" style="display:none"></div>'
    + '</div>'
    + '</div>'
    // Seq panel overlay
    + '<div id="cd-seq-panel" style="display:none;position:fixed;top:5vh;left:5vw;right:5vw;bottom:5vh;background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:1000;flex-direction:column;overflow:hidden"></div>'
    + '</div>';

  // Bind name input
  var nameInput = document.getElementById('cd-name-input');
  if (nameInput) {
    nameInput.addEventListener('input', function() { _cdOnNameChange(this.value); });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('cd-load-dropdown');
    if (dd && dd.style.display === 'block' && !e.target.closest('#cd-load-dropdown') && !e.target.closest('[onclick*="cdToggleLoadDropdown"]')) {
      dd.style.display = 'none';
    }
  });

  _cdRenderCanvas();
  _cdRenderInspector();
  _cdRenderComposite();
}

function _cdRenderPaletteButtons() {
  var html = '';
  SBOL_PARTS.forEach(function(p) {
    html += '<button onclick="cdAddPart(\x27' + p.key + '\x27)" style="display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;margin-bottom:3px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;cursor:pointer;font-size:.8rem;color:#4a4139;text-align:left">'
      + '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + p.color + '"></span>'
      + '+ ' + esc(p.name)
      + '</button>';
  });
  return html;
}

// ── Register view ──────────────────────────────────────────────────────
registerView('circuits', function(container) {
  container.innerHTML = '<div id="circuits-view"></div>';
  _cdRender();
});
