// 인라인 onclick 이 부르는 함수가 전부 window 에 있는지.
//
// index.html 의 스크립트는 <script type="module"> 이라 최상위 이름이 전역이 아니다.
// 그래서 onclick="foo()" 는 window.foo 가 따로 있어야만 동작한다. 없으면 눌러도
// 아무 일도 안 일어나고 콘솔에만 ReferenceError 가 뜬다 — 화면상 '먹통'이라
// 알아채기 어렵다(2026-08 상담 필터 버튼이 이랬다).
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const modAt = html.indexOf('<script type="module">');
if (modAt < 0) throw new Error('module 스크립트를 못 찾음');
const beforeModule = html.slice(0, modAt);   // 모듈 밖(일반 script)에 선언된 것은 이미 전역이다

const EVENTS = ['click','change','input','submit','keydown','keyup','keypress',
                'dragstart','dragend','dragover','drop','dragleave','load','error','contextmenu','focus','blur'];
const re = new RegExp(`\\bon(?:${EVENTS.join('|')})="([^"]*)"`, 'g');

// 호출된 이름을 모은다. 앞에 점이 있으면 메서드 호출이므로 뺀다(event.stopPropagation 등).
const called = new Map();          // 이름 → 처음 본 핸들러 원문
for (const m of html.matchAll(re)) {
  for (const c of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!called.has(c[2])) called.set(c[2], m[0].slice(0, 90));
  }
}

const KEYWORDS = new Set(['if','for','while','switch','catch','return','function','typeof','new','delete','void','do','else']);
const GLOBALS  = new Set(['Number','String','Boolean','Array','Object','JSON','Math','Date','RegExp','Promise',
                          'parseInt','parseFloat','isNaN','alert','confirm','prompt','setTimeout','setInterval',
                          'encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','fetch']);

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

const missing = [];
for (const [name, where] of called) {
  if (KEYWORDS.has(name) || GLOBALS.has(name)) continue;
  const onWindow = new RegExp(`window\\.${name}\\s*=`).test(html);
  const outsideModule = new RegExp(`^\\s*(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').test(beforeModule);
  if (!onWindow && !outsideModule) missing.push({ name, where });
}

console.log(`\n■ 인라인 핸들러가 부르는 함수 ${called.size}개`);
check('전부 window 에서 찾을 수 있다', missing.length === 0, missing);

if (missing.length) {
  console.log('\n  아래는 눌러도 아무 일이 안 일어난다. window 에 붙여야 한다:');
  for (const m of missing) console.log(`    · ${m.name}()   ← ${m.where}`);
}

// 이번에 새로 붙인 것들은 이름으로도 한 번 더 못 박아 둔다
console.log('\n■ 상담 관련 함수');
for (const f of ['toggleCalFilter','togglePanelConsult','openConsultPeek','closeConsultPeek'])
  check(`window.${f}`, new RegExp(`window\\.${f}\\s*=`).test(html));

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
