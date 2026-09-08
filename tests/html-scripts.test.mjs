// HTML 안의 <script> 가 브라우저가 읽는 대로 온전한가.
//
// 실제로 겪은 일: 자바스크립트 주석에 예시로 </script> 를 적었더니 그 자리에서
// 스크립트가 끊겼다. 그 아래 12,000줄이 전부 HTML 로 읽혔고, 로그인부터 먹통이
// 됐다. HTML 파서는 주석도 문자열도 모른다 — script 안에서는 </script> 글자가
// 나오는 순간 무조건 끝이다.
//
// node --check 로는 절대 못 잡는다. 잘려 나간 앞부분만 보면 문법이 멀쩡하다.
// 그래서 여기서는 '브라우저와 같은 방식으로' 자른 뒤에 검사한다.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DIR = import.meta.dirname + '/..';
const FILES = fs.readdirSync(DIR).filter(f => f.endsWith('.html')).sort();

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

// 브라우저와 같은 방식으로 자른다 — 여는 태그 다음의 '첫' </script> 가 끝이다.
function splitScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;             // 바깥 파일은 본문이 없다
    const start = m.index + m[0].length;
    const end = html.toLowerCase().indexOf('</script>', start);
    out.push({
      attrs, start, end: end < 0 ? html.length : end,
      body: end < 0 ? html.slice(start) : html.slice(start, end),
      closed: end >= 0,
      line: html.slice(0, m.index).split('\n').length,
      module: /type\s*=\s*["']module["']/i.test(attrs),
    });
    re.lastIndex = end < 0 ? html.length : end + 9;
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ynhs-scripts-'));

console.log('\n■ 스크립트가 중간에 끊기지 않는가');
for (const f of FILES) {
  const html = fs.readFileSync(DIR + '/' + f, 'utf8');
  const scripts = splitScripts(html);
  if (!scripts.length) continue;

  const bad = [];
  for (const [i, s] of scripts.entries()) {
    if (!s.closed) { bad.push(`${s.line}줄: 닫는 태그가 없다`); continue; }
    const file = path.join(tmp, `${f}.${i}.${s.module ? 'mjs' : 'cjs'}`);
    fs.writeFileSync(file, s.body);
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch (e) {
      bad.push(`${s.line}줄: ${String(e.stderr || e).split('\n').find(l => /Error|Unexpected/.test(l)) || '문법 오류'}`);
    }
  }
  check(`${f} — 스크립트 ${scripts.length}개가 온전하다`, bad.length === 0, bad);
}

console.log('\n■ 코드가 화면으로 새어 나오지 않는가');
{
  // 끊기면 그 아래 코드가 HTML 로 읽혀, 브라우저가 없는 파일을 받으러 가거나
  // 코드가 글자로 보인다. 눈에 띄는 자국 몇 가지를 본다.
  for (const f of FILES) {
    const html = fs.readFileSync(DIR + '/' + f, 'utf8');
    const scripts = splitScripts(html);
    // 스크립트 본문을 잘라낸 나머지 = 브라우저가 마크업으로 읽는 부분.
    // 문자열 치환으로 지우면 안 된다 — 흘러나온 코드에 <script 글자가 또 있으면
    // 그것까지 '본문'으로 세어 증거를 스스로 지워 버린다.
    let markup = '', at = 0;
    for (const s of scripts) { markup += html.slice(at, s.start); at = s.end; }
    markup += html.slice(at);
    const marks = [];
    // 마크업에 템플릿 자리표시자(${...})가 src·href 로 남아 있으면 흘러나온 것이다
    for (const m of markup.matchAll(/(?:src|href)\s*=\s*["'][^"']*\$\{[^"']*["']/g)) marks.push(m[0].slice(0, 80));
    check(`${f} — 마크업에 코드 조각이 없다`, marks.length === 0, marks);
  }
}

console.log('\n■ 끊긴 파일을 실제로 잡아내는가 (검사 자체의 확인)');
{
  const broken = `<script type="module">\nconst a = 1;\n// 예시: </script> 라고 적으면\nconst b = 2;\nfunction c(){ return ${'`'}<img src="\${a}">${'`'}; }\n</script>`;
  const s = splitScripts(broken);
  check('끊긴 자리에서 잘린다', s.length === 1 && !s[0].body.includes('const b = 2'), s[0]?.body);
  let markup = broken;
  for (const x of s) markup = markup.replace(x.body, '');
  check('나머지에서 코드 조각이 보인다', /src\s*=\s*"[^"]*\$\{/.test(markup), markup.slice(0, 120));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
