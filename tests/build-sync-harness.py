"""index.html 에서 syncTimeState 를 떼어내 자정 넘김을 확인할 수 있게 만든다."""
import re, sys, pathlib
SRC = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
OUT = pathlib.Path(sys.argv[1])
s = SRC.read_text(encoding='utf-8')

def grab_fn(name):
    m = re.search(r'^(?:async )?function %s\s*\(' % re.escape(name), s, re.M)
    if not m: raise SystemExit('못 찾음: ' + name)
    i = s.index('{', m.end() - 1); depth, j = 0, i
    while j < len(s):
        if s[j] == '{': depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0: return s[m.start(): j + 1]
        j += 1
    raise SystemExit('닫는 괄호 못 찾음: ' + name)

OUT.write_text(grab_fn('syncTimeState'), encoding='utf-8')
print('만듦:', OUT)
