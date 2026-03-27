// ── NOTEBOOK ──────────────────────────────────────────────────────────────────
async function renderNotebook(el){
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
  var data=await api('GET','/api/entries?group='+encodeURIComponent(S.nbBook)+'&limit=500');
  var entries=data.entries||[];

  var byDate={};
  entries.forEach(function(e){byDate[e.date]=byDate[e.date]||[];byDate[e.date].push(e);});
  var dates=Object.keys(byDate).sort().reverse();
  if(!S.nbPage&&dates.length) S.nbPage=dates[0];

  var html='<div class="nb-layout">';

  // Page list sidebar
  html+='<div class="nb-page-list">';
  html+='<div class="nb-page-list-hdr">'+
    '<button id="nb-back-btn">&#8592;</button>'+
    '<span class="nb-page-list-title">'+esc(S.nbBook)+'</span>'+
    '<button class="nb-delete-btn" id="nb-del-book-btn">DELETE</button>'+
  '</div>';

  dates.forEach(function(date){
    var dayEntries=byDate[date];
    var active=S.nbPage===date;
    var titles=dayEntries.map(function(e){return e.title;}).join(', ');
    html+='<div class="nb-page-item'+(active?' active':'')+'" data-date="'+esc(date)+'">'+
      '<div class="nb-page-date">'+esc(date)+'</div>'+
      '<div class="nb-page-titles">'+esc(titles)+'</div>'+
      '<div class="nb-page-count">'+dayEntries.length+' entr'+(dayEntries.length===1?'y':'ies')+'</div>'+
    '</div>';
  });

  if(!dates.length){
    html+='<div style="padding:20px 16px;color:var(--muted);font-size:13px;font-style:italic">No entries yet</div>';
  }
  html+='</div>';

  // Editor pane
  html+='<div class="nb-editor">';
  if(S.nbPage&&byDate[S.nbPage]){
    var pageEntries=byDate[S.nbPage];
    var dt=new Date(S.nbPage+'T00:00:00');
    html+='<div class="nb-editor-date">'+dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})+'</div>';
    html+='<div class="nb-editor-weekday">'+dt.toLocaleDateString('en-GB',{weekday:'long'})+' &middot; '+pageEntries.length+' entr'+(pageEntries.length===1?'y':'ies')+'</div>';

    pageEntries.forEach(function(e){
      html+='<div class="nb-entry" id="nbe-'+e.id+'">'+
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap">'+
          '<input type="text" id="nt-'+e.id+'" value="'+esc(e.title)+'" style="flex:1;min-width:200px;font-family:var(--serif);font-size:17px;font-weight:600;background:transparent;border:none;border-bottom:1px solid transparent;color:var(--text);padding:2px 0;outline:none" onfocus="this.style.borderBottomColor=\'var(--accent)\'" onblur="this.style.borderBottomColor=\'transparent\'"/>'+
          '<input type="date" id="nd-'+e.id+'" value="'+esc(e.date)+'" style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);font-family:var(--mono);font-size:11px;padding:4px 6px;border-radius:3px;outline:none;width:130px"/>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px">'+
          '<input type="text" id="ng-'+e.id+'" value="'+esc(e.group_name)+'" placeholder="group" style="background:var(--surface2);border:1px solid var(--border);color:var(--accent);font-family:var(--mono);font-size:11px;padding:3px 6px;border-radius:3px;outline:none;width:100px"/>'+
          '<span style="color:var(--dim)">/</span>'+
          '<input type="text" id="ns-'+e.id+'" value="'+esc(e.subgroup)+'" placeholder="subgroup" style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);font-family:var(--mono);font-size:11px;padding:3px 6px;border-radius:3px;outline:none;width:100px"/>'+
          (e.summary?'<span style="font-size:11px;color:var(--dim);font-style:italic;margin-left:auto;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(e.summary)+'</span>':'')+
        '</div>'+
        '<div class="nb-field-label">Notes</div>'+
        '<textarea class="big" id="en-'+e.id+'" placeholder="What was done, observations, details...">'+esc(e.notes)+'</textarea>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'+
          '<div>'+
            '<div class="nb-field-label">Results</div>'+
            '<textarea id="er-'+e.id+'" placeholder="Outcomes, data, measurements...">'+esc(e.results)+'</textarea>'+
          '</div>'+
          '<div>'+
            '<div class="nb-field-label">Yields / Purity</div>'+
            '<textarea id="ey-'+e.id+'" placeholder="e.g. 2.4 mg/mL, >95% pure...">'+esc(e.yields)+'</textarea>'+
          '</div>'+
        '</div>'+
        '<div class="nb-field-label">Issues / Troubleshooting</div>'+
        '<textarea id="ei-'+e.id+'" placeholder="What went wrong? What to try next...">'+esc(e.issues)+'</textarea>'+
        '<div class="nb-field-label">Images</div>'+
        '<div id="nb-imgs-'+e.id+'" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px"></div>'+
        '<div style="margin-bottom:8px">'+
          '<label class="btn" style="cursor:pointer;display:inline-block">'+
            '+ Add image <input type="file" accept="image/*" style="display:none" data-entry="'+e.id+'" id="nb-img-inp-'+e.id+'"/>'+
          '</label>'+
        '</div>'+
        '<div id="nb-gels-'+e.id+'" style="margin-bottom:8px"></div>'+
        '<div class="nb-entry-actions">'+
          '<button class="btn primary" onclick="saveEntryFull('+e.id+')">Save all</button>'+
          '<button class="btn" onclick="summariseEntry('+e.id+')">&#128161; Summarise</button>'+
          '<button class="btn" onclick="deleteEntry('+e.id+')" style="color:var(--red);margin-left:auto">Delete entry</button>'+
        '</div>'+
      '</div>';
    });
  } else {
    html+='<div class="nb-empty-page">Select a day from the page list, or create a new entry.</div>';
  }
  html+='</div>';
  html+='</div>';

  el.innerHTML=html;

  // Bind page list clicks and header buttons
  setTimeout(function(){
    var backBtn=document.getElementById('nb-back-btn');
    if(backBtn) backBtn.addEventListener('click',function(){
      S.nbBook=null;S.nbPage=null;S.filterGroup='';
      document.getElementById('page-title').textContent='Notebook';
      loadView();
    });
    var delBtn=document.getElementById('nb-del-book-btn');
    if(delBtn) delBtn.addEventListener('click',function(){
      var bookName=S.nbBook;
      if(!confirm('Delete the entire "'+bookName+'" book?\nThis will remove ALL entries in this project.'))return;
      if(!confirm('Are you sure? This cannot be undone.\n\nType confirms deletion of all entries in "'+bookName+'".'))return;
      api('DELETE','/api/entries/group/'+encodeURIComponent(bookName)).then(function(r){
        toast('Deleted "'+bookName+'" — '+r.count+' entries removed');
        S.nbBook=null;S.nbPage=null;S.filterGroup='';
        document.getElementById('page-title').textContent='Notebook';
        load();
      }).catch(function(e){toast('Failed: '+e.message,true);});
    });
    el.querySelectorAll('.nb-page-item').forEach(function(item){
      item.addEventListener('click',function(){
        S.nbPage=this.dataset.date;
        renderNotebookBook(el);
      });
    });
    // Load images for visible entries
    if(S.nbPage&&byDate[S.nbPage]){
      byDate[S.nbPage].forEach(function(e){
        loadEntryImages(e.id);
        if(typeof gelRenderLinkedGels==='function') gelRenderLinkedGels('nb-gels-'+e.id,e.id);
        var inp=document.getElementById('nb-img-inp-'+e.id);
        if(inp) inp.addEventListener('change',function(ev){
          if(ev.target.files[0]) uploadEntryImage(e.id,ev.target.files[0]);
        });
      });
    }
  },0);
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