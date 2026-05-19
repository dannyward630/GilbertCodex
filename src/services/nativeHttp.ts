export function normalizeNativeRequestMethod(method: string | undefined, bridgeLabel: string): "GET" | "POST" {
  const normalizedMethod = (method ?? "GET").trim().toUpperCase();

  if (normalizedMethod === "GET" || normalizedMethod === "POST") {
    return normalizedMethod;
  }

  throw new Error(`${bridgeLabel} does not support ${normalizedMethod || "unknown"} requests.`);
}

export function normalizeNativeRequestBody(body: BodyInit | null | undefined, bridgeLabel: string) {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  throw new Error(`${bridgeLabel} only supports text request bodies.`);
}

export function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }

  return { ...headers };
}
