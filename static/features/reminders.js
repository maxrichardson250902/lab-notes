// ── REMINDERS ─────────────────────────────────────────────────────────────────
async function renderReminders(el){
  const data=await api('GET','/api/reminders?include_done=false');
  const reminders=data.reminders||[];
  const today=new Date().toISOString().slice(0,10);

  let html='<div id="add-reminder-form" style="display:none;background:var(--surface);border:1px solid var(--accent);border-radius:6px;padding:16px;margin-bottom:16px">'+
    '<div class="field-grid">'+
      '<div class="field full"><label>Reminder text</label><input type="text" id="rem-text" placeholder="What to remember..." spellcheck="false"/></div>'+
      '<div class="field"><label>Due date (optional)</label><input type="date" id="rem-date" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:4px;outline:none;font-family:var(--sans);font-size:13px"/></div>'+
    '</div>'+
    '<div class="save-row"><button class="btn" onclick="closeReminderForm()">Cancel</button><button class="btn primary" onclick="submitReminder()">Add reminder</button></div>'+
  '</div>';

  if(!reminders.length){
    html+='<div class="empty"><big>&#128276;</big>No reminders — they\'re added automatically when the 3090 processes your scratch pad overnight.</div>';
  } else {
    html+=reminders.map(function(r){
      const due=r.due_date;
      let dueClass='future',dueText='';
      if(due){
        if(due<today){dueClass='overdue';dueText='Overdue: '+due;}
        else if(due===today){dueClass='today';dueText='Due today';}
        else{dueClass='future';dueText='Due: '+due;}
      }
      return '<div class="reminder-item '+(r.done?'done-reminder':'')+'">'+
        '<div class="reminder-check" onclick="toggleReminder('+r.id+','+r.done+')">'+(r.done?'&#10003;':'')+'</div>'+
        '<div style="flex:1">'+
          '<div class="reminder-text">'+esc(r.text)+'</div>'+
          (dueText?'<div class="reminder-due '+dueClass+'">'+esc(dueText)+'</div>':'')+
          (r.source?'<div style="font-size:11px;color:var(--dim);font-family:var(--mono);margin-top:2px">from: '+esc(r.source)+'</div>':'')+
        '</div>'+
        '<button class="btn" style="color:var(--red);padding:2px 8px" onclick="deleteReminder('+r.id+')">&#215;</button>'+
      '</div>';
    }).join('');
  }
  el.innerHTML=html;
}

function closeReminderForm(){document.getElementById('add-reminder-form').style.display='none';}
function showAddReminder(){
  document.getElementById('add-reminder-form').style.display='block';
  document.getElementById('rem-text')?.focus();
}

async function submitReminder(){
  const text=document.getElementById('rem-text')?.value.trim();
  const date=document.getElementById('rem-date')?.value||null;
  if(!text){toast('Add some text',true);return;}
  await api('POST','/api/reminders',{text,due_date:date,source:'manual'});
  document.getElementById('add-reminder-form').style.display='none';
  document.getElementById('rem-text').value='';
  await load();toast('Reminder added');
}

async function toggleReminder(id,done){
  await api('PUT','/api/reminders/'+id,{done:!done});await load();
}
async function deleteReminder(id){
  if(!confirm('Delete this reminder?'))return;
  await api('DELETE','/api/reminders/'+id);await load();
}
registerView('reminders', renderReminders);
