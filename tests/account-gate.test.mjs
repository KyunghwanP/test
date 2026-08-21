// 학생 계정 차단 검증.
// index.html 에서 실제 판정 함수를 떼어내 돌리고, firestore.rules · 워커가
// '같은' 조건을 쓰고 있는지도 함께 확인한다. 한 곳만 고치면 어긋나기 때문이다.
import fs from 'node:fs';

const root  = import.meta.dirname + '/..';
const html  = fs.readFileSync(root + '/index.html', 'utf8');
const rules = fs.readFileSync(root + '/firestore.rules', 'utf8');

const pick = (src, re, what) => { const m = re.exec(src); if (!m) throw new Error('못 찾음: ' + what); return m[0]; };

const src = [
  pick(html, /^const ALLOWED_EMAIL_DOMAIN = .*$/m, 'ALLOWED_EMAIL_DOMAIN'),
  pick(html, /^const STUDENT_EMAIL_RE = .*$/m, 'STUDENT_EMAIL_RE'),
  pick(html, /^const isTeacherAccount = u => \{[\s\S]*?\n\};$/m, 'isTeacherAccount'),
  'return { isTeacherAccount, STUDENT_EMAIL_RE };'
].join('\n');
const { isTeacherAccount } = new Function(src)();

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

console.log('\n── 교사 계정은 통과 ──');
for (const e of ['pkh910518@yeungnam.hs.kr', 'hong@yeungnam.hs.kr', 'kim2@yeungnam.hs.kr',
                 'teacher123@yeungnam.hs.kr', 'a1234567b@yeungnam.hs.kr'])
  check(e, isTeacherAccount({ email: e }) === true);

console.log('\n── 학생 계정(학번 7자리)은 차단 ──');
for (const e of ['1234567@yeungnam.hs.kr', '0000000@yeungnam.hs.kr', '9999999@yeungnam.hs.kr'])
  check(e, isTeacherAccount({ email: e }) === false);
// 대문자로 와도 막혀야 한다(구글이 표기를 바꿔 보내는 경우)
check('1234567@YEUNGNAM.HS.KR (대문자)', isTeacherAccount({ email: '1234567@YEUNGNAM.HS.KR' }) === false);

console.log('\n── 자릿수가 다르면 학생이 아니다(교사 아이디일 수 있음) ──');
for (const e of ['123456@yeungnam.hs.kr', '12345678@yeungnam.hs.kr'])
  check(e + ' 통과', isTeacherAccount({ email: e }) === true);

console.log('\n── 도메인이 다르면 차단 ──');
for (const e of ['someone@gmail.com', 'a@yeungnam.hs.kr.evil.com', 'b@sub.yeungnam.hs.kr', ''])
  check(JSON.stringify(e), isTeacherAccount({ email: e }) === false);
check('email 없음', isTeacherAccount({}) === false);
check('user 없음', isTeacherAccount(null) === false);

console.log('\n── 규칙·워커와 조건이 같은지 ──');
const ruleAllows = rules.split('\n').filter(l => /allow (read|write|create|update|delete|list|get)/.test(l)).length;
check('firestore.rules 에 allow 문이 있다 (' + ruleAllows + '개)', ruleAllows > 0, ruleAllows);
check('firestore.rules 가 학번 7자리를 제외한다',
      /\^\[0-9\]\{7\}@yeungnam\[\.\]hs\[\.\]kr\$/.test(rules));
for (const f of ['workers/teacher-api.js', 'workers/consult-api.js']) {
  const w = fs.readFileSync(root + '/' + f, 'utf8');
  check(f + ' 가 학번 7자리를 제외한다', /\^\[0-9\]\{7\}@yeungnam\\?\.hs\\?\.kr\$/.test(w));
}
const memo = fs.readFileSync(root + '/memo2.html', 'utf8');
check('memo2.html 이 학번 7자리를 제외한다', /\^\[0-9\]\{7\}@/.test(memo));

console.log('\n── 도메인만 보는 옛 검사가 남아 있지 않은지 ──');
const stale = html.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /\.email(\s*\|\|\s*'')?\s*\.endsWith\(ALLOWED_EMAIL_DOMAIN\)/.test(l)
                  && !/isTeacherAccount/.test(l));
check('user.email.endsWith(...) 직접 호출 없음', stale.length === 0, stale);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}개 통과, ${fail}개 실패\n`);
process.exit(fail === 0 ? 0 : 1);
