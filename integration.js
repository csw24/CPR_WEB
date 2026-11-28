// BLE UUID는 Final_Integrated_Sensor_Code_1114_BLE.ino와 일치합니다.
const bleConfig = {
  serviceUUID: 'f7e10001-6b39-4e2e-9c2a-11c0de000001',
  resultCharacteristicUUID: 'f7e10002-6b39-4e2e-9c2a-11c0de000001',
  requestCharacteristicUUID: 'f7e10003-6b39-4e2e-9c2a-11c0de000001'
};

const $ = id => document.getElementById(id);
const message = $('actionMessage');
const dialog = $('noticeDialog');
let bleDevice = null;
let bleServer = null;
let resultCharacteristic = null;
let requestCharacteristic = null;
let pendingReceive = null;
let receiveBuffer = '';
const decoder = new TextDecoder();

function report(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}
function showNotice(title, detail, allowConnect = true) {
  $('noticeTitle').textContent = title;
  $('noticeText').textContent = detail;
  $('noticeConnect').hidden = !allowConnect;
  if (!dialog.open) dialog.showModal();
}
$('noticeCancel').addEventListener('click', () => dialog.close());
$('noticeConnect').addEventListener('click', () => { dialog.close(); connectBLE(); });

function onDisconnected() {
  bleServer = null;
  resultCharacteristic = null;
  requestCharacteristic = null;
  if (pendingReceive) {
    pendingReceive.reject(new Error('ESP32 연결이 끊어졌습니다.'));
    pendingReceive = null;
  }
  report('ESP32 연결이 끊어졌습니다. 다시 연결해 주세요.', true);
}

async function connectBLE() {
  if (!navigator.bluetooth) {
    showNotice('BLE 미지원 환경', 'Android Chrome 또는 Windows Chrome/Edge에서 HTTPS로 배포된 웹사이트를 이용해 주세요.', false);
    return;
  }
  if (bleServer?.connected) {
    report('이미 ESP32에 연결되어 있습니다. 「교육 결과 불러오기」를 누르세요.');
    return;
  }
  try {
    // ESP32 펌웨어와 서비스 UUID가 일치해야 합니다.
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [bleConfig.serviceUUID] }]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(bleConfig.serviceUUID);
    const result = await service.getCharacteristic(bleConfig.resultCharacteristicUUID);
    const request = await service.getCharacteristic(bleConfig.requestCharacteristicUUID);
    await result.startNotifications();
    result.addEventListener('characteristicvaluechanged', onNotification);
    device.addEventListener('gattserverdisconnected', onDisconnected);
    bleDevice = device;
    bleServer = server;
    resultCharacteristic = result;
    requestCharacteristic = request;
    report('ESP32 연결 완료. 「교육 결과 불러오기」를 누르세요.');
  } catch (error) {
    report(`BLE 연결 실패: ${error.message}`, true);
  }
}
$('connectBle').addEventListener('click', connectBLE);

// ESP32 protocol: BEGIN:length -> UTF-8 JSON fragments -> END.
// This is a finished session summary, not a real-time stream.
let expectedLength = -1;
function onNotification(event) {
  if (!pendingReceive) return;
  const v=event.target.value;
  const chunk=decoder.decode(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));
  if (chunk.startsWith('BEGIN:')) {
    expectedLength=Number(chunk.slice(6)); receiveBuffer=''; return;
  }
  if (chunk==='END') {
    const pending=pendingReceive;pendingReceive=null;
    try {
      if(expectedLength<0) throw Error('BEGIN 신호를 받지 못했습니다.');
      if(receiveBuffer.length!==expectedLength) throw Error(`데이터 누락: ${receiveBuffer.length}/${expectedLength} bytes`);
      pending.resolve(JSON.parse(receiveBuffer));
    } catch(e){pending.reject(e);}
    finally{receiveBuffer='';expectedLength=-1;}
    return;
  }
  if(expectedLength<0)return;
  receiveBuffer+=chunk;
  if(receiveBuffer.length>100000){pendingReceive.reject(Error('데이터가 너무 큽니다.'));pendingReceive=null;receiveBuffer='';}
}

let latestRawSession=null;
const rawFmt=(v,d=1)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(d);
const rawEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function rawRows(stats){
  if(!stats)return '<p>해당 교육생의 데이터가 없습니다.</p>';
  const rows=[['RFID UID',stats.uid||'—'],['FSR 측정 샘플',stats.fsrSamples??0],['FSR1 평균',rawFmt(stats.fsr1MeanRaw,1)+' RAW'],['FSR2 평균',rawFmt(stats.fsr2MeanRaw,1)+' RAW'],['FSR1 최대',rawFmt(stats.fsr1PeakRaw,0)+' RAW'],['FSR2 최대',rawFmt(stats.fsr2PeakRaw,0)+' RAW'],['ToF 측정 샘플',stats.tofSamples??0],['ToF 평균 거리',rawFmt(Number(stats.tofMeanMm)/10,2)+' cm'],['ToF 최소 거리',stats.tofSamples?rawFmt(Number(stats.tofMinMm)/10,2)+' cm':'—'],['ToF 최대 거리',stats.tofSamples?rawFmt(Number(stats.tofMaxMm)/10,2)+' cm':'—']];
  return '<table class="xion-raw-table">'+rows.map(([k,v])=>`<tr><th>${rawEsc(k)}</th><td>${rawEsc(v)}</td></tr>`).join('')+'</table>';
}
function showSessionSummary(d){
  latestRawSession=d;window.xionRawSession=d;
  const host=$('xionRawSession');host.hidden=false;
  const participants=JSON.parse(sessionStorage.getItem('xionParticipants')||'{}');
  $('xionRawSummary').textContent=`교육 ${d.session??'—'}회차 · 교대 ${d.switchCount??0}회 · 평균 교대시간 ${rawFmt(Number(d.avgSwitchGapMs)/1000,2)}초 · 아래 기존 6개 평가 카드에 실제 압박 이벤트 지표를 표시합니다 (의료 평가 아님).`;
  $('xionRawStudents').replaceChildren();
  const gaps=Array.isArray(d.switchGapsMs)?d.switchGapsMs:[];
  $('xionRawSwitches').textContent=gaps.length?'교대 소요: '+gaps.map((ms,i)=>`${i+1}회 ${rawFmt(Number(ms)/1000,2)}초`).join(' · '):'2분 교대 기록 없음';
  ['A','B'].forEach(role=>window.applyRawStudentPreview(role,d[role]));
  $('xionRawPNG').disabled=false;
  const available=['A','B'].filter(role=>Number(d[role]?.fsrSamples)>0||Number(d[role]?.tofSamples)>0);
  const saveBoth=$('xionRawSaveBoth');
  saveBoth.disabled=!available.length;
  saveBoth.textContent='ST1·ST2 각 계정에 기록 저장';
  $('xionRawMessage').textContent='첫 번째 교육생(ST1)은 ST1 계정에, 두 번째 교육생(ST2)은 ST2 계정의 수령 대기로 저장합니다. 한 번만 누르면 두 기록을 각각 전송합니다.';
}
// A = RFID 89BC3C8E (ST1), B = RFID 87BC3C8E (ST2).
// Retry a failed role without duplicating a successfully saved role in this page session.
let savedRawRoles=new Set();
let savedRawSession=null;
async function saveBothRawRoles(){
  const d=latestRawSession;
  if(!d)return;
  const names=JSON.parse(sessionStorage.getItem('xionParticipants')||'{}');
  const btn=$('xionRawSaveBoth');
  if(!window.XION?.user||window.XION.user.uid!==names.ownerUid){$('xionRawMessage').textContent='ST1 로그인 계정에서만 교육 결과를 저장할 수 있습니다.';return;}
  if(!names.Buid){$('xionRawMessage').textContent='ST2 계정이 등록되지 않았습니다.';return;}
  if(d.A?.uid && String(d.A.uid).toUpperCase()!=='89BC3C8E' || d.B?.uid && String(d.B.uid).toUpperCase()!=='87BC3C8E'){
    $('xionRawMessage').textContent='RFID UID와 교육생 배정이 일치하지 않아 저장을 중단했습니다.';return;
  }
  btn.disabled=true;
  const result=[];
  for(const role of ['A','B']){
    const st=d[role];
    if(!(Number(st?.fsrSamples)>0||Number(st?.tofSamples)>0)){result.push(`${role==='A'?'ST1':'ST2'}: 측정값 없음`);continue;}
    if(savedRawRoles.has(role)){result.push(`${role==='A'?'ST1':'ST2'}: 이미 저장됨`);continue;}
    try{
      await window.XION.saveResult(role,{...st,switchGapsMs:d.switchGapsMs||[],switchCount:d.switchCount||0,avgSwitchGapMs:d.avgSwitchGapMs||0,session:d.session,durationMs:d.durationMs},'ble_raw',names);
      savedRawRoles.add(role);
      result.push(role==='A'?'ST1: 본인 계정 저장 완료':'ST2: 해당 계정으로 전송 완료(수령 대기)');
      window.dispatchEvent(new Event('xionrawsaved'));
    }catch(e){result.push(`${role==='A'?'ST1':'ST2'}: 실패 (${e.message})`);}
  }
  $('xionRawMessage').textContent=result.join(' / ');
  const remaining=['A','B'].some(role=>(Number(d[role]?.fsrSamples)>0||Number(d[role]?.tofSamples)>0)&&!savedRawRoles.has(role));
  btn.disabled=!remaining;
  btn.textContent=remaining?'저장 실패한 교육생 다시 시도':'각 계정 저장 완료';
}
$('xionRawSaveBoth').addEventListener('click',saveBothRawRoles);
function saveRawPNG(){
  const d=latestRawSession;if(!d)return;
  const names=JSON.parse(sessionStorage.getItem('xionParticipants')||'{}');
  const c=document.createElement('canvas');c.width=1400;c.height=1240;const ctx=c.getContext('2d');
  ctx.fillStyle='#f1f8fb';ctx.fillRect(0,0,c.width,c.height);
  const txt=(t,x,y,size=24,color='#4B1714',weight='500')=>{ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;ctx.fillText(String(t),x,y);};
  const box=(x,y,w,h)=>{ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(x,y,w,h,20);ctx.fill();};
  txt('XI:ON · RFID SESSION',65,78,24,'#FF4D4F','800');txt('교육생별 센서 누적 측정 보고서',65,139,40,'#4B1714','800');
  txt(`교육 ${d.session??'—'}회차   |   ${new Date().toLocaleString('ko-KR')}`,65,188,21,'#A56C68');
  txt(`완료 교대 ${d.switchCount??0}회   ·   평균 교대시간 ${rawFmt(Number(d.avgSwitchGapMs)/1000,2)}초`,65,247,25,'#861A13','700');
  ['A','B'].forEach((role,i)=>{const x=55+i*690,y=290,st=d[role]||{};box(x,y,660,680);txt(`${role==='A'?'ST1':'ST2'} · ${names[role]||role}`,x+25,y+54,29,'#4B1714','800');
    const vals=[['RFID UID',st.uid||'—'],['FSR 샘플',st.fsrSamples??0],['FSR1 평균 RAW',rawFmt(st.fsr1MeanRaw,1)],['FSR2 평균 RAW',rawFmt(st.fsr2MeanRaw,1)],['FSR1 최대 RAW',rawFmt(st.fsr1PeakRaw,0)],['FSR2 최대 RAW',rawFmt(st.fsr2PeakRaw,0)],['ToF 샘플',st.tofSamples??0],['ToF 평균 cm',rawFmt(Number(st.tofMeanMm)/10,2)],['ToF 최소 cm',st.tofSamples?rawFmt(Number(st.tofMinMm)/10,2):'—'],['ToF 최대 cm',st.tofSamples?rawFmt(Number(st.tofMaxMm)/10,2):'—'],['압박 위치 정확도',st.positionAccuracyPct==null?'—':rawFmt(st.positionAccuracyPct,1)+' %']];
    vals.forEach(([label,val],j)=>{txt(label,x+26,y+112+j*53,20,'#A56A66','600');txt(val,x+350,y+112+j*53,21,'#4B1714','700');});});
  box(55,996,1340,172);txt('교대 소요시간',80,1043,25,'#4B1714','800');
  const gaps=Array.isArray(d.switchGapsMs)?d.switchGapsMs:[];
  txt(gaps.length?gaps.map((v,i)=>`${i+1}회: ${rawFmt(Number(v)/1000,2)}초`).join('    '):'완료된 교대 기록 없음',80,1096,21,'#C7001E');
  txt('※ 압박 깊이는 ToF 기준값으로부터 계산된 센서 추정치이며, 의료적 판정 기준이 아닙니다.',65,1210,19,'#9B6C69');
  c.toBlob(blob=>{if(!blob)return;const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`XION_RFID_원시기록_${new Date().toISOString().slice(0,10)}.png`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);},'image/png');
}
$('xionRawPNG').addEventListener('click',saveRawPNG);
async function loadFromBLE(){
  if(!bleServer?.connected||!requestCharacteristic||!resultCharacteristic){showNotice('ESP32 연결 필요','먼저 ESP32에 연결해 주세요.');return;}
  if(pendingReceive)return;
  const button=$('loadBle');button.disabled=true;receiveBuffer='';expectedLength=-1;
  let timer;
  try{
    report('종료된 교육의 누적 결과를 수신 중입니다…');
    const received=new Promise((resolve,reject)=>{pendingReceive={resolve,reject};timer=setTimeout(()=>{if(pendingReceive){pendingReceive=null;reject(Error('30초 내에 결과가 도착하지 않았습니다. 택트 스위치로 교육을 종료했는지 확인하세요.'));}},30000);});
    try{await requestCharacteristic.writeValueWithResponse(new TextEncoder().encode('GET'));}catch(e){if(pendingReceive){pendingReceive.reject(e);pendingReceive=null;}}
    const d=await received;
    console.info("[XI:ON BLE] received session", JSON.stringify(d));
    if(d.version!==1||!('fsrSamples' in d)||!('tofSamples' in d))throw Error('ESP32 교육 결과 형식이 일치하지 않습니다.');
    const fingerprint=JSON.stringify([d.session,d.durationMs,d.A,d.B,d.switchGapsMs]);
    if(fingerprint!==savedRawSession){savedRawSession=fingerprint;savedRawRoles=new Set();}
    showSessionSummary(d);
    if(savedRawRoles.size){
      $('xionRawMessage').textContent='이 세션의 저장 완료 기록: '+[...savedRawRoles].map(r=>r==='A'?'ST1':'ST2').join(', ');
      $('xionRawSaveBoth').disabled=!['A','B'].some(role=>(Number(d[role]?.fsrSamples)>0||Number(d[role]?.tofSamples)>0)&&!savedRawRoles.has(role));
    }
    report('RFID별 실제 압박/호흡 이벤트를 평가 카드에 반영했습니다. 교육생 선택에서 ST1/ST2를 확인하세요.');
  }catch(e){report('교육 결과 수신 실패: '+e.message,true);}finally{clearTimeout(timer);pendingReceive=null;button.disabled=false;}
}
$('loadBle').addEventListener('click',loadFromBLE);

// 서버 없이 현재 선택된 교육생의 보고서를 Canvas로 그려 PNG로 다운로드합니다.
const saveButton = $('saveImage');
function refreshSaveState() {
  const data = window.getCPRResults();
  saveButton.disabled = !data[$('student').value];
}
$('student').addEventListener('change', refreshSaveState);
window.addEventListener('cprresultsupdated', refreshSaveState);
refreshSaveState();

function exportReport() {
  const trainee = $('student').value;
  const d = window.getCPRResults()[trainee];
  const nickname = (JSON.parse(sessionStorage.getItem("xionParticipants") || "{}") || {})[trainee] || `Trainee ${trainee}`;
  const recordInfo = window.xionActiveRecord || null;
  const reportDate = recordInfo?.createdAt ? new Date(recordInfo.createdAt).toLocaleString("ko-KR") : new Date().toLocaleString("ko-KR");
  if (!d) { report('먼저 ESP32에서 교육 결과를 불러와 주세요.', true); return; }
  const canvas = document.createElement('canvas');
  const W = 1200, H = 1390;
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const rounded = (x,y,w,h,r,fill) => {
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill();
  };
  const label = (txt,x,y,size=22,color='#4B1714',weight='500') => {
    ctx.fillStyle=color; ctx.font=`${weight} ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.fillText(String(txt),x,y);
  };
  ctx.fillStyle='#f0f7fb'; ctx.fillRect(0,0,W,H);
  rounded(42,40,1116,176,25,'#e1f4f7');
  label('XI:ON  ·  CPR TRAINING',76,91,21,'#AA150B','700');
  label('CPR Training Analytics',76,147,40,'#4B1714','800');
  label(`${nickname}  |  ${reportDate}  |  교육 결과 보고서`,77,185,20,'#8F5652','600');
  const avg = d.depth.reduce((a,b)=>a+b,0)/d.depth.length;
  const good = d.depth.filter(v=>v>=5&&v<=6).length/d.depth.length*100;
  const cards = [
    ['평균 압박 깊이',avg.toFixed(2)+' cm'],['압박 속도',d.rate+' 회/분'],
    ['압박 위치 정확도',d.position+' %'],['깊이 기준 충족률',good.toFixed(0)+' %'],
    ['완전 이완 비율',d.recoil+' %'],['인공호흡 횟수',d.breaths+' 회']
  ];
  cards.forEach(([title,val],i)=>{
    const x=42+(i%3)*380, y=242+Math.floor(i/3)*137;
    rounded(x,y,356,118,17,'#ffffff');
    label(title,x+22,y+35,19,'#8F5B58','600');
    label(val,x+22,y+86,34,'#991A12','800');
  });
  rounded(42,539,1116,425,20,'#ffffff');
  label('압박 깊이 변화 그래프',72,590,26,'#4B1714','700');
  label('권장 범위 5–6 cm',880,588,18,'#85504D');
  const px=100, py=640, pw=990, ph=258, low=4, high=6.5;
  const y=v=>py+ph-(v-low)/(high-low)*ph;
  const x=i=>px+i*pw/Math.max(1,d.depth.length-1);
  ctx.fillStyle='#dff7f1';ctx.fillRect(px,y(6),pw,y(5)-y(6));
  for(let v=4;v<=6.5;v+=.5){
    ctx.strokeStyle='#FFE4EC';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px,y(v));ctx.lineTo(px+pw,y(v));ctx.stroke();
    label(v.toFixed(1),58,y(v)+7,16,'#A56A66');
  }
  ctx.beginPath(); ctx.lineWidth=3; ctx.strokeStyle='#FF6B6B';
  d.depth.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.stroke();
  if(d.depth.length<=80) d.depth.forEach((v,i)=>{ctx.beginPath();ctx.arc(x(i),y(v),4,0,Math.PI*2);ctx.fillStyle='#FF6B6B';ctx.fill();});
  label(`압박 측정 횟수: ${d.depth.length}회`,75,936,18,'#A56A66');
  rounded(42,986,1116,307,20,'#ffffff');
  label('맞춤형 피드백',72,1035,26,'#4B1714','700');
  const notes = [
    ['압박 깊이',good>=80?'대체로 적절합니다.':'압박 깊이 5~6 cm를 유지하세요.'],
    ['압박 속도',d.rate>=100&&d.rate<=120?'권장 속도 범위입니다.':'분당 100~120회를 유지하세요.'],
    ['압박 위치',d.position>=80?'위치 정확도가 양호합니다.':'손의 압박 위치를 점검하세요.'],
    ['흉부 이완',d.recoil>=80?'이완 상태가 양호합니다.':'압박 후 완전히 이완하세요.'],
    ['인공호흡',d.breaths===2?'2회 수행으로 기록되었습니다.':'인공호흡 횟수를 확인하세요.']
  ];
  notes.forEach(([name,note],i)=>{
    const yy=1083+i*40;
    label('• '+name,76,yy,19,'#4B1714','700');
    label(note,288,yy,19,'#8F5B58');
  });
  label('※ 압박 위치 및 이완의 80% 판정 기준은 시연용이며 임상 검증 기준이 아닙니다.',50,1331,16,'#A77A77');
  label('XI:ON  ·  스마트 CPR 교육 결과',50,1360,17,'#A77A77');
  const filename=`CPR_Training_${nickname.replace(/[^a-zA-Z0-9가-힣_-]/g,"_")}_${(recordInfo?.createdAt || new Date().toISOString()).slice(0,10)}.png`;
  canvas.toBlob(blob=>{
    if(!blob){report('PNG 생성에 실패했습니다.',true);return;}
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    report(`${nickname} 교육 결과 PNG 저장을 요청했습니다. 브라우저 다운로드 목록을 확인해 주세요.`);
  },'image/png');
}
saveButton.addEventListener('click',exportReport);
