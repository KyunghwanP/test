// 학교 PC → 워커 → Firestore 를 처음부터 끝까지.
//
// 가짜 리로스쿨(세션 쿠키·로그인 양식·학년도 주소를 실제처럼 확인)과 진짜 워커 코드(riro-ingest.js,
// Firestore 만 가짜)를 이 컴퓨터에 띄우고, riro/riro-push.ps1 을 실제 PowerShell 프로세스로 돌린다.
// 마지막에 Firestore 에 들어간 학년별 문서를 풀어서, 같은 페이지를 예전 스크래퍼(크로미움 +
// scrape-riro.js 의 원래 코드)가 읽은 것과 학생 한 명·상세 한 줄까지 맞춰 본다.
//
// 필요: playwright, PowerShell 7 (pwsh). PWSH=/경로/pwsh. 없으면 건너뛴다.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import worker from '../workers/riro-ingest.js';

const ROOT = import.meta.dirname + '/..';
const PS1 = path.join(ROOT, 'riro/riro-push.ps1');
const PWSH = process.env.PWSH || 'pwsh';
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : ''));
if (spawnSync(PWSH, ['-NoLogo', '-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status !== 0) {
  console.log(`\n⚠️  PowerShell(${PWSH}) 이 없어 건너뜁니다. PWSH=/경로/pwsh 로 지정하세요.`);
  process.exit(0);
}

// ── 시험용 상벌점 페이지 (학생 400명) ──────────────────────────────────────────
const NAMES = [];
function page(n = 400, withRecords = true) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const g = 1 + (i % 3), r = 1 + (i % 10), num = 1 + Math.floor(i / 30);
    const nm = `학생${String(i).padStart(3, '0')}이름`;
    NAMES.push(nm);
    let rs = '';
    if (withRecords) for (let k = 0; k < (i % 6); k++) rs += `<span class="label label-record">[ 0${3 + (k % 7)}.1${k} ]</span><span class="txt">벌점 -1 &nbsp;지각 &lt;담임&gt; 비밀교사${k}</span><br>\n`;
    rows.push(`<tr align="center"><td>${i + 1}</td><td>${g}${String(r).padStart(2, '0')}${String(num).padStart(2, '0')}</td><td>${nm}</td>` +
      `<td>${(i % 7) - 3}</td><td>${i % 5}</td><td>-${i % 4}</td><td>${i % 2}</td><td><div class="record-p">${rs}</div></td></tr>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>리로스쿨</title></head><body><a href="/logout.php">로그아웃</a>
    <table class="table mypage_record_pc"><tbody>${rows.join('\n')}</tbody></table></body></html>`;
}
const NORMAL = page(400), FEW = page(10), NOREC = page(400, false);
const LOGIN_PAGE = '<html><head><title>로그인</title></head><body><form action="/user.php?action=signin"><input name="id"></form></body></html>';
const GEO_PAGE = '<html><head><title>에러페이지</title></head><body>해외에서는 접속할 수 없습니다.</body></html>';

// ── 가짜 리로스쿨 ───────────────────────────────────────────────────────────────
const ID = 'riro_teacher', PW = 'p@ss "w0rd&=한';
const now = new Date();
const YY = now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1;
let MODE = 'normal';          // normal | geo | few | norecords
const SESS = new Map();
let LOGINS = [], RECORD_HITS = [];
const riro = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const sid = (/PHPSESSID=([a-z0-9]+)/.exec(req.headers.cookie || '') || [])[1];
  const send = (body, headers = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(body); };
  if (MODE === 'geo') return send(GEO_PAGE, { Server: 'AmazonS3', 'X-Cache': 'Error from cloudfront' });
  if (req.method === 'GET' && u.pathname === '/user.php' && u.searchParams.get('action') === 'signin') {
    const id = Math.random().toString(36).slice(2);
    SESS.set(id, { loggedIn: false });
    return send(LOGIN_PAGE, { 'Set-Cookie': `PHPSESSID=${id}; path=/` });
  }
  if (req.method === 'POST' && u.pathname === '/ajax.php') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(b));
      LOGINS.push({ f, sid, ct: req.headers['content-type'] });
      const ok = sid && SESS.has(sid) && f.app === 'user' && f.mode === 'login' && f.userType === '1' && f.id === ID && f.pw === PW;
      if (ok) SESS.get(sid).loggedIn = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { code: '000', msg: '비밀교사장 선생님 환영합니다' } : { code: '901', msg: '아이디 또는 비밀번호가 다릅니다' }));
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/') return send('<html><body>메인</body></html>');
  if (req.method === 'GET' && u.pathname === '/my_page.php') {
    RECORD_HITS.push(u.search);
    const q = u.searchParams;
    const right = q.get('club') === 'index' && q.get('action') === 'record' && q.get('Appwin') === 'reload' && q.get('Class') === '*45' && q.get('yy') === String(YY);
    if (!sid || !SESS.get(sid)?.loggedIn || !right) return send(LOGIN_PAGE);
    return send(MODE === 'few' ? FEW : MODE === 'norecords' ? NOREC : NORMAL);
  }
  res.writeHead(404); res.end('no');
});

// ── 진짜 워커 코드 + 가짜 Firestore ────────────────────────────────────────────
const kp = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pk = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
let pb = ''; for (const x of pk) pb += String.fromCharCode(x);
const KEY = 'riro-test-key-0123456789-abcdefghij';
const ENV = { RIRO_KEY: KEY, SA_JSON: JSON.stringify({ project_id: 'ynhs-test', client_email: 'sa@x.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(pb)}\n-----END PRIVATE KEY-----\n` }) };
let DB = {}, PATCHES = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/ynhs-test\/databases\/\(default\)\/documents\/(.+)$/.exec(url);
  if (m && init.method === 'PATCH') {
    const text = new TextDecoder().decode(init.body);
    PATCHES.push(m[1]);
    try { DB[m[1]] = JSON.parse(text); } catch (e) { return new Response('{"error":{"message":"Invalid JSON payload"}}', { status: 400 }); }
    return new Response('{}');
  }
  return realFetch(url, init);
};
const wk = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), ENV);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise(r => riro.listen(0, '127.0.0.1', r));
await new Promise(r => wk.listen(0, '127.0.0.1', r));
const RIRO = `http://127.0.0.1:${riro.address().port}`, WORKER = `http://127.0.0.1:${wk.address().port}`;

// ── PowerShell ──────────────────────────────────────────────────────────────────
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'riro-home-'));
const ps = (args) => new Promise(resolve => {
  const p = spawn(PWSH, ['-NoLogo', '-NoProfile', ...args], { env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' } });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ code, out }));
});
const saveSecret = (o) => {
  const f = path.join(HOME, 'save.ps1');
  fs.writeFileSync(f, `param([string]$S, [string]$H, [string]$J)\n. $S -LoadOnly\n$script:AppDir = $H\nSave-Secret ($J | ConvertFrom-Json)\n`);
  return ps(['-File', f, '-S', PS1, '-H', HOME, '-J', JSON.stringify(o)]);
};
const run = (...extra) => ps(['-File', PS1, '-HomeDir', HOME, '-RiroBase', RIRO, ...extra]);
const fsDecode = v => {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsDecode(x)]));
  throw new Error('모르는 값 ' + JSON.stringify(v));
};

// 예전 스크래퍼가 같은 페이지를 읽은 결과 (크로미움 + 원래 코드)
const SCRAPER = fs.readFileSync(path.join(ROOT, 'scripts/scrape-riro.js'), 'utf8');
const ORIGINAL = (() => {
  const s = SCRAPER.indexOf('() => {', SCRAPER.indexOf('page.evaluate(() => {'));
  let d = 0;
  for (let j = SCRAPER.indexOf('{', s); j < SCRAPER.length; j++) {
    if (SCRAPER[j] === '{') d++; else if (SCRAPER[j] === '}' && --d === 0) return SCRAPER.slice(s, j + 1);
  }
})();
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const bp = await br.newPage();
await bp.setContent(NORMAL);
const WANT = await bp.evaluate(`(${ORIGINAL})()`);
await br.close();
const wantBy = g => WANT.filter(s => s.grade === g);

try {
  await saveSecret({ id: ID, pw: PW, worker: WORKER, key: KEY });

  console.log('\n■ -Check — 받아서 해석만, 저장은 안 함');
  const c1 = await run('-Check');
  check('끝 코드 0', c1.code === 0, c1.out);
  check('학생 400명 · 학년별 수를 보여 준다', /학생 400 명 \(1학년 134 · 2학년 133 · 3학년 133\)/.test(c1.out), c1.out);
  check('워커 연결 정상', /워커 연결: 정상/.test(c1.out), c1.out);
  check('Firestore 에 아무것도 안 썼다', PATCHES.length === 0, PATCHES);
  check('로그인 양식이 예전 스크래퍼와 같다 (app·mode·userType·id·pw, 세션 쿠키 붙음)',
        LOGINS.length === 1 && LOGINS[0].f.id === ID && LOGINS[0].f.pw === PW && Object.keys(LOGINS[0].f).sort().join() === 'app,id,mode,pw,userType'
        && !!LOGINS[0].sid && /x-www-form-urlencoded/.test(LOGINS[0].ct), LOGINS);
  check(`상벌점 주소: 학년도 yy=${YY}`, RECORD_HITS.length === 1 && RECORD_HITS[0].includes(`yy=${YY}`) && RECORD_HITS[0].includes('Class=*45'), RECORD_HITS);

  console.log('\n■ 동기화 — 학년별 문서 셋 + meta');
  const r1 = await run();
  check('끝 코드 0', r1.code === 0, r1.out);
  check('grade1 · grade2 · grade3 · meta 순서로 저장', PATCHES.join() === 'riro_points/grade1,riro_points/grade2,riro_points/grade3,riro_points/meta', PATCHES);
  const got = g => fsDecode({ mapValue: DB[`riro_points/grade${g}`] });
  for (const g of [1, 2, 3]) {
    const d = got(g);
    const a = JSON.stringify(d.students), w = JSON.stringify(wantBy(g));
    let diff = '';
    if (a !== w) { const k = d.students.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(wantBy(g)[i])); diff = `#${k} 저장 ${JSON.stringify(d.students[k])}\n         원래 ${JSON.stringify(wantBy(g)[k])}`; }
    check(`${g}학년: 예전 스크래퍼가 읽은 것과 학생·상세가 한 글자도 안 다르다 (${wantBy(g).length}명)`, a === w, diff || undefined);
    check(`${g}학년: count = ${wantBy(g).length}`, d.count === wantBy(g).length, d.count);
  }
  const meta = fsDecode({ mapValue: DB['riro_points/meta'] });
  check('meta.total = 400', meta.total === 400, meta);
  const ts = [1, 2, 3].map(g => got(g).updatedAt);
  check('updatedAt 은 ISO(UTC) 이고 네 문서가 같다', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(meta.updatedAt) && ts.every(t => t === meta.updatedAt)
        && Math.abs(Date.parse(meta.updatedAt) - Date.now()) < 120000, { meta: meta.updatedAt, ts });
  check('앱이 읽는 모양 그대로 (students[].records[].date/detail)', Array.isArray(got(1).students[1].records) && 'detail' in got(1).students[1].records[0], got(1).students[1]);

  console.log('\n■ 기록(riro.log) — 공개되면 안 되는 것이 없다');
  const log = fs.readFileSync(path.join(HOME, 'riro.log'), 'utf8');
  check('동기화 끝이 남는다', /동기화 끝 — 학생 400 명/.test(log), log.slice(-300));
  check('학생 이름이 하나도 없다', !NAMES.some(n => log.includes(n)));
  check('상세 내용·교사 이름이 없다', !/비밀교사/.test(log));
  check('비밀번호·전송 암호가 없다', !log.includes(PW) && !log.includes(KEY));
  check('로그인 응답은 생김새만 (code=000, 환영 문장은 글자 수만 — 이름이 섞여 있다)', /로그인 요청: HTTP 200 .* JSON code=000, msg\(\d+자\)/.test(log) && !log.includes('비밀교사장'), log.split('\n').filter(l => l.includes('로그인 요청')));
  if (process.platform === 'win32') check('비밀번호는 파일에 날글자로 남지 않는다 (DPAPI)', !fs.readFileSync(path.join(HOME, 'secret.dat'), 'utf8').includes(PW));
  else console.log('  ⏭  비밀번호 잠금(DPAPI)은 Windows 에서만 볼 수 있어 건너뜀');

  console.log('\n■ 저장하면 안 되는 경우 — 아무것도 안 쓰고 실패');
  const writes = () => PATCHES.length;
  for (const [label, mode, re] of [
    ['해외 차단 페이지', 'geo', /해외 접속 차단/],
    ['학생이 너무 적게 읽힘 (10명)', 'few', /저장하지 않습니다 — 학생이 10 명만/],
    ['상세가 한 건도 안 읽힘 (화면이 바뀐 것)', 'norecords', /상세 내역이 한 건도/],
  ]) {
    MODE = mode;
    const before = writes();
    const r = await run();
    check(`${label} → 실패, 저장 0건`, r.code === 1 && re.test(r.out) && writes() === before, r.out.slice(-400));
  }
  MODE = 'normal';

  await saveSecret({ id: ID, pw: 'wrong-pw', worker: WORKER, key: KEY });
  let before = writes();
  let r = await run();
  check('비밀번호가 틀리면 → 로그인 안 됨으로 실패, 저장 0건', r.code === 1 && /로그인이 되지 않았습니다/.test(r.out) && writes() === before, r.out.slice(-400));

  await saveSecret({ id: ID, pw: PW, worker: WORKER, key: KEY.slice(0, -1) + 'X' });
  before = writes();
  r = await run('-Check');
  check('전송 암호가 틀리면 -Check 가 알려 준다', r.code === 1 && /전송 암호가 맞지 않습니다/.test(r.out), r.out.slice(-400));
  r = await run();
  check('전송 암호가 틀리면 동기화도 실패 (HTTP 401), 저장 0건', r.code === 1 && /grade1, HTTP 401/.test(r.out) && writes() === before, r.out.slice(-400));

  r = await ps(['-File', PS1, '-HomeDir', path.join(HOME, 'none'), '-RiroBase', RIRO]);
  check('설정 전이면 -Setup 하라고 알려 준다', r.code === 1 && /먼저 -Setup/.test(r.out), r.out.slice(-300));

  console.log('\n■ PowerShell 작은 부품');
  const unit = path.join(HOME, 'unit.ps1');
  fs.writeFileSync(unit, `param([string]$S)
. $S -LoadOnly
$out = [ordered]@{}
$kr = '<meta charset="euc-kr">김가나 벌점'
$out.eucKr = (ConvertFrom-HttpBytes ([Text.Encoding]::GetEncoding('euc-kr').GetBytes($kr)) @{}) -eq $kr
$out.hdrCharset = (ConvertFrom-HttpBytes ([Text.Encoding]::GetEncoding('euc-kr').GetBytes('김')) @{ 'Content-Type' = 'text/html; charset=EUC-KR' }) -eq '김'
$out.bom = (ConvertFrom-HttpBytes ([byte[]](0xEF,0xBB,0xBF,0x41)) @{}) -eq 'A'
$out.year = @((Get-SchoolYear ([datetime]'2027-02-28')), (Get-SchoolYear ([datetime]'2027-03-01')))
$out.json = ConvertTo-JsonText ('a"b\\c' + [char]10 + [char]9 + [char]1 + [char]0x2028 + '한')
$out.ints = @((ConvertTo-JsInt ' -12x'), (ConvertTo-JsInt '+7'), (ConvertTo-JsInt '0x1f'), (ConvertTo-JsInt 'x'), (ConvertTo-JsIntOr0 ''))
$out | ConvertTo-Json -Compress
`);
  const u = await ps(['-File', unit, '-S', PS1]);
  let uj = {};
  try { uj = JSON.parse(u.out.trim().split('\n').pop()); } catch (e) { }
  check('EUC-KR 페이지도 한글이 안 깨진다 (meta charset)', uj.eucKr === true, u.out);
  check('EUC-KR (머리글 charset)', uj.hdrCharset === true, uj);
  check('UTF-8 BOM 은 떼어 낸다', uj.bom === true, uj);
  check('학년도: 2월은 앞 해, 3월부터 그 해', JSON.stringify(uj.year) === '[2026,2027]', uj.year);
  check('JSON 글자 이스케이프가 JSON.parse 로 되돌아온다', (() => { try { return JSON.parse(uj.json) === 'a"b\\c\n\t\u0001\u2028한'; } catch { return false; } })(), uj.json);
  check('parseInt 흉내 (-12x → -12, +7, 0x1f → 31, x → NaN, "" → 0)', JSON.stringify(uj.ints) === '[-12,7,31,null,0]', uj.ints);
} finally {
  riro.close(); wk.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
