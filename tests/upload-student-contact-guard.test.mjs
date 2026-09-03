// 학생 명렬을 다시 올릴 때 생년월일·연락처가 지워지지 않는지.
//
// 실제로 지워졌다. '⬇️ 엑셀 다운로드'로 받은 파일에는 생년월일·연락처가 비어
// 있다 — 그 값들은 studentsContact 문서에 있고 목록은 students 문서만 읽기
// 때문이다. 그런데 화면 안내는 '다운로드 → 수정 → 재업로드' 라고 적혀 있었고,
// 저장은 통째로 덮어쓰기였다. 전교생의 생일과 번호가 한 번에 날아갔고, 워커가
// 생일로 학부모 본인 확인을 하기 때문에 상담예약이 전부 NOT_FOUND 가 됐다.
// Spark 요금제라 시점 복구가 없어 되돌릴 수단은 백업 파일뿐이었다.
//
// 여기서는 실제 화면에 파일을 올려 저장까지 눌러 보고, **무엇이 저장됐는지를
// 값으로** 본다. 그리고 백업 파일로 되돌리는 길도 실제로 눌러 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const HTML = import.meta.dirname + '/../upload.html';
const XLSXJS = import.meta.dirname + '/../node_modules/xlsx/dist/xlsx.full.min.js';
const TMP = fs.mkdtempSync('/tmp/stguard-');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

// 지금 저장돼 있는 것 — 24명, 모두 생일이 있고 20명은 번호가 있다
const N = 24;
const ALL = Array.from({ length: N }, (_, i) => ({
  grade: String(1 + (i % 3)),
  room:  String(1 + ((i / 3) | 0) % 2),
  num:   String(1 + i),
  name:  `학생${String(i + 1).padStart(2, '0')}`,
  birth: `2010-0${1 + (i % 9)}-1${i % 9}`,
  phone: i % 6 === 0 ? '' : `010-1000-${String(2000 + i).slice(-4)}`,
  fatherPhone: i % 4 === 0 ? `010-3000-${String(4000 + i).slice(-4)}` : '',
  motherPhone: '',
  club: ['축구','밴드','독서'][i % 3],
}));
const HAD = ALL.filter(s => s.birth || s.phone || s.fatherPhone).length;   // 24
// 명렬 문서(students/main)에는 연락처가 안 실린다 — 화면 목록이 읽는 것
const ROSTER  = ALL.map(({ birth, phone, fatherPhone, motherPhone, ...r }) =>
                        ({ ...r, hasPhone: !!phone }));
const CONTACT = ALL.map(s => ({ grade: s.grade, room: s.room, num: s.num,
  ...(s.birth ? { birth: s.birth } : {}), ...(s.phone ? { phone: s.phone } : {}),
  ...(s.fatherPhone ? { fatherPhone: s.fatherPhone } : {}) }));

const HEAD = ['학년','반','번호','이름','생년월일','학생연락처','부연락처','모연락처','동아리'];
function xlsxFile(name, rows) {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '학생');
  const f = path.join(TMP, name);
  XLSX.writeFile(wb, f);
  return f;
}
// ① 내려받아 고친 파일 — 생일·연락처가 전부 비어 있고, 전출 1명 · 전입 1명
const edited = ALL.slice(0, N - 1).map(s =>
  [s.grade, s.room, s.num, s.name, '', '', '', '', s.club]);
edited.push(['3','2','99','전입생','','','','','독서']);
const FILE_BLANK = xlsxFile('blank.xlsx', edited);
// ② 한 명만 번호를 고친 파일 — 나머지는 그대로 비어 있다
const oneEdit = edited.map(r => r.slice());
oneEdit[2][5] = '010-9999-8888';
const FILE_ONE = xlsxFile('one.xlsx', oneEdit);
// ③ 한 명은 번호를 정말 지우려고 '-' 를 적었다
const oneClear = edited.map(r => r.slice());
oneClear[1][5] = '-';
const FILE_CLEAR = xlsxFile('clear.xlsx', oneClear);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const NOISE = /favicon|ServiceWorker|ERR_CONNECTION|net::ERR_FAILED/;

async function openPage() {
  const page = await b.newPage();
  page.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
  await page.route('https://cdnjs.cloudflare.com/**', r =>
    /xlsx/.test(r.request().url())
      ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(XLSXJS, 'utf8') })
      : r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://www.gstatic.com/firebasejs/**', route => {
    const u = route.request().url();
    let body = 'export {};';
    if (u.includes('firebase-app'))  body = 'export const initializeApp=()=>({});';
    if (u.includes('firebase-auth')) body = `export const getAuth=()=>({currentUser:{email:'pkh910518@yeungnam.hs.kr'}});
      export const onAuthStateChanged=(a,cb)=>setTimeout(()=>cb({email:'pkh910518@yeungnam.hs.kr'}),0);
      export const signInWithPopup=async()=>{}; export const GoogleAuthProvider=function(){}; export const signOut=async()=>{};`;
    if (u.includes('firebase-firestore')) body = `
      export const getFirestore=()=>({});
      export const doc=(d,c,i)=>({coll:c,id:i});
      export const collection=()=>({});
      export const getDocs=async()=>({docs:[],empty:true,forEach(){}});
      window.__writes = [];
      const put=(c,i,d)=>{ window.__writes.push([c,i,d]);
        if (c==='students' && i==='main') window.__ROSTER = d.students;
        if (c==='studentsContact' && i==='main') window.__CONTACT = d.students; };
      export const setDoc=async(r,d)=>put(r.coll,r.id,d);
      export const deleteDoc=async()=>{};
      export const getDoc=async r=>{
        if (r.coll==='students') return { exists:()=>true,
          data:()=>({students: window.__ROSTER, updatedAt:'옛날'}) };
        if (r.coll==='studentsContact') return { exists:()=>true,
          data:()=>({students: window.__CONTACT}) };
        return { exists:()=>false, data:()=>({}) };
      };
      export const writeBatch=()=>({ set(c,d){ put(c.coll,c.id,d); }, async commit(){} });`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  await page.addInitScript(([r, c]) => { window.__ROSTER = r; window.__CONTACT = c; },
                           [ROSTER, CONTACT]);
  await page.goto('file://' + HTML, { waitUntil: 'networkidle' });
  await page.click('[data-tab="students"]');
  await page.waitForSelector('#stDbList .db-item', { timeout: 20000 });
  await page.evaluate(() => { window.__writes = []; });
  return page;
}

const pg = await openPage();
const saved = () => pg.evaluate(() => ({ roster: window.__ROSTER, contact: window.__CONTACT }));
const writes = () => pg.evaluate(() => window.__writes.map(w => [w[0], w[1]]));
const status = () => pg.$eval('#stStatus', e => e.innerText.replace(/\s+/g, ' ').trim());
const upload = async file => {
  await pg.setInputFiles('#stFileInput', file);
  await pg.waitForSelector('#stPreviewWrap:not([style*="display: none"])');
  await pg.waitForTimeout(150);
};

console.log('\n■ 화면 목록은 생일·번호를 안 받는다');
{
  const shown = await pg.$eval('#stDbList', e => e.innerText);
  check('번호가 목록에 안 실린다', !/010-1000/.test(shown), shown.slice(0,120));
  check(`${N}명이 보인다`, (await pg.$$eval('#stDbList .db-item', e => e.length)) === N);
}

console.log('\n■ 빈 칸은 저장된 값을 지우지 않는다 — 이게 안 돼서 사고가 났다');
{
  await upload(FILE_BLANK);
  check('지워진다는 경고가 안 뜬다(빈 칸은 보존되므로)',
        !(await pg.isVisible('#stWipeWarn')));
  await pg.click('#stUploadBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  await pg.waitForTimeout(200);

  const s = await saved();
  check('두 문서가 함께 저장된다',
        JSON.stringify(await writes()) ===
        JSON.stringify([['students','main'], ['studentsContact','main']]), await writes());
  const kept = s.contact.filter(c => c.birth).length;
  check(`생년월일이 남아 있다 (${N - 1}명)`, kept === N - 1, { kept });
  const phones = s.contact.filter(c => c.phone).length;
  check('학생 번호가 남아 있다', phones === ALL.slice(0, N-1).filter(x => x.phone).length, { phones });
  check('부 연락처도 남아 있다',
        s.contact.filter(c => c.fatherPhone).length ===
        ALL.slice(0, N-1).filter(x => x.fatherPhone).length);
  check('전입생은 빈 채로 들어간다',
        !!s.roster.find(x => x.name === '전입생')
        && !s.contact.find(c => c.num === '99' && (c.birth || c.phone)));
  check('전출생은 빠진다', !s.roster.find(x => x.name === `학생${String(N).padStart(2,'0')}`));
  check('동아리 같은 명렬 값은 그대로', s.roster[0].club === ALL[0].club, s.roster[0]);
}

console.log('\n■ 적은 사람만 바뀐다');
{
  await pg.evaluate(() => { window.__writes = []; });
  await pg.click('#stClearBtn');
  await upload(FILE_ONE);
  await pg.click('#stUploadBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  await pg.waitForTimeout(200);
  const s = await saved();
  const c = s.contact.find(x => x.num === ALL[2].num && x.grade === ALL[2].grade);
  check('고친 사람은 새 번호', c.phone === '010-9999-8888', c);
  const other = s.contact.find(x => x.num === ALL[1].num && x.grade === ALL[1].grade);
  check('안 고친 사람은 그대로', other.phone === ALL[1].phone, other);
}

console.log("\n■ 정말 지우려면 '-' 를 적는다");
{
  await pg.evaluate(() => { window.__writes = []; });
  await pg.click('#stClearBtn');
  await upload(FILE_CLEAR);
  const warned = await pg.isVisible('#stWipeWarn');
  check('지워지는 사람이 있으면 경고가 뜬다', warned);
  await pg.click('#stUploadBtn');
  await pg.waitForTimeout(300);
  check('확인 전에는 저장되지 않는다', (await writes()).length === 0, await writes());
  const st = await status();
  check('무엇을 해야 하는지 알려 준다', /체크/.test(st), st);

  await pg.check('#stWipeOk');
  await pg.click('#stUploadBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  await pg.waitForTimeout(200);
  const s = await saved();
  const c = s.contact.find(x => x.num === ALL[1].num && x.grade === ALL[1].grade);
  check("'-' 적은 사람만 번호가 지워진다", !c.phone, c);
  check('생일은 그대로 남는다', !!c.birth, c);
}

console.log('\n■ 백업 파일로 되돌린다 — 시점 복구가 없으니 이게 유일한 길이다');
{
  await pg.evaluate(() => { window.__writes = []; });
  // 파일 이름은 아스키로 둔다. 한글 이름이면 setInputFiles 가 조용히 아무것도
  // 안 넣는다(브라우저 문제가 아니라 시험 도구 쪽 한계다).
  const BK = path.join(TMP, 'backup.json');
  fs.writeFileSync(BK, JSON.stringify({
    savedAt: '2026-09-01T09:00:00.000Z', students: ROSTER, studentsContact: CONTACT }));
  await pg.setInputFiles('#stRestoreInput', BK);
  await pg.waitForFunction(
    () => document.getElementById('stRestoreBox').style.display !== 'none', { timeout: 10000 });
  const info = await pg.$eval('#stRestoreInfo', e => e.innerText.replace(/\s+/g,' '));
  check('무엇이 들어 있는지 먼저 보여 준다',
        new RegExp(`${N}명`).test(info) && new RegExp(`${HAD}명`).test(info), info);

  await pg.click('#stRestoreBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  await pg.waitForTimeout(200);
  const s = await saved();
  check('명단이 되돌아온다', s.roster.length === N, s.roster.length);
  check('생년월일이 되돌아온다', s.contact.filter(c => c.birth).length === N);
  check('연락처가 되돌아온다',
        s.contact.filter(c => c.phone).length === ALL.filter(x => x.phone).length);
  check('전출됐던 학생도 돌아온다',
        !!s.roster.find(x => x.name === `학생${String(N).padStart(2,'0')}`));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,5).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail || errs.length ? 1 : 0);
