// 독립형 회차 비교 화면. Firebase 기록은 기존 XION.myRecords()만 사용하며 변경하지 않습니다.
const $c=id=>document.getElementById(id);
const state={records:[],shown:[],first:null,last:null};
const fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
const when=r=>{const d=new Date(r.createdAt);return Number.isNaN(+d)?'날짜 미상':d.toLocaleDateString('ko-KR')+' '+d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function metrics(r){const d=r.data||{},depth=Array.isArray(d.depth)?d.depth.map(Number).filter(Number.isFinite):[];const avg=depth.length?depth.reduce((a,b)=>a+b,0)/depth.length:NaN;const pass=depth.length?depth.filter(v=>v>=5&&v<=6).length/depth.length*100:NaN;return {depth:avg,pass,rate:Number(d.rate),position:Number(d.position),recoil:Number(d.recoil),breaths:Number(d.breaths),count:depth.length};}
const valid=(n)=>Number.isFinite(n);
const items=[['pass','깊이 기준 충족률','%',1],['depth','평균 압박 깊이','cm',2],['rate','압박 속도','회/분',0],['position','압박 위치 정확도','%',0],['recoil','완전 이완 비율','%',0],['breaths','인공호흡 횟수','회',0]];
function renderTrend(rows,key,label,color){const W=760,H=245,l=48,r=22,t=20,b=44,vals=rows.map(r=>metrics(r)[key]),finite=vals.filter(valid);if(!finite.length)return '';let lo=Math.min(...finite),hi=Math.max(...finite);if(key==='pass'){lo=0;hi=100;}else{const pad=Math.max((hi-lo)*.22, key==='depth'?.25:key==='rate'?5:3);lo=Math.max(0,lo-pad);hi+=pad;}if(hi===lo)hi=lo+1;const x=i=>l+(W-l-r)*(rows.length===1?.5:i/(rows.length-1));const y=v=>t+(H-t-b)*(1-(v-lo)/(hi-lo));const pts=vals.map((v,i)=>valid(v)?`${x(i)},${y(v)}`:null);const segments=[];let current=[];for(const pt of pts){if(pt)current.push(pt);else if(current.length){segments.push(current);current=[];}}if(current.length)segments.push(current);let html=`<div class="xion-compare-panel"><h3>${label} 변화</h3><p class="xion-compare-sub">회차 순서에 따른 기록 · 마우스를 올리면 측정값 표시</p><svg class="xion-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} 회차별 추세">`;for(let j=0;j<5;j++){const v=lo+(hi-lo)*j/4,yy=y(v);html+=`<line x1="${l}" x2="${W-r}" y1="${yy}" y2="${yy}" stroke="#e8f0f6"/><text x="${l-8}" y="${yy+4}" text-anchor="end" fill="#6b88a0" font-size="12">${fmt(v,key==='depth'?1:0)}</text>`;}segments.forEach(seg=>{if(seg.length>1)html+=`<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;});vals.forEach((v,i)=>{if(valid(v))html+=`<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${color}" stroke="white" stroke-width="2"><title>${i+1}회차 ${when(rows[i])}: ${fmt(v,key==='depth'?2:1)}</title></circle>`;if(rows.length<=12||i===0||i===rows.length-1)html+=`<text x="${x(i)}" y="${H-13}" text-anchor="middle" font-size="11" fill="#6b88a0">${i+1}회</text>`;});html+='</svg></div>';return html;}
function quality(k,n){if(!valid(n))return NaN;if(k==='depth')return Math.abs(n-5.5);if(k==='rate')return n<100?100-n:n>120?n-120:0;if(k==='breaths')return NaN;return n;}
function deltaText(k,a,b,d){if(!valid(a)||!valid(b))return '<span class="xion-muted">자료 없음</span>';const diff=b-a,sign=diff>0?'+':'';let cls='xion-muted';if(k==='pass'||k==='position'||k==='recoil')cls=diff>0?'xion-good':diff<0?'xion-bad':'xion-muted';if(k==='depth'||k==='rate'){const q1=quality(k,a),q2=quality(k,b);cls=q2<q1?'xion-good':q2>q1?'xion-bad':'xion-muted';}return `<span class="${cls}">${sign}${fmt(diff,d)} ${k==='depth'?'cm':k==='rate'?'회/분':k==='breaths'?'회':'%p'}</span>`;}
function renderPair(){const a=state.shown.find(r=>r.id===$c('xionRoundA')?.value),b=state.shown.find(r=>r.id===$c('xionRoundB')?.value),target=$c('xionPairResult');if(!a||!b){target.textContent='비교할 기록을 선택해 주세요.';return;}if(a.id===b.id){target.textContent='서로 다른 두 회차를 선택해 주세요.';return;}const x=metrics(a),y=metrics(b);target.innerHTML=`<div style="overflow-x:auto"><table class="xion-delta-table"><thead><tr><th>평가 지표</th><th>선택 회차 A</th><th>선택 회차 B</th><th>변화량 (B−A)</th></tr></thead><tbody>${items.map(([k,label,unit,d])=>`<tr><th>${label}</th><td>${fmt(x[k],d)} ${unit}</td><td>${fmt(y[k],d)} ${unit}</td><td>${deltaText(k,x[k],y[k],d)}</td></tr>`).join('')}</tbody></table></div><p class="xion-compare-note">깊이는 5~6 cm 범위에 가까운 쪽, 속도는 100~120회/분 범위에 가까운 쪽을 긍정적인 변화로 표시합니다. 인공호흡 횟수는 단순 증가만으로 개선 여부를 판단하지 않습니다.</p>`;}
function render(){const source=$c('xionCompareSource').value;const user=window.XION?.user;state.shown=state.records.filter(r=>r.status==='claimed'&&r.recipientUid===user?.uid&&(source==='all'||r.source===source)&&r.data&&Array.isArray(r.data.depth)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));const rows=state.shown,body=$c('xionCompareBody');$c('xionComparePNG').disabled=!rows.length;$c('xionCompareCount').textContent=`${rows.length}개 기록 · 본인 계정의 수령 완료 기록만 표시`;if(!rows.length){body.innerHTML='<div class="xion-empty">선택한 유형의 저장된 교육 기록이 없습니다.<br>기존 교육 결과 화면에서 기록을 저장한 후 다시 확인해 주세요.</div>';return;}const m=rows.map(metrics),first=m[0],last=m[m.length-1];const avg=key=>{const arr=m.map(x=>x[key]).filter(valid);return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:NaN;};const diff=valid(first.pass)&&valid(last.pass)?last.pass-first.pass:NaN;const sourceTag=r=>`<span class="xion-source-tag">${r.source==='demo'?'가상':'BLE'}</span>`;body.innerHTML=`<div class="xion-stat-grid"><div class="xion-stat-card"><span>누적 교육 기록</span><strong>${rows.length}<small> 회</small></strong><small>선택 유형 기준</small></div><div class="xion-stat-card"><span>평균 압박 깊이</span><strong>${fmt(avg('depth'),2)}<small> cm</small></strong><small>전체 회차 평균</small></div><div class="xion-stat-card"><span>평균 깊이 충족률</span><strong>${fmt(avg('pass'))}<small> %</small></strong><small>회차별 충족률 평균</small></div><div class="xion-stat-card"><span>첫 기록 → 최근 기록</span><strong>${valid(diff)?(diff>0?'+':'')+fmt(diff):'—'}<small> %p</small></strong><small>깊이 충족률 변화</small></div></div>${renderTrend(rows,'pass','권장 깊이 5~6 cm 충족률','#0c9eaa')}${renderTrend(rows,'depth','평균 압박 깊이 (cm)','#147bd0')}${renderTrend(rows,'rate','압박 속도 (회/분)','#d17a33')}<div class="xion-compare-panel"><h3>두 회차 상세 비교</h3><p class="xion-compare-sub">날짜와 교육 유형을 확인하고 비교할 두 기록을 선택하세요.</p><div class="xion-pair-select"><label>기준 회차 A<select id="xionRoundA"></select></label><label>비교 회차 B<select id="xionRoundB"></select></label></div><div id="xionPairResult"></div></div><p class="xion-compare-note">※ 가상 데이터는 시연용입니다. 전체 보기에서 BLE 기록과 가상 기록을 함께 표시할 수 있으나, 개선 정도를 해석할 때는 같은 유형끼리 비교하세요. 지표는 교육용 참고 수치이며 의료적 판정이 아닙니다.</p>`;for(const [id,choice] of [['xionRoundA',0],['xionRoundB',rows.length-1]]){const select=$c(id);rows.forEach((r,i)=>{const opt=document.createElement('option');opt.value=r.id;opt.textContent=`${i+1}회차 · ${when(r)} · ${r.source==='demo'?'가상':'BLE'}`;select.append(opt);});select.value=rows[choice].id;select.onchange=renderPair;}renderPair();}
async function load(){ $c('xionComparePNG').disabled=true;const body=$c('xionCompareBody');body.textContent='Firebase 기록을 불러오는 중입니다…';try{await window.XION.ready;if(!window.XION.user)throw Error('로그인이 필요합니다.');state.records=await window.XION.myRecords();render();}catch(e){body.textContent='기록 조회 실패: '+e.message;}}
function show(compare){$c('xionComparePage').hidden=!compare;$c('xionOverviewPage').hidden=compare;$c('xionOverviewTab').classList.toggle('active',!compare);$c('xionCompareTab').classList.toggle('active',compare);$c('xionOverviewTab').setAttribute('aria-selected',String(!compare));$c('xionCompareTab').setAttribute('aria-selected',String(compare));if(compare)load();}
$c('xionOverviewTab').onclick=()=>show(false);$c('xionCompareTab').onclick=()=>show(true);$c('xionCompareRefresh').onclick=load;$c('xionCompareSource').onchange=render;


// PNG 보고서는 Firebase에서 본인 UID로 조회한 수령 완료 기록만 사용합니다.
// Canvas 자체로 그리므로 외부 캡처 라이브러리 없이 다운로드할 수 있습니다.
async function exportComparisonPNG(){
  const uid=window.XION?.user?.uid;
  if(!uid){alert('로그인 후 이용해 주세요.');return;}
  const records=state.shown.filter(r=>r.recipientUid===uid&&r.status==='claimed');
  if(!records.length){alert('저장할 본인 교육 기록이 없습니다.');return;}
  const a=records.find(r=>r.id===$c('xionRoundA')?.value);
  const b=records.find(r=>r.id===$c('xionRoundB')?.value);
  const canvas=document.createElement('canvas'),W=1200,H=1780;
  canvas.width=W*2;canvas.height=H*2;
  const ctx=canvas.getContext('2d');ctx.scale(2,2);
  const text=(str,x,y,size=21,color='#19324b',weight='500')=>{ctx.font=`${weight} ${size}px "Noto Sans KR","Malgun Gothic",sans-serif`;ctx.fillStyle=color;ctx.fillText(String(str),x,y);};
  const box=(x,y,w,h,color='#fff')=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,18);ctx.fill();};
  ctx.fillStyle='#eff7fb';ctx.fillRect(0,0,W,H);
  box(35,35,1130,155,'#dff3f5');text('XI:ON  ·  CPR TRAINING',70,87,22,'#087e89','700');text('나의 CPR 회차별 통계 비교',70,141,37,'#17314e','800');
  const nickname=window.XION?.profile?.nickname||'교육생';
  text(`${nickname}  |  ${new Date().toLocaleString('ko-KR')}  |  ${$c('xionCompareSource').selectedOptions[0].text}`,70,175,17,'#526f87');
  const m=records.map(metrics),avg=k=>{const v=m.map(x=>x[k]).filter(valid);return v.length?v.reduce((x,y)=>x+y,0)/v.length:NaN;};
  const diff=m.length>1?m[m.length-1].pass-m[0].pass:NaN;
  const cards=[['누적 교육 기록',`${records.length}회`],['평균 압박 깊이',`${fmt(avg('depth'),2)} cm`],['평균 깊이 충족률',`${fmt(avg('pass'),1)} %`],['첫 기록 대비 최근 기록',`${valid(diff)?(diff>0?'+':'')+fmt(diff,1)+' %p':'—'}`]];
  cards.forEach(([label,val],i)=>{const x=35+i*286;box(x,215,272,130);text(label,x+17,253,17,'#58748b','600');text(val,x+17,309,29,'#087e89','800');});
  function trend(key,title,color,y0){
    box(35,y0,1130,285);text(title,65,y0+40,23,'#19324b','700');
    const x0=110,x1=1100,top=y0+75,bottom=y0+225;
    const vals=m.map(r=>r[key]),finite=vals.filter(valid);if(!finite.length)return;
    let lo=Math.min(...finite),hi=Math.max(...finite);
    if(key==='pass'){lo=0;hi=100;}else{const pad=Math.max((hi-lo)*.2,key==='depth'?.3:5);lo=Math.max(0,lo-pad);hi+=pad;}
    if(hi<=lo)hi=lo+1;
    const xx=i=>x0+(x1-x0)*(vals.length===1?.5:i/(vals.length-1));
    const yy=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
    for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,y=yy(v);ctx.strokeStyle='#e3edf4';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x0,y);ctx.lineTo(x1,y);ctx.stroke();text(fmt(v,key==='depth'?1:0),60,y+6,15,'#6b88a0');}
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();let drawing=false;
    vals.forEach((v,i)=>{if(!valid(v)){drawing=false;return;}if(!drawing){ctx.moveTo(xx(i),yy(v));drawing=true;}else ctx.lineTo(xx(i),yy(v));});ctx.stroke();
    vals.forEach((v,i)=>{if(!valid(v))return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(xx(i),yy(v),4,0,Math.PI*2);ctx.fill();if(vals.length<=12||i===0||i===vals.length-1)text(`${i+1}회`,xx(i)-15,y0+265,14,'#6b88a0');});
  }
  trend('pass','권장 깊이 5~6 cm 충족률 (%)','#0c9eaa',370);
  trend('depth','평균 압박 깊이 (cm)','#147bd0',670);
  trend('rate','압박 속도 (회/분)','#d17a33',970);
  box(35,1270,1130,380);text('선택한 두 회차 상세 비교',65,1315,25,'#19324b','700');
  if(a&&b&&a.id!==b.id){
    text(`A: ${when(a)}    /    B: ${when(b)}`,65,1350,16,'#66849b');
    const ma=metrics(a),mb=metrics(b);
    text('평가 지표',65,1390,17,'#526f87','700');text('A 회차',530,1390,17,'#526f87','700');text('B 회차',745,1390,17,'#526f87','700');text('변화량 (B-A)',940,1390,17,'#526f87','700');
    items.forEach(([k,label,unit,d],i)=>{const y=1430+i*35;if(i%2===0){ctx.fillStyle='#f3f8fa';ctx.fillRect(58,y-25,1090,34);}text(label,65,y,17);text(`${fmt(ma[k],d)} ${unit}`,530,y,17);text(`${fmt(mb[k],d)} ${unit}`,745,y,17);const diff=mb[k]-ma[k];text(valid(diff)?`${diff>0?'+':''}${fmt(diff,d)} ${k==='depth'?'cm':k==='rate'?'회/분':k==='breaths'?'회':'%p'}`:'—',940,y,17);});
  }else{text('서로 다른 두 회차를 선택하면 상세 비교가 표시됩니다.',65,1385,19,'#66849b');}
  text('※ 본인 계정의 수령 완료 기록만 포함 · 가상 데이터는 시연용 · 의료적 판정 아님',48,1705,17,'#718da3');
  text('XI:ON  ·  CPR Training Analytics',48,1740,18,'#718da3','700');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob){alert('PNG 생성에 실패했습니다.');return;}
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`XION_회차통계비교_${new Date().toISOString().slice(0,10)}.png`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$c('xionComparePNG').addEventListener('click',()=>exportComparisonPNG().catch(e=>alert('PNG 저장 실패: '+e.message)));
window.addEventListener('xionauthchanged',()=>{state.records=[];state.shown=[];$c('xionComparePNG').disabled=true;if(!$c('xionComparePage').hidden)load();});
