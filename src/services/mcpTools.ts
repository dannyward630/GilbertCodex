import { normalizeMcpServerLabel, normalizeMcpSettings, parseMcpList } from "../types/mcp";
import { normalizeToolRegistrySettings } from "../types/tools";
import type { McpServerConfig } from "../types/mcp";
import type { ProviderSettings } from "../types/settings";
import { FORCE_XML_TOOL_PROTOCOL } from "./toolSchemaAdapters";

export interface OpenAIResponsesMcpTool {
  allowed_tools?: string[];
  authorization?: string;
  defer_loading?: boolean;
  require_approval: "always" | "never";
  server_description?: string;
  server_label: string;
  server_url: string;
  type: "mcp";
}

export function isOpenAiMcpPassthroughAvailable(settings: ProviderSettings) {
  if (FORCE_XML_TOOL_PROTOCOL) {
    return false;
  }

  const tools = normalizeToolRegistrySettings(settings.tools);
  const mcp = normalizeMcpSettings(settings.mcp);

  return settings.provider === "openai" && tools.mcpServers && mcp.enabled;
}

export function createOpenAIResponsesMcpTools(settings: ProviderSettings): OpenAIResponsesMcpTool[] {
  if (!isOpenAiMcpPassthroughAvailable(settings)) {
    return [];
  }

  const mcp = normalizeMcpSettings(settings.mcp);

  return mcp.servers
    .filter((server) => server.enabled && server.transport === "remote" && isHttpUrl(server.serverUrl))
    .map(createOpenAIResponsesMcpTool);
}

export function getEnabledMcpServers(settings: ProviderSettings) {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const mcp = normalizeMcpSettings(settings.mcp);

  if (!tools.mcpServers || !mcp.enabled) {
    return [];
  }

  return mcp.servers.filter((server) => server.enabled);
}

function createOpenAIResponsesMcpTool(server: McpServerConfig): OpenAIResponsesMcpTool {
  const allowedTools = parseMcpList(server.allowedTools);
  const tool: OpenAIResponsesMcpTool = {
    require_approval: server.requireApproval,
    server_label: normalizeMcpServerLabel(server.label),
    server_url: server.serverUrl.trim(),
    type: "mcp",
  };

  if (server.description.trim()) {
    tool.server_description = server.description.trim();
  }

  if (server.authorization.trim()) {
    tool.authorization = server.authorization.trim();
  }

  if (server.deferLoading) {
    tool.defer_loading = true;
  }

  if (allowedTools.length > 0) {
    tool.allowed_tools = allowedTools;
  }

  return tool;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
