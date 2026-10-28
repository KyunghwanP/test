// 생기부 담임 작성(saenggibuDraft·saenggibuDraftHist) 보안 규칙 — 그 반 담임과 앱 관리자만, 다른 반은 조회도 안 된다.
// 에뮬레이터를 먼저 띄운다(tests/README.md 「보안 규칙」): npx firebase emulators:start --only firestore (8099)
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-ynhs',
  firestore: { host: '127.0.0.1', port: 8099, rules: fs.readFileSync('firestore.rules', 'utf8') },
});

const draft = { ja: '자율 최종안.', jin: '', gae: '', haeng: '행특은 담임만.', hold: { ja: '빼 둔 문장.' }, memo: '상담 메모' };
await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  // 담임 명단 — 이메일: '학년-반'(동기화가 '2-3' 으로 맞춰 두지만 원본 표기 '2-03' 이 올 수도 있다)
  await setDoc(doc(d, 'acl', 'gradeRoles'), { managers: ['boss@yeungnam.hs.kr'],
    homerooms: { 'kim@yeungnam.hs.kr': '1-1', 'park@yeungnam.hs.kr': '2-03' } });
  for (const k of ['1-1-1', '1-2-1', '2-3-4', '3-1-1']) {
    await setDoc(doc(d, 'saenggibuDraft', k), draft);
    await setDoc(doc(d, 'saenggibuDraftHist', k), { ja: [{ t: '예전 판', at: '2026-10-28T00:00:00Z' }] });
  }
});

const who = (email, uid) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const kim     = who('kim@yeungnam.hs.kr', 'u1');        // 1학년 1반 담임
const park    = who('park@yeungnam.hs.kr', 'u2');       // 2학년 3반 담임(명단에 '2-03')
const lee     = who('lee@yeungnam.hs.kr', 'u3');        // 담임 아닌 교사
const boss    = who('boss@yeungnam.hs.kr', 'u4');       // 성적 전체열람 권한자 — 담임 작성은 못 본다
const admin   = who('pkh910518@yeungnam.hs.kr', 'u5');  // 앱 관리자(마스터)
const student = who('1010101@yeungnam.hs.kr', 'u6');
const outside = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, p) {
  try { await p; pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '\n       →', String(e.message).slice(0, 150)); }
}
const D = (db, k) => doc(db, 'saenggibuDraft', k), H = (db, k) => doc(db, 'saenggibuDraftHist', k);

console.log('\n■ 담임 — 자기 반만');
await t('1-1 담임은 1-1-1 을 읽는다',            assertSucceeds(getDoc(D(kim, '1-1-1'))));
await t('— 쓴다',                                 assertSucceeds(setDoc(D(kim, '1-1-1'), { ja: '고친 글' }, { merge: true })));
await t('— 새 학생 문서도 만든다(1-1-25)',         assertSucceeds(setDoc(D(kim, '1-1-25'), { ja: '처음' })));
await t('— 되돌리기 기록도 읽고 쓴다',             assertSucceeds(setDoc(H(kim, '1-1-1'), { ja: [] }, { merge: true })));
await t('다른 반(1-2-1)은 조회도 안 된다',         assertFails(getDoc(D(kim, '1-2-1'))));
await t('— 다른 반 되돌리기 기록도',               assertFails(getDoc(H(kim, '1-2-1'))));
await t('— 쓰기도 안 된다',                         assertFails(setDoc(D(kim, '1-2-1'), { ja: '남의 반' }, { merge: true })));
await t('— 다른 학년 같은 반(2-1-1)도 안 된다',     assertFails(getDoc(D(kim, '2-1-1'))));
await t('— 지우기도 안 된다',                       assertFails(deleteDoc(D(kim, '1-2-1'))));
await t("명단에 '2-03' 으로 적힌 담임도 2-3-4 를 읽는다", assertSucceeds(getDoc(D(park, '2-3-4'))));
await t('— 그 담임도 1-1-1 은 못 본다',             assertFails(getDoc(D(park, '1-1-1'))));

console.log('\n■ 담임이 아닌 교사 · 학생 · 로그인 안 함');
await t('담임 아닌 교사는 못 본다',                 assertFails(getDoc(D(lee, '1-1-1'))));
await t('— 쓰지도 못한다',                           assertFails(setDoc(D(lee, '1-1-1'), { ja: 'x' }, { merge: true })));
await t('성적 전체열람 권한자도 못 본다(행특은 담임 권한)', assertFails(getDoc(D(boss, '1-1-1'))));
await t('학생 계정은 못 본다',                       assertFails(getDoc(D(student, '1-1-1'))));
await t('로그인 안 하면 못 본다',                    assertFails(getDoc(D(outside, '1-1-1'))));

console.log('\n■ 앱 관리자(마스터) — 모든 반');
await t('관리자는 1-1-1 을 읽는다',                  assertSucceeds(getDoc(D(admin, '1-1-1'))));
await t('— 3-1-1 도 읽고 쓴다',                      assertSucceeds(setDoc(D(admin, '3-1-1'), { jin: '관리자가 고침' }, { merge: true })));
await t('— 되돌리기 기록도',                          assertSucceeds(getDoc(H(admin, '2-3-4'))));

console.log('\n■ 문서 ID 모양');
await t("반 문서('1-1')는 안 된다",                   assertFails(getDoc(D(kim, '1-1'))));
await t("엉뚱한 ID('1-1-1-x')는 안 된다",              assertFails(getDoc(D(kim, '1-1-1-x'))));
await t('관리자도 엉뚱한 ID 는 안 된다',               assertFails(setDoc(D(admin, 'all'), { ja: 'x' })));

await env.cleanup();
console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
