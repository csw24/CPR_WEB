import { firebaseConfig, bleConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const message = $('actionMessage');
const dialog = $('noticeDialog');
let bleDevice = null;
let bleServer = null;
let resultCharacteristic = null;
let requestCharacteristic = null;
let cloud = null;
let blePayload = null;
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
    blePayload = window.getCPRResults();
    report('ESP32 결과를 표시했습니다. 다른 기기와 공유하려면 Firebase에 별도로 저장해야 합니다.');
  } catch (error) {
    report(`교육 결과 수신 실패: ${error.message}`, true);
  } finally {
    clearTimeout(timer);
    pendingReceive = null;
    button.disabled = false;
  }
}
$('loadBle').addEventListener('click', loadFromBLE);

// Firebase는 선택 기능입니다. BLE 연결 및 수신은 Firebase 없이 작동합니다.
const configured = firebaseConfig.apiKey !== 'PASTE_API_KEY' &&
  firebaseConfig.projectId !== 'PASTE_PROJECT_ID' &&
  firebaseConfig.appId !== 'PASTE_APP_ID';
async function getCloud() {
  if (!configured) {
    showNotice('Firebase 설정 필요', '다른 기기와 결과를 공유하려면 firebase-config.js에 프로젝트 설정값을 입력하고 Firestore 및 익명 인증을 활성화해 주세요.', false);
    return null;
  }
  if (cloud) return cloud;
  const [{ initializeApp }, auth, store] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
  ]);
  const app = initializeApp(firebaseConfig);
  await auth.signInAnonymously(auth.getAuth(app));
  cloud = { db: store.getFirestore(app), store };
  return cloud;
}
async function saveDemo() {
  const button = $('uploadDemo');
  button.disabled = true;
  try {
    const connection = await getCloud();
    if (!connection) return;
    const { db, store } = connection;
    await store.setDoc(store.doc(db, 'demo', 'latest'), {
      students: window.getCPRResults(), source: 'demo', updatedAt: store.serverTimestamp()
    });
    report('현재 화면 데이터를 Firebase 시연용 영역에 저장했습니다. 실제 센서 기록과 혼동하지 마세요.');
  } catch (error) { report(`저장 실패: ${error.message}`, true); }
  finally { button.disabled = false; }
}
$('uploadDemo').addEventListener('click', saveDemo);
async function loadSaved() {
  const button = $('loadCloud');
  button.disabled = true;
  try {
    const connection = await getCloud();
    if (!connection) return;
    const { db, store } = connection;
    const snapshot = await store.getDoc(store.doc(db, 'demo', 'latest'));
    if (!snapshot.exists()) { report('저장된 시연용 결과가 없습니다.'); return; }
    window.applyCPRResults(snapshot.data().students);
    report('Firebase의 시연용 결과를 조회했습니다.');
  } catch (error) { report(`조회 실패: ${error.message}`, true); }
  finally { button.disabled = false; }
}
$('loadCloud').addEventListener('click', loadSaved);
