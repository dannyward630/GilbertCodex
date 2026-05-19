import { CheckCircle2, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { MODEL_PROVIDERS, getDefaultBaseUrlForProvider, type ModelProviderCatalogItem } from "../../../lib/models";
import type { ModelProviderId, ProviderSettings } from "../../../types/settings";
import type { SettingsStatusMessage } from "../types";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface ProvidersSettingsPageProps {
  activeProvider: ModelProviderCatalogItem;
  activeProviderApiKey: string;
  activeProviderBaseUrl: string;
  onClearApiKey: () => void;
  onSelectProvider: (provider: ModelProviderId) => void;
  onTestConnection: () => void;
  onToggleShowKey: () => void;
  onUpdateActiveProviderApiKey: (apiKey: string) => void;
  onUpdateActiveProviderBaseUrl: (baseUrl: string) => void;
  settings: ProviderSettings;
  showKey: boolean;
  showHeading?: boolean;
  testing: boolean;
  testStatus: SettingsStatusMessage | null;
}

export function ProvidersSettingsPage({
  activeProvider,
  activeProviderApiKey,
  activeProviderBaseUrl,
  onClearApiKey,
  onSelectProvider,
  onTestConnection,
  onToggleShowKey,
  onUpdateActiveProviderApiKey,
  onUpdateActiveProviderBaseUrl,
  settings,
  showKey,
  showHeading = true,
  testing,
  testStatus,
}: ProvidersSettingsPageProps) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Keep all model provider API keys, base URLs, and live catalogs in one place." icon={KeyRound} title="Providers" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Model provider</h2>
              <p>{activeProvider.detail}</p>
            </div>
          </div>

          <div className="provider-picker-grid" role="radiogroup" aria-label="Model provider">
            {MODEL_PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={settings.provider === provider.id}
                data-selected={settings.provider === provider.id}
                onClick={() => onSelectProvider(provider.id)}
              >
                <strong>{provider.label}</strong>
                <small>{provider.requiresApiKey ? "API key" : provider.optionalApiKey ? "Local, optional key" : "Local"}</small>
              </button>
            ))}
          </div>

          <label className="settings-field">
            <span>{activeProvider.apiKeyLabel}</span>
            <div className="settings-secret-row">
              <input
                autoComplete="off"
                placeholder={activeProvider.apiKeyPlaceholder}
                type={showKey ? "text" : "password"}
                value={activeProviderApiKey}
                onChange={(event) => onUpdateActiveProviderApiKey(event.target.value)}
              />
              <button type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={onToggleShowKey}>
                {showKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Clear API key" disabled={!activeProviderApiKey.trim()} onClick={onClearApiKey}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span>{activeProvider.baseUrlLabel}</span>
            <div className="settings-url-row">
              <input
                autoComplete="off"
                placeholder={activeProvider.baseUrlPlaceholder}
                value={activeProviderBaseUrl}
                onChange={(event) => onUpdateActiveProviderBaseUrl(event.target.value)}
              />
              <button type="button" onClick={() => onUpdateActiveProviderBaseUrl(getDefaultBaseUrlForProvider(settings.provider))}>
                Default
              </button>
            </div>
          </label>

          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" disabled={testing} onClick={onTestConnection}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {testing ? "Checking" : "Test provider"}
            </button>
            {testStatus ? (
              <span className="settings-status" data-kind={testStatus.kind}>
                {testStatus.text}
              </span>
            ) : null}
          </div>
        </article>
      </div>
    </>
  );
}
