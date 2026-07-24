fn main() {
    // Windows: exe 파일 아이콘 임베드 (탐색기·작업표시줄 고정 시 표시)
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("icon.ico");
        if let Err(e) = res.compile() {
            eprintln!("winresource: {e}");
        }
    }
}
