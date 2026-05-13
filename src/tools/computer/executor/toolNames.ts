import { isCodingToolName } from "../../coding";
import { isColorToolName } from "../../color";
import { isFileCreationToolName } from "../../fileCreation";
import { isGithubToolName } from "../../github";
import type { GithubToolName } from "../../github";
import { isWebToolName } from "../../web/webToolExecutor";
import { isWeatherToolName } from "../../weather";
import { booleanArg, firstArg, normalizeArgName } from "./argHelpers";
import type { LocalComputerToolName, LocalGitToolName } from "./types";

export const MUTATING_TOOL_NAMES = new Set<string>([
  "browser_automation",
  "create_tool",
  "create_vite_project",
  "delete_file",
  "edit_file",
  "edit_files",
  "git_init",
  "git_branch",
  "git_checkout",
  "git_commit",
  "git_fetch",
  "git_pull",
  "git_push",
  "git_stage",
  "git_unstage",
  "github_commit_files",
  "github_create_branch",
  "github_create_pull_request",
  "github_create_release",
  "github_dispatch_workflow",
  "mcp_call_tool",
  "mcp_remove_server",
  "mcp_set_server",
  "move_path",
  "rename_path",
  "run_terminal",
  "run_tool",
  "write_file",
]);

export const LOCAL_GIT_TOOL_NAMES = new Set<LocalGitToolName>([
  "git_init",
  "git_branch",
  "git_checkout",
  "git_commit",
  "git_diff",
  "git_fetch",
  "git_log",
  "git_pull",
  "git_push",
  "git_stage",
  "git_status",
  "git_unstage",
]);
export function normalizeToolName(command: string, args: Record<string, string>): LocalComputerToolName {
  const normalized = command.toLowerCase().replace(/^computer[._-]/, "").replace(/^filesystem[._-]/, "").replace(/^local[._-]/, "");
  const inferredFromArgs = inferToolNameFromArgs(args);

  if (isToolNamePlaceholder(normalized) && inferredFromArgs) {
    return inferredFromArgs;
  }

  const mcpToolName = normalizeMcpToolName(normalized);
  if (mcpToolName) {
    return mcpToolName;
  }

  if (["workflow_run", "workflow-run", "run_workflow", "run-workflow", "workflow", "workflow.start", "workflow_start", "workflow-start"].includes(normalized)) {
    return "workflow_run";
  }

  if (isWebToolName(normalized)) {
    return isWeatherDataToolArgs(args) ? "weather" : "web_search";
  }

  if (isWeatherToolName(normalized)) {
    return "weather";
  }

  if (isColorToolName(normalized) || ["color", "color_lookup", "color-lookup", "lookup-color", "css_color", "css-color", "named_color", "named-color"].includes(normalized)) {
    return "lookup_color";
  }

  if (isFileCreationToolName(normalized)) {
    return normalized;
  }

  if (isCodingToolName(normalized)) {
    return normalized;
  }

  const localGitToolName = normalizeLocalGitToolName(normalized);

  if (localGitToolName) {
    return localGitToolName;
  }

  const githubToolName = normalizeGithubToolName(normalized);

  if (githubToolName) {
    return githubToolName;
  }

  if (["delete", "delete-file", "remove_file", "remove-file", "file.delete"].includes(normalized)) {
    return "delete_file";
  }

  if (["move", "move_path", "move-path", "move_file", "move-file", "move_folder", "move-folder", "file.move", "folder.move"].includes(normalized)) {
    return "move_path";
  }

  if (["rename", "rename_path", "rename-path", "rename_file", "rename-file", "rename_folder", "rename-folder", "file.rename", "folder.rename"].includes(normalized)) {
    return "rename_path";
  }

  if (["recall", "recall_context", "recall-context", "context_recall", "context-recall", "memory_search", "memory-search", "context_search", "context-search", "search_context", "search-context"].includes(normalized)) {
    return "recall_context";
  }

  if (["create_vite_project", "create-vite-project", "vite_project", "vite-project", "create_react_app", "create-react-app", "create_vite_app", "create-vite-app", "scaffold_vite", "scaffold-vite", "scaffold_project", "scaffold-project"].includes(normalized)) {
    return "create_vite_project";
  }

  // create_* aliases all funnel into the file-creation family. PDF and the
  // bespoke fabricator tools (sql_schema, unit_test, etc.) were removed in
  // Phase 2 — pdf paths now use create_code_file (the model can write PDF
  // bytes itself if it truly needs to, but agents never need to).
  if (["create_file", "create-file", "file.create", "file_create", "file-create", "new_file", "new-file"].includes(normalized)) {
    const kind = (args.kind ?? args.type ?? args.language ?? args.lang ?? "").toLowerCase();
    const path = (args.path ?? args.file_path ?? args.file ?? "").toLowerCase();

    if (kind.includes("react") || path.endsWith(".tsx") || path.endsWith(".jsx")) {
      return "create_react_file";
    }

    if (kind.includes("html") || path.endsWith(".html") || path.endsWith(".htm")) {
      return "create_html_file";
    }

    if (kind.includes("markdown") || kind === "md" || kind.includes("note") || path.endsWith(".md")) {
      return "create_markdown_file";
    }

    if (kind.includes("text") || kind === "txt" || path.endsWith(".txt")) {
      return "create_text_file";
    }

    return "create_code_file";
  }

  if (["create_files", "create-files", "file.create_many", "create_many_files", "create-many-files", "write_files", "write-files"].includes(normalized)) {
    return "create_files";
  }

  if ([
    "edit_files",
    "edit-files",
    "edit_many",
    "edit-many",
    "edit_many_files",
    "edit-many-files",
    "patch_files",
    "patch-files",
    "apply_edits",
    "apply-edits",
    "file.edit_many",
    "files.edit",
  ].includes(normalized)) {
    return "edit_files";
  }

  if (["create_text", "create-text", "create-text-file", "text_file", "text-file", "text-file-create", "txt", "note_text"].includes(normalized)) {
    return "create_text_file";
  }

  if (["create_markdown", "create-markdown", "create-markdown-file", "markdown_file", "markdown-file", "md_file", "note", "create_note", "create-note"].includes(normalized)) {
    return "create_markdown_file";
  }

  if (["create_code", "create-code", "create-code-file", "code_file", "code-file", "source_file", "source-file"].includes(normalized)) {
    return "create_code_file";
  }

  if (["create_react", "create-react", "create-react-file", "react_file", "react-file", "component_file", "component-file"].includes(normalized)) {
    return "create_react_file";
  }

  if (["create_html", "create-html", "create-html-file", "html_file", "html-file"].includes(normalized)) {
    return "create_html_file";
  }

  // Models that emit removed coding-tool aliases (run_tests, typescript_check,
  // create_sql_schema, etc.) get routed to run_terminal so they can still
  // accomplish the underlying intent via a shell command.
  if (["test", "tests", "run_test", "run-test", "run-tests", "ts_check", "ts-check", "typecheck", "typescript", "typescript-check"].includes(normalized)) {
    return "run_terminal";
  }

  // inline_edit was an alias for edit_file — the model uses the same args.
  if (["inline_edit", "inline-edit", "edit_inline", "edit-inline"].includes(normalized)) {
    return "edit_file";
  }

  if (["open_browser_preview", "open-browser-preview", "browser_preview", "browser-preview", "open_preview", "open-preview", "preview_url", "preview-url", "show_preview", "show-preview", "open_in_browser_preview", "open-in-browser-preview"].includes(normalized)) {
    return "open_browser_preview";
  }

  if (["browser_automation", "browser-automation", "browser.inspect", "inspect_browser", "inspect-browser", "assert_browser_text", "click_link", "click-link"].includes(normalized)) {
    return "browser_automation";
  }

  if (["run_subagents", "run-subagents", "parallel_agents", "parallel-agents", "delegate", "delegate_tasks"].includes(normalized)) {
    return "run_subagents";
  }

  if (["terminal", "terminal.run", "shell", "shell.run", "command", "command.run", "execute", "run_command", "run-command", "run_terminal", "run-terminal"].includes(normalized)) {
    return "run_terminal";
  }

  if (["create_tool", "create-tool", "make_tool", "make-tool", "save_tool", "save-tool", "tool.create", "tool_create", "tool-create"].includes(normalized)) {
    return "create_tool";
  }

  if (["run_tool", "run-tool", "custom_tool", "custom-tool", "tool.run", "execute_tool", "execute-tool"].includes(normalized)) {
    return "run_tool";
  }

  if (["index", "build_index", "build-index", "computer_build_file_index"].includes(normalized)) {
    return "build_index";
  }

  if (["ls", "list", "list_directory", "list-directory", "browse", "directory"].includes(normalized)) {
    return "list_directory";
  }

  if (["view", "view_code", "view-code", "code_view", "code-view", "show_lines", "show-lines"].includes(normalized)) {
    return "view_code";
  }

  if (["edit", "edit_file", "edit-file", "patch", "replace_text", "replace-text", "insert_text", "insert-text", "str_replace", "str-replace"].includes(normalized)) {
    return "edit_file";
  }

  // Models that emit search/replace-style aliases get routed to edit_file's
  // old_text/new_text mode, which subsumes the same behavior.
  if ([
    "apply_search_replace",
    "apply-search-replace",
    "search_replace",
    "search-replace",
    "search_and_replace",
    "search-and-replace",
    "diff_blocks",
    "diff-blocks",
    "apply_diff",
    "apply-diff",
  ].includes(normalized)) {
    return "edit_file";
  }

  if (["read", "read_file", "read-file", "open", "cat"].includes(normalized) || (!normalized && (args.file_path || args.file))) {
    return "read_file";
  }

  if (["search", "search_files", "search-files", "find"].includes(normalized)) {
    return "search_files";
  }

  if (["write", "write_file", "write-file", "save"].includes(normalized)) {
    return "write_file";
  }

  return inferredFromArgs ?? "unknown";
}

export function isToolNamePlaceholder(value: string) {
  return !value || ["arg", "args", "arguments", "call", "function", "input", "tool", "tool_call"].includes(value);
}

export function inferToolNameFromArgs(args: Record<string, string>): LocalComputerToolName | null {
  const framework = firstArg(args, ["framework", "template", "stack", "kind", "type"]) ?? "";

  if (/\bvite\b/i.test(framework) && /\breact\b/i.test(framework) && hasNonEmptyArg(args, ["project_path", "projectPath", "path", "directory_path", "folder_path", "project_name", "name"])) {
    return "create_vite_project";
  }

  if (hasNonEmptyArg(args, ["edits_json", "edits", "patches_json", "patches"])) {
    return "edit_files";
  }

  // Parallel-array shape: `paths: [...]` plus old_text/new_text or content,
  // applied across every path. Same intent as `edits`, different surface.
  if (
    hasNonEmptyArg(args, ["paths", "paths_json", "file_paths", "files_paths"]) &&
    hasNonEmptyArg(args, [
      "old_text",
      "old_texts",
      "old_string",
      "old_strings",
      "old_str",
      "old_strs",
      "new_text",
      "new_texts",
      "new_string",
      "new_strings",
      "new_str",
      "new_strs",
      "search",
      "find",
      "replace",
      "replacement",
    ])
  ) {
    return "edit_files";
  }

  if (hasNonEmptyArg(args, ["files_json", "files", "manifest", "items"])) {
    return "create_files";
  }

  if (hasNonEmptyArg(args, ["command", "cmd", "shell_command", "terminal_command"])) {
    return "run_terminal";
  }

  if (hasNonEmptyArg(args, ["workflow_id", "workflowId", "workflow", "goal"]) && hasNonEmptyArg(args, ["mode", "inputs", "inputs_json", "inputsJson", "goal"])) {
    return "workflow_run";
  }

  if (hasNonEmptyArg(args, ["query", "q", "search"])) {
    return isWeatherDataToolArgs(args) ? "weather" : "web_search";
  }

  if (hasNonEmptyArg(args, ["url", "href", "address", "target"])) {
    return "open_browser_preview";
  }

  if (hasNonEmptyArg(args, ["path", "file_path", "file"])) {
    if (hasNonEmptyArg(args, ["to_path", "toPath", "destination_path", "destinationPath", "target_path", "new_path", "newPath", "new_name", "newName"])) {
      return "move_path";
    }

    if (
      hasNonEmptyArg(args, ["new_text", "newText", "new_string", "newString", "new_str", "newStr"]) &&
      (booleanArg(args, ["replace_entire_file", "replaceEntireFile", "full_replace", "fullReplace", "allow_full_rewrite", "allowFullRewrite"], false) || hasNonEmptyArg(args, ["expected_sha256", "expectedSha256", "if_match_sha256", "ifMatchSha256", "sha256"]))
    ) {
      return "write_file";
    }

    if (hasNonEmptyArg(args, ["old_text", "old_string", "old_str", "start_line", "end_line", "start_char", "end_char", "insert_at_line", "insert_line"])) {
      return "edit_file";
    }

    if (hasNonEmptyArg(args, ["content", "text", "body", "markdown", "new_content", "newContent", "file_content", "fileContent", "contents", "full_content", "fullContent", "full_file_content", "fullFileContent", "replacement", "replacement_text", "replacementText", "source", "css", "stylesheet"])) {
      return "write_file";
    }
  }

  if (hasNonEmptyArg(args, ["from_path", "fromPath", "source_path", "source", "old_path", "oldPath"]) && hasNonEmptyArg(args, ["to_path", "toPath", "destination_path", "destinationPath", "target_path", "new_path", "newPath", "new_name", "newName"])) {
    return "move_path";
  }

  if (hasNonEmptyArg(args, ["paths", "paths_json"]) || booleanArg(args, ["all", "all_files", "allFiles"], false)) {
    return "git_status";
  }

  return null;
}

export function hasNonEmptyArg(args: Record<string, string>, keys: string[]) {
  return keys.some((key) => {
    const value = args[normalizeArgName(key)] ?? args[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function isWeatherDataToolArgs(args: Record<string, string>) {
  const query = firstArg(args, ["query", "q", "search", "text", "prompt"]) ?? "";

  return /\b(weather|forecast|temperature|temp|rain|snow|storm|storms|thunderstorm|alerts?|warnings?|radar|current conditions?|hourly|nws|noaa)\b/i.test(query)
    && !/\b(docs?|documentation|api|schema|endpoint|openapi|developer|source code|standard|spec)\b/i.test(query);
}

function normalizeMcpToolName(command: string): LocalComputerToolName | null {
  if (["mcp_list_servers", "mcp_servers", "mcp_list", "list_mcp_servers", "list_mcp"].includes(command)) {
    return "mcp_list_servers";
  }
  if (["mcp_list_tools", "list_mcp_tools", "mcp_tools", "mcp_discover_tools"].includes(command)) {
    return "mcp_list_tools";
  }
  if (["mcp_call_tool", "mcp_call", "call_mcp_tool", "mcp_invoke", "mcp_invoke_tool", "mcp_run", "mcp_run_tool"].includes(command)) {
    return "mcp_call_tool";
  }
  if (["mcp_set_server", "mcp_add_server", "mcp_update_server", "mcp_upsert_server", "mcp_save_server", "add_mcp_server", "update_mcp_server"].includes(command)) {
    return "mcp_set_server";
  }
  if (["mcp_remove_server", "mcp_delete_server", "remove_mcp_server", "delete_mcp_server"].includes(command)) {
    return "mcp_remove_server";
  }
  return null;
}

export function isLocalGitToolName(value: string): value is LocalGitToolName {
  return LOCAL_GIT_TOOL_NAMES.has(value as LocalGitToolName);
}

export function normalizeLocalGitToolName(command: string): LocalGitToolName | null {
  const normalized = command.replace(/^git[._-]/, "git_");

  if (isLocalGitToolName(normalized)) {
    return normalized;
  }

  if (["git", "git_status", "git_state", "git_worktree_status", "version_control_status"].includes(normalized)) {
    return "git_status";
  }

  if (["git_init", "git_initialize", "git_initialise", "git_init_repo", "git_init_repository", "git_initialize_repository", "git_create_repo", "git_create_repository", "init_git", "initialize_git", "initialise_git"].includes(normalized)) {
    return "git_init";
  }

  if (["git_diff", "git_changes", "git_patch", "git_show_changes"].includes(normalized)) {
    return "git_diff";
  }

  if (["git_log", "git_history", "git_commits"].includes(normalized)) {
    return "git_log";
  }

  if (["git_add", "git_stage", "git_stage_files"].includes(normalized)) {
    return "git_stage";
  }

  if (["git_unstage", "git_reset_stage", "git_restore_staged"].includes(normalized)) {
    return "git_unstage";
  }

  if (["git_commit", "git_create_commit"].includes(normalized)) {
    return "git_commit";
  }

  if (["git_push"].includes(normalized)) {
    return "git_push";
  }

  if (["git_pull"].includes(normalized)) {
    return "git_pull";
  }

  if (["git_fetch"].includes(normalized)) {
    return "git_fetch";
  }

  if (["git_branch", "git_list_branches", "git_create_branch", "git_delete_branch"].includes(normalized)) {
    return "git_branch";
  }

  if (["git_checkout", "git_switch", "git_switch_branch"].includes(normalized)) {
    return "git_checkout";
  }

  return null;
}

function normalizeGithubToolName(command: string): GithubToolName | null {
  const normalized = command.replace(/^github[._-]/, "github_").replace(/^git[._-]/, "github_");

  if (isGithubToolName(normalized)) {
    return normalized;
  }

  if (["github", "github_status", "github_account", "source_control_status"].includes(normalized)) {
    return "github_status";
  }

  if (["github_repos", "github_repositories", "github_list_repos", "github_list_repositories", "github_repo_list", "source_control_repos"].includes(normalized)) {
    return "github_list_repositories";
  }

  if (["github_repo", "github_repository", "github_get_repo", "github_get_repository"].includes(normalized)) {
    return "github_get_repository";
  }

  if (["github_branches", "github_list_branches", "github_branch_list"].includes(normalized)) {
    return "github_list_branches";
  }

  if (["github_tree", "github_files", "github_list_files", "github_list_tree", "github_pull", "github_pull_repository", "github_pull_snapshot"].includes(normalized)) {
    return "github_list_tree";
  }

  if (["github_file", "github_read", "github_read_file", "github_view_file", "github_cat"].includes(normalized)) {
    return "github_read_file";
  }

  if (["github_search", "github_code_search", "github_search_code"].includes(normalized)) {
    return "github_search_code";
  }

  if (["github_branch", "github_create_branch", "github_new_branch"].includes(normalized)) {
    return "github_create_branch";
  }

  if (["github_commit", "github_commit_files", "github_push", "github_push_files", "github_write_files"].includes(normalized)) {
    return "github_commit_files";
  }

  if (["github_pr", "github_pull_request", "github_create_pr", "github_create_pull_request", "github_open_pr"].includes(normalized)) {
    return "github_create_pull_request";
  }

  if (["github_release_notes", "github_generate_release_notes", "github_generate_notes", "github_notes", "github_changelog"].includes(normalized)) {
    return "github_generate_release_notes";
  }

  if (["github_release", "github_create_release", "github_publish_release", "github_draft_release", "github_new_release"].includes(normalized)) {
    return "github_create_release";
  }

  if (["github_releases", "github_list_releases", "github_release_list", "github_tags_releases"].includes(normalized)) {
    return "github_list_releases";
  }

  if (["github_workflows", "github_list_workflows", "github_actions_workflows", "github_workflow_list"].includes(normalized)) {
    return "github_list_workflows";
  }

  if (["github_dispatch_workflow", "github_workflow_dispatch", "github_run_workflow", "github_trigger_workflow", "github_actions_dispatch"].includes(normalized)) {
    return "github_dispatch_workflow";
  }

  if (["github_workflow_runs", "github_list_workflow_runs", "github_actions_runs", "github_runs"].includes(normalized)) {
    return "github_list_workflow_runs";
  }

  return null;
}
