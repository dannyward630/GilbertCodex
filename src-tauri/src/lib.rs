mod app;
mod commands;
pub mod core;

pub fn run() {
    app::builder()
        .run(tauri::generate_context!())
        .expect("failed to run Gilbert Codex");
}
