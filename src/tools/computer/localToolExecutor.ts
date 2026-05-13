import type { ChatArtifact, ChatProgressItem, ChatSource, ChatToolCall } from "../../types/chat";
import type { AgentApproval, AgentApprovalDecision } from "../../types/agentRun";
import type { McpServerConfig, McpSettings, McpServerTransport } from "../../types/mcp";
import { normalizeMcpServerLabel, normalizeMcpSettings } from "../../types/mcp";
import { flattenMcpContent, mcpCallTool, mcpListTools } from "../../services/mcpClient";
import { createTerminalSession, drainTerminalSession, isTauriDesktopRuntime, killTerminalSession, runBrowserAutomation, runTerminalCommand, writeTerminalSession } from "../../app/tauriClient";
import { getDefaultTerminalShell, getHostPlatform, isPosixTerminalShell, terminalShellLabel } from "../../lib/terminalShells";
import { normalizeProjectName } from "../../lib/chatUtils";
import { loadPdfLibraryState, savePdfLibraryState } from "../../lib/appStorage";
import { getBackgroundTerminalSessions, registerBackgroundTerminalSession, unregisterBackgroundTerminalSession, updateBackgroundTerminalSession } from "../../lib/terminalSessions";
import type { TerminalOutputChunk, TerminalRunCommandResponse, TerminalShellId } from "../../types/terminal";
import type { WebSearchSettings } from "../../types/settings";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";
import type { PdfLibraryRecord } from "../../types/pdfLibrary";
import type {
  ComputerReadFileResult,
  ComputerDirectoryListing,
  ComputerSearchResult,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import {
  buildComputerFileIndex,
  deleteComputerFile,
  getDefaultComputerWorkspace,
  getIndexableWorkspaceRoots,
  listComputerDirectory,
  moveComputerPath,
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
import { assertSyntaxBeforeWrite } from "./syntaxValidation";
import type { FileCreationToolName, FileCreationWriteResult, PreparedFileCreationWrite } from "../fileCreation";
import { isCodingToolName } from "../coding";
import type { CodingToolName } from "../coding";
import { createViteProjectScaffold } from "../projectScaffold/viteProject";
import { formatColorLookupResult, isColorToolName } from "../color";
import type { ColorToolName } from "../color";
import { executeGithubTool, isGithubToolName } from "../github";
import type { GithubToolName } from "../github";
import { executeWebSearchTool, isWebToolName } from "../web/webToolExecutor";
import { executeWeatherTool, isWeatherToolName } from "../weather";
import {
  buildAdaptationRecommendation,
  classifyToolFailure,
  ensureWorkspaceFailuresLoaded,
  findShadowForTool,
  getRecentFailures,
  lookupOverlay,
  readToolOverrides,
  recordToolFailure,
  recordToolSuccess,
  summariesForTool,
  workspaceKey,
} from "../../selfHeal";
import {
  argValue,
  assertReadablePath,
  baseName,
  booleanArg,
  clamp,
  dedupeSources,
  directoryName,
  buildOutsideWorkspaceMessage,
  firstArg,
  hasReachedToolCallLimit,
  isAbortError,
  isPathInsideRoot,
  joinLocalPath,
  limitInlineValue,
  limitToolResultBlock,
  limitToolResults,
  normalizeArgName,
  normalizeComparablePath,
  numberArg,
  optionalNumberArg,
  preserveArgValue,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
  skipNoRoots,
  sleep,
  stripLeakedToolMarkup,
  throwIfAborted,
} from "./executor/argHelpers";

const LOCAL_TOOL_PROGRESS_ID = "local-computer-tools";
const MAX_LOCAL_TOOL_CALLS_PER_PASS = 12;
const MAX_PARALLEL_LOCAL_TOOL_CALLS_PER_PASS = 8;
const MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS = 4;
const MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS = 6;
const MAX_DEEP_RESEARCH_SOURCE_FILE_MUTATIONS_PER_PASS = 10;
const MAX_TOOL_CALL_SCAN_CHARS: number | null = null;
const MAX_TOOL_RESULTS_CHARS = 220_000;
const MAX_TOOL_CALL_OUTPUT_CHARS = 220_000;
const MAX_TOOL_INPUT_PREVIEW_CHARS = 12_000;
const DEFAULT_CHAT_PDF_EXPORT_FOLDER = "GilbertCodex PDF Exports";

/**
 * Runtime guardrails for parsing and executing model-emitted local tool calls.
 *
 * Standard chat and Deep Research keep enough room for real work while
 * bounding model-visible observations so one huge tool result cannot exceed
 * the selected provider's context window.
 */
export interface LocalComputerToolExecutionPolicy {
  maxCallsPerPass: number | null;
  maxParallelCallsPerPass?: number | null;
  maxParallelMutationsPerPass?: number | null;
  maxSourceFileMutationsPerPass?: number | null;
  maxToolCallOutputChars: number | null;
  maxToolResultsChars: number | null;
  scanFromEndChars: number | null;
}

export const STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: MAX_LOCAL_TOOL_CALLS_PER_PASS,
  maxParallelCallsPerPass: MAX_PARALLEL_LOCAL_TOOL_CALLS_PER_PASS,
  maxParallelMutationsPerPass: MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS,
  maxSourceFileMutationsPerPass: MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS,
  maxToolCallOutputChars: MAX_TOOL_CALL_OUTPUT_CHARS,
  maxToolResultsChars: MAX_TOOL_RESULTS_CHARS,
  scanFromEndChars: MAX_TOOL_CALL_SCAN_CHARS,
};

export const DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: null,
  maxParallelCallsPerPass: 10,
  maxParallelMutationsPerPass: 6,
  maxSourceFileMutationsPerPass: MAX_DEEP_RESEARCH_SOURCE_FILE_MUTATIONS_PER_PASS,
  maxToolCallOutputChars: null,
  maxToolResultsChars: null,
  scanFromEndChars: null,
};
const DEFAULT_TERMINAL_TIMEOUT_MS = 45_000;
const MAX_TERMINAL_TIMEOUT_MS = 600_000;
const PACKAGE_SETUP_TERMINAL_TIMEOUT_MS = 300_000;
const BACKGROUND_TERMINAL_PROBE_MS = 18_000;
const BACKGROUND_TERMINAL_FAST_RETURN_MS = 3_800;
const BACKGROUND_TERMINAL_MIN_READY_MS = 900;
const FAST_TERMINAL_COMMAND_TIMEOUT_MS = 12_000;
const FAST_EVIDENCE_COMMAND_TIMEOUT_MS = 20_000;
const MAX_TERMINAL_LIVE_OUTPUT_CHARS = 256 * 1024;
const MAX_TERMINAL_RESULT_OUTPUT_CHARS = 256 * 1024;
const MAX_GIT_TOOL_RESULT_OUTPUT_CHARS = 180 * 1024;
const GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT = 64 * 1024;
const TERMINAL_TOOL_POLL_INTERVAL_MS = 120;
const AUTO_SYNTAX_CHECK_TIMEOUT_MS = 300_000;
const DEV_SERVER_PROBE_INTERVAL_MS = 650;
const DEV_SERVER_PROBE_TIMEOUT_MS = 650;
const DEV_SERVER_PORT_CANDIDATE_SPAN = 10;
const DEV_SERVER_PORT_RETRY_LIMIT = 2;
const GILBERT_TOOL_DIRECTORY = ".gilbert/tools";
type CustomToolRuntime = "bash" | "cmd" | "javascript" | "powershell" | "python" | "sh" | "typescript" | "zsh";
const CUSTOM_TOOL_RUNTIME_EXTENSIONS: Record<CustomToolRuntime, string> = {
  bash: "sh",
  cmd: "cmd",
  javascript: "mjs",
  powershell: "ps1",
  python: "py",
  sh: "sh",
  typescript: "ts",
  zsh: "sh",
};
const LOCAL_PREVIEW_URL_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"<>]*)?/gi;
const COMMON_LOCAL_PREVIEW_PROBE_PORTS = [5173, 5174, 3000, 3001, 4173, 4174, 4200, 4201, 4321, 4322, 5000, 5001, 5500, 6006, 8000, 8001, 8080, 8081, 1313, 4000];
const COMMON_LOCAL_PREVIEW_PROBE_PORT_SET = new Set(COMMON_LOCAL_PREVIEW_PROBE_PORTS);
type DevServerPortStyle = "env" | "port-host-args" | "port-only-args";
interface DevServerPortProfile {
  defaultPorts: number[];
  framework: string;
  style: DevServerPortStyle;
}
interface ManagedDevServerPlan {
  command: string;
  detail: string;
  expectedUrl?: string;
  framework: string;
  host: string;
  originalCommand: string;
  port: number;
  profile: DevServerPortProfile;
  usedPorts: number[];
}
const DEV_SERVER_PORT_PROFILES: DevServerPortProfile[] = [
  { defaultPorts: [5173], framework: "vite", style: "port-host-args" },
  { defaultPorts: [3000], framework: "next", style: "port-host-args" },
  { defaultPorts: [4321], framework: "astro", style: "port-host-args" },
  { defaultPorts: [5173], framework: "sveltekit", style: "port-host-args" },
  { defaultPorts: [4200], framework: "angular", style: "port-host-args" },
  { defaultPorts: [3000], framework: "react-scripts", style: "env" },
  { defaultPorts: [3000], framework: "remix", style: "port-host-args" },
  { defaultPorts: [3000], framework: "nuxt", style: "port-host-args" },
  { defaultPorts: [8080], framework: "webpack", style: "port-host-args" },
  { defaultPorts: [8081], framework: "expo", style: "port-only-args" },
  { defaultPorts: [6006], framework: "storybook", style: "port-only-args" },
  { defaultPorts: [8000], framework: "uvicorn", style: "port-host-args" },
  { defaultPorts: [5000], framework: "flask", style: "env" },
  { defaultPorts: [3000], framework: "rails", style: "port-host-args" },
  { defaultPorts: [1313], framework: "hugo", style: "port-host-args" },
  { defaultPorts: [4000], framework: "jekyll", style: "port-host-args" },
  { defaultPorts: [8000], framework: "mkdocs", style: "port-host-args" },
];
const GENERIC_DEV_SERVER_PORT_PROFILE: DevServerPortProfile = {
  defaultPorts: [5173, 3000, 8000],
  framework: "generic dev server",
  style: "env",
};
const MUTATING_TOOL_NAMES = new Set<string>([
  "browser_automation",
  "create_tool",
  "create_vite_project",
  "delete_file",
  "edit_file",
  "git_init",
  "git_branch",
  "git_checkout",
  "git_commit",
  "git_fetch",
  "git_pull",
  "git_push",
  "git_stage",
  "git_unstage",
  "github_commit_files",
  "github_create_branch",
  "github_create_pull_request",
  "github_create_release",
  "github_dispatch_workflow",
  "mcp_call_tool",
  "mcp_remove_server",
  "mcp_set_server",
  "move_path",
  "rename_path",
  "run_terminal",
  "run_tool",
  "write_file",
]);

type LocalGitToolName =
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

const LOCAL_GIT_TOOL_NAMES = new Set<LocalGitToolName>([
  "git_init",
  "git_branch",
  "git_checkout",
  "git_commit",
  "git_diff",
  "git_fetch",
  "git_log",
  "git_pull",
  "git_push",
  "git_stage",
  "git_status",
  "git_unstage",
]);

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
  | "write_file"
  | "unknown";

interface ParsedLocalComputerToolCall {
  args: Record<string, string>;
  raw: string;
  tool: LocalComputerToolName;
}

export interface McpToolContext {
  onSettingsChange?: (next: McpSettings) => void;
  settings: McpSettings;
}

export type LocalToolFailureRecoveryKind =
  | "edit_retry"
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

interface LocalComputerToolCallResult {
  artifacts?: ChatArtifact[];
  browserPreviewUrl?: string;
  content: string;
  directAnswer?: string;
  executed: boolean;
  // Machine-readable failure flag. Default semantics when unset:
  //   - executed=true  → not an error
  //   - executed=false → intentional skip (no roots, missing arg, awaiting approval), NOT an error
  // Executors that "tried and failed" (terminal exit non-zero, partial batch
  // failure, write rejected by Tauri) MUST set is_error=true explicitly so the
  // model sees an [error] marker on the result instead of [skipped] or [ok].
  is_error?: boolean;
  errorCode?: string;
  fileChanges?: ChatToolCall["fileChanges"];
  recovery?: LocalToolFailureRecovery;
  sources?: ChatSource[];
  terminal?: ChatToolCall["terminal"];
}

interface TerminalToolProgress {
  fileChanges?: ChatToolCall["fileChanges"];
  output: string;
  terminal?: ChatToolCall["terminal"];
}

type ToolCallUpdateHandler = (callNumber: number, toolCall: ChatToolCall) => void;
type TerminalProgressHandler = (progress: TerminalToolProgress) => void;

type PreparedLocalToolItem =
  | {
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      kind: "ready";
      settings: LocalWorkspaceSettings;
    }
  | {
      call: ParsedLocalComputerToolCall;
      callNumber: number;
      kind: "skipped";
      output: string;
      recovery?: LocalToolFailureRecovery;
      status: Extract<ChatToolCall["status"], "skipped" | "waiting_approval">;
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
      fileChanges?: ChatToolCall["fileChanges"];
      kind: "cached";
      output: string;
      terminal?: ChatToolCall["terminal"];
    };

type ReadyLocalToolItem = Extract<PreparedLocalToolItem, { kind: "ready" }>;

interface CompletedLocalToolItem {
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

type SubagentRunHandler = (tasks: LocalSubagentTask[]) => Promise<LocalSubagentResult[]>;

/** Detects whether assistant text contains executable local-tool markup. */
export function hasLocalComputerToolCalls(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY) {
  const scanContent = limitToolCallScanContent(content, executionPolicy);
  const scanLower = scanContent.toLowerCase();

  if (!scanLower.includes("<tool_call") && !scanLower.includes("```") && !scanLower.includes('"tool"') && !scanLower.includes('"name"') && !/<[a-zA-Z][\w.-]*\b/.test(scanContent)) {
    return false;
  }

  return /<tool_call\b/i.test(scanContent)
    || /```(?:json|tool_call)?\s*(?:\{|\[)[\s\S]*?"(?:tool|name)"\s*:/i.test(scanContent)
    || parseDirectXmlToolCalls(scanContent).length > 0;
}

/** Removes tool-call markup before rendering assistant text in the visible chat bubble. */
export function sanitizeLocalToolCallsForDisplay(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY) {
  if (!hasLocalComputerToolCalls(content, executionPolicy)) {
    return content;
  }

  const withoutCompleteCalls = content.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, " ");
  const withoutPartialCall = withoutCompleteCalls.replace(/<tool_call\b[\s\S]*$/i, "");
  const withoutJsonCalls = withoutPartialCall
    .replace(/```(?:json|tool_call)?\s*(?:\{|\[)[\s\S]*?"(?:tool|name)"\s*:[\s\S]*?(?:\}|\])\s*```/gi, " ");
  const withoutDirectXmlCalls = stripDirectXmlToolCalls(withoutJsonCalls);
  const displayText = normalizeToolCallDisplayText(withoutDirectXmlCalls);

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

/** Builds lightweight activity cards while the app waits for real tool results. */
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

/**
 * Executes parsed local, web, Git, GitHub, browser, and terminal tools for one
 * assistant pass, returning both model context and user-visible activity records.
 */
export async function runLocalComputerToolCalls({
  approvalDecisions,
  assistantContent,
  executionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  mcpContext,
  onToolCallUpdate,
  onRunSubagents,
  previousToolCalls,
  signal,
  toolSettings,
  webSearchSettings,
  webSearchMaxResults,
  settings,
  userPrompt,
}: {
  approvalDecisions?: Record<string, AgentApprovalDecision>;
  assistantContent: string;
  executionPolicy?: LocalComputerToolExecutionPolicy;
  mcpContext?: McpToolContext;
  onToolCallUpdate?: ToolCallUpdateHandler;
  onRunSubagents?: SubagentRunHandler;
  previousToolCalls?: ChatToolCall[];
  settings: LocalWorkspaceSettings;
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchSettings: WebSearchSettings;
  webSearchMaxResults: number;
}): Promise<LocalComputerToolRunResult> {
  const calls = parseLocalComputerToolCalls(assistantContent, executionPolicy);
  const tools = normalizeToolRegistrySettings(toolSettings);
  const roots = await resolveLocalWorkspaceRoots(settings);
  const sections: string[] = [
    "AGENT TOOL RESULTS",
    "The app executed the requested file and web tools. Use these results as real evidence and answer normally. Do not include tool XML or tool JSON in the final answer.",
    "Tool result format: each block starts with \"TOOL <n>: <tool_name>\" on its own line and a bracketed marker shows the outcome. No marker = ran successfully. [skipped] = the call was blocked or refused before running (adjust args / unblock / pick a different tool). [error] = the call tried and failed (read the error and decide whether to retry with adjustments). [waiting_approval] = paused until the user reviews. [reused] = result was cached from a prior pass in the same approval-gated run; trust it as if it just ran.",
    "Reliability rule: workspace context, file-index snippets, project memory, and prior chat memory are only hints. For local work, trust fresh tool results over remembered context. Read or list the current files before editing/building, and re-read/list plus run a relevant command after changing files before claiming completion.",
    `Requested calls: ${calls.length}`,
    `Workspace scope: ${settings.scope}`,
    `Workspace roots: ${roots.length > 0 ? roots.join(" | ") : "none"}`,
    settings.permissionMode === "read-only"
      ? "Write policy: read-only mode blocks mutating tools and terminal commands. File viewing, listing, indexing, and search are allowed."
      : settings.permissionMode === "ask-first"
      ? "Write policy: ask-first pauses mutating tools and creates approval cards with a preview."
      : settings.permissionMode === "gilbert-review"
        ? "Write policy: Gilbert review pauses mutating tools and resumes the same run after allow or deny."
      : settings.scope === "full-computer"
        ? "Write policy: auto full access can read and write inside the enabled drive roots without approval prompts."
        : "Write policy: auto full access can read and write inside the selected/current workspace roots without approval prompts.",
    tools.terminal
      ? settings.permissionMode === "read-only"
        ? "Terminal policy: read-only mode blocks terminal commands."
        : settings.permissionMode === "ask-first"
        ? "Terminal policy: ask-first creates approval cards for terminal commands."
        : settings.permissionMode === "gilbert-review"
          ? "Terminal policy: Gilbert review creates approval cards for terminal commands and custom tools."
        : settings.scope === "full-computer"
          ? "Terminal policy: run_terminal, create_tool, and run_tool may run inside the enabled drive roots without approval prompts."
          : "Terminal policy: run_terminal, create_tool, and run_tool may run inside the selected/current workspace roots without approval prompts."
      : "Terminal policy: terminal tools are disabled in Toolbox.",
    tools.codeEdit || tools.fileCreation
      ? "Source edit policy: use view_code plus edit_file/inline_edit for existing source/text files, rename_path/move_path for file or folder renames, and reserve write_file/create_files for new files. write_file may replace an existing file only when the call explicitly sets replace_entire_file=true and passes expected_sha256 from a fresh read_file/view_code result. edit_file can recover from unique whitespace-only drift in multi-line old_text blocks and line-range expected_text guards; any [skipped] or [error] edit result is evidence to inspect and adjust, not a reason to stop the whole answer. The runtime allows only one direct mutation per file path in a single tool pass and may run an automatic syntax/build check after source edits; inspect exact errors and continue in a later pass before touching the same file again. Terminal commands that directly write source files through here-strings, Set-Content, Out-File, Tee-Object, or redirection are rejected so code edits stay structured and reviewable."
      : "",
    tools.fileCreation
      ? "Empty project scaffold policy: if the selected workspace root exists but list_directory shows zero entries and the user asked for a new Vite/React starter app, use create_vite_project directly in that root. Do not inspect or retry the parent directory outside the workspace."
      : "",
    roots.length === 0 && (tools.fileCreation || tools.pdfTools)
      ? "Regular-chat PDF rule: create_chat_pdf, create_pdf_file, and PDF-only create_files calls may run without a workspace and return downloadable chat artifacts. Other file creation still needs a selected folder; do not retry by creating helper scripts when no workspace is selected."
      : "",
    tools.webSearch
      ? "Web policy: web_search may run on demand for current facts, docs, debugging, source-backed answers, official API/library behavior, changelogs, error messages, brand/design facts, or color specs that are not in the local color database."
      : "Web policy: web_search is disabled in Toolbox.",
    tools.webSearch
      ? "Web verification rule: before using coding, file creation, or design/color guidance that depends on an external project, package, API, brand, or current docs, request web_search first unless local source files already provide the answer."
      : "",
    "Web evidence rule: when WEB TOOL RESULTS are present, use only those listed URLs/snippets for live web claims. If web_search returned no usable sources, say that rather than answering current facts from memory.",
    tools.weatherTools
      ? "Weather policy: weather may fetch NOAA/NWS forecast, hourly forecast, alerts, grid data, stations, observations, zones, radar metadata, and bounded NOAA/NCEI climate slices. Use the saved user location by default; include latitude/longitude only when the user asks for another place."
      : "Weather policy: NOAA/NWS weather tools are disabled in Toolbox.",
    tools.sourceControl
      ? "Source control policy: local git_* tools operate on the selected workspace clone and should be used for local status, diffs, staging, commits, pushes, pulls, branches, and logs. GitHub tools use the connected account in Settings through GitHub's API for remote repository listing, code search, branch/file reads, releases, workflows, commits, and pull requests. Use local Git for unpushed workspace changes; use github_* for remote GitHub facts and API operations."
      : "Source control policy: Git and GitHub tools are disabled in Toolbox.",
    tools.sourceControl
      ? "GitHub answer format: for repository inventories, status, and branch lists, use concise Markdown bullets or numbered lists instead of pipe tables."
      : "",
    tools.colorTools
      ? "Color policy: lookup_color is available for the CSS standard named-color set plus a 30k+ MIT extended color-name database, with hex/RGB/HSL codes, aliases, special keywords, and nearest named colors. Use web_search instead for brand palettes or external design-system colors."
      : "Color policy: lookup_color is disabled in Toolbox.",
    tools.browserPreview
      ? "Browser preview policy: open_browser_preview may open a local or web HTTP(S) URL, bare domain, browser search query, or the newest tracked background dev-server session in the in-app browser. Use it when the user asks to open, pull up, view, navigate to, or search a site in the browser. Never say you will open the browser preview unless you emit the open_browser_preview tool call in the same response. browser_automation may inspect public HTTPS pages and localhost/loopback dev URLs only; private-network targets and oversized responses are blocked. Dev-server terminal output with a localhost URL also opens the preview automatically."
      : "Browser preview policy: browser preview is disabled in Toolbox.",
  ];
  let executedCount = 0;
  const artifacts: ChatArtifact[] = [];
  let browserPreviewUrl: string | undefined;
  const sources: ChatSource[] = [];
  const toolCalls: ChatToolCall[] = [];
  const approvalRequests: AgentApproval[] = [];
  const directAnswers: string[] = [];
  const mutatedFilePaths: string[] = [];
  let recoverableFailure: LocalComputerToolRecoverableFailure | undefined;
  let syntaxCheckSettings = settings;
  let directAnswerEligible = calls.length > 0 && calls.every((call) => isDirectGithubAnswerTool(call.tool));

  if (roots.length === 0) {
    sections.push("No workspace roots are available. Local file and terminal tools will be skipped, except PDF export tools may return regular-chat downloadable artifacts directly in the message. web_search, weather, and GitHub API tools can still run.");
  }

  const preparedItems: PreparedLocalToolItem[] = [];
  const fileMutationPassState = createLocalFileMutationPassState(executionPolicy);
  const previousCompletedByCall = buildPreviousCompletedMap(previousToolCalls);

  for (const [index, call] of calls.entries()) {
    const callNumber = index + 1;

    // Resume-pass dedup: if this call already completed successfully in the
    // prior pass (same resumeToolCallContent re-parsed here), reuse the prior
    // output instead of re-running it. Only triggered when previousToolCalls
    // is supplied by the resume path.
    const previousCompletion = previousCompletedByCall.get(callNumber);
    if (previousCompletion && typeof previousCompletion.output === "string") {
      preparedItems.push({
        call,
        callNumber,
        fileChanges: previousCompletion.fileChanges,
        kind: "cached",
        output: previousCompletion.output,
        terminal: previousCompletion.terminal,
      });
      continue;
    }

    if (settings.permissionMode === "read-only" && needsApproval(call)) {
      const blockedOutput = "Blocked by read-only mode.";
      directAnswerEligible = false;
      preparedItems.push({
        call,
        callNumber,
        kind: "skipped",
        output: blockedOutput,
        status: "skipped",
      });
      continue;
    }

    const approvalRequest = createToolApprovalRequest(call, callNumber, settings, mcpContext);
    const approvalDecision = approvalRequest ? getApprovalDecision(approvalRequest, approvalDecisions) : undefined;
    const executableCall = approvalDecision?.editedArgs ? applyApprovalEditedArgs(call, approvalDecision.editedArgs) : call;
    // Approved review actions resume with workspace write permissions for only
    // this call; the user's saved permission mode is left unchanged.
    const effectiveSettings = approvalRequest && (approvalDecision?.status === "approved" || approvalDecision?.status === "edited")
      ? {
          ...settings,
          permissionMode: "full-workspace" as const,
      }
      : settings;

    if (approvalRequest && approvalDecision?.status === "denied") {
      directAnswerEligible = false;
      const deniedOutput = approvalDecision.note ? `Denied by user: ${approvalDecision.note}` : "Denied by user.";
      preparedItems.push({
        call,
        callNumber,
        kind: "skipped",
        output: deniedOutput,
        status: "skipped",
      });
      continue;
    }

    const mutationGuardReason = registerLocalFileMutationForPass(executableCall, fileMutationPassState);

    if (mutationGuardReason) {
      directAnswerEligible = false;
      const recovery = recoverableToolFailure(
        "mutation_retry",
        "Inspect the current file state, then retry the remaining change in the next tool pass with one precise edit_file call.",
      );
      preparedItems.push({
        call: executableCall,
        callNumber,
        kind: "skipped",
        output: appendRecoveryMetadata(mutationGuardReason, recovery),
        recovery,
        status: "skipped",
      });
      continue;
    }

    if (approvalRequest && !approvalDecision) {
      directAnswerEligible = false;
      approvalRequests.push(approvalRequest);
      preparedItems.push({
        approval: approvalRequest,
        call,
        callNumber,
        kind: "approval",
      });
      // Continue classifying remaining calls so independent reads still run
      // concurrently with the pending approval card, while repeated mutations
      // to the same file are still fused off for this pass.
      continue;
    }

    preparedItems.push({
      call: executableCall,
      callNumber,
      kind: "ready",
      settings: effectiveSettings,
    });
  }

  const completedItems = await executePreparedLocalToolItems({
    executionPolicy,
    items: preparedItems,
    mcpContext,
    onRunSubagents,
    onToolCallUpdate,
    roots,
    signal,
    toolSettings: tools,
    userPrompt,
    webSearchSettings,
    webSearchMaxResults,
  });

  for (const item of preparedItems) {
    if (item.kind === "skipped") {
      sections.push(formatToolResultSection(item.callNumber, item.call.tool, "skipped", item.output));
      const skippedToolCall = createToolCallRecord(item.call, item.callNumber, item.status, item.output);
      toolCalls.push(skippedToolCall);
      onToolCallUpdate?.(item.callNumber, skippedToolCall);
      recoverableFailure = recoverableFailure ?? createRecoverableFailureRecord(item.call, item.callNumber, item.output, item.recovery);
      continue;
    }

    if (item.kind === "approval") {
      const waitingOutput = item.approval.preview ?? item.approval.title;
      sections.push(formatToolResultSection(item.callNumber, item.call.tool, "waiting_approval", waitingOutput));
      const waitingToolCall = createToolCallRecord(item.call, item.callNumber, "waiting_approval", waitingOutput);
      toolCalls.push(waitingToolCall);
      onToolCallUpdate?.(item.callNumber, waitingToolCall);
      continue;
    }

    if (item.kind === "cached") {
      sections.push(formatToolResultSection(item.callNumber, item.call.tool, "reused", item.output));
      const cachedToolCall = createToolCallRecord(item.call, item.callNumber, "complete", item.output, item.terminal, item.fileChanges);
      toolCalls.push(cachedToolCall);
      onToolCallUpdate?.(item.callNumber, cachedToolCall);
      // Already counted in the prior pass — do not double-count or re-emit
      // sources/browserPreviewUrl (those flowed in the original pass too).
      continue;
    }

    const completed = completedItems.get(item.callNumber);

    if (!completed) {
      continue;
    }

    toolCalls.push(completed.toolCall);
    browserPreviewUrl = completed.browserPreviewUrl ?? browserPreviewUrl;

    if (completed.errorDetail) {
      if (isDirectGithubAnswerTool(completed.call.tool)) {
        directAnswers.push(formatDirectGithubErrorAnswer(completed.call.tool, completed.errorDetail));
      } else {
        directAnswerEligible = false;
      }
      sections.push(formatToolResultSection(completed.callNumber, completed.call.tool, "error", completed.errorDetail));
      continue;
    }

    const result = completed.result;

    if (!result) {
      continue;
    }

    executedCount += result.executed ? 1 : 0;
    artifacts.push(...(result.artifacts ?? []));
    sources.push(...(result.sources ?? []));
    if (result.executed && result.directAnswer && isDirectGithubAnswerTool(completed.call.tool)) {
      directAnswers.push(result.directAnswer);
    } else if (result.executed) {
      directAnswerEligible = false;
    }
    const mutatedPath = result.executed ? getLocalFileMutationPath(completed.call) : "";
    if (mutatedPath) {
      mutatedFilePaths.push(mutatedPath);
      syntaxCheckSettings = item.settings;
    }
    const sectionStatus = resolveToolSectionStatus(result);
    sections.push(formatToolResultSection(completed.callNumber, completed.call.tool, sectionStatus, result.content));
    recoverableFailure = recoverableFailure ?? createRecoverableFailureRecord(completed.call, completed.callNumber, result.content, result.recovery);
  }

  const deniedCount = Math.max(calls.length - executedCount, 0);
  const waitingForApproval = approvalRequests.some((approval) => approval.status === "pending");
  if (!waitingForApproval && mutatedFilePaths.length > 0) {
    const syntaxCheck = await runAutomaticSyntaxCheckAfterMutations({
      paths: mutatedFilePaths,
      roots,
      settings: syntaxCheckSettings,
      signal,
      tools,
    });

    if (syntaxCheck) {
      sections.push(`\nAUTO SYNTAX CHECK\n${syntaxCheck.content}`);
      if (syntaxCheck.executed) {
        directAnswerEligible = false;
      }
    }
  }
  const detail = waitingForApproval ? `${executedCount} ran, waiting for approval` : deniedCount > 0 ? `${executedCount} ran, ${deniedCount} blocked` : `${executedCount} ran`;

  return {
    approvalRequests,
    artifacts: dedupeArtifacts(artifacts),
    contextMessage: limitToolResults(sections.join("\n"), executionPolicy.maxToolResultsChars),
    directAnswer: !waitingForApproval && directAnswerEligible && directAnswers.length > 0 ? directAnswers.join("\n\n") : undefined,
    executedCount,
    progress: createLocalComputerProgress(waitingForApproval ? "pending" : "complete", detail),
    requestedCount: calls.length,
    browserPreviewUrl,
    recoverableFailure,
    sources: dedupeSources(sources),
    toolCalls,
    waitingForApproval,
  };
}

export function createApprovalSessionDecisionKey(approval: Pick<AgentApproval, "kind" | "tool">) {
  return `session:${approval.kind}:${approval.tool}`;
}

function getApprovalDecision(approval: AgentApproval, approvalDecisions?: Record<string, AgentApprovalDecision>) {
  return approvalDecisions?.[approval.id] ?? approvalDecisions?.[createApprovalSessionDecisionKey(approval)];
}

type ToolSectionStatus = "complete" | "skipped" | "error" | "waiting_approval" | "reused";

function formatToolResultSection(callNumber: number, tool: string, status: ToolSectionStatus, body: string) {
  // Every result gets an explicit machine-readable status marker so weak
  // models can branch on it without parsing prose. "complete" maps to [ok]
  // because that's the universal convention models recognize; the others
  // stay verbatim for clarity.
  const marker = status === "complete" ? "[ok]" : `[${status}]`;
  return `\nTOOL ${callNumber} ${marker}: ${tool}\n${body}`;
}

function resolveToolSectionStatus(result: LocalComputerToolCallResult): ToolSectionStatus {
  if (result.is_error === true) {
    return "error";
  }
  return result.executed ? "complete" : "skipped";
}

function recoverableToolFailure(
  recoveryKind: LocalToolFailureRecoveryKind,
  retryInstruction: string,
): LocalToolFailureRecovery {
  return {
    recoverable: true,
    recoveryKind,
    retryInstruction,
  };
}

function appendRecoveryMetadata(content: string, recovery?: LocalToolFailureRecovery) {
  if (!recovery) {
    return content;
  }

  return [
    content,
    "",
    "RECOVERABLE_TOOL_FAILURE",
    "recoverable: true",
    `recoveryKind: ${recovery.recoveryKind}`,
    `retryInstruction: ${recovery.retryInstruction}`,
  ].join("\n");
}

function createRecoverableFailureRecord(
  call: ParsedLocalComputerToolCall,
  callNumber: number,
  output: string,
  recovery?: LocalToolFailureRecovery,
): LocalComputerToolRecoverableFailure | undefined {
  if (!recovery) {
    return undefined;
  }

  return {
    ...recovery,
    callNumber,
    output: limitInlineValue(output, 4_000),
    tool: call.tool,
  };
}

function dedupeArtifacts(artifacts: ChatArtifact[]) {
  const seen = new Set<string>();
  const deduped: ChatArtifact[] = [];

  for (const artifact of artifacts) {
    const key = artifact.id || `${artifact.title}:${artifact.url ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(artifact);
  }

  return deduped;
}

function buildPreviousCompletedMap(previousToolCalls: ChatToolCall[] | undefined) {
  const map = new Map<number, ChatToolCall>();

  if (!previousToolCalls || previousToolCalls.length === 0) {
    return map;
  }

  for (const toolCall of previousToolCalls) {
    if (toolCall.status !== "complete") {
      continue;
    }

    const callNumber = extractStampedCallNumber(toolCall.id);

    if (callNumber === null) {
      continue;
    }

    // The first matching toolCall wins; later passes append to the message's
    // toolCalls array, so an earlier-pass complete entry is the authoritative
    // result for that callNumber.
    if (!map.has(callNumber)) {
      map.set(callNumber, toolCall);
    }
  }

  return map;
}

function extractStampedCallNumber(id: string): number | null {
  // Stamped form from chatRuntime.stampLocalToolCallIds: "local-tool-<pass>-local-tool-<call>"
  const stamped = id.match(/-local-tool-(\d+)$/);

  if (stamped) {
    return Number(stamped[1]);
  }

  // Unstamped form straight from createToolCallRecord: "local-tool-<call>"
  const unstamped = id.match(/^local-tool-(\d+)$/);

  if (unstamped) {
    return Number(unstamped[1]);
  }

  return null;
}

interface LocalFileMutationPassState {
  maxMutations: number | null;
  mutationCount: number;
  seenPaths: Set<string>;
}

function createLocalFileMutationPassState(executionPolicy: LocalComputerToolExecutionPolicy): LocalFileMutationPassState {
  const rawMax = executionPolicy.maxSourceFileMutationsPerPass ?? MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS;
  const maxMutations = rawMax === null ? null : Math.max(1, Math.floor(rawMax));

  return {
    maxMutations,
    mutationCount: 0,
    seenPaths: new Set<string>(),
  };
}

function registerLocalFileMutationForPass(call: ParsedLocalComputerToolCall, state: LocalFileMutationPassState) {
  const mutationPath = getLocalFileMutationPath(call);

  if (!mutationPath) {
    return "";
  }

  const normalizedPath = normalizeComparablePath(mutationPath);

  if (!normalizedPath) {
    return "";
  }

  const toolName = formatToolName(call.tool);

  if (state.seenPaths.has(normalizedPath) && !canFollowEarlierSamePathMutation(call)) {
    return [
      `Skipped ${toolName}: ${mutationPath} was already targeted by an earlier mutation in this same tool pass.`,
      "Only one unanchored/full-file mutation is allowed per file per pass. Exact text edits with old_text/new_text, old_string/new_string, or old_str/new_str can run sequentially; otherwise inspect the current file and retry in the next pass.",
    ].join("\n");
  }

  if (state.maxMutations !== null && state.mutationCount >= state.maxMutations) {
    return [
      `Skipped ${toolName}: this pass already reached the source-file mutation limit of ${state.maxMutations}.`,
      "Use create_files for brand-new multi-file batches, or verify the current state before emitting more edits in the next pass.",
    ].join("\n");
  }

  state.seenPaths.add(normalizedPath);
  state.mutationCount += 1;
  return "";
}

function canFollowEarlierSamePathMutation(call: ParsedLocalComputerToolCall) {
  if (call.tool === "edit_file") {
    return hasNonEmptyArg(call.args, ["old_text", "old_string", "old_str", "find", "search", "target", "before"]);
  }

  return false;
}

function readLocalToolErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
}

function isMissingTextFileError(message: string) {
  return /\b(?:cannot find|not found|no such file|os error 2|system cannot find)\b/i.test(message);
}

function getLocalFileMutationPath(call: ParsedLocalComputerToolCall) {
  if (!SAME_PATH_MUTATION_TOOL_NAMES.has(call.tool)) {
    return "";
  }

  return firstArg(call.args, ["from_path", "fromPath", "from", "source_path", "source", "old_path", "oldPath", "current_path", "currentPath", "path", "file_path", "file", "target_path", "filename", "name"]) ?? "";
}

async function runAutomaticSyntaxCheckAfterMutations({
  paths,
  roots,
  settings,
  signal,
  tools,
}: {
  paths: string[];
  roots: string[];
  settings: LocalWorkspaceSettings;
  signal?: AbortSignal;
  tools: ToolRegistrySettings;
}) {
  const candidatePaths = Array.from(new Set(paths.filter(isSyntaxCheckCandidatePath)));

  if (candidatePaths.length === 0 || roots.length === 0) {
    return null;
  }

  const root = roots.find((candidate) => candidatePaths.some((path) => isPathInsideRoot(path, candidate))) ?? roots[0];
  const command = await inferSyntaxCheckCommand(root, candidatePaths);

  if (!command) {
    return {
      content: [
        `Skipped: edited ${candidatePaths.length} source file(s), but no package typecheck/build/check command could be inferred.`,
        "The next assistant pass should inspect package.json or run an explicit syntax/build command before finalizing.",
      ].join("\n"),
      executed: false,
    };
  }

  const result = await executeTerminalCommandTool(
    {
      args: {
        command,
        cwd: root,
        timeout_ms: String(AUTO_SYNTAX_CHECK_TIMEOUT_MS),
      },
      raw: "",
      tool: "run_terminal",
    },
    settings,
    roots,
    signal,
    undefined,
    tools,
  );

  return {
    content: [
      `Edited source files: ${candidatePaths.length}`,
      `Command: ${command}`,
      result.content,
    ].join("\n"),
    executed: result.executed,
  };
}

/**
 * Tools whose result is invariant within a single tool pass given identical
 * arguments. The model occasionally emits the same `view_code`/`web_search`
 * twice in a row — running them twice wastes a round-trip and (for web
 * search) costs money. Mutating tools and anything with externally visible
 * side effects are deliberately absent from this list.
 */
const PASS_DEDUP_ELIGIBLE_TOOLS = new Set<string>([
  "web_search",
  "lookup_color",
  "view_code",
  "read_file",
  "list_directory",
  "search_file_index",
  "view_file_index",
  "recall",
  "git_status",
  "git_diff",
  "git_log",
  "git_branch",
  "github_status",
  "github_list_repositories",
  "github_get_repository",
  "github_list_branches",
  "github_list_tree",
  "github_read_file",
  "github_search_code",
  "github_generate_release_notes",
  "github_list_releases",
  "github_list_workflows",
  "github_list_workflow_runs",
]);

function isPassDedupEligible(tool: string) {
  return PASS_DEDUP_ELIGIBLE_TOOLS.has(tool);
}

function createPassDedupKey(call: ParsedLocalComputerToolCall): string {
  // Sort keys so logically identical arg shapes hash identically regardless
  // of model ordering. Values stay verbatim.
  const argEntries = Object.entries(call.args ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${call.tool}${JSON.stringify(argEntries)}`;
}

const PASS_DEDUP_REUSE_NOTE = "[reused from earlier identical tool call in this pass]";

function buildReusedCompletedItem(
  current: ReadyLocalToolItem,
  previous: CompletedLocalToolItem,
  executionPolicy: LocalComputerToolExecutionPolicy,
): CompletedLocalToolItem {
  // Surface the reuse clearly so the model knows the prior call satisfied
  // this one. The status remains "complete" so downstream code that branches
  // on executed/skipped does not change shape.
  const baseContent = previous.result?.content ?? "";
  const reusedContent = limitToolCallOutput(
    baseContent ? `${PASS_DEDUP_REUSE_NOTE}\n${baseContent}` : PASS_DEDUP_REUSE_NOTE,
    executionPolicy.maxToolCallOutputChars,
  );
  const completedToolCall = createToolCallRecord(
    current.call,
    current.callNumber,
    "complete",
    reusedContent,
    previous.toolCall.terminal,
    previous.toolCall.fileChanges,
  );

  return {
    browserPreviewUrl: previous.browserPreviewUrl,
    call: current.call,
    callNumber: current.callNumber,
    result: previous.result
      ? {
          ...previous.result,
          content: reusedContent,
          fileChanges: previous.result.fileChanges ?? previous.toolCall.fileChanges,
        }
      : undefined,
    toolCall: completedToolCall,
  };
}

async function executePreparedLocalToolItems({
  executionPolicy,
  items,
  mcpContext,
  onRunSubagents,
  onToolCallUpdate,
  roots,
  signal,
  toolSettings,
  userPrompt,
  webSearchSettings,
  webSearchMaxResults,
}: {
  executionPolicy: LocalComputerToolExecutionPolicy;
  items: PreparedLocalToolItem[];
  mcpContext?: McpToolContext;
  onRunSubagents?: SubagentRunHandler;
  onToolCallUpdate?: ToolCallUpdateHandler;
  roots: string[];
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchSettings: WebSearchSettings;
  webSearchMaxResults: number;
}) {
  const completedItems = new Map<number, CompletedLocalToolItem>();
  // Per-pass dedup ledger. Key = tool name + sorted args; value = first
  // completed item to produce that result. Re-clears every pass — no
  // cross-pass dedup here (the resume-pass dedup at the top of
  // runLocalComputerToolCalls already handles that case).
  const passDedupLedger = new Map<string, CompletedLocalToolItem>();

  const runOrReusePreparedItem = async (item: ReadyLocalToolItem): Promise<CompletedLocalToolItem> => {
    const dedupKey = isPassDedupEligible(item.call.tool) ? createPassDedupKey(item.call) : null;

    if (dedupKey) {
      const prior = passDedupLedger.get(dedupKey);
      if (prior && !prior.errorDetail) {
        const reused = buildReusedCompletedItem(item, prior, executionPolicy);
        onToolCallUpdate?.(reused.callNumber, reused.toolCall);
        return reused;
      }
    }

    const completed = await executePreparedLocalToolItem({
      item,
      executionPolicy,
      mcpContext,
      onRunSubagents,
      onToolCallUpdate,
      roots,
      signal,
      toolSettings,
      userPrompt,
      webSearchSettings,
      webSearchMaxResults,
    });

    if (dedupKey && !completed.errorDetail && completed.result?.executed) {
      passDedupLedger.set(dedupKey, completed);
    }

    return completed;
  };
  const maxParallelReads = normalizeParallelToolLimit(executionPolicy.maxParallelCallsPerPass);
  const maxParallelMutations = normalizeParallelToolLimit(
    executionPolicy.maxParallelMutationsPerPass ?? Math.min(maxParallelReads, MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS),
  );
  let index = 0;

  while (index < items.length) {
    const item = items[index];

    if (item.kind !== "ready") {
      index += 1;
      continue;
    }

    const firstClass = getCallParallelClass(item.call);

    if (firstClass === "serial") {
      const completed = await runOrReusePreparedItem(item);
      completedItems.set(completed.callNumber, completed);
      index += 1;
      continue;
    }

    const cap = firstClass === "read" ? maxParallelReads : maxParallelMutations;
    const group: ReadyLocalToolItem[] = [item];
    let lookahead = index + 1;

    while (lookahead < items.length && group.length < cap) {
      const candidate = items[lookahead];

      if (candidate.kind !== "ready") {
        // Approval/skipped items don't break the read or mutation group —
        // they'll be surfaced by the caller's aggregation loop.
        lookahead += 1;
        continue;
      }

      const candidateClass = getCallParallelClass(candidate.call);

      if (candidateClass !== firstClass) {
        break;
      }

      if (firstClass === "mutation" && group.some((existing) => !canCoExecuteMutations(existing.call, candidate.call))) {
        break;
      }

      group.push(candidate);
      lookahead += 1;
    }

    const concurrency = Math.min(cap, group.length);
    // Pre-scan the group for duplicates and split into reuse-now and run-now
    // sets. Reused items are populated synchronously from the ledger; the
    // remainder runs through the existing concurrency-limited path.
    const reusedFromGroup: CompletedLocalToolItem[] = [];
    const groupToRun: ReadyLocalToolItem[] = [];

    for (const groupItem of group) {
      const dedupKey = isPassDedupEligible(groupItem.call.tool) ? createPassDedupKey(groupItem.call) : null;
      const prior = dedupKey ? passDedupLedger.get(dedupKey) : undefined;
      if (prior && !prior.errorDetail) {
        const reused = buildReusedCompletedItem(groupItem, prior, executionPolicy);
        onToolCallUpdate?.(reused.callNumber, reused.toolCall);
        reusedFromGroup.push(reused);
      } else {
        groupToRun.push(groupItem);
      }
    }

    const ranResults = groupToRun.length === 0
      ? []
      : groupToRun.length === 1
        ? [await runOrReusePreparedItem(groupToRun[0])]
        : await mapWithConcurrency(groupToRun, concurrency, (groupItem) => runOrReusePreparedItem(groupItem));

    const groupResults = [...reusedFromGroup, ...ranResults];

    for (const completed of groupResults) {
      completedItems.set(completed.callNumber, completed);
    }

    index = lookahead;
  }

  return completedItems;
}

async function executePreparedLocalToolItem({
  item,
  executionPolicy,
  mcpContext,
  onRunSubagents,
  onToolCallUpdate,
  roots,
  signal,
  toolSettings,
  userPrompt,
  webSearchSettings,
  webSearchMaxResults,
}: {
  executionPolicy: LocalComputerToolExecutionPolicy;
  item: ReadyLocalToolItem;
  mcpContext?: McpToolContext;
  onRunSubagents?: SubagentRunHandler;
  onToolCallUpdate?: ToolCallUpdateHandler;
  roots: string[];
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchSettings: WebSearchSettings;
  webSearchMaxResults: number;
}): Promise<CompletedLocalToolItem> {
  const activeToolCall = createToolCallRecord(item.call, item.callNumber, "active");
  onToolCallUpdate?.(item.callNumber, activeToolCall);

  const selfHealWorkspace = workspaceKey(roots);
  // Hydrate persisted failures lazily — no-op after the first call per workspace.
  void ensureWorkspaceFailuresLoaded(selfHealWorkspace).catch(() => undefined);
  const originalTool = item.call.tool;
  // Resolve and apply any project overlay for this tool before dispatch.
  // Overlay args take precedence for keys the overlay explicitly sets; the
  // model's args still flow through for everything else.
  const overlay = roots[0] ? lookupOverlay(await readToolOverrides(roots[0]).catch(() => null) ?? { overlays: {}, version: 1 }, originalTool) : undefined;
  const mergedArgs: Record<string, string> = overlay?.args ? { ...item.call.args, ...overlay.args } : item.call.args;
  const overlayApplied = Boolean(overlay?.args && Object.keys(overlay.args).length > 0);
  // If this workspace has a shadow script for the original tool, route the
  // call through run_tool so the script runs instead of the foundational
  // implementation. Failures/successes are still recorded under the
  // original tool name so the streak/UI keep tracking the right thing.
  const shadowPath = await findShadowForTool(selfHealWorkspace, originalTool).catch(() => undefined);
  const effectiveCall: ParsedLocalComputerToolCall = shadowPath
    ? {
        args: buildShadowToolArgs(originalTool, mergedArgs),
        raw: item.call.raw,
        tool: "run_tool",
      }
    : overlayApplied
      ? { args: mergedArgs, raw: item.call.raw, tool: item.call.tool }
      : item.call;

  try {
    throwIfAborted(signal);
    const result = await executeLocalComputerToolCall(effectiveCall, item.settings, roots, userPrompt, webSearchMaxResults, webSearchSettings, toolSettings, signal, (progress) => {
      onToolCallUpdate?.(
        item.callNumber,
        createToolCallRecord(item.call, item.callNumber, "active", progress.output, progress.terminal, progress.fileChanges),
      );
    }, onRunSubagents, mcpContext);

    // Detect terminal-class tools that exited non-zero — these don't throw but did fail.
    const terminalExitCode = result.terminal?.exitCode;
    const terminalTimedOut = result.terminal?.timedOut === true;
    const terminalFailed = (terminalExitCode != null && terminalExitCode !== 0) || terminalTimedOut;
    const adaptationPrefix = formatAdaptationPrefix(originalTool, shadowPath, overlayApplied, overlay?.notes);
    let augmentedContent = adaptationPrefix ? `${adaptationPrefix}\n${result.content}` : result.content;

    if (result.executed && terminalFailed) {
      // The tool ran to completion at the OS level but the underlying command
      // failed (non-zero exit or timeout). Mark this as an error result so the
      // model sees an [error] marker — without this, weak models read prose
      // like "exited with code 1" but classify the call as a success because
      // status was "complete".
      result.is_error = true;
      result.errorCode = terminalTimedOut ? "terminal_timeout" : `terminal_exit_${terminalExitCode}`;
      const classification = classifyToolFailure({
        args: item.call.args,
        exitCode: terminalExitCode ?? null,
        skipReason: terminalTimedOut ? "Tool exceeded its timeout" : undefined,
        stderr: result.content,
        tool: item.call.tool,
      });
      const recorded = recordToolFailure(selfHealWorkspace, {
        args: item.call.args,
        classification,
        roots,
        tool: item.call.tool,
      });
      if (recorded.shouldAdapt) {
        augmentedContent = `${result.content}\n${buildAdaptationRecommendation({
          cause: classification.cause,
          recentSummaries: summariesForTool(getRecentFailures(selfHealWorkspace, 10), item.call.tool),
          streak: recorded.streak,
          summary: classification.summary,
          tool: item.call.tool,
          workspaceRoot: roots[0],
        })}`;
      }
    } else if (result.executed && !result.is_error) {
      // Tool worked — clear streaks for this tool so a future regression starts fresh.
      recordToolSuccess(selfHealWorkspace, item.call.tool);
    }

    const outputContent = appendRecoveryMetadata(augmentedContent, result.recovery);
    const recordStatus: ChatToolCall["status"] = result.is_error
      ? "error"
      : (result.executed ? "complete" : "skipped");
    const completedToolCall = createToolCallRecord(
      item.call,
      item.callNumber,
      recordStatus,
      limitToolCallOutput(outputContent, executionPolicy.maxToolCallOutputChars),
      result.terminal,
      result.fileChanges,
    );
    onToolCallUpdate?.(item.callNumber, completedToolCall);

    return {
      browserPreviewUrl: result.browserPreviewUrl,
      call: item.call,
      callNumber: item.callNumber,
      result: outputContent === result.content ? result : { ...result, content: outputContent },
      toolCall: completedToolCall,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    let errorDetail = formatToolExecutionError(item.call.tool, error);
    const classification = classifyToolFailure({
      args: item.call.args,
      error,
      tool: item.call.tool,
    });
    const recorded = recordToolFailure(selfHealWorkspace, {
      args: item.call.args,
      classification,
      roots,
      tool: item.call.tool,
    });
    if (recorded.shouldAdapt) {
      errorDetail = `${errorDetail}\n${buildAdaptationRecommendation({
        cause: classification.cause,
        recentSummaries: summariesForTool(getRecentFailures(selfHealWorkspace, 10), item.call.tool),
        streak: recorded.streak,
        summary: classification.summary,
        tool: item.call.tool,
        workspaceRoot: roots[0],
      })}`;
    }

    const failedToolCall = createToolCallRecord(item.call, item.callNumber, "error", errorDetail);
    onToolCallUpdate?.(item.callNumber, failedToolCall);

    return {
      call: item.call,
      callNumber: item.callNumber,
      errorDetail,
      toolCall: failedToolCall,
    };
  }
}

function normalizeParallelToolLimit(limit: number | null | undefined) {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) {
    return 1;
  }

  return Math.max(1, Math.floor(limit));
}

/**
 * Builds run_tool args for a shadowed dispatch. The original args are stringified
 * into args_json so Python/Node shadow scripts can parse one structured argument;
 * a few well-known passthrough keys (shell, timeout_ms, working_directory) are
 * also forwarded so the run_tool runner picks the right runtime context.
 */
function buildShadowToolArgs(originalTool: string, originalArgs: Record<string, string>): Record<string, string> {
  const args: Record<string, string> = {
    args_json: safeStringifyShadowArgs(originalArgs),
    tool_name: originalTool,
  };

  for (const key of ["shell", "timeout_ms", "working_directory", "cwd"]) {
    const value = originalArgs[key];
    if (typeof value === "string" && value.length > 0) {
      args[key] = value;
    }
  }

  return args;
}

function safeStringifyShadowArgs(args: Record<string, string>) {
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

/** Builds the one-line prefix that flags shadow/overlay use so the agent and user can see it. */
function formatAdaptationPrefix(tool: string, shadowPath: string | undefined, overlayApplied: boolean, overlayNotes?: string): string {
  const parts: string[] = [];
  if (shadowPath) {
    parts.push(`[self-heal] Routed ${tool} through project shadow ${shadowPath}.`);
  }
  if (overlayApplied) {
    parts.push(`[self-heal] Applied project overlay for ${tool}${overlayNotes ? ` — ${overlayNotes}` : ""}.`);
  }
  return parts.join("\n");
}

function canExecuteLocalToolInParallel(call: ParsedLocalComputerToolCall) {
  if (needsApproval(call)) {
    return false;
  }

  return (
    call.tool === "web_search" ||
    call.tool === "weather" ||
    call.tool === "lookup_color" ||
    call.tool === "read_file" ||
    call.tool === "view_code" ||
    call.tool === "search_files" ||
    call.tool === "recall_context" ||
    call.tool === "list_directory" ||
    call.tool === "git_status" ||
    call.tool === "git_diff" ||
    call.tool === "git_log" ||
    call.tool === "github_status" ||
    call.tool === "github_list_repositories" ||
    call.tool === "github_get_repository" ||
    call.tool === "github_list_branches" ||
    call.tool === "github_list_tree" ||
    call.tool === "github_read_file" ||
    call.tool === "github_search_code" ||
    call.tool === "github_generate_release_notes" ||
    call.tool === "github_list_releases" ||
    call.tool === "github_list_workflows" ||
    call.tool === "github_list_workflow_runs"
  );
}

const ALWAYS_SERIAL_MUTATION_TOOL_NAMES = new Set<string>([
  "create_vite_project",
  "run_terminal",
  "run_tool",
  "create_tool",
]);

const SAME_PATH_MUTATION_TOOL_NAMES = new Set<string>([
  "write_file",
  "edit_file",
  "delete_file",
  "move_path",
  "rename_path",
  "create_text_file",
  "create_markdown_file",
  "create_code_file",
  "create_react_file",
  "create_html_file",
  "create_vite_project",
]);

const GITHUB_REPO_MUTATION_TOOL_NAMES = new Set<string>([
  "github_commit_files",
  "github_create_branch",
  "github_create_pull_request",
  "github_create_release",
  "github_dispatch_workflow",
]);

function isMutationParallelizable(call: ParsedLocalComputerToolCall) {
  if (!needsApproval(call)) {
    return false;
  }

  return !ALWAYS_SERIAL_MUTATION_TOOL_NAMES.has(call.tool);
}

function getMutationConflictKey(call: ParsedLocalComputerToolCall) {
  if (SAME_PATH_MUTATION_TOOL_NAMES.has(call.tool)) {
    const path = firstArg(call.args, ["project_path", "projectPath", "from_path", "fromPath", "from", "source_path", "source", "old_path", "oldPath", "current_path", "currentPath", "path", "file_path", "file", "target_path", "filename", "name"]);
    const normalized = normalizeComparablePath(path ?? "");
    return normalized ? `file:${normalized}` : null;
  }

  if (LOCAL_GIT_TOOL_NAMES.has(call.tool as LocalGitToolName)) {
    const cwd = firstArg(call.args, ["cwd", "working_directory", "directory", "path"]);
    return `git:${normalizeComparablePath(cwd ?? "")}`;
  }

  if (GITHUB_REPO_MUTATION_TOOL_NAMES.has(call.tool)) {
    const repository = firstArg(call.args, ["repository", "repo", "repo_full_name", "full_name"]);
    return `github:${(repository ?? "").trim().toLowerCase()}`;
  }

  return null;
}

function canCoExecuteMutations(a: ParsedLocalComputerToolCall, b: ParsedLocalComputerToolCall) {
  const keyA = getMutationConflictKey(a);
  const keyB = getMutationConflictKey(b);

  if (keyA === null || keyB === null) {
    return false;
  }

  if (keyA === keyB) {
    return false;
  }

  if (keyA.startsWith("file:") && keyB.startsWith("file:")) {
    const pathA = keyA.slice("file:".length);
    const pathB = keyB.slice("file:".length);

    if (pathA === pathB) {
      return false;
    }

    if (pathA.startsWith(`${pathB}/`) || pathB.startsWith(`${pathA}/`)) {
      return false;
    }
  }

  return true;
}

type CallParallelClass = "read" | "mutation" | "serial";

function getCallParallelClass(call: ParsedLocalComputerToolCall): CallParallelClass {
  if (canExecuteLocalToolInParallel(call)) {
    return "read";
  }

  if (isMutationParallelizable(call)) {
    return "mutation";
  }

  return "serial";
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function createToolCallRecord(
  call: ParsedLocalComputerToolCall,
  callNumber: number,
  status: ChatToolCall["status"],
  output?: string,
  terminal?: ChatToolCall["terminal"],
  fileChanges?: ChatToolCall["fileChanges"],
): ChatToolCall {
  return {
    detail: summarizeToolCall(call),
    fileChanges,
    id: `local-tool-${callNumber}`,
    input: formatToolCallInput(call),
    label: formatToolName(call.tool),
    output,
    status,
    terminal,
  };
}

const MAX_FILE_CHANGE_DIFF_LINES = 80;

function createFileChangeSummary(
  path: string,
  beforeContent: string | undefined,
  afterContent: string | undefined,
  kind: NonNullable<ChatToolCall["fileChanges"]>[number]["kind"] = beforeContent === undefined ? "create" : "update",
): NonNullable<ChatToolCall["fileChanges"]>[number] | undefined {
  if (beforeContent === undefined && afterContent === undefined) {
    return undefined;
  }

  const { additions, deletions } = countLineChanges(beforeContent ?? "", afterContent ?? "");
  const diffPreview = createFileChangeDiffPreview(beforeContent ?? "", afterContent ?? "");

  return {
    additions,
    deletions,
    diffPreview: diffPreview.lines,
    diffTruncated: diffPreview.truncated,
    kind,
    path,
  };
}

function createFileChangeDiffPreview(beforeContent: string, afterContent: string): {
  lines?: NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>;
  truncated?: boolean;
} {
  if (beforeContent === afterContent) {
    return {};
  }

  const beforeLines = splitComparableLines(beforeContent);
  const afterLines = splitComparableLines(afterContent);

  if (beforeLines.length === 0 && afterLines.length === 0) {
    return {};
  }

  const matrixCells = beforeLines.length * afterLines.length;
  const diffLines = matrixCells > 250_000
    ? createWindowedFileDiffPreview(beforeLines, afterLines)
    : createLcsFileDiffPreview(beforeLines, afterLines);
  const limited = limitFileChangeDiffLines(diffLines);

  return {
    lines: limited.lines.length > 0 ? limited.lines : undefined,
    truncated: limited.truncated || undefined,
  };
}

function createLcsFileDiffPreview(beforeLines: string[], afterLines: string[]) {
  type DiffLine = NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number];
  const matrix: number[][] = Array.from({ length: beforeLines.length + 1 }, () => new Array(afterLines.length + 1).fill(0));

  for (let oldIndex = 1; oldIndex <= beforeLines.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= afterLines.length; newIndex += 1) {
      matrix[oldIndex][newIndex] = beforeLines[oldIndex - 1] === afterLines[newIndex - 1]
        ? matrix[oldIndex - 1][newIndex - 1] + 1
        : Math.max(matrix[oldIndex - 1][newIndex], matrix[oldIndex][newIndex - 1]);
    }
  }

  const lines: DiffLine[] = [];
  let oldIndex = beforeLines.length;
  let newIndex = afterLines.length;

  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && beforeLines[oldIndex - 1] === afterLines[newIndex - 1]) {
      lines.push({
        content: beforeLines[oldIndex - 1],
        kind: "context",
        newLine: newIndex,
        oldLine: oldIndex,
      });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (newIndex > 0 && (oldIndex === 0 || matrix[oldIndex][newIndex - 1] >= matrix[oldIndex - 1][newIndex])) {
      lines.push({
        content: afterLines[newIndex - 1],
        kind: "add",
        newLine: newIndex,
      });
      newIndex -= 1;
    } else if (oldIndex > 0) {
      lines.push({
        content: beforeLines[oldIndex - 1],
        kind: "remove",
        oldLine: oldIndex,
      });
      oldIndex -= 1;
    }
  }

  return lines.reverse();
}

function createWindowedFileDiffPreview(beforeLines: string[], afterLines: string[]) {
  type DiffLine = NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number];
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length
    && prefixLength < afterLines.length
    && beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength
    && suffixLength < afterLines.length - prefixLength
    && beforeLines[beforeLines.length - 1 - suffixLength] === afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const lines: DiffLine[] = [];
  const contextBeforeStart = Math.max(0, prefixLength - 3);
  const beforeChangeEnd = beforeLines.length - suffixLength;
  const afterChangeEnd = afterLines.length - suffixLength;

  for (let index = contextBeforeStart; index < prefixLength; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "context",
      newLine: index + 1,
      oldLine: index + 1,
    });
  }

  for (let index = prefixLength; index < beforeChangeEnd; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "remove",
      oldLine: index + 1,
    });
  }

  for (let index = prefixLength; index < afterChangeEnd; index += 1) {
    lines.push({
      content: afterLines[index],
      kind: "add",
      newLine: index + 1,
    });
  }

  const contextAfterEnd = Math.min(beforeLines.length, beforeChangeEnd + 3);
  for (let index = beforeChangeEnd; index < contextAfterEnd; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "context",
      newLine: index + 1 + (afterLines.length - beforeLines.length),
      oldLine: index + 1,
    });
  }

  return lines;
}

function limitFileChangeDiffLines(lines: NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>) {
  if (lines.length <= MAX_FILE_CHANGE_DIFF_LINES) {
    return {
      lines,
      truncated: false,
    };
  }

  const headCount = Math.floor(MAX_FILE_CHANGE_DIFF_LINES * 0.58);
  const tailCount = MAX_FILE_CHANGE_DIFF_LINES - headCount - 1;
  const omittedCount = lines.length - headCount - tailCount;

  return {
    lines: [
      ...lines.slice(0, headCount),
      {
        content: `${omittedCount} diff lines hidden in Activity`,
        kind: "meta" as const,
      },
      ...lines.slice(-tailCount),
    ],
    truncated: true,
  };
}

function countLineChanges(beforeContent: string, afterContent: string) {
  const beforeLines = splitComparableLines(beforeContent);
  const afterLines = splitComparableLines(afterContent);

  if (beforeLines.length === 0) {
    return { additions: afterLines.length, deletions: 0 };
  }

  if (afterLines.length === 0) {
    return { additions: 0, deletions: beforeLines.length };
  }

  const matrixCells = beforeLines.length * afterLines.length;
  if (matrixCells > 250_000) {
    return countLineChangesByWindow(beforeLines, afterLines);
  }

  let previous = new Array(afterLines.length + 1).fill(0);
  let current = new Array(afterLines.length + 1).fill(0);

  for (let oldIndex = 1; oldIndex <= beforeLines.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= afterLines.length; newIndex += 1) {
      current[newIndex] = beforeLines[oldIndex - 1] === afterLines[newIndex - 1]
        ? previous[newIndex - 1] + 1
        : Math.max(previous[newIndex], current[newIndex - 1]);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  const commonLines = previous[afterLines.length];
  return {
    additions: Math.max(0, afterLines.length - commonLines),
    deletions: Math.max(0, beforeLines.length - commonLines),
  };
}

function countLineChangesByWindow(beforeLines: string[], afterLines: string[]) {
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length
    && prefixLength < afterLines.length
    && beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength
    && suffixLength < afterLines.length - prefixLength
    && beforeLines[beforeLines.length - 1 - suffixLength] === afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    additions: Math.max(0, afterLines.length - prefixLength - suffixLength),
    deletions: Math.max(0, beforeLines.length - prefixLength - suffixLength),
  };
}

function splitComparableLines(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingLineBreak = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutTrailingLineBreak ? withoutTrailingLineBreak.split("\n") : [];
}

function createToolApprovalRequest(call: ParsedLocalComputerToolCall, callNumber: number, settings: LocalWorkspaceSettings, mcpContext?: McpToolContext): AgentApproval | null {
  if (settings.permissionMode !== "ask-first" && settings.permissionMode !== "gilbert-review") {
    return null;
  }

  if (!needsApproval(call)) {
    return null;
  }

  // mcp_call_tool honors the server's own require_approval setting — when
  // the user has marked a server as "never", auto-run that server's tool
  // calls without a per-call approval card.
  if (call.tool === "mcp_call_tool" && mcpContext) {
    const label = firstArg(call.args, ["server_label", "label", "server"]);
    if (label) {
      const target = normalizeMcpServerLabel(label);
      const server = normalizeMcpSettings(mcpContext.settings).servers.find(
        (entry) => normalizeMcpServerLabel(entry.label) === target,
      );
      if (server && server.requireApproval === "never") {
        return null;
      }
    }
  }

  const now = new Date().toISOString();
  const command = firstArg(call.args, ["command", "cmd", "input"]);
  const path = firstArg(call.args, ["project_path", "projectPath", "path", "file_path", "target_path", "directory_path", "folder_path", "file"]);
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

  if (call.tool === "move_path" || call.tool === "rename_path") {
    const fromPath = firstArg(call.args, ["from_path", "fromPath", "from", "source_path", "source", "old_path", "oldPath", "current_path", "currentPath", "path"]) ?? "unknown path";
    const toPath = firstArg(call.args, ["to_path", "toPath", "destination_path", "destinationPath", "dest_path", "destPath", "target_path", "targetPath", "new_path", "newPath", "to", "destination"]);
    const newName = firstArg(call.args, ["new_name", "newName", "name", "file_name", "fileName", "folder_name", "folderName"]);
    return [`From: ${fromPath}`, toPath ? `To: ${toPath}` : undefined, !toPath && newName ? `New name: ${newName}` : undefined].filter(Boolean).join("\n");
  }

  if (call.tool === "edit_file") {
    const path = firstArg(call.args, ["path", "file_path", "target_path"]) ?? "unknown path";
    const oldText = firstArg(call.args, ["old_text", "old_string", "old_str", "find", "search", "before"]);
    const newText = firstArg(call.args, ["new_text", "new_string", "new_str", "replace", "replacement", "after", "content"]);
    return [`Path: ${path}`, oldText ? `Find: ${limitInlineValue(oldText, 600)}` : undefined, newText ? `Replace with: ${limitInlineValue(newText, 600)}` : undefined]
      .filter(Boolean)
      .join("\n");
  }

  if (call.tool === "write_file") {
    const path = firstArg(call.args, ["path", "file_path", "target_path"]) ?? "unknown path";
    const content = firstArg(call.args, ["content", "text", "body"]) ?? "";
    const replaceEntireFile = booleanArg(call.args, ["replace_entire_file", "replaceEntireFile", "full_replace", "fullReplace", "allow_full_rewrite", "allowFullRewrite"], false);
    const expectedSha256 = firstArg(call.args, ["expected_sha256", "expectedSha256", "if_match_sha256", "ifMatchSha256", "sha256"]);
    return [
      `Path: ${path}`,
      replaceEntireFile ? "Full-file replacement: explicitly requested" : "Mode: create new file unless target does not exist",
      expectedSha256 ? `Expected sha256: ${expectedSha256}` : undefined,
      content ? `Content preview:\n${limitInlineValue(content, 1200)}` : undefined,
    ].filter(Boolean).join("\n");
  }

  if (call.tool === "create_vite_project") {
    const path = firstArg(call.args, ["project_path", "projectPath", "path", "directory_path", "directoryPath", "folder_path", "folderPath", "cwd", "target"]);
    const name = firstArg(call.args, ["project_name", "projectName", "name", "app_name", "appName", "package_name", "packageName"]);
    const variant = firstArg(call.args, ["variant", "template", "language", "stack"]);
    const repairMissing = booleanArg(call.args, ["repair_missing", "repairMissing", "fill_missing", "fillMissing", "repair", "overwrite", "overwrite_existing", "overwriteExisting", "force"], false);
    return [
      path ? `Project path: ${path}` : "Project path: selected workspace root",
      name ? `Project name: ${name}` : undefined,
      variant ? `Variant: ${variant}` : undefined,
      repairMissing ? "Existing project mode: fill missing starter files only" : undefined,
    ].filter(Boolean).join("\n");
  }

  if (call.tool === "browser_automation" || call.tool === "open_browser_preview") {
    const url = firstArg(call.args, ["url", "href", "address", "target", "page"]) ?? "unknown URL";
    const query = firstArg(call.args, ["query", "search", "q", "terms"]);
    const action = firstArg(call.args, ["action", "operation", "mode"]);
    const text = firstArg(call.args, ["text", "label", "assert_text", "contains", "link_text"]);
    return [`URL: ${url}`, query ? `Search: ${limitInlineValue(query, 600)}` : undefined, action ? `Action: ${action}` : undefined, text ? `Text: ${limitInlineValue(text, 600)}` : undefined].filter(Boolean).join("\n");
  }

  if (isLocalGitToolName(call.tool)) {
    return createGitApprovalPreview(call);
  }

  if (call.tool === "github_create_branch" || call.tool === "github_commit_files" || call.tool === "github_create_pull_request" || call.tool === "github_create_release" || call.tool === "github_dispatch_workflow") {
    const repository = firstArg(call.args, ["repository", "repo_full_name", "full_name"]);
    const owner = firstArg(call.args, ["owner", "org", "organization"]);
    const repo = firstArg(call.args, ["repo", "repository_name", "name"]);
    const branch = firstArg(call.args, ["branch", "head", "new_branch", "newBranch"]);
    const tag = firstArg(call.args, ["tag", "tag_name", "tagName", "version"]);
    const workflow = firstArg(call.args, ["workflow", "workflow_id", "workflowId", "file"]);
    const message = firstArg(call.args, ["message", "commit_message", "commitMessage", "title"]);
    const files = firstArg(call.args, ["files_json", "files", "changes", "items", "path", "file_path", "file"]);

    return [
      `Repository: ${repository || (owner && repo ? `${owner}/${repo}` : "unknown")}`,
      branch ? `Branch: ${branch}` : undefined,
      tag ? `Tag: ${tag}` : undefined,
      workflow ? `Workflow: ${workflow}` : undefined,
      message ? `Message: ${message}` : undefined,
      files ? `Files: ${limitInlineValue(files, 1200)}` : undefined,
    ].filter(Boolean).join("\n");
  }

  return formatToolCallInput(call);
}

function approvalKindForTool(tool: LocalComputerToolName): AgentApproval["kind"] {
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

function approvalRiskForTool(tool: LocalComputerToolName): AgentApproval["risk"] {
  if (tool === "delete_file" || tool === "run_terminal" || tool === "run_tool" || tool === "create_tool" || tool === "github_commit_files" || tool === "github_create_release" || tool === "github_dispatch_workflow" || tool === "git_commit" || tool === "git_push" || tool === "git_pull" || tool === "git_checkout" || tool === "git_branch") {
    return "high";
  }

  if (tool === "browser_automation" || tool === "edit_file" || tool === "write_file" || tool === "move_path" || tool === "rename_path" || tool === "git_init" || tool === "git_stage" || tool === "git_unstage" || tool === "git_fetch" || isFileCreationToolName(tool) || tool.startsWith("create_")) {
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
  webSearchSettings: WebSearchSettings,
  toolSettings: ToolRegistrySettings,
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
  onRunSubagents?: SubagentRunHandler,
  mcpContext?: McpToolContext,
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
      const result = await executeWebSearchTool(call.args, userPrompt, webSearchMaxResults, webSearchSettings, { signal });
      return {
        content: result.content,
        // A search that ran successfully but returned 0 results is not an error.
        // Only mark not-executed if the call itself failed.
        executed: !result.isError,
        is_error: result.isError === true,
        errorCode: result.errorCode,
        sources: result.sources,
      };
    }
    case "weather": {
      const result = await executeWeatherTool(call.args, userPrompt, { signal });
      return {
        content: result.content,
        executed: !result.isError,
        is_error: result.isError === true,
        errorCode: result.errorCode,
        sources: result.sources,
      };
    }
    case "lookup_color": {
      return {
        content: await formatColorLookupResult(call.args),
        executed: true,
      };
    }
    case "mcp_list_servers": {
      return executeMcpListServersTool(mcpContext);
    }
    case "mcp_list_tools": {
      return executeMcpListToolsTool(call, mcpContext, signal);
    }
    case "mcp_call_tool": {
      return executeMcpCallTool(call, mcpContext, signal);
    }
    case "mcp_set_server": {
      return executeMcpSetServerTool(call, mcpContext);
    }
    case "mcp_remove_server": {
      return executeMcpRemoveServerTool(call, mcpContext);
    }
    case "git_status":
    case "git_diff":
    case "git_log":
    case "git_init":
    case "git_stage":
    case "git_unstage":
    case "git_commit":
    case "git_push":
    case "git_pull":
    case "git_fetch":
    case "git_branch":
    case "git_checkout": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      return executeLocalGitToolCall(call, settings, roots, signal, onTerminalProgress);
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
    case "github_create_pull_request":
    case "github_generate_release_notes":
    case "github_create_release":
    case "github_list_releases":
    case "github_list_workflows":
    case "github_dispatch_workflow":
    case "github_list_workflow_runs": {
      const result = await executeGithubTool(call.tool, call.args, { userPrompt });
      return {
        content: result.content,
        directAnswer: result.directAnswer,
        executed: result.executed,
        is_error: result.isError === true,
        errorCode: result.errorCode,
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
        is_error: result.is_error,
        errorCode: result.errorCode,
        recovery: result.recovery,
        terminal: result.terminal,
      };
    }
    case "open_browser_preview": {
      const result = await executeOpenBrowserPreviewTool(call, roots, userPrompt, signal);
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

      const results = await onRunSubagents(tasks);

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
        fileChanges: result.fileChanges,
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
    case "create_files": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeFileCreationTool(call as ParsedLocalComputerToolCall & { tool: FileCreationToolName }, settings, roots, { onProgress: onTerminalProgress });
      return {
        content: result.content,
        executed: result.executed,
        fileChanges: result.fileChanges,
      };
    }
    case "create_vite_project": {
      if (roots.length === 0) {
        return {
          content: [
            "Skipped because no local workspace roots are selected.",
            "Ask the user to pick a workspace folder, or use Full computer access with an explicit project_path such as C:\\Users\\Kobe Work\\Documents\\hello.",
          ].join("\n"),
          executed: false,
        };
      }

      const result = await executeCreateViteProjectTool(call, settings, roots, onTerminalProgress);
      return {
        content: result.content,
        executed: result.executed,
        fileChanges: result.fileChanges,
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
        fileChanges: result.fileChanges,
      };
    }
    case "move_path":
    case "rename_path": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const result = await executeMovePathTool(call, settings, roots);
      return {
        content: result.content,
        executed: result.executed,
        fileChanges: result.fileChanges,
      };
    }
    case "recall_context": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const query = firstArg(call.args, ["query", "q", "text"]) || userPrompt;
      const limit = optionalNumberArg(call.args, ["limit"]);
      const searchRoots = resolveBroadSearchRoots(settings, roots, call.args);

      if (searchRoots.length === 0) {
        return skipFullComputerBroadSearch();
      }

      const memories = await readGilbertProjectMemories(searchRoots);
      let results = await searchComputerFiles(query, limit, searchRoots);

      if (results.length === 0) {
        await buildComputerFileIndex(searchRoots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit, searchRoots);
      }

      return {
        content: formatContextRecallResults(query, memories, results, limit),
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
          `Stopped at explicit index limit: ${summary.truncated ? "yes" : "no"}`,
          `Roots: ${summary.roots.join(" | ")}`,
        ].join("\n"),
        executed: true,
      };
    }
    case "list_directory": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = resolveWorkspacePath(firstArg(call.args, ["path", "directory_path", "folder_path"]) || roots[0], roots);
      assertReadablePath(path, roots);
      const listing = await listComputerDirectory(path, optionalNumberArg(call.args, ["limit"]));
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

      const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

      if (!rawPath) {
        return {
          content: "Skipped because read_file did not include a file path.",
          executed: false,
        };
      }

      const path = resolveWorkspacePath(rawPath, roots);
      assertReadablePath(path, roots);

      const maxBytes = optionalNumberArg(call.args, ["max_bytes", "maxBytes", "bytes"]);
      const file = await readComputerTextFile(path, maxBytes).catch((error) => {
        const detail = normalizeToolErrorMessage(error);
        if (isMissingLocalPathError(detail)) {
          return null;
        }
        throw error;
      });

      if (!file) {
        return {
          content: [
            `${formatToolName(call.tool)} skipped: file not found.`,
            `Path: ${path}`,
            "This is not a reader-tool failure. List the directory, create the file, or use the exact path from a prior tool result before reading it.",
          ].join("\n"),
          executed: false,
        };
      }

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
      const limit = optionalNumberArg(call.args, ["limit"]);
      const searchRoots = resolveBroadSearchRoots(settings, roots, call.args);

      if (searchRoots.length === 0) {
        return skipFullComputerBroadSearch();
      }

      let results = await searchComputerFiles(query, limit, searchRoots);

      if (results.length === 0) {
        await buildComputerFileIndex(searchRoots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit, searchRoots);
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

      const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

      if (!rawPath) {
        return {
          content: "Skipped because edit_file did not include a file path.",
          executed: false,
          recovery: recoverableToolFailure(
            "edit_retry",
            "Retry edit_file with a path inside the workspace plus exactly one edit shape; use list_directory/view_code first if the target path is uncertain.",
          ),
        };
      }

      const path = resolveWorkspacePath(rawPath, roots);
      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Edit blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      onTerminalProgress?.({
        output: `Editing file: ${path}`,
      });

      let result: Awaited<ReturnType<typeof editComputerTextFile>>;
      const beforeContent = await readOriginalContentForSyntaxCheck(path);
      try {
        result = await editComputerTextFile({ args: call.args, path, roots });
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : String(error),
          executed: false,
          is_error: true,
          errorCode: "edit_file_failed",
          recovery: recoverableToolFailure(
            "edit_retry",
            "Inspect the current file lines with view_code/read_file, then retry edit_file with a narrower exact text, line range, character range, or insert operation.",
          ),
        };
      }
      const afterContent = result.changed ? await readOriginalContentForSyntaxCheck(result.path) : beforeContent;
      const fileChange = result.changed ? createFileChangeSummary(result.path, beforeContent, afterContent, "update") : undefined;
      const summary = result.changed ? await buildComputerFileIndex(roots, settings.scope).catch(() => undefined) : undefined;
      const qualityWarnings = result.qualityWarnings;

      return {
        content: [
          `Path: ${result.path}`,
          `Operation: ${result.operation}`,
          `Changed: ${result.changed ? "yes" : "no"}`,
          `Replacements: ${result.replacements}`,
          `Bytes written: ${result.bytesWritten}`,
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
          formatTextQualityWarnings(qualityWarnings),
          "",
          result.preview,
        ].join("\n"),
        executed: result.changed,
        fileChanges: fileChange ? [fileChange] : undefined,
        recovery: qualityWarnings.length > 0
          ? recoverableToolFailure(
              "edit_retry",
              "Inspect or edit the changed file and fix the quality warnings before finalizing.",
            )
          : undefined,
      };
    }
    case "write_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const rawPath = firstArg(call.args, ["path", "file_path", "file"]);
      const content = argValue(call.args, ["content", "text", "body"]);

      if (!rawPath || content === undefined) {
        return {
          content: "Skipped because write_file requires both path and content.",
          executed: false,
          recovery: recoverableToolFailure(
            "write_retry",
            "Retry with both path and content, or switch to edit_file if the target already exists and only needs a targeted change.",
          ),
        };
      }

      const path = resolveWorkspacePath(rawPath, roots);
      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Write blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      onTerminalProgress?.({
        output: `Preparing file write: ${path}`,
      });

      let existingFile: ComputerReadFileResult | undefined;
      try {
        existingFile = await readComputerTextFile(path);
      } catch (error) {
        const message = readLocalToolErrorMessage(error);
        if (!isMissingTextFileError(message)) {
          return {
            content: `Skipped because write_file cannot safely replace the existing target as text: ${message}`,
            executed: false,
            recovery: recoverableToolFailure(
              "write_retry",
              "Inspect the target with read_file/view_code if it is text, then use edit_file for targeted changes or a guarded write_file only after a fresh read.",
            ),
          };
        }
      }

      const replaceEntireFile = booleanArg(call.args, ["replace_entire_file", "replaceEntireFile", "full_replace", "fullReplace", "allow_full_rewrite", "allowFullRewrite"], false);
      const expectedSha256 = firstArg(call.args, ["expected_sha256", "expectedSha256", "if_match_sha256", "ifMatchSha256", "sha256"]);

      if (existingFile && !replaceEntireFile) {
        return {
          content: [
            `Skipped because write_file is create-only by default for existing files: ${existingFile.path}`,
            "Use edit_file/inline_edit with old_text/new_text, start_line/end_line/content, insert_at_line/content, or start_char/end_char/content for normal code edits.",
            "Only retry write_file for an intentional full-file replacement after re-reading the current file and passing replace_entire_file=true plus expected_sha256 from that read.",
          ].join("\n"),
          executed: false,
          recovery: recoverableToolFailure(
            "write_retry",
            "Use edit_file/inline_edit for the existing file, or re-read it and retry write_file only with replace_entire_file=true plus expected_sha256 for an intentional full replacement.",
          ),
        };
      }

      if (existingFile?.sha256 && !expectedSha256) {
        return {
          content: [
            `Skipped because full-file replacement of ${existingFile.path} requires expected_sha256.`,
            `Current sha256 from the latest read is ${existingFile.sha256}.`,
            "Prefer edit_file for targeted changes. If replacing the entire file is truly intended, re-read the file and retry write_file with replace_entire_file=true and expected_sha256 set to the sha256 from that read.",
          ].join("\n"),
          executed: false,
          recovery: recoverableToolFailure(
            "write_retry",
            "Prefer edit_file for the targeted change; if a full replacement is intended, re-read the file and retry write_file with replace_entire_file=true and expected_sha256.",
          ),
        };
      }

      if (existingFile?.sha256 && expectedSha256 && existingFile.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        return {
          content: [
            `Skipped because expected_sha256 does not match the current file: ${existingFile.path}`,
            `Expected: ${expectedSha256}`,
            `Current: ${existingFile.sha256}`,
            "Re-read the file before retrying, or switch to edit_file with exact current text.",
          ].join("\n"),
          executed: false,
          recovery: recoverableToolFailure(
            "write_retry",
            "Re-read the current file, then retry with the new expected_sha256 or switch to edit_file with exact current text.",
          ),
        };
      }

      const originalContent = existingFile?.content;
      try {
        assertSyntaxBeforeWrite(path, content, { originalContent });
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : String(error),
          executed: false,
          is_error: true,
          errorCode: "pre_write_syntax_check",
          recovery: recoverableToolFailure(
            "syntax_retry",
            "Inspect the syntax error, fix the generated content, and retry with edit_file for targeted corrections or guarded write_file for an intentional full replacement.",
          ),
        };
      }

      onTerminalProgress?.({
        output: `${existingFile ? "Replacing" : "Writing"} file: ${path}`,
      });

      const result = await writeComputerTextFile(path, content, roots, {
        createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs"], true),
        expectedSha256: existingFile?.sha256 ? expectedSha256 : undefined,
        overwrite: booleanArg(call.args, ["overwrite"], true),
      });
      const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
      const qualityWarnings = collectTextQualityWarnings(result.path, content);

      return {
        content: [
          `Path: ${result.path}`,
          `Bytes written: ${result.bytesWritten}`,
          `Created: ${result.created ? "yes" : "no"}`,
          result.created ? "Replacement guard: new file" : "Replacement guard: explicit full-file replacement with expected_sha256",
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
          formatTextQualityWarnings(qualityWarnings),
        ].join("\n"),
        executed: true,
        fileChanges: [createFileChangeSummary(result.path, originalContent, content, result.created ? "create" : "update")].filter(
          (change): change is NonNullable<ChatToolCall["fileChanges"]>[number] => Boolean(change),
        ),
        recovery: qualityWarnings.length > 0
          ? recoverableToolFailure(
              "write_retry",
              "Inspect or edit the written file and fix the quality warnings before finalizing.",
            )
          : undefined,
      };
    }
    default:
      return {
        content: `Unknown local computer tool request was ignored.\nRaw request: ${call.raw}`,
        executed: false,
      };
  }
}

async function executeLocalGitToolCall(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
): Promise<LocalComputerToolCallResult> {
  const shell = terminalShellFromArgs(call.args);
  const workingDirectory = resolveTerminalWorkingDirectory(call.args, roots);
  const command = createGitCommand(call, shell, workingDirectory);
  const mutating = MUTATING_TOOL_NAMES.has(call.tool);
  const policy = getGitRunPolicy(settings, roots, workingDirectory, mutating);

  if (!policy.allowed) {
    return {
      content: `Git command blocked: ${policy.reason}`,
      executed: false,
    };
  }

  if (!command) {
    return {
      content: `${formatToolName(call.tool)} skipped: missing required Git arguments.`,
      executed: false,
    };
  }

  const timeoutMs = terminalTimeoutFromArgs(call.args);
  const result = onTerminalProgress
    ? await runTerminalCommandWithBestProgressRunner({
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

  return {
    content: formatTerminalRunResult(command, result, `Git tool: ${formatToolName(call.tool)}`, {
      maxStreamChars: MAX_GIT_TOOL_RESULT_OUTPUT_CHARS,
    }),
    executed: true,
    terminal: createTerminalToolMetadata(command, result),
  };
}

function createGitCommand(call: ParsedLocalComputerToolCall, shell: TerminalShellId, workingDirectory: string) {
  const paths = parseGitPaths(call.args, workingDirectory);
  const all = booleanArg(call.args, ["all", "all_files", "allFiles"], false);
  const remote = firstArg(call.args, ["remote"]);
  const branch = firstArg(call.args, ["branch", "ref"]);

  switch (call.tool) {
    case "git_init": {
      const initialBranch = firstArg(call.args, ["initial_branch", "initialBranch", "branch", "default_branch", "defaultBranch"]) || "main";
      const headRef = `refs/heads/${initialBranch}`;
      if (shell === "powershell") {
        return `git init; if ($LASTEXITCODE -eq 0) { git symbolic-ref HEAD ${quoteShellArg(headRef, shell)} }`;
      }
      return `git init && git symbolic-ref HEAD ${quoteShellArg(headRef, shell)}`;
    }
    case "git_status":
      return "git --no-pager status --short --branch --untracked-files=all";
    case "git_diff": {
      return createGitDiffCommand(call, shell, paths);
    }
    case "git_log": {
      const limit = optionalNumberArg(call.args, ["limit", "count", "n"]);
      return ["git", "log", "--oneline", "--decorate", limit !== undefined ? `-n ${Math.max(1, Math.trunc(limit))}` : ""].filter(Boolean).join(" ");
    }
    case "git_stage":
      if (all) {
        return "git add -A";
      }
      return paths.length > 0 ? ["git", "add", "--", ...paths.map((path) => quoteShellArg(path, shell))].join(" ") : "";
    case "git_unstage":
      if (all) {
        return "git restore --staged .";
      }
      return paths.length > 0 ? ["git", "restore", "--staged", "--", ...paths.map((path) => quoteShellArg(path, shell))].join(" ") : "";
    case "git_commit": {
      const message = firstArg(call.args, ["message", "commit_message", "commitMessage"]);
      return message ? `git commit -m ${quoteShellArg(message, shell)}` : "";
    }
    case "git_push": {
      const setUpstream = booleanArg(call.args, ["set_upstream", "setUpstream", "upstream"], false);
      const forceWithLease = booleanArg(call.args, ["force_with_lease", "forceWithLease"], false);
      const targetRemote = remote || (branch ? "origin" : "");
      return ["git", "push", forceWithLease ? "--force-with-lease" : "", setUpstream ? "--set-upstream" : "", targetRemote ? quoteShellArg(targetRemote, shell) : "", branch ? quoteShellArg(branch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_pull": {
      const rebase = booleanArg(call.args, ["rebase"], false);
      const targetRemote = remote || (branch ? "origin" : "");
      return ["git", "pull", rebase ? "--rebase" : "", targetRemote ? quoteShellArg(targetRemote, shell) : "", branch ? quoteShellArg(branch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_fetch": {
      const prune = booleanArg(call.args, ["prune"], true);
      return ["git", "fetch", prune ? "--prune" : "", remote ? quoteShellArg(remote, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_branch": {
      const namedBranch = firstArg(call.args, ["name", "branch", "ref"]);
      const createRequested = booleanArg(call.args, ["create", "new"], false);
      const deleteRequested = booleanArg(call.args, ["delete"], false);
      const newBranch = firstArg(call.args, ["new_branch", "newBranch"]) || (createRequested ? namedBranch : "");
      const deleteBranch = firstArg(call.args, ["delete_branch", "deleteBranch"]) || (deleteRequested ? namedBranch : "");
      const force = booleanArg(call.args, ["force"], false);

      if (deleteBranch) {
        return ["git", "branch", force ? "-D" : "-d", quoteShellArg(deleteBranch, shell)].join(" ");
      }

      if (newBranch) {
        const base = firstArg(call.args, ["base", "base_branch", "baseBranch", "from"]);
        return ["git", "branch", quoteShellArg(newBranch, shell), base ? quoteShellArg(base, shell) : ""].filter(Boolean).join(" ");
      }

      return ["git", "branch", "--all", "--verbose", namedBranch && !createRequested && !deleteRequested ? "--list" : "", namedBranch && !createRequested && !deleteRequested ? quoteShellArg(namedBranch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_checkout": {
      const target = firstArg(call.args, ["branch", "ref", "name"]);
      const create = booleanArg(call.args, ["create", "new", "new_branch", "newBranch"], false);
      const base = firstArg(call.args, ["base", "base_branch", "baseBranch", "from"]);

      if (!target) {
        return "";
      }

      return create
        ? ["git", "switch", "-c", quoteShellArg(target, shell), base ? quoteShellArg(base, shell) : ""].filter(Boolean).join(" ")
        : ["git", "switch", quoteShellArg(target, shell)].join(" ");
    }
    default:
      return "";
  }
}

function createGitDiffCommand(call: ParsedLocalComputerToolCall, shell: TerminalShellId, paths: string[]) {
  const staged = booleanArg(call.args, ["staged", "cached"], false);
  const statOnly = booleanArg(call.args, ["stat", "summary"], false);
  const includeUntracked = booleanArg(call.args, ["include_untracked", "includeUntracked", "untracked"], !staged);
  const target = staged ? "--cached" : "HEAD";
  const trackedCommand = [
    "git",
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-color",
    target,
    "--stat",
    statOnly ? "" : "--patch",
    ...gitPathspecArgs(paths, shell),
  ].filter(Boolean).join(" ");

  if (staged || !includeUntracked) {
    return trackedCommand;
  }

  return appendUntrackedGitDiffDump(trackedCommand, paths, shell, statOnly);
}

function appendUntrackedGitDiffDump(trackedCommand: string, paths: string[], shell: TerminalShellId, statOnly: boolean) {
  const untrackedCommand = [
    "git",
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...paths.map((path) => quoteShellArg(path, shell)),
  ].filter(Boolean).join(" ");

  if (shell === "powershell") {
    const body = statOnly
      ? [
          "$__gilbert_untracked = @(" + untrackedCommand + ")",
          "if ($__gilbert_untracked.Count -gt 0) { Write-Output ''; Write-Output 'UNTRACKED FILES'; $__gilbert_untracked }",
        ].join("; ")
      : [
          `$__gilbert_max_untracked_bytes = ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT}`,
          "$__gilbert_untracked = @(" + untrackedCommand + ")",
          "if ($__gilbert_untracked.Count -gt 0) {",
          "Write-Output ''; Write-Output 'UNTRACKED FILES (full text for text files)'",
          "foreach ($__p in $__gilbert_untracked) {",
          "Write-Output ''; Write-Output ('===== UNTRACKED FILE: ' + $__p + ' =====')",
          "if (Test-Path -LiteralPath $__p -PathType Leaf) {",
          "$__full = (Resolve-Path -LiteralPath $__p).Path",
          "$__bytes = [System.IO.File]::ReadAllBytes($__full)",
          "$__take = [Math]::Min($__bytes.Length, $__gilbert_max_untracked_bytes)",
          "if ([Array]::IndexOf($__bytes, [byte]0) -ge 0) { Write-Output '[binary file omitted from text diff]' } else { Write-Output ([System.Text.Encoding]::UTF8.GetString($__bytes, 0, $__take)); if ($__bytes.Length -gt $__take) { Write-Output ('[untracked file text truncated after ' + $__take + ' bytes of ' + $__bytes.Length + ' bytes]') } }",
          "} else { Write-Output '[not a regular file]' }",
          "}",
          "}",
        ].join("; ");
    return `${trackedCommand}; ${body}`;
  }

  if (shell === "bash" || shell === "zsh" || shell === "sh") {
    const listCommand = untrackedCommand;
    const body = statOnly
      ? `printf '\\nUNTRACKED FILES\\n'; ${listCommand}`
      : [
          `${listCommand} | while IFS= read -r __p; do`,
          `printf '\\n===== UNTRACKED FILE: %s =====\\n' "$__p";`,
          `if [ -f "$__p" ]; then if LC_ALL=C grep -Iq . "$__p"; then __size=$(wc -c < "$__p" 2>/dev/null || printf 0); head -c ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} "$__p"; if [ "$__size" -gt ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} ] 2>/dev/null; then printf '\\n[untracked file text truncated after ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} bytes of %s bytes]\\n' "$__size"; fi; else printf '[binary file omitted from text diff]\\n'; fi; else printf '[not a regular file]\\n'; fi;`,
          "done",
        ].join(" ");
    return `${trackedCommand}; if [ -n "$(${listCommand})" ]; then ${body}; fi`;
  }

  return `${trackedCommand} & echo. & echo UNTRACKED FILES & ${untrackedCommand}`;
}

function gitPathspecArgs(paths: string[], shell: TerminalShellId) {
  return paths.length > 0 ? ["--", ...paths.map((path) => quoteShellArg(path, shell))] : [];
}

function parseGitPaths(args: Record<string, string>, workingDirectory?: string) {
  const rawJson = firstArg(args, ["paths_json", "pathsJson"]);

  if (rawJson) {
    return filterGitPathspecs(parseGitPathList(rawJson), workingDirectory);
  }

  const raw = firstArg(args, ["paths", "path", "file_path", "file", "files"]);

  if (!raw) {
    return [];
  }

  return filterGitPathspecs(parseGitPathList(raw), workingDirectory);
}

function parseGitPathList(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  const parsedJsonPaths = parseJsonGitPathList(trimmed);

  if (parsedJsonPaths) {
    return parsedJsonPaths;
  }

  return trimmed.split(/[\n,]/).map(normalizeGitPath).filter(Boolean);
}

function parseJsonGitPathList(raw: string): string[] | undefined {
  if (!raw.startsWith("[") && !raw.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed)
        ? parsed.paths ?? parsed.files ?? parsed.pathspecs
        : undefined;

    if (!Array.isArray(items)) {
      return undefined;
    }

    return items.map(normalizeGitPathItem).filter(Boolean);
  } catch {
    return undefined;
  }
}

function normalizeGitPathItem(item: unknown) {
  if (typeof item === "string" || typeof item === "number") {
    return normalizeGitPath(String(item));
  }

  if (isRecord(item)) {
    const path = item.path ?? item.file ?? item.file_path;
    return typeof path === "string" || typeof path === "number" ? normalizeGitPath(String(path)) : "";
  }

  return "";
}

function normalizeGitPath(path: string) {
  const normalized = path.trim();

  if (!normalized || normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    return "";
  }

  return normalized;
}

function filterGitPathspecs(paths: string[], workingDirectory?: string) {
  if (!workingDirectory) {
    return paths;
  }

  const normalizedWorkingDirectory = normalizeComparablePath(workingDirectory);

  return paths.filter((path) => {
    const normalizedPath = normalizeComparablePath(path);
    return normalizedPath !== normalizedWorkingDirectory;
  });
}

function quoteShellArg(value: string, shell: TerminalShellId) {
  const normalized = value.replace(/\0/g, "");

  if (shell === "cmd") {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  if (shell === "powershell") {
    return `'${normalized.replace(/'/g, "''")}'`;
  }

  return `'${normalized.replace(/'/g, "'\\''")}'`;
}

function getGitRunPolicy(settings: LocalWorkspaceSettings, roots: string[], workingDirectory: string, mutating: boolean) {
  if (!isTauriDesktopRuntime()) {
    return {
      allowed: false,
      reason: "Git tools are available only in the Tauri desktop app.",
    };
  }

  if (mutating && settings.permissionMode === "read-only") {
    return {
      allowed: false,
      reason: "read-only mode blocks Git mutations.",
    };
  }

  if (roots.length === 0 || !workingDirectory) {
    return {
      allowed: false,
      reason: "no workspace folder is open. Ask the user to pick a folder, then retry.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(workingDirectory, root))) {
    return {
      allowed: false,
      reason: `the working directory "${workingDirectory}" is outside the workspace roots ${roots.join(" | ")}. Retry with a cwd inside one of these roots.`,
    };
  }

  return {
    allowed: true,
  };
}

function createGitApprovalPreview(call: ParsedLocalComputerToolCall) {
  const workingDirectory = firstArg(call.args, ["working_directory", "cwd", "directory", "path"]);
  const message = firstArg(call.args, ["message", "commit_message", "commitMessage"]);
  const branch = firstArg(call.args, ["branch", "ref", "name", "new_branch", "newBranch"]);
  const paths = firstArg(call.args, ["paths", "path", "file_path", "file", "files", "paths_json"]);
  const remote = firstArg(call.args, ["remote"]);

  return [
    `Operation: ${formatToolName(call.tool)}`,
    workingDirectory ? `Working directory: ${workingDirectory}` : undefined,
    branch ? `Branch/ref: ${branch}` : undefined,
    remote ? `Remote: ${remote}` : undefined,
    message ? `Message: ${message}` : undefined,
    paths ? `Paths: ${limitInlineValue(paths, 1200)}` : undefined,
  ].filter(Boolean).join("\n");
}

async function executeTerminalCommandTool(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
  toolSettings?: ToolRegistrySettings,
): Promise<LocalComputerToolCallResult> {
  const rawCommand = argValue(call.args, ["command", "cmd", "input", "script"]);

  if (!rawCommand?.trim()) {
    return {
      content: "Skipped because run_terminal requires a command.",
      executed: false,
    };
  }

  const preparedCommand = prepareTerminalCommand(rawCommand, call.args, roots);
  let { command } = preparedCommand;
  const { workingDirectory } = preparedCommand;

  if (!command.trim()) {
    return {
      content: "Skipped because run_terminal requires a command after resolving the working directory.",
      executed: false,
    };
  }

  // Hard workspace-boundary guard. The deeper getTerminalRunPolicy() check
  // does the same, but surfacing this with the actual resolved path keeps
  // the error legible to the model — and stops any later code from running
  // even one step with an out-of-roots cwd.
  if (preparedCommand.outOfRoots) {
    return {
      content: `Refusing to run a terminal command outside the workspace roots. Resolved working directory: ${workingDirectory || "(unresolved)"}. Workspace roots: ${roots.length > 0 ? roots.join(" | ") : "(none)"}. Re-issue the command with a cwd inside one of the workspace roots.`,
      executed: false,
    };
  }

  const directFileMutationReason = getDirectFileMutationReason(command, toolSettings);

  if (directFileMutationReason) {
    return {
      content: directFileMutationReason,
      executed: false,
      recovery: recoverableToolFailure(
        "terminal_structured_edit",
        "Do not retry the shell write. Inspect the target with view_code/read_file, then use edit_file for existing source files or write_file/create_files for new files.",
      ),
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

  // Dev servers and watchers are intentionally owned by Gilbert's terminal
  // session manager so the model can start them, return quickly, and keep the
  // live session attachable in the Activity rail.
  const isLongRunningCommand = isLongRunningProcessCommand(command);
  const explicitBackground = booleanArg(call.args, ["background", "persistent", "keep_alive", "keepAlive", "dev_server", "devServer"], false);
  const runInBackground = isLongRunningCommand || explicitBackground;
  const devServerPlan = runInBackground
    ? await prepareManagedDevServerCommand(command, call.args, shell, workingDirectory, signal)
    : undefined;

  if (devServerPlan?.command) {
    command = devServerPlan.command;
  }

  const requestedTimeoutMs = terminalTimeoutFromArgs(call.args);
  const timeoutMs = runInBackground
    ? requestedTimeoutMs
    : effectiveTerminalTimeoutMs(command, requestedTimeoutMs, hasExplicitTerminalTimeoutArg(call.args));
  const result: TerminalRunCommandResponse & { managedCommand?: string; managedDetail?: string; sessionId?: string } = runInBackground
    ? await runManagedBackgroundTerminalCommand({
        command,
        devServerPlan,
        onProgress: onTerminalProgress,
        shell,
        signal,
        workingDirectory,
      })
    : onTerminalProgress
    ? await runTerminalCommandWithBestProgressRunner({
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
  if (result.managedCommand) {
    command = result.managedCommand;
  }
  if (runInBackground && result.sessionId) {
    updateBackgroundTerminalSession(result.sessionId, {
      browserPreviewUrl,
      outputPreview: `${result.stdout}\n${result.stderr}`,
    });
  }
  const details = [
    runInBackground ? result.sessionId ? `Background session: running (${result.sessionId})` : "Background session: command completed before returning" : "",
    runInBackground && isLongRunningCommand ? "Long-running command was started as a managed background terminal session." : "",
    !runInBackground && timeoutMs > requestedTimeoutMs ? `Terminal timeout automatically extended to ${Math.round(timeoutMs / 1000)} seconds for package setup/install work.` : "",
    result.managedDetail ?? devServerPlan?.detail ?? "",
    preparedCommand.rebasedFromCommand ? `Working directory resolved from command: ${workingDirectory}` : "",
    browserPreviewUrl ? `Browser preview URL: ${browserPreviewUrl}` : "",
    createPackageSetupTimeoutRecoveryHint(command, result),
    createTerminalFailureRecoveryHint(command, result, roots),
  ].filter(Boolean).join("\n");

  return {
    browserPreviewUrl,
    content: formatTerminalRunResult(command, result, details || undefined),
    executed: true,
    terminal: createTerminalToolMetadata(command, result),
  };
}

function describeMcpServer(server: McpServerConfig): string {
  const transportLine = server.transport === "remote"
    ? `remote ${server.serverUrl || "(missing URL)"}`
    : `stdio ${server.command || "(missing command)"} ${server.args.replace(/\s+/g, " ")}`.trim();
  const flags = [
    server.enabled ? "enabled" : "disabled",
    `approval=${server.requireApproval}`,
    server.deferLoading ? "defer-loading" : "eager-loading",
    server.authorization.trim() ? "token-stored" : "no-token",
    server.allowedTools.trim() ? `allow=${server.allowedTools.replace(/\s+/g, " ")}` : "no-allowlist",
  ].join("; ");
  return `- ${server.label}: ${transportLine}; ${flags}.${server.description.trim() ? ` Purpose: ${server.description.trim()}` : ""}`;
}

function executeMcpListServersTool(mcpContext?: McpToolContext): LocalComputerToolCallResult {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (settings.servers.length === 0) {
    return { content: "No MCP servers are configured. Use mcp_set_server to add one.", executed: true };
  }
  const lines = [
    `MCP gate: ${settings.enabled ? "enabled" : "disabled"}.`,
    "Configured MCP servers:",
    ...settings.servers.map(describeMcpServer),
  ];
  return { content: lines.join("\n"), executed: true };
}

async function executeMcpListToolsTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
  signal?: AbortSignal,
): Promise<LocalComputerToolCallResult> {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (!settings.enabled) {
    return { content: "MCP is disabled on the MCP page.", executed: false };
  }
  const requestedLabel = firstArg(call.args, ["server_label", "label", "server", "name"]);
  const forceRefresh = booleanArg(call.args, ["force_refresh", "force", "refresh", "no_cache"], false);

  const candidates = requestedLabel
    ? settings.servers.filter((server) => normalizeMcpServerLabel(server.label) === normalizeMcpServerLabel(requestedLabel))
    : settings.servers.filter((server) => server.enabled);

  if (candidates.length === 0) {
    return {
      content: requestedLabel
        ? `No MCP server matches label "${requestedLabel}".`
        : "No MCP servers are enabled. Enable a server with mcp_set_server enabled=true or use mcp_list_servers to inspect state.",
      executed: false,
    };
  }

  const sections: string[] = [];
  for (const server of candidates) {
    if (server.transport !== "remote") {
      sections.push(`SERVER ${server.label} (${server.transport}): in-app stdio MCP execution is not wired yet. Configure as remote HTTPS, or copy the local config to an MCP-compatible desktop client.`);
      continue;
    }
    try {
      const tools = await mcpListTools(server, { force: forceRefresh, signal });
      if (tools.length === 0) {
        sections.push(`SERVER ${server.label}: no tools exposed.`);
        continue;
      }
      const allowList = server.allowedTools.trim() ? new Set(server.allowedTools.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)) : null;
      const lines = tools.map((tool) => {
        const allowed = !allowList || allowList.has(tool.name) ? "" : " [blocked by allow-list]";
        const description = tool.description ? ` — ${tool.description.replace(/\s+/g, " ")}` : "";
        return `  - ${tool.name}${allowed}${description}`;
      });
      sections.push(`SERVER ${server.label} (${tools.length} tools):\n${lines.join("\n")}`);
    } catch (error) {
      sections.push(`SERVER ${server.label}: tools/list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { content: sections.join("\n\n"), executed: true };
}

async function executeMcpCallTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
  signal?: AbortSignal,
): Promise<LocalComputerToolCallResult> {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (!settings.enabled) {
    return { content: "MCP is disabled on the MCP page.", executed: false };
  }
  const label = firstArg(call.args, ["server_label", "label", "server"]);
  const toolName = firstArg(call.args, ["tool_name", "name", "tool"]);
  if (!label || !toolName) {
    return { content: "mcp_call_tool needs both server_label and tool_name.", executed: false };
  }
  const server = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === normalizeMcpServerLabel(label));
  if (!server) {
    return { content: `No MCP server matches label "${label}".`, executed: false };
  }
  if (!server.enabled) {
    return { content: `MCP server "${label}" is disabled. Enable it with mcp_set_server enabled=true first.`, executed: false };
  }
  if (server.transport !== "remote") {
    return {
      content: `MCP server "${label}" uses stdio transport, which the in-app client does not run yet. Switch the server to a remote HTTPS endpoint or invoke it from a desktop MCP client.`,
      executed: false,
    };
  }
  if (server.allowedTools.trim()) {
    const allowed = server.allowedTools.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(toolName)) {
      return { content: `Tool "${toolName}" is not in the allow-list for server "${label}" (${allowed.join(", ")}).`, executed: false };
    }
  }

  const args = parseMcpArguments(firstArg(call.args, ["arguments_json", "arguments", "args", "input", "payload"]));

  try {
    const result = await mcpCallTool(server, toolName, args, { signal });
    const summary = flattenMcpContent(result.content) || "(empty result)";
    const structured = result.structuredContent ? `\n\nStructured:\n${JSON.stringify(result.structuredContent, null, 2)}` : "";
    if (result.isError) {
      return { content: `MCP tool ${label}.${toolName} reported error:\n${summary}${structured}`, executed: false };
    }
    return { content: `MCP tool ${label}.${toolName} result:\n${summary}${structured}`, executed: true };
  } catch (error) {
    return {
      content: `MCP tool ${label}.${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      executed: false,
    };
  }
}

function parseMcpArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function executeMcpSetServerTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
): LocalComputerToolCallResult {
  if (!mcpContext?.onSettingsChange) {
    return { content: "MCP settings cannot be mutated in this run (no host callback registered).", executed: false };
  }
  const label = firstArg(call.args, ["label", "name", "server_label"]);
  if (!label) {
    return { content: "mcp_set_server needs label.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  const targetLabel = normalizeMcpServerLabel(label);
  const existing = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === targetLabel);
  const transport: McpServerTransport = (() => {
    const raw = firstArg(call.args, ["transport"])?.toLowerCase();
    if (raw === "stdio") return "stdio";
    if (raw === "remote") return "remote";
    return existing?.transport ?? "remote";
  })();

  const requireApprovalArg = firstArg(call.args, ["require_approval", "approval"]);
  const enabledArg = firstArg(call.args, ["enabled", "enable"]);
  const deferLoadingArg = firstArg(call.args, ["defer_loading", "defer"]);
  const now = new Date().toISOString();

  const merged: McpServerConfig = {
    allowedTools: firstArg(call.args, ["allowed_tools", "allow_tools", "allow"]) ?? existing?.allowedTools ?? "",
    args: firstArg(call.args, ["args", "command_args"]) ?? existing?.args ?? "",
    authorization: firstArg(call.args, ["authorization", "auth", "token", "bearer"]) ?? existing?.authorization ?? "",
    command: firstArg(call.args, ["command", "cmd"]) ?? existing?.command ?? "",
    createdAt: existing?.createdAt ?? now,
    deferLoading: deferLoadingArg !== undefined ? parseBoolean(deferLoadingArg, true) : existing?.deferLoading ?? true,
    description: firstArg(call.args, ["description", "purpose", "summary"]) ?? existing?.description ?? "",
    enabled: enabledArg !== undefined ? parseBoolean(enabledArg, true) : existing?.enabled ?? true,
    env: firstArg(call.args, ["env", "environment"]) ?? existing?.env ?? "",
    id: existing?.id ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: targetLabel,
    requireApproval: requireApprovalArg === "never" ? "never" : existing?.requireApproval ?? "always",
    serverUrl: firstArg(call.args, ["server_url", "url", "endpoint"]) ?? existing?.serverUrl ?? "",
    transport,
    updatedAt: now,
  };

  if (merged.transport === "remote" && !merged.serverUrl.trim()) {
    return { content: "mcp_set_server needs server_url for transport=remote.", executed: false };
  }
  if (merged.transport === "stdio" && !merged.command.trim()) {
    return { content: "mcp_set_server needs command for transport=stdio.", executed: false };
  }

  const nextServers = existing
    ? settings.servers.map((entry) => (entry.id === existing.id ? merged : entry))
    : [...settings.servers, merged];

  const nextSettings: McpSettings = { ...settings, servers: nextServers };
  mcpContext.onSettingsChange(nextSettings);
  mcpContext.settings = nextSettings;

  return {
    content: `${existing ? "Updated" : "Added"} MCP server "${merged.label}".\n${describeMcpServer(merged)}`,
    executed: true,
  };
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const trimmed = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "enable", "enabled"].includes(trimmed)) return true;
  if (["false", "0", "no", "off", "disable", "disabled"].includes(trimmed)) return false;
  return fallback;
}

function executeMcpRemoveServerTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
): LocalComputerToolCallResult {
  if (!mcpContext?.onSettingsChange) {
    return { content: "MCP settings cannot be mutated in this run (no host callback registered).", executed: false };
  }
  const label = firstArg(call.args, ["label", "name", "server_label"]);
  if (!label) {
    return { content: "mcp_remove_server needs label.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  const targetLabel = normalizeMcpServerLabel(label);
  const existing = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === targetLabel);
  if (!existing) {
    return { content: `No MCP server matches label "${label}".`, executed: false };
  }
  const nextServers = settings.servers.filter((entry) => entry.id !== existing.id);
  const nextSettings: McpSettings = { ...settings, servers: nextServers };
  mcpContext.onSettingsChange(nextSettings);
  mcpContext.settings = nextSettings;
  return { content: `Removed MCP server "${existing.label}".`, executed: true };
}

async function executeOpenBrowserPreviewTool(call: ParsedLocalComputerToolCall, roots: string[], userPrompt: string, signal?: AbortSignal) {
  const browserSearchQuery = firstArg(call.args, ["query", "search", "q", "terms"]);
  const browserSearchUrl = browserSearchQuery ? createBrowserPreviewSearchUrl(browserSearchQuery, firstArg(call.args, ["search_engine", "searchEngine", "engine", "provider"])) : undefined;
  const modelProvidedUrl = firstArg(call.args, ["url", "href", "address", "target", "page"]);
  const rawUrl =
    modelProvidedUrl ??
    browserSearchUrl ??
    findBrowserPreviewUrl(argValue(call.args, ["text", "output", "content"]) ?? "", {
      excludeCurrentRuntime: true,
    }) ??
    (browserSearchQuery ? undefined : await findBrowserPreviewUrlFromBackgroundSessions(roots, signal));
  const browserPreviewUrl = normalizeBrowserPreviewUrl(rawUrl);

  if (!browserPreviewUrl) {
    return {
      content: "Skipped because open_browser_preview could not find a URL, bare domain, query, or tracked background dev-server session.",
      executed: false,
      is_error: true,
      errorCode: "no_preview_url",
    };
  }

  const trackedSessionUrl = modelProvidedUrl ? await findBrowserPreviewUrlFromBackgroundSessions(roots, signal) : undefined;
  const blockedLocalPort = modelProvidedUrl
    ? findUnrequestedUncommonLocalPreviewPort(browserPreviewUrl, userPrompt, trackedSessionUrl)
    : undefined;

  if (blockedLocalPort !== undefined) {
    return {
      content:
        `Skipped because localhost port ${blockedLocalPort} is not in the common dev-server preview ports and was not requested by the user. ` +
        "Use the exact URL printed by a tracked dev-server session or ask for that port explicitly.",
      executed: false,
      is_error: true,
      errorCode: "unrequested_uncommon_preview_port",
    };
  }

  // If the model passed a URL that doesn't match any actually-bound dev-server
  // session, flag the mismatch in the result body so the model can self-correct
  // instead of silently opening a URL nothing is listening on.
  let mismatchHint = "";
  if (modelProvidedUrl) {
    const sessionUrl = trackedSessionUrl;
    if (sessionUrl && normalizeBrowserPreviewUrl(sessionUrl) !== browserPreviewUrl) {
      mismatchHint =
        `\nHeads-up: a tracked dev-server session is bound to ${sessionUrl} but you asked to open ${browserPreviewUrl}. ` +
        `If the page does not load, retry with url=${sessionUrl}.`;
    }
  }

  return {
    browserPreviewUrl,
    content: `Browser preview opened: ${browserPreviewUrl}${mismatchHint}`,
    executed: true,
  };
}

async function findBrowserPreviewUrlFromBackgroundSessions(roots: string[], signal?: AbortSignal) {
  const sessions = orderBackgroundPreviewSessions(getBackgroundTerminalSessions(), roots);

  for (const session of sessions) {
    const directUrl = findBrowserPreviewUrl(`${session.browserPreviewUrl ?? ""}\n${session.outputPreview ?? ""}\n${session.command}`, {
      excludeCurrentRuntime: true,
    });

    if (directUrl) {
      return directUrl;
    }
  }

  for (const session of sessions) {
    if (!isLikelyDevServerCommand(session.command)) {
      continue;
    }

    const probedUrl = await findReachableLocalPreviewUrl(session.command, session.outputPreview ?? "", signal);

    if (probedUrl) {
      updateBackgroundTerminalSession(session.sessionId, {
        browserPreviewUrl: probedUrl,
        outputPreview: session.outputPreview,
      });
      return probedUrl;
    }
  }

  return findReachableKnownLocalPreviewUrl(signal);
}

function orderBackgroundPreviewSessions(sessions: ReturnType<typeof getBackgroundTerminalSessions>, roots: string[]) {
  return [...sessions].sort((left, right) => scoreBackgroundPreviewSession(right, roots) - scoreBackgroundPreviewSession(left, roots));
}

function scoreBackgroundPreviewSession(session: ReturnType<typeof getBackgroundTerminalSessions>[number], roots: string[]) {
  const inWorkspace = session.workingDirectory && roots.some((root) => isPathInsideRoot(session.workingDirectory ?? "", root));

  return (
    (session.browserPreviewUrl ? 1_000 : 0) +
    (inWorkspace ? 400 : 0) +
    (isLikelyDevServerCommand(session.command) ? 200 : 0) +
    Math.max(0, 100 - Math.floor((Date.now() - session.lastSeenAt) / 1_000))
  );
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
  const linkLines = result.links.map((link, index) => `${index + 1}. ${link.text} -> ${link.href}`);

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

interface FileCreationExecutionOptions {
  allowedRoots?: string[];
  indexRoots?: string[];
  onProgress?: TerminalProgressHandler;
  precomputedWrites?: PreparedFileCreationWrite[];
  summaryNote?: string;
  targetRoots?: string[];
}

async function executeCreateViteProjectTool(call: ParsedLocalComputerToolCall, settings: LocalWorkspaceSettings, roots: string[], onProgress?: TerminalProgressHandler) {
  const explicitProjectPath = firstArg(call.args, ["project_path", "projectPath", "path", "directory_path", "directoryPath", "folder_path", "folderPath", "cwd", "target"]);
  const requestedNameArg = firstArg(call.args, ["project_name", "projectName", "name", "app_name", "appName", "package_name", "packageName"]);

  if (!explicitProjectPath && settings.scope === "full-computer") {
    return {
      content: [
        "Skipped create_vite_project because Full computer scope needs an explicit project_path.",
        "Use a concrete destination such as C:\\Users\\Kobe Work\\Documents\\hello so Gilbert does not guess a drive root.",
      ].join("\n"),
      executed: false,
    };
  }

  const projectRoot = resolveCreateViteProjectRoot(explicitProjectPath, roots);
  const requestedName = requestedNameArg || baseName(projectRoot) || "vite-react-app";
  const title = firstArg(call.args, ["title", "heading", "headline"]) || baseName(projectRoot) || requestedName;
  const scaffold = createViteProjectScaffold({
    author: firstArg(call.args, ["author", "byline"]),
    projectName: requestedName || baseName(projectRoot),
    subtitle: firstArg(call.args, ["subtitle", "description", "tagline"]),
    title,
    variant: firstArg(call.args, ["variant", "template", "language", "stack"]),
  });
  const packageJsonPath = joinLocalPath(projectRoot, ["package.json"]);
  const hasPackageJson = await computerPathExists(packageJsonPath, roots);
  const repairMissingRequested = booleanArg(call.args, ["repair_missing", "repairMissing", "fill_missing", "fillMissing", "repair", "overwrite", "overwrite_existing", "overwriteExisting", "force"], false);

  if (hasPackageJson && !repairMissingRequested) {
    return {
      content: [
        `Skipped create_vite_project because ${packageJsonPath} already exists.`,
        "For an existing app, inspect and edit the current files with edit_file/inline_edit instead of re-scaffolding.",
        "To repair an interrupted scaffold without touching existing files, call create_vite_project with repair_missing=true.",
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "create_retry",
        "Inspect the existing app files and use edit_file/inline_edit for changes, or retry create_vite_project with repair_missing=true only to fill missing starter files.",
      ),
    };
  }

  const writes = scaffold.files.map((file) => ({
    ...file,
    path: joinLocalPath(projectRoot, file.relativePath.split("/")),
  }));

  for (const write of writes) {
    const policy = getWritePolicy(settings, roots, write.path);

    if (!policy.allowed) {
      return {
        content: `Vite project creation blocked for ${write.path}: ${policy.reason}`,
        executed: false,
      };
    }
  }

  const results: Array<{ bytesWritten: number; created: boolean; path: string }> = [];
  const fileChanges: NonNullable<ChatToolCall["fileChanges"]> = [];
  const qualityWarnings: string[] = [];
  const skippedExistingPaths: string[] = [];

  if (writes.length > 0) {
    onProgress?.({
      output: `Preparing Vite project writes: ${writes.length} files`,
    });
  }

  for (const write of writes) {
    const existedBeforeWrite = await computerPathExists(write.path, roots);

    if (hasPackageJson && existedBeforeWrite) {
      skippedExistingPaths.push(write.path);
      continue;
    }

    const originalContent = await readOriginalContentForSyntaxCheck(write.path);

    try {
      assertSyntaxBeforeWrite(write.path, write.content, { originalContent });
    } catch (error) {
      return {
        content: `Vite project creation blocked for ${write.path}: ${error instanceof Error ? error.message : String(error)}`,
        executed: false,
        is_error: true,
        errorCode: "pre_write_syntax_check",
        recovery: recoverableToolFailure(
          "syntax_retry",
          "Fix the scaffold content that failed syntax validation, then retry file creation for the affected file.",
        ),
      };
    }

    const result = await writeComputerTextFile(write.path, write.content, roots, {
      createParentDirs: true,
      overwrite: !hasPackageJson,
    });

    results.push({
      bytesWritten: result.bytesWritten,
      created: result.created,
      path: result.path,
    });
    const fileChange = createFileChangeSummary(result.path, originalContent, write.content, result.created ? "create" : "update");
    if (fileChange) {
      fileChanges.push(fileChange);
    }
    onProgress?.({
      fileChanges: [...fileChanges],
      output: `Writing Vite project files ${results.length}/${writes.length}: ${result.path}`,
    });
    qualityWarnings.push(...collectTextQualityWarnings(result.path, write.content).map((warning) => `${result.path}: ${warning}`));
  }

  const summary = await buildComputerFileIndex([projectRoot], settings.scope).catch(() => undefined);

  return {
    content: [
      "Vite React project scaffolded.",
      `Project path: ${projectRoot}`,
      `Variant: ${scaffold.variant === "react-ts" ? "React + TypeScript" : "React + JavaScript"}`,
      `Package name: ${scaffold.packageName}`,
      `Files written: ${results.length}`,
      `Created files: ${results.filter((result) => result.created).length}`,
      `Existing starter files preserved: ${skippedExistingPaths.length}`,
      "Overwrote existing starter files: no",
      hasPackageJson ? "Repair mode: filled missing starter files only; existing files were not rewritten." : "",
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      !explicitProjectPath ? "Destination rule: project_path was omitted, so the selected workspace folder was used directly." : "",
      "",
      "Required verification commands:",
      `cwd: ${projectRoot}`,
      "1. npm install",
      "2. npm run build",
      "3. npm run dev",
      "",
      "Starter files:",
      ...results.map((result) => `- ${result.path} (${result.bytesWritten} bytes)`),
      skippedExistingPaths.length > 0 ? "Preserved existing files:" : "",
      ...skippedExistingPaths.map((path) => `- ${path}`),
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: true,
    fileChanges,
    recovery: qualityWarnings.length > 0
      ? recoverableToolFailure(
          "create_retry",
          "Inspect or edit the scaffolded files and fix the quality warnings before finalizing.",
        )
      : undefined,
  };
}

function resolveCreateViteProjectRoot(explicitProjectPath: string | undefined, roots: string[]) {
  if (!explicitProjectPath) {
    return roots[0];
  }

  return collapseDuplicatedWorkspaceProjectFolder(resolveWorkspacePath(explicitProjectPath, roots), roots);
}

function collapseDuplicatedWorkspaceProjectFolder(projectRoot: string, roots: string[]) {
  const parent = directoryName(projectRoot);
  const projectFolderName = baseName(projectRoot);

  for (const root of roots.slice().sort((left, right) => right.length - left.length)) {
    if (
      normalizeComparablePath(parent) === normalizeComparablePath(root) &&
      comparableProjectFolderName(projectFolderName) === comparableProjectFolderName(baseName(root))
    ) {
      return root;
    }
  }

  return projectRoot;
}

async function executeFileCreationTool(
  call: ParsedLocalComputerToolCall & { tool: FileCreationToolName },
  settings: LocalWorkspaceSettings,
  roots: string[],
  options: FileCreationExecutionOptions = {},
) {
  const targetRoots = options.targetRoots ?? roots;
  const allowedRoots = options.allowedRoots ?? targetRoots;
  const writes = options.precomputedWrites ?? prepareFileCreationWrites(call, targetRoots);
  const dedupedWrites = await prepareDeduplicatedWrites(writes, allowedRoots);

  for (const write of dedupedWrites) {
    const policy = getWritePolicy(settings, allowedRoots, write.path);

    if (!policy.allowed) {
      return {
        content: `File creation blocked for ${write.path}: ${policy.reason}`,
        executed: false,
      };
    }
  }

  const results: FileCreationWriteResult[] = [];
  const fileChanges: NonNullable<ChatToolCall["fileChanges"]> = [];
  const qualityWarnings = dedupedWrites.flatMap((write) =>
    collectTextQualityWarnings(write.path, write.content).map((warning) => `${write.path}: ${warning}`),
  );
  const failures: Array<{ path: string; reason: string; kind: "syntax" | "write" }> = [];

  if (dedupedWrites.length > 0) {
    options.onProgress?.({
      output: `Preparing file writes: ${dedupedWrites.length} files`,
    });
  }

  for (const write of dedupedWrites) {
    const originalContent = await readOriginalContentForSyntaxCheck(write.path);
    try {
      assertSyntaxBeforeWrite(write.path, write.content, { originalContent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: write.path, reason: message, kind: "syntax" });
      continue;
    }

    try {
      const result = await writeComputerTextFile(write.path, write.content, allowedRoots, {
        createParentDirs: write.createParentDirs,
        overwrite: write.overwrite,
      });

      results.push({
        ...write,
        write: result,
      });
      const fileChange = createFileChangeSummary(result.path, originalContent, write.content, result.created ? "create" : "update");
      if (fileChange) {
        fileChanges.push(fileChange);
      }
      options.onProgress?.({
        fileChanges: [...fileChanges],
        output: `Writing files ${results.length}/${dedupedWrites.length}: ${result.path}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: write.path, reason: message, kind: "write" });
    }
  }

  const indexRoots = options.indexRoots ?? roots;
  const indexSummary = indexRoots.length > 0 ? await buildComputerFileIndex(indexRoots, settings.scope).catch(() => undefined) : undefined;

  const requestedCount = dedupedWrites.length;
  const writtenCount = results.length;
  const failureCount = failures.length;
  // is_error semantics:
  //   - any file failed              → is_error=true (even if some succeeded)
  //   - nothing requested, nothing written → not an error, just a no-op
  const isError = failureCount > 0;
  const failureBlock = failures.length > 0
    ? [
        "",
        `Failures (${failures.length} of ${requestedCount}):`,
        ...failures.map((failure) => `- ${failure.path} [${failure.kind}]: ${failure.reason}`),
      ].join("\n")
    : "";

  return {
    content: [
      options.summaryNote,
      `Outcome: ${writtenCount}/${requestedCount} files written${failureCount > 0 ? `, ${failureCount} failed` : ""}.`,
      formatFileCreationSummary({
        indexSummary,
        results,
      }),
      failureBlock,
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: writtenCount > 0,
    is_error: isError,
    errorCode: isError ? (writtenCount === 0 ? "all_writes_failed" : "partial_write_failure") : undefined,
    fileChanges,
    recovery: isError
      ? recoverableToolFailure(
          "create_retry",
          "Inspect the failed file-creation entries, then retry only the affected files with corrected create_files/write_file content or edit_file for existing files.",
        )
      : qualityWarnings.length > 0
        ? recoverableToolFailure(
            "create_retry",
            "Inspect or edit the created files and fix the quality warnings before finalizing.",
          )
        : undefined,
  };
}

function comparableProjectFolderName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function executeDeleteFileTool(call: ParsedLocalComputerToolCall, settings: LocalWorkspaceSettings, roots: string[]) {
  const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

  if (!rawPath) {
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

  const path = resolveWorkspacePath(rawPath, roots);
  const writeCheck = getWritePolicy(settings, roots, path);

  if (!writeCheck.allowed) {
    return {
      content: `Delete blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  const beforeContent = await readOriginalContentForSyntaxCheck(path);
  const result = await deleteComputerFile(path, roots);
  const fileChange = result.deleted ? createFileChangeSummary(result.path, beforeContent, "", "delete") : undefined;
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      `Path: ${result.path}`,
      `Deleted: ${result.deleted ? "yes" : "no"}`,
      `Bytes deleted: ${result.bytesDeleted}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
    ].join("\n"),
    executed: result.deleted,
    fileChanges: fileChange ? [fileChange] : undefined,
  };
}

async function executeMovePathTool(call: ParsedLocalComputerToolCall, settings: LocalWorkspaceSettings, roots: string[]) {
  const rawFromPath = firstArg(call.args, ["from_path", "fromPath", "from", "source_path", "source", "old_path", "oldPath", "current_path", "currentPath", "path"]);
  const rawNewName = firstArg(call.args, ["new_name", "newName", "name", "file_name", "fileName", "folder_name", "folderName"]);
  const rawExplicitToPath = firstArg(call.args, ["to_path", "toPath", "destination_path", "destinationPath", "dest_path", "destPath", "target_path", "targetPath", "new_path", "newPath", "to", "destination"]);

  if (!rawFromPath) {
    return {
      content: `Skipped because ${call.tool} requires from_path or path.`,
      executed: false,
    };
  }

  const fromPath = resolveWorkspacePath(rawFromPath, roots);
  const toPath = rawExplicitToPath
    ? resolveWorkspacePath(rawExplicitToPath, roots)
    : rawNewName
      ? joinLocalPath(directoryName(fromPath), [rawNewName])
      : "";

  if (!toPath) {
    return {
      content: `Skipped because ${call.tool} requires to_path/new_path or new_name.`,
      executed: false,
    };
  }

  const fromPolicy = getWritePolicy(settings, roots, fromPath);
  if (!fromPolicy.allowed) {
    return {
      content: `${formatToolName(call.tool)} blocked for source: ${fromPolicy.reason}`,
      executed: false,
    };
  }

  const toPolicy = getWritePolicy(settings, roots, toPath);
  if (!toPolicy.allowed) {
    return {
      content: `${formatToolName(call.tool)} blocked for destination: ${toPolicy.reason}`,
      executed: false,
    };
  }

  const result = await moveComputerPath(fromPath, toPath, roots, {
    createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs", "parents"], true),
  });
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      `From: ${result.fromPath}`,
      `To: ${result.toPath}`,
      `Kind: ${result.kind}`,
      `Moved: ${result.moved ? "yes" : "no"}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
    ].join("\n"),
    executed: result.moved,
    fileChanges: result.moved
      ? [
          {
            additions: 0,
            deletions: 0,
            kind: "move" as const,
            path: result.toPath,
          },
        ]
      : undefined,
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
  const runtime = customToolRuntimeFromArgs(call.args, shell, script);
  const toolPath = customToolPath(roots[0], toolName, runtime);
  const writeCheck = getWritePolicy(settings, roots, toolPath);

  if (!writeCheck.allowed) {
    return {
      content: `Custom tool creation blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  const normalizedScript = normalizeScriptText(script);
  const originalContent = await readOriginalContentForSyntaxCheck(toolPath);
  const result = await writeComputerTextFile(toolPath, normalizedScript, roots, {
    createParentDirs: true,
    overwrite: booleanArg(call.args, ["overwrite"], true),
  });
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

  return {
    content: [
      `Tool: ${toolName}`,
      `Runtime: ${customToolRuntimeLabel(runtime)}`,
      `Path: ${result.path}`,
      `Bytes written: ${result.bytesWritten}`,
      `Created: ${result.created ? "yes" : "no"}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      "Run it with run_tool using the same tool_name.",
    ].join("\n"),
    executed: true,
    fileChanges: [createFileChangeSummary(result.path, originalContent, normalizedScript, result.created ? "create" : "update")].filter(
      (change): change is NonNullable<ChatToolCall["fileChanges"]>[number] => Boolean(change),
    ),
  };
}

async function runCustomTerminalTool(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  signal?: AbortSignal,
  onTerminalProgress?: TerminalProgressHandler,
) {
  const requestedShell = terminalShellFromArgs(call.args);
  const requestedRuntime = customToolRuntimeFromArgs(call.args, requestedShell);
  const toolPath = await resolveCustomToolPath(call.args, roots, requestedShell, requestedRuntime);

  if (!toolPath) {
    return {
      content: `Skipped because run_tool could not find that custom tool under ${GILBERT_TOOL_DIRECTORY}.`,
      executed: false,
    };
  }

  const runtime = customToolRuntimeFromPath(toolPath, requestedRuntime, requestedShell);
  const shell = terminalShellForCustomToolRuntime(runtime, requestedShell);
  const workingDirectory = resolveTerminalWorkingDirectory(call.args, roots);
  const policy = getTerminalRunPolicy(settings, roots, workingDirectory);

  if (!policy.allowed) {
    return {
      content: `Custom tool run blocked: ${policy.reason}`,
      executed: false,
    };
  }

  assertReadablePath(toolPath, roots);

  const args = customToolArgsFromArgs(call.args, shell);
  const command = createCustomToolCommand(runtime, shell, toolPath, args, workingDirectory);
  const timeoutMs = terminalTimeoutFromArgs(call.args);
  const result = onTerminalProgress
    ? await runTerminalCommandWithBestProgressRunner({
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
    `Runtime: ${customToolRuntimeLabel(runtime)}`,
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
  return tool === "github_status" || tool === "github_list_repositories" || tool === "github_list_branches" || tool === "github_list_releases" || tool === "github_list_workflows";
}

function formatToolExecutionError(tool: LocalComputerToolName, error: unknown) {
  const detail = normalizeToolErrorMessage(error);

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

function normalizeToolErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return "Tool execution failed.";
}

function isMissingLocalPathError(message: string) {
  return /\b(?:cannot find the (?:file|path) specified|could not find file|no such file or directory|the system cannot find|not found)\b/i.test(message);
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
            : tool === "github_list_releases"
              ? "list GitHub releases"
              : tool === "github_list_workflows"
                ? "list GitHub Actions workflows"
                : tool === "github_list_workflow_runs"
                  ? "list GitHub workflow runs"
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
    create_code_file: "Create code file",
    create_files: "Create files",
    create_html_file: "Create HTML file",
    create_markdown_file: "Create Markdown file",
    create_react_file: "Create React file",
    create_text_file: "Create text file",
    create_tool: "Create custom tool",
    create_vite_project: "Create Vite project",
    delete_file: "Delete file",
    edit_file: "Edit file",
    list_directory: "List directory",
    lookup_color: "Color lookup",
    mcp_call_tool: "MCP call tool",
    mcp_list_servers: "MCP list servers",
    mcp_list_tools: "MCP list tools",
    mcp_remove_server: "MCP remove server",
    mcp_set_server: "MCP add/update server",
    move_path: "Move path",
    open_browser_preview: "Open browser preview",
    read_file: "Read file",
    rename_path: "Rename path",
    run_subagents: "Run sub-agents",
    run_terminal: "Run terminal command",
    run_tool: "Run custom tool",
    recall_context: "Recall context",
    search_files: "Search files",
    unknown: "Unknown tool",
    view_code: "View code",
    weather: "Weather",
    web_search: "Web search",
    write_file: "Write file",
    git_branch: "Git branch",
    git_checkout: "Git checkout",
    git_commit: "Git commit",
    git_diff: "Git diff",
    git_fetch: "Git fetch",
    git_init: "Git init",
    git_log: "Git log",
    git_pull: "Git pull",
    git_push: "Git push",
    git_stage: "Git stage",
    git_status: "Git status",
    git_unstage: "Git unstage",
    github_commit_files: "GitHub commit files",
    github_create_branch: "GitHub create branch",
    github_create_pull_request: "GitHub create pull request",
    github_create_release: "GitHub create release",
    github_dispatch_workflow: "GitHub dispatch workflow",
    github_generate_release_notes: "GitHub release notes",
    github_get_repository: "GitHub repository",
    github_list_branches: "GitHub list branches",
    github_list_repositories: "GitHub list repositories",
    github_list_releases: "GitHub list releases",
    github_list_tree: "GitHub list tree",
    github_list_workflow_runs: "GitHub list workflow runs",
    github_list_workflows: "GitHub list workflows",
    github_read_file: "GitHub read file",
    github_search_code: "GitHub search code",
    github_status: "GitHub status",
  } satisfies Record<LocalComputerToolName, string>;

  return names[tool];
}

function summarizeToolCall(call: ParsedLocalComputerToolCall) {
  const path = firstArg(call.args, ["project_path", "projectPath", "path", "from_path", "fromPath", "source_path", "source", "file_path", "directory_path", "folder_path", "file"]);
  const command = firstArg(call.args, ["command", "cmd", "input"]);
  const toolName = firstArg(call.args, ["tool_name", "name"]);
  const repository = firstArg(call.args, ["repository", "repo_full_name", "full_name"]);
  const owner = firstArg(call.args, ["owner", "org", "organization"]);
  const repo = firstArg(call.args, ["repo", "repository_name"]);
  const color = firstArg(call.args, ["color", "hex", "value"]);
  const query = firstArg(call.args, ["query", "q", "search", "text"]);
  const url = firstArg(call.args, ["url", "href", "address", "target", "page"]);
  const branch = firstArg(call.args, ["branch", "ref", "name", "new_branch", "newBranch"]);
  const message = firstArg(call.args, ["message", "commit_message", "commitMessage"]);

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

  if (isLocalGitToolName(call.tool)) {
    return [branch, message, path].filter(Boolean).join(" - ") || call.tool;
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

  return args || call.raw;
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

  if (calls.length > 0) {
    return calls;
  }

  for (const call of parseDirectXmlToolCalls(scanContent)) {
    calls.push(call);

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

  // Models sometimes wrap a JSON tool call inside <tool_call> but prefix it
  // with stray text like the literal word "tool_call" or a leading function
  // name. Try to recover a JSON object/array anywhere in the body before
  // falling back to the XML/arg parsing path.
  const embeddedJsonCalls = parseEmbeddedJsonToolCall(raw);

  if (embeddedJsonCalls.length > 0) {
    return embeddedJsonCalls;
  }

  const directXmlCalls = parseDirectXmlToolCalls(raw);
  if (directXmlCalls.length > 0) {
    return directXmlCalls;
  }

  const args = parseXmlToolCallArgs(raw);
  const command = decodeXmlEntities(resolveXmlToolCommand(raw, args));
  if (args.tool && normalizeArgName(args.tool) === normalizeArgName(command)) {
    delete args.tool;
  }

  return [
    {
      args,
      raw,
      tool: normalizeToolName(command, args),
    },
  ];
}

function parseXmlToolCallArgs(raw: string) {
  const args: Record<string, string> = {};
  const argRegex = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = argRegex.exec(raw))) {
    const key = normalizeArgName(decodeXmlEntities(match[1]));
    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }

  Object.assign(args, parseXmlArgsObject(firstXmlTagValue(raw, ["args", "arguments", "input"])));
  collectDirectXmlArgs(raw, args);
  collectMalformedDirectXmlArgs(raw, args);

  return args;
}

function parseDirectXmlToolCalls(raw: string): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [];
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const command = decodeXmlEntities(match[1]);
    const normalizedTag = normalizeArgName(command);

    if (isIgnoredXmlArgTag(normalizedTag)) {
      continue;
    }

    const args = parseXmlToolCallArgs(match[2]);
    const tool = normalizeToolName(command, args);

    if (tool === "unknown") {
      continue;
    }

    if (args.tool && normalizeArgName(args.tool) === normalizeArgName(command)) {
      delete args.tool;
    }

    calls.push({
      args,
      raw: match[0],
      tool,
    });
  }

  return calls;
}

function stripDirectXmlToolCalls(content: string) {
  return content.replace(/<([a-zA-Z][\w.-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, (fullMatch: string, command: string) => {
    const normalizedTag = normalizeArgName(command);

    if (isIgnoredXmlArgTag(normalizedTag) || normalizeToolName(command, {}) === "unknown") {
      return fullMatch;
    }

    return " ";
  });
}

function resolveXmlToolCommand(raw: string, args: Record<string, string>) {
  const taggedCommand = firstXmlTagValue(raw, ["tool", "name"]);

  if (taggedCommand) {
    return taggedCommand;
  }

  const leadingCommand = raw.match(/^([a-zA-Z0-9_.-]+)/)?.[1];
  const argCommand = args.tool;

  if (leadingCommand && !isToolNamePlaceholder(leadingCommand.toLowerCase())) {
    return leadingCommand;
  }

  return argCommand || leadingCommand || "";
}

function parseEmbeddedJsonToolCall(raw: string): ParsedLocalComputerToolCall[] {
  // Scan for the first balanced JSON object/array, ignoring any leading
  // tokens the model emitted before it (e.g. "tool_call\n{...}", a function
  // name on its own line, code-fence remnants, etc.).
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];

    if (char !== "{" && char !== "[") {
      continue;
    }

    const slice = sliceBalancedJson(raw, index);

    if (!slice) {
      continue;
    }

    const calls = parseJsonToolCalls(slice);

    if (calls.length > 0) {
      return calls.map((call) => ({ ...call, raw }));
    }
  }

  return [];
}

function sliceBalancedJson(input: string, startIndex: number): string | null {
  const opener = input[startIndex];

  if (opener !== "{" && opener !== "[") {
    return null;
  }

  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < input.length; index++) {
    const char = input[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;

      if (depth === 0) {
        return input.slice(startIndex, index + 1);
      }
    }
  }

  return null;
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

function isIgnoredXmlArgTag(key: string) {
  return ["arg_key", "arg_value", "args", "arguments", "input", "name", "tool", "tool_call"].includes(key);
}

function collectDirectXmlArgs(raw: string, args: Record<string, string>) {
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);

    if (isIgnoredXmlArgTag(key) || Object.prototype.hasOwnProperty.call(args, key)) {
      continue;
    }

    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }
}

function collectMalformedDirectXmlArgs(raw: string, args: Record<string, string>) {
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);

    if (isIgnoredXmlArgTag(key) || Object.prototype.hasOwnProperty.call(args, key)) {
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
  const inferredFromArgs = inferToolNameFromArgs(args);

  if (isToolNamePlaceholder(normalized) && inferredFromArgs) {
    return inferredFromArgs;
  }

  const mcpToolName = normalizeMcpToolName(normalized);
  if (mcpToolName) {
    return mcpToolName;
  }

  if (isWebToolName(normalized)) {
    return isWeatherDataToolArgs(args) ? "weather" : "web_search";
  }

  if (isWeatherToolName(normalized)) {
    return "weather";
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

  const localGitToolName = normalizeLocalGitToolName(normalized);

  if (localGitToolName) {
    return localGitToolName;
  }

  const githubToolName = normalizeGithubToolName(normalized);

  if (githubToolName) {
    return githubToolName;
  }

  if (["delete", "delete-file", "remove_file", "remove-file", "file.delete"].includes(normalized)) {
    return "delete_file";
  }

  if (["move", "move_path", "move-path", "move_file", "move-file", "move_folder", "move-folder", "file.move", "folder.move"].includes(normalized)) {
    return "move_path";
  }

  if (["rename", "rename_path", "rename-path", "rename_file", "rename-file", "rename_folder", "rename-folder", "file.rename", "folder.rename"].includes(normalized)) {
    return "rename_path";
  }

  if (["recall", "recall_context", "recall-context", "context_recall", "context-recall", "memory_search", "memory-search", "context_search", "context-search", "search_context", "search-context"].includes(normalized)) {
    return "recall_context";
  }

  if (["create_vite_project", "create-vite-project", "vite_project", "vite-project", "create_react_app", "create-react-app", "create_vite_app", "create-vite-app", "scaffold_vite", "scaffold-vite", "scaffold_project", "scaffold-project"].includes(normalized)) {
    return "create_vite_project";
  }

  // create_* aliases all funnel into the file-creation family. PDF and the
  // bespoke fabricator tools (sql_schema, unit_test, etc.) were removed in
  // Phase 2 — pdf paths now use create_code_file (the model can write PDF
  // bytes itself if it truly needs to, but agents never need to).
  if (["create_file", "create-file", "file.create", "file_create", "file-create", "new_file", "new-file"].includes(normalized)) {
    const kind = (args.kind ?? args.type ?? args.language ?? args.lang ?? "").toLowerCase();
    const path = (args.path ?? args.file_path ?? args.file ?? "").toLowerCase();

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

  // Models that emit removed coding-tool aliases (run_tests, typescript_check,
  // create_sql_schema, etc.) get routed to run_terminal so they can still
  // accomplish the underlying intent via a shell command.
  if (["test", "tests", "run_test", "run-test", "run-tests", "ts_check", "ts-check", "typecheck", "typescript", "typescript-check"].includes(normalized)) {
    return "run_terminal";
  }

  // inline_edit was an alias for edit_file — the model uses the same args.
  if (["inline_edit", "inline-edit", "edit_inline", "edit-inline"].includes(normalized)) {
    return "edit_file";
  }

  if (["open_browser_preview", "open-browser-preview", "browser_preview", "browser-preview", "open_preview", "open-preview", "preview_url", "preview-url", "show_preview", "show-preview", "open_in_browser_preview", "open-in-browser-preview"].includes(normalized)) {
    return "open_browser_preview";
  }

  if (["browser_automation", "browser-automation", "browser.inspect", "inspect_browser", "inspect-browser", "assert_browser_text", "click_link", "click-link"].includes(normalized)) {
    return "browser_automation";
  }

  if (["run_subagents", "run-subagents", "parallel_agents", "parallel-agents", "delegate", "delegate_tasks"].includes(normalized)) {
    return "run_subagents";
  }

  if (["terminal", "terminal.run", "shell", "shell.run", "command", "command.run", "execute", "run_command", "run-command", "run_terminal", "run-terminal"].includes(normalized)) {
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

  if (["edit", "edit_file", "edit-file", "patch", "replace_text", "replace-text", "insert_text", "insert-text", "str_replace", "str-replace"].includes(normalized)) {
    return "edit_file";
  }

  // Models that emit search/replace-style aliases get routed to edit_file's
  // old_text/new_text mode, which subsumes the same behavior.
  if ([
    "apply_search_replace",
    "apply-search-replace",
    "search_replace",
    "search-replace",
    "search_and_replace",
    "search-and-replace",
    "diff_blocks",
    "diff-blocks",
    "apply_diff",
    "apply-diff",
  ].includes(normalized)) {
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

  return inferredFromArgs ?? "unknown";
}

function isToolNamePlaceholder(value: string) {
  return !value || ["arg", "args", "arguments", "call", "function", "input", "tool", "tool_call"].includes(value);
}

function inferToolNameFromArgs(args: Record<string, string>): LocalComputerToolName | null {
  const framework = firstArg(args, ["framework", "template", "stack", "kind", "type"]) ?? "";

  if (/\bvite\b/i.test(framework) && /\breact\b/i.test(framework) && hasNonEmptyArg(args, ["project_path", "projectPath", "path", "directory_path", "folder_path", "project_name", "name"])) {
    return "create_vite_project";
  }

  if (hasNonEmptyArg(args, ["files_json", "files", "manifest", "items"])) {
    return "create_files";
  }

  if (hasNonEmptyArg(args, ["command", "cmd", "shell_command", "terminal_command"])) {
    return "run_terminal";
  }

  if (hasNonEmptyArg(args, ["query", "q", "search"])) {
    return isWeatherDataToolArgs(args) ? "weather" : "web_search";
  }

  if (hasNonEmptyArg(args, ["url", "href", "address", "target"])) {
    return "open_browser_preview";
  }

  if (hasNonEmptyArg(args, ["path", "file_path", "file"])) {
    if (hasNonEmptyArg(args, ["to_path", "toPath", "destination_path", "destinationPath", "target_path", "new_path", "newPath", "new_name", "newName"])) {
      return "move_path";
    }

    if (hasNonEmptyArg(args, ["old_text", "old_string", "old_str", "new_text", "new_string", "new_str", "start_line", "end_line", "start_char", "end_char", "insert_at_line", "insert_line"])) {
      return "edit_file";
    }

    if (hasNonEmptyArg(args, ["content", "text", "markdown"])) {
      return "write_file";
    }
  }

  if (hasNonEmptyArg(args, ["from_path", "fromPath", "source_path", "source", "old_path", "oldPath"]) && hasNonEmptyArg(args, ["to_path", "toPath", "destination_path", "destinationPath", "target_path", "new_path", "newPath", "new_name", "newName"])) {
    return "move_path";
  }

  if (hasNonEmptyArg(args, ["paths", "paths_json"]) || booleanArg(args, ["all", "all_files", "allFiles"], false)) {
    return "git_status";
  }

  return null;
}

function hasNonEmptyArg(args: Record<string, string>, keys: string[]) {
  return keys.some((key) => {
    const value = args[normalizeArgName(key)] ?? args[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function isWeatherDataToolArgs(args: Record<string, string>) {
  const query = firstArg(args, ["query", "q", "search", "text", "prompt"]) ?? "";

  return /\b(weather|forecast|temperature|temp|rain|snow|storm|storms|thunderstorm|alerts?|warnings?|radar|current conditions?|hourly|nws|noaa)\b/i.test(query)
    && !/\b(docs?|documentation|api|schema|endpoint|openapi|developer|source code|standard|spec)\b/i.test(query);
}

function normalizeMcpToolName(command: string): LocalComputerToolName | null {
  if (["mcp_list_servers", "mcp_servers", "mcp_list", "list_mcp_servers", "list_mcp"].includes(command)) {
    return "mcp_list_servers";
  }
  if (["mcp_list_tools", "list_mcp_tools", "mcp_tools", "mcp_discover_tools"].includes(command)) {
    return "mcp_list_tools";
  }
  if (["mcp_call_tool", "mcp_call", "call_mcp_tool", "mcp_invoke", "mcp_invoke_tool", "mcp_run", "mcp_run_tool"].includes(command)) {
    return "mcp_call_tool";
  }
  if (["mcp_set_server", "mcp_add_server", "mcp_update_server", "mcp_upsert_server", "mcp_save_server", "add_mcp_server", "update_mcp_server"].includes(command)) {
    return "mcp_set_server";
  }
  if (["mcp_remove_server", "mcp_delete_server", "remove_mcp_server", "delete_mcp_server"].includes(command)) {
    return "mcp_remove_server";
  }
  return null;
}

function isLocalGitToolName(value: string): value is LocalGitToolName {
  return LOCAL_GIT_TOOL_NAMES.has(value as LocalGitToolName);
}

function normalizeLocalGitToolName(command: string): LocalGitToolName | null {
  const normalized = command.replace(/^git[._-]/, "git_");

  if (isLocalGitToolName(normalized)) {
    return normalized;
  }

  if (["git", "git_status", "git_state", "git_worktree_status", "version_control_status"].includes(normalized)) {
    return "git_status";
  }

  if (["git_init", "git_initialize", "git_initialise", "git_init_repo", "git_init_repository", "git_initialize_repository", "git_create_repo", "git_create_repository", "init_git", "initialize_git", "initialise_git"].includes(normalized)) {
    return "git_init";
  }

  if (["git_diff", "git_changes", "git_patch", "git_show_changes"].includes(normalized)) {
    return "git_diff";
  }

  if (["git_log", "git_history", "git_commits"].includes(normalized)) {
    return "git_log";
  }

  if (["git_add", "git_stage", "git_stage_files"].includes(normalized)) {
    return "git_stage";
  }

  if (["git_unstage", "git_reset_stage", "git_restore_staged"].includes(normalized)) {
    return "git_unstage";
  }

  if (["git_commit", "git_create_commit"].includes(normalized)) {
    return "git_commit";
  }

  if (["git_push"].includes(normalized)) {
    return "git_push";
  }

  if (["git_pull"].includes(normalized)) {
    return "git_pull";
  }

  if (["git_fetch"].includes(normalized)) {
    return "git_fetch";
  }

  if (["git_branch", "git_list_branches", "git_create_branch", "git_delete_branch"].includes(normalized)) {
    return "git_branch";
  }

  if (["git_checkout", "git_switch", "git_switch_branch"].includes(normalized)) {
    return "git_checkout";
  }

  return null;
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

  if (["github_release_notes", "github_generate_release_notes", "github_generate_notes", "github_notes", "github_changelog"].includes(normalized)) {
    return "github_generate_release_notes";
  }

  if (["github_release", "github_create_release", "github_publish_release", "github_draft_release", "github_new_release"].includes(normalized)) {
    return "github_create_release";
  }

  if (["github_releases", "github_list_releases", "github_release_list", "github_tags_releases"].includes(normalized)) {
    return "github_list_releases";
  }

  if (["github_workflows", "github_list_workflows", "github_actions_workflows", "github_workflow_list"].includes(normalized)) {
    return "github_list_workflows";
  }

  if (["github_dispatch_workflow", "github_workflow_dispatch", "github_run_workflow", "github_trigger_workflow", "github_actions_dispatch"].includes(normalized)) {
    return "github_dispatch_workflow";
  }

  if (["github_workflow_runs", "github_list_workflow_runs", "github_actions_runs", "github_runs"].includes(normalized)) {
    return "github_list_workflow_runs";
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
      const matches = result.matches?.length ? ` matches=${result.matches.join(",")}` : "";
      const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ")}` : "";
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

function formatContextRecallResults(query: string, memories: GilbertProjectMemory[], fileResults: ComputerSearchResult[], limit?: number) {
  const effectiveLimit = limit ?? Math.max(fileResults.length, memories.length, 1);
  const memoryHits = searchGilbertMemory(query, memories, limit ?? effectiveLimit);
  const fileLines = fileResults.slice(0, limit ?? undefined).map((result, index) => {
    const kind = result.matchKind ? `/${result.matchKind}` : "";
    const line = result.line ? ` line=${result.line}` : "";
    const matches = result.matches?.length ? ` matches=${result.matches.join(",")}` : "";
    const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ")}` : "";
    return `${index + 1}. [${result.kind}${kind}] ${result.path} score=${result.score.toFixed(3)}${line}${matches}${preview}`;
  });
  const memoryLines = memoryHits.map((hit, index) => {
    const line = hit.line ? ` line=${hit.line}` : "";
    const matches = hit.matches.length ? ` matches=${hit.matches.join(",")}` : "";
    return `${index + 1}. [memory] ${hit.path} score=${hit.score.toFixed(3)}${line}${matches}\n   preview: ${hit.preview.replace(/\s+/g, " ")}`;
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
    matches: Array.from(matches),
    path: memory.path,
    preview: snippet?.preview ?? memory.content.trim(),
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
        preview: line.trim(),
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
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/.test(segment) ||
    /^(?:npx|npm\s+exec|pnpm\s+exec|yarn\s+exec|bunx)\s+(?:--yes\s+)?(?:vite(?!\s+(?:build|test|optimize|--version|-v)\b)|next\s+dev|astro\s+dev|webpack\s+serve|expo\s+start)\b/.test(segment) ||
    /^(?:vite(?!\s+(?:build|test|optimize|--version|-v)\b)|next\s+dev|astro\s+dev|webpack\s+serve|expo\s+start|tauri\s+dev|cargo\s+tauri\s+dev)\b/.test(segment),
  );
}

function isLongRunningProcessCommand(command: string) {
  if (isLikelyDevServerCommand(command)) {
    return true;
  }

  // Catches the long-running watchers / hot-reload runners that the AI keeps
  // re-spawning when the user already has one alive in their terminal.
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?(?:watch|hot)\b/.test(segment) ||
    /^(?:npx\s+)?(?:nodemon|webpack-dev-server)\b/.test(segment) ||
    /^(?:cargo\s+watch|cargo\s+leptos\s+watch|deno\s+task\s+dev|rails\s+(?:server|s)|flask\s+run|uvicorn|gunicorn|hugo\s+server|jekyll\s+serve|mkdocs\s+serve)\b/.test(segment) ||
    /^(?:tauri\s+dev|cargo\s+tauri\s+dev)\b/.test(segment),
  );
}

function commandSegmentsForLongRunningDetection(command: string) {
  const normalized = unwrapWindowsShellWrapper(normalizeCommandForFastPath(command))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map(normalizeLongRunningCommandSegment)
    .filter(Boolean);
}

function normalizeLongRunningCommandSegment(segment: string) {
  return segment
    .replace(/^(?:&|call)\s+/i, "")
    .replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/i, "")
    .trim();
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

    if (url.hostname === "0.0.0.0" || url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
    }

    return url.href;
  } catch {
    return undefined;
  }
}

function createBrowserPreviewSearchUrl(query: string, engine?: string) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return undefined;
  }

  switch (normalizeBrowserPreviewSearchEngine(engine)) {
    case "youtube":
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmedQuery)}`;
    case "github":
      return `https://github.com/search?q=${encodeURIComponent(trimmedQuery)}&type=repositories`;
    case "duckduckgo":
      return `https://duckduckgo.com/?q=${encodeURIComponent(trimmedQuery)}`;
    case "google":
    default:
      return `https://www.google.com/search?q=${encodeURIComponent(trimmedQuery)}`;
  }
}

function normalizeBrowserPreviewSearchEngine(engine?: string) {
  const normalized = engine?.trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (normalized === "youtube" || normalized === "yt") {
    return "youtube";
  }

  if (normalized === "github" || normalized === "git_hub") {
    return "github";
  }

  if (normalized === "duckduckgo" || normalized === "duck_duck_go" || normalized === "ddg") {
    return "duckduckgo";
  }

  return "google";
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

function findUnrequestedUncommonLocalPreviewPort(value: string, userPrompt: string, trackedSessionUrl?: string) {
  const port = getExplicitLocalPreviewPort(value);

  if (port === undefined || port === 80 || port === 443 || COMMON_LOCAL_PREVIEW_PROBE_PORT_SET.has(port)) {
    return undefined;
  }

  if (trackedSessionUrl && normalizeBrowserPreviewUrl(trackedSessionUrl) === normalizeBrowserPreviewUrl(value)) {
    return undefined;
  }

  return userPromptMentionsLocalPreviewPort(userPrompt, port) ? undefined : port;
}

function getExplicitLocalPreviewPort(value: string) {
  try {
    const url = new URL(value);

    if (!url.port || !isLocalPreviewHost(url.hostname)) {
      return undefined;
    }

    const port = Number.parseInt(url.port, 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

function userPromptMentionsLocalPreviewPort(userPrompt: string, port: number) {
  return new RegExp(`(?:^|\\D)${port}(?:\\D|$)`).test(userPrompt);
}

async function findReachableLocalPreviewUrl(command: string, output: string, signal?: AbortSignal) {
  const candidates = createLocalPreviewCandidates(command, output);

  if (candidates.length === 0) {
    return undefined;
  }

  const results = await Promise.all(candidates.map(async (url) => ((await probeLocalPreviewUrl(url, signal)) ? url : "")));
  return results.find(Boolean);
}

async function findReachableKnownLocalPreviewUrl(signal?: AbortSignal) {
  const candidates = new Set<string>();

  for (const port of COMMON_LOCAL_PREVIEW_PROBE_PORTS) {
    addLocalPreviewCandidate(candidates, `http://localhost:${port}/`);
    addLocalPreviewCandidate(candidates, `http://127.0.0.1:${port}/`);
  }

  if (candidates.size === 0) {
    return undefined;
  }

  const results = await Promise.all([...candidates].map(async (url) => ((await probeLocalPreviewUrl(url, signal)) ? url : "")));
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
    for (const port of COMMON_LOCAL_PREVIEW_PROBE_PORTS) {
      addLocalPreviewCandidate(candidates, `http://localhost:${port}/`);
    }
  }

  return [...candidates];
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

async function prepareManagedDevServerCommand(
  command: string,
  args: Record<string, string>,
  shell: TerminalShellId,
  workingDirectory: string,
  signal?: AbortSignal,
  avoidPorts: number[] = [],
): Promise<ManagedDevServerPlan | undefined> {
  if (!isLikelyDevServerCommand(command)) {
    return undefined;
  }

  const profile = await inferDevServerPortProfile(command, workingDirectory);
  const requestedPort = optionalNumberArg(args, ["port", "preferred_port", "preferredPort", "dev_port", "devPort"]);
  const requestedHost = firstArg(args, ["host", "hostname", "dev_host", "devHost"]);
  const explicitPorts = extractLocalPreviewPorts(command);
  const explicitHostInCommand = /\b--host(?:[\s=])\S+/i.test(command) || /\bHOST\s*=\s*\S+/.test(command);

  // Respect model intent. If the model already specified a port (in args or in
  // the command string) and a host, run the command verbatim. The previous
  // autopilot doubled flags ("--host X --port Y -- --host A --port B") and
  // mangled hosts; that pattern broke real user runs and is gone.
  const modelSpecifiedPort = requestedPort !== undefined || explicitPorts.length > 0;
  const modelSpecifiedHost = requestedHost !== undefined || explicitHostInCommand;
  if (modelSpecifiedPort && modelSpecifiedHost) {
    const port = requestedPort ?? explicitPorts[0];
    const host = requestedHost ?? "localhost";
    return {
      command,
      detail: `Dev server profile: ${profile.framework}. Using model-specified host/port: ${host}:${port}.`,
      expectedUrl: `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`,
      framework: profile.framework,
      host,
      originalCommand: command,
      port,
      profile,
      usedPorts: uniquePorts([...avoidPorts, ...explicitPorts, port]),
    };
  }

  // Model gave a generic command (no explicit port). Pick a free one to avoid
  // collisions with existing sessions, but ONLY add flags if the model didn't
  // already provide them.
  const occupiedSessionPorts = getBackgroundTerminalSessions().flatMap((session) =>
    extractLocalPreviewPorts(`${session.browserPreviewUrl ?? ""}\n${session.outputPreview ?? ""}\n${session.command}`),
  );
  const portsToAvoid = uniquePorts([...avoidPorts, ...occupiedSessionPorts]);
  const host = requestedHost ?? "localhost";
  const candidates = createDevServerPortCandidates([
    requestedPort,
    ...explicitPorts,
    ...profile.defaultPorts,
    ...COMMON_LOCAL_PREVIEW_PROBE_PORTS,
  ]);
  const selectedPort = await selectAvailableLocalPort(candidates, portsToAvoid, signal);
  // Only mutate the command if the model did NOT already include a port.
  // When the model gave `--port 5173` we use that; we never append our own.
  const preparedCommand = modelSpecifiedPort
    ? command
    : applyDevServerPortPlanToCommand(command, profile, shell, host, selectedPort);
  const finalPort = modelSpecifiedPort ? (requestedPort ?? explicitPorts[0]) : selectedPort;
  const skippedPorts = candidates.filter((port) => port !== finalPort && portsToAvoid.includes(port));
  const expectedUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${finalPort}/`;
  const detailParts = [
    `Dev server profile: ${profile.framework}.`,
    `Selected host/port: ${host}:${finalPort}.`,
    skippedPorts.length > 0 ? `Skipped occupied session port${skippedPorts.length === 1 ? "" : "s"}: ${skippedPorts.join(", ")}.` : "",
    preparedCommand !== command ? "Added --port flag because the model did not specify one." : "",
  ];

  return {
    command: preparedCommand,
    detail: detailParts.filter(Boolean).join(" "),
    expectedUrl,
    framework: profile.framework,
    host,
    originalCommand: command,
    port: finalPort,
    profile,
    usedPorts: uniquePorts([...portsToAvoid, ...explicitPorts, finalPort]),
  };
}

async function runManagedBackgroundTerminalCommand({
  command,
  devServerPlan,
  onProgress,
  shell,
  signal,
  workingDirectory,
}: {
  command: string;
  devServerPlan?: ManagedDevServerPlan;
  onProgress?: TerminalProgressHandler;
  shell: TerminalShellId;
  signal?: AbortSignal;
  workingDirectory: string;
}): Promise<TerminalRunCommandResponse & { managedCommand?: string; managedDetail?: string; sessionId?: string }> {
  let activeCommand = command;
  let activePlan = devServerPlan;
  let result = await runTerminalCommandInBackgroundProbe({
    command: activeCommand,
    onProgress,
    shell,
    signal,
    workingDirectory,
  });

  for (let attempt = 0; activePlan && attempt < DEV_SERVER_PORT_RETRY_LIMIT && isPortInUseTerminalResult(result); attempt += 1) {
    if (result.sessionId) {
      await killTerminalSession(result.sessionId).catch(() => undefined);
      unregisterBackgroundTerminalSession(result.sessionId);
    }

    const nextPlan = await prepareManagedDevServerCommand(
      activePlan.originalCommand,
      { host: activePlan.host },
      shell,
      workingDirectory,
      signal,
      uniquePorts([...activePlan.usedPorts, ...extractLocalPreviewPorts(`${result.stdout}\n${result.stderr}`)]),
    );

    if (!nextPlan || nextPlan.port === activePlan.port) {
      break;
    }

    activePlan = {
      ...nextPlan,
      detail: `${nextPlan.detail} Retried because port ${activePlan.port} was already in use.`,
    };
    activeCommand = activePlan.command;
    result = await runTerminalCommandInBackgroundProbe({
      command: activeCommand,
      onProgress,
      shell,
      signal,
      workingDirectory,
    });
  }

  return {
    ...result,
    managedCommand: activeCommand,
    managedDetail: activePlan?.detail,
  };
}

async function inferDevServerPortProfile(command: string, workingDirectory: string): Promise<DevServerPortProfile> {
  const scriptText = await getPackageScriptTextForCommand(command, workingDirectory);
  const normalized = `${command}\n${scriptText}`.toLowerCase();

  if (/\b(vite|vitest\s+--ui)\b/.test(normalized)) {
    return getDevServerPortProfile("vite");
  }

  if (/\bnext\s+dev\b|\bnext\b/.test(normalized)) {
    return getDevServerPortProfile("next");
  }

  if (/\bastro\s+dev\b|\bastro\b/.test(normalized)) {
    return getDevServerPortProfile("astro");
  }

  if (/\bsvelte-kit\b|\bsv\b|\bsvelte\b/.test(normalized)) {
    return getDevServerPortProfile("sveltekit");
  }

  if (/\bng\s+serve\b|\bangular\b/.test(normalized)) {
    return getDevServerPortProfile("angular");
  }

  if (/\breact-scripts\s+start\b/.test(normalized)) {
    return getDevServerPortProfile("react-scripts");
  }

  if (/\bremix\b/.test(normalized)) {
    return getDevServerPortProfile("remix");
  }

  if (/\bnuxt\b/.test(normalized)) {
    return getDevServerPortProfile("nuxt");
  }

  if (/\bwebpack(?:-dev-server|\s+serve)\b/.test(normalized)) {
    return getDevServerPortProfile("webpack");
  }

  if (/\bexpo\s+start\b|\bexpo\b/.test(normalized)) {
    return getDevServerPortProfile("expo");
  }

  if (/\bstorybook\b/.test(normalized)) {
    return getDevServerPortProfile("storybook");
  }

  if (/\buvicorn\b|\bfastapi\b/.test(normalized)) {
    return getDevServerPortProfile("uvicorn");
  }

  if (/\bflask\s+run\b|\bflask\b/.test(normalized)) {
    return getDevServerPortProfile("flask");
  }

  if (/\brails\s+(?:server|s)\b/.test(normalized)) {
    return getDevServerPortProfile("rails");
  }

  if (/\bhugo\s+server\b|\bhugo\b/.test(normalized)) {
    return getDevServerPortProfile("hugo");
  }

  if (/\bjekyll\s+serve\b|\bjekyll\b/.test(normalized)) {
    return getDevServerPortProfile("jekyll");
  }

  if (/\bmkdocs\s+serve\b|\bmkdocs\b/.test(normalized)) {
    return getDevServerPortProfile("mkdocs");
  }

  return GENERIC_DEV_SERVER_PORT_PROFILE;
}

function getDevServerPortProfile(framework: string) {
  return DEV_SERVER_PORT_PROFILES.find((profile) => profile.framework === framework) ?? GENERIC_DEV_SERVER_PORT_PROFILE;
}

async function getPackageScriptTextForCommand(command: string, workingDirectory: string) {
  const scriptName = inferPackageScriptName(command);

  if (!scriptName) {
    return "";
  }

  try {
    const packageJson = await readComputerTextFile(joinLocalPath(workingDirectory, ["package.json"]), 256 * 1024);
    const parsed = JSON.parse(packageJson.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    const script = parsed.scripts?.[scriptName] ?? "";
    const dependencyNames = [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
    ].join(" ");

    return `${script}\n${dependencyNames}`;
  } catch {
    return "";
  }
}

function inferPackageScriptName(command: string) {
  const segment = commandSegmentsForLongRunningDetection(command)[0] ?? "";
  const match = segment.match(/^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?([a-z0-9:_-]+)/i);

  return match?.[1];
}

function createDevServerPortCandidates(values: Array<number | undefined>) {
  const ports: number[] = [];

  for (const value of values) {
    if (!isValidLocalPort(value)) {
      continue;
    }

    for (let port = value; port <= Math.min(65535, value + DEV_SERVER_PORT_CANDIDATE_SPAN); port += 1) {
      ports.push(port);
    }
  }

  return uniquePorts(ports);
}

async function selectAvailableLocalPort(candidates: number[], avoidPorts: number[], signal?: AbortSignal) {
  const avoided = new Set(avoidPorts);

  for (const port of candidates) {
    if (avoided.has(port)) {
      continue;
    }

    if (!(await isLocalPreviewPortOccupied(port, signal))) {
      return port;
    }
  }

  return candidates.find((port) => !avoided.has(port)) ?? candidates[0] ?? 5173;
}

async function isLocalPreviewPortOccupied(port: number, signal?: AbortSignal) {
  if (!isValidLocalPort(port)) {
    return true;
  }

  return (
    (await probeLocalPreviewUrl(`http://localhost:${port}/`, signal)) ||
    (await probeLocalPreviewUrl(`http://127.0.0.1:${port}/`, signal))
  );
}

function applyDevServerPortPlanToCommand(command: string, profile: DevServerPortProfile, shell: TerminalShellId, host: string, port: number) {
  if (profile.style === "env") {
    return withDevServerEnvironment(command, shell, createDevServerEnv(profile, host, port));
  }

  const args = createDevServerPortArgs(profile, host, port);

  if (!args) {
    return command;
  }

  return `${command.trim()}${isPackageScriptCommand(command) ? " --" : ""} ${args}`.trim();
}

function createDevServerEnv(profile: DevServerPortProfile, host: string, port: number): Record<string, string> {
  if (profile.framework === "flask") {
    return {
      FLASK_RUN_HOST: host,
      FLASK_RUN_PORT: String(port),
      HOST: host,
      PORT: String(port),
    };
  }

  return {
    HOST: host,
    PORT: String(port),
  };
}

function createDevServerPortArgs(profile: DevServerPortProfile, host: string, port: number) {
  if (profile.framework === "next") {
    return `-H ${quoteCliToken(host)} -p ${port}`;
  }

  if (profile.framework === "rails") {
    return `-b ${quoteCliToken(host)} -p ${port}`;
  }

  if (profile.framework === "hugo") {
    return `--bind ${quoteCliToken(host)} --port ${port}`;
  }

  if (profile.framework === "mkdocs") {
    return `-a ${quoteCliToken(`${host}:${port}`)}`;
  }

  if (profile.framework === "expo" || profile.framework === "storybook") {
    return `--port ${port}`;
  }

  if (profile.style === "port-only-args") {
    return `--port ${port}`;
  }

  return `--host ${quoteCliToken(host)} --port ${port}`;
}

function withDevServerEnvironment(command: string, shell: TerminalShellId, values: Record<string, string>) {
  const entries = Object.entries(values).filter(([, value]) => value.trim());

  if (entries.length === 0) {
    return command;
  }

  if (shell === "powershell") {
    const prefix = entries.map(([key, value]) => `$env:${key}=${quoteShellArg(value, shell)}`).join("; ");
    return `${prefix}; ${command}`;
  }

  if (shell === "cmd") {
    const prefix = entries.map(([key, value]) => `set "${key}=${value.replace(/"/g, '""')}"`).join(" && ");
    return `${prefix} && ${command}`;
  }

  const prefix = entries.map(([key, value]) => `${key}=${quoteShellArg(value, shell)}`).join(" ");
  return `${prefix} ${command}`;
}

function isPackageScriptCommand(command: string) {
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?[a-z0-9:_-]+\b/i.test(segment),
  );
}

function isPortInUseTerminalResult(result: TerminalRunCommandResponse & { sessionId?: string }) {
  return /\b(?:EADDRINUSE|address already in use|port\s+\d{2,5}\s+(?:is\s+)?already in use|listen\s+EACCES)\b/i.test(`${result.stdout}\n${result.stderr}`);
}

function uniquePorts(ports: number[]) {
  return ports.filter((port, index) => isValidLocalPort(port) && ports.indexOf(port) === index);
}

function isValidLocalPort(port: number | undefined): port is number {
  return Number.isInteger(port) && port !== undefined && port > 0 && port <= 65535;
}

function quoteCliToken(value: string) {
  return /^[a-z0-9._:[\]-]+$/i.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
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
  registerBackgroundTerminalSession({
    command,
    sessionId: session.sessionId,
    shell,
    startedAt,
    workingDirectory: session.workingDirectory,
  });
  const releaseAbortKill = bindTerminalSessionAbort(signal, session.sessionId);
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

    // null cap = no soft limit. The native terminal path streams until the
    // command completes or times out; only an explicit native truncation sets
    // outputTruncated below.
    if (MAX_TERMINAL_LIVE_OUTPUT_CHARS === null) {
      target.push(text);
      return capturedChars + text.length;
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
        sessionId: !completed ? session.sessionId : undefined,
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
      await sleep(TERMINAL_TOOL_POLL_INTERVAL_MS, signal);

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
          updateBackgroundTerminalSession(session.sessionId, {
            browserPreviewUrl,
            outputPreview: combinedOutput,
          });
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
    releaseAbortKill();
    await killTerminalSession(session.sessionId).catch(() => undefined);
    unregisterBackgroundTerminalSession(session.sessionId);
    throw error;
  }

  if (completed) {
    releaseAbortKill();
    await killTerminalSession(session.sessionId).catch(() => undefined);
    unregisterBackgroundTerminalSession(session.sessionId);
  } else {
    releaseAbortKill();
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
  const releaseAbortKill = bindTerminalSessionAbort(signal, session.sessionId);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transcript: string[] = [];
  let capturedResultOutputChars = 0;
  let capturedTranscriptChars = 0;
  let exitCode: number | null = null;
  let outputTruncated = false;
  let timedOut = false;
  let completed = false;

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

    // null cap = no soft TS-side limit.
    if (MAX_TERMINAL_LIVE_OUTPUT_CHARS === null) {
      target.push(text);
      return capturedChars + text.length;
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
        exitCode,
        live: !completed && !timedOut,
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

      await sleep(TERMINAL_TOOL_POLL_INTERVAL_MS, signal);
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
        completed = true;
        emitProgress();
        break;
      }
    }
  } catch (error) {
    releaseAbortKill();
    await killTerminalSession(session.sessionId).catch(() => undefined);
    throw error;
  }

  releaseAbortKill();
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

async function runTerminalCommandWithBestProgressRunner({
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
}) {
  return shouldUseBufferedTerminalCommand(command, timeoutMs)
    ? await runTerminalCommandFastWithProgress({
        command,
        onProgress,
        shell,
        signal,
        timeoutMs,
        workingDirectory,
      })
    : await runTerminalCommandWithProgress({
        command,
        onProgress,
        shell,
        signal,
        timeoutMs,
        workingDirectory,
      });
}

async function runTerminalCommandFastWithProgress({
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
  throwIfAborted(signal);
  onProgress({
    output: formatTerminalLiveOutput({
      command,
      outputTruncated: false,
      shell,
      timedOut: false,
      transcript: "[system] Running through the stable command runner...\n",
      workingDirectory,
    }),
    terminal: {
      command,
      live: true,
      outputTruncated: false,
      shell,
      timedOut: false,
      workingDirectory,
    },
  });

  const result = await runTerminalCommand({
    command,
    shell,
    timeoutMs,
    workingDirectory,
  });

  throwIfAborted(signal);
  onProgress({
    output: formatTerminalLiveOutput({
      command,
      outputTruncated: result.outputTruncated,
      shell: result.shell,
      timedOut: result.timedOut,
      transcript: formatFastTerminalTranscript(result),
      workingDirectory: result.workingDirectory,
    }),
    terminal: {
      command,
      exitCode: result.exitCode,
      live: false,
      outputTruncated: result.outputTruncated,
      shell: result.shell,
      timedOut: result.timedOut,
      workingDirectory: result.workingDirectory,
    },
  });

  return result;
}

function formatFastTerminalTranscript(result: TerminalRunCommandResponse) {
  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  const parts = [
    stdout,
    stderr ? `[stderr]\n${stderr}` : "",
    `[system] Command finished in ${result.durationMs} ms with exit code ${result.exitCode ?? "none"}.`,
  ].filter(Boolean);

  return parts.length > 0 ? limitToolResultBlock(parts.join("\n"), MAX_TERMINAL_LIVE_OUTPUT_CHARS) : "[system] Command completed with no output.";
}

function shouldUseBufferedTerminalCommand(command: string, timeoutMs: number) {
  const normalized = normalizeCommandForFastPath(command);
  const unwrapped = unwrapWindowsShellWrapper(normalized);

  if (!normalized || isLikelyDevServerCommand(unwrapped)) {
    return false;
  }

  if (looksLikePackageLifecycleCommand(unwrapped)) {
    return true;
  }

  if (/^git\s+(?:--no-pager\s+)?(?:init|status|diff|log|branch|show|rev-parse|remote|ls-files|describe|add|restore|reset|commit|push|pull|fetch|switch|checkout|merge|rebase|tag)\b/i.test(unwrapped)) {
    return true;
  }

  if (/^(?:pwd|whoami|hostname|git\s+--version|node\s+--version|npm(?:\.cmd)?\s+--version|pnpm(?:\.cmd)?\s+--version|yarn(?:\.cmd)?\s+--version|python\s+--version|py\s+--version|cargo\s+--version|rustc\s+--version)\b/i.test(unwrapped)) {
    return true;
  }

  if (/^(?:get-location|write-output|echo)\b/i.test(unwrapped)) {
    return true;
  }

  if (looksLikeProcessManagementCommand(unwrapped)) {
    return true;
  }

  if (looksLikeQuickEvidenceCommand(unwrapped)) {
    return true;
  }

  return timeoutMs <= FAST_TERMINAL_COMMAND_TIMEOUT_MS && !looksLikeStreamingCommand(unwrapped);
}

function effectiveTerminalTimeoutMs(command: string, timeoutMs: number, hasExplicitTimeout = false) {
  const normalized = normalizeCommandForFastPath(command);
  const unwrapped = unwrapWindowsShellWrapper(normalized);

  if (looksLikeQuickEvidenceCommand(unwrapped)) {
    return Math.min(timeoutMs, FAST_EVIDENCE_COMMAND_TIMEOUT_MS);
  }

  if (!hasExplicitTimeout && looksLikePackageSetupCommand(unwrapped)) {
    return Math.max(timeoutMs, PACKAGE_SETUP_TERMINAL_TIMEOUT_MS);
  }

  return timeoutMs;
}

function looksLikeQuickEvidenceCommand(command: string) {
  return (
    /^(?:curl(?:\.exe)?|wget(?:\.exe)?|iwr|invoke-webrequest|irm|invoke-restmethod|rg|grep|findstr|select-string|get-content|cat|type|head|tail|ls|dir|get-childitem|where(?:\.exe)?|which)\b/i.test(command) ||
    /\|\s*(?:head|tail|grep|select-string|findstr)\b/i.test(command)
  );
}

function looksLikeProcessManagementCommand(command: string) {
  return (
    /^(?:get-process|get-nettcpconnection|stop-process|taskkill|netstat|lsof|kill|pkill)\b/i.test(command) ||
    /\|\s*(?:where-object|foreach-object|stop-process|kill|select-object)\b/i.test(command)
  );
}

function normalizeCommandForFastPath(command: string) {
  return command
    .replace(/\s+(?:2>&\s*1|2>|>>|1?>)(?:\s*[^&|;]+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapWindowsShellWrapper(command: string) {
  return command
    .replace(/^cmd(?:\.exe)?\s+\/[dqsc]+\s+"?([\s\S]*?)"?$/i, "$1")
    .replace(/^powershell(?:\.exe)?\s+(?:-[a-z]+\s+)*"?([\s\S]*?)"?$/i, "$1")
    .trim();
}

function looksLikePackageLifecycleCommand(command: string) {
  return /^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|ci|add|update|rebuild|dedupe|run\s+(?:build|typecheck|check|lint|test|test:unit|format|format:check)|test)\b|cargo\s+(?:check|test|build)\b|\.?\\?gradlew(?:\.bat)?\s+(?:test|check|build|assemble\w*)\b)/i.test(command);
}

function looksLikePackageSetupCommand(command: string) {
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|ci|add|update|rebuild|dedupe)\b/i.test(segment) ||
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:create|init)\b/i.test(segment) ||
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+exec\b[\s\S]*\bcreate-[a-z0-9@/._-]+\b/i.test(segment) ||
    /^(?:npx|bunx)(?:\.cmd)?\b[\s\S]*\b(?:create-[a-z0-9@/._-]+|create-[a-z0-9@/._-]+@[\w.-]+)\b/i.test(segment) ||
    /^(?:yarn|pnpm)(?:\.cmd)?\s+dlx\b[\s\S]*\bcreate-[a-z0-9@/._-]+\b/i.test(segment)
  );
}

function looksLikeStreamingCommand(command: string) {
  return /\b(?:npm(?:\.cmd)?|npx(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun|bunx|cargo|gradle|gradlew|pytest|vitest|jest|playwright|tauri|vite|next|react-scripts)\b/i.test(command);
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
    `Shell: ${terminalShellLabel(shell)}`,
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
    sessionId: result.sessionId,
    shell: result.shell,
    timedOut: result.timedOut,
    workingDirectory: result.workingDirectory,
  };
}

function bindTerminalSessionAbort(signal: AbortSignal | undefined, sessionId: string) {
  if (!signal) {
    return () => undefined;
  }

  const killSession = () => {
    void killTerminalSession(sessionId).catch(() => undefined);
  };

  if (signal.aborted) {
    killSession();
    return () => undefined;
  }

  signal.addEventListener("abort", killSession, { once: true });
  return () => signal.removeEventListener("abort", killSession);
}

function formatTerminalRunResult(command: string, result: TerminalRunCommandResponse, extraDetail?: string, options: { maxStreamChars?: number | null } = {}) {
  const maxStreamChars = options.maxStreamChars === undefined ? MAX_TERMINAL_RESULT_OUTPUT_CHARS : options.maxStreamChars;
  const outputTruncated = result.outputTruncated || isTerminalStreamOutputTruncated(result.stdout, maxStreamChars) || isTerminalStreamOutputTruncated(result.stderr, maxStreamChars);

  return [
    `Command: ${command}`,
    `Shell: ${terminalShellLabel(result.shell)}`,
    `Working directory: ${result.workingDirectory}`,
    `Exit code: ${result.exitCode ?? "none"}`,
    `Timed out: ${result.timedOut ? "yes" : "no"}`,
    `Output truncated: ${outputTruncated ? "yes" : "no"}`,
    `Duration: ${result.durationMs} ms`,
    extraDetail ?? "",
    formatTerminalStream("STDOUT", result.stdout, maxStreamChars),
    formatTerminalStream("STDERR", result.stderr, maxStreamChars),
  ]
    .filter(Boolean)
    .join("\n");
}

function isTerminalStreamOutputTruncated(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars)) {
    return false;
  }

  return content.replace(/\r\n/g, "\n").trimEnd().length > maxChars;
}

function createTerminalFailureRecoveryHint(command: string, result: TerminalRunCommandResponse, roots: string[]) {
  if (result.timedOut || result.exitCode === null || result.exitCode === 0 || !looksLikeVerificationCommand(command)) {
    return "";
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const reportedPath = findFirstReportedLocalSourcePath(combinedOutput, roots);

  return [
    "Failure recovery:",
    reportedPath
      ? `- The failing command reported a local source file: ${reportedPath}. Inspect that file/line first and fix the exact syntax or class typo before changing project config.`
      : "- The failing command reported a local build/test error. Inspect the first local source error in STDOUT/STDERR before changing project config or researching unrelated causes.",
    "- Use view_code plus one narrow edit_file/inline_edit change, then rerun the same command. Do not recover syntax failures by rewriting the whole file with write_file.",
  ].join("\n");
}

function createPackageSetupTimeoutRecoveryHint(command: string, result: TerminalRunCommandResponse) {
  const normalized = unwrapWindowsShellWrapper(normalizeCommandForFastPath(command));

  if (!result.timedOut || !looksLikePackageSetupCommand(normalized)) {
    return "";
  }

  return [
    "Timeout recovery:",
    "- Package scaffold/install commands can be quiet while npm downloads packages; a timeout with no output does not prove an interactive prompt.",
    "- Inspect the target directory, then retry once with a longer timeout before falling back to manual scaffolding.",
  ].join("\n");
}

function looksLikeVerificationCommand(command: string) {
  const normalized = unwrapWindowsShellWrapper(normalizeCommandForFastPath(command));
  return /(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:build|check|typecheck|lint|test|test:unit)\b|(?:vite|tsc|eslint|vitest|jest|playwright)\b|cargo\s+(?:check|test|build)\b|gradlew(?:\.bat)?\s+(?:test|check|build|assemble\w*)\b/i.test(normalized);
}

function findFirstReportedLocalSourcePath(output: string, roots: string[]) {
  const candidates = Array.from(output.matchAll(/[A-Z]:[\\/][^\r\n"'<>|]+?\.(?:css|scss|sass|less|js|jsx|ts|tsx|json|html|vue|svelte|rs|py|java|kt)(?::\d+)?(?::\d+)?/gi))
    .map((match) => match[0].replace(/:(?:undefined|NaN|\d+)(?::(?:undefined|NaN|\d+))?$/i, ""));

  for (const candidate of candidates) {
    if (roots.length === 0 || roots.some((root) => isPathInsideRoot(candidate, root))) {
      return candidate;
    }
  }

  return "";
}

function formatTerminalStream(label: string, content: string, maxChars: number | null = MAX_TERMINAL_RESULT_OUTPUT_CHARS) {
  const normalized = content.replace(/\r\n/g, "\n").trimEnd();

  if (!normalized) {
    return `${label}: <empty>`;
  }

  return `${label}\n${maxChars === null ? normalized : limitToolResultBlock(normalized, maxChars)}`;
}

function terminalShellFromArgs(args: Record<string, string>): TerminalShellId {
  const shell = (firstArg(args, ["shell", "terminal_shell"]) ?? "").toLowerCase();

  if (shell.includes("cmd")) {
    return "cmd";
  }

  if (shell.includes("pwsh") || shell.includes("powershell")) {
    return "powershell";
  }

  if (shell.includes("zsh")) {
    return "zsh";
  }

  if (shell.includes("bash")) {
    return "bash";
  }

  if (shell === "sh" || shell.includes("/sh")) {
    return "sh";
  }

  return getDefaultTerminalShell();
}

function terminalTimeoutFromArgs(args: Record<string, string>) {
  const explicitTimeout = optionalNumberArg(args, ["timeout"]);
  const seconds = optionalNumberArg(args, ["timeout_seconds", "timeoutSeconds", "seconds"]);
  const milliseconds = optionalNumberArg(args, ["timeout_ms", "timeoutMs", "milliseconds"]);
  const inferredTimeout = explicitTimeout === undefined ? undefined : explicitTimeout * 1000;

  return clamp(milliseconds ?? inferredTimeout ?? (seconds === undefined ? DEFAULT_TERMINAL_TIMEOUT_MS : seconds * 1000), 1_000, MAX_TERMINAL_TIMEOUT_MS);
}

function hasExplicitTerminalTimeoutArg(args: Record<string, string>) {
  return argValue(args, ["timeout", "timeout_seconds", "timeoutSeconds", "seconds", "timeout_ms", "timeoutMs", "milliseconds"]) !== undefined;
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
    "Use view_code plus edit_file for existing source edits, write_file/create_files for new files, then use run_terminal for tests, builds, package installs, formatters, or command evidence.",
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
      outOfRoots: !isWorkingDirectoryInsideRoots(fallbackWorkingDirectory, roots),
      rebasedFromCommand: false,
      workingDirectory: fallbackWorkingDirectory,
    };
  }

  return {
    command: leadingCd.command,
    outOfRoots: !isWorkingDirectoryInsideRoots(leadingCd.workingDirectory, roots),
    rebasedFromCommand: true,
    workingDirectory: leadingCd.workingDirectory,
  };
}

function isWorkingDirectoryInsideRoots(workingDirectory: string, roots: string[]) {
  if (!workingDirectory || roots.length === 0) {
    return false;
  }
  return roots.some((root) => isPathInsideRoot(workingDirectory, root));
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
  const fallbackRoot = roots[0] ?? "";
  const requestedDirectory = sanitizeTerminalDirectoryValue(firstArg(args, ["cwd", "working_directory", "workingDirectory", "directory_path", "folder_path"]), roots);

  if (!requestedDirectory) {
    return fallbackRoot;
  }

  if (isAbsoluteLocalPath(requestedDirectory)) {
    return requestedDirectory;
  }

  return resolveTerminalDirectoryPath(requestedDirectory, fallbackRoot) ?? requestedDirectory;
}

function sanitizeTerminalDirectoryValue(value: string | undefined, roots: string[]) {
  const cleaned = stripLeakedToolMarkup(value ?? "").trim();

  if (!cleaned) {
    return "";
  }

  const matchingRoot = roots
    .slice()
    .sort((left, right) => right.length - left.length)
    .find((root) => hasRootPrefixWithMarkupOrSeparator(cleaned, root));

  if (matchingRoot && !isPathInsideRoot(cleaned, matchingRoot)) {
    return matchingRoot;
  }

  return cleaned;
}

function hasRootPrefixWithMarkupOrSeparator(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  if (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return true;
  }

  const nextChar = normalizedPath[normalizedRoot.length] ?? "";
  return normalizedPath.startsWith(normalizedRoot) && (nextChar === "<" || /\s/.test(nextChar));
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

  if (roots.length === 0 || !workingDirectory) {
    return {
      allowed: false,
      reason: "no workspace folder is open. Ask the user to pick a folder, then retry.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(workingDirectory, root))) {
    return {
      allowed: false,
      reason: `the working directory "${workingDirectory}" is outside the workspace roots ${roots.join(" | ")}. Retry with a cwd inside one of these roots.`,
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

function customToolPath(root: string, toolName: string, runtime: CustomToolRuntime) {
  return joinLocalPath(root, [".gilbert", "tools", `${toolName}.${CUSTOM_TOOL_RUNTIME_EXTENSIONS[runtime]}`]);
}

async function resolveCustomToolPath(args: Record<string, string>, roots: string[], shell: TerminalShellId, requestedRuntime?: CustomToolRuntime) {
  const explicitPath = firstArg(args, ["path", "file_path", "tool_path"]);

  if (explicitPath) {
    return explicitPath;
  }

  const toolName = sanitizeCustomToolName(firstArg(args, ["tool_name", "name", "id"]));

  if (!toolName) {
    return "";
  }

  const candidateRuntimes = orderedCustomToolRuntimeCandidates(requestedRuntime, shell);
  const visitedPaths = new Set<string>();

  for (const root of roots) {
    for (const candidateRuntime of candidateRuntimes) {
      for (const candidate of customToolPathCandidates(root, toolName, candidateRuntime)) {
        const key = normalizeComparablePath(candidate);

        if (visitedPaths.has(key)) {
          continue;
        }

        visitedPaths.add(key);

        try {
          await readComputerTextFile(candidate, 512);
          return candidate;
        } catch {
          continue;
        }
      }
    }
  }

  return "";
}

function customToolPathCandidates(root: string, toolName: string, runtime: CustomToolRuntime) {
  const extensions =
    runtime === "javascript"
      ? ["mjs", "js", "cjs"]
      : runtime === "typescript"
        ? ["ts", "mts", "cts"]
        : [CUSTOM_TOOL_RUNTIME_EXTENSIONS[runtime]];

  return extensions.map((extension) => joinLocalPath(root, [".gilbert", "tools", `${toolName}.${extension}`]));
}

function orderedCustomToolRuntimeCandidates(requestedRuntime: CustomToolRuntime | undefined, shell: TerminalShellId): CustomToolRuntime[] {
  const platform = getHostPlatform();
  const platformRuntimes: CustomToolRuntime[] =
    platform === "macos" ? ["zsh", "bash", "sh"] : platform === "linux" ? ["bash", "sh", "zsh"] : ["powershell", "cmd"];

  return uniqueCustomToolRuntimes([
    requestedRuntime,
    terminalShellRuntime(shell),
    ...platformRuntimes,
    "python",
    "typescript",
    "javascript",
    "powershell",
    "cmd",
    "bash",
    "zsh",
    "sh",
  ].filter(Boolean) as CustomToolRuntime[]);
}

function uniqueCustomToolRuntimes(runtimes: CustomToolRuntime[]) {
  return runtimes.filter((runtime, index) => runtimes.indexOf(runtime) === index);
}

function terminalShellRuntime(shell: TerminalShellId): CustomToolRuntime {
  return shell;
}

function customToolRuntimeFromArgs(args: Record<string, string>, shell: TerminalShellId, script?: string): CustomToolRuntime {
  const rawRuntime = firstArg(args, ["language", "runtime", "tool_type", "toolType", "type", "interpreter"]);
  const normalized = (rawRuntime ?? "").trim().toLowerCase();

  if (normalized) {
    if (/\b(?:python|py|python3)\b/.test(normalized)) {
      return "python";
    }

    if (/\b(?:typescript|ts|tsx)\b/.test(normalized)) {
      return "typescript";
    }

    if (/\b(?:javascript|js|mjs|cjs|node|nodejs|node\.js)\b/.test(normalized)) {
      return "javascript";
    }

    if (normalized.includes("cmd")) {
      return "cmd";
    }

    if (normalized.includes("pwsh") || normalized.includes("powershell")) {
      return "powershell";
    }

    if (normalized.includes("zsh")) {
      return "zsh";
    }

    if (normalized.includes("bash")) {
      return "bash";
    }

    if (normalized === "sh" || normalized.includes("/sh")) {
      return "sh";
    }
  }

  const shebang = script?.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";

  if (shebang.startsWith("#!")) {
    if (shebang.includes("python")) {
      return "python";
    }

    if (shebang.includes("node")) {
      return "javascript";
    }

    if (shebang.includes("zsh")) {
      return "zsh";
    }

    if (shebang.includes("bash")) {
      return "bash";
    }

    if (shebang.includes("sh")) {
      return "sh";
    }
  }

  return terminalShellRuntime(shell);
}

function customToolRuntimeFromPath(toolPath: string, requestedRuntime: CustomToolRuntime | undefined, requestedShell: TerminalShellId): CustomToolRuntime {
  const lowerPath = toolPath.toLowerCase();

  if (lowerPath.endsWith(".py")) {
    return "python";
  }

  if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".mts") || lowerPath.endsWith(".cts")) {
    return "typescript";
  }

  if (lowerPath.endsWith(".mjs") || lowerPath.endsWith(".cjs") || lowerPath.endsWith(".js")) {
    return "javascript";
  }

  if (lowerPath.endsWith(".cmd")) {
    return "cmd";
  }

  if (lowerPath.endsWith(".ps1")) {
    return "powershell";
  }

  if (lowerPath.endsWith(".sh")) {
    if (requestedRuntime && isShellCustomToolRuntime(requestedRuntime) && isPosixTerminalShell(requestedRuntime)) {
      return requestedRuntime;
    }

    if (isPosixTerminalShell(requestedShell)) {
      return requestedShell;
    }

    const defaultShell = getDefaultTerminalShell();
    return isPosixTerminalShell(defaultShell) ? defaultShell : "bash";
  }

  return requestedRuntime ?? terminalShellRuntime(requestedShell);
}

function isShellCustomToolRuntime(runtime: CustomToolRuntime): runtime is TerminalShellId {
  return runtime === "powershell" || runtime === "cmd" || runtime === "bash" || runtime === "zsh" || runtime === "sh";
}

function terminalShellForCustomToolRuntime(runtime: CustomToolRuntime, requestedShell: TerminalShellId): TerminalShellId {
  return isShellCustomToolRuntime(runtime) ? runtime : requestedShell;
}

function customToolRuntimeLabel(runtime: CustomToolRuntime) {
  if (runtime === "javascript") {
    return "JavaScript / Node.js";
  }

  if (runtime === "typescript") {
    return "TypeScript";
  }

  if (runtime === "python") {
    return "Python";
  }

  return terminalShellLabel(runtime);
}

function customToolArgsFromArgs(args: Record<string, string>, shell: TerminalShellId) {
  const jsonArgs = argValue(args, ["args_json", "arguments_json", "input_json", "payload_json"]);

  if (jsonArgs !== undefined) {
    return quoteShellArg(jsonArgs, shell);
  }

  return argValue(args, ["args", "arguments", "tool_args"]) ?? "";
}

function createCustomToolCommand(runtime: CustomToolRuntime, shell: TerminalShellId, toolPath: string, args: string, workingDirectory: string) {
  if (runtime === "python") {
    return createPythonToolCommand(shell, toolPath, args);
  }

  if (runtime === "javascript") {
    return createJavaScriptToolCommand(shell, toolPath, args);
  }

  if (runtime === "typescript") {
    return createTypeScriptToolCommand(shell, toolPath, args, workingDirectory);
  }

  const quotedToolPath = quoteShellArg(toolPath, shell);

  if (shell === "cmd") {
    return appendToolArgs(quotedToolPath, args);
  }

  if (shell === "powershell") {
    return appendToolArgs(`& ${quotedToolPath}`, args);
  }

  return appendToolArgs(`${shell} ${quotedToolPath}`, args);
}

function createPythonToolCommand(shell: TerminalShellId, toolPath: string, args: string) {
  const quotedToolPath = quoteShellArg(toolPath, shell);

  if (shell === "powershell") {
    const pyCommand = appendToolArgs(`& py -3 ${quotedToolPath}`, args);
    const pythonCommand = appendToolArgs(`& python ${quotedToolPath}`, args);
    return `if (Get-Command py -ErrorAction SilentlyContinue) { ${pyCommand} } else { ${pythonCommand} }`;
  }

  if (shell === "cmd") {
    return `${appendToolArgs(`py -3 ${quotedToolPath}`, args)} || ${appendToolArgs(`python ${quotedToolPath}`, args)}`;
  }

  return `if command -v python3 >/dev/null 2>&1; then ${appendToolArgs(`python3 ${quotedToolPath}`, args)}; else ${appendToolArgs(`python ${quotedToolPath}`, args)}; fi`;
}

function createJavaScriptToolCommand(shell: TerminalShellId, toolPath: string, args: string) {
  const quotedToolPath = quoteShellArg(toolPath, shell);
  const command = appendToolArgs(`node ${quotedToolPath}`, args);

  return shell === "powershell" ? `& ${command}` : command;
}

function createTypeScriptToolCommand(shell: TerminalShellId, toolPath: string, args: string, workingDirectory: string) {
  const quotedToolPath = quoteShellArg(toolPath, shell);
  const nodeStripTypesCommand = appendToolArgs(`node --experimental-strip-types ${quotedToolPath}`, args);
  const localTsx = quoteShellArg(joinLocalPath(workingDirectory, ["node_modules", ".bin", shell === "cmd" || shell === "powershell" ? "tsx.cmd" : "tsx"]), shell);
  const localTsNode = quoteShellArg(joinLocalPath(workingDirectory, ["node_modules", ".bin", shell === "cmd" || shell === "powershell" ? "ts-node.cmd" : "ts-node"]), shell);

  if (shell === "powershell") {
    return [
      `$tool = ${quotedToolPath}`,
      `$localTsx = ${localTsx}`,
      `$localTsNode = ${localTsNode}`,
      `if (Test-Path $localTsx) { ${appendToolArgs("& $localTsx $tool", args)} } elseif (Get-Command tsx -ErrorAction SilentlyContinue) { ${appendToolArgs("& tsx $tool", args)} } elseif (Test-Path $localTsNode) { ${appendToolArgs("& $localTsNode $tool", args)} } elseif (Get-Command ts-node -ErrorAction SilentlyContinue) { ${appendToolArgs("& ts-node $tool", args)} } else { ${appendToolArgs("& node --experimental-strip-types $tool", args)} }`,
    ].join("; ");
  }

  if (shell === "cmd") {
    return `if exist ${localTsx} (${appendToolArgs(`${localTsx} ${quotedToolPath}`, args)}) else if exist ${localTsNode} (${appendToolArgs(`${localTsNode} ${quotedToolPath}`, args)}) else (${nodeStripTypesCommand})`;
  }

  return `if [ -x ${localTsx} ]; then ${appendToolArgs(`${localTsx} ${quotedToolPath}`, args)}; elif command -v tsx >/dev/null 2>&1; then ${appendToolArgs(`tsx ${quotedToolPath}`, args)}; elif [ -x ${localTsNode} ]; then ${appendToolArgs(`${localTsNode} ${quotedToolPath}`, args)}; elif command -v ts-node >/dev/null 2>&1; then ${appendToolArgs(`ts-node ${quotedToolPath}`, args)}; else ${nodeStripTypesCommand}; fi`;
}

function appendToolArgs(command: string, args: string) {
  const normalizedArgs = args.trim();
  return normalizedArgs ? `${command} ${normalizedArgs}` : command;
}

function normalizeScriptText(script: string) {
  return script.replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
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
        .filter(Boolean)
        .map((path) => resolveWorkspacePath(path, roots));

      if (paths.length > 0) {
        return paths;
      }
    } catch {
      return [filesJson];
    }
  }

  const path = firstArg(args, ["path", "file_path", "file"]);

  if (path) {
    return [resolveWorkspacePath(path, roots)];
  }

  const title = firstArg(args, ["title", "name"]) || "untitled";
  const extension = (firstArg(args, ["extension", "ext", "language"]) || "txt").replace(/^\./, "");
  return [joinLocalPath(resolveWorkspacePath(firstArg(args, ["directory_path", "folder_path", "directory", "folder"]) || roots[0], roots), [`${title.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.${extension}`])];
}

async function computerPathExists(path: string, roots: string[]) {
  const resolvedPath = resolveWorkspacePath(path, roots);

  if (!roots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return false;
  }

  try {
    const listing = await listComputerDirectory(directoryName(resolvedPath), 2_000);
    const name = baseName(resolvedPath).toLowerCase();
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

async function inferTestCommand(root: string) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.test && !packageJson.scripts.test.includes("no test specified")) {
    return packageManagerCommand("test");
  }

  if (packageJson?.scripts?.["test:unit"]) {
    return packageManagerCommand("run test:unit");
  }

  if (await textFileExists(joinLocalPath(root, ["Cargo.toml"]))) {
    return "cargo test";
  }

  if (getHostPlatform() === "windows" && await textFileExists(joinLocalPath(root, ["gradlew.bat"]))) {
    return ".\\gradlew.bat test";
  }

  if (await textFileExists(joinLocalPath(root, ["gradlew"]))) {
    return "./gradlew test";
  }

  if (await textFileExists(joinLocalPath(root, ["gradlew.bat"]))) {
    return ".\\gradlew.bat test";
  }

  return "";
}

async function inferTypeScriptCommand(root: string) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.typecheck) {
    return packageManagerCommand("run typecheck");
  }

  if (packageJson?.scripts?.["tsc"]) {
    return packageManagerCommand("run tsc");
  }

  if (await textFileExists(joinLocalPath(root, ["tsconfig.json"]))) {
    return packageBinCommand("tsc", "--noEmit");
  }

  return "";
}

async function inferSyntaxCheckCommand(root: string, paths: string[]) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.typecheck) {
    return packageManagerCommand("run typecheck");
  }

  if (packageJson?.scripts?.check) {
    return packageManagerCommand("run check");
  }

  if (packageJson?.scripts?.build) {
    return packageManagerCommand("run build");
  }

  if (packageJson?.scripts?.lint) {
    return packageManagerCommand("run lint");
  }

  if (await textFileExists(joinLocalPath(root, ["tsconfig.json"]))) {
    return packageBinCommand("tsc", "--noEmit");
  }

  const singleNodeCheckPath = paths.length === 1 && isNodeCheckableJavaScriptPath(paths[0]) ? paths[0] : "";

  if (singleNodeCheckPath) {
    return `${getHostPlatform() === "windows" ? "node.exe" : "node"} --check ${quoteShellArg(singleNodeCheckPath, getDefaultTerminalShell())}`;
  }

  if (await textFileExists(joinLocalPath(root, ["Cargo.toml"]))) {
    return "cargo check";
  }

  return "";
}

function isSyntaxCheckCandidatePath(path: string) {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx|json|css|scss|sass|less|html|svelte|vue|rs|go|py|java|kt|swift)$/i.test(path);
}

function isNodeCheckableJavaScriptPath(path: string) {
  return /\.(?:cjs|js|mjs)$/i.test(path);
}

function packageManagerCommand(args: string) {
  return `${getHostPlatform() === "windows" ? "npm.cmd" : "npm"} ${args}`;
}

function packageBinCommand(binaryName: string, args: string) {
  const command = getHostPlatform() === "windows" ? `node_modules\\.bin\\${binaryName}.cmd` : `./node_modules/.bin/${binaryName}`;
  return `${command} ${args}`.trim();
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

function getWritePolicy(settings: LocalWorkspaceSettings, roots: string[], path: string) {
  const resolvedPath = resolveWorkspacePath(path, roots);

  if (settings.permissionMode === "read-only") {
    return {
      allowed: false,
      reason: "Read-only mode is on. Tell the user: \"I cannot edit files in read-only mode. Switch the workspace permission mode to Auto or Ask first to allow writes.\"",
    };
  }

  if (settings.permissionMode === "ask-first") {
    return {
      allowed: false,
      reason: "Ask-first mode requires the user to confirm each write. Tell the user what you want to write and ask them to approve.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return {
      allowed: false,
      reason: buildOutsideWorkspaceMessage(path, resolvedPath, roots),
    };
  }

  return {
    allowed: true,
  };
}

function resolveBroadSearchRoots(settings: LocalWorkspaceSettings, roots: string[], args: Record<string, string>) {
  const requestedRoot = firstArg(args, ["root", "roots", "directory_path", "folder_path", "directory", "folder", "cwd"]);

  if (requestedRoot) {
    const resolvedRoot = resolveWorkspacePath(requestedRoot, roots);
    return roots.some((root) => isPathInsideRoot(resolvedRoot, root)) ? [resolvedRoot] : [];
  }

  if (settings.scope === "full-computer") {
    return getIndexableWorkspaceRoots(roots, settings.scope);
  }

  return roots;
}

function skipFullComputerBroadSearch() {
  return {
    content: [
      "Skipped broad full-computer search.",
      "Full computer access is lazy and does not build or query a whole-drive index automatically.",
      "Provide a specific directory_path/folder_path/root for search_files/recall_context, or use list_directory/read_file with an explicit path.",
    ].join("\n"),
    executed: false,
  };
}

function getDisabledToolReason(tool: LocalComputerToolName, settings: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);

  if (tool === "web_search" && !tools.webSearch) {
    return "web_search is disabled in Toolbox.";
  }

  if (tool === "weather" && !tools.weatherTools) {
    return "weather is disabled in Toolbox.";
  }

  if (isGithubToolName(tool) && !tools.sourceControl) {
    return "GitHub source control is disabled in Toolbox.";
  }

  if (isLocalGitToolName(tool) && !tools.sourceControl) {
    return "Git source control is disabled in Toolbox.";
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

  if ((isFileCreationToolName(tool) || tool === "create_vite_project") && !tools.fileCreation) {
    return "file creation is disabled in Toolbox.";
  }

  if (tool === "delete_file" && !tools.fileSafety) {
    return "file safety tools are disabled in Toolbox.";
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

  if ((tool === "edit_file" || tool === "write_file" || tool === "move_path" || tool === "rename_path") && !tools.codeEdit) {
    return "code editing is disabled in Toolbox.";
  }

  if (
    (tool === "mcp_list_servers" || tool === "mcp_list_tools" || tool === "mcp_call_tool" || tool === "mcp_set_server" || tool === "mcp_remove_server")
    && !tools.mcpServers
  ) {
    return "MCP servers are disabled in Toolbox.";
  }

  return "";
}
