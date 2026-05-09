export type ToolRegistryId =
  | "browserPreview"
  | "codeEdit"
  | "codeView"
  | "desktopComputer"
  | "fileBrowser"
  | "fileSearch"
  | "permissions"
  | "planning"
  | "provider"
  | "sourceControl"
  | "terminal"
  | "thinking"
  | "webSearch"
  | "workflowAutomation";

export type ToolRegistrySettings = Record<ToolRegistryId, boolean>;

export const DEFAULT_TOOL_REGISTRY_SETTINGS: ToolRegistrySettings = {
  browserPreview: true,
  codeEdit: true,
  codeView: true,
  desktopComputer: true,
  fileBrowser: true,
  fileSearch: true,
  permissions: true,
  planning: true,
  provider: true,
  sourceControl: true,
  terminal: true,
  thinking: true,
  webSearch: true,
  workflowAutomation: true,
};

export function normalizeToolRegistrySettings(value: unknown): ToolRegistrySettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<ToolRegistrySettings>) : {};

  return Object.fromEntries(
    (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [
      toolId,
      typeof storedSettings[toolId] === "boolean" ? storedSettings[toolId] : DEFAULT_TOOL_REGISTRY_SETTINGS[toolId],
    ]),
  ) as ToolRegistrySettings;
}
