#Requires AutoHotkey v2.0
#SingleInstance Off
; ============================================================
;  영남고 통합앱 — 실행기(런처, 서명된 AutoHotkey로 구동 · 무설치 포터블)
;  · 배포 패키지 안에서 이 스크립트는 '영남고.ahk'라는 이름으로 들어가고,
;    같은 폴더의 서명된 AutoHotkey(영남고.exe = 이름만 바꾼 AutoHotkey64.exe)가
;    자기와 같은 이름의 스크립트를 자동 실행 → 실제로 도는 건 '서명된' 프로그램.
;  · 실행할 때마다 GitHub main에서 최신 app/ynhs-app.ahk(텍스트 스크립트)를 받아
;    교체한 뒤 그 스크립트를 같은 서명된 AutoHotkey로 실행한다(재다운로드 없이 자동 업데이트).
;    인터넷이 안 되면 함께 배포된 기존 스크립트로 조용히 실행한다.
; ============================================================

; raw.githubusercontent 은 CDN에 ~5분 캐시되므로 GitHub API(raw accept)로 즉시 최신본을 받는다.
global RAW    := "https://api.github.com/repos/KyunghwanP/test/contents/app/ynhs-app.ahk?ref=main"
global TARGET := A_ScriptDir "\ynhs-app.ahk"

; ── 최신 앱 스크립트 받기(실패/오프라인이면 기존 파일 사용) ──
try {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("GET", RAW, false)
    req.Option[6] := true                       ; 리다이렉트 따라가기
    req.SetRequestHeader("Accept", "application/vnd.github.raw")
    req.SetRequestHeader("User-Agent", "YnhsApp")
    req.SetRequestHeader("Cache-Control", "no-cache")
    req.Send()
    if (req.Status = 200 && StrLen(req.ResponseText) > 800) {
        st := ComObject("ADODB.Stream")
        st.Type := 1                            ; 바이너리 그대로 저장(한글 깨짐 없음)
        st.Open()
        st.Write(req.ResponseBody)
        st.SaveToFile(TARGET, 2)                ; 2 = 있으면 덮어쓰기
        st.Close()
    }
}

if !FileExist(TARGET) {
    MsgBox("앱 스크립트를 찾지 못했습니다.`n인터넷 연결을 확인한 뒤 다시 실행해 주세요.", "영남고", 0x30)
    ExitApp
}

; ── 같은(서명된) AutoHotkey로 앱 실행 ──
Run('"' A_AhkPath '" "' TARGET '"')             ; A_AhkPath = 영남고.exe(서명된 AutoHotkey)
ExitApp
