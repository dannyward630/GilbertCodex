/**
 * Extracts inline `<think>` / `<thinking>` / `<thought>` / `<reasoning>` /
 * `<analysis>` / `<scratchpad>` tags
 * from a model's textual output, splitting it into a public `content` portion
 * and a hidden portion that must not be rendered as chat text.
 *
 * Designed to be safe under streaming: while the model is mid-tag (e.g. it has
 * emitted `<` or `<thi` but not yet `<think>`), the tail prefix is buffered
 * via `pendingPrefix` so the partial tag never leaks into visible content.
 *
 * Both the provider-streaming code path (modelProviderClient.ts) and the
 * defensive render-time path (ChatThread.tsx) share this module so they can't
 * drift out of sync.
 */

export const INLINE_THINKING_TAG_NAMES = ["think", "thinking", "thought", "reasoning", "analysis", "scratchpad"] as const;

const TAG_GROUP = INLINE_THINKING_TAG_NAMES.join("|");

const INLINE_THINKING_BLOCK_PATTERN = new RegExp(`<(${TAG_GROUP})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
const INLINE_THINKING_OPEN_PATTERN = new RegExp(`<(${TAG_GROUP})\\b[^>]*>`, "i");
const INLINE_THINKING_CLOSE_PATTERN = new RegExp(`<\\/(${TAG_GROUP})>`, "gi");

/**
 * Pre-built lookup of every prefix that could be the start of an inline
 * thinking tag (including the leading `<`). Used to detect a streaming
 * mid-tag tail like `<thi` or `<reasonin`.
 */
const TAG_NAME_PREFIXES = (() => {
  const prefixes = new Set<string>();
  for (const tag of INLINE_THINKING_TAG_NAMES) {
    for (let length = 1; length <= tag.length; length += 1) {
      prefixes.add(tag.slice(0, length).toLowerCase());
    }
  }
  return prefixes;
})();

export interface InlineThinkingExtraction {
  /** Visible portion safe to display in the public response area. */
  content: string;
  /** Hidden portion for provider/runtime safety checks only. Do not render. */
  reasoning: string;
  /**
   * Tail bytes that *might* be the beginning of an inline thinking tag.
   * The streaming caller should hold this back from the displayed content
   * and prepend it to the raw buffer on the next flush.
   *
   * When `final=true`, this is always an empty string because we release
   * any unresolved prefix into the visible content (better to show a stray
   * `<` than to silently drop characters).
   */
  pendingPrefix: string;
}

export interface ExtractInlineThinkingOptions {
  /**
   * When true, treat this as the final flush — any unresolved tail prefix is
   * released back into visible content. Defaults to false (streaming mode).
   */
  final?: boolean;
}

/**
 * Splits `raw` into a visible `content` portion and a hidden `reasoning`
 * portion, handling closed blocks, unclosed open tags, and (under streaming)
 * mid-tag tail prefixes.
 */
export function extractInlineThinking(
  raw: string,
  options: ExtractInlineThinkingOptions = {},
): InlineThinkingExtraction {
  if (!raw) {
    return { content: "", reasoning: "", pendingPrefix: "" };
  }

  const reasoningParts: string[] = [];
  let visibleContent = raw.replace(INLINE_THINKING_BLOCK_PATTERN, (_match, _tag: string, thinking: string) => {
    reasoningParts.push(thinking);
    return "";
  });

  const openThinkingMatch = INLINE_THINKING_OPEN_PATTERN.exec(visibleContent);

  if (openThinkingMatch && typeof openThinkingMatch.index === "number") {
    const openThinkingIndex = openThinkingMatch.index;
    const beforeThinking = visibleContent.slice(0, openThinkingIndex);
    const afterThinking = visibleContent.slice(openThinkingIndex + openThinkingMatch[0].length);

    reasoningParts.push(afterThinking.replace(INLINE_THINKING_CLOSE_PATTERN, ""));
    visibleContent = beforeThinking;
  }

  // Strip any stray closing tags that survived (no matching open).
  visibleContent = visibleContent.replace(INLINE_THINKING_CLOSE_PATTERN, "");

  // Tail-prefix guard. If the visible content ends with what could be the
  // start of a thinking tag (`<`, `<t`, `<thi`, etc.), buffer that tail so it
  // never flashes into the public area while waiting for the next chunk.
  let pendingPrefix = "";

  if (!options.final) {
    const tailMatch = /<([A-Za-z]*)$/.exec(visibleContent);
    if (tailMatch) {
      const partial = tailMatch[1].toLowerCase();
      if (partial.length === 0 || TAG_NAME_PREFIXES.has(partial)) {
        pendingPrefix = visibleContent.slice(tailMatch.index);
        visibleContent = visibleContent.slice(0, tailMatch.index);
      }
    }
  }

  return {
    content: visibleContent,
    reasoning: reasoningParts.join("").trim(),
    pendingPrefix,
  };
}
