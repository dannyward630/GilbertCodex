import {
  assign,
  createActor,
  createMachine,
  fromPromise,
  toPromise,
  type AnyStateMachine,
} from "xstate";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ChatArtifact, ChatSource, ChatToolCall } from "../../types/chat";
import type {
  LocalComputerToolCallResult,
  ParsedLocalComputerToolCall,
  ToolHandlerContext,
} from "../computer/executor/types";
import { limitToolCallOutput } from "../computer/executor/toolPresentation";
import type {
  WorkflowDefinition,
  WorkflowExecutionResult,
  WorkflowParallelStepDefinition,
  WorkflowPrimitiveStepDefinition,
  WorkflowRunRequest,
  WorkflowStepDefinition,
  WorkflowStepResult,
} from "./types";
import { getWorkflowPrimitive } from "./primitiveRegistry";
import { parseWorkflowRunRequest, selectWorkflowDefinition } from "./selector";

const MAX_WORKFLOW_STEP_OUTPUT_CHARS = 18_000;
const FINAL_STATE_KEY = "__workflowDone";

/**
 * Per-run accumulator the workflow machine writes to as steps complete. xstate
 * owns the control flow (sequence/parallel/branch); this struct is the
 * side-channel for evidence we need to surface back to the caller.
 */
interface WorkflowMachineContext {
  artifacts: ChatArtifact[];
  browserPreviewUrl?: string;
  fileChanges: NonNullable<ChatToolCall["fileChanges"]>;
  sources: ChatSource[];
  stepResults: WorkflowStepResult[];
}

interface PrimitiveActorInput {
  context: ToolHandlerContext;
  request: WorkflowRunRequest;
  step: WorkflowPrimitiveStepDefinition;
}

interface PrimitiveActorOutput {
  attempts: number;
  result?: LocalComputerToolCallResult;
  step: WorkflowPrimitiveStepDefinition;
  unavailableReason?: string;
}

export async function executeWorkflowRunTool(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const request = parseWorkflowRunRequest(call);
  const workflow = selectWorkflowDefinition(request);

  if (!context.executeWorkflowPrimitive) {
    return {
      content: "workflow_run skipped: this runtime did not provide a primitive workflow runner.",
      executed: false,
    };
  }

  const execution = await executeWorkflowDefinition(workflow, request, context);

  return {
    artifacts: execution.artifacts,
    browserPreviewUrl: execution.browserPreviewUrl,
    content: execution.content,
    executed: execution.executed,
    fileChanges: execution.fileChanges,
    is_error: execution.is_error,
    sources: execution.sources,
  };
}

export async function executeWorkflowDefinition(
  workflow: WorkflowDefinition,
  request: WorkflowRunRequest,
  context: ToolHandlerContext,
): Promise<WorkflowExecutionResult> {
  const machine = compileWorkflowMachine(workflow, request, context);
  const actor = createActor(machine);
  actor.start();
  const finalContext = (await toPromise(actor)) as WorkflowMachineContext;

  const hasRequiredError = finalContext.stepResults.some(
    (result: WorkflowStepResult) => result.status === "error" && !findStep(workflow.steps, result.id)?.optional,
  );

  return {
    artifacts: dedupeArtifacts(finalContext.artifacts),
    browserPreviewUrl: finalContext.browserPreviewUrl,
    content: formatWorkflowResult(workflow, request, finalContext.stepResults),
    executed: finalContext.stepResults.some((result) => result.status === "complete"),
    fileChanges: finalContext.fileChanges.length > 0 ? finalContext.fileChanges : undefined,
    is_error: hasRequiredError,
    sources: dedupeSources(finalContext.sources),
  };
}

function compileWorkflowMachine(
  workflow: WorkflowDefinition,
  request: WorkflowRunRequest,
  context: ToolHandlerContext,
): AnyStateMachine {
  const primitiveActor = fromPromise<PrimitiveActorOutput, PrimitiveActorInput>(async ({ input }) => {
    const { context: handlerContext, request: workflowRequest, step } = input;
    const primitive = getWorkflowPrimitive(step.tool);

    if (!primitive) {
      return { attempts: 1, step, unavailableReason: `${step.tool} is not registered as a workflow primitive.` };
    }

    const tools = normalizeToolRegistrySettings(handlerContext.toolSettings);
    const missing = primitive.requiredTools.filter((toolId) => !tools[toolId]);
    if (missing.length > 0) {
      return {
        attempts: 1,
        step,
        unavailableReason: `Skipped ${step.label}: ${missing.join(", ")} is disabled in Toolbox.`,
      };
    }

    const maxAttempts = Math.max(1, Math.floor(step.retry?.maxAttempts ?? 1));
    let lastResult: LocalComputerToolCallResult | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const call = createPrimitiveCall(step, workflowRequest);
      lastResult = await handlerContext.executeWorkflowPrimitive!(call, handlerContext);
      if (!lastResult.is_error) {
        return { attempts: attempt, result: lastResult, step };
      }
    }

    return { attempts: maxAttempts, result: lastResult, step };
  });

  const noteActor = fromPromise<PrimitiveActorOutput, PrimitiveActorInput>(async ({ input }) => {
    return { attempts: 1, step: input.step };
  });

  // The machine config is built dynamically from a WorkflowDefinition tree, so
  // xstate's compile-time type inference can't see the shape. We cast through
  // `any` here and rely on (a) the typed PrimitiveActorInput/Output contracts
  // around the actors, and (b) the workflow-layer.test.ts assertions to pin
  // down runtime correctness.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: any = {
    context: {
      artifacts: [],
      fileChanges: [],
      sources: [],
      stepResults: [],
    },
    initial: workflow.steps.length > 0 ? stepStateName(workflow.steps[0].id) : FINAL_STATE_KEY,
    states: buildStateMap(workflow.steps, FINAL_STATE_KEY),
    output: ({ context }: { context: WorkflowMachineContext }) => context,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createMachine(config, {
    actors: {
      primitive: primitiveActor,
      note: noteActor,
    },
  } as any) as AnyStateMachine;

  function buildStateMap(steps: WorkflowStepDefinition[], finalTarget: string): Record<string, unknown> {
    const states: Record<string, unknown> = {};
    states[FINAL_STATE_KEY] = { type: "final" };

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const next = i + 1 < steps.length ? stepStateName(steps[i + 1].id) : finalTarget;
      Object.assign(states, buildStepState(step, next, finalTarget));
    }

    return states;
  }

  function buildStepState(
    step: WorkflowStepDefinition,
    next: string,
    finalTarget: string,
  ): Record<string, unknown> {
    if (step.kind === "primitive" || step.kind === "verification") {
      return { [stepStateName(step.id)]: buildPrimitiveState(step, next) };
    }

    if (step.kind === "parallel") {
      return buildParallelStateGroup(step, next);
    }

    if (step.kind === "branch") {
      return buildBranchStateGroup(step, next, finalTarget);
    }

    if (step.kind === "approval_wait" || step.kind === "model_synthesis" || step.kind === "note") {
      return {
        [stepStateName(step.id)]: {
          invoke: {
            src: "note",
            input: () => ({ context, request, step: createNoteShimStep(step) }),
            onDone: {
              target: next,
              actions: assign({
                stepResults: ({ context: ctx }) => [
                  ...ctx.stepResults,
                  {
                    attempts: 1,
                    detail: step.detail,
                    id: step.id,
                    label: step.label,
                    output: step.detail,
                    status: step.kind === "approval_wait" ? "waiting_approval" : "complete",
                  } satisfies WorkflowStepResult,
                ],
              }),
            },
          },
        },
      };
    }

    // Unknown kind — record an error and continue.
    return {
      [stepStateName(step.id)]: {
        always: {
          target: next,
          actions: assign({
            stepResults: ({ context: ctx }) => [
              ...ctx.stepResults,
              {
                attempts: 1,
                detail: `Unknown workflow step kind: ${(step as WorkflowStepDefinition).kind}`,
                id: (step as WorkflowStepDefinition).id,
                label: (step as WorkflowStepDefinition).label,
                status: "error",
              } satisfies WorkflowStepResult,
            ],
          }),
        },
      },
    };
  }

  function buildPrimitiveState(step: WorkflowPrimitiveStepDefinition, next: string) {
    return {
      invoke: {
        src: "primitive",
        input: () => ({ context, request, step }),
        onDone: {
          target: next,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actions: assign((args: any) => {
            const ctx = args.context as WorkflowMachineContext;
            const output = (args.event as unknown as { output: PrimitiveActorOutput }).output;
            return mergePrimitiveOutput(ctx, output);
          }),
        },
        onError: {
          target: next,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actions: assign((args: any) => {
            const ctx = args.context as WorkflowMachineContext;
            const error = (args.event as unknown as { error: unknown }).error;
            return {
              ...ctx,
              stepResults: [
                ...ctx.stepResults,
                {
                  attempts: 1,
                  detail: error instanceof Error ? error.message : String(error),
                  id: step.id,
                  label: step.label,
                  status: step.optional ? "skipped" : "error",
                  tool: step.tool,
                } satisfies WorkflowStepResult,
              ],
            };
          }),
        },
      },
    };
  }

  function buildParallelStateGroup(step: WorkflowParallelStepDefinition, next: string): Record<string, unknown> {
    const regionStates: Record<string, unknown> = {};
    for (const child of step.steps) {
      const regionKey = `region_${child.id}`;
      regionStates[regionKey] = {
        initial: "running",
        states: {
          running: {
            invoke: {
              src: "primitive",
              input: () => ({ context, request, step: child }),
              onDone: {
                target: "done",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                actions: assign((args: any) => {
                  const ctx = args.context as WorkflowMachineContext;
                  const output = (args.event as unknown as { output: PrimitiveActorOutput }).output;
                  return mergePrimitiveOutput(ctx, output);
                }),
              },
              onError: {
                target: "done",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                actions: assign((args: any) => {
                  const ctx = args.context as WorkflowMachineContext;
                  const error = (args.event as unknown as { error: unknown }).error;
                  return {
                    ...ctx,
                    stepResults: [
                      ...ctx.stepResults,
                      {
                        attempts: 1,
                        detail: error instanceof Error ? error.message : String(error),
                        id: child.id,
                        label: child.label,
                        status: child.optional ? "skipped" : "error",
                        tool: child.tool,
                      } satisfies WorkflowStepResult,
                    ],
                  };
                }),
              },
            },
          },
          done: { type: "final" },
        },
      };
    }

    return {
      [stepStateName(step.id)]: {
        type: "parallel",
        states: regionStates,
        onDone: { target: next },
      },
    };
  }

  function buildBranchStateGroup(
    step: Extract<WorkflowStepDefinition, { kind: "branch" }>,
    next: string,
    finalTarget: string,
  ): Record<string, unknown> {
    const ifStates = buildSubFlow(step.ifSteps, `branch_${step.id}_done`, finalTarget, `branch_${step.id}_if_`);
    const elseStates = buildSubFlow(step.elseSteps ?? [], `branch_${step.id}_done`, finalTarget, `branch_${step.id}_else_`);
    const ifEntry = step.ifSteps.length > 0 ? `branch_${step.id}_if_${stepStateName(step.ifSteps[0].id)}` : `branch_${step.id}_done`;
    const elseEntry = (step.elseSteps?.length ?? 0) > 0 ? `branch_${step.id}_else_${stepStateName((step.elseSteps ?? [])[0].id)}` : `branch_${step.id}_done`;
    const branchTaken = evaluateBranchCondition(step, request, context);

    const states: Record<string, unknown> = {
      [stepStateName(step.id)]: {
        always: branchTaken ? { target: ifEntry } : { target: elseEntry },
      },
      [`branch_${step.id}_done`]: {
        always: {
          target: next,
          actions: assign({
            stepResults: ({ context: ctx }) => [
              ...ctx.stepResults,
              {
                attempts: 1,
                detail: branchTaken ? "branch matched" : "branch not matched",
                id: step.id,
                label: step.label,
                status: "complete",
              } satisfies WorkflowStepResult,
            ],
          }),
        },
      },
      ...ifStates,
      ...elseStates,
    };

    return states;
  }

  function buildSubFlow(
    steps: WorkflowStepDefinition[],
    finalTarget: string,
    rootFinalTarget: string,
    prefix: string,
  ): Record<string, unknown> {
    const states: Record<string, unknown> = {};

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const next = i + 1 < steps.length ? `${prefix}${stepStateName(steps[i + 1].id)}` : finalTarget;
      const built = buildStepState(step, next, rootFinalTarget);
      for (const [key, value] of Object.entries(built)) {
        states[`${prefix}${key}`] = rewriteTargets(value, prefix, finalTarget, rootFinalTarget);
      }
    }

    return states;
  }

  function rewriteTargets(node: unknown, prefix: string, branchFinal: string, rootFinal: string): unknown {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((entry) => rewriteTargets(entry, prefix, branchFinal, rootFinal));

    const entries = Object.entries(node as Record<string, unknown>);
    const rewritten: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (key === "target" && typeof value === "string") {
        // Leave region-internal targets ('done') and the final marker alone;
        // every other target is a state key on the workflow root that we
        // need to namespace into the branch sub-tree.
        if (value === "done" || value === FINAL_STATE_KEY || value === branchFinal || value === rootFinal) {
          rewritten[key] = value;
        } else if (value.startsWith("branch_")) {
          rewritten[key] = value;
        } else {
          rewritten[key] = `${prefix}${value}`;
        }
      } else {
        rewritten[key] = rewriteTargets(value, prefix, branchFinal, rootFinal);
      }
    }
    return rewritten;
  }

  function createNoteShimStep(step: Extract<WorkflowStepDefinition, { kind: "note" | "approval_wait" | "model_synthesis" }>): WorkflowPrimitiveStepDefinition {
    return {
      args: {},
      id: step.id,
      kind: "primitive",
      label: step.label,
      tool: "recall_context", // unused — note actor returns immediately.
    };
  }
}

function mergePrimitiveOutput(ctx: WorkflowMachineContext, output: PrimitiveActorOutput): WorkflowMachineContext {
  if (output.unavailableReason) {
    return {
      ...ctx,
      stepResults: [
        ...ctx.stepResults,
        {
          attempts: output.attempts,
          detail: output.unavailableReason,
          id: output.step.id,
          label: output.step.label,
          output: output.unavailableReason,
          status: output.step.optional ? "skipped" : "error",
          tool: output.step.tool,
        },
      ],
    };
  }

  if (!output.result) {
    return {
      ...ctx,
      stepResults: [
        ...ctx.stepResults,
        {
          attempts: output.attempts,
          detail: "No result was returned.",
          id: output.step.id,
          label: output.step.label,
          status: output.step.optional ? "skipped" : "error",
          tool: output.step.tool,
        },
      ],
    };
  }

  const result = output.result;
  const status: WorkflowStepResult["status"] = result.is_error
    ? "error"
    : result.executed
      ? "complete"
      : "skipped";

  return {
    artifacts: [...ctx.artifacts, ...(result.artifacts ?? [])],
    browserPreviewUrl: result.browserPreviewUrl ?? ctx.browserPreviewUrl,
    fileChanges: [...ctx.fileChanges, ...(result.fileChanges ?? [])],
    sources: [...ctx.sources, ...(result.sources ?? [])],
    stepResults: [
      ...ctx.stepResults,
      {
        attempts: output.attempts,
        detail: result.errorCode,
        id: output.step.id,
        label: output.step.label,
        output: limitToolCallOutput(result.content, MAX_WORKFLOW_STEP_OUTPUT_CHARS),
        status,
        tool: output.step.tool,
      },
    ],
  };
}

function createPrimitiveCall(step: WorkflowPrimitiveStepDefinition, request: WorkflowRunRequest): ParsedLocalComputerToolCall {
  const args = Object.fromEntries(
    Object.entries(step.args ?? {}).map(([key, value]) => [key, materializeWorkflowValue(value, request)]),
  );

  return {
    args,
    raw: `workflow:${step.id}`,
    tool: step.tool,
  };
}

function evaluateBranchCondition(
  step: Extract<WorkflowStepDefinition, { kind: "branch" }>,
  request: WorkflowRunRequest,
  context: ToolHandlerContext,
) {
  if (step.when.toolEnabled) {
    return Boolean(normalizeToolRegistrySettings(context.toolSettings)[step.when.toolEnabled]);
  }

  if (step.when.input) {
    const value = String(request.inputs[step.when.input] ?? "");
    return step.when.matches ? new RegExp(step.when.matches, "i").test(value) : Boolean(value.trim());
  }

  return false;
}

function materializeWorkflowValue(value: string, request: WorkflowRunRequest) {
  return value
    .replace(/\{\{\s*goal\s*\}\}/g, request.goal)
    .replace(/\{\{\s*mode\s*\}\}/g, request.mode)
    .replace(/\{\{\s*input\.([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, key: string) => String(request.inputs[key] ?? ""));
}

function formatWorkflowResult(workflow: WorkflowDefinition, request: WorkflowRunRequest, stepResults: WorkflowStepResult[]) {
  const lines = [
    "WORKFLOW RUN RESULTS",
    `Workflow: ${workflow.title} (${workflow.id}@v${workflow.version})`,
    `Mode: ${request.mode}`,
    `Goal: ${request.goal}`,
    "",
    "Steps:",
    ...stepResults.map((result, index) => formatStepResult(index + 1, result)),
    "",
    "Success criteria:",
    ...workflow.successCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Next action:",
    "Use these workflow results as evidence. If code, terminal, Git, GitHub, MCP, or file mutations are still needed, continue with the guarded primitive tools and approval policy.",
  ];

  return lines.join("\n");
}

function formatStepResult(index: number, result: WorkflowStepResult) {
  const heading = `${index}. [${result.status}] ${result.label}${result.tool ? ` (${result.tool})` : ""}${result.attempts > 1 ? ` after ${result.attempts} attempts` : ""}`;
  const detail = [result.detail, result.output].filter(Boolean).join("\n");
  return detail ? `${heading}\n${detail}` : heading;
}

function findStep(steps: WorkflowStepDefinition[], id: string): WorkflowPrimitiveStepDefinition | undefined {
  for (const step of steps) {
    if ((step.kind === "primitive" || step.kind === "verification") && step.id === id) {
      return step;
    }

    if (step.kind === "parallel") {
      const found = findStep(step.steps as WorkflowStepDefinition[], id);
      if (found) return found;
    }

    if (step.kind === "branch") {
      const found = findStep([...step.ifSteps, ...(step.elseSteps ?? [])], id);
      if (found) return found;
    }
  }

  return undefined;
}

function stepStateName(id: string) {
  return `step_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function dedupeSources(sources: ChatSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.title}|${source.url}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeArtifacts(artifacts: ChatArtifact[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = artifact.id || `${artifact.title}|${artifact.mimeType}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
