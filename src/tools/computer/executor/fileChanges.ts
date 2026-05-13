import type { ChatToolCall } from "../../../types/chat";
const MAX_FILE_CHANGE_DIFF_LINES = 80;

export function createFileChangeSummary(
  path: string,
  beforeContent: string | undefined,
  afterContent: string | undefined,
  kind: NonNullable<ChatToolCall["fileChanges"]>[number]["kind"] = beforeContent === undefined ? "create" : "update",
): NonNullable<ChatToolCall["fileChanges"]>[number] | undefined {
  if (beforeContent === undefined && afterContent === undefined) {
    return undefined;
  }

  const { additions, deletions } = countLineChanges(beforeContent ?? "", afterContent ?? "");
  const diffPreview = createFileChangeDiffPreview(beforeContent ?? "", afterContent ?? "");

  return {
    additions,
    deletions,
    diffPreview: diffPreview.lines,
    diffTruncated: diffPreview.truncated,
    kind,
    path,
  };
}

function createFileChangeDiffPreview(beforeContent: string, afterContent: string): {
  lines?: NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>;
  truncated?: boolean;
} {
  if (beforeContent === afterContent) {
    return {};
  }

  const beforeLines = splitComparableLines(beforeContent);
  const afterLines = splitComparableLines(afterContent);

  if (beforeLines.length === 0 && afterLines.length === 0) {
    return {};
  }

  const matrixCells = beforeLines.length * afterLines.length;
  const diffLines = matrixCells > 250_000
    ? createWindowedFileDiffPreview(beforeLines, afterLines)
    : createLcsFileDiffPreview(beforeLines, afterLines);
  const limited = limitFileChangeDiffLines(diffLines);

  return {
    lines: limited.lines.length > 0 ? limited.lines : undefined,
    truncated: limited.truncated || undefined,
  };
}

function createLcsFileDiffPreview(beforeLines: string[], afterLines: string[]) {
  type DiffLine = NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number];
  const matrix: number[][] = Array.from({ length: beforeLines.length + 1 }, () => new Array(afterLines.length + 1).fill(0));

  for (let oldIndex = 1; oldIndex <= beforeLines.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= afterLines.length; newIndex += 1) {
      matrix[oldIndex][newIndex] = beforeLines[oldIndex - 1] === afterLines[newIndex - 1]
        ? matrix[oldIndex - 1][newIndex - 1] + 1
        : Math.max(matrix[oldIndex - 1][newIndex], matrix[oldIndex][newIndex - 1]);
    }
  }

  const lines: DiffLine[] = [];
  let oldIndex = beforeLines.length;
  let newIndex = afterLines.length;

  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && beforeLines[oldIndex - 1] === afterLines[newIndex - 1]) {
      lines.push({
        content: beforeLines[oldIndex - 1],
        kind: "context",
        newLine: newIndex,
        oldLine: oldIndex,
      });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (newIndex > 0 && (oldIndex === 0 || matrix[oldIndex][newIndex - 1] >= matrix[oldIndex - 1][newIndex])) {
      lines.push({
        content: afterLines[newIndex - 1],
        kind: "add",
        newLine: newIndex,
      });
      newIndex -= 1;
    } else if (oldIndex > 0) {
      lines.push({
        content: beforeLines[oldIndex - 1],
        kind: "remove",
        oldLine: oldIndex,
      });
      oldIndex -= 1;
    }
  }

  return lines.reverse();
}

function createWindowedFileDiffPreview(beforeLines: string[], afterLines: string[]) {
  type DiffLine = NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number];
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length
    && prefixLength < afterLines.length
    && beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength
    && suffixLength < afterLines.length - prefixLength
    && beforeLines[beforeLines.length - 1 - suffixLength] === afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const lines: DiffLine[] = [];
  const contextBeforeStart = Math.max(0, prefixLength - 3);
  const beforeChangeEnd = beforeLines.length - suffixLength;
  const afterChangeEnd = afterLines.length - suffixLength;

  for (let index = contextBeforeStart; index < prefixLength; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "context",
      newLine: index + 1,
      oldLine: index + 1,
    });
  }

  for (let index = prefixLength; index < beforeChangeEnd; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "remove",
      oldLine: index + 1,
    });
  }

  for (let index = prefixLength; index < afterChangeEnd; index += 1) {
    lines.push({
      content: afterLines[index],
      kind: "add",
      newLine: index + 1,
    });
  }

  const contextAfterEnd = Math.min(beforeLines.length, beforeChangeEnd + 3);
  for (let index = beforeChangeEnd; index < contextAfterEnd; index += 1) {
    lines.push({
      content: beforeLines[index],
      kind: "context",
      newLine: index + 1 + (afterLines.length - beforeLines.length),
      oldLine: index + 1,
    });
  }

  return lines;
}

function limitFileChangeDiffLines(lines: NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>) {
  if (lines.length <= MAX_FILE_CHANGE_DIFF_LINES) {
    return {
      lines,
      truncated: false,
    };
  }

  const headCount = Math.floor(MAX_FILE_CHANGE_DIFF_LINES * 0.58);
  const tailCount = MAX_FILE_CHANGE_DIFF_LINES - headCount - 1;
  const omittedCount = lines.length - headCount - tailCount;

  return {
    lines: [
      ...lines.slice(0, headCount),
      {
        content: `${omittedCount} diff lines hidden in Activity`,
        kind: "meta" as const,
      },
      ...lines.slice(-tailCount),
    ],
    truncated: true,
  };
}

function countLineChanges(beforeContent: string, afterContent: string) {
  const beforeLines = splitComparableLines(beforeContent);
  const afterLines = splitComparableLines(afterContent);

  if (beforeLines.length === 0) {
    return { additions: afterLines.length, deletions: 0 };
  }

  if (afterLines.length === 0) {
    return { additions: 0, deletions: beforeLines.length };
  }

  const matrixCells = beforeLines.length * afterLines.length;
  if (matrixCells > 250_000) {
    return countLineChangesByWindow(beforeLines, afterLines);
  }

  let previous = new Array(afterLines.length + 1).fill(0);
  let current = new Array(afterLines.length + 1).fill(0);

  for (let oldIndex = 1; oldIndex <= beforeLines.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= afterLines.length; newIndex += 1) {
      current[newIndex] = beforeLines[oldIndex - 1] === afterLines[newIndex - 1]
        ? previous[newIndex - 1] + 1
        : Math.max(previous[newIndex], current[newIndex - 1]);
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  const commonLines = previous[afterLines.length];
  return {
    additions: Math.max(0, afterLines.length - commonLines),
    deletions: Math.max(0, beforeLines.length - commonLines),
  };
}

function countLineChangesByWindow(beforeLines: string[], afterLines: string[]) {
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length
    && prefixLength < afterLines.length
    && beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeLines.length - prefixLength
    && suffixLength < afterLines.length - prefixLength
    && beforeLines[beforeLines.length - 1 - suffixLength] === afterLines[afterLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    additions: Math.max(0, afterLines.length - prefixLength - suffixLength),
    deletions: Math.max(0, beforeLines.length - prefixLength - suffixLength),
  };
}

function splitComparableLines(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingLineBreak = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutTrailingLineBreak ? withoutTrailingLineBreak.split("\n") : [];
}
