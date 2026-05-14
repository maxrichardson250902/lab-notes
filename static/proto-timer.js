// ═══════════════════════════════════════════════════════════════════════════════
//  FLOATING PROTOCOL TIMER — persists in localStorage, survives view changes
//  Usage: protoTimerAdd('Incubate at 37°C', 1800, 'PCR Protocol')
//         protoTimerAdd('Centrifuge', 300)
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  var STORAGE_KEY = 'lab_proto_timers';
  var COLLAPSED_KEY = 'lab_proto_timers_collapsed';
  var _tickInterval = null;
  var _audioCtx = null;

  // ── styles ────────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.id = 'proto-timer-styles';
  style.textContent = [
    '#proto-timer-float{position:fixed;bottom:16px;right:16px;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;pointer-events:auto}',
    '#proto-timer-float *{box-sizing:border-box}',
    '.ptf-panel{background:#faf8f4;border:1px solid #d5cec0;border-radius:10px;box-shadow:0 4px 24px rgba(60,52,42,.18);min-width:280px;max-width:340px;overflow:hidden;transition:opacity .15s}',
    '.ptf-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f0ebe3;border-bottom:1px solid #d5cec0;cursor:move;user-select:none}',
    '.ptf-header-title{font-size:12px;font-weight:700;color:#4a4139;display:flex;align-items:center;gap:6px}',
    '.ptf-header-actions{display:flex;gap:4px}',
    '.ptf-header-actions button{background:none;border:none;cursor:pointer;font-size:14px;color:#8a7f72;padding:2px 4px;line-height:1;border-radius:3px}',
    '.ptf-header-actions button:hover{background:#e8e2d8;color:#4a4139}',
    '.ptf-body{max-height:320px;overflow-y:auto}',
    '.ptf-empty{padding:14px;text-align:center;color:#b0a898;font-size:12px;font-style:italic}',
    '.ptf-timer{padding:10px 12px;border-bottom:1px solid #e8e2d8;display:flex;align-items:center;gap:10px}',
    '.ptf-timer:last-child{border-bottom:none}',
    '.ptf-timer.done{background:#fff3cd}',
    '.ptf-timer.done .ptf-time{color:#856404;animation:ptf-flash 1s ease-in-out infinite}',
    '@keyframes ptf-flash{0%,100%{opacity:1}50%{opacity:.4}}',
    '.ptf-timer-info{flex:1;min-width:0}',
    '.ptf-timer-label{font-size:12px;font-weight:600;color:#4a4139;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ptf-timer-proto{font-size:10px;color:#8a7f72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ptf-time{font-size:20px;font-weight:700;color:#4a4139;font-variant-numeric:tabular-nums;letter-spacing:-.5px;flex-shrink:0}',
    '.ptf-timer-btns{display:flex;gap:2px;flex-shrink:0}',
    '.ptf-timer-btns button{background:none;border:1px solid #d5cec0;border-radius:4px;cursor:pointer;font-size:12px;color:#8a7f72;padding:3px 6px;line-height:1}',
    '.ptf-timer-btns button:hover{background:#f0ebe3;color:#4a4139}',
    '.ptf-timer-btns button.pause{color:#5b7a5e;border-color:#c8d8c8}',
    '.ptf-timer-btns button.remove{color:#c0392b;border-color:#f0c0c0}',
    '.ptf-progress{height:3px;background:#e8e2d8;margin-top:6px;border-radius:2px;overflow:hidden}',
    '.ptf-progress-fill{height:100%;background:#5b7a5e;border-radius:2px;transition:width .5s linear}',
    '.ptf-timer.done .ptf-progress-fill{background:#ffc107}',
    /* collapsed pill */
    '.ptf-pill{display:none;background:#5b7a5e;color:#fff;border-radius:20px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 2px 12px rgba(60,52,42,.2);white-space:nowrap;user-select:none}',
    '.ptf-pill:hover{background:#4a6b4d}',
    '.ptf-pill .ptf-pill-time{font-variant-numeric:tabular-nums}',
    '.ptf-pill.has-done{background:#856404;animation:ptf-flash 1s ease-in-out infinite}',
    /* add timer form */
    '.ptf-add{padding:8px 12px;border-top:1px solid #e8e2d8;display:flex;gap:6px;align-items:center}',
    '.ptf-add input{flex:1;border:1px solid #d5cec0;border-radius:4px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}',
    '.ptf-add input:focus{border-color:#5b7a5e}',
    '.ptf-add button{background:#5b7a5e;color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}',
    '.ptf-add button:hover{background:#4a6b4d}'
  ].join('');
  if (!document.getElementById('proto-timer-styles')) document.head.appendChild(style);

  // ── state ─────────────────────────────────────────────────────────────────
  function loadTimers() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function saveTimers(timers) { localStorage.setItem(STORAGE_KEY, JSON.stringify(timers)); }
  function isCollapsed() { return localStorage.getItem(COLLAPSED_KEY) === '1'; }
  function setCollapsed(v) { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); }

  // ── time helpers ──────────────────────────────────────────────────────────
  function fmtTime(sec) {
    if (sec <= 0) return '0:00';
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return m + ':' + String(s).padStart(2,'0');
  }

  function parseDuration(text) {
    // "30 min", "5 minutes", "1h", "10s", "2 hours", "90 sec", "1.5 min", "1h30m"
    var total = 0, found = false;
    // compound: 1h30m, 1h 30m
    var compound = text.match(/(\d+)\s*h(?:ours?|r)?[\s]*(\d+)\s*m(?:in(?:utes?)?)?/i);
    if (compound) return parseInt(compound[1]) * 3600 + parseInt(compound[2]) * 60;
    // individual matches
    var patterns = [
      [/(\d+(?:\.\d+)?)\s*h(?:ours?|r)?/gi, 3600],
      [/(\d+(?:\.\d+)?)\s*min(?:utes?)?/gi, 60],
      [/(\d+(?:\.\d+)?)\s*m(?![a-z])/gi, 60],
      [/(\d+(?:\.\d+)?)\s*sec(?:onds?)?/gi, 1],
      [/(\d+(?:\.\d+)?)\s*s(?![a-z])/gi, 1]
    ];
    for (var i = 0; i < patterns.length; i++) {
      var re = patterns[i][0], mult = patterns[i][1], match;
      while ((match = re.exec(text)) !== null) { total += parseFloat(match[1]) * mult; found = true; }
      if (found) break; // use first matching unit type
    }
    return found ? Math.round(total) : 0;
  }

  function remaining(timer) {
    if (!timer.running) return timer.remainingSeconds;
    var elapsed = Math.floor((Date.now() - timer.resumedAt) / 1000);
    return Math.max(0, timer.remainingSeconds - elapsed);
  }

  // ── notifications ─────────────────────────────────────────────────────────
  function playBeep() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = _audioCtx.createOscillator();
      var gain = _audioCtx.createGain();
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, _audioCtx.currentTime + 0.5);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.5);
      // double beep
      setTimeout(function() {
        var o2 = _audioCtx.createOscillator();
        var g2 = _audioCtx.createGain();
        o2.connect(g2); g2.connect(_audioCtx.destination);
        o2.frequency.value = 1100;
        g2.gain.setValueAtTime(0.3, _audioCtx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.01, _audioCtx.currentTime + 0.5);
        o2.start(_audioCtx.currentTime); o2.stop(_audioCtx.currentTime + 0.5);
      }, 300);
    } catch(e) {}
  }

  function notifyDone(timer) {
    playBeep();
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Timer done!', { body: timer.label + (timer.protocol ? ' — ' + timer.protocol : ''), icon: '⏰' });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }

  // ── core ──────────────────────────────────────────────────────────────────
  function addTimer(label, totalSeconds, protocol) {
    var timers = loadTimers();
    var id = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    timers.push({
      id: id, label: label, protocol: protocol || '',
      totalSeconds: totalSeconds, remainingSeconds: totalSeconds,
      running: true, resumedAt: Date.now(), done: false, notified: false
    });
    saveTimers(timers);
    setCollapsed(false);
    render();
    ensureTicking();
    // request notification permission early
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }

  function removeTimer(id) {
    var timers = loadTimers().filter(function(t) { return t.id !== id; });
    saveTimers(timers); render();
    if (!timers.length) stopTicking();
  }

  function togglePause(id) {
    var timers = loadTimers();
    var t = timers.find(function(x) { return x.id === id; });
    if (!t || t.done) return;
    if (t.running) {
      // pause — snapshot remaining
      var elapsed = Math.floor((Date.now() - t.resumedAt) / 1000);
      t.remainingSeconds = Math.max(0, t.remainingSeconds - elapsed);
      t.running = false;
    } else {
      // resume
      t.resumedAt = Date.now();
      t.running = true;
    }
    saveTimers(timers); render(); ensureTicking();
  }

  function addMinute(id) {
    var timers = loadTimers();
    var t = timers.find(function(x) { return x.id === id; });
    if (!t) return;
    t.remainingSeconds += 60;
    t.totalSeconds += 60;
    if (t.done) { t.done = false; t.notified = false; t.running = true; t.resumedAt = Date.now(); }
    saveTimers(timers); render(); ensureTicking();
  }

  function tick() {
    var timers = loadTimers();
    var changed = false;
    timers.forEach(function(t) {
      if (!t.running || t.done) return;
      var rem = remaining(t);
      if (rem <= 0) {
        t.remainingSeconds = 0;
        t.running = false;
        t.done = true;
        if (!t.notified) { t.notified = true; changed = true; notifyDone(t); }
      }
    });
    if (changed) saveTimers(timers);
    render();
    // stop ticking if nothing active
    if (!timers.some(function(t) { return t.running && !t.done; })) stopTicking();
  }

  function ensureTicking() { if (!_tickInterval) _tickInterval = setInterval(tick, 500); }
  function stopTicking() { if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; } }

  // ── quick-add parsing ─────────────────────────────────────────────────────
  function parseQuickAdd(text) {
    // "Incubate 30 min" or "5m centrifuge" or just "10:00"
    var colonMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(.*)$/);
    if (colonMatch) {
      var secs = parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
      if (colonMatch[3]) secs = parseInt(colonMatch[1]) * 3600 + parseInt(colonMatch[2]) * 60 + parseInt(colonMatch[3]);
      return { seconds: secs, label: colonMatch[4].trim() || 'Timer' };
    }
    var dur = parseDuration(text);
    if (dur > 0) {
      var label = text.replace(/\d+(?:\.\d+)?\s*(?:hours?|hr?|minutes?|mins?|seconds?|secs?|m(?![a-z])|s(?![a-z]))/gi, '').replace(/\s+/g, ' ').trim();
      return { seconds: dur, label: label || 'Timer' };
    }
    return null;
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render() {
    var timers = loadTimers();
    var container = document.getElementById('proto-timer-float');
    if (!container) {
      container = document.createElement('div');
      container.id = 'proto-timer-float';
      document.body.appendChild(container);
    }

    if (!timers.length) { container.innerHTML = ''; return; }

    var collapsed = isCollapsed();
    var hasDone = timers.some(function(t) { return t.done; });
    var activeCount = timers.filter(function(t) { return t.running && !t.done; }).length;

    if (collapsed) {
      // show pill
      var firstRunning = timers.find(function(t) { return t.running && !t.done; });
      var pillTime = firstRunning ? fmtTime(remaining(firstRunning)) : (hasDone ? 'DONE!' : '--');
      var pillLabel = timers.length + ' timer' + (timers.length > 1 ? 's' : '');
      container.innerHTML = '<div class="ptf-pill' + (hasDone ? ' has-done' : '') + '" onclick="protoTimerExpand()">&#9202; ' + pillLabel + ' &nbsp;<span class="ptf-pill-time">' + pillTime + '</span></div>';
      container.querySelector('.ptf-pill').style.display = 'inline-flex';
      return;
    }

    var html = '<div class="ptf-panel">';
    html += '<div class="ptf-header"><div class="ptf-header-title">&#9202; Timers <span style="font-weight:400;color:#8a7f72;font-size:11px">' + timers.length + '</span></div>';
    html += '<div class="ptf-header-actions"><button onclick="protoTimerCollapse()" title="Minimize">&#9472;</button><button onclick="protoTimerClearDone()" title="Clear finished">&#10003;</button></div></div>';
    html += '<div class="ptf-body">';

    timers.forEach(function(t) {
      var rem = t.done ? 0 : remaining(t);
      var pct = t.totalSeconds > 0 ? Math.round(((t.totalSeconds - rem) / t.totalSeconds) * 100) : 100;
      html += '<div class="ptf-timer' + (t.done ? ' done' : '') + '">';
      html += '<div class="ptf-timer-info"><div class="ptf-timer-label">' + _esc(t.label) + '</div>';
      if (t.protocol) html += '<div class="ptf-timer-proto">' + _esc(t.protocol) + '</div>';
      html += '<div class="ptf-progress"><div class="ptf-progress-fill" style="width:' + pct + '%"></div></div></div>';
      html += '<div class="ptf-time">' + (t.done ? 'DONE' : fmtTime(rem)) + '</div>';
      html += '<div class="ptf-timer-btns">';
      if (!t.done) html += '<button class="pause" onclick="protoTimerToggle(\'' + t.id + '\')" title="' + (t.running ? 'Pause' : 'Resume') + '">' + (t.running ? '&#10074;&#10074;' : '&#9654;') + '</button>';
      html += '<button onclick="protoTimerAddMin(\'' + t.id + '\')" title="+1 min">+1m</button>';
      html += '<button class="remove" onclick="protoTimerRemove(\'' + t.id + '\')" title="Remove">&#215;</button>';
      html += '</div></div>';
    });

    html += '</div>';
    // quick-add form
    html += '<div class="ptf-add"><input type="text" id="ptf-quick" placeholder="e.g. 30 min incubate" spellcheck="false" onkeydown="if(event.key===\'Enter\')protoTimerQuickAdd()"/>';
    html += '<button onclick="protoTimerQuickAdd()">Start</button></div>';
    html += '</div>';
    container.innerHTML = html;
  }

  function _esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── global API ────────────────────────────────────────────────────────────
  window.protoTimerAdd = function(label, seconds, protocol) { addTimer(label, seconds, protocol); };
  window.protoTimerRemove = function(id) { removeTimer(id); };
  window.protoTimerToggle = function(id) { togglePause(id); };
  window.protoTimerAddMin = function(id) { addMinute(id); };
  window.protoTimerCollapse = function() { setCollapsed(true); render(); };
  window.protoTimerExpand = function() { setCollapsed(false); render(); };
  window.protoTimerParseDuration = parseDuration;
  window.protoTimerClearDone = function() {
    var timers = loadTimers().filter(function(t) { return !t.done; });
    saveTimers(timers); render();
    if (!timers.length) stopTicking();
  };
  window.protoTimerQuickAdd = function() {
    var inp = document.getElementById('ptf-quick');
    if (!inp || !inp.value.trim()) return;
    var parsed = parseQuickAdd(inp.value.trim());
    if (!parsed || parsed.seconds <= 0) {
      inp.style.borderColor = '#c0392b';
      setTimeout(function() { inp.style.borderColor = ''; }, 1000);
      return;
    }
    addTimer(parsed.label, parsed.seconds, '');
    inp.value = '';
  };

  // ── init: restore running timers and start ticking ────────────────────────
  var timers = loadTimers();
  if (timers.some(function(t) { return t.running && !t.done; })) ensureTicking();
  render();

})();
