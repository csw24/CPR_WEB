// STEP 2: 같은 브라우저의 localStorage에만 저장하는 시연용 기록 관리.
// 인증/클라우드 동기화 기능이 없으므로 개인정보나 실제 의료정보를 저장하지 마세요.
(function () {
  'use strict';
  const KEY = 'xionCPRRecordsV1';
  const $ = id => document.getElementById(id);
  const selector = $('student');
  const names = JSON.parse(sessionStorage.getItem('xionParticipants') || '{}');
  const dateInput = $('recordDate');
  const save = $('saveRecord');
  const list = $('recordList');
  const status = $('historyMessage');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  dateInput.value = today();
  let source = null; // demo | ble | history
  let active = null;
  // 교육생별로 현재 화면에 표시된 기록을 추적합니다.
  const displayed = {A:null, B:null};
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = records => localStorage.setItem(KEY, JSON.stringify(records));
  const copy = obj => JSON.parse(JSON.stringify(obj));
  const announce = txt => { status.textContent = txt; };
  const currentName = () => names[selector.value];
  const fmt = iso => new Date(iso).toLocaleString('ko-KR');
  const randomDepth = (n, offset) => Array.from({length:n}, (_,i) => Math.round((5.4 + Math.sin(i*.75+offset)*.42 + (Math.random()-.5)*.7)*100)/100);
  function generateDemo() {
    const data = {};
    ['A','B'].forEach((role,i) => { data[role] = {depth:randomDepth(30,i),rate:i===0?110:128,position:i===0?92:76,recoil:i===0?90:70,breaths:i===0?2:1,cycles:1}; });
    window.applyCPRResults(data);
    source = 'demo'; active = null; displayed.A=null; displayed.B=null; window.xionActiveRecord = null;
    save.disabled = false;
    announce('가상 데이터가 표시되었습니다. 저장하려면 「현재 결과 기록 저장」을 누르세요.');
  }
  function saveRecord() {
    if (source === 'history') { announce('과거 기록은 중복 저장하지 않습니다. 새 가상 데이터를 생성하거나 ESP32에서 새 결과를 불러와 주세요.'); return; }
    const results = window.getCPRResults();
    const role = selector.value;
    if (!results[role]) { announce('저장할 결과가 없습니다.'); return; }
    const record = {id:crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+'-'+Math.random(),nickname:currentName(),createdAt:new Date().toISOString(),source:source==='demo'?'demo':'ble',data:copy(results[role])};
    try { const records = read(); records.push(record); write(records); }
    catch (e) { announce('브라우저 저장 공간에 기록을 저장하지 못했습니다: '+e.message); return; }
    active = record; displayed[role]=record; window.xionActiveRecord = record;
    announce(`${record.nickname}의 ${record.source==='demo'?'가상':'BLE'} 결과를 저장했습니다 (${fmt(record.createdAt)}).`);
    showRecords();
  }
  function recordsForSelection() {
    const date = dateInput.value;
    return read().filter(r => r.nickname === currentName() && (!date || localDate(r.createdAt) === date))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  function localDate(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function restoreRecord(r) {
    const role = selector.value;
    // 히스토리 복원은 BLE 수신이 아닙니다.
    window.__xionInternalRestore = true;
    try { window.applyCPRResults({[role]:copy(r.data)}); }
    finally { window.__xionInternalRestore = false; }
    source='history'; active=r; displayed[role]=r;
    window.xionActiveRecord=r; save.disabled=true;
    announce(`${r.nickname}의 ${fmt(r.createdAt)} 기록을 불러왔습니다. PNG 저장이 가능합니다.`);
    showRecords();
  }
  function selectHistoryForCurrentPerson() {
    const mine = recordsForSelection();
    if (mine.length) {
      restoreRecord(mine[0]);
    } else {
      active=null; window.xionActiveRecord=null;
      // 날짜에 맞는 기록이 없을 때 다른 날짜/교육생 기록을 보여주지 않습니다.
      window.clearCPRResult(selector.value);
      source=null; save.disabled=true;
      showRecords();
      announce(`${currentName()}의 선택한 날짜 기록이 없습니다.`);
    }
  }
  function showRecords() {
    const mine = recordsForSelection();
    list.replaceChildren();
    if (!mine.length) { list.textContent = '선택한 교육생의 해당 날짜 기록이 없습니다.'; return; }
    mine.forEach(r => {
      const b = document.createElement('button'); b.type='button'; b.className='record-item'+(active?.id===r.id?' active':'');
      const dateText = document.createElement('span');dateText.textContent=fmt(r.createdAt);
      const tag = document.createElement('small');tag.textContent=r.source==='demo'?'가상 데이터 · 테스트':'ESP32 BLE 데이터';
      b.append(dateText,tag);
      b.addEventListener('click', () => {
        restoreRecord(r);
      });
      list.appendChild(b);
    });
  }
  $('demoData').addEventListener('click',generateDemo);
  $('showRecords').addEventListener('click',selectHistoryForCurrentPerson);
  save.addEventListener('click',saveRecord);
  selector.addEventListener('change',selectHistoryForCurrentPerson);
  dateInput.addEventListener('change',selectHistoryForCurrentPerson);
  // BLE 수신 성공을 감지합니다. 수신 결과는 자동 저장하지 않습니다.
  // demo/history 복원에서도 이 이벤트가 발생하므로 별도 플래그로 구분합니다.
  const original = window.applyCPRResults;
  window.applyCPRResults = function (data) {
    const result = original(data);
    if (!window.__xionInternalRestore) { source='ble';active=null;displayed.A=null;displayed.B=null;window.xionActiveRecord=null;save.disabled=!window.getCPRResults()[selector.value]; }
    return result;
  };
  selectHistoryForCurrentPerson();
})();
