// 초과근무 탭 — index.html 에는 껍데기(탭 단추 + iframe)만 있다. 내용은 overtime.html.
//
// 지금은 관리자 혼자 시험한다. 탭이 다른 선생님에게 보이면 안 되고, 보기 모드
// ('실제 권한으로 보기')에서도 숨는다. 여러 선생님께 열 때는 여기 검사도 같이 고친다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const OT = fs.readFileSync(import.meta.dirname + '/../overtime.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));
const grab = name => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
};

console.log('\n■ 원본 배선 (정적)');
check('사이드바·탭바 단추는 처음에 숨어 있다',
      /class="main-nav-item" data-page="overtime" id="navOvertime" style="display:none;"/.test(HTML)
      && /class="tab-item" data-page="overtime" id="tabOvertime" style="display:none;"/.test(HTML));
const reveal = /\/\/ 초과근무 탭:[\s\S]{0,200}?if \(_IS_ADMIN\(\)\) \{([\s\S]{0,300}?)\n    \}/.exec(HTML);
check('관리자일 때만 보인다 (_IS_ADMIN — 보기 모드 제외)', reveal && /navOt\.style\.display = ''/.test(reveal[1]) && /tabOt\.style\.display = ''/.test(reveal[1]));
check('다른 곳에서 단추를 켜지 않는다', (HTML.match(/navOvertime/g) || []).length === 2 && (HTML.match(/tabOvertime/g) || []).length === 2);
check('특별실 예약 바로 아래 (공지 쓰기는 맨 끝 그대로)',
      /data-page="room"[^]*?<\/div>\s*<div class="main-nav-item" data-page="overtime"/.test(HTML)
      && [...HTML.matchAll(/class="main-nav-item" data-page="([a-z]+)"/g)].map(m => m[1]).at(-1) === 'notice');
check('화면 목록에 들어 있다', /'seat','overtime','usage','notice'\]\.forEach/.test(HTML));
check('들어오면 프레임을 연다', /if\(page === 'overtime'\) openOvertimeFrame\(\);/.test(HTML));
check('껍데기는 iframe 하나', /<div class="page-view" id="overtimePage">\s*<iframe id="overtimePageFrame" title="초과근무"/.test(HTML));
check('보기 모드 토큰은 넘기지 않는다 (남의 이름으로 신청이 들어가면 안 된다)', !/overtime\.html[^\n]*impersonate/.test(HTML));
check('overtime.html 도 지금은 관리자만', /const OPEN_TO_ALL = false;/.test(OT) && /if \(!OPEN_TO_ALL && !isAdmin\(\)\)/.test(OT));
check('overtime.html 은 Firebase 에 신청을 쓰지 않는다 (명렬 읽기만)',
      !/setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction/.test(OT) && /getDoc\(doc\(db, 'acl', 'emailByName'\)\)/.test(OT));
check('웹앱 주소는 script.google.com …/exec 꼴만 받는다', /const API_RE = \/\^https:\\\/\\\/script\\\.google\\\.com\\\/macros\\\/s\\\//.test(OT));

console.log('\n■ 프레임 — 처음엔 띄우고, 다음부터는 새로 읽으라고만');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.route('http://ot.test/**', r => {
  const u = r.request().url();
  if (u.includes('overtime.html')) return r.fulfill({ contentType: 'text/html', body: `<script>
    window.got = []; addEventListener('message', e => { got.push([e.origin, e.data && e.data.type]); });
    window.loads = (parent.loadCount = (parent.loadCount || 0) + 1);</script>` });
  return r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">
    <iframe id="overtimePageFrame"></iframe>
    <script>const APP_VER = 'ver9.99';\n${grab('openOvertimeFrame')}</script>` });
});
await pg.goto('http://ot.test/index.html');
check('처음 열 때 주소: overtime.html?in=1&v=버전', await pg.evaluate(() => { openOvertimeFrame(); return document.getElementById('overtimePageFrame').getAttribute('src'); })
      === 'overtime.html?in=1&v=ver9.99');
await pg.waitForFunction(() => window.loadCount === 1);
await pg.evaluate(() => openOvertimeFrame());
await pg.waitForTimeout(150);
const f = pg.frames().find(x => x.url().includes('overtime.html'));
check('두 번째부터는 다시 띄우지 않는다 (쓰던 신청서가 남게)', await pg.evaluate(() => window.loadCount) === 1);
check('대신 같은 출처로 「새로 읽기」 를 알린다', JSON.stringify(await f.evaluate(() => window.got)) === JSON.stringify([['http://ot.test', 'ot-refresh']]), await f.evaluate(() => window.got));
check('화면 오류 없음', errs.length === 0, errs);
await b.close();

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
