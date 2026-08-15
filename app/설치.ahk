#Requires AutoHotkey v2.0
#SingleInstance Off
; ============================================================
;  영남고 통합앱 — 설치기 (서명된 AutoHotkey로 구동)
;  · 앱 파일을 %LOCALAPPDATA%\영남고\ 에 복사(설치) → 바탕화면·시작메뉴
;    바로가기(로고 아이콘) 생성 → 실행. 관리자 권한 불필요(사용자 폴더).
;  · 설치 후 다운로드한 압축 폴더는 지워도 됩니다.
; ============================================================

src := A_ScriptDir "\App Files"   ; 앱 파일은 안쪽 이 폴더에 들어있음
dest := EnvGet("LOCALAPPDATA")
if (dest = "")
    dest := A_AppData
dest .= "\영남고"

; 업데이트 설치 대비: 실행 중인 앱 종료
try ProcessClose("영남고.exe")
Sleep 500

; 파일 복사 (이미 설치 위치에서 실행한 경우엔 건너뜀 — 바로가기만 갱신)
if (src != dest) {
    try DirCreate(dest)
    ; robocopy로 폴더(하위 WebView2 포함) 통째 복사. /E=하위폴더 포함, 로그 최소화.
    RunWait(A_ComSpec ' /c robocopy "' src '" "' dest '" /E /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1', , "Hide")
}

if !FileExist(dest "\영남고.exe") {
    MsgBox("설치에 실패했습니다(파일 복사 오류).`n다른 위치에 압축을 풀고 다시 시도해 주세요.", "영남고 설치", "Icon!")
    ExitApp
}

; 바로가기 생성 (로고 아이콘)
exe := dest "\영남고.exe"
ico := dest "\icon.ico"
try FileCreateShortcut(exe, A_Desktop "\영남고.lnk", dest, "", "영남고 포털", ico)          ; 바탕화면
try FileCreateShortcut(exe, A_Programs "\영남고.lnk", dest, "", "영남고 포털", ico)         ; 시작 메뉴 실행
; 부팅 시 자동 실행 — 묻고 나서 결정한다(임의로 등록하지 않는다).
;   재설치 때도 다시 묻고, '아니오'면 기존 등록을 지운다 → 대답이 항상 실제 상태와 일치.
startupLnk := A_Startup "\영남고.lnk"
autorun := (MsgBox("컴퓨터를 켤 때 영남고 앱을 자동으로 실행할까요?`n`n"
                 . "지금 정하지 않아도, 이 설치 파일을 다시 실행하면 바꿀 수 있습니다.",
                   "영남고 설치", 0x24) = "Yes")
if autorun
    try FileCreateShortcut(exe, startupLnk, dest, "", "영남고 포털", ico)
else
    try FileDelete(startupLnk)
try FileCreateShortcut(dest "\제거.exe", A_Programs "\영남고 제거.lnk", dest, "", "영남고 제거", ico)  ; 시작 메뉴 제거

MsgBox("설치가 완료되었습니다.`n`n"
    . "· 바탕화면의 '영남고' 아이콘으로 실행하세요.`n"
    . (autorun ? "· 부팅 시 자동으로 실행됩니다.`n"
               : "· 부팅 시 자동 실행은 하지 않습니다(설치 파일을 다시 실행하면 바꿀 수 있어요).`n")
    . "· 바탕화면 위젯은 앱 트레이 아이콘 → '바탕화면 위젯'에서 켜세요.`n"
    . "· 제거는 시작 메뉴의 '영남고 제거'.`n`n"
    . "(이 다운로드 폴더는 이제 삭제하셔도 됩니다.)", "영남고 설치", "Iconi")
Run('"' exe '"', dest)
ExitApp
