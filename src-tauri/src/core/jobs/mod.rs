use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running,
    WaitingForApproval,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJob {
    pub approvals: Vec<String>,
    pub artifacts: Vec<Value>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub id: String,
    pub last_error: Option<String>,
    pub run_id: String,
    pub state: JobState,
    pub step_ids: Vec<String>,
    pub title: String,
    pub tool_results: Vec<Value>,
    pub updated_at: String,
}
