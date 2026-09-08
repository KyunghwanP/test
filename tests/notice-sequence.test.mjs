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
${gc('NOTICE_TAGS')}\n${gc('NOTICE_DROP')}\n${gc('NOTICE_STYLES')}\n${gc('NOTICE_KEY_RE')}\n${gc('NOTICE_ZWSP')}
${gc('NOTICE_STATE_TEXT')}\n${gc('noticeLiveList')}\n${gc('_noticeAutoIdx')}
let _noticeList=[], _noticeAuto=true, _noticeOpenId='', _noticeObjUrls=[];
const _IS_ADMIN=()=>true;
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function noticeLoadImages(){} function noticeReleaseImages(){} function noticeMarkSeen(){}
function noticeSnoozeToday(){ window.__snoozed=true; closeNoticeModalBtn(); }
function closeNoticeModalBtn(){ document.getElementById('noticeModal').classList.remove('open'); window.__closed=true; }
function startNoticeEdit(){}
${grab('noticeCleanStyle')}\n${grab('noticeSanitize')}\n${grab('noticeTitleOf')}
${grab('noticeStateOf')}\n${grab('noticeStateChip')}\n${grab('noticeVisibleList')}
${grab('noticePeriodText')}\n${grab('noticeWhenText')}
${grab('renderNoticeAutoStep')}\n${grab('noticeAutoStep')}\n${grab('renderNoticeModal')}
window.noticeAutoStep=noticeAutoStep; window.noticeSnoozeToday=noticeSnoozeToday;
window.closeNoticeModalBtn=closeNoticeModalBtn;
window.go=list=>{ _noticeList=list; _noticeAuto=true; _noticeAutoIdx=0;
  document.getElementById('noticeModal').classList.add('open'); renderNoticeModal(); };
window.st=()=>({ 제목:document.getElementById('noticeTitle').textContent,
  본문:document.getElementById('noticeBody').textContent.trim(),
  단추:[...document.querySelectorAll('#noticeFoot button')].map(b=>b.textContent.trim()) });
<\/script></body>`);
const N=(id,t,h)=>({id,title:t,html:'<p>'+h+'</p>',updatedAt:Date.now()});
const THREE = [N('a','영어듣기 시정표','3~4교시 방송'),
               N('b','모의고사 감독','A동 3층'),
               N('c','급식 변경','오늘 중식 지연')];
const st = () => pg.evaluate(() => window.st());
const 다음 = () => pg.click('#noticeFoot button:last-child');

console.log('\n■ 세 건이면 세 장을 차례로');
{
  await pg.evaluate(l => window.go(l), THREE);
  let x = await st();
  check('첫 장이 뜬다', x.제목.includes('영어듣기 시정표'), x.제목);
  check('몇 번째인지 알려준다', x.제목.includes('(1/3)'), x.제목);
  check('첫 장에는 이전이 없다', !x.단추.includes('‹ 이전'), x.단추);
  check('다음으로 넘어간다', x.단추.at(-1) === '다음 ›', x.단추);
  check('오늘 그만보기는 어느 장에서든 있다', x.단추.includes('오늘 그만보기'), x.단추);

  await 다음(); x = await st();
  check('두 번째 장', x.제목.includes('모의고사 감독') && x.제목.includes('(2/3)'), x.제목);
  check('본문도 그 공지 것', x.본문 === 'A동 3층', x.본문);
  check('가운데 장에는 이전이 생긴다', x.단추.includes('‹ 이전'), x.단추);

  await 다음(); x = await st();
  check('마지막 장', x.제목.includes('급식 변경') && x.제목.includes('(3/3)'), x.제목);
  check('마지막에는 다음 대신 닫기', x.단추.at(-1) === '닫기', x.단추);
}

console.log('\n■ 앞뒤로 오간다');
{
  await pg.click('#noticeFoot button:nth-child(3)');    // ‹ 이전
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
  await pg.click('#noticeFoot button:nth-child(2)');     // 오늘 그만보기 (첫 장)
  check('첫 장에서도 오늘 그만보기가 눌린다', await pg.evaluate(() => window.__snoozed));
  check('누르면 창도 닫힌다', await pg.evaluate(() => window.__closed));
}

console.log('\n■ 한 건이면 넘길 것이 없다');
{
  await pg.evaluate(l => window.go(l), [N('a','영어듣기 시정표','3~4교시 방송')]);
  const x = await st();
  check('번호를 안 붙인다', !/\(\d+\/\d+\)/.test(x.제목), x.제목);
  check('바로 닫기', x.단추.at(-1) === '닫기', x.단추);
  check('이전·다음이 없다', !x.단추.some(t => /이전|다음/.test(t)), x.단추);
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

// 하네스에는 창 바깥을 누르는 길(closeNoticeModal)이 없다 — 그 오류만 걸러낸다
const real = errs.filter(e => !/closeNoticeModal is not defined/.test(e));
console.log(real.length ? '\n❌ 런타임 오류:\n' + real.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || real.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || real.length ? 1 : 0);
