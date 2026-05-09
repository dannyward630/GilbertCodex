const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export function splitThinkingContent(content?: string) {
  const normalizedContent = content?.trim();

  if (!normalizedContent) {
    return [];
  }

  const paragraphSegments = normalizedContent
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (paragraphSegments.length > 1) {
    return paragraphSegments;
  }

  return normalizedContent
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function formatThinkingDuration(startedAt?: string, completedAt?: string, now = Date.now()) {
  const startedMs = Date.parse(startedAt ?? "");
  const completedMs = completedAt ? Date.parse(completedAt) : now;

  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs) || completedMs < startedMs) {
    return "a couple of seconds";
  }

  const elapsedMs = Math.max(SECOND_MS, completedMs - startedMs);

  if (elapsedMs < 3 * SECOND_MS) {
    return "a couple of seconds";
  }

  if (elapsedMs < MINUTE_MS) {
    return `${Math.round(elapsedMs / SECOND_MS)} seconds`;
  }

  const minutes = Math.floor(elapsedMs / MINUTE_MS);
  const seconds = Math.round((elapsedMs % MINUTE_MS) / SECOND_MS);

  if (seconds === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} seconds`;
}
