use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub approvals: Vec<AgentApproval>,
    pub artifacts: Vec<Value>,
    pub chat_id: String,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub events: Vec<AgentRunEvent>,
    pub id: String,
    pub last_error: Option<String>,
    pub message_id: Option<String>,
    pub mode: AgentRunMode,
    pub pending_tool_call_content: Option<String>,
    pub prompt: String,
    pub status: AgentRunStatus,
    pub steps: Vec<AgentRunStep>,
    pub title: String,
    pub tool_results: Vec<Value>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunMode {
    Chat,
    Plan,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Queued,
    Running,
    WaitingForApproval,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStep {
    pub approval_id: Option<String>,
    pub completed_at: Option<String>,
    pub detail: Option<String>,
    pub id: String,
    pub input: Option<String>,
    pub label: String,
    pub output: Option<String>,
    pub started_at: String,
    pub status: AgentStepStatus,
    pub tool_call_id: Option<String>,
    pub step_type: AgentStepType,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepType {
    Approval,
    Browser,
    Model,
    Planning,
    Subagent,
    Tool,
    Verification,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepStatus {
    Queued,
    Running,
    WaitingForApproval,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApproval {
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
    pub risk: String,
    pub run_id: Option<String>,
    pub status: String,
    pub title: String,
    pub tool: String,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEvent {
    pub at: String,
    pub detail: Option<String>,
    pub id: String,
    pub label: String,
    pub event_type: String,
}
