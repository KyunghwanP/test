# 감독표 엑셀 양식(docs/duty-template.xlsx)을 만든다:  python3 gas/overtime/make-duty-template.py  (openpyxl 필요)
# 만든 뒤 docs/ 로 옮긴다. 날짜는 WORKDAY 없이 기본 함수만 — 엑셀·구글 시트 어디서나 계산되게.
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.comments import Comment

F = '맑은 고딕'
f = lambda **k: Font(name=F, **k)
YEL = PatternFill('solid', fgColor='FFF9C4')
HEAD = PatternFill('solid', fgColor='E2E8F0')
thin = Side(style='thin', color='CBD5E1')
box = Border(left=thin, right=thin, top=thin, bottom=thin)
FIRST, LAST = 4, 33
R = "'명렬'!$A$2:$A$400"          # 감독표 줄 (평일 최대 23일 + 직접 넣을 7줄)

wb = Workbook()
ws = wb.active
ws.title = '감독표'
roster = wb.create_sheet('명렬')
guide = wb.create_sheet('안내')

# ── 설정 줄 ──
for c, (label, val) in zip(['A', 'C', 'E'], [('학년', 1), ('연도', 2026), ('월', 11)]):
    ws[c + '1'] = label; ws[c + '1'].font = f(bold=True); ws[c + '1'].alignment = Alignment(horizontal='right')
    nxt = chr(ord(c) + 1) + '1'
    ws[nxt] = val; ws[nxt].fill = YEL; ws[nxt].font = f(bold=True, color='0000FF'); ws[nxt].border = box
    ws[nxt].alignment = Alignment(horizontal='center')
ws['G1'] = '← 노란 칸만 고칩니다. 월을 바꾸면 그달 평일이 날짜 칸에 채워집니다.'
ws['G1'].font = f(color='64748B', size=9)
ws['A2'] = ('자율학습이 없는 날은 그 줄의 날짜 칸을 지우세요(Delete). 토요일 등은 아래 빈 줄에 날짜를 직접 적습니다. '
            '다 채우면 A~D열(날짜·감독1·감독2·감독3)을 드래그해 복사 → 앱 「감독표 → 배정」에 붙여 넣기.')
ws['A2'].font = f(color='475569', size=9)
ws.merge_cells('A2:F2')
ws['A2'].alignment = Alignment(wrap_text=True, vertical='top')
ws.row_dimensions[2].height = 42

heads = ['날짜', '감독1', '감독2', '감독3 (심야)', '요일', '확인']
for i, h in enumerate(heads):
    c = ws.cell(row=3, column=i + 1, value=h)
    c.font = f(bold=True); c.fill = HEAD; c.border = box; c.alignment = Alignment(horizontal='center')

n_auto = 23
for r in range(FIRST, LAST + 1):
    a = ws.cell(row=r, column=1)
    if r < FIRST + n_auto:
        k = r - FIRST + 1
        # 그달 k번째 평일 — WORKDAY 없이 기본 함수만(엑셀·구글 시트 어디서나)
        d0 = 'DATE($D$1,$F$1,1)'
        d1 = f'({d0}+CHOOSE(WEEKDAY({d0}),1,0,0,0,0,0,2))'
        x = f'({d1}+{k-1}+2*INT((WEEKDAY({d1},2)-1+{k-1})/5))'
        a.value = f'=IF(MONTH({x})=$F$1,{x},"")'
    a.number_format = 'yyyy-mm-dd'
    a.font = f(); a.border = box; a.alignment = Alignment(horizontal='center')
    for col in (2, 3, 4):
        c = ws.cell(row=r, column=col); c.fill = YEL; c.font = f(color='0000FF'); c.border = box
        c.alignment = Alignment(horizontal='center')
    e = ws.cell(row=r, column=5, value=f'=IF(A{r}="","",CHOOSE(WEEKDAY(A{r}),"일","월","화","수","목","금","토"))')
    e.font = f(color='64748B'); e.border = box; e.alignment = Alignment(horizontal='center')
    chk = (f'=IF(COUNTA(B{r}:D{r})=0,"",'
           f'IF(A{r}="","날짜 없음",'
           f'IF(OR(AND(B{r}<>"",B{r}=C{r}),AND(B{r}<>"",B{r}=D{r}),AND(C{r}<>"",C{r}=D{r})),"같은 사람 두 칸",'
           f'IF(COUNTA({R})=0,"",'
           f'IF(OR(AND(B{r}<>"",COUNTIF({R},B{r})=0),AND(C{r}<>"",COUNTIF({R},C{r})=0),'
           f'AND(D{r}<>"",COUNTIF({R},D{r})=0)),"명렬에 없는 이름","")))))')
    g = ws.cell(row=r, column=6, value=chk)
    g.font = f(bold=True, color='B91C1C'); g.border = box
# 직접 적는 줄 표시
ws.cell(row=FIRST + n_auto, column=1).comment = Comment('여기부터는 날짜를 직접 적는 줄입니다 (예: 2026-11-14).', '양식')
for r in range(FIRST + n_auto, LAST + 1):
    ws.cell(row=r, column=1).fill = YEL
    ws.cell(row=r, column=1).font = f(color='0000FF')

# 감독 칸 고르기 — 명렬에서
dv = DataValidation(type='list', formula1='=' + R, allow_blank=True,
                    showErrorMessage=True, errorStyle='warning',
                    errorTitle='명렬에 없는 이름', error='명렬 시트에 없는 이름입니다. 앱에서 「명렬에 없음」으로 막힙니다.')
ws.add_data_validation(dv); dv.add(f'B{FIRST}:D{LAST}')
# 확인 칸에 글이 있으면 그 줄을 붉게
ws.conditional_formatting.add(f'A{FIRST}:D{LAST}',
    FormulaRule(formula=[f'$F{FIRST}<>""'], fill=PatternFill('solid', fgColor='FEE2E2')))
# 주말은 날짜를 회색으로
ws.conditional_formatting.add(f'E{FIRST}:E{LAST}', FormulaRule(formula=[f'OR($E{FIRST}="토",$E{FIRST}="일")'], font=Font(name=F, color='B91C1C')))

for col, w in zip('ABCDEFG', [14, 12, 12, 14, 6, 18, 40]):
    ws.column_dimensions[col].width = w
ws.freeze_panes = 'A4'

# ── 명렬 ──
roster['A1'] = '이름'; roster['A1'].font = f(bold=True); roster['A1'].fill = HEAD; roster['A1'].border = box
roster['B1'] = '← 선생님 이름을 A열에 한 줄에 한 명씩 붙여 넣으세요(교원 명렬 엑셀의 이름 열). 감독 칸의 고르기 목록과 「명렬에 없는 이름」 확인에 씁니다.'
roster['B1'].font = f(color='64748B', size=9)
for r in range(2, 401):
    roster.cell(row=r, column=1).fill = YEL
    roster.cell(row=r, column=1).font = f(color='0000FF')
roster.column_dimensions['A'].width = 14
roster.freeze_panes = 'A2'

# ── 안내 ──
lines = [
    ('자율학습 감독표 양식', True),
    ('', False),
    ('1. 「명렬」 시트 A열에 선생님 이름을 붙여 넣습니다 (한 번만).', False),
    ('2. 「감독표」 시트 맨 위 노란 칸에 학년·연도·월을 적습니다. 그달 평일이 날짜 칸에 채워집니다.', False),
    ('3. 자율학습이 없는 날(공휴일·시험 등)은 그 줄의 날짜 칸을 지웁니다. 토요일 등은 아래 노란 날짜 칸에 직접 적습니다.', False),
    ('4. 감독1·감독2·감독3(심야) 칸을 채웁니다. 칸을 누르면 명렬에서 고를 수 있습니다.', False),
    ('5. 「확인」 열이 비어 있는지 봅니다 (같은 사람 두 칸, 명렬에 없는 이름이면 빨갛게 표시됩니다).', False),
    ('6. A~D열(날짜·감독1·감독2·감독3)을 드래그해 복사(Ctrl+C) → 앱 「🌙 감독표 → 배정」 칸에 붙여 넣기 → 미리보기 → 확정.', False),
    ('', False),
    ('· 머리글 줄(날짜·감독1…)이나 비어 있는 줄은 같이 복사돼도 앱이 건너뜁니다.', False),
    ('· 이미 배정된 날짜는 덮어쓰지 않습니다. 바꾸려면 앱 「감독표」 화면에서 칸을 눌러 정정합니다.', False),
    ('· 한 학년 세 칸만 들어갑니다. 다른 학년 칸은 그 학년 기획 담당이 넣습니다.', False),
    ('', False),
    ('예시 (붙여 넣으면 이렇게 들어갑니다)', True),
]
for i, (t, b) in enumerate(lines, 1):
    c = guide.cell(row=i, column=1, value=t); c.font = f(bold=b, size=13 if i == 1 else 10)
ex_head = ['날짜', '감독1', '감독2', '감독3 (심야)']
ex = [['2026-11-02', '김○○', '이○○', '박○○'], ['2026-11-03', '정○○', '한○○', '오○○']]
base = len(lines) + 1
for j, h in enumerate(ex_head):
    c = guide.cell(row=base, column=j + 1, value=h); c.font = f(bold=True); c.fill = HEAD; c.border = box
for i, row in enumerate(ex):
    for j, v in enumerate(row):
        c = guide.cell(row=base + 1 + i, column=j + 1, value=v); c.font = f(); c.border = box
guide.column_dimensions['A'].width = 14
for col in 'BCD': guide.column_dimensions[col].width = 12

wb.active = 0
wb.save('duty-template.xlsx')
print('saved')
