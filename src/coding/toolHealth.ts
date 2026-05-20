import { getModelProvider } from "../lib/models";
import { resolveToolPermission } from "../toolBridge/permissions";
import type { ToolCapabilityPlan, ToolDefinition, ToolBridgeToolChoice } from "../toolBridge/types";
import { isToolCompatibleWithProvider } from "../toolBridge/registry";
import type { ToolHealthSnapshot } from "../types/coding";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ProviderSettings } from "../types/settings";

export function createToolHealthSnapshot(options: {
  availableTools: ToolDefinition[];
  budgetReached?: boolean;
  model: string;
  parallelToolCalls?: boolean;
  passIndex: number;
  permissionMode: LocalPermissionMode;
  prompt: string;
  provider: ProviderSettings["provider"];
  registryTools: ToolDefinition[];
  runtimeBudget?: ToolHealthSnapshot["runtimeBudget"];
  selectedTools: ToolDefinition[];
  toolCapabilityPlan?: ToolCapabilityPlan;
  toolChoice?: ToolBridgeToolChoice;
  workspaceRoots: string[];
}): ToolHealthSnapshot {
  const selectedIds = new Set(options.selectedTools.map((tool) => tool.id));
  const availableIds = new Set(options.availableTools.map((tool) => tool.id));
  const providerFormat = options.toolCapabilityPlan?.providerFormat ?? inferProviderFormat(options.provider);

  return {
    advertisedTools: options.availableTools.map(toToolRef),
    availableToolCount: options.availableTools.length,
    capabilityPlan: options.toolCapabilityPlan ? summarizeCapabilityPlan(options.toolCapabilityPlan) : undefined,
    createdAt: new Date().toISOString(),
    hiddenTools: options.registryTools
      .filter((tool) => !selectedIds.has(tool.id))
      .map((tool) => ({
        ...toToolRef(tool),
        reason: explainHiddenTool(tool, {
          availableIds,
          budgetReached: options.budgetReached,
          permissionMode: options.permissionMode,
          providerFormat,
        }),
      }))
      .filter((tool) => Boolean(tool.reason)),
    id: `tool-health-pass-${options.passIndex}`,
    model: options.model,
    parallelToolCalls: options.parallelToolCalls,
    passIndex: options.passIndex,
    permissionMode: options.permissionMode,
    prompt: options.prompt,
    provider: options.provider,
    registryToolCount: options.registryTools.length,
    runtimeBudget: options.runtimeBudget,
    selectedTools: options.selectedTools.map(toToolRef),
    toolChoice: options.toolChoice,
    workspaceRoots: options.workspaceRoots,
  };
}

function summarizeCapabilityPlan(plan: ToolCapabilityPlan): ToolHealthSnapshot["capabilityPlan"] {
  return {
    blockedReasons: plan.blockedReasons.map((reason) => `${reason.code}${reason.family ? `/${reason.family}` : ""}: ${reason.detail}`),
    canCallProvider: plan.canCallProvider,
    intent: plan.intent,
    mustUseTools: plan.mustUseTools,
    providerFormat: plan.providerFormat,
    providerVisibleToolIds: plan.providerVisibleToolIds,
    requiredFamilies: plan.requiredFamilies,
    selectedToolIds: plan.selectedToolIds,
  };
}

function toToolRef(tool: ToolDefinition) {
  return {
    family: tool.executorMetadata?.family,
    id: tool.id,
    permission: tool.permission,
    risk: tool.risk,
    title: tool.title,
  };
}

function explainHiddenTool(
  tool: ToolDefinition,
  options: {
    availableIds: Set<string>;
    budgetReached?: boolean;
    permissionMode: LocalPermissionMode;
    providerFormat?: Parameters<typeof isToolCompatibleWithProvider>[1];
  },
) {
  if (options.budgetReached) {
    return "Tool budget reached for this pass.";
  }

  if (!isToolCompatibleWithProvider(tool, options.providerFormat)) {
    return "Provider request format does not support this tool.";
  }

  const permission = resolveToolPermission(tool, { permissionMode: options.permissionMode });
  if (!permission.allowed && !permission.requiresApproval) {
    return permission.reason ?? "Permission mode hid this tool.";
  }

  if (!options.availableIds.has(tool.id)) {
    if (permission.requiresApproval) {
      return permission.reason ?? "Tool requires approval before execution.";
    }

    return "Tool setting or request context hid this tool before prompt selection.";
  }

  return "Not selected for this prompt.";
}

function inferProviderFormat(providerId: ProviderSettings["provider"]) {
  const provider = getModelProvider(providerId);

  if (provider.apiStyle === "anthropic-messages") {
    return "anthropic-messages" as const;
  }

  return "openai-compatible" as const;
}
