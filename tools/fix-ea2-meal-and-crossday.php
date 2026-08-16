<?php
/**
 * 修复 EA2 编辑器插件 4 个问题:
 * 1. 饭空检测UI：结束时间靠近/在午饭时间时显示"保存并配置午饭休息"、"不保存配置午饭休息"
 * 2. 修复 wizNextSubject 递归调用 wizEndDay 时重复保存场次
 * 3. 轻编辑器保存（前端修复）
 * 4. 实例编辑器保存路径（前端修复）
 */
require_once __DIR__ . '/../lib/bootstrap.php';

$p = DB::one("SELECT id, editor_js FROM editor_plugins WHERE plugin_key = 'ea2_exam_editor'");
if (!$p) { echo "ERROR: 未找到编辑器插件\n"; exit(1); }

$js = $p['editor_js'];
$changes = 0;

// ===== 修复1: 添加 calcCurrentMeal 函数，检测当前科目结束时间是否靠近饭空 =====
// 在 calcProjectedMeal 后面添加
$oldAfterMeal = <<<'JS'
  if(t>=960&&t<1140)return{type:'dinner',time:nextStart,label:'晚饭休息',resume:'19:00',range:'16:00-19:00'};
  return null;
}
JS;

$newAfterMeal = <<<'JS'
  if(t>=960&&t<1140)return{type:'dinner',time:nextStart,label:'晚饭休息',resume:'19:00',range:'16:00-19:00'};
  return null;
}

// 检测当前科目结束时间是否横跨或靠近饭空时间
function calcCurrentMeal(){
  if(wizard.step!=='subject'||wizard.editIdx>=0)return null;
  if(!wizard.dayDate||!wizard.startTime)return null;
  var durEl=document.getElementById('wizDuration'),brkEl=document.getElementById('wizBreak');
  var dur=durEl?parseInt(durEl.value)||SUBJECT_PRESETS[wizard.currentSubject]||60:60;
  var curStart;
  if(wizard.subjects.length>0){
    var last=wizard.subjects[wizard.subjects.length-1];
    var lastEnd=new Date(last.end);
    curStart=new Date(lastEnd.getTime()+(last.break||0)*60000);
  }else{
    curStart=new Date(wizard.dayDate+'T'+wizard.startTime);
  }
  var curEnd=new Date(curStart.getTime()+dur*60000);
  var endMin=curEnd.getHours()*60+curEnd.getMinutes();
  // 横跨午饭时间 (11:50-13:00): 结束时间在11:50后 且 开始时间在13:00前
  var startMin=curStart.getHours()*60+curStart.getMinutes();
  if(startMin<780&&endMin>710&&!wizard.lunchSkipped){
    return{type:'lunch',spans:true,label:'午饭休息',range:'11:50-13:00'};
  }
  // 结束时间临近午饭开始 (≤30分钟)
  if(endMin>=680&&endMin<=710&&!wizard.lunchSkipped){
    return{type:'lunch',spans:false,label:'午饭休息',range:'11:50-13:00',near:true};
  }
  // 横跨晚饭时间 (16:00-19:00)
  if(startMin<1140&&endMin>960){
    return{type:'dinner',spans:true,label:'晚饭休息',range:'16:00-19:00'};
  }
  // 结束时间临近晚饭开始 (≤30分钟)
  if(endMin>=930&&endMin<=960){
    return{type:'dinner',spans:false,label:'晚饭休息',range:'16:00-19:00',near:true};
  }
  return null;
}
JS;

if (strpos($js, $oldAfterMeal) !== false && strpos($js, 'calcCurrentMeal') === false) {
    $js = str_replace($oldAfterMeal, $newAfterMeal, $js);
    $changes++;
    echo "1. 已添加 calcCurrentMeal 函数\n";
}

// ===== 修复1b: 修改 renderWizard 中的 subject 部分，添加饭空检测按钮 =====
// 在 subject 步骤中，w.editIdx<0 时，根据 calcCurrentMeal 显示不同按钮
$oldSubjActions = <<<'JS'
    if(w.editIdx>=0){
      html+='<button class="ea2-btn primary" onclick="wizSaveEdit()">更新并顺延</button>'+
        '<button class="ea2-btn danger" onclick="wizDeleteSubject('+w.editIdx+')">删除此场次</button>'+
        '<button class="ea2-btn" onclick="wizCancelEdit()">取消编辑</button>';
    }else{
      if(meal){html+='<button class="ea2-btn" onclick="wizGoMeal(\''+meal.type+'\')">'+meal.label+'</button>'}
      html+='<button class="ea2-btn primary" onclick="wizNextSubject()">当日下一场</button>'+
        '<button class="ea2-btn" onclick="wizEndDay()">第'+w.day+'天结束</button>'+
        '<button class="ea2-btn primary" onclick="wizFinish()">录入完毕</button>';
    }
JS;

$newSubjActions = <<<'JS'
    if(w.editIdx>=0){
      html+='<button class="ea2-btn primary" onclick="wizSaveEdit()">更新并顺延</button>'+
        '<button class="ea2-btn danger" onclick="wizDeleteSubject('+w.editIdx+')">删除此场次</button>'+
        '<button class="ea2-btn" onclick="wizCancelEdit()">取消编辑</button>';
    }else{
      var curMeal=calcCurrentMeal();
      if(curMeal){
        var mealLabel=curMeal.label;
        if(curMeal.spans)html+='<div class="ea2-wizard-subtitle" style="color:var(--ea2-error)">当前考试已横跨'+mealLabel+'时段（'+curMeal.range+'）</div>';
        else if(curMeal.near)html+='<div class="ea2-wizard-subtitle" style="color:var(--ea2-warning)">当前考试结束时间临近'+mealLabel+'时段（'+curMeal.range+'）</div>';
        if(curMeal.spans){
          html+='<button class="ea2-btn" onclick="wizGoMeal(\''+curMeal.type+'\')">'+mealLabel+'</button>';
        }else{
          html+='<button class="ea2-btn primary" onclick="wizSaveAndGoMeal(\''+curMeal.type+'\')">保存并配置'+mealLabel+'</button>'+
            '<button class="ea2-btn" onclick="wizGoMeal(\''+curMeal.type+'\')">不保存配置'+mealLabel+'</button>';
        }
      }
      if(meal){html+='<button class="ea2-btn" onclick="wizGoMeal(\''+meal.type+'\')">'+meal.label+'</button>'}
      html+='<button class="ea2-btn primary" onclick="wizNextSubject()">当日下一场</button>'+
        '<button class="ea2-btn" onclick="wizEndDay()">第'+w.day+'天结束</button>'+
        '<button class="ea2-btn primary" onclick="wizFinish()">录入完毕</button>';
    }
JS;

if (strpos($js, $oldSubjActions) !== false) {
    $js = str_replace($oldSubjActions, $newSubjActions, $js);
    $changes++;
    echo "2. 已修改饭空检测按钮逻辑\n";
}

// ===== 修复1c: 添加 wizSaveAndGoMeal 函数 =====
$oldGoMeal = <<<'JS'
function wizGoMeal(type){wizard.step=type;renderAll()}
JS;

$newGoMeal = <<<'JS'
function wizGoMeal(type){wizard.step=type;renderAll()}

function wizSaveAndGoMeal(type){
  var subj=document.getElementById('wizSubject').value.trim();
  if(subj){wizNextSubject()}
  wizard.step=type;renderAll();
}
JS;

if (strpos($js, $oldGoMeal) !== false && strpos($js, 'wizSaveAndGoMeal') === false) {
    $js = str_replace($oldGoMeal, $newGoMeal, $js);
    $changes++;
    echo "3. 已添加 wizSaveAndGoMeal 函数\n";
}

// ===== 修复2: 修复 wizNextSubject 递归调用 wizEndDay 时重复保存场次 =====
$oldNextSubj = <<<'JS'
  wizard.subjects.push({name:subj,start:formatLocal(curStart),end:formatLocal(examEnd),duration:dur,break:brk,alertTime:5,materials:wizard.materials.slice()});
  var nextStart=new Date(examEnd.getTime()+brk*60000);
  if(nextStart>=dayEnd){wizEndDay();return}
  wizard.startTime=formatLocalTime(nextStart);
  wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];wizard.editIdx=-1;
  renderAll();
}
JS;

$newNextSubj = <<<'JS'
  wizard.subjects.push({name:subj,start:formatLocal(curStart),end:formatLocal(examEnd),duration:dur,break:brk,alertTime:5,materials:wizard.materials.slice()});
  var nextStart=new Date(examEnd.getTime()+brk*60000);
  if(nextStart>=dayEnd){
    // 先清除表单防止 wizEndDay 递归调用 wizNextSubject 重复保存
    wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];wizard.editIdx=-1;
    wizEndDay();return;
  }
  wizard.startTime=formatLocalTime(nextStart);
  wizard.currentSubject='';wizard.currentDuration='';wizard.currentBreak=getMostUsedBreak();wizard.materials=[];wizard.editIdx=-1;
  renderAll();
}
JS;

if (strpos($js, $oldNextSubj) !== false) {
    $js = str_replace($oldNextSubj, $newNextSubj, $js);
    $changes++;
    echo "4. 已修复 wizNextSubject 递归保存问题\n";
}

// ===== 保存 =====
if ($changes > 0) {
    DB::update('editor_plugins', ['editor_js' => $js, 'updated_at' => date('Y-m-d H:i:s')], 'id = ?', [$p['id']]);
    echo "\n已保存，共 $changes 处修改\n";
    // 更新 ea2-js-now.txt
    file_put_contents(__DIR__ . '/ea2-js-now.txt', $js);
    echo "已更新 ea2-js-now.txt\n";
} else {
    echo "无修改\n";
}