const CSS_LIKE_EXTENSIONS = new Set([
  "css",
  "less",
  "sass",
  "scss",
  "tsx",
  "jsx",
  "html",
]);

const COMMON_SOURCE_TYPO_PATTERNS = [
  {
    pattern: /\bfont-smothing\b/i,
    warning: "Possible CSS typo: `font-smothing` should usually be `font-smoothing`.",
  },
  {
    pattern: /\b-webkit-font-smothing\b/i,
    warning: "Possible CSS typo: `-webkit-font-smothing` should usually be `-webkit-font-smoothing`.",
  },
  {
    pattern: /\b-moz-osx-font-smothing\b/i,
    warning: "Possible CSS typo: `-moz-osx-font-smothing` should usually be `-moz-osx-font-smoothing`.",
  },
];

const TAILWIND_COLOR_NAMES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
].join("|");
const TAILWIND_COLOR_SHADE_VALUES = new Set(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"]);
const TAILWIND_DURATION_VALUES = new Set(["75", "100", "150", "200", "300", "500", "700", "1000"]);

export function collectTextQualityWarnings(path: string, content: string) {
  const warnings: string[] = [];

  for (const { pattern, warning } of COMMON_SOURCE_TYPO_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(warning);
    }
  }

  if (isCssLikePath(path)) {
    const shortHexWarnings = collectSuspiciousFourDigitHexWarnings(content);
    warnings.push(...shortHexWarnings);
    warnings.push(...collectSuspiciousTailwindTokenWarnings(content));
  }

  return dedupeWarnings(warnings);
}

function collectSuspiciousTailwindTokenWarnings(content: string) {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const colorTokenPattern = new RegExp(
    `(?:^|[\\s"'\\\`])((?:(?:dark|hover|focus|active|disabled|visited|checked|group-hover|peer-checked|sm|md|lg|xl|2xl):)*(?:bg|text|border|from|to|via|placeholder|ring|outline|decoration|accent|caret|fill|stroke)-(${TAILWIND_COLOR_NAMES})-(\\d{2,3}))(?![\\w-])`,
    "gi",
  );
  const durationTokenPattern = /(?:^|[\s"'`])((?:(?:hover|focus|active|motion-safe|motion-reduce|sm|md|lg|xl|2xl):)*duration-(\d{2,4}))(?![\w-])/gi;
  let colorMatch: RegExpExecArray | null;

  while ((colorMatch = colorTokenPattern.exec(content))) {
    const token = colorMatch[1];
    const color = colorMatch[2];
    const shade = colorMatch[3];

    if (!TAILWIND_COLOR_SHADE_VALUES.has(shade) && !seen.has(token)) {
      seen.add(token);
      warnings.push(`Suspicious Tailwind color class \`${token}\`: \`${color}-${shade}\` is not a default Tailwind shade. Did you mean a shade like ${color}-50, ${color}-100, ${color}-200, ${color}-400, or ${color}-500?`);
    }
  }

  let durationMatch: RegExpExecArray | null;

  while ((durationMatch = durationTokenPattern.exec(content))) {
    const token = durationMatch[1];
    const value = durationMatch[2];

    if (!TAILWIND_DURATION_VALUES.has(value) && !seen.has(token)) {
      seen.add(token);
      warnings.push(`Suspicious Tailwind duration class \`${token}\`: ${value} is not a default transition duration. Did you mean duration-75, duration-100, duration-150, duration-200, or duration-300?`);
    }
  }

  return warnings;
}

export function formatTextQualityWarnings(warnings: string[]) {
  if (warnings.length === 0) {
    return "";
  }

  return [
    "Quality warnings:",
    ...warnings.map((warning) => `- ${warning}`),
    "Inspect the edited file and fix these before giving a final answer if they affect the user's request.",
  ].join("\n");
}

function collectSuspiciousFourDigitHexWarnings(content: string) {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const shortHexPattern = /(^|[^a-zA-Z0-9_-])#([0-9a-fA-F]{4})(?![0-9a-fA-F])/g;
  let match: RegExpExecArray | null;

  while ((match = shortHexPattern.exec(content))) {
    const rawHex = `#${match[2]}`;
    const normalizedHex = rawHex.toLowerCase();

    if (seen.has(normalizedHex)) {
      continue;
    }

    seen.add(normalizedHex);
    warnings.push(
      `Suspicious CSS 4-digit hex ${rawHex}: CSS reads #RGBA as alpha shorthand, expanding to ${expandFourDigitHex(rawHex)}. Use a 6-digit #RRGGBB value when an opaque color was intended.`,
    );
  }

  return warnings;
}

function expandFourDigitHex(hex: string) {
  const digits = hex.replace(/^#/, "").toLowerCase().split("");
  return `#${digits.map((digit) => `${digit}${digit}`).join("")}`;
}

function isCssLikePath(path: string) {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return CSS_LIKE_EXTENSIONS.has(extension);
}

function dedupeWarnings(warnings: string[]) {
  return Array.from(new Set(warnings));
}
