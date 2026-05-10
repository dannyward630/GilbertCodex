import { extensionFromPath } from "./fileTypeRegistry";
import { ensureFinalNewline, extractCodeFromMarkdown, markdownToBasicHtml, normalizeLineEndings } from "./markdownContent";

export function createCodeFileContent(path: string, content: string, language?: string) {
  const extension = extensionFromPath(path);
  return extractCodeFromMarkdown(content, language, extension);
}

export function createReactFileContent(path: string, content: string, title?: string) {
  if (content.trim()) {
    return extractCodeFromMarkdown(content, "tsx", extensionFromPath(path));
  }

  const componentName = createComponentName(title || path);
  return ensureFinalNewline(
    [
      "import type { FC } from \"react\";",
      "",
      `export const ${componentName}: FC = () => {`,
      "  return (",
      `    <section className="${kebabCase(componentName)}">`,
      `      <h1>${componentName}</h1>`,
      "    </section>",
      "  );",
      "};",
    ].join("\n"),
  );
}

export function createHtmlFileContent(content: string, title?: string) {
  const normalized = normalizeLineEndings(content).trim();

  if (/<!doctype\s+html/i.test(normalized) || /<html[\s>]/i.test(normalized)) {
    return ensureFinalNewline(normalized);
  }

  const body = /<[a-z][\s\S]*>/i.test(normalized) ? normalized : markdownToBasicHtml(normalized);
  const documentTitle = escapeHtml(title?.trim() || "Document");

  return ensureFinalNewline(
    [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\" />",
      "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      `  <title>${documentTitle}</title>`,
      "</head>",
      "<body>",
      indentBody(body),
      "</body>",
      "</html>",
    ].join("\n"),
  );
}

function createComponentName(value: string) {
  const baseName = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "GeneratedComponent";
  const words = baseName.match(/[a-zA-Z0-9]+/g) ?? ["Generated", "Component"];
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return /^[A-Z]/.test(name) ? name : `Generated${name}`;
}

function kebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function indentBody(value: string) {
  return value
    .split("\n")
    .map((line) => (line ? `  ${line}` : ""))
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
