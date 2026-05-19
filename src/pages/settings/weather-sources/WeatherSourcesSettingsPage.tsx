import { CheckCircle2, ExternalLink, Globe2, MapPin, Radar, RotateCcw, ShieldAlert, SlidersHorizontal, Thermometer } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { loadStoredWeatherLocation, resolveWeatherUnitPreference } from "../../../services/weatherLocation";
import { getWeatherProviderRuntimeLabel, resolveWeatherSourcePlan, WEATHER_PROVIDER_REGISTRY } from "../../../services/weatherProviders";
import { loadWeatherSourceSettings, saveWeatherSourceSettings } from "../../../services/weatherSettings";
import type { AppPersonalizationSettings } from "../../../types/settings";
import { DEFAULT_WEATHER_SOURCE_SETTINGS, normalizeWeatherSourceSettings, type WeatherProviderId, type WeatherSourceSettings, type WeatherTemperatureUnitMode } from "../../../types/weather";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface WeatherSourcesSettingsPageProps {
  onPersonalizationChange: (settings: AppPersonalizationSettings) => void;
  personalization: AppPersonalizationSettings;
  showHeading?: boolean;
}

export function WeatherSourcesSettingsPage({ onPersonalizationChange, personalization, showHeading = true }: WeatherSourcesSettingsPageProps) {
  const [settings, setSettings] = useState<WeatherSourceSettings>(() => loadWeatherSourceSettings());
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const [location] = useState(() => loadStoredWeatherLocation());
  const locationServicesEnabled = personalization.locationServicesEnabled;
  const sourcePlan = useMemo(() => resolveWeatherSourcePlan(location, settings), [location, settings]);
  const unitResolution = useMemo(() => resolveWeatherUnitPreference(sourcePlan.countryCode, settings.temperatureUnitMode), [settings.temperatureUnitMode, sourcePlan.countryCode]);

  function patchSettings(patch: Partial<WeatherSourceSettings>) {
    const nextSettings = normalizeWeatherSourceSettings({
      ...settings,
      ...patch,
    });

    setSettings(nextSettings);
    saveWeatherSourceSettings(nextSettings);
    setStatus(null);
  }

  function resetSettings() {
    setSettings(DEFAULT_WEATHER_SOURCE_SETTINGS);
    saveWeatherSourceSettings(DEFAULT_WEATHER_SOURCE_SETTINGS);
    setStatus({ kind: "success", text: "Weather source routing reset to automatic global defaults." });
  }

  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Choose how Gilbert routes forecasts, alerts, radar, and global fallbacks for each country." icon={Globe2} title="Weather" /> : null}

      <div className="weather-sources-layout">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <MapPin size={19} aria-hidden="true" />
            <div>
              <h2>Location services</h2>
              <p>Controls whether Gilbert can use saved or computer-provided location for weather, radar, Mapbox, and country-aware routing.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Weather location access</span>
              <strong>{locationServicesEnabled ? "Weather, radar, and country-aware source routing are available." : "Weather and radar are hidden, and location-based weather refreshes are blocked."}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={locationServicesEnabled}
                aria-label={locationServicesEnabled ? "Turn off weather location services" : "Turn on weather location services"}
                data-on={locationServicesEnabled}
                onClick={() => onPersonalizationChange({ ...personalization, locationServicesEnabled: !locationServicesEnabled })}
              >
                <span />
              </button>
            </div>
          </div>
          {!locationServicesEnabled ? (
            <div className="settings-warning">
              <span>Location services are off. Weather source choices stay saved, but automatic computer-location routing and weather surfaces stay paused until this is turned back on.</span>
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Thermometer size={19} aria-hidden="true" />
            <div>
              <h2>Temperature units</h2>
              <p>Automatic mode uses the saved country. You can force Fahrenheit or Celsius for every weather surface.</p>
            </div>
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Weather temperature units">
            {TEMPERATURE_UNIT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={settings.temperatureUnitMode === option.value}
                data-selected={settings.temperatureUnitMode === option.value}
                onClick={() => patchSettings({ temperatureUnitMode: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>Active weather unit</span>
              <strong>{formatUnitResolution(unitResolution)}</strong>
              <span className="settings-row-static-pill">{unitResolution.temperatureUnit}</span>
            </div>
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <div>
              <h2>Source routing</h2>
              <p>Automatic mode chooses the best official source for the saved country and falls back globally when a native connector is not installed yet.</p>
            </div>
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Weather source routing mode">
            <button type="button" role="radio" aria-checked={settings.mode === "auto"} data-selected={settings.mode === "auto"} onClick={() => patchSettings({ mode: "auto" })}>
              Auto
            </button>
            <button type="button" role="radio" aria-checked={settings.mode === "manual"} data-selected={settings.mode === "manual"} onClick={() => patchSettings({ mode: "manual" })}>
              Manual
            </button>
          </div>

          <div className="weather-source-provider-grid" role="radiogroup" aria-label="Manual weather provider">
            {WEATHER_PROVIDER_REGISTRY.map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={settings.mode === "manual" && settings.manualProviderId === provider.id}
                data-selected={settings.mode === "manual" && settings.manualProviderId === provider.id}
                onClick={() => patchSettings({ manualProviderId: provider.id as WeatherProviderId, mode: "manual" })}
              >
                <span>{provider.shortLabel}</span>
                <strong>{provider.regionLabel}</strong>
                <small>{getWeatherProviderRuntimeLabel(provider.runtimeStatus)}</small>
              </button>
            ))}
          </div>

          <div className="settings-row-list">
            <ToggleRow label="Global forecast fallback" value={settings.allowGlobalFallback} onToggle={() => patchSettings({ allowGlobalFallback: !settings.allowGlobalFallback })} />
            <ToggleRow label="Prefer official alerts" value={settings.preferOfficialAlerts} onToggle={() => patchSettings({ preferOfficialAlerts: !settings.preferOfficialAlerts })} />
            <ToggleRow label="Show source badges" value={settings.showSourceBadges} onToggle={() => patchSettings({ showSourceBadges: !settings.showSourceBadges })} />
          </div>

          <div className="settings-actions-row">
            <button className="settings-ghost-button" type="button" onClick={resetSettings}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset routing
            </button>
          </div>

          {status ? (
            <div className="settings-status-banner" data-kind={status.kind}>
              {status.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <CheckCircle2 size={19} aria-hidden="true" />
            <div>
              <h2>Current location routing</h2>
              <p>{location ? `Saved country: ${sourcePlan.countryCode}` : "No saved weather location yet. Save a location from the weather popover or radar map."}</p>
            </div>
          </div>

          {!locationServicesEnabled ? (
            <div className="settings-warning">
              <span>Location services are off. Routing settings are saved, but weather surfaces stay hidden until location services are enabled again.</span>
            </div>
          ) : null}

          <div className="weather-source-route-grid">
            <RouteCard icon={<Globe2 size={17} aria-hidden="true" />} label="Forecast" title={sourcePlan.forecastLabel} detail={sourcePlan.forecastStatus} />
            <RouteCard icon={<ShieldAlert size={17} aria-hidden="true" />} label="Alerts" title={sourcePlan.alertProvider.label} detail={sourcePlan.alertStatus} />
            <RouteCard icon={<Radar size={17} aria-hidden="true" />} label="Radar" title={sourcePlan.radarProvider?.label || "No radar source"} detail={sourcePlan.radarStatus} />
            <RouteCard icon={<Thermometer size={17} aria-hidden="true" />} label="Units" title={formatUnitResolution(unitResolution)} detail={settings.temperatureUnitMode === "auto" ? "Country default is applied to every forecast request." : "Manual override is applied to every forecast request."} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Globe2 size={19} aria-hidden="true" />
            <div>
              <h2>Provider registry</h2>
              <p>Official services stay separate from the global fallback so alerts and attribution never pretend to be something they are not.</p>
            </div>
          </div>

          <div className="weather-source-registry">
            {WEATHER_PROVIDER_REGISTRY.map((provider) => (
              <article className="weather-source-provider-card" key={provider.id}>
                <div>
                  <span>{provider.shortLabel}</span>
                  <strong>{provider.label}</strong>
                  <p>{provider.notes}</p>
                </div>
                <div className="weather-source-pill-list">
                  <span data-kind={provider.sourceType}>{provider.sourceType === "official" ? "Official" : "Fallback"}</span>
                  <span data-kind={provider.runtimeStatus}>{getWeatherProviderRuntimeLabel(provider.runtimeStatus)}</span>
                  <span>{provider.capabilities.join(", ")}</span>
                </div>
                <div className="weather-source-links">
                  <a href={provider.docsUrl} rel="noreferrer" target="_blank">
                    <span>Docs</span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  {provider.licenseUrl ? (
                    <a href={provider.licenseUrl} rel="noreferrer" target="_blank">
                      <span>License</span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </article>
      </div>
    </>
  );
}

const TEMPERATURE_UNIT_OPTIONS: Array<{ label: string; value: WeatherTemperatureUnitMode }> = [
  { label: "Auto by country", value: "auto" },
  { label: "Fahrenheit", value: "fahrenheit" },
  { label: "Celsius", value: "celsius" },
];

function formatUnitResolution(resolution: ReturnType<typeof resolveWeatherUnitPreference>) {
  const unitName = resolution.temperatureUnit === "F" ? "Fahrenheit" : "Celsius";

  if (resolution.source === "manual") {
    return `${unitName} (manual)`;
  }

  if (resolution.countryCode === "XX") {
    return `${unitName} by default`;
  }

  return `${unitName} for ${resolution.countryCode}`;
}

function ToggleRow({ label, onToggle, value }: { label: string; onToggle: () => void; value: boolean }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong>{value ? "On" : "Off"}</strong>
      <button className="settings-switch" type="button" role="switch" aria-checked={value} data-on={value} onClick={onToggle}>
        <span />
      </button>
    </div>
  );
}

function RouteCard({ detail, icon, label, title }: { detail: string; icon: ReactNode; label: string; title: string }) {
  return (
    <article className="weather-source-route-card">
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </article>
  );
}
