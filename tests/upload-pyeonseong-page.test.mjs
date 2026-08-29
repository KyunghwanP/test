// 편성표 탭을 실제 브라우저에서 눌러본다.
//
// 정적 검사로는 '배선이 있다'까지만 안다. 여기서는 진짜 편성표를 넣고,
// Firestore 를 가짜로 갈아끼워 '무엇이 저장되는지'를 본다.
// 이 업로드는 되돌릴 수 없으므로 저장 직전의 값이 맞는지가 전부다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML  = import.meta.dirname + '/../upload.html';
const SCRAP = '/tmp/claude-0/-home-user-ynhs/6d75d3ff-7eaa-5fb8-9dbb-3fcab9344eea/scratchpad';
const XLSXFILE = process.env.PS_FILE || SCRAP + '/pyeonseong.xlsx';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

if (!fs.existsSync(XLSXFILE)) { console.log('⚠ 편성표 파일 없음, 건너뜀'); process.exit(0); }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
// file:// 로 여는 탓에 나는 잡음은 뺀다 — 서비스워커 등록 실패와 외부 리소스 차단.
const NOISE = /favicon|ServiceWorkerRegistration|ERR_CONNECTION_RESET|net::ERR_FAILED/;
pg.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
pg.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

// cdnjs 는 이 환경에서 막혀 있다 — npm 으로 받은 같은 버전(0.18.5)을 물려준다
await pg.route('https://cdnjs.cloudflare.com/**', r =>
  /xlsx/.test(r.request().url())
    ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SCRAP + '/xlsx.full.min.js', 'utf8') })
    : r.fulfill({ contentType: 'text/javascript', body: '' }));

// Firebase 를 가짜로. 저장은 window.__saved 에 받아만 둔다.
const STU  = JSON.parse(fs.readFileSync(SCRAP + '/prev-students.json', 'utf8'));
const CONT = JSON.parse(fs.readFileSync(SCRAP + '/prev-contact.json', 'utf8'));
await pg.route('https://www.gstatic.com/firebasejs/**', route => {
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
    export const setDoc=async()=>{};
    export const deleteDoc=async()=>{};
    export const getDoc=async r=>({
      exists:()=> r.coll==='students'||r.coll==='studentsContact',
      data:()=> r.coll==='students' ? {students:window.__PREV} : (r.coll==='studentsContact' ? {students:window.__PREVC} : {})
    });
    export const writeBatch=()=>({ _w:[], set(ref,data){ this._w.push([ref,data]); },
      async commit(){ window.__saved = this._w.map(([r,d])=>[r.coll, d]); } });`;
  route.fulfill({ status:200, contentType:'text/javascript', body });
});
await pg.addInitScript(([p, c]) => { window.__PREV = p; window.__PREVC = c; }, [STU, CONT]);

await pg.goto('file://' + HTML, { waitUntil: 'networkidle' });
await pg.click('[data-tab="pyeonseong"]');
await pg.setInputFiles('#psFileInput', XLSXFILE);
await pg.waitForSelector('#psResult:not([style*="display: none"])', { timeout: 20000 });

console.log('\n■ 대조 화면');
const stats = await pg.$eval('#psStats', e => e.innerText.replace(/\n/g, ' '));
check('인원이 표시된다', /편성표 1020명/.test(stats) && /제외 55명/.test(stats), stats);
check('막는 조건 없음', (await pg.$eval('#psBlock', e => e.innerText)) === '', await pg.$eval('#psBlock', e => e.innerText));
const diff = await pg.$eval('#psDiffBox', e => e.innerText);
check('자리 변동을 보여준다', diff.length > 0, diff.slice(0, 200));
// 반이 바뀐 학생은 warn 으로만 뜬다. CSS 가 없으면 화면에서 통째로 사라진다.
check('반·번호가 바뀐 학생이 화면에 뜬다', /반·번호가 바뀜/.test(diff), diff.slice(0, 200));
check('상담예약 확인 안내가 같이 뜬다', /상담 예약이 걸려 있으면/.test(diff), diff.slice(0, 300));
check('동아리는 안 건드린다고 알린다', /동아리는 건드리지 않습니다/.test(await pg.$eval('#psFixBox', e => e.innerText)));

console.log('\n■ 백업 없이는 저장 못 한다');
check('저장 버튼이 잠겨 있다', await pg.$eval('#psSaveBtn', e => e.disabled));
check('이유를 말해 준다', /백업을 먼저/.test(await pg.$eval('#psSaveNote', e => e.innerText)));
// 잠긴 버튼은 클릭 자체가 안 먹는다(그게 맞다). 강제로 눌러도 저장이 안 되는지 본다.
await pg.$eval('#psSaveBtn', el => { el.disabled = false; el.click(); });
await pg.waitForTimeout(300);
check('잠금을 풀고 눌러도 저장되지 않는다', await pg.evaluate(() => !window.__saved));
await pg.$eval('#psSaveBtn', el => { el.disabled = true; });

console.log('\n■ 백업 → 저장');
const dl = pg.waitForEvent('download');
await pg.click('#psBackupBtn');
const file = await dl;
const backup = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
check('백업에 기존 명렬이 들어 있다', backup.students.length === STU.length, backup.students.length);
check('백업에 연락처도 들어 있다', backup.studentsContact.length === CONT.length);
check('백업 뒤 저장 버튼이 열린다', !(await pg.$eval('#psSaveBtn', e => e.disabled)));

await pg.click('#psSaveBtn');
await pg.waitForFunction(() => window.__saved, null, { timeout: 10000 });
const saved = await pg.evaluate(() => window.__saved);

console.log('\n■ 실제로 저장되는 값');
{
  const roster  = saved.find(([c]) => c === 'students')[1].students;
  const contact = saved.find(([c]) => c === 'studentsContact')[1].students;
  check('두 문서에 함께 저장한다', saved.length === 2, saved.map(([c]) => c));
  check('명렬 1020명', roster.length === 1020, roster.length);
  check('연락처도 같은 길이', contact.length === roster.length);

  check('동아리가 전원 살아남았다',
        roster.filter(s => s.club).length === STU.filter(s => s.club).length,
        { 저장후: roster.filter(s => s.club).length, 저장전: STU.filter(s => s.club).length });
  // 반이 바뀐 학생 — 자리로는 옛 기록을 못 찾는다. 여기서 동아리가 사라지면 안 된다.
  {
    const moved = STU[0];
    const now = roster.find(s => s.name === moved.name);
    check('반이 바뀐 학생도 동아리를 지켰다', now && now.club === moved.club, { moved, now });
    check('반이 바뀐 학생의 자리는 편성표 기준',
          now && `${now.grade}-${now.room}-${now.num}` !== `${moved.grade}-${moved.room}-${moved.num}`, now);
  }
  // 편성표에 연락처가 빈 학생 — DB 에 있던 번호가 지워지면 안 된다
  {
    // 연락처 문서에는 이름이 안 실린다(자리 + 연락처뿐). 자리로 찾는다.
    const key = x => `${x.grade}-${x.room}-${x.num}`;
    const nowByKey = new Map(contact.map(x => [key(x), x]));
    const keep = CONT.filter(c => c.phone === '01077770000');   // 편성표가 빈 학생들
    const lost = keep.filter(c => nowByKey.get(key(c))?.phone !== c.phone);
    check(`편성표에 없던 번호 ${keep.length}건이 안 지워졌다`, lost.length === 0, lost.slice(0, 3));
  }
  check('명렬에 연락처가 안 섞였다', roster.every(s => !s.phone && !s.birth),
        roster.filter(s => s.phone || s.birth).slice(0,2));
  check('연락처 문서에 생년월일이 있다', contact.every(c => 'birth' in c));
  check('생년월일이 전부 표준형',
        contact.every(c => !c.birth || /^\d{4}-\d{2}-\d{2}$/.test(c.birth)),
        contact.filter(c => c.birth && !/^\d{4}-\d{2}-\d{2}$/.test(c.birth)).slice(0,3));
  check('내부 임시 필드가 안 섞여 들어갔다',
        roster.every(s => !('_birthRaw' in s) && !('_phoneRaw' in s))
        && contact.every(c => !('_birthRaw' in c) && !('_phoneRaw' in c)),
        roster.filter(s => '_birthRaw' in s).slice(0,1));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,5).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
