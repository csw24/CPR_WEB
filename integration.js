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

function showSessionSummary(d) {
  let host=document.getElementById('xionRawSession');
  if(!host){
    host=document.createElement('section');host.id='xionRawSession';
    host.className='panel';host.style.margin='18px 0';
    document.querySelector('.data-actions').insertAdjacentElement('afterend',host);
  }
  const fmt=(v,digits=1)=>Number.isFinite(Number(v))?Number(v).toFixed(digits):'—';
  const delta=Number(d.tofMaxMm)-Number(d.tofMinMm);
  const mins=Number(d.durationMs)/60000;
  const uid=(d.rfidUIDs||'').split(',').filter(Boolean);
  const fields=[
    ['교육 시간',fmt(mins,2)+' 분'],
    ['FSR 1 평균',fmt(d.fsr1MeanRaw,0)+' RAW'],
    ['FSR 2 평균',fmt(d.fsr2MeanRaw,0)+' RAW'],
    ['FSR 1 최대',fmt(d.fsr1PeakRaw,0)+' RAW'],
    ['FSR 2 최대',fmt(d.fsr2PeakRaw,0)+' RAW'],
    ['ToF 평균 거리',fmt(d.tofMeanMm,1)+' mm'],
    ['ToF 거리 범위',fmt(d.tofMinMm,0)+' ~ '+fmt(d.tofMaxMm,0)+' mm'],
    ['거리 전체 변동폭',fmt(delta,0)+' mm'],
    ['RFID 인식 UID',uid.length?uid.join(', '):'인식 없음'],
    ['측정 샘플',`${d.fsrSamples||0} FSR / ${d.tofSamples||0} ToF`]
  ];
  host.replaceChildren();
  const title=document.createElement('h2');title.textContent=`교육 ${d.session??'—'}회차 · 종료된 교육의 누적 결과`;host.append(title);
  const note=document.createElement('p');note.style='font-size:13px;margin-bottom:16px';note.textContent='실측 원시값 기반 통계입니다. RAW는 압박 힘(N)이 아니며 ToF 거리 변동폭은 압박 깊이(cm)가 아닙니다. 아직 학생별 분리·압박 속도·정확도·이완율은 계산하지 않습니다.';host.append(note);
  const table=document.createElement('table');table.style='width:100%;border-collapse:collapse;font-size:15px';
  fields.forEach(([name,value])=>{const tr=document.createElement('tr');tr.style.borderBottom='1px solid #dceaf1';for(const [txt,bold] of [[name,true],[value,false]]){const cell=document.createElement('td');cell.style='padding:10px 8px';cell.textContent=txt;if(bold)cell.style.fontWeight='700';tr.append(cell);}table.append(tr);});host.append(table);
  const canvas=document.createElement('canvas');canvas.width=850;canvas.height=290;canvas.style='margin-top:22px;width:100%';host.append(canvas);
  const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pad=55;
  c.clearRect(0,0,w,h);c.fillStyle='#6684a5';c.font='15px sans-serif';
  c.fillText('ToF 거리 측정 요약 (mm)',pad,24);
  const bars=[['최소',Number(d.tofMinMm)],['평균',Number(d.tofMeanMm)],['최대',Number(d.tofMaxMm)]];
  const max=Math.max(1,...bars.map(x=>x[1]));
  bars.forEach(([label,val],i)=>{const x=125+i*235,bh=Math.max(1,val/max*175);c.fillStyle='#1973a9';c.fillRect(x,225-bh,75,bh);c.fillStyle='#172b40';c.fillText(label,x+16,250);c.fillText(fmt(val,1),x+5,225-bh-8);});
  window.xionRawSession=d;
}
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
    if(d.version!==1||!('fsrSamples' in d)||!('tofSamples' in d))throw Error('ESP32 교육 결과 형식이 일치하지 않습니다.');
    showSessionSummary(d);
    report('교육 종료 후 누적된 원시 측정 결과를 불러왔습니다. 아래 요약 표와 그래프를 확인하세요.');
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
  const label = (txt,x,y,size=22,color='#14254b',weight='500') => {
    ctx.fillStyle=color; ctx.font=`${weight} ${size}px "Noto Sans KR", "Malgun Gothic", sans-serif`;
    ctx.fillText(String(txt),x,y);
  };
  ctx.fillStyle='#f0f7fb'; ctx.fillRect(0,0,W,H);
  rounded(42,40,1116,176,25,'#e1f4f7');
  label('XI:ON  ·  CPR TRAINING',76,91,21,'#0b9eaa','700');
  label('CPR Training Analytics',76,147,40,'#14254b','800');
  label(`${nickname}  |  ${reportDate}  |  교육 결과 보고서`,77,185,20,'#52758f','600');
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
    label(title,x+22,y+35,19,'#58748f','600');
    label(val,x+22,y+86,34,'#127d99','800');
  });
  rounded(42,539,1116,425,20,'#ffffff');
  label('압박 깊이 변화 그래프',72,590,26,'#14254b','700');
  label('권장 범위 5–6 cm',880,588,18,'#4d7285');
  const px=100, py=640, pw=990, ph=258, low=4, high=6.5;
  const y=v=>py+ph-(v-low)/(high-low)*ph;
  const x=i=>px+i*pw/Math.max(1,d.depth.length-1);
  ctx.fillStyle='#dff7f1';ctx.fillRect(px,y(6),pw,y(5)-y(6));
  for(let v=4;v<=6.5;v+=.5){
    ctx.strokeStyle='#e1ebf3';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px,y(v));ctx.lineTo(px+pw,y(v));ctx.stroke();
    label(v.toFixed(1),58,y(v)+7,16,'#6684a5');
  }
  ctx.beginPath(); ctx.lineWidth=3; ctx.strokeStyle='#147bd0';
  d.depth.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.stroke();
  if(d.depth.length<=80) d.depth.forEach((v,i)=>{ctx.beginPath();ctx.arc(x(i),y(v),4,0,Math.PI*2);ctx.fillStyle='#147bd0';ctx.fill();});
  label(`압박 측정 횟수: ${d.depth.length}회`,75,936,18,'#6684a5');
  rounded(42,986,1116,307,20,'#ffffff');
  label('맞춤형 피드백',72,1035,26,'#14254b','700');
  const notes = [
    ['압박 깊이',good>=80?'대체로 적절합니다.':'압박 깊이 5~6 cm를 유지하세요.'],
    ['압박 속도',d.rate>=100&&d.rate<=120?'권장 속도 범위입니다.':'분당 100~120회를 유지하세요.'],
    ['압박 위치',d.position>=80?'위치 정확도가 양호합니다.':'손의 압박 위치를 점검하세요.'],
    ['흉부 이완',d.recoil>=80?'이완 상태가 양호합니다.':'압박 후 완전히 이완하세요.'],
    ['인공호흡',d.breaths===2?'2회 수행으로 기록되었습니다.':'인공호흡 횟수를 확인하세요.']
  ];
  notes.forEach(([name,note],i)=>{
    const yy=1083+i*40;
    label('• '+name,76,yy,19,'#14254b','700');
    label(note,288,yy,19,'#58748f');
  });
  label('※ 압박 위치 및 이완의 80% 판정 기준은 시연용이며 임상 검증 기준이 아닙니다.',50,1331,16,'#7790a7');
  label('XI:ON  ·  스마트 CPR 교육 결과',50,1360,17,'#7790a7');
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
