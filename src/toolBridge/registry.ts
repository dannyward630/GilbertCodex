import type { ToolDefinition, ToolExecutionContext, ToolBridgeProviderFormat } from "./types";
import { filterToolsForPermission, type FilterToolsForPermissionOptions } from "./permissions";
import { diagnosticTools } from "./tools/diagnostic";
import { editingTools } from "./tools/editing";
import { fileTools } from "./tools/files";
import { gitTools } from "./tools/git";
import { mcpTools } from "./tools/mcp";
import { terminalTools } from "./tools/terminal";
import { webTools } from "./tools/web";

export type ToolRegistryListOptions = FilterToolsForPermissionOptions;

const TOOL_ID_ALIASES: Record<string, string> = {
  batch_read: "files_read_many",
  count_lines: "files_count_lines",
  dir: "files_list",
  file_read: "files_read",
  file_stat: "files_stat",
  files_grep: "files_search",
  "files.list": "files_list",
  "files.read": "files_read",
  "files.read_many": "files_read_many",
  "files.read_range": "files_read_range",
  "files.search": "files_search",
  "files.stat": "files_stat",
  "files.tree": "files_tree_summary",
  grep: "files_search",
  line_count: "files_count_lines",
  list: "files_list",
  list_dir: "files_list",
  list_directory: "files_list",
  ls: "files_list",
  read: "files_read",
  read_file: "files_read",
  read_range: "files_read_range",
  read_files: "files_read_many",
  read_many: "files_read_many",
  read_range_file: "files_read_range",
  search: "files_search",
  search_files: "files_search",
  stat: "files_stat",
  tree: "files_tree_summary",
  tree_summary: "files_tree_summary",
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
    ...gitTools,
    ...webTools,
    ...mcpTools,
  ]);
}

export function isToolCompatibleWithProvider(tool: ToolDefinition, providerFormat: ToolBridgeProviderFormat | undefined) {
  return !providerFormat || !tool.compatibleProviders || tool.compatibleProviders.includes(providerFormat);
}
