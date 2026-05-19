import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject } from "react";
import mapboxgl, { type MapOptions } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { loadMapboxSettings, subscribeMapboxSettings } from "../../services/mapboxSettings";
import {
  applyMapboxControls,
  applyVisibleMapboxBasemap,
  createMapboxStandardConfig,
  getBlockingMapboxErrorMessage,
  readMapboxErrorMessage,
  resolveVisibleMapboxStyleUrl,
  useResolvedAppTheme,
} from "../../services/mapboxRuntime";
import type { MapboxSettings } from "../../types/mapbox";

interface MapboxWeatherMapProps {
  condition: string;
  latitude?: number;
  longitude?: number;
  onOpenRadar?: () => void;
  place: string;
}

const TERRAIN_SOURCE_ID = "gilbert-mapbox-terrain";

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
      setStatus(readMapboxErrorMessage(error, "Mapbox map could not start."));
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
