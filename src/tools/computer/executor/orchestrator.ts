import type { ChatArtifact, ChatProgressItem, ChatSource, ChatToolCall } from "../../../types/chat";
import type { AgentApproval, AgentApprovalDecision } from "../../../types/agentRun";
import type { McpServerConfig, McpSettings, McpServerTransport } from "../../../types/mcp";
import { normalizeMcpServerLabel, normalizeMcpSettings } from "../../../types/mcp";
import { flattenMcpContent, mcpCallTool, mcpListTools } from "../../../services/mcpClient";
import { createTerminalSession, drainTerminalSession, isTauriDesktopRuntime, killTerminalSession, runBrowserAutomation, runTerminalCommand, writeTerminalSession } from "../../../app/tauriClient";
import { getDefaultTerminalShell, getHostPlatform, isPosixTerminalShell, terminalShellLabel } from "../../../lib/terminalShells";
import { normalizeProjectName } from "../../../lib/chatUtils";
import { loadPdfLibraryState, savePdfLibraryState } from "../../../lib/appStorage";
import { getBackgroundTerminalSessions, registerBackgroundTerminalSession, unregisterBackgroundTerminalSession, updateBackgroundTerminalSession } from "../../../lib/terminalSessions";
import type { TerminalOutputChunk, TerminalRunCommandResponse, TerminalShellId } from "../../../types/terminal";
import type { WebSearchSettings } from "../../../types/settings";
import { normalizeToolRegistrySettings } from "../../../types/tools";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { PdfLibraryRecord } from "../../../types/pdfLibrary";
import {
  DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS,
  MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS,
  MAX_TOOL_INPUT_PREVIEW_CHARS,
  STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  type LocalComputerToolExecutionPolicy,
} from "./policy";
import type {
  CompletedLocalToolItem,
  LocalComputerToolCallResult,
  LocalComputerToolName,
  LocalComputerToolRecoverableFailure,
  LocalComputerToolRunResult,
  LocalGitToolName,
  LocalSubagentResult,
  LocalSubagentTask,
  LocalToolFailureRecovery,
  LocalToolFailureRecoveryKind,
  McpToolContext,
  ParsedLocalComputerToolCall,
  PreparedLocalToolItem,
  ReadyLocalToolItem,
  SubagentRunHandler,
  TerminalProgressHandler,
  TerminalToolProgress,
  ToolCallUpdateHandler,
} from "./types";
import {
  LOCAL_GIT_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  hasNonEmptyArg,
  isLocalGitToolName,
} from "./toolNames";
import { fuseAdjacentLocalFileMutations } from "./fuseMutations";
import {
  limitToolCallScanContent,
  isRecord,
  parseDirectXmlToolCalls,
  parseLocalComputerToolCalls,
  stripDirectXmlToolCalls,
} from "./parser";
import {
  appendRecoveryMetadata,
  buildPreviousCompletedMap,
  createRecoverableFailureRecord,
  dedupeArtifacts,
  formatToolResultSection,
  recoverableToolFailure,
  resolveToolSectionStatus,
} from "./results";
import {
  approvalKindForTool,
  approvalRiskForTool,
  createApprovalSessionDecisionKey,
  hashApprovalInput,
} from "./approvals";
import { createFileChangeSummary } from "./fileChanges";
import { executeRegisteredTool, getDisabledToolReason } from "./registry";
import { quoteShellArg } from "./shell";
import {
  commandSegmentsForLongRunningDetection,
  effectiveTerminalTimeoutMs,
  isLikelyDevServerCommand,
  isLongRunningProcessCommand,
  looksLikePackageSetupCommand,
  normalizeCommandForFastPath,
  shouldUseBufferedTerminalCommand,
  unwrapWindowsShellWrapper,
} from "./terminalPolicy";
import { inferSyntaxCheckCommand, isSyntaxCheckCandidatePath } from "./syntaxCheck";
import { createGitCommand } from "./tools/git/common";
import { getWritePolicy, resolveBroadSearchRoots, skipFullComputerBroadSearch } from "./workspacePolicy";
import {
  formatContextRecallResults,
  formatDirectoryListing,
  formatSearchResults,
} from "./workspaceFormatters";
import {
  formatToolCallInput,
  formatToolName,
  limitToolCallOutput,
  summarizeToolCall,
} from "./toolPresentation";
import { createWorkflowApprovalPreview, workflowRunNeedsApproval } from "../../workflows";
import type {
  ComputerReadFileResult,
  ComputerDirectoryListing,
  ComputerSearchResult,
  LocalWorkspaceSettings,
} from "../../../types/localWorkspace";
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
} from "../files";
import type { GilbertProjectMemory } from "../files";
import { editComputerTextFile, formatPreciseCodeView } from "../editing";
import {
  formatFileCreationSummary,
  isFileCreationToolName,
  prepareFileCreationWritePlan,
} from "../../fileCreation";
import { collectTextQualityWarnings, formatTextQualityWarnings } from "../textQuality";
import { assertSyntaxBeforeWrite } from "../syntaxValidation";
import type { FileCreationPrepareFailure, FileCreationToolName, FileCreationWriteResult, PreparedFileCreationWrite } from "../../fileCreation";
import { isCodingToolName } from "../../coding";
import { createViteProjectScaffold } from "../../projectScaffold/viteProject";
import { isGithubToolName } from "../../github";
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
} from "../../../selfHeal";
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
  normalizeToolErrorMessage,
  normalizeArgName,
  normalizeComparablePath,
  numberArg,
  optionalNumberArg,
  preserveArgValue,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
  isMissingLocalPathError,
  skipNoRoots,
  sleep,
  stripLeakedToolMarkup,
  throwIfAborted,
} from "./argHelpers";

export { createApprovalSessionDecisionKey } from "./approvals";

const LOCAL_TOOL_PROGRESS_ID = "local-computer-tools";
const DEFAULT_CHAT_PDF_EXPORT_FOLDER = "GilbertCodex PDF Exports";
const DEFAULT_TERMINAL_TIMEOUT_MS = 45_000;
const MAX_TERMINAL_TIMEOUT_MS = 600_000;
const BACKGROUND_TERMINAL_PROBE_MS = 18_000;
const BACKGROUND_TERMINAL_FAST_RETURN_MS = 3_800;
const BACKGROUND_TERMINAL_MIN_READY_MS = 900;
const MAX_TERMINAL_LIVE_OUTPUT_CHARS = 256 * 1024;
const MAX_TERMINAL_RESULT_OUTPUT_CHARS = 256 * 1024;
const MAX_GIT_TOOL_RESULT_OUTPUT_CHARS = 180 * 1024;
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
  const parsedCalls = parseLocalComputerToolCalls(assistantContent, executionPolicy);
  const shouldFuseMutations = !previousToolCalls || previousToolCalls.length === 0;
  const calls = shouldFuseMutations ? fuseAdjacentLocalFileMutations(parsedCalls) : parsedCalls;
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

function getApprovalDecision(approval: AgentApproval, approvalDecisions?: Record<string, AgentApprovalDecision>) {
  return approvalDecisions?.[approval.id] ?? approvalDecisions?.[createApprovalSessionDecisionKey(approval)];
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
  // Batch tools (create_files, edit_files) count as exactly one mutation slot
  // and bypass the per-path dedup because their target paths live inside the
  // payload, not the call args.
  if (call.tool === "edit_files" || call.tool === "create_files") {
    if (state.maxMutations !== null && state.mutationCount >= state.maxMutations) {
      return [
        `Skipped ${formatToolName(call.tool)}: this pass already reached the source-file mutation limit of ${state.maxMutations}.`,
        "Use create_files for brand-new multi-file batches and edit_files for batched edits to existing files; verify the current state before emitting more edits in the next pass.",
      ].join("\n");
    }
    state.mutationCount += 1;
    return "";
  }

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
      "Use create_files for brand-new multi-file batches and edit_files for batched edits to existing files; verify the current state before emitting more edits in the next pass.",
    ].join("\n");
  }

  state.seenPaths.add(normalizedPath);
  state.mutationCount += 1;
  return "";
}

// Auto-batching helper lives in fuseMutations.ts so tests can import it
// without dragging in tauriClient transitively.

function canFollowEarlierSamePathMutation(call: ParsedLocalComputerToolCall) {
  if (call.tool === "edit_file") {
    return hasNonEmptyArg(call.args, ["old_text", "old_string", "old_str", "find", "search", "target", "before"]);
  }

  return false;
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
  "create_files",
  "create_vite_project",
  "edit_files",
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
  if (call.tool === "workflow_run") {
    return workflowRunNeedsApproval(call);
  }

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
  if (call.tool === "workflow_run") {
    return createWorkflowApprovalPreview(call);
  }

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

  const registeredResult = await executeRegisteredTool(call, {
    executeBrowserAutomationTool,
    executeCreateTool: (nextCall) => createCustomTerminalTool(nextCall, settings, roots),
    executeGitTool: (nextCall) => executeLocalGitToolCall(nextCall, settings, roots, signal, onTerminalProgress),
    executeOpenBrowserPreviewTool: (nextCall) => executeOpenBrowserPreviewTool(nextCall, roots, userPrompt, signal),
    executeRunTool: (nextCall) => runCustomTerminalTool(nextCall, settings, roots, signal, onTerminalProgress),
    executeTerminalTool: (nextCall) => executeTerminalCommandTool(nextCall, settings, roots, signal, onTerminalProgress, toolSettings),
    executeWorkflowPrimitive: (nextCall) =>
      executeLocalComputerToolCall(
        nextCall,
        settings,
        roots,
        userPrompt,
        webSearchMaxResults,
        webSearchSettings,
        toolSettings,
        signal,
        onTerminalProgress,
        onRunSubagents,
        mcpContext,
      ),
    mcpContext,
    onRunSubagents,
    onTerminalProgress,
    roots,
    settings,
    signal,
    toolSettings,
    userPrompt,
    webSearchMaxResults,
    webSearchSettings,
  });

  if (registeredResult) {
    return registeredResult;
  }

  switch (call.tool) {
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
