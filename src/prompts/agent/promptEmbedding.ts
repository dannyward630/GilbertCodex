const PROMPT_EMBEDDING_DIMS = 192;
const MAX_INDEX_TERMS = 1800;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "before",
  "being",
  "but",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "into",
  "its",
  "just",
  "more",
  "not",
  "only",
  "our",
  "out",
  "over",
  "should",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "use",
  "uses",
  "using",
  "was",
  "when",
  "with",
  "would",
  "you",
  "your",
]);

export interface PromptEmbedding {
  dimensions: number;
  terms: string[];
  vector: number[];
}

export function createPromptEmbedding(text: string): PromptEmbedding {
  const vector = Array.from({ length: PROMPT_EMBEDDING_DIMS }, () => 0);
  const terms = createEmbeddingTerms(text).slice(0, MAX_INDEX_TERMS);

  for (const term of terms) {
    const weight = term.includes(":") || term.includes("-") || term.includes("_") ? 1.2 : Math.min(1.5, 0.85 + term.length / 14);
    vector[hashTerm(term) % PROMPT_EMBEDDING_DIMS] += weight;
  }

  normalizeVector(vector);

  return {
    dimensions: PROMPT_EMBEDDING_DIMS,
    terms,
    vector,
  };
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude <= Number.EPSILON || rightMagnitude <= Number.EPSILON) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function createPromptTermSet(text: string) {
  return new Set(createEmbeddingTerms(text).filter((term) => !term.includes(" ")));
}

function createEmbeddingTerms(text: string) {
  const tokens = tokenize(text);
  const terms: string[] = [];

  for (const token of tokens) {
    terms.push(token);
    const stem = stemToken(token);

    if (stem !== token) {
      terms.push(stem);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    terms.push(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return terms;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9_:-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function stemToken(token: string) {
  if (token.length > 6 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 5 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

function hashTerm(term: string) {
  let hash = 2166136261;

  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude <= Number.EPSILON) {
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= magnitude;
  }
}
