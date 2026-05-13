import { firstArg } from "../argHelpers";
import { isRecord } from "../parser";
import type {
  LocalComputerToolCallResult,
  LocalSubagentResult,
  LocalSubagentTask,
  ParsedLocalComputerToolCall,
  ToolHandlerContext,
} from "../types";

export async function executeSubagentsHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (!context.onRunSubagents) {
    return {
      content: "run_subagents skipped: no sub-agent runner is available in this app context.",
      executed: false,
    };
  }

  const tasks = parseSubagentTasks(call.args);

  if (tasks.length === 0) {
    return {
      content: "run_subagents skipped: provide tasks_json or task.",
      executed: false,
    };
  }

  const results = await context.onRunSubagents(tasks);

  return {
    content: formatSubagentResults(results),
    executed: results.length > 0,
  };
}

export function parseSubagentTasks(args: Record<string, string>): LocalSubagentTask[] {
  const rawTasks = firstArg(args, ["tasks_json", "tasks", "agents"]);

  if (rawTasks) {
    try {
      const parsed = JSON.parse(rawTasks) as unknown;
      const items = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : [];
      return items.flatMap((item, index) => normalizeSubagentTask(item, index));
    } catch {
      return [];
    }
  }

  const task = firstArg(args, ["task", "prompt", "body", "description"]);

  if (!task) {
    return [];
  }

  return [
    {
      id: firstArg(args, ["id"]) || "task-1",
      prompt: task,
      title: firstArg(args, ["title", "name"]) || "Parallel task",
    },
  ];
}

function normalizeSubagentTask(item: unknown, index: number): LocalSubagentTask[] {
  if (typeof item === "string") {
    return [
      {
        id: `task-${index + 1}`,
        prompt: item,
        title: `Parallel task ${index + 1}`,
      },
    ];
  }

  if (!isRecord(item)) {
    return [];
  }

  const prompt = typeof item.prompt === "string"
    ? item.prompt
    : typeof item.body === "string"
      ? item.body
      : typeof item.description === "string"
        ? item.description
        : "";

  if (!prompt.trim()) {
    return [];
  }

  return [
    {
      id: typeof item.id === "string" && item.id.trim() ? item.id : `task-${index + 1}`,
      prompt,
      title: typeof item.title === "string" && item.title.trim() ? item.title : `Parallel task ${index + 1}`,
    },
  ];
}

function formatSubagentResults(results: LocalSubagentResult[]) {
  return [
    "SUB-AGENT RESULTS",
    `Completed: ${results.length}`,
    ...results.map((result, index) =>
      [
        "",
        `SUB-AGENT ${index + 1}: ${result.title}`,
        result.error ? `Error: ${result.error}` : result.content,
      ].join("\n"),
    ),
  ].join("\n");
}
