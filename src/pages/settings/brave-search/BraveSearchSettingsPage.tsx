import { CheckCircle2, Database, ExternalLink, Eye, EyeOff, Filter, Globe2, Images, KeyRound, MapPin, Newspaper, Search, ShieldCheck, SlidersHorizontal, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { formatWebSearchErrorMessage, searchBrave } from "../../../services/webSearchClient";
import {
  DEFAULT_BRAVE_SEARCH_SETTINGS,
  WEB_SEARCH_PROVIDER_LABELS,
  type BraveSearchFreshness,
  type BraveSearchResultFilter,
  type BraveSearchSafeSearch,
  type BraveSearchSettings,
  type BraveSearchUnits,
  type ProviderSettings,
  type WebSearchSettings,
} from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface BraveSearchSettingsPageProps {
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

const resultFilterOptions: Array<{ id: BraveSearchResultFilter; label: string }> = [
  { id: "web", label: "Web" },
  { id: "news", label: "News" },
  { id: "videos", label: "Videos" },
  { id: "discussions", label: "Discussions" },
  { id: "faq", label: "FAQ" },
  { id: "infobox", label: "Infobox" },
  { id: "locations", label: "Locations" },
  { id: "query", label: "Query" },
  { id: "summarizer", label: "Summarizer" },
];

const freshnessOptions: Array<{ id: BraveSearchFreshness; label: string }> = [
  { id: "any", label: "Any" },
  { id: "pd", label: "24 h" },
  { id: "pw", label: "7 d" },
  { id: "pm", label: "31 d" },
  { id: "py", label: "Year" },
  { id: "custom", label: "Custom" },
];

const safesearchOptions: Array<{ id: BraveSearchSafeSearch; label: string }> = [
  { id: "off", label: "Off" },
  { id: "moderate", label: "Moderate" },
  { id: "strict", label: "Strict" },
];

const unitsOptions: Array<{ id: BraveSearchUnits; label: string }> = [
  { id: "imperial", label: "Imperial" },
  { id: "metric", label: "Metric" },
];

export function BraveSearchSettingsPage({ onSettingsPatch, settings }: BraveSearchSettingsPageProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<SettingsStatusMessage | null>(null);
  const webSearch = settings.webSearch;
  const brave = webSearch.brave;

  function updateWebSearch(patch: Partial<WebSearchSettings>) {
    onSettingsPatch({
      webSearch: {
        ...webSearch,
        ...patch,
        brave: {
          ...webSearch.brave,
          ...(patch.brave ?? {}),
        },
      },
    });
    setTestStatus(null);
  }

  function updateBraveSearch(patch: Partial<BraveSearchSettings>) {
    updateWebSearch({
      brave: {
        ...brave,
        ...patch,
      },
    });
  }

  function toggleResultFilter(filter: BraveSearchResultFilter) {
    const selected = brave.resultFilter.includes(filter);
    updateBraveSearch({
      resultFilter: selected ? brave.resultFilter.filter((item) => item !== filter) : [...brave.resultFilter, filter],
    });
  }

  async function testBraveSearch() {
    setTesting(true);
    setTestStatus(null);

    try {
      const results = await searchBrave("Brave Search API documentation", brave, {
        maxResults: Math.min(Math.max(webSearch.maxResults, 1), 3),
      });

      setTestStatus({
        kind: "success",
        text: `Brave Search returned ${results.length} source${results.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setTestStatus({
        kind: "error",
        text: formatWebSearchErrorMessage(error, "Brave Search test failed."),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Configure the web-search provider, Brave API key, and Brave API request options." icon={Search} title="Brave Search" />
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Globe2 size={19} aria-hidden="true" />
            <div>
              <h2>Web provider</h2>
              <p>Brave is tried first when selected; DuckDuckGo fallback is limited to transient failures or no-source results so Brave setup errors stay visible.</p>
            </div>
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Web search provider">
            {(["duckduckgo", "brave"] as WebSearchSettings["provider"][]).map((provider) => (
              <button
                key={provider}
                type="button"
                role="radio"
                aria-checked={webSearch.provider === provider}
                data-selected={webSearch.provider === provider}
                onClick={() => updateWebSearch({ provider })}
              >
                {WEB_SEARCH_PROVIDER_LABELS[provider]}
              </button>
            ))}
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>Default web search</span>
              <strong>{webSearch.enabled ? "Enabled in the composer" : "Off until selected"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={webSearch.enabled}
                data-on={webSearch.enabled}
                onClick={() => updateWebSearch({ enabled: !webSearch.enabled })}
              >
                <span />
              </button>
            </div>
            <div className="settings-row">
              <span>Sources per call</span>
              <strong>{webSearch.maxResults}</strong>
              <input
                aria-label="Sources per web search"
                max={12}
                min={1}
                type="number"
                value={webSearch.maxResults}
                onChange={(event) =>
                  updateWebSearch({
                    maxResults: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 1, 1), 12),
                  })
                }
              />
            </div>
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>Brave API key</h2>
              <p>Stored locally and sent only to the desktop Tauri search command.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>API key</span>
            <div className="settings-secret-row">
              <input
                autoComplete="off"
                placeholder="BSA..."
                type={showApiKey ? "text" : "password"}
                value={brave.apiKey}
                onChange={(event) => updateBraveSearch({ apiKey: event.target.value })}
              />
              <button type="button" aria-label={showApiKey ? "Hide Brave API key" : "Show Brave API key"} onClick={() => setShowApiKey((visible) => !visible)}>
                {showApiKey ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
              <button type="button" aria-label="Clear Brave API key" disabled={!brave.apiKey.trim()} onClick={() => updateBraveSearch({ apiKey: "" })}>
                <Trash2 size={17} aria-hidden="true" />
              </button>
            </div>
          </label>

          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" disabled={testing} onClick={testBraveSearch}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {testing ? "Testing" : "Test Brave"}
            </button>
            <a className="settings-ghost-button" href="https://api-dashboard.search.brave.com/api-reference/web/search/get" rel="noreferrer" target="_blank">
              <ExternalLink size={16} aria-hidden="true" />
              API docs
            </a>
            {testStatus ? (
              <span className="settings-status" data-kind={testStatus.kind}>
                {testStatus.text}
              </span>
            ) : null}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Localization</h2>
              <p>Country, language, safe-search, and units sent with Brave requests.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Country</span>
            <input maxLength={2} value={brave.country} onChange={(event) => updateBraveSearch({ country: event.target.value })} />
          </label>
          <label className="settings-field">
            <span>Search language</span>
            <input value={brave.searchLang} onChange={(event) => updateBraveSearch({ searchLang: event.target.value })} />
          </label>
          <label className="settings-field">
            <span>UI language</span>
            <input value={brave.uiLang} onChange={(event) => updateBraveSearch({ uiLang: event.target.value })} />
          </label>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Brave safe search">
            {safesearchOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={brave.safesearch === option.id} data-selected={brave.safesearch === option.id} onClick={() => updateBraveSearch({ safesearch: option.id })}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Brave units">
            {unitsOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={brave.units === option.id} data-selected={brave.units === option.id} onClick={() => updateBraveSearch({ units: option.id })}>
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <SlidersHorizontal size={19} aria-hidden="true" />
            <div>
              <h2>Freshness</h2>
              <p>Use Brave's documented freshness presets or a date range.</p>
            </div>
          </div>

          <div className="settings-segmented-control" role="radiogroup" aria-label="Brave freshness">
            {freshnessOptions.map((option) => (
              <button key={option.id} type="button" role="radio" aria-checked={brave.freshness === option.id} data-selected={brave.freshness === option.id} onClick={() => updateBraveSearch({ freshness: option.id })}>
                {option.label}
              </button>
            ))}
          </div>

          <label className="settings-field">
            <span>Start date</span>
            <input disabled={brave.freshness !== "custom"} type="date" value={brave.freshnessStartDate} onChange={(event) => updateBraveSearch({ freshnessStartDate: event.target.value })} />
          </label>
          <label className="settings-field">
            <span>End date</span>
            <input disabled={brave.freshness !== "custom"} type="date" value={brave.freshnessEndDate} onChange={(event) => updateBraveSearch({ freshnessEndDate: event.target.value })} />
          </label>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Filter size={19} aria-hidden="true" />
            <div>
              <h2>Result shape</h2>
              <p>Match Brave API response filters and optional result formatting.</p>
            </div>
          </div>

          <div className="settings-row-list">
            {[
              { key: "extraSnippets", label: "Extra snippets", value: brave.extraSnippets },
              { key: "spellcheck", label: "Spellcheck", value: brave.spellcheck },
              { key: "textDecorations", label: "Text decorations", value: brave.textDecorations },
              { key: "operators", label: "Search operators", value: brave.operators },
              { key: "summary", label: "Summary field", value: brave.summary },
              { key: "enableSemanticRerank", label: "Vector rerank", value: brave.enableSemanticRerank },
            ].map((option) => (
              <div className="settings-row" key={option.key}>
                <span>{option.label}</span>
                <strong>{option.value ? "On" : "Off"}</strong>
                <button
                  className="settings-switch"
                  type="button"
                  role="switch"
                  aria-checked={option.value}
                  data-on={option.value}
                  onClick={() => updateBraveSearch({ [option.key]: !option.value } as Partial<BraveSearchSettings>)}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>

          <div className="settings-row-list">
            <div className="settings-row">
              <span>Result filter</span>
              <strong>{brave.resultFilter.length > 0 ? brave.resultFilter.join(", ") : "All available types"}</strong>
              <button type="button" className="settings-ghost-button" onClick={() => updateBraveSearch({ resultFilter: DEFAULT_BRAVE_SEARCH_SETTINGS.resultFilter })}>
                Reset
              </button>
            </div>
            {resultFilterOptions.map((option) => {
              const selected = brave.resultFilter.includes(option.id);

              return (
                <div className="settings-row" key={option.id}>
                  <span>{option.label}</span>
                  <strong>{selected ? "Included" : "Use default"}</strong>
                  <button className="settings-switch" type="button" role="switch" aria-checked={selected} data-on={selected} onClick={() => toggleResultFilter(option.id)}>
                    <span />
                  </button>
                </div>
              );
            })}
          </div>

          <label className="settings-field">
            <span>Goggles</span>
            <textarea rows={3} value={brave.goggles} onChange={(event) => updateBraveSearch({ goggles: event.target.value })} />
          </label>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Images size={19} aria-hidden="true" />
            <div>
              <h2>Brave verticals</h2>
              <p>Dedicated Brave endpoints mixed into normal chat search. Tool-calling keeps images hidden.</p>
            </div>
          </div>

          <div className="settings-row-list">
            {[
              { countKey: "newsResultCount", icon: Newspaper, key: "enableNewsSearch", label: "News search", value: brave.enableNewsSearch },
              { countKey: "videoResultCount", icon: Video, key: "enableVideoSearch", label: "Video search", value: brave.enableVideoSearch },
              { countKey: "imageResultCount", icon: Images, key: "enableImageSearch", label: "Image search", value: brave.enableImageSearch },
              { countKey: "placeResultCount", icon: MapPin, key: "enablePlaceSearch", label: "Place search", value: brave.enablePlaceSearch },
            ].map((option) => {
              const Icon = option.icon;
              const countValue = brave[option.countKey as keyof BraveSearchSettings] as number;

              return (
                <div className="settings-row" key={option.key}>
                  <span><Icon size={15} aria-hidden="true" /> {option.label}</span>
                  <strong>{option.value ? `${countValue} results` : "Off"}</strong>
                  <input
                    aria-label={`${option.label} result count`}
                    max={24}
                    min={1}
                    type="number"
                    value={countValue}
                    onChange={(event) => updateBraveSearch({ [option.countKey]: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 1, 1), 24) } as Partial<BraveSearchSettings>)}
                  />
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={option.value}
                    data-on={option.value}
                    onClick={() => updateBraveSearch({ [option.key]: !option.value } as Partial<BraveSearchSettings>)}
                  >
                    <span />
                  </button>
                </div>
              );
            })}
            <div className="settings-row">
              <span>Show image cards</span>
              <strong>{brave.showImageResults ? "Normal chat only" : "Hidden"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={brave.showImageResults}
                data-on={brave.showImageResults}
                onClick={() => updateBraveSearch({ showImageResults: !brave.showImageResults })}
              >
                <span />
              </button>
            </div>
            <div className="settings-row">
              <span>Brave Answers</span>
              <strong>{brave.enableAnswers ? brave.answersModel : "Off"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={brave.enableAnswers}
                data-on={brave.enableAnswers}
                onClick={() => updateBraveSearch({ enableAnswers: !brave.enableAnswers })}
              >
                <span />
              </button>
            </div>
          </div>

          <div className="settings-section-grid">
            <div className="settings-segmented-control" role="radiogroup" aria-label="Brave Answers model">
              {(["brave", "brave-pro"] as const).map((model) => (
                <button key={model} type="button" role="radio" aria-checked={brave.answersModel === model} data-selected={brave.answersModel === model} onClick={() => updateBraveSearch({ answersModel: model })}>
                  {model}
                </button>
              ))}
            </div>
            <label className="settings-field">
              <span>Answers tokens</span>
              <input
                max={4000}
                min={128}
                type="number"
                value={brave.answersMaxCompletionTokens}
                onChange={(event) => updateBraveSearch({ answersMaxCompletionTokens: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 700, 128), 4000) })}
              />
            </label>
            <label className="settings-field">
              <span>Place location</span>
              <input placeholder="Optional city, address, or area" value={brave.placeLocation} onChange={(event) => updateBraveSearch({ placeLocation: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Place radius meters</span>
              <input
                max={50000}
                min={1}
                type="number"
                value={brave.placeRadiusMeters}
                onChange={(event) => updateBraveSearch({ placeRadiusMeters: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 2500, 1), 50000) })}
              />
            </label>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Database size={19} aria-hidden="true" />
            <div>
              <h2>Request controls</h2>
              <p>Advanced Brave API query parameters and headers.</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Offset</span>
            <input
              max={9}
              min={0}
              type="number"
              value={brave.offset}
              onChange={(event) =>
                updateBraveSearch({
                  offset: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 0, 0), 9),
                })
              }
            />
          </label>
          <label className="settings-field">
            <span>API version</span>
            <input placeholder="YYYY-MM-DD" type="date" value={brave.apiVersion} onChange={(event) => updateBraveSearch({ apiVersion: event.target.value })} />
          </label>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Brave request method">
            {(["get", "post"] as const).map((method) => (
              <button key={method} type="button" role="radio" aria-checked={brave.requestMethod === method} data-selected={brave.requestMethod === method} onClick={() => updateBraveSearch({ requestMethod: method })}>
                {method.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="settings-row-list">
            {[
              { key: "enableRichCallback", label: "Rich callback", value: brave.enableRichCallback },
              { key: "includeFetchMetadata", label: "Fetch metadata", value: brave.includeFetchMetadata },
              { key: "cacheControlNoCache", label: "No-cache header", value: brave.cacheControlNoCache },
            ].map((option) => (
              <div className="settings-row" key={option.key}>
                <span>{option.label}</span>
                <strong>{option.value ? "On" : "Off"}</strong>
                <button
                  className="settings-switch"
                  type="button"
                  role="switch"
                  aria-checked={option.value}
                  data-on={option.value}
                  onClick={() => updateBraveSearch({ [option.key]: !option.value } as Partial<BraveSearchSettings>)}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <MapPin size={19} aria-hidden="true" />
            <div>
              <h2>Location headers</h2>
              <p>Optional Brave local-result headers. Leave blank to omit them.</p>
            </div>
          </div>

          <div className="settings-section-grid">
            <label className="settings-field">
              <span>Latitude</span>
              <input value={brave.locationLatitude} onChange={(event) => updateBraveSearch({ locationLatitude: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Longitude</span>
              <input value={brave.locationLongitude} onChange={(event) => updateBraveSearch({ locationLongitude: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Timezone</span>
              <input placeholder="America/New_York" value={brave.locationTimezone} onChange={(event) => updateBraveSearch({ locationTimezone: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>City</span>
              <input value={brave.locationCity} onChange={(event) => updateBraveSearch({ locationCity: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>State code</span>
              <input maxLength={3} value={brave.locationState} onChange={(event) => updateBraveSearch({ locationState: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>State name</span>
              <input value={brave.locationStateName} onChange={(event) => updateBraveSearch({ locationStateName: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Country</span>
              <input maxLength={2} value={brave.locationCountry} onChange={(event) => updateBraveSearch({ locationCountry: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>Postal code</span>
              <input value={brave.locationPostalCode} onChange={(event) => updateBraveSearch({ locationPostalCode: event.target.value })} />
            </label>
          </div>
        </article>
      </div>
    </>
  );
}
