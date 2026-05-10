import type { ChatMessage, ChatPlanningInputAnswer, ChatPlanningInputRequest, ChatPlanningQuestion, ChatPlanningQuestionOption, ChatProgressItem } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { sendProviderMessage, streamProviderMessage } from "./modelProviderClient";

export const DEFAULT_PLANNING_MAX_PASSES = 10;
const MIN_PLANNING_PASSES = 2;
const PLANNING_BATCH_SIZE = 3;
const PLAN_STATUS_PATTERN = /^\s*(?:[-*+]\s*)?(?:[*_`~]+)?\s*PLAN_STATUS\s*:\s*(final|continue)\s*(?:[*_`~]+)?\s*$/gim;
const PASS_HEADER_PATTERN = /^\s*(?:#{1,4}\s*)?PASS\s+(\d+)\s*(?:[-:]\s*(.+?))?\s*$/i;
const END_PASS_PATTERN = /^\s*END_PASS\s*$/i;
const MAX_PLANNING_QUESTIONS = 3;
const MAX_PLANNING_OPTIONS = 3;

interface PlanningStage {
  detail: string;
  focus: string;
  label: string;
}

interface PlanningRunOptions {
  maxPasses: number;
  messages: ChatMessage[];
  onUpdate: (snapshot: PlanningSnapshot) => void;
  signal?: AbortSignal;
  settings: ProviderSettings;
}

interface PlanningRequestOptions {
  signal?: AbortSignal;
}

export interface PlanningSnapshot {
  content?: string;
  passCount: number;
  progress: ChatProgressItem[];
  trace?: string;
}

export interface PlanningRunResult extends PlanningSnapshot {
  content: string;
}

interface CleanPlanningResponse {
  content: string;
  final: boolean;
}

interface PlanningBatchStage {
  pass: number;
  stage: PlanningStage;
}

interface ParsedPlanningBatch {
  final: boolean;
  notes: string[];
}

interface PlanningInputDecisionPayload {
  detail?: unknown;
  needsInput?: unknown;
  questions?: unknown;
  title?: unknown;
}

interface PlanningQuestionPayload {
  id?: unknown;
  options?: unknown;
  placeholder?: unknown;
  question?: unknown;
  required?: unknown;
}

interface PlanningQuestionOptionPayload {
  description?: unknown;
  id?: unknown;
  label?: unknown;
}

const PLANNING_STAGES: PlanningStage[] = [
  {
    detail: "Goal, scope, constraints",
    focus: "Clarify the user's goal, non-goals, constraints, assumptions, and what would make the answer useful.",
    label: "Scope",
  },
  {
    detail: "User-facing behavior",
    focus: "Plan the user experience, states, interactions, copy, and what the user should see while work is happening.",
    label: "Experience",
  },
  {
    detail: "System shape",
    focus: "Plan the data flow, components, services, state ownership, APIs, and integration points.",
    label: "Architecture",
  },
  {
    detail: "Ordered work",
    focus: "Break the work into concrete implementation steps in the safest order.",
    label: "Execution",
  },
  {
    detail: "Risks and gaps",
    focus: "Identify likely failure modes, ambiguous areas, edge cases, and product risks.",
    label: "Risks",
  },
  {
    detail: "Quality checks",
    focus: "Plan verification, tests, visual checks, and acceptance criteria.",
    label: "Validation",
  },
  {
    detail: "Polish and ergonomics",
    focus: "Plan responsive behavior, accessibility, copy fit, polish, and small UX details that prevent rough edges.",
    label: "Polish",
  },
  {
    detail: "Future hooks",
    focus: "Plan extension points for future coding, tools, web access, persistence, and long-running workflows without implementing them yet.",
    label: "Extensibility",
  },
  {
    detail: "Tradeoffs",
    focus: "Compare alternatives and record the chosen direction with concise rationale.",
    label: "Tradeoffs",
  },
  {
    detail: "Final checklist",
    focus: "Check that the plan is coherent, complete, non-contradictory, and ready to synthesize.",
    label: "Readiness",
  },
];

export async function createPlanningInputRequest(
  settings: ProviderSettings,
  messages: ChatMessage[],
  options: PlanningRequestOptions = {},
): Promise<ChatPlanningInputRequest | null> {
  const response = await sendProviderMessage(createPlanningInputSettings(settings), createPlanningInputMessages(messages), {
    signal: options.signal,
  });
  const payload = parsePlanningInputDecision(response.content);

  if (!payload?.needsInput || !Array.isArray(payload.questions)) {
    return null;
  }

  const questions = payload.questions.flatMap((question, index) => normalizePlanningQuestion(question, index)).slice(0, MAX_PLANNING_QUESTIONS);

  if (questions.length === 0) {
    return null;
  }

  return {
    detail: normalizeShortText(payload.detail),
    id: createPlanningInputRequestId(),
    questions,
    requestedAt: new Date().toISOString(),
    title: normalizeShortText(payload.title) || "A few choices would help",
  };
}

export async function runPlanningMode({ maxPasses, messages, onUpdate, signal, settings }: PlanningRunOptions): Promise<PlanningRunResult> {
  const boundedMaxPasses = clampPlanningPasses(maxPasses);
  const passNotes: string[] = [];
  let completedPasses = 0;

  while (completedPasses < boundedMaxPasses) {
    const batchStages = createPlanningBatchStages(completedPasses + 1, boundedMaxPasses);
    const activePass = batchStages[0]?.pass ?? completedPasses + 1;

    onUpdate({
      passCount: completedPasses,
      progress: createPlanningProgress(activePass, boundedMaxPasses, "active"),
      trace: createPlanningTrace(passNotes),
    });

    const response = await sendProviderMessage(createPlanningSettings(settings), createPlanningMessages(messages, passNotes, batchStages, boundedMaxPasses), {
      signal,
    });
    const parsedBatch = parsePlanningBatchResponse(response.content, batchStages);

    for (const [index, stageItem] of batchStages.entries()) {
      const note = parsedBatch.notes[index] || "No note returned.";

      completedPasses = stageItem.pass;
      passNotes.push(formatPlanningPassTrace(note, stageItem.pass, stageItem.stage));

      const canStop = completedPasses >= Math.min(MIN_PLANNING_PASSES, boundedMaxPasses) && parsedBatch.final;
      onUpdate({
        passCount: completedPasses,
        progress: createPlanningProgress(completedPasses, boundedMaxPasses, canStop || completedPasses === boundedMaxPasses ? "finalizing" : "between"),
        trace: createPlanningTrace(passNotes),
      });

      await waitForUiTick();
    }

    if (completedPasses >= Math.min(MIN_PLANNING_PASSES, boundedMaxPasses) && parsedBatch.final) {
      break;
    }
  }

  onUpdate({
    passCount: completedPasses,
    progress: createPlanningProgress(completedPasses, boundedMaxPasses, "finalizing"),
    trace: createPlanningTrace(passNotes),
  });

  let finalContent = "";

  const finalResponse = await streamProviderMessage(
    createFinalAnswerSettings(settings),
    createFinalAnswerMessages(messages, passNotes, completedPasses, boundedMaxPasses),
    (snapshot) => {
      finalContent = snapshot.content;
      onUpdate({
        content: cleanFinalAnswerContent(finalContent),
        passCount: completedPasses,
        progress: createPlanningProgress(completedPasses, boundedMaxPasses, "finalizing"),
        trace: createPlanningTrace(passNotes),
      });
    },
    {
      signal,
    },
  );
  const planningBrief = createPlanningTrace(passNotes) ?? "";
  const content = cleanFinalAnswerContent(finalResponse.content || finalContent) || planningBrief || "I could not produce a finished answer from the model response.";

  return {
    content,
    passCount: completedPasses,
    progress: createPlanningProgress(completedPasses, boundedMaxPasses, "complete"),
    trace: createPlanningTrace(passNotes),
  };
}

export function clampPlanningPasses(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PLANNING_MAX_PASSES;
  }

  return Math.min(Math.max(Math.round(value), 1), DEFAULT_PLANNING_MAX_PASSES);
}

export function createPlanningProgress(currentPass: number, maxPasses: number, phase: "active" | "between" | "complete" | "finalizing" | "input"): ChatProgressItem[] {
  const boundedMaxPasses = clampPlanningPasses(maxPasses);
  const boundedCurrentPass = Math.min(Math.max(Math.round(currentPass), 0), boundedMaxPasses);
  const displayPass = Math.min(Math.max(phase === "between" ? boundedCurrentPass + 1 : boundedCurrentPass, 1), boundedMaxPasses);
  const stage = getPlanningStage(displayPass);

  return [
    {
      detail: "Plan mode",
      id: "plan-context",
      label: "Read request",
      status: boundedCurrentPass > 0 || phase === "input" || phase === "complete" ? "complete" : "active",
    },
    {
      detail: phase === "input" ? "Waiting for your answer" : "Answered or not needed",
      id: "plan-input",
      label: "Clarify choices",
      status: phase === "input" ? "active" : boundedCurrentPass > 0 || phase === "complete" || phase === "finalizing" ? "complete" : "pending",
    },
    {
      detail: `${stage.label} - pass ${displayPass} of ${boundedMaxPasses}`,
      id: "plan-pass",
      label: "Plan stage",
      status: phase === "input" ? "pending" : phase === "active" ? "active" : "complete",
    },
    {
      detail: phase === "between" ? "Preparing next stage" : phase === "finalizing" || phase === "complete" ? "Coverage checked" : "Cross-check notes",
      id: "plan-review",
      label: "Check coverage",
      status: phase === "between" ? "active" : phase === "finalizing" || phase === "complete" || boundedCurrentPass > 0 ? "complete" : "pending",
    },
    {
      detail: phase === "complete" ? "Ready" : phase === "finalizing" ? "Preparing answer" : "Waiting",
      id: "plan-final",
      label: "Write answer",
      status: phase === "complete" ? "complete" : phase === "finalizing" ? "active" : "pending",
    },
  ];
}

function createPlanningInputSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: 850,
    systemPrompt: createPlanningInputSystemPrompt(settings.systemPrompt),
    temperature: 0.1,
    thinking: {
      ...settings.thinking,
      effort: "low",
      enabled: settings.tools.thinking,
    },
  };
}

function createPlanningSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: Math.max(settings.maxTokens, 1800),
    systemPrompt: createPlanningSystemPrompt(settings.systemPrompt),
    temperature: Math.min(settings.temperature, 0.3),
    thinking: {
      ...settings.thinking,
      effort: "medium",
      enabled: settings.tools.thinking,
    },
  };
}

function createFinalAnswerSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: Math.max(settings.maxTokens, 1800),
    systemPrompt: createFinalAnswerSystemPrompt(settings.systemPrompt),
    temperature: Math.min(settings.temperature, 0.25),
    thinking: {
      ...settings.thinking,
      effort: "low",
      enabled: false,
    },
  };
}

function createPlanningInputSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode is starting. Decide whether user input is needed before planning.",
    "Ask questions only when the answer would materially change scope, implementation order, target platform, constraints, or risk posture.",
    "Do not ask for routine preferences that can be handled by a sensible default.",
    "If previous clarification answers are present, do not repeat them. Ask a follow-up only if a new missing decision would materially change the plan.",
    "Return JSON only. No Markdown, no prose.",
    'Schema: {"needsInput": boolean, "title": string, "detail": string, "questions": [{"id": string, "question": string, "placeholder": string, "required": boolean, "options": [{"id": string, "label": string, "description": string}]}]}',
    "Use at most 3 questions. Each question may have 2 or 3 short options when choices are useful.",
    "If no input is needed, return exactly {\"needsInput\":false,\"questions\":[]}.",
  ].join("\n\n");
}

function createPlanningSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode is active. You are producing staged planning notes before a final user-facing answer.",
    "Do not edit files, claim to run tools, or claim to inspect the filesystem in this mode.",
    "If a DuckDuckGo web context message is present, use those provided results as web context and cite them only in the final answer. Do not claim any web browsing beyond the provided results.",
    "Each pass has a different stage focus. Do not rewrite or revise the previous pass. Add a new focused planning note for each requested stage only.",
    "The whole response must start with exactly one control line: PLAN_STATUS: continue or PLAN_STATUS: final.",
    "Use PLAN_STATUS: final only when the accumulated stage notes are enough to synthesize a complete final answer. Otherwise use PLAN_STATUS: continue.",
    "After the control line, return one block per requested pass using this exact shape: PASS N - Stage, concise note, END_PASS.",
    "Do not repeat earlier stage notes.",
  ].join("\n\n");
}

function createFinalAnswerSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode has completed. Write only the final user-facing answer.",
    "Do not include hidden reasoning, self-review notes, pass notes, PLAN_STATUS lines, or claims that files/tools/web were used.",
    "If DuckDuckGo web sources were provided, use Markdown links for claims that rely on them.",
    "Use the completed plan to give a complete, practical answer the user can act on next.",
  ].join("\n\n");
}

function createPlanningInputMessages(messages: ChatMessage[]): ChatMessage[] {
  return [
    ...messages,
    createSyntheticMessage(
      "user",
      [
        "Before planning, decide whether to ask me for clarifying input.",
        "If needed, ask focused questions that will influence the plan.",
        "If not needed, continue without asking.",
      ].join("\n"),
    ),
  ];
}

function createPlanningMessages(messages: ChatMessage[], passNotes: string[], stages: PlanningBatchStage[], maxPasses: number): ChatMessage[] {
  const planningPrompt = [
    `Planning passes ${stages[0]?.pass ?? 1}-${stages[stages.length - 1]?.pass ?? 1} of up to ${maxPasses}.`,
    "Requested stages:",
    stages.map(({ pass, stage }) => `Pass ${pass} - ${stage.label}: ${stage.focus}`).join("\n"),
    "Write one new planning note for each requested stage only.",
    "Do not revise, rephrase, or restate previous stage notes.",
    "Use this exact block format for each pass:",
    "PASS N - Stage\nNote text.\nEND_PASS",
    passNotes.length > 0 ? "Previous stage notes for context:" : "",
    passNotes.length > 0 ? passNotes.join("\n\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [...messages, createSyntheticMessage("user", planningPrompt)];
}

function createFinalAnswerMessages(messages: ChatMessage[], passNotes: string[], passCount: number, maxPasses: number): ChatMessage[] {
  return [
    ...messages,
    createSyntheticMessage(
      "user",
      [
        `Planning finished after ${passCount} of ${maxPasses} allowed passes.`,
        "Write the final answer now by synthesizing the staged planning notes into one coherent response.",
        "The planning/thinking trail is shown elsewhere, so do not repeat internal planning process.",
        "Use the notes as inputs, not as separate responses.",
        "Staged planning notes:",
        passNotes.join("\n\n") || "No staged notes were returned. Give the best complete answer from the conversation context.",
      ].join("\n\n"),
    ),
  ];
}

export function createPlanningAnswersMessage(inputRequest: ChatPlanningInputRequest, answers: ChatPlanningInputAnswer[]): ChatMessage {
  const answerLines = inputRequest.questions.map((question) => {
    const answer = answers.find((item) => item.questionId === question.id);
    const value = answer?.value.trim() || "No answer provided.";

    return `- ${question.question}\n  Answer: ${value}`;
  });

  return createSyntheticMessage(
    "user",
    [
      "User answered planning clarification questions. Use these answers as hard planning context.",
      inputRequest.detail ? `Question context: ${inputRequest.detail}` : "",
      "Answers:",
      answerLines.join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

function createSyntheticMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `synthetic-${role}-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    role,
  };
}

function cleanPlanningResponse(content: string): CleanPlanningResponse {
  const statusMatches = [...content.matchAll(PLAN_STATUS_PATTERN)];
  const lastStatus = statusMatches[statusMatches.length - 1]?.[1]?.toLowerCase();
  const cleanedContent = content.replace(PLAN_STATUS_PATTERN, "").trim();

  return {
    content: cleanedContent,
    final: lastStatus === "final",
  };
}

function createPlanningBatchStages(startPass: number, maxPasses: number): PlanningBatchStage[] {
  const batchSize = Math.min(PLANNING_BATCH_SIZE, maxPasses - startPass + 1);

  return Array.from({ length: batchSize }, (_, index) => {
    const pass = startPass + index;

    return {
      pass,
      stage: getPlanningStage(pass),
    };
  });
}

function parsePlanningBatchResponse(content: string, stages: PlanningBatchStage[]): ParsedPlanningBatch {
  const cleaned = cleanPlanningResponse(content);
  const notes: string[] = [];
  let activeLines: string[] | null = null;

  function pushActiveNote() {
    if (!activeLines) {
      return;
    }

    const note = cleanPlanningNote(activeLines.join("\n"));

    if (note) {
      notes.push(note);
    }

    activeLines = null;
  }

  for (const line of cleaned.content.split(/\r?\n/)) {
    if (PASS_HEADER_PATTERN.test(line)) {
      pushActiveNote();
      activeLines = [];
      continue;
    }

    if (END_PASS_PATTERN.test(line)) {
      pushActiveNote();
      continue;
    }

    if (activeLines) {
      activeLines.push(line);
    }
  }

  pushActiveNote();

  if (notes.length === 0 && cleaned.content) {
    notes.push(cleanPlanningNote(cleaned.content));
  }

  return {
    final: cleaned.final,
    notes: notes.slice(0, stages.length),
  };
}

function getPlanningStage(pass: number) {
  return PLANNING_STAGES[Math.min(Math.max(pass, 1), PLANNING_STAGES.length) - 1] ?? PLANNING_STAGES[PLANNING_STAGES.length - 1];
}

function parsePlanningInputDecision(content: string): PlanningInputDecisionPayload | null {
  const jsonText = extractJsonObject(content);

  if (!jsonText) {
    return null;
  }

  try {
    const payload = JSON.parse(jsonText) as PlanningInputDecisionPayload;
    return typeof payload === "object" && payload ? payload : null;
  } catch {
    return null;
  }
}

function extractJsonObject(content: string) {
  const strippedContent = content.replace(/```(?:json)?/gi, "```").replace(/```/g, "").trim();
  const startIndex = strippedContent.indexOf("{");
  const endIndex = strippedContent.lastIndexOf("}");

  if (startIndex < 0 || endIndex <= startIndex) {
    return "";
  }

  return strippedContent.slice(startIndex, endIndex + 1);
}

function normalizePlanningQuestion(value: unknown, index: number): ChatPlanningQuestion[] {
  if (typeof value !== "object" || !value) {
    return [];
  }

  const payload = value as PlanningQuestionPayload;
  const question = normalizeLongText(payload.question);

  if (!question) {
    return [];
  }

  return [
    {
      id: normalizeIdentifier(payload.id, `question-${index + 1}`),
      options: normalizePlanningOptions(payload.options),
      placeholder: normalizeShortText(payload.placeholder) || "Answer this so the plan can adapt.",
      question,
      required: typeof payload.required === "boolean" ? payload.required : true,
    },
  ];
}

function normalizePlanningOptions(value: unknown): ChatPlanningQuestionOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value.flatMap((option, index) => {
    if (typeof option !== "object" || !option) {
      return [];
    }

    const payload = option as PlanningQuestionOptionPayload;
    const label = normalizeShortText(payload.label);

    if (!label) {
      return [];
    }

    return [
      {
        description: normalizeShortText(payload.description),
        id: normalizeIdentifier(payload.id, `option-${index + 1}`),
        label,
      },
    ];
  });

  return options.length > 0 ? options.slice(0, MAX_PLANNING_OPTIONS) : undefined;
}

function normalizeIdentifier(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const identifier = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return identifier || fallback;
}

function normalizeShortText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized ? normalized.slice(0, 140) : undefined;
}

function normalizeLongText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 260);
}

function createPlanningInputRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `planning-input-${crypto.randomUUID()}`;
  }

  return `planning-input-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function cleanFinalAnswerContent(content: string) {
  return content.replace(PLAN_STATUS_PATTERN, "").trim();
}

function cleanPlanningNote(content: string) {
  return content
    .replace(/^NOTE\s*:\s*/gim, "")
    .replace(END_PASS_PATTERN, "")
    .trim();
}

function formatPlanningPassTrace(content: string, pass: number, stage: PlanningStage) {
  const cleanContent = content.trim();

  if (!cleanContent) {
    return `Pass ${pass} - ${stage.label}\nNo note returned.`;
  }

  return `Pass ${pass} - ${stage.label}\n${cleanContent}`;
}

function createPlanningTrace(passNotes: string[]) {
  return passNotes.length > 0 ? passNotes.join("\n\n") : undefined;
}

function waitForUiTick() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 35);
  });
}
