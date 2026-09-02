// 자리 배치를 '페이지로' 열었을 때 앱 안에 남는지.
//
// 예전에는 window.open 으로 새 브라우저 탭을 띄웠다. 로그인 상태는 같아도
// 앱을 벗어나서, 돌아올 길이 브라우저 뒤로가기밖에 없었다.
// 지금은 탭 화면 안의 iframe 으로 들어가고 「돌아가기」로 되돌아온다.
//
// index.html 은 Firebase 없이는 못 뜬다. 여기서는 화면 전체를 띄우는 대신
// 자리 배치 배선만 떼어내 붙인 하네스로 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,300) : ''));

// 원본에서 그대로 떼어 온다 — 베껴 적으면 원본이 바뀌어도 통과해 버린다
const grab = (name) => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
const block = (from, to) => {
  const a = HTML.indexOf(from);
  if (a < 0) throw new Error('못 찾음: ' + from);
  const b = HTML.indexOf(to, a);
  return HTML.slice(a, b < 0 ? undefined : b);
};

console.log('\n■ 원본 배선 (정적)');
check('새 브라우저 탭으로 안 띄운다', !/seatOpenBtn[\s\S]{0,300}window\.open/.test(HTML));
check('페이지 화면이 있다', /id="seatPage"/.test(HTML) && /id="seatPageFrame"/.test(HTML));
check('돌아가기 버튼이 있다', /id="seatBackBtn"/.test(HTML) && /돌아가기/.test(HTML));
// 목록 끝을 못 박으면 탭이 하나 늘 때마다 깨진다. 들어 있는지만 본다.
check('탭 목록에 seat 이 들어 있다',
      /\['home',(?:'[a-z]+',)*'seat'[,\]]/.test(HTML));
check('다른 탭으로 나가면 프레임을 비운다',
      /page !== 'seat'[\s\S]{0,200}seatPageFrame[\s\S]{0,120}about:blank/.test(HTML));
check('ESC 는 페이지면 돌아가기, 아니면 모달 닫기',
      /seatPage'\)\?\.classList\.contains\('active'\)\) \{ closeSeatPage\(\); return; \}/.test(HTML));

// ── 실제로 눌러 본다 ──
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

const openSeatModalSrc = grab('openSeatModal');
const closeSeatModalSrc = grab('closeSeatModal');
const openSeatPageSrc  = grab('openSeatPage');
const closeSeatPageSrc = grab('closeSeatPage');

await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>.page-view{display:none}.page-view.active{display:block}
.jd-overlay{display:none}.jd-overlay.open{display:block}</style>
<div class="page-view active" id="searchPage">종합검색</div>
<div class="page-view" id="seatPage">
  <button id="seatBackBtn">← 돌아가기</button><span id="seatPageTitle"></span>
  <iframe id="seatPageFrame"></iframe>
</div>
<div class="jd-overlay" id="seatModal"><iframe id="seatFrame"></iframe></div>
<script>
  // openSeatModal 이 쓰는 것들만 가짜로 채운다
  let exitArmTimer = 0;
  const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';
  const fbAuth = { currentUser: { email: ADMIN_EMAIL } };
  const getMyHomeroom = () => '';
  const REMOTE_BASE = '';
  let _seatBackTo = 'search';
  const navLog = [];
  function navigateTo(page){
    navLog.push(page);
    ['search','seat'].forEach(p => {
      const el = document.getElementById(p + 'Page');
      if (el) el.classList.toggle('active', p === page);
    });
    if (page !== 'seat') {
      const sf = document.getElementById('seatPageFrame');
      if (sf && sf.src && sf.src !== 'about:blank') sf.src = 'about:blank';
    }
  }
  window.navLog = navLog;
  ${openSeatModalSrc}
  ${closeSeatModalSrc}
  ${openSeatPageSrc}
  ${closeSeatPageSrc}
  document.getElementById('seatBackBtn').addEventListener('click', closeSeatPage);
  window.openSeatModal = openSeatModal; window.openSeatPage = openSeatPage;
</script>`);

console.log('\n■ 모달 → 페이지 → 돌아가기');
{
  await pg.evaluate(() => window.openSeatModal('2-3'));
  check('모달이 열린다', await pg.$eval('#seatModal', e => e.classList.contains('open')));
  const modalSrc = await pg.$eval('#seatFrame', e => e.getAttribute('src'));
  check('모달 프레임에 그 반이 들어간다', /class=2-3/.test(modalSrc), modalSrc);

  await pg.evaluate(() => window.openSeatPage());
  check('모달이 닫힌다', !(await pg.$eval('#seatModal', e => e.classList.contains('open'))));
  check('자리 배치 페이지로 넘어간다', await pg.$eval('#seatPage', e => e.classList.contains('active')));
  check('종합검색은 숨는다', !(await pg.$eval('#searchPage', e => e.classList.contains('active'))));
  const pageSrc = await pg.$eval('#seatPageFrame', e => e.getAttribute('src'));
  check('같은 주소를 앱 안 프레임에 싣는다', /class=2-3/.test(pageSrc), pageSrc);
  check('머리글에 반이 뜬다', /2-3/.test(await pg.$eval('#seatPageTitle', e => e.textContent)),
        await pg.$eval('#seatPageTitle', e => e.textContent));

  await pg.click('#seatBackBtn');
  check('돌아가기로 원래 탭에 복귀', await pg.$eval('#searchPage', e => e.classList.contains('active')));
  check('자리 배치 페이지는 닫힌다', !(await pg.$eval('#seatPage', e => e.classList.contains('active'))));
  // 비우지 않으면 다음에 다른 반을 열 때 이전 반이 잠깐 스쳐 보인다
  check('나가면서 프레임을 비운다',
        (await pg.$eval('#seatPageFrame', e => e.getAttribute('src'))) === 'about:blank',
        await pg.$eval('#seatPageFrame', e => e.getAttribute('src')));
  check('탭 이동은 두 번뿐 (seat → search)',
        JSON.stringify(await pg.evaluate(() => window.navLog)) === '["seat","search"]',
        await pg.evaluate(() => window.navLog));
}

console.log('\n■ 다른 반으로 다시 열어도 섞이지 않는다');
{
  await pg.evaluate(() => { window.openSeatModal('1-5'); window.openSeatPage(); });
  const src = await pg.$eval('#seatPageFrame', e => e.getAttribute('src'));
  check('새로 연 반이 실린다', /class=1-5/.test(src) && !/class=2-3/.test(src), src);
  check('머리글도 새 반', /1-5/.test(await pg.$eval('#seatPageTitle', e => e.textContent)));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
