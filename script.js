// 데이터는 BLE로 수신하기 전까지 비어 있습니다.
let students = { A: null, B: null };
const metrics = document.getElementById('metrics');
const feedback = document.getElementById('feedback');
const select = document.getElementById('student');

// 기존 Canvas 그래프의 5~6cm 권장 영역과 측정값을 유지합니다.
function drawChart(values) {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, p = 48, min = 0, max = 8;
  const y = v => h-p-(v-min)/(max-min)*(h-2*p);
  const x = i => p+i*(w-2*p)/Math.max(1,values.length-1);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#FFE4EC';
  ctx.fillRect(p,y(6),w-2*p,y(5)-y(6));
  ctx.strokeStyle = '#FFE4EC';
  ctx.lineWidth = 1;
  ctx.font = '15px Arial';
  ctx.fillStyle = '#A56C68';
  for(let v=0;v<=8;v+=1) {
    ctx.beginPath(); ctx.moveTo(p,y(v)); ctx.lineTo(w-p,y(v)); ctx.stroke();
    ctx.fillText(v.toFixed(1),8,y(v)+5);
  }
  if (!values.length) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Noto Sans KR", Arial';
    ctx.fillStyle = '#B48A87';
    ctx.fillText('교육 결과를 불러오면 그래프가 표시됩니다.', w / 2, h / 2);
    ctx.textAlign = 'left';
    return;
  }
  ctx.strokeStyle = '#FF4D4F';
  ctx.lineWidth = 3;
  ctx.beginPath();
  values.forEach((v,i) => i ? ctx.lineTo(x(i),y(v)) : ctx.moveTo(x(i),y(v)));
  ctx.stroke();
  values.forEach((v,i) => {
    ctx.beginPath(); ctx.arc(x(i),y(v),5,0,Math.PI*2);
    ctx.fillStyle = '#FF4D4F'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.fillStyle = '#A56C68';
  const maxLabels=Math.max(2,Math.floor((w-2*p)/44));
  const tickStep=Math.max(1,Math.ceil(values.length/maxLabels));
  ctx.textAlign='center';
  values.forEach((_,i) => {if(i===0||i===values.length-1||(i+1)%tickStep===0)ctx.fillText(String(i+1),x(i),h-14);});
  ctx.textAlign='left';
}

function render() {
  const d = students[select.value];
  // Measured BLE metrics; no fabricated percentages.
  if (d && d._rawPrototype) {
    const r=d._rawPrototype;
    const n=Number(r.compressionCount)||0;
    const peaks=Array.isArray(r.depthPeaksMm)?r.depthPeaksMm.map(v=>Number(v)/10).filter(Number.isFinite):[];
    const avg=n?Number(r.averageDepthMm)/10:null;
    const good=n?Number(r.depthCompliancePct):null;
    const recoil=n?Number(r.recoilPct):null;
    const rate=Number(r.rateCpm)||null;
    const breaths=Number(r.breathCount)||0;
    const fmt=(v,d=1)=>v===null||!Number.isFinite(v)?'—':v.toFixed(d);
    const rows=[
      ['평균 압박 깊이',fmt(avg,2),'cm','5–6 cm 권장'],
      ['압박 속도',fmt(rate,1),'회/분','압박 간격 기준, 호흡 시간 제외'],
      ['압박 위치 정확도','—','','위치 센서 평가 미구현'],
      ['깊이 기준 충족률',fmt(good,1),'%','5~6 cm / 유효 압박 횟수'],
      ['완전 이완 비율',fmt(recoil,1),'%','1 cm 이하 이완 후 재압박'],
      ['인공호흡 횟수',String(breaths),'회','']
    ];
    metrics.innerHTML=rows.map(([label,v,unit,hint],i)=>`<article class="metric" style="--accent:#FF4D4F;--bubble:#FFE4EC;--tint:#FFF5F5"><div class="metric-icon">${['↕','◴','◎','▥','♧','♡'][i]}</div><span>${label}</span><strong>${v} <small>${unit}</small></strong><em>${hint}</em></article>`).join('');
    const notes=[
      ['압박 깊이',avg===null?'압박 기록이 없습니다.':avg<5?'압박 깊이가 부족합니다. 더 깊게 누르세요.':avg<=6?'평균 압박 깊이가 적절합니다.':'압박이 너무 깊습니다. 조금 덜 누르세요.'],
      ['압박 속도',rate===null?'연속 압박 간격이 부족해 계산할 수 없습니다.':rate<100?'속도를 높이세요.':rate<=120?'압박 속도가 적절합니다.':'압박 속도를 늦추세요.'],
      ['압박 위치','압박 위치 정확도는 아직 측정하지 않습니다.'],
      ['완전 이완',recoil===null?'압박 기록이 없습니다.':`이완 충족률 ${fmt(recoil,1)}% — 매 압박 후 1 cm 이하로 이완하세요.`],
      ['인공호흡',`${breaths}회 감지되었습니다. 30:2 사이클마다 2회 실시하세요.`]
    ];
    feedback.innerHTML=notes.map(([k,v])=>`<div class="feedback-row"><strong>${k}</strong><span class="feedback-text">${v}</span></div>`).join('');
    drawChart(peaks);
    return;
  }
  const avg = d ? d.depth.reduce((a,b)=>a+b,0)/d.depth.length : null;
  const good = d ? d.depth.filter(v=>v>=5&&v<=6).length/d.depth.length*100 : null;
  const items = [
    { label:'평균 압박 깊이', value:d ? avg.toFixed(2) : '-', unit:'cm', hint:'목표 5~6 cm', icon:'↕', accent:'#C7001E', bubble:'#FFE4EC', tint:'#FFF5F5' },
    { label:'압박 속도', value:d ? d.rate : '-', unit:'회/분', hint:'목표 100~120 회/분', icon:'◴', accent:'#FF6B6B', bubble:'#FFE4EC', tint:'#FFF5F5' },
    { label:'압박 위치 정확도', value:d ? d.position : '-', unit:'%', hint:'압박 위치 평가', icon:'◎', accent:'#d53e68', bubble:'#ffe8ee', tint:'#fff0f3' },
    { label:'깊이 기준 충족률', value:d ? good.toFixed(0) : '-', unit:'%', hint:'기준 내 압박 비율', icon:'▥', accent:'#B14B45', bubble:'#efebff', tint:'#f3f0ff' },
    { label:'완전 이완 비율', value:d ? d.recoil : '-', unit:'%', hint:'압박 위치 평가', icon:'♧', accent:'#cc5a28', bubble:'#ffede4', tint:'#fff3e9' },
    { label:'인공호흡 횟수', value:d ? d.breaths : '-', unit:'회', hint:'인공호흡 감지 횟수', icon:'♡', accent:'#FF6B6B', bubble:'#e1f2ff', tint:'#FFF5F5' }
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
  if(!stats||!(Number(stats.fsrSamples)>0||Number(stats.tofSamples)>0||Number(stats.compressionCount)>0)){
    students[role]=null;
  }else{
    students[role]={_rawPrototype:stats};
  }
  if(select.value===role)render();
  window.dispatchEvent(new CustomEvent('xionrawpreviewupdated'));
};
