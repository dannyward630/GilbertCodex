import { createCodeFileContent, createHtmlFileContent, createReactFileContent } from "./codeFileCreator";
import {
  ensurePathExtension,
  extensionForLanguage,
  extensionFromPath,
  inferKindFromExtension,
  mimeTypeForExtension,
  normalizeLanguage,
  profileForTool,
} from "./fileTypeRegistry";
import { createPdfFileContent } from "./pdfFileCreator";
import type {
  FileCreationExecutionSummary,
  FileCreationKind,
  FileCreationToolCall,
  FileCreationToolName,
  PreparedFileCreationWrite,
} from "./fileCreationTypes";
import { ensureFinalNewline, normalizeMarkdownDocument, normalizeTextDocument } from "./markdownContent";

const MAX_BATCH_FILES = 50;
const MAX_TOTAL_CONTENT_CHARS = 2_000_000;

interface RawBatchFile {
  content?: unknown;
  createParentDirs?: unknown;
  create_parent_dirs?: unknown;
  file?: unknown;
  filePath?: unknown;
  file_path?: unknown;
  kind?: unknown;
  duplicateStrategy?: unknown;
  duplicate_strategy?: unknown;
  ifExists?: unknown;
  if_exists?: unknown;
  language?: unknown;
  markdown?: unknown;
  name?: unknown;
  overwrite?: unknown;
  path?: unknown;
  text?: unknown;
  title?: unknown;
  tool?: unknown;
  type?: unknown;
}

export function prepareFileCreationWrites(toolCall: FileCreationToolCall, roots: string[]) {
  const writes =
    toolCall.tool === "create_files"
      ? parseBatchFiles(toolCall.args).map((file) => createPreparedWrite(toolNameForBatchFile(file), batchArgsToRecord(file), roots))
      : [createPreparedWrite(toolCall.tool, toolCall.args, roots)];
  const totalChars = writes.reduce((sum, write) => sum + write.content.length, 0);

  if (writes.length > MAX_BATCH_FILES) {
    throw new Error(`create_files can create at most ${MAX_BATCH_FILES} files per call.`);
  }

  if (totalChars > MAX_TOTAL_CONTENT_CHARS) {
    throw new Error("The requested file batch is too large. Split it into smaller create_files calls.");
  }

  return writes;
}

export function formatFileCreationSummary(summary: FileCreationExecutionSummary) {
  const rows = summary.results.flatMap((result, index) => [
    `${index + 1}. ${result.write.path}`,
    `   Kind: ${result.kind}${result.language ? ` (${result.language})` : ""}`,
    `   MIME: ${result.mimeType}`,
    `   Created: ${result.write.created ? "yes" : "no"}`,
    `   Bytes written: ${result.write.bytesWritten}`,
    `   Markdown-aware: ${result.markdownAware ? "yes" : "no"}`,
    `   Preview: ${result.preview.replace(/\s+/g, " ").slice(0, 220)}`,
  ]);

  return [
    `Files written: ${summary.results.length}`,
    summary.indexSummary ? `Index refreshed: ${summary.indexSummary.entryCount} entries` : "Index refresh: skipped",
    ...rows,
  ].join("\n");
}

export function describeFileCreationTools() {
  return [
    "File creation tools: create_text_file, create_markdown_file, create_code_file, create_react_file, create_html_file, create_pdf_file, create_files.",
    "All file creators accept content, text, body, or markdown. Code creators can receive fenced Markdown and will extract the best matching code fence before writing.",
    "create_code_file supports any programming language when the path has the desired extension; language can also infer common extensions such as ts, js, py, rs, go, java, html, css, json, yaml, sql, swift, kotlin, php, ruby, and shell.",
    "create_files accepts files_json as an array or { files: [...] } with path, kind/tool/type, content/markdown/text, language, title, overwrite, and createParentDirs.",
    "create_pdf_file renders Markdown-like headings, lists, code blocks, and notes into a valid local PDF file.",
  ].join("\n");
}

function createPreparedWrite(tool: FileCreationToolName, args: Record<string, string>, roots: string[]): PreparedFileCreationWrite {
  const title = firstArg(args, ["title", "name"]);
  const language = normalizeLanguage(firstArg(args, ["language", "lang", "syntax"]));
  const profile = profileForTool(tool, language);
  const path = resolveTargetPath(args, roots, profile.defaultExtension, title);
  const extension = extensionFromPath(path) || profile.defaultExtension;
  const kind = tool === "create_code_file" ? inferKindFromExtension(extension) : profile.kind;
  const content = createContentForKind(kind, path, args, title, language ?? profile.language);
  const normalizedContent = kind === "pdf" ? content : ensureFinalNewline(content);
  const lineCount = normalizedContent.split(/\n/).length;

  return {
    content: normalizedContent,
    createParentDirs: booleanArg(args, ["create_parent_dirs", "createParentDirs", "parents"], true),
    duplicateStrategy: duplicateStrategyArg(args),
    extension,
    generatedFromMarkdown: Boolean(firstArg(args, ["markdown"])) || /```/.test(rawContentFromArgs(args)),
    kind,
    language: language ?? profile.language ?? extensionForLanguage(extension) ?? (kind === "code" ? extension : undefined),
    lineCount,
    markdownAware: true,
    mimeType: kind === "pdf" ? "application/pdf" : mimeTypeForExtension(extension),
    overwrite: booleanArg(args, ["overwrite"], false),
    path,
    preview: createPreview(kind, normalizedContent),
    title,
  };
}

function createContentForKind(kind: FileCreationKind, path: string, args: Record<string, string>, title?: string, language?: string) {
  const content = rawContentFromArgs(args);

  switch (kind) {
    case "markdown":
      return normalizeMarkdownDocument(content, title);
    case "text":
      return normalizeTextDocument(content, title);
    case "react":
      return createReactFileContent(path, content, title);
    case "html":
      return createHtmlFileContent(content, title);
    case "pdf":
      return createPdfFileContent(content, title);
    case "code":
      return createCodeFileContent(path, content, language);
  }
}

function parseBatchFiles(args: Record<string, string>) {
  const raw = firstArg(args, ["files_json", "files", "manifest", "items"]);

  if (!raw) {
    throw new Error("create_files requires files_json containing an array of file specs or an object with a files array.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`create_files could not parse files_json: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }

  const files = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed && Array.isArray((parsed as { files?: unknown }).files)
      ? (parsed as { files: unknown[] }).files
      : undefined;

  if (!files) {
    throw new Error("create_files files_json must be an array or an object with a files array.");
  }

  return files as RawBatchFile[];
}

function batchArgsToRecord(file: RawBatchFile): Record<string, string> {
  const entries: Array<[string, unknown]> = [
    ["path", file.path ?? file.file_path ?? file.filePath ?? file.file],
    ["content", file.content ?? file.markdown ?? file.text],
    ["title", file.title ?? file.name],
    ["language", file.language],
    ["duplicate_strategy", file.duplicate_strategy ?? file.duplicateStrategy ?? file.if_exists ?? file.ifExists],
    ["overwrite", file.overwrite],
    ["create_parent_dirs", file.create_parent_dirs ?? file.createParentDirs],
  ];

  return Object.fromEntries(entries.filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value ?? "")]));
}

function toolNameForBatchFile(file: RawBatchFile): FileCreationToolName {
  const rawKind = String(file.tool ?? file.kind ?? file.type ?? "").trim().toLowerCase().replace(/^file\./, "");

  if (rawKind.includes("pdf")) {
    return "create_pdf_file";
  }

  if (rawKind.includes("react") || rawKind.includes("tsx") || rawKind.includes("jsx")) {
    return "create_react_file";
  }

  if (rawKind.includes("html")) {
    return "create_html_file";
  }

  if (rawKind.includes("markdown") || rawKind === "md" || rawKind.includes("note")) {
    return "create_markdown_file";
  }

  if (rawKind.includes("text") || rawKind === "txt") {
    return "create_text_file";
  }

  return "create_code_file";
}

function resolveTargetPath(args: Record<string, string>, roots: string[], extension: string, title?: string) {
  const explicitPath = firstArg(args, ["path", "file_path", "file"]);

  if (explicitPath) {
    return ensurePathExtension(explicitPath, extension);
  }

  const directory = firstArg(args, ["directory_path", "folder_path", "directory", "folder"]) || roots[0];

  if (!directory) {
    throw new Error("File creation requires a path, or a selected workspace root plus title/name.");
  }

  const fileName = `${slugify(title || firstArg(args, ["name"]) || "untitled")}.${extension.replace(/^\./, "")}`;
  return joinLocalPath(directory, [fileName]);
}

function rawContentFromArgs(args: Record<string, string>) {
  return firstArg(args, ["content", "markdown", "body", "text", "value"]) ?? "";
}

function createPreview(kind: FileCreationKind, content: string) {
  if (kind === "pdf") {
    return "%PDF document";
  }

  return content.split(/\n/).slice(0, 4).join(" ").trim();
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);
    const value = args[normalizedName];

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const value = firstArg(args, names);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function duplicateStrategyArg(args: Record<string, string>): PreparedFileCreationWrite["duplicateStrategy"] {
  const value = (firstArg(args, ["duplicate_strategy", "duplicateStrategy", "if_exists", "ifExists"]) ?? "fail").toLowerCase();

  if (value.includes("increment") || value.includes("rename") || value.includes("unique")) {
    return "increment";
  }

  if (value.includes("skip")) {
    return "skip";
  }

  return "fail";
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function joinLocalPath(root: string, parts: string[]) {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""))].join(separator);
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled"
  );
}
