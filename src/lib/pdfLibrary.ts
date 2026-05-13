import { loadPdfLibraryState, savePdfLibraryState } from "./appStorage";
import { createMessage, normalizeProjectName } from "./chatUtils";
import type { ChatArtifact, ChatFileAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { PdfLibraryRecord, PdfLibraryState } from "../types/pdfLibrary";

const PDF_CONTEXT_RECORD_LIMIT: number | null = null;

export function isPdfDataUrl(value?: string) {
  return typeof value === "string" && value.startsWith("data:application/pdf");
}

export function syncPdfLibraryFromChats(chats: ChatSummary[]) {
  const state = loadPdfLibraryState();
  const discoveredRecords = collectPdfLibraryRecordsFromChats(chats).filter((record) => !record.sourceId || !state.deletedSourceIds.includes(record.sourceId));

  if (discoveredRecords.length === 0) {
    return;
  }

  const nextState: PdfLibraryState = {
    ...state,
    records: [...state.records],
  };
  let changed = false;

  for (const record of discoveredRecords) {
    const existingIndex = nextState.records.findIndex((candidate) => candidate.sourceId && candidate.sourceId === record.sourceId);

    if (existingIndex < 0) {
      nextState.records.push(record);
      changed = true;
      continue;
    }

    const existing = nextState.records[existingIndex];
    const merged: PdfLibraryRecord = {
      ...existing,
      dataUrl: existing.dataUrl ?? record.dataUrl,
      fileName: record.fileName || existing.fileName,
      mimeType: record.mimeType || existing.mimeType,
      sizeBytes: record.sizeBytes || existing.sizeBytes,
      sourceFormat: existing.sourceFormat ?? record.sourceFormat,
      sourceText: existing.sourceText ?? record.sourceText,
      title: record.title || existing.title,
      updatedAt: existing.updatedAt || record.updatedAt,
    };

    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      nextState.records[existingIndex] = merged;
      changed = true;
    }
  }

  if (changed) {
    savePdfLibraryState(nextState);
  }
}

export function createPdfLibraryContextMessages(projectName: string): ChatMessage[] {
  const state = loadPdfLibraryState();
  const project = normalizeProjectName(projectName);
  const projectInstruction = state.projectInstructions[project]?.markdown.trim();
  const enabledRecords = state.records
    .filter((record) => record.enabledAsContext && normalizeProjectName(record.project) === project)
    .slice(0, PDF_CONTEXT_RECORD_LIMIT ?? undefined);

  if (!projectInstruction && enabledRecords.length === 0) {
    return [];
  }

  const lines = [
    "PDF LIBRARY CONTEXT",
    `Project: ${project}`,
    projectInstruction ? "\nProject PDF instructions:\n" + projectInstruction : "",
    enabledRecords.length > 0 ? "\nEnabled PDFs:" : "",
    ...enabledRecords.flatMap((record, index) => {
      const sourceText = record.sourceText?.trim();
      return [
        `${index + 1}. ${record.title}`,
        `   ID: ${record.id}`,
        `   Origin: ${record.origin}`,
        record.guidanceMarkdown?.trim() ? `   Guidance: ${record.guidanceMarkdown.trim()}` : "",
        sourceText ? `   Editable/source text:\n${truncatePdfContextText(sourceText)}` : "   Editable/source text: not available for this PDF yet.",
      ].filter(Boolean);
    }),
    "",
    "Use this context only for the active project. For PDF edits, prefer exact source-backed edits and say when a PDF has no editable source text.",
  ].filter(Boolean);

  return [createMessage("user", lines.join("\n"))];
}

function collectPdfLibraryRecordsFromChats(chats: ChatSummary[]): PdfLibraryRecord[] {
  return chats.flatMap((chat) =>
    chat.messages.flatMap((message) => [
      ...collectPdfAttachmentRecords(chat, message),
      ...collectPdfArtifactRecords(chat, message),
    ]),
  );
}

function collectPdfAttachmentRecords(chat: ChatSummary, message: ChatMessage): PdfLibraryRecord[] {
  return (message.attachments ?? []).flatMap((attachment) => {
    if (attachment.kind !== "file" || !isPdfFileAttachment(attachment)) {
      return [];
    }

    const sourceId = `chat:${chat.id}:message:${message.id}:attachment:${attachment.id}`;
    const createdAt = attachment.createdAt || message.createdAt || chat.updatedAt || new Date().toISOString();
    const title = attachment.name || "Uploaded PDF";

    return [
      {
        chatId: chat.id,
        createdAt,
        dataUrl: isPdfDataUrl(attachment.dataUrl) ? attachment.dataUrl : undefined,
        enabledAsContext: false,
        fileName: title,
        id: `pdf-${hashStableText(sourceId)}`,
        messageId: message.id,
        mimeType: "application/pdf",
        origin: "upload",
        project: normalizeProjectName(chat.project),
        sizeBytes: attachment.size,
        sourceFormat: attachment.text ? "text" : undefined,
        sourceId,
        sourceText: attachment.text,
        title,
        updatedAt: createdAt,
      },
    ];
  });
}

function collectPdfArtifactRecords(chat: ChatSummary, message: ChatMessage): PdfLibraryRecord[] {
  return (message.artifacts ?? []).flatMap((artifact) => {
    if (!isPdfArtifact(artifact)) {
      return [];
    }

    const sourceId = `chat:${chat.id}:message:${message.id}:artifact:${artifact.id ?? artifact.title}`;
    const createdAt = message.createdAt || chat.updatedAt || new Date().toISOString();
    const title = artifact.title || "Generated PDF";

    return [
      {
        chatId: chat.id,
        createdAt,
        dataUrl: isPdfDataUrl(artifact.url) ? artifact.url : undefined,
        enabledAsContext: false,
        fileName: title,
        id: `pdf-${hashStableText(sourceId)}`,
        messageId: message.id,
        mimeType: "application/pdf",
        origin: "ai",
        project: normalizeProjectName(chat.project),
        sizeBytes: artifact.sizeBytes ?? 0,
        sourceFormat: artifact.sourceFormat,
        sourceId,
        sourceText: artifact.sourceText,
        title,
        updatedAt: createdAt,
      },
    ];
  });
}

function isPdfFileAttachment(attachment: ChatFileAttachment) {
  return attachment.mimeType === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf") || isPdfDataUrl(attachment.dataUrl);
}

function isPdfArtifact(artifact: ChatArtifact) {
  return artifact.mimeType === "application/pdf" || artifact.title.toLowerCase().endsWith(".pdf") || isPdfDataUrl(artifact.url);
}

function truncatePdfContextText(value: string) {
  return value;
}

function hashStableText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
