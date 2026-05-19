import type { StoredWeatherLocation } from "./weatherLocation";
import { normalizeCountryCode } from "./weatherLocation";
import type { WeatherProviderDefinition, WeatherProviderId, WeatherSourceSettings } from "../types/weather";
import { DEFAULT_WEATHER_SOURCE_SETTINGS } from "../types/weather";

export interface WeatherSourcePlan {
  alertProvider: WeatherProviderDefinition;
  alertStatus: string;
  countryCode: string;
  forecastAdapterKind: "none" | "nws" | "openMeteo";
  forecastLabel: string;
  forecastProvider: WeatherProviderDefinition;
  forecastRuntimeProvider: WeatherProviderDefinition;
  forecastStatus: string;
  isFallbackForecast: boolean;
  primaryProvider: WeatherProviderDefinition;
  radarProvider: WeatherProviderDefinition | null;
  radarRuntimeProvider: WeatherProviderDefinition | null;
  radarStatus: string;
}

const EUROPEAN_METEOALARM_COUNTRIES = new Set([
  "AL",
  "AT",
  "BA",
  "BE",
  "BG",
  "CH",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LT",
  "LU",
  "LV",
  "MD",
  "ME",
  "MK",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "RS",
  "SE",
  "SI",
  "SK",
  "TR",
  "UA",
  "UK",
  "GB",
]);

export const WEATHER_PROVIDER_REGISTRY: WeatherProviderDefinition[] = [
  {
    authority: "National Oceanic and Atmospheric Administration / National Weather Service",
    capabilities: ["alerts", "current", "dailyForecast", "hourlyForecast", "radar"],
    countries: ["US"],
    docsUrl: "https://www.weather.gov/documentation/services-web-api",
    hosts: ["api.weather.gov", "opengeo.ncep.noaa.gov", "mapservices.weather.noaa.gov", "radar.weather.gov", "weather.gov", "noaa.gov"],
    id: "nws",
    label: "NOAA / NWS",
    notes: "Native adapter used for United States forecasts, observations, alerts, and the current radar workspace.",
    regionLabel: "United States",
    runtimeStatus: "native",
    shortLabel: "NWS",
    sourceType: "official",
  },
  {
    authority: "Environment and Climate Change Canada / Meteorological Service of Canada",
    capabilities: ["alerts", "current", "dailyForecast", "hourlyForecast", "modelForecast", "radar"],
    countries: ["CA"],
    docsUrl: "https://api.weather.gc.ca/?f=html",
    hosts: ["api.weather.gc.ca", "dd.weather.gc.ca", "weather.gc.ca"],
    id: "eccc",
    label: "MSC / ECCC GeoMet",
    notes: "Registered as Canada's official source. Forecast display currently uses the global fallback until the GeoMet adapter is added.",
    regionLabel: "Canada",
    runtimeStatus: "registered",
    shortLabel: "ECCC",
    sourceType: "official",
  },
  {
    authority: "Deutscher Wetterdienst",
    capabilities: ["alerts", "current", "dailyForecast", "hourlyForecast", "modelForecast", "radar"],
    countries: ["DE"],
    docsUrl: "https://dwd.de/EN/ourservices/opendata/opendata.html",
    hosts: ["dwd.de", "opendata.dwd.de", "maps.dwd.de"],
    id: "dwd",
    label: "Deutscher Wetterdienst",
    notes: "Registered as Germany's official source. Forecast display uses the global fallback with German national model coverage where available.",
    regionLabel: "Germany",
    runtimeStatus: "registered",
    shortLabel: "DWD",
    sourceType: "official",
  },
  {
    authority: "EUMETNET members",
    capabilities: ["alerts"],
    countries: ["Europe"],
    docsUrl: "https://api.meteoalarm.org/",
    hosts: ["api.meteoalarm.org", "feeds.meteoalarm.org", "meteoalarm.org"],
    id: "meteoalarm",
    label: "MeteoAlarm",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    notes: "Registered for European official warnings. Forecasts still come from the country's forecast source or the global fallback.",
    regionLabel: "Europe warnings",
    runtimeStatus: "registered",
    shortLabel: "MeteoAlarm",
    sourceType: "official",
  },
  {
    authority: "Norwegian Meteorological Institute",
    capabilities: ["current", "dailyForecast", "hourlyForecast", "modelForecast"],
    countries: ["NO", "SJ"],
    docsUrl: "https://api.met.no/weatherapi/locationforecast/2.0/documentation",
    hosts: ["api.met.no", "thredds.met.no", "met.no"],
    id: "metNorway",
    notes: "Registered for Nordic and Arctic forecasts. Requires a strict identifying User-Agent when the native adapter is added.",
    label: "MET Norway",
    regionLabel: "Norway / Arctic",
    runtimeStatus: "registered",
    shortLabel: "MET Norway",
    sourceType: "official",
  },
  {
    authority: "Australian Bureau of Meteorology",
    capabilities: ["alerts", "current", "dailyForecast", "hourlyForecast", "modelForecast", "radar"],
    countries: ["AU"],
    docsUrl: "https://www.bom.gov.au/resources/data-services",
    hosts: ["bom.gov.au", "www.bom.gov.au", "reg.bom.gov.au", "sws-data.sws.bom.gov.au"],
    id: "bom",
    notes: "Registered as Australia's official source. Free/public and commercial-use boundaries need per-product checks before native use.",
    label: "Australian Bureau of Meteorology",
    regionLabel: "Australia",
    runtimeStatus: "registered",
    shortLabel: "BOM",
    sourceType: "official",
  },
  {
    authority: "China Meteorological Administration",
    capabilities: ["current", "dailyForecast", "hourlyForecast", "modelForecast", "radar"],
    countries: ["CN"],
    docsUrl: "https://www.cma.gov.cn/en/",
    hosts: ["cma.gov.cn", "www.cma.gov.cn", "data.cma.cn"],
    id: "cma",
    notes: "Registered as China's official source. Forecast display uses the global fallback with CMA model coverage where available.",
    label: "China Meteorological Administration",
    regionLabel: "China",
    runtimeStatus: "registered",
    shortLabel: "CMA",
    sourceType: "official",
  },
  {
    authority: "Comision Nacional del Agua / Servicio Meteorologico Nacional",
    capabilities: ["alerts", "current", "dailyForecast", "hourlyForecast"],
    countries: ["MX"],
    docsUrl: "https://smn.conagua.gob.mx/",
    hosts: ["smn.conagua.gob.mx", "conagua.gob.mx", "www.gob.mx"],
    id: "smnMexico",
    notes: "Registered as Mexico's official national weather service. Forecast display currently uses the global fallback.",
    label: "CONAGUA SMN",
    regionLabel: "Mexico",
    runtimeStatus: "registered",
    shortLabel: "SMN MX",
    sourceType: "official",
  },
  {
    authority: "World Meteorological Organization",
    capabilities: ["alerts"],
    countries: ["Global"],
    docsUrl: "https://alertingauthority.wmo.int/",
    hosts: ["alertingauthority.wmo.int", "worldweather.wmo.int", "severeweather.wmo.int", "wmo.int"],
    id: "wmoAlerts",
    notes: "Registry-level fallback for discovering official alerting authorities where a country-specific adapter is not installed yet.",
    label: "WMO Alerting Authorities",
    regionLabel: "Global official-alert registry",
    runtimeStatus: "registered",
    shortLabel: "WMO",
    sourceType: "official",
  },
  {
    authority: "Open-Meteo",
    capabilities: ["current", "dailyForecast", "hourlyForecast", "modelForecast"],
    countries: ["Global"],
    docsUrl: "https://open-meteo.com/en/docs",
    hosts: ["api.open-meteo.com", "geocoding-api.open-meteo.com"],
    id: "openMeteo",
    licenseUrl: "https://open-meteo.com/en/license",
    notes: "Native global forecast fallback that auto-selects high-resolution applicable models from many national weather services.",
    label: "Open-Meteo model fallback",
    regionLabel: "Global forecasts",
    runtimeStatus: "native",
    shortLabel: "Open-Meteo",
    sourceType: "aggregator",
  },
];

const PROVIDERS_BY_ID = new Map(WEATHER_PROVIDER_REGISTRY.map((provider) => [provider.id, provider]));
const OPEN_METEO_MODEL_ADAPTER_PROVIDER_IDS = new Set<WeatherProviderId>(["bom", "cma", "dwd", "eccc", "metNorway", "nws", "openMeteo"]);

export function getWeatherProviderDefinition(id: WeatherProviderId) {
  return PROVIDERS_BY_ID.get(id) ?? getOpenMeteoProvider();
}

export function getOpenMeteoProvider() {
  return PROVIDERS_BY_ID.get("openMeteo") ?? WEATHER_PROVIDER_REGISTRY[WEATHER_PROVIDER_REGISTRY.length - 1];
}

export function resolveWeatherSourcePlan(location: StoredWeatherLocation | null, settings: WeatherSourceSettings = DEFAULT_WEATHER_SOURCE_SETTINGS): WeatherSourcePlan {
  const countryCode = normalizeCountryCode(location?.countryCode) || "XX";
  const automaticProvider = getWeatherProviderDefinition(resolveAutomaticForecastProviderId(countryCode));
  const requestedProvider = settings.mode === "manual" ? getWeatherProviderDefinition(settings.manualProviderId) : automaticProvider;
  const canUseNativeNws = requestedProvider.id === "nws" && countryCode === "US";
  const canUseOpenMeteoModelAdapter = !canUseNativeNws && OPEN_METEO_MODEL_ADAPTER_PROVIDER_IDS.has(requestedProvider.id);
  const fallbackProvider = getOpenMeteoProvider();
  const forecastRuntimeProvider = canUseNativeNws || canUseOpenMeteoModelAdapter || !settings.allowGlobalFallback ? requestedProvider : fallbackProvider;
  const forecastAdapterKind = canUseNativeNws ? "nws" : canUseOpenMeteoModelAdapter || forecastRuntimeProvider.id === "openMeteo" ? "openMeteo" : "none";
  const alertProvider = settings.preferOfficialAlerts ? resolveAlertProvider(countryCode, requestedProvider) : forecastRuntimeProvider;
  const radarProvider = resolveRadarProvider(countryCode, requestedProvider);
  const radarRuntimeProvider = radarProvider?.id === "nws" && countryCode === "US" ? radarProvider : null;
  const isFallbackForecast = forecastRuntimeProvider.id !== requestedProvider.id;
  const forecastLabel = createForecastLabel(countryCode, requestedProvider, forecastRuntimeProvider);

  return {
    alertProvider,
    alertStatus: createAlertStatus(countryCode, alertProvider),
    countryCode,
    forecastAdapterKind,
    forecastLabel,
    forecastProvider: requestedProvider,
    forecastRuntimeProvider,
    forecastStatus: createForecastStatus(countryCode, requestedProvider, forecastRuntimeProvider, forecastAdapterKind, settings.allowGlobalFallback),
    isFallbackForecast,
    primaryProvider: requestedProvider,
    radarProvider,
    radarRuntimeProvider,
    radarStatus: createRadarStatus(countryCode, radarProvider, radarRuntimeProvider),
  };
}

export function getWeatherProviderRuntimeLabel(status: WeatherProviderDefinition["runtimeStatus"]) {
  if (status === "native") {
    return "Native now";
  }

  if (status === "fallback") {
    return "Fallback";
  }

  return "Registered";
}

function resolveAutomaticForecastProviderId(countryCode: string): WeatherProviderId {
  if (countryCode === "US") {
    return "nws";
  }

  if (countryCode === "CA") {
    return "eccc";
  }

  if (countryCode === "DE") {
    return "dwd";
  }

  if (countryCode === "NO" || countryCode === "SJ") {
    return "metNorway";
  }

  if (countryCode === "AU") {
    return "bom";
  }

  if (countryCode === "CN") {
    return "cma";
  }

  if (countryCode === "MX") {
    return "smnMexico";
  }

  return "openMeteo";
}

function resolveAlertProvider(countryCode: string, requestedProvider: WeatherProviderDefinition) {
  if (countryCode === "US") {
    return getWeatherProviderDefinition("nws");
  }

  if (EUROPEAN_METEOALARM_COUNTRIES.has(countryCode)) {
    return getWeatherProviderDefinition("meteoalarm");
  }

  if (countryCode === "CA") {
    return getWeatherProviderDefinition("eccc");
  }

  if (countryCode === "AU") {
    return getWeatherProviderDefinition("bom");
  }

  if (countryCode === "MX") {
    return getWeatherProviderDefinition("smnMexico");
  }

  if (countryCode === "CN") {
    return getWeatherProviderDefinition("cma");
  }

  return requestedProvider.sourceType === "official" && requestedProvider.capabilities.includes("alerts") ? requestedProvider : getWeatherProviderDefinition("wmoAlerts");
}

function resolveRadarProvider(countryCode: string, requestedProvider: WeatherProviderDefinition) {
  if (countryCode === "US") {
    return getWeatherProviderDefinition("nws");
  }

  if (requestedProvider.capabilities.includes("radar")) {
    return requestedProvider;
  }

  if (countryCode === "CA") {
    return getWeatherProviderDefinition("eccc");
  }

  if (countryCode === "DE") {
    return getWeatherProviderDefinition("dwd");
  }

  if (countryCode === "AU") {
    return getWeatherProviderDefinition("bom");
  }

  if (countryCode === "CN") {
    return getWeatherProviderDefinition("cma");
  }

  return null;
}

function createForecastLabel(countryCode: string, requestedProvider: WeatherProviderDefinition, runtimeProvider: WeatherProviderDefinition) {
  if (runtimeProvider.id === "nws") {
    return "NOAA / NWS official weather";
  }

  if (runtimeProvider.id !== "openMeteo" && OPEN_METEO_MODEL_ADAPTER_PROVIDER_IDS.has(runtimeProvider.id)) {
    return `${runtimeProvider.shortLabel} via Open-Meteo`;
  }

  return `${runtimeProvider.shortLabel} (${getOpenMeteoModelHint(countryCode, requestedProvider.id)})`;
}

function createForecastStatus(
  countryCode: string,
  requestedProvider: WeatherProviderDefinition,
  runtimeProvider: WeatherProviderDefinition,
  adapterKind: WeatherSourcePlan["forecastAdapterKind"],
  allowFallback: boolean,
) {
  if (adapterKind === "nws") {
    return "Using the native NOAA/NWS adapter for this location.";
  }

  if (adapterKind === "openMeteo" && runtimeProvider.id === requestedProvider.id && runtimeProvider.id !== "openMeteo") {
    return `Using ${runtimeProvider.label} model data through the Open-Meteo model endpoint.`;
  }

  if (adapterKind === "openMeteo" && runtimeProvider.id === requestedProvider.id) {
    return `Using ${runtimeProvider.label}.`;
  }

  if (!allowFallback) {
    return `${requestedProvider.label} is selected, but no live forecast adapter is available for ${countryCode}.`;
  }

  return `${requestedProvider.label} is the official source for ${countryCode}; ${runtimeProvider.shortLabel} is used as the live forecast adapter until that native connector is added.`;
}

function createAlertStatus(countryCode: string, provider: WeatherProviderDefinition) {
  if (provider.id === "nws") {
    return "Native official NWS point alerts are active.";
  }

  if (provider.id === "meteoalarm") {
    return "European official warnings are registered through MeteoAlarm; native warning fetch is next.";
  }

  if (provider.id === "wmoAlerts") {
    return `Official alerting authority discovery is registered through WMO for ${countryCode}.`;
  }

  return `${provider.label} is registered as the official alert source for ${countryCode}; native warning fetch is next.`;
}

function createRadarStatus(countryCode: string, radarProvider: WeatherProviderDefinition | null, runtimeProvider: WeatherProviderDefinition | null) {
  if (runtimeProvider?.id === "nws") {
    return "Native NOAA/NWS radar tiles are active.";
  }

  if (radarProvider) {
    return `${radarProvider.label} is registered for radar in ${countryCode}; live raster tiles are not wired yet.`;
  }

  return `No official radar tile adapter is registered for ${countryCode}; the map still shows forecasts and location context.`;
}

function getOpenMeteoModelHint(countryCode: string, requestedProviderId: WeatherProviderId) {
  if (requestedProviderId === "dwd" || countryCode === "DE") {
    return "DWD ICON when applicable";
  }

  if (requestedProviderId === "eccc" || countryCode === "CA") {
    return "MSC GEM when applicable";
  }

  if (requestedProviderId === "bom" || countryCode === "AU") {
    return "BOM ACCESS when applicable";
  }

  if (requestedProviderId === "cma" || countryCode === "CN") {
    return "CMA GRAPES when applicable";
  }

  if (requestedProviderId === "metNorway" || countryCode === "NO") {
    return "MET Nordic when applicable";
  }

  if (countryCode === "US") {
    return "NOAA GFS/HRRR when applicable";
  }

  return "best-match national model blend";
}
