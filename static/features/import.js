// ── IMPORT ────────────────────────────────────────────────────────────────────
let _importPages=[];
let _importExpandedSet=new Set();
let _importBatchId='';

function renderImport(el){
  var html='<div class="import-dropzone" id="import-dz" onclick="document.getElementById(\'import-files\').click()">'+
    '<big>&#128229;</big>'+
    'Drop OneNote <b>.mht</b> exports or a <b>.zip</b> here<br>'+
    '<span style="font-size:12px;color:var(--dim)">Export: File &#8594; Export &#8594; Section/Notebook &#8594; Single File Web Page (.mht)</span>'+
    '<input type="file" id="import-files" multiple accept=".html,.htm,.mht,.mhtml,.zip"/>'+
  '</div>';

  if(_importPages.length){
    var entryCount=_importPages.filter(function(p){return p.content_type==='entry';}).length;
    var protoCount=_importPages.filter(function(p){return p.content_type==='protocol';}).length;
    var skipCount=_importPages.filter(function(p){return p.content_type==='skip';}).length;

    // Batch controls
    html+='<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:14px">'+
      '<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-family:var(--mono);margin-bottom:10px">Batch controls</div>'+
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
        '<span style="font-size:12px;color:var(--muted)">Set group for all:</span>'+
        '<input type="text" id="imp-batch-group" placeholder="e.g. NorV, Protein X..." spellcheck="false" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--sans);font-size:12px;padding:5px 10px;border-radius:4px;outline:none;width:180px"/>'+
        '<button class="btn" onclick="importBatchGroup()">Apply to all</button>'+
        '<span style="width:1px;height:20px;background:var(--border);margin:0 4px"></span>'+
        '<button class="btn" onclick="importSetAllType(\'entry\')">All &#8594; entries</button>'+
        '<button class="btn" onclick="importSetAllType(\'protocol\')">All &#8594; protocols</button>'+
        '<button class="btn" onclick="importSetAllType(\'skip\')">Skip all</button>'+
      '</div>'+
    '</div>';

    // Summary + import button
    html+='<div class="import-actions" style="margin-bottom:14px">'+
      '<span class="import-count"><b>'+_importPages.length+'</b> pages: <b>'+entryCount+'</b> entries, <b>'+protoCount+'</b> protocols, <b>'+skipCount+'</b> skipped</span>'+
      '<button class="btn primary" onclick="importCommit()" style="padding:8px 20px">Import '+Math.max(0,entryCount+protoCount)+' items</button>'+
    '</div>';

    // Pages list — card-style instead of cramped table
    html+='<div style="display:flex;flex-direction:column;gap:8px">';
    _importPages.forEach(function(p,i){
      var isSkip=p.content_type==='skip';
      var isExpanded=_importExpandedSet.has(i);
      var section=p.source?p.source.replace(/\\/g,'/').split('/').slice(0,-1).join('/'):p.filename||'';

      html+='<div class="'+(isSkip?'skip-row':'')+'" id="imp-row-'+i+'" style="background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;transition:opacity .15s;'+(isSkip?'opacity:.4':'')+'">'+
        // Header row
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer" data-idx="'+i+'" id="imp-hdr-'+i+'">'+
          '<span style="color:var(--dim);font-family:var(--mono);font-size:11px;min-width:24px">'+(i+1)+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-weight:500;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+esc(p.title)+'">'+esc(p.title)+'</div>'+
            '<div style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-top:2px">'+
              (section?esc(section)+' &middot; ':'')+
              (p.char_count||0)+' chars'+
              (p.image_count?' &middot; '+p.image_count+' img'+(p.image_count>1?'s':''):'')+
              (p.date&&p.date!==new Date().toISOString().slice(0,10)?' &middot; '+esc(p.date):'')+
            '</div>'+
          '</div>'+
          '<select class="import-type-sel" data-idx="'+i+'" id="imp-type-'+i+'" style="width:90px" onclick="event.stopPropagation()">'+
            '<option value="entry"'+(p.content_type==='entry'?' selected':'')+'>Entry</option>'+
            '<option value="protocol"'+(p.content_type==='protocol'?' selected':'')+'>Protocol</option>'+
            '<option value="skip"'+(p.content_type==='skip'?' selected':'')+'>Skip</option>'+
          '</select>'+
          '<input class="import-group-inp" type="text" data-idx="'+i+'" id="imp-group-'+i+'" value="'+esc(p.group_name)+'" placeholder="group..." spellcheck="false" style="width:120px" onclick="event.stopPropagation()"/>'+
          '<input class="import-date-inp" type="date" data-idx="'+i+'" id="imp-date-'+i+'" value="'+esc(p.date||'')+'" onclick="event.stopPropagation()"/>'+
          '<span style="font-size:10px;color:var(--dim)">'+(isExpanded?'&#9660;':'&#9654;')+'</span>'+
        '</div>';

      // Expandable preview
      if(isExpanded){
        html+='<div style="border-top:1px solid var(--border);padding:12px 14px 14px;background:var(--surface2)">'+
          '<pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--sans);font-size:13px;color:var(--text);line-height:1.6;max-height:400px;overflow-y:auto;margin:0">'+esc(p.notes||p.preview||'')+'</pre>'+
        '</div>';
      }
      html+='</div>';
    });
    html+='</div>';
  }

  el.innerHTML=html;

  // Bind events
  setTimeout(function(){
    var dz=document.getElementById('import-dz');
    var fi=document.getElementById('import-files');
    if(dz){
      dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('dragover');});
      dz.addEventListener('dragleave',function(){dz.classList.remove('dragover');});
      dz.addEventListener('drop',function(e){
        e.preventDefault();dz.classList.remove('dragover');
        if(e.dataTransfer.files.length) importUploadFiles(e.dataTransfer.files);
      });
    }
    if(fi){
      fi.addEventListener('change',function(e){
        if(e.target.files.length) importUploadFiles(e.target.files);
      });
    }
    // Bind per-row controls
    _importPages.forEach(function(p,i){
      var hdr=document.getElementById('imp-hdr-'+i);
      if(hdr) hdr.addEventListener('click',function(){
        if(_importExpandedSet.has(i)) _importExpandedSet.delete(i);
        else _importExpandedSet.add(i);
        renderImport(document.getElementById('content'));
      });
      var typeSel=document.getElementById('imp-type-'+i);
      if(typeSel) typeSel.addEventListener('change',function(){
        _importPages[i].content_type=this.value;
        renderImport(document.getElementById('content'));
      });
      var grpInp=document.getElementById('imp-group-'+i);
      if(grpInp) grpInp.addEventListener('input',function(){_importPages[i].group_name=this.value;});
      var dateInp=document.getElementById('imp-date-'+i);
      if(dateInp) dateInp.addEventListener('change',function(){_importPages[i].date=this.value;});
    });
    // Batch group enter key
    var batchInp=document.getElementById('imp-batch-group');
    if(batchInp) batchInp.addEventListener('keydown',function(e){if(e.key==='Enter')importBatchGroup();});
  },50);
}

async function importUploadFiles(fileList){
  var fd=new FormData();
  for(var i=0;i<fileList.length;i++){
    fd.append('files',fileList[i]);
  }
  var dz=document.getElementById('import-dz');
  if(dz){dz.innerHTML='<big>&#9881;</big>Parsing '+fileList.length+' file'+(fileList.length>1?'s':'')+'...';}
  try{
    var resp=await fetch('/api/import/parse',{method:'POST',body:fd});
    if(!resp.ok) throw new Error(await resp.text());
    var data=await resp.json();
    _importPages=data.pages||[];
    _importBatchId=data.batch_id||'';
    toast('Parsed '+_importPages.length+' pages');
    renderImport(document.getElementById('content'));
  }catch(e){
    toast('Parse failed: '+e.message,true);
    if(dz) dz.innerHTML='<big>&#128229;</big>Error — try again';
  }
}

function importSetAllType(type){
  _importPages.forEach(function(p){p.content_type=type;});
  renderImport(document.getElementById('content'));
}

function importBatchGroup(){
  var inp=document.getElementById('imp-batch-group');
  var val=inp?inp.value.trim():'';
  if(!val){toast('Enter a group name first',true);return;}
  _importPages.forEach(function(p){if(p.content_type!=='skip')p.group_name=val;});
  renderImport(document.getElementById('content'));
  toast('Set group "'+val+'" on all items');
}

async function importCommit(){
  // Read current values from the DOM
  var items=_importPages.map(function(p,i){
    return {
      title:p.title,
      content_type:document.getElementById('imp-type-'+i)?.value||p.content_type,
      group_name:document.getElementById('imp-group-'+i)?.value||p.group_name||'',
      subgroup:'Notes',
      date:document.getElementById('imp-date-'+i)?.value||p.date||'',
      notes:p.notes||'',
      results:p.results||'',
      issues:p.issues||'',
      steps:p.steps||'',
    };
  });
  var toImport=items.filter(function(i){return i.content_type!=='skip';});
  if(!toImport.length){toast('Nothing selected to import',true);return;}
  if(!confirm('Import '+toImport.length+' item'+(toImport.length>1?'s':'')+'?'))return;
  try{
    var resp=await api('POST','/api/import/commit',{items:items,batch_id:_importBatchId});
    var imgMsg=resp.created_images?' + '+resp.created_images+' images':'';
    toast('Imported: '+resp.created_entries+' entries, '+resp.created_protocols+' protocols'+imgMsg);
    _importPages=[];_importBatchId='';
    await load();
    renderImport(document.getElementById('content'));
  }catch(e){
    toast('Import failed: '+e.message,true);
  }
}
registerView('import', renderImport);
