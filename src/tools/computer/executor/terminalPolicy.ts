const PACKAGE_SETUP_TERMINAL_TIMEOUT_MS = 300_000;
const FAST_TERMINAL_COMMAND_TIMEOUT_MS = 12_000;
const FAST_EVIDENCE_COMMAND_TIMEOUT_MS = 20_000;

export function isLikelyDevServerCommand(command: string) {
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?(?:dev|start|serve|preview)\b/.test(segment) ||
    /^(?:npx|npm\s+exec|pnpm\s+exec|yarn\s+exec|bunx)\s+(?:--yes\s+)?(?:vite(?!\s+(?:build|test|optimize|--version|-v)\b)|next\s+dev|astro\s+dev|webpack\s+serve|expo\s+start)\b/.test(segment) ||
    /^(?:vite(?!\s+(?:build|test|optimize|--version|-v)\b)|next\s+dev|astro\s+dev|webpack\s+serve|expo\s+start|tauri\s+dev|cargo\s+tauri\s+dev)\b/.test(segment),
  );
}

export function isLongRunningProcessCommand(command: string) {
  if (isLikelyDevServerCommand(command)) {
    return true;
  }

  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.cmd)?)\s+(?:run\s+)?(?:watch|hot)\b/.test(segment) ||
    /^(?:npx\s+)?(?:nodemon|webpack-dev-server)\b/.test(segment) ||
    /^(?:cargo\s+watch|cargo\s+leptos\s+watch|deno\s+task\s+dev|rails\s+(?:server|s)|flask\s+run|uvicorn|gunicorn|hugo\s+server|jekyll\s+serve|mkdocs\s+serve)\b/.test(segment) ||
    /^(?:tauri\s+dev|cargo\s+tauri\s+dev)\b/.test(segment),
  );
}

export function commandSegmentsForLongRunningDetection(command: string) {
  const normalized = unwrapWindowsShellWrapper(normalizeCommandForFastPath(command))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map(normalizeLongRunningCommandSegment)
    .filter(Boolean);
}

function normalizeLongRunningCommandSegment(segment: string) {
  return segment
    .replace(/^(?:&|call)\s+/i, "")
    .replace(/^(?:[a-z_][a-z0-9_]*=\S+\s+)+/i, "")
    .trim();
}

export function shouldUseBufferedTerminalCommand(command: string, timeoutMs: number) {
  const normalized = normalizeCommandForFastPath(command);
  const unwrapped = unwrapWindowsShellWrapper(normalized);

  if (!normalized || isLikelyDevServerCommand(unwrapped)) {
    return false;
  }

  if (looksLikePackageLifecycleCommand(unwrapped)) {
    return true;
  }

  if (/^git\s+(?:--no-pager\s+)?(?:init|status|diff|log|branch|show|rev-parse|remote|ls-files|describe|add|restore|reset|commit|push|pull|fetch|switch|checkout|merge|rebase|tag)\b/i.test(unwrapped)) {
    return true;
  }

  if (/^(?:pwd|whoami|hostname|git\s+--version|node\s+--version|npm(?:\.cmd)?\s+--version|pnpm(?:\.cmd)?\s+--version|yarn(?:\.cmd)?\s+--version|python\s+--version|py\s+--version|cargo\s+--version|rustc\s+--version)\b/i.test(unwrapped)) {
    return true;
  }

  if (/^(?:get-location|write-output|echo)\b/i.test(unwrapped)) {
    return true;
  }

  if (looksLikeProcessManagementCommand(unwrapped)) {
    return true;
  }

  if (looksLikeQuickEvidenceCommand(unwrapped)) {
    return true;
  }

  return timeoutMs <= FAST_TERMINAL_COMMAND_TIMEOUT_MS && !looksLikeStreamingCommand(unwrapped);
}

export function effectiveTerminalTimeoutMs(command: string, timeoutMs: number, hasExplicitTimeout = false) {
  const normalized = normalizeCommandForFastPath(command);
  const unwrapped = unwrapWindowsShellWrapper(normalized);

  if (looksLikeQuickEvidenceCommand(unwrapped)) {
    return Math.min(timeoutMs, FAST_EVIDENCE_COMMAND_TIMEOUT_MS);
  }

  if (!hasExplicitTimeout && looksLikePackageSetupCommand(unwrapped)) {
    return Math.max(timeoutMs, PACKAGE_SETUP_TERMINAL_TIMEOUT_MS);
  }

  return timeoutMs;
}

export function looksLikeQuickEvidenceCommand(command: string) {
  return (
    /^(?:curl(?:\.exe)?|wget(?:\.exe)?|iwr|invoke-webrequest|irm|invoke-restmethod|rg|grep|findstr|select-string|get-content|cat|type|head|tail|ls|dir|get-childitem|where(?:\.exe)?|which)\b/i.test(command) ||
    /\|\s*(?:head|tail|grep|select-string|findstr)\b/i.test(command)
  );
}

export function looksLikeProcessManagementCommand(command: string) {
  return (
    /^(?:get-process|get-nettcpconnection|stop-process|taskkill|netstat|lsof|kill|pkill)\b/i.test(command) ||
    /\|\s*(?:where-object|foreach-object|stop-process|kill|select-object)\b/i.test(command)
  );
}

export function normalizeCommandForFastPath(command: string) {
  return command
    .replace(/\s+(?:2>&\s*1|2>|>>|1?>)(?:\s*[^&|;]+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function unwrapWindowsShellWrapper(command: string) {
  return command
    .replace(/^cmd(?:\.exe)?\s+\/[dqsc]+\s+"?([\s\S]*?)"?$/i, "$1")
    .replace(/^powershell(?:\.exe)?\s+(?:-[a-z]+\s+)*"?([\s\S]*?)"?$/i, "$1")
    .trim();
}

function looksLikePackageLifecycleCommand(command: string) {
  return /^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|ci|add|update|rebuild|dedupe|run\s+(?:build|typecheck|check|lint|test|test:unit|format|format:check)|test)\b|cargo\s+(?:check|test|build)\b|\.?\\?gradlew(?:\.bat)?\s+(?:test|check|build|assemble\w*)\b)/i.test(command);
}

export function looksLikePackageSetupCommand(command: string) {
  return commandSegmentsForLongRunningDetection(command).some((segment) =>
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:install|ci|add|update|rebuild|dedupe)\b/i.test(segment) ||
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:create|init)\b/i.test(segment) ||
    /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+exec\b[\s\S]*\bcreate-[a-z0-9@/._-]+\b/i.test(segment) ||
    /^(?:npx|bunx)(?:\.cmd)?\b[\s\S]*\b(?:create-[a-z0-9@/._-]+|create-[a-z0-9@/._-]+@[\w.-]+)\b/i.test(segment) ||
    /^(?:yarn|pnpm)(?:\.cmd)?\s+dlx\b[\s\S]*\bcreate-[a-z0-9@/._-]+\b/i.test(segment)
  );
}

function looksLikeStreamingCommand(command: string) {
  return /\b(?:npm(?:\.cmd)?|npx(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun|bunx|cargo|gradle|gradlew|pytest|vitest|jest|playwright|tauri|vite|next|react-scripts)\b/i.test(command);
}
