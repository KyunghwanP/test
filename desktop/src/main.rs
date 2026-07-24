// 영남고 데스크톱 앱 (wry = Tauri의 웹뷰 코어)
//  · github.io 라이브 포털을 그대로 로드 → 내용 자동 반영
//  · target=_blank / window.open(새 창 요청)은 네이티브에서 가로채 기본 브라우저로 연다
//    → 원격 페이지라도 JS 브릿지 없이 동작
//  · 포털 알림 → Windows 네이티브 토스트 (앱 이름·아이콘은 우리 것으로 표시)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::OnceLock;

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const URL: &str = "https://kyunghwanp.github.io/test/";

// 토스트를 우리 앱 신분(이름·아이콘)으로 띄우기 위한 AppUserModelID
#[cfg(windows)]
const AUMID: &str = "YeongnamHigh.Portal";

// 등록 성공 시 토스트에 쓸 app_id / 본문 왼쪽 아이콘 경로
static TOAST_APP_ID: OnceLock<String> = OnceLock::new();
static TOAST_ICON_PATH: OnceLock<String> = OnceLock::new();

// shell32: 현재 프로세스의 AppUserModelID 지정 (토스트 신분 매칭용)
#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
}

#[cfg(windows)]
fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// 실행 중 창/작업표시줄 아이콘 (exe에 임베드된 파일 아이콘과 별개로 런타임에도 지정)
fn load_icon() -> Option<tao::window::Icon> {
    let img = image::load_from_memory(include_bytes!("../icon.png"))
        .ok()?
        .into_rgba8();
    let (w, h) = img.dimensions();
    tao::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

// 앱 시작 시: 아이콘을 고정 경로에 저장하고 AUMID를 레지스트리에 등록한다.
// → 토스트가 "Windows PowerShell"이 아니라 "영남고등학교" + 우리 아이콘으로 뜬다.
// 실패하면 아무것도 세팅하지 않아 PowerShell 신분으로 폴백(알림은 계속 동작).
#[cfg(windows)]
fn setup_app_identity() {
    // 1) 아이콘을 고정 경로에 저장 (portable exe라 설치 경로가 없음)
    let dir = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("ynhs-desktop");
    let _ = std::fs::create_dir_all(&dir);
    let icon_path = dir.join("icon.png");
    if std::fs::write(&icon_path, include_bytes!("../icon.png")).is_ok() {
        let _ = TOAST_ICON_PATH.set(icon_path.to_string_lossy().to_string());
    }

    // 2) 레지스트리에 AUMID 등록 (표시 이름 + 헤더 아이콘)
    let mut registered = false;
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) =
            hkcu.create_subkey(format!("Software\\Classes\\AppUserModelId\\{AUMID}"))
        {
            let display_name: &str = "영남고등학교";
            let ok_name = key.set_value("DisplayName", &display_name).is_ok();
            let ok_icon = match TOAST_ICON_PATH.get() {
                Some(p) => key.set_value("IconUri", p).is_ok(),
                None => true,
            };
            registered = ok_name && ok_icon;
        }
    }

    // 3) 프로세스 AUMID 지정
    let w = wide_null(AUMID);
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(w.as_ptr());
    }

    if registered {
        let _ = TOAST_APP_ID.set(AUMID.to_string());
    }
}

// 포털이 window.ipc.postMessage(JSON)로 보낸 알림 → Windows 네이티브 토스트
// (앱이 최소화돼 있어도 화면 위에 뜬다)
fn show_toast(title: &str, body: &str) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::{IconCrop, Toast};

        // 등록된 AUMID가 있으면 우리 신분으로, 없으면 PowerShell 신분으로 폴백
        let app_id = TOAST_APP_ID
            .get()
            .map(|s| s.as_str())
            .unwrap_or(Toast::POWERSHELL_APP_ID);

        let mut toast = Toast::new(app_id).title(title).text1(body);

        // 본문 왼쪽에 앱 로고 이미지 붙이기 (appLogoOverride)
        if let Some(p) = TOAST_ICON_PATH.get() {
            toast = toast.icon(std::path::Path::new(p), IconCrop::Circular, "영남고등학교");
        }

        let _ = toast.show();
    }
    #[cfg(not(windows))]
    {
        let _ = (title, body);
    }
}

fn handle_ipc(msg: &str) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(msg) {
        let title = v.get("title").and_then(|x| x.as_str()).unwrap_or("영남고등학교");
        let body = v.get("body").and_then(|x| x.as_str()).unwrap_or("");
        show_toast(title, body);
    }
}

fn main() -> wry::Result<()> {
    #[cfg(windows)]
    setup_app_identity();

    let event_loop = EventLoopBuilder::new().build();
    let window = WindowBuilder::new()
        .with_title("영남고등학교")
        .with_inner_size(LogicalSize::new(1040.0, 1010.0))
        .with_min_inner_size(LogicalSize::new(640.0, 670.0))
        .with_window_icon(load_icon())
        .build(&event_loop)
        .expect("창 생성 실패");

    let _webview = WebViewBuilder::new(&window)
        .with_url(URL)?
        .with_new_window_req_handler(|url| {
            // 새 창 요청 → 기본 브라우저로 열고, 앱 안 새 창은 막음
            let _ = webbrowser::open(&url);
            false
        })
        .with_ipc_handler(|req: String| {
            // 포털에서 온 메시지(알림 등) 처리
            handle_ipc(&req);
        })
        .build()?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
