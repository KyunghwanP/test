// 저절로 뜨는 공지 창을 한 장씩 넘기는 흐름.
//
// 앱을 열 때 뜨는 창은 '고르라'가 아니라 '오늘 붙은 것을 다 읽어라'는 화면이다.
// 그래서 목록이 아니라 한 장씩 넘긴다 — 몇 번째인지, 다음이 있는지, 마지막인지에
// 따라 단추가 달라진다. 이건 화면을 실제로 눌러 봐야 확인된다.
//
// index.html 은 Firebase 없이는 못 뜬다. 창 그리는 함수와 마크업만 원본에서
// 그대로 떼어내 붙인 하네스로 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';
const H = fs.readFileSync('index.html','utf8');
const grab = n => { const m=new RegExp(`^(?:async )?function ${n}\\(`,'m').exec(H);
  let i=H.indexOf('{',m.index),d=0; for(let j=i;j<H.length;j++){if(H[j]==='{')d++;else if(H[j]==='}'&&--d===0)return H.slice(m.index,j+1);} };
const gc = n => new RegExp(`^(?:const|let) ${n}\\b[^\\n]*(\\n(?![a-zA-Z/]).*)*`,'m').exec(H)[0];
const css = [...H.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const mi = H.indexOf('<div class="modal-overlay medium" id="noticeModal"');
const modal = H.slice(mi, H.indexOf('\n\n<div class="modal-overlay" id="ttMeetModal"', mi));
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport:{width:900,height:800} });
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.setContent(`<style>${css}</style><body style="background:#eee">${modal}<script>
${gc('RT_TAGS')}\n${gc('RT_DROP')}\n${gc('RT_STYLES')}\n${gc('RT_SEG')}\n${gc('RT_KEY_RE')}\n${gc('RT_ZWSP')}
${gc('NOTICE_STATE_TEXT')}\n${gc('noticeLiveList')}\n${gc('_noticeAutoIdx')}
let _noticeList=[], _noticeAuto=true, _noticeOpenId='', _rtObjUrls=[];
const _IS_ADMIN=()=>true;
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function rtLoadImages(){} function rtReleaseImages(){} function rtFitFontSizes(){} function rtFitDarkColors(){} function noticeMarkSeen(){}
function noticeSnoozeToday(){ window.__snoozed='today'; closeNoticeModalBtn(); }
function noticeSnoozeEver(){ window.__snoozed='ever'; closeNoticeModalBtn(); }
function closeNoticeModalBtn(){ document.getElementById('noticeModal').classList.remove('open'); window.__closed=true; }
function startNoticeEdit(){}
${gc('RT_FONT_PX')}
${grab('rtCleanStyle')}
${grab('rtPreserveStyles')}\n${grab('rtSanitize')}\n${grab('noticeTitleOf')}
${grab('noticeStateOf')}\n${grab('noticeStateChip')}\n${grab('noticeVisibleList')}
${grab('noticePeriodText')}\n${grab('noticeWhenText')}
${grab('renderNoticeAutoStep')}\n${grab('noticeAutoStep')}\n${grab('renderNoticeModal')}
${grab('noticeKeepOpen')}
window.noticeAutoStep=noticeAutoStep; window.noticeSnoozeToday=noticeSnoozeToday; window.noticeSnoozeEver=noticeSnoozeEver;
window.closeNoticeModalBtn=closeNoticeModalBtn;
window.go=list=>{ _noticeList=list; _noticeAuto=true; _noticeAutoIdx=0;
  document.getElementById('noticeModal').classList.add('open'); renderNoticeModal(); };
window.st=()=>({ 제목:document.getElementById('noticeTitle').textContent,
  본문:document.getElementById('noticeBody').textContent.trim(),
  넘기기:[...document.querySelectorAll('#noticeFoot > .notice-btn')].map(b=>b.textContent.trim()),
  접기:[...document.querySelectorAll('#noticeFoot .notice-skip')].map(b=>b.textContent.trim()) });
<\/script></body>`);
const N=(id,t,h)=>({id,title:t,html:'<p>'+h+'</p>',updatedAt:Date.now()});
const THREE = [N('a','영어듣기 시정표','3~4교시 방송'),
               N('b','모의고사 감독','A동 3층'),
               N('c','급식 변경','오늘 중식 지연')];
const st = () => pg.evaluate(() => window.st());
const 다음 = () => pg.click('#noticeFoot > .notice-btn:last-child');
const 접기 = i => pg.click(`#noticeFoot .notice-skip:nth-child(${i})`);

console.log('\n■ 세 건이면 세 장을 차례로');
{
  await pg.evaluate(l => window.go(l), THREE);
  let x = await st();
  check('첫 장이 뜬다', x.제목.includes('영어듣기 시정표'), x.제목);
  check('몇 번째인지 알려준다', x.제목.includes('(1/3)'), x.제목);
  check('첫 장에는 이전이 없다', !x.넘기기.includes('‹ 이전'), x.넘기기);
  check('다음으로 넘어간다', x.넘기기.at(-1) === '다음 ›', x.넘기기);
  check('접기 두 가지가 어느 장에서든 있다',
        x.접기.join() === '오늘 그만보기,다시 보지 않기', x.접기);
  check('접기와 넘기기가 섞이지 않는다', !x.넘기기.some(t => /보기|않기/.test(t)), x.넘기기);

  await 다음(); x = await st();
  check('두 번째 장', x.제목.includes('모의고사 감독') && x.제목.includes('(2/3)'), x.제목);
  check('본문도 그 공지 것', x.본문 === 'A동 3층', x.본문);
  check('가운데 장에는 이전이 생긴다', x.넘기기.includes('‹ 이전'), x.넘기기);

  await 다음(); x = await st();
  check('마지막 장', x.제목.includes('급식 변경') && x.제목.includes('(3/3)'), x.제목);
  check('마지막에는 다음 대신 닫기', x.넘기기.at(-1) === '닫기', x.넘기기);
}

console.log('\n■ 앞뒤로 오간다');
{
  await pg.click('#noticeFoot > .notice-btn:not(:last-child)');    // ‹ 이전
  let x = await st();
  check('이전으로 돌아온다', x.제목.includes('(2/3)'), x.제목);
  check('내용도 같이 돌아온다', x.본문 === 'A동 3층', x.본문);
  await 다음();
  check('다시 앞으로 간다', (await st()).제목.includes('(3/3)'));
}

console.log('\n■ 닫기·오늘 그만보기');
{
  await pg.evaluate(() => { window.__closed = false; window.__snoozed = false; });
  await 다음();                                          // 마지막 장의 닫기
  check('마지막에서 닫으면 닫힌다', await pg.evaluate(() => window.__closed));
  check('그것만으로 오늘 그만보기가 되지는 않는다',
        (await pg.evaluate(() => window.__snoozed)) === false);

  await pg.evaluate(l => window.go(l), THREE);
  await pg.evaluate(() => { window.__closed = false; window.__snoozed = false; });
  await 접기(1);                                         // 오늘 그만보기 (첫 장)
  check('첫 장에서도 오늘 그만보기가 눌린다',
        (await pg.evaluate(() => window.__snoozed)) === 'today');
  check('누르면 창도 닫힌다', await pg.evaluate(() => window.__closed));

  await pg.evaluate(l => window.go(l), THREE);
  await pg.evaluate(() => { window.__closed = false; window.__snoozed = false; });
  await 접기(2);                                         // 다시 보지 않기
  check('다시 보지 않기도 첫 장에서 눌린다',
        (await pg.evaluate(() => window.__snoozed)) === 'ever');
  check('그것도 창을 닫는다', await pg.evaluate(() => window.__closed));
}

console.log('\n■ 한 건이면 넘길 것이 없다');
{
  await pg.evaluate(l => window.go(l), [N('a','영어듣기 시정표','3~4교시 방송')]);
  const x = await st();
  check('번호를 안 붙인다', !/\(\d+\/\d+\)/.test(x.제목), x.제목);
  check('바로 닫기', x.넘기기.at(-1) === '닫기', x.넘기기);
  check('이전·다음이 없다', !x.넘기기.some(t => /이전|다음/.test(t)), x.넘기기);
  check('접기는 그대로 둘 다', x.접기.length === 2, x.접기);
}

console.log('\n■ 넘길 때마다 위에서부터 읽는다');
{
  const long = '<p>' + '가나다라마바사아자차 '.repeat(200) + '</p>';
  await pg.evaluate(l => window.go(l), [
    { id:'a', title:'긴 공지', html: long, updatedAt: 1 },
    { id:'b', title:'짧은 공지', html:'<p>끝</p>', updatedAt: 1 }]);
  await pg.evaluate(() => { document.getElementById('noticeBody').scrollTop = 400; });
  const before = await pg.evaluate(() => document.getElementById('noticeBody').scrollTop);
  check('스크롤을 내려 둔 상태를 만들었다', before > 0, before);
  await 다음();
  check('다음 장은 맨 위에서 시작한다',
        (await pg.evaluate(() => document.getElementById('noticeBody').scrollTop)) === 0);
}

console.log('\n■ 공지가 없어지면 저절로 뜬 창은 닫는다');
{
  // 실제로 났던 일 — 공지를 내렸는데 창이 '올라온 공지가 없습니다' 만 띄운 채
  // 화면 앞에 남았다. 선생님이 띄운 것도 아닌 창을 손으로 닫게 만들면 안 된다.
  await pg.evaluate(l => window.go(l), THREE);
  check('세 건일 때는 계속 띄워 둔다', (await pg.evaluate(() => noticeKeepOpen())) === true);

  await pg.evaluate(() => { _noticeList = []; });
  check('다 내려가면 닫는다', (await pg.evaluate(() => noticeKeepOpen())) === false);

  // 손으로 연 창은 비어도 남겨 둔다. 관리자가 '＋ 공지 쓰기' 를 누르러 온 자리라,
  // 마지막 공지를 지웠다고 창까지 닫히면 쓰러 들어갈 길이 없어진다.
  await pg.evaluate(() => { _noticeAuto = false; });
  check('손으로 연 창은 비어도 그대로 둔다', (await pg.evaluate(() => noticeKeepOpen())) === true);
}

console.log('\n■ 아래쪽 단추들 — 손가락으로 누를 수 있나');
{
  // 예전에는 '오늘 그만보기 / 다시 보지 않기' 가 12.5px 밑줄 글자였다. 넘기는
  // 단추와 구분은 됐지만 폰에서 누를 자리가 너무 작았다 — 구분하자고 못 누르게
  // 만든 꼴이었다. 실제로 그려 놓고 재 본다. 숫자를 옮겨 적으면 의미가 없다.
  const box = () => pg.evaluate(() =>
    [...document.querySelectorAll('#noticeFoot button')].map(b => {
      const r = b.getBoundingClientRect(), s = getComputedStyle(b);
      return { 글: b.textContent.trim(), 높이: Math.round(r.height), 너비: Math.round(r.width),
               테두리: parseFloat(s.borderTopWidth), 채움: s.backgroundColor,
               밑줄: s.textDecorationLine, 글자: parseFloat(s.fontSize) };
    }));

  await pg.evaluate(l => window.go(l), THREE);
  const wide = await box();
  // 첫 장에는 '이전' 이 없다 — 그만보기 둘 + 다음 하나.
  check('첫 장에는 단추가 셋 (그만보기 둘 + 다음)', wide.length === 3,
        wide.map(b => b.글));
  check('모두 40px 이상 — 누를 자리가 된다',
        wide.every(b => b.높이 >= 40), wide.map(b => [b.글, b.높이]));
  check('글자도 12.5px 아래로는 안 내려간다',
        wide.every(b => b.글자 >= 12.5), wide.map(b => [b.글, b.글자]));

  const skip = wide.filter(b => /그만보기|보지 않기/.test(b.글));
  check('그만보기 둘 다 테두리를 두른다 (닫기처럼 감싼다)',
        skip.length === 2 && skip.every(b => b.테두리 >= 1), skip);
  check('밑줄은 없앴다', skip.every(b => !/underline/.test(b.밑줄)), skip);
  check('그래도 채운 단추와는 구분된다 (빈 상자)',
        skip.every(b => /rgba\(0, 0, 0, 0\)|transparent/.test(b.채움)), skip.map(b => b.채움));

  // 가운데 장에는 '이전' 까지 넷이 선다. 그때도 자리가 남아야 한다.
  await 다음();
  const mid = await box();
  check('가운데 장에는 넷 (그만보기 둘 + 이전·다음)', mid.length === 4, mid.map(b => b.글));
  check('넷이 서도 모두 40px 이상', mid.every(b => b.높이 >= 40), mid.map(b => [b.글, b.높이]));

  // 폰 폭에서 줄이 넘치거나 단추가 눌린 채 찌그러지면 안 된다.
  await pg.setViewportSize({ width: 390, height: 780 });
  await pg.evaluate(l => window.go(l), THREE);
  const narrow = await box();
  check('폰 폭에서도 모두 40px 이상',
        narrow.every(b => b.높이 >= 40), narrow.map(b => [b.글, b.높이]));
  check('폰 폭에서 가로로 안 넘친다',
        (await pg.evaluate(() => {
          const f = document.getElementById('noticeFoot');
          return f.scrollWidth <= f.clientWidth + 1;
        })) === true);
  check('그만보기 둘이 한 줄을 나눠 갖는다 (글자가 안 잘린다)',
        narrow.filter(b => /그만보기|보지 않기/.test(b.글)).every(b => b.너비 >= 110),
        narrow.map(b => [b.글, b.너비]));
  await pg.setViewportSize({ width: 900, height: 800 });
}

// 하네스에는 창 바깥을 누르는 길(closeNoticeModal)이 없다 — 그 오류만 걸러낸다
const real = errs.filter(e => !/closeNoticeModal is not defined/.test(e));
console.log(real.length ? '\n❌ 런타임 오류:\n' + real.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || real.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || real.length ? 1 : 0);
