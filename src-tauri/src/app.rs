use crate::commands;

pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::app_info::get_app_info])
}
