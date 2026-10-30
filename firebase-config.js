// Firebase Console > Project settings > Your apps > Web app 에서 복사하세요.
// 값은 비밀번호가 아니지만, Firebase 보안 규칙은 반드시 설정해야 합니다.
export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  appId: 'PASTE_APP_ID'
};

// ESP32 펌웨어에서 정의한 BLE GATT UUID와 일치시켜야 합니다.
export const bleConfig = {
  serviceUUID: '8a5c0001-16a0-4b5c-9f8e-37ab8b0c1001',
  resultCharacteristicUUID: '8a5c0002-16a0-4b5c-9f8e-37ab8b0c1001',
  requestCharacteristicUUID: '8a5c0003-16a0-4b5c-9f8e-37ab8b0c1001'
};
