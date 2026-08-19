"""index.html 에서 외출증 코드·마크업·CSS를 떼어내 브라우저 검증용 페이지를 만든다.
테스트 안에 로직을 옮겨 적으면 원본이 바뀌어도 통과해 버리므로 반드시 원본에서 뽑는다."""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
OUT = pathlib.Path(sys.argv[1])
s = SRC.read_text(encoding='utf-8')

def grab_fn(name):
    """중괄호를 세어 함수 끝을 찾는다. '\n}\n' 로 자르면 한 줄짜리 함수에서
    뒤쪽 코드까지 통째로 삼킨다(실제로 passShift 에서 그랬다)."""
    m = re.search(r'^(?:async )?function %s\s*\(' % re.escape(name), s, re.M)
    if not m: raise SystemExit('못 찾음: ' + name)
    i = s.index('{', m.end() - 1)
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return s[m.start(): j + 1]
        j += 1
    raise SystemExit('닫는 괄호를 못 찾음: ' + name)

def grab_line(pat):
    m = re.search(pat, s, re.M)
    if not m: raise SystemExit('못 찾음: ' + pat)
    return m.group(0)

consts = '\n'.join([
    grab_line(r'^const PASS_PAST_DAYS   = .*$'),
    grab_line(r'^const PASS_FUTURE_DAYS = .*$'),
    grab_line(r'^const PASS_REPEAT_MAX  = .*$'),
    grab_line(r'^let passInitialized = false;$'),
    grab_line(r'^let passUnsub = null;$'),
    grab_line(r'^let passTick = null;.*$'),
    grab_line(r'^let passToday = \[\];.*$'),
    grab_line(r'^let passPast   = \{\};.*$'),
    grab_line(r'^let passFuture = \{\};.*$'),
    grab_line(r'^let passLoaded = false;$'),
    grab_line(r"^let passView = 'recent';.*$"),
    grab_line(r'^let passPickedStudent = null;$'),
    grab_line(r"^let passKind = '조퇴';$"),
    grab_line(r"^let passGuard = '전화';$"),
    grab_line(r"^let passRepeat = 'none';$"),
    grab_line(r'^let passWdaySel = new Set\(\);$'),
    grab_line(r'^let passDetailCur = null;$'),
    grab_line(r'^let passEditing = false;$'),
    grab_line(r'^let passHits = \[\];$'),
    grab_line(r'^let passHitIdx = -1;$'),
    grab_line(r'^const PASS_WD = .*$'),
    grab_line(r'^const passYmd = .*$'),
    grab_line(r'^const passToday_ = .*$'),
    grab_line(r'^const passDateLabel = .*$'),
    grab_line(r'^const passNowHm = .*$'),
    grab_line(r"^  return `\$\{String\(n\.getHours.*$"),
    grab_line(r'^const passWday = .*$'),
    grab_line(r'^const passPhotoPending = \{\};$'),
])
fns = ['passState','initPassPage','passStopWatch','passWatchToday','passLoadRange','passShift',
       'passThumb','passFaceHtml','passRender','passFind','passShowDetail','passCloseDetail',
       'passDelete','passOpenForm','passCloseForm','passRenderSearch','passPick',
       'passUnpick','passRepeatDays','passUpdateRepeatNote','passSave',
       'passMoveHit','passSearchKey','passSaveEdit']
code = consts + '\n\n' + '\n\n'.join(grab_fn(f) for f in fns)

a = s.index('<!-- 외출증 (조퇴·외출·결과) -->')
b = s.index('<!-- 시간표 페이지 -->', a)
markup = s[a:b]

ca = s.index('/* ══════════════════════════════════════════\n     외출증 (조퇴·외출·결과)')
cb = s.index('/* 비상연락망 상세 팝업 */', ca)
css = s[ca:cb]

OUT.write_text(f'''<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{{--rule:#ddd;--paper:#fff;--paper-soft:#f7f7f5;--ink:#222;--ink-soft:#777;
        --wed:#2F5D62;--tue:#B08D57;--thu:#3B5170;}}
  body{{font-family:sans-serif;margin:16px;background:var(--paper-soft);color:var(--ink);}}
  .page-view{{display:block;}}
{css}
</style>
{markup}
<script>
// window.__nowMs 를 넣으면 그 시각으로 고정된다(안 넣으면 진짜 시계 그대로).
(function(){{
  const Real = Date;
  window.__nowMs = null;
  function D(...a){{ return (a.length === 0 && window.__nowMs != null) ? new Real(window.__nowMs) : new Real(...a); }}
  D.now = () => (window.__nowMs != null ? window.__nowMs : Real.now());
  D.parse = Real.parse; D.UTC = Real.UTC; D.prototype = Real.prototype;
  window.Date = D;
}})();
</script>
<script type="module">
const escapeHtml = t => String(t ?? '').replace(/[&<>"']/g, c =>
  ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]));

window.__added = []; window.__deleted = []; window.__updated = []; window.__snapCb = null;
window.__big = null;
window.__photos = {{}}; window.__past = {{}}; window.__future = {{}};
window.__me = {{ email: 'hong@yeungnam.hs.kr', displayName: '홍길동' }};
window.__admin = false; window.__confirm = true; window.__alerts = [];

const fbDb = {{}};
const fbAuth = {{ get currentUser(){{ return window.__me; }} }};
const collection = (...a) => ({{ path: a.slice(1).join('/'), day: a[2] }});
const doc = (...a) => ({{ path: a.slice(1).join('/'), coll: a[1], day: a[2], id: a[4] }});
let __seq = 0;
const addDoc = async (ref, data) => {{ window.__added.push({{ path: ref.path, day: ref.day, data }}); return {{ id: 'new' + (++__seq) }}; }};
const deleteDoc = async ref => {{ window.__deleted.push(ref.path); }};
const setDoc = async (ref, data, opt) => {{ window.__updated.push({{ path: ref.path, data, opt }}); }};
// 고화질 사진(R2). 테스트가 window.__big 에 넣어 두면 그것을 돌려준다.
const s360BigPhoto = async s => window.__big || null;
const getDocs = async ref => {{
  const rows = (window.__past[ref.day] || window.__future[ref.day] || []);
  return {{ empty: rows.length === 0, docs: rows.map(r => ({{ id: r.id, data: () => r }})) }};
}};
const getDoc = async ref => {{
  const p = window.__photos[ref.day];
  return {{ exists: () => !!p, data: () => ({{ photos: p, updatedAt: 't' }}) }};
}};
const onSnapshot = (ref, cb, err) => {{ window.__snapCb = cb; return () => {{ window.__snapCb = null; }}; }};
const s360PhotoCache = {{}}, s360PhotoVer = {{}};
let allStudents = [];
const spotLoadData = async () => {{}};
const effTeacher = () => ({{ name: '홍길동' }});
const _IS_ADMIN = () => window.__admin;
window.confirm = () => window.__confirm;
window.alert = m => window.__alerts.push(m);

{code}

window.initPassPage = initPassPage;
window.passOpenForm = passOpenForm;
window.passCloseForm = passCloseForm;
window.passCloseDetail = passCloseDetail;
window.passUnpick = passUnpick;
window.passSave = passSave;
window.passShowDetail = passShowDetail;
window.passRenderSearch = passRenderSearch;
window.setStudents = v => {{ allStudents = v; }};
window.pushToday = rows => window.__snapCb({{ docs: rows.map(r => ({{ id: r.id, data: () => r }})) }});
window.passState = passState;
window.passRender = passRender;
window.reset = () => {{
  window.__added = []; window.__deleted = []; window.__updated = []; window.__alerts = [];
  for (const k in s360PhotoCache) delete s360PhotoCache[k];
  for (const k in passPhotoPending) delete passPhotoPending[k];
}};
</script>
''', encoding='utf-8')
print('만듦:', OUT)
