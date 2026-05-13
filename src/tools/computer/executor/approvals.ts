import type { AgentApproval } from "../../../types/agentRun";
import { isFileCreationToolName } from "../../fileCreation";
import { isLocalGitToolName } from "./toolNames";
import type { LocalComputerToolName } from "./types";

export function createApprovalSessionDecisionKey(approval: Pick<AgentApproval, "kind" | "tool">) {
  return `session:${approval.kind}:${approval.tool}`;
}

export function approvalKindForTool(tool: LocalComputerToolName): AgentApproval["kind"] {
  if (tool === "run_terminal" || tool === "run_tool" || isLocalGitToolName(tool)) {
    return "terminal";
  }

  if (tool === "delete_file") {
    return "delete";
  }

  if (tool === "edit_file" || tool === "move_path" || tool === "rename_path") {
    return "edit";
  }

  if (tool === "write_file") {
    return "write";
  }

  if (tool === "open_browser_preview" || tool === "browser_automation") {
    return "browser";
  }

  if (tool === "create_tool") {
    return "custom_tool";
  }

  if (isFileCreationToolName(tool) || tool.startsWith("create_")) {
    return "file_create";
  }

  return "other";
}

export function approvalRiskForTool(tool: LocalComputerToolName): AgentApproval["risk"] {
  if (tool === "delete_file" || tool === "run_terminal" || tool === "run_tool" || tool === "create_tool" || tool === "github_commit_files" || tool === "github_create_release" || tool === "github_dispatch_workflow" || tool === "git_commit" || tool === "git_push" || tool === "git_pull" || tool === "git_checkout" || tool === "git_branch") {
    return "high";
  }

  if (tool === "workflow_run" || tool === "browser_automation" || tool === "edit_file" || tool === "write_file" || tool === "move_path" || tool === "rename_path" || tool === "git_init" || tool === "git_stage" || tool === "git_unstage" || tool === "git_fetch" || isFileCreationToolName(tool) || tool.startsWith("create_")) {
    return "medium";
  }

  return "low";
}

export function hashApprovalInput(tool: LocalComputerToolName, args: Record<string, string>) {
  const raw = `${tool}:${JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]]))}`;
  let hash = 0;

  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
