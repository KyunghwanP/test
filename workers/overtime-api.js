// 자동 생성 — 직접 고치지 말 것. 원본: workers/overtime-api.src.js + gas/overtime/Code.gs
// 만들기: node workers/build-overtime.mjs
/**
 * 초과근무 API (overtime-api) — 원본 소스. 배포본은 workers/overtime-api.js
 *
 *   node workers/build-overtime.mjs   ← 이 파일 + gas/overtime/Code.gs → overtime-api.js
 *
 * 처리 규칙은 gas/overtime/Code.gs 하나뿐이다. 그 파일을 이 워커 안에 그대로 넣고,
 * Apps Script 가 주던 것(SpreadsheetApp·MailApp·잠금 …)만 여기서 바꿔 끼운다.
 * 그래서 규칙을 고치면 Code.gs 를 고치고 다시 빌드한다. 이 파일에 규칙을 적지 않는다.
 *
 * 왜 워커인가 — Apps Script 웹앱은 버튼 한 번에 1.5~3초(처음엔 4~6초)가 걸렸다.
 * 워커는 시트를 한 번에 읽고(values:batchGet), 바뀐 것을 요청 하나로 쓴다(batchUpdate —
 * 전부 반영되거나 하나도 안 되거나). 원본은 그대로 학교 계정 소유의 관리대장 시트다.
 *
 * 한 번에 하나씩 — 쓰기 요청은 Firestore 의 잠금 문서(locks/overtime) 하나로 줄 세운다.
 * 문서에는 '언제까지 잡고 있나' 만 있다. 신청 내용은 Firebase 에 두지 않는다.
 * 보기만 하는 요청(me·adminList·grid·slotsOf·status)은 잠그지 않고, 아무것도 쓰지 않는다.
 *
 * 메일은 학교 메일로 나가야 해서, 시트에 다 쓴 뒤 학교 계정 Apps Script(메일만 보냄)에
 * 부탁한다. 화면은 메일을 기다리지 않는다.
 *
 * 시크릿·변수 (Cloudflare 대시보드 → 이 워커 → 설정 → 변수 및 비밀)
 *   SA_JSON          (비밀)  서비스 계정 JSON. 관리대장 시트의 편집자여야 하고 Firestore 를 쓸 수 있어야 한다
 *   SHEET_ID         (변수)  관리대장 시트 주소의 /d/ 와 /edit 사이
 *   MAILER_URL       (변수)  학교 계정 Apps Script 웹앱 주소(…/exec)
 *   MAIL_SECRET      (비밀)  Apps Script 스크립트 속성 MAIL_SECRET 과 같은 값
 *   ALLOWED_ORIGINS  (변수)  https://kyunghwanp.github.io
 * 크론 트리거: 「*\/15 * * * *」(기한 만료) 와 「0 7 * * *」(한국 오후 4시, 미처리 알림)
 */

const FIREBASE_WEB_KEY = 'AIzaSyCrYCGksB-Nv8LNIv1kZc_a8d6bIL_5CvA';   // 앱에 공개된 값
const READ_ONLY = new Set(['me', 'adminList', 'grid', 'slotsOf', 'status']);
const LOCK_TTL_MS = 15000;          // 잡은 채 죽은 워커가 있어도 이만큼 지나면 풀린다
const LOCK_WAIT_MS = 9000;          // 이만큼 기다려도 못 잡으면 BUSY
const DAILY_CRON = '0 7 * * *';     // UTC 07:00 = 한국 16:00

// ── 아래부터 gas/overtime/Code.gs 그대로 (고치려면 그 파일을 고치고 다시 빌드) ──
function createOvertime(__g) {
  const { SpreadsheetApp, PropertiesService, CacheService, LockService, MailApp, Session,
          ScriptApp, ContentService, Utilities, UrlFetchApp } = __g || {};
/**
 * 4시간 초과근무 관리 — 관리대장 시트에 붙여 쓰는 Apps Script
 *
 * 학교 계정(교무 공용 계정 권장)이 소유한 스프레드시트의
 * 「확장 프로그램 → Apps Script」 에 이 파일을 통째로 붙여 넣어 씁니다.
 * 설치 순서는 같은 폴더의 README.md.
 *
 * 이 저장소의 파일은 사본이다. 실제로 도는 것은 학교 계정의 Apps Script 이고,
 * 고친 뒤에는 그쪽에 다시 붙여 넣고 「새 버전」 으로 배포해야 반영된다.
 *
 * 원칙
 *  · 원본은 이 시트다. 신청 내용은 앱(Firebase)에 두지 않는다. 감사 근거로 쓰려면
 *    개인 계정 데이터베이스보다 학교 계정 문서가 맞다.
 *  · 시트는 전부 잠근다. 사람은 보기만 하고 쓰는 것은 이 스크립트뿐이라,
 *    모든 변경이 「변경 이력」 에 남는다.
 *  · 누가 보냈는지는 앱 로그인 토큰을 구글에 물어 확인한다. 요청 본문에 적힌
 *    이름·이메일은 믿지 않는다. 이름은 「교원 명렬」 에서 채운다.
 *  · 권한은 「설정」 탭의 명단으로 정한다. 앱이 버튼을 숨기는 것과 별개로
 *    요청마다 여기서 다시 확인한다.
 *  · 신청자는 자기 신청만 본다. 남의 업무 내용은 관리자에게만 간다.
 */

const OT_VERSION = '2026-10-03';

// Firebase 웹 API 키 — 앱(index.html)에 이미 공개된 값이라 비밀이 아니다.
// 앱이 보낸 로그인 토큰을 구글에 확인할 때만 쓴다.
const FIREBASE_API_KEY = 'AIzaSyCrYCGksB-Nv8LNIv1kZc_a8d6bIL_5CvA';
const SCHOOL_DOMAIN = 'yeungnam.hs.kr';
const TZ = 'Asia/Seoul';

const SH = {
  DUTY:  '① 자율학습 감독',
  REQ:   '② 기타 업무',
  ALL:   '③ 통합조회',
  SWAP:  '교체·정정',
  LOG:   '변경 이력',
  CFG:   '설정',
  STAFF: '교원 명렬',
  DUTYX: '감독 상세',      // 숨김 — ①과 같은 모양. 칸마다 이메일과 마지막으로 바뀐 내력
};

const BANDS = ['4시간 초과 ~ 5시간 이하', '5시간 초과 ~ 6시간 이하', '6시간 초과 ~ 7시간 이하',
               '7시간 초과 ~ 8시간 이하', '8시간 초과'];
const TYPES = ['정기고사 출제·채점', '상담', '부서 업무', '기타'];

// 감독 칸이 마지막으로 어떻게 바뀌었는지. 색과 메모로 ①에 드러낸다.
const KIND_BG    = { '교체': '#FEF3C7', '긴급': '#FEE2E2', '사후 정정': '#DBEAFE', '정정': '#EDE9FE' };
const KIND_LABEL = { '배정': '배정', '교체': '교체 수락', '긴급': '긴급 교체', '사후 정정': '사후 정정', '정정': '담당자 정정' };

const CFG_ROWS = [
  ['승인 (관리자)',   '',      '승인·반려하는 분(교감). 학교 이메일이나 교원 명렬의 이름. 여럿이면 쉼표로 나눕니다.'],
  ['보기 (관리자)',   '',      '모든 신청과 월 요약을 보는 분(교장 등). 승인은 못 합니다.'],
  ['1학년 기획 담당', '',      '1학년 감독 배정과 정정'],
  ['2학년 기획 담당', '',      '2학년 감독 배정과 정정'],
  ['3학년 기획 담당', '',      '3학년 감독 배정과 정정'],
  ['운영 담당',       '',      '앱에서 교원 명렬을 보내고 설치 상태를 확인하는 분'],
  ['교체 수락 기한',  '18:30', '근무일 당일 이 시각까지 상대가 수락하지 않으면 교체 요청이 저절로 취소됩니다.'],
  ['신청 받는 기간 (일)', '60', '오늘부터 며칠 뒤 근무일까지 미리 신청할 수 있는지'],
  ['메일 알림',       '끔',    '켬 / 끔. 시험하는 동안은 끔으로 두세요. 켜면 학교 메일로 알림이 갑니다.'],
  ['앱 주소',         'https://kyunghwanp.github.io/test/', '메일 끝에 붙이는 링크'],
];

// 칸 번호 — 학년(g) 1~3, 역할(r) 1~3. 감독3 이 심야다.
const idx_ = (g, r) => (g - 1) * 3 + (r - 1);
const roleLabel_ = r => '감독' + r + (r === 3 ? ' (심야)' : '');
const slotLabel_ = s => s.g + '학년 ' + roleLabel_(s.r);

// ─────────────────────────────────────────────────────────────────────────────
// 웹앱 입구
// ─────────────────────────────────────────────────────────────────────────────

function doGet() {
  return json_({ ok: true, service: 'overtime', version: OT_VERSION });
}

// 앱은 text/plain 으로 보낸다. 다른 머리글을 붙이면 브라우저가 사전 요청(OPTIONS)을
// 보내는데 Apps Script 는 그것을 받지 못한다. 그래서 토큰도 본문에 담아 온다.
function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'BAD_JSON', msg: '요청을 읽지 못했습니다.' }); }
  return json_(handle_(body || {}));
}

const ACTIONS = {
  me:          ctx => ({ state: me_(ctx) }),
  submit:      actSubmit_,
  cancel:      actCancel_,
  adminList:   actAdminList_,
  decide:      actDecide_,
  assign:      actAssign_,
  grid:        actGrid_,
  fix:         actFix_,
  slotsOf:     actSlotsOf_,
  swapRequest: actSwapRequest_,
  respond:     actRespond_,
  withdraw:    actWithdraw_,
  emergency:   actEmergency_,
  correct:     actCorrect_,
  status:      actStatus_,
  roster:      actRoster_,
};

// 워커로 옮긴 뒤 — 스크립트 속성에 MAIL_SECRET 이 있으면 — 이 스크립트는 메일만 보낸다.
// 시트는 워커가 쓴다. 둘이 같이 쓰면 서로의 잠금을 모르니 한쪽은 손을 떼야 한다.
const workerMode_ = () => !!PropertiesService.getScriptProperties().getProperty('MAIL_SECRET');

function handle_(b) {
  if (b.action === 'ping') return { ok: true, version: OT_VERSION };
  if (b.action === 'mail') return mailRelay_(b);
  if (workerMode_()) return { ok: false, error: 'MOVED', msg: '초과근무 연결 주소가 바뀌었습니다. 앱을 새로 고쳐 주세요.' };
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, b.action) ? ACTIONS[b.action] : null;
  if (!fn) return { ok: false, error: 'ACTION', msg: '알 수 없는 요청입니다.' };
  const who = verifyToken_(b.idToken);
  if (!who) return { ok: false, error: 'AUTH', msg: '로그인을 확인하지 못했습니다. 앱을 새로 고친 뒤 다시 해 주세요.' };

  // 한 번에 하나씩. 두 사람이 같은 칸을 동시에 바꾸거나 같은 번호를 받는 일을 막는다.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY', msg: '다른 요청을 처리하는 중입니다. 잠시 뒤 다시 눌러 주세요.' };
  let ctx = null, res;
  try {
    ctx = ctx_(who);
    // 기한이 지난 요청부터 정리한다. 시계 트리거(tick)가 15분마다 하지만,
    // 그 사이에 화면을 연 사람에게도 정확한 상태를 보여 줘야 한다.
    if (expire_(ctx)) commit_(ctx);
    res = Object.assign({ ok: true }, fn(ctx, b) || {});
    commit_(ctx);
    SpreadsheetApp.flush();
  } catch (err) {
    res = errOut_(err);
  } finally {
    lock.releaseLock();
  }
  // 메일은 잠금을 푼 뒤에 보낸다. 시트에 다 적힌 것만 나간다(commit_ 이 넘겨준 것).
  if (ctx) sendMails_(ctx);
  return res;
}

// 워커가 시트에 다 쓴 뒤 보내 달라는 메일. 학교 메일로 나가야 해서 이 계정이 보낸다.
// 비밀값이 맞아야 하고, 학교 주소로만, 한 번에 50통까지.
function mailRelay_(b) {
  const secret = PropertiesService.getScriptProperties().getProperty('MAIL_SECRET') || '';
  const got = typeof b.secret === 'string' ? b.secret : '';
  let diff = got.length === secret.length ? 0 : 1;
  for (let i = 0; i < Math.min(got.length, secret.length); i++) diff |= got.charCodeAt(i) ^ secret.charCodeAt(i);
  if (!secret || secret.length < 20 || diff) return { ok: false, error: 'AUTH' };
  let sent = 0;
  (Array.isArray(b.mails) ? b.mails.slice(0, 50) : []).forEach(m => {
    const to = String((m && m.to) || '').split(',').map(e => e.trim().toLowerCase())
      .filter(e => /^[a-z0-9._-]+@/.test(e) && e.endsWith('@' + SCHOOL_DOMAIN));
    if (!to.length) return;
    try {
      MailApp.sendEmail({ to: to.join(','), subject: text_(m.subject, 200), body: String(m.body || '').slice(0, 5000), name: '초과근무 관리' });
      sent++;
    } catch (e) { console.error('메일 보내기 실패', to.join(','), e); }
  });
  return { ok: true, sent: sent };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 사용자에게 보여 줄 거절은 fail() 로 던진다. 그 밖의 예외는 서버 오류다.
function fail(msg, code) {
  const e = new Error(msg);
  e.userMsg = msg;
  e.code = code || 'INVALID';
  throw e;
}
function errOut_(err) {
  if (err && err.userMsg) return { ok: false, error: err.code, msg: err.userMsg };
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, error: 'SERVER', msg: '처리하지 못했습니다: ' + (err && err.message ? err.message : err) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 본인 확인 — 앱의 Firebase 로그인 토큰을 구글(Identity Toolkit)에 묻는다.
// 앱의 Cloudflare 워커들이 하는 것과 같은 방법이다.
// ─────────────────────────────────────────────────────────────────────────────

function verifyToken_(tok) {
  if (typeof tok !== 'string' || tok.length < 20 || tok.length > 4096) return null;
  const cache = CacheService.getScriptCache();
  const key = 'tok:' + hash_(tok);
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* 다시 묻는다 */ } }
  let res;
  try {
    res = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
      { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ idToken: tok }), muteHttpExceptions: true });
  } catch (e) { return null; }
  if (res.getResponseCode() !== 200) return null;
  let u;
  try { u = (JSON.parse(res.getContentText()).users || [])[0]; } catch (e) { return null; }
  const email = String((u && u.email) || '').toLowerCase();
  if (!u || u.emailVerified !== true || u.disabled === true) return null;
  if (!email.endsWith('@' + SCHOOL_DOMAIN)) return null;
  if (/^[0-9]{7}@/.test(email)) return null;              // 학생 계정
  const who = { email: email, gname: String(u.displayName || '').trim().slice(0, 20) };
  cache.put(key, JSON.stringify(who), 300);
  return who;
}

function hash_(s) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}
// 명렬의 사람을 가리키는 번호. 이메일을 앱에 내려보내지 않으려고 쓴다.
const sid_ = email => hash_('ot:' + email).slice(0, 12);

// ─────────────────────────────────────────────────────────────────────────────
// 요청 한 번의 맥락 — 설정·명렬·권한을 읽어 둔다
// ─────────────────────────────────────────────────────────────────────────────

function now_() { return new Date(); }

function ctx_(who) {
  const t = now_();
  const ctx = {
    today: fmt_(t, 'yyyy-MM-dd'),
    now:   fmt_(t, 'yyyy-MM-dd HH:mm'),
    hour:  parseInt(fmt_(t, 'H'), 10),
    queued: [], ready: [], logs: [], dirtyAll: false, _t: {}, _duty: null,
  };
  ctx.cfg = readCfg_();
  ctx.staff = readStaff_();
  ctx.byEmail = {}; ctx.byName = {}; ctx.byId = {};
  ctx.staff.forEach(p => {
    ctx.byEmail[p.email] = p;
    ctx.byId[p.id] = p;
    (ctx.byName[norm_(p.name)] = ctx.byName[norm_(p.name)] || []).push(p);
  });
  const p = ctx.byEmail[who.email];
  ctx.me = {
    email: who.email,
    name: p ? p.name : (who.gname || (who.email ? who.email.split('@')[0] : '(자동)')),
    dept: p ? p.dept : '',
    id: who.email ? sid_(who.email) : '',
  };
  const L = label => resolveList_(ctx, ctx.cfg.raw[label]);
  ctx.lists = {
    approve: L('승인 (관리자)'), view: L('보기 (관리자)'),
    g1: L('1학년 기획 담당'), g2: L('2학년 기획 담당'), g3: L('3학년 기획 담당'),
    operator: L('운영 담당'),
  };
  const has = k => !!who.email && ctx.lists[k].emails.indexOf(who.email) >= 0;
  ctx.role = {
    approve: has('approve'),
    view: has('approve') || has('view'),
    grades: [1, 2, 3].filter(g => has('g' + g)),
    operator: has('operator'),
  };
  return ctx;
}

function readCfg_() {
  const raw = {};
  rows_(tab_(SH.CFG), 1, 2).forEach(r => { if (r[0]) raw[r[0]] = r[1]; });
  const dl = parseHm_(raw['교체 수락 기한']) || '18:30';
  const hz = parseInt(raw['신청 받는 기간 (일)'], 10);
  return {
    raw: raw,
    deadline: dl,
    horizon: hz > 0 && hz <= 365 ? hz : 60,
    mailOn: /^(켬|켜기|예|on|yes|o)$/i.test(String(raw['메일 알림'] || '').trim()),
    appUrl: /^https:\/\//.test(raw['앱 주소'] || '') ? raw['앱 주소'] : '',
  };
}

// '18:30' · '18시 30분' · '오후 6:30' — 사람이 적는 칸이라 너그럽게 읽는다.
function parseHm_(v) {
  const s = String(v || '');
  const m = /(\d{1,2})\s*[:시]\s*(\d{1,2})?/.exec(s);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  if (/오후|pm/i.test(s) && h < 12) h += 12;
  if (h > 23 || mi > 59) return '';
  return pad2_(h) + ':' + pad2_(mi);
}

function readStaff_() {
  const seen = {};
  const out = [];
  rows_(tab_(SH.STAFF), 1, 3).forEach(r => {
    const name = r[0], dept = r[1], email = String(r[2] || '').toLowerCase();
    if (!name || !email || seen[email]) return;
    seen[email] = 1;
    out.push({ name: name, dept: dept, email: email, id: sid_(email) });
  });
  return out;
}

// 설정 칸의 사람 목록. 이메일이면 그대로, 이름이면 명렬에서 찾는다.
// 동명이인이거나 명렬에 없는 이름은 권한을 주지 않고 bad 로 돌려준다(설치 상태 화면에 뜬다).
function resolveList_(ctx, text) {
  const emails = [], bad = [];
  String(text || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).forEach(t => {
    if (t.indexOf('@') >= 0) { emails.push(t.toLowerCase()); return; }
    const hit = ctx.byName[norm_(t)] || [];
    if (hit.length === 1) emails.push(hit[0].email); else bad.push(t);
  });
  return { emails: emails, bad: bad };
}

const norm_ = s => String(s || '').replace(/\s+/g, '');

function personOf_(ctx, id) {
  return (id && Object.prototype.hasOwnProperty.call(ctx.byId, id)) ? ctx.byId[id] : null;
}
function findByName_(ctx, name) { return ctx.byName[norm_(name)] || []; }

// ─────────────────────────────────────────────────────────────────────────────
// 시트 읽고 쓰기
// ─────────────────────────────────────────────────────────────────────────────

let _book = null;
function book_() {
  if (_book) return _book;
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  _book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_book) fail('관리대장 시트를 찾지 못했습니다. 학교 계정으로 setup 을 한 번 실행해 주세요.', 'SETUP');
  return _book;
}
function tab_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) fail('시트에 「' + name + '」 탭이 없습니다. 학교 계정으로 setup 을 한 번 실행해 주세요.', 'SETUP');
  return sh;
}

// 칸은 모두 '일반 텍스트' 서식이다. 표시값으로 읽으면 날짜·시각이 Date 로 바뀌어
// 시간대를 타는 일이 없다.
function rows_(sh, head, width) {
  const n = sh.getLastRow() - head;
  if (n <= 0) return [];
  return sh.getRange(head + 1, 1, n, width).getDisplayValues()
    .map(r => r.map(v => String(v == null ? '' : v).trim()));
}

// =·+·-·@ 로 시작하는 글은 시트가 수식으로 읽는다. 사유 칸에 수식을 넣어
// 시트를 연 사람의 화면에서 바깥으로 요청을 보내게 하는 수가 있어, 앞에 빈칸을 둔다.
// 읽을 때는 trim() 으로 떨어진다.
const safe_ = v => { const s = v == null ? '' : String(v); return /^[=+\-@]/.test(s) ? ' ' + s : s; };

function ensureRows_(sh, last) {
  const max = sh.getMaxRows();
  if (max >= last) return;
  const add = last - max + 100;
  sh.insertRowsAfter(max, add);
  sh.getRange(max + 1, 1, add, sh.getMaxColumns()).setNumberFormat('@');
}
function appendRows_(sh, rows, width) {
  if (!rows.length) return;
  // 워커는 변경 이력을 통째로 읽지 않는다(해가 갈수록 길어진다). 끝은 시트가 찾아 붙인다.
  if (sh.appendFast) { sh.appendFast(rows.map(r => r.map(safe_)), width); return; }
  const start = sh.getLastRow() + 1;
  ensureRows_(sh, start + rows.length - 1);
  sh.getRange(start, 1, rows.length, width).setValues(rows.map(r => r.map(safe_)));
  return start;
}

// ② 기타 업무
const REQ_N = 14;
const REQ_HEAD = ['번호', '접수', '근무일', '이름', '부서', '예정 시간 (구간)', '유형', '사유', '상태',
                  '반려 사유 · 비고', '처리자', '처리 시각', '이메일', '처리자 이메일'];
function parseReq_(r) {
  return { id: r[0], at: r[1], date: r[2].slice(0, 10), name: r[3], dept: r[4], band: r[5], type: r[6],
           reason: r[7], status: r[8], note: r[9], by: r[10], byAt: r[11],
           email: r[12].toLowerCase(), byEmail: r[13].toLowerCase() };
}
function unparseReq_(q) {
  return [q.id, q.at, dateLabel_(q.date), q.name, q.dept, q.band, q.type, q.reason, q.status,
          q.note, q.by, q.byAt, q.email, q.byEmail];
}

// 교체·정정 — 교체 요청, 긴급 교체, 사후 정정, 담당자 정정을 모두 한 표에 남긴다.
// 마지막 칸(자료)은 숨김. 칸 위치와 이메일을 담는다.
//   holder: 원래 그 칸(s)에 있던 사람  actual: 새로 그 칸을 맡는 사람
//   맞교환이면 s2 는 actual 의 칸이었고, 끝나면 holder 가 맡는다.
//   from: 요청·등록한 사람  to: 수락·확인해야 하는 사람(없으면 빈칸)
const SWAP_N = 15;
const SWAP_HEAD = ['번호', '접수', '종류', '방식', '근무일', '칸', '요청·등록한 사람', '원래 사람', '바뀐 사람',
                   '맞교환 칸', '사유', '상태', '처리 시각', '기한', '자료'];
function parseSwap_(r) {
  const d = parseJson_(r[14]) || {};
  return { id: r[0], at: r[1], kind: r[2], mode: r[3], date: r[4].slice(0, 10), label: r[5],
           byName: r[6], holderName: r[7], actualName: r[8], slot2Label: r[9], reason: r[10],
           status: r[11], doneAt: r[12], deadline: r[13],
           s: d.s || null, s2: d.s2 || null, from: d.from || '', to: d.to || '',
           holder: d.holder || '', actual: d.actual || '' };
}
function unparseSwap_(w) {
  return [w.id, w.at, w.kind, w.mode, dateLabel_(w.s.date), slotLabel_(w.s), w.byName, w.holderName,
          w.actualName, w.s2 ? short_(w.s2.date) + ' ' + slotLabel_(w.s2) : '', w.reason, w.status,
          w.doneAt, w.deadline,
          JSON.stringify({ s: w.s, s2: w.s2, from: w.from, to: w.to, holder: w.holder, actual: w.actual })];
}

const TABLES = {};
TABLES[SH.REQ]  = { width: REQ_N,  parse: parseReq_,  unparse: unparseReq_ };
TABLES[SH.SWAP] = { width: SWAP_N, parse: parseSwap_, unparse: unparseSwap_ };

function table_(ctx, name) {
  if (ctx._t[name]) return ctx._t[name];
  const spec = TABLES[name];
  const sh = tab_(name);
  const items = rows_(sh, 1, spec.width).map((r, i) => {
    const o = spec.parse(r);
    o._row = i + 2;
    return o;
  }).filter(o => o.id);
  ctx._t[name] = { sh: sh, spec: spec, items: items, dirty: [], added: [] };
  return ctx._t[name];
}
const loadReqs_  = ctx => table_(ctx, SH.REQ).items;
const loadSwaps_ = ctx => table_(ctx, SH.SWAP).items;
function touch_(ctx, name, item) {
  const t = table_(ctx, name);
  if (t.dirty.indexOf(item) < 0) t.dirty.push(item);
}
function addItem_(ctx, name, item) {
  const t = table_(ctx, name);
  t.items.push(item);
  t.added.push(item);
}
function nextId_(items, prefix) {
  let max = 0;
  items.forEach(o => {
    const n = parseInt(String(o.id).slice(prefix.length), 10);
    if (String(o.id).indexOf(prefix) === 0 && n > max) max = n;
  });
  return prefix + String(max + 1).padStart(4, '0');
}

function saveTables_(ctx) {
  Object.keys(ctx._t).forEach(name => {
    const t = ctx._t[name];
    t.dirty.forEach(it => {
      if (it._row) t.sh.getRange(it._row, 1, 1, t.spec.width).setValues([t.spec.unparse(it).map(safe_)]);
    });
    t.dirty = [];
    if (t.added.length) {
      const start = appendRows_(t.sh, t.added.map(t.spec.unparse), t.spec.width);
      t.added.forEach((it, i) => { it._row = start + i; });
      t.added = [];
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 자율학습 감독 — 하루가 한 줄, 학년마다 감독1·2·3. 숨김 탭에 같은 모양으로
// 이메일과 마지막 내력을 둔다. 쓸 때는 두 탭을 날짜 순으로 통째로 다시 쓴다
// (한 해 200줄 안팎이라 가볍다). 그래서 두 탭이 어긋날 일이 없다.
// ─────────────────────────────────────────────────────────────────────────────

const blankCells_ = () => Array.from({ length: 9 }, () => ({ n: '', e: '', k: '', by: '', at: '', was: '', lab: '' }));

function loadDuty_(ctx) {
  if (ctx._duty) return ctx._duty;
  const names = rows_(tab_(SH.DUTY), 2, 10);
  const det = rows_(tab_(SH.DUTYX), 2, 10);
  const detBy = {};
  det.forEach(r => { if (r[0]) detBy[r[0].slice(0, 10)] = r; });
  const days = {};
  const junk = [];
  names.forEach(r => {
    const d = r[0].slice(0, 10);
    if (!validYmd_(d)) { if (r.some(Boolean)) junk.push(r); return; }
    const x = detBy[d] || [];
    days[d] = blankCells_().map((blank, i) => {
      const n = r[i + 1];
      const info = parseJson_(x[i + 1]) || {};
      // 학교 계정이 시트에서 이름을 직접 고쳤으면 숨김 탭의 이메일은 옛 사람 것이다.
      // 그때는 명렬에서 이름으로 다시 찾는다(못 찾으면 비워 둔다 — 그 칸은 교체를 못 한다).
      let e = String(info.e || '');
      if (n && info.n !== n) { const hit = findByName_(ctx, n); e = hit.length === 1 ? hit[0].email : ''; }
      return { n: n, e: n ? e : '', k: info.k || '', by: info.by || '', at: info.at || '',
               was: info.was || '', lab: info.lab || '' };
    });
  });
  ctx._duty = { days: days, dirty: false, junk: junk, oldRows: names.length, oldRowsX: det.length };
  return ctx._duty;
}

function noteOf_(c) {
  if (!c.k || c.k === '배정') return '';
  return (c.was || '(빈 칸)') + ' → ' + (c.n || '(비움)') + ' · ' + (c.lab || KIND_LABEL[c.k] || c.k) +
         ' · ' + c.at.slice(5).replace('-', '.');
}

function saveDuty_(ctx) {
  const m = ctx._duty;
  if (!m || !m.dirty) return;
  const dates = Object.keys(m.days).sort();
  const vals = [], xs = [], bgs = [], notes = [];
  dates.forEach(d => {
    const cells = m.days[d];
    vals.push([dateLabel_(d)].concat(cells.map(c => c.n)));
    xs.push([d].concat(cells.map(c => (c.n || c.k)
      ? JSON.stringify({ n: c.n, e: c.e, k: c.k, by: c.by, at: c.at, was: c.was, lab: c.lab }) : '')));
    bgs.push([null].concat(cells.map(c => KIND_BG[c.k] || null)));
    notes.push([''].concat(cells.map(noteOf_)));
  });
  // 날짜로 못 읽은 줄은 손으로 넣은 것이다. 무엇인지 모르니 지우지 않고 맨 아래에 그대로 둔다.
  m.junk.forEach(r => { vals.push(r); bgs.push(r.map(() => null)); notes.push(r.map(() => '')); });
  const sh = tab_(SH.DUTY), shx = tab_(SH.DUTYX);
  if (vals.length) {
    ensureRows_(sh, vals.length + 2);
    const rg = sh.getRange(3, 1, vals.length, 10);
    rg.setValues(vals.map(r => r.map(safe_)));
    rg.setBackgrounds(bgs);
    rg.setNotes(notes);
  }
  if (xs.length) {
    ensureRows_(shx, xs.length + 2);
    shx.getRange(3, 1, xs.length, 10).setValues(xs);
  }
  // 같은 날짜가 두 줄이었거나 줄이 줄었으면, 아래에 옛 줄이 남지 않게 지운다
  if (m.oldRows > vals.length) {
    const rest = sh.getRange(3 + vals.length, 1, m.oldRows - vals.length, 10);
    rest.clearContent(); rest.setBackground(null);
    rest.setNotes(Array.from({ length: m.oldRows - vals.length }, () => Array(10).fill('')));
  }
  if (m.oldRowsX > xs.length) shx.getRange(3 + xs.length, 1, m.oldRowsX - xs.length, 10).clearContent();
  m.oldRows = vals.length; m.oldRowsX = xs.length;
  m.dirty = false;
}

function cellAt_(ctx, s) {
  const day = loadDuty_(ctx).days[s.date];
  return day ? day[idx_(s.g, s.r)] : null;
}

// 칸을 바꾼다. p 가 null 이면 비운다. 바뀐 내력은 그 칸에 하나만 남고(메모),
// 전부는 「변경 이력」 에 남는다.
function setCell_(ctx, s, p, kind, lab) {
  const m = loadDuty_(ctx);
  if (!m.days[s.date]) m.days[s.date] = blankCells_();
  const old = m.days[s.date][idx_(s.g, s.r)];
  m.days[s.date][idx_(s.g, s.r)] = {
    n: p ? p.name : '', e: p ? p.email : '', k: kind, by: ctx.me.name, at: ctx.now,
    was: kind === '배정' ? '' : old.n, lab: lab || '',
  };
  m.dirty = true;
  if (s.r === 3) ctx.dirtyAll = true;
}

// 그날 이 사람이 이미 서는 칸(except 는 빼고 본다). 없으면 ''.
function busyOn_(ctx, email, date, except) {
  if (!email) return '';
  const day = loadDuty_(ctx).days[date];
  if (!day) return '';
  for (let g = 1; g <= 3; g++) for (let r = 1; r <= 3; r++) {
    if (day[idx_(g, r)].e !== email) continue;
    if ((except || []).some(x => x && x.date === date && x.g === g && x.r === r)) continue;
    return slotLabel_({ g: g, r: r });
  }
  return '';
}

function slotsOfEmail_(ctx, email, from, to) {
  const out = [];
  const days = loadDuty_(ctx).days;
  Object.keys(days).sort().forEach(d => {
    if (d < from || d > to) return;
    for (let g = 1; g <= 3; g++) for (let r = 1; r <= 3; r++) {
      const c = days[d][idx_(g, r)];
      if (email && c.e === email) out.push({ date: d, g: g, r: r, label: slotLabel_({ g: g, r: r }), k: c.k, past: d < ctx.today });
    }
  });
  return out;
}

const sameSlot_ = (a, b) => !!a && !!b && a.date === b.date && a.g === b.g && a.r === b.r;

// ─────────────────────────────────────────────────────────────────────────────
// 교체가 지금 상태로 가능한지 — 요청할 때, 수락할 때 두 번 본다.
// 요청과 수락 사이에 다른 교체·정정으로 칸이 바뀌었을 수 있다.
// ─────────────────────────────────────────────────────────────────────────────

function checkSwap_(ctx, w) {
  const c = cellAt_(ctx, w.s);
  if (!c || c.e !== w.holder) return '그 사이 ' + short_(w.s.date) + ' ' + slotLabel_(w.s) + ' 감독이 바뀌었습니다.';
  if (w.s2) {
    const c2 = cellAt_(ctx, w.s2);
    if (!c2 || c2.e !== w.actual) return '그 사이 ' + short_(w.s2.date) + ' ' + slotLabel_(w.s2) + ' 감독이 바뀌었습니다.';
  }
  const ex = w.s2 ? [w.s, w.s2] : [w.s];
  const b1 = busyOn_(ctx, w.actual, w.s.date, ex);
  if (b1) return w.actualName + ' 선생님은 ' + short_(w.s.date) + '에 이미 ' + b1 + '입니다.';
  if (w.s2) {
    const b2 = busyOn_(ctx, w.holder, w.s2.date, ex);
    if (b2) return w.holderName + ' 선생님은 ' + short_(w.s2.date) + '에 이미 ' + b2 + '입니다.';
  }
  return '';
}

function applySwap_(ctx, w, kind, lab) {
  setCell_(ctx, w.s, { name: w.actualName, email: w.actual }, kind, lab);
  if (w.s2) setCell_(ctx, w.s2, { name: w.holderName, email: w.holder }, kind, lab);
}

// 기한이 지난 대기 요청 → 만료. 바뀐 것이 있으면 true.
function expire_(ctx) {
  let n = 0;
  loadSwaps_(ctx).forEach(w => {
    if (w.status !== '대기' || !w.deadline || ctx.now <= w.deadline) return;
    w.status = '만료'; w.doneAt = ctx.now;
    touch_(ctx, SH.SWAP, w);
    n++;
    const what = short_(w.s.date) + ' ' + slotLabel_(w.s);
    if (w.kind === '사후 정정') {
      logAs_(ctx, '(자동)', '', '사후 정정 만료', what, w.holderName, w.actualName, '기한 ' + w.deadline + ' 지남');
      mail_(ctx, w.from, '지난 감독 정정 요청이 만료되었습니다 — ' + what, [
        what + ' 정정 요청(' + w.holderName + ' → ' + w.actualName + ')이 근무한 달이 지나 만료되었습니다.',
        '고쳐야 한다면 학년 기획 담당이나 관리자에게 정정을 요청해 주세요.'], { system: true });
    } else {
      logAs_(ctx, '(자동)', '', '교체 만료', what, w.holderName, w.actualName, '기한 ' + w.deadline + '까지 수락 없음');
      mail_(ctx, w.from, '감독 교체 요청이 만료되었습니다 — ' + what, [
        w.actualName + ' 선생님이 기한(' + w.deadline + ')까지 수락하지 않아 교체 요청이 취소되었습니다.',
        '감독은 그대로 ' + w.holderName + ' 선생님입니다.',
        '급하게 바꿔야 한다면 대신 서 주실 선생님이 앱에서 「다른 선생님 감독 맡기」(긴급 교체)로 등록할 수 있습니다.'],
        { system: true });
    }
  });
  return n > 0;
}

// 칸이 바뀐 뒤, 더는 이룰 수 없게 된 대기 요청을 저절로 취소한다.
function sweep_(ctx) {
  loadSwaps_(ctx).forEach(w => {
    if (w.status !== '대기') return;
    const why = checkSwap_(ctx, w);
    if (!why) return;
    w.status = '취소'; w.doneAt = ctx.now;
    touch_(ctx, SH.SWAP, w);
    const what = short_(w.s.date) + ' ' + slotLabel_(w.s);
    logAs_(ctx, '(자동)', '', w.kind === '사후 정정' ? '사후 정정 자동 취소' : '교체 자동 취소',
           what, w.holderName, w.actualName, why);
    mail_(ctx, [w.from, w.to], (w.kind === '사후 정정' ? '정정' : '교체') + ' 요청이 취소되었습니다 — ' + what,
          [what + ' 요청(' + w.holderName + ' → ' + w.actualName + ')이 저절로 취소되었습니다.', '까닭: ' + why],
          { system: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 저장 — 칸·표·이력·통합조회를 한꺼번에
// ─────────────────────────────────────────────────────────────────────────────

function commit_(ctx) {
  if (ctx._duty && ctx._duty.dirty) sweep_(ctx);
  saveDuty_(ctx);
  saveTables_(ctx);
  if (ctx.logs.length) { appendRows_(tab_(SH.LOG), ctx.logs, LOG_N); ctx.logs = []; }
  if (ctx.dirtyAll) { rebuildAll_(ctx); ctx.dirtyAll = false; }
  ctx.ready = ctx.ready.concat(ctx.queued);
  ctx.queued = [];
}

const LOG_N = 8;
const LOG_HEAD = ['시각', '종류', '대상', '이전', '이후', '한 사람', '비고', '이메일'];
function log_(ctx, kind, target, before, after, note) {
  logAs_(ctx, ctx.me.name, ctx.me.email, kind, target, before, after, note);
}
function logAs_(ctx, who, email, kind, target, before, after, note) {
  ctx.logs.push([ctx.now, kind, target, before || '', after || '', who, note || '', email || '']);
}

// ③ 통합조회 — 감독3(심야) 칸을 한 사람씩 풀고, 승인된 기타 업무를 더해 근무일 순으로.
// 통째로 다시 쓴다. 보는 사람은 '필터 보기' 로 월을 고르면 된다(맨 앞 칸이 월).
const ALL_N = 10;
const ALL_HEAD = ['월', '근무일', '이름', '부서', '구분', '예정 시간 (구간)', '사유', '근거', '처리', '처리 시각'];
function rebuildAll_(ctx) {
  const rows = [];
  const days = loadDuty_(ctx).days;
  Object.keys(days).forEach(d => {
    for (let g = 1; g <= 3; g++) {
      const c = days[d][idx_(g, 3)];
      if (!c.n) continue;
      const p = ctx.byEmail[c.e];
      const how = c.k && c.k !== '배정' ? ' (' + (c.lab || KIND_LABEL[c.k] || c.k) + ')' : '';
      rows.push([d.slice(0, 7), dateLabel_(d), c.n, p ? p.dept : '', g + '학년 감독3 (심야)', '—',
                 '심야자율학습 감독' + how, '배정', c.by + (c.k === '배정' && c.lab ? ' (' + c.lab + ')' : ''), c.at]);
    }
  });
  loadReqs_(ctx).forEach(q => {
    if (q.status !== '승인') return;
    rows.push([q.date.slice(0, 7), dateLabel_(q.date), q.name, q.dept, '기타 업무 · ' + q.type, q.band,
               q.reason, '승인', q.by, q.byAt]);
  });
  rows.sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : (a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0));
  const sh = tab_(SH.ALL);
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, ALL_N).clearContent();
  if (rows.length) {
    ensureRows_(sh, rows.length + 1);
    sh.getRange(2, 1, rows.length, ALL_N).setValues(rows.map(r => r.map(safe_)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 메일 — 학교 계정이 보낸다. 「설정」 의 메일 알림이 '켬' 일 때만 실제로 나간다.
// 자기가 한 일은 자기에게 보내지 않는다(접수 확인처럼 일부러 보내는 것만 self).
// ─────────────────────────────────────────────────────────────────────────────

function mail_(ctx, to, subject, lines, opt) {
  opt = opt || {};
  const list = [].concat(to || []).map(e => String(e || '').toLowerCase())
    .filter(e => e && e.endsWith('@' + SCHOOL_DOMAIN));
  const uniq = list.filter((e, i) => list.indexOf(e) === i && (opt.self || opt.system || e !== ctx.me.email));
  if (!uniq.length) return;
  ctx.queued.push({
    to: uniq.join(','),
    subject: '[초과근무] ' + subject,
    body: lines.filter(l => l != null && l !== '').join('\n') +
          '\n\n— 영남고 업무 앱 · 초과근무' + (ctx.cfg.appUrl ? '\n' + ctx.cfg.appUrl : '') +
          '\n(보내기 전용 메일입니다)',
  });
}
function sendMails_(ctx) {
  const list = ctx.ready;
  ctx.ready = [];
  if (!ctx.cfg.mailOn) return;
  list.forEach(m => {
    try { MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: '초과근무 관리' }); }
    catch (e) { console.error('메일 보내기 실패', m.to, e); }
  });
}
const approvers_ = ctx => ctx.lists.approve.emails;
const planners_  = (ctx, g) => (ctx.lists['g' + g] || { emails: [] }).emails;

// ─────────────────────────────────────────────────────────────────────────────
// 화면에 내려보내는 내 상태
// ─────────────────────────────────────────────────────────────────────────────

function swapView_(w) {
  return { id: w.id, kind: w.kind, mode: w.mode, date: w.s.date, label: slotLabel_(w.s), s: w.s, s2: w.s2,
           slot2Label: w.s2 ? slotLabel_(w.s2) : '', byName: w.byName, holderName: w.holderName,
           actualName: w.actualName, reason: w.reason, status: w.status, deadline: w.deadline,
           at: w.at, doneAt: w.doneAt };
}

function me_(ctx) {
  const me = ctx.me.email;
  const since = addDays_(ctx.today, -62);
  const requests = loadReqs_(ctx)
    .filter(q => q.email === me && (q.status === '대기' || q.date >= since))
    .sort((a, b) => (b.date + b.at < a.date + a.at ? -1 : 1))
    .slice(0, 40)
    .map(q => ({ id: q.id, at: q.at, date: q.date, band: q.band, type: q.type, reason: q.reason,
                 status: q.status, note: q.note, by: q.by, byAt: q.byAt }));
  const sw = loadSwaps_(ctx);
  const recentFrom = addDays_(ctx.today, -7);
  const mine = w => w.from === me || w.to === me || w.holder === me || w.actual === me;
  const out = {
    today: ctx.today, now: ctx.now, version: OT_VERSION,
    me: { name: ctx.me.name, dept: ctx.me.dept, id: ctx.me.id, inRoster: !!ctx.byEmail[me] },
    roles: ctx.role,
    cfg: { deadline: ctx.cfg.deadline, horizon: ctx.cfg.horizon, mailOn: ctx.cfg.mailOn,
           bands: BANDS, types: TYPES },
    requests: requests,
    slots: slotsOfEmail_(ctx, me, monthStart_(ctx.today), addDays_(ctx.today, 180)),
    inbox: sw.filter(w => w.status === '대기' && w.to === me).map(swapView_),
    outbox: sw.filter(w => w.status === '대기' && w.from === me).map(swapView_),
    recent: sw.filter(w => w.status !== '대기' && mine(w) && String(w.doneAt || w.at).slice(0, 10) >= recentFrom)
              .slice(-10).reverse().map(swapView_),
    staff: ctx.staff.map(p => ({ id: p.id, name: p.name, dept: p.dept })),
  };
  if (ctx.role.view) out.pendingCount = loadReqs_(ctx).filter(q => q.status === '대기').length;
  if (ctx.role.view || ctx.role.grades.length || ctx.role.operator) out.sheetUrl = book_().getUrl();
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 기타 업무 — 신청 · 취소 · 승인 · 반려
// ─────────────────────────────────────────────────────────────────────────────

function actSubmit_(ctx, b) {
  const date = ymdArg_(b.date);
  if (date < ctx.today) fail('지난 날짜는 신청할 수 없습니다.');
  if (date > addDays_(ctx.today, ctx.cfg.horizon)) fail(ctx.cfg.horizon + '일 뒤 근무일까지만 미리 신청할 수 있습니다.');
  if (BANDS.indexOf(b.band) < 0) fail('예정 시간 구간을 골라 주세요.');
  if (TYPES.indexOf(b.type) < 0) fail('유형을 골라 주세요.');
  const reason = text_(b.reason, 500);
  if (reason.length < 5) fail('사유를 업무분장 기준으로 구체적으로 적어 주세요 (다섯 글자 이상).');
  const reqs = loadReqs_(ctx);
  if (reqs.some(q => q.email === ctx.me.email && q.date === date && (q.status === '대기' || q.status === '승인')))
    fail('그날 낸 신청이 이미 있습니다. 바꾸려면 그 신청을 취소하고 다시 내 주세요.');
  const q = { id: nextId_(reqs, 'R'), at: ctx.now, date: date, name: ctx.me.name, dept: ctx.me.dept,
              band: b.band, type: b.type, reason: reason, status: '대기', note: date === ctx.today ? '당일 신청' : '',
              by: '', byAt: '', email: ctx.me.email, byEmail: '' };
  addItem_(ctx, SH.REQ, q);
  log_(ctx, '신청', '② ' + short_(date) + ' ' + q.name, '', '대기', q.band + ' · ' + q.type + (q.note ? ' · ' + q.note : ''));
  const lines = ['근무일: ' + dateLabel_(date) + (q.note ? ' (당일 신청)' : ''), '예정 시간: ' + q.band,
                 '유형: ' + q.type, '사유: ' + reason];
  mail_(ctx, approvers_(ctx), '새 신청 — ' + q.name + ' · ' + short_(date),
        [q.name + (q.dept ? ' (' + q.dept + ')' : '') + ' 선생님이 4시간 초과 근무를 신청했습니다.', ''].concat(lines,
        ['', '앱의 초과근무 화면에서 승인하거나 반려해 주세요.']));
  mail_(ctx, ctx.me.email, '신청을 받았습니다 — ' + short_(date),
        ['4시간 초과 근무 신청이 접수되었습니다. 승인되면 다시 알려 드립니다.', ''].concat(lines), { self: true });
  return { done: '신청했습니다. 승인되면 알려 드립니다.', state: me_(ctx) };
}

function actCancel_(ctx, b) {
  const q = loadReqs_(ctx).filter(x => x.id === b.id)[0];
  if (!q || q.email !== ctx.me.email) fail('내 신청에서 찾지 못했습니다.');
  if (q.status !== '대기' && q.status !== '승인') fail('이미 ' + q.status + ' 처리된 신청입니다.');
  if (q.date < ctx.today) fail('지난 근무일의 신청은 취소할 수 없습니다.');
  const prev = q.status;
  q.status = '취소';
  // 승인한 사람·시각은 지우지 않는다. 취소는 비고에 덧붙인다.
  q.note = (q.note ? q.note + ' · ' : '') + '본인 취소 ' + ctx.now.slice(5).replace('-', '.');
  touch_(ctx, SH.REQ, q);
  log_(ctx, '신청 취소', '② ' + short_(q.date) + ' ' + q.name, prev, '취소', '');
  if (prev === '승인') {
    ctx.dirtyAll = true;
    mail_(ctx, approvers_(ctx), '승인된 신청이 취소되었습니다 — ' + q.name + ' · ' + short_(q.date),
          [q.name + ' 선생님이 승인된 4시간 초과 근무 신청을 취소했습니다.', '근무일: ' + dateLabel_(q.date),
           '예정 시간: ' + q.band]);
  }
  return { done: '신청을 취소했습니다.', state: me_(ctx) };
}

function adminView_(ctx, q) {
  return { id: q.id, at: q.at, date: q.date, name: q.name, dept: q.dept, band: q.band, type: q.type,
           reason: q.reason, status: q.status, note: q.note, by: q.by, byAt: q.byAt,
           sameDay: q.at.slice(0, 10) === q.date, self: q.email === ctx.me.email };
}

function actAdminList_(ctx, b) {
  if (!ctx.role.view) fail('관리자만 볼 수 있습니다.', 'FORBIDDEN');
  const ym = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? b.month : ctx.today.slice(0, 7);
  const reqs = loadReqs_(ctx);
  const pending = reqs.filter(q => q.status === '대기')
    .sort((a, b2) => (a.date + a.at < b2.date + b2.at ? -1 : 1)).map(q => adminView_(ctx, q));
  const decided = reqs.filter(q => q.status !== '대기' && q.date.slice(0, 7) === ym)
    .sort((a, b2) => (a.date + a.at < b2.date + b2.at ? -1 : 1)).map(q => adminView_(ctx, q));
  return { month: ym, pending: pending, decided: decided, summary: summary_(ctx, ym), canDecide: ctx.role.approve };
}

// 월 요약 — 승인·반려·대기, 심야 감독 수, 많이 한 사람, 긴급 교체 수
function summary_(ctx, ym) {
  const reqs = loadReqs_(ctx).filter(q => q.date.slice(0, 7) === ym);
  const count = st => reqs.filter(q => q.status === st).length;
  const per = {};
  const bump = (key, name) => { per[key] = per[key] || { name: name, n: 0, night: 0, other: 0 }; per[key].n++; return per[key]; };
  reqs.forEach(q => { if (q.status === '승인') bump(q.email || q.name, q.name).other++; });
  let night = 0;
  const days = loadDuty_(ctx).days;
  Object.keys(days).forEach(d => {
    if (d.slice(0, 7) !== ym) return;
    for (let g = 1; g <= 3; g++) {
      const c = days[d][idx_(g, 3)];
      if (!c.n) continue;
      night++;
      bump(c.e || c.n, c.n).night++;
    }
  });
  const top = Object.keys(per).map(k => per[k]).sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1)).slice(0, 5);
  const emergency = loadSwaps_(ctx).filter(w => w.kind === '긴급 교체' && w.status === '완료' && w.s.date.slice(0, 7) === ym).length;
  return { approved: count('승인'), rejected: count('반려'), pending: count('대기'), cancelled: count('취소'),
           night: night, top: top, emergency: emergency };
}

// 한 건(id) 또는 여러 건(ids) — 여러 건은 승인만. 반려는 사유를 한 건씩 적는다.
// 여러 건 중 그 사이 다른 관리자가 처리한 것은 건너뛰고 몇 건인지 알려 준다.
function actDecide_(ctx, b) {
  if (!ctx.role.approve) fail('승인 권한이 없습니다.', 'FORBIDDEN');
  const ok = b.decision === '승인';
  if (!ok && b.decision !== '반려') fail('승인 또는 반려를 골라 주세요.');
  const many = Array.isArray(b.ids);
  const ids = many ? b.ids.slice(0, 100).map(String) : [String(b.id || '')];
  if (!ids.length) fail('승인할 신청을 골라 주세요.');
  if (!ok && ids.length > 1) fail('반려는 한 건씩 사유를 적어 주세요.');
  const reqs = loadReqs_(ctx);
  const targets = ids.map(id => reqs.filter(x => x.id === id)[0]);
  if (targets.some(q => !q)) fail('신청을 찾지 못했습니다.');
  const todo = targets.filter(q => q.status === '대기');
  if (!todo.length) fail(ids.length === 1 ? '이미 ' + targets[0].status + ' 처리된 신청입니다.' : '고른 신청이 모두 이미 처리되었습니다.');
  const reason = text_(b.reason, 300);
  if (!ok && reason.length < 2) fail('반려 사유를 적어 주세요. 신청한 분이 다시 낼 때 참고합니다.');
  todo.forEach(q => {
    q.status = ok ? '승인' : '반려';
    if (!ok) q.note = (q.note ? q.note + ' · ' : '') + reason;
    q.by = ctx.me.name; q.byAt = ctx.now; q.byEmail = ctx.me.email;
    touch_(ctx, SH.REQ, q);
    const self = q.email === ctx.me.email;
    log_(ctx, q.status, '② ' + short_(q.date) + ' ' + q.name, '대기', q.status,
         (ok ? '' : '사유: ' + reason) + (self ? (ok ? '' : ' · ') + '본인 신청' : '') + (todo.length > 1 ? (self ? ' · ' : '') + todo.length + '건 한꺼번에' : ''));
    mail_(ctx, q.email, (ok ? '승인되었습니다' : '반려되었습니다') + ' — ' + short_(q.date), [
      dateLabel_(q.date) + ' 4시간 초과 근무 신청(' + q.band + ')이 ' + (ok ? '승인' : '반려') + '되었습니다.',
      ok ? '나이스에는 평소처럼 입력하시면 됩니다.' : '반려 사유: ' + reason,
      ok ? '' : '필요하면 사유를 보완해 다시 신청해 주세요.']);
  });
  if (ok) ctx.dirtyAll = true;
  const skipped = targets.length - todo.length;
  const done = todo.length === 1 && !many
    ? todo[0].name + ' 선생님 신청을 ' + todo[0].status + '했습니다.'
    : todo.length + '건을 승인했습니다.' + (skipped ? ' (' + skipped + '건은 그 사이 처리되어 건너뜀)' : '');
  return Object.assign({ done: done }, actAdminList_(ctx, b));
}

// ─────────────────────────────────────────────────────────────────────────────
// ① 감독 배정 — 학년 기획 담당이 엑셀에서 '날짜·감독1·감독2·감독3' 네 열을 복사해 붙인다.
// dryRun 이면 미리보기만. 이미 채워진 날짜는 덮지 않고 알려 준다.
// ─────────────────────────────────────────────────────────────────────────────

function actAssign_(ctx, b) {
  const g = parseInt(b.grade, 10);
  if (ctx.role.grades.indexOf(g) < 0) fail(g + '학년 감독을 배정할 권한이 없습니다.', 'FORBIDDEN');
  const rows = parsePaste_(b.text, ctx.today);
  if (!rows.length) fail('붙여 넣은 줄이 없습니다.');
  const seen = {};
  const days = loadDuty_(ctx).days;
  rows.forEach(row => {
    row.bad = ['', '', ''];
    row.people = [null, null, null];
    if (row.err) return;
    if (seen[row.date]) { row.err = '같은 날짜가 두 번 있습니다'; return; }
    seen[row.date] = 1;
    // 이미 채워진 날짜는 덮지 않고 건너뛴다. 건너뛸 줄의 이름은 따지지 않는다.
    const day = days[row.date];
    const cur = day ? [1, 2, 3].map(r => day[idx_(g, r)].n) : ['', '', ''];
    if (cur.some(Boolean)) {
      row.state = cur.join('|') === row.names.join('|') ? 'same' : 'exists';
      row.current = cur;
      return;
    }
    row.names.forEach((nm, i) => {
      if (!nm) return;
      const hit = findByName_(ctx, nm);
      if (!hit.length) row.bad[i] = '명렬에 없음';
      else if (hit.length > 1) row.bad[i] = '동명이인';
      else row.people[i] = hit[0];
    });
    row.people.forEach((p, i) => {
      if (!p) return;
      if (row.people.some((q, j) => j !== i && q && q.email === p.email)) row.bad[i] = '같은 사람이 두 칸';
    });
    row.people.forEach((p, i) => {
      if (!p || row.bad[i]) return;
      const busy = busyOn_(ctx, p.email, row.date, []);
      if (busy) row.bad[i] = '그날 ' + busy;
    });
  });
  const isErr = r => !!r.err || r.bad.some(Boolean);
  const errors = rows.filter(isErr).length;
  const ready = rows.filter(r => !isErr(r) && !r.state);
  const view = rows.map(r => ({ line: r.line, raw: r.raw, date: r.date || '', names: r.names || [],
                                bad: r.bad, err: r.err || '', state: r.state || (isErr(r) ? 'error' : 'ok'),
                                current: r.current || null }));
  const out = { grade: g, preview: view, errors: errors, ready: ready.length,
                skipped: rows.filter(r => r.state).length };
  if (b.dryRun || errors || !ready.length) return Object.assign(out, { committed: false });

  ready.forEach(r => {
    [1, 2, 3].forEach(role => {
      const p = r.people[role - 1];
      if (p) setCell_(ctx, { date: r.date, g: g, r: role }, p, '배정', g + '학년 기획');
    });
    // 내력에 '누가 배정했는지' 를 남긴다. 칸의 by 는 setCell_ 이 내 이름으로 채운다.
    log_(ctx, '배정', short_(r.date) + ' ' + g + '학년', '', r.names.map(n => n || '—').join(' · '),
         g + '학년 배정 일괄 입력 ' + ready.length + '일');
  });
  return Object.assign(out, { committed: true, done: g + '학년 ' + ready.length + '일을 배정했습니다.' });
}

// 붙여 넣은 글 → [{line, raw, date, names[3], err}]
// 엑셀에서 복사하면 칸 사이가 탭이다. 빈 칸도 탭으로 남으므로 자리를 지킨다.
// 탭이 없으면(손으로 친 경우) 쉼표나 빈칸으로 나눈다.
function parsePaste_(text, today) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/ /g, ' ').replace(/\s+$/, ''));
  if (lines.filter(l => l.trim()).length > 200) fail('한 번에 200줄까지 넣을 수 있습니다.');
  const out = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let dateText, rest;
    if (line.indexOf('\t') >= 0) {
      const cells = line.split('\t');
      dateText = cells[0].trim();
      rest = cells.slice(1).map(s => s.trim());
      const d = readDate_(dateText, today, true);
      if (!d) { if (/감독|날짜|일자/.test(line)) return; out.push({ line: i + 1, raw: line, err: '날짜를 읽지 못했습니다' }); return; }
      while (rest.length > 3 && rest[rest.length - 1] === '') rest.pop();
      pushRow_(out, i + 1, line, d.ymd, rest);
    } else {
      const d = readDate_(line.trim(), today, false);
      if (!d) { if (/감독|날짜|일자/.test(line)) return; out.push({ line: i + 1, raw: line, err: '날짜를 읽지 못했습니다' }); return; }
      rest = line.trim().slice(d.len).split(/[\s,]+/).filter(Boolean);
      pushRow_(out, i + 1, line, d.ymd, rest);
    }
  });
  return out;
}
function pushRow_(out, line, raw, ymd, names) {
  if (names.length > 3) { out.push({ line: line, raw: raw, date: ymd, names: names.slice(0, 3), err: '감독이 세 칸보다 많습니다' }); return; }
  while (names.length < 3) names.push('');
  out.push({ line: line, raw: raw, date: ymd, names: names.map(s => String(s).replace(/\s+/g, '').slice(0, 20)) });
}

// '2026-10-06' · '2026. 10. 6.' · '10/06' · '10.6' · '10월 6일' · 끝에 '(화)' 가 붙어도 된다.
// 해가 없으면 오늘에서 가장 가까운 해로 본다(12월에 1월 표를 넣는 경우).
function readDate_(s, today, whole) {
  const tail = '\\s*(?:\\(?\\s*[월화수목금토일](?:요일)?\\s*\\)?)?';
  const pats = [
    /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\.?/,
    /^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\.?/,
  ];
  for (let k = 0; k < pats.length; k++) {
    const re = new RegExp(pats[k].source + tail + (whole ? '\\s*$' : '(?=\\s|,|$)'));
    const m = re.exec(s);
    if (!m) continue;
    let y, mo, d;
    if (k === 0) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      mo = +m[1]; d = +m[2];
      const ty = +today.slice(0, 4);
      let best = null;
      [ty - 1, ty, ty + 1].forEach(cy => {
        const c = cy + '-' + pad2_(mo) + '-' + pad2_(d);
        if (!validYmd_(c)) return;
        const dist = Math.abs(dayNum_(c) - dayNum_(today));
        if (!best || dist < best.dist) best = { ymd: c, dist: dist };
      });
      if (!best) return null;
      return { ymd: best.ymd, len: m[0].length };
    }
    const ymd = y + '-' + pad2_(mo) + '-' + pad2_(d);
    return validYmd_(ymd) ? { ymd: ymd, len: m[0].length } : null;
  }
  return null;
}

// 학년 기획 담당·관리자가 보는 한 달 감독표
// 한 달 감독표 — 감독 배정은 원래 모두 아는 내용이라 누구나 본다. 고치는 것(fixGrades)만 담당자·관리자.
function actGrid_(ctx, b) {
  const ym = /^\d{4}-\d{2}$/.test(String(b.month || '')) ? b.month : ctx.today.slice(0, 7);
  const days = loadDuty_(ctx).days;
  const list = Object.keys(days).filter(d => d.slice(0, 7) === ym).sort().map(d => ({
    date: d,
    cells: days[d].map(c => ({ n: c.n, k: c.k, note: noteOf_(c), known: !c.n || !!c.e })),
  }));
  return { month: ym, days: list, fixGrades: ctx.role.approve ? [1, 2, 3] : ctx.role.grades };
}

// 담당자·관리자 정정 — 마지막 수단. 기한 없음, 사유 필수.
function actFix_(ctx, b) {
  const s = slotArg_(b.slot);
  if (!(ctx.role.approve || ctx.role.grades.indexOf(s.g) >= 0)) fail(s.g + '학년 감독을 정정할 권한이 없습니다.', 'FORBIDDEN');
  const reason = text_(b.reason, 300);
  if (reason.length < 2) fail('정정 사유를 적어 주세요.');
  const c = cellAt_(ctx, s) || { n: '', e: '' };
  let p = null;
  if (b.to) { p = personOf_(ctx, b.to); if (!p) fail('교원 명렬에서 찾지 못했습니다.'); }
  if ((p ? p.email : '') === (c.e || '') && (p ? p.name : '') === c.n) fail('바뀐 것이 없습니다.');
  if (p) {
    const busy = busyOn_(ctx, p.email, s.date, [s]);
    if (busy) fail(p.name + ' 선생님은 그날 이미 ' + busy + '입니다.');
  }
  const asPlanner = ctx.role.grades.indexOf(s.g) >= 0;
  const kindName = asPlanner ? '담당자 정정' : '관리자 정정';
  setCell_(ctx, s, p, '정정', kindName);
  const sw = loadSwaps_(ctx);
  const w = { id: nextId_(sw, 'S'), at: ctx.now, kind: '담당자 정정', mode: '정정', s: s, s2: null,
              byName: ctx.me.name, holderName: c.n || '(빈 칸)', actualName: p ? p.name : '(비움)',
              reason: reason, status: '완료', doneAt: ctx.now, deadline: '',
              from: ctx.me.email, to: '', holder: c.e || '', actual: p ? p.email : '' };
  addItem_(ctx, SH.SWAP, w);
  const what = short_(s.date) + ' ' + slotLabel_(s);
  log_(ctx, kindName, what, c.n || '—', p ? p.name : '(비움)', '사유: ' + reason);
  mail_(ctx, [c.e, p ? p.email : ''], '감독 정정 — ' + what, [
    ctx.me.name + ' 선생님(' + (asPlanner ? s.g + '학년 기획' : '관리자') + ')이 감독 기록을 고쳤습니다.',
    '칸: ' + what, '감독: ' + (c.n || '(빈 칸)') + ' → ' + (p ? p.name : '(비움)'), '사유: ' + reason]);
  return { done: '고쳤습니다 — ' + what, grid: actGrid_(ctx, { month: s.date.slice(0, 7) }) };
}

function actSlotsOf_(ctx, b) {
  const p = personOf_(ctx, b.id);
  if (!p) fail('교원 명렬에서 찾지 못했습니다.');
  return { who: { id: p.id, name: p.name, dept: p.dept },
           slots: slotsOfEmail_(ctx, p.email, monthStart_(ctx.today), addDays_(ctx.today, 180)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 감독 교체 — A 가 요청하고 B 가 수락하는 순간 바뀐다. 수락 기한은 근무일 당일 18:30.
// ─────────────────────────────────────────────────────────────────────────────

function actSwapRequest_(ctx, b) {
  const s = slotArg_(b.slot);
  if (s.date < ctx.today) fail('지난 날짜는 교체할 수 없습니다. 지난 감독 정정을 이용해 주세요.');
  const c = cellAt_(ctx, s);
  if (!c || c.e !== ctx.me.email) fail('내 감독 칸이 아닙니다.');
  const dl = s.date + ' ' + ctx.cfg.deadline;
  const p = personOf_(ctx, b.to);
  if (!p) fail('맡아 줄 선생님을 골라 주세요.');
  if (p.email === ctx.me.email) fail('다른 선생님을 골라 주세요.');
  const trade = b.mode === 'trade';
  let s2 = null;
  if (trade) {
    s2 = slotArg_(b.slot2);
    const c2 = cellAt_(ctx, s2);
    if (!c2 || c2.e !== p.email) fail(p.name + ' 선생님의 감독 칸이 아닙니다.');
    if (sameSlot_(s, s2)) fail('서로 다른 칸끼리 바꿀 수 있습니다.');
    if (s2.date < ctx.today) fail('지난 날짜 칸과는 바꿀 수 없습니다.');
  }
  const deadline = s2 && s2.date < s.date ? s2.date + ' ' + ctx.cfg.deadline : dl;
  if (ctx.now > deadline) fail('수락 기한(' + deadline.slice(11) + ')이 지났습니다. 대신 서 주실 선생님이 「다른 선생님 감독 맡기」로 등록해 주세요.');
  const sw = loadSwaps_(ctx);
  if (sw.some(w => w.status === '대기' && w.from === ctx.me.email && sameSlot_(w.s, s)))
    fail('이 칸으로 보낸 요청이 아직 기다리는 중입니다. 먼저 그 요청을 취소해 주세요.');
  const reason = text_(b.reason, 200);
  const w = { id: nextId_(sw, 'S'), at: ctx.now, kind: '교체', mode: trade ? '맞교환' : '대신 서기', s: s, s2: s2,
              byName: ctx.me.name, holderName: ctx.me.name, actualName: p.name, reason: reason, status: '대기',
              doneAt: '', deadline: deadline, from: ctx.me.email, to: p.email, holder: ctx.me.email, actual: p.email };
  const why = checkSwap_(ctx, w);
  if (why) fail(why);
  addItem_(ctx, SH.SWAP, w);
  const what = short_(s.date) + ' ' + slotLabel_(s);
  log_(ctx, '교체 요청', what, ctx.me.name, p.name,
       w.mode + (s2 ? ' · 맞교환 칸 ' + short_(s2.date) + ' ' + slotLabel_(s2) : '') + (reason ? ' · 사유: ' + reason : ''));
  mail_(ctx, p.email, '감독 교체 요청 — ' + what, [
    ctx.me.name + ' 선생님이 감독을 ' + (trade ? '맞바꾸자고' : '대신 서 달라고') + ' 요청했습니다.',
    '칸: ' + what,
    s2 ? '맞교환: 선생님의 칸(' + short_(s2.date) + ' ' + slotLabel_(s2) + ')은 ' + ctx.me.name + ' 선생님이 맡습니다.' : '',
    reason ? '사유: ' + reason : '',
    '수락 기한: ' + deadline + ' — 이때까지 수락하지 않으면 요청은 저절로 취소됩니다.',
    '', '앱의 초과근무 화면에서 수락하거나 거절해 주세요.']);
  return { done: p.name + ' 선생님께 교체를 요청했습니다.', state: me_(ctx) };
}

// 받은 요청에 답하기 — 교체 수락·거절, 사후 정정 확인·거절
function actRespond_(ctx, b) {
  const w = loadSwaps_(ctx).filter(x => x.id === b.id)[0];
  if (!w || w.to !== ctx.me.email) fail('나에게 온 요청에서 찾지 못했습니다.');
  if (w.status !== '대기') fail('이미 ' + w.status + ' 처리된 요청입니다.');
  const corr = w.kind === '사후 정정';
  const what = short_(w.s.date) + ' ' + slotLabel_(w.s);
  if (b.accept !== true) {
    w.status = '거절'; w.doneAt = ctx.now;
    touch_(ctx, SH.SWAP, w);
    log_(ctx, corr ? '사후 정정 거절' : '교체 거절', what, w.holderName, w.actualName, '');
    mail_(ctx, w.from, (corr ? '정정 요청이 거절되었습니다' : '감독 교체가 거절되었습니다') + ' — ' + what, corr
      ? [ctx.me.name + ' 선생님이 ' + what + ' 정정 요청을 확인하지 않았습니다.', '기록은 그대로입니다. 고쳐야 한다면 학년 기획 담당이나 관리자에게 요청해 주세요.']
      : [ctx.me.name + ' 선생님이 ' + what + ' 교체 요청을 거절했습니다.', '감독은 그대로 ' + w.holderName + ' 선생님입니다. 다른 선생님께 다시 요청할 수 있습니다.']);
    return { done: '거절했습니다.', state: me_(ctx) };
  }
  const why = checkSwap_(ctx, w);
  if (why) {
    // 이룰 수 없는 요청은 여기서 닫는다. 실패로 돌려주되 취소는 저장한다.
    w.status = '취소'; w.doneAt = ctx.now;
    touch_(ctx, SH.SWAP, w);
    logAs_(ctx, '(자동)', '', corr ? '사후 정정 자동 취소' : '교체 자동 취소', what, w.holderName, w.actualName, why);
    mail_(ctx, w.from, (corr ? '정정' : '교체') + ' 요청이 취소되었습니다 — ' + what, [what + ' 요청이 저절로 취소되었습니다.', '까닭: ' + why], { system: true });
    return { ok: false, error: 'STALE', msg: why + ' 요청은 취소되었습니다.', state: me_(ctx) };
  }
  const sameDay = w.s.date === ctx.today || (w.s2 && w.s2.date === ctx.today);
  applySwap_(ctx, w, corr ? '사후 정정' : '교체', corr ? '' : (sameDay ? '교체 수락 · 당일' : ''));
  w.status = '완료'; w.doneAt = ctx.now;
  touch_(ctx, SH.SWAP, w);
  const both = w.s2 ? ' ↔ ' + short_(w.s2.date) + ' ' + slotLabel_(w.s2) : '';
  log_(ctx, corr ? '사후 정정' : (sameDay ? '교체 수락 (당일)' : '교체 수락'), what + both,
       w.holderName, w.actualName, corr ? '사유: ' + w.reason + ' · ' + w.byName + ' 요청 · ' + ctx.me.name + ' 확인' : '');
  const gs = [w.s.g].concat(w.s2 ? [w.s2.g] : []);
  const team = [].concat.apply([], gs.map(g => planners_(ctx, g)));
  const lines = corr
    ? ['지난 감독 기록을 고쳤습니다 (사후 정정).', '칸: ' + what, '기록: ' + w.holderName + ' → ' + w.actualName,
       '요청: ' + w.byName + ' · 확인: ' + ctx.me.name, '사유: ' + w.reason]
    : ['감독이 바뀌었습니다.', '칸: ' + what, '감독: ' + w.holderName + ' → ' + w.actualName,
       w.s2 ? '맞교환: ' + short_(w.s2.date) + ' ' + slotLabel_(w.s2) + ' 칸은 ' + w.holderName + ' 선생님이 맡습니다.' : ''];
  mail_(ctx, [w.from].concat(team, corr ? approvers_(ctx) : []),
        (corr ? '지난 감독 정정 완료' : '감독 교체 완료') + ' — ' + what, lines);
  return { done: corr ? '정정을 확인했습니다. 기록이 바뀌었습니다.' : '교체를 수락했습니다. 감독표가 바뀌었습니다.', state: me_(ctx) };
}

function actWithdraw_(ctx, b) {
  const w = loadSwaps_(ctx).filter(x => x.id === b.id)[0];
  if (!w || w.from !== ctx.me.email) fail('내가 보낸 요청에서 찾지 못했습니다.');
  if (w.status !== '대기') fail('이미 ' + w.status + ' 처리된 요청입니다.');
  w.status = '취소'; w.doneAt = ctx.now;
  touch_(ctx, SH.SWAP, w);
  const what = short_(w.s.date) + ' ' + slotLabel_(w.s);
  log_(ctx, w.kind === '사후 정정' ? '사후 정정 요청 취소' : '교체 요청 취소', what, w.holderName, w.actualName, '');
  mail_(ctx, w.to, (w.kind === '사후 정정' ? '정정' : '교체') + ' 요청이 취소되었습니다 — ' + what,
        [w.byName + ' 선생님이 요청을 거두었습니다. 따로 하실 일은 없습니다.', '칸: ' + what]);
  return { done: '요청을 취소했습니다.', state: me_(ctx) };
}

// 긴급 교체 — 못 나오는 사람(A)이 앱을 쓸 수 없을 때, 대신 서는 사람(B)이 등록하면 바로 바뀐다.
// A 본인 확인이 없으므로 맞교환은 같은 역할, A 가 비어 있는 날로만.
function actEmergency_(ctx, b) {
  const s = slotArg_(b.slot);
  if (s.date < ctx.today) fail('지난 날짜는 긴급 교체를 할 수 없습니다. 지난 감독 정정을 이용해 주세요.');
  const c = cellAt_(ctx, s);
  if (!c || !c.n) fail('그 칸에 배정된 감독이 없습니다.');
  if (c.e === ctx.me.email) fail('내 감독입니다. 다른 선생님께 교체를 요청해 주세요.');
  if (!c.e) fail('그 칸 감독의 계정을 알 수 없습니다. 학년 기획 담당에게 정정을 요청해 주세요.');
  const reason = text_(b.reason, 200);
  if (reason.length < 2) fail('긴급 교체 사유를 적어 주세요.');
  const trade = b.mode === 'trade';
  let s2 = null;
  if (trade) {
    s2 = slotArg_(b.mySlot);
    const c2 = cellAt_(ctx, s2);
    if (!c2 || c2.e !== ctx.me.email) fail('맞바꿀 내 감독 칸을 찾지 못했습니다.');
    if (s2.r !== s.r) fail('긴급 맞교환은 같은 역할끼리만 할 수 있습니다 (' + roleLabel_(s.r) + ').');
    if (s2.date <= ctx.today || s2.date === s.date) fail('맞교환은 내일 이후, 다른 날의 내 감독과만 할 수 있습니다.');
  }
  const sw = loadSwaps_(ctx);
  const w = { id: nextId_(sw, 'S'), at: ctx.now, kind: '긴급 교체', mode: trade ? '맞교환' : '대신 서기', s: s, s2: s2,
              byName: ctx.me.name, holderName: c.n, actualName: ctx.me.name, reason: reason, status: '완료',
              doneAt: ctx.now, deadline: '', from: ctx.me.email, to: '', holder: c.e, actual: ctx.me.email };
  const why = checkSwap_(ctx, w);
  if (why) fail(why);
  applySwap_(ctx, w, '긴급', '');
  addItem_(ctx, SH.SWAP, w);
  const what = short_(s.date) + ' ' + slotLabel_(s);
  const both = s2 ? ' ↔ ' + short_(s2.date) + ' ' + slotLabel_(s2) : '';
  log_(ctx, trade ? '긴급 맞교환' : '긴급 교체', what + both, c.n + (s2 ? ' / ' + ctx.me.name : ''),
       ctx.me.name + (s2 ? ' / ' + c.n : ''), '사유: ' + reason + ' · 본인 확인 없음');
  const gs = [s.g].concat(s2 ? [s2.g] : []);
  mail_(ctx, [c.e].concat([].concat.apply([], gs.map(g => planners_(ctx, g))), approvers_(ctx)),
        '긴급 교체 — ' + what, [
    ctx.me.name + ' 선생님이 ' + c.n + ' 선생님 대신 감독을 맡았습니다 (긴급 교체).',
    '칸: ' + what,
    s2 ? '맞교환: 대신 ' + short_(s2.date) + ' ' + slotLabel_(s2) + ' 칸은 ' + c.n + ' 선생님이 맡습니다.' : '',
    '사유: ' + reason,
    c.n + ' 선생님 본인 확인 없이 바로 반영되었습니다.' + (s2 ? ' 그 날짜가 어렵다면 앱에서 다시 교체를 요청해 주세요.' : '')]);
  return { done: '감독을 맡았습니다 — ' + what + '. ' + c.n + ' 선생님께 알림이 갑니다.', state: me_(ctx) };
}

// 사후 정정 — 구두로 바꾸고 등록을 잊은 경우. 근무한 달 말일까지, 둘 다 확인해야 바뀐다.
// 칸에 기록된 사람(A)이 요청하면 실제로 선 사람(B)을 고르고, B 가 요청하면 B 가 실제 사람이다.
function actCorrect_(ctx, b) {
  const s = slotArg_(b.slot);
  if (s.date >= ctx.today) fail('오늘과 이후 감독은 교체로 바꿔 주세요.');
  if (s.date.slice(0, 7) !== ctx.today.slice(0, 7))
    fail('근무한 달이 지나 직접 고칠 수 없습니다. 학년 기획 담당이나 관리자에게 정정을 요청해 주세요.');
  const c = cellAt_(ctx, s);
  if (!c || !c.n) fail('그 칸의 기록을 찾지 못했습니다.');
  if (!c.e) fail('그 칸 감독의 계정을 알 수 없습니다. 학년 기획 담당에게 정정을 요청해 주세요.');
  const reason = text_(b.reason, 200);
  if (reason.length < 2) fail('정정 사유를 적어 주세요 (예: 구두로 바꾸고 등록을 잊음).');
  let actual, other;
  if (c.e === ctx.me.email) {
    const p = personOf_(ctx, b.actual);
    if (!p) fail('실제로 선 선생님을 골라 주세요.');
    if (p.email === ctx.me.email) fail('다른 선생님을 골라 주세요.');
    actual = p; other = p;
  } else {
    actual = { email: ctx.me.email, name: ctx.me.name };
    other = { email: c.e, name: c.n };
  }
  const sw = loadSwaps_(ctx);
  if (sw.some(w => w.status === '대기' && w.kind === '사후 정정' && sameSlot_(w.s, s)))
    fail('이 칸의 정정 요청이 이미 확인을 기다리고 있습니다.');
  const w = { id: nextId_(sw, 'S'), at: ctx.now, kind: '사후 정정', mode: '정정', s: s, s2: null,
              byName: ctx.me.name, holderName: c.n, actualName: actual.name, reason: reason, status: '대기',
              doneAt: '', deadline: monthEnd_(s.date) + ' 23:59', from: ctx.me.email, to: other.email,
              holder: c.e, actual: actual.email };
  const why = checkSwap_(ctx, w);
  if (why) fail(why);
  addItem_(ctx, SH.SWAP, w);
  const what = short_(s.date) + ' ' + slotLabel_(s);
  log_(ctx, '사후 정정 요청', what, c.n, actual.name, '사유: ' + reason);
  mail_(ctx, other.email, '지난 감독 정정 확인 요청 — ' + what, [
    ctx.me.name + ' 선생님이 지난 감독 기록을 고쳐 달라고 요청했습니다.', '칸: ' + what,
    '기록: ' + c.n + ' → 실제: ' + actual.name, '사유: ' + reason,
    '확인 기한: ' + w.deadline + ' (근무한 달 말일)', '', '앱의 초과근무 화면에서 확인하거나 거절해 주세요.']);
  return { done: other.name + ' 선생님이 확인하면 기록이 바뀝니다.', state: me_(ctx) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 운영 — 설치 상태, 교원 명렬 보내기
// ─────────────────────────────────────────────────────────────────────────────

function actStatus_(ctx) {
  if (!(ctx.role.operator || ctx.role.approve)) fail('운영 담당만 볼 수 있습니다.', 'FORBIDDEN');
  const names = l => l.emails.map(e => (ctx.byEmail[e] ? ctx.byEmail[e].name : e));
  const L = ctx.lists;
  let trigger = false;
  try { trigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'tick'); } catch (e) { /* 권한 없음 */ }
  return { status: {
    version: OT_VERSION, sheetUrl: book_().getUrl(), staff: ctx.staff.length, mailOn: ctx.cfg.mailOn,
    deadline: ctx.cfg.deadline, horizon: ctx.cfg.horizon, appUrl: ctx.cfg.appUrl, trigger: trigger,
    lists: { approve: names(L.approve), view: names(L.view), g1: names(L.g1), g2: names(L.g2), g3: names(L.g3),
             operator: names(L.operator) },
    unresolved: [].concat(L.approve.bad, L.view.bad, L.g1.bad, L.g2.bad, L.g3.bad, L.operator.bad),
  } };
}

// 앱이 가진 교원 명렬(acl/emailByName + 교원연락망 부서)을 그대로 받아 「교원 명렬」 을 갈아 끼운다.
function actRoster_(ctx, b) {
  if (!ctx.role.operator) fail('운영 담당만 명렬을 보낼 수 있습니다.', 'FORBIDDEN');
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length < 10) fail('명렬이 너무 짧습니다 (' + rows.length + '명).');
  if (rows.length > 400) fail('명렬이 너무 깁니다 (' + rows.length + '명).');
  const seen = {};
  const out = [];
  rows.forEach(r => {
    const name = text_(r && r.name, 20).replace(/\s+/g, '');
    const dept = text_(r && r.dept, 30);
    const email = String((r && r.email) || '').trim().toLowerCase();
    if (!name || !/^[a-z0-9._-]+@/.test(email) || !email.endsWith('@' + SCHOOL_DOMAIN) || seen[email]) return;
    seen[email] = 1;
    out.push([name, dept, email]);
  });
  if (out.length < 10) fail('쓸 수 있는 줄이 너무 적습니다 (' + out.length + '명).');
  const sh = tab_(SH.STAFF);
  const old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, 3).clearContent();
  ensureRows_(sh, out.length + 1);
  sh.getRange(2, 1, out.length, 3).setValues(out.map(r => r.map(safe_)));
  log_(ctx, '명렬 갱신', SH.STAFF, old > 0 ? old + '명' : '—', out.length + '명', '앱의 교원 명렬에서 보냄');
  return { done: '교원 명렬 ' + out.length + '명을 시트에 넣었습니다.', count: out.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 시계 트리거 — 15분마다. 기한 지난 교체 요청을 닫고, 오후 4시에 한 번
// 내일까지 처리 안 된 신청을 관리자에게 알린다.
// ─────────────────────────────────────────────────────────────────────────────

function tick() {
  if (workerMode_()) return;                  // 워커의 시계가 대신 돈다
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  let ctx = null;
  try {
    ctx = ctx_({ email: '', gname: '(자동)' });
    expire_(ctx);
    remind_(ctx);
    commit_(ctx);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (ctx) sendMails_(ctx);
}

function remind_(ctx) {
  if (ctx.hour < 16) return;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('REMINDED') === ctx.today) return;
  props.setProperty('REMINDED', ctx.today);
  const tomorrow = addDays_(ctx.today, 1);
  const list = loadReqs_(ctx).filter(q => q.status === '대기' && q.date >= ctx.today && q.date <= tomorrow);
  if (!list.length) return;
  mail_(ctx, approvers_(ctx), '처리 안 된 신청 ' + list.length + '건 — 오늘·내일 근무', [
    '아직 승인·반려하지 않은 4시간 초과 근무 신청입니다.', ''].concat(
    list.map(q => '· ' + short_(q.date) + ' ' + q.name + (q.dept ? ' (' + q.dept + ')' : '') + ' — ' + q.band + ' · ' + q.type),
    ['', '앱의 초과근무 화면에서 처리해 주세요.']), { system: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 처음 한 번 — 탭 만들기, 잠그기, 시계 트리거. 학교 계정으로 편집기에서 실행한다.
// 다시 실행해도 된다(있는 탭과 설정 값은 그대로 두고 빠진 것만 채운다).
// ─────────────────────────────────────────────────────────────────────────────

const DUTY_HEAD = [
  ['근무일', '1학년', '', '', '2학년', '', '', '3학년', '', ''],
  ['', '감독1', '감독2', '감독3 (심야)', '감독1', '감독2', '감독3 (심야)', '감독1', '감독2', '감독3 (심야)'],
];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('관리대장 스프레드시트의 「확장 프로그램 → Apps Script」 로 연 편집기에서 실행해 주세요.');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  _book = ss;

  const specs = [
    { name: SH.DUTY,  head: DUTY_HEAD, widths: [118].concat(Array(9).fill(84)), freeze: [2, 1],
      note: '하루가 한 줄입니다. 칸 색: 노랑 교체 · 빨강 긴급 교체 · 파랑 사후 정정 · 보라 담당자 정정.\n' +
            '칸에 마우스를 올리면 누가 언제 바꿨는지 보입니다. 자세한 기록은 「변경 이력」.' },
    { name: SH.REQ,   head: [REQ_HEAD], widths: [62, 112, 118, 70, 90, 150, 110, 320, 56, 200, 70, 112, 160, 160],
      freeze: [1, 0], hide: [13, 14] },
    { name: SH.ALL,   head: [ALL_HEAD], widths: [64, 118, 70, 90, 150, 150, 320, 56, 140, 112], freeze: [1, 0],
      note: '감독3(심야)과 승인된 기타 업무를 근무일 순으로 모읍니다. 스크립트가 다시 만들므로 손대지 마세요.\n' +
            '월별로 보려면 「데이터 → 필터 보기 만들기」 로 맨 앞 칸(월)을 고르세요.' },
    { name: SH.SWAP,  head: [SWAP_HEAD], widths: [62, 112, 80, 70, 118, 120, 90, 80, 80, 170, 220, 56, 112, 112, 80],
      freeze: [1, 0], hide: [15] },
    { name: SH.LOG,   head: [LOG_HEAD], widths: [112, 110, 220, 120, 120, 90, 320, 160],
      freeze: [1, 0], hide: [8] },
    { name: SH.CFG,   head: [['항목', '값', '설명']], widths: [150, 260, 520], freeze: [1, 0] },
    { name: SH.STAFF, head: [['이름', '부서', '이메일']], widths: [90, 120, 220], freeze: [1, 0],
      note: '앱의 초과근무 화면(운영 담당)에서 「교원 명렬 보내기」 를 누르면 채워집니다. 손으로 넣어도 됩니다.' },
    { name: SH.DUTYX, head: DUTY_HEAD, widths: [118].concat(Array(9).fill(140)), freeze: [2, 1], hidden: true },
  ];

  specs.forEach((sp, i) => {
    let sh = ss.getSheetByName(sp.name);
    const fresh = !sh;
    if (fresh) sh = ss.insertSheet(sp.name, i);
    const cols = sp.head[0].length;
    if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
    sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@');
    sh.getRange(1, 1, sp.head.length, cols).setValues(sp.head).setFontWeight('bold').setBackground('#F1F5F9');
    if (fresh && (sp.name === SH.DUTY || sp.name === SH.DUTYX)) {
      sh.getRange('A1:A2').merge();
      sh.getRange('B1:D1').merge(); sh.getRange('E1:G1').merge(); sh.getRange('H1:J1').merge();
      sh.getRange(1, 1, 2, cols).setHorizontalAlignment('center');
    }
    sp.widths.forEach((w, c) => sh.setColumnWidth(c + 1, w));
    sh.setFrozenRows(sp.freeze[0]);
    sh.setFrozenColumns(sp.freeze[1]);
    (sp.hide || []).forEach(c => sh.hideColumns(c));
    if (sp.note) sh.getRange(1, 1).setNote(sp.note);
    if (sp.hidden) sh.hideSheet();
  });

  // 설정 — 빠진 항목만 채운다. 이미 적힌 값은 건드리지 않는다.
  const cfg = ss.getSheetByName(SH.CFG);
  const have = rows_(cfg, 1, 1).map(r => r[0]);
  const missing = CFG_ROWS.filter(r => have.indexOf(r[0]) < 0);
  if (missing.length) cfg.getRange(cfg.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  cfg.getRange(2, 3, Math.max(cfg.getLastRow() - 1, 1), 1).setFontColor('#64748B').setWrap(true);

  // 새 문서에 딸려 오는 빈 「시트1」 은 치운다
  ['시트1', 'Sheet1'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  // 워커가 쓰게 할 때 — 스크립트 속성 WORKER_EMAIL(서비스 계정 주소)을 편집자로 더한다
  const worker = workerEmail_();
  if (worker) ss.addEditor(worker);
  protectAll_(ss);
  installTriggers_();
  return worker
    ? '준비됐습니다. 워커(' + worker + ')가 시트를 쓰고, 이 스크립트는 메일만 보냅니다.'
    : '준비됐습니다. 「설정」 탭에 관리자·담당자를 적고, 웹앱으로 배포해 주세요.';
}

// 모든 탭을 잠근다. 문서 주인(이 학교 계정)만 고칠 수 있고 나머지는 보기만 한다.
// 주인은 구글 시트 구조상 잠금을 풀 수 있다 — 그래서 평소 업무에 쓰지 않는
// 교무 공용 계정이 주인인 것이 좋다.
function protectAll_(ss) {
  const me = Session.getEffectiveUser();
  const ours = Object.keys(SH).map(k => SH[k]);
  ss.getSheets().forEach(sh => {
    if (ours.indexOf(sh.getName()) < 0) return;
    let p = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)[0];
    if (!p) p = sh.protect();
    p.setDescription('초과근무 관리 — 스크립트만 씁니다. 바꿀 것은 앱에서 해 주세요.');
    p.addEditor(me);
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
    const worker = workerEmail_();
    if (worker) p.addEditor(worker);          // 잠금 안에서도 워커는 쓸 수 있게
  });
}

function workerEmail_() {
  const e = String(PropertiesService.getScriptProperties().getProperty('WORKER_EMAIL') || '').trim().toLowerCase();
  return /^[a-z0-9._-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(e) ? e : '';
}

// 워커가 시계를 맡으면 이 스크립트의 시계는 없앤다(둘이 같이 쓰지 않게)
function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  if (!workerMode_()) ScriptApp.newTrigger('tick').timeBased().everyMinutes(15).create();
}

// 편집기에서 손으로 돌리는 것 — 시트를 직접 고친 뒤 통합조회만 다시 만들 때
function rebuildNow() {
  const ctx = ctx_({ email: '', gname: '(자동)' });
  rebuildAll_(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// 작은 도구들 — 날짜는 'YYYY-MM-DD' 글자로 다룬다. 시간대를 타지 않게
// 날짜 셈은 UTC 정오 기준으로만 한다.
// ─────────────────────────────────────────────────────────────────────────────

const fmt_ = (d, p) => Utilities.formatDate(d, TZ, p);
const pad2_ = n => (n < 10 ? '0' : '') + n;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function validYmd_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const dayNum_ = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
function addDays_(s, n) {
  const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n, 12));
  return t.getUTCFullYear() + '-' + pad2_(t.getUTCMonth() + 1) + '-' + pad2_(t.getUTCDate());
}
const monthStart_ = s => s.slice(0, 8) + '01';
function monthEnd_(s) {
  const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0, 12));
  return s.slice(0, 8) + pad2_(t.getUTCDate());
}
const dow_ = s => DOW[new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12)).getUTCDay()];
const dateLabel_ = s => s + ' (' + dow_(s) + ')';
const short_ = s => s.slice(5, 7) + '.' + s.slice(8, 10) + ' (' + dow_(s) + ')';

function ymdArg_(v) {
  const s = String(v || '').trim();
  if (!validYmd_(s)) fail('날짜를 확인해 주세요.');
  return s;
}
function slotArg_(v) {
  const s = v || {};
  const g = parseInt(s.g, 10), r = parseInt(s.r, 10);
  if (!validYmd_(String(s.date || '')) || !(g >= 1 && g <= 3) || !(r >= 1 && r <= 3)) fail('감독 칸을 확인해 주세요.');
  return { date: String(s.date), g: g, r: r };
}
// 제어 문자를 빼고 자른다. 줄바꿈은 둔다(사유가 여러 줄일 수 있다).
const text_ = (v, max) => String(v == null ? '' : v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
function parseJson_(s) {
  if (!s || String(s).charAt(0) !== '{') return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

  if (__g && __g.now) now_ = __g.now;
  return { handle_, tick, ACTIONS, OT_VERSION, SH };
}
// ── Code.gs 끝 ──
const { ACTIONS, OT_VERSION, SH } = createOvertime(null);

// ─────────────────────────────────────────────────────────────────────────────
// 작은 도구
// ─────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlFromString = str => b64urlFromBytes(enc.encode(str));
function bytesFromB64(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Code.gs 는 Utilities.computeDigest 를 동기로 부른다(명렬 사람마다 번호를 만든다).
// 워커의 crypto.subtle 은 비동기라 SHA-256 을 직접 둔다.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(bytes) {
  const len = bytes.length, bitLen = len * 8;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000)); dv.setUint32(total - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

// 한국 시각으로 'yyyy-MM-dd HH:mm' 같은 글자. Code.gs 가 쓰는 꼴만.
function formatKst(d, tz, p) {
  const t = new Date(d.getTime() + 9 * 3600e3);
  const pad = n => String(n).padStart(2, '0');
  return p.replace(/yyyy|MM|dd|HH|H|mm/g, k => ({
    yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), H: String(t.getUTCHours()), mm: pad(t.getUTCMinutes()) })[k]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 서비스 계정 → 액세스 토큰 (시트 + Firestore). consult-api 와 같은 방법.
// ─────────────────────────────────────────────────────────────────────────────
let _saCache = null, _tokenCache = null;
function getSA(env) {
  if (_saCache) return _saCache;
  if (!env.SA_JSON) throw new Error('SA_JSON 시크릿이 설정되지 않았습니다.');
  const sa = JSON.parse(env.SA_JSON);
  if (!sa.private_key || !sa.client_email) throw new Error('SA_JSON 형식이 올바르지 않습니다.');
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const keyPromise = crypto.subtle.importKey('pkcs8', bytesFromB64(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  _saCache = { sa, keyPromise };
  return _saCache;
}
async function getAccessToken(env) {
  if (_tokenCache && _tokenCache.exp > nowSec() + 60) return _tokenCache.token;
  const { sa, keyPromise } = getSA(env);
  const iat = nowSec();
  const data = b64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlFromString(JSON.stringify({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/datastore' }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await keyPromise, enc.encode(data));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
          '&assertion=' + encodeURIComponent(data + '.' + b64urlFromBytes(new Uint8Array(sig))) });
  if (!res.ok) throw setupErr('TOKEN', '서비스 계정 토큰을 받지 못했습니다. SA_JSON 을 확인해 주세요.', await res.text());
  const j = await res.json();
  _tokenCache = { token: j.access_token, exp: iat + (j.expires_in || 3600) };
  return _tokenCache.token;
}
function setupErr(code, msg, detail) {
  const e = new Error(msg);
  e.code = code; e.userMsg = msg;
  if (detail) console.error(code, String(detail).slice(0, 300));
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// 로그인 토큰 확인 — Code.gs 의 verifyToken_ 은 UrlFetchApp 을 동기로 부른다.
// 워커가 먼저 구글에 물어 두고, 그 답을 UrlFetchApp 자리에 돌려준다.
// ─────────────────────────────────────────────────────────────────────────────
const _lookupCache = new Map();     // idToken → { code, text, exp }
async function lookupToken(env, tok) {
  if (typeof tok !== 'string' || tok.length < 20 || tok.length > 4096) return null;
  const hit = _lookupCache.get(tok);
  if (hit && hit.exp > nowSec()) return hit;
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + (env.FIREBASE_API_KEY || FIREBASE_WEB_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: tok }) });
  const out = { code: res.status, text: await res.text(), exp: nowSec() + 120 };
  if (_lookupCache.size > 300) _lookupCache.clear();
  if (res.ok) _lookupCache.set(tok, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 잠금 — Firestore 문서 locks/overtime 하나. 만들기에 성공한 쪽이 잡는다.
// 시간이 지난 잠금(잡은 워커가 죽음)은 그때의 updateTime 을 조건으로 지우고 다시 잡는다.
// ─────────────────────────────────────────────────────────────────────────────
function fsBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${getSA(env).sa.project_id}/databases/(default)/documents`;
}
async function acquireLock(env) {
  const token = await getAccessToken(env);
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const until = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < until) {
    const res = await fetch(fsBase(env) + '/locks?documentId=overtime', {
      method: 'POST', headers: H,
      body: JSON.stringify({ fields: { until: { integerValue: String(Date.now() + LOCK_TTL_MS) } } }) });
    if (res.ok) return (await res.json()).updateTime;
    if (res.status !== 409) throw setupErr('LOCK', '잠금을 잡지 못했습니다. 서비스 계정이 Firestore 를 쓸 수 있는지 확인해 주세요.', await res.text());
    const cur = await fetch(fsBase(env) + '/locks/overtime', { headers: H });
    if (cur.ok) {
      const d = await cur.json();
      if (+(d.fields && d.fields.until && d.fields.until.integerValue || 0) < Date.now()) {
        await fetch(fsBase(env) + '/locks/overtime?currentDocument.updateTime=' + encodeURIComponent(d.updateTime),
                    { method: 'DELETE', headers: H });
        continue;
      }
    }
    await sleep(120 + Math.floor(Math.random() * 80));
  }
  return null;
}
async function releaseLock(env, updateTime) {
  try {
    const token = await getAccessToken(env);
    await fetch(fsBase(env) + '/locks/overtime?currentDocument.updateTime=' + encodeURIComponent(updateTime),
                { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  } catch (e) { console.error('잠금 풀기 실패', e && e.message); }   // 못 풀어도 TTL 이 지나면 풀린다
}

// ─────────────────────────────────────────────────────────────────────────────
// 시트 — 한 번에 읽어 메모리에 펴 두고(Code.gs 가 SpreadsheetApp 인 줄 알고 쓴다),
// 바뀐 칸만 모아 batchUpdate 하나로 쓴다.
// ─────────────────────────────────────────────────────────────────────────────
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets/';
const quoteTab = t => "'" + String(t).replace(/'/g, "''") + "'";

async function sheetsFetch(env, path, opt) {
  const token = await getAccessToken(env);
  const res = await fetch(SHEETS_API + env.SHEET_ID + path, Object.assign({}, opt,
    { headers: Object.assign({ Authorization: 'Bearer ' + token }, (opt && opt.headers) || {}) }));
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 400 && /parse range/i.test(text))
    throw setupErr('SETUP', '관리대장 시트에 필요한 탭이 없습니다. 학교 계정 Apps Script 에서 setup 을 실행해 주세요.', text);
  if (res.status === 403 || res.status === 404)
    throw setupErr('SHEET', '워커가 관리대장 시트를 열지 못했습니다. 서비스 계정을 시트 편집자로 공유했는지, ' +
                   'Google Sheets API 를 켰는지, SHEET_ID 가 맞는지 확인해 주세요.', text);
  throw setupErr('SHEET', '시트를 읽거나 쓰지 못했습니다. 잠시 뒤 다시 해 주세요.', res.status + ' ' + text);
}

async function loadBook(env) {
  if (!env.SHEET_ID) throw setupErr('SETUP', 'SHEET_ID 가 설정되지 않았습니다.');
  // 변경 이력은 해가 갈수록 길어진다. 읽지 않고 끝에 붙이기만 한다(appendCells).
  // 탭 이름은 정해져 있으니 칸 크기(메타)와 값을 동시에 받는다 — 왕복 한 번 분량.
  const titles = Object.keys(SH).map(k => SH[k]).filter(t => t !== SH.LOG);
  const [meta, vals] = await Promise.all([
    sheetsFetch(env, '?fields=spreadsheetUrl,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))'),
    sheetsFetch(env, '/values:batchGet?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS&' +
                     titles.map(t => 'ranges=' + encodeURIComponent(quoteTab(t))).join('&')),
  ]);
  const book = new Book(meta.spreadsheetUrl, env.SHEET_ID);
  (meta.sheets || []).forEach(s => {
    const p = s.properties;
    const i = titles.indexOf(p.title);
    const rows = i >= 0 ? (((vals.valueRanges || [])[i] || {}).values || []) : [];
    book.add(new Sheet(book, p, rows, p.title === SH.LOG));
  });
  return book;
}

class Book {
  constructor(url, id) { this.url = url; this.id = id; this.sheets = []; }
  add(s) { this.sheets.push(s); }
  getSheetByName(n) { return this.sheets.find(s => s.title === n) || null; }
  getSheets() { return this.sheets.slice(); }
  getUrl() { return this.url; }
  getId() { return this.id; }
  // 바뀐 것 → batchUpdate 요청들. 줄 늘리기 → 칸 고치기 → 끝에 붙이기 순서.
  requests() {
    const out = [];
    this.sheets.forEach(s => { if (s.addRows) out.push({ appendDimension: { sheetId: s.sheetId, dimension: 'ROWS', length: s.addRows } }); });
    this.sheets.forEach(s => s.updateRequests().forEach(r => out.push(r)));
    this.sheets.forEach(s => {
      if (s.appended.length) out.push({ appendCells: { sheetId: s.sheetId, fields: 'userEnteredValue',
        rows: s.appended.map(r => ({ values: r.map(v => cellData({ v: v == null ? '' : String(v) })) })) } });
    });
    return out;
  }
}

function hexColor(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(h || ''));
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : null;
}
// 빈 글자는 값을 아예 안 보낸다(칸을 비운다). 글자는 stringValue 라 수식으로 읽히지 않는다.
function cellData(d) {
  const c = {};
  if ('v' in d && d.v !== '') c.userEnteredValue = { stringValue: d.v };
  if ('bg' in d && hexColor(d.bg)) c.userEnteredFormat = { backgroundColor: hexColor(d.bg) };
  if ('note' in d && d.note) c.note = d.note;
  return c;
}
const FIELD = { v: 'userEnteredValue', bg: 'userEnteredFormat.backgroundColor', note: 'note' };

class Sheet {
  constructor(book, p, rows, appendOnly) {
    this.book = book; this.title = p.title; this.sheetId = p.sheetId;
    this.maxRows = p.gridProperties.rowCount; this.maxCols = p.gridProperties.columnCount;
    this.rows = rows; this.appendOnly = appendOnly;
    this.dirty = new Map();     // 행 → (열 → { v?, bg?, note? })
    this.addRows = 0; this.appended = [];
    if (appendOnly) this.appendFast = rows2 => { rows2.forEach(r => this.appended.push(r)); };
  }
  getName() { return this.title; }
  getLastRow() {
    if (this.appendOnly) throw new Error(this.title + ' 은 끝에 붙이기만 합니다.');
    for (let r = this.rows.length; r > 0; r--) if ((this.rows[r - 1] || []).some(v => v !== '' && v != null)) return r;
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
      const col = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const c1 = col(m[1]), r1 = +m[2], c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  insertRowsAfter(after, n) { this.maxRows += n; this.addRows += n; return this; }
  get(r, c) { const row = this.rows && this.rows[r - 1]; const v = row ? row[c - 1] : ''; return v == null ? '' : String(v); }
  mark(r, c, field, val) {
    if (this.appendOnly) throw new Error(this.title + ' 은 끝에 붙이기만 합니다.');
    if (field === 'v') { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = val; }
    if (!this.dirty.has(r)) this.dirty.set(r, new Map());
    const cell = this.dirty.get(r).get(c) || {};
    cell[field] = val;
    this.dirty.get(r).set(c, cell);
  }
  // 바뀐 칸을 '같은 항목을 바꾼 이웃 칸' 끼리 묶는다. 한 줄 안에서 열이 이어지고,
  // 아래 줄도 같은 열·같은 항목이면 한 요청으로 합친다(①을 통째로 쓰면 요청 하나).
  updateRequests() {
    const runs = [];
    [...this.dirty.keys()].sort((a, b) => a - b).forEach(r => {
      const cols = this.dirty.get(r);
      const cs = [...cols.keys()].sort((a, b) => a - b);
      let run = null;
      cs.forEach(c => {
        const cell = cols.get(c);
        const fields = Object.keys(cell).sort().join(',');
        if (run && c === run.c2 + 1 && fields === run.fields) { run.c2 = c; run.cells.push(cell); }
        else { run = { r, c1: c, c2: c, fields, cells: [cell] }; runs.push(run); }
      });
    });
    const blocks = [];
    runs.forEach(x => {
      const last = blocks[blocks.length - 1];
      if (last && last.c1 === x.c1 && last.c2 === x.c2 && last.fields === x.fields && last.r2 + 1 === x.r) { last.r2 = x.r; last.rows.push(x.cells); }
      else blocks.push({ r1: x.r, r2: x.r, c1: x.c1, c2: x.c2, fields: x.fields, rows: [x.cells] });
    });
    return blocks.map(bk => ({ updateCells: {
      range: { sheetId: this.sheetId, startRowIndex: bk.r1 - 1, endRowIndex: bk.r2, startColumnIndex: bk.c1 - 1, endColumnIndex: bk.c2 },
      fields: bk.fields.split(',').map(f => FIELD[f]).join(','),
      rows: bk.rows.map(cells => ({ values: cells.map(cellData) })),
    } }));
  }
  getProtections() { return []; }
}

class Range {
  constructor(sh, row, col, nr, nc) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1 || row + nr - 1 > sh.maxRows || col + nc - 1 > sh.maxCols)
      throw new Error(`범위가 시트 밖입니다: ${sh.title} r${row} c${col} ${nr}x${nc}`);
    Object.assign(this, { sh, row, col, nr, nc });
  }
  grid(fn) { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => fn(this.row + i, this.col + j))); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.row + i, this.col + j, i, j); return this; }
  getDisplayValues() { return this.grid((r, c) => this.sh.get(r, c)); }
  getValues() { return this.getDisplayValues(); }
  check(v, what) {
    if (!Array.isArray(v) || v.length !== this.nr || v.some(r => !Array.isArray(r) || r.length !== this.nc))
      throw new Error(`${what} 크기가 범위(${this.nr}x${this.nc})와 다릅니다`);
  }
  setValues(v) { this.check(v, 'setValues'); return this.each((r, c, i, j) => this.sh.mark(r, c, 'v', v[i][j] == null ? '' : String(v[i][j]))); }
  setValue(v) { return this.setValues([[v]]); }
  setBackgrounds(v) { this.check(v, 'setBackgrounds'); return this.each((r, c, i, j) => this.sh.mark(r, c, 'bg', v[i][j] || null)); }
  setNotes(v) { this.check(v, 'setNotes'); return this.each((r, c, i, j) => this.sh.mark(r, c, 'note', v[i][j] || '')); }
  setBackground(bg) { return this.each((r, c) => this.sh.mark(r, c, 'bg', bg || null)); }
  setNote(n) { this.sh.mark(this.row, this.col, 'note', n || ''); return this; }
  clearContent() { return this.each((r, c) => this.sh.mark(r, c, 'v', '')); }
  setNumberFormat() { return this; }
}

// Code.gs 를 한 번 띄운다. 요청마다 새로 — 전역(_book 등)이 남지 않게.
function boot(book, { mails, lookup, props, now }) {
  const scriptCache = { get: () => null, put: () => {} };
  return createOvertime({
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book, flush() {}, ProtectionType: { SHEET: 'SHEET' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => scriptCache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push({ to: m.to, subject: m.subject, body: m.body }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => '' }) },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'tick' }] },     // 크론이 맡는다
    ContentService: { createTextOutput: s => ({ setMimeType() { return this; }, s }), MimeType: { JSON: 'json' } },
    Utilities: {
      formatDate: formatKst,
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, v) => Array.from(sha256(enc.encode(String(v))), b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: bytes => btoa(String.fromCharCode(...bytes.map(b => b & 255))).replace(/\+/g, '-').replace(/\//g, '_'),
    },
    now: now,
    UrlFetchApp: { fetch: (url, opt) => {
      const tok = JSON.parse(opt.payload).idToken;
      if (!lookup || lookup.tok !== tok) return { getResponseCode: () => 401, getContentText: () => '{}' };
      return { getResponseCode: () => lookup.code, getContentText: () => lookup.text };
    } },
  });
}

async function relayMails(env, mails) {
  if (!mails.length) return;
  if (!env.MAILER_URL || !env.MAIL_SECRET) { console.error('메일: MAILER_URL·MAIL_SECRET 이 없어 보내지 않음', mails.length); return; }
  for (let i = 0; i < mails.length; i += 50) {
    try {
      const res = await fetch(env.MAILER_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'mail', secret: env.MAIL_SECRET, mails: mails.slice(i, i + 50) }) });
      const j = await res.json().catch(() => null);
      if (!j || !j.ok) console.error('메일 중계 실패', res.status, j && j.error);
    } catch (e) { console.error('메일 중계 실패', e && e.message); }
  }
}

// 잠그고 → 읽고 → Code.gs → 쓰고 → 풀고 → 메일. 쓰기에 실패하면 메일도 안 보낸다.
async function runWrite(env, ctx, fn) {
  const lock = await acquireLock(env);
  if (!lock) return { ok: false, error: 'BUSY', msg: '다른 요청을 처리하는 중입니다. 잠시 뒤 다시 눌러 주세요.' };
  try {
    const book = await loadBook(env);
    const mails = [];
    const res = fn(book, mails);
    const reqs = book.requests();
    if (reqs.length) await sheetsFetch(env, ':batchUpdate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                               body: JSON.stringify({ requests: reqs }) });
    if (mails.length) ctx.waitUntil(relayMails(env, mails));
    return res;
  } finally {
    ctx.waitUntil(releaseLock(env, lock));
  }
}

// 검사에서만 시계를 붙잡는다. 배포 환경의 변수는 글자뿐이라 함수가 들어올 일이 없다.
const testNow = env => (typeof env.TEST_NOW === 'function' ? env.TEST_NOW : undefined);

// ─────────────────────────────────────────────────────────────────────────────
function corsHeaders(env, origin) {
  const norm = s => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const allow = String(env.ALLOWED_ORIGINS || '').split(',').map(norm).filter(Boolean);
  const ok = allow.includes(norm(origin));
  return { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
           'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
const json = (obj, cors) => new Response(JSON.stringify(obj), {
  status: 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env, request.headers.get('Origin') || '');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return json({ ok: true, service: 'overtime', version: OT_VERSION }, cors);
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD' }, cors);
    if (cors['Access-Control-Allow-Origin'] === 'null') return json({ ok: false, error: 'ORIGIN', msg: '허용되지 않은 곳에서 온 요청입니다.' }, cors);
    let b;
    try { const t = await request.text(); if (t.length > 200000) throw 0; b = JSON.parse(t) || {}; }
    catch (e) { return json({ ok: false, error: 'BAD_JSON', msg: '요청을 읽지 못했습니다.' }, cors); }
    if (b.action === 'ping') return json({ ok: true, version: OT_VERSION, via: 'worker' }, cors);
    if (b.action === 'mail' || !Object.prototype.hasOwnProperty.call(ACTIONS, b.action))
      return json({ ok: false, error: 'ACTION', msg: '알 수 없는 요청입니다.' }, cors);
    try {
      const lk = await lookupToken(env, b.idToken);
      if (!lk || lk.code !== 200) return json({ ok: false, error: 'AUTH', msg: '로그인을 확인하지 못했습니다. 앱을 새로 고친 뒤 다시 해 주세요.' }, cors);
      const lookup = { tok: b.idToken, code: lk.code, text: lk.text };
      if (READ_ONLY.has(b.action)) {
        // 보기만 — 잠그지 않고, Code.gs 가 기한 만료로 무언가 고쳐도 쓰지 않는다(크론·다음 쓰기가 한다)
        const book = await loadBook(env);
        return json(boot(book, { mails: [], lookup, props: {}, now: testNow(env) }).handle_(b), cors);
      }
      return json(await runWrite(env, ctx, (book, mails) => boot(book, { mails, lookup, props: {}, now: testNow(env) }).handle_(b)), cors);
    } catch (e) {
      if (e && e.userMsg) return json({ ok: false, error: e.code || 'SERVER', msg: e.userMsg }, cors);
      console.error('overtime', b.action, e && e.stack || e);
      return json({ ok: false, error: 'SERVER', msg: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.' }, cors);
    }
  },

  // 15분마다 기한 만료. 한국 오후 4시(UTC 07:00)에는 미처리 신청 알림도.
  async scheduled(event, env, ctx) {
    const daily = event.cron === DAILY_CRON;
    const now = testNow(env);
    const today = formatKst(now ? now() : new Date(), '', 'yyyy-MM-dd');
    await runWrite(env, ctx, (book, mails) => {
      boot(book, { mails, lookup: null, props: daily ? {} : { REMINDED: today }, now }).tick();
      return null;
    });
  },
};
