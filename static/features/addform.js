// ── ADD FORM ──────────────────────────────────────────────────────────────────
function _showAddForm(){
  if(S.view==='reminders'){showAddReminder();return;}
  if(S.view==='protocols'){addProtocolFromUrl();return;}
  // Show inline add at top of content
  const el=document.getElementById('content');
  const existing=document.getElementById('inline-add');
  if(existing){existing.remove();return;}
  const form=document.createElement('div');
  form.id='inline-add';form.className='add-form visible';
  form.innerHTML='<h3>New notebook entry</h3>'+
    '<div class="field-grid">'+
      '<div class="field full"><label>Title / Task</label><input type="text" id="na-title" placeholder="What did you do?" spellcheck="false"/></div>'+
      '<div class="field"><label>Project group</label><input type="text" id="na-group" placeholder="e.g. NorV" value="'+esc(S.nbBook||S.filterGroup)+'" spellcheck="false"/></div>'+
      '<div class="field"><label>Subgroup</label><input type="text" id="na-sub" placeholder="e.g. Experiments" spellcheck="false"/></div>'+
      '<div class="field full"><label>Notes</label><textarea id="na-notes" placeholder="What happened, observations..."></textarea></div>'+
      '<div class="field"><label>Results</label><textarea id="na-results" placeholder="Outcomes, data..." style="min-height:60px"></textarea></div>'+
      '<div class="field"><label>Yields / Purity</label><textarea id="na-yields" placeholder="e.g. 2.4 mg/mL" style="min-height:60px"></textarea></div>'+
      '<div class="field full"><label>Issues</label><textarea id="na-issues" placeholder="What went wrong..." style="min-height:60px"></textarea></div>'+
    '</div>'+
    '<div class="save-row">'+
      '<button class="btn" onclick="closeAddForm()">Cancel</button>'+
      '<button class="btn primary" onclick="submitNewEntry()">Save entry</button>'+
    '</div>';
  el.insertBefore(form, el.firstChild);
  document.getElementById('na-title')?.focus();
}

function closeAddForm(){document.getElementById('inline-add')?.remove();}
async function submitNewEntry(){
  const title=document.getElementById('na-title')?.value.trim();
  if(!title){toast('Add a title',true);return;}
  await api('POST','/api/entries',{
    title,
    group_name:document.getElementById('na-group')?.value.trim()||'',
    subgroup:document.getElementById('na-sub')?.value.trim()||'',
    notes:document.getElementById('na-notes')?.value||'',
    results:document.getElementById('na-results')?.value||'',
    yields:document.getElementById('na-yields')?.value||'',
    issues:document.getElementById('na-issues')?.value||'',
  });
  document.getElementById('inline-add')?.remove();
  await load();toast('Entry saved');
}

