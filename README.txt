XI:ON Firebase 연동 시범 버전

1. Firebase Console > Firestore Database > 규칙 에 firestore.rules 전체를 붙여넣고 '게시'하세요.
2. Firebase Authentication > 로그인 방법에서 Google 활성화 및 승인된 도메인 csw24.github.io 확인.
3. 이 폴더의 index.html, dashboard.html, firebase.js, history.js, participants.js, script.js, integration.js, style.css 파일을 GitHub 저장소 루트에 업로드하세요. 이름에 (1)이 붙은 파일이 아니라 이 폴더의 파일명을 그대로 사용합니다.
4. https://csw24.github.io/CPR_WEB/ 에서 Google 로그인 후 최초 닉네임 등록. 두 번째 Google 계정에서도 미리 다른 닉네임을 등록하세요.
5. 첫 번째 계정으로 로그인해 ST2 닉네임 검색 후 클래스 입장. 가상 데이터 생성 -> ST1 저장 / ST2 저장을 각각 수행하세요.
6. 두 번째 계정으로 로그인하면 '내 기록 수령 대기'에 ST2 기록이 표시됩니다. 가져오기/거절하기를 선택하세요.

중요 제한:
- ST2가 로그인하면 입장 화면에 수령 대기 기록이 표시됩니다. 수령 후 본인 기록 조회는 대시보드에서 가능합니다. 개인 기록 전용 독립 화면은 아직 구현되지 않았습니다.
- 고유 닉네임은 동일 닉네임 중복 등록을 막지만 신원 인증은 아닙니다. 로그인한 ST1이 등록된 다른 사람 닉네임으로 결과를 만들 수 있습니다. 수령자가 직접 승인해야만 개인 기록으로 확정됩니다.
- 테스트 데이터만 사용하세요. 실제 환자 데이터나 민감정보는 저장하지 마세요.
- GitHub Pages에 배포한 뒤 실제 두 계정으로 로그인/권한/기록 분리 테스트가 필요합니다.
- 기존 localStorage 기록은 자동으로 클라우드에 이전되지 않습니다.
