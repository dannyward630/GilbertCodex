export type ApiKeyKind = "app" | "custom" | "mcp" | "provider" | "service" | "skill";

export interface ApiKeyRecord {
  createdAt: string;
  id: string;
  keyName: string;
  kind: ApiKeyKind;
  label: string;
  service: string;
  updatedAt: string;
  value: string;
}

export interface ApiKeyVaultState {
  keys: ApiKeyRecord[];
  version: 1;
}

export interface ApiKeyPreset {
  description: string;
  group: "App" | "MCP" | "Service" | "Skill";
  id: string;
  keyName: string;
  kind: Exclude<ApiKeyKind, "provider">;
  label: string;
  service: string;
}
