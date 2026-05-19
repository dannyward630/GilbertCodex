import { useEffect, useState } from "react";
import mapboxgl, { type Map as MapboxMap, type MapOptions, type RasterLayerSpecification, type RasterSourceSpecification } from "mapbox-gl";
import { MAPBOX_STYLE_PRESETS, resolveMapboxStyleUrl, type MapboxSettings } from "../types/mapbox";

export type ResolvedAppTheme = "dark" | "light";

export const VISIBLE_BASEMAP_LAYER_ID = "gilbert-mapbox-visible-basemap-layer";
export const VISIBLE_BASEMAP_SOURCE_ID = "gilbert-mapbox-visible-basemap-source";

export function applyVisibleMapboxBasemap(map: MapboxMap, settings: MapboxSettings, appTheme: ResolvedAppTheme) {
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

export function resolveVisibleMapboxStyleUrl(settings: MapboxSettings, appTheme: ResolvedAppTheme) {
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

export function applyMapboxControls(map: MapboxMap, settings: MapboxSettings, options: { scaleMaxWidth?: number } = {}) {
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
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: options.scaleMaxWidth ?? 88, unit: settings.scaleUnit }), "bottom-left");
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

export function getBlockingMapboxErrorMessage(event: unknown, sourceWarningLabels: Record<string, string> = {}) {
  const record = typeof event === "object" && event ? (event as Record<string, unknown>) : {};
  const message = readMapboxErrorMessage(record.error, "");
  const normalized = message.toLowerCase();
  const sourceId = typeof record.sourceId === "string" ? record.sourceId.trim() : "";

  if (!message) {
    return "";
  }

  if (/\b(401|403|unauthorized|forbidden|access token|style|sprite|glyph)\b/.test(normalized)) {
    return message;
  }

  const sourceLabel = sourceId === VISIBLE_BASEMAP_SOURCE_ID ? "Mapbox basemap" : sourceWarningLabels[sourceId];

  return sourceLabel ? `${sourceLabel} warning: ${message}` : "";
}

export function useResolvedAppTheme(): ResolvedAppTheme {
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

export function readMapboxErrorMessage(error: unknown, fallback: string) {
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

export function createMapboxStandardConfig(settings: MapboxSettings): MapOptions["config"] {
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

function readResolvedAppTheme(): ResolvedAppTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
