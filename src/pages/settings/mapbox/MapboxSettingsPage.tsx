import {
  CheckCircle2,
  Compass,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Globe2,
  KeyRound,
  Layers,
  Map as MapIcon,
  Mountain,
  MousePointer2,
  Radar,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { loadMapboxSettings, saveMapboxSettings } from "../../../services/mapboxSettings";
import {
  DEFAULT_MAPBOX_SETTINGS,
  MAPBOX_STYLE_PRESETS,
  normalizeMapboxSettings,
  resolveMapboxStyleUrl,
  type MapboxProjection,
  type MapboxScaleUnit,
  type MapboxSettings,
  type MapboxStandardLightPreset,
  type MapboxStandardTheme,
  type MapboxStylePreset,
} from "../../../types/mapbox";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

const stylePresetOptions: Array<{ id: MapboxStylePreset; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "standardSatellite", label: "Standard Sat" },
  { id: "streets", label: "Streets" },
  { id: "outdoors", label: "Outdoors" },
  { id: "satellite", label: "Satellite" },
  { id: "satelliteStreets", label: "Sat Streets" },
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "navigationDay", label: "Nav Day" },
  { id: "navigationNight", label: "Nav Night" },
  { id: "custom", label: "Custom" },
];

const projectionOptions: Array<{ id: MapboxProjection; label: string }> = [
  { id: "globe", label: "Globe" },
  { id: "mercator", label: "Mercator" },
  { id: "naturalEarth", label: "Natural Earth" },
  { id: "equalEarth", label: "Equal Earth" },
  { id: "winkelTripel", label: "Winkel Tripel" },
  { id: "equirectangular", label: "Equirectangular" },
  { id: "albers", label: "Albers" },
  { id: "lambertConformalConic", label: "Lambert" },
];

const lightPresetOptions: Array<{ id: MapboxStandardLightPreset; label: string }> = [
  { id: "day", label: "Day" },
  { id: "dawn", label: "Dawn" },
  { id: "dusk", label: "Dusk" },
  { id: "night", label: "Night" },
];

const themeOptions: Array<{ id: MapboxStandardTheme; label: string }> = [
  { id: "default", label: "Default" },
  { id: "faded", label: "Faded" },
  { id: "monochrome", label: "Mono" },
];

const scaleOptions: Array<{ id: MapboxScaleUnit; label: string }> = [
  { id: "imperial", label: "Imperial" },
  { id: "metric", label: "Metric" },
  { id: "nautical", label: "Nautical" },
];

export function MapboxSettingsPage() {
  const [settings, setSettings] = useState<MapboxSettings>(() => loadMapboxSettings());
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const styleUrl = resolveMapboxStyleUrl(settings);
  const tokenReady = settings.accessToken.trim().startsWith("pk.");

  function patchSettings(patch: Partial<MapboxSettings>) {
    const nextSettings = normalizeMapboxSettings({
      ...settings,
      ...patch,
    });

    setSettings(nextSettings);
    saveMapboxSettings(nextSettings);
    setStatus(null);
  }

  function resetSettings() {
    setSettings(DEFAULT_MAPBOX_SETTINGS);
    saveMapboxSettings(DEFAULT_MAPBOX_SETTINGS);
    setStatus({ kind: "success", text: "Mapbox settings reset to Gilbert defaults." });
  }

  async function checkRuntime() {
    setStatus({ kind: "warning", text: "Checking browser WebGL and Mapbox GL support..." });

    try {
      const mapboxgl = await import("mapbox-gl");
      const supported = mapboxgl.default.supported({
        failIfMajorPerformanceCaveat: settings.failIfMajorPerformanceCaveat,
      });

      if (!supported) {
        setStatus({ kind: "error", text: "Mapbox GL reports that this renderer is not supported with the current performance-caveat setting." });
        return;
      }

      setStatus({
        kind: tokenReady ? "success" : "warning",
        text: tokenReady ? `Mapbox GL is supported. The weather map will use ${styleUrl}.` : "Mapbox GL is supported. Add a public token that starts with pk. to render live Mapbox tiles.",
      });
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not check Mapbox GL support." });
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Configure the Mapbox GL JS map used by weather, radar, and future geospatial views." icon={MapIcon} title="Mapbox" />

      <div className="mapbox-settings-layout">
        <article className="settings-card settings-card-wide mapbox-token-card">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Access token</h2>
              <p>Use a public Mapbox token with only the scopes needed for client-side maps.</p>
            </div>
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>Mapbox maps</span>
              <strong>{settings.enabled ? "Enabled" : "Disabled"}</strong>
              <button className="settings-switch" type="button" role="switch" aria-checked={settings.enabled} data-on={settings.enabled} onClick={() => patchSettings({ enabled: !settings.enabled })}>
                <span />
              </button>
            </div>
          </div>

          <label className="settings-field">
            <span>Public access token</span>
            <div className="settings-secret-row">
              <input autoComplete="off" placeholder="pk.ey..." type={showToken ? "text" : "password"} value={settings.accessToken} onChange={(event) => patchSettings({ accessToken: event.target.value })} />
              <button type="button" aria-label={showToken ? "Hide Mapbox token" : "Show Mapbox token"} onClick={() => setShowToken((visible) => !visible)}>
                {showToken ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Clear Mapbox token" disabled={!settings.accessToken.trim()} onClick={() => patchSettings({ accessToken: "" })}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </label>

          <div className="mapbox-token-health" data-ready={tokenReady}>
            <span aria-hidden="true" />
            <strong>{tokenReady ? "Public token format looks ready" : "Waiting for a public pk token"}</strong>
            <small>{styleUrl}</small>
          </div>

          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" onClick={checkRuntime}>
              <CheckCircle2 size={16} aria-hidden="true" />
              Check runtime
            </button>
            <button className="settings-ghost-button" type="button" onClick={resetSettings}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset Mapbox
            </button>
            <a className="settings-ghost-button" href="https://account.mapbox.com/access-tokens/" rel="noreferrer" target="_blank">
              <ExternalLink size={16} aria-hidden="true" />
              Tokens
            </a>
          </div>

          {status ? (
            <div className="settings-status-banner" data-kind={status.kind}>
              {status.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Layers size={19} aria-hidden="true" />
            <div>
              <h2>Style</h2>
              <p>Choose a Mapbox-owned style or paste a Studio style URL.</p>
            </div>
          </div>

          <div className="mapbox-style-preset-grid" role="radiogroup" aria-label="Mapbox style preset">
            {stylePresetOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={settings.stylePreset === option.id} data-selected={settings.stylePreset === option.id} onClick={() => patchSettings({ stylePreset: option.id })}>
                {option.label}
              </button>
            ))}
          </div>

          <label className="settings-field">
            <span>Custom style URL</span>
            <input disabled={settings.stylePreset !== "custom"} placeholder="mapbox://styles/your-account/style-id" value={settings.customStyleUrl} onChange={(event) => patchSettings({ customStyleUrl: event.target.value })} />
          </label>

          <div className="settings-row-list">
            <ToggleRow label="Style optimized tiles" value={settings.styleOptimization} onToggle={() => patchSettings({ styleOptimization: !settings.styleOptimization })} />
            <ToggleRow label="Refresh expired tiles" value={settings.refreshExpiredTiles} onToggle={() => patchSettings({ refreshExpiredTiles: !settings.refreshExpiredTiles })} />
            <ToggleRow label="Render world copies" value={settings.renderWorldCopies} onToggle={() => patchSettings({ renderWorldCopies: !settings.renderWorldCopies })} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Globe2 size={19} aria-hidden="true" />
            <div>
              <h2>Standard style config</h2>
              <p>GL JS v3 Standard and Standard Satellite expose basemap configuration properties.</p>
            </div>
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Mapbox light preset">
            {lightPresetOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={settings.lightPreset === option.id} data-selected={settings.lightPreset === option.id} onClick={() => patchSettings({ lightPreset: option.id })}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Mapbox theme">
            {themeOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={settings.theme === option.id} data-selected={settings.theme === option.id} onClick={() => patchSettings({ theme: option.id })}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="settings-row-list">
            <ToggleRow label="Place labels" value={settings.showPlaceLabels} onToggle={() => patchSettings({ showPlaceLabels: !settings.showPlaceLabels })} />
            <ToggleRow label="Road labels" value={settings.showRoadLabels} onToggle={() => patchSettings({ showRoadLabels: !settings.showRoadLabels })} />
            <ToggleRow label="POI labels" value={settings.showPointOfInterestLabels} onToggle={() => patchSettings({ showPointOfInterestLabels: !settings.showPointOfInterestLabels })} />
            <ToggleRow label="Transit labels" value={settings.showTransitLabels} onToggle={() => patchSettings({ showTransitLabels: !settings.showTransitLabels })} />
            <ToggleRow label="Pedestrian roads" value={settings.showPedestrianRoads} onToggle={() => patchSettings({ showPedestrianRoads: !settings.showPedestrianRoads })} />
            <ToggleRow label="3D objects" value={settings.show3dObjects} onToggle={() => patchSettings({ show3dObjects: !settings.show3dObjects })} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Compass size={19} aria-hidden="true" />
            <div>
              <h2>Camera and projection</h2>
              <p>Defaults used when opening the compact weather map.</p>
            </div>
          </div>

          <div className="mapbox-projection-grid" role="radiogroup" aria-label="Mapbox projection">
            {projectionOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={settings.projection === option.id} data-selected={settings.projection === option.id} onClick={() => patchSettings({ projection: option.id })}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="settings-section-grid">
            <NumberField label="Zoom" max={24} min={0} step={0.1} value={settings.zoom} onChange={(zoom) => patchSettings({ zoom })} />
            <NumberField label="Pitch" max={85} min={0} step={1} value={settings.pitch} onChange={(pitch) => patchSettings({ pitch })} />
            <NumberField label="Bearing" max={180} min={-180} step={1} value={settings.bearing} onChange={(bearing) => patchSettings({ bearing })} />
            <NumberField label="Min zoom" max={24} min={0} step={1} value={settings.minZoom} onChange={(minZoom) => patchSettings({ minZoom })} />
            <NumberField label="Max zoom" max={24} min={0} step={1} value={settings.maxZoom} onChange={(maxZoom) => patchSettings({ maxZoom })} />
            <label className="settings-field">
              <span>Worldview</span>
              <input maxLength={12} value={settings.worldview} onChange={(event) => patchSettings({ worldview: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Language</span>
              <input placeholder="auto, en, es..." value={settings.language} onChange={(event) => patchSettings({ language: event.target.value })} />
            </label>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <MousePointer2 size={19} aria-hidden="true" />
            <div>
              <h2>Interaction</h2>
              <p>Fine-tune Mapbox handlers for desktop and touch surfaces.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <ToggleRow label="Interactive map" value={settings.interactive} onToggle={() => patchSettings({ interactive: !settings.interactive })} />
            <ToggleRow label="Cooperative gestures" value={settings.cooperativeGestures} onToggle={() => patchSettings({ cooperativeGestures: !settings.cooperativeGestures })} />
            <ToggleRow label="Scroll zoom" value={settings.scrollZoom} onToggle={() => patchSettings({ scrollZoom: !settings.scrollZoom })} />
            <ToggleRow label="Drag pan" value={settings.dragPan} onToggle={() => patchSettings({ dragPan: !settings.dragPan })} />
            <ToggleRow label="Drag rotate" value={settings.dragRotate} onToggle={() => patchSettings({ dragRotate: !settings.dragRotate })} />
            <ToggleRow label="Pitch with rotate" value={settings.pitchWithRotate} onToggle={() => patchSettings({ pitchWithRotate: !settings.pitchWithRotate })} />
            <ToggleRow label="Keyboard" value={settings.keyboard} onToggle={() => patchSettings({ keyboard: !settings.keyboard })} />
            <ToggleRow label="Double-click zoom" value={settings.doubleClickZoom} onToggle={() => patchSettings({ doubleClickZoom: !settings.doubleClickZoom })} />
            <ToggleRow label="Box zoom" value={settings.boxZoom} onToggle={() => patchSettings({ boxZoom: !settings.boxZoom })} />
            <ToggleRow label="Touch zoom rotate" value={settings.touchZoomRotate} onToggle={() => patchSettings({ touchZoomRotate: !settings.touchZoomRotate })} />
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Crosshair size={19} aria-hidden="true" />
            <div>
              <h2>Controls</h2>
              <p>Mapbox controls rendered inside the compact weather map.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <ToggleRow label="Attribution" value={settings.attributionControl} onToggle={() => patchSettings({ attributionControl: !settings.attributionControl })} />
            <ToggleRow label="Compact attribution" value={settings.compactAttribution} onToggle={() => patchSettings({ compactAttribution: !settings.compactAttribution })} />
            <ToggleRow label="Navigation" value={settings.navigationControl} onToggle={() => patchSettings({ navigationControl: !settings.navigationControl })} />
            <ToggleRow label="Fullscreen" value={settings.fullscreenControl} onToggle={() => patchSettings({ fullscreenControl: !settings.fullscreenControl })} />
            <ToggleRow label="Scale" value={settings.scaleControl} onToggle={() => patchSettings({ scaleControl: !settings.scaleControl })} />
            <ToggleRow label="Geolocate" value={settings.geolocateControl} onToggle={() => patchSettings({ geolocateControl: !settings.geolocateControl })} />
            <ToggleRow label="Track user" value={settings.trackUserLocation} onToggle={() => patchSettings({ trackUserLocation: !settings.trackUserLocation })} />
            <ToggleRow label="User heading" value={settings.showUserHeading} onToggle={() => patchSettings({ showUserHeading: !settings.showUserHeading })} />
            <ToggleRow label="Accuracy circle" value={settings.showAccuracyCircle} onToggle={() => patchSettings({ showAccuracyCircle: !settings.showAccuracyCircle })} />
          </div>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Scale unit">
            {scaleOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={settings.scaleUnit === option.id} data-selected={settings.scaleUnit === option.id} onClick={() => patchSettings({ scaleUnit: option.id })}>
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Mountain size={19} aria-hidden="true" />
            <div>
              <h2>Terrain</h2>
              <p>DEM terrain and atmosphere for map depth.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <ToggleRow label="Terrain" value={settings.terrainEnabled} onToggle={() => patchSettings({ terrainEnabled: !settings.terrainEnabled })} />
            <ToggleRow label="Atmosphere" value={settings.atmosphereEnabled} onToggle={() => patchSettings({ atmosphereEnabled: !settings.atmosphereEnabled })} />
            <ToggleRow label="Location marker" value={settings.showLocationMarker} onToggle={() => patchSettings({ showLocationMarker: !settings.showLocationMarker })} />
          </div>
          <NumberField label="Terrain exaggeration" max={5} min={0} step={0.05} value={settings.terrainExaggeration} onChange={(terrainExaggeration) => patchSettings({ terrainExaggeration })} />
          <NumberField label="DEM tile size" max={1024} min={256} step={256} value={settings.terrainTileSize} onChange={(terrainTileSize) => patchSettings({ terrainTileSize })} />
          <label className="settings-field">
            <span>Terrain source</span>
            <input value={settings.terrainSourceUrl} onChange={(event) => patchSettings({ terrainSourceUrl: event.target.value })} />
          </label>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Gauge size={19} aria-hidden="true" />
            <div>
              <h2>Rendering</h2>
              <p>Performance-sensitive Map constructor options.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <ToggleRow label="Antialias" value={settings.antialias} onToggle={() => patchSettings({ antialias: !settings.antialias })} />
            <ToggleRow label="Preserve drawing buffer" value={settings.preserveDrawingBuffer} onToggle={() => patchSettings({ preserveDrawingBuffer: !settings.preserveDrawingBuffer })} />
            <ToggleRow label="Fail on software renderer" value={settings.failIfMajorPerformanceCaveat} onToggle={() => patchSettings({ failIfMajorPerformanceCaveat: !settings.failIfMajorPerformanceCaveat })} />
            <ToggleRow label="Collect resource timing" value={settings.collectResourceTiming} onToggle={() => patchSettings({ collectResourceTiming: !settings.collectResourceTiming })} />
            <ToggleRow label="Performance metrics" value={settings.performanceMetricsCollection} onToggle={() => patchSettings({ performanceMetricsCollection: !settings.performanceMetricsCollection })} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Radar size={19} aria-hidden="true" />
            <div>
              <h2>Weather layers</h2>
              <p>Reserved controls for the full radar workspace coming next.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <ToggleRow label="Radar layer slot" value={settings.radarLayerEnabled} onToggle={() => patchSettings({ radarLayerEnabled: !settings.radarLayerEnabled })} />
            <div className="settings-row">
              <span>Radar opacity</span>
              <strong>{Math.round(settings.radarOpacity * 100)}%</strong>
              <input max={1} min={0} step={0.01} type="range" value={settings.radarOpacity} onChange={(event) => patchSettings({ radarOpacity: Number.parseFloat(event.target.value) })} />
            </div>
            <NumberField label="Radar refresh minutes" max={30} min={1} step={1} value={settings.radarRefreshMinutes} onChange={(radarRefreshMinutes) => patchSettings({ radarRefreshMinutes })} />
          </div>
        </article>

        <article className="settings-card settings-card-wide integration-docs-card mapbox-docs-card">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Docs alignment</h2>
              <p>Updated May 12, 2026 from the Mapbox GL JS v3 docs.</p>
            </div>
          </div>
          <div className="integration-docs-body">
            <section className="integration-doc-section">
              <h3>What this page maps to</h3>
              <ol className="integration-doc-steps">
                <li>Map constructor options: token, style, camera, projection, interaction handlers, terrain performance, and attribution.</li>
                <li>Standard style configuration: light preset, theme, label visibility, pedestrian roads, and 3D objects.</li>
                <li>Controls: attribution, navigation, fullscreen, scale, and geolocation controls.</li>
                <li>Weather layer slots: preserved now so NOAA radar and alert overlays can drop into the same Mapbox surface later.</li>
              </ol>
            </section>
            <section className="integration-doc-section">
              <h3>Official links</h3>
              <ul className="integration-doc-link-list">
                <li><a href="https://docs.mapbox.com/mapbox-gl-js/api/map/" rel="noreferrer" target="_blank"><span>Map API</span><ExternalLink size={14} aria-hidden="true" /></a></li>
                <li><a href="https://docs.mapbox.com/mapbox-gl-js/api/markers/" rel="noreferrer" target="_blank"><span>Markers and controls</span><ExternalLink size={14} aria-hidden="true" /></a></li>
                <li><a href="https://docs.mapbox.com/map-styles/standard/api/" rel="noreferrer" target="_blank"><span>Standard style config</span><ExternalLink size={14} aria-hidden="true" /></a></li>
                <li><a href="https://docs.mapbox.com/help/dive-deeper/access-tokens/" rel="noreferrer" target="_blank"><span>Access tokens</span><ExternalLink size={14} aria-hidden="true" /></a></li>
              </ul>
            </section>
          </div>
        </article>
      </div>
    </>
  );
}

function ToggleRow({ label, onToggle, value }: { label: string; onToggle: () => void; value: boolean }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong>{value ? "On" : "Off"}</strong>
      <button className="settings-switch" type="button" role="switch" aria-checked={value} data-on={value} onClick={onToggle}>
        <span />
      </button>
    </div>
  );
}

function NumberField({ label, max, min, onChange, step, value }: { label: string; max: number; min: number; onChange: (value: number) => void; step: number; value: number }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input max={max} min={min} step={step} type="number" value={value} onChange={(event) => onChange(Number.parseFloat(event.target.value))} />
    </label>
  );
}
