// ── TIMELINE ──────────────────────────────────────────────────────────────────
let _tlExpanded={};  // {groupName: dateStr}

async function renderTimeline(el){
  var data=await api('GET','/api/timeline');
  var projects=data.projects||[];

  if(!projects.length){
    el.innerHTML='<div class="empty"><big>&#9683;</big>No projects with entries yet — import or create some notebook entries first.</div>';
    return;
  }

  var html='';
  projects.forEach(function(proj){
    var g=proj.group_name;
    var days=proj.days||[];
    var expandedDate=_tlExpanded[g]||null;

    html+='<div class="tl-project" id="tl-proj-'+esc(g)+'">';
    html+='<div class="tl-project-hdr">'+
      '<span class="tl-project-name">'+esc(g)+'</span>'+
      '<span class="tl-project-meta">'+proj.entry_count+' entries &middot; '+days.length+' days</span>'+
    '</div>';

    // SVG chain
    if(days.length>0){
      var svgNS='http://www.w3.org/2000/svg';
      var nodeW=90,nodeH=50,gap=16,pad=12;
      var svgW=pad*2+days.length*nodeW+(days.length-1)*gap;
      var svgH=pad*2+nodeH;

      html+='<div class="tl-chain-wrap"><svg width="'+svgW+'" height="'+svgH+'" viewBox="0 0 '+svgW+' '+svgH+'" style="min-width:'+svgW+'px">';

      // Edges
      for(var i=1;i<days.length;i++){
        var x1=pad+(i-1)*(nodeW+gap)+nodeW;
        var x2=pad+i*(nodeW+gap);
        var y=pad+nodeH/2;
        html+='<line class="tl-edge" x1="'+x1+'" y1="'+y+'" x2="'+x2+'" y2="'+y+'"/>';
      }

      // Nodes
      days.forEach(function(day,di){
        var x=pad+di*(nodeW+gap);
        var y=pad;
        var isExp=expandedDate===day.date;
        // Color intensity by entry count
        var opacity=Math.min(0.15+day.count*0.1,0.6);
        html+='<g class="tl-day-node'+(isExp?' expanded':'')+'" data-group="'+esc(g)+'" data-date="'+esc(day.date)+'" data-idx="'+di+'">';
        html+='<rect class="tl-day-rect" x="'+x+'" y="'+y+'" width="'+nodeW+'" height="'+nodeH+'" style="fill:rgba(61,107,79,'+opacity+')"/>';
        // Date label
        var dateShort=day.date.slice(5);  // MM-DD
        html+='<text x="'+(x+nodeW/2)+'" y="'+(y+20)+'" text-anchor="middle" fill="var(--text)" font-family="JetBrains Mono,monospace" font-size="11" pointer-events="none">'+dateShort+'</text>';
        // Count
        html+='<text x="'+(x+nodeW/2)+'" y="'+(y+36)+'" text-anchor="middle" fill="var(--muted)" font-family="JetBrains Mono,monospace" font-size="10" pointer-events="none">'+day.count+' entr'+(day.count===1?'y':'ies')+'</text>';
        html+='</g>';
      });

      html+='</svg></div>';
    }

    // Expanded day detail
    if(expandedDate){
      html+='<div class="tl-expanded" id="tl-detail-'+esc(g)+'">';
      html+='<div class="tl-expanded-date">'+formatDate(expandedDate)+'</div>';
      html+='<div id="tl-entries-'+esc(g)+'"><div class="spin" style="margin:10px auto;display:block;width:16px;height:16px"></div></div>';
      html+='</div>';
    }
    html+='</div>';
  });

  // Generate predictions button
  html+='<div style="margin-top:20px;text-align:center">'+
    '<button class="btn primary" onclick="generatePredictions()" style="padding:10px 24px">'+
      '&#9733; Predict next tasks from timelines'+
    '</button>'+
    '<div style="font-size:12px;color:var(--dim);margin-top:6px">Wakes the 3090, reads all project timelines, suggests upcoming tasks</div>'+
  '</div>';

  el.innerHTML=html;

  // Bind node clicks
  setTimeout(function(){
    el.querySelectorAll('.tl-day-node').forEach(function(node){
      node.addEventListener('click',function(){
        var grp=this.dataset.group;
        var date=this.dataset.date;
        if(_tlExpanded[grp]===date) delete _tlExpanded[grp];
        else _tlExpanded[grp]=date;
        renderTimeline(el);
      });
    });
    // Load expanded entry details
    projects.forEach(function(proj){
      var g=proj.group_name;
      if(_tlExpanded[g]) loadTimelineDetail(g,_tlExpanded[g]);
    });
  },50);
}

async function loadTimelineDetail(group,date){
  var container=document.getElementById('tl-entries-'+group);
  if(!container)return;
  try{
    var data=await api('GET','/api/timeline/'+encodeURIComponent(group));
    var dayData=(data.days||[]).find(function(d){return d.date===date;});
    if(!dayData||!dayData.entries.length){
      container.innerHTML='<div style="color:var(--dim);font-size:13px">No entries for this day.</div>';
      return;
    }
    container.innerHTML=dayData.entries.map(function(e){
      return '<div class="tl-expanded-entry">'+
        '<div class="tl-expanded-title">'+esc(e.title)+'</div>'+
        (e.notes?'<div class="tl-expanded-notes">'+esc(e.notes.slice(0,500))+(e.notes.length>500?'...':'')+'</div>':'')+
        (e.results?'<div style="font-size:12px;color:var(--accent);margin-top:4px"><b>Results:</b> '+esc(e.results.slice(0,200))+'</div>':'')+
        (e.issues?'<div style="font-size:12px;color:var(--red);margin-top:4px"><b>Issues:</b> '+esc(e.issues.slice(0,200))+'</div>':'')+
      '</div>';
    }).join('');
  }catch(e){
    container.innerHTML='<div style="color:var(--red)">Failed to load: '+esc(e.message)+'</div>';
  }
}

async function generatePredictions(){
  toast('Waking 3090 — generating predictions...');
  try{
    var resp=await api('POST','/api/predictions/generate');
    if(resp.error){toast(resp.error,true);return;}
    toast('Generated '+resp.count+' predictions');
    await load();
    setView('predictions');
  }catch(e){
    toast('Failed: '+e.message,true);
  }
}
registerView('timeline', renderTimeline);
