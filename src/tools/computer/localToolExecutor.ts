import type { ChatProgressItem, ChatSource, ChatToolCall } from "../../types/chat";
import type { AgentApproval, AgentApprovalDecision } from "../../types/agentRun";
import { createTerminalSession, drainTerminalSession, isTauriDesktopRuntime, killTerminalSession, runBrowserAutomation, runTerminalCommand, writeTerminalSession } from "../../app/tauriClient";
import type { TerminalOutputChunk, TerminalRunCommandResponse, TerminalShellId } from "../../types/terminal";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";
import type {
  ComputerDirectoryListing,
  ComputerSearchResult,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import {
  buildComputerFileIndex,
  deleteComputerFile,
  listComputerDirectory,
  readGilbertProjectMemories,
  readComputerTextFile,
  resolveLocalWorkspaceRoots,
  searchComputerFiles,
  writeComputerTextFile,
} from "./files";
import type { GilbertProjectMemory } from "./files";
import { editComputerTextFile, formatPreciseCodeView } from "./editing";
import {
  formatFileCreationSummary,
  isFileCreationToolName,
  prepareFileCreationWrites,
} from "../fileCreation";
import { collectTextQualityWarnings, formatTextQualityWarnings } from "./textQuality";
import type { FileCreationToolName, FileCreationWriteResult, PreparedFileCreationWrite } from "../fileCreation";
import {
  createApiRouteFile,
  createReactNativeScreenFile,
  createSqlMigrationFile,
  createSqlSchemaFile,
  createUnitTestFile,
  formatDependencyAuditReport,
  formatEmbeddingReport,
  formatReactNativeSetupReport,
  isCodingToolName,
} from "../coding";
import type { CodingToolName, GeneratedCodingFile } from "../coding";
import { formatColorLookupResult, isColorToolName } from "../color";
import type { ColorToolName } from "../color";
import { executeGithubTool, isGithubToolName } from "../github";
import type { GithubToolName } from "../github";
import { executeWebSearchTool, isWebToolName } from "../web/webToolExecutor";

const LOCAL_TOOL_PROGRESS_ID = "local-computer-tools";
const MAX_LOCAL_TOOL_CALLS_PER_PASS = 8;
const MAX_TOOL_CALL_SCAN_CHARS: number | null = null;
const MAX_TOOL_RESULTS_CHARS: number | null = null;
const MAX_TOOL_CALL_OUTPUT_CHARS: number | null = null;
const MAX_TOOL_INPUT_PREVIEW_CHARS: number | null = null;
const DEFAULT_READ_BYTES = 16 * 1024 * 1024;

export interface LocalComputerToolExecutionPolicy {
  maxCallsPerPass: number | null;
  maxToolCallOutputChars: number | null;
  maxToolResultsChars: number | null;
  scanFromEndChars: number | null;
}

export const STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: MAX_LOCAL_TOOL_CALLS_PER_PASS,
  maxToolCallOutputChars: MAX_TOOL_CALL_OUTPUT_CHARS,
  maxToolResultsChars: MAX_TOOL_RESULTS_CHARS,
  scanFromEndChars: MAX_TOOL_CALL_SCAN_CHARS,
};

export const DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: 16,
  maxToolCallOutputChars: null,
  maxToolResultsChars: null,
  scanFromEndChars: null,
};
const DEFAULT_TERMINAL_TIMEOUT_MS = 45_000;
const MAX_TERMINAL_TIMEOUT_MS = 180_000;
const BACKGROUND_TERMINAL_PROBE_MS = 18_000;
const BACKGROUND_TERMINAL_FAST_RETURN_MS = 3_800;
const BACKGROUND_TERMINAL_MIN_READY_MS = 900;
const MAX_TERMINAL_LIVE_OUTPUT_CHARS = Number.POSITIVE_INFINITY;
const TERMINAL_TOOL_POLL_INTERVAL_MS = 120;
const DEV_SERVER_PROBE_INTERVAL_MS = 650;
const DEV_SERVER_PROBE_TIMEOUT_MS = 650;
const GILBERT_TOOL_DIRECTORY = ".gilbert/tools";
const LOCAL_PREVIEW_URL_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"<>]*)?/gi;
const LOCAL_PREVIEW_PROBE_PORTS = [5173, 5174, 3000, 3001, 4173, 4200, 4321, 5000, 5001, 8000, 8080, 8787, 1420];
const MUTATING_TOOL_NAMES = new Set<string>([
  "create_api_route",
  "create_chat_pdf",
  "create_react_native_screen",
  "create_sql_migration",
  "create_sql_schema",
  "create_tool",
  "create_unit_test",
  "delete_file",
  "edit_file",
  "github_commit_files",
  "github_create_branch",
  "github_create_pull_request",
  "inline_edit",
  "run_terminal",
  "run_tests",
  "run_tool",
  "typescript_check",
  "write_file",
]);

type LocalComputerToolName =
  | "build_index"
  | "browser_automation"
  | ColorToolName
  | CodingToolName
  | "create_tool"
  | FileCreationToolName
  | GithubToolName
  | "edit_file"
  | "list_directory"
  | "open_browser_preview"
  | "read_file"
  | "recall_context"
  | "run_subagents"
  | "run_terminal"
  | "run_tool"
  | "search_files"
  | "view_code"
  | "web_search"
  | "write_file"
  | "unknown";

interface ParsedLocalComputerToolCall {
  args: Record<string, string>;
  raw: string;
  tool: LocalComputerToolName;
}

export interface LocalComputerToolRunResult {
  approvalRequests: AgentApproval[];
  contextMessage: string;
  directAnswer?: string;
  executedCount: number;
  progress: ChatProgressItem;
  requestedCount: number;
  browserPreviewUrl?: string;
  sources: ChatSource[];
  toolCalls: ChatToolCall[];
  waitingForApproval: boolean;
}

interface LocalComputerToolCallResult {
  browserPreviewUrl?: string;
  content: string;
  directAnswer?: string;
  executed: boolean;
  sources?: ChatSource[];
  terminal?: ChatToolCall["terminal"];
}

interface TerminalToolProgress {
  output: string;
  terminal: NonNullable<ChatToolCall["terminal"]>;
}

type ToolCallUpdateHandler = (callNumber: number, toolCall: ChatToolCall) => void;
type TerminalProgressHandler = (progress: TerminalToolProgress) => void;

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

type SubagentRunHandler = (tasks: LocalSubagentTask[]) => Promise<LocalSubagentResult[]>;

export function hasLocalComputerToolCalls(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY) {
  const scanContent = limitToolCallScanContent(content, executionPolicy);
  const scanLower = scanContent.toLowerCase();

  if (!scanLower.includes("<tool_call") && !scanLower.includes("```") && !scanLower.includes('"tool"') && !scanLower.includes('"name"')) {
    return false;
  }

  return /<tool_call\b/i.test(scanContent) || /```(?:json|tool_call)?\s*(?:\{|\[)[\s\S]*?"(?:tool|name)"\s*:/i.test(scanContent);
}

export function sanitizeLocalToolCallsForDisplay(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY) {
  if (!hasLocalComputerToolCalls(content, executionPolicy)) {
    return content;
  }

  const withoutCompleteCalls = content.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, " ");
  const withoutPartialCall = withoutCompleteCalls.replace(/<tool_call\b[\s\S]*$/i, "");
  const withoutJsonCalls = withoutPartialCall
    .replace(/```(?:json|tool_call)?\s*(?:\{|\[)[\s\S]*?"(?:tool|name)"\s*:[\s\S]*?(?:\}|\])\s*```/gi, " ");
  const displayText = normalizeToolCallDisplayText(withoutJsonCalls);

  return displayText;
}

function normalizeToolCallDisplayText(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function createLocalComputerProgress(status: ChatProgressItem["status"], detail?: string): ChatProgressItem {
  return {
    detail,
    id: LOCAL_TOOL_PROGRESS_ID,
    label: "Agent tools",
    status,
  };
}

export function createLocalComputerToolCallPreviews(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY): ChatToolCall[] {
  return parseLocalComputerToolCalls(content, executionPolicy)
    .map((call, index) => ({
      detail: summarizeToolCall(call),
      id: `local-tool-preview-${index + 1}`,
      input: formatToolCallInput(call),
      label: formatToolName(call.tool),
      status: "active",
    }));
}

export async function runLocalComputerToolCalls({
  approvalDecisions,
  assistantContent,
  executionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  onToolCallUpdate,
  onRunSubagents,
  signal,
  toolSettings,
  webSearchMaxResults,
  settings,
  userPrompt,
}: {
  approvalDecisions?: Record<string, AgentApprovalDecision>;
  assistantContent: string;
  executionPolicy?: LocalComputerToolExecutionPolicy;
  onToolCallUpdate?: ToolCallUpdateHandler;
  onRunSubagents?: SubagentRunHandler;
  settings: LocalWorkspaceSettings;
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchMaxResults: number;
}): Promise<LocalComputerToolRunResult> {
  const calls = parseLocalComputerToolCalls(assistantContent, executionPolicy);
  const tools = normalizeToolRegistrySettings(toolSettings);
  const roots = await resolveLocalWorkspaceRoots(settings);
  const sections: string[] = [
    "AGENT TOOL RESULTS",
    "The app executed the requested file and web tools. Use these results as real evidence and answer normally. Do not include tool XML or tool JSON in the final answer.",
    `Requested calls: ${calls.length}`,
    `Workspace scope: ${settings.scope}`,
    `Workspace roots: ${roots.length > 0 ? roots.join(" | ") : "none"}`,
    settings.permissionMode === "read-only"
      ? "Write policy: read-only mode blocks mutating tools and terminal commands. File viewing, listing, indexing, and search are allowed."
      : settings.permissionMode === "ask-first"
      ? "Write policy: ask-first pauses mutating tools and creates approval cards with a preview."
      : settings.permissionMode === "gilbert-review"
        ? "Write policy: Gilbert review pauses mutating tools and resumes the same run after allow, deny, or edited approval."
      : settings.scope === "full-computer"
        ? "Write policy: full computer access can read and write inside the enabled drive roots."
        : "Write policy: writes may run only inside the selected/current workspace roots.",
    tools.terminal
      ? settings.permissionMode === "read-only"
        ? "Terminal policy: read-only mode blocks terminal commands."
        : settings.permissionMode === "ask-first"
        ? "Terminal policy: ask-first creates approval cards for terminal commands."
        : settings.permissionMode === "gilbert-review"
          ? "Terminal policy: Gilbert review creates approval cards for terminal commands and custom tools."
        : settings.scope === "full-computer"
          ? "Terminal policy: run_terminal, create_tool, and run_tool may run inside the enabled drive roots."
          : "Terminal policy: run_terminal, create_tool, and run_tool may run inside the selected/current workspace roots."
      : "Terminal policy: terminal tools are disabled in Toolbox.",
    tools.codeEdit || tools.fileCreation
      ? "Source edit policy: use edit_file, write_file, or create_files for source/text changes. Terminal commands that directly write source files through here-strings, Set-Content, Out-File, Tee-Object, or redirection are rejected so code edits stay structured and reviewable."
      : "",
    tools.webSearch
      ? "Web policy: web_search may run on demand for current facts, docs, debugging, source-backed answers, official API/library behavior, changelogs, error messages, brand/design facts, or color specs that are not in the local color database."
      : "Web policy: web_search is disabled in Toolbox.",
    tools.webSearch
      ? "Web verification rule: before using coding, file creation, or design/color guidance that depends on an external project, package, API, brand, or current docs, request web_search first unless local source files already provide the answer."
      : "",
    "Web evidence rule: when WEB TOOL RESULTS are present, use only those listed URLs/snippets for live web claims. If web_search returned no usable sources, say that rather than answering current facts from memory.",
    tools.sourceControl
      ? "GitHub policy: GitHub tools use the connected account in Settings through GitHub's API. Browser login requests full GitHub OAuth access, and local Git is not required. Use GitHub tools for remote repository listing, code search, branch reads, file reads, branch creation, commits, and pull requests. Repo-specific requests should inspect the named repository, not answer with a full repository inventory."
      : "GitHub policy: source control tools are disabled in Toolbox.",
    tools.sourceControl
      ? "GitHub answer format: for repository inventories, status, and branch lists, use concise Markdown bullets or numbered lists instead of pipe tables."
      : "",
    tools.colorTools
      ? "Color policy: lookup_color is available for the CSS standard named-color set plus a 30k+ MIT extended color-name database, with hex/RGB/HSL codes, aliases, special keywords, and nearest named colors. Use web_search instead for brand palettes or external design-system colors."
      : "Color policy: lookup_color is disabled in Toolbox.",
    tools.browserPreview
      ? "Browser preview policy: open_browser_preview may open a local or web HTTP(S) URL in the in-app browser. Dev-server terminal output with a localhost URL also opens the preview automatically."
      : "Browser preview policy: browser preview is disabled in Toolbox.",
  ];
  let executedCount = 0;
  let browserPreviewUrl: string | undefined;
  const sources: ChatSource[] = [];
  const toolCalls: ChatToolCall[] = [];
  const approvalRequests: AgentApproval[] = [];
  const directAnswers: string[] = [];
  let directAnswerEligible = calls.length > 0 && calls.every((call) => isDirectGithubAnswerTool(call.tool));

  if (roots.length === 0) {
    sections.push("No workspace roots are available. Local file and terminal tools will be skipped, but web_search and GitHub tools can still run.");
  }

  for (const [index, call] of calls.entries()) {
    const callNumber = index + 1;

    if (settings.permissionMode === "read-only" && needsApproval(call)) {
      const blockedOutput = "Blocked by read-only mode.";
      directAnswerEligible = false;
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\n${blockedOutput}`);
      const blockedToolCall = createToolCallRecord(call, callNumber, "skipped", blockedOutput);
      toolCalls.push(blockedToolCall);
      onToolCallUpdate?.(callNumber, blockedToolCall);
      continue;
    }

    const approvalRequest = createToolApprovalRequest(call, callNumber, settings);
    const approvalDecision = approvalRequest ? approvalDecisions?.[approvalRequest.id] : undefined;
    const executableCall = approvalDecision?.editedArgs ? applyApprovalEditedArgs(call, approvalDecision.editedArgs) : call;
    const effectiveSettings = approvalRequest && (approvalDecision?.status === "approved" || approvalDecision?.status === "edited")
      ? {
          ...settings,
          permissionMode: "full-workspace" as const,
        }
      : settings;

    if (approvalRequest && !approvalDecision) {
      directAnswerEligible = false;
      approvalRequests.push(approvalRequest);
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\nWaiting for approval: ${approvalRequest.preview ?? approvalRequest.title}`);
      const waitingToolCall = createToolCallRecord(call, callNumber, "waiting_approval", approvalRequest.preview);
      toolCalls.push(waitingToolCall);
      onToolCallUpdate?.(callNumber, waitingToolCall);
      break;
    }

    if (approvalRequest && approvalDecision?.status === "denied") {
      directAnswerEligible = false;
      const deniedOutput = approvalDecision.note ? `Denied by user: ${approvalDecision.note}` : "Denied by user.";
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\n${deniedOutput}`);
      const deniedToolCall = createToolCallRecord(call, callNumber, "skipped", deniedOutput);
      toolCalls.push(deniedToolCall);
      onToolCallUpdate?.(callNumber, deniedToolCall);
      continue;
    }

    const activeToolCall = createToolCallRecord(executableCall, callNumber, "active");
    onToolCallUpdate?.(callNumber, activeToolCall);

    try {
      throwIfAborted(signal);
      const result = await executeLocalComputerToolCall(executableCall, effectiveSettings, roots, userPrompt, webSearchMaxResults, tools, signal, (progress) => {
        onToolCallUpdate?.(
          callNumber,
          createToolCallRecord(executableCall, callNumber, "active", progress.output, progress.terminal),
        );
      }, onRunSubagents);
      executedCount += result.executed ? 1 : 0;
      browserPreviewUrl = result.browserPreviewUrl ?? browserPreviewUrl;
      sources.push(...(result.sources ?? []));
      if (result.executed && result.directAnswer && isDirectGithubAnswerTool(executableCall.tool)) {
        directAnswers.push(result.directAnswer);
      } else if (result.executed) {
        directAnswerEligible = false;
      }
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\n${result.content}`);
      const completedToolCall = createToolCallRecord(
        executableCall,
        callNumber,
        result.executed ? "complete" : "skipped",
        limitToolCallOutput(result.content, executionPolicy.maxToolCallOutputChars),
        result.terminal,
      );
      toolCalls.push(completedToolCall);
      onToolCallUpdate?.(callNumber, completedToolCall);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const detail = formatToolExecutionError(executableCall.tool, error);
      if (isDirectGithubAnswerTool(executableCall.tool)) {
        directAnswers.push(formatDirectGithubErrorAnswer(executableCall.tool, detail));
      } else {
        directAnswerEligible = false;
      }
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\nError: ${detail}`);
      const failedToolCall = createToolCallRecord(executableCall, callNumber, "error", detail);
      toolCalls.push(failedToolCall);
      onToolCallUpdate?.(callNumber, failedToolCall);
    }
  }

  const deniedCount = Math.max(calls.length - executedCount, 0);
  const waitingForApproval = approvalRequests.some((approval) => approval.status === "pending");
  const detail = waitingForApproval ? `${executedCount} ran, waiting for approval` : deniedCount > 0 ? `${executedCount} ran, ${deniedCount} blocked` : `${executedCount} ran`;

  return {
    approvalRequests,
    contextMessage: limitToolResults(sections.join("\n"), executionPolicy.maxToolResultsChars),
    directAnswer: !waitingForApproval && directAnswerEligible && directAnswers.length > 0 ? directAnswers.join("\n\n") : undefined,
    executedCount,
    progress: createLocalComputerProgress(waitingForApproval ? "pending" : "complete", detail),
    requestedCount: calls.length,
    browserPreviewUrl,
    sources: dedupeSources(sources),
    toolCalls,
    waitingForApproval,
  };
}

function createToolCallRecord(
  call: ParsedLocalComputerToolCall,
  callNumber: number,
  status: ChatToolCall["status"],
  output?: string,
  terminal?: ChatToolCall["terminal"],
): ChatToolCall {
  return {
    detail: summarizeToolCall(call),
    id: `local-tool-${callNumber}`,
    input: formatToolCallInput(call),
    label: formatToolName(call.tool),
    output,
    status,
    terminal,
  };
}

function createToolApprovalRequest(call: ParsedLocalComputerToolCall, callNumber: number, settings: LocalWorkspaceSettings): AgentApproval | null {
  if (settings.permissionMode !== "ask-first" && settings.permissionMode !== "gilbert-review") {
    return null;
  }

  if (!needsApproval(call)) {
    return null;
  }

  const now = new Date().toISOString();
  const command = firstArg(call.args, ["command", "cmd", "input"]);
  const path = firstArg(call.args, ["path", "file_path", "target_path", "directory_path", "folder_path", "file"]);
  const preview = createApprovalPreview(call);

  return {
    args: { ...call.args },
    command,
    createdAt: now,
    detail: settings.permissionMode === "ask-first"
      ? "Ask-first mode pauses the run until you approve this action."
      : "Gilbert review mode pauses mutating actions so the run can resume with your decision.",
    id: `approval-${hashApprovalInput(call.tool, call.args)}`,
    kind: approvalKindForTool(call.tool),
    path,
    preview,
    risk: approvalRiskForTool(call.tool),
    status: "pending",
    title: `Approve ${formatToolName(call.tool)}`,
    tool: call.tool,
    toolCallId: `local-tool-${callNumber}`,
  };
}

function needsApproval(call: ParsedLocalComputerToolCall) {
  if (isFileCreationToolName(call.tool)) {
    return true;
  }

  return MUTATING_TOOL_NAMES.has(call.tool);
}

function applyApprovalEditedArgs(call: ParsedLocalComputerToolCall, editedArgs: Record<string, unknown>): ParsedLocalComputerToolCall {
  return {
    ...call,
    args: Object.entries(editedArgs).reduce<Record<string, string>>((args, [key, value]) => {
      args[normalizeArgName(key)] = stringifyApprovalArg(value);
      return args;
    }, {}),
  };
}

function stringifyApprovalArg(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function createApprovalPreview(call: ParsedLocalComputerToolCall) {
  if (call.tool === "run_terminal") {
    const command = firstArg(call.args, ["command", "cmd", "input"]) ?? "";
    const workingDirectory = firstArg(call.args, ["working_directory", "cwd", "directory", "path"]);
    return [`Command: ${command}`, workingDirectory ? `Working directory: ${workingDirectory}` : undefined].filter(Boolean).join("\n");
  }

  if (call.tool === "delete_file") {
    return `Delete: ${firstArg(call.args, ["path", "file_path", "target_path"]) ?? "unknown path"}`;
  }

  if (call.tool === "edit_file" || call.tool === "inline_edit") {
    const path = firstArg(call.args, ["path", "file_path", "target_path"]) ?? "unknown path";
    const oldText = firstArg(call.args, ["old_text", "find", "search", "before"]);
    const newText = firstArg(call.args, ["new_text", "replace", "replacement", "after", "content"]);
    return [`Path: ${path}`, oldText ? `Find: ${limitInlineValue(oldText, 600)}` : undefined, newText ? `Replace with: ${limitInlineValue(newText, 600)}` : undefined]
      .filter(Boolean)
      .join("\n");
  }

  if (call.tool === "write_file") {
    const path = firstArg(call.args, ["path", "file_path", "target_path"]) ?? "unknown path";
    const content = firstArg(call.args, ["content", "text", "body"]) ?? "";
    return [`Path: ${path}`, content ? `Content preview:\n${limitInlineValue(content, 1200)}` : undefined].filter(Boolean).join("\n");
  }

  if (call.tool === "github_create_branch" || call.tool === "github_commit_files" || call.tool === "github_create_pull_request") {
    const repository = firstArg(call.args, ["repository", "repo_full_name", "full_name"]);
    const owner = firstArg(call.args, ["owner", "org", "organization"]);
    const repo = firstArg(call.args, ["repo", "repository_name", "name"]);
    const branch = firstArg(call.args, ["branch", "head", "new_branch", "newBranch"]);
    const message = firstArg(call.args, ["message", "commit_message", "commitMessage", "title"]);
    const files = firstArg(call.args, ["files_json", "files", "changes", "items", "path", "file_path", "file"]);

    return [
      `Repository: ${repository || (owner && repo ? `${owner}/${repo}` : "unknown")}`,
      branch ? `Branch: ${branch}` : undefined,
      message ? `Message: ${message}` : undefined,
      files ? `Files: ${limitInlineValue(files, 1200)}` : undefined,
    ].filter(Boolean).join("\n");
  }

  return formatToolCallInput(call);
}

function approvalKindForTool(tool: LocalComputerToolName): AgentApproval["kind"] {
  if (tool === "run_terminal" || tool === "run_tool" || tool === "run_tests" || tool === "typescript_check") {
    return "terminal";
  }

  if (tool === "delete_file") {
    return "delete";
  }

  if (tool === "edit_file" || tool === "inline_edit") {
    return "edit";
  }

  if (tool === "write_file") {
    return "write";
  }

  if (tool === "open_browser_preview") {
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

function approvalRiskForTool(tool: LocalComputerToolName): AgentApproval["risk"] {
  if (tool === "delete_file" || tool === "run_terminal" || tool === "run_tool" || tool === "create_tool" || tool === "github_commit_files") {
    return "high";
  }

  if (tool === "edit_file" || tool === "write_file" || tool === "inline_edit" || isFileCreationToolName(tool) || tool.startsWith("create_")) {
    return "medium";
  }

  return "low";
}

function hashApprovalInput(tool: LocalComputerToolName, args: Record<string, string>) {
  const raw = `${tool}:${JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]]))}`;
  let hash = 0;

  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function parseSubagentTasks(args: Record<string, string>): LocalSubagentTask[] {
  const rawTasks = firstArg(args, ["tasks_json", "tasks", "agents"]);

  if (rawTasks) {
    try {
      const parsed = JSON.parse(rawTasks) as unknown;
      const items = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : [];
      return items.flatMap((item, index) => normalizeSubagentTask(item, index));
    } catch {
      return [];
    }
  }

  const prompt = firstArg(args, ["task", "prompt", "question", "request"]);

  if (!prompt) {
    return [];
  }

  return [
    {
      id: "subagent-1",
      prompt,
      title: firstArg(args, ["title", "name"]) ?? "Sub-agent 1",
    },
  ];
}

function normalizeSubagentTask(item: unknown, index: number): LocalSubagentTask[] {
  if (typeof item === "string" && item.trim()) {
    return [
      {
        id: `subagent-${index + 1}`,
        prompt: item.trim(),
        title: `Sub-agent ${index + 1}`,
      },
    ];
  }

  if (!item || typeof item !== "object") {
    return [];
  }

  const task = item as Record<string, unknown>;
  const prompt = typeof task.prompt === "string" && task.prompt.trim()
    ? task.prompt.trim()
    : typeof task.task === "string" && task.task.trim()
      ? task.task.trim()
      : "";

  if (!prompt) {
    return [];
  }

  return [
    {
      id: typeof task.id === "string" && task.id.trim() ? task.id.trim() : `subagent-${index + 1}`,
      prompt,
      title: typeof task.title === "string" && task.title.trim() ? task.title.trim() : `Sub-agent ${index + 1}`,
    },
  ];
}

function formatSubagentResults(results: LocalSubagentResult[]) {
  return [
    "SUB-AGENT RESULTS",
    `Completed: ${results.length}`,
    ...results.map((result, index) =>
      [
        "",
        `SUB-AGENT ${index + 1}: ${result.title}`,
        result.error ? `Error: ${result.error}` : result.content,
      ].join("\n"),
    ),
  ].join("\n");
}

async function executeLocalComputerToolCall(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  userPrompt: string,
  webSearchMaxResults: number,
  toolSettings: ToolRegistrySettings,
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
  onRunSubagents?: SubagentRunHandler,
): Promise<LocalComputerToolCallResult> {
  const disabledReason = getDisabledToolReason(call.tool, toolSettings);

  if (disabledReason) {
    return {
      content: `${formatToolName(call.tool)} skipped: ${disabledReason}`,
      executed: false,
    };
  }

  switch (call.tool) {
    case "web_search": {
      const result = await executeWebSearchTool(call.args, userPrompt, webSearchMaxResults, { signal });
      return {
        content: result.content,
        executed: result.sources.length > 0,
        sources: result.sources,
      };
    }
    case "lookup_color": {
      return {
        content: await formatColorLookupResult(call.args),
        executed: true,
      };
    }
    case "github_status":
    case "github_list_repositories":
    case "github_get_repository":
    case "github_list_branches":
    case "github_list_tree":
    case "github_read_file":
    case "github_search_code":
    case "github_create_branch":
    case "github_commit_files":
    case "github_create_pull_request": {
      const result = await executeGithubTool(call.tool, call.args, { userPrompt });
      return {
        content: result.content,
        directAnswer: result.directAnswer,
        executed: result.executed,
        sources: result.sources,
      };
    }
    case "run_terminal": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeTerminalCommandTool(call, settings, roots, signal, onTerminalProgress, toolSettings);
      return {
        browserPreviewUrl: result.browserPreviewUrl,
        content: result.content,
        executed: result.executed,
        terminal: result.terminal,
      };
    }
    case "open_browser_preview": {
      const result = executeOpenBrowserPreviewTool(call);
      return {
        browserPreviewUrl: result.browserPreviewUrl,
        content: result.content,
        executed: result.executed,
      };
    }
    case "browser_automation": {
      const result = await executeBrowserAutomationTool(call);
      return {
        browserPreviewUrl: result.browserPreviewUrl,
        content: result.content,
        executed: result.executed,
      };
    }
    case "run_subagents": {
      if (!onRunSubagents) {
        return {
          content: "run_subagents skipped: no sub-agent runner is available in this app context.",
          executed: false,
        };
      }

      const tasks = parseSubagentTasks(call.args);

      if (tasks.length === 0) {
        return {
          content: "run_subagents skipped: provide tasks_json or task.",
          executed: false,
        };
      }

      const results = await onRunSubagents(tasks.slice(0, 4));

      return {
        content: formatSubagentResults(results),
        executed: results.length > 0,
      };
    }
    case "create_tool": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await createCustomTerminalTool(call, settings, roots);
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "run_tool": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await runCustomTerminalTool(call, settings, roots, signal, onTerminalProgress);
      return {
        browserPreviewUrl: result.browserPreviewUrl,
        content: result.content,
        executed: result.executed,
        terminal: result.terminal,
      };
    }
    case "create_text_file":
    case "create_markdown_file":
    case "create_code_file":
    case "create_react_file":
    case "create_html_file":
    case "create_pdf_file":
    case "create_files": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeFileCreationTool(call as ParsedLocalComputerToolCall & { tool: FileCreationToolName }, settings, roots);
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "delete_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeDeleteFileTool(call, settings, roots);
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "create_chat_pdf": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeFileCreationTool(
        {
          ...call,
          tool: "create_pdf_file",
        },
        settings,
        roots,
      );
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "check_duplicate_file":
    case "prevent_duplicate_file_create": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      return {
        content: await executeDuplicateCheckTool(call, roots),
        executed: true,
      };
    }
    case "inline_edit": {
      return await executeLocalComputerToolCall(
        {
          ...call,
          tool: "edit_file",
        },
        settings,
        roots,
        userPrompt,
        webSearchMaxResults,
        toolSettings,
        signal,
        onTerminalProgress,
      );
    }
    case "vector_embed_text": {
      const text = firstArg(call.args, ["text", "content", "query", "value"]) || userPrompt;
      return {
        content: formatEmbeddingReport(text),
        executed: true,
      };
    }
    case "vector_search": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const query = firstArg(call.args, ["query", "q", "text"]) || userPrompt;
      const limit = numberArg(call.args, ["limit"], 24);
      let results = await searchComputerFiles(query, limit, roots);

      if (results.length === 0) {
        await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit, roots);
      }

      return {
        content: formatSearchResults(query, results),
        executed: true,
      };
    }
    case "recall_context": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const query = firstArg(call.args, ["query", "q", "text"]) || userPrompt;
      const limit = numberArg(call.args, ["limit"], 18);
      const memories = await readGilbertProjectMemories(roots);
      let results = await searchComputerFiles(query, limit, roots);

      if (results.length === 0) {
        await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit, roots);
      }

      return {
        content: formatContextRecallResults(query, memories, results, limit),
        executed: true,
      };
    }
    case "run_tests":
    case "typescript_check": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeProjectCommandTool(call, settings, roots, signal, onTerminalProgress);
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "create_sql_schema":
    case "create_sql_migration":
    case "create_react_native_screen":
    case "create_unit_test":
    case "create_api_route": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeGeneratedCodingFileTool(call as ParsedLocalComputerToolCall & { tool: CodingToolName }, settings, roots);
      return {
        content: result.content,
        executed: result.executed,
      };
    }
    case "react_native_setup_check":
    case "dependency_audit":
    case "codebase_health_scan": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      return {
        content: await executeWorkspaceReportTool(call, roots),
        executed: true,
      };
    }
    case "build_index": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const summary = await buildComputerFileIndex(roots, settings.scope);
      return {
        content: [
          `Indexed entries: ${summary.entryCount}`,
          `Scanned folders: ${summary.scannedDirectories}`,
          `Skipped entries: ${summary.skippedEntries}`,
          `Capped for speed: ${summary.truncated ? "yes" : "no"}`,
          `Roots: ${summary.roots.join(" | ")}`,
        ].join("\n"),
        executed: true,
      };
    }
    case "list_directory": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "directory_path", "folder_path"]) || roots[0];
      assertReadablePath(path, roots);
      const listing = await listComputerDirectory(path, numberArg(call.args, ["limit"], 220));
      return {
        content: formatDirectoryListing(listing),
        executed: true,
      };
    }
    case "view_code":
    case "read_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);

      if (!path) {
        return {
          content: "Skipped because read_file did not include a file path.",
          executed: false,
        };
      }

      assertReadablePath(path, roots);

      const maxBytes = numberArg(call.args, ["max_bytes", "maxBytes", "bytes"], DEFAULT_READ_BYTES);
      const file = await readComputerTextFile(path, maxBytes);
      return {
        content: formatPreciseCodeView(file, call.args),
        executed: true,
      };
    }
    case "search_files": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const query = firstArg(call.args, ["query", "q", "text"]) || userPrompt;
      const limit = numberArg(call.args, ["limit"], 32);
      let results = await searchComputerFiles(query, limit, roots);

      if (results.length === 0) {
        await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit, roots);
      }

      return {
        content: formatSearchResults(query, results),
        executed: true,
      };
    }
    case "edit_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);

      if (!path) {
        return {
          content: "Skipped because edit_file did not include a file path.",
          executed: false,
        };
      }

      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Edit blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      const result = await editComputerTextFile({ args: call.args, path, roots });
      const summary = result.changed ? await buildComputerFileIndex(roots, settings.scope).catch(() => undefined) : undefined;

      return {
        content: [
          `Path: ${result.path}`,
          `Operation: ${result.operation}`,
          `Changed: ${result.changed ? "yes" : "no"}`,
          `Replacements: ${result.replacements}`,
          `Bytes written: ${result.bytesWritten}`,
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
          formatTextQualityWarnings(result.qualityWarnings),
          "",
          result.preview,
        ].join("\n"),
        executed: result.changed,
      };
    }
    case "write_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);
      const content = argValue(call.args, ["content", "text", "body"]);

      if (!path || content === undefined) {
        return {
          content: "Skipped because write_file requires both path and content.",
          executed: false,
        };
      }

      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Write blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      const result = await writeComputerTextFile(path, content, roots, {
        createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs"], false),
        overwrite: booleanArg(call.args, ["overwrite"], true),
      });
      const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

      return {
        content: [
          `Path: ${result.path}`,
          `Bytes written: ${result.bytesWritten}`,
          `Created: ${result.created ? "yes" : "no"}`,
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
          formatTextQualityWarnings(collectTextQualityWarnings(result.path, content)),
        ].join("\n"),
        executed: true,
      };
    }
    default:
      return {
        content: `Unknown local computer tool request was ignored.\nRaw request: ${call.raw.slice(0, 900)}`,
        executed: false,
      };
  }
}

async function executeTerminalCommandTool(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
  toolSettings?: ToolRegistrySettings,
) {
  const rawCommand = argValue(call.args, ["command", "cmd", "input", "script"]);

  if (!rawCommand?.trim()) {
    return {
      content: "Skipped because run_terminal requires a command.",
      executed: false,
    };
  }

  const preparedCommand = prepareTerminalCommand(rawCommand, call.args, roots);
  const { command, workingDirectory } = preparedCommand;

  if (!command.trim()) {
    return {
      content: "Skipped because run_terminal requires a command after resolving the working directory.",
      executed: false,
    };
  }

  const directFileMutationReason = getDirectFileMutationReason(command, toolSettings);

  if (directFileMutationReason) {
    return {
      content: directFileMutationReason,
      executed: false,
    };
  }

  const expensiveListingReason = getExpensiveRecursiveListingReason(command);

  if (expensiveListingReason) {
    return {
      content: expensiveListingReason,
      executed: false,
    };
  }

  const shell = terminalShellFromArgs(call.args);
  const policy = getTerminalRunPolicy(settings, roots, workingDirectory);

  if (!policy.allowed) {
    return {
      content: `Terminal command blocked: ${policy.reason}`,
      executed: false,
    };
  }

  const timeoutMs = terminalTimeoutFromArgs(call.args);
  const runInBackground = booleanArg(call.args, ["background", "persistent", "keep_alive", "keepAlive", "dev_server", "devServer"], isLikelyDevServerCommand(command));
  const result: TerminalRunCommandResponse & { sessionId?: string } = runInBackground
    ? await runTerminalCommandInBackgroundProbe({
        command,
        onProgress: onTerminalProgress,
        shell,
        signal,
        workingDirectory,
      })
    : onTerminalProgress
    ? await runTerminalCommandWithProgress({
        command,
        onProgress: onTerminalProgress,
        shell,
        signal,
        timeoutMs,
        workingDirectory,
      })
    : await runTerminalCommand({
        command,
        shell,
        timeoutMs,
        workingDirectory,
      });
  const browserPreviewUrl = findBrowserPreviewUrl(`${result.stdout}\n${result.stderr}`, {
    excludeCurrentRuntime: true,
  });
  const details = [
    runInBackground ? result.sessionId ? `Background session: running (${result.sessionId})` : "Background session: command completed before returning" : "",
    preparedCommand.rebasedFromCommand ? `Working directory resolved from command: ${workingDirectory}` : "",
    browserPreviewUrl ? `Browser preview URL: ${browserPreviewUrl}` : "",
  ].filter(Boolean).join("\n");

  return {
    browserPreviewUrl,
    content: formatTerminalRunResult(command, result, details || undefined),
    executed: true,
    terminal: createTerminalToolMetadata(command, result),
  };
}

function executeOpenBrowserPreviewTool(call: ParsedLocalComputerToolCall) {
  const rawUrl =
    firstArg(call.args, ["url", "href", "address", "target", "page"]) ??
    findBrowserPreviewUrl(argValue(call.args, ["text", "output", "content"]) ?? "", {
      excludeCurrentRuntime: true,
    });
  const browserPreviewUrl = normalizeBrowserPreviewUrl(rawUrl);

  if (!browserPreviewUrl) {
    return {
      content: "Skipped because open_browser_preview requires an http:// or https:// URL.",
      executed: false,
    };
  }

  return {
    browserPreviewUrl,
    content: `Browser preview opened: ${browserPreviewUrl}`,
    executed: true,
  };
}

async function executeBrowserAutomationTool(call: ParsedLocalComputerToolCall) {
  const rawUrl = firstArg(call.args, ["url", "href", "address", "target", "page"]);
  const url = normalizeBrowserPreviewUrl(rawUrl);

  if (!url) {
    return {
      content: "Skipped because browser_automation requires an http:// or https:// URL.",
      executed: false,
    };
  }

  if (!isTauriDesktopRuntime()) {
    return {
      browserPreviewUrl: url,
      content: "Browser automation skipped: DOM inspection is available in the Tauri desktop app. The preview URL was opened instead.",
      executed: false,
    };
  }

  const action = normalizeBrowserAutomationAction(firstArg(call.args, ["action", "operation", "mode"]));
  const text = firstArg(call.args, ["text", "label", "assert_text", "contains", "link_text"]);
  const result = await runBrowserAutomation({
    action,
    text,
    url,
  });
  const linkLines = result.links.slice(0, 12).map((link, index) => `${index + 1}. ${link.text} -> ${link.href}`);

  return {
    browserPreviewUrl: result.targetUrl ?? result.url,
    content: [
      `Browser automation action: ${result.action}`,
      `URL: ${result.url}`,
      `Status: ${result.status}`,
      result.title ? `Title: ${result.title}` : "",
      text ? `Text match: ${result.matched ? "yes" : "no"} (${text})` : "",
      result.targetUrl ? `Click target: ${result.targetUrl}` : "",
      "Visible text snippet:",
      result.textSnippet,
      linkLines.length > 0 ? "\nLinks:" : "",
      ...linkLines,
    ].filter(Boolean).join("\n"),
    executed: true,
  };
}

function normalizeBrowserAutomationAction(action?: string): "assert_text" | "click_link" | "inspect" | "open" {
  const normalizedAction = action?.trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (normalizedAction === "assert_text" || normalizedAction === "click_link" || normalizedAction === "open") {
    return normalizedAction;
  }

  return "inspect";
}

async function executeFileCreationTool(call: ParsedLocalComputerToolCall & { tool: FileCreationToolName }, settings: LocalWorkspaceSettings, roots: string[]) {
  const writes = prepareFileCreationWrites(call, roots);
  const dedupedWrites = await prepareDeduplicatedWrites(writes, roots);

  for (const write of dedupedWrites) {
    const policy = getWritePolicy(settings, roots, write.path);

    if (!policy.allowed) {
      return {
        content: `File creation blocked for ${write.path}: ${policy.reason}`,
        executed: false,
      };
    }
  }

  const results: FileCreationWriteResult[] = [];
  const qualityWarnings = dedupedWrites.flatMap((write) =>
    collectTextQualityWarnings(write.path, write.content).map((warning) => `${write.path}: ${warning}`),
  );

  for (const write of dedupedWrites) {
    const result = await writeComputerTextFile(write.path, write.content, roots, {
      createParentDirs: write.createParentDirs,
      overwrite: write.overwrite,
    });

    results.push({
      ...write,
      write: result,
    });
  }

  const indexSummary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      formatFileCreationSummary({
        indexSummary,
        results,
      }),
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: results.length > 0,
  };
}

async function executeDeleteFileTool(call: ParsedLocalComputerToolCall, settings: LocalWorkspaceSettings, roots: string[]) {
  const path = firstArg(call.args, ["path", "file_path", "file"]);

  if (!path) {
    return {
      content: "Skipped because delete_file requires a path.",
      executed: false,
    };
  }

  if (!booleanArg(call.args, ["confirm_delete", "confirmDelete", "confirm"], false)) {
    return {
      content: "Delete blocked: delete_file requires confirm_delete=true so the model cannot remove files accidentally.",
      executed: false,
    };
  }

  const writeCheck = getWritePolicy(settings, roots, path);

  if (!writeCheck.allowed) {
    return {
      content: `Delete blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  const result = await deleteComputerFile(path, roots);
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      `Path: ${result.path}`,
      `Deleted: ${result.deleted ? "yes" : "no"}`,
      `Bytes deleted: ${result.bytesDeleted}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
    ].join("\n"),
    executed: result.deleted,
  };
}

async function executeDuplicateCheckTool(call: ParsedLocalComputerToolCall, roots: string[]) {
  const paths = collectDuplicateCheckPaths(call.args, roots);
  const rows: string[] = [];

  for (const path of paths) {
    const exists = await computerPathExists(path, roots);
    rows.push(`${exists ? "exists" : "available"}: ${path}`);

    if (exists) {
      rows.push(`  suggested unique path: ${await nextUniquePath(path, roots)}`);
    }
  }

  return [`Paths checked: ${paths.length}`, ...rows].join("\n");
}

async function executeGeneratedCodingFileTool(call: ParsedLocalComputerToolCall & { tool: CodingToolName }, settings: LocalWorkspaceSettings, roots: string[]) {
  const file = createGeneratedCodingFile(call, roots);
  const writeCheck = getWritePolicy(settings, roots, file.path);

  if (!writeCheck.allowed) {
    return {
      content: `${file.description} blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  if (!file.overwrite && (await computerPathExists(file.path, roots))) {
    return {
      content: `${file.description} blocked: ${file.path} already exists. Use check_duplicate_file, choose another path, or pass overwrite=true intentionally.`,
      executed: false,
    };
  }

  const result = await writeComputerTextFile(file.path, file.content, roots, {
    createParentDirs: file.createParentDirs,
    overwrite: file.overwrite,
  });
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
  const qualityWarnings = collectTextQualityWarnings(result.path, file.content);

  return {
    content: [
      `Generated: ${file.description}`,
      `Path: ${result.path}`,
      `Created: ${result.created ? "yes" : "no"}`,
      `Bytes written: ${result.bytesWritten}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      formatTextQualityWarnings(qualityWarnings),
    ].join("\n"),
    executed: true,
  };
}

async function executeProjectCommandTool(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
) {
  const command = firstArg(call.args, ["command", "cmd", "script"]) || (call.tool === "typescript_check" ? await inferTypeScriptCommand(roots[0]) : await inferTestCommand(roots[0]));

  if (!command) {
    return {
      content: `Skipped because ${call.tool} could not infer a command. Provide command explicitly.`,
      executed: false,
    };
  }

  return await executeTerminalCommandTool(
    {
      ...call,
      args: {
        ...call.args,
        command,
        cwd: firstArg(call.args, ["cwd", "working_directory", "workingDirectory"]) || roots[0],
      },
      tool: "run_terminal",
    },
    settings,
    roots,
    signal,
    onTerminalProgress,
  );
}

async function executeWorkspaceReportTool(call: ParsedLocalComputerToolCall, roots: string[]) {
  const packageJson = await readOptionalTextFile(joinLocalPath(roots[0], ["package.json"]));

  if (call.tool === "react_native_setup_check") {
    return formatReactNativeSetupReport(packageJson);
  }

  if (call.tool === "dependency_audit") {
    return formatDependencyAuditReport(packageJson);
  }

  const rootListing = await listComputerDirectory(roots[0], 120).catch(() => undefined);
  const entries = rootListing?.entries.map((entry) => `${entry.kind}: ${entry.name}`).join("\n") || "Root listing unavailable.";

  return [
    "Codebase health scan",
    formatDependencyAuditReport(packageJson),
    "",
    "Root signals",
    entries,
    "",
    "Recommended next checks: typecheck, tests, lint, build, dependency audit, duplicate-file scan, and docs/security review.",
  ].join("\n");
}

async function createCustomTerminalTool(call: ParsedLocalComputerToolCall, settings: LocalWorkspaceSettings, roots: string[]) {
  const toolName = sanitizeCustomToolName(firstArg(call.args, ["tool_name", "name", "id"]));
  const script = argValue(call.args, ["script", "content", "body", "text"]);

  if (!toolName || script === undefined) {
    return {
      content: "Skipped because create_tool requires tool_name/name and script/content.",
      executed: false,
    };
  }

  const shell = terminalShellFromArgs(call.args);
  const toolPath = customToolPath(roots[0], toolName, shell);
  const writeCheck = getWritePolicy(settings, roots, toolPath);

  if (!writeCheck.allowed) {
    return {
      content: `Custom tool creation blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  const result = await writeComputerTextFile(toolPath, normalizeScriptText(script), roots, {
    createParentDirs: true,
    overwrite: booleanArg(call.args, ["overwrite"], true),
  });
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      `Tool: ${toolName}`,
      `Shell: ${shell === "cmd" ? "cmd" : "PowerShell"}`,
      `Path: ${result.path}`,
      `Bytes written: ${result.bytesWritten}`,
      `Created: ${result.created ? "yes" : "no"}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      "Run it with run_tool using the same tool_name.",
    ].join("\n"),
    executed: true,
  };
}

async function runCustomTerminalTool(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
) {
  const shellFromArgs = terminalShellFromArgs(call.args);
  const toolPath = await resolveCustomToolPath(call.args, roots, shellFromArgs);

  if (!toolPath) {
    return {
      content: `Skipped because run_tool could not find that custom tool under ${GILBERT_TOOL_DIRECTORY}.`,
      executed: false,
    };
  }

  const shell = toolPath.toLowerCase().endsWith(".cmd") ? "cmd" : shellFromArgs;
  const workingDirectory = resolveTerminalWorkingDirectory(call.args, roots);
  const policy = getTerminalRunPolicy(settings, roots, workingDirectory);

  if (!policy.allowed) {
    return {
      content: `Custom tool run blocked: ${policy.reason}`,
      executed: false,
    };
  }

  assertReadablePath(toolPath, roots);

  const args = argValue(call.args, ["args", "arguments", "tool_args"]) ?? "";
  const command = shell === "cmd" ? `${quoteCmd(toolPath)} ${args}`.trim() : `& ${quotePowerShell(toolPath)} ${args}`.trim();
  const timeoutMs = terminalTimeoutFromArgs(call.args);
  const result = onTerminalProgress
    ? await runTerminalCommandWithProgress({
        command,
        onProgress: onTerminalProgress,
        shell,
        signal,
        timeoutMs,
        workingDirectory,
      })
    : await runTerminalCommand({
        command,
        shell,
        timeoutMs,
        workingDirectory,
      });
  const browserPreviewUrl = findBrowserPreviewUrl(`${result.stdout}\n${result.stderr}`, {
    excludeCurrentRuntime: true,
  });
  const details = [
    `Tool path: ${toolPath}`,
    browserPreviewUrl ? `Browser preview URL: ${browserPreviewUrl}` : "",
  ].filter(Boolean).join("\n");

  return {
    browserPreviewUrl,
    content: formatTerminalRunResult(command, result, details),
    executed: true,
    terminal: createTerminalToolMetadata(command, result),
  };
}

function isDirectGithubAnswerTool(tool: LocalComputerToolName) {
  return tool === "github_status" || tool === "github_list_repositories" || tool === "github_list_branches";
}

function formatToolExecutionError(tool: LocalComputerToolName, error: unknown) {
  const detail = error instanceof Error ? error.message : "Tool execution failed.";

  if (!isGithubToolName(tool)) {
    return detail;
  }

  const lowerDetail = detail.toLowerCase();

  if (lowerDetail.includes("connect github in settings")) {
    return `${detail} Open Settings > GitHub and choose Continue with GitHub.`;
  }

  if (lowerDetail.includes("401") || lowerDetail.includes("bad credentials")) {
    return `${detail} The saved GitHub token is invalid or expired. Disconnect GitHub in Settings, then sign in with browser again.`;
  }

  if (lowerDetail.includes("403") || lowerDetail.includes("resource not accessible") || lowerDetail.includes("requires authentication")) {
    return `${detail} The account is signed in, but this token cannot read repositories. Sign in again with repo access, and approve any organization or SSO prompt GitHub shows.`;
  }

  if (lowerDetail.includes("404")) {
    return `${detail} The repository may be outside the token's allowed repository list, or the owner/name is wrong.`;
  }

  if (lowerDetail.includes("failed to fetch") || lowerDetail.includes("fetch failed") || lowerDetail.includes("network")) {
    return `${detail} The GitHub tool could not reach the desktop GitHub bridge or GitHub's API for this request. Try again, and reconnect GitHub in Settings if it keeps happening.`;
  }

  return detail;
}

function formatDirectGithubErrorAnswer(tool: LocalComputerToolName, detail: string) {
  const action =
    tool === "github_list_repositories"
      ? "list your GitHub repositories"
      : tool === "github_list_branches"
        ? "list the GitHub branches"
        : tool === "github_list_tree"
          ? "inspect the GitHub repository files"
          : tool === "github_read_file"
            ? "read the GitHub file"
        : "check GitHub";

  return [
    `I could not ${action}.`,
    "",
    `GitHub returned: ${detail}`,
    "",
    "Open **Settings > GitHub**, check that repository access works, then reconnect with **Continue with GitHub** if it still fails.",
  ].join("\n");
}

function formatToolName(tool: LocalComputerToolName) {
  const names = {
    build_index: "Build local index",
    browser_automation: "Browser automation",
    check_duplicate_file: "Check duplicate file",
    codebase_health_scan: "Codebase health scan",
    create_api_route: "Create API route",
    create_chat_pdf: "Create chat PDF",
    create_code_file: "Create code file",
    create_files: "Create files",
    create_html_file: "Create HTML file",
    create_markdown_file: "Create Markdown file",
    create_pdf_file: "Create PDF file",
    create_react_file: "Create React file",
    create_react_native_screen: "Create React Native screen",
    create_sql_migration: "Create SQL migration",
    create_sql_schema: "Create SQL schema",
    create_text_file: "Create text file",
    create_tool: "Create custom tool",
    create_unit_test: "Create unit test",
    delete_file: "Delete file",
    dependency_audit: "Dependency audit",
    edit_file: "Edit file",
    inline_edit: "Inline edit",
    list_directory: "List directory",
    lookup_color: "Color lookup",
    open_browser_preview: "Open browser preview",
    prevent_duplicate_file_create: "Prevent duplicate file create",
    read_file: "Read file",
    react_native_setup_check: "React Native setup check",
    run_subagents: "Run sub-agents",
    run_terminal: "Run terminal command",
    run_tests: "Run tests",
    run_tool: "Run custom tool",
    recall_context: "Recall context",
    search_files: "Search files",
    typescript_check: "TypeScript check",
    unknown: "Unknown tool",
    vector_embed_text: "Vector embed text",
    vector_search: "Vector search",
    view_code: "View code",
    web_search: "Web search",
    write_file: "Write file",
    github_commit_files: "GitHub commit files",
    github_create_branch: "GitHub create branch",
    github_create_pull_request: "GitHub create pull request",
    github_get_repository: "GitHub repository",
    github_list_branches: "GitHub list branches",
    github_list_repositories: "GitHub list repositories",
    github_list_tree: "GitHub list tree",
    github_read_file: "GitHub read file",
    github_search_code: "GitHub search code",
    github_status: "GitHub status",
  } satisfies Record<LocalComputerToolName, string>;

  return names[tool];
}

function summarizeToolCall(call: ParsedLocalComputerToolCall) {
  const path = firstArg(call.args, ["path", "file_path", "directory_path", "folder_path", "file"]);
  const command = firstArg(call.args, ["command", "cmd", "input"]);
  const toolName = firstArg(call.args, ["tool_name", "name"]);
  const repository = firstArg(call.args, ["repository", "repo_full_name", "full_name"]);
  const owner = firstArg(call.args, ["owner", "org", "organization"]);
  const repo = firstArg(call.args, ["repo", "repository_name"]);
  const color = firstArg(call.args, ["color", "hex", "value"]);
  const query = firstArg(call.args, ["query", "q", "search", "text"]);
  const url = firstArg(call.args, ["url", "href", "address", "target", "page"]);

  if (path) {
    return path;
  }

  if (toolName) {
    return toolName;
  }

  if (repository) {
    return repository;
  }

  if (owner && repo) {
    return `${owner}/${repo}`;
  }

  if (call.tool === "lookup_color" && color) {
    return color;
  }

  if (command) {
    return command;
  }

  if (query) {
    return query;
  }

  if (url) {
    return url;
  }

  return call.tool;
}

function formatToolCallInput(call: ParsedLocalComputerToolCall) {
  const args = Object.entries(call.args)
    .map(([key, value]) => `${key}: ${limitInlineValue(value, MAX_TOOL_INPUT_PREVIEW_CHARS)}`)
    .join("\n");

  return args || call.raw.slice(0, 900);
}

function limitToolCallOutput(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n[Tool call output truncated.]`;
}

function parseLocalComputerToolCalls(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [];
  const scanContent = limitToolCallScanContent(content, executionPolicy);
  const xmlCallRegex = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = xmlCallRegex.exec(scanContent))) {
    for (const call of parseXmlToolCalls(match[1])) {
      calls.push(call);

      if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
        break;
      }
    }

    if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
      break;
    }
  }

  if (calls.length > 0) {
    return calls;
  }

  const jsonBlockRegex = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;

  while ((match = jsonBlockRegex.exec(scanContent))) {
    const block = match[1].trim();

    if (!/"(?:tool|name)"\s*:/.test(block)) {
      continue;
    }

    for (const call of parseJsonToolCalls(block)) {
      calls.push(call);

      if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
        break;
      }
    }

    if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
      break;
    }
  }

  return calls;
}

function limitToolCallScanContent(content: string, executionPolicy: LocalComputerToolExecutionPolicy) {
  if (executionPolicy.scanFromEndChars === null || content.length <= executionPolicy.scanFromEndChars) {
    return content;
  }

  return content.slice(-executionPolicy.scanFromEndChars);
}

function parseXmlToolCalls(rawBody: string): ParsedLocalComputerToolCall[] {
  const raw = rawBody.trim();
  const jsonCalls = parseJsonToolCalls(raw);

  if (jsonCalls.length > 0) {
    return jsonCalls;
  }

  const args: Record<string, string> = {};
  const argRegex = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = argRegex.exec(raw))) {
    const key = normalizeArgName(decodeXmlEntities(match[1]));
    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }

  Object.assign(args, parseXmlArgsObject(firstXmlTagValue(raw, ["args", "arguments", "input"])));
  collectDirectXmlArgs(raw, args);

  const command = decodeXmlEntities(firstXmlTagValue(raw, ["tool", "name"]) ?? raw.match(/^([a-zA-Z0-9_.-]+)/)?.[1] ?? "");

  return [
    {
      args,
      raw,
      tool: normalizeToolName(command, args),
    },
  ];
}

function parseJsonToolCalls(rawJson: string): ParsedLocalComputerToolCall[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .map((item) => parseJsonToolCallValue(item, rawJson))
      .filter((call): call is ParsedLocalComputerToolCall => Boolean(call));
  } catch {
    return [];
  }
}

function parseJsonToolCallValue(value: unknown, raw: string): ParsedLocalComputerToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const functionCall = isRecord(value.function) ? value.function : undefined;
  const command = stringifyToolArgValue(value.tool ?? value.name ?? functionCall?.name);
  const explicitArgs = {
    ...parseToolArgsSource(value.arguments),
    ...parseToolArgsSource(value.args),
    ...parseToolArgsSource(value.input),
    ...parseToolArgsSource(functionCall?.arguments),
    ...parseToolArgsSource(functionCall?.args),
    ...parseToolArgsSource(functionCall?.input),
  };
  const args = normalizeToolArgs({
    ...collectTopLevelJsonArgs(value),
    ...explicitArgs,
  });

  return {
    args,
    raw,
    tool: normalizeToolName(command, args),
  };
}

function parseToolArgsSource(source: unknown): Record<string, unknown> {
  if (source === undefined || source === null) {
    return {};
  }

  if (Array.isArray(source)) {
    return { files_json: source };
  }

  if (isRecord(source)) {
    return source;
  }

  if (typeof source !== "string") {
    return {};
  }

  const trimmed = source.trim();

  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        return { files_json: parsed };
      }

      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return { content: source };
    }
  }

  return { content: source };
}

function normalizeToolArgs(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      const normalizedKey = normalizeArgName(key);
      return [normalizedKey, preserveArgValue(normalizedKey, stringifyToolArgValue(value))];
    }),
  );
}

function collectTopLevelJsonArgs(value: Record<string, unknown>) {
  const reservedKeys = new Set(["arguments", "args", "function", "id", "input", "name", "tool", "type"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reservedKeys.has(normalizeArgName(key))));
}

function parseXmlArgsObject(rawArgs?: string) {
  if (!rawArgs) {
    return {};
  }

  return normalizeToolArgs(parseToolArgsSource(decodeXmlEntities(rawArgs)));
}

function collectDirectXmlArgs(raw: string, args: Record<string, string>) {
  const ignoredKeys = new Set(["arg_key", "arg_value", "args", "arguments", "input", "name", "tool"]);
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);

    if (ignoredKeys.has(key) || Object.prototype.hasOwnProperty.call(args, key)) {
      continue;
    }

    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }
}

function firstXmlTagValue(raw: string, names: string[]) {
  for (const name of names) {
    const match = raw.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function stringifyToolArgValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
    .replace(/&#(\d+);/g, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolName(command: string, args: Record<string, string>): LocalComputerToolName {
  const normalized = command.toLowerCase().replace(/^computer[._-]/, "").replace(/^filesystem[._-]/, "").replace(/^local[._-]/, "");

  if (isWebToolName(normalized)) {
    return "web_search";
  }

  if (isColorToolName(normalized) || ["color", "color_lookup", "color-lookup", "lookup-color", "css_color", "css-color", "named_color", "named-color"].includes(normalized)) {
    return "lookup_color";
  }

  if (isFileCreationToolName(normalized)) {
    return normalized;
  }

  if (isCodingToolName(normalized)) {
    return normalized;
  }

  const githubToolName = normalizeGithubToolName(normalized);

  if (githubToolName) {
    return githubToolName;
  }

  if (["delete", "delete-file", "remove_file", "remove-file", "file.delete"].includes(normalized)) {
    return "delete_file";
  }

  if (["chat_pdf", "chat-pdf", "create_chat_pdf", "create-chat-pdf", "pdf_from_chat", "pdf-from-chat"].includes(normalized)) {
    return "create_chat_pdf";
  }

  if (["duplicate_check", "duplicate-check", "check_duplicate", "check-duplicate", "file.exists", "path_exists"].includes(normalized)) {
    return "check_duplicate_file";
  }

  if (["prevent_duplicate", "prevent-duplicate", "prevent_duplicate_file", "prevent-duplicate-file", "unique_file_path", "unique-file-path"].includes(normalized)) {
    return "prevent_duplicate_file_create";
  }

  if (["inline_edit", "inline-edit", "edit_inline", "edit-inline"].includes(normalized)) {
    return "inline_edit";
  }

  if (["embed", "embedding", "vector_embed", "vector-embed", "embed_text"].includes(normalized)) {
    return "vector_embed_text";
  }

  if (["semantic_search", "semantic-search", "vector_search", "vector-search"].includes(normalized)) {
    return "vector_search";
  }

  if (["recall", "recall_context", "recall-context", "context_recall", "context-recall", "memory_search", "memory-search", "context_search", "context-search", "search_context", "search-context"].includes(normalized)) {
    return "recall_context";
  }

  if (["test", "tests", "run_test", "run-test", "run-tests"].includes(normalized)) {
    return "run_tests";
  }

  if (["ts_check", "ts-check", "typecheck", "typescript", "typescript-check"].includes(normalized)) {
    return "typescript_check";
  }

  if (["sql_schema", "sql-schema", "create-schema", "database_schema", "database-schema"].includes(normalized)) {
    return "create_sql_schema";
  }

  if (["sql_migration", "sql-migration", "migration", "create-migration"].includes(normalized)) {
    return "create_sql_migration";
  }

  if (["react_native_screen", "react-native-screen", "rn_screen", "rn-screen"].includes(normalized)) {
    return "create_react_native_screen";
  }

  if (["react_native_check", "react-native-check", "rn_check", "rn-check"].includes(normalized)) {
    return "react_native_setup_check";
  }

  if (["unit_test", "unit-test", "create_test", "create-test", "generate_test", "generate-test"].includes(normalized)) {
    return "create_unit_test";
  }

  if (["health_scan", "health-scan", "code_health", "code-health", "codebase_scan", "codebase-scan"].includes(normalized)) {
    return "codebase_health_scan";
  }

  if (["audit_dependencies", "audit-dependencies", "dependency_check", "dependency-check", "deps_audit", "deps-audit"].includes(normalized)) {
    return "dependency_audit";
  }

  if (["api_route", "api-route", "create_route", "create-route"].includes(normalized)) {
    return "create_api_route";
  }

  if (["create_file", "create-file", "file.create", "file_create", "file-create", "new_file", "new-file"].includes(normalized)) {
    const kind = (args.kind ?? args.type ?? args.language ?? args.lang ?? "").toLowerCase();
    const path = (args.path ?? args.file_path ?? args.file ?? "").toLowerCase();

    if (kind.includes("pdf") || path.endsWith(".pdf")) {
      return "create_pdf_file";
    }

    if (kind.includes("react") || path.endsWith(".tsx") || path.endsWith(".jsx")) {
      return "create_react_file";
    }

    if (kind.includes("html") || path.endsWith(".html") || path.endsWith(".htm")) {
      return "create_html_file";
    }

    if (kind.includes("markdown") || kind === "md" || kind.includes("note") || path.endsWith(".md")) {
      return "create_markdown_file";
    }

    if (kind.includes("text") || kind === "txt" || path.endsWith(".txt")) {
      return "create_text_file";
    }

    return "create_code_file";
  }

  if (["create_files", "create-files", "file.create_many", "create_many_files", "create-many-files", "write_files", "write-files"].includes(normalized)) {
    return "create_files";
  }

  if (["create_text", "create-text", "create-text-file", "text_file", "text-file", "text-file-create", "txt", "note_text"].includes(normalized)) {
    return "create_text_file";
  }

  if (["create_markdown", "create-markdown", "create-markdown-file", "markdown_file", "markdown-file", "md_file", "note", "create_note", "create-note"].includes(normalized)) {
    return "create_markdown_file";
  }

  if (["create_code", "create-code", "create-code-file", "code_file", "code-file", "source_file", "source-file"].includes(normalized)) {
    return "create_code_file";
  }

  if (["create_react", "create-react", "create-react-file", "react_file", "react-file", "component_file", "component-file"].includes(normalized)) {
    return "create_react_file";
  }

  if (["create_html", "create-html", "create-html-file", "html_file", "html-file"].includes(normalized)) {
    return "create_html_file";
  }

  if (["create_pdf", "create-pdf", "create-pdf-file", "pdf_file", "pdf-file"].includes(normalized)) {
    return "create_pdf_file";
  }

  if (["open_browser_preview", "open-browser-preview", "browser_preview", "browser-preview", "open_preview", "open-preview", "preview_url", "preview-url", "show_preview", "show-preview", "open_in_browser_preview", "open-in-browser-preview"].includes(normalized)) {
    return "open_browser_preview";
  }

  if (["browser_automation", "browser-automation", "browser.inspect", "inspect_browser", "inspect-browser", "assert_browser_text", "click_link", "click-link"].includes(normalized)) {
    return "browser_automation";
  }

  if (["run_subagents", "run-subagents", "subagents", "parallel_agents", "parallel-agents", "delegate", "delegate_tasks"].includes(normalized)) {
    return "run_subagents";
  }

  if (["terminal", "terminal.run", "shell", "shell.run", "command", "command.run", "exec", "execute", "run_command", "run-command", "run_terminal", "run-terminal"].includes(normalized)) {
    return "run_terminal";
  }

  if (["create_tool", "create-tool", "make_tool", "make-tool", "save_tool", "save-tool", "tool.create", "tool_create", "tool-create"].includes(normalized)) {
    return "create_tool";
  }

  if (["run_tool", "run-tool", "custom_tool", "custom-tool", "tool.run", "execute_tool", "execute-tool"].includes(normalized)) {
    return "run_tool";
  }

  if (["index", "build_index", "build-index", "computer_build_file_index"].includes(normalized)) {
    return "build_index";
  }

  if (["ls", "list", "list_directory", "list-directory", "browse", "directory"].includes(normalized)) {
    return "list_directory";
  }

  if (["view", "view_code", "view-code", "code_view", "code-view", "show_lines", "show-lines"].includes(normalized)) {
    return "view_code";
  }

  if (["edit", "edit_file", "edit-file", "patch", "apply_patch", "apply-patch", "replace_text", "replace-text", "insert_text", "insert-text"].includes(normalized)) {
    return "edit_file";
  }

  if (["read", "read_file", "read-file", "open", "cat"].includes(normalized) || (!normalized && (args.file_path || args.file))) {
    return "read_file";
  }

  if (["search", "search_files", "search-files", "find"].includes(normalized)) {
    return "search_files";
  }

  if (["write", "write_file", "write-file", "save"].includes(normalized)) {
    return "write_file";
  }

  return "unknown";
}

function normalizeGithubToolName(command: string): GithubToolName | null {
  const normalized = command.replace(/^github[._-]/, "github_").replace(/^git[._-]/, "github_");

  if (isGithubToolName(normalized)) {
    return normalized;
  }

  if (["github", "github_status", "github_account", "source_control_status"].includes(normalized)) {
    return "github_status";
  }

  if (["github_repos", "github_repositories", "github_list_repos", "github_list_repositories", "github_repo_list", "source_control_repos"].includes(normalized)) {
    return "github_list_repositories";
  }

  if (["github_repo", "github_repository", "github_get_repo", "github_get_repository"].includes(normalized)) {
    return "github_get_repository";
  }

  if (["github_branches", "github_list_branches", "github_branch_list"].includes(normalized)) {
    return "github_list_branches";
  }

  if (["github_tree", "github_files", "github_list_files", "github_list_tree", "github_pull", "github_pull_repository", "github_pull_snapshot"].includes(normalized)) {
    return "github_list_tree";
  }

  if (["github_file", "github_read", "github_read_file", "github_view_file", "github_cat"].includes(normalized)) {
    return "github_read_file";
  }

  if (["github_search", "github_code_search", "github_search_code"].includes(normalized)) {
    return "github_search_code";
  }

  if (["github_branch", "github_create_branch", "github_new_branch"].includes(normalized)) {
    return "github_create_branch";
  }

  if (["github_commit", "github_commit_files", "github_push", "github_push_files", "github_write_files"].includes(normalized)) {
    return "github_commit_files";
  }

  if (["github_pr", "github_pull_request", "github_create_pr", "github_create_pull_request", "github_open_pr"].includes(normalized)) {
    return "github_create_pull_request";
  }

  return null;
}

function formatDirectoryListing(listing: ComputerDirectoryListing) {
  const rows = listing.entries.map((entry, index) => {
    const type = entry.kind === "directory" ? "dir" : entry.kind;
    const size = typeof entry.size === "number" ? ` ${entry.size} bytes` : "";
    return `${index + 1}. [${type}] ${entry.path}${size}`;
  });

  return [
    `Path: ${listing.path}`,
    listing.parentPath ? `Parent: ${listing.parentPath}` : "",
    `Entries returned: ${listing.entries.length}${listing.limited ? " (limited)" : ""}`,
    listing.inaccessibleEntries > 0 ? `Inaccessible entries: ${listing.inaccessibleEntries}` : "",
    ...rows,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSearchResults(query: string, results: ComputerSearchResult[]) {
  if (results.length === 0) {
    return `Query: ${query}\nNo indexed file matches were found.`;
  }

  return [
    `Query: ${query}`,
    `Matches: ${results.length}`,
    ...results.map((result, index) => {
      const kind = result.matchKind ? `/${result.matchKind}` : "";
      const line = result.line ? ` line=${result.line}` : "";
      const matches = result.matches?.length ? ` matches=${result.matches.slice(0, 8).join(",")}` : "";
      const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ").slice(0, 360)}` : "";
      return `${index + 1}. [${result.kind}${kind}] ${result.path} score=${result.score.toFixed(3)}${line}${matches}${preview}`;
    }),
  ].join("\n");
}

interface ContextRecallMemoryHit {
  line?: number;
  matches: string[];
  path: string;
  preview: string;
  score: number;
}

function formatContextRecallResults(query: string, memories: GilbertProjectMemory[], fileResults: ComputerSearchResult[], limit: number) {
  const memoryHits = searchGilbertMemory(query, memories, Math.min(8, Math.max(3, Math.floor(limit / 2))));
  const fileLines = fileResults.slice(0, limit).map((result, index) => {
    const kind = result.matchKind ? `/${result.matchKind}` : "";
    const line = result.line ? ` line=${result.line}` : "";
    const matches = result.matches?.length ? ` matches=${result.matches.slice(0, 8).join(",")}` : "";
    const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ").slice(0, 360)}` : "";
    return `${index + 1}. [${result.kind}${kind}] ${result.path} score=${result.score.toFixed(3)}${line}${matches}${preview}`;
  });
  const memoryLines = memoryHits.map((hit, index) => {
    const line = hit.line ? ` line=${hit.line}` : "";
    const matches = hit.matches.length ? ` matches=${hit.matches.slice(0, 8).join(",")}` : "";
    return `${index + 1}. [memory] ${hit.path} score=${hit.score.toFixed(3)}${line}${matches}\n   preview: ${hit.preview.replace(/\s+/g, " ").slice(0, 420)}`;
  });

  return [
    `Query: ${query}`,
    "CONTEXT RECALL RESULTS",
    "Use memory hits for project rules and prior context. Use file hits as concrete code locations to inspect with view_code before editing.",
    memoryLines.length > 0 ? "Project memory hits:" : "Project memory hits: none",
    ...memoryLines,
    fileLines.length > 0 ? "Code and file hits:" : "Code and file hits: none",
    ...fileLines,
  ].join("\n");
}

function searchGilbertMemory(query: string, memories: GilbertProjectMemory[], limit: number): ContextRecallMemoryHit[] {
  const queryLower = query.trim().toLowerCase();
  const tokens = tokenizeRecallQuery(query);

  if (!queryLower && tokens.length === 0) {
    return [];
  }

  return memories
    .map((memory) => scoreGilbertMemory(memory, queryLower, tokens))
    .filter((hit): hit is ContextRecallMemoryHit => Boolean(hit && hit.score > 0))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function scoreGilbertMemory(memory: GilbertProjectMemory, queryLower: string, tokens: string[]): ContextRecallMemoryHit | undefined {
  const contentLower = memory.content.toLowerCase();
  let score = 0;
  const matches = new Set<string>();

  if (queryLower && contentLower.includes(queryLower)) {
    score += 4;
    matches.add(queryLower);
  }

  for (const token of tokens) {
    if (memory.path.toLowerCase().includes(token)) {
      score += 1.5;
      matches.add(token);
    }

    if (contentLower.includes(token)) {
      score += 1;
      matches.add(token);
    }
  }

  const snippet = findRecallSnippet(memory.content, queryLower, tokens);

  if (snippet) {
    score += 1.25;
    snippet.matches.forEach((match) => matches.add(match));
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    line: snippet?.line,
    matches: Array.from(matches).slice(0, 10),
    path: memory.path,
    preview: snippet?.preview ?? memory.content.trim().slice(0, 420),
    score,
  } satisfies ContextRecallMemoryHit;
}

function findRecallSnippet(content: string, queryLower: string, tokens: string[]) {
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const lineLower = line.toLowerCase();
    const matches = new Set<string>();

    if (queryLower && lineLower.includes(queryLower)) {
      matches.add(queryLower);
    }

    for (const token of tokens) {
      if (lineLower.includes(token)) {
        matches.add(token);
      }
    }

    if (matches.size > 0) {
      return {
        line: index + 1,
        matches: Array.from(matches),
        preview: line.trim().slice(0, 420),
      };
    }
  }

  return undefined;
}

function tokenizeRecallQuery(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .flatMap((token) => token.split(/[_-]+/).concat(token))
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length > 1 && tokens.indexOf(token) === index);
}

function isLikelyDevServerCommand(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();

  return (
    /\b(npm(?:\.cmd)?|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b/.test(normalized) ||
    /\b(vite|next\s+dev|astro\s+dev|webpack\s+serve|expo\s+start|tauri\s+dev|cargo\s+tauri\s+dev)\b/.test(normalized)
  );
}

function findBrowserPreviewUrl(text: string, options: { excludeCurrentRuntime?: boolean } = {}) {
  const matches = text.match(LOCAL_PREVIEW_URL_REGEX) ?? [];

  for (const match of matches) {
    const normalized = normalizeBrowserPreviewUrl(match);

    if (normalized && (!options.excludeCurrentRuntime || !isCurrentRuntimePreviewUrl(normalized))) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeBrowserPreviewUrl(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim().replace(/[),.;]+$/g, "");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : isLocalPreviewInput(trimmed)
      ? `http://${trimmed}`
      : `https://${trimmed}`;

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    if (url.hostname === "0.0.0.0") {
      url.hostname = "localhost";
    }

    return url.href;
  } catch {
    return undefined;
  }
}

function isLocalPreviewInput(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized.startsWith("localhost:") ||
    normalized.startsWith("localhost/") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.0.0.1:") ||
    normalized.startsWith("127.0.0.1/") ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("0.0.0.0:") ||
    normalized.startsWith("0.0.0.0/") ||
    normalized === "[::1]" ||
    normalized.startsWith("[::1]:") ||
    normalized.startsWith("[::1]/")
  );
}

function isCurrentRuntimePreviewUrl(value: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const candidateUrl = new URL(value);
    const currentUrl = new URL(window.location.href);

    if (candidateUrl.origin === currentUrl.origin) {
      return true;
    }

    return (
      candidateUrl.protocol === currentUrl.protocol &&
      candidateUrl.port !== "" &&
      candidateUrl.port === currentUrl.port &&
      isLocalPreviewHost(candidateUrl.hostname) &&
      isLocalPreviewHost(currentUrl.hostname)
    );
  } catch {
    return false;
  }
}

function isLocalPreviewHost(hostname: string) {
  const host = hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

async function findReachableLocalPreviewUrl(command: string, output: string, signal?: AbortSignal) {
  const candidates = createLocalPreviewCandidates(command, output);

  if (candidates.length === 0) {
    return undefined;
  }

  const results = await Promise.all(candidates.map(async (url) => ((await probeLocalPreviewUrl(url, signal)) ? url : "")));
  return results.find(Boolean);
}

function createLocalPreviewCandidates(command: string, output: string) {
  const candidates = new Set<string>();
  const outputUrl = findBrowserPreviewUrl(output, {
    excludeCurrentRuntime: true,
  });

  if (outputUrl) {
    addLocalPreviewCandidate(candidates, outputUrl);
  }

  for (const port of extractLocalPreviewPorts(`${command}\n${output}`)) {
    addLocalPreviewCandidate(candidates, `http://localhost:${port}/`);
    addLocalPreviewCandidate(candidates, `http://127.0.0.1:${port}/`);
  }

  if (isLikelyDevServerCommand(command)) {
    for (const port of LOCAL_PREVIEW_PROBE_PORTS) {
      addLocalPreviewCandidate(candidates, `http://localhost:${port}/`);
    }
  }

  return [...candidates].slice(0, 18);
}

function addLocalPreviewCandidate(candidates: Set<string>, value: string) {
  const normalized = normalizeBrowserPreviewUrl(value);

  if (!normalized || isCurrentRuntimePreviewUrl(normalized)) {
    return;
  }

  candidates.add(normalized);
}

function extractLocalPreviewPorts(value: string) {
  const ports = new Set<number>();
  const patterns = [
    /\b(?:--port|-p)\s+(\d{2,5})\b/gi,
    /\bPORT\s*=\s*(\d{2,5})\b/gi,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const port = Number.parseInt(match[1], 10);

      if (Number.isInteger(port) && port > 0 && port <= 65535) {
        ports.add(port);
      }
    }
  }

  return [...ports];
}

async function probeLocalPreviewUrl(url: string, signal?: AbortSignal) {
  throwIfAborted(signal);

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeoutId = window.setTimeout(abort, DEV_SERVER_PROBE_TIMEOUT_MS);
  signal?.addEventListener("abort", abort, { once: true });

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });

    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

function isDevServerStillStartingOutput(output: string) {
  if (!output.trim()) {
    return false;
  }

  return /\b(starting|building|bundling|compiling|optimizing|transforming|pre-bundling|waiting|watching)\b/i.test(output);
}

async function runTerminalCommandInBackgroundProbe({
  command,
  onProgress,
  shell,
  signal,
  workingDirectory,
}: {
  command: string;
  onProgress?: TerminalProgressHandler;
  shell: TerminalShellId;
  signal?: AbortSignal;
  workingDirectory: string;
}): Promise<TerminalRunCommandResponse & { sessionId?: string }> {
  const startedAt = Date.now();
  const session = await createTerminalSession({ shell, workingDirectory });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transcript: string[] = [];
  let capturedResultOutputChars = 0;
  let capturedTranscriptChars = 0;
  let exitCode: number | null = null;
  let outputTruncated = false;
  let completed = false;
  let browserPreviewUrl: string | undefined;
  let lastDevServerProbeAt = 0;

  const appendTerminalText = (target: string[], text: string, capturedChars: number) => {
    if (!text || outputTruncated) {
      return capturedChars;
    }

    const remainingChars = MAX_TERMINAL_LIVE_OUTPUT_CHARS - capturedChars;

    if (remainingChars <= 0) {
      outputTruncated = true;
      target.push("\n[output limit reached; background command left running]\n");
      return capturedChars;
    }

    const nextText = text.length > remainingChars ? text.slice(0, remainingChars) : text;
    target.push(nextText);

    if (nextText.length < text.length) {
      outputTruncated = true;
      target.push("\n[output limit reached; background command left running]\n");
    }

    return capturedChars + nextText.length;
  };

  const appendChunks = (chunks: TerminalOutputChunk[]) => {
    for (const chunk of chunks) {
      if (chunk.stream === "stdout") {
        capturedResultOutputChars = appendTerminalText(stdout, chunk.text, capturedResultOutputChars);
      } else if (chunk.stream === "stderr") {
        capturedResultOutputChars = appendTerminalText(stderr, chunk.text, capturedResultOutputChars);
      }

      capturedTranscriptChars = appendTerminalText(transcript, formatTerminalTranscriptChunk(chunk), capturedTranscriptChars);
    }
  };

  const emitProgress = () => {
    onProgress?.({
      output: formatTerminalLiveOutput({
        command,
        outputTruncated,
        shell,
        timedOut: false,
        transcript: transcript.join(""),
        workingDirectory: session.workingDirectory,
      }),
      terminal: {
        command,
        exitCode,
        live: !completed,
        outputTruncated,
        shell,
        timedOut: false,
        workingDirectory: session.workingDirectory,
      },
    });
  };

  appendChunks(session.initialOutput);
  emitProgress();

  try {
    throwIfAborted(signal);
    await writeTerminalSession(session.sessionId, command);

    while (Date.now() - startedAt < BACKGROUND_TERMINAL_PROBE_MS) {
      throwIfAborted(signal);
      await sleep(TERMINAL_TOOL_POLL_INTERVAL_MS);

      const drain = await drainTerminalSession(session.sessionId);
      appendChunks(drain.chunks);
      const combinedOutput = `${stdout.join("")}\n${stderr.join("")}`;
      const elapsedMs = Date.now() - startedAt;

      if (drain.lastCommandCompleted) {
        completed = true;
        exitCode = drain.lastCommandExitCode ?? null;
        break;
      }

      browserPreviewUrl =
        findBrowserPreviewUrl(combinedOutput, {
          excludeCurrentRuntime: true,
        }) ?? browserPreviewUrl;

      if (!browserPreviewUrl && elapsedMs - lastDevServerProbeAt >= DEV_SERVER_PROBE_INTERVAL_MS) {
        lastDevServerProbeAt = elapsedMs;
        browserPreviewUrl = await findReachableLocalPreviewUrl(command, combinedOutput, signal);

        if (browserPreviewUrl) {
          capturedResultOutputChars = appendTerminalText(stdout, `\nDetected local dev server: ${browserPreviewUrl}\n`, capturedResultOutputChars);
          capturedTranscriptChars = appendTerminalText(transcript, `[system] Detected local dev server: ${browserPreviewUrl}\n`, capturedTranscriptChars);
        }
      }

      emitProgress();

      if (browserPreviewUrl && elapsedMs >= BACKGROUND_TERMINAL_MIN_READY_MS) {
        break;
      }

      if (elapsedMs >= BACKGROUND_TERMINAL_FAST_RETURN_MS && !isDevServerStillStartingOutput(combinedOutput)) {
        break;
      }
    }
  } catch (error) {
    await killTerminalSession(session.sessionId).catch(() => undefined);
    throw error;
  }

  if (completed) {
    await killTerminalSession(session.sessionId).catch(() => undefined);
  } else {
    appendChunks([
      {
        id: `background-${Date.now()}`,
        stream: "system",
        text: `Background command is still running after ${Date.now() - startedAt} ms.`,
        timestamp: Date.now(),
      },
    ]);
  }

  emitProgress();

  return {
    durationMs: Date.now() - startedAt,
    exitCode,
    outputTruncated,
    sessionId: completed ? undefined : session.sessionId,
    shell,
    stderr: stderr.join(""),
    stdout: stdout.join(""),
    timedOut: false,
    workingDirectory: session.workingDirectory,
  };
}

async function runTerminalCommandWithProgress({
  command,
  onProgress,
  shell,
  signal,
  timeoutMs,
  workingDirectory,
}: {
  command: string;
  onProgress: TerminalProgressHandler;
  shell: TerminalShellId;
  signal?: AbortSignal;
  timeoutMs: number;
  workingDirectory: string;
}): Promise<TerminalRunCommandResponse> {
  const startedAt = Date.now();
  const session = await createTerminalSession({ shell, workingDirectory });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transcript: string[] = [];
  let capturedResultOutputChars = 0;
  let capturedTranscriptChars = 0;
  let exitCode: number | null = null;
  let outputTruncated = false;
  let timedOut = false;

  const appendChunks = (chunks: TerminalOutputChunk[]) => {
    for (const chunk of chunks) {
      if (chunk.stream === "stdout") {
        capturedResultOutputChars = appendTerminalText(stdout, chunk.text, capturedResultOutputChars);
      } else if (chunk.stream === "stderr") {
        capturedResultOutputChars = appendTerminalText(stderr, chunk.text, capturedResultOutputChars);
      }

      capturedTranscriptChars = appendTerminalText(transcript, formatTerminalTranscriptChunk(chunk), capturedTranscriptChars);
    }
  };

  const appendTerminalText = (target: string[], text: string, capturedChars: number) => {
    if (!text || outputTruncated) {
      return capturedChars;
    }

    const remainingChars = MAX_TERMINAL_LIVE_OUTPUT_CHARS - capturedChars;

    if (remainingChars <= 0) {
      outputTruncated = true;
      target.push("\n[output limit reached; command stopped]\n");
      return capturedChars;
    }

    const nextText = text.length > remainingChars ? text.slice(0, remainingChars) : text;
    target.push(nextText);
    const nextCapturedChars = capturedChars + nextText.length;

    if (nextText.length < text.length) {
      outputTruncated = true;
      target.push("\n[output limit reached; command stopped]\n");
    }

    return nextCapturedChars;
  };

  const emitProgress = () => {
    onProgress({
      output: formatTerminalLiveOutput({
        command,
        outputTruncated,
        shell,
        timedOut,
        transcript: transcript.join(""),
        workingDirectory: session.workingDirectory,
      }),
      terminal: {
        command,
        live: !timedOut,
        outputTruncated,
        shell,
        timedOut,
        workingDirectory: session.workingDirectory,
      },
    });
  };

  appendChunks(session.initialOutput);
  emitProgress();

  try {
    throwIfAborted(signal);
    await writeTerminalSession(session.sessionId, command);

    while (true) {
      throwIfAborted(signal);

      if (Date.now() - startedAt >= timeoutMs) {
        timedOut = true;
        capturedTranscriptChars = appendTerminalText(transcript, `\n[command timed out after ${timeoutMs} ms]\n`, capturedTranscriptChars);
        emitProgress();
        await killTerminalSession(session.sessionId).catch(() => undefined);
        break;
      }

      await sleep(TERMINAL_TOOL_POLL_INTERVAL_MS);
      const drain = await drainTerminalSession(session.sessionId);
      appendChunks(drain.chunks);

      if (outputTruncated) {
        await killTerminalSession(session.sessionId).catch(() => undefined);
        emitProgress();
        break;
      }

      emitProgress();

      if (drain.lastCommandCompleted) {
        exitCode = drain.lastCommandExitCode ?? null;
        break;
      }
    }
  } catch (error) {
    await killTerminalSession(session.sessionId).catch(() => undefined);
    throw error;
  }

  await killTerminalSession(session.sessionId).catch(() => undefined);

  return {
    durationMs: Date.now() - startedAt,
    exitCode,
    outputTruncated,
    shell,
    stderr: stderr.join(""),
    stdout: stdout.join(""),
    timedOut,
    workingDirectory: session.workingDirectory,
  };
}

function formatTerminalLiveOutput({
  command,
  outputTruncated,
  shell,
  timedOut,
  transcript,
  workingDirectory,
}: {
  command: string;
  outputTruncated: boolean;
  shell: TerminalShellId;
  timedOut: boolean;
  transcript: string;
  workingDirectory: string;
}) {
  return [
    `Command: ${command}`,
    `Shell: ${shell === "cmd" ? "cmd" : "PowerShell"}`,
    `Working directory: ${workingDirectory}`,
    outputTruncated ? "Output truncated: yes" : "",
    timedOut ? "Timed out: yes" : "",
    "",
    transcript.trimEnd() || "Waiting for terminal output...",
  ]
    .filter((line, index) => index === 5 || Boolean(line))
    .join("\n");
}

function formatTerminalTranscriptChunk(chunk: TerminalOutputChunk) {
  if (chunk.stream === "stderr") {
    return `[stderr] ${chunk.text}`;
  }

  if (chunk.stream === "system") {
    return `[system] ${chunk.text}`;
  }

  return chunk.text;
}

function createTerminalToolMetadata(command: string, result: TerminalRunCommandResponse & { sessionId?: string }): ChatToolCall["terminal"] {
  return {
    command,
    exitCode: result.exitCode,
    live: Boolean(result.sessionId && result.exitCode === null && !result.timedOut),
    outputTruncated: result.outputTruncated,
    shell: result.shell,
    timedOut: result.timedOut,
    workingDirectory: result.workingDirectory,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatTerminalRunResult(command: string, result: TerminalRunCommandResponse, extraDetail?: string) {
  return [
    `Command: ${command}`,
    `Shell: ${result.shell === "cmd" ? "cmd" : "PowerShell"}`,
    `Working directory: ${result.workingDirectory}`,
    `Exit code: ${result.exitCode ?? "none"}`,
    `Timed out: ${result.timedOut ? "yes" : "no"}`,
    `Output truncated: ${result.outputTruncated ? "yes" : "no"}`,
    `Duration: ${result.durationMs} ms`,
    extraDetail ?? "",
    formatTerminalStream("STDOUT", result.stdout),
    formatTerminalStream("STDERR", result.stderr),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTerminalStream(label: string, content: string) {
  const normalized = content.replace(/\r\n/g, "\n").trimEnd();

  if (!normalized) {
    return `${label}: <empty>`;
  }

  return `${label}\n${limitToolResultBlock(normalized, null)}`;
}

function terminalShellFromArgs(args: Record<string, string>): TerminalShellId {
  const shell = (firstArg(args, ["shell", "terminal_shell"]) ?? "").toLowerCase();

  return shell.includes("cmd") ? "cmd" : "powershell";
}

function terminalTimeoutFromArgs(args: Record<string, string>) {
  const seconds = optionalNumberArg(args, ["timeout_seconds", "timeoutSeconds", "seconds"]);
  const milliseconds = optionalNumberArg(args, ["timeout_ms", "timeoutMs", "milliseconds"]);
  return clamp(milliseconds ?? (seconds === undefined ? DEFAULT_TERMINAL_TIMEOUT_MS : seconds * 1000), 1_000, MAX_TERMINAL_TIMEOUT_MS);
}

function getDirectFileMutationReason(command: string, settings?: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);

  if (!tools.codeEdit && !tools.fileCreation) {
    return null;
  }

  const normalized = command.replace(/\r\n/g, "\n");
  const directWritePatterns = [
    /\b(?:set-content|add-content)\b/i,
    /\b(?:out-file|tee-object)\b[\s\S]*\.(?:css|scss|sass|less|ts|tsx|js|jsx|json|html|md|rs|toml|yaml|yml|xml|sql|kt|java|py|txt)\b/i,
    /\[(?:system\.)?io\.file\]::(?:writealltext|appendalltext|writealllines)\b/i,
    /@['"][\s\S]*?['"]@\s*\|\s*(?:set-content|add-content|out-file)\b/i,
    /(?:^|[\s&|;])(?:echo|type|cat)\b[\s\S]*?>{1,2}\s*["']?[^"'\r\n]+\.(?:css|scss|sass|less|ts|tsx|js|jsx|json|html|md|rs|toml|yaml|yml|xml|sql|kt|java|py|txt)\b/i,
  ];

  if (!directWritePatterns.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return [
    "Skipped terminal command: it appears to write or edit source/text files through the shell.",
    "Use view_code plus edit_file/write_file/create_files for source edits, then use run_terminal for tests, builds, package installs, formatters, or command evidence.",
    "This prevents stale shell-generated content, here-string quoting mistakes, and typo carryover during code edits.",
  ].join("\n");
}

function getExpensiveRecursiveListingReason(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  const usesRecursiveFileListing = /\b(get-childitem|gci|dir)\b/.test(normalized) && /\s-recurse\b/.test(normalized) && /\s-file\b/.test(normalized);
  const dumpsFullNames = /\|\s*(select-object|select)\s+fullname\b/.test(normalized) || /\|\s*(select-object|select)\s+.*\bfullname\b/.test(normalized);
  const hasExplicitBound =
    /\s-depth\s+\d+\b/.test(normalized) ||
    /\s-filter\s+\S+/.test(normalized) ||
    /\s-include\s+\S+/.test(normalized) ||
    /\s-exclude\s+\S+/.test(normalized) ||
    /\|\s*(select-object|select)\s+-first\s+\d+\b/.test(normalized);

  if (!usesRecursiveFileListing || !dumpsFullNames || hasExplicitBound) {
    return null;
  }

  return [
    "Skipped terminal command: this recursively dumps every file path in the workspace, which is slow for Android projects and can flood the app terminal.",
    "Use list_directory, search_files, or build_index for app-side file discovery.",
    "If a shell listing is truly needed, add a bound such as -LiteralPath, -Depth, -Filter, -Exclude, or `| Select-Object -First 200 FullName`.",
  ].join("\n");
}

function prepareTerminalCommand(rawCommand: string, args: Record<string, string>, roots: string[]) {
  const fallbackWorkingDirectory = resolveTerminalWorkingDirectory(args, roots);
  const leadingCd = extractLeadingCdCommand(rawCommand, fallbackWorkingDirectory);

  if (!leadingCd) {
    return {
      command: rawCommand.trim(),
      rebasedFromCommand: false,
      workingDirectory: fallbackWorkingDirectory,
    };
  }

  return {
    command: leadingCd.command,
    rebasedFromCommand: true,
    workingDirectory: leadingCd.workingDirectory,
  };
}

function extractLeadingCdCommand(command: string, baseWorkingDirectory: string) {
  const match = command.match(/^\s*(?:cd|chdir|set-location)\s+(?:(?:\/d|-path)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&]+))\s*(?:&&|;|&)\s*([\s\S]+)$/i);

  if (!match) {
    return null;
  }

  const rawPath = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  const rest = (match[4] ?? "").trim();
  const workingDirectory = resolveTerminalDirectoryPath(rawPath, baseWorkingDirectory);

  if (!rawPath || !rest || !workingDirectory) {
    return null;
  }

  return {
    command: rest,
    workingDirectory,
  };
}

function resolveTerminalDirectoryPath(path: string, baseWorkingDirectory: string) {
  const normalizedPath = path.trim();

  if (!normalizedPath || normalizedPath === ".") {
    return baseWorkingDirectory;
  }

  if (isAbsoluteLocalPath(normalizedPath)) {
    return normalizedPath;
  }

  const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);

  if (parts.includes("..")) {
    return null;
  }

  return joinLocalPath(baseWorkingDirectory, parts);
}

function isAbsoluteLocalPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//") || path.startsWith("/");
}

function resolveTerminalWorkingDirectory(args: Record<string, string>, roots: string[]) {
  return firstArg(args, ["cwd", "working_directory", "workingDirectory", "directory_path", "folder_path"]) || roots[0];
}

function getTerminalRunPolicy(settings: LocalWorkspaceSettings, roots: string[], workingDirectory: string) {
  if (!isTauriDesktopRuntime()) {
    return {
      allowed: false,
      reason: "terminal tools are available only in the Tauri desktop app.",
    };
  }

  if (settings.permissionMode === "read-only") {
    return {
      allowed: false,
      reason: "Read only mode blocks terminal commands.",
    };
  }

  if (settings.permissionMode === "ask-first") {
    return {
      allowed: false,
      reason: "Ask first mode needs explicit user confirmation before running terminal commands.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(workingDirectory, root))) {
    return {
      allowed: false,
      reason: "the working directory is outside the enabled local workspace roots.",
    };
  }

  return {
    allowed: true,
  };
}

function sanitizeCustomToolName(value?: string) {
  const safeName = (value ?? "")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!safeName || safeName === "." || safeName === ".." || safeName.startsWith(".")) {
    return "";
  }

  return safeName;
}

function customToolPath(root: string, toolName: string, shell: TerminalShellId) {
  return joinLocalPath(root, [".gilbert", "tools", `${toolName}.${shell === "cmd" ? "cmd" : "ps1"}`]);
}

async function resolveCustomToolPath(args: Record<string, string>, roots: string[], shell: TerminalShellId) {
  const explicitPath = firstArg(args, ["path", "file_path", "tool_path"]);

  if (explicitPath) {
    return explicitPath;
  }

  const toolName = sanitizeCustomToolName(firstArg(args, ["tool_name", "name", "id"]));

  if (!toolName) {
    return "";
  }

  const candidateShells: TerminalShellId[] = shell === "cmd" ? ["cmd", "powershell"] : ["powershell", "cmd"];

  for (const root of roots) {
    for (const candidateShell of candidateShells) {
      const candidate = customToolPath(root, toolName, candidateShell);

      try {
        await readComputerTextFile(candidate, 512);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return "";
}

function normalizeScriptText(script: string) {
  return script.replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
}

function quotePowerShell(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteCmd(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function joinLocalPath(root: string, parts: string[]) {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""))].join(separator);
}

async function prepareDeduplicatedWrites(writes: PreparedFileCreationWrite[], roots: string[]) {
  const nextWrites: PreparedFileCreationWrite[] = [];
  const plannedPaths = new Set<string>();

  for (const write of writes) {
    const key = normalizeComparablePath(write.path);

    if (plannedPaths.has(key)) {
      if (write.duplicateStrategy === "skip") {
        continue;
      }

      if (write.duplicateStrategy !== "increment") {
        throw new Error(`Duplicate file creation blocked: ${write.path} is repeated in the same batch.`);
      }
    }

    if (!write.overwrite && (plannedPaths.has(key) || (await computerPathExists(write.path, roots)))) {
      if (write.duplicateStrategy === "skip") {
        continue;
      }

      if (write.duplicateStrategy === "increment") {
        const uniquePath = await nextUniquePath(write.path, roots, plannedPaths);
        nextWrites.push({
          ...write,
          path: uniquePath,
        });
        plannedPaths.add(normalizeComparablePath(uniquePath));
        continue;
      }

      throw new Error(`Duplicate file creation blocked: ${write.path} already exists. Use duplicate_strategy=increment, duplicate_strategy=skip, or overwrite=true.`);
    }

    nextWrites.push(write);
    plannedPaths.add(key);
  }

  if (nextWrites.length === 0) {
    throw new Error("No files were created because every requested path was skipped by duplicate prevention.");
  }

  return nextWrites;
}

function collectDuplicateCheckPaths(args: Record<string, string>, roots: string[]) {
  const filesJson = argValue(args, ["files_json", "files", "manifest", "items"]);

  if (filesJson) {
    try {
      const parsed = JSON.parse(filesJson) as unknown;
      const files = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed && Array.isArray((parsed as { files?: unknown }).files)
          ? (parsed as { files: unknown[] }).files
          : [];
      const paths = files
        .map((file) => (typeof file === "object" && file ? String((file as { path?: unknown; file_path?: unknown; filePath?: unknown; file?: unknown }).path ?? (file as { file_path?: unknown }).file_path ?? (file as { filePath?: unknown }).filePath ?? (file as { file?: unknown }).file ?? "") : ""))
        .filter(Boolean);

      if (paths.length > 0) {
        return paths;
      }
    } catch {
      return [filesJson];
    }
  }

  const path = firstArg(args, ["path", "file_path", "file"]);

  if (path) {
    return [path];
  }

  const title = firstArg(args, ["title", "name"]) || "untitled";
  const extension = (firstArg(args, ["extension", "ext", "language"]) || "txt").replace(/^\./, "");
  return [joinLocalPath(firstArg(args, ["directory_path", "folder_path", "directory", "folder"]) || roots[0], [`${title.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.${extension}`])];
}

async function computerPathExists(path: string, roots: string[]) {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    return false;
  }

  try {
    const listing = await listComputerDirectory(directoryName(path), 2_000);
    const name = baseName(path).toLowerCase();
    return listing.entries.some((entry) => entry.name.toLowerCase() === name);
  } catch {
    return false;
  }
}

async function nextUniquePath(path: string, roots: string[], plannedPaths = new Set<string>()) {
  const directory = directoryName(path);
  const name = baseName(path);
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = joinLocalPath(directory, [`${stem}-${index}${extension}`]);
    const key = normalizeComparablePath(candidate);

    if (!plannedPaths.has(key) && !(await computerPathExists(candidate, roots))) {
      return candidate;
    }
  }

  throw new Error(`Could not find a unique file path for ${path}.`);
}

function createGeneratedCodingFile(call: ParsedLocalComputerToolCall & { tool: CodingToolName }, roots: string[]): GeneratedCodingFile {
  const file =
    call.tool === "create_sql_schema"
      ? createSqlSchemaFile(call.args, roots)
      : call.tool === "create_sql_migration"
        ? createSqlMigrationFile(call.args, roots)
        : call.tool === "create_react_native_screen"
          ? createReactNativeScreenFile(call.args, roots)
          : call.tool === "create_unit_test"
            ? createUnitTestFile(call.args, roots)
            : createApiRouteFile(call.args, roots);

  return {
    ...file,
    overwrite: booleanArg(call.args, ["overwrite"], file.overwrite),
  };
}

async function inferTestCommand(root: string) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.test && !packageJson.scripts.test.includes("no test specified")) {
    return "npm.cmd test";
  }

  if (packageJson?.scripts?.["test:unit"]) {
    return "npm.cmd run test:unit";
  }

  if (await textFileExists(joinLocalPath(root, ["Cargo.toml"]))) {
    return "cargo test";
  }

  if (await textFileExists(joinLocalPath(root, ["gradlew.bat"]))) {
    return ".\\gradlew.bat test";
  }

  return "";
}

async function inferTypeScriptCommand(root: string) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.typecheck) {
    return "npm.cmd run typecheck";
  }

  if (packageJson?.scripts?.["tsc"]) {
    return "npm.cmd run tsc";
  }

  if (await textFileExists(joinLocalPath(root, ["tsconfig.json"]))) {
    return "node_modules\\.bin\\tsc.cmd --noEmit";
  }

  return "";
}

async function readPackageJson(root: string) {
  const content = await readOptionalTextFile(joinLocalPath(root, ["package.json"]));

  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as { scripts?: Record<string, string> };
  } catch {
    return undefined;
  }
}

async function readOptionalTextFile(path: string) {
  try {
    return (await readComputerTextFile(path, 192 * 1024)).content;
  } catch {
    return undefined;
  }
}

async function textFileExists(path: string) {
  try {
    await readComputerTextFile(path, 512);
    return true;
  } catch {
    return false;
  }
}

function directoryName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index > 0 ? path.slice(0, index) : ".";
}

function baseName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index >= 0 ? path.slice(index + 1) : path;
}

function getWritePolicy(settings: LocalWorkspaceSettings, roots: string[], path: string) {
  if (settings.permissionMode === "read-only") {
    return {
      allowed: false,
      reason: "Read only mode blocks file changes.",
    };
  }

  if (settings.permissionMode === "ask-first") {
    return {
      allowed: false,
      reason: "Ask first mode needs explicit user confirmation before writing.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    return {
      allowed: false,
      reason: "the target path is outside the enabled local workspace roots.",
    };
  }

  return {
    allowed: true,
  };
}

function getDisabledToolReason(tool: LocalComputerToolName, settings: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);

  if (tool === "web_search" && !tools.webSearch) {
    return "web_search is disabled in Toolbox.";
  }

  if (isGithubToolName(tool) && !tools.sourceControl) {
    return "GitHub source control is disabled in Toolbox.";
  }

  if (tool === "lookup_color" && !tools.colorTools) {
    return "color lookup is disabled in Toolbox.";
  }

  if ((tool === "run_terminal" || tool === "run_tool") && !tools.terminal) {
    return "terminal is disabled in Toolbox.";
  }

  if ((tool === "open_browser_preview" || tool === "browser_automation") && !tools.browserPreview) {
    return "browser preview is disabled in Toolbox.";
  }

  if ((tool === "run_tests" || tool === "typescript_check") && !tools.terminal) {
    return `${formatToolName(tool)} needs Terminal enabled in Toolbox.`;
  }

  if (isFileCreationToolName(tool) && !tools.fileCreation) {
    return "file creation is disabled in Toolbox.";
  }

  if ((tool === "delete_file" || tool === "check_duplicate_file" || tool === "prevent_duplicate_file_create") && !tools.fileSafety) {
    return "file safety tools are disabled in Toolbox.";
  }

  if (tool === "create_chat_pdf" && !tools.pdfTools) {
    return "PDF tools are disabled in Toolbox.";
  }

  if ((tool === "create_sql_schema" || tool === "create_sql_migration") && !tools.sqlTools) {
    return "SQL tools are disabled in Toolbox.";
  }

  if ((tool === "create_react_native_screen" || tool === "react_native_setup_check") && !tools.reactNativeTools) {
    return "React Native tools are disabled in Toolbox.";
  }

  if ((tool === "run_tests" || tool === "create_unit_test") && !tools.testingTools) {
    return "testing tools are disabled in Toolbox.";
  }

  if (tool === "typescript_check" && !tools.typescriptTools) {
    return "TypeScript tools are disabled in Toolbox.";
  }

  if ((tool === "vector_embed_text" || tool === "vector_search") && !tools.vectorTools) {
    return "vector tools are disabled in Toolbox.";
  }

  if ((tool === "create_api_route" || tool === "codebase_health_scan" || tool === "dependency_audit") && !tools.codeGeneration) {
    return "coding utility tools are disabled in Toolbox.";
  }

  if (tool === "inline_edit" && !tools.codeEdit) {
    return "code editing is disabled in Toolbox.";
  }

  if (tool === "create_tool" && (!tools.terminal || !tools.codeEdit)) {
    return "custom tool creation needs Terminal and Code Editor enabled in Toolbox.";
  }

  if ((tool === "recall_context" || tool === "search_files") && !tools.fileSearch) {
    return "file search is disabled in Toolbox.";
  }

  if ((tool === "build_index" || tool === "list_directory") && !tools.fileBrowser) {
    return "local file browsing is disabled in Toolbox.";
  }

  if ((tool === "read_file" || tool === "view_code") && !tools.codeView) {
    return "code viewing is disabled in Toolbox.";
  }

  if ((tool === "edit_file" || tool === "write_file") && !tools.codeEdit) {
    return "code editing is disabled in Toolbox.";
  }

  return "";
}

function assertReadablePath(path: string, roots: string[]) {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("That path is outside the enabled local workspace roots.");
  }
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = argValue(args, [name]);

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const value = optionalNumberArg(args, names);
  return value === undefined ? fallback : value;
}

function optionalNumberArg(args: Record<string, string>, names: string[]) {
  const rawValue = argValue(args, names);

  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const value = argValue(args, names);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function skipNoRoots() {
  return {
    content: "Skipped because no local workspace roots are selected.",
    executed: false,
  };
}

function argValue(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

function preserveArgValue(key: string, value: string) {
  if (["body", "code", "content", "files_json", "items", "manifest", "markdown", "migration", "new_text", "old_text", "replacement", "schema", "sql", "test", "text", "tsx"].includes(key)) {
    return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  }

  return value.trim();
}

function limitInlineValue(value: string, limit: number | null) {
  if (limit === null || !Number.isFinite(limit) || value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}... [truncated]`;
}

function dedupeSources(sources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const deduped: ChatSource[] = [];

  for (const source of sources) {
    if (seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    deduped.push(source);
  }

  return deduped;
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function hasReachedToolCallLimit(callCount: number, maxCallsPerPass: number | null) {
  return maxCallsPerPass !== null && callCount >= maxCallsPerPass;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function limitToolResults(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n[Local computer tool results truncated for speed.]`;
}

function limitToolResultBlock(content: string, limit: number | null) {
  if (limit === null || !Number.isFinite(limit) || content.length <= limit) {
    return content;
  }

  return `${content.slice(0, limit)}\n[Output truncated.]`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
