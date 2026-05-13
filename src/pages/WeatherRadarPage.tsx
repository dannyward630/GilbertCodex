import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl, {
  type CircleLayerSpecification,
  type FillLayerSpecification,
  type GeoJSONSource,
  type GeoJSONSourceSpecification,
  type LineLayerSpecification,
  type MapOptions,
  type RasterLayerSpecification,
  type RasterSourceSpecification,
} from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ArrowLeft, CloudRain, Crosshair, Layers, Pause, Play, RefreshCw, Settings, ShieldAlert } from "lucide-react";
import { fetchWeatherJson } from "../app/tauriClient";
import { loadMapboxSettings, subscribeMapboxSettings } from "../services/mapboxSettings";
import {
  createStoredWeatherLocation,
  isValidWeatherCoordinate,
  loadStoredWeatherLocation,
  normalizeCountryCode,
  requestAndRememberWeatherLocation,
  saveStoredWeatherLocation,
  type StoredWeatherLocation,
} from "../services/weatherLocation";
import { MAPBOX_STYLE_PRESETS, resolveMapboxStyleUrl, type MapboxSettings } from "../types/mapbox";

interface WeatherRadarPageProps {
  onBackToChat: () => void;
  onOpenMapboxSettings: () => void;
}

interface RadarFrame {
  id: string;
  kind: "current" | "forecast" | "observed";
  label: string;
  offsetMinutes: number;
  sourceLabel: string;
  timeLabel: string;
  validTimeMs: number;
}

interface WeatherAlertSummary {
  area: string;
  event: string;
  headline: string;
  id: string;
  severity: string;
}

interface HourlyForecastSummary {
  condition: string;
  name: string;
  precipitation?: string;
  temperature: string;
  wind: string;
}

interface WeatherLocationDraft {
  countryCode: string;
  latitude: string;
  longitude: string;
}

type ResolvedAppTheme = "dark" | "light";

const ALERT_FILL_LAYER_ID = "gilbert-weather-alert-fill";
const ALERT_LINE_LAYER_ID = "gilbert-weather-alert-line";
const ALERT_SOURCE_ID = "gilbert-weather-alerts";
const CURRENT_FRAME_INDEX = 12;
const FUTURE_FRAME_OFFSETS_MINUTES = [30, 60, 90, 120];
const LOCATION_LAYER_ID = "gilbert-weather-location";
const LOCATION_SOURCE_ID = "gilbert-weather-location-source";
const OBSERVED_FRAME_OFFSETS_MINUTES = [-120, -110, -100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0];
const RADAR_LAYER_ID = "gilbert-noaa-radar-raster";
const RADAR_SOURCE_ID = "gilbert-noaa-radar-source";
const TERRAIN_SOURCE_ID = "gilbert-radar-terrain";
const VISIBLE_BASEMAP_LAYER_ID = "gilbert-mapbox-visible-basemap-layer";
const VISIBLE_BASEMAP_SOURCE_ID = "gilbert-mapbox-visible-basemap-source";
const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

const NOAA_RADAR_WMS_URL = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows";
const NOAA_WPC_QPF_EXPORT_URL = "https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/export";

export function WeatherRadarPage({ onBackToChat, onOpenMapboxSettings }: WeatherRadarPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<MapboxSettings>(() => loadMapboxSettings());
  const [location, setLocation] = useState<StoredWeatherLocation | null>(() => loadStoredWeatherLocation());
  const [locationDraft, setLocationDraft] = useState<WeatherLocationDraft>(() => createLocationDraft(loadStoredWeatherLocation()));
  const [locationStatus, setLocationStatus] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapStatus, setMapStatus] = useState("");
  const [dataStatus, setDataStatus] = useState("Loading NOAA/NWS weather layers...");
  const [timelineAnchorMs, setTimelineAnchorMs] = useState(() => roundToFiveMinutes(Date.now()));
  const [activeFrameIndex, setActiveFrameIndex] = useState(CURRENT_FRAME_INDEX);
  const [alerts, setAlerts] = useState<WeatherAlertSummary[]>([]);
  const [alertGeoJson, setAlertGeoJson] = useState<GeoJSON.FeatureCollection>(() => createEmptyFeatureCollection());
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [forecastOverlayEnabled, setForecastOverlayEnabled] = useState(true);
  const [hourlyForecast, setHourlyForecast] = useState<HourlyForecastSummary[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [playing, setPlaying] = useState(false);
  const appTheme = useResolvedAppTheme();
  const styleUrl = useMemo(() => resolveVisibleMapboxStyleUrl(settings, appTheme), [appTheme, settings]);
  const frames = useMemo(() => createRadarFrames(timelineAnchorMs), [timelineAnchorMs]);
  const activeFrame = frames[Math.min(activeFrameIndex, frames.length - 1)] ?? frames[CURRENT_FRAME_INDEX];
  const readyForMap = settings.enabled && Boolean(settings.accessToken.trim()) && Boolean(location);
  const locationName = location ? `${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}` : "No saved location";

  useEffect(() => subscribeMapboxSettings(setSettings), []);

  useEffect(() => {
    let mounted = true;

    async function loadLocation() {
      if (location) {
        return;
      }

      const resolvedLocation = await requestAndRememberWeatherLocation();

      if (!mounted || !resolvedLocation) {
        return;
      }

      setLocation(resolvedLocation);
      setLocationDraft(createLocationDraft(resolvedLocation));
    }

    void loadLocation();

    return () => {
      mounted = false;
    };
  }, [location]);

  const refreshRadarData = useCallback(async () => {
    const nextAnchor = roundToFiveMinutes(Date.now());
    setTimelineAnchorMs(nextAnchor);

    if (!location) {
      setDataStatus("Save a location to load NOAA/NWS radar.");
      return;
    }

    setDataStatus("Refreshing NOAA/NWS weather layers...");

    const [nextAlerts, nextForecast] = await Promise.all([
      loadActiveAlerts(location).catch(() => ({ features: createEmptyFeatureCollection(), summaries: [] })),
      loadHourlyForecast(location).catch(() => []),
    ]);

    setAlertGeoJson(nextAlerts.features);
    setAlerts(nextAlerts.summaries);
    setHourlyForecast(nextForecast);
    setLastUpdatedAt(new Date().toISOString());
    setDataStatus("NOAA/NWS layers ready");
  }, [location]);

  useEffect(() => {
    void refreshRadarData();
  }, [refreshRadarData]);

  useEffect(() => {
    if (refreshTimerRef.current !== null) {
      window.clearInterval(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setInterval(() => {
      void refreshRadarData();
    }, WEATHER_REFRESH_INTERVAL_MS);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearInterval(refreshTimerRef.current);
      }
    };
  }, [refreshRadarData]);

  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current !== null) {
        window.clearInterval(playTimerRef.current);
      }
      return;
    }

    playTimerRef.current = window.setInterval(() => {
      setActiveFrameIndex((currentIndex) => (currentIndex + 1) % frames.length);
    }, 900);

    return () => {
      if (playTimerRef.current !== null) {
        window.clearInterval(playTimerRef.current);
      }
    };
  }, [frames.length, playing]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || !readyForMap || !location) {
      return;
    }

    setMapReady(false);
    setMapStatus("");
    mapboxgl.accessToken = settings.accessToken.trim();

    let map: mapboxgl.Map;

    try {
      map = new mapboxgl.Map({
        accessToken: settings.accessToken.trim(),
        antialias: settings.antialias,
        attributionControl: false,
        bearing: settings.bearing,
        boxZoom: settings.boxZoom,
        center: [location.longitude, location.latitude],
        collectResourceTiming: settings.collectResourceTiming,
        cooperativeGestures: false,
        doubleClickZoom: settings.doubleClickZoom,
        dragPan: settings.dragPan,
        dragRotate: settings.dragRotate,
        failIfMajorPerformanceCaveat: settings.failIfMajorPerformanceCaveat,
        hash: false,
        interactive: settings.interactive,
        keyboard: settings.keyboard,
        language: settings.language === "auto" ? undefined : settings.language,
        maxZoom: settings.maxZoom,
        minZoom: settings.minZoom,
        performanceMetricsCollection: settings.performanceMetricsCollection,
        pitch: Math.min(settings.pitch, 70),
        pitchWithRotate: settings.pitchWithRotate,
        preserveDrawingBuffer: settings.preserveDrawingBuffer,
        projection: settings.projection,
        refreshExpiredTiles: true,
        renderWorldCopies: settings.renderWorldCopies,
        scrollZoom: true,
        style: styleUrl,
        touchZoomRotate: settings.touchZoomRotate,
        trackResize: true,
        worldview: settings.worldview || undefined,
        zoom: Math.max(settings.zoom, 7.4),
        config: createMapboxStandardConfig(settings),
        container,
      } satisfies MapOptions);
    } catch (error) {
      setMapStatus(readErrorMessage(error, "Mapbox map could not start."));
      return;
    }

    mapRef.current = map;

    map.on("error", (event) => {
      const message = getBlockingMapboxErrorMessage(event);

      if (message) {
        setMapStatus(message);
      }
    });

    map.on("load", () => {
      map.scrollZoom.enable();
      applyMapboxControls(map, settings);
      applyVisibleMapboxBasemap(map, settings, appTheme);
      applyMapboxTerrain(map, settings);
      applyLocationLayer(map, location);
      setMapReady(true);
      window.setTimeout(() => map.resize(), 60);
    });

    return () => {
      setMapReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [appTheme, location, readyForMap, settings, styleUrl]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map || !activeFrame) {
      return;
    }

    applyRadarLayer(map, activeFrame, settings.radarOpacity, forecastOverlayEnabled);
  }, [activeFrame, forecastOverlayEnabled, mapReady, settings.radarOpacity]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map || !location) {
      return;
    }

    applyLocationLayer(map, location);
  }, [location, mapReady]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map) {
      return;
    }

    applyAlertLayers(map, alertGeoJson, alertsEnabled);
  }, [alertGeoJson, alertsEnabled, mapReady]);

  function saveManualLocation() {
    const latitude = Number.parseFloat(locationDraft.latitude);
    const longitude = Number.parseFloat(locationDraft.longitude);

    if (!isValidWeatherCoordinate(latitude, longitude)) {
      setLocationStatus("Enter valid latitude and longitude.");
      return;
    }

    const nextLocation = createStoredWeatherLocation({
      countryCode: normalizeCountryCode(locationDraft.countryCode) || undefined,
      latitude,
      longitude,
      source: "manual",
    });

    saveStoredWeatherLocation(nextLocation);
    setLocation(nextLocation);
    setLocationDraft(createLocationDraft(nextLocation));
    setLocationStatus("Location saved.");
  }

  if (!settings.enabled || !settings.accessToken.trim()) {
    return (
      <section className="weather-radar-page">
        <header className="weather-radar-header">
          <button className="weather-radar-icon-button" type="button" aria-label="Back to chat" onClick={onBackToChat}>
            <ArrowLeft size={17} aria-hidden="true" />
          </button>
          <div>
            <span>Weather</span>
            <h1>Live NOAA/NWS Radar</h1>
          </div>
          <button className="weather-radar-primary-action" type="button" onClick={onOpenMapboxSettings}>
            <Settings size={16} aria-hidden="true" />
            Mapbox settings
          </button>
        </header>
        <div className="weather-radar-setup">
          <CloudRain size={32} aria-hidden="true" />
          <strong>Mapbox token needed</strong>
          <p>Add a Mapbox public token before loading the radar map.</p>
          <button type="button" onClick={onOpenMapboxSettings}>Open Mapbox settings</button>
        </div>
      </section>
    );
  }

  if (!location) {
    return (
      <section className="weather-radar-page">
        <header className="weather-radar-header">
          <button className="weather-radar-icon-button" type="button" aria-label="Back to chat" onClick={onBackToChat}>
            <ArrowLeft size={17} aria-hidden="true" />
          </button>
          <div>
            <span>Weather</span>
            <h1>Live NOAA/NWS Radar</h1>
          </div>
        </header>
        <form
          className="weather-radar-setup weather-radar-location-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveManualLocation();
          }}
        >
          <MapLocationIcon />
          <strong>Location needed</strong>
          <label>
            <span>Latitude</span>
            <input inputMode="decimal" placeholder="40.7128" value={locationDraft.latitude} onChange={(event) => setLocationDraft({ ...locationDraft, latitude: event.target.value })} />
          </label>
          <label>
            <span>Longitude</span>
            <input inputMode="decimal" placeholder="-74.0060" value={locationDraft.longitude} onChange={(event) => setLocationDraft({ ...locationDraft, longitude: event.target.value })} />
          </label>
          <label>
            <span>Country</span>
            <input maxLength={2} placeholder="US" value={locationDraft.countryCode} onChange={(event) => setLocationDraft({ ...locationDraft, countryCode: event.target.value })} />
          </label>
          <button type="submit">Save location</button>
          {locationStatus ? <em>{locationStatus}</em> : null}
        </form>
      </section>
    );
  }

  return (
    <section className="weather-radar-page">
      <header className="weather-radar-header">
        <button className="weather-radar-icon-button" type="button" aria-label="Back to chat" onClick={onBackToChat}>
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
        <div>
          <span>Weather</span>
          <h1>Live NOAA/NWS Radar</h1>
        </div>
        <div className="weather-radar-header-actions">
          <button className="weather-radar-secondary-action" type="button" onClick={() => recenterMap(mapRef.current, location)}>
            <Crosshair size={16} aria-hidden="true" />
            Recenter
          </button>
          <button className="weather-radar-secondary-action" type="button" onClick={() => void refreshRadarData()}>
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
          <button className="weather-radar-primary-action" type="button" onClick={onOpenMapboxSettings}>
            <Settings size={16} aria-hidden="true" />
            Mapbox
          </button>
        </div>
      </header>

      <div className="weather-radar-body">
        <div className="weather-radar-map-panel">
          <div className="weather-radar-map" ref={containerRef} aria-label="Full screen NOAA/NWS radar map" />

          <div className="weather-radar-frame-card">
            <span>{activeFrame.sourceLabel}</span>
            <strong>{activeFrame.label}</strong>
            <em>{activeFrame.timeLabel}</em>
          </div>

          <div className="weather-radar-map-actions">
            <button className="weather-radar-icon-button" type="button" aria-label={playing ? "Pause radar loop" : "Play radar loop"} onClick={() => setPlaying((current) => !current)}>
              {playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
            </button>
            <label className="weather-radar-timeline">
              <span>Past 2 h</span>
              <input min={0} max={frames.length - 1} step={1} type="range" value={activeFrameIndex} onChange={(event) => setActiveFrameIndex(Number.parseInt(event.target.value, 10))} />
              <span>Future</span>
            </label>
            <button className="weather-radar-chip-button" type="button" onClick={() => setActiveFrameIndex(CURRENT_FRAME_INDEX)}>
              Current
            </button>
          </div>

          <div className="weather-radar-layer-toggles">
            <button className="weather-radar-toggle" data-active={alertsEnabled} type="button" onClick={() => setAlertsEnabled((current) => !current)}>
              <ShieldAlert size={15} aria-hidden="true" />
              Alerts
            </button>
            <button className="weather-radar-toggle" data-active={forecastOverlayEnabled} type="button" onClick={() => setForecastOverlayEnabled((current) => !current)}>
              <Layers size={15} aria-hidden="true" />
              Future layer
            </button>
          </div>

          <div className="weather-radar-legend" aria-label="Radar legend">
            <span>Light</span>
            <i data-level="1" />
            <i data-level="2" />
            <i data-level="3" />
            <i data-level="4" />
            <i data-level="5" />
            <span>Heavy</span>
          </div>

          {mapStatus ? <div className="weather-radar-status" data-kind="error">{mapStatus}</div> : null}
        </div>

        <aside className="weather-radar-side-panel" aria-label="Radar details">
          <section className="weather-radar-detail">
            <span>Location</span>
            <strong>{locationName}</strong>
            <small>{lastUpdatedAt ? `Updated ${formatClockTime(lastUpdatedAt)}` : dataStatus}</small>
          </section>

          <section className="weather-radar-detail">
            <span>Frame</span>
            <strong>{activeFrame.label}</strong>
            <small>{activeFrame.sourceLabel}</small>
          </section>

          <section className="weather-radar-detail">
            <span>NWS alerts</span>
            {alerts.length > 0 ? (
              <div className="weather-radar-alert-list">
                {alerts.slice(0, 4).map((alert) => (
                  <article className="weather-radar-alert" key={alert.id}>
                    <strong>{alert.event}</strong>
                    <span>{alert.severity}</span>
                    <p>{alert.headline || alert.area}</p>
                  </article>
                ))}
              </div>
            ) : (
              <small>No active point alerts</small>
            )}
          </section>

          <section className="weather-radar-detail">
            <span>Next hours</span>
            {hourlyForecast.length > 0 ? (
              <div className="weather-radar-hourly-list">
                {hourlyForecast.slice(0, 5).map((period) => (
                  <article className="weather-radar-hourly" key={period.name}>
                    <strong>{period.name}</strong>
                    <span>{period.temperature}</span>
                    <p>{period.condition}</p>
                    <small>{[period.wind, period.precipitation].filter(Boolean).join(" / ")}</small>
                  </article>
                ))}
              </div>
            ) : (
              <small>{dataStatus}</small>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function applyRadarLayer(map: mapboxgl.Map, frame: RadarFrame, opacity: number, forecastOverlayEnabled: boolean) {
  removeLayerAndSource(map, RADAR_LAYER_ID, RADAR_SOURCE_ID);

  if (frame.kind === "forecast" && !forecastOverlayEnabled) {
    return;
  }

  const tileUrl = frame.kind === "forecast" ? createForecastTileUrl(frame) : createRadarTileUrl(frame);
  const source: RasterSourceSpecification = {
    attribution: "NOAA / NWS",
    tileSize: 256,
    tiles: [tileUrl],
    type: "raster",
  };
  const layer: RasterLayerSpecification = {
    id: RADAR_LAYER_ID,
    paint: {
      "raster-fade-duration": 0,
      "raster-opacity": Math.min(Math.max(opacity, 0.12), 1),
    },
    source: RADAR_SOURCE_ID,
    type: "raster",
  };

  map.addSource(RADAR_SOURCE_ID, source);
  map.addLayer(layer, findFirstSymbolLayerId(map));
}

function applyAlertLayers(map: mapboxgl.Map, alerts: GeoJSON.FeatureCollection, enabled: boolean) {
  if (map.getLayer(ALERT_LINE_LAYER_ID)) {
    map.removeLayer(ALERT_LINE_LAYER_ID);
  }
  if (map.getLayer(ALERT_FILL_LAYER_ID)) {
    map.removeLayer(ALERT_FILL_LAYER_ID);
  }
  if (map.getSource(ALERT_SOURCE_ID)) {
    map.removeSource(ALERT_SOURCE_ID);
  }

  if (!enabled || alerts.features.length === 0) {
    return;
  }

  if (!map.getSource(ALERT_SOURCE_ID)) {
    const source: GeoJSONSourceSpecification = {
      data: alerts,
      type: "geojson",
    };
    map.addSource(ALERT_SOURCE_ID, source);
  } else {
    (map.getSource(ALERT_SOURCE_ID) as GeoJSONSource).setData(alerts);
  }

  const fillLayer: FillLayerSpecification = {
    id: ALERT_FILL_LAYER_ID,
    paint: {
      "fill-color": [
        "match",
        ["get", "severity"],
        "Extreme",
        "#cf3c32",
        "Severe",
        "#e86f2d",
        "Moderate",
        "#f1b640",
        "Minor",
        "#69a7ff",
        "#9aa8b5",
      ],
      "fill-opacity": 0.24,
    },
    source: ALERT_SOURCE_ID,
    type: "fill",
  };
  const lineLayer: LineLayerSpecification = {
    id: ALERT_LINE_LAYER_ID,
    paint: {
      "line-color": "#ffffff",
      "line-opacity": 0.82,
      "line-width": 1.4,
    },
    source: ALERT_SOURCE_ID,
    type: "line",
  };
  const beforeLayerId = findFirstSymbolLayerId(map);

  map.addLayer(fillLayer, beforeLayerId);
  map.addLayer(lineLayer, beforeLayerId);
}

function applyLocationLayer(map: mapboxgl.Map, location: StoredWeatherLocation) {
  const data: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    features: [
      {
        geometry: {
          coordinates: [location.longitude, location.latitude],
          type: "Point",
        },
        properties: {},
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
  const source = map.getSource(LOCATION_SOURCE_ID);

  if (source) {
    (source as GeoJSONSource).setData(data);
    return;
  }

  map.addSource(LOCATION_SOURCE_ID, {
    data,
    type: "geojson",
  });

  const layer: CircleLayerSpecification = {
    id: LOCATION_LAYER_ID,
    paint: {
      "circle-color": "#47a8ff",
      "circle-opacity": 0.95,
      "circle-radius": 7,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
    source: LOCATION_SOURCE_ID,
    type: "circle",
  };

  map.addLayer(layer);
}

function applyMapboxControls(map: mapboxgl.Map, settings: MapboxSettings) {
  if (settings.attributionControl) {
    map.addControl(new mapboxgl.AttributionControl({ compact: settings.compactAttribution }), "bottom-right");
  }

  if (settings.navigationControl) {
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
  }

  if (settings.fullscreenControl) {
    map.addControl(new mapboxgl.FullscreenControl(), "top-right");
  }

  if (settings.scaleControl) {
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 112, unit: settings.scaleUnit }), "bottom-left");
  }

  if (settings.geolocateControl) {
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        showAccuracyCircle: settings.showAccuracyCircle,
        showUserHeading: settings.showUserHeading,
        showUserLocation: true,
        trackUserLocation: settings.trackUserLocation,
      }),
      "top-right",
    );
  }
}

function applyMapboxTerrain(map: mapboxgl.Map, settings: MapboxSettings) {
  if (settings.atmosphereEnabled && settings.projection === "globe") {
    map.setFog({
      color: "rgb(186, 210, 235)",
      "high-color": "rgb(36, 92, 150)",
      "horizon-blend": 0.08,
      "space-color": "rgb(10, 13, 18)",
      "star-intensity": 0.08,
    });
  }

  if (!settings.terrainEnabled || !settings.terrainSourceUrl.trim() || map.getSource(TERRAIN_SOURCE_ID)) {
    return;
  }

  map.addSource(TERRAIN_SOURCE_ID, {
    tileSize: settings.terrainTileSize,
    type: "raster-dem",
    url: settings.terrainSourceUrl.trim(),
  });
  map.setTerrain({ exaggeration: settings.terrainExaggeration, source: TERRAIN_SOURCE_ID });
}

function applyVisibleMapboxBasemap(map: mapboxgl.Map, settings: MapboxSettings, appTheme: ResolvedAppTheme) {
  const rasterStyle = getMapboxRasterStylePath(settings, appTheme);

  if (!rasterStyle || !settings.accessToken.trim() || map.getSource(VISIBLE_BASEMAP_SOURCE_ID)) {
    return;
  }

  const source: RasterSourceSpecification = {
    attribution: "Mapbox / OpenStreetMap",
    tileSize: 256,
    tiles: [`https://api.mapbox.com/styles/v1/${rasterStyle}/tiles/256/{z}/{x}/{y}?access_token=${encodeURIComponent(settings.accessToken.trim())}`],
    type: "raster",
  };
  const layer: RasterLayerSpecification = {
    id: VISIBLE_BASEMAP_LAYER_ID,
    source: VISIBLE_BASEMAP_SOURCE_ID,
    type: "raster",
  };
  const beforeLayerId = map.getStyle().layers?.find((styleLayer) => styleLayer.type !== "background")?.id;

  map.addSource(VISIBLE_BASEMAP_SOURCE_ID, source);
  map.addLayer(layer, beforeLayerId);
}

function resolveVisibleMapboxStyleUrl(settings: MapboxSettings, appTheme: ResolvedAppTheme) {
  if (settings.stylePreset === "custom") {
    return resolveMapboxStyleUrl(settings);
  }

  if (settings.stylePreset === "satellite" || settings.stylePreset === "satelliteStreets" || settings.stylePreset === "standardSatellite") {
    return MAPBOX_STYLE_PRESETS.satelliteStreets;
  }

  if (settings.stylePreset === "outdoors") {
    return MAPBOX_STYLE_PRESETS.outdoors;
  }

  if (settings.stylePreset === "navigationDay" || settings.stylePreset === "navigationNight") {
    return appTheme === "light" ? MAPBOX_STYLE_PRESETS.navigationDay : MAPBOX_STYLE_PRESETS.navigationNight;
  }

  return appTheme === "light" ? MAPBOX_STYLE_PRESETS.streets : MAPBOX_STYLE_PRESETS.dark;
}

function getMapboxRasterStylePath(settings: MapboxSettings, appTheme: ResolvedAppTheme) {
  if (settings.stylePreset === "custom") {
    return getCustomMapboxStylePath(settings.customStyleUrl);
  }

  if (settings.stylePreset === "satellite" || settings.stylePreset === "satelliteStreets" || settings.stylePreset === "standardSatellite") {
    return "mapbox/satellite-streets-v12";
  }

  if (settings.stylePreset === "outdoors") {
    return "mapbox/outdoors-v12";
  }

  if (settings.stylePreset === "navigationDay" || settings.stylePreset === "navigationNight") {
    return appTheme === "light" ? "mapbox/navigation-day-v1" : "mapbox/navigation-night-v1";
  }

  return appTheme === "light" ? "mapbox/streets-v12" : "mapbox/dark-v11";
}

function getCustomMapboxStylePath(styleUrl: string) {
  const match = styleUrl.trim().match(/^mapbox:\/\/styles\/([^/]+)\/([^?]+)/i);
  return match ? `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : "";
}

function useResolvedAppTheme(): ResolvedAppTheme {
  const [theme, setTheme] = useState<ResolvedAppTheme>(() => readResolvedAppTheme());

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readResolvedAppTheme()));

    observer.observe(root, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

function readResolvedAppTheme(): ResolvedAppTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function createMapboxStandardConfig(settings: MapboxSettings): MapOptions["config"] {
  if (settings.stylePreset !== "standard" && settings.stylePreset !== "standardSatellite") {
    return undefined;
  }

  return {
    basemap: {
      lightPreset: settings.lightPreset,
      show3dObjects: settings.show3dObjects,
      showPedestrianRoads: settings.showPedestrianRoads,
      showPlaceLabels: settings.showPlaceLabels,
      showPointOfInterestLabels: settings.showPointOfInterestLabels,
      showRoadLabels: settings.showRoadLabels,
      showTransitLabels: settings.showTransitLabels,
      theme: settings.theme,
    },
  } as MapOptions["config"];
}

function createRadarFrames(anchorMs: number): RadarFrame[] {
  return [
    ...OBSERVED_FRAME_OFFSETS_MINUTES.map((offsetMinutes) => createRadarFrame(anchorMs, offsetMinutes)),
    ...FUTURE_FRAME_OFFSETS_MINUTES.map((offsetMinutes) => createRadarFrame(anchorMs, offsetMinutes)),
  ];
}

function createRadarFrame(anchorMs: number, offsetMinutes: number): RadarFrame {
  const validTimeMs = anchorMs + offsetMinutes * 60_000;
  const kind = offsetMinutes === 0 ? "current" : offsetMinutes > 0 ? "forecast" : "observed";

  return {
    id: `${kind}-${offsetMinutes}-${validTimeMs}`,
    kind,
    label: offsetMinutes === 0 ? "Current" : offsetMinutes > 0 ? `+${offsetMinutes} min` : `${Math.abs(offsetMinutes)} min ago`,
    offsetMinutes,
    sourceLabel: kind === "forecast" ? "NOAA/WPC precip forecast" : "NWS MRMS radar",
    timeLabel: formatClockTime(new Date(validTimeMs).toISOString()),
    validTimeMs,
  };
}

function createRadarTileUrl(frame: RadarFrame) {
  const params = new URLSearchParams({
    bbox: "{bbox-epsg-3857}",
    cacheKey: String(frame.validTimeMs),
    crs: "EPSG:3857",
    format: "image/png",
    height: "256",
    layers: "conus_bref_qcd",
    request: "GetMap",
    service: "WMS",
    styles: "",
    time: new Date(frame.validTimeMs).toISOString(),
    transparent: "true",
    version: "1.3.0",
    width: "256",
  });

  return restoreMapboxTemplate(`${NOAA_RADAR_WMS_URL}?${params.toString()}`);
}

function createForecastTileUrl(frame: RadarFrame) {
  const params = new URLSearchParams({
    bbox: "{bbox-epsg-3857}",
    bboxSR: "3857",
    cacheKey: String(frame.validTimeMs),
    f: "image",
    format: "png32",
    imageSR: "3857",
    layers: "show:13",
    size: "256,256",
    transparent: "true",
  });

  return restoreMapboxTemplate(`${NOAA_WPC_QPF_EXPORT_URL}?${params.toString()}`);
}

async function loadActiveAlerts(location: StoredWeatherLocation) {
  const response = await fetchWeatherJson({
    url: `https://api.weather.gov/alerts/active?point=${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`,
  });
  const features = asArray(asRecord(response.payload).features);
  const summaries: WeatherAlertSummary[] = [];
  const alertFeatures: GeoJSON.Feature[] = [];

  for (const rawFeature of features) {
    const feature = asRecord(rawFeature);
    const properties = asRecord(feature.properties);
    const id = stringValue(feature.id) || stringValue(properties.id) || createStableAlertId(properties);
    const event = stringValue(properties.event) || "Weather alert";
    const severity = stringValue(properties.severity) || "Unknown";
    const headline = stringValue(properties.headline) || stringValue(properties.description);
    const area = stringValue(properties.areaDesc);

    summaries.push({ area, event, headline, id, severity });

    const geometry = readPolygonGeometry(feature.geometry);

    if (geometry) {
      alertFeatures.push({
        geometry,
        properties: { event, id, severity },
        type: "Feature",
      });
    }
  }

  return {
    features: {
      features: alertFeatures,
      type: "FeatureCollection",
    } satisfies GeoJSON.FeatureCollection,
    summaries,
  };
}

async function loadHourlyForecast(location: StoredWeatherLocation): Promise<HourlyForecastSummary[]> {
  const point = await fetchWeatherJson({
    url: `https://api.weather.gov/points/${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`,
  });
  const hourlyUrl = stringValue(asRecord(asRecord(point.payload).properties).forecastHourly);

  if (!hourlyUrl) {
    return [];
  }

  const forecast = await fetchWeatherJson({
    url: appendQueryParams(hourlyUrl, {
      units: location.preferredUnits === "metric" ? "si" : "us",
    }),
  });
  const periods = asArray(asRecord(asRecord(forecast.payload).properties).periods);

  return periods.slice(0, 8).map((rawPeriod, index) => {
    const period = asRecord(rawPeriod);
    const temperature = typeof period.temperature === "number" ? `${Math.round(period.temperature)}${stringValue(period.temperatureUnit)}` : stringValue(period.temperature);
    const precipitation = asRecord(period.probabilityOfPrecipitation);
    const precipitationValue = typeof precipitation.value === "number" ? `${Math.round(precipitation.value)}% precip` : "";

    return {
      condition: stringValue(period.shortForecast) || "Forecast",
      name: stringValue(period.name) || formatForecastHour(stringValue(period.startTime), index),
      precipitation: precipitationValue,
      temperature: temperature || "--",
      wind: [stringValue(period.windSpeed), stringValue(period.windDirection)].filter(Boolean).join(" "),
    };
  });
}

function readPolygonGeometry(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const geometry = asRecord(value);
  const type = stringValue(geometry.type);

  if ((type === "Polygon" || type === "MultiPolygon") && Array.isArray(geometry.coordinates)) {
    return geometry as unknown as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }

  return null;
}

function recenterMap(map: mapboxgl.Map | null, location: StoredWeatherLocation) {
  map?.easeTo({
    center: [location.longitude, location.latitude],
    duration: 600,
    pitch: 42,
    zoom: Math.max(map.getZoom(), 7.4),
  });
}

function removeLayerAndSource(map: mapboxgl.Map, layerId: string, sourceId: string) {
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }

  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

function findFirstSymbolLayerId(map: mapboxgl.Map) {
  return map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
}

function createEmptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    features: [],
    type: "FeatureCollection",
  };
}

function createLocationDraft(location: StoredWeatherLocation | null): WeatherLocationDraft {
  return {
    countryCode: location?.countryCode || "US",
    latitude: typeof location?.latitude === "number" && Number.isFinite(location.latitude) ? formatDraftCoordinate(location.latitude) : "",
    longitude: typeof location?.longitude === "number" && Number.isFinite(location.longitude) ? formatDraftCoordinate(location.longitude) : "",
  };
}

function appendQueryParams(url: string, params: Record<string, string>) {
  const parsed = new URL(url);

  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }

  return parsed.toString();
}

function restoreMapboxTemplate(url: string) {
  return url.replace(/%7Bbbox-epsg-3857%7D/gi, "{bbox-epsg-3857}").replace(/%2C/g, ",").replace(/%3A/g, ":");
}

function roundToFiveMinutes(value: number) {
  return Math.floor(value / (5 * 60_000)) * 5 * 60_000;
}

function formatCoordinate(value: number) {
  return value.toFixed(4);
}

function formatDraftCoordinate(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(5)).toString() : "";
}

function formatClockTime(isoDate: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoDate));
  } catch {
    return "";
  }
}

function formatForecastHour(isoDate: string, fallbackIndex: number) {
  if (!isoDate) {
    return fallbackIndex === 0 ? "Now" : `+${fallbackIndex} h`;
  }

  return formatClockTime(isoDate) || `+${fallbackIndex} h`;
}

function createStableAlertId(properties: Record<string, unknown>) {
  return [stringValue(properties.event), stringValue(properties.effective), stringValue(properties.areaDesc)].filter(Boolean).join(":") || `alert-${Date.now()}`;
}

function getBlockingMapboxErrorMessage(event: unknown) {
  const record = asRecord(event);
  const error = record.error;
  const message = readErrorMessage(error, "");
  const normalized = message.toLowerCase();

  if (!message) {
    return "";
  }

  if (/\b(401|403|unauthorized|forbidden|access token|style|sprite|glyph)\b/.test(normalized)) {
    return message;
  }

  if (stringValue(record.sourceId) === VISIBLE_BASEMAP_SOURCE_ID) {
    return `Mapbox basemap warning: ${message}`;
  }

  if (stringValue(record.sourceId) === RADAR_SOURCE_ID) {
    return `NOAA radar layer warning: ${message}`;
  }

  return "";
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message.trim() : "";
    const status = typeof record.status === "number" ? `HTTP ${record.status}` : "";
    const statusText = typeof record.statusText === "string" ? record.statusText.trim() : "";

    return [message, status, statusText].filter(Boolean).join(": ") || fallback;
  }

  return fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function MapLocationIcon() {
  return <Crosshair size={32} aria-hidden="true" />;
}
