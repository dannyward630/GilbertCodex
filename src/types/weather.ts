export type WeatherCapability = "alerts" | "current" | "dailyForecast" | "hourlyForecast" | "modelForecast" | "radar";

export type WeatherProviderId =
  | "bom"
  | "cma"
  | "dwd"
  | "eccc"
  | "meteoalarm"
  | "metNorway"
  | "nws"
  | "openMeteo"
  | "smnMexico"
  | "wmoAlerts";

export type WeatherProviderRuntimeStatus = "native" | "registered" | "fallback";
export type WeatherProviderSourceType = "aggregator" | "official";
export type WeatherSourceMode = "auto" | "manual";
export type WeatherTemperatureUnitMode = "auto" | "celsius" | "fahrenheit";

export interface WeatherProviderDefinition {
  authority: string;
  capabilities: WeatherCapability[];
  countries: string[];
  docsUrl: string;
  hosts: string[];
  id: WeatherProviderId;
  label: string;
  licenseUrl?: string;
  notes: string;
  regionLabel: string;
  runtimeStatus: WeatherProviderRuntimeStatus;
  shortLabel: string;
  sourceType: WeatherProviderSourceType;
}

export interface WeatherSourceSettings {
  allowGlobalFallback: boolean;
  manualProviderId: WeatherProviderId;
  mode: WeatherSourceMode;
  preferOfficialAlerts: boolean;
  showSourceBadges: boolean;
  temperatureUnitMode: WeatherTemperatureUnitMode;
}

export const DEFAULT_WEATHER_SOURCE_SETTINGS: WeatherSourceSettings = {
  allowGlobalFallback: true,
  manualProviderId: "openMeteo",
  mode: "auto",
  preferOfficialAlerts: true,
  showSourceBadges: true,
  temperatureUnitMode: "auto",
};

export function normalizeWeatherSourceSettings(value: unknown): WeatherSourceSettings {
  const stored = typeof value === "object" && value ? (value as Partial<WeatherSourceSettings>) : {};

  return {
    allowGlobalFallback: typeof stored.allowGlobalFallback === "boolean" ? stored.allowGlobalFallback : DEFAULT_WEATHER_SOURCE_SETTINGS.allowGlobalFallback,
    manualProviderId: isWeatherProviderId(stored.manualProviderId) ? stored.manualProviderId : DEFAULT_WEATHER_SOURCE_SETTINGS.manualProviderId,
    mode: stored.mode === "manual" ? "manual" : DEFAULT_WEATHER_SOURCE_SETTINGS.mode,
    preferOfficialAlerts: typeof stored.preferOfficialAlerts === "boolean" ? stored.preferOfficialAlerts : DEFAULT_WEATHER_SOURCE_SETTINGS.preferOfficialAlerts,
    showSourceBadges: typeof stored.showSourceBadges === "boolean" ? stored.showSourceBadges : DEFAULT_WEATHER_SOURCE_SETTINGS.showSourceBadges,
    temperatureUnitMode: isWeatherTemperatureUnitMode(stored.temperatureUnitMode) ? stored.temperatureUnitMode : DEFAULT_WEATHER_SOURCE_SETTINGS.temperatureUnitMode,
  };
}

export function isWeatherTemperatureUnitMode(value: unknown): value is WeatherTemperatureUnitMode {
  return value === "auto" || value === "celsius" || value === "fahrenheit";
}

export function isWeatherProviderId(value: unknown): value is WeatherProviderId {
  return (
    value === "bom" ||
    value === "cma" ||
    value === "dwd" ||
    value === "eccc" ||
    value === "meteoalarm" ||
    value === "metNorway" ||
    value === "nws" ||
    value === "openMeteo" ||
    value === "smnMexico" ||
    value === "wmoAlerts"
  );
}
