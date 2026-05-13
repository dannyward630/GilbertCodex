import { firstArg, normalizeComparablePath } from "./argHelpers";
import type { LocalComputerToolName, ParsedLocalComputerToolCall } from "./types";

const FUSABLE_WRITE_TOOL_NAMES = new Set<LocalComputerToolName>([
  "write_file",
  "create_code_file",
  "create_text_file",
  "create_markdown_file",
  "create_react_file",
  "create_html_file",
]);

function isFusableWriteCall(call: ParsedLocalComputerToolCall): boolean {
  if (!FUSABLE_WRITE_TOOL_NAMES.has(call.tool)) {
    return false;
  }

  const path = firstArg(call.args, ["path", "file_path", "file"]);
  const content = firstArg(call.args, ["content", "text", "body", "markdown"]);
  if (!path || !content) {
    return false;
  }

  if (firstArg(call.args, ["replace_entire_file", "replaceEntireFile", "full_replace", "fullReplace", "allow_full_rewrite", "allowFullRewrite"])) {
    return false;
  }

  return true;
}

function fileCreationKindForFusedTool(tool: LocalComputerToolName): string | undefined {
  switch (tool) {
    case "create_react_file": return "react";
    case "create_html_file": return "html";
    case "create_markdown_file": return "markdown";
    case "create_text_file": return "text";
    case "create_code_file": return "code";
    default: return undefined;
  }
}

/**
 * Fuses adjacent same-pass write_file/create_*_file calls into a single
 * synthetic create_files batch. This is what keeps the model from blowing the
 * source-file mutation cap when it scaffolds many files with separate writes:
 * the batch counts as one mutation. Read/search/list/edit_file calls flush the
 * buffer so any read-then-write order the model intended is preserved.
 */
export function fuseAdjacentLocalFileMutations(calls: ParsedLocalComputerToolCall[]): ParsedLocalComputerToolCall[] {
  if (calls.length < 2) {
    return calls;
  }

  const result: ParsedLocalComputerToolCall[] = [];
  let buffer: ParsedLocalComputerToolCall[] = [];

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    if (buffer.length === 1) {
      result.push(buffer[0]);
      buffer = [];
      return;
    }

    const byPath = new Map<string, ParsedLocalComputerToolCall>();
    for (const call of buffer) {
      const path = firstArg(call.args, ["path", "file_path", "file"]) ?? "";
      const key = normalizeComparablePath(path);
      if (key) {
        byPath.set(key, call);
      }
    }
    const dedupedCalls = Array.from(byPath.values());

    if (dedupedCalls.length <= 1) {
      result.push(buffer[buffer.length - 1]);
      buffer = [];
      return;
    }

    const files = dedupedCalls.map((call) => {
      const path = firstArg(call.args, ["path", "file_path", "file"]) ?? "";
      const content = firstArg(call.args, ["content", "text", "body", "markdown"]) ?? "";
      const language = firstArg(call.args, ["language", "lang", "syntax"]);
      const title = firstArg(call.args, ["title", "name"]);
      const overwrite = firstArg(call.args, ["overwrite"]) === "true";
      const kind = fileCreationKindForFusedTool(call.tool);

      const entry: Record<string, unknown> = { path, content, create_parent_dirs: true };
      if (kind) entry.kind = kind;
      if (language) entry.language = language;
      if (title) entry.title = title;
      if (overwrite) entry.overwrite = true;
      return entry;
    });

    const fusedCount = dedupedCalls.length;
    const skippedDup = buffer.length - fusedCount;
    const note = skippedDup > 0
      ? `auto-fused from ${buffer.length} write_file/create_*_file calls (${skippedDup} duplicate path${skippedDup === 1 ? "" : "s"} kept latest)`
      : `auto-fused from ${buffer.length} write_file/create_*_file calls`;

    result.push({
      tool: "create_files",
      args: { files: JSON.stringify(files) },
      raw: `// ${note}`,
    });
    buffer = [];
  };

  for (const call of calls) {
    if (!isFusableWriteCall(call)) {
      flush();
      result.push(call);
      continue;
    }
    buffer.push(call);
  }
  flush();

  return result;
}
