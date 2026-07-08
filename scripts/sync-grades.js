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

async function readRange(range, sheetId = SHEET_ID) {
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
    + '/values/' + encodeURIComponent(range)
    + '?valueRenderOption=FORMATTED_VALUE';
  const res = await jwt.request({ url });
  return res.data.values || [];
}

const cell = (row, i) => String(row[i] ?? '').trim();

(async () => {
  console.log('📊 성적 시트 읽는 중...');
  const [mockRows, rosterRows] = await Promise.all([
    readRange('모의고사!A:AB'),
    readRange('학생 명렬!A:F')
  ]);
  console.log(`  모의고사 ${mockRows.length}행, 학생 명렬 ${rosterRows.length}행`);

  // ── 학생 명렬: 내신 등급 맵 (학년|반|번호|이름 → {gpa9, gpa5}) ──
  // 원본 GAS와 동일: F열 "a/b" → gpa9=a, gpa5=b, '/' 없으면 gpa9에 그대로
  const gpaMap = {};
  for (let i = 1; i < rosterRows.length; i++) {
    const r = rosterRows[i];
    const key = [cell(r,1), cell(r,2), cell(r,3), cell(r,4)].join('|');
    const raw = cell(r,5);
    if (!raw) continue;
    if (raw.includes('/')) {
      const p = raw.split('/');
      gpaMap[key] = { gpa9: p[0].trim(), gpa5: p[1].trim() };
    } else {
      gpaMap[key] = { gpa9: raw, gpa5: '-' };
    }
  }

  // ── 모의고사: 학생 트리 + 반별 성적 이력 ──
  // 열 배치(원본 GAS와 동일): B(1)시험명 D(3)학년 E(4)반 F(5)번호 G(6)이름
  //   H(7)백분위평균 I(8)평균등급 J(9)표점합 K-N(10~13)국어 O-R(14~17)수학
  //   S(18)영어 T(19)한국사 U-X(20~23)탐구1 Y-AB(24~27)탐구2
  const tree = {};
  const classes = {}; // "학년-반" → { 번호: { name, gpa9, gpa5, history } }
  let mockCount = 0;

  for (let i = 1; i < mockRows.length; i++) {
    const row = mockRows[i];
    const grade = cell(row,3), ban = cell(row,4), bun = cell(row,5), name = cell(row,6);
    if (!grade || !ban || !bun || !name) continue;

    (tree[grade] ??= {});
    (tree[grade][ban] ??= {});
    tree[grade][ban][bun] = name;

    const clsKey = grade + '-' + ban;
    (classes[clsKey] ??= {});
    if (!classes[clsKey][bun]) {
      const gpa = gpaMap[[grade, ban, bun, name].join('|')] || { gpa9: '-', gpa5: '-' };
      classes[clsKey][bun] = { name, gpa9: gpa.gpa9, gpa5: gpa.gpa5, history: [] };
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
  console.log(`  학생 트리 완성 — 반 ${classIds.length}개, 성적 ${mockCount}건`);

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

  console.log(`✅ gradesSusi 저장 완료 — ${susiData.length}행 / 청크 ${chunkCount}개 (${new Date().toISOString()})`);
  process.exit(0);
})().catch(e => {
  console.error('❌ 실패:', e.response?.data?.error?.message || e.message);
  process.exit(1);
});
