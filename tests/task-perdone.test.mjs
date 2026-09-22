// 각자 완료 방식 — 한 사람이 자기 몫을 끝냈을 뿐인데 전원이 완료로 바뀌던 것.
//
// 실제로 난 일이다. 받은 사람이 '내 업무 완료' 를 눌렀는데 다른 사람들 화면에서도
// 그 일정이 완료로 사라졌다.
//
// 원인은 두 갈래였다.
//
//  ① 일정 문서에 작성자 이메일이 없어서, 작성자를 명렬(TEACHERS)에서 uid 로
//     찾아야 했다. 그런데 명렬의 이메일·uid 는 시간표를 새로 올릴 때마다
//     사라졌다가 선생님들이 로그인하는 대로 다시 채워진다(README 2장).
//     그 사이에는 작성자를 못 찾는데, 예전 코드는 못 찾으면 **이미 끝낸 것으로**
//     쳤다. 그래서 받은 사람 몫만 끝나면 '전원 완료' 가 되어 status 가 done 이 되고,
//     mytaskDoneForMe 는 status 가 done 이면 **누구에게나** 완료라고 답한다.
//
//  ② 받은 사람이 전체 status 를 쓰는 길이 열려 있었다. 화면에서는 상태 단추를
//     감추지만, 쓰는 함수 자체에는 문이 없었다.
//
// 그래서 이 검사는 '몇 명이 완료로 보이나' 를 사람별로 따진다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8"><body><script>
  ${grab('mytaskOwnerEmail')}
  ${grab('mytaskResolveShareEmail')}
  ${grab('mytaskPerDoneState')}
  ${grab('mytaskDoneForMe')}
  ${grab('mytaskInlineStatusHtml')}

  // 바깥 세계: 로그인한 사람과 명렬만 갈아 끼운다.
  let TEACHERS = [];
  let fbAuth = { currentUser: null };
  window._myUid = '';
  const escapeHtml = v => String(v);

  // 누구로 보고 있나
  window.asMe_ = (email, uid, name) => {
    fbAuth.currentUser = { email, uid, displayName: name };
    window._myUid = uid;
  };
  window.roster_ = list => { TEACHERS = list; };

  // 이 사람 화면에서 이 일정이 완료로 보이나
  window.doneForMe_ = t => mytaskDoneForMe(t);
  // 목록 칸이 '내 몫' 인가 '전체 상태' 인가. null 이면 전체 상태 select 로 떨어진다.
  window.inline_ = (t, home) => {
    const h = mytaskInlineStatusHtml(t, home);
    return h === null ? null : (/updateMytaskMyDoneInline/.test(h) ? '내몫'
                              : /updateMytaskStatus/.test(h) ? '전체' : '?');
  };
  window.state_ = t => {
    const s = mytaskPerDoneState(t);
    return { total: s.total, done: s.done, meDone: s.meDone,
             entries: s.entries.map(e => [e.label, e.done]) };
  };

  // 워커(mytaskSetMyDone)의 '전원 완료' 판정만 떼어내 그대로 돌린다.
  // 트랜잭션·Firestore 없이 같은 계산을 하려면 원본에서 그 조각을 가져와야 한다.
  ${(() => {
    const src = grab('mytaskSetMyDone');
    const i = src.indexOf('const shareAllDone');
    const j = src.indexOf('const allDone = shareAllDone && ownerDone;');
    return `window.allDone_ = (data, doneBy, ownerUid, user) => {
      ${src.slice(i, j)}
      return shareAllDone && ownerDone;
    };`;
  })()}
<\/script></body>`);

// ── 무대: 김작성(작성자) 이 이영수·박민지 두 명에게 공유한 '각자 완료' 일정 ──
const OWNER = { email: 'kim@yeungnam.hs.kr', uid: 'uidKim',  name: '김작성' };
const A     = { email: 'lee@yeungnam.hs.kr', uid: 'uidLee',  name: '이영수' };
const B     = { email: 'park@yeungnam.hs.kr',uid: 'uidPark', name: '박민지' };

const FULL_ROSTER = [
  { name: OWNER.name, email: OWNER.email, uid: OWNER.uid },
  { name: A.name,     email: A.email,     uid: A.uid },
  { name: B.name,     email: B.email,     uid: B.uid },
];
// 시간표를 새로 올린 직후 — 아직 아무도 다시 로그인하지 않아 이메일·uid 가 없다
const WIPED_ROSTER = [{ name: OWNER.name }, { name: A.name }, { name: B.name }];

const task = (over = {}) => ({
  id: 't1', title: '자료 제출', status: 'todo', perDone: true,
  ownerUid: OWNER.uid, ownerName: OWNER.name, ownerEmail: OWNER.email,
  sharedWith: [A.email, B.email], doneBy: [], ...over,
});
const doneEntry = p => ({ id: p.email, name: p.name, at: '2026-09-22T00:00:00.000Z' });

const as = (p, t) => pg.evaluate(([p, t]) => { window.asMe_(p.email, p.uid, p.name); return window.doneForMe_(t); }, [p, t]);
const stateAs = (p, t) => pg.evaluate(([p, t]) => { window.asMe_(p.email, p.uid, p.name); return window.state_(t); }, [p, t]);
const roster = r => pg.evaluate(r => window.roster_(r), r);
const allDone = (t, doneBy, me) => pg.evaluate(([t, d, m]) =>
  window.allDone_(t, d, t.ownerUid, { email: m.email, uid: m.uid }), [t, doneBy, me]);

console.log('\n■ 한 사람이 자기 몫을 끝내도 남은 사람은 그대로 (실제로 났던 일)');
{
  await roster(FULL_ROSTER);
  const t = task({ doneBy: [doneEntry(A)] });
  check('끝낸 사람에게는 완료로 보인다', (await as(A, t)) === true);
  check('아직 안 한 사람에게는 안 보인다', (await as(B, t)) === false);
  check('작성자에게도 완료가 아니다', (await as(OWNER, t)) === false);
  check('전원 완료로 치지 않는다', (await allDone(t, [doneEntry(A)], A)) === false);
}

console.log('\n■ 명렬에 이메일이 없을 때 (시간표를 새로 올린 직후)');
{
  // 이 상황이 사고의 방아쇠였다. 작성자를 못 찾는다.
  await roster(WIPED_ROSTER);
  const old = task({ ownerEmail: undefined, doneBy: [doneEntry(A), doneEntry(B)] });
  check('받은 사람이 다 끝나도 작성자 몫이 남아 있으면 전원 완료가 아니다',
        (await allDone(old, [doneEntry(A), doneEntry(B)], B)) === false);
  check('그래도 남은 사람 화면이 완료로 바뀌지 않는다', (await as(OWNER, old)) === false);

  // 화면도 같은 말을 해야 한다 — 작성자를 못 찾는다고 목록에서 빼면
  // '2/2 완료' 로 보이는데 자동 완료는 안 돼서 서로 어긋난다.
  const st = await stateAs(OWNER, old);
  check('작성자 칸이 목록에서 사라지지 않는다', st.total === 3, st);
  check('작성자는 아직 안 한 것으로 센다', st.done === 2, st);
}

console.log('\n■ 문서에 적힌 작성자 이메일을 먼저 본다');
{
  await roster(WIPED_ROSTER);                       // 명렬은 비어 있지만
  const t = task();                                 // 문서에는 ownerEmail 이 있다
  // 받은 사람(박민지) 눈으로 본다 — 작성자 본인이 보면 자기 이메일을 아는 것이 당연해
  // 검사가 되지 않는다.
  const lookAs = (p, t) => pg.evaluate(([p, t]) => {
    window.asMe_(p.email, p.uid, p.name); return mytaskOwnerEmail(t);
  }, [p, t]);
  const found = await lookAs(B, t);
  check('명렬이 비어도 작성자를 찾는다', found === OWNER.email, found);
  // 반대로 옛 문서(ownerEmail 없음)는 명렬이 비면 못 찾는 것이 맞다 — 그때
  // '못 찾았다' 고 답해야 부르는 쪽이 이미 완료로 치지 않는다.
  const none = await lookAs(B, task({ ownerEmail: null }));
  check('옛 문서는 못 찾았다고 답한다 (있는 척하지 않는다)', none === null, none);
  // 명렬이 돌아오면 다시 찾는다
  await roster(FULL_ROSTER);
  check('명렬이 채워지면 옛 문서도 찾는다',
        (await lookAs(B, task({ ownerEmail: null }))) === OWNER.email);
  await roster(WIPED_ROSTER);
  const st = await stateAs(B, t);
  check('작성자 이름이 제대로 뜬다', st.entries[0][0] === `${OWNER.name} (작성자)`, st.entries);

  const all = [doneEntry(OWNER), doneEntry(A), doneEntry(B)];
  check('셋이 다 끝나면 그때 전원 완료', (await allDone(t, all, B)) === true);
}

console.log('\n■ 전원이 끝나기 전에는 누구도 자동 완료되지 않는다');
{
  await roster(FULL_ROSTER);
  const t = task();
  const 단계 = [
    ['아무도 안 함',        []],
    ['작성자만',            [doneEntry(OWNER)]],
    ['작성자+이영수',       [doneEntry(OWNER), doneEntry(A)]],
  ];
  for (const [이름, d] of 단계) {
    check(`${이름} — 전원 완료 아님`, (await allDone(t, d, A)) === false, d.length);
  }
  check('작성자+이영수+박민지 — 그때 완료',
        (await allDone(t, [doneEntry(OWNER), doneEntry(A), doneEntry(B)], B)) === true);
}

console.log('\n■ 목록 칸은 누구에게나 "내 몫" 이다 (실제로 났던 일)');
{
  // 작성자가 목록에서 🟢완료를 골랐더니 받은 선생님들 목록에서 통째로 사라졌다.
  // 목록 칸이 작성자에게만 '전체 상태' 였기 때문이다. 목록에서는 아무도 전체를
  // 끝낼 수 없어야 한다 — 직권 완료는 창을 열어 상태 단추로 하는 일로 남긴다.
  await roster(FULL_ROSTER);
  const t = task();
  const inline = (p, home) => pg.evaluate(([p, t, home]) => {
    window.asMe_(p.email, p.uid, p.name); return window.inline_(t, home);
  }, [p, t, home]);

  check('작성자 — 목록에서 내 몫만 (전체 아님)', (await inline(OWNER, false)) === '내몫',
        await inline(OWNER, false));
  check('받은 사람 — 내 몫만', (await inline(A, false)) === '내몫');
  check('현황판에서도 작성자는 내 몫만', (await inline(OWNER, true)) === '내몫');

  // 각자 완료가 아닌 일정은 예전처럼 전체 상태 select 를 쓴다(그게 맞다).
  const plain = task({ perDone: false });
  const plainInline = await pg.evaluate(([p, t]) => {
    window.asMe_(p.email, p.uid, p.name); return window.inline_(t, false);
  }, [OWNER, plain]);
  check('각자 완료가 아니면 전체 상태 칸 그대로', plainInline === null, plainInline);
}

console.log('\n■ 전체 상태가 done 이면 (작성자가 직권 완료) 모두에게 완료');
{
  // 이건 의도된 동작이다. 작성자는 언제든 직권으로 끝낼 수 있다.
  await roster(FULL_ROSTER);
  const t = task({ status: 'done' });
  for (const p of [OWNER, A, B]) {
    check(`${p.name} — 완료로 보인다`, (await as(p, t)) === true);
  }
}

console.log('\n■ 각자 완료가 아닌 일정은 예전 그대로');
{
  await roster(FULL_ROSTER);
  const t = task({ perDone: false, status: 'doing', doneBy: [] });
  check('공용 상태를 따른다 (아직 진행중)', (await as(A, t)) === false);
  const done = task({ perDone: false, status: 'done' });
  check('공용 상태가 완료면 모두 완료', (await as(A, done)) === true);
}

console.log('\n■ 배선 — 받은 사람이 전체 상태를 쓰는 길을 막았나');
{
  // 화면에서 단추를 감추는 것만으로는 부족하다. 감추는 것은 실수를 줄일 뿐이다.
  check('모달 저장 — 각자 완료면 전체 상태를 안 쓴다',
        /if \(cur && cur\.perDone\) \{ closeMytaskModal\(\); return; \}/.test(HTML));
  check('목록 상태 변경 — 각자 완료면 내 몫 처리로 넘긴다',
        /cur\.perDone && cur\.ownerUid[\s\S]{0,120}return updateMytaskMyDoneInline\(/.test(HTML));
  check('화면에서도 여전히 감춘다',
        /statusFld\.style\.display = isOwner \? 'block' : 'none';/.test(HTML));

  check('새 일정에 작성자 이메일을 적어 둔다', /ownerEmail: user\.email,/.test(HTML));
  // 작성자가 정말로 전체를 끝낼 때는 한 번 묻는다 — 남은 분들 목록에서 사라지므로.
  check('직권 완료 전에 남은 사람 수를 알리고 묻는다',
        /existing\.perDone && mytaskCurrentStatus === 'done'[\s\S]{0,400}confirm\(/.test(HTML) &&
        /자기 몫을 완료하지 않았습니다/.test(HTML));
  check('그때 내 몫만 끝내는 길도 알려 준다', /내 업무 완료 처리' 를 누르세요/.test(HTML));
  check('상태 행이 전체라는 것을 적어 둔다', /전체 상태 \(공유받은 분들께도 그대로 적용됩니다\)/.test(HTML));
  check('못 찾으면 자동 완료하지 않는다',
        /const ownerDone = !!ownerEmail && doneBy\.some\(d => d\.id === ownerEmail\);/.test(HTML));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
