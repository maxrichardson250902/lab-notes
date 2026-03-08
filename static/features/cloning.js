// Cloning feature — sequence viewer + OpenCloning bridge

/* ── state ─────────────────────────────────────────────────── */
var _cl = {
  sequences: [],
  selected: null,      // { type, id }
  parsed: null,        // parsed SeqViz data
  loading: false,
  tab: 'viewer',       // 'viewer' | 'opencloning'
  seqvizReady: false,
  ocUrl: '',
  viewerInstance: null,
  viewMode: 'both',    // 'both' | 'circular' | 'linear'
  filter: '',
  ocFilter: '',
};

/* ── script loader ─────────────────────────────────────────── */
var _scriptsLoaded = false;
var _scriptsLoading = false;

function _loadScript(src) {
  return new Promise(function(resolve, reject) {
    // check if already loaded
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
      toast('Could not load SeqViz viewer — check internet connection', true);
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

  // Clear previous
  el.innerHTML = '';

  var showLinear = _cl.viewMode === 'linear' || _cl.viewMode === 'both';
  var showCircular = _cl.viewMode === 'circular' || _cl.viewMode === 'both';

  // Determine topology
  var isCircular = (_cl.parsed.topology || '').toLowerCase() === 'circular';

  try {
    var viewerProps = {
      name: _cl.parsed.name || 'Sequence',
      seq: _cl.parsed.seq,
      annotations: (_cl.parsed.annotations || []).map(function(a) {
        return {
          name: a.name,
          start: a.start,
          end: a.end,
          direction: a.direction || 1,
          color: a.color || '#95A5A6',
        };
      }),
      style: { height: '100%', width: '100%' },
      viewer: _cl.viewMode === 'both' ? 'both' :
              _cl.viewMode === 'circular' ? 'circular' : 'linear',
      showComplement: true,
      showIndex: true,
      zoom: { linear: 50 },
    };

    // SeqViz vanilla JS API
    if (window.seqviz.Viewer && typeof window.seqviz.Viewer === 'function') {
      // Try the vanilla Viewer(element, props).render() API
      try {
        window.seqviz.Viewer(el, viewerProps).render();
        return;
      } catch (e) { /* fall through to React approach */ }
    }

    // React approach fallback
    if (window.React && window.ReactDOM) {
      var SeqVizComp = window.seqviz.SeqViz || window.seqviz.default || window.seqviz;
      if (SeqVizComp) {
        var root;
        if (window.ReactDOM.createRoot) {
          root = window.ReactDOM.createRoot(el);
          root.render(window.React.createElement(SeqVizComp, viewerProps));
        } else {
          window.ReactDOM.render(window.React.createElement(SeqVizComp, viewerProps), el);
        }
      }
    }
  } catch (err) {
    console.error('SeqViz render error:', err);
    el.innerHTML = '<div style="padding:2rem;color:#8a7f72;">Viewer failed to render. Try refreshing the page.</div>';
  }
}

/* ── main render ───────────────────────────────────────────── */
var _clEl = null;
function _clRender() {
  if (!_clEl) return;

  var h = '';

  // ── Header
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;flex-wrap:wrap;gap:.6rem;">';
  h += '<div>';
  h += '<h2 style="margin:0;font-size:1.25rem;color:#4a4139;">Cloning Workbench</h2>';
  h += '<p style="margin:.2rem 0 0;font-size:.82rem;color:#8a7f72;">Browse sequences, view maps, plan assemblies in OpenCloning</p>';
  h += '</div>';
  h += '<div style="display:flex;gap:.5rem;align-items:center;">';
  // Tab switcher
  h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;">';
  h += '<button onclick="_clSetTab(\'viewer\')" style="padding:.35rem .8rem;font-size:.78rem;border:none;cursor:pointer;' +
       (_cl.tab === 'viewer' ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') +
       '">Sequence Viewer</button>';
  h += '<button onclick="_clSetTab(\'opencloning\')" style="padding:.35rem .8rem;font-size:.78rem;border:none;cursor:pointer;' +
       (_cl.tab === 'opencloning' ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') +
       '">OpenCloning</button>';
  h += '</div>';
  h += '</div></div>';

  if (_cl.tab === 'viewer') {
    h += _clRenderViewerTab();
  } else {
    h += _clRenderOCTab();
  }

  _clEl.innerHTML = h;

  // Re-render SeqViz after DOM update
  if (_cl.tab === 'viewer' && _cl.parsed) {
    setTimeout(function() { _clRenderSeqViz(); }, 30);
  }
}

/* ── Viewer tab ────────────────────────────────────────────── */
function _clRenderViewerTab() {
  var h = '<div style="display:grid;grid-template-columns:280px 1fr;gap:1rem;min-height:750px;">';

  // ── Left panel: sequence list
  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;overflow:hidden;display:flex;flex-direction:column;">';

  // Search
  h += '<div style="padding:.6rem;border-bottom:1px solid #e8e2d8;">';
  h += '<input type="text" placeholder="Filter sequences…" value="' + esc(_cl.filter) + '" ' +
       'oninput="_clFilterChange(this.value)" ' +
       'style="width:100%;box-sizing:border-box;padding:.4rem .6rem;border:1px solid #d5cec0;border-radius:4px;background:#faf8f4;font-size:.8rem;color:#4a4139;" />';
  h += '</div>';

  // Section: Plasmids
  var plasmids = _cl.sequences.filter(function(s) { return s.type === 'plasmid' && s.has_file; });
  var primers = _cl.sequences.filter(function(s) { return s.type === 'primer' && s.has_file; });

  if (_cl.filter) {
    var f = _cl.filter.toLowerCase();
    plasmids = plasmids.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1; });
    primers = primers.filter(function(s) { return s.name.toLowerCase().indexOf(f) !== -1; });
  }

  h += '<div style="flex:1;overflow-y:auto;padding:.4rem 0;">';

  if (plasmids.length > 0) {
    h += '<div style="padding:.3rem .7rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;">Plasmids</div>';
    plasmids.forEach(function(s) {
      var isActive = _cl.selected && _cl.selected.type === s.type && _cl.selected.id === s.id;
      h += '<div onclick="_clSelectSequence(\'' + s.type + '\',' + s.id + ')" ' +
           'style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid #f0ebe3;' +
           (isActive ? 'background:#eef4ee;border-left:3px solid #5b7a5e;' : 'border-left:3px solid transparent;') +
           'transition:background .15s;" ' +
           'onmouseover="this.style.background=\'' + (isActive ? '#eef4ee' : '#f5f1eb') + '\'" ' +
           'onmouseout="this.style.background=\'' + (isActive ? '#eef4ee' : 'transparent') + '\'">';
      h += '<div style="font-size:.85rem;font-weight:500;color:#4a4139;">' + esc(s.name) + '</div>';
      if (s.use) h += '<div style="font-size:.72rem;color:#8a7f72;margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.use) + '</div>';
      h += '</div>';
    });
  }

  if (primers.length > 0) {
    h += '<div style="padding:.3rem .7rem;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;margin-top:.2rem;">Primers</div>';
    primers.forEach(function(s) {
      var isActive = _cl.selected && _cl.selected.type === s.type && _cl.selected.id === s.id;
      h += '<div onclick="_clSelectSequence(\'' + s.type + '\',' + s.id + ')" ' +
           'style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid #f0ebe3;' +
           (isActive ? 'background:#eef4ee;border-left:3px solid #5b7a5e;' : 'border-left:3px solid transparent;') +
           'transition:background .15s;" ' +
           'onmouseover="this.style.background=\'' + (isActive ? '#eef4ee' : '#f5f1eb') + '\'" ' +
           'onmouseout="this.style.background=\'' + (isActive ? '#eef4ee' : 'transparent') + '\'">';
      h += '<div style="font-size:.85rem;font-weight:500;color:#4a4139;">' + esc(s.name) + '</div>';
      if (s.sequence) h += '<div style="font-size:.7rem;color:#8a7f72;margin-top:.15rem;font-family:\'SF Mono\',Monaco,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">' + esc(s.sequence.substring(0, 40)) + (s.sequence.length > 40 ? '…' : '') + '</div>';
      h += '</div>';
    });
  }

  if (plasmids.length === 0 && primers.length === 0) {
    h += '<div style="padding:1.5rem;text-align:center;color:#8a7f72;font-size:.82rem;">';
    if (_cl.filter) {
      h += 'No sequences match your filter.';
    } else {
      h += 'No sequences with GenBank files found.<br><br>';
      h += '<span style="font-size:.75rem;">Import plasmids or primers with .gb files in DNA Manager first.</span>';
    }
    h += '</div>';
  }

  h += '</div>'; // scroll container
  h += '</div>'; // left panel

  // ── Right panel: viewer
  h += '<div style="border:1px solid #d5cec0;border-radius:6px;background:#fff;display:flex;flex-direction:column;overflow:hidden;">';

  if (_cl.loading) {
    h += '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#8a7f72;">';
    h += '<div style="text-align:center;"><div style="font-size:1.6rem;margin-bottom:.5rem;">⏳</div><div style="font-size:.85rem;">Parsing GenBank file…</div></div>';
    h += '</div>';
  } else if (_cl.parsed) {
    // Toolbar
    h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.55rem .8rem;border-bottom:1px solid #e8e2d8;flex-wrap:wrap;gap:.4rem;">';

    // Left: name + stats
    h += '<div>';
    h += '<span style="font-weight:600;color:#4a4139;font-size:.9rem;">' + esc(_cl.parsed.name) + '</span>';
    h += '<span style="font-size:.75rem;color:#8a7f72;margin-left:.6rem;">' + _cl.parsed.length.toLocaleString() + ' bp</span>';
    h += '<span style="font-size:.72rem;color:#8a7f72;margin-left:.5rem;padding:.15rem .4rem;background:#f0ebe3;border-radius:3px;">' + esc(_cl.parsed.topology) + '</span>';
    h += '<span style="font-size:.72rem;color:#8a7f72;margin-left:.4rem;">' + (_cl.parsed.annotations || []).length + ' features</span>';
    h += '</div>';

    // Right: view mode + actions
    h += '<div style="display:flex;gap:.3rem;align-items:center;">';
    // View mode toggle
    h += '<div style="display:flex;border:1px solid #d5cec0;border-radius:4px;overflow:hidden;margin-right:.4rem;">';
    ['both', 'circular', 'linear'].forEach(function(mode) {
      var label = mode === 'both' ? 'Both' : mode === 'circular' ? '⭕' : '━━';
      h += '<button onclick="_clSetViewMode(\'' + mode + '\')" style="padding:.25rem .5rem;font-size:.72rem;border:none;cursor:pointer;' +
           (_cl.viewMode === mode ? 'background:#5b7a5e;color:#fff;' : 'background:#faf8f4;color:#4a4139;') +
           '" title="' + mode + ' view">' + label + '</button>';
    });
    h += '</div>';

    // Download .gb
    h += '<a href="/api/' + esc(_cl.selected.type) + 's/' + _cl.selected.id + '/gb" download ' +
         'style="padding:.25rem .5rem;font-size:.72rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:4px;text-decoration:none;" title="Download .gb file">⬇ .gb</a>';

    // Send to OpenCloning (export as CloningStrategy JSON)
    h += '<button onclick="_clSendToOC()" style="padding:.25rem .5rem;font-size:.72rem;background:#5b7a5e;color:#fff;border:none;border-radius:4px;cursor:pointer;" title="Export as OpenCloning JSON — load it in OC via Load file">📤 Send to OC</button>';
    h += '</div></div>';

    // SeqViz mount point
    h += '<div id="cl-seqviz-mount" style="flex:1;min-height:600px;background:#fff;"></div>';

    // Features table
    if (_cl.parsed.annotations && _cl.parsed.annotations.length > 0) {
      h += '<div style="border-top:1px solid #e8e2d8;max-height:220px;overflow-y:auto;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">';
      h += '<thead><tr style="background:#faf8f4;">';
      h += '<th style="text-align:left;padding:.35rem .6rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Feature</th>';
      h += '<th style="text-align:left;padding:.35rem .6rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Type</th>';
      h += '<th style="text-align:left;padding:.35rem .6rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Location</th>';
      h += '<th style="text-align:left;padding:.35rem .6rem;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;">Dir</th>';
      h += '</tr></thead><tbody>';
      _cl.parsed.annotations.forEach(function(a) {
        h += '<tr style="border-bottom:1px solid #f0ebe3;">';
        h += '<td style="padding:.3rem .6rem;color:#4a4139;"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + esc(a.color) + ';margin-right:.4rem;vertical-align:middle;"></span>' + esc(a.name) + '</td>';
        h += '<td style="padding:.3rem .6rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.72rem;">' + esc(a.type) + '</td>';
        h += '<td style="padding:.3rem .6rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.72rem;">' + a.start + '..' + a.end + '</td>';
        h += '<td style="padding:.3rem .6rem;color:#8a7f72;">' + (a.direction === 1 ? '→' : '←') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }
  } else {
    // Empty state
    h += '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#8a7f72;">';
    h += '<div style="text-align:center;max-width:280px;">';
    h += '<div style="font-size:2.5rem;margin-bottom:.7rem;opacity:.5;">🧬</div>';
    h += '<div style="font-size:.95rem;font-weight:500;color:#4a4139;margin-bottom:.3rem;">Select a sequence</div>';
    h += '<div style="font-size:.8rem;">Choose a plasmid or primer from the left panel to view its sequence map and features.</div>';
    h += '</div></div>';
  }

  h += '</div>'; // right panel
  h += '</div>'; // grid

  return h;
}

/* ── OpenCloning tab (sidebar + iframe) ────────────────────── */
function _clRenderOCTab() {
  var h = '';

  if (!_cl.ocUrl) {
    h += '<div style="text-align:center;padding:3rem 1rem;color:#8a7f72;border:1px solid #d5cec0;border-radius:6px;background:#fff;">';
    h += '<div style="font-size:2rem;margin-bottom:.5rem;opacity:.5;">⚠️</div>';
    h += '<div style="font-size:.9rem;margin-bottom:.3rem;">OpenCloning URL not configured</div>';
    h += '<div style="font-size:.8rem;">Set <code>OPENCLONING_URL</code> environment variable in docker-compose.yml</div>';
    h += '</div>';
    return h;
  }

  h += '<div style="display:flex;gap:0;height:750px;">';

  // ── Left sidebar: searchable sequence list with download buttons
  h += '<div style="width:240px;min-width:240px;border:1px solid #d5cec0;border-right:none;border-radius:6px 0 0 6px;background:#fff;display:flex;flex-direction:column;overflow:hidden;">';

  // Header
  h += '<div style="padding:.5rem .6rem;border-bottom:1px solid #e8e2d8;background:#faf8f4;">';
  h += '<div style="font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:#8a7f72;font-weight:600;margin-bottom:.4rem;">Your Sequences</div>';
  h += '<input type="text" placeholder="Search…" value="' + esc(_cl.ocFilter || '') + '" ' +
       'oninput="_clOcFilterChange(this.value)" ' +
       'style="width:100%;box-sizing:border-box;padding:.35rem .5rem;border:1px solid #d5cec0;border-radius:4px;background:#fff;font-size:.78rem;color:#4a4139;" />';
  h += '</div>';

  // Sequence list
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
      h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;border-bottom:1px solid #f0ebe3;transition:background .1s;" ' +
           'onmouseover="this.style.background=\'#f5f1eb\'" onmouseout="this.style.background=\'transparent\'">';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:.8rem;font-weight:500;color:#4a4139;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>';
      if (s.use) h += '<div style="font-size:.65rem;color:#8a7f72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.use) + '</div>';
      h += '</div>';
      h += '<a href="/api/plasmids/' + s.id + '/gb" download style="flex-shrink:0;margin-left:.4rem;padding:.2rem .4rem;font-size:.68rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;text-decoration:none;white-space:nowrap;" title="Download .gb">⬇ .gb</a>';
      h += '</div>';
    });
  }

  if (primers.length > 0) {
    h += '<div style="padding:.3rem .6rem;font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:#8a7f72;font-weight:600;border-bottom:1px solid #e8e2d8;background:#faf8f4;' + (plasmids.length > 0 ? 'margin-top:.2rem;' : '') + '">Primers</div>';
    primers.forEach(function(s) {
      h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;border-bottom:1px solid #f0ebe3;transition:background .1s;" ' +
           'onmouseover="this.style.background=\'#f5f1eb\'" onmouseout="this.style.background=\'transparent\'">';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:.8rem;font-weight:500;color:#4a4139;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>';
      if (s.sequence) h += '<div style="font-size:.62rem;color:#8a7f72;font-family:\'SF Mono\',Monaco,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.sequence.substring(0, 30)) + '</div>';
      h += '</div>';
      h += '<a href="/api/primers/' + s.id + '/gb" download style="flex-shrink:0;margin-left:.4rem;padding:.2rem .4rem;font-size:.68rem;color:#5b7a5e;border:1px solid #5b7a5e;border-radius:3px;text-decoration:none;white-space:nowrap;" title="Download .gb">⬇ .gb</a>';
      h += '</div>';
    });
  }

  if (plasmids.length === 0 && primers.length === 0) {
    h += '<div style="padding:1.5rem .6rem;text-align:center;color:#8a7f72;font-size:.78rem;">';
    h += _cl.ocFilter ? 'No matches.' : 'No .gb files found.';
    h += '</div>';
  }

  h += '</div>'; // scroll
  h += '</div>'; // sidebar

  // ── Right: iframe
  h += '<div style="flex:1;border:1px solid #d5cec0;border-radius:0 6px 6px 0;overflow:hidden;">';
  h += '<iframe src="' + esc(_cl.ocUrl) + '" ' +
       'style="width:100%;height:100%;border:none;display:block;" ' +
       'title="OpenCloning">' +
       '</iframe>';
  h += '</div>';

  h += '</div>'; // flex container

  return h;
}

/* ── actions ───────────────────────────────────────────────── */
function _clSetTab(tab) {
  _cl.tab = tab;
  _clRender();
}

function _clSetViewMode(mode) {
  _cl.viewMode = mode;
  _clRender();
}

function _clFilterChange(val) {
  _cl.filter = val;
  _clRender();
}

function _clOcFilterChange(val) {
  _cl.ocFilter = val;
  _clRender();
}

function _clOpenInOC() {
  if (!_cl.ocUrl) return;
  window.open(_cl.ocUrl, '_blank');
}

function _clSendToOC() {
  if (!_cl.selected || !_cl.parsed) {
    toast('Select and load a sequence first', true);
    return;
  }

  var seqName = _cl.parsed.name || 'Sequence';
  fetch('/api/cloning/export/' + _cl.selected.type + '/' + _cl.selected.id)
    .then(function(r) { if (!r.ok) throw new Error('Export failed'); return r.json(); })
    .then(function(strategy) {
      var blob = new Blob([JSON.stringify(strategy, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = seqName + '_opencloning.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('JSON exported — in OpenCloning click ☰ menu → Load file');
    })
    .catch(function(err) {
      toast('Failed to export: ' + (err.message || err), true);
    });
}

/* ── main entry ────────────────────────────────────────────── */
async function renderCloning(el) {
  _clEl = el;
  el.innerHTML = '<div style="text-align:center;padding:3rem;color:#8a7f72;"><div style="font-size:1.4rem;margin-bottom:.5rem;">⏳</div>Loading Cloning Workbench…</div>';

  // Load everything in parallel
  await Promise.all([
    _clLoadSequences(),
    _clLoadConfig(),
    _loadSeqVizDeps(),
  ]);

  _clRender();
}

// ── expose globals for inline handlers
window._clSelectSequence = _clSelectSequence;
window._clSetTab = _clSetTab;
window._clSetViewMode = _clSetViewMode;
window._clFilterChange = _clFilterChange;
window._clOcFilterChange = _clOcFilterChange;
window._clOpenInOC = _clOpenInOC;
window._clSendToOC = _clSendToOC;

// ── register
registerView('cloning', renderCloning);
