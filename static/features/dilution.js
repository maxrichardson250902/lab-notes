// ── DILUTION CALCULATOR ──────────────────────────────────────────────────────
let _dilSeqRows=[{name:'',conc:'',vol:''}];
var _concUnits=['ng/\u00B5L','\u00B5g/\u00B5L','mg/mL','\u00B5g/mL','ng/mL','nM','\u00B5M','mM','M'];
var _volUnits=['\u00B5L','mL','L'];

function renderDilution(el){
  var concOpts=_concUnits.map(function(u){return '<option value="'+esc(u)+'">'+esc(u)+'</option>';}).join('');
  var volOpts=_volUnits.map(function(u){return '<option value="'+esc(u)+'">'+esc(u)+'</option>';}).join('');

  var html='<div class="dil-card">'+
    '<h3>C1V1 = C2V2</h3>'+
    '<div class="dil-formula">C&#8321; &times; V&#8321; = C&#8322; &times; V&#8322; &mdash; units must match</div>'+
    '<div class="dil-row">'+
      '<div class="dil-field"><label>C1 (stock)</label><input type="number" id="dil-c1" step="any" oninput="calcDilution()"/></div>'+
      '<div class="dil-field"><label>Unit</label><select id="dil-c-unit" onchange="calcDilution()">'+concOpts+'</select></div>'+
      '<div class="dil-field"><label>C2 (target)</label><input type="number" id="dil-c2" step="any" oninput="calcDilution()"/></div>'+
    '</div>'+
    '<div class="dil-row">'+
      '<div class="dil-field"><label>V2 (final vol)</label><input type="number" id="dil-v2" step="any" oninput="calcDilution()"/></div>'+
      '<div class="dil-field"><label>Unit</label><select id="dil-v-unit" onchange="calcDilution()">'+volOpts+'</select></div>'+
      '<div class="dil-field"><label>V1 (sample)</label><input type="text" id="dil-v1" readonly style="background:var(--tag-bg);font-weight:600;color:var(--accent);width:140px" value="\u2014"/></div>'+
      '<div class="dil-field"><label>Diluent</label><input type="text" id="dil-water" readonly style="background:var(--surface2);color:var(--muted);width:140px" value="\u2014"/></div>'+
    '</div>'+
  '</div>';

  // Sequencing prep — fixed ng/µL
  html+='<div class="dil-card">'+
    '<h3>Sequencing prep</h3>'+
    '<div style="font-size:12px;color:var(--muted);margin-bottom:12px">All concentrations in ng/\u00B5L, volumes in \u00B5L</div>'+
    '<div class="dil-row" style="margin-bottom:16px">'+
      '<div class="dil-field"><label>Target conc (ng/µL)</label><input type="number" id="seq-target-conc" step="any" value="100" oninput="calcSeqTable()"/></div>'+
      '<div class="dil-field"><label>Final vol (µL)</label><input type="number" id="seq-final-vol" step="any" value="15" oninput="calcSeqTable()"/></div>'+
    '</div>'+
    '<table class="dil-seq-table">'+
      '<thead><tr><th>Sample</th><th>Conc (ng/µL)</th><th>DNA (\u00B5L)</th><th>Water (\u00B5L)</th></tr></thead>'+
      '<tbody id="seq-tbody"></tbody>'+
    '</table>'+
    '<div style="margin-top:10px;display:flex;gap:8px">'+
      '<button class="btn" onclick="addSeqRow()">+ Add row</button>'+
      '<button class="btn" onclick="clearSeqTable()">Clear</button>'+
    '</div>'+
  '</div>';

  // Serial dilution with unit selector
  html+='<div class="dil-card">'+
    '<h3>Serial dilution</h3>'+
    '<div class="dil-row">'+
      '<div class="dil-field"><label>Stock conc</label><input type="number" id="ser-stock" step="any" oninput="calcSerial()"/></div>'+
      '<div class="dil-field"><label>Unit</label><select id="ser-unit" onchange="calcSerial()">'+concOpts+'</select></div>'+
      '<div class="dil-field"><label>Dilution factor</label><input type="number" id="ser-factor" step="any" value="10" oninput="calcSerial()"/></div>'+
      '<div class="dil-field"><label># steps</label><input type="number" id="ser-steps" value="5" min="1" max="12" oninput="calcSerial()"/></div>'+
      '<div class="dil-field"><label>Vol/tube</label><input type="number" id="ser-vol" step="any" value="100" oninput="calcSerial()"/></div>'+
      '<div class="dil-field"><label>Vol unit</label><select id="ser-vol-unit" onchange="calcSerial()">'+volOpts+'</select></div>'+
    '</div>'+
    '<div id="ser-result" style="margin-top:8px"></div>'+
  '</div>';

  el.innerHTML=html;
  setTimeout(function(){renderSeqRows();calcSeqTable();},0);
}

function calcDilution(){
  var c1=parseFloat(document.getElementById('dil-c1')?.value);
  var c2=parseFloat(document.getElementById('dil-c2')?.value);
  var v2=parseFloat(document.getElementById('dil-v2')?.value);
  var cUnit=document.getElementById('dil-c-unit')?.value||'';
  var vUnit=document.getElementById('dil-v-unit')?.value||'';
  var v1El=document.getElementById('dil-v1');
  var wEl=document.getElementById('dil-water');
  if(c1>0&&c2>0&&v2>0){
    var v1=(c2*v2)/c1;
    var water=v2-v1;
    v1El.value=v1.toFixed(2)+' '+vUnit;
    wEl.value=water>0?water.toFixed(2)+' '+vUnit:'\u2014';
    if(v1>v2){v1El.value='C1 too low!';v1El.style.color='var(--red)';wEl.value='\u2014';}
    else{v1El.style.color='var(--accent)';}
  } else {
    v1El.value='\u2014';wEl.value='\u2014';v1El.style.color='var(--accent)';
  }
}

function renderSeqRows(){
  var tbody=document.getElementById('seq-tbody');
  if(!tbody)return;
  tbody.innerHTML=_dilSeqRows.map(function(r,i){
    return '<tr>'+
      '<td><input type="text" id="seq-name-'+i+'" value="'+esc(r.name)+'" placeholder="Sample '+(i+1)+'" style="width:140px" oninput="_dilSeqRows['+i+'].name=this.value"/></td>'+
      '<td><input type="number" id="seq-conc-'+i+'" value="'+(r.conc||'')+'" step="any" placeholder="ng/&mu;L" oninput="_dilSeqRows['+i+'].conc=this.value;calcSeqTable()"/></td>'+
      '<td id="seq-dna-'+i+'" style="font-weight:500;color:var(--accent)">—</td>'+
      '<td id="seq-water-'+i+'" style="color:var(--muted)">—</td>'+
    '</tr>';
  }).join('');
}

function calcSeqTable(){
  var targetConc=parseFloat(document.getElementById('seq-target-conc')?.value)||100;
  var finalVol=parseFloat(document.getElementById('seq-final-vol')?.value)||15;
  _dilSeqRows.forEach(function(r,i){
    var conc=parseFloat(document.getElementById('seq-conc-'+i)?.value||r.conc);
    var dnaEl=document.getElementById('seq-dna-'+i);
    var waterEl=document.getElementById('seq-water-'+i);
    if(!dnaEl||!waterEl)return;
    if(conc>0&&targetConc>0&&finalVol>0){
      var dnaVol=(targetConc*finalVol)/conc;
      var water=finalVol-dnaVol;
      if(dnaVol>finalVol){
        dnaEl.textContent='too dilute';dnaEl.style.color='var(--red)';
        waterEl.textContent='—';
      } else {
        dnaEl.textContent=dnaVol.toFixed(2);dnaEl.style.color='var(--accent)';
        waterEl.textContent=water.toFixed(2);
      }
    } else {
      dnaEl.textContent='—';waterEl.textContent='—';
    }
  });
}

function addSeqRow(){
  _dilSeqRows.push({name:'',conc:'',vol:''});
  renderSeqRows();calcSeqTable();
  // Focus the new name input
  var inp=document.getElementById('seq-name-'+(_dilSeqRows.length-1));
  if(inp)inp.focus();
}

function clearSeqTable(){
  _dilSeqRows=[{name:'',conc:'',vol:''}];
  renderSeqRows();calcSeqTable();
}

function calcSerial(){
  var stock=parseFloat(document.getElementById('ser-stock')?.value);
  var factor=parseFloat(document.getElementById('ser-factor')?.value)||10;
  var steps=parseInt(document.getElementById('ser-steps')?.value)||5;
  var vol=parseFloat(document.getElementById('ser-vol')?.value)||100;
  var cUnit=document.getElementById('ser-unit')?.value||'';
  var vUnit=document.getElementById('ser-vol-unit')?.value||'\u00B5L';
  var el=document.getElementById('ser-result');
  if(!el||!stock||stock<=0){el.innerHTML='';return;}
  var transferVol=vol/factor;
  var diluent=vol-transferVol;
  var html='<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Transfer '+transferVol.toFixed(1)+' '+vUnit+' into '+diluent.toFixed(1)+' '+vUnit+' diluent per step</div>';
  html+='<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
  var conc=stock;
  for(var i=0;i<=steps;i++){
    var label=conc>=1?conc.toFixed(1):conc.toExponential(1);
    html+='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 12px;text-align:center;min-width:70px">'+
      '<div style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--text)">'+label+'</div>'+
      '<div style="font-size:10px;color:var(--dim)">'+esc(cUnit)+'</div>'+
    '</div>';
    if(i<steps) html+='<span style="color:var(--dim)">\u2192</span>';
    conc=conc/factor;
  }
  html+='</div>';
  el.innerHTML=html;
}
registerView('dilution', renderDilution);
