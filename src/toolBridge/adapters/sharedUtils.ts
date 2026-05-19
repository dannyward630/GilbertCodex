// Shared adapter helpers for budgeting model-visible tool output while preserving full tool records.

import type { JsonSchema, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";

const MAX_PROVIDER_TOOL_DESCRIPTION_CHARS = 180;

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  if (remaining === null) {
    return null;
  }
  return Math.max(remaining - rawLength, 0);
}

export function createInlineToolResultMessage(result: ToolResultMessage, remainingChars: number | null) {
  const finalization = finalizeToolResult({
    arguments: result.arguments,
    maxProviderChars: remainingChars,
    result: result.result,
    toolId: result.name,
  });
  const content = [
    "TOOL RESULT EVIDENCE",
    `Tool: ${result.name}`,
    `Call id: ${result.callId}`,
    `Status: ${result.result.ok ? "complete" : "error"}`,
    `Arguments: ${safeInlineJson(result.arguments ?? {})}`,
    "Output:",
    finalization.providerContent,
  ].join("\n");

  return {
    content,
    providerRawCharCount: finalization.providerRawCharCount,
  };
}

export function appendInlineUserToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    const inlineResult = createInlineToolResultMessage(result, remainingToolResultChars);
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, inlineResult.providerRawCharCount);
    messages.push({
      content: inlineResult.content,
      role: "user",
    });
  }

  return messages;
}

export function createProviderVisibleToolSchema(tool: ToolDefinition) {
  return {
    description: compactDescription(tool.description),
    inputSchema: compactInputSchemaForProvider(tool),
    name: tool.id,
  };
}

function compactDescription(value: string) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > MAX_PROVIDER_TOOL_DESCRIPTION_CHARS
    ? `${compacted.slice(0, MAX_PROVIDER_TOOL_DESCRIPTION_CHARS - 1).replace(/\s+\S*$/, "").trim()}...`
    : compacted;
}

function compactInputSchemaForProvider(tool: ToolDefinition): JsonSchema {
  if (tool.id === "files_edit_many") {
    return createCompactFilesEditManySchema();
  }

  if (tool.id === "files_write_many") {
    return createCompactFilesWriteManySchema();
  }

  return stripProviderSchemaNoise(tool.inputSchema) as JsonSchema;
}

function stripProviderSchemaNoise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripProviderSchemaNoise);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "description" || key === "title" || key === "$comment" || key === "examples") {
      continue;
    }
    next[key] = stripProviderSchemaNoise(nestedValue);
  }

  return next;
}

function createCompactFilesEditManySchema(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      dryRun: { type: "boolean" },
      edits: {
        items: {
          additionalProperties: false,
          properties: {
            content: { type: "string" },
            endLine: { minimum: 1, type: "integer" },
            expectedSha256: { type: "string" },
            insertNewlineBeforeContent: { type: "boolean" },
            line: { minimum: 1, type: "integer" },
            newText: { type: "string" },
            oldText: { type: "string" },
            operation: { enum: ["exact_replace", "replace_range", "insert_at_line", "append"], type: "string" },
            path: { minLength: 1, type: "string" },
            replaceAll: { type: "boolean" },
            startLine: { minimum: 1, type: "integer" },
          },
          required: ["path", "operation"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
    },
    required: ["edits"],
    type: "object",
  };
}

function createCompactFilesWriteManySchema(): JsonSchema {
  return {
    additionalProperties: false,
    properties: {
      createParentDirectories: { type: "boolean" },
      dryRun: { type: "boolean" },
      files: {
        items: {
          additionalProperties: false,
          properties: {
            allowOverwrite: { type: "boolean" },
            allowWholeFileReplacement: { type: "boolean" },
            content: { type: "string" },
            createParentDirectories: { type: "boolean" },
            expectedSha256: { type: "string" },
            lineEnding: { enum: ["lf", "crlf", "preserve"], type: "string" },
            path: { minLength: 1, type: "string" },
          },
          required: ["path", "content"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      },
      lineEnding: { enum: ["lf", "crlf", "preserve"], type: "string" },
      overwrite: { type: "boolean" },
    },
    required: ["files"],
    type: "object",
  };
}

function safeInlineJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}
