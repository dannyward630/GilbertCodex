import { ServerCog, SlidersHorizontal } from "lucide-react";
import { ThinkingModeControls } from "../../../components/thinking/ThinkingModeControls";
import { getAutomaticHostedMaxOutputTokens, isLocalModelProvider } from "../../../lib/generationSettings";
import { formatTokenCount } from "../../../lib/contextWindow";
import type { ChatModelOption, ModelProviderCatalogItem } from "../../../lib/models";
import type { ProviderSettings } from "../../../types/settings";
import type { LiveModelCatalogStatus } from "../types";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface ModelSettingsPageProps {
  activeModelSupportsThinking: boolean;
  activeProvider: ModelProviderCatalogItem;
  activeProviderModels: ChatModelOption[];
  activeProviderPrefersLiveCatalog: boolean;
  activeProviderUsesLiveCatalog: boolean;
  liveProviderModelStatus: LiveModelCatalogStatus;
  liveProviderModelStatusText: string;
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  onUpdateActiveProviderModel: (model: string) => void;
  settings: ProviderSettings;
}

export function ModelSettingsPage({
  activeModelSupportsThinking,
  activeProvider,
  activeProviderModels,
  activeProviderPrefersLiveCatalog,
  activeProviderUsesLiveCatalog,
  liveProviderModelStatus,
  liveProviderModelStatusText,
  onSettingsPatch,
  onUpdateActiveProviderModel,
  settings,
}: ModelSettingsPageProps) {
  const localGenerationControls = isLocalModelProvider(settings.provider);
  const activeModelContextTokens = activeProviderModels.find((option) => option.value === settings.model)?.contextWindowTokens;
  const automaticHostedMaxTokens = getAutomaticHostedMaxOutputTokens(settings, activeModelContextTokens);

  return (
    <>
      <SettingsSectionHeading detail="Model identity, system prompt, generation, and thinking controls." icon={ServerCog} title="Model" />
      <div className="settings-section-grid">
        <article className="settings-card">
          <div className="settings-card-heading">
            <ServerCog size={19} aria-hidden="true" />
            <div>
              <h2>Model</h2>
              <p>Used by the chat composer.</p>
            </div>
          </div>
          <label className="settings-field">
            <span>{activeProvider.label} preset</span>
            <select value={settings.model} onChange={(event) => onUpdateActiveProviderModel(event.target.value)}>
              {activeProviderModels.length === 0 ? (
                <option value="">{activeProviderPrefersLiveCatalog ? "No loaded models found" : "Choose a model"}</option>
              ) : !settings.model.trim() ? (
                <option value="">{activeProviderPrefersLiveCatalog ? "Choose a loaded model" : "Choose a model"}</option>
              ) : null}
              {activeProviderModels.map((option) => (
                <option key={option.id} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {activeProviderUsesLiveCatalog ? (
              <small className="settings-field-note" data-kind={liveProviderModelStatus}>
                {liveProviderModelStatusText}
              </small>
            ) : null}
          </label>
          <label className="settings-field">
            <span>Model ID</span>
            <input value={settings.model} onChange={(event) => onUpdateActiveProviderModel(event.target.value)} />
          </label>
          <label className="settings-field settings-field-tall">
            <span>System prompt</span>
            <textarea rows={6} value={settings.systemPrompt} onChange={(event) => onSettingsPatch({ systemPrompt: event.target.value })} />
          </label>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <div>
              <h2>Generation</h2>
              <p>{localGenerationControls ? "Applied to local provider calls." : "Automatic for hosted providers."}</p>
            </div>
          </div>
          {localGenerationControls ? (
            <>
              <label className="settings-field">
                <span>Temperature</span>
                <input
                  max="2"
                  min="0"
                  step="0.05"
                  type="number"
                  value={settings.temperature}
                  onChange={(event) => onSettingsPatch({ temperature: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Top P</span>
                <input
                  max="1"
                  min="0"
                  step="0.01"
                  type="number"
                  value={settings.topP}
                  onChange={(event) => onSettingsPatch({ topP: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Top K</span>
                <input
                  min="1"
                  step="1"
                  type="number"
                  value={settings.topK}
                  onChange={(event) => onSettingsPatch({ topK: Number(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                <span>Max tokens</span>
                <input
                  min="256"
                  step="256"
                  type="number"
                  value={settings.maxTokens}
                  onChange={(event) => onSettingsPatch({ maxTokens: Number(event.target.value) })}
                />
              </label>
            </>
          ) : (
            <div className="settings-stack">
              <strong className="settings-large-value">Automatic</strong>
              <span className="settings-subtle-text">Sampling follows provider defaults. Standard chat caps responses at {formatTokenCount(automaticHostedMaxTokens)}; Deep Research can request a larger cap.</span>
            </div>
          )}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <div>
              <h2>Thinking</h2>
              <p>{activeModelSupportsThinking ? "Provider reasoning controls." : "This model does not expose a compatible thinking control."}</p>
            </div>
          </div>
          <ThinkingModeControls settings={settings.thinking} variant="panel" onChange={(thinking) => onSettingsPatch({ thinking })} />
        </article>
      </div>
    </>
  );
}
