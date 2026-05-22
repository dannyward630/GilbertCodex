import { NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_OPEN_CODE_FREE_MODEL_IDS, NINE_ROUTER_SMART_SAVER_MODEL } from "../lib/models";
import type { SubscriptionFallbackMode } from "../types/settings";
import { fetchNineRouterJson, joinLocalUrl, postNineRouterJson, putNineRouterJson } from "./nineRouterClient";

export const NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS = NINE_ROUTER_OPEN_CODE_FREE_MODEL_IDS;
const NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODEL_SET = new Set<string>(NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS);

export const NINE_ROUTER_SMART_SAVER_COMBO_NAME = NINE_ROUTER_SMART_SAVER_MODEL;
export const NINE_ROUTER_ALWAYS_FREE_COMBO_NAME = NINE_ROUTER_ALWAYS_FREE_MODEL;

export interface NineRouterCombo {
  id?: string;
  kind?: string | null;
  modelIds?: string[];
  models?: string[];
  name?: string;
}

const NINE_ROUTER_SUBSCRIPTION_PREFIXES = ["cx/", "cc/", "gh/", "claude/", "gemini-cli/", "ag/", "kiro/", "kilocode/", "cline/", "qwen/", "iflow/", "qoder/", "kimi-coding/", "codebuddy/"];
const NINE_ROUTER_CHEAP_PREFIXES = ["glm/", "minimax/", "kimi/"];
const NINE_ROUTER_FREE_PREFIXES = ["oc/", "kr/", "free/", "freetheai/"];
const BARE_OPENROUTER_FREE_OWNER_PREFIXES = new Set([
  "arcee-ai",
  "baidu",
  "deepseek",
  "google",
  "meta-llama",
  "minimax",
  "nvidia",
  "openai",
  "poolside",
  "qwen",
  "z-ai",
]);

export function buildNineRouterFallbackModels(mode: SubscriptionFallbackMode, selectedModel: string, liveModels: string[]) {
  if (mode === "off") {
    return [];
  }

  const effectiveMode = mode === "smart-saver" ? "always-free" : mode;
  const usableLiveModels = dedupeNineRouterFallbackModels(liveModels.flatMap((model) => normalizeNineRouterFallbackModel(model) ?? []));
  const liveSubscriptionModels = usableLiveModels.filter(isSubscriptionModel);
  const liveCheapModels = usableLiveModels.filter(isCheapModel);
  const liveFreeModels = usableLiveModels.filter(isFreeModel).filter((model) => !isOpenCodeFreeModel(model) || isSupportedOpenCodeFreeModel(model));
  const selectedSubscriptionModel =
    selectedModel &&
    selectedModel !== NINE_ROUTER_SMART_SAVER_MODEL &&
    selectedModel !== NINE_ROUTER_ALWAYS_FREE_MODEL &&
    isSubscriptionModel(selectedModel) &&
    usableLiveModels.includes(selectedModel)
      ? selectedModel
      : "";
  const freeModels = dedupeNineRouterFallbackModels([
    ...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
    ...prioritizeOpenCodeFreeModels(usableLiveModels),
    ...liveFreeModels,
  ]);

  if (effectiveMode === "always-free") {
    return freeModels.slice(0, 10);
  }

  return dedupeNineRouterFallbackModels([
    selectedSubscriptionModel,
    ...liveSubscriptionModels,
    ...liveCheapModels,
    ...freeModels,
  ]).slice(0, 10);
}

export function getNineRouterOpenCodeFreeModels(liveModels: string[]) {
  return dedupeNineRouterFallbackModels([
    ...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
    ...prioritizeOpenCodeFreeModels(liveModels),
  ]);
}

export function hasUnusableNineRouterFallbackModels(models: string[], liveModels: string[]) {
  const liveModelSet = new Set(liveModels.flatMap((model) => normalizeNineRouterFallbackModel(model) ?? []));

  return models.some((model) => !isUsableNineRouterFallbackModel(model, liveModelSet));
}

export function isOpenCodeFreeModel(model: string) {
  return model.trim().toLowerCase().startsWith("oc/");
}

export function dedupeNineRouterFallbackModels(values: readonly string[]) {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalizedValue = value.trim();

    if (!normalizedValue || seen.has(normalizedValue)) {
      return [];
    }

    seen.add(normalizedValue);
    return [normalizedValue];
  });
}

export function findNineRouterCombo(combos: NineRouterCombo[], name: string) {
  return combos.find((combo) => combo.name === name || combo.id === name) ?? null;
}

export function getNineRouterComboModels(combo: NineRouterCombo | null | undefined) {
  if (!combo) {
    return [];
  }

  const models = Array.isArray(combo.models) ? combo.models : Array.isArray(combo.modelIds) ? combo.modelIds : [];
  return dedupeNineRouterFallbackModels(models);
}

export async function loadNineRouterCombos(dashboardUrl: string) {
  const payload = await fetchNineRouterJson<NineRouterCombo[] | { combos?: NineRouterCombo[]; data?: NineRouterCombo[] }>(joinLocalUrl(dashboardUrl, "/api/combos"));
  return normalizeNineRouterCombosPayload(payload);
}

export async function upsertNineRouterCombo(dashboardUrl: string, name: string, models: string[], kind: string) {
  const combos = await loadNineRouterCombos(dashboardUrl);
  const existing = findNineRouterCombo(combos, name);
  const body = {
    kind,
    models,
    name,
  };

  if (existing?.id) {
    return putNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, `/api/combos/${encodeURIComponent(existing.id)}`), body);
  }

  return postNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, "/api/combos"), body);
}

function normalizeNineRouterCombosPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isNineRouterCombo);
  }

  if (typeof payload !== "object" || !payload) {
    return [];
  }

  const record = payload as { combos?: unknown; data?: unknown };
  const combos = Array.isArray(record.combos) ? record.combos : Array.isArray(record.data) ? record.data : [];

  return combos.filter(isNineRouterCombo);
}

function isNineRouterCombo(value: unknown): value is NineRouterCombo {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const combo = value as Partial<NineRouterCombo>;
  return typeof combo.name === "string" || typeof combo.id === "string";
}

function normalizeNineRouterFallbackModel(model: string) {
  const normalizedModel = model.trim();

  if (!normalizedModel || isBareOpenRouterFreeModel(normalizedModel)) {
    return undefined;
  }

  return normalizedModel;
}

function prioritizeOpenCodeFreeModels(models: readonly string[]) {
  const openCodeModels = models.filter(isSupportedOpenCodeFreeModel);
  const openCodeSet = new Set(openCodeModels);

  return dedupeNineRouterFallbackModels([
    ...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS.filter((model) => openCodeSet.has(model)),
    ...openCodeModels,
  ]);
}

function isSubscriptionModel(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return NINE_ROUTER_SUBSCRIPTION_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

function isCheapModel(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  return NINE_ROUTER_CHEAP_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

function isFreeModel(model: string) {
  const normalizedModel = model.trim().toLowerCase();

  if (isOpenCodeFreeModel(normalizedModel)) {
    return true;
  }

  if (normalizedModel.startsWith("openrouter/")) {
    return normalizedModel.endsWith(":free") || normalizedModel === "openrouter/openrouter/free";
  }

  return NINE_ROUTER_FREE_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix)) || normalizedModel.includes("/free");
}

function isSupportedOpenCodeFreeModel(model: string) {
  return NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODEL_SET.has(model.trim().toLowerCase());
}

function isUsableNineRouterFallbackModel(model: string, liveModelSet: Set<string>) {
  const normalizedModel = normalizeNineRouterFallbackModel(model);

  if (!normalizedModel) {
    return false;
  }

  if (isOpenCodeFreeModel(normalizedModel)) {
    return isSupportedOpenCodeFreeModel(normalizedModel);
  }

  return liveModelSet.has(normalizedModel);
}

function isBareOpenRouterFreeModel(model: string) {
  const normalizedModel = model.trim().toLowerCase();
  const separatorIndex = normalizedModel.indexOf("/");

  if (separatorIndex <= 0 || !normalizedModel.endsWith(":free")) {
    return false;
  }

  return BARE_OPENROUTER_FREE_OWNER_PREFIXES.has(normalizedModel.slice(0, separatorIndex));
}
