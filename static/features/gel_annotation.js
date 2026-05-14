/* Gel Annotation Station */

var G = {
  gels: [],
  gel: null,
  lanes: [],
  selIdx: -1,
  mode: 'lane',
  annotations: { ladderMarks: [] },
  primers: [],
  plasmids: [],
  entries: [],
  zoom: 1,
  dragging: -1,
  dragStartX: 0,
  imgW: 0,
  imgH: 0,
  canvasReady: false,
  dirty: false,
  showUpload: false,
  pastedFile: null,
  _dropdowns: {},
  /* Ladder catalogue — loaded from /api/ladders on render. Each entry:
     { id, slug, name, kind, sizes:[int], image_file, is_preset } */
  ladders: [],
  /* Index of a placed mark the user wants to re-place (strict-top-down workflow):
     null = next click places next-in-list, integer = next click replaces that mark's y. */
  markReplaceIdx: null,
  /* Ladder manager modal state */
  showLadderMgr: false,
  ladderEdit: null,           // null | { id?, slug?, name, kind, sizes:[int], image_file?, _imgFile?:File, _clearImage?:bool }
  ladderRefImageOpen: false,  // toggle for inline reference-image popover
};

/* ── helpers ── */
function gelLadderBySlug(slug) {
  if (!slug) return null;
  for (var i = 0; i < G.ladders.length; i++) {
    if (G.ladders[i].slug === slug) return G.ladders[i];
  }
  return null;
}
function gelActiveLadder() {
  return G.gel ? gelLadderBySlug(G.gel.ladder_type) : null;
}
function gelSizeUnit(ladder) {
  /* Unit label for a size — bp for DNA, kDa for protein. */
  return ladder && ladder.kind === 'protein' ? 'kDa' : 'bp';
}

/* ── helpers ── */
function gelNormX(clientX, canvas) {
  var rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}
function gelNormY(clientY, canvas) {
  var rect = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
}
function gelSizeLabel(val, unit) {
  if (!val) return '';
  var n = parseInt(val, 10);
  if (isNaN(n)) return val;
  /* Default unit is 'bp' (DNA) for backward compatibility with callers that
     don't pass one. Protein ladders pass 'kDa' and display as e.g. '70 kDa'. */
  var u = unit || 'bp';
  if (u === 'kDa') return n + ' kDa';
  return n >= 1000 ? (n / 1000) + ' kb' : n + ' bp';
}

/* ── clipboard paste ── */
function gelInitPaste() {
  if (G._pasteListenerAdded) return;
  G._pasteListenerAdded = true;
  document.addEventListener('paste', function(e) {
    if (S.view !== 'gel_annotation') return;
    var items = (e.clipboardData || {}).items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        if (!blob) return;
        G.pastedFile = blob;
        gelShowUpload();
        gelUpdatePastePreview();
        toast('Image pasted — fill in a title and save');
        return;
      }
    }
  });
}

function gelUpdatePastePreview() {
  var prev = document.getElementById('gelPastePreview');
  var fileEl = document.getElementById('gelNewFile');
  if (G.pastedFile) {
    if (prev) {
      var url = URL.createObjectURL(G.pastedFile);
      prev.innerHTML = '<div style="margin-top:6px"><div style="font-size:.75rem;color:#5b7a5e;margin-bottom:4px">Pasted image ready (' + Math.round(G.pastedFile.size / 1024) + ' KB)</div><img src="' + url + '" style="max-width:100%;max-height:120px;border-radius:4px;border:1px solid #d5cec0"></div>';
    }
    if (fileEl) fileEl.style.display = 'none';
  } else {
    if (prev) prev.innerHTML = '';
    if (fileEl) fileEl.style.display = '';
  }
}

function gelClearPaste() {
  G.pastedFile = null;
  gelUpdatePastePreview();
  var fileEl = document.getElementById('gelNewFile');
  if (fileEl) fileEl.style.display = '';
}

/* ── data loading ── */
async function gelLoadList() {
  var d = await api('GET', '/api/gels');
  G.gels = d.items || [];
}
async function gelLoadRef() {
  try {
    var p1 = api('GET', '/api/primers');
    var p2 = api('GET', '/api/plasmids');
    var p3 = api('GET', '/api/entries?limit=500');
    var r = await Promise.all([p1, p2, p3]);
    G.primers = (r[0].items || []);
    G.plasmids = (r[1].items || []);
    G.entries = (r[2].items || []);
  } catch (e) { /* ignore if endpoints unavailable */ }
}
async function gelLoadGel(id) {
  var d = await api('GET', '/api/gels/' + id);
  G.gel = d;
  G.lanes = d.lanes || [];
  G.selIdx = -1;
  G.mode = 'lane';
  G.zoom = 1;
  var ann = d.annotations;
  if (typeof ann === 'string') { try { ann = JSON.parse(ann); } catch (e) { ann = {}; } }
  G.annotations = ann && ann.ladderMarks ? ann : { ladderMarks: [] };
  G.dirty = false;
}

/* ── save ── */
async function gelSave() {
  if (!G.gel) return;
  var lanesData = G.lanes.map(function(l, i) {
    return {
      lane_number: i + 1,
      sample_name: l.sample_name || '',
      is_ladder: l.is_ladder || false,
      primer_id: l.primer_id || null,
      plasmid_id: l.plasmid_id || null,
      expected_size: l.expected_size || '',
      observed_size: l.observed_size || '',
      notes: l.notes || '',
      x_position: l.x_position
    };
  });
  await api('POST', '/api/gels/' + G.gel.id + '/lanes', { lanes: lanesData });
  await api('PUT', '/api/gels/' + G.gel.id, {
    ladder_type: G.gel.ladder_type || '',
    entry_id: G.gel.entry_id || null,
    annotations: JSON.stringify(G.annotations)
  });
  G.dirty = false;
  toast('Annotations saved');
  gelLoadList();
}

/* ── export ── */
function gelExport() {
  var img = document.getElementById('gelImg');
  var canvas = document.getElementById('gelCanvas');
  if (!img || !canvas) return;
  var exp = document.createElement('canvas');
  exp.width = img.naturalWidth;
  exp.height = img.naturalHeight;
  var ctx = exp.getContext('2d');
  ctx.drawImage(img, 0, 0);
  var scaleX = img.naturalWidth / canvas.width;
  var scaleY = img.naturalHeight / canvas.height;
  ctx.save();
  ctx.scale(scaleX, scaleY);
  gelDrawOnCtx(ctx, canvas.width, canvas.height);
  ctx.restore();
  var link = document.createElement('a');
  link.download = (G.gel ? G.gel.title.replace(/[^a-z0-9]/gi, '_') : 'gel') + '_annotated.png';
  link.href = exp.toDataURL('image/png');
  link.click();
}

/* ── canvas drawing ── */
function gelDrawOverlay() {
  var canvas = document.getElementById('gelCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gelDrawOnCtx(ctx, canvas.width, canvas.height);
}

function gelDrawOnCtx(ctx, w, h) {
  /* scale annotations so they stay readable at any image size */
  var baseFont = Math.max(11, Math.min(16, w / 45));
  var smallFont = Math.max(10, Math.min(14, w / 50));
  var handleR = Math.max(5, Math.min(9, w / 80));
  var labelTrunc = Math.max(8, Math.min(18, Math.floor(w / 40)));

  /* draw lanes */
  G.lanes.forEach(function(lane, i) {
    var x = lane.x_position * w;
    ctx.save();
    ctx.setLineDash(i === G.selIdx ? [6, 3] : [4, 4]);
    ctx.strokeStyle = lane.is_ladder ? '#e8a735' : (i === G.selIdx ? '#5b7a5e' : 'rgba(91,122,94,0.6)');
    ctx.lineWidth = i === G.selIdx ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    /* lane label */
    var label = lane.is_ladder ? 'L' : String(i + 1);
    if (lane.sample_name) label += ': ' + lane.sample_name.substring(0, labelTrunc);
    ctx.font = baseFont + 'px "SF Mono", Monaco, Consolas, monospace';
    ctx.fillStyle = lane.is_ladder ? '#e8a735' : '#5b7a5e';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, baseFont + 4);
    /* drag handle */
    ctx.fillStyle = i === G.selIdx ? '#5b7a5e' : 'rgba(91,122,94,0.5)';
    ctx.beginPath();
    ctx.arc(x, h - handleR - 4, handleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  /* draw ladder marks */
  if (G.annotations.ladderMarks) {
    var ladder = gelActiveLadder();
    var unit = gelSizeUnit(ladder);
    G.annotations.ladderMarks.forEach(function(m, i) {
      var y = m.y * h;
      var isSelected = G.markReplaceIdx === i;
      ctx.save();
      ctx.strokeStyle = isSelected ? '#5b7a5e' : 'rgba(232,167,53,0.7)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.setLineDash(isSelected ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = smallFont + 'px "SF Mono", Monaco, Consolas, monospace';
      ctx.fillStyle = isSelected ? '#5b7a5e' : '#e8a735';
      ctx.textAlign = 'left';
      ctx.fillText(gelSizeLabel(String(m.size), unit), 4, y - 3);
      ctx.restore();
    });
  }
}

function gelInitCanvas() {
  var img = document.getElementById('gelImg');
  var canvas = document.getElementById('gelCanvas');
  if (!img || !canvas) return;
  function resize() {
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    G.imgW = img.clientWidth;
    G.imgH = img.clientHeight;
    gelDrawOverlay();
  }
  if (img.complete && img.naturalWidth) {
    resize();
  }
  img.onload = resize;
  window.addEventListener('resize', resize);

  canvas.onmousedown = function(e) {
    if (e.button !== 0) return;
    var nx = gelNormX(e.clientX, canvas);
    var ny = gelNormY(e.clientY, canvas);
    /* check if clicking near existing lane handle */
    for (var i = 0; i < G.lanes.length; i++) {
      var lx = G.lanes[i].x_position;
      if (Math.abs(lx - nx) < 0.02) {
        G.dragging = i;
        G.dragStartX = nx;
        G.selIdx = i;
        gelDrawOverlay();
        gelRenderLaneEditor();
        return;
      }
    }
    if (G.mode === 'lane') {
      /* add new lane */
      G.lanes.push({
        sample_name: '',
        is_ladder: false,
        primer_id: null,
        plasmid_id: null,
        expected_size: '',
        observed_size: '',
        notes: '',
        x_position: nx
      });
      G.lanes.sort(function(a, b) { return a.x_position - b.x_position; });
      G.selIdx = G.lanes.findIndex(function(l) { return l.x_position === nx; });
      G.dirty = true;
      gelDrawOverlay();
      gelRenderLaneEditor();
    } else if (G.mode === 'ladder') {
      /* Ladder click. Two paths:
         1. Re-place mode: if a placed mark was selected (markReplaceIdx set),
            this click moves that mark's y instead of adding a new one.
         2. Strict top-down: add the NEXT size in the ladder's sizes array,
            regardless of which sizes were already placed. This means a single
            misclick on the top band doesn't cascade — every band after it still
            gets the right size in sequence. To skip a band, click-to-replace it. */
      var ladder = gelActiveLadder();
      if (!ladder) {
        toast('Select a ladder type first', true);
        return;
      }
      if (!G.annotations.ladderMarks) G.annotations.ladderMarks = [];

      if (G.markReplaceIdx !== null && G.annotations.ladderMarks[G.markReplaceIdx]) {
        /* Re-place existing mark */
        G.annotations.ladderMarks[G.markReplaceIdx].y = ny;
        G.annotations.ladderMarks.sort(function(a, b) { return a.y - b.y; });
        G.markReplaceIdx = null;
      } else {
        var placedCount = G.annotations.ladderMarks.length;
        if (placedCount >= ladder.sizes.length) {
          toast('All ladder bands placed');
          return;
        }
        var nextSize = ladder.sizes[placedCount];
        G.annotations.ladderMarks.push({ y: ny, size: nextSize });
        /* Keep marks sorted by y for clean display, but the "next size" logic
           above uses array length, not anything order-dependent, so this is
           cosmetic. */
        G.annotations.ladderMarks.sort(function(a, b) { return a.y - b.y; });
      }
      G.dirty = true;
      gelDrawOverlay();
      gelRenderLadderPanel();
    }
  };

  canvas.onmousemove = function(e) {
    if (G.dragging < 0) return;
    var nx = gelNormX(e.clientX, canvas);
    G.lanes[G.dragging].x_position = nx;
    G.dirty = true;
    gelDrawOverlay();
  };

  canvas.onmouseup = function() {
    if (G.dragging >= 0) {
      G.lanes.sort(function(a, b) { return a.x_position - b.x_position; });
      var moved = G.lanes[G.dragging];
      G.selIdx = G.lanes.indexOf(moved);
      G.dragging = -1;
      gelDrawOverlay();
      gelRenderLaneEditor();
    }
  };

  canvas.onmouseleave = function() {
    if (G.dragging >= 0) {
      G.dragging = -1;
      G.lanes.sort(function(a, b) { return a.x_position - b.x_position; });
      gelDrawOverlay();
    }
  };

  G.canvasReady = true;
}

/* ── upload modal ── */
function gelShowUpload() {
  G.showUpload = true;
  var el = document.getElementById('gelUploadModal');
  if (el) el.style.display = 'flex';
  setTimeout(gelUpdatePastePreview, 0);
}
function gelHideUpload() {
  G.showUpload = false;
  G.pastedFile = null;
  var el = document.getElementById('gelUploadModal');
  if (el) el.style.display = 'none';
}
async function gelDoUpload() {
  var title = document.getElementById('gelNewTitle');
  var desc = document.getElementById('gelNewDesc');
  var typeEl = document.getElementById('gelNewType');
  var fileEl = document.getElementById('gelNewFile');
  if (!title || !title.value.trim()) { toast('Enter a title', true); return; }
  var imageFile = G.pastedFile || (fileEl && fileEl.files.length ? fileEl.files[0] : null);
  if (!imageFile) { toast('Select or paste an image', true); return; }
  var fd = new FormData();
  fd.append('title', title.value.trim());
  fd.append('description', desc ? desc.value.trim() : '');
  fd.append('gel_type', typeEl ? typeEl.value : 'dna');
  fd.append('image', imageFile, G.pastedFile ? 'pasted_gel.png' : imageFile.name);
  try {
    var resp = await fetch('/api/gels', { method: 'POST', body: fd });
    if (!resp.ok) throw new Error('Upload failed');
    var gel = await resp.json();
    toast('Gel created');
    gelHideUpload();
    await gelLoadList();
    await gelLoadGel(gel.id);
    gelRenderFull();
  } catch (e) {
    toast('Upload error: ' + e.message, true);
  }
}

/* ── delete gel ── */
async function gelDelete(id) {
  if (!confirm('Delete this gel and all annotations?')) return;
  await api('DELETE', '/api/gels/' + id);
  toast('Gel deleted');
  G.gel = null;
  G.lanes = [];
  G.selIdx = -1;
  await gelLoadList();
  gelRenderFull();
}

/* ── searchable dropdown ── */
/* Callback & items registry — avoids embedding function refs in HTML strings */
var gelDDReg = {};

function gelDDCall(containerId, id) {
  var reg = gelDDReg[containerId];
  if (reg && reg.cb) reg.cb(id);
}

function gelDropdown(containerId, items, selectedId, onSelectFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  /* register callback and items */
  gelDDReg[containerId] = { cb: onSelectFn, items: items };
  var isOpen = G._dropdowns[containerId] || false;
  var filter = (el.querySelector('.gel-dd-input') || {}).value || '';
  var filtered = items;
  if (filter) {
    var lf = filter.toLowerCase();
    filtered = items.filter(function(it) {
      return (it.label || '').toLowerCase().indexOf(lf) >= 0;
    });
  }
  var selLabel = '';
  if (selectedId) {
    var found = items.find(function(it) { return it.id === selectedId; });
    if (found) selLabel = found.label;
  }
  var cid = containerId;
  var html = '<div class="gel-dd" style="position:relative">';
  html += '<input class="gel-dd-input" type="text" placeholder="Search..." value="' + esc(filter || selLabel) + '" ';
  html += 'onfocus="G._dropdowns[\x27' + cid + '\x27]=true;gelRefreshDD(\x27' + cid + '\x27)" ';
  html += 'oninput="G._dropdowns[\x27' + cid + '\x27]=true;gelFilterDD(\x27' + cid + '\x27,this.value)"';
  html += ' style="width:100%;padding:5px 8px;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.85rem;color:#4a4139">';
  if (selectedId) {
    html += '<span class="gel-dd-clear" onclick="gelDDCall(\x27' + cid + '\x27,null);event.stopPropagation()" style="position:absolute;right:6px;top:6px;cursor:pointer;color:#8a7f72;font-size:.8rem" title="Clear">&times;</span>';
  }
  html += '<div class="gel-dd-list" style="display:' + (isOpen ? 'block' : 'none') + ';position:absolute;z-index:100;left:0;right:0;max-height:180px;overflow-y:auto;background:#faf8f4;border:1px solid #d5cec0;border-radius:0 0 4px 4px;box-shadow:0 4px 12px rgba(60,52,42,.12)">';
  html += gelDDRenderOpts(cid, filtered);
  html += '</div></div>';
  el.innerHTML = html;
  /* close on outside click */
  setTimeout(function() {
    var inp = el.querySelector('.gel-dd-input');
    if (inp) {
      inp.onblur = function() {
        setTimeout(function() {
          G._dropdowns[containerId] = false;
          var list = el.querySelector('.gel-dd-list');
          if (list) list.style.display = 'none';
        }, 200);
      };
    }
  }, 0);
}

function gelDDRenderOpts(containerId, filtered) {
  var html = '';
  if (!filtered.length) {
    html += '<div style="padding:6px 8px;color:#8a7f72;font-size:.8rem">No matches</div>';
  }
  filtered.slice(0, 40).forEach(function(it) {
    html += '<div class="gel-dd-opt" onmousedown="gelDDCall(\x27' + containerId + '\x27,' + it.id + ');G._dropdowns[\x27' + containerId + '\x27]=false" style="padding:5px 8px;cursor:pointer;font-size:.82rem;color:#4a4139;border-bottom:1px solid #ece7dd" onmouseover="this.style.background=\x27#ece7dd\x27" onmouseout="this.style.background=\x27transparent\x27">';
    html += esc(it.label);
    if (it.sub) html += ' <span style="color:#8a7f72;font-size:.75rem">' + esc(it.sub) + '</span>';
    html += '</div>';
  });
  return html;
}

function gelRefreshDD(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var list = el.querySelector('.gel-dd-list');
  if (list) list.style.display = 'block';
}

function gelFilterDD(containerId, val) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var list = el.querySelector('.gel-dd-list');
  if (!list) return;
  var reg = gelDDReg[containerId];
  if (!reg) return;
  var items = reg.items || [];
  var lf = val.toLowerCase();
  var filtered = items.filter(function(it) {
    return (it.label || '').toLowerCase().indexOf(lf) >= 0;
  });
  list.innerHTML = gelDDRenderOpts(containerId, filtered);
  list.style.display = 'block';
}

/* ── primer/plasmid/entry items for dropdowns ── */
function gelPrimerItems() {
  return G.primers.map(function(p) { return { id: p.id, label: p.name, sub: p.use || '' }; });
}
function gelPlasmidItems() {
  return G.plasmids.map(function(p) { return { id: p.id, label: p.name, sub: p.use || '' }; });
}
function gelEntryItems() {
  return G.entries.map(function(e) { return { id: e.id, label: e.title, sub: (e.date || '') + (e.group_name ? ' · ' + e.group_name : '') }; });
}

/* ── lane editor ── */
function gelRenderLaneEditor() {
  var el = document.getElementById('gelLaneEditor');
  if (!el) return;
  if (G.selIdx < 0 || G.selIdx >= G.lanes.length) {
    el.innerHTML = '<div style="padding:16px;color:#8a7f72;font-size:.85rem">Click on the gel image to add a lane, or click an existing lane to edit it.</div>';
    return;
  }
  var lane = G.lanes[G.selIdx];
  var html = '<div class="gel-lane-form">';
  html += '<div class="gel-lane-hdr">';
  html += '<span class="gel-sc">Lane ' + (G.selIdx + 1) + '</span>';
  html += '<div style="display:flex;gap:8px;align-items:center">';
  html += '<label style="font-size:.8rem;color:#8a7f72;display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" ' + (lane.is_ladder ? 'checked' : '') + ' onchange="gelToggleLadder(' + G.selIdx + ',this.checked)"> Ladder lane</label>';
  html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelRemoveLane(' + G.selIdx + ')">Remove</button>';
  html += '</div></div>';

  html += '<div class="gel-lane-grid">';
  html += '<div class="gel-field"><label class="gel-lbl">Sample name</label>';
  html += '<input type="text" value="' + esc(lane.sample_name || '') + '" oninput="gelUpdateLane(' + G.selIdx + ',\x27sample_name\x27,this.value)" class="gel-input"></div>';
  html += '<div class="gel-field"><label class="gel-lbl">Expected size</label>';
  html += '<input type="text" value="' + esc(lane.expected_size || '') + '" placeholder="e.g. 5000 bp" oninput="gelUpdateLane(' + G.selIdx + ',\x27expected_size\x27,this.value)" class="gel-input"></div>';
  html += '<div class="gel-field"><label class="gel-lbl">Observed size</label>';
  html += '<input type="text" value="' + esc(lane.observed_size || '') + '" placeholder="e.g. ~5200 bp" oninput="gelUpdateLane(' + G.selIdx + ',\x27observed_size\x27,this.value)" class="gel-input"></div>';

  /* primer dropdown */
  html += '<div class="gel-field"><label class="gel-lbl">Linked primer</label><div id="gelDDPrimer' + G.selIdx + '"></div></div>';
  /* plasmid dropdown */
  html += '<div class="gel-field"><label class="gel-lbl">Linked plasmid</label><div id="gelDDPlasmid' + G.selIdx + '"></div></div>';

  html += '<div class="gel-field" style="grid-column:1/-1"><label class="gel-lbl">Notes</label>';
  html += '<textarea oninput="gelUpdateLane(' + G.selIdx + ',\x27notes\x27,this.value)" class="gel-input" rows="2">' + esc(lane.notes || '') + '</textarea></div>';
  html += '</div></div>';
  el.innerHTML = html;

  /* render dropdowns after DOM ready */
  setTimeout(function() {
    var idx = G.selIdx;
    window.gelSetPrimer = function(id) { G.lanes[idx].primer_id = id; G.dirty = true; gelRenderLaneEditor(); };
    window.gelSetPlasmid = function(id) { G.lanes[idx].plasmid_id = id; G.dirty = true; gelRenderLaneEditor(); };
    gelDropdown('gelDDPrimer' + idx, gelPrimerItems(), lane.primer_id, window.gelSetPrimer);
    gelDropdown('gelDDPlasmid' + idx, gelPlasmidItems(), lane.plasmid_id, window.gelSetPlasmid);
  }, 0);
}

function gelUpdateLane(idx, field, val) {
  if (idx >= 0 && idx < G.lanes.length) {
    G.lanes[idx][field] = val;
    G.dirty = true;
    gelDrawOverlay();
  }
}

function gelToggleLadder(idx, checked) {
  if (idx >= 0 && idx < G.lanes.length) {
    G.lanes[idx].is_ladder = checked;
    if (checked) G.lanes[idx].sample_name = G.lanes[idx].sample_name || 'Ladder';
    G.dirty = true;
    gelDrawOverlay();
    gelRenderLaneEditor();
  }
}

function gelRemoveLane(idx) {
  G.lanes.splice(idx, 1);
  G.selIdx = -1;
  G.dirty = true;
  gelDrawOverlay();
  gelRenderLaneEditor();
}

function gelClearAllLanes() {
  if (!G.lanes.length) return;
  if (!confirm('Remove all ' + G.lanes.length + ' lane annotations?')) return;
  G.lanes = [];
  G.selIdx = -1;
  G.dirty = true;
  gelDrawOverlay();
  gelRenderLaneEditor();
  gelRenderFull();
}

/* ── ladder panel ── */
function gelRenderLadderPanel() {
  var el = document.getElementById('gelLadderPanel');
  if (!el) return;
  var active = gelActiveLadder();
  var unit = gelSizeUnit(active);

  var html = '<div class="gel-ladder-wrap">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
  html += '<div class="gel-sc">Ladder Configuration</div>';
  html += '<button class="gel-btn-sm" onclick="gelOpenLadderMgr()" title="Manage ladders" style="font-size:.7rem">\u2699 Manage</button>';
  html += '</div>';

  /* Ladder picker + mode buttons */
  html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">';
  html += '<select class="gel-input" style="flex:1;min-width:160px" onchange="gelSetLadderType(this.value)">';
  html += '<option value="">\u2014 Select ladder \u2014</option>';
  /* Group by kind so DNA / Protein ladders are visually separated */
  var byKind = { dna: [], protein: [] };
  G.ladders.forEach(function(l) {
    (byKind[l.kind] || byKind.dna).push(l);
  });
  ['dna', 'protein'].forEach(function(kind) {
    if (!byKind[kind].length) return;
    html += '<optgroup label="' + (kind === 'dna' ? 'DNA' : 'Protein') + '">';
    byKind[kind].forEach(function(l) {
      var sel = (G.gel && G.gel.ladder_type === l.slug) ? ' selected' : '';
      html += '<option value="' + esc(l.slug) + '"' + sel + '>' + esc(l.name) + '</option>';
    });
    html += '</optgroup>';
  });
  html += '</select>';
  html += '<button class="gel-btn-sm" onclick="gelSetMode(\x27ladder\x27)" style="' + (G.mode === 'ladder' ? 'background:#5b7a5e;color:#fff' : '') + '">Place bands</button>';
  html += '<button class="gel-btn-sm" onclick="gelSetMode(\x27lane\x27)" style="' + (G.mode === 'lane' ? 'background:#5b7a5e;color:#fff' : '') + '">Place lanes</button>';
  html += '</div>';

  /* Reference image toggle — only if the active ladder has one */
  if (active && active.image_file) {
    html += '<div style="margin-bottom:8px">';
    html += '<button class="gel-btn-sm" onclick="gelToggleLadderRefImage()" style="font-size:.75rem">' +
            (G.ladderRefImageOpen ? 'Hide' : 'Show') + ' reference image</button>';
    if (G.ladderRefImageOpen) {
      html += '<div style="margin-top:6px;padding:6px;background:#f5f0e5;border:1px solid #d5cec0;border-radius:4px;text-align:center">' +
              '<img src="/api/ladder_images/' + esc(active.image_file) + '" alt="ladder reference" ' +
              'style="max-width:100%;max-height:280px;border-radius:3px">' +
              '</div>';
    }
    html += '</div>';
  }

  /* Placed marks and pending next size */
  if (G.annotations.ladderMarks && G.annotations.ladderMarks.length) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;align-items:center">';
    G.annotations.ladderMarks.forEach(function(m, i) {
      var isReplacing = G.markReplaceIdx === i;
      var bg = isReplacing ? '#5b7a5e' : '#f5f0e5';
      var fg = isReplacing ? '#fff' : '#4a4139';
      html += '<span class="gel-tag" style="background:' + bg + ';color:' + fg + ';cursor:pointer" ' +
              'onclick="gelSelectMarkForReplace(' + i + ')" ' +
              'title="Click then click on the gel to re-place this band">' +
              esc(gelSizeLabel(String(m.size), unit));
      html += ' <span onclick="event.stopPropagation();gelRemoveLadderMark(' + i + ')" ' +
              'style="cursor:pointer;margin-left:2px">&times;</span></span>';
    });
    html += '</div>';

    /* What gets placed on next click (strict top-down) */
    if (active && G.annotations.ladderMarks.length < active.sizes.length && G.markReplaceIdx === null) {
      var nextSize = active.sizes[G.annotations.ladderMarks.length];
      html += '<div style="font-size:.75rem;color:#8a7f72;margin-bottom:6px">Next click places: <strong>' +
              esc(gelSizeLabel(String(nextSize), unit)) + '</strong> (' +
              (G.annotations.ladderMarks.length + 1) + '/' + active.sizes.length + ')</div>';
    }
    if (G.markReplaceIdx !== null) {
      html += '<div style="font-size:.75rem;color:#5b7a5e;margin-bottom:6px">' +
              'Click on the gel to re-place the selected band. ' +
              '<a onclick="gelCancelReplace()" style="cursor:pointer;text-decoration:underline">Cancel</a></div>';
    }
    html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelClearLadderMarks()" style="font-size:.75rem">Clear all marks</button>';
  } else if (active) {
    var firstSize = active.sizes[0];
    html += '<div style="color:#8a7f72;font-size:.8rem">Switch to "Place bands", then click on the gel at the top band. ' +
            'First click places <strong>' + esc(gelSizeLabel(String(firstSize), unit)) + '</strong>.</div>';
  }
  html += '</div>';

  /* Modal markup (rendered into the same panel so visibility flips with state) */
  if (G.showLadderMgr) html += gelRenderLadderMgrModal();

  el.innerHTML = html;
}

function gelSelectMarkForReplace(i) {
  G.markReplaceIdx = (G.markReplaceIdx === i) ? null : i;
  /* Force ladder mode so the next click goes to the right handler. */
  if (G.markReplaceIdx !== null) G.mode = 'ladder';
  gelRenderLadderPanel();
  gelDrawOverlay();
}
function gelCancelReplace() {
  G.markReplaceIdx = null;
  gelRenderLadderPanel();
}
function gelToggleLadderRefImage() {
  G.ladderRefImageOpen = !G.ladderRefImageOpen;
  gelRenderLadderPanel();
}

function gelSetLadderType(val) {
  if (!G.gel) return;
  if (G.gel.ladder_type === val) return;  // no change — don't wipe marks
  G.gel.ladder_type = val;
  /* Switching ladder invalidates previously-placed marks (different sizes,
     possibly different unit). Clear so the user starts fresh on the new one. */
  G.annotations.ladderMarks = [];
  G.markReplaceIdx = null;
  G.ladderRefImageOpen = false;
  G.dirty = true;
  gelDrawOverlay();
  gelRenderLadderPanel();
}

function gelSetMode(mode) {
  G.mode = mode;
  gelRenderLadderPanel();
}

function gelRemoveLadderMark(idx) {
  G.annotations.ladderMarks.splice(idx, 1);
  G.dirty = true;
  gelDrawOverlay();
  gelRenderLadderPanel();
}

function gelClearLadderMarks() {
  G.annotations.ladderMarks = [];
  G.markReplaceIdx = null;
  G.dirty = true;
  gelDrawOverlay();
  gelRenderLadderPanel();
}

/* ── ladder manager ───────────────────────────────────────────
   Modal CRUD for the ladder catalogue. Renders as an overlay over the
   ladder panel area when G.showLadderMgr is true. */

async function gelOpenLadderMgr() {
  /* Refresh the catalogue every time the modal opens so concurrent edits
     by another tab show up. */
  try { await gelLoadLadders(); } catch(e) { toast('Failed to load ladders: ' + e.message, true); return; }
  G.showLadderMgr = true;
  G.ladderEdit = null;
  gelRenderLadderPanel();
}
function gelCloseLadderMgr() {
  G.showLadderMgr = false;
  G.ladderEdit = null;
  gelRenderLadderPanel();
}

async function gelLoadLadders() {
  var data = await api('GET', '/api/ladders');
  G.ladders = data.items || [];
}

function gelLadderMgrNew() {
  G.ladderEdit = { name: '', kind: 'dna', sizes: [], image_file: null };
  gelRenderLadderPanel();
}
function gelLadderMgrEdit(id) {
  var l = G.ladders.find(function(x) { return x.id === id; });
  if (!l) return;
  /* Deep-copy so cancel discards changes cleanly. */
  G.ladderEdit = {
    id: l.id, slug: l.slug, name: l.name, kind: l.kind,
    sizes: l.sizes.slice(),
    image_file: l.image_file,
    is_preset: l.is_preset,
  };
  gelRenderLadderPanel();
}
function gelLadderMgrCancel() {
  G.ladderEdit = null;
  gelRenderLadderPanel();
}

function gelLadderMgrSetField(field, val) {
  if (!G.ladderEdit) return;
  G.ladderEdit[field] = val;
}
function gelLadderMgrSetSizes(rawText) {
  if (!G.ladderEdit) return;
  /* Accept newline, comma, or whitespace separated. Drop blanks and non-numerics. */
  var parts = (rawText || '').split(/[\s,]+/).filter(Boolean);
  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    var n = parseInt(parts[i], 10);
    if (!isNaN(n) && n > 0) nums.push(n);
  }
  G.ladderEdit.sizes = nums;
}
function gelLadderMgrSetImage(input) {
  if (!G.ladderEdit) return;
  if (input.files && input.files[0]) {
    G.ladderEdit._imgFile = input.files[0];
    G.ladderEdit._clearImage = false;
    var lbl = document.getElementById('gelLadderImgLabel');
    if (lbl) lbl.textContent = input.files[0].name;
  }
}
function gelLadderMgrClearImage() {
  if (!G.ladderEdit) return;
  G.ladderEdit._clearImage = true;
  G.ladderEdit._imgFile = null;
  G.ladderEdit.image_file = null;
  gelRenderLadderPanel();
}

async function gelLadderMgrSave() {
  var e = G.ladderEdit;
  if (!e) return;
  if (!e.name || !e.name.trim()) { toast('Name required', true); return; }
  if (!e.sizes || !e.sizes.length) { toast('At least one size required', true); return; }

  var fd = new FormData();
  fd.append('name', e.name.trim());
  fd.append('kind', e.kind);
  fd.append('sizes', JSON.stringify(e.sizes));
  if (e._imgFile) fd.append('image', e._imgFile);
  if (e._clearImage && !e._imgFile) fd.append('clear_image', '1');

  var url = e.id ? '/api/ladders/' + e.id : '/api/ladders';
  var method = e.id ? 'PUT' : 'POST';
  try {
    var resp = await fetch(url, { method: method, body: fd });
    if (!resp.ok) {
      var err = await resp.json().catch(function() { return { detail: 'Save failed' }; });
      throw new Error(err.detail || resp.statusText);
    }
    await gelLoadLadders();
    G.ladderEdit = null;
    /* If we just edited the active ladder, make sure the panel reflects any size changes. */
    gelRenderLadderPanel();
    gelDrawOverlay();
    toast('Ladder saved');
  } catch(err) {
    toast('Save failed: ' + err.message, true);
  }
}

async function gelLadderMgrDelete(id) {
  var l = G.ladders.find(function(x) { return x.id === id; });
  if (!l) return;
  if (l.is_preset) { toast('Cannot delete preset ladders', true); return; }
  if (!confirm('Delete ladder "' + l.name + '"?')) return;
  try {
    var resp = await fetch('/api/ladders/' + id, { method: 'DELETE' });
    if (!resp.ok) {
      var err = await resp.json().catch(function() { return { detail: 'Delete failed' }; });
      throw new Error(err.detail || resp.statusText);
    }
    await gelLoadLadders();
    gelRenderLadderPanel();
    toast('Ladder deleted');
  } catch(err) {
    toast('Delete failed: ' + err.message, true);
  }
}

function gelRenderLadderMgrModal() {
  /* Inline HTML chunk appended to the ladder panel when G.showLadderMgr=true */
  var h = '<div class="gel-modal-overlay" onclick="if(event.target===this)gelCloseLadderMgr()">';
  h += '<div class="gel-modal" style="width:520px;max-width:96vw">';
  h += '<div class="gel-modal-hdr">';
  h += '<span class="gel-sc">Ladder Manager</span>';
  h += '<span onclick="gelCloseLadderMgr()" style="cursor:pointer;font-size:1.2rem;color:#8a7f72">&times;</span>';
  h += '</div>';

  if (G.ladderEdit) {
    /* Editor view */
    var e = G.ladderEdit;
    var isNew = !e.id;
    var isPreset = !!e.is_preset;
    h += '<div class="gel-modal-body">';
    h += '<div style="font-weight:600;margin-bottom:4px">' + (isNew ? 'New ladder' : 'Edit: ' + esc(e.name)) +
         (isPreset ? ' <span style="font-size:.7rem;color:#8a7f72;font-weight:400">(preset \u2014 cannot delete, but you can edit)</span>' : '') +
         '</div>';

    h += '<label class="gel-sc" style="font-size:.7rem">Name</label>';
    h += '<input type="text" class="gel-input" value="' + esc(e.name) + '" ' +
         'oninput="gelLadderMgrSetField(\x27name\x27,this.value)" placeholder="e.g. 1 kb Plus DNA Ladder">';

    h += '<label class="gel-sc" style="font-size:.7rem;margin-top:8px">Kind</label>';
    h += '<select class="gel-input" onchange="gelLadderMgrSetField(\x27kind\x27,this.value)">';
    h += '<option value="dna"' + (e.kind === 'dna' ? ' selected' : '') + '>DNA (bp)</option>';
    h += '<option value="protein"' + (e.kind === 'protein' ? ' selected' : '') + '>Protein (kDa)</option>';
    h += '</select>';

    h += '<label class="gel-sc" style="font-size:.7rem;margin-top:8px">Sizes (top of gel first)</label>';
    h += '<textarea class="gel-input" rows="5" placeholder="One per line, or comma-separated. e.g. 10000, 8000, 6000..." ' +
         'oninput="gelLadderMgrSetSizes(this.value)" ' +
         'style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.82rem">' +
         esc(e.sizes.join('\n')) + '</textarea>';
    h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:2px">' +
         e.sizes.length + ' bands. Order matters \u2014 first entry = top band on the gel.</div>';

    h += '<label class="gel-sc" style="font-size:.7rem;margin-top:8px">Reference image (optional)</label>';
    h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
    h += '<label class="gel-btn-sm" style="cursor:pointer">';
    h += '<input type="file" id="gelLadderImgInput" accept="image/*" style="display:none" ' +
         'onchange="gelLadderMgrSetImage(this)"> Choose image';
    h += '</label>';
    var imgLabel = e._imgFile ? e._imgFile.name : (e.image_file && !e._clearImage ? 'Current image attached' : 'No image');
    h += '<span id="gelLadderImgLabel" style="font-size:.78rem;color:#8a7f72">' + esc(imgLabel) + '</span>';
    if (e.image_file && !e._clearImage) {
      h += '<button class="gel-btn-sm gel-btn-danger" onclick="gelLadderMgrClearImage()" style="font-size:.7rem">Remove</button>';
    }
    h += '</div>';
    if (e.image_file && !e._clearImage && !e._imgFile) {
      h += '<div style="margin-top:6px;text-align:center"><img src="/api/ladder_images/' + esc(e.image_file) +
           '" style="max-height:120px;border:1px solid #d5cec0;border-radius:3px"></div>';
    }
    h += '</div>';
    h += '<div class="gel-modal-footer">';
    h += '<button class="gel-btn-sm" onclick="gelLadderMgrCancel()">Cancel</button>';
    h += '<button class="gel-btn-sm" style="background:#5b7a5e;color:#fff" onclick="gelLadderMgrSave()">Save</button>';
    h += '</div>';
  } else {
    /* List view */
    h += '<div class="gel-modal-body" style="max-height:60vh;overflow-y:auto">';
    if (!G.ladders.length) {
      h += '<div style="color:#8a7f72">No ladders yet.</div>';
    } else {
      G.ladders.forEach(function(l) {
        h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #ece7dd">';
        h += '<div style="flex:1;min-width:0">';
        h += '<div style="font-weight:500">' + esc(l.name) +
             (l.is_preset ? ' <span style="font-size:.65rem;background:#ece7dd;padding:1px 5px;border-radius:3px;color:#8a7f72;font-weight:400">PRESET</span>' : '') +
             '</div>';
        h += '<div style="font-size:.72rem;color:#8a7f72">' +
             (l.kind === 'protein' ? 'Protein' : 'DNA') + ' \u00b7 ' + l.sizes.length + ' bands' +
             (l.image_file ? ' \u00b7 has reference image' : '') + '</div>';
        h += '</div>';
        h += '<button class="gel-btn-sm" onclick="gelLadderMgrEdit(' + l.id + ')" style="font-size:.72rem">Edit</button>';
        if (!l.is_preset) {
          h += '<button class="gel-btn-sm gel-btn-danger" onclick="gelLadderMgrDelete(' + l.id + ')" style="font-size:.72rem">Delete</button>';
        }
        h += '</div>';
      });
    }
    h += '</div>';
    h += '<div class="gel-modal-footer">';
    h += '<button class="gel-btn-sm" onclick="gelCloseLadderMgr()">Close</button>';
    h += '<button class="gel-btn-sm" style="background:#5b7a5e;color:#fff" onclick="gelLadderMgrNew()">+ New ladder</button>';
    h += '</div>';
  }
  h += '</div></div>';
  return h;
}

/* ── entry linking ── */
function gelSetEntry(id) {
  if (G.gel) {
    G.gel.entry_id = id;
    G.dirty = true;
    gelRenderEntryLink();
  }
}
function gelRenderEntryLink() {
  var el = document.getElementById('gelEntryLink');
  if (!el) return;
  var html = '<div class="gel-sc" style="margin-bottom:6px">Linked Notebook Entry</div>';
  html += '<div id="gelDDEntry"></div>';
  /* show clickable link when an entry is linked */
  if (G.gel && G.gel.entry_id) {
    var entry = G.entries.find(function(e) { return e.id === G.gel.entry_id; });
    if (entry) {
      html += '<div class="gel-entry-link" onclick="gelGoToEntry(' + entry.id + ')">';
      html += '<span style="font-size:.85rem">&#128210;</span> ';
      html += '<span style="font-size:.82rem;color:#5b7a5e;text-decoration:underline;cursor:pointer">' + esc(entry.title) + '</span>';
      if (entry.date) html += ' <span style="font-size:.72rem;color:#8a7f72">' + esc(entry.date) + '</span>';
      html += '</div>';
    }
  }
  el.innerHTML = html;
  setTimeout(function() {
    gelDropdown('gelDDEntry', gelEntryItems(), G.gel ? G.gel.entry_id : null, gelSetEntry);
  }, 0);
}

function gelGoToEntry(entryId) {
  /* save first if dirty */
  if (G.dirty) {
    gelSave().then(function() {
      setView('notebook');
      setTimeout(function() { gelTrySelectEntry(entryId); }, 300);
    });
  } else {
    setView('notebook');
    setTimeout(function() { gelTrySelectEntry(entryId); }, 300);
  }
}

function gelTrySelectEntry(entryId) {
  /* try common notebook selection patterns */
  if (typeof window.selectEntry === 'function') { window.selectEntry(entryId); return; }
  if (typeof window.loadEntry === 'function') { window.loadEntry(entryId); return; }
  /* fallback: look for the entry card in DOM and click it */
  var card = document.querySelector('[data-entry-id="' + entryId + '"]');
  if (card) { card.click(); return; }
  /* last resort: try onclick pattern */
  var cards = document.querySelectorAll('[onclick*="' + entryId + '"]');
  if (cards.length) cards[0].click();
}

/* ── cross-feature: render linked gels for a notebook entry ── */
/* Call from notebook JS: gelRenderLinkedGels('containerId', entryId) */
window.gelRenderLinkedGels = async function(containerId, entryId) {
  var el = document.getElementById(containerId);
  if (!el || !entryId) return;
  try {
    var data = await api('GET', '/api/gels?entry_id=' + entryId);
    var gels = data.items || [];
    if (!gels.length) {
      el.innerHTML = '';
      return;
    }
    var html = '<div class="gel-linked-section">';
    html += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;font-weight:600;margin-bottom:6px">Linked Gels</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    gels.forEach(function(g) {
      html += '<div class="gel-linked-card" onclick="setView(\x27gel_annotation\x27);setTimeout(function(){gelSelectGel(' + g.id + ')},300)" style="cursor:pointer;border:1px solid #d5cec0;border-radius:6px;padding:6px;background:#faf8f4;display:flex;gap:8px;align-items:center;transition:background .15s" onmouseover="this.style.background=\x27#ece7dd\x27" onmouseout="this.style.background=\x27#faf8f4\x27">';
      html += '<div style="width:48px;height:48px;min-width:48px;border-radius:4px;background:url(\x27/api/gel_images/' + encodeURIComponent(g.image_file) + '\x27) center/cover;border:1px solid #d5cec0"></div>';
      html += '<div>';
      html += '<div style="font-size:.82rem;font-weight:600;color:#4a4139">' + esc(g.title) + '</div>';
      html += '<div style="font-size:.72rem;color:#8a7f72">' + (g.lane_count || 0) + ' lanes · ' + relTime(g.created) + '</div>';
      html += '</div></div>';
    });
    html += '</div></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '';
  }
};

/* ── gel list sidebar ── */
function gelRenderSidebar() {
  var el = document.getElementById('gelSidebar');
  if (!el) return;
  var html = '<div class="gel-sc" style="margin:12px 12px 8px">Gels</div>';
  if (!G.gels.length) {
    html += '<div style="padding:12px;color:#8a7f72;font-size:.82rem">No gels yet. Click + New Gel to start.</div>';
  }
  G.gels.forEach(function(g) {
    var active = G.gel && G.gel.id === g.id;
    html += '<div class="gel-list-item' + (active ? ' active' : '') + '" onclick="gelSelectGel(' + g.id + ')">';
    html += '<div class="gel-list-thumb" style="background-image:url(\x27/api/gel_images/' + encodeURIComponent(g.image_file) + '\x27)"></div>';
    html += '<div class="gel-list-info">';
    html += '<div class="gel-list-title">' + esc(g.title) + '</div>';
    html += '<div class="gel-list-meta">' + (g.lane_count || 0) + ' lanes · ' + relTime(g.created) + '</div>';
    html += '</div></div>';
  });
  el.innerHTML = html;
}

async function gelSelectGel(id) {
  await gelLoadGel(id);
  gelRenderFull();
}

/* ── zoom ── */
function gelZoom(delta) {
  G.zoom = Math.max(0.5, Math.min(3, G.zoom + delta));
  var wrap = document.getElementById('gelCanvasWrap');
  if (wrap) wrap.style.transform = 'scale(' + G.zoom + ')';
}

/* ── full render ── */
function gelRenderFull() {
  var root = document.getElementById('gelRoot');
  if (!root) return;
  var html = '';

  /* upload modal */
  html += '<div id="gelUploadModal" class="gel-modal-overlay" style="display:none">';
  html += '<div class="gel-modal">';
  html += '<div class="gel-modal-hdr"><span class="gel-sc">New Gel</span><span onclick="gelHideUpload()" style="cursor:pointer;font-size:1.2rem;color:#8a7f72">&times;</span></div>';
  html += '<div class="gel-modal-body">';
  html += '<label class="gel-lbl">Title</label><input id="gelNewTitle" class="gel-input" placeholder="e.g. PCR screen 2025-01-15">';
  html += '<label class="gel-lbl" style="margin-top:8px">Description</label><input id="gelNewDesc" class="gel-input" placeholder="Optional description">';
  html += '<label class="gel-lbl" style="margin-top:8px">Gel type</label><select id="gelNewType" class="gel-input"><option value="dna">DNA</option><option value="protein">Protein</option></select>';
  html += '<label class="gel-lbl" style="margin-top:8px">Image</label><input id="gelNewFile" type="file" accept="image/*" class="gel-input" onchange="gelClearPaste()">';
  html += '<div id="gelPastePreview"></div>';
  html += '<div style="margin-top:6px;font-size:.75rem;color:#8a7f72">Or paste an image from your clipboard (Ctrl+V / Cmd+V)</div>';
  html += '</div>';
  html += '<div class="gel-modal-footer"><button class="gel-btn" onclick="gelDoUpload()">Upload &amp; Create</button><button class="gel-btn-sm" onclick="gelHideUpload()">Cancel</button></div>';
  html += '</div></div>';

  /* main layout */
  html += '<div class="gel-layout">';

  /* sidebar */
  html += '<div class="gel-sidebar-wrap"><div class="gel-sidebar-top">';
  html += '<span class="gel-sc">Gel Annotation Station</span>';
  html += '<button class="gel-btn-sm" onclick="gelShowUpload()" title="New Gel">+ New</button>';
  html += '</div><div id="gelSidebar" class="gel-sidebar-list"></div></div>';

  /* main panel */
  html += '<div class="gel-main-panel">';
  if (!G.gel) {
    html += '<div class="gel-empty"><div style="font-size:1.1rem;color:#4a4139;margin-bottom:8px">No gel selected</div>';
    html += '<div style="color:#8a7f72;font-size:.85rem">Select a gel from the list, create a new one, or paste an image (Ctrl+V).</div></div>';
  } else {
    /* toolbar */
    html += '<div class="gel-toolbar">';
    html += '<div class="gel-toolbar-left">';
    html += '<span style="font-weight:600;color:#4a4139">' + esc(G.gel.title) + '</span>';
    html += '<span class="gel-tag-type">' + esc(G.gel.gel_type || 'dna').toUpperCase() + '</span>';
    if (G.dirty) html += '<span style="color:#e8a735;font-size:.75rem;margin-left:4px">● unsaved</span>';
    html += '</div><div class="gel-toolbar-right">';
    html += '<button class="gel-btn-sm" onclick="gelZoom(0.25)" title="Zoom in">+</button>';
    html += '<button class="gel-btn-sm" onclick="gelZoom(-0.25)" title="Zoom out">−</button>';
    html += '<span style="font-size:.75rem;color:#8a7f72;min-width:40px;text-align:center">' + Math.round(G.zoom * 100) + '%</span>';
    html += '<button class="gel-btn" onclick="gelSave()">Save</button>';
    html += '<button class="gel-btn-sm" onclick="gelExport()" title="Export PNG">Export</button>';
    if (G.lanes.length) html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelClearAllLanes()" title="Remove all lanes">Clear lanes</button>';
    html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelDelete(' + G.gel.id + ')" title="Delete gel">&times;</button>';
    html += '</div></div>';

    /* canvas area */
    html += '<div class="gel-canvas-area"><div class="gel-canvas-scroll">';
    html += '<div id="gelCanvasWrap" class="gel-canvas-wrap" style="transform:scale(' + G.zoom + ')">';
    html += '<img id="gelImg" src="/api/gel_images/' + encodeURIComponent(G.gel.image_file) + '" class="gel-img" draggable="false">';
    html += '<canvas id="gelCanvas" class="gel-canvas"></canvas>';
    html += '</div></div></div>';

    /* controls below image */
    html += '<div class="gel-controls">';
    html += '<div class="gel-controls-left">';
    html += '<div id="gelLadderPanel"></div>';
    html += '<div id="gelEntryLink" style="margin-top:12px"></div>';
    html += '</div>';
    html += '<div class="gel-controls-right" id="gelLaneEditor"></div>';
    html += '</div>';
  }
  html += '</div></div>';

  root.innerHTML = html;

  /* post-render */
  gelRenderSidebar();
  if (G.gel) {
    setTimeout(function() {
      gelInitCanvas();
      gelRenderLaneEditor();
      gelRenderLadderPanel();
      gelRenderEntryLink();
    }, 50);
  }
}

/* ── styles ── */
function gelInjectStyles() {
  if (document.getElementById('gelStyles')) return;
  var style = document.createElement('style');
  style.id = 'gelStyles';
  style.textContent = [
    '.gel-layout { display:flex; height:calc(100vh - 60px); overflow:hidden; }',
    '.gel-sidebar-wrap { width:220px; min-width:220px; border-right:1px solid #d5cec0; background:#faf8f4; display:flex; flex-direction:column; }',
    '.gel-sidebar-top { display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid #ece7dd; }',
    '.gel-sidebar-list { flex:1; overflow-y:auto; }',
    '.gel-list-item { display:flex; gap:8px; padding:8px 12px; cursor:pointer; border-bottom:1px solid #ece7dd; transition:background .15s; }',
    '.gel-list-item:hover, .gel-list-item.active { background:#ece7dd; }',
    '.gel-list-thumb { width:48px; height:48px; min-width:48px; border-radius:4px; background-size:cover; background-position:center; background-color:#e8e2d6; border:1px solid #d5cec0; }',
    '.gel-list-info { overflow:hidden; }',
    '.gel-list-title { font-size:.82rem; font-weight:600; color:#4a4139; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.gel-list-meta { font-size:.72rem; color:#8a7f72; margin-top:2px; }',
    '.gel-main-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; background:#f4f0ea; }',
    '.gel-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; }',
    '.gel-toolbar { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; border-bottom:1px solid #d5cec0; background:#faf8f4; flex-wrap:wrap; gap:6px; }',
    '.gel-toolbar-left { display:flex; align-items:center; gap:8px; }',
    '.gel-toolbar-right { display:flex; align-items:center; gap:6px; }',
    '.gel-canvas-area { flex:1; overflow:auto; position:relative; min-height:200px; display:flex; align-items:center; justify-content:center; }',
    '.gel-canvas-scroll { padding:16px; display:flex; align-items:center; justify-content:center; width:100%; }',
    '.gel-canvas-wrap { position:relative; display:inline-block; transform-origin:center center; }',
    '.gel-img { display:block; max-width:100%; max-height:50vh; height:auto; user-select:none; -webkit-user-drag:none; }',
    '.gel-canvas { position:absolute; top:0; left:0; width:100%; height:100%; cursor:crosshair; }',
    '.gel-controls { display:flex; gap:16px; padding:12px 14px; border-top:1px solid #d5cec0; background:#faf8f4; max-height:280px; overflow-y:auto; flex-wrap:wrap; }',
    '.gel-controls-left { flex:1; min-width:260px; }',
    '.gel-controls-right { flex:2; min-width:320px; }',
    '.gel-lane-form { }',
    '.gel-lane-hdr { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }',
    '.gel-lane-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }',
    '@media (max-width:800px) { .gel-lane-grid { grid-template-columns:1fr 1fr; } }',
    '.gel-sc { font-variant:small-caps; font-size:.72rem; letter-spacing:.12em; color:#8a7f72; font-weight:600; }',
    '.gel-lbl { font-size:.72rem; color:#8a7f72; display:block; margin-bottom:2px; font-variant:small-caps; letter-spacing:.08em; }',
    '.gel-input { width:100%; padding:5px 8px; border:1px solid #d5cec0; border-radius:4px; background:#fff; font-size:.82rem; color:#4a4139; font-family:inherit; box-sizing:border-box; }',
    '.gel-input:focus { outline:none; border-color:#5b7a5e; }',
    '.gel-btn { padding:5px 14px; background:#5b7a5e; color:#fff; border:none; border-radius:4px; font-size:.8rem; cursor:pointer; font-family:inherit; }',
    '.gel-btn:hover { background:#4a6a4d; }',
    '.gel-btn-sm { padding:4px 10px; background:#ece7dd; color:#4a4139; border:1px solid #d5cec0; border-radius:4px; font-size:.75rem; cursor:pointer; font-family:inherit; }',
    '.gel-btn-sm:hover { background:#e0d9cd; }',
    '.gel-btn-danger { color:#c0392b; }',
    '.gel-btn-danger:hover { background:#fce4e0; }',
    '.gel-tag { display:inline-flex; align-items:center; gap:2px; padding:2px 8px; background:#f5f0e5; border:1px solid #d5cec0; border-radius:10px; font-size:.72rem; color:#4a4139; font-family:"SF Mono",Monaco,Consolas,monospace; }',
    '.gel-tag-type { padding:1px 6px; background:#ece7dd; border-radius:3px; font-size:.68rem; color:#8a7f72; font-variant:small-caps; letter-spacing:.06em; }',
    '.gel-modal-overlay { position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; background:rgba(60,52,42,.35); }',
    '.gel-modal { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:420px; max-width:90vw; box-shadow:0 8px 32px rgba(60,52,42,.18); }',
    '.gel-modal-hdr { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #ece7dd; }',
    '.gel-modal-body { padding:16px; display:flex; flex-direction:column; gap:4px; }',
    '.gel-modal-footer { padding:12px 16px; border-top:1px solid #ece7dd; display:flex; gap:8px; justify-content:flex-end; }',
    '.gel-ladder-wrap { }',
    '.gel-field { }',
    '.gel-entry-link { margin-top:6px; padding:6px 8px; background:#f0ebe3; border:1px solid #d5cec0; border-radius:4px; cursor:pointer; display:flex; align-items:center; gap:4px; transition:background .15s; }',
    '.gel-entry-link:hover { background:#e8e2d6; }',
  ].join('\n');
  document.head.appendChild(style);
}

/* ── main render ── */
async function renderGelAnnotation(el) {
  gelInjectStyles();
  gelInitPaste();
  el.innerHTML = '<div id="gelRoot"><div class="gel-empty" style="padding:40px"><span class="gel-sc">Loading…</span></div></div>';
  await Promise.all([gelLoadList(), gelLoadRef(), gelLoadLadders()]);
  gelRenderFull();
}

registerView('gel_annotation', renderGelAnnotation);
