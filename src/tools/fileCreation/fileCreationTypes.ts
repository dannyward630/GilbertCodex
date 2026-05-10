import type { ComputerFileIndexSummary, ComputerWriteFileResult } from "../../types/localWorkspace";

export type FileCreationToolName =
  | "create_code_file"
  | "create_files"
  | "create_html_file"
  | "create_markdown_file"
  | "create_pdf_file"
  | "create_react_file"
  | "create_text_file";

export type FileCreationKind =
  | "code"
  | "html"
  | "markdown"
  | "pdf"
  | "react"
  | "text";

export interface FileCreationToolCall {
  args: Record<string, string>;
  tool: FileCreationToolName;
}

export interface PreparedFileCreationWrite {
  content: string;
  createParentDirs: boolean;
  duplicateStrategy: "fail" | "increment" | "skip";
  extension: string;
  generatedFromMarkdown: boolean;
  kind: FileCreationKind;
  language?: string;
  lineCount: number;
  markdownAware: boolean;
  mimeType: string;
  overwrite: boolean;
  path: string;
  preview: string;
  title?: string;
}

export interface FileCreationWriteResult extends PreparedFileCreationWrite {
  write: ComputerWriteFileResult;
}

export interface FileCreationExecutionSummary {
  indexSummary?: ComputerFileIndexSummary;
  results: FileCreationWriteResult[];
}

export const FILE_CREATION_TOOL_NAMES = new Set<FileCreationToolName>([
  "create_code_file",
  "create_files",
  "create_html_file",
  "create_markdown_file",
  "create_pdf_file",
  "create_react_file",
  "create_text_file",
]);

export function isFileCreationToolName(value: string): value is FileCreationToolName {
  return FILE_CREATION_TOOL_NAMES.has(value as FileCreationToolName);
}
