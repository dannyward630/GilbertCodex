import { formatColorLookupResult } from "../../../color";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall } from "../types";

export async function executeColorHandler(call: ParsedLocalComputerToolCall): Promise<LocalComputerToolCallResult> {
  return {
    content: await formatColorLookupResult(call.args),
    executed: true,
  };
}
