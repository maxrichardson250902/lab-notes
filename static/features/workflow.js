// ── DAILY WORKFLOW ───────────────────────────────────────────────────────────
let _workflowDate = new Date().toISOString().slice(0,10);

async function renderWorkflow(el){
  const data = await api('GET','/api/workflow/'+_workflowDate);
  const entries = data.entries || [];
  const today = new Date().toISOString().slice(0,10);

  let html = '<div class="day-nav">'+
    '<button onclick="shiftDay(-1)">&#8592; Prev</button>'+
    '<div class="day-label">'+formatDate(_workflowDate)+'</div>'+
    (_workflowDate<today?'<button onclick="shiftDay(1)">Next &#8594;</button>':'<button disabled style="opacity:.3">Next &#8594;</button>')+
    '<button class="btn" onclick="processWorkflowDay()" title="Send this day\'s notes to the 3090 to format into notebook entries" style="margin-left:10px">&#9881; Process day</button>'+
  '</div>';

  if(data.summary){
    html+='<div class="day-summary">'+esc(data.summary)+'</div>';
  }

  html+='<div class="timeline" id="workflow-timeline">';
  if(!entries.length){
    html+='<div style="padding:32px 0 32px 82px;color:var(--muted);font-size:14px;font-style:italic">No entries yet — jot notes below, they get processed into formatted notebook entries.</div>';
  } else {
    html+=entries.map(function(e){
      const isTask=e.type==='task_done';
      return '<div class="timeline-entry" id="we-'+e.id+'">'+
        '<div class="timeline-time">'+esc(e.time||'')+'</div>'+
        '<div class="timeline-dot '+(isTask?'task':'note')+'"></div>'+
        '<div class="timeline-body">'+
          '<div class="timeline-card '+(isTask?'task-card':'note-card')+'">'+
            (e.group_name?'<div class="timeline-card-group">'+esc(e.group_name)+'</div>':'')+
            '<div class="timeline-card-text" id="wt-'+e.id+'">'+esc(e.content)+'</div>'+
            '<div class="timeline-actions">'+
              '<button class="btn" onclick="editWorkflowEntry('+e.id+')">Edit</button>'+
              '<button class="btn" onclick="tagWorkflowEntry('+e.id+')" title="Set project group">Tag</button>'+
              '<button class="btn" style="color:var(--red)" onclick="deleteWorkflowEntry('+e.id+')">&#215;</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  html+='</div>';

  // Input area
  html+='<div style="margin-top:8px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px">'+
    '<div style="display:flex;gap:8px;margin-bottom:8px">'+
      '<input type="text" id="wf-group" placeholder="Project (optional)" spellcheck="false" style="width:140px;background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;border-radius:4px;outline:none"/>'+
    '</div>'+
    '<div class="add-inline" style="padding:0">'+
      '<input type="text" id="wf-input" placeholder="Jot down what you\'re doing..." spellcheck="false"/>'+
      '<button onclick="addWorkflowNote()">Add</button>'+
    '</div>'+
  '</div>';

  el.innerHTML=html;
  var wfInp=document.getElementById('wf-input');
  if(wfInp){
    wfInp.addEventListener('keydown',function(e){if(e.key==='Enter')addWorkflowNote();});
    setTimeout(function(){wfInp.focus();},50);
  }
}

function shiftDay(d){
  const dt=new Date(_workflowDate+'T12:00:00');
  dt.setDate(dt.getDate()+d);
  _workflowDate=dt.toISOString().slice(0,10);
  loadView();
}

async function addWorkflowNote(){
  const inp=document.getElementById('wf-input');
  const grpInp=document.getElementById('wf-group');
  const text=inp?.value.trim();
  if(!text)return;
  var group=grpInp?.value.trim()||null;
  await api('POST','/api/workflow',{content:text,type:'note',group_name:group});
  inp.value='';
  await loadView();
}

function tagWorkflowEntry(id){
  var group=prompt('Set project group for this entry (leave empty to clear):');
  if(group===null)return;
  api('PUT','/api/workflow/'+id,{group_name:group||null}).then(function(){loadView();toast('Tagged');});
}

async function processWorkflowDay(){
  if(!confirm('Send all notes for '+_workflowDate+' to the 3090 for formatting into notebook entries?'))return;
  toast('Processing — waking 3090...');
  try{
    var resp=await api('POST','/api/workflow/process-day',{date:_workflowDate});
    if(resp.error){toast(resp.error,true);return;}
    toast('Created '+resp.count+' notebook entries from workflow');
    await load();
  }catch(e){toast('Failed: '+e.message,true);}
}

function editWorkflowEntry(id){
  const el=document.getElementById('wt-'+id);
  if(!el)return;
  const current=el.textContent;
  el.innerHTML='<textarea id="we-ta-'+id+'" style="min-height:60px;width:100%;background:transparent;border:none;border-bottom:1px solid var(--accent);color:var(--text);font-family:var(--sans);font-size:14px;outline:none;resize:none;padding:2px 0">'+esc(current)+'</textarea>';
  const ta=el.querySelector('textarea');ta.focus();
  ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();saveWorkflowEntry(id,this.value);}if(e.key==='Escape')loadView();});
}

async function saveWorkflowEntry(id,content){
  await api('PUT','/api/workflow/'+id,{content});
  await loadView();toast('Saved');
}

async function deleteWorkflowEntry(id){
  await api('DELETE','/api/workflow/'+id);
  await loadView();
}
registerView('workflow', renderWorkflow);
