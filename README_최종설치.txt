XI:ON CPR 최종 수정본 (2026-11-19)

1) Arduino IDE에서 XION_CPR_FINAL_2MIN.ino 업로드 (ESP32 Dev Module).
2) DFPlayer microSD의 /mp3/0018.mp3 = 교대하세요, /mp3/0019.mp3 = 심폐소생술 교육 종료 음성.
   첨부된 cpr_complete.mp3를 0019.mp3로 복사해 /mp3/ 폴더에 넣으세요.
   기존 DFPlayer 음성 번호와 재생 방식은 유지. 파일이 없으면 안내가 재생되지 않습니다.
3) 웹 파일(index.html, dashboard.html, firebase.js, history.js, compare.js, 기타 JS/CSS/GIF)을 GitHub Pages 저장소 루트에 업로드.
4) Firebase Console > Firestore Database > 규칙에 firestore.rules를 반영하고 게시해야 닉네임 변경이 작동합니다.
5) Google 로그인 후 내 닉네임 수정 버튼 사용. 중복 닉네임 금지. 기존 기록은 recipientUid 기준으로 조회. 과거 기록에 저장된 닉네임 문자열은 소급 변경하지 않음.
6) 시작 버튼 -> ST1 RFID -> 2분 -> 0018 교대 음성 -> ST2 RFID -> 2분 -> 0019 종료 음성 + 자동 종료 -> BLE GET.
7) 가상 데이터 생성 UI와 신규 저장 경로 제거. 기존 Firebase 가상 기록은 삭제하지 않고 기본 조회에서 제외.

주의: 실제 ESP32 업로드, DFPlayer 출력, Firebase 보안 규칙, 브라우저 동작은 장비/계정에서 직접 검증 필요.
기존 프로젝트 및 SD카드 백업 후 적용하세요.
