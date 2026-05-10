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
  | "vectorTools"
  | "webSearch"
  | "workflowAutomation";

export type ToolRegistrySettings = Record<ToolRegistryId, boolean>;

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
  vectorTools: true,
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
