// Tm Calculator feature — select primers, pick polymerase, get Tm + annealing temp

var _tm = { primers: [], polymerases: [], result: null, history: [] };

async function renderTmCalc(el) {
  await _tmLoadData();

  var html = '<div class="tm-calc">';
  html += '<h2 style="margin:0 0 1.2rem;font-weight:600">Tm Calculator</h2>';

  // ── primer selection ──
  html += '<div class="card" style="padding:1rem;margin-bottom:1rem">';
  html += '<div class="tm-section-hdr" style="margin-top:0">SELECT PRIMERS</div>';

  html += '<div class="tm-primer-grid">';

  // forward
  html += '<div class="tm-primer-col">';
  html += '<label class="tm-label">Forward primer</label>';
  html += '<select id="tm-fwd-sel" onchange="_tmPrimerSelected(\'fwd\')" class="tm-select">';
  html += '<option value="">-- select from library --</option>';
  _tm.primers.forEach(function(p) {
    html += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  });
  html += '<option value="custom">Enter manually</option>';
  html += '</select>';
  html += '<input id="tm-fwd-seq" class="dna-input tm-seq-input" placeholder="Or paste sequence (5\u2032\u21923\u2032)" style="margin-top:.4rem">';
  html += '<div id="tm-fwd-info" class="tm-seq-info"></div>';
  html += '</div>';

  // reverse
  html += '<div class="tm-primer-col">';
  html += '<label class="tm-label">Reverse primer</label>';
  html += '<select id="tm-rev-sel" onchange="_tmPrimerSelected(\'rev\')" class="tm-select">';
  html += '<option value="">-- select from library --</option>';
  _tm.primers.forEach(function(p) {
    html += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  });
  html += '<option value="custom">Enter manually</option>';
  html += '</select>';
  html += '<input id="tm-rev-seq" class="dna-input tm-seq-input" placeholder="Or paste sequence (5\u2032\u21923\u2032)" style="margin-top:.4rem">';
  html += '<div id="tm-rev-info" class="tm-seq-info"></div>';
  html += '</div>';

  html += '</div>'; // grid
  html += '</div>'; // card

  // ── polymerase + calculate ──
  html += '<div class="card" style="padding:1rem;margin-bottom:1rem">';
  html += '<div class="tm-section-hdr" style="margin-top:0">POLYMERASE</div>';
  html += '<div style="display:flex;gap:1rem;align-items:end;flex-wrap:wrap">';
  html += '<div>';
  html += '<select id="tm-poly" class="tm-select" style="min-width:14rem" onchange="_tmPolyChanged()">';
  _tm.polymerases.forEach(function(p, i) {
    html += '<option value="' + esc(p.id) + '"' + (i === 0 ? ' selected' : '') + '>' + esc(p.name) + ' (' + esc(p.vendor) + ')</option>';
  });
  html += '</select>';
  html += '<div id="tm-poly-notes" class="muted" style="font-size:.78rem;margin-top:.3rem"></div>';
  html += '</div>';
  html += '<div>';
  html += '<label class="tm-label">Primer conc. (nM)</label>';
  html += '<input id="tm-primer-nm" class="dna-input" value="250" style="width:5rem">';
  html += '</div>';
  html += '<button class="btn" onclick="_tmCalculate()" style="background:#5b7a5e;color:#fff;height:2.2rem">Calculate Tm</button>';
  html += '</div>';
  html += '</div>';

  // ── results ──
  html += '<div id="tm-results"></div>';

  // ── history ──
  html += '<div style="margin-top:1.5rem">';
  html += '<div class="tm-section-hdr">RECENT CALCULATIONS</div>';
  html += '<div id="tm-history">' + _tmRenderHistory() + '</div>';
  html += '</div>';

  html += '</div>'; // tm-calc
  html += _tmStyles();
  el.innerHTML = html;

  _tmPolyChanged();
}

// ── Data loading ─────────────────────────────────────────────────────────────

async function _tmLoadData() {
  try { _tm.primers = (await api('GET', '/api/primers')).items || []; } catch(e) { _tm.primers = []; }
  try { _tm.polymerases = (await api('GET', '/api/tm/polymerases')).items || []; } catch(e) { _tm.polymerases = []; }
  try { _tm.history = (await api('GET', '/api/tm/history')).items || []; } catch(e) { _tm.history = []; }
}

// ── Primer selection ─────────────────────────────────────────────────────────

function _tmPrimerSelected(dir) {
  var sel = document.getElementById('tm-' + dir + '-sel');
  var seqInput = document.getElementById('tm-' + dir + '-seq');
  var info = document.getElementById('tm-' + dir + '-info');
  if (!sel || !seqInput) return;

  var val = sel.value;
  if (val === 'custom' || val === '') {
    seqInput.value = '';
    seqInput.disabled = false;
    seqInput.style.display = '';
    if (info) info.innerHTML = '';
    return;
  }

  var id = parseInt(val, 10);
  var primer = null;
  for (var i = 0; i < _tm.primers.length; i++) {
    if (_tm.primers[i].id === id) { primer = _tm.primers[i]; break; }
  }

  if (primer && primer.sequence) {
    seqInput.value = primer.sequence;
    seqInput.disabled = true;
    seqInput.style.display = '';
    if (info) {
      var full = primer.sequence.replace(/[^ACGTacgt]/g, '');
      var anneal = primer.sequence.replace(/[^ACGT]/g, '');
      var overhang = full.length - anneal.length;
      var gc = anneal.length ? (anneal.replace(/[^GC]/g, '').length / anneal.length * 100).toFixed(1) : 0;
      var txt = '<span>' + anneal.length + ' bp annealing</span> <span>GC: ' + gc + '%</span>';
      if (overhang > 0) txt += ' <span class="tm-overhang-tag">' + overhang + ' bp overhang</span>';
      info.innerHTML = txt;
    }
  } else {
    seqInput.value = '';
    seqInput.disabled = false;
    if (info) info.innerHTML = '<span class="muted">No sequence stored for this primer</span>';
  }
}

function _tmPolyChanged() {
  var sel = document.getElementById('tm-poly');
  var notes = document.getElementById('tm-poly-notes');
  if (!sel || !notes) return;
  var id = sel.value;
  for (var i = 0; i < _tm.polymerases.length; i++) {
    if (_tm.polymerases[i].id === id) {
      notes.textContent = _tm.polymerases[i].notes || '';
      return;
    }
  }
  notes.textContent = '';
}

// ── Calculate ────────────────────────────────────────────────────────────────

async function _tmCalculate() {
  var fwdSel = document.getElementById('tm-fwd-sel');
  var revSel = document.getElementById('tm-rev-sel');
  var fwdSeq = (document.getElementById('tm-fwd-seq') || {}).value || '';
  var revSeq = (document.getElementById('tm-rev-seq') || {}).value || '';
  var poly = (document.getElementById('tm-poly') || {}).value || '';
  var primerNm = parseFloat((document.getElementById('tm-primer-nm') || {}).value) || 250;

  if (!fwdSeq.trim() || !revSeq.trim()) { toast('Enter or select both primers.'); return; }

  var body = {
    polymerase: poly,
    primer_nm: primerNm,
    seq_fwd: fwdSeq.trim(),
    seq_rev: revSeq.trim()
  };

  var fwdVal = fwdSel ? fwdSel.value : '';
  var revVal = revSel ? revSel.value : '';
  if (fwdVal && fwdVal !== 'custom') body.primer_fwd_id = parseInt(fwdVal, 10);
  if (revVal && revVal !== 'custom') body.primer_rev_id = parseInt(revVal, 10);

  try {
    var data = await api('POST', '/api/tm/calculate', body);
    _tm.result = data;
    _tmShowResult(data);
    // refresh history
    try { _tm.history = (await api('GET', '/api/tm/history')).items || []; } catch(e) {}
    var hEl = document.getElementById('tm-history');
    if (hEl) hEl.innerHTML = _tmRenderHistory();
  } catch(e) {
    toast('Error: ' + (e.message || 'Calculation failed'));
  }
}

// ── Results display ──────────────────────────────────────────────────────────

function _tmShowResult(r) {
  var el = document.getElementById('tm-results');
  if (!el) return;

  var diffWarn = r.tm_diff > 5;

  var html = '<div class="card tm-result-card">';
  html += '<div class="tm-section-hdr" style="margin-top:0">RESULTS \u2014 ' + esc(r.polymerase.name) + '</div>';

  // big annealing temp
  html += '<div class="tm-ta-box">';
  html += '<div class="tm-ta-label">Recommended Annealing Temperature</div>';
  html += '<div class="tm-ta-value">' + r.ta.toFixed(1) + '\u00b0C</div>';
  html += '<div class="muted" style="font-size:.78rem">' + esc(r.polymerase.notes) + '</div>';
  html += '</div>';

  // primer details side by side
  html += '<div class="tm-primer-results">';

  html += '<div class="tm-primer-result-col">';
  html += '<div class="tm-label">Forward: ' + esc(r.fwd.name) + '</div>';
  html += '<div class="tm-temp">Tm: <strong>' + r.fwd.tm.toFixed(1) + '\u00b0C</strong></div>';
  html += '<div class="tm-detail">' + r.fwd.annealing_len + ' bp annealing \u00b7 ' + r.fwd.gc.toFixed(1) + '% GC';
  if (r.fwd.overhang_len) html += ' \u00b7 <span class="tm-overhang-tag">' + r.fwd.overhang_len + ' bp overhang</span>';
  html += '</div>';
  html += '<div class="tm-seq-display"><code>' + _tmStyledSeq(r.fwd.sequence) + '</code></div>';
  html += '</div>';

  html += '<div class="tm-primer-result-col">';
  html += '<div class="tm-label">Reverse: ' + esc(r.rev.name) + '</div>';
  html += '<div class="tm-temp">Tm: <strong>' + r.rev.tm.toFixed(1) + '\u00b0C</strong></div>';
  html += '<div class="tm-detail">' + r.rev.annealing_len + ' bp annealing \u00b7 ' + r.rev.gc.toFixed(1) + '% GC';
  if (r.rev.overhang_len) html += ' \u00b7 <span class="tm-overhang-tag">' + r.rev.overhang_len + ' bp overhang</span>';
  html += '</div>';
  html += '<div class="tm-seq-display"><code>' + _tmStyledSeq(r.rev.sequence) + '</code></div>';
  html += '</div>';

  html += '</div>';

  // Tm difference warning
  html += '<div class="tm-diff' + (diffWarn ? ' tm-diff-warn' : '') + '">';
  html += '\u0394Tm: ' + r.tm_diff.toFixed(1) + '\u00b0C';
  if (diffWarn) html += ' \u2014 large difference, consider redesigning primers or using a touchdown protocol';
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
}

// ── History ──────────────────────────────────────────────────────────────────

function _tmRenderHistory() {
  var items = _tm.history || [];
  if (!items.length) return '<div class="muted" style="padding:.5rem 0">No calculations yet.</div>';

  var html = '<div class="tm-table-wrap"><table class="dna-table"><thead><tr>';
  html += '<th>Forward</th><th>Reverse</th><th>Polymerase</th><th>Tm Fwd</th><th>Tm Rev</th><th>Ta</th><th>Date</th><th></th>';
  html += '</tr></thead><tbody>';
  items.forEach(function(c) {
    var pname = c.polymerase;
    html += '<tr>';
    html += '<td class="dna-cell-name">' + esc(c.primer_fwd) + '</td>';
    html += '<td class="dna-cell-name">' + esc(c.primer_rev) + '</td>';
    html += '<td>' + esc(pname) + '</td>';
    html += '<td>' + Number(c.tm_fwd).toFixed(1) + '\u00b0</td>';
    html += '<td>' + Number(c.tm_rev).toFixed(1) + '\u00b0</td>';
    html += '<td><strong>' + Number(c.ta).toFixed(1) + '\u00b0</strong></td>';
    html += '<td class="muted">' + esc((c.created || '').slice(0, 10)) + '</td>';
    html += '<td><span class="dna-del" onclick="_tmDeleteCalc(' + c.id + ')" title="Delete">\u00d7</span></td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

async function _tmDeleteCalc(id) {
  try {
    await api('DELETE', '/api/tm/history/' + id);
    _tm.history = _tm.history.filter(function(c) { return c.id !== id; });
    var hEl = document.getElementById('tm-history');
    if (hEl) hEl.innerHTML = _tmRenderHistory();
  } catch(e) { toast('Error: ' + e.message); }
}

// ── Sequence styling helper ───────────────────────────────────────────────────

function _tmStyledSeq(seq) {
  // lowercase = overhang (faded), UPPERCASE = annealing (bold)
  var html = '';
  var inOverhang = false;
  for (var i = 0; i < seq.length; i++) {
    var c = seq[i];
    if (!'ACGTacgt'.includes(c)) continue;
    var isLower = c === c.toLowerCase() && c !== c.toUpperCase();
    if (isLower && !inOverhang) {
      html += '<span class="tm-oh">';
      inOverhang = true;
    } else if (!isLower && inOverhang) {
      html += '</span>';
      inOverhang = false;
    }
    html += esc(c);
  }
  if (inOverhang) html += '</span>';
  return html;
}

// ── Styles ───────────────────────────────────────────────────────────────────

function _tmStyles() {
  return '<style>' +
    '.tm-calc { max-width: 960px; }' +
    '.tm-section-hdr { font-size:.72rem; letter-spacing:.12em; color:#8a7f72; text-transform:uppercase; padding:.5rem 0; margin-top:.8rem; border-bottom:1px solid #d5cec0; margin-bottom:.6rem; }' +
    '.tm-label { font-size:.82rem; color:#8a7f72; margin-bottom:.2rem; }' +
    '.tm-select { padding:.4rem .5rem; border:1px solid #d5cec0; border-radius:4px; font-size:.85rem; background:#fff; color:#4a4139; width:100%; }' +
    '.tm-primer-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.2rem; }' +
    '.tm-primer-col { display:flex; flex-direction:column; }' +
    '.tm-seq-input { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.82rem; width:100%; }' +
    '.tm-seq-info { font-size:.78rem; color:#8a7f72; margin-top:.3rem; display:flex; gap:.8rem; }' +

    /* results */
    '.tm-result-card { padding:1.2rem; margin-bottom:1rem; }' +
    '.tm-ta-box { text-align:center; padding:1rem 0 1.2rem; }' +
    '.tm-ta-label { font-size:.78rem; text-transform:uppercase; letter-spacing:.1em; color:#8a7f72; margin-bottom:.3rem; }' +
    '.tm-ta-value { font-size:2.4rem; font-weight:700; color:#5b7a5e; line-height:1.1; }' +
    '.tm-primer-results { display:grid; grid-template-columns:1fr 1fr; gap:1.2rem; margin-top:.8rem; }' +
    '.tm-primer-result-col { padding:.8rem; background:#f5f1eb; border-radius:6px; }' +
    '.tm-temp { font-size:1.05rem; color:#4a4139; margin:.3rem 0; }' +
    '.tm-detail { font-size:.8rem; color:#8a7f72; }' +
    '.tm-seq-display { margin-top:.4rem; }' +
    '.tm-seq-display code { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.75rem; color:#6b614f; background:#f0ebe3; padding:.15rem .4rem; border-radius:3px; word-break:break-all; display:inline-block; max-width:100%; }' +
    '.tm-diff { font-size:.85rem; color:#8a7f72; margin-top:.8rem; padding:.5rem .8rem; border-radius:4px; background:#f5f1eb; }' +
    '.tm-diff-warn { color:#b45309; background:#fef3cd; }' +
    '.tm-table-wrap { overflow-x:auto; }' +

    /* responsive */
    '@media (max-width:600px) { .tm-primer-grid, .tm-primer-results { grid-template-columns:1fr; } }' +

    /* overhang styling */
    '.tm-oh { color:#c0a88a; }' +
    '.tm-overhang-tag { display:inline-block; font-size:.7rem; background:#f0ebe3; color:#8a7f72; padding:.1rem .35rem; border-radius:3px; letter-spacing:.02em; }' +
  '</style>';
}

// Register with core
registerView('tm_calc', renderTmCalc);
