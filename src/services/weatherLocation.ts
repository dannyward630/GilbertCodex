import { loadAppPersonalizationSettings, loadPersistentString, savePersistentString } from "../lib/appStorage";
import type { WeatherTemperatureUnitMode } from "../types/weather";

const WEATHER_LOCATION_KEY = "gilbert-codex.weather-location.v1";
const FAHRENHEIT_COUNTRIES = new Set(["AS", "BS", "BZ", "FM", "GU", "KY", "LR", "MH", "MP", "PR", "PW", "UM", "US", "VI"]);

export interface StoredWeatherLocation {
  accuracyMeters?: number;
  capturedAt: string;
  countryCode: string;
  countrySource: "coordinate" | "locale" | "manual" | "unknown";
  latitude: number;
  locale: string;
  longitude: number;
  preferredUnits: "metric" | "us";
  source: "browser-geolocation" | "manual";
  temperatureUnit: "C" | "F";
  timezone: string;
}

export interface WeatherUnitResolution {
  countryCode: string;
  mode: WeatherTemperatureUnitMode;
  preferredUnits: StoredWeatherLocation["preferredUnits"];
  source: "country" | "manual";
  temperatureUnit: StoredWeatherLocation["temperatureUnit"];
}

export function loadStoredWeatherLocation(): StoredWeatherLocation | null {
  const rawValue = loadPersistentString(WEATHER_LOCATION_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return normalizeStoredWeatherLocation(JSON.parse(rawValue));
  } catch {
    return null;
  }
}

export function saveStoredWeatherLocation(location: StoredWeatherLocation) {
  savePersistentString(WEATHER_LOCATION_KEY, JSON.stringify(normalizeStoredWeatherLocation(location)));
}

export async function requestAndRememberWeatherLocation(): Promise<StoredWeatherLocation | null> {
  if (!areLocationServicesEnabled()) {
    return null;
  }

  const existingLocation = loadStoredWeatherLocation();

  if (existingLocation) {
    return existingLocation;
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = createStoredWeatherLocation({
          accuracyMeters: position.coords.accuracy,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "browser-geolocation",
        });
        saveStoredWeatherLocation(location);
        resolve(location);
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        maximumAge: 24 * 60 * 60 * 1000,
        timeout: 12_000,
      },
    );
  });
}

export function areLocationServicesEnabled() {
  return loadAppPersonalizationSettings().locationServicesEnabled;
}

export function createStoredWeatherLocation({
  accuracyMeters,
  countryCode,
  latitude,
  longitude,
  source = "manual",
  temperatureUnitMode = "auto",
}: {
  accuracyMeters?: number;
  countryCode?: string;
  latitude: number;
  longitude: number;
  source?: StoredWeatherLocation["source"];
  temperatureUnitMode?: WeatherTemperatureUnitMode;
}): StoredWeatherLocation {
  const locale = getPrimaryLocale();
  const timezone = getDeviceTimezone();
  const coordinateCountry = inferCountryCodeFromCoordinates(latitude, longitude);
  const manualCountry = normalizeCountryCode(countryCode);
  const localeCountry = inferCountryCodeFromLocale(locale);
  const timezoneCountry = inferCountryCodeFromTimezone(timezone);
  const resolvedCountry = manualCountry || coordinateCountry || localeCountry || timezoneCountry;
  const countrySource: StoredWeatherLocation["countrySource"] = manualCountry
    ? "manual"
    : coordinateCountry
      ? "coordinate"
      : localeCountry || timezoneCountry
        ? "locale"
        : "unknown";
  const unitResolution = resolveWeatherUnitPreference(resolvedCountry, temperatureUnitMode);

  return {
    accuracyMeters: Number.isFinite(accuracyMeters) ? Math.max(0, Math.round(accuracyMeters ?? 0)) : undefined,
    capturedAt: new Date().toISOString(),
    countryCode: resolvedCountry,
    countrySource,
    latitude,
    locale,
    longitude,
    preferredUnits: unitResolution.preferredUnits,
    source,
    temperatureUnit: unitResolution.temperatureUnit,
    timezone,
  };
}

export function getPreferredWeatherUnits(countryCode: string) {
  return FAHRENHEIT_COUNTRIES.has(normalizeCountryCode(countryCode)) ? "us" : "metric";
}

export function resolveWeatherUnitPreference(countryCode: string, mode: WeatherTemperatureUnitMode = "auto"): WeatherUnitResolution {
  const normalizedCountryCode = normalizeCountryCode(countryCode) || "XX";
  const preferredUnits = mode === "fahrenheit" ? "us" : mode === "celsius" ? "metric" : getPreferredWeatherUnits(normalizedCountryCode);

  return {
    countryCode: normalizedCountryCode,
    mode,
    preferredUnits,
    source: mode === "auto" ? "country" : "manual",
    temperatureUnit: preferredUnits === "us" ? "F" : "C",
  };
}

export function resolveStoredWeatherLocationUnits(location: StoredWeatherLocation, mode: WeatherTemperatureUnitMode = "auto"): StoredWeatherLocation {
  const unitResolution = resolveWeatherUnitPreference(location.countryCode, mode);

  if (location.preferredUnits === unitResolution.preferredUnits && location.temperatureUnit === unitResolution.temperatureUnit) {
    return location;
  }

  return {
    ...location,
    preferredUnits: unitResolution.preferredUnits,
    temperatureUnit: unitResolution.temperatureUnit,
  };
}

export function normalizeCountryCode(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  return normalized.length === 2 ? normalized : "";
}

export function isValidWeatherCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function normalizeStoredWeatherLocation(value: unknown): StoredWeatherLocation {
  const record = typeof value === "object" && value ? (value as Partial<StoredWeatherLocation>) : {};
  const latitude = normalizeCoordinate(record.latitude, -90, 90);
  const longitude = normalizeCoordinate(record.longitude, -180, 180);
  const timezone = typeof record.timezone === "string" && record.timezone.trim() ? record.timezone.trim() : getDeviceTimezone();
  const countryCode = normalizeCountryCode(record.countryCode) || inferCountryCodeFromCoordinates(latitude, longitude) || inferCountryCodeFromLocale(record.locale) || inferCountryCodeFromTimezone(timezone);
  const preferredUnits = record.preferredUnits === "metric" || record.preferredUnits === "us" ? record.preferredUnits : getPreferredWeatherUnits(countryCode);
  const source = record.source === "browser-geolocation" || record.source === "manual" ? record.source : "manual";
  const countrySource =
    record.countrySource === "coordinate" || record.countrySource === "locale" || record.countrySource === "manual" || record.countrySource === "unknown"
      ? record.countrySource
      : "unknown";

  return {
    accuracyMeters: Number.isFinite(record.accuracyMeters) ? Math.max(0, Math.round(record.accuracyMeters ?? 0)) : undefined,
    capturedAt: typeof record.capturedAt === "string" && record.capturedAt ? record.capturedAt : new Date().toISOString(),
    countryCode,
    countrySource,
    latitude,
    locale: typeof record.locale === "string" && record.locale.trim() ? record.locale.trim() : getPrimaryLocale(),
    longitude,
    preferredUnits,
    source,
    temperatureUnit: preferredUnits === "us" ? "F" : "C",
    timezone,
  };
}

function normalizeCoordinate(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(Math.max(parsed, min), max);
}

function getPrimaryLocale() {
  if (typeof navigator === "undefined") {
    return "en-US";
  }

  return navigator.languages?.[0] || navigator.language || "en-US";
}

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function inferCountryCodeFromLocale(locale: unknown) {
  if (typeof locale !== "string" || !locale.trim()) {
    return "";
  }

  try {
    const region = new Intl.Locale(locale).region;
    return normalizeCountryCode(region);
  } catch {
    const match = locale.match(/[-_]([a-z]{2})\b/i);
    return normalizeCountryCode(match?.[1]);
  }
}

function inferCountryCodeFromTimezone(timezone: unknown) {
  if (typeof timezone !== "string" || !timezone.trim()) {
    return "";
  }

  const normalized = timezone.trim();
  const timezoneCountryMap: Record<string, string> = {
    "Africa/Cairo": "EG",
    "Africa/Johannesburg": "ZA",
    "Africa/Lagos": "NG",
    "Africa/Nairobi": "KE",
    "America/Mexico_City": "MX",
    "America/Tijuana": "MX",
    "America/Toronto": "CA",
    "America/Vancouver": "CA",
    "Asia/Shanghai": "CN",
    "Asia/Tokyo": "JP",
    "Asia/Seoul": "KR",
    "Australia/Brisbane": "AU",
    "Australia/Melbourne": "AU",
    "Australia/Perth": "AU",
    "Australia/Sydney": "AU",
    "Europe/Berlin": "DE",
    "Europe/London": "GB",
    "Europe/Madrid": "ES",
    "Europe/Oslo": "NO",
    "Europe/Paris": "FR",
    "Europe/Rome": "IT",
  };

  return normalizeCountryCode(timezoneCountryMap[normalized]);
}

function inferCountryCodeFromCoordinates(latitude: number, longitude: number) {
  if (!isValidWeatherCoordinate(latitude, longitude)) {
    return "";
  }

  if (
    inBox(latitude, longitude, 24, 50, -125, -66) ||
    inBox(latitude, longitude, 51, 72, -170, -129) ||
    inBox(latitude, longitude, 18, 23, -161, -154) ||
    inBox(latitude, longitude, 17, 19, -68, -64) ||
    inBox(latitude, longitude, 13, 15, 144, 146) ||
    inBox(latitude, longitude, -15, -13, -172, -168)
  ) {
    return "US";
  }

  const countryBoxes: Array<[string, number, number, number, number]> = [
    ["CA", 41, 84, -141, -52],
    ["MX", 14, 33, -118, -86],
    ["DE", 47, 56, 5, 16],
    ["CN", 18, 54, 73, 135],
    ["AU", -44, -10, 112, 154],
    ["NO", 57, 72, 4, 32],
    ["GB", 49, 61, -9, 2],
    ["FR", 41, 52, -6, 10],
    ["ES", 35, 44, -10, 5],
    ["IT", 36, 48, 6, 19],
    ["BR", -34, 6, -74, -34],
    ["IN", 6, 36, 68, 98],
    ["JP", 24, 46, 122, 146],
    ["KR", 33, 39, 124, 132],
    ["ZA", -35, -22, 16, 33],
    ["NG", 4, 14, 2, 15],
    ["KE", -5, 5, 33, 42],
    ["EG", 22, 32, 24, 37],
  ];

  for (const [countryCode, south, north, west, east] of countryBoxes) {
    if (inBox(latitude, longitude, south, north, west, east)) {
      return countryCode;
    }
  }

  return "";
}

function inBox(latitude: number, longitude: number, south: number, north: number, west: number, east: number) {
  return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
}
