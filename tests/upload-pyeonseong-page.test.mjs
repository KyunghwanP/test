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
const errs = [];
// file:// 로 여는 탓에 나는 잡음은 뺀다 — 서비스워커 등록 실패와 외부 리소스 차단.
const NOISE = /favicon|ServiceWorkerRegistration|ERR_CONNECTION_RESET|net::ERR_FAILED/;

// Firebase 를 가짜로. 쓰기는 window.__writes 에 순서대로 받아만 둔다.
const STU  = JSON.parse(fs.readFileSync(SCRAP + '/prev-students.json', 'utf8'));
const CONT = JSON.parse(fs.readFileSync(SCRAP + '/prev-contact.json', 'utf8'));

// 시나리오마다 새 페이지가 필요하다(한 번 저장하면 상태가 더러워진다).
async function openPage() {
  const page = await b.newPage();
  page.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

  // cdnjs 는 이 환경에서 막혀 있다 — npm 으로 받은 같은 버전(0.18.5)을 물려준다
  await page.route('https://cdnjs.cloudflare.com/**', r =>
    /xlsx/.test(r.request().url())
      ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(SCRAP + '/xlsx.full.min.js', 'utf8') })
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
      export const setDoc=async(r,d)=>{ window.__writes.push(['setDoc', r.coll, r.id, d]); };
      export const deleteDoc=async r=>{ window.__writes.push(['deleteDoc', r.coll, r.id]); };
      export const getDoc=async r=>({
        exists:()=> r.coll==='students'||r.coll==='studentsContact',
        data:()=> r.coll==='students' ? {students:window.__PREV} : (r.coll==='studentsContact' ? {students:window.__PREVC} : {})
      });
      export const writeBatch=()=>({ _w:[], set(ref,data){ this._w.push([ref,data]); },
        async commit(){ window.__saved = this._w.map(([r,d])=>[r.coll, d]);
                        for (const [r,d] of this._w) window.__writes.push(['batch', r.coll, r.id, d]); } });`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  await page.addInitScript(([p, c]) => { window.__PREV = p; window.__PREVC = c; }, [STU, CONT]);
  await page.goto('file://' + HTML, { waitUntil: 'networkidle' });
  await page.click('[data-tab="pyeonseong"]');
  return page;
}

const pg = await openPage();
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

console.log('\n■ 한 파일 → 세 항목');
{
  const pick = await pg.$eval('#psPickBox', e => e.innerText);
  check('세 항목이 다 뜬다',
        /명렬 갱신/.test(pick) && /선택과목/.test(pick) && /원본 파일 저장/.test(pick), pick.slice(0, 300));
  check('선택과목도 같은 파일에서 읽힌다', /1020명 · 반 33개/.test(pick), pick.slice(0, 400));
  check('학년별 과목 수를 보여준다', /1학년: 학생 343명/.test(pick), pick.slice(0, 500));
  const boxes = await pg.$$eval('#psPickBox [data-ps-item]',
    els => els.map(e => [e.dataset.psItem, e.checked, e.disabled]));
  check('셋 다 켜져 있고 막힌 게 없다',
        boxes.length === 3 && boxes.every(([, on, off]) => on && !off), boxes);
}

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
// 선택과목도 통째로 갈아치우므로 백업에 같이 담겨야 되돌릴 수 있다
check('백업에 선택과목 자리가 있다', 'electives' in backup, Object.keys(backup));
check('백업 뒤 저장 버튼이 열린다', !(await pg.$eval('#psSaveBtn', e => e.disabled)));

await pg.click('#psSaveBtn');
await pg.waitForFunction(() => /저장 완료/.test(document.getElementById('psStatus').innerText),
                         null, { timeout: 30000 });
const saved  = await pg.evaluate(() => window.__saved);
const writes = await pg.evaluate(() => window.__writes);

console.log('\n■ 세 항목이 순서대로 저장된다');
{
  const el  = writes.filter(w => w[1] === 'electives');
  const sh  = writes.filter(w => w[1] === 'docsSheets');
  const stu = writes.filter(w => w[1] === 'students' || w[1] === 'studentsContact');
  check('명렬을 썼다',       stu.length === 2, stu.map(w => w[1]));
  check('선택과목을 썼다',   el.length === 34, el.length);          // index + 반 33개
  check('선택과목 index 가 먼저', el[0] && el[0][2] === 'index', el[0]);
  check('원본 파일을 썼다',  sh.length >= 2, sh.map(w => w[2]));    // 청크 + 메타
  check('메타에 파일 이름·크기가 들어간다',
        sh.some(w => w[2] === 'list2026' && w[3] && w[3].fileName && w[3].chunks >= 1),
        sh.find(w => w[2] === 'list2026'));

  // 순서가 중요하다 — 명렬이 먼저여야 선택과목·사진이 붙을 자리가 맞는다
  const first = c => writes.findIndex(w => w[1] === c);
  check('명렬 → 선택과목 → 원본 순서',
        first('students') < first('electives') && first('electives') < first('docsSheets'),
        { students: first('students'), electives: first('electives'), docsSheets: first('docsSheets') });
  check('진행 상황이 화면에 남는다',
        /명렬 갱신[\s\S]*선택과목[\s\S]*원본 파일 저장/.test(await pg.$eval('#psProgress', e => e.innerText)),
        await pg.$eval('#psProgress', e => e.innerText));
}

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

// ── 시나리오 2: 항목을 꺼 두면 그건 저장되지 않는다 ──
console.log('\n■ 끈 항목은 저장하지 않는다');
{
  const p2 = await openPage();
  await p2.setInputFiles('#psFileInput', XLSXFILE);
  await p2.waitForSelector('#psResult:not([style*="display: none"])', { timeout: 20000 });
  await p2.uncheck('[data-ps-item="electives"]');
  check('안내에 선택과목이 빠진다',
        !/선택과목/.test(await p2.$eval('#psSaveNote', e => e.innerText)),
        await p2.$eval('#psSaveNote', e => e.innerText));
  const d2 = p2.waitForEvent('download');
  await p2.click('#psBackupBtn'); await d2;
  await p2.click('#psSaveBtn');
  await p2.waitForFunction(() => /저장 완료/.test(document.getElementById('psStatus').innerText),
                           null, { timeout: 30000 });
  const w2 = await p2.evaluate(() => window.__writes);
  check('선택과목은 한 글자도 안 썼다', w2.every(w => w[1] !== 'electives'),
        w2.filter(w => w[1] === 'electives').slice(0, 3));
  check('명렬과 원본은 저장됐다',
        w2.some(w => w[1] === 'students') && w2.some(w => w[1] === 'docsSheets'),
        [...new Set(w2.map(w => w[1]))]);
  await p2.close();
}

// ── 시나리오 3: '주소' 열이 사라진 학년이 있으면 선택과목을 막는다 ──
// 못 읽은 학년은 저장 때 '이번에 없는 반' 으로 취급돼 통째로 삭제된다.
console.log("\n■ '주소' 열을 못 찾으면 선택과목만 막고, 명렬은 살린다");
{
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.read(fs.readFileSync(XLSXFILE), { type: 'buffer' });
  const ws = wb.Sheets['2학년'];
  for (const ref of Object.keys(ws)) {                       // 2학년의 '주소' 헤더만 지운다
    if (ref[0] !== '!' && String(ws[ref].v).trim() === '주소') { ws[ref].v = '거주지'; break; }
  }
  const broken = SCRAP + '/pyeonseong-noaddr.xlsx';
  XLSX.writeFile(wb, broken);

  const p3 = await openPage();
  await p3.setInputFiles('#psFileInput', broken);
  await p3.waitForSelector('#psResult:not([style*="display: none"])', { timeout: 20000 });

  const boxes = Object.fromEntries(await p3.$$eval('#psPickBox [data-ps-item]',
    els => els.map(e => [e.dataset.psItem, { checked: e.checked, disabled: e.disabled }])));
  check('선택과목은 체크가 잠긴다', boxes.electives.disabled && !boxes.electives.checked, boxes);
  check('명렬은 그대로 켜져 있다', boxes.roster.checked && !boxes.roster.disabled, boxes);
  check('원본 저장도 그대로 켜져 있다', boxes.raw.checked && !boxes.raw.disabled, boxes);
  const pick = await p3.$eval('#psPickBox', e => e.innerText);
  check('왜 막혔는지 말해 준다', /2학년.*못 찾음/.test(pick) && /통째로 지워집니다/.test(pick),
        pick.slice(0, 500));

  const d3 = p3.waitForEvent('download');
  await p3.click('#psBackupBtn'); await d3;
  await p3.click('#psSaveBtn');
  await p3.waitForFunction(() => /저장 완료/.test(document.getElementById('psStatus').innerText),
                           null, { timeout: 30000 });
  const w3 = await p3.evaluate(() => window.__writes);
  check('선택과목을 지우지도 쓰지도 않았다', w3.every(w => w[1] !== 'electives'),
        w3.filter(w => w[1] === 'electives').slice(0, 3));
  check('명렬은 저장됐다', w3.some(w => w[1] === 'students'), [...new Set(w3.map(w => w[1]))]);
  await p3.close();
  fs.unlinkSync(broken);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,5).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
