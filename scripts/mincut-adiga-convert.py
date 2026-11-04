#!/usr/bin/env python3
# 어디가 2027 수능최저 스크랩(엑셀) + 전형분석 자료집 최저 표(엑셀) → 진단이 읽는 JSON 두 개.
#
#   python3 -I scripts/mincut-adiga-convert.py <어디가.xlsx> <자료집.xlsx> <2026_adiga_univ_results.csv> <출력폴더>
#
# 만드는 것
#   susi_mincut_adiga.json   — 수시 전형 전부(학과·전형별 '최저 적용 / 포털 필터 미포함')와 적용 기준(원문 + 판정용 칸)
#   susi_mincut_jaryojip.json — 「2027 수시 지역별 전형분석 자료집」 최저 표(대학코드별 행, 쪽 번호)
# 원본 엑셀은 저장소에 넣지 않는다. 학생 정보는 없다(대학·전형·학과·기준뿐).
import sys, re, json, csv, collections
from openpyxl import load_workbook

ADIGA, JARYO, OURS, OUTDIR = sys.argv[1:5]

# ── 원문 → 판정용 칸 ─────────────────────────────────────────────
SUBJ_S = ('윤리', '사회문화', '사회·문화', '법과정치', '경제', '동아시아사', '세계사', '세계지리', '한국지리')
SUBJ_K = ('물리학', '화학', '생명과학', '지구과학')
SUBJ_J = ('성공적인직업생활', '농업기초기술', '공업일반', '상업경제', '수산·해운산업의기초', '인간발달')
def tam_types(lst):
    if not lst: return ''
    return ('S' if any(w in lst for w in SUBJ_S) else '') + ('K' if any(w in lst for w in SUBJ_K) else '') + ('J' if any(w in lst for w in SUBJ_J) else '')

# 여러 기준이 한 원문에 섞인 것(계열·학과별로 다름, 여러 안 중 택일 등)은 자동 판정하지 않는다
COMPLEX = [
    (r'【|인문(사회)?계열\s*[:：1【/]|자연계열\s*[:：1【/]|그\s*외\s*모집단위|모집단위\s*:|[가-힣]+(학과|학부|대학)\s*:', '계열·학과마다 기준이 다름'),
    (r'①|중\s*하나를\s*충족|두\s*가지\s*기준', '여러 기준 중 하나'),
    (r'수능최저학력기준\s*없음|최저학력기준을\s*적용하지\s*않', '일부 모집단위는 최저 없음'),
    (r'학생부|교과등급|원점수|성취도', '학생부 기준이 섞임'),
    (r'과탐\s*[12]\b|탐구\s*[12]\s*[,，]|과학\s*탐구\s*2\s*과목을?\s*각각|각각\s*1\s*개\s*영역', '탐구 두 과목을 따로 셈'),
    (r'상위\s*1\s*개\s*영역만\s*적용|선택하여\s*반영될\s*경우\s*\d|포함하여\s*반영할\s*경우', '조건에 따라 기준이 바뀜'),
    (r'(?<![가-힣])(영어|국어|수학)\s*(?:영역\s*)?(?:은|는)?\s*\d\s*등급\s*(?:이내|이상)', '영역별 조건이 더 있음'),
    (r'또는\s*과학\s*탐구[^.]{0,10}?포함|또는\s*과탐[^.]{0,10}?포함', '포함 조건이 있음'),
    (r'응시하여야\s*함|반드시\s*응시|응시\s*필수', None),   # 응시 요건은 판정에 쓰지 않는다(아래에서 따로 표시)
]
def parse(t, cols):
    s = re.sub(r'\s+', ' ', (t or '')).strip()
    out = {}
    for rx, why in COMPLEX:
        if why and re.search(rx, s): out['x'] = why; break
    # 한국사
    m = re.search(r'한국사\s*(?:영역\s*)?(?:는|은)?\s*(\d)\s*등급', s)
    if m: out['k'] = int(m.group(1))
    body = re.sub(r'한국사\s*(?:영역\s*)?(?:는|은)?\s*\d\s*등급\s*(?:이내|이상)?', '', s)
    found = []
    # '국어, 영어, 탐구 중 상위 N개 (영역|등급)과 수학 (영역 등급) 합(산) V' → 수학 + N개 = N+1개 합 (먼저 보고, 맞으면 다른 꼴은 안 본다)
    m = re.search(r'상위\s*(\d)\s*개\s*(?:영역|등급)?\s*(?:등급)?과\s*수학\s*(?:영역)?\s*(?:등급)?\s*(?:의\s*)?(?:합산|합)(?:이)?\s*(\d{1,2})', body)
    if m:
        found.append(('s', int(m.group(1)) + 1, float(m.group(2)))); out['r'] = out.get('r', '') + '수'
        body = ''
    # 각 N등급
    for m in re.finditer(r'(\d)\s*개\s*(?:영역|과목)?[^.\d]{0,20}?각(?:각)?\s*(\d)\s*등급', body): found.append(('e', int(m.group(1)), float(m.group(2))))
    # 합 V
    for m in re.finditer(r'(\d)\s*개\s*(?:영역|과목|등급)?[^\d]{0,30}?(?:등급\s*)?(?:의\s*)?(?:합|합산|합계)\s*(?:이|은|이며)?\s*(\d{1,2}(?:\.\d)?)', body): found.append(('s', int(m.group(1)), float(m.group(2))))
    # 1개 영역 V등급 (단일)
    for m in re.finditer(r'(?:1|한)\s*개\s*(?:영역|과목)(?:\s*이상)?(?:이|의)?(?:\s*등급(?:이)?)?\s*(\d)\s*등급', body): found.append(('g', 1, float(m.group(1))))
    for m in re.finditer(r'우수\s*1\s*개\s*영역\s*(\d)\s*등급', body): found.append(('g', 1, float(m.group(1))))
    for m in re.finditer(r'(?:1|한)\s*개\s*영역(?:\s*이상)?\s*등급(?:이)?\s*(\d)\s*(?:등급\s*)?이내', body): found.append(('g', 1, float(m.group(1))))
    # '합산 7등급 이내'·'등급합 10' 처럼 개수가 없으면 '반영영역 수' 칸을 쓴다
    if not found:
        m = re.search(r'(?:합산|등급\s*합|합)\s*(?:이)?\s*(\d{1,2})\s*(?:등급)?', body)
        n = cols.get('n')
        if m and n: found.append(('s', int(n), float(m.group(1))))
    uniq = sorted(set(found))
    # '1개 영역 이상이 5등급' 은 단일 기준이다 — 같은 원문에서 '3개 영역 중 1개' 의 '3개' 가 합으로 잡히지 않게 단일을 우선
    if len(uniq) > 1 and any(u[0] == 'g' for u in uniq) and not any(u[0] == 's' for u in uniq): uniq = [u for u in uniq if u[0] == 'g']
    if len(uniq) == 1:
        out['h'], out['n'], out['v'] = uniq[0]
    elif len(uniq) > 1 and 'x' not in out:
        out['x'] = '기준 숫자가 여러 개'
    elif not uniq and 'x' not in out:
        out['x'] = '원문을 읽지 못함'
    if out.get('h'):
        out['v'] = int(out['v']) if float(out['v']).is_integer() else out['v']
        # 어디가 '반영영역 수' 칸 = 기준 영역 개수 (+ 한국사를 따로 요구하면 1). 다르면 칸을 믿는다
        try: coln = int(cols.get('n'))
        except (TypeError, ValueError): coln = None
        exp = out['n'] + (1 if 'k' in out else 0)
        if coln and coln != exp and out['h'] != 'g':
            fixed = coln - (1 if 'k' in out else 0)
            if fixed >= 1: out['n'] = fixed
    # 필수 영역: 칸(필수반영) + '수학 포함'·'국어포함'
    req = out.get('r', '')
    for a, col in (('국', '국어'), ('수', '수학'), ('영', '영어')):
        if cols.get(col) == '필수반영' and a not in req: req += a
    if re.search(r'수학\s*(?:영역\s*)?(?:을\s*)?포함', s) and '수' not in req: req += '수'
    if re.search(r'국어\s*(?:영역\s*)?(?:을\s*)?포함', s) and '국' not in req: req += '국'
    if req: out['r'] = req
    # 반영 영역(칸이 비면 그 영역은 안 본다)
    a = ''.join(x for x, col in (('국', '국어'), ('수', '수학'), ('영', '영어')) if cols.get(col)) + ('탐' if cols.get('탐') else '')
    out['a'] = a
    # 필수 영역이 N칸을 다 채우는데 반영 영역이 더 있으면(예: '3개 영역(국, 수, 영, 탐) 합 6' 에 국·수·영 필수) 칸의 뜻이 '응시 필수' 일 수 있다 → 자동 판정 안 함
    if 'x' not in out and out.get('h') and out.get('r') and len(set(out['r'])) >= out['n'] and len(a) > out['n']: out['x'] = '필수 영역 해석 필요'
    # 수학 선택과목 지정
    ms = cols.get('ms') or ''
    if ms and ms != '확률과 통계,미적분,기하': out['ms'] = ms.split(',')
    # 탐구 과목 갈래(사·과·직). 원문이 직탐 불인정이면 뺀다
    ts = tam_types(cols.get('탐'))
    if 'J' in ts and re.search(r'직업\s*탐구[^.]{0,20}?(불가|제외|인정하지|미반영|불인정)|직탐\s*제외', s): ts = ts.replace('J', '')
    if ts: out['ts'] = ts
    # 탐구 2과목 평균 / 버림
    if re.search(r'(2\s*개?\s*과목|두\s*과목)[^.]{0,12}?평균|평균\s*등급', s) and not re.search(r'상위\s*1\s*(개\s*)?과목', s): out['avg'] = 1
    if out.get('avg') and re.search(r'절사|버림', s) and not re.search(r'버림\s*없이', s): out['fl'] = 1
    if out.get('avg') and re.search(r'올림', s): out['ce'] = 1
    # 수학 과목에 따른 가감(미적분·기하 1등급 상향 / 확통 1등급 하향)
    # 미적분(·기하) 응시자 가산: '1등급 상향' · '2등급을 감산'(등급 숫자를 줄여 준다)
    m = re.search(r'(미적분|기하)[^.]{0,40}?(\d)\s*등급\s*(?:을|를)?\s*(?:상향|감산)', s)
    if m:
        out['mu'] = int(m.group(2)); seg = s[max(0, m.start() - 5):m.end()]
        out['mus'] = [x for x in ('미적분', '기하') if x in seg]
    if re.search(r'확률과\s*통계[^.]{0,25}?하향', s): out['md'] = 1
    if re.search(r'영어[^.]{0,10}?1\s*,\s*2\s*등급[^.]{0,6}?통합', s): out['em'] = 1
    if re.search(r'과학\s*탐구\s*\(?\s*1\s*과목\s*이상\s*\)?\s*필수', s): out['sci'] = 1
    # '수학과 과학탐구(1과목) 2개 영역은 필수 반영' · '과학탐구(1과목) 1개 영역은 필수 반영'
    if re.search(r'과학\s*탐구[^.]{0,15}?필수\s*반영', s):
        out['r'] = out.get('r', '') + ('' if '탐' in out.get('r', '') else '탐'); out['sci'] = 1
    # 과탐 응시자는 '2과목 평균' 과 '과탐 상위 1과목' 중 나은 것
    if out.get('avg') and re.search(r'과탐[^.]{0,30}?(우수한|나은)\s*등급', s): out['as'] = 1
    return out

# ── 어디가 ───────────────────────────────────────────────────────
wb = load_workbook(ADIGA, read_only=True, data_only=True)
def sheet(name):
    it = wb[name].iter_rows(values_only=True); H = next(it); I = {h: i for i, h in enumerate(H)}
    return I, it
I, it = sheet('수능최저')
crit_by_id = {}
for r in it:
    if r[I['모집시기']] != '수시': continue
    cols = {'국어': r[I['국어']], '수학': r[I['수학']], '영어': r[I['영어']], 'ms': r[I['수학 선택과목']], '탐': r[I['탐구 선택과목']], 'n': r[I['반영영역 수']]}
    c = parse(r[I['세부 기준(원문)']], cols)
    c['t'] = re.sub(r'\s+', ' ', r[I['세부 기준(원문)']] or '').strip()
    crit_by_id[r[I['전형식별값']]] = c
crit = []; ci_of = {}
def ci(c):
    k = json.dumps(c, ensure_ascii=False, sort_keys=True)
    if k not in ci_of: ci_of[k] = len(crit); crit.append(c)
    return ci_of[k]
I, it = sheet('전체전형')
U = collections.defaultdict(lambda: collections.defaultdict(list)); n_all = n_app = 0
for r in it:
    if r[I['모집시기']] != '수시': continue
    code = str(int(r[I['대학코드']])); adm = r[I['전형명']]; dep = re.sub(r'\(주간\)$', '', r[I['학과(모집단위)']] or '')
    n_all += 1; sid = r[I['전형식별값']]
    if r[I['수능최저 적용']] == '적용' and sid in crit_by_id:
        n_app += 1; U[code][adm].append([dep, ci(crit_by_id[sid]), sid])
    else:
        U[code][adm].append([dep, -1])
summary = dict(next(iter([{}])))
ws = wb['수집요약']
meta = {str(a): str(b) for a, b in list(ws.iter_rows(values_only=True))[1:] if a}
out = {'meta': {'출처': meta.get('출처', ''), '수집': meta.get('수집 완료 시각(UTC)', '')[:10], '수시전형': n_all, '최저적용': n_app,
                '주의': "'포털 필터 미포함'은 최저 없음으로 확정한 값이 아니다(진단에서는 자료집과 대조해 보여 준다)",
                '주소': 'https://www.adiga.kr/ucp/prc/uni/admssUnivDetail.do?{q}&searchSyr=2027&menuId=PCPRCINF2000',
                '주소칸': ['unvCd', 'comScsbjtCd', 'slcnGroupCd', 'rcmtMmntCd', 'ruCd', 'ruSn', 'lclsfAftCd', 'slcnTypeCd', 'slcnCd']},
       'crit': crit, 'u': {c: dict(v) for c, v in U.items()}}
json.dump(out, open(OUTDIR + '/susi_mincut_adiga.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# ── 자료집 ───────────────────────────────────────────────────────
cu = {}
for x in csv.DictReader(open(OURS, encoding='utf-8')):
    if x['구분'] == '수시': cu.setdefault(x['대학코드'], x['대학명'])
names = collections.defaultdict(list)
for code, nm in cu.items():
    m = re.match(r'^(.*?)\[(.+)\]$', nm); names[m.group(1) if m else nm].append(code)
def expand(b):
    for a, z in (('여대', '여자대학교'), ('교대', '교육대학교'), ('체대', '체육대학교')):
        if b.endswith(a): return b[:-len(a)] + z
    return b + '학교' if b.endswith('대') else b
SPECIAL = {'동국대(WISE)': '동국대학교(WISE)', '연세대(미래)': '연세대학교(미래)', '고려대(세종)': '고려대학교(세종)', '건국대(글로컬)': '건국대학교(글로컬)',
           '한양대(ERICA)': '한양대학교(ERICA)', '강원대(강릉·원주)': '국립강릉원주대학교', '국립창원대(창원)': '국립창원대학교', '포항공과대': '포항공과대학교',
           '단국대(죽전)': ('단국대학교', '본교'), '단국대(천안)': ('단국대학교', '제2캠퍼스'), '상명대(천안)': ('상명대학교', '제2캠퍼스'), '강원대(춘천)': ('강원대학교', '본교'),
           '고려대(서울)': ('고려대학교', '본교'), '연세대(서울)': ('연세대학교', '본교'), '한양대(서울)': ('한양대학교', '본교'), '건국대(서울)': ('건국대학교', '본교'),
           '동국대(서울·고양)': ('동국대학교', '본교')}
wb2 = load_workbook(JARYO, data_only=True); rows = list(wb2['수능최저(2027 수시)'].iter_rows(values_only=True))[1:]
J = collections.defaultdict(list); unmapped = set()
for 지역, 대학, 전형, 단위, 기준, 비고, 책쪽, pdf쪽 in rows:
    sp = SPECIAL.get(대학)
    if isinstance(sp, tuple): codes = [c for c in names.get(sp[0], []) if cu[c].endswith('[' + sp[1] + ']')]
    else: codes = names.get(sp or expand(re.sub(r'\(.*\)$', '', 대학)), [])
    if not codes: unmapped.add(대학)
    for c in codes: J[c].append([대학, 전형 or '', 단위 or '', re.sub(r'\s+', ' ', 기준 or '').strip(), 비고 or '', 책쪽])
json.dump({'meta': {'출처': '대입정보포털 어디가 「2027학년도 수시모집 지역별 전형분석 자료집」(대입상담센터, 2026-08-20)', '대학': len({r[0] for v in J.values() for r in v})},
           'u': dict(J)}, open(OUTDIR + '/susi_mincut_jaryojip.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('어디가: 수시 전형', n_all, '· 최저 적용', n_app, '· 기준 종류', len(crit), '· 자동 판정 못 하는 기준', sum(1 for c in crit if 'x' in c))
print('자료집: 대학', len({r[0] for v in J.values() for r in v}), '· 코드 못 찾은 대학', sorted(unmapped))
