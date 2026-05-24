const PRIVATE_THINKING_LABEL_PATTERN =
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:analysis|reasoning|thinking|thought|scratchpad|internal(?:\s+monologue)?|private\s+notes?)(?:\*\*)?\s*[:.-]/i;

const PRIVATE_THINKING_TAG_PATTERN = /<\s*(?:analysis|reasoning|thinking|thought|scratchpad)\b/i;
const PRIVATE_THINKING_BLOCK_PATTERN = /<\s*(analysis|reasoning|thinking|thought|scratchpad)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const PRIVATE_THINKING_TAG_STRIP_PATTERN = /<\/?(?:analysis|reasoning|thinking|thought|scratchpad)\b[^>]*>/gi;

const SAFE_VISIBLE_WORK_PATTERNS = [
  /^(?:Applying|Applied|Reading|Read|Searching|Searched|Running|Ran|Checking|Checked|Using|Used|Waiting|Preparing|Getting|Synthesizing|Recovering|Retrying|Working through concrete actions)\b/i,
  /^(?:This action needs review|Action canceled|Needs review|Review needed|Tool approval|Browser preview|Search activity)\b/i,
  /^(?:Gmail|Calendar) (?:account checked|draft prepared|action finished)\b/i,
  /^`[^`]+` (?:returned runtime output|finished with exit code \d+)\./i,
  /^[A-Z][\w .:/`-]{2,120} (?:finished|completed|needs attention|returned runtime output|finished with exit code \d+)(?:: [^.]+)?\./,
];

const PRIVATE_NARRATION_PATTERNS = [
  /\bchain[-\s]?of[-\s]?thought\b/i,
  /\bprivate (?:reasoning|scratchpad|notes?)\b/i,
  /^\s*(?:let me|let's|i(?:'ll| will| need to| should| can| have to| am going to)|we(?:'ll| will| need to| should| can| have to))\b/i,
  /\b(?:first|next|then|now)\s+i(?:'ll| will| need to| should| can)\b/i,
  /\b(?:inspect|read|search|check|edit|patch|run|open|trace|verify)\b[\s\S]{0,180}\b(?:before|then|next|so I can)\b/i,
];

const TOOL_PROTOCOL_PATTERN =
  /<<<\s*(?:END_)?TOOL_CALL\s*>>>|<\s*\/?\s*tool_call\b|<\s*\|\s*DSML\s*\||"tool_calls"\s*:\s*\[/i;

export function cleanVisibleWorkTraceContent(content: string | undefined) {
  const raw = (content ?? "").replace(/\r\n/g, "\n").trim();

  if (!raw || PRIVATE_THINKING_LABEL_PATTERN.test(raw) || PRIVATE_THINKING_TAG_PATTERN.test(raw)) {
    return "";
  }

  const cleaned = raw
    .replace(PRIVATE_THINKING_BLOCK_PATTERN, "")
    .replace(PRIVATE_THINKING_TAG_STRIP_PATTERN, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  const plain = cleaned
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain || plain.length > 360 || TOOL_PROTOCOL_PATTERN.test(plain)) {
    return "";
  }

  if (isTerminalSessionDiagnosticText(plain)) {
    return "";
  }

  if (PRIVATE_NARRATION_PATTERNS.some((pattern) => pattern.test(plain))) {
    return "";
  }

  return SAFE_VISIBLE_WORK_PATTERNS.some((pattern) => pattern.test(plain)) ? cleaned : "";
}

function isTerminalSessionDiagnosticText(value: string) {
  return (
    /\b(?:list|read) terminal sessions?\b/i.test(value) ||
    /\bterminal dev server status\b/i.test(value) ||
    /\bcould not read that terminal session\b/i.test(value) ||
    /\bterminal session needs attention\b/i.test(value)
  );
}
