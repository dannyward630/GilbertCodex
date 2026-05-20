import type { AppAppearanceSettings, AppThemeComponentColors, AppThemeSettings, AppThemeVisualEffect, AppearanceMode, AppearanceMotionPreference } from "../types/settings";

export type ResolvedAppearanceTheme = "dark" | "light";

export const DEFAULT_UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const DEFAULT_CODE_FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

type AppThemeBaseSettings = Omit<AppThemeSettings, "componentColors">;

const DEFAULT_DARK_THEME_BASE: AppThemeBaseSettings = {
  accent: "#339CFF",
  background: "#181818",
  codeFont: DEFAULT_CODE_FONT,
  contrast: 60,
  foreground: "#FFFFFF",
  translucentSidebar: true,
  uiFont: DEFAULT_UI_FONT,
  visualEffect: "none",
};

const DEFAULT_LIGHT_THEME_BASE: AppThemeBaseSettings = {
  accent: "#339CFF",
  background: "#FFFFFF",
  codeFont: DEFAULT_CODE_FONT,
  contrast: 45,
  foreground: "#1A1C1F",
  translucentSidebar: true,
  uiFont: DEFAULT_UI_FONT,
  visualEffect: "none",
};

export const DEFAULT_APP_APPEARANCE_SETTINGS: AppAppearanceSettings = {
  codeFontSize: 12,
  dark: {
    ...DEFAULT_DARK_THEME_BASE,
    componentColors: createDefaultComponentColors("dark", DEFAULT_DARK_THEME_BASE),
  },
  light: {
    ...DEFAULT_LIGHT_THEME_BASE,
    componentColors: createDefaultComponentColors("light", DEFAULT_LIGHT_THEME_BASE),
  },
  reduceMotion: "system",
  uiFontSize: 14,
  usePointerCursor: true,
};

const MIN_UI_FONT_SIZE = 11;
const MAX_UI_FONT_SIZE = 22;
const MIN_CODE_FONT_SIZE = 10;
const MAX_CODE_FONT_SIZE = 20;

const APPEARANCE_CUSTOM_PROPERTIES = [
  "--accent",
  "--accent-2",
  "--accent-3",
  "--app-bg",
  "--apps-accent",
  "--apps-accent-soft",
  "--apps-bg",
  "--apps-bg-glow",
  "--apps-border",
  "--apps-control-bg",
  "--apps-control-hover",
  "--apps-danger",
  "--apps-installed",
  "--apps-panel",
  "--apps-panel-raised",
  "--apps-primary-text",
  "--apps-success",
  "--apps-warning",
  "--appearance-background",
  "--appearance-foreground",
  "--border",
  "--blue",
  "--blue-soft",
  "--browser-preview-accent",
  "--browser-preview-address-bg",
  "--browser-preview-button-hover",
  "--browser-preview-content-bg",
  "--browser-preview-invalid",
  "--browser-preview-line",
  "--browser-preview-line-focus",
  "--browser-preview-line-strong",
  "--browser-preview-muted",
  "--browser-preview-strong-text",
  "--browser-preview-subtle",
  "--browser-preview-surface-soft",
  "--browser-preview-surface-softer",
  "--browser-preview-tab-bg",
  "--browser-preview-tabbar-bg",
  "--browser-preview-text",
  "--browser-preview-toolbar-bg",
  "--browser-preview-window-bg",
  "--chat-page-bg",
  "--chat-page-bg-2",
  "--chat-page-glow",
  "--chrome",
  "--chrome-border",
  "--chrome-text",
  "--code-font-size",
  "--composer-bg",
  "--composer-bg-2",
  "--composer-border",
  "--composer-control-bg",
  "--composer-control-hover",
  "--composer-focus-border",
  "--composer-muted",
  "--cyan",
  "--cyan-soft",
  "--danger",
  "--field-bg",
  "--field-border",
  "--field-gradient",
  "--focus-ring",
  "--font-display",
  "--font-mono",
  "--font-ui",
  "--gold",
  "--green",
  "--hover",
  "--hover-strong",
  "--line",
  "--line-soft",
  "--modal-scrim",
  "--muted",
  "--page-gradient",
  "--page-gradient-soft",
  "--panel-gradient",
  "--popover-bg",
  "--popover-border",
  "--red",
  "--rose",
  "--rose-soft",
  "--shadow-lg",
  "--shadow-popover",
  "--shadow-subtle",
  "--sidebar",
  "--sidebar-border",
  "--sidebar-gradient",
  "--sidebar-warm",
  "--surface",
  "--surface-2",
  "--surface-panel",
  "--surface-raised",
  "--surface-soft",
  "--surface-strong",
  "--terminal-accent",
  "--terminal-border",
  "--terminal-command",
  "--terminal-control-bg",
  "--terminal-control-hover",
  "--terminal-cursor",
  "--terminal-cursor-accent",
  "--terminal-error",
  "--terminal-muted",
  "--terminal-output-bg",
  "--terminal-panel-bg",
  "--terminal-rail-bg",
  "--terminal-scrollbar-thumb",
  "--terminal-selection-bg",
  "--terminal-selection-fg",
  "--terminal-success",
  "--terminal-text",
  "--terminal-toolbar-bg",
  "--terminal-warning",
  "--text",
  "--text-dim",
  "--text-muted",
  "--theme-effect-blend",
  "--theme-effect-color",
  "--theme-effect-color-2",
  "--theme-effect-color-3",
  "--theme-effect-opacity",
  "--theme-effect-speed",
  "--ui-font-size",
  "--violet",
  "--violet-soft",
  "--workspace-bg",
] as const;

interface RgbColor {
  b: number;
  g: number;
  r: number;
}

const COMPONENT_COLOR_KEYS = [
  "appBackground",
  "appsAccent",
  "appsAccentSoft",
  "appsBackground",
  "appsBackgroundGlow",
  "appsBorder",
  "appsControl",
  "appsControlHover",
  "appsDanger",
  "appsInstalled",
  "appsPanel",
  "appsPanelRaised",
  "appsPrimaryText",
  "appsSuccess",
  "appsWarning",
  "border",
  "borderSoft",
  "chrome",
  "chromeBorder",
  "composer",
  "composerAlt",
  "composerBorder",
  "composerControl",
  "composerControlHover",
  "composerFocus",
  "composerMuted",
  "cyan",
  "danger",
  "field",
  "fieldBorder",
  "pageBackground",
  "pageBackgroundAlt",
  "panel",
  "popover",
  "popoverBorder",
  "rose",
  "sidebar",
  "sidebarActive",
  "sidebarBorder",
  "sidebarHover",
  "sidebarWarm",
  "success",
  "surface",
  "surfaceRaised",
  "surfaceSoft",
  "terminalAccent",
  "terminalBorder",
  "terminalCommand",
  "terminalControl",
  "terminalControlHover",
  "terminalCursor",
  "terminalError",
  "terminalMuted",
  "terminalOutput",
  "terminalPanel",
  "terminalRail",
  "terminalSelection",
  "terminalText",
  "terminalToolbar",
  "textDim",
  "textMuted",
  "violet",
  "warning",
] as const satisfies readonly (keyof AppThemeComponentColors)[];

export function getResolvedAppearanceTheme(mode: AppearanceMode, prefersLight: boolean): ResolvedAppearanceTheme {
  return mode === "system" ? (prefersLight ? "light" : "dark") : mode;
}

export function normalizeAppAppearanceSettings(value: unknown): AppAppearanceSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<AppAppearanceSettings>) : {};

  return {
    codeFontSize: normalizeNumberRange(storedSettings.codeFontSize, DEFAULT_APP_APPEARANCE_SETTINGS.codeFontSize, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE),
    dark: normalizeAppThemeSettings(storedSettings.dark, DEFAULT_APP_APPEARANCE_SETTINGS.dark, "dark"),
    light: normalizeAppThemeSettings(storedSettings.light, DEFAULT_APP_APPEARANCE_SETTINGS.light, "light"),
    reduceMotion: normalizeMotionPreference(storedSettings.reduceMotion),
    uiFontSize: normalizeNumberRange(storedSettings.uiFontSize, DEFAULT_APP_APPEARANCE_SETTINGS.uiFontSize, MIN_UI_FONT_SIZE, MAX_UI_FONT_SIZE),
    usePointerCursor: typeof storedSettings.usePointerCursor === "boolean" ? storedSettings.usePointerCursor : DEFAULT_APP_APPEARANCE_SETTINGS.usePointerCursor,
  };
}

export function normalizeAppThemeSettings(value: unknown, fallback: AppThemeSettings, themeName: ResolvedAppearanceTheme = "dark"): AppThemeSettings {
  const storedTheme = typeof value === "object" && value ? (value as Partial<AppThemeSettings>) : {};
  const normalizedBase: AppThemeBaseSettings = {
    accent: normalizeHexColor(storedTheme.accent, fallback.accent),
    background: normalizeHexColor(storedTheme.background, fallback.background),
    codeFont: normalizeFontStack(storedTheme.codeFont, fallback.codeFont),
    contrast: normalizeNumberRange(storedTheme.contrast, fallback.contrast, 0, 100),
    foreground: normalizeHexColor(storedTheme.foreground, fallback.foreground),
    translucentSidebar: typeof storedTheme.translucentSidebar === "boolean" ? storedTheme.translucentSidebar : fallback.translucentSidebar,
    uiFont: normalizeFontStack(storedTheme.uiFont, fallback.uiFont),
    visualEffect: normalizeVisualEffect(storedTheme.visualEffect, fallback.visualEffect),
  };
  const defaultComponentColors = createDefaultComponentColors(themeName, normalizedBase);
  const componentFallback =
    typeof storedTheme.componentColors === "object" && storedTheme.componentColors
      ? fallback.componentColors ?? defaultComponentColors
      : defaultComponentColors;

  return {
    ...normalizedBase,
    componentColors: normalizeComponentColors(storedTheme.componentColors, componentFallback),
  };
}

export function applyAppAppearanceToDocument(mode: AppearanceMode, settings: AppAppearanceSettings, root: HTMLElement = document.documentElement) {
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  const resolvedTheme = getResolvedAppearanceTheme(mode, prefersLight);
  const normalizedSettings = normalizeAppAppearanceSettings(settings);
  const variables = createAppearanceCssVariables(resolvedTheme, normalizedSettings);

  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = mode;
  root.dataset.pointerCursors = normalizedSettings.usePointerCursor ? "true" : "false";
  root.dataset.reduceMotion = normalizedSettings.reduceMotion;
  root.dataset.themeEffect = normalizedSettings[resolvedTheme].visualEffect;
  root.style.colorScheme = resolvedTheme;
  root.style.color = normalizedSettings[resolvedTheme].foreground;
  root.style.background = normalizedSettings[resolvedTheme].background;

  for (const property of APPEARANCE_CUSTOM_PROPERTIES) {
    root.style.removeProperty(property);
  }

  for (const [property, value] of Object.entries(variables)) {
    root.style.setProperty(property, value);
  }
}

export function pickReadableHexTextColor(backgroundHex: string, preferredHex: string, fallbackHex: string) {
  const background = parseHexColor(backgroundHex);
  const preferred = parseHexColor(preferredHex);
  const fallback = parseHexColor(fallbackHex);

  return colorContrast(background, preferred) >= colorContrast(background, fallback) ? normalizeHexColor(preferredHex, preferredHex) : normalizeHexColor(fallbackHex, fallbackHex);
}

export function createAppearanceCssVariables(themeName: ResolvedAppearanceTheme, settings: AppAppearanceSettings): Record<string, string> {
  const theme = settings[themeName];
  const background = parseHexColor(theme.background);
  const foreground = parseHexColor(theme.foreground);
  const accent = parseHexColor(theme.accent);
  const contrast = theme.contrast / 100;
  const lightTheme = themeName === "light";
  const surface = mix(background, foreground, lightTheme ? 0.006 + contrast * 0.02 : 0.045 + contrast * 0.075);
  const surfacePanel = mix(background, foreground, lightTheme ? 0.014 + contrast * 0.035 : 0.06 + contrast * 0.09);
  const surfaceRaised = mix(background, foreground, lightTheme ? 0.035 + contrast * 0.06 : 0.08 + contrast * 0.105);
  const surfaceSoft = mix(background, foreground, lightTheme ? 0.07 + contrast * 0.09 : 0.13 + contrast * 0.13);
  const line = mix(background, foreground, lightTheme ? 0.13 + contrast * 0.16 : 0.15 + contrast * 0.16);
  const lineSoft = mix(background, foreground, lightTheme ? 0.08 + contrast * 0.12 : 0.1 + contrast * 0.12);
  const textMuted = mix(foreground, background, lightTheme ? 0.36 : 0.28);
  const textDim = mix(foreground, background, lightTheme ? 0.52 : 0.45);
  const fieldBg = mix(background, foreground, lightTheme ? 0.008 + contrast * 0.025 : 0.055 + contrast * 0.075);
  const fieldBorder = mix(background, foreground, lightTheme ? 0.18 + contrast * 0.18 : 0.2 + contrast * 0.18);
  const sidebar = mix(background, foreground, lightTheme ? 0.02 + contrast * 0.03 : 0.065 + contrast * 0.08);
  const sidebarWarm = mix(sidebar, accent, lightTheme ? 0.035 : 0.06);
  const sidebarBorder = mix(background, foreground, lightTheme ? 0.16 + contrast * 0.13 : 0.22 + contrast * 0.16);
  const popover = lightTheme ? mix(background, foreground, 0.004) : surfaceRaised;
  const composer = lightTheme ? mix(background, foreground, 0.006 + contrast * 0.018) : surfaceRaised;
  const accent2 = mix(accent, lightTheme ? parseHexColor("#009E95") : parseHexColor("#77E6DA"), 0.48);
  const accent3 = mix(accent, lightTheme ? parseHexColor("#A17216") : parseHexColor("#F2C65D"), 0.58);
  const violet = mix(accent, lightTheme ? parseHexColor("#6E52E5") : parseHexColor("#B7A9FF"), 0.52);
  const rose = mix(accent, lightTheme ? parseHexColor("#C85C7D") : parseHexColor("#FF9AAC"), 0.58);
  const green = lightTheme ? parseHexColor("#1D845D") : parseHexColor("#83D6A5");
  const danger = lightTheme ? parseHexColor("#C9352B") : parseHexColor("#FF8B82");
  const sidebarGradient = theme.translucentSidebar
    ? `linear-gradient(180deg, ${toRgba(sidebar, lightTheme ? 0.84 : 0.9)} 0%, ${toRgba(sidebarWarm, lightTheme ? 0.88 : 0.92)} 100%)`
    : `linear-gradient(180deg, ${toHex(sidebar)} 0%, ${toHex(sidebar)} 100%)`;
  const pageGradient = `linear-gradient(180deg, ${toHex(background)} 0%, ${toHex(mix(background, foreground, lightTheme ? 0.018 + contrast * 0.035 : 0.035 + contrast * 0.055))} 100%)`;
  const panelGradient = `linear-gradient(180deg, ${toHex(surfacePanel)} 0%, ${toHex(mix(surfacePanel, accent, lightTheme ? 0.025 : 0.04))} 100%)`;
  const fieldGradient = `linear-gradient(180deg, ${toHex(fieldBg)} 0%, ${toHex(mix(fieldBg, foreground, lightTheme ? 0.015 : 0.035))} 100%)`;
  const shadowColor = lightTheme ? parseHexColor("#243448") : parseHexColor("#000000");

  const baseVariables = {
    "--accent": "var(--blue)",
    "--accent-2": "var(--cyan)",
    "--accent-3": "var(--gold)",
    "--app-bg": theme.background,
    "--appearance-background": theme.background,
    "--appearance-foreground": theme.foreground,
    "--blue": theme.accent,
    "--blue-soft": toRgba(accent, lightTheme ? 0.13 : 0.17),
    "--border": toHex(line),
    "--chat-page-bg": theme.background,
    "--chat-page-bg-2": toHex(mix(background, foreground, lightTheme ? 0.015 + contrast * 0.035 : 0.03 + contrast * 0.06)),
    "--chat-page-glow": toRgba(accent, lightTheme ? 0.08 : 0.1),
    "--chrome": theme.background,
    "--chrome-border": toHex(sidebarBorder),
    "--chrome-text": theme.foreground,
    "--code-font-size": `${settings.codeFontSize}px`,
    "--composer-bg": toHex(composer),
    "--composer-bg-2": toHex(mix(composer, foreground, lightTheme ? 0.025 : 0.04)),
    "--composer-border": toHex(fieldBorder),
    "--composer-control-bg": toRgba(foreground, lightTheme ? 0.055 + contrast * 0.035 : 0.06 + contrast * 0.05),
    "--composer-control-hover": toRgba(foreground, lightTheme ? 0.085 + contrast * 0.05 : 0.095 + contrast * 0.055),
    "--composer-focus-border": toHex(mix(accent, foreground, lightTheme ? 0.34 : 0.28)),
    "--composer-muted": toHex(textMuted),
    "--cyan": toHex(accent2),
    "--cyan-soft": toRgba(accent2, lightTheme ? 0.11 : 0.14),
    "--danger": toHex(danger),
    "--field-bg": toHex(fieldBg),
    "--field-border": toHex(fieldBorder),
    "--field-gradient": fieldGradient,
    "--focus-ring": `0 0 0 3px ${toRgba(accent, lightTheme ? 0.22 : 0.28)}`,
    "--font-display": theme.uiFont,
    "--font-mono": theme.codeFont,
    "--font-ui": theme.uiFont,
    "--gold": toHex(accent3),
    "--green": toHex(green),
    "--hover": toRgba(foreground, lightTheme ? 0.045 + contrast * 0.05 : 0.055 + contrast * 0.055),
    "--hover-strong": toRgba(foreground, lightTheme ? 0.08 + contrast * 0.07 : 0.095 + contrast * 0.07),
    "--line": toHex(line),
    "--line-soft": toHex(lineSoft),
    "--modal-scrim": lightTheme ? "rgba(31, 42, 57, 0.46)" : "rgba(18, 20, 24, 0.64)",
    "--page-gradient": pageGradient,
    "--page-gradient-soft": pageGradient,
    "--panel-gradient": panelGradient,
    "--popover-bg": toHex(popover),
    "--popover-border": toRgba(foreground, lightTheme ? 0.12 : 0.15),
    "--red": toHex(danger),
    "--rose": toHex(rose),
    "--rose-soft": toRgba(rose, lightTheme ? 0.1 : 0.12),
    "--shadow-lg": `0 24px 58px ${toRgba(shadowColor, lightTheme ? 0.16 : 0.28)}`,
    "--shadow-popover": `0 24px 52px ${toRgba(shadowColor, lightTheme ? 0.18 : 0.34)}`,
    "--shadow-subtle": `0 12px 30px ${toRgba(shadowColor, lightTheme ? 0.11 : 0.16)}`,
    "--sidebar": toHex(sidebar),
    "--sidebar-border": toHex(sidebarBorder),
    "--sidebar-gradient": sidebarGradient,
    "--sidebar-warm": toHex(sidebarWarm),
    "--surface": toHex(surface),
    "--surface-panel": toHex(surfacePanel),
    "--surface-raised": toHex(surfaceRaised),
    "--surface-soft": toHex(surfaceSoft),
    "--text": theme.foreground,
    "--text-dim": toHex(textDim),
    "--text-muted": toHex(textMuted),
    "--ui-font-size": `${settings.uiFontSize}px`,
    "--violet": toHex(violet),
    "--violet-soft": toRgba(violet, lightTheme ? 0.1 : 0.13),
    "--workspace-bg": theme.background,
  };

  return {
    ...baseVariables,
    ...createComponentCssVariables(themeName, theme),
    ...createThemeEffectCssVariables(themeName, theme),
  };
}

function createDefaultComponentColors(themeName: ResolvedAppearanceTheme, theme: AppThemeBaseSettings): AppThemeComponentColors {
  const background = parseHexColor(theme.background);
  const foreground = parseHexColor(theme.foreground);
  const accent = parseHexColor(theme.accent);
  const contrast = theme.contrast / 100;
  const lightTheme = themeName === "light";
  const surface = mix(background, foreground, lightTheme ? 0.006 + contrast * 0.02 : 0.045 + contrast * 0.075);
  const panel = mix(background, foreground, lightTheme ? 0.014 + contrast * 0.035 : 0.06 + contrast * 0.09);
  const surfaceRaised = mix(background, foreground, lightTheme ? 0.035 + contrast * 0.06 : 0.08 + contrast * 0.105);
  const surfaceSoft = mix(background, foreground, lightTheme ? 0.07 + contrast * 0.09 : 0.13 + contrast * 0.13);
  const border = mix(background, foreground, lightTheme ? 0.13 + contrast * 0.16 : 0.15 + contrast * 0.16);
  const borderSoft = mix(background, foreground, lightTheme ? 0.08 + contrast * 0.12 : 0.1 + contrast * 0.12);
  const textMuted = mix(foreground, background, lightTheme ? 0.36 : 0.28);
  const textDim = mix(foreground, background, lightTheme ? 0.52 : 0.45);
  const field = mix(background, foreground, lightTheme ? 0.008 + contrast * 0.025 : 0.055 + contrast * 0.075);
  const fieldBorder = mix(background, foreground, lightTheme ? 0.18 + contrast * 0.18 : 0.2 + contrast * 0.18);
  const sidebar = mix(background, foreground, lightTheme ? 0.02 + contrast * 0.03 : 0.065 + contrast * 0.08);
  const sidebarWarm = mix(sidebar, accent, lightTheme ? 0.035 : 0.06);
  const sidebarBorder = mix(background, foreground, lightTheme ? 0.16 + contrast * 0.13 : 0.22 + contrast * 0.16);
  const pageBackgroundAlt = mix(background, foreground, lightTheme ? 0.015 + contrast * 0.035 : 0.03 + contrast * 0.06);
  const composer = lightTheme ? mix(background, foreground, 0.006 + contrast * 0.018) : surfaceRaised;
  const accent2 = mix(accent, lightTheme ? parseHexColor("#009E95") : parseHexColor("#77E6DA"), 0.48);
  const warning = mix(accent, lightTheme ? parseHexColor("#A17216") : parseHexColor("#F2C65D"), 0.58);
  const violet = mix(accent, lightTheme ? parseHexColor("#6E52E5") : parseHexColor("#B7A9FF"), 0.52);
  const rose = mix(accent, lightTheme ? parseHexColor("#C85C7D") : parseHexColor("#FF9AAC"), 0.58);
  const terminalPanel = lightTheme ? mix(panel, background, 0.2) : mix(panel, background, 0.18);
  const terminalRail = lightTheme ? mix(sidebar, background, 0.16) : mix(sidebar, background, 0.12);
  const terminalToolbar = lightTheme ? mix(surfaceRaised, background, 0.08) : mix(surfaceRaised, background, 0.1);
  const terminalControl = lightTheme ? mix(field, background, 0.08) : mix(field, foreground, 0.03);
  const terminalOutput = lightTheme ? mix(field, parseHexColor("#FFFFFF"), 0.22) : mix(field, parseHexColor("#000000"), 0.22);
  const terminalText = mix(foreground, background, lightTheme ? 0.08 : 0.07);
  const terminalSelection = lightTheme ? mix(accent, parseHexColor("#FFFFFF"), 0.72) : mix(accent, background, 0.58);
  const terminalCursor = mix(accent, foreground, lightTheme ? 0.2 : 0.36);
  const appsPanel = mix(panel, accent, lightTheme ? 0.012 : 0.022);
  const appsPanelRaised = mix(surfaceRaised, accent, lightTheme ? 0.018 : 0.035);
  const appsControl = mix(field, accent, lightTheme ? 0.02 : 0.03);
  const appsControlHover = mix(surfaceRaised, accent, lightTheme ? 0.08 : 0.12);
  const appsAccentSoft = mix(panel, accent, lightTheme ? 0.08 : 0.13);
  const appsPrimaryText = getReadableTextColor(accent, lightTheme ? foreground : background, lightTheme ? background : foreground);

  return {
    appBackground: theme.background,
    appsAccent: theme.accent,
    appsAccentSoft: toHex(appsAccentSoft),
    appsBackground: theme.background,
    appsBackgroundGlow: toHex(warning),
    appsBorder: toHex(border),
    appsControl: toHex(appsControl),
    appsControlHover: toHex(appsControlHover),
    appsDanger: lightTheme ? "#C9352B" : "#FF8B82",
    appsInstalled: toHex(violet),
    appsPanel: toHex(appsPanel),
    appsPanelRaised: toHex(appsPanelRaised),
    appsPrimaryText,
    appsSuccess: lightTheme ? "#1D845D" : "#83D6A5",
    appsWarning: toHex(warning),
    border: toHex(border),
    borderSoft: toHex(borderSoft),
    chrome: theme.background,
    chromeBorder: toHex(sidebarBorder),
    composer: toHex(composer),
    composerAlt: toHex(mix(composer, foreground, lightTheme ? 0.025 : 0.04)),
    composerBorder: toHex(fieldBorder),
    composerControl: toHex(mix(composer, foreground, lightTheme ? 0.055 + contrast * 0.035 : 0.06 + contrast * 0.05)),
    composerControlHover: toHex(mix(composer, foreground, lightTheme ? 0.085 + contrast * 0.05 : 0.095 + contrast * 0.055)),
    composerFocus: toHex(mix(accent, foreground, lightTheme ? 0.34 : 0.28)),
    composerMuted: toHex(textMuted),
    cyan: toHex(accent2),
    danger: lightTheme ? "#C9352B" : "#FF8B82",
    field: toHex(field),
    fieldBorder: toHex(fieldBorder),
    pageBackground: theme.background,
    pageBackgroundAlt: toHex(pageBackgroundAlt),
    panel: toHex(panel),
    popover: lightTheme ? toHex(mix(background, foreground, 0.004)) : toHex(surfaceRaised),
    popoverBorder: toHex(mix(background, foreground, lightTheme ? 0.14 : 0.24)),
    rose: toHex(rose),
    sidebar: toHex(sidebar),
    sidebarActive: toHex(mix(sidebar, foreground, lightTheme ? 0.08 + contrast * 0.07 : 0.095 + contrast * 0.07)),
    sidebarBorder: toHex(sidebarBorder),
    sidebarHover: toHex(mix(sidebar, foreground, lightTheme ? 0.045 + contrast * 0.05 : 0.055 + contrast * 0.055)),
    sidebarWarm: toHex(sidebarWarm),
    success: lightTheme ? "#1D845D" : "#83D6A5",
    surface: toHex(surface),
    surfaceRaised: toHex(surfaceRaised),
    surfaceSoft: toHex(surfaceSoft),
    terminalAccent: theme.accent,
    terminalBorder: toHex(border),
    terminalCommand: toHex(accent2),
    terminalControl: toHex(terminalControl),
    terminalControlHover: toHex(mix(terminalControl, accent, lightTheme ? 0.08 : 0.12)),
    terminalCursor: toHex(terminalCursor),
    terminalError: lightTheme ? "#C9352B" : "#FF8B82",
    terminalMuted: toHex(textDim),
    terminalOutput: toHex(terminalOutput),
    terminalPanel: toHex(terminalPanel),
    terminalRail: toHex(terminalRail),
    terminalSelection: toHex(terminalSelection),
    terminalText: toHex(terminalText),
    terminalToolbar: toHex(terminalToolbar),
    textDim: toHex(textDim),
    textMuted: toHex(textMuted),
    violet: toHex(violet),
    warning: toHex(warning),
  };
}

function createComponentCssVariables(themeName: ResolvedAppearanceTheme, theme: AppThemeSettings): Record<string, string> {
  const colors = theme.componentColors;
  const lightTheme = themeName === "light";
  const accent = parseHexColor(theme.accent);
  const foreground = parseHexColor(theme.foreground);
  const sidebar = parseHexColor(colors.sidebar);
  const sidebarWarm = parseHexColor(colors.sidebarWarm);
  const panel = parseHexColor(colors.panel);
  const surfaceRaised = parseHexColor(colors.surfaceRaised);
  const field = parseHexColor(colors.field);
  const cyan = parseHexColor(colors.cyan);
  const violet = parseHexColor(colors.violet);
  const rose = parseHexColor(colors.rose);
  const shadowColor = lightTheme ? parseHexColor("#243448") : parseHexColor("#000000");
  const sidebarGradient = theme.translucentSidebar
    ? `linear-gradient(180deg, ${toRgba(sidebar, lightTheme ? 0.84 : 0.9)} 0%, ${toRgba(sidebarWarm, lightTheme ? 0.88 : 0.92)} 100%)`
    : `linear-gradient(180deg, ${colors.sidebar} 0%, ${colors.sidebar} 100%)`;
  const pageGradient = `linear-gradient(180deg, ${colors.pageBackground} 0%, ${colors.pageBackgroundAlt} 100%)`;

  return {
    "--app-bg": colors.appBackground,
    "--apps-accent": colors.appsAccent,
    "--apps-accent-soft": colors.appsAccentSoft,
    "--apps-bg": colors.appsBackground,
    "--apps-bg-glow": colors.appsBackgroundGlow,
    "--apps-border": colors.appsBorder,
    "--apps-control-bg": colors.appsControl,
    "--apps-control-hover": colors.appsControlHover,
    "--apps-danger": colors.appsDanger,
    "--apps-installed": colors.appsInstalled,
    "--apps-panel": colors.appsPanel,
    "--apps-panel-raised": colors.appsPanelRaised,
    "--apps-primary-text": colors.appsPrimaryText,
    "--apps-success": colors.appsSuccess,
    "--apps-warning": colors.appsWarning,
    "--appearance-background": theme.background,
    "--appearance-foreground": theme.foreground,
    "--blue": theme.accent,
    "--blue-soft": toRgba(accent, lightTheme ? 0.13 : 0.17),
    "--border": colors.border,
    "--browser-preview-accent": theme.accent,
    "--browser-preview-address-bg": colors.field,
    "--browser-preview-button-hover": colors.sidebarHover,
    "--browser-preview-content-bg": colors.pageBackground,
    "--browser-preview-invalid": colors.danger,
    "--browser-preview-line": colors.borderSoft,
    "--browser-preview-line-focus": colors.composerFocus,
    "--browser-preview-line-strong": colors.border,
    "--browser-preview-muted": colors.textMuted,
    "--browser-preview-strong-text": theme.foreground,
    "--browser-preview-subtle": colors.textDim,
    "--browser-preview-surface-soft": colors.surfaceSoft,
    "--browser-preview-surface-softer": colors.surface,
    "--browser-preview-tab-bg": colors.surfaceRaised,
    "--browser-preview-tabbar-bg": colors.panel,
    "--browser-preview-text": colors.textMuted,
    "--browser-preview-toolbar-bg": colors.surface,
    "--browser-preview-window-bg": colors.panel,
    "--chat-page-bg": colors.pageBackground,
    "--chat-page-bg-2": colors.pageBackgroundAlt,
    "--chat-page-glow": toRgba(accent, lightTheme ? 0.08 : 0.1),
    "--chrome": colors.chrome,
    "--chrome-border": colors.chromeBorder,
    "--chrome-text": theme.foreground,
    "--composer-bg": colors.composer,
    "--composer-bg-2": colors.composerAlt,
    "--composer-border": colors.composerBorder,
    "--composer-control-bg": colors.composerControl,
    "--composer-control-hover": colors.composerControlHover,
    "--composer-focus-border": colors.composerFocus,
    "--composer-muted": colors.composerMuted,
    "--cyan": colors.cyan,
    "--cyan-soft": toRgba(cyan, lightTheme ? 0.11 : 0.14),
    "--danger": colors.danger,
    "--field-bg": colors.field,
    "--field-border": colors.fieldBorder,
    "--field-gradient": `linear-gradient(180deg, ${colors.field} 0%, ${toHex(mix(field, foreground, lightTheme ? 0.015 : 0.035))} 100%)`,
    "--gold": colors.warning,
    "--green": colors.success,
    "--hover": colors.sidebarHover,
    "--hover-strong": colors.sidebarActive,
    "--line": colors.border,
    "--line-soft": colors.borderSoft,
    "--muted": colors.textMuted,
    "--page-gradient": pageGradient,
    "--page-gradient-soft": pageGradient,
    "--panel-gradient": `linear-gradient(180deg, ${colors.panel} 0%, ${toHex(mix(panel, accent, lightTheme ? 0.025 : 0.04))} 100%)`,
    "--popover-bg": colors.popover,
    "--popover-border": colors.popoverBorder,
    "--red": colors.danger,
    "--rose": colors.rose,
    "--rose-soft": toRgba(rose, lightTheme ? 0.1 : 0.12),
    "--shadow-lg": `0 24px 58px ${toRgba(shadowColor, lightTheme ? 0.16 : 0.28)}`,
    "--shadow-popover": `0 24px 52px ${toRgba(shadowColor, lightTheme ? 0.18 : 0.34)}`,
    "--shadow-subtle": `0 12px 30px ${toRgba(shadowColor, lightTheme ? 0.11 : 0.16)}`,
    "--sidebar": colors.sidebar,
    "--sidebar-border": colors.sidebarBorder,
    "--sidebar-gradient": sidebarGradient,
    "--sidebar-warm": colors.sidebarWarm,
    "--surface": colors.surface,
    "--surface-2": colors.surfaceRaised,
    "--surface-panel": colors.panel,
    "--surface-raised": colors.surfaceRaised,
    "--surface-soft": colors.surfaceSoft,
    "--surface-strong": toHex(mix(surfaceRaised, foreground, lightTheme ? 0.02 : 0.045)),
    "--terminal-accent": colors.terminalAccent,
    "--terminal-border": colors.terminalBorder,
    "--terminal-command": colors.terminalCommand,
    "--terminal-control-bg": colors.terminalControl,
    "--terminal-control-hover": colors.terminalControlHover,
    "--terminal-cursor": colors.terminalCursor,
    "--terminal-cursor-accent": colors.terminalOutput,
    "--terminal-error": colors.terminalError,
    "--terminal-muted": colors.terminalMuted,
    "--terminal-output-bg": colors.terminalOutput,
    "--terminal-panel-bg": colors.terminalPanel,
    "--terminal-rail-bg": colors.terminalRail,
    "--terminal-scrollbar-thumb": toRgba(parseHexColor(colors.terminalText), lightTheme ? 0.24 : 0.3),
    "--terminal-selection-bg": colors.terminalSelection,
    "--terminal-selection-fg": lightTheme ? colors.terminalText : theme.foreground,
    "--terminal-success": colors.success,
    "--terminal-text": colors.terminalText,
    "--terminal-toolbar-bg": colors.terminalToolbar,
    "--terminal-warning": colors.warning,
    "--text": theme.foreground,
    "--text-dim": colors.textDim,
    "--text-muted": colors.textMuted,
    "--violet": colors.violet,
    "--violet-soft": toRgba(violet, lightTheme ? 0.1 : 0.13),
    "--workspace-bg": colors.appBackground,
  };
}

function createThemeEffectCssVariables(themeName: ResolvedAppearanceTheme, theme: AppThemeSettings): Record<string, string> {
  const lightTheme = themeName === "light";
  const effect = normalizeVisualEffect(theme.visualEffect, "none");
  const accent = parseHexColor(theme.accent);
  const cyan = parseHexColor(theme.componentColors.cyan);
  const rose = parseHexColor(theme.componentColors.rose);
  const warning = parseHexColor(theme.componentColors.warning);
  const baseOpacity = effect === "none" ? 0 : lightTheme ? 0.12 : 0.17;
  const effectOpacity =
    effect === "confetti" || effect === "prism"
      ? baseOpacity + (lightTheme ? 0.04 : 0.03)
      : effect === "scanlines" || effect === "matrix" || effect === "circuit"
        ? baseOpacity - (lightTheme ? 0.02 : 0.035)
        : baseOpacity;

  return {
    "--theme-effect-blend": lightTheme ? "multiply" : "screen",
    "--theme-effect-color": toRgba(accent, lightTheme ? 0.22 : 0.35),
    "--theme-effect-color-2": toRgba(cyan, lightTheme ? 0.18 : 0.3),
    "--theme-effect-color-3": toRgba(effect === "embers" || effect === "dawn" ? warning : rose, lightTheme ? 0.16 : 0.28),
    "--theme-effect-opacity": effectOpacity.toFixed(3),
    "--theme-effect-speed": getThemeEffectSpeed(effect),
  };
}

function normalizeComponentColors(value: unknown, fallback: AppThemeComponentColors): AppThemeComponentColors {
  const storedColors = typeof value === "object" && value ? (value as Partial<AppThemeComponentColors>) : {};

  return COMPONENT_COLOR_KEYS.reduce((normalizedColors, colorKey) => {
    normalizedColors[colorKey] = normalizeHexColor(storedColors[colorKey], fallback[colorKey]);
    return normalizedColors;
  }, {} as AppThemeComponentColors);
}

function normalizeMotionPreference(value: unknown): AppearanceMotionPreference {
  return value === "on" || value === "off" || value === "system" ? value : DEFAULT_APP_APPEARANCE_SETTINGS.reduceMotion;
}

function normalizeVisualEffect(value: unknown, fallback: AppThemeVisualEffect): AppThemeVisualEffect {
  switch (value) {
    case "aurora":
    case "circuit":
    case "confetti":
    case "constellation":
    case "dawn":
    case "embers":
    case "matrix":
    case "neon":
    case "ocean":
    case "prism":
    case "scanlines":
    case "spotlight":
    case "none":
      return value;
    default:
      return fallback;
  }
}

function getThemeEffectSpeed(effect: AppThemeVisualEffect) {
  switch (effect) {
    case "confetti":
      return "18s";
    case "matrix":
    case "scanlines":
      return "14s";
    case "neon":
    case "prism":
      return "16s";
    case "spotlight":
      return "20s";
    case "circuit":
    case "constellation":
      return "24s";
    case "dawn":
    case "ocean":
      return "28s";
    case "embers":
      return "32s";
    case "aurora":
      return "26s";
    default:
      return "24s";
  }
}

function normalizeNumberRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(parsed), min), max);
}

function normalizeHexColor(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  const shortMatch = trimmed.match(/^#?([0-9a-fA-F]{3})$/);

  if (shortMatch) {
    return `#${shortMatch[1].split("").map((part) => part + part).join("").toUpperCase()}`;
  }

  const longMatch = trimmed.match(/^#?([0-9a-fA-F]{6})$/);

  if (longMatch) {
    return `#${longMatch[1].toUpperCase()}`;
  }

  return fallback;
}

function normalizeFontStack(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/[{}\r\n<>;]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 240) : fallback;
}

function parseHexColor(value: string): RgbColor {
  const normalized = normalizeHexColor(value, "#000000").slice(1);

  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function getReadableTextColor(background: RgbColor, darkText: RgbColor, lightText: RgbColor) {
  return toHex(relativeLuminance(background) > 0.48 ? darkText : lightText);
}

function colorContrast(left: RgbColor, right: RgbColor) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor) {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

function mix(left: RgbColor, right: RgbColor, amount: number): RgbColor {
  const ratio = Math.min(Math.max(amount, 0), 1);

  return {
    b: Math.round(left.b + (right.b - left.b) * ratio),
    g: Math.round(left.g + (right.g - left.g) * ratio),
    r: Math.round(left.r + (right.r - left.r) * ratio),
  };
}

function toHex(color: RgbColor) {
  return `#${toHexPart(color.r)}${toHexPart(color.g)}${toHexPart(color.b)}`;
}

function toHexPart(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255).toString(16).padStart(2, "0").toUpperCase();
}

function toRgba(color: RgbColor, alpha: number) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.min(Math.max(alpha, 0), 1).toFixed(3)})`;
}
