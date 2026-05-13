import type { ChatArtifact, ChatToolCall } from "../../../types/chat";
import { limitInlineValue } from "./argHelpers";
import type {
  LocalComputerToolCallResult,
  LocalComputerToolRecoverableFailure,
  LocalToolFailureRecovery,
  LocalToolFailureRecoveryKind,
  ParsedLocalComputerToolCall,
} from "./types";

export type ToolSectionStatus = "complete" | "skipped" | "error" | "waiting_approval" | "reused";

export function formatToolResultSection(callNumber: number, tool: string, status: ToolSectionStatus, body: string) {
  const marker = status === "complete" ? "[ok]" : `[${status}]`;
  return `\nTOOL ${callNumber} ${marker}: ${tool}\n${body}`;
}

export function resolveToolSectionStatus(result: LocalComputerToolCallResult): ToolSectionStatus {
  if (result.is_error === true) {
    return "error";
  }
  return result.executed ? "complete" : "skipped";
}

export function recoverableToolFailure(
  recoveryKind: LocalToolFailureRecoveryKind,
  retryInstruction: string,
): LocalToolFailureRecovery {
  return {
    recoverable: true,
    recoveryKind,
    retryInstruction,
  };
}

export function appendRecoveryMetadata(content: string, recovery?: LocalToolFailureRecovery) {
  if (!recovery) {
    return content;
  }

  return [
    content,
    "",
    "RECOVERABLE_TOOL_FAILURE",
    "recoverable: true",
    `recoveryKind: ${recovery.recoveryKind}`,
    `retryInstruction: ${recovery.retryInstruction}`,
  ].join("\n");
}

export function createRecoverableFailureRecord(
  call: ParsedLocalComputerToolCall,
  callNumber: number,
  output: string,
  recovery?: LocalToolFailureRecovery,
): LocalComputerToolRecoverableFailure | undefined {
  if (!recovery) {
    return undefined;
  }

  return {
    ...recovery,
    callNumber,
    output: limitInlineValue(output, 4_000),
    tool: call.tool,
  };
}

export function dedupeArtifacts(artifacts: ChatArtifact[]) {
  const seen = new Set<string>();
  const deduped: ChatArtifact[] = [];

  for (const artifact of artifacts) {
    const key = artifact.id || `${artifact.title}:${artifact.url ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(artifact);
  }

  return deduped;
}

export function buildPreviousCompletedMap(previousToolCalls: ChatToolCall[] | undefined) {
  const map = new Map<number, ChatToolCall>();

  if (!previousToolCalls || previousToolCalls.length === 0) {
    return map;
  }

  for (const toolCall of previousToolCalls) {
    if (toolCall.status !== "complete") {
      continue;
    }

    const callNumber = extractStampedCallNumber(toolCall.id);

    if (callNumber === null) {
      continue;
    }

    if (!map.has(callNumber)) {
      map.set(callNumber, toolCall);
    }
  }

  return map;
}

function extractStampedCallNumber(id: string): number | null {
  const stamped = id.match(/-local-tool-(\d+)$/);

  if (stamped) {
    return Number(stamped[1]);
  }

  const unstamped = id.match(/^local-tool-(\d+)$/);

  if (unstamped) {
    return Number(unstamped[1]);
  }

  return null;
}
