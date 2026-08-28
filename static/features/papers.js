/* Papers / Literature — reference library with cross-entity linking.
   Views: list → detail / new / edit
   Global helpers (called from other features):
     - window.papersOpenPicker(onSelect)         : open the picker modal
     - window.papersRenderReferencesInto(el, entity_type, entity_id, opts)
         renders a full "References" panel into `el` and wires add/remove.
*/

var PP = {
  view: 'list',      // 'list' | 'detail' | 'new' | 'edit'
  items: [],
  current: null,     // {paper, links}
  search: '',
  tagFilter: '',
  loading: false,
  lookupBusy: false,
};

/* ── entity_type label pretty-printer, used by backlinks display ─── */
var ENTITY_LABELS = {
  protocol: 'Protocol',
  workflow_day: 'Workflow day',
  workflow_entry: 'Workflow entry',
  pipeline_step: 'Pipeline step',
  reminder: 'Reminder',
  project: 'Project',
};

function ppFmtEntity(type, id) {
  var label = ENTITY_LABELS[type] || type;
  return label + ' ' + id;
}

/* ── entry point (view dispatcher) ────────────────────────────────── */
async function renderPapers(el) {
  el.innerHTML = ppStyles() + '<div id="pp-root">Loading…</div>';
  var root = document.getElementById('pp-root');
  try {
    if (PP.view === 'detail') return await renderPaperDetail(root);
    if (PP.view === 'new')    return renderPaperForm(root, null);
    if (PP.view === 'edit')   return renderPaperForm(root, PP.current && PP.current.paper);
    return await renderPapersList(root);
  } catch (e) {
    root.innerHTML = '<div class="pp-empty">Failed to load: ' + esc(String(e)) + '</div>';
  }
}

function ppNav(view) {
  PP.view = view || 'list';
  setView('papers');
}

/* ── LIST VIEW ────────────────────────────────────────────────────── */
async function renderPapersList(el) {
  var data = await api('GET', '/api/papers' +
    (PP.search ? ('?q=' + encodeURIComponent(PP.search)) : ''));
  PP.items = data.items || [];

  var h = '';
  h += '<div class="pp-header">';
  h += '<div class="pp-title">Papers</div>';
  h += '<input type="text" class="pp-search" id="pp-search" placeholder="Search title, authors, journal, DOI…" value="' +
       esc(PP.search) + '">';
  h += '<button class="pp-btn-pri" onclick="ppNav(\'new\')">+ Add paper</button>';
  h += '</div>';

  if (!PP.items.length) {
    if (PP.search) {
      h += '<div class="pp-empty">No papers match "' + esc(PP.search) + '".</div>';
    } else {
      h += '<div class="pp-empty">' +
           '<div style="font-size:1.05rem;margin-bottom:6px">No papers yet.</div>' +
           '<div style="font-size:.85rem">Paste a DOI to get started — Crossref fills in the rest.</div>' +
           '<div style="margin-top:14px"><button class="pp-btn-pri" onclick="ppNav(\'new\')">+ Add your first paper</button></div>' +
           '</div>';
    }
  } else {
    h += '<div class="pp-table-wrap"><table class="pp-table">';
    h += '<thead><tr><th style="width:60px">Year</th><th>Title</th><th style="width:220px">Authors</th><th style="width:180px">Journal</th><th style="width:120px">Tags</th></tr></thead><tbody>';
    PP.items.forEach(function(p) {
      var authors = (p.authors || []);
      var authText = authors.length === 0 ? '' :
                     authors.length === 1 ? authors[0] :
                     authors.length <= 3  ? authors.join(', ') :
                                            authors[0] + ' et al.';
      var tags = (p.tags || []).map(function(t) {
        return '<span class="pp-tag">' + esc(t) + '</span>';
      }).join('');
      h += '<tr class="pp-row" onclick="ppOpenDetail(' + p.id + ')">';
      h += '<td class="pp-year">' + (p.year || '—') + '</td>';
      h += '<td class="pp-titlecell">' + esc(p.title || '(untitled)') + '</td>';
      h += '<td class="pp-authors">' + esc(authText) + '</td>';
      h += '<td class="pp-journal">' + esc(p.journal || '') + '</td>';
      h += '<td>' + tags + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="pp-count">' + PP.items.length + ' paper' +
         (PP.items.length === 1 ? '' : 's') + '</div>';
  }

  el.innerHTML = h;

  // Debounced search
  var input = document.getElementById('pp-search');
  if (input) {
    var t;
    input.addEventListener('input', function() {
      clearTimeout(t);
      t = setTimeout(function() {
        PP.search = input.value;
        renderPapersList(el);
      }, 200);
    });
    input.focus();
  }
}

async function ppOpenDetail(pid) {
  PP.view = 'detail';
  try {
    PP.current = await api('GET', '/api/papers/' + pid);
    setView('papers');
  } catch (e) {
    toast('Could not open paper', true);
  }
}

/* ── DETAIL VIEW ──────────────────────────────────────────────────── */
async function renderPaperDetail(el) {
  if (!PP.current) { PP.view = 'list'; return renderPapersList(el); }
  var p = PP.current.paper;
  var links = PP.current.links || [];

  var authors = (p.authors || []).join(', ');
  var tags = (p.tags || []).map(function(t) {
    return '<span class="pp-tag">' + esc(t) + '</span>';
  }).join('');

  var doiHtml = '';
  if (p.doi) {
    doiHtml = '<a href="https://doi.org/' + encodeURIComponent(p.doi) +
              '" target="_blank" rel="noopener" class="pp-doi-badge">DOI: ' +
              esc(p.doi) + '</a>';
  }
  var urlHtml = '';
  if (p.url && p.url !== 'https://doi.org/' + p.doi) {
    urlHtml = '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" class="pp-url-link">' +
              'Open ↗</a>';
  }

  var h = '';
  h += '<div style="margin-bottom:18px">';
  h += '<button class="pp-btn-ghost" onclick="ppNav(\'list\')">← Papers</button>';
  h += '</div>';

  h += '<div class="pp-detail">';
  h += '<div class="pp-detail-title">' + esc(p.title) + '</div>';
  if (authors) {
    h += '<div class="pp-detail-authors">' + esc(authors) + '</div>';
  }
  if (p.journal || p.year) {
    var meta = [p.journal, p.year].filter(Boolean).join(' · ');
    h += '<div class="pp-detail-meta">' + esc(meta) + '</div>';
  }

  if (doiHtml || urlHtml) {
    h += '<div class="pp-detail-links">' + doiHtml + urlHtml + '</div>';
  }

  if (tags) {
    h += '<div style="margin-top:12px">' + tags + '</div>';
  }

  if (p.abstract) {
    h += '<div class="pp-section-hdr">Abstract</div>';
    h += '<div class="pp-abstract">' + esc(p.abstract) + '</div>';
  }

  if (p.notes) {
    h += '<div class="pp-section-hdr">Notes</div>';
    h += '<div class="pp-notes">' + esc(p.notes) + '</div>';
  }

  // Backlinks — what other things reference this paper
  h += '<div class="pp-section-hdr">Referenced from</div>';
  if (links.length === 0) {
    h += '<div style="color:#8a7f72;font-size:.85rem">Nothing links to this paper yet.</div>';
  } else {
    h += '<div class="pp-backlinks">';
    links.forEach(function(l) {
      h += '<div class="pp-backlink">' +
           '<span class="pp-backlink-type">' + esc(ENTITY_LABELS[l.entity_type] || l.entity_type) + '</span>' +
           '<span class="pp-backlink-id">' + esc(l.entity_id) + '</span>' +
           '</div>';
    });
    h += '</div>';
  }

  h += '<div class="pp-actions">';
  h += '<button class="pp-btn-pri" onclick="ppNav(\'edit\')">Edit</button>';
  h += '<button class="pp-btn-ghost" onclick="ppDelete(' + p.id + ')">Delete</button>';
  h += '</div>';

  h += '</div>';

  el.innerHTML = h;
}

async function ppDelete(pid) {
  var linked = (PP.current && PP.current.links || []).length;
  var msg = 'Delete this paper?';
  if (linked > 0) {
    msg = 'This paper is linked from ' + linked + ' place' + (linked === 1 ? '' : 's') +
          '. Delete it anyway? Those references will be removed.';
  }
  if (!confirm(msg)) return;
  try {
    await api('DELETE', '/api/papers/' + pid);
    toast('Paper deleted');
    PP.view = 'list';
    PP.current = null;
    setView('papers');
  } catch (e) {
    toast('Delete failed', true);
  }
}

/* ── NEW / EDIT FORM ──────────────────────────────────────────────── */
function renderPaperForm(el, existing) {
  var isEdit = !!existing;
  var p = existing || { doi: '', title: '', authors: [], journal: '', year: '',
                        url: '', abstract: '', notes: '', tags: [] };

  var h = '';
  h += '<div style="margin-bottom:18px">';
  h += '<button class="pp-btn-ghost" onclick="ppNav(\'' + (isEdit ? 'detail' : 'list') + '\')">← Cancel</button>';
  h += '<span style="margin-left:14px;font-variant:small-caps;color:#8a7f72;letter-spacing:.1em">' +
       (isEdit ? 'edit paper' : 'add paper') + '</span>';
  h += '</div>';

  h += '<div class="pp-form">';

  // DOI lookup row — only for new papers (editing an existing DOI is fine
  // but re-looking-it-up would overwrite the user's manual edits).
  if (!isEdit) {
    h += '<div class="pp-form-row">';
    h += '<label class="pp-label">DOI or DOI URL</label>';
    h += '<div style="display:flex;gap:8px">';
    h += '<input type="text" id="pp-f-doi" class="pp-input" placeholder="10.1038/nature12373 or https://doi.org/…" style="flex:1">';
    h += '<button class="pp-btn-ghost" onclick="ppDoiLookup()" id="pp-lookup-btn">Look up</button>';
    h += '</div>';
    h += '<div id="pp-lookup-msg" class="pp-lookup-msg"></div>';
    h += '</div>';
  }

  // Title (required)
  h += '<div class="pp-form-row"><label class="pp-label">Title *</label>';
  h += '<input type="text" id="pp-f-title" class="pp-input" value="' + esc(p.title) + '"></div>';

  // Authors — one per line
  h += '<div class="pp-form-row"><label class="pp-label">Authors <span class="pp-hint">(one per line)</span></label>';
  h += '<textarea id="pp-f-authors" class="pp-input" rows="3">' +
       esc((p.authors || []).join('\n')) + '</textarea></div>';

  // Journal + Year on one row
  h += '<div class="pp-form-row-2col">';
  h += '<div><label class="pp-label">Journal</label>';
  h += '<input type="text" id="pp-f-journal" class="pp-input" value="' + esc(p.journal || '') + '"></div>';
  h += '<div><label class="pp-label">Year</label>';
  h += '<input type="number" id="pp-f-year" class="pp-input" value="' + esc(String(p.year || '')) + '"></div>';
  h += '</div>';

  // URL
  h += '<div class="pp-form-row"><label class="pp-label">URL</label>';
  h += '<input type="text" id="pp-f-url" class="pp-input" value="' + esc(p.url || '') + '"></div>';

  // Existing DOI (editable, for edit mode)
  if (isEdit) {
    h += '<div class="pp-form-row"><label class="pp-label">DOI</label>';
    h += '<input type="text" id="pp-f-doi" class="pp-input" value="' + esc(p.doi || '') + '"></div>';
  }

  // Abstract
  h += '<div class="pp-form-row"><label class="pp-label">Abstract</label>';
  h += '<textarea id="pp-f-abstract" class="pp-input" rows="4">' + esc(p.abstract || '') + '</textarea></div>';

  // Notes (personal)
  h += '<div class="pp-form-row"><label class="pp-label">Notes <span class="pp-hint">(your own)</span></label>';
  h += '<textarea id="pp-f-notes" class="pp-input" rows="3">' + esc(p.notes || '') + '</textarea></div>';

  // Tags
  h += '<div class="pp-form-row"><label class="pp-label">Tags <span class="pp-hint">(comma-separated)</span></label>';
  h += '<input type="text" id="pp-f-tags" class="pp-input" value="' + esc((p.tags || []).join(', ')) + '"></div>';

  h += '<div class="pp-actions">';
  h += '<button class="pp-btn-pri" onclick="ppSave(' + (isEdit ? p.id : 'null') + ')">' +
       (isEdit ? 'Save changes' : 'Add paper') + '</button>';
  h += '</div>';

  h += '</div>';

  el.innerHTML = h;

  // Focus DOI field on new form so user can paste immediately
  if (!isEdit) {
    var doiInput = document.getElementById('pp-f-doi');
    if (doiInput) {
      doiInput.focus();
      // Also allow Enter in DOI field to trigger lookup
      doiInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); ppDoiLookup(); }
      });
    }
  }
}

async function ppDoiLookup() {
  if (PP.lookupBusy) return;
  var doiField = document.getElementById('pp-f-doi');
  var msg = document.getElementById('pp-lookup-msg');
  var btn = document.getElementById('pp-lookup-btn');
  if (!doiField || !msg || !btn) return;
  var doi = doiField.value.trim();
  if (!doi) { msg.textContent = 'Enter a DOI first.'; msg.className = 'pp-lookup-msg err'; return; }

  PP.lookupBusy = true;
  btn.disabled = true;
  msg.textContent = 'Looking up…';
  msg.className = 'pp-lookup-msg';

  try {
    var res = await api('POST', '/api/papers/lookup-doi', { doi: doi });
    if (res.existing) {
      msg.innerHTML = 'Already in library: <a href="#" onclick="ppOpenDetail(' +
                      res.existing.id + ');return false">' +
                      esc(res.existing.title) + '</a>';
      msg.className = 'pp-lookup-msg warn';
      return;
    }
    var m = res.metadata;
    // Fill in the other fields — don't overwrite user's manual entries silently
    // if they already typed something.
    _fillIfEmpty('pp-f-title', m.title);
    _fillIfEmpty('pp-f-authors', (m.authors || []).join('\n'));
    _fillIfEmpty('pp-f-journal', m.journal);
    _fillIfEmpty('pp-f-year', m.year != null ? String(m.year) : '');
    _fillIfEmpty('pp-f-url', m.url);
    _fillIfEmpty('pp-f-abstract', m.abstract);
    doiField.value = m.doi;

    msg.textContent = 'Filled from Crossref. Review and save.';
    msg.className = 'pp-lookup-msg ok';
  } catch (e) {
    var errText = 'Lookup failed';
    if (e && e.message) errText += ': ' + e.message;
    msg.textContent = errText;
    msg.className = 'pp-lookup-msg err';
  } finally {
    PP.lookupBusy = false;
    btn.disabled = false;
  }
}

function _fillIfEmpty(id, val) {
  var f = document.getElementById(id);
  if (!f) return;
  if ((f.value || '').trim() === '') f.value = val || '';
}

async function ppSave(pid) {
  function val(id) { var f = document.getElementById(id); return f ? f.value.trim() : ''; }
  var body = {
    doi:      val('pp-f-doi') || null,
    title:    val('pp-f-title'),
    authors:  val('pp-f-authors').split('\n').map(function(s){return s.trim();}).filter(Boolean),
    journal:  val('pp-f-journal'),
    year:     val('pp-f-year') ? parseInt(val('pp-f-year'), 10) : null,
    url:      val('pp-f-url'),
    abstract: val('pp-f-abstract'),
    notes:    val('pp-f-notes'),
    tags:     val('pp-f-tags').split(',').map(function(s){return s.trim();}).filter(Boolean),
  };

  if (!body.title) { toast('Title is required', true); return; }

  try {
    if (pid == null) {
      var res = await api('POST', '/api/papers', body);
      if (res.duplicate) {
        toast('Already in library — opened existing');
      } else {
        toast('Paper added');
      }
      PP.current = { paper: res.paper, links: [] };
      // Load full detail (with any existing links) before showing
      PP.current = await api('GET', '/api/papers/' + res.paper.id);
      PP.view = 'detail';
    } else {
      var res2 = await api('PUT', '/api/papers/' + pid, body);
      toast('Saved');
      PP.current = await api('GET', '/api/papers/' + pid);
      PP.view = 'detail';
    }
    setView('papers');
  } catch (e) {
    toast('Save failed' + (e && e.message ? ': ' + e.message : ''), true);
  }
}

/* ── PICKER — used by other features to attach a paper to an entity ─
   Usage:
     window.papersOpenPicker(function(paper) { ... });

   Renders a modal overlay with a search box; user picks a result or clicks
   "add new" to create a paper inline. Callback receives the paper record
   (or null if the user closed without picking).
*/
window.papersOpenPicker = function(onSelect) {
  var overlay = document.createElement('div');
  overlay.className = 'pp-picker-overlay';
  overlay.innerHTML =
    '<div class="pp-picker">' +
      '<div class="pp-picker-hdr">' +
        '<div style="font-weight:600">Add reference</div>' +
        '<button class="pp-picker-close" onclick="ppPickerClose()">✕</button>' +
      '</div>' +
      '<input type="text" id="pp-picker-q" class="pp-input" placeholder="Search title, author, DOI…">' +
      '<div id="pp-picker-results" class="pp-picker-results"></div>' +
      '<div class="pp-picker-add">' +
        '<span style="color:#8a7f72;font-size:.82rem">Not in library?</span> ' +
        '<button class="pp-btn-ghost pp-btn-sm" onclick="ppPickerNew()">+ Add new paper</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  PP._pickerCallback = onSelect || function() {};
  PP._pickerOverlay = overlay;

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) ppPickerClose();
  });

  var input = document.getElementById('pp-picker-q');
  var results = document.getElementById('pp-picker-results');
  var t;
  function search() {
    clearTimeout(t);
    t = setTimeout(async function() {
      var q = input.value.trim();
      try {
        var data = await api('GET', '/api/papers' + (q ? ('?q=' + encodeURIComponent(q)) : ''));
        _renderPickerResults(results, data.items || []);
      } catch (e) {
        results.innerHTML = '<div class="pp-empty">Search failed</div>';
      }
    }, 180);
  }
  input.addEventListener('input', search);
  input.focus();
  search();
};

function _renderPickerResults(el, items) {
  if (!items.length) {
    el.innerHTML = '<div class="pp-picker-empty">No papers match. Try broadening the search, or add a new paper.</div>';
    return;
  }
  var h = '';
  items.slice(0, 20).forEach(function(p) {
    var authors = (p.authors || []);
    var au = authors.length === 0 ? '' :
             authors.length === 1 ? authors[0] :
             authors.length <= 3  ? authors.join(', ') :
                                    authors[0] + ' et al.';
    h += '<div class="pp-picker-item" onclick="ppPickerSelect(' + p.id + ')">';
    h += '<div class="pp-picker-item-title">' + esc(p.title) + '</div>';
    h += '<div class="pp-picker-item-meta">' + esc(au) +
         (p.year ? ' · ' + p.year : '') +
         (p.journal ? ' · ' + esc(p.journal) : '') + '</div>';
    h += '</div>';
  });
  el.innerHTML = h;
}

function ppPickerSelect(pid) {
  var picked = (PP.items || []).find(function(x){return x.id===pid;});
  // Fall back to fetching if not in the local list (e.g. results loaded from search)
  if (picked) {
    var cb = PP._pickerCallback;
    ppPickerClose();
    cb(picked);
  } else {
    api('GET', '/api/papers/' + pid).then(function(res) {
      var cb = PP._pickerCallback;
      ppPickerClose();
      cb(res.paper);
    }).catch(function() { toast('Could not load paper', true); });
  }
}

function ppPickerClose() {
  if (PP._pickerOverlay) {
    PP._pickerOverlay.remove();
    PP._pickerOverlay = null;
  }
  PP._pickerCallback = null;
}

/* When the user wants to add a new paper mid-pick — leave the picker up but
   show a compact inline form. On save, the created paper is returned via the
   picker callback. */
function ppPickerNew() {
  var overlay = PP._pickerOverlay;
  if (!overlay) return;
  var picker = overlay.querySelector('.pp-picker');
  picker.innerHTML =
    '<div class="pp-picker-hdr">' +
      '<div style="font-weight:600">Add new paper</div>' +
      '<button class="pp-picker-close" onclick="ppPickerClose()">✕</button>' +
    '</div>' +
    '<label class="pp-label">DOI</label>' +
    '<div style="display:flex;gap:8px">' +
      '<input type="text" id="pp-pk-doi" class="pp-input" placeholder="10.xxxx/…" style="flex:1">' +
      '<button class="pp-btn-ghost" onclick="ppPickerLookup()" id="pp-pk-lookup">Look up</button>' +
    '</div>' +
    '<div id="pp-pk-msg" class="pp-lookup-msg"></div>' +
    '<label class="pp-label" style="margin-top:10px">Title *</label>' +
    '<input type="text" id="pp-pk-title" class="pp-input">' +
    '<label class="pp-label" style="margin-top:10px">Authors <span class="pp-hint">(one per line)</span></label>' +
    '<textarea id="pp-pk-authors" class="pp-input" rows="2"></textarea>' +
    '<div style="display:flex;gap:10px;margin-top:10px">' +
      '<div style="flex:2"><label class="pp-label">Journal</label>' +
      '<input type="text" id="pp-pk-journal" class="pp-input"></div>' +
      '<div style="flex:1"><label class="pp-label">Year</label>' +
      '<input type="number" id="pp-pk-year" class="pp-input"></div>' +
    '</div>' +
    '<label class="pp-label" style="margin-top:10px">URL</label>' +
    '<input type="text" id="pp-pk-url" class="pp-input">' +
    '<div class="pp-actions">' +
      '<button class="pp-btn-ghost" onclick="ppPickerBackToSearch()">← Search instead</button>' +
      '<button class="pp-btn-pri" onclick="ppPickerSaveNew()">Add & attach</button>' +
    '</div>';

  var doi = document.getElementById('pp-pk-doi');
  if (doi) {
    doi.focus();
    doi.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); ppPickerLookup(); }
    });
  }
}

function ppPickerBackToSearch() {
  var overlay = PP._pickerOverlay;
  if (!overlay) return;
  var cb = PP._pickerCallback;
  ppPickerClose();
  window.papersOpenPicker(cb);
}

async function ppPickerLookup() {
  var doi = document.getElementById('pp-pk-doi').value.trim();
  var msg = document.getElementById('pp-pk-msg');
  var btn = document.getElementById('pp-pk-lookup');
  if (!doi) { msg.textContent = 'Enter a DOI first.'; msg.className = 'pp-lookup-msg err'; return; }
  btn.disabled = true;
  msg.textContent = 'Looking up…';
  msg.className = 'pp-lookup-msg';
  try {
    var res = await api('POST', '/api/papers/lookup-doi', { doi: doi });
    if (res.existing) {
      msg.innerHTML = 'Already in library — <a href="#" onclick="ppPickerSelect(' +
                      res.existing.id + ');return false">attach existing?</a>';
      msg.className = 'pp-lookup-msg warn';
      return;
    }
    var m = res.metadata;
    document.getElementById('pp-pk-doi').value = m.doi;
    _fillIfEmpty('pp-pk-title', m.title);
    _fillIfEmpty('pp-pk-authors', (m.authors || []).join('\n'));
    _fillIfEmpty('pp-pk-journal', m.journal);
    _fillIfEmpty('pp-pk-year', m.year != null ? String(m.year) : '');
    _fillIfEmpty('pp-pk-url', m.url);
    msg.textContent = 'Filled from Crossref.';
    msg.className = 'pp-lookup-msg ok';
  } catch (e) {
    msg.textContent = 'Lookup failed' + (e && e.message ? ': ' + e.message : '');
    msg.className = 'pp-lookup-msg err';
  } finally {
    btn.disabled = false;
  }
}

async function ppPickerSaveNew() {
  function v(id) { var f = document.getElementById(id); return f ? f.value.trim() : ''; }
  var body = {
    doi: v('pp-pk-doi') || null,
    title: v('pp-pk-title'),
    authors: v('pp-pk-authors').split('\n').map(function(s){return s.trim();}).filter(Boolean),
    journal: v('pp-pk-journal'),
    year: v('pp-pk-year') ? parseInt(v('pp-pk-year'), 10) : null,
    url: v('pp-pk-url'),
  };
  if (!body.title) { toast('Title is required', true); return; }
  try {
    var res = await api('POST', '/api/papers', body);
    toast(res.duplicate ? 'Already in library — using existing' : 'Paper added');
    var cb = PP._pickerCallback;
    ppPickerClose();
    cb(res.paper);
  } catch (e) {
    toast('Add failed' + (e && e.message ? ': ' + e.message : ''), true);
  }
}

/* ── REFERENCES SECTION — used by other features to render a papers panel
   Usage in another feature's render code:

     var refBox = document.createElement('div');
     protocolPanel.appendChild(refBox);
     window.papersRenderReferencesInto(refBox, 'protocol', String(pid));

   The panel handles its own add/remove; caller doesn't need to reason about it.
   Pass opts.compact = true for a slimmer style suitable for embedding in
   protocol panels vs full-page views.
*/
window.papersRenderReferencesInto = async function(el, entity_type, entity_id, opts) {
  opts = opts || {};
  el.classList.add('pp-refs-box');
  if (opts.compact) el.classList.add('pp-refs-compact');

  async function reload() {
    try {
      var data = await api('GET', '/api/papers/for-entity/' + encodeURIComponent(entity_type) +
                            '/' + encodeURIComponent(entity_id));
      _renderRefsPanel(el, entity_type, entity_id, data.items || [], reload, opts);
    } catch (e) {
      el.innerHTML = '<div class="pp-refs-hdr">References</div>' +
                     '<div class="pp-empty">Failed to load</div>';
    }
  }
  reload();
};

function _renderRefsPanel(el, entity_type, entity_id, items, reload, opts) {
  var h = '<div class="pp-refs-hdr">';
  h += '<span>References' + (items.length ? ' (' + items.length + ')' : '') + '</span>';
  h += '<button class="pp-btn-ghost pp-btn-sm" onclick="' +
       '_ppRefsAdd(this,\'' + esc(entity_type) + '\',\'' + esc(entity_id) + '\')">+ Add</button>';
  h += '</div>';

  if (!items.length) {
    h += '<div class="pp-refs-empty">No papers referenced yet.</div>';
  } else {
    h += '<div class="pp-refs-list">';
    items.forEach(function(p) {
      var au = (p.authors || []);
      var byline = au.length === 0 ? '' :
                   au.length === 1 ? au[0] :
                   au.length <= 3  ? au.join(', ') :
                                     au[0] + ' et al.';
      var meta = [byline, p.year, p.journal].filter(Boolean).join(' · ');
      h += '<div class="pp-refs-item">';
      h += '<div class="pp-refs-item-body">';
      h += '<div class="pp-refs-item-title" onclick="ppOpenDetail(' + p.id + ');setView(\'papers\')">' +
           esc(p.title) + '</div>';
      if (meta) h += '<div class="pp-refs-item-meta">' + esc(meta) + '</div>';
      h += '</div>';
      if (p.doi) {
        h += '<a href="https://doi.org/' + encodeURIComponent(p.doi) +
             '" target="_blank" rel="noopener" class="pp-refs-item-doi" title="Open DOI">↗</a>';
      } else if (p.url) {
        h += '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" class="pp-refs-item-doi" title="Open URL">↗</a>';
      }
      h += '<button class="pp-refs-item-x" onclick="_ppRefsRemove(' + p.link_id + ',this)" title="Remove reference">✕</button>';
      h += '</div>';
    });
    h += '</div>';
  }

  el.innerHTML = h;
  // Store reload for the async callbacks
  el._ppReload = reload;
}

// Called by the Add button; opens picker and on select, links + reloads.
window._ppRefsAdd = function(btn, entity_type, entity_id) {
  var box = btn.closest('.pp-refs-box');
  if (!box) return;
  window.papersOpenPicker(async function(paper) {
    if (!paper) return;
    try {
      await api('POST', '/api/papers/' + paper.id + '/links', {
        entity_type: entity_type, entity_id: entity_id
      });
      toast('Reference added');
      if (box._ppReload) box._ppReload();
    } catch (e) {
      toast('Could not add reference' + (e && e.message ? ': ' + e.message : ''), true);
    }
  });
};

window._ppRefsRemove = async function(link_id, btn) {
  if (!confirm('Remove this reference? The paper itself is not deleted.')) return;
  var box = btn.closest('.pp-refs-box');
  try {
    await api('DELETE', '/api/papers/links/' + link_id);
    toast('Reference removed');
    if (box && box._ppReload) box._ppReload();
  } catch (e) {
    toast('Remove failed', true);
  }
};

/* ── REFERENCES MODAL — opens the panel as an overlay, for callers where
   inline embedding would be too heavy (e.g. reminder rows).
   Usage:
     window.papersOpenRefsModal('reminder', String(id), 'Reminder title');
   Reuses papersRenderReferencesInto internally so behaviour matches inline.
*/
window.papersOpenRefsModal = function(entity_type, entity_id, title) {
  // Guard against double-open
  var existing = document.querySelector('.pp-refs-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'pp-refs-modal-overlay';
  overlay.innerHTML =
    '<div class="pp-refs-modal">' +
      '<div class="pp-refs-modal-hdr">' +
        '<div class="pp-refs-modal-title">References' + (title ? ' — ' + esc(title) : '') + '</div>' +
        '<button class="pp-picker-close" onclick="this.closest(\'.pp-refs-modal-overlay\').remove()">✕</button>' +
      '</div>' +
      '<div class="pp-refs-modal-body" id="pp-refs-modal-body"></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });

  // Escape key closes
  var onEsc = function(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);

  var body = document.getElementById('pp-refs-modal-body');
  // Reuse the standard inline renderer inside the modal shell.
  window.papersRenderReferencesInto(body, entity_type, entity_id);
};

/* ── STYLES ───────────────────────────────────────────────────────── */
function ppStyles() {
  return '<style>\
.pp-header{display:flex;align-items:center;gap:14px;margin-bottom:22px;flex-wrap:wrap}\
.pp-title{font-weight:700;font-size:1.15rem;color:#4a4139}\
.pp-search{flex:1;min-width:200px;padding:8px 12px;border:1px solid #d5cec0;border-radius:6px;background:#fff;font-size:.88rem;color:#4a4139}\
.pp-search:focus{outline:none;border-color:#5b7a5e}\
.pp-btn-pri{background:#5b7a5e;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:.85rem;cursor:pointer;font-weight:600}\
.pp-btn-pri:hover{background:#4a6a4d}.pp-btn-pri:disabled{opacity:.5;cursor:default}\
.pp-btn-ghost{background:none;border:1px solid #d5cec0;color:#4a4139;padding:6px 14px;border-radius:6px;font-size:.82rem;cursor:pointer}\
.pp-btn-ghost:hover{border-color:#8a7f72}.pp-btn-ghost:disabled{opacity:.5;cursor:default}\
.pp-btn-sm{padding:3px 10px;font-size:.78rem}\
.pp-empty{text-align:center;padding:60px 20px;color:#4a4139}\
.pp-count{margin-top:12px;color:#8a7f72;font-size:.78rem}\
.pp-table-wrap{overflow-x:auto;border:1px solid #d5cec0;border-radius:8px;background:#fff}\
.pp-table{width:100%;border-collapse:collapse;font-size:.88rem}\
.pp-table th{text-align:left;font-variant:small-caps;font-size:.7rem;letter-spacing:.1em;color:#8a7f72;padding:10px 14px;border-bottom:2px solid #d5cec0;background:#faf8f4}\
.pp-table td{padding:10px 14px;border-bottom:1px solid #ece7dd;vertical-align:top}\
.pp-row{cursor:pointer}.pp-row:hover{background:#f5f1ea}\
.pp-year{color:#8a7f72;font-family:"SF Mono",Monaco,Consolas,monospace}\
.pp-titlecell{font-weight:600;color:#4a4139;line-height:1.35}\
.pp-authors,.pp-journal{color:#6a5f52;font-size:.82rem}\
.pp-tag{display:inline-block;background:#e6dfd0;color:#6a5f52;font-size:.72rem;padding:2px 7px;border-radius:3px;margin-right:4px;margin-bottom:2px}\
.pp-detail{max-width:820px;margin:0 auto}\
.pp-detail-title{font-size:1.35rem;font-weight:700;color:#4a4139;line-height:1.3}\
.pp-detail-authors{color:#6a5f52;margin-top:6px;font-size:.95rem}\
.pp-detail-meta{color:#8a7f72;margin-top:2px;font-style:italic;font-size:.9rem}\
.pp-detail-links{margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}\
.pp-doi-badge{background:#f0ebe3;color:#4a4139;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.75rem;padding:3px 8px;border-radius:4px;text-decoration:none}\
.pp-doi-badge:hover{background:#e6dfd0}\
.pp-url-link{color:#5b7a5e;font-size:.82rem;text-decoration:none}\
.pp-url-link:hover{text-decoration:underline}\
.pp-section-hdr{font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin:24px 0 8px}\
.pp-abstract,.pp-notes{color:#4a4139;line-height:1.55;font-size:.9rem;white-space:pre-wrap}\
.pp-backlinks{display:flex;flex-direction:column;gap:6px}\
.pp-backlink{display:flex;gap:10px;align-items:center;padding:6px 10px;background:#faf8f4;border:1px solid #ece7dd;border-radius:4px;font-size:.85rem}\
.pp-backlink-type{font-variant:small-caps;font-size:.7rem;letter-spacing:.08em;color:#8a7f72}\
.pp-backlink-id{color:#4a4139;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.8rem}\
.pp-actions{margin-top:22px;display:flex;gap:10px;justify-content:flex-end}\
.pp-form{max-width:680px;margin:0 auto}\
.pp-form-row{margin-bottom:14px}\
.pp-form-row-2col{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:14px}\
.pp-label{display:block;font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin-bottom:4px}\
.pp-hint{text-transform:none;letter-spacing:0;font-size:.72rem;color:#a89e91;margin-left:6px}\
.pp-input{width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #d5cec0;border-radius:6px;background:#fff;font-size:.9rem;color:#4a4139;font-family:inherit}\
.pp-input:focus{outline:none;border-color:#5b7a5e}\
textarea.pp-input{font-family:inherit;resize:vertical}\
.pp-lookup-msg{margin-top:6px;font-size:.78rem;min-height:1em}\
.pp-lookup-msg.ok{color:#5b7a5e}\
.pp-lookup-msg.warn{color:#c9a84c}\
.pp-lookup-msg.err{color:#c25a4a}\
.pp-picker-overlay{position:fixed;inset:0;background:rgba(74,65,57,.4);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:80px}\
.pp-picker{width:min(560px,92vw);background:#faf8f4;border:1px solid #d5cec0;border-radius:10px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2);max-height:calc(100vh - 120px);display:flex;flex-direction:column}\
.pp-picker-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}\
.pp-picker-close{background:none;border:none;color:#8a7f72;font-size:1.1rem;cursor:pointer;padding:2px 6px}\
.pp-picker-close:hover{color:#4a4139}\
.pp-picker-results{margin-top:10px;overflow-y:auto;max-height:340px;border:1px solid #ece7dd;border-radius:6px;background:#fff;flex:1;min-height:120px}\
.pp-picker-empty{padding:24px;text-align:center;color:#8a7f72;font-size:.85rem}\
.pp-picker-item{padding:10px 12px;border-bottom:1px solid #ece7dd;cursor:pointer}\
.pp-picker-item:last-child{border-bottom:none}\
.pp-picker-item:hover{background:#faf8f4}\
.pp-picker-item-title{font-weight:600;color:#4a4139;font-size:.88rem;line-height:1.35}\
.pp-picker-item-meta{color:#8a7f72;font-size:.78rem;margin-top:2px}\
.pp-picker-add{margin-top:12px;text-align:right}\
.pp-refs-box{margin-top:14px;padding:12px 14px;background:#faf8f4;border:1px solid #ece7dd;border-radius:6px}\
.pp-refs-compact{padding:10px 12px;font-size:.85rem}\
.pp-refs-hdr{display:flex;justify-content:space-between;align-items:center;font-variant:small-caps;font-size:.72rem;letter-spacing:.12em;color:#8a7f72;margin-bottom:8px}\
.pp-refs-empty{color:#a89e91;font-size:.8rem;font-style:italic;padding:4px 0}\
.pp-refs-list{display:flex;flex-direction:column;gap:6px}\
.pp-refs-item{display:flex;gap:8px;align-items:center;padding:6px 10px;background:#fff;border:1px solid #ece7dd;border-radius:4px}\
.pp-refs-item-body{flex:1;min-width:0}\
.pp-refs-item-title{color:#4a4139;font-size:.85rem;line-height:1.35;font-weight:500;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.pp-refs-item-title:hover{color:#5b7a5e}\
.pp-refs-item-meta{color:#8a7f72;font-size:.75rem;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.pp-refs-item-doi{color:#5b7a5e;text-decoration:none;font-size:.85rem;padding:2px 6px}\
.pp-refs-item-doi:hover{color:#4a6a4d}\
.pp-refs-item-x{background:none;border:none;color:#a89e91;cursor:pointer;font-size:.85rem;padding:2px 6px;border-radius:3px}\
.pp-refs-item-x:hover{color:#c25a4a;background:#faf0ee}\
.pp-refs-modal-overlay{position:fixed;inset:0;background:rgba(74,65,57,.4);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:80px}\
.pp-refs-modal{width:min(620px,92vw);background:#faf8f4;border:1px solid #d5cec0;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.2);max-height:calc(100vh - 120px);display:flex;flex-direction:column;overflow:hidden}\
.pp-refs-modal-hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #ece7dd;background:#f5f1ea}\
.pp-refs-modal-title{font-weight:600;color:#4a4139;font-size:.95rem}\
.pp-refs-modal-body{padding:14px 18px;overflow-y:auto;flex:1}\
.pp-refs-modal-body .pp-refs-box{margin-top:0;background:transparent;border:none;padding:0}\
</style>';
}

registerView('papers', renderPapers);
