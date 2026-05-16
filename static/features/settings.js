/* Settings view — UI for the user preferences exposed by features/settings/router.py
   Registers as a regular view ('settings') and a sidebar nav entry. On save,
   updates the backend AND calls applySettings() so changes take effect
   immediately without a reload.

   Each setting is described in SETTINGS_SPEC. To add a new one, add an entry
   there and a corresponding default on the backend (DEFAULTS in router.py).
   The render code walks this spec and produces the right input type for each. */

var SETTINGS_SPEC = [
  {
    key: 'wide_view_max_px',
    label: 'Wide view max width',
    hint: 'Maximum width for data-dense views (workflow, cloning, gel, sanger…). Set to 0 to fill the whole screen.',
    type: 'number',
    min: 0,    // 0 = no cap; backend treats anything <800 as no-cap too
    max: 4000,
    step: 100,
    suffix: 'px',
  },
  {
    key: 'default_view',
    label: 'View on app load',
    hint: 'Which view to open when you first load Lab Notes.',
    type: 'select',
    /* Options populated dynamically from the registered views — see below. */
    optionsFromViews: true,
  },
  {
    key: 'sidebar_auto_hide',
    label: 'Auto-hide sidebar on view change',
    hint: 'After clicking a nav item, the sidebar slides away. Hover the left edge of the screen to bring it back.',
    type: 'toggle',
  },
  {
    key: 'sidebar_peek_delay_ms',
    label: 'Sidebar peek delay',
    hint: 'How long to hover the left edge before the sidebar appears. Lower = snappier; higher = fewer accidental triggers.',
    type: 'number',
    min: 0,
    max: 3000,
    step: 50,
    suffix: 'ms',
  },
  {
    key: 'auto_save_delay_ms',
    label: 'Auto-save delay',
    hint: 'How long to wait after you stop typing before auto-saving (workflow doc, scratchpad, etc.). Lower = saves more often but more network traffic.',
    type: 'number',
    min: 300,
    max: 10000,
    step: 100,
    suffix: 'ms',
  },
];

async function renderSettings(el) {
  /* Ensure settings are loaded (in case the user lands here before boot's
     loadSettings completed — defensive, shouldn't normally matter). */
  if (typeof loadSettings === 'function') await loadSettings();

  var s = S.settings || {};

  /* List of views that make sense as a default. Kept in sync with the sidebar
     in index.dev.html. _navItems is intentionally not used here because the
     sidebar is HTML-defined (not registered programmatically) so _navItems is
     empty. If the sidebar grows a new view, add it here too. */
  var viewOptions = [
    { value: 'notebook', label: 'Notebook' },
    { value: 'workflow', label: 'Daily Workflow' },
    { value: 'protocols', label: 'Protocol Library' },
    { value: 'summaries', label: 'Project Summaries' },
    { value: 'pipeline', label: 'Pipeline' },
    { value: 'timeline', label: 'Project Timelines' },
    { value: 'predictions', label: 'Predicted Tasks' },
    { value: 'reminders', label: 'Reminders' },
    { value: 'cloning', label: 'Cloning Workbench' },
    { value: 'circuits', label: 'Circuits' },
    { value: 'import_data', label: 'DNA Manager' },
    { value: 'gel_annotation', label: 'Gel Annotation' },
    { value: 'sanger', label: 'Sanger' },
    { value: 'dilution', label: 'Dilution Calculator' },
    { value: 'tm_calc', label: 'Tm Calculator' },
    { value: 'scratch', label: 'Scratch Pad' },
  ];

  var html = '<div style="max-width:680px">';
  html += '<h2 style="font-family:var(--serif);font-size:24px;font-weight:600;margin-bottom:6px">Settings</h2>';
  html += '<div style="color:#8a7f72;font-size:13px;margin-bottom:24px">Changes save automatically and take effect right away.</div>';

  SETTINGS_SPEC.forEach(function(spec) {
    var current = (spec.key in s) ? s[spec.key] : '';
    html += '<div class="settings-row">';
    html += '  <div class="settings-row-head">';
    html += '    <div class="settings-row-label">' + esc(spec.label) + '</div>';
    if (spec.hint) html += '    <div class="settings-row-hint">' + esc(spec.hint) + '</div>';
    html += '  </div>';
    html += '  <div class="settings-row-input">';
    if (spec.type === 'number') {
      html += '<input type="number" id="set-' + spec.key + '" value="' + esc(current) +
              '" min="' + (spec.min != null ? spec.min : 0) +
              '" max="' + (spec.max != null ? spec.max : 999999) +
              '" step="' + (spec.step || 1) + '" />';
      if (spec.suffix) html += ' <span class="settings-suffix">' + esc(spec.suffix) + '</span>';
    } else if (spec.type === 'toggle') {
      html += '<label class="settings-toggle">';
      html += '  <input type="checkbox" id="set-' + spec.key + '"' + (current ? ' checked' : '') + ' />';
      html += '  <span class="settings-toggle-slider"></span>';
      html += '</label>';
    } else if (spec.type === 'select') {
      var opts = spec.optionsFromViews ? viewOptions : (spec.options || []);
      html += '<select id="set-' + spec.key + '">';
      opts.forEach(function(o) {
        var selected = (String(o.value) === String(current)) ? ' selected' : '';
        html += '<option value="' + esc(o.value) + '"' + selected + '>' + esc(o.label) + '</option>';
      });
      html += '</select>';
    } else if (spec.type === 'text') {
      html += '<input type="text" id="set-' + spec.key + '" value="' + esc(current) + '" />';
    }
    html += '  </div>';
    html += '</div>';
  });

  /* Reset button — escape hatch in case anyone saves a bad value */
  html += '<div style="margin-top:32px;padding-top:18px;border-top:1px solid var(--border)">';
  html += '  <button class="btn" style="color:#c0392b" onclick="settingsReset()">Reset all settings to defaults</button>';
  html += '  <span id="set-save-status" style="margin-left:14px;font-size:12px;color:#8a7f72">&nbsp;</span>';
  html += '</div>';
  html += '</div>';
  html += _settingsStyles();

  el.innerHTML = html;

  /* Bind change handlers — onChange (not oninput) so we don't fire on every
     keystroke for number inputs. */
  SETTINGS_SPEC.forEach(function(spec) {
    var inp = document.getElementById('set-' + spec.key);
    if (!inp) return;
    var evt = (spec.type === 'toggle' || spec.type === 'select') ? 'change' : 'change';
    inp.addEventListener(evt, function() {
      var val = (spec.type === 'toggle') ? inp.checked
              : (spec.type === 'number') ? parseInt(inp.value, 10)
              : inp.value;
      _settingsSave(spec.key, val);
    });
  });
}

async function _settingsSave(key, value) {
  var status = document.getElementById('set-save-status');
  if (status) status.textContent = 'Saving\u2026';
  try {
    var updated = await api('PUT', '/api/settings', { key: key, value: value });
    /* Merge full server response back into S.settings (backend may have
       clamped / coerced the value). */
    Object.assign(S.settings, updated);
    /* Re-apply UI side-effects */
    if (typeof applySettings === 'function') applySettings();
    if (status) status.textContent = 'Saved \u00b7 ' + new Date().toLocaleTimeString();
    /* If the user just changed wide_view_max_px or sidebar_auto_hide, the
       current view might look different now — but no re-render needed because
       both are pure CSS / class toggles. */
  } catch (e) {
    if (status) { status.textContent = 'Save failed'; status.style.color = '#c0392b'; }
  }
}

async function settingsReset() {
  if (!confirm('Reset all settings to defaults?')) return;
  try {
    var fresh = await api('POST', '/api/settings/reset', {});
    Object.assign(S.settings, fresh);
    if (typeof applySettings === 'function') applySettings();
    /* Re-render the settings view so inputs show the new (default) values */
    loadView();
  } catch (e) {
    toast('Reset failed: ' + e.message, true);
  }
}
window.settingsReset = settingsReset;

function _settingsStyles() {
  return '<style>' +
    '.settings-row { display:flex; align-items:flex-start; padding:14px 0; border-bottom:1px solid #ece7dd; gap:18px; }' +
    '.settings-row-head { flex:1; min-width:0; }' +
    '.settings-row-label { font-size:14px; font-weight:500; color:#4a4139; }' +
    '.settings-row-hint { font-size:12px; color:#8a7f72; margin-top:3px; line-height:1.4; }' +
    '.settings-row-input { flex-shrink:0; display:flex; align-items:center; gap:6px; min-width:140px; justify-content:flex-end; }' +
    '.settings-row-input input[type=number], .settings-row-input input[type=text] { padding:5px 8px; border:1px solid #d5cec0; border-radius:4px; background:#fff; font-family:inherit; font-size:13px; width:110px; }' +
    '.settings-row-input select { padding:5px 8px; border:1px solid #d5cec0; border-radius:4px; background:#fff; font-family:inherit; font-size:13px; }' +
    '.settings-suffix { font-size:11px; color:#8a7f72; }' +
    /* Toggle switch */
    '.settings-toggle { position:relative; display:inline-block; width:42px; height:22px; }' +
    '.settings-toggle input { opacity:0; width:0; height:0; }' +
    '.settings-toggle-slider { position:absolute; cursor:pointer; inset:0; background:#d5cec0; border-radius:22px; transition:.18s; }' +
    '.settings-toggle-slider:before { position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.18s; }' +
    '.settings-toggle input:checked + .settings-toggle-slider { background:#5b7a5e; }' +
    '.settings-toggle input:checked + .settings-toggle-slider:before { transform:translateX(20px); }' +
    '</style>';
}

registerView('settings', renderSettings);
