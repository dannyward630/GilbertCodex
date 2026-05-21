import type { ToolBridgeToolFamily, ToolCallRequest } from "../../../toolBridge";

export function formatApprovalRevisionOriginalCalls(calls: ToolCallRequest[]) {
  return JSON.stringify(calls.map((call) => ({
    arguments: call.arguments,
    name: call.name,
  })), null, 2);
}

export function createPlainTextRevisionBridgeCalls(
  calls: ToolCallRequest[],
  assistantContent: string,
  resolveFamily: (call: ToolCallRequest) => ToolBridgeToolFamily | undefined,
): ToolCallRequest[] {
  return calls.map((call) => {
    const family = resolveFamily(call);

    if (family === "gmail") {
      return reviseGmailBridgeCallFromPlainText(call, assistantContent);
    }

    return call;
  });
}

export function reviseGmailBridgeCallFromPlainText(call: ToolCallRequest, assistantContent: string): ToolCallRequest {
  const args = recordFromUnknown(call.arguments);
  const parsed = parsePlainTextEmailRevision(assistantContent);

  return {
    ...call,
    arguments: removeUndefinedFields({
      ...args,
      ...(parsed?.to.length ? { to: parsed.to } : {}),
      ...(parsed?.subject ? { subject: parsed.subject } : {}),
      ...(parsed?.body ? { body: parsed.body } : {}),
      inReplyTo: cleanOptionalEmailMetadata(args.inReplyTo),
      references: cleanOptionalEmailMetadata(args.references),
      threadId: cleanOptionalEmailMetadata(args.threadId),
    }),
  };
}

export function parsePlainTextEmailRevision(value: string) {
  const text = value.replace(/\r\n/g, "\n").trim();
  const to = parseEmailRevisionRecipients(readLabeledValue(text, "To"));
  const subject = readLabeledValue(text, "Subject");
  const body = readLabeledBlock(text, "Body");

  if (to.length === 0 && !subject && !body) {
    return null;
  }

  return {
    body: body ? cleanRevisedEmailBody(body) : undefined,
    subject: subject ? stripMarkdownFormatting(subject) : undefined,
    to,
  };
}

function readLabeledValue(text: string, label: string) {
  const match = text.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim();
}

function readLabeledBlock(text: string, label: string) {
  const match = text.match(new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*\\n?([\\s\\S]*)$`, "im"));

  if (!match?.[1]) {
    return undefined;
  }

  return match[1]
    .replace(/\n\s*(?:Reply|Respond|Please confirm|Tell me|Say ["']?send|Press send)\b[\s\S]*$/i, "")
    .trim();
}

function parseEmailRevisionRecipients(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .split(/[,;]/)
    .map((item) => item.trim())
    .flatMap((item) => {
      const match = item.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return match ? [match[0]] : [];
    });
}

function cleanRevisedEmailBody(value: string) {
  return value
    .replace(/^\s*```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function stripMarkdownFormatting(value: string) {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .trim();
}

function cleanOptionalEmailMetadata(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === "-" || normalized === "--" || normalized === "n/a" || normalized === "none" || normalized === "null" || normalized === "undefined") {
    return undefined;
  }

  return value.trim();
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function removeUndefinedFields(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
