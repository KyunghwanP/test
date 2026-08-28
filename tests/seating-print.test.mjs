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
await b.close();
process.exit(bad ? 1 : 0);
