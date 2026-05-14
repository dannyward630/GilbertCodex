// Shared helpers used by every per-provider adapter to budget the number of
// characters of tool output that may be re-attached to the next request.
// Activity panels still keep the full output; this budget only constrains the
// model-visible portion to protect provider context limits.

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  if (remaining === null) {
    return null;
  }
  return Math.max(remaining - rawLength, 0);
}
