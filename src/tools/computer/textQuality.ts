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
  }

  return dedupeWarnings(warnings);
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
