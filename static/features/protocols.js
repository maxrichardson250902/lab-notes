// ── PROTOCOLS ─────────────────────────────────────────────────────────────────
async function renderProtocols(el){
  const data=await api('GET','/api/protocols');
  S.protocols=data.protocols||[];
  let html='<div class="url-bar">'+
    '<input type="text" id="proto-url" placeholder="Paste a protocol URL (e.g. Thermo miniprep page)..." spellcheck="false"/>'+
    '<input type="text" id="proto-title" placeholder="Protocol name" style="width:200px" spellcheck="false"/>'+
    '<button class="btn primary" onclick="addProtocolFromUrl()">Fetch + Save</button>'+
    '</div>';
  if(!S.protocols.length){
    html+='<div class="empty"><big>&#128196;</big>No protocols yet — paste a URL above to add one.</div>';
  } else {
    html+='<div class="entries">'+S.protocols.map(protocolCardHTML).join('')+'</div>';
  }
  el.innerHTML=html;
}

function protocolCardHTML(p){
  const tags=JSON.parse(p.tags||'[]');
  return '<div class="protocol-card" id="pc-'+p.id+'" onclick="toggleProtocol('+p.id+')">'+
    '<div class="protocol-header">'+
      '<div style="flex:1">'+
        '<div class="protocol-title">'+esc(p.title)+'</div>'+
        (p.url?'<div class="protocol-url">'+esc(p.url)+'</div>':'')+
        (tags.length?'<div class="tags">'+tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')+
      '</div>'+
      '<div class="entry-actions">'+
        '<button class="btn" onclick="event.stopPropagation();reExtract('+p.id+')" title="Re-extract steps">&#8635;</button>'+
        (p.url?'<a class="btn" href="'+esc(p.url)+'" target="_blank" onclick="event.stopPropagation()">&#8599;</a>':'')+
        '<button class="btn" onclick="event.stopPropagation();deleteProtocol('+p.id+')" style="color:var(--red)">&#215;</button>'+
      '</div>'+
    '</div>'+
    '<div class="protocol-body" id="pb-'+p.id+'">'+
      (p.steps?'<div class="steps-text">'+esc(p.steps)+'</div>':
        '<div style="color:var(--muted);font-size:13px;font-style:italic">No steps extracted yet. Click &#8635; to extract.</div>')+
      '<div class="field" style="margin-top:12px">'+
        '<label>Your notes / modifications</label>'+
        '<textarea id="pn-'+p.id+'" placeholder="Your modifications, tips, observations...">'+esc(p.notes)+'</textarea>'+
      '</div>'+
      '<div class="save-row">'+
        '<button class="btn primary" onclick="event.stopPropagation();saveProtocol('+p.id+')">Save notes</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function toggleProtocol(id){document.getElementById('pc-'+id)?.classList.toggle('open');}

async function addProtocolFromUrl(){
  const url=document.getElementById('proto-url')?.value.trim();
  const title=document.getElementById('proto-title')?.value.trim();
  if(!url){toast('Paste a URL first',true);return;}
  if(!title){toast('Add a title',true);return;}
  const btn=document.querySelector('#content .btn.primary');
  btn.textContent='Fetching...';btn.disabled=true;
  try{
    await api('POST','/api/protocols',{title,url,tags:[]});
    document.getElementById('proto-url').value='';
    document.getElementById('proto-title').value='';
    await load();toast('Protocol saved');
  }catch(e){toast('Failed: '+e.message,true);}
  finally{btn.textContent='Fetch + Save';btn.disabled=false;}
}

async function reExtract(id){
  toast('Re-extracting steps...');
  await api('POST','/api/protocols/'+id+'/re-extract');
  await loadView();toast('Steps updated');
}

async function saveProtocol(id){
  const notes=document.getElementById('pn-'+id)?.value||'';
  await api('PUT','/api/protocols/'+id,{notes});
  toast('Saved');
}

async function deleteProtocol(id){
  if(!confirm('Delete this protocol?'))return;
  await api('DELETE','/api/protocols/'+id);
  await load();toast('Deleted');
}
registerView('protocols', renderProtocols);
