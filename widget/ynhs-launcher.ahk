#Requires AutoHotkey v2.0
#SingleInstance Force
; ============================================================
;  영남고 위젯 — 자동 업데이트 실행기 (런처)
;  · 실행할 때마다 GitHub에서 최신 ynhs-widget.ahk 를 내려받아 교체한 뒤 실행한다.
;    → 위젯 '동작' 코드가 바뀌어도 이 런처만 켜면 늘 최신 버전이 뜬다(재빌드 불필요).
;  · 웹/앱 내용(급식·시간표·성적…)은 원래도 실시간이라 이와 무관하게 자동 반영됨.
;
;  준비물(최초 1회):
;    - AutoHotkey v2 설치
;    - 이 폴더에 WebView2 라이브러리(WebView2.ahk · ComVar.ahk · Promise.ahk ·
;      WebView2\ 폴더 · WebView2Loader.dll)  ← README 참고
;  부팅 시 자동 실행:  Win+R → shell:startup → 이 파일의 '바로가기'를 넣기.
; ============================================================

; ── 설정 ───────────────────────────────────────────────────
global BRANCH  := "main"        ; 코드를 받아올 브랜치(앱이 배포되는 브랜치)
global REPO    := "KyunghwanP/test"
global RAW_URL := "https://raw.githubusercontent.com/" REPO "/" BRANCH "/widget/ynhs-widget.ahk"
global TARGET  := A_ScriptDir "\ynhs-widget.ahk"

; ── 1) 최신 스크립트 내려받기(실패하면 기존 파일 그대로 사용) ──
downloaded := false
try {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("GET", RAW_URL, false)
    req.SetRequestHeader("Cache-Control", "no-cache")
    req.SetRequestHeader("Pragma", "no-cache")
    req.Option[6] := true          ; 리다이렉트 따라가기
    req.Send()
    if (req.Status = 200) {
        stream := ComObject("ADODB.Stream")
        stream.Type := 1           ; 바이너리(원본 바이트 그대로 저장 → 한글 깨짐 없음)
        stream.Open()
        stream.Write(req.ResponseBody)
        stream.SaveToFile(TARGET, 2)   ; 2 = 있으면 덮어쓰기
        stream.Close()
        downloaded := true
    }
} catch {
    downloaded := false            ; 오프라인 등 → 조용히 기존 파일로 진행
}

; ── 2) 최신(또는 기존) 위젯 스크립트 실행 ──────────────────
if !FileExist(TARGET) {
    MsgBox("위젯 스크립트를 찾지 못했고 다운로드도 실패했습니다.`n"
        . "인터넷 연결을 확인한 뒤 다시 실행해 주세요.`n`n(" RAW_URL ")", "영남고 위젯", 0x30)
    ExitApp
}

ahk := A_AhkPath                   ; 이 런처를 실행 중인 AutoHotkey 실행 파일
if (!ahk || !FileExist(ahk)) {
    MsgBox("AutoHotkey v2 실행 파일을 찾지 못했습니다.`n"
        . "AutoHotkey v2를 설치한 뒤 이 런처를 실행해 주세요.", "영남고 위젯", 0x30)
    ExitApp
}
Run('"' ahk '" "' TARGET '"')      ; ynhs-widget.ahk 는 #SingleInstance Force → 구버전 있으면 자동 교체
ExitApp
