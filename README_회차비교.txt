XI:ON 회차별 통계 비교 추가 버전

기존 XION_CPR_WEB.zip을 기반으로 대시보드에 회차별 통계 비교 탭만 추가했습니다.
수정 파일: dashboard.html, style.css / 추가 파일: compare.js.
나머지 파일은 원본 그대로 포함했습니다.
GitHub Pages 저장소 최상위에 압축 해제한 웹사이트 파일을 업로드하세요.
Firestore 규칙 변경 불필요.
본인 Firebase 계정의 claimed 기록만 표시하며 pending/rejected는 제외합니다.
실제 BLE와 가상 데이터는 기본적으로 분리해서 조회합니다.
테스트: Google 로그인 후 대시보드 → 회차별 통계 비교 → 가상 데이터 선택 또는 실제 BLE 기록 선택.
동작은 실제 Firebase 서비스에 접속해 검증하지 못했습니다.

추가: 회차 비교 결과 PNG 저장 버튼. 로그인한 본인 UID의 수령 완료 기록만 저장하며, 선택한 기록 유형과 두 회차 상세 비교를 반영합니다.
