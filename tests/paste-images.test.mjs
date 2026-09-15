// 붙여넣기 — 영역째 복사한 글 안의 그림까지 들어오는가.
//
// 클립보드에는 두 가지가 따로 실린다. 어느 쪽이 실리느냐는 '무엇을 복사했나'로
// 갈린다 — 로컬이냐 바깥이냐가 아니다.
//   · 그림 하나를 집어서 복사   → 파일(바이트)이 실린다.
//   · 영역을 드래그해서 복사    → HTML 만 실린다. 그림은 <img src="..."> 주소뿐이다.
// 둘이 같이 실리는 경우도 흔하다(웹에서 그림 한 장 복사, 워드에서 그림 한 장 복사).
//
// 실제로 겪은 일: 파일이 하나라도 있으면 HTML 을 통째로 버렸다. 글 + 그림을
// 같이 복사하면 그림만 들어가고 글자가 전부 사라졌다.
//
// 진짜 브라우저로만 확인된다 — DataTransfer·execCommand·data: fetch 가 전부
// 브라우저 것이다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

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
<div class="rt-editor" id="ed" contenteditable></div>
<script>
  ${grabConst('RT_TAGS')}
  ${grabConst('RT_DROP')}
  ${grabConst('RT_STYLES')}
  ${grabConst('RT_SEG')}
  ${grabConst('RT_KEY_RE')}
  ${grabConst('RT_ZWSP')}
  ${grabConst('RT_FONT_PX')}
  ${grabConst('RT_HOLD_SRC')}
  ${grab('rtCleanStyle')}
  ${grab('rtPreserveStyles')}
  ${grab('rtPasteSrc')}
  ${grab('rtSanitize')}
  ${grab('rtErrText')}
  ${grab('rtFetchErrText')}
  ${grab('rtPutBlob')}
  ${grab('rtInsertImage')}
  ${grab('rtPasteBlob')}
  ${grab('rtFillPending')}
  ${grab('rtStillFilling')}
  ${grab('rtOnPaste')}
  ${grab('rtInsertFromClipboard')}
  ${grab('rtSweepDataImages')}
  ${grabConst('rtFileId')}

  // ── 바깥 세계만 흉내낸다 ──
  // 줄이기는 캔버스 일이라 여기서 재현할 필요가 없다. 대신 '들어온 바이트가
  // 그대로 나간다'로 두면, 어느 자리에 어느 그림이 들어갔는지 검사에서 읽을 수 있다.
  window.API = [];            // 워커로 나간 요청
  window.FETCHABLE = {};      // 바깥 주소 → 바이트(없으면 실패)
  window.ALERTS = [];
  window.KEYS = [];
  window.STATUS = '';
  window.DIRTY = 0;
  window.PUT = { kind: 'notice', noticeId: 'n1' };
  let _n = 0;
  window.alert = m => ALERTS.push(m);
  async function rtShrink(blob){ return 'data:image/png;base64,' + btoa(await blob.text()); }
  async function rtApi(p){
    API.push(p);
    if (p.action === 'put') return { success: true, key: 'notices/test/n1/f' + (++_n) + '.jpg' };
    if (p.action === 'fetchImg') {
      const bytes = FETCHABLE[p.url];
      if (!bytes) return { success: false, error: 'FETCH_FAIL' };
      return { success: true, dataUrl: 'data:image/png;base64,' + btoa(bytes) };
    }
    return { success: false, error: 'UNKNOWN_ACTION' };
  }

  const ed = document.getElementById('ed');
  ed._rt = { put: () => PUT,
             status:  m => { STATUS = m; },
             onKey:   k => KEYS.push(k),
             onDirty: () => { DIRTY++; },
             noPutMsg: '여기에는 그림을 넣을 수 없습니다.' };

  window.reset_ = () => { ed.innerHTML = ''; API = []; ALERTS = []; KEYS = [];
                          STATUS = ''; DIRTY = 0; PUT = { kind:'notice', noticeId:'n1' }; };

  // 클립보드를 만들어 붙여넣기를 태운다.
  //   html  : text/html 에 실리는 것 (없으면 안 싣는다)
  //   files : [['이름', '바이트'], ...] — kind:'file' 로 실린다
  window.paste_ = async (html, files) => {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    for (const [name, bytes] of (files || []))
      dt.items.add(new File([bytes], name, { type: 'image/png' }));
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, cancelable: true, bubbles: true });
    await rtOnPaste(ev, ed);
    return ev.defaultPrevented;
  };

  // 클립보드를 직접 읽는 길. 폰에서 붙여넣기 몸짓이 사진을 안 들고 올 때 쓴다.
  // read() 가 무엇을 주느냐만 바꿔 끼운다.
  window.setClip_ = spec => {
    const items = spec === 'deny' ? null : spec.map(([type, bytes]) => ({
      types: [type],
      getType: async t => new Blob([bytes], { type: t }),
    }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => { if (!items) throw new Error('거절'); return items; } },
    });
  };

  // 폰에서 실제로 겪는 길: 붙여넣기 이벤트에는 아무것도 안 실려 오는데,
  // 브라우저가 제 손으로 data: 그림을 편집기에 꽂아 넣는다. 그 순서를 흉내낸다.
  window.pasteByBrowser_ = async inserted => {
    const dt = new DataTransfer();              // 우리가 알아볼 것이 없는 클립보드
    ed.focus();
    const ev = new ClipboardEvent('paste', { clipboardData: dt, cancelable: true, bubbles: true });
    await rtOnPaste(ev, ed);
    ed.innerHTML += inserted;                   // ← 브라우저 기본 동작
    return ev.defaultPrevented;
  };

  window.html_  = () => ed.innerHTML;
  window.text_  = () => ed.textContent;
  window.imgs_  = () => [...ed.querySelectorAll('img')].map(i => ({
                          k: i.getAttribute('data-k') || '',
                          hold: i.classList.contains('rt-hold'),
                          src: (i.getAttribute('src') || '').slice(0, 40) }));
  // 워커로 실제로 올라간 그림의 바이트. 어느 자리가 어느 그림으로 채워졌는지 본다.
  window.putBytes_ = () => API.filter(p => p.action === 'put')
                              .map(p => atob(String(p.dataUrl).split(',')[1]));
  window.fetched_  = () => API.filter(p => p.action === 'fetchImg').map(p => p.url);
</script>`);

const ev  = (h, f) => pg.evaluate(([h, f]) => window.paste_(h, f), [h, f || null]);
const put = () => pg.evaluate(() => window.putBytes_());
const got = () => pg.evaluate(() => window.fetched_());
const txt = () => pg.evaluate(() => window.text_());
const imgs = () => pg.evaluate(() => window.imgs_());
const reset = () => pg.evaluate(() => window.reset_());

console.log('\n■ 잡을 수 있는 주소만 잡는다');
{
  const cases = ['data:image/png;base64,AAA', 'https://a.example/b.png',
                 'http://a.example/b.png', 'file:///C:/a.png',
                 'blob:https://x/1', 'cid:part1', '', 'javascript:alert(1)',
                 'https://a.example/b.png" onerror="x'];
  const m = Object.fromEntries(
    (await pg.evaluate(cs => cs.map(s => rtPasteSrc(s) ? 'O' : 'X'), cases))
      .map((v, i) => [cases[i], v]));
  check('data: 는 잡는다',   m['data:image/png;base64,AAA'] === 'O', m);
  check('https: 는 잡는다',  m['https://a.example/b.png'] === 'O', m);
  check('http: 는 안 잡는다', m['http://a.example/b.png'] === 'X', m);
  check('file:/// 은 안 잡는다', m['file:///C:/a.png'] === 'X', m);
  check('blob: 은 안 잡는다', m['blob:https://x/1'] === 'X', m);
  check('cid: 은 안 잡는다',  m['cid:part1'] === 'X', m);
  check('javascript: 은 안 잡는다', m['javascript:alert(1)'] === 'X', m);
  check('따옴표가 섞인 주소는 안 잡는다', m['https://a.example/b.png" onerror="x'] === 'X', m);
}

console.log('\n■ 글 + 그림 한 장을 같이 복사 (실제로 났던 일)');
{
  await reset();
  await ev('<p>안내드립니다</p><img src="https://cdn.example/a.png"><p>끝</p>', [['a.png', 'FILEBYTES']]);
  check('글자가 살아남는다', (await txt()).includes('안내드립니다') && (await txt()).includes('끝'),
        await txt());
  const im = await imgs();
  check('그림 자리가 채워진다', im.length === 1 && /^notices\//.test(im[0].k), im);
  check('남의 서버로 다시 받으러 가지 않는다 (손에 이미 있다)', (await got()).length === 0, await got());
  check('클립보드 파일이 올라간다', JSON.stringify(await put()) === '["FILEBYTES"]', await put());
  check('키를 바깥에 알려 준다', (await pg.evaluate(() => KEYS)).length === 1);
}

console.log('\n■ 글만 복사');
{
  await reset();
  await ev('<p>그냥 <b>글</b></p>');
  check('그대로 들어간다', (await txt()) === '그냥 글', await txt());
  check('워커를 부르지 않는다', (await pg.evaluate(() => API)).length === 0);
}

console.log('\n■ 영역째 복사 — 바깥 주소 그림 (파일이 같이 안 온다)');
{
  await reset();
  await pg.evaluate(() => { FETCHABLE['https://cdn.example/p.png'] = 'REMOTE'; });
  await ev('<p>공문</p><img src="https://cdn.example/p.png"><p>붙임</p>');
  check('글자가 살아남는다', (await txt()).includes('공문') && (await txt()).includes('붙임'));
  check('워커한테 받아 온다', JSON.stringify(await got()) === '["https://cdn.example/p.png"]', await got());
  check('받아 온 것을 올린다', JSON.stringify(await put()) === '["REMOTE"]', await put());
  const im = await imgs();
  check('자리가 채워지고 표시가 벗겨진다', im.length === 1 && !im[0].hold && /^notices\//.test(im[0].k), im);
  check('바깥 주소는 본문에 안 남는다', !(await pg.evaluate(() => html_())).includes('cdn.example'));
}

console.log('\n■ 영역째 복사 — data: 로 실려 온 그림');
{
  await reset();
  await ev('<p>표</p><img src="data:image/png;base64,' + Buffer.from('INLINE').toString('base64') + '">');
  check('워커한테 안 물어본다', (await got()).length === 0, await got());
  check('그 자리에서 풀어 올린다', JSON.stringify(await put()) === '["INLINE"]', await put());
  check('글자도 그대로다', (await txt()).includes('표'));
}

console.log('\n■ 영역째 복사 — 한글·워드 (file:/// 주소)');
{
  await reset();
  await ev('<p>기안문</p><img src="file:///C:/Users/a/img1.png">');
  check('자리는 지워진다', (await imgs()).length === 0, await imgs());
  check('글자는 남는다', (await txt()).includes('기안문'), await txt());
  check('아무것도 안 올린다', (await put()).length === 0);

  // 워드에서 그림 한 장을 복사하면 file:/// HTML 과 그림 파일이 같이 온다.
  await reset();
  await ev('<p>기안문</p><img src="file:///C:/Users/a/img1.png">', [['w.png', 'WORDIMG']]);
  check('파일이 같이 왔으면 그 자리를 채운다', JSON.stringify(await put()) === '["WORDIMG"]', await put());
  check('그때도 글자는 그대로', (await txt()).includes('기안문'));
}

console.log('\n■ 그림만 복사 (예전 길 그대로)');
{
  await reset();
  await ev('', [['a.png', 'ONLYIMG']]);
  check('그대로 올라간다', JSON.stringify(await put()) === '["ONLYIMG"]', await put());
  check('그림이 들어간다', (await imgs()).length === 1, await imgs());
}

console.log('\n■ 못 가져온 그림');
{
  await reset();
  await ev('<p>본문</p><img src="https://cdn.example/없음.png"><p>뒤</p>');
  check('자리를 지운다', (await imgs()).length === 0, await imgs());
  check('글은 다 남는다', (await txt()).includes('본문') && (await txt()).includes('뒤'), await txt());
  check('경고창을 띄우지 않는다', (await pg.evaluate(() => ALERTS)).length === 0);
  check('대신 한 줄로 알린다', /가져오지 못했습니다/.test(await pg.evaluate(() => STATUS)),
        await pg.evaluate(() => STATUS));
}

console.log('\n■ 여러 장 — 되는 것만 채운다');
{
  await reset();
  await pg.evaluate(() => { FETCHABLE['https://cdn.example/1.png'] = 'ONE';
                            FETCHABLE['https://cdn.example/3.png'] = 'THREE'; });
  await ev('<img src="https://cdn.example/1.png"><img src="https://cdn.example/2.png">' +
           '<img src="https://cdn.example/3.png">');
  check('되는 두 장만 남는다', (await imgs()).length === 2, await imgs());
  check('올라간 것도 두 장', JSON.stringify(await put()) === '["ONE","THREE"]', await put());
  check('못 가져온 장 수를 알려 준다', /3장 중 1장/.test(await pg.evaluate(() => STATUS)),
        await pg.evaluate(() => STATUS));
}

console.log('\n■ 자리보다 파일이 많으면');
{
  await reset();
  await ev('<p>글</p><img src="file:///a.png">', [['a.png', 'AA'], ['b.png', 'BB']]);
  check('남은 파일도 버리지 않는다', JSON.stringify(await put()) === '["AA","BB"]', await put());
  check('둘 다 본문에 들어간다', (await imgs()).length === 2, await imgs());
}

console.log('\n■ 그림을 못 받는 자리');
{
  await reset();
  await pg.evaluate(() => { PUT = null; });
  await ev('<p>글자는 살려야</p><img src="https://cdn.example/p.png">');
  check('그림은 못 넣는다고 알린다', /그림을 넣을 수 없습니다/.test((await pg.evaluate(() => ALERTS))[0] || ''),
        await pg.evaluate(() => ALERTS));
  check('그래도 글자는 들어간다', (await txt()).includes('글자는 살려야'), await txt());
  check('그림 자리는 안 남는다', (await imgs()).length === 0, await imgs());
  check('아무것도 안 올린다', (await put()).length === 0);

  // 그림만 복사한 경우는 넣을 글도 없다 — 알림만 뜨고 끝난다.
  await reset();
  await pg.evaluate(() => { PUT = null; });
  await ev('', [['a.png', 'X']]);
  check('그림만 복사했으면 알림만', (await pg.evaluate(() => ALERTS)).length === 1 &&
                                    (await imgs()).length === 0);
}

console.log('\n■ 브라우저가 제 손으로 꽂아 넣은 그림 (폰에서 실제로 났던 일)');
{
  // '붙여넣기는 되는데 저장하면 사진이 사라진다' — 붙여넣기 이벤트에는 아무것도
  // 안 실려 오는데 화면에는 그림이 뜬다. 우리 것이 아니라 저장할 때 떨어져 나갔다.
  const IMG = 'data:image/png;base64,' + Buffer.from('BYBROWSER').toString('base64');
  await reset();
  const prevented = await pg.evaluate(src => window.pasteByBrowser_('<img src="' + src + '">'), IMG);
  check('기본 동작을 막지 않는다', prevented === false);
  // 훑기는 기본 동작이 끝난 뒤(setTimeout)에 도는 일이라 잠깐 기다린다.
  // 안 돌면 여기서 조용히 넘어가고 아래 검사가 무엇이 빠졌는지 말해 준다.
  await pg.waitForFunction(() => putBytes_().length > 0 || ALERTS.length > 0, null, { timeout: 3000 })
          .catch(() => {});
  check('꽂힌 그림을 우리 것으로 만든다', JSON.stringify(await put()) === '["BYBROWSER"]', await put());
  const im = await imgs();
  check('본문의 그림에 키가 붙는다', im.length === 1 && /^notices\//.test(im[0].k), im);
  check('저장해도 안 사라진다',
        /data-k="notices\//.test(await pg.evaluate(() => rtSanitize(html_()))),
        await pg.evaluate(() => rtSanitize(html_())));

  // 이미 우리 것이거나 지금 채우는 중인 자리는 다시 집으면 안 된다.
  await reset();
  await pg.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.innerHTML = '<img data-k="notices/test/n1/f9.jpg" src="data:image/png;base64,QUJD">' +
                   '<img class="rt-hold" src="' + RT_HOLD_SRC + '">';
  });
  await pg.evaluate(() => rtSweepDataImages(document.getElementById('ed')));
  check('이미 올린 그림은 다시 안 올린다', (await put()).length === 0, await put());
  check('채우는 중인 자리도 안 건드린다', (await imgs()).length === 2, await imgs());

  // 그림을 못 받는 자리에 꽂혔으면, 조용히 두면 저장할 때 사라진다 — 지금 말한다.
  await reset();
  await pg.evaluate(() => { PUT = null; });
  await pg.evaluate(src => { document.getElementById('ed').innerHTML = '<p>글</p><img src="' + src + '">'; }, IMG);
  await pg.evaluate(() => rtSweepDataImages(document.getElementById('ed')));
  check('못 받는 자리면 그 자리에서 알린다',
        /그림을 넣을 수 없습니다/.test((await pg.evaluate(() => ALERTS))[0] || ''),
        await pg.evaluate(() => ALERTS));
  check('그때 글자는 남는다', (await txt()).includes('글'), await txt());

  // 글자만 붙여넣었을 때 괜히 일하지 않는다
  await reset();
  await pg.evaluate(() => window.pasteByBrowser_('그냥 글'));
  check('꽂힌 그림이 없으면 아무 일도 안 한다', (await put()).length === 0);
}

console.log('\n■ 클립보드에서 바로 받기 (📋 단추)');
{
  // 사진첩 단추(🖼)는 '저장된 파일'만 고른다. 카톡이나 웹에서 이미지만 복사한
  // 경우에는 고를 파일이 없다 — 그 구멍을 메우는 길이다.
  await reset();
  await pg.evaluate(() => setClip_([['image/png', 'CLIPIMG']]));
  await pg.evaluate(() => rtInsertFromClipboard(document.getElementById('ed')));
  check('클립보드의 사진이 올라간다', JSON.stringify(await put()) === '["CLIPIMG"]', await put());
  check('본문에 들어간다', (await imgs()).length === 1, await imgs());

  await reset();
  await pg.evaluate(() => setClip_([['image/png', 'A'], ['image/png', 'B']]));
  await pg.evaluate(() => rtInsertFromClipboard(document.getElementById('ed')));
  check('여러 장도 다 넣는다', JSON.stringify(await put()) === '["A","B"]', await put());

  // 글자만 복사해 놓고 눌렀을 때. 아무 일도 안 일어나면 '단추가 고장났다'로 보인다.
  await reset();
  await pg.evaluate(() => setClip_([['text/plain', '그냥 글']]));
  await pg.evaluate(() => rtInsertFromClipboard(document.getElementById('ed')));
  check('사진이 없으면 아무것도 안 올린다', (await put()).length === 0);
  check('사진이 없다고 말해 준다', /사진이 없습니다/.test((await pg.evaluate(() => ALERTS))[0] || ''),
        await pg.evaluate(() => ALERTS));

  // 사파리는 '붙여넣기' 확인 단추를 띄운다. 거절하면 예외가 난다.
  await reset();
  await pg.evaluate(() => setClip_('deny'));
  await pg.evaluate(() => rtInsertFromClipboard(document.getElementById('ed')));
  check('못 읽으면 왜 안 됐는지 말해 준다',
        /클립보드를 읽지 못했습니다/.test((await pg.evaluate(() => ALERTS))[0] || ''),
        await pg.evaluate(() => ALERTS));
  check('그때 아무것도 안 올린다', (await put()).length === 0);

  // 단추가 실제로 달려 있고, 읽을 길이 없는 브라우저에서는 감춰지는가.
  const bar = grab('rtToolbarHtml');
  check('도구모음에 단추가 있다', /rt-clip-btn/.test(bar) && /hidden/.test(bar), bar.slice(-300));
  const bind = grab('rtBindEditor');
  check('읽을 길이 있을 때만 보인다',
        /navigator\.clipboard && navigator\.clipboard\.read/.test(bind) &&
        /clipBtn\.hidden = false/.test(bind));
  check('그림을 못 받는 자리에서는 안 보인다', /clipBtn && o\.put &&/.test(bind));
  check('눌렀을 때 클립보드를 읽는다', /rtInsertFromClipboard\(ed\)/.test(bind));
}

console.log('\n■ 저장이 덜 채운 자리를 날려먹지 않는다');
{
  // 붙여넣기 직후 저장 단추를 누르면, 걸러내기가 빈 자리를 통째로 떼어 낸다 —
  // 선생님 눈에는 그림이 그냥 사라진 것이 된다. 저장 쪽에서 먼저 막는다.
  await reset();
  const blocked = await pg.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.innerHTML = '<p>글</p><img class="rt-hold" src="' + RT_HOLD_SRC + '">';
    return rtStillFilling(ed);
  });
  check('채우는 중이면 저장을 막는다', blocked === true);
  check('왜 막았는지 말해 준다', /아직 가져오는 중/.test((await pg.evaluate(() => ALERTS)).pop() || ''),
        await pg.evaluate(() => ALERTS));

  const free = await pg.evaluate(() => {
    const ed = document.getElementById('ed');
    ed.innerHTML = '<p>글</p><img data-k="notices/test/n1/f1.jpg">';
    return rtStillFilling(ed);
  });
  check('다 채워졌으면 안 막는다', free === false);

  // 막는 함수가 있어도 저장 쪽에서 안 부르면 아무 소용이 없다. 두 저장 경로가
  // 실제로 이 문을 지나는지 소스에서 본다(브라우저로 태우려면 Firestore 가 붙는다).
  const guarded = fn => {
    const body = grab(fn);
    const i = body.indexOf('rtStillFilling');
    const j = body.indexOf('rtSanitize');
    return i > 0 && j > 0 && i < j;   // 걸러내기보다 먼저 막아야 한다
  };
  check('공지 저장이 이 문을 지난다', guarded('saveNotice'));
  check('캘린더 메모 저장이 이 문을 지난다', guarded('saveMytask'));
}

console.log('\n■ 저장할 때는 빈 자리가 떨어져 나간다');
{
  const out = await pg.evaluate(() => rtSanitize(
    '<p>글</p><img data-rt-src="https://a/b.png"><img data-k="notices/test/n1/f1.jpg">'));
  check('못 채운 자리는 저장되지 않는다', !/data-rt-src/.test(out), out);
  check('우리 그림은 남는다', /data-k="notices\/test\/n1\/f1.jpg"/.test(out), out);
  check('그래도 글은 남는다', out.includes('글'), out);

  // 걸러내기를 옵션 없이 부르면 예전과 똑같아야 한다 — 보기·저장이 이 모양을 쓴다.
  const plain = await pg.evaluate(() => rtSanitize('<p>글</p><img src="https://a/b.png">'));
  check('옵션 없이 부르면 바깥 그림은 지운다', !/img/.test(plain), plain);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
