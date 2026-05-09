import { createPlanningAnswersMessage } from "../services/planningClient";
import { createLocalComputerToolCallPreviews, hasLocalComputerToolCalls } from "../tools/computer/localToolExecutor";
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

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

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

export function looksLikeOnlyToolPrelude(content: string) {
  const normalized = content.trim().toLowerCase();

  return (
    normalized.length < 180 &&
    /\b(let me|i need to|i'll|i will|now i need to)\b/.test(normalized) &&
    /\b(read|inspect|check|look|analyze|analyse|explore)\b/.test(normalized)
  );
}

export function createLocalToolFinalInstruction(prompt: string) {
  return [
    "FINAL ANSWER REQUIRED FROM LOCAL TOOL RESULTS",
    `Original user request: ${prompt}`,
    "Use the agent tool results already provided as the evidence for your answer.",
    "Do not reply with a promise to read, inspect, check, analyze, or explore more files.",
    "If more evidence is truly required, emit concrete tool calls now. Otherwise write the final answer now.",
    "Cite web sources with Markdown links when the tool results include URLs.",
    "Do not output raw tool_call XML or JSON as prose.",
  ].join("\n\n");
}

export function stampLocalToolCallIds(toolCalls: ChatToolCall[], passIndex: number) {
  return toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: `local-tool-${passIndex + 1}-${toolCall.id || index + 1}`,
  }));
}

export function createActiveLocalToolCalls(content: string, passIndex: number): ChatToolCall[] {
  if (!hasLocalComputerToolCalls(content)) {
    return [];
  }

  const previews = createLocalComputerToolCallPreviews(content);

  if (previews.length > 0) {
    return previews.map((toolCall, index) => ({
      ...toolCall,
      id: `local-tool-${passIndex + 1}-active-${index + 1}`,
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

export function withWebSearchProgress(webSearch: ChatWebSearch | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutWeb = (progress ?? []).filter((item) => item.id !== "web-search");
  const webProgress = createWebSearchProgress(webSearch);
  const nextProgress = webProgress ? [webProgress, ...progressWithoutWeb] : progressWithoutWeb;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

export function withLocalComputerProgress(localProgress: ChatProgressItem | undefined, progress: ChatProgressItem[] | undefined) {
  const progressWithoutLocal = (progress ?? []).filter((item) => item.id !== "local-computer-tools");
  const nextProgress = localProgress ? [...progressWithoutLocal, localProgress] : progressWithoutLocal;

  return nextProgress.length > 0 ? nextProgress : undefined;
}

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

export function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}
