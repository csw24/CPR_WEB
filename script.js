// 시연용 데이터입니다. 실제 센서값이 아닙니다.
let students = {
  A: { depth: [5.1,5.4,5.2,5.6,5.5,5.3,5.7,5.4,5.2,5.5], rate: 110, position: 92, recoil: 90, breaths: 2, cycles: 1 },
  B: { depth: [4.4,4.8,5.0,4.7,5.1,4.9,4.6,5.2,4.8,5.0], rate: 128, position: 76, recoil: 70, breaths: 1, cycles: 1 }
};
const metrics = document.getElementById('metrics');
const feedback = document.getElementById('feedback');
const select = document.getElementById('student');

// 기존 Canvas 그래프의 5~6cm 권장 영역과 측정값을 유지합니다.
function drawChart(values) {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, p = 48, min = 4, max = 6.5;
  const y = v => h-p-(v-min)/(max-min)*(h-2*p);
  const x = i => p+i*(w-2*p)/(values.length-1);
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
  const avg = d.depth.reduce((a,b)=>a+b,0)/d.depth.length;
  const good = d.depth.filter(v=>v>=5&&v<=6).length/d.depth.length*100;
  const items = [
    { label:'평균 압박 깊이', value:avg.toFixed(2), unit:'cm', hint:'목표 5~6 cm', icon:'↕', accent:'#087d79', bubble:'#d9f5f0', tint:'#e7faf6' },
    { label:'압박 속도', value:d.rate, unit:'회/분', hint:'목표 100~120 회/분', icon:'◴', accent:'#137bd1', bubble:'#e1efff', tint:'#eaf5ff' },
    { label:'압박 위치 정확도', value:d.position, unit:'%', hint:'시연용 평가 수치', icon:'◎', accent:'#d53e68', bubble:'#ffe8ee', tint:'#fff0f3' },
    { label:'깊이 기준 충족률', value:good.toFixed(0), unit:'%', hint:'기준 내 압박 비율', icon:'▥', accent:'#5745b1', bubble:'#efebff', tint:'#f3f0ff' },
    { label:'완전 이완 비율', value:d.recoil, unit:'%', hint:'시연용 평가 수치', icon:'♧', accent:'#cc5a28', bubble:'#ffede4', tint:'#fff3e9' },
    { label:'인공호흡 횟수', value:d.breaths, unit:'회', hint:'시연용 1회 사이클', icon:'♡', accent:'#137bd1', bubble:'#e1f2ff', tint:'#edf8ff' }
  ];
  metrics.innerHTML = items.map(item => `
    <article class="metric" style="--accent:${item.accent};--bubble:${item.bubble};--tint:${item.tint}">
      <div class="metric-icon" aria-hidden="true">${item.icon}</div>
      <span>${item.label}</span>
      <strong>${item.value} <small>${item.unit}</small></strong>
      <em>${item.hint}</em>
    </article>`).join('');

  // 80% 기준은 시연용 임의 기준이며 검증된 임상 기준이 아닙니다.
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

// 외부 BLE/Firebase 모듈이 교육생 데이터를 갱신할 때 호출합니다.
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
};
window.getCPRResults = () => JSON.parse(JSON.stringify(students));
