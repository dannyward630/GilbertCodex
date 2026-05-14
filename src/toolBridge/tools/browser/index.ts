import { getBackgroundTerminalSessions } from "../../../lib/terminalSessions";
import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";

export interface BrowserPreviewBackend {
  getBackgroundPreviewUrls: () => string[];
  getCurrentAppUrl: () => string | undefined;
}

export const defaultBrowserPreviewBackend: BrowserPreviewBackend = {
  getBackgroundPreviewUrls: () =>
    getBackgroundTerminalSessions()
      .map((session) => session.browserPreviewUrl)
      .filter((url): url is string => Boolean(url)),
  getCurrentAppUrl: () => (typeof window === "undefined" ? undefined : window.location.href),
};

export function createBrowserPreviewTool(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition {
  return {
    description:
      "Open the in-app browser preview to a local app URL or public HTTPS page. " +
      "Use this after starting a dev server or when the user asks to preview a site. " +
      "If url is omitted, the tool uses the most recent background terminal session that reported a localhost preview URL.",
    execute: (args) => {
      const requestedUrl = stringArg(args.url);
      const candidateUrl = requestedUrl ?? backend.getBackgroundPreviewUrls()[0];

      if (!candidateUrl) {
        return createErrorResult("No browser preview URL was provided and no background terminal session has a preview URL yet.");
      }

      const normalizedUrl = normalizeBrowserPreviewUrl(candidateUrl, backend.getCurrentAppUrl());
      if (!normalizedUrl.ok) {
        return createErrorResult(normalizedUrl.error);
      }

      return {
        content: [
          "Browser preview opened.",
          `Browser preview URL: ${normalizedUrl.url}`,
        ].join("\n"),
        data: {
          browserPreviewUrl: normalizedUrl.url,
          url: normalizedUrl.url,
        } as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "browser", version: 1 },
    id: "browser_preview_open",
    inputSchema: {
      additionalProperties: false,
      properties: {
        url: {
          description: "Optional http(s) URL. Omit to reuse the latest localhost URL from a background terminal session.",
          minLength: 1,
          type: "string",
        },
      },
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Open browser preview",
  };
}

export function createBrowserTools(backend: BrowserPreviewBackend = defaultBrowserPreviewBackend): ToolDefinition[] {
  return [
    createBrowserPreviewTool(backend),
  ];
}

export const browserTools: ToolDefinition[] = createBrowserTools();

function normalizeBrowserPreviewUrl(rawUrl: string, currentAppUrl?: string): { ok: true; url: string } | { error: string; ok: false } {
  const candidate = createDirectUrlCandidate(rawUrl.trim());

  try {
    const url = new URL(candidate);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "Browser preview only accepts http(s) URLs.", ok: false };
    }

    if (url.username || url.password) {
      return { error: "Browser preview refuses URLs with embedded credentials.", ok: false };
    }

    if (isCurrentAppUrl(url, currentAppUrl)) {
      return { error: "Browser preview will not open Gilbert Codex's own app URL.", ok: false };
    }

    const host = url.hostname.toLowerCase();
    if (isLoopbackHost(host)) {
      url.hostname = "localhost";
      return { ok: true, url: url.href };
    }

    if (url.protocol !== "https:") {
      return { error: "Browser preview only allows plain HTTP for localhost/loopback URLs. Use HTTPS for public pages.", ok: false };
    }

    if (isBlockedPrivateHost(host)) {
      return { error: `Browser preview blocked a private or local network host: ${host}`, ok: false };
    }

    return { ok: true, url: url.href };
  } catch {
    return { error: "Browser preview needs a valid http(s) URL.", ok: false };
  }
}

function createDirectUrlCandidate(value: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  return isLocalHostInput(value) ? `http://${value}` : `https://${value}`;
}

function isLocalHostInput(value: string) {
  const input = value.toLowerCase();

  return (
    input === "localhost" ||
    input.startsWith("localhost:") ||
    input.startsWith("localhost/") ||
    input === "127.0.0.1" ||
    input.startsWith("127.0.0.1:") ||
    input.startsWith("127.0.0.1/") ||
    input === "0.0.0.0" ||
    input.startsWith("0.0.0.0:") ||
    input.startsWith("0.0.0.0/") ||
    input === "[::1]" ||
    input.startsWith("[::1]:") ||
    input.startsWith("[::1]/")
  );
}

function isLoopbackHost(host: string) {
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function isCurrentAppUrl(url: URL, currentAppUrl?: string) {
  if (!currentAppUrl) {
    return false;
  }

  try {
    const current = new URL(currentAppUrl);

    if (url.origin === current.origin) {
      return true;
    }

    return url.protocol === current.protocol && url.port === current.port && isLoopbackHost(url.hostname.toLowerCase()) && isLoopbackHost(current.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isBlockedPrivateHost(host: string) {
  if (
    host.includes("@") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host === "host.docker.internal" ||
    !host.includes(".")
  ) {
    return true;
  }

  return isPrivateIpv4(host) || isSpecialIpv6(host);
}

function isPrivateIpv4(host: string) {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a, b, c] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isSpecialIpv6(host: string) {
  const normalized = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();

  return (
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8")
  );
}

function stringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}
