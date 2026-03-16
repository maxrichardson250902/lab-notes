/* ═══════════════════════════════════════════════════
   Pipeline — Experimental workflow graph editor
   ═══════════════════════════════════════════════════ */

(function () {

/* ── inject styles once ────────────────────────────── */
if (!document.getElementById('pl-css')) {
  var _css = document.createElement('style');
  _css.id = 'pl-css';
  _css.textContent = `
.pl-root { display: flex; height: 100%; overflow: hidden; }

/* ── sidebar ── */
.pl-sb {
  width: 268px; min-width: 268px;
  background: #faf8f4; border-right: 1px solid #d5cec0;
  display: flex; flex-direction: column; overflow: hidden;
}
.pl-sb-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 14px 10px; border-bottom: 1px solid #e8e2d8; flex-shrink: 0;
}
.pl-sec { font-size: .67rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #8a7f72; }
.pl-ptitle-wrap { padding: 12px 14px 10px; border-bottom: 1px solid #e8e2d8; flex-shrink: 0; }
.pl-ptitle {
  font-size: .97rem; font-weight: 700; color: #4a4139;
  outline: none; border-radius: 4px; padding: 2px 5px; margin: -2px -5px;
  cursor: text; line-height: 1.35;
}
.pl-ptitle:hover { background: #f0ebe3; }
.pl-ptitle:focus { background: #f0ebe3; box-shadow: 0 0 0 2px #5b7a5e44; }
.pl-pdescr { font-size: .75rem; color: #8a7f72; margin-top: 4px; padding: 0 5px; }
.pl-step-lh {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 14px 5px; flex-shrink: 0;
}
.pl-step-scroll { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.pl-sb-foot { padding: 10px 10px; border-top: 1px solid #e8e2d8; flex-shrink: 0; }

/* step cards */
.pl-scrd {
  background: #f5f1eb; border: 1px solid #d5cec0; border-radius: 7px;
  padding: 8px 10px; margin-bottom: 5px; cursor: pointer;
  transition: border-color .14s; position: relative;
}
.pl-scrd:hover { border-color: #b5aca0; }
.pl-scrd-sel { border-color: #5b7a5e !important; background: #edf2ed; }
.pl-sname { font-size: .83rem; font-weight: 600; color: #4a4139; }
.pl-sproto { font-size: .7rem; color: #5b7a5e; margin-top: 2px; }
.pl-snotes { font-size: .7rem; color: #8a7f72; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-sbtns { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; }
.pl-scrd:hover .pl-sbtns { display: flex; }

/* step form */
.pl-sform {
  margin: 4px 8px 8px; background: #f0ebe3; border: 1px solid #d5cec0;
  border-radius: 8px; padding: 12px; flex-shrink: 0;
}
.pl-ftitle { font-size: .65rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #8a7f72; margin-bottom: 8px; }

/* new pipeline form */
.pl-new-form { padding: 10px 12px; background: #f0ebe3; border-bottom: 1px solid #d5cec0; flex-shrink: 0; }
.pl-list { flex: 1; overflow-y: auto; padding: 8px; }
.pl-pcrd {
  background: #f5f1eb; border: 1px solid #d5cec0; border-radius: 7px;
  padding: 10px 12px; margin-bottom: 6px; cursor: pointer;
  transition: border-color .14s, box-shadow .14s;
}
.pl-pcrd:hover { border-color: #5b7a5e; box-shadow: 0 2px 7px rgba(0,0,0,.07); }
.pl-pname { font-size: .89rem; font-weight: 600; color: #4a4139; }
.pl-pdesc { font-size: .74rem; color: #8a7f72; margin-top: 3px; }

.pl-empty { padding: 28px 16px; text-align: center; color: #8a7f72; font-size: .81rem; line-height: 1.65; }
.pl-empty-sm { padding: 12px 4px; text-align: center; color: #8a7f72; font-size: .76rem; }

/* inputs */
.pl-inp {
  width: 100%; box-sizing: border-box;
  background: #faf8f4; border: 1px solid #d5cec0; border-radius: 5px;
  padding: 6px 8px; font-size: .81rem; color: #4a4139;
  font-family: inherit; outline: none; margin-bottom: 5px; display: block;
}
.pl-inp:focus { border-color: #5b7a5e; }
.pl-ta { resize: vertical; min-height: 50px; }
.pl-sel { cursor: pointer; }

/* buttons */
.pl-btn {
  padding: 5px 11px; border-radius: 5px; font-size: .76rem; font-family: inherit;
  border: 1px solid #d5cec0; background: #faf8f4; color: #4a4139;
  cursor: pointer; transition: background .12s, border-color .12s; white-space: nowrap;
}
.pl-btn:hover { background: #f0ebe3; }
.pl-btn-sm { padding: 3px 8px; font-size: .71rem; }
.pl-btn-p { background: #5b7a5e; border-color: #5b7a5e; color: #fff; }
.pl-btn-p:hover { background: #4a6a4d; }
.pl-btn-on { background: #5b7a5e; border-color: #5b7a5e; color: #fff; }
.pl-btn-on:hover { background: #4a6a4d; }
.pl-btn-del { background: transparent; border-color: #c0796a; color: #c0796a; width: 100%; }
.pl-btn-del:hover { background: #c0796a18; }
.pl-btn-back { color: #8a7f72; font-size: .74rem; padding: 3px 8px; }
.pl-row-btns { display: flex; gap: 6px; margin-top: 4px; }
.pl-ibtn { background: none; border: none; cursor: pointer; padding: 2px 4px; font-size: .78rem; color: #8a7f72; border-radius: 3px; }
.pl-ibtn:hover { background: #d5cec0; color: #4a4139; }
.pl-ibtn-d:hover { background: #c0796a22; color: #c0796a; }

/* ── canvas ── */
.pl-cv {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background-color: #ede8df;
  background-image: radial-gradient(circle, #c2b9ad 1px, transparent 1px);
  background-size: 22px 22px;
}
.pl-cv-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background-color: #ede8df;
  background-image: radial-gradient(circle, #c2b9ad 1px, transparent 1px);
  background-size: 22px 22px;
}
.pl-cv-hint { color: #8a7f72; font-size: .87rem; }
.pl-toolbar {
  padding: 8px 12px; display: flex; align-items: center; gap: 10px;
  background: #faf8f4; border-bottom: 1px solid #d5cec0;
  height: 42px; box-sizing: border-box; flex-shrink: 0;
}
.pl-hint { font-size: .74rem; color: #8a7f72; }
.pl-svg { flex: 1; width: 100%; display: block; cursor: default; user-select: none; }

/* ── SVG elements ── */
.pl-node { cursor: grab; }
.pl-ncm { cursor: crosshair; }
.pl-nbg {
  fill: #faf8f4; stroke: #ccc5bb; stroke-width: 1.5;
  filter: drop-shadow(0 1px 4px rgba(0,0,0,.11));
}
.pl-ns .pl-nbg { stroke: #5b7a5e; stroke-width: 2; fill: #edf2ed; }
.pl-ncs .pl-nbg { stroke: #5b7a5e; stroke-width: 2.5; fill: #e4ede4; }
.pl-ncm:hover .pl-nbg { stroke: #8aaa8a; }
.pl-nlbl { font-size: 13px; font-weight: 600; fill: #4a4139; pointer-events: none; }
.pl-nproto { font-size: 10.5px; fill: #5b7a5e; pointer-events: none; }
.pl-nnotes { font-size: 10.5px; fill: #8a7f72; pointer-events: none; }
.pl-edge { fill: none; stroke: #bfb8ae; stroke-width: 2; cursor: pointer; }
.pl-edge:hover { stroke: #c07060; stroke-width: 2.5; }
.pl-eprev {
  fill: none; stroke: #5b7a5e; stroke-width: 2;
  stroke-dasharray: 7,4; pointer-events: none;
  animation: pldash .65s linear infinite;
}
@keyframes pldash { to { stroke-dashoffset: -22; } }
.pl-hdl { fill: #5b7a5e; stroke: #faf8f4; stroke-width: 2.5; cursor: crosshair; }
.pl-hdl:hover { fill: #4a6a4d; }
`;
  document.head.appendChild(_css);
}

/* ═══════════════ STATE ═══════════════ */
var PL = {
  pipelines: [], current: null, protocols: [],
  selectedStep: null, connectMode: false, connectFrom: null,
  editing: null,
  editForm: { name: '', notes: '', protocol_id: '' },
  newForm: { name: '', description: '' },
  showNew: false,
  pan: { x: 40, y: 40 },
  dragging: null,   // { id, ox, oy, sx, sy }
  panning:  null,   // { ox, oy, px, py }
  dragged:  false,
  mouse:    { x: 0, y: 0 },
};

var NW = 164, NH = 62;   // node width / height
var _plEl = null;

/* ═══════════════ HELPERS ═══════════════ */
function plProto(id) {
  return PL.protocols.find(function (p) { return p.id === id; }) || null;
}
function plStep(id) {
  return PL.current
    ? PL.current.steps.find(function (s) { return s.id === id; }) || null
    : null;
}
function trunc(str, n) {
  return str && str.length > n ? str.substring(0, n - 1) + '…' : (str || '');
}
function bezier(from, to) {
  var x1 = from.pos_x + NW, y1 = from.pos_y + NH / 2;
  var x2 = to.pos_x,        y2 = to.pos_y  + NH / 2;
  var cx = Math.max(55, Math.abs(x2 - x1) * 0.44);
  return 'M' + x1 + ',' + y1 +
         ' C' + (x1 + cx) + ',' + y1 +
         ' '  + (x2 - cx) + ',' + y2 +
         ' '  + x2        + ',' + y2;
}
function autoPos() {
  var ss = PL.current ? PL.current.steps : [];
  if (!ss.length) return { x: 80, y: 120 };
  var maxX = Math.max.apply(null, ss.map(function (s) { return s.pos_x; }));
  var avgY = ss.reduce(function (a, s) { return a + s.pos_y; }, 0) / ss.length;
  return { x: maxX + NW + 70, y: Math.round(avgY) };
}
function worldPt(svg, worldEl, e) {
  var pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(worldEl.getScreenCTM().inverse());
}

/* ═══════════════ DRAW ═══════════════ */
function plDraw() {
  if (!_plEl) return;
  _plEl.innerHTML = '<div class="pl-root">' + plSidebar() + plCanvas() + '</div>';
  plBind();
}

/* ── sidebar ── */
function plSidebar() {
  return PL.current ? plSbPipeline() : plSbList();
}

function plSbList() {
  var h = '<div class="pl-sb">';
  h += '<div class="pl-sb-head"><span class="pl-sec">Pipelines</span>';
  h += '<button class="pl-btn pl-btn-sm" onclick="plShowNew()">+ New</button></div>';
  if (PL.showNew) {
    h += '<div class="pl-new-form">';
    h += '<input id="pl-nn" class="pl-inp" placeholder="Pipeline name" value="' + esc(PL.newForm.name) + '">';
    h += '<textarea id="pl-nd" class="pl-inp pl-ta" placeholder="Description (optional)">' + esc(PL.newForm.description) + '</textarea>';
    h += '<div class="pl-row-btns">';
    h += '<button class="pl-btn pl-btn-p" onclick="plCreate()">Create</button>';
    h += '<button class="pl-btn" onclick="plHideNew()">Cancel</button>';
    h += '</div></div>';
  }
  if (!PL.pipelines.length) {
    h += '<div class="pl-empty">No pipelines yet.<br>Create one to start mapping<br>your experimental workflows.</div>';
  } else {
    h += '<div class="pl-list">';
    PL.pipelines.forEach(function (p) {
      h += '<div class="pl-pcrd" onclick="plOpen(' + p.id + ')">';
      h += '<div class="pl-pname">' + esc(p.name) + '</div>';
      if (p.description) h += '<div class="pl-pdesc">' + esc(p.description) + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

function plSbPipeline() {
  var c = PL.current;
  var h = '<div class="pl-sb">';
  h += '<div class="pl-sb-head">';
  h += '<button class="pl-btn pl-btn-back" onclick="plClose()">← Back</button>';
  h += '</div>';
  h += '<div class="pl-ptitle-wrap">';
  h += '<div contenteditable="true" id="pl-ptitle" class="pl-ptitle" onblur="plSaveTitle(this)">' + esc(c.pipeline.name) + '</div>';
  if (c.pipeline.description) h += '<div class="pl-pdescr">' + esc(c.pipeline.description) + '</div>';
  h += '</div>';
  h += '<div class="pl-step-lh">';
  h += '<span class="pl-sec">Steps</span>';
  h += '<button class="pl-btn pl-btn-sm" onclick="plAddStep()">+ Add</button>';
  h += '</div>';
  if (PL.editing !== null) h += plStepForm();
  h += '<div class="pl-step-scroll">';
  if (!c.steps.length) {
    h += '<div class="pl-empty-sm">No steps yet. Add one to begin.</div>';
  } else {
    c.steps.forEach(function (s) {
      var sel = PL.selectedStep === s.id;
      h += '<div class="pl-scrd' + (sel ? ' pl-scrd-sel' : '') + '" onclick="plSelStep(' + s.id + ')">';
      h += '<div class="pl-sname">' + esc(s.name) + '</div>';
      var pr = plProto(s.protocol_id);
      if (pr) h += '<div class="pl-sproto">⬡ ' + esc(pr.title) + '</div>';
      if (s.notes) h += '<div class="pl-snotes">' + esc(s.notes) + '</div>';
      h += '<div class="pl-sbtns">';
      h += '<button class="pl-ibtn" onclick="event.stopPropagation();plEditStep(' + s.id + ')" title="Edit">✎</button>';
      h += '<button class="pl-ibtn pl-ibtn-d" onclick="event.stopPropagation();plDelStep(' + s.id + ')" title="Delete">✕</button>';
      h += '</div></div>';
    });
  }
  h += '</div>';
  h += '<div class="pl-sb-foot"><button class="pl-btn pl-btn-del" onclick="plDelPipeline()">Delete Pipeline</button></div>';
  h += '</div>';
  return h;
}

function plStepForm() {
  var isNew = PL.editing === 'new';
  var h = '<div class="pl-sform">';
  h += '<div class="pl-ftitle">' + (isNew ? 'New Step' : 'Edit Step') + '</div>';
  h += '<input id="pl-sn" class="pl-inp" placeholder="Step name" value="' + esc(PL.editForm.name) + '">';
  h += '<textarea id="pl-sno" class="pl-inp pl-ta" placeholder="Notes (optional)">' + esc(PL.editForm.notes) + '</textarea>';
  h += '<select id="pl-sp" class="pl-inp pl-sel">';
  h += '<option value="">No protocol linked</option>';
  PL.protocols.forEach(function (p) {
    var sel = String(PL.editForm.protocol_id) === String(p.id) ? ' selected' : '';
    h += '<option value="' + p.id + '"' + sel + '>' + esc(p.title) + '</option>';
  });
  h += '</select>';
  h += '<div class="pl-row-btns">';
  h += '<button class="pl-btn pl-btn-p" onclick="plSaveStep()">Save</button>';
  h += '<button class="pl-btn" onclick="plCancelEdit()">Cancel</button>';
  h += '</div></div>';
  return h;
}

/* ── canvas ── */
function plCanvas() {
  if (!PL.current) {
    return '<div class="pl-cv-empty"><div class="pl-cv-hint">← Select a pipeline to view its graph</div></div>';
  }
  var c = PL.current;
  var h = '<div class="pl-cv">';

  /* toolbar */
  h += '<div class="pl-toolbar">';
  if (PL.connectMode) {
    h += '<button class="pl-btn pl-btn-on" onclick="plTogConn()">✕ Cancel</button>';
    h += '<span class="pl-hint">' + (PL.connectFrom ? 'Now click the destination step' : 'Click the source step') + '</span>';
  } else {
    h += '<button class="pl-btn" onclick="plTogConn()">↝ Connect Steps</button>';
    h += '<span class="pl-hint">Drag nodes to reposition · Click edges to remove</span>';
  }
  h += '</div>';

  /* SVG */
  h += '<svg class="pl-svg" id="pl-svg">';
  h += '<defs>';
  /* normal arrowhead */
  h += '<marker id="arr" markerWidth="9" markerHeight="9" refX="8" refY="3.5" orient="auto">';
  h += '<path d="M0,0 L0,7 L9,3.5 z" fill="#b5aca0"/></marker>';
  /* highlight arrowhead (preview / hover) */
  h += '<marker id="arr-hi" markerWidth="9" markerHeight="9" refX="8" refY="3.5" orient="auto">';
  h += '<path d="M0,0 L0,7 L9,3.5 z" fill="#5b7a5e"/></marker>';
  h += '</defs>';

  h += '<g id="pl-world" transform="translate(' + PL.pan.x + ',' + PL.pan.y + ')">';

  /* edges */
  h += '<g id="pl-edges">';
  c.edges.forEach(function (e) {
    var f = plStep(e.from_step), t = plStep(e.to_step);
    if (!f || !t) return;
    h += '<path class="pl-edge" d="' + bezier(f, t) + '" data-eid="' + e.id + '" marker-end="url(#arr)"/>';
  });
  h += '</g>';

  /* preview edge while connecting */
  if (PL.connectMode && PL.connectFrom) {
    var src = plStep(PL.connectFrom);
    if (src) {
      var x1 = src.pos_x + NW, y1 = src.pos_y + NH / 2;
      var x2 = PL.mouse.x,     y2 = PL.mouse.y;
      var cx = Math.max(40, Math.abs(x2 - x1) * 0.4);
      h += '<path class="pl-eprev" d="M' + x1 + ',' + y1 +
           ' C' + (x1 + cx) + ',' + y1 +
           ' ' + (x2 - cx) + ',' + y2 +
           ' ' + x2 + ',' + y2 + '" marker-end="url(#arr-hi)"/>';
    }
  }

  /* nodes */
  h += '<g id="pl-nodes">';
  c.steps.forEach(function (s) {
    var sel  = PL.selectedStep === s.id;
    var csrc = PL.connectFrom  === s.id;
    var cls  = 'pl-node' + (sel ? ' pl-ns' : '') + (csrc ? ' pl-ncs' : '') + (PL.connectMode ? ' pl-ncm' : '');
    h += '<g class="' + cls + '" data-sid="' + s.id + '" transform="translate(' + s.pos_x + ',' + s.pos_y + ')">';
    h += '<rect class="pl-nbg" width="' + NW + '" height="' + NH + '" rx="8"/>';
    h += '<text class="pl-nlbl" x="12" y="26">' + esc(trunc(s.name, 17)) + '</text>';
    var pr = plProto(s.protocol_id);
    if (pr) {
      h += '<text class="pl-nproto" x="12" y="45">⬡ ' + esc(trunc(pr.title, 20)) + '</text>';
    } else if (s.notes) {
      h += '<text class="pl-nnotes" x="12" y="45">' + esc(trunc(s.notes, 22)) + '</text>';
    }
    /* connection handle – only shown when in connect-mode awaiting source pick */
    if (PL.connectMode && !PL.connectFrom) {
      h += '<circle class="pl-hdl" cx="' + NW + '" cy="' + (NH / 2) + '" r="6" data-sid="' + s.id + '"/>';
    }
    h += '</g>';
  });
  h += '</g>';
  h += '</g>'; /* world */
  h += '</svg></div>';
  return h;
}

/* ═══════════════ FAST REDRAW (graph only, no sidebar) ═══════════════ */
function plRedrGraph() {
  var world = document.getElementById('pl-world');
  if (!world || !PL.current) return;

  /* edges */
  var eEl = document.getElementById('pl-edges');
  if (eEl) {
    var eh = '';
    PL.current.edges.forEach(function (e) {
      var f = plStep(e.from_step), t = plStep(e.to_step);
      if (!f || !t) return;
      eh += '<path class="pl-edge" d="' + bezier(f, t) + '" data-eid="' + e.id + '" marker-end="url(#arr)"/>';
    });
    eEl.innerHTML = eh;
  }

  /* preview edge */
  var prev = world.querySelector('.pl-eprev');
  if (prev) prev.remove();
  if (PL.connectMode && PL.connectFrom) {
    var src = plStep(PL.connectFrom);
    if (src) {
      var x1 = src.pos_x + NW, y1 = src.pos_y + NH / 2;
      var x2 = PL.mouse.x, y2 = PL.mouse.y;
      var cx = Math.max(40, Math.abs(x2 - x1) * 0.4);
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'pl-eprev');
      p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + cx) + ',' + y1 + ' ' + (x2 - cx) + ',' + y2 + ' ' + x2 + ',' + y2);
      p.setAttribute('marker-end', 'url(#arr-hi)');
      world.insertBefore(p, document.getElementById('pl-nodes'));
    }
  }

  /* nodes */
  var nEl = document.getElementById('pl-nodes');
  if (nEl) {
    var nh = '';
    PL.current.steps.forEach(function (s) {
      var sel  = PL.selectedStep === s.id;
      var csrc = PL.connectFrom  === s.id;
      var cls  = 'pl-node' + (sel ? ' pl-ns' : '') + (csrc ? ' pl-ncs' : '') + (PL.connectMode ? ' pl-ncm' : '');
      nh += '<g class="' + cls + '" data-sid="' + s.id + '" transform="translate(' + s.pos_x + ',' + s.pos_y + ')">';
      nh += '<rect class="pl-nbg" width="' + NW + '" height="' + NH + '" rx="8"/>';
      nh += '<text class="pl-nlbl" x="12" y="26">' + esc(trunc(s.name, 17)) + '</text>';
      var pr = plProto(s.protocol_id);
      if (pr) {
        nh += '<text class="pl-nproto" x="12" y="45">⬡ ' + esc(trunc(pr.title, 20)) + '</text>';
      } else if (s.notes) {
        nh += '<text class="pl-nnotes" x="12" y="45">' + esc(trunc(s.notes, 22)) + '</text>';
      }
      if (PL.connectMode && !PL.connectFrom) {
        nh += '<circle class="pl-hdl" cx="' + NW + '" cy="' + (NH / 2) + '" r="6" data-sid="' + s.id + '"/>';
      }
      nh += '</g>';
    });
    nEl.innerHTML = nh;
  }

  world.setAttribute('transform', 'translate(' + PL.pan.x + ',' + PL.pan.y + ')');
}

/* ═══════════════ EVENT BINDING ═══════════════ */
function plKeydown(e) {
  if (e.key === 'Escape' && PL.connectMode) {
    PL.connectMode = false; PL.connectFrom = null;
    plDraw();
  }
}

function plBind() {
  document.removeEventListener('keydown', plKeydown);
  var svg = document.getElementById('pl-svg');
  if (!svg) return;
  document.addEventListener('keydown', plKeydown);

  /* mousemove: drag node, pan, preview edge */
  svg.addEventListener('mousemove', function (e) {
    var world = document.getElementById('pl-world');
    if (!world) return;
    var wp = worldPt(svg, world, e);
    PL.mouse = { x: wp.x, y: wp.y };

    if (PL.dragging) {
      PL.dragged = true;
      var s = plStep(PL.dragging.id);
      if (s) {
        s.pos_x = PL.dragging.sx + (wp.x - PL.dragging.ox);
        s.pos_y = PL.dragging.sy + (wp.y - PL.dragging.oy);
      }
      plRedrGraph();
    } else if (PL.panning) {
      PL.dragged = true;
      PL.pan.x = PL.panning.px + (e.clientX - PL.panning.ox);
      PL.pan.y = PL.panning.py + (e.clientY - PL.panning.oy);
      var w2 = document.getElementById('pl-world');
      if (w2) w2.setAttribute('transform', 'translate(' + PL.pan.x + ',' + PL.pan.y + ')');
    } else if (PL.connectMode && PL.connectFrom) {
      plRedrGraph();
    }
  });

  /* mouseup: save position after drag */
  svg.addEventListener('mouseup', function () {
    if (PL.dragging) {
      var s = plStep(PL.dragging.id);
      if (s && PL.dragged) {
        var pid = PL.current.pipeline.id;
        api('PATCH', '/api/pipelines/' + pid + '/steps/' + s.id + '/pos',
            { pos_x: s.pos_x, pos_y: s.pos_y }).catch(function () {});
      }
      PL.dragging = null;
    }
    PL.panning = null;
  });
  /* also catch mouseup outside svg */
  document.addEventListener('mouseup', function () {
    if (PL.dragging) { PL.dragging = null; }
    PL.panning = null;
  }, { once: false });

  /* mousedown: start drag or pan */
  svg.addEventListener('mousedown', function (e) {
    PL.dragged = false;
    var hdl  = e.target.closest('.pl-hdl');
    var node = e.target.closest('[data-sid]');
    var world = document.getElementById('pl-world');

    /* handle click in connect mode */
    if (hdl && PL.connectMode && !PL.connectFrom) {
      PL.connectFrom = parseInt(hdl.dataset.sid);
      plRedrGraph();
      e.stopPropagation(); return;
    }

    /* start node drag (not in connect mode) */
    if (node && !PL.connectMode) {
      var sid = parseInt(node.dataset.sid);
      var s = plStep(sid);
      if (!s) return;
      var wp = worldPt(svg, world, e);
      PL.dragging = { id: sid, ox: wp.x, oy: wp.y, sx: s.pos_x, sy: s.pos_y };
      e.preventDefault(); e.stopPropagation(); return;
    }

    /* pan on empty background */
    if (!node) {
      PL.panning = { ox: e.clientX, oy: e.clientY, px: PL.pan.x, py: PL.pan.y };
    }
  });

  /* click: connect / select / delete edge */
  svg.addEventListener('click', function (e) {
    if (PL.dragged) return;

    var node = e.target.closest('[data-sid]');
    var edge = e.target.closest('.pl-edge');

    if (PL.connectMode) {
      if (node) {
        var sid = parseInt(node.dataset.sid);
        if (!PL.connectFrom) {
          PL.connectFrom = sid; plRedrGraph();
        } else if (PL.connectFrom !== sid) {
          var pid = PL.current.pipeline.id;
          api('POST', '/api/pipelines/' + pid + '/edges',
              { from_step: PL.connectFrom, to_step: sid })
            .then(function (edge) {
              var exists = PL.current.edges.find(function (x) { return x.id === edge.id; });
              if (!exists) PL.current.edges.push(edge);
              PL.connectFrom = null; PL.connectMode = false;
              plDraw(); toast('Connection added');
            }).catch(function () { toast('Failed', true); });
        }
      }
      return;
    }

    if (edge) {
      var eid = parseInt(edge.dataset.eid);
      if (confirm('Remove this connection?')) {
        var pid2 = PL.current.pipeline.id;
        api('DELETE', '/api/pipelines/' + pid2 + '/edges/' + eid).then(function () {
          PL.current.edges = PL.current.edges.filter(function (x) { return x.id !== eid; });
          plRedrGraph(); toast('Connection removed');
        });
      }
      return;
    }

    if (node) {
      var sid2 = parseInt(node.dataset.sid);
      PL.selectedStep = PL.selectedStep === sid2 ? null : sid2;
      plDraw(); return;
    }

    /* click on empty canvas — deselect */
    if (PL.selectedStep !== null) {
      PL.selectedStep = null; plDraw();
    }
  });
}

/* ═══════════════ ACTIONS ═══════════════ */
function plShowNew() {
  PL.showNew = true; PL.newForm = { name: '', description: '' };
  plDraw(); setTimeout(function () { var e = document.getElementById('pl-nn'); if (e) e.focus(); }, 0);
}
function plHideNew() { PL.showNew = false; plDraw(); }

async function plCreate() {
  var n = (document.getElementById('pl-nn').value || '').trim();
  var d = (document.getElementById('pl-nd').value || '').trim();
  if (!n) { toast('Name required', true); return; }
  var p = await api('POST', '/api/pipelines', { name: n, description: d });
  PL.pipelines.unshift(p);
  PL.showNew = false;
  await plOpen(p.id);
}

async function plOpen(id) {
  var data = await api('GET', '/api/pipelines/' + id);
  PL.current = data;
  PL.selectedStep = null; PL.connectMode = false; PL.connectFrom = null;
  PL.editing = null; PL.pan = { x: 40, y: 40 };
  plDraw();
}

async function plClose() {
  var d = await api('GET', '/api/pipelines');
  PL.pipelines = d.items || [];
  PL.current = null; PL.selectedStep = null; PL.connectMode = false;
  PL.connectFrom = null; PL.editing = null;
  document.removeEventListener('keydown', plKeydown);
  plDraw();
}

async function plDelPipeline() {
  if (!confirm('Delete this pipeline and all its steps?')) return;
  await api('DELETE', '/api/pipelines/' + PL.current.pipeline.id);
  toast('Pipeline deleted');
  plClose();
}

async function plSaveTitle(el) {
  var n = el.textContent.trim();
  if (!n) { el.textContent = PL.current.pipeline.name; return; }
  if (n === PL.current.pipeline.name) return;
  var p = await api('PUT', '/api/pipelines/' + PL.current.pipeline.id,
    { name: n, description: PL.current.pipeline.description });
  PL.current.pipeline = p;
  var i = PL.pipelines.findIndex(function (x) { return x.id === p.id; });
  if (i !== -1) PL.pipelines[i] = p;
  toast('Saved');
}

function plSelStep(id) {
  PL.selectedStep = PL.selectedStep === id ? null : id;
  plDraw();
}

function plAddStep() {
  PL.editing = 'new'; PL.editForm = { name: '', notes: '', protocol_id: '' };
  plDraw(); setTimeout(function () { var e = document.getElementById('pl-sn'); if (e) e.focus(); }, 0);
}

function plEditStep(id) {
  var s = plStep(id); if (!s) return;
  PL.editing = id; PL.editForm = { name: s.name, notes: s.notes, protocol_id: s.protocol_id || '' };
  plDraw(); setTimeout(function () { var e = document.getElementById('pl-sn'); if (e) e.focus(); }, 0);
}

function plCancelEdit() { PL.editing = null; plDraw(); }

async function plSaveStep() {
  var n  = (document.getElementById('pl-sn').value  || '').trim();
  var no = (document.getElementById('pl-sno').value || '').trim();
  var pv = document.getElementById('pl-sp').value;
  var protoId = pv ? parseInt(pv) : null;
  if (!n) { toast('Name required', true); return; }
  var pid = PL.current.pipeline.id;

  if (PL.editing === 'new') {
    var pos = autoPos();
    var s = await api('POST', '/api/pipelines/' + pid + '/steps',
      { name: n, notes: no, protocol_id: protoId, pos_x: pos.x, pos_y: pos.y });
    PL.current.steps.push(s);
    PL.editing = null; PL.selectedStep = s.id;
    toast('Step added');
  } else {
    var ex = plStep(PL.editing);
    var s2 = await api('PUT', '/api/pipelines/' + pid + '/steps/' + PL.editing,
      { name: n, notes: no, protocol_id: protoId, pos_x: ex.pos_x, pos_y: ex.pos_y });
    var i = PL.current.steps.findIndex(function (x) { return x.id === s2.id; });
    if (i !== -1) PL.current.steps[i] = s2;
    PL.editing = null; toast('Step updated');
  }
  plDraw();
}

async function plDelStep(id) {
  if (!confirm('Delete this step? Its connections will also be removed.')) return;
  var pid = PL.current.pipeline.id;
  await api('DELETE', '/api/pipelines/' + pid + '/steps/' + id);
  PL.current.steps = PL.current.steps.filter(function (s) { return s.id !== id; });
  PL.current.edges = PL.current.edges.filter(function (e) { return e.from_step !== id && e.to_step !== id; });
  if (PL.selectedStep === id) PL.selectedStep = null;
  toast('Step deleted'); plDraw();
}

function plTogConn() {
  PL.connectMode = !PL.connectMode; PL.connectFrom = null;
  plDraw();
}

/* ═══════════════ REGISTER ═══════════════ */
async function renderPipeline(el) {
  _plEl = el;
  var results = await Promise.all([
    api('GET', '/api/pipelines'),
    api('GET', '/api/pipeline/protocols').catch(function () { return { items: [] }; })
  ]);
  PL.pipelines = results[0].items || [];
  PL.protocols = results[1].items || [];
  /* preserve current pipeline state if user navigates away and back */
  if (!PL.current) {
    PL.pan = { x: 40, y: 40 };
    PL.editing = null; PL.selectedStep = null;
    PL.connectMode = false; PL.connectFrom = null; PL.showNew = false;
  }
  plDraw();
}

registerView('pipeline', renderPipeline);

window.plShowNew    = plShowNew;
window.plHideNew    = plHideNew;
window.plCreate     = plCreate;
window.plOpen       = plOpen;
window.plClose      = plClose;
window.plDelPipeline= plDelPipeline;
window.plSaveTitle  = plSaveTitle;
window.plSelStep    = plSelStep;
window.plAddStep    = plAddStep;
window.plEditStep   = plEditStep;
window.plCancelEdit = plCancelEdit;
window.plSaveStep   = plSaveStep;
window.plDelStep    = plDelStep;
window.plTogConn    = plTogConn;

})(); /* end IIFE */
