import { flattenMcpContent, mcpCallTool, mcpListTools } from "../../../../services/mcpClient";
import type { McpServerConfig, McpServerTransport, McpSettings } from "../../../../types/mcp";
import { normalizeMcpServerLabel, normalizeMcpSettings } from "../../../../types/mcp";
import { booleanArg, firstArg } from "../argHelpers";
import type { LocalComputerToolCallResult, McpToolContext, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeMcpHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  switch (call.tool) {
    case "mcp_list_servers":
      return executeMcpListServersTool(context.mcpContext);
    case "mcp_list_tools":
      return executeMcpListToolsTool(call, context.mcpContext, context.signal);
    case "mcp_call_tool":
      return executeMcpCallTool(call, context.mcpContext, context.signal);
    case "mcp_set_server":
      return executeMcpSetServerTool(call, context.mcpContext);
    case "mcp_remove_server":
      return executeMcpRemoveServerTool(call, context.mcpContext);
    default:
      return {
        content: `Unknown MCP tool request was ignored: ${call.tool}`,
        executed: false,
      };
  }
}

function describeMcpServer(server: McpServerConfig): string {
  const transportLine = server.transport === "remote"
    ? `remote ${server.serverUrl || "(missing URL)"}`
    : `stdio ${server.command || "(missing command)"} ${server.args.replace(/\s+/g, " ")}`.trim();
  const flags = [
    server.enabled ? "enabled" : "disabled",
    `approval=${server.requireApproval}`,
    server.deferLoading ? "defer-loading" : "eager-loading",
    server.authorization.trim() ? "token-stored" : "no-token",
    server.allowedTools.trim() ? `allow=${server.allowedTools.replace(/\s+/g, " ")}` : "no-allowlist",
  ].join("; ");
  return `- ${server.label}: ${transportLine}; ${flags}.${server.description.trim() ? ` Purpose: ${server.description.trim()}` : ""}`;
}

function executeMcpListServersTool(mcpContext?: McpToolContext): LocalComputerToolCallResult {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (settings.servers.length === 0) {
    return { content: "No MCP servers are configured. Use mcp_set_server to add one.", executed: true };
  }
  const lines = [
    `MCP gate: ${settings.enabled ? "enabled" : "disabled"}.`,
    "Configured MCP servers:",
    ...settings.servers.map(describeMcpServer),
  ];
  return { content: lines.join("\n"), executed: true };
}

async function executeMcpListToolsTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
  signal?: AbortSignal,
): Promise<LocalComputerToolCallResult> {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (!settings.enabled) {
    return { content: "MCP is disabled on the MCP page.", executed: false };
  }
  const requestedLabel = firstArg(call.args, ["server_label", "label", "server", "name"]);
  const forceRefresh = booleanArg(call.args, ["force_refresh", "force", "refresh", "no_cache"], false);

  const candidates = requestedLabel
    ? settings.servers.filter((server) => normalizeMcpServerLabel(server.label) === normalizeMcpServerLabel(requestedLabel))
    : settings.servers.filter((server) => server.enabled);

  if (candidates.length === 0) {
    return {
      content: requestedLabel
        ? `No MCP server matches label "${requestedLabel}".`
        : "No MCP servers are enabled. Enable a server with mcp_set_server enabled=true or use mcp_list_servers to inspect state.",
      executed: false,
    };
  }

  const sections: string[] = [];
  for (const server of candidates) {
    if (server.transport !== "remote") {
      sections.push(`SERVER ${server.label} (${server.transport}): in-app stdio MCP execution is not wired yet. Configure as remote HTTPS, or copy the local config to an MCP-compatible desktop client.`);
      continue;
    }
    try {
      const tools = await mcpListTools(server, { force: forceRefresh, signal });
      if (tools.length === 0) {
        sections.push(`SERVER ${server.label}: no tools exposed.`);
        continue;
      }
      const allowList = server.allowedTools.trim() ? new Set(server.allowedTools.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)) : null;
      const lines = tools.map((tool) => {
        const allowed = !allowList || allowList.has(tool.name) ? "" : " [blocked by allow-list]";
        const description = tool.description ? ` - ${tool.description.replace(/\s+/g, " ")}` : "";
        return `  - ${tool.name}${allowed}${description}`;
      });
      sections.push(`SERVER ${server.label} (${tools.length} tools):\n${lines.join("\n")}`);
    } catch (error) {
      sections.push(`SERVER ${server.label}: tools/list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { content: sections.join("\n\n"), executed: true };
}

async function executeMcpCallTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
  signal?: AbortSignal,
): Promise<LocalComputerToolCallResult> {
  if (!mcpContext) {
    return { content: "MCP context is not available in this run.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  if (!settings.enabled) {
    return { content: "MCP is disabled on the MCP page.", executed: false };
  }
  const label = firstArg(call.args, ["server_label", "label", "server"]);
  const toolName = firstArg(call.args, ["tool_name", "name", "tool"]);
  if (!label || !toolName) {
    return { content: "mcp_call_tool needs both server_label and tool_name.", executed: false };
  }
  const server = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === normalizeMcpServerLabel(label));
  if (!server) {
    return { content: `No MCP server matches label "${label}".`, executed: false };
  }
  if (!server.enabled) {
    return { content: `MCP server "${label}" is disabled. Enable it with mcp_set_server enabled=true first.`, executed: false };
  }
  if (server.transport !== "remote") {
    return {
      content: `MCP server "${label}" uses stdio transport, which the in-app client does not run yet. Switch the server to a remote HTTPS endpoint or invoke it from a desktop MCP client.`,
      executed: false,
    };
  }
  if (server.allowedTools.trim()) {
    const allowed = server.allowedTools.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(toolName)) {
      return { content: `Tool "${toolName}" is not in the allow-list for server "${label}" (${allowed.join(", ")}).`, executed: false };
    }
  }

  const args = parseMcpArguments(firstArg(call.args, ["arguments_json", "arguments", "args", "input", "payload"]));

  try {
    const result = await mcpCallTool(server, toolName, args, { signal });
    const summary = flattenMcpContent(result.content) || "(empty result)";
    const structured = result.structuredContent ? `\n\nStructured:\n${JSON.stringify(result.structuredContent, null, 2)}` : "";
    if (result.isError) {
      return { content: `MCP tool ${label}.${toolName} reported error:\n${summary}${structured}`, executed: false };
    }
    return { content: `MCP tool ${label}.${toolName} result:\n${summary}${structured}`, executed: true };
  } catch (error) {
    return {
      content: `MCP tool ${label}.${toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      executed: false,
    };
  }
}

function parseMcpArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function executeMcpSetServerTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
): LocalComputerToolCallResult {
  if (!mcpContext?.onSettingsChange) {
    return { content: "MCP settings cannot be mutated in this run (no host callback registered).", executed: false };
  }
  const label = firstArg(call.args, ["label", "name", "server_label"]);
  if (!label) {
    return { content: "mcp_set_server needs label.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  const targetLabel = normalizeMcpServerLabel(label);
  const existing = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === targetLabel);
  const transport: McpServerTransport = (() => {
    const raw = firstArg(call.args, ["transport"])?.toLowerCase();
    if (raw === "stdio") return "stdio";
    if (raw === "remote") return "remote";
    return existing?.transport ?? "remote";
  })();

  const requireApprovalArg = firstArg(call.args, ["require_approval", "approval"]);
  const enabledArg = firstArg(call.args, ["enabled", "enable"]);
  const deferLoadingArg = firstArg(call.args, ["defer_loading", "defer"]);
  const now = new Date().toISOString();

  const merged: McpServerConfig = {
    allowedTools: firstArg(call.args, ["allowed_tools", "allow_tools", "allow"]) ?? existing?.allowedTools ?? "",
    args: firstArg(call.args, ["args", "command_args"]) ?? existing?.args ?? "",
    authorization: firstArg(call.args, ["authorization", "auth", "token", "bearer"]) ?? existing?.authorization ?? "",
    command: firstArg(call.args, ["command", "cmd"]) ?? existing?.command ?? "",
    createdAt: existing?.createdAt ?? now,
    deferLoading: deferLoadingArg !== undefined ? parseBoolean(deferLoadingArg, true) : existing?.deferLoading ?? true,
    description: firstArg(call.args, ["description", "purpose", "summary"]) ?? existing?.description ?? "",
    enabled: enabledArg !== undefined ? parseBoolean(enabledArg, true) : existing?.enabled ?? true,
    env: firstArg(call.args, ["env", "environment"]) ?? existing?.env ?? "",
    id: existing?.id ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: targetLabel,
    requireApproval: requireApprovalArg === "never" ? "never" : existing?.requireApproval ?? "always",
    serverUrl: firstArg(call.args, ["server_url", "url", "endpoint"]) ?? existing?.serverUrl ?? "",
    transport,
    updatedAt: now,
  };

  if (merged.transport === "remote" && !merged.serverUrl.trim()) {
    return { content: "mcp_set_server needs server_url for transport=remote.", executed: false };
  }
  if (merged.transport === "stdio" && !merged.command.trim()) {
    return { content: "mcp_set_server needs command for transport=stdio.", executed: false };
  }

  const nextServers = existing
    ? settings.servers.map((entry) => (entry.id === existing.id ? merged : entry))
    : [...settings.servers, merged];

  const nextSettings: McpSettings = { ...settings, servers: nextServers };
  mcpContext.onSettingsChange(nextSettings);
  mcpContext.settings = nextSettings;

  return {
    content: `${existing ? "Updated" : "Added"} MCP server "${merged.label}".\n${describeMcpServer(merged)}`,
    executed: true,
  };
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const trimmed = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "enable", "enabled"].includes(trimmed)) return true;
  if (["false", "0", "no", "off", "disable", "disabled"].includes(trimmed)) return false;
  return fallback;
}

function executeMcpRemoveServerTool(
  call: ParsedLocalComputerToolCall,
  mcpContext: McpToolContext | undefined,
): LocalComputerToolCallResult {
  if (!mcpContext?.onSettingsChange) {
    return { content: "MCP settings cannot be mutated in this run (no host callback registered).", executed: false };
  }
  const label = firstArg(call.args, ["label", "name", "server_label"]);
  if (!label) {
    return { content: "mcp_remove_server needs label.", executed: false };
  }
  const settings = normalizeMcpSettings(mcpContext.settings);
  const targetLabel = normalizeMcpServerLabel(label);
  const existing = settings.servers.find((entry) => normalizeMcpServerLabel(entry.label) === targetLabel);
  if (!existing) {
    return { content: `No MCP server matches label "${label}".`, executed: false };
  }
  const nextServers = settings.servers.filter((entry) => entry.id !== existing.id);
  const nextSettings: McpSettings = { ...settings, servers: nextServers };
  mcpContext.onSettingsChange(nextSettings);
  mcpContext.settings = nextSettings;
  return { content: `Removed MCP server "${existing.label}".`, executed: true };
}
