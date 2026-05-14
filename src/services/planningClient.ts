import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import type { ChatMessage, ChatPlanningInputAnswer, ChatPlanningInputRequest, ChatPlanningQuestion, ChatPlanningQuestionOption, ChatProgressItem } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { streamProviderMessage, sendProviderMessage, type ProviderUsage } from "./modelProviderClient";

const MAX_PLANNING_QUESTIONS = 3;
const MAX_PLANNING_OPTIONS = 3;

export type PlanningPhase = "input" | "researching" | "drafting" | "complete";

interface PlanningRunOptions {
  messages: ChatMessage[];
  onUpdate: (snapshot: PlanningSnapshot) => void;
  onProviderRequest?: (request: PlanningProviderRequest) => void;
  onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
  /** Plain-text observations gathered from host-attached workspace or web context. */
  researchFindings?: string;
  signal?: AbortSignal;
  settings: ProviderSettings;
}

interface PlanningRequestOptions {
  onProviderRequest?: (request: PlanningProviderRequest) => void;
  onProviderUsage?: (request: PlanningProviderRequest, usage: ProviderUsage | undefined) => void;
  signal?: AbortSignal;
}

export interface PlanningSnapshot {
  content?: string;
  progress: ChatProgressItem[];
}

export interface PlanningRunResult extends PlanningSnapshot {
  content: string;
  providerRequest?: PlanningProviderRequest;
  usage?: ProviderUsage;
}

export interface PlanningProviderRequest {
  messages: ChatMessage[];
  settings: ProviderSettings;
  stream: boolean;
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

export async function createPlanningInputRequest(
  settings: ProviderSettings,
  messages: ChatMessage[],
  options: PlanningRequestOptions = {},
): Promise<ChatPlanningInputRequest | null> {
  const providerRequest = {
    messages: createPlanningInputMessages(messages),
    settings: createPlanningInputSettings(settings),
    stream: false,
  } satisfies PlanningProviderRequest;

  options.onProviderRequest?.(providerRequest);

  const response = await sendProviderMessage(providerRequest.settings, providerRequest.messages, {
    signal: options.signal,
  });
  options.onProviderUsage?.(providerRequest, response.usage);
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

export async function runPlanningMode({ messages, onProviderRequest, onProviderUsage, onUpdate, researchFindings, signal, settings }: PlanningRunOptions): Promise<PlanningRunResult> {
  const trimmedFindings = researchFindings?.trim() ?? "";
  const researchMessages = trimmedFindings ? [createResearchFindingsMessage(trimmedFindings)] : [];
  const planningContextMessages = [...messages, ...researchMessages];
  const providerRequest = {
    messages: createFinalAnswerMessages(planningContextMessages, trimmedFindings),
    settings: createFinalAnswerSettings(settings),
    stream: true,
  } satisfies PlanningProviderRequest;

  onUpdate({
    progress: createPlanningProgress("drafting"),
  });
  onProviderRequest?.(providerRequest);

  let finalContent = "";

  const finalResponse = await streamProviderMessage(
    providerRequest.settings,
    providerRequest.messages,
    (snapshot) => {
      finalContent = snapshot.content;
      onUpdate({
        content: cleanFinalAnswerContent(finalContent),
        progress: createPlanningProgress("drafting"),
      });
    },
    {
      signal,
    },
  );
  onProviderUsage?.(providerRequest, finalResponse.usage);
  const content = cleanFinalAnswerContent(finalResponse.content || finalContent) || "I could not produce a finished plan from the model response.";

  return {
    content,
    providerRequest,
    progress: createPlanningProgress("complete"),
    usage: finalResponse.usage,
  };
}

export function createPlanningProgress(phase: PlanningPhase): ChatProgressItem[] {
  return [
    {
      detail: "Plan mode",
      id: "plan-context",
      label: "Read request",
      status: phase === "input" ? "active" : "complete",
    },
    {
      detail: phase === "input" ? "Waiting for your answer" : "Answered or not needed",
      id: "plan-input",
      label: "Clarify choices",
      status: phase === "input" ? "active" : "complete",
    },
    {
      detail:
        phase === "researching"
          ? "Reviewing attached workspace context"
          : phase === "drafting" || phase === "complete"
            ? "Context gathered"
            : "Waiting",
      id: "plan-research",
      label: "Research codebase",
      status: phase === "researching" ? "active" : phase === "drafting" || phase === "complete" ? "complete" : "pending",
    },
    {
      detail:
        phase === "drafting"
          ? "Writing the plan from research findings"
          : phase === "complete"
            ? "Plan ready"
            : "Waiting",
      id: "plan-write",
      label: "Write plan",
      status: phase === "drafting" ? "active" : phase === "complete" ? "complete" : "pending",
    },
  ];
}

function disablePlanningExecutionTools(tools: ProviderSettings["tools"]): ProviderSettings["tools"] {
  return {
    ...tools,
    browserPreview: false,
    codeEdit: false,
    codeGeneration: false,
    codeView: false,
    desktopComputer: false,
    fileBrowser: false,
    fileCreation: false,
    fileSafety: false,
    fileSearch: false,
    pdfTools: false,
    reactNativeTools: false,
    sourceControl: false,
    sqlTools: false,
    terminal: false,
    testingTools: false,
    typescriptTools: false,
    webSearch: false,
  };
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
    tools: disablePlanningExecutionTools(settings.tools),
  };
}

function createFinalAnswerSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: Math.max(settings.maxTokens, 2400),
    systemPrompt: createFinalAnswerSystemPrompt(settings.systemPrompt),
    temperature: Math.min(settings.temperature, 0.25),
    thinking: {
      ...settings.thinking,
      effort: "medium",
      enabled: settings.tools.thinking,
    },
    tools: disablePlanningExecutionTools(settings.tools),
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

function createFinalAnswerSystemPrompt(basePrompt: string) {
  return [
    basePrompt,
    "Plan mode is active. Write a single, complete user-facing plan in one response. Do not split this into passes or stages.",
    "TOOL CALLS ARE DISABLED. Do NOT emit native tool calls, strict tool envelopes, or raw protocol JSON. Any tool-call markup is malformed for this turn.",
    "If research findings were attached, treat them as host-provided context. Reference only the file paths, symbols, functions, snippets, and sources shown there. Do not invent files or functions that were not provided.",
    "If the user is asking for a bug fix, name each bug, the file and approximate line, and the exact change. If the user is asking for a feature, name the files to create or edit and the structure.",
    "Format the plan as Markdown with these sections, in order:",
    "## Goal\nOne or two sentences naming the outcome.\n## Files to change\nA bullet list of specific paths from research findings with a short reason each.\n## Step-by-step plan\nNumbered list of concrete implementation steps in the safest order. Each step names the file and the change.\n## Risks and edge cases\nBullet list.\n## Verification\nHow to confirm it works (tests, manual checks, commands).",
    "Be concrete. No generic advice like 'review the codebase' or 'investigate further'. The research is already done.",
    "If web sources were provided, use Markdown links for claims that rely on them.",
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

function createFinalAnswerMessages(messages: ChatMessage[], researchFindings: string): ChatMessage[] {
  return [
    ...messages,
    createSyntheticMessage(
      "user",
      [
        "Write the complete plan now in a single Markdown response.",
        researchFindings
          ? "Use the RESEARCH FINDINGS above as the attached context for the plan."
          : "No host-provided research findings were available. Build the best plan you can from the conversation and workspace context already in the messages.",
        "Use the section headings: ## Goal, ## Files to change, ## Step-by-step plan, ## Risks and edge cases, ## Verification.",
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

function createResearchFindingsMessage(findings: string): ChatMessage {
  return createSyntheticMessage(
    "user",
    [
      "RESEARCH FINDINGS",
      "Host-provided context is attached below. Build the plan from these specific paths, symbols, snippets, and sources. Do not request local tool calls; the planning turn cannot execute them.",
      findings,
    ].join("\n\n"),
  );
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
  return sanitizeLocalToolCallsForDisplay(content).trim();
}
