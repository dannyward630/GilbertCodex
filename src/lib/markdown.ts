const FENCE_LINE_PATTERN = /^(\s{0,3})(`{3,}|~{3,})([^\r\n]*)$/;
const WHOLE_MESSAGE_FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*?)\r?\n\s{0,3}\1[ \t]*\s*$/i;
const PROSE_FENCE_LANGUAGES = new Set(["markdown", "md", "text", "txt"]);
const LOG_FENCE_LANGUAGES = new Set(["bash", "bat", "cmd", "console", "diff", "log", "logs", "output", "powershell", "ps", "ps1", "sh", "shell", "terminal", "zsh"]);

interface FenceMatch {
  char: "`" | "~";
  indent: string;
  info: string;
  language: string;
  length: number;
}

interface MarkdownDisplayOptions {
  final?: boolean;
}

// Normalizes display Markdown while leaving real code fences untouched.
export function normalizeMarkdownForDisplay(content: string, options: MarkdownDisplayOptions = {}) {
  const final = options.final ?? true;
  const displayContent = repairMalformedMarkdownFences(unwrapUnclosedWholeMessageTextFence(unwrapWholeMessageTextFence(content)), { final });

  if (!displayContent.includes("|")) {
    return displayContent;
  }

  const lines = displayContent.split(/\r\n|\n|\r/);
  const normalizedLines: string[] = [];
  let openFence: FenceMatch | null = null;

  for (const line of lines) {
    const fence = matchFence(line);

    if (fence) {
      normalizedLines.push(line);
      openFence = openFence && fence.char === openFence.char && fence.length >= openFence.length ? null : openFence ?? fence;
      continue;
    }

    if (openFence) {
      normalizedLines.push(line);
      continue;
    }

    const previousLine = normalizedLines[normalizedLines.length - 1];
    const headerCells = previousLine ? getPipeRowCells(previousLine) : null;
    const delimiterCells = getPipeDelimiterCells(line);

    if (headerCells && delimiterCells && shouldNormalizeDelimiter(headerCells.length, delimiterCells)) {
      normalizedLines.push(formatPipeDelimiterLine(line, headerCells.length, delimiterCells));
    } else {
      normalizedLines.push(line);
    }
  }

  return normalizedLines.join("\n");
}

export function unwrapWholeMessageTextFence(content: string) {
  const match = WHOLE_MESSAGE_FENCE_PATTERN.exec(content);

  if (!match) {
    return content;
  }

  const language = getFenceLanguage(match[2] ?? "");
  const body = match[3];

  if (shouldUnwrapWholeMessageFence(body, language)) {
    return body;
  }

  return content;
}

function unwrapUnclosedWholeMessageTextFence(content: string) {
  const match = /^\s{0,3}(`{3,}|~{3,})[ \t]*([^\r\n]*)\r?\n([\s\S]*)$/i.exec(content);

  if (!match) {
    return content;
  }

  const marker = match[1] ?? "";
  const language = getFenceLanguage(match[2] ?? "");
  const body = match[3] ?? "";
  const closingFencePattern = new RegExp(`^\\s{0,3}${escapeRegExp(marker[0] ?? "`")}{${marker.length},}\\s*$`, "m");

  if (closingFencePattern.test(body)) {
    return content;
  }

  if (isCodeFenceLanguage(language) && body.split(/\r?\n/).some((line) => looksLikeCodeLine(line.trim()))) {
    return content;
  }

  return shouldUnwrapWholeMessageFence(body, language) ? body : content;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repairMalformedMarkdownFences(content: string, options: Required<MarkdownDisplayOptions>) {
  const lines = content.split(/\r\n|\n|\r/);
  const normalizedLines: string[] = [];
  let openFence: (FenceMatch & { bodyLines: string[] }) | null = null;

  for (const line of lines) {
    const fence = matchFence(line);

    if (!openFence) {
      normalizedLines.push(line);

      if (fence) {
        openFence = { ...fence, bodyLines: [] };
      }
      continue;
    }

    if (fence && fence.char === openFence.char && fence.length >= openFence.length && isClosingFenceLine(fence)) {
      normalizedLines.push(line);
      openFence = null;
      continue;
    }

    if (isMalformedClosingFenceLine(line, openFence)) {
      normalizedLines.push(`${openFence.indent}${openFence.char.repeat(openFence.length)}`);
      openFence = null;
      continue;
    }

    if (fence && shouldCloseFenceBeforeNewFence(fence, openFence)) {
      normalizedLines.push(`${openFence.indent}${openFence.char.repeat(openFence.length)}`);
      openFence = null;
      normalizedLines.push(line);

      if (!isClosingFenceLine(fence)) {
        openFence = { ...fence, bodyLines: [] };
      }
      continue;
    }

    if (shouldCloseFenceBeforeLine(line, openFence)) {
      normalizedLines.push(`${openFence.indent}${openFence.char.repeat(openFence.length)}`);
      openFence = null;
      normalizedLines.push(line);

      if (fence) {
        openFence = { ...fence, bodyLines: [] };
      }
      continue;
    }

    normalizedLines.push(line);
    openFence.bodyLines.push(line);
  }

  if (options.final && openFence && shouldCloseUnclosedFenceAtEnd(openFence)) {
    normalizedLines.push(`${openFence.indent}${openFence.char.repeat(openFence.length)}`);
  }

  return normalizedLines.join("\n");
}

function shouldUnwrapWholeMessageFence(body: string, language: string) {
  const trimmed = body.trim();

  if (!trimmed) {
    return false;
  }

  if (looksLikeStandaloneJson(trimmed) || looksLikeStandaloneCode(trimmed) || looksLikeTerminalOutputOrDiff(trimmed)) {
    return false;
  }

  if (PROSE_FENCE_LANGUAGES.has(language)) {
    return true;
  }

  return looksLikeProseAnswer(trimmed);
}

function looksLikeStandaloneCode(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const codeLikeLines = lines.filter((line) =>
    looksLikeCodeLine(line) ||
    /^(?:import|export|const|let|var|function|class|interface|type|return|if|for|while|switch|try|catch)\b/.test(line) ||
    /^(?:\{|\}|\[|\]|<\/?\w|[.#][\w-]+\s*\{)/.test(line) ||
    /[;{}]\s*$/.test(line),
  ).length;
  const requiredCodeLines = lines.length <= 2 ? 1 : Math.max(2, Math.ceil(lines.length * 0.45));

  return codeLikeLines >= requiredCodeLines;
}

function looksLikeStandaloneJson(value: string) {
  if (!/^\s*[\[{]/.test(value) || !/[\]}]\s*$/.test(value)) {
    return false;
  }

  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeTerminalOutputOrDiff(value: string) {
  const lines = value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);

  if (lines.length === 0) {
    return false;
  }

  if (/^(?:diff --git|@@\s|Index: |\+\+\+ |--- )/m.test(value)) {
    return true;
  }

  const logLikeLines = lines.filter((line) =>
    /^(?:PS [^>]+>|[$>] |[A-Z]:\\|npm (?:ERR!|WARN|notice)|error TS\d+|Exit code:|Command:|Shell:|Working directory:|at \S+\s+\(|\[\d{2}:\d{2}:\d{2})/i.test(line),
  ).length;

  return logLikeLines >= Math.max(2, Math.ceil(lines.length * 0.45));
}

function looksLikeProseAnswer(value: string) {
  return (
    /^#{1,6}\s+\S/m.test(value) ||
    /(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S/.test(value) ||
    /\b(?:answer|changed|fixed|goal|here is|implemented|summary|the issue|updated|verification|what changed)\b/i.test(value) ||
    (value.split(/\s+/).length >= 12 && value.split(/\r?\n/).some(isSentenceLikeProseLine))
  );
}

function isSentenceLikeProseLine(line: string) {
  const trimmed = line.trim();

  return /^[A-Z][^{}\[\];<>]*[.!?:]$/.test(trimmed) && trimmed.split(/\s+/).length >= 5 && !looksLikeCodeLine(trimmed);
}

function looksLikeCodeLine(line: string) {
  return (
    /^(?:import|export|const|let|var|function|class|interface|type|return|if|for|while|switch|try|catch|else|case|break|continue|await|async)\b/.test(line) ||
    /^(?:\/\/|\/\*|\*\/|\* |#include\b|using\b|namespace\b)/.test(line) ||
    /^(?:\{|\}|\[|\]|<\/?\w|[.#][\w-]+\s*\{)/.test(line) ||
    /(?:=>|===?|!==?|&&|\|\||[;{}]\s*$)/.test(line)
  );
}

function matchFence(line: string): FenceMatch | null {
  const match = FENCE_LINE_PATTERN.exec(line);

  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const marker = match[2] ?? "";
  const info = match[3]?.trim() ?? "";
  const char = marker[0];

  return char === "`" || char === "~" ? { char, indent, info, language: getFenceLanguage(info), length: marker.length } : null;
}

function getFenceLanguage(info: string) {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function isClosingFenceLine(fence: FenceMatch) {
  return fence.info.length === 0;
}

function isMalformedClosingFenceLine(line: string, openFence: FenceMatch) {
  const trimmed = line.trim();

  return (
    openFence.length === 3 &&
    trimmed === openFence.char.repeat(2)
  );
}

function shouldCloseFenceBeforeLine(line: string, openFence: FenceMatch & { bodyLines: string[] }) {
  const trimmed = line.trim();

  if (!trimmed || LOG_FENCE_LANGUAGES.has(openFence.language) || looksLikeCodeLine(trimmed)) {
    return false;
  }

  if (!isClearlyProseContinuation(trimmed)) {
    return false;
  }

  return isCodeFenceLanguage(openFence.language) || openFence.bodyLines.some((bodyLine) => looksLikeCodeLine(bodyLine.trim()));
}

function shouldCloseFenceBeforeNewFence(fence: FenceMatch, openFence: FenceMatch & { bodyLines: string[] }) {
  if (isClosingFenceLine(fence) || LOG_FENCE_LANGUAGES.has(openFence.language)) {
    return false;
  }

  const body = openFence.bodyLines.join("\n").trim();

  if (!body) {
    return false;
  }

  return isCodeFenceLanguage(openFence.language) || looksLikeStandaloneCode(body);
}

function shouldCloseUnclosedFenceAtEnd(openFence: FenceMatch & { bodyLines: string[] }) {
  if (LOG_FENCE_LANGUAGES.has(openFence.language)) {
    return false;
  }

  const body = openFence.bodyLines.join("\n").trim();
  return Boolean(body && (isCodeFenceLanguage(openFence.language) || looksLikeStandaloneCode(body)));
}

function isClearlyProseContinuation(line: string) {
  return (
    /^#{1,6}\s+\S/.test(line) ||
    /^(?:[-*]|\d+\.)\s+\S/.test(line) ||
    /^(?:Examples?|Risks?|Verification|Summary|What changed|The issue|That means|This means|So\b|The\b|This\b|Here\b|I\b|We\b)/i.test(line) ||
    isSentenceLikeProseLine(line)
  );
}

function isCodeFenceLanguage(language: string) {
  return Boolean(language && !PROSE_FENCE_LANGUAGES.has(language) && !LOG_FENCE_LANGUAGES.has(language));
}

function getPipeDelimiterCells(line: string) {
  const cells = getPipeRowCells(line, 1);

  if (!cells || !cells.every(isPipeDelimiterCell)) {
    return null;
  }

  return cells;
}

function getPipeRowCells(line: string, minimumCells = 2) {
  const trimmed = line.trim();

  if (!trimmed.includes("|")) {
    return null;
  }

  const cells = splitUnescapedPipes(trimmed);

  if (trimmed.startsWith("|")) {
    cells.shift();
  }

  if (trimmed.endsWith("|") && !isEscapedPipe(trimmed, trimmed.length - 1)) {
    cells.pop();
  }

  const normalizedCells = cells.map((cell) => cell.trim());

  return normalizedCells.length >= minimumCells ? normalizedCells : null;
}

function splitUnescapedPipes(value: string) {
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "|" && !isEscapedPipe(value, index)) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current);
  return cells;
}

function isEscapedPipe(value: string, pipeIndex: number) {
  let backslashCount = 0;

  for (let index = pipeIndex - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function isPipeDelimiterCell(cell: string) {
  return /^:?-{1,}:?$/.test(cell.replace(/\s+/g, ""));
}

function shouldNormalizeDelimiter(headerColumnCount: number, delimiterCells: string[]) {
  return delimiterCells.length < headerColumnCount || delimiterCells.some((cell) => cell.replace(/[\s:]/g, "").length < 3);
}

function formatPipeDelimiterLine(line: string, columnCount: number, delimiterCells: string[]) {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const cells = Array.from({ length: columnCount }, (_, index) => normalizePipeDelimiterCell(delimiterCells[index] ?? "---"));

  return `${indent}| ${cells.join(" | ")} |`;
}

function normalizePipeDelimiterCell(cell: string) {
  const compact = cell.replace(/\s+/g, "");
  const leftAligned = compact.startsWith(":");
  const rightAligned = compact.endsWith(":");

  return `${leftAligned ? ":" : ""}---${rightAligned ? ":" : ""}`;
}
