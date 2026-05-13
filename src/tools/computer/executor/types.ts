import type { AgentApproval } from "../../../types/agentRun";
import type { ChatArtifact, ChatProgressItem, ChatSource, ChatToolCall } from "../../../types/chat";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { TerminalShellId } from "../../../types/terminal";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { CodingToolName } from "../../coding";
import type { ColorToolName } from "../../color";
import type { FileCreationToolName } from "../../fileCreation";
import type { GithubToolName } from "../../github";

export type LocalGitToolName =
  | "git_init"
  | "git_branch"
  | "git_checkout"
  | "git_commit"
  | "git_diff"
  | "git_fetch"
  | "git_log"
  | "git_pull"
  | "git_push"
  | "git_stage"
  | "git_status"
  | "git_unstage";

export type LocalComputerToolName =
  | "build_index"
  | "browser_automation"
  | ColorToolName
  | CodingToolName
  | "create_vite_project"
  | "create_tool"
  | FileCreationToolName
  | LocalGitToolName
  | GithubToolName
  | "edit_file"
  | "edit_files"
  | "list_directory"
  | "mcp_call_tool"
  | "mcp_list_servers"
  | "mcp_list_tools"
  | "mcp_remove_server"
  | "mcp_set_server"
  | "move_path"
  | "open_browser_preview"
  | "read_file"
  | "recall_context"
  | "rename_path"
  | "run_subagents"
  | "run_terminal"
  | "run_tool"
  | "search_files"
  | "view_code"
  | "weather"
  | "web_search"
  | "workflow_run"
  | "write_file"
  | "unknown";

export interface ParsedLocalComputerToolCall {
  args: Record<string, string>;
  raw: string;
  tool: LocalComputerToolName;
}

export interface McpToolContext {
  onSettingsChange?: (next: import("../../../types/mcp").McpSettings) => void;
  settings: import("../../../types/mcp").McpSettings;
}

export type LocalToolFailureRecoveryKind =
  | "edit_retry"
  | "read_retry"
  | "write_retry"
  | "terminal_structured_edit"
  | "create_retry"
  | "mutation_retry"
  | "syntax_retry";

export interface LocalToolFailureRecovery {
  recoverable: true;
  recoveryKind: LocalToolFailureRecoveryKind;
  retryInstruction: string;
}

export interface LocalComputerToolRecoverableFailure extends LocalToolFailureRecovery {
  callNumber: number;
  output: string;
  tool: LocalComputerToolName;
}

export interface LocalComputerToolRunResult {
  approvalRequests: AgentApproval[];
  artifacts: ChatArtifact[];
  contextMessage: string;
  directAnswer?: string;
  executedCount: number;
  progress: ChatProgressItem;
  requestedCount: number;
  browserPreviewUrl?: string;
  recoverableFailure?: LocalComputerToolRecoverableFailure;
  sources: ChatSource[];
  toolCalls: ChatToolCall[];
  waitingForApproval: boolean;
}

export interface LocalComputerToolCallResult {
  artifacts?: ChatArtifact[];
  browserPreviewUrl?: string;
  content: string;
  directAnswer?: string;
  executed: boolean;
  /**
   * Machine-readable failure flag. Default semantics when unset:
   * - executed=true means not an error
   * - executed=false means intentional skip before running
   */
  is_error?: boolean;
  errorCode?: string;
  fileChanges?: ChatToolCall["fileChanges"];
  progress?: ChatProgressItem;
  recovery?: LocalToolFailureRecovery;
  sources?: ChatSource[];
  terminal?: ChatToolCall["terminal"];
}

export interface TerminalToolProgress {
  fileChanges?: ChatToolCall["fileChanges"];
  output: string;
  terminal?: ChatToolCall["terminal"];
}

export type ToolCallUpdateHandler = (callNumber: number, toolCall: ChatToolCall) => void;
export type TerminalProgressHandler = (progress: TerminalToolProgress) => void;

export type PreparedLocalToolItem =
  | {
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      fileChanges?: ChatToolCall["fileChanges"];
      kind: "cached";
      output: string;
      terminal?: ChatToolCall["terminal"];
    }
  | {
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      kind: "ready";
      settings: LocalWorkspaceSettings;
    }
  | {
      approval: AgentApproval;
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      kind: "approval";
    }
  | {
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      kind: "skipped";
      output: string;
      recovery?: LocalToolFailureRecovery;
      status: Extract<ChatToolCall["status"], "skipped" | "waiting_approval">;
    };

export type ReadyLocalToolItem = Extract<PreparedLocalToolItem, { kind: "ready" }>;

export interface CompletedLocalToolItem {
  browserPreviewUrl?: string;
  call: ParsedLocalComputerToolCall;
  callNumber: number;
  errorDetail?: string;
  result?: LocalComputerToolCallResult;
  toolCall: ChatToolCall;
}

export interface LocalSubagentTask {
  id?: string;
  prompt: string;
  title?: string;
}

export interface LocalSubagentResult {
  content: string;
  error?: string;
  id: string;
  title: string;
}

export type SubagentRunHandler = (tasks: LocalSubagentTask[]) => Promise<LocalSubagentResult[]>;

export interface ToolHandlerContext {
  executeBrowserAutomationTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeCreateTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeGitTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeOpenBrowserPreviewTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeRunTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeTerminalTool?: (call: ParsedLocalComputerToolCall) => Promise<LocalComputerToolCallResult>;
  executeWorkflowPrimitive?: (call: ParsedLocalComputerToolCall, context: ToolHandlerContext) => Promise<LocalComputerToolCallResult>;
  mcpContext?: McpToolContext;
  onRunSubagents?: SubagentRunHandler;
  onTerminalProgress?: TerminalProgressHandler;
  roots: string[];
  settings: LocalWorkspaceSettings;
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchMaxResults: number;
  webSearchSettings: import("../../../types/settings").WebSearchSettings;
}

export type LocalToolHandler = (
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
) => Promise<LocalComputerToolCallResult>;

export type TerminalCommandRunner = (options: {
  command: string;
  onProgress: TerminalProgressHandler;
  shell: TerminalShellId;
  signal?: AbortSignal;
  timeoutMs: number;
  workingDirectory: string;
}) => Promise<import("../../../types/terminal").TerminalRunCommandResponse>;
