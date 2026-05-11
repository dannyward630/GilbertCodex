use crate::core::storage::{self, DeviceStorageSeed, DeviceStorageSnapshot};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageCleanupResponse {
    removed_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseOverviewResponse {
    database_path: String,
    exists: bool,
    file_size_bytes: u64,
    last_modified: Option<u64>,
    record_count: usize,
    namespace_count: usize,
    categories: Vec<DatabaseStorageCategory>,
    records: Vec<DatabaseStorageRecord>,
    context: DatabaseContextSummary,
    legacy_storage: LegacyStorageSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStorageCategory {
    id: String,
    label: String,
    description: String,
    record_count: usize,
    storage_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStorageRecord {
    namespace: String,
    key: String,
    label: String,
    category: String,
    size_bytes: u64,
    updated_at: u64,
    summary: String,
    sensitive: bool,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseContextSummary {
    chat_count: u64,
    message_count: u64,
    user_message_count: u64,
    assistant_message_count: u64,
    source_count: u64,
    image_count: u64,
    file_attachment_count: u64,
    tool_call_count: u64,
    approval_count: u64,
    artifact_count: u64,
    thinking_bytes: u64,
    reasoning_bytes: u64,
    content_bytes: u64,
    estimated_tokens: u64,
    context_compaction_count: u64,
    agent_run_count: u64,
    agent_run_step_count: u64,
    agent_run_event_count: u64,
    largest_chat_title: Option<String>,
    largest_chat_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageSummary {
    total_bytes: u64,
    files: Vec<LegacyStorageEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageEntry {
    path: String,
    exists: bool,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResetResponse {
    removed_paths: Vec<String>,
    failed_paths: Vec<String>,
}

struct StoredDatabaseRecord {
    namespace: String,
    key: String,
    value: String,
    updated_at: u64,
}

struct CategoryDefinition {
    id: &'static str,
    label: &'static str,
    description: &'static str,
}

#[tauri::command]
pub fn gilbert_database_load(
    app: AppHandle,
    namespace: String,
    seeds: Vec<DeviceStorageSeed>,
) -> Result<DeviceStorageSnapshot, String> {
    storage::load_namespace(&app, &namespace, &seeds)
}

#[tauri::command]
pub fn gilbert_database_set_value(
    app: AppHandle,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    storage::write_value(&app, &namespace, &key, &value)
}

#[tauri::command]
pub fn gilbert_database_set_values(
    app: AppHandle,
    namespace: String,
    values: Vec<DeviceStorageSeed>,
) -> Result<(), String> {
    storage::write_values(&app, &namespace, &values)
}

#[tauri::command]
pub fn gilbert_database_cleanup_legacy_storage(
    app: AppHandle,
) -> Result<LegacyStorageCleanupResponse, String> {
    let mut removed_paths = Vec::new();

    for path in legacy_storage_paths(&app)? {
        if delete_path(&path)? {
            removed_paths.push(path_to_string(&path));
        }
    }

    Ok(LegacyStorageCleanupResponse { removed_paths })
}

#[tauri::command]
pub fn gilbert_database_get_overview(app: AppHandle) -> Result<DatabaseOverviewResponse, String> {
    let database_path = storage::database_path(&app)
        .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
    let exists = database_path.exists();
    let metadata = fs::metadata(&database_path).ok();
    let file_size_bytes = metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let last_modified = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64);

    let stored_records = if exists {
        read_database_records(&database_path)?
    } else {
        Vec::new()
    };

    let mut categories = Vec::new();
    let mut context = DatabaseContextSummary::default();
    let mut namespaces = BTreeSet::new();
    let mut records = Vec::new();

    for record in stored_records {
        namespaces.insert(record.namespace.clone());
        add_record_context(&record.key, &record.value, &mut context);

        let definition = category_for_key(&record.key);
        let size_bytes = record.value.as_bytes().len() as u64;
        add_category_usage(&mut categories, &definition, size_bytes);

        records.push(DatabaseStorageRecord {
            namespace: record.namespace,
            key: record.key.clone(),
            label: label_for_key(&record.key).to_string(),
            category: definition.id.to_string(),
            size_bytes,
            updated_at: record.updated_at,
            summary: summarize_record(&record.key, &record.value),
            sensitive: is_sensitive_key(&record.key),
        });
    }

    context.estimated_tokens =
        ((context.content_bytes + context.reasoning_bytes + context.thinking_bytes) as f64 / 4.0)
            .ceil() as u64;

    let legacy_storage = inspect_legacy_storage(&app)?;

    Ok(DatabaseOverviewResponse {
        database_path: path_to_string(&database_path),
        exists,
        file_size_bytes,
        last_modified,
        record_count: records.len(),
        namespace_count: namespaces.len(),
        categories,
        records,
        context,
        legacy_storage,
    })
}

#[tauri::command]
pub fn gilbert_database_reset(app: AppHandle) -> Result<DatabaseResetResponse, String> {
    let database_path = storage::database_path(&app)
        .map_err(|error| format!("Could not resolve the local database path: {error}"))?;
    let mut removed_paths = Vec::new();
    let mut failed_paths = Vec::new();

    for path in database_file_family(&database_path) {
        if delete_path(&path)? {
            removed_paths.push(path_to_string(&path));
        }
    }

    for path in legacy_storage_paths(&app)? {
        match delete_path(&path) {
            Ok(true) => removed_paths.push(path_to_string(&path)),
            Ok(false) => {}
            Err(error) => failed_paths.push(error),
        }
    }

    Ok(DatabaseResetResponse {
        removed_paths,
        failed_paths,
    })
}

fn legacy_storage_paths(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the old app data folder: {error}"))?;
    let mut paths = storage::legacy_database_file_family(app)?;
    paths.extend([
        app_data.join("auth").join("local-auth-db.json"),
        app_data.join("agent-runs.json"),
        app_data.join("github").join("github-account.json"),
    ]);

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(local_app_data)
                .join("com.gilbert.codex")
                .join("EBWebView")
                .join("Default")
                .join("Local Storage"),
        );
    }

    Ok(paths)
}

fn delete_path(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path_to_string(path)))?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Could not remove {}: {error}", path_to_string(path)))?;
    } else {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove {}: {error}", path_to_string(path)))?;
    }

    if let Some(parent) = path.parent() {
        let is_empty = fs::read_dir(parent)
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);

        if is_empty {
            let _ = fs::remove_dir(parent);
        }
    }

    Ok(true)
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

fn read_database_records(database_path: &Path) -> Result<Vec<StoredDatabaseRecord>, String> {
    let connection = Connection::open(database_path)
        .map_err(|error| format!("Could not open local database: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT namespace,
                    storage_key,
                    storage_value,
                    COALESCE(CAST(strftime('%s', updated_at) AS INTEGER) * 1000, 0) AS updated_at_ms \
             FROM app_storage ORDER BY namespace, storage_key",
        )
        .map_err(|error| format!("Could not read local database index: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(StoredDatabaseRecord {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get::<_, i64>(3)?.max(0) as u64,
            })
        })
        .map_err(|error| format!("Could not read local database rows: {error}"))?;

    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|error| format!("Could not decode local database row: {error}"))?);
    }

    Ok(records)
}

fn inspect_legacy_storage(app: &AppHandle) -> Result<LegacyStorageSummary, String> {
    let mut total_bytes = 0;
    let mut files = Vec::new();

    for path in legacy_storage_paths(app)? {
        let exists = path.exists();
        let size_bytes = if exists { path_size(&path)? } else { 0 };
        total_bytes += size_bytes;
        files.push(LegacyStorageEntry {
            path: path_to_string(&path),
            exists,
            size_bytes,
        });
    }

    Ok(LegacyStorageSummary { total_bytes, files })
}

fn path_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path_to_string(path)))?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }

    let mut total = 0;
    for entry in fs::read_dir(path)
        .map_err(|error| format!("Could not read {}: {error}", path_to_string(path)))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read {}: {error}", path_to_string(path)))?;
        total += path_size(&entry.path())?;
    }

    Ok(total)
}

fn category_for_key(key: &str) -> CategoryDefinition {
    match key {
        "gilbert-codex.chats.v1" => CategoryDefinition {
            id: "context",
            label: "Chats & context",
            description:
                "Saved conversations, sources, attachments, tool traces, and reasoning context.",
        },
        "gilbert-codex.projects.v1" => CategoryDefinition {
            id: "projects",
            label: "Projects",
            description: "Project records and workspace organization.",
        },
        "local-auth-db.v1" => CategoryDefinition {
            id: "auth",
            label: "Auth",
            description: "Local authentication state stored only on this device.",
        },
        "agent-runs.v1" => CategoryDefinition {
            id: "agent-runs",
            label: "Agent runs",
            description: "Background run history, steps, events, and tool activity.",
        },
        "github-account.v1"
        | "gilbert-codex.discord-bridge.v1"
        | "gilbert-codex.github-oauth-client-id.v1" => CategoryDefinition {
            id: "integrations",
            label: "Integrations",
            description: "Connected service state and integration preferences.",
        },
        "gilbert-codex.provider-settings.v1"
        | "gilbert-codex.thinking.v1"
        | "gilbert-codex.tool-registry.v1"
        | "gilbert-codex.appearance.v1"
        | "gilbert-codex.local-workspace.v1"
        | "gilbert-codex.browser-preview-session.v1"
        | "gilbert-codex.active-chat.v1" => CategoryDefinition {
            id: "settings",
            label: "Settings",
            description: "Model, tool, appearance, workspace, and session preferences.",
        },
        _ => CategoryDefinition {
            id: "other",
            label: "Other",
            description: "Additional local app data.",
        },
    }
}

fn add_category_usage(
    categories: &mut Vec<DatabaseStorageCategory>,
    definition: &CategoryDefinition,
    bytes: u64,
) {
    if let Some(category) = categories
        .iter_mut()
        .find(|category| category.id == definition.id)
    {
        category.record_count += 1;
        category.storage_bytes += bytes;
        return;
    }

    categories.push(DatabaseStorageCategory {
        id: definition.id.to_string(),
        label: definition.label.to_string(),
        description: definition.description.to_string(),
        record_count: 1,
        storage_bytes: bytes,
    });
}

fn label_for_key(key: &str) -> &'static str {
    match key {
        "gilbert-codex.chats.v1" => "Saved chats",
        "gilbert-codex.projects.v1" => "Projects",
        "gilbert-codex.provider-settings.v1" => "Provider settings",
        "gilbert-codex.thinking.v1" => "Thinking settings",
        "gilbert-codex.tool-registry.v1" => "Tool registry",
        "gilbert-codex.appearance.v1" => "Appearance settings",
        "gilbert-codex.local-workspace.v1" => "Local workspace",
        "gilbert-codex.active-chat.v1" => "Active chat",
        "gilbert-codex.discord-bridge.v1" => "Discord bridge",
        "gilbert-codex.github-oauth-client-id.v1" => "GitHub OAuth client",
        "gilbert-codex.browser-preview-session.v1" => "Browser preview session",
        "local-auth-db.v1" => "Local auth",
        "agent-runs.v1" => "Agent runs",
        "github-account.v1" => "GitHub account",
        _ => "Local record",
    }
}

fn is_sensitive_key(key: &str) -> bool {
    matches!(key, "local-auth-db.v1" | "github-account.v1")
}

fn summarize_record(key: &str, raw: &str) -> String {
    if is_sensitive_key(key) {
        return "Stored locally; value hidden from the inspector.".to_string();
    }

    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return "Stored local value.".to_string();
    };

    match key {
        "gilbert-codex.chats.v1" => summarize_chat_record(&value),
        "gilbert-codex.projects.v1" => summarize_array_record(&value, "project", "projects"),
        "agent-runs.v1" => summarize_agent_record(&value),
        "gilbert-codex.tool-registry.v1" => summarize_tool_registry_record(&value),
        _ => summarize_json_record(&value),
    }
}

fn summarize_chat_record(value: &Value) -> String {
    let Some(chats) = value.as_array() else {
        return "Saved chat data.".to_string();
    };
    let message_count = chats
        .iter()
        .filter_map(|chat| chat.get("messages").and_then(Value::as_array))
        .map(|messages| messages.len())
        .sum::<usize>();
    format!(
        "{} {}, {} {}",
        chats.len(),
        plural("chat", "chats", chats.len()),
        message_count,
        plural("message", "messages", message_count)
    )
}

fn summarize_array_record(value: &Value, singular: &str, plural_label: &str) -> String {
    let count = value.as_array().map(|items| items.len()).unwrap_or(0);
    if count == 1 {
        format!("1 {singular}")
    } else {
        format!("{count} {plural_label}")
    }
}

fn summarize_agent_record(value: &Value) -> String {
    let Some(runs) = value.as_array() else {
        return "Saved agent run history.".to_string();
    };
    let step_count = runs
        .iter()
        .filter_map(|run| run.get("steps").and_then(Value::as_array))
        .map(|steps| steps.len())
        .sum::<usize>();
    let event_count = runs
        .iter()
        .filter_map(|run| run.get("events").and_then(Value::as_array))
        .map(|events| events.len())
        .sum::<usize>();
    format!(
        "{} {}, {} {}, {} {}",
        runs.len(),
        plural("run", "runs", runs.len()),
        step_count,
        plural("step", "steps", step_count),
        event_count,
        plural("event", "events", event_count)
    )
}

fn summarize_tool_registry_record(value: &Value) -> String {
    let enabled = value
        .get("enabledToolIds")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let disabled = value
        .get("disabledToolIds")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    format!("{enabled} enabled tools, {disabled} disabled tools")
}

fn summarize_json_record(value: &Value) -> String {
    if let Some(object) = value.as_object() {
        return format!("{} saved fields", object.len());
    }
    if let Some(array) = value.as_array() {
        return format!("{} saved items", array.len());
    }
    "Stored local value.".to_string()
}

fn plural<'a>(singular: &'a str, plural_label: &'a str, count: usize) -> &'a str {
    if count == 1 {
        singular
    } else {
        plural_label
    }
}

fn add_record_context(key: &str, raw: &str, context: &mut DatabaseContextSummary) {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return;
    };

    match key {
        "gilbert-codex.chats.v1" => add_chat_context(&value, context),
        "agent-runs.v1" => add_agent_context(&value, context),
        _ => {}
    }
}

fn add_chat_context(value: &Value, context: &mut DatabaseContextSummary) {
    let Some(chats) = value.as_array() else {
        return;
    };
    context.chat_count += chats.len() as u64;

    for chat in chats {
        let chat_bytes = serde_json::to_vec(chat)
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0);
        if chat_bytes > context.largest_chat_bytes {
            context.largest_chat_bytes = chat_bytes;
            context.largest_chat_title = chat
                .get("title")
                .and_then(Value::as_str)
                .map(|title| title.to_string());
        }

        if let Some(compactions) = chat.get("contextCompactions").and_then(Value::as_array) {
            context.context_compaction_count += compactions.len() as u64;
        }

        let Some(messages) = chat.get("messages").and_then(Value::as_array) else {
            continue;
        };
        context.message_count += messages.len() as u64;

        for message in messages {
            match message.get("role").and_then(Value::as_str) {
                Some("user") => context.user_message_count += 1,
                Some("assistant") => context.assistant_message_count += 1,
                _ => {}
            }

            if let Some(content) = message.get("content").and_then(Value::as_str) {
                context.content_bytes += content.as_bytes().len() as u64;
            }
            if let Some(reasoning) = message.get("reasoning").and_then(Value::as_str) {
                context.reasoning_bytes += reasoning.as_bytes().len() as u64;
            }
            if let Some(thinking) = message.get("thinking") {
                context.thinking_bytes += serde_json::to_vec(thinking)
                    .map(|bytes| bytes.len() as u64)
                    .unwrap_or(0);
            }

            context.source_count += count_array(message, "sources");
            context.tool_call_count += count_array(message, "toolCalls");
            context.approval_count += count_array(message, "approvals");
            context.artifact_count += count_array(message, "artifacts");
            add_attachment_counts(message, context);
        }
    }
}

fn add_attachment_counts(message: &Value, context: &mut DatabaseContextSummary) {
    let Some(attachments) = message.get("attachments").and_then(Value::as_array) else {
        return;
    };

    for attachment in attachments {
        match attachment.get("kind").and_then(Value::as_str) {
            Some("image") => context.image_count += 1,
            Some("file") => context.file_attachment_count += 1,
            _ => {}
        }
    }
}

fn add_agent_context(value: &Value, context: &mut DatabaseContextSummary) {
    let Some(runs) = value.as_array() else {
        return;
    };
    context.agent_run_count += runs.len() as u64;
    for run in runs {
        context.agent_run_step_count += count_array(run, "steps");
        context.agent_run_event_count += count_array(run, "events");
    }
}

fn count_array(value: &Value, field: &str) -> u64 {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| items.len() as u64)
        .unwrap_or(0)
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}
