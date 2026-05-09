use crate::commands;
use tauri::Manager;

pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .manage(commands::auth::AuthState::default())
        .manage(commands::computer::files::ComputerFileIndexState::default())
        .manage(commands::terminal::TerminalState::default())
        .setup(|app| {
            if let Some(icon) = app.default_window_icon().cloned() {
                for window in app.webview_windows().values() {
                    window.set_icon(icon.clone())?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::auth_create_account,
            commands::auth::auth_get_login_challenge,
            commands::auth::auth_get_state,
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::app_info::get_app_info,
            commands::computer::files::computer_build_file_index,
            commands::computer::files::computer_get_default_workspace,
            commands::computer::files::computer_get_file_index_summary,
            commands::computer::files::computer_list_directory,
            commands::computer::files::computer_list_drives,
            commands::computer::files::computer_pick_folder,
            commands::computer::files::computer_read_text_file,
            commands::computer::files::computer_search_file_index,
            commands::computer::files::computer_write_text_file,
            commands::terminal::terminal_create_session,
            commands::terminal::terminal_drain_session,
            commands::terminal::terminal_kill_session,
            commands::terminal::terminal_write_session,
            commands::web::duckduckgo_search
        ])
}
