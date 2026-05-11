import type { ModelProviderId, ProviderSecretMap } from "../types/settings";

export const OPENROUTER_FREE_AUTO_MODEL = "openrouter/free";
export const OPENROUTER_AUTO_MODEL = "openrouter/auto";
export const DEFAULT_CHAT_MODEL = OPENROUTER_FREE_AUTO_MODEL;
export const RING_CHAT_MODEL = "inclusionai/ring-2.6-1t:free";
export const IMAGE_REASONING_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";
export const LAGUNA_CHAT_MODEL = "poolside/laguna-m.1:free";
export const LAGUNA_XS_CHAT_MODEL = "poolside/laguna-xs.2:free";
export const OWL_ALPHA_MODEL = "openrouter/owl-alpha";
export const COBUDDY_CHAT_MODEL = "baidu/cobuddy:free";
export const NEMOTRON_3_SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS = [
  LAGUNA_XS_CHAT_MODEL,
  LAGUNA_CHAT_MODEL,
  RING_CHAT_MODEL,
] as const;
export const DEFAULT_PROVIDER_ID: ModelProviderId = "openrouter";
const MODEL_PROVIDER_IDS: ModelProviderId[] = ["openrouter", "anthropic", "deepseek", "google", "groq", "lmstudio", "mistral", "ollama", "openai", "vllm", "xai"];

type ModelProviderApiStyle = "anthropic-messages" | "openai-compatible";
type ProviderReasoningMode =
  | "anthropic-thinking"
  | "deepseek-thinking"
  | "google-thinking"
  | "groq-reasoning"
  | "local-responses"
  | "mistral-reasoning"
  | "none"
  | "openrouter"
  | "reasoning-effort"
  | "xai-reasoning";

export interface ModelProviderDefinition {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiStyle: ModelProviderApiStyle;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  defaultBaseUrl: string;
  defaultModel: string;
  detail: string;
  docsUrl: string;
  label: string;
  listModelsPath: string;
  optionalApiKey?: boolean;
  reasoningMode: ProviderReasoningMode;
  requiresApiKey: boolean;
}

const DEFAULT_PROVIDER_BASE_URLS: Required<Record<ModelProviderId, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  lmstudio: "http://localhost:1234/v1",
  mistral: "https://api.mistral.ai/v1",
  ollama: "http://localhost:11434/v1",
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  vllm: "http://localhost:8000/v1",
  xai: "https://api.x.ai/v1",
};

const DEFAULT_PROVIDER_MODELS: Required<Record<ModelProviderId, string>> = {
  anthropic: "claude-opus-4-1-20250805",
  deepseek: "deepseek-v4-pro",
  google: "gemini-2.5-pro",
  groq: "openai/gpt-oss-120b",
  lmstudio: "",
  mistral: "mistral-medium-3.5",
  ollama: "",
  openai: "gpt-5.2",
  openrouter: DEFAULT_CHAT_MODEL,
  vllm: "",
  xai: "grok-4.3",
};

const PROVIDER_DOCS_URLS: Required<Record<ModelProviderId, string>> = {
  anthropic: "https://docs.anthropic.com/",
  deepseek: "https://api-docs.deepseek.com/",
  google: "https://ai.google.dev/gemini-api/docs",
  groq: "https://console.groq.com/docs",
  lmstudio: "https://lmstudio.ai/docs",
  mistral: "https://docs.mistral.ai/",
  ollama: "https://github.com/ollama/ollama/blob/main/docs/openai.md",
  openai: "https://platform.openai.com/docs",
  openrouter: "https://openrouter.ai/docs",
  vllm: "https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html",
  xai: "https://docs.x.ai/",
};

const MODEL_PROVIDER_DEFINITIONS: Record<ModelProviderId, ModelProviderDefinition> = {
  anthropic: {
    apiKeyLabel: "Anthropic API key",
    apiKeyPlaceholder: "Paste Anthropic API key",
    apiStyle: "anthropic-messages",
    baseUrlLabel: "Anthropic base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.anthropic,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.anthropic,
    defaultModel: DEFAULT_PROVIDER_MODELS.anthropic,
    detail: "Claude models through the Anthropic Messages API.",
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
    label: "Anthropic",
    listModelsPath: "/models",
    reasoningMode: "anthropic-thinking",
    requiresApiKey: true,
  },
  deepseek: {
    apiKeyLabel: "DeepSeek API key",
    apiKeyPlaceholder: "Paste DeepSeek API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "DeepSeek base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.deepseek,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.deepseek,
    defaultModel: DEFAULT_PROVIDER_MODELS.deepseek,
    detail: "DeepSeek V4 chat and reasoning models.",
    docsUrl: "https://api-docs.deepseek.com/",
    label: "DeepSeek",
    listModelsPath: "/models",
    reasoningMode: "deepseek-thinking",
    requiresApiKey: true,
  },
  google: {
    apiKeyLabel: "Google AI Studio API key",
    apiKeyPlaceholder: "Paste Google AI Studio API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Gemini OpenAI-compatible base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.google,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.google,
    defaultModel: DEFAULT_PROVIDER_MODELS.google,
    detail: "Gemini through Google's OpenAI-compatible API surface.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    label: "Google Gemini",
    listModelsPath: "/models",
    reasoningMode: "google-thinking",
    requiresApiKey: true,
  },
  groq: {
    apiKeyLabel: "Groq API key",
    apiKeyPlaceholder: "Paste Groq API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Groq OpenAI-compatible base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.groq,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.groq,
    defaultModel: DEFAULT_PROVIDER_MODELS.groq,
    detail: "Fast OpenAI-compatible Groq inference.",
    docsUrl: "https://console.groq.com/docs/models",
    label: "Groq",
    listModelsPath: "/models",
    reasoningMode: "groq-reasoning",
    requiresApiKey: true,
  },
  lmstudio: {
    apiKeyLabel: "LM Studio API key",
    apiKeyPlaceholder: "Optional if your server requires one",
    apiStyle: "openai-compatible",
    baseUrlLabel: "LM Studio server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.lmstudio,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.lmstudio,
    defaultModel: DEFAULT_PROVIDER_MODELS.lmstudio,
    detail: "Local OpenAI-compatible server. Change host or port for another device.",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat",
    label: "LM Studio",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  mistral: {
    apiKeyLabel: "Mistral API key",
    apiKeyPlaceholder: "Mistral API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Mistral base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.mistral,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.mistral,
    defaultModel: DEFAULT_PROVIDER_MODELS.mistral,
    detail: "Mistral's hosted model API.",
    docsUrl: "https://docs.mistral.ai/models/overview",
    label: "Mistral",
    listModelsPath: "/models",
    reasoningMode: "mistral-reasoning",
    requiresApiKey: true,
  },
  ollama: {
    apiKeyLabel: "Ollama API key",
    apiKeyPlaceholder: "Optional; Ollama ignores placeholder keys by default",
    apiStyle: "openai-compatible",
    baseUrlLabel: "Ollama server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.ollama,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.ollama,
    defaultModel: DEFAULT_PROVIDER_MODELS.ollama,
    detail: "Local Ollama OpenAI-compatible endpoint. Use a device IP for LAN models.",
    docsUrl: "https://docs.ollama.com/api/openai-compatibility",
    label: "Ollama",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  openai: {
    apiKeyLabel: "OpenAI API key",
    apiKeyPlaceholder: "Paste OpenAI API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "OpenAI base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.openai,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.openai,
    defaultModel: DEFAULT_PROVIDER_MODELS.openai,
    detail: "OpenAI GPT-5.2 chat and reasoning models.",
    docsUrl: "https://developers.openai.com/api/docs/models",
    label: "OpenAI",
    listModelsPath: "/models",
    reasoningMode: "reasoning-effort",
    requiresApiKey: true,
  },
  vllm: {
    apiKeyLabel: "vLLM API key",
    apiKeyPlaceholder: "Optional if your server requires one",
    apiStyle: "openai-compatible",
    baseUrlLabel: "vLLM server URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.vllm,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.vllm,
    defaultModel: DEFAULT_PROVIDER_MODELS.vllm,
    detail: "Local vLLM OpenAI-compatible server.",
    docsUrl: "https://docs.vllm.ai/en/stable/serving/openai_compatible_server.html",
    label: "vLLM",
    listModelsPath: "/models",
    optionalApiKey: true,
    reasoningMode: "local-responses",
    requiresApiKey: false,
  },
  openrouter: {
    apiKeyLabel: "OpenRouter API key",
    apiKeyPlaceholder: "Paste OpenRouter API key",
    apiStyle: "openai-compatible",
    baseUrlLabel: "OpenRouter base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.openrouter,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.openrouter,
    defaultModel: DEFAULT_PROVIDER_MODELS.openrouter,
    detail: "OpenRouter model routing, provider fallbacks, and BYOK-friendly routing.",
    docsUrl: "https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request",
    label: "OpenRouter",
    listModelsPath: "/models",
    reasoningMode: "openrouter",
    requiresApiKey: true,
  },
  xai: {
    apiKeyLabel: "xAI API key",
    apiKeyPlaceholder: "xai-...",
    apiStyle: "openai-compatible",
    baseUrlLabel: "xAI base URL",
    baseUrlPlaceholder: DEFAULT_PROVIDER_BASE_URLS.xai,
    defaultBaseUrl: DEFAULT_PROVIDER_BASE_URLS.xai,
    defaultModel: DEFAULT_PROVIDER_MODELS.xai,
    detail: "xAI Grok models through xAI's OpenAI-compatible chat API.",
    docsUrl: "https://docs.x.ai/developers/models",
    label: "xAI",
    listModelsPath: "/models",
    reasoningMode: "reasoning-effort",
    requiresApiKey: true,
  },
};

export interface ChatModelOption {
  contextWindowTokens?: number;
  detail: string;
  id: string;
  label: string;
  provider: ModelProviderId;
  value: string;
}

export interface ProviderModelMetadata {
  contextWindowTokens?: number;
  detail?: string;
  id: string;
  label?: string;
}

function modelOption(provider: ModelProviderId, id: string, label: string, value: string, detail: string, contextWindowTokens?: number): ChatModelOption {
  return {
    contextWindowTokens,
    detail,
    id,
    label,
    provider,
    value,
  };
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  modelOption("openrouter", "openrouter-free-auto", "Auto Route Free", DEFAULT_CHAT_MODEL, "Speed-biased free routing across three reliable OpenRouter free models.", 200_000),
  modelOption("openrouter", "openrouter-auto", "OpenRouter Auto", OPENROUTER_AUTO_MODEL, "OpenRouter's official Auto Router chooses from a curated high-quality model pool based on the prompt.", 1_000_000),
  modelOption("openrouter", "cobuddy-free", "CoBuddy", COBUDDY_CHAT_MODEL, "Free fast coding and agent model on OpenRouter.", 131_072),
  modelOption("openrouter", "laguna-xs-free", "Laguna XS.2", LAGUNA_XS_CHAT_MODEL, "Free compact coding model for quick responses.", 131_072),
  modelOption("openrouter", "ring-free", "Ring 2.6 1T", RING_CHAT_MODEL, "Free reasoning route on OpenRouter.", 262_144),
  modelOption("openrouter", "laguna-free", "Laguna M.1", LAGUNA_CHAT_MODEL, "Free Poolside route on OpenRouter.", 128_000),
  modelOption("openrouter", "owl-alpha", "Owl Alpha", OWL_ALPHA_MODEL, "OpenRouter alpha route.", 128_000),
  modelOption("openrouter", "nemotron-3-super", "Nemotron 3 Super", NEMOTRON_3_SUPER_MODEL, "Free NVIDIA 120B route on OpenRouter.", 262_144),
  modelOption("openrouter", "nemotron-omni", "Nemotron Omni", IMAGE_REASONING_MODEL, "OpenRouter image-capable reasoning route.", 128_000),
  modelOption("openrouter", "openrouter-gpt-latest", "OpenAI GPT Latest", "~openai/gpt-latest", "OpenRouter's latest OpenAI GPT family router.", 1_050_000),
  modelOption("openrouter", "openrouter-claude-sonnet-latest", "Claude Sonnet Latest", "~anthropic/claude-sonnet-latest", "OpenRouter's latest Claude Sonnet family router.", 1_000_000),
  modelOption("openrouter", "openrouter-gemini-pro-latest", "Gemini Pro Latest", "~google/gemini-pro-latest", "OpenRouter's latest Gemini Pro family router.", 1_048_576),
  modelOption("openrouter", "openrouter-grok-43", "Grok 4.3", "x-ai/grok-4.3", "xAI's current Grok model via OpenRouter.", 1_000_000),
  modelOption("openrouter", "openrouter-deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro through OpenRouter.", 1_000_000),
  modelOption("openai", "openai-gpt-52", "GPT-5.2", "gpt-5.2", "Flagship model for complex reasoning and coding.", 400_000),
  modelOption("openai", "openai-gpt-51", "GPT-5.1", "gpt-5.1", "Strong reasoning model for coding and professional work.", 400_000),
  modelOption("openai", "openai-gpt-5-mini", "GPT-5 Mini", "gpt-5-mini", "Lower-latency GPT-5 family model for focused tasks.", 400_000),
  modelOption("openai", "openai-gpt-5-nano", "GPT-5 Nano", "gpt-5-nano", "Small GPT-5 family model for fast background tasks.", 400_000),
  modelOption("anthropic", "anthropic-opus-41", "Claude Opus 4.1", "claude-opus-4-1-20250805", "Most capable current Claude model for complex coding and agentic work.", 200_000),
  modelOption("anthropic", "anthropic-opus-4", "Claude Opus 4", "claude-opus-4-20250514", "Previous Opus 4 snapshot for stable high-intelligence tasks.", 200_000),
  modelOption("anthropic", "anthropic-sonnet-4", "Claude Sonnet 4", "claude-sonnet-4-20250514", "Balanced Claude model with strong speed and intelligence.", 200_000),
  modelOption("anthropic", "anthropic-haiku-35", "Claude Haiku 3.5", "claude-3-5-haiku-20241022", "Fast Claude option for lighter tasks.", 200_000),
  modelOption("google", "google-gemini-25-pro", "Gemini 2.5 Pro", "gemini-2.5-pro", "Stable Gemini model for deep reasoning and coding.", 1_048_576),
  modelOption("google", "google-gemini-25-flash", "Gemini 2.5 Flash", "gemini-2.5-flash", "Fast multimodal Gemini model.", 1_048_576),
  modelOption("google", "google-gemini-25-flash-lite", "Gemini 2.5 Flash-Lite", "gemini-2.5-flash-lite", "Cost-efficient Gemini workhorse model.", 1_048_576),
  modelOption("xai", "xai-grok-43", "Grok 4.3", "grok-4.3", "xAI's recommended current chat model.", 1_000_000),
  modelOption("xai", "xai-grok-4-fast", "Grok 4 Fast", "grok-4-fast-reasoning", "Cost-efficient long-context Grok reasoning model.", 2_000_000),
  modelOption("xai", "xai-grok-code-fast", "Grok Code Fast", "grok-code-fast-1", "Fast Grok model tuned for agentic coding.", 256_000),
  modelOption("groq", "groq-gpt-oss-120b", "GPT-OSS 120B", "openai/gpt-oss-120b", "Groq's flagship GPT-OSS route.", 131_072),
  modelOption("groq", "groq-gpt-oss-20b", "GPT-OSS 20B", "openai/gpt-oss-20b", "Smaller, very fast GPT-OSS route.", 131_072),
  modelOption("groq", "groq-compound", "Groq Compound", "groq/compound", "Groq system with built-in agentic tools.", 131_072),
  modelOption("groq", "groq-llama-33-70b", "Llama 3.3 70B", "llama-3.3-70b-versatile", "Fast Llama production model.", 131_072),
  modelOption("mistral", "mistral-medium-35", "Mistral Medium 3.5", "mistral-medium-3.5", "Current frontier-class Mistral coding and agent model.", 256_000),
  modelOption("mistral", "mistral-large-3", "Mistral Large 3", "mistral-large-2512", "Latest large general-purpose Mistral family.", 256_000),
  modelOption("mistral", "mistral-devstral-2", "Devstral 2", "devstral-2512", "Mistral's frontier code agent model.", 256_000),
  modelOption("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek-v4-pro", "DeepSeek's strongest V4 model.", 1_000_000),
  modelOption("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek-v4-flash", "DeepSeek's fast V4 model.", 1_000_000),
];

export interface ModelProviderCatalogItem extends ModelProviderDefinition {
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  baseUrlLabel: string;
  baseUrlPlaceholder: string;
  defaultBaseUrl: string;
  id: ModelProviderId;
  models: ChatModelOption[];
  optionalApiKey: boolean;
}

export const MODEL_PROVIDERS: ModelProviderCatalogItem[] = MODEL_PROVIDER_IDS.map((providerId) => ({
  ...MODEL_PROVIDER_DEFINITIONS[providerId],
  id: providerId,
  models: CHAT_MODEL_OPTIONS.filter((option) => option.provider === providerId),
  optionalApiKey: MODEL_PROVIDER_DEFINITIONS[providerId].optionalApiKey ?? !MODEL_PROVIDER_DEFINITIONS[providerId].requiresApiKey,
}));

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === "string" && MODEL_PROVIDER_IDS.includes(value as ModelProviderId);
}

export function getDefaultBaseUrlForProvider(provider: ModelProviderId) {
  return DEFAULT_PROVIDER_BASE_URLS[provider];
}

export function normalizeProviderBaseUrl(provider: ModelProviderId, baseUrl: string | undefined) {
  const fallbackUrl = getDefaultBaseUrlForProvider(provider);
  const normalizedUrl = (baseUrl?.trim() || fallbackUrl).replace(/\/+$/, "");

  if (provider === "google" && normalizedUrl === "https://generativelanguage.googleapis.com/v1beta") {
    return DEFAULT_PROVIDER_BASE_URLS.google;
  }

  return normalizedUrl;
}

export function getDefaultProviderBaseUrls(): ProviderSecretMap {
  return { ...DEFAULT_PROVIDER_BASE_URLS };
}

export function getDefaultProviderModels(): ProviderSecretMap {
  return { ...DEFAULT_PROVIDER_MODELS };
}

export function getDefaultModelForProvider(provider: ModelProviderId) {
  return DEFAULT_PROVIDER_MODELS[provider];
}

export function normalizeProviderModelId(provider: ModelProviderId, model: string | undefined) {
  const normalizedModel = model?.trim() || getDefaultModelForProvider(provider);

  if (provider === "google" && (normalizedModel === "gemini-3-pro-preview" || normalizedModel === "gemini-3.1-pro-preview")) {
    return DEFAULT_PROVIDER_MODELS.google;
  }

  if (provider === "openai" && (normalizedModel === "gpt-5.5" || normalizedModel === "gpt-5.4" || normalizedModel === "gpt-5.4-mini" || normalizedModel === "gpt-5.4-nano")) {
    return DEFAULT_PROVIDER_MODELS.openai;
  }

  if (provider === "anthropic" && (normalizedModel === "claude-opus-4-7" || normalizedModel === "claude-sonnet-4-6" || normalizedModel === "claude-haiku-4-5-20251001")) {
    return DEFAULT_PROVIDER_MODELS.anthropic;
  }

  if (provider === "xai" && normalizedModel.startsWith("grok-4.20")) {
    return DEFAULT_PROVIDER_MODELS.xai;
  }

  return normalizedModel;
}

export function isOpenRouterRouterModel(model: string) {
  const normalizedModel = model.trim();

  return normalizedModel === OPENROUTER_FREE_AUTO_MODEL || normalizedModel === OPENROUTER_AUTO_MODEL;
}

export function isOpenRouterFreeModel(model: string) {
  const normalizedModel = model.trim();

  return normalizedModel === OPENROUTER_FREE_AUTO_MODEL || normalizedModel.endsWith(":free");
}

export function getModelProvider(provider: ModelProviderId) {
  return MODEL_PROVIDERS.find((item) => item.id === provider) ?? MODEL_PROVIDERS.find((item) => item.id === DEFAULT_PROVIDER_ID)!;
}

export function prefersLiveModelCatalog(provider: ModelProviderId) {
  return provider === "lmstudio" || provider === "ollama" || provider === "vllm";
}

export function usesLiveModelCatalog(provider: ModelProviderId) {
  return provider === "openrouter" || prefersLiveModelCatalog(provider);
}

export function buildProviderModelOptions(provider: ModelProviderId, discoveredModels: ProviderModelMetadata[] | undefined, currentModel?: string) {
  const baseOptions = prefersLiveModelCatalog(provider)
    ? discoveredModels?.map((model) => createDiscoveredModelOption(provider, model)) ?? []
    : [
        ...getModelProvider(provider).models,
        ...(discoveredModels?.map((model) => createDiscoveredModelOption(provider, model)) ?? []),
      ];
  const dedupedOptions = dedupeModelOptions(baseOptions);
  const normalizedCurrentModel = currentModel?.trim() ? normalizeProviderModelId(provider, currentModel) : "";

  if (normalizedCurrentModel && !dedupedOptions.some((option) => option.value === normalizedCurrentModel)) {
    dedupedOptions.unshift({
      id: `${provider}-custom-${hashModelId(normalizedCurrentModel)}`,
      label: normalizedCurrentModel,
      detail: "Custom selected model.",
      provider,
      value: normalizedCurrentModel,
    });
  }

  return prioritizeProviderModelOptions(provider, dedupedOptions);
}

export function getChatModelOption(model: string, provider?: ModelProviderId) {
  const normalizedModel = model.trim();

  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === normalizedModel && (!provider || option.provider === provider)) ??
    CHAT_MODEL_OPTIONS.find((option) => option.value === normalizedModel)
  );
}

export function getProviderApiKey(settings: { apiKeys?: ProviderSecretMap; openRouterApiKey?: string; provider: ModelProviderId }) {
  const providerApiKey = settings.apiKeys?.[settings.provider] ?? "";

  if (settings.provider === "openrouter") {
    return providerApiKey || settings.openRouterApiKey || "";
  }

  return providerApiKey;
}

export function getProviderBaseUrl(settings: { baseUrls?: ProviderSecretMap; provider: ModelProviderId }) {
  return normalizeProviderBaseUrl(settings.provider, settings.baseUrls?.[settings.provider]);
}

export function supportsProviderThinking(provider: ModelProviderId, _effort: string, model?: string) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  if (provider === "anthropic") {
    return !normalizedModel || /claude-(opus|sonnet|3-7)/.test(normalizedModel);
  }

  if (provider === "google") {
    return !normalizedModel || normalizedModel.startsWith("gemini-2.5") || normalizedModel.startsWith("gemini-3");
  }

  if (provider === "groq") {
    return normalizedModel.includes("gpt-oss") || normalizedModel.includes("qwen3");
  }

  if (provider === "mistral") {
    return normalizedModel.includes("mistral-medium-3.5") || normalizedModel.includes("mistral-small") || normalizedModel.includes("magistral");
  }

  if (provider === "xai") {
    return !normalizedModel || (normalizedModel.includes("grok-4.3") || normalizedModel.includes("grok-code-fast") || normalizedModel.includes("reasoning")) && !normalizedModel.includes("non-reasoning");
  }

  return getModelProvider(provider).reasoningMode !== "none";
}

function createDiscoveredModelOption(provider: ModelProviderId, model: ProviderModelMetadata): ChatModelOption {
  const modelId = model.id.trim();

  return {
    contextWindowTokens: model.contextWindowTokens,
    detail: model.detail || `Discovered from ${getModelProvider(provider).label} /models.`,
    id: `${provider}-live-${hashModelId(modelId)}`,
    label: model.label?.trim() || modelId,
    provider,
    value: modelId,
  };
}

function dedupeModelOptions(options: ChatModelOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const key = `${option.provider}:${option.value}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function prioritizeProviderModelOptions(provider: ModelProviderId, options: ChatModelOption[]) {
  if (provider !== "openrouter") {
    return options;
  }

  const autoRouteFree = options.find((option) => option.value === OPENROUTER_FREE_AUTO_MODEL);
  const remainingOptions = options.filter((option) => option.value !== OPENROUTER_FREE_AUTO_MODEL);

  return autoRouteFree ? [autoRouteFree, ...remainingOptions] : options;
}

function hashModelId(modelId: string) {
  let hash = 0;

  for (let index = 0; index < modelId.length; index += 1) {
    hash = (hash * 31 + modelId.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
