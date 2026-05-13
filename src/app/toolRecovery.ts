export interface RecoverableToolFailureContext {
  callNumber?: number;
  output?: string;
  recoverable?: boolean;
  recoveryKind?: string;
  retryInstruction?: string;
  tool?: string;
}

interface RecoverableToolCallLike {
  detail?: string;
  input?: string;
  label: string;
  output?: string;
  status: string;
}

const NON_RECOVERABLE_ACCESS_RE =
  /\b(?:blocked by read-only|denied by user|approval denied|permission denied|no workspace roots?|outside the workspace|outside the enabled workspace|workspace roots?:\s*none)\b/i;

const RECOVERABLE_EDIT_RE =
  /\b(?:old_text|old_string|old_str|new_text|new_string|new_str|expected_text|expected content|expected_sha256|replace_entire_file|create-only|full-file replacement|missing required argument|requires both path and content|malformed|incomplete|corrected args?|could not find|did not match|whitespace|ambiguous|occurrence|match(?:es)?|start_line|end_line|insert_at_line|insert_line|start_char|end_char|line range|character range|out of range|syntax|pre-write syntax check|missing \d+ closing|unterminated string|quality warnings|suspicious css|partially loaded|empty|source\/text files through the shell|use view_code plus edit_file|write_file cannot safely replace|re-read the file before retrying)\b/i;

const RECOVERABLE_CONTEXT_RE = /\bRECOVERABLE_TOOL_FAILURE\b[\s\S]{0,500}\brecoverable:\s*true\b/i;

function isMutationToolLabel(label: string, output: string) {
  const normalizedLabel = label.toLowerCase();
  const normalizedOutput = output.toLowerCase();

  return (
    normalizedLabel.includes("edit file") ||
    normalizedLabel.includes("inline edit") ||
    normalizedLabel.includes("search/replace") ||
    normalizedLabel.includes("write file") ||
    normalizedLabel.includes("create file") ||
    normalizedLabel.includes("create files") ||
    normalizedLabel.includes("create react") ||
    normalizedLabel.includes("create code") ||
    normalizedLabel.includes("create vite") ||
    (normalizedLabel.includes("terminal") &&
      normalizedOutput.includes("source/text files through the shell") &&
      normalizedOutput.includes("use view_code plus edit_file"))
  );
}

function isNonRecoverableAccessBlock(detail: string) {
  return NON_RECOVERABLE_ACCESS_RE.test(detail);
}

function extractFirstFailedToolSection(contextMessage: string) {
  const match = contextMessage.match(/\n?TOOL\s+\d+\s+\[(?:skipped|error)\]:[^\n]*(?:\n[\s\S]*?)(?=\nTOOL\s+\d+(?:\s+\[[^\]]+\])?:|\nAUTO SYNTAX CHECK\b|$)/i);

  if (!match) {
    return "";
  }

  return match[0].trim().slice(0, 1_600);
}

export function isRecoverableLocalEditFailure(
  contextMessage: string,
  toolCalls: RecoverableToolCallLike[] = [],
  recoverableFailure?: RecoverableToolFailureContext,
) {
  if (recoverableFailure?.recoverable) {
    return true;
  }

  if (RECOVERABLE_CONTEXT_RE.test(contextMessage) && !isNonRecoverableAccessBlock(contextMessage)) {
    return true;
  }

  const latestEditToolCall = [...toolCalls].reverse().find((toolCall) => {
    const output = toolCall.output ?? "";
    const mutationTool = isMutationToolLabel(toolCall.label, output);

    return (
      mutationTool &&
      (toolCall.status === "error" || toolCall.status === "skipped" || output.toLowerCase().includes("quality warnings:"))
    );
  });

  if (!latestEditToolCall) {
    return false;
  }

  const detail = `${latestEditToolCall.detail ?? ""}\n${latestEditToolCall.input ?? ""}\n${latestEditToolCall.output ?? ""}\n${contextMessage}`;

  if (isNonRecoverableAccessBlock(detail)) {
    return false;
  }

  return RECOVERABLE_EDIT_RE.test(detail);
}

export function createRecoverableLocalEditRetryInstruction(
  prompt: string,
  contextMessage: string,
  recoverableFailure?: RecoverableToolFailureContext,
) {
  const latestFailedSection = extractFirstFailedToolSection(contextMessage);
  const pathGuidance = createFailedPathGuidance([contextMessage, recoverableFailure?.output ?? ""].filter(Boolean).join("\n"));

  return [
    "RECOVERABLE LOCAL EDIT FAILURE",
    `Original user request: ${prompt}`,
    recoverableFailure?.tool ? `Failed tool: ${recoverableFailure.tool}${recoverableFailure.callNumber ? ` (call ${recoverableFailure.callNumber})` : ""}` : "",
    recoverableFailure?.recoveryKind ? `Recovery kind: ${recoverableFailure.recoveryKind}` : "",
    recoverableFailure?.retryInstruction ? `Runtime retry instruction: ${recoverableFailure.retryInstruction}` : "",
    "The last edit/write/create action failed or produced blocking quality warnings, but this is recoverable. Continue the same task now instead of writing a prose promise.",
    "Do not say the failed file was changed, do not paste manual replacement instructions, and do not summarize the tool error as the final answer unless access is truly blocked.",
    pathGuidance,
    "A valid edit_file call must include path plus exactly one edit shape: old_text/new_text, old_str/new_str, start_line/end_line/content, insert_at_line/content, insert_line/new_str, or start_char/end_char/content.",
    "A valid write_file call must include both path and content. write_file is for new files by default; for existing files, switch to edit_file unless the user truly requested full replacement. Full-file replacement requires replace_entire_file=true and expected_sha256 from a fresh read_file/view_code result.",
    "If full-file replacement was blocked and the result includes a current sha256, retry the same write_file with replace_entire_file=true and expected_sha256 set to that value only if replacing the whole file is truly intended.",
    "If JSX/TSX characters such as < and > made the fallback text protocol ambiguous, do not force-overwrite the file. Retry with edit_file using a small line range, exact old_str/new_str, or XML-safe CDATA-wrapped arg_value content.",
    "If text or whitespace did not match, call view_code or read_file for the current target lines using the exact failed path, then retry with one precise edit_file or inline_edit call using a line range, character range, or narrower old_text. inline_edit uses the same structured edit backend, so do not merely say you will use it.",
    "If read_file/view_code says file not found, do not repeatedly try nearby sibling paths. Use search_files with the basename from the failed path or list_directory on the nearest known parent directory, then retry with the discovered exact path.",
    "If a written file returned quality warnings, inspect or edit that file and fix the warnings before finalizing.",
    "If the result shows editing is impossible because access is blocked, explain that plainly. Otherwise emit the next needed tool_call now.",
    latestFailedSection ? `Last failed tool result:\n${latestFailedSection}` : "",
  ].filter(Boolean).join("\n\n");
}

function createFailedPathGuidance(value: string) {
  const paths = extractMentionedPaths(value);
  if (paths.length === 0) {
    return "";
  }

  const basenames = [...new Set(paths.map(basenameFromPath).filter(Boolean))];

  return [
    `Path recovery rule: preserve exact failed paths including nested folders. Mentioned path${paths.length === 1 ? "" : "s"}: ${paths.join(" | ")}.`,
    basenames.length > 0 ? `If a path is not found, search_files for basename${basenames.length === 1 ? "" : "s"}: ${basenames.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

function extractMentionedPaths(value: string) {
  const matches = value.match(/[A-Za-z]:[\\/][^\r\n]+/g) ?? [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const match of matches) {
    const normalized = match
      .replace(/\s+\|.*$/, "")
      .replace(/\s+(?:Operation|Changed|Replacements|Bytes written|Index refresh|Preview lines):.*$/i, "")
      .replace(/[).,;]+$/, "")
      .trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output.slice(0, 6);
}

function basenameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}
