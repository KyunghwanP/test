// 외출증 보안 규칙 검증.
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-ynhs',
  firestore: { host: '127.0.0.1', port: 8099, rules: fs.readFileSync('firestore.rules', 'utf8') },
});

const DAY = '2026-08-19';
const base = { grade: 1, room: 3, num: 7, name: '김학생', kind: '조퇴',
               reason: '병원', outAt: '14:30', backAt: '', guardian: '전화',
               issuedName: '홍길동', createdAt: '2026-08-19T05:00:00Z' };

await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  await setDoc(doc(d, 'passes', DAY, 'items', 'byHong'),  { ...base, issuedBy: 'hong@yeungnam.hs.kr' });
  await setDoc(doc(d, 'passes', DAY, 'items', 'byKim'),   { ...base, issuedBy: 'kim@yeungnam.hs.kr' });
});

const who = (email, uid) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const hong    = who('hong@yeungnam.hs.kr', 'u1');       // 발급자
const kim     = who('kim@yeungnam.hs.kr',  'u2');       // 다른 교사
const admin   = who('pkh910518@yeungnam.hs.kr', 'u3');
const student = who('1030712@yeungnam.hs.kr', 'u4');
const outside = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, p) {
  try { await p; pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '\n       →', String(e.message).slice(0, 150)); }
}
const items = db => collection(db, 'passes', DAY, 'items');

console.log('\n■ 조회 — 교사끼리만');
await t('교사는 목록을 본다',        assertSucceeds(getDocs(items(hong))));
await t('다른 교사도 본다(교문 확인)', assertSucceeds(getDocs(items(kim))));
await t('관리자도 본다',            assertSucceeds(getDocs(items(admin))));
await t('학생 계정은 못 본다',       assertFails(getDocs(items(student))));
await t('비로그인은 못 본다',        assertFails(getDocs(items(outside))));

console.log('\n■ 발급 — 교사 누구나, 단 자기 이름으로만');
await t('교사가 발급할 수 있다',
        assertSucceeds(addDoc(items(kim), { ...base, issuedBy: 'kim@yeungnam.hs.kr' })));
await t('담임이 아니어도 발급 가능(담임 부재 대비)',
        assertSucceeds(addDoc(items(hong), { ...base, grade: 2, room: 5, issuedBy: 'hong@yeungnam.hs.kr' })));
await t('남의 이름으로는 못 끊는다',
        assertFails(addDoc(items(kim), { ...base, issuedBy: 'hong@yeungnam.hs.kr' })));
await t('발급자를 비워도 안 된다',
        assertFails(addDoc(items(kim), { ...base, issuedBy: '' })));
await t('학생 계정은 발급 불가',
        assertFails(addDoc(items(student), { ...base, issuedBy: '1030712@yeungnam.hs.kr' })));

console.log('\n■ 수정 — 발급자 본인과 관리자만, 발급자는 못 바꾼다');
await t('발급자 본인은 고칠 수 있다',
        assertSucceeds(updateDoc(doc(hong, 'passes', DAY, 'items', 'byHong'), { reason: '치과' })));
await t('다른 교사는 못 고친다',
        assertFails(updateDoc(doc(kim, 'passes', DAY, 'items', 'byHong'), { reason: '조작' })));
await t('관리자는 고칠 수 있다',
        assertSucceeds(updateDoc(doc(admin, 'passes', DAY, 'items', 'byHong'), { reason: '정정' })));
await t('발급자 이름은 못 바꾼다 (기록이 의미를 잃지 않게)',
        assertFails(updateDoc(doc(hong, 'passes', DAY, 'items', 'byHong'), { issuedBy: 'kim@yeungnam.hs.kr' })));
await t('관리자도 발급자는 못 바꾼다',
        assertFails(updateDoc(doc(admin, 'passes', DAY, 'items', 'byHong'), { issuedBy: 'kim@yeungnam.hs.kr' })));

console.log('\n■ 삭제 — 발급자 본인과 관리자만');
await t('다른 교사는 못 지운다', assertFails(deleteDoc(doc(kim, 'passes', DAY, 'items', 'byHong'))));
await t('발급자 본인은 지운다',  assertSucceeds(deleteDoc(doc(hong, 'passes', DAY, 'items', 'byHong'))));
await t('관리자는 남의 것도 지운다', assertSucceeds(deleteDoc(doc(admin, 'passes', DAY, 'items', 'byKim'))));

console.log('\n■ 날짜 문서 자체는 쓰지 못한다');
await t('교사도 날짜 문서는 못 쓴다', assertFails(setDoc(doc(hong, 'passes', DAY), { x: 1 })));
await t('관리자도 못 쓴다',          assertFails(setDoc(doc(admin, 'passes', DAY), { x: 1 })));

await env.cleanup();
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
