import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

interface ResponsesFunctionCall {
  arguments?: string;
  call_id?: string;
  id?: string;
  name?: string;
  type?: string;
}

export function parseResponsesToolCalls(payload: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const output = Array.isArray((payload as { output?: unknown })?.output) ? ((payload as { output: ResponsesFunctionCall[] }).output) : [];

  return output.flatMap((item, index) => {
    if (item.type !== "function_call") {
      return [];
    }

    const parsed = createToolCallRequest(provider, item.call_id ?? item.id, item.name, item.arguments, item);
    return parsed ? [{ ...parsed, id: parsed.id || `function-call-${index + 1}` }] : [];
  });
}

export function parseResponsesStreamToolCalls(event: unknown, provider: ModelProviderId): ToolCallRequest[] {
  const payload = event as {
    item?: ResponsesFunctionCall;
    response?: unknown;
    type?: string;
  };

  if (payload.response) {
    return parseResponsesToolCalls(payload.response, provider);
  }

  if (payload.item?.type === "function_call") {
    const parsed = createToolCallRequest(provider, payload.item.call_id ?? payload.item.id, payload.item.name, payload.item.arguments, payload.item);
    return parsed ? [parsed] : [];
  }

  return [];
}
