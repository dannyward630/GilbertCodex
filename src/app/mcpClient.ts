import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./tauriClient";
import type {
  McpCallToolRequest,
  McpConnectionState,
  McpListToolsRequest,
  McpListToolsResponse,
  McpSaveServerRequest,
  McpSaveServerResponse,
  McpServerIdRequest,
  McpServerTestResponse,
  McpTestServerRequest,
  McpToolCallResponse,
} from "../types/mcp";

export function mcpDesktopAvailable() {
  return isTauriDesktopRuntime();
}

export async function getMcpState(): Promise<McpConnectionState> {
  assertMcpDesktop();
  return invoke<McpConnectionState>("mcp_get_state");
}

export async function saveMcpServer(request: McpSaveServerRequest): Promise<McpSaveServerResponse> {
  assertMcpDesktop();
  return invoke<McpSaveServerResponse>("mcp_save_server", { request });
}

export async function removeMcpServer(request: McpServerIdRequest): Promise<McpConnectionState> {
  assertMcpDesktop();
  return invoke<McpConnectionState>("mcp_remove_server", { request });
}

export async function testMcpServer(request: McpTestServerRequest): Promise<McpServerTestResponse> {
  assertMcpDesktop();
  return invoke<McpServerTestResponse>("mcp_test_server", { request });
}

export async function listMcpServerTools(request: McpListToolsRequest): Promise<McpListToolsResponse> {
  assertMcpDesktop();
  return invoke<McpListToolsResponse>("mcp_list_tools", { request });
}

export async function callMcpTool(request: McpCallToolRequest): Promise<McpToolCallResponse> {
  assertMcpDesktop();
  return invoke<McpToolCallResponse>("mcp_call_tool", { request });
}

function assertMcpDesktop() {
  if (!mcpDesktopAvailable()) {
    throw new Error("MCP server connections are available in the Tauri desktop app.");
  }
}
