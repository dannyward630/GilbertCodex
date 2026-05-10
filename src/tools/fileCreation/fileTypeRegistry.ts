import type { FileCreationKind, FileCreationToolName } from "./fileCreationTypes";

export interface FileTypeProfile {
  defaultExtension: string;
  kind: FileCreationKind;
  language?: string;
  mimeType: string;
}

const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  astro: "astro",
  bash: "sh",
  c: "c",
  clojure: "clj",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  dart: "dart",
  elixir: "ex",
  go: "go",
  graphql: "graphql",
  groovy: "groovy",
  html: "html",
  java: "java",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  kt: "kt",
  lua: "lua",
  markdown: "md",
  md: "md",
  php: "php",
  powershell: "ps1",
  python: "py",
  py: "py",
  r: "r",
  react: "tsx",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  scss: "scss",
  shell: "sh",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yml",
};

const EXTENSION_MIME_MAP: Record<string, string> = {
  c: "text/x-c",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  css: "text/css",
  csv: "text/csv",
  go: "text/x-golang",
  html: "text/html",
  java: "text/x-java",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/javascript",
  kt: "text/x-kotlin",
  md: "text/markdown",
  pdf: "application/pdf",
  php: "text/x-php",
  ps1: "text/x-powershell",
  py: "text/x-python",
  rb: "text/x-ruby",
  rs: "text/x-rust",
  sh: "application/x-sh",
  ts: "application/typescript",
  tsx: "application/typescript",
  txt: "text/plain",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
};

export function profileForTool(tool: FileCreationToolName, language?: string): FileTypeProfile {
  switch (tool) {
    case "create_text_file":
      return { defaultExtension: "txt", kind: "text", mimeType: "text/plain" };
    case "create_markdown_file":
      return { defaultExtension: "md", kind: "markdown", language: "markdown", mimeType: "text/markdown" };
    case "create_react_file":
      return { defaultExtension: "tsx", kind: "react", language: "react", mimeType: "application/typescript" };
    case "create_html_file":
      return { defaultExtension: "html", kind: "html", language: "html", mimeType: "text/html" };
    case "create_pdf_file":
      return { defaultExtension: "pdf", kind: "pdf", mimeType: "application/pdf" };
    case "create_code_file": {
      const extension = extensionForLanguage(language) ?? "txt";
      return {
        defaultExtension: extension,
        kind: "code",
        language: normalizeLanguage(language) ?? extension,
        mimeType: mimeTypeForExtension(extension),
      };
    }
    case "create_files":
      return { defaultExtension: "txt", kind: "text", mimeType: "text/plain" };
  }
}

export function extensionForLanguage(language?: string) {
  const normalized = normalizeLanguage(language);
  return normalized ? LANGUAGE_EXTENSION_MAP[normalized] : undefined;
}

export function normalizeLanguage(language?: string) {
  const normalized = language?.trim().replace(/^\.*/, "").toLowerCase();
  return normalized || undefined;
}

export function mimeTypeForExtension(extension: string) {
  return EXTENSION_MIME_MAP[extension.toLowerCase()] ?? "text/plain";
}

export function extensionFromPath(path: string) {
  const name = path.split(/[\\/]/).pop() ?? path;
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

export function ensurePathExtension(path: string, extension: string) {
  if (extensionFromPath(path)) {
    return path;
  }

  const suffix = extension.startsWith(".") ? extension : `.${extension}`;
  return `${path}${suffix}`;
}

export function inferKindFromExtension(extension: string): FileCreationKind {
  const normalized = extension.toLowerCase();

  if (normalized === "md" || normalized === "mdx") {
    return "markdown";
  }

  if (normalized === "html" || normalized === "htm") {
    return "html";
  }

  if (normalized === "pdf") {
    return "pdf";
  }

  if (normalized === "tsx" || normalized === "jsx") {
    return "react";
  }

  if (normalized === "txt") {
    return "text";
  }

  return "code";
}

export function isCodeFenceLanguageMatch(fenceLanguage: string, language?: string, extension?: string) {
  const normalizedFence = normalizeLanguage(fenceLanguage);
  const normalizedLanguage = normalizeLanguage(language);
  const normalizedExtension = normalizeLanguage(extension);

  if (!normalizedFence) {
    return false;
  }

  return normalizedFence === normalizedLanguage || normalizedFence === normalizedExtension || extensionForLanguage(normalizedFence) === normalizedExtension;
}
