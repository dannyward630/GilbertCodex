mod app;
mod commands;
pub mod core;

pub fn run() {
    let app = app::builder()
        .build(tauri::generate_context!())
        .expect("failed to build Gilbert Codex");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
            commands::nine_router::shutdown_nine_router_on_exit(app_handle);
        }
        _ => {}
    });
}
