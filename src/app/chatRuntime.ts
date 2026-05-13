import { createPlanningAnswersMessage } from "../services/planningClient";
import { formatWebSearchProviderLabel } from "../services/webSearchClient";
import { createLocalComputerToolCallPreviews, hasLocalComputerToolCalls } from "../tools/computer/localToolExecutor";
import type { LocalComputerToolExecutionPolicy } from "../tools/computer/localToolExecutor";
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
export {
  createRecoverableLocalEditRetryInstruction,
  isRecoverableLocalEditFailure,
} from "./toolRecovery";

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
  const normalized = content.trim().toLowerCase();

  if (!normalized || normalized.length > 1_800) {
    return false;
  }

  return (
    /\b(?:i'll|i will|i am going to|i'm going to|let me|let's|so i'll|now i'll|now i will|i need to|we need to)\b[\s\S]{0,220}\b(?:create|write|edit|patch|update|generate|scaffold|add)\b[\s\S]{0,180}\b(?:files?|app\.jsx|app\.tsx|styles?\.css|main\.jsx|main\.tsx|index\.html|package\.json|vite|react|component|ui|animation|theme|dark\/light|dark mode|light mode)\b/.test(normalized) ||
    /\b(?:create|write|edit|patch|update|generate|scaffold|add)\b[\s\S]{0,180}\b(?:app\.jsx|app\.tsx|styles?\.css|main\.jsx|main\.tsx|index\.html|package\.json|vite|react|component|ui|animation|theme|dark\/light|dark mode|light mode)\b[\s\S]{0,180}\b(?:now|next|let me|i'll|i will|i need to|we need to)\b/.test(normalized) ||
    /\b(?:i'll|i will|i am going to|i'm going to|let me|so i'll|now i'll)\b[\s\S]{0,180}\b(?:open|launch|pull up|navigate|show|preview)\b[\s\S]{0,140}\b(?:browser|preview|localhost|local host|dev server|site|page|url)\b/.test(normalized) ||
    /\b(?:dev server|localhost|local host)\b[\s\S]{0,140}\b(?:already running|running from|background terminal|terminal session)\b[\s\S]{0,180}\b(?:open|browser|preview)\b/.test(normalized) ||
    /\b(?:let's|we need to|we should|we'll|we will|i'll|i will|i need to|now i'll|now i will)\b[\s\S]{0,220}\b(?:use|call|run|retry|try|emit)\b[\s\S]{0,120}\b(?:create_files|write_file|edit_file|view_code|read_file|open_browser_preview|tool_call)\b/.test(normalized) ||
    /\b(?:let me|i'll|i will|we'll|we will|now i'll|now i will)\b[\s\S]{0,180}\b(?:write|apply|batch)\b[\s\S]{0,140}\b(?:file changes|independent writes|writes|files?)\b/.test(normalized) ||
    /\b(?:the problem|problem:|failed|wasn't|was not|did not|never)\b[\s\S]{0,260}\b(?:edit|replace|wire|change|open|preview|button|handler)\b[\s\S]{0,260}\b(?:let's|we need to|we should|we'll|we will|i'll|i will)\b[\s\S]{0,180}\b(?:edit_file|open_browser_preview|tool_call|make the replacement|make this replacement|open the browser)\b/.test(normalized)
  );
}

/** Detects visible explanations of the hidden tool protocol instead of real tool use. */
export function looksLikeToolProtocolNarration(content: string) {
  const normalized = content.trim().toLowerCase();

  if (!normalized || normalized.length > 6_000) {
    return false;
  }

  const mentionsToolProtocol =
    /\b(?:tool_call|arg_key|arg_value|xml style|xml-style|tool block|tool format|formatted tool|tool call)\b/.test(normalized);
  const narratesConstruction =
    /\b(?:craft|format|produce|emit|write|construct|create|output|use)\b[\s\S]{0,180}\b(?:tool_call|tool call|arg_key|arg_value|xml)\b/.test(normalized) ||
    /\b(?:expected format|correctly formatted|formatted correctly|the spec says|the app(?:'s)? expected format|we follow that|we'll produce|we will produce)\b[\s\S]{0,220}\b(?:tool_call|tool call|arg_key|arg_value|xml)\b/.test(normalized);
  const exposesExecutionDebate =
    /\b(?:we can|we could|should we|better to|alternatively|actually)\b[\s\S]{0,260}\b(?:run_terminal|read_file|write_file|open_browser_preview|create_vite_project|tool call|tool_call|batching|concurrent|one after another|separate messages)\b/.test(normalized);

  return mentionsToolProtocol && (narratesConstruction || exposesExecutionDebate);
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
    /\b(summary|recap|overview)\b[\s\S]{0,120}\b(tool calls?|tools? (?:i|we|the app|it) (?:ran|used|called|executed)|terminal|git)\b/.test(normalized) ||
    /\b(i|we|the app)\b[\s\S]{0,80}\b(ran|used|called|executed|completed)\b[\s\S]{0,80}\b(tool calls?|tools?|terminal|git)\b/.test(normalized) ||
    /\b(tool calls?|tools?|terminal|git)\b[\s\S]{0,100}\b(completed|executed|ran successfully|returned|produced)\b/.test(normalized) ||
    /\b(provider|app)\b[\s\S]{0,160}\b(visible answer|tool results?|completed tool|saved evidence)\b/.test(normalized) ||
    /\b(original request|what ran|evidence)\b[\s\S]{0,240}\b(executed|completed|tool call)\b/.test(normalized)
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
    "If the user's request requires tools, emit valid compact tool_call blocks now so the app can execute them and create real activity records. If no tool is needed, answer from available evidence without claiming any tool ran.",
    excerpt ? `Rejected fake activity excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant promised a tool action but emitted no tool call. */
export function createToolActionPromiseRecoveryInstruction(prompt: string, promisedContent: string) {
  const excerpt = promisedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL ACTION REQUIRED",
    `Original user request: ${prompt}`,
    "The previous visible answer promised to open, preview, navigate, inspect, or otherwise use a tool, but no executable tool call was emitted.",
    "Do not repeat the promise. Emit the real tool_call now.",
    "For file creation requests, call create_files for multi-file batches or write_file for one file. If the project is a new Vite React app, call create_vite_project.",
    "After creating or editing files, re-read the changed files or list the created folder, then run the relevant verification command.",
    "For browser preview requests, call open_browser_preview. If a background dev server is already tracked, open_browser_preview may be called without a URL so the app can reuse that session; otherwise pass the exact url, bare localhost address, or query.",
    "For source-edit requests, call view_code/read_file if the current target text is uncertain, then call edit_file/inline_edit with exact current text or a line-range edit. Do not end with 'Let's use edit_file' as prose.",
    "Only answer in prose if the tool is disabled or blocked, and then say that blocker plainly.",
    excerpt ? `Rejected promise excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Creates a retry turn when the assistant exposed how to call tools instead of using them. */
export function createToolProtocolNarrationRecoveryInstruction(prompt: string, narratedContent: string) {
  const excerpt = narratedContent.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "TOOL PROTOCOL NARRATION REJECTED",
    `Original user request: ${prompt}`,
    "The previous visible response discussed how to format, batch, or emit tool calls instead of using the app tools.",
    "Do not explain the hidden tool protocol, do not mention XML, arg_key, arg_value, batching mechanics, cwd choices, shell choices, timeout choices, or step-by-step tool formatting.",
    "If a tool is needed, call it now. Prefer native tool calling when the provider supports it; otherwise emit only the compact tool_call block with complete arguments and no surrounding prose.",
    "If no tool is needed, answer normally in user-facing Markdown.",
    excerpt ? `Rejected protocol narration excerpt: ${excerpt}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Detects local build/edit/project requests that should not be answered without fresh tools. */
export function needsFreshLocalToolEvidence(prompt: string, hasWorkspaceRoots: boolean) {
  if (!hasWorkspaceRoots) {
    return false;
  }

  const normalized = prompt.toLowerCase();
  const asksForLocalAction =
    /\b(?:add|build|change|create|debug|edit|fix|generate|implement|install|launch|make|modify|patch|preview|read|rebuild|repair|run|scaffold|set\s*up|setup|start|test|update|verify|write)\b/i.test(normalized);
  const mentionsLocalTarget =
    /\b(?:app|build|code|component|css|dev\s*server|file|folder|package\.json|project|react|src|terminal|typecheck|vite|workspace)\b/i.test(normalized) ||
    /(?:[a-z]:\\|\/src\/|\\src\\|\.\w{1,8}\b)/i.test(prompt);

  return asksForLocalAction && mentionsLocalTarget;
}

export function createFreshLocalToolEvidenceInstruction(prompt: string, unsupportedAnswer: string) {
  const excerpt = unsupportedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "FRESH LOCAL TOOL EVIDENCE REQUIRED",
    `Original user request: ${prompt}`,
    "The previous response answered a local coding/project task without using executable local tools. That is not reliable enough.",
    "Do not rely on workspace context, index snippets, project memory, or prior chat memory as proof that the filesystem is correct.",
    "Use the available tools now. For existing work: search/list if needed, read_file or view_code the exact files before editing, perform one precise edit/write/create action, then re-read changed files and run the relevant verification command.",
    "For a new Vite React app, use create_vite_project first. If the user already selected/opened the target project folder, omit project_path so files are created directly in that folder. Then run npm install, npm run build, and npm run dev with cwd set to the returned project path.",
    "Simple scaffold stop rule: if the request is only to create/install/build/run a Hello World or starter Vite React app, do not redesign, restyle, or keep editing after scaffold, install, build, and dev-server startup have succeeded. Finalize from that evidence.",
    "If the selected workspace folder is empty, that is the target project. Scaffold there; do not inspect or retry the parent directory.",
    "If no workspace or path is available, ask for the folder instead of pretending work was done.",
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
  const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const asksForScaffold = /\b(?:build|create|generate|make|scaffold|set\s*up|setup)\b/.test(normalized);
  const mentionsReact = /\breact\b/.test(normalized);
  const mentionsViteOrStarter = /\b(?:vite|vight|fight)\b/.test(normalized) || /\b(?:hello\s*world|starter|basic|simple|first\s+task)\b/.test(normalized);
  const asksForRunEvidence = /\b(?:install|dependencies?|npm\s+install|build|run|start|serve|dev\s*server|launch)\b/.test(normalized);
  const asksForDesignWork = /\b(?:animate|animation|beautiful|dashboard|database|full[-\s]?stack|game|high\s+quality|landing\s+page|perfect|polish|premium|production|redesign|responsive|stunning|tailwind|theme|three\.?js)\b/.test(normalized);

  return asksForScaffold && mentionsReact && mentionsViteOrStarter && asksForRunEvidence && !asksForDesignWork;
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
    "Use the agent tool results already provided as the evidence for your answer.",
    "Do not reply with a promise to read, inspect, check, analyze, or explore more files.",
    "If more evidence is truly required, emit concrete tool calls now. Otherwise write the final answer now.",
    "Do not describe the tool loop, provider behavior, saved evidence, continuation state, recovery state, or why an answer was missing.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as normal Markdown with headings, bullets, links, and fenced code blocks for code or logs. If you use a pipe table, include a complete GFM delimiter row for every column.",
    "Cite web sources with Markdown links when the tool results include URLs.",
    "Do not output raw tool_call XML or JSON as prose.",
  ].join("\n\n");
}

/** Creates a final-answer instruction when a run reaches its configured tool budget. */
export function createLocalToolBudgetFinalInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED FROM CURRENT TOOL RESULTS",
    `Original user request: ${prompt}`,
    detail,
    "Use the tool results already provided as evidence and write the best final answer now.",
    "Start with the answer to the user's request. Do not explain that tools were completed, that a provider failed, that saved evidence exists, or that the response needs continuation.",
    "Do not use headings such as Answer From Completed Tool Results, Tool Run Needs Continuation, Original Request, What Ran, or Evidence.",
    "Format the visible answer as normal Markdown with headings, bullets, links, and fenced code blocks for code or logs. If you use a pipe table, include a complete GFM delimiter row for every column.",
    "Do not emit more tool_call XML or JSON. Do not promise to keep inspecting unless the next step is impossible without user input.",
  ].join("\n\n");
}

/** Creates a final-answer retry when the model exposed app recovery text. */
export function createFinalAnswerRecoveryInstruction(prompt: string, detail: string) {
  return [
    "FINAL ANSWER REQUIRED",
    `Original user request: ${prompt}`,
    detail,
    "Use the conversation context, web context, local workspace context, and completed tool evidence already provided above.",
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
    "The previous assistant response looked like it was trying to call a tool, but the app could not parse an executable tool request from it.",
    "Continue the same response now. Either write a normal final answer from the existing evidence, or emit one valid compact tool_call block with complete arguments.",
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
    "If the next step requires another available tool, request it. Otherwise finish the answer now.",
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
  const progressWithoutLocal = (progress ?? []).filter((item) => item.id !== "local-computer-tools");
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
