// 위젯이 설정을 실제로 저장할 수 있는지 — 원본을 읽어서 확인한다.
//
// 2026-08: config.ini 와 reset.flag 가 있는 A_AppData\YnhsWidget 폴더를 아무도
// 만들지 않았다. IniWrite 는 파일은 만들어도 폴더는 만들지 않고, 호출부가 전부
// try 로 감싸여 있어 실패가 조용히 묻혔다. 결과는 '켤 때마다 선택창' +
// '위치가 전혀 저장되지 않음'. 웹뷰가 전용 세션으로 물러난 사람만 폴더가 생겨
// 되고 안 되고가 갈렸다. Windows 가 없어 실행은 못 하므로 원본으로 못 박아 둔다.
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const ahk  = fs.readFileSync(path.join(here, '..', 'widget', 'ynhs-widget.ahk'), 'utf8');
const app  = fs.readFileSync(path.join(here, '..', 'app', 'ynhs-app.ahk'), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// 파일에 쓰는 A_AppData 하위 폴더를 모은다
const dirsWritten = src => {
  const out = new Set();
  for (const m of src.matchAll(/A_AppData\s+"\\([A-Za-z0-9_]+)/g)) out.add(m[1]);
  return out;
};
const dirsCreated = src => {
  const out = new Set();
  for (const m of src.matchAll(/DirCreate\(\s*A_AppData\s+"\\([A-Za-z0-9_]+)/g)) out.add(m[1]);
  // DirCreate(SESSION) 처럼 변수를 넘기는 경우 — 그 변수의 정의를 따라간다
  for (const m of src.matchAll(/DirCreate\(\s*([A-Za-z_][\w]*)\s*\)/g)) {
    const def = new RegExp(`^(?:global\\s+)?${m[1]}\\s*:?=\\s*A_AppData\\s+"\\\\([A-Za-z0-9_]+)`, 'm').exec(src);
    if (def) out.add(def[1]);
  }
  return out;
};

console.log('\n■ 위젯 — 쓰는 폴더를 모두 만드는가');
{
  const written = dirsWritten(ahk), created = dirsCreated(ahk);
  const missing = [...written].filter(d => !created.has(d));
  check(`쓰는 폴더 ${[...written].join(', ')} 를 전부 만든다`, missing.length === 0, missing);
  check('YnhsWidget 을 만든다', created.has('YnhsWidget'), [...created]);
}

console.log('\n■ 만드는 시점이 쓰는 시점보다 앞인가');
{
  const at = ahk.indexOf('DirCreate(A_AppData "\\YnhsWidget")');
  check('DirCreate 가 존재한다', at >= 0);

  // 최상위(들여쓰기 없는) RestoreSelected() 호출 — 여기서부터 위젯이 만들어진다
  const call = /^RestoreSelected\(\)\s*$/m.exec(ahk);
  check('RestoreSelected() 호출을 찾았다', !!call);
  check('RestoreSelected() 보다 앞이다', at >= 0 && call && at < call.index, { at, call: call?.index });

  // 설정을 처음 읽는 곳(다크/글래스)보다도 앞이어야 한다
  const firstRead = ahk.search(/IniRead\(CONFIG/);
  check('첫 IniRead(CONFIG) 보다 앞이다', at >= 0 && firstRead >= 0 && at < firstRead, { at, firstRead });
}

console.log('\n■ 실패하면 알려 주는가');
{
  check('만들지 못하면 안내한다',
        /if !DirExist\(A_AppData "\\YnhsWidget"\)\s*\n\s*MsgBox\(/.test(ahk));
}

console.log('\n■ 통합앱은 같은 문제가 없는가');
{
  const written = dirsWritten(app), created = dirsCreated(app);
  const missing = [...written].filter(d => !created.has(d));
  check(`쓰는 폴더 ${[...written].join(', ')} 를 전부 만든다`, missing.length === 0, missing);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
