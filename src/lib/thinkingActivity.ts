const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const MAX_ACTIVITY_THINKING_NOTES = 6;
const MAX_ACTIVITY_THINKING_NOTE_CHARS = 220;
const TRIMMED_ACTIVITY_REASONING_PREFIX = "Earlier thinking was summarized for Activity.";

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

export function createActivityReasoningSnapshot(reasoning: string, options: { trimmed?: boolean } = {}) {
  const notes = createActivityThinkingNotes(reasoning);

  if (notes.length === 0) {
    return options.trimmed ? TRIMMED_ACTIVITY_REASONING_PREFIX : "Thinking through the next step.";
  }

  return [
    options.trimmed ? TRIMMED_ACTIVITY_REASONING_PREFIX : "",
    ...notes,
  ].filter(Boolean).join("\n\n");
}

export function createActivityThinkingNotes(content?: string, options: { maxItems?: number } = {}) {
  const normalizedContent = normalizeThinkingForActivity(content);

  if (!normalizedContent) {
    return [];
  }

  const maxItems = Math.max(1, Math.floor(options.maxItems ?? MAX_ACTIVITY_THINKING_NOTES));
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const segment of splitThinkingContent(normalizedContent)) {
    const note = createActivityNoteFromSegment(segment);
    const key = note.toLowerCase();

    if (!note || seen.has(key)) {
      continue;
    }

    seen.add(key);
    notes.push(note);
  }

  return notes.slice(-maxItems);
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

function normalizeThinkingForActivity(content?: string) {
  return (content ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, " ")
    .replace(/<tool_call\b[\s\S]*$/gi, " ")
    .replace(/<\/?(?:think|thinking|thought|reasoning)\b[^>]*>/gi, " ")
    .replace(/\{[\s\S]{400,}\}/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createActivityNoteFromSegment(segment: string) {
  const cleaned = cleanActivitySegment(segment);

  if (!cleaned || shouldHideRawReasoningSegment(cleaned)) {
    return "";
  }

  const lower = cleaned.toLowerCase();
  const paths = extractLikelyPaths(cleaned);

  if (paths.length > 0) {
    const pathList = paths.slice(0, 2).map((path) => `\`${path}\``).join(", ");
    if (/\b(edit|update|change|write|create|delete|remove|move|rename|patch|fix)\b/.test(lower)) {
      return paths.length > 2 ? `Preparing file changes in ${pathList} and ${paths.length - 2} more.` : `Preparing file changes in ${pathList}.`;
    }

    if (/\b(read|inspect|check|search|look|trace|review|scan|open)\b/.test(lower)) {
      return paths.length > 2 ? `Inspecting ${pathList} and ${paths.length - 2} more.` : `Inspecting ${pathList}.`;
    }
  }

  if (/\b(found|noticed|identified|looks like|appears|issue|problem|bug|cause|error|fails?|blocked)\b/.test(lower)) {
    return `Found: ${shortenActivityNote(redactFirstPerson(cleaned))}`;
  }

  if (/\b(solution|fix|approach|plan|next step|needs? to|should|will|going to|ready to)\b/.test(lower)) {
    return `Next: ${shortenActivityNote(redactFirstPerson(cleaned))}`;
  }

  if (/\b(test|verify|build|typecheck|lint|run|terminal|command|diff|output|result)\b/.test(lower)) {
    return `Checking: ${shortenActivityNote(redactFirstPerson(cleaned))}`;
  }

  if (cleaned.length <= 160 && /[.!?]$/.test(cleaned)) {
    return shortenActivityNote(redactFirstPerson(cleaned));
  }

  return "";
}

function cleanActivitySegment(segment: string) {
  return segment
    .replace(/\s+/g, " ")
    .replace(/^[\s"'`*_>-]+|[\s"'`*_>-]+$/g, "")
    .trim();
}

function shouldHideRawReasoningSegment(segment: string) {
  const lower = segment.toLowerCase();

  return (
    segment.length < 12 ||
    segment.length > 900 ||
    /(?:role=|role:|system message|assistant message|developer message|conversation history|openai api|provider api|tool_call|arg_key|arg_value|xml-style|xml style|compact tool_call|hidden tool|message with role|system runs tools|append(?:s|ed)? the results|we can either produce|produce tool calls|the prompt says|this prompt|previous turn)/i.test(segment) ||
    /(?:^|\s)(?:const|let|var|function|class|interface|import|export)\s/.test(segment) ||
    /[{}<>][\s\S]*[{}<>]/.test(segment) && lower.length > 180
  );
}

function extractLikelyPaths(segment: string) {
  const matches = segment.match(/(?:[A-Za-z]:\\[^\s"'`]+|(?:src|app|lib|components|pages|styles|tools|services|types|docs|public|scripts|src-tauri)[\\/][^\s"'`,;:)]+|[\w.-]+\.(?:tsx?|jsx?|css|scss|json|md|rs|toml|html|mjs|cjs|py|kt|java))/g) ?? [];
  const cleaned = matches.map((match) => match.replace(/[.,;:!?]+$/g, "").replace(/\\/g, "/"));

  return Array.from(new Set(cleaned));
}

function redactFirstPerson(segment: string) {
  return segment
    .replace(/\b(?:I|we)\s+need\s+to\b/gi, "Need to")
    .replace(/\b(?:I|we)\s+should\b/gi, "Should")
    .replace(/\b(?:I|we)\s+(?:will|would|can|could)\b/gi, "Will")
    .replace(/\b(?:I'm|I am|we're|we are)\s+going\s+to\b/gi, "Going to")
    .replace(/\b(?:I'm|I am|we're|we are)\b/gi, "Working")
    .replace(/\b(?:I|we)\s+/gi, "");
}

function shortenActivityNote(note: string) {
  const cleaned = note.replace(/\s+/g, " ").trim();

  if (cleaned.length <= MAX_ACTIVITY_THINKING_NOTE_CHARS) {
    return cleaned;
  }

  return `${cleaned.slice(0, MAX_ACTIVITY_THINKING_NOTE_CHARS - 1).trimEnd()}...`;
}
