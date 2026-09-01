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
  // Toggled by the Guides checkbox in the toolbar. When false the
  // dashed lane lines / drag handles / dashed ladder rules are
  // suppressed, leaving just labels + short solid ladder ticks.
  showGuides: true,
  // How well labels tilt. 'horizontal' = current (readable across),
  // 'diagonal' = 45° tilt reading bottom-left to top-right (classic
  // gel-photo style; fits narrow wells), 'vertical' = 90° reading
  // bottom-to-top (fits very narrow wells; longest names still fit).
  // Value lives on G so it persists in memory; also mirrored into
  // G.annotations.labelOrientation for save/load round-trip.
  labelOrientation: 'horizontal',
  _dropdowns: {},
  /* Ladder catalogue — loaded from /api/ladders on render. Each entry:
     { id, slug, name, kind, sizes:[int], image_file, is_preset } */
  ladders: [],
  /* Index of a placed mark the user wants to re-place (strict-top-down workflow):
     null = next click places next-in-list, integer = next click replaces that mark's y. */
  markReplaceIdx: null,
  expectedReplaceIdx: null,   // click-then-click re-place index for expectedMarks
  /* Ladder manager modal state */
  showLadderMgr: false,
  ladderEdit: null,           // null | { id?, slug?, name, kind, sizes:[int], image_file?, _imgFile?:File, _clearImage?:bool }
  ladderRefImageOpen: false,  // toggle for inline reference-image popover

  /* ── straighten (de-skew) ──
     G.rotation is the current rotation in DEGREES, clamped [-15, 15].
     Persisted in annotations.rotation. Applied by pre-rendering the raw
     source image into an offscreen canvas (gelGetRotatedCanvas) that
     the display/export code uses as the working image. All annotation
     coords (lane x_position, ladder mark y) are normalised 0..1 in this
     rotated view's bounding box, NOT in raw image pixels. This means
     changing rotation after annotating leaves labels at the same
     fractional position on the new bounding box — fine for small
     de-skew deltas, tracked with a toast warning above 0.5°. */
  rotation: 0,
  straightenMode: false,      // toolbar toggle; when true, canvas clicks add straighten points
  straightenPts: [],          // 0, 1, or 2 {x,y} in overlay-canvas display px
  straightenMouse: null,      // {x,y} for live preview line from point 1 to cursor

  /* ── crop ──
     G.crop is null OR {x,y,w,h} normalised 0..1 in the rotated-view
     coord space (uncropped). Applied at render time by resizing the
     display canvases to the crop rect's aspect ratio and drawing only
     that region of the rotated pre-render. Annotations outside the
     crop are hidden (draw-time filter) but preserved in G.lanes /
     G.annotations.ladderMarks so clearing the crop brings them back. */
  crop: null,
  cropMode: false,            // toolbar toggle; canvas drag defines a crop rect
  cropDrag: null,             // {x0,y0,x1,y1} in overlay-canvas display px during drag
  cropDragging: false,        // true while mouse is down building cropDrag

  /* Rotated pre-render cache. Rebuilt only when G.rotation or the
     source image dims change. Keyed by "<rotation>|<srcW>|<srcH>". */
  _rotCanvas: null,
  _rotCanvasKey: '',

  /* Layout panel: whether the pad-settings popover is open. Panel edits
     global S.settings values directly via /api/settings PUT — no per-gel
     state. Live-repaint on input; save (debounced) on release. */
  layoutPanelOpen: false,
  _layoutSaveTimer: null,
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
function gelClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ── straighten + crop coord helpers ──────────────────────────────────
   Coordinate frames:
   - "raw"       — the on-disk image pixels (img.naturalW × naturalH)
   - "rotated"   — raw image rotated by G.rotation around its centre,
                   in a bounding box that fits the whole rotated image.
                   This is what the offscreen cache holds. All stored
                   annotations are normalised 0..1 in this frame.
   - "cropped"   — the crop rect within rotated frame. When G.crop is
                   set, the display shows only this sub-rect scaled to
                   the canvas.
   - "display"   — the overlay canvas pixel coords (what mouse events
                   give us via gelNormX/Y).                              */

function gelInvalidateRotCache() {
  G._rotCanvas = null;
  G._rotCanvasKey = '';
}

// Builds (or returns cached) offscreen canvas containing the raw image
// rotated by G.rotation. Bounding box grows to fit — corners of the
// original image poke into the new corners; areas outside are
// transparent. Returns null if the img element isn't ready yet.
function gelGetRotatedCanvas() {
  var img = document.getElementById('gelImg');
  if (!img || !img.naturalWidth) return null;
  var rot = G.rotation || 0;
  var srcW = img.naturalWidth, srcH = img.naturalHeight;
  var key = rot.toFixed(4) + '|' + srcW + '|' + srcH;
  if (G._rotCanvas && G._rotCanvasKey === key) return G._rotCanvas;
  var rad = rot * Math.PI / 180;
  var cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  var bboxW = Math.max(1, Math.ceil(srcW * cos + srcH * sin));
  var bboxH = Math.max(1, Math.ceil(srcW * sin + srcH * cos));
  var c = document.createElement('canvas');
  c.width = bboxW; c.height = bboxH;
  var ctx = c.getContext('2d');
  ctx.translate(bboxW / 2, bboxH / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -srcW / 2, -srcH / 2);
  G._rotCanvas = c;
  G._rotCanvasKey = key;
  return c;
}

// Returns the current view's rotated-frame rect being displayed:
// { x, y, w, h } in rotated-frame pixels. Full bounding box when no
// crop, sub-rect when cropped.
function gelViewRect() {
  var rc = gelGetRotatedCanvas();
  if (!rc) return null;
  if (G.crop) {
    return {
      x: G.crop.x * rc.width,
      y: G.crop.y * rc.height,
      w: G.crop.w * rc.width,
      h: G.crop.h * rc.height
    };
  }
  return { x: 0, y: 0, w: rc.width, h: rc.height };
}

// Map a normalised rotated-frame coord (0..1) to normalised display
// coord (0..1) accounting for crop. Returns null if outside crop.
function gelViewNXtoDispN(nx) {
  if (!G.crop) return nx;
  var dn = (nx - G.crop.x) / G.crop.w;
  return (dn < 0 || dn > 1) ? null : dn;
}
function gelViewNYtoDispN(ny) {
  if (!G.crop) return ny;
  var dn = (ny - G.crop.y) / G.crop.h;
  return (dn < 0 || dn > 1) ? null : dn;
}
// Inverse: display-normalised → rotated-frame-normalised. Used when the
// user drags a crop rect in display coords and we store it in rotated
// frame (composed with any existing crop).
function gelDispNtoViewNX(dn) {
  if (!G.crop) return dn;
  return G.crop.x + dn * G.crop.w;
}
function gelDispNtoViewNY(dn) {
  if (!G.crop) return dn;
  return G.crop.y + dn * G.crop.h;
}

/* ── canvas padding ───────────────────────────────────────────────────
   The display / snapshot canvas is larger than the image content so
   labels have somewhere to sit that isn't over the bands. Without this
   pad, cropping tight to the bands puts the lane labels (which anchor
   near the top of the canvas) on top of the gel and ladder size
   labels (which anchor near the left) over the leftmost lane.

   Approach: bg canvas is (viewW+padL+padR) × (viewH+padT+padB) pixels.
   Image is drawn at (padL, padT) with its original view size. The
   overlay canvas has the same aspect (CSS scales both to the same
   client size) so pad *fractions* are preserved. G._padF stores those
   fractions so gelDrawOnCtx can compute the content rect regardless
   of what canvas it's rendering to (screen or export).                 */
function gelPadFor(viewW, viewH) {
  // Pad percentages come from user settings (see settings/router.py
  // defaults gel_pad_left_pct=6, gel_pad_top_pct=10, gel_pad_right_pct=6).
  // Fallback to defaults if settings haven't loaded yet (first boot / offline).
  var settings = (typeof S !== 'undefined' && S.settings) ? S.settings : {};
  var leftPct  = (typeof settings.gel_pad_left_pct  === 'number') ? settings.gel_pad_left_pct  : 6;
  var rightPct = (typeof settings.gel_pad_right_pct === 'number') ? settings.gel_pad_right_pct : 6;
  var topPct   = (typeof settings.gel_pad_top_pct   === 'number') ? settings.gel_pad_top_pct   : 10;
  // Min-clamp only, so at very small images the pad is still legible
  // (avoids 5px zones for tiny thumbnails). No max-clamp — user asked
  // for canvas space control, and clamping down would fight that.
  var padL = Math.max(0, Math.round(viewW * leftPct / 100));
  if (leftPct > 0) padL = Math.max(padL, 20);
  var padR = Math.max(0, Math.round(viewW * rightPct / 100));
  if (rightPct > 0) padR = Math.max(padR, 20);
  var padT = Math.max(0, Math.round(viewH * topPct / 100));
  if (topPct > 0) padT = Math.max(padT, 24);
  var padB = 8;
  var totalW = viewW + padL + padR;
  var totalH = viewH + padT + padB;
  return {
    padL: padL, padR: padR, padT: padT, padB: padB,
    viewW: viewW, viewH: viewH,
    canvasW: totalW, canvasH: totalH,
    fLeft: padL / totalW,
    fRight: padR / totalW,
    fTop: padT / totalH,
    fBottom: padB / totalH
  };
}
// Content rect in the current draw-target canvas's pixel coords.
// Uses G._padF (set by paintBg / gelRenderComposite) — falls back to
// no-pad if not set (e.g. very first render before img loads).
function gelContent(canvasW, canvasH) {
  var f = G._padF || { fLeft: 0, fRight: 0, fTop: 0, fBottom: 0 };
  return {
    left: canvasW * f.fLeft,
    top: canvasH * f.fTop,
    w: canvasW * (1 - f.fLeft - f.fRight),
    h: canvasH * (1 - f.fTop - f.fBottom)
  };
}
// Convert a client (mouse) coord to {cx, cy} canvas-px and {nx, ny}
// content-normalised (0..1 inside content area; <0 or >1 if in pad
// zone). Respects the wrap's CSS transform:scale.
function gelClientToNorm(clientX, clientY, canvas) {
  var rect = canvas.getBoundingClientRect();
  var cx = (clientX - rect.left) * canvas.width / Math.max(1, rect.width);
  var cy = (clientY - rect.top) * canvas.height / Math.max(1, rect.height);
  var cr = gelContent(canvas.width, canvas.height);
  return {
    cx: cx, cy: cy,
    nx: (cx - cr.left) / Math.max(1, cr.w),
    ny: (cy - cr.top) / Math.max(1, cr.h),
    content: cr
  };
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
  if (!G.annotations.expectedMarks) G.annotations.expectedMarks = [];
  // Restore label orientation from the annotations blob if the gel
  // was previously saved with a non-default value; otherwise fall
  // back to horizontal.
  G.labelOrientation = (G.annotations.labelOrientation === 'diagonal' ||
                        G.annotations.labelOrientation === 'vertical')
                       ? G.annotations.labelOrientation
                       : 'horizontal';
  // Straighten: only hydrate if a sensible finite number in range.
  var rot = parseFloat(G.annotations.rotation);
  G.rotation = (isFinite(rot) ? gelClamp(rot, -15, 15) : 0);
  // Crop: only hydrate if all four fields present and rect is inside 0..1.
  var c = G.annotations.crop;
  if (c && isFinite(c.x) && isFinite(c.y) && isFinite(c.w) && isFinite(c.h) &&
      c.w > 0.02 && c.h > 0.02 &&
      c.x >= 0 && c.y >= 0 && (c.x + c.w) <= 1.0001 && (c.y + c.h) <= 1.0001) {
    G.crop = { x: c.x, y: c.y, w: c.w, h: c.h };
  } else {
    G.crop = null;
  }
  // Reset transient UI state
  G.straightenMode = false; G.straightenPts = []; G.straightenMouse = null;
  G.cropMode = false; G.cropDrag = null; G.cropDragging = false;
  gelInvalidateRotCache();
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
  // Mirror straighten + crop into the annotations blob (same pattern as
  // labelOrientation) so they round-trip through save/load.
  if (!G.annotations) G.annotations = { ladderMarks: [] };
  if (!G.annotations.expectedMarks) G.annotations.expectedMarks = [];
  G.annotations.rotation = G.rotation || 0;
  G.annotations.crop = G.crop || null;
  await api('PUT', '/api/gels/' + G.gel.id, {
    ladder_type: G.gel.ladder_type || '',
    entry_id: G.gel.entry_id || null,
    annotations: JSON.stringify(G.annotations)
  });
  G.dirty = false;
  toast('Annotations saved');
  gelLoadList();
}

/* Render the current rotated+cropped view + annotation overlay into a
   fresh canvas at natural resolution. Returns the canvas, or null if
   the image isn't ready. Shared by gelExport (download) and
   gelSaveAnnotated (upload) so both produce identical output. */
function gelRenderComposite() {
  var rc = gelGetRotatedCanvas();
  if (!rc) return null;
  var view = gelViewRect();
  if (!view || view.w < 1 || view.h < 1) return null;
  var pad = gelPadFor(view.w, view.h);
  G._padF = pad;
  var exp = document.createElement('canvas');
  exp.width = pad.canvasW;
  exp.height = pad.canvasH;
  var ctx = exp.getContext('2d');
  // Off-white pad zone — same tone as the app background so the label
  // frame doesn't look like a hard letterbox.
  ctx.fillStyle = '#faf8f4';
  ctx.fillRect(0, 0, exp.width, exp.height);
  ctx.drawImage(rc, view.x, view.y, view.w, view.h,
                    pad.padL, pad.padT, view.w, view.h);
  gelDrawOnCtx(ctx, exp.width, exp.height, { forExport: true });
  return exp;
}

/* ── export ── */
function gelExport() {
  var exp = gelRenderComposite();
  if (!exp) { toast('Image not ready', true); return; }
  var link = document.createElement('a');
  link.download = (G.gel ? G.gel.title.replace(/[^a-z0-9]/gi, '_') : 'gel') + '_annotated.png';
  link.href = exp.toDataURL('image/png');
  link.click();
}

// Toggle guide chrome (dashed lane lines, drag handles, dashed ladder
// rules). Labels + solid ladder marks always draw. Selected items still
// get their highlight so editing works even in "clean" mode.
function gelToggleGuides(on) {
  G.showGuides = !!on;
  gelDrawOverlay();
}

/* ── layout panel (canvas pad settings) ──
   Slider inputs edit S.settings.gel_pad_{top,left}_pct in-memory for
   instant repaint; a debounced PUT persists to the backend so a rapid
   slider drag doesn't fire 60 requests. Values apply GLOBALLY (all
   gels use the same pad) — per-gel override deliberately deferred. */
function gelToggleLayoutPanel() {
  G.layoutPanelOpen = !G.layoutPanelOpen;
  gelRenderFull();
}
function gelSetPad(which, value) {
  var v = parseFloat(value);
  if (isNaN(v)) return;
  if (!S.settings) S.settings = {};
  // 'top' → gel_pad_top_pct alone. 'side' → left + right in lockstep
  // (the layout slider treats horizontal padding as symmetric so the
  // user can size ladder-mark space and expected-mark space with one
  // control). 'left' / 'right' still work if a future UI wants
  // asymmetric direct-editing.
  var payload = {};
  if (which === 'top') {
    S.settings.gel_pad_top_pct = v;
    payload.gel_pad_top_pct = v;
  } else if (which === 'left') {
    S.settings.gel_pad_left_pct = v;
    payload.gel_pad_left_pct = v;
  } else if (which === 'right') {
    S.settings.gel_pad_right_pct = v;
    payload.gel_pad_right_pct = v;
  } else if (which === 'side') {
    S.settings.gel_pad_left_pct = v;
    S.settings.gel_pad_right_pct = v;
    payload.gel_pad_left_pct = v;
    payload.gel_pad_right_pct = v;
  } else {
    return;
  }
  // Live update: recompute pads → repaint bg + overlay. Invalidating
  // the rotated cache is NOT needed (pad doesn't touch the rotated
  // pre-render), but paintBg has to re-run to resize the bg canvas.
  gelReflowCanvases();
  // Update the number readout beside the slider without re-rendering
  // the whole toolbar (which would blow away the input's focus).
  var out = document.getElementById('gel-pad-' + which + '-out');
  if (out) out.textContent = v + '%';
  // Debounced save so a slider drag doesn't hammer the API.
  clearTimeout(G._layoutSaveTimer);
  G._layoutSaveTimer = setTimeout(function() {
    api('PUT', '/api/settings', { settings: payload }).catch(function() {
      toast('Could not save pad setting', true);
    });
  }, 400);
}
function gelResetPad() {
  if (!S.settings) S.settings = {};
  S.settings.gel_pad_top_pct = 10;
  S.settings.gel_pad_left_pct = 6;
  S.settings.gel_pad_right_pct = 6;
  gelReflowCanvases();
  api('PUT', '/api/settings', { settings: {
    gel_pad_top_pct: 10, gel_pad_left_pct: 6, gel_pad_right_pct: 6
  } }).catch(function() { toast('Could not save pad reset', true); });
  gelRenderFull();
}
// Rebuild bg canvas + overlay canvas after any change that alters the
// content/pad geometry (pad settings, crop, rotation apply). Cheap; no
// full DOM rebuild, no init re-run.
function gelReflowCanvases() {
  var img = document.getElementById('gelImg');
  var bg = document.getElementById('gelBgCanvas');
  var overlay = document.getElementById('gelCanvas');
  if (!img || !bg || !overlay || !img.naturalWidth) return;
  var rc = gelGetRotatedCanvas();
  var view = gelViewRect();
  if (!rc || !view) return;
  var pad = gelPadFor(view.w, view.h);
  G._padF = pad;
  bg.width = pad.canvasW;
  bg.height = pad.canvasH;
  var bctx = bg.getContext('2d');
  bctx.fillStyle = '#faf8f4';
  bctx.fillRect(0, 0, bg.width, bg.height);
  bctx.drawImage(rc, view.x, view.y, view.w, view.h,
                     pad.padL, pad.padT, view.w, view.h);
  overlay.width = bg.clientWidth;
  overlay.height = bg.clientHeight;
  G.imgW = bg.clientWidth;
  G.imgH = bg.clientHeight;
  gelDrawOverlay();
}

/* ── straighten actions ──
   UX flow: user clicks "Straighten" → enters straighten mode. Two clicks
   on the canvas define a line that SHOULD be horizontal. On the second
   click the preview line is drawn (via gelDrawOverlay); Apply commits
   the delta, Cancel discards the two points and stays in straighten
   mode (click again).                                                */
function gelEnterStraighten() {
  // Turn off any other exclusive mode first so we don't stack them.
  G.cropMode = false; G.cropDrag = null; G.cropDragging = false;
  G.straightenMode = true;
  G.straightenPts = [];
  G.straightenMouse = null;
  gelRenderFull();
}
function gelExitStraighten() {
  G.straightenMode = false;
  G.straightenPts = [];
  G.straightenMouse = null;
  gelRenderFull();
}
function gelStraightenCancel() {
  // Discard the two-point preview but stay in straighten mode so the
  // user can immediately click again without hitting Straighten twice.
  G.straightenPts = [];
  G.straightenMouse = null;
  gelDrawOverlay();
}
function gelStraightenApply() {
  if (G.straightenPts.length !== 2) return;
  var canvas = document.getElementById('gelCanvas');
  if (!canvas) return;
  var p1 = G.straightenPts[0], p2 = G.straightenPts[1];
  // Angle of the drawn line in display coords. Rotation and crop are
  // just scale+translate — the angle in display space equals the angle
  // in rotated-view space, so we can add directly to G.rotation.
  var theta = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  var delta = -theta * 180 / Math.PI;   // rotate opposite way so line → horizontal
  var oldRot = G.rotation || 0;
  var newRot = gelClamp(oldRot + delta, -15, 15);
  var applied = newRot - oldRot;
  if (Math.abs(applied) < 0.01) {
    toast('Already level (or line was already horizontal)');
    gelStraightenCancel();
    return;
  }
  var hadAnn = G.lanes.length > 0 ||
               (G.annotations.ladderMarks && G.annotations.ladderMarks.length > 0);
  G.rotation = newRot;
  G.dirty = true;
  gelInvalidateRotCache();
  G.straightenMode = false;
  G.straightenPts = [];
  G.straightenMouse = null;
  // Clamp warning: if the two-point line implied more than the ±15° range.
  if (Math.abs(applied) < Math.abs(delta) - 0.01) {
    toast('Rotation clamped to ±15°', true);
  } else if (hadAnn && Math.abs(applied) > 0.5) {
    toast('Rotated ' + applied.toFixed(1) + '°; check annotations still align');
  } else {
    toast('Rotated by ' + applied.toFixed(1) + '°');
  }
  gelRenderFull();  // full re-render so toolbar shows new rotation + hides straighten controls
}
function gelStraightenReset() {
  if (!G.rotation) { gelExitStraighten(); return; }
  G.rotation = 0;
  G.dirty = true;
  gelInvalidateRotCache();
  gelExitStraighten();
}

/* ── crop actions ──
   Drag defines a rect in display coords. Apply converts it to
   rotated-frame normalised coords (composing with any existing crop
   so successive crops narrow the view further) and commits.        */
function gelEnterCrop() {
  G.straightenMode = false; G.straightenPts = []; G.straightenMouse = null;
  G.cropMode = true;
  G.cropDrag = null;
  G.cropDragging = false;
  gelRenderFull();
}
function gelExitCrop() {
  G.cropMode = false;
  G.cropDrag = null;
  G.cropDragging = false;
  gelRenderFull();
}
function gelCropCancel() {
  G.cropDrag = null;
  G.cropDragging = false;
  gelDrawOverlay();
}
function gelCropApply() {
  if (!G.cropDrag) return;
  var canvas = document.getElementById('gelCanvas');
  if (!canvas || !canvas.width || !canvas.height) return;
  var cr = gelContent(canvas.width, canvas.height);
  if (cr.w < 1 || cr.h < 1) return;
  var d = G.cropDrag;
  // Convert canvas-px → content-normalised 0..1, clamped to content area.
  var dx0 = gelClamp((Math.min(d.x0, d.x1) - cr.left) / cr.w, 0, 1);
  var dy0 = gelClamp((Math.min(d.y0, d.y1) - cr.top)  / cr.h, 0, 1);
  var dx1 = gelClamp((Math.max(d.x0, d.x1) - cr.left) / cr.w, 0, 1);
  var dy1 = gelClamp((Math.max(d.y0, d.y1) - cr.top)  / cr.h, 0, 1);
  // Compose with any existing crop → rotated-frame coords.
  var vx0 = gelDispNtoViewNX(dx0), vy0 = gelDispNtoViewNY(dy0);
  var vx1 = gelDispNtoViewNX(dx1), vy1 = gelDispNtoViewNY(dy1);
  var nc = { x: vx0, y: vy0, w: vx1 - vx0, h: vy1 - vy0 };
  if (nc.w < 0.02 || nc.h < 0.02) {
    toast('Crop too small — drag a larger rectangle', true);
    G.cropDrag = null;
    gelDrawOverlay();
    return;
  }
  G.crop = nc;
  G.dirty = true;
  G.cropMode = false;
  G.cropDrag = null;
  G.cropDragging = false;
  toast('Crop applied');
  gelRenderFull();
}
function gelCropClear() {
  G.crop = null;
  G.cropDrag = null;
  G.cropDragging = false;
  G.dirty = true;
  gelExitCrop();
}

// Change well-label orientation (horizontal / diagonal / vertical).
// Mirrors onto G.annotations so it round-trips through save/load. The
// draw code reads G.labelOrientation directly (not annotations) so a
// mid-session change re-renders immediately.
function gelSetLabelOrientation(value) {
  var v = (value === 'diagonal' || value === 'vertical') ? value : 'horizontal';
  G.labelOrientation = v;
  if (!G.annotations) G.annotations = {};
  G.annotations.labelOrientation = v;
  G.dirty = true;
  gelDrawOverlay();
}

// Save the current annotated view as a snapshot on the server. Wired to
// the "Save annotated" toolbar button. Uses the same flatten-canvas
// trick as gelExport but uploads instead of downloading. The workflow
// gel link picker reads the resulting annotated_file so links can open
// the labelled version rather than the raw thumbnail.
async function gelSaveAnnotated() {
  if (!G.gel) { toast('Nothing to save', true); return; }
  var exp = gelRenderComposite();
  if (!exp) { toast('Nothing to save', true); return; }
  exp.toBlob(async function(blob) {
    if (!blob) { toast('Could not render image', true); return; }
    var fd = new FormData();
    fd.append('image', blob, 'gel_' + G.gel.id + '_annotated.png');
    try {
      var resp = await fetch('/api/gels/' + G.gel.id + '/save-annotated', {
        method: 'POST',
        body: fd
      });
      if (!resp.ok) throw new Error(await resp.text());
      var data = await resp.json();
      // Update local state so the picker in workflow reflects the new file
      G.gel.annotated_file = data.annotated_file;
      toast('Annotated snapshot saved');
    } catch (e) {
      toast('Save failed: ' + (e.message || e), true);
    }
  }, 'image/png');
}

/* ── canvas drawing ── */
function gelDrawOverlay() {
  var canvas = document.getElementById('gelCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gelDrawOnCtx(ctx, canvas.width, canvas.height);
}

function gelDrawOnCtx(ctx, w, h, opts) {
  opts = opts || {};
  /* Content rect: the region of this canvas occupied by the image. The
     remainder is pad zone where labels live so they don't sit on top
     of bands. See gelPadFor + G._padF. When _padF isn't set yet (first
     paint) gelContent returns the full canvas as content — labels will
     look wrong for one frame, then correct after paintBg runs. */
  var cr = gelContent(w, h);
  var scaleRef = cr.w;  // font/handle sizing keys off content width, not canvas width
  var baseFont = Math.max(11, Math.min(16, scaleRef / 45));
  var smallFont = Math.max(10, Math.min(14, scaleRef / 50));
  var handleR = Math.max(5, Math.min(9, scaleRef / 80));
  var labelTrunc = Math.max(8, Math.min(18, Math.floor(scaleRef / 40)));

  /* Precompute display-x (canvas px) for each lane. null = outside
     crop, skip drawing AND skip stagger accounting. */
  var laneCanvasX = G.lanes.map(function(lane) {
    var dn = gelViewNXtoDispN(lane.x_position);
    return dn === null ? null : cr.left + dn * cr.w;
  });

  /* ── overlap-avoidance: pre-assign each label to a row ──────────────
     Labels stagger UPWARD from the top of the content area into the
     top pad zone. Row 0 sits just above content, row 1 baseFont+2 px
     higher, etc. Greedy interval scheduling picks the lowest row
     (=nearest to content) where the label's x-interval doesn't overlap
     anything already in that row.                                    */
  var LABEL_PAD_PX = 4;
  ctx.font = baseFont + 'px "SF Mono", Monaco, Consolas, monospace';
  var rowsInUse = [];  // rowsInUse[r] = rightmost x already occupied in row r
  var labelRow = new Array(G.lanes.length);
  var labelText = new Array(G.lanes.length);
  G.lanes.forEach(function(lane, i) {
    var label = lane.is_ladder ? 'L' : String(i + 1);
    if (lane.sample_name) label += ': ' + lane.sample_name.substring(0, labelTrunc);
    labelText[i] = label;
    if (laneCanvasX[i] === null) return;  // culled by crop
    var textW = ctx.measureText(label).width;
    var x = laneCanvasX[i];
    var left = x - textW / 2 - LABEL_PAD_PX;
    var right = x + textW / 2 + LABEL_PAD_PX;
    var row = 0;
    while (row < rowsInUse.length && left < rowsInUse[row]) row++;
    if (row === rowsInUse.length) rowsInUse.push(right);
    else rowsInUse[row] = right;
    labelRow[i] = row;
  });

  /* draw lanes */
  G.lanes.forEach(function(lane, i) {
    if (laneCanvasX[i] === null) return;  // outside crop
    var x = laneCanvasX[i];
    ctx.save();
    // Lane line + drag handle are "guide" chrome — hide when the user
    // turns off guides so the exported image has only labels + solid
    // ladder marks. Selected lane always shows its guide though so you
    // can still see what's active while editing. Line spans the CONTENT
    // area only, not the whole canvas.
    if (G.showGuides !== false || i === G.selIdx) {
      ctx.setLineDash(i === G.selIdx ? [6, 3] : [4, 4]);
      ctx.strokeStyle = lane.is_ladder ? '#e8a735' : (i === G.selIdx ? '#5b7a5e' : 'rgba(91,122,94,0.6)');
      ctx.lineWidth = i === G.selIdx ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, cr.top);
      ctx.lineTo(x, cr.top + cr.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    /* lane label — orientation-aware. All variants anchor just ABOVE
       the top edge of the content area (so labels sit in the top pad
       zone, not over bands):
       - horizontal: baseline at (cr.top - 4 - row*(baseFont+2)); text
                     grows upward into pad as staggered rows increase
       - diagonal:   anchor at (x, cr.top - 4), rotate -45°, text
                     extends up-and-right into pad
       - vertical:   anchor at (x, cr.top - 4), rotate -90°, text
                     extends straight up into pad                       */
    ctx.font = baseFont + 'px "SF Mono", Monaco, Consolas, monospace';
    ctx.fillStyle = lane.is_ladder ? '#e8a735' : '#5b7a5e';
    var orient = G.labelOrientation || 'horizontal';
    if (orient === 'diagonal') {
      ctx.save();
      ctx.translate(x, cr.top - 4);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'left';
      ctx.fillText(labelText[i], 4, 0);
      ctx.restore();
    } else if (orient === 'vertical') {
      ctx.save();
      ctx.translate(x, cr.top - 4);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(labelText[i], 4, baseFont / 3);
      ctx.restore();
    } else {
      // horizontal — staggered, growing UPWARD from just above content
      ctx.textAlign = 'center';
      var labelY = cr.top - 4 - labelRow[i] * (baseFont + 2);
      ctx.fillText(labelText[i], x, labelY);
    }
    /* drag handle — only when guides on. Sits just INSIDE the bottom
       edge of content so you can grab it without leaving the image. */
    if (G.showGuides !== false || i === G.selIdx) {
      ctx.fillStyle = i === G.selIdx ? '#5b7a5e' : 'rgba(91,122,94,0.5)';
      ctx.beginPath();
      ctx.arc(x, cr.top + cr.h - handleR - 4, handleR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  /* draw ladder marks — when guides off, draw solid horizontal rules
     with size labels (no dashes). Selected mark still gets highlighted.
     Ticks span the content width; size labels sit in the left pad zone. */
  if (G.annotations.ladderMarks) {
    var ladder = gelActiveLadder();
    var unit = gelSizeUnit(ladder);
    G.annotations.ladderMarks.forEach(function(m, i) {
      var dispNY = gelViewNYtoDispN(m.y);
      if (dispNY === null) return;   // outside crop
      var y = cr.top + dispNY * cr.h;
      var isSelected = G.markReplaceIdx === i;
      ctx.save();
      if (G.showGuides !== false || isSelected) {
        ctx.strokeStyle = isSelected ? '#5b7a5e' : 'rgba(232,167,53,0.7)';
        ctx.lineWidth = isSelected ? 2 : 1;
        // Guides-off: solid short tick from content's left edge instead
        // of a full dashed rule across the gel.
        if (G.showGuides === false) {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(cr.left, y);
          ctx.lineTo(cr.left + Math.min(24, cr.w * 0.05), y);
        } else {
          ctx.setLineDash(isSelected ? [] : [3, 3]);
          ctx.beginPath();
          ctx.moveTo(cr.left, y);
          ctx.lineTo(cr.left + cr.w, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Size label sits in the LEFT PAD ZONE, right-aligned so its
      // right edge lands just before the tick line at cr.left. Falls
      // back to the old left-flush position if the pad is missing.
      ctx.font = smallFont + 'px "SF Mono", Monaco, Consolas, monospace';
      ctx.fillStyle = isSelected ? '#5b7a5e' : '#e8a735';
      if (cr.left > 8) {
        ctx.textAlign = 'right';
        ctx.fillText(gelSizeLabel(String(m.size), unit), cr.left - 4, y - 3);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(gelSizeLabel(String(m.size), unit), 4, y - 3);
      }
      ctx.restore();
    });
  }

  /* ── Expected-size marks (right side) ─────────────────────────────
     Mirror of the ladder-marks flow but on the RIGHT. Same tick +
     label style, distinguished visually by a different accent colour
     (teal/blue) so ladder and expected marks are easy to tell apart
     at a glance. Full-width dashed rule when guides are on; short
     solid tick from content's right edge when guides are off. Size
     labels sit in the RIGHT PAD ZONE, left-aligned so their left
     edge lands just after the tick line at cr.left + cr.w. */
  if (G.annotations.expectedMarks && G.annotations.expectedMarks.length) {
    var padRightPx = (typeof G._padF !== 'undefined' && G._padF) ? (canvasW * G._padF.fRight) : 0;
    G.annotations.expectedMarks.forEach(function(m, i) {
      var dispNYe = gelViewNYtoDispN(m.y);
      if (dispNYe === null) return;
      var y = cr.top + dispNYe * cr.h;
      var isSelected = G.expectedReplaceIdx === i;
      ctx.save();
      if (G.showGuides !== false || isSelected) {
        ctx.strokeStyle = isSelected ? '#5b7a5e' : 'rgba(72, 145, 168, 0.75)';
        ctx.lineWidth = isSelected ? 2 : 1;
        if (G.showGuides === false) {
          ctx.setLineDash([]);
          ctx.beginPath();
          // Short tick coming inward from the right edge of the content
          ctx.moveTo(cr.left + cr.w, y);
          ctx.lineTo(cr.left + cr.w - Math.min(24, cr.w * 0.05), y);
        } else {
          ctx.setLineDash(isSelected ? [] : [3, 3]);
          ctx.beginPath();
          ctx.moveTo(cr.left, y);
          ctx.lineTo(cr.left + cr.w, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.font = smallFont + 'px "SF Mono", Monaco, Consolas, monospace';
      ctx.fillStyle = isSelected ? '#5b7a5e' : '#4891a8';
      if (padRightPx > 8) {
        ctx.textAlign = 'left';
        ctx.fillText(String(m.size), cr.left + cr.w + 4, y - 3);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(String(m.size), cr.left + cr.w - 4, y - 3);
      }
      ctx.restore();
    });
  }

  /* ── live-preview overlays (screen only, never in exports) ── */
  if (opts.forExport) return;

  // Straighten preview: point 1 as a dot; when point 2 exists, draw the
  // line between them; while mouse is moving after point 1, draw a
  // rubber-band line from p1 to cursor.
  if (G.straightenMode && G.straightenPts.length > 0) {
    var pts = G.straightenPts;
    ctx.save();
    ctx.fillStyle = '#e8a735';
    ctx.strokeStyle = '#e8a735';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    // point 1 dot
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 4, 0, Math.PI * 2);
    ctx.fill();
    var end = null;
    if (pts.length === 2) {
      end = pts[1];
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (G.straightenMouse) {
      end = G.straightenMouse;
      ctx.setLineDash([4, 4]);   // rubber-band
    }
    if (end) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Crop preview: dim everything outside the pending rect, draw a
  // solid rect for the pending region. Only during active drag or with
  // a completed drag awaiting Apply.
  if (G.cropMode && G.cropDrag) {
    var d = G.cropDrag;
    var rx = Math.min(d.x0, d.x1), ry = Math.min(d.y0, d.y1);
    var rw = Math.abs(d.x1 - d.x0), rh = Math.abs(d.y1 - d.y0);
    ctx.save();
    // dim outside
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(rx + rw, ry, -rw, rh);  // cut the crop rect (even-odd)
    ctx.fill('evenodd');
    // border
    ctx.strokeStyle = '#e8a735';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }
}

// Client-event → canvas-pixel coord. Respects wrap's CSS transform:scale
// (used for the zoom control) because rect.width != canvas.width once
// scaled — we scale-correct explicitly.
function gelCanvasPx(clientX, clientY, canvas) {
  var rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * canvas.width / Math.max(1, rect.width),
    y: (clientY - rect.top) * canvas.height / Math.max(1, rect.height)
  };
}

// Convert a lane's stored x_position (rotated-frame normalised) to
// its display-normalised position, then to canvas pixel coord. Used
// for hit-testing drag handles when a crop is active. Returns null
// if the lane is outside the crop.
function gelLanePx(laneIdx, canvas) {
  var dn = gelViewNXtoDispN(G.lanes[laneIdx].x_position);
  return dn === null ? null : dn * canvas.width;
}

function gelInitCanvas() {
  var img = document.getElementById('gelImg');
  var bgCanvas = document.getElementById('gelBgCanvas');
  var canvas = document.getElementById('gelCanvas');
  if (!img || !bgCanvas || !canvas) return;

  // Paint the rotated+cropped view into the background canvas. Bg
  // canvas is padded so labels have somewhere to sit outside the image
  // content — see gelPadFor. Returns false if img isn't loaded yet.
  function paintBg() {
    var rc = gelGetRotatedCanvas();
    if (!rc) return false;
    var view = gelViewRect();
    if (!view || view.w < 1 || view.h < 1) return false;
    var pad = gelPadFor(view.w, view.h);
    G._padF = pad;
    bgCanvas.width = pad.canvasW;
    bgCanvas.height = pad.canvasH;
    var bctx = bgCanvas.getContext('2d');
    bctx.fillStyle = '#faf8f4';   // off-white pad, matches app bg
    bctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    bctx.drawImage(rc, view.x, view.y, view.w, view.h,
                       pad.padL, pad.padT, view.w, view.h);
    return true;
  }

  function resize() {
    if (!paintBg()) return;
    // Overlay canvas matches bg canvas's rendered CSS size 1:1.
    canvas.width = bgCanvas.clientWidth;
    canvas.height = bgCanvas.clientHeight;
    G.imgW = bgCanvas.clientWidth;
    G.imgH = bgCanvas.clientHeight;
    gelDrawOverlay();
  }
  if (img.complete && img.naturalWidth) {
    resize();
  }
  img.onload = resize;
  window.addEventListener('resize', resize);

  canvas.onmousedown = function(e) {
    if (e.button !== 0) return;

    // ── straighten mode: canvas clicks add up to 2 preview points.
    if (G.straightenMode) {
      if (G.straightenPts.length >= 2) return;  // waiting for Apply/Cancel
      var p = gelCanvasPx(e.clientX, e.clientY, canvas);
      G.straightenPts.push(p);
      if (G.straightenPts.length === 2) {
        gelRenderFull();  // rebuild toolbar so Apply/Cancel buttons appear
      } else {
        gelDrawOverlay();
      }
      return;
    }

    // ── crop mode: mousedown begins a drag; mousemove/up finish it.
    if (G.cropMode) {
      var pc = gelCanvasPx(e.clientX, e.clientY, canvas);
      // Clamp to content area — the crop rect can only ever be inside
      // the image, not in the label pad zone.
      var cr = gelContent(canvas.width, canvas.height);
      pc.x = gelClamp(pc.x, cr.left, cr.left + cr.w);
      pc.y = gelClamp(pc.y, cr.top,  cr.top  + cr.h);
      G.cropDragging = true;
      G.cropDrag = { x0: pc.x, y0: pc.y, x1: pc.x, y1: pc.y };
      gelDrawOverlay();
      return;
    }

    var pt = gelClientToNorm(e.clientX, e.clientY, canvas);
    var nx = gelClamp(pt.nx, 0, 1);
    var ny = gelClamp(pt.ny, 0, 1);
    // Ignore lane/ladder clicks in the pad zone entirely — otherwise
    // every click on the left margin would spawn a lane at x=0.
    if (pt.nx < 0 || pt.nx > 1 || pt.ny < 0 || pt.ny > 1) return;
    /* check if clicking near existing lane handle. Compare in the same
       (display) frame — remap stored x through crop, cull if hidden. */
    for (var i = 0; i < G.lanes.length; i++) {
      var lxDisp = gelViewNXtoDispN(G.lanes[i].x_position);
      if (lxDisp === null) continue;
      if (Math.abs(lxDisp - nx) < 0.02) {
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
        // Store in rotated-frame coords (compose with any active crop)
        // so lanes stay pinned to physical positions if the crop changes.
        x_position: gelDispNtoViewNX(nx)
      });
      G.lanes.sort(function(a, b) { return a.x_position - b.x_position; });
      var newPos = gelDispNtoViewNX(nx);
      G.selIdx = G.lanes.findIndex(function(l) { return l.x_position === newPos; });
      G.dirty = true;
      gelDrawOverlay();
      gelRenderLaneEditor();
    } else if (G.mode === 'expected') {
      /* Place an EXPECTED-size marker. These render on the RIGHT side
         of the gel — the right pad zone shows them as ticks + labels,
         matching the ladder-mark UX but for theoretical (predicted)
         band positions rather than empirical (ladder) ones. Any click
         in the content area sets the y for a new mark; a size prompt
         supplies the label. Same store-y semantics as ladderMarks:
         normalised in rotated-frame coords so crop changes survive. */
      if (!G.annotations.expectedMarks) G.annotations.expectedMarks = [];
      var storeYe = gelDispNtoViewNY(ny);
      if (G.expectedReplaceIdx !== null && G.expectedReplaceIdx !== undefined &&
          G.annotations.expectedMarks[G.expectedReplaceIdx]) {
        G.annotations.expectedMarks[G.expectedReplaceIdx].y = storeYe;
        G.annotations.expectedMarks.sort(function(a, b) { return a.y - b.y; });
        G.expectedReplaceIdx = null;
      } else {
        // Prompt for size. Cancel or empty → don't add.
        var sizeInput = prompt('Expected size at this position (e.g. "1200 bp" or "70 kDa"):');
        if (sizeInput === null) return;
        var trimmed = String(sizeInput).trim();
        if (!trimmed) return;
        G.annotations.expectedMarks.push({ y: storeYe, size: trimmed });
        G.annotations.expectedMarks.sort(function(a, b) { return a.y - b.y; });
      }
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

      // ladder-mark y is stored in rotated-frame coords, same reasoning
      // as lane x_position above (survive crop / uncrop changes).
      var storeY = gelDispNtoViewNY(ny);
      if (G.markReplaceIdx !== null && G.annotations.ladderMarks[G.markReplaceIdx]) {
        /* Re-place existing mark */
        G.annotations.ladderMarks[G.markReplaceIdx].y = storeY;
        G.annotations.ladderMarks.sort(function(a, b) { return a.y - b.y; });
        G.markReplaceIdx = null;
      } else {
        var placedCount = G.annotations.ladderMarks.length;
        if (placedCount >= ladder.sizes.length) {
          toast('All ladder bands placed');
          return;
        }
        var nextSize = ladder.sizes[placedCount];
        G.annotations.ladderMarks.push({ y: storeY, size: nextSize });
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
    // Straighten rubber-band: show a line from point 1 to the cursor
    // until the second click lands.
    if (G.straightenMode && G.straightenPts.length === 1) {
      G.straightenMouse = gelCanvasPx(e.clientX, e.clientY, canvas);
      gelDrawOverlay();
      return;
    }
    // Active crop drag: extend the rect to the current cursor, clamped
    // to the content area so the preview can't leak into pad.
    if (G.cropMode && G.cropDragging && G.cropDrag) {
      var pc = gelCanvasPx(e.clientX, e.clientY, canvas);
      var cr = gelContent(canvas.width, canvas.height);
      G.cropDrag.x1 = gelClamp(pc.x, cr.left, cr.left + cr.w);
      G.cropDrag.y1 = gelClamp(pc.y, cr.top,  cr.top  + cr.h);
      gelDrawOverlay();
      return;
    }
    if (G.dragging < 0) return;
    var mv = gelClientToNorm(e.clientX, e.clientY, canvas);
    var mvnx = gelClamp(mv.nx, 0, 1);
    // Store in rotated-frame coords so drag while cropped composes correctly.
    G.lanes[G.dragging].x_position = gelDispNtoViewNX(mvnx);
    G.dirty = true;
    gelDrawOverlay();
  };

  canvas.onmouseup = function() {
    // Finish a crop drag — leave the rect in place awaiting Apply/Cancel.
    if (G.cropMode && G.cropDragging) {
      G.cropDragging = false;
      // If it was effectively a click (no drag), clear the rect.
      if (G.cropDrag) {
        var d = G.cropDrag;
        if (Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3) {
          G.cropDrag = null;
        }
      }
      gelRenderFull();  // rebuild toolbar so Apply/Cancel buttons show
      return;
    }
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
    // Cancel any in-progress crop drag when the mouse leaves the canvas.
    // Don't clear straighten preview points — the user may want them to
    // persist while they think.
    if (G.cropMode && G.cropDragging) {
      G.cropDragging = false;
    }
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
  html += '<button class="gel-btn-sm" onclick="gelSetMode(\x27expected\x27)" style="' + (G.mode === 'expected' ? 'background:#4891a8;color:#fff' : '') + '" title="Click in the gel to add an expected-size marker on the right">Expected sizes</button>';
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

  /* Expected-size marks list — same shape as the ladder marks list but
     for the right-side theoretical markers. Distinguishing feature:
     teal accent (matches the on-canvas tick colour) so you can tell
     the two lists apart at a glance. */
  if (G.annotations.expectedMarks && G.annotations.expectedMarks.length) {
    html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #ece7dd">';
    html += '<div class="gel-sc" style="margin-bottom:6px">Expected sizes</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center">';
    G.annotations.expectedMarks.forEach(function(m, i) {
      var isRe = G.expectedReplaceIdx === i;
      var bg = isRe ? '#5b7a5e' : '#e6eef1';
      var fg = isRe ? '#fff' : '#2f5866';
      html += '<span class="gel-tag" style="background:' + bg + ';color:' + fg + ';cursor:pointer" ' +
              'onclick="gelSelectExpectedForReplace(' + i + ')" ' +
              'title="Click then click on the gel to re-place">' + esc(String(m.size));
      html += ' <span onclick="event.stopPropagation();gelRemoveExpectedMark(' + i + ')" ' +
              'style="cursor:pointer;margin-left:2px">&times;</span></span>';
    });
    html += '</div>';
    if (G.expectedReplaceIdx !== null && G.expectedReplaceIdx !== undefined) {
      html += '<div style="font-size:.75rem;color:#5b7a5e;margin-bottom:6px">' +
              'Click on the gel to re-place the selected mark. ' +
              '<a onclick="gelCancelExpectedReplace()" style="cursor:pointer;text-decoration:underline">Cancel</a></div>';
    }
    html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelClearExpectedMarks()" style="font-size:.75rem">Clear expected marks</button>';
    html += '</div>';
  } else if (G.mode === 'expected') {
    html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #ece7dd;color:#8a7f72;font-size:.8rem">' +
            'Click on the gel where you expect a band; you\'ll be asked for its size.' +
            '</div>';
  }

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
function gelSelectExpectedForReplace(i) {
  G.expectedReplaceIdx = (G.expectedReplaceIdx === i) ? null : i;
  // Force expected mode so the next click goes to the right handler.
  if (G.expectedReplaceIdx !== null) G.mode = 'expected';
  gelRenderLadderPanel();
  gelDrawOverlay();
}
function gelCancelExpectedReplace() {
  G.expectedReplaceIdx = null;
  gelRenderLadderPanel();
}
function gelRemoveExpectedMark(i) {
  if (!G.annotations.expectedMarks) return;
  G.annotations.expectedMarks.splice(i, 1);
  G.expectedReplaceIdx = null;
  G.dirty = true;
  gelRenderLadderPanel();
  gelDrawOverlay();
}
function gelClearExpectedMarks() {
  if (!confirm('Clear all expected-size marks?')) return;
  G.annotations.expectedMarks = [];
  G.expectedReplaceIdx = null;
  G.dirty = true;
  gelRenderLadderPanel();
  gelDrawOverlay();
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
    // Show-guides toggle — hides dashed lane lines and dashed ladder rules
    // for a clean look (labels + solid ladder marks only). Default ON.
    // State lives on G so it persists across redraws within the session.
    html += '<label class="gel-btn-sm" style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none">' +
      '<input type="checkbox" ' + (G.showGuides !== false ? 'checked' : '') + ' onchange="gelToggleGuides(this.checked)" style="margin:0"/>' +
      'Guides</label>';
    // Layout toggle — opens the pad-settings popover below the toolbar
    // so the user can dial canvas margins in when labels overflow.
    html += '<button class="gel-btn-sm' + (G.layoutPanelOpen ? ' gel-btn-active' : '') +
            '" onclick="gelToggleLayoutPanel()" title="Adjust canvas padding (space around image for labels)">Layout</button>';
    // Label orientation dropdown — how well labels tilt above the lanes.
    // Diagonal fits classic gel-photo look; vertical helps when lanes
    // are very narrow and names would still clip in diagonal.
    html += '<label class="gel-btn-sm" style="display:flex;align-items:center;gap:4px;user-select:none">' +
      'Labels:' +
      '<select onchange="gelSetLabelOrientation(this.value)" style="padding:2px 4px;font-size:.75rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#4a4139">' +
        '<option value="horizontal"' + (G.labelOrientation === 'horizontal' || !G.labelOrientation ? ' selected' : '') + '>horizontal</option>' +
        '<option value="diagonal"'   + (G.labelOrientation === 'diagonal'   ? ' selected' : '') + '>diagonal 45°</option>' +
        '<option value="vertical"'   + (G.labelOrientation === 'vertical'   ? ' selected' : '') + '>vertical 90°</option>' +
      '</select></label>';
    /* ── straighten / crop toolbar cluster ──
       Straighten:
         - default: shows "Straighten" button + rotation status (with Reset if !=0)
         - in mode, 0-1 pts: shows "Click 2 points on a line that should be level" hint + Cancel
         - in mode, 2 pts: shows Apply + Cancel
       Crop:
         - default: shows "Crop" button (or "Re-crop" if crop active) + Clear if a crop exists
         - in mode, no drag: shows "Drag a rectangle" hint + Cancel
         - in mode, drag committed: shows Apply + Cancel                */
    // Straighten cluster
    if (G.straightenMode) {
      if (G.straightenPts.length === 2) {
        html += '<span style="font-size:.75rem;color:#4a4139">Straighten preview:</span>';
        html += '<button class="gel-btn-sm" onclick="gelStraightenApply()" style="background:#5b7a5e;color:#fff">Apply</button>';
        html += '<button class="gel-btn-sm" onclick="gelStraightenCancel()">Cancel</button>';
        html += '<button class="gel-btn-sm" onclick="gelExitStraighten()">Exit</button>';
      } else {
        html += '<span style="font-size:.75rem;color:#8a7f72">Click 2 points on a line that should be level' +
                (G.straightenPts.length === 1 ? ' (1 more)' : '') + '</span>';
        html += '<button class="gel-btn-sm" onclick="gelExitStraighten()">Cancel</button>';
      }
    } else {
      html += '<button class="gel-btn-sm" onclick="gelEnterStraighten()" title="Click two points on a line that should be horizontal, e.g. two corners of the gel">Straighten</button>';
      if (G.rotation) {
        html += '<span style="font-size:.72rem;color:#8a7f72">' + G.rotation.toFixed(1) + '°</span>';
        html += '<button class="gel-btn-sm" onclick="gelStraightenReset()" title="Reset rotation to 0°">Reset</button>';
      }
    }
    // Crop cluster
    if (G.cropMode) {
      if (G.cropDrag && !G.cropDragging) {
        html += '<span style="font-size:.75rem;color:#4a4139">Crop preview:</span>';
        html += '<button class="gel-btn-sm" onclick="gelCropApply()" style="background:#5b7a5e;color:#fff">Apply</button>';
        html += '<button class="gel-btn-sm" onclick="gelCropCancel()">Redo</button>';
        html += '<button class="gel-btn-sm" onclick="gelExitCrop()">Exit</button>';
      } else {
        html += '<span style="font-size:.75rem;color:#8a7f72">Drag a rectangle over the region to keep</span>';
        html += '<button class="gel-btn-sm" onclick="gelExitCrop()">Cancel</button>';
      }
    } else {
      html += '<button class="gel-btn-sm" onclick="gelEnterCrop()" title="Drag a rectangle to crop the visible region non-destructively">' +
              (G.crop ? 'Re-crop' : 'Crop') + '</button>';
      if (G.crop) {
        html += '<button class="gel-btn-sm" onclick="gelCropClear()" title="Remove crop, show full image">Clear crop</button>';
      }
    }
    html += '<button class="gel-btn" onclick="gelSave()">Save</button>';
    // Save annotated snapshot: flattens the current canvas view (image
    // + overlays) into a PNG and uploads it. Referenced by workflow
    // gel links so 'open the annotated version' becomes 'serve this file'.
    html += '<button class="gel-btn-sm" onclick="gelSaveAnnotated()" title="Save a snapshot with labels + markers baked in (used by workflow links)">Save annotated</button>';
    html += '<button class="gel-btn-sm" onclick="gelExport()" title="Export PNG">Export</button>';
    if (G.lanes.length) html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelClearAllLanes()" title="Remove all lanes">Clear lanes</button>';
    html += '<button class="gel-btn-sm gel-btn-danger" onclick="gelDelete(' + G.gel.id + ')" title="Delete gel">&times;</button>';
    html += '</div></div>';

    /* Layout / canvas pad settings panel — only rendered when open.
       Sliders live-update S.settings, repaint immediately, and PUT to
       /api/settings debounced. Values are global (apply to every gel). */
    if (G.layoutPanelOpen) {
      var topPct  = (S.settings && typeof S.settings.gel_pad_top_pct   === 'number') ? S.settings.gel_pad_top_pct   : 10;
      var leftPct = (S.settings && typeof S.settings.gel_pad_left_pct  === 'number') ? S.settings.gel_pad_left_pct  : 6;
      var rightPct= (S.settings && typeof S.settings.gel_pad_right_pct === 'number') ? S.settings.gel_pad_right_pct : 6;
      // Slider represents "side padding" scaled symmetrically. If the
      // user has manually set left != right via a direct settings PUT,
      // we show the AVERAGE and moving the slider snaps them back into
      // lockstep. Advanced users who want asymmetric padding can PUT
      // gel_pad_left_pct / gel_pad_right_pct directly.
      var sidePct = Math.round((leftPct + rightPct) / 2);
      html += '<div class="gel-layout-panel">';
      html += '<div style="font-size:.72rem;font-weight:600;color:#8a7f72;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Canvas padding <span style="text-transform:none;font-weight:400;color:#8a7f72;letter-spacing:0"> — space around image for labels. Applies to all gels.</span></div>';
      html += '<div style="display:grid;grid-template-columns:130px 1fr 48px;gap:10px;align-items:center;row-gap:6px">';
      // Top pad
      html += '<label for="gel-pad-top" style="font-size:.82rem;color:#4a4139">Top (lane labels)</label>';
      html += '<input id="gel-pad-top" type="range" min="0" max="50" step="1" value="' + topPct +
              '" oninput="gelSetPad(\'top\',this.value)" style="width:100%">';
      html += '<span id="gel-pad-top-out" style="font-size:.75rem;color:#8a7f72;text-align:right">' + topPct + '%</span>';
      // Side pad — controls left and right in lockstep
      html += '<label for="gel-pad-side" style="font-size:.82rem;color:#4a4139">Sides (ladder / expected)</label>';
      html += '<input id="gel-pad-side" type="range" min="0" max="30" step="1" value="' + sidePct +
              '" oninput="gelSetPad(\'side\',this.value)" style="width:100%">';
      html += '<span id="gel-pad-side-out" style="font-size:.75rem;color:#8a7f72;text-align:right">' + sidePct + '%</span>';
      html += '</div>';
      html += '<div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end">';
      html += '<button class="gel-btn-sm" onclick="gelResetPad()">Reset defaults</button>';
      html += '<button class="gel-btn-sm" onclick="gelToggleLayoutPanel()">Close</button>';
      html += '</div>';
      html += '</div>';
    }

    /* canvas area.
       The <img> is a hidden loader only — its onload event drives the
       bg-canvas paint (via gelInitCanvas → resize → paintBg). The bg
       canvas holds the rotated+cropped image; the overlay canvas holds
       annotations. Wrap sizing follows the bg canvas's intrinsic dims
       under CSS max-width rules (same as the old img did).           */
    html += '<div class="gel-canvas-area"><div class="gel-canvas-scroll">';
    html += '<div id="gelCanvasWrap" class="gel-canvas-wrap" style="transform:scale(' + G.zoom + ')">';
    html += '<img id="gelImg" src="/api/gel_images/' + encodeURIComponent(G.gel.image_file) + '" draggable="false" style="display:none">';
    html += '<canvas id="gelBgCanvas" class="gel-bg-canvas"></canvas>';
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
    /* bg canvas replaces the visible <img> as the sizing element for the
       wrap div. Same max sizing rules so layout matches what the old img
       produced. paintBg fills the canvas with the off-white pad colour
       and draws the image inset by the pad amounts (see gelPadFor). */
    '.gel-bg-canvas { display:block; max-width:100%; max-height:50vh; width:auto; height:auto; user-select:none; }',
    '.gel-canvas { position:absolute; top:0; left:0; width:100%; height:100%; cursor:crosshair; }',
    /* Layout / canvas-pad settings panel — sits between toolbar and
       canvas area. Only rendered when G.layoutPanelOpen. */
    '.gel-layout-panel { padding:12px 14px; background:#faf8f4; border-bottom:1px solid #e8e2d8; }',
    '.gel-btn-active { background:#e8e2d8; border-color:#a89e8e; }',
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

  /* Honour a pending gel selection (e.g. from a workflow gel-link click).
     Two compatible sources: navigateWith('gel_annotation', {gelId}) or legacy
     S._pendingGel = {gelId}. */
  var pending = null;
  if (typeof S !== 'undefined' && S._pendingGel) {
    pending = S._pendingGel; S._pendingGel = null;
  } else if (typeof consumeNavParams === 'function') {
    pending = consumeNavParams('gel_annotation');
  }
  if (pending && pending.gelId) {
    try { await gelLoadGel(pending.gelId); } catch(e) { /* fall through to default view */ }
  }
  gelRenderFull();
}

registerView('gel_annotation', renderGelAnnotation, {wide:true});
