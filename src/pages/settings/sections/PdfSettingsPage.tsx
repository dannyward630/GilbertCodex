import { BookOpen, Check, Database, FilePlus2, FileText, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MessageArtifacts } from "../../../components/chat/MessageAttachments";
import { formatAttachmentSize } from "../../../lib/chatAttachments";
import { createId, DEFAULT_PROJECT, normalizeProjectName } from "../../../lib/chatUtils";
import { loadPdfLibraryState, savePdfLibraryState } from "../../../lib/appStorage";
import { isPdfDataUrl } from "../../../lib/pdfLibrary";
import type { ChatArtifact } from "../../../types/chat";
import type { PdfLibraryRecord, PdfLibraryState } from "../../../types/pdfLibrary";
import type { ProjectSummary } from "../../../types/project";

interface PdfSettingsPageProps {
  projects: ProjectSummary[];
}

export function PdfSettingsPage({ projects }: PdfSettingsPageProps) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<PdfLibraryState>(() => loadPdfLibraryState());
  const projectNames = useMemo(() => createProjectNameList(projects), [projects]);
  const [selectedProject, setSelectedProject] = useState(() => projectNames[0] ?? DEFAULT_PROJECT);
  const [status, setStatus] = useState<string | null>(null);
  const normalizedSelectedProject = normalizeProjectName(selectedProject);
  const selectedInstruction = state.projectInstructions[normalizedSelectedProject]?.markdown ?? "";
  const enabledCount = state.records.filter((record) => record.enabledAsContext).length;
  const uploadedCount = state.records.filter((record) => record.origin === "upload").length;
  const generatedCount = state.records.filter((record) => record.origin === "ai").length;

  function commitState(nextState: PdfLibraryState, nextStatus?: string) {
    setState(nextState);
    savePdfLibraryState(nextState);
    setStatus(nextStatus ?? null);
  }

  async function handleUpload(files: FileList | null) {
    const selectedFiles = Array.from(files ?? []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

    if (selectedFiles.length === 0) {
      setStatus("Select one or more PDF files.");
      return;
    }

    const now = new Date().toISOString();
    const records = await Promise.all(
      selectedFiles.map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        const id = createId("pdf");

        return {
          createdAt: now,
          dataUrl,
          enabledAsContext: false,
          fileName: file.name || "uploaded.pdf",
          id,
          mimeType: "application/pdf",
          origin: "upload",
          project: normalizedSelectedProject,
          sizeBytes: file.size,
          title: file.name || "Uploaded PDF",
          updatedAt: now,
        } satisfies PdfLibraryRecord;
      }),
    );

    commitState(
      {
        ...state,
        records: [...records, ...state.records],
      },
      `${records.length} PDF${records.length === 1 ? "" : "s"} saved.`,
    );

    if (uploadInputRef.current) {
      uploadInputRef.current.value = "";
    }
  }

  function deleteRecord(record: PdfLibraryRecord) {
    commitState(
      {
        ...state,
        deletedSourceIds: record.sourceId ? Array.from(new Set([...state.deletedSourceIds, record.sourceId])) : state.deletedSourceIds,
        records: state.records.filter((candidate) => candidate.id !== record.id),
      },
      `${record.title} deleted.`,
    );
  }

  function patchRecord(recordId: string, patch: Partial<PdfLibraryRecord>) {
    commitState({
      ...state,
      records: state.records.map((record) =>
        record.id === recordId
          ? {
              ...record,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : record,
      ),
    });
  }

  function updateProjectInstruction(markdown: string) {
    const updatedAt = new Date().toISOString();
    commitState({
      ...state,
      projectInstructions: {
        ...state.projectInstructions,
        [normalizedSelectedProject]: {
          markdown,
          project: normalizedSelectedProject,
          updatedAt,
        },
      },
    });
  }

  function createReadmeTemplate() {
    updateProjectInstruction(
      [
        `# ${normalizedSelectedProject} PDF Instructions`,
        "",
        "## Purpose",
        "- Keep project-specific PDF context focused on this project only.",
        "",
        "## Editing Rules",
        "- Prefer exact source-backed edits.",
        "- Preserve headings, tables, and citation text.",
        "- Ask before rewriting scanned or locked PDFs without editable source text.",
      ].join("\n"),
    );
    setStatus(`${normalizedSelectedProject} README.md guidance created.`);
  }

  return (
    <>
      <div className="settings-section-heading">
        <div className="settings-section-icon" aria-hidden="true">
          <FileText size={22} />
        </div>
        <div>
          <h1>PDF</h1>
          <p>Library, context, and project guidance</p>
        </div>
      </div>

      <section className="settings-grid pdf-metrics-grid" aria-label="PDF library summary">
        <article className="settings-card pdf-metric-card">
          <span>Total PDFs</span>
          <strong>{state.records.length}</strong>
        </article>
        <article className="settings-card pdf-metric-card">
          <span>Context enabled</span>
          <strong>{enabledCount}</strong>
        </article>
        <article className="settings-card pdf-metric-card">
          <span>Uploaded</span>
          <strong>{uploadedCount}</strong>
        </article>
        <article className="settings-card pdf-metric-card">
          <span>AI made</span>
          <strong>{generatedCount}</strong>
        </article>
      </section>

      <section className="settings-card settings-card-wide">
        <div className="settings-card-heading">
          <Upload size={18} aria-hidden="true" />
          <div>
            <h2>Upload PDFs</h2>
            <p>Saved to the local app database under the selected project.</p>
          </div>
        </div>
        <div className="pdf-upload-row">
          <label className="settings-field">
            <span>Project</span>
            <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
              {projectNames.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          </label>
          <input ref={uploadInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => void handleUpload(event.currentTarget.files)} />
          <button type="button" className="settings-action-button" onClick={() => uploadInputRef.current?.click()}>
            <FilePlus2 size={16} aria-hidden="true" />
            Upload PDF
          </button>
        </div>
        {status ? <p className="settings-field-note" data-kind="ready">{status}</p> : null}
      </section>

      <section className="settings-grid pdf-library-layout">
        <article className="settings-card pdf-records-card">
          <div className="settings-card-heading">
            <Database size={18} aria-hidden="true" />
            <div>
              <h2>PDF Library</h2>
              <p>Stored PDFs, downloads, context toggles, and per-file markdown.</p>
            </div>
          </div>

          {state.records.length === 0 ? (
            <div className="pdf-empty-state">
              <FileText size={24} aria-hidden="true" />
              <strong>No PDFs yet</strong>
              <span>Upload a PDF or ask the AI to generate one.</span>
            </div>
          ) : (
            <div className="pdf-record-list">
              {state.records.map((record) => (
                <article className="pdf-record-row" key={record.id}>
                  <div className="pdf-record-header">
                    <div className="pdf-record-title">
                      <FileText size={17} aria-hidden="true" />
                      <span>
                        <strong>{record.title}</strong>
                        <small>
                          {record.project} - {record.origin === "ai" ? "AI made" : record.origin === "upload" ? "Uploaded" : "Manual"} - {formatAttachmentSize(record.sizeBytes)}
                        </small>
                      </span>
                    </div>
                    <div className="pdf-record-actions">
                      <button
                        type="button"
                        className={record.enabledAsContext ? "active" : ""}
                        title={record.enabledAsContext ? "Disable context" : "Enable context"}
                        onClick={() => patchRecord(record.id, { enabledAsContext: !record.enabledAsContext })}
                      >
                        <Check size={15} aria-hidden="true" />
                        Context
                      </button>
                      <button type="button" title="Delete PDF" onClick={() => deleteRecord(record)}>
                        <Trash2 size={15} aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                  {isPdfDataUrl(record.dataUrl) ? <MessageArtifacts artifacts={[toArtifact(record)]} /> : <p className="settings-field-note">Download bytes are not available for this PDF yet.</p>}
                  <label className="settings-field pdf-guidance-editor">
                    <span>PDF guidance markdown</span>
                    <textarea
                      value={record.guidanceMarkdown ?? ""}
                      placeholder="Add notes, edit rules, field meanings, or source caveats for this PDF."
                      onChange={(event) => patchRecord(record.id, { guidanceMarkdown: event.target.value })}
                    />
                  </label>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="settings-card pdf-project-card">
          <div className="settings-card-heading">
            <BookOpen size={18} aria-hidden="true" />
            <div>
              <h2>Project Instructions</h2>
              <p>Markdown guidance scoped to one project.</p>
            </div>
          </div>
          <div className="pdf-project-list" role="listbox" aria-label="Projects">
            {projectNames.map((project) => (
              <button
                type="button"
                className={normalizeProjectName(project) === normalizedSelectedProject ? "active" : ""}
                key={project}
                onClick={() => setSelectedProject(project)}
              >
                {project}
              </button>
            ))}
          </div>
          <label className="settings-field settings-field-tall">
            <span>{normalizedSelectedProject} README.md</span>
            <textarea
              value={selectedInstruction}
              placeholder="Project-specific PDF instructions for the AI."
              onChange={(event) => updateProjectInstruction(event.target.value)}
            />
          </label>
          <button type="button" className="settings-action-button" onClick={createReadmeTemplate}>
            <BookOpen size={16} aria-hidden="true" />
            Create README.md
          </button>
        </article>
      </section>
    </>
  );
}

function createProjectNameList(projects: ProjectSummary[]) {
  const names = [DEFAULT_PROJECT, ...projects.map((project) => normalizeProjectName(project.name))].filter(Boolean);
  return Array.from(new Set(names));
}

function toArtifact(record: PdfLibraryRecord): ChatArtifact {
  return {
    detail: `${record.origin === "ai" ? "AI-made" : "Uploaded"} PDF - ${formatAttachmentSize(record.sizeBytes)}`,
    id: record.id,
    kind: "document",
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    sourceFormat: record.sourceFormat,
    sourceText: record.sourceText,
    title: record.fileName || record.title,
    url: record.dataUrl,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Could not read this PDF."));
    });
    reader.addEventListener("error", () => reject(new Error("Could not read this PDF.")));
    reader.addEventListener("abort", () => reject(new Error("Could not read this PDF.")));
    reader.readAsDataURL(file);
  });
}
