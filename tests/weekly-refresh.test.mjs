// 주간교육활동이 '고쳐도 안 바뀌던' 문제.
//
// 본문 HTML 은 스크래핑 액션이 만드는 것이 아니다. 앱이 Apps Script 프록시로
// 긁어 weeklyData/cache-* 에 스스로 넣고, 한 시간 동안 그것을 다시 읽는다.
// 액션이 쓰는 것은 주차 '목록'(weeklyData/index)과 학사일정뿐이다.
//
// 그래서 사이트를 고치고 액션을 다시 돌려도 화면은 그대로였다. 고친 길은 둘이다.
//   · 액션이 끝에 본문 캐시를 비운다      → 액션을 돌리는 것이 곧 '본문도 새로'
//   · 앱에 '새로 받기' 단추를 둔다        → 기다리지 않고 지금 받는다
//
// 여기서 특히 보는 것은 캐시를 비울 때 index·summary 를 같이 지우지 않는가다.
// 지우면 주차 칩과 현황판 AI 요약이 통째로 사라진다.
process.env.TZ = 'Asia/Seoul';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const GAS  = fs.readFileSync(import.meta.dirname + '/../gas/Code.gs', 'utf8');
// 스크래퍼는 test 저장소에만 있다. 없으면 그 묶음은 건너뛴다.
const SCRAPER_PATH = import.meta.dirname + '/../scripts/scrape-weekly.js';
const SCRAPER = fs.existsSync(SCRAPER_PATH) ? fs.readFileSync(SCRAPER_PATH, 'utf8') : null;

let pass = 0, fail = 0, skip = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

console.log('\n■ 앱 — 캐시 키와 받아오기를 한 군데로');
{
  check('캐시 키를 만드는 함수가 하나다', /function weeklyCacheId\(url\)\{/.test(HTML));
  check('첫 화면만 이름이 따로다', /if \(!url \|\| url === SITES_BASE\) return 'cache-current';/.test(HTML));
  // 슬러그 만드는 식이 두 군데 흩어져 있으면 한쪽만 고쳐진다
  const slugCount = (HTML.match(/encodeURIComponent\(url\)\.replace\(\/%\/g,'_'\)\.slice\(-40\)/g) || []).length
                  + (HTML.match(/encodeURIComponent\(week\.href\)\.replace\(\/%\/g,'_'\)\.slice\(-40\)/g) || []).length;
  check('슬러그 만드는 식이 한 군데뿐이다', slugCount === 1, slugCount);

  check('한 시간 상수가 하나다', /const WEEKLY_TTL = 60 \* 60 \* 1000;/.test(HTML));
  check('옛 지역 상수(ONE_HOUR)가 안 남아 있다', !/const ONE_HOUR = 60 \* 60 \* 1000;/.test(HTML));

  check('주차 하나 받아오기가 공용 함수다', /async function loadWeekViaAppsScript\(url\)\{/.test(HTML));
  check('칩 클릭이 그 공용 함수를 쓴다', /await loadWeekViaAppsScript\(week\.href\);/.test(HTML));
}

console.log('\n■ 앱 — 새로 받기 (관리자만, 원본보기 왼쪽)');
{
  // 정적 markup 에 두면 관리자가 아닌 사람에게도 잠깐 보였다가 사라진다.
  // 아예 관리자일 때만 만든다.
  check('정적 markup 에 단추가 없다', !/id="weeklyReloadBtn"/.test(HTML));
  check('만드는 함수가 있다', /function weeklyReloadBtnEl\(\)\{/.test(HTML));
  check('관리자가 아니면 안 만든다',
        /if \(typeof _IS_ADMIN !== 'function' \|\| !_IS_ADMIN\(\)\) return null;/.test(HTML));
  check('누르면 새로 받는다', /b\.addEventListener\('click', weeklyReload\);/.test(HTML));

  // 제목줄은 본문을 다시 그릴 때마다 새로 만들어진다. 세 갈래 모두에 넣어야 한다
  // (보통 보기 둘 + '원본 그대로' 보기 하나).
  const made = (HTML.match(/weeklyReloadBtnEl\(\);/g) || []).length;
  check('제목줄 세 갈래 모두에 넣는다', made === 3, made);

  // 순서 — 원본보기 '왼쪽' 이어야 한다.
  // 넣는 줄과 원본보기를 붙이는 줄이 실제로 이 차례로 붙어 있는지 본다.
  const adjacent = (rb) => new RegExp(
    `if \\(${rb}\\) titleBar\\.appendChild\\(${rb}\\);[^\\n]*\\n\\s*titleBar\\.appendChild\\(btn\\);`
  ).test(HTML);
  check('제목줄 ①: 원본보기 바로 왼쪽에 붙는다', adjacent('rb1'));
  check('제목줄 ②: 원본보기 바로 왼쪽에 붙는다', adjacent('rb2'));
  check("제목줄 ③('원본 그대로'): 원본보기보다 앞에 온다",
        /head\.append\(ttl, \.\.\.\(rb3 \? \[rb3\] : \[\]\), ob\);/.test(HTML));

  // .weekly-title-btn 은 margin-left:auto 다. 둘이 나란히 서면 뒤엣것까지 auto 가
  // 걸려 사이가 벌어진다.
  check('나란히 선 두 단추 사이가 벌어지지 않는다',
        /\.weekly-title-btn \+ \.weekly-title-btn\{margin-left:6px;\}/.test(HTML));

  check('캐시를 안 보고 바로 받는다',
        /async function weeklyReload\(\)\{[\s\S]{0,600}await loadViaAppsScript\(\);[\s\S]{0,120}await loadWeekViaAppsScript\(url\);/.test(HTML));
  check('보고 있는 주차를 받는다', /const url = weeklyCurrentUrl \|\| SITES_BASE;/.test(HTML));
  check('첫 화면은 칩까지 뽑는 길로 보낸다',
        /if \(url === SITES_BASE\) await loadViaAppsScript\(\);/.test(HTML));
  check('받는 동안 다시 눌리지 않는다', /btn\.disabled = true;[\s\S]{0,80}받는 중/.test(HTML));
  // 다 받으면 본문을 다시 그리므로 제목줄이 통째로 바뀐다. 처음에 잡아 둔 단추는
  // 이미 화면에서 떨어져 나갔다 — 지금 붙어 있는 것을 다시 찾아야 한다.
  check('끝나면 지금 붙어 있는 단추를 되돌린다',
        /\} finally \{[\s\S]{0,260}const now = document\.getElementById\('weeklyReloadBtn'\);[\s\S]{0,80}now\.disabled = false;/.test(HTML));
}

console.log('\n■ 스크래퍼 — 본문 캐시 비우기');
if (!SCRAPER) {
  skip++; console.log('  ⏭  scripts/scrape-weekly.js 가 이 저장소엔 없다 (test 에만 있다)');
} else {
  check('캐시를 비운다', /listDocuments\(\)/.test(SCRAPER));
  // 여기가 핵심이다 — index·summary 까지 지우면 주차 칩과 AI 요약이 사라진다
  check("'cache-' 로 시작하는 것만 지운다",
        /\.filter\(d => d\.id\.startsWith\('cache-'\)\)/.test(SCRAPER));
  check('지우는 대상이 filter 를 거친 것이다',
        /stale\.map\(d => d\.delete\(\)\)/.test(SCRAPER) && !/all\.map\(d => d\.delete\(\)\)/.test(SCRAPER));
  check('주차 목록을 넣은 뒤에 비운다',
        SCRAPER.indexOf("doc('index').set") < SCRAPER.indexOf('listDocuments()'));
  check('실패해도 거기서 멈추지 않는다',
        /본문 캐시 비우기 실패/.test(SCRAPER));

  // 실제로 걸러지는지 — 흉내낸 문서 목록으로 돌려 본다
  const ids = ['index', 'summary', 'cache-current', 'cache-abc_2F123', 'cachebusters'];
  const kept = ids.filter(id => !id.startsWith('cache-'));
  check('index 와 summary 는 남는다', kept.includes('index') && kept.includes('summary'), kept);
  check("이름이 'cache' 로 시작만 해서는 안 지운다 (cachebusters)", kept.includes('cachebusters'), kept);
  check('본문 캐시 둘은 지워진다', ids.filter(id => id.startsWith('cache-')).length === 2);
}

console.log('\n■ GAS — 워크플로를 실제로 부른다');
{
  check('있는 저장소로 쏜다', /var REPO  = 'test';/.test(GAS));
  check('ynhs 로 쏘지 않는다', !/var REPO  = 'ynhs';/.test(GAS));
  // 이 경로는 대소문자를 가린다. 실제 파일은 Summarize.yml 이다.
  check('요약 워크플로 이름이 대문자 S', /workflows\/Summarize\.yml\/dispatches/.test(GAS));
  check('소문자 summarize.yml 로 쏘지 않는다', !/workflows\/summarize\.yml\/dispatches/.test(GAS));
  // 전에는 success:true 를 박아 두어 404 가 와도 성공으로 보였다
  check('응답 코드를 실제로 본다', /var scrapeOk = \(scrapeRes\.getResponseCode\(\) === 204\);/.test(GAS));
  check('success 를 박아 두지 않는다', !/success: true,\s*\n\s*scrape:/.test(GAS));
  check('실패하면 까닭을 실어 보낸다', /out\.scrapeError = /.test(GAS) && /out\.summaryError = /.test(GAS));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}${skip ? ` / 건너뜀 ${skip}` : ''}\n`);
process.exit(fail === 0 ? 0 : 1);
