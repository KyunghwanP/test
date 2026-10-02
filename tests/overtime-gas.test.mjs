// 초과근무 Apps Script(gas/overtime/Code.gs) — 구글 없이 처음부터 끝까지 돌려 본다.
//
// 이 스크립트는 학교 계정에서 돈다. 여기서 틀리면 감사 근거로 쓸 시트에 틀린 기록이
// 남거나, 남의 이름으로 신청이 들어가거나, 다른 사람의 업무 내용이 새어 나간다.
// 그래서 '돌아간다' 가 아니라 시트에 무엇이 남는지를 칸 단위로 본다.
//
// 가짜 환경은 overtime-fake.mjs. 로그인 토큰은 'tok:<이메일>' 꼴이다.
import { makeGas, OWNER } from './overtime-fake.mjs';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const D = (local) => `yeungnam.hs.kr`.replace(/^/, local + '@');
const OP = D('pkh910518'), VP = D('vp'), PR = D('pr'), P1 = D('p1'), P2 = D('p2');
const KIM = D('kim'), LEE = D('lee'), PARK = D('park'), JUNG = D('jung'), HAN = D('han'), OH = D('oh'),
      YOON = D('yoon'), JANG = D('jang'), LIM = D('lim');

const G = makeGas({ people: {
  [OP]: { displayName: '박경환' }, [D('nostaff')]: { displayName: '새선생' },
  [D('unv')]: { emailVerified: false }, [D('dis')]: { disabled: true },
} });

const DOW = d => '일월화수목금토'[new Date(d + 'T12:00:00Z').getUTCDay()];
const label = d => `${d} (${DOW(d)})`;
const duty = () => G.sheet('① 자율학습 감독').table(2);
const dutyRow = date => duty().find(r => r[0].startsWith(date));
const cellOf = (date, g, r) => { const row = dutyRow(date); return row ? row[1 + (g - 1) * 3 + (r - 1)] : undefined; };
const sheetRowOf = date => { const sh = G.sheet('① 자율학습 감독'); for (let r = 3; r <= sh.getLastRow(); r++) if (sh.cell(r, 1).v.startsWith(date)) return r; };
const cellRaw = (date, g, r) => G.sheet('① 자율학습 감독').cell(sheetRowOf(date), 2 + (g - 1) * 3 + (r - 1));
const detail = (date, g, r) => { const sh = G.sheet('감독 상세'); for (let i = 3; i <= sh.getLastRow(); i++) if (sh.cell(i, 1).v === date) { const v = sh.cell(i, 2 + (g - 1) * 3 + (r - 1)).v; return v ? JSON.parse(v) : null; } };
const reqs = () => G.sheet('② 기타 업무').table();
const swaps = () => G.sheet('교체·정정').table();
const hist = () => G.sheet('변경 이력').table();
const allRows = () => G.sheet('③ 통합조회').table();
const mailsTo = (email, from = 0) => G.mails.slice(from).filter(m => m.to.split(',').includes(email));
const cfgRows = () => G.sheet('설정').table();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 처음 설정 (학교 계정이 편집기에서 setup 실행)');
const msg = G.setup();
check('setup 이 안내 문구를 돌려준다', /설정/.test(msg), msg);
const names = G.ss.getSheets().map(s => s.name);
check('탭 여덟 개가 이 순서로 생긴다',
      JSON.stringify(names) === JSON.stringify(['① 자율학습 감독', '② 기타 업무', '③ 통합조회', '교체·정정', '변경 이력', '설정', '교원 명렬', '감독 상세']), names);
check('새 문서의 빈 「시트1」 은 치운다', !names.includes('시트1'));
check('감독 상세(이메일)는 숨김 탭', G.sheet('감독 상세').hidden === true);
check('이메일 칸은 숨긴다 (② 13·14열, 교체·정정 15열, 변경 이력 8열)',
      [...G.sheet('② 기타 업무').hiddenCols].join() === '13,14' && [...G.sheet('교체·정정').hiddenCols].join() === '15'
      && [...G.sheet('변경 이력').hiddenCols].join() === '8');
const dh = G.sheet('① 자율학습 감독').getRange(1, 1, 2, 10).getDisplayValues();
check('① 머리글 두 줄 — 학년 묶음 + 감독1·2·3(심야)',
      dh[0].join('|') === '근무일|1학년|||2학년|||3학년||' &&
      dh[1].join('|') === '|감독1|감독2|감독3 (심야)|감독1|감독2|감독3 (심야)|감독1|감독2|감독3 (심야)', dh);
const prot = G.ss.getSheets().map(s => s.protection);
check('모든 탭이 잠긴다 — 편집자는 문서 주인뿐, 도메인 편집 끔',
      prot.every(p => p && p.editors.length === 1 && p.editors[0] === OWNER && p.domainEdit === false),
      prot.map(p => p && [p.editors, p.domainEdit]));
check('모든 칸이 일반 텍스트 서식 (날짜·시각이 Date 로 바뀌지 않게)',
      G.ss.getSheets().every(s => s.formats.some(f => f.row === 1 && f.nr === s.maxRows && f.f === '@')));
check('15분마다 도는 시계 트리거 하나', G.triggers.length === 1 && G.triggers[0].fn === 'tick' && G.triggers[0].n === 15);
check('설정 기본값 10줄', cfgRows().length === 10 && cfgRows().find(r => r[0] === '교체 수락 기한')[1] === '18:30'
      && cfgRows().find(r => r[0] === '메일 알림')[1] === '끔', cfgRows());
check('시트 ID 를 스크립트 속성에 적어 둔다', G.props.get('SHEET_ID') === 'SHEET-ID-1');
G.setCfg('교체 수락 기한', '18시 30분');
G.setup();
check('다시 실행해도 설정 줄이 늘지 않고 적은 값은 그대로', cfgRows().length === 10 && cfgRows().find(r => r[0] === '교체 수락 기한')[1] === '18시 30분');
check('다시 실행해도 트리거는 하나', G.triggers.length === 1);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 본인 확인 — 토큰이 아니면 아무것도 못 한다');
check('ping 은 토큰 없이 (주소 확인용)', G.post({ action: 'ping' }).ok === true);
check('모르는 요청', G.call(OP, 'drop').error === 'ACTION');
check('토큰 없음 → AUTH', G.call('', 'me').error === 'AUTH');
check('엉터리 토큰 → AUTH', G.post({ action: 'me', idToken: 'x'.repeat(40) }).error === 'AUTH');
check('학생 계정(숫자 7자리) → AUTH', G.call(D('2410203'), 'me').error === 'AUTH');
check('학교 밖 계정 → AUTH', G.call('someone@gmail.com', 'me').error === 'AUTH');
check('이메일 확인 안 된 계정 → AUTH', G.call(D('unv'), 'me').error === 'AUTH');
check('정지된 계정 → AUTH', G.call(D('dis'), 'me').error === 'AUTH');
const n0 = G.lookups.length;
G.call(OP, 'me'); G.call(OP, 'me');
check('같은 토큰은 5분 동안 다시 묻지 않는다', G.lookups.length === n0 + 1, G.lookups.length - n0);
check('본문에 이메일을 적어도 무시한다 (토큰의 계정으로만)', G.call(KIM, 'me', { email: OP }).state.me.id !== G.call(OP, 'me').state.me.id);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 설정·명렬');
G.setCfg('승인 (관리자)', '정교감');
G.setCfg('보기 (관리자)', PR);
G.setCfg('1학년 기획 담당', '김일기');
G.setCfg('2학년 기획 담당', P2);
G.setCfg('3학년 기획 담당', '없는사람, 최동명');
G.setCfg('운영 담당', OP);
G.setCfg('메일 알림', '켬');
const ROSTER = [
  ['박경환', '교무기획부', OP], ['정교감', '교감', VP], ['한교장', '교장', PR], ['김일기', '1학년부', P1],
  ['이이기', '2학년부', P2], ['김민수', '1학년부', KIM], ['이서연', '1학년부', LEE], ['박지훈', '2학년부', PARK],
  ['정하늘', '2학년부', JUNG], ['한도윤', '3학년부', HAN], ['오세린', '3학년부', OH], ['윤재현', '2학년부', YOON],
  ['장미래', '1학년부', JANG], ['임동건', '3학년부', LIM], ['최동명', '과학과', D('choi1')], ['최동명', '수학과', D('choi2')],
].map(([name, dept, email]) => ({ name, dept, email }));
check('운영 담당이 아니면 명렬을 못 보낸다', G.call(KIM, 'roster', { rows: ROSTER }).error === 'FORBIDDEN');
check('너무 짧은 명렬은 거절', /짧/.test(G.call(OP, 'roster', { rows: ROSTER.slice(0, 5) }).msg));
const rr = G.call(OP, 'roster', { rows: ROSTER.concat([
  { name: '바깥', dept: '', email: 'x@gmail.com' }, { name: '중복', dept: '', email: KIM },
  { name: '=HYPERLINK("http://evil")', dept: '+1', email: D('evil') }]) });
check('명렬 저장 — 학교 밖 계정·같은 이메일 두 번째는 뺀다', rr.ok && rr.count === 17, rr);
const staffTab = G.sheet('교원 명렬').table();
check('교원 명렬 탭에 이름·부서·이메일', staffTab.length === 17 && staffTab[5].join('|') === `김민수|1학년부|${KIM}`, staffTab.slice(0, 6));
check('수식처럼 생긴 이름도 글자로 들어간다 (앞에 빈칸)', G.ss.formulas.length === 0 && staffTab[16][0].startsWith(' =') , [G.ss.formulas, staffTab[16]]);
check('명렬 갱신이 변경 이력에 남는다', hist().some(r => r[1] === '명렬 갱신' && r[4] === '17명' && r[5] === '박경환' && r[7] === OP));

const meKim = G.call(KIM, 'me');
check('이름·부서는 명렬에서 (토큰 이름 아님)', meKim.state.me.name === '김민수' && meKim.state.me.dept === '1학년부', meKim.state.me);
check('보통 교사는 권한 없음', !meKim.state.roles.approve && !meKim.state.roles.view && meKim.state.roles.grades.length === 0 && !meKim.state.roles.operator);
check('교사 화면에는 이메일이 하나도 안 내려간다', !JSON.stringify(meKim).includes('@'), JSON.stringify(meKim).match(/[\w.]+@[\w.]+/g));
check('교사 화면에는 시트 주소도 안 간다', !('sheetUrl' in meKim.state));
check('명렬 사람은 번호(id)로 고른다 — 동명이인도 구별', meKim.state.staff.filter(p => p.name === '최동명').length === 2
      && new Set(meKim.state.staff.map(p => p.id)).size === meKim.state.staff.length);
const meNew = G.call(D('nostaff'), 'me');
check('명렬에 없으면 구글 계정 이름으로', meNew.state.me.name === '새선생' && meNew.state.me.inRoster === false, meNew.state.me);
const meVp = G.call(VP, 'me');
check('설정에 이름으로 적어도 명렬로 찾아 권한 (정교감 → 승인)', meVp.state.roles.approve && meVp.state.roles.view && meVp.state.pendingCount === 0);
check('보기 관리자는 승인 권한 없음', G.call(PR, 'me').state.roles.view && !G.call(PR, 'me').state.roles.approve);
check('학년 기획 담당 (이름으로 1학년, 이메일로 2학년)', G.call(P1, 'me').state.roles.grades.join() === '1' && G.call(P2, 'me').state.roles.grades.join() === '2');
check('동명이인·없는 이름은 권한을 주지 않는다', G.call(D('choi1'), 'me').state.roles.grades.length === 0);
const st = G.call(OP, 'status');
check('운영 담당의 설치 상태 — 이름으로 풀어서, 못 찾은 이름은 따로',
      st.ok && st.status.lists.approve.join() === '정교감' && st.status.lists.g2.join() === '이이기'
      && st.status.unresolved.join() === '없는사람,최동명' && st.status.staff === 17 && st.status.trigger === true && st.status.mailOn === true, st.status);
check('교사는 설치 상태를 못 본다', G.call(KIM, 'status').error === 'FORBIDDEN');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ ② 기타 업무 신청 (오늘 2026-10-05 월 09:00)');
const BAND = '5시간 초과 ~ 6시간 이하';
const bad = (p, re) => { const r = G.call(KIM, 'submit', Object.assign({ date: '2026-10-08', band: BAND, type: '상담', reason: '학부모 상담 3건 (상담일지)' }, p)); return !r.ok && re.test(r.msg); };
check('지난 날짜는 안 됨', bad({ date: '2026-10-02' }, /지난 날짜/));
check('60일 넘게 앞은 안 됨', bad({ date: '2026-12-10' }, /60일/));
check('없는 날짜는 안 됨', bad({ date: '2026-02-30' }, /날짜/));
check('구간을 골라야 함 (목록 밖 값 거절)', bad({ band: '3시간' }, /구간/));
check('유형을 골라야 함', bad({ type: '자율' }, /유형/));
check('사유가 짧으면 안 됨', bad({ reason: '업무' }, /구체적/));
let mail0 = G.mails.length;
const s1 = G.call(KIM, 'submit', { date: '2026-10-08', band: BAND, type: '상담', reason: '수시 원서 접수 전 학부모 상담 4건 (상담일지 작성)' });
check('신청 — 대기로 들어간다', s1.ok && s1.state.requests[0].status === '대기' && s1.state.requests[0].date === '2026-10-08', s1);
const r1 = reqs()[0];
check('② 한 줄: 번호·접수·근무일·이름·부서·구간·유형·사유·상태·이메일',
      r1.slice(0, 9).join('|') === `R0001|2026-10-05 09:00|${label('2026-10-08')}|김민수|1학년부|${BAND}|상담|수시 원서 접수 전 학부모 상담 4건 (상담일지 작성)|대기`
      && r1[12] === KIM, r1);
check('관리자에게 새 신청 메일 (사유 포함)', mailsTo(VP, mail0).some(m => /새 신청 — 김민수/.test(m.subject) && /상담일지/.test(m.body)));
check('신청자에게 접수 확인 메일', mailsTo(KIM, mail0).some(m => /신청을 받았습니다/.test(m.subject)));
check('보기 관리자·담당자에게는 안 간다', mailsTo(PR, mail0).length === 0 && mailsTo(P1, mail0).length === 0);
check('변경 이력 — 신청', hist().some(r => r[1] === '신청' && r[2] === '② 10.08 (목) 김민수' && r[4] === '대기' && r[5] === '김민수'));
check('같은 날 두 번은 안 됨', bad({}, /이미 있습니다/));
const inj = G.call(LEE, 'submit', { date: '2026-10-05', band: '4시간 초과 ~ 5시간 이하', type: '기타', reason: '=IMPORTXML("http://x","//a") 자료 정리' });
check('오늘 근무일 신청은 「당일 신청」 표시', inj.ok && reqs()[1][9] === '당일 신청', reqs()[1]);
check('수식처럼 생긴 사유는 앞에 빈칸을 두어 글자로 (시트가 바깥으로 요청하지 않게)',
      G.ss.formulas.length === 0 && reqs()[1][7] === ' =IMPORTXML("http://x","//a") 자료 정리', reqs()[1][7]);
check('읽을 때는 빈칸을 떼고 원래 글 그대로', G.call(LEE, 'me').state.requests[0].reason === '=IMPORTXML("http://x","//a") 자료 정리');
check('남의 신청은 내 화면에 없다', G.call(LEE, 'me').state.requests.every(q => q.id !== 'R0001'));
check('남의 신청은 취소 못 함', /찾지 못/.test(G.call(LEE, 'cancel', { id: 'R0001' }).msg));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 승인·반려');
check('교사는 관리자 목록을 못 본다', G.call(KIM, 'adminList').error === 'FORBIDDEN');
const al = G.call(PR, 'adminList');
check('보기 관리자는 목록은 보되 처리 버튼 없음', al.ok && al.pending.length === 2 && al.canDecide === false);
check('대기 목록은 근무일 순 + 당일 표시', al.pending[0].date === '2026-10-05' && al.pending[0].sameDay === true && al.pending[1].name === '김민수');
check('보기 관리자는 승인 못 함', G.call(PR, 'decide', { id: 'R0001', decision: '승인' }).error === 'FORBIDDEN');
check('반려는 사유가 있어야', /반려 사유/.test(G.call(VP, 'decide', { id: 'R0002', decision: '반려', reason: '' }).msg));
mail0 = G.mails.length;
const dc = G.call(VP, 'decide', { id: 'R0001', decision: '승인' });
check('승인 — 처리자·처리 시각이 남는다', dc.ok && reqs()[0][8] === '승인' && reqs()[0][10] === '정교감' && reqs()[0][11] === '2026-10-05 09:00' && reqs()[0][13] === VP, reqs()[0]);
check('승인 결과에 목록이 같이 온다 (다시 읽지 않게) — 알림 문구와 목록이 섞이지 않게', dc.pending.length === 1 && dc.decided.length === 1 && typeof dc.done === 'string' && /승인했습니다/.test(dc.done), dc.done);
check('신청자에게 승인 메일', mailsTo(KIM, mail0).some(m => /승인되었습니다 — 10.08/.test(m.subject)));
check('③ 통합조회에 승인 건이 들어간다', allRows().some(r => r[2] === '김민수' && r[4] === '기타 업무 · 상담' && r[5] === BAND && r[7] === '승인' && r[8] === '정교감'));
check('이미 처리된 건은 다시 못 함', /이미 승인/.test(G.call(VP, 'decide', { id: 'R0001', decision: '반려', reason: 'x' }).msg));
G.call(VP, 'decide', { id: 'R0002', decision: '반려', reason: '하는 일이 구체적이지 않습니다' });
check('반려 — 사유가 비고에 (당일 신청 표시 뒤에)', reqs()[1][8] === '반려' && reqs()[1][9] === '당일 신청 · 하는 일이 구체적이지 않습니다', reqs()[1]);
check('반려 메일에 사유', mailsTo(LEE).some(m => /반려되었습니다/.test(m.subject) && /구체적이지 않습니다/.test(m.body)));
check('반려된 건은 내 화면에 사유와 함께', G.call(LEE, 'me').state.requests[0].note.includes('구체적이지'));
G.call(KIM, 'submit', { date: '2026-10-12', band: '4시간 초과 ~ 5시간 이하', type: '부서 업무', reason: '학업성적관리위원회 회의자료 작성' });
mail0 = G.mails.length;
check('관리자 본인 신청도 받는다', G.call(VP, 'submit', { date: '2026-10-09', band: '8시간 초과', type: '기타', reason: '교원능력개발평가 결과 정리' }).ok);
check('자기가 낸 신청의 「새 신청」 알림은 자기에게 안 보낸다 (접수 확인만)',
      mailsTo(VP, mail0).length === 1 && /신청을 받았습니다/.test(mailsTo(VP, mail0)[0].subject), mailsTo(VP, mail0).map(m => m.subject));
mail0 = G.mails.length;
const self = G.call(VP, 'decide', { id: 'R0004', decision: '승인' });
check('자기 신청을 자기가 승인하면 승인 메일은 안 간다', mailsTo(VP, mail0).length === 0);
check('본인 신청을 본인이 승인하면 이력에 「본인 신청」', self.ok && hist().some(r => r[1] === '승인' && r[2].includes('정교감') && r[6] === '본인 신청'));
const c1 = G.call(KIM, 'cancel', { id: 'R0001' });
check('승인된 것도 근무일 전이면 취소 — 승인 기록은 지우지 않는다',
      c1.ok && reqs()[0][8] === '취소' && reqs()[0][10] === '정교감' && /본인 취소 10.05 09:00/.test(reqs()[0][9]), reqs()[0]);
check('승인 건 취소는 관리자에게 알린다', mailsTo(VP).some(m => /승인된 신청이 취소/.test(m.subject)));
check('취소하면 ③ 에서 빠진다', !allRows().some(r => r[2] === '김민수' && r[4].startsWith('기타 업무')));
check('취소한 날은 다시 신청할 수 있다', G.call(KIM, 'submit', { date: '2026-10-08', band: BAND, type: '상담', reason: '수시 원서 접수 전 학부모 상담 4건' }).ok);
G.call(LEE, 'submit', { date: '2026-10-20', band: BAND, type: '상담', reason: '여러 건 승인 시험 하나' });
G.call(PARK, 'submit', { date: '2026-10-21', band: BAND, type: '상담', reason: '여러 건 승인 시험 둘' });
const bulkIds = reqs().filter(r => /여러 건 승인 시험/.test(r[7])).map(r => r[0]);
check('여러 건 반려는 안 된다 (사유를 한 건씩)', /한 건씩/.test(G.call(VP, 'decide', { ids: bulkIds, decision: '반려', reason: 'x' }).msg));
check('보기 관리자는 여러 건 승인도 못 함', G.call(PR, 'decide', { ids: bulkIds, decision: '승인' }).error === 'FORBIDDEN');
mail0 = G.mails.length;
const bulk = G.call(VP, 'decide', { ids: bulkIds.concat(['R0001']), decision: '승인' });
check('여러 건 한꺼번에 승인 — 이미 처리된 것은 건너뛰고 알려 준다', bulk.ok && /^2건을 승인했습니다\. \(1건은/.test(bulk.done)
      && reqs().filter(r => bulkIds.includes(r[0])).every(r => r[8] === '승인' && r[10] === '정교감'), bulk.done);
check('한 사람씩 승인 메일, 이력에 「2건 한꺼번에」', mailsTo(LEE, mail0).length === 1 && mailsTo(PARK, mail0).length === 1
      && hist().filter(r => r[1] === '승인' && r[6] === '2건 한꺼번에').length === 2);
check('모두 이미 처리된 것만 고르면 알려 준다', /모두 이미 처리/.test(G.call(VP, 'decide', { ids: bulkIds, decision: '승인' }).msg));
const sm = G.call(VP, 'adminList', { month: '2026-10' }).summary;
check('월 요약 — 승인·반려·대기·취소', sm.approved === 3 && sm.rejected === 1 && sm.pending === 2 && sm.cancelled === 1, sm);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ ① 감독 배정 (학년 기획 담당이 엑셀에서 붙여넣기)');
check('담당이 아니면 못 함', G.call(KIM, 'assign', { grade: 1, text: '10/06\t김민수', dryRun: true }).error === 'FORBIDDEN');
check('남의 학년은 못 함', G.call(P2, 'assign', { grade: 1, text: '10/06\t김민수', dryRun: true }).error === 'FORBIDDEN');
const PASTE1 = [
  '날짜\t감독1\t감독2\t감독3',
  '10/06\t김민수\t이서연\t장미래',
  '10/07\t이서연\t장미래\t김민수',
  '10월 8일 (목)\t장미래\t\t김민수',
  '10/09\t김민수\t김민수\t없는이',
  '10/07\t장미래\t이서연\t김민수',
  '10/12\t최동명\t이서연\t장미래',
  '어제\t김민수',
].join('\n');
const pv = G.call(P1, 'assign', { grade: 1, text: PASTE1, dryRun: true });
const pvBy = d => pv.preview.find(r => r.date === d && r.state !== 'error') || pv.preview.find(r => r.date === d);
check('머리글 줄은 건너뛴다', pv.preview.every(r => !/감독1/.test(r.raw)));
check('「10월 8일 (목)」 도 읽고, 탭 사이 빈 칸은 그 자리에 남는다', pvBy('2026-10-08') && pvBy('2026-10-08').names.join('|') === '장미래||김민수', pvBy('2026-10-08'));
check('같은 사람이 두 칸 → 표시', pv.preview.find(r => r.date === '2026-10-09').bad.slice(0, 2).every(x => x === '같은 사람이 두 칸'));
check('명렬에 없는 이름 → 표시', pv.preview.find(r => r.date === '2026-10-09').bad[2] === '명렬에 없음');
check('동명이인 → 표시', pv.preview.find(r => r.date === '2026-10-12').bad[0] === '동명이인');
check('같은 날짜 두 번 → 표시', pv.preview.filter(r => r.date === '2026-10-07').some(r => /두 번/.test(r.err)));
check('날짜를 못 읽은 줄 → 표시', pv.preview.some(r => r.raw === '어제\t김민수' && /날짜/.test(r.err)));
check('미리보기는 아무것도 쓰지 않는다', duty().length === 0 && pv.committed === false && pv.errors === 4, pv.errors);
const cm0 = G.call(P1, 'assign', { grade: 1, text: PASTE1 });
check('확인이 필요한 줄이 있으면 확정해도 쓰지 않는다', cm0.ok && cm0.committed === false && duty().length === 0);
const PASTE1_OK = ['10/06\t김민수\t이서연\t장미래', '10/07\t이서연\t장미래\t김민수', '10월 8일 (목)\t장미래\t\t김민수',
                   '2026-10-12\t김민수\t장미래\t이서연', '10.9\t이서연\t김민수\t장미래'].join('\n');
const cm1 = G.call(P1, 'assign', { grade: 1, text: PASTE1_OK });
check('확정 — 다섯 날', cm1.ok && cm1.committed && cm1.ready === 5, cm1);
check('① 날짜 순으로 한 줄씩, 1학년 세 칸', duty().map(r => r[0]).join() === ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'].map(label).join()
      && dutyRow('2026-10-06').slice(1, 4).join() === '김민수,이서연,장미래' && dutyRow('2026-10-08').slice(1, 4).join() === '장미래,,김민수', duty());
check('숨김 탭에 같은 칸의 이메일', detail('2026-10-06', 1, 3).e === JANG && detail('2026-10-06', 1, 3).k === '배정');
check('배정한 칸은 색·메모 없음', cellRaw('2026-10-06', 1, 3).bg == null && !cellRaw('2026-10-06', 1, 3).note);
check('③ 에 감독3(심야)만 한 사람씩 — 처리는 배정한 사람(학년 기획)',
      allRows().filter(r => r[4] === '1학년 감독3 (심야)').length === 5
      && allRows().some(r => r[1] === label('2026-10-06') && r[2] === '장미래' && r[3] === '1학년부' && r[5] === '—' && r[6] === '심야자율학습 감독' && r[7] === '배정' && r[8] === '김일기 (1학년 기획)'),
      allRows().filter(r => r[4].includes('감독3')));
check('③ 은 근무일 순', (() => { const d = allRows().map(r => r[1]); return d.join() === [...d].sort().join(); })());
check('변경 이력 — 날짜마다 한 줄', hist().filter(r => r[1] === '배정').length === 5
      && hist().some(r => r[1] === '배정' && r[2] === '10.08 (목) 1학년' && r[4] === '장미래 · — · 김민수' && r[6] === '1학년 배정 일괄 입력 5일'));
const again = G.call(P1, 'assign', { grade: 1, text: '10/06\t김민수\t이서연\t장미래\n10/07\t장미래\t이서연\t김민수', dryRun: true });
check('이미 확정된 날짜는 덮지 않고 알려 준다 (같으면 same, 다르면 exists)',
      again.preview[0].state === 'same' && again.preview[1].state === 'exists' && again.preview[1].current.join() === '이서연,장미래,김민수', again.preview);
const skipBad = G.call(P1, 'assign', { grade: 1, text: '10/06\t없는이\t이서연\t장미래\n10/13\t김민수\t이서연\t장미래', dryRun: true });
check('건너뛸 날짜(이미 있음)의 이름은 따지지 않는다 — 나머지 날은 넣을 수 있다',
      skipBad.errors === 0 && skipBad.ready === 1 && skipBad.preview[0].state === 'exists' && skipBad.preview[0].bad.every(x => !x), skipBad.preview);
const g2 = G.call(P2, 'assign', { grade: 2, text: '10/06\t박지훈\t정하늘\t윤재현\n10/07\t김민수\t정하늘\t박지훈', dryRun: true });
check('다른 학년 칸에 이미 있는 사람 → 표시', g2.preview[1].bad[0] === '그날 1학년 감독3 (심야)', g2.preview[1]);
const g2ok = G.call(P2, 'assign', { grade: 2, text: '10/06\t박지훈\t정하늘\t윤재현\n10/07\t오세린\t정하늘\t박지훈\n10/13\t박지훈\t오세린\t정하늘' });
check('2학년은 같은 날짜 줄의 2학년 칸에 들어가고, 없는 날짜는 새 줄', g2ok.committed && dutyRow('2026-10-06').slice(4, 7).join() === '박지훈,정하늘,윤재현'
      && dutyRow('2026-10-06').slice(1, 4).join() === '김민수,이서연,장미래' && duty().length === 6 && duty()[5][0] === label('2026-10-13'), duty());

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 감독 교체 — A 요청, B 수락 (기한 근무일 18:30)');
const meJang = G.call(JANG, 'me').state;
check('내 감독 일정 — 이번 달 1일부터', meJang.slots.map(s => s.date + ':' + s.g + s.r).join() === '2026-10-06:13,2026-10-07:12,2026-10-08:11,2026-10-09:13,2026-10-12:12', meJang.slots);
const id = name => meJang.staff.find(p => p.name === name).id;
check('내 칸이 아니면 요청 못 함', /내 감독 칸이 아닙니다/.test(G.call(JANG, 'swapRequest', { slot: { date: '2026-10-06', g: 1, r: 1 }, to: id('한도윤') }).msg));
check('그날 이미 다른 칸인 사람에게는 못 함', /이미 2학년 감독1/.test(G.call(JANG, 'swapRequest', { slot: { date: '2026-10-06', g: 1, r: 3 }, to: id('박지훈') }).msg));
mail0 = G.mails.length;
const q1 = G.call(JANG, 'swapRequest', { slot: { date: '2026-10-06', g: 1, r: 3 }, to: id('한도윤'), reason: '가족 행사' });
check('요청 — 대기, 기한은 근무일 18:30', q1.ok && swaps()[0][11] === '대기' && swaps()[0][13] === '2026-10-06 18:30' && q1.state.outbox.length === 1, swaps()[0]);
check('교체·정정 한 줄: 종류·방식·칸·사람·사유', swaps()[0].slice(2, 11).join('|') === `교체|대신 서기|${label('2026-10-06')}|1학년 감독3 (심야)|장미래|장미래|한도윤||가족 행사`, swaps()[0]);
check('상대에게 메일 (기한 포함)', mailsTo(HAN, mail0).some(m => /감독 교체 요청 — 10.06/.test(m.subject) && /2026-10-06 18:30/.test(m.body)));
check('아직 감독표는 그대로', cellOf('2026-10-06', 1, 3) === '장미래');
check('같은 칸 요청을 또 보내면 막는다', /기다리는 중/.test(G.call(JANG, 'swapRequest', { slot: { date: '2026-10-06', g: 1, r: 3 }, to: id('임동건') }).msg));
const meHan = G.call(HAN, 'me').state;
check('받는 사람 화면의 받은 요청', meHan.inbox.length === 1 && meHan.inbox[0].byName === '장미래' && meHan.inbox[0].reason === '가족 행사');
check('다른 사람은 수락 못 함', /찾지 못/.test(G.call(LIM, 'respond', { id: 'S0001', accept: true }).msg));
mail0 = G.mails.length;
const a1 = G.call(HAN, 'respond', { id: 'S0001', accept: true });
check('수락 — 칸이 바뀐다', a1.ok && cellOf('2026-10-06', 1, 3) === '한도윤' && detail('2026-10-06', 1, 3).e === HAN, a1);
check('바뀐 칸은 노란색 + 메모 「장미래 → 한도윤 · 교체 수락 · 10.05 09:00」',
      cellRaw('2026-10-06', 1, 3).bg === '#FEF3C7' && cellRaw('2026-10-06', 1, 3).note === '장미래 → 한도윤 · 교체 수락 · 10.05 09:00', cellRaw('2026-10-06', 1, 3));
check('요청 줄은 완료', swaps()[0][11] === '완료' && swaps()[0][12] === '2026-10-05 09:00');
check('요청자와 그 학년 담당에게 완료 메일', mailsTo(JANG, mail0).some(m => /교체 완료/.test(m.subject)) && mailsTo(P1, mail0).some(m => /교체 완료/.test(m.subject)));
check('③ 의 심야 감독도 바뀐다 (교체 표시)', allRows().some(r => r[1] === label('2026-10-06') && r[2] === '한도윤' && r[3] === '3학년부' && r[6] === '심야자율학습 감독 (교체 수락)' && r[8] === '한도윤'));
check('변경 이력 — 요청과 수락 둘 다', hist().some(r => r[1] === '교체 요청' && r[3] === '장미래' && r[4] === '한도윤' && /가족 행사/.test(r[6]))
      && hist().some(r => r[1] === '교체 수락' && r[5] === '한도윤'));

// 맞교환 — 역할이 달라도 된다. 이서연 10.12 1학년 감독3 ↔ 오세린 10.13 2학년 감독2
check('상대 칸이 아니면 맞교환 못 함', /장미래 선생님의 감독 칸이 아닙니다/.test(G.call(LEE, 'swapRequest', { slot: { date: '2026-10-12', g: 1, r: 3 }, mode: 'trade', to: id('장미래'), slot2: { date: '2026-10-12', g: 1, r: 1 } }).msg));
check('맞교환해서 한 사람이 같은 날 두 칸이 되면 막는다', /김민수 선생님은 10.07 \(수\)에 이미 1학년 감독3/.test(G.call(LEE, 'swapRequest', { slot: { date: '2026-10-07', g: 1, r: 1 }, mode: 'trade', to: id('김민수'), slot2: { date: '2026-10-12', g: 1, r: 1 } }).msg));
const q2 = G.call(LEE, 'swapRequest', { slot: { date: '2026-10-12', g: 1, r: 3 }, mode: 'trade', to: id('오세린'), slot2: { date: '2026-10-13', g: 2, r: 2 } });
check('맞교환 요청 — 상대 칸 표시, 기한은 앞 날짜 18:30', q2.ok && swaps()[1][3] === '맞교환' && swaps()[1][9] === '10.13 (화) 2학년 감독2' && swaps()[1][13] === '2026-10-12 18:30', swaps()[1]);
G.call(OH, 'respond', { id: 'S0002', accept: true });
check('맞교환 수락 — 두 칸이 서로 바뀐다', cellOf('2026-10-12', 1, 3) === '오세린' && cellOf('2026-10-13', 2, 2) === '이서연'
      && cellRaw('2026-10-13', 2, 2).note === '오세린 → 이서연 · 교체 수락 · 10.05 09:00', [cellOf('2026-10-12', 1, 3), cellOf('2026-10-13', 2, 2), cellRaw('2026-10-13', 2, 2).note]);
// 거절
G.call(KIM, 'swapRequest', { slot: { date: '2026-10-09', g: 1, r: 2 }, to: id('임동건') });
G.call(LIM, 'respond', { id: 'S0003', accept: false });
check('거절 — 감독표 그대로, 요청자에게 알림', cellOf('2026-10-09', 1, 2) === '김민수' && swaps()[2][11] === '거절' && mailsTo(KIM).some(m => /거절/.test(m.subject)));
// 거두기
G.call(KIM, 'swapRequest', { slot: { date: '2026-10-09', g: 1, r: 2 }, to: id('오세린') });
check('남의 요청은 거둘 수 없다', /찾지 못/.test(G.call(OH, 'withdraw', { id: 'S0004' }).msg));
const wd = G.call(KIM, 'withdraw', { id: 'S0004' });
check('보낸 요청 거두기 — 상대에게 알림', wd.ok && swaps()[3][11] === '취소' && mailsTo(OH).some(m => /요청이 취소/.test(m.subject)));
check('지난 날짜 칸은 교체 요청 못 함', /지난 날짜/.test(G.call(KIM, 'swapRequest', { slot: { date: '2026-10-02', g: 1, r: 1 }, to: id('오세린') }).msg));

console.log('\n■ 기한 — 근무일 18:30 이 지나면 저절로 취소');
G.call(KIM, 'swapRequest', { slot: { date: '2026-10-08', g: 1, r: 3 }, to: id('오세린'), reason: '출장' });
G.setNow('2026-10-08T18:30:00+09:00');
check('18:30 정각까지는 대기', G.call(OH, 'me').state.inbox.length === 1);
G.setNow('2026-10-08T18:31:00+09:00');
mail0 = G.mails.length;
const late = G.call(OH, 'respond', { id: 'S0005', accept: true });
check('18:31 — 수락하려 해도 이미 만료', !late.ok && /만료/.test(late.msg) && swaps()[4][11] === '만료' && cellOf('2026-10-08', 1, 3) === '김민수', late);
check('요청자에게 만료 메일 (긴급 교체 안내)', mailsTo(KIM, mail0).some(m => /만료/.test(m.subject) && /긴급 교체/.test(m.body)));
check('변경 이력 — (자동) 교체 만료', hist().some(r => r[1] === '교체 만료' && r[5] === '(자동)'));
check('당일 18:30 이 지나면 새 요청도 못 보낸다', /기한\(18:30\)이 지났습니다/.test(G.call(JANG, 'swapRequest', { slot: { date: '2026-10-08', g: 1, r: 1 }, to: id('오세린') }).msg));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 긴급 교체 — 못 나오는 사람이 앱을 못 쓸 때, 대신 서는 사람이 등록 (즉시)');
check('지난 날짜는 못 함', /지난 날짜/.test(G.call(OH, 'emergency', { slot: { date: '2026-10-07', g: 1, r: 3 }, reason: '상고' }).msg));
check('내 감독에는 못 함', /내 감독/.test(G.call(KIM, 'emergency', { slot: { date: '2026-10-08', g: 1, r: 3 }, reason: '상고' }).msg));
check('사유가 있어야', /사유/.test(G.call(OH, 'emergency', { slot: { date: '2026-10-08', g: 1, r: 3 }, reason: '' }).msg));
mail0 = G.mails.length;
const em = G.call(OH, 'emergency', { slot: { date: '2026-10-08', g: 1, r: 3 }, reason: '김민수 선생님 상고' });
check('당일 저녁(18:31)에도 등록 즉시 반영', em.ok && cellOf('2026-10-08', 1, 3) === '오세린' && detail('2026-10-08', 1, 3).k === '긴급' && detail('2026-10-08', 1, 3).e === OH, em);
check('빨간 칸 + 메모', cellRaw('2026-10-08', 1, 3).bg === '#FEE2E2' && /김민수 → 오세린 · 긴급 교체/.test(cellRaw('2026-10-08', 1, 3).note));
check('A·담당자·관리자에게 알림 (본인 확인 없이 반영됐다고)', mailsTo(KIM, mail0).length === 1 && mailsTo(P1, mail0).length === 1 && mailsTo(VP, mail0).length === 1
      && /본인 확인 없이/.test(mailsTo(KIM, mail0)[0].body));
check('이력에 「본인 확인 없음」', hist().some(r => r[1] === '긴급 교체' && r[3] === '김민수' && r[4] === '오세린' && /본인 확인 없음/.test(r[6])));
check('교체·정정에 완료로 남는다', swaps().some(r => r[2] === '긴급 교체' && r[11] === '완료' && r[6] === '오세린'));
check('그날 이미 다른 칸이면 못 함', /장미래 선생님은 10.08 \(목\)에 이미 1학년 감독1/.test(G.call(JANG, 'emergency', { slot: { date: '2026-10-08', g: 1, r: 3 }, reason: '상고' }).msg));

G.setNow('2026-10-08T18:35:00+09:00');
G.call(JANG, 'swapRequest', { slot: { date: '2026-10-09', g: 1, r: 3 }, to: id('임동건') });
const pendingId = swaps().slice(-1)[0][0];
check('긴급 맞교환은 같은 역할끼리만', /같은 역할/.test(G.call(JUNG, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 2 }, mode: 'trade', mySlot: { date: '2026-10-13', g: 2, r: 3 }, reason: '상고' }).msg));
check('내 감독이 아닌 칸으로는 맞교환 못 함', /내 감독 칸/.test(G.call(JUNG, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 2 }, mode: 'trade', mySlot: { date: '2026-10-13', g: 2, r: 1 }, reason: '상고' }).msg));
check('A 가 그날 이미 감독이면 그 날로는 못 바꾼다', /이서연 선생님은 10.13 \(화\)에 이미 2학년 감독2/.test(G.call(PARK, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 1 }, mode: 'trade', mySlot: { date: '2026-10-13', g: 2, r: 1 }, reason: '병가' }).msg));
check('대신 서는 사람이 그날 이미 다른 칸이면 못 함', /장미래 선생님은 10.09 \(금\)에 이미 1학년 감독3/.test(G.call(JANG, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 2 }, reason: '병가' }).msg));
check('맞바꿀 내 감독은 내일 이후여야', /내일 이후/.test(G.call(OH, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 3 }, mode: 'trade', mySlot: { date: '2026-10-08', g: 1, r: 3 }, reason: '상고' }).msg));
mail0 = G.mails.length;
const emt = G.call(JUNG, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 3 }, mode: 'trade', mySlot: { date: '2026-10-13', g: 2, r: 3 }, reason: '장미래 선생님 상고' });
check('긴급 맞교환 — 두 칸이 바로 바뀐다', emt.ok && cellOf('2026-10-09', 1, 3) === '정하늘' && cellOf('2026-10-13', 2, 3) === '장미래'
      && cellRaw('2026-10-13', 2, 3).bg === '#FEE2E2', emt);
check('이력 — 긴급 맞교환, 두 칸 모두', hist().some(r => r[1] === '긴급 맞교환' && r[2] === '10.09 (금) 1학년 감독3 (심야) ↔ 10.13 (화) 2학년 감독3 (심야)' && r[3] === '장미래 / 정하늘' && r[4] === '정하늘 / 장미래'));
check('두 학년 담당 모두에게 알림', mailsTo(P1, mail0).length === 1 && mailsTo(P2, mail0).length === 1);

console.log('\n■ 칸이 바뀌면 걸려 있던 요청은 저절로 취소');
check('그 칸에 걸려 있던 교체 요청은 취소', swaps().find(r => r[0] === pendingId)[11] === '취소', swaps().find(r => r[0] === pendingId));
check('요청한 사람·받은 사람 모두에게 까닭과 함께 알림', mailsTo(JANG, mail0).some(m => /취소/.test(m.subject) && /바뀌었습니다/.test(m.body)) && mailsTo(LIM, mail0).some(m => /취소/.test(m.subject)));
check('이력 — (자동) 교체 자동 취소', hist().some(r => r[1] === '교체 자동 취소' && r[5] === '(자동)'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 담당자·관리자 정정 (마지막 수단 — 기한 없음, 사유 필수)');
G.setNow('2026-10-08T18:45:00+09:00');
check('교사는 못 함', G.call(KIM, 'fix', { slot: { date: '2026-10-06', g: 1, r: 1 }, to: id('장미래'), reason: '정정' }).error === 'FORBIDDEN');
check('다른 학년 담당은 못 함', G.call(P2, 'fix', { slot: { date: '2026-10-06', g: 1, r: 1 }, to: id('장미래'), reason: '정정' }).error === 'FORBIDDEN');
check('사유 없으면 못 함', /사유/.test(G.call(P1, 'fix', { slot: { date: '2026-10-06', g: 1, r: 1 }, to: id('장미래'), reason: '' }).msg));
mail0 = G.mails.length;
const fx2 = G.call(P2, 'fix', { slot: { date: '2026-10-13', g: 2, r: 3 }, to: id('윤재현'), reason: '배정 실수 바로잡음' });
check('담당자 정정 — 보라 칸, 메모에 「담당자 정정」', fx2.ok && cellOf('2026-10-13', 2, 3) === '윤재현' && cellRaw('2026-10-13', 2, 3).bg === '#EDE9FE'
      && /장미래 → 윤재현 · 담당자 정정/.test(cellRaw('2026-10-13', 2, 3).note), [fx2.msg, cellOf('2026-10-13', 2, 3), cellRaw('2026-10-13', 2, 3).note]);
check('원래 사람·새 사람에게 알림', mailsTo(JANG, mail0).length === 1 && mailsTo(YOON, mail0).length === 1);
check('바뀐 게 없으면 알려 준다', /바뀐 것이 없/.test(G.call(P2, 'fix', { slot: { date: '2026-10-13', g: 2, r: 3 }, to: id('윤재현'), reason: '확인' }).msg));
const fx = G.call(VP, 'fix', { slot: { date: '2026-10-09', g: 1, r: 1 }, to: '', reason: '그날 자율학습 없음' });
check('관리자는 어느 학년이든, 비울 수도 있다', fx.ok && cellOf('2026-10-09', 1, 1) === '' && /이서연 → \(비움\) · 관리자 정정/.test(cellRaw('2026-10-09', 1, 1).note), fx);
check('정정 결과에 그 달 감독표가 같이 온다', fx.grid && fx.grid.month === '2026-10' && fx.grid.days.length === 6);
check('변경 이력 — 관리자 정정', hist().some(r => r[1] === '관리자 정정' && r[3] === '이서연' && r[4] === '(비움)' && /자율학습 없음/.test(r[6])));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 지난 감독 정정 — 구두로 바꾸고 잊은 경우 (근무한 달 말일까지, 둘 다 확인)');
G.setNow('2026-10-14T08:00:00+09:00');
check('오늘·이후는 정정이 아니라 교체로', /교체로/.test(G.call(JANG, 'correct', { slot: { date: '2026-10-14', g: 1, r: 1 }, reason: 'x' }).msg));
const cq = G.call(JANG, 'correct', { slot: { date: '2026-10-07', g: 1, r: 2 }, actual: id('임동건'), reason: '구두로 바꾸고 등록을 잊음' });
check('기록된 사람(A)이 요청 → 실제로 선 사람(B)이 확인, 기한은 그달 말일', cq.ok && swaps().slice(-1)[0][2] === '사후 정정' && swaps().slice(-1)[0][13] === '2026-10-31 23:59', swaps().slice(-1)[0]);
check('같은 칸 정정을 또 요청하면 막는다', /이미 확인을 기다리/.test(G.call(LIM, 'correct', { slot: { date: '2026-10-07', g: 1, r: 2 }, reason: '중복' }).msg));
mail0 = G.mails.length;
G.call(LIM, 'respond', { id: swaps().slice(-1)[0][0], accept: true });
check('확인하면 바뀐다 — 파란 칸, 사후 정정', cellOf('2026-10-07', 1, 2) === '임동건' && cellRaw('2026-10-07', 1, 2).bg === '#DBEAFE' && /장미래 → 임동건 · 사후 정정/.test(cellRaw('2026-10-07', 1, 2).note));
check('요청자·담당자·관리자에게 완료 알림', mailsTo(JANG, mail0).length === 1 && mailsTo(P1, mail0).length === 1 && mailsTo(VP, mail0).length === 1);
check('이력에 누가 요청하고 누가 확인했는지', hist().some(r => r[1] === '사후 정정' && /장미래 요청 · 임동건 확인/.test(r[6])));
check('실제로 선 사람이 그날 다른 칸이었으면 막는다', /윤재현 선생님은 10.06 \(화\)에 이미 2학년 감독3/.test(G.call(YOON, 'correct', { slot: { date: '2026-10-06', g: 2, r: 1 }, reason: '대신 섰음' }).msg));
const cq2 = G.call(YOON, 'correct', { slot: { date: '2026-10-07', g: 2, r: 3 }, reason: '박지훈 선생님 대신 섰음' });
check('실제로 선 사람(B)이 요청하면 기록된 사람(A)에게 확인을 받는다', cq2.ok && G.call(PARK, 'me').state.inbox.some(w => w.kind === '사후 정정' && w.actualName === '윤재현'));
G.call(PARK, 'respond', { id: swaps().slice(-1)[0][0], accept: false });
check('A 가 거절하면 그대로, B 에게 담당자 안내', cellOf('2026-10-07', 2, 3) === '박지훈' && mailsTo(YOON).some(m => /거절/.test(m.subject) && /학년 기획 담당/.test(m.body)));
G.call(YOON, 'correct', { slot: { date: '2026-10-12', g: 1, r: 3 }, reason: '대신 섰음' });
G.setNow('2026-11-01T00:00:00+09:00');
check('달이 바뀌면 정정 요청은 만료', G.call(LEE, 'me').ok && swaps().slice(-1)[0][11] === '만료');
check('지난달 감독은 직접 정정 못 함 (담당자에게)', /담당/.test(G.call(LEE, 'correct', { slot: { date: '2026-10-12', g: 1, r: 3 }, actual: id('윤재현'), reason: '대신' }).msg));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 시계 트리거 (tick)');
G.setNow('2026-11-02T09:00:00+09:00');
G.call(P1, 'assign', { grade: 1, text: '11/03\t김민수\t이서연\t장미래' });
G.call(KIM, 'submit', { date: '2026-11-03', band: BAND, type: '부서 업무', reason: '2학기 성적 처리 자료 정리' });
G.call(JANG, 'swapRequest', { slot: { date: '2026-11-03', g: 1, r: 3 }, to: id('한도윤') });
G.setNow('2026-11-02T15:45:00+09:00');
mail0 = G.mails.length;
G.tick();
check('오후 4시 전에는 미처리 알림 없음', G.mails.length === mail0);
G.setNow('2026-11-02T16:00:00+09:00');
G.tick();
check('오후 4시 — 내일 근무 미처리 신청을 관리자에게 한 번', mailsTo(VP, mail0).filter(m => /처리 안 된 신청 1건/.test(m.subject)).length === 1);
G.setNow('2026-11-02T16:15:00+09:00');
G.tick();
check('같은 날 두 번 보내지 않는다', mailsTo(VP, mail0).filter(m => /처리 안 된 신청/.test(m.subject)).length === 1);
G.setNow('2026-11-03T18:45:00+09:00');
G.tick();
check('트리거가 18:30 지난 교체 요청을 닫는다', swaps().slice(-1)[0][11] === '만료');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 그 밖');
const grid = G.call(P1, 'grid', { month: '2026-10' });
check('담당자 감독표 — 칸마다 이름·메모', grid.ok && grid.days.length === 6 && grid.days[0].cells[2].note.includes('교체 수락') && grid.fixGrades.join() === '1');
check('교사는 감독표 화면을 못 본다', G.call(KIM, 'grid').error === 'FORBIDDEN');
const so = G.call(KIM, 'slotsOf', { id: id('장미래') });
check('다른 선생님 감독 칸 보기 (긴급 교체용) — 이번 달부터', so.ok && so.who.name === '장미래' && so.slots.every(s => s.date >= '2026-11-01'), so);
G.setCfg('메일 알림', '끔');
mail0 = G.mails.length;
G.call(KIM, 'submit', { date: '2026-11-05', band: BAND, type: '상담', reason: '학부모 상담 일정 4건 진행' });
check('메일 알림을 끄면 한 통도 안 나간다', G.mails.length === mail0);
G.setLock(false);
check('잠금을 못 얻으면 BUSY (아무것도 안 씀)', G.call(KIM, 'me').error === 'BUSY');
G.setLock(true);
// 학교 계정이 시트에서 이름을 손으로 고친 경우 — 숨김 탭의 이메일은 옛 사람 것
const shD = G.sheet('① 자율학습 감독');
shD.cell(sheetRowOf('2026-11-03'), 2, true).v = '오세린';
const hand = G.call(OH, 'me').state.slots;
check('손으로 고친 이름은 명렬로 다시 찾는다 (옛 이메일을 믿지 않음)', hand.some(s => s.date === '2026-11-03' && s.g === 1 && s.r === 1)
      && !G.call(KIM, 'me').state.slots.some(s => s.date === '2026-11-03' && s.r === 1));
// 학교 계정이 ①에 손으로 엉뚱한 날짜 줄을 넣고, 같은 날짜를 두 줄로 만든 경우
{
  const sh = G.sheet('① 자율학습 감독');
  const last = sh.getLastRow();
  sh.getRange(last + 1, 1, 2, 10).setValues([['다음 주 미정', '김민수', '', '', '', '', '', '', '', ''],
                                             [label('2026-11-03'), '오세린', '', '', '', '', '', '', '', '']]);
  const before = duty().length;
  const fr = G.call(P1, 'fix', { slot: { date: '2026-11-03', g: 1, r: 2 }, to: id('이서연'), reason: '정리' });
  const rows = duty();
  check('같은 날짜가 두 줄이면 아래 줄을 그날 감독으로 본다', fr.ok && rows.find(r => r[0].startsWith('2026-11-03')).slice(1, 3).join() === '오세린,이서연', [fr.msg, rows.slice(-3)]);
  check('손으로 넣은 날짜 아닌 줄은 지우지 않고 맨 아래에 그대로', rows[rows.length - 1].slice(0, 2).join('|') === '다음 주 미정|김민수', rows.slice(-2));
  check('같은 날짜 두 줄은 한 줄로 — 아래에 옛 줄이 남지 않는다', rows.length === before - 1 && rows.filter(r => r[0].startsWith('2026-11-03')).length === 1, rows.map(r => r[0]));
  check('숨김 탭도 같은 줄 수 (날짜 줄만)', G.sheet('감독 상세').table(2).length === rows.length - 1);
}
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 워커로 옮긴 뒤 — 이 스크립트는 메일만');
G.setCfg('메일 알림', '켬');
const WORKER = 'overtime@ynhs-7b5ba.iam.gserviceaccount.com';
const SECRET = 's'.repeat(32);
G.props.set('MAIL_SECRET', SECRET);
G.props.set('WORKER_EMAIL', WORKER);
check('시트 요청은 받지 않고 새로 고치라고 한다', G.call(KIM, 'me').error === 'MOVED');
check('ping 은 그대로', G.post({ action: 'ping' }).ok === true);
mail0 = G.mails.length;
check('비밀값이 틀리면 메일을 안 보낸다', G.post({ action: 'mail', secret: 'x'.repeat(32), mails: [{ to: KIM, subject: 'a', body: 'b' }] }).error === 'AUTH' && G.mails.length === mail0);
check('비밀값이 없으면 안 보낸다', G.post({ action: 'mail', mails: [{ to: KIM, subject: 'a', body: 'b' }] }).error === 'AUTH');
const relay = G.post({ action: 'mail', secret: SECRET, mails: [
  { to: KIM + ',' + LEE, subject: '[초과근무] 시험', body: '본문' }, { to: 'x@gmail.com', subject: 'a', body: 'b' },
  ...Array.from({ length: 60 }, () => ({ to: KIM, subject: 'n', body: 'n' })) ] });
check('맞으면 학교 주소로만, 한 번에 50통까지', relay.ok && relay.sent === 49 && G.mails[mail0].to === KIM + ',' + LEE
      && G.mails.slice(mail0).every(m => !m.to.includes('gmail')) && G.mails[mail0].name === '초과근무 관리', relay);
const nT = swaps().length; mail0 = G.mails.length;
G.setNow('2026-11-10T18:45:00+09:00');
G.tick();
check('이 스크립트의 시계는 쉰다 (워커가 돈다)', swaps().length === nT && G.mails.length === mail0);
G.setup();
check('setup 이 워커 계정을 시트 편집자로 더한다', G.ss.editors.includes(WORKER));
check('잠금 안에서도 워커만 쓸 수 있다 (주인 + 워커)', G.ss.getSheets().every(sh => sh.protection.editors.length === 2 && sh.protection.editors.includes(WORKER)));
check('이 스크립트의 시계는 없앤다', G.triggers.length === 0);
G.props.delete('MAIL_SECRET'); G.props.delete('WORKER_EMAIL');
check('어느 칸에도 수식이 들어가지 않았다', G.ss.formulas.length === 0, G.ss.formulas);
check('서버 오류 기록 없음', !G.logs.some(l => l.startsWith('ERR')), G.logs.filter(l => l.startsWith('ERR')));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
