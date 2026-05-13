import type { ComputerReadFileResult, ComputerWriteFileResult } from "../../types/localWorkspace";
import { readComputerTextFile, writeComputerTextFile } from "./files";
import { assertSyntaxBeforeWrite } from "./syntaxValidation";
import { collectTextQualityWarnings } from "./textQuality";

// No default cap on lines displayed. If the caller wants a window, they pass
// start_line/end_line. Otherwise we show the entire file because the user has
// explicitly said no context can be silently dropped.
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
  const file = await readComputerTextFile(path, optionalNumberArg(args, ["max_bytes", "maxBytes", "bytes"]));

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

  assertSyntaxBeforeWrite(path, edit.content, { originalContent: file.content });

  const written = await writeComputerTextFile(path, edit.content, roots, {
    createParentDirs: false,
    expectedSha256: file.sha256,
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
  // Accept the conventional read_file/view_code keys plus `offset` / `from` /
  // `skip` (1-based line) which the model naturally reaches for when paging
  // through a long file. The corresponding "how many lines" arg accepts
  // `limit`, `count`, and `lines` so a model that thinks in pages gets the
  // window it expected instead of silently re-receiving lines 1-N.
  const requestedStart = numberArg(args, ["start_line", "startLine", "line_start", "lineStart", "offset", "from", "skip"], 1);
  const explicitEnd = optionalNumberArg(args, ["end_line", "endLine", "line_end", "lineEnd", "to", "until"]);
  const explicitLimit = optionalNumberArg(args, ["limit", "count", "max_lines", "maxLines", "lines"]);
  const requestedEnd = explicitEnd ?? (explicitLimit !== undefined ? requestedStart + explicitLimit - 1 : allLines.length);
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
    file.sha256 ? `Sha256: ${file.sha256}` : "Sha256: unavailable for this read",
    `Loaded characters: ${file.content.length}`,
    `Loaded words: ${wordCount}`,
    `Loaded lines: ${allLines.length}`,
  ];

  if (mode.includes("letter") || mode.includes("char") || characterStart !== undefined || characterEnd !== undefined) {
    return [...header, "", "CHARACTER VIEW", formatCharacterView(file.content, characterStart ?? 0, characterEnd ?? file.content.length)].join("\n");
  }

  if (mode.includes("word")) {
    return [...header, "", "WORD VIEW", formatWordView(file.content, optionalNumberArg(args, ["start_word", "startWord"]) ?? 1, optionalNumberArg(args, ["end_word", "endWord"]) ?? Number.MAX_SAFE_INTEGER)].join("\n");
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
  const oldText = argValue(args, ["old_text", "oldText", "old_string", "oldString", "old_str", "oldStr", "find", "search", "target", "before"]);

  if (oldText !== undefined) {
    return replaceExactText(content, oldText, argValue(args, ["new_text", "newText", "new_string", "newString", "new_str", "newStr", "replace", "replacement", "after", "content"]) ?? "", args);
  }

  if (hasAnyArg(args, ["start_char", "startChar", "char_start", "charStart", "insert_at_char", "insertAtChar"])) {
    return replaceCharacterRange(content, args);
  }

  if (hasAnyArg(args, ["start_line", "startLine", "line_start", "lineStart", "line", "insert_at_line", "insertAtLine", "insert_line", "insertLine"])) {
    return replaceLineRange(content, args);
  }

  throw new Error("edit_file needs old_text/new_text (old_string/new_string or old_str/new_str also accepted), start_line/end_line/content, insert_at_line/content, insert_line/new_str, or start_char/end_char/content.");
}

interface TextReplacementMatch {
  end: number;
  flexibleWhitespace: boolean;
  start: number;
}

interface ContentLine {
  end: number;
  newlineEnd: number;
  start: number;
  text: string;
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
  const matches = exactMatches.length > 0 ? exactMatches : findWhitespaceFlexibleLineOccurrences(content, oldText);

  if (matches.length === 0) {
    const hint = formatExactTextNearMiss(content, oldText);
    const suffix = hint
      ? `\n\n${hint}\n\nIf this is the block you meant, retry with the actual text (a 3-5 line block with surrounding context is usually enough) or switch to a line-range edit using the line numbers above. Otherwise, use view_code first.`
      : " Use view_code to inspect the target lines, then try a narrower edit or a line-range edit.";
    throw new Error(`edit_file could not find old_text exactly or as a unique whitespace-only drift.${suffix}`);
  }

  const occurrence = optionalNumberArg(args, ["occurrence"]);
  const replaceAll = booleanArg(args, ["replace_all", "replaceAll", "all"], false);
  const expectedReplacements = optionalNumberArg(args, ["expected_replacements", "expectedReplacements"]);

  // When the exact pass failed and the flex pass found multiple candidates,
  // refuse to guess: edits applied to the wrong block are the most expensive
  // failure mode. Surface the candidate line numbers so the model can add
  // surrounding context and retry.
  if (exactMatches.length === 0 && matches.length > 1 && !replaceAll && occurrence === undefined) {
    const candidateLines = matches.map((match) => lineNumberAtOffset(content, match.start)).join(", ");
    throw new Error(`edit_file whitespace-flexible match was ambiguous: ${matches.length} candidates near lines ${candidateLines}. Add 2-3 lines of surrounding context to old_text, or pass occurrence/replace_all explicitly, then retry.`);
  }

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
    nextContent += match.flexibleWhitespace ? normalizeFlexibleReplacement(newText, content) : newText;
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
  // Index by UTF-16 code units (i.e. plain string.length / slice) so the
  // indices match how the model — and every standard JS API the model is
  // imitating — counts characters. Array.from() grapheme indexing diverges
  // for astral-plane characters (emoji, combining marks) and is a frequent
  // source of off-by-one edits.
  const codeUnitCount = content.length;
  const insertAt = optionalNumberArg(args, ["insert_at_char", "insertAtChar"]);
  const start = insertAt ?? numberArg(args, ["start_char", "startChar", "char_start", "charStart"], 0);
  const end = insertAt ?? numberArg(args, ["end_char", "endChar", "char_end", "charEnd"], start + 1);

  assertCharacterIndex(start, codeUnitCount, insertAt === undefined ? "start_char" : "insert_at_char");
  assertCharacterIndex(end, codeUnitCount, "end_char");

  if (end < start) {
    throw new Error(`edit_file end_char must be greater than or equal to start_char. Received ${start}-${end}.`);
  }

  assertExpectedSelection(content.slice(start, end), args, `character range ${start}-${end}`);

  const replacement = argValue(args, ["new_text", "newText", "new_string", "newString", "new_str", "newStr", "replace", "replacement", "content", "text"]) ?? "";
  const nextContent = `${content.slice(0, start)}${replacement}${content.slice(end)}`;

  return {
    changed: nextContent !== content,
    content: nextContent,
    operation: insertAt === undefined ? `character range ${start}-${end}` : `insert at character ${start}`,
    previewStartLine: lineNumberAtOffset(content, start),
    replacements: 1,
  };
}

function replaceLineRange(content: string, args: Record<string, string>) {
  const newline = detectEolMajority(content);
  const lines = content.split(/\r?\n/);
  const insertAfterLine = optionalNumberArg(args, ["insert_line", "insertLine"]);
  const insertAt = optionalNumberArg(args, ["insert_at_line", "insertAtLine"]) ?? (insertAfterLine === undefined ? undefined : insertAfterLine + 1);
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
    assertExpectedSelection(lines.slice(startLine - 1, endLine).join(newline), args, `line range ${startLine}-${endLine}`, newline, {
      allowWhitespaceFlexible: true,
      content,
      endLine,
      startLine,
    });
  }

  const replacement = argValue(args, ["content", "new_text", "newText", "new_string", "newString", "new_str", "newStr", "replace", "replacement", "text"]) ?? "";
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

function assertExpectedSelection(
  actual: string,
  args: Record<string, string>,
  description: string,
  newline = "\n",
  options: { allowWhitespaceFlexible?: boolean; content?: string; startLine?: number; endLine?: number } = {},
) {
  const expected = argValue(args, ["expected_text", "expectedText", "expected_string", "expectedString", "expected_content", "expectedContent", "expected_current", "expectedCurrent", "expected_lines", "expectedLines"]);

  if (expected === undefined) {
    return;
  }

  const normalizedExpected = expected.replace(/\r\n/g, "\n").replace(/\n/g, newline);

  if (actual !== normalizedExpected) {
    if (options.allowWhitespaceFlexible && areWhitespaceEquivalentBlocks(actual, normalizedExpected)) {
      return;
    }

    const hint = formatExpectedTextMismatch(actual, normalizedExpected, options);
    const suffix = hint
      ? `\n\n${hint}\n\nRetry with start_line/end_line that match the actual content above, or update expected_text to match what is there.`
      : " The selected text changed beyond harmless whitespace drift; use view_code again and retry with current text.";
    throw new Error(`edit_file expected_text did not match ${description}.${suffix}`);
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
  // UTF-16 code-unit indexing — matches how replaceCharacterRange applies
  // edits and how the model naturally counts via `string.length` / `slice`.
  const safeStart = clamp(start, 0, content.length);
  const safeEnd = clamp(end, safeStart, content.length);

  const output: string[] = [];
  for (let index = safeStart; index < safeEnd; index += 1) {
    output.push(`${index}: ${JSON.stringify(content[index])}`);
  }
  return output.join("\n");
}

function formatWordView(content: string, startWord: number, endWord: number) {
  const words = Array.from(content.matchAll(/\S+/g)).map((match, index) => ({
    index: index + 1,
    offset: match.index ?? 0,
    value: match[0],
  }));
  const safeStart = clamp(startWord, 1, Math.max(words.length, 1));
  const safeEnd = clamp(endWord, safeStart, words.length);

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
  // Trim only outer whitespace — preserving inner newlines is essential for
  // the line-anchored pattern below.
  const trimmedNeedle = needle.replace(/^[ \t]+|[ \t]+$/g, "").replace(/^\s+|\s+$/g, "");

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
  // Only enable whitespace flex for clearly multi-line blocks. Single-line
  // edits must match exactly — relaxing them was the dominant source of
  // edits landing on the wrong nearby line.
  if (needle.length === 0) {
    return false;
  }

  const lines = needle.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return needle.includes("\n") && lines.length >= 2;
}

function createWhitespaceFlexiblePattern(needle: string) {
  // Anchor on line boundaries: each source line is escaped, lines joined with
  // `\r?\n[ \t]*` so the file can be re-indented without spanning unrelated
  // lines via a greedy `\s+`. Within a line, runs of spaces/tabs are still
  // collapsed to `[ \t]+` so trivial spacing tweaks are tolerated.
  const lines = needle.split(/\r?\n/);
  const nonEmptyLines = lines
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter((line) => line.length > 0);

  if (nonEmptyLines.length === 0) {
    return "";
  }

  const linePatterns = nonEmptyLines.map((line) => {
    const segments = line.split(/[ \t]+/).filter((segment) => segment.length > 0);
    return segments.map(escapeRegExp).join("[ \\t]+");
  });

  return linePatterns.join("\\r?\\n[ \\t]*");
}

function detectEolMajority(content: string): string {
  let crlf = 0;
  let loneLf = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 0x0A) {
      if (index > 0 && content.charCodeAt(index - 1) === 0x0D) {
        crlf += 1;
      } else {
        loneLf += 1;
      }
    }
  }

  if (crlf === 0 && loneLf === 0) {
    return "\n";
  }

  if (crlf > loneLf) {
    return "\r\n";
  }

  if (loneLf > crlf) {
    return "\n";
  }

  // Tie: prefer LF — the Rust side does its own majority-with-Windows-tie
  // detection at write time, so this only affects the in-memory edit preview.
  return "\n";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findWhitespaceFlexibleLineOccurrences(content: string, needle: string): TextReplacementMatch[] {
  const needleLines = normalizeFlexibleBlockLines(needle);

  if (!shouldAttemptWhitespaceFlexibleLineMatch(needleLines)) {
    return [];
  }

  const contentLines = splitContentLines(content);
  const matches: TextReplacementMatch[] = [];
  const lastStartIndex = contentLines.length - needleLines.length;

  for (let startIndex = 0; startIndex <= lastStartIndex; startIndex += 1) {
    const candidate = contentLines.slice(startIndex, startIndex + needleLines.length);
    const matchesNeedle = candidate.every((line, lineIndex) => normalizeFlexibleLine(line.text) === needleLines[lineIndex]);

    if (!matchesNeedle) {
      continue;
    }

    matches.push({
      end: candidate[candidate.length - 1].end,
      flexibleWhitespace: true,
      start: candidate[0].start,
    });
  }

  return matches;
}

function shouldAttemptWhitespaceFlexibleLineMatch(needleLines: string[]) {
  // Keep flexible matching to multi-line blocks with at least two meaningful
  // lines. Single-line fuzzy edits are too easy to apply to the wrong spot.
  return needleLines.length >= 2 && needleLines.filter((line) => line.length > 0).length >= 2;
}

function splitContentLines(content: string): ContentLine[] {
  const lines: ContentLine[] = [];
  let start = 0;
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (character !== "\r" && character !== "\n") {
      index += 1;
      continue;
    }

    const end = index;
    let newlineEnd = index + 1;

    if (character === "\r" && content[index + 1] === "\n") {
      newlineEnd = index + 2;
    }

    lines.push({
      end,
      newlineEnd,
      start,
      text: content.slice(start, end),
    });
    start = newlineEnd;
    index = newlineEnd;
  }

  if (start <= content.length) {
    lines.push({
      end: content.length,
      newlineEnd: content.length,
      start,
      text: content.slice(start),
    });
  }

  return lines;
}

function normalizeFlexibleBlockLines(value: string): string[] {
  const lines = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(normalizeFlexibleLine);

  while (lines.length > 0 && lines[0] === "") {
    lines.shift();
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function normalizeFlexibleLine(value: string) {
  return value.trim().replace(/[ \t]+/g, " ");
}

function areWhitespaceEquivalentBlocks(actual: string, expected: string) {
  const actualLines = normalizeFlexibleBlockLines(actual);
  const expectedLines = normalizeFlexibleBlockLines(expected);

  return actualLines.length === expectedLines.length && actualLines.every((line, index) => line === expectedLines[index]);
}

function normalizeFlexibleReplacement(value: string, content: string) {
  return stripOneBoundaryLineBreak(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, detectEolMajority(content));
}

function stripOneBoundaryLineBreak(value: string) {
  let result = value;

  if (result.startsWith("\r\n")) {
    result = result.slice(2);
  } else if (result.startsWith("\n") || result.startsWith("\r")) {
    result = result.slice(1);
  }

  if (result.endsWith("\r\n")) {
    result = result.slice(0, -2);
  } else if (result.endsWith("\n") || result.endsWith("\r")) {
    result = result.slice(0, -1);
  }

  return result;
}

function lineNumberAtOffset(content: string, offset: number) {
  return content.slice(0, Math.max(offset, 0)).split(/\r?\n/).length;
}

const NEAR_MISS_SNIPPET_CAP = 25;

function formatExactTextNearMiss(content: string, needle: string): string | null {
  const needleLines = normalizeFlexibleBlockLines(needle);

  if (needleLines.length === 0 || needleLines.length > NEAR_MISS_SNIPPET_CAP) {
    return null;
  }

  const contentLines = splitContentLines(content);

  if (contentLines.length === 0) {
    return null;
  }

  const windowSize = needleLines.length;
  let bestScore = 0;
  let bestStartIndex = -1;
  const lastStart = Math.max(contentLines.length - windowSize, 0);

  for (let start = 0; start <= lastStart; start += 1) {
    let score = 0;

    for (let offset = 0; offset < windowSize; offset += 1) {
      const fileLine = normalizeFlexibleLine(contentLines[start + offset].text);

      if (fileLine.length > 0 && fileLine === needleLines[offset]) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStartIndex = start;
    }
  }

  const minScore = Math.max(1, Math.ceil(windowSize * 0.25));

  if (bestStartIndex < 0 || bestScore < minScore) {
    return null;
  }

  const firstFileLineNumber = lineNumberAtOffset(content, contentLines[bestStartIndex].start);
  const snippet: string[] = [`Closest partial match: ${bestScore} of ${windowSize} lines align at lines ${firstFileLineNumber}-${firstFileLineNumber + windowSize - 1}.`, ""];

  for (let offset = 0; offset < windowSize; offset += 1) {
    const fileLine = contentLines[bestStartIndex + offset];
    const fileNormalized = normalizeFlexibleLine(fileLine.text);
    const needleNormalized = needleLines[offset];
    const matches = fileNormalized.length > 0 && fileNormalized === needleNormalized;
    const marker = matches ? "  " : "≠ ";
    const lineNumber = firstFileLineNumber + offset;
    snippet.push(`${marker}${String(lineNumber).padStart(4, " ")} | ${fileLine.text}`);

    if (!matches && needleNormalized.length > 0) {
      snippet.push(`         you sent: ${needleNormalized}`);
    }
  }

  return snippet.join("\n");
}

function formatExpectedTextMismatch(
  actual: string,
  expected: string,
  options: { content?: string; startLine?: number; endLine?: number },
): string | null {
  const sections: string[] = [];

  if (options.startLine !== undefined && options.endLine !== undefined) {
    const actualLines = actual.split(/\r?\n/);

    if (actualLines.length > 0 && actualLines.length <= NEAR_MISS_SNIPPET_CAP) {
      sections.push(`Actual content at lines ${options.startLine}-${options.endLine}:`);
      actualLines.forEach((text, index) => {
        sections.push(`  ${String((options.startLine ?? 1) + index).padStart(4, " ")} | ${text}`);
      });
    }
  }

  if (options.content) {
    const altLocation = findExpectedTextLocation(options.content, expected);

    if (altLocation && altLocation.startLine !== options.startLine) {
      sections.push("");
      sections.push(`Your expected_text matches lines ${altLocation.startLine}-${altLocation.endLine} instead — retry with that range if that's the target.`);
    }
  }

  return sections.length > 0 ? sections.join("\n") : null;
}

function findExpectedTextLocation(content: string, expected: string): { startLine: number; endLine: number } | null {
  const exactIndex = content.indexOf(expected);

  if (exactIndex >= 0) {
    const startLine = lineNumberAtOffset(content, exactIndex);
    const expectedLineCount = expected.split(/\r?\n/).length;
    return { endLine: startLine + expectedLineCount - 1, startLine };
  }

  const expectedNormalized = normalizeFlexibleBlockLines(expected);

  if (expectedNormalized.length < 2) {
    return null;
  }

  const contentLines = splitContentLines(content);
  const windowSize = expectedNormalized.length;
  const lastStart = contentLines.length - windowSize;

  for (let start = 0; start <= lastStart; start += 1) {
    const allMatch = expectedNormalized.every((line, index) => normalizeFlexibleLine(contentLines[start + index].text) === line);

    if (allMatch) {
      const startLine = lineNumberAtOffset(content, contentLines[start].start);
      return { endLine: startLine + windowSize - 1, startLine };
    }
  }

  return null;
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
