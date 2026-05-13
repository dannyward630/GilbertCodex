export type CodingToolName =
  | "delete_file";

export const CODING_TOOL_NAMES = new Set<CodingToolName>([
  "delete_file",
]);

export function isCodingToolName(value: string): value is CodingToolName {
  return CODING_TOOL_NAMES.has(value as CodingToolName);
}
