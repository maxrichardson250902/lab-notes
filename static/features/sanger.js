/* Sanger Sequencing — AB1 trace alignment and chromatogram viewer */

/* ── state ────────────────────────────────────────────────── */
var sangerState = {
  alignments: [],
  current: null,       // selected alignment row
  traceData: null,     // parsed AB1 trace JSON
  view: 'list',        // 'list' | 'new' | 'detail' | 'batch'
  batchItems: [],      // alignments in current batch
  batchId: null,
  batchIdx: 0,         // index within batch for nav
  plasmids: [],
  refMode: 'plasmid',  // 'plasmid' | 'upload' | 'raw'
  traceZoom: 1,
  traceScroll: 0,
  dragging: false,
  dragStart: 0,
  scrollStart: 0,
};

/* ── colours (from style guide + bio convention) ──────────── */
var TRACE_COLORS = { A: '#2e8b40', C: '#2266cc', G: '#222', T: '#cc2222' };
var QUAL_GOOD = '#5b7a5e';
var QUAL_MED  = '#c9a84c';
var QUAL_BAD  = '#c25a4a';

/* ── helpers ──────────────────────────────────────────────── */
function sangerFmt(d) { return d ? formatDate(d.split('T')[0]) : '—'; }

function qualColor(q) {
  if (q >= 30) return QUAL_GOOD;
  if (q >= 20) return QUAL_MED;
  return QUAL_BAD;
}

function identityBadge(pct) {
  var c = pct >= 98 ? QUAL_GOOD : pct >= 90 ? QUAL_MED : QUAL_BAD;
  return '<span style="background:' + c + ';color:#fff;padding:2px 8px;border-radius:4px;font-size:.78rem;font-weight:600">' + pct.toFixed(1) + '%</span>';
}

/* ── main render ─────────────────────────────────────────── */
async function renderSanger(el) {
  if (sangerState.view === 'new')    return renderNewAlignment(el);
  if (sangerState.view === 'detail') return renderDetail(el);
  if (sangerState.view === 'batch')  return renderBatch(el);
  return renderList(el);
}

/* ── LIST VIEW ───────────────────────────────────────────── */
async function renderList(el) {
  var data = await api('GET', '/api/sanger/alignments');
  sangerState.alignments = data.items || [];
  var items = sangerState.alignments;

  var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">';
  h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72">sanger alignments</div>';
  h += '<button class="btn-sanger-primary" onclick="sangerState.view=\'new\';setView(\'sanger\')">+ New Alignment</button>';
  h += '</div>';

  if (!items.length) {
    h += '<div class="sanger-empty">';
    h += '<div style="font-size:1.6rem;margin-bottom:8px">No alignments yet</div>';
    h += '<div style="color:#8a7f72">Upload one or more AB1 files and align them against a reference sequence.</div>';
    h += '</div>';
  } else {
    // Group by batch_id
    var batches = {};
    var singles = [];
    items.forEach(function(a) {
      if (a.batch_id) {
        if (!batches[a.batch_id]) batches[a.batch_id] = [];
        batches[a.batch_id].push(a);
      } else {
        singles.push(a);
      }
    });

    h += '<div class="sanger-table-wrap"><table class="sanger-table"><thead><tr>';
    h += '<th>Name</th><th>Reference</th><th>Identity</th><th>Mismatches</th><th>Gaps</th><th>Date</th><th></th>';
    h += '</tr></thead><tbody>';

    // Render batches first
    var batchKeys = Object.keys(batches);
    batchKeys.forEach(function(bid) {
      var group = batches[bid];
      var avgIdent = group.reduce(function(s, a) { return s + a.identity_pct; }, 0) / group.length;
      if (group.length > 1) {
        h += '<tr class="sanger-row sanger-batch-row" onclick="sangerOpenBatch(\'' + bid + '\')" style="cursor:pointer">';
        h += '<td style="font-weight:600"><span class="sanger-batch-badge">' + group.length + ' files</span> ' + esc(group[0].ref_name) + ' batch</td>';
        h += '<td><span style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.8rem;background:#f0ebe3;padding:2px 6px;border-radius:3px">' + esc(group[0].ref_name) + '</span></td>';
        h += '<td>' + identityBadge(avgIdent) + ' <span style="font-size:.75rem;color:#8a7f72">avg</span></td>';
        h += '<td style="text-align:center">' + group.reduce(function(s, a) { return s + a.num_mismatches; }, 0) + '</td>';
        h += '<td style="text-align:center">' + group.reduce(function(s, a) { return s + a.num_gaps; }, 0) + '</td>';
        h += '<td style="color:#8a7f72;font-size:.85rem">' + relTime(group[0].created) + '</td>';
        h += '<td><button class="btn-sanger-icon" onclick="event.stopPropagation();sangerDeleteBatch(\'' + bid + '\')" title="Delete batch">✕</button></td>';
        h += '</tr>';
      } else {
        var a = group[0];
        h += sangerAlignmentRow(a);
      }
    });

    singles.forEach(function(a) {
      h += sangerAlignmentRow(a);
    });

    h += '</tbody></table></div>';
  }

  el.innerHTML = sangerStyles() + h;
}

function sangerAlignmentRow(a) {
  var h = '<tr class="sanger-row" onclick="sangerOpenDetail(' + a.id + ')" style="cursor:pointer">';
  h += '<td style="font-weight:600">' + esc(a.name) + '</td>';
  h += '<td><span style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.8rem;background:#f0ebe3;padding:2px 6px;border-radius:3px">' + esc(a.ref_name) + '</span></td>';
  h += '<td>' + identityBadge(a.identity_pct) + '</td>';
  h += '<td style="text-align:center">' + a.num_mismatches + '</td>';
  h += '<td style="text-align:center">' + a.num_gaps + '</td>';
  h += '<td style="color:#8a7f72;font-size:.85rem">' + relTime(a.created) + '</td>';
  h += '<td><button class="btn-sanger-icon" onclick="event.stopPropagation();sangerDelete(' + a.id + ')" title="Delete">✕</button></td>';
  h += '</tr>';
  return h;
}

/* ── NEW ALIGNMENT VIEW ─────────────────────────────────── */
async function renderNewAlignment(el) {
  try {
    var seqData = await api('GET', '/api/cloning/sequences');
    sangerState.plasmids = (seqData.items || []).filter(function(s) { return s.type === 'plasmid'; });
  } catch(e) { sangerState.plasmids = []; }

  var h = '<div style="max-width:720px;margin:0 auto">';
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">';
  h += '<button class="btn-sanger-ghost" onclick="sangerState.view=\'list\';setView(\'sanger\')">← Back</button>';
  h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72">new alignment</div>';
  h += '</div>';

  h += '<label class="sanger-label">Alignment name <span style="font-variant:normal;text-transform:none;letter-spacing:0;color:#b0a89a">(optional — defaults to filename)</span></label>';
  h += '<input type="text" id="sanger-name" class="sanger-input" placeholder="e.g. Colony 1 fwd">';

  /* AB1 upload — MULTIPLE */
  h += '<label class="sanger-label" style="margin-top:16px">AB1 files</label>';
  h += '<div id="sanger-ab1-drop" class="sanger-drop-zone" onclick="document.getElementById(\'sanger-ab1-input\').click()">';
  h += '<div id="sanger-ab1-label">Drop .ab1 file(s) here or click to browse</div>';
  h += '<input type="file" id="sanger-ab1-input" accept=".ab1,.abi" multiple style="display:none">';
  h += '</div>';
  h += '<div id="sanger-file-list" style="margin-top:6px"></div>';

  /* Reference source tabs */
  h += '<label class="sanger-label" style="margin-top:16px">Reference sequence</label>';
  h += '<div class="sanger-tabs">';
  h += '<button class="sanger-tab' + (sangerState.refMode === 'plasmid' ? ' active' : '') + '" onclick="sangerState.refMode=\'plasmid\';setView(\'sanger\')">From inventory</button>';
  h += '<button class="sanger-tab' + (sangerState.refMode === 'upload' ? ' active' : '') + '" onclick="sangerState.refMode=\'upload\';setView(\'sanger\')">Upload file</button>';
  h += '<button class="sanger-tab' + (sangerState.refMode === 'raw' ? ' active' : '') + '" onclick="sangerState.refMode=\'raw\';setView(\'sanger\')">Paste sequence</button>';
  h += '</div>';

  if (sangerState.refMode === 'plasmid') {
    h += '<select id="sanger-ref-plasmid" class="sanger-input">';
    h += '<option value="">Select a plasmid…</option>';
    sangerState.plasmids.forEach(function(p) {
      h += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    });
    h += '</select>';
    if (!sangerState.plasmids.length) {
      h += '<div style="color:#8a7f72;font-size:.85rem;margin-top:4px">No plasmids with .gb files found. Upload a reference file instead.</div>';
    }
  } else if (sangerState.refMode === 'upload') {
    h += '<div class="sanger-drop-zone" onclick="document.getElementById(\'sanger-ref-file-input\').click()" style="margin-top:8px">';
    h += '<div id="sanger-ref-label">Drop FASTA or GenBank file here</div>';
    h += '<input type="file" id="sanger-ref-file-input" accept=".fa,.fasta,.gb,.gbk,.genbank" style="display:none">';
    h += '</div>';
  } else {
    h += '<textarea id="sanger-ref-raw" class="sanger-input" rows="4" placeholder="Paste raw DNA sequence (ATCG only) or FASTA format" style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.82rem"></textarea>';
  }

  h += '<button class="btn-sanger-primary" style="margin-top:24px;width:100%" onclick="sangerRunAlignment()" id="sanger-run-btn">Align</button>';
  h += '<div id="sanger-status" style="margin-top:12px;color:#8a7f72;font-size:.85rem"></div>';
  h += '</div>';

  el.innerHTML = sangerStyles() + h;

  setTimeout(function() {
    var ab1Input = document.getElementById('sanger-ab1-input');
    var ab1Drop = document.getElementById('sanger-ab1-drop');
    if (ab1Input) {
      ab1Input.onchange = function() { sangerUpdateFileList(); };
    }
    if (ab1Drop) {
      ab1Drop.ondragover = function(e) { e.preventDefault(); ab1Drop.style.borderColor = '#5b7a5e'; };
      ab1Drop.ondragleave = function() { ab1Drop.style.borderColor = '#d5cec0'; };
      ab1Drop.ondrop = function(e) {
        e.preventDefault();
        ab1Drop.style.borderColor = '#5b7a5e';
        if (e.dataTransfer.files.length) {
          ab1Input.files = e.dataTransfer.files;
          sangerUpdateFileList();
        }
      };
    }
    var refInput = document.getElementById('sanger-ref-file-input');
    if (refInput) {
      refInput.onchange = function() {
        if (refInput.files[0]) {
          document.getElementById('sanger-ref-label').textContent = refInput.files[0].name;
        }
      };
    }
  }, 50);
}

function sangerUpdateFileList() {
  var ab1Input = document.getElementById('sanger-ab1-input');
  var listEl = document.getElementById('sanger-file-list');
  var dropLabel = document.getElementById('sanger-ab1-label');
  var drop = document.getElementById('sanger-ab1-drop');
  if (!ab1Input || !listEl) return;
  var files = ab1Input.files;
  if (!files.length) {
    listEl.innerHTML = '';
    dropLabel.textContent = 'Drop .ab1 file(s) here or click to browse';
    drop.style.borderColor = '#d5cec0';
    return;
  }
  drop.style.borderColor = '#5b7a5e';
  if (files.length === 1) {
    dropLabel.textContent = files[0].name;
    listEl.innerHTML = '';
  } else {
    dropLabel.textContent = files.length + ' files selected';
    var h = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">';
    for (var i = 0; i < files.length; i++) {
      h += '<span style="font-size:.78rem;background:#f0ebe3;padding:2px 8px;border-radius:4px;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace">' + esc(files[i].name) + '</span>';
    }
    h += '</div>';
    listEl.innerHTML = h;
  }
}

/* ── run alignment ───────────────────────────────────────── */
async function sangerRunAlignment() {
  var btn = document.getElementById('sanger-run-btn');
  var status = document.getElementById('sanger-status');
  var ab1Input = document.getElementById('sanger-ab1-input');
  if (!ab1Input || !ab1Input.files.length) { toast('Please select at least one AB1 file', true); return; }

  var fd = new FormData();
  for (var i = 0; i < ab1Input.files.length; i++) {
    fd.append('ab1', ab1Input.files[i]);
  }
  var nameVal = (document.getElementById('sanger-name') || {}).value || '';
  if (nameVal) fd.append('name', nameVal);

  if (sangerState.refMode === 'plasmid') {
    var sel = document.getElementById('sanger-ref-plasmid');
    if (!sel || !sel.value) { toast('Select a plasmid reference', true); return; }
    fd.append('ref_source', 'plasmid');
    fd.append('ref_id', sel.value);
  } else if (sangerState.refMode === 'upload') {
    var refFile = document.getElementById('sanger-ref-file-input');
    if (!refFile || !refFile.files[0]) { toast('Select a reference file', true); return; }
    var refContent = await refFile.files[0].text();
    var ext = refFile.files[0].name.split('.').pop().toLowerCase();
    var src = (ext === 'gb' || ext === 'gbk' || ext === 'genbank') ? 'genbank' : 'fasta';
    fd.append('ref_source', src);
    fd.append('ref_text', refContent);
  } else {
    var raw = (document.getElementById('sanger-ref-raw') || {}).value;
    if (!raw || !raw.trim()) { toast('Paste a reference sequence', true); return; }
    if (raw.trim().startsWith('>')) {
      fd.append('ref_source', 'fasta');
    } else {
      fd.append('ref_source', 'raw');
    }
    fd.append('ref_text', raw.trim());
  }

  var fileCount = ab1Input.files.length;
  btn.disabled = true;
  btn.textContent = 'Aligning ' + fileCount + ' file' + (fileCount > 1 ? 's' : '') + '…';
  status.textContent = 'Uploading and aligning — this may take a moment…';

  try {
    var resp = await fetch('/api/sanger/align', { method: 'POST', body: fd });
    if (!resp.ok) {
      var err = await resp.json().catch(function() { return { detail: resp.statusText }; });
      throw new Error(err.detail || 'Alignment failed');
    }
    var result = await resp.json();
    var items = result.items || [];
    var errors = result.errors || [];

    if (errors.length && items.length) {
      toast(items.length + ' aligned, ' + errors.length + ' failed');
    } else if (errors.length && !items.length) {
      toast('All files failed: ' + errors[0].error, true);
      status.textContent = '';
      btn.disabled = false;
      btn.textContent = 'Align';
      return;
    } else {
      toast(items.length + ' alignment' + (items.length > 1 ? 's' : '') + ' complete');
    }

    if (items.length === 1) {
      sangerState.view = 'detail';
      sangerState.current = items[0];
      sangerState.traceData = null;
      sangerState.batchItems = items;
      sangerState.batchIdx = 0;
    } else {
      sangerState.view = 'batch';
      sangerState.batchItems = items;
      sangerState.batchId = result.batch_id;
      sangerState.batchIdx = 0;
    }
    setView('sanger');
  } catch(e) {
    toast(e.message, true);
    status.textContent = '';
    btn.disabled = false;
    btn.textContent = 'Align';
  }
}

/* ── BATCH VIEW — summary of multi-file results ─────────── */
async function renderBatch(el) {
  var items = sangerState.batchItems;
  if (!items.length) { sangerState.view = 'list'; return renderList(el); }

  var h = '<div>';
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">';
  h += '<button class="btn-sanger-ghost" onclick="sangerState.view=\'list\';sangerState.batchItems=[];setView(\'sanger\')">← Back</button>';
  h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72">batch results</div>';
  h += '<div style="flex:1"></div>';
  h += '<span style="font-size:.85rem;color:#8a7f72">' + items.length + ' alignment' + (items.length > 1 ? 's' : '') + ' against <strong>' + esc(items[0].ref_name) + '</strong></span>';
  h += '</div>';

  h += '<div class="sanger-batch-grid">';
  items.forEach(function(a, idx) {
    var borderColor = a.identity_pct >= 98 ? QUAL_GOOD : a.identity_pct >= 90 ? QUAL_MED : QUAL_BAD;
    h += '<div class="sanger-batch-card" style="border-left:4px solid ' + borderColor + '" onclick="sangerBatchDetail(' + idx + ')">';
    h += '<div style="display:flex;justify-content:space-between;align-items:start">';
    h += '<div style="font-weight:600;font-size:.92rem;color:#4a4139">' + esc(a.name) + '</div>';
    h += identityBadge(a.identity_pct);
    h += '</div>';
    h += '<div style="display:flex;gap:16px;margin-top:8px;font-size:.8rem;color:#8a7f72">';
    h += '<span>' + a.num_mismatches + ' mismatch' + (a.num_mismatches !== 1 ? 'es' : '') + '</span>';
    h += '<span>' + a.num_gaps + ' gap' + (a.num_gaps !== 1 ? 's' : '') + '</span>';
    h += '<span>Ref ' + ((a.ref_start || 0) + 1) + '–' + (a.ref_end || 0) + '</span>';
    h += '</div>';
    h += '</div>';
  });
  h += '</div>';

  h += '</div>';
  el.innerHTML = sangerStyles() + h;
}

function sangerBatchDetail(idx) {
  sangerState.batchIdx = idx;
  sangerState.current = sangerState.batchItems[idx];
  sangerState.traceData = null;
  sangerState.traceZoom = 1;
  sangerState.traceScroll = 0;
  sangerState.view = 'detail';
  setView('sanger');
}

/* ── DETAIL VIEW ─────────────────────────────────────────── */
async function renderDetail(el) {
  var a = sangerState.current;
  if (!a) { sangerState.view = 'list'; return renderList(el); }

  if (!sangerState.traceData) {
    try {
      sangerState.traceData = await api('GET', '/api/sanger/alignments/' + a.id + '/trace');
    } catch(e) {
      sangerState.traceData = null;
    }
  }

  var inBatch = sangerState.batchItems.length > 1;

  var h = '<div>';
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">';
  if (inBatch) {
    h += '<button class="btn-sanger-ghost" onclick="sangerState.view=\'batch\';sangerState.traceData=null;setView(\'sanger\')">← Batch</button>';
  } else {
    h += '<button class="btn-sanger-ghost" onclick="sangerState.view=\'list\';sangerState.current=null;sangerState.traceData=null;setView(\'sanger\')">← Back</button>';
  }
  h += '<div style="font-weight:600;font-size:1.1rem;color:#4a4139">' + esc(a.name) + '</div>';
  h += '<div style="flex:1"></div>';

  if (inBatch) {
    var idx = sangerState.batchIdx;
    var total = sangerState.batchItems.length;
    h += '<div style="display:flex;align-items:center;gap:6px">';
    h += '<button class="btn-sanger-ghost btn-sm" onclick="sangerBatchNav(-1)"' + (idx === 0 ? ' disabled style="opacity:.3;pointer-events:none"' : '') + '>‹ Prev</button>';
    h += '<span style="font-size:.82rem;color:#8a7f72">' + (idx + 1) + ' / ' + total + '</span>';
    h += '<button class="btn-sanger-ghost btn-sm" onclick="sangerBatchNav(1)"' + (idx >= total - 1 ? ' disabled style="opacity:.3;pointer-events:none"' : '') + '>Next ›</button>';
    h += '</div>';
  }

  h += identityBadge(a.identity_pct);
  h += '</div>';

  h += '<div class="sanger-stats-bar">';
  h += sangerStat('Reference', a.ref_name);
  h += sangerStat('Source', a.ref_source);
  h += sangerStat('Score', a.alignment_score ? a.alignment_score.toFixed(1) : '—');
  h += sangerStat('Mismatches', a.num_mismatches);
  h += sangerStat('Gaps', a.num_gaps);
  h += sangerStat('Ref region', ((a.ref_start || 0) + 1) + '–' + (a.ref_end || 0));
  h += sangerStat('Query region', ((a.query_start || 0) + 1) + '–' + (a.query_end || 0));
  h += '</div>';

  if (sangerState.traceData && sangerState.traceData.quals && sangerState.traceData.quals.length) {
    h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin:24px 0 8px">quality scores</div>';
    h += '<div style="position:relative;height:80px;background:#f0ebe3;border-radius:6px;overflow:hidden" id="sanger-qual-chart"></div>';
    h += '<div style="display:flex;gap:16px;margin-top:4px;font-size:.75rem;color:#8a7f72">';
    h += '<span><span style="display:inline-block;width:10px;height:10px;background:' + QUAL_GOOD + ';border-radius:2px;margin-right:3px"></span>Q≥30</span>';
    h += '<span><span style="display:inline-block;width:10px;height:10px;background:' + QUAL_MED + ';border-radius:2px;margin-right:3px"></span>Q≥20</span>';
    h += '<span><span style="display:inline-block;width:10px;height:10px;background:' + QUAL_BAD + ';border-radius:2px;margin-right:3px"></span>Q&lt;20</span>';
    h += '</div>';
  }

  if (sangerState.traceData && sangerState.traceData.traces) {
    h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin:24px 0 8px">chromatogram</div>';
    h += '<div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">';
    h += '<button class="btn-sanger-ghost btn-sm" onclick="sangerZoom(-1)">−</button>';
    h += '<span id="sanger-zoom-label" style="font-size:.8rem;color:#8a7f72;min-width:40px;text-align:center">' + sangerState.traceZoom.toFixed(1) + 'x</span>';
    h += '<button class="btn-sanger-ghost btn-sm" onclick="sangerZoom(1)">+</button>';
    h += '<button class="btn-sanger-ghost btn-sm" onclick="sangerZoom(0)">Reset</button>';
    h += '<div style="flex:1"></div>';
    h += '<div style="display:flex;gap:10px;font-size:.75rem">';
    Object.keys(TRACE_COLORS).forEach(function(b) {
      h += '<span style="color:' + TRACE_COLORS[b] + ';font-weight:700;font-family:\'SF Mono\',Monaco,Consolas,monospace">' + b + '</span>';
    });
    h += '</div></div>';
    h += '<div id="sanger-trace-container" style="position:relative;overflow:hidden;background:#fff;border:1px solid #d5cec0;border-radius:6px;cursor:grab">';
    h += '<canvas id="sanger-trace-canvas" style="display:block"></canvas>';
    h += '</div>';
  }

  if (a.aligned_ref && a.aligned_query) {
    h += '<div style="font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin:24px 0 8px">sequence alignment</div>';
    h += '<div class="sanger-alignment-wrap" id="sanger-alignment-box">';
    h += buildAlignmentHTML(a.aligned_ref, a.aligned_query, a.ref_start || 0);
    h += '</div>';
  }

  h += '</div>';
  el.innerHTML = sangerStyles() + h;

  setTimeout(function() {
    if (sangerState.traceData) {
      renderQualityChart();
      renderTraceCanvas();
      wireTraceDrag();
    }
  }, 60);
}

function sangerBatchNav(dir) {
  var newIdx = sangerState.batchIdx + dir;
  if (newIdx < 0 || newIdx >= sangerState.batchItems.length) return;
  sangerState.batchIdx = newIdx;
  sangerState.current = sangerState.batchItems[newIdx];
  sangerState.traceData = null;
  sangerState.traceZoom = 1;
  sangerState.traceScroll = 0;
  setView('sanger');
}

function sangerStat(label, val) {
  return '<div class="sanger-stat"><div class="sanger-stat-label">' + esc(label) + '</div><div class="sanger-stat-val">' + esc(String(val)) + '</div></div>';
}

/* ── quality bar chart (canvas) ──────────────────────────── */
function renderQualityChart() {
  var box = document.getElementById('sanger-qual-chart');
  if (!box || !sangerState.traceData) return;
  var quals = sangerState.traceData.quals;
  var n = quals.length;
  if (!n) return;
  var maxQ = 50;
  var barW = Math.max(1, Math.min(4, box.clientWidth / n));
  var canvas = document.createElement('canvas');
  canvas.width = Math.ceil(barW * n);
  canvas.height = 80;
  canvas.style.width = '100%';
  canvas.style.height = '80px';
  var ctx = canvas.getContext('2d');
  for (var i = 0; i < n; i++) {
    var q = quals[i];
    var bh = Math.round((q / maxQ) * 76);
    ctx.fillStyle = qualColor(q);
    ctx.fillRect(i * barW, 80 - bh, Math.max(1, barW - 0.5), bh);
  }
  box.innerHTML = '';
  box.appendChild(canvas);
}

/* ── trace canvas ────────────────────────────────────────── */
function renderTraceCanvas() {
  var canvas = document.getElementById('sanger-trace-canvas');
  var container = document.getElementById('sanger-trace-container');
  if (!canvas || !sangerState.traceData) return;
  var td = sangerState.traceData;
  var traces = td.traces;
  var peaks = td.peaks || [];
  var bases = td.bases || '';

  var traceLen = Math.max(
    traces.G.length, traces.A.length, traces.T.length, traces.C.length, 1
  );

  var pxPerSample = 1.2 * sangerState.traceZoom;
  var totalW = Math.ceil(traceLen * pxPerSample);
  var H = 260;
  canvas.width = totalW;
  canvas.height = H;
  canvas.style.width = totalW + 'px';
  canvas.style.height = H + 'px';
  container.style.height = H + 'px';

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, totalW, H);

  var maxAmp = 0;
  ['G', 'A', 'T', 'C'].forEach(function(ch) {
    for (var i = 0; i < traces[ch].length; i++) {
      if (traces[ch][i] > maxAmp) maxAmp = traces[ch][i];
    }
  });
  if (maxAmp === 0) maxAmp = 1;
  var scaleY = (H - 40) / maxAmp;

  ['G', 'A', 'T', 'C'].forEach(function(ch) {
    var data = traces[ch];
    ctx.beginPath();
    ctx.strokeStyle = TRACE_COLORS[ch];
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (var i = 0; i < data.length; i++) {
      var x = i * pxPerSample;
      var y = H - 30 - data[i] * scaleY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  ctx.font = '10px "SF Mono",Monaco,Consolas,monospace';
  ctx.textAlign = 'center';
  for (var i = 0; i < peaks.length && i < bases.length; i++) {
    var x = peaks[i] * pxPerSample;
    var base = bases[i];
    ctx.fillStyle = TRACE_COLORS[base] || '#999';
    ctx.fillText(base, x, H - 6);
    ctx.strokeStyle = '#d5cec0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, H - 20);
    ctx.lineTo(x, H - 28);
    ctx.stroke();
  }

  container.scrollLeft = sangerState.traceScroll;
}

function wireTraceDrag() {
  var container = document.getElementById('sanger-trace-container');
  if (!container) return;
  container.onmousedown = function(e) {
    sangerState.dragging = true;
    sangerState.dragStart = e.clientX;
    sangerState.scrollStart = container.scrollLeft;
    container.style.cursor = 'grabbing';
    e.preventDefault();
  };
  document.addEventListener('mousemove', function(e) {
    if (!sangerState.dragging) return;
    var c = document.getElementById('sanger-trace-container');
    if (!c) return;
    c.scrollLeft = sangerState.scrollStart - (e.clientX - sangerState.dragStart);
  });
  document.addEventListener('mouseup', function() {
    if (!sangerState.dragging) return;
    sangerState.dragging = false;
    var c = document.getElementById('sanger-trace-container');
    if (c) {
      c.style.cursor = 'grab';
      sangerState.traceScroll = c.scrollLeft;
    }
  });
}

function sangerZoom(dir) {
  if (dir === 0) { sangerState.traceZoom = 1; sangerState.traceScroll = 0; }
  else if (dir > 0) sangerState.traceZoom = Math.min(8, sangerState.traceZoom * 1.3);
  else sangerState.traceZoom = Math.max(0.3, sangerState.traceZoom / 1.3);
  renderTraceCanvas();
  var label = document.getElementById('sanger-zoom-label');
  if (label) label.textContent = sangerState.traceZoom.toFixed(1) + 'x';
}

/* ── alignment HTML builder ──────────────────────────────── */
function buildAlignmentHTML(refAln, qryAln, refOffset) {
  var BLOCK = 80;
  var h = '';
  var len = Math.max(refAln.length, qryAln.length);
  for (var i = 0; i < len; i += BLOCK) {
    var rSlice = refAln.substring(i, i + BLOCK);
    var qSlice = qryAln.substring(i, i + BLOCK);
    var matchLine = '';
    var refLine = '';
    var qryLine = '';
    for (var j = 0; j < rSlice.length; j++) {
      var rb = rSlice[j] || ' ';
      var qb = qSlice[j] || ' ';
      if (rb === qb && rb !== '-') {
        matchLine += '|';
        refLine += rb;
        qryLine += qb;
      } else if (rb === '-' || qb === '-') {
        matchLine += ' ';
        refLine += '<span class="sanger-gap">' + rb + '</span>';
        qryLine += '<span class="sanger-gap">' + qb + '</span>';
      } else {
        matchLine += ' ';
        refLine += '<span class="sanger-mismatch">' + rb + '</span>';
        qryLine += '<span class="sanger-mismatch">' + qb + '</span>';
      }
    }
    var pos = refOffset + i + 1;
    h += '<div class="sanger-aln-block">';
    h += '<div class="sanger-aln-num">' + pos + '</div>';
    h += '<div class="sanger-aln-label">Ref</div><div class="sanger-aln-seq">' + refLine + '</div>';
    h += '<div class="sanger-aln-num"></div>';
    h += '<div class="sanger-aln-label"></div><div class="sanger-aln-seq sanger-aln-match">' + matchLine + '</div>';
    h += '<div class="sanger-aln-num"></div>';
    h += '<div class="sanger-aln-label">Qry</div><div class="sanger-aln-seq">' + qryLine + '</div>';
    h += '</div>';
  }
  return h;
}

/* ── actions ─────────────────────────────────────────────── */
async function sangerOpenDetail(id) {
  try {
    sangerState.current = await api('GET', '/api/sanger/alignments/' + id);
    sangerState.traceData = null;
    sangerState.traceZoom = 1;
    sangerState.traceScroll = 0;
    sangerState.batchItems = [sangerState.current];
    sangerState.batchIdx = 0;
    sangerState.view = 'detail';
    setView('sanger');
  } catch(e) {
    toast('Failed to load alignment', true);
  }
}

async function sangerOpenBatch(batchId) {
  try {
    var data = await api('GET', '/api/sanger/batch/' + batchId);
    sangerState.batchItems = data.items || [];
    sangerState.batchId = batchId;
    sangerState.batchIdx = 0;
    sangerState.view = 'batch';
    setView('sanger');
  } catch(e) {
    toast('Failed to load batch', true);
  }
}

async function sangerDelete(id) {
  if (!confirm('Delete this alignment?')) return;
  try {
    await api('DELETE', '/api/sanger/alignments/' + id);
    toast('Alignment deleted');
    sangerState.view = 'list';
    setView('sanger');
  } catch(e) {
    toast('Delete failed', true);
  }
}

async function sangerDeleteBatch(batchId) {
  if (!confirm('Delete all alignments in this batch?')) return;
  try {
    await api('DELETE', '/api/sanger/batch/' + batchId);
    toast('Batch deleted');
    sangerState.view = 'list';
    setView('sanger');
  } catch(e) {
    toast('Delete failed', true);
  }
}

/* ── styles ──────────────────────────────────────────────── */
function sangerStyles() {
  return '<style>\
.btn-sanger-primary{background:#5b7a5e;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600;transition:background .15s}\
.btn-sanger-primary:hover{background:#4a6a4d}\
.btn-sanger-primary:disabled{opacity:.5;cursor:default}\
.btn-sanger-ghost{background:none;border:1px solid #d5cec0;color:#4a4139;padding:5px 14px;border-radius:6px;font-size:.82rem;cursor:pointer;transition:border-color .15s}\
.btn-sanger-ghost:hover{border-color:#8a7f72}\
.btn-sanger-ghost.btn-sm{padding:3px 10px;font-size:.78rem}\
.btn-sanger-icon{background:none;border:none;color:#8a7f72;cursor:pointer;font-size:.9rem;padding:4px 6px;border-radius:4px;transition:color .15s}\
.btn-sanger-icon:hover{color:#c25a4a}\
.sanger-empty{text-align:center;padding:60px 20px;color:#4a4139}\
.sanger-table-wrap{overflow-x:auto}\
.sanger-table{width:100%;border-collapse:collapse;font-size:.88rem}\
.sanger-table th{text-align:left;font-variant:small-caps;font-size:.72rem;letter-spacing:.1em;color:#8a7f72;padding:8px 12px;border-bottom:2px solid #d5cec0}\
.sanger-table td{padding:10px 12px;border-bottom:1px solid #ece7dd}\
.sanger-row:hover{background:#f5f1ea}\
.sanger-batch-row{background:#faf7f2}\
.sanger-batch-badge{display:inline-block;background:#5b7a5e;color:#fff;font-size:.7rem;padding:2px 7px;border-radius:3px;font-weight:600;margin-right:6px;font-variant:normal}\
.sanger-label{display:block;font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin-bottom:4px}\
.sanger-input{width:100%;padding:9px 12px;border:1px solid #d5cec0;border-radius:6px;background:#fff;font-size:.9rem;color:#4a4139;box-sizing:border-box}\
.sanger-input:focus{outline:none;border-color:#5b7a5e}\
.sanger-drop-zone{border:2px dashed #d5cec0;border-radius:8px;padding:28px;text-align:center;color:#8a7f72;cursor:pointer;transition:border-color .2s;font-size:.88rem}\
.sanger-drop-zone:hover{border-color:#5b7a5e}\
.sanger-tabs{display:flex;gap:0;margin-bottom:10px}\
.sanger-tab{padding:7px 16px;border:1px solid #d5cec0;background:#f0ebe3;color:#8a7f72;font-size:.82rem;cursor:pointer;transition:all .15s;border-right:none}\
.sanger-tab:first-child{border-radius:6px 0 0 6px}\
.sanger-tab:last-child{border-radius:0 6px 6px 0;border-right:1px solid #d5cec0}\
.sanger-tab.active{background:#5b7a5e;color:#fff;border-color:#5b7a5e}\
.sanger-stats-bar{display:flex;flex-wrap:wrap;gap:12px;background:#f0ebe3;border-radius:8px;padding:14px 18px}\
.sanger-stat{}\
.sanger-stat-label{font-variant:small-caps;font-size:.65rem;letter-spacing:.1em;color:#8a7f72}\
.sanger-stat-val{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.85rem;color:#4a4139;margin-top:1px}\
.sanger-batch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}\
.sanger-batch-card{background:#fff;border:1px solid #d5cec0;border-radius:8px;padding:16px;cursor:pointer;transition:box-shadow .15s}\
.sanger-batch-card:hover{box-shadow:0 2px 8px rgba(60,52,42,.1)}\
.sanger-alignment-wrap{background:#fff;border:1px solid #d5cec0;border-radius:6px;padding:16px;overflow-x:auto;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.78rem;line-height:1.5}\
.sanger-aln-block{display:grid;grid-template-columns:50px 28px 1fr;margin-bottom:8px}\
.sanger-aln-num{color:#8a7f72;font-size:.7rem;text-align:right;padding-right:6px}\
.sanger-aln-label{color:#8a7f72;font-size:.7rem}\
.sanger-aln-seq{white-space:pre;letter-spacing:.05em}\
.sanger-aln-match{color:#5b7a5e}\
.sanger-mismatch{background:#f5d0ca;color:#c25a4a;border-radius:2px;padding:0 1px}\
.sanger-gap{background:#f5ecc8;color:#a08930;border-radius:2px;padding:0 1px}\
</style>';
}

registerView('sanger', renderSanger);
