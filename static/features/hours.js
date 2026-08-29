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
var _hoursHolidays = [];        // fetched from /api/hours/holidays for the visible range
var _hoursEditingId = null;     // id of entry being edited, null while creating
var _hoursPendingNew = null;    // {date, startHour, endHour} for a click-to-create
// Live-edited secondary array while the modal is open. Reset whenever the
// modal opens (from an existing entry or as an empty list for a new entry).
// Contains {category, minutes} objects. Persisted to backend on Save.
var _hoursModalSecondary = [];

// Drag-to-select state. _hoursDragging is null when idle, else
// { date, start, current } where start and current are hour indices.
// Set when the user mousedowns on an empty cell; extended by mouseenter
// on other empty cells in the same day-view render; committed on mouseup.
var _hoursDragging = null;

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
    '.hrs-week-row{display:flex;align-items:stretch;gap:8px;margin-bottom:6px}',
    '.hrs-week-row .hrs-week{flex:1;margin-bottom:0}',
    '.hrs-week-tally{flex:0 0 200px;font-size:11px;color:#4a4139;padding:8px;background:#faf8f4;border:1px solid #e8e2d8;border-radius:6px;display:flex;flex-direction:column;justify-content:center;line-height:1.4}',

    '.hrs-grand-total{background:#f0ebe3;border:1px solid #d5cec0;border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:12px;font-size:13px;color:#4a4139}',
    '.hrs-grand-total-label{font-weight:600;color:#8a7f72;font-size:11px;text-transform:uppercase;letter-spacing:.05em}',
    '.hrs-grand-total-body{flex:1}',
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
    /* Holiday cell — grey overlay, name shown in place of hours total. */
    '.hrs-day-cell.holiday{background:#ede8dd;border-style:dashed}',
    '.hrs-holiday-label{margin-top:12px;font-size:11px;color:#8a7f72;font-weight:600;line-height:1.2}',
    '.hrs-day-holiday-badge{margin-left:8px;font-size:11px;color:#8a7f72;font-weight:normal}',
    '.hrs-day-holiday-toggle{margin-left:auto;background:none;border:1px solid #d5cec0;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:12px;color:#4a4139;margin-right:6px}',
    '.hrs-day-holiday-toggle:hover{background:#f0ebe3}',

    /* Day expansion view */
    '.hrs-day-view{margin-top:20px;background:#faf8f4;border:1px solid #d5cec0;border-radius:8px;padding:16px}',
    '.hrs-day-view h2{margin:0 0 12px;font-size:16px;color:#3c342a;display:flex;align-items:center;gap:8px}',
    '.hrs-day-close{margin-left:auto;background:none;border:1px solid #d5cec0;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}',
    '.hrs-hour-grid{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-bottom:10px}',
    '.hrs-hour-cell{background:#fff;border:1px solid #e8e2d8;border-radius:3px;height:44px;cursor:pointer;position:relative;font-size:9px;color:#8a7f72;padding:2px}',
    '.hrs-hour-cell:hover{border-color:#8a7f72}',
    '.hrs-hour-cell.drag-preview{background:#e8f0e8;border-color:#5b7a5e;border-width:2px}',
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
    '.hrs-wf-suggest button{background:none;border:none;color:#4a6fa5;cursor:pointer;padding:0 4px;font-size:12px;text-decoration:underline}',
    '.hrs-copy-wf-btn{background:#f0ebe3;border:1px solid #d5cec0;border-radius:4px;padding:6px 10px;cursor:pointer;font-size:12px;color:#4a4139;margin-top:6px;width:100%}',
    '.hrs-copy-wf-btn:hover{background:#e8e2d8;border-color:#8a7f72}',
    '.hrs-copy-wf-btn:disabled{opacity:.5;cursor:not-allowed}',
    /* Secondary activity rows in the entry modal */
    '.hrs-mod-sec-row{display:flex;gap:6px;align-items:center;margin:3px 0}',
    '.hrs-mod-sec-row select{flex:1;padding:4px 6px}',
    '.hrs-mod-sec-row input[type=number]{width:70px;padding:4px 6px;border:1px solid #d5cec0;border-radius:4px;font-size:12px}',
    '.hrs-mod-sec-unit{font-size:11px;color:#8a7f72}',
    '.hrs-mod-sec-remove{background:none;border:none;color:#c0392b;cursor:pointer;font-size:16px;padding:0 6px;line-height:1}',
    '.hrs-mod-sec-empty{font-size:11px;color:#8a7f72;font-style:italic;padding:4px 0}',
    '.hrs-mod-add-sec{background:none;border:1px dashed #d5cec0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;color:#4a4139;margin-top:4px}'
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
  // Load holidays for the visible range. Cheap: PK-indexed lookup on
  // date_iso and there's rarely more than a few per month.
  try {
    var holidayResp = await api('GET', '/api/hours/holidays?start=' + _isoDate(earliest) +
                                '&end=' + _isoDate(latest));
    _hoursHolidays = holidayResp.holidays || [];
  } catch (e) {
    _hoursHolidays = [];  // don't hard-fail the view if the holidays call errors
  }
}

// Compute total hours + per-category breakdown for a set of entries.
// Primary contribution = end_hour - start_hour hours to entry.category.
// Secondary contribution = each secondary's minutes/60 hours to its own
// category. Secondaries add to the tally on top of primary — per user's
// spec 'secondary has its own time added when its added'.
function _hoursComputeTally(entries) {
  var total = 0;
  var byCategory = {};
  entries.forEach(function(e) {
    var primaryHours = (e.end_hour - e.start_hour);
    total += primaryHours;
    byCategory[e.category] = (byCategory[e.category] || 0) + primaryHours;
    (e.secondary || []).forEach(function(s) {
      var h = (s.minutes || 0) / 60;
      total += h;
      byCategory[s.category] = (byCategory[s.category] || 0) + h;
    });
  });
  return { total: total, byCategory: byCategory };
}

function _hoursFmtTally(tally) {
  // "31.5h · research 12h · writing 8h ..."
  var parts = [_fmtHours(tally.total) + 'h'];
  Object.keys(tally.byCategory).forEach(function(cat) {
    parts.push('<span style="color:' + _categoryColor(cat) + '">' + esc(_categoryLabel(cat).split(' ')[0]) + ' ' + _fmtHours(tally.byCategory[cat]) + 'h</span>');
  });
  return parts.join(' &middot; ');
}

function _hoursHolidayFor(iso) {
  return _hoursHolidays.find(function(h) { return h.date_iso === iso; });
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

  // Grand total row across the visible 4 weeks. Shown above the first
  // week. Includes categories legend info inline so users see the split
  // at a glance without hover.
  var grandTally = _hoursComputeTally(_hoursEntries);
  html += '<div class="hrs-grand-total">' +
    '<span class="hrs-grand-total-label">Last ' + _hoursWeeksToShow + ' weeks</span>' +
    '<span class="hrs-grand-total-body">' + _hoursFmtTally(grandTally) + '</span>' +
  '</div>';

  // Weeks — newest at top
  for (var w = 0; w < _hoursWeeksToShow; w++) {
    var weekStart = _addDays(_hoursWeekStart, -w * 7);
    var weekEndIso = _isoDate(_addDays(weekStart, 6));
    var weekStartIso = _isoDate(weekStart);
    var weekLabel = _fmtDateShort(weekStartIso) + '<br>' + _fmtDateShort(weekEndIso);

    var weekEntries = _hoursEntries.filter(function(e) {
      return e.date_iso >= weekStartIso && e.date_iso <= weekEndIso;
    });
    var weekTally = _hoursComputeTally(weekEntries);

    html += '<div class="hrs-week-row">' +
      '<div class="hrs-week">' +
        '<div class="hrs-week-label">' + weekLabel + '</div>';
    for (var d = 0; d < 7; d++) {
      var day = _addDays(weekStart, d);
      var iso = _isoDate(day);
      html += _hoursRenderDayCell(day, iso, iso === todayISO);
    }
    html += '</div>' +
      '<div class="hrs-week-tally">' + _hoursFmtTally(weekTally) + '</div>' +
    '</div>';
  }

  // Day view expansion (if a day is selected)
  if (_hoursSelectedDate) {
    html += _hoursRenderDayView(_hoursSelectedDate);
  }

  return html;
}

function _hoursRenderDayCell(day, iso, isToday) {
  var dayEntries = _hoursEntries.filter(function(e) { return e.date_iso === iso; });
  var holiday = _hoursHolidayFor(iso);
  var totalHours = 0;
  var catHours = {};
  var attCount = 0;
  dayEntries.forEach(function(e) {
    var h = e.end_hour - e.start_hour;
    totalHours += h;
    catHours[e.category] = (catHours[e.category] || 0) + h;
    // Secondaries feed into the day's cat-mix stripe too so the visual
    // heatmap reflects the full activity, not just primary time.
    (e.secondary || []).forEach(function(s) {
      var sh = (s.minutes || 0) / 60;
      totalHours += sh;
      catHours[s.category] = (catHours[s.category] || 0) + sh;
    });
    attCount += (e.attachments || []).length;
  });
  var dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()];
  var cls = 'hrs-day-cell';
  if (isToday) cls += ' today';
  if (iso === _hoursSelectedDate) cls += ' selected';
  if (holiday) cls += ' holiday';

  var html = '<div class="' + cls + '" onclick="_hoursSelectDay(\'' + iso + '\')">';
  html += '<div class="hrs-day-header">' + dayName + '</div>';
  html += '<div class="hrs-day-date">' + day.getDate() + '</div>';
  if (holiday) {
    // Holiday label preempts the hours total. Users can still expand the
    // day if they want to log something (in case a holiday turned into a
    // work day) — the "Mark as holiday" toggle in the day view can flip
    // it back off.
    html += '<div class="hrs-holiday-label" title="Holiday: ' + esc(holiday.name || '(unnamed)') + '">&#128197; ' + esc(holiday.name || 'Holiday') + '</div>';
  } else if (totalHours > 0) {
    html += '<div class="hrs-day-total">' + _fmtHours(totalHours) +
            '<span class="hrs-day-total-unit">h</span></div>';
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
  var holiday = _hoursHolidayFor(iso);
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
          (holiday ? '<span class="hrs-day-holiday-badge" title="Holiday">&#128197; ' + esc(holiday.name || 'Holiday') + '</span>' : '') +
          '<button class="hrs-day-holiday-toggle" onclick="_hoursToggleHoliday(\'' + iso + '\')">' +
            (holiday ? 'Remove holiday' : 'Mark as holiday') +
          '</button>' +
          '<button class="hrs-day-close" onclick="_hoursCloseDay()">Close</button>' +
          '</h2>';

  html += '<div class="hrs-hour-grid" onmouseleave="_hoursDragCancel()">';
  for (var h = 0; h < 24; h++) {
    var entry = hourMap[h];
    if (entry) {
      var color = _categoryColor(entry.category);
      var isStart = entry.start_hour === h;
      var catLabel = isStart ? esc(_categoryLabel(entry.category)) : '';
      html += '<div class="hrs-hour-cell filled" style="background:' + color +
              '" onclick="_hoursOpenEntryModal(' + entry.id + ')" data-filled="1">' +
              '<span class="hrs-hour-cell-hour">' + h + '</span>' +
              (catLabel ? '<span class="hrs-hour-cell-cat">' + catLabel + '</span>' : '') +
              '</div>';
    } else {
      // Drag semantics: mousedown starts a range, mouseenter extends it,
      // mouseup on any empty cell opens the modal pre-filled. Mouseup
      // outside the grid or on a filled cell cancels. Data attrs let the
      // handlers find the cell's hour + date without HTML parsing.
      html += '<div class="hrs-hour-cell" data-hour="' + h + '" data-date="' + iso +
              '" onmousedown="_hoursDragStart(\'' + iso + '\',' + h + ',event)"' +
              ' onmouseenter="_hoursDragExtend(' + h + ')"' +
              ' onmouseup="_hoursDragEnd(\'' + iso + '\',' + h + ')">' +
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

// Toggle a date's holiday status. If already a holiday, delete it; else
// prompt for an optional name and create. Reloads holidays + re-renders.
async function _hoursToggleHoliday(iso) {
  var existing = _hoursHolidayFor(iso);
  try {
    if (existing) {
      await api('DELETE', '/api/hours/holidays/' + iso);
      toast('Holiday removed');
    } else {
      var name = prompt('Holiday name (optional):', '') || '';
      await api('POST', '/api/hours/holidays', { date_iso: iso, name: name.trim() });
      toast('Holiday added');
    }
    await _hoursLoad();
    _hoursRerender();
  } catch (e) {
    toast('Holiday toggle failed: ' + (e.message || e), true);
  }
}


// ── drag-to-fill (24-hour grid) ───────────────────────────────────────────
// Empty cells participate in a click-and-drag range selection. Filled
// cells break the drag (can't overlay an existing entry). The pointer
// leaving the grid entirely cancels via the wrapper's onmouseleave.
// Global mouseup catches releases outside any cell (e.g. above the grid).

function _hoursDragStart(iso, hour, ev) {
  if (ev && ev.button !== 0) return;  // ignore right-click / middle-click
  _hoursDragging = { date: iso, start: hour, current: hour };
  _hoursDragPaint();
  if (ev && ev.preventDefault) ev.preventDefault();
}

function _hoursDragExtend(hour) {
  if (!_hoursDragging) return;
  _hoursDragging.current = hour;
  _hoursDragPaint();
}

function _hoursDragEnd(iso, hour) {
  if (!_hoursDragging) return;
  var start = Math.min(_hoursDragging.start, hour);
  var end = Math.max(_hoursDragging.start, hour) + 1;  // exclusive
  _hoursDragCancel();
  _hoursStartCreate(iso, start, end);
}

function _hoursDragCancel() {
  if (!_hoursDragging) return;
  _hoursDragging = null;
  _hoursDragPaint();
}

function _hoursDragPaint() {
  // Highlight cells in [min(start,current), max(start,current)] with the
  // drag-preview class; remove the class from any cell outside the range.
  var cells = document.querySelectorAll('.hrs-hour-cell[data-hour]');
  if (!_hoursDragging) {
    cells.forEach(function(c) { c.classList.remove('drag-preview'); });
    return;
  }
  var lo = Math.min(_hoursDragging.start, _hoursDragging.current);
  var hi = Math.max(_hoursDragging.start, _hoursDragging.current);
  cells.forEach(function(c) {
    var h = parseInt(c.getAttribute('data-hour'));
    var inRange = h >= lo && h <= hi;
    c.classList.toggle('drag-preview', inRange);
  });
}

// Global mouseup — releases outside any cell (above the grid, on the day
// header, etc.) cancel the drag cleanly rather than leaving stale state.
document.addEventListener('mouseup', function() {
  // Only cancel if drag hasn't already been committed to a cell's mouseup.
  // A committed drag will already have called _hoursDragCancel; this is
  // just the "no cell caught it" case.
  setTimeout(function() { if (_hoursDragging) _hoursDragCancel(); }, 0);
});


// ── modal: create / edit entry ────────────────────────────────────────────
async function _hoursStartCreate(iso, startHour, endHour) {
  _hoursEditingId = null;
  _hoursPendingNew = {
    date_iso: iso,
    start_hour: startHour,
    end_hour: (typeof endHour === 'number' ? endHour : startHour + 1)
  };
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
    // Secondary activities — per user spec, each has its own duration and
    // contributes independently to category totals. Rendered as a list of
    // rows below primary. The list itself lives in _hoursModalSecondary
    // (module state) so add/remove clicks can mutate it without a full
    // modal re-render; only the secondary-list container gets patched.
    '<label>Secondary activities</label>' +
    '<div id="hrs-mod-secondary-list"></div>' +
    '<button type="button" class="hrs-mod-add-sec" onclick="_hoursSecAdd()">+ Add secondary</button>' +
    '<label>Notes</label>' +
    '<textarea id="hrs-mod-notes" placeholder="What did you do? Why does it matter?"></textarea>' +
    // Copy events from workflow day: pulls all time-events (workflow chips
    // + step ticks from protocol runs) in this entry's hour range and
    // formats them into the notes field. Only useful if a workflow day
    // is linked — the button is disabled otherwise.
    '<button class="hrs-copy-wf-btn" id="hrs-copy-wf-btn" onclick="_hoursCopyFromWorkflow()">' +
      '&#128203; Copy events from workflow day into notes' +
    '</button>' +
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
  // Snapshot the entry's secondary list into module state so users can
  // add/remove rows without triggering a full modal re-render.
  _hoursModalSecondary = (entry && Array.isArray(entry.secondary))
    ? entry.secondary.map(function(s) { return {category: s.category, minutes: s.minutes}; })
    : [];
  _hoursRenderSecondaryList();
  // Copy-workflow button is only useful when a workflow day is linked.
  _hoursUpdateCopyBtnState();
}

// Render the current _hoursModalSecondary as a list of rows into the
// #hrs-mod-secondary-list container. Called on modal init and after each
// add/remove/change so state and DOM stay in sync.
function _hoursRenderSecondaryList() {
  var el = document.getElementById('hrs-mod-secondary-list');
  if (!el) return;
  if (!_hoursModalSecondary.length) {
    el.innerHTML = '<div class="hrs-mod-sec-empty">No secondary activities</div>';
    return;
  }
  var catOpts = _hoursCategories.map(function(c) {
    return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
  }).join('');
  var html = '';
  _hoursModalSecondary.forEach(function(s, i) {
    html += '<div class="hrs-mod-sec-row">' +
      '<select onchange="_hoursSecChange(' + i + ',\'category\',this.value)">' + catOpts + '</select>' +
      '<input type="number" min="0" max="1440" step="5" value="' + (s.minutes || 0) + '" onchange="_hoursSecChange(' + i + ',\'minutes\',parseInt(this.value)||0)"/>' +
      '<span class="hrs-mod-sec-unit">min</span>' +
      '<button type="button" class="hrs-mod-sec-remove" onclick="_hoursSecRemove(' + i + ')">&times;</button>' +
    '</div>';
  });
  el.innerHTML = html;
  // Set select values after insert (setting via value attribute doesn't work)
  _hoursModalSecondary.forEach(function(s, i) {
    var selects = el.querySelectorAll('select');
    if (selects[i]) selects[i].value = s.category;
  });
}

function _hoursSecAdd() {
  _hoursModalSecondary.push({ category: 'research', minutes: 30 });
  _hoursRenderSecondaryList();
}

function _hoursSecRemove(i) {
  _hoursModalSecondary.splice(i, 1);
  _hoursRenderSecondaryList();
}

function _hoursSecChange(i, field, value) {
  if (_hoursModalSecondary[i]) {
    _hoursModalSecondary[i][field] = value;
  }
}

// Reflect wf-link state on the copy button. Called after modal render and
// whenever _hoursSetWfDate changes the link.
function _hoursUpdateCopyBtnState() {
  var btn = document.getElementById('hrs-copy-wf-btn');
  if (!btn) return;
  var wfDate = (document.getElementById('hrs-mod-wfdate') || {}).value || '';
  btn.disabled = !wfDate;
  btn.title = wfDate
    ? 'Copy chips + step ticks from workflow day ' + wfDate + ' in the current hour range'
    : 'Link a workflow day first';
}

async function _hoursCopyFromWorkflow() {
  var wfDate = (document.getElementById('hrs-mod-wfdate') || {}).value || '';
  if (!wfDate) { toast('Link a workflow day first', true); return; }
  var start = parseInt(document.getElementById('hrs-mod-start').value);
  var end = parseInt(document.getElementById('hrs-mod-end').value);
  if (end <= start) { toast('Set a valid time range first', true); return; }
  try {
    var resp = await api('GET',
      '/api/time-events/for-hour-range?date=' + wfDate +
      '&start_hour=' + start + '&end_hour=' + end);
    if (!resp.rendered_text) {
      toast('No events found in that time range');
      return;
    }
    var notesEl = document.getElementById('hrs-mod-notes');
    var current = (notesEl.value || '').trim();
    // Append rather than overwrite so any notes the user already typed
    // survive. Separator makes the source visible.
    var block = 'From workflow day ' + wfDate + ':\n' + resp.rendered_text;
    notesEl.value = current ? (current + '\n\n' + block) : block;
    toast('Copied ' + resp.events.length + ' event(s)');
  } catch (e) {
    toast('Copy failed: ' + (e.message || e), true);
  }
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
  _hoursUpdateCopyBtnState();
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
        notes: notes, workflow_day_date: wfDate || '',
        secondary: _hoursModalSecondary
      });
    } else {
      await api('POST', '/api/hours/entries', {
        date_iso: _hoursPendingNew.date_iso, start_hour: start, end_hour: end,
        category: category, notes: notes, workflow_day_date: wfDate,
        secondary: _hoursModalSecondary
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
