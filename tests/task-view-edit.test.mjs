// 작성자가 기존 일정을 열면 편집 폼이 아니라 읽기 요약이 먼저 나오는지.
//
// 2026-08: 현황판에서 진행중인 업무를 누르면 곧바로 입력창이 떴다. 읽으려고
// 누른 것이지 고치려고 누른 게 아닌데도 그랬다. '수정'을 눌러야 폼이 나오게 한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = html.indexOf('{', m.index), d = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

console.log('\n■ 배선 (소스에서 직접)');
{
  check('푸터에 수정 버튼이 있다', /id="mytaskEditBtn"[^>]*onclick="mytaskEnterEdit\(\)"/.test(html));
  check('수정 버튼은 기본 숨김', /id="mytaskEditBtn"[^>]*style="display:none;"/.test(html));
  check('mytaskEnterEdit 를 window 에 내보낸다', /window\.mytaskEnterEdit\s*=\s*mytaskEnterEdit;/.test(html));
  check('기존 일정 + 작성자일 때만 읽기 우선', /const viewFirst = !!id && isOwner;/.test(html));
  check('읽기 화면에서는 편집 영역을 감춘다',
        /ownerSec\.style\.display = \(isOwner && !viewFirst\) \? 'block' : 'none';/.test(html));
  check('읽기 화면에서 저장 버튼은 상태 저장',
        /saveBtn\.textContent\s+= \(isOwner && !viewFirst\) \? '저장' : '상태 저장';/.test(html));
  check('숨은 제목칸의 높이를 재지 않는다', /if \(isOwner && !viewFirst\) \{/.test(html));
  check('.mytask-btn-edit 스타일이 있다', /\.mytask-btn-edit\{/.test(html));
}

console.log('\n■ 실제 동작 (Chromium)');
{
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const a = html.indexOf('<div id="mytaskRecvInfo"');
  const b = html.indexOf('<!-- 댓글 -->');   // 상태 버튼까지 포함해야 한다
  const body = html.slice(a, b);
  const footA = html.indexOf('<div class="mytask-modal-footer">');
  const footB = html.indexOf('</div>', html.indexOf('id="mytaskSaveBtn"'));
  const footer = html.slice(footA, footB + 6);

  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pg = await b2.newPage();
  await pg.setContent(`<!doctype html><style>${css}</style><body>
    <div class="mytask-modal show"><div class="mytask-modal-box">
      <div class="mytask-modal-title" id="mytaskModalTitle">일정 상세</div>
      ${body}${footer}
    </div></div></body>`);

  await pg.addScriptTag({ content: `
    window.escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.TEACHERS = [
      { name:'김민준', email:'kim@yeungnam.hs.kr', uid:'u-kim' },
      { name:'이서연', email:'lee@yeungnam.hs.kr', uid:'u-lee' }
    ];
    window.fbAuth = { currentUser: { uid:'u-kim', email:'kim@yeungnam.hs.kr' } };
    window.formatMytaskDateRange = t => t.startDate === t.endDate ? t.startDate : t.startDate + ' ~ ' + t.endDate;
    ${/const MYTASK_REPEAT_LABEL = \{[^}]*\};/.exec(html)[0]}
    ${grab('renderMytaskRecvInfo')}
    ${grab('mytaskEnterEdit')}
    window.renderMytaskRecvInfo = renderMytaskRecvInfo;
    window.mytaskEnterEdit = mytaskEnterEdit;
  `});

  const TASK = { id:'t1', title:'8월 출결 마감 및 서류 제출(3학년)',
    memo:'- 출결 마감\n- 제출처 : 문광섭 선생님', startDate:'2026-08-31', endDate:'2026-08-31',
    ownerUid:'u-kim', sharedWith:['lee@yeungnam.hs.kr'], repeat:{ type:'weekly', until:'2026-12-31' } };

  // 작성자가 연 상태를 흉내낸다: 요약 보이고 편집 영역 숨김
  await pg.evaluate(t => {
    document.getElementById('mytaskTitle').value = t.title;
    document.getElementById('mytaskMemo').value  = t.memo;
    document.getElementById('mytaskOwnerSection').style.display = 'none';
    document.getElementById('mytaskEditBtn').style.display = 'block';
    document.getElementById('mytaskSaveBtn').textContent = '상태 저장';
    renderMytaskRecvInfo(t, true);
  }, TASK);

  const vis = id => pg.$eval('#' + id, el => el.getClientRects().length > 0);
  check('요약이 보인다', await vis('mytaskRecvInfo'));
  check('편집 폼은 안 보인다', !(await vis('mytaskOwnerSection')));
  check('제목 입력칸이 화면에 없다', !(await vis('mytaskTitle')));
  check('수정 버튼이 보인다', await vis('mytaskEditBtn'));
  check('저장 버튼은 상태 저장', (await pg.$eval('#mytaskSaveBtn', e => e.textContent)) === '상태 저장');
  check('상태 버튼은 요약 화면에서도 살아 있다', await vis('mytaskStatusField'));

  const txt = await pg.$eval('#mytaskRecvInfo', el => el.innerText);
  check('제목이 그대로', txt.includes('8월 출결 마감 및 서류 제출(3학년)'), txt);
  check('작성자에게는 공유 담당자를 보여준다', txt.includes('공유 담당자') && txt.includes('이서연'), txt);
  check("작성자 화면에 '공유한 사람' 줄은 없다", !txt.includes('공유한 사람'), txt);
  check('반복도 보여준다', txt.includes('매주') && txt.includes('2026-12-31'), txt);
  check('메모 줄바꿈이 살아 있다', txt.includes('- 출결 마감\n- 제출처'), txt);

  // 수정 누르기
  await pg.click('#mytaskEditBtn');
  check('수정 후 편집 폼이 열린다', await vis('mytaskOwnerSection'));
  check('수정 후 요약은 사라진다', !(await vis('mytaskRecvInfo')));
  check('수정 후 수정 버튼은 사라진다', !(await vis('mytaskEditBtn')));
  check('수정 후 저장 버튼은 저장', (await pg.$eval('#mytaskSaveBtn', e => e.textContent)) === '저장');
  check('수정 후 모달 제목이 일정 수정', (await pg.$eval('#mytaskModalTitle', e => e.textContent)) === '일정 수정');
  check('제목칸에 원래 값이 들어 있다',
        (await pg.$eval('#mytaskTitle', e => e.value)) === TASK.title);
  const h = await pg.$eval('#mytaskTitle', e => parseInt(e.style.height));
  check('제목칸 높이가 0으로 접히지 않았다', h > 20, h);

  // 수신자 화면은 그대로여야 한다 (회귀)
  await pg.evaluate(t => {
    window.fbAuth.currentUser = { uid:'u-lee', email:'lee@yeungnam.hs.kr' };
    renderMytaskRecvInfo({ ...t, ownerName:'김민준' }, false);
  }, TASK);
  const rtxt = await pg.$eval('#mytaskRecvInfo', el => el.innerText);
  check('수신자는 여전히 공유한 사람을 본다', rtxt.includes('공유한 사람') && rtxt.includes('김민준'), rtxt);
  check('수신자 화면의 나는 (나) 표시', rtxt.includes('(나)'), rtxt);

  await b2.close();
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
