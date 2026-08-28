/* ── Hours log ────────────────────────────────────────────────────────────
   Two nested views:
     1. Week grid — rows of weeks, 7 day cells each, showing total hours and
        the day's dominant category as a colour stripe. This is the default.
     2. Day view — one day expanded to 24 hour cells laid out horizontally.
        Empty hours are click-to-create, activity blocks click-to-edit.

   State is per-view module-scope. Nothing persists to localStorage — the
   API round-trip is fast enough that the week grid can reload cleanly on
   every view entry, and stale local state would create hard-to-reason-about
   sync bugs against the DB.

   Entry lifecycle: click empty hour or "+ Add" → modal with category, notes,
   attachments, workflow-day link. Auto-suggests the workflow day matching
   the entry's date; user can override or clear via the picker.

   Categories are hardcoded on the backend and fetched once on load, cached
   in _categories. Colour lookup goes through _categoryColor() so the whole
   file uses one source of truth for palette. */

var _hoursWeekStart = null;     // Monday of currently-shown week (Date obj)
var _hoursWeeksToShow = 4;      // rolling 4 weeks: current + 3 prior
var _hoursSelectedDate = null;  // 'YYYY-MM-DD' when day view active, else null
var _hoursEntries = [];         // raw entry rows for the visible date range
var _hoursCategories = [];      // fetched from /api/hours/categories
var _hoursEditingId = null;     // id of entry being edited, null while creating
var _hoursPendingNew = null;    // {date, startHour, endHour} for a click-to-create

// ── styling ───────────────────────────────────────────────────────────────
// Injected once on first render. Kept inline to match the file-per-feature
// convention (settings feature does the same).
function _hoursInjectStyles() {
  if (document.getElementById('hours-styles')) return;
  var s = document.createElement('style');
  s.id = 'hours-styles';
  s.textContent = [
    '.hrs-wrap{padding:16px;max-width:1100px;margin:0 auto}',
    '.hrs-header{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}',
    '.hrs-header h1{margin:0;font-size:24px;color:#3c342a}',
    '.hrs-week-nav{margin-left:auto;display:flex;gap:6px;align-items:center}',
    '.hrs-week-nav button{background:none;border:1px solid #d5cec0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;color:#4a4139}',
    '.hrs-week-nav button:hover{background:#f0ebe3}',

    '.hrs-legend{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;font-size:11px;color:#6a5f52}',
    '.hrs-legend-item{display:flex;align-items:center;gap:5px}',
    '.hrs-legend-swatch{display:inline-block;width:12px;height:12px;border-radius:2px}',

    '.hrs-week{display:grid;grid-template-columns:80px repeat(7,1fr);gap:4px;margin-bottom:6px}',
    '.hrs-week-label{font-size:11px;color:#8a7f72;padding-top:20px;text-align:right;padding-right:6px}',
    '.hrs-day-cell{background:#faf8f4;border:1px solid #e8e2d8;border-radius:6px;padding:8px;min-height:80px;cursor:pointer;position:relative;transition:transform .1s}',
    '.hrs-day-cell:hover{transform:scale(1.02);border-color:#c8bfaf;box-shadow:0 2px 8px rgba(60,52,42,.08)}',
    '.hrs-day-cell.today{border-color:#5b7a5e;border-width:2px}',
    '.hrs-day-cell.selected{background:#f0ebe3;border-color:#8a7f72}',
    '.hrs-day-header{font-size:10px;color:#8a7f72;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '.hrs-day-date{font-size:14px;color:#3c342a;margin-top:2px}',
    '.hrs-day-total{font-size:20px;color:#3c342a;font-weight:700;margin-top:6px}',
    '.hrs-day-total-unit{font-size:11px;color:#8a7f72;font-weight:400;margin-left:2px}',
    '.hrs-day-stripe{position:absolute;bottom:6px;left:8px;right:8px;height:4px;border-radius:2px;display:flex;overflow:hidden;background:#e8e2d8}',
    '.hrs-day-stripe-seg{height:100%}',
    '.hrs-day-att{position:absolute;top:6px;right:8px;font-size:10px;color:#8a7f72}',

    /* Day expansion view */
    '.hrs-day-view{margin-top:20px;background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;padding:16px}',
    '.hrs-day-view h2{margin:0 0 12px;font-size:16px;color:#3c342a;display:flex;align-items:center;gap:8px}',
    '.hrs-day-close{margin-left:auto;background:none;border:1px solid #d5cec0;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}',
    '.hrs-hour-grid{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-bottom:10px}',
    '.hrs-hour-cell{background:#fff;border:1px solid #e8e2d8;border-radius:3px;height:44px;cursor:pointer;position:relative;font-size:9px;color:#8a7f72;padding:2px}',
    '.hrs-hour-cell:hover{border-color:#8a7f72}',
    '.hrs-hour-cell.filled{color:#faf8f4;font-weight:600;font-size:10px}',
    '.hrs-hour-cell.filled:hover{filter:brightness(0.9)}',
    '.hrs-hour-cell-hour{position:absolute;top:2px;left:3px;font-size:9px;opacity:.7}',
    '.hrs-hour-cell-cat{position:absolute;bottom:2px;left:3px;right:3px;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hrs-day-entries{margin-top:12px}',
    '.hrs-entry-row{display:flex;align-items:center;gap:10px;padding:8px;background:#fff;border:1px solid #e8e2d8;border-radius:4px;margin-bottom:4px;font-size:13px;cursor:pointer}',
    '.hrs-entry-row:hover{border-color:#8a7f72}',
    '.hrs-entry-time{color:#4a4139;font-family:"SF Mono",Monaco,Consolas,monospace;min-width:100px;font-size:12px}',
    '.hrs-entry-cat-tag{padding:2px 8px;border-radius:10px;font-size:10px;color:#faf8f4;font-weight:600}',
    '.hrs-entry-notes{flex:1;color:#6a5f52;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hrs-entry-att-count{color:#8a7f72;font-size:11px}',
    '.hrs-add-entry-btn{background:#5b7a5e;color:#faf8f4;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:12px}',

    /* Modal */
    '.hrs-modal-backdrop{position:fixed;inset:0;background:rgba(60,52,42,.5);z-index:2500;display:flex;align-items:center;justify-content:center}',
    '.hrs-modal{background:#faf8f4;border-radius:8px;padding:20px;max-width:500px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)}',
    '.hrs-modal h3{margin:0 0 14px;font-size:16px;color:#3c342a}',
    '.hrs-modal label{display:block;font-size:11px;color:#6a5f52;margin-top:10px;margin-bottom:3px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '.hrs-modal input[type=text],.hrs-modal input[type=number],.hrs-modal select,.hrs-modal textarea{width:100%;border:1px solid #d5cec0;border-radius:4px;padding:6px 8px;font-size:13px;background:#fff;box-sizing:border-box;font-family:inherit}',
    '.hrs-modal textarea{min-height:60px;resize:vertical}',
    '.hrs-modal-time{display:flex;gap:8px;align-items:center}',
    '.hrs-modal-time select{width:auto;flex:0 0 auto}',
    '.hrs-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid #e8e2d8}',
    '.hrs-modal-actions button{border:1px solid #d5cec0;background:#fff;border-radius:4px;padding:6px 14px;cursor:pointer;font-size:13px}',
    '.hrs-modal-actions button.primary{background:#5b7a5e;color:#faf8f4;border-color:#5b7a5e}',
    '.hrs-modal-actions button.danger{color:#c0392b;border-color:#e8bcb5}',
    '.hrs-modal-actions button.danger:hover{background:#fde8e5}',
    '.hrs-att-list{margin-top:4px;font-size:12px}',
    '.hrs-att-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #e8e2d8}',
    '.hrs-att-row a{color:#4a6fa5;text-decoration:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.hrs-att-row a:hover{text-decoration:underline}',
    '.hrs-att-size{color:#8a7f72;font-size:10px}',
    '.hrs-att-remove{background:none;border:none;color:#c0392b;cursor:pointer;font-size:14px;padding:0 4px}',
    '.hrs-att-upload{margin-top:6px}',
    '.hrs-wf-suggest{background:#f0ebe3;border:1px solid #e8e2d8;border-radius:4px;padding:6px 10px;font-size:12px;color:#6a5f52;margin-top:4px}',
    '.hrs-wf-suggest button{background:none;border:none;color:#4a6fa5;cursor:pointer;padding:0 4px;font-size:12px;text-decoration:underline}'
  ].join('');
  document.head.appendChild(s);
}


// ── date helpers ──────────────────────────────────────────────────────────
function _isoDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function _mondayOf(d) {
  // ISO week: Monday = 1 ... Sunday = 7. getDay returns 0..6 with Sunday=0.
  var day = d.getDay() || 7;
  var monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function _addDays(d, n) {
  var out = new Date(d);
  out.setDate(d.getDate() + n);
  return out;
}
function _fmtHours(n) {
  if (n === 0) return '0';
  if (n === Math.floor(n)) return String(n);
  return n.toFixed(1);
}
function _fmtDateShort(iso) {
  var parts = iso.split('-');
  return parts[2] + '/' + parts[1];
}
function _fmtDateFull(iso) {
  var d = new Date(iso + 'T00:00:00');
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function _fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}


// ── category helpers ──────────────────────────────────────────────────────
function _categoryColor(key) {
  var c = _hoursCategories.find(function(c){ return c.key === key; });
  return c ? c.color : '#9a8a7c';
}
function _categoryLabel(key) {
  var c = _hoursCategories.find(function(c){ return c.key === key; });
  return c ? c.label : key;
}


// ── data loading ──────────────────────────────────────────────────────────
async function _hoursLoad() {
  if (!_hoursCategories.length) {
    var catsResp = await api('GET', '/api/hours/categories');
    _hoursCategories = catsResp.categories;
  }
  if (!_hoursWeekStart) _hoursWeekStart = _mondayOf(new Date());
  var earliest = _addDays(_hoursWeekStart, -(_hoursWeeksToShow - 1) * 7);
  var latest = _addDays(_hoursWeekStart, 6);
  var resp = await api('GET', '/api/hours/entries?start=' + _isoDate(earliest) +
                       '&end=' + _isoDate(latest));
  _hoursEntries = resp.entries;
}


// ── render: week grid ─────────────────────────────────────────────────────
function _hoursRenderWeekGrid() {
  var todayISO = _isoDate(new Date());
  var html = '<div class="hrs-header">' +
    '<h1>Work log</h1>' +
    '<div class="hrs-week-nav">' +
      '<button onclick="_hoursShiftWeek(-4)">&laquo; 4w</button>' +
      '<button onclick="_hoursShiftWeek(-1)">&lsaquo; week</button>' +
      '<button onclick="_hoursShiftWeek(1)">week &rsaquo;</button>' +
      '<button onclick="_hoursShiftWeek(4)">4w &raquo;</button>' +
      '<button onclick="_hoursGoToday()">Today</button>' +
    '</div>' +
    '</div>';

  // Category legend
  html += '<div class="hrs-legend">';
  _hoursCategories.forEach(function(c) {
    html += '<div class="hrs-legend-item">' +
      '<span class="hrs-legend-swatch" style="background:' + c.color + '"></span>' +
      esc(c.label) +
    '</div>';
  });
  html += '</div>';

  // Weeks — newest at top
  for (var w = 0; w < _hoursWeeksToShow; w++) {
    var weekStart = _addDays(_hoursWeekStart, -w * 7);
    var weekLabel = _fmtDateShort(_isoDate(weekStart)) + '<br>' +
                    _fmtDateShort(_isoDate(_addDays(weekStart, 6)));
    html += '<div class="hrs-week"><div class="hrs-week-label">' + weekLabel + '</div>';
    for (var d = 0; d < 7; d++) {
      var day = _addDays(weekStart, d);
      var iso = _isoDate(day);
      html += _hoursRenderDayCell(day, iso, iso === todayISO);
    }
    html += '</div>';
  }

  // Day view expansion (if a day is selected)
  if (_hoursSelectedDate) {
    html += _hoursRenderDayView(_hoursSelectedDate);
  }

  return html;
}

function _hoursRenderDayCell(day, iso, isToday) {
  var dayEntries = _hoursEntries.filter(function(e) { return e.date_iso === iso; });
  var totalHours = 0;
  var catHours = {};
  var attCount = 0;
  dayEntries.forEach(function(e) {
    var h = e.end_hour - e.start_hour;
    totalHours += h;
    catHours[e.category] = (catHours[e.category] || 0) + h;
    attCount += (e.attachments || []).length;
  });
  var dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()];
  var cls = 'hrs-day-cell';
  if (isToday) cls += ' today';
  if (iso === _hoursSelectedDate) cls += ' selected';

  var html = '<div class="' + cls + '" onclick="_hoursSelectDay(\'' + iso + '\')">';
  html += '<div class="hrs-day-header">' + dayName + '</div>';
  html += '<div class="hrs-day-date">' + day.getDate() + '</div>';
  if (totalHours > 0) {
    html += '<div class="hrs-day-total">' + _fmtHours(totalHours) +
            '<span class="hrs-day-total-unit">h</span></div>';
    // Coloured stripe segmented by category proportions
    html += '<div class="hrs-day-stripe">';
    Object.keys(catHours).forEach(function(cat) {
      var pct = (catHours[cat] / totalHours) * 100;
      html += '<div class="hrs-day-stripe-seg" style="width:' + pct.toFixed(1) +
              '%;background:' + _categoryColor(cat) + '" title="' + esc(_categoryLabel(cat)) +
              ': ' + _fmtHours(catHours[cat]) + 'h"></div>';
    });
    html += '</div>';
  }
  if (attCount > 0) {
    html += '<div class="hrs-day-att">&#128206; ' + attCount + '</div>';
  }
  html += '</div>';
  return html;
}


// ── render: day view (24-hour grid) ───────────────────────────────────────
function _hoursRenderDayView(iso) {
  var dayEntries = _hoursEntries.filter(function(e) { return e.date_iso === iso; });
  // Map hour → entry that covers it (for the 24-cell grid). Overlapping
  // entries would be a data error but we don't prevent them at the DB level;
  // last-write-wins in the grid render.
  var hourMap = {};
  dayEntries.forEach(function(e) {
    for (var h = e.start_hour; h < e.end_hour; h++) hourMap[h] = e;
  });

  var html = '<div class="hrs-day-view">';
  html += '<h2>' + _fmtDateFull(iso) +
          '<button class="hrs-day-close" onclick="_hoursCloseDay()">Close</button>' +
          '</h2>';

  html += '<div class="hrs-hour-grid">';
  for (var h = 0; h < 24; h++) {
    var entry = hourMap[h];
    if (entry) {
      var color = _categoryColor(entry.category);
      var isStart = entry.start_hour === h;
      var catLabel = isStart ? esc(_categoryLabel(entry.category)) : '';
      html += '<div class="hrs-hour-cell filled" style="background:' + color +
              '" onclick="_hoursOpenEntryModal(' + entry.id + ')">' +
              '<span class="hrs-hour-cell-hour">' + h + '</span>' +
              (catLabel ? '<span class="hrs-hour-cell-cat">' + catLabel + '</span>' : '') +
              '</div>';
    } else {
      html += '<div class="hrs-hour-cell" onclick="_hoursStartCreate(\'' + iso + '\',' + h + ')">' +
              '<span class="hrs-hour-cell-hour">' + h + '</span>' +
              '</div>';
    }
  }
  html += '</div>';

  // Entry list under the grid — full-context view of what's on this day
  if (dayEntries.length) {
    html += '<div class="hrs-day-entries">';
    dayEntries.forEach(function(e) {
      var notes = (e.notes || '').substring(0, 80);
      html += '<div class="hrs-entry-row" onclick="_hoursOpenEntryModal(' + e.id + ')">';
      html += '<span class="hrs-entry-time">' +
              String(e.start_hour).padStart(2,'0') + ':00 &ndash; ' +
              String(e.end_hour).padStart(2,'0') + ':00</span>';
      html += '<span class="hrs-entry-cat-tag" style="background:' +
              _categoryColor(e.category) + '">' + esc(_categoryLabel(e.category)) + '</span>';
      html += '<span class="hrs-entry-notes">' + esc(notes) + '</span>';
      if (e.attachments && e.attachments.length) {
        html += '<span class="hrs-entry-att-count">&#128206; ' + e.attachments.length + '</span>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  html += '<button class="hrs-add-entry-btn" onclick="_hoursStartCreate(\'' + iso + '\',9)">+ Add entry</button>';
  html += '</div>';
  return html;
}


// ── navigation actions ────────────────────────────────────────────────────
async function _hoursShiftWeek(deltaWeeks) {
  _hoursWeekStart = _addDays(_hoursWeekStart, deltaWeeks * 7);
  _hoursSelectedDate = null;
  await _hoursLoad();
  _hoursRerender();
}
async function _hoursGoToday() {
  _hoursWeekStart = _mondayOf(new Date());
  _hoursSelectedDate = null;
  await _hoursLoad();
  _hoursRerender();
}
function _hoursSelectDay(iso) {
  _hoursSelectedDate = (_hoursSelectedDate === iso) ? null : iso;
  _hoursRerender();
}
function _hoursCloseDay() {
  _hoursSelectedDate = null;
  _hoursRerender();
}
function _hoursRerender() {
  var el = document.getElementById('content');
  if (el) el.innerHTML = '<div class="hrs-wrap">' + _hoursRenderWeekGrid() + '</div>';
}


// ── modal: create / edit entry ────────────────────────────────────────────
async function _hoursStartCreate(iso, startHour) {
  _hoursEditingId = null;
  _hoursPendingNew = { date_iso: iso, start_hour: startHour, end_hour: startHour + 1 };
  await _hoursRenderModal(null);
}

async function _hoursOpenEntryModal(id) {
  _hoursEditingId = id;
  _hoursPendingNew = null;
  var entry = _hoursEntries.find(function(e){ return e.id === id; });
  if (!entry) {
    // Fallback: refetch (entry may not be in the loaded range)
    entry = await api('GET', '/api/hours/entries/' + id);
  }
  await _hoursRenderModal(entry);
}

async function _hoursRenderModal(entry) {
  var isNew = !entry;
  var data = entry || _hoursPendingNew;
  // Workflow-day suggestion for the entry date
  var wfSuggest = null;
  try {
    wfSuggest = await api('GET', '/api/hours/workflow-day-suggestions?date=' + data.date_iso);
  } catch (e) { /* non-fatal */ }

  var currentWfDate = isNew ? (wfSuggest && wfSuggest.exact ? wfSuggest.exact.date : '')
                            : (entry.workflow_day_date || '');

  var hourOpts = '';
  for (var h = 0; h < 24; h++) hourOpts += '<option value="' + h + '">' + String(h).padStart(2,'0') + ':00</option>';
  var endHourOpts = '';
  for (var h = 1; h <= 24; h++) endHourOpts += '<option value="' + h + '">' + String(h).padStart(2,'0') + ':00</option>';

  var catOpts = _hoursCategories.map(function(c) {
    return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
  }).join('');

  var attHtml = '';
  if (!isNew && entry.attachments && entry.attachments.length) {
    attHtml = '<div class="hrs-att-list">';
    entry.attachments.forEach(function(a) {
      attHtml += '<div class="hrs-att-row">' +
        '<a href="/api/hours/attachments/' + a.id + '" target="_blank">&#128206; ' + esc(a.filename) + '</a>' +
        '<span class="hrs-att-size">' + _fmtBytes(a.size_bytes) + '</span>' +
        '<button class="hrs-att-remove" title="Remove" onclick="_hoursRemoveAttachment(' + a.id + ')">&#215;</button>' +
      '</div>';
    });
    attHtml += '</div>';
  }

  var wfHtml = '';
  if (currentWfDate) {
    wfHtml = '<div class="hrs-wf-suggest">Linked to workflow day: <b>' + esc(currentWfDate) + '</b> ' +
             '<button onclick="_hoursSetWfDate(\'\')">clear</button></div>';
  } else if (wfSuggest && wfSuggest.exact) {
    wfHtml = '<div class="hrs-wf-suggest">Workflow day exists for this date. ' +
             '<button onclick="_hoursSetWfDate(\'' + wfSuggest.exact.date + '\')">Link it</button></div>';
  } else if (wfSuggest && wfSuggest.nearby && wfSuggest.nearby.length) {
    wfHtml = '<div class="hrs-wf-suggest">Nearby workflow days: ';
    wfSuggest.nearby.forEach(function(n) {
      wfHtml += '<button onclick="_hoursSetWfDate(\'' + n.date + '\')">' + n.date + '</button>';
    });
    wfHtml += '</div>';
  } else {
    wfHtml = '<div class="hrs-wf-suggest">No workflow day for this or nearby dates.</div>';
  }

  var modalHtml = '<div class="hrs-modal-backdrop" id="hrs-modal" onclick="if(event.target===this)_hoursCloseModal()">' +
    '<div class="hrs-modal">' +
    '<h3>' + (isNew ? 'New entry' : 'Edit entry') + ' &mdash; ' + _fmtDateFull(data.date_iso) + '</h3>' +
    '<label>Time</label>' +
    '<div class="hrs-modal-time">' +
      '<select id="hrs-mod-start">' + hourOpts + '</select>' +
      '<span>to</span>' +
      '<select id="hrs-mod-end">' + endHourOpts + '</select>' +
    '</div>' +
    '<label>Category</label>' +
    '<select id="hrs-mod-cat">' + catOpts + '</select>' +
    '<label>Notes</label>' +
    '<textarea id="hrs-mod-notes" placeholder="What did you do? Why does it matter?"></textarea>' +
    '<label>Workflow day link</label>' +
    '<input type="hidden" id="hrs-mod-wfdate" value="' + esc(currentWfDate) + '"/>' +
    wfHtml +
    (isNew ? '' : '<label>Attachments</label>' + attHtml +
                  '<div class="hrs-att-upload"><input type="file" id="hrs-mod-file" onchange="_hoursUploadFile()"/></div>') +
    '<div class="hrs-modal-actions">' +
      (isNew ? '' : '<button class="danger" onclick="_hoursDeleteEntry()">Delete</button>') +
      '<button onclick="_hoursCloseModal()">Cancel</button>' +
      '<button class="primary" onclick="_hoursSaveEntry()">' + (isNew ? 'Create' : 'Save') + '</button>' +
    '</div>' +
    '</div></div>';

  // Append to body so modal floats above everything
  var existing = document.getElementById('hrs-modal');
  if (existing) existing.remove();
  var container = document.createElement('div');
  container.innerHTML = modalHtml;
  document.body.appendChild(container.firstChild);

  // Populate values (setting them via HTML attribute doesn't work for <select>)
  document.getElementById('hrs-mod-start').value = data.start_hour;
  document.getElementById('hrs-mod-end').value = data.end_hour;
  document.getElementById('hrs-mod-cat').value = (entry && entry.category) || 'research';
  document.getElementById('hrs-mod-notes').value = (entry && entry.notes) || '';
}

function _hoursCloseModal() {
  var m = document.getElementById('hrs-modal');
  if (m) m.remove();
  _hoursEditingId = null;
  _hoursPendingNew = null;
}

function _hoursSetWfDate(d) {
  document.getElementById('hrs-mod-wfdate').value = d;
  // Update the suggest banner text so user sees the change
  var banner = document.querySelector('.hrs-wf-suggest');
  if (banner) {
    if (d) {
      banner.innerHTML = 'Linked to workflow day: <b>' + esc(d) + '</b> ' +
        '<button onclick="_hoursSetWfDate(\'\')">clear</button>';
    } else {
      banner.innerHTML = 'Not linked to any workflow day.';
    }
  }
}

async function _hoursSaveEntry() {
  var start = parseInt(document.getElementById('hrs-mod-start').value);
  var end = parseInt(document.getElementById('hrs-mod-end').value);
  var category = document.getElementById('hrs-mod-cat').value;
  var notes = document.getElementById('hrs-mod-notes').value.trim() || null;
  var wfDate = document.getElementById('hrs-mod-wfdate').value.trim() || null;

  if (end <= start) {
    toast('End time must be after start time', true);
    return;
  }

  try {
    if (_hoursEditingId) {
      await api('PATCH', '/api/hours/entries/' + _hoursEditingId, {
        start_hour: start, end_hour: end, category: category,
        notes: notes, workflow_day_date: wfDate || ''
      });
    } else {
      await api('POST', '/api/hours/entries', {
        date_iso: _hoursPendingNew.date_iso, start_hour: start, end_hour: end,
        category: category, notes: notes, workflow_day_date: wfDate
      });
    }
    _hoursCloseModal();
    await _hoursLoad();
    _hoursRerender();
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + (e.message || e), true);
  }
}

async function _hoursDeleteEntry() {
  if (!_hoursEditingId) return;
  if (!confirm('Delete this entry and its attachments?')) return;
  try {
    await api('DELETE', '/api/hours/entries/' + _hoursEditingId);
    _hoursCloseModal();
    await _hoursLoad();
    _hoursRerender();
    toast('Deleted');
  } catch (e) {
    toast('Delete failed: ' + (e.message || e), true);
  }
}

async function _hoursUploadFile() {
  var input = document.getElementById('hrs-mod-file');
  if (!input || !input.files.length) return;
  if (!_hoursEditingId) {
    toast('Save entry first, then attach files', true);
    return;
  }
  var file = input.files[0];
  var form = new FormData();
  form.append('file', file);
  try {
    var resp = await fetch('/api/hours/entries/' + _hoursEditingId + '/attachments', {
      method: 'POST', body: form
    });
    if (!resp.ok) throw new Error(await resp.text());
    // Reload entry + re-open modal so the new attachment shows
    await _hoursLoad();
    var updated = _hoursEntries.find(function(e){ return e.id === _hoursEditingId; });
    if (updated) await _hoursRenderModal(updated);
    toast('Uploaded');
  } catch (e) {
    toast('Upload failed: ' + (e.message || e), true);
  }
}

async function _hoursRemoveAttachment(attId) {
  if (!confirm('Remove this attachment?')) return;
  try {
    await api('DELETE', '/api/hours/attachments/' + attId);
    await _hoursLoad();
    var updated = _hoursEntries.find(function(e){ return e.id === _hoursEditingId; });
    if (updated) await _hoursRenderModal(updated);
    toast('Removed');
  } catch (e) {
    toast('Remove failed: ' + (e.message || e), true);
  }
}


// ── entry point ───────────────────────────────────────────────────────────
async function renderHours(el) {
  _hoursInjectStyles();
  el.innerHTML = '<div class="hrs-wrap"><div style="padding:40px;text-align:center;color:#8a7f72">Loading...</div></div>';
  try {
    await _hoursLoad();
    el.innerHTML = '<div class="hrs-wrap">' + _hoursRenderWeekGrid() + '</div>';
  } catch (e) {
    el.innerHTML = '<div class="hrs-wrap"><div style="padding:20px;color:#c0392b">Failed to load: ' + esc(e.message || String(e)) + '</div></div>';
  }
}

registerView('hours', renderHours);
