import { loadPersistentString, savePersistentString } from "../lib/appStorage";
import { DEFAULT_MAPBOX_SETTINGS, normalizeMapboxSettings, type MapboxSettings } from "../types/mapbox";

export const MAPBOX_SETTINGS_KEY = "gilbert-codex.mapbox-settings.v1";
export const MAPBOX_SETTINGS_CHANGED_EVENT = "gilbert-codex:mapbox-settings-changed";

export function loadMapboxSettings(): MapboxSettings {
  const rawValue = loadPersistentString(MAPBOX_SETTINGS_KEY);

  if (!rawValue) {
    return DEFAULT_MAPBOX_SETTINGS;
  }

  try {
    return normalizeMapboxSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_MAPBOX_SETTINGS;
  }
}

export function saveMapboxSettings(settings: MapboxSettings) {
  const normalizedSettings = normalizeMapboxSettings(settings);
  savePersistentString(MAPBOX_SETTINGS_KEY, JSON.stringify(normalizedSettings));
  window.dispatchEvent(new CustomEvent<MapboxSettings>(MAPBOX_SETTINGS_CHANGED_EVENT, { detail: normalizedSettings }));
}

export function subscribeMapboxSettings(listener: (settings: MapboxSettings) => void) {
  function handleSettingsChanged(event: Event) {
    listener(event instanceof CustomEvent ? normalizeMapboxSettings(event.detail) : loadMapboxSettings());
  }

  window.addEventListener(MAPBOX_SETTINGS_CHANGED_EVENT, handleSettingsChanged);

  return () => window.removeEventListener(MAPBOX_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
}
