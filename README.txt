XI:ON 2단계 - 가상 CPR 데이터와 브라우저별 기록 조회

GitHub Pages 저장소 최상위에 ZIP 안의 웹 파일들을 업로드하세요.
index.html, dashboard.html, participants.js, script.js, integration.js, history.js, style.css (및 .gitattributes)

1. ST1/ST2 교육생 ID를 입력하고 클래스 입장하기를 누릅니다.
2. 가상 데이터 생성 후 교육생을 선택하고 현재 결과 기록 저장을 누릅니다.
3. 날짜를 선택하고 기록 조회를 눌러 해당 교육생의 기록을 확인합니다.
4. 같은 날짜 여러 번 저장 가능. PNG에는 해당 기록의 교육생 ID와 저장 시간이 표시됩니다.
5. BLE 연결 및 교육 결과 불러오기는 기존 기능을 유지합니다. BLE 데이터도 명시적으로 기록 저장 버튼을 눌러 저장할 수 있습니다.

주의: Firebase가 아직 없으므로 localStorage에 저장되며 같은 브라우저/기기에서만 조회 가능합니다. 캐시/사이트 데이터 삭제 시 기록이 사라집니다. ID는 인증이 아닙니다. 실제 환자/민감정보를 저장하지 마세요.
