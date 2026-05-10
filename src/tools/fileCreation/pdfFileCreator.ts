import { stripMarkdownForPdf } from "./markdownContent";

interface PdfLine {
  font: "F1" | "F2" | "F3";
  size: number;
  text: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BOTTOM_MARGIN = 54;
const DEFAULT_FONT_SIZE = 11;
const LINE_GAP = 5;

export function createPdfFileContent(markdown: string, title?: string) {
  const lines = createPdfLines(markdown, title);
  const pages = paginatePdfLines(lines);
  return buildPdfDocument(pages);
}

function createPdfLines(markdown: string, title?: string): PdfLine[] {
  const source = stripMarkdownForPdf(markdown).split("\n");
  const lines: PdfLine[] = [];
  const titleText = title?.trim();

  if (titleText) {
    lines.push(...wrapPdfText(titleText, "F2", 20));
    lines.push({ font: "F1", size: 8, text: "" });
  }

  for (const rawLine of source) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      lines.push({ font: "F1", size: DEFAULT_FONT_SIZE, text: "" });
      continue;
    }

    const isCode = /^\s{4}/.test(rawLine);
    const isRule = /^-{3,}$/.test(line.trim());
    const font = isCode ? "F3" : "F1";
    const size = isCode ? 9 : DEFAULT_FONT_SIZE;
    const text = isRule ? "----------------------------------------" : line.trim();
    lines.push(...wrapPdfText(text, font, size));
  }

  return lines.length > 0 ? lines : [{ font: "F1", size: DEFAULT_FONT_SIZE, text: " " }];
}

function wrapPdfText(text: string, font: PdfLine["font"], size: number) {
  const safeText = sanitizePdfText(text);
  const maxChars = Math.max(24, Math.floor((PAGE_WIDTH - MARGIN * 2) / (size * 0.52)));
  const words = safeText.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [{ font, size, text: "" }];
  }

  const lines: PdfLine[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxChars && current) {
      lines.push({ font, size, text: current });
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push({ font, size, text: current });
  }

  return lines;
}

function paginatePdfLines(lines: PdfLine[]) {
  const pages: PdfLine[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    const lineHeight = line.size + LINE_GAP;

    if (y - lineHeight < BOTTOM_MARGIN && pages[pages.length - 1].length > 0) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }

    pages[pages.length - 1].push(line);
    y -= lineHeight;
  }

  return pages;
}

function buildPdfDocument(pages: PdfLine[][]) {
  const objects = new Map<number, string>();
  const pageRefs = pages.map((_, index) => 6 + index * 2);

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageRefs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objects.set(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");

  pages.forEach((page, index) => {
    const pageId = 6 + index * 2;
    const contentId = pageId + 1;
    const stream = createPageStream(page);

    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  return serializePdfObjects(objects);
}

function createPageStream(lines: PdfLine[]) {
  let y = PAGE_HEIGHT - MARGIN;
  const operators: string[] = [];

  for (const line of lines) {
    if (line.text) {
      operators.push("BT");
      operators.push(`/${line.font} ${line.size} Tf`);
      operators.push(`${MARGIN} ${y.toFixed(2)} Td`);
      operators.push(`(${escapePdfString(line.text)}) Tj`);
      operators.push("ET");
    }

    y -= line.size + LINE_GAP;
  }

  return operators.join("\n");
}

function serializePdfObjects(objects: Map<number, string>) {
  const maxObjectId = Math.max(...objects.keys());
  let output = "%PDF-1.4\n% Gilbert Codex PDF\n";
  const offsets: number[] = [0];

  for (let id = 1; id <= maxObjectId; id += 1) {
    const object = objects.get(id);

    if (!object) {
      throw new Error(`Missing PDF object ${id}.`);
    }

    offsets[id] = output.length;
    output += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = output.length;
  output += `xref\n0 ${maxObjectId + 1}\n`;
  output += "0000000000 65535 f \n";

  for (let id = 1; id <= maxObjectId; id += 1) {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

function sanitizePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
}

function escapePdfString(value: string) {
  return sanitizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}
