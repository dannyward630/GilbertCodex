use crate::core::fs_utils::path_to_string;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

const DATABASE_FOLDER_NAME: &str = "GilbertCodex";
const DATABASE_FILE_NAME: &str = "Gilbert Database.sqlite3";
const DATABASE_SCHEMA_VERSION: &str = "2";
const KEY_VALUE_TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS database_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS app_storage (
  namespace TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  storage_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, storage_key)
);
CREATE INDEX IF NOT EXISTS app_storage_updated_at_idx
  ON app_storage(namespace, updated_at);
CREATE TABLE IF NOT EXISTS chat_records (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  title TEXT NOT NULL,
  project_name TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  content_bytes INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, chat_id)
);
CREATE INDEX IF NOT EXISTS chat_records_project_idx
  ON chat_records(namespace, project_name, updated_at);
CREATE TABLE IF NOT EXISTS project_records (
  namespace TEXT NOT NULL,
  project_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  has_local_workspace INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, project_id)
);
CREATE INDEX IF NOT EXISTS project_records_name_idx
  ON project_records(namespace, name);
CREATE TABLE IF NOT EXISTS vector_embeddings (
  namespace TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL DEFAULT '',
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, collection, entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS vector_embeddings_collection_idx
  ON vector_embeddings(namespace, collection, updated_at);
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
    sync_namespace_projections(&connection, &namespace)?;

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
        })?;

    sync_storage_projection(&connection, &namespace, &key, value)
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
    })?;

    sync_namespace_projections(&connection, &namespace)
}

pub fn user_namespace(user_id: &str) -> Result<String, String> {
    let sanitized = sanitize_storage_scope(user_id);
    normalize_identifier(&format!("user.{sanitized}"), "storage namespace")
}

pub fn database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents = match app.path().document_dir() {
        Ok(path) => path,
        Err(error) => fallback_documents_dir()
            .ok_or_else(|| format!("Could not resolve the user's Documents folder: {error}"))?,
    };
    let database_dir = documents.join(DATABASE_FOLDER_NAME);

    fs::create_dir_all(&database_dir).map_err(|error| {
        format!(
            "Could not create the GilbertCodex database folder at {}: {error}",
            path_to_string(&database_dir)
        )
    })?;

    let database_path = database_dir.join(DATABASE_FILE_NAME);
    migrate_legacy_database_files(&documents, &database_path)?;

    Ok(database_path)
}

pub fn legacy_database_file_family(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let documents = match app.path().document_dir() {
        Ok(path) => path,
        Err(error) => fallback_documents_dir()
            .ok_or_else(|| format!("Could not resolve the user's Documents folder: {error}"))?,
    };

    Ok(database_file_family(&documents.join(DATABASE_FILE_NAME)))
}

fn migrate_legacy_database_files(documents: &Path, database_path: &Path) -> Result<(), String> {
    let legacy_database_path = documents.join(DATABASE_FILE_NAME);

    if legacy_database_path == database_path
        || !legacy_database_path.exists()
        || database_path.exists()
    {
        return Ok(());
    }

    move_file(&legacy_database_path, database_path)?;

    for legacy_path in database_file_family(&legacy_database_path)
        .into_iter()
        .skip(1)
    {
        if !legacy_path.exists() {
            continue;
        }

        let suffix = legacy_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(DATABASE_FILE_NAME))
            .unwrap_or_default();
        move_file(
            &legacy_path,
            &PathBuf::from(format!("{}{}", path_to_string(database_path), suffix)),
        )?;
    }

    Ok(())
}

fn move_file(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Could not create local database folder at {}: {error}",
                path_to_string(parent)
            )
        })?;
    }

    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, target).map_err(|error| {
                format!(
                    "Could not copy local database from {} to {}: {error}",
                    path_to_string(source),
                    path_to_string(target)
                )
            })?;
            fs::remove_file(source).map_err(|error| {
                format!(
                    "Could not remove migrated local database at {}: {error}",
                    path_to_string(source)
                )
            })
        }
    }
}

fn database_file_family(database_path: &Path) -> Vec<PathBuf> {
    let path_text = path_to_string(database_path);
    vec![
        database_path.to_path_buf(),
        PathBuf::from(format!("{path_text}-journal")),
        PathBuf::from(format!("{path_text}-wal")),
        PathBuf::from(format!("{path_text}-shm")),
    ]
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

fn sync_namespace_projections(connection: &Connection, namespace: &str) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "SELECT storage_key, storage_value
             FROM app_storage
             WHERE namespace = ?1",
        )
        .map_err(|error| format!("Could not prepare local database projection sync: {error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read local database projections: {error}"))?;
    let mut values = Vec::new();

    for row in rows {
        let (key, value) = row
            .map_err(|error| format!("Could not decode local database projection row: {error}"))?;
        values.push((key, value));
    }

    drop(statement);

    for (key, value) in values {
        sync_storage_projection(connection, namespace, &key, &value)?;
    }

    Ok(())
}

fn sync_storage_projection(
    connection: &Connection,
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    match key {
        "gilbert-codex.chats.v1" => sync_chat_records(connection, namespace, key, value),
        "gilbert-codex.projects.v1" => sync_project_records(connection, namespace, key, value),
        _ => Ok(()),
    }
}

fn sync_chat_records(
    connection: &Connection,
    namespace: &str,
    storage_key: &str,
    value: &str,
) -> Result<(), String> {
    let Ok(chats) = serde_json::from_str::<Value>(value) else {
        return Ok(());
    };
    let Some(chats) = chats.as_array() else {
        return Ok(());
    };

    connection
        .execute(
            "DELETE FROM chat_records WHERE namespace = ?1",
            params![namespace],
        )
        .map_err(|error| format!("Could not clear chat database projection: {error}"))?;

    for chat in chats {
        let chat_id = json_string(chat, "id", "unknown-chat");
        let raw_json = serde_json::to_string(chat).unwrap_or_else(|_| "{}".to_string());

        connection
            .execute(
                "INSERT INTO chat_records(
                   namespace, chat_id, storage_key, title, project_name, updated_at,
                   archived, pinned, message_count, content_bytes, raw_json, indexed_at
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(namespace, chat_id) DO UPDATE SET
                   storage_key = excluded.storage_key,
                   title = excluded.title,
                   project_name = excluded.project_name,
                   updated_at = excluded.updated_at,
                   archived = excluded.archived,
                   pinned = excluded.pinned,
                   message_count = excluded.message_count,
                   content_bytes = excluded.content_bytes,
                   raw_json = excluded.raw_json,
                   indexed_at = excluded.indexed_at",
                params![
                    namespace,
                    chat_id,
                    storage_key,
                    json_string(chat, "title", "New chat"),
                    json_string(chat, "project", "No project"),
                    json_string(chat, "updatedAt", ""),
                    json_bool(chat, "archived") as i64,
                    json_bool(chat, "pinned") as i64,
                    json_array_len(chat, "messages") as i64,
                    raw_json.len() as i64,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Could not update chat database projection: {error}"))?;
    }

    Ok(())
}

fn sync_project_records(
    connection: &Connection,
    namespace: &str,
    storage_key: &str,
    value: &str,
) -> Result<(), String> {
    let Ok(projects) = serde_json::from_str::<Value>(value) else {
        return Ok(());
    };
    let Some(projects) = projects.as_array() else {
        return Ok(());
    };

    connection
        .execute(
            "DELETE FROM project_records WHERE namespace = ?1",
            params![namespace],
        )
        .map_err(|error| format!("Could not clear project database projection: {error}"))?;

    for project in projects {
        let project_id = json_string(project, "id", "unknown-project");
        let raw_json = serde_json::to_string(project).unwrap_or_else(|_| "{}".to_string());

        connection
            .execute(
                "INSERT INTO project_records(
                   namespace, project_id, storage_key, name, updated_at, has_local_workspace, raw_json, indexed_at
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(namespace, project_id) DO UPDATE SET
                   storage_key = excluded.storage_key,
                   name = excluded.name,
                   updated_at = excluded.updated_at,
                   has_local_workspace = excluded.has_local_workspace,
                   raw_json = excluded.raw_json,
                   indexed_at = excluded.indexed_at",
                params![
                    namespace,
                    project_id,
                    storage_key,
                    json_string(project, "name", "No project"),
                    json_string(project, "updatedAt", ""),
                    project.get("localWorkspace").is_some() as i64,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Could not update project database projection: {error}"))?;
    }

    Ok(())
}

fn json_string(value: &Value, field: &str, fallback: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn json_bool(value: &Value, field: &str) -> bool {
    value.get(field).and_then(Value::as_bool).unwrap_or(false)
}

fn json_array_len(value: &Value, field: &str) -> usize {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0)
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

    connection
        .execute(
            "INSERT INTO database_metadata(key, value, updated_at)
             VALUES('schema_version', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            params![DATABASE_SCHEMA_VERSION],
        )
        .map_err(|error| {
            format!(
                "Could not update local database metadata at {}: {error}",
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

fn sanitize_storage_scope(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.trim().chars() {
        if sanitized.len() >= 80 {
            break;
        }

        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('-');
        }
    }

    if sanitized.is_empty() {
        "local".to_string()
    } else {
        sanitized
    }
}

fn fallback_documents_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join("Documents"))
}
