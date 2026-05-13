/**
 * Minimal MCP HTTP client over Streamable HTTP transport.
 *
 * Implements the subset of https://modelcontextprotocol.io needed for the
 * in-app agent to discover and call tools on remote MCP servers:
 *  - `initialize` + `notifications/initialized` handshake
 *  - `tools/list`
 *  - `tools/call`
 *
 * Single shared session is cached per server URL. Servers that respond with
 * SSE (`text/event-stream`) are handled by extracting the first `message`
 * event payload — sufficient for synchronous request/response semantics.
 */
import type { McpServerConfig } from "../types/mcp";

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "Gilbert Codex", version: "0.2.x" };
const DEFAULT_TIMEOUT_MS = 60_000;

interface JsonRpcSuccess<T = unknown> {
  id: number | string;
  jsonrpc: "2.0";
  result: T;
}

interface JsonRpcFailure {
  error: { code: number; data?: unknown; message: string };
  id: number | string;
  jsonrpc: "2.0";
}

type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcFailure;

export interface McpToolDescriptor {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  title?: string;
}

export interface McpToolListResult {
  nextCursor?: string;
  tools: McpToolDescriptor[];
}

export interface McpContentBlock {
  data?: string;
  mimeType?: string;
  text?: string;
  type: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

interface SessionState {
  initialized: boolean;
  inflight?: Promise<void>;
  sessionId?: string;
  toolsCache?: { fetchedAt: number; tools: McpToolDescriptor[] };
}

const sessions = new Map<string, SessionState>();

function sessionKey(server: McpServerConfig): string {
  return `${server.serverUrl.trim()}|${server.authorization.trim()}`;
}

function ensureSession(server: McpServerConfig): SessionState {
  const key = sessionKey(server);
  let state = sessions.get(key);
  if (!state) {
    state = { initialized: false };
    sessions.set(key, state);
  }
  return state;
}

let requestCounter = 0;
function nextRequestId(): number {
  requestCounter += 1;
  return requestCounter;
}

function buildHeaders(server: McpServerConfig, sessionId?: string): Headers {
  const headers = new Headers({
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  });
  if (server.authorization.trim()) {
    const token = server.authorization.trim();
    headers.set("Authorization", token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`);
  }
  if (sessionId) {
    headers.set("Mcp-Session-Id", sessionId);
  }
  return headers;
}

async function readFirstSseMessage(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("MCP server returned no SSE body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      dataLines = [];
      for (const rawLine of event.split(/\r?\n/)) {
        if (rawLine.startsWith("data:")) {
          dataLines.push(rawLine.slice(5).trimStart());
        }
      }
      if (dataLines.length > 0) {
        reader.cancel().catch(() => undefined);
        return dataLines.join("\n");
      }
    }
  }
  if (dataLines.length > 0) {
    return dataLines.join("\n");
  }
  throw new Error("MCP server SSE stream ended without a data event");
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const data = await readFirstSseMessage(response);
    return JSON.parse(data);
  }
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  return JSON.parse(text);
}

async function postJsonRpc<T = unknown>(
  server: McpServerConfig,
  payload: Record<string, unknown>,
  options: { signal?: AbortSignal; expectResponse?: boolean } = {},
): Promise<JsonRpcResponse<T> | null> {
  const state = ensureSession(server);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("MCP request timed out")), DEFAULT_TIMEOUT_MS);
  const composite = composeAbortSignals(controller.signal, options.signal);
  try {
    const response = await fetch(server.serverUrl.trim(), {
      body: JSON.stringify(payload),
      headers: buildHeaders(server, state.sessionId),
      method: "POST",
      signal: composite,
    });
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      state.sessionId = newSessionId;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`MCP HTTP ${response.status}: ${body || response.statusText}`);
    }
    if (response.status === 202 || options.expectResponse === false) {
      // Notifications + acks have no JSON-RPC response.
      return null;
    }
    const body = (await readResponseBody(response)) as JsonRpcResponse<T> | null;
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function composeAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary) return primary;
  const controller = new AbortController();
  const link = (signal: AbortSignal) => {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
  };
  link(primary);
  link(secondary);
  return controller.signal;
}

function unwrapResult<T>(response: JsonRpcResponse<T> | null, label: string): T {
  if (!response) {
    throw new Error(`${label}: empty MCP response`);
  }
  if ("error" in response) {
    throw new Error(`${label}: ${response.error.message}${response.error.code ? ` (code ${response.error.code})` : ""}`);
  }
  return response.result;
}

async function ensureInitialized(server: McpServerConfig, signal?: AbortSignal): Promise<void> {
  const state = ensureSession(server);
  if (state.initialized) return;
  if (state.inflight) {
    await state.inflight;
    return;
  }
  state.inflight = (async () => {
    const initResponse = await postJsonRpc(
      server,
      {
        id: nextRequestId(),
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: CLIENT_INFO,
          protocolVersion: PROTOCOL_VERSION,
        },
      },
      { signal },
    );
    unwrapResult(initResponse, "MCP initialize");
    await postJsonRpc(
      server,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { signal, expectResponse: false },
    );
    state.initialized = true;
  })();
  try {
    await state.inflight;
  } finally {
    state.inflight = undefined;
  }
}

export async function mcpListTools(server: McpServerConfig, options: { force?: boolean; signal?: AbortSignal } = {}): Promise<McpToolDescriptor[]> {
  if (server.transport !== "remote") {
    throw new Error("mcpListTools only supports remote transport");
  }
  const state = ensureSession(server);
  const fresh = state.toolsCache && Date.now() - state.toolsCache.fetchedAt < 60_000;
  if (fresh && !options.force) {
    return state.toolsCache!.tools;
  }
  await ensureInitialized(server, options.signal);
  const tools: McpToolDescriptor[] = [];
  let cursor: string | undefined;
  do {
    const response = await postJsonRpc<McpToolListResult>(
      server,
      {
        id: nextRequestId(),
        jsonrpc: "2.0",
        method: "tools/list",
        params: cursor ? { cursor } : {},
      },
      { signal: options.signal },
    );
    const result = unwrapResult(response, "MCP tools/list");
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  state.toolsCache = { fetchedAt: Date.now(), tools };
  return tools;
}

export async function mcpCallTool(
  server: McpServerConfig,
  name: string,
  args: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<McpToolCallResult> {
  if (server.transport !== "remote") {
    throw new Error("mcpCallTool only supports remote transport");
  }
  await ensureInitialized(server, options.signal);
  const response = await postJsonRpc<McpToolCallResult>(
    server,
    {
      id: nextRequestId(),
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    },
    { signal: options.signal },
  );
  const result = unwrapResult(response, `MCP tools/call ${name}`);
  return {
    content: Array.isArray(result.content) ? result.content : [],
    isError: Boolean(result.isError),
    structuredContent: result.structuredContent,
  };
}

export function flattenMcpContent(blocks: McpContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      if ((block.type === "image" || block.type === "audio") && typeof block.mimeType === "string") {
        return `[${block.type}: ${block.mimeType} ${block.data ? `(${block.data.length} bytes base64)` : ""}]`;
      }
      if (block.type === "resource_link" || block.type === "resource") {
        return `[resource: ${JSON.stringify(block)}]`;
      }
      try {
        return JSON.stringify(block);
      } catch {
        return String(block);
      }
    })
    .filter((piece) => piece.length > 0)
    .join("\n\n");
}

export function clearMcpSession(server: McpServerConfig): void {
  sessions.delete(sessionKey(server));
}

export function clearAllMcpSessions(): void {
  sessions.clear();
}
