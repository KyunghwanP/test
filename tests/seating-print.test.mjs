// 인쇄가 정말 A4 한 장인지 — 학급 인원과 자리판 크기를 바꿔가며 PDF 페이지 수를 센다.
//
// 이건 인쇄해봐야 아는 종류라 눈으로는 못 잡는다. 실제로 두 번 놓쳤다.
//  · 줄이 많으면 줄 간격만으로 종이를 넘겼다
//  · 명렬표를 안 그린 채로 재서 '전부 한 장'이라는 거짓 통과가 났다
import { chromium } from 'playwright';
import fs from 'node:fs';
const PAGE = import.meta.dirname + '/../seating.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
await pg.route('https://www.gstatic.com/firebasejs/**', route => {
  const u = route.request().url();
  let body = 'export {};';
  if (u.includes('firebase-app'))  body = 'export const initializeApp = () => ({});';
  if (u.includes('firebase-auth')) body = `export const getAuth=()=>({});
    export const onAuthStateChanged=(a,cb)=>setTimeout(()=>cb({email:'kim@yeungnam.hs.kr'}),0);`;
  if (u.includes('firebase-firestore')) body = `
    const STU=Array.from({length:+(new URL(location.href).searchParams.get('n')||40)},(_,i)=>({grade:2,room:3,num:i+1,name:'학생'+(i+1)}));
    export const getFirestore=()=>({}); export const doc=(d,c,i)=>({coll:c,id:i});
    export const getDoc=async r=>r.coll==='students'?{exists:()=>true,data:()=>({students:STU})}:{exists:()=>false,data:()=>({})};
    export const setDoc=async()=>{};`;
  route.fulfill({ status:200, contentType:'text/javascript', body });
});
const RESULTS = [];
for (const [cols, rows, n] of [[6,6,32],[4,8,32],[4,10,32],[3,11,32],[6,7,40],[4,10,40],[6,10,40],[8,5,40],[5,7,33]]) {
  await pg.goto(`file://${PAGE}?class=2-3&hr=2-3&n=${n}`, { waitUntil:'networkidle' });
  await pg.waitForFunction(() => document.querySelectorAll('.seat').length > 0);
  await pg.fill('#nCols', String(cols)); await pg.dispatchEvent('#nCols','change');
  await pg.fill('#nRows', String(rows)); await pg.dispatchEvent('#nRows','change');
  await pg.evaluate(m => { for (const s of document.querySelectorAll('#rosterEdit .x')) {} }, null);
  await pg.click('#bOrder');
  await pg.fill('#memo', '청소: 1분단 교실 · 2분단 복도\n다음 자리바꾸기: 10월 첫 주');
  await pg.evaluate(() => window.__buildPrintExtras());
  await pg.evaluate(() => { const m=document.getElementById('memoPrint');
    m.textContent=document.getElementById('memo').value; m.style.display='block'; });
  const buf = await pg.pdf({ format:'A4', landscape:true, printBackground:false });
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const seated = await pg.$$eval('.seat .s-name', e => e.length);
  const rcols = await pg.$$eval('.pr-tbl', e => e.length);
  RESULTS.push({ n, cols, rows, pages });
  console.log(`  ${n}명 · ${cols}분단 × ${rows}줄 (${seated} 착석, 명렬 ${rcols}단) → ${pages}장 ${pages===1?'✅':'❌'}`);
}
let bad = 0;
for (const r of RESULTS) if (r.pages !== 1) bad++;
console.log(`\n${bad ? '❌' : '✅'} ${RESULTS.length}가지 조합 중 한 장이 아닌 것 ${bad}개`);

// 비고 칸 — 임무가 없는 줄에도 선이 그어져 있어야 손으로 적는다.
// 한 번 놓쳤다: 칸 이름을 note 로 두는 바람에 화면 쪽 .note:empty{display:none}
// 에 걸려, 임무가 빈 줄은 칸이 통째로 사라지고 선도 같이 없어졌다.
console.log('\n■ 비고 칸');
await pg.goto(`file://${PAGE}?class=2-3&hr=2-3&n=8`, { waitUntil:'networkidle' });
await pg.waitForFunction(() => document.querySelectorAll('.seat').length > 0);
await pg.evaluate(() => {                       // 1번만 임무를 적는다 — 나머지는 빈칸
  const i = document.querySelector('[data-duty]');
  i.value = '칠판'; i.dispatchEvent(new Event('change', { bubbles:true }));
});
await pg.evaluate(() => window.__buildPrintExtras());
await pg.emulateMedia({ media:'print' });
const rmk = await pg.$$eval('.pr-tbl tr', trs => trs.slice(1).map(tr => {
  const c = tr.children[2];
  if (!c) return { missing:true };
  const cs = getComputedStyle(c);
  return { text:c.textContent, disp:cs.display, w:c.getBoundingClientRect().width,
           bw:parseFloat(cs.borderBottomWidth), fs:cs.fontSize };
}));
const cells = await pg.$$eval('.pr-tbl tr td.rmk', e => e.length);
const filled = rmk.filter(c => c.text === '칠판').length;
const drawn  = rmk.filter(c => !c.missing && c.disp !== 'none' && c.w > 20 && c.bw > 0).length;
const big    = rmk.filter(c => parseFloat(c.fs) > 13).length;
const ck = (n, ok, x) => { if (!ok) bad++; console.log(`  ${ok?'✅':'❌'} ${n}`,
  ok ? '' : '\n       → ' + JSON.stringify(x).slice(0,300)); };
ck('학생 수만큼 비고 칸이 있다', cells === 8 && rmk.length === 8, { cells, rows: rmk.length });
ck('임무를 적은 줄엔 임무가 찍힌다', filled === 1, rmk.map(c => c.text));
ck('임무가 없어도 모든 줄에 선이 있다', drawn === 8, rmk);
ck('명렬 글씨 크기를 벗어나지 않는다', big === 0, rmk.map(c => c.fs));
await pg.emulateMedia({ media:'screen' });

console.log(`\n${bad ? '❌' : '✅'} 실패 ${bad}개`);
await b.close();
process.exit(bad ? 1 : 0);
