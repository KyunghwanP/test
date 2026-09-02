// 사용 현황 — 누가 앱을 얼마나 쓰는지.
//
// 로그인 이벤트로는 못 센다. 세션이 유지돼서 한 번 로그인하면 몇 달씩 다시 안 뜬다.
// 그래서 '앱을 연 횟수'와 '탭을 연 횟수'를 센다. 여기서 확인할 것은 셋이다.
//   · 세는 게 맞는가 (앱 열기·탭 이동·자정 넘김)
//   · 저장이 그날 줄만 건드리는가 (한 달치가 문서 하나라 잘못 쓰면 지난 날이 날아간다)
//   · 관리자 말고는 못 들어가는가
//
// index.html 은 Firebase 없이는 못 뜬다. 원본에서 함수를 그대로 떼어 붙인 하네스로 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML  = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const PAGE  = fs.readFileSync(import.meta.dirname + '/../usage.html', 'utf8');
const RULES = fs.readFileSync(import.meta.dirname + '/../firestore.rules', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

const grab = (name, src = HTML) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
// const NAME = … ;  — 괄호 깊이를 보고 최상위 세미콜론에서 끊는다.
// '다음 const 앞까지' 같은 방식은 뒤에 오는 document.… 줄까지 삼켜서
// 하네스가 통째로 깨진다. 실제로 한 번 그렇게 깨졌다.
const grabConst = (name, src = HTML) => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(src);
  if (!m) throw new Error('못 찾음(const): ' + name);
  let d = 0, q = null;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('{[('.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('끝을 못 찾음(const): ' + name);
};

console.log('\n■ 배선 (정적)');
check('화면은 별도 파일이다', /function renderUsage/.test(PAGE) && !/function renderUsage/.test(HTML));
check('전 교사에게 내려가는 파일에는 화면 코드가 없다',
      !/function loadUsage/.test(HTML) && !/function renderUsage/.test(HTML)
      && !/ug-chip\{/.test(HTML));
check('탭 버튼도 없다', !/data-page="usage"/.test(HTML));
check('5연타는 앱 안 화면을 연다', /_ugClicks = 0; openUsagePage\(\);/.test(HTML));
check('앱을 벗어나지 않고 iframe 으로 띄운다',
      /id="usagePageFrame"/.test(HTML) && /usagePageFrame'\)\.src = 'usage\.html\?in=1'/.test(HTML));
check('돌아가기 버튼이 있다', /id="usageBackBtn"/.test(HTML) && /function closeUsagePage/.test(HTML));
check('다른 탭으로 나가면 프레임을 비운다',
      /page !== 'usage'\)\s*\{[\s\S]{0,180}usagePageFrame[\s\S]{0,120}about:blank/.test(HTML));
check('관리자가 아니면 5연타가 아무 일도 안 한다', /if\(!usageIsAdmin\(\)\) return;/.test(HTML));
check('세는 코드는 index 에 남아 있다',
      /function usageStart/.test(HTML) && /function usageFlush/.test(HTML));
check('탭을 누를 때 센다', /usageTab\(page\);/.test(HTML));
check('앱을 열 때 센다', /usageStart\(user\.email\);/.test(HTML));
check('화면을 내리면 보낸다',
      /visibilitychange[\s\S]{0,80}usageFlush/.test(HTML) && /pagehide', usageFlush/.test(HTML));
check('규칙: 자기 문서에만 쓰고 관리자만 읽는다',
      /match \/usage\/\{email\}\/m\/\{ym\} \{[\s\S]{0,200}allow read:\s+if isAppAdmin\(\);[\s\S]{0,120}request\.auth\.token\.email == email/.test(RULES));

// 하네스가 없는 함수를 대신 만들어 주면, 원본에 없어도 검사는 통과한다.
// 실제로 그렇게 통과시켰다 — esc() 는 index.html 에 없고 escapeHtml() 이 맞는데,
// 하네스가 esc 를 정의해 버려서 화면이 '불러오는 중…' 에서 멈추는 걸 못 잡았다.
// 그래서 이 구간이 부르는 이름이 원본에 실제로 있는지 따로 본다.
console.log('\n■ 부르는 함수가 원본에 있는가');
{
  // 시작점을 '사용 현황 —' 로 잡으면 화면 마크업의 주석에 먼저 걸려 127KB를 훑는다.
  // usage.html 의 <script> 전체를 본다 — 여기가 화면 코드가 사는 곳이다.
  const seg = PAGE.slice(PAGE.indexOf('<script type="module">'));
  check('사용 현황 코드를 찾았다', seg.length > 3000, seg.length);
  const called = [...new Set([...seg.matchAll(/(?<![A-Za-z0-9_$.])([a-zA-Z_$][\w$]*)\s*\(/g)]
    .map(m => m[1]))];
  const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','function',
    'Number','String','Object','Array','Math','Date','Promise','JSON','Set','Map','parseInt',
    'parseFloat','isNaN','setTimeout','clearTimeout','require','await','new','RegExp',
    'var', 'confirm', 'alert', 'getComputedStyle', 'setInterval', 'clearInterval',
    'async', 'else', 'do', 'URLSearchParams']);
  // firebase 에서 들여온 이름(getDoc·doc 등)도 '있는' 것이다
  const imported = new Set([...PAGE.matchAll(/^import \{([^}]+)\}\s*from/gm)]
    .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop())));
  const missing = called.filter(n => !BUILTIN.has(n) && !imported.has(n)
    && !new RegExp(`(?:function|const|let|var)\\s+${n}\\b|${n}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\()`).test(PAGE));
  check('없는 함수를 부르지 않는다', missing.length === 0, missing);
  check('문자열은 원본의 escapeHtml 로 감싼다',
        /escapeHtml\(/.test(seg) && !/(?<![A-Za-z0-9_$.])esc\(/.test(seg));
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

const HARNESS = `<!doctype html><meta charset="utf-8">
<div class="page-view active" id="homePage">
  <div id="homeMemoCard"><span class="home-section-title">📝 빠른 메모</span></div>
  <textarea id="someMemo"></textarea>
</div>
<div class="page-view" id="usagePage">
  <iframe id="usagePageFrame"></iframe>
</div>
<div id="offscreen" style="display:none">
  <input type="month" id="usageMonth"><span id="usageNote"></span><div id="usageBody"></div>
</div>
<script>
  const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';
  ${grab('escapeHtml')}
  const TEACHERS = [];
  let _who = ADMIN_EMAIL, _viewAs = false;
  const fbAuth = { get currentUser(){ return _who ? { email: _who } : null; } };
  const isViewAs = () => _viewAs;
  window.__setWho = (e, v) => { _who = e; _viewAs = !!v; };

  const fbDb = {};
  const doc = (db, ...p) => ({ path: p.join('/') });
  let _snapCb = null;
  function onSnapshot(ref, cb){ _snapCb = cb; return () => { _snapCb = null; }; }
  window.__push = n => _snapCb && _snapCb({ exists: () => true, data: () => ({ n }) });
  window.__store = {};        // 저장돼 있는 문서
  window.__writes = [];
  const getDoc = async r => ({ exists: () => !!window.__store[r.path],
                               data: () => window.__store[r.path] || {} });
  function _fsSetDoc(r, d, opt){
    window.__writes.push({ path: r.path, data: JSON.parse(JSON.stringify(d)), merge: !!(opt && opt.merge) });
    const cur = window.__store[r.path] || {};
    // Firestore merge 흉내 — days 아래는 날짜별로 얹는다
    window.__store[r.path] = { ...cur, ...d, days: { ...(cur.days || {}), ...(d.days || {}) } };
    return Promise.resolve();
  }
  window.__nav = [];
  function navigateTo(p){
    window.__nav.push(p);
    document.querySelectorAll('.page-view').forEach(el =>
      el.classList.toggle('active', el.id === p + 'Page'));
  }

  ${grabConst('USAGE_FLUSH_MS')}
  let usageDay = null, usageRef = null, usageDirty = false, usageTimer = null;
  ${grabConst('usageKst')}
  ${grabConst('usageDate')}
  ${grabConst('usageHhmm')}
  ${grab('usageStart')}
  ${grab('usageTab')}
  ${grab('usageMark')}
  ${grab('usageFlush')}
  ${grabConst('USAGE_TABS', PAGE)}
  ${grabConst('usageIsAdmin')}
  ${grabConst('APP_VER')}
  ${grabConst('RELOAD_SEEN_KEY')}
  let _reloadUnsub = null, _reloadBar = null, _reloadTimer = null;
  let _reloadSeen = (() => { try { return localStorage.getItem(RELOAD_SEEN_KEY); } catch(e){ return null; } })();
  ${grab('isBusyTyping')}
  ${grab('showReloadBar')}
  ${grabConst('RESUME_KEY')}
  ${grab('saveResumePoint')}
  ${grab('applyResumePoint')}
  ${grab('silentReload')}
  ${grab('onReloadSignal')}
  ${grab('watchReloadSignal')}
  let _ugClicks = 0, _ugTimer = null;
  ${grab('initUsageEasterEgg')}
  let _usageBackTo = 'home';
  ${grab('openUsagePage')}
  ${grab('closeUsagePage')}
  ${grab('usagePeople', PAGE)}
  let _usageBusy = false;
  ${grab('loadUsage', PAGE)}
  ${grab('renderUsage', PAGE)}

  Object.assign(window, { usageStart, usageTab, usageFlush, usageDate, loadUsage,
                          renderUsage, initUsageEasterEgg, closeUsagePage,
                          watchReloadSignal, isBusyTyping, APP_VER,
                          saveResumePoint, applyResumePoint });
  window.__armed = () => { watchReloadSignal(); };
  window.__day = () => usageDay;
  initUsageEasterEgg();
</script>`;

// setContent 로 띄우면 localStorage 가 막힌 출처가 된다(SecurityError).
// 실제 배포는 https 라 그 상태로 검사하면 저장 경로를 아예 못 본다.
// location.reload 는 덮어쓸 수 없다(읽기 전용). 실제로 새로고침이 일어나므로
// '몇 번 다시 받아 갔는지'를 라우트에서 센다. 새로고침되면 하네스도 처음부터
// 다시 도는데, 그게 실제 동작과 같다.
let serves = 0;
await pg.route('https://ynhs.test/**', r => {
  const u = r.request().url();
  if (u.endsWith('/usage.html'))
    return r.fulfill({ contentType: 'text/html; charset=utf-8',
                       body: '<!doctype html><meta charset="utf-8"><title>usage</title>' });
  serves++;
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS });
});
await pg.goto('https://ynhs.test/h.html');
const reloadedSince = base => serves - base;

const tap = async n => { for (let i = 0; i < n; i++) await pg.click('#homeMemoCard .home-section-title'); };
const active = () => pg.evaluate(() => document.querySelector('.page-view.active')?.id);

console.log('\n■ 관리자 말고는 못 들어간다');
{
  const src = () => pg.$eval('#usagePageFrame', e => e.getAttribute('src') || '');
  await pg.evaluate(() => window.__setWho('kim@yeungnam.hs.kr'));
  await tap(7);
  check('다른 교사가 눌러도 아무 일 없다', (await active()) === 'homePage', await active());
  check('프레임도 안 채운다', !(await src()), await src());

  // 보기 모드(관리자가 남의 화면을 볼 때)도 막는다 — 남의 이름으로 남는다
  await pg.evaluate(() => window.__setWho('pkh910518@yeungnam.hs.kr', true));
  await tap(6);
  check('보기 모드에서도 안 열린다', (await active()) === 'homePage', await active());

  await pg.evaluate(() => window.__setWho('pkh910518@yeungnam.hs.kr'));
  await tap(4);
  check('4번으로는 안 열린다', (await active()) === 'homePage');
  await tap(1);
  check('5번째에 앱 안에서 열린다', (await active()) === 'usagePage', await active());
  check('브라우저는 그대로 (앱을 안 벗어난다)',
        pg.url().endsWith('/h.html'), pg.url());
  check('프레임이 usage.html 을 가리킨다', (await src()) === 'usage.html?in=1', await src());

  await pg.evaluate(() => window.closeUsagePage());
  check('돌아가기로 원래 화면', (await active()) === 'homePage', await active());
  check('나가면 프레임을 비운다', (await src()) === 'about:blank', await src());
}

console.log('\n■ 앱을 연 횟수·탭 이동을 센다');
{
  await pg.evaluate(() => { window.__store = {}; window.__writes = []; window.__setWho('kim@yeungnam.hs.kr'); });
  await pg.evaluate(() => window.usageStart('kim@yeungnam.hs.kr'));
  let d = await pg.evaluate(() => window.__day());
  check('처음 열면 1회', d.opens === 1, d);
  check('처음 시각이 남는다', /^\d\d:\d\d$/.test(d.first), d.first);

  await pg.evaluate(() => { ['timetable','pass','timetable','search','timetable'].forEach(window.usageTab); });
  d = await pg.evaluate(() => window.__day());
  check('탭마다 센다', d.tabs.timetable === 3 && d.tabs.pass === 1 && d.tabs.search === 1, d.tabs);

  // 저장은 모아서 한 번
  const w0 = await pg.evaluate(() => window.__writes.length);
  check('탭을 누를 때마다 저장하지 않는다', w0 === 0, w0);
  await pg.evaluate(() => window.usageFlush());
  const w = await pg.evaluate(() => window.__writes);
  check('한 번만 저장한다', w.length === 1, w.length);
  check('내 문서에 쓴다', /^usage\/kim@yeungnam\.hs\.kr\/m\/\d{4}-\d{2}$/.test(w[0].path), w[0].path);
  check('merge 로 쓴다', w[0].merge === true);
  const today = await pg.evaluate(() => window.usageDate());
  check('그날 줄만 담는다', Object.keys(w[0].data.days).join() === today, Object.keys(w[0].data.days));
  check('탭 횟수가 실려 간다', w[0].data.days[today].tabs.timetable === 3, w[0].data.days[today]);
}

console.log('\n■ 다시 열면 이어서 센다 — 지난 날은 안 건드린다');
{
  await pg.evaluate(() => {
    window.__store['usage/kim@yeungnam.hs.kr/m/' + window.usageDate().slice(0,7)].days['1999-01-01'] =
      { opens: 9, first: '08:00', last: '09:00', tabs: { meal: 4 } };
    window.__writes = [];
  });
  await pg.evaluate(() => window.usageStart('kim@yeungnam.hs.kr'));
  const d = await pg.evaluate(() => window.__day());
  check('연 횟수가 이어진다 (1 → 2)', d.opens === 2, d.opens);
  check('탭 횟수도 이어진다', d.tabs.timetable === 3, d.tabs);
  await pg.evaluate(() => { window.usageTab('meal'); window.usageFlush(); });
  const store = await pg.evaluate(() => window.__store);
  const doc0 = store['usage/kim@yeungnam.hs.kr/m/' + (await pg.evaluate(() => window.usageDate())).slice(0,7)];
  check('예전 날짜가 그대로 남아 있다', doc0.days['1999-01-01'].opens === 9, Object.keys(doc0.days));
}

console.log('\n■ 남기지 않아야 할 때');
{
  await pg.evaluate(() => { window.__writes = []; });
  await pg.evaluate(() => window.usageStart(''));            // 이메일 없음
  check('계정이 없으면 안 센다', (await pg.evaluate(() => window.__writes.length)) === 0);
  await pg.evaluate(() => { window.__setWho('pkh910518@yeungnam.hs.kr', true);
                            window.usageStart('pkh910518@yeungnam.hs.kr'); });
  check('보기 모드에서는 안 센다', (await pg.evaluate(() => window.__writes.length)) === 0);
  await pg.evaluate(() => window.__setWho('pkh910518@yeungnam.hs.kr'));
}

console.log('\n■ 화면 — 집계가 맞는가');
{
  const YM = '2026-05';
  const rows = [
    { email:'a@x', name:'김하나', days:{
        '2026-05-01':{opens:3, first:'08:10', last:'16:40', tabs:{timetable:10, pass:2}},
        '2026-05-02':{opens:1, first:'09:00', last:'09:20', tabs:{timetable:1, meal:5}} } },
    { email:'b@x', name:'이두리', days:{
        '2026-05-02':{opens:2, first:'08:30', last:'15:00', tabs:{pass:7}} } },
    { email:'c@x', name:'박세찬', days:{} },
  ];
  await pg.evaluate(([r, ym]) => window.renderUsage(r, ym), [rows, YM]);
  const txt = await pg.$eval('#usageBody', e => e.innerText.replace(/\s+/g, ' '));
  check('쓴 사람 수', /쓴 사람\s*2 \/ 3명/.test(txt), txt.slice(0, 160));
  check('앱 연 횟수 합계 (3+1+2=6)', /앱 연 횟수\s*6/.test(txt), txt.slice(0, 160));
  check('탭 이동 합계 (10+2+1+5+7=25)', /탭 이동\s*25/.test(txt), txt.slice(0, 160));
  check('사용한 날 (1일·2일)', /사용한 날\s*2일/.test(txt), txt.slice(0, 160));

  const bars = await pg.$$eval('.ug-bar', els => els.length);
  check('5월은 막대가 31개', bars === 31, bars);
  const firstTwo = await pg.$$eval('.ug-bar', els => els.slice(0,3).map(e => e.title));
  check('날짜별 사용자 수가 맞다',
        /2026-05-01 · 1명 · 3회/.test(firstTwo[0]) && /2026-05-02 · 2명 · 3회/.test(firstTwo[1]), firstTwo);

  const tabs = await pg.$$eval('.ug-trow', els => els.map(e => e.innerText.replace(/\s+/g,' ').trim()));
  check('많이 쓴 기능이 위로 온다', /시간표 11/.test(tabs[0]) && /외출증 9/.test(tabs[1]), tabs);
  check('안 쓴 기능은 아예 안 나온다', !tabs.some(t => /학사일정/.test(t)), tabs);

  const names = await pg.$$eval('.ug-tbl tbody td.nm', els => els.map(e => e.textContent));
  check('사람도 많이 쓴 순', names.join() === '김하나,이두리', names);
  check('안 쓴 사람은 따로 모은다',
        /이 달에 안 쓴 1명/.test(txt) && /박세찬/.test(await pg.$eval('.ug-idle', e => e.innerText)), txt.slice(-200));
  check('무엇을 안 남기는지 화면에 적어 둔다', /무엇을 검색했는지/.test(txt));
}

/* ══ 전체 새로고침 ══════════════════════════════════════════════════════ */
console.log('\n■ 배포해도 옛 화면을 쓰는 사람에게 새로고침을 보낸다');
check('규칙: 읽기는 교사, 쓰기는 관리자만',
      /match \/appNotice\/\{docId\} \{[\s\S]{0,160}allow read:\s+if isYnhsTeacher\(\);[\s\S]{0,80}allow write: if isAppAdmin\(\);/.test(RULES));
check('전 교사가 쓸 수 있는 appdata 에 두지 않았다',
      !/appdata', 'reload'|appdata', 'appVersion/.test(HTML));
check('로그인하면 신호를 듣는다', /watchReloadSignal\(\);/.test(HTML));
check('보내는 쪽은 사용 현황 페이지에 있다',
      /async function broadcastReload/.test(PAGE) && !/broadcastReload/.test(HTML));
check('보낸 뒤 번호가 오른다', /n = \(Number\(snap\.exists\(\) \? snap\.data\(\)\.n : 0\) \|\| 0\) \+ 1/.test(PAGE));
{
  await pg.evaluate(() => {
    try { localStorage.removeItem('ynhsReloadSeen'); } catch(e){}
    document.getElementById('appReloadBar')?.remove();
    window.__armed();
  });

  // 이 기능이 깔리는 순간 전원이 새로고침하면 안 된다
  let base = serves;
  await pg.evaluate(() => window.__push(7));
  await pg.waitForTimeout(150);
  check('처음 보는 기기는 번호만 적어 둔다',
        reloadedSince(base) === 0 && !(await pg.$('#appReloadBar')));
  check('그 번호를 기억한다',
        (await pg.evaluate(() => localStorage.getItem('ynhsReloadSeen'))) === '7');

  // 스냅샷은 내용이 안 바뀌어도 다시 올 수 있다
  await pg.evaluate(() => window.__push(7));
  await pg.waitForTimeout(150);
  check('같은 번호에는 아무 일 없다', !(await pg.$('#appReloadBar')));

  // 관리자가 새로 보냈다 — 적는 중이 아니면 묻지 않고 조용히 새로고침한다
  base = serves;
  await pg.evaluate(() => window.__push(8));
  await pg.waitForTimeout(1500);
  check('묻지 않고 바로 새로고침한다', reloadedSince(base) >= 1, reloadedSince(base));
  check('막대를 띄우지 않는다', !(await pg.$('#appReloadBar')));
  check('새로고침 뒤에는 다시 안 뜬다 (번호를 기억한다)',
        (await pg.evaluate(() => localStorage.getItem('ynhsReloadSeen'))) === '8');
}

console.log('\n■ 새로고침해도 보던 자리에 그대로');
{
  await pg.evaluate(() => {
    window.__armed();
    // 주간교육활동 탭을 보며 아래로 내려간 상태
    document.querySelectorAll('.page-view').forEach(e => e.classList.remove('active'));
    const u = document.getElementById('usagePage');
    u.classList.add('active');
    window.saveResumePoint();
  });
  const saved = await pg.evaluate(() => JSON.parse(sessionStorage.getItem('ynhsResumeView') || 'null'));
  check('보던 탭을 적어 둔다', saved && saved.page === 'usage', saved);
  check('스크롤 위치도 같이', saved && typeof saved.top === 'number', saved);

  check('위젯은 자리를 안 적는다 — 탭이 없는 한 장짜리 화면이다',
        /widget-mode'\)\) saveResumePoint\(\)/.test(HTML));

  // 보통 탭이면 그 탭으로 돌아간다
  await pg.evaluate(() => { sessionStorage.setItem('ynhsResumeView',
    JSON.stringify({ page:'home', top: 480, at: Date.now() })); window.__nav.length = 0; });
  check('보던 탭으로 돌아간다', (await pg.evaluate(() => window.applyResumePoint())) === true);
  check('그 탭으로 이동한다', (await pg.evaluate(() => window.__nav)).includes('home'),
        await pg.evaluate(() => window.__nav));
  check('한 번 쓰면 지운다',
        (await pg.evaluate(() => sessionStorage.getItem('ynhsResumeView'))) === null);

  // 어제 것으로 끌고 가면 그게 더 이상하다
  await pg.evaluate(() => { sessionStorage.setItem('ynhsResumeView',
    JSON.stringify({ page:'meal', top: 0, at: Date.now() - 3600000 })); window.__nav.length = 0; });
  check('오래된 자리는 무시한다', (await pg.evaluate(() => window.applyResumePoint())) === false);
}

console.log('\n■ 적고 있으면 강제로 하지 않는다');
{
  await pg.evaluate(() => {
    document.getElementById('appReloadBar')?.remove();
    window.__armed();
    const t = document.getElementById('someMemo'); t.value = '학부모 상담 메모 쓰는 중'; t.focus();
  });
  check('적는 중으로 본다', await pg.evaluate(() => window.isBusyTyping()));

  let base = serves;
  await pg.evaluate(() => window.__push(9));
  await pg.waitForTimeout(150);
  const bar = await pg.$eval('#appReloadBar', e => e.innerText.replace(/\s+/g,' '));
  check('조용히 안 하고 물어본다', /새 버전이 있습니다/.test(bar), bar);
  check('세지 않는다 — 적던 게 날아가면 안 된다', !/초 후/.test(bar), bar);
  check('직접 누를 버튼은 있다', /지금 새로고침/.test(bar), bar);
  await pg.waitForTimeout(3500);
  check('시간이 지나도 적던 게 안 날아간다', reloadedSince(base) === 0, reloadedSince(base));
  await pg.evaluate(() => { const t = document.getElementById('someMemo'); t.value = ''; t.blur();
    document.getElementById('appReloadBar')?.remove(); });
}

console.log('\n■ 막대가 좁은 화면에서 깨지지 않는다');
{
  // 한 번 깨졌다 — 좁은 화면에서 안내문이 버튼에 밀려 최소 폭까지 줄었고,
  // 한글은 아무 데서나 줄바꿈되니 그 최소 폭이 '한 글자'였다. 글자가 세로로
  // 한 줄씩 쌓여 막대 높이가 321px 이 됐다. 그래서 실제로 재 본다.
  const bar = await b.newPage();
  await bar.route('https://ynhs.test/**', r =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8">
      <body style="font-family:'Noto Sans KR',sans-serif;margin:0">
      <script>let _reloadBar=null,_reloadTimer=null;
      ${grab('isBusyTyping')}
      ${grab('showReloadBar')}
      showReloadBar('새 버전이 있습니다.', 5);<\/script>` }));

  for (const w of [360, 390, 430, 768, 1280]) {
    await bar.setViewportSize({ width: w, height: 780 });
    await bar.goto('https://ynhs.test/b.html');
    const r = await bar.$eval('#appReloadBar', e => {
      const g = e.getBoundingClientRect(), s = e.querySelector('span').getBoundingClientRect();
      return { w: Math.round(g.width), h: Math.round(g.height),
               l: Math.round(g.left), r: Math.round(g.right),
               msgW: Math.round(s.width), msgH: Math.round(s.height), vw: innerWidth };
    });
    check(`${w}px — 글이 세로로 눌리지 않는다`, r.msgW > 120 && r.msgH < 90, r);
    check(`${w}px — 화면 밖으로 안 나간다`, r.l >= 0 && r.r <= r.vw, r);
    check(`${w}px — 막대가 지나치게 높지 않다`, r.h < 130, r);
  }
  await bar.close();
}

console.log('\n■ usage.html 을 실제로 띄워 본다');
{
  // 함수 호출만 훑는 정적 검사로는 부족했다. index.html 에서 화면을 떼어 오면서
  // 함수 밖에 있던 `let _usageBusy` 를 안 옮겼는데, 호출 검사는 그걸 못 본다.
  // 화면은 통째로 비고 콘솔에만 ReferenceError 가 떴다. 그래서 실제로 띄운다.
  const YM = new Date(Date.now() + 9*3600*1000).toISOString().slice(0,7);
  const up = await b.newPage();
  const uerrs = [];
  up.on('pageerror', e => uerrs.push(e.message));
  up.on('console', m => { if (m.type() === 'error') uerrs.push(m.text()); });
  await up.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await up.route('https://www.gstatic.com/firebasejs/**', route => {
    const u = route.request().url();
    let body = 'export {};';
    if (u.includes('firebase-app'))  body = 'export const initializeApp=()=>({});';
    if (u.includes('firebase-auth')) body = `
      export const getAuth=()=>({currentUser:{email:'pkh910518@yeungnam.hs.kr'}});
      export const onAuthStateChanged=(a,cb)=>setTimeout(()=>cb({email:window.__WHO}),0);
      export const GoogleAuthProvider=function(){this.setCustomParameters=()=>{};};
      export const signInWithPopup=async()=>{}; export const setPersistence=async()=>{};
      export const browserLocalPersistence={}; export const indexedDBLocalPersistence={};`;
    if (u.includes('firebase-firestore')) body = `
      export const getFirestore=()=>({}); export const doc=(d,...p)=>({path:p.join('/')});
      window.__wrote=[]; export const setDoc=async(r,d)=>{ window.__wrote.push([r.path,d]); };
      export const getDoc=async r=>{
        if(r.path==='acl/emailByName') return {exists:()=>true,
          data:()=>({'김하나':'a@yeungnam.hs.kr','이두리':'b@yeungnam.hs.kr','박세찬':'c@yeungnam.hs.kr'})};
        if(r.path.startsWith('usage/a@')) return {exists:()=>true, data:()=>({days:{
          ['${YM}-03']:{opens:4,first:'08:10',last:'16:40',ver:'ver6.97',tabs:{timetable:9,pass:2}} }})};
        if(r.path.startsWith('usage/b@')) return {exists:()=>true, data:()=>({days:{
          ['${YM}-03']:{opens:1,first:'09:00',last:'09:30',ver:'ver1.00',tabs:{meal:3}} }})};
        if(r.path==='appNotice/reload') return {exists:()=>true,data:()=>({n:41})};
        return {exists:()=>false,data:()=>({})};
      };`;
    route.fulfill({ status:200, contentType:'text/javascript', body });
  });
  const PAGE_SRC = PAGE;
  await up.route('https://ynhs.test/**', r =>
    r.fulfill({ contentType:'text/html; charset=utf-8', body: PAGE_SRC }));

  await up.addInitScript(w => { window.__WHO = w; }, 'pkh910518@yeungnam.hs.kr');
  await up.goto('https://ynhs.test/usage.html');
  await up.waitForTimeout(900);

  check('런타임 오류 없이 뜬다', uerrs.length === 0, uerrs.slice(0,3));
  check('로그인 게이트가 닫힌다',
        (await up.$eval('#gate', e => getComputedStyle(e).display)) === 'none');
  const txt = await up.$eval('#usageBody', e => e.innerText.replace(/\s+/g,' '));
  check('내용이 비어 있지 않다', txt.length > 100, txt.length);
  check('명단을 acl/emailByName 에서 읽는다',
        /교직원 3명/.test(await up.$eval('#usageNote', e => e.innerText)),
        await up.$eval('#usageNote', e => e.innerText));
  check('집계가 나온다', /쓴 사람\s*2 \/ 3명/.test(txt) && /앱 연 횟수\s*5/.test(txt), txt.slice(0,180));
  check('기능별 막대가 그려진다', (await up.$$eval('.ug-trow', e => e.length)) > 0);
  check('옛 버전을 짚어 준다',
        (await up.$$eval('.ug-tbl td.old', e => e.map(x => x.textContent))).join() === 'ver1.00',
        await up.$$eval('.ug-tbl td.old', e => e.map(x => x.textContent)));

  // 모두 새로고침 — 번호가 오르는지
  up.on('dialog', d => d.accept());
  await up.click('#usageReloadAllBtn');
  await up.waitForTimeout(400);
  const wrote = await up.evaluate(() => window.__wrote);
  check('모두 새로고침이 번호를 올린다',
        wrote.some(w => w[0] === 'appNotice/reload' && w[1].n === 42), wrote);

  // 앱 안(iframe)으로 열렸을 때 — '대시보드' 버튼이 살아 있으면 프레임 안이
  // 앱으로 바뀌어 앱 속에 앱이 뜬다.
  check('따로 열면 대시보드 버튼이 보인다', !(await up.$eval('#homeBtn', e => e.hidden)));
  await up.goto('https://ynhs.test/usage.html?in=1');
  await up.waitForTimeout(700);
  check('앱 안에서는 대시보드 버튼을 숨긴다', await up.$eval('#homeBtn', e => e.hidden));
  check('앱 안에서는 제목줄도 접는다',
        (await up.$eval('body', e => e.className)).includes('in-app'));
  check('앱 안에서도 내용은 그대로',
        (await up.$eval('#usageBody', e => e.innerText)).length > 100);
  await up.close();
}

console.log('\n■ 누가 옛 화면을 쓰는지 보인다');
{
  const rows = [
    { email:'a@x', name:'김하나', days:{ '2026-05-01':{opens:1, last:'10:00', ver:'ver6.97', tabs:{home:1}} } },
    { email:'b@x', name:'이두리', days:{ '2026-05-01':{opens:1, last:'10:00', ver:'ver6.80', tabs:{home:1}} } },
  ];
  await pg.evaluate(([r, ym]) => window.renderUsage(r, ym), [rows, '2026-05']);
  const olds = await pg.$$eval('.ug-tbl td.old', els => els.map(e => e.textContent));
  check('옛 버전만 빨갛게 짚어 준다', olds.join() === 'ver6.80', olds);
  const txt = await pg.$eval('#usageBody', e => e.innerText.replace(/\s+/g,' '));
  check('몇 명인지 요약에도 나온다', /옛 버전\s*1명/.test(txt), txt.slice(0,220));
  check('버전 칸이 표에 있다',
        (await pg.$$eval('.ug-tbl th', els => els.map(e => e.textContent))).includes('버전'));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
