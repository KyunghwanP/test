// 초과근무 Apps Script(gas/overtime/Code.gs)를 구글 없이 돌리는 가짜 환경.
//
// 시트·메일·잠금·캐시·속성·트리거와 '로그인 토큰 확인(Identity Toolkit)' 을 흉내 낸다.
// 실제 구글이 하는 것 중 이 스크립트가 기대는 것만 옮겼다:
//   · 칸 범위가 시트 크기를 넘으면 예외 (실제로도 그렇다 — 줄을 늘리지 않고 쓰면 깨진다)
//   · setValues 의 크기가 범위와 다르면 예외
//   · =·+·-·@ 로 시작하는 글을 쓰면 시트는 수식으로 받는다 → 여기서는 formulas 에 적어 둔다
// overtime-gas.test.mjs(스크립트 단독)와 overtime-page.test.mjs(화면 → 스크립트)가 같이 쓴다.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export const CODE_PATH = new URL('../gas/overtime/Code.gs', import.meta.url);
export const OWNER = 'kyomu@yeungnam.hs.kr';

const colNum = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

class FakeRange {
  constructor(sh, row, col, nr, nc) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1 || row + nr - 1 > sh.maxRows || col + nc - 1 > sh.maxCols)
      throw new Error(`범위가 시트 밖입니다: ${sh.name} r${row} c${col} ${nr}x${nc} (최대 ${sh.maxRows}x${sh.maxCols})`);
    Object.assign(this, { sh, row, col, nr, nc });
  }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sh.cell(this.row + i, this.col + j, true), i, j); return this; }
  grid(fn) { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => fn(this.sh.cell(this.row + i, this.col + j)))); }
  getValues() { return this.grid(c => c ? c.v : ''); }
  getDisplayValues() { return this.grid(c => c ? String(c.v) : ''); }
  getNotes() { return this.grid(c => c ? c.note || '' : ''); }
  getBackgrounds() { return this.grid(c => c ? c.bg || null : null); }
  dims(v, what) {
    if (!Array.isArray(v) || v.length !== this.nr || v.some(r => !Array.isArray(r) || r.length !== this.nc))
      throw new Error(`${what} 크기가 범위(${this.nr}x${this.nc})와 다릅니다`);
  }
  setValues(v) {
    this.dims(v, 'setValues');
    return this.each((c, i, j) => {
      const s = v[i][j] == null ? '' : String(v[i][j]);
      if (/^[=+\-@]/.test(s)) this.sh.ss.formulas.push({ sheet: this.sh.name, value: s });
      c.v = s;
    });
  }
  setValue(v) { return this.setValues([[v]]); }
  setBackgrounds(v) { this.dims(v, 'setBackgrounds'); return this.each((c, i, j) => { c.bg = v[i][j]; }); }
  setNotes(v) { this.dims(v, 'setNotes'); return this.each((c, i, j) => { c.note = v[i][j] || ''; }); }
  setNote(s) { this.sh.cell(this.row, this.col, true).note = s; return this; }
  setBackground(bg) { return this.each(c => { c.bg = bg; }); }
  setNumberFormat(f) { this.sh.formats.push({ row: this.row, nr: this.nr, f }); return this; }
  clearContent() { return this.each(c => { c.v = ''; }); }
  merge() { this.sh.merges.push([this.row, this.col, this.nr, this.nc]); return this; }
  setFontWeight() { return this; }
  setHorizontalAlignment() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
}

class FakeProtection {
  constructor() { this.editors = [OWNER, 'someone@yeungnam.hs.kr']; this.domainEdit = true; this.description = ''; }
  setDescription(d) { this.description = d; return this; }
  addEditor(u) { const e = typeof u === 'string' ? u : u.getEmail(); if (!this.editors.includes(e)) this.editors.push(e); return this; }
  // 문서 주인은 빠지지 않는다(실제 시트도 그렇다)
  removeEditors(list) { const rm = list.map(u => typeof u === 'string' ? u : u.getEmail()); this.editors = this.editors.filter(e => e === OWNER || !rm.includes(e)); return this; }
  getEditors() { return this.editors.map(e => ({ getEmail: () => e, toString: () => e })); }
  canDomainEdit() { return this.domainEdit; }
  setDomainEdit(b) { this.domainEdit = b; return this; }
}

class FakeSheet {
  constructor(ss, name) {
    Object.assign(this, { ss, name, maxRows: 1000, maxCols: 26, cells: new Map(), hidden: false,
                          hiddenCols: new Set(), merges: [], formats: [], widths: {}, frozen: [0, 0], protection: null });
  }
  cell(r, c, make) {
    const k = r + ',' + c;
    if (!this.cells.has(k)) { if (!make) return null; this.cells.set(k, { v: '', note: '', bg: null }); }
    return this.cells.get(k);
  }
  getName() { return this.name; }
  getLastRow() { let m = 0; for (const [k, c] of this.cells) if (c.v !== '') m = Math.max(m, +k.split(',')[0]); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
      const c1 = colNum(m[1]), r1 = +m[2], c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
      return new FakeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  deleteColumns(c, n) { this.maxCols -= n; return this; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  setFrozenRows(n) { this.frozen[0] = n; return this; }
  setFrozenColumns(n) { this.frozen[1] = n; return this; }
  hideColumns(c) { this.hiddenCols.add(c); return this; }
  hideSheet() { this.hidden = true; return this; }
  protect() { this.protection = new FakeProtection(); return this.protection; }
  getProtections() { return this.protection ? [this.protection] : []; }
  // 검사용: 표시값 표
  table(head = 1) { const n = this.getLastRow() - head; return n > 0 ? this.getRange(head + 1, 1, n, this.maxCols).getDisplayValues() : []; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = [new FakeSheet(this, '시트1')]; this.formulas = []; }
  getId() { return 'SHEET-ID-1'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/SHEET-ID-1/edit'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name, i) { const s = new FakeSheet(this, name); this.sheets.splice(i == null ? this.sheets.length : i, 0, s); return s; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(s => s !== sh); }
}

// KST 로 날짜 글자를 만든다. 스크립트가 쓰는 꼴만: yyyy MM dd HH H mm
function formatDate(d, tz, p) {
  if (tz !== 'Asia/Seoul') throw new Error('시간대가 다릅니다: ' + tz);
  const t = new Date(d.getTime() + 9 * 3600e3);
  const pad = n => String(n).padStart(2, '0');
  return p.replace(/yyyy|MM|dd|HH|H|mm/g, k => ({
    yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), H: String(t.getUTCHours()), mm: pad(t.getUTCMinutes()) })[k]);
}

// people: { email: { displayName, emailVerified=true, disabled } }
export function makeGas({ people = {}, now = '2026-10-05T09:00:00+09:00' } = {}) {
  const ss = new FakeSpreadsheet();
  const mails = [], lookups = [], logs = [];
  const props = new Map(), cache = new Map();
  let triggers = [];
  let lockFree = true;
  let clock = new Date(now);

  const g = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, openById: id => (id === ss.getId() ? ss : null), flush() {},
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => { props.set(k, String(v)); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v); } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock() {} }) },
    MailApp: { sendEmail: m => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWNER, toString: () => OWNER }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => {
        const t = { fn, n, getHandlerFunction: () => fn }; triggers.push(t); return t; } }) }) }),
    },
    ContentService: { MimeType: { JSON: 'json' },
      createTextOutput: s => ({ s, mime: '', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.s; } }) },
    Utilities: {
      formatDate,
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, v) => [...crypto.createHash(alg).update(String(v), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
    // 토큰은 'tok:<이메일>' 꼴로 만든다. people 에 없는 이메일도 학교 계정이면 통과시킨다.
    UrlFetchApp: { fetch: (url, opt) => {
      lookups.push(url);
      if (!/^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?key=AIza/.test(url)) throw new Error('엉뚱한 주소: ' + url);
      const tok = JSON.parse(opt.payload).idToken;
      const m = /^tok:(.+)$/.exec(tok);
      if (!m) return { getResponseCode: () => 400, getContentText: () => '{"error":{"message":"INVALID_ID_TOKEN"}}' };
      const email = m[1];
      const p = people[email] || {};
      const user = { localId: 'uid-' + email, email, emailVerified: p.emailVerified !== false, displayName: p.displayName || '' };
      if (p.disabled) user.disabled = true;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ users: [user] }) };
    } },
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
  };
  const context = vm.createContext(g);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });
  // 스크립트의 시계를 붙잡는다 — now_ 는 함수 선언이라 바깥에서 바꿔 끼울 수 있다
  context.now_ = () => new Date(clock.getTime());
  // 한 번의 실행이 끝나면 스크립트의 전역(_book)은 사라진다. 실제처럼 매번 비운다.
  const reset = () => vm.runInContext('_book = null', context);

  const api = {
    ss, mails, lookups, props, cache, logs, context,
    get triggers() { return triggers; },
    sheet: n => ss.getSheetByName(n),
    setNow: iso => { clock = new Date(iso); },
    setLock: free => { lockFree = free; },
    run: src => vm.runInContext(src, context),
    setup: () => { reset(); return context.setup(); },
    tick: () => { reset(); return context.tick(); },
    post: body => { reset(); return JSON.parse(context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()); },
    call: (email, action, params = {}) => api.post(Object.assign({ action, idToken: email ? 'tok:' + email : '' }, params)),
    // 설정 칸 하나를 사람이 고치듯 바꾼다
    setCfg: (label, value) => {
      const sh = ss.getSheetByName('설정');
      for (let r = 2; r <= sh.getLastRow(); r++) if (sh.cell(r, 1) && sh.cell(r, 1).v === label) { sh.cell(r, 2, true).v = value; return; }
      throw new Error('설정 항목 없음: ' + label);
    },
  };
  return api;
}
