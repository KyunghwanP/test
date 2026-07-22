#Requires AutoHotkey v2.0
#SingleInstance Force
; ============================================================
;  영남고 위젯 — 실행기 (서명된 AutoHotkey로 구동 · 무설치 포터블)
;  · 배포 패키지 안에서 이 스크립트는 'YnhsWidget.ahk'라는 이름으로 들어가고,
;    같은 폴더의 서명된 AutoHotkey(YnhsWidget.exe = 이름만 바꾼 AutoHotkey64.exe)가
;    자기와 같은 이름의 스크립트를 자동 실행 → 실제로 도는 건 '서명된' 프로그램.
;  · 실행할 때마다 GitHub main에서 최신 ynhs-widget.ahk(스크립트=텍스트)를 받아
;    교체한 뒤 그 스크립트를 같은 서명된 AutoHotkey로 실행한다.
;      → "exe 다운로드 후 실행"이 아니라 "텍스트 스크립트 실행"이라 백신 오탐이 적다.
;    인터넷이 안 되면 함께 배포된 기존 스크립트로 조용히 실행한다.
; ============================================================

global RAW    := "https://raw.githubusercontent.com/KyunghwanP/test/main/widget/ynhs-widget.ahk"
global TARGET := A_ScriptDir "\ynhs-widget.ahk"

; ── 최신 위젯 스크립트 받기(실패/오프라인이면 기존 파일 사용) ──
try {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("GET", RAW, false)
    req.Option[6] := true                       ; 리다이렉트 따라가기
    req.SetRequestHeader("Cache-Control", "no-cache")
    req.Send()
    if (req.Status = 200 && StrLen(req.ResponseText) > 800) {   ; 정상 응답만(부분/오류 페이지 방지)
        st := ComObject("ADODB.Stream")
        st.Type := 1                            ; 바이너리 그대로 저장(한글 깨짐 없음)
        st.Open()
        st.Write(req.ResponseBody)
        st.SaveToFile(TARGET, 2)                ; 2 = 있으면 덮어쓰기
        st.Close()
    }
}

if !FileExist(TARGET) {
    MsgBox("위젯 스크립트를 찾지 못했습니다.`n인터넷 연결을 확인한 뒤 다시 실행해 주세요.", "영남고 위젯", 0x30)
    ExitApp
}

; ── 같은(서명된) AutoHotkey로 위젯 실행 ─────────────────────
Run('"' A_AhkPath '" "' TARGET '"')             ; A_AhkPath = YnhsWidget.exe(서명된 AutoHotkey)
ExitApp
