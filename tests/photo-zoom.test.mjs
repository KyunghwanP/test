// 사진 크게 보기 — 흔한 사진앱과 같은 몸짓으로 다뤄지는가.
//
// 예전에는 '한 번 더 누르면 원래 크기' 였다. 그 자리에서는 사진이 화면을 꽉
// 채워 누를 어두운 자리가 없어지고, 닫으려고 누르면 배율만 왔다 갔다 했다.
// 폰에서 빠져나갈 길이 × 단추 하나뿐이었다.
//
// 진짜 브라우저로만 확인된다 — 배율·위치가 transform 과 실제 요소 크기에 달려
// 있고, 손가락 두 개를 흉내내려면 PointerEvent 가 진짜여야 한다.
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
// 크게 보기 CSS 만 index.html 에서 그대로 떼어 온다. 여기 옮겨 적으면
// 실제 스타일이 바뀌어도 통과해 버린다.
const grabCss = sel => {
  const i = HTML.indexOf(sel + '{');
  if (i < 0) throw new Error('CSS 못 찾음: ' + sel);
  return sel + HTML.slice(i + sel.length, HTML.indexOf('}', i) + 1);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// 폰 크기로 본다 — 문제가 난 자리가 폰이다.
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// 2000×1200 짜리 빨간 그림. 화면(390px)보다 훨씬 크므로 '원래 크기'가 뜻을 가진다.
const BIG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200">' +
  '<rect width="2000" height="1200" fill="#c33"/></svg>').toString('base64');

await pg.setContent(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html,body{margin:0;height:100%;}
  ${grabCss('.notice-zoom')}
  ${grabCss('.notice-zoom.open')}
  ${grabCss('.notice-zoom-scroll')}
  ${grabCss('.notice-zoom-scroll img')}
  ${grabCss('.notice-zoom-scroll img.ease')}
  ${grabCss('.notice-zoom.zoomed .notice-zoom-scroll img')}
  ${grabCss('.notice-zoom-hint')}
  ${grabCss('.notice-zoom-close')}
</style>
<div class="notice-zoom" id="noticeImgZoom">
  <div class="notice-zoom-scroll" id="noticeZoomScroll"><img id="noticeZoomImg" alt="공지 그림"></div>
  <button class="notice-zoom-close" onclick="closeNoticeZoom()" aria-label="닫기">×</button>
  <div class="notice-zoom-hint" id="noticeZoomHint"></div>
</div>
<script>
  ${grabConst('NZ_TAP_MS')}
  ${grabConst('NZ_TAP_PX')}
  ${grabConst('NZ_SHUT_PX')}
  ${grabConst('nzImgEl')}
  ${grabConst('nzBig')}
  ${grab('nzApply')}
  ${grab('nzClamp')}
  ${grab('nzSet')}
  ${grab('nzHint')}
  ${grab('openNoticeZoom')}
  ${grab('closeNoticeZoom')}
  ${grab('nzBindStage')}
  let _nzScale = 1, _nzX = 0, _nzY = 0;
  let _nzFull = 2;
  const _nzPtr = new Map();
  let _nzGrab = null, _nzLastTap = 0;
  nzBindStage();

  window.open_ = src => new Promise(res => {
    const img = nzImgEl();
    openNoticeZoom(src);
    // onload 를 openNoticeZoom 이 새로 건다 — 그 뒤에 한 번 더 얹는다.
    const prev = img.onload;
    img.onload = e => { prev && prev(e); res(); };
    if (img.complete && img.naturalWidth) img.onload();
  });
  window.isOpen_ = () => document.getElementById('noticeImgZoom').classList.contains('open');
  window.scale_  = () => _nzScale;
  window.full_   = () => _nzFull;
  window.pos_    = () => [Math.round(_nzX), Math.round(_nzY)];
  window.hint_   = () => document.getElementById('noticeZoomHint').textContent;
  window.zoomed_ = () => document.getElementById('noticeImgZoom').classList.contains('zoomed');
  window.setScale_ = s => nzSet(s, false);

  // 손가락 두 개를 흉내낸다. Playwright 의 touchscreen 은 한 점만 보내므로
  // PointerEvent 를 직접 만든다 — 워커가 받는 것과 같은 이벤트다.
  const st = document.getElementById('noticeZoomScroll');
  const fire = (t, id, x, y) => st.dispatchEvent(new PointerEvent(t, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch' }));
  window.pinch_ = (from, to) => {
    const cx = 195, cy = 390;
    fire('pointerdown', 1, cx - from / 2, cy);
    fire('pointerdown', 2, cx + from / 2, cy);
    fire('pointermove', 1, cx - to / 2, cy);
    fire('pointermove', 2, cx + to / 2, cy);
    fire('pointerup',   1, cx - to / 2, cy);
    fire('pointerup',   2, cx + to / 2, cy);
  };
  window.drag_ = (x0, y0, x1, y1) => {
    fire('pointerdown', 7, x0, y0);
    fire('pointermove', 7, (x0 + x1) / 2, (y0 + y1) / 2);
    fire('pointermove', 7, x1, y1);
    fire('pointerup',   7, x1, y1);
  };
  window.tap_ = (x = 195, y = 390) => window.drag_(x, y, x, y);
</script>`);

// setPointerCapture 는 실제로 눌린 포인터에만 걸린다 — 만들어 낸 이벤트에서는
// 예외가 날 수 있어 워커가 try 로 감싸고 있다. 그 예외는 오류로 세지 않는다.
const realErrs = () => errs.filter(m => !/setPointerCapture|pointer/i.test(m));

const open = async () => { await pg.evaluate(s => window.open_(s), BIG); };
const scale = () => pg.evaluate(() => scale_());
const isOpen = () => pg.evaluate(() => isOpen_());

console.log('\n■ 열면 화면에 맞춰 전체가 보인다');
{
  await open();
  check('창이 뜬다', (await isOpen()) === true);
  check('배율은 1 (화면에 맞춤)', (await scale()) === 1);
  check('크게 본 상태가 아니다', (await pg.evaluate(() => zoomed_())) === false);
  // 시정표처럼 큰 그림은 원래 크기가 화면보다 훨씬 크다. 그 값을 실제로 잰다.
  check('원래 크기가 몇 배인지 잰다', (await pg.evaluate(() => full_())) > 3,
        await pg.evaluate(() => full_()));
  check('무엇을 할 수 있는지 알려 준다', /두 번 누르면 크게/.test(await pg.evaluate(() => hint_())),
        await pg.evaluate(() => hint_()));
}

console.log('\n■ 한 번 탭 — 닫힌다 (예전에는 배율만 바뀌었다)');
{
  await open();
  await pg.evaluate(() => tap_());
  check('바로는 안 닫힌다 (두 번 탭인지 가려야 한다)', (await isOpen()) === true);
  await pg.waitForFunction(() => !isOpen_(), null, { timeout: 2000 }).catch(() => {});
  check('잠깐 뒤 닫힌다', (await isOpen()) === false);
  check('그림을 놓아준다(메모리)',
        (await pg.evaluate(() => nzImgEl().getAttribute('src'))) === '');
}

console.log('\n■ 두 번 탭 — 원래 크기');
{
  await open();
  await pg.evaluate(() => { tap_(); tap_(); });
  const s = await scale();
  check('원래 크기로 커진다', s > 3, s);
  check('크게 본 상태로 표시된다', (await pg.evaluate(() => zoomed_())) === true);
  check('닫히지 않는다', (await isOpen()) === true);
  check('이제 어떻게 되돌리는지 알려 준다',
        /두 번 누르면 전체/.test(await pg.evaluate(() => hint_())), await pg.evaluate(() => hint_()));

  await pg.evaluate(() => { tap_(); tap_(); });
  check('다시 두 번 탭하면 화면에 맞는다', (await scale()) === 1);
}

console.log('\n■ 크게 본 상태에서 한 번 탭 — 닫지 않고 화면에 맞춘다');
{
  // 표를 들여다보다 잘못 눌러 창이 닫히면 처음부터 다시 해야 한다.
  await open();
  await pg.evaluate(() => setScale_(4));
  await pg.evaluate(() => tap_());
  check('화면에 맞춰진다', (await scale()) === 1);
  check('창은 그대로 열려 있다', (await isOpen()) === true);
  // 이제 한 번 더 누르면 닫힌다 — 두 번에 나가는 셈이다.
  await pg.evaluate(() => tap_());
  await pg.waitForFunction(() => !isOpen_(), null, { timeout: 2000 }).catch(() => {});
  check('거기서 한 번 더 누르면 닫힌다', (await isOpen()) === false);
}

console.log('\n■ 아래로 밀기 — 닫힌다');
{
  await open();
  await pg.evaluate(() => drag_(195, 200, 195, 200 + 140));
  check('충분히 밀면 닫힌다', (await isOpen()) === false);

  await open();
  await pg.evaluate(() => drag_(195, 200, 195, 200 + 30));
  check('조금만 밀면 안 닫힌다', (await isOpen()) === true);
  check('제자리로 돌아온다', JSON.stringify(await pg.evaluate(() => pos_())) === '[0,0]',
        await pg.evaluate(() => pos_()));

  // 위로 미는 것은 닫는 몸짓이 아니다 — 목록을 훑으려다 닫히면 곤란하다.
  await open();
  await pg.evaluate(() => drag_(195, 400, 195, 400 - 140));
  check('위로 밀어서는 안 닫힌다', (await isOpen()) === true);
}

console.log('\n■ 손가락 벌리기 — 자유 확대');
{
  await open();
  await pg.evaluate(() => pinch_(100, 300));
  const s = await scale();
  check('벌린 만큼 커진다', s > 2.5 && s < 3.5, s);
  check('크게 본 상태로 표시된다', (await pg.evaluate(() => zoomed_())) === true);

  await pg.evaluate(() => pinch_(300, 100));
  check('오므리면 화면에 맞는 데서 멈춘다', (await scale()) === 1, await scale());
  check('맞춘 상태는 늘 가운데', JSON.stringify(await pg.evaluate(() => pos_())) === '[0,0]',
        await pg.evaluate(() => pos_()));
  check('벌리다 닫히지는 않는다', (await isOpen()) === true);
}

console.log('\n■ 크게 본 상태에서 끌기 — 움직인다, 밖으로는 안 나간다');
{
  await open();
  await pg.evaluate(() => setScale_(4));
  await pg.evaluate(() => drag_(300, 400, 120, 400));
  const [x] = await pg.evaluate(() => pos_());
  check('끈 만큼 옆으로 움직인다', x < -100, x);
  check('끌었다고 닫히지 않는다', (await isOpen()) === true);

  // 넘치는 만큼만 움직일 수 있어야 한다. 안 붙들면 사진이 화면 밖으로 사라진다.
  await pg.evaluate(() => { drag_(0, 400, 3000, 400); drag_(0, 400, 3000, 400); });
  const [x2] = await pg.evaluate(() => pos_());
  const lim = await pg.evaluate(() => {
    const img = nzImgEl();
    return Math.round((img.clientWidth * scale_() - innerWidth) / 2);
  });
  check('넘치는 만큼만 움직인다', x2 <= lim + 1, { x2, lim });
}

console.log('\n■ 닫은 뒤에 다시 열면 처음 상태');
{
  await open();
  await pg.evaluate(() => setScale_(5));
  await pg.evaluate(() => closeNoticeZoom());
  await open();
  check('배율이 1 로 돌아와 있다', (await scale()) === 1);
  check('위치도 가운데', JSON.stringify(await pg.evaluate(() => pos_())) === '[0,0]');
  check('크게 본 표시도 지워져 있다', (await pg.evaluate(() => zoomed_())) === false);
}

console.log('\n■ 옛 방식이 남아 있지 않다');
{
  check('한 번 더 눌러 원래 크기로 가는 길은 없앴다',
        !/toggleNoticeZoomActual/.test(HTML));
  check('훑어보기를 브라우저 스크롤에 맡기지 않는다',
        /\.notice-zoom-scroll\{[^}]*overflow:hidden/.test(HTML));
  check('몸짓을 브라우저가 가로채지 않게 한다',
        /\.notice-zoom-scroll\{[^}]*touch-action:none/.test(HTML));
  check('× 단추는 그대로 둔다 (몸짓을 모르는 사람의 길)',
        /notice-zoom-close[^>]*onclick="closeNoticeZoom\(\)"/.test(HTML));
  check('공지 그림도 같은 창으로 연다',
        /closest\('\.notice-view img'\)[\s\S]{0,80}openNoticeZoom\(img\.src\)/.test(HTML));
  check('캘린더 메모 그림도 같은 창으로 연다',
        /getElementById\('mytaskRecvInfo'\)\?\.addEventListener\('click'[\s\S]{0,200}openNoticeZoom\(img\.src\)/.test(HTML));
  check('뒤로가기·ESC 는 이 창을 먼저 닫는다',
        (HTML.match(/noticeImgZoom'\)\?\.classList\.contains\('open'\)/g) || []).length >= 2);
}

console.log(realErrs().length ? '\n❌ 런타임 오류:\n' + realErrs().slice(0, 4).join('\n')
                              : '\n✅ 런타임 오류 없음');
if (realErrs().length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
