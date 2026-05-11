export type CodingToolName =
  | "check_duplicate_file"
  | "codebase_health_scan"
  | "create_api_route"
  | "create_chat_pdf"
  | "create_react_native_screen"
  | "create_sql_migration"
  | "create_sql_schema"
  | "create_unit_test"
  | "delete_file"
  | "dependency_audit"
  | "inline_edit"
  | "prevent_duplicate_file_create"
  | "react_native_setup_check"
  | "run_tests"
  | "typescript_check";

export const CODING_TOOL_NAMES = new Set<CodingToolName>([
  "check_duplicate_file",
  "codebase_health_scan",
  "create_api_route",
  "create_chat_pdf",
  "create_react_native_screen",
  "create_sql_migration",
  "create_sql_schema",
  "create_unit_test",
  "delete_file",
  "dependency_audit",
  "inline_edit",
  "prevent_duplicate_file_create",
  "react_native_setup_check",
  "run_tests",
  "typescript_check",
]);

export interface GeneratedCodingFile {
  content: string;
  createParentDirs: boolean;
  description: string;
  overwrite: boolean;
  path: string;
}

export function isCodingToolName(value: string): value is CodingToolName {
  return CODING_TOOL_NAMES.has(value as CodingToolName);
}
