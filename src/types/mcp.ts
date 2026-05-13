export type McpApprovalMode = "always" | "never";
export type McpServerTransport = "remote" | "stdio";

export interface McpServerConfig {
  allowedTools: string;
  args: string;
  authorization: string;
  command: string;
  createdAt: string;
  deferLoading: boolean;
  description: string;
  enabled: boolean;
  env: string;
  id: string;
  label: string;
  requireApproval: McpApprovalMode;
  serverUrl: string;
  transport: McpServerTransport;
  updatedAt: string;
}

export interface McpSettings {
  enabled: boolean;
  servers: McpServerConfig[];
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
};

export function createDefaultMcpServer(transport: McpServerTransport = "remote"): McpServerConfig {
  const now = new Date().toISOString();

  return {
    allowedTools: "",
    args: transport === "stdio" ? "-y @modelcontextprotocol/server-filesystem ." : "",
    authorization: "",
    command: transport === "stdio" ? "npx" : "",
    createdAt: now,
    deferLoading: true,
    description: transport === "remote" ? "Remote MCP server available to Gilbert Codex." : "Local stdio MCP server profile.",
    enabled: true,
    env: "",
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: transport === "remote" ? "new_mcp_server" : "local_filesystem",
    requireApproval: "always",
    serverUrl: transport === "remote" ? "https://example.com/mcp" : "",
    transport,
    updatedAt: now,
  };
}

export function normalizeMcpSettings(value: unknown): McpSettings {
  const stored = isRecord(value) ? value : {};
  const rawServers = Array.isArray(stored.servers) ? stored.servers : [];

  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_MCP_SETTINGS.enabled,
    servers: rawServers.map(normalizeMcpServer).filter((server): server is McpServerConfig => Boolean(server)),
  };
}

export function normalizeMcpServerLabel(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

  return normalized || "mcp_server";
}

export function parseMcpList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMcpServer(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const transport = value.transport === "stdio" ? "stdio" : "remote";
  const now = new Date().toISOString();

  return {
    allowedTools: readString(value.allowedTools),
    args: readString(value.args),
    authorization: readString(value.authorization),
    command: readString(value.command),
    createdAt: readString(value.createdAt) || now,
    deferLoading: typeof value.deferLoading === "boolean" ? value.deferLoading : true,
    description: readString(value.description),
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    env: readString(value.env),
    id: readString(value.id) || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: normalizeMcpServerLabel(readString(value.label) || "mcp_server"),
    requireApproval: value.requireApproval === "never" ? "never" : "always",
    serverUrl: readString(value.serverUrl),
    transport,
    updatedAt: readString(value.updatedAt) || now,
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
