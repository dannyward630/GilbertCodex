export interface McpToolSummary {
  description?: string;
  inputSchema?: unknown;
  name: string;
}

export type McpTransport = "http" | "stdio";

export interface McpEnvironmentVariable {
  name: string;
  value: string;
}

export interface McpEnvironmentVariableState {
  hasValue: boolean;
  name: string;
}

export interface McpServerState {
  args: string[];
  command?: string;
  createdAt?: number;
  enabled: boolean;
  endpoint?: string;
  environment: McpEnvironmentVariableState[];
  hasAuthorizationToken: boolean;
  id: string;
  lastConnectedAt?: number;
  lastError?: string;
  name: string;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  tools: McpToolSummary[];
  transport: McpTransport;
  updatedAt?: number;
  workingDirectory?: string;
}

export interface McpConnectionState {
  connected: boolean;
  enabledServerCount: number;
  maxServers: number;
  servers: McpServerState[];
}

export interface McpSaveServerRequest {
  authorizationToken?: string;
  args?: string[];
  command?: string;
  enabled?: boolean;
  endpoint?: string;
  environment?: McpEnvironmentVariable[];
  id?: string;
  name: string;
  transport?: McpTransport;
  workingDirectory?: string;
}

export interface McpSaveServerResponse {
  server: McpServerState;
  state: McpConnectionState;
}

export interface McpServerIdRequest {
  id: string;
}

export interface McpTestServerRequest {
  authorizationToken?: string;
  args?: string[];
  command?: string;
  endpoint?: string;
  environment?: McpEnvironmentVariable[];
  id?: string;
  transport?: McpTransport;
  workingDirectory?: string;
}

export interface McpServerTestResponse {
  message: string;
  ok: boolean;
  protocolVersion?: string;
  server?: McpServerState;
  serverName?: string;
  serverVersion?: string;
  state?: McpConnectionState;
  tools: McpToolSummary[];
}

export interface McpListToolsRequest {
  serverId: string;
}

export interface McpListToolsResponse {
  server: McpServerState;
  state: McpConnectionState;
  tools: McpToolSummary[];
}

export interface McpCallToolRequest {
  arguments?: Record<string, unknown>;
  serverId: string;
  toolName: string;
}

export interface McpToolCallResponse {
  content: string;
  isError: boolean;
  ok: boolean;
  rawResult: unknown;
  server: McpServerState;
  structuredContent?: unknown;
  toolName: string;
}
