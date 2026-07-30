// ── NOTEBOOK ──────────────────────────────────────────────────────────────────
async function renderNotebook(el){
  /* Honour cross-view navigation from global search (Ctrl+K).
     A search-nav with entryId should: fetch the entry → switch into its book →
     scroll to it. We do this here so we have full control over the navigation
     before the dashboard render kicks in. */
  var navParams = (typeof consumeNavParams === 'function') ? consumeNavParams('notebook') : null;
  if (navParams && navParams.entryId) {
    try {
      var entry = await api('GET', '/api/entries/' + navParams.entryId);
      if (entry && entry.group_name) {
        S.nbBook = entry.group_name;
        /* Set both the book AND the page so the editor opens to this entry's date */
        S.nbPage = entry.date;
        S.filterGroup = entry.group_name;
        S._nbScrollToEntry = entry.id;
      }
    } catch (e) { /* fall through */ }
  }

  if(S.nbBook){
    await renderNotebookBook(el);
    return;
  }

  // Dashboard + books landing
  var todayData=null;
  try{todayData=await api('GET','/api/today');}catch{}

  var data=await api('GET','/api/entries?limit=500');
  S.entries=data.entries||[];

  var html='';
  var todayStr=new Date().toISOString().slice(0,10);

  // Dashboard cards
  if(todayData){
    var reminders=todayData.reminders||[];
    var todayEntries=todayData.entries_today||[];
    var workflow=todayData.workflow||[];
    var recent=todayData.recent_entries||[];

    html+='<div style="font-family:var(--serif);font-size:22px;font-weight:600;margin-bottom:4px">'+formatDate(todayStr)+'</div>';
    html+='<div style="font-family:var(--mono);font-size:12px;color:var(--muted);margin-bottom:18px">'+
      todayEntries.length+' entries today &middot; '+
      reminders.length+' reminder'+(reminders.length!==1?'s':'')+' &middot; '+
      (todayData.scratch_pending||0)+' scratch pending'+
      (todayData.predictions_pending?' &middot; <span style="color:var(--accent)">'+todayData.predictions_pending+' predictions</span>':'')+
    '</div>';

    html+='<div class="dash-grid">';

    // Reminders card
    html+='<div class="dash-card">';
    html+='<div class="dash-card-title">Reminders</div>';
    if(reminders.length){
      reminders.slice(0,6).forEach(function(r){
        var cls='future';
        if(r.due_date){
          if(r.due_date<todayStr) cls='overdue';
          else if(r.due_date===todayStr) cls='today';
        }
        html+='<div class="dash-reminder">'+
          '<span class="dash-reminder-dot '+cls+'"></span>'+
          '<div style="flex:1"><div>'+esc(r.text)+'</div>'+
          (r.due_date?'<div style="font-size:11px;color:var(--'+(cls==='overdue'?'red':cls==='today'?'accent':'muted')+');font-family:var(--mono)">'+esc(r.due_date)+'</div>':'')+
          '</div></div>';
      });
      if(reminders.length>6) html+='<div style="font-size:12px;color:var(--dim);padding:4px 0">+'+(reminders.length-6)+' more</div>';
    } else {
      html+='<div style="color:var(--dim);font-size:13px;font-style:italic;padding:8px 0">No active reminders</div>';
    }
    html+='</div>';

    // Today's work card
    html+='<div class="dash-card">';
    html+='<div class="dash-card-title">Today</div>';
    if(todayEntries.length){
      todayEntries.slice(0,5).forEach(function(e){
        html+='<div class="dash-entry-mini" data-group="'+esc(e.group_name)+'" data-date="'+esc(e.date)+'">'+
          '<div class="dash-entry-mini-title">'+esc(e.title)+'</div>'+
          '<div class="dash-entry-mini-meta">'+esc(e.group_name)+'</div>'+
        '</div>';
      });
    } else if(workflow.length){
      workflow.slice(0,5).forEach(function(w){
        html+='<div class="dash-wf-item"><span class="dash-wf-time">'+esc(w.time)+'</span><span>'+esc(w.content)+'</span></div>';
      });
    } else {
      html+='<div style="color:var(--dim);font-size:13px;font-style:italic;padding:8px 0">Nothing logged today yet</div>';
    }
    html+='</div>';

    // Recent entries card
    html+='<div class="dash-card" style="grid-column:1/-1">';
    html+='<div class="dash-card-title">Recent (7 days)</div>';
    if(recent.length){
      var byDateR={};
      recent.forEach(function(e){byDateR[e.date]=byDateR[e.date]||[];byDateR[e.date].push(e);});
      Object.entries(byDateR).forEach(function(pair){
        var dt=pair[0],entries=pair[1];
        html+='<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid var(--border)">';
        html+='<span style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:70px">'+esc(dt)+'</span>';
        html+='<span style="font-size:13px">'+entries.map(function(e){return esc(e.title);}).join(', ')+'</span>';
        html+='</div>';
      });
    } else {
      html+='<div style="color:var(--dim);font-size:13px;font-style:italic;padding:8px 0">No recent entries</div>';
    }
    html+='</div>';

    html+='</div>';
  }

  // Books section
  html+='<div class="section-label" style="margin-top:8px">Project books</div>';

  if(!S.entries.length){
    html+='<div class="empty"><big>&#128221;</big>No entries yet — import from OneNote, or add manually.</div>';
    el.innerHTML=html;return;
  }

  var projects={};
  S.entries.forEach(function(e){
    var g=e.group_name||'Ungrouped';
    if(!projects[g]) projects[g]={name:g,entries:[],dates:new Set()};
    projects[g].entries.push(e);
    projects[g].dates.add(e.date);
  });

  html+='<div class="nb-books">';
  Object.values(projects).sort(function(a,b){return b.entries.length-a.entries.length;}).forEach(function(proj){
    var dates=Array.from(proj.dates).sort();
    var firstDate=dates[0]||'';
    var lastDate=dates[dates.length-1]||'';
    html+='<div class="nb-book" data-group="'+esc(proj.name)+'">'+
      '<div class="nb-book-title">'+esc(proj.name)+'</div>'+
      '<div class="nb-book-meta">'+proj.entries.length+' entries &middot; '+dates.length+' days</div>'+
      '<div class="nb-book-dates">'+
        (firstDate?esc(firstDate)+' &#8594; '+esc(lastDate):'')+
      '</div>'+
    '</div>';
  });
  html+='</div>';
  el.innerHTML=html;

  setTimeout(function(){
    el.querySelectorAll('.nb-book').forEach(function(book){
      book.addEventListener('click',function(){
        var g=this.dataset.group;
        S.nbBook=g;S.nbPage=null;S.filterGroup=g;
        document.getElementById('page-title').textContent='Notebook — '+g;
        loadView();
      });
    });
    el.querySelectorAll('.dash-entry-mini').forEach(function(item){
      item.addEventListener('click',function(){
        var g=this.dataset.group;
        if(g){S.nbBook=g;S.nbPage=this.dataset.date;S.filterGroup=g;
          document.getElementById('page-title').textContent='Notebook — '+g;loadView();}
      });
    });
  },0);
}

async function renderNotebookBook(el){
  /* Notebook book view — reads from workflow blocks (verbatim), grouped by
     date. Not an editor; edits happen in the Workflow view. This replaces
     the previous LLM-summary-based view. Any legacy `entries` rows for this
     group are still in the DB but not shown here. */
  /* Reuse the workflow's block styling (data-groups colours, wf-time chips,
     task-done / protocol accents). No-op if already injected. */
  if (typeof _wfInjectDocStyles === 'function') _wfInjectDocStyles();
  /* Also load projects registry + inject per-project colour CSS so pills
     match Workflow view exactly. */
  if (typeof _wfLoadKnownProjects === 'function') { try { await _wfLoadKnownProjects(); } catch(e){} }

  var group = S.nbBook;
  var resp;
  try {
    resp = await api('GET', '/api/workflow/blocks-by-group?group=' + encodeURIComponent(group));
  } catch (e) {
    el.innerHTML = '<div style="padding:20px;color:var(--red)">Failed to load: ' + esc(e.message || String(e)) + '</div>';
    return;
  }
  var days = (resp && resp.days) || [];
  if (!S.nbPage && days.length) S.nbPage = days[0].date;

  var html = '<div class="nb-layout">';

  /* ── Sidebar: dates with block counts ──────────────────────────── */
  html += '<div class="nb-page-list">';
  html += '<div class="nb-page-list-hdr">' +
    '<button id="nb-back-btn" title="Back to projects">&#8592;</button>' +
    '<span class="nb-page-list-title">' + esc(group) + '</span>' +
    '<button class="nb-delete-btn" id="nb-del-book-btn" title="Delete legacy entries (workflow blocks unaffected)">DELETE</button>' +
  '</div>';
  if (!days.length) {
    html += '<div style="padding:20px 16px;color:var(--muted);font-size:13px;font-style:italic">No blocks tagged with this project yet.<br><br>Tag blocks in Workflow view by setting the active project, or click Groups on a specific block.</div>';
  } else {
    days.forEach(function(d) {
      var active = (S.nbPage === d.date);
      var count = d.blocks.length;
      var preview = _nbBlockPreview(d.blocks[0]) || '';
      html += '<div class="nb-page-item' + (active ? ' active' : '') + '" data-date="' + esc(d.date) + '">' +
        '<div class="nb-page-date">' + esc(d.date) + '</div>' +
        '<div class="nb-page-titles">' + esc(preview.slice(0, 80)) + '</div>' +
        '<div class="nb-page-count">' + count + ' block' + (count === 1 ? '' : 's') + '</div>' +
      '</div>';
    });
  }
  html += '</div>';

  /* ── Main pane: selected day's blocks ───────────────────────────── */
  html += '<div class="nb-editor">';
  var selectedDay = days.find(function(d) { return d.date === S.nbPage; });
  if (selectedDay) {
    var dt = new Date(selectedDay.date + 'T00:00:00');
    html += '<div class="nb-editor-date">' + dt.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'}) + '</div>';
    html += '<div class="nb-editor-weekday">' +
      dt.toLocaleDateString('en-GB', {weekday:'long'}) + ' &middot; ' +
      selectedDay.blocks.length + ' block' + (selectedDay.blocks.length === 1 ? '' : 's') + ' tagged with ' + esc(group) +
      ' &middot; <a href="#" class="nb-jump-workflow" data-date="' + esc(selectedDay.date) + '">edit in workflow &rarr;</a>' +
    '</div>';
    html += '<div class="nb-blocks wf-read-day-body">';
    selectedDay.blocks.forEach(function(b) {
      html += '<div class="nb-block-wrap">' + b + '</div>';
    });
    html += '</div>';
  } else if (days.length) {
    html += '<div class="nb-empty-page">Select a day from the sidebar.</div>';
  } else {
    html += '<div class="nb-empty-page">No tagged content yet for this project.</div>';
  }
  html += '</div>';
  html += '</div>';

  el.innerHTML = html;

  /* ── Wiring ─────────────────────────────────────────────────────── */
  setTimeout(function() {
    var backBtn = document.getElementById('nb-back-btn');
    if (backBtn) backBtn.addEventListener('click', function() {
      S.nbBook = null; S.nbPage = null; S.filterGroup = '';
      document.getElementById('page-title').textContent = 'Notebook';
      loadView();
    });

    var delBtn = document.getElementById('nb-del-book-btn');
    if (delBtn) delBtn.addEventListener('click', function() {
      /* This only removes LEGACY `entries` rows for this group (Process Day
         output). Workflow blocks are NOT touched — deletion of those happens
         in the workflow editor. */
      if (!confirm('Delete legacy LLM-summary entries for "' + group + '"?\n\nThis does NOT touch your workflow notes (which are the current source of truth). It only removes leftover entries from Process Day runs.')) return;
      api('DELETE', '/api/entries/group/' + encodeURIComponent(group)).then(function(r) {
        toast('Deleted ' + r.count + ' legacy entries. Workflow blocks unaffected.');
      }).catch(function(e) { toast('Failed: ' + e.message, true); });
    });

    el.querySelectorAll('.nb-page-item').forEach(function(item) {
      item.addEventListener('click', function() {
        S.nbPage = this.dataset.date;
        renderNotebookBook(el);
      });
    });

    /* Deep-link into workflow for editing */
    el.querySelectorAll('.nb-jump-workflow').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        var date = this.dataset.date;
        if (typeof _workflowDate !== 'undefined') _workflowDate = date;
        if (typeof setView === 'function') setView('workflow');
      });
    });
  }, 0);
}


function _nbBlockPreview(blockHtml) {
  /* Yank plain text out of a block for the sidebar preview. Naive strip-tags;
     good enough for a 1-line preview. */
  if (!blockHtml) return '';
  var tmp = document.createElement('div');
  tmp.innerHTML = blockHtml;
  return (tmp.textContent || '').trim().replace(/\s+/g, ' ');
}

async function loadEntryImages(entryId){
  try{
    var data=await api('GET','/api/entries/'+entryId+'/images');
    var container=document.getElementById('nb-imgs-'+entryId);
    if(!container)return;
    var imgs=data.images||[];
    if(!imgs.length){container.innerHTML='<span style="font-size:12px;color:var(--dim);font-style:italic">No images</span>';return;}
    container.innerHTML=imgs.map(function(img){
      return '<div style="position:relative;display:inline-block">'+
        '<img src="/api/entry-images/'+img.id+'/raw" style="max-width:200px;max-height:150px;border-radius:4px;border:1px solid var(--border);cursor:pointer" onclick="window.open(this.src)"/>'+
        '<button onclick="deleteEntryImage('+img.id+','+entryId+')" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:18px;height:18px;cursor:pointer;font-size:11px;line-height:18px;text-align:center">&times;</button>'+
      '</div>';
    }).join('');
  }catch{}
}

async function uploadEntryImage(entryId,file){
  var fd=new FormData();fd.append('file',file);
  try{
    await fetch('/api/entries/'+entryId+'/images',{method:'POST',body:fd});
    toast('Image uploaded');
    loadEntryImages(entryId);
  }catch(e){toast('Upload failed',true);}
}

async function deleteEntryImage(imageId,entryId){
  if(!confirm('Delete this image?'))return;
  await api('DELETE','/api/entry-images/'+imageId);
  loadEntryImages(entryId);
}

function toggleEntry(id){
  var card=document.getElementById('ec-'+id);
  if(card) card.classList.toggle('open');
}

async function saveEntry(id){
  var notes=document.getElementById('en-'+id)?.value||'';
  var results=document.getElementById('er-'+id)?.value||'';
  var yields=document.getElementById('ey-'+id)?.value||'';
  var issues=document.getElementById('ei-'+id)?.value||'';
  await api('PUT','/api/entries/'+id,{notes,results,yields,issues});
  toast('Saved');
}

async function saveEntryFull(id){
  var title=document.getElementById('nt-'+id)?.value||'';
  var date=document.getElementById('nd-'+id)?.value||'';
  var group=document.getElementById('ng-'+id)?.value||'';
  var sub=document.getElementById('ns-'+id)?.value||'';
  var notes=document.getElementById('en-'+id)?.value||'';
  var results=document.getElementById('er-'+id)?.value||'';
  var yields=document.getElementById('ey-'+id)?.value||'';
  var issues=document.getElementById('ei-'+id)?.value||'';
  await api('PUT','/api/entries/'+id,{title,date,group_name:group,subgroup:sub,notes,results,yields,issues});
  // If date or group changed, refresh the page list
  toast('Saved');
  await loadView();
}

async function summariseEntry(id){
  toast('Summarising...');
  var r=await api('POST','/api/entries/'+id+'/summarise');
  toast('Summary added');
  await loadView();
}

async function deleteEntry(id){
  if(!confirm('Delete this entry? This cannot be undone.'))return;
  await api('DELETE','/api/entries/'+id);
  toast('Entry deleted');
  await load();
  // If we're in a book, refresh book view
  if(S.nbBook) await renderNotebookBook(document.getElementById('content'));
}
registerView('notebook', renderNotebook);
