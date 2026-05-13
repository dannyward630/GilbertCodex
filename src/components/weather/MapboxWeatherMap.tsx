import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject } from "react";
import mapboxgl, { type MapOptions, type RasterLayerSpecification, type RasterSourceSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { loadMapboxSettings, subscribeMapboxSettings } from "../../services/mapboxSettings";
import { MAPBOX_STYLE_PRESETS, resolveMapboxStyleUrl, type MapboxSettings } from "../../types/mapbox";

interface MapboxWeatherMapProps {
  condition: string;
  latitude?: number;
  longitude?: number;
  onOpenRadar?: () => void;
  place: string;
}

type ResolvedAppTheme = "dark" | "light";

const TERRAIN_SOURCE_ID = "gilbert-mapbox-terrain";
const VISIBLE_BASEMAP_LAYER_ID = "gilbert-mapbox-visible-basemap-layer";
const VISIBLE_BASEMAP_SOURCE_ID = "gilbert-mapbox-visible-basemap-source";

export function MapboxWeatherMap({ condition, latitude, longitude, onOpenRadar, place }: MapboxWeatherMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [settings, setSettings] = useState<MapboxSettings>(() => loadMapboxSettings());
  const [status, setStatus] = useState("");
  const readyForMap = settings.enabled && Boolean(settings.accessToken.trim()) && Number.isFinite(latitude) && Number.isFinite(longitude);
  const appTheme = useResolvedAppTheme();
  const styleUrl = useMemo(() => resolveVisibleMapboxStyleUrl(settings, appTheme), [appTheme, settings]);

  useEffect(() => subscribeMapboxSettings(setSettings), []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || !readyForMap || typeof latitude !== "number" || typeof longitude !== "number") {
      return;
    }

    setStatus("");
    mapboxgl.accessToken = settings.accessToken.trim();

    let map: mapboxgl.Map;

    try {
      map = new mapboxgl.Map({
        accessToken: settings.accessToken.trim(),
        antialias: settings.antialias,
        attributionControl: false,
        bearing: settings.bearing,
        boxZoom: settings.boxZoom,
        center: [longitude, latitude],
        collectResourceTiming: settings.collectResourceTiming,
        cooperativeGestures: settings.cooperativeGestures,
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
        pitch: settings.pitch,
        pitchWithRotate: settings.pitchWithRotate,
        preserveDrawingBuffer: settings.preserveDrawingBuffer,
        projection: settings.projection,
        refreshExpiredTiles: settings.refreshExpiredTiles,
        renderWorldCopies: settings.renderWorldCopies,
        scrollZoom: settings.scrollZoom,
        style: styleUrl,
        touchZoomRotate: settings.touchZoomRotate,
        trackResize: true,
        worldview: settings.worldview || undefined,
        zoom: settings.zoom,
        config: createMapboxStandardConfig(settings),
        container,
      } satisfies MapOptions);
    } catch (error) {
      setStatus(readErrorMessage(error, "Mapbox map could not start."));
      return;
    }

    map.on("error", (event) => {
      const message = getBlockingMapboxErrorMessage(event);

      if (message) {
        setStatus(message);
      }
    });

    map.on("load", () => {
      applyMapboxControls(map, settings);
      applyVisibleMapboxBasemap(map, settings, appTheme);
      applyMapboxTerrain(map, settings);
      applyMapboxMarker(map, settings, longitude, latitude, place, condition, markerRef);
      window.setTimeout(() => map.resize(), 50);
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
    };
  }, [appTheme, condition, latitude, longitude, place, readyForMap, settings, styleUrl]);

  if (!settings.enabled) {
    return (
      <div
        className="mapbox-weather-map-empty"
        data-clickable={Boolean(onOpenRadar)}
        role={onOpenRadar ? "button" : undefined}
        tabIndex={onOpenRadar ? 0 : undefined}
        onClick={onOpenRadar}
        onKeyDown={(event) => handleOpenRadarKeyDown(event, onOpenRadar)}
      >
        <strong>Mapbox map disabled</strong>
        <span>Enable it in Settings &gt; Mapbox.</span>
      </div>
    );
  }

  if (!settings.accessToken.trim()) {
    return (
      <div
        className="mapbox-weather-map-empty"
        data-clickable={Boolean(onOpenRadar)}
        role={onOpenRadar ? "button" : undefined}
        tabIndex={onOpenRadar ? 0 : undefined}
        onClick={onOpenRadar}
        onKeyDown={(event) => handleOpenRadarKeyDown(event, onOpenRadar)}
      >
        <strong>Mapbox token needed</strong>
        <span>Add a public token in Settings &gt; Mapbox.</span>
      </div>
    );
  }

  if (!readyForMap) {
    return (
      <div
        className="mapbox-weather-map-empty"
        data-clickable={Boolean(onOpenRadar)}
        role={onOpenRadar ? "button" : undefined}
        tabIndex={onOpenRadar ? 0 : undefined}
        onClick={onOpenRadar}
        onKeyDown={(event) => handleOpenRadarKeyDown(event, onOpenRadar)}
      >
        <strong>Location needed</strong>
        <span>Allow location access or set a saved weather location.</span>
      </div>
    );
  }

  return (
    <div
      className="mapbox-weather-map-shell"
      data-clickable={Boolean(onOpenRadar)}
      role={onOpenRadar ? "button" : undefined}
      tabIndex={onOpenRadar ? 0 : undefined}
      onClick={(event) => handleOpenRadarClick(event, onOpenRadar)}
      onKeyDown={(event) => handleOpenRadarKeyDown(event, onOpenRadar)}
    >
      <div className="mapbox-weather-map" ref={containerRef} aria-label={`Map for ${place || "current location"}`} />
      <div className="mapbox-weather-map-overlay">
        <span>{place || "Current location"}</span>
        <strong>{condition}</strong>
      </div>
      {onOpenRadar ? <div className="mapbox-weather-map-open">Open radar</div> : null}
      {settings.radarLayerEnabled ? <div className="mapbox-weather-radar-badge">Radar layer slot</div> : null}
      {status ? <div className="mapbox-weather-map-status">{status}</div> : null}
    </div>
  );
}

function handleOpenRadarClick(event: MouseEvent<HTMLDivElement>, onOpenRadar?: () => void) {
  if (!onOpenRadar || (event.target instanceof HTMLElement && event.target.closest(".mapboxgl-ctrl"))) {
    return;
  }

  onOpenRadar();
}

function handleOpenRadarKeyDown(event: KeyboardEvent<HTMLDivElement>, onOpenRadar?: () => void) {
  if (!onOpenRadar || (event.key !== "Enter" && event.key !== " ")) {
    return;
  }

  event.preventDefault();
  onOpenRadar();
}

function getBlockingMapboxErrorMessage(event: unknown) {
  const record = typeof event === "object" && event ? (event as Record<string, unknown>) : {};
  const error = record.error;
  const message = readErrorMessage(error, "");
  const normalized = message.toLowerCase();

  if (!message) {
    return "";
  }

  if (/\b(401|403|unauthorized|forbidden|access token|style|sprite|glyph)\b/.test(normalized)) {
    return message;
  }

  if (record.sourceId === VISIBLE_BASEMAP_SOURCE_ID) {
    return `Mapbox basemap warning: ${message}`;
  }

  return "";
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
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 88, unit: settings.scaleUnit }), "bottom-left");
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

  if (!settings.terrainEnabled || !settings.terrainSourceUrl.trim()) {
    return;
  }

  map.addSource(TERRAIN_SOURCE_ID, {
    type: "raster-dem",
    url: settings.terrainSourceUrl.trim(),
    tileSize: settings.terrainTileSize,
  });
  map.setTerrain({ exaggeration: settings.terrainExaggeration, source: TERRAIN_SOURCE_ID });
}

function applyMapboxMarker(
  map: mapboxgl.Map,
  settings: MapboxSettings,
  longitude: number,
  latitude: number,
  place: string,
  condition: string,
  markerRef: MutableRefObject<mapboxgl.Marker | null>,
) {
  if (!settings.showLocationMarker) {
    return;
  }

  const markerElement = document.createElement("div");
  markerElement.className = "mapbox-weather-marker";
  markerElement.setAttribute("aria-label", [place, condition].filter(Boolean).join(", "));

  markerRef.current = new mapboxgl.Marker({
    element: markerElement,
    occludedOpacity: 0.45,
  })
    .setLngLat([longitude, latitude])
    .addTo(map);
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
