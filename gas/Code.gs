// Learn more about Web apps at https://developers.google.com/apps-script/guides/web

function doGet(e) {
  // ── 주간교육활동 AI 요약 트리거 ──
  if (e.parameter.action === 'triggerWeeklySummary') {
    return triggerWeeklySummary();
  }

  // ── 상벌점 저장 분기 ──
  if (e.parameter.action === 'savePoints') {
    return savePointsToSheet(e.parameter);
  }

  // ── 학사일정 읽기 분기 ──
  if (e.parameter.action === 'getSchedule') {
    return getSchedule();
  }

  // ── 학부모 상담 예약 분기 ──
  if (e.parameter.action === 'verifyParent')  return verifyParent_(e);
  if (e.parameter.action === 'getOpenSlots')  return getOpenSlots_(e);
  if (e.parameter.action === 'bookSlot')      return bookSlot_(e);
  if (e.parameter.action === 'getMyBooking')  return getMyBooking_(e);
  if (e.parameter.action === 'cancelBooking') return cancelBooking_(e);

  var url = e.parameter.url || 'https://sites.google.com/yeungnam.hs.kr/202633';

  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    }
  });

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

// ── 주간교육활동 AI 요약 트리거 ──
function triggerWeeklySummary() {
  var GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!GITHUB_TOKEN) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'GITHUB_TOKEN 스크립트 속성이 없습니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var OWNER = 'KyunghwanP';
  var REPO  = 'ynhs';
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
  var sumRes = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + OWNER + '/' + REPO + '/actions/workflows/summarize.yml/dispatches',
    { method: 'POST', headers: headers, payload: payload, muteHttpExceptions: true }
  );

  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      scrape:  scrapeRes.getResponseCode(),
      summary: sumRes.getResponseCode()
    }))
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
//  학부모 상담 예약 — 엔드포인트 (안전 모드: 학부모는 GAS만 경유)
//
//  스크립트 속성 필요: FIREBASE_PROJECT_ID, FIREBASE_SA_JSON
// ════════════════════════════════════════════════════════════════

// 한 자녀당 1건만 예약 허용
var ONE_BOOKING_PER_CHILD = true;


// ── 1) 학부모 인증 ──
function verifyParent_(e) {
  try {
    var grade = String(e.parameter.grade || '').trim();
    var room  = String(e.parameter.room  || '').trim();
    var name  = String(e.parameter.name  || '').trim().replace(/\s+/g, '');
    var birth = String(e.parameter.birth || '').trim();

    if (!grade || !room || !name || !birth) {
      return _cjson({ success: false, error: '입력값이 부족합니다.' });
    }

    var matched = _findStudent(grade, room, name, birth);
    if (!matched) {
      return _cjson({ success: false, error: '일치하는 자녀 정보를 찾을 수 없습니다.' });
    }

    var classKey = grade + '-' + String(parseInt(room, 10));
    var teacher  = _homeroomOf(classKey);
    var token    = _csha256(classKey + '|' + name + '|' + birth);

    return _cjson({
      success: true,
      classKey: classKey,
      teacher: teacher,
      token: token,
      studentName: String(matched.name || '').trim(),
      studentNum: String(matched.num || '').trim()
    });
  } catch (err) {
    return _cjson({ success: false, error: '서버 오류: ' + err.message });
  }
}


// ── 2) 빈 슬롯 조회 (남의 예약 정보는 내보내지 않음, 예약 여부만 표시) ──
function getOpenSlots_(e) {
  try {
    var classKey = String(e.parameter.classKey || '').trim();
    var token    = String(e.parameter.token || '').trim();
    if (!classKey || !token) return _cjson({ success: false, error: '잘못된 요청입니다.' });

    var slots = _readSlots(classKey);
    var today = _ctoday();

    var mine = null;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].status === 'booked' && slots[i].token === token) {
        mine = {
          id: slots[i].id, date: slots[i].date, time: slots[i].time,
          type: slots[i].type, duration: slots[i].duration,
          bookedType: slots[i].bookedType || slots[i].type || 'face',
          bookedName: slots[i].bookedName || ''
        };
        break;
      }
    }

    var open = [];
    for (var j = 0; j < slots.length; j++) {
      var s = slots[j];
      if (s.date < today) continue;
      if (s.status === 'booked' && s.token === token) continue; // 내 예약은 mine으로 따로 내려줌
      open.push({
        id: s.id, date: s.date, time: s.time, type: s.type, duration: s.duration,
        booked: s.status === 'booked'  // 다른 학부모의 예약 여부만 표시 (개인정보 없음)
      });
    }
    open.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });

    return _cjson({ success: true, mine: mine, slots: open, openAt: _readOpenAt(classKey) });
  } catch (err) {
    return _cjson({ success: false, error: '서버 오류: ' + err.message });
  }
}


// ── 3) 예약 ──
function bookSlot_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var classKey = String(e.parameter.classKey || '').trim();
    var token    = String(e.parameter.token || '').trim();
    var slotId   = String(e.parameter.slotId || '').trim();
    var bkName   = String(e.parameter.bkName || '').trim();
    var bkPhone  = String(e.parameter.bkPhone || '').trim();
    var bkMemo   = String(e.parameter.bkMemo || '').trim();
    var sName    = String(e.parameter.studentName || '').trim();
    var sNum     = String(e.parameter.studentNum || '').trim();
    var bkType   = String(e.parameter.bkType || '').trim();  // 학부모가 고른 상담 방식(face/phone)

    if (!classKey || !token || !slotId || !bkName || !bkPhone) {
      return _cjson({ success: false, error: '입력값이 부족합니다.' });
    }

    var slots = _readSlots(classKey);

    // ── 예약 오픈 시각 체크 (선착순) ──
    var _openAt = _readOpenAt(classKey);
    if (_openAt && Date.now() < new Date(_openAt).getTime()) {
      return _cjson({ success: false, error: 'NOT_OPEN', openAt: _openAt });
    }

    if (ONE_BOOKING_PER_CHILD) {
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].status === 'booked' && slots[i].token === token) {
          return _cjson({ success: false, error: 'ALREADY_BOOKED' });
        }
      }
    }

    var idx = -1;
    for (var j = 0; j < slots.length; j++) {
      if (slots[j].id === slotId) { idx = j; break; }
    }
    if (idx === -1)                     return _cjson({ success: false, error: 'GONE' });
    if (slots[idx].status === 'booked') return _cjson({ success: false, error: 'TAKEN' });

    slots[idx].status      = 'booked';
    slots[idx].token       = token;
    slots[idx].bookedName  = bkName;
    slots[idx].bookedPhone = bkPhone;
    slots[idx].bookedMemo  = bkMemo;
    slots[idx].studentName = sName;
    slots[idx].studentNum  = sNum;
    if (bkType) slots[idx].bookedType = bkType;  // 있으면 학부모 선택 방식 저장
    slots[idx].bookedAt    = new Date().toISOString();

    _writeSlots(classKey, slots);
    return _cjson({ success: true });
  } catch (err) {
    return _cjson({ success: false, error: '서버 오류: ' + err.message });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}


// ── 4) 내 예약 조회 ──
function getMyBooking_(e) {
  try {
    var classKey = String(e.parameter.classKey || '').trim();
    var token    = String(e.parameter.token || '').trim();
    if (!classKey || !token) return _cjson({ success: false, error: '잘못된 요청입니다.' });

    var slots = _readSlots(classKey);
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].status === 'booked' && slots[i].token === token) {
        return _cjson({ success: true, booking: {
          id: slots[i].id, date: slots[i].date, time: slots[i].time,
          type: slots[i].type, bookedName: slots[i].bookedName || ''
        }});
      }
    }
    return _cjson({ success: true, booking: null });
  } catch (err) {
    return _cjson({ success: false, error: '서버 오류: ' + err.message });
  }
}


// ── 5) 예약 취소 (본인 token만) ──
function cancelBooking_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var classKey = String(e.parameter.classKey || '').trim();
    var token    = String(e.parameter.token || '').trim();
    if (!classKey || !token) return _cjson({ success: false, error: '잘못된 요청입니다.' });

    var slots = _readSlots(classKey);
    var found = false;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].status === 'booked' && slots[i].token === token) {
        slots[i] = {
          id: slots[i].id, date: slots[i].date, time: slots[i].time,
          type: slots[i].type, duration: slots[i].duration, status: 'open'
        };
        found = true;
        break;
      }
    }
    if (!found) return _cjson({ success: false, error: 'NONE' });

    _writeSlots(classKey, slots);
    return _cjson({ success: true });
  } catch (err) {
    return _cjson({ success: false, error: '서버 오류: ' + err.message });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}


// ── 학생 명단 / 담임 조회 (Firestore: students/main, appdata/main) ──

// 명렬은 두 문서로 나뉘어 있다(upload.html 의 saveSplit).
//   students/main        — 학년·반·번호·이름
//   studentsContact/main — 생년월일·전화 (규칙은 막혀 있고 서비스 계정만 읽는다)
// 예전에는 students/main 의 s.birth 만 봤는데, 분리 후 그 필드가 사라져
// 모든 학부모가 인증에 실패했다. 워커(consult-api handleVerify)와 같은 방식으로 고친다.
// 두 배열은 길이·순서가 같고 grade/room/num 이 양쪽에 다 있다.
function _findStudent(grade, room, name, birth) {
  var students = _readDocArray('students/main', 'students');
  var contact  = _readDocArray('studentsContact/main', 'students');
  var birthOf = {};
  for (var c = 0; c < contact.length; c++) {
    var ct = contact[c];
    if (ct && ct.birth) {
      birthOf[parseInt(ct.grade, 10) + '-' + parseInt(ct.room, 10) + '-' + parseInt(ct.num, 10)]
        = _cnormBirth(ct.birth);
    }
  }
  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    var key = parseInt(s.grade, 10) + '-' + parseInt(s.room, 10) + '-' + parseInt(s.num, 10);
    // 되돌림(KEEP_CONTACT_IN_ROSTER=true)이면 명렬에도 남아 있으므로 그것도 본다
    var have = _cnormBirth(s.birth) || birthOf[key] || '';
    if (String(s.grade).trim() === grade
      && String(parseInt(s.room, 10)) === String(parseInt(room, 10))
      && String(s.name).trim().replace(/\s+/g, '') === name
      && have === birth) {
      return s;
    }
  }
  return null;
}

function _homeroomOf(classKey) {
  try {
    var teachers = _readDocArray('appdata/main', 'teachers');
    for (var i = 0; i < teachers.length; i++) {
      if (String(teachers[i].homeroom).trim() === classKey) {
        return String(teachers[i].name || '').trim();
      }
    }
    return '';
  } catch (e) { return ''; }
}

function _cnormBirth(v) {
  if (v == null) return '';
  var s = String(v).trim().replace(/[.\/]/g, '-');
  var p = s.split('-');
  if (p.length === 3) return p[0] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[2]).slice(-2);
  return s;
}

function _readDocArray(docPath, fieldName) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'arr_' + docPath + '_' + fieldName;
  var hit = cache.get(cacheKey);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) {}
  }

  var token = _cfsToken();
  var url = 'https://firestore.googleapis.com/v1/projects/' + _cprojectId()
          + '/databases/(default)/documents/' + docPath;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore 읽기 실패(' + docPath + '): ' + res.getResponseCode());
  }
  var doc = JSON.parse(res.getContentText());
  var out = [];
  if (doc.fields && doc.fields[fieldName] && doc.fields[fieldName].arrayValue) {
    var arr = doc.fields[fieldName].arrayValue.values || [];
    out = arr.map(function (v) {
      var f = (v.mapValue && v.mapValue.fields) || {};
      var o = {};
      Object.keys(f).forEach(function (k) { o[k] = _cFsVal(f[k]); });
      return o;
    });
  }
  try {
    var str = JSON.stringify(out);
    if (str.length < 95000) cache.put(cacheKey, str, 60);
  } catch (e) {}
  return out;
}


// ── Firestore REST 접근 (서비스계정 JWT) ──
function _cprojectId() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
}
function _cdocUrl(classKey) {
  return 'https://firestore.googleapis.com/v1/projects/' + _cprojectId()
       + '/databases/(default)/documents/consultations/' + encodeURIComponent(classKey);
}

// ── 예약 오픈 시각 읽기 (consultations/{classKey}.openAt) ──
function _readOpenAt(classKey) {
  try {
    var token = _cfsToken();
    var res = UrlFetchApp.fetch(_cdocUrl(classKey), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return '';
    var doc = JSON.parse(res.getContentText());
    return (doc.fields && doc.fields.openAt && doc.fields.openAt.stringValue) || '';
  } catch (e) { return ''; }
}

function _readSlots(classKey) {
  var token = _cfsToken();
  var res = UrlFetchApp.fetch(_cdocUrl(classKey), {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 404) return [];
  if (code !== 200) throw new Error('Firestore 읽기 실패: ' + code);
  var doc = JSON.parse(res.getContentText());
  return _cFsToSlots(doc);
}

function _writeSlots(classKey, slots) {
  var token = _cfsToken();
  var url = _cdocUrl(classKey) + '?updateMask.fieldPaths=slots&updateMask.fieldPaths=updatedAt';
  var body = {
    fields: {
      slots: _cSlotsToFs(slots),
      updatedAt: { stringValue: new Date().toISOString() }
    }
  };
  var res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Firestore 쓰기 실패: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

function _cFsToSlots(doc) {
  if (!doc.fields || !doc.fields.slots || !doc.fields.slots.arrayValue) return [];
  var arr = doc.fields.slots.arrayValue.values || [];
  return arr.map(function (v) {
    var f = v.mapValue.fields || {};
    var o = {};
    Object.keys(f).forEach(function (k) { o[k] = _cFsVal(f[k]); });
    return o;
  });
}

function _cSlotsToFs(slots) {
  return {
    arrayValue: {
      values: slots.map(function (s) {
        var fields = {};
        Object.keys(s).forEach(function (k) {
          var val = s[k];
          if (typeof val === 'number') fields[k] = { integerValue: String(val) };
          else                         fields[k] = { stringValue: String(val == null ? '' : val) };
        });
        return { mapValue: { fields: fields } };
      })
    }
  };
}

function _cFsVal(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue    !== undefined) return null;
  return '';
}

function _cfsToken() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('fs_token');
  if (hit) return hit;

  var saJson = PropertiesService.getScriptProperties().getProperty('FIREBASE_SA_JSON');
  if (!saJson) throw new Error('FIREBASE_SA_JSON 스크립트 속성이 없습니다.');
  var sa = JSON.parse(saJson);

  var now = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  var toSign = _cb64u(JSON.stringify(header)) + '.' + _cb64u(JSON.stringify(claim));
  var sig = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  var jwt = toSign + '.' + _cb64u(sig);

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('토큰 발급 실패: ' + res.getContentText());
  }
  var token = JSON.parse(res.getContentText()).access_token;
  cache.put('fs_token', token, 300);
  return token;
}

function _cb64u(data) {
  var bytes = (typeof data === 'string')
    ? Utilities.newBlob(data).getBytes()
    : data;
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function _csha256(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function _ctoday() {
  var d = new Date();
  var kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

function _cjson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
