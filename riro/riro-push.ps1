<#
  리로스쿨 상벌점 → 앱 동기화 (학교 PC 용)
  ==========================================================================
  리로스쿨이 2026-10-14 부터 해외 접속을 막아서, 미국에 있는 GitHub 서버가 밤마다
  받아 오던 것(scripts/scrape-riro.js)이 '0명' 으로 실패한다. 그래서 학교 PC 가 받는다.

    학교 PC (이 파일)  리로스쿨 로그인 → 상벌점 페이지 받기 → 표 해석 → 저장할 모양으로
          │
          ▼  PUT /riro/grade1 · grade2 · grade3 · meta   (머리글 X-Riro-Key)
    워커 riro-ingest   열쇠만 확인하고 그대로 Firestore riro_points 의 그 문서에 쓴다
          ▼
    앱                 상벌점 조회 · 상세 · 종합검색 (예전과 같은 자료 모양)

  해석을 PC 에서 하는 까닭: 무료 워커는 요청 하나에 CPU 10ms 까지인데, 전교생 표를
  해석하면 수십 ms 가 든다. PC 에는 그런 제한이 없다.

  쓰는 법 (PowerShell 창에서)
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -Setup      리로스쿨 계정·워커 주소 저장, 전송 암호 만들기
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -Check      받아서 해석까지만 (저장 안 함) + 워커 연결 확인
    powershell -ExecutionPolicy Bypass -File riro-push.ps1             한 번 받아서 저장
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -Install    평일 07:50 · 16:40 · 로그인할 때 자동 실행 등록
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -Uninstall  자동 실행 해제
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -ShowKey    저장된 전송 암호 다시 보기 (워커의 RIRO_KEY)
    powershell -ExecutionPolicy Bypass -File riro-push.ps1 -Diagnose   상세가 안 읽힐 때: 페이지 짜임만 가려서 파일로 (riro-diag.txt)

  계정·암호는 이 PC 의 이 Windows 사용자만 풀 수 있게(DPAPI) 저장한다.
  기록(riro.log)에는 학생 이름·점수를 남기지 않는다 — 몇 명·몇 건·HTTP 상태만.
  자세한 설치 순서는 같은 폴더의 README.md.
#>
[CmdletBinding()]
param(
  [switch]$Setup,
  [switch]$Check,
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$ShowKey,
  [switch]$Diagnose,
  [switch]$NewKey,        # -Setup 때 전송 암호를 새로 만든다 (워커 쪽 RIRO_KEY 도 바꿔야 함)
  [switch]$LoadOnly,      # 검사용: 함수만 읽고 끝낸다
  [string]$HomeDir = '',
  [string]$RiroBase = 'https://yeungnam.riroschool.kr',
  [int]$MinTotal = 300,   # 이보다 적게 읽히면 저장하지 않는다 (전교생 1000여 명)
  [int]$MinPerGrade = 50
)

$script:TaskName = 'ynhs-riro-sync'
# Invoke-WebRequest 의 진행 막대를 끈다. Windows PowerShell 5.1 콘솔은 한글처럼 두 칸 글자가 줄 끝에
# 걸리면 「인덱스가 배열 범위를 벗어났습니다」 로 터지는데, 진행 막대도 같은 코드로 그려서 요청 자체가
# 실패했다(2026-10-26 학교 PC: 워커 연결 HTTP 0). 진행 막대는 1.5MB 페이지를 받을 때 느리게도 만든다.
$ProgressPreference = 'SilentlyContinue'
$script:DefaultWorker = 'https://riro-ingest.pkh910518.workers.dev'

# PowerShell 5.1 은 TLS 1.2 가 꺼져 있을 수 있다
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
# PowerShell 7 은 EUC-KR 같은 옛 인코딩을 따로 켜야 한다 (5.1 은 원래 된다)
try { [Text.Encoding]::RegisterProvider([Text.CodePagesEncodingProvider]::Instance) } catch { }

# ══════════════════════════════════════════════════════════════════════
#  HTML → 학생 목록
# ══════════════════════════════════════════════════════════════════════
# 예전 스크래퍼가 브라우저 안에서 하던 것과 같은 결과를 낸다:
#   document.querySelectorAll('table.mypage_record_pc tr[align="center"]') 중 td 가 7개 이상인 줄
#   학번=td[1] 이름=td[2] 합계·상점·벌점·감점=td[3..6]
#   상세=줄 안의 .label-record(날짜) 와 그 바로 다음 요소(내용) — 담는 상자는 보지 않는다(이름이 바뀐다)
# 브라우저가 없으니 HTML 을 직접 읽는다. 브라우저가 고쳐 읽는 규칙 중 결과에 닿는 것만 따른다
# — 닫는 태그를 빠뜨린 td·tr, <p> 안에 블록 요소가 오면 p 가 닫힘, 스크립트·주석 안의 '<td>' 는 글자.
# tests/riro-parse.test.mjs 가 같은 HTML 을 크로미움(원래 코드)과 이 함수에 넣어 결과를 맞춰 본다.

# 자바스크립트 trim() · \s 와 같은 공백 문자
$script:WsChars = [char[]](@(9, 10, 11, 12, 13, 32, 0xA0, 0x1680) + (0x2000..0x200A) + @(0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF))
$script:WsClass = '[\t\n\v\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'
$script:WsRunRe = New-Object System.Text.RegularExpressions.Regex ($script:WsClass + '+')
$script:IntRe = New-Object System.Text.RegularExpressions.Regex ('^' + $script:WsClass + '*([+-]?)(?:0[xX]([0-9a-fA-F]+)|([0-9]+))')
$script:ClassSplitRe = New-Object System.Text.RegularExpressions.Regex '[\t\n\f\r ]+'

# 태그 하나씩: 주석 | 글자로만 읽는 요소(통째로) | 여는·닫는 태그 | <!doctype>·<?…?>
#   그룹 1·2·3 = 글자 요소 이름·속성·내용, 4 = '/', 5 = 태그 이름, 6 = 속성
# (패턴을 변수에 먼저 담는다 — PowerShell 은 쉼표가 + 보다 먼저 묶여서, 'a' + 'b', 옵션 이라고 쓰면
#  옵션이 글자로 패턴 끝에 붙고 대소문자 무시가 빠진다)
$script:TokPattern = (
  '<!--[\s\S]*?(?:-->|$)' +
  '|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)(?=[\s/>])((?:[^>"'']|"[^"]*"|''[^'']*'')*)>([\s\S]*?)(?:</\1(?=[\s/>])[^>]*>|$)' +
  '|<(/?)([A-Za-z][^\s/>]*)((?:[^>"'']|"[^"]*"|''[^'']*'')*)>' +
  '|<![^>]*>|<\?[^>]*>')
$script:TokRe = New-Object System.Text.RegularExpressions.Regex ($script:TokPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$script:AttrRe = New-Object System.Text.RegularExpressions.Regex ('([^\s"''>/=]+)(?:\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^\s>]+)))?')

function New-TagSet([string[]]$names) { $h = @{}; foreach ($n in $names) { $h[$n] = $true }; return $h }
$script:VoidTags = New-TagSet @('area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr')
$script:TableScope = New-TagSet @('html', 'table', 'template')
$script:ButtonScope = New-TagSet @('applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'button')
$script:AnyTableScope = New-TagSet @('html', 'template')
$script:SectionOrCaption = New-TagSet @('tbody', 'thead', 'tfoot', 'caption', 'colgroup')
$script:TableContext = New-TagSet @('table', 'tbody', 'thead', 'tfoot', 'tr')
$script:ClosesP = New-TagSet @('address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section', 'summary', 'ul',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'listing', 'form', 'li', 'dd', 'dt', 'plaintext', 'hr', 'xmp')
# '아무 닫는 태그' 를 찾다가 이런 요소를 만나면 그 닫는 태그는 버린다 (HTML 규격의 special)
$script:Special = New-TagSet @('address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br',
  'button', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr',
  'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link', 'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes',
  'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre', 'script', 'search', 'section', 'select', 'source', 'style', 'summary',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp')
# 이 태그들만 Open-Tag · Close-Tag 의 규칙을 탄다. 나머지는 Read-RecordTables 안에서 바로 처리
$script:OpenRule = New-TagSet (@('td', 'th', 'tr', 'table') + @($script:SectionOrCaption.Keys) + @($script:ClosesP.Keys))
$script:CloseRule = New-TagSet (@('td', 'th', 'tr', 'table', 'p') + @($script:SectionOrCaption.Keys))

function Get-Attrs([string]$s) {
  $h = @{}
  if (-not $s) { return $h }
  foreach ($m in $script:AttrRe.Matches($s)) {
    $n = $m.Groups[1].Value.ToLowerInvariant()
    if ($h.ContainsKey($n)) { continue }            # 같은 속성이 두 번이면 앞의 것
    $v = ''
    if ($m.Groups[2].Success) { $v = $m.Groups[2].Value }
    elseif ($m.Groups[3].Success) { $v = $m.Groups[3].Value }
    elseif ($m.Groups[4].Success) { $v = $m.Groups[4].Value }
    $h[$n] = [System.Net.WebUtility]::HtmlDecode($v)
  }
  return $h
}
# 요소: t=태그 ra=속성 원문 a=읽은 속성(필요할 때 읽는다) c=자식(요소·글자) p=부모
function New-El([string]$tag, [string]$attrs, $parent, [int]$start = -1) {
  return @{ t = $tag; ra = $attrs; a = $null; c = [System.Collections.ArrayList]::new(); p = $parent; s = $start }
}
function Get-A($n) { if ($null -eq $n.a) { $n.a = Get-Attrs $n.ra }; return $n.a }
function Test-Class($n, [string]$cls) {
  $ra = $n.ra                                               # 속성 원문에 그 글자조차 없으면 볼 것도 없다
  if (-not $ra -or $ra.IndexOf($cls, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
  $v = (Get-A $n)['class']
  if (-not $v) { return $false }
  foreach ($tok in $script:ClassSplitRe.Split($v)) { if ($tok -eq $cls) { return $true } }
  return $false
}
# 위에서부터 내려가며 names 중 하나를 찾는다. bounds 를 먼저 만나면 '범위 밖' (-1)
function Find-InScope($stack, [string[]]$names, $bounds) {
  for ($i = $stack.Count - 1; $i -ge 0; $i--) {
    $t = $stack[$i].t
    if ($names -contains $t) { return $i }
    if ($bounds.ContainsKey($t)) { return -1 }
  }
  return -1
}
function Pop-To($stack, [int]$i) { if ($i -lt $stack.Count) { $stack.RemoveRange($i, $stack.Count - $i) } }
function Clear-ToTable($stack) {
  for ($i = $stack.Count - 1; $i -ge 0; $i--) { if ($stack[$i].t -eq 'table') { Pop-To $stack ($i + 1); return } }
}
function Add-Text($stack, [string]$s) {
  if ($s.Length -eq 0 -or $stack.Count -eq 0) { return }
  $c = $stack[$stack.Count - 1].c
  if ($c.Count -gt 0 -and $c[$c.Count - 1] -is [string]) { $c[$c.Count - 1] = $c[$c.Count - 1] + $s }
  else { [void]$c.Add($s) }
}
function Open-Tag($stack, [string]$tag, [string]$attrs, $roots, [int]$start = -1) {
  if ($tag -eq 'td' -or $tag -eq 'th') {
    $i = Find-InScope $stack @('td', 'th') $script:TableScope
    if ($i -ge 0) { Pop-To $stack $i }                       # 앞 칸을 닫는다
    $i = Find-InScope $stack @('tr') $script:TableScope
    if ($i -ge 0) { Pop-To $stack ($i + 1) }
  }
  elseif ($tag -eq 'tr') {
    $i = Find-InScope $stack @('tr') $script:TableScope
    if ($i -ge 0) { Pop-To $stack $i }                       # 앞 줄을 닫는다
    $i = Find-InScope $stack @('tbody', 'thead', 'tfoot') $script:TableScope
    if ($i -ge 0) { Pop-To $stack ($i + 1) } else { Clear-ToTable $stack }
  }
  elseif ($script:SectionOrCaption.ContainsKey($tag)) {
    Clear-ToTable $stack
  }
  elseif ($tag -eq 'table') {
    # 칸 밖(표·줄 바로 안)에서 표가 또 열리면 브라우저는 앞 표를 닫는다
    if ($script:TableContext.ContainsKey($stack[$stack.Count - 1].t)) {
      $i = Find-InScope $stack @('table') $script:AnyTableScope
      if ($i -ge 0) { Pop-To $stack $i }
      if ($stack.Count -eq 0) {
        $el = New-El 'table' $attrs $null $start
        if (Test-Class $el 'mypage_record_pc') { $roots.Add($el); $stack.Add($el) }
        return
      }
    }
  }
  elseif ($script:ClosesP.ContainsKey($tag)) {
    $i = Find-InScope $stack @('p') $script:ButtonScope
    if ($i -ge 0) { Pop-To $stack $i }
  }
  if ($stack.Count -eq 0) { return }
  $top = $stack[$stack.Count - 1]
  $el = New-El $tag $attrs $top $start
  [void]$top.c.Add($el)
  if (-not $script:VoidTags.ContainsKey($tag)) { $stack.Add($el) }
}
function Close-Tag($stack, [string]$tag) {
  if ($tag -eq 'td' -or $tag -eq 'th' -or $tag -eq 'tr' -or $tag -eq 'table' -or $script:SectionOrCaption.ContainsKey($tag)) {
    $i = Find-InScope $stack @($tag) $script:TableScope
    if ($i -ge 0) { Pop-To $stack $i }
    return
  }
  if ($tag -eq 'p') {
    $i = Find-InScope $stack @('p') $script:ButtonScope
    if ($i -ge 0) { Pop-To $stack $i }
    else {                                                   # 열린 p 가 없으면 브라우저는 빈 <p> 를 끼워 넣는다
      $top = $stack[$stack.Count - 1]
      [void]$top.c.Add((New-El 'p' '' $top))
    }
  }
  # 나머지 닫는 태그는 Read-RecordTables 안에서 바로 처리한다
}
# 상벌점 표(들)만 나무로 만든다. 표 밖은 표가 시작하는 곳만 찾는다.
function Read-RecordTables([string]$Html) {
  $Html = $Html.Replace("`r`n", "`n").Replace("`r", "`n")
  $roots = New-Object System.Collections.Generic.List[object]
  $stack = New-Object System.Collections.Generic.List[object]
  $pos = 0
  foreach ($m in $script:TokRe.Matches($Html)) {
    if ($stack.Count -gt 0 -and $m.Index -gt $pos) {         # Add-Text 와 같다
      $s = $Html.Substring($pos, $m.Index - $pos)
      if ($s.IndexOf('&') -ge 0) { $s = [System.Net.WebUtility]::HtmlDecode($s) }
      $c = $stack[$stack.Count - 1].c
      if ($c.Count -gt 0 -and $c[$c.Count - 1] -is [string]) { $c[$c.Count - 1] = $c[$c.Count - 1] + $s }
      else { [void]$c.Add($s) }
    }
    $pos = $m.Index + $m.Length
    if ($stack.Count -eq 0) {
      if ($m.Groups[5].Success -and $m.Groups[4].Value -ne '/' -and $m.Groups[5].Value -eq 'table') {
        $el = New-El 'table' $m.Groups[6].Value $null $m.Index
        if (Test-Class $el 'mypage_record_pc') { $roots.Add($el); $stack.Add($el) }
      }
      continue
    }
    if ($m.Groups[1].Success) {                              # script·style 등: 안은 글자
      $tag = $m.Groups[1].Value.ToLowerInvariant()
      $top = $stack[$stack.Count - 1]
      $el = New-El $tag $m.Groups[2].Value $top $m.Index
      [void]$top.c.Add($el)
      $txt = $m.Groups[3].Value
      if ($tag -eq 'title' -or $tag -eq 'textarea') { $txt = [System.Net.WebUtility]::HtmlDecode($txt) }
      if ($txt.Length -gt 0) { [void]$el.c.Add($txt) }
      continue
    }
    if (-not $m.Groups[5].Success) { continue }              # 주석·doctype
    $tag = $m.Groups[5].Value.ToLowerInvariant()
    # 대부분은 span·b·br 같은 평범한 태그다 — 함수를 거치지 않고 바로 처리한다 (PowerShell 은 함수 부르기가 비싸다)
    if ($m.Groups[4].Value -eq '/') {
      if ($script:CloseRule.ContainsKey($tag)) { Close-Tag $stack $tag; continue }
      for ($i = $stack.Count - 1; $i -ge 0; $i--) {          # 같은 이름을 찾되, 블록(special)을 넘어서는 닫지 않는다
        $t = $stack[$i].t
        if ($t -eq $tag) { $stack.RemoveRange($i, $stack.Count - $i); break }
        if ($script:Special.ContainsKey($t)) { break }
      }
      continue
    }
    if ($script:OpenRule.ContainsKey($tag)) { Open-Tag $stack $tag $m.Groups[6].Value $roots $m.Index; continue }
    $top = $stack[$stack.Count - 1]                          # Open-Tag 의 마지막 부분과 같다
    $el = @{ t = $tag; ra = $m.Groups[6].Value; a = $null; c = [System.Collections.ArrayList]::new(); p = $top; s = $m.Index }
    [void]$top.c.Add($el)
    if (-not $script:VoidTags.ContainsKey($tag)) { $stack.Add($el) }
  }
  if ($stack.Count -gt 0 -and $pos -lt $Html.Length) { Add-Text $stack ([System.Net.WebUtility]::HtmlDecode($Html.Substring($pos))) }
  return , $roots
}
# 자손 중 (태그가 tag 이고) (class 에 cls 가 있는) 요소 — 문서 순서. -First 면 하나만.
function Find-Desc($root, [string]$tag, [string]$cls, [switch]$First) {
  $out = [System.Collections.Generic.List[object]]::new()     # New-Object 는 느려서 ::new()
  $st = [System.Collections.Generic.Stack[object]]::new()
  for ($i = $root.c.Count - 1; $i -ge 0; $i--) { $st.Push($root.c[$i]) }
  while ($st.Count -gt 0) {
    $n = $st.Pop()
    if ($n -isnot [hashtable]) { continue }
    $ok = (-not $tag -or $n.t -eq $tag)
    if ($ok -and $cls) {                                     # Test-Class 를 부르기 전에 속성 원문으로 먼저 거른다
      $ra = $n.ra
      $ok = ($ra -and $ra.IndexOf($cls, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and (Test-Class $n $cls))
    }
    if ($ok) {
      $out.Add($n)
      if ($First) { break }
    }
    for ($i = $n.c.Count - 1; $i -ge 0; $i--) { $st.Push($n.c[$i]) }
  }
  return , $out
}
function Get-Text($n) {                                      # textContent
  if ($n.c.Count -eq 0) { return '' }
  if ($n.c.Count -eq 1 -and $n.c[0] -is [string]) { return $n.c[0] }   # 글자 하나뿐인 칸 (대부분)
  $sb = [System.Text.StringBuilder]::new()
  $st = [System.Collections.Generic.Stack[object]]::new()
  $st.Push($n)
  while ($st.Count -gt 0) {
    $x = $st.Pop()
    if ($x -is [string]) { [void]$sb.Append($x); continue }
    for ($i = $x.c.Count - 1; $i -ge 0; $i--) { $st.Push($x.c[$i]) }
  }
  return $sb.ToString()
}
function Get-NextEl($n) {                                    # nextElementSibling
  $par = $n.p
  if ($null -eq $par) { return $null }
  $i = $par.c.IndexOf($n)
  for ($j = $i + 1; $j -lt $par.c.Count; $j++) { if ($par.c[$j] -is [hashtable]) { return $par.c[$j] } }
  return $null
}
function Get-TrimJs([string]$s) { if ($null -eq $s) { return '' }; return $s.Trim($script:WsChars) }
# 자바스크립트 parseInt — 못 읽으면 $null(NaN)
function ConvertTo-JsInt([string]$s) {
  if ($null -eq $s) { return $null }
  $m = $script:IntRe.Match($s)
  if (-not $m.Success) { return $null }
  if ($m.Groups[2].Success) {
    if ($m.Groups[2].Value.Length -gt 13) { return $null }
    $v = [Convert]::ToInt64($m.Groups[2].Value, 16)
  }
  else {
    $d = $m.Groups[3].Value.TrimStart('0')
    if ($d.Length -gt 15) { return $null }
    if ($d.Length -eq 0) { $v = [long]0 } else { $v = [long]::Parse($d, [Globalization.CultureInfo]::InvariantCulture) }
  }
  if ($m.Groups[1].Value -eq '-') { $v = - $v }
  return [long]$v
}
function ConvertTo-JsIntOr0([string]$s) { $v = ConvertTo-JsInt $s; if ($null -eq $v) { return [long]0 }; return $v }

function ConvertFrom-RiroHtml([string]$Html) {
  $result = New-Object System.Collections.Generic.List[object]
  foreach ($tbl in (Read-RecordTables $Html)) {
    foreach ($row in (Find-Desc $tbl 'tr' $null)) {
      if ((Get-A $row)['align'] -ne 'center') { continue }
      $tds = Find-Desc $row 'td' $null
      if ($tds.Count -lt 7) { continue }
      $hakbun = Get-TrimJs (Get-Text $tds[1])
      if ($hakbun.Length -lt 4) { continue }
      $name = Get-TrimJs (Get-Text $tds[2])
      if (-not $name) { continue }
      # 상세: 날짜(.label-record) 와 그 바로 다음 요소(내용). 담는 상자 이름이 바뀐다
      # (2026-10: .record-p → p.p_wrapper) — 상자 없이 줄 안에서 바로 찾는다 (scrape-riro.js 와 같다)
      $recs = New-Object System.Collections.Generic.List[object]
      foreach ($lb in (Find-Desc $row $null 'label-record')) {
        $date = Get-TrimJs (Get-Text $lb)
        $sib = Get-NextEl $lb
        $detail = ''
        if ($null -ne $sib) { $detail = Get-TrimJs ($script:WsRunRe.Replace((Get-Text $sib), ' ')) }
        if ($date -and $detail) { $recs.Add(@{ date = $date; detail = $detail }) }
      }
      $result.Add(@{
          hakbun   = $hakbun
          grade    = (ConvertTo-JsInt $hakbun.Substring(0, 1))
          room     = (ConvertTo-JsInt $hakbun.Substring(1, 2))
          num      = (ConvertTo-JsInt $hakbun.Substring(3))
          name     = $name
          total    = (ConvertTo-JsIntOr0 (Get-TrimJs (Get-Text $tds[3])))
          merit    = (ConvertTo-JsIntOr0 (Get-TrimJs (Get-Text $tds[4])))
          demerit  = (ConvertTo-JsIntOr0 (Get-TrimJs (Get-Text $tds[5])))
          deducted = (ConvertTo-JsIntOr0 (Get-TrimJs (Get-Text $tds[6])))
          records  = $recs
        })
    }
  }
  return , $result
}

# ══════════════════════════════════════════════════════════════════════
#  저장할 모양 (Firestore REST 의 값 표기)
# ══════════════════════════════════════════════════════════════════════
$script:CtrlRe = New-Object System.Text.RegularExpressions.Regex '[\u0000-\u001f\u2028\u2029]'
$script:CtrlEval = [System.Text.RegularExpressions.MatchEvaluator] {
  param($m)
  $c = [int][char]$m.Value
  if ($c -eq 8) { return '\b' }; if ($c -eq 9) { return '\t' }; if ($c -eq 10) { return '\n' }
  if ($c -eq 12) { return '\f' }; if ($c -eq 13) { return '\r' }
  return ('\u{0:x4}' -f $c)
}
function ConvertTo-JsonText([string]$s) {
  if ($null -eq $s) { return 'null' }
  $e = $s.Replace('\', '\\').Replace('"', '\"')
  if ($script:CtrlRe.IsMatch($e)) { $e = $script:CtrlRe.Replace($e, $script:CtrlEval) }
  return '"' + $e + '"'
}
function Format-Long($n) { return ([long]$n).ToString([Globalization.CultureInfo]::InvariantCulture) }
function ConvertTo-FsStr([string]$s) { return '{"stringValue":' + (ConvertTo-JsonText $s) + '}' }
function ConvertTo-FsInt($n) { if ($null -eq $n) { return '{"nullValue":null}' }; return '{"integerValue":"' + (Format-Long $n) + '"}' }
function ConvertTo-FsGradeDoc($list, [string]$iso) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"fields":{"students":{"arrayValue":{"values":[')
  $first = $true
  foreach ($s in $list) {
    if (-not $first) { [void]$sb.Append(',') }
    $first = $false
    [void]$sb.Append('{"mapValue":{"fields":{"hakbun":').Append((ConvertTo-FsStr $s.hakbun))
    foreach ($k in @('grade', 'room', 'num')) { [void]$sb.Append(',"' + $k + '":').Append((ConvertTo-FsInt $s[$k])) }
    [void]$sb.Append(',"name":').Append((ConvertTo-FsStr $s.name))
    foreach ($k in @('total', 'merit', 'demerit', 'deducted')) { [void]$sb.Append(',"' + $k + '":').Append((ConvertTo-FsInt $s[$k])) }
    [void]$sb.Append(',"records":{"arrayValue":{"values":[')
    $rf = $true
    foreach ($r in $s.records) {
      if (-not $rf) { [void]$sb.Append(',') }
      $rf = $false
      [void]$sb.Append('{"mapValue":{"fields":{"date":').Append((ConvertTo-FsStr $r.date)).Append(',"detail":').Append((ConvertTo-FsStr $r.detail)).Append('}}}')
    }
    [void]$sb.Append(']}}}}}')
  }
  [void]$sb.Append(']}},"updatedAt":').Append((ConvertTo-FsStr $iso)).Append(',"count":').Append((ConvertTo-FsInt $list.Count)).Append('}}')
  return $sb.ToString()
}
function ConvertTo-FsMetaDoc([string]$iso, [int]$total) {
  return '{"fields":{"updatedAt":' + (ConvertTo-FsStr $iso) + ',"total":' + (ConvertTo-FsInt $total) + '}}'
}
# 검사용: 원래 코드의 JSON.stringify 와 견줄 평범한 JSON
function ConvertTo-PlainJson($students) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($s in $students) {
    $rs = New-Object System.Collections.Generic.List[string]
    foreach ($r in $s.records) { $rs.Add('{"date":' + (ConvertTo-JsonText $r.date) + ',"detail":' + (ConvertTo-JsonText $r.detail) + '}') }
    $num = { param($v) if ($null -eq $v) { 'null' } else { Format-Long $v } }
    $parts.Add('{"hakbun":' + (ConvertTo-JsonText $s.hakbun) + ',"grade":' + (& $num $s.grade) + ',"room":' + (& $num $s.room) +
      ',"num":' + (& $num $s.num) + ',"name":' + (ConvertTo-JsonText $s.name) + ',"total":' + (& $num $s.total) +
      ',"merit":' + (& $num $s.merit) + ',"demerit":' + (& $num $s.demerit) + ',"deducted":' + (& $num $s.deducted) +
      ',"records":[' + ($rs -join ',') + ']}')
  }
  return '[' + ($parts -join ',') + ']'
}

# 학년별로 나누고, 이상하면 저장하지 않는다 — 잘못 읽은 표 하나로 앱의 상벌점이 통째로 비면 안 된다
function New-RiroPlan($students, [datetime]$now, [int]$minTotal, [int]$minPerGrade) {
  $g = @{}
  foreach ($k in 1, 2, 3) { $g[$k] = New-Object System.Collections.Generic.List[object] }
  $recs = 0
  foreach ($s in $students) {
    if ($s.grade -eq 1 -or $s.grade -eq 2 -or $s.grade -eq 3) { $g[[int]$s.grade].Add($s); $recs += $s.records.Count }
  }
  $total = $g[1].Count + $g[2].Count + $g[3].Count
  $problems = New-Object System.Collections.Generic.List[string]
  if ($total -lt $minTotal) { $problems.Add("학생이 $total 명만 읽혔습니다 (최소 $minTotal 명)") }
  foreach ($k in 1, 2, 3) { if ($g[$k].Count -lt $minPerGrade) { $problems.Add("$k 학년이 $($g[$k].Count) 명뿐입니다 (최소 $minPerGrade 명)") } }
  # 학년 초(3월)가 아니면 상세가 한 건도 없을 리 없다 — 화면이 바뀌어 상세만 못 읽은 것. 덮어쓰면 상세가 다 지워진다
  if ($recs -eq 0 -and $now.Month -ne 3) { $problems.Add('상세 내역이 한 건도 읽히지 않았습니다 (리로스쿨 화면이 바뀌었을 수 있음 → -Diagnose 로 진단 파일을 만들어 보내 주세요)') }
  $iso = $now.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $docs = New-Object System.Collections.Generic.List[object]
  foreach ($k in 1, 2, 3) { $docs.Add(@{ name = "grade$k"; json = (ConvertTo-FsGradeDoc $g[$k] $iso) }) }
  $docs.Add(@{ name = 'meta'; json = (ConvertTo-FsMetaDoc $iso $total) })
  return @{
    Total    = $total
    Records  = $recs
    ByGrade  = @($g[1].Count, $g[2].Count, $g[3].Count)
    Problems = $problems
    Docs     = $docs
    Summary  = "학생 $total 명 (1학년 $($g[1].Count) · 2학년 $($g[2].Count) · 3학년 $($g[3].Count)) · 상세 $recs 건"
  }
}

# ══════════════════════════════════════════════════════════════════════
#  인터넷 (PowerShell 5.1 · 7 둘 다)
# ══════════════════════════════════════════════════════════════════════
function Get-HttpError($err) {
  $resp = $err.Exception.Response
  if ($null -eq $resp) { return @{ Status = 0; Body = $err.Exception.Message } }
  $body = ''
  try {
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $body = $err.ErrorDetails.Message }
    elseif ($resp -is [System.Net.HttpWebResponse]) {
      $sr = New-Object System.IO.StreamReader ($resp.GetResponseStream())
      $body = $sr.ReadToEnd()
    }
  }
  catch { }
  return @{ Status = [int]$resp.StatusCode; Body = $body }
}
function Invoke-Http {
  param([string]$Method = 'GET', [string]$Uri, $Session, [hashtable]$Form, [byte[]]$Body, [string]$ContentType, [hashtable]$Headers, [int]$TimeoutSec = 90)
  $p = @{ Uri = $Uri; Method = $Method; UseBasicParsing = $true; TimeoutSec = $TimeoutSec; ErrorAction = 'Stop' }
  if ($Session) { $p.WebSession = $Session }
  if ($Form) { $p.Body = $Form }
  if ($Body) { $p.Body = $Body; $p.ContentType = $ContentType }
  if ($Headers) { $p.Headers = $Headers }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest @p
    return @{ Status = [int]$r.StatusCode; Bytes = $r.RawContentStream.ToArray(); Headers = $r.Headers; Ms = $sw.ElapsedMilliseconds }
  }
  catch {
    $e = Get-HttpError $_
    return @{ Status = $e.Status; Bytes = [Text.Encoding]::UTF8.GetBytes([string]$e.Body); Headers = @{}; Ms = $sw.ElapsedMilliseconds; Error = $_.Exception.Message }
  }
}
function ConvertFrom-HttpBytes([byte[]]$bytes, $headers) {
  if ($null -eq $bytes -or $bytes.Length -eq 0) { return '' }
  $ct = ''
  if ($headers) { $v = $headers['Content-Type']; if ($v) { $ct = ($v -join ';') } }
  $cs = $null
  $m = [regex]::Match($ct, 'charset\s*=\s*"?([^";\s]+)', 'IgnoreCase')
  if ($m.Success) { $cs = $m.Groups[1].Value }
  if (-not $cs) {
    $head = [Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min(4096, $bytes.Length))
    $m = [regex]::Match($head, '<meta[^>]+charset\s*=\s*["'']?([A-Za-z0-9_\-]+)', 'IgnoreCase')
    if ($m.Success) { $cs = $m.Groups[1].Value }
  }
  $enc = [Text.Encoding]::UTF8
  if ($cs -and $cs -notmatch '^utf-?8$') { try { $enc = [Text.Encoding]::GetEncoding($cs) } catch { } }
  $s = $enc.GetString($bytes)
  if ($s.Length -gt 0 -and $s[0] -eq [char]0xFEFF) { $s = $s.Substring(1) }
  return $s
}
# 받은 페이지에 어떤 낱말이 있는지만 (본문은 기록에 남기지 않는다)
function Get-Marks([string]$text) {
  $t = $text.ToLowerInvariant()
  $found = @()
  foreach ($pair in @(@('상벌점표', 'mypage_record_pc'), @('로그인화면', 'action=signin'), @('로그아웃', 'logout'), @('해외', '해외'),
      @('차단', '차단'), @('비밀번호변경', '비밀번호 변경'), @('비밀번호', '비밀번호'), @('잠금', '잠금'), @('실패', '실패'),
      @('cloudflare', 'cloudflare'), @('Access Denied', 'access denied'))) {
    if ($t.Contains($pair[1])) { $found += $pair[0] }
  }
  if ($found.Count -eq 0) { return '-' }
  return ($found -join ',')
}
# 로그인 응답의 생김새만 — 키 이름, 숫자·참거짓, 짧은 영문 코드. 한글 문장(이름이 섞일 수 있다)은 글자 수만
function Get-JsonShape([string]$text) {
  $j = $null
  try { $j = $text | ConvertFrom-Json } catch { }
  if ($j -isnot [System.Management.Automation.PSCustomObject]) { return "본문 JSON 아님 ($($text.Length)자 · 표시: $(Get-Marks $text))" }
  $parts = foreach ($p in $j.PSObject.Properties) {
    $v = $p.Value
    if ($null -eq $v -or $v -is [bool] -or $v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal]) { "$($p.Name)=$v" }
    elseif ($v -is [string] -and $v -match '^[A-Za-z0-9_.\-]{1,12}$') { "$($p.Name)=$v" }
    elseif ($v -is [string]) { "$($p.Name)($($v.Length)자)" }
    else { "$($p.Name)(…)" }
  }
  return 'JSON ' + (@($parts) -join ', ')
}
function Get-SchoolYear([datetime]$d) { if ($d.Month -ge 3) { return $d.Year }; return $d.Year - 1 }

function Invoke-RiroFetch([string]$Base, [string]$Id, [string]$Pw, [int]$Year) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $r = Invoke-Http -Uri "$Base/user.php?action=signin" -Session $s
  Write-Log "  리로스쿨 로그인 화면: HTTP $($r.Status) · $($r.Ms)ms"
  if ($r.Status -ne 200) { throw "리로스쿨에 접속하지 못했습니다 (HTTP $($r.Status)) $($r.Error)" }
  $r = Invoke-Http -Method POST -Uri "$Base/ajax.php" -Session $s -Form @{ app = 'user'; mode = 'login'; userType = '1'; id = $Id; pw = $Pw }
  Write-Log "  로그인 요청: HTTP $($r.Status) · $($r.Ms)ms · $(Get-JsonShape (ConvertFrom-HttpBytes $r.Bytes $r.Headers))"
  $r = Invoke-Http -Uri "$Base/" -Session $s
  $url = "$Base/my_page.php?club=index&action=record&Appwin=reload&Class=*45&yy=$Year"
  $r = Invoke-Http -Uri $url -Session $s -TimeoutSec 180
  $html = ConvertFrom-HttpBytes $r.Bytes $r.Headers
  Write-Log "  상벌점 페이지($Year 학년도): HTTP $($r.Status) · $($r.Ms)ms · $([Math]::Round($r.Bytes.Length / 1024)) KB · 표시: $(Get-Marks $html)"
  if ($r.Status -ne 200) { throw "상벌점 페이지를 받지 못했습니다 (HTTP $($r.Status))" }
  if (-not $html.Contains('mypage_record_pc')) {
    if ($html.Contains('해외')) { throw '해외 접속 차단 페이지가 왔습니다. 이 PC 가 학교 밖(VPN 등)으로 나가고 있지 않은지 확인하세요.' }
    if ($html.Contains('action=signin')) { throw '리로스쿨 로그인이 되지 않았습니다. 아이디·비밀번호를 확인하고 -Setup 으로 다시 저장하세요.' }
    throw '상벌점 표가 없는 페이지가 왔습니다. 리로스쿨 화면이 바뀌었을 수 있습니다.'
  }
  return $html
}
function Send-RiroDocs([string]$Worker, [string]$Key, $docs) {
  foreach ($d in $docs) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($d.json)
    $r = Invoke-Http -Method PUT -Uri ($Worker.TrimEnd('/') + '/riro/' + $d.name) -Body $bytes -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-Riro-Key' = $Key }
    $txt = ConvertFrom-HttpBytes $r.Bytes $null
    if ($txt.Length -gt 200) { $txt = $txt.Substring(0, 200) }
    Write-Log "  저장 $($d.name): HTTP $($r.Status) · $([Math]::Round($bytes.Length / 1024)) KB · $($r.Ms)ms"
    if ($r.Status -ne 200) { throw "워커에 저장하지 못했습니다 ($($d.name), HTTP $($r.Status)) $txt" }
  }
}
function Test-Worker([string]$Worker, [string]$Key) {
  $r = Invoke-Http -Uri ($Worker.TrimEnd('/') + '/riro/ping') -Headers @{ 'X-Riro-Key' = $Key } -TimeoutSec 30
  $txt = ConvertFrom-HttpBytes $r.Bytes $null
  if ($r.Status -eq 200) { Write-Log "  워커 연결: 정상 ($Worker)"; return $true }
  if ($r.Status -eq 401) { Write-Log "  워커 연결: 전송 암호가 맞지 않습니다 — 워커의 RIRO_KEY 와 이 PC 의 암호가 같은지 확인하세요" -Err; return $false }
  Write-Log "  워커 연결: 실패 (HTTP $($r.Status)) $($r.Error)" -Err
  return $false
}

# ══════════════════════════════════════════════════════════════════════
#  진단 (-Diagnose) — 상세가 안 읽힐 때 페이지의 '짜임' 만 파일로 남긴다
# ══════════════════════════════════════════════════════════════════════
# 학생 이름·숫자·글자는 모두 가린다: ASCII 밖의 글자(한글 등) → 가, 숫자 → 0, 글자 속 영문 → a.
# 태그 이름·class 이름처럼 짜임을 보여 주는 것만 남긴다. 파일을 열어 보면 확인할 수 있다.
$script:NonAsciiRe = New-Object System.Text.RegularExpressions.Regex '[^ -~\t\n\r]'
$script:DigitRe = New-Object System.Text.RegularExpressions.Regex '[0-9]'
$script:LatinRe = New-Object System.Text.RegularExpressions.Regex '[A-Za-z]'
$script:KeepAttrRe = New-Object System.Text.RegularExpressions.Regex '^(class|align|valign|style|colspan|rowspan|type|id|name|width|height|role|for|data-toggle|data-target|data-bs-toggle|data-bs-target|data-placement)$'
$script:UrlAttrRe = New-Object System.Text.RegularExpressions.Regex '^(href|src|action)$'
$script:JsStrRe = New-Object System.Text.RegularExpressions.Regex ('''(?:[^''\\\n]|\\.)*''|"(?:[^"\\\n]|\\.)*"')
function Get-Masked([string]$s, [switch]$KeepLatin) {
  $s = $script:NonAsciiRe.Replace($s, '가')
  $s = $script:DigitRe.Replace($s, '0')
  if (-not $KeepLatin) { $s = $script:LatinRe.Replace($s, 'a') }
  return $s
}
function Get-MaskedUrl([string]$u) {                         # 주소의 뼈대는 두고 = 뒤의 값은 가린다
  $u = Get-Masked $u -KeepLatin
  return [regex]::Replace($u, '=([^&#]*)', [System.Text.RegularExpressions.MatchEvaluator] { param($m) '=' + (Get-Masked $m.Groups[1].Value) })
}
# 스크립트: 코드의 영문(함수·변수 이름)은 두고 따옴표 안은 가린다. 다만 HTML 조각은 짜임만,
# 선택자('.record-p' 같은 것)와 객체 키("date": 같은 것)는 그대로
function Get-MaskedCode([string]$code) {
  $sb = [System.Text.StringBuilder]::new()
  $pos = 0
  foreach ($m in $script:JsStrRe.Matches($code)) {
    if ($m.Index -gt $pos) { [void]$sb.Append((Get-Masked $code.Substring($pos, $m.Index - $pos) -KeepLatin)) }
    $pos = $m.Index + $m.Length
    $q = $m.Value.Substring(0, 1)
    $inner = $m.Value.Substring(1, $m.Value.Length - 2)
    $after = $code.Substring($pos, [Math]::Min(4, $code.Length - $pos)).TrimStart()
    if ($inner.Contains('<')) { $mv = Get-MaskedHtml $inner }
    elseif ($inner -match 'record|label|mypage|^[.#][A-Za-z]') { $mv = Get-Masked $inner -KeepLatin }
    elseif ($after.StartsWith(':') -and $inner -match '^[A-Za-z_][A-Za-z0-9_]{0,30}$') { $mv = $inner }
    else { $mv = Get-Masked $inner }
    [void]$sb.Append($q).Append($mv).Append($q)
  }
  if ($pos -lt $code.Length) { [void]$sb.Append((Get-Masked $code.Substring($pos) -KeepLatin)) }
  return $sb.ToString()
}
function Get-MaskedAttrs([string]$s) {
  if (-not $s) { return '' }
  $sb = [System.Text.StringBuilder]::new()
  foreach ($m in $script:AttrRe.Matches($s)) {
    $n = $m.Groups[1].Value
    [void]$sb.Append(' ').Append((Get-Masked $n -KeepLatin))
    if (-not ($m.Groups[2].Success -or $m.Groups[3].Success -or $m.Groups[4].Success)) { continue }
    $v = $m.Groups[4].Value
    if ($m.Groups[2].Success) { $v = $m.Groups[2].Value } elseif ($m.Groups[3].Success) { $v = $m.Groups[3].Value }
    $dv = [System.Net.WebUtility]::HtmlDecode($v)
    $ln = $n.ToLowerInvariant()
    if ($ln.StartsWith('on')) { $mv = Get-MaskedCode $dv }
    elseif ($script:UrlAttrRe.IsMatch($ln)) { $mv = Get-MaskedUrl $dv }
    elseif ($script:KeepAttrRe.IsMatch($ln)) { $mv = Get-Masked $dv -KeepLatin }
    elseif ($dv.Contains('<')) { $mv = '{HTML ' + (Get-MaskedHtml $dv) + '}' }
    else { $mv = Get-Masked $dv }
    [void]$sb.Append('="').Append($mv.Replace('"', "'")).Append('"')
  }
  return $sb.ToString()
}
function Get-MaskedHtml([string]$h) {
  $sb = [System.Text.StringBuilder]::new()
  $pos = 0
  foreach ($m in $script:TokRe.Matches($h)) {
    if ($m.Index -gt $pos) { [void]$sb.Append((Get-Masked $h.Substring($pos, $m.Index - $pos))) }
    $pos = $m.Index + $m.Length
    if ($m.Groups[1].Success) {
      $t = $m.Groups[1].Value
      $inner = $m.Groups[3].Value
      if ($t -eq 'script') { $inner = Get-MaskedCode $inner } elseif ($t -eq 'style') { $inner = Get-Masked $inner -KeepLatin } else { $inner = Get-Masked $inner }
      [void]$sb.Append('<' + $t + (Get-MaskedAttrs $m.Groups[2].Value) + '>' + $inner + '</' + $t + '>')
    }
    elseif ($m.Groups[5].Success) { [void]$sb.Append('<' + $m.Groups[4].Value + $m.Groups[5].Value + (Get-MaskedAttrs $m.Groups[6].Value) + '>') }
    elseif ($m.Value.StartsWith('<!--')) { [void]$sb.Append('<!--' + (Get-MaskedHtml $m.Value.Substring(4)) + '[주석 끝]') }
    else { [void]$sb.Append((Get-Masked $m.Value -KeepLatin)) }
  }
  if ($pos -lt $h.Length) { [void]$sb.Append((Get-Masked $h.Substring($pos))) }
  return $sb.ToString()
}
# 낱말이 나오는 곳을 센다: 태그 속성 / 스크립트·스타일 안 / 주석 / 글자
function Get-WordPlaces([string]$h, [string]$word) {
  $idx = [System.Collections.Generic.List[int]]::new()
  $i = $h.IndexOf($word, [StringComparison]::OrdinalIgnoreCase)
  while ($i -ge 0) { $idx.Add($i); $i = $h.IndexOf($word, $i + 1, [StringComparison]::OrdinalIgnoreCase) }
  if ($idx.Count -eq 0) { return '0' }
  $tag = 0; $code = 0; $cmt = 0; $txt = 0; $k = 0
  foreach ($m in $script:TokRe.Matches($h)) {
    while ($k -lt $idx.Count -and $idx[$k] -lt $m.Index) { $txt++; $k++ }
    $end = $m.Index + $m.Length
    while ($k -lt $idx.Count -and $idx[$k] -lt $end) {
      if ($m.Groups[1].Success) { $code++ } elseif ($m.Value.StartsWith('<!--')) { $cmt++ } else { $tag++ }
      $k++
    }
    if ($k -ge $idx.Count) { break }
  }
  $txt += $idx.Count - $k
  return "$($idx.Count)  (태그 속성 $tag · 스크립트·스타일 안 $code · 주석 $cmt · 글자 $txt)"
}
function Add-TreeSketch($n, [int]$depth, $lines, [int]$max) {
  if ($lines.Count -ge $max) { return }
  $a = Get-A $n
  $d = $n.t
  if ($a['class']) { $d += '.' + ((Get-Masked $a['class'] -KeepLatin).Trim() -replace '\s+', '.') }
  foreach ($k in @($a.Keys | Sort-Object)) { if ($k -ne 'class') { $d += ' ' + $k } }
  $len = 0
  foreach ($c in $n.c) { if ($c -is [string]) { $len += $c.Trim().Length } }
  if ($len -gt 0) { $d += "  [글자 $len]" }
  $lines.Add(('  ' * $depth) + $d)
  foreach ($c in $n.c) { if ($c -is [hashtable]) { Add-TreeSketch $c ($depth + 1) $lines $max } }
}
function Get-RiroDiag([string]$html, $students) {
  $norm = $html.Replace("`r`n", "`n").Replace("`r", "`n")
  $L = [System.Collections.Generic.List[string]]::new()
  $recs = 0
  foreach ($s in $students) { $recs += $s.records.Count }
  $L.Add('리로스쿨 상벌점 페이지 진단 (riro-push.ps1 -Diagnose)')
  $L.Add('학생 이름·숫자·글자는 가렸습니다: 한글 등 → 가, 숫자 → 0, 글자 속 영문 → a. 태그·class 이름만 남깁니다.')
  $L.Add('만든 때 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " · 페이지 $($norm.Length) 자 · 읽은 학생 $($students.Count) · 상세 $recs")
  $L.Add('')
  $L.Add('■ 낱말이 나오는 곳')
  foreach ($w in @('mypage_record_pc', 'mypage_record_mobile', 'record-p', 'p_wrapper', 'label-record', 'record_p', 'label_record', 'record', '<script',
      'popover', 'tooltip', 'data-content', 'title=', 'onclick', '&lt;', 'ajax', '.html(', 'innerHTML', 'display:none', 'display: none')) {
    $L.Add(('  {0,-22} {1}' -f $w, (Get-WordPlaces $norm $w)))
  }
  $tables = Read-RecordTables $html
  $L.Add('')
  $L.Add("■ 해석기가 본 상벌점 표: $($tables.Count) 개")
  # 학생 줄마다 원문 길이(다음 <tr 까지)를 재서 가장 긴 줄을 본다 — 상세가 어떤 꼴로든 들어 있다면 거기다
  $rows = [System.Collections.Generic.List[object]]::new()
  foreach ($tbl in $tables) {
    foreach ($r in (Find-Desc $tbl 'tr' $null)) {
      if ((Get-A $r)['align'] -ne 'center' -or $r.s -lt 0) { continue }
      if ((Find-Desc $r 'td' $null).Count -lt 7) { continue }
      $end = $norm.IndexOf('<tr', $r.s + 3, [StringComparison]::OrdinalIgnoreCase)
      $tend = $norm.IndexOf('</table', $r.s + 3, [StringComparison]::OrdinalIgnoreCase)
      if ($end -lt 0 -or ($tend -ge 0 -and $tend -lt $end)) { $end = $tend }      # 마지막 줄은 표 끝까지
      if ($end -lt 0) { $end = $norm.Length }
      $rows.Add(@{ el = $r; len = $end - $r.s })
    }
  }
  if ($rows.Count -eq 0) { $L.Add('  학생 줄을 못 찾았습니다') }
  else {
    $lens = @($rows | ForEach-Object { $_.len } | Sort-Object)
    $L.Add("  학생 줄 $($rows.Count) 개 · 원문 길이 가장 짧은 $($lens[0]) · 가운데 $($lens[[int][Math]::Floor($lens.Count / 2)]) · 가장 긴 $($lens[$lens.Count - 1]) 자")
    $best = $rows[0]
    foreach ($x in $rows) { if ($x.len -gt $best.len) { $best = $x } }
    $row = $best.el
    $box = @()
    foreach ($c in @('record-p', 'p_wrapper')) { if ((Find-Desc $row $null $c -First).Count -gt 0) { $box += ".$c" } }
    $lb = Find-Desc $row $null 'label-record'
    $L.Add("  가장 긴 학생 줄: 칸(td) $((Find-Desc $row 'td' $null).Count) 개 · 상세 상자 $(if ($box.Count) { $box -join ',' } else { '없음' }) · .label-record $($lb.Count) 개")
    $L.Add('  짜임 (해석기 기준 · 글자는 수만):')
    $sk = [System.Collections.Generic.List[string]]::new()
    Add-TreeSketch $row 2 $sk 150
    $L.AddRange($sk)
    $L.Add('')
    $L.Add('■ 그 줄의 원문 (가림)')
    $L.Add((Get-MaskedHtml $norm.Substring($row.s, [Math]::Min($best.len, 8000))))
  }
  foreach ($w in @('mypage_record_pc', 'label-record', 'record-p')) {
    $i = $norm.IndexOf($w, [StringComparison]::OrdinalIgnoreCase)
    if ($i -lt 0) { continue }
    $a = [Math]::Max(0, $i - 1500)
    $b = [Math]::Min($norm.Length, $i + 2500)
    $L.Add('')
    $L.Add("■ '$w' 가 처음 나오는 곳 앞뒤 (원문, 가림)")
    $L.Add((Get-MaskedHtml $norm.Substring($a, $b - $a)))
  }
  return $L
}
function Invoke-Diagnose {
  $sec = Read-Secret
  Write-Log '진단 시작 (저장 안 함)'
  $html = Invoke-RiroFetch $RiroBase $sec.id $sec.pw (Get-SchoolYear (Get-Date))
  $students = ConvertFrom-RiroHtml $html
  $lines = Get-RiroDiag $html $students
  $file = Join-Path $script:AppDir 'riro-diag.txt'
  Set-Content -Path $file -Value $lines -Encoding UTF8
  foreach ($l in $lines) { if ($l -match '^\s*(record-p|p_wrapper|label-record|mypage_record_pc) |학생 줄') { Out-Line $l } }
  $out = $file
  try {
    $desk = [Environment]::GetFolderPath('Desktop')
    if ($desk -and (Test-Path $desk)) { $out = Join-Path $desk 'riro-diag.txt'; Copy-Item -Path $file -Destination $out -Force }
  }
  catch { $out = $file }
  Write-Log "진단 파일: $out  (학생 정보는 가렸습니다 — 열어서 확인한 뒤 보내 주세요)"
}
function Show-Key {
  $sec = Read-Secret
  Out-Line '전송 암호 (Cloudflare 워커의 RIRO_KEY 에 넣을 값):' 'Yellow'
  Out-Line "  $($sec.key)"
  try { Set-Clipboard -Value $sec.key; Out-Line '  (클립보드에 복사했습니다 — Ctrl+V 로 붙여 넣으세요)' } catch { }
}

# ══════════════════════════════════════════════════════════════════════
#  설정·기록
# ══════════════════════════════════════════════════════════════════════
function Resolve-HomeDir {
  if ($HomeDir) { return $HomeDir }
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
  return (Join-Path $base 'ynhs-riro')
}
# 화면에 한 줄. Write-Host 를 쓰지 않는다 — 위의 콘솔 버그로 Write-Host 와 오류 출력(out-lineoutput)까지
# 터졌다. 콘솔에 바로 쓰고, 그마저 안 되면 조용히 넘어간다. 화면 때문에 동기화가 멈추면 안 된다.
function Out-Line([string]$text, [string]$color = '') {
  $old = $null
  try {
    if ($color) { $old = [Console]::ForegroundColor; [Console]::ForegroundColor = $color }
    [Console]::Out.WriteLine($text)
  }
  catch { }
  finally { if ($null -ne $old) { try { [Console]::ForegroundColor = $old } catch { } } }
}
function Write-Log([string]$msg, [switch]$Err) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  if ($Err) { Out-Line $line 'Red' } else { Out-Line $line }
  if ($script:LogFile) { try { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 } catch { } }
}
function Limit-Log {
  if (-not (Test-Path $script:LogFile)) { return }
  if ((Get-Item $script:LogFile).Length -lt 300KB) { return }
  $keep = Get-Content -Path $script:LogFile -Encoding UTF8 | Select-Object -Last 400
  Set-Content -Path $script:LogFile -Value $keep -Encoding UTF8
}
function ConvertFrom-Secure($ss) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Save-Secret($obj) {
  New-Item -ItemType Directory -Force -Path $script:AppDir | Out-Null
  $json = $obj | ConvertTo-Json -Compress
  # Windows 에서는 DPAPI 로 잠긴다 — 이 PC 의 이 Windows 사용자만 풀 수 있다
  $enc = ConvertFrom-SecureString (ConvertTo-SecureString $json -AsPlainText -Force)
  Set-Content -Path (Join-Path $script:AppDir 'secret.dat') -Value $enc -Encoding ASCII
}
function Read-Secret {
  $f = Join-Path $script:AppDir 'secret.dat'
  if (-not (Test-Path $f)) { throw "설정이 없습니다. 먼저 -Setup 을 실행하세요. ($f)" }
  $json = ConvertFrom-Secure (ConvertTo-SecureString ((Get-Content -Path $f -Raw).Trim()))
  return ($json | ConvertFrom-Json)
}
function New-RandomKey {
  $b = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  return ([Convert]::ToBase64String($b)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-Setup {
  Out-Line ''
  Out-Line '리로스쿨 상벌점 → 앱 동기화 설정' 'Cyan'
  Out-Line '계정은 이 PC 의 이 Windows 사용자만 풀 수 있게 잠가서 저장합니다.'
  Out-Line ''
  $old = $null
  try { $old = Read-Secret } catch { }
  $id = Read-Host '리로스쿨 아이디'
  if (-not $id) { throw '아이디를 넣지 않았습니다.' }
  $pw = ConvertFrom-Secure (Read-Host '리로스쿨 비밀번호' -AsSecureString)
  if (-not $pw) { throw '비밀번호를 넣지 않았습니다.' }
  $defWorker = $script:DefaultWorker
  if ($old -and $old.worker) { $defWorker = $old.worker }
  $worker = Read-Host "워커 주소 (그냥 Enter = $defWorker)"
  if (-not $worker) { $worker = $defWorker }
  if ($worker -notmatch '^https?://') { $worker = 'https://' + $worker }
  $key = $null
  if ($old -and $old.key -and -not $NewKey) { $key = $old.key }
  $made = $false
  if (-not $key) { $key = New-RandomKey; $made = $true }
  Save-Secret @{ id = $id; pw = $pw; worker = $worker.TrimEnd('/'); key = $key }
  Out-Line ''
  Out-Line "저장했습니다: $script:AppDir" 'Green'
  if ($made) {
    Out-Line ''
    Out-Line '전송 암호를 새로 만들었습니다. Cloudflare 의 riro-ingest 워커에 RIRO_KEY 로 넣어 주세요:' 'Yellow'
    Out-Line "  $key"
    try { Set-Clipboard -Value $key; Out-Line '  (클립보드에도 복사해 두었습니다)' } catch { }
  }
  else {
    Out-Line '전송 암호는 전에 쓰던 것을 그대로 둡니다. (새로 만들려면 -Setup -NewKey)'
  }
  Out-Line ''
  Out-Line '다음: -Check 로 받아 보기 → -Install 로 자동 실행 등록'
}

function Install-Task {
  $dest = Join-Path $script:AppDir 'riro-push.ps1'
  New-Item -ItemType Directory -Force -Path $script:AppDir | Out-Null
  if ($PSCommandPath -and ($PSCommandPath -ne $dest)) { Copy-Item -Path $PSCommandPath -Destination $dest -Force }
  try { Unblock-File -Path $dest } catch { }
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $dest + '"'
  $action = New-ScheduledTaskAction -Execute $ps -Argument $arg -WorkingDirectory $script:AppDir
  $days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')
  $triggers = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At '07:50'),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At '16:40'))
  # 꺼져 있다 켜진 날을 위해 로그인할 때도 한 번 (3분 뒤). 권한 때문에 안 되면 이것만 뺀다
  $logon = $null
  try { $logon = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name); $logon.Delay = 'PT3M' } catch { }
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
  $desc = '리로스쿨 상벌점을 받아 ynhs 앱에 저장합니다 (riro-push.ps1)'
  $ok = $false
  if ($logon) {
    try { Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger ($triggers + $logon) -Settings $set -Description $desc -Force -ErrorAction Stop | Out-Null; $ok = $true }
    catch { Out-Line '로그인할 때 실행은 권한이 없어 뺍니다.' 'Yellow' }
  }
  if (-not $ok) {
    Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $triggers -Settings $set -Description $desc -Force -ErrorAction Stop | Out-Null
  }
  Out-Line "자동 실행을 등록했습니다: 평일 07:50 · 16:40$(if ($ok) { ' · 로그인 3분 뒤' })  (작업 이름 $script:TaskName)" 'Green'
  Out-Line "실행 파일: $dest"
  Out-Line "기록: $script:LogFile"
}
function Uninstall-Task {
  Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Out-Line "자동 실행을 해제했습니다 ($script:TaskName). 저장한 계정은 $script:AppDir 에 남아 있습니다 — 지우려면 그 폴더를 지우세요."
}

function Invoke-Sync([switch]$DryRun) {
  $sec = Read-Secret
  $now = Get-Date
  $year = Get-SchoolYear $now
  Write-Log ($(if ($DryRun) { '확인 시작 (저장 안 함)' } else { '동기화 시작' }))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $html = Invoke-RiroFetch $RiroBase $sec.id $sec.pw $year
  $students = ConvertFrom-RiroHtml $html
  $plan = New-RiroPlan $students $now $MinTotal $MinPerGrade
  Write-Log "  해석: $($plan.Summary) · $([Math]::Round($sw.Elapsed.TotalSeconds, 1))초"
  if ($DryRun) {
    # 해석에 문제가 있어도 워커 연결은 본다 — 워커 설정을 따로 확인할 수 있게
    $workerOk = Test-Worker $sec.worker $sec.key
    if ($plan.Problems.Count -gt 0) { throw ('저장하지 않습니다 — ' + ($plan.Problems -join ' / ')) }
    if (-not $workerOk) { throw '워커 연결을 확인하세요.' }
    Write-Log '확인 끝 — 이상 없습니다. 저장은 하지 않았습니다.'
    return
  }
  if ($plan.Problems.Count -gt 0) { throw ('저장하지 않습니다 — ' + ($plan.Problems -join ' / ')) }
  Send-RiroDocs $sec.worker $sec.key $plan.Docs
  Write-Log "동기화 끝 — $($plan.Summary) 저장"
}

# ══════════════════════════════════════════════════════════════════════
if ($LoadOnly) { return }
$script:AppDir = Resolve-HomeDir
$script:LogFile = Join-Path $script:AppDir 'riro.log'
try {
  New-Item -ItemType Directory -Force -Path $script:AppDir | Out-Null
  Limit-Log
  if ($Setup) { Invoke-Setup }
  elseif ($Install) { Install-Task }
  elseif ($Uninstall) { Uninstall-Task }
  elseif ($ShowKey) { Show-Key }
  elseif ($Diagnose) { Invoke-Diagnose }
  elseif ($Check) { Invoke-Sync -DryRun }
  else { Invoke-Sync }
  exit 0
}
catch {
  Write-Log ('실패: ' + $_.Exception.Message) -Err
  exit 1
}
