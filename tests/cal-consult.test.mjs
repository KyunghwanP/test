// 업무 캘린더의 상담 예약 표시.
// index.html 에서 실제 함수·마크업을 떼어 온다 — 여기 옮겨 적으면 검사가 아니라 장식이 된다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const grab = name => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(html);
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

const { consultCalItems } = new Function(grab('consultCalItems') + '\nreturn { consultCalItems };')();

// ── 학교 자료를 흉내낸다 ──────────────────────────────────────────
const slots = [
  { id:'a', date:'2026-08-24', time:'14:00', status:'booked', studentName:'김민준', studentNum:7,
    bookedName:'김민준 학부모', bookedPhone:'010-0000-0000', bookedType:'face', bookedMemo:'진로 관련' },
  { id:'b', date:'2026-08-24', time:'09:30', status:'booked', bookedName:'이서연 학부모', bookedType:'phone' },
  { id:'c', date:'2026-08-26', time:'15:00', status:'booked', studentName:'박지호' },
  { id:'d', date:'2026-08-25', time:'10:00', status:'open' },            // 빈 슬롯
  { id:'e', date:'2026-09-01', time:'11:00', status:'booked', studentName:'다음달' }
];

console.log('\n■ 그 달의 예약만 추린다');
{
  const r = consultCalItems(slots, '2026-08');
  check('예약된 것만 (빈 슬롯 제외)', r.length === 3, r.map(x => x.id));
  check('다른 달은 안 들어온다', !r.some(x => x.id === 'e'), r.map(x => x.id));
  check('날짜·시각 순', r.map(x => x.id).join('') === 'bac', r.map(x => x.id));
}

console.log('\n■ 이름은 앱의 다른 화면과 같은 순서로 고른다');
{
  const r = consultCalItems(slots, '2026-08');
  const by = id => r.find(x => x.id === id);
  check('studentName 이 있으면 그것', by('a').who === '김민준', by('a'));
  check('없으면 bookedName', by('b').who === '이서연 학부모', by('b'));
  check('칩 글자는 시각 + 이름', by('a').title === '14:00 김민준', by('a').title);
}

console.log('\n■ 자료가 없거나 이상해도 안 터진다');
for (const [n, v] of [['undefined', undefined], ['null', null], ['배열 아님', {}], ['빈 배열', []]])
  check(n, consultCalItems(v, '2026-08').length === 0);
check('date 없는 슬롯', consultCalItems([{ id:'x', status:'booked' }], '2026-08').length === 0);
check('이름이 아무것도 없으면 학부모',
      consultCalItems([{ id:'x', date:'2026-08-24', time:'', status:'booked' }], '2026-08')[0].who === '학부모');

console.log('\n■ 두 레이아웃이 모두 상담을 그린다');
{
  // 업무 페이지는 레이아웃이 둘이다. 모바일(#mytaskMobileBody → renderMytaskCalendar)과
  // PC(#mytaskPanelContainer → renderRows/buildPanelCalendar). 처음엔 모바일만 고쳐서
  // PC 에서는 버튼조차 안 보였다. 한쪽만 고치는 실수를 여기서 잡는다.
  check('모바일 캘린더 칸',   /const consultItems = calFilters\.has\('consult'\)/.test(html));
  check('모바일 우클릭 팝업', /const consultRows = calFilters\.has\('consult'\)/.test(html));
  check('PC 패널 칸',         /const consultItems = panel\.showConsult \? consultCalItems\(/.test(html));
  check('PC 패널 미리보기',   /const consultRows = \(panel && panel\.showConsult\)/.test(html));
  check('날짜 상세(공용)',    /consultHtml = consultCalItems\(/.test(html));

  const cnt = (html.match(/consultCalItems\(/g) || []).length;
  check(`consultCalItems 호출이 5곳 (${cnt - 1}곳)`, cnt - 1 >= 5, cnt - 1);   // 정의 1 제외

  check('빈 날 판정에 상담도 넣는다', /!scheduleHtml && !consultHtml && !taskHtml/.test(html));
  check('패널 기본값에 showConsult', /showSchedule:false, showConsult:false/.test(html));
  check('패널 토글 함수가 있다', /function togglePanelConsult\(/.test(html));
  check('학사일정 토글 옆에 상담 토글', /togglePanelConsult\(/.test(html));
}

console.log('\n■ 날짜 상세는 어느 레이아웃에서 켰든 보인다');
{
  const { consultOn } = new Function(
    'calFilters', 'rows',
    grab('consultOn') + '\nreturn { consultOn };'
  )(new Set(), [{ panels: [{ showConsult: true }] }]);
  check('PC 패널만 켜져 있어도 참', consultOn() === true);

  const off = new Function('calFilters', 'rows', grab('consultOn') + '\nreturn { consultOn };')(
    new Set(), [{ panels: [{ showConsult: false }] }]);
  check('둘 다 꺼져 있으면 거짓', off.consultOn() === false);

  const mob = new Function('calFilters', 'rows', grab('consultOn') + '\nreturn { consultOn };')(
    new Set(['consult']), []);
  check('모바일만 켜져 있어도 참', mob.consultOn() === true);

  const broken = new Function('calFilters', 'rows', grab('consultOn') + '\nreturn { consultOn };')(
    new Set(), undefined);
  check('rows 가 없어도 안 터진다', broken.consultOn() === false);
}

console.log('\n■ 조회를 새로 만들지 않는다 (읽기 사용량)');
{
  // 이미 있는 두 구독(알림 감시 · 상담 화면)만 있어야 한다. 캘린더용으로 하나 더 붙이면 늘어난다.
  const subs = (html.match(/onSnapshot\(doc\(fbDb, 'consultations'/g) || []).length;
  check(`consultations 실시간 구독이 2곳 (${subs}곳)`, subs === 2, subs);
  check('알림 구독이 캘린더와 나눠 쓴다', /window\._consultSlots = booked;/.test(html));
}

console.log('\n■ 목록 보기에도 들어간다');
{
  check('모바일 목록에 칩', /data-filter="consult" id="listFilterConsult"/.test(html));
  check('모바일 목록이 상담을 섞는다', /listFilters\.has\('consult'\) \? consultCalItems\(window\._consultSlots\)/.test(html));
  check('PC 패널 목록이 상담을 섞는다', /buildPanelList\(tasks,\s*\n\s*panel\.showConsult \?/.test(html));
  check('두 목록이 같은 줄 만들기를 쓴다',
        (html.match(/consultListRow\(t\)/g) || []).length === 2,
        (html.match(/consultListRow\(t\)/g) || []).length);
  check('두 목록이 같은 섞기를 쓴다',
        (html.match(/mergeListItems\(/g) || []).length >= 3,   // 정의 1 + 호출 2
        (html.match(/mergeListItems\(/g) || []).length);
  check('패널 목록에서도 상담 버튼이 뜬다',
        /\$\{consultAvailable\(\) \? '<button class="mytask-filter-btn '/.test(html));
  check('기간 필터를 업무와 같이 쓴다', /panel\.showConsult \? filterByPanelPeriod\(consultCalItems/.test(html));
}

console.log('\n■ 상담은 업무 상태와 섞이지 않는다');
{
  const mk = init => {
    const box = { listFilters: new Set(init) };
    const fn = new Function('state', `
      let listFilters = state.listFilters;
      ${grab('toggleListFilter').replace(/document\.querySelectorAll[\s\S]*?\}\);/, '')
                                .replace(/renderMytaskList\(\);?/, '')}
      return f => { toggleListFilter(f); state.listFilters = listFilters; };
    `)(box);
    return { box, toggle: fn };
  };

  let { box, toggle } = mk(['all']);
  toggle('consult');
  check("'전체' 에 상담을 얹어도 전체가 유지된다",
        box.listFilters.has('all') && box.listFilters.has('consult'), [...box.listFilters]);

  ({ box, toggle } = mk(['all', 'consult']));
  toggle('all');
  check("'전체' 를 다시 눌러도 상담은 남는다",
        box.listFilters.has('consult'), [...box.listFilters]);

  ({ box, toggle } = mk(['all', 'consult']));
  toggle('todo');
  check('상태를 고르면 전체는 빠지고 상담은 남는다',
        !box.listFilters.has('all') && box.listFilters.has('todo') && box.listFilters.has('consult'),
        [...box.listFilters]);

  ({ box, toggle } = mk(['todo', 'consult']));
  toggle('todo');
  check('상태를 다 끄면 전체로 돌아간다(상담은 유지)',
        box.listFilters.has('all') && box.listFilters.has('consult'), [...box.listFilters]);

  ({ box, toggle } = mk(['all', 'consult']));
  toggle('consult');
  check('상담만 끌 수 있다',
        box.listFilters.has('all') && !box.listFilters.has('consult'), [...box.listFilters]);
}

console.log('\n■ 목록용 상담 목록은 달을 안 가린다');
{
  const all = consultCalItems(slots);
  check('ym 을 안 주면 전체 달', all.length === 4, all.map(x => x.id));
  check('ym 을 주면 그 달만', consultCalItems(slots, '2026-08').length === 3);
  check('기간 필터가 볼 수 있게 startDate/endDate 가 있다',
        all.every(x => x.startDate === x.date && x.endDate === x.date), all[0]);
}

console.log('\n■ 가장(실제 권한으로 보기) 모드에서도 보인다');
{
  // 관리자 미리보기는 기능이 되는지 확인하려고 있는 화면이다. 예전에는 상담 구독이
  // 알림 묶음(if(!isViewAs()){...}) 안에 있어서 미리보기에서 기능이 통째로 사라졌다.
  const call = /startConsultNotifyWatch\(user, \{ notify: !isViewAs\(\) \}\);/;
  check('구독은 가장 모드에서도 붙인다', call.test(html));

  // 호출이 if(!isViewAs()) 블록 '밖'에 있어야 한다
  const gate = html.indexOf('if(!isViewAs()){\n      initNotify();');
  const at   = html.search(call);
  check('알림 묶음 밖에서 부른다', at >= 0 && gate >= 0 && at < gate, { at, gate });

  check('알림은 옵션으로 끈다',
        (html.match(/if\(notify\) showAppNotify\(/g) || []).length === 2,
        (html.match(/if\(notify\) showAppNotify\(/g) || []).length);
  check('옵션을 안 주면 알림은 켜진 채다',
        /const notify = !\(opts && opts\.notify === false\);/.test(html));
  check('가장 모드에서 알림 감시는 그대로 뺀다',
        /if\(!isViewAs\(\)\)\{\s*\n\s*initNotify\(\);\s*\n\s*startTaskNotifyWatch/.test(html));
}

console.log('\n■ 담임에게만 버튼이 보인다');
{
  check('버튼이 기본 숨김', /id="calFilterConsult"[^>]*style="display:none;"/.test(html));
  check('구독이 붙는 자리에서만 켠다',
        /for \(const id of \['calFilterConsult', 'listFilterConsult'\]\)/.test(html));
  check('목록 칩도 기본 숨김', /id="listFilterConsult"[^>]*style="display:none;"/.test(html));
  check('PC 패널 버튼도 같은 조건', (html.match(/consultAvailable\(\)/g) || []).length >= 3);
  check('판정은 구독이 붙었는지로 한다', /function consultAvailable\(\) \{ return Array\.isArray\(window\._consultSlots\); \}/.test(html));
  // startConsultNotifyWatch 는 담임(또는 관리자)이 아니면 구독 전에 return 한다
  check('담임 아니면 구독 자체를 안 한다', /if\(!classKey\) return;/.test(grab('startConsultNotifyWatch')));
}

// ── 상세 모달을 실제 브라우저에서 ────────────────────────────────
console.log('\n■ 칩을 누르면 뜨는 상세 (실제 Chromium)');
{
  const a = html.indexOf('<div class="mytask-modal" id="consultPeekModal"');
  const b = html.indexOf('<div class="mytask-modal" id="mytaskDayModal"');
  if (a < 0 || b < 0) throw new Error('상세 모달 마크업 못 찾음');
  const markup = html.slice(a, b);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>:root{--rule:#ddd;--ink-soft:#777;--mon:#3B5170;}
      .mytask-modal{display:none;position:fixed;inset:0;}
      .mytask-modal.show{display:flex;}
    </style>${markup}
    <script>
      ${grab('escapeHtml')}
      function navigateTo(){ window.__went = true; }
      window._consultSlots = ${JSON.stringify(slots)};
      ${grab('openConsultPeek')}
      ${grab('closeConsultPeek')}
    </script>`);

  const shown = () => page.evaluate(() =>
    document.getElementById('consultPeekModal').classList.contains('show'));
  const body = () => page.evaluate(() => document.getElementById('cpkBody').textContent);
  const title = () => page.evaluate(() => document.getElementById('cpkTitle').textContent);

  check('처음엔 닫혀 있다', await shown() === false);

  await page.evaluate(() => openConsultPeek('a'));
  check('열린다', await shown() === true);
  check('제목이 날짜·시각', (await title()) === '2026-08-24 14:00', await title());
  const t = await body();
  check('학생 이름과 번호', t.includes('김민준') && t.includes('7번'), t);
  check('예약자',   t.includes('김민준 학부모'), t);
  check('연락처',   t.includes('010-0000-0000'), t);
  check('대면/전화', t.includes('대면'), t);
  check('남긴 말',   t.includes('진로 관련'), t);

  await page.evaluate(() => closeConsultPeek());
  check('닫힌다', await shown() === false);

  await page.evaluate(() => openConsultPeek('b'));
  const t2 = await body();
  check('학생 이름 없는 예약도 뜬다', t2.includes('이서연 학부모'), t2);
  check('전화 예약은 전화로', t2.includes('전화'), t2);

  await page.evaluate(() => closeConsultPeek());
  await page.evaluate(() => openConsultPeek('없는id'));
  check('없는 예약이면 안 열린다', await shown() === false);

  // 이름에 태그를 넣어도 그대로 글자로 나와야 한다
  await page.evaluate(() => { window._consultSlots = [{ id:'x', date:'2026-08-24', time:'14:00',
    status:'booked', studentName:'<img src=x onerror=alert(1)>' }]; openConsultPeek('x'); });
  check('이름의 태그가 실행되지 않는다',
        await page.evaluate(() => document.querySelectorAll('#cpkBody img').length) === 0);

  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
