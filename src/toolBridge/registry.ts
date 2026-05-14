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

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(initialTools: ToolDefinition[] = []) {
    initialTools.forEach((tool) => this.register(tool));
  }

  get(id: string) {
    return this.tools.get(id);
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
