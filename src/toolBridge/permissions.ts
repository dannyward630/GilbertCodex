import type { LocalPermissionMode } from "../types/localWorkspace";
import type {
  ToolBridgePermissionRequirement,
  ToolBridgeRisk,
  ToolDefinition,
  ToolExecutionContext,
  ToolPermissionDecision,
} from "./types";

const LEGACY_PERMISSION_MODE_MAP: Record<string, LocalPermissionMode> = {
  "ask-first": "default",
  "auto-review": "auto-review",
  default: "default",
  "full-access": "full-access",
  "full-workspace": "full-access",
  "gilbert-review": "default",
  "read-only": "default",
};

const HARD_APPROVAL_PERMISSIONS: ReadonlySet<ToolBridgePermissionRequirement> = new Set([
  "credential",
  "destructive",
  "external-path",
  "publish",
  "terminal",
]);

const HARD_APPROVAL_RISKS: ReadonlySet<ToolBridgeRisk> = new Set([
  "credential",
  "destructive",
  "publish",
  "terminal",
]);

export interface FilterToolsForPermissionOptions {
  /**
   * When true, tools that are gated behind an approval flow are returned
   * alongside tools that are allowed outright. Callers that wire an approval
   * callback into the orchestrator should pass `true` so the model can
   * propose those tools and the approval callback can decide. The default is
   * `false` to preserve the conservative legacy behavior of only advertising
   * tools the model can execute without further prompting.
   */
  includePendingApproval?: boolean;
}

export function normalizeToolBridgePermissionMode(value: unknown): LocalPermissionMode {
  if (typeof value !== "string") {
    return "default";
  }

  return LEGACY_PERMISSION_MODE_MAP[value] ?? "default";
}

export function resolveToolPermission(
  tool: ToolDefinition,
  context: Pick<ToolExecutionContext, "permissionMode">,
): ToolPermissionDecision {
  const permissionMode = normalizeToolBridgePermissionMode(context.permissionMode);
  const isHardGated = HARD_APPROVAL_PERMISSIONS.has(tool.permission) || HARD_APPROVAL_RISKS.has(tool.risk);

  if (tool.permission === "diagnostic" || tool.risk === "diagnostic") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  if (permissionMode === "default") {
    return {
      allowed: false,
      reason: "Default permissions allow only diagnostic/read-only bridge tools without approval.",
      requiresApproval: true,
    };
  }

  if (permissionMode === "auto-review") {
    if ((tool.permission === "read-only" || tool.risk === "read") && !isHardGated) {
      return {
        allowed: true,
        requiresApproval: false,
      };
    }

    return {
      allowed: false,
      reason: "Auto-review still requires approval for mutating, terminal, external, credential, publish, or destructive tools.",
      requiresApproval: true,
    };
  }

  if (isHardGated) {
    return {
      allowed: false,
      reason: "Full access keeps hard circuit breakers for terminal, destructive, credential, publish, and outside-scope actions.",
      requiresApproval: true,
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
  };
}

export function filterToolsForPermission(
  tools: ToolDefinition[],
  context: Pick<ToolExecutionContext, "permissionMode">,
  options?: FilterToolsForPermissionOptions,
) {
  return tools.filter((tool) => {
    const decision = resolveToolPermission(tool, context);

    if (decision.allowed) {
      return true;
    }

    if (options?.includePendingApproval && decision.requiresApproval) {
      return true;
    }

    return false;
  });
}

export function toolBridgePermissionLabel(mode: LocalPermissionMode) {
  if (mode === "full-access") {
    return "Full access";
  }

  if (mode === "auto-review") {
    return "Auto-review";
  }

  return "Default permissions";
}
