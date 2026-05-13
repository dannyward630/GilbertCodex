export function describeCodingTools() {
  return [
    "Coding tools: inline_edit, edit_file, edit_files, write_file, delete_file, rename_path, move_path, create_files, create_vite_project, run_terminal, and the local git_* tools when their Toolbox categories are enabled.",
    "delete_file removes one file only, never folders, and requires confirm_delete=true plus write permission. Use rename_path/move_path for file and folder name/location changes inside enabled roots.",
    "File creation defaults to overwrite=false, with duplicate_strategy=increment available for safe auto-renaming.",
    "inline_edit is an alias for precise edit_file behavior and supports old_text/new_text, line ranges, and character ranges.",
    "Use run_terminal for tests, type checks, builds, formatters, package installs, and command evidence; specialized run_tests/typescript_check names are legacy aliases only when routed by compatibility parsing.",
    "Goal-level work should start with workflow_run when workflow automation is enabled, then continue with primitive tools only for the exact next action.",
  ].join("\n");
}
