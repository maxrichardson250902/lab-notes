// ── PREDICTIONS ──────────────────────────────────────────────────────────────
let _predEditing={};  // {id: true}

async function renderPredictions(el){
  var data=await api('GET','/api/predictions');
  var preds=data.predictions||[];

  var html='<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">'+
    '<span style="font-size:13px;color:var(--muted)">'+(preds.length?preds.length+' pending prediction'+(preds.length>1?'s':''):'No pending predictions')+'</span>'+
    '<button class="btn" onclick="generatePredictions()" style="margin-left:auto">&#9733; Generate new predictions</button>'+
  '</div>';

  if(!preds.length){
    html+='<div class="empty"><big>&#9733;</big>No predicted tasks. Click the button above or use the Timeline view to generate predictions from your project history.</div>';
    el.innerHTML=html;
    return;
  }

  // Group by project
  var byGroup={};
  preds.forEach(function(p){
    byGroup[p.group_name]=byGroup[p.group_name]||[];
    byGroup[p.group_name].push(p);
  });

  Object.entries(byGroup).forEach(function(pair){
    var g=pair[0],items=pair[1];
    html+='<div class="section-label">'+esc(g)+'</div>';
    items.forEach(function(p){
      var isEditing=_predEditing[p.id];
      html+='<div class="pred-card" id="pred-'+p.id+'">'+
        '<div class="pred-group">'+esc(p.group_name)+'</div>';
      if(isEditing){
        html+='<input class="pred-edit-input" id="pred-edit-'+p.id+'" value="'+esc(p.text)+'"/>'+
          '<div class="pred-actions">'+
            '<button class="btn primary" onclick="predSaveEdit('+p.id+')">Save</button>'+
            '<button class="btn" onclick="predCancelEdit('+p.id+')">Cancel</button>'+
          '</div>';
      } else {
        html+='<div class="pred-text">'+esc(p.text)+'</div>'+
          (p.reasoning?'<div class="pred-reasoning">'+esc(p.reasoning)+'</div>':'')+
          '<div class="pred-actions">'+
            '<button class="btn primary" onclick="predApprove('+p.id+')">&#10003; Approve &amp; add to tasks</button>'+
            '<button class="btn" onclick="predEdit('+p.id+')">Edit</button>'+
            '<button class="btn" style="color:var(--red)" onclick="predReject('+p.id+')">&#215; Reject</button>'+
          '</div>';
      }
      html+='</div>';
    });
  });

  el.innerHTML=html;

  // Focus edit inputs
  setTimeout(function(){
    Object.keys(_predEditing).forEach(function(id){
      var inp=document.getElementById('pred-edit-'+id);
      if(inp){
        inp.focus();
        inp.addEventListener('keydown',function(e){
          if(e.key==='Enter') predSaveEdit(parseInt(id));
          if(e.key==='Escape') predCancelEdit(parseInt(id));
        });
      }
    });
  },50);
}

async function predApprove(id){
  try{
    var resp=await api('PUT','/api/predictions/'+id,{action:'approve'});
    if(resp.error){toast(resp.error,true);return;}
    toast('Approved — added to todo app');
    await load();
    await renderPredictions(document.getElementById('content'));
  }catch(e){toast('Failed: '+e.message,true);}
}

async function predReject(id){
  try{
    await api('PUT','/api/predictions/'+id,{action:'reject'});
    toast('Rejected');
    await load();
    await renderPredictions(document.getElementById('content'));
  }catch(e){toast('Failed: '+e.message,true);}
}

function predEdit(id){
  _predEditing[id]=true;
  renderPredictions(document.getElementById('content'));
}

function predCancelEdit(id){
  delete _predEditing[id];
  renderPredictions(document.getElementById('content'));
}

async function predSaveEdit(id){
  var inp=document.getElementById('pred-edit-'+id);
  var text=inp?inp.value.trim():'';
  if(!text){toast('Enter some text',true);return;}
  try{
    await api('PUT','/api/predictions/'+id,{action:'edit',text:text});
    delete _predEditing[id];
    await renderPredictions(document.getElementById('content'));
    toast('Saved');
  }catch(e){toast('Failed: '+e.message,true);}
}
registerView('predictions', renderPredictions);
