import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchWeatherJson } from "../../app/tauriClient";
import { MapboxWeatherMap } from "../weather/MapboxWeatherMap";
import {
  createStoredWeatherLocation,
  isValidWeatherCoordinate,
  loadStoredWeatherLocation,
  normalizeCountryCode,
  requestAndRememberWeatherLocation,
  saveStoredWeatherLocation,
  type StoredWeatherLocation,
} from "../../services/weatherLocation";

interface WeatherTopBarState {
  condition: string;
  error?: string;
  emoji: string;
  forecast: WeatherForecastDay[];
  label: string;
  latitude?: number;
  loading: boolean;
  longitude?: number;
  place: string;
  temperature: string;
  updatedAt?: string;
  unitLabel: "C" | "F";
}

interface WeatherLocationDraft {
  countryCode: string;
  latitude: string;
  longitude: string;
}

interface WeatherForecastDay {
  condition: string;
  dayLabel: string;
  detail: string;
  emoji: string;
  high?: string;
  low?: string;
  wind?: string;
}

const EMPTY_WEATHER_STATE: WeatherTopBarState = {
  condition: "Weather unavailable",
  emoji: "○",
  forecast: [],
  label: "Weather unavailable",
  loading: false,
  place: "",
  temperature: "--°",
  unitLabel: "F",
};
const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const WEATHER_STALE_REFRESH_MS = WEATHER_REFRESH_INTERVAL_MS - 5_000;
const WEATHER_HEARTBEAT_MS = 30_000;

interface WeatherTopBarIndicatorProps {
  onOpenRadar?: () => void;
}

export function WeatherTopBarIndicator({ onOpenRadar }: WeatherTopBarIndicatorProps) {
  const [state, setState] = useState<WeatherTopBarState>({
    ...EMPTY_WEATHER_STATE,
    loading: true,
  });
  const [locationDraft, setLocationDraft] = useState<WeatherLocationDraft>(() => createWeatherLocationDraft(loadStoredWeatherLocation()));
  const [locationStatus, setLocationStatus] = useState("");
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const lastRefreshStartedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshWeather = useCallback(async () => {
    if (refreshInFlightRef.current) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    refreshInFlightRef.current = true;
    lastRefreshStartedAtRef.current = Date.now();
    setState((current) => ({ ...current, loading: true }));

    try {
      const location = loadStoredWeatherLocation() ?? await requestAndRememberWeatherLocation();

      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return;
      }

      if (!location) {
        setState({
          ...EMPTY_WEATHER_STATE,
          error: "Add a weather location so the desktop app can fetch NOAA/NWS data.",
        });
        setOpen(true);
        return;
      }

      const nextState = await loadCurrentWeather(location);

      if (mountedRef.current && requestId === requestIdRef.current) {
        setState(nextState);
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setState({
          ...EMPTY_WEATHER_STATE,
          error: "Weather could not load in the desktop app. Check the saved location, then refresh.",
        });
        setOpen(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        refreshInFlightRef.current = false;
      }
    }
  }, []);

  const saveManualWeatherLocation = useCallback(() => {
    const latitude = Number.parseFloat(locationDraft.latitude);
    const longitude = Number.parseFloat(locationDraft.longitude);

    if (!isValidWeatherCoordinate(latitude, longitude)) {
      setLocationStatus("Enter valid latitude and longitude.");
      return;
    }

    const location = createStoredWeatherLocation({
      countryCode: normalizeCountryCode(locationDraft.countryCode) || undefined,
      latitude,
      longitude,
      source: "manual",
    });

    saveStoredWeatherLocation(location);
    setLocationDraft(createWeatherLocationDraft(location));
    setLocationStatus("Location saved. Refreshing NOAA/NWS weather...");
    lastRefreshStartedAtRef.current = 0;
    void refreshWeather();
  }, [locationDraft.countryCode, locationDraft.latitude, locationDraft.longitude, refreshWeather]);

  const refreshWeatherIfStale = useCallback(() => {
    const lastRefreshStartedAt = lastRefreshStartedAtRef.current;

    if (!lastRefreshStartedAt || Date.now() - lastRefreshStartedAt >= WEATHER_STALE_REFRESH_MS) {
      void refreshWeather();
    }
  }, [refreshWeather]);

  useEffect(() => {
    mountedRef.current = true;

    function scheduleNextRefresh() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      timerRef.current = window.setTimeout(async () => {
        await refreshWeather();
        scheduleNextRefresh();
      }, millisecondsUntilNextFiveMinuteMark());
    }

    void refreshWeather().finally(scheduleNextRefresh);
    heartbeatRef.current = window.setInterval(refreshWeatherIfStale, WEATHER_HEARTBEAT_MS);

    function handleVisibleAgain() {
      if (!document.hidden) {
        refreshWeatherIfStale();
      }
    }

    window.addEventListener("focus", refreshWeatherIfStale);
    window.addEventListener("online", refreshWeatherIfStale);
    document.addEventListener("visibilitychange", handleVisibleAgain);

    return () => {
      mountedRef.current = false;

      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      if (heartbeatRef.current !== null) {
        window.clearInterval(heartbeatRef.current);
      }

      window.removeEventListener("focus", refreshWeatherIfStale);
      window.removeEventListener("online", refreshWeatherIfStale);
      document.removeEventListener("visibilitychange", handleVisibleAgain);
    };
  }, [refreshWeather, refreshWeatherIfStale]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="topbar-weather-wrap" ref={rootRef} data-topbar-interactive="true">
      <button
        className="topbar-weather"
        type="button"
        aria-expanded={open}
        aria-label={`${state.label}. Open weather forecast.`}
        title={state.label}
        onClick={() => {
          setOpen((current) => !current);
          refreshWeatherIfStale();
        }}
      >
        <span className="topbar-weather-emoji" aria-hidden="true">
          {state.loading && !state.updatedAt ? "…" : state.emoji}
        </span>
        <span className="topbar-weather-temp">{state.loading && !state.updatedAt ? "--°" : state.temperature}</span>
      </button>
      {open ? (
        <WeatherForecastPopover
          locationDraft={locationDraft}
          locationStatus={locationStatus}
          state={state}
          onDraftChange={setLocationDraft}
          onOpenRadar={onOpenRadar}
          onRefresh={() => void refreshWeather()}
          onSaveLocation={saveManualWeatherLocation}
        />
      ) : null}
    </div>
  );
}

async function loadCurrentWeather(location: StoredWeatherLocation): Promise<WeatherTopBarState> {
  const pointUrl = `https://api.weather.gov/points/${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`;
  const point = await fetchWeatherJson({ url: pointUrl });
  const pointProperties = asRecord(asRecord(point.payload).properties);
  const stationsUrl = stringValue(pointProperties.observationStations);
  const forecastUrl = stringValue(pointProperties.forecast);
  const hourlyUrl = stringValue(pointProperties.forecastHourly);
  const place = formatPlace(pointProperties);
  const sevenDayPayload = forecastUrl
    ? await fetchWeatherJson({
        url: appendQueryParams(forecastUrl, {
          units: location.preferredUnits === "metric" ? "si" : "us",
        }),
      }).catch(() => null)
    : null;
  const hourlyForecast = hourlyUrl
    ? await fetchWeatherJson({
        url: appendQueryParams(hourlyUrl, {
          units: location.preferredUnits === "metric" ? "si" : "us",
        }),
      }).catch(() => null)
    : null;
  const sevenDayForecast = sevenDayPayload ? createSevenDayForecast(sevenDayPayload.payload) : hourlyForecast ? createSevenDayForecast(hourlyForecast.payload) : [];

  if (stationsUrl) {
    const stations = await fetchWeatherJson({ url: stationsUrl });
    const stationId = getFirstStationId(stations.payload);

    if (stationId) {
      const observation = await fetchWeatherJson({
        url: `https://api.weather.gov/stations/${encodeURIComponent(stationId)}/observations/latest`,
      });
      const observedState = createObservationState(observation.payload, location, place);

      if (observedState) {
        return {
          ...observedState,
          forecast: sevenDayForecast,
          latitude: location.latitude,
          longitude: location.longitude,
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  if (hourlyForecast) {
    const forecastState = createHourlyForecastState(hourlyForecast.payload, location, place);

    if (forecastState) {
        return {
          ...forecastState,
          forecast: sevenDayForecast,
          latitude: location.latitude,
          longitude: location.longitude,
          updatedAt: new Date().toISOString(),
        };
    }
  }

  return EMPTY_WEATHER_STATE;
}

function createWeatherLocationDraft(location: StoredWeatherLocation | null): WeatherLocationDraft {
  return {
    countryCode: location?.countryCode || "US",
    latitude: typeof location?.latitude === "number" && Number.isFinite(location.latitude) ? formatDraftCoordinate(location.latitude) : "",
    longitude: typeof location?.longitude === "number" && Number.isFinite(location.longitude) ? formatDraftCoordinate(location.longitude) : "",
  };
}

function createObservationState(payload: unknown, location: StoredWeatherLocation, place: string): WeatherTopBarState | null {
  const properties = asRecord(asRecord(payload).properties);
  const condition = stringValue(properties.textDescription) || "Current weather";
  const celsius = measurementValue(properties.temperature);

  if (!Number.isFinite(celsius)) {
    return null;
  }

  const temperature = location.preferredUnits === "us" ? `${Math.round((celsius * 9) / 5 + 32)}°` : `${Math.round(celsius)}°`;
  const unitLabel = location.preferredUnits === "us" ? "F" : "C";

  return {
    condition,
    emoji: emojiForCondition(condition, isNightTime(location.timezone)),
    forecast: [],
    label: [place, `${temperature}${unitLabel}`, condition].filter(Boolean).join(" · "),
    loading: false,
    place,
    temperature,
    unitLabel,
  };
}

function createHourlyForecastState(payload: unknown, location: StoredWeatherLocation, place: string): WeatherTopBarState | null {
  const periods = asRecord(asRecord(payload).properties).periods;

  if (!Array.isArray(periods) || periods.length === 0) {
    return null;
  }

  const firstPeriod = asRecord(periods[0]);
  const rawTemperature = firstPeriod.temperature;
  const parsedTemperature = typeof rawTemperature === "number" ? rawTemperature : Number.parseFloat(String(rawTemperature ?? ""));

  if (!Number.isFinite(parsedTemperature)) {
    return null;
  }

  const condition = stringValue(firstPeriod.shortForecast) || "Forecast";
  const temperature = `${Math.round(parsedTemperature)}°`;
  const unitLabel = location.preferredUnits === "us" ? "F" : "C";

  return {
    condition,
    emoji: emojiForCondition(condition, typeof firstPeriod.isDaytime === "boolean" ? !firstPeriod.isDaytime : isNightTime(location.timezone)),
    forecast: [],
    label: [place, `${temperature}${unitLabel}`, condition].filter(Boolean).join(" · "),
    loading: false,
    place,
    temperature,
    unitLabel,
  };
}

function WeatherForecastPopover({
  locationDraft,
  locationStatus,
  onDraftChange,
  onOpenRadar,
  onRefresh,
  onSaveLocation,
  state,
}: {
  locationDraft: WeatherLocationDraft;
  locationStatus: string;
  onDraftChange: (draft: WeatherLocationDraft) => void;
  onOpenRadar?: () => void;
  onRefresh: () => void;
  onSaveLocation: () => void;
  state: WeatherTopBarState;
}) {
  const needsLocation = !Number.isFinite(state.latitude) || !Number.isFinite(state.longitude);

  return (
    <section className="weather-popover" aria-label="Current weather and 7 day forecast">
      <div className="weather-popover-hero">
        <div>
          <span className="weather-popover-kicker">Current location</span>
          <h2>{state.place || "Saved location"}</h2>
          <p>{state.condition}</p>
        </div>
        <div className="weather-popover-current" aria-label={`Current temperature ${state.temperature}${state.unitLabel}`}>
          <span aria-hidden="true">{state.emoji}</span>
          <strong>{state.temperature}</strong>
          <em>{state.unitLabel}</em>
        </div>
        <button
          className="weather-popover-refresh"
          type="button"
          aria-label="Refresh weather"
          title="Refresh weather"
          disabled={state.loading}
          onClick={onRefresh}
        >
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="weather-forecast-strip" aria-label="7 day forecast">
        {state.forecast.length > 0 ? (
          state.forecast.map((day) => (
            <article className="weather-day-card" key={day.dayLabel}>
              <span className="weather-day-name">{day.dayLabel}</span>
              <span className="weather-day-emoji" aria-hidden="true">{day.emoji}</span>
              <span className="weather-day-temp">
                {day.high || "--"} <small>{day.low || ""}</small>
              </span>
              <p>{day.condition}</p>
              {day.wind ? <em>{day.wind}</em> : null}
            </article>
          ))
        ) : (
          <div className="weather-forecast-empty">Forecast will appear after the next NOAA/NWS refresh.</div>
        )}
      </div>

      {state.error || needsLocation ? (
        <form
          className="weather-location-card"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveLocation();
          }}
        >
          <div>
            <span>Desktop weather location</span>
            <strong>{state.error || "Save a location to start NOAA/NWS weather."}</strong>
          </div>
          <label>
            <span>Latitude</span>
            <input inputMode="decimal" placeholder="40.7128" value={locationDraft.latitude} onChange={(event) => onDraftChange({ ...locationDraft, latitude: event.target.value })} />
          </label>
          <label>
            <span>Longitude</span>
            <input inputMode="decimal" placeholder="-74.0060" value={locationDraft.longitude} onChange={(event) => onDraftChange({ ...locationDraft, longitude: event.target.value })} />
          </label>
          <label>
            <span>Country</span>
            <input maxLength={2} placeholder="US" value={locationDraft.countryCode} onChange={(event) => onDraftChange({ ...locationDraft, countryCode: event.target.value })} />
          </label>
          <button type="submit">Save</button>
          {locationStatus ? <em>{locationStatus}</em> : null}
        </form>
      ) : null}

      <MapboxWeatherMap condition={state.condition} latitude={state.latitude} longitude={state.longitude} place={state.place} onOpenRadar={onOpenRadar} />

      <footer className="weather-popover-footer">
        <span>NOAA/NWS data</span>
        <span>{state.updatedAt ? `Updated ${formatUpdatedTime(state.updatedAt)}` : "Updates on 5 minute marks"}</span>
      </footer>
    </section>
  );
}

function createSevenDayForecast(payload: unknown): WeatherForecastDay[] {
  const periods = asRecord(asRecord(payload).properties).periods;

  if (!Array.isArray(periods)) {
    return [];
  }

  const days = new Map<string, {
    condition: string;
    dayLabel: string;
    high?: number;
    low?: number;
    wind?: string;
  }>();

  for (const rawPeriod of periods) {
    const period = asRecord(rawPeriod);
    const startTime = stringValue(period.startTime);
    const dateKey = startTime ? startTime.slice(0, 10) : stringValue(period.name);
    const temperature = typeof period.temperature === "number" ? period.temperature : Number.parseFloat(String(period.temperature ?? ""));

    if (!dateKey || !Number.isFinite(temperature)) {
      continue;
    }

    const current = days.get(dateKey) ?? {
      condition: stringValue(period.shortForecast) || "Forecast",
      dayLabel: formatForecastDay(startTime, days.size),
      wind: [stringValue(period.windSpeed), stringValue(period.windDirection)].filter(Boolean).join(" "),
    };
    const daytime = typeof period.isDaytime === "boolean" ? period.isDaytime : true;

    if (daytime) {
      current.high = Math.max(current.high ?? temperature, temperature);
      current.condition = current.condition || stringValue(period.shortForecast);
    } else {
      current.low = Math.min(current.low ?? temperature, temperature);
    }

    if (!current.wind) {
      current.wind = [stringValue(period.windSpeed), stringValue(period.windDirection)].filter(Boolean).join(" ");
    }

    days.set(dateKey, current);

    if (days.size >= 7 && [...days.values()].every((day) => day.high !== undefined || day.low !== undefined)) {
      break;
    }
  }

  return [...days.values()].slice(0, 7).map((day) => ({
    condition: day.condition,
    dayLabel: day.dayLabel,
    detail: [day.condition, day.wind].filter(Boolean).join(" · "),
    emoji: emojiForCondition(day.condition, false),
    high: day.high === undefined ? undefined : `${Math.round(day.high)}°`,
    low: day.low === undefined ? undefined : `${Math.round(day.low)}°`,
    wind: day.wind,
  }));
}

function getFirstStationId(payload: unknown) {
  const features = asRecord(payload).features;

  if (!Array.isArray(features)) {
    return "";
  }

  for (const feature of features) {
    const id = stringValue(asRecord(asRecord(feature).properties).stationIdentifier);

    if (id) {
      return id;
    }
  }

  return "";
}

function emojiForCondition(condition: string, night: boolean) {
  const normalized = condition.toLowerCase();

  if (/\b(thunder|t-?storm|lightning)\b/.test(normalized)) {
    return "⛈️";
  }

  if (/\b(snow|sleet|flurr)\b/.test(normalized)) {
    return "❄️";
  }

  if (/\b(rain|shower|drizzle)\b/.test(normalized)) {
    return "🌧️";
  }

  if (/\b(fog|mist|haze|smoke)\b/.test(normalized)) {
    return "🌫️";
  }

  if (/\b(wind|breezy|gust)\b/.test(normalized)) {
    return "💨";
  }

  if (/\b(overcast|cloudy)\b/.test(normalized)) {
    return "☁️";
  }

  if (/\b(partly|mostly|few|scattered|broken)\b/.test(normalized)) {
    return night ? "☁️" : "⛅";
  }

  if (/\b(clear|sunny|fair)\b/.test(normalized)) {
    return night ? "🌙" : "☀️";
  }

  return night ? "🌙" : "☀️";
}

function millisecondsUntilNextFiveMinuteMark() {
  const now = new Date();
  const next = new Date(now);
  const currentMinute = now.getMinutes();

  next.setSeconds(0, 0);
  next.setMinutes(Math.floor(currentMinute / 5) * 5 + 5);

  return Math.max(5_000, next.getTime() - now.getTime());
}

function isNightTime(timezone: string) {
  try {
    const hour = Number.parseInt(new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || "UTC",
    }).format(new Date()), 10);
    return Number.isFinite(hour) && (hour < 6 || hour >= 20);
  } catch {
    return false;
  }
}

function formatPlace(pointProperties: Record<string, unknown>) {
  const relative = asRecord(pointProperties.relativeLocation);
  const relativeProperties = asRecord(relative.properties);
  const city = stringValue(relativeProperties.city);
  const state = stringValue(relativeProperties.state);

  return [city, state].filter(Boolean).join(", ");
}

function formatForecastDay(isoDate: string, fallbackIndex: number) {
  if (!isoDate) {
    return fallbackIndex === 0 ? "Now" : `Day ${fallbackIndex + 1}`;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(new Date(isoDate));
  } catch {
    return fallbackIndex === 0 ? "Now" : `Day ${fallbackIndex + 1}`;
  }
}

function formatUpdatedTime(isoDate: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoDate));
  } catch {
    return "";
  }
}

function appendQueryParams(url: string, params: Record<string, string>) {
  const parsed = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }

  return parsed.toString();
}

function measurementValue(value: unknown) {
  const record = asRecord(value);
  const parsed = typeof record.value === "number" ? record.value : Number.parseFloat(String(record.value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatDraftCoordinate(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(5)).toString() : "";
}
