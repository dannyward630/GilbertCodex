import type { ChatArtifact, ChatAttachment, ChatMessage, ChatProgressItem, ChatSummary, ChatToolCall } from "../types/chat";
import { normalizeProjectName } from "./chatUtils";

export function contentReferencesChatTitle(content: string, title: string) {
  const cleanTitle = title.trim();

  if (!cleanTitle || cleanTitle.toLowerCase() === "new chat") {
    return false;
  }

  const escapedTitle = escapeRegExp(cleanTitle).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)#${escapedTitle}(?=$|[\\s.,;:!?\\)])`, "i").test(content);
}

export function createChatResearchContextContent(chats: ChatSummary[]) {
  return [
    "CHAT RESEARCH NOTES",
    "The user attached these prior regular chats with # for this response only. Treat them as research notes, not as the active project or active conversation unless the user explicitly asks to move work there.",
    ...chats.map(formatChatResearchContext),
  ].join("\n\n");
}

export function formatChatResearchContext(chat: ChatSummary) {
  const messages = chat.messages.map(formatChatResearchMessage).filter(Boolean);

  return [
    `## ${chat.title || "Untitled chat"}`,
    `Chat ID: ${chat.id}`,
    `Project: ${normalizeProjectName(chat.project)}`,
    `Updated: ${chat.updatedAt}`,
    messages.length > 0 ? messages.join("\n\n") : "No visible chat messages were available.",
  ].join("\n");
}

export function formatChatResearchMessage(message: ChatMessage, index: number) {
  const sections: string[] = [];
  const content = message.content.trim();

  if (content) {
    sections.push(content);
  }

  if (message.attachments?.length) {
    sections.push(formatAttachments(message.attachments));
  }

  if (message.webSearch) {
    sections.push(formatWebSearch(message.webSearch));
  }

  if (message.sources?.length) {
    sections.push(formatSources(message.sources));
  }

  if (message.artifacts?.length) {
    sections.push(formatArtifacts(message.artifacts));
  }

  const toolCalls = collectMessageToolCalls(message);

  if (toolCalls.length > 0) {
    sections.push(`Tool calls:\n${toolCalls.map(formatToolCall).join("\n")}`);
  }

  const progressItems = getResearchVisibleProgressItems(message.progress);

  if (progressItems.length) {
    sections.push(formatProgressItems("Progress", progressItems));
  }

  const workTraceNotes = formatWorkTraceProgress(message);

  if (workTraceNotes) {
    sections.push(workTraceNotes);
  }

  if (message.planning) {
    sections.push(formatPlanning(message));
  }

  if (sections.length === 0) {
    return "";
  }

  const timestamp = message.createdAt ? ` (${message.createdAt})` : "";
  return [`### ${message.role === "assistant" ? "Assistant" : "User"} ${index + 1}${timestamp}`, sections.join("\n")].join("\n");
}

function formatAttachments(attachments: ChatAttachment[]) {
  return [
    "Attachments:",
    ...attachments.map((attachment) => {
      const base = `- ${attachment.name} (${attachment.kind}, ${attachment.mimeType}, ${attachment.size} bytes)`;

      if (attachment.kind === "file" && attachment.text?.trim()) {
        return `${base}\n  Text:\n${indentBlock(attachment.text.trim(), "  ")}`;
      }

      return base;
    }),
  ].join("\n");
}

function formatWebSearch(webSearch: NonNullable<ChatMessage["webSearch"]>) {
  const lines = [
    "Web search:",
    `- Provider: ${webSearch.resultProvider || webSearch.provider}`,
    `- Status: ${webSearch.status || "unknown"}`,
  ];

  if (webSearch.query) {
    lines.push(`- Query: ${webSearch.query}`);
  }

  if (typeof webSearch.resultCount === "number") {
    lines.push(`- Results: ${webSearch.resultCount}`);
  }

  if (webSearch.fallbackReason) {
    lines.push(`- Fallback: ${webSearch.fallbackReason}`);
  }

  if (webSearch.error) {
    lines.push(`- Error: ${webSearch.error}`);
  }

  return lines.join("\n");
}

function formatSources(sources: NonNullable<ChatMessage["sources"]>) {
  return [
    "Sources:",
    ...sources.map((source) => {
      const detail = source.detail ? ` - ${source.detail}` : "";
      return `- ${source.title || source.url}: ${source.url}${detail}`;
    }),
  ].join("\n");
}

function formatArtifacts(artifacts: ChatArtifact[]) {
  return [
    "Artifacts:",
    ...artifacts.map((artifact) => {
      const lines = [`- ${artifact.title}${artifact.kind ? ` (${artifact.kind})` : ""}`];

      if (artifact.url) {
        lines.push(`  URL: ${artifact.url}`);
      }

      if (artifact.detail) {
        lines.push(`  Detail: ${artifact.detail}`);
      }

      if (artifact.sourceText?.trim()) {
        lines.push(`  Source text:\n${indentBlock(artifact.sourceText.trim(), "  ")}`);
      }

      return lines.join("\n");
    }),
  ].join("\n");
}

function collectMessageToolCalls(message: ChatMessage) {
  const toolCalls = new Map<string, ChatToolCall>();

  for (const toolCall of message.toolCalls ?? []) {
    toolCalls.set(toolCall.id, toolCall);
  }

  for (const item of message.workTrace ?? []) {
    if (item.kind === "tool") {
      toolCalls.set(item.toolCall.id, item.toolCall);
    }
  }

  return [...toolCalls.values()];
}

function formatToolCall(toolCall: ChatToolCall) {
  const lines = [`- ${toolCall.label}${toolCall.toolId ? ` (${toolCall.toolId})` : ""} [${toolCall.status}]`];

  if (toolCall.detail) {
    lines.push(`  Detail: ${toolCall.detail}`);
  }

  if (toolCall.input?.trim()) {
    lines.push(`  Input:\n${indentBlock(toolCall.input.trim(), "  ")}`);
  }

  if (toolCall.output?.trim()) {
    lines.push(`  Output:\n${indentBlock(toolCall.output.trim(), "  ")}`);
  }

  if (toolCall.terminal) {
    const terminal = toolCall.terminal;
    lines.push("  Terminal:");

    if (terminal.command) {
      lines.push(`    Command: ${terminal.command}`);
    }

    if (terminal.workingDirectory) {
      lines.push(`    Working directory: ${terminal.workingDirectory}`);
    }

    if (typeof terminal.exitCode !== "undefined") {
      lines.push(`    Exit code: ${terminal.exitCode}`);
    }
  }

  if (toolCall.fileChanges?.length) {
    lines.push("  File changes:");
    lines.push(...toolCall.fileChanges.map((change) => `    - ${change.kind || "update"} ${change.path} (+${change.additions} -${change.deletions})`));
  }

  if (toolCall.batchSummary) {
    const summary = toolCall.batchSummary;
    lines.push(`  Batch: ${summary.operation} ${summary.successCount}/${summary.requestedCount} succeeded, ${summary.failureCount} failed, ${summary.skippedCount} skipped`);
  }

  if (toolCall.batchFileResults?.length) {
    lines.push("  Batch files:");
    lines.push(...toolCall.batchFileResults.map((result) => `    - ${result.status} ${result.path}${result.detail ? ` - ${result.detail}` : ""}`));
  }

  return lines.join("\n");
}

function formatProgressItems(label: string, progressItems: ChatProgressItem[]) {
  return [
    `${label}:`,
    ...progressItems.map((item) => `- ${item.label} [${item.status}]${item.detail ? ` - ${item.detail}` : ""}`),
  ].join("\n");
}

function getResearchVisibleProgressItems(progressItems: ChatProgressItem[] | undefined) {
  return (progressItems ?? []).filter((item) => item.id !== "context-compaction");
}

function formatWorkTraceProgress(message: ChatMessage) {
  const progressItems = getResearchVisibleProgressItems(message.workTrace?.filter((item) => item.kind === "progress").map((item) => item.progress));

  return progressItems.length > 0 ? formatProgressItems("Work trace progress", progressItems) : "";
}

function formatPlanning(message: ChatMessage) {
  const planning = message.planning;

  if (!planning) {
    return "";
  }

  const lines = ["Planning:", `- Passes: ${planning.passCount}/${planning.maxPasses}`];
  const inputRequests = planning.inputRequests ?? (planning.inputRequest ? [planning.inputRequest] : []);

  for (const request of inputRequests) {
    lines.push(`- Input request: ${request.title}`);

    for (const answer of request.answers ?? []) {
      lines.push(`  - ${answer.questionId}: ${answer.value || answer.optionId || ""}`);
    }
  }

  return lines.join("\n");
}

function indentBlock(value: string, prefix: string) {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
