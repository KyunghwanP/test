// 업무캘린더 메모 — 서식과 그림.
//
// 메모는 오래 순수 글자였다. 서식·그림을 넣기로 하면서 저장 모양이 둘이 됐다.
//   memo      글자만. 예전 메모가 이 모양이고, 아직 새 앱을 못 받은 화면도 이걸 읽는다.
//   memoHtml  서식·그림이 들어간 새 메모.
// 그래서 여기서 제일 먼저 보는 것은 '옛 메모가 그대로 보이는가'다. 새것만 맞고
// 옛것이 깨지면, 이미 적어 둔 메모가 전부 한 줄로 뭉개진다.
//
// 그림은 R2 에 있고 문서에는 키만 남는다. 키가 곧 파일 경로라, 바깥에서 온
// 문자열이 키 자리에 앉지 못하게 하는 것이 두 번째다.
//
// 그리고 제일 위험한 자리 — 청소(안 쓰는 그림 지우기). 기준이 되는 '내가 쓰는
// 그림 목록'이 틀리면 내 그림이 통째로 지워진다. 목록이 아직 안 왔을 때와
// 보기 모드일 때 청소를 아예 안 하는지를 본다.
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
{
  check('메모가 textarea 가 아니라 편집기다',
        /<div class="rt-editor compact" id="mytaskMemoEd" contenteditable="true"/.test(HTML));
  check('옛 textarea 는 남아 있지 않다', !/id="mytaskMemo"[^E]/.test(HTML));
  check('도구 모음은 공용 만들개로 채운다', /bar\.innerHTML = rtToolbarHtml\(\);/.test(HTML));
  check('그림은 붙여넣기로 넣는다고 적어 둔다', /Ctrl\+V 로 붙여넣기<\/b>\. 학생 신상이/.test(HTML));
  // 그림을 키를 아는 교사면 받을 수 있다는 한계를 알고 쓰는 것이므로,
  // 민감한 자료를 넣지 말라는 말이 화면에 있어야 한다.
  check('민감한 자료를 넣지 말라고 적어 둔다', /학생 신상이 담긴 자료는 넣지 마세요/.test(HTML));

  // 새 일정도 id 를 미리 받는다. addDoc 으로 돌아가면 그림이 아무 일정에도
  // 안 딸린 자리에 남는다.
  check('저장은 미리 받은 id 로 한다', /const docId = mytaskEditId \|\| _mytaskDocId \|\| mytaskNewDocId\(\);/.test(HTML));
  check('일정 저장에 addDoc 을 쓰지 않는다',
        !/addDoc\(collection\(fbDb, 'tasks'/.test(HTML));

  // 시간표에서 '협의'로 넘어올 때 메모를 채우는 길. 입력칸이 편집기로 바뀌었으므로
  // .value 로 넣으면 아무 일도 안 일어난다(조용히 실패한다).
  check('협의 프리필이 편집기에 넣는다', /memoEd\.innerHTML = lines\.map\(l => escapeHtml\(l\)\)\.join\('<br>'\);/.test(HTML));
  check('협의 프리필이 이름을 escape 한다', /lines\.map\(l => escapeHtml\(l\)\)/.test(HTML));
  check('옛 .value 넣기가 남아 있지 않다', !/set\('mytaskMemo'/.test(HTML));

  // 메모 그림도 눌러서 크게 볼 수 있어야 한다. 크게 보기 창이 캘린더 모달보다
  // 위에 뜨는지(z-index), ESC 가 그것부터 닫는지도 같이 본다.
  check('메모 그림을 누르면 크게 보기가 열린다',
        /getElementById\('mytaskRecvInfo'\)\?\.addEventListener\('click'[\s\S]{0,200}openNoticeZoom\(img\.src\)/.test(HTML));
  check('크게 보기가 캘린더 모달보다 위에 있다', (() => {
    const zoom = /\.notice-zoom\{[^}]*z-index:(\d+)/.exec(HTML);
    const modal = /\.mytask-modal\{[^}]*z-index:(\d+)/.exec(HTML);
    return zoom && modal && Number(zoom[1]) > Number(modal[1]);
  })());
  check('ESC 는 크게 보기를 캘린더보다 먼저 닫는다',
        HTML.indexOf("noticeImgZoom')?.classList.contains('open')") <
        HTML.lastIndexOf("mytaskModal')?.classList.contains('show')"));

  check('일정을 지우면 그림도 지운다',
        /if \(goneKeys\.length\) rtApi\(\{ action: 'del', keys: goneKeys \}\)/.test(HTML));
  check('청소는 기준을 못 믿으면 건너뛴다', /if \(keep\) rtApi\(\{ action: 'sweep', kind: 'task', keep \}\)/.test(HTML));
  check('청소 요청에 kind:task 를 싣는다', /action: 'sweep', kind: 'task'/.test(HTML));
  check('목록이 실제로 온 뒤에만 청소한다', /mytaskLoadedOnce = true;/.test(HTML));
  check('보기 모드에서는 청소하지 않는다',
        /if \(!u \|\| isViewAs\(\) \|\| !mytaskLoadedOnce\) return null;/.test(HTML));
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await browser.newPage({ viewport: { width: 640, height: 700 } });
pg.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });

// 모달 markup 을 원본에서 떼어 온다
const a = HTML.indexOf('<div id="mytaskRecvInfo"');
const b = HTML.indexOf('<!-- 각자 완료 현황 (perDone 일정 전용) -->');
const markup = HTML.slice(a, b);
const css = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

await pg.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${markup}
<script>
${grabConst('RT_TAGS')}
${grabConst('RT_DROP')}
${grabConst('RT_STYLES')}
${grabConst('RT_SEG')}
${grabConst('RT_KEY_RE')}
${grabConst('RT_ZWSP')}
${grabConst('RT_COLORS')}
${grabConst('RT_SIZES')}
${grab('escapeHtml')}
${grab('rtCleanStyle')}
${grab('rtSanitize')}
${grab('rtKeysIn')}
${grab('rtPlainText')}
${grab('mytaskMemoHtml')}
${grab('rtToolbarHtml')}
${grab('formatMytaskDateRange')}
${/const MYTASK_REPEAT_LABEL = \{[^}]*\};/.exec(HTML)[0]}
const TEACHERS = [{ name:'김민준', email:'kim@yeungnam.hs.kr', uid:'u-kim' }];
const fbAuth = { currentUser:{ uid:'u-kim', email:'kim@yeungnam.hs.kr', displayName:'김민준' } };
function rtLoadImages(root){ window.__loaded = [...root.querySelectorAll('img[data-k]')].map(i => i.getAttribute('data-k')); }
${grab('renderMytaskRecvInfo')}
window.show = t => { renderMytaskRecvInfo(t, true); return document.getElementById('mytaskRecvInfo').innerHTML; };
window.toEd = t => mytaskMemoHtml(t);
window.plain = h => rtPlainText(h);
window.clean = h => rtSanitize(h);
window.keys = h => rtKeysIn(h);
<\/script>`);

console.log('\n■ 옛 메모(글자만)가 그대로 보인다');
{
  const t = { title:'출결 마감', startDate:'2026-09-01', endDate:'2026-09-01',
              memo:'- 출결 마감\n- 제출처 : 문광섭 선생님' };
  const txt = await pg.evaluate(x => { window.show(x); return document.getElementById('mytaskRecvInfo').innerText; }, t);
  check('줄바꿈이 살아 있다', txt.includes('마감\n- 제출처'), txt);
  const ws = await pg.$eval('.mrv-text', el => getComputedStyle(el).whiteSpace);
  check('예전과 같은 pre-wrap 상자를 쓴다', ws === 'pre-wrap', ws);

  // 편집기로 올릴 때도 줄이 살아야 한다 — 여기서 뭉개지면 열어 보는 순간 망가진다
  const ed = await pg.evaluate(x => window.toEd(x), t);
  check('편집기에 올릴 때 줄바꿈이 <br> 로 바뀐다', ed.includes('<br>'), ed);
  check('글자는 그대로', ed.includes('문광섭'), ed);
}

console.log('\n■ 옛 메모의 태그는 글자로 남는다 (실행되지 않는다)');
{
  const ed = await pg.evaluate(() => window.toEd({ memo: '<img src=x onerror=alert(1)>표' }));
  check('태그가 글자로 바뀐다', ed.includes('&lt;img'), ed);
  const n = await pg.evaluate(x => { const d = document.createElement('div'); d.innerHTML = x;
                                     return d.querySelectorAll('img').length; }, ed);
  check('그림 태그가 생기지 않는다', n === 0, n);
}

console.log('\n■ 새 메모(서식) 가 살아난다');
{
  const t = { title:'협의', startDate:'2026-09-01', endDate:'2026-09-01',
    memoHtml:'<div><span style="color:#dc2626;font-size:19px">빨강 크게</span> 그리고 <b>굵게</b></div>' };
  await pg.evaluate(x => window.show(x), t);
  const got = await pg.evaluate(() => {
    const sp = document.querySelector('.rt-view span');
    return { color: sp && getComputedStyle(sp).color, size: sp && getComputedStyle(sp).fontSize,
             bold: !!document.querySelector('.rt-view b'),
             pre: !!document.querySelector('.mrv-text') };
  });
  check('색이 살아 있다', got.color === 'rgb(220, 38, 38)', got);
  check('크기가 살아 있다', got.size === '19px', got);
  check('굵게가 살아 있다', got.bold, got);
  check('서식 메모는 pre-wrap 상자를 쓰지 않는다', !got.pre, got);
}

console.log('\n■ 새 메모라도 위험한 것은 걸러진다');
{
  const bad = '<div onclick="alert(1)" style="position:fixed;top:0;background:red">글</div>'
            + '<iframe src="https://evil.example"></iframe>'
            + '<a href="javascript:alert(1)">링크</a>';
  await pg.evaluate(x => window.show({ title:'t', startDate:'2026-09-01', endDate:'2026-09-01', memoHtml:x }), bad);
  const got = await pg.evaluate(() => {
    const v = document.querySelector('.rt-view');
    return { onclick: v.innerHTML.includes('onclick'), fixed: v.innerHTML.includes('position'),
             iframe: v.querySelectorAll('iframe').length, js: v.innerHTML.includes('javascript:'),
             glyph: v.innerText.includes('글'), link: v.innerText.includes('링크') };
  });
  check('onclick 이 사라진다', !got.onclick, got);
  check('position:fixed 가 사라진다 (화면을 덮을 수 없다)', !got.fixed, got);
  check('iframe 이 사라진다', got.iframe === 0, got);
  check('javascript: 주소가 사라진다', !got.js, got);
  check('그래도 글자는 남는다', got.glyph && got.link, got);
}

console.log('\n■ 그림 — 키만 남고, 키가 아니면 사라진다');
{
  const good = 'tasks/test/uidKim/task1/f1.jpg';
  const html = `<div><img data-k="${good}" src="blob:whatever"><img data-k="../../etc/passwd">`
             + `<img src="https://evil.example/track.gif"></div>`;
  const cleaned = await pg.evaluate(x => window.clean(x), html);
  check('제대로 된 키는 남는다', cleaned.includes(good), cleaned);
  check('src 는 떨어져 나간다 (바깥 주소를 그대로 두지 않는다)',
        !cleaned.includes('blob:') && !cleaned.includes('evil.example'), cleaned);
  check('이상한 키는 그림째 사라진다', !cleaned.includes('passwd'), cleaned);
  const ks = await pg.evaluate(x => window.keys(x), cleaned);
  check('쓰이는 키를 뽑아낸다', ks.length === 1 && ks[0] === good, ks);

  // 공지 키도 모양은 맞다 — 따로 막지 않는다(공지 그림은 어차피 전 교사가 본다)
  const nk = await pg.evaluate(() => window.keys('<img data-k="notices/test/board/f1.jpg">'));
  check('공지 키도 키로 읽힌다', nk.length === 1, nk);
}

console.log('\n■ 그림이 있는 메모');
{
  const k = 'tasks/test/uidKim/task1/f1.jpg';
  await pg.evaluate(x => window.show({ title:'t', startDate:'2026-09-01', endDate:'2026-09-01',
                                       memoHtml:`<div>사진<img data-k="${x}"></div>` }), k);
  const loaded = await pg.evaluate(() => window.__loaded);
  check('그림을 받아 오라고 시킨다', Array.isArray(loaded) && loaded[0] === k, loaded);
}

console.log('\n■ 옛 화면을 위한 글자 사본');
{
  const p = await pg.evaluate(() => window.plain('<div>첫 줄</div><div>둘째 줄</div>'));
  check('문단이 줄로 바뀐다', p === '첫 줄\n둘째 줄', JSON.stringify(p));
  const p2 = await pg.evaluate(() => window.plain('<div><b>굵게</b>와 <span style="color:red">색</span></div>'));
  check('서식은 빠지고 글자만 남는다', p2 === '굵게와 색', JSON.stringify(p2));
  const p3 = await pg.evaluate(() => window.plain('<div><img data-k="tasks/test/uidKim/t/f.jpg"></div>'));
  check('그림만 있으면 글자가 없다', p3 === '', JSON.stringify(p3));
}

console.log('\n■ 실제로 단추를 눌러 본다 (편집기가 둘일 때)');
{
  // 이번 고침의 제일 큰 위험이 여기다. 전에는 편집기 배선이 #noticeEditBody 안의
  // 단추를 문서 전체에서 찾았다. 화면에 편집기가 둘이면 공지 단추가 메모를 건드리거나
  // 그 반대가 된다. 그래서 '두 대를 띄워 놓고' 눌러 본다.
  const pg2 = await browser.newPage({ viewport: { width: 800, height: 700 } });
  pg2.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });
  await pg2.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>
    <div id="barA"></div><div class="rt-editor compact" id="edA" contenteditable="true"></div>
    <div id="barB"></div><div class="rt-editor compact" id="edB" contenteditable="true"></div>
    <script>
    ${grabConst('RT_COLORS')}
    ${grabConst('RT_SIZES')}
    ${grabConst('RT_ZWSP')}
    ${grab('rtToolbarHtml')}
    ${grab('rtSetFontSize')}
    ${grab('rtSyncSizeSel')}
    function rtOnPaste(){}
    ${grab('rtBindEditor')}
    for (const n of ['A','B']) {
      const bar = document.getElementById('bar'+n), ed = document.getElementById('ed'+n);
      bar.innerHTML = rtToolbarHtml();
      ed.innerHTML = '<div>가나다라</div>';
      rtBindEditor(ed, { toolbar: bar.querySelector('.rt-toolbar') });
    }
    window.pick = (n) => {                       // 그 편집기의 글자를 통째로 고른다
      const ed = document.getElementById('ed'+n);
      const r = document.createRange(); r.selectNodeContents(ed);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    };
    window.look = (n) => {
      const ed = document.getElementById('ed'+n);
      const sp = ed.querySelector('span,b,strong');
      const w = sp ? getComputedStyle(sp).fontWeight : '';
      return { html: ed.innerHTML,
               color: sp ? getComputedStyle(sp).color : '',
               size:  sp ? getComputedStyle(sp).fontSize : '',
               bold:  Number(w) >= 600 || w === 'bold' };
    };
    <\/script>`);

  // A 편집기에서 '굵게'
  await pg2.evaluate(() => window.pick('A'));
  await pg2.click('#barA .rt-tool[data-cmd="bold"]');
  let A = await pg2.evaluate(() => window.look('A'));
  let B = await pg2.evaluate(() => window.look('B'));
  check('A 의 굵게 단추가 A 에 걸린다', A.bold, A.html);
  check('B 는 그대로다', !B.bold, B.html);

  // B 편집기에서 색
  await pg2.evaluate(() => window.pick('B'));
  await pg2.click('#barB .rt-tool-swatch[data-color="#dc2626"]');
  A = await pg2.evaluate(() => window.look('A'));
  B = await pg2.evaluate(() => window.look('B'));
  check('B 의 색 단추가 B 에 걸린다', B.color === 'rgb(220, 38, 38)', B);
  check('A 색은 안 변했다', A.color !== 'rgb(220, 38, 38)', A);

  // B 편집기에서 크기 — 목록을 실제로 고른다
  const SIZES = await pg2.evaluate(() => RT_SIZES);
  await pg2.evaluate(() => window.pick('B'));
  await pg2.selectOption('#barB .rt-size-sel', SIZES[3][1]);
  B = await pg2.evaluate(() => window.look('B'));
  A = await pg2.evaluate(() => window.look('A'));
  check('B 의 크기 목록이 B 에 걸린다', B.size === SIZES[3][1], B);
  check('A 크기는 안 변했다', A.size !== SIZES[3][1], A);

  // 다시 A 에서 작게 — 두 번째로 걸어도 서로 안 섞이는지
  await pg2.evaluate(() => window.pick('A'));
  await pg2.selectOption('#barA .rt-size-sel', SIZES[0][1]);
  A = await pg2.evaluate(() => window.look('A'));
  B = await pg2.evaluate(() => window.look('B'));
  check('A 는 작게가 걸린다', A.size === SIZES[0][1], A);
  check('B 는 아주 크게 그대로', B.size === SIZES[3][1], B);

  await pg2.close();
}

await browser.close();

console.log('\n■ 청소 기준 (내가 쓰는 그림 목록)');
{
  // mytaskAllKeys 는 Firestore 없이도 도는 순수 계산이라 여기서 바로 돌린다.
  // 키 모양도 원본 것을 그대로 꺼내 쓴다 — 여기 베껴 적으면 원본이 바뀌어도 통과한다.
  const RT_KEY_RE = new Function(`${grabConst('RT_SEG')}\n${grabConst('RT_KEY_RE')}\nreturn RT_KEY_RE;`)();
  const fn = grab('mytaskAllKeys');
  const mk = (opts) => {
    const ctx = {
      fbAuth: { currentUser: opts.user === null ? null : { uid: 'u-kim' } },
      isViewAs: () => !!opts.viewAs,
      mytaskLoadedOnce: opts.loaded !== false,
      mytaskTasks: opts.tasks || [],
      RT_KEY_RE,
    };
    const f = new Function('fbAuth','isViewAs','mytaskLoadedOnce','mytaskTasks','RT_KEY_RE',
      `${fn}; return mytaskAllKeys;`);
    return f(ctx.fbAuth, ctx.isViewAs, ctx.mytaskLoadedOnce, ctx.mytaskTasks, ctx.RT_KEY_RE);
  };
  const MINE   = 'tasks/test/u-kim/t1/a.jpg';
  const THEIRS = 'tasks/test/u-lee/t9/b.jpg';
  const tasks = [
    { id:'t1', ownerUid:'u-kim', memoKeys:[MINE] },
    { id:'t9', ownerUid:'u-lee', memoKeys:[THEIRS] },   // 공유받은 일정
  ];

  check('내 일정의 그림만 담는다',
        JSON.stringify(mk({ tasks })()) === JSON.stringify([MINE]), mk({ tasks })());
  check('공유받은 일정의 그림은 안 담는다', !mk({ tasks })().includes(THEIRS));
  check('방금 저장한 키를 얹을 수 있다',
        mk({ tasks })(['tasks/test/u-kim/t2/c.jpg']).length === 2);
  check('이상한 키는 안 담는다', mk({ tasks })(['../../x']).length === 1);

  // 여기가 핵심이다 — 기준을 못 믿으면 목록이 아니라 null 을 준다.
  // 빈 목록([])을 주면 '아무것도 안 쓴다'로 읽혀 내 그림이 전부 지워진다.
  check('목록이 아직 안 왔으면 null (빈 목록이 아니다)',
        mk({ tasks, loaded:false })() === null);
  check('보기 모드면 null', mk({ tasks, viewAs:true })() === null);
  check('로그인 전이면 null', mk({ tasks, user:null })() === null);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
