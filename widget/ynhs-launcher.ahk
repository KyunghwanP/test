#Requires AutoHotkey v2.0
#SingleInstance Force
; ============================================================
;  영남고 위젯 — 자동 업데이트 런처 (exe 배포용)
;  · 이 런처를 exe로 빌드해 두면, 받는 PC에 AutoHotkey가 없어도 실행된다.
;  · 실행할 때마다 GitHub Release에서 최신 ynhs-widget.exe 를 받아 교체한 뒤 실행한다.
;    (버전이 같으면 다시 받지 않고, 오프라인이면 기존 파일로 조용히 실행)
;  · 위젯 본체(ynhs-widget.exe)도 exe라서 AutoHotkey 없이 단독 실행된다.
;
;  배포/사용:
;    1) 릴리스 페이지에서 ynhs-launcher.exe 하나만 받아 원하는 폴더에 둔다.
;    2) 더블클릭하면 최신 위젯을 받아 실행한다.
;    3) 시작프로그램 등록:  Win+R → shell:startup → 이 exe의 바로가기를 넣기.
; ============================================================

global REPO    := "KyunghwanP/test"
global TAG     := "widget-latest"                 ; 롤링 릴리스 태그(항상 최신 자산)
global BASEURL := "https://github.com/" REPO "/releases/download/" TAG "/"
global EXE_URL := BASEURL "ynhs-widget.exe"
global VER_URL := BASEURL "version.txt"

global DIR     := A_AppData "\YnhsWidget"
global EXE     := DIR "\ynhs-widget.exe"
global VERFILE := DIR "\version.txt"

try DirCreate(DIR)

; ── 1) 최신 버전 확인(version.txt 비교) ────────────────────
needUpdate := !FileExist(EXE)
remoteVer  := ""
try {
    remoteVer := Trim(HttpGetText(VER_URL), " `t`r`n")
    localVer  := FileExist(VERFILE) ? Trim(FileRead(VERFILE), " `t`r`n") : ""
    if (remoteVer != "" && remoteVer != localVer)
        needUpdate := true
}

; ── 2) 필요하면 exe 내려받아 교체(실행 중이라 잠기면 기존 파일 유지) ──
if needUpdate {
    tmp := EXE ".new"
    if DownloadFile(EXE_URL, tmp) {
        try {
            if FileExist(EXE)
                FileDelete(EXE)
            FileMove(tmp, EXE, 1)
            if (remoteVer != "") {
                if FileExist(VERFILE)
                    FileDelete(VERFILE)
                FileAppend(remoteVer, VERFILE)
            }
        } catch {
            try FileDelete(tmp)          ; 교체 실패(위젯 실행 중 등) → 다음 실행 때 갱신
        }
    } else if !FileExist(EXE) {
        MsgBox("위젯을 내려받지 못했고 기존 파일도 없습니다.`n"
            . "인터넷 연결을 확인한 뒤 다시 실행해 주세요.`n`n(" EXE_URL ")", "영남고 위젯", 0x30)
        ExitApp
    }
}

; ── 3) 위젯 실행 (exe라 AutoHotkey 불필요) ─────────────────
Run('"' EXE '"')
ExitApp

HttpGetText(url) {
    req := ComObject("WinHttp.WinHttpRequest.5.1")
    req.Open("GET", url, false)
    req.Option[6] := true                ; 리다이렉트 따라가기(릴리스 자산은 CDN으로 302)
    req.SetRequestHeader("Cache-Control", "no-cache")
    req.Send()
    if (req.Status != 200)
        throw Error("HTTP " req.Status)
    return req.ResponseText
}

DownloadFile(url, path) {
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("GET", url, false)
        req.Option[6] := true
        req.SetRequestHeader("Cache-Control", "no-cache")
        req.Send()
        if (req.Status != 200)
            return false
        st := ComObject("ADODB.Stream")
        st.Type := 1                     ; 바이너리 그대로 저장
        st.Open()
        st.Write(req.ResponseBody)
        st.SaveToFile(path, 2)           ; 2 = 있으면 덮어쓰기
        st.Close()
        return true
    } catch {
        return false
    }
}
