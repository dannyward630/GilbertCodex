export type PdfLibraryOrigin = "ai" | "manual" | "upload";

export type PdfLibrarySourceFormat = "markdown" | "text";

export interface PdfLibraryRecord {
  chatId?: string;
  createdAt: string;
  dataUrl?: string;
  enabledAsContext: boolean;
  fileName: string;
  guidanceMarkdown?: string;
  id: string;
  messageId?: string;
  mimeType: string;
  origin: PdfLibraryOrigin;
  project: string;
  sizeBytes: number;
  sourceFormat?: PdfLibrarySourceFormat;
  sourceId?: string;
  sourceText?: string;
  title: string;
  updatedAt: string;
}

export interface PdfProjectInstruction {
  markdown: string;
  project: string;
  updatedAt: string;
}

export interface PdfLibraryState {
  deletedSourceIds: string[];
  projectInstructions: Record<string, PdfProjectInstruction>;
  records: PdfLibraryRecord[];
}
