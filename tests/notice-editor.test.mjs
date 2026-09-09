// 공지 편집기 — 실제로 서식이 걸리는가.
//
// 걸러내기(notice.test.mjs)는 '들어온 HTML 을 어떻게 자르나'를 본다. 여기서는
// 그 앞 단계 — 선생님이 도구모음을 눌렀을 때 브라우저가 무엇을 만드느냐 — 를 본다.
// 이건 execCommand 의 실제 동작에 달려 있어서 진짜 브라우저로만 확인된다.
//
// 실제로 겪은 일: styleWithCSS 를 켜 둔 채 fontSize 를 부르면 브라우저가
// <font size="7"> 대신 <span style="font-size: xxx-large"> 를 만든다. 바꿔 끼울
// 자리를 못 찾아, 작게를 골라도 크게를 골라도 똑같이 xxx-large 가 됐다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

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

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>.notice-editor{font-size:14px;}</style>
<div id="noticeTitle"></div><div id="noticeWhen"></div>
<span id="noticeEditState"></span><button id="noticePreviewBtn"></button><button id="noticeCheckBtn"></button><button id="noticeNewBtn"></button>
<div id="noticeEditBody"></div><div id="noticeEditFoot"></div>
<script>
  ${grabConst('NOTICE_TAGS')}
  ${grabConst('NOTICE_DROP')}
  ${grabConst('NOTICE_STYLES')}
  ${grabConst('NOTICE_KEY_RE')}
  ${grab('noticeToInput')}
  ${grab('noticeFromInput')}
  ${grab('noticePeriodText')}
    ${grabConst('NOTICE_ZWSP')}
  ${grabConst('NOTICE_COLORS')}
  ${grabConst('NOTICE_SIZES')}
  let _noticeData = { html:'', keys:[], updatedAt:0, by:'', from:0, until:0 };
  let _noticeEditing = false, _noticeDirty = false;
  const _IS_ADMIN = () => true;
  function previewNotice(){}
  function noticeCheckWorker(){}
  function deleteNotice(){}
  function noticeLoadImages(){}
  function noticeReleaseImages(){}
  function onNoticePaste(){}
  ${grab('noticeCleanStyle')}
  ${grab('noticeSanitize')}
  ${grab('noticeSetFontSize')}
  ${grab('noticeSyncSizeSel')}
  ${grab('bindNoticeEditor')}
  ${grab('renderNoticeEditState')}
  ${grab('noticeMarkDirty')}
  ${grab('noticeMayLeave')}
  ${grab('noticeStateOf')}
  ${grabConst('noticeLiveList')}
  ${grab('noticeNewId')}
  ${grab('openNoticeEditor')}

  window.open_ = html => { _noticeList = html ? [{ id:'x', title:'', html, keys:[], from:0, until:0, updatedAt:1 }] : [];
                           openNoticeEditor(html ? 'x' : ''); };
  window.ed    = () => document.getElementById('noticeEditor');
  window.html_ = () => document.getElementById('noticeEditor').innerHTML;
  // 편집기 안 글자를 전부 고른다
  window.selectAll = () => { const e = window.ed(); e.focus();
    const r = document.createRange(); r.selectNodeContents(e);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  // 앞에서 n 글자만 고른다
  window.selectFirst = n => { const e = window.ed(); e.focus();
    const t = e.firstChild.nodeType === 3 ? e.firstChild : e.firstChild.firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, n);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  window.size  = px => noticeSetFontSize(px);
  window.tool  = cmd => document.querySelector('#noticeEditBody .notice-tool[data-cmd="'+cmd+'"]').click();
  window.color = c   => document.querySelector('#noticeEditBody .notice-tool-swatch[data-color="'+c+'"]').click();
  window.sizeSel = () => document.getElementById('noticeSizeSel');
  window.sizes = () => NOTICE_SIZES;
  window.openWith = d => { _noticeList = [{ id:'x', title:'', keys:[], from:0, until:0, updatedAt:1, ...d }];
                           openNoticeEditor('x'); };
  window.dirty  = () => _noticeDirty;
  window.state_ = () => document.getElementById('noticeEditState').textContent;
  window.periodIn  = () => [document.getElementById('noticeFrom').value,
                            document.getElementById('noticeUntil').value];
  // 저장 단추가 읽는 것과 같은 방식으로 칸을 읽는다
  window.readPeriod = () => [noticeFromInput(document.getElementById('noticeFrom').value),
                             noticeFromInput(document.getElementById('noticeUntil').value)];
</script>`);

const SIZES = await pg.evaluate(() => window.sizes());
const SIZES_ = SIZES.map(x => x[1]);

console.log('\n■ 고를 수 있는 크기');
{
  check('네 단계가 있다', SIZES.length === 4, SIZES);
  const px = SIZES.map(s => parseInt(s[1], 10));
  check('작은 것부터 큰 것 순서', px.every((v, i) => i === 0 || v > px[i-1]), px);
  // 본문 기본이 14px 이다. '작게'가 14px 이면 골라도 아무 일이 없는 것처럼 보인다.
  check('가장 작은 것이 본문(14px)보다 작다', px[0] < 14, px[0]);
  check('가장 큰 것은 확실히 크다', px[3] >= 20, px[3]);
}

console.log('\n■ 고른 크기가 그대로 걸린다');
for (const [label, px] of SIZES) {
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), px);
  const h = await pg.evaluate(() => window.html_());
  check(`${label} → font-size:${px}`, new RegExp(`font-size:\\s*${px}`).test(h), h);
}
{
  // 이게 이번 버그의 핵심이다 — styleWithCSS 가 켜져 있으면 전부 xxx-large 가 됐다
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[0][1]);
  const small = await pg.evaluate(() => window.html_());
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[3][1]);
  const big = await pg.evaluate(() => window.html_());
  check('작게와 아주 크게가 서로 다르다', small !== big, [small, big]);
  check('브라우저 이름값(xxx-large 등)이 안 남는다',
        !/x-large|xx-large|xxx-large|larger|smaller/.test(small + big), [small, big]);
  check('<font> 태그가 안 남는다', !/<font/i.test(small + big), [small, big]);
}

console.log('\n■ 크기를 바꿔 다시 걸면 새것이 이긴다');
{
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[3][1]);   // 아주 크게
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[0][1]);   // 다시 작게
  const h = await pg.evaluate(() => window.html_());
  check('예전 크기가 안쪽에 안 남는다',
        (h.match(/font-size/g) || []).length === 1, h);
  check('마지막에 고른 크기가 걸려 있다', h.includes(SIZES[0][1]), h);
  // 화면에 실제로 그려지는 크기까지 본다 — 안쪽에 남아 있으면 그게 이긴다
  const shown = await pg.evaluate(() => {
    const t = window.ed().querySelector('span'); return getComputedStyle(t).fontSize; });
  check(`보이는 크기도 ${SIZES[0][1]}`, shown === SIZES[0][1], shown);

  // 겹쳐 걸었을 때. 걷어내는 것은 브라우저 몫이지만, 결과(하나만 남고 그 크기로
  // 보인다)는 우리가 책임지는 부분이라 여기서 못 박아 둔다.
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectFirst(2));
  await pg.evaluate(v => window.size(v), SIZES[3][1]);   // '감독'만 아주 크게
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[0][1]);   // 전체를 작게
  const h2 = await pg.evaluate(() => window.html_());
  check('안쪽에 겹쳐 있던 예전 크기까지 지운다',
        (h2.match(/font-size/g) || []).length === 1, h2);
  const shown2 = await pg.evaluate(() => {
    const n = window.ed().querySelector('span') ; 
    // 가장 안쪽 글자가 실제로 몇 px 로 보이는지
    let deep = n; while (deep.firstElementChild) deep = deep.firstElementChild;
    return getComputedStyle(deep).fontSize; });
  check(`앞 두 글자도 ${SIZES[0][1]} 로 보인다`, shown2 === SIZES[0][1], shown2);
}

console.log('\n■ 걸러내기를 통과한다 (저장하면 지워지면 안 된다)');
{
  await pg.evaluate(() => window.open_('감독 1교시'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[2][1]);
  const kept = await pg.evaluate(() => noticeSanitize(window.html_()));
  check('저장해도 크기가 살아남는다', kept.includes(SIZES[2][1]), kept);
}

console.log('\n■ 부분만 골라 걸 수 있다');
{
  await pg.evaluate(() => window.open_('감독 1교시 2교시'));
  await pg.evaluate(() => window.selectFirst(2));
  await pg.evaluate(v => window.size(v), SIZES[3][1]);
  const h = await pg.evaluate(() => window.html_());
  check('고른 데만 걸린다', /^<span style="font-size: ?25px;?">감독<\/span>/.test(h), h);
  check('나머지 글자는 그대로', h.includes('1교시 2교시'), h);
}

console.log('\n■ 굵게·기울임·밑줄·색');
{
  await pg.evaluate(() => window.open_('감독'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(() => window.tool('bold'));
  let h = await pg.evaluate(() => window.html_());
  check('굵게가 걸린다', /<b>|font-weight/.test(h), h);
  check('굵게도 걸러내기를 통과한다',
        /<b>|font-weight/.test(await pg.evaluate(() => noticeSanitize(window.html_()))), h);

  await pg.evaluate(() => window.open_('감독'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(() => window.color('#dc2626'));
  h = await pg.evaluate(() => window.html_());
  check('글자색이 걸린다', /color:\s*rgb\(220, 38, 38\)|#dc2626/.test(h), h);
  // 색은 반대로 styleWithCSS 가 켜져 있어야 한다 — 꺼지면 <font color> 가 나와
  // 걸러내기에서 통째로 사라진다
  check('색이 <font> 로 안 나온다', !/<font/i.test(h), h);
  check('색도 걸러내기를 통과한다',
        /color:/.test(await pg.evaluate(() => noticeSanitize(window.html_()))), h);
}

console.log('\n■ 크기를 걸고 나서 색도 걸 수 있다 (선택이 살아 있어야 한다)');
{
  await pg.evaluate(() => window.open_('감독'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[3][1]);
  await pg.evaluate(() => window.color('#dc2626'));      // 다시 고르지 않는다
  const h = await pg.evaluate(() => window.html_());
  check('크기와 색이 함께 걸린다',
        /font-size/.test(h) && /color:\s*rgb\(220, 38, 38\)/.test(h), h);
  // 크기를 걸며 잠깐 꺼 둔 styleWithCSS 를 도로 안 켜면 여기서 <font color> 가
  // 나온다. 그러면 저장할 때 걸러내기에서 색이 통째로 사라진다.
  check('크기를 건 뒤에도 색이 <font> 로 안 나온다', !/<font/i.test(h), h);
  check('크기를 건 뒤의 색도 저장에서 살아남는다',
        /color:/.test(await pg.evaluate(() => noticeSanitize(window.html_()))),
        await pg.evaluate(() => noticeSanitize(window.html_())));
}

// ── 여기서부터는 함수를 부르지 않는다. 사람이 하는 순서 그대로 화면을 조작한다.
//    앞의 검사들이 전부 통과하는데도 실제로는 안 먹는 일이 있었다 — 함수만 부르면
//    '목록을 누르는 순간 편집기가 포커스를 잃는다'는 것을 못 밟기 때문이다.
console.log('\n■ 사람이 하는 순서 그대로 (도구모음을 실제로 누른다)');
{
  const type  = t => pg.keyboard.type(t);
  const pickSize = px => pg.selectOption('#noticeSizeSel', px);
  const reopen = async () => { await pg.evaluate(() => window.open_('')); await pg.click('#noticeEditor'); };

  // 순서 A — 크기부터 고르고 친다. 이게 제일 흔하고, 실제로 이게 안 됐다.
  await reopen();
  await pickSize(SIZES[3][1]);            // 아주 크게
  await type('3교시 감독');
  let h = await pg.evaluate(() => window.html_());
  check('안 고르고 크기부터 → 그 크기로 쳐진다',
        new RegExp(`font-size: ?${SIZES[3][1]}`).test(h), h);
  check('브라우저 기본값이 안 나온다', !/x-large|larger|smaller/.test(h), h);

  // 크기를 바꿔 이어 치면 그 다음 글자만 바뀌어야 한다
  await pickSize(SIZES[0][1]);            // 작게
  await type('입니다');
  h = await pg.evaluate(() => window.html_());
  check('크기를 바꿔 이어 치면 새 크기로', new RegExp(`font-size: ?${SIZES[0][1]}`).test(h), h);
  check('앞서 친 글자는 그대로 큼', new RegExp(`font-size: ?${SIZES[3][1]}`).test(h), h);
  check('두 크기가 따로 산다',
        (h.match(/font-size/g) || []).length >= 2, h);

  // 저장했을 때 보이지 않는 자리표시가 안 남아야 한다
  const saved = await pg.evaluate(() => noticeSanitize(window.html_()));
  check('저장본에 보이지 않는 글자가 없다', !saved.includes('\u200B'), JSON.stringify(saved));
  check('저장본에도 두 크기가 남는다',
        saved.includes(SIZES[3][1]) && saved.includes(SIZES[0][1]), saved);

  // 순서 B — 글자를 골라서 바꾼다
  await reopen();
  await type('3교시 감독');
  await pg.evaluate(() => window.selectAll());
  await pickSize(SIZES[2][1]);
  h = await pg.evaluate(() => window.html_());
  check('골라서 바꾸기도 된다', new RegExp(`font-size: ?${SIZES[2][1]}`).test(h), h);

  // 목록을 누르면 편집기가 포커스를 잃는다 — 돌려주지 않으면 이어서 못 친다
  await pickSize(SIZES[1][1]);
  await type('!');
  check('크기를 고른 뒤 바로 이어서 칠 수 있다',
        (await pg.evaluate(() => window.ed().textContent)).includes('!'),
        await pg.evaluate(() => window.ed().textContent));

  // 크기만 고르고 아무것도 안 치면 흔적이 남으면 안 된다
  await reopen();
  await type('감독');
  await pickSize(SIZES[3][1]);
  const saved2 = await pg.evaluate(() => noticeSanitize(window.html_()));
  check('크기만 고르고 안 치면 빈 껍데기가 안 남는다',
        !/<span[^>]*><\/span>/.test(saved2) && !saved2.includes('\u200B'), JSON.stringify(saved2));
}

console.log('\n■ 크기를 건 직후 바로 이어서 칠 수 있다');
{
  // 목록을 누르면 편집기가 포커스를 잃고 고른 자리도 흐트러진다. 돌려놓지 않으면
  // 크기를 바꾼 뒤 곧바로 친 글자가 엉뚱한 자리·엉뚱한 크기로 들어간다.
  await pg.evaluate(() => window.open_(''));
  await pg.click('#noticeEditor');
  await pg.keyboard.type('감독');
  await pg.evaluate(() => window.selectAll());
  await pg.selectOption('#noticeSizeSel', SIZES_[3]);
  await pg.keyboard.type('교체');            // 고른 글자를 덮어쓴다
  const h = await pg.evaluate(() => window.html_());
  check('바로 친 글자가 편집기 안에 들어간다',
        (await pg.evaluate(() => window.ed().textContent)).includes('교체'), h);
  check('바로 친 글자가 고른 크기로 들어간다',
        new RegExp(`font-size: ?${SIZES[3][1]}[^]*교체`).test(h), h);
}

console.log('\n■ 붙여넣은 글에 걸기 (브라우저가 안 걷어내 주는 자리)');
{
  const apply = async (start, px) => {
    await pg.evaluate(h => window.open_(h), start);
    await pg.evaluate(() => window.selectAll());
    await pg.evaluate(v => window.size(v), px);
    return pg.evaluate(() => window.html_());
  };
  const shown = () => pg.evaluate(() => {
    let d = window.ed().querySelector('span');
    while (d && d.firstElementChild) d = d.firstElementChild;
    return d ? getComputedStyle(d).fontSize : ''; });

  for (const [label, start] of [
    ['한글에서 온 큰 글씨', '<span style="font-size:30px">감독 변경</span>'],
    ['문단 안에 섞인 크기', '<p><span style="font-size:30px">가</span>나</p>'],
    ['굵게 안쪽의 크기',    '<b><span style="font-size:30px">굵고 큰 글씨</span></b>'],
  ]) {
    const h = await apply(start, SIZES[0][1]);
    check(`${label} → 크기가 하나만 남는다`, (h.match(/font-size/g) || []).length === 1, h);
    check(`${label} → 실제로 ${SIZES[0][1]} 로 보인다`, (await shown()) === SIZES[0][1], await shown());
  }
}

console.log('\n■ 게시 기간 칸');
{
  const T = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi).getTime();
  const FROM = T(2026,9,8,7,0), UNTIL = T(2026,9,8,17,0);

  await pg.evaluate(() => window.openWith({ html: '감독 변경' }));
  check('기간을 안 정한 공지는 칸이 비어 있다',
        JSON.stringify(await pg.evaluate(() => window.periodIn())) === '["",""]',
        await pg.evaluate(() => window.periodIn()));

  await pg.evaluate(d => window.openWith(d), { html: '감독 변경', from: FROM, until: UNTIL });
  check('저장해 둔 기간이 칸에 그대로 들어온다',
        JSON.stringify(await pg.evaluate(() => window.periodIn()))
          === '["2026-09-08T07:00","2026-09-08T17:00"]',
        await pg.evaluate(() => window.periodIn()));
  // 칸 → 저장값 → 칸 을 한 바퀴 돌아도 같은 시각이어야 한다(시차로 어긋나기 쉽다)
  check('칸에서 읽으면 넣었던 시각 그대로',
        JSON.stringify(await pg.evaluate(() => window.readPeriod())) === JSON.stringify([FROM, UNTIL]),
        await pg.evaluate(() => window.readPeriod()));

  await pg.click('#noticePeriodClear');
  check('"기간 없이" 를 누르면 둘 다 비워진다',
        JSON.stringify(await pg.evaluate(() => window.periodIn())) === '["",""]',
        await pg.evaluate(() => window.periodIn()));
  check('그러면 제한 없음(0)으로 읽힌다',
        JSON.stringify(await pg.evaluate(() => window.readPeriod())) === '[0,0]');

  // 사람이 직접 쳐 넣는 경우
  await pg.evaluate(() => window.openWith({ html: '감독 변경' }));
  await pg.fill('#noticeFrom', '2026-09-08T07:30');
  check('직접 적은 시각도 그대로 읽힌다',
        (await pg.evaluate(() => window.readPeriod()))[0] === T(2026,9,8,7,30),
        await pg.evaluate(() => window.readPeriod()));
}

console.log('\n■ 쓰다 만 것을 잃지 않는가');
{
  // 공지 쓰기는 이제 탭이다. 다른 탭을 누르면 쓰던 것이 그냥 사라질 수 있어,
  // 실제로 고친 것이 있을 때만 붙잡는다(안 고쳤는데 묻는 것도 성가시다).
  await pg.evaluate(() => window.open_(''));
  check('막 들어왔을 때는 고친 것이 없다', (await pg.evaluate(() => window.dirty())) === false);
  check('그래서 그냥 나갈 수 있다', await pg.evaluate(() => noticeMayLeave()));

  await pg.click('#noticeEditor');
  await pg.keyboard.type('감독 변경');
  check('치면 고친 것으로 잡힌다', (await pg.evaluate(() => window.dirty())) === true);
  check('표시가 저장 안 됨으로 바뀐다',
        (await pg.evaluate(() => window.state_())).includes('저장 안 됨'),
        await pg.evaluate(() => window.state_()));

  // 기간만 건드려도 고친 것이다
  await pg.evaluate(() => window.open_('감독'));
  check('기간 전에는 안 고친 상태', (await pg.evaluate(() => window.dirty())) === false);
  await pg.fill('#noticeFrom', '2026-09-08T07:00');
  await pg.evaluate(() => document.getElementById('noticeFrom').dispatchEvent(new Event('change')));
  check('기간을 바꿔도 고친 것으로 잡힌다', (await pg.evaluate(() => window.dirty())) === true);

  await pg.evaluate(() => window.open_('감독'));
  await pg.click('#noticePeriodClear');
  check('"기간 없이"도 고친 것으로 잡힌다', (await pg.evaluate(() => window.dirty())) === true);
}

console.log('\n■ 쓰는 화면에도 지금 상태가 보인다');
{
  const T = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi).getTime();
  const st = async d => { await pg.evaluate(x => window.openWith(x), d);
                          return pg.evaluate(() => window.state_()); };
  check('내용이 빈 공지는 그렇게 적는다', (await st({ html: '' })).includes('빈 공지'), await st({ html: '' }));
  check('새로 쓰는 중이면 아직 저장 전이라고 적는다',
        (await pg.evaluate(() => { window.openWith({ html: '감독' }); openNoticeEditor(''); return window.state_(); }))
          .includes('아직 저장 전'),
        await pg.evaluate(() => { openNoticeEditor(''); return window.state_(); }));
  check('기간 없이 올린 것은 지금 뜨는 중',
        (await st({ html: '감독' })).includes('지금 뜨는 중'), await st({ html: '감독' }));
  const before = { html: '감독', from: Date.now() + 3600e3 };
  check('예약해 둔 것은 아직 안 뜬다고 적는다',
        (await st(before)).includes('예약'), await st(before));
  const after = { html: '감독', until: Date.now() - 3600e3 };
  check('기간이 끝난 것은 끝났다고 적는다',
        (await st(after)).includes('끝'), await st(after));
}

console.log('\n■ 목록이 지금 크기를 가리킨다');
{
  await pg.evaluate(() => window.open_('감독'));
  await pg.evaluate(() => window.selectAll());
  await pg.evaluate(v => window.size(v), SIZES[3][1]);
  await pg.evaluate(() => { window.ed().dispatchEvent(new Event('mouseup', { bubbles: true })); });
  check('크게 건 자리에서는 그 크기가 골라져 있다',
        (await pg.evaluate(() => window.sizeSel().value)) === SIZES[3][1],
        await pg.evaluate(() => window.sizeSel().value));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
