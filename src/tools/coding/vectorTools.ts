const EMBEDDING_DIMS = 64;

export function createLocalTextEmbedding(text: string) {
  const vector = Array.from({ length: EMBEDDING_DIMS }, () => 0);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const index = hashToken(token) % EMBEDDING_DIMS;
    vector[index] += token.length > 18 ? 1.35 : 1;
  }

  normalize(vector);

  const topTokens = Array.from(new Set(tokens))
    .map((token) => ({
      token,
      count: tokens.filter((candidate) => candidate === token).length,
    }))
    .sort((left, right) => right.count - left.count || right.token.length - left.token.length)
    .slice(0, 24);

  return {
    dimensions: EMBEDDING_DIMS,
    topTokens,
    vector,
  };
}

export function formatEmbeddingReport(text: string) {
  const embedding = createLocalTextEmbedding(text);
  const nonZero = embedding.vector.filter((value) => Math.abs(value) > 0.0001).length;
  const preview = embedding.vector.map((value) => Number(value.toFixed(4))).join(", ");

  return [
    `Dimensions: ${embedding.dimensions}`,
    `Non-zero dimensions: ${nonZero}`,
    `Top tokens: ${embedding.topTokens.map((item) => `${item.token}(${item.count})`).join(", ") || "none"}`,
    `Vector: [${preview}]`,
  ].join("\n");
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function hashToken(token: string) {
  let hash = 2166136261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash);
}

function normalize(vector: number[]) {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (length <= Number.EPSILON) {
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= length;
  }
}
