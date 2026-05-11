use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, fs, path::PathBuf};
use tauri::Manager;

const DATABASE_FILE_NAME: &str = "Gilbert Database.sqlite3";
const KEY_VALUE_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS app_storage (
  namespace TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, storage_key)
);
CREATE INDEX IF NOT EXISTS app_storage_updated_at_idx
  ON app_storage(namespace, updated_at);
"#;

pub const SYSTEM_NAMESPACE: &str = "system";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStorageSeed {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStorageSnapshot {
    pub database_path: String,
    pub namespace: String,
    pub values: HashMap<String, String>,
}

pub fn load_namespace(
    app: &tauri::AppHandle,
    namespace: &str,
    seeds: &[DeviceStorageSeed],
) -> Result<DeviceStorageSnapshot, String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let database_path = database_path(app)?;
    let mut connection = open_database_at(&database_path)?;

    seed_missing_values(&mut connection, &namespace, seeds)?;

    let mut statement = connection
        .prepare(
            "SELECT storage_key, storage_value
             FROM app_storage
             WHERE namespace = ?1",
        )
        .map_err(|error| format!("Could not prepare local database read: {error}"))?;
    let rows = statement
        .query_map(params![&namespace], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read local database records: {error}"))?;
    let mut values = HashMap::new();

    for row in rows {
        let (key, value) = row.map_err(|error| {
            format!(
                "Could not read a local database record from {}: {error}",
                path_to_string(&database_path)
            )
        })?;
        values.insert(key, value);
    }

    Ok(DeviceStorageSnapshot {
        database_path: path_to_string(&database_path),
        namespace,
        values,
    })
}

pub fn read_value(
    app: &tauri::AppHandle,
    namespace: &str,
    key: &str,
) -> Result<Option<String>, String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let key = normalize_identifier(key, "storage key")?;
    let database_path = database_path(app)?;
    let connection = open_database_at(&database_path)?;

    connection
        .query_row(
            "SELECT storage_value
             FROM app_storage
             WHERE namespace = ?1 AND storage_key = ?2",
            params![&namespace, &key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| {
            format!(
                "Could not read local database value from {}: {error}",
                path_to_string(&database_path)
            )
        })
}

pub fn write_value(
    app: &tauri::AppHandle,
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let key = normalize_identifier(key, "storage key")?;
    let database_path = database_path(app)?;
    let connection = open_database_at(&database_path)?;

    connection
        .execute(
            "INSERT INTO app_storage(namespace, storage_key, storage_value, updated_at)
             VALUES(?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(namespace, storage_key) DO UPDATE SET
               storage_value = excluded.storage_value,
               updated_at = excluded.updated_at",
            params![&namespace, &key, value],
        )
        .map(|_| ())
        .map_err(|error| {
            format!(
                "Could not write local database value to {}: {error}",
                path_to_string(&database_path)
            )
        })
}

pub fn write_values(
    app: &tauri::AppHandle,
    namespace: &str,
    values: &[DeviceStorageSeed],
) -> Result<(), String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let database_path = database_path(app)?;
    let mut connection = open_database_at(&database_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start local database write: {error}"))?;

    for value in values {
        let key = normalize_identifier(&value.key, "storage key")?;

        transaction
            .execute(
                "INSERT INTO app_storage(namespace, storage_key, storage_value, updated_at)
                 VALUES(?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(namespace, storage_key) DO UPDATE SET
                   storage_value = excluded.storage_value,
                   updated_at = excluded.updated_at",
                params![&namespace, &key, &value.value],
            )
            .map_err(|error| {
                format!(
                    "Could not write local database value to {}: {error}",
                    path_to_string(&database_path)
                )
            })?;
    }

    transaction.commit().map_err(|error| {
        format!(
            "Could not commit local database writes to {}: {error}",
            path_to_string(&database_path)
        )
    })
}

pub fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = match app.path().document_dir() {
        Ok(path) => path,
        Err(error) => fallback_documents_dir()
            .ok_or_else(|| format!("Could not resolve the user's Documents folder: {error}"))?,
    };

    fs::create_dir_all(&documents).map_err(|error| {
        format!(
            "Could not create the user's Documents folder at {}: {error}",
            path_to_string(&documents)
        )
    })?;

    Ok(documents.join(DATABASE_FILE_NAME))
}

fn seed_missing_values(
    connection: &mut Connection,
    namespace: &str,
    seeds: &[DeviceStorageSeed],
) -> Result<(), String> {
    if seeds.is_empty() {
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start local database migration: {error}"))?;

    for seed in seeds {
        let key = normalize_identifier(&seed.key, "storage key")?;
        let existing = transaction
            .query_row(
                "SELECT 1
                 FROM app_storage
                 WHERE namespace = ?1 AND storage_key = ?2",
                params![namespace, &key],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Could not check local database migration state: {error}"))?;

        if existing.is_some() {
            continue;
        }

        transaction
            .execute(
                "INSERT INTO app_storage(namespace, storage_key, storage_value, updated_at)
                 VALUES(?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                params![namespace, &key, &seed.value],
            )
            .map_err(|error| {
                format!("Could not migrate local browser storage into the database: {error}")
            })?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit local database migration: {error}"))
}

fn open_database_at(path: &PathBuf) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create local database folder at {}: {error}",
                path_to_string(parent)
            )
        })?;
    }

    let connection = Connection::open(path).map_err(|error| {
        format!(
            "Could not open local database at {}: {error}",
            path_to_string(path)
        )
    })?;

    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            "#,
        )
        .map_err(|error| {
            format!(
                "Could not configure local database at {}: {error}",
                path_to_string(path)
            )
        })?;

    connection
        .execute_batch(KEY_VALUE_TABLE_SQL)
        .map_err(|error| {
            format!(
                "Could not prepare local database schema at {}: {error}",
                path_to_string(path)
            )
        })?;

    Ok(connection)
}

fn normalize_identifier(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Err(format!("The {label} cannot be empty."));
    }

    if trimmed.len() > 160 {
        return Err(format!("The {label} is too long."));
    }

    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
    }) {
        return Err(format!("The {label} contains unsupported characters."));
    }

    Ok(trimmed.to_string())
}

fn fallback_documents_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join("Documents"))
}

fn path_to_string(path: impl AsRef<std::path::Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}
