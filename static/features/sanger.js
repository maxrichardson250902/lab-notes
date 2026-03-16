/* Sanger Sequencing — Benchling-style stacked alignment viewer */

/* ── state ────────────────────────────────────────────────── */
var SG = {
  alignments: [],
  view: 'list',         // 'list' | 'new' | 'viewer'
  batchItems: [],
  batchId: null,
  refSeq: '',
  refAnnos: [],
  refName: '',
  traces: {},           // {alignmentId: traceData}
  plasmids: [],
  refMode: 'plasmid',
  zoom: 1.0,
  COL_W: 14,            // base px per column at 1x
};

var TRACE_COLORS = { A: '#2e8b40', C: '#2266cc', G: '#333', T: '#cc2222' };
var ANNO_COLORS = {
  CDS: '#4a90d9', gene: '#5b7a5e', promoter: '#c9a84c', terminator: '#c25a4a',
  rep_origin: '#7b68ae', misc_feature: '#b0a89a', primer_bind: '#d48c2e'
};
var QUAL_GOOD = '#5b7a5e', QUAL_MED = '#c9a84c', QUAL_BAD = '#c25a4a';

function qualColor(q) { return q >= 30 ? QUAL_GOOD : q >= 20 ? QUAL_MED : QUAL_BAD; }
function identityBadge(pct) {
  var c = pct >= 98 ? QUAL_GOOD : pct >= 90 ? QUAL_MED : QUAL_BAD;
  return '<span style="background:'+c+';color:#fff;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600">'+pct.toFixed(1)+'%</span>';
}
function sgNav(v) { SG.view = v || 'list'; S.view = ''; setView('sanger'); }

/* ── main render ─────────────────────────────────────────── */
async function renderSanger(el) {
  if (SG.view === 'new')    return renderNew(el);
  if (SG.view === 'viewer') return renderViewer(el);
  return renderList(el);
}

/* ── LIST VIEW ───────────────────────────────────────────── */
async function renderList(el) {
  var data = await api('GET', '/api/sanger/alignments');
  SG.alignments = data.items || [];
  var items = SG.alignments;

  var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">';
  h += '<div class="sg-section-hdr">sanger alignments</div>';
  h += '<button class="sg-btn-pri" onclick="sgNav(\'new\')">+ New Alignment</button>';
  h += '</div>';

  if (!items.length) {
    h += '<div class="sg-empty"><div style="font-size:1.5rem;margin-bottom:8px">No alignments yet</div>';
    h += '<div style="color:#8a7f72">Upload AB1 files and align them against a reference.</div></div>';
  } else {
    var batches = {}, singles = [];
    items.forEach(function(a) {
      if (a.batch_id) { if (!batches[a.batch_id]) batches[a.batch_id] = []; batches[a.batch_id].push(a); }
      else singles.push(a);
    });
    h += '<div class="sg-table-wrap"><table class="sg-table"><thead><tr>';
    h += '<th>Name</th><th>Reference</th><th>Identity</th><th>Reads</th><th>Date</th><th></th>';
    h += '</tr></thead><tbody>';
    Object.keys(batches).forEach(function(bid) {
      var g = batches[bid];
      var avg = g.reduce(function(s,a){return s+a.identity_pct;},0)/g.length;
      h += '<tr class="sg-row" onclick="sgOpenBatch(\''+bid+'\')" style="cursor:pointer">';
      h += '<td style="font-weight:600">'+esc(g[0].ref_name)+' batch</td>';
      h += '<td><span class="sg-mono-tag">'+esc(g[0].ref_name)+'</span></td>';
      h += '<td>'+identityBadge(avg)+' <span style="font-size:.72rem;color:#8a7f72">avg</span></td>';
      h += '<td><span class="sg-batch-count">'+g.length+'</span></td>';
      h += '<td style="color:#8a7f72;font-size:.85rem">'+relTime(g[0].created)+'</td>';
      h += '<td><button class="sg-btn-x" onclick="event.stopPropagation();sgDelBatch(\''+bid+'\')">✕</button></td>';
      h += '</tr>';
    });
    singles.forEach(function(a) {
      h += '<tr class="sg-row" onclick="sgOpenSingle('+a.id+',\''+a.batch_id+'\')" style="cursor:pointer">';
      h += '<td style="font-weight:600">'+esc(a.name)+'</td>';
      h += '<td><span class="sg-mono-tag">'+esc(a.ref_name)+'</span></td>';
      h += '<td>'+identityBadge(a.identity_pct)+'</td>';
      h += '<td>1</td>';
      h += '<td style="color:#8a7f72;font-size:.85rem">'+relTime(a.created)+'</td>';
      h += '<td><button class="sg-btn-x" onclick="event.stopPropagation();sgDel('+a.id+')">✕</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }
  el.innerHTML = sgStyles() + h;
}

/* ── NEW ALIGNMENT VIEW ─────────────────────────────────── */
async function renderNew(el) {
  try {
    var seqData = await api('GET', '/api/cloning/sequences');
    SG.plasmids = (seqData.items||[]).filter(function(s){return s.type==='plasmid';});
  } catch(e) { SG.plasmids = []; }

  var h = '<div style="max-width:720px;margin:0 auto">';
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">';
  h += '<button class="sg-btn-ghost" onclick="sgNav(\'list\')">← Back</button>';
  h += '<div class="sg-section-hdr">new alignment</div></div>';

  h += '<label class="sg-label">Name <span style="font-variant:normal;text-transform:none;letter-spacing:0;color:#b0a89a">(optional)</span></label>';
  h += '<input type="text" id="sg-name" class="sg-input" placeholder="e.g. Colony 1 fwd">';

  h += '<label class="sg-label" style="margin-top:16px">AB1 files</label>';
  h += '<div id="sg-ab1-drop" class="sg-drop" onclick="document.getElementById(\'sg-ab1-input\').click()">';
  h += '<div id="sg-ab1-label">Drop .ab1 file(s) here or click to browse</div>';
  h += '<input type="file" id="sg-ab1-input" accept=".ab1,.abi" multiple style="display:none"></div>';
  h += '<div id="sg-file-list" style="margin-top:6px"></div>';

  h += '<label class="sg-label" style="margin-top:16px">Reference sequence</label>';
  h += '<div class="sg-tabs">';
  h += '<button class="sg-tab'+(SG.refMode==='plasmid'?' active':'')+'" onclick="SG.refMode=\'plasmid\';sgNav(\'new\')">From inventory</button>';
  h += '<button class="sg-tab'+(SG.refMode==='upload'?' active':'')+'" onclick="SG.refMode=\'upload\';sgNav(\'new\')">Upload file</button>';
  h += '<button class="sg-tab'+(SG.refMode==='raw'?' active':'')+'" onclick="SG.refMode=\'raw\';sgNav(\'new\')">Paste sequence</button>';
  h += '</div>';

  if (SG.refMode === 'plasmid') {
    h += '<select id="sg-ref-plasmid" class="sg-input"><option value="">Select a plasmid…</option>';
    SG.plasmids.forEach(function(p) { h += '<option value="'+p.id+'">'+esc(p.name)+'</option>'; });
    h += '</select>';
    if (!SG.plasmids.length) h += '<div style="color:#8a7f72;font-size:.85rem;margin-top:4px">No plasmids with .gb files found.</div>';
  } else if (SG.refMode === 'upload') {
    h += '<div class="sg-drop" onclick="document.getElementById(\'sg-ref-file\').click()" style="margin-top:8px">';
    h += '<div id="sg-ref-label">Drop FASTA or GenBank file here</div>';
    h += '<input type="file" id="sg-ref-file" accept=".fa,.fasta,.gb,.gbk,.genbank" style="display:none"></div>';
  } else {
    h += '<textarea id="sg-ref-raw" class="sg-input" rows="4" placeholder="Paste raw DNA sequence or FASTA" style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.82rem"></textarea>';
  }

  h += '<button class="sg-btn-pri" style="margin-top:24px;width:100%" onclick="sgRunAlign()" id="sg-run-btn">Align</button>';
  h += '<div id="sg-status" style="margin-top:12px;color:#8a7f72;font-size:.85rem"></div>';
  h += '</div>';
  el.innerHTML = sgStyles() + h;

  setTimeout(function() {
    var inp = document.getElementById('sg-ab1-input');
    var drop = document.getElementById('sg-ab1-drop');
    if (inp) inp.onchange = function() { sgUpdateFiles(); };
    if (drop) {
      drop.ondragover = function(e) { e.preventDefault(); drop.style.borderColor='#5b7a5e'; };
      drop.ondragleave = function() { drop.style.borderColor='#d5cec0'; };
      drop.ondrop = function(e) { e.preventDefault(); inp.files=e.dataTransfer.files; sgUpdateFiles(); };
    }
    var rf = document.getElementById('sg-ref-file');
    if (rf) rf.onchange = function() { if(rf.files[0]) document.getElementById('sg-ref-label').textContent=rf.files[0].name; };
  }, 50);
}

function sgUpdateFiles() {
  var inp = document.getElementById('sg-ab1-input');
  var list = document.getElementById('sg-file-list');
  var label = document.getElementById('sg-ab1-label');
  var drop = document.getElementById('sg-ab1-drop');
  if (!inp||!list) return;
  var f = inp.files;
  if (!f.length) { list.innerHTML=''; label.textContent='Drop .ab1 file(s) here or click to browse'; drop.style.borderColor='#d5cec0'; return; }
  drop.style.borderColor='#5b7a5e';
  if (f.length===1) { label.textContent=f[0].name; list.innerHTML=''; }
  else {
    label.textContent=f.length+' files selected';
    var h='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    for(var i=0;i<f.length;i++) h+='<span class="sg-mono-tag">'+esc(f[i].name)+'</span>';
    list.innerHTML=h+'</div>';
  }
}

async function sgRunAlign() {
  var btn=document.getElementById('sg-run-btn'), status=document.getElementById('sg-status');
  var inp=document.getElementById('sg-ab1-input');
  if(!inp||!inp.files.length){toast('Select at least one AB1 file',true);return;}

  var fd=new FormData();
  for(var i=0;i<inp.files.length;i++) fd.append('ab1',inp.files[i]);
  var nm=(document.getElementById('sg-name')||{}).value||'';
  if(nm)fd.append('name',nm);

  if(SG.refMode==='plasmid'){
    var sel=document.getElementById('sg-ref-plasmid');
    if(!sel||!sel.value){toast('Select a plasmid',true);return;}
    fd.append('ref_source','plasmid'); fd.append('ref_id',sel.value);
  } else if(SG.refMode==='upload'){
    var rf=document.getElementById('sg-ref-file');
    if(!rf||!rf.files[0]){toast('Select a reference file',true);return;}
    var txt=await rf.files[0].text();
    var ext=rf.files[0].name.split('.').pop().toLowerCase();
    fd.append('ref_source',(ext==='gb'||ext==='gbk'||ext==='genbank')?'genbank':'fasta');
    fd.append('ref_text',txt);
  } else {
    var raw=(document.getElementById('sg-ref-raw')||{}).value;
    if(!raw||!raw.trim()){toast('Paste a reference',true);return;}
    fd.append('ref_source',raw.trim().startsWith('>')?'fasta':'raw');
    fd.append('ref_text',raw.trim());
  }

  btn.disabled=true; btn.textContent='Aligning…';
  status.textContent='Uploading and aligning…';
  try {
    var resp=await fetch('/api/sanger/align',{method:'POST',body:fd});
    if(!resp.ok){var e=await resp.json().catch(function(){return{detail:resp.statusText};});throw new Error(e.detail||'Failed');}
    var res=await resp.json();
    if(res.errors&&res.errors.length&&res.items.length) toast(res.items.length+' aligned, '+res.errors.length+' failed');
    else if(res.errors&&res.errors.length) { toast('All failed: '+res.errors[0].error,true); btn.disabled=false; btn.textContent='Align'; status.textContent=''; return; }
    else toast(res.items.length+' alignment'+(res.items.length>1?'s':'')+' complete');
    SG.batchId=res.batch_id;
    sgOpenBatch(res.batch_id);
  } catch(e) { toast(e.message,true); btn.disabled=false; btn.textContent='Align'; status.textContent=''; }
}

/* ── open batch / load data ──────────────────────────────── */
async function sgOpenBatch(bid) {
  try {
    var data = await api('GET','/api/sanger/batch/'+bid);
    SG.batchItems = data.items||[];
    SG.batchId = bid;
    SG.refSeq = data.ref_sequence||'';
    SG.refAnnos = data.ref_annotations||[];
    SG.refName = data.ref_name||'';
    SG.traces = {};
    SG.view = 'viewer';
    // Load all traces in parallel
    var promises = SG.batchItems.map(function(a) {
      return api('GET','/api/sanger/alignments/'+a.id+'/trace').then(function(t) { SG.traces[a.id]=t; }).catch(function(){});
    });
    await Promise.all(promises);
    sgNav('viewer');
  } catch(e) { toast('Failed to load batch',true); }
}

async function sgOpenSingle(id, bid) {
  if (bid) return sgOpenBatch(bid);
  // Single without batch - wrap it
  try {
    var a = await api('GET','/api/sanger/alignments/'+id);
    SG.batchItems = [a];
    SG.batchId = a.batch_id;
    SG.refSeq = '';
    SG.refAnnos = [];
    SG.refName = a.ref_name;
    SG.traces = {};
    // Try loading batch data
    if (a.batch_id) {
      try {
        var bd = await api('GET','/api/sanger/batch/'+a.batch_id);
        SG.refSeq = bd.ref_sequence||'';
        SG.refAnnos = bd.ref_annotations||[];
        SG.batchItems = bd.items||[a];
      } catch(e) {}
    }
    var promises = SG.batchItems.map(function(al) {
      return api('GET','/api/sanger/alignments/'+al.id+'/trace').then(function(t){SG.traces[al.id]=t;}).catch(function(){});
    });
    await Promise.all(promises);
    SG.view = 'viewer';
    sgNav('viewer');
  } catch(e) { toast('Failed to load',true); }
}

/* ── VIEWER — Benchling-style stacked alignment ──────────── */
async function renderViewer(el) {
  var items = SG.batchItems;
  if (!items.length) return sgNav('list');

  // Compute span across all alignments
  var spanStart = Infinity, spanEnd = 0;
  items.forEach(function(a) {
    if (a.ref_start < spanStart) spanStart = a.ref_start;
    if (a.ref_end > spanEnd) spanEnd = a.ref_end;
  });
  if (spanStart >= spanEnd) { spanStart = 0; spanEnd = SG.refSeq.length || 100; }

  var colW = Math.round(SG.COL_W * SG.zoom);
  var numCols = spanEnd - spanStart;
  var totalW = numCols * colW;
  var TRACE_H = 120;
  var BASE_H = 18;

  var h = '';
  // Header
  h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">';
  h += '<button class="sg-btn-ghost" onclick="SG.traces={};sgNav(\'list\')">← Back</button>';
  h += '<div style="font-weight:600;font-size:1.05rem;color:#4a4139">'+esc(SG.refName)+'</div>';
  h += '<div style="flex:1"></div>';
  h += '<div style="display:flex;align-items:center;gap:6px">';
  h += '<button class="sg-btn-ghost sg-btn-sm" onclick="sgZoom(-1)">−</button>';
  h += '<span id="sg-zoom-lbl" style="font-size:.78rem;color:#8a7f72;min-width:36px;text-align:center">'+SG.zoom.toFixed(1)+'x</span>';
  h += '<button class="sg-btn-ghost sg-btn-sm" onclick="sgZoom(1)">+</button>';
  h += '<button class="sg-btn-ghost sg-btn-sm" onclick="sgZoom(0)">Reset</button>';
  h += '</div>';
  h += '<div style="display:flex;gap:8px;font-size:.75rem;font-family:\'SF Mono\',Monaco,Consolas,monospace">';
  h += '<span style="color:'+TRACE_COLORS.A+';font-weight:700">A</span>';
  h += '<span style="color:'+TRACE_COLORS.C+';font-weight:700">C</span>';
  h += '<span style="color:'+TRACE_COLORS.G+';font-weight:700">G</span>';
  h += '<span style="color:'+TRACE_COLORS.T+';font-weight:700">T</span>';
  h += '</div></div>';

  // Main layout: fixed labels + scrollable content
  h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:8px;overflow:hidden;background:#fff">';

  // Left labels panel
  h += '<div class="sg-labels" style="width:130px;min-width:130px;border-right:1px solid #d5cec0;background:#faf8f4">';
  // Ruler label
  h += '<div class="sg-label-row" style="height:22px;font-size:.7rem;color:#8a7f72;line-height:22px">Position</div>';
  // Annotation label
  if (SG.refAnnos.length) {
    h += '<div class="sg-label-row" style="height:24px;font-size:.7rem;color:#8a7f72;line-height:24px">Features</div>';
  }
  // Reference label
  h += '<div class="sg-label-row" style="height:'+BASE_H+'px;font-size:.7rem;color:#8a7f72;line-height:'+BASE_H+'px;border-bottom:2px solid #d5cec0">Reference</div>';
  // Per-file labels
  items.forEach(function(a) {
    var trackH = TRACE_H + BASE_H;
    h += '<div class="sg-label-row" style="height:'+trackH+'px;border-bottom:1px solid #ece7dd;padding:6px 10px">';
    h += '<div style="font-weight:600;font-size:.82rem;color:#4a4139;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(a.name)+'">'+esc(a.name)+'</div>';
    h += '<div style="margin-top:3px">'+identityBadge(a.identity_pct)+'</div>';
    h += '<div style="font-size:.7rem;color:#8a7f72;margin-top:2px">'+a.num_mismatches+'mm '+a.num_gaps+'gap</div>';
    h += '</div>';
  });
  h += '</div>';

  // Scrollable content
  h += '<div id="sg-scroll" style="flex:1;overflow-x:auto;overflow-y:hidden">';
  h += '<div style="width:'+totalW+'px;min-width:'+totalW+'px">';

  // Ruler track
  h += '<div style="height:22px;position:relative;background:#f5f1ea">';
  for (var p = spanStart; p < spanEnd; p++) {
    if ((p+1) % 10 === 0 || p === spanStart) {
      var x = (p - spanStart) * colW;
      h += '<span style="position:absolute;left:'+x+'px;top:2px;font-size:.65rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace">'+(p+1)+'</span>';
    }
  }
  h += '</div>';

  // Annotation track
  if (SG.refAnnos.length) {
    h += '<div style="height:24px;position:relative;background:#faf8f4">';
    SG.refAnnos.forEach(function(an) {
      var aStart = Math.max(an.start, spanStart);
      var aEnd = Math.min(an.end, spanEnd);
      if (aStart >= aEnd) return;
      var x = (aStart - spanStart) * colW;
      var w = (aEnd - aStart) * colW;
      var col = ANNO_COLORS[an.type] || ANNO_COLORS.misc_feature;
      h += '<div title="'+esc(an.label)+' ('+an.type+')" style="position:absolute;left:'+x+'px;top:3px;width:'+w+'px;height:18px;background:'+col+';border-radius:3px;overflow:hidden;display:flex;align-items:center;padding:0 4px">';
      if (w > 30) h += '<span style="font-size:.6rem;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(an.label)+'</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  // Reference sequence track
  h += '<div style="height:'+BASE_H+'px;display:flex;border-bottom:2px solid #d5cec0;background:#f5f1ea">';
  for (var p = spanStart; p < spanEnd; p++) {
    var base = SG.refSeq[p] || '?';
    h += '<div class="sg-base" style="width:'+colW+'px;color:#4a4139">'+base+'</div>';
  }
  h += '</div>';

  // Per-file tracks (canvas placeholder + bases)
  items.forEach(function(a, idx) {
    var refMap = buildRefToQuery(a.aligned_ref, a.aligned_query, a.ref_start);
    // Trace canvas
    h += '<div style="border-bottom:1px solid #ece7dd">';
    h += '<canvas id="sg-trace-'+a.id+'" width="'+totalW+'" height="'+TRACE_H+'" style="display:block;width:'+totalW+'px;height:'+TRACE_H+'px"></canvas>';
    // Aligned bases
    h += '<div style="height:'+BASE_H+'px;display:flex">';
    for (var p = spanStart; p < spanEnd; p++) {
      var entry = refMap[p];
      var refBase = SG.refSeq[p] || '';
      if (!entry || entry.qi < 0) {
        // Gap or no coverage
        if (entry && entry.qi === -1) h += '<div class="sg-base sg-base-gap" style="width:'+colW+'px">-</div>';
        else h += '<div class="sg-base" style="width:'+colW+'px;color:#e0dbd3">·</div>';
      } else {
        var qBase = entry.base;
        var match = qBase.toUpperCase() === refBase.toUpperCase();
        if (match) {
          h += '<div class="sg-base sg-base-match" style="width:'+colW+'px">'+qBase+'</div>';
        } else {
          h += '<div class="sg-base sg-base-mm" style="width:'+colW+'px">'+qBase+'</div>';
        }
      }
    }
    h += '</div></div>';
  });

  h += '</div></div>'; // end scrollable
  h += '</div>'; // end flex container

  el.innerHTML = sgStyles() + h;

  // Draw traces after DOM paint
  setTimeout(function() {
    items.forEach(function(a) {
      drawAlignedTrace(a, spanStart, spanEnd, colW, TRACE_H);
    });
  }, 50);
}

/* ── Build ref→query mapping ─────────────────────────────── */
function buildRefToQuery(alignedRef, alignedQuery, refStart) {
  var map = {};
  var refPos = refStart;
  var queryIdx = 0;
  for (var i = 0; i < alignedRef.length; i++) {
    var r = alignedRef[i];
    var q = alignedQuery[i];
    if (r !== '-') {
      if (q !== '-') {
        map[refPos] = { qi: queryIdx, base: q };
      } else {
        map[refPos] = { qi: -1, base: '-' };
      }
      refPos++;
    }
    if (q !== '-') queryIdx++;
  }
  return map;
}

/* ── Draw aligned trace on canvas ────────────────────────── */
function drawAlignedTrace(alignment, spanStart, spanEnd, colW, trackH) {
  var canvas = document.getElementById('sg-trace-'+alignment.id);
  if (!canvas) return;
  var td = SG.traces[alignment.id];
  if (!td || !td.traces || !td.peaks || !td.peaks.length) return;

  var ctx = canvas.getContext('2d');
  var peaks = td.peaks;
  var bases = td.bases || '';
  var refMap = buildRefToQuery(alignment.aligned_ref, alignment.aligned_query, alignment.ref_start);

  // Build column→queryIdx for the visible span
  var colToQi = [];
  for (var p = spanStart; p < spanEnd; p++) {
    var entry = refMap[p];
    colToQi.push(entry ? entry.qi : -2);
  }

  // Find max amplitude for this trace
  var maxAmp = 0;
  ['G','A','T','C'].forEach(function(ch) {
    var d = td.traces[ch];
    for (var i = 0; i < d.length; i++) { if (d[i] > maxAmp) maxAmp = d[i]; }
  });
  if (!maxAmp) return;
  var scaleY = (trackH - 24) / maxAmp;

  // Collect mapped columns with their query indices
  var mapped = [];
  for (var c = 0; c < colToQi.length; c++) {
    if (colToQi[c] >= 0 && colToQi[c] < peaks.length) {
      mapped.push({ col: c, qi: colToQi[c], peak: peaks[colToQi[c]] });
    }
  }
  if (mapped.length < 2) return;

  // Draw each channel
  ['G','A','T','C'].forEach(function(ch) {
    var trace = td.traces[ch];
    ctx.beginPath();
    ctx.strokeStyle = TRACE_COLORS[ch];
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.8;
    var started = false;

    for (var m = 0; m < mapped.length - 1; m++) {
      var m1 = mapped[m], m2 = mapped[m + 1];
      var x1 = (m1.col + 0.5) * colW;
      var x2 = (m2.col + 0.5) * colW;
      var p1 = m1.peak, p2 = m2.peak;
      var nSamp = p2 - p1;
      var nPx = Math.max(1, Math.round(x2 - x1));

      for (var px = 0; px <= nPx; px++) {
        var sf = p1 + (px / nPx) * nSamp;
        var si = Math.floor(sf);
        var frac = sf - si;
        var val = (trace[si] || 0) * (1 - frac) + (trace[si + 1] || 0) * frac;
        var x = x1 + px;
        var y = trackH - 20 - val * scaleY;
        y = Math.max(2, Math.min(trackH - 2, y));
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // Draw base letters at peak positions in trace
  ctx.font = (colW >= 10 ? '10' : '8') + 'px "SF Mono",Monaco,Consolas,monospace';
  ctx.textAlign = 'center';
  mapped.forEach(function(m) {
    var base = bases[m.qi] || '';
    ctx.fillStyle = TRACE_COLORS[base] || '#999';
    ctx.fillText(base, (m.col + 0.5) * colW, trackH - 4);
  });

  // Quality bars at top of trace
  if (td.quals) {
    mapped.forEach(function(m) {
      var q = td.quals[m.qi] || 0;
      var bh = Math.round((q / 50) * 12);
      ctx.fillStyle = qualColor(q);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(m.col * colW + 1, 0, Math.max(1, colW - 2), bh);
    });
    ctx.globalAlpha = 1;
  }
}

/* ── Zoom ────────────────────────────────────────────────── */
function sgZoom(dir) {
  if (dir === 0) SG.zoom = 1;
  else if (dir > 0) SG.zoom = Math.min(4, SG.zoom * 1.3);
  else SG.zoom = Math.max(0.4, SG.zoom / 1.3);
  sgNav('viewer');
}

/* ── Actions ─────────────────────────────────────────────── */
async function sgDel(id) {
  if (!confirm('Delete this alignment?')) return;
  try { await api('DELETE','/api/sanger/alignments/'+id); toast('Deleted'); sgNav('list'); } catch(e) { toast('Failed',true); }
}
async function sgDelBatch(bid) {
  if (!confirm('Delete all alignments in this batch?')) return;
  try { await api('DELETE','/api/sanger/batch/'+bid); toast('Batch deleted'); sgNav('list'); } catch(e) { toast('Failed',true); }
}

/* ── Styles ──────────────────────────────────────────────── */
function sgStyles() {
  return '<style>\
.sg-section-hdr{font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72}\
.sg-btn-pri{background:#5b7a5e;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600}\
.sg-btn-pri:hover{background:#4a6a4d}.sg-btn-pri:disabled{opacity:.5;cursor:default}\
.sg-btn-ghost{background:none;border:1px solid #d5cec0;color:#4a4139;padding:5px 14px;border-radius:6px;font-size:.82rem;cursor:pointer}\
.sg-btn-ghost:hover{border-color:#8a7f72}\
.sg-btn-ghost.sg-btn-sm{padding:3px 10px;font-size:.78rem}\
.sg-btn-x{background:none;border:none;color:#8a7f72;cursor:pointer;font-size:.9rem;padding:4px 6px;border-radius:4px}\
.sg-btn-x:hover{color:#c25a4a}\
.sg-empty{text-align:center;padding:60px 20px;color:#4a4139}\
.sg-table-wrap{overflow-x:auto}\
.sg-table{width:100%;border-collapse:collapse;font-size:.88rem}\
.sg-table th{text-align:left;font-variant:small-caps;font-size:.72rem;letter-spacing:.1em;color:#8a7f72;padding:8px 12px;border-bottom:2px solid #d5cec0}\
.sg-table td{padding:10px 12px;border-bottom:1px solid #ece7dd}\
.sg-row:hover{background:#f5f1ea}\
.sg-mono-tag{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.78rem;background:#f0ebe3;padding:2px 6px;border-radius:3px}\
.sg-batch-count{display:inline-block;background:#5b7a5e;color:#fff;font-size:.7rem;padding:2px 7px;border-radius:3px;font-weight:600}\
.sg-label{display:block;font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin-bottom:4px}\
.sg-input{width:100%;padding:9px 12px;border:1px solid #d5cec0;border-radius:6px;background:#fff;font-size:.9rem;color:#4a4139;box-sizing:border-box}\
.sg-input:focus{outline:none;border-color:#5b7a5e}\
.sg-drop{border:2px dashed #d5cec0;border-radius:8px;padding:28px;text-align:center;color:#8a7f72;cursor:pointer;font-size:.88rem}\
.sg-drop:hover{border-color:#5b7a5e}\
.sg-tabs{display:flex;gap:0;margin-bottom:10px}\
.sg-tab{padding:7px 16px;border:1px solid #d5cec0;background:#f0ebe3;color:#8a7f72;font-size:.82rem;cursor:pointer;border-right:none}\
.sg-tab:first-child{border-radius:6px 0 0 6px}.sg-tab:last-child{border-radius:0 6px 6px 0;border-right:1px solid #d5cec0}\
.sg-tab.active{background:#5b7a5e;color:#fff;border-color:#5b7a5e}\
.sg-label-row{padding:0 10px;box-sizing:border-box;border-bottom:1px solid #ece7dd}\
.sg-base{height:18px;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.7rem;text-align:center;line-height:18px;flex-shrink:0}\
.sg-base-match{color:#8a7f72}\
.sg-base-mm{background:#f5d0ca;color:#c25a4a;font-weight:700}\
.sg-base-gap{background:#f5ecc8;color:#a08930}\
</style>';
}

registerView('sanger', renderSanger);
