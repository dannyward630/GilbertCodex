import type { ToolBridgeProviderFormat, ProviderToolBridgeOptions } from "../types";
import { isToolCompatibleWithProvider } from "../registry";
import { applyAnthropicToolBridge } from "./anthropic";
import { applyOpenAiCompatibleToolBridge } from "./openAiCompatible";
import { applyResponsesToolBridge } from "./responses";

/**
 * Apply tool-bridge state (advertised tools + prior tool results) to a
 * provider request body that's about to be sent.
 *
 * Calling contract:
 * - `options.tools` is filtered by the provider format before reaching the
 *   per-format adapter.
 * - `options.toolResultMessages` is rendered as an assistant→tool pair for
 *   each result. By default the adapter synthesizes the assistant turn that
 *   originally emitted the tool_call(s); callers whose message history
 *   already contains those assistant turns must set
 *   `resultsHistoryAlreadyContainsAssistantTurns: true` to avoid duplication.
 * - `toolChoice: "none"` is propagated to the provider explicitly so callers
 *   can disable tool use mid-conversation even when the model has called
 *   tools previously.
 */
export function applyToolBridgeToProviderRequest(
  body: Record<string, unknown>,
  providerFormat: ToolBridgeProviderFormat,
  options: ProviderToolBridgeOptions | undefined,
) {
  if (
    !options ||
    ((!options.tools || options.tools.length === 0) &&
      (!options.toolResultMessages || options.toolResultMessages.length === 0) &&
      options.toolChoice !== "none")
  ) {
    return body;
  }

  const bridgeOptions: ProviderToolBridgeOptions = {
    ...options,
    tools: (options.tools ?? []).filter((tool) => isToolCompatibleWithProvider(tool, providerFormat)),
  };

  if (providerFormat === "anthropic-messages") {
    return applyAnthropicToolBridge(body, bridgeOptions);
  }

  if (providerFormat === "openai-responses") {
    return applyResponsesToolBridge(body, bridgeOptions);
  }

  return applyOpenAiCompatibleToolBridge(body, bridgeOptions);
}
