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

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const RULES = fs.readFileSync(import.meta.dirname + '/../firestore.rules', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
// const NAME = … ;  — 괄호 깊이를 보고 최상위 세미콜론에서 끊는다.
// '다음 const 앞까지' 같은 방식은 뒤에 오는 document.… 줄까지 삼켜서
// 하네스가 통째로 깨진다. 실제로 한 번 그렇게 깨졌다.
const grabConst = name => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음(const): ' + name);
  let d = 0, q = null;
  for (let j = m.index; j < HTML.length; j++) {
    const c = HTML[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('{[('.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('끝을 못 찾음(const): ' + name);
};

console.log('\n■ 배선 (정적)');
check('사용량 화면이 있다', /id="usagePage"/.test(HTML));
check('탭 버튼은 없다 — 5연타로만 들어온다',
      !/data-page="usage"/.test(HTML));
check('탭 전환 목록에 들어 있다', /'pass','seat','usage'\]/.test(HTML));
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
  const A = HTML.indexOf("/* 🥚 사용 현황 —"), B = HTML.indexOf("// 🥚 학기 라벨을 빠르게");
  check('사용 현황 코드 구간을 찾았다', A > 0 && B > A && B - A < 20000, { A, B, len: B - A });
  const seg = HTML.slice(A, B);
  const called = [...new Set([...seg.matchAll(/(?<![A-Za-z0-9_$.])([a-zA-Z_$][\w$]*)\s*\(/g)]
    .map(m => m[1]))];
  const BUILTIN = new Set(['if','for','while','switch','catch','return','typeof','function',
    'Number','String','Object','Array','Math','Date','Promise','JSON','Set','Map','parseInt',
    'parseFloat','isNaN','setTimeout','clearTimeout','require','await','new','RegExp',
    'var']);   // var(--…) 는 CSS 다
  // firebase 에서 들여온 이름(getDoc·doc 등)도 '있는' 것이다
  const imported = new Set([...HTML.matchAll(/^import \{([^}]+)\} from/gm)]
    .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop())));
  const missing = called.filter(n => !BUILTIN.has(n) && !imported.has(n)
    && !new RegExp(`(?:function|const|let|var)\\s+${n}\\b|${n}\\s*[:=]\\s*(?:async\\s*)?(?:function|\\()`).test(HTML));
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
</div>
<div class="page-view" id="usagePage">
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
  ${grabConst('USAGE_TABS')}
  ${grabConst('usageIsAdmin')}
  let _ugClicks = 0, _ugTimer = null;
  ${grab('initUsageEasterEgg')}
  let _usageBackTo = 'home';
  ${grab('openUsagePage')}
  ${grab('closeUsagePage')}
  ${grab('usagePeople')}
  let _usageBusy = false;
  ${grab('loadUsage')}
  ${grab('renderUsage')}

  Object.assign(window, { usageStart, usageTab, usageFlush, usageDate, loadUsage,
                          renderUsage, initUsageEasterEgg, openUsagePage });
  window.__day = () => usageDay;
  initUsageEasterEgg();
</script>`;

await pg.setContent(HARNESS);

const tap = async n => { for (let i = 0; i < n; i++) await pg.click('#homeMemoCard .home-section-title'); };
const active = () => pg.evaluate(() => document.querySelector('.page-view.active')?.id);

console.log('\n■ 관리자 말고는 못 들어간다');
{
  await pg.evaluate(() => window.__setWho('kim@yeungnam.hs.kr'));
  await tap(7);
  check('다른 교사가 눌러도 아무 일 없다', (await active()) === 'homePage', await active());
  check('탭 자체가 안 뜬다', await pg.evaluate(() => !document.querySelector('[data-page="usage"]')));

  // 보기 모드(관리자가 남의 화면을 볼 때)도 막는다 — 남의 이름으로 남는다
  await pg.evaluate(() => window.__setWho('pkh910518@yeungnam.hs.kr', true));
  await tap(6);
  check('보기 모드에서도 안 열린다', (await active()) === 'homePage', await active());

  await pg.evaluate(() => window.__setWho('pkh910518@yeungnam.hs.kr'));
  await tap(4);
  check('4번으로는 안 열린다', (await active()) === 'homePage');
  await tap(1);
  check('5번째에 열린다', (await active()) === 'usagePage', await active());
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

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
