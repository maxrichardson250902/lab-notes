// Cloning feature — sequence viewer + OpenCloning bridge + primer design suite

/* ── state ─────────────────────────────────────────────────── */
var _cl = {
  sequences: [],
  selected: null,
  parsed: null,
  loading: false,
  tab: 'viewer',
  seqvizReady: false,
  ocUrl: '',
  viewerInstance: null,
  showCircular: true,
  showLinear: true,
  filter: '',
  ocFilter: '',
  sidebarOpen: true,
  ocSidebarOpen: true,
  featuresOpen: false,
  editFeature: null,   // index into parsed.annotations, or 'new' for adding
  featuresDirty: false, // true when annotations have unsaved edits
  // Sequence search
  search: { open: false, query: '', results: null, activeIdx: 0 },
  lastSelection: { start: 0, end: 0 }, // last SeqViz drag selection
  // Primer design
  pd: {
    expanded: false,
    mode: 'custom',  // 'custom' | 'pcr' | 'seq' | 'kld'
    saving: false,
    // Custom primer
    custom: { start: '', end: '', direction: 'forward', result: null, designing: false },
    // PCR primers
    pcr: { targetStart: '', targetEnd: '', tmTarget: 62, result: null, designing: false },
    // Sequencing primers
    seq: { regionStart: '', regionEnd: '', readLen: 900, tmTarget: 62, result: null, designing: false },
    // KLD
    kld: { 
        startPos: '', 
        endPos: '', 
        insertSeq: '', 
        tmTarget: 62, 
        maxLen: 60,
        optimize: false,
        exhaustive: false,
        result: null, 
        designing: false,
        selectedFwdIdx: 0,
        selectedRevIdx: 0
    },
  },
  // Sequence analysis
  sa: {
    expanded: false,
    mode: 'orfs',  // 'orfs' | 'restriction' | 'tools'
    // ORFs
    orfs: { minLen: 100, result: null, loading: false, showOnMap: true, expandedOrf: null, hiddenOrfs: {} },
    // Restriction enzymes
    re: { enzymes: '', result: null, loading: false, showOnMap: true, filterCuts: 'all' },
    // Seq tools
    tools: { input: '', result: null, lastOp: '' },
    // Digest simulator
    digest: { enzymes: '', result: null, loading: false },
    // BLAST
    blast: { seq: '', program: 'blastn', database: 'nt', maxHits: 10, result: null, loading: false, expandedHit: null },
    // Known features scan
    scan: { result: null, loading: false, showOnMap: true, filterCat: 'all' },
  },
  // Assembly designer
  ad: {
    expanded: false,
    mode: 'gibson',  // 'gibson' | 'goldengate' | 'digestligate'
    gibson: { fragments: [], vector: null, overlapLen: 25, tmTarget: 62, result: null, designing: false },
    goldengate: { enzyme: 'BsaI', bins: [], vector: null, result: null, designing: false },
    digestligate: { enzyme1: '', enzyme2: '', vectorSeq: '', vectorName: '', insertSeq: '', insertName: '', result: null, designing: false },
    _libPicker: null,   // null or { target: 'gibson'|'goldengate'|'dl-vector'|'dl-insert', filter: '' }
    _libLoading: false,
  },
};

/* ── script loader ─────────────────────────────────────────── */
var _altExpanded = {};  // track which primer alt sections are expanded
window._altExpanded = _altExpanded;

var _scriptsLoaded = false;
var _scriptsLoading = false;

function _loadScript(src) {
  return new Promise(function(resolve, reject) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) { resolve(); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = function() { reject(new Error('Failed to load: ' + src)); };
    document.head.appendChild(s);
  });
}

function _loadSeqVizDeps() {
  if (_scriptsLoaded) return Promise.resolve();
  if (_scriptsLoading) {
    return new Promise(function(resolve) {
      var iv = setInterval(function() { if (_scriptsLoaded) { clearInterval(iv); resolve(); } }, 100);
    });
  }
  _scriptsLoading = true;
  return _loadScript('https://unpkg.com/react@18/umd/react.production.min.js')
    .then(function() { return _loadScript('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js'); })
    .then(function() { return _loadScript('https://unpkg.com/seqviz'); })
    .then(function() { _scriptsLoaded = true; _cl.seqvizReady = true; })
    .catch(function(err) {
      console.error('SeqViz loading failed:', err);
      toast('Could not load SeqViz viewer \u2014 check internet connection', true);
    });
}

/* ── data loading ──────────────────────────────────────────── */
function _clLoadSequences() {
  return api('GET', '/api/cloning/sequences').then(function(d) { _cl.sequences = d.items || []; });
}

function _clLoadConfig() {
  return api('GET', '/api/cloning/config').then(function(d) { _cl.ocUrl = d.opencloning_url || ''; });
}

function _clSelectSequence(type, id) {
  _cl.selected = { type: type, id: id };
  _cl.parsed = null;
  _cl.loading = true;
  // Reset all primer results and product preview
  _cl.pd.custom.result = null;
  _cl.pd.pcr.result = null;
  _cl.pd.seq.result = null;
  _cl.pd.kld.result = null;
  _cl.pd.kld.selectedFwdIdx = 0;
  _cl.pd.kld.selectedRevIdx = 0;
  _cl.pd._viewingProduct = false;
  _cl.pd._productPreview = null;
  _cl.pd._productBaseBody = null;
  _cl.featuresDirty = false;
  _cl.editFeature = null;
  _cl.sa.orfs.result = null;
  _cl.sa.re.result = null;
  _cl.sa.tools.result = null;
  _cl.sa.digest.result = null;
  _cl.sa.blast.result = null;
  _cl.sa.blast.seq = '';
  _cl.sa.scan.result = null;
  _cl.search.query = '';
  _cl.ad.gibson.result = null;
  _cl.ad.goldengate.result = null;
  _cl.ad.digestligate.result = null;
  _cl.ad._libPicker = null;
  _cl.search.results = null;
  _cl.search.activeIdx = 0;
  _cl.search.open = false;
  _clRender();

  api('GET', '/api/cloning/sequences/' + type + '/' + id + '/parse')
    .then(function(data) {
      _cl.parsed = data;
      _cl.loading = false;
      _clRender();
      setTimeout(function() { _clRenderSeqViz(); }, 50);
    })
    .catch(function(err) {
      _cl.loading = false;
      toast('Failed to parse GenBank file: ' + (err.message || err), true);
      _clRender();
    });
}

/* ── SeqViz renderer ───────────────────────────────────────── */
function _clRenderSeqViz() {
  if (!_cl.parsed || !_cl.seqvizReady) return;
  if (typeof window.seqviz === 'undefined') return;

  var el = document.getElementById('cl-seqviz-mount');
  if (!el) return;
  el.innerHTML = '';

  var annotations = (_cl.parsed.annotations || []).map(function(a) {
    return { name: a.name, start: a.start, end: a.end, direction: a.direction || 1, color: a.color || '#95A5A6' };
  });

  var seqLen = (_cl.parsed.seq || '').length;
  var pd = _cl.pd;

  // Add markers based on current primer design mode
  if (pd.mode === 'kld') {
    var kldStart = parseInt(pd.kld.startPos, 10);
    var kldEnd = parseInt(pd.kld.endPos, 10);
    if (isNaN(kldEnd)) kldEnd = kldStart;
    if (!isNaN(kldStart) && kldStart >= 0 && kldStart <= seqLen) {
      if (kldEnd > kldStart) {
        // Range deletion/replacement — highlight the region being removed
        annotations.push({ name: '\u2702 Delete region', start: kldStart, end: Math.min(kldEnd, seqLen), direction: 1, color: '#e74c3c' });
      } else {
        // Pure insertion point
        annotations.push({ name: '\u2702 Insert here', start: Math.max(0, kldStart - 1), end: Math.min(seqLen, kldStart + 1), direction: 1, color: '#e74c3c' });
      }
    }
    if (pd.kld.result) {
      var r = pd.kld.result;
      var rStart = parseInt(r.start_used, 10);
      var rEnd = parseInt(r.end_used, 10);
      // Use selected primer annealing length for map markers
      var selF = _pdKldGetSelected('fwd');
      var selR = _pdKldGetSelected('rev');
      var fwdAnnLen = selF ? selF.annealing.length : r.forward.annealing.length;
      var revAnnLen = selR ? selR.annealing.length : r.reverse.annealing.length;
      if (!isNaN(rEnd)) {
        var fAnnEnd = (rEnd + fwdAnnLen) % seqLen;
        annotations.push({ name: 'Fwd anneal', start: rEnd, end: fAnnEnd > rEnd ? fAnnEnd : fAnnEnd || seqLen, direction: 1, color: '#2980b9' });
      }
      if (!isNaN(rStart)) {
        var rAnnStart = ((rStart - revAnnLen) % seqLen + seqLen) % seqLen;
        annotations.push({ name: 'Rev anneal', start: rAnnStart, end: rStart, direction: -1, color: '#8e44ad' });
      }
    }
  } else if (pd.mode === 'custom' && pd.custom.result) {
    var cr = pd.custom.result;
    annotations.push({ name: 'Primer', start: cr.start, end: cr.end, direction: cr.direction === 'forward' ? 1 : -1, color: '#2980b9' });
  } else if (pd.mode === 'pcr' && pd.pcr.result) {
    var pr = pd.pcr.result;
    annotations.push({ name: 'Fwd primer', start: pr.forward.position, end: pr.forward.position + pr.forward.length, direction: 1, color: '#2980b9' });
    var revEnd = pr.reverse.position;
    var revStart = revEnd - pr.reverse.length;
    if (revStart < 0) revStart += seqLen;
    annotations.push({ name: 'Rev primer', start: revStart, end: revEnd, direction: -1, color: '#8e44ad' });
    annotations.push({ name: 'Amplicon', start: pr.forward.position, end: pr.reverse.position, direction: 1, color: 'rgba(46,204,113,0.25)' });
  } else if (pd.mode === 'seq' && pd.seq.result) {
    pd.seq.result.primers.forEach(function(p, i) {
      annotations.push({ name: 'Seq#' + (i + 1), start: p.position, end: Math.min(p.position + p.length, seqLen), direction: 1, color: '#e67e22' });
    });
  } else {
    // Native SeqViz drag highlight shows the selection — no need for annotation workaround
  }

  // ── ORF annotations
  var sa = _cl.sa;
  if (sa.orfs.showOnMap && sa.orfs.result && sa.orfs.result.orfs) {
    var orfColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
    sa.orfs.result.orfs.forEach(function(o, idx) {
      if (sa.orfs.hiddenOrfs[idx]) return; // skip hidden ORFs
      annotations.push({
        name: 'ORF ' + o.length_aa + 'aa (' + (o.direction === 1 ? '+' : '-') + o.frame + ')',
        start: o.start,
        end: o.end,
        direction: o.direction,
        color: orfColors[idx % orfColors.length],
      });
    });
  }

  // ── RE site annotations
  if (sa.re.showOnMap && sa.re.result && sa.re.result.enzymes) {
    sa.re.result.enzymes.forEach(function(enz) {
      enz.cut_positions.forEach(function(pos) {
        annotations.push({
          name: enz.name,
          start: Math.max(0, pos - 2),
          end: Math.min(seqLen, pos + 2),
          direction: 1,
          color: enz.num_cuts === 1 ? '#e74c3c' : '#f39c12',
        });
      });
    });
  }

  // ── Known features scan annotations
  if (sa.scan.showOnMap && sa.scan.result && sa.scan.result.features) {
    sa.scan.result.features.forEach(function(f) {
      annotations.push({
        name: f.name,
        start: f.start,
        end: f.end,
        direction: f.direction,
        color: f.color,
      });
    });
  }

  // ── Search result annotations
  if (_cl.search.results && _cl.search.results.length > 0) {
    _cl.search.results.forEach(function(hit, idx) {
      var isActive = idx === _cl.search.activeIdx;
      annotations.push({
        name: (hit.strand === 'fwd' ? '\u2192' : '\u2190') + ' Match ' + (idx + 1),
        start: hit.start,
        end: hit.end,
        direction: hit.strand === 'fwd' ? 1 : -1,
        color: isActive ? '#e74c3c' : '#f39c12',
      });
    });
  }

  try {
    var viewerProps = {
      name: _cl.parsed.name || 'Sequence',
      seq: _cl.parsed.seq,
      annotations: annotations,
      style: { height: '100%', width: '100%' },
      viewer: (_cl.showCircular && _cl.showLinear) ? 'both' :
              _cl.showCircular ? 'circular' : 'linear',
      showComplement: true,
      showIndex: true,
      zoom: { linear: 50 },
      onSelection: _clOnSeqVizSelection,
    };

    if (window.seqviz.Viewer && typeof window.seqviz.Viewer === 'function') {
      try { window.seqviz.Viewer(el, viewerProps).render(); return; } catch (e) { /* fall through */ }
    }
    if (window.React && window.ReactDOM) {
      var SeqVizComp = window.seqviz.SeqViz || window.seqviz.default || window.seqviz;
      if (SeqVizComp) {
        if (window.ReactDOM.createRoot) {
          window.ReactDOM.createRoot(el).render(window.React.createElement(SeqVizComp, viewerProps));
        } else {
          window.ReactDOM.render(window.React.createElement(SeqVizComp, viewerProps), el);
        }
      }
    }
  } catch (err) {
    console.error('SeqViz render error:', err);
    el.innerHTML = '<div style="padding:2rem;color:#8a7f72;">Viewer failed to render. Try refreshing.</div>';
  }
}

/* ── SeqViz selection → auto-fill primer design fields ──── */
function _clOnSeqVizSelection(sel) {
  var start, end;
  if (sel && typeof sel.start === 'number') {
    start = sel.start;
    end = sel.end;
  } else if (sel && sel.selection && typeof sel.selection.start === 'number') {
    start = sel.selection.start;
    end = sel.selection.end;
  } else {
    return;
  }

  if (start === end && start === 0) return;

  var isCircular = _cl.parsed && (_cl.parsed.topology || '').toLowerCase() === 'circular';
  var crossesOrigin = false;

  // For linear sequences or when SeqViz gives us inverted coords, swap
  if (start > end) {
    if (isCircular) {
      // Cross-origin selection on circular — keep as-is
      crossesOrigin = true;
    } else {
      var tmp = start; start = end; end = tmp;
    }
  }

  var selLen = _clSelLen(start, end);
  var isSingleClick = (start === end) || selLen <= 1;
  var selSeq = (_cl.parsed && !isSingleClick) ? _clGetSelSeq(start, end) : '';
  var filled = false;

  // Store last selection for feature editor auto-fill
  if (!isSingleClick) {
    _cl.lastSelection = { start: start, end: end, crossesOrigin: crossesOrigin };
    // Live-update feature editor panel if open
    if (_cl.editFeature !== null) {
      _clSetInputVal('cl-feat-start', start);
      _clSetInputVal('cl-feat-end', end);
    }
  }

  // Format selection text for toasts
  var selText = crossesOrigin
    ? start + '\u2192origin\u2192' + end + ' (' + selLen + ' bp, wraps origin)'
    : start + '\u2013' + end + ' (' + selLen + ' bp)';

  // ── Route to primer design panel if expanded
  if (_cl.pd.expanded) {
    var mode = _cl.pd.mode;
    if (mode === 'kld') {
      if (isSingleClick) {
        // Single click: set both start and end to same position (pure insertion)
        _cl.pd.kld.startPos = String(start);
        _cl.pd.kld.endPos = String(start);
        _clSetInputVal('cl-pd-kld-startPos', start);
        _clSetInputVal('cl-pd-kld-endPos', start);
        toast('Insertion point set to ' + start, false);
      } else {
        // Drag selection: set start/end range (deletion/replacement)
        _cl.pd.kld.startPos = String(start);
        _cl.pd.kld.endPos = String(end);
        _clSetInputVal('cl-pd-kld-startPos', start);
        _clSetInputVal('cl-pd-kld-endPos', end);
        toast('KLD range: ' + selText, false);
      }
      filled = true;
    } else if (mode === 'custom' && !isSingleClick) {
      _cl.pd.custom.start = String(start);
      _cl.pd.custom.end = String(end);
      _clSetInputVal('cl-pd-custom-start', start);
      _clSetInputVal('cl-pd-custom-end', end);
      toast('Primer region: ' + selText, false);
      filled = true;
    } else if (mode === 'pcr' && !isSingleClick) {
      _cl.pd.pcr.targetStart = String(start);
      _cl.pd.pcr.targetEnd = String(end);
      _clSetInputVal('cl-pd-pcr-targetStart', start);
      _clSetInputVal('cl-pd-pcr-targetEnd', end);
      toast('PCR target: ' + selText, false);
      filled = true;
    } else if (mode === 'seq' && !isSingleClick) {
      _cl.pd.seq.regionStart = String(start);
      _cl.pd.seq.regionEnd = String(end);
      _clSetInputVal('cl-pd-seq-regionStart', start);
      _clSetInputVal('cl-pd-seq-regionEnd', end);
      toast('Sequencing region: ' + selText, false);
      filled = true;
    }
  }

  // ── Route to analysis panel if expanded
  if (_cl.sa.expanded && _cl.parsed && !isSingleClick) {
    if (_cl.sa.mode === 'tools') {
      _cl.sa.tools.input = selSeq;
      _clSetInputVal('cl-sa-tools-input', selSeq);
      if (!filled) toast('Selection: ' + selLen + ' bp \u2192 Sequence Tools', false);
      filled = true;
    } else if (_cl.sa.mode === 'blast') {
      _cl.sa.blast.seq = selSeq;
      _clSetInputVal('cl-sa-blast-input', selSeq);
      if (!filled) toast('Selection: ' + selLen + ' bp \u2192 BLAST', false);
      filled = true;
    } else if (_cl.sa.mode === 'restriction') {
      if (!filled) toast('Selected ' + selText, false);
    } else if (_cl.sa.mode === 'orfs') {
      if (!filled) toast('Selected ' + selText, false);
    }
  }

  // ── Route to assembly panel if expanded
  if (_cl.ad.expanded && _cl.parsed && !isSingleClick && !filled) {
    toast('Selected ' + selText + ' \u2014 click \u201c+ From loaded\u201d to add as fragment', false);
    filled = true;
  }

  // ── Fallback: if neither panel is expanded, just show a toast with the selection
  if (!filled && !isSingleClick) {
    toast('Selected ' + selText + ' \u2014 open a panel to use it', false);
  }
  // Note: we intentionally do NOT re-render SeqViz here — that would destroy
  // the native drag highlight. Fields are updated via direct DOM manipulation.
}

// Directly set an input's value in the DOM without full re-render
function _clSetInputVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val;
}

/* ── helpers ────────────────────────────────────────────────── */
function _clGcPct(seq) {
  if (!seq) return 0;
  var s = seq.toUpperCase().replace(/[^ATGC]/g, '');
  if (!s.length) return 0;
  var gc = 0;
  for (var i = 0; i < s.length; i++) { if (s[i] === 'G' || s[i] === 'C') gc++; }
  return Math.round(gc / s.length * 100);
}
function _clCleanSeq(seq) { return (seq || '').toUpperCase().replace(/[^ATGCN]/g, ''); }

/** Get selected sequence, handling cross-origin wrapping for circular. */
function _clGetSelSeq(start, end) {
  if (!_cl.parsed || !_cl.parsed.seq) return '';
  var seq = _cl.parsed.seq;
  if (start <= end) {
    return seq.substring(start, end);
  }
  // Cross-origin: start > end → from start to end-of-seq + from 0 to end
  return seq.substring(start) + seq.substring(0, end);
}

/** Length of selection, handling cross-origin. */
function _clSelLen(start, end) {
  if (!_cl.parsed) return Math.abs(end - start);
  if (start <= end) return end - start;
  return (_cl.parsed.seq.length - start) + end;
}

/* ── main render ───────────────────────────────────────────── */
var _clEl = null;
function _clRender() {
  if (!_clEl) return;
  window._featStash = []; // Reset feature stash each render
  var h = '';

  // Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;flex-wrap:wrap;gap:.6rem;">';
  h += '<div>';
  h += '<h2 style="margin:0;font-size:1.25rem;color:#4a4139;">Cloning Workbench</h2>';
  h += '<p style="margin:.2rem 0 0;font-size:.82rem;color:#8a7f72;">Browse sequences, view maps, design primers</p>';
  h += '</div>';
  h += '<div style="display:flex;gap:.5rem;align-items:center;">';
  h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;">';
  h += '<button onclick="_clSetTab(\x27viewer\x27)" style="padding:.35rem .8rem;font-size:.78rem;border:none;cursor:pointer;' +
       (_cl.tab === 'viewer' ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">Sequence Viewer</button>';
  h += '<button onclick="_clSetTab(\x27opencloning\x27)" style="padding:.35rem .8rem;font-size:.78rem;border:none;cursor:pointer;' +
       (_cl.tab === 'opencloning' ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">OpenCloning</button>';
  h += '</div></div></div>';

  if (_cl.tab === 'viewer') { h += _clRenderViewerTab(); }
  else { h += _clRenderOCTab(); }

  _clEl.innerHTML = h;
  if (_cl.tab === 'viewer' && _cl.parsed) { setTimeout(function() { _clRenderSeqViz(); }, 30); }
}

/* ── Viewer tab ────────────────────────────────────────────── */
function _clRenderViewerTab() {
  var sb = _cl.sidebarOpen;
  var h = '<div style="display:grid;grid-template-columns:' + (sb ? '280px ' : '') + '1fr;gap:1rem;min-height:750px;">';

  // Left panel (collapsible)
  if (sb) {
    h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;overflow:hidden;display:flex;flex-direction:column;">';
    // Header with collapse button
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem .6rem;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
    h += '<span style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Sequences</span>';
    h += '<button onclick="_clToggleSidebar()" style="padding:.15rem .35rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#8a7f72;cursor:pointer;" title="Hide sidebar">\u00ab</button>';
    h += '</div>';
    h += '<div style="padding:.4rem .6rem;border-bottom:1px solid #e8e2d8;">';
    h += '<input type="text" placeholder="Filter\u2026" value="' + esc(_cl.filter) + '" oninput="_clFilterChange(this.value)" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;" />';
    h += '</div>';

    var plasmids = _cl.sequences.filter(function(s) { return s.type === 'plasmid' && s.has_file; });
    var kitparts = _cl.sequences.filter(function(s) { return s.type === 'kitpart' && s.has_file; });
    var primers = _cl.sequences.filter(function(s) { return s.type === 'primer' && s.has_file; });
    if (_cl.filter) {
      var f = _cl.filter.toLowerCase();
      plasmids = plasmids.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1; });
      kitparts = kitparts.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.kit_name && s.kit_name.toLowerCase().indexOf(f) !== -1); });
      primers = primers.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1; });
    }

    h += '<div style="flex:1;overflow-y:auto;padding:.4rem 0;">';
    if (plasmids.length > 0) {
      h += '<div style="padding:.3rem .7rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;">Plasmids</div>';
      plasmids.forEach(function(s) {
        var isA = _cl.selected && _cl.selected.type === s.type && _cl.selected.id === s.id;
        h += '<div onclick="_clSelectSequence(\x27' + s.type + '\x27,' + s.id + ')" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid #f0ebe3;' +
             (isA ? 'background:#eef4ee;border-left:3px solid #5b7a5e;' : 'border-left:3px solid transparent;') + 'transition:background .15s;" ' +
             'onmouseover="this.style.background=\x27' + (isA ? '#eef4ee' : '#f5f1eb') + '\x27" onmouseout="this.style.background=\x27' + (isA ? '#eef4ee' : 'transparent') + '\x27">';
        h += '<div style="font-size:.85rem;font-weight:500;color:#4a4139;">' + esc(s.name) + '</div>';
        if (s.use) h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.use) + '</div>';
        h += '</div>';
      });
    }
    if (kitparts.length > 0) {
      h += '<div style="padding:.3rem .7rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8E44AD;font-weight:600;border-bottom:1px solid #e8e2d8;margin-top:.2rem;">\ud83e\uddf0 Kit Parts</div>';
      kitparts.forEach(function(s) {
        var isA = _cl.selected && _cl.selected.type === s.type && _cl.selected.id === s.id;
        h += '<div onclick="_clSelectSequence(\x27' + s.type + '\x27,' + s.id + ')" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid #f0ebe3;' +
             (isA ? 'background:#eef4ee;border-left:3px solid #5b7a5e;' : 'border-left:3px solid transparent;') + 'transition:background .15s;" ' +
             'onmouseover="this.style.background=\x27' + (isA ? '#eef4ee' : '#f5f1eb') + '\x27" onmouseout="this.style.background=\x27' + (isA ? '#eef4ee' : 'transparent') + '\x27">';
        h += '<div style="font-size:.85rem;font-weight:500;color:#4a4139;">' + esc(s.name) + '</div>';
        var meta = [];
        if (s.kit_name) meta.push(s.kit_name);
        if (s.part_type) meta.push(s.part_type);
        if (meta.length > 0) h += '<div style="font-size:.72rem;color:#8E44AD;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(meta.join(' \u00b7 ')) + '</div>';
        h += '</div>';
      });
    }
    if (primers.length > 0) {
      h += '<div style="padding:.3rem .7rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;margin-top:.2rem;">Primers</div>';
      primers.forEach(function(s) {
        var isA = _cl.selected && _cl.selected.type === s.type && _cl.selected.id === s.id;
        h += '<div onclick="_clSelectSequence(\x27' + s.type + '\x27,' + s.id + ')" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid #f0ebe3;' +
             (isA ? 'background:#eef4ee;border-left:3px solid #5b7a5e;' : 'border-left:3px solid transparent;') + 'transition:background .15s;" ' +
             'onmouseover="this.style.background=\x27' + (isA ? '#eef4ee' : '#f5f1eb') + '\x27" onmouseout="this.style.background=\x27' + (isA ? '#eef4ee' : 'transparent') + '\x27">';
        h += '<div style="font-size:.85rem;font-weight:500;color:#4a4139;">' + esc(s.name) + '</div>';
        if (s.sequence) h += '<div style="font-size:.7rem;color:#8a7f72;margin-top:.15rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">' + esc(s.sequence.substring(0, 40)) + (s.sequence.length > 40 ? '\u2026' : '') + '</div>';
        h += '</div>';
      });
    }
    if (plasmids.length === 0 && kitparts.length === 0 && primers.length === 0) {
      h += '<div style="padding:1.5rem;text-align:center;color:#8a7f72;font-size:.82rem;">';
      h += _cl.filter ? 'No sequences match your filter.' : 'No sequences with GenBank files found.<br><br><span style="font-size:.75rem;">Import with .gb files in DNA Manager first.</span>';
      h += '</div>';
    }
    h += '</div></div>';
  }

  // Right column
  h += '<div style="display:flex;flex-direction:column;gap:1rem;">';

  // Viewer card
  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;display:flex;flex-direction:column;overflow:hidden;">';
  if (_cl.loading) {
    h += '<div style="min-height:500px;display:flex;align-items:center;justify-content:center;color:#8a7f72;">';
    h += '<div style="text-align:center;"><div style="font-size:1.6rem;margin-bottom:.5rem;">\u23f3</div><div style="font-size:.85rem;">Parsing GenBank file\u2026</div></div></div>';
  } else if (_cl.parsed) {
    // Toolbar
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.55rem .8rem;border-bottom:1px solid #e8e2d8;flex-wrap:wrap;gap:.4rem;">';
    h += '<div style="display:flex;align-items:center;gap:.4rem;">';
    
    if (!sb) {
      h += '<button onclick="_clToggleSidebar()" style="padding:.2rem .4rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#faf8f4;color:#8a7f72;cursor:pointer;" title="Show sequence list">\u00bb</button>';
    }
    
    h += '<span style="font-weight:600;color:#4a4139;font-size:.9rem;">' + esc(_cl.parsed.name) + '</span>';
    h += '<span style="font-size:.75rem;color:#8a7f72;">' + _cl.parsed.length.toLocaleString() + ' bp</span>';
    h += '<span style="font-size:.72rem;color:#8a7f72;padding:.15rem .4rem;background:#f0ebe3;border-radius:3px;">' + esc(_cl.parsed.topology) + '</span>';
    h += '</div>';

    h += '<div style="display:flex;gap:.3rem;align-items:center;">';
    
    // View Toggles
    h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;margin-right:.4rem;">';
    h += '<button onclick="_clToggleView(\x27circular\x27)" style="padding:.25rem .5rem;font-size:.72rem;border:none;cursor:pointer;' +
          (_cl.showCircular ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#8a7f72;text-decoration:line-through;') + '">\u2b55 Circular</button>';
    h += '<button onclick="_clToggleView(\x27linear\x27)" style="padding:.25rem .5rem;font-size:.72rem;border:none;cursor:pointer;' +
          (_cl.showLinear ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#8a7f72;text-decoration:line-through;') + '">\u2501 Linear</button>';
    h += '</div>';

    // Action Buttons
    if (!_cl.pd._viewingProduct) {
      // .gb Download
      h += '<a href="/api/' + esc(_cl.selected.type) + 's/' + _cl.selected.id + '/gb" download style="padding:.25rem .5rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;text-decoration:none;">\u2b07 .gb</a>';

      // Reindex (Show for Circular or Unknown, Grayed out for Linear)
      var isCirc = (_cl.parsed.topology || '').toLowerCase().includes('circular');
      var isLin = (_cl.parsed.topology || '').toLowerCase().includes('linear');
      
      if (isCirc || !isLin) {
          h += '<button onclick="_clReindex()" style="padding:.25rem .5rem;font-size:.72rem;color:#e67e22;border:1px solid #e67e22;border-radius:4px;background:#fff;cursor:pointer;margin:0 .2rem;" title="Set new origin">🔄 Reindex</button>';
      }

      // Send to OC
      h += '<button onclick="_clSendToOC()" style="padding:.25rem .5rem;font-size:.72rem;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;">\ud83d\udce4 Send to OC</button>';
    }

    // Search Toggle
    h += '<button onclick="_clSearchToggle()" style="padding:.25rem .5rem;font-size:.72rem;border:1px solid ' + (_cl.search.open ? '#5b7a5e' : '#d5cec0') + ';border-radius:4px;background:' + (_cl.search.open ? '#5b7a5e' : '#faf8f4') + ';color:' + (_cl.search.open ? '#fff' : '#8a7f72') + ';cursor:pointer;">\ud83d\udd0d</button>';
    h += '</div></div>';
    // ── Sequence search bar
    if (_cl.search.open) {
      h += '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .8rem;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
      h += '<span style="font-size:.75rem;color:#8a7f72;">\ud83d\udd0d</span>';
      h += '<input id="cl-search-input" type="text" value="' + esc(_cl.search.query) + '" oninput="_clSearchRun(this.value)" onkeydown="if(event.key===\x27Enter\x27)_clSearchNext();if(event.key===\x27Escape\x27)_clSearchToggle();" placeholder="Search sequence (forward + reverse complement)\u2026" autofocus style="flex:1;padding:.3rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.8rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" />';
      if (_cl.search.results && _cl.search.results.length > 0) {
        h += '<span style="font-size:.72rem;color:#4a4139;font-weight:500;white-space:nowrap;">' + (_cl.search.activeIdx + 1) + '/' + _cl.search.results.length + '</span>';
        h += '<button onclick="_clSearchPrev()" style="padding:.15rem .4rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#4a4139;cursor:pointer;">\u25b2</button>';
        h += '<button onclick="_clSearchNext()" style="padding:.15rem .4rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#4a4139;cursor:pointer;">\u25bc</button>';
      } else if (_cl.search.query.length >= 3 && _cl.search.results) {
        h += '<span style="font-size:.72rem;color:#c0392b;">No matches</span>';
      }
      if (_cl.search.results && _cl.search.results.length > 0) {
        var hit = _cl.search.results[_cl.search.activeIdx];
        h += '<span style="font-size:.7rem;color:' + (hit.strand === 'fwd' ? '#2980b9' : '#8e44ad') + ';font-weight:500;white-space:nowrap;">' + (hit.strand === 'fwd' ? '\u2192 Forward' : '\u2190 Rev Comp') + ' at ' + hit.start + '</span>';
      }
      h += '<button onclick="_clSearchToggle()" style="padding:.15rem .35rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#8a7f72;cursor:pointer;">\u2715</button>';
      h += '</div>';
    }
    

    // ── Product preview banner
    if (_cl.pd._viewingProduct) {
      h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .8rem;background:linear-gradient(90deg,#eef4ee,#e8f0f8);border-bottom:1px solid #b8d4b8;flex-wrap:wrap;gap:.4rem;">';
      h += '<div style="display:flex;align-items:center;gap:.5rem;">';
      h += '<span style="font-size:.9rem;">\ud83e\uddea</span>';
      h += '<span style="font-size:.8rem;font-weight:600;color:#4a4139;">Product Preview</span>';
      h += '<span style="font-size:.72rem;color:#5b7a5e;">Expected result with remapped features. Review before saving.</span>';
      h += '</div>';
      h += '<div style="display:flex;gap:.4rem;">';
      h += '<button onclick="_pdExitProductPreview()" style="padding:.3rem .7rem;font-size:.75rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:4px;background:#fff;cursor:pointer;">\u2190 Back to Template</button>';
      h += '<button onclick="_pdSaveProduct()" style="padding:.3rem .7rem;font-size:.75rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;">\ud83d\udcbe Save as Plasmid</button>';
      h += '</div>';
      h += '</div>';
    }
    // ── Features / Annotations editor (collapsible)
    var anns = _cl.parsed.annotations || [];
    h += '<div style="border-bottom:1px solid #e8e2d8;">';
    h += '<div onclick="_clToggleFeatures()" style="display:flex;align-items:center;justify-content:space-between;padding:.35rem .8rem;cursor:pointer;background:#faf8f4;user-select:none;" onmouseover="this.style.background=\x27#f0ebe3\x27" onmouseout="this.style.background=\x27#faf8f4\x27">';
    h += '<div style="display:flex;align-items:center;gap:.5rem;">';
    h += '<span style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Features (' + anns.length + ')</span>';
    if (_cl.featuresDirty) {
      h += '<span style="font-size:.62rem;color:#c0392b;font-weight:600;">\u2022 unsaved</span>';
    }
    h += '</div>';
    h += '<span style="font-size:.7rem;color:#8a7f72;transition:transform .2s;display:inline-block;transform:rotate(' + (_cl.featuresOpen ? '180' : '0') + 'deg);">\u25bc</span>';
    h += '</div>';
    if (_cl.featuresOpen) {
      h += '<div style="max-height:280px;overflow-y:auto;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:.76rem;"><thead><tr style="background:#faf8f4;">';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;width:22px;"></th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Name</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Type</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Location</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Dir</th>';
      h += '<th style="text-align:center;padding:.25rem .3rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;width:50px;"></th>';
      h += '</tr></thead><tbody>';
      anns.forEach(function(a, i) {
        h += '<tr style="border-bottom:1px solid #f0ebe3;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27transparent\x27">';
        h += '<td style="padding:.2rem .3rem;text-align:center;"><input type="color" value="' + esc(a.color || '#95A5A6') + '" onchange="_clFeatColor(' + i + ',this.value)" style="width:18px;height:18px;border:1px solid #d5cec0;border-radius:3px;padding:0;cursor:pointer;background:none;" title="Change color" /></td>';
        h += '<td style="padding:.2rem .5rem;color:#4a4139;">' + esc(a.name) + '</td>';
        h += '<td style="padding:.2rem .5rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;">' + esc(a.type) + '</td>';
        h += '<td style="padding:.2rem .5rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;">' + a.start + '..' + a.end + '</td>';
        h += '<td style="padding:.2rem .5rem;color:#8a7f72;cursor:pointer;" onclick="_clFeatDir(' + i + ')" title="Toggle direction">' + (a.direction === 1 ? '\u2192' : '\u2190') + '</td>';
        h += '<td style="padding:.2rem .3rem;text-align:center;">';
        h += '<button onclick="_clFeatEdit(' + i + ')" style="padding:0 .3rem;font-size:.68rem;color:#4a4139;border:none;background:none;cursor:pointer;" title="Edit">\u270f\ufe0f</button>';
        h += '<button onclick="_clFeatRemove(' + i + ')" style="padding:0 .3rem;font-size:.68rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Remove">\u2715</button>';
        h += '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
      // Action bar
      h += '<div style="display:flex;gap:.4rem;padding:.4rem .6rem;background:#faf8f4;border-top:1px solid #e8e2d8;">';
      h += '<button onclick="_clFeatAdd()" style="padding:.25rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:#fff;cursor:pointer;">+ Add Feature</button>';
      if (_cl.featuresDirty && !_cl.pd._viewingProduct) {
        h += '<button onclick="_clFeatSave()" style="padding:.25rem .6rem;font-size:.72rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;">\ud83d\udcbe Save to .gb</button>';
        h += '<button onclick="_clFeatRevert()" style="padding:.25rem .5rem;font-size:.72rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:4px;background:#fff;cursor:pointer;">Revert</button>';
      }
      h += '</div>';
    }
    h += '</div>';

    // SeqViz mount
    h += '<div id="cl-seqviz-mount" style="flex:1;min-height:500px;background:#fff;"></div>';
  } else {
    // Show sidebar button in empty state too
    h += '<div style="min-height:500px;display:flex;align-items:center;justify-content:center;color:#8a7f72;position:relative;">';
    if (!sb) {
      h += '<button onclick="_clToggleSidebar()" style="position:absolute;top:.6rem;left:.6rem;padding:.2rem .4rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#faf8f4;color:#8a7f72;cursor:pointer;" title="Show sequence list">\u00bb</button>';
    }
    h += '<div style="text-align:center;max-width:280px;">';
    h += '<div style="font-size:2.5rem;margin-bottom:.7rem;opacity:.5;">\ud83e\uddec</div>';
    h += '<div style="font-size:.95rem;font-weight:500;color:#4a4139;margin-bottom:.3rem;">Select a sequence</div>';
    h += '<div style="font-size:.8rem;">Choose a plasmid or primer from the ' + (sb ? 'left panel' : 'sidebar (\u00bb)') + ' to view its sequence map and features.</div>';
    h += '</div></div>';
  }
  h += '</div>'; // viewer card

  // Primer design panel (hidden during product preview)
  if (_cl.parsed && !_cl.pd._viewingProduct) { h += _clRenderPDPanel(); }

  // Sequence analysis panel (hidden during product preview)
  if (_cl.parsed && !_cl.pd._viewingProduct) { h += _clRenderSAPanel(); }

  // Assembly designer panel (hidden during product preview)
  if (_cl.parsed && !_cl.pd._viewingProduct) { h += _clRenderAssemblyPanel(); }

  h += '</div>'; // right column
  h += '</div>'; // grid

  // ── Floating feature editor panel (outside grid, always on top)
  if (_cl.editFeature !== null) {
    h += _clRenderFeaturePanel();
  }

  return h;
}

/* ═══════════════════════════════════════════════════════════
   PRIMER DESIGN PANEL
   ═══════════════════════════════════════════════════════════ */
function _clRenderPDPanel() {
  var pd = _cl.pd;
  var h = '';

  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;overflow:hidden;">';

  // Collapsible header
  h += '<div onclick="_pdToggle()" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .9rem;cursor:pointer;background:#faf8f4;border-bottom:' + (pd.expanded ? '1px solid #e8e2d8' : 'none') + ';user-select:none;" ' +
       'onmouseover="this.style.background=\x27#f0ebe3\x27" onmouseout="this.style.background=\x27#faf8f4\x27">';
  h += '<div style="display:flex;align-items:center;gap:.5rem;">';
  h += '<span style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#5b7a5e;">Primer Design</span>';
  h += '</div>';
  h += '<span style="font-size:.8rem;color:#8a7f72;transition:transform .2s;display:inline-block;transform:rotate(' + (pd.expanded ? '180' : '0') + 'deg);">\u25bc</span>';
  h += '</div>';

  if (!pd.expanded) { h += '</div>'; return h; }

  // Mode tabs
  h += '<div style="display:flex;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
  var modes = [
    { key: 'custom', label: 'Custom', icon: '\u270f\ufe0f' },
    { key: 'pcr', label: 'PCR', icon: '\ud83d\udd2c' },
    { key: 'seq', label: 'Sequencing', icon: '\ud83d\udcca' },
    { key: 'kld', label: 'KLD Insertion', icon: '\u2702\ufe0f' },
  ];
  modes.forEach(function(m) {
    var active = pd.mode === m.key;
    h += '<button onclick="_pdSetMode(\x27' + m.key + '\x27)" style="flex:1;padding:.5rem .3rem;font-size:.75rem;font-weight:' + (active ? '600' : '400') + ';border:none;border-bottom:2px solid ' + (active ? '#5b7a5e' : 'transparent') + ';cursor:pointer;background:' + (active ? '#fff' : 'transparent') + ';color:' + (active ? '#4a4139' : '#8a7f72') + ';transition:all .15s;">' + m.icon + ' ' + m.label + '</button>';
  });
  h += '</div>';

  // Mode body
  h += '<div style="padding:.9rem;">';
  if (pd.mode === 'custom') { h += _clRenderCustomMode(); }
  else if (pd.mode === 'pcr') { h += _clRenderPCRMode(); }
  else if (pd.mode === 'seq') { h += _clRenderSeqMode(); }
  else if (pd.mode === 'kld') { h += _clRenderKLDMode(); }
  h += '</div>';

  h += '</div>';
  return h;
}

/* ── CUSTOM PRIMER MODE ────────────────────────────────────── */
function _clRenderCustomMode() {
  var c = _cl.pd.custom;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Select a region on the template to create a primer. <strong style="color:#5b7a5e;">Click or drag on the map above</strong> to set positions. Quality checks flag issues with Tm, GC, self-dimers, and more.</p>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.6rem;margin-bottom:.7rem;align-items:end;">';
  // Start
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Start (0-based)</label>';
  h += '<input id="cl-pd-custom-start" type="number" min="0" max="' + (_cl.parsed ? _cl.parsed.length - 1 : 99999) + '" value="' + esc(String(c.start)) + '" oninput="_pdCustomSet(\x27start\x27,this.value)" placeholder="e.g. 100" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  // End
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">End</label>';
  h += '<input id="cl-pd-custom-end" type="number" min="0" max="' + (_cl.parsed ? _cl.parsed.length : 99999) + '" value="' + esc(String(c.end)) + '" oninput="_pdCustomSet(\x27end\x27,this.value)" placeholder="e.g. 122" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  // Direction
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Direction</label>';
  h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;">';
  h += '<button onclick="_pdCustomSet(\x27direction\x27,\x27forward\x27)" style="padding:.4rem .6rem;font-size:.78rem;border:none;cursor:pointer;' + (c.direction === 'forward' ? 'background:#2980b9;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">Fwd \u2192</button>';
  h += '<button onclick="_pdCustomSet(\x27direction\x27,\x27reverse\x27)" style="padding:.4rem .6rem;font-size:.78rem;border:none;cursor:pointer;' + (c.direction === 'reverse' ? 'background:#8e44ad;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">\u2190 Rev</button>';
  h += '</div></div>';
  h += '</div>';

  // Region preview
  var s = parseInt(c.start, 10), e = parseInt(c.end, 10);
  if (_cl.parsed && !isNaN(s) && !isNaN(e) && s >= 0 && e > s && e <= _cl.parsed.length) {
    var region = _cl.parsed.seq.substring(s, e);
    var dispLen = Math.min(region.length, 50);
    h += '<div style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.75rem;color:#8a7f72;margin-bottom:.5rem;background:#f0ebe3;padding:.3rem .5rem;border-radius:3px;word-break:break-all;">';
    h += '<span style="font-size:.65rem;color:#8a7f72;">Region (' + region.length + 'bp): </span>' + esc(region.substring(0, dispLen)) + (region.length > dispLen ? '\u2026' : '');
    h += '</div>';
  }

  h += '<button onclick="_pdCustomDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (c.designing ? 'opacity:.6;pointer-events:none;' : '') + '">' + (c.designing ? '\u23f3 Evaluating\u2026' : '\ud83e\uddea Evaluate Primer') + '</button>';

  if (c.result) { h += _clRenderCustomResult(c.result); }
  return h;
}

function _clRenderCustomResult(r) {
  var h = '<div style="margin-top:.8rem;">';
  h += _clRenderSinglePrimer(r.direction === 'forward' ? 'Forward' : 'Reverse', {
    seq: r.primer_seq, tm: r.tm, length: r.length, gc_percent: r.gc_percent, quality: r.quality
  }, r.direction === 'forward' ? '#2980b9' : '#8e44ad', 'custom', {
    name: 'Primer ' + r.start + '-' + r.end, start: r.start, end: r.end,
    direction: r.direction === 'forward' ? 1 : -1, color: '#E67E22', type: 'primer_bind'
  });
  h += _clRenderSaveBtn([{ seq: r.primer_seq, label: (r.direction === 'forward' ? 'FWD' : 'REV') + ' custom primer at ' + r.start + '-' + r.end }]);
  h += '</div>';
  return h;
}

/* ── PCR PRIMER MODE ───────────────────────────────────────── */
function _clRenderPCRMode() {
  var p = _cl.pd.pcr;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Define the region you want to amplify. <strong style="color:#5b7a5e;">Drag on the map</strong> to select the target. Forward and reverse primers will be designed flanking it.</p>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6rem;margin-bottom:.7rem;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Target Start</label>';
  h += '<input id="cl-pd-pcr-targetStart" type="number" min="0" value="' + esc(String(p.targetStart)) + '" oninput="_pdPcrSet(\x27targetStart\x27,this.value)" placeholder="e.g. 500" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Target End</label>';
  h += '<input id="cl-pd-pcr-targetEnd" type="number" min="0" value="' + esc(String(p.targetEnd)) + '" oninput="_pdPcrSet(\x27targetEnd\x27,this.value)" placeholder="e.g. 1500" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Tm Target (\u00b0C)</label>';
  h += '<input type="number" min="50" max="75" value="' + p.tmTarget + '" oninput="_pdPcrSet(\x27tmTarget\x27,this.value)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '</div>';

  // Amplicon preview
  var ts = parseInt(p.targetStart, 10), te = parseInt(p.targetEnd, 10);
  if (!isNaN(ts) && !isNaN(te) && te > ts) {
    h += '<div style="font-size:.75rem;color:#8a7f72;margin-bottom:.5rem;">Amplicon: ~' + (te - ts).toLocaleString() + ' bp</div>';
  }

  h += '<button onclick="_pdPcrDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (p.designing ? 'opacity:.6;pointer-events:none;' : '') + '">' + (p.designing ? '\u23f3 Designing\u2026' : '\ud83e\uddea Design PCR Primers') + '</button>';

  if (p.result) { h += _clRenderPCRResult(p.result); }
  return h;
}

function _clRenderPCRResult(r) {
  var h = '<div style="margin-top:.8rem;">';
  if (r.warnings && r.warnings.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    r.warnings.forEach(function(w) { h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(w) + '</div>'; });
    h += '</div>';
  }
  h += _clRenderSinglePrimer('Forward', r.forward, '#2980b9', 'pcr-fwd', {
    name: 'PCR Fwd', start: r.forward.position, end: r.forward.position + r.forward.length,
    direction: 1, color: '#2980b9', type: 'primer_bind'
  });
  h += _clRenderSinglePrimer('Reverse', r.reverse, '#8e44ad', 'pcr-rev', {
    name: 'PCR Rev', start: r.reverse.position - r.reverse.length, end: r.reverse.position,
    direction: -1, color: '#8e44ad', type: 'primer_bind'
  });

  // Summary
  h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding:.5rem .7rem;background:#faf8f4;border:1px solid #e8e2d8;border-radius:5px;margin-top:.5rem;">';
  h += '<span style="font-size:.78rem;color:#8a7f72;">Amplicon: <strong style="color:#4a4139;">' + r.amplicon_length.toLocaleString() + ' bp</strong></span>';
  h += '<span style="font-size:.78rem;color:#8a7f72;">\u0394Tm: <strong style="color:#4a4139;">' + r.tm_diff + '\u00b0C</strong></span>';
  h += '<button onclick="_pdCopyBoth(\x27pcr\x27)" style="margin-left:auto;padding:.3rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy Both</button>';
  h += '<button onclick="_pdGenerateProduct(\x27pcr\x27)" style="padding:.3rem .6rem;font-size:.72rem;background:#4682B4;color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Generate linear PCR product as new .gb file">\ud83e\uddec Generate Product</button>';
  h += '</div>';
  h += _clRenderSaveBtn([
    { seq: r.forward.seq, label: 'FWD PCR primer at ' + r.forward.position },
    { seq: r.reverse.seq, label: 'REV PCR primer at ' + r.reverse.position },
  ]);
  h += '</div>';
  return h;
}

/* ── SEQUENCING PRIMER MODE ────────────────────────────────── */
function _clRenderSeqMode() {
  var s = _cl.pd.seq;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Define the region to sequence. <strong style="color:#5b7a5e;">Drag on the map</strong> to select it. Primers will be spaced for ~900bp Sanger reads with overlap for full coverage.</p>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:.6rem;margin-bottom:.7rem;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Region Start</label>';
  h += '<input id="cl-pd-seq-regionStart" type="number" min="0" value="' + esc(String(s.regionStart)) + '" oninput="_pdSeqSet(\x27regionStart\x27,this.value)" placeholder="0" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Region End</label>';
  h += '<input id="cl-pd-seq-regionEnd" type="number" min="0" value="' + esc(String(s.regionEnd)) + '" oninput="_pdSeqSet(\x27regionEnd\x27,this.value)" placeholder="e.g. 3000" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Read Length</label>';
  h += '<input type="number" min="300" max="1200" value="' + s.readLen + '" oninput="_pdSeqSet(\x27readLen\x27,this.value)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Tm Target</label>';
  h += '<input type="number" min="50" max="75" value="' + s.tmTarget + '" oninput="_pdSeqSet(\x27tmTarget\x27,this.value)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '</div>';

  var rs = parseInt(s.regionStart, 10), re = parseInt(s.regionEnd, 10);
  if (!isNaN(rs) && !isNaN(re) && re > rs) {
    var estPrimers = Math.ceil((re - rs) / (s.readLen - 150));
    h += '<div style="font-size:.75rem;color:#8a7f72;margin-bottom:.5rem;">Region: ' + (re - rs).toLocaleString() + ' bp \u2014 estimated ' + estPrimers + ' primer' + (estPrimers > 1 ? 's' : '') + ' needed</div>';
  }

  h += '<button onclick="_pdSeqDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (s.designing ? 'opacity:.6;pointer-events:none;' : '') + '">' + (s.designing ? '\u23f3 Designing\u2026' : '\ud83e\uddea Design Sequencing Primers') + '</button>';

  if (s.result) { h += _clRenderSeqResult(s.result); }
  return h;
}

function _clRenderSeqResult(r) {
  var h = '<div style="margin-top:.8rem;">';
  h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.6rem;">' + r.num_primers + ' primer' + (r.num_primers > 1 ? 's' : '') + ' designed \u2014 step size ' + r.step_size + 'bp, read length ' + r.read_length + 'bp</div>';

  r.primers.forEach(function(p) {
    h += _clRenderSinglePrimer('Seq #' + p.index + ' (pos ' + p.position + ')', {
      seq: p.seq, tm: p.tm, length: p.length, gc_percent: p.gc_percent, quality: p.quality
    }, '#e67e22', 'seq-' + p.index, {
      name: 'Seq primer #' + p.index, start: p.position, end: Math.min(p.position + p.length, (_cl.parsed ? _cl.parsed.length : 99999)),
      direction: 1, color: '#e67e22', type: 'primer_bind'
    });
  });

  // Copy all
  h += '<div style="display:flex;gap:.5rem;margin-top:.5rem;">';
  h += '<button onclick="_pdCopyBoth(\x27seq\x27)" style="padding:.3rem .7rem;font-size:.75rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy All Primers</button>';
  h += '</div>';

  var saveItems = r.primers.map(function(p) { return { seq: p.seq, label: 'Seq primer #' + p.index + ' at pos ' + p.position }; });
  h += _clRenderSaveBtn(saveItems);
  h += '</div>';
  return h;
}

/* ── KLD INSERTION MODE ────────────────────────────────────── */
function _clRenderKLDMode() {
  var k = _cl.pd.kld;
  var h = '';
h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">KLD (Kinase-Ligation-DpnI) \u2014 design primers for insertion, deletion, or replacement via inverse PCR. <strong style="color:#5b7a5e;">Set range</strong> to chop out DNA.</p>';

  // Row 1: Start and End Positions
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.7rem;">';
  h += '  <div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Start Position</label>';
  h += '  <input id="cl-pd-kld-startPos" type="number" min="0" value="' + esc(String(_cl.pd.kld.startPos || '')) + '" oninput="_pdKldSet(\x27startPos\x27,this.value)" placeholder="e.g. 100" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:monospace;" /></div>';
  
  h += '  <div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">End Position</label>';
  h += '  <input id="cl-pd-kld-endPos" type="number" min="0" value="' + esc(String(_cl.pd.kld.endPos || '')) + '" oninput="_pdKldSet(\x27endPos\x27,this.value)" placeholder="Same as start for insertion" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;font-family:monospace;" /></div>';
  h += '</div>';

  // Row 2: Optimization toggle
  h += '<div style="margin-bottom:.7rem;">';
  h += '  <label style="display:flex; align-items:center; gap:8px; font-size:.78rem; color:#4a4139; cursor:pointer;">';
  h += '    <input type="checkbox" ' + (_cl.pd.kld.optimize ? 'checked' : '') + ' onchange="_pdKldSet(\x27optimize\x27,this.checked)" style="margin:0;">';
  h += '    Optimize junction (find best primers within range)';
  h += '  </label>';
  if (_cl.pd.kld.optimize) {
    h += '  <label style="display:flex; align-items:center; gap:8px; font-size:.74rem; color:#8a7f72; cursor:pointer; margin-top:.35rem; padding-left:1.5rem;">';
    h += '    <input type="checkbox" ' + (_cl.pd.kld.exhaustive ? 'checked' : '') + ' onchange="_pdKldSet(\x27exhaustive\x27,this.checked)" style="margin:0;">';
    h += '    Exhaustive \u2014 full \u0394G analysis at every position (slow but thorough)';
    h += '  </label>';
  }
  h += '</div>';

  // Row 3: Tm and Max Length
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.7rem;">';
  h += '  <div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Tm Target (\u00b0C)</label>';
  h += '  <input type="number" min="50" max="75" value="' + k.tmTarget + '" oninput="_pdKldSet(\x27tmTarget\x27,this.value)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  
  h += '  <div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Max Length (bp)</label>';
  h += '  <input type="number" min="30" max="100" value="' + k.maxLen + '" oninput="_pdKldSet(\x27maxLen\x27,this.value)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '</div>';

  h += '<label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Insert Sequence</label>';
  h += '<textarea id="cl-kld-insert-ta" oninput="_pdKldSet(\x27insertSeq\x27,this.value)" placeholder="Paste DNA to insert\u2026" style="width:100%;box-sizing:border-box;padding:.45rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;min-height:55px;resize:vertical;line-height:1.5;">' + esc(k.insertSeq) + '</textarea>';

  var clean = _clCleanSeq(k.insertSeq);
  if (clean.length > 0) {
    h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.2rem;display:flex;gap:.8rem;">';
    h += '<span>Length: <strong style="color:#4a4139;">' + clean.length + ' bp</strong></span>';
    h += '<span>GC: <strong style="color:#4a4139;">' + _clGcPct(clean) + '%</strong></span>';
    h += '</div>';
  }

  // Complexity estimate
  var kldS = parseInt(k.startPos, 10) || 0;
  var kldE = parseInt(k.endPos || k.startPos, 10) || 0;
  var kldRange = Math.max(1, Math.abs(kldE - kldS) + 1);
  var kldInsLen = _clCleanSeq(k.insertSeq || '').length;
  var kldSplits = kldInsLen > 0 ? kldInsLen + 1 : 1;
  if (k.optimize && kldRange > 1) {
    var kldPairs = kldRange * (kldRange + 1) / 2;
    h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.5rem;padding:.4rem .6rem;background:#eef4ee;border-radius:4px;border:1px solid #d5cec0;">';
    h += '\ud83d\udd0d Baseline + <strong style="color:#4a4139;">' + kldPairs.toLocaleString() + '</strong> junction pairs \u00d7 <strong style="color:#4a4139;">' + kldSplits + '</strong> splits \u00d7 top-3 annealing \u2192 refine top 50';
    h += '</div>';
  }

  h += '<div style="margin-top:.6rem;">';
  h += '<button onclick="_pdKldDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (k.designing ? 'opacity:.6;pointer-events:none;' : '') + '">' + (k.designing ? '\u23f3 Designing\u2026' : '\u2702\ufe0f Design KLD Primers') + '</button>';
  h += '</div>';

  // Progress bar during design
  if (k.designing) {
    h += '<div id="cl-kld-progress-wrap" style="margin-top:.5rem;">';
    h += '<div style="height:6px;background:#e8e2d8;border-radius:3px;overflow:hidden;">';
    h += '<div id="cl-kld-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#5b7a5e,#2980b9);border-radius:3px;transition:width 0.3s ease;"></div>';
    h += '</div>';
    h += '<div id="cl-kld-progress-text" style="font-size:.68rem;color:#8a7f72;margin-top:.2rem;">Running baseline analysis\u2026</div>';
    h += '</div>';
  }

  if (k.result) { h += _clRenderKLDResult(k.result); }
  return h;
}

function _clRenderKLDResult(r) {
  var h = '<div style="margin-top:.8rem;">';
  if (r.warnings && r.warnings.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    r.warnings.forEach(function(w) { h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(w) + '</div>'; });
    h += '</div>';
  }

  // Use start_used/end_used from the API response (the actual positions the algorithm chose)
  var kldStart = parseInt(r.start_used, 10) || parseInt(_cl.pd.kld.startPos, 10) || 0;
  var kldEnd = parseInt(r.end_used, 10) || parseInt(_cl.pd.kld.endPos, 10) || 0;
  var kldSeqLen = _cl.parsed ? _cl.parsed.length : 99999;

  // Get selected primers (may differ from best if user clicked an alternative)
  var selFwd = _pdKldGetSelected('fwd');
  var selRev = _pdKldGetSelected('rev');
  
  h += _clRenderTailedPrimer('Forward', r.forward, '#2980b9', 'kld-fwd', {
    name: 'KLD Fwd anneal', 
    start: kldEnd, 
    end: Math.min(kldEnd + (selFwd ? selFwd.annealing.length : r.forward.annealing.length), kldSeqLen),
    direction: 1, color: '#2980b9', type: 'primer_bind'
  }, { direction: 'fwd', selectedIdx: _cl.pd.kld.selectedFwdIdx });
  
  // Reverse
  var revAnnLen = selRev ? selRev.annealing.length : r.reverse.annealing.length;
  var revAnnStart = ((kldStart - revAnnLen) % kldSeqLen + kldSeqLen) % kldSeqLen;
  h += _clRenderTailedPrimer('Reverse', r.reverse, '#8e44ad', 'kld-rev', {
    name: 'KLD Rev anneal', 
    start: revAnnStart, 
    end: kldStart,
    direction: -1, color: '#8e44ad', type: 'primer_bind'
  }, { direction: 'rev', selectedIdx: _cl.pd.kld.selectedRevIdx });

  h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding:.5rem .7rem;background:#faf8f4;border:1px solid #e8e2d8;border-radius:5px;margin-top:.5rem;">';
  if (r.insert_length > 0) {
    h += '<span style="font-size:.78rem;color:#8a7f72;">Split: <strong style="color:#4a4139;">pos ' + (r.split_position || r.insert_split || 0) + '/' + (r.insert_length || 0) + '</strong></span>';
    h += '<span style="font-size:.78rem;color:#8a7f72;">GC score: <strong style="color:#4a4139;">' + (r.split_gc_score != null ? r.split_gc_score.toFixed(2) : '—') + '</strong></span>';
  }
  if (kldEnd > kldStart) {
    h += '<span style="font-size:.78rem;color:#8a7f72;">Deleted: <strong style="color:#e74c3c;">' + (kldEnd - kldStart) + ' bp</strong></span>';
  }
  h += '<span style="font-size:.78rem;color:#8a7f72;">Product: <strong style="color:#4a4139;">' + r.product_length.toLocaleString() + ' bp</strong></span>';
  h += '<button onclick="_pdCopyBoth(\x27kld\x27)" style="margin-left:auto;padding:.3rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy Both</button>';
  h += '<button onclick="_pdGenerateProduct(\x27kld\x27)" style="padding:.3rem .6rem;font-size:.72rem;background:#8E44AD;color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Generate circularised KLD product as new .gb plasmid">\ud83d\udd04 Generate Circular Product</button>';
  h += '</div>';

  // Search stats
  if (r.search_stats) {
    var ss = r.search_stats;
    h += '<div style="font-size:.66rem;color:#8a7f72;margin-top:.3rem;padding:.25rem .5rem;display:flex;gap:.8rem;flex-wrap:wrap;">';
    h += '\ud83d\udd0d <span>Searched <strong>' + ss.junction_pairs.toLocaleString() + '</strong> junction pairs</span>';
    h += '<span>\u00d7 <strong>' + ss.split_points + '</strong> splits</span>';
    h += '<span>= <strong>' + ss.pairs_scored.toLocaleString() + '</strong> combos scored</span>';
    h += '<span>(<strong>' + ss.candidates_generated.toLocaleString() + '</strong> candidates)</span>';
    if (ss.shortlist_refined) h += '<span>\u2192 top <strong>' + ss.shortlist_refined + '</strong> refined with full \u0394G</span>';
    if (ss.exhaustive) h += '<span style="color:#8E44AD;font-weight:600;">\u2714 Exhaustive (full \u0394G at every position)</span>';
    h += '</div>';
  }

  var posLabel = kldEnd > kldStart ? kldStart + '-' + kldEnd : String(kldStart);
  h += _clRenderSaveBtn([
    { seq: selFwd ? selFwd.full_seq : r.forward.full_seq, label: 'FWD KLD into ' + (_cl.parsed ? _cl.parsed.name : 'plasmid') + ' at ' + posLabel },
    { seq: selRev ? selRev.full_seq : r.reverse.full_seq, label: 'REV KLD into ' + (_cl.parsed ? _cl.parsed.name : 'plasmid') + ' at ' + posLabel },
  ]);
  h += '</div>';
  return h;
}

/* ═══════════════════════════════════════════════════════════
   SHARED PRIMER RENDERING
   ═══════════════════════════════════════════════════════════ */

// Standard primer card (no tail)
function _clRenderSinglePrimer(label, p, accentColor, copyKey, featureData) {
  var h = '';
  h += '<div style="border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;margin-bottom:.5rem;border-left:3px solid ' + accentColor + ';">';
  // Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .65rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;">';
  h += '<div><span style="font-weight:600;font-size:.8rem;color:#4a4139;">' + esc(label) + '</span>';
  h += '<span style="font-size:.72rem;color:#8a7f72;margin-left:.5rem;">' + p.length + 'bp \u00b7 Tm ' + p.tm + '\u00b0C \u00b7 GC ' + p.gc_percent + '%</span></div>';
  h += '<div style="display:flex;gap:.3rem;">';
  if (featureData) {
    var stashIdx = window._featStash.length;
    window._featStash.push(featureData);
    h += '<button onclick="_clAddAsFeature(' + stashIdx + ')" style="padding:.2rem .45rem;font-size:.68rem;color:#4682B4;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;" title="Add as annotation">\u2795 Feature</button>';
  }
  h += '<button onclick="_pdCopy(\x27' + esc(copyKey) + '\x27)" style="padding:.2rem .45rem;font-size:.68rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy</button>';
  h += '</div></div>';
  // Sequence
  h += '<div style="padding:.4rem .65rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.78rem;color:#4a4139;word-break:break-all;line-height:1.6;">' + esc(p.seq) + '</div>';
  // Quality checks
  if (p.quality && p.quality.length > 0) {
    h += '<div style="padding:.35rem .65rem;border-top:1px solid #f0ebe3;display:flex;flex-wrap:wrap;gap:.3rem .8rem;">';
    p.quality.forEach(function(q) {
      var icon = q.level === 'pass' ? '\u2705' : q.level === 'warn' ? '\u26a0\ufe0f' : '\u274c';
      var color = q.level === 'pass' ? '#5b7a5e' : q.level === 'warn' ? '#b8860b' : '#c0392b';
      h += '<span style="font-size:.68rem;color:' + color + ';">' + icon + ' <strong>' + esc(q.rule) + '</strong> ' + esc(q.detail) + '</span>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

// Tailed primer card (for KLD — shows tail + annealing split)
// selectInfo: optional { direction: 'fwd'|'rev', selectedIdx: N } for clickable row selection
function _clRenderTailedPrimer(label, p, accentColor, copyKey, featureData, selectInfo) {
  // If selectInfo is provided and a non-best primer is selected, show that primer's data in the header
  var displayPrimer = p;
  if (selectInfo && selectInfo.selectedIdx > 0 && p.alternatives) {
    var allOpts = [p].concat(p.alternatives);
    if (allOpts[selectInfo.selectedIdx]) displayPrimer = allOpts[selectInfo.selectedIdx];
  }

  var h = '';
  h += '<div style="border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;margin-bottom:.5rem;border-left:3px solid ' + accentColor + ';">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .65rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;">';
  h += '<div><span style="font-weight:600;font-size:.8rem;color:#4a4139;">' + esc(label) + '</span>';
  h += '<span style="font-size:.72rem;color:#8a7f72;margin-left:.5rem;">' + displayPrimer.length + 'bp \u00b7 Tm ' + displayPrimer.tm + '\u00b0C \u00b7 GC ' + displayPrimer.gc_percent + '%</span>';
  // Show dimer/hairpin badges if data is present
  if (typeof displayPrimer.homodimer_dg === 'number') {
    var dimerColor = displayPrimer.homodimer_dg < -12 ? '#c0392b' : displayPrimer.homodimer_dg < -9 ? '#e67e22' : '#5b7a5e';
    h += '<span style="font-size:.66rem;margin-left:.4rem;padding:.1rem .35rem;border-radius:3px;background:' + (displayPrimer.homodimer_dg < -12 ? '#fde8e8' : displayPrimer.homodimer_dg < -9 ? '#fdf2e9' : '#eef4ee') + ';color:' + dimerColor + ';">dimer \u0394G ' + displayPrimer.homodimer_dg + '</span>';
  }
  if (displayPrimer.hairpin) {
    h += '<span style="font-size:.66rem;margin-left:.3rem;padding:.1rem .35rem;border-radius:3px;background:#fde8e8;color:#c0392b;">hairpin</span>';
  }
  h += '</div>';
  h += '<div style="display:flex;gap:.3rem;">';
  if (featureData) {
    var stashIdx = window._featStash.length;
    window._featStash.push(featureData);
    h += '<button onclick="_clAddAsFeature(' + stashIdx + ')" style="padding:.2rem .45rem;font-size:.68rem;color:#4682B4;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;" title="Add as annotation">\u2795 Feature</button>';
  }
  h += '<button onclick="_pdCopy(\x27' + esc(copyKey) + '\x27)" style="padding:.2rem .45rem;font-size:.68rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy</button>';
  h += '</div></div>';
  h += '<div style="padding:.45rem .65rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.78rem;line-height:1.7;">';
  h += '<div style="display:flex;align-items:baseline;gap:.4rem;"><span style="font-size:.62rem;color:#8a7f72;min-width:55px;text-align:right;">5\u2032 tail:</span><span style="color:' + accentColor + ';word-break:break-all;">' + esc(displayPrimer.tail) + '</span><span style="font-size:.62rem;color:#8a7f72;">(' + displayPrimer.tail.length + 'bp)</span></div>';
  h += '<div style="display:flex;align-items:baseline;gap:.4rem;"><span style="font-size:.62rem;color:#8a7f72;min-width:55px;text-align:right;">anneal:</span><span style="color:#4a4139;font-weight:500;word-break:break-all;">' + esc(displayPrimer.annealing) + '</span><span style="font-size:.62rem;color:#8a7f72;">(' + displayPrimer.annealing.length + 'bp)</span></div>';
  h += '<div style="display:flex;align-items:baseline;gap:.4rem;margin-top:.25rem;padding-top:.25rem;border-top:1px solid #f0ebe3;"><span style="font-size:.62rem;color:#8a7f72;min-width:55px;text-align:right;">full:</span><span style="word-break:break-all;"><span style="color:' + accentColor + ';">' + esc(displayPrimer.tail) + '</span><span style="color:#4a4139;font-weight:600;">' + esc(displayPrimer.annealing) + '</span></span></div>';
  h += '</div>';

  // Alternatives section
  if (p.alternatives && p.alternatives.length > 0) {
    var altKey = copyKey + '-alts';
    var isCollapsed = !!window._altExpanded[altKey];  // inverted: starts expanded, click to collapse
    var selIdx = selectInfo ? selectInfo.selectedIdx : 0;
    h += '<div style="border-top:1px solid #e8e2d8;">';
    h += '<button onclick="_adToggleAlts(\x27' + esc(altKey) + '\x27)" style="display:flex;align-items:center;gap:.3rem;width:100%;padding:.35rem .65rem;font-size:.72rem;color:#5b7a5e;border:none;background:#eef4ee;cursor:pointer;text-align:left;font-weight:500;">';
    h += '<span style="font-size:.6rem;">' + (isCollapsed ? '\u25B6' : '\u25BC') + '</span>';
    h += (p.alternatives.length + 1) + ' primer options' + (selectInfo ? ' \u2014 click to show on map' : ' \u2014 compare Tm vs dimer trade-offs');
    h += '</button>';
    if (!isCollapsed) {
      h += '<div style="padding:.4rem .65rem .5rem;background:#faf8f4;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:.72rem;">';
      h += '<thead><tr style="border-bottom:2px solid #d5cec0;">';
      h += '<th style="text-align:left;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Annealing</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Len</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Tm</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">GC%</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Dimer \u0394G</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Hairpin</th>';
      h += '<th style="text-align:center;padding:.3rem .3rem;color:#4a4139;font-weight:600;">Score</th>';
      h += '<th style="text-align:right;padding:.3rem .3rem;"></th>';
      h += '</tr></thead><tbody>';
      // Recommended (current) primer as first row
      var allOptions = [p].concat(p.alternatives);
      allOptions.forEach(function(opt, oi) {
        var isRec = (oi === 0);
        var isSel = (oi === selIdx);
        var dimerC = opt.homodimer_dg < -12 ? '#c0392b' : opt.homodimer_dg < -9 ? '#e67e22' : '#5b7a5e';
        var rowBg = isSel ? 'background:#dbeafe;' : isRec ? 'background:#eef4ee;' : '';
        var rowCursor = selectInfo ? 'cursor:pointer;' : '';
        var rowClick = selectInfo ? ' onclick="_pdKldSelectPrimer(\x27' + selectInfo.direction + '\x27,' + oi + ')"' : '';
        h += '<tr style="border-bottom:1px solid #f0ebe3;' + rowBg + rowCursor + '"' + rowClick + '>';
        h += '<td style="padding:.3rem .3rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;word-break:break-all;max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="' + esc(opt.annealing) + '">';
        if (isSel) h += '<span style="font-size:.6rem;background:#2563eb;color:#fff;padding:.1rem .25rem;border-radius:2px;margin-right:.3rem;">\u25C9</span>';
        else if (isRec) h += '<span style="font-size:.6rem;background:#5b7a5e;color:#fff;padding:.1rem .25rem;border-radius:2px;margin-right:.3rem;">\u2605</span>';
        h += esc(opt.annealing.length > 22 ? opt.annealing.slice(0, 22) + '\u2026' : opt.annealing) + '</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;">' + opt.length + '</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;font-weight:' + (isSel ? '600' : '400') + ';">' + opt.tm + '\u00b0C</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;">' + opt.gc_percent + '%</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;color:' + dimerC + ';font-weight:500;">' + (typeof opt.homodimer_dg === 'number' ? opt.homodimer_dg : '-') + '</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;">' + (opt.hairpin ? '\u26a0\ufe0f' : '\u2705') + '</td>';
        h += '<td style="text-align:center;padding:.3rem .3rem;color:#8a7f72;">' + (typeof opt.score === 'number' ? opt.score : '-') + '</td>';
        h += '<td style="text-align:right;padding:.3rem .3rem;"><button onclick="event.stopPropagation();navigator.clipboard.writeText(\x27' + esc(opt.full_seq) + '\x27).then(function(){toast(\x27Primer copied\x27)})" style="padding:.15rem .4rem;font-size:.66rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy</button></td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
      h += '<div style="font-size:.64rem;color:#8a7f72;margin-top:.3rem;">' + (selectInfo ? '\u25C9 = selected on map \u00b7 ' : '') + '\u2605 = recommended (lowest score is best) \u00b7 Dimer \u0394G: green > -9, amber -9 to -12, red < -12 kcal/mol</div>';
      h += '</div>';
    }
    h += '</div>';
  }

  h += '</div>';
  return h;
}

// Save button
function _clRenderSaveBtn(items) {
  var h = '<div style="margin-top:.6rem;display:flex;justify-content:flex-end;">';
  h += '<button onclick="_pdSavePrimers()" style="padding:.4rem .8rem;font-size:.78rem;font-weight:500;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;' + (_cl.pd.saving ? 'opacity:.6;pointer-events:none;' : '') + '">' + (_cl.pd.saving ? 'Saving\u2026' : '\ud83d\udcbe Save to DNA Manager') + '</button>';
  h += '</div>';
  // Stash save items for the handler
  window._pdSaveItems = items;
  return h;
}

/* ═══════════════════════════════════════════════════════════
   ACTION HANDLERS
   ═══════════════════════════════════════════════════════════ */

function _pdToggle() { _cl.pd.expanded = !_cl.pd.expanded; _clRender(); }
function _pdSetMode(m) {
  _cl.pd.mode = m;
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

// ── Custom
function _pdCustomSet(field, val) {
  if (field === 'direction') { _cl.pd.custom.direction = val; _clRender(); setTimeout(function() { _clRenderSeqViz(); }, 50); return; }
  _cl.pd.custom[field] = val;
  clearTimeout(window._pdCustomTimer);
  window._pdCustomTimer = setTimeout(function() { _clRenderSeqViz(); }, 300);
}

function _pdCustomDesign() {
  var c = _cl.pd.custom;
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var s = parseInt(c.start, 10), e = parseInt(c.end, 10);
  if (isNaN(s) || isNaN(e) || s < 0 || e <= s) { toast('Enter valid start and end positions', true); return; }
  c.designing = true; c.result = null; _clRender();
  api('POST', '/api/cloning/evaluate-primer', {
    template_seq: _cl.parsed.seq, start: s, end: e, direction: c.direction
  }).then(function(data) {
    c.designing = false; c.result = data; _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) { c.designing = false; toast('Error: ' + (err.message || err), true); _clRender(); });
}

// ── PCR
function _pdPcrSet(field, val) {
  _cl.pd.pcr[field] = field === 'tmTarget' ? parseInt(val, 10) || 62 : val;
  clearTimeout(window._pdPcrTimer);
  window._pdPcrTimer = setTimeout(function() { _clRenderSeqViz(); }, 300);
}

function _pdPcrDesign() {
  var p = _cl.pd.pcr;
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var ts = parseInt(p.targetStart, 10), te = parseInt(p.targetEnd, 10);
  if (isNaN(ts) || isNaN(te) || ts < 0 || te <= ts) { toast('Enter valid target start and end', true); return; }
  p.designing = true; p.result = null; _clRender();
  api('POST', '/api/cloning/design-pcr-primers', {
    template_seq: _cl.parsed.seq, target_start: ts, target_end: te, tm_target: p.tmTarget
  }).then(function(data) {
    p.designing = false; p.result = data; _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) { p.designing = false; toast('Error: ' + (err.message || err), true); _clRender(); });
}

// ── Sequencing
function _pdSeqSet(field, val) {
  if (field === 'readLen' || field === 'tmTarget') { _cl.pd.seq[field] = parseInt(val, 10) || (field === 'readLen' ? 900 : 62); }
  else { _cl.pd.seq[field] = val; }
}

function _pdSeqDesign() {
  var s = _cl.pd.seq;
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var rs = parseInt(s.regionStart, 10), re = parseInt(s.regionEnd, 10);
  if (isNaN(rs) || isNaN(re) || rs < 0 || re <= rs) { toast('Enter valid region start and end', true); return; }
  s.designing = true; s.result = null; _clRender();
  api('POST', '/api/cloning/design-seq-primers', {
    template_seq: _cl.parsed.seq, region_start: rs, region_end: re, read_length: s.readLen, tm_target: s.tmTarget
  }).then(function(data) {
    s.designing = false; s.result = data; _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) { s.designing = false; toast('Error: ' + (err.message || err), true); _clRender(); });
}

  function _pdKldSet(field, val) {
  // 1. Update the value in state
  _cl.pd.kld[field] = val;

  // 2. Auto-sync: If user sets Start but hasn't touched End, keep them the same (insertion mode)
  if (field === 'startPos' && (!_cl.pd.kld.endPos || _cl.pd.kld.endPos === '')) {
    _cl.pd.kld.endPos = val;
  }

  // Clear exhaustive if optimize is turned off
  if (field === 'optimize' && !val) {
    _cl.pd.kld.exhaustive = false;
  }

  // Re-render UI when toggles change (so exhaustive checkbox appears/disappears)
  if (field === 'optimize' || field === 'exhaustive') {
    _clRender();
  }

  // 3. Map Refresh: If start or end positions change, update the SeqViz map highlights
  if (field === 'startPos' || field === 'endPos' || field === 'optimize' || field === 'exhaustive') {
    clearTimeout(window._pdKldTimer);
    window._pdKldTimer = setTimeout(function() { 
      _clRenderSeqViz(); 
    }, 300);
  }

  // 4. Input Refresh: If the insert sequence changes, re-render the UI 
  // (we keep focus on the textarea so typing isn't interrupted)
  if (field === 'insertSeq') {
    clearTimeout(window._pdKldInsTimer);
    window._pdKldInsTimer = setTimeout(function() { 
      _clRender(); 
      var ta = document.getElementById('cl-kld-insert-ta'); 
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length; // Move cursor to end
      }
    }, 400);
  }
}
  function _pdKldDesign() {
  var k = _cl.pd.kld;
  if (!_cl.parsed) { toast('Load a plasmid first', true); return; }

  // 1. Get and Validate Start/End positions
  var s = parseInt(k.startPos, 10);
  var e = parseInt(k.endPos || k.startPos, 10);
  
  if (isNaN(s) || s < 0 || s >= _cl.parsed.length) { 
    toast('Enter a valid Start Position', true); return; 
  }
  if (isNaN(e) || e < 0 || e >= _cl.parsed.length) { 
    toast('Enter a valid End Position', true); return; 
  }

  var insert = _clCleanSeq(k.insertSeq || "");
  var isOpt = !!k.optimize;
  var isExhaustive = isOpt && !!k.exhaustive;

  // 2. Exhaustive confirmation popup
  if (isExhaustive) {
    var range = Math.abs(e - s) + 1;
    var splits = insert.length > 0 ? insert.length + 1 : 1;
    var pairs = range * (range + 1) / 2;
    var totalCombos = pairs * splits;
    var estMin = Math.ceil(totalCombos * 2 / 400 / 60); // ~400 full calls/sec
    if (!confirm(
      'Exhaustive mode: full \u0394G analysis at every position.\n\n' +
      '\u2022 ' + range + ' positions \u00d7 ' + splits + ' splits = ' + totalCombos.toLocaleString() + ' combos\n' +
      '\u2022 Each combo runs full thermodynamic analysis (homodimer, hairpin, \u0394G)\n' +
      '\u2022 Estimated time: ' + (estMin < 1 ? '<1' : '~' + estMin) + ' minute' + (estMin !== 1 ? 's' : '') + '\n\n' +
      'The page will remain responsive but the server will be working hard.\n\n' +
      'Continue?'
    )) return;
  }

  // 3. UI State
  k.designing = true; 
  k.result = null;
  k.selectedFwdIdx = 0;
  k.selectedRevIdx = 0;
  _clRender();

  // 4. Animate progress bar
  var range = Math.abs(e - s) + 1;
  var splits = insert.length > 0 ? insert.length + 1 : 1;
  var baselineCalls = splits * 2;
  var scanCalls = isOpt ? range * splits * 2 : 0;
  var refineCalls = isOpt ? 100 : 0;
  var estMs;
  if (isExhaustive) {
    // Full analysis everywhere — much slower
    estMs = Math.max(5000, Math.ceil((baselineCalls + scanCalls) / 400 * 1000));
  } else {
    estMs = Math.max(2000, Math.ceil((baselineCalls / 400 + scanCalls / 4000 + refineCalls / 400) * 1000));
  }
  var progressStart = Date.now();
  var progressMessages = isExhaustive
    ? ['Running baseline analysis\u2026', 'Full \u0394G scan at every position\u2026', 'Evaluating homodimer stability\u2026', 'Scoring all junction pairs\u2026', 'Comparing all candidates\u2026', 'Finalising best primers\u2026']
    : ['Running baseline analysis\u2026', 'Scanning junction positions\u2026', 'Testing insert split points\u2026', 'Scoring primer pairs\u2026', 'Refining top candidates\u2026', 'Final thermodynamic analysis\u2026'];

  window._kldProgressIv = setInterval(function() {
    var elapsed = Date.now() - progressStart;
    var pct = 95 * (1 - Math.exp(-elapsed / (estMs * 0.7)));
    var bar = document.getElementById('cl-kld-progress-bar');
    var txt = document.getElementById('cl-kld-progress-text');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
    if (txt) {
      var msgIdx = Math.min(Math.floor(pct / 18), progressMessages.length - 1);
      var elapsedSec = Math.floor(elapsed / 1000);
      if (elapsed < estMs) {
        var secLeft = Math.max(1, Math.ceil((estMs - elapsed) / 1000));
        txt.textContent = progressMessages[msgIdx] + ' (~' + secLeft + 's remaining)';
      } else {
        txt.textContent = progressMessages[msgIdx] + ' (' + elapsedSec + 's elapsed, still working\u2026)';
      }
    }
  }, 200);

  // 5. API Call
  api('POST', '/api/cloning/design-kld-primers', {
    template_seq: _cl.parsed.sequence || _cl.parsed.seq,
    insert_seq: insert,
    start_pos: s,
    end_pos: e,
    optimize: isOpt,
    exhaustive: isExhaustive,
    annealing_tm_target: parseInt(k.tmTarget, 10) || 62,
    max_primer_length: parseInt(k.maxLen, 10) || 60
  }).then(function(data) {
    clearInterval(window._kldProgressIv);
    k.designing = false; 
    k.result = data; 
    _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) { 
    clearInterval(window._kldProgressIv);
    k.designing = false; 
    toast('Error: ' + (err.message || err), true); 
    _clRender(); 
  });
}

// ── KLD primer selection (click alternative to show on map)
function _pdKldSelectPrimer(direction, idx) {
  if (direction === 'fwd') {
    _cl.pd.kld.selectedFwdIdx = idx;
  } else {
    _cl.pd.kld.selectedRevIdx = idx;
  }
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

// Helper: get the currently selected KLD primer for a direction
function _pdKldGetSelected(direction) {
  var r = _cl.pd.kld.result;
  if (!r) return null;
  var primer = direction === 'fwd' ? r.forward : r.reverse;
  var idx = direction === 'fwd' ? _cl.pd.kld.selectedFwdIdx : _cl.pd.kld.selectedRevIdx;
  if (idx === 0) return primer; // best/recommended
  var allOptions = [primer].concat(primer.alternatives || []);
  return allOptions[idx] || primer;
}

// ── Copy
function _pdCopy(key) {
  var seq = '';
  if (key === 'custom' && _cl.pd.custom.result) seq = _cl.pd.custom.result.primer_seq;
  else if (key === 'pcr-fwd' && _cl.pd.pcr.result) seq = _cl.pd.pcr.result.forward.seq;
  else if (key === 'pcr-rev' && _cl.pd.pcr.result) seq = _cl.pd.pcr.result.reverse.seq;
  else if (key === 'kld-fwd' && _cl.pd.kld.result) { var sp = _pdKldGetSelected('fwd'); seq = sp ? sp.full_seq : ''; }
  else if (key === 'kld-rev' && _cl.pd.kld.result) { var sp2 = _pdKldGetSelected('rev'); seq = sp2 ? sp2.full_seq : ''; }
  else if (key.indexOf('seq-') === 0 && _cl.pd.seq.result) {
    var idx = parseInt(key.replace('seq-', ''), 10) - 1;
    if (_cl.pd.seq.result.primers[idx]) seq = _cl.pd.seq.result.primers[idx].seq;
  }
  else if (key.indexOf('ad-') === 0) {
    _adCopyPrimer(key);
    return;
  }
  if (seq) { navigator.clipboard.writeText(seq).then(function() { toast('Primer copied'); }); }
}

function _pdCopyBoth(mode) {
  var text = '';
  if (mode === 'pcr' && _cl.pd.pcr.result) {
    var r = _cl.pd.pcr.result;
    text = 'Forward: ' + r.forward.seq + '\nReverse: ' + r.reverse.seq;
  } else if (mode === 'kld' && _cl.pd.kld.result) {
    var sf = _pdKldGetSelected('fwd');
    var sr = _pdKldGetSelected('rev');
    text = 'Forward: ' + (sf ? sf.full_seq : '') + '\nReverse: ' + (sr ? sr.full_seq : '');
  } else if (mode === 'seq' && _cl.pd.seq.result) {
    text = _cl.pd.seq.result.primers.map(function(p) { return 'Seq#' + p.index + ' (pos ' + p.position + '): ' + p.seq; }).join('\n');
  }
  if (text) { navigator.clipboard.writeText(text).then(function() { toast('Primers copied'); }); }
}

// ── Save
function _pdSavePrimers() {
  var items = window._pdSaveItems;
  if (!items || !items.length) { toast('Nothing to save', true); return; }
  _cl.pd.saving = true; _clRender();
  var primerData = items.map(function(it) { return { seq: it.seq, use_desc: it.label }; });
  api('POST', '/api/cloning/save-primers', {
    primers: primerData,
    plasmid_name: _cl.parsed ? _cl.parsed.name : 'unknown',
  }).then(function(data) {
    _cl.pd.saving = false;
    var names = data.saved.map(function(s) { return s.name; }).join(', ');
    toast('Saved: ' + names);
    _clRender();
    _clLoadSequences().then(function() { _clRender(); });
  }).catch(function(err) {
    _cl.pd.saving = false;
    toast('Save failed: ' + (err.message || err), true);
    _clRender();
  });
}


/* ── OpenCloning tab ───────────────────────────────────────── */
function _clRenderOCTab() {
  var h = '';
  if (!_cl.ocUrl) {
    h += '<div style="text-align:center;padding:3rem 1rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:6px;background:#fff;">';
    h += '<div style="font-size:2rem;margin-bottom:.5rem;opacity:.5;">\u26a0\ufe0f</div>';
    h += '<div style="font-size:.9rem;margin-bottom:.3rem;">OpenCloning URL not configured</div>';
    h += '<div style="font-size:.8rem;">Set <code>OPENCLONING_URL</code> in docker-compose.yml</div></div>';
    return h;
  }
  var osb = _cl.ocSidebarOpen;
  h += '<div style="display:flex;gap:0;height:750px;">';

  if (osb) {
    h += '<div style="width:240px;min-width:240px;border:1px solid #d5cec0;border-right:none;border-radius:6px 0 0 6px;background:#fff;display:flex;flex-direction:column;overflow:hidden;">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
    h += '<span style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Your Sequences</span>';
    h += '<button onclick="_clToggleOcSidebar()" style="padding:.15rem .35rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#8a7f72;cursor:pointer;" title="Hide sidebar">\u00ab</button>';
    h += '</div>';
    h += '<div style="padding:.4rem .6rem;border-bottom:1px solid #e8e2d8;">';
    h += '<input type="text" placeholder="Search\u2026" value="' + esc(_cl.ocFilter || '') + '" oninput="_clOcFilterChange(this.value)" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.78rem;color:#4a4139;" />';
    h += '</div>';
    h += '<div style="flex:1;overflow-y:auto;">';

    var plasmids = _cl.sequences.filter(function(s) { return s.type === 'plasmid' && s.has_file; });
    var primers = _cl.sequences.filter(function(s) { return s.type === 'primer' && s.has_file; });
    if (_cl.ocFilter) {
      var f = _cl.ocFilter.toLowerCase();
      plasmids = plasmids.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.use && s.use.toLowerCase().indexOf(f) !== -1); });
      primers = primers.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.sequence && s.sequence.toLowerCase().indexOf(f) !== -1); });
    }
    if (plasmids.length > 0) {
      h += '<div style="padding:.3rem .6rem;font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;background:#faf8f4;">Plasmids</div>';
      plasmids.forEach(function(s) {
        h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;border-bottom:1px solid #f0ebe3;transition:background .1s;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27transparent\x27">';
        h += '<div style="flex:1;min-width:0;"><div style="font-size:.8rem;font-weight:500;color:#4a4139;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>';
        if (s.use) h += '<div style="font-size:.65rem;color:#8a7f72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.use) + '</div>';
        h += '</div>';
        h += '<a href="/api/plasmids/' + s.id + '/gb" download style="flex-shrink:0;margin-left:.4rem;padding:.2rem .4rem;font-size:.68rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;text-decoration:none;white-space:nowrap;">\u2b07 .gb</a>';
        h += '</div>';
      });
    }
    if (primers.length > 0) {
      h += '<div style="padding:.3rem .6rem;font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;background:#faf8f4;' + (plasmids.length > 0 ? 'margin-top:.2rem;' : '') + '">Primers</div>';
      primers.forEach(function(s) {
        h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;border-bottom:1px solid #f0ebe3;transition:background .1s;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27transparent\x27">';
        h += '<div style="flex:1;min-width:0;"><div style="font-size:.8rem;font-weight:500;color:#4a4139;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>';
        if (s.sequence) h += '<div style="font-size:.62rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.sequence.substring(0, 30)) + '</div>';
        h += '</div>';
        h += '<a href="/api/primers/' + s.id + '/gb" download style="flex-shrink:0;margin-left:.4rem;padding:.2rem .4rem;font-size:.68rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;text-decoration:none;white-space:nowrap;">\u2b07 .gb</a>';
        h += '</div>';
      });
    }
    if (plasmids.length === 0 && primers.length === 0) {
      h += '<div style="padding:1.5rem .6rem;text-align:center;color:#8a7f72;font-size:.78rem;">' + (_cl.ocFilter ? 'No matches.' : 'No .gb files found.') + '</div>';
    }
    h += '</div></div>';
  }

  h += '<div style="flex:1;border:1px solid #d5cec0;border-radius:' + (osb ? '0 6px 6px 0' : '6px') + ';overflow:hidden;position:relative;">';
  if (!osb) {
    h += '<button onclick="_clToggleOcSidebar()" style="position:absolute;top:.5rem;left:.5rem;z-index:10;padding:.2rem .4rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#faf8f4;color:#8a7f72;cursor:pointer;" title="Show sequence list">\u00bb</button>';
  }
  h += '<iframe src="' + esc(_cl.ocUrl) + '" style="width:100%;height:100%;border:none;display:block;" title="OpenCloning"></iframe>';
  h += '</div></div>';
  return h;
}

/* ═══════════════════════════════════════════════════════════
   SEQUENCE ANALYSIS PANEL
   ═══════════════════════════════════════════════════════════ */
function _clRenderSAPanel() {
  var sa = _cl.sa;
  var h = '';
  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;overflow:hidden;">';

  // Collapsible header
  h += '<div onclick="_saToggle()" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .9rem;cursor:pointer;background:#faf8f4;border-bottom:' + (sa.expanded ? '1px solid #e8e2d8' : 'none') + ';user-select:none;" onmouseover="this.style.background=\x27#f0ebe3\x27" onmouseout="this.style.background=\x27#faf8f4\x27">';
  h += '<span style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#5b7a5e;">Sequence Analysis</span>';
  h += '<span style="font-size:.8rem;color:#8a7f72;transition:transform .2s;display:inline-block;transform:rotate(' + (sa.expanded ? '180' : '0') + 'deg);">\u25bc</span>';
  h += '</div>';
  if (!sa.expanded) { h += '</div>'; return h; }

  // Mode tabs
  h += '<div style="display:flex;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
  var modes = [
    { key: 'orfs', label: 'ORFs', icon: '\ud83e\uddec' },
    { key: 'restriction', label: 'RE Sites', icon: '\u2702\ufe0f' },
    { key: 'digest', label: 'Digest', icon: '\ud83e\uddea' },
    { key: 'scan', label: 'Scan', icon: '\ud83d\udd2c' },
    { key: 'blast', label: 'BLAST', icon: '\ud83c\udf10' },
    { key: 'tools', label: 'Tools', icon: '\ud83d\udd27' },
  ];
  modes.forEach(function(m) {
    var active = sa.mode === m.key;
    h += '<button onclick="_saSetMode(\x27' + m.key + '\x27)" style="flex:1;padding:.5rem .2rem;font-size:.72rem;font-weight:' + (active ? '600' : '400') + ';border:none;border-bottom:2px solid ' + (active ? '#5b7a5e' : 'transparent') + ';cursor:pointer;background:' + (active ? '#fff' : 'transparent') + ';color:' + (active ? '#4a4139' : '#8a7f72') + ';transition:all .15s;">' + m.icon + ' ' + m.label + '</button>';
  });
  h += '</div>';

  h += '<div style="padding:.9rem;">';
  if (sa.mode === 'orfs') { h += _clRenderOrfTab(); }
  else if (sa.mode === 'restriction') { h += _clRenderRETab(); }
  else if (sa.mode === 'digest') { h += _clRenderDigestTab(); }
  else if (sa.mode === 'scan') { h += _clRenderScanTab(); }
  else if (sa.mode === 'blast') { h += _clRenderBlastTab(); }
  else if (sa.mode === 'tools') { h += _clRenderToolsTab(); }
  h += '</div>';
  h += '</div>';
  return h;
}

/* ── ORF FINDER TAB ────────────────────────────────────────── */
function _clRenderOrfTab() {
  var o = _cl.sa.orfs;
  var h = '';
  h += '<div style="display:flex;gap:.8rem;align-items:end;margin-bottom:.7rem;flex-wrap:wrap;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Min ORF length (bp)</label>';
  h += '<input type="number" min="30" max="10000" step="10" value="' + o.minLen + '" oninput="_saOrfSetMin(this.value)" style="width:100px;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '<button onclick="_saOrfRun()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (o.loading ? 'opacity:.6;pointer-events:none;' : '') + '">' + (o.loading ? '\u23f3 Scanning\u2026' : '\ud83d\udd0d Find ORFs') + '</button>';
  if (o.result) {
    h += '<label style="display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:#8a7f72;cursor:pointer;"><input type="checkbox" ' + (o.showOnMap ? 'checked' : '') + ' onchange="_saOrfToggleMap()" /> Map overlay</label>';
  }
  h += '</div>';

  if (o.result) {
    var orfs = o.result.orfs || [];
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;">' + orfs.length + ' ORF' + (orfs.length !== 1 ? 's' : '') + ' found (\u2265' + o.minLen + ' bp)</div>';

    if (orfs.length > 0) {
      h += '<div id="cl-orf-list" style="max-height:350px;overflow-y:auto;border:1px solid #e8e2d8;border-radius:5px;">';
      var orfColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
      orfs.forEach(function(orf, idx) {
        var expanded = o.expandedOrf === idx;
        var hidden = !!o.hiddenOrfs[idx];
        var color = orfColors[idx % orfColors.length];
        h += '<div style="border-bottom:1px solid #f0ebe3;' + (hidden ? 'opacity:.45;' : '') + '">';
        // Header row
        h += '<div style="display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem;">';
        // Eye toggle
        h += '<button onclick="_saOrfToggleOne(' + idx + ')" style="padding:0;border:none;background:none;cursor:pointer;font-size:.78rem;flex-shrink:0;" title="' + (hidden ? 'Show' : 'Hide') + ' on map">' + (hidden ? '\ud83d\ude48' : '\ud83d\udc41\ufe0f') + '</button>';
        // Color dot
        h += '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + color + ';flex-shrink:0;"></span>';
        // Clickable info area to expand
        h += '<div onclick="_saOrfExpand(' + idx + ')" style="display:flex;align-items:center;gap:.5rem;flex:1;cursor:pointer;">';
        h += '<span style="font-size:.8rem;font-weight:500;color:#4a4139;min-width:70px;">' + orf.length_aa + ' aa</span>';
        h += '<span style="font-size:.72rem;color:#8a7f72;">' + orf.length_bp + ' bp</span>';
        h += '<span style="font-size:.72rem;color:#8a7f72;">Frame ' + (orf.direction === 1 ? '+' : '') + orf.frame + '</span>';
        h += '<span style="font-size:.72rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;">' + orf.start + '..' + orf.end + '</span>';
        h += '<span style="font-size:.68rem;color:#8a7f72;margin-left:auto;">' + (expanded ? '\u25b2' : '\u25bc') + '</span>';
        h += '</div>';
        h += '</div>';
        // Expanded: protein + actions
        if (expanded) {
          h += '<div style="padding:.4rem .6rem .6rem 2rem;background:#faf8f4;">';
          h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Protein sequence (' + orf.length_aa + ' aa)</div>';
          h += '<div style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.72rem;color:#4a4139;word-break:break-all;line-height:1.6;max-height:120px;overflow-y:auto;background:#fff;padding:.4rem;border:1px solid #e8e2d8;border-radius:3px;">';
          var prot = orf.protein || '';
          for (var pi = 0; pi < prot.length; pi++) {
            if (pi > 0 && pi % 10 === 0) h += ' ';
            h += prot[pi];
          }
          h += '</div>';
          h += '<div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap;">';
          h += '<button onclick="_saOrfCopyProt(' + idx + ')" style="padding:.2rem .5rem;font-size:.7rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy protein</button>';
          h += '<button onclick="_saOrfCopyDna(' + idx + ')" style="padding:.2rem .5rem;font-size:.7rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy DNA</button>';
          h += '<button onclick="_saOrfAddFeature(' + idx + ')" style="padding:.2rem .5rem;font-size:.7rem;color:#4682B4;border:1px solid #4682B4;border-radius:3px;background:#fff;cursor:pointer;">\u2795 Add as Feature</button>';
          h += '</div></div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
  }
  return h;
}

/* ── RESTRICTION ENZYME TAB ────────────────────────────────── */
function _clRenderRETab() {
  var re = _cl.sa.re;
  var h = '';
  h += '<div style="margin-bottom:.6rem;">';
  h += '<label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Enzymes (comma-separated, or blank for common set)</label>';
  h += '<input type="text" value="' + esc(re.enzymes) + '" oninput="_saReSetEnz(this.value)" placeholder="EcoRI, BamHI, HindIII\u2026 (blank = 40 common)" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.8rem;color:#4a4139;" />';
  h += '</div>';

  h += '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.7rem;flex-wrap:wrap;">';
  h += '<button onclick="_saReRun()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (re.loading ? 'opacity:.6;pointer-events:none;' : '') + '">' + (re.loading ? '\u23f3 Analyzing\u2026' : '\u2702\ufe0f Analyze') + '</button>';
  if (re.result) {
    h += '<label style="display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:#8a7f72;cursor:pointer;"><input type="checkbox" ' + (re.showOnMap ? 'checked' : '') + ' onchange="_saReToggleMap()" /> Show on map</label>';
    // Filter
    h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;margin-left:auto;">';
    ['all', '1', '2+'].forEach(function(f) {
      var label = f === 'all' ? 'All' : f === '1' ? 'Single cutters' : '2+ cuts';
      var active = re.filterCuts === f;
      h += '<button onclick="_saReFilter(\x27' + f + '\x27)" style="padding:.25rem .5rem;font-size:.68rem;border:none;cursor:pointer;' + (active ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">' + label + '</button>';
    });
    h += '</div>';
  }
  h += '</div>';

  if (re.result) {
    var r = re.result;
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;">' + r.total_cutters + ' enzymes cut \u00b7 ' + r.single_cutters + ' single cutters \u00b7 ' + r.non_cutters + ' non-cutters</div>';

    var enzymes = r.enzymes || [];
    // Apply filter
    if (re.filterCuts === '1') enzymes = enzymes.filter(function(e) { return e.num_cuts === 1; });
    else if (re.filterCuts === '2+') enzymes = enzymes.filter(function(e) { return e.num_cuts >= 2; });

    if (enzymes.length > 0) {
      h += '<div style="max-height:280px;overflow-y:auto;border:1px solid #e8e2d8;border-radius:5px;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:.76rem;">';
      h += '<thead><tr style="background:#faf8f4;position:sticky;top:0;">';
      h += '<th style="text-align:left;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Enzyme</th>';
      h += '<th style="text-align:left;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Site</th>';
      h += '<th style="text-align:center;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Cuts</th>';
      h += '<th style="text-align:left;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Positions</th>';
      h += '</tr></thead><tbody>';
      enzymes.forEach(function(e) {
        var cutColor = e.num_cuts === 1 ? '#e74c3c' : e.num_cuts === 2 ? '#f39c12' : '#8a7f72';
        h += '<tr style="border-bottom:1px solid #f0ebe3;">';
        h += '<td style="padding:.25rem .5rem;font-weight:500;color:#4a4139;">' + esc(e.name) + '</td>';
        h += '<td style="padding:.25rem .5rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;color:#8a7f72;">' + esc(e.site) + '</td>';
        h += '<td style="padding:.25rem .5rem;text-align:center;font-weight:600;color:' + cutColor + ';">' + e.num_cuts + '</td>';
        h += '<td style="padding:.25rem .5rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.68rem;color:#8a7f72;">' + e.cut_positions.join(', ') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
  }
  return h;
}

/* ── DIGEST SIMULATOR TAB ──────────────────────────────────── */
function _clRenderDigestTab() {
  var d = _cl.sa.digest;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .6rem;">Pick 1\u20133 restriction enzymes to simulate a digest. Shows expected fragment sizes and a virtual gel.</p>';

  h += '<div style="display:flex;gap:.5rem;align-items:end;margin-bottom:.7rem;flex-wrap:wrap;">';
  h += '<div style="flex:1;min-width:200px;"><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Enzymes (comma-separated)</label>';
  h += '<input type="text" value="' + esc(d.enzymes) + '" oninput="_saDigestSetEnz(this.value)" placeholder="e.g. EcoRI, BamHI" style="width:100%;box-sizing:border-box;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.8rem;color:#4a4139;" /></div>';
  h += '<button onclick="_saDigestRun()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (d.loading ? 'opacity:.6;pointer-events:none;' : '') + '">' + (d.loading ? '\u23f3 Digesting\u2026' : '\u2702\ufe0f Run Digest') + '</button>';
  h += '</div>';

  // Quick-pick from RE analysis results if available
  if (_cl.sa.re.result && _cl.sa.re.result.enzymes) {
    var singles = _cl.sa.re.result.enzymes.filter(function(e) { return e.num_cuts === 1; }).slice(0, 8);
    if (singles.length > 0) {
      h += '<div style="margin-bottom:.6rem;"><span style="font-size:.68rem;color:#8a7f72;">Quick pick (single cutters): </span>';
      singles.forEach(function(e) {
        h += '<button onclick="_saDigestQuickAdd(\x27' + esc(e.name) + '\x27)" style="padding:.15rem .4rem;font-size:.68rem;color:#4a4139;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;margin:.1rem .15rem;">' + esc(e.name) + '</button>';
      });
      h += '</div>';
    }
  }

  if (d.result) {
    var r = d.result;

    // Enzyme summary
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;">';
    r.enzymes.forEach(function(e) {
      h += esc(e.name) + ' (' + e.cuts + ' cut' + (e.cuts !== 1 ? 's' : '') + ': ' + esc(e.site) + ')  ';
    });
    h += ' \u2014 <strong style="color:#4a4139;">' + r.num_fragments + ' fragment' + (r.num_fragments !== 1 ? 's' : '') + '</strong></div>';

    // Layout: gel + fragment table side by side
    h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;">';

    // Virtual gel
    h += '<div style="width:120px;flex-shrink:0;">';
    h += '<div style="font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;text-align:center;">Virtual Gel</div>';
    h += _clRenderGel(r.fragments);
    h += '</div>';

    // Fragment table
    h += '<div style="flex:1;min-width:200px;">';
    h += '<div style="border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:.76rem;">';
    h += '<thead><tr style="background:#faf8f4;">';
    h += '<th style="text-align:center;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">#</th>';
    h += '<th style="text-align:right;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Size (bp)</th>';
    h += '<th style="text-align:left;padding:.3rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Range</th>';
    h += '</tr></thead><tbody>';
    r.fragments.forEach(function(f, i) {
      h += '<tr style="border-bottom:1px solid #f0ebe3;">';
      h += '<td style="padding:.25rem .5rem;text-align:center;color:#8a7f72;">' + (i + 1) + '</td>';
      h += '<td style="padding:.25rem .5rem;text-align:right;font-weight:500;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;">' + f.size.toLocaleString() + '</td>';
      h += '<td style="padding:.25rem .5rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;">' + f.start + '..' + f.end + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '</div>';

    h += '</div>'; // flex
  }
  return h;
}

function _clRenderGel(fragments) {
  // Simple SVG gel visualization
  var gelW = 120, gelH = 300;
  var laneW = 40, laneX = (gelW - laneW) / 2;
  // Log scale: position bands by log10(size)
  var sizes = fragments.map(function(f) { return f.size; });
  var maxLog = Math.log10(Math.max.apply(null, sizes) * 1.5);
  var minLog = Math.log10(Math.max(Math.min.apply(null, sizes) * 0.5, 10));
  var range = maxLog - minLog || 1;

  var h = '<svg width="' + gelW + '" height="' + gelH + '" style="background:#1a1a2e;border-radius:4px;display:block;">';
  // Lane background
  h += '<rect x="' + laneX + '" y="15" width="' + laneW + '" height="' + (gelH - 30) + '" fill="#1a1a3a" rx="2" />';
  // Well
  h += '<rect x="' + (laneX + 2) + '" y="12" width="' + (laneW - 4) + '" height="6" fill="#2a2a4a" rx="1" />';

  // Bands
  fragments.forEach(function(f) {
    var logSize = Math.log10(f.size);
    // Larger fragments migrate less (closer to top)
    var yFrac = 1 - (logSize - minLog) / range;
    var y = 25 + yFrac * (gelH - 55);
    // Band intensity roughly proportional to mass (size * copies, but copies = 1 each)
    var intensity = Math.min(1, f.size / (Math.max.apply(null, sizes) || 1));
    var opacity = 0.5 + intensity * 0.5;
    h += '<rect x="' + (laneX + 4) + '" y="' + Math.round(y) + '" width="' + (laneW - 8) + '" height="3" fill="rgba(0,255,100,' + opacity.toFixed(2) + ')" rx="1" />';
    // Size label
    var label = f.size >= 1000 ? (f.size / 1000).toFixed(1) + 'kb' : f.size + '';
    h += '<text x="' + (laneX + laneW + 4) + '" y="' + (Math.round(y) + 3) + '" fill="#8a9f8a" font-size="8" font-family="SF Mono,Monaco,monospace">' + label + '</text>';
  });

  // Ladder marks
  var ladder = [10000, 5000, 3000, 1500, 1000, 500, 250];
  ladder.forEach(function(sz) {
    var logSz = Math.log10(sz);
    if (logSz >= minLog && logSz <= maxLog) {
      var yFrac = 1 - (logSz - minLog) / range;
      var y = 25 + yFrac * (gelH - 55);
      h += '<line x1="' + (laneX - 2) + '" y1="' + Math.round(y) + '" x2="' + laneX + '" y2="' + Math.round(y) + '" stroke="#555" stroke-width="0.5" />';
    }
  });

  h += '</svg>';
  return h;
}

/* ── KNOWN FEATURES SCAN TAB ───────────────────────────────── */
function _clRenderScanTab() {
  var sc = _cl.sa.scan;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .6rem;">Scan for common molecular biology features: purification tags (His, FLAG, HA, Strep), protease sites (TEV, Thrombin), promoters (T7, CMV, lac), terminators, resistance markers, recombination sites (loxP, FRT, att), and more.</p>';

  h += '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.7rem;flex-wrap:wrap;">';
  h += '<button onclick="_saScanRun()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (sc.loading ? 'opacity:.6;pointer-events:none;' : '') + '">' + (sc.loading ? '\u23f3 Scanning\u2026' : '\ud83d\udd2c Scan Sequence') + '</button>';
  if (sc.result) {
    h += '<label style="display:flex;align-items:center;gap:.3rem;font-size:.75rem;color:#8a7f72;cursor:pointer;"><input type="checkbox" ' + (sc.showOnMap ? 'checked' : '') + ' onchange="_saScanToggleMap()" /> Show on map</label>';
  }
  h += '</div>';

  if (sc.result) {
    var r = sc.result;
    var features = r.features || [];

    // Category summary
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;"><strong style="color:#4a4139;">' + r.count + '</strong> known feature' + (r.count !== 1 ? 's' : '') + ' found</div>';

    if (r.categories && Object.keys(r.categories).length > 0) {
      h += '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.6rem;">';
      var cats = Object.keys(r.categories);
      h += '<button onclick="_saScanFilter(\x27all\x27)" style="padding:.2rem .5rem;font-size:.68rem;border:1px solid #d5cec0;border-radius:3px;cursor:pointer;' + (sc.filterCat === 'all' ? 'background:#5b7a5e;color:#fff;border-color:#5b7a5e;' : 'background:#fff;color:#4a4139;') + '">All (' + r.count + ')</button>';
      cats.forEach(function(cat) {
        var active = sc.filterCat === cat;
        h += '<button onclick="_saScanFilter(\x27' + esc(cat).replace(/'/g, '\\x27') + '\x27)" style="padding:.2rem .5rem;font-size:.68rem;border:1px solid #d5cec0;border-radius:3px;cursor:pointer;' + (active ? 'background:#5b7a5e;color:#fff;border-color:#5b7a5e;' : 'background:#fff;color:#4a4139;') + '">' + esc(cat) + ' (' + r.categories[cat] + ')</button>';
      });
      h += '</div>';
    }

    // Filter
    var filtered = features;
    if (sc.filterCat !== 'all') {
      filtered = features.filter(function(f) { return f.category === sc.filterCat; });
    }

    if (filtered.length > 0) {
      h += '<div style="max-height:300px;overflow-y:auto;border:1px solid #e8e2d8;border-radius:5px;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:.76rem;">';
      h += '<thead><tr style="background:#faf8f4;position:sticky;top:0;">';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;width:22px;"></th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Feature</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Category</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Location</th>';
      h += '<th style="text-align:left;padding:.25rem .5rem;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Strand</th>';
      h += '<th style="text-align:center;padding:.25rem .3rem;font-size:.64rem;width:40px;"></th>';
      h += '</tr></thead><tbody>';
      filtered.forEach(function(f, i) {
        // Find original index for add-as-feature
        var origIdx = features.indexOf(f);
        h += '<tr style="border-bottom:1px solid #f0ebe3;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27transparent\x27">';
        h += '<td style="padding:.2rem .3rem;text-align:center;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + esc(f.color) + ';"></span></td>';
        h += '<td style="padding:.2rem .5rem;font-weight:500;color:#4a4139;">' + esc(f.name) + '</td>';
        h += '<td style="padding:.2rem .5rem;font-size:.7rem;color:#8a7f72;">' + esc(f.category) + '</td>';
        h += '<td style="padding:.2rem .5rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;color:#8a7f72;">' + f.start + '..' + f.end + '</td>';
        h += '<td style="padding:.2rem .5rem;color:#8a7f72;">' + (f.direction === 1 ? '\u2192 fwd' : '\u2190 rc') + '</td>';
        h += '<td style="padding:.2rem .3rem;text-align:center;">';
        h += '<button onclick="_saScanAddFeature(' + origIdx + ')" style="padding:.1rem .35rem;font-size:.66rem;color:#4682B4;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;" title="Add as annotation">\u2795</button>';
        h += '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<div style="padding:1rem;text-align:center;color:#8a7f72;font-size:.82rem;">No features in this category.</div>';
    }
  }
  return h;
}

/* ── BLAST TAB ─────────────────────────────────────────────── */
function _clRenderBlastTab() {
  var b = _cl.sa.blast;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .6rem;">Search NCBI databases. <strong style="color:#5b7a5e;">Drag on the map</strong> to auto-fill, or paste a sequence. BLAST queries typically take 30\u2013120 seconds.</p>';

  h += '<textarea id="cl-sa-blast-input" oninput="_saBlastSetSeq(this.value)" placeholder="Paste or select a DNA/protein sequence\u2026" style="width:100%;box-sizing:border-box;padding:.45rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;min-height:50px;resize:vertical;line-height:1.5;">' + esc(b.seq) + '</textarea>';

  var cleanLen = _clCleanSeq(b.seq).length;
  if (cleanLen > 0) {
    h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.2rem;">' + cleanLen + ' bp</div>';
  }

  h += '<div style="display:flex;gap:.5rem;align-items:end;margin-top:.5rem;margin-bottom:.3rem;flex-wrap:wrap;">';
  // Program
  h += '<div><label style="display:block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Program</label>';
  h += '<select onchange="_saBlastSet(\x27program\x27,this.value)" style="padding:.35rem .4rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;">';
  ['blastn', 'blastp', 'blastx', 'tblastn', 'tblastx'].forEach(function(p) {
    h += '<option value="' + p + '"' + (b.program === p ? ' selected' : '') + '>' + p + '</option>';
  });
  h += '</select></div>';
  // Database
  h += '<div><label style="display:block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Database</label>';
  h += '<select onchange="_saBlastSet(\x27database\x27,this.value)" style="padding:.35rem .4rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;">';
  var dbs = [
    { v: 'nt', l: 'nt (nucleotide)' }, { v: 'nr', l: 'nr (protein)' },
    { v: 'swissprot', l: 'SwissProt' }, { v: 'refseq_rna', l: 'RefSeq RNA' },
    { v: 'refseq_protein', l: 'RefSeq Protein' }, { v: 'pdb', l: 'PDB' },
  ];
  dbs.forEach(function(db) {
    h += '<option value="' + db.v + '"' + (b.database === db.v ? ' selected' : '') + '>' + db.l + '</option>';
  });
  h += '</select></div>';
  // Max hits
  h += '<div><label style="display:block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Max Hits</label>';
  h += '<input type="number" min="1" max="50" value="' + b.maxHits + '" onchange="_saBlastSet(\x27maxHits\x27,this.value)" style="width:60px;padding:.35rem .4rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;" /></div>';

  h += '<button onclick="_saBlastRun()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (b.loading ? 'opacity:.6;pointer-events:none;' : '') + '">' + (b.loading ? '\u23f3 Searching NCBI\u2026' : '\ud83c\udf10 Run BLAST') + '</button>';
  h += '</div>';

  if (b.loading) {
    h += '<div style="padding:1.5rem;text-align:center;color:#8a7f72;font-size:.82rem;">';
    h += '<div style="font-size:1.5rem;margin-bottom:.4rem;">\u23f3</div>';
    h += 'Querying NCBI BLAST\u2026 this usually takes 30\u2013120 seconds.<br>';
    h += '<span style="font-size:.72rem;">Do not close or navigate away.</span>';
    h += '</div>';
  }

  if (b.result) {
    var r = b.result;
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-top:.6rem;margin-bottom:.5rem;"><strong style="color:#4a4139;">' + r.num_hits + ' hit' + (r.num_hits !== 1 ? 's' : '') + '</strong> found \u2014 ' + r.program + ' vs ' + r.database + ' (' + r.query_length + ' bp query)</div>';

    if (r.hits.length > 0) {
      h += '<div style="max-height:350px;overflow-y:auto;border:1px solid #e8e2d8;border-radius:5px;">';
      r.hits.forEach(function(hit, idx) {
        var expanded = b.expandedHit === idx;
        var pctColor = hit.identity_pct >= 95 ? '#27ae60' : hit.identity_pct >= 80 ? '#f39c12' : '#e74c3c';
        h += '<div style="border-bottom:1px solid #f0ebe3;">';
        // Header
        h += '<div onclick="_saBlastExpand(' + idx + ')" style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;cursor:pointer;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27transparent\x27">';
        h += '<span style="font-size:.75rem;font-weight:600;color:' + pctColor + ';min-width:42px;">' + hit.identity_pct + '%</span>';
        h += '<span style="font-size:.72rem;color:#4a4139;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(hit.title.substring(0, 100)) + '</span>';
        h += '<span style="font-size:.68rem;color:#8a7f72;white-space:nowrap;">E=' + hit.evalue + '</span>';
        h += '<span style="font-size:.68rem;color:#8a7f72;">' + (expanded ? '\u25b2' : '\u25bc') + '</span>';
        h += '</div>';
        // Expanded: alignment
        if (expanded) {
          h += '<div style="padding:.4rem .6rem .6rem 1rem;background:#faf8f4;font-size:.72rem;">';
          h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:.4rem;color:#8a7f72;">';
          h += '<span>Accession: <strong style="color:#4a4139;">' + esc(hit.accession) + '</strong></span>';
          h += '<span>Score: ' + hit.bits + ' bits</span>';
          h += '<span>Identity: ' + hit.identity + '</span>';
          h += '<span>Gaps: ' + hit.gaps + '</span>';
          h += '<span>Strand: ' + esc(hit.strand) + '</span>';
          h += '<span>Subject len: ' + hit.length.toLocaleString() + '</span>';
          h += '</div>';
          h += '<div style="font-size:.65rem;color:#8a7f72;margin-bottom:.2rem;">Query ' + hit.query_start + '-' + hit.query_end + ' \u21c4 Subject ' + hit.subject_start + '-' + hit.subject_end + '</div>';
          // Alignment
          h += '<div style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.68rem;line-height:1.5;background:#fff;padding:.4rem;border:1px solid #e8e2d8;border-radius:3px;overflow-x:auto;white-space:pre;">';
          h += 'Query  ' + esc(hit.query_seq.substring(0, 80)) + '\n';
          h += '       ' + esc(hit.match_seq.substring(0, 80)) + '\n';
          h += 'Sbjct  ' + esc(hit.subject_seq.substring(0, 80));
          if (hit.query_seq.length > 80) h += '\n       \u2026';
          h += '</div>';
          h += '<div style="margin-top:.3rem;"><a href="https://www.ncbi.nlm.nih.gov/nucleotide/' + esc(hit.accession) + '" target="_blank" style="font-size:.7rem;color:#5b7a5e;">View on NCBI \u2197</a></div>';
          h += '</div>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
  }
  return h;
}

/* ── SEQUENCE TOOLS TAB ────────────────────────────────────── */
function _clRenderToolsTab() {
  var t = _cl.sa.tools;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .6rem;">Paste or type a sequence, then apply an operation. Or select a region in the viewer above — it will auto-fill here.</p>';

  h += '<textarea id="cl-sa-tools-input" oninput="_saToolsInput(this.value)" placeholder="Paste DNA sequence\u2026" style="width:100%;box-sizing:border-box;padding:.45rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.78rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;min-height:50px;resize:vertical;line-height:1.5;">' + esc(t.input) + '</textarea>';

  var cleanLen = _clCleanSeq(t.input).length;
  if (cleanLen > 0) {
    h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.2rem;">' + cleanLen + ' bp</div>';
  }

  h += '<div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap;">';
  h += '<button onclick="_saToolsRun(\x27rc\x27)" style="padding:.4rem .7rem;font-size:.78rem;background:#4682B4;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reverse Complement</button>';
  h += '<button onclick="_saToolsRun(\x27complement\x27)" style="padding:.4rem .7rem;font-size:.78rem;background:#8E44AD;color:#fff;border:none;border-radius:4px;cursor:pointer;">Complement</button>';
  h += '<button onclick="_saToolsRun(\x27reverse\x27)" style="padding:.4rem .7rem;font-size:.78rem;background:#e67e22;color:#fff;border:none;border-radius:4px;cursor:pointer;">Reverse</button>';
  h += '<button onclick="_saToolsRun(\x27translate\x27)" style="padding:.4rem .7rem;font-size:.78rem;background:#2ecc71;color:#fff;border:none;border-radius:4px;cursor:pointer;">Translate</button>';
  h += '<button onclick="_saToolsTm()" style="padding:.4rem .7rem;font-size:.78rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:#fff;cursor:pointer;">\ud83c\udf21 Tm</button>';
  h += '</div>';

  if (t.result) {
    h += '<div style="margin-top:.7rem;border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.35rem .6rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;">';
    h += '<span style="font-size:.72rem;font-weight:600;color:#4a4139;">' + esc(t.lastOp) + '</span>';
    h += '<button onclick="_saToolsCopy()" style="padding:.2rem .45rem;font-size:.68rem;color:#5b7a5e;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">Copy</button>';
    h += '</div>';
    h += '<div style="padding:.5rem .6rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.76rem;color:#4a4139;word-break:break-all;line-height:1.6;max-height:150px;overflow-y:auto;">' + esc(t.result) + '</div>';
    h += '</div>';
  }
  return h;
}

/* ── Analysis action handlers ──────────────────────────────── */
function _saToggle() { _cl.sa.expanded = !_cl.sa.expanded; _clRender(); }
function _saSetMode(m) { _cl.sa.mode = m; _clRender(); }

// ORFs
function _saOrfSetMin(val) { _cl.sa.orfs.minLen = parseInt(val, 10) || 100; }
function _saOrfRun() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var o = _cl.sa.orfs;
  o.loading = true; o.result = null; o.hiddenOrfs = {}; o.expandedOrf = null; _clRender();
  api('POST', '/api/cloning/find-orfs', {
    seq: _cl.parsed.seq, min_length: o.minLen,
    circular: (_cl.parsed.topology || '').toLowerCase() === 'circular',
  }).then(function(data) {
    o.loading = false; o.result = data;
    o.hiddenOrfs = {}; // Start with all visible
    _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 80);
  }).catch(function(err) { o.loading = false; toast('ORF search failed: ' + (err.message || err), true); _clRender(); });
}
function _saOrfToggleMap() {
  _cl.sa.orfs.showOnMap = !_cl.sa.orfs.showOnMap;
  _cl.sa.orfs.hiddenOrfs = {}; // Reset individual visibility
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 80);
}
function _saOrfExpand(idx) {
  _cl.sa.orfs.expandedOrf = _cl.sa.orfs.expandedOrf === idx ? null : idx;
  _clRenderKeepScroll('cl-orf-list');
}
function _saOrfCopyProt(idx) {
  var orfs = (_cl.sa.orfs.result || {}).orfs || [];
  if (orfs[idx]) { navigator.clipboard.writeText(orfs[idx].protein).then(function() { toast('Protein copied'); }); }
}
function _saOrfCopyDna(idx) {
  if (!_cl.parsed) return;
  var orfs = (_cl.sa.orfs.result || {}).orfs || [];
  var o = orfs[idx];
  if (!o) return;
  var seq = _cl.parsed.seq;
  var dna = o.start < o.end ? seq.substring(o.start, o.end) : seq.substring(o.start) + seq.substring(0, o.end);
  if (o.direction === -1) dna = _clRcSeq(dna);
  navigator.clipboard.writeText(dna).then(function() { toast('DNA copied (' + dna.length + ' bp)'); });
}

// Simple client-side RC for copy
function _clRcSeq(s) {
  var comp = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N', a: 't', t: 'a', g: 'c', c: 'g' };
  return s.split('').reverse().map(function(b) { return comp[b] || 'N'; }).join('');
}

// Toggle individual ORF on/off the map
function _saOrfToggleOne(idx) {
  if (_cl.sa.orfs.hiddenOrfs[idx]) {
    delete _cl.sa.orfs.hiddenOrfs[idx];
  } else {
    _cl.sa.orfs.hiddenOrfs[idx] = true;
  }
  // Save scroll, re-render list only, then explicitly refresh SeqViz
  var listEl = document.getElementById('cl-orf-list');
  var scrollY = listEl ? listEl.scrollTop : 0;
  _clRender();
  setTimeout(function() {
    var listEl2 = document.getElementById('cl-orf-list');
    if (listEl2) listEl2.scrollTop = scrollY;
    _clRenderSeqViz();
  }, 80);
}

// Render helper that preserves scroll position of a container
function _clRenderKeepScroll(containerId) {
  var el = document.getElementById(containerId);
  var scrollTop = el ? el.scrollTop : 0;
  _clRender();
  setTimeout(function() {
    var el2 = document.getElementById(containerId);
    if (el2) el2.scrollTop = scrollTop;
  }, 10);
}

// Add an ORF as a feature/annotation
function _saOrfAddFeature(idx) {
  var orfs = (_cl.sa.orfs.result || {}).orfs || [];
  var orf = orfs[idx];
  if (!orf || !_cl.parsed) return;
  var orfColors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
  var color = orfColors[idx % orfColors.length];
  var name = prompt('Feature name:', 'ORF ' + orf.length_aa + 'aa (frame ' + (orf.direction === 1 ? '+' : '') + orf.frame + ')');
  if (!name) return;
  if (!_cl.parsed.annotations) _cl.parsed.annotations = [];
  _cl.parsed.annotations.push({
    name: name,
    start: orf.start,
    end: orf.end,
    direction: orf.direction,
    color: color,
    type: 'CDS',
  });
  _cl.featuresDirty = true;
  _cl.featuresOpen = true;
  toast('Added "' + name + '" as CDS feature');
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

// Add any feature from stash (used by primer cards, etc.)
function _clAddAsFeature(stashIdx) {
  var feat = (window._featStash || [])[stashIdx];
  if (!feat || !_cl.parsed) return;
  var name = prompt('Feature name:', feat.name || 'feature');
  if (!name) return;
  if (!_cl.parsed.annotations) _cl.parsed.annotations = [];
  _cl.parsed.annotations.push({
    name: name,
    start: feat.start,
    end: feat.end,
    direction: feat.direction || 1,
    color: feat.color || '#E67E22',
    type: feat.type || 'primer_bind',
  });
  _cl.featuresDirty = true;
  _cl.featuresOpen = true;
  toast('Added "' + name + '" as ' + (feat.type || 'primer_bind') + ' feature');
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

// RE
function _saReSetEnz(val) { _cl.sa.re.enzymes = val; }
function _saReRun() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var re = _cl.sa.re;
  re.loading = true; re.result = null; _clRender();
  var enzList = re.enzymes ? re.enzymes.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : null;
  api('POST', '/api/cloning/restriction-analysis', {
    seq: _cl.parsed.seq, enzymes: enzList,
    circular: (_cl.parsed.topology || '').toLowerCase() === 'circular',
  }).then(function(data) {
    re.loading = false; re.result = data; _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) { re.loading = false; toast('RE analysis failed: ' + (err.message || err), true); _clRender(); });
}
function _saReToggleMap() { _cl.sa.re.showOnMap = !_cl.sa.re.showOnMap; _clRender(); setTimeout(function() { _clRenderSeqViz(); }, 50); }
function _saReFilter(f) { _cl.sa.re.filterCuts = f; _clRender(); }

// Digest
function _saDigestSetEnz(val) { _cl.sa.digest.enzymes = val; }
function _saDigestQuickAdd(name) {
  var cur = _cl.sa.digest.enzymes;
  var list = cur ? cur.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  if (list.indexOf(name) === -1) {
    list.push(name);
    _cl.sa.digest.enzymes = list.join(', ');
    _clRender();
  }
}
function _saDigestRun() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var d = _cl.sa.digest;
  var enzList = d.enzymes ? d.enzymes.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  if (enzList.length < 1) { toast('Enter at least one enzyme', true); return; }
  if (enzList.length > 3) { toast('Maximum 3 enzymes', true); return; }
  d.loading = true; d.result = null; _clRender();
  api('POST', '/api/cloning/digest', {
    seq: _cl.parsed.seq, enzymes: enzList,
    circular: (_cl.parsed.topology || '').toLowerCase() === 'circular',
  }).then(function(data) {
    d.loading = false; d.result = data; _clRender();
  }).catch(function(err) { d.loading = false; toast('Digest failed: ' + (err.message || err), true); _clRender(); });
}

// BLAST
function _saBlastSetSeq(val) { _cl.sa.blast.seq = val; }
function _saBlastSet(field, val) {
  if (field === 'maxHits') _cl.sa.blast.maxHits = parseInt(val, 10) || 10;
  else _cl.sa.blast[field] = val;
}
function _saBlastExpand(idx) { _cl.sa.blast.expandedHit = _cl.sa.blast.expandedHit === idx ? null : idx; _clRender(); }
function _saBlastRun() {
  var b = _cl.sa.blast;
  var seq = _clCleanSeq(b.seq);
  if (seq.length < 10) { toast('Sequence too short (min 10bp)', true); return; }
  if (seq.length > 10000) { toast('Sequence too long for web BLAST (max 10,000bp)', true); return; }
  b.loading = true; b.result = null; b.expandedHit = null; _clRender();
  api('POST', '/api/cloning/blast', {
    seq: seq, program: b.program, database: b.database, max_hits: b.maxHits,
  }).then(function(data) {
    b.loading = false; b.result = data; _clRender();
  }).catch(function(err) {
    b.loading = false;
    toast('BLAST failed: ' + (err.message || err), true);
    _clRender();
  });
}

// Known features scan
function _saScanRun() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var sc = _cl.sa.scan;
  sc.loading = true; sc.result = null; sc.filterCat = 'all'; _clRender();
  api('POST', '/api/cloning/scan-features', {
    seq: _cl.parsed.seq,
    circular: (_cl.parsed.topology || '').toLowerCase() === 'circular',
  }).then(function(data) {
    sc.loading = false; sc.result = data; _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 80);
  }).catch(function(err) { sc.loading = false; toast('Scan failed: ' + (err.message || err), true); _clRender(); });
}
function _saScanToggleMap() {
  _cl.sa.scan.showOnMap = !_cl.sa.scan.showOnMap;
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 80);
}
function _saScanFilter(cat) { _cl.sa.scan.filterCat = cat; _clRender(); }
function _saScanAddFeature(idx) {
  var features = (_cl.sa.scan.result || {}).features || [];
  var f = features[idx];
  if (!f || !_cl.parsed) return;
  var name = prompt('Feature name:', f.name);
  if (!name) return;
  if (!_cl.parsed.annotations) _cl.parsed.annotations = [];
  _cl.parsed.annotations.push({
    name: name, start: f.start, end: f.end,
    direction: f.direction, color: f.color, type: f.type,
  });
  _cl.featuresDirty = true;
  _cl.featuresOpen = true;
  toast('Added "' + name + '" as ' + f.type + ' feature');
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 80);
}

// Seq tools
function _saToolsInput(val) { _cl.sa.tools.input = val; }
function _saToolsRun(op) {
  var seq = _clCleanSeq(_cl.sa.tools.input);
  if (!seq) { toast('Enter a sequence first', true); return; }
  var labels = { rc: 'Reverse Complement', complement: 'Complement', reverse: 'Reverse', translate: 'Translation' };
  api('POST', '/api/cloning/seq-tool', { seq: seq, operation: op })
    .then(function(data) {
      _cl.sa.tools.result = data.result;
      _cl.sa.tools.lastOp = labels[op] || op;
      _clRender();
      // Keep textarea focused
      var ta = document.getElementById('cl-sa-tools-input');
      if (ta) ta.focus();
    }).catch(function(err) { toast('Error: ' + (err.message || err), true); });
}
function _saToolsTm() {
  var seq = _clCleanSeq(_cl.sa.tools.input);
  if (!seq) { toast('Enter a sequence first', true); return; }
  api('POST', '/api/cloning/tm-calc', { seq: seq })
    .then(function(data) {
      _cl.sa.tools.result = 'Tm: ' + data.tm + '\u00b0C  |  GC: ' + data.gc_percent + '%  |  Length: ' + data.length + ' bp';
      _cl.sa.tools.lastOp = 'Tm Calculator';
      _clRender();
    }).catch(function(err) { toast('Error: ' + (err.message || err), true); });
}
function _saToolsCopy() {
  if (_cl.sa.tools.result) { navigator.clipboard.writeText(_cl.sa.tools.result).then(function() { toast('Copied'); }); }
}

/* ── global actions ────────────────────────────────────────── */
function _clSetTab(tab) { _cl.tab = tab; _clRender(); }
function _clToggleView(which) {
  if (which === 'circular') _cl.showCircular = !_cl.showCircular;
  else _cl.showLinear = !_cl.showLinear;
  // Ensure at least one is visible
  if (!_cl.showCircular && !_cl.showLinear) {
    if (which === 'circular') _cl.showLinear = true;
    else _cl.showCircular = true;
  }
  _clRender();
}
function _clFilterChange(val) { _cl.filter = val; _clRender(); }
function _clOcFilterChange(val) { _cl.ocFilter = val; _clRender(); }
function _clToggleSidebar() { _cl.sidebarOpen = !_cl.sidebarOpen; _clRender(); }
function _clToggleOcSidebar() { _cl.ocSidebarOpen = !_cl.ocSidebarOpen; _clRender(); }
function _clToggleFeatures() { _cl.featuresOpen = !_cl.featuresOpen; _clRender(); }

/* ── Reindex origin ───────────────────────────────────────── */
function _clReindex() {
  if (!_cl.parsed || !_cl.selected) { toast('No sequence loaded', true); return; }
  if ((_cl.parsed.topology || '').toLowerCase() !== 'circular') { toast('Reindex only works on circular sequences', true); return; }

  var sel = _cl.lastSelection || { start: 0, end: 0 };
  var defaultPos = sel.start > 0 ? sel.start : 0;
  var input = prompt('Enter new origin position (current selection start: ' + defaultPos + '):', String(defaultPos));
  if (input === null) return;
  var newOrigin = parseInt(input, 10);
  if (isNaN(newOrigin) || newOrigin < 0 || newOrigin >= _cl.parsed.length) {
    toast('Invalid position (0\u2013' + (_cl.parsed.length - 1) + ')', true);
    return;
  }
  if (newOrigin === 0) { toast('Already at origin 0', false); return; }

  _cl.loading = true;
  _clRender();
  api('POST', '/api/cloning/sequences/' + _cl.selected.type + '/' + _cl.selected.id + '/reindex', {
    new_origin: newOrigin,
  }).then(function(data) {
    _cl.parsed = data;
    _cl.loading = false;
    _cl.lastSelection = { start: 0, end: 0 };
    toast('Origin moved to position ' + newOrigin + ' \u2014 sequence reindexed');
    _clRender();
    setTimeout(function() { _clRenderSeqViz(); }, 50);
  }).catch(function(err) {
    _cl.loading = false;
    toast('Reindex failed: ' + (err.message || err), true);
    _clRender();
  });
}

/* ── Sequence search (forward + reverse complement) ──────── */
function _clSearchToggle() {
  _cl.search.open = !_cl.search.open;
  if (!_cl.search.open) {
    _cl.search.query = '';
    _cl.search.results = null;
    _cl.search.activeIdx = 0;
  }
  _clRender();
  if (_cl.search.open) {
    setTimeout(function() {
      var el = document.getElementById('cl-search-input');
      if (el) el.focus();
    }, 50);
  }
  setTimeout(function() { _clRenderSeqViz(); }, 60);
}

function _clSearchRun(query) {
  _cl.search.query = query;
  var q = query.toUpperCase().replace(/[^ATGCN]/g, '');
  if (q.length < 3) {
    _cl.search.results = null;
    _cl.search.activeIdx = 0;
    _clRender();
    return;
  }
  if (!_cl.parsed || !_cl.parsed.seq) return;

  var seq = _cl.parsed.seq.toUpperCase();
  var results = [];

  // Search forward strand
  var pos = 0;
  while (true) {
    var idx = seq.indexOf(q, pos);
    if (idx === -1) break;
    results.push({ start: idx, end: idx + q.length, strand: 'fwd', pos: idx });
    pos = idx + 1;
  }

  // RC the query and search forward strand (finds reverse complement matches)
  var rcQ = _clRcSeq(q);
  if (rcQ !== q) { // avoid duplicate matches for palindromes
    pos = 0;
    while (true) {
      var idx2 = seq.indexOf(rcQ, pos);
      if (idx2 === -1) break;
      results.push({ start: idx2, end: idx2 + rcQ.length, strand: 'rc', pos: idx2 });
      pos = idx2 + 1;
    }
  }

  // Sort by position
  results.sort(function(a, b) { return a.start - b.start; });

  _cl.search.results = results;
  _cl.search.activeIdx = 0;
  _clRender();
  setTimeout(function() {
    var el = document.getElementById('cl-search-input');
    if (el) { el.focus(); el.setSelectionRange(query.length, query.length); }
    _clRenderSeqViz();
  }, 30);
}

function _clSearchNext() {
  if (!_cl.search.results || _cl.search.results.length === 0) return;
  _cl.search.activeIdx = (_cl.search.activeIdx + 1) % _cl.search.results.length;
  _clRender();
  setTimeout(function() {
    var el = document.getElementById('cl-search-input');
    if (el) el.focus();
    _clRenderSeqViz();
  }, 30);
}

function _clSearchPrev() {
  if (!_cl.search.results || _cl.search.results.length === 0) return;
  _cl.search.activeIdx = (_cl.search.activeIdx - 1 + _cl.search.results.length) % _cl.search.results.length;
  _clRender();
  setTimeout(function() {
    var el = document.getElementById('cl-search-input');
    if (el) el.focus();
    _clRenderSeqViz();
  }, 30);
}

/* ── Feature editor functions ──────────────────────────────── */
var _featureTypes = ['CDS', 'gene', 'promoter', 'terminator', 'rep_origin', 'primer_bind', 'misc_feature', 'regulatory', 'protein_bind', 'RBS', 'enhancer', 'polyA_signal', 'sig_peptide'];

// Draggable panel position (persists across re-renders)
var _featPanelPos = { x: -1, y: -1 };

function _clRenderFeaturePanel() {
  var isNew = _cl.editFeature === 'new';
  var a;
  if (isNew) {
    // Auto-fill from last SeqViz selection
    var ls = _cl.lastSelection || { start: 0, end: 0 };
    var useSelection = ls.end > ls.start;
    a = { name: '', type: 'misc_feature', start: useSelection ? ls.start : 0, end: useSelection ? ls.end : 100, direction: 1, color: '#95A5A6' };
  } else {
    a = (_cl.parsed.annotations[_cl.editFeature] || null);
  }
  if (!a) return '';

  // Default position: top-right of viewport
  if (_featPanelPos.x < 0) { _featPanelPos.x = Math.max(20, window.innerWidth - 420); _featPanelPos.y = 80; }

  var h = '';
  h += '<div id="cl-feat-panel" style="position:fixed;z-index:1000;left:' + _featPanelPos.x + 'px;top:' + _featPanelPos.y + 'px;width:360px;max-width:90vw;background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.2);">';

  // Drag handle / title bar
  h += '<div id="cl-feat-drag" style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .8rem;cursor:move;background:#f0ebe3;border-radius:8px 8px 0 0;border-bottom:1px solid #d5cec0;user-select:none;">';
  h += '<span style="font-size:.82rem;font-weight:600;color:#4a4139;">' + (isNew ? '\u2795 Add Feature' : '\u270f\ufe0f Edit Feature') + '</span>';
  h += '<button onclick="_clFeatModalClose()" style="padding:.1rem .35rem;font-size:.8rem;border:none;background:none;color:#8a7f72;cursor:pointer;" title="Close">\u2715</button>';
  h += '</div>';

  h += '<div style="padding:.8rem;">';

  // Name
  h += '<div style="margin-bottom:.5rem;"><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Name</label>';
  h += '<input id="cl-feat-name" type="text" value="' + esc(a.name) + '" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.82rem;color:#4a4139;" /></div>';

  // Type + Color
  h += '<div style="display:grid;grid-template-columns:1fr auto;gap:.5rem;margin-bottom:.5rem;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Type</label>';
  h += '<select id="cl-feat-type" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.8rem;color:#4a4139;">';
  _featureTypes.forEach(function(t) {
    h += '<option value="' + t + '"' + (a.type === t ? ' selected' : '') + '>' + t + '</option>';
  });
  h += '</select></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Color</label>';
  h += '<input id="cl-feat-color" type="color" value="' + esc(a.color || '#95A5A6') + '" style="width:40px;height:30px;border:1px solid #d5cec0;border-radius:4px;padding:0;cursor:pointer;" /></div>';
  h += '</div>';

  // Start + End + Direction
  h += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.5rem;margin-bottom:.5rem;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Start</label>';
  h += '<input id="cl-feat-start" type="number" min="0" value="' + a.start + '" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">End</label>';
  h += '<input id="cl-feat-end" type="number" min="0" value="' + a.end + '" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.82rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.2rem;">Dir</label>';
  h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;">';
  h += '<button onclick="_clFeatSetDir(1)" id="cl-feat-dir-fwd" style="padding:.35rem .55rem;font-size:.8rem;border:none;cursor:pointer;' + (a.direction === 1 ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">\u2192</button>';
  h += '<button onclick="_clFeatSetDir(-1)" id="cl-feat-dir-rev" style="padding:.35rem .55rem;font-size:.8rem;border:none;cursor:pointer;' + (a.direction === -1 ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') + '">\u2190</button>';
  h += '</div></div>';
  h += '</div>';

  // Hint
  if (isNew) {
    h += '<div style="font-size:.7rem;color:#8a7f72;margin-bottom:.5rem;font-style:italic;">Drag-select on the map to update start/end positions.</div>';
  }

  // Buttons
  h += '<div style="display:flex;gap:.4rem;justify-content:flex-end;">';
  h += '<button onclick="_clFeatModalClose()" style="padding:.35rem .7rem;font-size:.78rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:4px;background:#fff;cursor:pointer;">Cancel</button>';
  h += '<button onclick="_clFeatModalSave()" style="padding:.35rem .7rem;font-size:.78rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;">' + (isNew ? 'Add' : 'Save') + '</button>';
  h += '</div>';

  h += '</div>'; // padding
  h += '</div>'; // panel
  return h;
}

// Direction toggle for the feature panel
var _featEditDir = 1;
function _clFeatSetDir(dir) {
  _featEditDir = dir;
  var fwd = document.getElementById('cl-feat-dir-fwd');
  var rev = document.getElementById('cl-feat-dir-rev');
  if (fwd) fwd.style.cssText = 'padding:.35rem .55rem;font-size:.8rem;border:none;cursor:pointer;' + (dir === 1 ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;');
  if (rev) rev.style.cssText = 'padding:.35rem .55rem;font-size:.8rem;border:none;cursor:pointer;' + (dir === -1 ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;');
}

// Drag logic — init after render
function _clInitFeatDrag() {
  var panel = document.getElementById('cl-feat-panel');
  var handle = document.getElementById('cl-feat-drag');
  if (!panel || !handle) return;
  var dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
  handle.addEventListener('mousedown', function(e) {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    origX = panel.offsetLeft; origY = panel.offsetTop;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    var nx = origX + dx, ny = origY + dy;
    // Clamp to viewport
    nx = Math.max(0, Math.min(nx, window.innerWidth - 100));
    ny = Math.max(0, Math.min(ny, window.innerHeight - 50));
    panel.style.left = nx + 'px';
    panel.style.top = ny + 'px';
    _featPanelPos.x = nx;
    _featPanelPos.y = ny;
  });
  document.addEventListener('mouseup', function() { dragging = false; });
}

function _clFeatColor(idx, color) {
  if (!_cl.parsed || !_cl.parsed.annotations[idx]) return;
  _cl.parsed.annotations[idx].color = color;
  _cl.featuresDirty = true;
  // Don't full re-render (would lose color picker focus), just update SeqViz
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

function _clFeatDir(idx) {
  if (!_cl.parsed || !_cl.parsed.annotations[idx]) return;
  _cl.parsed.annotations[idx].direction = _cl.parsed.annotations[idx].direction === 1 ? -1 : 1;
  _cl.featuresDirty = true;
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

function _clFeatEdit(idx) {
  _cl.editFeature = idx;
  var a = (_cl.parsed && _cl.parsed.annotations) ? _cl.parsed.annotations[idx] : null;
  _featEditDir = a ? a.direction : 1;
  _clRender();
  setTimeout(_clInitFeatDrag, 30);
}

function _clFeatAdd() {
  _cl.editFeature = 'new';
  _featEditDir = 1;
  _clRender();
  setTimeout(_clInitFeatDrag, 30);
}

function _clFeatRemove(idx) {
  if (!_cl.parsed || !_cl.parsed.annotations[idx]) return;
  var name = _cl.parsed.annotations[idx].name;
  if (!confirm('Remove feature "' + name + '"?')) return;
  _cl.parsed.annotations.splice(idx, 1);
  _cl.featuresDirty = true;
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

function _clFeatModalClose() {
  _cl.editFeature = null;
  _clRender();
}

function _clFeatModalSave() {
  var name = (document.getElementById('cl-feat-name') || {}).value || 'feature';
  var type = (document.getElementById('cl-feat-type') || {}).value || 'misc_feature';
  var color = (document.getElementById('cl-feat-color') || {}).value || '#95A5A6';
  var start = parseInt((document.getElementById('cl-feat-start') || {}).value, 10) || 0;
  var end = parseInt((document.getElementById('cl-feat-end') || {}).value, 10) || 0;
  var direction = _featEditDir || 1;

  if (start >= end) { toast('Start must be less than end', true); return; }

  var feat = { name: name, type: type, color: color, start: start, end: end, direction: direction };

  if (_cl.editFeature === 'new') {
    if (!_cl.parsed.annotations) _cl.parsed.annotations = [];
    _cl.parsed.annotations.push(feat);
  } else {
    _cl.parsed.annotations[_cl.editFeature] = feat;
  }

  _cl.featuresDirty = true;
  _cl.editFeature = null;
  _clRender();
  setTimeout(function() { _clRenderSeqViz(); }, 50);
}

function _clFeatRevert() {
  if (!_cl.selected) return;
  _cl.featuresDirty = false;
  _cl.editFeature = null;
  // Re-parse the original .gb file
  _clSelectSequence(_cl.selected.type, _cl.selected.id);
}

function _clFeatSave() {
  if (!_cl.parsed || !_cl.selected) return;
  toast('Saving annotations to .gb\u2026');
  api('POST', '/api/cloning/sequences/' + _cl.selected.type + '/' + _cl.selected.id + '/update-features', {
    annotations: _cl.parsed.annotations || [],
  })
  .then(function(data) {
    _cl.featuresDirty = false;
    toast('Saved ' + (data.count || 0) + ' features to .gb file');
    _clRender();
  })
  .catch(function(err) { toast('Save failed: ' + (err.message || err), true); });
}

function _clSendToOC() {
  if (!_cl.selected || !_cl.parsed) { toast('Select and load a sequence first', true); return; }
  var seqName = _cl.parsed.name || 'Sequence';
  fetch('/api/cloning/export/' + _cl.selected.type + '/' + _cl.selected.id)
    .then(function(r) { if (!r.ok) throw new Error('Export failed'); return r.json(); })
    .then(function(strategy) {
      var blob = new Blob([JSON.stringify(strategy, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = seqName + '_opencloning.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast('JSON exported \u2014 in OpenCloning click \u2630 \u2192 Load file');
    }).catch(function(err) { toast('Failed to export: ' + (err.message || err), true); });
}

function _pdGenerateProduct(mode) {
  if (!_cl.parsed || !_cl.selected) { toast('Load a sequence first', true); return; }

  var baseBody = {
    mode: mode,
    template_seq: _cl.parsed.seq,
    annotations: (_cl.parsed.annotations || []).map(function(a) {
      return { name: a.name, start: a.start, end: a.end, direction: a.direction, color: a.color, type: a.type };
    }),
    template_name: _cl.parsed.name || 'template',
    template_topology: _cl.parsed.topology || 'circular',
  };

  if (mode === 'kld' && _cl.pd.kld.result) {
    var kldResult = _cl.pd.kld.result;
    baseBody.start_pos = parseInt(kldResult.start_used, 10) || parseInt(_cl.pd.kld.startPos, 10);
    baseBody.end_pos = parseInt(kldResult.end_used, 10) || parseInt(_cl.pd.kld.endPos, 10);
    baseBody.insert_seq = _clCleanSeq(_cl.pd.kld.insertSeq);
    baseBody.insert_label = _cl.pd.kld.insertSeq.length > 20 ? _cl.pd.kld.insertSeq.substring(0, 20) : (_cl.pd.kld.insertSeq || 'insert');
  } else if (mode === 'pcr' && _cl.pd.pcr.result) {
    baseBody.target_start = parseInt(_cl.pd.pcr.targetStart, 10);
    baseBody.target_end = parseInt(_cl.pd.pcr.targetEnd, 10);
  } else {
    toast('Design primers first', true); return;
  }

  // Step 1: Preview product in SeqViz
  toast('Generating product preview\u2026');
  api('POST', '/api/cloning/product-preview', baseBody)
    .then(function(product) {
      // Load product into SeqViz viewer
      _cl.pd._productPreview = product;
      _cl.pd._productBaseBody = baseBody;
      _cl.parsed = product;
      _cl.pd._viewingProduct = true;
      _clRender();
      setTimeout(function() { _clRenderSeqViz(); }, 50);
      toast('Product preview loaded \u2014 ' + product.length.toLocaleString() + ' bp');
    })
    .catch(function(err) { toast('Preview failed: ' + (err.message || err), true); });
}

function _pdSaveProduct() {
  var baseBody = _cl.pd._productBaseBody;
  var product = _cl.pd._productPreview;
  if (!baseBody || !product) { toast('Generate a preview first', true); return; }

  // Prompt for product name
  var defaultName = product.name || 'product';
  var name = prompt('Name for the new plasmid:', defaultName);
  if (!name) return;

  var saveBody = JSON.parse(JSON.stringify(baseBody));
  saveBody.product_name = name;

  toast('Saving product\u2026');
  api('POST', '/api/cloning/save-product', saveBody)
    .then(function(data) {
      toast('Saved as plasmid: ' + data.plasmid_name);
      // Clear product preview state
      _cl.pd._viewingProduct = false;
      _cl.pd._productPreview = null;
      _cl.pd._productBaseBody = null;
      // Reload sequences and select the new plasmid
      _clLoadSequences().then(function() {
        _clSelectSequence('plasmid', data.plasmid_id);
      });
    })
    .catch(function(err) { toast('Save failed: ' + (err.message || err), true); });
}

function _pdExitProductPreview() {
  if (!_cl.selected) return;
  _cl.pd._viewingProduct = false;
  _cl.pd._productPreview = null;
  _cl.pd._productBaseBody = null;
  // Reload original sequence
  _clSelectSequence(_cl.selected.type, _cl.selected.id);
}

/* ═══════════════════════════════════════════════════════════
   ASSEMBLY DESIGNER PANEL
   ═══════════════════════════════════════════════════════════ */
function _clRenderAssemblyPanel() {
  var ad = _cl.ad;
  var h = '';
  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;overflow:hidden;">';

  // Collapsible header
  h += '<div onclick="_adToggle()" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .9rem;cursor:pointer;background:#faf8f4;border-bottom:' + (ad.expanded ? '1px solid #e8e2d8' : 'none') + ';user-select:none;" onmouseover="this.style.background=\x27#f0ebe3\x27" onmouseout="this.style.background=\x27#faf8f4\x27">';
  h += '<span style="font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:#5b7a5e;">Assembly Designer</span>';
  h += '<span style="font-size:.8rem;color:#8a7f72;transition:transform .2s;display:inline-block;transform:rotate(' + (ad.expanded ? '180' : '0') + 'deg);">\u25bc</span>';
  h += '</div>';
  if (!ad.expanded) { h += '</div>'; return h; }

  // Mode tabs
  h += '<div style="display:flex;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
  var modes = [
    { key: 'gibson', label: 'Gibson', icon: '\ud83e\udde9' },
    { key: 'goldengate', label: 'Golden Gate', icon: '\u2728' },
    { key: 'digestligate', label: 'Digest-Ligate', icon: '\u2702\ufe0f' },
  ];
  modes.forEach(function(m) {
    var active = ad.mode === m.key;
    h += '<button onclick="_adSetMode(\x27' + m.key + '\x27)" style="flex:1;padding:.5rem .3rem;font-size:.75rem;font-weight:' + (active ? '600' : '400') + ';border:none;border-bottom:2px solid ' + (active ? '#5b7a5e' : 'transparent') + ';cursor:pointer;background:' + (active ? '#fff' : 'transparent') + ';color:' + (active ? '#4a4139' : '#8a7f72') + ';transition:all .15s;">' + m.icon + ' ' + m.label + '</button>';
  });
  h += '</div>';

  h += '<div style="padding:.9rem;">';
  if (ad.mode === 'gibson') { h += _clRenderGibsonTab(); }
  else if (ad.mode === 'goldengate') { h += _clRenderGoldenGateTab(); }
  else if (ad.mode === 'digestligate') { h += _clRenderDigestLigateTab(); }
  h += '</div>';
  h += '</div>';
  return h;
}

/* ── Shared fragment list renderer ────────────────────────── */
function _clRenderFragmentList(fragments, modeKey) {
  var h = '';
  h += '<div style="margin-bottom:.6rem;">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem;">';
  h += '<span style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Fragments (' + fragments.length + ')</span>';
  h += '<div style="display:flex;gap:.3rem;">';
  h += '<button onclick="_adAddFromLoaded(\x27' + modeKey + '\x27)" style="padding:.25rem .5rem;font-size:.7rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;background:#fff;cursor:pointer;" title="Add the currently loaded sequence (or selection) as a fragment">+ From loaded</button>';
  h += '<button onclick="_adOpenLib(\x27' + modeKey + '\x27)" style="padding:.25rem .5rem;font-size:.7rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;" title="Pick from saved plasmids and primers">\ud83d\udcc2 From library</button>';
  h += '<button onclick="_adAddPaste(\x27' + modeKey + '\x27)" style="padding:.25rem .5rem;font-size:.7rem;color:#4682B4;border:1px solid #4682B4;border-radius:3px;background:#fff;cursor:pointer;" title="Paste a raw DNA sequence">+ Paste</button>';
  h += '</div></div>';

  // ── Inline library picker
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === modeKey) {
    h += _clRenderLibPicker(modeKey);
  }

  if (fragments.length === 0) {
    h += '<div style="padding:.8rem;text-align:center;color:#8a7f72;font-size:.78rem;border:1px dashed #d5cec0;border-radius:5px;">No fragments added yet. Use the buttons above or drag-select a region on the map.</div>';
  } else {
    h += '<div style="border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;">';
    fragments.forEach(function(f, i) {
      h += '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;border-bottom:1px solid #f0ebe3;background:#fff;" onmouseover="this.style.background=\x27#f5f1eb\x27" onmouseout="this.style.background=\x27#fff\x27">';
      h += '<span style="font-size:.7rem;color:#8a7f72;min-width:18px;">' + (i + 1) + '.</span>';
      h += '<span style="font-size:.8rem;font-weight:500;color:#4a4139;flex:1;">' + esc(f.name) + '</span>';
      h += '<span style="font-size:.7rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;">' + f.seq.length + ' bp</span>';
      if (i > 0) {
        h += '<button onclick="_adFragMove(\x27' + modeKey + '\x27,' + i + ',-1)" style="padding:.1rem .3rem;font-size:.68rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;" title="Move up">\u25b2</button>';
      }
      if (i < fragments.length - 1) {
        h += '<button onclick="_adFragMove(\x27' + modeKey + '\x27,' + i + ',1)" style="padding:.1rem .3rem;font-size:.68rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;" title="Move down">\u25bc</button>';
      }
      h += '<button onclick="_adFragRemove(\x27' + modeKey + '\x27,' + i + ')" style="padding:.1rem .3rem;font-size:.68rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Remove">\u2715</button>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';
  return h;
}

/* ── Library picker (inline dropdown of saved sequences) ──── */
function _clRenderLibPicker(target) {
  var lp = _cl.ad._libPicker;
  var h = '';
  h += '<div style="border:1px solid #8E44AD;border-radius:5px;background:#faf8f4;margin-bottom:.6rem;overflow:hidden;">';
  // Header with search + close
  h += '<div style="display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem;border-bottom:1px solid #e8e2d8;background:#f3eef8;">';
  h += '<span style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8E44AD;font-weight:600;white-space:nowrap;">\ud83d\udcc2 Library</span>';
  h += '<input id="cl-lib-filter" type="text" placeholder="Filter\u2026" value="' + esc(lp.filter || '') + '" oninput="_adLibFilter(this.value)" style="flex:1;padding:.25rem .4rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;font-size:.76rem;color:#4a4139;" />';
  if (_cl.ad._libLoading) {
    h += '<span style="font-size:.72rem;color:#8a7f72;">\u23f3</span>';
  }
  h += '<button onclick="_adCloseLib()" style="padding:.15rem .35rem;font-size:.72rem;border:1px solid #d5cec0;border-radius:3px;background:#fff;color:#8a7f72;cursor:pointer;">\u2715</button>';
  h += '</div>';

  // Sequence list — plasmids, kit parts, primers
  var plasmids = _cl.sequences.filter(function(s) { return s.type === 'plasmid' && s.has_file; });
  var kitparts = _cl.sequences.filter(function(s) { return s.type === 'kitpart' && s.has_file; });
  var primers = _cl.sequences.filter(function(s) { return s.type === 'primer' && s.has_file; });
  if (lp.filter) {
    var f = lp.filter.toLowerCase();
    plasmids = plasmids.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.use && s.use.toLowerCase().indexOf(f) !== -1); });
    kitparts = kitparts.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.kit_name && s.kit_name.toLowerCase().indexOf(f) !== -1) || (s.part_type && s.part_type.toLowerCase().indexOf(f) !== -1); });
    primers = primers.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1 || (s.sequence && s.sequence.toLowerCase().indexOf(f) !== -1); });
  }

  var totalCount = plasmids.length + kitparts.length + primers.length;

  h += '<div style="max-height:240px;overflow-y:auto;">';

  // Kit Parts (shown first — most relevant for assembly)
  if (kitparts.length > 0) {
    h += '<div style="padding:.25rem .6rem;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:#8E44AD;font-weight:600;background:#f3eef8;border-bottom:1px solid #e8e2d8;">\ud83e\uddf0 Kit Parts (' + kitparts.length + ')</div>';
    kitparts.forEach(function(s) {
      h += '<div onclick="_adLibPick(\x27' + esc(target) + '\x27,\x27' + s.type + '\x27,' + s.id + ')" style="padding:.35rem .6rem;cursor:pointer;border-bottom:1px solid #f0ebe3;display:flex;align-items:center;gap:.5rem;" onmouseover="this.style.background=\x27#eee8f4\x27" onmouseout="this.style.background=\x27transparent\x27">';
      h += '<span style="font-size:.8rem;color:#4a4139;font-weight:500;flex:1;">' + esc(s.name) + '</span>';
      var meta = [];
      if (s.kit_name) meta.push(s.kit_name);
      if (s.part_type) meta.push(s.part_type);
      if (meta.length > 0) h += '<span style="font-size:.66rem;color:#8E44AD;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(meta.join(' \u00b7 ')) + '</span>';
      h += '</div>';
    });
  }

  // Plasmids
  if (plasmids.length > 0) {
    h += '<div style="padding:.25rem .6rem;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;background:#f0ebe3;border-bottom:1px solid #e8e2d8;">Plasmids (' + plasmids.length + ')</div>';
    plasmids.forEach(function(s) {
      h += '<div onclick="_adLibPick(\x27' + esc(target) + '\x27,\x27' + s.type + '\x27,' + s.id + ')" style="padding:.35rem .6rem;cursor:pointer;border-bottom:1px solid #f0ebe3;display:flex;align-items:center;gap:.5rem;" onmouseover="this.style.background=\x27#eee8f4\x27" onmouseout="this.style.background=\x27transparent\x27">';
      h += '<span style="font-size:.8rem;color:#4a4139;font-weight:500;flex:1;">' + esc(s.name) + '</span>';
      if (s.use) h += '<span style="font-size:.68rem;color:#8a7f72;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.use) + '</span>';
      h += '</div>';
    });
  }

  // Primers
  if (primers.length > 0) {
    h += '<div style="padding:.25rem .6rem;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;background:#f0ebe3;border-bottom:1px solid #e8e2d8;">Primers (' + primers.length + ')</div>';
    primers.forEach(function(s) {
      h += '<div onclick="_adLibPick(\x27' + esc(target) + '\x27,\x27' + s.type + '\x27,' + s.id + ')" style="padding:.35rem .6rem;cursor:pointer;border-bottom:1px solid #f0ebe3;display:flex;align-items:center;gap:.5rem;" onmouseover="this.style.background=\x27#eee8f4\x27" onmouseout="this.style.background=\x27transparent\x27">';
      h += '<span style="font-size:.8rem;color:#4a4139;font-weight:500;flex:1;">' + esc(s.name) + '</span>';
      if (s.sequence) h += '<span style="font-size:.66rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.sequence.substring(0, 25)) + '</span>';
      h += '</div>';
    });
  }

  if (totalCount === 0) {
    h += '<div style="padding:.8rem;text-align:center;color:#8a7f72;font-size:.78rem;">' + (lp.filter ? 'No matches.' : 'No sequences with .gb files found.') + '</div>';
  }
  h += '</div></div>';
  return h;
}

/* ── GIBSON TAB ───────────────────────────────────────────── */
function _clRenderGibsonTab() {
  var g = _cl.ad.gibson;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Gibson assembly joins 2+ fragments with overlapping primer tails. Set the <strong style="color:#4a4139;">vector</strong> (backbone), add <strong style="color:#4a4139;">insert fragments</strong>, then design primers with ~25bp overlaps.</p>';

  // ── Loaded sequence banner
  if (_cl.parsed) {
    var sel = _cl.lastSelection || { start: 0, end: 0 };
    var hasSelection = sel.end > sel.start && sel.end - sel.start < _cl.parsed.seq.length;
    var isVec = g.vector && g.vector._sourceId === (_cl.selected.type + '_' + _cl.selected.id);
    h += '<div style="border:1px solid ' + (isVec ? '#5b7a5e' : '#4682B4') + ';border-radius:5px;padding:.5rem .7rem;margin-bottom:.7rem;background:' + (isVec ? '#eef4ee' : '#eef2f8') + ';display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">';
    h += '<span style="font-size:.72rem;font-weight:600;color:#4a4139;">\ud83e\uddec ' + esc(_cl.parsed.name) + '</span>';
    h += '<span style="font-size:.7rem;color:#8a7f72;">' + _cl.parsed.length.toLocaleString() + ' bp \u00b7 ' + esc(_cl.parsed.topology) + '</span>';
    if (hasSelection) {
      h += '<span style="font-size:.7rem;color:#5b7a5e;font-weight:500;">Selection: ' + sel.start + '\u2013' + sel.end + ' (' + (sel.end - sel.start) + ' bp)</span>';
    }
    h += '<div style="display:flex;gap:.3rem;margin-left:auto;">';
    if (!isVec) {
      h += '<button onclick="_adGibsonUseAsVec()" style="padding:.25rem .55rem;font-size:.7rem;font-weight:600;color:#fff;background:#5b7a5e;border:none;border-radius:3px;cursor:pointer;">Use as Vector</button>';
    } else {
      h += '<span style="font-size:.68rem;color:#5b7a5e;font-weight:600;padding:.25rem .4rem;">\u2705 Vector</span>';
    }
    h += '<button onclick="_adGibsonAddLoaded()" style="padding:.25rem .55rem;font-size:.7rem;color:#4682B4;border:1px solid #4682B4;border-radius:3px;background:#fff;cursor:pointer;">' + (hasSelection ? 'Add Selection as Fragment' : 'Add as Fragment') + '</button>';
    h += '</div></div>';
  }

  // ── Vector section
  h += '<div style="margin-bottom:.6rem;">';
  h += '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem;">';
  h += '<label style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Vector (backbone)</label>';
  if (g.vector) {
    h += '<span style="font-size:.76rem;color:#4a4139;font-weight:500;padding:.2rem .5rem;background:#eef4ee;border-radius:3px;border:1px solid #5b7a5e;">' + esc(g.vector.name) + ' (' + g.vector.seq.length + ' bp)</span>';
    h += '<button onclick="_adGibsonClearVec()" style="padding:.15rem .3rem;font-size:.66rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Remove vector">\u2715</button>';
  } else {
    h += '<button onclick="_adOpenLib(\x27gibson-vector\x27)" style="padding:.2rem .45rem;font-size:.68rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;">\ud83d\udcc2 From library</button>';
    h += '<span style="font-size:.72rem;color:#8a7f72;font-style:italic;">select above or pick from library</span>';
  }
  h += '</div>';
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === 'gibson-vector') {
    h += _clRenderLibPicker('gibson-vector');
  }
  h += '</div>';

  // ── Insert fragments
  h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Insert Fragments</div>';
  h += _clRenderFragmentList(g.fragments, 'gibson');

  // ── Settings + design
  h += '<div style="display:flex;gap:.6rem;margin-bottom:.7rem;align-items:end;flex-wrap:wrap;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Overlap (bp)</label>';
  h += '<input type="number" min="15" max="60" value="' + g.overlapLen + '" oninput="_adGibsonSet(\x27overlapLen\x27,this.value)" style="width:80px;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Tm Target (\u00b0C)</label>';
  h += '<input type="number" min="50" max="75" value="' + g.tmTarget + '" oninput="_adGibsonSet(\x27tmTarget\x27,this.value)" style="width:80px;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';

  var totalFrags = g.fragments.length + (g.vector ? 1 : 0);
  h += '<button onclick="_adGibsonDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (g.designing ? 'opacity:.6;pointer-events:none;' : '') + (totalFrags < 2 ? 'opacity:.5;pointer-events:none;' : '') + '">' + (g.designing ? '\u23f3 Designing\u2026' : '\ud83e\udde9 Design Gibson Assembly') + '</button>';
  h += '</div>';

  if (g.result) { h += _clRenderAssemblyResult(g.result, 'gibson'); }
  return h;
}

/* ── GOLDEN GATE TAB ──────────────────────────────────────── */
function _clRenderGoldenGateTab() {
  var gg = _cl.ad.goldengate;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Golden Gate uses type IIS enzymes to join parts via programmable 4bp overhangs. Add <strong style="color:#4a4139;">bins</strong> (positions) \u2014 each bin can hold multiple part options for combinatorial assemblies.</p>';

  // Enzyme selector
  h += '<div style="display:flex;gap:.6rem;align-items:end;margin-bottom:.7rem;flex-wrap:wrap;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Type IIS Enzyme</label>';
  h += '<select onchange="_adGGSet(\x27enzyme\x27,this.value)" style="padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;">';
  ['BsaI', 'BbsI', 'BpiI', 'SapI', 'BsmBI'].forEach(function(e) {
    h += '<option value="' + e + '"' + (gg.enzyme === e ? ' selected' : '') + '>' + e + '</option>';
  });
  h += '</select></div>';

  // Vector selector
  h += '<div style="display:flex;align-items:center;gap:.3rem;">';
  h += '<label style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Vector:</label>';
  if (gg.vector) {
    h += '<span style="font-size:.76rem;color:#4a4139;font-weight:500;padding:.25rem .5rem;background:#eef4ee;border-radius:3px;">' + esc(gg.vector.name) + ' (' + gg.vector.seq.length + ' bp)</span>';
    h += '<button onclick="_adGGClearVec()" style="padding:.15rem .3rem;font-size:.66rem;color:#c0392b;border:none;background:none;cursor:pointer;">\u2715</button>';
  } else {
    h += '<button onclick="_adGGLoadVec()" style="padding:.25rem .5rem;font-size:.7rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;background:#fff;cursor:pointer;">Use loaded</button>';
    h += '<button onclick="_adOpenLib(\x27gg-vector\x27)" style="padding:.25rem .5rem;font-size:.7rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;">\ud83d\udcc2 Library</button>';
    h += '<span style="font-size:.72rem;color:#8a7f72;font-style:italic;">optional backbone</span>';
  }
  h += '</div>';
  h += '</div>';

  // Vector library picker
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === 'gg-vector') {
    h += _clRenderLibPicker('gg-vector');
  }

  // Internal sites warning
  if (gg.result && gg.result.internal_sites && gg.result.internal_sites.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    gg.result.internal_sites.forEach(function(is) {
      h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(is.fragment) + (is.bin ? ' (bin ' + esc(is.bin) + ')' : '') + ' has internal ' + esc(gg.enzyme) + ' sites at: ' + is.positions.join(', ') + '</div>';
    });
    h += '</div>';
  }

  // ── Bins
  h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.4rem;">Assembly Bins (' + gg.bins.length + ')</div>';

  if (gg.bins.length === 0) {
    h += '<div style="padding:.8rem;text-align:center;color:#8a7f72;font-size:.78rem;border:1px dashed #d5cec0;border-radius:5px;margin-bottom:.5rem;">No bins yet. Click \u201c+ Add Bin\u201d to create assembly positions (e.g. Promoter \u2192 RBS \u2192 CDS \u2192 Terminator).</div>';
  } else {
    var comboCount = 1;
    gg.bins.forEach(function(bin, bi) {
      comboCount *= Math.max(1, bin.fragments.length);
      var binColors = ['#4682B4', '#2ecc71', '#e67e22', '#9b59b6', '#e74c3c', '#1abc9c'];
      var bc = binColors[bi % binColors.length];
      h += '<div style="border:1px solid #d5cec0;border-left:3px solid ' + bc + ';border-radius:5px;margin-bottom:.5rem;overflow:hidden;">';
      // Bin header
      h += '<div style="display:flex;align-items:center;gap:.4rem;padding:.4rem .6rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;">';
      h += '<span style="font-size:.72rem;color:' + bc + ';font-weight:700;min-width:18px;">B' + (bi + 1) + '</span>';
      h += '<input type="text" value="' + esc(bin.name) + '" onchange="_adGGBinRename(' + bi + ',this.value)" style="flex:1;padding:.2rem .4rem;border:1px solid transparent;border-radius:3px;background:transparent;font-size:.8rem;font-weight:500;color:#4a4139;min-width:0;" onfocus="this.style.borderColor=\x27#d5cec0\x27;this.style.background=\x27#fff\x27" onblur="this.style.borderColor=\x27transparent\x27;this.style.background=\x27transparent\x27" />';
      h += '<span style="font-size:.68rem;color:#8a7f72;">' + bin.fragments.length + ' part' + (bin.fragments.length !== 1 ? 's' : '') + '</span>';
      if (bi > 0) h += '<button onclick="_adGGBinMove(' + bi + ',-1)" style="padding:.1rem .3rem;font-size:.65rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">\u25c0</button>';
      if (bi < gg.bins.length - 1) h += '<button onclick="_adGGBinMove(' + bi + ',1)" style="padding:.1rem .3rem;font-size:.65rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:3px;background:#fff;cursor:pointer;">\u25b6</button>';
      h += '<button onclick="_adGGBinRemove(' + bi + ')" style="padding:.1rem .3rem;font-size:.66rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Remove bin">\u2715</button>';
      h += '</div>';

      // Fragments in this bin
      if (bin.fragments.length > 0) {
        bin.fragments.forEach(function(f, fi) {
          h += '<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem .6rem .3rem 1.4rem;border-bottom:1px solid #f0ebe3;font-size:.78rem;">';
          h += '<span style="color:#8a7f72;min-width:14px;font-size:.68rem;">' + (fi + 1) + '.</span>';
          h += '<span style="color:#4a4139;flex:1;">' + esc(f.name) + '</span>';
          h += '<span style="color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.7rem;">' + f.seq.length + ' bp</span>';
          h += '<button onclick="_adGGFragRemove(' + bi + ',' + fi + ')" style="padding:0 .25rem;font-size:.64rem;color:#c0392b;border:none;background:none;cursor:pointer;">\u2715</button>';
          h += '</div>';
        });
      }

      // Add part buttons
      h += '<div style="display:flex;gap:.3rem;padding:.35rem .6rem .35rem 1.4rem;background:#faf8f4;">';
      h += '<button onclick="_adGGFragFromLoaded(' + bi + ')" style="padding:.2rem .4rem;font-size:.66rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;background:#fff;cursor:pointer;">+ Loaded</button>';
      h += '<button onclick="_adOpenLib(\x27gg-bin-' + bi + '\x27)" style="padding:.2rem .4rem;font-size:.66rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;">\ud83d\udcc2 Library</button>';
      h += '<button onclick="_adGGFragPaste(' + bi + ')" style="padding:.2rem .4rem;font-size:.66rem;color:#4682B4;border:1px solid #4682B4;border-radius:3px;background:#fff;cursor:pointer;">+ Paste</button>';
      h += '</div>';

      // Library picker for this bin
      if (_cl.ad._libPicker && _cl.ad._libPicker.target === 'gg-bin-' + bi) {
        h += '<div style="padding:0 .6rem .4rem .6rem;">' + _clRenderLibPicker('gg-bin-' + bi) + '</div>';
      }

      h += '</div>';
    });

    // Combinatorial count
    if (comboCount > 1) {
      h += '<div style="font-size:.78rem;color:#4a4139;margin-bottom:.5rem;padding:.35rem .6rem;background:#f3eef8;border:1px solid #d5cec0;border-radius:4px;">\u2728 <strong>' + comboCount + ' possible combination' + (comboCount > 1 ? 's' : '') + '</strong> \u2014 all share the same overhang scheme, compatible in a single reaction.</div>';
    }
  }

  // Add bin button
  h += '<div style="margin-bottom:.7rem;">';
  h += '<button onclick="_adGGAddBin()" style="padding:.35rem .7rem;font-size:.75rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:#fff;cursor:pointer;">+ Add Bin</button>';
  h += '</div>';

  // Design button
  var canDesign = gg.bins.length >= 1 && gg.bins.every(function(b) { return b.fragments.length > 0; });
  h += '<button onclick="_adGGDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (gg.designing ? 'opacity:.6;pointer-events:none;' : '') + (!canDesign ? 'opacity:.5;pointer-events:none;' : '') + '">' + (gg.designing ? '\u23f3 Designing\u2026' : '\u2728 Design Golden Gate Assembly') + '</button>';

  if (gg.result) { h += _clRenderGGResult(gg.result); }
  return h;
}

/* ── Golden Gate result renderer ──────────────────────────── */
function _clRenderGGResult(r) {
  var h = '<div style="margin-top:.8rem;">';

  if (r.warnings && r.warnings.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    r.warnings.forEach(function(w) { h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(w) + '</div>'; });
    h += '</div>';
  }

  h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;">Enzyme: <strong style="color:#4a4139;">' + esc(r.enzyme.name) + '</strong> (site: ' + esc(r.enzyme.site) + ')</div>';

  // Overhang map
  if (r.overhang_map && r.overhang_map.length > 0) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Overhang Scheme</div>';
    h += '<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.6rem;">';
    r.overhang_map.forEach(function(om) {
      h += '<div style="padding:.25rem .5rem;background:#f3eef8;border:1px solid #d5cec0;border-radius:4px;font-size:.72rem;">';
      h += '<span style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-weight:600;color:#8E44AD;">' + esc(om.overhang) + '</span>';
      h += ' <span style="color:#8a7f72;">' + esc(om.label) + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  // Per-bin primers
  if (r.bins && r.bins.length > 0) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.4rem;">Primers by Bin</div>';
    r.bins.forEach(function(bin, bi) {
      var binColors = ['#4682B4', '#2ecc71', '#e67e22', '#9b59b6', '#e74c3c', '#1abc9c'];
      var bc = binColors[bi % binColors.length];
      h += '<div style="border:1px solid #e8e2d8;border-left:3px solid ' + bc + ';border-radius:5px;margin-bottom:.5rem;overflow:hidden;">';
      h += '<div style="padding:.35rem .6rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;display:flex;align-items:center;gap:.4rem;">';
      h += '<span style="font-size:.78rem;font-weight:600;color:#4a4139;">' + esc(bin.name) + '</span>';
      h += '<span style="font-size:.68rem;color:#8a7f72;">overhang: <span style="font-family:\'SF Mono\',Monaco,Consolas,monospace;color:#8E44AD;">' + esc(bin.left_overhang) + '</span> \u2192 <span style="font-family:\'SF Mono\',Monaco,Consolas,monospace;color:#8E44AD;">' + esc(bin.right_overhang) + '</span></span>';
      if (bin.num_options > 1) h += '<span style="font-size:.68rem;color:#5b7a5e;font-weight:600;">' + bin.num_options + ' options</span>';
      h += '</div>';

      bin.fragments.forEach(function(frag) {
        h += '<div style="padding:.3rem .6rem;border-bottom:1px solid #f0ebe3;">';
        h += '<div style="font-size:.76rem;font-weight:500;color:#4a4139;margin-bottom:.3rem;">' + esc(frag.name) + ' <span style="font-weight:400;color:#8a7f72;">(' + frag.length + ' bp)</span></div>';
        h += _clRenderTailedPrimer('Fwd', frag.fwd_primer, '#2980b9', 'ad-ggf-' + bi + '-' + frag.name.replace(/\s/g, ''), null);
        h += _clRenderTailedPrimer('Rev', frag.rev_primer, '#8e44ad', 'ad-ggr-' + bi + '-' + frag.name.replace(/\s/g, ''), null);
        h += '</div>';
      });
      h += '</div>';
    });
  }

  // Vector primers
  if (r.vector_primers) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Vector Primers (' + esc(r.vector_name || 'Vector') + ')</div>';
    h += _clRenderTailedPrimer('Vector Fwd', r.vector_primers.fwd, '#2980b9', 'ad-gg-vec-fwd', null);
    h += _clRenderTailedPrimer('Vector Rev', r.vector_primers.rev, '#8e44ad', 'ad-gg-vec-rev', null);
  }

  // Summary
  h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding:.5rem .7rem;background:#faf8f4;border:1px solid #e8e2d8;border-radius:5px;margin-top:.5rem;">';
  h += '<span style="font-size:.78rem;color:#8a7f72;">Product: <strong style="color:#4a4139;">' + (r.product_length || 0).toLocaleString() + ' bp</strong></span>';
  h += '<span style="font-size:.78rem;color:#8a7f72;">Bins: <strong style="color:#4a4139;">' + (r.num_bins || 0) + '</strong></span>';
  if (r.combo_count > 1) h += '<span style="font-size:.78rem;color:#8E44AD;font-weight:600;">' + r.combo_count + ' combinations</span>';
  h += '<span style="font-size:.78rem;color:#8a7f72;">Primers: <strong style="color:#4a4139;">' + (r.primers || []).length + '</strong></span>';
  h += '<button onclick="_adCopyAllPrimers(\x27goldengate\x27)" style="margin-left:auto;padding:.3rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy All</button>';
  h += '</div>';

  if (r.primers && r.primers.length > 0) {
    var saveItems = r.primers.map(function(p) { return { seq: p.full_seq, label: p.name || 'GG primer' }; });
    h += _clRenderSaveBtn(saveItems);
  }

  h += '</div>';
  return h;
}

/* ── DIGEST-LIGATE TAB ────────────────────────────────────── */
function _clRenderDigestLigateTab() {
  var dl = _cl.ad.digestligate;
  var h = '';
  h += '<p style="font-size:.78rem;color:#8a7f72;margin:0 0 .7rem;">Classical cloning \u2014 digest vector and insert with restriction enzymes, then ligate compatible sticky ends. Select enzymes and provide sequences below.</p>';

  // Vector input
  h += '<div style="margin-bottom:.6rem;">';
  h += '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem;">';
  h += '<label style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Vector</label>';
  h += '<button onclick="_adDLLoadVector()" style="padding:.2rem .45rem;font-size:.68rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;background:#fff;cursor:pointer;" title="Use currently loaded sequence as vector">Use loaded</button>';
  h += '<button onclick="_adOpenLib(\x27dl-vector\x27)" style="padding:.2rem .45rem;font-size:.68rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;" title="Pick from saved plasmids">\ud83d\udcc2 From library</button>';
  if (dl.vectorSeq) {
    h += '<span style="font-size:.72rem;color:#4a4139;font-weight:500;">' + esc(dl.vectorName || 'vector') + ' (' + dl.vectorSeq.length + ' bp)</span>';
    h += '<button onclick="_adDLClear(\x27vector\x27)" style="padding:.1rem .3rem;font-size:.66rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Clear vector">\u2715</button>';
  }
  h += '</div>';
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === 'dl-vector') {
    h += _clRenderLibPicker('dl-vector');
  }
  if (!dl.vectorSeq) {
    h += '<textarea oninput="_adDLSet(\x27vectorSeq\x27,this.value)" placeholder="Paste vector sequence, click \'Use loaded\', or pick from library\u2026" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.76rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;min-height:40px;resize:vertical;"></textarea>';
  }
  h += '</div>';

  // Insert input
  h += '<div style="margin-bottom:.6rem;">';
  h += '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.3rem;">';
  h += '<label style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Insert</label>';
  h += '<button onclick="_adOpenLib(\x27dl-insert\x27)" style="padding:.2rem .45rem;font-size:.68rem;color:#8E44AD;border:1px solid #8E44AD;border-radius:3px;background:#fff;cursor:pointer;" title="Pick from saved sequences">\ud83d\udcc2 From library</button>';
  if (dl.insertSeq) {
    h += '<span style="font-size:.72rem;color:#4a4139;font-weight:500;">' + esc(dl.insertName || 'insert') + ' (' + dl.insertSeq.length + ' bp)</span>';
    h += '<button onclick="_adDLClear(\x27insert\x27)" style="padding:.1rem .3rem;font-size:.66rem;color:#c0392b;border:none;background:none;cursor:pointer;" title="Clear insert">\u2715</button>';
  }
  h += '</div>';
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === 'dl-insert') {
    h += _clRenderLibPicker('dl-insert');
  }
  if (!dl.insertSeq) {
    h += '<textarea oninput="_adDLSet(\x27insertSeq\x27,this.value)" placeholder="Paste insert sequence or pick from library\u2026" style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.76rem;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;min-height:40px;resize:vertical;">' + esc(dl.insertSeq) + '</textarea>';
  }
  h += '</div>';

  // Enzymes
  h += '<div style="display:flex;gap:.6rem;margin-bottom:.7rem;align-items:end;flex-wrap:wrap;">';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Enzyme 1</label>';
  h += '<input type="text" value="' + esc(dl.enzyme1) + '" oninput="_adDLSet(\x27enzyme1\x27,this.value)" placeholder="e.g. EcoRI" style="width:120px;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '<div><label style="display:block;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.25rem;">Enzyme 2 (optional)</label>';
  h += '<input type="text" value="' + esc(dl.enzyme2) + '" oninput="_adDLSet(\x27enzyme2\x27,this.value)" placeholder="e.g. BamHI" style="width:120px;padding:.4rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.82rem;color:#4a4139;" /></div>';
  h += '<button onclick="_adDLDesign()" style="padding:.45rem 1rem;font-size:.82rem;font-weight:600;background:#5b7a5e;color:#fff;border:none;border-radius:5px;cursor:pointer;' + (dl.designing ? 'opacity:.6;pointer-events:none;' : '') + (!dl.vectorSeq || !dl.insertSeq || !dl.enzyme1 ? 'opacity:.5;pointer-events:none;' : '') + '">' + (dl.designing ? '\u23f3 Designing\u2026' : '\u2702\ufe0f Design Digest-Ligate') + '</button>';
  h += '</div>';

  if (dl.result) { h += _clRenderDLResult(dl.result); }
  return h;
}

/* ── Shared assembly result renderer ──────────────────────── */
function _clRenderAssemblyResult(r, mode) {
  var h = '<div style="margin-top:.8rem;">';

  // Warnings
  if (r.warnings && r.warnings.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    r.warnings.forEach(function(w) { h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(w) + '</div>'; });
    h += '</div>';
  }

  // Enzyme info for Golden Gate
  if (mode === 'goldengate' && r.enzyme) {
    h += '<div style="font-size:.78rem;color:#8a7f72;margin-bottom:.5rem;">Enzyme: <strong style="color:#4a4139;">' + esc(r.enzyme.name) + '</strong> (site: ' + esc(r.enzyme.site) + ')</div>';
  }

  // Junctions
  if (r.junctions && r.junctions.length > 0) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.4rem;">Junctions (' + r.junctions.length + ')</div>';
    r.junctions.forEach(function(jn, ji) {
      h += '<div style="border:1px solid #e8e2d8;border-radius:5px;overflow:hidden;margin-bottom:.5rem;">';
      h += '<div style="padding:.35rem .6rem;background:#faf8f4;border-bottom:1px solid #e8e2d8;display:flex;align-items:center;gap:.5rem;">';
      h += '<span style="font-size:.78rem;font-weight:600;color:#4a4139;">Junction ' + (ji + 1) + '</span>';
      if (jn.name) h += '<span style="font-size:.72rem;color:#8a7f72;">' + esc(jn.name) + '</span>';
      if (jn.overlap_seq) h += '<span style="font-size:.7rem;color:#8a7f72;">overlap Tm: ' + (jn.overlap_tm || '?') + '\u00b0C</span>';
      if (jn.overhang) h += '<span style="font-size:.72rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;color:#5b7a5e;font-weight:600;">' + esc(jn.overhang) + '</span>';
      h += '</div>';

      // Primer cards
      if (jn.fwd_primer) {
        h += _clRenderTailedPrimer('Forward', jn.fwd_primer, '#2980b9', 'ad-fwd-' + ji, null);
      }
      if (jn.rev_primer) {
        h += _clRenderTailedPrimer('Reverse', jn.rev_primer, '#8e44ad', 'ad-rev-' + ji, null);
      }
      h += '</div>';
    });
  }

  // Product summary + actions
  h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding:.5rem .7rem;background:#faf8f4;border:1px solid #e8e2d8;border-radius:5px;margin-top:.5rem;">';
  h += '<span style="font-size:.78rem;color:#8a7f72;">Product: <strong style="color:#4a4139;">' + (r.product_length || 0).toLocaleString() + ' bp</strong></span>';
  if (r.num_fragments) h += '<span style="font-size:.78rem;color:#8a7f72;">Fragments: <strong style="color:#4a4139;">' + r.num_fragments + '</strong></span>';
  h += '<button onclick="_adCopyAllPrimers(\x27' + mode + '\x27)" style="margin-left:auto;padding:.3rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy All Primers</button>';
  h += '</div>';

  // Save primers button
  if (r.primers && r.primers.length > 0) {
    var saveItems = r.primers.map(function(p) { return { seq: p.full_seq, label: p.name || 'assembly primer' }; });
    h += _clRenderSaveBtn(saveItems);
  }

  h += '</div>';
  return h;
}

/* ── Digest-Ligate result renderer ────────────────────────── */
function _clRenderDLResult(r) {
  var h = '<div style="margin-top:.8rem;">';

  // Warnings
  if (r.warnings && r.warnings.length > 0) {
    h += '<div style="background:#fdf2e9;border:1px solid #e8a838;border-radius:5px;padding:.5rem .7rem;margin-bottom:.6rem;">';
    r.warnings.forEach(function(w) { h += '<div style="font-size:.78rem;color:#8a6d3b;">\u26a0\ufe0f ' + esc(w) + '</div>'; });
    h += '</div>';
  }

  // Compatibility
  h += '<div style="font-size:.82rem;margin-bottom:.5rem;padding:.4rem .6rem;border-radius:4px;' + (r.compatible ? 'background:#eef9ee;color:#2d6a2d;' : 'background:#fdf2e9;color:#8a6d3b;') + '">';
  h += (r.compatible ? '\u2705 Ends are compatible' : '\u274c Ends are not compatible') + '</div>';

  // Enzyme info
  if (r.enzyme_info) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Enzyme Details</div>';
    h += '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:.5rem;">';
    Object.keys(r.enzyme_info).forEach(function(ename) {
      var ei = r.enzyme_info[ename];
      h += '<div style="padding:.3rem .5rem;border:1px solid #e8e2d8;border-radius:4px;font-size:.75rem;">';
      h += '<strong style="color:#4a4139;">' + esc(ename) + '</strong>';
      h += ' <span style="color:#8a7f72;">(site: ' + esc(ei.site) + ')</span>';
      h += ' <span style="color:#8a7f72;">Vector cuts: ' + (ei.num_vector_cuts || 0) + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }

  // Sticky ends
  if (r.sticky_ends) {
    h += '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem;">';
    Object.keys(r.sticky_ends).forEach(function(ename) {
      var se = r.sticky_ends[ename];
      h += '<span style="font-size:.75rem;padding:.2rem .5rem;background:#f0ebe3;border-radius:3px;color:#4a4139;">' + esc(ename) + ': ' + se.type.replace('_', '\u2032 ') + ' overhang (' + se.length + 'bp)</span>';
    });
    h += '</div>';
  }

  // Vector digest fragments
  if (r.vector_digest && r.vector_digest.fragments) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;">Vector Digest Fragments</div>';
    h += '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.5rem;">';
    r.vector_digest.fragments.forEach(function(f, i) {
      h += '<span style="font-size:.75rem;padding:.2rem .5rem;background:' + (i === 0 ? '#eef4ee' : '#f0ebe3') + ';border:1px solid #d5cec0;border-radius:3px;color:#4a4139;font-family:\'SF Mono\',Monaco,Consolas,monospace;">' + f.size.toLocaleString() + ' bp' + (i === 0 ? ' (backbone)' : '') + '</span>';
    });
    h += '</div>';
  }

  // Primers
  if (r.primers && r.primers.length > 0) {
    h += '<div style="font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.3rem;margin-top:.5rem;">Primers (add RE sites to insert)</div>';
    r.primers.forEach(function(p, pi) {
      h += _clRenderTailedPrimer(p.name || ('Primer ' + (pi + 1)), p, pi === 0 ? '#2980b9' : '#8e44ad', 'ad-dl-' + pi, null);
    });

    // Product summary
    h += '<div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;padding:.5rem .7rem;background:#faf8f4;border:1px solid #e8e2d8;border-radius:5px;margin-top:.5rem;">';
    h += '<span style="font-size:.78rem;color:#8a7f72;">Expected product: <strong style="color:#4a4139;">' + (r.product_length || 0).toLocaleString() + ' bp</strong> (circular)</span>';
    h += '<button onclick="_adCopyAllPrimers(\x27digestligate\x27)" style="margin-left:auto;padding:.3rem .6rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;background:transparent;cursor:pointer;">\ud83d\udccb Copy Primers</button>';
    h += '</div>';

    var saveItems = r.primers.map(function(p) { return { seq: p.full_seq, label: p.name || 'DL primer' }; });
    h += _clRenderSaveBtn(saveItems);
  }

  h += '</div>';
  return h;
}

/* ═══════════════════════════════════════════════════════════
   ASSEMBLY DESIGNER ACTION HANDLERS
   ═══════════════════════════════════════════════════════════ */
function _adToggle() { _cl.ad.expanded = !_cl.ad.expanded; _cl.ad._libPicker = null; _clRender(); }
function _adSetMode(m) { _cl.ad.mode = m; _cl.ad._libPicker = null; _clRender(); }

// ── Library picker
function _adOpenLib(target) {
  if (_cl.ad._libPicker && _cl.ad._libPicker.target === target) {
    _cl.ad._libPicker = null; // toggle off
  } else {
    _cl.ad._libPicker = { target: target, filter: '' };
  }
  _clRender();
  setTimeout(function() { var el = document.getElementById('cl-lib-filter'); if (el) el.focus(); }, 40);
}

function _adCloseLib() {
  _cl.ad._libPicker = null;
  _clRender();
}

function _adLibFilter(val) {
  if (_cl.ad._libPicker) {
    _cl.ad._libPicker.filter = val;
    _clRender();
    setTimeout(function() {
      var el = document.getElementById('cl-lib-filter');
      if (el) { el.focus(); el.setSelectionRange(val.length, val.length); }
    }, 20);
  }
}

function _adLibPick(target, seqType, seqId) {
  // Fetch the parsed sequence from the server, then add it
  _cl.ad._libLoading = true;
  _clRender();
  api('GET', '/api/cloning/sequences/' + seqType + '/' + seqId + '/parse')
    .then(function(data) {
      _cl.ad._libLoading = false;
      _cl.ad._libPicker = null;
      var name = data.name || (seqType + '_' + seqId);
      var seq = data.seq || '';
      if (!seq) { toast('Sequence is empty', true); _clRender(); return; }

      if (target === 'gibson') {
        _cl.ad.gibson.fragments.push({ name: name, seq: seq });
        toast('Added "' + name + '" (' + seq.length + ' bp)');
      } else if (target === 'gibson-vector') {
        _cl.ad.gibson.vector = { name: name, seq: seq, _sourceId: seqType + '_' + seqId };
        toast('Gibson vector set to "' + name + '" (' + seq.length + ' bp)');
      } else if (target === 'gg-vector') {
        _cl.ad.goldengate.vector = { name: name, seq: seq };
        toast('Vector set to "' + name + '" (' + seq.length + ' bp)');
      } else if (target.indexOf('gg-bin-') === 0) {
        var binIdx = parseInt(target.replace('gg-bin-', ''), 10);
        if (_cl.ad.goldengate.bins[binIdx]) {
          _cl.ad.goldengate.bins[binIdx].fragments.push({ name: name, seq: seq });
          toast('Added "' + name + '" to ' + _cl.ad.goldengate.bins[binIdx].name);
        }
      } else if (target === 'dl-vector') {
        _cl.ad.digestligate.vectorSeq = seq;
        _cl.ad.digestligate.vectorName = name;
        toast('Vector set to "' + name + '" (' + seq.length + ' bp)');
      } else if (target === 'dl-insert') {
        _cl.ad.digestligate.insertSeq = seq;
        _cl.ad.digestligate.insertName = name;
        toast('Insert set to "' + name + '" (' + seq.length + ' bp)');
      }
      _clRender();
    })
    .catch(function(err) {
      _cl.ad._libLoading = false;
      toast('Failed to load sequence: ' + (err.message || err), true);
      _clRender();
    });
}

function _adDLClear(which) {
  if (which === 'vector') {
    _cl.ad.digestligate.vectorSeq = '';
    _cl.ad.digestligate.vectorName = '';
  } else {
    _cl.ad.digestligate.insertSeq = '';
    _cl.ad.digestligate.insertName = '';
  }
  _cl.ad.digestligate.result = null;
  _clRender();
}

// ── Fragment management
function _adAddFromLoaded(modeKey) {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var sel = _cl.lastSelection || { start: 0, end: 0 };
  var seq = _cl.parsed.seq;
  var name = _cl.parsed.name || 'fragment';
  var selLen = _clSelLen(sel.start, sel.end);
  if (selLen > 0 && selLen < seq.length) {
    seq = _clGetSelSeq(sel.start, sel.end);
    name = name + ' (' + sel.start + (sel.crossesOrigin ? '\u2192ori\u2192' : '-') + sel.end + ')';
  }
  var frags = _adGetFrags(modeKey);
  frags.push({ name: name, seq: seq });
  toast('Added "' + name + '" (' + seq.length + ' bp)');
  _clRender();
}

function _adAddPaste(modeKey) {
  var raw = prompt('Paste DNA sequence:');
  if (!raw) return;
  var seq = _clCleanSeq(raw);
  if (seq.length < 10) { toast('Sequence too short (min 10bp)', true); return; }
  var name = prompt('Fragment name:', 'Fragment ' + (_adGetFrags(modeKey).length + 1));
  if (!name) name = 'Fragment ' + (_adGetFrags(modeKey).length + 1);
  _adGetFrags(modeKey).push({ name: name, seq: seq });
  toast('Added "' + name + '" (' + seq.length + ' bp)');
  _clRender();
}

function _adGetFrags(modeKey) {
  if (modeKey === 'gibson') return _cl.ad.gibson.fragments;
  return [];
}

function _adFragMove(modeKey, idx, dir) {
  var frags = _adGetFrags(modeKey);
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= frags.length) return;
  var tmp = frags[idx];
  frags[idx] = frags[newIdx];
  frags[newIdx] = tmp;
  _clRender();
}

function _adFragRemove(modeKey, idx) {
  var frags = _adGetFrags(modeKey);
  frags.splice(idx, 1);
  _clRender();
}

// ── Gibson
function _adGibsonSet(field, val) {
  if (field === 'overlapLen') _cl.ad.gibson.overlapLen = parseInt(val, 10) || 25;
  else if (field === 'tmTarget') _cl.ad.gibson.tmTarget = parseInt(val, 10) || 62;
}

function _adGibsonUseAsVec() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  _cl.ad.gibson.vector = {
    name: _cl.parsed.name || 'vector',
    seq: _cl.parsed.seq,
    _sourceId: _cl.selected.type + '_' + _cl.selected.id,
  };
  toast('Vector set to "' + (_cl.parsed.name || 'loaded sequence') + '"');
  _clRender();
}

function _adGibsonClearVec() {
  _cl.ad.gibson.vector = null;
  _cl.ad.gibson.result = null;
  _clRender();
}

function _adGibsonAddLoaded() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var sel = _cl.lastSelection || { start: 0, end: 0 };
  var seq = _cl.parsed.seq;
  var name = _cl.parsed.name || 'fragment';
  var selLen = _clSelLen(sel.start, sel.end);
  if (selLen > 0 && selLen < seq.length) {
    seq = _clGetSelSeq(sel.start, sel.end);
    name = name + ' (' + sel.start + (sel.crossesOrigin ? '\u2192ori\u2192' : '-') + sel.end + ')';
  }
  _cl.ad.gibson.fragments.push({ name: name, seq: seq });
  toast('Added "' + name + '" as fragment (' + seq.length + ' bp)');
  _clRender();
}

function _adGibsonDesign() {
  var g = _cl.ad.gibson;
  // Build fragment list: vector first (if set), then inserts
  var allFrags = [];
  if (g.vector) {
    allFrags.push({ name: g.vector.name, seq: g.vector.seq });
  }
  g.fragments.forEach(function(f) { allFrags.push({ name: f.name, seq: f.seq }); });

  if (allFrags.length < 2) { toast('Need at least a vector + 1 insert, or 2+ fragments', true); return; }
  g.designing = true; g.result = null; _clRender();
  api('POST', '/api/cloning/design-gibson', {
    fragments: allFrags, circular: true,
    overlap_length: g.overlapLen, tm_target: g.tmTarget,
  }).then(function(data) {
    g.designing = false; g.result = data; _clRender();
  }).catch(function(err) {
    g.designing = false; toast('Gibson design failed: ' + (err.message || err), true); _clRender();
  });
}

// ── Golden Gate (bin-based)
function _adGGSet(field, val) {
  _cl.ad.goldengate[field] = val;
  if (field === 'enzyme') _clRender();
}

function _adGGAddBin() {
  var idx = _cl.ad.goldengate.bins.length;
  var defaults = ['Promoter', 'RBS', 'CDS', 'Terminator', 'Bin ' + (idx + 1)];
  _cl.ad.goldengate.bins.push({ name: defaults[idx] || 'Bin ' + (idx + 1), fragments: [] });
  _clRender();
}

function _adGGBinRename(bi, val) {
  if (_cl.ad.goldengate.bins[bi]) _cl.ad.goldengate.bins[bi].name = val;
}

function _adGGBinMove(bi, dir) {
  var bins = _cl.ad.goldengate.bins;
  var ni = bi + dir;
  if (ni < 0 || ni >= bins.length) return;
  var tmp = bins[bi]; bins[bi] = bins[ni]; bins[ni] = tmp;
  _clRender();
}

function _adGGBinRemove(bi) {
  _cl.ad.goldengate.bins.splice(bi, 1);
  _cl.ad._libPicker = null;
  _clRender();
}

function _adGGFragFromLoaded(bi) {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  var sel = _cl.lastSelection || { start: 0, end: 0 };
  var seq = _cl.parsed.seq;
  var name = _cl.parsed.name || 'part';
  var selLen = _clSelLen(sel.start, sel.end);
  if (selLen > 0 && selLen < seq.length) {
    seq = _clGetSelSeq(sel.start, sel.end);
    name = name + ' (' + sel.start + (sel.crossesOrigin ? '\u2192ori\u2192' : '-') + sel.end + ')';
  }
  if (_cl.ad.goldengate.bins[bi]) {
    _cl.ad.goldengate.bins[bi].fragments.push({ name: name, seq: seq });
    toast('Added "' + name + '" to ' + _cl.ad.goldengate.bins[bi].name);
  }
  _clRender();
}

function _adGGFragPaste(bi) {
  var raw = prompt('Paste DNA sequence:');
  if (!raw) return;
  var seq = _clCleanSeq(raw);
  if (seq.length < 10) { toast('Sequence too short', true); return; }
  var name = prompt('Part name:', 'Part ' + (_cl.ad.goldengate.bins[bi].fragments.length + 1));
  if (!name) name = 'Part';
  if (_cl.ad.goldengate.bins[bi]) {
    _cl.ad.goldengate.bins[bi].fragments.push({ name: name, seq: seq });
    toast('Added "' + name + '" to ' + _cl.ad.goldengate.bins[bi].name);
  }
  _clRender();
}

function _adGGFragRemove(bi, fi) {
  if (_cl.ad.goldengate.bins[bi]) {
    _cl.ad.goldengate.bins[bi].fragments.splice(fi, 1);
    _clRender();
  }
}

function _adGGLoadVec() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  _cl.ad.goldengate.vector = { name: _cl.parsed.name || 'vector', seq: _cl.parsed.seq };
  toast('Vector set to "' + (_cl.parsed.name || 'loaded') + '"');
  _clRender();
}

function _adGGClearVec() {
  _cl.ad.goldengate.vector = null;
  _clRender();
}

function _adGGDesign() {
  var gg = _cl.ad.goldengate;
  if (gg.bins.length < 1) { toast('Add at least 1 bin with parts', true); return; }
  for (var i = 0; i < gg.bins.length; i++) {
    if (gg.bins[i].fragments.length === 0) { toast('Bin "' + gg.bins[i].name + '" has no parts', true); return; }
  }
  gg.designing = true; gg.result = null; _clRender();
  var binsData = gg.bins.map(function(b) {
    return { name: b.name, fragments: b.fragments.map(function(f) { return { name: f.name, seq: f.seq }; }) };
  });
  var body = { bins: binsData, enzyme: gg.enzyme, circular: true, tm_target: 62 };
  if (gg.vector) { body.vector = { name: gg.vector.name, seq: gg.vector.seq }; }
  api('POST', '/api/cloning/design-goldengate', body).then(function(data) {
    gg.designing = false; gg.result = data; _clRender();
  }).catch(function(err) {
    gg.designing = false; toast('Golden Gate design failed: ' + (err.message || err), true); _clRender();
  });
}

// ── Digest-Ligate
function _adDLSet(field, val) {
  _cl.ad.digestligate[field] = val;
}

function _adDLLoadVector() {
  if (!_cl.parsed) { toast('Load a sequence first', true); return; }
  _cl.ad.digestligate.vectorSeq = _cl.parsed.seq;
  _cl.ad.digestligate.vectorName = _cl.parsed.name || 'vector';
  toast('Vector set to "' + (_cl.parsed.name || 'loaded sequence') + '"');
  _clRender();
}

function _adDLDesign() {
  var dl = _cl.ad.digestligate;
  var vecSeq = _clCleanSeq(dl.vectorSeq);
  var insSeq = _clCleanSeq(dl.insertSeq);
  if (!vecSeq) { toast('Provide a vector sequence', true); return; }
  if (!insSeq) { toast('Provide an insert sequence', true); return; }
  if (!dl.enzyme1) { toast('Specify at least one enzyme', true); return; }
  dl.designing = true; dl.result = null; _clRender();
  api('POST', '/api/cloning/design-digest-ligate', {
    vector: { name: dl.vectorName || 'vector', seq: vecSeq },
    insert: { name: dl.insertName || 'insert', seq: insSeq },
    enzyme1: dl.enzyme1.trim(), enzyme2: dl.enzyme2.trim() || null,
    design_primers: true, tm_target: 62,
  }).then(function(data) {
    dl.designing = false; dl.result = data; _clRender();
  }).catch(function(err) {
    dl.designing = false; toast('Digest-Ligate design failed: ' + (err.message || err), true); _clRender();
  });
}

// ── Toggle primer alternatives
function _adToggleAlts(key) {
  window._altExpanded[key] = !window._altExpanded[key];
  _clRender();
}

// ── Copy all primers
function _adCopyAllPrimers(mode) {
  var result = null;
  if (mode === 'gibson') result = _cl.ad.gibson.result;
  else if (mode === 'goldengate') result = _cl.ad.goldengate.result;
  else if (mode === 'digestligate') result = _cl.ad.digestligate.result;
  if (!result || !result.primers || !result.primers.length) { toast('No primers to copy', true); return; }
  var text = result.primers.map(function(p) { return (p.name || 'primer') + ': ' + p.full_seq; }).join('\n');
  navigator.clipboard.writeText(text).then(function() { toast('All primers copied (' + result.primers.length + ')'); });
}

// ── Copy individual assembly primer
function _adCopyPrimer(key) {
  // key format: 'ad-fwd-0', 'ad-rev-1', 'ad-dl-0', etc.
  var parts = key.split('-');
  var mode = parts[0]; // 'ad'
  var dir = parts[1];  // 'fwd', 'rev', 'dl'
  var idx = parseInt(parts[2], 10);
  var result = null;
  if (_cl.ad.mode === 'gibson') result = _cl.ad.gibson.result;
  else if (_cl.ad.mode === 'goldengate') result = _cl.ad.goldengate.result;
  else if (_cl.ad.mode === 'digestligate') result = _cl.ad.digestligate.result;
  if (!result || !result.primers) return;

  // For junction-based modes, map to primer index
  var primerIdx = dir === 'dl' ? idx : (dir === 'fwd' ? idx * 2 : idx * 2 + 1);
  if (result.primers[primerIdx]) {
    navigator.clipboard.writeText(result.primers[primerIdx].full_seq).then(function() { toast('Primer copied'); });
  }
}

/* ── main entry ────────────────────────────────────────────── */
async function renderCloning(el) {
  _clEl = el;
  el.innerHTML = '<div style="text-align:center;padding:3rem;color:#8a7f72;"><div style="font-size:1.4rem;margin-bottom:.5rem;">\u23f3</div>Loading Cloning Workbench\u2026</div>';
  await Promise.all([_clLoadSequences(), _clLoadConfig(), _loadSeqVizDeps()]);
  _clRender();
}

// ── expose globals
window._clSelectSequence = _clSelectSequence;
window._clSetTab = _clSetTab;
window._clToggleView = _clToggleView;
window._clFilterChange = _clFilterChange;
window._clOcFilterChange = _clOcFilterChange;
window._clSendToOC = _clSendToOC;
window._clToggleSidebar = _clToggleSidebar;
window._clToggleOcSidebar = _clToggleOcSidebar;
window._clToggleFeatures = _clToggleFeatures;
window._clReindex = _clReindex;
window._clSearchToggle = _clSearchToggle;
window._clSearchRun = _clSearchRun;
window._clSearchNext = _clSearchNext;
window._clSearchPrev = _clSearchPrev;
window._clFeatColor = _clFeatColor;
window._clFeatDir = _clFeatDir;
window._clFeatEdit = _clFeatEdit;
window._clFeatAdd = _clFeatAdd;
window._clFeatRemove = _clFeatRemove;
window._clFeatModalClose = _clFeatModalClose;
window._clFeatModalSave = _clFeatModalSave;
window._clFeatSetDir = _clFeatSetDir;
window._clFeatRevert = _clFeatRevert;
window._clFeatSave = _clFeatSave;
window._pdToggle = _pdToggle;
window._pdSetMode = _pdSetMode;
window._pdCustomSet = _pdCustomSet;
window._pdCustomDesign = _pdCustomDesign;
window._pdPcrSet = _pdPcrSet;
window._pdPcrDesign = _pdPcrDesign;
window._pdSeqSet = _pdSeqSet;
window._pdSeqDesign = _pdSeqDesign;
window._pdKldSet = _pdKldSet;
window._pdKldDesign = _pdKldDesign;
window._pdKldSelectPrimer = _pdKldSelectPrimer;
window._pdCopy = _pdCopy;
window._pdCopyBoth = _pdCopyBoth;
window._pdSavePrimers = _pdSavePrimers;
window._pdGenerateProduct = _pdGenerateProduct;
window._pdSaveProduct = _pdSaveProduct;
window._pdExitProductPreview = _pdExitProductPreview;
window._saToggle = _saToggle;
window._saSetMode = _saSetMode;
window._saOrfSetMin = _saOrfSetMin;
window._saOrfRun = _saOrfRun;
window._saOrfToggleMap = _saOrfToggleMap;
window._saOrfExpand = _saOrfExpand;
window._saOrfCopyProt = _saOrfCopyProt;
window._saOrfCopyDna = _saOrfCopyDna;
window._saOrfToggleOne = _saOrfToggleOne;
window._saOrfAddFeature = _saOrfAddFeature;
window._clAddAsFeature = _clAddAsFeature;
window._saReSetEnz = _saReSetEnz;
window._saReRun = _saReRun;
window._saReToggleMap = _saReToggleMap;
window._saReFilter = _saReFilter;
window._saToolsInput = _saToolsInput;
window._saToolsRun = _saToolsRun;
window._saToolsTm = _saToolsTm;
window._saToolsCopy = _saToolsCopy;
window._saDigestSetEnz = _saDigestSetEnz;
window._saDigestQuickAdd = _saDigestQuickAdd;
window._saDigestRun = _saDigestRun;
window._saBlastSetSeq = _saBlastSetSeq;
window._saBlastSet = _saBlastSet;
window._saBlastExpand = _saBlastExpand;
window._saBlastRun = _saBlastRun;
window._saScanRun = _saScanRun;
window._saScanToggleMap = _saScanToggleMap;
window._saScanFilter = _saScanFilter;
window._saScanAddFeature = _saScanAddFeature;
window._adToggle = _adToggle;
window._adSetMode = _adSetMode;
window._adOpenLib = _adOpenLib;
window._adCloseLib = _adCloseLib;
window._adLibFilter = _adLibFilter;
window._adLibPick = _adLibPick;
window._adDLClear = _adDLClear;
window._adAddFromLoaded = _adAddFromLoaded;
window._adAddPaste = _adAddPaste;
window._adFragMove = _adFragMove;
window._adFragRemove = _adFragRemove;
window._adGibsonSet = _adGibsonSet;
window._adGibsonDesign = _adGibsonDesign;
window._adGibsonUseAsVec = _adGibsonUseAsVec;
window._adGibsonClearVec = _adGibsonClearVec;
window._adGibsonAddLoaded = _adGibsonAddLoaded;
window._adGGSet = _adGGSet;
window._adGGAddBin = _adGGAddBin;
window._adGGBinRename = _adGGBinRename;
window._adGGBinMove = _adGGBinMove;
window._adGGBinRemove = _adGGBinRemove;
window._adGGFragFromLoaded = _adGGFragFromLoaded;
window._adGGFragPaste = _adGGFragPaste;
window._adGGFragRemove = _adGGFragRemove;
window._adGGLoadVec = _adGGLoadVec;
window._adGGClearVec = _adGGClearVec;
window._adGGDesign = _adGGDesign;
window._adDLSet = _adDLSet;
window._adDLLoadVector = _adDLLoadVector;
window._adDLDesign = _adDLDesign;
window._adCopyAllPrimers = _adCopyAllPrimers;
window._adToggleAlts = _adToggleAlts;
window._adCopyPrimer = _adCopyPrimer;

registerView('cloning', renderCloning);
