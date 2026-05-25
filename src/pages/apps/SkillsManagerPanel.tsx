import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, Copy, FileText, FolderOpen, KeyRound, Plus, ShieldCheck, Sparkles, ToggleLeft, ToggleRight, Trash2, Upload, Wand2 } from "lucide-react";
import {
  importSkillFromFolder,
  installSkillPreset,
  listSkillPresets,
  loadSkillRegistry,
  setSkillEnabled,
  subscribeSkillRegistry,
  uninstallSkill,
  upsertCustomSkill,
} from "../../services/skillRegistry";
import { DialogShell } from "../../components/dialogs/AppDialog";
import type { AppSkill, SkillDraft, SkillPreset, SkillRegistryState, SkillSafetyLevel } from "../../types/skills";

interface SkillsManagerPanelProps {
  onOpenKeysSettings: () => void;
  searchQuery: string;
}

type AppsStatusMessage = { kind: "error" | "success" | "warning"; text: string };

interface SkillDraftForm {
  category: string;
  description: string;
  instructions: string;
  name: string;
  safetyLevel: SkillSafetyLevel;
  tagsText: string;
  trigger: string;
}

const EMPTY_SKILL_DRAFT: SkillDraftForm = {
  category: "Workflow",
  description: "",
  instructions: createSkillTemplate(),
  name: "",
  safetyLevel: "medium",
  tagsText: "",
  trigger: "",
};

export function SkillsManagerPanel({ onOpenKeysSettings, searchQuery }: SkillsManagerPanelProps) {
  const [registry, setRegistry] = useState<SkillRegistryState>(() => loadSkillRegistry());
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(() => loadSkillRegistry().skills.find((skill) => skill.installed)?.id ?? null);
  const [editorSkill, setEditorSkill] = useState<AppSkill | null>(null);
  const [draft, setDraft] = useState<SkillDraftForm>(EMPTY_SKILL_DRAFT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<AppsStatusMessage | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const presets = useMemo(() => listSkillPresets(), []);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const installedSkills = registry.skills.filter((skill) => skill.installed && matchesSkillSearch(skill, normalizedSearchQuery));
  const allInstalledSkills = registry.skills.filter((skill) => skill.installed);
  const visiblePresets = presets.filter((preset) => matchesPresetSearch(preset, normalizedSearchQuery));
  const enabledCount = allInstalledSkills.filter((skill) => skill.enabled).length;
  const customCount = allInstalledSkills.filter((skill) => skill.source !== "premade").length;
  const selectedSkill = registry.skills.find((skill) => skill.id === selectedSkillId && skill.installed) ?? installedSkills[0] ?? allInstalledSkills[0] ?? null;

  useEffect(() => subscribeSkillRegistry(setRegistry), []);

  function openNewSkillEditor() {
    setEditorSkill(null);
    setDraft(EMPTY_SKILL_DRAFT);
    setEditorOpen(true);
    setStatus(null);
  }

  function openEditSkillEditor(skill: AppSkill) {
    setEditorSkill(skill);
    setDraft(createDraftFromSkill(skill));
    setEditorOpen(true);
    setStatus(null);
  }

  function updateDraft(nextDraft: Partial<SkillDraftForm>) {
    setDraft((currentDraft) => ({
      ...currentDraft,
      ...nextDraft,
    }));
  }

  function handleDraftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const savedSkill = upsertCustomSkill(createSkillDraftPayload(draft, editorSkill));
      setSelectedSkillId(savedSkill.id);
      setEditorOpen(false);
      setEditorSkill(null);
      setStatus({ kind: "success", text: `${savedSkill.name} saved.` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not save that skill." });
    }
  }

  async function handleImportFolder() {
    setBusyAction("import");
    setStatus(null);

    try {
      const imported = await importSkillFromFolder();

      if (imported) {
        setSelectedSkillId(imported.id);
        setStatus({ kind: "success", text: `${imported.name} imported. Review it, then enable it when ready.` });
      }
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not import that skill folder." });
    } finally {
      setBusyAction(null);
    }
  }

  function handleInstallPreset(preset: SkillPreset) {
    try {
      installSkillPreset(preset.id);
      setSelectedSkillId(preset.id);
      setStatus({ kind: "success", text: `${preset.name} installed and enabled.` });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not install that premade skill." });
    }
  }

  function handleToggleSkill(skill: AppSkill) {
    setSkillEnabled(skill.id, !skill.enabled);
    setStatus({ kind: "success", text: `${skill.name} ${skill.enabled ? "disabled" : "enabled"}.` });
  }

  function handleRemoveSkill(skill: AppSkill) {
    const action = skill.source === "premade" ? "Uninstall" : "Delete";

    if (!window.confirm(`${action} "${skill.name}"?`)) {
      return;
    }

    uninstallSkill(skill.id);
    setSelectedSkillId(null);
    setStatus({ kind: "success", text: `${skill.name} ${skill.source === "premade" ? "uninstalled" : "deleted"}.` });
  }

  async function handleCopyTrigger(skill: AppSkill) {
    try {
      await navigator.clipboard.writeText(skill.trigger);
      setStatus({ kind: "success", text: `${skill.trigger} copied.` });
    } catch {
      setStatus({ kind: "warning", text: skill.trigger });
    }
  }

  return (
    <section className="apps-skills-board" aria-label="Skills">
      <div className="apps-mcp-board-head">
        <div className="apps-mcp-heading">
          <WebSkillLogo />
          <span>
            <strong>Skills</strong>
            <small>Reusable SKILL.md workflows loaded into chat only when they match the turn</small>
          </span>
          <span className="apps-plugin-status" data-kind={enabledCount > 0 ? "connected" : "ready"}>
            {enabledCount > 0 ? <CheckCircle2 size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
            {enabledCount > 0 ? "Enabled" : "Ready"}
          </span>
        </div>

        <div className="apps-mcp-board-actions">
          <button className="apps-plugin-secondary" type="button" onClick={onOpenKeysSettings}>
            <KeyRound size={15} aria-hidden="true" />
            Keys
          </button>
          <button className="apps-plugin-primary" type="button" disabled={busyAction === "import"} onClick={() => void handleImportFolder()}>
            <FolderOpen size={15} aria-hidden="true" />
            {busyAction === "import" ? "Importing" : "Import folder"}
          </button>
          <button className="apps-plugin-secondary" type="button" onClick={openNewSkillEditor}>
            <Plus size={15} aria-hidden="true" />
            New skill
          </button>
        </div>
      </div>

      {status ? (
        <div className="apps-plugin-message" data-kind={status.kind}>
          {status.text}
        </div>
      ) : null}

      <div className="apps-mcp-summary-grid apps-skills-summary-grid" aria-label="Skills status">
        <span>
          <strong>{allInstalledSkills.length}</strong>
          Installed
        </span>
        <span>
          <strong>{enabledCount}</strong>
          Enabled
        </span>
        <span>
          <strong>{customCount}</strong>
          Custom
        </span>
        <span>
          <strong>{presets.length}</strong>
          Premade
        </span>
      </div>

      <section className="apps-mcp-section" aria-label="Installed skills">
        <div className="apps-mcp-panel-head">
          <div className="apps-plugin-expanded-head">
            <strong>Installed skills</strong>
            <small>Use a trigger like $review or let Gilbert match the skill by description</small>
          </div>
          <div className="apps-mcp-steps" aria-label="Skill setup steps">
            <span>Add</span>
            <span>Enable</span>
            <span>Chat</span>
          </div>
        </div>

        <div className="apps-skills-layout">
          <div className="apps-skills-card-grid">
            {installedSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                selected={selectedSkill?.id === skill.id}
                skill={skill}
                onCopy={() => void handleCopyTrigger(skill)}
                onEdit={() => openEditSkillEditor(skill)}
                onRemove={() => handleRemoveSkill(skill)}
                onSelect={() => setSelectedSkillId(skill.id)}
                onToggle={() => handleToggleSkill(skill)}
              />
            ))}

            {installedSkills.length === 0 ? (
              <div className="apps-skills-empty">
                <FileText size={18} aria-hidden="true" />
                <span>
                  <strong>No installed skills match</strong>
                  <small>Install a premade skill or create one from SKILL.md.</small>
                </span>
              </div>
            ) : null}
          </div>

          <SkillPreview skill={selectedSkill} />
        </div>
      </section>

      <section className="apps-mcp-section" aria-label="Premade skills">
        <div className="apps-plugin-expanded-head">
          <strong>Premade skills</strong>
          <small>Trusted starting points for coding, research, review, design, and authoring</small>
        </div>
        <div className="apps-skills-preset-grid">
          {visiblePresets.map((preset) => {
            const installed = Boolean(registry.skills.find((skill) => skill.id === preset.id && skill.source === "premade" && skill.installed));

            return (
              <article key={preset.id} className="apps-skills-preset-card" data-installed={installed}>
                <span className="apps-mcp-card-top">
                  <span className="apps-mcp-card-avatar" aria-hidden="true">
                    <Wand2 size={16} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{preset.name}</strong>
                    <small>{preset.trigger} - {preset.category}</small>
                  </span>
                  <em>{installed ? "Installed" : "Premade"}</em>
                </span>
                <p>{preset.description}</p>
                <span className="apps-mcp-preset-tags">
                  {preset.tags.slice(0, 3).map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                </span>
                <button className={installed ? "apps-plugin-secondary" : "apps-plugin-primary"} type="button" disabled={installed} onClick={() => handleInstallPreset(preset)}>
                  {installed ? <CheckCircle2 size={14} aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
                  {installed ? "Installed" : "Install"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <div className="apps-plugin-safety">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>Imported skills start disabled. Review instructions before enabling workflows that run commands, touch files, or use connected apps.</span>
      </div>

      {editorOpen ? (
        <SkillEditorDialog
          draft={draft}
          editingSkill={editorSkill}
          onClose={() => setEditorOpen(false)}
          onDraftChange={updateDraft}
          onSubmit={handleDraftSubmit}
        />
      ) : null}
    </section>
  );
}

function SkillCard({
  onCopy,
  onEdit,
  onRemove,
  onSelect,
  onToggle,
  selected,
  skill,
}: {
  onCopy: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onSelect: () => void;
  onToggle: () => void;
  selected: boolean;
  skill: AppSkill;
}) {
  const ToggleIcon = skill.enabled ? ToggleRight : ToggleLeft;

  return (
    <article className="apps-skills-card" data-enabled={skill.enabled} data-selected={selected}>
      <button className="apps-skills-card-main" type="button" onClick={onSelect}>
        <span className="apps-mcp-card-avatar" aria-hidden="true">
          <Sparkles size={16} aria-hidden="true" />
        </span>
        <span>
          <strong>{skill.name}</strong>
          <small>{skill.trigger} - {skill.category}</small>
        </span>
      </button>
      <p>{skill.description}</p>
      <div className="apps-mcp-tool-chip-list">
        <em>{skill.source}</em>
        <em>{skill.safetyLevel}</em>
        {skill.tags.slice(0, 3).map((tag) => (
          <em key={tag}>{tag}</em>
        ))}
      </div>
      <div className="apps-skills-card-actions">
        <button type="button" title="Copy trigger" aria-label={`Copy ${skill.trigger}`} onClick={onCopy}>
          <Copy size={14} aria-hidden="true" />
        </button>
        {skill.source !== "premade" ? (
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        ) : null}
        <button type="button" onClick={onToggle}>
          <ToggleIcon size={15} aria-hidden="true" />
          {skill.enabled ? "Disable" : "Enable"}
        </button>
        <button className="mcp-server-remove-button" type="button" onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function SkillPreview({ skill }: { skill: AppSkill | null }) {
  if (!skill) {
    return (
      <article className="apps-skills-preview">
        <strong>No skill selected</strong>
        <p>Select an installed skill to inspect its trigger and instructions.</p>
      </article>
    );
  }

  return (
    <article className="apps-skills-preview">
      <span className="apps-skills-preview-head">
        <span>
          <strong>{skill.name}</strong>
          <small>{skill.trigger} - {skill.enabled ? "Enabled" : "Disabled"}</small>
        </span>
        <span className="apps-plugin-status" data-kind={skill.enabled ? "connected" : "installed"}>
          {skill.enabled ? "Active" : "Off"}
        </span>
      </span>
      <p>{skill.description}</p>
      <div className="apps-skills-preview-meta">
        <span>
          <BadgeCheck size={14} aria-hidden="true" />
          {skill.safetyLevel}
        </span>
        <span>{skill.source}</span>
        {skill.path ? <span>{skill.path}</span> : null}
      </div>
      <pre>{skill.instructions}</pre>
    </article>
  );
}

function SkillEditorDialog({
  draft,
  editingSkill,
  onClose,
  onDraftChange,
  onSubmit,
}: {
  draft: SkillDraftForm;
  editingSkill: AppSkill | null;
  onClose: () => void;
  onDraftChange: (draft: Partial<SkillDraftForm>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <DialogShell
      description={editingSkill ? "Edit a custom or imported skill." : "Create a reusable SKILL.md workflow."}
      icon={Sparkles}
      open
      title={editingSkill ? "Edit skill" : "New skill"}
      onClose={onClose}
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            Close
          </button>
          <button className="dialog-button dialog-button-primary" type="submit" form="apps-skill-editor-form">
            Save skill
          </button>
        </>
      }
    >
      <form id="apps-skill-editor-form" className="apps-skill-editor-form" onSubmit={onSubmit}>
        <div className="apps-skill-editor-grid">
          <label>
            <span>Name</span>
            <input value={draft.name} maxLength={80} onChange={(event) => onDraftChange({ name: event.target.value })} />
          </label>
          <label>
            <span>Trigger</span>
            <input value={draft.trigger} maxLength={64} placeholder="$my-skill" onChange={(event) => onDraftChange({ trigger: event.target.value })} />
          </label>
          <label>
            <span>Category</span>
            <input value={draft.category} maxLength={40} onChange={(event) => onDraftChange({ category: event.target.value })} />
          </label>
          <label>
            <span>Safety</span>
            <select value={draft.safetyLevel} onChange={(event) => onDraftChange({ safetyLevel: event.target.value as SkillSafetyLevel })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label>
          <span>Description</span>
          <input value={draft.description} maxLength={220} onChange={(event) => onDraftChange({ description: event.target.value })} />
        </label>
        <label>
          <span>Tags</span>
          <input value={draft.tagsText} placeholder="review, tests, release" onChange={(event) => onDraftChange({ tagsText: event.target.value })} />
        </label>
        <label>
          <span>SKILL.md</span>
          <textarea value={draft.instructions} spellCheck={false} onChange={(event) => onDraftChange({ instructions: event.target.value })} />
        </label>
      </form>
    </DialogShell>
  );
}

function WebSkillLogo() {
  return (
    <span className="apps-plugin-logo-soon apps-skills-logo" aria-hidden="true">
      <Sparkles size={20} />
    </span>
  );
}

function createSkillDraftPayload(draft: SkillDraftForm, existingSkill: AppSkill | null): SkillDraft {
  return {
    category: draft.category,
    description: draft.description,
    enabled: existingSkill?.enabled ?? true,
    id: existingSkill?.source === "premade" ? undefined : existingSkill?.id,
    instructions: draft.instructions,
    name: draft.name,
    path: existingSkill?.path,
    safetyLevel: draft.safetyLevel,
    source: existingSkill?.source === "imported" ? "imported" : "custom",
    tags: draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
    trigger: draft.trigger,
  };
}

function createDraftFromSkill(skill: AppSkill): SkillDraftForm {
  return {
    category: skill.category,
    description: skill.description,
    instructions: skill.instructions,
    name: skill.name,
    safetyLevel: skill.safetyLevel,
    tagsText: skill.tags.join(", "),
    trigger: skill.trigger,
  };
}

function matchesSkillSearch(skill: AppSkill, query: string) {
  if (!query) {
    return true;
  }

  return [skill.name, skill.trigger, skill.description, skill.category, skill.source, ...skill.tags].join(" ").toLowerCase().includes(query);
}

function matchesPresetSearch(preset: SkillPreset, query: string) {
  if (!query) {
    return true;
  }

  return [preset.name, preset.trigger, preset.description, preset.category, preset.author, ...preset.tags].join(" ").toLowerCase().includes(query);
}

function createSkillTemplate() {
  return [
    "---",
    "name: my-skill",
    "description: Describe when Gilbert should use this skill.",
    "---",
    "",
    "Use this skill when ...",
    "",
    "Steps:",
    "1. Inspect the relevant context.",
    "2. Apply the workflow.",
    "3. Verify the result and summarize only what changed.",
  ].join("\n");
}
