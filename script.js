// 데이터는 BLE로 수신하기 전까지 비어 있습니다.
let students = { A: null, B: null };
const metrics = document.getElementById('metrics');
const feedback = document.getElementById('feedback');
const select = document.getElementById('student');

// 기존 Canvas 그래프의 5~6cm 권장 영역과 측정값을 유지합니다.
function drawChart(values) {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, p = 48, min = 4, max = 6.5;
  const y = v => h-p-(v-min)/(max-min)*(h-2*p);
  const x = i => p+i*(w-2*p)/Math.max(1,values.length-1);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#dff7f1';
  ctx.fillRect(p,y(6),w-2*p,y(5)-y(6));
  ctx.strokeStyle = '#e1ebf3';
  ctx.lineWidth = 1;
  ctx.font = '15px Arial';
  ctx.fillStyle = '#6885a5';
  for(let v=4;v<=6.5;v+=0.5) {
    ctx.beginPath(); ctx.moveTo(p,y(v)); ctx.lineTo(w-p,y(v)); ctx.stroke();
    ctx.fillText(v.toFixed(1),8,y(v)+5);
  }
  if (!values.length) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Noto Sans KR", Arial';
    ctx.fillStyle = '#8ba0b4';
    ctx.fillText('교육 결과를 불러오면 그래프가 표시됩니다.', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }
  ctx.strokeStyle = '#147bd0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  values.forEach((v,i) => i ? ctx.lineTo(x(i),y(v)) : ctx.moveTo(x(i),y(v)));
  ctx.stroke();
  values.forEach((v,i) => {
    ctx.beginPath(); ctx.arc(x(i),y(v),5,0,Math.PI*2);
    ctx.fillStyle = '#147bd0'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.fillStyle = '#6885a5';
  values.forEach((_,i) => ctx.fillText(String(i+1),x(i)-4,h-14));
}

function render() {
  const d = students[select.value];
  // BLE RAW display mode: explicitly labelled prototype indicators, not CPR accuracy.
  if (d && d._rawPrototype) {
    const raw=d._rawPrototype;
    const n=Number(raw.fsrSamples)||0, m=Number(raw.tofSamples)||0;
    const clamp=v=>Math.max(0,Math.min(100,Math.round(v)));
    const f1=Number(raw.fsr1MeanRaw)||0, f2=Number(raw.fsr2MeanRaw)||0;
    const range=m>0?Math.max(0,(Number(raw.tofMaxMm)||0)-(Number(raw.tofMinMm)||0)):0;
    const values=[
      ['압박 깊이 (시연 지표)',m?clamp(range/60*100):null,'%',`ToF 거리 변동폭 ${range.toFixed(0)} mm / 임시 60 mm 기준`],
      ['압박 속도',null,'','압박 이벤트 검출 알고리즘 미구현'],
      ['압박 위치 (시연 지표)',n?clamp((Math.min(f1,f2)/Math.max(1,Math.max(f1,f2)))*100):null,'%','FSR1·FSR2 평균 균형 기반 임시 지표'],
      ['깊이 기준 (시연 지표)',m?clamp(range/60*100):null,'%','ToF 거리 변동폭 기반 임시 지표'],
      ['완전 이완 (시연 지표)',m?clamp(100-Math.abs(range-40)/60*100):null,'%','ToF 변동폭 기반 임시 지표 (실제 이완율 아님)'],
      ['인공호흡',null,'','SDP810 인공호흡 판정 미구현']
    ];
    const palette=['#087d79','#137bd1','#d53e68','#5745b1','#cc5a28','#137bd1'];
    metrics.innerHTML=values.map(([label,v,unit,hint],i)=>`<article class="metric" style="--accent:${palette[i]};--bubble:#e4f7f3;--tint:#f1faf8"><div class="metric-icon">${['↕','◴','◎','▥','♧','♡'][i]}</div><span>${label}</span><strong>${v===null?'—':v} <small>${unit}</small></strong><em>${hint}</em></article>`).join('');
    feedback.innerHTML='<div class="empty-feedback"><strong>실측 기반 임시 시연 지표</strong><p>RFID별 실제 센서값으로 계산한 테스트용 백분율입니다. 의료적으로 검증된 CPR 정확도·깊이·이완율이 아닙니다. 압박 속도와 인공호흡은 아직 산출할 수 없습니다.</p></div>';
    drawChart([]);
    return;
  }
  const avg = d ? d.depth.reduce((a,b)=>a+b,0)/d.depth.length : null;
  const good = d ? d.depth.filter(v=>v>=5&&v<=6).length/d.depth.length*100 : null;
  const items = [
    { label:'평균 압박 깊이', value:d ? avg.toFixed(2) : '-', unit:'cm', hint:'목표 5~6 cm', icon:'↕', accent:'#087d79', bubble:'#d9f5f0', tint:'#e7faf6' },
    { label:'압박 속도', value:d ? d.rate : '-', unit:'회/분', hint:'목표 100~120 회/분', icon:'◴', accent:'#137bd1', bubble:'#e1efff', tint:'#eaf5ff' },
    { label:'압박 위치 정확도', value:d ? d.position : '-', unit:'%', hint:'압박 위치 평가', icon:'◎', accent:'#d53e68', bubble:'#ffe8ee', tint:'#fff0f3' },
    { label:'깊이 기준 충족률', value:d ? good.toFixed(0) : '-', unit:'%', hint:'기준 내 압박 비율', icon:'▥', accent:'#5745b1', bubble:'#efebff', tint:'#f3f0ff' },
    { label:'완전 이완 비율', value:d ? d.recoil : '-', unit:'%', hint:'압박 위치 평가', icon:'♧', accent:'#cc5a28', bubble:'#ffede4', tint:'#fff3e9' },
    { label:'인공호흡 횟수', value:d ? d.breaths : '-', unit:'회', hint:'인공호흡 감지 횟수', icon:'♡', accent:'#137bd1', bubble:'#e1f2ff', tint:'#edf8ff' }
  ];
  metrics.innerHTML = items.map(item => `
    <article class="metric" style="--accent:${item.accent};--bubble:${item.bubble};--tint:${item.tint}">
      <div class="metric-icon" aria-hidden="true">${item.icon}</div>
      <span>${item.label}</span>
      <strong>${item.value} <small>${item.unit}</small></strong>
      <em>${item.hint}</em>
    </article>`).join('');

  if (!d) {
    feedback.innerHTML = '<div class="empty-feedback">교육 결과를 불러오면 맞춤형 피드백이 표시됩니다.</div>';
    drawChart([]);
    return;
  }
  // 위치/이완 80%는 시연용 판정 기준이며 의료적으로 검증된 기준이 아닙니다.
  const notes = [
    ['압박 깊이', good>=80?'대체로 적절합니다.':'압박 깊이 5~6 cm를 유지하세요.',good>=80],
    ['압박 속도',d.rate>=100&&d.rate<=120?'권장 속도 범위입니다.':'분당 100~120회를 유지하세요.',d.rate>=100&&d.rate<=120],
    ['압박 위치',d.position>=80?'위치 정확도가 양호합니다.':'손의 압박 위치를 점검하세요.',d.position>=80],
    ['흉부 이완',d.recoil>=80?'이완 상태가 양호합니다.':'압박 후 완전히 이완하세요.',d.recoil>=80],
    ['인공호흡',d.breaths===2?'2회 수행으로 기록되었습니다.':'인공호흡 횟수를 확인하세요.',d.breaths===2]
  ];
  feedback.innerHTML = notes.map(([name,message,ok]) => `
    <div class="feedback-row">
      <span class="feedback-symbol ${ok?'':'warning'}" aria-hidden="true">${ok?'✓':'!'}</span>
      <strong>${name}</strong>
      <span class="feedback-text">${message}</span>
      <span class="feedback-status ${ok?'ok':'warn'}">${ok?'양호':'개선 필요'}</span>
    </div>`).join('');
  drawChart(d.depth);
}
select.addEventListener('change',render);
render();

// BLE 수신 모듈이 교육생 데이터를 갱신할 때 호출합니다.
window.applyCPRResults = function (incoming) {
  const normalized = {};
  for (const trainee of ['A','B']) {
    const item = incoming?.[trainee];
    if (!item) continue;
    const depth = Array.isArray(item.depth) ? item.depth.map(Number).filter(Number.isFinite) : [];
    if (!depth.length || depth.length > 5000) throw new Error(`${trainee}의 압박 깊이 데이터가 올바르지 않습니다.`);
    const fields = ['rate','position','recoil','breaths'];
    if (fields.some(key => !Number.isFinite(Number(item[key])))) throw new Error(`${trainee}의 평가 데이터가 올바르지 않습니다.`);
    normalized[trainee] = {
      depth, rate: Number(item.rate), position: Number(item.position),
      recoil: Number(item.recoil), breaths: Number(item.breaths), cycles: Number(item.cycles || 1)
    };
  }
  if (!Object.keys(normalized).length) throw new Error('교육생 데이터가 없습니다.');
  students = { ...students, ...normalized };
  render();
  window.dispatchEvent(new CustomEvent('cprresultsupdated'));
};
window.getCPRResults = () => JSON.parse(JSON.stringify({A:students.A?._rawPrototype?null:students.A,B:students.B?._rawPrototype?null:students.B}));

// 선택된 교육생의 표시 데이터를 지워 다른 교육생 기록이 남지 않도록 합니다.
window.clearCPRResult = function(role) {
  if (role !== 'A' && role !== 'B') return;
  students[role] = null;
  render();
  window.dispatchEvent(new CustomEvent('cprresultsupdated'));
};

// Only show the scanned student's raw BLE data in the existing metric cards.
window.applyRawStudentPreview=function(role,stats){
  if(!['A','B'].includes(role))return;
  if(!stats||!(Number(stats.fsrSamples)>0||Number(stats.tofSamples)>0)){
    students[role]=null;
  }else{
    students[role]={_rawPrototype:stats};
  }
  if(select.value===role)render();
  window.dispatchEvent(new CustomEvent('xionrawpreviewupdated'));
};
