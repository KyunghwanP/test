// 모의고사 성적 동기화 — GitHub Actions에서 매일 실행
// 진로진학부 성적 스프레드시트('모의고사', '학생 명렬' 탭)를 서비스 계정으로 읽어
// Firestore gradesMock 컬렉션에 저장. 앱의 성적조회 탭(grades.html)이 이 데이터를 읽는다.
//
// Firestore 구조:
//   gradesMock/index          → { t, tree: { 학년: { 반: { 번호: 이름 } } } }
//   gradesMock/{학년}-{반}    → { t, students: { 번호: { name, gpa9, gpa5, history: [...] } } }
//
// 사전 조건:
//   1) GCP 프로젝트(ynhs-7b5ba)에 Google Sheets API 활성화
//   2) 시트를 서비스 계정 이메일(client_email)에 뷰어로 공유
const admin = require('firebase-admin');
const { JWT } = require('google-auth-library');

const SHEET_ID = '1RIVq_WIPFyrbFtgqwJbzGpGXOizU1Qylf2C_Cd9IjLc';        // 모의고사·학생 명렬
const SUSI_SHEET_ID = '1uR9WAW60AcEQN_lRNMw8a-zCmAR08xtvd-Glel6HrCE';   // 졸업생 수시 합격 현황
const IPGYEOL_SHEET_ID = '1DQILv_vIxgtAO8pN6dXC0SV8tf5uyrBXzDG_08xjf9Y'; // 수시·정시 입결('수시'/'정시' 탭)

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

const jwt = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

// ── 성적 열람 권한(acl/gradeRoles) 동기화 ──
// firestore.rules가 이 문서를 get()으로 참조해 gradesMock 읽기를 제한한다.
//   managers: 전체 열람 — 교원연락망(contacts/main.staff)의 직위(role)가 교장·교감·부장인
//             교사 자동 포함 + grade-roles.json 추가 명단 + 관리자(항상)
//   homerooms: { 이메일: '학년-반' } — 담임은 자기 반 문서만 열람 (teachers.homeroom 자동)
// 이메일은 appdata/main.teachers에서 이름으로 해석(앱 로그인 시 자동 수집된 값).
const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';
async function syncGradeRoles() {
  const fs = require('fs');
  const path = require('path');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'grade-roles.json'), 'utf8'));
  const [appSnap, contactsSnap] = await Promise.all([
    db.doc('appdata/main').get(),
    db.doc('contacts/main').get()
  ]);
  const teachers = appSnap.exists ? (appSnap.data().teachers || []) : [];
  const staff = contactsSnap.exists ? (contactsSnap.data().staff || []) : [];
  const norm = s => String(s || '').replace(/\s/g, '');

  // 교원연락망 직위 기준 자동 명단 + JSON 추가 명단
  const autoNames = staff.filter(c => /교장|교감|부장/.test(c.role || '')).map(c => c.name);
  const wantNames = [...new Set([...autoNames, ...(cfg.managers || [])])];

  const managers = new Set([ADMIN_EMAIL]);
  wantNames.forEach(name => {
    const t = teachers.find(t => norm(t.name) === norm(name));
    if (t && t.email) managers.add(t.email);
    else console.warn(`  ⚠️ 전체열람 권한자 '${name}' 이메일 미수집 — 본인이 앱에 로그인하면 다음 동기화에 반영됩니다`);
  });

  const homerooms = {};
  teachers.forEach(t => {
    if (!t.homeroom || !t.email) return;
    // '2-03' 같은 표기도 gradesMock 문서 ID('2-3')와 맞도록 정규화
    homerooms[t.email] = String(t.homeroom).split('-').map(Number).join('-');
  });

  await db.doc('acl/gradeRoles').set({ t: Date.now(), managers: [...managers], homerooms });
  console.log(`✅ acl/gradeRoles 저장 — 전체열람 ${managers.size}명(직위 자동 ${autoNames.length}명), 담임 ${Object.keys(homerooms).length}명`);
}

async function readRange(range, sheetId = SHEET_ID) {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
    + '/values/' + encodeURIComponent(range)
    + '?valueRenderOption=FORMATTED_VALUE';
  const res = await jwt.request({ url });
  return res.data.values || [];
}

const cell = (row, i) => String(row[i] ?? '').trim();
// 학년·반·번호 정규화: '03'→'3', ' 2 '→'2' — 시트 탭마다 0패딩·공백이 달라도 같은 키가 되도록
const num = v => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isNaN(n) ? String(v ?? '').trim() : String(n); };
// 이름 정규화: 공백 제거 ('김 민준' ↔ '김민준')
const normName = s => String(s || '').replace(/\s/g, '');

(async () => {
  console.log('📊 성적 시트 읽는 중...');
  const [mockRows, rosterRows] = await Promise.all([
    readRange('모의고사!A:AB'),
    readRange('학생 명렬!A:F')
  ]);
  console.log(`  모의고사 ${mockRows.length}행, 학생 명렬 ${rosterRows.length}행`);

  // ── 학생 명렬: 내신 등급 맵 (학년|반|번호 → {name, gpa9, gpa5}) ──
  // 키는 정규화된 학년·반·번호만 사용 — 이름은 표기 차이('김 민준' vs '김민준')로
  // 매칭이 깨지지 않게 키에서 빼고, 모의고사 쪽 이름과 다르면 경고만 남긴다.
  // F열 "a/b" → a=5등급제, b=9등급제. 필드명은 원본 GAS 명명 그대로
  // (gpa9 필드 = 화면 '5등급제' 배지, gpa5 필드 = '9등급제' 배지 — 이름과 반대이니 주의).
  // '/' 없이 값이 하나면 9등급제 단일 값(3학년)으로 취급해 9등급제 배지에만 표시.
  const gpaMap = {};
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i];
    const grade = num(cell(r,1)), ban = num(cell(r,2)), bun = num(cell(r,3)), name = cell(r,4);
    if (!grade || !ban || !bun || !name) continue;
    const raw = cell(r,5);
    let gpa9 = '-', gpa5 = '-';
    if (raw.includes('/')) {
      const p = raw.split('/');
      gpa9 = p[0].trim() || '-'; gpa5 = p[1].trim() || '-';
    } else if (raw) {
      gpa5 = raw;
    }
    gpaMap[[grade, ban, bun].join('|')] = { name, gpa9, gpa5 };
  }

  // ── 학생 트리 + 반별 문서: 학생 명렬 기준으로 먼저 전원 등록 ──
  // 모의고사 미응시 학생도 내신은 앱에 보여야 하므로, 명렬의 모든 학생을
  // 빈 history로 시딩한 뒤 모의고사 행을 얹는다.
  const tree = {};
  const classes = {}; // "학년-반" → { 번호: { name, gpa9, gpa5, history } }
  Object.entries(gpaMap).forEach(([key, v]) => {
    const [grade, ban, bun] = key.split('|');
    (tree[grade] ??= {});
    (tree[grade][ban] ??= {});
    tree[grade][ban][bun] = v.name;
    ((classes[grade + '-' + ban] ??= {}))[bun] = { name: v.name, gpa9: v.gpa9, gpa5: v.gpa5, history: [] };
  });

  // ── 모의고사: 반별 성적 이력 ──
  // 열 배치(원본 GAS와 동일): B(1)시험명 D(3)학년 E(4)반 F(5)번호 G(6)이름
  //   H(7)백분위평균 I(8)평균등급 J(9)표점합 K-N(10~13)국어 O-R(14~17)수학
  //   S(18)영어 T(19)한국사 U-X(20~23)탐구1 Y-AB(24~27)탐구2
  let mockCount = 0, nameMismatch = 0;

  for (let i = 1; i < mockRows.length; i++) {
    const row = mockRows[i];
    const grade = num(cell(row,3)), ban = num(cell(row,4)), bun = num(cell(row,5)), name = cell(row,6);
    if (!grade || !ban || !bun || !name) continue;

    const clsKey = grade + '-' + ban;
    (classes[clsKey] ??= {});
    if (!classes[clsKey][bun]) {
      // 명렬에 없는 학생(전출 후 명렬 미갱신 등) — 모의고사 기록만으로 등록
      (tree[grade] ??= {});
      (tree[grade][ban] ??= {});
      tree[grade][ban][bun] = name;
      classes[clsKey][bun] = { name, gpa9: '-', gpa5: '-', history: [] };
    } else if (normName(classes[clsKey][bun].name) !== normName(name)) {
      // 번호는 같은데 이름이 다르면 두 탭의 번호가 어긋난 것 — 로그로 알림
      if (++nameMismatch <= 10) console.warn(`  ⚠️ ${clsKey}반 ${bun}번 이름 불일치: 명렬 '${classes[clsKey][bun].name}' vs 모의고사 '${name}' — 시트 확인 필요`);
    }
    classes[clsKey][bun].history.push({
      examDate: cell(row,1) || '-',
      avgP: cell(row,7),  avgG: cell(row,8),  sumSS: cell(row,9),
      kor:  { sub: cell(row,10), ss: cell(row,11), p: cell(row,12), g: cell(row,13) },
      math: { sub: cell(row,14), ss: cell(row,15), p: cell(row,16), g: cell(row,17) },
      eng: cell(row,18), hist: cell(row,19),
      tam1: { sub: cell(row,20), ss: cell(row,21), p: cell(row,22), g: cell(row,23) },
      tam2: { sub: cell(row,24), ss: cell(row,25), p: cell(row,26), g: cell(row,27) }
    });
    mockCount++;
  }

  const classIds = Object.keys(classes);
  const rosterCount = Object.keys(gpaMap).length;
  const gpaCount = Object.values(gpaMap).filter(v => v.gpa9 !== '-' || v.gpa5 !== '-').length;
  if (nameMismatch > 10) console.warn(`  ⚠️ 이름 불일치 총 ${nameMismatch}건 (상위 10건만 표시)`);
  console.log(`  학생 트리 완성 — 반 ${classIds.length}개, 명렬 ${rosterCount}명(내신 ${gpaCount}명), 모의고사 ${mockCount}건`);

  // ── Firestore 저장 (index + 반별 문서, 사라진 반 문서는 정리) ──
  const t = Date.now();
  const batch = db.batch();
  batch.set(db.doc('gradesMock/index'), { t, tree });
  classIds.forEach(id => {
    batch.set(db.doc('gradesMock/' + id), { t, students: classes[id] });
  });
  const existing = await db.collection('gradesMock').listDocuments();
  existing.forEach(ref => {
    if (ref.id !== 'index' && !classes[ref.id]) batch.delete(ref);
  });
  await batch.commit();

  console.log(`✅ gradesMock 저장 완료 — index + 반 ${classIds.length}개`);

  // ══════════════════════════════════════════
  // 졸업생 수시 합격 현황 → gradesSusi (청크 문서)
  // 원본 GAS getData()와 동일한 열 매핑. 수천 행이라 1MB 문서 제한을 피해
  // CHUNK행 단위로 쪼개 저장하고, 프런트(susi.html)가 전체 청크를 합쳐 사용.
  // ══════════════════════════════════════════
  console.log('🎓 졸업생 수시 시트 읽는 중...');
  const susiRows = await readRange('졸업생 수시!A:AA', SUSI_SHEET_ID);
  console.log(`  졸업생 수시 ${susiRows.length}행`);

  const susiData = [];
  for (let i = 1; i < susiRows.length; i++) {
    const r = susiRows[i];
    if (!cell(r,8) && !cell(r,5)) continue; // 대학교·이름 둘 다 없으면 빈 행
    susiData.push({
      year: cell(r,0),       // A: 졸업년도
      grade: cell(r,2),      // C: 학년
      class: cell(r,3),      // D: 반
      num: cell(r,4),        // E: 번호
      name: cell(r,5),       // F: 이름
      region: cell(r,7),     // H: 지역
      univ: cell(r,8),       // I: 대학교
      type: cell(r,10),      // K: 전형 유형
      detail: cell(r,12),    // M: 세부 유형
      field: cell(r,14),     // O: 계열
      unit: cell(r,15),      // P: 모집 단위
      count: cell(r,16),     // Q: 모집 인원
      score: cell(r,20),     // U: 내신 등급(일반)
      convScore: cell(r,22), // W: 대학 자체 환산 등급
      stage1: cell(r,23),    // X: 1단계
      final: cell(r,24),     // Y: 최종 단계
      failReason: cell(r,25),// Z: 불합격 사유
      rank: cell(r,26)       // AA: 최초 후보 순위
    });
  }

  const CHUNK = 700;
  const chunkCount = Math.max(1, Math.ceil(susiData.length / CHUNK));
  const susiBatch = db.batch();
  susiBatch.set(db.doc('gradesSusi/index'), { t, chunks: chunkCount, rows: susiData.length });
  for (let c = 0; c < chunkCount; c++) {
    susiBatch.set(db.doc('gradesSusi/chunk-' + c), { t, rows: susiData.slice(c * CHUNK, (c + 1) * CHUNK) });
  }
  const susiExisting = await db.collection('gradesSusi').listDocuments();
  susiExisting.forEach(ref => {
    const m = ref.id.match(/^chunk-(\d+)$/);
    if (m && Number(m[1]) >= chunkCount) susiBatch.delete(ref);
  });
  await susiBatch.commit();

  console.log(`✅ gradesSusi 저장 완료 — ${susiData.length}행 / 청크 ${chunkCount}개`);

  // ══════════════════════════════════════════
  // 수시·정시 입결 → gradesIpgyeol (프리픽스별 청크 문서)
  // 원본 GAS와 동일하게 시트 원본 배열을 그대로 전달 (헤더 행 포함, 필터링은 프런트 담당).
  // Firestore는 배열 안의 배열을 허용하지 않아 각 행을 {c:[...]}로 감싸 저장.
  // ══════════════════════════════════════════
  console.log('📝 수시·정시 입결 시트 읽는 중...');
  const [ipSusiRaw, ipJeongsiRaw] = await Promise.all([
    readRange('수시!A:I', IPGYEOL_SHEET_ID),
    readRange('정시!A:S', IPGYEOL_SHEET_ID)
  ]);
  console.log(`  수시 ${ipSusiRaw.length}행, 정시 ${ipJeongsiRaw.length}행`);

  const pad = (r, n) => { const a = r.slice(0, n); while (a.length < n) a.push(''); return a.map(v => v ?? ''); };
  const ipSusiRows = ipSusiRaw.map(r => pad(r, 9));
  // 정시: 원본 GAS getRegularSpreadsheetData와 동일한 열 재배치 [B,D,E,F,H,J,K,O,M,S]
  const ipJeongsiRows = ipJeongsiRaw.map(r => pad([r[1], r[3], r[4], r[5], r[7], r[9], r[10], r[14], r[12], r[18]], 10));

  const IP_CHUNK = 1500;
  const ops = [];
  function queueChunks(prefix, rows) {
    const n = Math.max(1, Math.ceil(rows.length / IP_CHUNK));
    ops.push({ set: 'gradesIpgyeol/' + prefix + '-index', data: { t, chunks: n, rows: rows.length } });
    for (let c = 0; c < n; c++) {
      ops.push({ set: 'gradesIpgyeol/' + prefix + '-chunk-' + c,
                 data: { t, rows: rows.slice(c * IP_CHUNK, (c + 1) * IP_CHUNK).map(a => ({ c: a })) } });
    }
    return n;
  }
  const nSusi = queueChunks('susi', ipSusiRows);
  const nJeongsi = queueChunks('jeongsi', ipJeongsiRows);

  const ipExisting = await db.collection('gradesIpgyeol').listDocuments();
  ipExisting.forEach(ref => {
    let m = ref.id.match(/^susi-chunk-(\d+)$/);
    if (m && Number(m[1]) >= nSusi) { ops.push({ delRef: ref }); return; }
    m = ref.id.match(/^jeongsi-chunk-(\d+)$/);
    if (m && Number(m[1]) >= nJeongsi) ops.push({ delRef: ref });
  });

  // Firestore 배치는 최대 500 작업 — 400개 단위로 나눠 커밋
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    ops.slice(i, i + 400).forEach(op => op.set ? b.set(db.doc(op.set), op.data) : b.delete(op.delRef));
    await b.commit();
  }

  console.log(`✅ gradesIpgyeol 저장 완료 — 수시 ${ipSusiRows.length}행/${nSusi}청크, 정시 ${ipJeongsiRows.length}행/${nJeongsi}청크 (${new Date().toISOString()})`);

  await syncGradeRoles();
  process.exit(0);
})().catch(e => {
  console.error('❌ 실패:', e.response?.data?.error?.message || e.message);
  process.exit(1);
});
