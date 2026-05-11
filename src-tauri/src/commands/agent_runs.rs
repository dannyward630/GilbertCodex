use crate::core::storage::{self, SYSTEM_NAMESPACE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const AGENT_RUNS_STORAGE_KEY: &str = "agent-runs.v1";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRecord {
    pub args: Option<Value>,
    pub command: Option<String>,
    pub created_at: String,
    pub detail: Option<String>,
    pub edited_args: Option<Value>,
    pub id: String,
    pub kind: String,
    pub message_id: Option<String>,
    pub path: Option<String>,
    pub preview: Option<String>,
    pub resolved_at: Option<String>,
    pub resolution_note: Option<String>,
    pub resume_tool_call_content: Option<String>,
    pub risk: String,
    pub run_id: Option<String>,
    pub status: String,
    pub title: String,
    pub tool: String,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStepRecord {
    pub approval_id: Option<String>,
    pub completed_at: Option<String>,
    pub detail: Option<String>,
    pub id: String,
    pub input: Option<String>,
    pub label: String,
    pub output: Option<String>,
    pub started_at: String,
    pub status: String,
    pub tool_call_id: Option<String>,
    #[serde(rename = "type")]
    pub step_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEventRecord {
    pub at: String,
    pub detail: Option<String>,
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub event_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub approvals: Vec<AgentApprovalRecord>,
    pub artifacts: Vec<Value>,
    pub chat_id: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub events: Vec<AgentRunEventRecord>,
    pub id: String,
    pub last_error: Option<String>,
    pub local_workspace: Option<Value>,
    pub message_id: Option<String>,
    pub mode: String,
    pub pending_tool_call_content: Option<String>,
    pub prompt: String,
    pub sources: Vec<Value>,
    pub status: String,
    pub steps: Vec<AgentRunStepRecord>,
    pub title: String,
    pub tool_calls: Vec<Value>,
    pub updated_at: String,
}

#[tauri::command]
pub fn agent_runs_list(app: AppHandle) -> Result<Vec<AgentRunRecord>, String> {
    load_agent_runs(&app)
}

#[tauri::command]
pub fn agent_run_save(app: AppHandle, run: AgentRunRecord) -> Result<AgentRunRecord, String> {
    let mut runs = load_agent_runs(&app)?;

    if let Some(existing_index) = runs.iter().position(|existing| existing.id == run.id) {
        runs[existing_index] = run.clone();
    } else {
        runs.push(run.clone());
    }

    runs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    save_agent_runs(&app, &runs)?;

    Ok(run)
}

#[tauri::command]
pub fn agent_run_delete(app: AppHandle, id: String) -> Result<(), String> {
    let mut runs = load_agent_runs(&app)?;
    runs.retain(|run| run.id != id);
    save_agent_runs(&app, &runs)
}

fn load_agent_runs(app: &AppHandle) -> Result<Vec<AgentRunRecord>, String> {
    if let Some(raw) = storage::read_value(app, SYSTEM_NAMESPACE, AGENT_RUNS_STORAGE_KEY)? {
        return parse_agent_runs(&raw, "Gilbert Database agent runs");
    }

    let path = legacy_agent_runs_path(app)?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read agent runs: {error}"))?;
    let runs = parse_agent_runs(&raw, "legacy agent runs file")?;
    let migrated_raw = serde_json::to_string_pretty(&runs)
        .map_err(|error| format!("Failed to serialize migrated agent runs: {error}"))?;

    storage::write_value(app, SYSTEM_NAMESPACE, AGENT_RUNS_STORAGE_KEY, &migrated_raw)?;

    Ok(runs)
}

fn save_agent_runs(app: &AppHandle, runs: &[AgentRunRecord]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(runs)
        .map_err(|error| format!("Failed to serialize agent runs: {error}"))?;
    storage::write_value(app, SYSTEM_NAMESPACE, AGENT_RUNS_STORAGE_KEY, &raw)
        .map_err(|error| format!("Failed to save agent runs to Gilbert Database: {error}"))
}

fn parse_agent_runs(raw: &str, source: &str) -> Result<Vec<AgentRunRecord>, String> {
    serde_json::from_str::<Vec<AgentRunRecord>>(raw)
        .map_err(|error| format!("Failed to parse {source}: {error}"))
}

fn legacy_agent_runs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    Ok(directory.join("agent-runs.json"))
}
