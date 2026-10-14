// 운영표 업로드 — 엑셀을 읽어 appdata/operating 으로 만드는 parseOperatingExcel (upload.html).
//
// 예전에는 머리 행 위의 제목 줄에 빈 칸이 끼어 있으면(A1 제목 + H1 작성일 같은 행)
// 「Cannot read properties of undefined (reading 'replace')」 로 터졌다. 엑셀에서 읽은
// 행 배열은 빈 칸 자리가 구멍으로 남는데, .map 은 구멍을 그대로 두고 findIndex 는
// 구멍을 undefined 로 넘기기 때문이다. 여기서는 그런 파일을 실제로 만들어 올려 본다.
//
// 설치: npm i -D xlsx@0.18.5 playwright (upload.html 이 쓰는 그 버전)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import XLSX from 'xlsx';

const ROOT = import.meta.dirname + '/..';
const HTML_PATH = ROOT + '/upload.html';
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const XLSXJS = ROOT + '/node_modules/xlsx/dist/xlsx.full.min.js';
const TMP = fs.mkdtempSync('/tmp/opupload-');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

// upload.html 에서 함수를 그대로 떼어 온다 — 옮겨 적으면 원본이 바뀌어도 통과한다.
const grab = (src, name) => {
  const m = new RegExp(`^async function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(m.index, j + 1);
  }
};
const load = src => new Function('XLSX', grab(src, 'parseOperatingExcel') + '\nreturn parseOperatingExcel;')(XLSX);
const parse = load(HTML);
const tryParse = async f => { try { return await parse(asFile(f)); } catch (e) { return e; } };
const asFile = f => ({ arrayBuffer: async () => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });

// ── 운영표 만들기 ────────────────────────────────────────────────────
// 2026-08-31(월)부터 5주, 평일 25일 × 7교시. 일자·요일은 하루 첫 줄에만(병합 칸처럼).
//   9/9(수)  : 월요일 시간표로 대체 → 칸이 '월1'…'월7'
//   9/16(수) : 1학년 7교시 진로활동
//   9/23(수) : 비고 '학력평가'
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 + 25569;
const HEAD = ['주차', '일자', '요일', '교시', '1학년', '2학년', '3학년', '비고'];
function body() {
  const out = [];
  for (let k = 0, wk = 1; k < 35; k++) {
    const t = new Date(Date.UTC(2026, 7, 31 + k));
    const dw = t.getUTCDay();
    if (dw === 0 || dw === 6) { if (dw === 6) wk++; continue; }
    const iso = t.toISOString().slice(0, 10);
    const day = DAYS[dw];
    for (let p = 1; p <= 7; p++) {
      let c = `${day}${p}`;
      if (iso === '2026-09-09') c = `월${p}`;
      const g1 = iso === '2026-09-16' && p === 7 ? '진로활동' : c;
      out.push([p === 1 ? `${wk}주` : null, p === 1 ? serial(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) : null,
                p === 1 ? day : null, p, g1, c, c, iso === '2026-09-23' && p === 1 ? '학력평가' : null]);
    }
  }
  return out;
}
// 위쪽 줄들(top)은 [열 위치, 값] 목록 — 빈 칸을 건너뛰어 쓰면 행 배열에 구멍이 생긴다.
function xlsxFile(name, { top = [], head = HEAD, rows = body(), sheet = '2026학년도 2학기', col = 0 } = {}) {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  top.forEach((cells, r) => cells.forEach(([col, v]) => XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: { r, c: col } })));
  XLSX.utils.sheet_add_aoa(ws, [head, ...rows], { origin: { r: top.length, c: col } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  const f = path.join(TMP, name);
  XLSX.writeFile(wb, f);
  return f;
}
const PLAIN = xlsxFile('plain.xlsx', { top: [[[0, '2026학년도 2학기 일과표']]] });
const GAPPY = xlsxFile('gappy.xlsx', { top: [[[0, '2026학년도 2학기 수업 시수 확보 계획'], [7, '작성: 교무기획부']]] });
const DEEP  = xlsxFile('deep.xlsx', { top: [
  [[0, '수업 시수 확보 계획']], [], [[2, '※ 칸 값: 목3 = 목요일 3교시 정규표']], [[5, '1학기']], [], [], [[0, '가'], [6, '나']], [] ] });
// 표가 B열부터 — A열이 비어 머리 행 맨 앞에도 구멍이 생긴다
const SHIFTED = xlsxFile('shifted.xlsx', { top: [[[1, '2026학년도 2학기 일과표']]], col: 1 });
const SPACED = xlsxFile('spaced.xlsx', { top: [[[0, '일과표']]], head: ['주 차', '일 자', '요 일', '교 시', '1 학년', '2 학년', '3 학년', '비 고'] });
const NOHEAD = xlsxFile('nohead.xlsx', { top: [[[0, '수업 시수 확보 계획'], [6, '2026. 9.']], [[1, '월'], [3, '시수']]],
                                         head: ['학년', '과목', '시수', '확보'], rows: [[1, '국어', 68, 68]], sheet: '시수' });

// 기대값 — 25일, 9/9 대체, 9/16 진로활동, 9/23 비고
function same(name, got) {
  if (got instanceof Error) return check(`${name}: 읽힌다`, false, got.message);
  const dks = Object.keys(got.dates).sort();
  check(`${name}: 25일 (2026-08-31 ~ 2026-10-02)`, dks.length === 25 && dks[0] === '2026-08-31' && dks.at(-1) === '2026-10-02', [dks.length, dks[0], dks.at(-1)]);
  check(`${name}: 하루 7교시 · 요일이 따라간다`, dks.every(k => Object.keys(got.dates[k].cells).length === 7) && got.dates['2026-09-02'].day === '수');
  check(`${name}: 9/9 수요일 → 월요일 시간표 (요일 대체로 표시)`, got.dates['2026-09-09'].cells[3].join() === '월3,월3,월3' && got.dates['2026-09-09'].dev === true);
  check(`${name}: 9/16 1학년 7교시 진로활동`, got.dates['2026-09-16'].cells[7][0] === '진로활동' && got.dates['2026-09-16'].dev === true);
  check(`${name}: 평소 날은 대체 아님`, got.dates['2026-09-02'].dev === false && got.dates['2026-09-02'].cells[5].join() === '수5,수5,수5');
  check(`${name}: 비고`, got.dates['2026-09-23'].remark === '학력평가' && !('remark' in got.dates['2026-09-02']));
  check(`${name}: 학기 이름은 첫 시트 이름`, got.semester === '2026학년도 2학기', got.semester);
}

console.log('\n■ 원래 형식 (1행 제목, 2행 머리)');
same('원래 형식', await tryParse(PLAIN));

console.log('\n■ 제목 줄에 빈 칸이 끼어 있는 파일 — 신고된 오류');
{
  const old = execFileSync('git', ['-C', ROOT, 'show', 'acd0448:upload.html'], { encoding: 'utf8' });
  let oldErr = '';
  try { await load(old)(asFile(GAPPY)); } catch (e) { oldErr = e.message; }
  check('고치기 전 코드는 같은 파일에서 그 오류로 터졌다 (재현)', /reading 'replace'/.test(oldErr), oldErr);
  same('빈 칸 낀 제목 줄', await tryParse(GAPPY));
}

console.log('\n■ 표가 B열부터 시작해도 (머리 행 맨 앞이 빈 칸)');
same('B열부터', await tryParse(SHIFTED));

console.log('\n■ 머리 행이 아래쪽(9행)에 있어도');
same('9행 머리', await tryParse(DEEP));

console.log('\n■ 머리 칸에 띄어쓰기가 있어도 (교 시 · 1 학년)');
same('띄어쓴 머리', await tryParse(SPACED));

console.log('\n■ 형식이 다른 파일 — 무엇을 봤는지 알려 준다');
{
  let msg = '';
  try { await parse(asFile(NOHEAD)); } catch (e) { msg = e.message; }
  check('머리 행을 못 찾았다고 말한다', /헤더 행\(교시 · 1학년 · 2학년 · 3학년/.test(msg), msg);
  check('맨 위 줄을 행 번호와 함께 보여 준다', /이 파일의 첫 시트\(시수\) 맨 위:\n1행: 수업 시수 확보 계획 · 2026\. 9\.\n2행: 월 · 시수\n3행: 학년 · 과목 · 시수 · 확보/.test(msg), msg);
}

console.log('\n■ 실제 화면 — 파일을 고르면');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const NOISE = /favicon|ServiceWorker|ERR_CONNECTION|net::ERR_FAILED|ERR_CERT/;
const pg = await b.newPage();
pg.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
pg.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
await pg.route('https://cdnjs.cloudflare.com/**', r =>
  /xlsx/.test(r.request().url())
    ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(XLSXJS, 'utf8') })
    : r.fulfill({ contentType: 'text/javascript', body: '' }));
await pg.route('https://www.gstatic.com/firebasejs/**', route => {
  const u = route.request().url();
  let body = 'export {};';
  if (u.includes('firebase-app'))  body = 'export const initializeApp=()=>({});';
  if (u.includes('firebase-auth')) body = `export const getAuth=()=>({currentUser:{email:'pkh910518@yeungnam.hs.kr'}});
    export const onAuthStateChanged=(a,cb)=>setTimeout(()=>cb({email:'pkh910518@yeungnam.hs.kr'}),0);
    export const signInWithPopup=async()=>{}; export const GoogleAuthProvider=function(){}; export const signOut=async()=>{};`;
  if (u.includes('firebase-firestore')) body = `
    export const getFirestore=()=>({}); export const doc=(d,c,i)=>({coll:c,id:i}); export const collection=()=>({});
    export const getDocs=async()=>({docs:[],empty:true,forEach(){}}); export const deleteDoc=async()=>{};
    window.__writes = []; export const setDoc=async(r,d)=>{ window.__writes.push([r.coll, r.id, d]); };
    export const getDoc=async()=>({ exists:()=>false, data:()=>({}) });
    export const writeBatch=()=>({ set(c,d){ window.__writes.push([c.coll,c.id,d]); }, async commit(){} });`;
  route.fulfill({ status: 200, contentType: 'text/javascript', body });
});
await pg.goto('file://' + HTML_PATH, { waitUntil: 'networkidle' });
await pg.click('[data-tab="operating"]');
const status = () => pg.$eval('#opStatus', e => e.innerText);
{
  await pg.setInputFiles('#opFileInput', GAPPY);
  await pg.waitForFunction(() => !/분석 중/.test(document.getElementById('opStatus').textContent));
  const st = await status();
  check('빈 칸 낀 제목 줄 파일이 분석된다', /파일 분석 완료/.test(st) && /수업일: 25일 \(2026-08-31 ~ 2026-10-02\)/.test(st) && /요일 대체·특이 편성일: 2일/.test(st), st);
  check('업로드 단추가 켜진다', await pg.isEnabled('#opUploadBtn'));
  await pg.click('#opUploadBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 });
  const w = await pg.evaluate(() => window.__writes.map(x => [x[0], x[1], Object.keys(x[2].dates).length, x[2].dates['2026-09-09'].dev]));
  check('appdata/operating 에 25일이 저장된다', JSON.stringify(w) === JSON.stringify([['appdata', 'operating', 25, true]]), w);
}
{
  await pg.setInputFiles('#opFileInput', NOHEAD);
  await pg.waitForFunction(() => /실패/.test(document.getElementById('opStatus').textContent));
  const st = await status();
  check('형식이 다르면 맨 위 줄을 줄 바꿈해서 보여 준다', /1행: 수업 시수 확보 계획 · 2026\. 9\.\n2행: 월 · 시수/.test(st), st);
  check('업로드 단추는 꺼진다', !(await pg.isEnabled('#opUploadBtn')));
}
check('화면 오류 없음', errs.length === 0, errs);
await b.close();
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
