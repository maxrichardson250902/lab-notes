// ── Enrichment ───────────────────────────────────────────────────────────────
let _enrichPollTimer=null;

async function triggerEnrichment(){
  var btn=document.getElementById('enrich-btn');
  var icon=document.getElementById('enrich-icon');
  var label=document.getElementById('enrich-label');
  try{
    var resp=await fetch('/api/enrich',{method:'POST'});
    if(!resp.ok) throw new Error('Enrich endpoint not available');
    btn.style.borderColor='var(--amber)';
    btn.style.color='var(--amber)';
    icon.style.animation='spin .8s linear infinite';
    label.textContent='Running...';
    toast('3090 waking up — enrichment started');
    if(_enrichPollTimer) clearInterval(_enrichPollTimer);
    _enrichPollTimer=setInterval(async function(){
      try{
        var sr=await fetch('/api/enrich-status');
        if(!sr.ok)return;
        var s=await sr.json();
        var logs=s.recent_log||[];
        if(logs.length) label.textContent=logs[logs.length-1].replace(/^\[[\d:]+\] /,'').slice(0,25)+'...';
        if(!s.enrichment_running){
          clearInterval(_enrichPollTimer);
          _enrichPollTimer=null;
          btn.style.borderColor='var(--accent)';
          btn.style.color='var(--accent)';
          icon.style.animation='';
          icon.innerHTML='&#10003;';
          label.textContent='Done';
          toast('Enrichment complete');
          await load();
          setTimeout(function(){
            btn.style.borderColor='var(--border2)';
            btn.style.color='var(--muted)';
            icon.innerHTML='&#9881;';
            label.textContent='Enrich';
          },3000);
        }
      }catch(e){}
    },5000);
  }catch(e){
    toast('Could not start enrichment: '+e.message,true);
  }
}

// ── CSV ───────────────────────────────────────────────────────────────
boot();
