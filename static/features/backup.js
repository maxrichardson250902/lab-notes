/* ── Backup Feature ─────────────────────────────────────────────────────── */

async function renderBackup(el) {
  el.innerHTML = '<div class="bk-loading">Loading…</div>';

  var settings = {};
  var backups   = [];

  try {
    settings = await api('GET', '/api/backup/settings');
  } catch(e) { settings = {}; }
  try {
    var d = await api('GET', '/api/backup/list');
    backups = d.items || [];
  } catch(e) { backups = []; }

  el.innerHTML = buildBackupUI(settings, backups);
  attachBackupHandlers(el, settings, backups);
}

/* ── UI builder ─────────────────────────────────────────────────────────── */

function buildBackupUI(settings, backups) {
  var last = backups.find(function(b){ return b.status === 'ok' || b.status === 'partial'; });
  var lastStr = last ? relTime(last.created) : 'Never';
  var nextStr = settings.daily_enabled
    ? ('Daily at ' + (settings.daily_time || '02:00') + ' UTC')
    : 'Scheduled backup off';

  var totalSize = backups.reduce(function(a,b){ return a + (b.size_bytes||0); }, 0);
  var totalStr  = backups.length + ' backup' + (backups.length === 1 ? '' : 's') +
                  ' · ' + _fmtBytes(totalSize);

  return '<div class="bk-wrap">' +

    /* ── header ── */
    '<div class="bk-header">' +
      '<div class="bk-header-left">' +
        '<div class="bk-title">Backup &amp; Restore</div>' +
        '<div class="bk-subtitle">Protect your lab data across multiple destinations</div>' +
      '</div>' +
      '<button class="bk-btn-primary" id="bk-run-btn">↑ Back Up Now</button>' +
    '</div>' +

    /* ── stat row ── */
    '<div class="bk-stats">' +
      _statCard('Last backup', lastStr, 'bk-stat-icon-time') +
      _statCard('Scheduled', nextStr, 'bk-stat-icon-cal') +
      _statCard('Stored', totalStr, 'bk-stat-icon-db') +
      _statCard('Google Drive', settings.rclone_configured ? '● Connected' : '○ Not linked', 'bk-stat-icon-cloud', settings.rclone_configured ? 'ok' : 'off') +
      _statCard('Network Share', settings.smb_host ? '● Connected' : '○ Not linked', 'bk-stat-icon-smb', settings.smb_host ? 'ok' : 'off') +
    '</div>' +

    /* ── tabs ── */
    '<div class="bk-tabs">' +
      '<button class="bk-tab bk-tab-active" data-tab="history">History</button>' +
      '<button class="bk-tab" data-tab="schedule">Schedule</button>' +
      '<button class="bk-tab" data-tab="gdrive">Google Drive</button>' +
      '<button class="bk-tab" data-tab="smb">Network Share</button>' +
    '</div>' +

    /* ── tab panels ── */
    '<div class="bk-panels">' +
      _panelHistory(backups) +
      _panelSchedule(settings) +
      _panelGdrive(settings) +
      _panelSmb(settings) +
    '</div>' +

    /* ── run modal ── */
    _runModal(settings) +

    /* ── restore modal ── */
    '<div class="bk-overlay" id="bk-restore-overlay" style="display:none">' +
      '<div class="bk-modal">' +
        '<div class="bk-modal-title">⚠ Restore Backup</div>' +
        '<p class="bk-modal-body">This will <strong>overwrite your current database and all .gb files</strong> with the selected backup. The page will reload after restore.</p>' +
        '<p class="bk-modal-filename" id="bk-restore-filename" style="font-family:\'SF Mono\',Monaco,Consolas,monospace;font-size:.8rem;background:#f0ebe3;padding:6px 10px;border-radius:4px;margin:0 0 20px;word-break:break-all"></p>' +
        '<div class="bk-modal-actions">' +
          '<button class="bk-btn-ghost" id="bk-restore-cancel">Cancel</button>' +
          '<button class="bk-btn-danger" id="bk-restore-confirm">Restore This Backup</button>' +
        '</div>' +
      '</div>' +
    '</div>' +

  '</div>';
}

function _statCard(label, value, iconCls, state) {
  var cls = 'bk-stat-card' + (state ? ' bk-stat-' + state : '');
  return '<div class="' + cls + '">' +
    '<div class="bk-stat-label">' + label + '</div>' +
    '<div class="bk-stat-value">' + esc(value) + '</div>' +
  '</div>';
}

function _panelHistory(backups) {
  var rows = '';
  if (!backups.length) {
    rows = '<div class="bk-empty">No backups yet — press "Back Up Now" to create one.</div>';
  } else {
    rows = '<table class="bk-table"><thead><tr>' +
      '<th>File</th><th>Size</th><th>Destinations</th><th>When</th><th>Status</th><th></th>' +
    '</tr></thead><tbody>';
    backups.forEach(function(b) {
      var dests = (b.destinations || []).map(function(d){
        var icons = {local:'💾', gdrive:'☁', smb:'🖥'};
        return '<span class="bk-dest-tag">' + (icons[d]||'') + ' ' + esc(d) + '</span>';
      }).join('');
      var statusCls = b.status === 'ok' ? 'bk-status-ok' : b.status === 'partial' ? 'bk-status-partial' : 'bk-status-err';
      var statusLabel = b.status === 'ok' ? '✓ OK' : b.status === 'partial' ? '⚠ Partial' : '✗ Error';
      var actions = '';
      if (b.exists) {
        actions += '<button class="bk-act bk-act-dl" data-id="' + b.id + '" title="Download">↓</button>';
        actions += '<button class="bk-act bk-act-restore" data-id="' + b.id + '" data-file="' + esc(b.filename) + '" title="Restore">↺</button>';
      }
      actions += '<button class="bk-act bk-act-del" data-id="' + b.id + '" title="Delete">✕</button>';

      rows += '<tr class="' + (b.exists?'':'bk-row-missing') + '">' +
        '<td class="bk-cell-file"><span class="bk-filename">' + esc(b.filename) + '</span>' +
          (b.notes ? '<div class="bk-notes">' + esc(b.notes) + '</div>' : '') + '</td>' +
        '<td class="bk-cell-size">' + _fmtBytes(b.size_bytes) + '</td>' +
        '<td>' + dests + '</td>' +
        '<td class="bk-cell-when">' + relTime(b.created) + '</td>' +
        '<td><span class="bk-status ' + statusCls + '">' + statusLabel + '</span></td>' +
        '<td class="bk-cell-actions">' + actions + '</td>' +
      '</tr>';
    });
    rows += '</tbody></table>';
  }
  return '<div class="bk-panel bk-panel-active" id="bk-panel-history">' + rows + '</div>';
}

function _panelSchedule(s) {
  return '<div class="bk-panel" id="bk-panel-schedule">' +
    '<div class="bk-form-section">' +
      '<div class="bk-section-label">Automatic Daily Backup</div>' +
      '<label class="bk-toggle-row">' +
        '<input type="checkbox" id="bk-daily-enabled" ' + (s.daily_enabled ? 'checked' : '') + '>' +
        '<span>Enable daily backup</span>' +
      '</label>' +
      '<div class="bk-field-row" style="margin-top:16px">' +
        '<label class="bk-label">Time (UTC)</label>' +
        '<input class="bk-input bk-input-sm" type="time" id="bk-daily-time" value="' + esc(s.daily_time||'02:00') + '">' +
      '</div>' +
      '<p class="bk-hint">Daily backups automatically push to all configured destinations (local, Google Drive, and Network Share if set up).</p>' +
      '<button class="bk-btn-primary" id="bk-save-schedule">Save Schedule</button>' +
    '</div>' +
  '</div>';
}

function _panelGdrive(s) {
  var available  = s.rclone_available;
  var configured = s.rclone_configured;
  var remote     = s.rclone_remote || 'gdrive';
  var path       = s.rclone_path   || 'lab_backups';

  var statusBadge = '';
  if (!available) {
    statusBadge = '<div class="bk-alert-box bk-alert-warn">⚠ rclone is not installed in the container — add <code>RUN apt-get update && apt-get install -y rclone</code> to your Dockerfile and rebuild.</div>';
  } else if (!configured) {
    statusBadge = '<div class="bk-alert-box bk-alert-warn">⚠ rclone remote <strong>' + esc(remote) + '</strong> is not configured. Follow the setup steps below.</div>';
  } else {
    statusBadge = '<div class="bk-connected-badge">● rclone connected — remote: ' + esc(remote) + '</div>';
  }

  return '<div class="bk-panel" id="bk-panel-gdrive">' +
    '<div class="bk-form-section">' +
      '<div class="bk-section-label">Google Drive — via rclone</div>' +
      statusBadge +

      '<p class="bk-hint" style="margin-top:14px">rclone uses your personal Google account (no service account needed). ' +
      'Run <code>rclone config</code> on your host machine once to authenticate, then the container picks it up automatically via the mounted config.</p>' +

      '<details class="bk-details">' +
        '<summary class="bk-details-summary">Setup instructions</summary>' +
        '<ol class="bk-ol">' +
          '<li>On your Windows/Linux machine: download rclone from <strong>rclone.org/downloads</strong></li>' +
          '<li>Run <code>rclone config</code> → new remote → name it <strong>gdrive</strong> → Google Drive → leave client_id blank → scope <strong>3</strong> (drive.file) → auto config yes</li>' +
          '<li>Copy the config to your server:<br><code>scp ~/.config/rclone/rclone.conf max@SERVER_IP:~/.config/rclone/rclone.conf</code></li>' +
          '<li>Make sure your <code>docker-compose.yml</code> has:<br><code>- /home/max/.config/rclone:/root/.config/rclone:ro</code></li>' +
          '<li>Rebuild the container</li>' +
        '</ol>' +
      '</details>' +

      '<div class="bk-field-row" style="margin-top:20px">' +
        '<label class="bk-label">Remote name</label>' +
        '<input class="bk-input bk-input-sm" type="text" id="bk-gdrive-remote" value="' + esc(remote) + '" placeholder="gdrive">' +
        '<p class="bk-hint-sm">Must match the name you gave in <code>rclone config</code></p>' +
      '</div>' +
      '<div class="bk-field-row">' +
        '<label class="bk-label">Folder on Drive</label>' +
        '<input class="bk-input bk-input-sm" type="text" id="bk-gdrive-path" value="' + esc(path) + '" placeholder="lab_backups">' +
        '<p class="bk-hint-sm">Folder name (or path) inside your Google Drive to store backups</p>' +
      '</div>' +
      '<div class="bk-actions-row">' +
        '<button class="bk-btn-secondary" id="bk-gdrive-test">Test Connection</button>' +
        '<button class="bk-btn-primary" id="bk-gdrive-save">Save</button>' +
      '</div>' +
      '<div id="bk-gdrive-status" class="bk-conn-status"></div>' +
    '</div>' +
  '</div>';
}

function _panelSmb(s) {
  return '<div class="bk-panel" id="bk-panel-smb">' +
    '<div class="bk-form-section">' +
      '<div class="bk-section-label">Network Share (SMB/Windows)</div>' +
      (s.smb_host ? '<div class="bk-connected-badge">● ' + esc(s.smb_host) + '</div>' : '') +
      '<p class="bk-hint">Connect to your home PC\'s shared network drive. Make sure the share is accessible from the server (same network or VPN).</p>' +
      '<div class="bk-grid-2">' +
        '<div class="bk-field-row">' +
          '<label class="bk-label">Host / IP</label>' +
          '<input class="bk-input" type="text" id="bk-smb-host" placeholder="192.168.1.100" value="' + esc(s.smb_host||'') + '">' +
        '</div>' +
        '<div class="bk-field-row">' +
          '<label class="bk-label">Share Name</label>' +
          '<input class="bk-input" type="text" id="bk-smb-share" placeholder="backup" value="' + esc(s.smb_share||'') + '">' +
        '</div>' +
        '<div class="bk-field-row">' +
          '<label class="bk-label">Username</label>' +
          '<input class="bk-input" type="text" id="bk-smb-user" placeholder="username" value="' + esc(s.smb_user||'') + '" autocomplete="off">' +
        '</div>' +
        '<div class="bk-field-row">' +
          '<label class="bk-label">Password</label>' +
          '<input class="bk-input" type="password" id="bk-smb-password" placeholder="••••••••" autocomplete="new-password">' +
        '</div>' +
      '</div>' +
      '<div class="bk-field-row">' +
        '<label class="bk-label">Sub-folder on share</label>' +
        '<input class="bk-input bk-input-sm" type="text" id="bk-smb-path" placeholder="lab_backups" value="' + esc(s.smb_path||'lab_backups') + '">' +
      '</div>' +
      '<div class="bk-actions-row">' +
        (s.smb_host ? '<button class="bk-btn-ghost bk-btn-danger-ghost" id="bk-smb-clear">Disconnect</button>' : '') +
        '<button class="bk-btn-secondary" id="bk-smb-test">Test Connection</button>' +
        '<button class="bk-btn-primary" id="bk-smb-save">Save</button>' +
      '</div>' +
      '<div id="bk-smb-status" class="bk-conn-status"></div>' +
    '</div>' +
  '</div>';
}

function _runModal(s) {
  return '<div class="bk-overlay" id="bk-run-overlay" style="display:none">' +
    '<div class="bk-modal">' +
      '<div class="bk-modal-title">Create Backup</div>' +
      '<p class="bk-modal-body">Choose where to send this backup:</p>' +
      '<div class="bk-dest-checks">' +
        '<label class="bk-check-row"><input type="checkbox" name="bk-dest" value="local" checked disabled> <span>💾 Local <span class="bk-optional">(always saved)</span></span></label>' +
        '<label class="bk-check-row"><input type="checkbox" name="bk-dest" value="gdrive" id="bk-dest-gdrive" checked> <span>☁ Google Drive</span></label>' +
        '<label class="bk-check-row"><input type="checkbox" name="bk-dest" value="smb" id="bk-dest-smb"> <span>🖥 Network Share</span></label>' +
      '</div>' +
      '<div class="bk-field-row" style="margin-top:16px">' +
        '<label class="bk-label">Label <span class="bk-optional">(optional)</span></label>' +
        '<input class="bk-input" type="text" id="bk-run-label" placeholder="e.g. before-migration">' +
      '</div>' +
      '<div class="bk-modal-actions">' +
        '<button class="bk-btn-ghost" id="bk-run-cancel">Cancel</button>' +
        '<button class="bk-btn-primary" id="bk-run-confirm">Create Backup</button>' +
      '</div>' +
      '<div id="bk-run-status" class="bk-conn-status"></div>' +
    '</div>' +
  '</div>';
}

/* ── event handlers ─────────────────────────────────────────────────────── */

function attachBackupHandlers(el, settings, backups) {
  /* tabs */
  el.querySelectorAll('.bk-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      el.querySelectorAll('.bk-tab').forEach(function(t){ t.classList.remove('bk-tab-active'); });
      el.querySelectorAll('.bk-panel').forEach(function(p){ p.classList.remove('bk-panel-active'); });
      tab.classList.add('bk-tab-active');
      var panel = el.querySelector('#bk-panel-' + tab.dataset.tab);
      if (panel) panel.classList.add('bk-panel-active');
    });
  });

  /* Run modal */
  var runOverlay = el.querySelector('#bk-run-overlay');
  el.querySelector('#bk-run-btn').addEventListener('click', function() {
    el.querySelector('#bk-run-label').value = '';
    el.querySelector('#bk-run-status').textContent = '';
    runOverlay.style.display = 'flex';
  });
  el.querySelector('#bk-run-cancel').addEventListener('click', function(){ runOverlay.style.display='none'; });
  runOverlay.addEventListener('click', function(e){ if(e.target===runOverlay) runOverlay.style.display='none'; });

  el.querySelector('#bk-run-confirm').addEventListener('click', async function() {
    var btn   = this;
    var dests = ['local'];
    el.querySelectorAll('input[name="bk-dest"]').forEach(function(cb){
      if (cb.checked && !cb.disabled && cb.value !== 'local') dests.push(cb.value);
    });
    var label = el.querySelector('#bk-run-label').value.trim();
    var st    = el.querySelector('#bk-run-status');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    st.className = 'bk-conn-status';
    st.textContent = '⏳ Creating backup archive…';
    try {
      var result = await api('POST', '/api/backup/run', {destinations: dests, label: label});
      runOverlay.style.display = 'none';
      var destList = result.destinations ? result.destinations.join(', ') : 'local';
      toast('Backup created → ' + destList);
      renderBackup(document.getElementById('content'));
    } catch(e) {
      st.className = 'bk-conn-status bk-status-err';
      st.textContent = '✗ ' + (e.message || 'Backup failed');
      btn.disabled = false;
      btn.textContent = 'Create Backup';
    }
  });

  /* History actions */
  el.querySelectorAll('.bk-act-dl').forEach(function(btn) {
    btn.addEventListener('click', function() {
      window.open('/api/backup/' + btn.dataset.id + '/download', '_blank');
    });
  });

  var restoreOverlay = el.querySelector('#bk-restore-overlay');
  var pendingRestoreId = null;

  el.querySelectorAll('.bk-act-restore').forEach(function(btn) {
    btn.addEventListener('click', function() {
      pendingRestoreId = btn.dataset.id;
      el.querySelector('#bk-restore-filename').textContent = btn.dataset.file;
      restoreOverlay.style.display = 'flex';
    });
  });
  el.querySelector('#bk-restore-cancel').addEventListener('click', function(){ restoreOverlay.style.display='none'; });
  restoreOverlay.addEventListener('click', function(e){ if(e.target===restoreOverlay) restoreOverlay.style.display='none'; });

  el.querySelector('#bk-restore-confirm').addEventListener('click', async function() {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Restoring…';
    try {
      var r = await api('POST', '/api/backup/' + pendingRestoreId + '/restore', {});
      toast(r.message || 'Restore complete');
      restoreOverlay.style.display = 'none';
      setTimeout(function(){ location.reload(); }, 1500);
    } catch(e) {
      toast('Restore failed: ' + (e.message || 'Unknown error'), true);
      btn.disabled = false;
      btn.textContent = 'Restore This Backup';
    }
  });

  el.querySelectorAll('.bk-act-del').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      if (!confirm('Delete this backup? (local file will be removed)')) return;
      try {
        await api('DELETE', '/api/backup/' + btn.dataset.id, null);
        toast('Backup deleted');
        renderBackup(document.getElementById('content'));
      } catch(e) {
        toast('Delete failed', true);
      }
    });
  });

  /* Schedule */
  var saveSchedBtn = el.querySelector('#bk-save-schedule');
  if (saveSchedBtn) {
    saveSchedBtn.addEventListener('click', async function() {
      var enabled = el.querySelector('#bk-daily-enabled').checked;
      var time    = el.querySelector('#bk-daily-time').value;
      try {
        await api('POST', '/api/backup/settings', {daily_enabled: enabled, daily_time: time});
        toast('Schedule saved');
        renderBackup(document.getElementById('content'));
      } catch(e) {
        toast('Save failed', true);
      }
    });
  }

  /* Google Drive (rclone) */
  var gSave   = el.querySelector('#bk-gdrive-save');
  var gTest   = el.querySelector('#bk-gdrive-test');
  var gStatus = el.querySelector('#bk-gdrive-status');

  if (gSave) {
    gSave.addEventListener('click', async function() {
      var remote = (el.querySelector('#bk-gdrive-remote') || {}).value || 'gdrive';
      var path   = (el.querySelector('#bk-gdrive-path')   || {}).value || 'lab_backups';
      gSave.disabled = true;
      gStatus.className = 'bk-conn-status';
      gStatus.textContent = '⏳ Saving…';
      try {
        await api('POST', '/api/backup/settings', {rclone_remote: remote.trim(), rclone_path: path.trim()});
        gStatus.className = 'bk-conn-status bk-status-ok';
        gStatus.textContent = '✓ Saved';
        setTimeout(function(){ renderBackup(document.getElementById('content')); }, 600);
      } catch(e) {
        gStatus.className = 'bk-conn-status bk-status-err';
        gStatus.textContent = '✗ ' + (e.message || 'Failed');
        gSave.disabled = false;
      }
    });
  }

  if (gTest) {
    gTest.addEventListener('click', async function() {
      gStatus.className = 'bk-conn-status';
      gStatus.textContent = '⏳ Testing rclone connection…';
      try {
        var tr = await api('POST', '/api/backup/test-rclone', {});
        gStatus.className = 'bk-conn-status bk-status-ok';
        gStatus.textContent = '✓ Connected\n' + (tr.info || '');
      } catch(e) {
        gStatus.className = 'bk-conn-status bk-status-err';
        gStatus.textContent = '✗ ' + (e.message || 'Connection failed');
      }
    });
  }

  /* SMB */
  var sSave   = el.querySelector('#bk-smb-save');
  var sTest   = el.querySelector('#bk-smb-test');
  var sClear  = el.querySelector('#bk-smb-clear');
  var sStatus = el.querySelector('#bk-smb-status');

  function readSmbFields() {
    return {
      smb_host:     (el.querySelector('#bk-smb-host')     || {}).value || null,
      smb_share:    (el.querySelector('#bk-smb-share')    || {}).value || null,
      smb_user:     (el.querySelector('#bk-smb-user')     || {}).value || null,
      smb_password: (el.querySelector('#bk-smb-password') || {}).value || null,
      smb_path:     (el.querySelector('#bk-smb-path')     || {}).value || 'lab_backups',
    };
  }

  if (sSave) {
    sSave.addEventListener('click', async function() {
      var fields = readSmbFields();
      if (!fields.smb_host || !fields.smb_share) {
        sStatus.className='bk-conn-status bk-status-err';
        sStatus.textContent='✗ Host and share name are required';
        return;
      }
      // Don't send "***" placeholders
      var payload = {};
      Object.keys(fields).forEach(function(k){
        if (fields[k] && fields[k] !== '***') payload[k] = fields[k];
      });
      sSave.disabled = true;
      sStatus.className='bk-conn-status'; sStatus.textContent='⏳ Saving…';
      try {
        await api('POST', '/api/backup/settings', payload);
        sStatus.className='bk-conn-status bk-status-ok';
        sStatus.textContent='✓ Settings saved';
        sSave.disabled = false;
        setTimeout(function(){ renderBackup(document.getElementById('content')); }, 600);
      } catch(e) {
        sStatus.className='bk-conn-status bk-status-err';
        sStatus.textContent='✗ ' + (e.message||'Failed');
        sSave.disabled = false;
      }
    });
  }

  if (sTest) {
    sTest.addEventListener('click', async function() {
      sStatus.className='bk-conn-status'; sStatus.textContent='⏳ Testing connection…';
      try {
        await api('POST', '/api/backup/test-smb', {});
        sStatus.className='bk-conn-status bk-status-ok';
        sStatus.textContent='✓ Connected to share';
      } catch(e) {
        sStatus.className='bk-conn-status bk-status-err';
        sStatus.textContent='✗ ' + (e.message||'Connection failed');
      }
    });
  }

  if (sClear) {
    sClear.addEventListener('click', async function() {
      if (!confirm('Disconnect network share?')) return;
      await api('POST', '/api/backup/settings/clear-smb', {});
      toast('Network share disconnected');
      renderBackup(document.getElementById('content'));
    });
  }
}

/* ── formatting helpers ─────────────────────────────────────────────────── */

function _fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n/1048576).toFixed(1) + ' MB';
  return (n/1073741824).toFixed(2) + ' GB';
}

/* ── styles ─────────────────────────────────────────────────────────────── */

(function injectBackupStyles() {
  if (document.getElementById('bk-styles')) return;
  var s = document.createElement('style');
  s.id = 'bk-styles';
  s.textContent = `
.bk-wrap { padding: 28px 32px; max-width: 1100px; }
.bk-loading { color: #8a7f72; padding: 40px; text-align: center; }

/* header */
.bk-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; gap:16px; }
.bk-header-left {}
.bk-title { font-size:1.35rem; font-weight:600; color:#4a4139; letter-spacing:-.02em; }
.bk-subtitle { font-size:.85rem; color:#8a7f72; margin-top:3px; }

/* stat cards */
.bk-stats { display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap; }
.bk-stat-card { background:#fff; border:1px solid #d5cec0; border-radius:8px; padding:14px 18px; min-width:140px; flex:1; }
.bk-stat-card.bk-stat-ok .bk-stat-value { color:#5b7a5e; }
.bk-stat-card.bk-stat-off .bk-stat-value { color:#b0a899; }
.bk-stat-label { font-size:.68rem; text-transform:uppercase; letter-spacing:.12em; color:#8a7f72; margin-bottom:5px; }
.bk-stat-value { font-size:.88rem; font-weight:600; color:#4a4139; }

/* tabs */
.bk-tabs { display:flex; gap:2px; border-bottom:1px solid #d5cec0; margin-bottom:0; }
.bk-tab { background:none; border:none; padding:8px 18px; font-size:.84rem; color:#8a7f72; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; transition:color .15s; }
.bk-tab:hover { color:#4a4139; }
.bk-tab-active { color:#4a4139; font-weight:600; border-bottom-color:#5b7a5e; }

/* panels */
.bk-panel { display:none; padding:24px 0; }
.bk-panel-active { display:block; }
.bk-empty { color:#8a7f72; font-size:.88rem; padding:32px; text-align:center; background:#f7f4ef; border-radius:8px; border:1px dashed #d5cec0; }

/* table */
.bk-table { width:100%; border-collapse:collapse; font-size:.84rem; }
.bk-table thead tr { border-bottom:2px solid #d5cec0; }
.bk-table th { text-align:left; font-size:.68rem; text-transform:uppercase; letter-spacing:.1em; color:#8a7f72; padding:8px 10px; font-weight:600; }
.bk-table td { padding:10px 10px; border-bottom:1px solid #ede8e0; vertical-align:middle; }
.bk-table tr:last-child td { border-bottom:none; }
.bk-row-missing td { opacity:.5; }
.bk-filename { font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.75rem; color:#4a4139; word-break:break-all; }
.bk-notes { font-size:.72rem; color:#b85c38; margin-top:3px; }
.bk-cell-size { color:#8a7f72; white-space:nowrap; }
.bk-cell-when { color:#8a7f72; white-space:nowrap; font-size:.8rem; }
.bk-cell-actions { display:flex; gap:4px; justify-content:flex-end; }
.bk-dest-tag { display:inline-block; font-size:.72rem; background:#f0ebe3; border:1px solid #d5cec0; border-radius:4px; padding:2px 7px; margin:2px 2px; color:#6a6059; }

/* status badges */
.bk-status { font-size:.75rem; font-weight:600; padding:2px 8px; border-radius:12px; }
.bk-status-ok  { color:#5b7a5e; background:#eef3ee; }
.bk-status-partial { color:#9a6b2e; background:#fdf3e3; }
.bk-status-err { color:#c0392b; background:#fdecea; }

/* action buttons */
.bk-act { background:none; border:1px solid #d5cec0; border-radius:5px; padding:4px 9px; font-size:.78rem; cursor:pointer; color:#4a4139; transition:all .15s; }
.bk-act:hover { background:#f0ebe3; }
.bk-act-del:hover { background:#fdecea; border-color:#e8b4b0; color:#c0392b; }

/* form sections */
.bk-form-section { max-width:600px; }
.bk-section-label { font-size:.68rem; text-transform:uppercase; letter-spacing:.12em; color:#8a7f72; margin-bottom:16px; font-weight:600; }
.bk-field-row { margin-bottom:14px; }
.bk-label { display:block; font-size:.8rem; font-weight:600; color:#4a4139; margin-bottom:5px; }
.bk-optional { font-weight:400; color:#8a7f72; }
.bk-input { width:100%; box-sizing:border-box; background:#fff; border:1px solid #d5cec0; border-radius:6px; padding:8px 10px; font-size:.85rem; color:#4a4139; outline:none; font-family:inherit; }
.bk-input:focus { border-color:#5b7a5e; }
.bk-input-sm { max-width:200px; }
.bk-textarea { resize:vertical; min-height:120px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.75rem; }
.bk-hint { font-size:.78rem; color:#8a7f72; margin:8px 0 16px; line-height:1.5; }
.bk-hint-sm { font-size:.72rem; color:#a09590; margin-top:-8px; margin-bottom:14px; }
.bk-hint code { background:#f0ebe3; padding:1px 5px; border-radius:3px; font-family:"SF Mono",Monaco,Consolas,monospace; }
.bk-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
.bk-actions-row { display:flex; gap:8px; margin-top:20px; flex-wrap:wrap; }
.bk-toggle-row { display:flex; align-items:center; gap:10px; cursor:pointer; font-size:.88rem; color:#4a4139; }
.bk-toggle-row input { accent-color:#5b7a5e; width:16px; height:16px; cursor:pointer; }
.bk-connected-badge { display:inline-block; font-size:.78rem; font-weight:600; color:#5b7a5e; background:#eef3ee; border:1px solid #c3d9c5; border-radius:20px; padding:3px 12px; margin-bottom:14px; }
.bk-conn-status { margin-top:12px; font-size:.8rem; min-height:20px; }
.bk-conn-status.bk-status-ok  { color:#5b7a5e; }
.bk-conn-status.bk-status-err { color:#c0392b; }

/* buttons */
.bk-btn-primary { background:#5b7a5e; color:#fff; border:none; border-radius:6px; padding:9px 20px; font-size:.84rem; font-weight:600; cursor:pointer; transition:background .15s; font-family:inherit; white-space:nowrap; }
.bk-btn-primary:hover { background:#4a6650; }
.bk-btn-primary:disabled { background:#a0b8a2; cursor:not-allowed; }
.bk-btn-secondary { background:#f0ebe3; color:#4a4139; border:1px solid #d5cec0; border-radius:6px; padding:9px 20px; font-size:.84rem; font-weight:600; cursor:pointer; transition:all .15s; font-family:inherit; }
.bk-btn-secondary:hover { background:#e8e2d8; }
.bk-btn-ghost { background:none; color:#8a7f72; border:1px solid #d5cec0; border-radius:6px; padding:9px 20px; font-size:.84rem; cursor:pointer; font-family:inherit; transition:all .15s; }
.bk-btn-ghost:hover { background:#f0ebe3; color:#4a4139; }
.bk-btn-danger-ghost { color:#c0392b; border-color:#e8b4b0; }
.bk-btn-danger-ghost:hover { background:#fdecea; color:#c0392b; }
.bk-btn-danger { background:#c0392b; color:#fff; border:none; border-radius:6px; padding:9px 20px; font-size:.84rem; font-weight:600; cursor:pointer; font-family:inherit; }
.bk-btn-danger:hover { background:#a93226; }
.bk-btn-danger:disabled { background:#e0a099; cursor:not-allowed; }

/* modal */
.bk-overlay { position:fixed; inset:0; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; z-index:1000; pointer-events: none; }
.bk-modal { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; padding:28px 32px; max-width:480px; width:90%; box-shadow:0 8px 32px rgba(60,52,42,.18); position:relative; z-index:1001; pointer-events: all; }
.bk-modal-title { font-size:1.05rem; font-weight:700; color:#4a4139; margin-bottom:12px; }
.bk-modal-body { font-size:.86rem; color:#6a6059; line-height:1.6; margin:0 0 14px; }
.bk-modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
.bk-dest-checks { display:flex; flex-direction:column; gap:10px; margin:16px 0; }
.bk-check-row { display:flex; align-items:center; gap:10px; font-size:.88rem; color:#4a4139; cursor:pointer; }
.bk-check-row input { accent-color:#5b7a5e; width:15px; height:15px; }
.bk-alert-box { font-size:.82rem; padding:10px 14px; border-radius:6px; margin-bottom:12px; line-height:1.5; }
.bk-alert-warn { background:#fdf3e3; border:1px solid #f0d090; color:#7a5a1e; }
.bk-alert-warn code { background:#fbe8c0; padding:1px 5px; border-radius:3px; font-family:"SF Mono",Monaco,Consolas,monospace; }
.bk-details { border:1px solid #d5cec0; border-radius:6px; margin:12px 0; }
.bk-details-summary { padding:10px 14px; font-size:.82rem; font-weight:600; color:#4a4139; cursor:pointer; user-select:none; }
.bk-details-summary:hover { background:#f0ebe3; border-radius:6px; }
.bk-ol { margin:0; padding:14px 14px 14px 28px; font-size:.82rem; color:#6a6059; line-height:2; }
.bk-ol code { background:#f0ebe3; padding:1px 5px; border-radius:3px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.75rem; }
  `;
  document.head.appendChild(s);
})();

/* ── register ────────────────────────────────────────────────────────────── */
registerView('backup', renderBackup);
