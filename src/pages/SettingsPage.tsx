import { CheckCircle2, Eye, EyeOff, KeyRound, Monitor, Moon, RotateCcw, ServerCog, SlidersHorizontal, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../components/dialogs/AppDialog";
import { ThinkingModeControls } from "../components/thinking/ThinkingModeControls";
import { defaultProviderSettings } from "../lib/appStorage";
import { validateOpenRouterSettings } from "../services/openRouterClient";
import type { AppInfo } from "../types/app";
import type { AppearanceMode, ProviderSettings } from "../types/settings";

interface SettingsPageProps {
  appearanceMode: AppearanceMode;
  appInfo: AppInfo;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onSettingsChange: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

const appearanceOptions: Array<{ icon: typeof Monitor; label: string; value: AppearanceMode }> = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Moon, label: "Dark", value: "dark" },
  { icon: Sun, label: "Light", value: "light" },
];

export function SettingsPage({ appearanceMode, appInfo, onAppearanceModeChange, onSettingsChange, settings }: SettingsPageProps) {
  const mountedRef = useRef(true);
  const validationRunRef = useRef(0);
  const [showKey, setShowKey] = useState(false);
  const [clearKeyConfirmOpen, setClearKeyConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      validationRunRef.current += 1;
    };
  }, []);

  function updateSettings(nextSettings: Partial<ProviderSettings>) {
    validationRunRef.current += 1;
    setTesting(false);
    setTestStatus(null);
    onSettingsChange({
      ...settings,
      ...nextSettings,
    });
  }

  async function testConnection() {
    const validationRun = validationRunRef.current + 1;
    const settingsSnapshot = settings;

    validationRunRef.current = validationRun;
    setTesting(true);
    setTestStatus(null);

    try {
      const message = await validateOpenRouterSettings(settingsSnapshot);

      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTestStatus({ kind: "success", text: message });
      }
    } catch (error) {
      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTestStatus({ kind: "error", text: error instanceof Error ? error.message : "OpenRouter validation failed." });
      }
    } finally {
      if (mountedRef.current && validationRunRef.current === validationRun) {
        setTesting(false);
      }
    }
  }

  function confirmResetSettings() {
    setTesting(false);
    setTestStatus(null);
    setResetConfirmOpen(false);
    onSettingsChange(defaultProviderSettings);
  }

  function confirmClearApiKey() {
    updateSettings({ openRouterApiKey: "" });
    setShowKey(false);
    setClearKeyConfirmOpen(false);
  }

  return (
    <div className="settings-page">
      <section className="settings-shell" aria-labelledby="settings-title">
        <header className="settings-hero">
          <div>
            <p className="eyebrow">{appInfo.runtime}</p>
            <h1 id="settings-title">Settings</h1>
          </div>
          <button className="settings-ghost-button" type="button" onClick={() => setResetConfirmOpen(true)}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset
          </button>
        </header>

        <div className="settings-grid">
          <article className="settings-card settings-card-wide">
            <div className="settings-card-heading">
              <Monitor size={19} aria-hidden="true" />
              <div>
                <h2>Appearance</h2>
                <p>Choose how GilbertCodex follows your display.</p>
              </div>
            </div>
            <div className="theme-mode-control" role="radiogroup" aria-label="Theme mode">
              {appearanceOptions.map((option) => {
                const Icon = option.icon;
                const selected = option.value === appearanceMode;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-selected={selected}
                    onClick={() => onAppearanceModeChange(option.value)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="settings-card settings-card-wide">
            <div className="settings-card-heading">
              <KeyRound size={19} aria-hidden="true" />
              <div>
                <h2>OpenRouter</h2>
                <p>Stored locally on this device.</p>
              </div>
            </div>

            <label className="settings-field">
              <span>API key</span>
              <div className="settings-secret-row">
                <input
                  autoComplete="off"
                  placeholder="sk-or-v1-..."
                  type={showKey ? "text" : "password"}
                  value={settings.openRouterApiKey}
                  onChange={(event) => updateSettings({ openRouterApiKey: event.target.value })}
                />
                <button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((visible) => !visible)}>
                  {showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  aria-label="Clear API key"
                  disabled={!settings.openRouterApiKey.trim()}
                  onClick={() => setClearKeyConfirmOpen(true)}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </label>

            <div className="settings-actions-row">
              <button className="settings-primary-button" type="button" disabled={testing} onClick={testConnection}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {testing ? "Checking" : "Test key"}
              </button>
              {testStatus ? <span className="settings-status" data-kind={testStatus.kind}>{testStatus.text}</span> : null}
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <ServerCog size={19} aria-hidden="true" />
              <div>
                <h2>Model</h2>
                <p>Used by the chat composer.</p>
              </div>
            </div>
            <label className="settings-field">
              <span>Model ID</span>
              <input value={settings.model} onChange={(event) => updateSettings({ model: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>System prompt</span>
              <textarea rows={5} value={settings.systemPrompt} onChange={(event) => updateSettings({ systemPrompt: event.target.value })} />
            </label>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <SlidersHorizontal size={19} aria-hidden="true" />
              <div>
                <h2>Generation</h2>
                <p>Applied to every OpenRouter call.</p>
              </div>
            </div>
            <label className="settings-field">
              <span>Temperature</span>
              <input
                max="2"
                min="0"
                step="0.05"
                type="number"
                value={settings.temperature}
                onChange={(event) => updateSettings({ temperature: Number(event.target.value) })}
              />
            </label>
            <label className="settings-field">
              <span>Max tokens</span>
              <input
                min="256"
                step="256"
                type="number"
                value={settings.maxTokens}
                onChange={(event) => updateSettings({ maxTokens: Number(event.target.value) })}
              />
            </label>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading">
              <SlidersHorizontal size={19} aria-hidden="true" />
              <div>
                <h2>Thinking</h2>
                <p>OpenRouter reasoning controls.</p>
              </div>
            </div>
            <ThinkingModeControls
              settings={settings.thinking}
              variant="panel"
              onChange={(thinking) =>
                updateSettings({
                  thinking,
                })
              }
            />
          </article>
        </div>
      </section>

      <ConfirmDialog
        confirmLabel="Reset settings"
        description="This restores provider, model, generation, and thinking settings to the phase-one defaults."
        icon={RotateCcw}
        open={resetConfirmOpen}
        title="Reset settings?"
        tone="danger"
        onClose={() => setResetConfirmOpen(false)}
        onConfirm={confirmResetSettings}
      />

      <ConfirmDialog
        confirmLabel="Clear key"
        description="This removes the locally stored OpenRouter API key from this device."
        icon={Trash2}
        open={clearKeyConfirmOpen}
        title="Clear API key?"
        tone="danger"
        onClose={() => setClearKeyConfirmOpen(false)}
        onConfirm={confirmClearApiKey}
      />
    </div>
  );
}
