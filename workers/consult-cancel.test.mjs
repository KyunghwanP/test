// 학부모 상담 취소(handleCancel)가 「지금 화면에 보이는 예약」을 취소하는지.
//
// 2026-10 지적: 예약 조회(findMine)는 오늘 이후 예약만 보는데, 취소는 날짜를 보지 않고
// 이름·번호가 같은 **첫 booked 슬롯**을 골랐다. 슬롯은 한 문서에 학기 내내 쌓이므로
// 1학기에 상담한 학생이 2학기 예약을 취소하면 **지난 예약이 취소되고 다가오는 예약은 그대로**
// 남았다(화면에는 「취소됨」). 이제 화면이 보고 있는 예약 id(slotId)를 함께 보내고,
// 서버는 그 칸이 세션의 학생 것인지 · 아직 지나지 않았는지 · 교사가 넣은 것이 아닌지 본다.
// slotId 가 없는 예전 화면은 조회와 같은 기준(오늘 이후)으로만 고른다.
//
// 실제 handleCancel · findMine · todayKst 를 워커 소스에서 떼어 오고 Firestore 만 스텁으로 물린다.
// 이름은 지어낸 것이다.
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const worker = fs.readFileSync(path.join(here, 'consult-api.js'), 'utf8');
const parentHtml = fs.readFileSync(path.join(here, '..', 'parent.html'), 'utf8');
const grabJs = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(worker);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = worker.indexOf('{', m.index), d = 0;
  for (let j = i; j < worker.length; j++) {
    if (worker[j] === '{') d++;
    else if (worker[j] === '}' && --d === 0) return worker.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// 오늘 = 2026-10-31(KST). 워커는 Date.now() 로 오늘을 정한다
const NOW = Date.parse('2026-10-31T09:00:00+09:00');
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW])); }
  static now() { return NOW; }
};

// 세션의 학생 — 1학년 3반 7번(지어낸 이름)
const SESS = { classKey: '1-3', studentName: '한별', studentNum: '7' };
const booked = (id, date, extra = {}) => ({ id, date, time: '16:00', duration: 20, status: 'booked',
  studentName: '한별', studentNum: '7', bookedName: '한별 보호자', bookedPhone: '010-0000-0000', bookedType: 'face',
  bookedAt: '2026-05-01T10:00:00Z', ...extra });
// 신고 그대로의 모양: 1학기 상담(지난 예약)이 배열 앞에, 2학기 상담(다가오는 예약)이 뒤에 쌓여 있다
const docOf = () => ({ slots: [
  booked('s-0520', '2026-05-20'),                                         // 지난 예약 — 1학기 상담 주간
  { id: 's-1104a', date: '2026-11-04', time: '15:40', status: 'open' },
  booked('s-1104', '2026-11-04'),                                         // 다가오는 예약 — 화면에 보이는 것
  booked('s-1105', '2026-11-05', { studentName: '윤솔', studentNum: '12' }),// 같은 반 다른 학생
], openAt: '' });

function makeCancel(doc) {
  const store = { doc, commits: 0 };
  const src = [grabJs('todayKst'), grabJs('findMine'), grabJs('handleCancel')].join('\n') + '\nreturn handleCancel;';
  const fn = new Function('readSession', 'fsGet', 'fsCommit', 'writeUpdate', 'mirrorWrite', src)(
    async (env, s) => (s === 'ok' ? SESS : null),
    async (env, coll, key) => ({ data: coll === 'consultations' && key === SESS.classKey ? JSON.parse(JSON.stringify(store.doc)) : null, updateTime: 't' + store.commits }),
    async (env, writes) => { store.commits++; store.doc = { ...store.doc, ...writes[0].fields }; return true; },
    (env, coll, key, fields) => ({ coll, key, fields }),
    () => ({ mirror: true }));
  return { cancel: body => fn({}, { session: 'ok', ...body }), store };
}
const statusOf = (store, id) => store.doc.slots.find(s => s.id === id)?.status;

console.log('\n■ 지난 예약 + 다가오는 예약이 함께 있을 때');
{
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({ slotId: 's-1104' });
  check('화면이 보낸 예약(11/4)을 취소한다', r.success === true && statusOf(store, 's-1104') === 'open', r);
  check('지난 예약(5/20)은 그대로 — 기록으로 남는다', statusOf(store, 's-0520') === 'booked');
  check('취소한 칸에서 예약자 정보가 지워진다', !('studentName' in store.doc.slots.find(s => s.id === 's-1104'))
    && !('bookedPhone' in store.doc.slots.find(s => s.id === 's-1104')));
  check('같은 반 다른 학생 예약은 그대로', statusOf(store, 's-1105') === 'booked');
}
{
  // 예전 화면(slotId 를 안 보냄) — 이 경우가 신고된 버그다
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({});
  check('예전 화면(slotId 없음)도 다가오는 예약(11/4)을 취소한다 — 지난 예약을 고르지 않는다',
    r.success === true && statusOf(store, 's-1104') === 'open' && statusOf(store, 's-0520') === 'booked',
    store.doc.slots.map(s => [s.id, s.status]));
}

console.log('\n■ 취소하면 안 되는 칸');
{
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({ slotId: 's-0520' });
  check('지난 예약 id 를 보내면 거절(PAST) — 아무것도 안 바뀐다', r.success === false && r.error === 'PAST' && store.commits === 0, r);
}
{
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({ slotId: 's-1105' });
  check('다른 학생 예약 id 를 보내면 거절(NO_BOOKING)', r.success === false && r.error === 'NO_BOOKING' && store.commits === 0, r);
}
{
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({ slotId: 's-1104a' });
  check('예약되지 않은 칸 id 면 거절(NO_BOOKING)', r.success === false && r.error === 'NO_BOOKING' && store.commits === 0, r);
}
{
  const { cancel, store } = makeCancel(docOf());
  const r = await cancel({ slotId: 'nope' });
  check('없는 칸 id 면 거절(NO_BOOKING)', r.success === false && r.error === 'NO_BOOKING' && store.commits === 0, r);
}
{
  const d = docOf(); d.slots[2].token = 'teacher';
  const { cancel, store } = makeCancel(d);
  const r = await cancel({ slotId: 's-1104' });
  check('선생님이 직접 넣은 예약은 거절(TEACHER_BOOKED)', r.success === false && r.error === 'TEACHER_BOOKED' && store.commits === 0, r);
  const r2 = await makeCancel(d).cancel({});
  check('— slotId 없이도 같은 거절', r2.success === false && r2.error === 'TEACHER_BOOKED', r2);
}
{
  const d = docOf(); d.slots = d.slots.filter(s => s.id !== 's-1104');
  const { cancel, store } = makeCancel(d);
  const r = await cancel({});
  check('지난 예약만 있으면 취소할 것이 없다(NO_BOOKING) — 지난 예약을 지우지 않는다', r.success === false && r.error === 'NO_BOOKING'
    && store.commits === 0 && statusOf(store, 's-0520') === 'booked', r);
}
{
  // 오늘 예약 — 조회(findMine)가 「내 예약」 으로 보여 주는 것이니 취소도 된다(같은 기준)
  const d = docOf(); d.slots.push(booked('s-1031', '2026-10-31'));
  d.slots = d.slots.filter(s => s.id !== 's-1104');
  const { cancel, store } = makeCancel(d);
  const r = await cancel({ slotId: 's-1031' });
  check('오늘 예약은 조회와 같은 기준으로 취소된다', r.success === true && statusOf(store, 's-1031') === 'open', r);
}
{
  const { cancel } = makeCancel(docOf());
  const r = await cancel({ session: 'bad', slotId: 's-1104' });
  check('세션이 없으면 거절(AUTH)', r.success === false && r.error === 'AUTH', r);
}

console.log('\n■ 학부모 화면');
{
  const m = parentHtml.match(/callApi\('cancel',\s*\{([^}]*)\}\)/);
  check('취소 단추가 보고 있는 예약 id(myBooking.id)를 함께 보낸다', !!m && /slotId:\s*\(?myBooking\b[^,}]*\.id/.test(m[1]), m && m[1]);
  check('지난 예약이라 거절되면 알아들을 말로', parentHtml.includes("PAST") && parentHtml.includes('이미 지난 상담'));
}

globalThis.Date = RealDate;
console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
