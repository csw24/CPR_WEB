XI:ON 1단계 - ID 입력 화면 분리

1. 이 ZIP의 파일들을 GitHub CPR_WEB 저장소 최상위에 업로드합니다.
2. index.html: 교육생 ST1/ST2 ID 입력 페이지
3. dashboard.html: 기존 CPR 대시보드 (디자인과 BLE/PNG 코드 유지)
4. participants.js: 입력한 두 ID를 ST1/ST2 선택 메뉴에 표시
5. script.js, integration.js: 업로드 원본 그대로

주의: 현재 단계는 입장 화면과 이름 표시만 구현했습니다.
기록을 Firebase에 저장하거나 과거 기록을 조회하는 기능은 아직 없습니다.
입력한 이름은 해당 브라우저 탭의 sessionStorage에만 저장됩니다.
이는 보안 인증이 아니며 다른 ID를 입력하는 것을 막지 않습니다.
ESP32 BLE 펌웨어는 이 단계에서 수정하지 않습니다.
