var examData={examName:'',message:'',examInfos:[]},selectedExamIdx=-1,dirty=false,validationErrors=[],validationWarnings=[];
var wizard={active:false,step:'date',day:1,dayDate:'',wizStart:'',currentSubject:'',currentDuration:'',currentBreak:'',materials:[],subjects:[],editIdx:-1};
var SUBJECT_PRESETS={语文:120,数学:120,英语:120,物理:90,化学:90,生物:90,历史:90,地理:90,政治:90,音乐:60,体育:60,美术:60,'通用技术':45,信息技术:45,劳动:45};
var BREAK_PRESETS=[10,15,20,30,40];

(function init(){
  if(window.CSEditor&&window.CSEditor.file&&window.CSEditor.file.content){try{var p=JSON.parse(window.CSEditor.file.content);if(p&&typeof p==='object'){examData.examName=p.examName||'';examData.message=p.message||'';examData.examInfos=Array.isArray(p.examInfos)?p.examInfos:[]}}catch(e){}}
  renderAll();runValidation();initSplitters();updateWizardBtn();
  setupRibbon();
})();

// Ribbon 工具栏的分组与工具在 manifest.json 的 ribbon 字段中声明（随插件配置透传给平台），
// 这里仅监听平台 Ribbon 按钮下发的命令并分派到编辑函数。
function setupRibbon(){
  window.addEventListener('message', function(e){
    if(!e.data||!e.data.__ceseCommand)return;
    switch(e.data.__ceseCommand){
      case 'ea2-add-exam': addExamInfo(); break;
      case 'ea2-wizard': startWizard(); break;
      case 'ea2-sort': sortExamInfosByTime(); break;
      case 'ea2-format': formatConfig(); break;
      case 'ea2-validate': runValidation(); break;
      case 'ea2-add-material': if(selectedExamIdx<0){alert('请先选择一个场次');}else{addMaterial();} break;
    }
  });
}

function renderAll(){
  document.getElementById('ea2ExamName').value=examData.examName;
  document.getElementById('ea2Message').value=examData.message;
  if(wizard.active)renderWizard();
  else{renderExamList();if(selectedExamIdx>=0&&selectedExamIdx<examData.examInfos.length)renderExamDetail(selectedExamIdx);else document.getElementById('ea2ExamDetail').innerHTML='<div class="ea2-empty-hint">选择左侧场次以查看详情</div>'}
  updateWizardBtn();
  if(wizard.active)renderExamList();
}

function updateWizardBtn(){
  var btn=document.getElementById('ea2WizardBtn'),add=document.getElementById('ea2AddBtn'),cascade=document.getElementById('ea2CascadeBtn');
  if(!wizard.active&&examData.examInfos.length===0){btn.style.display='block';add.style.display='';cascade.style.display='none'}
  else if(wizard.active){btn.style.display='none';add.style.display='none';cascade.style.display=wizard.subjects.length>0?'':'none'}
  else{btn.style.display='none';add.style.display='';cascade.style.display='none'}
}

function renderExamList(){
  var c=document.getElementById('ea2ExamList'),h=document.getElementById('ea2EmptyHint');c.innerHTML='';
  var list=examData.examInfos.slice();
  if(wizard.active){list=list.concat(wizard.subjects.map(function(s,i){return{name:s.name||'未命名',start:s.start,end:s.end,duration:s.duration,break:s.break,_wizIdx:i,_wizard:true}}))}
  if(list.length===0){h.style.display='block';updateWizardBtn();return}h.style.display='none';
  list.forEach(function(info,idx){
    var realIdx=info._wizard?-(info._wizIdx+1):idx;
    var s=info.start?new Date(info.start).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
    var e=info.end?new Date(info.end).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
    var d=document.createElement('div');
    d.className='ea2-exam-item'+(info._wizard?' wizard-item':'')+(selectedExamIdx===realIdx?' selected':'');
    d.innerHTML='<span class="ea2-exam-item-index">'+(info._wizard?'W'+(info._wizIdx+1):'#'+(idx+1))+'</span><span class="ea2-exam-item-name">'+escHtml(info.name||'未命名的场次')+'</span><span class="ea2-exam-item-time">'+s+' ~ '+e+'</span>'+(info._wizard?'':'<button class="ea2-exam-item-del" onclick="event.stopPropagation();removeExamInfo('+idx+')" title="删除">×</button>');
    d.onclick=function(){if(info._wizard){selectWizardSubject(info._wizIdx)}else{selectExam(idx)}};c.appendChild(d);
  });
  updateWizardBtn();
}

function selectExam(idx){selectedExamIdx=idx;renderExamList();renderExamDetail(idx)}
function selectWizardSubject(wizIdx){wizard.editIdx=wizIdx;var s=wizard.subjects[wizIdx];wizard.currentSubject=s.name;wizard.currentDuration=s.duration;wizard.currentBreak=s.break||0;wizard.materials=s.materials?JSON.parse(JSON.stringify(s.materials)):[];wizard.wizStart=s.start||'';wizard.step='subject';selectedExamIdx=-(wizIdx+1);renderAll()}

function renderExamDetail(idx){/* 省略，不变 */
  var info=examData.examInfos[idx];if(!info)return;
  document.getElementById('ea2DetailTitle').textContent='场次 #'+(idx+1)+' 详情';
  document.getElementById('ea2ExamDetail').innerHTML='<div class="ea2-detail-grid"><div class="ea2-field"><label>场次名称 <span class="required">*</span></label><input type="text" id="ea2DetailName" value="'+escAttr(info.name||'')+'" placeholder="例如：语文" oninput="onDetailFieldChange(\'name\',this.value)" /></div><div class="ea2-field"><label>开始时间 <span class="required">*</span></label><input type="datetime-local" id="ea2DetailStart" value="'+escAttr(info.start||'')+'" onchange="onDetailTimeChange()" /></div><div class="ea2-field"><label>结束时间 <span class="required">*</span></label><input type="datetime-local" id="ea2DetailEnd" value="'+escAttr(info.end||'')+'" onchange="onDetailTimeChange()" /></div><div class="ea2-field"><label>提前提醒（分钟）</label><input type="number" id="ea2DetailAlertTime" value="'+(info.alertTime||5)+'" min="0" oninput="onDetailFieldChange(\'alertTime\',parseInt(this.value)||0)" /></div></div><div class="ea2-materials"><div class="ea2-materials-title">材料清单 <button class="ea2-btn" onclick="addMaterial()">+ 添加</button></div><div class="ea2-materials-list" id="ea2MaterialsList">'+buildMaterialsHTML(info.materials||[])+'</div></div>';
}

function buildMaterialsHTML(mats){
  if(!mats||mats.length===0)return'<div class="ea2-empty-hint" style="padding:4px;font-size:9px">暂无材料</div>';
  return mats.map(function(m,mi){return'<div class="ea2-material-row"><div class="ea2-field"><input type="text" value="'+escAttr(m.name||'')+'" placeholder="材料名称" oninput="onMaterialChange('+mi+',\'name\',this.value)" /></div><div class="ea2-field"><input type="number" value="'+(m.quantity||0)+'" placeholder="数量" min="0" oninput="onMaterialChange('+mi+',\'quantity\',parseInt(this.value)||0)" /></div><div class="ea2-field"><input type="text" value="'+escAttr(m.unit||'')+'" placeholder="单位" oninput="onMaterialChange('+mi+',\'unit\',this.value)" /></div><button class="ea2-material-remove" onclick="removeMaterial('+mi+')" title="删除">×</button></div>'}).join('');
}

function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function onFieldChange(){examData.examName=document.getElementById('ea2ExamName').value;examData.message=document.getElementById('ea2Message').value;dirty=true;runValidation()}
function onDetailFieldChange(f,v){if(selectedExamIdx<0||!examData.examInfos[selectedExamIdx])return;examData.examInfos[selectedExamIdx][f]=v;dirty=true;runValidation()}
function onDetailTimeChange(){if(selectedExamIdx<0||!examData.examInfos[selectedExamIdx])return;examData.examInfos[selectedExamIdx].start=document.getElementById('ea2DetailStart').value;examData.examInfos[selectedExamIdx].end=document.getElementById('ea2DetailEnd').value;dirty=true;renderExamList();runValidation()}
function onMaterialChange(mi,f,v){if(selectedExamIdx<0||!examData.examInfos[selectedExamIdx])return;var m=examData.examInfos[selectedExamIdx].materials;if(!m)m=examData.examInfos[selectedExamIdx].materials=[];if(!m[mi])m[mi]={name:'',quantity:0,unit:''};m[mi][f]=v;dirty=true}
function addExamInfo(){examData.examInfos.push({name:'',start:'',end:'',alertTime:5,materials:[]});selectedExamIdx=examData.examInfos.length-1;renderAll();dirty=true;runValidation()}
function removeExamInfo(idx){examData.examInfos.splice(idx,1);if(selectedExamIdx>=examData.examInfos.length)selectedExamIdx=examData.examInfos.length-1;renderAll();dirty=true;runValidation()}
function addMaterial(){if(selectedExamIdx<0)return;if(!examData.examInfos[selectedExamIdx].materials)examData.examInfos[selectedExamIdx].materials=[];examData.examInfos[selectedExamIdx].materials.push({name:'',quantity:0,unit:''});renderExamDetail(selectedExamIdx);dirty=true}
function removeMaterial(mi){if(selectedExamIdx<0)return;examData.examInfos[selectedExamIdx].materials.splice(mi,1);renderExamDetail(selectedExamIdx);dirty=true}

// 将所有场次按开始时间升序排列
function sortExamInfosByTime(){
  if(!examData.examInfos||examData.examInfos.length===0)return;
  examData.examInfos.sort(function(a,b){return (new Date(a.start||0).getTime())-(new Date(b.start||0).getTime())});
  selectedExamIdx=0;
  renderAll();runValidation();dirty=true;
}

// ===== 向导 =====
function startWizard(){
  if(examData.examInfos.length>0){
    alert('创建向导需在没有场次时使用。当前已存在 '+examData.examInfos.length+' 个场次，请先清空现有场次，或直接使用「新建场次」。');
    return;
  }
  var defBrk=getMostUsedBreak();
  wizard={active:true,step:'date',day:1,dayDate:'',wizStart:'',currentSubject:'',currentDuration:'',currentBreak:defBrk,materials:[],subjects:[],editIdx:-1};
  selectedExamIdx=-1;renderAll();
}

function getMostUsedBreak(){
  var freq={};
  wizard.subjects.forEach(function(s){var b=s.break||0;freq[b]=(freq[b]||0)+1});
  examData.examInfos.forEach(function(s){var b=s.break||0;freq[b]=(freq[b]||0)+1});
  var best=0,max=0;for(var k in freq){if(freq[k]>max){max=freq[k];best=parseInt(k)}}return best;
}

function cancelWizard(){wizard.active=false;renderAll()}

function renderWizard(){
  document.getElementById('ea2DetailTitle').textContent='考试创建向导';
  var w=wizard,html='<div class="ea2-wizard"><h3>考试创建向导</h3>';
  if(w.step==='date'){
    html+='<div class="ea2-wizard-subtitle">第 '+w.day+' 天 — 选择日期'+(w.dayDate?'（已自动填充）':'')+'</div>';
    html+='<div class="ea2-wizard-step"><span class="ea2-wizard-step-icon">1</span>考试第 '+w.day+' 天日期</div>';
    html+='<div class="ea2-wizard-field"><label>请选择日期</label><input type="date" id="wizDate" value="'+(w.dayDate||'')+'" /></div>';
    html+='<div class="ea2-preset-breaks" style="margin-top:4px">';
    html+='<button class="ea2-preset-break" onclick="wizSetDatePreset(0)">今天</button>';
    html+='<button class="ea2-preset-break" onclick="wizSetDatePreset(1)">明天</button>';
    html+='<button class="ea2-preset-break" onclick="wizSetDatePreset(2)">后天</button>';
    html+='</div>';
    html+='<div class="ea2-wizard-actions"><button class="ea2-btn primary large" onclick="wizConfirmDate()">确认</button><button class="ea2-btn" onclick="cancelWizard()">取消</button></div>';
  }else{
    html+='<div class="ea2-wizard-subtitle">第 '+w.day+' 天 — '+(w.editIdx>=0?'编辑第 '+(w.editIdx+1)+' 场':'已添加 '+w.subjects.length+' 个科目')+'</div>';
    html+='<div class="ea2-wizard-step"><span class="ea2-wizard-step-icon">3</span>科目信息</div>';
    html+='<div class="ea2-wizard-field"><label>开始时间 <span style="color:var(--ea2-muted)">（默认 = 上一场结束 + 休息，可手动修改）</span></label><input type="datetime-local" id="wizStart" value="'+escAttr(w.wizStart||'')+'" oninput="if(window.wizard)window.wizard.wizStart=this.value" /></div>';
    html+='<div class="ea2-wizard-field"><label>科目名称</label><input type="text" id="wizSubject" value="'+escAttr(w.currentSubject)+'" placeholder="输入或点击下方预设" /></div>';
    html+='<div class="ea2-preset-grid">';
    for(var k in SUBJECT_PRESETS){html+='<button class="ea2-preset-chip'+(w.currentSubject===k?' selected':'')+'" onclick="wizSelectSubject(\''+k+'\')"><span class="preset-name">'+k+'</span><span class="preset-dur">'+SUBJECT_PRESETS[k]+'′</span></button>'}
    html+='</div>';
    html+='<div class="ea2-wizard-row">'+
      '<div class="ea2-wizard-field narrow"><label>考试时长（分钟）</label><input type="number" id="wizDuration" value="'+(w.currentDuration||'')+'" placeholder="'+(w.currentSubject&&SUBJECT_PRESETS[w.currentSubject]?SUBJECT_PRESETS[w.currentSubject]:'90')+'" min="1" oninput="wizOnFieldInput()" /></div>'+
      '<div class="ea2-wizard-field narrow"><label>休息时长（分钟）</label><input type="number" id="wizBreak" value="'+(w.currentBreak||'')+'" placeholder="0" min="0" oninput="wizOnFieldInput()" /></div>'+
    '</div>';
    html+='<div class="ea2-preset-breaks">';
    html+='<button class="ea2-preset-break clear'+(w.currentBreak===0?' selected':'')+'" onclick="wizSetBreak(0)">清空</button>';
    var customBrk=w.currentBreak&&BREAK_PRESETS.indexOf(w.currentBreak)<0&&w.currentBreak!==0?w.currentBreak:null;
    if(customBrk)html+='<button class="ea2-preset-break selected" onclick="wizSetBreak('+customBrk+')">'+customBrk+'′</button>';
    BREAK_PRESETS.forEach(function(b){html+='<button class="ea2-preset-break'+(b===w.currentBreak?' selected':'')+'" onclick="wizSetBreak('+b+')">'+b+'′</button>'});
    html+='</div>';
    html+='<div class="ea2-wizard-field"><label>材料</label><div class="ea2-tag-list" id="wizTagList">';
    w.materials.forEach(function(m,mi){html+='<span class="ea2-tag">'+escHtml(m.name)+' ×'+m.quantity+'<button class="ea2-tag-remove" onclick="wizRemoveTag('+mi+')">×</button></span>'});
    html+='<button class="ea2-tag-add" onclick="wizAddTag()">+ 添加</button></div></div>';
    html+='<div class="ea2-wizard-actions">';
    if(w.editIdx>=0){
      html+='<button class="ea2-btn primary" onclick="wizSaveEdit()">更新并顺延</button>'+
        '<button class="ea2-btn danger" onclick="wizDeleteSubject('+w.editIdx+')">删除此场次</button>'+
        '<button class="ea2-btn" onclick="wizCancelEdit()">取消编辑</button>';
    }else{
      html+='<button class="ea2-btn primary" onclick="wizNextSubject()">保存并录入下一场</button>'+
        '<button class="ea2-btn" onclick="wizEndDay()">第'+w.day+'天结束</button>'+
        '<button class="ea2-btn primary" onclick="wizFinish()">录入完毕</button>';
    }
    html+='<button class="ea2-btn" onclick="cancelWizard()">取消向导</button></div>';
  }
  html+='</div>';
  document.getElementById('ea2ExamDetail').innerHTML=html;
}

function wizSelectSubject(name){wizard.currentSubject=name;wizard.currentDuration=SUBJECT_PRESETS[name]||'';renderAll()}
function wizSetBreak(v){wizard.currentBreak=v;renderAll()}
function wizOnFieldInput(){
  var d=document.getElementById('wizDuration'),b=document.getElementById('wizBreak');
  if(d)wizard.currentDuration=parseInt(d.value)||'';
  if(b)wizard.currentBreak=parseInt(b.value)||0;
}

function wizSetDatePreset(offset){
  var d=new Date();d.setDate(d.getDate()+offset);
  var val=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  var el=document.getElementById('wizDate');if(el)el.value=val;
}

function wizConfirmDate(){
  var d=document.getElementById('wizDate').value;if(!d)return;
  wizard.dayDate=d;
  wizard.wizStart=d+'T08:00';
  wizard.step='subject';renderAll();
}

function wizNextSubject(){
  var stEl=document.getElementById('wizStart');if(stEl)wizard.wizStart=stEl.value;
  var startV=wizard.wizStart||'';
  var subj=document.getElementById('wizSubject').value.trim();
  var dur=parseInt(document.getElementById('wizDuration').value)||SUBJECT_PRESETS[wizard.currentSubject]||60;
  var brk=parseInt(document.getElementById('wizBreak').value)||0;
  if(!subj){alert('请输入科目名称');return}
  if(!startV){alert('请设置开始时间');return}
  var curStart=new Date(startV);
  if(isNaN(curStart.getTime())){alert('开始时间无效');return}
  var examEnd=new Date(curStart.getTime()+dur*60000);
  wizard.subjects.push({name:subj,start:formatLocal(curStart),end:formatLocal(examEnd),duration:dur,break:brk,alertTime:5,materials:wizard.materials.slice()});
  wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];wizard.editIdx=-1;
  // 下一场默认开始时间 = 当前场结束 + 休息，可手动更改
  wizard.wizStart=formatLocal(new Date(examEnd.getTime()+brk*60000));
  renderAll();
}

function cascadeFrom(fromIdx){
  for(var i=fromIdx;i<wizard.subjects.length;i++){
    var s=wizard.subjects[i];
    if(i===0){if(fromIdx===0){}}
    else{var prev=wizard.subjects[i-1];var prevEnd=new Date(prev.end);var newStart=new Date(prevEnd.getTime()+(prev.break||0)*60000);s.start=formatLocal(newStart)}
    var st=new Date(s.start);var et=new Date(st.getTime()+(s.duration||60)*60000);s.end=formatLocal(et);
  }
}

function wizCascadeAll(){if(wizard.subjects.length===0)return;cascadeFrom(0);renderAll()}

function wizSaveEdit(){
  if(wizard.editIdx<0)return;
  var stEl=document.getElementById('wizStart');if(stEl)wizard.wizStart=stEl.value;
  var startV=wizard.wizStart||'';
  var subj=document.getElementById('wizSubject').value.trim();
  var dur=parseInt(document.getElementById('wizDuration').value)||SUBJECT_PRESETS[wizard.currentSubject]||60;
  var brk=parseInt(document.getElementById('wizBreak').value)||0;
  if(!subj){alert('请输入科目名称');return}
  var s=wizard.subjects[wizard.editIdx];
  s.name=subj;s.duration=dur;s.break=brk;s.materials=wizard.materials.slice();
  if(startV){var cs=new Date(startV);if(!isNaN(cs.getTime())){s.start=formatLocal(cs);s.end=formatLocal(new Date(cs.getTime()+dur*60000))}}
  cascadeFrom(wizard.editIdx);
  wizard.editIdx=-1;wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];
  wizard.wizStart=formatLocal(new Date(new Date(s.end).getTime()+(brk||0)*60000));
  renderAll();
}

function wizDeleteSubject(idx){
  if(!confirm('确认删除第 '+(idx+1)+' 场？'))return;
  wizard.subjects.splice(idx,1);wizard.editIdx=-1;wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];
  if(wizard.subjects.length>0)cascadeFrom(0);
  renderAll();
}

function wizCancelEdit(){wizard.editIdx=-1;wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];renderAll()}

function wizEndDay(){
  var subj=document.getElementById('wizSubject'),stEl=document.getElementById('wizStart');
  if(stEl)wizard.wizStart=stEl.value;
  if(subj&&subj.value.trim()&&wizard.editIdx<0){wizNextSubject();return}
  wizard.day++;var d=new Date(wizard.dayDate+'T00:00:00');d.setDate(d.getDate()+1);
  wizard.dayDate=formatLocalDate(d);wizard.wizStart='';wizard.editIdx=-1;
  wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];
  wizard.step='date';renderAll();
}

function wizFinish(){
  var subj=document.getElementById('wizSubject');
  if(subj&&subj.value.trim()&&wizard.editIdx<0){wizNextSubject();return}
  if(wizard.subjects.length===0){alert('请至少添加一个科目');return}
  examData.examInfos=examData.examInfos.concat(wizard.subjects);
  wizard.active=false;selectedExamIdx=examData.examInfos.length-1;
  renderAll();dirty=true;runValidation();
}

function wizAddTag(){var name=prompt('材料名称：');if(!name||!name.trim())return;var qty=parseInt(prompt('数量：','1'))||1;wizard.materials.push({name:name.trim(),quantity:qty,unit:'份'});renderAll()}
function wizRemoveTag(mi){wizard.materials.splice(mi,1);renderAll()}

function formatLocal(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())}
function formatLocalTime(d){return pad(d.getHours())+':'+pad(d.getMinutes())}
function formatLocalDate(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function pad(n){return n<10?'0'+n:''+n}

// ===== 验证 =====
function runValidation(){
  validationErrors=[];validationWarnings=[];
  if(!examData.examName.trim())validationErrors.push({type:'error',message:'考试名称不能为空'});
  if(examData.examInfos.length===0)validationErrors.push({type:'error',message:'至少需要一场考试'});
  var ranges=[];
  examData.examInfos.forEach(function(info,idx){
    var b='场次 #'+(idx+1);
    if(!(info.name||'').trim())validationErrors.push({type:'error',message:b+'：名称不能为空'});
    if(!info.start)validationErrors.push({type:'error',message:b+'：开始时间不能为空'});
    if(!info.end)validationErrors.push({type:'error',message:b+'：结束时间不能为空'});
    var sm=info.start?new Date(info.start).getTime():NaN,em=info.end?new Date(info.end).getTime():NaN;
    if(info.start&&isNaN(sm))validationErrors.push({type:'error',message:b+'：开始时间格式无效'});
    if(info.end&&isNaN(em))validationErrors.push({type:'error',message:b+'：结束时间格式无效'});
    if(!isNaN(sm)&&!isNaN(em)){if(sm>=em)validationErrors.push({type:'error',message:b+'：开始时间必须早于结束时间'});else ranges.push({index:idx,startMs:sm,endMs:em});if(info.alertTime*60000>(em-sm))validationWarnings.push({type:'warning',message:b+'：提醒时间超过考试时长'})}
    if(typeof info.alertTime!=='number'||info.alertTime<0||isNaN(info.alertTime))validationErrors.push({type:'error',message:b+'：提醒时间必须是非负数'})
  });
  var sorted=ranges.slice().sort(function(a,b){return a.startMs-b.startMs});
  for(var i=0;i<sorted.length-1;i++){if(sorted[i].endMs>sorted[i+1].startMs)validationErrors.push({type:'error',message:'场次 #'+(sorted[i].index+1)+' 和 #'+(sorted[i+1].index+1)+' 时间重叠'})}
  renderIssues();
}

function renderIssues(){
  var all=validationErrors.concat(validationWarnings),count=all.length;
  document.getElementById('ea2IssueCount').textContent=count;
  var list=document.getElementById('ea2IssueList'),empty=document.getElementById('ea2IssueEmpty');list.innerHTML='';
  if(all.length===0){empty.style.display='block'}else{empty.style.display='none';all.forEach(function(issue){var d=document.createElement('div');d.className='ea2-issue-item '+(issue.type||'error');d.innerHTML='<span class="ea2-issue-icon">'+(issue.type==='warning'?'⚠':'✕')+'</span><span class="ea2-issue-msg">'+escHtml(issue.message)+'</span>';list.appendChild(d)})}
  var mlist=document.getElementById('ea2MobileIssueList'),mempty=document.getElementById('ea2MobileIssueEmpty');mlist.innerHTML='';
  document.getElementById('ea2MobileBottomLabel').textContent='问题 ('+count+')';
  if(all.length===0){mempty.style.display='block'}else{mempty.style.display='none';all.forEach(function(issue){var d=document.createElement('div');d.className='ea2-issue-item '+(issue.type||'error');d.innerHTML='<span class="ea2-issue-icon">'+(issue.type==='warning'?'⚠':'✕')+'</span><span class="ea2-issue-msg">'+escHtml(issue.message)+'</span>';mlist.appendChild(d)})}
}

function toggleIssues(){var b=document.getElementById('ea2RightBottom'),icon=document.getElementById('ea2ToggleIcon');b.classList.toggle('collapsed');icon.classList.toggle('open')}
function toggleMobileBottom(){var b=document.getElementById('ea2MobileBottomBody'),icon=document.getElementById('ea2MobileToggleIcon');if(b.style.display==='none'){b.style.display='block';icon.classList.add('open')}else{b.style.display='none';icon.classList.remove('open')}}

function initSplitters(){
  setupSplitter('ea2SplitterV','ea2Left','ea2Right','horizontal');
  setupSplitter('ea2SplitterH1','ea2LeftTop','ea2LeftBottom','vertical','ea2Left');
  var rb=document.getElementById('ea2RightBottom');rb.classList.add('collapsed');
  setupSplitter('ea2SplitterH2','ea2RightTop','ea2RightBottom','vertical','ea2Right');
}
function setupSplitter(sid,pid,nid,dir,cid){
  var s=document.getElementById(sid),p=document.getElementById(pid),n=document.getElementById(nid);
  if(!s||!p||!n)return;var sp,ss1,ss2,ct;
  s.addEventListener('mousedown',function(e){
    e.preventDefault();s.classList.add('active');
    if(dir==='horizontal'){sp=e.clientX;ss1=p.offsetWidth;ss2=n.offsetWidth}else{sp=e.clientY;ss1=p.offsetHeight;ss2=n.offsetHeight}
    if(cid)ct=document.getElementById(cid);
    document.body.style.cursor=s.style.cursor;document.body.style.userSelect='none';
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',mu);
  });
  function mv(e){
    if(dir==='horizontal'){var dx=e.clientX-sp;if(ss1+dx>=200&&ss2-dx>=100){p.style.width=(ss1+dx)+'px';p.style.flex='none'}}
    else{var dy=e.clientY-sp;if(ss1+dy>=40&&ss2-dy>=20){p.style.flex='0 0 '+(ss1+dy)+'px';n.style.flex='0 0 '+(ss2-dy)+'px'}}
  }
  function mu(){s.classList.remove('active');document.body.style.cursor='';document.body.style.userSelect='';document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',mu)}
}

function buildConfig(){return{examName:examData.examName,message:examData.message,examInfos:examData.examInfos}}
function saveConfig(){runValidation();if(validationErrors.length>0){if(!confirm('存在 '+validationErrors.length+' 个验证错误，仍要保存吗？\n\n'+validationErrors.slice(0,3).map(function(e){return e.message}).join('\n')))return}var json=JSON.stringify(buildConfig(),null,2);if(window.CSEditor){window.CSEditor.emitSave(json);dirty=false}}
function formatConfig(){try{var c=buildConfig();if(window.CSEditor&&window.CSEditor.file)window.CSEditor.file.content=JSON.stringify(c,null,2);examData=c;selectedExamIdx=-1;renderAll();runValidation()}catch(e){}}
document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveConfig()}if(e.shiftKey&&e.altKey&&e.key==='f'){e.preventDefault();formatConfig()}});
window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue=''}});