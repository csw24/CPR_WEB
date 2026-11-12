// 현재 입장한 두 교육생의 표시 이름만 변경합니다. BLE A/B 데이터 구조는 유지합니다.
(function () {
  let names;
  try { names = JSON.parse(sessionStorage.getItem('xionParticipants') || 'null'); } catch (_) {}
  if (!names || !names.A || !names.B || names.A === names.B) {
    location.replace('index.html');
    return;
  }
  const selector = document.getElementById('student');
  selector.querySelector('option[value="A"]').textContent = `ST1 · ${names.A}`;
  selector.querySelector('option[value="B"]').textContent = `ST2 · ${names.B}`;
  document.getElementById('changeParticipants').addEventListener('click', () => {
    if (!confirm('교육생을 변경하면 현재 화면의 측정 결과가 초기화됩니다. 계속할까요?')) return;
    sessionStorage.removeItem('xionParticipants');
    location.assign('index.html');
  });
})();
