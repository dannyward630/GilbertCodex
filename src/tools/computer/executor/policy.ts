const MAX_LOCAL_TOOL_CALLS_PER_PASS = 12;
const MAX_PARALLEL_LOCAL_TOOL_CALLS_PER_PASS = 8;
export const MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS = 4;
export const MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS = 12;
const MAX_DEEP_RESEARCH_SOURCE_FILE_MUTATIONS_PER_PASS = 20;
const MAX_TOOL_CALL_SCAN_CHARS: number | null = null;
const MAX_TOOL_RESULTS_CHARS = 220_000;
const MAX_TOOL_CALL_OUTPUT_CHARS = 220_000;
export const MAX_TOOL_INPUT_PREVIEW_CHARS = 12_000;

/**
 * Runtime guardrails for parsing and executing model-emitted local tool calls.
 *
 * Standard chat and Deep Research keep enough room for real work while
 * bounding model-visible observations so one huge tool result cannot exceed
 * the selected provider's context window.
 */
export interface LocalComputerToolExecutionPolicy {
  maxCallsPerPass: number | null;
  maxParallelCallsPerPass?: number | null;
  maxParallelMutationsPerPass?: number | null;
  maxSourceFileMutationsPerPass?: number | null;
  maxToolCallOutputChars: number | null;
  maxToolResultsChars: number | null;
  scanFromEndChars: number | null;
}

export const STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: MAX_LOCAL_TOOL_CALLS_PER_PASS,
  maxParallelCallsPerPass: MAX_PARALLEL_LOCAL_TOOL_CALLS_PER_PASS,
  maxParallelMutationsPerPass: MAX_PARALLEL_LOCAL_TOOL_MUTATIONS_PER_PASS,
  maxSourceFileMutationsPerPass: MAX_LOCAL_SOURCE_FILE_MUTATIONS_PER_PASS,
  maxToolCallOutputChars: MAX_TOOL_CALL_OUTPUT_CHARS,
  maxToolResultsChars: MAX_TOOL_RESULTS_CHARS,
  scanFromEndChars: MAX_TOOL_CALL_SCAN_CHARS,
};

export const DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {
  maxCallsPerPass: null,
  maxParallelCallsPerPass: 10,
  maxParallelMutationsPerPass: 6,
  maxSourceFileMutationsPerPass: MAX_DEEP_RESEARCH_SOURCE_FILE_MUTATIONS_PER_PASS,
  maxToolCallOutputChars: null,
  maxToolResultsChars: null,
  scanFromEndChars: null,
};
