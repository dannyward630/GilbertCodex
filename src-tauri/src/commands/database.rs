use crate::core::storage::{self, DeviceStorageSeed, DeviceStorageSnapshot};

#[tauri::command]
pub fn gilbert_database_load(
    app: tauri::AppHandle,
    namespace: String,
    seeds: Vec<DeviceStorageSeed>,
) -> Result<DeviceStorageSnapshot, String> {
    storage::load_namespace(&app, &namespace, &seeds)
}

#[tauri::command]
pub fn gilbert_database_set_value(
    app: tauri::AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    storage::write_value(&app, &namespace, &key, &value)
}

#[tauri::command]
pub fn gilbert_database_set_values(
    app: tauri::AppHandle,
    namespace: String,
    values: Vec<DeviceStorageSeed>,
) -> Result<(), String> {
    storage::write_values(&app, &namespace, &values)
}
