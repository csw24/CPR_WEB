XI:ON RFID 2분 교대 + ST1/ST2 웹 연동

1. 먼저 기존 GitHub CPR_WEB 저장소를 백업하세요.
2. Arduino IDE에서 XION_RFID_2min_existing_audio.ino 업로드. 기존 라이브러리/보드/핀 연결 유지.
3. 교육 시작 버튼 누른 후 ST1(89BC3C8E) 태그 인식 -> 120초 시작.
4. 2분 후 SD 카드의 기존 7번 음성이 재생됩니다(교대 전용 멘트는 아님).
5. ST2(87BC3C8E) 태그 인식 -> 교대 지연시간 저장, ST2 120초 시작.
6. 교육 종료 버튼 누른 뒤 웹에서 ESP32 연결 -> 교육 결과 불러오기.
7. 웹에는 ST1/ST2의 FSR/ToF RAW 통계와 교대시간이 분리 표시됩니다.
8. 'RFID 결과 PNG 저장'으로 별도 원시 측정 보고서를 저장합니다.
9. 'ST1 원시 기록 Firebase 저장' / 'ST2 원시 기록 Firebase 전송' 버튼으로 각각 저장합니다. ST2는 자기 계정에서 수령 승인해야 합니다.
10. Firebase Console > Firestore Database > 규칙에 포함된 firestore.rules를 적용하고 게시합니다. 기존 규칙의 source 허용값에 ble_raw를 추가했습니다.
11. 웹 파일(index.html, dashboard.html, firebase.js, firestore.rules, history.js, integration.js, participants.js, script.js, compare.js, style.css, songi_web.gif)을 GitHub CPR_WEB 저장소 루트에 올립니다. .ino와 README는 웹에 올리지 않아도 됩니다.
12. GitHub Pages 배포 후 강력 새로고침(Ctrl+Shift+R). Chrome/Edge HTTPS 환경에서 BLE 테스트.

주의:
- 기존 7번 트랙을 임시 재사용합니다. 실제 7번 트랙이 재생 가능한지 DFPlayer에서 확인하세요.
- RFID 교대 대기 중 A/B 개별 데이터 누적은 멈추지만 전체 RAW 누적은 계속됩니다.
- FSR 샘플 개수는 압박 횟수가 아닙니다. ToF 거리(mm)는 보정된 압박 깊이(cm)가 아닙니다.
- 이번 실측 데이터는 CPR 6개 평가 카드/회차 비교 점수에 자동 반영하지 않습니다. 평가 알고리즘 보정이 필요합니다.
- RFID UID는 인증 수단이 아니라 측정 분류용입니다. 웹 개인기록 접근은 Firebase 계정/보안규칙을 따릅니다.
- 실제 ESP32 컴파일/하드웨어 및 Firebase 계정 2개로 통합 테스트는 별도로 필요합니다.
