import type { ToolDefinition, ToolExecutionContext, ToolBridgeProviderFormat } from "./types";
import { filterToolsForPermission, type FilterToolsForPermissionOptions } from "./permissions";
import { diagnosticTools } from "./tools/diagnostic";
import { editingTools } from "./tools/editing";
import { fileTools } from "./tools/files";
import { gitTools } from "./tools/git";
import { mcpTools } from "./tools/mcp";
import { browserTools } from "./tools/browser";
import { memoryTools } from "./tools/memory";
import { terminalTools } from "./tools/terminal";
import { webTools } from "./tools/web";

export type ToolRegistryListOptions = FilterToolsForPermissionOptions;

const TOOL_ID_ALIASES: Record<string, string> = {
  apply_patch: "files_apply_patch",
  append_file: "files_append",
  app_preview: "browser_preview_open",
  batch_edit: "files_edit_many",
  batch_read: "files_read_many",
  batch_write: "files_write_many",
  "browser.console": "browser_console_read",
  browser_console: "browser_console_read",
  browser_console_logs: "browser_console_read",
  "browser.open_preview": "browser_preview_open",
  "browser.preview": "browser_preview_open",
  browser_preview: "browser_preview_open",
  console_read: "browser_console_read",
  count_lines: "files_count_lines",
  create_files: "files_write_many",
  create_dir: "files_create_directory",
  create_directory: "files_create_directory",
  create_folder: "files_create_directory",
  dir: "files_list",
  edit: "files_exact_replace",
  edit_file: "files_exact_replace",
  edit_files: "files_edit_many",
  editor: "files_exact_replace",
  exact_replace: "files_exact_replace",
  file_editor: "files_exact_replace",
  "files.append": "files_append",
  "files.apply_patch": "files_apply_patch",
  files_applypatch: "files_apply_patch",
  "files.edit": "files_exact_replace",
  "files.edit_many": "files_edit_many",
  files_editmany: "files_edit_many",
  files_edit: "files_exact_replace",
  files_exactreplace: "files_exact_replace",
  "files.insert": "files_insert_at_line",
  "files.insert_at_line": "files_insert_at_line",
  "files.move": "files_move",
  "files.create": "files_write_many",
  "files.create_directory": "files_create_directory",
  "files.create_folder": "files_create_directory",
  "files.create_many": "files_write_many",
  "files.mkdir": "files_create_directory",
  files_createdirectory: "files_create_directory",
  files_createfolder: "files_create_directory",
  files_createmany: "files_write_many",
  files_readmany: "files_read_many",
  files_readrange: "files_read_range",
  files_replace: "files_exact_replace",
  "files.replace_range": "files_replace_range",
  files_treesummary: "files_tree_summary",
  "files.write": "files_write",
  "files.write_many": "files_write_many",
  files_writemany: "files_write_many",
  file_edit: "files_exact_replace",
  file_editor_tool: "files_exact_replace",
  file_read: "files_read",
  file_stat: "files_stat",
  file_write: "files_write",
  files_grep: "files_search",
  "files.list": "files_list",
  "files.read": "files_read",
  "files.read_many": "files_read_many",
  "files.read_range": "files_read_range",
  "files.search": "files_search",
  "files.stat": "files_stat",
  "files.tree": "files_tree_summary",
  grep: "files_search",
  "git.branch": "git_branch",
  "git.commit": "git_commit",
  "git.diff": "git_diff",
  "git.init": "git_init",
  "git.pull": "git_pull",
  "git.push": "git_push",
  "git.stage": "git_stage",
  "git.status": "git_status",
  git_branch_create: "git_branch",
  git_create_branch: "git_branch",
  git_repo_status: "git_status",
  git_staged_diff: "git_diff",
  github_branch: "github_create_branch",
  "github.branches": "github_list_branches",
  "github.commit_files": "github_commit_files",
  "github.create_branch": "github_create_branch",
  "github.create_pr": "github_create_pull_request",
  "github.create_release": "github_create_release",
  "github.dispatch_workflow": "github_dispatch_workflow",
  "github.file": "github_read_file",
  "github.get_repository": "github_get_repository",
  "github.list_repositories": "github_list_repositories",
  "github.pr": "github_create_pull_request",
  "github.read_file": "github_read_file",
  "github.release_notes": "github_generate_release_notes",
  "github.releases": "github_list_releases",
  "github.repo": "github_get_repository",
  "github.repos": "github_list_repositories",
  "github.search": "github_search_code",
  "github.tree": "github_list_tree",
  "github.workflow_runs": "github_list_workflow_runs",
  "github.workflows": "github_list_workflows",
  github_repositories: "github_list_repositories",
  github_repos: "github_list_repositories",
  github_workflow_dispatch: "github_dispatch_workflow",
  insert_at_line: "files_insert_at_line",
  line_count: "files_count_lines",
  list: "files_list",
  list_dir: "files_list",
  list_directory: "files_list",
  ls: "files_list",
  memory: "memory_search",
  "memory.search": "memory_search",
  "memory-search": "memory_search",
  memory_recall: "memory_search",
  project_memory: "memory_search",
  recall_memory: "memory_search",
  move_file: "files_move",
  move_path: "files_move",
  mkdir: "files_create_directory",
  open_browser_preview: "browser_preview_open",
  patch_apply: "files_apply_patch",
  preview_app: "browser_preview_open",
  preview_url: "browser_preview_open",
  read: "files_read",
  read_browser_console: "browser_console_read",
  read_file: "files_read",
  read_range: "files_read_range",
  read_files: "files_read_many",
  read_many: "files_read_many",
  read_range_file: "files_read_range",
  replace_range: "files_replace_range",
  search: "files_search",
  search_files: "files_search",
  search_memory: "memory_search",
  shell_command: "terminal_run",
  run_command: "terminal_run",
  stat: "files_stat",
  terminal: "terminal_run",
  terminal_command: "terminal_run",
  terminal_exec: "terminal_run",
  "terminal.run": "terminal_run",
  "terminal.run_command": "terminal_run",
  terminal_run_command: "terminal_run",
  tree: "files_tree_summary",
  tree_summary: "files_tree_summary",
  write_files: "files_write_many",
  write_many: "files_write_many",
  run_terminal: "terminal_run",
  brave_search: "web_search",
  "brave.search": "web_search",
  "brave-search": "web_search",
  duckduckgo_search: "web_search",
  "duckduckgo.search": "web_search",
  "duckduckgo-search": "web_search",
  search_web: "web_search",
  "search.web": "web_search",
  "search-web": "web_search",
  web: "web_search",
  "web.search": "web_search",
  "web-search": "web_search",
  write_file: "files_write",
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(initialTools: ToolDefinition[] = []) {
    initialTools.forEach((tool) => this.register(tool));
  }

  get(id: string) {
    return this.tools.get(this.resolveId(id));
  }

  list() {
    return [...this.tools.values()];
  }

  listForContext(
    context: Pick<ToolExecutionContext, "permissionMode">,
    providerFormat?: ToolBridgeProviderFormat,
    options?: ToolRegistryListOptions,
  ) {
    return filterToolsForPermission(this.list(), context, options).filter((tool) =>
      isToolCompatibleWithProvider(tool, providerFormat),
    );
  }

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool bridge registry already has a tool named ${tool.id}.`);
    }

    this.tools.set(tool.id, tool);
  }

  resolveId(id: string) {
    const normalizedId = id.trim();
    return TOOL_ID_ALIASES[normalizedId.toLowerCase()] ?? normalizedId;
  }
}

export function createDefaultToolRegistry() {
  return new ToolRegistry([
    ...diagnosticTools,
    ...fileTools,
    ...editingTools,
    ...terminalTools,
    ...browserTools,
    ...gitTools,
    ...webTools,
    ...memoryTools,
    ...mcpTools,
  ]);
}

export function isToolCompatibleWithProvider(tool: ToolDefinition, providerFormat: ToolBridgeProviderFormat | undefined) {
  return !providerFormat || !tool.compatibleProviders || tool.compatibleProviders.includes(providerFormat);
}
