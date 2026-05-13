import test from "node:test";
import assert from "node:assert/strict";
import { createMachine } from "xstate";
import { getToolSchema, selectNativeToolNames } from "../src/services/toolSchemaAdapters.ts";
import { createRuntimeToolPrompt } from "../src/prompts/agent/runtimeToolPrompt.ts";
import { DEFAULT_TOOL_REGISTRY_SETTINGS } from "../src/types/tools.ts";
import type { ProviderSettings } from "../src/types/settings.ts";
import { hasRegisteredToolHandler } from "../src/tools/computer/executor/registry.ts";
import { normalizeToolName } from "../src/tools/computer/executor/toolNames.ts";
import type { ParsedLocalComputerToolCall, ToolHandlerContext } from "../src/tools/computer/executor/types.ts";
import {
  executeWorkflowDefinition,
  listWorkflowDefinitions,
  listWorkflowPrimitiveNames,
  parseWorkflowRunRequest,
  routePrimitiveEvidenceBatchToWorkflow,
  selectWorkflowDefinition,
} from "../src/tools/workflows/index.ts";
import type { WorkflowDefinition, WorkflowStepDefinition } from "../src/tools/workflows/types.ts";

function providerSettings(tools = DEFAULT_TOOL_REGISTRY_SETTINGS): ProviderSettings {
  return {
    apiBaseUrls: {},
    apiKeys: {},
    mcp: { enabled: false, servers: [] },
    models: {},
    provider: "openai",
    reasoning: "standard",
    thinking: "standard",
    tools,
  } as unknown as ProviderSettings;
}

function workflowPrimitiveSteps(steps: WorkflowStepDefinition[]): Array<Extract<WorkflowStepDefinition, { kind: "primitive" | "verification" }>> {
  const output: Array<Extract<WorkflowStepDefinition, { kind: "primitive" | "verification" }>> = [];

  for (const step of steps) {
    if (step.kind === "primitive" || step.kind === "verification") {
      output.push(step);
    } else if (step.kind === "parallel") {
      output.push(...workflowPrimitiveSteps(step.steps));
    } else if (step.kind === "branch") {
      output.push(...workflowPrimitiveSteps(step.ifSteps));
      output.push(...workflowPrimitiveSteps(step.elseSteps ?? []));
    }
  }

  return output;
}

test("workflow_run is registered as a native schema with workflow ids", () => {
  const schema = getToolSchema("workflow_run");

  assert.ok(schema, "workflow_run schema must exist");
  assert.equal(schema!.parameters.type, "object");
  assert.deepEqual(schema!.parameters.required, ["goal"]);
  assert.equal(schema!.parameters.properties.goal.type, "string");
  assert.equal(schema!.parameters.properties.inputs.type, "object");
  assert.ok(schema!.parameters.properties.workflow_id.enum?.includes("plan-patch-verify"));
});

test("workflow_run is model-visible only when workflow automation is enabled", () => {
  assert.ok(selectNativeToolNames(providerSettings()).includes("workflow_run"));

  const disabledTools = {
    ...DEFAULT_TOOL_REGISTRY_SETTINGS,
    workflowAutomation: false,
  };
  assert.equal(selectNativeToolNames(providerSettings(disabledTools)).includes("workflow_run"), false);
});

test("workflow aliases normalize to workflow_run", () => {
  assert.equal(normalizeToolName("workflow_run", { goal: "inspect repo" }), "workflow_run");
  assert.equal(normalizeToolName("workflow.start", { goal: "prepare PR", workflow_id: "branch-pr-prep" }), "workflow_run");
  assert.equal(normalizeToolName("function", { goal: "research and patch", mode: "plan", query: "current docs" }), "workflow_run");
});

test("workflow definitions only reference registered primitive handlers", () => {
  const primitiveNames = new Set(listWorkflowPrimitiveNames());

  for (const workflow of listWorkflowDefinitions()) {
    assert.ok(workflow.id, "workflow needs id");
    assert.ok(workflow.title, `${workflow.id} needs title`);
    assert.ok(workflow.successCriteria.length > 0, `${workflow.id} needs success criteria`);

    for (const step of workflowPrimitiveSteps(workflow.steps)) {
      assert.ok(primitiveNames.has(step.tool), `${workflow.id}/${step.id} references unknown primitive ${step.tool}`);
      assert.equal(hasRegisteredToolHandler(step.tool), true, `${workflow.id}/${step.id} primitive ${step.tool} needs executor handler`);
    }
  }
});

test("workflow selector honors explicit workflow_id and falls back from goal hints", () => {
  const explicit = parseWorkflowRunRequest({
    args: {
      goal: "Prepare this branch for a pull request",
      workflow_id: "branch-pr-prep",
    },
    raw: "",
    tool: "workflow_run",
  });

  assert.equal(selectWorkflowDefinition(explicit).id, "branch-pr-prep");

  const inferred = parseWorkflowRunRequest({
    args: {
      goal: "Use official docs and research this API before patching the app",
    },
    raw: "",
    tool: "workflow_run",
  });

  assert.equal(selectWorkflowDefinition(inferred).id, "research-backed-patch");
});

test("workflow prompt does not teach goal-level tasks to spray read_file calls", () => {
  const prompt = createRuntimeToolPrompt({
    hasLocalComputerContext: false,
    hasWebContext: false,
    latestUserPrompt: "fix this repo bug and patch the app",
    selectedChunkIds: new Set(),
    settings: providerSettings(),
  });

  assert.match(prompt, /start with one workflow_run call/i);
  assert.match(prompt, /Do not begin these tasks by spraying many read_file\/list_directory calls/);
  assert.doesNotMatch(prompt, /batched independent calls example/);
});

test("primitive read sprays route to workflow_run when workflow automation is enabled", () => {
  const primitiveBatch = [
    "<tool_call>",
    "list_directory",
    "<arg_key>path</arg_key><arg_value>C:\\repo</arg_value>",
    "</tool_call>",
    "<tool_call>",
    "read_file",
    "<arg_key>path</arg_key><arg_value>C:\\repo\\package.json</arg_value>",
    "</tool_call>",
    "<tool_call>",
    "read_file",
    "<arg_key>path</arg_key><arg_value>C:\\repo\\src\\App.tsx</arg_value>",
    "</tool_call>",
  ].join("\n");
  const routed = routePrimitiveEvidenceBatchToWorkflow(
    primitiveBatch,
    "fix this repo bug and patch the app",
    DEFAULT_TOOL_REGISTRY_SETTINGS,
  );

  assert.match(routed, /workflow_run/);
  assert.match(routed, /workflow_id<\/arg_key><arg_value>plan-patch-verify/);
  assert.doesNotMatch(routed, /read_file/);
});

test("primitive read sprays stay direct when workflow automation is disabled", () => {
  const disabledTools = {
    ...DEFAULT_TOOL_REGISTRY_SETTINGS,
    workflowAutomation: false,
  };
  const primitiveBatch = [
    "<tool_call>",
    "list_directory",
    "<arg_key>path</arg_key><arg_value>C:\\repo</arg_value>",
    "</tool_call>",
    "<tool_call>",
    "read_file",
    "<arg_key>path</arg_key><arg_value>C:\\repo\\package.json</arg_value>",
    "</tool_call>",
    "<tool_call>",
    "read_file",
    "<arg_key>path</arg_key><arg_value>C:\\repo\\src\\App.tsx</arg_value>",
    "</tool_call>",
  ].join("\n");

  assert.equal(
    routePrimitiveEvidenceBatchToWorkflow(primitiveBatch, "fix this repo bug", disabledTools),
    primitiveBatch,
  );
});

test("xstate is the runtime: createMachine is callable from this codebase", () => {
  // Sanity check that the workflow engine's library dependency is real and
  // produces a recognizable state machine, not a hand-rolled mock.
  const machine = createMachine({
    id: "smoke",
    initial: "ready",
    states: { ready: { type: "final" } },
  });
  assert.equal(typeof (machine as unknown as { transition?: unknown }).transition, "function");
  assert.equal(typeof (machine as unknown as { getInitialSnapshot?: unknown }).getInitialSnapshot, "function");
});

test("workflow engine sequences primitives, parallel steps, branch steps, and retry reporting", async () => {
  const calls: ParsedLocalComputerToolCall[] = [];
  let retryAttempts = 0;
  const workflow: WorkflowDefinition = {
    description: "Test workflow",
    id: "test-workflow",
    mutates: false,
    requiredTools: ["fileSearch"],
    steps: [
      {
        args: { query: "{{goal}}" },
        id: "search",
        kind: "primitive",
        label: "Search",
        tool: "search_files",
      },
      {
        id: "parallel",
        kind: "parallel",
        label: "Parallel",
        steps: [
          { args: { path: "package.json" }, id: "read-package", kind: "primitive", label: "Read package", tool: "read_file" },
          { args: { path: "README.md" }, id: "read-readme", kind: "primitive", label: "Read readme", optional: true, tool: "read_file" },
        ],
      },
      {
        args: { query: "retry" },
        id: "retry",
        kind: "primitive",
        label: "Retry",
        retry: { maxAttempts: 2 },
        tool: "search_files",
      },
      {
        id: "branch",
        ifSteps: [
          { args: { query: "docs" }, id: "web", kind: "primitive", label: "Web", optional: true, tool: "web_search" },
        ],
        kind: "branch",
        label: "Branch",
        when: { toolEnabled: "webSearch" },
      },
    ],
    successCriteria: ["Returns step output"],
    title: "Test Workflow",
    triggerHints: ["test"],
    version: 1,
  };
  const context: ToolHandlerContext = {
    executeWorkflowPrimitive: async (call) => {
      calls.push(call);
      if (call.args.query === "retry" && retryAttempts === 0) {
        retryAttempts += 1;
        return { content: "temporary failure", executed: true, is_error: true };
      }
      return { content: `ok ${call.tool}`, executed: true };
    },
    roots: ["C:\\repo"],
    settings: {} as ToolHandlerContext["settings"],
    toolSettings: DEFAULT_TOOL_REGISTRY_SETTINGS,
    userPrompt: "test",
    webSearchMaxResults: 6,
    webSearchSettings: {} as ToolHandlerContext["webSearchSettings"],
  };

  const result = await executeWorkflowDefinition(
    workflow,
    { approvalPolicy: "inherit", goal: "inspect repo", inputs: {}, mode: "plan" },
    context,
  );

  assert.equal(result.executed, true);
  assert.equal(result.is_error, false);
  assert.match(result.content, /WORKFLOW RUN RESULTS/);
  assert.deepEqual(calls.map((call) => call.tool), ["search_files", "read_file", "read_file", "search_files", "search_files", "web_search"]);
});

test("workflow engine surfaces unavailable primitives via tool-disabled gate", async () => {
  const disabledTools = { ...DEFAULT_TOOL_REGISTRY_SETTINGS, webSearch: false };
  const workflow: WorkflowDefinition = {
    description: "Web-only workflow",
    id: "web-only",
    mutates: false,
    requiredTools: ["webSearch"],
    steps: [
      { args: { query: "{{goal}}" }, id: "web", kind: "primitive", label: "Web", tool: "web_search" },
    ],
    successCriteria: ["Returns step output"],
    title: "Web only",
    triggerHints: ["web"],
    version: 1,
  };
  let invoked = 0;
  const context: ToolHandlerContext = {
    executeWorkflowPrimitive: async () => {
      invoked += 1;
      return { content: "should not run", executed: true };
    },
    roots: ["C:\\repo"],
    settings: {} as ToolHandlerContext["settings"],
    toolSettings: disabledTools,
    userPrompt: "test",
    webSearchMaxResults: 6,
    webSearchSettings: {} as ToolHandlerContext["webSearchSettings"],
  };

  const result = await executeWorkflowDefinition(
    workflow,
    { approvalPolicy: "inherit", goal: "research", inputs: {}, mode: "plan" },
    context,
  );

  assert.equal(invoked, 0, "primitive must not be invoked when its required tool is disabled");
  assert.equal(result.is_error, true);
  assert.match(result.content, /webSearch is disabled/);
});
