export const DEFAULT_CHAT_MODEL = "inclusionai/ring-2.6-1t:free";
export const LAGUNA_CHAT_MODEL = "poolside/laguna-m.1:free";
export const OWL_ALPHA_MODEL = "openrouter/owl-alpha";
export const NEMOTRON_3_SUPER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const IMAGE_REASONING_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free";

export interface ChatModelOption {
  detail: string;
  id: string;
  label: string;
  value: string;
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  {
    id: "ring-free",
    label: "Ring 2.6 1T",
    detail: "Free reasoning route on OpenRouter.",
    value: DEFAULT_CHAT_MODEL,
  },
  {
    id: "laguna-free",
    label: "Laguna M.1",
    detail: "Free Poolside route on OpenRouter.",
    value: LAGUNA_CHAT_MODEL,
  },
  {
    id: "owl-alpha",
    label: "Owl Alpha",
    detail: "OpenRouter alpha route.",
    value: OWL_ALPHA_MODEL,
  },
  {
    id: "nemotron-3-super",
    label: "Nemotron 3 Super",
    detail: "Free NVIDIA 120B route on OpenRouter.",
    value: NEMOTRON_3_SUPER_MODEL,
  },
  {
    id: "nemotron-omni",
    label: "Nemotron Omni",
    detail: "Auto-routes image uploads in the background.",
    value: IMAGE_REASONING_MODEL,
  },
];
