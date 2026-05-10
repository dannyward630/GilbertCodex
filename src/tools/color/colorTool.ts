import { CSS_COLOR_DATABASE_SOURCES, CSS_NAMED_COLORS, getAllNamedColors, getExtendedNamedColors } from "./colorDatabase";
import type { CssNamedColor } from "./colorDatabase";

export type ColorToolName = "lookup_color";

interface ParsedColorInput {
  alpha?: number;
  hex: string;
  rgb: readonly [number, number, number];
}

const SPECIAL_COLOR_KEYWORDS = [
  {
    name: "transparent",
    value: "rgb(0 0 0 / 0%)",
    note: "Fully transparent black; usable anywhere a CSS color is accepted.",
  },
  {
    name: "currentcolor",
    value: "currentColor",
    note: "Resolves from the element's computed color property.",
  },
];

export function describeColorTools() {
  return [
    "Color tools: lookup_color.",
    `lookup_color uses ${CSS_NAMED_COLORS.length} standardized CSS named colors plus the 30k+ MIT color-name-list dataset, returning HEX, RGB, HSL, aliases, special CSS keywords, and nearest named colors for arbitrary hex/rgb input.`,
    "Use lookup_color for stable CSS and broad human color names. Use web_search first for brand palettes, design-system tokens, product colors, or any color data that depends on a current external source.",
  ].join("\n");
}

export async function formatColorLookupResult(args: Record<string, string>) {
  const extendedColors = await getExtendedNamedColors();
  const allNamedColors = await getAllNamedColors();
  const colorsByName = createColorsByNameIndex(allNamedColors);
  const colorsByHex = createColorsByHexIndex(allNamedColors);
  const query = firstArg(args, ["color", "name", "query", "q", "hex", "value", "text"]) ?? "";
  const includeAll = booleanArg(args, ["all", "list_all", "list", "full"]) || isAllColorsQuery(query);
  const maxResults = Math.min(Math.max(numberArg(args, ["max_results", "maxResults", "limit"], includeAll ? 500 : 12), 1), allNamedColors.length);
  const lines = [
    "COLOR TOOL RESULTS - named color database",
    `Database: ${allNamedColors.length} named colors (${CSS_NAMED_COLORS.length} CSS standard, ${extendedColors.length} extended package entries) plus transparent/currentColor keywords.`,
    "Standard basis: CSS Color Module Level 4 named colors resolve to sRGB and are ASCII case-insensitive. Extended entries come from the MIT color-name-list package.",
    ...CSS_COLOR_DATABASE_SOURCES.map((source) => `Source: ${source}`),
  ];

  if (includeAll) {
    const listedColors = allNamedColors.slice(0, maxResults);

    return [
      ...lines,
      "",
      `Named colors listed: ${listedColors.length} of ${allNamedColors.length}. Pass a higher max_results to return more names, up to the full database count.`,
      ...listedColors.map(formatColorListLine),
      "",
      "Special CSS keywords:",
      ...SPECIAL_COLOR_KEYWORDS.map((keyword) => `- ${keyword.name}: ${keyword.value}. ${keyword.note}`),
    ].join("\n");
  }

  if (!query.trim()) {
    return [
      ...lines,
      "",
      "No color query was supplied.",
      "Use color/name/query/hex/value, or pass all=true to list the extended named-color database.",
    ].join("\n");
  }

  const normalizedName = normalizeColorName(query);
  const special = SPECIAL_COLOR_KEYWORDS.find((keyword) => keyword.name === normalizedName);

  if (special) {
    return [
      ...lines,
      "",
      `Special keyword: ${special.name}`,
      `Value: ${special.value}`,
      `Note: ${special.note}`,
    ].join("\n");
  }

  const exactNameMatches = colorsByName.get(normalizedName) ?? [];

  if (exactNameMatches.length > 0) {
    const visibleMatches = exactNameMatches.slice(0, maxResults);
    return [
      ...lines,
      "",
      `Exact named-color matches (${exactNameMatches.length}):`,
      ...visibleMatches.map(formatColorLine),
      exactNameMatches.length > visibleMatches.length ? `More exact matches available: ${exactNameMatches.length - visibleMatches.length}` : "",
      visibleMatches.length === 1 ? formatAliasLine(visibleMatches[0], colorsByHex) : "",
    ].join("\n");
  }

  const parsedColor = parseColorInput(query);

  if (parsedColor) {
    const sameHex = colorsByHex.get(parsedColor.hex) ?? [];
    const nearest = nearestNamedColors(allNamedColors, parsedColor.rgb, maxResults);
    const visibleSameHex = sameHex.slice(0, maxResults);

    return [
      ...lines,
      "",
      `Input color: ${parsedColor.hex} ${formatRgb(parsedColor.rgb)} ${formatHsl(parsedColor.rgb)}${parsedColor.alpha !== undefined ? ` alpha ${formatAlpha(parsedColor.alpha)}` : ""}`,
      sameHex.length > 0 ? "Exact named-color matches:" : "Exact named-color matches: none",
      ...visibleSameHex.map(formatColorLine),
      sameHex.length > visibleSameHex.length ? `More exact hex matches available: ${sameHex.length - visibleSameHex.length}` : "",
      sameHex.length > 0 ? "" : "",
      `Nearest named colors (${nearest.length}):`,
      ...nearest.map(({ color, distance }) => `${formatColorLine(color)} distance ${distance.toFixed(1)}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const fuzzyMatches = allNamedColors.filter((color) => {
    const colorName = normalizeColorName(color.name);
    return colorName.includes(normalizedName) || normalizedName.includes(colorName);
  }).slice(0, maxResults);

  return [
    ...lines,
    "",
    `Query: ${query}`,
    fuzzyMatches.length > 0 ? `Name matches (${fuzzyMatches.length}):` : "No named-color matches found.",
    ...fuzzyMatches.map(formatColorLine),
    fuzzyMatches.length === 0 ? "For brand, app, or design-system colors, run web_search against the official source instead of guessing." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isColorToolName(value: string): value is ColorToolName {
  return value === "lookup_color";
}

function formatColorLine(color: CssNamedColor) {
  return `- ${color.name}: ${color.hex}, ${formatRgb(color.rgb)}, ${formatHsl(color.rgb)} (${formatSource(color)})`;
}

function formatColorListLine(color: CssNamedColor) {
  return `- ${color.name}: ${color.hex} (${formatSource(color)})`;
}

function formatAliasLine(color: CssNamedColor, colorsByHex: Map<string, CssNamedColor[]>) {
  const aliases = colorsByHex.get(color.hex)?.map((item) => item.name).filter((name) => name !== color.name) ?? [];
  const visibleAliases = aliases.slice(0, 32);
  return aliases.length > 0
    ? `Aliases with the same sRGB value: ${visibleAliases.join(", ")}${aliases.length > visibleAliases.length ? `, and ${aliases.length - visibleAliases.length} more` : ""}`
    : "Aliases with the same sRGB value: none";
}

function formatSource(color: CssNamedColor) {
  return color.source === "css" ? "CSS standard" : "extended";
}

function nearestNamedColors(colors: readonly CssNamedColor[], rgb: readonly [number, number, number], limit: number) {
  return colors.map((color) => ({
    color,
    distance: colorDistance(rgb, color.rgb),
  }))
    .sort((left, right) => left.distance - right.distance || left.color.name.localeCompare(right.color.name))
    .slice(0, limit);
}

function colorDistance(left: readonly [number, number, number], right: readonly [number, number, number]) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function createColorsByNameIndex(colors: readonly CssNamedColor[]) {
  return colors.reduce((map, color) => {
    const key = normalizeColorName(color.name);
    const existing = map.get(key) ?? [];
    existing.push(color);
    map.set(key, existing);
    return map;
  }, new Map<string, CssNamedColor[]>());
}

function createColorsByHexIndex(colors: readonly CssNamedColor[]) {
  return colors.reduce((map, color) => {
    const existing = map.get(color.hex) ?? [];
    existing.push(color);
    map.set(color.hex, existing);
    return map;
  }, new Map<string, CssNamedColor[]>());
}

function parseColorInput(value: string): ParsedColorInput | null {
  const hex = parseHexColor(value);

  if (hex) {
    return hex;
  }

  return parseRgbColor(value);
}

function parseHexColor(value: string): ParsedColorInput | null {
  const compact = value.trim().toLowerCase();
  const match = compact.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);

  if (!match) {
    return null;
  }

  const raw = match[1];
  const expanded = raw.length === 3 || raw.length === 4
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  const rgbHex = expanded.slice(0, 6);
  const alphaHex = expanded.length === 8 ? expanded.slice(6, 8) : undefined;
  const rgb = hexToRgb(`#${rgbHex}`);

  return {
    alpha: alphaHex ? Number.parseInt(alphaHex, 16) / 255 : undefined,
    hex: `#${rgbHex}`,
    rgb,
  };
}

function parseRgbColor(value: string): ParsedColorInput | null {
  const match = value.trim().match(/^rgba?\((.*)\)$/i);

  if (!match) {
    return null;
  }

  const parts = match[1].split(/[,\s/]+/).map((part) => part.trim()).filter(Boolean);
  const rgb = parts.slice(0, 3).map(parseRgbComponent);

  if (rgb.length !== 3 || rgb.some((component) => component === null)) {
    return null;
  }

  const alpha = parts[3] ? parseAlpha(parts[3]) : undefined;
  const tuple = rgb as [number, number, number];

  return {
    alpha,
    hex: rgbToHex(tuple),
    rgb: tuple,
  };
}

function parseRgbComponent(value: string) {
  const isPercent = value.endsWith("%");
  const numeric = Number.parseFloat(isPercent ? value.slice(0, -1) : value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const component = isPercent ? Math.round((numeric / 100) * 255) : Math.round(numeric);

  if (component < 0 || component > 255) {
    return null;
  }

  return component;
}

function parseAlpha(value: string) {
  const isPercent = value.endsWith("%");
  const numeric = Number.parseFloat(isPercent ? value.slice(0, -1) : value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const alpha = isPercent ? numeric / 100 : numeric;
  return Math.min(Math.max(alpha, 0), 1);
}

function formatRgb(rgb: readonly [number, number, number]) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function formatHsl(rgb: readonly [number, number, number]) {
  const [red, green, blue] = rgb.map((component) => component / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return `hsl(0 0% ${Math.round(lightness * 100)}%)`;
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  const degrees = Math.round(hue * 60);
  const normalizedHue = degrees < 0 ? degrees + 360 : degrees;

  return `hsl(${normalizedHue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}

function formatAlpha(alpha: number) {
  return Number.isInteger(alpha) ? String(alpha) : alpha.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb: readonly [number, number, number]) {
  return `#${rgb.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
}

function isAllColorsQuery(value: string) {
  const normalized = value.trim().toLowerCase();
  return ["all", "colors", "all colors", "all color codes", "all css colors", "css colors", "named colors", "css named colors", "list colors", "thousands", "every color"].includes(normalized);
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalized = normalizeArgName(name);
    const value = args[normalized];

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const rawValue = firstArg(args, names);

  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanArg(args: Record<string, string>, names: string[]) {
  const value = firstArg(args, names)?.toLowerCase();
  return value === "true" || value === "yes" || value === "1";
}

function normalizeColorName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "");
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}
