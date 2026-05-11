import { createPlanningAnswersMessage } from "../services/planningClient";
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
    normalized.length < 180 &&
    /\b(let me|i need to|i'll|i will|now i need to)\b/.test(normalized) &&
    /\b(read|inspect|check|look|analyze|analyse|explore)\b/.test(normalized)
  );
}

/** Creates a recovery turn that forces the model to answer from completed tool evidence. */
export function createLocalToolFinalInstruction(prompt: string) {
  return [
    "FINAL ANSWER REQUIRED FROM LOCAL TOOL RESULTS",
    `Original user request: ${prompt}`,
    "Use the agent tool results already provided as the evidence for your answer.",
    "Do not reply with a promise to read, inspect, check, analyze, or explore more files.",
    "If more evidence is truly required, emit concrete tool calls now. Otherwise write the final answer now.",
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
    "Format the visible answer as normal Markdown with headings, bullets, links, and fenced code blocks for code or logs. If you use a pipe table, include a complete GFM delimiter row for every column.",
    "Do not emit more tool_call XML or JSON. Do not promise to keep inspecting unless the next step is impossible without user input.",
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

  const isError = webSearch.status === "error";
  const isComplete = webSearch.status === "complete" || isError;
  const sourceLabel = webSearch.resultCount === 1 ? "1 source" : `${webSearch.resultCount ?? 0} sources`;

  return {
    detail: isError ? "Search failed; continuing with a note" : isComplete ? sourceLabel : "Searching the web",
    id: "web-search",
    label: "Search DuckDuckGo",
    status: isComplete ? "complete" : "active",
  };
}

/** Returns the latest non-empty user prompt for recovery, tools, and web-search context. */
export function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}
