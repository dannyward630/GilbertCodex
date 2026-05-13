export type MapboxProjection = "albers" | "equalEarth" | "equirectangular" | "globe" | "lambertConformalConic" | "mercator" | "naturalEarth" | "winkelTripel";
export type MapboxScaleUnit = "imperial" | "metric" | "nautical";
export type MapboxStandardLightPreset = "dawn" | "day" | "dusk" | "night";
export type MapboxStandardTheme = "default" | "faded" | "monochrome";
export type MapboxStylePreset = "custom" | "dark" | "light" | "navigationDay" | "navigationNight" | "outdoors" | "satellite" | "satelliteStreets" | "standard" | "standardSatellite" | "streets";

export interface MapboxSettings {
  accessToken: string;
  antialias: boolean;
  atmosphereEnabled: boolean;
  attributionControl: boolean;
  bearing: number;
  boxZoom: boolean;
  collectResourceTiming: boolean;
  compactAttribution: boolean;
  cooperativeGestures: boolean;
  customStyleUrl: string;
  doubleClickZoom: boolean;
  dragPan: boolean;
  dragRotate: boolean;
  enabled: boolean;
  failIfMajorPerformanceCaveat: boolean;
  fullscreenControl: boolean;
  geolocateControl: boolean;
  interactive: boolean;
  keyboard: boolean;
  language: string;
  lightPreset: MapboxStandardLightPreset;
  maxZoom: number;
  minZoom: number;
  navigationControl: boolean;
  performanceMetricsCollection: boolean;
  pitch: number;
  pitchWithRotate: boolean;
  preserveDrawingBuffer: boolean;
  projection: MapboxProjection;
  radarLayerEnabled: boolean;
  radarOpacity: number;
  radarRefreshMinutes: number;
  refreshExpiredTiles: boolean;
  renderWorldCopies: boolean;
  scaleControl: boolean;
  scaleUnit: MapboxScaleUnit;
  scrollZoom: boolean;
  show3dObjects: boolean;
  showAccuracyCircle: boolean;
  showLocationMarker: boolean;
  showPedestrianRoads: boolean;
  showPlaceLabels: boolean;
  showPointOfInterestLabels: boolean;
  showRoadLabels: boolean;
  showTransitLabels: boolean;
  showUserHeading: boolean;
  styleOptimization: boolean;
  stylePreset: MapboxStylePreset;
  terrainEnabled: boolean;
  terrainExaggeration: number;
  terrainSourceUrl: string;
  terrainTileSize: number;
  theme: MapboxStandardTheme;
  touchZoomRotate: boolean;
  trackUserLocation: boolean;
  worldview: string;
  zoom: number;
}

export const MAPBOX_STYLE_PRESETS: Record<Exclude<MapboxStylePreset, "custom">, string> = {
  dark: "mapbox://styles/mapbox/dark-v11",
  light: "mapbox://styles/mapbox/light-v11",
  navigationDay: "mapbox://styles/mapbox/navigation-day-v1",
  navigationNight: "mapbox://styles/mapbox/navigation-night-v1",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
  satellite: "mapbox://styles/mapbox/satellite-v9",
  satelliteStreets: "mapbox://styles/mapbox/satellite-streets-v12",
  standard: "mapbox://styles/mapbox/standard",
  standardSatellite: "mapbox://styles/mapbox/standard-satellite",
  streets: "mapbox://styles/mapbox/streets-v12",
};

export const DEFAULT_MAPBOX_SETTINGS: MapboxSettings = {
  accessToken: "",
  antialias: false,
  atmosphereEnabled: true,
  attributionControl: true,
  bearing: 0,
  boxZoom: true,
  collectResourceTiming: false,
  compactAttribution: true,
  cooperativeGestures: true,
  customStyleUrl: "",
  doubleClickZoom: true,
  dragPan: true,
  dragRotate: true,
  enabled: true,
  failIfMajorPerformanceCaveat: false,
  fullscreenControl: false,
  geolocateControl: false,
  interactive: true,
  keyboard: true,
  language: "auto",
  lightPreset: "day",
  maxZoom: 18,
  minZoom: 0,
  navigationControl: true,
  performanceMetricsCollection: false,
  pitch: 42,
  pitchWithRotate: true,
  preserveDrawingBuffer: false,
  projection: "globe",
  radarLayerEnabled: false,
  radarOpacity: 0.72,
  radarRefreshMinutes: 5,
  refreshExpiredTiles: true,
  renderWorldCopies: true,
  scaleControl: true,
  scaleUnit: "imperial",
  scrollZoom: true,
  show3dObjects: true,
  showAccuracyCircle: true,
  showLocationMarker: true,
  showPedestrianRoads: true,
  showPlaceLabels: true,
  showPointOfInterestLabels: false,
  showRoadLabels: true,
  showTransitLabels: false,
  showUserHeading: true,
  styleOptimization: false,
  stylePreset: "standard",
  terrainEnabled: true,
  terrainExaggeration: 1.35,
  terrainSourceUrl: "mapbox://mapbox.mapbox-terrain-dem-v1",
  terrainTileSize: 512,
  theme: "default",
  touchZoomRotate: true,
  trackUserLocation: false,
  worldview: "US",
  zoom: 8.6,
};

export function resolveMapboxStyleUrl(settings: MapboxSettings) {
  const styleUrl = settings.stylePreset === "custom" ? settings.customStyleUrl.trim() : MAPBOX_STYLE_PRESETS[settings.stylePreset];

  if (!settings.styleOptimization || !styleUrl.startsWith("mapbox://styles/") || styleUrl.includes("?")) {
    return styleUrl || MAPBOX_STYLE_PRESETS.standard;
  }

  return `${styleUrl}?optimize=true`;
}

export function normalizeMapboxSettings(value: unknown): MapboxSettings {
  const stored = typeof value === "object" && value ? (value as Partial<MapboxSettings>) : {};
  const minZoom = normalizeNumber(stored.minZoom, DEFAULT_MAPBOX_SETTINGS.minZoom, 0, 24);
  const maxZoom = Math.max(minZoom, normalizeNumber(stored.maxZoom, DEFAULT_MAPBOX_SETTINGS.maxZoom, 0, 24));

  return {
    accessToken: normalizeText(stored.accessToken, DEFAULT_MAPBOX_SETTINGS.accessToken),
    antialias: normalizeBoolean(stored.antialias, DEFAULT_MAPBOX_SETTINGS.antialias),
    atmosphereEnabled: normalizeBoolean(stored.atmosphereEnabled, DEFAULT_MAPBOX_SETTINGS.atmosphereEnabled),
    attributionControl: normalizeBoolean(stored.attributionControl, DEFAULT_MAPBOX_SETTINGS.attributionControl),
    bearing: normalizeNumber(stored.bearing, DEFAULT_MAPBOX_SETTINGS.bearing, -180, 180),
    boxZoom: normalizeBoolean(stored.boxZoom, DEFAULT_MAPBOX_SETTINGS.boxZoom),
    collectResourceTiming: normalizeBoolean(stored.collectResourceTiming, DEFAULT_MAPBOX_SETTINGS.collectResourceTiming),
    compactAttribution: normalizeBoolean(stored.compactAttribution, DEFAULT_MAPBOX_SETTINGS.compactAttribution),
    cooperativeGestures: normalizeBoolean(stored.cooperativeGestures, DEFAULT_MAPBOX_SETTINGS.cooperativeGestures),
    customStyleUrl: normalizeText(stored.customStyleUrl, DEFAULT_MAPBOX_SETTINGS.customStyleUrl),
    doubleClickZoom: normalizeBoolean(stored.doubleClickZoom, DEFAULT_MAPBOX_SETTINGS.doubleClickZoom),
    dragPan: normalizeBoolean(stored.dragPan, DEFAULT_MAPBOX_SETTINGS.dragPan),
    dragRotate: normalizeBoolean(stored.dragRotate, DEFAULT_MAPBOX_SETTINGS.dragRotate),
    enabled: normalizeBoolean(stored.enabled, DEFAULT_MAPBOX_SETTINGS.enabled),
    failIfMajorPerformanceCaveat: normalizeBoolean(stored.failIfMajorPerformanceCaveat, DEFAULT_MAPBOX_SETTINGS.failIfMajorPerformanceCaveat),
    fullscreenControl: normalizeBoolean(stored.fullscreenControl, DEFAULT_MAPBOX_SETTINGS.fullscreenControl),
    geolocateControl: normalizeBoolean(stored.geolocateControl, DEFAULT_MAPBOX_SETTINGS.geolocateControl),
    interactive: normalizeBoolean(stored.interactive, DEFAULT_MAPBOX_SETTINGS.interactive),
    keyboard: normalizeBoolean(stored.keyboard, DEFAULT_MAPBOX_SETTINGS.keyboard),
    language: normalizeText(stored.language, DEFAULT_MAPBOX_SETTINGS.language),
    lightPreset: isMapboxLightPreset(stored.lightPreset) ? stored.lightPreset : DEFAULT_MAPBOX_SETTINGS.lightPreset,
    maxZoom,
    minZoom,
    navigationControl: normalizeBoolean(stored.navigationControl, DEFAULT_MAPBOX_SETTINGS.navigationControl),
    performanceMetricsCollection: normalizeBoolean(stored.performanceMetricsCollection, DEFAULT_MAPBOX_SETTINGS.performanceMetricsCollection),
    pitch: normalizeNumber(stored.pitch, DEFAULT_MAPBOX_SETTINGS.pitch, 0, 85),
    pitchWithRotate: normalizeBoolean(stored.pitchWithRotate, DEFAULT_MAPBOX_SETTINGS.pitchWithRotate),
    preserveDrawingBuffer: normalizeBoolean(stored.preserveDrawingBuffer, DEFAULT_MAPBOX_SETTINGS.preserveDrawingBuffer),
    projection: isMapboxProjection(stored.projection) ? stored.projection : DEFAULT_MAPBOX_SETTINGS.projection,
    radarLayerEnabled: normalizeBoolean(stored.radarLayerEnabled, DEFAULT_MAPBOX_SETTINGS.radarLayerEnabled),
    radarOpacity: normalizeNumber(stored.radarOpacity, DEFAULT_MAPBOX_SETTINGS.radarOpacity, 0, 1),
    radarRefreshMinutes: normalizeInteger(stored.radarRefreshMinutes, DEFAULT_MAPBOX_SETTINGS.radarRefreshMinutes, 1, 30),
    refreshExpiredTiles: normalizeBoolean(stored.refreshExpiredTiles, DEFAULT_MAPBOX_SETTINGS.refreshExpiredTiles),
    renderWorldCopies: normalizeBoolean(stored.renderWorldCopies, DEFAULT_MAPBOX_SETTINGS.renderWorldCopies),
    scaleControl: normalizeBoolean(stored.scaleControl, DEFAULT_MAPBOX_SETTINGS.scaleControl),
    scaleUnit: isMapboxScaleUnit(stored.scaleUnit) ? stored.scaleUnit : DEFAULT_MAPBOX_SETTINGS.scaleUnit,
    scrollZoom: normalizeBoolean(stored.scrollZoom, DEFAULT_MAPBOX_SETTINGS.scrollZoom),
    show3dObjects: normalizeBoolean(stored.show3dObjects, DEFAULT_MAPBOX_SETTINGS.show3dObjects),
    showAccuracyCircle: normalizeBoolean(stored.showAccuracyCircle, DEFAULT_MAPBOX_SETTINGS.showAccuracyCircle),
    showLocationMarker: normalizeBoolean(stored.showLocationMarker, DEFAULT_MAPBOX_SETTINGS.showLocationMarker),
    showPedestrianRoads: normalizeBoolean(stored.showPedestrianRoads, DEFAULT_MAPBOX_SETTINGS.showPedestrianRoads),
    showPlaceLabels: normalizeBoolean(stored.showPlaceLabels, DEFAULT_MAPBOX_SETTINGS.showPlaceLabels),
    showPointOfInterestLabels: normalizeBoolean(stored.showPointOfInterestLabels, DEFAULT_MAPBOX_SETTINGS.showPointOfInterestLabels),
    showRoadLabels: normalizeBoolean(stored.showRoadLabels, DEFAULT_MAPBOX_SETTINGS.showRoadLabels),
    showTransitLabels: normalizeBoolean(stored.showTransitLabels, DEFAULT_MAPBOX_SETTINGS.showTransitLabels),
    showUserHeading: normalizeBoolean(stored.showUserHeading, DEFAULT_MAPBOX_SETTINGS.showUserHeading),
    styleOptimization: normalizeBoolean(stored.styleOptimization, DEFAULT_MAPBOX_SETTINGS.styleOptimization),
    stylePreset: isMapboxStylePreset(stored.stylePreset) ? stored.stylePreset : DEFAULT_MAPBOX_SETTINGS.stylePreset,
    terrainEnabled: normalizeBoolean(stored.terrainEnabled, DEFAULT_MAPBOX_SETTINGS.terrainEnabled),
    terrainExaggeration: normalizeNumber(stored.terrainExaggeration, DEFAULT_MAPBOX_SETTINGS.terrainExaggeration, 0, 5),
    terrainSourceUrl: normalizeText(stored.terrainSourceUrl, DEFAULT_MAPBOX_SETTINGS.terrainSourceUrl),
    terrainTileSize: normalizeInteger(stored.terrainTileSize, DEFAULT_MAPBOX_SETTINGS.terrainTileSize, 256, 1024),
    theme: isMapboxTheme(stored.theme) ? stored.theme : DEFAULT_MAPBOX_SETTINGS.theme,
    touchZoomRotate: normalizeBoolean(stored.touchZoomRotate, DEFAULT_MAPBOX_SETTINGS.touchZoomRotate),
    trackUserLocation: normalizeBoolean(stored.trackUserLocation, DEFAULT_MAPBOX_SETTINGS.trackUserLocation),
    worldview: normalizeShortText(stored.worldview, DEFAULT_MAPBOX_SETTINGS.worldview, 12),
    zoom: normalizeNumber(stored.zoom, DEFAULT_MAPBOX_SETTINGS.zoom, minZoom, maxZoom),
  };
}

function isMapboxProjection(value: unknown): value is MapboxProjection {
  return value === "albers" || value === "equalEarth" || value === "equirectangular" || value === "globe" || value === "lambertConformalConic" || value === "mercator" || value === "naturalEarth" || value === "winkelTripel";
}

function isMapboxScaleUnit(value: unknown): value is MapboxScaleUnit {
  return value === "imperial" || value === "metric" || value === "nautical";
}

function isMapboxStylePreset(value: unknown): value is MapboxStylePreset {
  return value === "custom" || value === "dark" || value === "light" || value === "navigationDay" || value === "navigationNight" || value === "outdoors" || value === "satellite" || value === "satelliteStreets" || value === "standard" || value === "standardSatellite" || value === "streets";
}

function isMapboxTheme(value: unknown): value is MapboxStandardTheme {
  return value === "default" || value === "faded" || value === "monochrome";
}

function isMapboxLightPreset(value: unknown): value is MapboxStandardLightPreset {
  return value === "dawn" || value === "day" || value === "dusk" || value === "night";
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(parsed), min), max);
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function normalizeShortText(value: unknown, fallback: string, maxLength: number) {
  return normalizeText(value, fallback).slice(0, maxLength);
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}
