"""index.html 에서 외출증 코드와 마크업을 떼어내 브라우저 검증용 페이지를 만든다."""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
OUT = pathlib.Path(sys.argv[1])
s = SRC.read_text(encoding='utf-8')

def grab_fn(name):
    m = re.search(r'^(?:async )?function %s\s*\(' % re.escape(name), s, re.M)
    if not m: raise SystemExit('못 찾음: ' + name)
    return s[m.start(): s.index('\n}\n', m.start()) + 3]

fns = ['passYmd' , 'passCurrentDay', 'passStopWatch', 'passWatch', 'passMoveDay',
       'passThumb', 'passRenderList', 'passDelete', 'passOpenForm', 'passCloseForm',
       'passRenderSearch', 'passPick', 'passUnpick', 'passSave', 'initPassPage']
# passYmd 는 화살표 상수라 따로
# 상태 변수 블록 + passYmd + passPhotoPending
state = re.search(r'^let passInitialized = false;[\s\S]*?^const passYmd = .*?;$', s, re.M).group(0)
pending = re.search(r'^const passPhotoPending = \{\};$', s, re.M).group(0)
code = state + '\n' + pending + '\n\n' + '\n\n'.join(grab_fn(f) for f in fns if f != 'passYmd')

# 마크업: passPage + 발급 모달
a = s.index('<!-- 외출증 (조퇴·외출·결과) -->')
b = s.index('<!-- 시간표 페이지 -->', a)
markup = s[a:b]

# CSS
ca = s.index('/* ══════════════════════════════════════════\n     외출증')
cb = s.index('/* 비상연락망 상세 팝업 */', ca)
css = s[ca:cb]

OUT.write_text(f'''<!doctype html><meta charset="utf-8">
<style>
  :root{{--rule:#ddd;--paper:#fff;--paper-soft:#f7f7f5;--ink:#222;--ink-soft:#777;
        --wed:#2F5D62;--tue:#B08D57;--thu:#3B5170;}}
  body{{font-family:sans-serif;margin:16px;background:var(--paper);color:var(--ink);}}
  .page-view{{display:block;}}
{css}
</style>
{markup}
<script type="module">
// ── 스텁 ──────────────────────────────────────────────────────────────────
const escapeHtml = t => String(t ?? '').replace(/[&<>"']/g, c =>
  ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]));

window.__added = [];        // addDoc 으로 나간 것
window.__deleted = [];      // deleteDoc 으로 지운 것
window.__snapCb = null;     // onSnapshot 콜백 (테스트가 직접 밀어넣는다)
window.__photos = {{}};       // '학년-반' → {{ 번호: dataURL }}
window.__me = {{ email: 'hong@yeungnam.hs.kr', displayName: '홍길동' }};
window.__admin = false;
window.__confirm = true;

const fbDb = {{}};
const fbAuth = {{ get currentUser(){{ return window.__me; }} }};
const collection = (...a) => ({{ path: a.slice(1).join('/') }});
const doc = (...a) => ({{ path: a.slice(1).join('/') }});
const addDoc = async (ref, data) => {{ window.__added.push({{ path: ref.path, data }}); return {{ id: 'new' }}; }};
const deleteDoc = async ref => {{ window.__deleted.push(ref.path); }};
const getDoc = async ref => {{
  const ck = ref.path.split('/')[1];
  const p = window.__photos[ck];
  return {{ exists: () => !!p, data: () => ({{ photos: p, updatedAt: 't' }}) }};
}};
const onSnapshot = (ref, cb, err) => {{ window.__snapCb = cb; return () => {{ window.__snapCb = null; }}; }};
const s360PhotoCache = {{}}, s360PhotoVer = {{}};
let allStudents = [];
const spotLoadData = async () => {{}};
const effTeacher = () => ({{ name: '홍길동' }});
const _IS_ADMIN = () => window.__admin;
window.confirm = () => window.__confirm;
window.alert = m => {{ window.__alerts = (window.__alerts||[]); window.__alerts.push(m); }};

{code}

// ── 테스트가 부르는 것들 ──────────────────────────────────────────────────
window.initPassPage = initPassPage;
window.passMoveDay = passMoveDay;
window.passOpenForm = passOpenForm;
window.passCloseForm = passCloseForm;
window.passUnpick = passUnpick;
window.passSave = passSave;
window.passDelete = passDelete;
window.setStudents = v => {{ allStudents = v; }};
window.pushSnap = docs => window.__snapCb({{ docs: docs.map(d => ({{ id: d.id, data: () => d }})) }});
window.reset = () => {{
  window.__added = []; window.__deleted = []; window.__alerts = [];
  for (const k in s360PhotoCache) delete s360PhotoCache[k];
}};
</script>
''', encoding='utf-8')
print('만듦:', OUT)
