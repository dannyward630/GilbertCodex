import type { ChatSource } from "../../types/chat";
import { fetchWeatherJson } from "../../app/tauriClient";
import { cosineSimilarity, createPromptEmbedding } from "../../prompts/agent/promptEmbedding";
import {
  createStoredWeatherLocation,
  getPreferredWeatherUnits,
  isValidWeatherCoordinate,
  loadStoredWeatherLocation,
  normalizeCountryCode,
  saveStoredWeatherLocation,
  type StoredWeatherLocation,
} from "../../services/weatherLocation";

export interface WeatherToolExecutionResult {
  content: string;
  sources: ChatSource[];
  // True when the tool itself failed (missing required arg, upstream lookup
  // failure). False when it ran successfully even if some sub-endpoints had
  // partial errors that are reflected in the prose body.
  isError?: boolean;
  errorCode?: string;
}

type WeatherAction =
  | "alerts"
  | "catalog"
  | "climate"
  | "forecast"
  | "grid"
  | "hourly"
  | "observations"
  | "point"
  | "raw"
  | "stations"
  | "summary"
  | "zones";

interface WeatherToolOptions {
  signal?: AbortSignal;
}

interface WeatherFetchResult<T = unknown> {
  error?: string;
  payload?: T;
  source: ChatSource;
  url: string;
}

interface ResolvedWeatherLocation {
  countryCode: string;
  latitude: number;
  longitude: number;
  preferredUnits: "metric" | "us";
  source: StoredWeatherLocation["source"] | "tool-args";
  temperatureUnit: "C" | "F";
  timezone: string;
}

const NWS_API_BASE_URL = "https://api.weather.gov";
const NCEI_DATA_SERVICE_URL = "https://www.ncei.noaa.gov/access/services/data/v1";
const WEATHER_TOOL_SOURCE_PREFIX = "weather-source";

export function isWeatherToolName(tool: string) {
  return [
    "weather",
    "weather_tool",
    "weather-tool",
    "nws",
    "nws_weather",
    "noaa",
    "noaa_weather",
    "forecast",
    "get_weather",
    "get-weather",
  ].includes(tool);
}

export async function executeWeatherTool(
  args: Record<string, string>,
  fallbackPrompt: string,
  options: WeatherToolOptions = {},
): Promise<WeatherToolExecutionResult> {
  throwIfAborted(options.signal);

  const action = normalizeWeatherAction(firstArg(args, ["action", "mode", "kind", "type"]) || inferWeatherAction(fallbackPrompt));

  if (action === "catalog") {
    return createWeatherCatalogResult();
  }

  if (action === "raw") {
    return executeRawWeatherRequest(args, options);
  }

  if (action === "climate") {
    return executeClimateWeatherRequest(args, fallbackPrompt, options);
  }

  const location = resolveWeatherLocation(args);

  if (!location) {
    return {
      content: [
        "WEATHER TOOL RESULTS - NOAA/NWS",
        "Skipped: no saved user location is available and the tool call did not include latitude and longitude.",
        "The app asks for browser geolocation on startup. If the user denied it, ask them for a city coordinate or call weather with latitude and longitude.",
      ].join("\n"),
      sources: [],
      isError: true,
      errorCode: "missing_location",
    };
  }

  if (booleanArg(args, ["remember", "save_location", "saveLocation"], false)) {
    saveStoredWeatherLocation(
      createStoredWeatherLocation({
        countryCode: location.countryCode,
        latitude: location.latitude,
        longitude: location.longitude,
        source: "manual",
      }),
    );
  }

  const unitSystem = normalizeUnitSystem(firstArg(args, ["units", "unit_system", "unitSystem"]), location.preferredUnits);
  const pointUrl = `${NWS_API_BASE_URL}/points/${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`;
  const pointResult = await fetchWeatherSource<NwsPointPayload>("NWS point metadata", pointUrl, options);

  if (pointResult.error || !pointResult.payload) {
    return {
      content: formatWeatherSections([
        "WEATHER TOOL RESULTS - NOAA/NWS",
        formatLocationLine(location, unitSystem),
        `Action: ${action}`,
        `NWS point lookup failed: ${pointResult.error || "No point payload returned."}`,
        "NWS forecasts and alerts are currently US and US-territory focused. Use action=climate or action=raw for other NOAA/NCEI datasets.",
      ]),
      sources: [pointResult.source],
      isError: true,
      errorCode: "point_lookup_failed",
    };
  }

  const point = pointResult.payload;
  const pointProperties = asRecord(point.properties);
  const sourceResults: WeatherFetchResult[] = [pointResult];

  if (action === "point") {
    return formatWeatherResult({
      action,
      facts: formatPointFacts(pointProperties),
      location,
      sections: [
        formatLocationLine(location, unitSystem, pointProperties),
        formatPointSummary(pointProperties),
      ],
      sources: sourceResults.map((result) => result.source),
      userPrompt: fallbackPrompt,
    });
  }

  const tasks = createNwsTasksForAction(action, pointProperties, location, unitSystem, args);
  const results = await Promise.all(tasks.map((task) => fetchWeatherSource(task.title, task.url, options)));
  const explicitStationId = firstArg(args, ["station", "station_id", "stationId"]);
  const stationId = explicitStationId || findFirstStationIdentifier(results);

  if ((action === "summary" || action === "observations") && stationId && !results.some((result) => result.source.title.includes("latest observation"))) {
    results.push(
      await fetchWeatherSource(
        "NWS latest observation",
        `${NWS_API_BASE_URL}/stations/${encodeURIComponent(stationId)}/observations/latest`,
        options,
      ),
    );
  }

  sourceResults.push(...results);
  throwIfAborted(options.signal);

  const facts = collectNwsFacts(action, pointProperties, results, unitSystem);
  const sections = [
    formatLocationLine(location, unitSystem, pointProperties),
    formatPointSummary(pointProperties),
    ...formatActionSections(results, unitSystem),
    formatWeatherNotes(action),
  ];

  return formatWeatherResult({
    action,
    facts,
    location,
    sections,
    sources: sourceResults.map((result) => result.source),
    userPrompt: fallbackPrompt,
  });
}

function createNwsTasksForAction(
  action: WeatherAction,
  pointProperties: Record<string, unknown>,
  location: ResolvedWeatherLocation,
  unitSystem: "metric" | "us",
  args: Record<string, string>,
) {
  const forecastUrl = stringValue(pointProperties.forecast);
  const hourlyUrl = stringValue(pointProperties.forecastHourly);
  const gridUrl = stringValue(pointProperties.forecastGridData);
  const stationsUrl = stringValue(pointProperties.observationStations);
  const forecastZoneUrl = stringValue(pointProperties.forecastZone);
  const countyUrl = stringValue(pointProperties.county);
  const fireWeatherZoneUrl = stringValue(pointProperties.fireWeatherZone);
  const alertUrl = `${NWS_API_BASE_URL}/alerts/active?point=${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`;
  const tasks: Array<{ title: string; url: string }> = [];
  const add = (title: string, url: string) => {
    if (url) {
      tasks.push({ title, url });
    }
  };
  const withUnits = (url: string) => appendQueryParams(url, { units: unitSystem === "metric" ? "si" : "us" });

  if (action === "summary" || action === "forecast") {
    add("NWS forecast", withUnits(forecastUrl));
  }

  if (action === "summary" || action === "hourly") {
    add("NWS hourly forecast", withUnits(hourlyUrl));
  }

  if (action === "summary" || action === "grid") {
    add("NWS forecast grid data", gridUrl);
  }

  if (action === "summary" || action === "alerts") {
    add("NWS active alerts", alertUrl);
  }

  if (action === "summary" || action === "observations" || action === "stations") {
    add("NWS observation stations", stationsUrl);
  }

  if (action === "zones") {
    add("NWS forecast zone", forecastZoneUrl);
    add("NWS county zone", countyUrl);
    add("NWS fire weather zone", fireWeatherZoneUrl);
  }

  if (action === "observations" && stationsUrl) {
    const stationId = firstArg(args, ["station", "station_id", "stationId"]);
    if (stationId) {
      add("NWS latest observation", `${NWS_API_BASE_URL}/stations/${encodeURIComponent(stationId)}/observations/latest`);
    }
  }

  return tasks;
}

async function executeRawWeatherRequest(
  args: Record<string, string>,
  options: WeatherToolOptions,
): Promise<WeatherToolExecutionResult> {
  const url = firstArg(args, ["url", "endpoint", "endpoint_url", "endpointUrl"]);

  if (!url) {
    return {
      content: "WEATHER TOOL RESULTS - NOAA/NWS\nSkipped: raw weather requests need a url argument on an official NOAA/NWS host.",
      sources: [],
      isError: true,
      errorCode: "missing_url",
    };
  }

  const result = await fetchWeatherSource("NOAA/NWS raw endpoint", url, options, firstArg(args, ["token", "noaa_token", "noaaToken"]));

  return formatWeatherResult({
    action: "raw",
    facts: [`Raw endpoint returned ${result.error ? "an error" : "a payload"}: ${result.url}`],
    location: null,
    sections: [
      result.error ? `Request failed: ${result.error}` : `Fetched: ${result.url}`,
      result.payload ? formatPayloadPreview(result.payload) : "",
    ],
    sources: [result.source],
    userPrompt: "",
  });
}

async function executeClimateWeatherRequest(
  args: Record<string, string>,
  fallbackPrompt: string,
  options: WeatherToolOptions,
): Promise<WeatherToolExecutionResult> {
  const location = resolveWeatherLocation(args);
  const dataset = firstArg(args, ["dataset"]) || inferClimateDataset(fallbackPrompt);
  const endDate = normalizeIsoDate(firstArg(args, ["end_date", "endDate", "to"])) || todayIsoDate();
  const startDate = normalizeIsoDate(firstArg(args, ["start_date", "startDate", "from"])) || offsetIsoDate(endDate, -7);
  const unitSystem = normalizeUnitSystem(firstArg(args, ["units", "unit_system", "unitSystem"]), location?.preferredUnits ?? "us");
  const dataTypes = firstArg(args, ["data_types", "dataTypes", "datatype", "datatypes"]) || defaultClimateDataTypes(dataset);
  const stations = firstArg(args, ["stations", "station", "station_id", "stationId"]);
  const params: Record<string, string> = {
    dataset,
    endDate,
    format: "json",
    includeStationLocation: "true",
    includeStationName: "true",
    startDate,
    units: unitSystem === "metric" ? "metric" : "standard",
  };

  if (dataTypes) {
    params.dataTypes = dataTypes;
  }

  if (stations) {
    params.stations = stations;
  } else if (location) {
    params.bbox = createClimateBoundingBox(location);
  }

  const url = appendQueryParams(NCEI_DATA_SERVICE_URL, params);
  const result = await fetchWeatherSource("NOAA/NCEI climate data", url, options, firstArg(args, ["token", "noaa_token", "noaaToken"]));
  const records = Array.isArray(result.payload) ? result.payload : [];
  const facts = records.flatMap((record, index) => formatClimateRecordFacts(record, index + 1));

  return formatWeatherResult({
    action: "climate",
    facts: facts.length > 0 ? facts : [`NOAA/NCEI climate request: ${dataset} ${startDate} to ${endDate}`],
    location,
    sections: [
      location ? formatLocationLine(location, unitSystem) : "Location: station-scoped or dataset-scoped request",
      `Dataset: ${dataset}`,
      `Date range: ${startDate} to ${endDate}`,
      dataTypes ? `Data types: ${dataTypes}` : "",
      stations ? `Stations: ${stations}` : location ? `Bounding box: ${params.bbox}` : "",
      result.error ? `Request failed: ${result.error}` : `Records returned: ${Array.isArray(result.payload) ? result.payload.length : "unknown"}`,
      records.length > 0 ? formatClimateRecords(records) : formatPayloadPreview(result.payload),
    ],
    sources: [result.source],
    userPrompt: fallbackPrompt,
  });
}

async function fetchWeatherSource<T = unknown>(
  title: string,
  url: string,
  options: WeatherToolOptions,
  token?: string,
): Promise<WeatherFetchResult<T>> {
  const source = createWeatherSource(title, url);

  try {
    throwIfAborted(options.signal);
    const response = await fetchWeatherJson({ token, url });
    throwIfAborted(options.signal);

    return {
      payload: response.payload as T,
      source: createWeatherSource(title, response.url || url),
      url: response.url || url,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return {
      error: error instanceof Error ? error.message : "Weather request failed.",
      source,
      url,
    };
  }
}

function formatWeatherResult({
  action,
  facts,
  location,
  sections,
  sources,
  userPrompt,
}: {
  action: WeatherAction;
  facts: string[];
  location: ResolvedWeatherLocation | null;
  sections: string[];
  sources: ChatSource[];
  userPrompt: string;
}): WeatherToolExecutionResult {
  const rankedFacts = rankWeatherFacts(userPrompt, facts);
  const embedding = createPromptEmbedding([userPrompt, ...facts].join("\n"));
  const sourceList = dedupeSources(sources);
  const content = formatWeatherSections([
    "WEATHER TOOL RESULTS - NOAA/NWS",
    `Action: ${action}`,
    location ? `Country/unit rule: ${location.countryCode || "unknown"} -> ${location.temperatureUnit} (${location.preferredUnits})` : "",
    `Generated: ${new Date().toISOString()}`,
    ...sections,
    rankedFacts.length > 0 ? ["Semantic weather focus:", ...rankedFacts.map((fact, index) => `${index + 1}. ${fact}`)].join("\n") : "",
    [
      "Vector embedding:",
      `${embedding.dimensions} dimensions from ${embedding.terms.length} weather/context terms.`,
      embedding.terms.length > 0 ? `Top terms: ${embedding.terms.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
    sourceList.length > 0 ? ["Sources:", ...sourceList.map((source, index) => `${index + 1}. ${source.title} - ${source.url}`)].join("\n") : "",
  ]);

  return {
    content,
    sources: sourceList,
  };
}

function collectNwsFacts(
  action: WeatherAction,
  pointProperties: Record<string, unknown>,
  results: WeatherFetchResult[],
  unitSystem: "metric" | "us",
) {
  const facts = [
    ...formatPointFacts(pointProperties),
    ...results.flatMap((result) => {
      if (!result.payload) {
        return result.error ? [`${result.source.title} failed: ${result.error}`] : [];
      }

      if (result.source.title.includes("forecast grid")) {
        return formatGridFacts(result.payload, unitSystem);
      }

      if (result.source.title.includes("hourly")) {
        return formatForecastFacts(result.payload, "hourly");
      }

      if (result.source.title.includes("forecast") && !result.source.title.includes("zone")) {
        return formatForecastFacts(result.payload, "daily");
      }

      if (result.source.title.includes("alerts")) {
        return formatAlertFacts(result.payload);
      }

      if (result.source.title.includes("observation stations")) {
        return formatStationFacts(result.payload);
      }

      if (result.source.title.includes("latest observation")) {
        return formatObservationFacts(result.payload, unitSystem);
      }

      if (result.source.title.includes("zone")) {
        return formatZoneFacts(result.payload);
      }

      return [formatPayloadTitleFact(result.source.title, result.payload)];
    }),
  ].filter(Boolean);

  return facts;
}

function formatActionSections(results: WeatherFetchResult[], unitSystem: "metric" | "us") {
  const sections: string[] = [];

  for (const result of results) {
    if (result.error) {
      sections.push(`${result.source.title}: ${result.error}`);
      continue;
    }

    if (!result.payload) {
      sections.push(`${result.source.title}: no payload returned.`);
      continue;
    }

    if (result.source.title.includes("forecast grid")) {
      sections.push(formatGridSection(result.payload, unitSystem));
    } else if (result.source.title.includes("hourly")) {
      sections.push(formatForecastSection(result.payload, "Hourly forecast"));
    } else if (result.source.title.includes("forecast") && !result.source.title.includes("zone")) {
      sections.push(formatForecastSection(result.payload, "Forecast"));
    } else if (result.source.title.includes("alerts")) {
      sections.push(formatAlertSection(result.payload));
    } else if (result.source.title.includes("observation stations")) {
      sections.push(formatStationSection(result.payload));
    } else if (result.source.title.includes("latest observation")) {
      sections.push(formatObservationSection(result.payload, unitSystem));
    } else if (result.source.title.includes("zone")) {
      sections.push(formatZoneSection(result.payload));
    } else {
      sections.push(formatPayloadPreview(result.payload));
    }
  }

  return sections;
}

function formatLocationLine(location: ResolvedWeatherLocation, unitSystem: "metric" | "us", pointProperties?: Record<string, unknown>) {
  const relative = asRecord(pointProperties?.relativeLocation);
  const relativeProps = asRecord(relative.properties);
  const city = stringValue(relativeProps.city);
  const state = stringValue(relativeProps.state);
  const timezone = stringValue(pointProperties?.timeZone) || location.timezone || "UTC";
  const localTime = formatLocalTime(timezone);
  const place = [city, state].filter(Boolean).join(", ");

  return [
    `Location: ${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}${place ? ` (${place})` : ""}`,
    `Timezone: ${timezone}`,
    `Local time: ${localTime}`,
    `Units: ${unitSystem === "us" ? "F/in/mph" : "C/mm/kmh"}`,
  ].join("\n");
}

function formatPointSummary(pointProperties: Record<string, unknown>) {
  const office = stringValue(pointProperties.cwa);
  const gridId = stringValue(pointProperties.gridId);
  const gridX = numberValue(pointProperties.gridX);
  const gridY = numberValue(pointProperties.gridY);

  return [
    "NWS point:",
    office ? `Forecast office: ${office}` : "",
    gridId && Number.isFinite(gridX) && Number.isFinite(gridY) ? `Grid: ${gridId} ${gridX},${gridY}` : "",
    stringValue(pointProperties.forecastZone) ? `Forecast zone: ${stringValue(pointProperties.forecastZone)}` : "",
    stringValue(pointProperties.county) ? `County zone: ${stringValue(pointProperties.county)}` : "",
    stringValue(pointProperties.radarStation) ? `Radar station: ${stringValue(pointProperties.radarStation)}` : "",
  ].filter(Boolean).join("\n");
}

function formatForecastSection(payload: unknown, label: string) {
  const periods = getNwsPeriods(payload);

  if (periods.length === 0) {
    return `${label}: no periods returned.`;
  }

  return [
    `${label}:`,
    ...periods.map((period) => {
      const record = asRecord(period);
      const name = stringValue(record.name) || stringValue(record.startTime);
      const temp = formatTemperature(record.temperature, record.temperatureUnit);
      const wind = [stringValue(record.windSpeed), stringValue(record.windDirection)].filter(Boolean).join(" ");
      const dayFlag = typeof record.isDaytime === "boolean" ? (record.isDaytime ? "day" : "night") : "";
      const short = stringValue(record.shortForecast);
      return `- ${[name, dayFlag].filter(Boolean).join(" ")}: ${[temp, short, wind ? `wind ${wind}` : ""].filter(Boolean).join(", ")}`;
    }),
  ].join("\n");
}

function formatAlertSection(payload: unknown) {
  const features = getFeatures(payload);

  if (features.length === 0) {
    return "Active alerts: none returned for this point.";
  }

  return [
    "Active alerts:",
    ...features.map((feature) => {
      const properties = asRecord(asRecord(feature).properties);
      return `- ${stringValue(properties.event) || "Alert"}: ${stringValue(properties.headline) || stringValue(properties.description)}`;
    }),
  ].join("\n");
}

function formatStationSection(payload: unknown) {
  const features = getFeatures(payload);

  if (features.length === 0) {
    return "Observation stations: none returned.";
  }

  return [
    "Observation stations:",
    ...features.map((feature) => {
      const properties = asRecord(asRecord(feature).properties);
      return `- ${stringValue(properties.stationIdentifier) || "Station"}: ${stringValue(properties.name) || "unnamed station"}`;
    }),
  ].join("\n");
}

function formatObservationSection(payload: unknown, unitSystem: "metric" | "us") {
  const properties = asRecord(asRecord(payload).properties);
  const temperature = measurementValue(properties.temperature);
  const dewpoint = measurementValue(properties.dewpoint);
  const windSpeed = measurementValue(properties.windSpeed);
  const text = stringValue(properties.textDescription);
  const timestamp = stringValue(properties.timestamp);

  return [
    "Latest observation:",
    timestamp ? `Time: ${timestamp}` : "",
    text ? `Conditions: ${text}` : "",
    Number.isFinite(temperature) ? `Temperature: ${formatCelsiusValue(temperature, unitSystem)}` : "",
    Number.isFinite(dewpoint) ? `Dewpoint: ${formatCelsiusValue(dewpoint, unitSystem)}` : "",
    Number.isFinite(windSpeed) ? `Wind: ${formatMetersPerSecondValue(windSpeed, unitSystem)}` : "",
  ].filter(Boolean).join("\n");
}

function formatGridSection(payload: unknown, unitSystem: "metric" | "us") {
  const properties = asRecord(asRecord(payload).properties);
  const keys = ["temperature", "dewpoint", "relativeHumidity", "windSpeed", "probabilityOfPrecipitation", "quantitativePrecipitation", "skyCover"];
  const rows = keys.flatMap((key) => {
    const metric = asRecord(properties[key]);
    const values = Array.isArray(metric.values) ? metric.values : [];

    if (values.length === 0) {
      return [];
    }

    return [`- ${key}: ${values.map((value) => formatGridValue(value, unitSystem)).join("; ")}`];
  });

  return rows.length > 0 ? ["NWS grid data:", ...rows].join("\n") : "NWS grid data: no common grid values returned.";
}

function formatZoneSection(payload: unknown) {
  const properties = asRecord(asRecord(payload).properties);
  const name = stringValue(properties.name);
  const type = stringValue(properties.type);
  const state = stringValue(properties.state);
  const forecastOffices = Array.isArray(properties.forecastOffices) ? properties.forecastOffices.map(String).join(", ") : "";

  return [
    "Zone:",
    name ? `Name: ${name}` : "",
    type ? `Type: ${type}` : "",
    state ? `State: ${state}` : "",
    forecastOffices ? `Forecast offices: ${forecastOffices}` : "",
  ].filter(Boolean).join("\n");
}

function formatForecastFacts(payload: unknown, cadence: "daily" | "hourly") {
  return getNwsPeriods(payload).map((period) => {
    const record = asRecord(period);
    const name = stringValue(record.name) || stringValue(record.startTime);
    const temp = formatTemperature(record.temperature, record.temperatureUnit);
    const dayFlag = typeof record.isDaytime === "boolean" ? (record.isDaytime ? "daytime" : "nighttime") : "";
    return `${cadence} forecast ${name}: ${[temp, stringValue(record.shortForecast), dayFlag].filter(Boolean).join(", ")}`;
  });
}

function formatAlertFacts(payload: unknown) {
  const features = getFeatures(payload);

  if (features.length === 0) {
    return ["No active NWS alerts returned for the point."];
  }

  return features.map((feature) => {
    const properties = asRecord(asRecord(feature).properties);
    return `Alert ${stringValue(properties.event) || "NWS"}: ${stringValue(properties.headline) || stringValue(properties.description)}`;
  });
}

function formatStationFacts(payload: unknown) {
  return getFeatures(payload).map((feature) => {
    const properties = asRecord(asRecord(feature).properties);
    return `Observation station ${stringValue(properties.stationIdentifier) || "unknown"}: ${stringValue(properties.name) || "unnamed"}`;
  });
}

function findFirstStationIdentifier(results: WeatherFetchResult[]) {
  for (const result of results) {
    if (!result.source.title.includes("observation stations") || !result.payload) {
      continue;
    }

    for (const feature of getFeatures(result.payload)) {
      const properties = asRecord(asRecord(feature).properties);
      const id = stringValue(properties.stationIdentifier);

      if (id) {
        return id;
      }
    }
  }

  return "";
}

function formatObservationFacts(payload: unknown, unitSystem: "metric" | "us") {
  const properties = asRecord(asRecord(payload).properties);
  const facts = [stringValue(properties.textDescription) ? `Observation conditions: ${stringValue(properties.textDescription)}` : ""];
  const temperature = measurementValue(properties.temperature);

  if (Number.isFinite(temperature)) {
    facts.push(`Observed temperature: ${formatCelsiusValue(temperature, unitSystem)}`);
  }

  return facts.filter(Boolean);
}

function formatGridFacts(payload: unknown, unitSystem: "metric" | "us") {
  const properties = asRecord(asRecord(payload).properties);

  return ["temperature", "dewpoint", "relativeHumidity", "windSpeed", "probabilityOfPrecipitation"].flatMap((key) => {
    const metric = asRecord(properties[key]);
    const values = Array.isArray(metric.values) ? metric.values : [];
    return values.map((value) => `${key}: ${formatGridValue(value, unitSystem)}`);
  });
}

function formatZoneFacts(payload: unknown) {
  const properties = asRecord(asRecord(payload).properties);
  return [`Zone ${stringValue(properties.name) || "unknown"} ${stringValue(properties.type)}`.trim()];
}

function formatPointFacts(pointProperties: Record<string, unknown>) {
  const relative = asRecord(pointProperties.relativeLocation);
  const relativeProps = asRecord(relative.properties);

  return [
    stringValue(relativeProps.city) ? `NWS relative location: ${[stringValue(relativeProps.city), stringValue(relativeProps.state)].filter(Boolean).join(", ")}` : "",
    stringValue(pointProperties.cwa) ? `NWS forecast office: ${stringValue(pointProperties.cwa)}` : "",
    stringValue(pointProperties.radarStation) ? `NWS radar station: ${stringValue(pointProperties.radarStation)}` : "",
  ].filter(Boolean);
}

function createWeatherCatalogResult(): WeatherToolExecutionResult {
  const sources = [
    createWeatherSource("NWS API", "https://api.weather.gov/openapi.json"),
    createWeatherSource("NOAA/NCEI data service", "https://www.ncei.noaa.gov/access/services/data/v1"),
    createWeatherSource("NOAA tides and currents API", "https://api.tidesandcurrents.noaa.gov/api/prod/"),
    createWeatherSource("NOAA Aviation Weather API", "https://aviationweather.gov/data/api/"),
  ];
  const facts = [
    "NWS weather.gov API: points, gridpoints, forecasts, hourly forecasts, alerts, zones, offices, stations, observations, radar stations, products.",
    "NOAA/NCEI data service: bounded climate and archive slices by dataset, station, date range, bbox, and data types.",
    "NOAA tides and currents: observations, predictions, datums, metadata, and water-level products.",
    "NOAA aviation weather: METAR, TAF, SIGMET, AIRMET, station info, and aviation products.",
  ];

  return formatWeatherResult({
    action: "catalog",
    facts,
    location: null,
    sections: [
      "Supported source families:",
      ...facts.map((fact) => `- ${fact}`),
      "Use action=summary, forecast, hourly, alerts, observations, stations, grid, zones, climate, or raw. action=raw accepts allowlisted official NOAA/NWS URLs for specialized endpoints.",
    ],
    sources,
    userPrompt: "weather noaa nws catalog",
  });
}

function resolveWeatherLocation(args: Record<string, string>): ResolvedWeatherLocation | null {
  const latitude = numberArg(args, ["latitude", "lat"]);
  const longitude = numberArg(args, ["longitude", "lon", "lng", "long"]);
  const parsedLocation = parseLocationArg(firstArg(args, ["location", "coordinates", "coords"]));
  const countryCode = normalizeCountryCode(firstArg(args, ["country", "country_code", "countryCode"]));
  const timezone = firstArg(args, ["timezone", "time_zone", "timeZone"]) || "";

  if (isValidWeatherCoordinate(latitude, longitude)) {
    const created = createStoredWeatherLocation({
      countryCode,
      latitude,
      longitude,
      source: "manual",
    });
    const preferredUnits = created.preferredUnits;
    return {
      countryCode: created.countryCode,
      latitude,
      longitude,
      preferredUnits,
      source: "tool-args",
      temperatureUnit: preferredUnits === "us" ? "F" : "C",
      timezone: timezone || created.timezone || "UTC",
    };
  }

  if (parsedLocation) {
    const created = createStoredWeatherLocation({
      countryCode,
      latitude: parsedLocation.latitude,
      longitude: parsedLocation.longitude,
      source: "manual",
    });
    const preferredUnits = created.preferredUnits;
    return {
      countryCode: created.countryCode,
      latitude: parsedLocation.latitude,
      longitude: parsedLocation.longitude,
      preferredUnits,
      source: "tool-args",
      temperatureUnit: preferredUnits === "us" ? "F" : "C",
      timezone: timezone || created.timezone || "UTC",
    };
  }

  const stored = loadStoredWeatherLocation();

  if (!stored) {
    return null;
  }

  return {
    countryCode: stored.countryCode,
    latitude: stored.latitude,
    longitude: stored.longitude,
    preferredUnits: stored.preferredUnits,
    source: stored.source,
    temperatureUnit: stored.temperatureUnit,
    timezone: stored.timezone,
  };
}

function parseLocationArg(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parts = value.split(/[,\s]+/).map((part) => Number.parseFloat(part)).filter(Number.isFinite);

  if (parts.length < 2 || !isValidWeatherCoordinate(parts[0], parts[1])) {
    return null;
  }

  return {
    latitude: parts[0],
    longitude: parts[1],
  };
}

function normalizeWeatherAction(value: string): WeatherAction {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (normalized === "alert" || normalized === "warning" || normalized === "warnings") {
    return "alerts";
  }

  if (normalized === "climate_data" || normalized === "history" || normalized === "historical") {
    return "climate";
  }

  if (normalized === "daily" || normalized === "seven_day") {
    return "forecast";
  }

  if (normalized === "observation" || normalized === "current" || normalized === "conditions") {
    return "observations";
  }

  if (normalized === "station") {
    return "stations";
  }

  if (normalized === "raw_url" || normalized === "endpoint") {
    return "raw";
  }

  if (["alerts", "catalog", "climate", "forecast", "grid", "hourly", "observations", "point", "raw", "stations", "summary", "zones"].includes(normalized)) {
    return normalized as WeatherAction;
  }

  return "summary";
}

function inferWeatherAction(prompt: string): WeatherAction {
  if (/\b(alert|warning|watch|advisory|severe)\b/i.test(prompt)) {
    return "alerts";
  }

  if (/\b(hourly|hour by hour)\b/i.test(prompt)) {
    return "hourly";
  }

  if (/\b(observation|current condition|metar|station)\b/i.test(prompt)) {
    return "observations";
  }

  if (/\b(history|historical|climate|archive|daily summar)/i.test(prompt)) {
    return "climate";
  }

  if (/\b(grid|raw forecast data)\b/i.test(prompt)) {
    return "grid";
  }

  return "summary";
}

function inferClimateDataset(prompt: string) {
  if (/\bhourly|lcd|local climatological/i.test(prompt)) {
    return "local-climatological-data";
  }

  if (/\bglobal summary|gsod\b/i.test(prompt)) {
    return "global-summary-of-the-day";
  }

  return "daily-summaries";
}

function defaultClimateDataTypes(dataset: string) {
  if (dataset === "daily-summaries") {
    return "TMAX,TMIN,PRCP,SNOW,AWND";
  }

  if (dataset === "global-summary-of-the-day") {
    return "TEMP,MAX,MIN,PRCP,WDSP";
  }

  return "";
}

function normalizeUnitSystem(value: string | undefined, fallback: "metric" | "us") {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "c" || normalized === "celsius" || normalized === "metric" || normalized === "si") {
    return "metric";
  }

  if (normalized === "f" || normalized === "fahrenheit" || normalized === "imperial" || normalized === "standard" || normalized === "us") {
    return "us";
  }

  return fallback;
}

function createClimateBoundingBox(location: ResolvedWeatherLocation) {
  const radius = 0.45;
  const north = Math.min(90, location.latitude + radius);
  const south = Math.max(-90, location.latitude - radius);
  const east = Math.min(180, location.longitude + radius);
  const west = Math.max(-180, location.longitude - radius);
  return [north, west, south, east].map((value) => value.toFixed(4)).join(",");
}

function rankWeatherFacts(userPrompt: string, facts: string[]) {
  const uniqueFacts = [...new Set(facts.map((fact) => fact.trim()).filter(Boolean))];

  if (uniqueFacts.length <= 1) {
    return uniqueFacts;
  }

  const queryEmbedding = createPromptEmbedding(userPrompt || uniqueFacts.join("\n"));

  return uniqueFacts
    .map((fact, index) => ({
      fact,
      score: cosineSimilarity(queryEmbedding.vector, createPromptEmbedding(fact).vector) + Math.max(0, 1 - index / uniqueFacts.length) * 0.05,
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.fact);
}

function getNwsPeriods(payload: unknown) {
  const properties = asRecord(asRecord(payload).properties);
  const periods = properties.periods;
  return Array.isArray(periods) ? periods : [];
}

function getFeatures(payload: unknown) {
  const features = asRecord(payload).features;
  return Array.isArray(features) ? features : [];
}

function formatGridValue(value: unknown, unitSystem: "metric" | "us") {
  const record = asRecord(value);
  const validTime = stringValue(record.validTime).split("/")[0];
  const rawValue = typeof record.value === "number" ? record.value : Number.parseFloat(String(record.value ?? ""));
  const valueText = Number.isFinite(rawValue) ? formatWeatherMetric(rawValue, unitSystem) : stringValue(record.value);
  return [validTime, valueText].filter(Boolean).join(" ");
}

function formatWeatherMetric(value: number, unitSystem: "metric" | "us") {
  return unitSystem === "us" ? `${round(value)} (raw grid)` : `${round(value)} (raw grid)`;
}

function measurementValue(value: unknown) {
  const record = asRecord(value);
  const parsed = typeof record.value === "number" ? record.value : Number.parseFloat(String(record.value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatCelsiusValue(value: number, unitSystem: "metric" | "us") {
  if (unitSystem === "us") {
    return `${round((value * 9) / 5 + 32)} F`;
  }

  return `${round(value)} C`;
}

function formatMetersPerSecondValue(value: number, unitSystem: "metric" | "us") {
  if (unitSystem === "us") {
    return `${round(value * 2.236936)} mph`;
  }

  return `${round(value * 3.6)} km/h`;
}

function formatTemperature(value: unknown, unit: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return "";
  }

  return `${round(parsed)} ${String(unit || "").trim()}`;
}

function formatClimateRecords(records: unknown[]) {
  return [
    "Climate records preview:",
    ...records.map((record, index) => `- ${index + 1}: ${formatClimateRecord(record)}`),
  ].join("\n");
}

function formatClimateRecordFacts(record: unknown, index: number) {
  return [`Climate record ${index}: ${formatClimateRecord(record)}`];
}

function formatClimateRecord(record: unknown) {
  const data = asRecord(record);
  const station = stringValue(data.STATION) || stringValue(data.station) || stringValue(data.NAME) || "station";
  const date = stringValue(data.DATE) || stringValue(data.date);
  const metrics = Object.entries(data)
    .filter(([key, value]) => !["STATION", "DATE", "NAME", "LATITUDE", "LONGITUDE", "ELEVATION"].includes(key.toUpperCase()) && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");

  return [date, station, metrics].filter(Boolean).join(" - ");
}

function formatPayloadTitleFact(title: string, payload: unknown) {
  const record = asRecord(asRecord(payload).properties);
  return `${title}: ${stringValue(record.name) || stringValue(record.title) || formatPayloadPreview(payload)}`;
}

function formatPayloadPreview(payload: unknown) {
  if (payload === undefined || payload === null) {
    return "";
  }

  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}

function formatWeatherNotes(action: WeatherAction) {
  if (action === "summary" || action === "forecast" || action === "hourly") {
    return "Coverage note: NWS forecast endpoints cover the United States and US territories. Use NOAA/NCEI climate or raw official endpoints for archive/specialized NOAA datasets.";
  }

  return "";
}

function createWeatherSource(title: string, url: string): ChatSource {
  return {
    detail: formatSourceHost(url),
    id: `${WEATHER_TOOL_SOURCE_PREFIX}-${stableSourceId(url)}`,
    sourceType: "web",
    title,
    url,
  };
}

function dedupeSources(sources: ChatSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

function appendQueryParams(url: string, params: Record<string, string>) {
  const parsed = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      parsed.searchParams.set(key, value);
    }
  }

  return parsed.toString();
}

function formatWeatherSections(sections: string[]) {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numberArg(args: Record<string, string>, names: string[]) {
  const rawValue = firstArg(args, names);

  if (!rawValue) {
    return Number.NaN;
  }

  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const rawValue = firstArg(args, names);

  if (rawValue === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function formatLocalTime(timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "UTC",
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function offsetIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeIsoDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "";
}

function formatSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "NOAA/NWS";
  }
}

function stableSourceId(url: string) {
  return formatSourceHost(url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

type NwsPointPayload = {
  properties?: unknown;
};
