export type SupportLinkId = "stripeOneTime" | "stripeMonthly" | "paypal" | "cashApp";
export type SupportLinkPlacement = "primary" | "secondary";
export type SupportLinkTone = "blue" | "green" | "gold" | "rose";

export interface SupportLink {
  description: string;
  disabledLabel: string;
  enabled: boolean;
  id: SupportLinkId;
  label: string;
  placement: SupportLinkPlacement;
  providerLabel: string;
  tone: SupportLinkTone;
  url: string;
}

export interface SupportConfig {
  configuredCount: number;
  defaultCashAppUrl: string;
  githubUrl: string;
  links: SupportLink[];
  primaryLinks: SupportLink[];
  secondaryLinks: SupportLink[];
  visiblePrimaryLinks: SupportLink[];
  visibleSecondaryLinks: SupportLink[];
}

export interface RawSupportConfig {
  VITE_SUPPORT_CASHAPP_URL?: unknown;
  VITE_SUPPORT_PAYPAL_URL?: unknown;
  VITE_SUPPORT_STRIPE_MONTHLY_URL?: unknown;
  VITE_SUPPORT_STRIPE_ONE_TIME_URL?: unknown;
}

interface SupportLinkDefinition {
  description: string;
  disabledLabel: string;
  envKey: keyof RawSupportConfig;
  id: SupportLinkId;
  label: string;
  placement: SupportLinkPlacement;
  providerLabel: string;
  tone: SupportLinkTone;
}

export const SUPPORT_GITHUB_URL = "https://github.com/UrbanWafflezz/GilbertCodex";
export const SUPPORT_CASH_TAG = "";
export const DEFAULT_CASH_APP_URL = "";

const SUPPORT_LINK_DEFINITIONS: SupportLinkDefinition[] = [
  {
    description: "A pay-what-you-want Stripe Payment Link for one-time project funding.",
    disabledLabel: "Add a one-time Stripe Payment Link to enable this option.",
    envKey: "VITE_SUPPORT_STRIPE_ONE_TIME_URL",
    id: "stripeOneTime",
    label: "Chip in once",
    placement: "secondary",
    providerLabel: "Stripe",
    tone: "blue",
  },
  {
    description: "A recurring Stripe Payment Link for people who want to fund ongoing work.",
    disabledLabel: "Add a monthly Stripe Payment Link to enable this option.",
    envKey: "VITE_SUPPORT_STRIPE_MONTHLY_URL",
    id: "stripeMonthly",
    label: "Chip in monthly",
    placement: "secondary",
    providerLabel: "Stripe",
    tone: "green",
  },
  {
    description: "A PayPal funding link can sit here once it is ready.",
    disabledLabel: "PayPal funding is coming soon.",
    envKey: "VITE_SUPPORT_PAYPAL_URL",
    id: "paypal",
    label: "PayPal",
    placement: "secondary",
    providerLabel: "PayPal",
    tone: "gold",
  },
  {
    description: "A Cash App funding link can sit here once it is ready.",
    disabledLabel: "Add a Cash App hosted funding link to enable this option.",
    envKey: "VITE_SUPPORT_CASHAPP_URL",
    id: "cashApp",
    label: "Chip in with Cash App",
    placement: "primary",
    providerLabel: "Cash App",
    tone: "rose",
  },
];

const ALLOWED_SUPPORT_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const RAW_SECRET_VALUE_PATTERN = /^(?:sk|rk|pk|ek|whsec)_(?:live|test)?_?[a-z0-9_]+$/i;
const SECRET_PARAM_NAME_PATTERN = /(?:^|[_-])(?:secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|webhook[_-]?secret|whsec)(?:$|[_-])/i;

export function normalizeSupportUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  if (!trimmed || looksLikeSecretValue(trimmed)) {
    return "";
  }

  try {
    const url = new URL(trimmed);

    if (!ALLOWED_SUPPORT_PROTOCOLS.has(url.protocol) || hasSecretLikeSearchData(url)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

export function normalizeSupportConfig(rawConfig: RawSupportConfig = {}): SupportConfig {
  const links = SUPPORT_LINK_DEFINITIONS.map((definition) => {
    const rawValue = rawConfig[definition.envKey];
    const fallbackUrl = definition.id === "cashApp" ? DEFAULT_CASH_APP_URL : "";
    const url = normalizeSupportUrl(isBlankSupportValue(rawValue) ? fallbackUrl : rawValue);

    return {
      description: definition.description,
      disabledLabel: definition.disabledLabel,
      enabled: Boolean(url),
      id: definition.id,
      label: definition.label,
      placement: definition.placement,
      providerLabel: definition.providerLabel,
      tone: definition.tone,
      url,
    };
  });

  return {
    configuredCount: links.filter((link) => link.enabled).length,
    defaultCashAppUrl: DEFAULT_CASH_APP_URL,
    githubUrl: SUPPORT_GITHUB_URL,
    links,
    primaryLinks: links.filter((link) => link.placement === "primary"),
    secondaryLinks: links.filter((link) => link.placement === "secondary"),
    visiblePrimaryLinks: links.filter((link) => link.placement === "primary" && link.enabled),
    visibleSecondaryLinks: links.filter((link) => link.placement === "secondary" && (link.enabled || link.id === "paypal")),
  };
}

function isBlankSupportValue(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function looksLikeSecretValue(value: string) {
  return RAW_SECRET_VALUE_PATTERN.test(value);
}

function hasSecretLikeSearchData(url: URL) {
  for (const [name, value] of url.searchParams) {
    if (SECRET_PARAM_NAME_PATTERN.test(name) || looksLikeSecretValue(value.trim())) {
      return true;
    }
  }

  return false;
}

export const supportConfig = normalizeSupportConfig({
  VITE_SUPPORT_CASHAPP_URL: import.meta.env.VITE_SUPPORT_CASHAPP_URL,
  VITE_SUPPORT_PAYPAL_URL: import.meta.env.VITE_SUPPORT_PAYPAL_URL,
  VITE_SUPPORT_STRIPE_MONTHLY_URL: import.meta.env.VITE_SUPPORT_STRIPE_MONTHLY_URL,
  VITE_SUPPORT_STRIPE_ONE_TIME_URL: import.meta.env.VITE_SUPPORT_STRIPE_ONE_TIME_URL,
});
