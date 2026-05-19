import {
  MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_EMBEDDING_MODEL,
  type DurableMemoryVector,
} from "./types";

export function createMemoryEmbedding(text: string): DurableMemoryVector {
  const values = new Array<number>(MEMORY_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenizeForMemory(text);

  for (const token of tokens) {
    pushToken(values, token, 1);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    pushToken(values, `${tokens[index]}_${tokens[index + 1]}`, 0.35);
  }

  normalizeVector(values);

  return {
    dimensions: MEMORY_EMBEDDING_DIMENSIONS,
    model: MEMORY_EMBEDDING_MODEL,
    values,
  };
}

export function scoreMemoryVectors(left: DurableMemoryVector | undefined, right: DurableMemoryVector | undefined) {
  if (!left || !right || left.dimensions !== right.dimensions || left.values.length !== right.values.length) {
    return 0;
  }

  let score = 0;

  for (let index = 0; index < left.values.length; index += 1) {
    score += left.values[index]! * right.values[index]!;
  }

  return score;
}

export function createMemoryContentHash(value: string) {
  return stableHash(value);
}

export function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function tokenizeForMemory(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./\\:-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 1800);
}

function pushToken(values: number[], token: string, weight: number) {
  const hash = hashNumber(token);
  const index = hash % values.length;
  const sign = hash & 1 ? 1 : -1;
  values[index] += sign * weight;
}

function normalizeVector(values: number[]) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));

  if (!magnitude) {
    return;
  }

  for (let index = 0; index < values.length; index += 1) {
    values[index] = Number((values[index]! / magnitude).toFixed(6));
  }
}

function hashNumber(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
