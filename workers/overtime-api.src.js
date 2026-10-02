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

/* @@CODE_GS@@ */

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
