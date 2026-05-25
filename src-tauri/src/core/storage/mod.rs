use crate::core::{fs_utils::path_to_string, secure_storage};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::Manager;

const DATABASE_FOLDER_NAME: &str = "GilbertCodex";
const DATABASE_FILE_NAME: &str = "Gilbert Database.sqlite3";
const DATABASE_SCHEMA_VERSION: &str = "3";
const DATABASE_BUSY_TIMEOUT_MS: u64 = 5_000;
const CHATS_STORAGE_KEY: &str = "gilbert-codex.chats.v1";
const ACTIVE_CHAT_STORAGE_KEY: &str = "gilbert-codex.active-chat.v1";
const PROVIDER_SETTINGS_STORAGE_KEY: &str = "gilbert-codex.provider-settings.v1";
const DISCORD_BRIDGE_STORAGE_KEY: &str = "gilbert-codex.discord-bridge.v1";
const MAPBOX_SETTINGS_STORAGE_KEY: &str = "gilbert-codex.mapbox-settings.v1";
const GOOGLE_OAUTH_SETTINGS_STORAGE_KEY: &str = "gilbert-codex.google-oauth-settings.v1";
const API_KEY_VAULT_STORAGE_KEY: &str = "gilbert-codex.api-key-vault.v1";
const GITHUB_ACCOUNT_STORAGE_KEY: &str = "github-account.v1";
const MCP_SERVERS_STORAGE_KEY: &str = "mcp-servers.v1";
const AGENT_RUNS_STORAGE_KEY: &str = "agent-runs.v1";
const CHAT_MEMORY_STORAGE_PREFIX: &str = "gilbert-codex.chat-memory.v1.";
const PROJECT_MEMORY_STORAGE_PREFIX: &str = "gilbert-codex.project-memory.v1.";
const SECRET_REFERENCE_PREFIX: &str = "keyring://gilbert-codex/";
static DATABASE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static DATABASE_SCHEMA_PREPARED_PATHS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
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
  vector_blob BLOB,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, collection, entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS vector_embeddings_collection_idx
  ON vector_embeddings(namespace, collection, updated_at);
CREATE TABLE IF NOT EXISTS chat_messages (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  content_bytes INTEGER NOT NULL DEFAULT 0,
  reasoning_bytes INTEGER NOT NULL DEFAULT 0,
  thinking_bytes INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  approval_count INTEGER NOT NULL DEFAULT 0,
  artifact_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS chat_messages_chat_idx
  ON chat_messages(namespace, chat_id, message_index);
CREATE INDEX IF NOT EXISTS chat_messages_role_idx
  ON chat_messages(namespace, role, updated_at);
CREATE TABLE IF NOT EXISTS chat_message_items (
  namespace TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, chat_id, message_id, item_kind, item_index),
  FOREIGN KEY (namespace, chat_id, message_id)
    REFERENCES chat_messages(namespace, chat_id, message_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_message_items_kind_idx
  ON chat_message_items(namespace, item_kind);
CREATE TABLE IF NOT EXISTS agent_runs (
  namespace TEXT NOT NULL,
  run_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  pending_tool_call_content TEXT,
  local_workspace_json TEXT,
  raw_json TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, run_id)
);
CREATE INDEX IF NOT EXISTS agent_runs_updated_idx
  ON agent_runs(namespace, updated_at);
CREATE INDEX IF NOT EXISTS agent_runs_chat_idx
  ON agent_runs(namespace, chat_id, updated_at);
CREATE TABLE IF NOT EXISTS agent_run_steps (
  namespace TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  detail TEXT,
  input TEXT,
  output TEXT,
  approval_id TEXT,
  tool_call_id TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (namespace, run_id, step_id),
  FOREIGN KEY (namespace, run_id)
    REFERENCES agent_runs(namespace, run_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_run_steps_order_idx
  ON agent_run_steps(namespace, run_id, step_index);
CREATE TABLE IF NOT EXISTS agent_run_events (
  namespace TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (namespace, run_id, event_id),
  FOREIGN KEY (namespace, run_id)
    REFERENCES agent_runs(namespace, run_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_run_events_order_idx
  ON agent_run_events(namespace, run_id, event_index);
CREATE TABLE IF NOT EXISTS agent_run_approvals (
  namespace TEXT NOT NULL,
  run_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  approval_index INTEGER NOT NULL,
  tool TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  risk TEXT NOT NULL,
  title TEXT NOT NULL,
  command TEXT,
  path TEXT,
  preview TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  message_id TEXT,
  tool_call_id TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (namespace, run_id, approval_id),
  FOREIGN KEY (namespace, run_id)
    REFERENCES agent_runs(namespace, run_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_run_approvals_status_idx
  ON agent_run_approvals(namespace, status, created_at);
CREATE TABLE IF NOT EXISTS agent_run_items (
  namespace TEXT NOT NULL,
  run_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY (namespace, run_id, item_kind, item_index),
  FOREIGN KEY (namespace, run_id)
    REFERENCES agent_runs(namespace, run_id)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_run_items_kind_idx
  ON agent_run_items(namespace, item_kind);
CREATE TABLE IF NOT EXISTS memory_events (
  namespace TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL,
  PRIMARY KEY (namespace, collection, entity_id, event_id)
);
CREATE INDEX IF NOT EXISTS memory_events_entity_idx
  ON memory_events(namespace, collection, entity_id, event_index);
CREATE TABLE IF NOT EXISTS memory_chunks (
  namespace TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  event_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB,
  vector_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT '',
  raw_json TEXT NOT NULL,
  PRIMARY KEY (namespace, collection, entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS memory_chunks_collection_idx
  ON memory_chunks(namespace, collection, updated_at);
CREATE TABLE IF NOT EXISTS secure_secret_references (
  namespace TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  keyring_target TEXT NOT NULL,
  migrated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (namespace, secret_key)
);
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

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NamespaceProjectionMode {
    Full,
    Startup,
}

struct MemoryVectorProjectionRow {
    chunk_id: String,
    content: String,
    content_hash: String,
    dimensions: i64,
    event_id: String,
    metadata_json: String,
    model: String,
    raw_json: String,
    record_id: String,
    source: String,
    summary: String,
    updated_at: String,
    vector_blob: Vec<u8>,
    vector_json: String,
}

struct PreparedStorageValue {
    references: Vec<SecureSecretReference>,
    value: String,
}

struct SecureSecretReference {
    keyring_target: String,
    provider: String,
    secret_key: String,
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
    sync_startup_namespace_projections(&connection, &namespace)?;

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
        values.insert(
            key.clone(),
            hydrate_storage_value(&namespace, &key, &value)?,
        );
    }

    drop(statement);

    if !values.contains_key(CHATS_STORAGE_KEY) {
        let active_chat_id = values.get(ACTIVE_CHAT_STORAGE_KEY).map(String::as_str);

        if let Some(chats) = load_startup_typed_chats_json(&connection, &namespace, active_chat_id)?
        {
            values.insert(CHATS_STORAGE_KEY.to_string(), chats);
        }
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

    if key == CHATS_STORAGE_KEY {
        if let Some(chats) = load_typed_chats_json(&connection, &namespace)? {
            return Ok(Some(chats));
        }
    }

    let value = connection
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
        })?;

    value
        .map(|value| hydrate_storage_value(&namespace, &key, &value))
        .transpose()
}

pub fn load_chat(
    app: &tauri::AppHandle,
    namespace: &str,
    chat_id: &str,
) -> Result<Option<String>, String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let chat_id = normalize_identifier(chat_id, "chat id")?;
    let database_path = database_path(app)?;
    let connection = open_database_at(&database_path)?;

    if let Some(chat) = load_typed_chat_json_by_id(&connection, &namespace, &chat_id)? {
        return Ok(Some(chat));
    }

    load_chat_json_from_app_storage(&connection, &namespace, &chat_id).map_err(|error| {
        format!(
            "Could not load chat from {}: {error}",
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
    let _write_guard = database_write_lock()
        .lock()
        .map_err(|_| "Local database writer lock is poisoned.".to_string())?;
    let database_path = database_path(app)?;
    let connection = open_database_at(&database_path)?;
    let prepared = prepare_storage_value(&namespace, &key, value)?;

    if key == CHATS_STORAGE_KEY {
        with_immediate_transaction(&connection, "typed chat save", |connection| {
            sync_chat_records(connection, &namespace, &key, &prepared.value)?;
            register_secret_references(connection, &namespace, &prepared.references)?;
            delete_legacy_hot_storage_value(connection, &namespace, &key)
        })?;
        return Ok(());
    }

    connection
        .execute(
            "INSERT INTO app_storage(namespace, storage_key, storage_value, updated_at)
             VALUES(?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(namespace, storage_key) DO UPDATE SET
               storage_value = excluded.storage_value,
               updated_at = excluded.updated_at",
            params![&namespace, &key, &prepared.value],
        )
        .map(|_| ())
        .map_err(|error| {
            format!(
                "Could not write local database value to {}: {error}",
                path_to_string(&database_path)
            )
        })?;
    register_secret_references(&connection, &namespace, &prepared.references)?;

    sync_storage_projection(&connection, &namespace, &key, &prepared.value)
}

pub fn write_values(
    app: &tauri::AppHandle,
    namespace: &str,
    values: &[DeviceStorageSeed],
) -> Result<(), String> {
    let namespace = normalize_identifier(namespace, "storage namespace")?;
    let _write_guard = database_write_lock()
        .lock()
        .map_err(|_| "Local database writer lock is poisoned.".to_string())?;
    let database_path = database_path(app)?;
    let mut connection = open_database_at(&database_path)?;
    let mut typed_values = Vec::new();
    let mut projected_values = Vec::new();
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not start local database write: {error}"))?;

    for value in values {
        let key = normalize_identifier(&value.key, "storage key")?;
        let prepared = prepare_storage_value(&namespace, &key, &value.value)?;

        if key == CHATS_STORAGE_KEY {
            typed_values.push((key, prepared));
            continue;
        }

        transaction
            .execute(
                "INSERT INTO app_storage(namespace, storage_key, storage_value, updated_at)
                 VALUES(?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(namespace, storage_key) DO UPDATE SET
                   storage_value = excluded.storage_value,
                   updated_at = excluded.updated_at",
                params![&namespace, &key, &prepared.value],
            )
            .map_err(|error| {
                format!(
                    "Could not write local database value to {}: {error}",
                    path_to_string(&database_path)
                )
            })?;
        register_secret_references(&transaction, &namespace, &prepared.references)?;
        projected_values.push((key, prepared.value));
    }

    transaction.commit().map_err(|error| {
        format!(
            "Could not commit local database writes to {}: {error}",
            path_to_string(&database_path)
        )
    })?;

    for (key, prepared) in typed_values {
        with_immediate_transaction(&connection, "typed chat batch save", |connection| {
            sync_chat_records(connection, &namespace, &key, &prepared.value)?;
            register_secret_references(connection, &namespace, &prepared.references)?;
            delete_legacy_hot_storage_value(connection, &namespace, &key)
        })?;
    }

    for (key, value) in projected_values {
        sync_storage_projection(&connection, &namespace, &key, &value)?;
    }

    Ok(())
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

pub fn database_file_family(database_path: &Path) -> Vec<PathBuf> {
    let path_text = path_to_string(database_path);
    vec![
        database_path.to_path_buf(),
        PathBuf::from(format!("{path_text}-journal")),
        PathBuf::from(format!("{path_text}-wal")),
        PathBuf::from(format!("{path_text}-shm")),
    ]
}

pub fn with_database_connection<T>(
    app: &tauri::AppHandle,
    work: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let database_path = database_path(app)?;
    let connection = open_database_at(&database_path)?;
    work(&connection)
}

pub fn with_serialized_database_write<T>(
    app: &tauri::AppHandle,
    label: &str,
    work: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let _write_guard = database_write_lock()
        .lock()
        .map_err(|_| "Local database writer lock is poisoned.".to_string())?;

    with_database_connection(app, |connection| {
        with_immediate_transaction(connection, label, work)
    })
}

fn database_write_lock() -> &'static Mutex<()> {
    DATABASE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn database_schema_prepared_paths() -> &'static Mutex<HashSet<PathBuf>> {
    DATABASE_SCHEMA_PREPARED_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn finalize_schema_v3_migration(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    with_serialized_database_write(app, "schema v3 finalization", |connection| {
        backfill_typed_rows_from_app_storage(connection)?;
        let mut removed_keys = Vec::new();

        for (namespace, key, value) in legacy_hot_storage_values(connection)? {
            let has_typed_replacement = if key == CHATS_STORAGE_KEY {
                typed_chat_count(connection, &namespace)? >= json_array_count(&value)
            } else if key == AGENT_RUNS_STORAGE_KEY {
                typed_agent_run_count(connection, &namespace)? >= json_array_count(&value)
            } else {
                false
            };

            if has_typed_replacement {
                delete_legacy_hot_storage_value(connection, &namespace, &key)?;
                removed_keys.push(format!("{namespace}/{key}"));
            }
        }

        Ok(removed_keys)
    })
}

pub fn schema_v3_auto_finalized(app: &tauri::AppHandle) -> Result<bool, String> {
    with_database_connection(app, |connection| {
        database_metadata_value(connection, "schema_3_auto_finalized")
            .map(|value| value.is_some_and(|value| value == "complete"))
    })
}

pub fn schema_v3_has_legacy_hot_storage(app: &tauri::AppHandle) -> Result<bool, String> {
    with_database_connection(app, |connection| {
        connection
            .query_row(
                "SELECT COUNT(*)
                 FROM app_storage
                 WHERE storage_key IN (?1, ?2)",
                params![CHATS_STORAGE_KEY, AGENT_RUNS_STORAGE_KEY],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)
            .map_err(|error| format!("Could not inspect legacy hot storage rows: {error}"))
    })
}

pub fn mark_schema_v3_auto_finalized(app: &tauri::AppHandle) -> Result<(), String> {
    with_serialized_database_write(app, "schema v3 auto finalization marker", |connection| {
        set_database_metadata_value(connection, "schema_3_auto_finalized", "complete")
    })
}

fn database_metadata_value(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM database_metadata WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not read database metadata {key}: {error}"))
}

fn set_database_metadata_value(
    connection: &Connection,
    key: &str,
    value: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO database_metadata(key, value, updated_at)
             VALUES(?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            params![key, value],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not update database metadata {key}: {error}"))
}

fn prepare_storage_value(
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<PreparedStorageValue, String> {
    let mut references = Vec::new();

    let prepared_value = match key {
        PROVIDER_SETTINGS_STORAGE_KEY => {
            protect_provider_settings(namespace, key, value, &mut references)?
        }
        DISCORD_BRIDGE_STORAGE_KEY => {
            protect_discord_settings(namespace, key, value, &mut references)?
        }
        MAPBOX_SETTINGS_STORAGE_KEY => {
            protect_mapbox_settings(namespace, key, value, &mut references)?
        }
        GOOGLE_OAUTH_SETTINGS_STORAGE_KEY => {
            protect_google_oauth_settings(namespace, key, value, &mut references)?
        }
        API_KEY_VAULT_STORAGE_KEY => protect_api_key_vault(namespace, key, value, &mut references)?,
        GITHUB_ACCOUNT_STORAGE_KEY => {
            protect_github_account(namespace, key, value, &mut references)?
        }
        MCP_SERVERS_STORAGE_KEY => protect_mcp_servers(namespace, key, value, &mut references)?,
        _ => value.to_string(),
    };

    Ok(PreparedStorageValue {
        references,
        value: prepared_value,
    })
}

fn hydrate_storage_value(namespace: &str, key: &str, value: &str) -> Result<String, String> {
    match key {
        PROVIDER_SETTINGS_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        DISCORD_BRIDGE_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        MAPBOX_SETTINGS_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        GOOGLE_OAUTH_SETTINGS_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        API_KEY_VAULT_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        GITHUB_ACCOUNT_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        MCP_SERVERS_STORAGE_KEY => hydrate_json_secret_fields(namespace, key, value),
        _ => Ok(value.to_string()),
    }
}

fn protect_provider_settings(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(api_keys) = json_value.get_mut("apiKeys").and_then(Value::as_object_mut) {
        for (provider, api_key) in api_keys.iter_mut() {
            protect_json_string_secret(
                namespace,
                storage_key,
                &format!("apiKeys.{provider}"),
                api_key,
                references,
            )?;
        }
    }

    if let Some(openrouter_api_key) = json_value.get_mut("openRouterApiKey") {
        protect_json_string_secret(
            namespace,
            storage_key,
            "openRouterApiKey",
            openrouter_api_key,
            references,
        )?;
    }

    if let Some(brave_api_key) = json_value.pointer_mut("/webSearch/brave/apiKey") {
        protect_json_string_secret(
            namespace,
            storage_key,
            "webSearch.brave.apiKey",
            brave_api_key,
            references,
        )?;
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected provider settings: {error}"))
}

fn protect_discord_settings(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    for field in ["botToken", "incomingWebhookUrl", "ngrokAuthToken"] {
        if let Some(secret_value) = json_value.get_mut(field) {
            protect_json_string_secret(namespace, storage_key, field, secret_value, references)?;
        }
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected Discord settings: {error}"))
}

fn protect_mapbox_settings(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(access_token) = json_value.get_mut("accessToken") {
        protect_json_string_secret(
            namespace,
            storage_key,
            "accessToken",
            access_token,
            references,
        )?;
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected Mapbox settings: {error}"))
}

fn protect_google_oauth_settings(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(client_secret) = json_value.get_mut("clientSecret") {
        protect_json_string_secret(
            namespace,
            storage_key,
            "clientSecret",
            client_secret,
            references,
        )?;
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected Google OAuth settings: {error}"))
}

fn protect_api_key_vault(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(keys) = json_value.get_mut("keys").and_then(Value::as_array_mut) {
        for (index, key) in keys.iter_mut().enumerate() {
            let Some(key_object) = key.as_object_mut() else {
                continue;
            };
            let key_id = key_object
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| index.to_string());

            if let Some(secret_value) = key_object.get_mut("value") {
                protect_json_string_secret(
                    namespace,
                    storage_key,
                    &format!("keys.{key_id}.value"),
                    secret_value,
                    references,
                )?;
            }
        }
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected API key vault: {error}"))
}

fn protect_github_account(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(token) = json_value.get_mut("token") {
        protect_json_string_secret(namespace, storage_key, "token", token, references)?;
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected GitHub account: {error}"))
}

fn protect_mcp_servers(
    namespace: &str,
    storage_key: &str,
    value: &str,
    references: &mut Vec<SecureSecretReference>,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    if let Some(servers) = json_value.get_mut("servers").and_then(Value::as_array_mut) {
        for (index, server) in servers.iter_mut().enumerate() {
            let Some(server_object) = server.as_object_mut() else {
                continue;
            };
            let server_id = server_object
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| index.to_string());

            if let Some(token) = server_object.get_mut("authorizationToken") {
                protect_json_string_secret(
                    namespace,
                    storage_key,
                    &format!("servers.{server_id}.authorizationToken"),
                    token,
                    references,
                )?;
            }

            if let Some(environment) = server_object
                .get_mut("environment")
                .and_then(Value::as_array_mut)
            {
                for (environment_index, item) in environment.iter_mut().enumerate() {
                    let Some(item_object) = item.as_object_mut() else {
                        continue;
                    };
                    let environment_name = item_object
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| environment_index.to_string());

                    if let Some(environment_value) = item_object.get_mut("value") {
                        protect_json_string_secret(
                            namespace,
                            storage_key,
                            &format!("servers.{server_id}.environment.{environment_name}"),
                            environment_value,
                            references,
                        )?;
                    }
                }
            }

            if let Some(headers) = server_object
                .get_mut("headers")
                .and_then(Value::as_array_mut)
            {
                for (header_index, item) in headers.iter_mut().enumerate() {
                    let Some(item_object) = item.as_object_mut() else {
                        continue;
                    };
                    let header_name = item_object
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| header_index.to_string());

                    if let Some(header_value) = item_object.get_mut("value") {
                        protect_json_string_secret(
                            namespace,
                            storage_key,
                            &format!("servers.{server_id}.headers.{header_name}"),
                            header_value,
                            references,
                        )?;
                    }
                }
            }

            if let Some(query_params) = server_object
                .get_mut("queryParams")
                .and_then(Value::as_array_mut)
            {
                for (query_index, item) in query_params.iter_mut().enumerate() {
                    let Some(item_object) = item.as_object_mut() else {
                        continue;
                    };
                    let query_name = item_object
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| query_index.to_string());

                    if let Some(query_value) = item_object.get_mut("value") {
                        protect_json_string_secret(
                            namespace,
                            storage_key,
                            &format!("servers.{server_id}.queryParams.{query_name}"),
                            query_value,
                            references,
                        )?;
                    }
                }
            }
        }
    }

    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize protected MCP server settings: {error}"))
}

fn protect_json_string_secret(
    namespace: &str,
    storage_key: &str,
    field: &str,
    value: &mut Value,
    references: &mut Vec<SecureSecretReference>,
) -> Result<(), String> {
    let Some(secret) = value
        .as_str()
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
    else {
        return Ok(());
    };

    if secret.starts_with(SECRET_REFERENCE_PREFIX) {
        return Ok(());
    }

    let target = secret_target(namespace, storage_key, field);
    secure_storage::set_secret(&target, secret)?;
    *value = Value::String(format!("{SECRET_REFERENCE_PREFIX}{target}"));
    references.push(SecureSecretReference {
        keyring_target: target,
        provider: secure_storage::provider_name().to_string(),
        secret_key: format!("{storage_key}:{field}"),
    });
    Ok(())
}

fn hydrate_json_secret_fields(
    namespace: &str,
    storage_key: &str,
    value: &str,
) -> Result<String, String> {
    let Ok(mut json_value) = serde_json::from_str::<Value>(value) else {
        return Ok(value.to_string());
    };

    hydrate_json_value_secrets(namespace, storage_key, &mut json_value)?;
    serde_json::to_string(&json_value)
        .map_err(|error| format!("Could not serialize hydrated secure value: {error}"))
}

fn hydrate_json_value_secrets(
    namespace: &str,
    storage_key: &str,
    value: &mut Value,
) -> Result<(), String> {
    match value {
        Value::String(text) if text.starts_with(SECRET_REFERENCE_PREFIX) => {
            let target = text.trim_start_matches(SECRET_REFERENCE_PREFIX);
            let expected_prefix = format!(
                "GilbertCodex/{}/{}",
                sanitize_secret_component(namespace),
                sanitize_secret_component(storage_key)
            );
            if !target.starts_with(&expected_prefix) {
                *text = String::new();
                return Ok(());
            }
            *text = secure_storage::get_secret(target)?.unwrap_or_default();
        }
        Value::Array(items) => {
            for item in items {
                hydrate_json_value_secrets(namespace, storage_key, item)?;
            }
        }
        Value::Object(fields) => {
            for item in fields.values_mut() {
                hydrate_json_value_secrets(namespace, storage_key, item)?;
            }
        }
        _ => {}
    }

    Ok(())
}

fn register_secret_references(
    connection: &Connection,
    namespace: &str,
    references: &[SecureSecretReference],
) -> Result<(), String> {
    for reference in references {
        connection
            .execute(
                "INSERT INTO secure_secret_references(namespace, secret_key, provider, keyring_target, migrated_at)
                 VALUES(?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 ON CONFLICT(namespace, secret_key) DO UPDATE SET
                   provider = excluded.provider,
                   keyring_target = excluded.keyring_target,
                   migrated_at = excluded.migrated_at",
                params![
                    namespace,
                    reference.secret_key,
                    reference.provider,
                    reference.keyring_target,
                ],
            )
            .map_err(|error| format!("Could not record secure secret migration: {error}"))?;
    }

    Ok(())
}

fn secret_target(namespace: &str, storage_key: &str, field: &str) -> String {
    format!(
        "GilbertCodex/{}/{}/{}",
        sanitize_secret_component(namespace),
        sanitize_secret_component(storage_key),
        sanitize_secret_component(field)
    )
}

fn sanitize_secret_component(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.chars() {
        if sanitized.len() >= 96 {
            break;
        }

        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character);
        } else {
            sanitized.push('-');
        }
    }

    if sanitized.is_empty() {
        "value".to_string()
    } else {
        sanitized
    }
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

fn sync_startup_namespace_projections(
    connection: &Connection,
    namespace: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(
            "SELECT storage_key, storage_value
             FROM app_storage
             WHERE namespace = ?1
               AND storage_key IN ('gilbert-codex.chats.v1', 'gilbert-codex.projects.v1')",
        )
        .map_err(|error| format!("Could not prepare startup database projection sync: {error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read startup database projections: {error}"))?;
    let mut values = Vec::new();

    for row in rows {
        let (key, value) = row.map_err(|error| {
            format!("Could not decode startup database projection row: {error}")
        })?;
        values.push((key, value));
    }

    drop(statement);

    for (key, value) in values {
        if key == CHATS_STORAGE_KEY
            && !should_sync_startup_chat_projection(connection, namespace, &value)?
        {
            continue;
        }

        sync_storage_projection(connection, namespace, &key, &value)?;
    }

    Ok(())
}

fn should_sync_startup_chat_projection(
    connection: &Connection,
    namespace: &str,
    value: &str,
) -> Result<bool, String> {
    let incoming_count = json_array_count(value);

    if incoming_count == 0 {
        return Ok(false);
    }

    Ok(typed_chat_count(connection, namespace)? < incoming_count)
}

#[cfg(test)]
fn sync_namespace_projections(
    connection: &Connection,
    namespace: &str,
    mode: NamespaceProjectionMode,
) -> Result<(), String> {
    let query = match mode {
        #[cfg(test)]
        NamespaceProjectionMode::Full => {
            "SELECT storage_key, storage_value
             FROM app_storage
             WHERE namespace = ?1"
        }
        NamespaceProjectionMode::Startup => {
            "SELECT storage_key, storage_value
             FROM app_storage
             WHERE namespace = ?1
               AND storage_key IN ('gilbert-codex.chats.v1', 'gilbert-codex.projects.v1')"
        }
    };
    let mut statement = connection
        .prepare(query)
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
        if mode == NamespaceProjectionMode::Startup && is_memory_storage_key(&key) {
            continue;
        }

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
        key if key.starts_with(CHAT_MEMORY_STORAGE_PREFIX) => {
            sync_memory_vector_records(connection, namespace, key, value, "chat-memory")
        }
        key if key.starts_with(PROJECT_MEMORY_STORAGE_PREFIX) => {
            sync_memory_vector_records(connection, namespace, key, value, "project-memory")
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
fn is_memory_storage_key(key: &str) -> bool {
    key.starts_with(CHAT_MEMORY_STORAGE_PREFIX) || key.starts_with(PROJECT_MEMORY_STORAGE_PREFIX)
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

    let existing_chat_json = existing_chat_raw_json(connection, namespace)?;
    let mut incoming_chat_ids = HashSet::new();

    for chat in chats {
        let chat_id = json_string(chat, "id", "unknown-chat");
        let Some(chat_to_store) =
            resolve_chat_value_for_storage(chat, existing_chat_json.get(&chat_id))
        else {
            incoming_chat_ids.insert(chat_id);
            continue;
        };
        let raw_json = serde_json::to_string(&chat_to_store).unwrap_or_else(|_| "{}".to_string());
        let chat_changed = existing_chat_json.get(&chat_id) != Some(&raw_json);
        incoming_chat_ids.insert(chat_id.clone());

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
                    json_string(&chat_to_store, "title", "New chat"),
                    json_string(&chat_to_store, "project", "No project"),
                    json_string(&chat_to_store, "updatedAt", ""),
                    json_bool(&chat_to_store, "archived") as i64,
                    json_bool(&chat_to_store, "pinned") as i64,
                    json_array_len(&chat_to_store, "messages") as i64,
                    raw_json.len() as i64,
                    raw_json,
                ],
            )
            .map_err(|error| format!("Could not update chat database projection: {error}"))?;

        if chat_changed {
            sync_chat_message_records(connection, namespace, &chat_id, &chat_to_store)?;
        }
    }

    for chat_id in existing_chat_json.keys() {
        if incoming_chat_ids.contains(chat_id) {
            continue;
        }

        delete_chat_message_records(connection, namespace, chat_id)?;
        connection
            .execute(
                "DELETE FROM chat_records WHERE namespace = ?1 AND chat_id = ?2",
                params![namespace, chat_id],
            )
            .map_err(|error| format!("Could not remove stale chat projection: {error}"))?;
    }

    Ok(())
}

fn resolve_chat_value_for_storage(
    chat: &Value,
    existing_raw_json: Option<&String>,
) -> Option<Value> {
    if chat_messages_loaded(chat) {
        return Some(strip_chat_storage_runtime_flags(chat.clone()));
    }

    let existing_raw_json = existing_raw_json?;
    let mut existing_chat = serde_json::from_str::<Value>(existing_raw_json).ok()?;

    if let Some(existing_object) = existing_chat.as_object_mut() {
        for field in [
            "archived",
            "composerDraft",
            "isDraft",
            "model",
            "pinned",
            "project",
            "provider",
            "title",
            "toolRuntimeVersion",
            "updatedAt",
        ] {
            if let Some(value) = chat.get(field) {
                existing_object.insert(field.to_string(), value.clone());
            }
        }

        existing_object.remove("messagesLoaded");
    }

    Some(existing_chat)
}

fn chat_messages_loaded(chat: &Value) -> bool {
    chat.get("messagesLoaded")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn strip_chat_storage_runtime_flags(mut chat: Value) -> Value {
    if let Some(object) = chat.as_object_mut() {
        object.remove("messagesLoaded");
    }

    chat
}

fn existing_chat_raw_json(
    connection: &Connection,
    namespace: &str,
) -> Result<HashMap<String, String>, String> {
    let mut statement = connection
        .prepare("SELECT chat_id, raw_json FROM chat_records WHERE namespace = ?1")
        .map_err(|error| format!("Could not prepare existing chat projection read: {error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read existing chat projections: {error}"))?;
    let mut chats = HashMap::new();

    for row in rows {
        let (chat_id, raw_json) =
            row.map_err(|error| format!("Could not decode existing chat projection: {error}"))?;
        chats.insert(chat_id, raw_json);
    }

    Ok(chats)
}

fn load_typed_chats_json(
    connection: &Connection,
    namespace: &str,
) -> Result<Option<String>, String> {
    let count = typed_chat_count(connection, namespace)?;
    if count == 0 {
        return Ok(None);
    }

    let mut statement = connection
        .prepare(
            "SELECT raw_json
             FROM chat_records
             WHERE namespace = ?1
             ORDER BY updated_at DESC, indexed_at DESC",
        )
        .map_err(|error| format!("Could not prepare typed chat load: {error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Could not read typed chats: {error}"))?;
    let mut chats = Vec::new();

    for row in rows {
        let raw_json = row.map_err(|error| format!("Could not decode typed chat: {error}"))?;
        let chat = serde_json::from_str::<Value>(&raw_json)
            .map_err(|error| format!("Could not parse typed chat JSON: {error}"))?;
        chats.push(chat);
    }

    serde_json::to_string(&chats)
        .map(Some)
        .map_err(|error| format!("Could not serialize typed chat list: {error}"))
}

fn load_startup_typed_chats_json(
    connection: &Connection,
    namespace: &str,
    active_chat_id: Option<&str>,
) -> Result<Option<String>, String> {
    let rows = load_typed_chat_startup_rows(connection, namespace)?;

    if rows.is_empty() {
        return Ok(None);
    }

    let active_chat_id = active_chat_id
        .filter(|chat_id| {
            rows.iter()
                .any(|row| row.chat_id == *chat_id && !row.archived)
        })
        .map(str::to_string)
        .or_else(|| {
            rows.iter()
                .find(|row| !row.archived)
                .or_else(|| rows.first())
                .map(|row| row.chat_id.clone())
        });
    let mut chats = Vec::with_capacity(rows.len());

    for row in rows {
        if active_chat_id.as_deref() == Some(row.chat_id.as_str()) {
            if let Some(chat) = load_typed_chat_json_by_id(connection, namespace, &row.chat_id)?
                .and_then(|raw_json| serde_json::from_str::<Value>(&raw_json).ok())
            {
                chats.push(mark_chat_messages_loaded(chat));
                continue;
            }
        }

        chats.push(startup_chat_summary_value(&row));
    }

    serde_json::to_string(&chats)
        .map(Some)
        .map_err(|error| format!("Could not serialize startup chat list: {error}"))
}

struct StartupChatRow {
    archived: bool,
    chat_id: String,
    message_count: i64,
    pinned: bool,
    project_name: String,
    title: String,
    updated_at: String,
}

fn load_typed_chat_startup_rows(
    connection: &Connection,
    namespace: &str,
) -> Result<Vec<StartupChatRow>, String> {
    let mut statement = connection
        .prepare(
            "SELECT chat_id, title, project_name, updated_at, archived, pinned, message_count
             FROM chat_records
             WHERE namespace = ?1
             ORDER BY updated_at DESC, indexed_at DESC",
        )
        .map_err(|error| format!("Could not prepare startup typed chat load: {error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| {
            Ok(StartupChatRow {
                chat_id: row.get::<_, String>(0)?,
                title: row.get::<_, String>(1)?,
                project_name: row.get::<_, String>(2)?,
                updated_at: row.get::<_, String>(3)?,
                archived: row.get::<_, i64>(4)? != 0,
                pinned: row.get::<_, i64>(5)? != 0,
                message_count: row.get::<_, i64>(6)?,
            })
        })
        .map_err(|error| format!("Could not read startup typed chats: {error}"))?;
    let mut chats = Vec::new();

    for row in rows {
        chats.push(row.map_err(|error| format!("Could not decode startup typed chat: {error}"))?);
    }

    Ok(chats)
}

fn startup_chat_summary_value(row: &StartupChatRow) -> Value {
    json!({
        "archived": row.archived,
        "id": row.chat_id,
        "isDraft": row.message_count == 0,
        "messages": [],
        "messagesLoaded": false,
        "pinned": row.pinned,
        "project": row.project_name,
        "title": if row.title.trim().is_empty() { "New chat" } else { row.title.as_str() },
        "updatedAt": row.updated_at,
    })
}

fn mark_chat_messages_loaded(mut chat: Value) -> Value {
    if let Some(object) = chat.as_object_mut() {
        object.insert("messagesLoaded".to_string(), Value::Bool(true));
    }

    chat
}

fn load_typed_chat_json_by_id(
    connection: &Connection,
    namespace: &str,
    chat_id: &str,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT raw_json
             FROM chat_records
             WHERE namespace = ?1 AND chat_id = ?2",
            params![namespace, chat_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not load typed chat: {error}"))
}

fn load_chat_json_from_app_storage(
    connection: &Connection,
    namespace: &str,
    chat_id: &str,
) -> Result<Option<String>, String> {
    let stored_chats = connection
        .query_row(
            "SELECT storage_value
             FROM app_storage
             WHERE namespace = ?1 AND storage_key = ?2",
            params![namespace, CHATS_STORAGE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not read legacy chat storage: {error}"))?;
    let Some(stored_chats) = stored_chats else {
        return Ok(None);
    };
    let Ok(chats) = serde_json::from_str::<Value>(&stored_chats) else {
        return Ok(None);
    };
    let Some(chats) = chats.as_array() else {
        return Ok(None);
    };

    for chat in chats {
        if json_string(chat, "id", "") == chat_id {
            return serde_json::to_string(chat)
                .map(Some)
                .map_err(|error| format!("Could not serialize legacy chat: {error}"));
        }
    }

    Ok(None)
}

fn typed_chat_count(connection: &Connection, namespace: &str) -> Result<u64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM chat_records WHERE namespace = ?1",
            params![namespace],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(|error| format!("Could not count typed chats: {error}"))
}

fn typed_agent_run_count(connection: &Connection, namespace: &str) -> Result<u64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE namespace = ?1",
            params![namespace],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(|error| format!("Could not count typed agent runs: {error}"))
}

fn delete_legacy_hot_storage_value(
    connection: &Connection,
    namespace: &str,
    key: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM app_storage WHERE namespace = ?1 AND storage_key = ?2",
            params![namespace, key],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not remove legacy hot storage value: {error}"))
}

fn sync_chat_message_records(
    connection: &Connection,
    namespace: &str,
    chat_id: &str,
    chat: &Value,
) -> Result<(), String> {
    delete_chat_message_records(connection, namespace, chat_id)?;

    let Some(messages) = chat.get("messages").and_then(Value::as_array) else {
        return Ok(());
    };

    for (message_index, message) in messages.iter().enumerate() {
        let message_id = json_string(message, "id", &format!("message-{message_index}"));
        let raw_json = serde_json::to_string(message).unwrap_or_else(|_| "{}".to_string());
        let content_bytes = message
            .get("content")
            .and_then(Value::as_str)
            .map(str::len)
            .unwrap_or(0);
        let reasoning_bytes = message
            .get("reasoning")
            .and_then(Value::as_str)
            .map(str::len)
            .unwrap_or(0);
        let thinking_bytes = message
            .get("thinking")
            .map(|thinking| {
                serde_json::to_vec(thinking)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0)
            })
            .unwrap_or(0);

        connection
            .execute(
                "INSERT INTO chat_messages(
                   namespace, chat_id, message_id, message_index, role, status,
                   content_bytes, reasoning_bytes, thinking_bytes, source_count,
                   attachment_count, tool_call_count, approval_count, artifact_count,
                   created_at, updated_at, raw_json, indexed_at
                 )
                 VALUES(
                   ?1, ?2, ?3, ?4, ?5, ?6,
                   ?7, ?8, ?9, ?10,
                   ?11, ?12, ?13, ?14,
                   ?15, ?16, ?17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 )
                 ON CONFLICT(namespace, chat_id, message_id) DO UPDATE SET
                   message_index = excluded.message_index,
                   role = excluded.role,
                   status = excluded.status,
                   content_bytes = excluded.content_bytes,
                   reasoning_bytes = excluded.reasoning_bytes,
                   thinking_bytes = excluded.thinking_bytes,
                   source_count = excluded.source_count,
                   attachment_count = excluded.attachment_count,
                   tool_call_count = excluded.tool_call_count,
                   approval_count = excluded.approval_count,
                   artifact_count = excluded.artifact_count,
                   created_at = excluded.created_at,
                   updated_at = excluded.updated_at,
                   raw_json = excluded.raw_json,
                   indexed_at = excluded.indexed_at",
                params![
                    namespace,
                    chat_id,
                    message_id,
                    message_index as i64,
                    json_string(message, "role", "unknown"),
                    json_string(message, "status", ""),
                    content_bytes as i64,
                    reasoning_bytes as i64,
                    thinking_bytes as i64,
                    json_array_len(message, "sources") as i64,
                    json_array_len(message, "attachments") as i64,
                    json_array_len(message, "toolCalls") as i64,
                    json_array_len(message, "approvals") as i64,
                    json_array_len(message, "artifacts") as i64,
                    json_string(message, "createdAt", ""),
                    json_string(message, "updatedAt", ""),
                    raw_json,
                ],
            )
            .map_err(|error| format!("Could not update chat message projection: {error}"))?;

        sync_json_array_items(
            connection,
            "chat_message_items",
            namespace,
            chat_id,
            &message_id,
            message,
            &[
                ("sources", "source"),
                ("attachments", "attachment"),
                ("toolCalls", "tool-call"),
                ("approvals", "approval"),
                ("artifacts", "artifact"),
            ],
        )?;
    }

    Ok(())
}

fn delete_chat_message_records(
    connection: &Connection,
    namespace: &str,
    chat_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM chat_message_items WHERE namespace = ?1 AND chat_id = ?2",
            params![namespace, chat_id],
        )
        .map_err(|error| format!("Could not clear chat item projection: {error}"))?;
    connection
        .execute(
            "DELETE FROM chat_messages WHERE namespace = ?1 AND chat_id = ?2",
            params![namespace, chat_id],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not clear chat message projection: {error}"))
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

fn sync_memory_vector_records(
    connection: &Connection,
    namespace: &str,
    storage_key: &str,
    value: &str,
    collection: &str,
) -> Result<(), String> {
    let Some(rows) = parse_memory_vector_projection_rows(storage_key, value)? else {
        return Ok(());
    };

    with_immediate_transaction(connection, "memory vector projection", |connection| {
        connection
            .execute(
                "DELETE FROM vector_embeddings
                 WHERE namespace = ?1 AND collection = ?2 AND entity_id = ?3",
                params![namespace, collection, storage_key],
            )
            .map_err(|error| format!("Could not clear memory vector projection: {error}"))?;
        connection
            .execute(
                "DELETE FROM memory_chunks
                 WHERE namespace = ?1 AND collection = ?2 AND entity_id = ?3",
                params![namespace, collection, storage_key],
            )
            .map_err(|error| format!("Could not clear memory chunk projection: {error}"))?;
        sync_memory_event_records(connection, namespace, storage_key, value, collection)?;

        for row in rows {
            connection
                .execute(
                    "INSERT INTO vector_embeddings(
                       namespace, collection, entity_id, chunk_id, embedding_model,
                       dimensions, vector_json, vector_blob, metadata_json, content_hash, updated_at
                     )
                     VALUES(
                       ?1, ?2, ?3, ?4, ?5,
                       ?6, ?7, ?8, ?9, ?10,
                       COALESCE(NULLIF(?11, ''), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                     )
                     ON CONFLICT(namespace, collection, entity_id, chunk_id) DO UPDATE SET
                       embedding_model = excluded.embedding_model,
                       dimensions = excluded.dimensions,
                       vector_json = excluded.vector_json,
                       vector_blob = excluded.vector_blob,
                       metadata_json = excluded.metadata_json,
                       content_hash = excluded.content_hash,
                       updated_at = excluded.updated_at",
                    params![
                        namespace,
                        collection,
                        storage_key,
                        row.chunk_id,
                        row.model,
                        row.dimensions,
                        row.vector_json,
                        row.vector_blob,
                        row.metadata_json,
                        row.content_hash,
                        row.updated_at,
                    ],
                )
                .map_err(|error| format!("Could not update memory vector projection: {error}"))?;
            connection
                .execute(
                    "INSERT INTO memory_chunks(
                       namespace, collection, entity_id, chunk_id, record_id, event_id,
                       source, summary, content, content_hash, embedding_model, dimensions,
                       vector_blob, vector_json, metadata_json, updated_at, raw_json
                     )
                     VALUES(
                       ?1, ?2, ?3, ?4, ?5, ?6,
                       ?7, ?8, ?9, ?10, ?11, ?12,
                       ?13, ?14, ?15, ?16, ?17
                     )
                     ON CONFLICT(namespace, collection, entity_id, chunk_id) DO UPDATE SET
                       record_id = excluded.record_id,
                       event_id = excluded.event_id,
                       source = excluded.source,
                       summary = excluded.summary,
                       content = excluded.content,
                       content_hash = excluded.content_hash,
                       embedding_model = excluded.embedding_model,
                       dimensions = excluded.dimensions,
                       vector_blob = excluded.vector_blob,
                       vector_json = excluded.vector_json,
                       metadata_json = excluded.metadata_json,
                       updated_at = excluded.updated_at,
                       raw_json = excluded.raw_json",
                    params![
                        namespace,
                        collection,
                        storage_key,
                        row.chunk_id,
                        row.record_id,
                        row.event_id,
                        row.source,
                        row.summary,
                        row.content,
                        row.content_hash,
                        row.model,
                        row.dimensions,
                        row.vector_blob,
                        row.vector_json,
                        row.metadata_json,
                        row.updated_at,
                        row.raw_json,
                    ],
                )
                .map_err(|error| format!("Could not update memory chunk projection: {error}"))?;
        }

        Ok(())
    })
}

fn parse_memory_vector_projection_rows(
    storage_key: &str,
    value: &str,
) -> Result<Option<Vec<MemoryVectorProjectionRow>>, String> {
    let Ok(state) = serde_json::from_str::<Value>(value) else {
        return Ok(None);
    };
    let Some(records) = state.get("records").and_then(Value::as_array) else {
        return Ok(None);
    };

    let state_project_key = json_string(&state, "projectKey", "");
    let state_project_name = json_string(&state, "projectName", "");
    let state_chat_id = json_string(&state, "chatId", "");
    let state_chat_title = json_string(&state, "chatTitle", "");
    let mut rows = Vec::new();

    for record in records {
        let Some(vector) = record.get("vector") else {
            continue;
        };
        let Some(values) = vector.get("values").and_then(Value::as_array) else {
            continue;
        };
        let numeric_values = values.iter().map(Value::as_f64).collect::<Option<Vec<_>>>();
        let Some(numeric_values) = numeric_values else {
            continue;
        };

        if numeric_values.is_empty() {
            continue;
        }

        let dimensions = vector
            .get("dimensions")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .unwrap_or(numeric_values.len() as i64);

        if dimensions as usize != numeric_values.len() {
            continue;
        }

        let model = vector
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("gilbert-local-hash-v1")
            .to_string();
        let chunk_id = json_string(record, "chunkId", "");
        let content_hash = json_string(record, "contentHash", "");

        if chunk_id.trim().is_empty() || content_hash.trim().is_empty() {
            continue;
        }

        let record_id = json_string(record, "id", &chunk_id);
        let content = json_string(record, "content", "");
        let event_id = json_string(record, "eventId", "");
        let source = json_string(record, "source", "");
        let summary = json_string(record, "summary", "");
        let updated_at = json_string(record, "updatedAt", "");
        let vector_json =
            serde_json::to_string(&numeric_values).unwrap_or_else(|_| "[]".to_string());
        let vector_blob = encode_vector_blob(&numeric_values);
        let metadata = json!({
            "chatId": json_memory_string(record, "chatId", &state_chat_id),
            "chatTitle": json_memory_string(record, "chatTitle", &state_chat_title),
            "contentBytes": content.len(),
            "eventId": json_memory_string(record, "eventId", ""),
            "metadata": record.get("metadata").cloned().unwrap_or_else(|| json!({})),
            "projectKey": json_memory_string(record, "projectKey", &state_project_key),
            "projectName": json_memory_string(record, "projectName", &state_project_name),
            "recordId": record_id.clone(),
            "source": json_memory_string(record, "source", ""),
            "storageKey": storage_key,
            "summary": json_memory_string(record, "summary", ""),
            "updatedAt": json_memory_string(record, "updatedAt", ""),
        });
        let metadata_json = serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string());
        let raw_json = serde_json::to_string(record).unwrap_or_else(|_| "{}".to_string());

        rows.push(MemoryVectorProjectionRow {
            chunk_id,
            content,
            content_hash,
            dimensions,
            event_id,
            metadata_json,
            model,
            raw_json,
            updated_at,
            record_id,
            source,
            summary,
            vector_blob,
            vector_json,
        });
    }

    Ok(Some(rows))
}

fn sync_memory_event_records(
    connection: &Connection,
    namespace: &str,
    storage_key: &str,
    value: &str,
    collection: &str,
) -> Result<(), String> {
    let Ok(state) = serde_json::from_str::<Value>(value) else {
        return Ok(());
    };

    connection
        .execute(
            "DELETE FROM memory_events
             WHERE namespace = ?1 AND collection = ?2 AND entity_id = ?3",
            params![namespace, collection, storage_key],
        )
        .map_err(|error| format!("Could not clear memory event projection: {error}"))?;

    let Some(events) = state.get("events").and_then(Value::as_array) else {
        return Ok(());
    };

    for (event_index, event) in events.iter().enumerate() {
        let event_id = json_string(event, "id", &format!("event-{event_index}"));
        let raw_json = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());

        connection
            .execute(
                "INSERT INTO memory_events(
                   namespace, collection, entity_id, event_id, event_index,
                   source, summary, created_at, updated_at, raw_json
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(namespace, collection, entity_id, event_id) DO UPDATE SET
                   event_index = excluded.event_index,
                   source = excluded.source,
                   summary = excluded.summary,
                   created_at = excluded.created_at,
                   updated_at = excluded.updated_at,
                   raw_json = excluded.raw_json",
                params![
                    namespace,
                    collection,
                    storage_key,
                    event_id,
                    event_index as i64,
                    json_string(event, "source", ""),
                    json_string(event, "summary", ""),
                    json_string(event, "createdAt", ""),
                    json_string(event, "updatedAt", ""),
                    raw_json,
                ],
            )
            .map_err(|error| format!("Could not update memory event projection: {error}"))?;
    }

    Ok(())
}

fn with_immediate_transaction<T>(
    connection: &Connection,
    label: &str,
    work: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    connection
        .execute_batch("BEGIN IMMEDIATE TRANSACTION")
        .map_err(|error| format!("Could not start {label}: {error}"))?;

    match work(connection) {
        Ok(value) => {
            connection
                .execute_batch("COMMIT")
                .map_err(|error| format!("Could not commit {label}: {error}"))?;
            Ok(value)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn json_string(value: &Value, field: &str, fallback: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn json_memory_string(value: &Value, field: &str, fallback: &str) -> Value {
    let text = json_string(value, field, fallback);

    if text.trim().is_empty() {
        Value::Null
    } else {
        json!(text)
    }
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

fn encode_vector_blob(values: &[f64]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * std::mem::size_of::<f32>());

    for value in values {
        bytes.extend_from_slice(&(*value as f32).to_le_bytes());
    }

    bytes
}

fn sync_json_array_items(
    connection: &Connection,
    table: &str,
    namespace: &str,
    parent_id: &str,
    child_id: &str,
    value: &Value,
    fields: &[(&str, &str)],
) -> Result<(), String> {
    if table != "chat_message_items" {
        return Err("Unsupported typed item projection table.".to_string());
    }

    for (field, item_kind) in fields {
        let Some(items) = value.get(*field).and_then(Value::as_array) else {
            continue;
        };

        for (item_index, item) in items.iter().enumerate() {
            let item_json = serde_json::to_string(item).unwrap_or_else(|_| "{}".to_string());
            connection
                .execute(
                    "INSERT INTO chat_message_items(
                       namespace, chat_id, message_id, item_kind, item_index, item_json, indexed_at
                     )
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                     ON CONFLICT(namespace, chat_id, message_id, item_kind, item_index) DO UPDATE SET
                       item_json = excluded.item_json,
                       indexed_at = excluded.indexed_at",
                    params![
                        namespace,
                        parent_id,
                        child_id,
                        *item_kind,
                        item_index as i64,
                        item_json,
                    ],
                )
                .map_err(|error| format!("Could not update chat message item projection: {error}"))?;
        }
    }

    Ok(())
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

    let database_existed = path.exists();
    let connection = Connection::open(path).map_err(|error| {
        format!(
            "Could not open local database at {}: {error}",
            path_to_string(path)
        )
    })?;
    connection
        .busy_timeout(Duration::from_millis(DATABASE_BUSY_TIMEOUT_MS))
        .map_err(|error| {
            format!(
                "Could not configure local database timeout at {}: {error}",
                path_to_string(path)
            )
        })?;

    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA wal_autocheckpoint = 8192;
            PRAGMA journal_size_limit = 67108864;
            PRAGMA mmap_size = 134217728;
            PRAGMA temp_store = MEMORY;
            "#,
        )
        .map_err(|error| {
            format!(
                "Could not configure local database at {}: {error}",
                path_to_string(path)
            )
        })?;

    prepare_database_schema(path, &connection, !database_existed)?;

    Ok(connection)
}

fn prepare_database_schema(
    path: &PathBuf,
    connection: &Connection,
    force_prepare: bool,
) -> Result<(), String> {
    let mut prepared_paths = database_schema_prepared_paths()
        .lock()
        .map_err(|_| "Local database schema preparation lock is poisoned.".to_string())?;

    if !force_prepare && prepared_paths.contains(path) {
        return Ok(());
    }

    connection
        .execute_batch(KEY_VALUE_TABLE_SQL)
        .map_err(|error| {
            format!(
                "Could not prepare local database schema at {}: {error}",
                path_to_string(path)
            )
        })?;

    run_schema_migrations(connection).map_err(|error| {
        format!(
            "Could not migrate local database schema at {}: {error}",
            path_to_string(path)
        )
    })?;

    let _ = connection.execute_batch("PRAGMA optimize;");
    prepared_paths.insert(path.clone());

    Ok(())
}

fn run_schema_migrations(connection: &Connection) -> Result<(), String> {
    add_column_if_missing(connection, "vector_embeddings", "vector_blob", "BLOB")?;
    backfill_typed_rows_from_app_storage(connection)?;

    connection
        .execute(
            "INSERT INTO database_metadata(key, value, updated_at)
             VALUES('schema_version', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            params![DATABASE_SCHEMA_VERSION],
        )
        .map_err(|error| format!("Could not update local database metadata: {error}"))?;

    connection
        .execute(
            "INSERT INTO database_metadata(key, value, updated_at)
             VALUES('schema_3_migration', 'complete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            [],
        )
        .map_err(|error| format!("Could not record schema v3 migration: {error}"))?;

    Ok(())
}

fn backfill_typed_rows_from_app_storage(connection: &Connection) -> Result<(), String> {
    let already_complete = connection
        .query_row(
            "SELECT value FROM database_metadata WHERE key = 'schema_3_backfill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Could not inspect schema v3 backfill state: {error}"))?
        .is_some_and(|value| value == "complete");

    if already_complete {
        return Ok(());
    }

    let mut statement = connection
        .prepare(
            "SELECT namespace, storage_key, storage_value
             FROM app_storage
             WHERE storage_key = ?1
                OR storage_key = 'gilbert-codex.projects.v1'
                OR storage_key LIKE 'gilbert-codex.chat-memory.v1.%'
                OR storage_key LIKE 'gilbert-codex.project-memory.v1.%'",
        )
        .map_err(|error| format!("Could not prepare schema v3 backfill: {error}"))?;
    let rows = statement
        .query_map(params![CHATS_STORAGE_KEY], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("Could not read schema v3 backfill rows: {error}"))?;
    let mut values = Vec::new();

    for row in rows {
        values.push(
            row.map_err(|error| format!("Could not decode schema v3 backfill row: {error}"))?,
        );
    }

    drop(statement);

    for (namespace, key, value) in values {
        sync_storage_projection(connection, &namespace, &key, &value)?;
    }

    connection
        .execute(
            "INSERT INTO database_metadata(key, value, updated_at)
             VALUES('schema_3_backfill', 'complete', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            [],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not record schema v3 backfill: {error}"))
}

fn legacy_hot_storage_values(
    connection: &Connection,
) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT namespace, storage_key, storage_value
             FROM app_storage
             WHERE storage_key IN (?1, ?2)",
        )
        .map_err(|error| format!("Could not prepare legacy hot storage cleanup: {error}"))?;
    let rows = statement
        .query_map(params![CHATS_STORAGE_KEY, AGENT_RUNS_STORAGE_KEY], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("Could not read legacy hot storage rows: {error}"))?;
    let mut values = Vec::new();

    for row in rows {
        values.push(
            row.map_err(|error| format!("Could not decode legacy hot storage row: {error}"))?,
        );
    }

    Ok(values)
}

fn json_array_count(value: &str) -> u64 {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| value.as_array().map(|items| items.len() as u64))
        .unwrap_or(0)
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    column_sql: &str,
) -> Result<(), String> {
    if column_exists(connection, table, column)? {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {column_sql}"),
            [],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not add {table}.{column}: {error}"))
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Could not inspect {table}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Could not inspect {table} columns: {error}"))?;

    for row in rows {
        if row.map_err(|error| format!("Could not read {table} column: {error}"))? == column {
            return Ok(true);
        }
    }

    Ok(false)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory sqlite");
        connection
            .execute_batch(KEY_VALUE_TABLE_SQL)
            .expect("create schema");
        connection
    }

    #[test]
    fn sync_memory_vector_records_projects_chat_memory_vectors() {
        let connection = open_test_connection();
        let storage_key = "gilbert-codex.chat-memory.v1.chat-123";
        let value = serde_json::json!({
            "chatId": "chat-123",
            "chatTitle": "Inline editing",
            "projectKey": "project-a",
            "projectName": "GilbertCodex",
            "records": [{
                "chunkId": "event-1:chunk:0",
                "content": "Precise edit tools should be preferred.",
                "contentHash": "hash-1",
                "eventId": "event-1",
                "id": "record-1",
                "source": "assistant",
                "summary": "Prefer precise edits",
                "updatedAt": "2026-05-16T10:00:00.000Z",
                "vector": {
                    "dimensions": 3,
                    "model": "gilbert-local-hash-v1",
                    "values": [0.5, 0.25, 0.125]
                }
            }]
        })
        .to_string();

        sync_storage_projection(&connection, "user.test", storage_key, &value).unwrap();

        let row = connection
            .query_row(
                "SELECT collection, embedding_model, dimensions, vector_json, metadata_json, content_hash, vector_blob
                 FROM vector_embeddings
                 WHERE namespace = ?1 AND entity_id = ?2 AND chunk_id = ?3",
                params!["user.test", storage_key, "event-1:chunk:0"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Vec<u8>>(6)?,
                    ))
                },
            )
            .unwrap();
        let metadata = serde_json::from_str::<Value>(&row.4).unwrap();

        assert_eq!(row.0, "chat-memory");
        assert_eq!(row.1, "gilbert-local-hash-v1");
        assert_eq!(row.2, 3);
        assert_eq!(row.3, "[0.5,0.25,0.125]");
        assert_eq!(row.5, "hash-1");
        assert_eq!(row.6.len(), 12);
        assert_eq!(metadata["storageKey"], storage_key);
        assert_eq!(metadata["recordId"], "record-1");
        assert_eq!(metadata["summary"], "Prefer precise edits");
        assert_eq!(metadata["chatTitle"], "Inline editing");
    }

    #[test]
    fn sync_chat_records_projects_typed_message_items() {
        let connection = open_test_connection();
        let value = serde_json::json!([{
            "id": "chat-1",
            "title": "High-throughput storage",
            "project": "GilbertCodex",
            "updatedAt": "2026-05-16T11:00:00.000Z",
            "messages": [{
                "id": "message-1",
                "role": "assistant",
                "status": "complete",
                "content": "Done.",
                "reasoning": "short",
                "updatedAt": "2026-05-16T11:00:00.000Z",
                "sources": [{ "title": "SQLite WAL" }],
                "toolCalls": [{ "name": "database" }],
                "approvals": [{ "id": "approval-1" }],
                "artifacts": [{ "id": "artifact-1" }],
                "attachments": [{ "kind": "file", "name": "schema.sql" }]
            }]
        }])
        .to_string();

        sync_storage_projection(&connection, "user.test", "gilbert-codex.chats.v1", &value)
            .unwrap();

        let message = connection
            .query_row(
                "SELECT role, content_bytes, reasoning_bytes, source_count, attachment_count, tool_call_count, approval_count, artifact_count
                 FROM chat_messages
                 WHERE namespace = ?1 AND chat_id = ?2 AND message_id = ?3",
                params!["user.test", "chat-1", "message-1"],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .unwrap();
        let item_count = connection
            .query_row(
                "SELECT COUNT(*)
                 FROM chat_message_items
                 WHERE namespace = ?1 AND chat_id = ?2 AND message_id = ?3",
                params!["user.test", "chat-1", "message-1"],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();

        assert_eq!(message.0, "assistant");
        assert_eq!(message.1, 5);
        assert_eq!(message.2, 5);
        assert_eq!(message.3, 1);
        assert_eq!(message.4, 1);
        assert_eq!(message.5, 1);
        assert_eq!(message.6, 1);
        assert_eq!(message.7, 1);
        assert_eq!(item_count, 5);
    }

    #[test]
    fn sync_memory_vector_records_replaces_existing_rows_for_key() {
        let connection = open_test_connection();
        let storage_key = "gilbert-codex.project-memory.v1.project-a";
        let first_value = serde_json::json!({
            "projectKey": "project-a",
            "projectName": "GilbertCodex",
            "records": [
                {
                    "chunkId": "chunk-a",
                    "content": "first",
                    "contentHash": "hash-a",
                    "eventId": "event-a",
                    "id": "record-a",
                    "source": "tool",
                    "summary": "First",
                    "vector": {
                        "dimensions": 2,
                        "model": "gilbert-local-hash-v1",
                        "values": [1.0, 0.0]
                    }
                },
                {
                    "chunkId": "chunk-b",
                    "content": "second",
                    "contentHash": "hash-b",
                    "eventId": "event-b",
                    "id": "record-b",
                    "source": "tool",
                    "summary": "Second",
                    "vector": {
                        "dimensions": 2,
                        "model": "gilbert-local-hash-v1",
                        "values": [0.0, 1.0]
                    }
                }
            ]
        })
        .to_string();
        let second_value = serde_json::json!({
            "projectKey": "project-a",
            "projectName": "GilbertCodex",
            "records": [{
                "chunkId": "chunk-c",
                "content": "replacement",
                "contentHash": "hash-c",
                "eventId": "event-c",
                "id": "record-c",
                "source": "tool",
                "summary": "Replacement",
                "vector": {
                    "dimensions": 2,
                    "model": "gilbert-local-hash-v1",
                    "values": [0.25, 0.75]
                }
            }]
        })
        .to_string();

        sync_storage_projection(&connection, "user.test", storage_key, &first_value).unwrap();
        sync_storage_projection(&connection, "user.test", storage_key, &second_value).unwrap();

        let count = connection
            .query_row(
                "SELECT COUNT(*)
                 FROM vector_embeddings
                 WHERE namespace = ?1 AND collection = ?2 AND entity_id = ?3",
                params!["user.test", "project-memory", storage_key],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        let chunk_id = connection
            .query_row(
                "SELECT chunk_id
                 FROM vector_embeddings
                 WHERE namespace = ?1 AND collection = ?2 AND entity_id = ?3",
                params!["user.test", "project-memory", storage_key],
                |row| row.get::<_, String>(0),
            )
            .unwrap();

        assert_eq!(count, 1);
        assert_eq!(chunk_id, "chunk-c");
    }

    #[test]
    fn startup_chat_projection_skips_current_typed_rows() {
        let connection = open_test_connection();
        let one_chat = serde_json::json!([{
            "id": "chat-1",
            "title": "Startup perf",
            "project": "GilbertCodex",
            "updatedAt": "2026-05-24T10:00:00.000Z",
            "messages": []
        }])
        .to_string();
        let two_chats = serde_json::json!([
            {
                "id": "chat-1",
                "title": "Startup perf",
                "project": "GilbertCodex",
                "updatedAt": "2026-05-24T10:00:00.000Z",
                "messages": []
            },
            {
                "id": "chat-2",
                "title": "Needs projection",
                "project": "GilbertCodex",
                "updatedAt": "2026-05-24T10:01:00.000Z",
                "messages": []
            }
        ])
        .to_string();

        sync_chat_records(&connection, "user.test", CHATS_STORAGE_KEY, &one_chat).unwrap();

        assert!(!should_sync_startup_chat_projection(&connection, "user.test", &one_chat).unwrap());
        assert!(should_sync_startup_chat_projection(&connection, "user.test", &two_chats).unwrap());
    }

    #[test]
    fn startup_typed_chat_load_hydrates_only_active_chat() {
        let connection = open_test_connection();
        let value = serde_json::json!([
            {
                "id": "chat-1",
                "title": "Older chat",
                "project": "GilbertCodex",
                "updatedAt": "2026-05-24T10:00:00.000Z",
                "messages": [{ "id": "message-1", "role": "user", "content": "older" }]
            },
            {
                "id": "chat-2",
                "title": "Active chat",
                "project": "GilbertCodex",
                "updatedAt": "2026-05-24T10:01:00.000Z",
                "messages": [{ "id": "message-2", "role": "user", "content": "active" }]
            }
        ])
        .to_string();

        sync_chat_records(&connection, "user.test", CHATS_STORAGE_KEY, &value).unwrap();

        let startup_json = load_startup_typed_chats_json(&connection, "user.test", Some("chat-2"))
            .unwrap()
            .unwrap();
        let chats = serde_json::from_str::<Value>(&startup_json).unwrap();
        let chats = chats.as_array().unwrap();
        let older_chat = chats.iter().find(|chat| chat["id"] == "chat-1").unwrap();
        let active_chat = chats.iter().find(|chat| chat["id"] == "chat-2").unwrap();

        assert_eq!(older_chat["messages"].as_array().unwrap().len(), 0);
        assert_eq!(older_chat["messagesLoaded"], false);
        assert_eq!(active_chat["messages"].as_array().unwrap().len(), 1);
        assert_eq!(active_chat["messagesLoaded"], true);
    }

    #[test]
    fn sync_chat_records_preserves_messages_for_unloaded_chat_summary() {
        let connection = open_test_connection();
        let full_value = serde_json::json!([{
            "id": "chat-1",
            "title": "Before",
            "project": "GilbertCodex",
            "updatedAt": "2026-05-24T10:00:00.000Z",
            "messages": [{ "id": "message-1", "role": "user", "content": "keep me" }]
        }])
        .to_string();
        let summary_value = serde_json::json!([{
            "id": "chat-1",
            "messages": [],
            "messagesLoaded": false,
            "pinned": true,
            "project": "GilbertCodex",
            "title": "After",
            "updatedAt": "2026-05-24T10:01:00.000Z"
        }])
        .to_string();

        sync_chat_records(&connection, "user.test", CHATS_STORAGE_KEY, &full_value).unwrap();
        sync_chat_records(&connection, "user.test", CHATS_STORAGE_KEY, &summary_value).unwrap();

        let raw_json = load_typed_chat_json_by_id(&connection, "user.test", "chat-1")
            .unwrap()
            .unwrap();
        let chat = serde_json::from_str::<Value>(&raw_json).unwrap();

        assert_eq!(chat["title"], "After");
        assert_eq!(chat["pinned"], true);
        assert_eq!(chat["messages"].as_array().unwrap().len(), 1);
        assert!(chat.get("messagesLoaded").is_none());
    }

    #[test]
    fn startup_namespace_projection_skips_memory_vector_backfill() {
        let connection = open_test_connection();
        let storage_key = "gilbert-codex.chat-memory.v1.chat-123";
        let value = serde_json::json!({
            "chatId": "chat-123",
            "records": [{
                "chunkId": "chunk-a",
                "content": "startup should not block on memory vector backfill",
                "contentHash": "hash-a",
                "eventId": "event-a",
                "id": "record-a",
                "source": "assistant",
                "summary": "Skip startup projection",
                "vector": {
                    "dimensions": 2,
                    "model": "gilbert-local-hash-v1",
                    "values": [0.25, 0.75]
                }
            }]
        })
        .to_string();

        connection
            .execute(
                "INSERT INTO app_storage(namespace, storage_key, storage_value)
                 VALUES(?1, ?2, ?3)",
                params!["user.test", storage_key, value],
            )
            .unwrap();

        sync_namespace_projections(&connection, "user.test", NamespaceProjectionMode::Startup)
            .unwrap();

        let startup_count = connection
            .query_row("SELECT COUNT(*) FROM vector_embeddings", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();

        assert_eq!(startup_count, 0);

        sync_namespace_projections(&connection, "user.test", NamespaceProjectionMode::Full)
            .unwrap();

        let full_count = connection
            .query_row("SELECT COUNT(*) FROM vector_embeddings", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();

        assert_eq!(full_count, 1);
    }
}
