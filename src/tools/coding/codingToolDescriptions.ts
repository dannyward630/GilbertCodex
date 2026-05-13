export function describeCodingTools() {
  return [
    "Coding tools: delete_file, rename_path, move_path, check_duplicate_file, prevent_duplicate_file_create, create_chat_pdf, inline_edit, run_tests, typescript_check, create_sql_schema, create_sql_migration, create_react_native_screen, react_native_setup_check, create_unit_test, codebase_health_scan, dependency_audit, create_api_route.",
    "delete_file removes one file only, never folders, and requires confirm_delete=true plus write permission. Use rename_path/move_path for file and folder name/location changes inside enabled roots.",
    "Duplicate tools should be used before creating files when a name may already exist. File creation also defaults to overwrite=false, with duplicate_strategy=increment available for safe auto-renaming.",
    "inline_edit is an alias for precise edit_file behavior and supports old_text/new_text, line ranges, and character ranges.",
    "run_tests and typescript_check execute bounded project commands inside the enabled root when Terminal is enabled and permission mode allows commands.",
    "SQL, React Native, unit-test, and API-route generators create starter files without overwriting existing files unless overwrite=true is explicitly requested.",
  ].join("\n");
}
