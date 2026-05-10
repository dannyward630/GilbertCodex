const CHARS_PER_TOKEN = 4;

export function estimatePromptTokens(text: string) {
  const trimmed = text.trim();

  return trimmed ? Math.ceil(trimmed.length / CHARS_PER_TOKEN) : 0;
}

export function clampPromptText(text: string, tokenBudget: number) {
  const normalizedBudget = Math.max(Math.floor(tokenBudget), 0);

  if (estimatePromptTokens(text) <= normalizedBudget) {
    return text.trim();
  }

  const characterBudget = Math.max(normalizedBudget * CHARS_PER_TOKEN, 0);
  const clipped = text.trim().slice(0, characterBudget).replace(/\s+\S*$/, "").trim();

  return clipped ? `${clipped}\n[Prompt chunk trimmed to fit the instruction budget.]` : "";
}
