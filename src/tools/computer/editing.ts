import type { ComputerReadFileResult, ComputerWriteFileResult } from "../../types/localWorkspace";
import { readComputerTextFile, writeComputerTextFile } from "./files";
import { collectTextQualityWarnings } from "./textQuality";

const DEFAULT_READ_LINES = 260;
const EDIT_READ_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_LINES = 36;

export interface InlineEditRequest {
  args: Record<string, string>;
  path: string;
  roots: string[];
}

export interface InlineEditResult extends ComputerWriteFileResult {
  changed: boolean;
  operation: string;
  preview: string;
  qualityWarnings: string[];
  replacements: number;
}

export async function editComputerTextFile({ args, path, roots }: InlineEditRequest): Promise<InlineEditResult> {
  const file = await readComputerTextFile(path, numberArg(args, ["max_bytes", "maxBytes", "bytes"], EDIT_READ_BYTES));

  if (file.truncated) {
    throw new Error("Refusing to edit a partially loaded file. Narrow the target or increase the readable file size first.");
  }

  const edit = createEditedContent(file.content, args);

  if (!edit.changed) {
    return {
      bytesWritten: 0,
      changed: false,
      created: false,
      modifiedAt: file.modifiedAt,
      operation: edit.operation,
      path: file.path,
      preview: formatEditPreview(file.path, file.content, edit.previewStartLine),
      qualityWarnings: [],
      replacements: 0,
    };
  }

  const written = await writeComputerTextFile(path, edit.content, roots, {
    createParentDirs: false,
    overwrite: true,
  });

  return {
    ...written,
    changed: true,
    operation: edit.operation,
    preview: formatEditPreview(written.path, edit.content, edit.previewStartLine),
    qualityWarnings: collectTextQualityWarnings(written.path, edit.content),
    replacements: edit.replacements,
  };
}

export function formatPreciseCodeView(file: ComputerReadFileResult, args: Record<string, string>) {
  const allLines = file.content.split(/\r?\n/);
  const requestedStart = numberArg(args, ["start_line", "startLine", "line_start", "lineStart"], 1);
  const requestedEnd = numberArg(args, ["end_line", "endLine", "line_end", "lineEnd"], Math.min(allLines.length, requestedStart + DEFAULT_READ_LINES - 1));
  const startLine = clamp(requestedStart, 1, Math.max(allLines.length, 1));
  const endLine = clamp(requestedEnd, startLine, allLines.length);
  const selectedLines = allLines.slice(startLine - 1, endLine);
  const mode = (argValue(args, ["mode", "view"]) || "lines").toLowerCase();
  const characterStart = optionalNumberArg(args, ["start_char", "startChar", "char_start", "charStart"]);
  const characterEnd = optionalNumberArg(args, ["end_char", "endChar", "char_end", "charEnd"]);
  const wordCount = countWords(file.content);
  const header = [
    `Path: ${file.path}`,
    `Syntax: ${file.extension ?? "text"}`,
    `Bytes: ${file.size}${file.truncated ? " (read truncated)" : ""}`,
    `Loaded characters: ${Array.from(file.content).length}`,
    `Loaded words: ${wordCount}`,
    `Loaded lines: ${allLines.length}`,
  ];

  if (mode.includes("letter") || mode.includes("char") || characterStart !== undefined || characterEnd !== undefined) {
    return [...header, "", "CHARACTER VIEW", formatCharacterView(file.content, characterStart ?? 0, characterEnd ?? Math.min(Array.from(file.content).length, 2200))].join("\n");
  }

  if (mode.includes("word")) {
    return [...header, "", "WORD VIEW", formatWordView(file.content, optionalNumberArg(args, ["start_word", "startWord"]) ?? 1, optionalNumberArg(args, ["end_word", "endWord"]) ?? 360)].join("\n");
  }

  return [
    ...header,
    `Displayed lines: ${startLine}-${endLine}`,
    "",
    "LINE VIEW",
    ...selectedLines.map((line, index) => `${String(startLine + index).padStart(4, " ")} | ${line}`),
  ].join("\n");
}

function createEditedContent(content: string, args: Record<string, string>) {
  const oldText = argValue(args, ["old_text", "oldText", "find", "target", "before"]);

  if (oldText !== undefined) {
    return replaceExactText(content, oldText, argValue(args, ["new_text", "newText", "replacement", "after", "content"]) ?? "", args);
  }

  if (hasAnyArg(args, ["start_char", "startChar", "char_start", "charStart", "insert_at_char", "insertAtChar"])) {
    return replaceCharacterRange(content, args);
  }

  if (hasAnyArg(args, ["start_line", "startLine", "line_start", "lineStart", "line", "insert_at_line", "insertAtLine"])) {
    return replaceLineRange(content, args);
  }

  throw new Error("edit_file needs old_text/new_text, start_line/end_line/content, or start_char/end_char/content.");
}

interface TextReplacementMatch {
  end: number;
  flexibleWhitespace: boolean;
  start: number;
}

function replaceExactText(content: string, oldText: string, newText: string, args: Record<string, string>) {
  if (!oldText) {
    throw new Error("edit_file old_text cannot be empty.");
  }

  const exactMatches = findAllOccurrences(content, oldText).map((start) => ({
    end: start + oldText.length,
    flexibleWhitespace: false,
    start,
  }));
  const matches = exactMatches.length > 0 ? exactMatches : findWhitespaceFlexibleOccurrences(content, oldText);

  if (matches.length === 0) {
    throw new Error("edit_file could not find old_text exactly or by whitespace-flexible matching. Use view_code to inspect the target lines, then try a narrower edit or a line-range edit.");
  }

  const occurrence = optionalNumberArg(args, ["occurrence"]);
  const replaceAll = booleanArg(args, ["replace_all", "replaceAll", "all"], false);
  const expectedReplacements = optionalNumberArg(args, ["expected_replacements", "expectedReplacements"]);

  if (expectedReplacements !== undefined && matches.length !== expectedReplacements) {
    throw new Error(`edit_file expected ${expectedReplacements} match(es), but found ${matches.length}.`);
  }

  if (!replaceAll && occurrence === undefined && matches.length > 1) {
    throw new Error(`edit_file found ${matches.length} matches. Provide occurrence or replace_all=true.`);
  }

  if (occurrence !== undefined && (occurrence < 1 || occurrence > matches.length)) {
    throw new Error(`edit_file occurrence must be between 1 and ${matches.length}. Received ${occurrence}.`);
  }

  const selectedMatches = replaceAll ? matches : [matches[(occurrence ?? 1) - 1]];
  let cursor = 0;
  let nextContent = "";

  for (const match of selectedMatches) {
    nextContent += content.slice(cursor, match.start);
    nextContent += match.flexibleWhitespace ? newText.trim() : newText;
    cursor = match.end;
  }

  nextContent += content.slice(cursor);
  const usedFlexibleWhitespace = selectedMatches.some((match) => match.flexibleWhitespace);

  return {
    changed: nextContent !== content,
    content: nextContent,
    operation: `${usedFlexibleWhitespace ? "whitespace-flexible" : "exact"} text replacement (${selectedMatches.length} match${selectedMatches.length === 1 ? "" : "es"})`,
    previewStartLine: lineNumberAtOffset(content, selectedMatches[0].start),
    replacements: selectedMatches.length,
  };
}

function replaceCharacterRange(content: string, args: Record<string, string>) {
  const characters = Array.from(content);
  const insertAt = optionalNumberArg(args, ["insert_at_char", "insertAtChar"]);
  const start = insertAt ?? numberArg(args, ["start_char", "startChar", "char_start", "charStart"], 0);
  const end = insertAt ?? numberArg(args, ["end_char", "endChar", "char_end", "charEnd"], start + 1);

  assertCharacterIndex(start, characters.length, insertAt === undefined ? "start_char" : "insert_at_char");
  assertCharacterIndex(end, characters.length, "end_char");

  if (end < start) {
    throw new Error(`edit_file end_char must be greater than or equal to start_char. Received ${start}-${end}.`);
  }

  assertExpectedSelection(characters.slice(start, end).join(""), args, `character range ${start}-${end}`);

  const replacement = argValue(args, ["new_text", "newText", "replacement", "content", "text"]) ?? "";
  const nextContent = `${characters.slice(0, start).join("")}${replacement}${characters.slice(end).join("")}`;

  return {
    changed: nextContent !== content,
    content: nextContent,
    operation: insertAt === undefined ? `character range ${start}-${end}` : `insert at character ${start}`,
    previewStartLine: lineNumberAtOffset(content, offsetFromCharacterIndex(content, start)),
    replacements: 1,
  };
}

function replaceLineRange(content: string, args: Record<string, string>) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const insertAt = optionalNumberArg(args, ["insert_at_line", "insertAtLine"]);
  const requestedStart = insertAt ?? optionalNumberArg(args, ["line"]) ?? numberArg(args, ["start_line", "startLine", "line_start", "lineStart"], 1);
  const requestedEnd = insertAt === undefined ? numberArg(args, ["end_line", "endLine", "line_end", "lineEnd"], requestedStart) : insertAt - 1;
  const lineCount = Math.max(lines.length, 1);
  const startLine = requestedStart;
  const endLine = requestedEnd;

  if (insertAt === undefined) {
    assertLineNumber(startLine, lineCount, "start_line");
    assertLineNumber(endLine, lineCount, "end_line");

    if (endLine < startLine) {
      throw new Error(`edit_file end_line must be greater than or equal to start_line. Received ${startLine}-${endLine}.`);
    }
  } else {
    assertInsertLine(startLine, lineCount);
  }

  if (insertAt === undefined) {
    assertExpectedSelection(lines.slice(startLine - 1, endLine).join(newline), args, `line range ${startLine}-${endLine}`, newline);
  }

  const replacement = argValue(args, ["content", "new_text", "newText", "replacement", "text"]) ?? "";
  const replacementLines = replacement.length ? replacement.replace(/\r\n/g, "\n").split("\n") : [];
  const nextLines = [...lines];
  const deleteCount = insertAt === undefined ? endLine - startLine + 1 : 0;

  nextLines.splice(startLine - 1, deleteCount, ...replacementLines);

  let nextContent = nextLines.join(newline);

  if (content.endsWith("\n") && !nextContent.endsWith("\n")) {
    nextContent += newline;
  }

  return {
    changed: nextContent !== content,
    content: nextContent,
    operation: insertAt === undefined ? `line range ${startLine}-${endLine}` : `insert before line ${startLine}`,
    previewStartLine: startLine,
    replacements: 1,
  };
}

function assertCharacterIndex(value: number, characterCount: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > characterCount) {
    throw new Error(`edit_file ${label} must be between 0 and ${characterCount}. Received ${value}.`);
  }
}

function assertLineNumber(value: number, lineCount: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || value > lineCount) {
    throw new Error(`edit_file ${label} must be between 1 and ${lineCount}. Received ${value}.`);
  }
}

function assertInsertLine(value: number, lineCount: number) {
  if (!Number.isInteger(value) || value < 1 || value > lineCount + 1) {
    throw new Error(`edit_file insert_at_line must be between 1 and ${lineCount + 1}. Received ${value}.`);
  }
}

function assertExpectedSelection(actual: string, args: Record<string, string>, description: string, newline = "\n") {
  const expected = argValue(args, ["expected_text", "expectedText", "expected_content", "expectedContent", "expected_current", "expectedCurrent", "expected_lines", "expectedLines"]);

  if (expected === undefined) {
    return;
  }

  const normalizedExpected = expected.replace(/\r\n/g, "\n").replace(/\n/g, newline);

  if (actual !== normalizedExpected) {
    throw new Error(`edit_file expected_text did not match ${description}. Use view_code again and retry with current text.`);
  }
}

function formatEditPreview(path: string, content: string, previewStartLine: number) {
  const lines = content.split(/\r?\n/);
  const startLine = clamp(previewStartLine - 6, 1, Math.max(lines.length, 1));
  const endLine = clamp(startLine + MAX_PREVIEW_LINES - 1, startLine, lines.length);

  return [
    `Path: ${path}`,
    `Preview lines: ${startLine}-${endLine}`,
    "",
    ...lines.slice(startLine - 1, endLine).map((line, index) => `${String(startLine + index).padStart(4, " ")} | ${line}`),
  ].join("\n");
}

function formatCharacterView(content: string, start: number, end: number) {
  const characters = Array.from(content);
  const safeStart = clamp(start, 0, characters.length);
  const safeEnd = clamp(end, safeStart, Math.min(characters.length, safeStart + 4_000));

  return characters
    .slice(safeStart, safeEnd)
    .map((character, index) => `${safeStart + index}: ${JSON.stringify(character)}`)
    .join("\n");
}

function formatWordView(content: string, startWord: number, endWord: number) {
  const words = Array.from(content.matchAll(/\S+/g)).map((match, index) => ({
    index: index + 1,
    offset: match.index ?? 0,
    value: match[0],
  }));
  const safeStart = clamp(startWord, 1, Math.max(words.length, 1));
  const safeEnd = clamp(endWord, safeStart, Math.min(words.length, safeStart + 700));

  return words
    .slice(safeStart - 1, safeEnd)
    .map((word) => `${word.index} @${word.offset}: ${word.value}`)
    .join("\n");
}

function findAllOccurrences(content: string, needle: string) {
  const matches: number[] = [];
  let cursor = 0;

  while (cursor <= content.length) {
    const index = content.indexOf(needle, cursor);

    if (index < 0) {
      break;
    }

    matches.push(index);
    cursor = index + Math.max(needle.length, 1);
  }

  return matches;
}

function findWhitespaceFlexibleOccurrences(content: string, needle: string): TextReplacementMatch[] {
  const trimmedNeedle = needle.trim();

  if (!shouldAttemptWhitespaceFlexibleMatch(trimmedNeedle)) {
    return [];
  }

  const pattern = createWhitespaceFlexiblePattern(trimmedNeedle);

  if (!pattern) {
    return [];
  }

  const matches: TextReplacementMatch[] = [];
  const expression = new RegExp(pattern, "g");
  let match: RegExpExecArray | null;

  while ((match = expression.exec(content))) {
    matches.push({
      end: match.index + match[0].length,
      flexibleWhitespace: true,
      start: match.index,
    });

    if (match[0].length === 0) {
      expression.lastIndex += 1;
    }
  }

  return matches;
}

function shouldAttemptWhitespaceFlexibleMatch(needle: string) {
  return needle.length > 0 && /\s/.test(needle) && countNonWhitespaceChunks(needle) >= 3;
}

function createWhitespaceFlexiblePattern(needle: string) {
  const parts = needle.split(/(\s+)/).filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "";
  }

  return parts
    .map((part) => /\s+/.test(part) ? "\\s+" : escapeRegExp(part))
    .join("");
}

function countNonWhitespaceChunks(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineNumberAtOffset(content: string, offset: number) {
  return content.slice(0, Math.max(offset, 0)).split(/\r?\n/).length;
}

function offsetFromCharacterIndex(content: string, characterIndex: number) {
  return Array.from(content)
    .slice(0, characterIndex)
    .join("").length;
}

function hasAnyArg(args: Record<string, string>, names: string[]) {
  return names.some((name) => Object.prototype.hasOwnProperty.call(args, normalizeArgName(name)));
}

function argValue(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const value = optionalNumberArg(args, names);
  return value === undefined ? fallback : value;
}

function optionalNumberArg(args: Record<string, string>, names: string[]) {
  const rawValue = argValue(args, names);

  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const trimmed = rawValue.trim();

  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Expected numeric ${names[0]}, but received "${rawValue}".`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const value = argValue(args, names);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function countWords(content: string) {
  return content.match(/\S+/g)?.length ?? 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}
