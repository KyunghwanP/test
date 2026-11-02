// Learn more about Web apps at https://developers.google.com/apps-script/guides/web
//
// ── 보안(2026-11) ──────────────────────────────────────────────────────────────
// 이 웹 앱은 「실행: 나 · 액세스: 모든 사용자」(로그인 없이)로 배포돼 있다 — GitHub 작업(학사일정·요약)이
// 로그인 없이 부르기 때문이다. 그래서 주소를 아는 누구나 부를 수 있다는 전제로 짠다:
//  · 쓰기(상벌점 저장)·비용이 드는 일(AI 요약 갱신)은 앱 로그인 토큰을 구글(Identity Toolkit)에 물어
//    학교 교사 계정인지 확인한다. 초과근무 스크립트(gas/overtime)와 같은 방법이다.
//    상벌점 저장은 예전 화면(토큰을 안 보냄)을 TOKEN_REQUIRED_FROM 전날까지만 받아 준다.
//  · 주간교육활동 가져오기(?url=)는 학교 구글 사이트 주소만 — 아무 주소나 대신 가져오는 「열린 중계기」가 되지 않게.
//    넘겨주기(리디렉션)도 저절로 따라가지 않고, 넘어갈 때마다 같은 검사를 한다.
//  · 학부모 상담 예약은 Cloudflare 워커(consult-api)로 옮겨 여기서는 받지 않는다(서비스 계정 코드도 뺐다).
// 새로 쓴 코드는 예전 실행 환경(Rhino)에서도 돌게 var·function 만 쓴다.
//
// 고친 뒤에는 「배포 관리 → (앱용 배포) 연필 → 버전: 새 버전 → 배포」 — 주소가 그대로다. 「새 배포」 를 만들지 않는다.

var FIREBASE_API_KEY = 'AIzaSyCrYCGksB-Nv8LNIv1kZc_a8d6bIL_5CvA';   // 앱(index.html)에 이미 공개된 웹 키 — 비밀이 아니다
var SCHOOL_DOMAIN = 'yeungnam.hs.kr';
var TOKEN_REQUIRED_FROM = '2026-11-16';   // 이날(한국 날짜)부터 토큰 없는 상벌점 저장은 거절 — 그 전에 모두 새 앱으로
var SITES_HOST = 'sites.google.com';
var SITES_PATH = '/yeungnam.hs.kr';       // 이 경로 아래만 가져온다
var SITES_DEFAULT = 'https://sites.google.com/yeungnam.hs.kr/202633';
var TRIGGER_GAP_MIN = 10;                 // AI 요약 갱신 — 이 간격(분) 안에 또 오면 거절
var TRIGGER_DAY_MAX = 8;                  //               하루 이만큼까지
var CONSULT_ACTIONS = { verifyParent: 1, getOpenSlots: 1, bookSlot: 1, getMyBooking: 1, cancelBooking: 1 };

function doGet(e) {
  var p = (e && e.parameter) || {};

  // ── 주간교육활동 AI 요약 트리거(교사 로그인 + 횟수 제한) ──
  if (p.action === 'triggerWeeklySummary') return triggerWeeklySummary(p);

  // ── 상벌점 저장 분기(교사 로그인 — 예전 화면은 TOKEN_REQUIRED_FROM 전까지) ──
  if (p.action === 'savePoints') {
    var why = savePointsGate_(p);
    if (why) return json_({ success: false, code: 'AUTH', error: why });   // 예전 화면은 「저장 실패: {error}」 로 보여 준다
    return savePointsToSheet(p);
  }

  // ── 학사일정 읽기 분기 ──
  if (p.action === 'getSchedule') {
    return getSchedule();
  }

  // ── 학부모 상담 예약 — 워커(consult-api)로 옮겼다 ──
  if (CONSULT_ACTIONS.hasOwnProperty(p.action)) {
    return json_({ success: false, error: 'MOVED', message: '상담 예약 주소가 바뀌었습니다. 학부모 화면을 새로 고쳐 주세요.' });
  }

  // ── 주간교육활동 가져오기(학교 구글 사이트만) ──
  return proxyWeekly_(p.url);
}

// 앱(새 판)은 로그인 확인값이 주소창·기록에 남지 않게 본문(POST, 폼)으로 보낸다.
// 폼 칸은 e.parameter 로 들어오므로 doGet 과 똑같이 처리한다(같은 검사를 거친다)
function doPost(e) {
  return doGet(e);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function todayKst_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

// ── 본인 확인 — 앱의 Firebase 로그인 토큰을 구글에 묻는다(초과근무 스크립트 verifyToken_ 과 같은 규칙) ──
// 학교 도메인 · 메일 확인됨 · 사용 중지 아님 · 학생(숫자 7자리) 계정 아님. 맞으면 이메일, 아니면 null.
function verifyToken_(tok) {
  if (typeof tok !== 'string' || tok.length < 20 || tok.length > 4096) return null;
  var cache = CacheService.getScriptCache();
  var key = 'tok:' + hash_(tok);
  var hit = cache.get(key);
  if (hit) return hit;
  var res;
  try {
    res = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY,
      { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ idToken: tok }), muteHttpExceptions: true });
  } catch (err) { return null; }
  if (res.getResponseCode() !== 200) return null;
  var u;
  try { u = (JSON.parse(res.getContentText()).users || [])[0]; } catch (err) { return null; }
  if (!u || u.emailVerified !== true || u.disabled === true) return null;
  var email = String(u.email || '').toLowerCase();
  var tail = '@' + SCHOOL_DOMAIN;
  if (email.length <= tail.length || email.slice(-tail.length) !== tail) return null;
  if (/^[0-9]{7}@/.test(email)) return null;              // 학생 계정
  cache.put(key, email, 300);
  return email;
}
function hash_(s) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

// 상벌점 저장을 받아도 되나 — 토큰이 있으면 반드시 맞아야 하고, 없으면 TOKEN_REQUIRED_FROM 전날까지만(예전 화면).
// 받으면 null, 아니면 화면에 보일 말.
function savePointsGate_(p) {
  if (p.idToken) return verifyToken_(p.idToken) ? null : '로그인을 확인하지 못했습니다. 앱을 새로 고친 뒤 다시 저장해 주세요.';
  if (todayKst_() >= TOKEN_REQUIRED_FROM) return '앱을 새로 고친 뒤 다시 저장해 주세요(예전 화면이라 로그인을 확인할 수 없습니다).';
  return null;
}

// ── 주간교육활동 가져오기 ──
// 주소를 쪼개 프로토콜(https)·호스트(sites.google.com)·경로(/yeungnam.hs.kr 아래)를 본다.
// 사용자 정보(@)·포트·'..' 조각·역슬래시·인코딩한 점과 빗금으로 다른 곳으로 빠져나가는 주소는 거절.
function sitesUrlOk_(u) {
  if (typeof u !== 'string' || !u || u.length > 2000) return false;
  var m = /^https:\/\/([^\/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(u);
  if (!m || m[1].toLowerCase() !== SITES_HOST) return false;
  var path = m[2] || '/';
  var dec;
  try { dec = decodeURIComponent(path); } catch (err) { return false; }
  if (dec.indexOf('\\') !== -1 || /[\u0000-\u001f\u007f]/.test(dec)) return false;
  if (/(^|\/)\.{1,2}(\/|$)/.test(dec)) return false;
  return dec === SITES_PATH || dec.indexOf(SITES_PATH + '/') === 0;
}
// 넘겨주기(3xx)는 손으로 따라간다 — 넘어갈 주소도 sitesUrlOk_ 를 지나야 한다. 네 번까지.
function fetchSites_(url) {
  for (var hop = 0; hop < 4; hop++) {
    if (!sitesUrlOk_(url)) throw new Error('학교 사이트(' + SITES_HOST + SITES_PATH + ') 주소가 아닙니다');
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    var code = res.getResponseCode();
    if (code < 300 || code >= 400) return res;
    var h = res.getHeaders() || {};
    var loc = String(h.Location || h.location || '');
    if (!loc) throw new Error('넘겨줄 주소가 없습니다(' + code + ')');
    // 같은 호스트 안의 경로('/…')만 앞에 붙인다. '//다른곳' 은 그대로 두어 위 검사에서 걸리게
    url = (loc.charAt(0) === '/' && loc.charAt(1) !== '/') ? 'https://' + SITES_HOST + loc : loc;
  }
  throw new Error('넘겨주기(리디렉션)가 너무 많습니다');
}

function proxyWeekly_(url) {
  var res;
  try {
    res = fetchSites_(url || SITES_DEFAULT);
  } catch (err) {
    // 앱·요약 스크립트는 짧은 답을 실패로 본다(앱 200자 · 요약 100자 미만)
    return ContentService.createTextOutput('ERROR: ' + err.message).setMimeType(ContentService.MimeType.TEXT);
  }

  var html = res.getContentText('UTF-8');

  var navSection = '===NAV===\n';
  var navMatches = html.match(/href="(https:\/\/sites\.google\.com\/yeungnam\.hs\.kr\/202633\/[^"]+)"/g) || [];
  var seen = {};
  navMatches.forEach(function(m) {
    var href = m.replace(/href="/,'').replace(/"$/,'');
    if (!seen[href]) { seen[href] = true; navSection += href + '\n'; }
  });
  navSection += '===CONTENT===\n';

  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  for (var level = 1; level <= 4; level++) {
    var hTag = 'h' + level;
    html = html.replace(
      new RegExp('<([a-z]+)[^>]+role="heading"[^>]+aria-level="' + level + '"[^>]*>([^<]*)<\\/\\1>', 'gi'),
      '<' + hTag + '>$2</' + hTag + '>'
    );
    html = html.replace(
      new RegExp('<([a-z]+)[^>]+aria-level="' + level + '"[^>]+role="heading"[^>]*>([^<]*)<\\/\\1>', 'gi'),
      '<' + hTag + '>$2</' + hTag + '>'
    );
  }

  var startIdx = -1;
  var h1Match = html.indexOf('<h1>');
  var h2Match = html.indexOf('<h2>');

  if (h1Match !== -1) startIdx = h1Match;
  else if (h2Match !== -1) startIdx = h2Match;
  else {
    var titleIdx = html.indexOf('주간 교육활동');
    if (titleIdx !== -1) {
      var tagBefore = html.lastIndexOf('<', titleIdx);
      startIdx = tagBefore > titleIdx - 300 ? tagBefore : titleIdx;
    }
  }
  if (startIdx === -1) startIdx = 0;

  var endIdx = html.indexOf('Report abuse');
  if (endIdx === -1) endIdx = html.length;

  var content = html.substring(startIdx, endIdx);

  content = content
    .replace(/\s+class="[^"]*"/g, '')
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/\s+jsname="[^"]*"/g, '')
    .replace(/\s+jscontroller="[^"]*"/g, '')
    .replace(/\s+jsshadow[^=]*="[^"]*"/g, '')
    .replace(/\s+jsrenderer="[^"]*"/g, '')
    .replace(/\s+jstcache="[^"]*"/g, '')
    .replace(/\s+data-[a-z][^=]*="[^"]*"/g, '')
    .replace(/\s+aria-[^=]+="[^"]*"/g, '')
    .replace(/\s+tabindex="[^"]*"/g, '')
    .replace(/\s+role="[^"]*"/g, '')
    .replace(/\s+target="[^"]*"/g, '');

  content = content.replace(/\s+style="([^"]*)"/g, function(match, s) {
    var safe = s.split(';').filter(function(p) {
      return /^\s*(color|font-size|font-weight|font-style|text-decoration|background-color)\s*:/i.test(p);
    }).join(';');
    return safe ? ' style="' + safe + '"' : '';
  });

  content = content
    .replace(/<c-wiz[^>]*>/gi, '<div>').replace(/<\/c-wiz>/gi, '</div>')
    .replace(/<google-icon[^>]*>[\s\S]*?<\/google-icon>/gi, '')
    .replace(/<img[^>]*>/gi, '');

  content = content.replace(/<a\s+(href="[^"]*")/g, '<a target="_blank" $1');

  return ContentService.createTextOutput(navSection + content)
    .setMimeType(ContentService.MimeType.TEXT);
}

// ── 주간교육활동 AI 요약 트리거 ── scrape → Summarize 워크플로를 연달아 실행(GITHUB_TOKEN).
// 부를 때마다 GitHub 작업 둘(Gemini 요약 포함)이 돌고 이 스크립트가 60초 붙잡힌다 — 아무나 되풀이해 부르면
// 요약 사용량·하루 실행 시간이 바닥나 주간업무·상벌점 저장까지 멈출 수 있다. 그래서 교사 로그인을 확인하고
// TRIGGER_GAP_MIN 분에 한 번 · 하루 TRIGGER_DAY_MAX 번까지만(2026-11). 지금 앱 화면에는 이 단추가 없다 —
// 급하면 GitHub → Actions 에서 scrape · Summarize 를 「Run workflow」 로 돌려도 된다.
function triggerWeeklySummary(p) {
  if (!verifyToken_(p && p.idToken)) return json_({ success: false, error: 'AUTH', message: '로그인을 확인하지 못했습니다. 앱을 새로 고친 뒤 다시 해 주세요.' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return json_({ success: false, error: 'BUSY', message: '다른 요청을 처리하는 중입니다. 잠시 뒤 다시 해 주세요.' });
  try {
    var props = PropertiesService.getScriptProperties();
    var now = new Date().getTime(), day = todayKst_();
    var last = Number(props.getProperty('WEEKLY_TRIGGER_AT') || 0);
    var cnt = props.getProperty('WEEKLY_TRIGGER_DAY') === day ? Number(props.getProperty('WEEKLY_TRIGGER_CNT') || 0) : 0;
    var wait = Math.ceil((last + TRIGGER_GAP_MIN * 60000 - now) / 60000);
    if (wait > 0) return json_({ success: false, error: 'TOO_SOON', message: '방금 갱신했습니다. ' + wait + '분 뒤에 다시 해 주세요.' });
    if (cnt >= TRIGGER_DAY_MAX) return json_({ success: false, error: 'DAY_LIMIT', message: '오늘은 더 갱신할 수 없습니다(하루 ' + TRIGGER_DAY_MAX + '번).' });
    props.setProperties({ WEEKLY_TRIGGER_AT: String(now), WEEKLY_TRIGGER_DAY: day, WEEKLY_TRIGGER_CNT: String(cnt + 1) });
  } finally {
    lock.releaseLock();
  }
  return dispatchWeeklySummary_();
}
function dispatchWeeklySummary_() {
  var GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!GITHUB_TOKEN) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'GITHUB_TOKEN 스크립트 속성이 없습니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var OWNER = 'KyunghwanP';
  // 스크래핑·요약 워크플로와 scripts/ 는 test 저장소에만 있다. ynhs 로 쏘면
  // 404 가 돌아온다(그동안 아래 success:true 에 가려 안 보였다).
  // 두 배포가 같은 Firebase 프로젝트(ynhs-7b5ba)를 보므로 한 곳에서만 돌리면 된다.
  var REPO  = 'test';
  var headers = {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
  var payload = JSON.stringify({ ref: 'main' });

  // 1. 스크래핑 실행
  var scrapeRes = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/actions/workflows/scrape.yml/dispatches',
    { method: 'POST', headers: headers, payload: payload, muteHttpExceptions: true }
  );

  // 2. 스크래핑 완료 대기 (60초)
  Utilities.sleep(60000);

  // 3. AI 요약 실행
  // 파일 이름은 대문자 S 다(Summarize.yml). GitHub 는 이 경로의 대소문자를
  // 가리므로 summarize.yml 로 쏘면 404 가 온다.
  var sumRes = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/actions/workflows/Summarize.yml/dispatches',
    { method: 'POST', headers: headers, payload: payload, muteHttpExceptions: true }
  );

  // 응답 코드를 실제로 본다. 전에는 success:true 를 박아 두어, 워크플로가 없어
  // 404 가 와도 성공으로 보였다 — 안 돌고 있다는 것을 알 길이 없었다.
  // dispatch 가 받아들여지면 204 다.
  var scrapeOk = (scrapeRes.getResponseCode() === 204);
  var sumOk    = (sumRes.getResponseCode() === 204);
  var out = {
    success: scrapeOk && sumOk,
    scrape:  scrapeRes.getResponseCode(),
    summary: sumRes.getResponseCode()
  };
  if (!scrapeOk) out.scrapeError = scrapeRes.getContentText().slice(0, 300);
  if (!sumOk)    out.summaryError = sumRes.getContentText().slice(0, 300);

  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 상벌점 저장 함수 ──
function savePointsToSheet(p) {
  try {
    var SHEET_ID = '1fJpTxEWEJHZ6Xg1dWjBB0G8w9Rf_Nev30UoJ8bDbXZk'; // 원본 시트
    var TAB_IDS = { '1': 264713345, '2': 1961222608, '3': 1732544816 };

    var tabId = TAB_IDS[String(p.grade)];
    if (!tabId) throw new Error('올바르지 않은 학년: ' + p.grade);

    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getSheetByTabId(ss, tabId);
    if (!sheet) throw new Error('시트를 찾을 수 없습니다');

    function getLastDataRow(col) {
      var data = sheet.getRange(2, col, 5000, 1).getValues();
      var last = 1;
      for (var i = data.length - 1; i >= 0; i--) {
        if (data[i][0] !== '' && data[i][0] !== null) {
          last = i + 2;
          break;
        }
      }
      return last;
    }

    var lastC = getLastDataRow(3);
    var lastD = getLastDataRow(4);
    var lastE = getLastDataRow(5);
    var targetRow = Math.max(lastC, lastD, lastE) + 1;

    var typeVal;
    if (p.type === '상점') typeVal = '상점활동';
    else if (p.type === '벌점') typeVal = '벌점';
    else if (p.type === '벌점감점') typeVal = '감점활동';
    else typeVal = p.type;

    sheet.getRange(targetRow, 3, 1, 8).setValues([[
      p.classNum,
      p.studentNum,
      p.name,
      typeVal,
      decodeURIComponent(p.detail || ''),
      p.date,
      Number(p.score),
      decodeURIComponent(p.teacher || '')
    ]]);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, row: targetRow }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── 탭 ID로 시트 찾기 ──
function getSheetByTabId(ss, tabId) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === tabId) return sheets[i];
  }
  return null;
}

// ── 학사일정 시트를 읽어 월별 JSON으로 반환 ──
// 반환 형식: { "2026-07": [{date, day, content}, ...], ... }
function getSchedule() {
  try {
    var SCHEDULE_SHEET_ID = '1dWQEv1xgl4AGillRWPfUkJAb0cM3ChLHEC0uiIwRpB4';
    var ss = SpreadsheetApp.openById(SCHEDULE_SHEET_ID);
    var sheets = ss.getSheets();

    var result = {}; // { '2026-07': [...] }

    for (var si = 0; si < sheets.length; si++) {
      var sheet = sheets[si];
      var sheetName = sheet.getName();

      // 시트명에서 월/연도 추출
      var monthMatch = sheetName.match(/(\d+)월/);
      if (!monthMatch) continue;
      var month = parseInt(monthMatch[1], 10);
      var yearMatch = sheetName.match(/(\d{4})/);
      var year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

      // A1:E50 읽기
      var lastRow = Math.min(sheet.getLastRow(), 50);
      if (lastRow < 1) continue;
      var values = sheet.getRange(1, 1, lastRow, 5).getValues();

      // ── 상황근무(E열)에 실제로 등장하는 이름을 먼저 모은다 ──
      // D열에 이름이 섞여 들어오는 것은 걸러내야 하지만, 이름을 '글자 모양'으로
      // 추측하면(한글 2~4글자) '추석'·'현충일'·'광복절' 같은 진짜 일정까지 같이
      // 버린다. 실제로 추석이 이 규칙에 걸려 사라지고 있었다.
      // 이름인지 아닌지는 모양이 아니라 '상황근무 칸에 실제로 나오는 사람인가'로
      // 판단한다. 명절 이름이 상황근무 칸에 적힐 일은 없다.
      var dutyNames = {};
      for (var di = 0; di < values.length; di++) {
        var duty = String(values[di][4] == null ? '' : values[di][4]).trim();
        if (duty) dutyNames['n_' + duty] = true;   // 'n_' 접두사: toString 같은 키와 충돌 방지
      }

      var curMonth = month;
      var eventsByMonth = {}; // { month: [events] }

      for (var ri = 0; ri < values.length; ri++) {
        var row = values[ri];
        var cellD = String(row[3] == null ? '' : row[3]).trim();

        // D열에 'X월 교육활동' 헤더가 나오면 파싱 월 변경
        var headerMatch = cellD.match(/^(\d+)월\s*교육활동/);
        if (headerMatch) {
          curMonth = parseInt(headerMatch[1], 10);
          continue;
        }

        // B열: 날짜
        var cellB = String(row[1] == null ? '' : row[1]).trim();
        var date = null;
        if (/^\d{1,2}$/.test(cellB) && parseInt(cellB, 10) >= 1 && parseInt(cellB, 10) <= 31) {
          date = parseInt(cellB, 10);
        }

        // C열: 요일
        var cellC = String(row[2] == null ? '' : row[2]).trim();
        var day = /^[월화수목금토일]$/.test(cellC) ? cellC : '';

        // D열: 교육활동 내용 (상황근무 이름으로 확인된 것만 제외)
        var evContent = '';
        if (cellD.length >= 2 && !/^[①②③ㆍ]/.test(cellD) && !dutyNames['n_' + cellD]) {
          evContent = cellD;
        }

        if (date && evContent) {
          var lastDay = new Date(year, curMonth, 0).getDate();
          if (date <= lastDay) {
            if (!eventsByMonth[curMonth]) eventsByMonth[curMonth] = [];
            eventsByMonth[curMonth].push({ date: date, day: day, content: evContent });
          }
        }
      }

      // 월별로 result에 병합 (중복 제거)
      for (var m in eventsByMonth) {
        var evs = eventsByMonth[m];
        if (evs.length === 0) continue;
        var key = year + '-' + ('0' + m).slice(-2);
        if (!result[key]) result[key] = [];
        var existing = {};
        for (var k = 0; k < result[key].length; k++) {
          existing[result[key][k].date + '-' + result[key][k].content] = true;
        }
        for (var j = 0; j < evs.length; j++) {
          var sig = evs[j].date + '-' + evs[j].content;
          if (!existing[sig]) result[key].push(evs[j]);
        }
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ════════════════════════════════════════════════════════════════
//  학부모 상담 예약 — Cloudflare 워커(workers/consult-api.js)로 옮겼다(2026-11).
//  여기 있던 인증·예약·취소 코드와 서비스 계정(Firestore) 코드는 뺐다 — doGet 이 MOVED 로 답한다.
//  스크립트 속성 FIREBASE_PROJECT_ID · FIREBASE_SA_JSON 은 이제 쓰지 않으니 지워도 된다.
// ════════════════════════════════════════════════════════════════
