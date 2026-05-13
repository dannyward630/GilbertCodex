import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BadgeDollarSign,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Gauge,
  Image as ImageIcon,
  Layers3,
  Search,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import {
  MODEL_CATALOG_CATEGORIES,
  MODEL_PROVIDERS,
  buildProviderModelOptions,
  supportsProviderThinking,
  type ChatModelOption,
  type ModelCatalogCategoryId,
  type ModelPricing,
  type ProviderModelMetadata,
} from "../../lib/models";
import { formatTokenCount, getFallbackModelContextWindow, type ModelContextWindow, type ModelContextWindowMap } from "../../lib/contextWindow";
import type { ModelProviderId, ProviderSettings } from "../../types/settings";

export type LiveModelCatalogStatus = "error" | "idle" | "loading" | "ready";

interface ModelSelectorPopoverProps {
  anchorRef: RefObject<HTMLElement>;
  liveModelCatalogErrors: Partial<Record<ModelProviderId, string>>;
  liveModelCatalogs: Partial<Record<ModelProviderId, ProviderModelMetadata[]>>;
  liveModelCatalogStatus: Partial<Record<ModelProviderId, LiveModelCatalogStatus>>;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onClose: () => void;
  onModelChange: (model: string, provider: ChatModelOption["provider"]) => void;
  providerSettings: ProviderSettings;
  selectedModel: ChatModelOption;
}

interface ModelSelectorEntry {
  contextWindow: ModelContextWindow;
  option: ChatModelOption;
  provider: (typeof MODEL_PROVIDERS)[number];
  selected: boolean;
}

type ProviderFilter = "all" | ModelProviderId;
type CategoryFilter = "all" | ModelCatalogCategoryId;
type ModelCapabilityFilter = "cloud" | "free" | "image" | "local" | "long-context" | "paid" | "thinking" | "tools";
type ModelSortMode = "context-desc" | "default" | "price-asc" | "price-desc";

interface ModelCapabilityBadge {
  label: string;
  title: string;
  tone: "accent" | "neutral" | "success";
}

const MODEL_CAPABILITY_FILTERS: Array<{ id: ModelCapabilityFilter; label: string; title: string }> = [
  { id: "local", label: "Local", title: "Models served from LM Studio, Ollama, or vLLM" },
  { id: "cloud", label: "Cloud", title: "Models served by a remote provider" },
  { id: "free", label: "Free", title: "Models with free provider pricing or a free model suffix" },
  { id: "paid", label: "Paid", title: "Models that are not marked free" },
  { id: "image", label: "Image", title: "Models that mention image, vision, or multimodal input" },
  { id: "thinking", label: "Thinking", title: "Models/providers that support reasoning or thinking mode" },
  { id: "tools", label: "Tools", title: "Models that mention tool or function calling support" },
  { id: "long-context", label: "200K+ ctx", title: "Models with a context window of at least 200K tokens" },
];

const MODEL_SORT_OPTIONS: Array<{ id: ModelSortMode; label: string }> = [
  { id: "default", label: "Default order" },
  { id: "price-asc", label: "Cheapest first" },
  { id: "price-desc", label: "Most expensive first" },
  { id: "context-desc", label: "Largest context first" },
];

export function ModelSelectorPopover({
  anchorRef,
  liveModelCatalogErrors,
  liveModelCatalogs,
  liveModelCatalogStatus,
  model,
  modelContextWindows,
  onClose,
  onModelChange,
  providerSettings,
  selectedModel,
}: ModelSelectorPopoverProps) {
  const [query, setQuery] = useState("");
  const [catalogReady, setCatalogReady] = useState(false);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [capabilityFilters, setCapabilityFilters] = useState<Partial<Record<ModelCapabilityFilter, boolean>>>({});
  const [sortMode, setSortMode] = useState<ModelSortMode>("default");
  const [expandedCategories, setExpandedCategories] = useState<Record<ModelCatalogCategoryId, boolean>>(() => createInitialExpandedCategories(selectedModel));
  const providerStripRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const selectedFallbackContextWindow = useMemo(
    () =>
      modelContextWindows[selectedModel.value] ??
      (selectedModel.contextWindowTokens
        ? {
            source: "provider" as const,
            tokens: selectedModel.contextWindowTokens,
          }
        : getFallbackModelContextWindow(selectedModel.value)),
    [modelContextWindows, selectedModel.contextWindowTokens, selectedModel.value],
  );
  const selectorEntries = useMemo(
    () => (catalogReady ? buildSelectorEntries(providerSettings, model, liveModelCatalogs, modelContextWindows) : []),
    [catalogReady, liveModelCatalogs, model, modelContextWindows, providerSettings],
  );
  const selectedEntry = selectorEntries.find((entry) => entry.option.value === selectedModel.value && entry.option.provider === providerSettings.provider);
  const selectedContextWindow = selectedEntry?.contextWindow ?? selectedFallbackContextWindow;
  const activeFilterCount =
    Object.values(capabilityFilters).filter(Boolean).length + (providerFilter === "all" ? 0 : 1) + (categoryFilter === "all" ? 0 : 1) + (sortMode === "default" ? 0 : 1);
  const filteredEntries = catalogReady
    ? selectorEntries.filter((entry) => {
        if (providerFilter !== "all" && entry.provider.id !== providerFilter) {
          return false;
        }

        if (categoryFilter !== "all" && resolveModelCategory(entry.option, entry.provider.id) !== categoryFilter) {
          return false;
        }

        return matchesCapabilityFilters(entry, capabilityFilters) && matchesModelSearch(entry, normalizedQuery);
      })
    : [];
  const sortedEntries = sortModelSelectorEntries(filteredEntries, sortMode);
  const categoryGroups = catalogReady ? createVisibleCategoryGroups(sortedEntries, sortMode) : [];
  const providerFilters = catalogReady
    ? MODEL_PROVIDERS.map((provider) => ({
        count: selectorEntries.filter((entry) => entry.provider.id === provider.id).length,
        id: provider.id,
        label: provider.label,
        status: liveModelCatalogStatus[provider.id] ?? "idle",
      })).filter((provider) => provider.count > 0)
    : [];
  const liveNotes = catalogReady ? createLiveCatalogNotes(providerSettings, liveModelCatalogs, liveModelCatalogErrors, liveModelCatalogStatus, providerFilter) : [];
  const floatingPosition = useModelSelectorPosition(anchorRef);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCatalogReady(true));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const selectedCategory = resolveModelCategory(selectedModel, providerSettings.provider);
    setExpandedCategories((current) => ({
      ...current,
      [selectedCategory]: true,
    }));
  }, [providerSettings.provider, selectedModel]);

  function toggleCategory(category: ModelCatalogCategoryId) {
    setExpandedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  function setAllCategories(open: boolean) {
    setExpandedCategories(
      MODEL_CATALOG_CATEGORIES.reduce<Record<ModelCatalogCategoryId, boolean>>(
        (nextCategories, category) => ({
          ...nextCategories,
          [category.id]: open,
        }),
        {} as Record<ModelCatalogCategoryId, boolean>,
      ),
    );
  }

  function toggleCapabilityFilter(filter: ModelCapabilityFilter) {
    setCapabilityFilters((current) => {
      const next = { ...current, [filter]: !current[filter] };

      if (filter === "local" && next.local) {
        next.cloud = false;
      } else if (filter === "cloud" && next.cloud) {
        next.local = false;
      }

      if (filter === "free" && next.free) {
        next.paid = false;
      } else if (filter === "paid" && next.paid) {
        next.free = false;
      }

      return next;
    });
  }

  function scrollProviderTabs(direction: -1 | 1) {
    const strip = providerStripRef.current;

    if (!strip) {
      return;
    }

    strip.scrollLeft += direction * Math.max(160, strip.clientWidth * 0.72);
  }

  const popover = (
    <div className="composer-popover composer-popover-model model-selector-popover" role="dialog" aria-label="Model selector" data-placement={floatingPosition.placement} style={floatingPosition.style}>
      <div className="model-selector-header">
        <div>
          <strong>{selectedEntry?.option.label ?? selectedModel.label}</strong>
          <small>
            {selectedEntry?.provider.label ?? providerSettings.provider} · {formatPricingSummary(selectedEntry?.option.pricing ?? selectedModel.pricing)}
          </small>
        </div>
        <span title={modelContextWindowTitle(selectedContextWindow)}>
          {formatModelContextWindow(selectedContextWindow)}
        </span>
      </div>

      <label className="model-selector-search">
        <Search size={15} aria-hidden="true" />
        <input value={query} placeholder="Search models, providers, use cases" onChange={(event) => setQuery(event.target.value)} />
      </label>

      <div className="model-selector-provider-scroll">
        <button className="model-selector-provider-scroll-button" type="button" aria-label="Scroll providers left" onClick={() => scrollProviderTabs(-1)}>
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <div ref={providerStripRef} className="model-selector-provider-strip" aria-label="Provider filter">
          <button type="button" data-selected={providerFilter === "all"} onClick={() => setProviderFilter("all")}>
            All
            <small>{catalogReady ? selectorEntries.length : "..."}</small>
          </button>
          {providerFilters.map((provider) => (
            <button key={provider.id} type="button" data-selected={providerFilter === provider.id} onClick={() => setProviderFilter(provider.id)}>
              {provider.label}
              <small data-status={provider.status}>{formatProviderCount(provider.count, provider.status)}</small>
            </button>
          ))}
        </div>
        <button className="model-selector-provider-scroll-button" type="button" aria-label="Scroll providers right" onClick={() => scrollProviderTabs(1)}>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="model-selector-filter-chips" aria-label="Model capability filters">
        {MODEL_CAPABILITY_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            title={filter.title}
            data-selected={Boolean(capabilityFilters[filter.id])}
            onClick={() => toggleCapabilityFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="model-selector-filter-row" aria-label="Model category and sort filters">
        <label>
          <span>Category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}>
            <option value="all">All categories</option>
            {MODEL_CATALOG_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as ModelSortMode)}>
            {MODEL_SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {liveNotes.length > 0 ? (
        <div className="model-selector-live-notes" role="status" aria-live="polite">
          {liveNotes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}

      <div className="model-selector-toolbar">
        <span>{catalogReady ? (filteredEntries.length === 1 ? "1 model" : `${filteredEntries.length} models`) : "Preparing models"}</span>
        <div>
          <button type="button" disabled={!catalogReady} onClick={() => setAllCategories(true)}>
            Expand all
          </button>
          <button type="button" disabled={!catalogReady} onClick={() => setAllCategories(false)}>
            Collapse all
          </button>
          <button
            type="button"
            disabled={!catalogReady || activeFilterCount === 0}
            onClick={() => {
              setCapabilityFilters({});
              setProviderFilter("all");
              setCategoryFilter("all");
              setSortMode("default");
            }}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="model-selector-categories">
        {!catalogReady ? (
          <div className="model-selector-loading" role="status">
            Preparing model list...
          </div>
        ) : categoryGroups.length > 0 ? (
          categoryGroups.map((category) => {
            const open = normalizedQuery || categoryFilter !== "all" || sortMode !== "default" ? true : expandedCategories[category.id];
            const Icon = iconForCategory(category.id);

            return (
              <section className="model-selector-category" key={category.id}>
                <button className="model-selector-category-toggle" type="button" aria-expanded={open} onClick={() => toggleCategory(category.id)}>
                  {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{category.label}</strong>
                    <small>{category.description}</small>
                  </span>
                  <em>{category.entries.length}</em>
                </button>
                {open ? (
                  <div className="model-selector-list">
                    {category.entries.map((entry) => (
                      <ModelSelectorRow
                        entry={entry}
                        key={`${entry.option.provider}:${entry.option.id}`}
                        onSelect={() => {
                          onModelChange(entry.option.value, entry.option.provider);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })
        ) : (
          <div className="model-selector-empty">No matching models.</div>
        )}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}

function createVisibleCategoryGroups(entries: ModelSelectorEntry[], sortMode: ModelSortMode) {
  if (sortMode !== "default") {
    return [
      {
        description: getSortModeDescription(sortMode),
        entries,
        id: "general" as ModelCatalogCategoryId,
        label: getSortModeLabel(sortMode),
      },
    ].filter((category) => category.entries.length > 0);
  }

  return MODEL_CATALOG_CATEGORIES.map((category) => ({
    ...category,
    entries: entries.filter((entry) => resolveModelCategory(entry.option, entry.provider.id) === category.id),
  })).filter((category) => category.entries.length > 0);
}

function sortModelSelectorEntries(entries: ModelSelectorEntry[], sortMode: ModelSortMode) {
  if (sortMode === "default") {
    return entries;
  }

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => compareModelSelectorEntries(left.entry, right.entry, sortMode) || left.index - right.index)
    .map((item) => item.entry);
}

function compareModelSelectorEntries(left: ModelSelectorEntry, right: ModelSelectorEntry, sortMode: ModelSortMode) {
  if (sortMode === "context-desc") {
    return right.contextWindow.tokens - left.contextWindow.tokens || compareModelLabels(left, right);
  }

  const leftPrice = getModelPriceSortValue(left.option);
  const rightPrice = getModelPriceSortValue(right.option);
  const priceComparison = compareNullableNumbers(leftPrice, rightPrice, sortMode === "price-desc" ? "desc" : "asc");

  return priceComparison || compareModelLabels(left, right);
}

function compareNullableNumbers(left: number | null, right: number | null, direction: "asc" | "desc") {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === "asc" ? left - right : right - left;
}

function compareModelLabels(left: ModelSelectorEntry, right: ModelSelectorEntry) {
  return left.option.label.localeCompare(right.option.label);
}

function getModelPriceSortValue(option: ChatModelOption) {
  const text = getModelSearchText(option);

  if (isFreeModel(option, text)) {
    return 0;
  }

  const input = option.pricing?.inputPerMillionTokens;
  const output = option.pricing?.outputPerMillionTokens;
  const values = [input, output].filter((value): value is number => typeof value === "number");

  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function getSortModeLabel(sortMode: ModelSortMode) {
  return MODEL_SORT_OPTIONS.find((option) => option.id === sortMode)?.label ?? "Sorted models";
}

function getSortModeDescription(sortMode: ModelSortMode) {
  if (sortMode === "context-desc") {
    return "Visible models sorted by largest context window.";
  }

  if (sortMode === "price-desc") {
    return "Visible models sorted by highest known input plus output price.";
  }

  return "Visible models sorted from cheapest to most expensive known price.";
}

function ModelSelectorRow({ entry, onSelect }: { entry: ModelSelectorEntry; onSelect: () => void }) {
  const category = resolveModelCategory(entry.option, entry.provider.id);
  const Icon = iconForCategory(category);
  const useCase = entry.option.useCase || entry.option.detail;
  const badges = createModelCapabilityBadges(entry);

  return (
    <button
      className="model-selector-row"
      type="button"
      role="menuitemradio"
      aria-checked={entry.selected}
      data-selected={entry.selected}
      onClick={onSelect}
    >
      <span className="model-selector-row-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="model-selector-row-main">
        <strong>
          <span>{entry.option.label}</span>
          <em>{entry.provider.label}</em>
        </strong>
        <small>{useCase}</small>
        <span className="model-selector-badges">
          {badges.map((badge) => (
            <i key={badge.label} title={badge.title} data-tone={badge.tone}>
              {badge.label}
            </i>
          ))}
        </span>
      </span>
      {entry.selected ? <Check size={18} aria-hidden="true" /> : null}
    </button>
  );
}

function useModelSelectorPosition(anchorRef: RefObject<HTMLElement>) {
  const [position, setPosition] = useState<{ placement: "above" | "below"; style: CSSProperties }>(() => ({
    placement: "above",
    style: {
      opacity: 0,
      pointerEvents: "none",
      position: "fixed",
    },
  }));

  useLayoutEffect(() => {
    let positionFrame: number | null = null;

    function updatePosition() {
      const anchor = anchorRef.current;

      if (!anchor) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const bounds = getModelSelectorBounds(anchor);
      const gap = 10;
      const availableWidth = Math.max(280, bounds.right - bounds.left);
      const width = Math.min(760, availableWidth);
      const preferredLeft = anchorRect.right - width;
      const left = clamp(preferredLeft, bounds.left, bounds.right - width);
      const availableAbove = anchorRect.top - bounds.top - gap;
      const availableBelow = bounds.bottom - anchorRect.bottom - gap;
      const placeAbove = availableAbove >= 280 || availableAbove >= availableBelow;
      const availableHeight = Math.max(220, placeAbove ? availableAbove : availableBelow);
      const maxHeight = Math.min(620, availableHeight);

      setPosition({
        placement: placeAbove ? "above" : "below",
        style: {
          bottom: placeAbove ? `${window.innerHeight - anchorRect.top + gap}px` : undefined,
          height: `${maxHeight}px`,
          left: `${left}px`,
          maxHeight: `${maxHeight}px`,
          maxWidth: `${width}px`,
          opacity: 1,
          pointerEvents: "auto",
          position: "fixed",
          right: "auto",
          top: placeAbove ? undefined : `${anchorRect.bottom + gap}px`,
          width: `${width}px`,
        },
      });
    }

    function schedulePositionUpdate() {
      if (positionFrame !== null) {
        return;
      }

      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        updatePosition();
      });
    }

    updatePosition();
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    return () => {
      if (positionFrame !== null) {
        window.cancelAnimationFrame(positionFrame);
      }

      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [anchorRef]);

  return position;
}

function getModelSelectorBounds(anchor: HTMLElement) {
  const workspaceRect = anchor.closest(".conversation-main")?.getBoundingClientRect() ?? anchor.closest(".app-main")?.getBoundingClientRect();
  const viewportRect = {
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
  };
  const sidebarRect = getVisibleRect(document.querySelector('.shell-sidebar[data-open="true"]'));
  const rightOverlayRect =
    getVisibleRect(document.querySelector(".right-rail")) ??
    getVisibleRect(document.querySelector(".browser-preview-panel")) ??
    getVisibleRect(document.querySelector(".git-review-panel"));
  const rawBounds = workspaceRect
    ? {
        bottom: Math.min(workspaceRect.bottom, viewportRect.bottom),
        left: Math.max(workspaceRect.left, viewportRect.left),
        right: Math.min(workspaceRect.right, viewportRect.right),
        top: Math.max(workspaceRect.top, viewportRect.top),
      }
    : viewportRect;
  const sidebarRight = sidebarRect && sidebarRect.right > rawBounds.left && sidebarRect.left <= rawBounds.left ? sidebarRect.right : rawBounds.left;
  const overlayLeft = rightOverlayRect && rightOverlayRect.left < rawBounds.right && rightOverlayRect.right >= rawBounds.right ? rightOverlayRect.left : rawBounds.right;
  const margin = 12;

  return {
    bottom: Math.max(rawBounds.top + 240, rawBounds.bottom - margin),
    left: Math.min(rawBounds.right - 280, Math.max(rawBounds.left, sidebarRight) + margin),
    right: Math.max(rawBounds.left + 280, Math.min(rawBounds.right, overlayLeft) - margin),
    top: rawBounds.top + margin,
  };
}

function getVisibleRect(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const style = window.getComputedStyle(element);

  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function buildSelectorEntries(
  providerSettings: ProviderSettings,
  currentModel: string,
  liveModelCatalogs: Partial<Record<ModelProviderId, ProviderModelMetadata[]>>,
  modelContextWindows: ModelContextWindowMap,
): ModelSelectorEntry[] {
  return MODEL_PROVIDERS.flatMap((provider) => {
    const providerModel = provider.id === providerSettings.provider ? currentModel : providerSettings.providerModels[provider.id] || provider.defaultModel;
    const providerOptions = buildProviderModelOptions(provider.id, liveModelCatalogs[provider.id], providerModel);

    return providerOptions.map((option) => ({
      contextWindow:
        modelContextWindows[option.value] ??
        (option.contextWindowTokens
          ? {
              source: "provider" as const,
              tokens: option.contextWindowTokens,
            }
          : getFallbackModelContextWindow(option.value)),
      option,
      provider,
      selected: option.value === currentModel.trim() && option.provider === providerSettings.provider,
    }));
  });
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function matchesModelSearch(entry: ModelSelectorEntry, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  return [
    entry.option.label,
    entry.option.value,
    entry.option.detail,
    entry.option.useCase,
    entry.provider.label,
    ...createModelCapabilityBadges(entry).map((badge) => badge.label),
    ...(entry.option.capabilities ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function matchesCapabilityFilters(entry: ModelSelectorEntry, filters: Partial<Record<ModelCapabilityFilter, boolean>>) {
  return MODEL_CAPABILITY_FILTERS.every((filter) => {
    if (!filters[filter.id]) {
      return true;
    }

    return modelMatchesCapabilityFilter(entry, filter.id);
  });
}

function modelMatchesCapabilityFilter(entry: ModelSelectorEntry, filter: ModelCapabilityFilter) {
  const text = getModelSearchText(entry.option);

  if (filter === "local") {
    return isLocalProvider(entry.provider.id);
  }

  if (filter === "cloud") {
    return !isLocalProvider(entry.provider.id);
  }

  if (filter === "free") {
    return isFreeModel(entry.option, text);
  }

  if (filter === "paid") {
    return !isFreeModel(entry.option, text);
  }

  if (filter === "image") {
    return isImageModel(entry.option, text);
  }

  if (filter === "thinking") {
    return isThinkingModel(entry.option, entry.provider.id, text);
  }

  if (filter === "tools") {
    return isToolCallingModel(entry.option, text);
  }

  return entry.contextWindow.tokens >= 200_000;
}

function createModelCapabilityBadges(entry: ModelSelectorEntry): ModelCapabilityBadge[] {
  const text = getModelSearchText(entry.option);
  const free = isFreeModel(entry.option, text);
  const thinking = isThinkingModel(entry.option, entry.provider.id, text);
  const image = isImageModel(entry.option, text);
  const tools = isToolCallingModel(entry.option, text);
  const local = isLocalProvider(entry.provider.id);
  const badges: ModelCapabilityBadge[] = [
    {
      label: local ? "Local" : "Cloud",
      title: local ? "Runs through a local provider" : "Runs through a hosted provider",
      tone: local ? "success" : "neutral",
    },
    {
      label: free ? "Free" : formatPricingSummary(entry.option.pricing),
      title: formatPricingTitle(entry.option.pricing),
      tone: free ? "success" : "neutral",
    },
    {
      label: formatModelContextWindow(entry.contextWindow),
      title: modelContextWindowTitle(entry.contextWindow),
      tone: entry.contextWindow.tokens >= 200_000 ? "accent" : "neutral",
    },
  ];

  if (thinking) {
    badges.push({ label: "Thinking", title: "Supports reasoning or thinking mode", tone: "accent" });
  }

  if (image) {
    badges.push({ label: "Image", title: "Mentions image, vision, or multimodal support", tone: "accent" });
  }

  if (tools) {
    badges.push({ label: "Tools", title: "Mentions tool or function calling support", tone: "accent" });
  }

  for (const capability of entry.option.capabilities ?? []) {
    if (badges.length >= 7) {
      break;
    }

    if (!badges.some((badge) => badge.label.toLowerCase() === capability.toLowerCase())) {
      badges.push({ label: capability, title: capability, tone: "neutral" });
    }
  }

  return badges;
}

function getModelSearchText(option: ChatModelOption) {
  return `${option.label} ${option.value} ${option.detail} ${option.useCase ?? ""} ${(option.capabilities ?? []).join(" ")}`.toLowerCase();
}

function isLocalProvider(providerId: ModelProviderId) {
  return providerId === "lmstudio" || providerId === "ollama" || providerId === "vllm";
}

function resolveModelCategory(option: ChatModelOption, providerId: ModelProviderId): ModelCatalogCategoryId {
  if (option.category === "recommended") {
    return option.category;
  }

  if (isLocalProvider(providerId)) {
    return "local";
  }

  const text = getModelSearchText(option);

  if (isFreeModel(option, text)) {
    return "free";
  }

  if (isToolCallingModel(option, text)) {
    return "tool-calling";
  }

  if (option.category) {
    return option.category;
  }

  if (/image|vision|audio|video|multimodal|omni/.test(text)) {
    return "multimodal";
  }

  if (/code|coding|agent|software|devstral|laguna|cobuddy/.test(text)) {
    return "coding";
  }

  if (/reason|thinking|opus|pro|ring|research/.test(text)) {
    return "reasoning";
  }

  if (option.contextWindowTokens && option.contextWindowTokens >= 1_000_000) {
    return "long-context";
  }

  if (/mini|nano|flash|lite|haiku|small|fast|free|20b|xs/.test(text)) {
    return "fast";
  }

  return "general";
}

function isToolCallingModel(option: ChatModelOption, text: string) {
  const capabilityText = (option.capabilities ?? []).join(" ").toLowerCase();

  return (
    /\btools?\b|tool[-\s]?calling|tool[-\s]?use|tool[-\s]?calls|tool_choice|function[-\s]?calling|function[-\s]?calls|code execution|browser automation/.test(capabilityText) ||
    /\btools?\b|tool[-\s]?calling|tool[-\s]?use|tool[-\s]?calls|tool_choice|function[-\s]?calling|function[-\s]?calls|code execution|browser automation/.test(text)
  );
}

function isImageModel(_option: ChatModelOption, text: string) {
  return /\bimage\b|\bvision\b|multimodal|multi-modal|omni|visual input|image input|screenshots?/.test(text);
}

function isThinkingModel(option: ChatModelOption, providerId: ModelProviderId, text: string) {
  if (/\breason(?:ing)?\b|thinking|chain[-\s]?of[-\s]?thought|deliberate|research|analysis/.test(text)) {
    return true;
  }

  if (providerId === "openrouter" || isLocalProvider(providerId)) {
    return false;
  }

  return supportsProviderThinking(providerId, "medium", option.value);
}

function isFreeModel(option: ChatModelOption, text: string) {
  const pricing = option.pricing;
  const freePricing = pricing && pricing.inputPerMillionTokens === 0 && pricing.outputPerMillionTokens === 0;

  return Boolean(freePricing || option.value.endsWith(":free") || /\bfree\b|no-cost|cost-free/.test(text));
}

function createInitialExpandedCategories(selectedModel: ChatModelOption) {
  const selectedCategory = resolveModelCategory(selectedModel, selectedModel.provider);

  return MODEL_CATALOG_CATEGORIES.reduce<Record<ModelCatalogCategoryId, boolean>>(
    (categories, category) => ({
      ...categories,
      [category.id]: category.id === "recommended" || category.id === selectedCategory,
    }),
    {} as Record<ModelCatalogCategoryId, boolean>,
  );
}

function iconForCategory(category: ModelCatalogCategoryId) {
  if (category === "free") {
    return BadgeDollarSign;
  }

  if (category === "tool-calling") {
    return Wrench;
  }

  if (category === "coding") {
    return Code2;
  }

  if (category === "reasoning") {
    return BrainCircuit;
  }

  if (category === "fast") {
    return Zap;
  }

  if (category === "long-context") {
    return Layers3;
  }

  if (category === "multimodal") {
    return ImageIcon;
  }

  if (category === "local") {
    return Gauge;
  }

  return Sparkles;
}

function formatModelContextWindow(contextWindow: ModelContextWindow) {
  const suffix = contextWindow.source === "openrouter" || contextWindow.source === "provider" ? "" : " est.";

  return `${formatTokenCount(contextWindow.tokens)} ctx${suffix}`;
}

function modelContextWindowTitle(contextWindow: ModelContextWindow) {
  return contextWindow.source === "openrouter" || contextWindow.source === "provider" ? "Context window reported by the selected provider" : "Estimated context window until provider metadata is available";
}

function formatPricingSummary(pricing: ModelPricing | undefined) {
  if (!pricing) {
    return "Price n/a";
  }

  const input = pricing.inputPerMillionTokens;
  const output = pricing.outputPerMillionTokens;

  if (input === 0 && output === 0) {
    return "Free";
  }

  if (typeof input === "number" && typeof output === "number") {
    return `${formatUsd(input)} in / ${formatUsd(output)} out`;
  }

  if (pricing.note) {
    return "Variable";
  }

  if (typeof input === "number") {
    return `${formatUsd(input)} in`;
  }

  if (typeof output === "number") {
    return `${formatUsd(output)} out`;
  }

  return "Price n/a";
}

function formatPricingTitle(pricing: ModelPricing | undefined) {
  if (!pricing) {
    return "No provider pricing metadata available for this model.";
  }

  const parts = [
    pricing.sourceLabel || (pricing.source === "openrouter" ? "OpenRouter" : "Provider"),
    typeof pricing.inputPerMillionTokens === "number" ? `input ${formatUsd(pricing.inputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.cachedInputPerMillionTokens === "number" ? `cached input ${formatUsd(pricing.cachedInputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.outputPerMillionTokens === "number" ? `output ${formatUsd(pricing.outputPerMillionTokens)} per 1M tokens` : "",
    typeof pricing.webSearchUsd === "number" ? `web search ${formatUsd(pricing.webSearchUsd)} per operation` : "",
    pricing.note || "",
  ].filter(Boolean);

  return parts.join(" · ");
}

function formatUsd(value: number) {
  const maximumFractionDigits = value < 0.01 && value > 0 ? 6 : value < 1 ? 3 : 2;

  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: value >= 1 ? 2 : 0,
  })}`;
}

function formatProviderCount(count: number, status: LiveModelCatalogStatus) {
  if (status === "loading") {
    return count > 0 ? `${count}` : "loading";
  }

  if (status === "error") {
    return count > 0 ? `${count} cached` : "offline";
  }

  return `${count}`;
}

function createLiveCatalogNotes(
  providerSettings: ProviderSettings,
  liveModelCatalogs: Partial<Record<ModelProviderId, ProviderModelMetadata[]>>,
  liveModelCatalogErrors: Partial<Record<ModelProviderId, string>>,
  liveModelCatalogStatus: Partial<Record<ModelProviderId, LiveModelCatalogStatus>>,
  providerFilter: ProviderFilter,
) {
  return MODEL_PROVIDERS.flatMap((provider) => {
    if (providerFilter !== "all" && providerFilter !== provider.id) {
      return [];
    }

    const status = liveModelCatalogStatus[provider.id] ?? "idle";

    if (providerFilter === "all" && provider.id !== providerSettings.provider) {
      return [];
    }

    if (status !== "loading" && status !== "error") {
      return [];
    }

    const count = liveModelCatalogs[provider.id]?.length ?? 0;
    const baseUrl = providerSettings.baseUrls[provider.id] || provider.defaultBaseUrl;
    const note = createLiveCatalogNote(provider.label, baseUrl, status, liveModelCatalogErrors[provider.id], count);

    return note ? [note] : [];
  });
}

function createLiveCatalogNote(providerLabel: string, baseUrl: string, status: LiveModelCatalogStatus, error: string | undefined, modelCount: number) {
  const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`;

  if (status === "loading") {
    return modelCount > 0 ? "" : `Loading ${providerLabel} models from ${modelsUrl}`;
  }

  if (status === "error") {
    return isOfflineCatalogError(error) ? formatOfflineCatalogNote(providerLabel, baseUrl) : error || `No model list from ${modelsUrl}.`;
  }

  if (status === "ready" && modelCount === 0) {
    return `${providerLabel} is reachable but returned no loaded models.`;
  }

  return "";
}

function isOfflineCatalogError(error: string | null | undefined) {
  const normalizedError = error?.toLowerCase().trim();

  if (!normalizedError) {
    return true;
  }

  return [
    "failed to fetch",
    "fetch failed",
    "networkerror",
    "load failed",
    "connection refused",
    "err_connection",
    "err_network",
  ].some((offlineSignal) => normalizedError.includes(offlineSignal));
}

function formatOfflineCatalogNote(providerLabel: string, baseUrl: string) {
  return `Offline. Start ${providerLabel} and check ${baseUrl.replace(/\/+$/, "")}.`;
}
