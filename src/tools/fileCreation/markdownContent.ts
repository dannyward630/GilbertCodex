import { isCodeFenceLanguageMatch } from "./fileTypeRegistry";

export function normalizeMarkdownDocument(content: string, title?: string) {
  const normalized = normalizeLineEndings(content).trim();
  const heading = title?.trim();

  if (!heading || startsWithMarkdownHeading(normalized)) {
    return ensureFinalNewline(normalized);
  }

  return ensureFinalNewline(`# ${heading}\n\n${normalized}`);
}

export function normalizeTextDocument(content: string, title?: string) {
  const normalized = normalizeLineEndings(content).trim();
  const heading = title?.trim();

  if (!heading) {
    return ensureFinalNewline(normalized);
  }

  return ensureFinalNewline(`${heading}\n${"=".repeat(Math.min(Math.max(heading.length, 3), 80))}\n\n${normalized}`);
}

export function extractCodeFromMarkdown(content: string, language?: string, extension?: string) {
  const normalized = normalizeLineEndings(content).trim();
  const fences = Array.from(normalized.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)).map((match) => ({
    code: match[2].replace(/^\n+|\n+$/g, ""),
    language: match[1].trim().split(/\s+/)[0],
  }));

  if (fences.length === 0) {
    return ensureFinalNewline(normalized);
  }

  const matchingFence = fences.find((fence) => isCodeFenceLanguageMatch(fence.language, language, extension));
  return ensureFinalNewline((matchingFence ?? fences[0]).code);
}

export function markdownToBasicHtml(markdown: string) {
  const lines = normalizeLineEndings(markdown).split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  function closeCode() {
    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      inCode = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      if (inCode) {
        closeCode();
      } else {
        closeList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(line.trim())}</p>`);
  }

  closeCode();
  closeList();
  return html.join("\n");
}

export function stripMarkdownForPdf(markdown: string) {
  const lines = normalizeLineEndings(markdown).split("\n");
  const result: string[] = [];
  let inCode = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      result.push("");
      continue;
    }

    if (inCode) {
      result.push(`    ${line}`);
      continue;
    }

    result.push(
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "| ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    );
  }

  return result.join("\n");
}

export function normalizeLineEndings(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function ensureFinalNewline(content: string) {
  return content.replace(/\s+$/g, "") + "\n";
}

function startsWithMarkdownHeading(content: string) {
  return /^#{1,6}\s+\S/.test(content.trimStart());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
