/** Toolbox categories that can be enabled or disabled by the user. */
export type ToolRegistryId =
  | "browserPreview"
  | "codeEdit"
  | "codeGeneration"
  | "codeView"
  | "colorTools"
  | "desktopComputer"
  | "fileSafety"
  | "fileCreation"
  | "fileBrowser"
  | "fileSearch"
  | "mcpServers"
  | "pdfTools"
  | "permissions"
  | "planning"
  | "provider"
  | "reactNativeTools"
  | "sourceControl"
  | "sqlTools"
  | "terminal"
  | "thinking"
  | "testingTools"
  | "typescriptTools"
  | "webSearch"
  | "weatherTools"
  | "workflowAutomation";

export type ToolRegistrySettings = Record<ToolRegistryId, boolean>;

/** New installs start with every current tool category enabled. */
export const DEFAULT_TOOL_REGISTRY_SETTINGS: ToolRegistrySettings = {
  browserPreview: true,
  codeEdit: true,
  codeGeneration: true,
  codeView: true,
  colorTools: true,
  desktopComputer: true,
  fileSafety: true,
  fileCreation: true,
  fileBrowser: true,
  fileSearch: true,
  mcpServers: true,
  pdfTools: true,
  permissions: true,
  planning: true,
  provider: true,
  reactNativeTools: true,
  sourceControl: true,
  sqlTools: true,
  terminal: true,
  thinking: true,
  testingTools: true,
  typescriptTools: true,
  webSearch: true,
  weatherTools: true,
  workflowAutomation: true,
};

/** Merges persisted Toolbox settings with defaults so new tool categories opt in. */
export function normalizeToolRegistrySettings(value: unknown): ToolRegistrySettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<ToolRegistrySettings>) : {};

  return Object.fromEntries(
    (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [
      toolId,
      typeof storedSettings[toolId] === "boolean" ? storedSettings[toolId] : DEFAULT_TOOL_REGISTRY_SETTINGS[toolId],
    ]),
  ) as ToolRegistrySettings;
}
