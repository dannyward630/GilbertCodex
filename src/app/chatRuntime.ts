import { createPlanningAnswersMessage } from "../services/planningClient";
import { formatWebSearchProviderLabel } from "../services/webSearchClient";
import { createVisibleFallbackFromToolCall, shouldToolCallForceSynthesis } from "../toolBridge";
import { createLocalComputerToolCallPreviews, createLocalComputerToolRequestContent, hasLocalComputerToolCalls } from "../localWorkspace/localToolRuntimeDisabled";
import type { LocalComputerToolExecutionPolicy } from "../localWorkspace/localToolRuntimeDisabled";
import type {
  ChatMessage,
  ChatPlanning,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatProgressItem,
  ChatSource,
  ChatToolCall,
  ChatWebSearch,
} from "../types/chat";
export function isRecoverableLocalEditFailure(..._args: unknown[]) {
  return false;
}

export function createRecoverableLocalEditRetryInstruction(prompt: string, ..._args: unknown[]) {
  return [
    "LOCAL TOOLS DISABLED",
    `Original user request: ${prompt}`,
    "Model-callable local edit tools have been removed from this build. Continue with a normal answer from the available conversation, workspace, and web context without emitting tool-call syntax.",
  ].join("\n\n");
}

/** Browser/provider abort detection shared by streaming, planning, and tool loops. */
export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Normalizes legacy single-request planning state and newer multi-request state. */
export function getPlanningInputRequests(planning?: ChatPlanning) {
  if (planning?.inputRequests?.length) {
    return planning.inputRequests;
  }

  return planning?.inputRequest ? [planning.inputRequest] : [];
}

export function getPendingPlanningInputRequest(planning?: ChatPlanning) {
  return getPlanningInputRequests(planning).find((request) => !request.answeredAt);
}

export function markPlanningInputAnswered(requests: ChatPlanningInputRequest[], requestId: string, answers: ChatPlanningInputAnswer[], answeredAt: string) {
  return requests.map((request) =>
    request.id === requestId
      ? {
          ...request,
          answeredAt,
          answers,
        }
      : request,
  );
}

export function createPlanningAnswerMessages(requests: ChatPlanningInputRequest[]) {
  return requests.filter((request) => request.answeredAt && request.answers?.length).map((request) => createPlanningAnswersMessage(request, request.answers ?? []));
}

/** Detects filler text that should not become the assistant's final visible answer. */
export function looksLikeOnlyToolPrelude(content: string) {
  const normalized = content.trim().toLowerCase();

  return (
    (normalized.length < 260 &&
      /\b(let me|let's|we need to|we should|we'll|we will|i need to|i'll|i will|now i need to)\b/.test(normalized) &&
      /\b(read|inspect|check|look|analyze|analyse|explore|use|try|retry|switch|create|scaffold|generate|edit|patch|write|fix|apply|open|launch|navigate|preview)\b/.test(normalized)) ||
    looksLikeUnexecutedToolActionPromise(content)
  );
}

/** Detects prose promises that should have been real tool calls. */
export function looksLikeUnexecutedToolActionPromise(content: string) {
  return false;
}

/** Detects visible explanations of the hidden action protocol instead of real runtime evidence. */
export function looksLikeToolProtocolNarration(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  return (
    /<<<\s*(?:END_)?TOOL_CALL\s*>>>/i.test(trimmed) ||
    /<\s*\/?\s*tool_call\b/i.test(trimmed) ||
    /<\s*\/?\s*arg_(?:key|value)\b/i.test(trimmed) ||
    /\barg_(?:key|value)\b[\s\S]{0,120}\b(?:path|command|cwd|old_text|new_text|files_read|edit_file|run_terminal)\b/i.test(trimmed) ||
    /\b(?:xml-style|xml style|compact)\s+tool_call\b/i.test(trimmed)
  );
}

export function isToolResultFallbackAnswer(content: string) {
  const normalized = content.toLowerCase();

  return (
    content.includes("## Answer From Completed Tool Results") ||
    content.includes("## Tool Run Needs Continuation") ||
    normalized.includes("final write-up did not come back cleanly") ||
    normalized.includes("finished the background work for this request") ||
    normalized.includes("use continue response") ||
    normalized.includes("saved activity") ||
    normalized.includes("saved in activity") ||
    normalized.includes("full file content is saved") ||
    normalized.includes("full listing is saved") ||
    normalized.includes("full result is saved") ||
    normalized.includes("workspace tree summary for") ||
    /\bscanned\s+[\d,]+\s+director(?:y|ies)\s+and\s+[\d,]+\s+files?\s+to\s+depth\b/i.test(content) ||
    content.includes("Latest completed result:") ||
    content.includes("The run stopped on this ") ||
    content.includes("I completed the tool work. Here are the saved results:") ||
    content.includes("provider still did not return separate visible answer text")
  );
}

/** Detects internal recovery prose that should be retried, not shown as an answer. */
export function looksLikeInternalToolRecoveryAnswer(content: string) {
  const normalized = content.trim().toLowerCase();

  return (
    isToolResultFallbackAnswer(content) ||
    normalized.includes("use continue response to keep this same run moving") ||
    normalized.includes("instead of leaving the chat blank") ||
    normalized.includes("that tool action was skipped or blocked") ||
    normalized.includes("check activity for the exact tool result") ||
    normalized.includes("adaptation recommendation") ||
    /\btool\s+\d+\s+\[(?:error|failed|skipped|waiting[_ -]?approval)\]:/i.test(normalized) ||
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:original request|what ran|evidence)\b[\s\S]{0,240}\b(executed|completed|tool call)\b/.test(normalized)
  );
}

/** Detects model-written imitations of app activity records. Real activity must live on message.toolCalls. */
export function looksLikeFabricatedToolActivity(content: string, toolCalls: ChatToolCall[] = []) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  if (/\[CONVERSATION CONTEXT SURFACE\]/i.test(trimmed)) {
    return true;
  }

  if (toolCalls.length > 0) {
    return false;
  }

  const status = String.raw`\[(?:active|complete|completed|error|failed|skipped|waiting[_ -]?approval|pending)\]`;
  const fakeToolLine = new RegExp(String.raw`\b(?:edit file|inline edit|write file|read file|apply search\/replace|run terminal command|terminal command|web search|browser automation)\s*${status}\s+(?:detail|input|output|old|new|line|command|cwd)\s*:`, "i");
  const fakeProgressLine = new RegExp(String.raw`\bagent tools\s*${status}\s*-\s*\d+\s+(?:deep research\s+)?tools?\s+ran\b`, "i");
  const unsupportedCompletionClaim =
    /\b(?:i|i've|i have|we|the app)\s+(?:edited|updated|patched|changed|applied|ran|executed)\b/i.test(trimmed) &&
    /\b(?:line\s+\d+|\.tsx?|\.jsx?|\.css|\.json|npx|npm|pnpm|yarn|tsc|typecheck|terminal|dev server|hot[- ]?reload|tool calls?)\b/i.test(trimmed);

  return (
    /\b(?:TOOL|TOL)\s+CALLS?\b/i.test(trimmed) && /\b(?:detail|input|output|old|new|line_start|line_end|command|cwd)\s*:/i.test(trimmed) ||
    fakeToolLine.test(trimmed) ||
    fakeProgressLine.test(trimmed) ||
    unsupportedCompletionClaim ||
    /\bCommand:\s*[^\n]+\nShell:\s*[^\n]+\nWorking directory:\s*[^\n]+\nExit code:\s*(?:-?\d+|none)\b/i.test(trimmed)
  );
}

export function createFabricatedToolActivityRecoveryInstruction(prompt: string, fabricatedContent: string, toolCalls: ChatToolCall[] = []) {
  const hasRealToolRecords = toolCalls.length > 0;
  const excerpt = fabricatedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL ACTIVITY INTEGRITY CHECK",
    `Original user request: ${prompt}`,
    hasRealToolRecords
      ? "The previous visible answer exposed internal activity text instead of answering from the app's real tool-call records."
      : "The previous visible answer claimed tool calls, file edits, terminal output, or progress records, but the app has no real tool-call records for that claim.",
    "Do not repeat or summarize fake activity. Never paste [CONVERSATION CONTEXT SURFACE], TOOL CALLS, PROGRESS, command output, or edit/run status lines as if they were real work.",
    "Model-callable local tools are disabled in this build. Answer from available evidence without claiming any local tool ran.",
    excerpt ? `Rejected fake activity excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant promised a tool action but emitted no tool call. */
export function createToolActionPromiseRecoveryInstruction(prompt: string, promisedContent: string) {
  const excerpt = promisedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "LOCAL TOOLS DISABLED",
    `Original user request: ${prompt}`,
    "The previous visible answer promised a local tool action, but model-callable local tools have been removed from this build.",
    "Do not repeat the promise or emit tool-call syntax. Answer normally from available evidence and state plainly when the requested action cannot be performed by the model in this build.",
    excerpt ? `Rejected promise excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant exposed how to call tools instead of using them. */
export function createToolProtocolNarrationRecoveryInstruction(prompt: string, narratedContent: string) {
  const excerpt = narratedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL PROTOCOL NARRATION REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible response discussed tool-call protocol even though model-callable local tools are disabled.",
    "Do not explain hidden tool protocol, batching mechanics, cwd choices, shell choices, timeout choices, or step-by-step tool formatting.",
    "Do not emit tool calls.",
    "If no tool is needed, answer normally in user-facing Markdown.",
    excerpt ? `Rejected protocol narration excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

export function createCompletedToolFallbackSummary(toolCall: ChatToolCall, output: string) {
  if (toolCall.resultPolicy && toolCall.resultPolicy.mode !== "allow_raw") {
    return createVisibleFallbackFromToolCall({
      ...toolCall,
      output,
    });
  }

  const label = toolCall.label.toLowerCase();

  if (/list.*(?:directory|workspace)|(?:directory|workspace).*list/i.test(label)) {
    return createDirectoryListingFallbackSummary(output, toolCall.input);
  }

  if (/read.*(?:file|workspace)|(?:file|workspace).*read/i.test(label)) {
    return createReadFileFallbackSummary(output, toolCall.input);
  }

  return null;
}

function createDirectoryListingFallbackSummary(output: string, input?: string) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0] ?? "";
  const headerMatch = header.match(/^(?:Recursive directory tree|Directory)\s+(.+?)\s+\(([\d,]+)\s+entries\):$/i);
  const rootPath = headerMatch?.[1] ?? parseToolInputPath(input);
  const declaredEntries = headerMatch?.[2] ? Number.parseInt(headerMatch[2].replace(/,/g, ""), 10) : undefined;
  const entryLines = lines.filter((line) => /^\[(?:dir|file)\]\s+/.test(line));

  if (entryLines.length === 0 && !declaredEntries) {
    return null;
  }

  let directoryCount = 0;
  let fileCount = 0;
  const extensionCounts = new Map<string, number>();
  const topLevelDirectories = new Set<string>();

  for (const line of entryLines) {
    const isDirectory = line.startsWith("[dir]");
    const entryPath = line.replace(/^\[(?:dir|file)\]\s+/, "");

    if (isDirectory) {
      directoryCount += 1;
      const topDirectory = getTopLevelEntryName(entryPath, rootPath);
      if (topDirectory) {
        topLevelDirectories.add(topDirectory);
      }
      continue;
    }

    fileCount += 1;
    const extension = getFileExtension(entryPath);
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  const entryCount = declaredEntries ?? entryLines.length;
  const extensionSummary = [...extensionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([extension, count]) => `${extension} ${formatFallbackNumber(count)}`)
    .join("; ");
  const directorySummary = [...topLevelDirectories].slice(0, 12).join(", ");

  return [
    `Listed ${formatFallbackNumber(entryCount)} director${entryCount === 1 ? "y entry" : "y entries"}${rootPath ? ` in ${rootPath}` : ""}.`,
    `Directories: ${formatFallbackNumber(directoryCount)}. Files: ${formatFallbackNumber(fileCount)}.`,
    extensionSummary ? `Top file types: ${extensionSummary}.` : "",
    directorySummary ? `Top-level folders seen: ${directorySummary}.` : "",
    /limited/i.test(output) ? "The listing was limited by the tool result." : "",
    "The full listing is saved in Activity and was not pasted into chat.",
  ].filter(Boolean).join("\n");
}

function createReadFileFallbackSummary(output: string, input?: string) {
  const path = parseToolInputPath(input);
  const lineCount = countFallbackLines(output);

  return [
    `I read ${path ? `\`${path}\`` : "the requested file"} successfully.`,
    `It is ${formatFallbackNumber(output.length)} characters across ${formatFallbackNumber(lineCount)} line${lineCount === 1 ? "" : "s"}.`,
    "I kept the full file body out of this message so the chat stays readable, but the completed read is available to the current run.",
  ].join("\n");
}

function parseToolInputPath(input?: string) {
  if (!input) {
    return "";
  }

  try {
    const parsed = JSON.parse(input) as { path?: unknown };
    return typeof parsed.path === "string" ? parsed.path : "";
  } catch {
    return "";
  }
}

function getTopLevelEntryName(path: string, rootPath: string) {
  const relativePath = rootPath && normalizePathForCompare(path).startsWith(normalizePathForCompare(rootPath))
    ? path.slice(rootPath.length).replace(/^[\\/]+/, "")
    : path;
  return relativePath.split(/[\\/]+/).filter(Boolean)[0] ?? "";
}

function normalizePathForCompare(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function getFileExtension(path: string) {
  const name = path.split(/[\\/]+/).pop() ?? "";
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? `.${name.slice(index + 1).toLowerCase()}` : "(no extension)";
}

function countFallbackLines(content: string) {
  if (!content) {
    return 0;
  }

  const newlineCount = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlineCount : newlineCount + 1;
}

function formatFallbackNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

/** Detects local build/edit/project requests that should not be answered without fresh tools. */
export function needsFreshLocalToolEvidence(prompt: string, hasWorkspaceRoots: boolean) {
  return false;
}

export function createFreshLocalToolEvidenceInstruction(prompt: string, unsupportedAnswer: string) {
  const excerpt = unsupportedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "LOCAL TOOLS DISABLED",
    `Original user request: ${prompt}`,
    "Model-callable local tools have been removed from this build.",
    "Do not claim filesystem changes, command output, or verification unless that evidence is already present in the conversation. Ask for the missing context or explain the limitation plainly.",
    excerpt ? `Unsupported answer excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

export interface SimpleLocalTaskCompletion {
  buildCommand?: string;
  installCommand?: string;
  previewUrl?: string;
  projectPath?: string;
  runCommand?: string;
}

export function isSimpleLocalScaffoldRequest(prompt: string) {
  return false;
}

export function detectSimpleLocalTaskCompletion(prompt: string, toolCalls: ChatToolCall[] = []): SimpleLocalTaskCompletion | null {
  if (!isSimpleLocalScaffoldRequest(prompt)) {
    return null;
  }

  const completedCalls = toolCalls.filter((toolCall) => toolCall.status === "complete");
  const scaffoldCall = completedCalls.find((toolCall) => /(?:create|scaffold).*(?:vite|react)|vite.*project/i.test(toolCall.label) || /Vite React project scaffolded/i.test(toolCallText(toolCall)));
  const installCall = completedCalls.find((toolCall) => isSuccessfulTerminalToolCall(toolCall) && isPackageInstallCommand(toolCall));
  const buildCall = completedCalls.find((toolCall) => isSuccessfulTerminalToolCall(toolCall) && isViteBuildCommand(toolCall));
  const runCall = completedCalls.find((toolCall) => isDevServerStartedToolCall(toolCall));

  if (!scaffoldCall || !installCall || !buildCall || !runCall) {
    return null;
  }

  return {
    buildCommand: buildCall.terminal?.command,
    installCommand: installCall.terminal?.command,
    previewUrl: findLocalPreviewUrl(toolCallText(runCall)) ?? findLocalPreviewUrl(completedCalls.map(toolCallText).join("\n")),
    projectPath: findProjectPath(toolCallText(scaffoldCall)) ?? buildCall.terminal?.workingDirectory ?? installCall.terminal?.workingDirectory,
    runCommand: runCall.terminal?.command,
  };
}

export function isEmptySelectedScaffoldProbe(prompt: string, contextMessage: string, toolCalls: ChatToolCall[] = []) {
  if (!isSimpleLocalScaffoldRequest(prompt)) {
    return false;
  }

  if (toolCalls.some((toolCall) => /create.*vite|vite.*project/i.test(toolCall.label) && toolCall.status === "complete")) {
    return false;
  }

  const context = contextMessage.toLowerCase();
  const listedEmptyRoot =
    /\btool\s+\d+\s+\[ok\]:\s*list_directory\b[\s\S]{0,700}\bentries returned:\s*0\b/i.test(contextMessage) ||
    toolCalls.some((toolCall) => toolCall.status === "complete" && /list directory/i.test(toolCall.label) && /\bentries returned:\s*0\b/i.test(toolCall.output ?? ""));
  const probedMissingStarter =
    /\b(?:app\.jsx|app\.tsx|main\.jsx|main\.tsx|package\.json|vite\.config\.[jt]s|index\.html)\b/i.test(contextMessage) &&
    /\b(?:file not found|outside the workspace|entries returned:\s*0|skipped)\b/i.test(contextMessage);
  const parentProbeBlocked = context.includes("outside the workspace") && context.includes("workspace roots:");

  return listedEmptyRoot && (probedMissingStarter || parentProbeBlocked);
}

export function createSimpleLocalTaskCompletionAnswer(completion: SimpleLocalTaskCompletion) {
  return [
    "Done. The Vite React starter app was scaffolded, dependencies installed, the production build passed, and the dev server is running.",
    completion.projectPath ? `Project: ${completion.projectPath}` : "",
    completion.previewUrl ? `Preview: ${completion.previewUrl}` : "",
  ].filter(Boolean).join("\n\n");
}

function toolCallText(toolCall: ChatToolCall) {
  return [
    toolCall.label,
    toolCall.detail,
    toolCall.input,
    toolCall.output,
    toolCall.terminal?.command,
    toolCall.terminal?.workingDirectory,
  ].filter(Boolean).join("\n");
}

function isSuccessfulTerminalToolCall(toolCall: ChatToolCall) {
  const text = toolCallText(toolCall);

  return Boolean(toolCall.terminal) && (toolCall.terminal?.exitCode === 0 || /\bExit code:\s*0\b/i.test(text)) && !/\b(?:failed|error|errored)\b/i.test(text);
}

function isPackageInstallCommand(toolCall: ChatToolCall) {
  const command = `${toolCall.terminal?.command ?? ""}\n${toolCallText(toolCall)}`;

  return /\b(?:npm(?:\.cmd)?\s+(?:install|i)|pnpm\s+install|yarn\s+(?:install|add)|bun\s+install)\b/i.test(command);
}

function isViteBuildCommand(toolCall: ChatToolCall) {
  const command = `${toolCall.terminal?.command ?? ""}\n${toolCallText(toolCall)}`;

  return /\b(?:npm(?:\.cmd)?\s+run\s+build|pnpm\s+(?:run\s+)?build|yarn\s+build|bun\s+run\s+build|vite\s+build)\b/i.test(command);
}

function isDevServerStartedToolCall(toolCall: ChatToolCall) {
  const text = toolCallText(toolCall);
  const command = `${toolCall.terminal?.command ?? ""}\n${text}`;
  const isDevCommand = /\b(?:npm(?:\.cmd)?\s+run\s+(?:dev|start|serve)|pnpm\s+(?:run\s+)?(?:dev|start|serve)|yarn\s+(?:dev|start|serve)|bun\s+run\s+(?:dev|start|serve)|npx\s+vite|vite)\b/i.test(command);
  const hasReadySignal =
    Boolean(toolCall.terminal?.sessionId) ||
    /\b(?:Background session:\s*running|Detected local dev server|Browser preview URL:|Local:\s*https?:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1):\d+)/i.test(text);

  return toolCall.status === "complete" && Boolean(toolCall.terminal) && isDevCommand && hasReadySignal;
}

function findLocalPreviewUrl(text: string) {
  return text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i)?.[0];
}

function findProjectPath(text: string) {
  return text.match(/^Project path:\s*(.+)$/im)?.[1]?.trim();
}

/** Creates a recovery turn that forces the model to answer from completed tool evidence. */
export function createLocalToolFinalInstruction(prompt: string) {
  return [
    "FINAL ANSWER REQUIRED FROM LOCAL TOOL RESULTS",
    `Original user request: ${prompt}`,
    "Use the conversation, attached workspace context, and web context already provided as the evidence for your answer.",
    "Do not reply with a promise to read, inspect, check, analyze, or explore more files.",
    "If more evidence is truly required, ask for it. Otherwise write the final answer now.",
    "Do not describe the tool loop, provider behavior, saved evidence, continuation state, recovery state, or why an answer was missing.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as normal Markdown with headings, bullets, links, and fenced code blocks for code or logs. If you use a pipe table, include a complete GFM delimiter row for every column.",
    "Cite web sources with Markdown links when the tool results include URLs.",
    "Do not output hidden tool protocol text as prose.",
  ].join("\n\n");
}

/** Creates a final-answer instruction when a run reaches its configured tool budget. */
export function createLocalToolBudgetFinalInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED FROM CURRENT TOOL RESULTS",
    `Original user request: ${prompt}`,
    detail,
    "Use the evidence already provided and write the best final answer now.",
    "Start with the answer to the user's request. Do not explain that tools were completed, that a provider failed, that saved evidence exists, or that the response needs continuation.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as normal Markdown with headings, bullets, links, and fenced code blocks for code or logs. If you use a pipe table, include a complete GFM delimiter row for every column.",
    "Do not emit hidden tool protocol text. Do not promise to keep inspecting unless the next step is impossible without user input.",
  ].join("\n\n");
}

/** Creates a final-answer retry when the model exposed app recovery text. */
export function createFinalAnswerRecoveryInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED",
    `Original user request: ${prompt}`,
    detail,
    "Use the conversation context, web context, and local workspace context already provided above.",
    "Write only the user-facing answer now.",
    "Do not mention background work, Activity, Continue response, provider behavior, saved evidence, recovery, retry attempts, tool loops, or missing final write-ups.",
    "Do not paste raw TOOL blocks or adaptation recommendations.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "If the available context is insufficient, say exactly what is missing in one short sentence, then give the best answer possible from the available evidence.",
  ].join("\n\n");
}

/** Creates a continuation instruction after malformed tool-call markup. */
export function createMalformedToolCallRecoveryInstruction(prompt: string) {
  return [
    "CONTINUE AFTER UNREADABLE TOOL REQUEST",
    `Original user request: ${prompt}`,
    "The previous assistant response looked like it was trying to call a tool, but model-callable local tools are disabled.",
    "Continue the same response now with a normal final answer from the existing evidence.",
    "Do not leave the visible answer blank.",
  ].join("\n\n");
}

/** Preserves completed activity and visible text when the user steers an in-flight answer. */
export function createInterruptedResponseContinuationInstruction(prompt: string, message: ChatMessage) {
  const toolCallCount = message.toolCalls?.length ?? 0;
  const visibleContent = message.content.trim();

  return [
    "CONTINUE INTERRUPTED RESPONSE",
    `Original user request: ${prompt}`,
    "Continue from the exact saved state above instead of restarting the task.",
    visibleContent ? "The previous partial visible response is included as assistant context. Do not repeat it unless needed for coherence." : "The previous response was interrupted before visible answer text was saved.",
    toolCallCount > 0 ? `Saved tool/activity results available: ${toolCallCount}. Treat them as already completed evidence.` : "",
    message.webSearch?.enabled ? "Saved web-search state is included above. If it failed, say that briefly and continue with non-current claims only when appropriate." : "",
    "If the next step requires unavailable local tools, say that plainly. Otherwise finish the answer now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Returns true when a saved assistant message should be continued instead of restarted. */
export function isInterruptedAssistantMessage(message: ChatMessage) {
  if (message.role !== "assistant" || message.isStreaming) {
    return false;
  }

  if (isToolResultFallbackAnswer(message.content)) {
    return true;
  }

  if (message.status === "error" || message.agentRunStatus === "failed" || message.agentRunStatus === "running" || message.agentRunStatus === "queued") {
    return true;
  }

  return message.content.includes("I reached the agent tool budget for this run");
}

/** Detects the "tools completed, provider gave no visible answer" case. */
export function shouldSynthesizeEmptyFinalFromToolResults(content: string, toolCalls: ChatToolCall[] = []) {
  return !content.trim() && toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete" && toolCall.status !== "error" && toolCall.status !== "skipped") {
      return false;
    }

    if (toolCall.resultPolicy) {
      return shouldToolCallForceSynthesis(toolCall);
    }

    return true;
  });
}

/** Stamps stable display IDs onto tool activity generated during one execution pass. */
export function stampLocalToolCallIds(toolCalls: ChatToolCall[], passIndex: number) {
  return toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: `local-tool-${passIndex + 1}-${toolCall.id || index + 1}`,
  }));
}

/** Creates optimistic tool activity cards from tool markup before execution completes. */
export function createActiveLocalToolCalls(content: string, passIndex: number, executionPolicy?: LocalComputerToolExecutionPolicy): ChatToolCall[] {
  if (!hasLocalComputerToolCalls(content, executionPolicy)) {
    return [];
  }

  const previews = createLocalComputerToolCallPreviews(content, executionPolicy);

  if (previews.length > 0) {
    return previews.map((toolCall, index) => ({
      ...toolCall,
      id: `local-tool-${passIndex + 1}-local-tool-${index + 1}`,
    }));
  }

  return [
    {
      detail: "Running requested agent tools",
      id: `local-tool-${passIndex + 1}-active`,
      label: "Agent tools",
      status: "active",
    },
  ];
}

/** Uses hidden provider reasoning as tool-request input when thinking contains strict envelopes. */
export function createAssistantToolRequestContent(content: string, reasoning?: string, executionPolicy?: LocalComputerToolExecutionPolicy) {
  return createLocalComputerToolRequestContent(content, reasoning, executionPolicy);
}

/** Merges source lists while preserving first-seen order and avoiding duplicate URLs. */
export function mergeChatSources(existingSources: ChatSource[] | undefined, nextSources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const merged: ChatSource[] = [];

  for (const source of [...(existingSources ?? []), ...nextSources]) {
    if (seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    merged.push(source);
  }

  return merged;
}

/** Replaces any stale web-search progress row with the current search state. */
export function withWebSearchProgress(webSearch: ChatWebSearch | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutWeb = (progress ?? []).filter((item) => item.id !== "web-search");
  const webProgress = createWebSearchProgress(webSearch);
  const nextProgress = webProgress ? [webProgress, ...progressWithoutWeb] : progressWithoutWeb;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

/** Replaces any stale local-tool progress row with the current local-tool state. */
export function withLocalComputerProgress(localProgress: ChatProgressItem | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutLocal = (progress ?? []).filter((item) => item.id !== "local-computer-tools" && item.id !== "local-tools-disabled");
  const nextProgress = localProgress ? [...progressWithoutLocal, localProgress] : progressWithoutLocal;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

/** Converts a persisted web-search state object into a chat progress row. */
export function createWebSearchProgress(webSearch: ChatWebSearch | undefined): ChatProgressItem | null {
  if (!webSearch?.enabled) {
    return null;
  }

  const providerLabel = formatWebSearchProviderLabel(webSearch.provider);
  const resultProviderLabel = webSearch.resultProvider ? formatWebSearchProviderLabel(webSearch.resultProvider) : providerLabel;
  const isError = webSearch.status === "error";
  const isComplete = webSearch.status === "complete" || isError;
  const sourceLabel = webSearch.resultCount === 1 ? "1 source" : `${webSearch.resultCount ?? 0} sources`;
  const detail = isError ? "Search failed; continuing with a note" : isComplete ? (webSearch.resultProvider ? `${sourceLabel} via ${resultProviderLabel} fallback` : sourceLabel) : "Searching the web";

  return {
    detail,
    id: "web-search",
    label: `Search ${providerLabel}`,
    status: isComplete ? "complete" : "active",
  };
}

/** Returns the latest non-empty user prompt for recovery, tools, and web-search context. */
export function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}
