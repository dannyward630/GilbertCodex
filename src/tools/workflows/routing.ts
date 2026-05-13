import type { ToolRegistrySettings } from "../../types/tools";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { LocalComputerToolExecutionPolicy } from "../computer/executor/policy";
import { parseLocalComputerToolCalls } from "../computer/executor/parser";

const WORKFLOW_GOAL_PROMPT_PATTERN =
  /\b(agent|app|audit|branch|bug|build|check|codebase|debug|feature|fix|health|implement|mcp|monitor|patch|plan|pr|pull request|repo|research|tool sprawl|validate|workflow)\b/i;
const PRIMITIVE_EVIDENCE_TOOLS = new Set([
  "git_diff",
  "git_status",
  "list_directory",
  "read_file",
  "recall_context",
  "search_files",
  "view_code",
]);

export function routePrimitiveEvidenceBatchToWorkflow(
  content: string,
  userPrompt: string,
  toolSettings: ToolRegistrySettings,
  executionPolicy?: LocalComputerToolExecutionPolicy,
) {
  const tools = normalizeToolRegistrySettings(toolSettings);

  if (!tools.workflowAutomation || !WORKFLOW_GOAL_PROMPT_PATTERN.test(userPrompt)) {
    return content;
  }

  const calls = parseLocalComputerToolCalls(content, executionPolicy);

  if (calls.length < 3 || calls.some((call) => call.tool === "workflow_run")) {
    return content;
  }

  if (!calls.every((call) => PRIMITIVE_EVIDENCE_TOOLS.has(call.tool))) {
    return content;
  }

  const workflowId = selectWorkflowIdForPrompt(userPrompt);
  return [
    "<tool_call>",
    "workflow_run",
    `<arg_key>goal</arg_key><arg_value>${escapeXml(userPrompt)}</arg_value>`,
    `<arg_key>workflow_id</arg_key><arg_value>${workflowId}</arg_value>`,
    "<arg_key>mode</arg_key><arg_value>plan</arg_value>",
    "</tool_call>",
  ].join("\n");
}

function selectWorkflowIdForPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  if (/\b(workflow layer|workflow|tool sprawl|agent runtime|audit)\b/.test(normalized)) {
    return "agent-workflow-audit";
  }

  if (/\b(latest|current|official|docs?|api|library|research)\b/.test(normalized)) {
    return "research-backed-patch";
  }

  if (/\b(health|check|validate|test|lint|build)\b/.test(normalized)) {
    return "repo-health-sweep";
  }

  if (/\b(pr|pull request|branch|commit|push)\b/.test(normalized)) {
    return "branch-pr-prep";
  }

  if (/\b(monitor|watch|scheduled?|recurring|notify)\b/.test(normalized)) {
    return "monitor-brief";
  }

  return "plan-patch-verify";
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
