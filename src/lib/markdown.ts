const FENCE_LINE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

interface FenceMatch {
  char: "`" | "~";
  length: number;
}

// Normalizes malformed pipe-table delimiter rows while leaving fenced code blocks untouched.
export function normalizeMarkdownForDisplay(content: string) {
  if (!content.includes("|")) {
    return content;
  }

  const lines = content.split(/\r\n|\n|\r/);
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

function matchFence(line: string): FenceMatch | null {
  const match = FENCE_LINE_PATTERN.exec(line);

  if (!match) {
    return null;
  }

  const marker = match[1];
  const char = marker[0];

  return char === "`" || char === "~" ? { char, length: marker.length } : null;
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
