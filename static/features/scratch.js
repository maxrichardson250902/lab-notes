// ── SCRATCH PAD ───────────────────────────────────────────────────────────────
async function renderScratch(el){
  const data=await api('GET','/api/scratch');
  const entries=data.entries||[];

  let html='<div class="scratch-area">'+
    '<div class="section-label">Quick note</div>'+
    '<div class="scratch-quick">'+
      '<input type="text" id="sq-input" placeholder="Type and hit Enter - gets filed overnight" spellcheck="false"/>'+
      '<button onclick="addScratchQuick()">Dump it</button>'+
    '</div>'+
    '<div class="section-label" style="margin-top:14px">Brain dump</div>'+
    '<textarea class="scratch-big" id="sb-input" placeholder="Dump everything here — rough notes, observations, half-formed ideas. Hit Save and forget it. Gets sorted overnight."></textarea>'+
    '<div style="display:flex;justify-content:flex-end"><button class="btn primary" onclick="addScratchBig()">Save dump</button></div>'+
    '<div class="section-label" style="margin-top:14px">Drop a figure</div>'+
    '<div class="drop-zone" id="drop-zone" onclick="triggerFileInput()" ondrop="handleDrop(event)">'+
      '<input type="file" id="file-input" accept="image/*,.pdf" onchange="handleFileSelect(event)"/>'+
      '&#128247; Drop a gel, western blot, SEC trace, or any figure here<br>'+
      '<span style="font-size:12px;color:var(--dim)">Images get analysed by the 3090 overnight and filed to the right project</span>'+
    '</div>';

  if(entries.length){
    html+='<div class="section-label" style="margin-top:14px">Pending — awaiting overnight processing ('+entries.length+')</div>'+
      '<div class="scratch-list">'+
      entries.map(function(e){
        return '<div class="scratch-item '+(e.has_image?'has-image':'')+'">'+
          (e.has_image?'<img class="scratch-thumb" src="/api/scratch/'+e.id+'/image-raw" onerror="this.style.display=\'none\'" onclick="viewScratchImage('+e.id+')"/>':'')+
          '<div class="scratch-item-content">'+esc((e.content||e.filename||'image').slice(0,200))+'</div>'+
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">'+
            '<div class="scratch-item-time">'+relTime(e.created)+'</div>'+
            '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteScratch('+e.id+')">&#215;</button>'+
          '</div>'+
        '</div>';
      }).join('')+
      '</div>';
  } else {
    html+='<div style="margin-top:8px;color:var(--muted);font-size:13px;font-style:italic">&#10003; All clear — nothing waiting to be processed.</div>';
  }
  html+='</div>';
  el.innerHTML=html;
  setTimeout(function(){
    initDropZone();
    var sqInp=document.getElementById('sq-input');
    if(sqInp) sqInp.addEventListener('keydown',function(e){if(e.key==='Enter')addScratchQuick();});
  },50);
}

async function addScratchQuick(){
  const inp=document.getElementById('sq-input');
  const text=inp?.value.trim();if(!text)return;
  await api('POST','/api/scratch',{type:'text',content:text});
  inp.value='';await load();toast('Noted — will be filed overnight');
}

async function addScratchBig(){
  const ta=document.getElementById('sb-input');
  const text=ta?.value.trim();if(!text)return;
  await api('POST','/api/scratch',{type:'text',content:text});
  ta.value='';await load();toast('Saved — will be sorted overnight');
}

function viewScratchImage(id){
  const w=window.open('','_blank','width=800,height=600');
  w.document.write('<img src="/api/scratch/'+id+'/image-raw" style="max-width:100%;max-height:100vh"/>');
}
async function deleteScratch(id){
  await api('DELETE','/api/scratch/'+id);await load();
}

function triggerFileInput(){document.getElementById('file-input').click();}
function initDropZone(){
  const dz=document.getElementById('drop-zone');
  if(!dz)return;
  dz.addEventListener('dragover',function(e){e.preventDefault();dz.classList.add('dragover');});
  dz.addEventListener('dragleave',function(){dz.classList.remove('dragover');});
}
function handleDrop(e){
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('dragover');
  const file=e.dataTransfer.files[0];
  if(file)uploadScratchFile(file);
}
function handleFileSelect(e){
  const file=e.target.files[0];
  if(file)uploadScratchFile(file);
}

async function uploadScratchFile(file){
  const reader=new FileReader();
  reader.onload=async function(e){
    const b64=e.target.result.split(',')[1];
    await api('POST','/api/scratch',{
      type:'image',content:'',
      filename:file.name,
      image_data:b64
    });
    await load();toast('Figure saved — will be analysed overnight');
  };
  reader.readAsDataURL(file);
}
registerView('scratch', renderScratch);
