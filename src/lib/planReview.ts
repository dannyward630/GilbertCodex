import type { AgentApproval } from "../types/agentRun";
import type { ChatMessage } from "../types/chat";

export function getPlanningApproval(message: Pick<ChatMessage, "approvals">): AgentApproval | undefined {
  return message.approvals?.find((approval) => approval.tool === "planning_handoff");
}

export function getSavedPlanContent(message: Pick<ChatMessage, "approvals" | "content" | "mode" | "planning">): string {
  const planApproval = getPlanningApproval(message);
  const editedPlan = readPlanText(planApproval?.editedArgs);
  const storedPlan = message.planning?.planContent;
  const approvalPlan = readPlanText(planApproval?.args);
  const previewPlan = planApproval?.preview;
  const messagePlan = message.mode === "plan" ? message.content : "";

  return [editedPlan, storedPlan, approvalPlan, previewPlan, messagePlan]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) ?? "";
}

export function isPlanExecutionContent(message: Pick<ChatMessage, "approvals" | "content" | "mode" | "planning">, visibleContent: string) {
  const planContent = getSavedPlanContent(message);
  const normalizedVisible = visibleContent.trim();

  return Boolean(planContent && normalizedVisible && normalizedVisible !== planContent.trim());
}

function readPlanText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const plan = (value as { plan?: unknown }).plan;
  return typeof plan === "string" ? plan : undefined;
}
