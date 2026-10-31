// BLE UUID는 ESP32/CPR_BLE_Test.ino의 값과 반드시 같아야 합니다.
const bleConfig = {
  serviceUUID: '8a5c0001-16a0-4b5c-9f8e-37ab8b0c1001',
  resultCharacteristicUUID: '8a5c0002-16a0-4b5c-9f8e-37ab8b0c1001',
  requestCharacteristicUUID: '8a5c0003-16a0-4b5c-9f8e-37ab8b0c1001'
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

// BLE 알림은 작은 패킷으로 쪼개져 도착합니다.
// 프로토콜: UTF-8 JSON 한 건을 여러 번 notify하고 마지막에 '\n'을 보냅니다.
// JSON 문자열 안의 줄바꿈은 JSON.stringify에 의해 이스케이프됩니다.
function onNotification(event) {
  if (!pendingReceive) return;
  const value = event.target.value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  receiveBuffer += decoder.decode(bytes, { stream: true });
  if (receiveBuffer.length > 100000) {
    pendingReceive.reject(new Error('수신 데이터가 허용 크기를 초과했습니다.'));
    pendingReceive = null;
    receiveBuffer = '';
    return;
  }
  const end = receiveBuffer.indexOf('\n');
  if (end < 0) return;
  const line = receiveBuffer.slice(0, end).trim();
  try {
    const parsed = JSON.parse(line);
    pendingReceive.resolve(parsed.students ?? parsed);
  } catch (error) {
    pendingReceive.reject(new Error(`JSON 해석 실패: ${error.message}`));
  } finally {
    pendingReceive = null;
    receiveBuffer = '';
  }
}

async function loadFromBLE() {
  if (!bleServer?.connected || !requestCharacteristic || !resultCharacteristic) {
    showNotice('ESP32 연결 필요', '교육 결과를 불러오려면 먼저 ESP32를 연결해 주세요.');
    return;
  }
  if (pendingReceive) return;
  const button = $('loadBle');
  button.disabled = true;
  receiveBuffer = '';
  decoder.decode(); // 이전 디코더 스트림 초기화
  let timer;
  try {
    report('ESP32에서 교육 결과를 수신하는 중입니다…');
    const received = new Promise((resolve, reject) => {
      pendingReceive = { resolve, reject };
      timer = setTimeout(() => {
        if (pendingReceive) {
          pendingReceive = null;
          reject(new Error('15초 내에 결과가 도착하지 않았습니다.'));
        }
      }, 15000);
    });
    try {
      await requestCharacteristic.writeValueWithResponse(new TextEncoder().encode('GET'));
    } catch (error) {
      if (pendingReceive) { pendingReceive.reject(error); pendingReceive = null; }
    }
    const data = await received;
    window.applyCPRResults(data);
    report('ESP32 교육 결과를 불러왔습니다. 교육생을 선택한 후 PNG로 저장할 수 있습니다.');
  } catch (error) {
    report(`교육 결과 수신 실패: ${error.message}`, true);
  } finally {
    clearTimeout(timer);
    pendingReceive = null;
    button.disabled = false;
  }
}
$('loadBle').addEventListener('click', loadFromBLE);


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
  label(`Trainee ${trainee}  |  교육 결과 보고서`,77,185,22,'#52758f','600');
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
  const filename=`CPR_Training_Trainee_${trainee}_${new Date().toISOString().slice(0,10)}.png`;
  canvas.toBlob(blob=>{
    if(!blob){report('PNG 생성에 실패했습니다.',true);return;}
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    report(`Trainee ${trainee} 교육 결과 PNG 저장을 요청했습니다. 브라우저 다운로드 목록을 확인해 주세요.`);
  },'image/png');
}
saveButton.addEventListener('click',exportReport);
