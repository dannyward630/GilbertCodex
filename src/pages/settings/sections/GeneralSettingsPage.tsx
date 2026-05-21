import { useEffect, useState } from "react";
import {
  Bell,
  Check,
  Code2,
  Command,
  FileCode2,
  FolderOpen,
  Keyboard,
  Mic,
  MonitorCog,
  PanelTopOpen,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import { getNativeDictationStatus, isTauriDesktopRuntime, prepareNativeDictation, type NativeDictationStatus } from "../../../app/tauriClient";
import { formatHostPlatformLabel } from "../../../lib/hostPlatform";
import { getAvailableTerminalShells, terminalShellLabel } from "../../../lib/terminalShells";
import { localPermissionModeLabel, localWorkspaceScopeLabel } from "../../../localWorkspace/files";
import type { AppInfo } from "../../../types/app";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import { getProjectOpenTargetsForPlatform, type ProjectOpenTargetId } from "../../../types/projectOpen";
import type { AppAgentEnvironment, AppGeneralSettings, AppWorkMode, ProviderSettings } from "../../../types/settings";
import type { TerminalShellId } from "../../../types/terminal";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface GeneralSettingsPageProps {
  activeProviderLabel: string;
  appInfo: AppInfo;
  generalSettings: AppGeneralSettings;
  showHeading?: boolean;
  localWorkspace: LocalWorkspaceSettings;
  onGeneralSettingsChange: (settings: AppGeneralSettings) => void;
  onOpenLibraryData: () => void;
  onResetSettings: () => void;
  onSelectApprovalPolicy: (policy: "never" | "on-request" | "untrusted") => void;
  onSelectSandboxMode: (mode: "danger-full-access" | "read-only" | "workspace-write") => void;
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

const WORK_MODE_OPTIONS: Array<{ detail: string; id: AppWorkMode; label: string }> = [
  {
    detail: "More technical responses and tighter coding controls.",
    id: "coding",
    label: "For coding",
  },
  {
    detail: "Same power, less technical detail by default.",
    id: "everyday",
    label: "For everyday work",
  },
];

const PERMISSION_OPTIONS = [
  {
    detail: "Read and edit files in the workspace. Gilbert asks when extra access is needed.",
    id: "untrusted",
    label: "Default permissions",
  },
  {
    detail: "Workspace access plus automatic review for elevated requests.",
    id: "on-request",
    label: "Auto-review",
  },
  {
    detail: "Edit any file and run network commands without approval. Higher risk.",
    id: "never",
    label: "Full access",
  },
] as const;

const AGENT_ENVIRONMENT_OPTIONS: Array<{ detail: string; id: AppAgentEnvironment; label: string }> = [
  {
    detail: "Use WSL for WSL workspaces, otherwise stay native.",
    id: "auto",
    label: "Auto Detect",
  },
  {
    detail: "Run the agent directly in Windows.",
    id: "windows-native",
    label: "Windows native",
  },
  {
    detail: "Run the agent inside WSL2 for Linux-native projects.",
    id: "wsl",
    label: "Windows Subsystem for Linux",
  },
];

function currentApprovalPolicy(localWorkspace: LocalWorkspaceSettings) {
  return localWorkspace.permissionMode === "full-access" ? "never" : localWorkspace.permissionMode === "default" ? "untrusted" : "on-request";
}

function currentSandboxMode(localWorkspace: LocalWorkspaceSettings) {
  return localWorkspace.scope === "full-computer" ? "danger-full-access" : "workspace-write";
}

export function GeneralSettingsPage({
  activeProviderLabel,
  appInfo,
  generalSettings,
  localWorkspace,
  onGeneralSettingsChange,
  onOpenLibraryData,
  onResetSettings,
  onSelectApprovalPolicy,
  onSelectSandboxMode,
  onSettingsPatch,
  settings,
  showHeading = true,
}: GeneralSettingsPageProps) {
  const approvalPolicy = currentApprovalPolicy(localWorkspace);
  const [dictationPreparing, setDictationPreparing] = useState(false);
  const [dictationStatus, setDictationStatus] = useState<NativeDictationStatus | null>(null);
  const sandboxMode = currentSandboxMode(localWorkspace);
  const projectOpenTargets = getProjectOpenTargetsForPlatform(appInfo.platform);
  const terminalShells = getAvailableTerminalShells();

  useEffect(() => {
    let disposed = false;

    getNativeDictationStatus()
      .then((status) => {
        if (!disposed) {
          setDictationStatus(status);
        }
      })
      .catch(() => {
        if (!disposed) {
          setDictationStatus(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  function updateGeneral(patch: Partial<AppGeneralSettings>) {
    onGeneralSettingsChange({
      ...generalSettings,
      ...patch,
    });
  }

  function updateDictation(patch: Partial<AppGeneralSettings["dictation"]>) {
    updateGeneral({
      dictation: {
        ...generalSettings.dictation,
        ...patch,
      },
    });
  }

  function updateNotifications(patch: Partial<AppGeneralSettings["notifications"]>) {
    updateGeneral({
      notifications: {
        ...generalSettings.notifications,
        ...patch,
      },
    });
  }

  function toggleSavedHotkey(currentValue: string, nextValue: string) {
    return currentValue ? "" : nextValue;
  }

  async function warmDictationEngine() {
    if (!isTauriDesktopRuntime()) {
      return;
    }

    setDictationPreparing(true);
    try {
      setDictationStatus(await prepareNativeDictation());
    } finally {
      setDictationPreparing(false);
    }
  }

  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Work mode, permissions, app behavior, dictation, notifications, and runtime defaults." icon={Settings2} title="General" /> : null}
      <div className="general-settings-layout">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Sparkles size={19} aria-hidden="true" />
            <div>
              <h2>Work mode</h2>
              <p>Choose how much technical detail Gilbert shows.</p>
            </div>
          </div>
          <div className="settings-option-grid settings-option-grid-two" role="radiogroup" aria-label="Work mode">
            {WORK_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                className="settings-option-button"
                type="button"
                role="radio"
                aria-checked={(settings.workMode ?? "coding") === option.id}
                data-selected={(settings.workMode ?? "coding") === option.id}
                onClick={() => onSettingsPatch({ workMode: option.id })}
              >
                <span className="settings-option-icon">{(settings.workMode ?? "coding") === option.id ? <Check size={16} aria-hidden="true" /> : <Code2 size={16} aria-hidden="true" />}</span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Permissions</h2>
              <p>{localWorkspace.enabled ? `${localWorkspaceScopeLabel(localWorkspace.scope)} - ${localPermissionModeLabel(localWorkspace.permissionMode)}` : "Local tools are off until a workspace is selected."}</p>
            </div>
          </div>
          <div className="settings-option-grid settings-option-grid-three" role="radiogroup" aria-label="Default permissions">
            {PERMISSION_OPTIONS.map((option) => (
              <button
                key={option.id}
                className="settings-option-button"
                type="button"
                role="radio"
                aria-checked={approvalPolicy === option.id}
                data-danger={option.id === "never"}
                data-selected={approvalPolicy === option.id}
                onClick={() => onSelectApprovalPolicy(option.id)}
              >
                <span className="settings-option-icon">{option.id === "never" ? <ShieldAlert size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}</span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
          <div className="settings-row-list">
            <div className="settings-row settings-row-control">
              <span>Workspace scope</span>
              <strong>Choose which local roots Gilbert can use by default.</strong>
              <div className="settings-segmented-control settings-segmented-control-compact" role="radiogroup" aria-label="Workspace scope">
                {[
                  { id: "workspace-write", label: "Workspace" },
                  { id: "danger-full-access", label: "Full computer" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={sandboxMode === option.id}
                    data-selected={sandboxMode === option.id}
                    onClick={() => onSelectSandboxMode(option.id as "danger-full-access" | "workspace-write")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <MonitorCog size={19} aria-hidden="true" />
            <div>
              <h2>App defaults</h2>
              <p>Where projects open, what shell the integrated terminal starts with, and how chats behave.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <label className="settings-row settings-row-control">
              <span>Default open destination</span>
              <strong>Where files and folders open by default.</strong>
              <select value={generalSettings.defaultOpenTarget} onChange={(event) => updateGeneral({ defaultOpenTarget: event.target.value as ProjectOpenTargetId })}>
                {projectOpenTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-row settings-row-control settings-row-stack">
              <span>Agent environment</span>
              <strong>Choose where the agent runs on Windows.</strong>
              <div className="settings-option-grid settings-option-grid-three settings-option-grid-compact" role="radiogroup" aria-label="Agent environment">
                {AGENT_ENVIRONMENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className="settings-option-button"
                    type="button"
                    role="radio"
                    aria-checked={generalSettings.agentEnvironment === option.id}
                    data-selected={generalSettings.agentEnvironment === option.id}
                    onClick={() => updateGeneral({ agentEnvironment: option.id })}
                  >
                    <span className="settings-option-icon">{generalSettings.agentEnvironment === option.id ? <Check size={16} aria-hidden="true" /> : <MonitorCog size={16} aria-hidden="true" />}</span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="settings-row settings-row-control">
              <span>Integrated terminal shell</span>
              <strong>Choose which shell opens in the integrated terminal.</strong>
              <select value={generalSettings.terminalShell} onChange={(event) => updateGeneral({ terminalShell: event.target.value as TerminalShellId })}>
                {terminalShells.map((shell) => (
                  <option key={shell} value={shell}>
                    {terminalShellLabel(shell)}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-row settings-row-control">
              <span>Language</span>
              <strong>Language for the app UI.</strong>
              <select value={generalSettings.language} onChange={() => updateGeneral({ language: "auto" })}>
                <option value="auto">Auto Detect</option>
              </select>
            </label>
            <SwitchRow
              label="Require Ctrl+Enter for long prompts"
              detail="When enabled, multiline prompts require Ctrl+Enter to send."
              checked={generalSettings.requireCtrlEnterForLongPrompts}
              onChange={(checked) => updateGeneral({ requireCtrlEnterForLongPrompts: checked })}
            />
            <SwitchRow
              label="Default to projectless chat"
              detail="Start new chats without a project."
              checked={generalSettings.defaultProjectlessChat}
              onChange={(checked) => updateGeneral({ defaultProjectlessChat: checked })}
            />
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Zap size={19} aria-hidden="true" />
            <div>
              <h2>Speed</h2>
              <p>Choose how quickly inference runs across chats.</p>
            </div>
          </div>
          <div className="settings-segmented-control settings-segmented-control-compact" role="radiogroup" aria-label="Speed">
            {[
              { id: "standard", label: "Standard" },
              { id: "fast", label: "Fast" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={generalSettings.inferenceSpeed === option.id}
                data-selected={generalSettings.inferenceSpeed === option.id}
                onClick={() => updateGeneral({ inferenceSpeed: option.id as AppGeneralSettings["inferenceSpeed"] })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Command size={19} aria-hidden="true" />
            <div>
              <h2>Follow-up behavior</h2>
              <p>Choose what happens when you send while Gilbert is working.</p>
            </div>
          </div>
          <div className="settings-segmented-control settings-segmented-control-compact" role="radiogroup" aria-label="Follow-up behavior">
            {[
              { id: "queue", label: "Queue" },
              { id: "steer", label: "Steer" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={generalSettings.followUpBehavior === option.id}
                data-selected={generalSettings.followUpBehavior === option.id}
                onClick={() => updateGeneral({ followUpBehavior: option.id as AppGeneralSettings["followUpBehavior"] })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <FileCode2 size={19} aria-hidden="true" />
            <div>
              <h2>Code review</h2>
              <p>Choose where review work opens.</p>
            </div>
          </div>
          <div className="settings-segmented-control settings-segmented-control-compact" role="radiogroup" aria-label="Code review">
            {[
              { id: "inline", label: "Inline" },
              { id: "detached", label: "Detached" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={generalSettings.codeReviewBehavior === option.id}
                data-selected={generalSettings.codeReviewBehavior === option.id}
                onClick={() => updateGeneral({ codeReviewBehavior: option.id as AppGeneralSettings["codeReviewBehavior"] })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <PanelTopOpen size={19} aria-hidden="true" />
            <div>
              <h2>Popout Window</h2>
              <p>Set a global shortcut for Popout Window.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row settings-row-control">
              <span>Popout Window hotkey</span>
              <strong>{generalSettings.popoutWindowHotkey || "Off"}</strong>
              <button className="settings-ghost-button" type="button" onClick={() => updateGeneral({ popoutWindowHotkey: toggleSavedHotkey(generalSettings.popoutWindowHotkey, "Ctrl+Alt+P") })}>
                <Keyboard size={16} aria-hidden="true" />
                {generalSettings.popoutWindowHotkey ? "Clear" : "Set"}
              </button>
            </div>
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Mic size={19} aria-hidden="true" />
            <div>
              <h2>Dictation</h2>
              <p>Voice input uses local Whisper in the desktop app; browser preview uses browser speech.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row settings-row-control">
              <span>Offline engine</span>
              <strong>{formatDictationStatusLabel(dictationStatus)}</strong>
              <button className="settings-ghost-button" type="button" disabled={!isTauriDesktopRuntime() || dictationPreparing} onClick={warmDictationEngine}>
                {dictationPreparing ? <RotateCcw size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                {dictationPreparing ? "Warming" : "Warm"}
              </button>
            </div>
            <div className="settings-row settings-row-control">
              <span>Privacy</span>
              <strong>Microphone audio stays local and is captured only while dictating.</strong>
            </div>
            <div className="settings-row settings-row-control">
              <span>Hold-to-dictate hotkey</span>
              <strong>{generalSettings.dictation.holdHotkey || "Off"}</strong>
              <button className="settings-ghost-button" type="button" onClick={() => updateDictation({ holdHotkey: toggleSavedHotkey(generalSettings.dictation.holdHotkey, "Ctrl") })}>
                <Keyboard size={16} aria-hidden="true" />
                {generalSettings.dictation.holdHotkey ? "Clear" : "Set"}
              </button>
            </div>
            <div className="settings-row settings-row-control">
              <span>Toggle dictation hotkey</span>
              <strong>{generalSettings.dictation.toggleHotkey || "Off"}</strong>
              <button className="settings-ghost-button" type="button" onClick={() => updateDictation({ toggleHotkey: toggleSavedHotkey(generalSettings.dictation.toggleHotkey, "Ctrl+Alt+D") })}>
                <Keyboard size={16} aria-hidden="true" />
                {generalSettings.dictation.toggleHotkey ? "Clear" : "Set"}
              </button>
            </div>
            <label className="settings-row settings-row-control settings-row-tall">
              <span>Dictation dictionary</span>
              <strong>Words or phrases dictation should recognize.</strong>
              <textarea value={generalSettings.dictation.dictionary} onChange={(event) => updateDictation({ dictionary: event.target.value })} />
            </label>
          </div>
        </article>

        <article className="settings-card settings-card-wide settings-notifications-card">
          <div className="settings-card-heading">
            <Bell size={19} aria-hidden="true" />
            <div>
              <h2>Notifications</h2>
              <p>Control when Gilbert alerts you.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <label className="settings-row settings-row-control">
              <span>Turn completion notifications</span>
              <strong>Set when Gilbert alerts you that it is finished.</strong>
              <select value={generalSettings.notifications.turnCompletion} onChange={(event) => updateNotifications({ turnCompletion: event.target.value as AppGeneralSettings["notifications"]["turnCompletion"] })}>
                <option value="unfocused">Only when unfocused</option>
                <option value="always">Always</option>
                <option value="off">Off</option>
              </select>
            </label>
            <SwitchRow
              label="Enable permission notifications"
              detail="Show alerts when notification permissions are required."
              checked={generalSettings.notifications.permissionNotifications}
              onChange={(checked) => updateNotifications({ permissionNotifications: checked })}
            />
            <SwitchRow
              label="Enable question notifications"
              detail="Show alerts when input is needed to continue."
              checked={generalSettings.notifications.questionNotifications}
              onChange={(checked) => updateNotifications({ questionNotifications: checked })}
            />
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <UserRound size={19} aria-hidden="true" />
            <div>
              <h2>Current app</h2>
              <p>{activeProviderLabel}</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Name</span>
              <strong>{appInfo.name}</strong>
            </div>
            <div className="settings-row">
              <span>Version</span>
              <strong>{appInfo.version}</strong>
            </div>
            <div className="settings-row">
              <span>Runtime</span>
              <strong>{appInfo.runtime}</strong>
            </div>
            <div className="settings-row">
              <span>Platform</span>
              <strong>{formatHostPlatformLabel(appInfo.platform, appInfo.arch)}</strong>
            </div>
            <div className="settings-row">
              <span>Model</span>
              <strong>{settings.model}</strong>
            </div>
          </div>
          <button className="settings-ghost-button settings-full-width-button" type="button" onClick={onResetSettings}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset provider settings
          </button>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <FolderOpen size={19} aria-hidden="true" />
            <div>
              <h2>Import work from other AI apps</h2>
              <p>Use Library & Data for backups, storage maintenance, and migration-safe device data.</p>
            </div>
          </div>
          <span className="settings-subtle-text">
            Import tooling is kept with local storage controls so chat, project, PDF, and device database data move together instead of creating partial imports here.
          </span>
          <button className="settings-ghost-button settings-full-width-button" type="button" onClick={onOpenLibraryData}>
            <FolderOpen size={16} aria-hidden="true" />
            Import
          </button>
        </article>
      </div>
    </>
  );
}

function formatDictationStatusLabel(status: NativeDictationStatus | null) {
  if (!status) {
    return isTauriDesktopRuntime() ? "Checking local Whisper" : "Browser speech fallback";
  }

  if (!isTauriDesktopRuntime()) {
    return "Browser speech fallback";
  }

  if (status.state === "ready" || status.modelLoaded) {
    return `${status.model} ready (${formatDictationAccelerator(status)})`;
  }

  if (status.state === "warming") {
    return `${status.model} warming`;
  }

  if (status.state === "recording") {
    return "Recording locally";
  }

  if (status.state === "transcribing") {
    return "Transcribing locally";
  }

  if (status.state === "missingModel") {
    return "Whisper model missing";
  }

  if (status.state === "blocked") {
    return "Microphone blocked";
  }

  if (status.state === "error") {
    return "Offline engine error";
  }

  return `${status.model} idle`;
}

function formatDictationAccelerator(status: NativeDictationStatus) {
  if (status.accelerator === "nvidia-cuda") {
    return status.gpuDeviceName || "NVIDIA GPU";
  }

  if (status.accelerator === "vulkan-gpu") {
    return status.gpuDeviceName ? `GPU: ${status.gpuDeviceName}` : "GPU";
  }

  if (status.accelerator === "cpu-fallback") {
    return "CPU fallback";
  }

  return "CPU";
}

function SwitchRow({
  checked,
  detail,
  label,
  onChange,
}: {
  checked: boolean;
  detail: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-row settings-row-control">
      <span>{label}</span>
      <strong>{detail}</strong>
      <button className="settings-switch" type="button" role="switch" aria-checked={checked} data-on={checked} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}
