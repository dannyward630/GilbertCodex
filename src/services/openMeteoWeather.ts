import { fetchWeatherJson } from "../app/tauriClient";
import type { StoredWeatherLocation } from "./weatherLocation";
import type { WeatherSourcePlan } from "./weatherProviders";

export interface OpenMeteoWeatherDay {
  condition: string;
  dayLabel: string;
  detail: string;
  emojiCode: number;
  high?: string;
  low?: string;
  wind?: string;
}

export interface OpenMeteoWeatherHour {
  condition: string;
  name: string;
  precipitation?: string;
  temperature: string;
  wind: string;
}

export interface OpenMeteoWeatherSnapshot {
  condition: string;
  dailyForecast: OpenMeteoWeatherDay[];
  hourlyForecast: OpenMeteoWeatherHour[];
  isDay: boolean;
  latitude: number;
  longitude: number;
  place: string;
  sourceDetail: string;
  sourceLabel: string;
  temperature: string;
  unitLabel: "C" | "F";
  updatedAt: string;
}

export async function loadOpenMeteoWeather(location: StoredWeatherLocation, plan: WeatherSourcePlan): Promise<OpenMeteoWeatherSnapshot> {
  const response = await fetchWeatherJson({ url: createOpenMeteoForecastUrl(location, plan) });
  const payload = asRecord(response.payload);
  const hourly = asRecord(payload.hourly);
  const unitLabel = location.preferredUnits === "us" ? "F" : "C";
  const currentIndex = findCurrentHourlyIndex(hourly, location.timezone);
  const hourlyTimes = arrayValue(hourly.time);
  const hourlyCodes = arrayValue(hourly.weather_code);
  const hourlyTemperatures = arrayValue(hourly.temperature_2m);
  const weatherCode = numberValue(hourlyCodes[currentIndex]);
  const condition = describeWeatherCode(weatherCode);
  const temperature = numberValue(hourlyTemperatures[currentIndex]);
  const isDay = isDaytime(String(hourlyTimes[currentIndex] ?? ""), location.timezone);

  return {
    condition,
    dailyForecast: createDailyForecastFromHourly(hourly),
    hourlyForecast: createHourlyForecast(hourly),
    isDay,
    latitude: location.latitude,
    longitude: location.longitude,
    place: `${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}`,
    sourceDetail: plan.forecastStatus,
    sourceLabel: plan.forecastLabel,
    temperature: Number.isFinite(temperature) ? `${Math.round(temperature)}\u00b0` : "--\u00b0",
    unitLabel,
    updatedAt: new Date().toISOString(),
  };
}

function createOpenMeteoForecastUrl(location: StoredWeatherLocation, plan?: WeatherSourcePlan) {
  const endpoint = plan ? getOpenMeteoEndpoint(plan) : "https://api.open-meteo.com/v1/forecast";
  const url = new URL(endpoint);
  url.searchParams.set("latitude", formatCoordinate(location.latitude));
  url.searchParams.set("longitude", formatCoordinate(location.longitude));
  url.searchParams.set("hourly", "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m");
  url.searchParams.set("forecast_days", getOpenMeteoForecastDays(plan));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", location.preferredUnits === "us" ? "fahrenheit" : "celsius");
  url.searchParams.set("wind_speed_unit", location.preferredUnits === "us" ? "mph" : "kmh");
  url.searchParams.set("precipitation_unit", location.preferredUnits === "us" ? "inch" : "mm");
  return url.toString();
}

function createHourlyForecast(hourly: Record<string, unknown>): OpenMeteoWeatherHour[] {
  const times = arrayValue(hourly.time);
  const codes = arrayValue(hourly.weather_code);
  const temperatures = arrayValue(hourly.temperature_2m);
  const precip = arrayValue(hourly.precipitation);
  const winds = arrayValue(hourly.wind_speed_10m);
  const hours: OpenMeteoWeatherHour[] = [];
  const startIndex = findCurrentHourlyIndex(hourly);

  for (let index = startIndex; index < Math.min(times.length, startIndex + 8); index += 1) {
    const weatherCode = numberValue(codes[index]);
    const temperature = numberValue(temperatures[index]);
    const precipitation = numberValue(precip[index]);
    const wind = numberValue(winds[index]);

    hours.push({
      condition: describeWeatherCode(weatherCode),
      name: formatForecastHour(String(times[index] ?? ""), index),
      precipitation: Number.isFinite(precipitation) && precipitation > 0 ? `${formatPrecipitation(precipitation)} precip` : "",
      temperature: Number.isFinite(temperature) ? `${Math.round(temperature)}\u00b0` : "--",
      wind: Number.isFinite(wind) ? `${Math.round(wind)} wind` : "",
    });
  }

  return hours;
}

function createDailyForecastFromHourly(hourly: Record<string, unknown>): OpenMeteoWeatherDay[] {
  const times = arrayValue(hourly.time);
  const codes = arrayValue(hourly.weather_code);
  const temperatures = arrayValue(hourly.temperature_2m);
  const precip = arrayValue(hourly.precipitation);
  const winds = arrayValue(hourly.wind_speed_10m);
  const dayBuckets = new Map<string, { code: number; high: number; low: number; precipitation: number; time: string; wind: number }>();

  for (let index = 0; index < times.length; index += 1) {
    const time = String(times[index] ?? "");
    const dayKey = time.slice(0, 10);
    const temperature = numberValue(temperatures[index]);

    if (!dayKey || !Number.isFinite(temperature)) {
      continue;
    }

    const current = dayBuckets.get(dayKey) ?? {
      code: numberValue(codes[index]),
      high: temperature,
      low: temperature,
      precipitation: 0,
      time,
      wind: 0,
    };
    current.high = Math.max(current.high, temperature);
    current.low = Math.min(current.low, temperature);
    current.precipitation += Math.max(0, numberValue(precip[index]) || 0);
    current.wind = Math.max(current.wind, numberValue(winds[index]) || 0);

    const hour = Number.parseInt(time.slice(11, 13), 10);
    if (Number.isFinite(hour) && hour >= 11 && hour <= 15) {
      current.code = numberValue(codes[index]);
    }

    dayBuckets.set(dayKey, current);
  }

  return [...dayBuckets.values()].slice(0, 7).map((day, index) => {
    const condition = describeWeatherCode(day.code);
    const precipitationLabel = day.precipitation > 0 ? `${formatPrecipitation(day.precipitation)} precip` : "";
    const windLabel = day.wind > 0 ? `${Math.round(day.wind)} wind` : "";

    return {
      condition,
      dayLabel: formatForecastDay(day.time, index),
      detail: [condition, precipitationLabel, windLabel].filter(Boolean).join(" / "),
      emojiCode: day.code,
      high: `${Math.round(day.high)}\u00b0`,
      low: `${Math.round(day.low)}\u00b0`,
      wind: [windLabel, precipitationLabel].filter(Boolean).join(" / "),
    };
  });
}

function findCurrentHourlyIndex(hourly: Record<string, unknown>, timezone = "") {
  const times = arrayValue(hourly.time);
  const now = Date.now();

  for (let index = 0; index < times.length; index += 1) {
    const timestamp = parseLocalForecastTime(String(times[index] ?? ""), timezone);

    if (Number.isFinite(timestamp) && timestamp >= now - 60 * 60_000) {
      return index;
    }
  }

  return 0;
}

function parseLocalForecastTime(value: string, timezone: string) {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  if (!timezone) {
    return Date.parse(`${value}:00`);
  }

  const localDate = new Date(`${value}:00`);
  return localDate.getTime();
}

function isDaytime(value: string, timezone: string) {
  try {
    const date = value ? new Date(value) : new Date();
    const hour = Number.parseInt(new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || undefined,
    }).format(date), 10);

    return Number.isFinite(hour) ? hour >= 6 && hour < 20 : true;
  } catch {
    return true;
  }
}

function formatPrecipitation(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value > 0 && value < 1) {
    return value.toFixed(1);
  }

  return String(Math.round(value));
}

function getOpenMeteoEndpoint(plan: WeatherSourcePlan) {
  if (plan.forecastRuntimeProvider.id === "dwd") {
    return "https://api.open-meteo.com/v1/dwd-icon";
  }

  if (plan.forecastRuntimeProvider.id === "eccc") {
    return "https://api.open-meteo.com/v1/gem";
  }

  if (plan.forecastRuntimeProvider.id === "bom") {
    return "https://api.open-meteo.com/v1/bom";
  }

  if (plan.forecastRuntimeProvider.id === "cma") {
    return "https://api.open-meteo.com/v1/cma";
  }

  if (plan.forecastRuntimeProvider.id === "metNorway") {
    return "https://api.open-meteo.com/v1/metno";
  }

  if (plan.forecastRuntimeProvider.id === "nws") {
    return "https://api.open-meteo.com/v1/gfs";
  }

  return "https://api.open-meteo.com/v1/forecast";
}

function getOpenMeteoForecastDays(plan?: WeatherSourcePlan) {
  return plan?.forecastRuntimeProvider.id === "metNorway" ? "3" : "7";
}

export function describeWeatherCode(code: number) {
  if (code === 0) {
    return "Clear";
  }

  if (code === 1) {
    return "Mostly clear";
  }

  if (code === 2) {
    return "Partly cloudy";
  }

  if (code === 3) {
    return "Overcast";
  }

  if (code === 45 || code === 48) {
    return "Fog";
  }

  if (code >= 51 && code <= 57) {
    return "Drizzle";
  }

  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return "Rain showers";
  }

  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return "Snow showers";
  }

  if (code >= 95 && code <= 99) {
    return "Thunderstorms";
  }

  return "Forecast";
}

function formatForecastDay(isoDate: string, fallbackIndex: number) {
  if (!isoDate) {
    return fallbackIndex === 0 ? "Today" : `Day ${fallbackIndex + 1}`;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(new Date(`${isoDate}T12:00:00`));
  } catch {
    return fallbackIndex === 0 ? "Today" : `Day ${fallbackIndex + 1}`;
  }
}

function formatForecastHour(isoDate: string, fallbackIndex: number) {
  if (!isoDate) {
    return fallbackIndex === 0 ? "Now" : `+${fallbackIndex} h`;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).format(new Date(isoDate));
  } catch {
    return fallbackIndex === 0 ? "Now" : `+${fallbackIndex} h`;
  }
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}
