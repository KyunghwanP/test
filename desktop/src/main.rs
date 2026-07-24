// 영남고 데스크톱 앱 (wry = Tauri의 웹뷰 코어)
//  · github.io 라이브 포털을 그대로 로드 → 내용 자동 반영
//  · target=_blank / window.open(새 창 요청)은 네이티브에서 가로채 기본 브라우저로 연다
//    → 원격 페이지라도 JS 브릿지 없이 동작
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const URL: &str = "https://kyunghwanp.github.io/test/";

// 실행 중 창/작업표시줄 아이콘 (exe에 임베드된 파일 아이콘과 별개로 런타임에도 지정)
fn load_icon() -> Option<tao::window::Icon> {
    let img = image::load_from_memory(include_bytes!("../icon.png"))
        .ok()?
        .into_rgba8();
    let (w, h) = img.dimensions();
    tao::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

// 포털이 window.ipc.postMessage(JSON)로 보낸 알림 → Windows 네이티브 토스트
// (앱이 최소화돼 있어도 화면 위에 뜬다)
fn show_toast(title: &str, body: &str) {
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        let _ = Toast::new(Toast::POWERSHELL_APP_ID)
            .title(title)
            .text1(body)
            .show();
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
        .with_ipc_handler(|req| {
            // 포털에서 온 메시지(알림 등) 처리
            handle_ipc(req.body());
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
