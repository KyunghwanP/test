// overtime-api.src.js 에 gas/overtime/Code.gs 를 끼워 workers/overtime-api.js 를 만든다.
//
//   node workers/build-overtime.mjs
//
// 처리 규칙은 Code.gs 하나에만 둔다. Code.gs 를 고치면 이걸 다시 돌리고, 나온
// overtime-api.js 를 Cloudflare 대시보드에 붙여 넣는다. 검사(overtime-worker.test.mjs)가
// 배포본이 지금 Code.gs 로 만든 것과 같은지 본다 — 빌드를 잊으면 깨진다.
import fs from 'node:fs';

export function buildOvertime() {
  const src = fs.readFileSync(new URL('./overtime-api.src.js', import.meta.url), 'utf8');
  const gs = fs.readFileSync(new URL('../gas/overtime/Code.gs', import.meta.url), 'utf8');
  const MARK = '/* @@CODE_GS@@ */';
  if (src.split(MARK).length !== 2) throw new Error('끼울 자리가 한 군데여야 합니다');
  const inner = `// ── 아래부터 gas/overtime/Code.gs 그대로 (고치려면 그 파일을 고치고 다시 빌드) ──
function createOvertime(__g) {
  const { SpreadsheetApp, PropertiesService, CacheService, LockService, MailApp, Session,
          ScriptApp, ContentService, Utilities, UrlFetchApp } = __g || {};
${gs}
  if (__g && __g.now) now_ = __g.now;
  return { handle_, tick, ACTIONS, OT_VERSION, SH };
}
// ── Code.gs 끝 ──
const { ACTIONS, OT_VERSION, SH } = createOvertime(null);`;
  return '// 자동 생성 — 직접 고치지 말 것. 원본: workers/overtime-api.src.js + gas/overtime/Code.gs\n'
       + '// 만들기: node workers/build-overtime.mjs\n' + src.replace(MARK, () => inner);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.writeFileSync(new URL('./overtime-api.js', import.meta.url), buildOvertime());
  console.log('workers/overtime-api.js 를 만들었습니다');
}
