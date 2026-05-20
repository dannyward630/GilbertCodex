import { ChevronDown, Copy, Monitor, Moon, MousePointer2, Palette, RotateCcw, Sun, Upload } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode, type RefObject } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DEFAULT_APP_APPEARANCE_SETTINGS,
  normalizeAppAppearanceSettings,
  normalizeAppThemeSettings,
} from "../../../lib/appearance";
import type { AppAppearanceSettings, AppThemeComponentColors, AppThemeSettings, AppearanceMode, AppearanceMotionPreference } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import {
  darkThemePresets,
  lightThemePresets,
  pairedThemePresets,
  type ModeThemePreset,
  type PairedThemePreset,
  type ThemeKey,
  type ThemePresetTheme,
} from "./appearanceThemePresets";

type ThemeColorKey = "accent" | "background" | "foreground";
type ComponentColorKey = keyof AppThemeComponentColors;
type FontKey = "codeFont" | "uiFont";

interface FontOption {
  label: string;
  value: string;
}

const appearanceOptions: Array<{ icon: LucideIcon; label: string; value: AppearanceMode }> = [
  { icon: Sun, label: "Light", value: "light" },
  { icon: Moon, label: "Dark", value: "dark" },
  { icon: Monitor, label: "System", value: "system" },
];

const motionOptions: Array<{ label: string; value: AppearanceMotionPreference }> = [
  { label: "System", value: "system" },
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

const visualEffectOptions: Array<{ label: string; value: AppThemeSettings["visualEffect"] }> = [
  { label: "None", value: "none" },
  { label: "Aurora", value: "aurora" },
  { label: "Circuit", value: "circuit" },
  { label: "Party", value: "confetti" },
  { label: "Stars", value: "constellation" },
  { label: "Dawn", value: "dawn" },
  { label: "Embers", value: "embers" },
  { label: "Matrix", value: "matrix" },
  { label: "Neon", value: "neon" },
  { label: "Ocean", value: "ocean" },
  { label: "Prism", value: "prism" },
  { label: "Scanlines", value: "scanlines" },
  { label: "Spotlight", value: "spotlight" },
];

const themeLabels: Record<ThemeKey, string> = {
  dark: "Dark theme",
  light: "Light theme",
};

const colorLabels: Record<ThemeColorKey, string> = {
  accent: "Accent",
  background: "Background",
  foreground: "Foreground",
};

const uiFontOptions: FontOption[] = [
  { label: "System UI", value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: "Segoe UI Variable", value: '"Segoe UI Variable Text", "Segoe UI", sans-serif' },
  { label: "Inter", value: '"Inter", "Segoe UI", sans-serif' },
  { label: "Aptos", value: '"Aptos", "Segoe UI", sans-serif' },
  { label: "Geist", value: '"Geist", "Inter", "Segoe UI", sans-serif' },
  { label: "Roboto", value: '"Roboto", "Segoe UI", sans-serif' },
  { label: "IBM Plex Sans", value: '"IBM Plex Sans", "Segoe UI", sans-serif' },
  { label: "Atkinson Hyperlegible", value: '"Atkinson Hyperlegible", "Segoe UI", sans-serif' },
  { label: "SF Pro style", value: '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: "Verdana", value: 'Verdana, "Segoe UI", sans-serif' },
  { label: "Arial", value: 'Arial, "Segoe UI", sans-serif' },
];

const codeFontOptions: FontOption[] = [
  { label: "System mono", value: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
  { label: "Cascadia Code", value: '"Cascadia Code", "SFMono-Regular", Consolas, monospace' },
  { label: "JetBrains Mono", value: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace' },
  { label: "Fira Code", value: '"Fira Code", "Cascadia Code", Consolas, monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", Consolas, monospace' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", Consolas, monospace' },
  { label: "Roboto Mono", value: '"Roboto Mono", Consolas, monospace' },
  { label: "Geist Mono", value: '"Geist Mono", "Cascadia Code", Consolas, monospace' },
  { label: "SF Mono", value: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace' },
  { label: "Menlo", value: 'Menlo, Monaco, Consolas, monospace' },
  { label: "Consolas", value: 'Consolas, "Courier New", monospace' },
];

const componentColorGroups: Array<{ colors: Array<{ key: ComponentColorKey; label: string }>; title: string }> = [
  {
    title: "App chrome",
    colors: [
      { key: "appBackground", label: "App background" },
      { key: "chrome", label: "Top chrome" },
      { key: "chromeBorder", label: "Chrome border" },
      { key: "pageBackground", label: "Chat page" },
      { key: "pageBackgroundAlt", label: "Page depth" },
    ],
  },
  {
    title: "Side menu",
    colors: [
      { key: "sidebar", label: "Sidebar" },
      { key: "sidebarWarm", label: "Sidebar tint" },
      { key: "sidebarBorder", label: "Sidebar border" },
      { key: "sidebarHover", label: "Hover row" },
      { key: "sidebarActive", label: "Active row" },
    ],
  },
  {
    title: "Apps page",
    colors: [
      { key: "appsBackground", label: "Page background" },
      { key: "appsBackgroundGlow", label: "Page glow" },
      { key: "appsPanel", label: "Cards" },
      { key: "appsPanelRaised", label: "Raised cards" },
      { key: "appsBorder", label: "Borders" },
      { key: "appsControl", label: "Controls" },
      { key: "appsControlHover", label: "Control hover" },
      { key: "appsAccent", label: "Accent" },
      { key: "appsAccentSoft", label: "Soft accent" },
      { key: "appsPrimaryText", label: "Button text" },
      { key: "appsSuccess", label: "Connected" },
      { key: "appsWarning", label: "Setup" },
      { key: "appsInstalled", label: "Installed" },
      { key: "appsDanger", label: "Errors" },
    ],
  },
  {
    title: "Panels and fields",
    colors: [
      { key: "panel", label: "Panels" },
      { key: "surface", label: "Surface" },
      { key: "surfaceRaised", label: "Raised surface" },
      { key: "surfaceSoft", label: "Soft surface" },
      { key: "field", label: "Inputs" },
      { key: "fieldBorder", label: "Input border" },
      { key: "border", label: "Borders" },
      { key: "borderSoft", label: "Soft borders" },
    ],
  },
  {
    title: "Composer and menus",
    colors: [
      { key: "composer", label: "Composer" },
      { key: "composerAlt", label: "Composer depth" },
      { key: "composerBorder", label: "Composer border" },
      { key: "composerControl", label: "Composer controls" },
      { key: "composerControlHover", label: "Control hover" },
      { key: "composerFocus", label: "Focus border" },
      { key: "composerMuted", label: "Composer muted" },
      { key: "popover", label: "Menus" },
      { key: "popoverBorder", label: "Menu border" },
    ],
  },
  {
    title: "Terminal",
    colors: [
      { key: "terminalPanel", label: "Panel" },
      { key: "terminalBorder", label: "Border" },
      { key: "terminalRail", label: "Session rail" },
      { key: "terminalToolbar", label: "Toolbar" },
      { key: "terminalOutput", label: "Output canvas" },
      { key: "terminalControl", label: "Controls" },
      { key: "terminalControlHover", label: "Control hover" },
      { key: "terminalText", label: "Terminal text" },
      { key: "terminalMuted", label: "Muted text" },
      { key: "terminalAccent", label: "Prompt accent" },
      { key: "terminalCommand", label: "Command color" },
      { key: "terminalSelection", label: "Selection" },
      { key: "terminalCursor", label: "Cursor" },
      { key: "terminalError", label: "Error" },
    ],
  },
  {
    title: "Text and status",
    colors: [
      { key: "textMuted", label: "Muted text" },
      { key: "textDim", label: "Dim text" },
      { key: "success", label: "Success" },
      { key: "warning", label: "Warning" },
      { key: "danger", label: "Danger" },
      { key: "cyan", label: "Cyan" },
      { key: "violet", label: "Violet" },
      { key: "rose", label: "Rose" },
    ],
  },
];
const advancedComponentColorCount = componentColorGroups.reduce((count, group) => count + group.colors.length, 0);

interface AppearanceSettingsPageProps {
  appearanceMode: AppearanceMode;
  appearanceSettings: AppAppearanceSettings;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onAppearanceSettingsChange: (settings: AppAppearanceSettings) => void;
  showHeading?: boolean;
}

interface AppearanceStatus {
  kind: "error" | "success";
  text: string;
}

export function AppearanceSettingsPage({
  appearanceMode,
  appearanceSettings,
  onAppearanceModeChange,
  onAppearanceSettingsChange,
  showHeading = true,
}: AppearanceSettingsPageProps) {
  const lightImportRef = useRef<HTMLInputElement>(null);
  const darkImportRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<AppearanceStatus | null>(null);
  const [prefersLight, setPrefersLight] = useState(() => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false);
  const normalizedSettings = normalizeAppAppearanceSettings(appearanceSettings);
  const activeThemeKey: ThemeKey = appearanceMode === "system" ? (prefersLight ? "light" : "dark") : appearanceMode;
  const visibleModePresets = activeThemeKey === "light" ? lightThemePresets : darkThemePresets;
  const visibleModeTitle = activeThemeKey === "light" ? "Light themes" : "Dark themes";
  const visibleModeLabel = activeThemeKey === "light" ? "Light" : "Dark";
  const selectedPairedPreset = findSelectedPairedPreset(normalizedSettings);
  const selectedModePreset = selectedPairedPreset ? null : findSelectedModePreset(normalizedSettings, visibleModePresets);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: light)");

    if (!mediaQuery) {
      return;
    }

    const handleChange = () => setPrefersLight(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  function updateAppearanceSettings(nextSettings: AppAppearanceSettings) {
    setStatus(null);
    onAppearanceSettingsChange(normalizeAppAppearanceSettings(nextSettings));
  }

  function updateTheme(themeKey: ThemeKey, patch: Partial<AppThemeSettings>) {
    updateAppearanceSettings({
      ...normalizedSettings,
      [themeKey]: normalizeAppThemeSettings({ ...normalizedSettings[themeKey], ...patch }, normalizedSettings[themeKey], themeKey),
    });
  }

  function updateThemeColor(themeKey: ThemeKey, colorKey: ThemeColorKey, value: string) {
    const normalizedColor = normalizeHexInput(value);

    if (!normalizedColor) {
      return;
    }

    const componentPatch = createBaseColorComponentPatch(colorKey, normalizedColor);

    updateTheme(themeKey, {
      [colorKey]: normalizedColor,
      ...(componentPatch
        ? {
            componentColors: {
              ...normalizedSettings[themeKey].componentColors,
              ...componentPatch,
            },
          }
        : {}),
    });
  }

  function updateThemeComponentColor(themeKey: ThemeKey, colorKey: ComponentColorKey, value: string) {
    const normalizedColor = normalizeHexInput(value);

    if (!normalizedColor) {
      return;
    }

    updateTheme(themeKey, {
      componentColors: {
        ...normalizedSettings[themeKey].componentColors,
        [colorKey]: normalizedColor,
      },
    });
  }

  function updateThemeFont(themeKey: ThemeKey, fontKey: "codeFont" | "uiFont", value: string) {
    updateTheme(themeKey, { [fontKey]: value });
  }

  function updateFontSize(key: "codeFontSize" | "uiFontSize", value: string) {
    updateAppearanceSettings({
      ...normalizedSettings,
      [key]: Number.parseInt(value, 10),
    });
  }

  async function copyTheme(themeKey: ThemeKey) {
    const theme = normalizedSettings[themeKey];

    try {
      await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
      setStatus({ kind: "success", text: `${themeLabels[themeKey]} copied.` });
    } catch {
      setStatus({ kind: "error", text: "Theme could not be copied." });
    }
  }

  async function importTheme(themeKey: ThemeKey, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      const candidate = parsed?.[themeKey] ?? parsed?.theme ?? parsed;
      const importedTheme = normalizeAppThemeSettings(candidate, normalizedSettings[themeKey], themeKey);

      updateTheme(themeKey, importedTheme);
      setStatus({ kind: "success", text: `${themeLabels[themeKey]} imported.` });
    } catch {
      setStatus({ kind: "error", text: "Theme import needs valid JSON." });
    }
  }

  function resetAppearance() {
    onAppearanceModeChange("system");
    updateAppearanceSettings(DEFAULT_APP_APPEARANCE_SETTINGS);
    setStatus({ kind: "success", text: "Appearance defaults restored." });
  }

  function applyPairedThemePreset(preset: PairedThemePreset) {
    updateAppearanceSettings({
      ...normalizedSettings,
      dark: buildPresetTheme("dark", preset.dark),
      light: buildPresetTheme("light", preset.light),
    });
    setStatus({ kind: "success", text: `${preset.name} applied.` });
  }

  function applyModeThemePreset(preset: ModeThemePreset) {
    updateAppearanceSettings({
      ...normalizedSettings,
      [preset.mode]: buildPresetTheme(preset.mode, preset.theme),
    });
    onAppearanceModeChange(preset.mode);
    setStatus({ kind: "success", text: `${preset.name} applied to ${themeLabels[preset.mode].toLowerCase()}.` });
  }

  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Themes, colors, fonts, motion, cursors, and density." icon={Palette} title="Appearance" /> : null}

      <div className="appearance-layout">
        <article className="settings-card settings-card-wide appearance-card appearance-mode-card">
          <div className="settings-card-heading">
            <Monitor size={19} aria-hidden="true" />
            <div>
              <h2>Theme</h2>
              <p>Use light, dark, or match your system.</p>
            </div>
          </div>
          <div className="theme-mode-control appearance-mode-control" role="radiogroup" aria-label="Theme mode">
            {appearanceOptions.map((option) => {
              const Icon = option.icon;
              const selected = option.value === appearanceMode;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-selected={selected}
                  onClick={() => onAppearanceModeChange(option.value)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </article>

        <article className="settings-card settings-card-wide appearance-card appearance-library-card">
          <div className="settings-card-heading">
            <Palette size={19} aria-hidden="true" />
            <div>
              <h2>Theme library</h2>
              <p>Ready-made palettes for the whole app.</p>
            </div>
          </div>
          <div className="appearance-theme-library">
            <ThemePresetSection title="Classic pairs" count={pairedThemePresets.length} selectedLabel={selectedPairedPreset?.name}>
              {pairedThemePresets.map((preset) => (
                <ThemePresetButton
                  key={preset.id}
                  label={preset.name}
                  modeLabel="Both"
                  selected={selectedPairedPreset?.id === preset.id}
                  theme={preset.dark}
                  onClick={() => applyPairedThemePreset(preset)}
                />
              ))}
            </ThemePresetSection>

            <ThemePresetSection key={activeThemeKey} title={visibleModeTitle} count={visibleModePresets.length} selectedLabel={selectedModePreset?.name}>
              {visibleModePresets.map((preset) => (
                <ThemePresetButton
                  key={preset.id}
                  label={preset.name}
                  modeLabel={visibleModeLabel}
                  selected={selectedModePreset?.id === preset.id}
                  theme={preset.theme}
                  onClick={() => applyModeThemePreset(preset)}
                />
              ))}
            </ThemePresetSection>
          </div>
        </article>

        <ThemeEditor
          importInputRef={lightImportRef}
          theme={normalizedSettings.light}
          themeKey="light"
          onCopyTheme={() => void copyTheme("light")}
          onImportTheme={(event) => void importTheme("light", event)}
          onRequestImport={() => lightImportRef.current?.click()}
          onThemeColorChange={updateThemeColor}
          onThemeComponentColorChange={updateThemeComponentColor}
          onThemeFontChange={updateThemeFont}
          onThemePatch={updateTheme}
        />
        <ThemeEditor
          importInputRef={darkImportRef}
          theme={normalizedSettings.dark}
          themeKey="dark"
          onCopyTheme={() => void copyTheme("dark")}
          onImportTheme={(event) => void importTheme("dark", event)}
          onRequestImport={() => darkImportRef.current?.click()}
          onThemeColorChange={updateThemeColor}
          onThemeComponentColorChange={updateThemeComponentColor}
          onThemeFontChange={updateThemeFont}
          onThemePatch={updateTheme}
        />

        <article className="settings-card settings-card-wide appearance-card">
          <div className="settings-card-heading">
            <MousePointer2 size={19} aria-hidden="true" />
            <div>
              <h2>Interaction</h2>
              <p>Cursor, motion, and base type sizing.</p>
            </div>
          </div>

          <div className="appearance-preference-grid">
            <div className="appearance-preference-row">
              <div>
                <strong>Use pointer cursors</strong>
                <span>Change the cursor to a pointer when hovering over interactive elements</span>
              </div>
              <ToggleButton
                checked={normalizedSettings.usePointerCursor}
                label="Use pointer cursors"
                onChange={(checked) => updateAppearanceSettings({ ...normalizedSettings, usePointerCursor: checked })}
              />
            </div>

            <div className="appearance-preference-row">
              <div>
                <strong>Reduce motion</strong>
                <span>Reduce animations or match your system</span>
              </div>
              <div className="settings-segmented-control settings-segmented-control-compact appearance-motion-control" role="radiogroup" aria-label="Reduce motion">
                {motionOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={normalizedSettings.reduceMotion === option.value}
                    data-selected={normalizedSettings.reduceMotion === option.value}
                    onClick={() => updateAppearanceSettings({ ...normalizedSettings, reduceMotion: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="appearance-size-grid">
            <SizeControl
              detail="Adjust the base size used for the Codex UI"
              label="UI font size"
              max={22}
              min={11}
              value={normalizedSettings.uiFontSize}
              onChange={(value) => updateFontSize("uiFontSize", value)}
            />
            <SizeControl
              detail="Adjust the base size used for code across chats and diffs"
              label="Code font size"
              max={20}
              min={10}
              value={normalizedSettings.codeFontSize}
              onChange={(value) => updateFontSize("codeFontSize", value)}
            />
          </div>

          <div className="appearance-footer-actions">
            {status ? <span className="settings-status" data-kind={status.kind}>{status.text}</span> : <span />}
            <button className="settings-ghost-button" type="button" onClick={resetAppearance}>
              <RotateCcw size={15} aria-hidden="true" />
              Reset defaults
            </button>
          </div>
        </article>
      </div>
    </>
  );
}

interface ThemePresetSectionProps {
  children: ReactNode;
  count: number;
  selectedLabel?: string;
  title: string;
}

function ThemePresetSection({ children, count, selectedLabel, title }: ThemePresetSectionProps) {
  const [collapsed, setCollapsed] = useState(true);
  const contentId = `appearance-theme-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className="appearance-theme-library-section" aria-label={title} data-collapsed={collapsed}>
      <button
        className="appearance-theme-library-section-heading"
        type="button"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="appearance-theme-library-section-title">
          <ChevronDown size={16} aria-hidden="true" />
          <h3>{title}</h3>
        </span>
        <span className="appearance-theme-library-section-badges">
          {selectedLabel ? <span className="appearance-theme-library-section-selected">{selectedLabel}</span> : null}
          <span className="appearance-theme-library-section-count">{count}</span>
        </span>
      </button>
      {collapsed ? null : (
        <div id={contentId} className="appearance-theme-library-grid">
          {children}
        </div>
      )}
    </section>
  );
}

interface ThemePresetButtonProps {
  label: string;
  modeLabel: string;
  onClick: () => void;
  selected: boolean;
  theme: ThemePresetTheme;
}

const effectLabels: Record<string, string> = {
  aurora: "Aurora",
  circuit: "Circuit",
  confetti: "Party",
  constellation: "Stars",
  dawn: "Dawn",
  embers: "Embers",
  matrix: "Matrix",
  neon: "Neon",
  ocean: "Ocean",
  prism: "Prism",
  scanlines: "Scan",
  spotlight: "Glow",
};

function ThemePresetButton({ label, modeLabel, onClick, selected, theme }: ThemePresetButtonProps) {
  const effect = theme.visualEffect && theme.visualEffect !== "none" ? theme.visualEffect : null;
  const previewStyle = {
    "--appearance-preset-accent": theme.accent,
    "--appearance-preset-bg": theme.background,
    "--appearance-preset-panel": theme.componentColors?.panel ?? theme.background,
    "--appearance-preset-text": theme.foreground,
  } as CSSProperties;

  return (
    <button
      className="appearance-theme-preset"
      type="button"
      aria-pressed={selected}
      style={previewStyle}
      data-effect={effect ?? "none"}
      data-selected={selected}
      onClick={onClick}
    >
      <span className="appearance-theme-preset-preview" aria-hidden="true">
        <i />
        <b />
        <em />
      </span>
      <span className="appearance-theme-preset-copy">
        <strong>{label}</strong>
        <span className="appearance-theme-preset-meta">
          <span>{modeLabel}</span>
          {effect ? <span>{effectLabels[effect] ?? "Motion"}</span> : null}
        </span>
      </span>
    </button>
  );
}

interface ThemeEditorProps {
  importInputRef: RefObject<HTMLInputElement>;
  onCopyTheme: () => void;
  onImportTheme: (event: ChangeEvent<HTMLInputElement>) => void;
  onRequestImport: () => void;
  onThemeColorChange: (themeKey: ThemeKey, colorKey: ThemeColorKey, value: string) => void;
  onThemeComponentColorChange: (themeKey: ThemeKey, colorKey: ComponentColorKey, value: string) => void;
  onThemeFontChange: (themeKey: ThemeKey, fontKey: FontKey, value: string) => void;
  onThemePatch: (themeKey: ThemeKey, patch: Partial<AppThemeSettings>) => void;
  theme: AppThemeSettings;
  themeKey: ThemeKey;
}

function ThemeEditor({
  importInputRef,
  onCopyTheme,
  onImportTheme,
  onRequestImport,
  onThemeColorChange,
  onThemeComponentColorChange,
  onThemeFontChange,
  onThemePatch,
  theme,
  themeKey,
}: ThemeEditorProps) {
  const [advancedColorsOpen, setAdvancedColorsOpen] = useState(false);
  const advancedColorsId = `appearance-advanced-colors-${themeKey}`;
  const previewStyle = {
    "--appearance-preview-accent": theme.accent,
    "--appearance-preview-bg": theme.background,
    "--appearance-preview-font": theme.uiFont,
    "--appearance-preview-text": theme.foreground,
  } as CSSProperties;

  return (
    <article className="settings-card settings-card-wide appearance-card appearance-theme-card" data-theme-card={themeKey} style={previewStyle}>
      <div className="appearance-theme-heading">
        <div>
          <h2>{themeLabels[themeKey]}</h2>
        </div>
        <div className="appearance-theme-actions">
          <input ref={importInputRef} className="sr-only" type="file" accept=".json,application/json" onChange={onImportTheme} />
          <button className="settings-ghost-button" type="button" onClick={onRequestImport}>
            <Upload size={15} aria-hidden="true" />
            Import
          </button>
          <button className="settings-ghost-button" type="button" onClick={onCopyTheme}>
            <Copy size={15} aria-hidden="true" />
            Copy theme
          </button>
        </div>
      </div>

      <div className="appearance-theme-preview" aria-hidden="true">
        <span>Aa</span>
        <strong>Codex</strong>
        <em>Accent</em>
      </div>

      <div className="appearance-color-grid">
        {(Object.keys(colorLabels) as ThemeColorKey[]).map((colorKey) => (
          <ColorField
            key={colorKey}
            ariaLabel={`${themeLabels[themeKey]} ${colorLabels[colorKey]}`}
            label={colorLabels[colorKey]}
            value={theme[colorKey]}
            onChange={(value) => onThemeColorChange(themeKey, colorKey, value)}
          />
        ))}
      </div>

      <div className="appearance-font-grid">
        <FontSelect fontKey="uiFont" label="UI font" value={theme.uiFont} onChange={(value) => onThemeFontChange(themeKey, "uiFont", value)} />
        <FontSelect fontKey="codeFont" label="Code font" value={theme.codeFont} onChange={(value) => onThemeFontChange(themeKey, "codeFont", value)} />
      </div>

      <div className="appearance-theme-bottom-row">
        <div className="appearance-preference-row appearance-preference-row-compact">
          <div>
            <strong>Translucent sidebar</strong>
          </div>
          <ToggleButton
            checked={theme.translucentSidebar}
            label={`${themeLabels[themeKey]} translucent sidebar`}
            onChange={(checked) => onThemePatch(themeKey, { translucentSidebar: checked })}
          />
        </div>
        <label className="appearance-effect-control">
          <span>Effect</span>
          <select value={theme.visualEffect} onChange={(event) => onThemePatch(themeKey, { visualEffect: event.target.value as AppThemeSettings["visualEffect"] })}>
            {visualEffectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="appearance-contrast-control">
          <span>Contrast</span>
          <div>
            <input
              type="range"
              min={0}
              max={100}
              value={theme.contrast}
              onChange={(event) => onThemePatch(themeKey, { contrast: Number.parseInt(event.target.value, 10) })}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={theme.contrast}
              onChange={(event) => onThemePatch(themeKey, { contrast: Number.parseInt(event.target.value, 10) })}
            />
          </div>
        </label>
      </div>

      <div className="appearance-component-colors" data-collapsed={!advancedColorsOpen}>
        <button
          className="appearance-advanced-toggle"
          type="button"
          aria-expanded={advancedColorsOpen}
          aria-controls={advancedColorsId}
          onClick={() => setAdvancedColorsOpen((open) => !open)}
        >
          <span className="appearance-advanced-toggle-title">
            <ChevronDown size={16} aria-hidden="true" />
            <span>
              <strong>Advanced component colors</strong>
              <small>Fine tune Apps, terminal, sidebar, panels, menus, and status colors.</small>
            </span>
          </span>
          <span className="appearance-advanced-toggle-count">{advancedComponentColorCount}</span>
        </button>
        {advancedColorsOpen ? (
          <div id={advancedColorsId} className="appearance-component-color-groups">
            {componentColorGroups.map((group) => (
              <section key={group.title} className="appearance-component-color-group" aria-label={`${themeLabels[themeKey]} ${group.title}`}>
                <h4>{group.title}</h4>
                <div className="appearance-component-color-grid">
                  {group.colors.map((color) => (
                    <ColorField
                      key={color.key}
                      ariaLabel={`${themeLabels[themeKey]} ${color.label}`}
                      label={color.label}
                      value={theme.componentColors[color.key]}
                      onChange={(value) => onThemeComponentColorChange(themeKey, color.key, value)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

interface FontSelectProps {
  fontKey: FontKey;
  label: string;
  onChange: (value: string) => void;
  value: string;
}

function FontSelect({ fontKey, label, onChange, value }: FontSelectProps) {
  const options = fontKey === "uiFont" ? uiFontOptions : codeFontOptions;
  const selectedValue = options.some((option) => option.value === value) ? value : "custom";

  return (
    <label className="settings-field appearance-font-field">
      <span>{label}</span>
      <select value={selectedValue} onChange={(event) => event.target.value !== "custom" && onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.label} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value="custom">Custom stack</option>
      </select>
      {selectedValue === "custom" ? <input value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} /> : null}
    </label>
  );
}

interface ColorFieldProps {
  ariaLabel: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}

function ColorField({ ariaLabel, label, onChange, value }: ColorFieldProps) {
  return (
    <label className="appearance-color-control">
      <span>{label}</span>
      <div>
        <input type="color" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} />
        <input type="text" value={value} spellCheck={false} aria-label={`${ariaLabel} hex`} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}

interface ToggleButtonProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

function ToggleButton({ checked, label, onChange }: ToggleButtonProps) {
  return (
    <button className="appearance-toggle" type="button" aria-label={label} aria-pressed={checked} data-on={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

interface SizeControlProps {
  disabled?: boolean;
  detail: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  unit?: string;
  value: number;
}

function SizeControl({ detail, disabled = false, label, max, min, onChange, unit = "px", value }: SizeControlProps) {
  return (
    <label className="appearance-size-control" data-disabled={disabled}>
      <span>{label}</span>
      <small>{detail}</small>
      <div>
        <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <input type="number" min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <strong>{unit}</strong>
      </div>
    </label>
  );
}

function createBaseColorComponentPatch(colorKey: ThemeColorKey, color: string): Partial<AppThemeComponentColors> | null {
  if (colorKey === "accent") {
    return {
      appsAccent: color,
      appsBackgroundGlow: color,
      composerFocus: color,
      terminalAccent: color,
      terminalCursor: color,
    };
  }

  if (colorKey === "background") {
    return {
      appBackground: color,
      appsBackground: color,
      chrome: color,
      pageBackground: color,
    };
  }

  return null;
}

function buildPresetTheme(themeKey: ThemeKey, presetTheme: ThemePresetTheme): AppThemeSettings {
  const baseTheme = normalizeAppThemeSettings(presetTheme, DEFAULT_APP_APPEARANCE_SETTINGS[themeKey], themeKey);
  return normalizeAppThemeSettings(
    {
      ...baseTheme,
      componentColors: {
        ...baseTheme.componentColors,
        ...presetTheme.componentColors,
      },
    },
    baseTheme,
    themeKey,
  );
}

function findSelectedPairedPreset(settings: AppAppearanceSettings) {
  return (
    pairedThemePresets.find(
      (preset) =>
        themeSettingsMatch(settings.light, buildPresetTheme("light", preset.light)) &&
        themeSettingsMatch(settings.dark, buildPresetTheme("dark", preset.dark)),
    ) ?? null
  );
}

function findSelectedModePreset(settings: AppAppearanceSettings, presets: ModeThemePreset[]) {
  return presets.find((preset) => themeSettingsMatch(settings[preset.mode], buildPresetTheme(preset.mode, preset.theme))) ?? null;
}

function themeSettingsMatch(current: AppThemeSettings, presetTheme: AppThemeSettings) {
  if (
    current.accent !== presetTheme.accent ||
    current.background !== presetTheme.background ||
    current.codeFont !== presetTheme.codeFont ||
    current.contrast !== presetTheme.contrast ||
    current.foreground !== presetTheme.foreground ||
    current.translucentSidebar !== presetTheme.translucentSidebar ||
    current.uiFont !== presetTheme.uiFont ||
    current.visualEffect !== presetTheme.visualEffect
  ) {
    return false;
  }

  const colorKeys = new Set<keyof AppThemeComponentColors>([
    ...(Object.keys(current.componentColors) as Array<keyof AppThemeComponentColors>),
    ...(Object.keys(presetTheme.componentColors) as Array<keyof AppThemeComponentColors>),
  ]);

  for (const colorKey of colorKeys) {
    if (current.componentColors[colorKey] !== presetTheme.componentColors[colorKey]) {
      return false;
    }
  }

  return true;
}

function normalizeHexInput(value: string) {
  const trimmed = value.trim();
  const shortMatch = trimmed.match(/^#?([0-9a-fA-F]{3})$/);

  if (shortMatch) {
    return `#${shortMatch[1].split("").map((part) => part + part).join("").toUpperCase()}`;
  }

  const longMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);

  if (longMatch) {
    return `#${longMatch[1].toUpperCase()}`;
  }

  return null;
}
