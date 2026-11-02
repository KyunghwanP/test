// 앱이 부르는 Apps Script(gas/Code.gs)를 구글 없이 돌려 본다 — 2026-11 보안 정리.
//
// 이 웹 앱은 「실행: 나 · 액세스: 모든 사용자」로 배포돼 있어(GitHub 작업이 로그인 없이 부른다) 주소를 아는
// 누구나 부를 수 있다. 2026-11 확인 때 활성 배포가 20개였고, 그중 상당수의 주소가 공개 저장소 이력에 남아 있었다.
// 그래서 여기서는 「막아야 할 요청이 실제로 아무것도 하지 않고 돌아가는지」를 본다:
//  · 상벌점 저장 — 교사 로그인 토큰을 구글에 물어 확인. 예전 화면(토큰 없음)은 TOKEN_REQUIRED_FROM 전날까지만
//  · AI 요약 갱신 — 교사 토큰 + 10분 간격 · 하루 8번
//  · 학부모 상담 — 워커로 옮겨 MOVED(시트·Firestore·외부 요청 없음)
//  · 주간교육활동 가져오기 — 학교 구글 사이트 주소만, 넘겨주기도 같은 검사
// 시트·로그인 확인(Identity Toolkit)·외부 주소·잠금·캐시·속성·시계를 흉내 낸다. 이름은 지어낸 것이다.
//
// 실행: node tests/gas-main.test.mjs   (설치 필요 없음)
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const CODE = fs.readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const SITE = 'https://sites.google.com/yeungnam.hs.kr/202633';
const WEEK = SITE + '/2026%EB%85%84-11%EC%9B%94-2%EC%9D%BC-%EC%9B%94';   // 2026년-11월-2일-월(인코딩된 주차 주소)
const PAGE = '<html><body><a href="' + WEEK + '">주차</a><div role="heading" aria-level="1">주간 교육활동</div>'
  + '<p>11월 2일(월) 2학년 진로 체험</p>' + 'x'.repeat(300) + '<p>Report abuse</p></body></html>';

// 로그인 토큰 — 검사가 정한 사람표에서 찾는다(실제 구글은 서명·만료를 본다)
const PEOPLE = {
  'tok-teacher-0000000000000': { email: 'kim@yeungnam.hs.kr' },
  'tok-student-0000000000000': { email: '2010203@yeungnam.hs.kr' },
  'tok-gmail-000000000000000': { email: 'kim@gmail.com' },
  'tok-unverified-0000000000': { email: 'lee@yeungnam.hs.kr', emailVerified: false },
  'tok-disabled-000000000000': { email: 'park@yeungnam.hs.kr', disabled: true },
};
const TEACHER = 'tok-teacher-0000000000000';

function makeGas({ now = '2026-11-02T09:00:00+09:00', pages = {} } = {}) {
  let clock = Date.parse(now);
  const calls = { fetch: [], writes: [], github: [], lookups: 0, sleeps: 0 };
  const props = new Map([['GITHUB_TOKEN', 'gh-test-token']]);
  const cache = new Map();
  const resp = (code, body = '', headers = {}) => ({ getResponseCode: () => code, getContentText: () => body, getHeaders: () => headers });
  const UrlFetchApp = {
    fetch(url, opt = {}) {
      calls.fetch.push({ url, opt });
      if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=')) {
        calls.lookups++;
        const p = PEOPLE[JSON.parse(opt.payload).idToken];
        if (!p) return resp(400, '{"error":{"message":"INVALID_ID_TOKEN"}}');
        return resp(200, JSON.stringify({ users: [{ email: p.email, emailVerified: p.emailVerified !== false, disabled: !!p.disabled }] }));
      }
      if (url.startsWith('https://api.github.com/')) { calls.github.push(url); return resp(204); }
      const pg = pages[url];
      return pg ? resp(pg.code || 200, pg.body || '', pg.headers || {}) : resp(404, 'not found');
    },
  };
  // 상벌점 원본 시트 — 학년별 탭(탭 id 로 찾는다) · 학사일정 시트(달 탭 없음)
  const sheetOf = id => ({
    getSheetId: () => id,
    getName: () => 'tab-' + id,
    getRange: (r, c, nr, nc) => ({
      getValues: () => Array.from({ length: nr }, () => Array(nc).fill('')),
      setValues: v => { calls.writes.push({ tab: id, r, c, v }); },
    }),
  });
  const SpreadsheetApp = {
    openById: id => ({ getSheets: () => id.startsWith('1fJpT') ? [264713345, 1961222608, 1732544816].map(sheetOf) : [] }),
  };
  const ContentService = {
    MimeType: { JSON: 'json', TEXT: 'text' },
    createTextOutput: s => ({ s, mime: null, setMimeType(m) { this.mime = m; return this; } }),
  };
  const Utilities = {
    // 한국 날짜만 쓴다
    formatDate: (d, tz, fmt) => { if (tz !== 'Asia/Seoul' || fmt !== 'yyyy-MM-dd') throw new Error('formatDate ' + tz + ' ' + fmt);
      return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); },
    sleep: ms => { calls.sleeps++; clock += ms; },
    computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s), 'utf8').digest()],
    base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64url'),
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
  };
  const CacheService = { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v); } }) };
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: k => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)),
    setProperties: o => { for (const [k, v] of Object.entries(o)) props.set(k, String(v)); } }) };
  let locked = false;
  const LockService = { getScriptLock: () => ({ tryLock: () => (locked ? false : (locked = true)), releaseLock: () => { locked = false; } }) };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock])); }
    static now() { return clock; }
  }
  const ctx = vm.createContext({ UrlFetchApp, SpreadsheetApp, ContentService, Utilities, CacheService, PropertiesService, LockService,
    Date: FakeDate, JSON, Math, Number, String, Object, Array, RegExp, Error, decodeURIComponent, encodeURIComponent, parseInt, isNaN });
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });
  const wrap = out => ({ text: out.s, mime: out.mime, json: out.mime === 'json' ? JSON.parse(out.s) : null });
  const get = params => wrap(ctx.doGet({ parameter: params }));
  // 새 앱은 본문(폼)으로 보낸다 — Apps Script 는 폼 칸을 e.parameter 로 준다
  const post = params => wrap(ctx.doPost({ parameter: params, postData: { type: 'application/x-www-form-urlencoded', contents: new URLSearchParams(params).toString() } }));
  return { get, post, calls, props, cache, tick: ms => { clock += ms; }, setNow: iso => { clock = Date.parse(iso); }, lockIt: v => { locked = v; } };
}
const POINT = { action: 'savePoints', grade: '2', classNum: '3', studentNum: '7', name: '한별', type: '상점', detail: '봉사', date: '2026-11-02', score: '1', teacher: '김선생' };

console.log('\n[상벌점 저장 — 교사 로그인 확인]');
{
  const G = makeGas();
  const r = G.get({ ...POINT, idToken: TEACHER });
  check('교사 토큰 — 구글에 물어 확인하고 저장한다', r.json.success === true && G.calls.writes.length === 1 && G.calls.lookups === 1, r.json);
  G.get({ ...POINT, idToken: TEACHER });
  check('— 같은 토큰은 5분 동안 다시 묻지 않는다(캐시)', G.calls.lookups === 1 && G.calls.writes.length === 2);
  check('— 캐시에는 토큰이 아니라 지문만 남는다', [...G.cache.keys()].every(k => !k.includes(TEACHER)), [...G.cache.keys()]);
}
for (const [label, tok] of [['틀린 토큰', 'tok-forged-00000000000000'], ['학생 계정(숫자 7자리)', 'tok-student-0000000000000'],
  ['학교 밖 계정(gmail)', 'tok-gmail-000000000000000'], ['메일 미확인 계정', 'tok-unverified-0000000000'], ['사용 중지 계정', 'tok-disabled-000000000000'],
  ['너무 짧은 값', 'abc']]) {
  const G = makeGas();
  const r = G.get({ ...POINT, idToken: tok });
  check(`${label} — 거절, 시트에 아무것도 안 씀, 화면에 보일 말이 error 에`, r.json.success === false && r.json.code === 'AUTH'
    && r.json.error.includes('로그인을 확인하지 못했습니다') && G.calls.writes.length === 0, r.json);
}
{
  const G = makeGas({ now: '2026-11-15T23:59:00+09:00' });
  const r = G.get({ ...POINT });
  check('예전 화면(토큰 없음) — 11/15 23:59(한국)까지는 받아 준다', r.json.success === true && G.calls.writes.length === 1, r.json);
  G.setNow('2026-11-16T00:00:00+09:00');
  const r2 = G.get({ ...POINT });
  check('— 11/16 0시부터는 거절하고 「앱을 새로 고친 뒤 다시 저장」(예전 화면이 그대로 보여 주는 칸)', r2.json.success === false
    && r2.json.error.includes('앱을 새로 고친 뒤 다시 저장해 주세요') && G.calls.writes.length === 1, r2.json);
  const r3 = G.get({ ...POINT, idToken: TEACHER });
  check('— 새 앱(교사 토큰)은 그날 이후에도 저장된다', r3.json.success === true && G.calls.writes.length === 2, r3.json);
}

{
  // 새 앱 — 로그인 확인값이 주소에 남지 않게 본문(POST)으로
  const G = makeGas();
  const r = G.post({ ...POINT, idToken: TEACHER });
  check('본문(POST)으로 보내도 같은 검사를 거쳐 저장된다', r.json.success === true && G.calls.writes.length === 1 && G.calls.lookups === 1, r.json);
  const r2 = G.post({ ...POINT, idToken: 'tok-student-0000000000000' });
  check('— 본문으로 와도 학생 토큰은 거절', r2.json.success === false && G.calls.writes.length === 1, r2.json);
  const r3 = G.post({ action: 'bookSlot', token: 'teacher' });
  check('— 본문으로 와도 상담은 MOVED', !!r3.json && r3.json.error === 'MOVED');
}

console.log('\n[AI 요약 갱신 — 교사 로그인 + 10분 간격 · 하루 8번]');
{
  const G = makeGas();
  const a = G.get({ action: 'triggerWeeklySummary' });
  check('토큰 없이 — 거절, GitHub 작업을 하나도 안 부른다', a.json.success === false && a.json.error === 'AUTH' && G.calls.github.length === 0, a.json);
  const b = G.get({ action: 'triggerWeeklySummary', idToken: 'tok-student-0000000000000' });
  check('학생 토큰 — 거절', b.json.error === 'AUTH' && G.calls.github.length === 0, b.json);
  const c = G.get({ action: 'triggerWeeklySummary', idToken: TEACHER });
  check('교사 토큰 — 스크래핑·요약 작업 둘을 부른다', c.json.success === true && G.calls.github.length === 2
    && G.calls.github[0].endsWith('/scrape.yml/dispatches') && G.calls.github[1].endsWith('/Summarize.yml/dispatches'), c.json);
  G.tick(5 * 60e3);
  const d = G.get({ action: 'triggerWeeklySummary', idToken: TEACHER });
  check('10분 안에 또 — 거절(「…분 뒤에 다시」), 작업을 안 부른다', d.json.error === 'TOO_SOON' && /분 뒤에 다시/.test(d.json.message) && G.calls.github.length === 2, d.json);
  let ok = 1;
  for (let i = 0; i < 12; i++) { G.tick(11 * 60e3); if (G.get({ action: 'triggerWeeklySummary', idToken: TEACHER }).json.success) ok++; }
  check('하루 8번까지만 — 9번째부터 「오늘은 더 갱신할 수 없습니다」', ok === 8 && G.calls.github.length === 16, { ok, gh: G.calls.github.length });
  G.setNow('2026-11-03T09:00:00+09:00');
  check('— 다음 날이면 다시 된다', G.get({ action: 'triggerWeeklySummary', idToken: TEACHER }).json.success === true);
  G.lockIt(true);
  G.tick(11 * 60e3);
  const e = G.get({ action: 'triggerWeeklySummary', idToken: TEACHER });
  check('동시에 들어온 요청(잠금 못 얻음) — 거절, 작업을 안 부른다', e.json.error === 'BUSY' && G.calls.github.length === 18, e.json);
}

console.log('\n[학부모 상담 — 워커로 옮김]');
for (const action of ['verifyParent', 'getOpenSlots', 'bookSlot', 'getMyBooking', 'cancelBooking']) {
  const G = makeGas();
  const r = G.get({ action, token: 'teacher', classKey: '1-3', grade: '1', room: '3', name: '한별', birth: '2010-01-01', slotId: 's1' });
  check(`${action} — 「MOVED」 만 돌려주고 외부 요청·시트 쓰기 없음(token=teacher 로 교사 예약을 취소하던 길도 닫힘)`,
    !!r.json && r.json.success === false && r.json.error === 'MOVED' && G.calls.fetch.length === 0 && G.calls.writes.length === 0, r.json || r.text.slice(0, 80));
}
check('상담 코드(서비스 계정으로 Firestore 에 쓰던 것)가 스크립트에 남아 있지 않다',
  !/FIREBASE_SA_JSON'\)|_writeSlots|_cfsToken|function cancelBooking_/.test(CODE));

console.log('\n[주간교육활동 가져오기 — 학교 구글 사이트만]');
{
  const G = makeGas({ pages: { [SITE]: { body: PAGE } } });
  const r = G.get({});
  check('주소가 없으면 학교 사이트 첫 화면을 가져와 주차 목록·본문으로 나눠 준다', r.text.startsWith('===NAV===\n' + WEEK + '\n===CONTENT===')
    && r.text.includes('11월 2일(월)') && r.text.length >= 200, r.text.slice(0, 160));
  check('— 넘겨주기를 저절로 따라가지 않게 부른다(followRedirects:false)', G.calls.fetch.length === 1 && G.calls.fetch[0].opt.followRedirects === false);
}
{
  const G = makeGas({ pages: { [WEEK]: { body: PAGE } } });
  const r = G.get({ url: WEEK });
  check('인코딩된 한글 주차 주소 — 가져온다', r.text.includes('===CONTENT===') && G.calls.fetch[0].url === WEEK, r.text.slice(0, 80));
}
const BAD = [
  ['다른 사이트', 'https://evil.example/x'],
  ['http(암호화 없음)', 'http://sites.google.com/yeungnam.hs.kr/202633'],
  ['비슷한 호스트', 'https://sites.google.com.evil.example/yeungnam.hs.kr/x'],
  ['사용자 정보(@)로 다른 호스트', 'https://sites.google.com@evil.example/yeungnam.hs.kr/x'],
  ['포트 붙임', 'https://sites.google.com:8443/yeungnam.hs.kr/202633'],
  ['다른 학교 사이트', 'https://sites.google.com/other-school/x'],
  ['비슷한 학교 이름', 'https://sites.google.com/yeungnam.hs.kr.evil/x'],
  ['.. 조각', 'https://sites.google.com/yeungnam.hs.kr/../other/x'],
  ['인코딩한 ..', 'https://sites.google.com/yeungnam.hs.kr/%2e%2e/other'],
  ['인코딩한 빗금과 ..', 'https://sites.google.com/yeungnam.hs.kr%2F..%2Fother'],
  ['역슬래시', 'https://sites.google.com/yeungnam.hs.kr\\..\\other'],
  ['구글 내부 주소', 'https://169.254.169.254/latest/meta-data'],
  ['파일', 'file:///etc/passwd'],
  ['깨진 인코딩', 'https://sites.google.com/yeungnam.hs.kr/%E0%A4%A'],
];
for (const [label, url] of BAD) {
  const G = makeGas({ pages: { [url]: { body: PAGE } } });
  const r = G.get({ url });
  check(`${label} — 가져오지 않고 짧은 오류만(앱·요약은 실패로 본다)`, r.text.startsWith('ERROR:') && r.text.length < 100
    && G.calls.fetch.length === 0, { text: r.text, fetched: G.calls.fetch.map(f => f.url) });
}
{
  const G = makeGas({ pages: { [SITE]: { code: 302, headers: { Location: '/yeungnam.hs.kr/202633/home' } },
    [SITE + '/home']: { body: PAGE } } });
  const r = G.get({ url: SITE });
  check('같은 사이트 안으로 넘겨주기 — 검사하고 따라간다', r.text.includes('===CONTENT===') && G.calls.fetch.length === 2
    && G.calls.fetch[1].url === SITE + '/home', G.calls.fetch.map(f => f.url));
}
for (const [label, loc] of [['다른 호스트', 'https://evil.example/x'], ['호스트만 생략(//)', '//evil.example/yeungnam.hs.kr/x'],
  ['로그인 화면', 'https://accounts.google.com/ServiceLogin?continue=x'], ['다른 학교', '/other-school/x']]) {
  const G = makeGas({ pages: { [SITE]: { code: 302, headers: { Location: loc } }, [loc]: { body: PAGE } } });
  const r = G.get({ url: SITE });
  check(`${label}(으)로 넘겨주기 — 따라가지 않는다`, r.text.startsWith('ERROR:') && G.calls.fetch.length === 1, { text: r.text, fetched: G.calls.fetch.map(f => f.url) });
}
{
  const G = makeGas({ pages: { [SITE]: { code: 302, headers: { Location: SITE } } } });
  const r = G.get({ url: SITE });
  check('넘겨주기가 끝없이 — 네 번에서 멈춘다', r.text.includes('너무 많습니다') && G.calls.fetch.length === 4, G.calls.fetch.length);
}

console.log('\n[그 밖]');
{
  const G = makeGas();
  const r = G.get({ action: 'getSchedule' });
  check('학사일정 — 그대로(로그인 없이, GitHub 작업이 부른다)', r.json && r.json.success === true, r.json);
}
// 예전 실행 환경(Rhino)에서도 돌게 — 새로 쓴 코드에 화살표 함수·let·const·템플릿 문자열·class 가 없는지
check('예전 실행 환경에서도 돈다 — 화살표 함수 · let · const · 템플릿 문자열 · class · 펼치기(...) 없음',
  !/=>|`|\b(let|const|class)\s|\.\.\.[A-Za-z_$[{(]/.test(CODE.replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''")));
check('비밀값이 코드에 없다 — GitHub 토큰은 스크립트 속성에서 읽는다', /getProperty\('GITHUB_TOKEN'\)/.test(CODE) && !/ghp_|github_pat_|BEGIN PRIVATE KEY/.test(CODE));

// ── 부르는 쪽 — 앱(index.html) · 학부모 화면(parent.html) · 요약 작업(scripts/summarize.js) ──
console.log('\n[부르는 쪽]');
const ROOT = new URL('..', import.meta.url);
const IDX = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const PARENT = fs.readFileSync(new URL('parent.html', ROOT), 'utf8');
// 요약·학사일정 작업(scripts/)은 test 저장소에만 있다 — 운영(ynhs)에서는 그 검사를 건너뛴다
const readIf = rel => fs.existsSync(new URL(rel, ROOT)) ? fs.readFileSync(new URL(rel, ROOT), 'utf8') : null;
const SUM = readIf('scripts/summarize.js'), SCRAPE = readIf('scripts/scrape-weekly.js');
const grab = (src, name) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = src.indexOf('{', m.index), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(m.index, j + 1); }
};
{
  // 앱의 postPoints 를 떼어 와, 새 판 스크립트(위의 가짜 구글에서 도는 진짜 Code.gs) · 옛 판(doPost 없음)에 각각 붙여 본다
  const URL0 = 'https://script.google.com/macros/s/AKfycbyLEakk/exec';
  const mkPost = (server) => {
    const sent = [];
    const fetch = async (url, opt = {}) => {
      sent.push({ url, method: opt.method || 'GET', body: opt.body ? String(opt.body) : '' });
      const text = server(url, opt);
      return { ok: true, status: 200, text: async () => text };
    };
    const fn = new Function('fetch', 'POINTS_SCRIPT_URL', 'URLSearchParams', grab(IDX, 'postPoints') + '\nreturn postPoints;')(fetch, URL0, URLSearchParams);
    return { fn, sent };
  };
  const form = (u, opt) => Object.fromEntries(new URLSearchParams(opt.method === 'POST' ? String(opt.body) : u.split('?')[1] || ''));
  const params = () => new URLSearchParams({ ...POINT, idToken: TEACHER });
  // 새 판 — doPost 가 있다
  const G = makeGas();
  const nw = mkPost((u, opt) => (opt.method === 'POST' ? G.post(form(u, opt)) : G.get(form(u, opt))).text);
  const r1 = await nw.fn(params());
  check('새 판 스크립트 — 본문(POST) 한 번에 저장, 주소에는 확인값이 없다', r1.success === true && nw.sent.length === 1
    && nw.sent[0].method === 'POST' && !nw.sent[0].url.includes('?') && nw.sent[0].body.includes('idToken=') && G.calls.writes.length === 1, nw.sent);
  const nw2 = mkPost((u, opt) => G.post(form(u, opt)).text);
  const r2 = await nw2.fn(new URLSearchParams({ ...POINT, idToken: 'tok-student-0000000000000' }));
  check('— 거절 답(JSON)이면 다시 보내지 않는다(예전 방식으로 우회하지 않음)', r2.success === false && nw2.sent.length === 1, nw2.sent);
  // 옛 판 — doPost 가 없어 POST 에 오류 화면(HTML)이 온다, GET 은 예전처럼 저장
  let oldWrites = 0;
  const old = mkPost((u, opt) => opt.method === 'POST' ? '<!DOCTYPE html><title>오류</title>스크립트 함수를 찾을 수 없음: doPost'
    : (oldWrites++, JSON.stringify({ success: true, row: 9 })));
  const r3 = await old.fn(params());
  check('옛 판 스크립트(새 코드를 붙이기 전) — POST 가 안 되면 예전 방식(GET)으로 한 번 더, 저장은 한 번만', r3.success === true
    && old.sent.length === 2 && old.sent[1].method === 'GET' && oldWrites === 1, old.sent.map(x => x.method));
  check('— 그 예전 방식 요청에는 확인값을 싣지 않는다(주소에 남지 않게)', !old.sent[1].url.includes('idToken'), old.sent[1].url.slice(0, 120));
  const bad = mkPost(() => '<html>오류</html>');
  const e = await bad.fn(params()).then(() => null, e => e);
  check('둘 다 JSON 이 아니면 — 「응답 파싱 오류」 로 멈춘다(저장했다고 하지 않는다)', e && e.message.includes('응답 파싱 오류'), e && e.message);
}
check('상벌점 저장 — 로그인 확인값을 실어 postPoints 로 보낸다', /action: 'savePoints',\s*idToken,/.test(IDX) && /const json = await postPoints\(params\);/.test(IDX)
  && /idToken = await fbAuth\.currentUser\.getIdToken\(\)/.test(IDX));
check('AI 요약 갱신(앱 함수) — 확인값과 함께 본문(POST)으로', /body: new URLSearchParams\(\{ action: 'triggerWeeklySummary', idToken \}\)/.test(IDX));
const PARENT_CODE = PARENT.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // 주석 줄은 빼고(옮긴 까닭을 적어 둔 줄)
check('학부모 화면 — Apps Script 예비 경로(?worker=0)가 없다, 워커만', !/script\.google\.com|USE_WORKER|callGas|worker=0/.test(PARENT_CODE)
  && /const WORKER_URL = 'https:\/\/consult-api\./.test(PARENT));
{
  const ids = [IDX, PARENT, SUM, SCRAPE].filter(Boolean)
    .flatMap(t => [...t.matchAll(/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]+)\/exec/g)].map(m => m[1]));
  check(`${SUM ? '앱·요약·학사일정' : '앱'}이 부르는 Apps Script 배포가 하나뿐(…C0YA) — 나머지는 보관처리해도 된다`, ids.length >= (SUM ? 4 : 2)
    && new Set(ids).size === 1 && ids[0].endsWith('C0YA'), [...new Set(ids)].map(x => x.slice(0, 14) + '…' + x.slice(-4)));
}
if (!SUM) console.log('  (요약 작업 scripts/summarize.js 는 test 저장소에만 있어 건너뜀)');
else {
  const weeklyBody = new Function(grab(SUM, 'weeklyBody') + '\nreturn weeklyBody;')();
  const raw = '===NAV===\n' + Array.from({ length: 40 }, (_, i) => SITE + '/week-' + i).join('\n') + '\n===CONTENT===\n<h1>주간 교육활동</h1><p>11월 2일 행사</p>';
  check('요약 작업 — 주차 링크 목록은 떼고 본문만 Gemini 에(4000자를 링크가 먹지 않게)', weeklyBody(raw).trim().startsWith('<h1>주간 교육활동')
    && !weeklyBody(raw).includes('/week-'), weeklyBody(raw).slice(0, 80));
  check('— 표시가 없는 답(다른 형식)은 그대로', weeklyBody('<html>본문</html>') === '<html>본문</html>');
}

console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
