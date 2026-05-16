/* ──────────────────────────────────────────────────────────────────────────────
 * wf_editor.js — shared rich-text editor for workflow inputs and scratchpad.
 *
 * Public API:
 *   wfEditorAttach(el, opts)  → returns { getHtml, setHtml, focus, clear, isDirty }
 *
 * opts.onChange(html)         — called after any user edit
 * opts.onSubmit(html)         — called on Enter (Shift+Enter = newline). Optional.
 * opts.onBlur(html)           — called on blur. Optional.
 * opts.placeholder            — placeholder text shown when empty
 * opts.minHeight              — CSS min-height (default 28px for inline, 200px for scratch)
 *
 * Design notes:
 *   - We don't depend on any external editor library. The whole module is built
 *     on contenteditable + document.execCommand (still works everywhere, even
 *     though it's officially deprecated) and a few DOM helpers.
 *   - We deliberately keep formatting limited (bold/italic/underline + tables +
 *     lists + images). No font/color/links UI — keep noise down.
 *   - Tab inserts a 2x2 table when outside one; inside a table, Tab moves to the
 *     next cell and adds a row from the last one.
 *   - Image input: paste (clipboard data), drag-and-drop, and a "+ Image" button
 *     that opens a file picker. All upload via POST /api/workflow/image and
 *     insert an <img src="…"> at the caret.
 *   - Gel embed: "+ Gel" button opens a modal listing gels, picking one inserts
 *     <a data-gel-id="…" class="wf-gel-link">… thumbnail …</a>.
 * ────────────────────────────────────────────────────────────────────────────── */

(function() {
'use strict';

/* CSS injected once globally for the editor styling. We use class hooks the
   sanitizer allowlist permits (prefix "wf-"). */
var _wfEditorStyleInjected = false;
function _wfInjectStyles() {
  if (_wfEditorStyleInjected) return;
  _wfEditorStyleInjected = true;
  var s = document.createElement('style');
  s.textContent = [
    '.wf-editor { position:relative; }',
    '.wf-editor-area { width:100%; box-sizing:border-box; padding:6px 10px; ' +
      'background:var(--surface2,#fff); border:1px solid var(--border,#d5cec0); border-radius:4px; ' +
      'color:var(--text,#4a4139); font-family:inherit; font-size:14px; line-height:1.5; ' +
      'outline:none; min-height:28px; overflow-wrap:break-word; }',
    '.wf-editor-area:focus { border-color:#5b7a5e; }',
    '.wf-editor-area:empty:before { content:attr(data-placeholder); color:#aaa5a0; pointer-events:none; }',
    '.wf-editor-area p { margin:0 0 4px 0; }',
    '.wf-editor-area p:last-child { margin-bottom:0; }',
    '.wf-editor-area table { border-collapse:collapse; margin:6px 0; }',
    '.wf-editor-area td, .wf-editor-area th { border:1px solid #d5cec0; padding:4px 8px; min-width:60px; }',
    '.wf-editor-area th { background:#f0ebe3; }',
    '.wf-editor-area img { max-width:100%; max-height:300px; border-radius:3px; vertical-align:middle; }',
    '.wf-editor-area ul, .wf-editor-area ol { margin:4px 0 4px 22px; padding:0; }',
    '.wf-editor-area li { margin-bottom:2px; }',
    '.wf-editor-area pre { background:#f4f0ea; border:1px solid #ece7dd; border-radius:3px; padding:6px 8px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:12px; overflow-x:auto; }',
    '.wf-editor-area code { background:#f0ebe3; padding:1px 4px; border-radius:2px; font-family:"SF Mono",Monaco,Consolas,monospace; font-size:.9em; }',
    /* Read-only render (timeline cards) */
    '.wf-rich-render { font-size:14px; line-height:1.5; }',
    '.wf-rich-render p { margin:0 0 4px 0; }',
    '.wf-rich-render p:last-child { margin-bottom:0; }',
    '.wf-rich-render table { border-collapse:collapse; margin:4px 0; }',
    '.wf-rich-render td, .wf-rich-render th { border:1px solid #d5cec0; padding:3px 6px; min-width:40px; }',
    '.wf-rich-render th { background:#f0ebe3; }',
    '.wf-rich-render img { max-width:100%; max-height:240px; border-radius:3px; vertical-align:middle; }',
    '.wf-rich-render ul, .wf-rich-render ol { margin:2px 0 2px 18px; padding:0; }',
    /* Gel link */
    '.wf-gel-link { display:inline-flex; align-items:center; gap:6px; padding:2px 8px; background:#f0ebe3; border:1px solid #d5cec0; border-radius:4px; color:#5b7a5e; text-decoration:none; cursor:pointer; font-size:.85em; }',
    '.wf-gel-link:hover { background:#e8e2d6; }',
    '.wf-gel-thumb { width:32px; height:32px; object-fit:cover; border-radius:3px; }',
    /* Toolbar */
    '.wf-tool-row { display:flex; gap:4px; flex-wrap:wrap; padding:4px 0 6px 0; }',
    '.wf-tool-btn { padding:3px 8px; background:transparent; border:1px solid transparent; border-radius:3px; cursor:pointer; font-size:12px; color:#8a7f72; font-family:inherit; }',
    '.wf-tool-btn:hover { background:#f0ebe3; color:#4a4139; }',
    '.wf-tool-sep { width:1px; background:#e0d9cd; margin:0 2px; }',
    /* Gel picker modal */
    '.wf-gel-modal { position:fixed; inset:0; z-index:1000; background:rgba(60,52,42,.35); display:flex; align-items:center; justify-content:center; }',
    '.wf-gel-modal-inner { background:#faf8f4; border:1px solid #d5cec0; border-radius:8px; width:480px; max-width:92vw; max-height:80vh; display:flex; flex-direction:column; }',
    '.wf-gel-modal-hdr { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #ece7dd; font-weight:600; }',
    '.wf-gel-modal-body { padding:8px; overflow-y:auto; }',
    '.wf-gel-pick { display:flex; align-items:center; gap:10px; padding:8px; cursor:pointer; border-radius:4px; }',
    '.wf-gel-pick:hover { background:#f0ebe3; }',
    '.wf-gel-pick-thumb { width:48px; height:48px; object-fit:cover; border-radius:3px; background:#e8e2d6; }',
    /* Floating "Delete table" button — sits above the active table in the editor */
    '.wf-del-table-btn { display:none; position:fixed; z-index:500; padding:3px 10px; font-size:11.5px; color:#c0392b; background:#fff; border:1px solid #e8b4b0; border-radius:4px; cursor:pointer; font-family:inherit; box-shadow:0 1px 4px rgba(0,0,0,.08); }',
    '.wf-del-table-btn:hover { background:#fdecea; border-color:#c0392b; }',
  ].join('\n');
  document.head.appendChild(s);
}

/* ── DOM helpers ──────────────────────────────────────────────────────────── */

function _wfFindAncestor(node, tag) {
  /* Walks up DOM to find the first matching ancestor. Returns null if none. */
  tag = tag.toUpperCase();
  while (node) {
    if (node.nodeType === 1 && node.tagName === tag) return node;
    node = node.parentNode;
  }
  return null;
}

function _wfInsertHtmlAtCaret(html) {
  /* document.execCommand('insertHTML') is deprecated but still works in every
     browser and handles caret placement / undo stack correctly. We could
     reimplement with Range/Selection but it's a lot more code for no gain. */
  document.execCommand('insertHTML', false, html);
}

function _wfMoveCaretInto(node) {
  /* Place caret at start of node (used when inserting a table — caret lands in
     the first cell). */
  var range = document.createRange();
  range.setStart(node, 0);
  range.collapse(true);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ── Image upload ─────────────────────────────────────────────────────────── */

async function _wfUploadImage(file) {
  var fd = new FormData();
  fd.append('image', file, file.name || 'paste.png');
  var resp = await fetch('/api/workflow/image', { method: 'POST', body: fd });
  if (!resp.ok) throw new Error('Upload failed: ' + resp.status);
  return await resp.json();   // { filename, url }
}

async function _wfInsertImageFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return false;
  try {
    var res = await _wfUploadImage(file);
    /* Insert with a trailing space so caret can escape the image */
    _wfInsertHtmlAtCaret('<img src="' + res.url + '" alt="">&nbsp;');
    return true;
  } catch (e) {
    if (typeof toast === 'function') toast('Image upload failed: ' + e.message, true);
    return false;
  }
}

/* ── Gel picker modal ─────────────────────────────────────────────────────── */

var _wfGelPickerOpenFor = null;     // editor instance to insert into after pick

async function _wfOpenGelPicker(editor) {
  _wfGelPickerOpenFor = editor;
  /* Lazy-render the modal each time so the list refreshes. */
  var existing = document.getElementById('wf-gel-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'wf-gel-modal';
  modal.className = 'wf-gel-modal';
  modal.onclick = function(e) { if (e.target === modal) _wfCloseGelPicker(); };
  modal.innerHTML =
    '<div class="wf-gel-modal-inner">' +
      '<div class="wf-gel-modal-hdr"><span>Insert gel</span>' +
        '<span style="cursor:pointer;color:#8a7f72;font-size:1.2rem" onclick="_wfCloseGelPicker()">&times;</span>' +
      '</div>' +
      '<div class="wf-gel-modal-body" id="wf-gel-modal-body">Loading…</div>' +
    '</div>';
  document.body.appendChild(modal);
  try {
    var data = await fetch('/api/gels').then(function(r) { return r.json(); });
    var body = document.getElementById('wf-gel-modal-body');
    if (!body) return;
    var gels = data.items || [];
    if (!gels.length) {
      body.innerHTML = '<div style="color:#8a7f72;padding:12px">No gels yet. Upload one in the Gel Annotation view first.</div>';
      return;
    }
    var html = '';
    gels.forEach(function(g) {
      var thumb = '/api/gel_images/' + encodeURIComponent(g.image_file);
      html += '<div class="wf-gel-pick" onclick="_wfPickGel(' + g.id + ',\'' + (g.image_file || '').replace(/[\\\'"]/g, '') + '\',\'' + (g.title || '').replace(/[\\\'"]/g, '') + '\')">';
      html += '<img class="wf-gel-pick-thumb" src="' + thumb + '" alt="">';
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:500">' + _wfEsc(g.title || ('Gel ' + g.id)) + '</div>';
      html += '<div style="font-size:.72rem;color:#8a7f72">' + (g.lane_count || 0) + ' lanes</div>';
      html += '</div></div>';
    });
    body.innerHTML = html;
  } catch (e) {
    var body = document.getElementById('wf-gel-modal-body');
    if (body) body.innerHTML = '<div style="color:#c25a4a;padding:12px">Failed to load gels.</div>';
  }
}
function _wfCloseGelPicker() {
  var m = document.getElementById('wf-gel-modal');
  if (m) m.remove();
  _wfGelPickerOpenFor = null;
}
function _wfPickGel(gelId, imageFile, title) {
  if (!_wfGelPickerOpenFor) { _wfCloseGelPicker(); return; }
  /* Restore the editor's caret BEFORE insertion — opening the modal moved focus. */
  _wfGelPickerOpenFor.focus();
  var safeTitle = _wfEsc(title || ('Gel ' + gelId));
  var thumb = '/api/gel_images/' + encodeURIComponent(imageFile);
  var html = '<a class="wf-gel-link" data-gel-id="' + gelId + '" href="#gel-' + gelId + '" title="Open in Gel view">' +
             '<img class="wf-gel-thumb" src="' + thumb + '" alt="">' +
             '<span>' + safeTitle + '</span></a>&nbsp;';
  _wfInsertHtmlAtCaret(html);
  _wfCloseGelPicker();
}

function _wfEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/* Expose to global for inline onclick attributes */
window._wfCloseGelPicker = _wfCloseGelPicker;
window._wfPickGel = _wfPickGel;

/* ── Click-through for gel embeds ─────────────────────────────────────────── */

/* One global click handler that delegates: any click on .wf-gel-link
   anywhere in the document opens the gel view with that gel selected. */
function _wfInstallGelClickHandler() {
  if (window._wfGelClickInstalled) return;
  window._wfGelClickInstalled = true;
  document.addEventListener('click', function(e) {
    var link = e.target.closest && e.target.closest('a.wf-gel-link');
    if (!link) return;
    /* If we're inside an editor (contenteditable), the click is for editing,
       not navigation — let the user click it without it firing. */
    if (link.closest('.wf-editor-area')) return;
    e.preventDefault();
    var gelId = parseInt(link.getAttribute('data-gel-id'), 10);
    if (!gelId) return;
    /* Use the navigateWith helper from core.js if available */
    if (typeof navigateWith === 'function') {
      navigateWith('gel_annotation', { gelId: gelId });
    } else if (typeof setView === 'function') {
      if (typeof S !== 'undefined') S._pendingGel = { gelId: gelId };
      setView('gel_annotation');
    }
  });
}

/* ── Public: attach editor to an element ──────────────────────────────────── */

window.wfEditorAttach = function(el, opts) {
  _wfInjectStyles();
  _wfInstallGelClickHandler();
  opts = opts || {};

  /* Mark it editable. We *don't* render a toolbar inside the same element —
     the caller is responsible for rendering tool buttons that call methods
     on the returned API. This keeps the inline (small) and scratchpad
     (with toolbar) variants flexible. */
  el.className = (el.className || '') + ' wf-editor-area';
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'true');
  if (opts.placeholder) el.setAttribute('data-placeholder', opts.placeholder);
  if (opts.minHeight) el.style.minHeight = opts.minHeight;

  /* Set initial content. setHtml accepts HTML; if the caller has only plain
     text, it should pre-wrap or pass it through esc() upstream. */
  if (opts.initialHtml) el.innerHTML = opts.initialHtml;

  var dirty = false;
  function markDirty() {
    dirty = true;
    if (opts.onChange) opts.onChange(el.innerHTML);
  }

  /* ── Floating "Delete table" button ────────────────────────────────────────
     Appears at the top-right of any table the user clicks into. Single shared
     element (one per editor instance) repositioned via getBoundingClientRect.
     Hidden when the click moves outside the table, when the table is removed,
     or when the editor loses focus. */
  var _wfDelTableBtn = null;
  var _wfActiveTable = null;
  function _wfShowDeleteTableBtn(table) {
    _wfActiveTable = table;
    if (!_wfDelTableBtn) {
      _wfDelTableBtn = document.createElement('button');
      _wfDelTableBtn.type = 'button';
      _wfDelTableBtn.className = 'wf-del-table-btn';
      _wfDelTableBtn.innerHTML = '\u00d7 Delete table';
      _wfDelTableBtn.title = 'Remove the entire table';
      /* Use mousedown not click — click fires after editor blurs the button
         which can lose the contenteditable selection. mousedown is reliable. */
      _wfDelTableBtn.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!_wfActiveTable) return;
        if (!confirm('Delete this whole table?')) return;
        var t = _wfActiveTable;
        var next = t.nextElementSibling || t.previousElementSibling || el;
        t.parentNode.removeChild(t);
        if (next && el.contains(next)) _wfMoveCaretInto(next);
        _wfHideDeleteTableBtn();
        markDirty();
      });
      document.body.appendChild(_wfDelTableBtn);
    }
    var rect = table.getBoundingClientRect();
    _wfDelTableBtn.style.display = 'block';
    _wfDelTableBtn.style.position = 'fixed';
    /* Right-align with the table; sit just above it. clamp so it stays in
       viewport if the table is near the top of the screen. */
    var top = rect.top - 28;
    if (top < 4) top = rect.top + 4;
    _wfDelTableBtn.style.top = top + 'px';
    _wfDelTableBtn.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
  }
  function _wfHideDeleteTableBtn() {
    _wfActiveTable = null;
    if (_wfDelTableBtn) _wfDelTableBtn.style.display = 'none';
  }
  /* Show/hide the button as the user clicks around */
  el.addEventListener('click', function(e) {
    var table = _wfFindAncestor(e.target, 'TABLE');
    if (table && el.contains(table)) {
      _wfShowDeleteTableBtn(table);
    } else {
      _wfHideDeleteTableBtn();
    }
  });
  /* Reposition on scroll/resize while a table is active */
  function _wfRepositionDelBtn() {
    if (_wfActiveTable && _wfDelTableBtn && _wfDelTableBtn.style.display !== 'none') {
      /* If the table was removed from the DOM (e.g. via Backspace), drop it */
      if (!document.body.contains(_wfActiveTable)) {
        _wfHideDeleteTableBtn();
        return;
      }
      _wfShowDeleteTableBtn(_wfActiveTable);
    }
  }
  window.addEventListener('scroll', _wfRepositionDelBtn, true);
  window.addEventListener('resize', _wfRepositionDelBtn);
  /* Hide when the editor loses focus — but not immediately, because the user
     might be clicking the delete button itself. The mousedown handler on the
     button preventDefaults to keep the editor focused, but blurring elsewhere
     should clear. Use a small timeout so the button click can fire first. */
  el.addEventListener('blur', function() {
    setTimeout(function() {
      if (document.activeElement !== el && _wfDelTableBtn !== document.activeElement) {
        _wfHideDeleteTableBtn();
      }
    }, 150);
  });


  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      /* If inside a list or table, let the browser handle it (creates new li/row). */
      if (_wfFindAncestor(window.getSelection().anchorNode, 'li') ||
          _wfFindAncestor(window.getSelection().anchorNode, 'td') ||
          _wfFindAncestor(window.getSelection().anchorNode, 'th')) {
        return;  // browser default
      }
      if (opts.onSubmit) {
        e.preventDefault();
        opts.onSubmit(el.innerHTML);
      }
      return;
    }

    if (e.key === 'Backspace') {
      /* Backspace inside an empty table cell: delete the current row. If that
         was the last row, delete the whole table.
         We only do this when the cell is empty (no text, no images, no nested
         elements with content) — otherwise normal Backspace character-delete
         applies. This is the "gentle" mode: you have to clear the cell first.
         The aggressive alternative (delete row on any Backspace at start of
         cell) is too easy to trigger accidentally and would lose data. */
      var sel = window.getSelection();
      var anchor = sel.anchorNode;
      var cell = _wfFindAncestor(anchor, 'TD') || _wfFindAncestor(anchor, 'TH');
      if (cell) {
        /* "Empty" = no visible content. textContent.trim() === '' covers text;
           we also reject cells that contain images or any non-empty children. */
        var hasMedia = cell.querySelector('img, video, .wf-time-chip, table');
        var isEmpty = !hasMedia && (cell.textContent || '').trim() === '';
        if (isEmpty) {
          e.preventDefault();
          var row = cell.parentNode;  /* TR */
          var table = _wfFindAncestor(row, 'TABLE');
          var nextFocus = null;
          /* Find where to put the caret after deletion: prefer the cell in the
             same column of the next row, then the previous row, then the
             element after the table (if we're deleting the whole table). */
          var rowIdx = Array.prototype.indexOf.call(table ? table.querySelectorAll('tr') : [], row);
          var cellIdx = Array.prototype.indexOf.call(row.children, cell);
          if (table) {
            var allRows = table.querySelectorAll('tr');
            if (allRows.length > 1) {
              /* Pick the row that will replace this one in screen position */
              var targetRow = allRows[rowIdx + 1] || allRows[rowIdx - 1];
              if (targetRow && targetRow.children[cellIdx]) {
                nextFocus = targetRow.children[cellIdx];
              } else if (targetRow) {
                nextFocus = targetRow.firstElementChild;
              }
              row.parentNode.removeChild(row);
            } else {
              /* Last row — drop the whole table. Caret goes to the element
                 after the table, or before it if there's nothing after. */
              nextFocus = table.nextElementSibling || table.previousElementSibling || el;
              table.parentNode.removeChild(table);
            }
          }
          if (nextFocus) _wfMoveCaretInto(nextFocus);
          markDirty();
          return;
        }
        /* Cell has content — fall through to default Backspace */
      }
    }

    if (e.key === 'Tab') {
      var sel = window.getSelection();
      var anchor = sel.anchorNode;
      var cell = _wfFindAncestor(anchor, 'TD') || _wfFindAncestor(anchor, 'TH');

      if (cell) {
        e.preventDefault();
        if (e.shiftKey) {
          /* Previous cell: previousElementSibling, else last cell of previous row */
          var prev = cell.previousElementSibling;
          if (!prev) {
            var prevRow = cell.parentNode.previousElementSibling;
            if (prevRow) prev = prevRow.lastElementChild;
          }
          if (prev) _wfMoveCaretInto(prev);
        } else {
          /* Next cell: nextElementSibling, else first cell of next row, else
             add a new row at the bottom. */
          var next = cell.nextElementSibling;
          if (!next) {
            var nextRow = cell.parentNode.nextElementSibling;
            if (nextRow) {
              next = nextRow.firstElementChild;
            } else {
              /* End of table — add a new row with the same number of cells */
              var row = cell.parentNode;
              var newRow = document.createElement('tr');
              for (var i = 0; i < row.children.length; i++) {
                newRow.appendChild(document.createElement('td'));
              }
              row.parentNode.appendChild(newRow);
              next = newRow.firstElementChild;
            }
          }
          if (next) _wfMoveCaretInto(next);
        }
        markDirty();
        return;
      }

      /* Not in a table — Tab inserts a 2x2 table at the caret. */
      e.preventDefault();
      var html = '<table><tbody>' +
                 '<tr><td><br></td><td><br></td></tr>' +
                 '<tr><td><br></td><td><br></td></tr>' +
                 '</tbody></table><p><br></p>';
      _wfInsertHtmlAtCaret(html);
      /* Try to place caret in the first cell of the just-inserted table. */
      setTimeout(function() {
        var tables = el.querySelectorAll('table');
        if (tables.length) {
          var firstCell = tables[tables.length - 1].querySelector('td');
          if (firstCell) _wfMoveCaretInto(firstCell);
        }
      }, 0);
      markDirty();
      return;
    }
  });

  /* ── Paste ── */
  el.addEventListener('paste', function(e) {
    var cd = e.clipboardData;
    if (!cd) return;
    /* 1. Image in clipboard → upload */
    if (cd.files && cd.files.length) {
      for (var i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type && cd.files[i].type.startsWith('image/')) {
          e.preventDefault();
          _wfInsertImageFile(cd.files[i]).then(function(ok) { if (ok) markDirty(); });
          return;
        }
      }
    }
    /* 2. HTML → server-side sanitization will clean it on save, but strip
       <script> client-side too so the editor itself doesn't execute anything
       weird while you're typing. Browsers usually do this for paste, but be
       explicit. */
    var html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      /* Drop script/style blocks before letting execCommand insert. */
      var clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                      .replace(/<style[\s\S]*?<\/style>/gi, '');
      _wfInsertHtmlAtCaret(clean);
      markDirty();
      return;
    }
    /* 3. Plain text → let browser handle it (it'll insert as text node, no
       formatting, which is what we want for plain). */
  });

  /* ── Drag & drop image ── */
  el.addEventListener('dragover', function(e) {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
      e.preventDefault();
    }
  });
  el.addEventListener('drop', function(e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    _wfInsertImageFile(f).then(function(ok) { if (ok) markDirty(); });
  });

  /* ── Input event for text typing → mark dirty ── */
  el.addEventListener('input', markDirty);

  /* ── Blur ── */
  if (opts.onBlur) el.addEventListener('blur', function() { opts.onBlur(el.innerHTML); });

  /* ── Public API exposed to caller ── */
  return {
    el: el,
    getHtml: function() { return el.innerHTML; },
    setHtml: function(html) { el.innerHTML = html || ''; dirty = false; },
    focus: function() { el.focus(); },
    clear: function() { el.innerHTML = ''; dirty = false; },
    isDirty: function() { return dirty; },
    markClean: function() { dirty = false; },
    /* Toolbar helpers — call these from buttons rendered alongside the editor */
    cmd: function(cmd, arg) {
      el.focus();
      document.execCommand(cmd, false, arg);
      markDirty();
    },
    insertTable: function() {
      el.focus();
      _wfInsertHtmlAtCaret('<table><tbody>' +
        '<tr><td><br></td><td><br></td></tr>' +
        '<tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
      markDirty();
    },
    insertImage: function() {
      /* Open a file picker */
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = function() {
        if (inp.files && inp.files[0]) {
          el.focus();
          _wfInsertImageFile(inp.files[0]).then(function(ok) { if (ok) markDirty(); });
        }
      };
      inp.click();
    },
    insertGel: function() {
      _wfOpenGelPicker({
        focus: function() { el.focus(); },
      });
    },
  };
};

/* ── Renderer for read-only display ───────────────────────────────────────── */

/* Sanitizer-lite for client-side render. The server already sanitised what's
   in storage; this is defense-in-depth and also catches anything that the
   server-side allowlist let through that we'd rather drop visually. Currently
   it just trusts the server — if you want stricter client filtering, add it
   here. We wrap in a div with .wf-rich-render so styles apply. */
window.wfRenderRich = function(html) {
  if (!html) return '';
  return '<div class="wf-rich-render">' + html + '</div>';
};

})();
