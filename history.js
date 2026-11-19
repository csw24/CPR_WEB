(function(){
'use strict';
const $=id=>document.getElementById(id), selector=$('student'),names=JSON.parse(sessionStorage.getItem('xionParticipants')||'{}'),dateInput=$('recordDate'),save=$('saveRecord'),list=$('recordList'),status=$('historyMessage');
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};dateInput.value=today();
let source=null,active=null,records=[];const displayed={A:null,B:null};
const announce=t=>status.textContent=t;const currentName=()=>names[selector.value];const fmt=iso=>new Date(iso).toLocaleString('ko-KR');
const localDate=iso=>{const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
async function fetchRecords(){records=await window.XION.myRecords();await renderPending();}
function filtered(){return records.filter(r=>r.status==='claimed'&&r.recipientUid===window.XION.user?.uid&&r.source!=='demo'&&(!dateInput.value||localDate(r.createdAt)===dateInput.value));}
function restore(r){
 const role=selector.value;
 window.__xionInternalRestore=true;
 try{
   if(r.source==='ble_raw'){
     window.applyRawStudentPreview(role,r.data);
     const box=document.getElementById('xionRawSession');
     if(box){box.hidden=false;document.getElementById('xionRawSummary').textContent=`${r.nickname} · ${fmt(r.createdAt)} · RFID 실측 기반 시연 지표 (의료 평가 아님)`;document.getElementById('xionRawStudents').replaceChildren();document.getElementById('xionRawSwitches').textContent='';document.getElementById('xionRawPNG').disabled=true;document.getElementById('xionRawSaveBoth').disabled=true;}
   }else window.applyCPRResults({[role]:r.data});
 }finally{window.__xionInternalRestore=false;}
 source='history';active=r;displayed[role]=r;window.xionActiveRecord=r;save.disabled=true;
 announce(`${r.nickname}의 ${fmt(r.createdAt)} 기록을 불러왔습니다.`);showRecords();
}
function showRecords(){list.replaceChildren();const mine=filtered();if(!mine.length){list.textContent='해당 날짜의 수령 완료 기록이 없습니다.';return;}mine.forEach(r=>{const b=document.createElement('button');b.type='button';b.className='record-item'+(active?.id===r.id?' active':'');const t=document.createElement('span');t.textContent=fmt(r.createdAt);const tag=document.createElement('small');tag.textContent=r.source==='ble_raw'?'RFID 실측 기반 시연 지표':'ESP32 BLE 데이터';b.append(t,tag);b.onclick=()=>restore(r);list.append(b);});}
async function renderPending(){const target=$('pendingRecords');target.replaceChildren();const pending=records.filter(r=>r.status==='pending');if(!pending.length){target.textContent='수령 대기 중인 기록이 없습니다.';return;}for(const r of pending){const card=document.createElement('div');card.className='pending-card';const title=document.createElement('strong');title.textContent=`${r.nickname} · ${fmt(r.createdAt)} · ST2`;const desc=document.createElement('p');desc.textContent=`${r.source==='ble_raw'?'RFID 원시 측정':'BLE 결과'} — 본인의 교육 기록인가요?`;const yes=document.createElement('button'),no=document.createElement('button');yes.className='action-btn primary';no.className='action-btn secondary';yes.textContent='내 기록으로 가져오기';no.textContent='거절하기';for(const [b,decision] of [[yes,'claimed'],[no,'rejected']])b.onclick=async()=>{yes.disabled=no.disabled=true;try{await window.XION.decide(r.id,decision);await fetchRecords();showRecords();announce(decision==='claimed'?'내 기록으로 가져왔습니다.':'해당 기록을 거절했습니다.');}catch(e){announce('처리 실패: '+e.message);yes.disabled=no.disabled=false;}};card.append(title,desc,yes,no);target.append(card);}}
async function saveRecord(){if(source==='history'){announce('과거 기록은 중복 저장하지 않습니다.');return;}const role=selector.value,data=window.getCPRResults()[role];if(!data){announce('저장할 결과가 없습니다.');return;}save.disabled=true;try{const id=await window.XION.saveResult(role,data,'ble',names);active={id,nickname:currentName(),createdAt:new Date().toISOString(),data,source};displayed[role]=active;window.xionActiveRecord=active;await fetchRecords();showRecords();announce(role==='A'?'ST1 기록을 Firebase에 저장했습니다.':'ST2 기록을 수령 대기 상태로 Firebase에 저장했습니다.');}catch(e){announce('Firebase 저장 실패: '+e.message);}finally{save.disabled=false;}}
function selectHistory(){const r=filtered()[0];if(r)restore(r);else{active=null;window.xionActiveRecord=null;window.clearCPRResult(selector.value);source=null;save.disabled=true;showRecords();announce(`${currentName()}의 선택한 날짜 기록이 없습니다.`);}}
window.addEventListener('xionrawsaved',()=>fetchRecords().then(showRecords).catch(e=>announce('기록 갱신 실패: '+e.message)));$('showRecords').onclick=selectHistory;save.onclick=saveRecord;selector.addEventListener('change',selectHistory);dateInput.addEventListener('change',selectHistory);
const original=window.applyCPRResults;window.applyCPRResults=function(data){const result=original(data);if(!window.__xionInternalRestore){source='ble';active=null;displayed.A=displayed.B=null;window.xionActiveRecord=null;save.disabled=!window.getCPRResults()[selector.value];}return result;};
(async()=>{try{await window.XION.ready;if(!window.XION.user||!window.XION.profile||window.XION.user.uid!==names.ownerUid){location.replace('index.html');return;}await fetchRecords();showRecords();}catch(e){announce('기록 조회 실패: '+e.message);}})();
})();
