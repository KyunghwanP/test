// 교원 비상연락망을 다시 올릴 때 번호가 지워지지 않는지.
//
// '⬇️ 엑셀 다운로드'로 받은 파일에는 휴대폰이 비어 있다. 번호는 contactsPhone
// 문서에 있고 보안 규칙이 브라우저 읽기를 막아 놓았기 때문이다(워커만 읽는다).
// 그 파일을 고쳐 다시 올리면 저장이 통째로 덮어쓰기라 전 교직원의 번호가
// 한 번에 날아간다. 시점 복구가 없어(Spark) 되돌릴 수단도 없다.
//
// 번호는 못 읽지만 명렬의 hasPhone(번호가 있다/없다)은 읽힌다. 그걸로 '몇 명이
// 지워지는지'를 세서 막는다. 여기서는 실제 화면에 파일을 올려 저장까지 눌러 보고,
// **무엇이 저장됐는지를 값으로** 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const HTML = import.meta.dirname + '/../upload.html';
const XLSXJS = import.meta.dirname + '/../node_modules/xlsx/dist/xlsx.full.min.js';
const TMP = fs.mkdtempSync('/tmp/ctguard-');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

// 지금 저장돼 있는 것 — 30명 중 24명이 번호를 갖고 있다
const DEPTS = ['교무부', '학생부', '연구부', '진로부'];
const STAFF = Array.from({ length: 30 }, (_, i) => ({
  name: `교사${String(i + 1).padStart(2, '0')}`,
  dept: DEPTS[i % DEPTS.length],
  subject: ['국어','수학','영어'][i % 3],
  ext: String(2100 + i),
  role: i === 0 ? '교장' : '',
  hasPhone: i % 5 !== 0,                 // 6명은 원래 번호가 없다
}));
const HAD = STAFF.filter(s => s.hasPhone).length;   // 24

const HEAD = ['이름','담당부서','담당과목','휴대폰','내선번호','직위'];
function xlsxFile(name, rows) {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '비상연락망');
  const f = path.join(TMP, name);
  XLSX.writeFile(wb, f);
  return f;
}
// ① 내려받아 고친 파일 — 휴대폰이 전부 비어 있고, 한 명이 부서를 옮겼다
const edited = STAFF.map(s => [s.name, s.dept, s.subject, '', s.ext, s.role]);
edited[3][1] = '진로부';
edited.push(['신규교사', '교무부', '과학', '', '2199', '']);
const FILE_BLANK = xlsxFile('blank.xlsx', edited);
// ② 번호가 다 들어 있는 원본 비상연락망
const FILE_FULL = xlsxFile('full.xlsx',
  STAFF.map((s, i) => [s.name, s.dept, s.subject, s.hasPhone ? `010-0000-${String(1000+i)}` : '', s.ext, s.role]));

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
      export const setDoc=async(r,d)=>{ window.__writes.push([r.coll, r.id, d]);
        if (r.coll==='contacts' && r.id==='main') window.__STAFF = d.staff; };
      export const deleteDoc=async()=>{};
      // contactsPhone 은 규칙이 읽기를 막는다 — 실제와 같게 거부한다.
      export const getDoc=async r=>{
        if (r.coll==='contactsPhone') throw new Error('Missing or insufficient permissions.');
        return { exists:()=> r.coll==='contacts',
                 data:()=> r.coll==='contacts' ? {staff:window.__STAFF, updatedAt:'옛날'} : {} };
      };
      export const writeBatch=()=>({ set(c,d){ window.__writes.push([c.coll,c.id,d]);
          if (c.coll==='contacts' && c.id==='main') window.__STAFF = d.staff; }, async commit(){} });`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  await page.addInitScript(s => { window.__STAFF = s; }, STAFF);
  await page.goto('file://' + HTML, { waitUntil: 'networkidle' });
  await page.click('[data-tab="contacts"]');
  await page.waitForSelector('#dbList .db-item', { timeout: 20000 });
  await page.evaluate(() => { window.__writes = []; });
  return page;
}

const pg = await openPage();
const writes  = () => pg.evaluate(() => window.__writes.map(w => [w[0], w[1]]));
const written = () => pg.evaluate(() => window.__writes);
const status  = () => pg.$eval('#ctStatus', e => e.innerText.replace(/\s+/g, ' ').trim());

console.log('\n■ 화면 목록은 번호를 안 받는다');
{
  const shown = await pg.$eval('#dbList', e => e.innerText);
  check('휴대폰 자리가 비어 있다', !/010-/.test(shown));
  check(`${STAFF.length}명이 보인다`, (await pg.$$eval('#dbList .db-item', e => e.length)) === STAFF.length);
}

console.log('\n■ 번호가 빈 파일을 올리면 미리 막는다');
{
  await pg.setInputFiles('#ctFileInput', FILE_BLANK);
  await pg.waitForSelector('#ctPreviewWrap:not([style*="display: none"])');
  const st = await status();
  check('파일을 고르자마자 경고가 뜬다', /지워집니다/.test(st), st);
  check(`지워질 인원을 정확히 센다 (${HAD}명)`, new RegExp(`${HAD}명`).test(st), st);
  check('경고가 바로 지워지지 않는다', st.length > 0);

  await pg.click('#ctUploadBtn');
  await pg.waitForTimeout(300);
  check('저장을 눌러도 아무것도 안 써진다', (await writes()).length === 0, await writes());
  check('명렬만 저장 버튼이 나타난다', await pg.isVisible('#ctRosterOnlyBtn'));
}

console.log('\n■ 명렬만 저장 — 번호 문서는 손대지 않는다');
{
  await pg.click('#ctRosterOnlyBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  await pg.waitForTimeout(200);
  const w = await written();
  check('contacts/main 한 곳만 쓴다', w.length === 1 && w[0][0] === 'contacts' && w[0][1] === 'main',
        w.map(x => x[0] + '/' + x[1]));
  check('contactsPhone 은 안 건드린다', !w.some(x => x[0] === 'contactsPhone'), w.map(x => x[0]));

  const saved = w[0][2].staff;
  check('새 교사까지 저장된다', saved.length === STAFF.length + 1, saved.length);
  check('부서 변경이 반영된다', saved[3].dept === '진로부', saved[3]);
  check('번호는 파일에 없으니 안 실린다', !saved.some(s => s.phone), saved.filter(s => s.phone).slice(0,2));
  // hasPhone 이 틀어지면 앱이 전화 버튼을 안 띄우거나 헛돈다
  const keptFlags = STAFF.every(o => {
    const n = saved.find(s => s.name === o.name);
    return n && !!n.hasPhone === !!o.hasPhone;
  });
  check('번호 있음 표시가 그대로 유지된다', keptFlags,
        saved.slice(0, 6).map(s => [s.name, s.hasPhone]));
  check('새 교사는 번호 없음으로', saved.find(s => s.name === '신규교사').hasPhone === false);
  const st = await status();
  check('무엇을 안 건드렸는지 알려준다', /휴대폰은 그대로/.test(st), st);
  check('버튼이 다시 숨는다', !(await pg.isVisible('#ctRosterOnlyBtn')));
}

console.log('\n■ 번호가 든 원본은 예전처럼 저장된다');
{
  await pg.evaluate(() => { window.__writes = []; });
  await pg.setInputFiles('#ctFileInput', FILE_FULL);
  await pg.waitForTimeout(300);
  check('경고가 안 뜬다', !/지워집니다/.test(await status()), await status());
  check('명렬만 저장 버튼은 숨어 있다', !(await pg.isVisible('#ctRosterOnlyBtn')));
  // 앞 시나리오에서 '신규교사'가 저장됐다. 이 파일에는 그 사람이 없으니
  // 명단에서 빠진다 — 확인을 받는 게 맞다.
  const diff0 = await pg.$eval('#ctDiffBox', e => e.innerText.replace(/\s+/g,' ').trim());
  check('앞서 넣은 신규교사가 빠지는 것을 짚어 준다',
        /명단에서 사라짐 1명/.test(diff0) && diff0.includes('신규교사'), diff0);
  await pg.check('#ctConfirmDel');

  await pg.click('#ctUploadBtn');
  await pg.waitForFunction(() => window.__writes.length >= 2, { timeout: 10000 });
  const w = await written();
  const colls = w.map(x => x[0]);
  check('명렬과 번호를 함께 쓴다', colls.includes('contacts') && colls.includes('contactsPhone'), colls);
  const phones = w.find(x => x[0] === 'contactsPhone')[2].staff;
  check(`번호가 있는 ${HAD}명분이 저장된다`, phones.filter(p => p.phone).length === HAD,
        phones.filter(p => p.phone).length);
  check('번호 문서에도 찾을 이름·부서가 있다', phones.every(p => p.name && p.dept !== undefined));
}

console.log('\n■ 몇 명만 든 파일을 올리면 나머지가 지워진다는 것을 알린다');
{
  // 실제로 겪은 일 — 2명짜리 파일을 올려 30명이 2명이 됐다. 경고도 없었다.
  const partial = xlsxFile('partial.xlsx', [
    [STAFF[2].name, STAFF[2].dept, '국어', '010-1111-2222', '2102', ''],
    [STAFF[6].name, '학생부',      '수학', '010-3333-4444', '2106', ''],
  ]);
  await pg.evaluate(() => { window.__writes = []; });
  await pg.setInputFiles('#ctFileInput', partial);
  await pg.waitForSelector('#ctPreviewWrap:not([style*="display: none"])');
  await pg.waitForTimeout(200);

  const diff = await pg.$eval('#ctDiffBox', e => e.innerText.replace(/\s+/g, ' ').trim());
  check('사라지는 인원을 센다', new RegExp(`명단에서 사라짐 ${STAFF.length - 2}명`).test(diff), diff);
  // 교사07 은 부서만 옮겼다. 이름이 그대로면 사라진 게 아니다.
  check('부서만 옮긴 사람은 사라짐/새로 들어옴이 아니다', !/새로 들어옴/.test(diff), diff);
  check('사라지는 사람을 이름으로 보여 준다', diff.includes(STAFF[0].name) && diff.includes(STAFF[1].name), diff);
  check('남는 사람은 사라짐에 없다', !new RegExp(`사라짐[^새]*${STAFF[2].name}\\(`).test(diff), diff);
  check('확인란이 뜬다', await pg.isVisible('#ctConfirmWrap'));
  const ctext = await pg.$eval('#ctConfirmText', e => e.innerText.replace(/\s+/g,' '));
  check('몇 명 → 몇 명인지 밝힌다', new RegExp(`${STAFF.length}명 → 2명`).test(ctext), ctext);

  await pg.click('#ctUploadBtn');
  await pg.waitForTimeout(300);
  check('확인 전에는 저장되지 않는다', (await writes()).length === 0, await writes());
  check('무엇을 하라고 알려 준다', /확인란/.test(await status()), await status());

  // 명렬만 저장도 같은 확인을 거쳐야 한다 — 여기서도 사람은 지워진다
  await pg.evaluate(() => { document.getElementById('ctRosterOnlyBtn').style.display = ''; });
  await pg.click('#ctRosterOnlyBtn');
  await pg.waitForTimeout(300);
  check('명렬만 저장도 막힌다', (await writes()).length === 0, await writes());

  // 퇴직·전출이라면 확인하고 그대로 진행할 수 있어야 한다
  await pg.check('#ctConfirmDel');
  await pg.click('#ctUploadBtn');
  await pg.waitForFunction(() => window.__writes.length > 0, { timeout: 10000 });
  const saved = (await written()).find(x => x[0] === 'contacts')[2].staff;
  check('확인하면 저장된다 (지우는 것도 정상 기능)', saved.length === 2, saved.length);
}

console.log('\n■ 파일을 바꾸면 확인은 다시 받는다');
{
  await pg.evaluate(() => { window.__writes = []; window.__STAFF = null; });
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.evaluate(s => { window._dbStaff = s; }, STAFF);
  await pg.click('[data-tab="contacts"]');
  await pg.setInputFiles('#ctFileInput', FILE_FULL);
  await pg.waitForSelector('#ctPreviewWrap:not([style*="display: none"])');
  await pg.waitForTimeout(200);
  check('전원이 든 파일에는 확인란이 없다', !(await pg.isVisible('#ctConfirmWrap')));
  const diff = await pg.$eval('#ctDiffBox', e => e.innerText.replace(/\s+/g,' ').trim());
  check('변동 없음을 알려 준다', /변동 없음/.test(diff), diff);
}

console.log('\n■ 목록을 못 읽었으면 저장하지 않는다');
{
  // 새로고침 전에 올려 버리면, 몇 명이 지워지는지 알 수 없다 → 세지 않고 막는다
  const p2 = await b.newPage();
  p2.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
  await p2.route('https://cdnjs.cloudflare.com/**', r =>
    /xlsx/.test(r.request().url())
      ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(XLSXJS, 'utf8') })
      : r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p2.route('https://www.gstatic.com/firebasejs/**', route => {
    const u = route.request().url();
    let body = 'export {};';
    if (u.includes('firebase-app'))  body = 'export const initializeApp=()=>({});';
    if (u.includes('firebase-auth')) body = `export const getAuth=()=>({currentUser:{email:'pkh910518@yeungnam.hs.kr'}});
      export const onAuthStateChanged=(a,cb)=>setTimeout(()=>cb({email:'pkh910518@yeungnam.hs.kr'}),0);
      export const signInWithPopup=async()=>{}; export const GoogleAuthProvider=function(){}; export const signOut=async()=>{};`;
    if (u.includes('firebase-firestore')) body = `
      export const getFirestore=()=>({}); export const doc=(d,c,i)=>({coll:c,id:i});
      export const collection=()=>({}); export const getDocs=async()=>({docs:[],empty:true,forEach(){}});
      window.__writes=[];
      export const setDoc=async(r,d)=>{ window.__writes.push([r.coll,r.id,d]); };
      export const deleteDoc=async()=>{};
      export const getDoc=async()=>{ throw new Error('Missing or insufficient permissions.'); };
      export const writeBatch=()=>({ set(c,d){ window.__writes.push([c.coll,c.id,d]); }, async commit(){} });`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  await p2.goto('file://' + HTML, { waitUntil: 'networkidle' });
  await p2.click('[data-tab="contacts"]');
  await p2.setInputFiles('#ctFileInput', FILE_BLANK);
  await p2.waitForSelector('#ctPreviewWrap:not([style*="display: none"])');
  await p2.evaluate(() => { window.__writes = []; });
  await p2.click('#ctUploadBtn');
  await p2.waitForTimeout(400);
  const w = await p2.evaluate(() => window.__writes.map(x => x[0]));
  check('저장하지 않는다', w.length === 0, w);
  const st = await p2.$eval('#ctStatus', e => e.innerText.replace(/\s+/g,' ').trim());
  check('새로고침을 먼저 하라고 한다', /새로고침/.test(st), st);
  await p2.close();
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail || errs.length ? 1 : 0);
