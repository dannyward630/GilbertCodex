import type { ParsedLocalComputerToolCall } from "../computer/executor/types";
import { firstArg } from "../computer/executor/argHelpers";
import { getWorkflowDefinition, listWorkflowDefinitions, normalizeWorkflowId } from "./definitions";
import type { WorkflowDefinition, WorkflowMode, WorkflowRunRequest } from "./types";

export function parseWorkflowRunRequest(call: ParsedLocalComputerToolCall): WorkflowRunRequest {
  const workflowId = firstArg(call.args, ["workflow_id", "workflowId", "workflow", "id"]);
  const rawMode = firstArg(call.args, ["mode", "run_mode", "runMode"]);
  const mode = isWorkflowMode(rawMode) ? rawMode : "auto";
  const rawApprovalPolicy = firstArg(call.args, ["approval_policy", "approvalPolicy"]);
  const goal = firstArg(call.args, ["goal", "prompt", "task", "request", "query", "content"])?.trim() || "Run the selected workflow.";

  return {
    approvalPolicy: rawApprovalPolicy === "inherit" ? "inherit" : "inherit",
    goal,
    inputs: parseWorkflowInputs(call.args),
    mode,
    workflowId: workflowId ? normalizeWorkflowId(workflowId) : undefined,
  };
}

export function selectWorkflowDefinition(request: WorkflowRunRequest): WorkflowDefinition {
  const explicit = getWorkflowDefinition(request.workflowId);

  if (explicit) {
    return explicit;
  }

  const goal = request.goal.toLowerCase();
  const scored = listWorkflowDefinitions()
    .map((workflow) => ({
      score: scoreWorkflow(workflow, goal),
      workflow,
    }))
    .sort((left, right) => right.score - left.score || left.workflow.title.localeCompare(right.workflow.title));

  return scored[0]?.workflow ?? listWorkflowDefinitions()[0];
}

export function workflowRunNeedsApproval(call: ParsedLocalComputerToolCall) {
  const request = parseWorkflowRunRequest(call);
  const workflow = selectWorkflowDefinition(request);
  return workflow.mutates || request.mode === "execute";
}

export function createWorkflowApprovalPreview(call: ParsedLocalComputerToolCall) {
  const request = parseWorkflowRunRequest(call);
  const workflow = selectWorkflowDefinition(request);

  return [
    `Workflow: ${workflow.title} (${workflow.id}@v${workflow.version})`,
    `Mode: ${request.mode}`,
    `Goal: ${request.goal}`,
    workflow.mutates || request.mode === "execute"
      ? "This workflow may sequence mutating primitives after approval."
      : "This workflow is read-only in v1.",
  ].join("\n");
}

function isWorkflowMode(value: string | undefined): value is WorkflowMode {
  return value === "auto" || value === "execute" || value === "monitor" || value === "plan";
}

function parseWorkflowInputs(args: Record<string, string>): Record<string, unknown> {
  const raw = firstArg(args, ["inputs", "inputs_json", "inputsJson"]);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { raw };
  }
}

function scoreWorkflow(workflow: WorkflowDefinition, goal: string) {
  let score = workflow.id === normalizeWorkflowId(goal) ? 100 : 0;

  for (const hint of workflow.triggerHints) {
    const normalizedHint = hint.toLowerCase();
    if (goal.includes(normalizedHint)) {
      score += Math.max(8, normalizedHint.length);
      continue;
    }

    const terms = normalizedHint.split(/\s+/).filter((term) => term.length >= 4);
    score += terms.filter((term) => goal.includes(term)).length;
  }

  if (workflow.id.includes("research") && /\b(latest|current|official|docs?|api|provider|library)\b/.test(goal)) {
    score += 10;
  }

  if (workflow.id.includes("branch") && /\b(git|commit|push|branch|pull request|pr)\b/.test(goal)) {
    score += 10;
  }

  if (workflow.id.includes("health") && /\b(check|build|validate|health|test)\b/.test(goal)) {
    score += 8;
  }

  if (workflow.id.includes("mcp") && /\bmcp\b/.test(goal)) {
    score += 20;
  }

  if (workflow.id.includes("monitor") && /\b(monitor|watch|notify|scheduled?|recurring)\b/.test(goal)) {
    score += 20;
  }

  if (workflow.id.includes("plan-patch") && /\b(add|build|change|fix|implement|patch|update)\b/.test(goal)) {
    score += 6;
  }

  return score;
}
