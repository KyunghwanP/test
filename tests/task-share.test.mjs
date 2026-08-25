// 공유받은 업무에서 '누가 보냈는지 · 누구와 함께 받았는지'가 보이는지.
//
// 2026-08: 모달의 mytaskOwnerSection 이 작성자에게만 보이는데(제목·기간·공유 담당자가
// 그 안에 있다), 받은 사람에게는 대체 화면이 없어 상태·댓글만 덩그러니 남았다.
// 현황판 행도 👥 아이콘만 있고 작성자 이름이 없었다(목록 행에는 있었다).
import { chromium } from 'playwright';
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = html.indexOf('{', m.index), d = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

console.log('\n■ 배선');
{
  check('요약 자리를 owner 영역 밖에 뒀다',
        html.indexOf('<div id="mytaskRecvInfo"') < html.indexOf('<div id="mytaskOwnerSection">'));
  check('열 때 기본은 숨김', /if \(recvInfo\) recvInfo\.style\.display = 'none';/.test(html));
  check('받은 사람일 때만 그린다', /if \(!isOwner\) renderMytaskRecvInfo\(t\);/.test(html));
  check('현황판 행에 작성자 이름', /isShared && t\.ownerName \? ` <span[^`]*\$\{escapeHtml\(t\.ownerName\)\}\]/.test(html));
}

console.log('\n■ 실제로 그려지는 내용 (Chromium)');
{
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const a = html.indexOf('<div id="mytaskRecvInfo"');
  const b = html.indexOf('<!-- 본인만 편집 가능한 영역 -->');
  const markup = html.slice(a, b);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 560, height: 500 } });
  page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });

  const render = async task => {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${markup}
      <script>
      (function(){
        ${grab('escapeHtml')}
        ${grab('formatMytaskDateRange')}
        const TEACHERS = [{name:'류승현',email:'ryu@yeungnam.hs.kr',uid:'u1'},
                          {name:'황호숭',email:'hwang@yeungnam.hs.kr'},
                          {name:'한서윤',email:'han@yeungnam.hs.kr'},
                          {name:'박경환',email:'pkh910518@yeungnam.hs.kr'}];
        const fbAuth = { currentUser:{ email:'pkh910518@yeungnam.hs.kr', displayName:'박경환' } };
        ${grab('renderMytaskRecvInfo')}
        window.__render = t => renderMytaskRecvInfo(t);
      })();
      </script>`);
    await page.evaluate(t => window.__render(t), task);
    return page.evaluate(() => ({
      shown: document.getElementById('mytaskRecvInfo').style.display === 'block',
      text : document.getElementById('mytaskRecvInfo').innerText,
      chips: [...document.querySelectorAll('.mrv-chip')].map(e => e.textContent),
      imgs : document.querySelectorAll('#mytaskRecvInfo img').length
    }));
  };

  const base = {
    title:'과학중점과정 1학년 추가모집 건', ownerUid:'u1', ownerName:'류승현',
    startDate:'2026-08-24', endDate:'2026-09-23',
    sharedWith:['hwang@yeungnam.hs.kr','han@yeungnam.hs.kr','pkh910518@yeungnam.hs.kr'],
    memo:'모집요강 검토 후 회신 바랍니다.'
  };

  let r = await render(base);
  check('보인다', r.shown);
  check('제목', r.text.includes('과학중점과정 1학년 추가모집 건'), r.text);
  check('기간', r.text.includes('2026-08-24') && r.text.includes('2026-09-23'), r.text);
  check('공유한 사람 = 작성자', /공유한 사람\s*류승현/.test(r.text), r.text);
  check('함께 받은 사람 이름', r.chips.includes('황호숭') && r.chips.includes('한서윤'), r.chips);
  check('나는 (나) 로 표시', r.chips.includes('박경환 (나)'), r.chips);
  check('메모', r.text.includes('모집요강 검토'), r.text);

  // 이메일이 명렬에 없으면 앞부분이라도 보여야 한다
  r = await render({ ...base, sharedWith:['unknown@yeungnam.hs.kr'] });
  check('모르는 이메일은 아이디만', r.chips.includes('unknown'), r.chips);

  // 이름으로 저장된 옛 항목도 처리
  r = await render({ ...base, sharedWith:['황호숭'] });
  check('이름으로 저장된 항목', r.chips.includes('황호숭'), r.chips);

  // 나 혼자 받은 경우
  r = await render({ ...base, sharedWith:['pkh910518@yeungnam.hs.kr'] });
  check('나만 받았으면 그렇게 적는다', r.text.includes('나만 받았습니다') || r.chips.includes('박경환 (나)'), r);

  // 자료가 부실해도 안 터진다
  r = await render({ title:'제목만', startDate:'2026-08-24', endDate:'2026-08-24' });
  check('sharedWith·작성자가 없어도 그려진다', r.shown && r.text.includes('제목만'), r.text);
  check('작성자를 모르면 그렇게 적는다', r.text.includes('알 수 없음'), r.text);
  check('메모 없으면 그 줄이 없다', !r.text.includes('메모'), r.text);

  // 줄바꿈 — 원본의 줄바꿈이 살아 있어야 한다(HTML 은 그냥 두면 공백으로 접는다)
  const multi = '8월 27일 - 3차 운영위원회 개최\n9월 1일 - 학부모 안내 SNS 발송\n9월 3일 - 가정통신문 배부';
  r = await render({ ...base, memo: multi });
  check('메모의 줄바꿈이 살아 있다', r.text.includes('개최\n9월 1일'), JSON.stringify(r.text.slice(0, 200)));
  const lines = await page.evaluate(() => {
    const el = document.querySelector('.mrv-text');
    return { cls: !!el, ws: el ? getComputedStyle(el).whiteSpace : '', h: el ? el.getBoundingClientRect().height : 0 };
  });
  check('메모 줄에 mrv-text 를 붙인다', lines.cls, lines);
  check('white-space 가 pre-wrap', lines.ws === 'pre-wrap', lines);
  check('세 줄이라 한 줄보다 높다', lines.h > 40, lines);

  // 제목에 태그를 넣어도 실행되지 않아야 한다
  r = await render({ ...base, title:'<img src=x onerror=alert(1)>' });
  check('제목의 태그가 실행되지 않는다', r.imgs === 0, r.imgs);

  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
