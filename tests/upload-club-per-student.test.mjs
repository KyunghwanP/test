// 동아리 개별 입력을 실제 브라우저에서 눌러본다.
//
// 편성표에는 동아리 열이 없다. 그래서 편성표로 명렬을 갱신하면 새로 전입한
// 학생만 동아리가 빈 채로 남는다. 그 몇 명을 채우려고 학생연락망 전체를
// 다시 만들지 않게 하는 화면이다.
//
// 여기서 확인할 것은 하나다 — **동아리 말고는 아무것도 안 바뀌는가.**
// students/main 을 통째로 다시 쓰기 때문에, 한 글자 잘못 건드리면 전교생이 는다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML  = import.meta.dirname + '/../upload.html';
const SCRAP = '/tmp/claude-0/-home-user-ynhs/6d75d3ff-7eaa-5fb8-9dbb-3fcab9344eea/scratchpad';

const scNormJs = v => String(v ?? '').trim();
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

// 기존 DB 흉내 — 전원 동아리가 있고, 셋만 비어 있다(= 새로 전입한 학생)
const STU = [];
const CLUBS = ['과학탐구부', '밴드부', '축구부'];
for (let g = 1; g <= 3; g++) for (let r = 1; r <= 4; r++) for (let n = 1; n <= 5; n++) {
  const i = STU.length;
  STU.push({
    grade: String(g), room: String(r), num: String(n),
    name: `학생${String(i + 1).padStart(3, '0')}`,
    club: (i === 3 || i === 17 || i === 41) ? '' : CLUBS[i % CLUBS.length],
    hasPhone: i % 2 === 0,                       // 편성표 저장이 붙여 두는 표시
    sci: i % 9 === 0 ? 1 : undefined,            // 건드리면 안 되는 남의 필드
  });
}
const EMPTY = STU.filter(s => !s.club);
const CLUB_DOC = [{ name: '과학탐구부' }, { name: '밴드부' }, { name: '축구부' }, { name: '바둑부' }];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const NOISE = /favicon|ServiceWorkerRegistration|ERR_CONNECTION_RESET|net::ERR_FAILED/;

async function openPage() {
  const page = await b.newPage();
  page.on('pageerror', e => { if (!NOISE.test(e.message)) errs.push(e.message); });
  page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });

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
      // students/main 은 '지금 저장된 값'을 흉내낸다 — 저장하면 그 자리에 얹힌다.
      export const setDoc=async(r,d)=>{
        window.__writes.push([r.coll, r.id, d]);
        if (r.coll==='students' && r.id==='main') window.__PREV = d.students;
      };
      export const deleteDoc=async()=>{};
      export const getDoc=async r=>({
        exists:()=> r.coll==='students' || r.coll==='clubs',
        data:()=> r.coll==='students' ? {students:window.__PREV, updatedAt:'옛날', 남의필드:'그대로'}
                : r.coll==='clubs'    ? {clubs:window.__CLUBS} : {}
      });
      export const writeBatch=()=>({ set(){}, async commit(){} });`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  await page.addInitScript(([s, c]) => { window.__PREV = s; window.__CLUBS = c; }, [STU, CLUB_DOC]);
  await page.goto('file://' + HTML, { waitUntil: 'networkidle' });
  await page.click('[data-tab="students"]');
  await page.click('#scLoadBtn');
  await page.waitForSelector('#scList [data-sc-in]', { timeout: 20000 });
  return page;
}

const pg = await openPage();

console.log('\n■ 동아리 없는 학생만 보여준다');
{
  const stats = await pg.$eval('#scStats', e => e.innerText.replace(/\n/g, ' '));
  check('전체·빈칸 수를 알려준다',
        new RegExp(`전체 ${STU.length}`).test(stats) && new RegExp(`동아리 없음 ${EMPTY.length}`).test(stats), stats);
  const shown = await pg.$$eval('#scList [data-sc-in]', els => els.map(e => e.dataset.scIn));
  check(`빈칸인 ${EMPTY.length}명만 뜬다`,
        shown.length === EMPTY.length
        && EMPTY.every(s => shown.includes(`${+s.grade}-${+s.room}-${+s.num}`)), shown);

  // 자동완성 — 동아리 명단 + 이미 붙어 있는 이름
  const opts = await pg.$$eval('#scClubList option', els => els.map(e => e.value));
  check('동아리 명단이 자동완성에 들어온다', opts.includes('바둑부') && opts.includes('밴드부'), opts);
}

console.log('\n■ 전체 보기 · 찾기');
{
  await pg.uncheck('#scOnlyEmpty');
  check('끄면 전원이 대상이 된다',
        (await pg.$eval('#scStats', e => e.innerText)).includes(`보이는 중 ${STU.length}`),
        await pg.$eval('#scStats', e => e.innerText.replace(/\n/g, ' ')));
  await pg.fill('#scFind', '2-3');
  const shown = await pg.$$eval('#scList [data-sc-in]', els => els.map(e => e.dataset.scIn));
  check('학년-반으로 좁힌다', shown.length === 5 && shown.every(k => k.startsWith('2-3-')), shown);
  await pg.fill('#scFind', STU[7].name);
  check('이름으로도 찾는다',
        (await pg.$$eval('#scList [data-sc-in]', els => els.length)) === 1,
        await pg.$$eval('#scList [data-sc-in]', els => els.map(e => e.dataset.scIn)));
  await pg.fill('#scFind', '');
  await pg.check('#scOnlyEmpty');
}

console.log('\n■ 저장 전에는 버튼이 잠겨 있다');
check('바꾼 게 없으면 못 누른다', await pg.$eval('#scSaveBtn', e => e.disabled));

console.log('\n■ 채워 넣고 저장');
{
  const [a, b2] = EMPTY;
  await pg.fill(`[data-sc-in="${+a.grade}-${+a.room}-${+a.num}"]`, '바둑부');
  await pg.fill(`[data-sc-in="${+b2.grade}-${+b2.room}-${+b2.num}"]`, '밴드부');
  await pg.click('#scStats');                       // 포커스를 빼 change 를 일으킨다
  check('바꾼 수가 버튼에 뜬다',
        /바뀐 2명 저장/.test(await pg.$eval('#scSaveBtn', e => e.textContent)),
        await pg.$eval('#scSaveBtn', e => e.textContent));
  check('채운 줄은 표시가 남는다',
        (await pg.$$eval('#scList .sc-dirty', els => els.length)) === 2);
  // 방금 채운 학생이 목록에서 사라지면 오타를 못 고친다
  check('채워도 목록에서 안 사라진다',
        (await pg.$$eval('#scList [data-sc-in]', els => els.length)) === EMPTY.length);

  await pg.click('#scSaveBtn');
  await pg.waitForFunction(() => /저장 완료/.test(document.getElementById('scStatus').innerText),
                           null, { timeout: 20000 });

  const writes = await pg.evaluate(() => window.__writes);
  const saved  = writes.filter(w => w[0] === 'students' && w[1] === 'main');
  check('students/main 만 쓴다',
        writes.every(w => w[0] === 'students'), [...new Set(writes.map(w => w[0]))]);
  check('연락처 문서는 손대지 않는다', writes.every(w => w[0] !== 'studentsContact'));
  check('한 번만 쓴다', saved.length === 1, saved.length);

  const doc = saved[0][2];
  const next = doc.students;
  check('인원이 그대로다', next.length === STU.length, next.length);
  check('다른 문서 필드를 지우지 않는다', doc.남의필드 === '그대로', Object.keys(doc));
  check('갱신 시각·계정을 남긴다', !!doc.updatedAt && doc.updatedAt !== '옛날'
        && doc.updatedBy === 'pkh910518@yeungnam.hs.kr', { at: doc.updatedAt, by: doc.updatedBy });

  const at = k => next.find(s => `${+s.grade}-${+s.room}-${+s.num}` === k);
  check('첫 학생 동아리가 들어갔다', at(`${+a.grade}-${+a.room}-${+a.num}`).club === '바둑부');
  check('둘째 학생 동아리가 들어갔다', at(`${+b2.grade}-${+b2.room}-${+b2.num}`).club === '밴드부');

  // 여기가 핵심 — 동아리 말고는 한 글자도 안 바뀌어야 한다
  const changed = [];
  for (const was of STU) {
    const now = at(`${+was.grade}-${+was.room}-${+was.num}`);
    if (!now) { changed.push([was.name, '사라짐']); continue; }
    for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (k === 'club') continue;
      if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) changed.push([was.name, k, was[k], now[k]]);
    }
  }
  check('동아리 말고는 아무것도 안 바뀌었다', changed.length === 0, changed.slice(0, 5));
  const otherClubs = STU.filter(s => s.club)
    .filter(s => at(`${+s.grade}-${+s.room}-${+s.num}`).club !== s.club);
  check('원래 있던 동아리는 그대로다', otherClubs.length === 0, otherClubs.slice(0, 3).map(s => s.name));
  check('남은 빈칸은 하나뿐이다',
        next.filter(s => !s.club).length === EMPTY.length - 2,
        next.filter(s => !s.club).map(s => s.name));
}

console.log('\n■ 저장 뒤 상태');
{
  check('버튼이 다시 잠긴다', await pg.$eval('#scSaveBtn', e => e.disabled));
  const stats = await pg.$eval('#scStats', e => e.innerText.replace(/\n/g, ' '));
  check('빈칸 수가 줄어 다시 그려진다',
        new RegExp(`동아리 없음 ${EMPTY.length - 2}`).test(stats), stats);
}

console.log('\n■ 지우기 — 빈 값으로 바꾸면 동아리 필드가 빠진다');
{
  const p2 = await openPage();
  const one = STU.find(s => s.club);
  await p2.uncheck('#scOnlyEmpty');
  await p2.fill('#scFind', one.name);
  await p2.fill(`[data-sc-in="${+one.grade}-${+one.room}-${+one.num}"]`, '');
  await p2.click('#scStats');
  await p2.click('#scSaveBtn');
  await p2.waitForFunction(() => /저장 완료/.test(document.getElementById('scStatus').innerText),
                           null, { timeout: 20000 });
  const next = (await p2.evaluate(() => window.__writes)).at(-1)[2].students;
  const now  = next.find(s => `${+s.grade}-${+s.room}-${+s.num}` === `${+one.grade}-${+one.room}-${+one.num}`);
  check('빈 동아리는 필드째 빠진다', !('club' in now), now);
  check('그 학생의 다른 값은 남는다', now.name === one.name && now.hasPhone === one.hasPhone, now);
  await p2.close();
}

console.log('\n■ 그 사이 반이 재편성되면 엉뚱한 학생에게 붙이지 않는다');
{
  // 학년-반-번호는 고유 번호가 아니다. 불러온 뒤 편성표 업로드가 끼어들면
  // 같은 자리에 다른 학생이 앉는다. 그대로 얹으면 남의 동아리가 된다.
  const p3 = await openPage();
  const target = EMPTY[0];
  const key = `${+target.grade}-${+target.room}-${+target.num}`;
  await p3.fill(`[data-sc-in="${key}"]`, '바둑부');
  await p3.click('#scStats');

  // 저장 직전에 그 자리 학생을 다른 사람으로 바꿔치기한다(= 편성표 업로드가 끼어든 상황)
  await p3.evaluate(k => {
    window.__PREV = window.__PREV.map(s =>
      `${+s.grade}-${+s.room}-${+s.num}` === k ? { ...s, name: '전입한다른학생' } : s);
  }, key);

  await p3.click('#scSaveBtn');
  await p3.waitForFunction(() => /저장 완료/.test(document.getElementById('scStatus').innerText),
                           null, { timeout: 20000 });

  const saved = (await p3.evaluate(() => window.__writes)).at(-1)[2].students;
  const seat  = saved.find(s => `${+s.grade}-${+s.room}-${+s.num}` === key);
  check('그 자리 학생에게 동아리를 붙이지 않는다', !scNormJs(seat.club), seat);
  check('이름이 어긋난 것을 알린다',
        /다른 학생이 들어와/.test(await p3.$eval('#scStatus', e => e.innerText)),
        await p3.$eval('#scStatus', e => e.innerText));
  check('0명 저장으로 끝난다',
        /0명 저장 완료/.test(await p3.$eval('#scStatus', e => e.innerText)),
        await p3.$eval('#scStatus', e => e.innerText));
  await p3.close();
}

console.log('\n■ 편성표 탭이 여기로 안내한다');
{
  const html = fs.readFileSync(HTML, 'utf8');
  check('새로 들어온 학생이 있으면 알려준다',
        /d\.added\.length[\s\S]{0,200}동아리가 비어 있습니다[\s\S]{0,120}동아리 개별 입력/.test(html));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,5).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
