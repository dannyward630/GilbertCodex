import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { DialogShell } from "../dialogs/AppDialog";
import { ensureEditableProjectRunConfig, getSelectedProjectRunAction, saveProjectRunAction } from "../../lib/projectRunConfig";
import { getAvailableTerminalShells, terminalShellLabel } from "../../lib/terminalShells";
import type { ProjectRunAction, ProjectRunActionKind, ProjectRunConfig } from "../../types/projectRun";
import type { TerminalShellId } from "../../types/terminal";

interface ProjectRunDialogProps {
  config?: ProjectRunConfig;
  onClose: () => void;
  onSave: (config: ProjectRunConfig) => void;
  onSaveAndRun: (config: ProjectRunConfig, action: ProjectRunAction) => void | Promise<void>;
  open: boolean;
  projectName: string;
  projectRoot?: string;
}

const RUN_ACTION_KINDS: ProjectRunActionKind[] = ["dev-server", "setup", "test", "build", "custom"];

export function ProjectRunDialog({
  config,
  onClose,
  onSave,
  onSaveAndRun,
  open,
  projectName,
  projectRoot,
}: ProjectRunDialogProps) {
  const normalizedConfig = useMemo(() => ensureEditableProjectRunConfig(config, projectRoot), [config, projectRoot]);
  const initialAction = useMemo(() => getSelectedProjectRunAction(normalizedConfig), [normalizedConfig]);
  const [selectedActionId, setSelectedActionId] = useState(initialAction?.id ?? "");
  const [draftAction, setDraftAction] = useState<ProjectRunAction | undefined>(initialAction);
  const shells = useMemo(() => getAvailableTerminalShells(), []);
  const runError = getRunError(draftAction, projectRoot);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextConfig = ensureEditableProjectRunConfig(config, projectRoot);
    const nextAction = getSelectedProjectRunAction(nextConfig);
    setSelectedActionId(nextAction?.id ?? "");
    setDraftAction(nextAction);
  }, [config, open, projectRoot]);

  function handleActionSelect(actionId: string) {
    const nextAction = normalizedConfig.actions.find((action) => action.id === actionId) ?? normalizedConfig.actions[0];
    setSelectedActionId(nextAction?.id ?? "");
    setDraftAction(nextAction);
  }

  function updateDraftAction(patch: Partial<ProjectRunAction>) {
    setDraftAction((current) => {
      const base = current ?? getSelectedProjectRunAction(normalizedConfig);

      if (!base) {
        return base;
      }

      const nextKind = patch.kind ?? base.kind;
      return {
        ...base,
        ...patch,
        background: patch.background ?? (patch.kind && base.kind !== patch.kind ? nextKind === "dev-server" : base.background),
      };
    });
  }

  function buildNextConfig() {
    if (!draftAction) {
      return normalizedConfig;
    }

    return saveProjectRunAction(normalizedConfig, {
      ...draftAction,
      cwd: draftAction.cwd?.trim() || projectRoot,
    });
  }

  function handleSave(event?: FormEvent) {
    event?.preventDefault();
    onSave(buildNextConfig());
  }

  async function handleSaveAndRun() {
    if (!draftAction || runError) {
      return;
    }

    const nextConfig = buildNextConfig();
    const nextAction = getSelectedProjectRunAction(nextConfig) ?? draftAction;
    await onSaveAndRun(nextConfig, nextAction);
  }

  return (
    <DialogShell
      description="Tell Gilbert how to install dependencies and start your app."
      icon={Play}
      onClose={onClose}
      open={open}
      title="Run"
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="dialog-button" type="submit" form="project-run-dialog-form">
            Save
          </button>
          <button className="dialog-button dialog-button-primary" type="button" disabled={Boolean(runError)} onClick={handleSaveAndRun}>
            Save and run
          </button>
        </>
      }
    >
      <form id="project-run-dialog-form" className="project-run-dialog" onSubmit={handleSave}>
        <div className="project-run-meta">
          <span>{projectName}</span>
          <strong title={projectRoot}>{projectRoot || "No project folder selected"}</strong>
        </div>

        {normalizedConfig.actions.length > 1 ? (
          <label className="project-run-field">
            <span>Action</span>
            <select value={selectedActionId} onChange={(event) => handleActionSelect(event.target.value)}>
              {normalizedConfig.actions.map((action) => (
                <option key={action.id} value={action.id}>
                  {action.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="project-run-field">
          <span>Action label</span>
          <input value={draftAction?.label ?? ""} onChange={(event) => updateDraftAction({ label: event.target.value })} />
        </label>

        <label className="project-run-field">
          <span>Command to run</span>
          <textarea
            autoFocus
            spellCheck={false}
            value={draftAction?.command ?? ""}
            placeholder={"eg:\nnpm install\nnpm run dev"}
            onChange={(event) => updateDraftAction({ command: event.target.value })}
          />
        </label>

        <div className="project-run-grid">
          <label className="project-run-field">
            <span>Kind</span>
            <select value={draftAction?.kind ?? "custom"} onChange={(event) => updateDraftAction({ kind: event.target.value as ProjectRunActionKind })}>
              {RUN_ACTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {formatActionKind(kind)}
                </option>
              ))}
            </select>
          </label>

          <label className="project-run-field">
            <span>Shell</span>
            <select
              value={draftAction?.shell ?? ""}
              onChange={(event) => {
                const shell = event.target.value as TerminalShellId | "";
                updateDraftAction({ shell: shell || undefined });
              }}
            >
              <option value="">Default</option>
              {shells.map((shell) => (
                <option key={shell} value={shell}>
                  {terminalShellLabel(shell)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="project-run-field">
          <span>Working directory</span>
          <input value={draftAction?.cwd ?? projectRoot ?? ""} placeholder={projectRoot} onChange={(event) => updateDraftAction({ cwd: event.target.value })} />
        </label>

        <label className="project-run-field">
          <span>Preview URL</span>
          <input value={draftAction?.previewUrl ?? ""} placeholder="http://localhost:5173/" onChange={(event) => updateDraftAction({ previewUrl: event.target.value })} />
        </label>

        <label className="project-run-check">
          <input
            type="checkbox"
            checked={draftAction?.background ?? true}
            onChange={(event) => updateDraftAction({ background: event.target.checked })}
          />
          <span>Keep running in the integrated terminal</span>
        </label>

        {runError ? <p className="project-run-error">{runError}</p> : null}
      </form>
    </DialogShell>
  );
}

function getRunError(action: ProjectRunAction | undefined, projectRoot?: string) {
  if (!projectRoot) {
    return "Choose a project folder before running commands.";
  }

  if (!action?.command.trim()) {
    return "Enter a command before running this project.";
  }

  return "";
}

function formatActionKind(kind: ProjectRunActionKind) {
  if (kind === "dev-server") {
    return "Dev server";
  }

  return kind[0]!.toUpperCase() + kind.slice(1);
}
