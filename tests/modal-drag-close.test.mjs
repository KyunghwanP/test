// 창 안의 글을 드래그해 고르다가 손을 바깥에서 떼면 창이 닫히던 문제.
//
// 브라우저는 click 을 '누른 자리와 뗀 자리의 공통 조상' 에서 낸다. 그래서 창 안에서
// 끌기 시작해 바깥(어두운 자리)에서 손을 떼면, click 의 대상이 바깥이 되어
// '바깥을 눌렀다' 로 읽힌다. 고르던 글도, 적던 것도 그대로 날아갔다.
//
// 고침은 '누르기 시작한 자리' 까지 같이 보는 것이다. 둘 다 바깥일 때만 닫는다.
// 창이 열 곳이 넘으므로 판정은 한 군데(isOutsideClick)에 두고 다 같이 쓴다.
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
};

console.log('\n■ 배선 (정적)');
{
  check('판정이 한 군데다', /function isOutsideClick\(e, el\)\{/.test(HTML));
  check('누르기 시작한 자리를 적어 둔다',
        /document\.addEventListener\('pointerdown', e => \{ _pressStartedOn = e\.target; \}, true\);/.test(HTML));
  check('마우스에도 대비해 둔다',
        /document\.addEventListener\('mousedown',\s+e => \{ _pressStartedOn = e\.target; \}, true\);/.test(HTML));
  check('뗀 자리도 적어 둔다',
        /document\.addEventListener\('pointerup',\s+e => \{ _pressEndedOn   = e\.target; \}, true\);/.test(HTML));
  check('셋이 모두 바깥일 때만 참',
        /e\.target === target\s*\n\s*&& _pressStartedOn === target && _pressEndedOn === target;/.test(HTML));

  // 옛 방식(뗀 자리만 보기)이 남아 있으면 그 창만 여전히 닫힌다
  const leftovers = [
    /if\s*\(\s*e\.target === overlay\s*\)/,
    /if\s*\(\s*e\.target === e\.currentTarget\s*\)\s*close/,
    /if\s*\(\s*e\.target\.id === '(?:consultModal|consultAutoModal|ttMeetModal|classOrgModal|passModalOverlay)'\s*\)/,
    /if\s*\(\s*e\.target === document\.getElementById\('(?:mytaskModal|mytaskDayModal|ptsNewModal|ptsDetailModal)'\)\s*\)/,
  ];
  check('옛 방식이 남아 있지 않다', leftovers.every(re => !re.test(HTML)),
        leftovers.filter(re => re.test(HTML)).map(String));

  // 창마다 따로 고치면 새 창을 만들 때 또 빠뜨린다 — 쓰는 곳이 여럿인지 확인
  const uses = (HTML.match(/isOutsideClick\(/g) || []).length;
  check('여러 창이 같은 판정을 쓴다 (10곳 이상)', uses >= 10, uses);
}

console.log('\n■ 실제로 끌어 본다');
{
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await br.newPage({ viewport: { width: 700, height: 520 } });
  pg.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });

  await pg.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0}
    #ov{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;
        align-items:center;justify-content:center;}
    #box{background:#fff;width:300px;height:200px;padding:16px;}
  </style>
  <div id="ov"><div id="box"><p id="txt">여기 있는 글을 드래그해서 고른다</p></div></div>
  <script>
    let _pressStartedOn = null, _pressEndedOn = null;
    document.addEventListener('pointerdown', e => { _pressStartedOn = e.target; }, true);
    document.addEventListener('pointerup',   e => { _pressEndedOn   = e.target; }, true);
    document.addEventListener('mousedown',   e => { _pressStartedOn = e.target; }, true);
    document.addEventListener('mouseup',     e => { _pressEndedOn   = e.target; }, true);
    ${grab('isOutsideClick')}
    ${grab('isSamePress')}
    window.__shut = 0;
    document.getElementById('ov').addEventListener('click', e => {
      if (isOutsideClick(e, document.getElementById('ov'))) window.__shut++;
    });
  <\/script>`);

  const box = await pg.$eval('#box', e => { const r = e.getBoundingClientRect();
    return { x:r.x, y:r.y, w:r.width, h:r.height }; });

  // ① 글 안에서 끌기 시작해 바깥(어두운 자리)에서 손을 뗀다 — 닫히면 안 된다
  await pg.mouse.move(box.x + 30, box.y + 30);
  await pg.mouse.down();
  await pg.mouse.move(box.x + 200, box.y + 60, { steps: 8 });
  await pg.mouse.move(20, 20, { steps: 8 });        // 창 밖 어두운 자리
  await pg.mouse.up();
  check('안에서 끌어 바깥에서 떼면 안 닫힌다', (await pg.evaluate(() => window.__shut)) === 0,
        await pg.evaluate(() => window.__shut));

  // ② 바깥을 그냥 누른다 — 닫혀야 한다
  await pg.mouse.click(20, 20);
  check('바깥을 그냥 누르면 닫힌다', (await pg.evaluate(() => window.__shut)) === 1,
        await pg.evaluate(() => window.__shut));

  // ③ 바깥에서 끌기 시작해 창 안에서 뗀다 — 이것도 클릭이 아니다
  await pg.evaluate(() => { window.__shut = 0; });
  await pg.mouse.move(20, 20);
  await pg.mouse.down();
  await pg.mouse.move(box.x + 40, box.y + 40, { steps: 8 });
  await pg.mouse.up();
  check('바깥에서 끌어 안에서 떼도 안 닫힌다', (await pg.evaluate(() => window.__shut)) === 0,
        await pg.evaluate(() => window.__shut));

  // ④ 바깥에서 살짝 끌었다가 바깥에서 뗀다 — 같은 자리라 닫힌다
  //    앞 동작과 같은 좌표에서 연달아 누르면 더블클릭으로 묶여 up 이 안 난다
  //    (앱이 아니라 자동화 쪽 일이다). 자리를 옮기고 잠깐 쉰다.
  await pg.waitForTimeout(400);
  await pg.mouse.move(200, 430);
  await pg.mouse.down();
  await pg.mouse.move(220, 450, { steps: 4 });
  await pg.mouse.up();
  check('바깥에서만 움직였으면 닫힌다', (await pg.evaluate(() => window.__shut)) === 1,
        await pg.evaluate(() => window.__shut));

  // ⑤ 고른 글이 살아 있는가 — 이게 원래 지키려던 것이다
  await pg.evaluate(() => { window.__shut = 0; });
  await pg.mouse.move(box.x + 30, box.y + 30);
  await pg.mouse.down();
  await pg.mouse.move(box.x + 220, box.y + 34, { steps: 10 });
  await pg.mouse.move(10, 500, { steps: 10 });
  await pg.mouse.up();
  const sel = await pg.evaluate(() => String(getSelection()));
  check('끌어서 고른 글이 남아 있다', sel.length > 0, sel);
  check('그때도 안 닫힌다', (await pg.evaluate(() => window.__shut)) === 0);

  await br.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
