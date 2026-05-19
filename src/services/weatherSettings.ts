import { loadPersistentString, savePersistentString } from "../lib/appStorage";
import { DEFAULT_WEATHER_SOURCE_SETTINGS, normalizeWeatherSourceSettings, type WeatherSourceSettings } from "../types/weather";

export const WEATHER_SOURCE_SETTINGS_KEY = "gilbert-codex.weather-source-settings.v1";
export const WEATHER_SOURCE_SETTINGS_CHANGED_EVENT = "gilbert-codex:weather-source-settings-changed";

export function loadWeatherSourceSettings(): WeatherSourceSettings {
  const rawValue = loadPersistentString(WEATHER_SOURCE_SETTINGS_KEY);

  if (!rawValue) {
    return DEFAULT_WEATHER_SOURCE_SETTINGS;
  }

  try {
    return normalizeWeatherSourceSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_WEATHER_SOURCE_SETTINGS;
  }
}

export function saveWeatherSourceSettings(settings: WeatherSourceSettings) {
  const normalizedSettings = normalizeWeatherSourceSettings(settings);
  savePersistentString(WEATHER_SOURCE_SETTINGS_KEY, JSON.stringify(normalizedSettings));
  window.dispatchEvent(new CustomEvent<WeatherSourceSettings>(WEATHER_SOURCE_SETTINGS_CHANGED_EVENT, { detail: normalizedSettings }));
}

export function subscribeWeatherSourceSettings(listener: (settings: WeatherSourceSettings) => void) {
  function handleSettingsChanged(event: Event) {
    listener(event instanceof CustomEvent ? normalizeWeatherSourceSettings(event.detail) : loadWeatherSourceSettings());
  }

  window.addEventListener(WEATHER_SOURCE_SETTINGS_CHANGED_EVENT, handleSettingsChanged);

  return () => window.removeEventListener(WEATHER_SOURCE_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
}
