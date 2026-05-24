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

export interface McpServerProgressEvent {
  kind: "download" | "error" | "finished" | "output" | "started" | "step" | string;
  message: string;
  stream?: string;
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

export interface McpRegistrySearchRequest {
  limit?: number;
  query?: string;
}

export interface McpRegistrySearchResponse {
  count: number;
  nextCursor?: string;
  query: string;
  servers: McpRegistryServerSummary[];
  source: string;
}

export interface McpRegistryServerSummary {
  description?: string;
  install?: McpRegistryInstallHint;
  name: string;
  official: boolean;
  packages: McpRegistryPackageHint[];
  remotes: McpRegistryRemoteHint[];
  repositoryUrl?: string;
  status?: string;
  title?: string;
  updatedAt?: string;
  version?: string;
}

export interface McpRegistryPackageHint {
  args: string[];
  command?: string;
  identifier?: string;
  registryType?: string;
  runtimeHint?: string;
  transport?: string;
  version?: string;
}

export interface McpRegistryRemoteHint {
  endpoint?: string;
  transport?: string;
}

export interface McpRegistryInstallHint {
  args: string[];
  command?: string;
  endpoint?: string;
  note?: string;
  packageId?: string;
  packageManager?: string;
  transport: McpTransport;
}
