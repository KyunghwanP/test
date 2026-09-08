// 현황판 전체 공지 — 걸러내기와 그림 키.
//
// 공지는 관리자만 쓰지만, 글은 대부분 '붙여넣기'로 들어온다. 한글·워드·웹페이지에서
// 복사하면 스크립트도 표도 style 도 통째로 딸려 온다. 그것을 그대로 저장하면
// 공지 하나가 전 교사의 첫 화면을 덮을 수 있다 — 그래서 쓸 수 있는 것만 남긴다.
//
// 그림은 R2 에 있고 문서에는 키만 남는다. 키가 곧 파일 경로가 되므로,
// 바깥에서 들어온 문자열이 키 자리에 앉지 못하게 하는 것이 두 번째로 보는 것이다.
//
// index.html 은 Firebase 없이는 못 뜬다. 여기서는 걸러내기 함수만 원본에서 그대로
// 떼어내 붙인 하네스로 확인한다.
// 시각을 다루므로 한국 시각으로 못 박고 돈다. 검사 기계는 UTC 라, 그대로 두면
// '현지 시각으로 내보내야 한다'는 것을 못 잡는다 — UTC 와 현지가 같아지기 때문이다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

// 원본에서 그대로 떼어 온다 — 베껴 적으면 원본이 바뀌어도 통과해 버린다
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
const grabConst = name => {
  const m = new RegExp(`^const ${name}\\b[^\\n]*(\\n(?![a-zA-Z/]).*)*`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  return m[0];
};

console.log('\n■ 배선 (정적)');
check('확성기가 헤더에 있다', /id="noticeBtn"/.test(HTML) && /📢/.test(HTML));
check('종이 아니라 확성기다(상벌점 알림과 뜻이 겹치지 않게)',
      !/id="noticeBtn"[^>]*>🔔/.test(HTML));
check('처음엔 숨어 있다', /id="noticeBtn"[^>]*style="display:none;"/.test(HTML));
check('관리자에게만 그린다', /function noticeBtnVisible\(\)/.test(HTML));
check('관리자는 게시중인 것이 없어도 들어갈 수 있다 (안 그러면 쓸 문이 없다)',
      /if \(_IS_ADMIN\(\)\) return true;/.test(HTML));
check('전체 공개는 한 줄만 풀면 된다', /return false && noticeLiveList\(\)\.length > 0;/.test(HTML));
check('기간이 바뀌는 순간을 시계로 잡는다',
      /function startNoticeClock\(\)/.test(HTML) && /setInterval\(\(\) => \{[\s\S]{0,200}noticeStateSig\(\)/.test(HTML));
check('상태가 안 바뀌면 화면을 안 건드린다', /if \(sig === _noticeLastSig\) return;/.test(HTML));
check('배포를 문서 안의 scope 로 가른다',
      /const NOTICE_SCOPE\s*=\s*'test'/.test(HTML) && /if \(scope !== NOTICE_SCOPE\) return;/.test(HTML));
check('예전 문서(공지 하나이던 시절)도 계속 읽는다',
      /NOTICE_LEGACY_ID = \{ test: 'board-test', live: 'board' \}/.test(HTML));
check('전체 새로고침 신호는 공지로 안 센다', /if \(d\.id === 'reload'\) return;/.test(HTML));
check('청소는 모든 공지의 키를 기준으로 한다 (안 그러면 남의 그림이 지워진다)',
      /keep: noticeAllKeys\(keys\)/.test(HTML));
check('로그인 뒤에 켠다', /watchReloadSignal\(\);\s*\n\s*initNotice\(\);/.test(HTML));
check('목록을 스냅샷으로 본다', /onSnapshot\(collection\(fbDb, 'appNotice'\)/.test(HTML));
check('뒤로가기로 닫힌다',
      /popstate[\s\S]{0,900}getElementById\('noticeModal'\)\?\.classList\.contains\('open'\)[\s\S]{0,300}doCloseNoticeModal\(\)/.test(HTML));
check('보는 창은 그냥 닫힌다(쓰기가 탭으로 나갔으므로)',
      !/_noticeEditing && !confirm\(/.test(HTML));
check('ESC 로도 닫힌다',
      /Escape[\s\S]{0,200}getElementById\('noticeModal'\)\?\.classList\.contains\('open'\)[\s\S]{0,80}closeNoticeModalBtn\(\)/.test(HTML));
check('쓰기는 탭으로 나가 있다',
      /id="noticePage"/.test(HTML) && /function initNoticePage\(\)/.test(HTML));
check('쓰기 탭도 관리자에게만 뜬다',
      /navN\.style\.display = admin \? '' : 'none'/.test(HTML) && /id="navNotice"[^>]*style="display:none;"/.test(HTML));
check('쓰기 탭이 navigateTo 목록에 있다', /'usage','notice'\]\.forEach/.test(HTML));
check('쓰다 만 채로 나가면 되묻는다',
      /currentPage === 'notice' && page !== 'notice' && !noticeMayLeave\(\)\) return;/.test(HTML));
check('고친 것이 없으면 안 묻는다',
      /if \(!_noticeEditing \|\| !_noticeDirty\) return true;/.test(HTML));
check('남이 저장해도 쓰던 글은 안 건드린다',
      /if \(!_noticeEditing\) renderNoticeAdminList\(\);/.test(HTML));
check('보는 창은 저절로 갱신된다',
      /modal\?\.classList\.contains\('open'\)\) renderNoticeModal\(\);/.test(HTML));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// localStorage 를 쓰려면 진짜 출처가 있어야 한다(setContent 로는 막힌다)
await pg.route('https://ynhs.test/**', r => r.fulfill({
  contentType: 'text/html; charset=utf-8',
  body: `<!doctype html><meta charset="utf-8"><body><script>
    ${grabConst('NOTICE_TAGS')}
    ${grabConst('NOTICE_DROP')}
    ${grabConst('NOTICE_STYLES')}
    ${grabConst('NOTICE_KEY_RE')}
    ${grabConst('NOTICE_ZWSP')}
    const NOTICE_SEEN_KEY = 'noticeSeenAt';
    let _noticeList = [];
    ${grab('noticeCleanStyle')}
    ${grab('noticeSanitize')}
    ${grab('noticeKeysIn')}
    ${grab('noticeStateOf')}
    ${grabConst('noticeLiveList')}
    ${grab('noticeUnseen')}
    ${grab('noticeTitleOf')}
    ${grab('noticeAllKeys')}
    ${grabConst('NOTICE_SNOOZE_KEY')}
    ${grabConst('noticeToday')}
    ${grab('noticeSnoozeMap')}
    ${grab('noticeSnoozed')}
    ${grab('noticeSnoozeToday')}
    function closeNoticeModalBtn(){ window.__closed = true; }
    ${grab('noticePeriodText')}
    ${grab('noticeToInput')}
    ${grab('noticeFromInput')}
    ${grab('noticeWhenText')}
    window.clean   = h => noticeSanitize(h);
    window.keys    = h => noticeKeysIn(h);
    window.state   = (d, now) => noticeStateOf(d, now);
    window.live    = (list, now) => { _noticeList = list; return noticeLiveList(now).map(n => n.id); };
    window.titleOf = n => noticeTitleOf(n);
    window.allKeys = (list, extra) => { _noticeList = list; return noticeAllKeys(extra); };
    window.snoozeReset = () => { localStorage.removeItem(NOTICE_SNOOZE_KEY); window.__closed = false; };
    window.snoozeNow   = list => { _noticeList = list; noticeSnoozeToday(); return window.__closed; };
    window.isSnoozed   = n => noticeSnoozed(n);
    window.snoozeRaw   = () => localStorage.getItem(NOTICE_SNOOZE_KEY);
    window.snoozeSet   = v => localStorage.setItem(NOTICE_SNOOZE_KEY, v);
    window.today_      = () => noticeToday();
    window.period  = (a, b) => noticePeriodText(a, b);
    window.toIn    = ms => noticeToInput(ms);
    window.fromIn  = v => noticeFromInput(v);
    window.unseen  = (list, seen) => { _noticeList = Array.isArray(list) ? list : [list];
      if (seen === null) localStorage.removeItem(NOTICE_SEEN_KEY);
      else localStorage.setItem(NOTICE_SEEN_KEY, String(seen));
      return noticeUnseen(); };
    window.when    = t => noticeWhenText(t);
  </script></body>`,
}));
await pg.goto('https://ynhs.test/harness');

const K  = 'notices/test/board/f1abc.jpg';
const K2 = 'notices/test/board/f2def.jpg';

console.log('\n■ 붙여넣기로 들어온 것 걸러내기');
{
  const clean = h => pg.evaluate(x => window.clean(x), h);

  check('스크립트는 통째로 사라진다',
        !/script|alert/i.test(await clean('<p>안내<script>alert(1)</script></p>')),
        await clean('<p>안내<script>alert(1)</script></p>'));
  check('onerror 같은 속성이 안 남는다',
        !/onerror|onclick/i.test(await clean(`<img data-k="${K}" onerror="alert(1)">`)),
        await clean(`<img data-k="${K}" onerror="alert(1)">`));
  check('iframe 도 사라진다', !/iframe/i.test(await clean('<iframe src="//x"></iframe>글')));
  check('허용 안 된 태그는 벗기되 글자는 남긴다',
        (await clean('<table><tr><td>3교시 감독</td></tr></table>')).includes('3교시 감독'),
        await clean('<table><tr><td>3교시 감독</td></tr></table>'));

  // 서식은 살아야 한다 — 이게 이 기능의 목적이다
  const styled = await clean('<span style="color:#dc2626;font-size:26px;font-weight:700">1교시 감독</span>');
  check('글자색이 남는다', /color:\s*(#dc2626|rgb\(220, 38, 38\))/.test(styled), styled);
  check('글자 크기가 남는다', /font-size:\s*26px/.test(styled), styled);
  check('굵기가 남는다', /font-weight:\s*(700|bold)/.test(styled), styled);
  check('굵게·기울임 태그는 그대로', (await clean('<b>가</b><i>나</i><u>다</u>')) === '<b>가</b><i>나</i><u>다</u>',
        await clean('<b>가</b><i>나</i><u>다</u>'));

  // 목록 여섯 가지 밖의 것은 버린다 — 이게 없으면 공지가 화면을 덮을 수 있다
  const evil = await clean('<div style="position:fixed;inset:0;z-index:99999;background:red;color:#111">덮기</div>');
  check('position 은 안 남는다', !/position/i.test(evil), evil);
  check('z-index 도 안 남는다', !/z-index/i.test(evil), evil);
  check('그래도 글자색은 남는다', /color:/.test(evil), evil);
  const bg = await clean('<span style="background-image:url(https://evil.example/x.png);color:red">가</span>');
  check('배경 이미지로 바깥 요청을 못 낸다', !/url\(|evil\.example/.test(bg), bg);
}

console.log('\n■ 링크');
{
  const clean = h => pg.evaluate(x => window.clean(x), h);
  const ok = await clean('<a href="https://school.example/notice">시정표</a>');
  check('http 주소는 남는다', /href="https:\/\/school\.example\/notice"/.test(ok), ok);
  check('새 탭으로 연다', /target="_blank"/.test(ok) && /rel="noopener/.test(ok), ok);
  const js = await clean('<a href="javascript:alert(1)">눌러보세요</a>');
  check('javascript: 는 링크가 안 된다', !/href|javascript/i.test(js), js);
  check('그래도 글자는 남는다', js.includes('눌러보세요'), js);
}

console.log('\n■ 그림 — 키만 남고 주소는 안 남는다');
{
  const clean = h => pg.evaluate(x => window.clean(x), h);

  const ok = await clean(`<img data-k="${K}" src="blob:https://x/abc">`);
  check('키는 남는다', ok.includes(`data-k="${K}"`), ok);
  // 남의 주소가 남으면 공지를 여는 사람 전원이 그 서버로 요청을 보내게 된다
  check('src 는 지워진다', !/src=/.test(ok), ok);

  for (const [label, k] of [
    ['상위 경로',   'notices/../secret.jpg'],
    ['남의 폴더',   '../../etc/passwd'],
    ['확장자 다름', 'notices/test/board/f1.png'],
    ['빈 값',       ''],
  ]) {
    const r = await clean(`<img data-k="${k}">`);
    check(`${label} → 그림이 통째로 빠진다`, !/<img/.test(r), r);
  }
  const noKey = await clean('<img src="https://evil.example/track.gif">');
  check('키 없는 바깥 그림은 안 들어온다', !/<img/.test(noKey), noKey);
}

console.log('\n■ 쓰이는 그림 키 모으기 (청소의 기준)');
{
  const keys = h => pg.evaluate(x => window.keys(x), h);
  check('두 장을 다 찾는다',
        JSON.stringify(await keys(`<p>가</p><img data-k="${K}"><img data-k="${K2}">`)) === JSON.stringify([K, K2]));
  check('같은 그림이 두 번 나와도 하나로',
        (await keys(`<img data-k="${K}"><img data-k="${K}">`)).length === 1);
  check('이상한 키는 안 센다', (await keys('<img data-k="../x.jpg">')).length === 0);
  check('그림이 없으면 빈 목록', (await keys('<p>글만</p>')).length === 0);
  // 여기서 놓친 키는 청소가 '안 쓰이는 것'으로 보고 지운다 — 살아 있는 공지의
  // 그림이 사라지는 길이라, 걸러내기와 같은 기준이어야 한다
  const cleaned = await pg.evaluate(k => window.keys(window.clean(`<img data-k="${k}">`)), K);
  check('걸러낸 뒤에도 같은 키가 나온다', cleaned[0] === K, cleaned);
}

console.log('\n■ 게시 기간');
{
  const T = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi).getTime();
  const NOON = T(2026,9,8,12,0);
  const st = (d, now) => pg.evaluate(a => window.state(a[0], a[1]), [d, now]);
  const N = { html: '감독 변경' };

  check('기간을 안 정하면 늘 뜬다', (await st({ ...N }, NOON)) === 'live');
  check('공지가 없으면 기간과 무관', (await st({ html: '' }, NOON)) === 'none');

  const day = { ...N, from: T(2026,9,8,7,0), until: T(2026,9,8,17,0) };
  check('시작 전에는 안 뜬다',  (await st(day, T(2026,9,8,6,59))) === 'before');
  check('시작 시각에는 뜬다',   (await st(day, T(2026,9,8,7,0)))  === 'live');
  check('기간 안에는 뜬다',     (await st(day, NOON))             === 'live');
  check('종료 시각까지는 뜬다', (await st(day, T(2026,9,8,17,0))) === 'live');
  check('종료 뒤에는 안 뜬다',  (await st(day, T(2026,9,8,17,1))) === 'after');

  check('시작만 정하면 그 뒤로 계속',
        (await st({ ...N, from: T(2026,9,8,7,0) }, T(2027,1,1,0,0))) === 'live');
  check('종료만 정하면 그때까지',
        (await st({ ...N, until: T(2026,9,8,17,0) }, T(2026,1,1,0,0))) === 'live');
  check('종료만 정해도 지나면 끝',
        (await st({ ...N, until: T(2026,9,8,17,0) }, T(2026,9,9,0,0))) === 'after');

  // 기간 밖이면 안 본 표시도 뜨면 안 된다 — 눌러도 볼 게 없다
  const u = (d, seen) => pg.evaluate(a => window.unseen(a[0], a[1]), [d, seen]);
  check('아직 안 열린 공지는 빨간 점이 안 뜬다',
        (await u({ ...N, updatedAt: 5, from: Date.now() + 3600e3 }, null)) === false);
  check('끝난 공지도 빨간 점이 안 뜬다',
        (await u({ ...N, updatedAt: 5, until: Date.now() - 3600e3 }, null)) === false);
  check('기간 안이면 뜬다', (await u({ ...N, updatedAt: 5 }, null)) === true);
}

console.log('\n■ 여러 건일 때 — 지금 뜨는 것만 고른다');
{
  const T = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi).getTime();
  const NOON = T(2026,9,8,12,0);
  const LIST = [
    { id:'a', html:'늘 뜨는 것',   updatedAt: 30 },
    { id:'b', html:'오늘 하루',     updatedAt: 20, from: T(2026,9,8,7,0),  until: T(2026,9,8,17,0) },
    { id:'c', html:'다음 주 예약',  updatedAt: 40, from: T(2026,9,15,7,0) },
    { id:'d', html:'지난 주에 끝남', updatedAt: 10, until: T(2026,9,1,17,0) },
  ];
  const live = await pg.evaluate(a => window.live(a[0], a[1]), [LIST, NOON]);
  check('기간에 걸린 것만 나온다', JSON.stringify(live) === '["a","b"]', live);
  check('예약된 것은 빠진다', !live.includes('c'), live);
  check('끝난 것도 빠진다',   !live.includes('d'), live);

  // 빨간 점은 '지금 뜨는 것' 기준이어야 한다. 예약해 둔 것(c)이 제일 최근에
  // 고쳐졌다고 점을 켜면, 눌러도 볼 것이 없다.
  const u = (list, seen) => pg.evaluate(a => window.unseen(a[0], a[1]), [list, seen]);
  const LIVE_ONLY = LIST.filter(n => ['a','b'].includes(n.id));
  check('안 본 것이 있으면 점이 뜬다', (await u(LIVE_ONLY, 10)) === true);
  check('다 봤으면 점이 사라진다',     (await u(LIVE_ONLY, 30)) === false);
  check('게시중인 것이 없으면 점도 없다',
        (await u(LIST.filter(n => n.id === 'c'), null)) === false);
}

console.log('\n■ 그림 크게 보기');
{
  check('공지 안 그림을 누르면 커진다',
        /function openNoticeZoom\(src\)/.test(HTML) &&
        /closest\('\.notice-view img'\)[\s\S]{0,80}openNoticeZoom\(img\.src\)/.test(HTML));
  check('다시 그려도 계속 눌린다 (위임으로 받는다)',
        /getElementById\('noticeBody'\)\?\.addEventListener\('click'/.test(HTML));
  check('처음에는 화면에 맞춰 전체를 보여준다', /ov\.classList\.remove\('actual'\);/.test(HTML));
  check('누르면 원래 크기로 바뀐다', /function toggleNoticeZoomActual\(\)/.test(HTML));
  check('원래 크기에서는 훑어볼 수 있다',
        /\.notice-zoom\.actual \.notice-zoom-scroll\{display:block;\}/.test(HTML) &&
        /\.notice-zoom-scroll\{[^}]*overflow:auto/.test(HTML));
  check('표는 왼쪽 위부터 보게 맞춘다', /sc\.scrollTop = 0; sc\.scrollLeft = 0;/.test(HTML));
  check('닫으면 그림을 놓아준다(메모리)', /getElementById\('noticeZoomImg'\)\.src = '';/.test(HTML));
  check('뒤로가기로 공지 창보다 먼저 닫힌다',
        /noticeImgZoom'\)\?\.classList\.contains\('open'\)\) \{\s*\n\s*closeNoticeZoom\(\); armExitGuard\(\); return;[\s\S]{0,200}noticeModal'\)\?\.classList\.contains\('open'\)/.test(HTML));
  check('ESC 로도 공지 창보다 먼저 닫힌다',
        /noticeImgZoom'\)\?\.classList\.contains\('open'\)\) \{\s*\n\s*closeNoticeZoom\(\); return;[\s\S]{0,120}noticeModal'\)/.test(HTML));

  // 모바일에서 상자가 더 못 커지면 그림이 줄어야 한다. none 이면 밖으로 삐져나가
  // 가로 스크롤이 생긴다 — 실제로 그랬다.
  check('그림이 창 밖으로 안 나간다',
        /#noticeModal \.notice-view > img\{max-width:100%;\}/.test(HTML));
  check('그림을 품은 문단은 풀어 준다(넓은 화면에서 창이 커지게)',
        /#noticeModal \.notice-view > \*:has\(img\)\{max-width:none;\}/.test(HTML));
}

console.log('\n■ 처음 들어올 때 저절로 띄우기');
{
  check('배선 — 첫 목록을 받으면 한 번 시도한다',
        /renderNoticeEditState\(\);\s*\n\s*noticeAutoOpen\(\);/.test(HTML));
  check('배선 — 앱을 연 뒤 한 번만', /if \(_noticeAutoDone\) return;/.test(HTML));
  check('배선 — 볼 수 없는 사람에게는 안 띄운다', /if \(!noticeBtnVisible\(\)\) return;/.test(HTML));
  check('배선 — 게시중인 것이 없으면 안 띄운다',
        /const live = noticeLiveList\(\);\s*\n\s*if \(!live\.length\) return;/.test(HTML));
  check('배선 — 공지 쓰는 중에는 앞을 안 가린다',
        /getElementById\('noticePage'\)\?\.classList\.contains\('active'\)\) return;/.test(HTML));
  check('배선 — 확성기로 직접 열면 저절로-뜸 상태가 풀린다',
        /if \(!auto\) _noticeAuto = false;/.test(HTML));
  check('배선 — 저절로 뜬 창만 한 장씩 넘긴다',
        /if \(_noticeAuto\) \{ renderNoticeAutoStep\(list\); return; \}/.test(HTML));
  check('배선 — 오늘 그만보기·다음은 그 화면에만 붙는다',
        /function renderNoticeAutoStep\(list\)\{[\s\S]{0,1400}noticeSnoozeToday\(\)[\s\S]{0,400}noticeAutoStep\(1\)/.test(HTML) &&
        !/noticeSnoozeToday\(\)[\s\S]{0,80}공지 관리/.test(HTML));
  check('배선 — 마지막 장에서만 닫기가 나온다',
        /last\s*\n?\s*\? '<button class="notice-btn primary" onclick="closeNoticeModalBtn\(\)">닫기/.test(HTML));
  check('배선 — 저절로 열 때는 첫 장부터', /_noticeAutoIdx = 0;\s*\n\s*openNoticeModal\(true\);/.test(HTML));

  check('저절로 뜬 창은 게시중인 것만 보여준다',
        /if \(_noticeAuto\) return noticeLiveList\(\);[\s\S]{0,120}return _IS_ADMIN\(\) \? _noticeList/.test(HTML));

  await pg.evaluate(() => window.snoozeReset());
  const N = (id, upd) => ({ id, html: '감독 변경', updatedAt: upd });
  const a = N('a', 100), b = N('b', 200);

  check('처음에는 접힌 것이 없다', (await pg.evaluate(x => window.isSnoozed(x), a)) === false);
  const closed = await pg.evaluate(l => window.snoozeNow(l), [a, b]);
  check('오늘 그만보기를 누르면 창이 닫힌다', closed === true);
  check('그 공지는 오늘 안 뜬다', (await pg.evaluate(x => window.isSnoozed(x), a)) === true);
  check('같이 떠 있던 것도 함께 접힌다', (await pg.evaluate(x => window.isSnoozed(x), b)) === true);

  // 여기가 이 기능의 핵심이다. 오늘 안에 감독이 또 바뀌면 접어 뒀어도 다시 떠야 한다.
  check('내용을 고치면 접어 뒀어도 다시 뜬다',
        (await pg.evaluate(x => window.isSnoozed(x), N('a', 101))) === false);
  check('안 고친 것은 그대로 접혀 있다',
        (await pg.evaluate(x => window.isSnoozed(x), a)) === true);
  check('새로 올라온 공지는 접혀 있지 않다',
        (await pg.evaluate(x => window.isSnoozed(x), N('c', 300))) === false);

  // 날이 바뀌면 풀린다
  await pg.evaluate(() => window.snoozeSet(JSON.stringify({ a: { v: 100, d: '2000-01-01' } })));
  check('어제 접은 것은 오늘 다시 뜬다', (await pg.evaluate(x => window.isSnoozed(x), a)) === false);

  // 지난 날짜가 쌓이면 저장소가 계속 커진다
  await pg.evaluate(() => window.snoozeSet(JSON.stringify({
    old1: { v: 1, d: '2000-01-01' }, old2: { v: 2, d: '2000-01-02' } })));
  await pg.evaluate(l => window.snoozeNow(l), [a]);
  const kept = JSON.parse(await pg.evaluate(() => window.snoozeRaw()));
  check('지난 날짜는 지운다', Object.keys(kept).join() === 'a', kept);
  check('오늘 날짜로 적힌다', kept.a.d === (await pg.evaluate(() => window.today_())), kept);

  // 저장소가 망가져 있어도 죽으면 안 된다(사생활 보호 모드·손으로 고친 값)
  await pg.evaluate(() => window.snoozeSet('{망가진 값'));
  check('저장소가 깨져 있어도 안 죽는다', (await pg.evaluate(x => window.isSnoozed(x), a)) === false);
  await pg.evaluate(() => window.snoozeSet('"글자"'));
  check('모양이 달라도 안 죽는다', (await pg.evaluate(x => window.isSnoozed(x), a)) === false);
}

console.log('\n■ 목록에 뭐라고 적히나');
{
  const t = n => pg.evaluate(x => window.titleOf(x), n);
  check('제목을 적었으면 그대로', (await t({ title: '9월 모의고사 감독', html: '<p>내용</p>' })) === '9월 모의고사 감독');
  check('안 적었으면 본문 첫 줄', (await t({ html: '<p>3교시 감독 변경</p><p>둘째 줄</p>' })) === '3교시 감독 변경');
  check('공백만 적은 제목은 안 쓴다', (await t({ title: '   ', html: '<p>본문</p>' })) === '본문');
  check('너무 길면 자른다', (await t({ html: '<p>' + '가'.repeat(80) + '</p>' })).length === 40);
  check('본문도 비면 그렇게 적는다', (await t({ html: '' })) === '(내용 없음)');
  // 목록에 태그가 그대로 보이면 안 된다
  check('태그가 글자로 새지 않는다',
        !/[<>]/.test(await t({ html: '<b style="color:red">굵은 제목</b>' })),
        await t({ html: '<b style="color:red">굵은 제목</b>' }));
}

console.log('\n■ 그림 청소 기준 (여기가 틀리면 남의 그림이 지워진다)');
{
  const K = i => `notices/test/board/f${i}.jpg`;
  const LIST = [
    { id:'a', html:'가', keys:[K(1), K(2)] },
    { id:'b', html:'나', keys:[K(3)] },
  ];
  const all = await pg.evaluate(a => window.allKeys(a[0], a[1]), [LIST, []]);
  check('모든 공지의 키를 모은다', all.length === 3 && all.includes(K(3)), all);
  const withNew = await pg.evaluate(a => window.allKeys(a[0], a[1]), [LIST, [K(9)]]);
  check('방금 올린 것도 지킨다', withNew.includes(K(9)) && withNew.length === 4, withNew);
  const dup = await pg.evaluate(a => window.allKeys(a[0], a[1]), [LIST, [K(1)]]);
  check('겹치면 한 번만', dup.length === 3, dup);
  const bad = await pg.evaluate(a => window.allKeys(a[0], a[1]), [[{ keys:['../x'] }], []]);
  check('이상한 키는 안 센다', bad.length === 0, bad);
}

console.log('\n■ 기간 적기·읽기');
{
  const T = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi).getTime();
  // datetime-local 은 현지 시각 문자열만 받는다. UTC 로 내보내면 9시간 어긋난다.
  check('칸에 넣는 값이 현지 시각',
        (await pg.evaluate(t => window.toIn(t), T(2026,9,8,7,5))) === '2026-09-08T07:05',
        await pg.evaluate(t => window.toIn(t), T(2026,9,8,7,5)));
  check('빈 칸은 빈 문자열', (await pg.evaluate(() => window.toIn(0))) === '');
  check('칸에서 읽은 값이 같은 시각으로 돌아온다',
        (await pg.evaluate(() => window.fromIn('2026-09-08T07:05'))) === T(2026,9,8,7,5));
  check('빈 칸은 제한 없음(0)', (await pg.evaluate(() => window.fromIn(''))) === 0);
  check('말이 안 되는 값도 0', (await pg.evaluate(() => window.fromIn('그제'))) === 0);

  const p = (a,b) => pg.evaluate(x => window.period(x[0], x[1]), [a,b]);
  check('같은 날이면 날짜는 한 번만',
        (await p(T(2026,9,8,7,0), T(2026,9,8,17,0))) === '9.8 07:00~17:00', await p(T(2026,9,8,7,0), T(2026,9,8,17,0)));
  check('날이 넘어가면 둘 다 적는다',
        (await p(T(2026,9,8,7,0), T(2026,9,9,17,0))) === '9.8 07:00 ~ 9.9 17:00');
  check('시작만 있으면 "부터"', (await p(T(2026,9,8,7,0), 0)) === '9.8 07:00부터');
  check('종료만 있으면 "까지"', (await p(0, T(2026,9,8,17,0))) === '9.8 17:00까지');
  check('둘 다 없으면 빈 칸', (await p(0, 0)) === '');
}

console.log('\n■ 안 본 공지 표시');
{
  const u = (d, seen) => pg.evaluate(a => window.unseen(a[0], a[1]), [d, seen]);
  check('공지가 없으면 점도 없다', (await u({ html: '', updatedAt: 5 }, null)) === false);
  check('한 번도 안 봤으면 점이 뜬다', (await u({ html: '내용', updatedAt: 5 }, null)) === true);
  check('본 뒤에는 점이 사라진다', (await u({ html: '내용', updatedAt: 5 }, 5)) === false);
  check('고쳐 올리면 다시 뜬다', (await u({ html: '내용', updatedAt: 9 }, 5)) === true);
  check('예전 것으로 되돌려도 안 뜬다', (await u({ html: '내용', updatedAt: 3 }, 5)) === false);
}

console.log('\n■ 올린 시각');
{
  check('없으면 빈 칸', (await pg.evaluate(() => window.when(0))) === '');
  const t = await pg.evaluate(() => window.when(new Date(2026, 8, 8, 7, 5).getTime()));
  check('두 자리로 맞춘다 (한국 시각)', t === '2026.09.08 07:05', t);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
