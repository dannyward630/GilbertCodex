use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{Duration, Instant};

const DUCKDUCKGO_API_URL: &str = "https://api.duckduckgo.com/";
const DUCKDUCKGO_HTML_URL: &str = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_LITE_URL: &str = "https://lite.duckduckgo.com/lite/";
const BRAVE_WEB_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_NEWS_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/news/search";
const BRAVE_VIDEO_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/videos/search";
const BRAVE_IMAGE_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/images/search";
const BRAVE_PLACE_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/local/place_search";
const BRAVE_ANSWERS_URL: &str = "https://api.search.brave.com/res/v1/chat/completions";
const BRAVE_SEARCH_PAGE_URL: &str = "https://search.brave.com/search";
const MAX_DUCKDUCKGO_RESULTS: usize = 6;
const MAX_BRAVE_RESULTS: usize = 6;
const MAX_BRAVE_VERTICAL_RESULTS: usize = 50;
const BRAVE_FOLLOWUP_REQUEST_DELAY_MS: u64 = 1100;
const DUCKDUCKGO_CONNECT_TIMEOUT_SECS: u64 = 4;
const DUCKDUCKGO_CLIENT_TIMEOUT_SECS: u64 = 8;
const DUCKDUCKGO_API_TIMEOUT_SECS: u64 = 4;
const DUCKDUCKGO_HTML_TIMEOUT_SECS: u64 = 5;
const DUCKDUCKGO_TOTAL_BUDGET_SECS: u64 = 16;
const BRAVE_CONNECT_TIMEOUT_SECS: u64 = 4;
const BRAVE_CLIENT_TIMEOUT_SECS: u64 = 10;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GilbertCodex/0.1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDuckGoSearchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BraveSearchOptions {
    api_key: String,
    answers_max_completion_tokens: Option<usize>,
    answers_model: Option<String>,
    cache_control_no_cache: Option<bool>,
    country: Option<String>,
    enable_answers: Option<bool>,
    enable_image_search: Option<bool>,
    enable_news_search: Option<bool>,
    enable_place_search: Option<bool>,
    enable_rich_callback: Option<bool>,
    enable_video_search: Option<bool>,
    extra_snippets: Option<bool>,
    freshness: Option<String>,
    goggles: Option<Vec<String>>,
    image_result_count: Option<usize>,
    include_fetch_metadata: Option<bool>,
    location_city: Option<String>,
    location_country: Option<String>,
    location_latitude: Option<String>,
    location_longitude: Option<String>,
    location_postal_code: Option<String>,
    location_state: Option<String>,
    location_state_name: Option<String>,
    location_timezone: Option<String>,
    news_result_count: Option<usize>,
    offset: Option<usize>,
    operators: Option<bool>,
    place_location: Option<String>,
    place_radius_meters: Option<usize>,
    place_result_count: Option<usize>,
    request_method: Option<String>,
    result_filter: Option<Vec<String>>,
    safesearch: Option<String>,
    search_lang: Option<String>,
    spellcheck: Option<bool>,
    summary: Option<bool>,
    text_decorations: Option<bool>,
    ui_lang: Option<String>,
    units: Option<String>,
    video_result_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DuckDuckGoInstantAnswer {
    abstract_text: Option<String>,
    abstract_url: Option<String>,
    heading: Option<String>,
    related_topics: Option<Vec<DuckDuckGoRelatedTopic>>,
    results: Option<Vec<DuckDuckGoRelatedTopic>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DuckDuckGoRelatedTopic {
    first_url: Option<String>,
    name: Option<String>,
    text: Option<String>,
    topics: Option<Vec<DuckDuckGoRelatedTopic>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn duckduckgo_search(
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    let trimmed_query = query.trim();

    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let result_limit = max_results
        .unwrap_or(MAX_DUCKDUCKGO_RESULTS)
        .clamp(1, MAX_DUCKDUCKGO_RESULTS);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(DUCKDUCKGO_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(DUCKDUCKGO_CLIENT_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create DuckDuckGo client: {error}"))?;
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();
    let started_at = Instant::now();

    if let Ok(api_results) =
        fetch_duckduckgo_instant_answer(&client, trimmed_query, result_limit).await
    {
        extend_search_results(&mut results, &mut seen_urls, api_results, result_limit);
    }

    if results.len() >= result_limit {
        return Ok(results);
    }

    let attempts = [
        DuckDuckGoAttempt {
            method: SearchMethod::Post,
            url: DUCKDUCKGO_HTML_URL,
        },
        DuckDuckGoAttempt {
            method: SearchMethod::Get,
            url: DUCKDUCKGO_HTML_URL,
        },
        DuckDuckGoAttempt {
            method: SearchMethod::Get,
            url: DUCKDUCKGO_LITE_URL,
        },
    ];
    let mut last_error = None;

    for attempt in attempts {
        if started_at.elapsed() >= Duration::from_secs(DUCKDUCKGO_TOTAL_BUDGET_SECS) {
            last_error = Some(
                "DuckDuckGo search timed out before another source could be tried.".to_string(),
            );
            break;
        }

        match fetch_duckduckgo_html(&client, attempt, trimmed_query).await {
            Ok(html) => {
                let html_results = parse_duckduckgo_results(&html, result_limit);
                extend_search_results(&mut results, &mut seen_urls, html_results, result_limit);

                if !results.is_empty() {
                    return Ok(results);
                }

                last_error = Some("DuckDuckGo returned no usable sources.".to_string());
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "DuckDuckGo returned no usable sources.".to_string()))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn brave_search(
    query: String,
    max_results: Option<usize>,
    options: BraveSearchOptions,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    let trimmed_query = trim_search_query(&query, 400, 50);

    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let api_key = options.api_key.trim();

    if api_key.is_empty() {
        return Err("Add a Brave Search API key in Settings > Brave Search.".to_string());
    }

    let result_limit = max_results
        .unwrap_or(MAX_DUCKDUCKGO_RESULTS)
        .clamp(1, MAX_BRAVE_RESULTS);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(BRAVE_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(BRAVE_CLIENT_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create Brave Search client: {error}"))?;
    let news_count = options
        .news_result_count
        .unwrap_or(result_limit)
        .clamp(1, MAX_BRAVE_VERTICAL_RESULTS);
    let video_count = options
        .video_result_count
        .unwrap_or(4)
        .clamp(1, MAX_BRAVE_VERTICAL_RESULTS);
    let image_count = options
        .image_result_count
        .unwrap_or(6)
        .clamp(1, MAX_BRAVE_VERTICAL_RESULTS);
    let place_count = options
        .place_result_count
        .unwrap_or(6)
        .clamp(1, MAX_BRAVE_VERTICAL_RESULTS);
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();
    let mut errors = Vec::new();
    let combined_limit = result_limit + news_count + video_count + image_count + place_count + 1;

    let web_results =
        fetch_brave_web_results(&client, api_key, &trimmed_query, result_limit, &options).await?;
    extend_search_results(&mut results, &mut seen_urls, web_results, combined_limit);

    if results.len() >= result_limit {
        return Ok(results);
    }

    for (enabled, count, vertical) in [
        (
            options.enable_news_search.unwrap_or(false),
            news_count,
            BraveVertical::News,
        ),
        (
            options.enable_video_search.unwrap_or(false),
            video_count,
            BraveVertical::Videos,
        ),
        (
            options.enable_place_search.unwrap_or(false),
            place_count,
            BraveVertical::Places,
        ),
        (
            options.enable_image_search.unwrap_or(false),
            image_count,
            BraveVertical::Images,
        ),
    ] {
        if !enabled || results.len() >= result_limit {
            continue;
        }

        tokio::time::sleep(Duration::from_millis(BRAVE_FOLLOWUP_REQUEST_DELAY_MS)).await;

        match fetch_optional_brave_vertical(
            &client,
            api_key,
            &trimmed_query,
            count,
            &options,
            true,
            vertical,
        )
        .await
        {
            Ok(result_set) => {
                extend_search_results(&mut results, &mut seen_urls, result_set, combined_limit);
            }
            Err(error) => errors.push(error),
        }
    }

    if options.enable_answers.unwrap_or(false) && results.len() < result_limit {
        tokio::time::sleep(Duration::from_millis(BRAVE_FOLLOWUP_REQUEST_DELAY_MS)).await;

        match fetch_optional_brave_answer(&client, api_key, &trimmed_query, &options, true).await {
            Ok(result_set) => {
                extend_search_results(&mut results, &mut seen_urls, result_set, combined_limit);
            }
            Err(error) => errors.push(error),
        }
    }

    if results.is_empty() {
        return Err(errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "Brave Search returned no usable sources.".to_string()));
    }

    Ok(results)
}

#[derive(Debug, Clone, Copy)]
enum BraveVertical {
    News,
    Videos,
    Images,
    Places,
}

impl BraveVertical {
    fn endpoint(self) -> &'static str {
        match self {
            BraveVertical::News => BRAVE_NEWS_SEARCH_URL,
            BraveVertical::Videos => BRAVE_VIDEO_SEARCH_URL,
            BraveVertical::Images => BRAVE_IMAGE_SEARCH_URL,
            BraveVertical::Places => BRAVE_PLACE_SEARCH_URL,
        }
    }

    fn source_type(self) -> &'static str {
        match self {
            BraveVertical::News => "news",
            BraveVertical::Videos => "video",
            BraveVertical::Images => "image",
            BraveVertical::Places => "place",
        }
    }

    fn supports_post(self) -> bool {
        matches!(self, BraveVertical::News | BraveVertical::Videos)
    }
}

async fn fetch_brave_web_results(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    max_results: usize,
    options: &BraveSearchOptions,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    let payload = fetch_brave_json(
        client,
        api_key,
        BRAVE_WEB_SEARCH_URL,
        build_brave_search_params(query, max_results, options, true),
        options,
        true,
    )
    .await?;

    Ok(parse_brave_results(&payload, max_results))
}

async fn fetch_optional_brave_vertical(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    max_results: usize,
    options: &BraveSearchOptions,
    enabled: bool,
    vertical: BraveVertical,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    if !enabled {
        return Ok(Vec::new());
    }

    let mut params = build_brave_search_params(query, max_results, options, false);

    if matches!(vertical, BraveVertical::Places) {
        append_optional_param(&mut params, "location", options.place_location.as_deref());
        append_optional_usize_param(&mut params, "radius", options.place_radius_meters);
    }

    let payload = fetch_brave_json(
        client,
        api_key,
        vertical.endpoint(),
        params,
        options,
        vertical.supports_post(),
    )
    .await?;

    Ok(parse_brave_vertical_results(
        &payload,
        max_results,
        vertical.source_type(),
        query,
    ))
}

async fn fetch_optional_brave_answer(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    options: &BraveSearchOptions,
    enabled: bool,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    if !enabled {
        return Ok(Vec::new());
    }

    let body = serde_json::json!({
        "messages": [
            {
                "role": "user",
                "content": query,
            }
        ],
        "model": options.answers_model.as_deref().unwrap_or("brave"),
        "max_completion_tokens": options.answers_max_completion_tokens.unwrap_or(700).clamp(128, 4000),
    });
    let request = apply_brave_headers(
        client
            .post(BRAVE_ANSWERS_URL)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "gzip")
            .header("Content-Type", "application/json")
            .header("X-Subscription-Token", api_key)
            .json(&body),
        options,
    )?;
    let payload = send_brave_request(request, "Brave Answers").await?;
    let content = first_json_string(
        &payload,
        &[
            &["choices", "0", "message", "content"],
            &["choices", "0", "delta", "content"],
            &["message", "content"],
            &["answer"],
            &["content"],
        ],
    )
    .unwrap_or_default();

    if content.is_empty() {
        return Ok(Vec::new());
    }

    let search_url = reqwest::Url::parse_with_params(BRAVE_SEARCH_PAGE_URL, &[("q", query)])
        .map_err(|error| format!("Could not build Brave Answers source URL: {error}"))?;

    Ok(vec![DuckDuckGoSearchResult {
        image_url: None,
        source_type: Some("answer".to_string()),
        snippet: collapse_whitespace(&content),
        thumbnail_url: None,
        title: "Brave Answers".to_string(),
        url: search_url.to_string(),
    }])
}

async fn fetch_brave_json(
    client: &reqwest::Client,
    api_key: &str,
    endpoint: &str,
    params: Vec<(String, String)>,
    options: &BraveSearchOptions,
    supports_post: bool,
) -> Result<serde_json::Value, String> {
    let method = options.request_method.as_deref().unwrap_or("get");
    let request = if supports_post && method.eq_ignore_ascii_case("post") {
        let body = create_brave_post_body(&params);

        client
            .post(endpoint)
            .header("Content-Type", "application/json")
            .json(&body)
    } else {
        let url = reqwest::Url::parse_with_params(
            endpoint,
            params
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .map_err(|error| format!("Could not build Brave Search URL: {error}"))?;

        client.get(url)
    };
    let request = apply_brave_headers(
        request
            .header("Accept", "application/json")
            .header("Accept-Encoding", "gzip")
            .header("X-Subscription-Token", api_key),
        options,
    )?;

    send_brave_request(request, "Brave Search").await
}

fn create_brave_post_body(params: &[(String, String)]) -> serde_json::Value {
    let mut map = serde_json::Map::new();

    for (key, value) in params {
        let next_value = create_brave_post_value(key, value);

        if let Some(existing_value) = map.get_mut(key) {
            match existing_value {
                serde_json::Value::Array(values) => values.push(next_value),
                previous_value => {
                    let previous = previous_value.take();
                    *previous_value = serde_json::Value::Array(vec![previous, next_value]);
                }
            }
        } else {
            map.insert(key.clone(), next_value);
        }
    }

    serde_json::Value::Object(map)
}

fn create_brave_post_value(key: &str, value: &str) -> serde_json::Value {
    match key {
        "count" | "offset" | "radius" => value
            .parse::<u64>()
            .map(serde_json::Value::from)
            .unwrap_or_else(|_| serde_json::Value::String(value.to_string())),
        "enable_rich_callback"
        | "extra_snippets"
        | "include_fetch_metadata"
        | "operators"
        | "spellcheck"
        | "summary"
        | "text_decorations" => {
            serde_json::Value::Bool(value.eq_ignore_ascii_case("true") || value == "1")
        }
        "result_filter" => serde_json::Value::Array(
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(|item| serde_json::Value::String(item.to_string()))
                .collect(),
        ),
        _ => serde_json::Value::String(value.to_string()),
    }
}

async fn send_brave_request(
    request: reqwest::RequestBuilder,
    label: &str,
) -> Result<serde_json::Value, String> {
    let response = request
        .send()
        .await
        .map_err(|error| format!("{label} request failed: {error}"))?;
    let status = response.status();
    let headers = response.headers().clone();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Could not read {label} response: {error}"))?;

    if !status.is_success() {
        return Err(format_brave_error(
            status.as_u16(),
            &response_text,
            &headers,
        ));
    }

    serde_json::from_str::<serde_json::Value>(&response_text).map_err(|error| {
        format!(
            "Could not parse {label} response as JSON: {error}. {}",
            format_brave_response_diagnostics(status.as_u16(), &headers, &response_text)
        )
    })
}

fn apply_brave_headers(
    mut request: reqwest::RequestBuilder,
    options: &BraveSearchOptions,
) -> Result<reqwest::RequestBuilder, String> {
    if options.cache_control_no_cache.unwrap_or(false) {
        request = request.header("Cache-Control", "no-cache");
    }

    request = append_optional_header(request, "x-loc-lat", options.location_latitude.as_deref())?;
    request = append_optional_header(request, "x-loc-long", options.location_longitude.as_deref())?;
    request = append_optional_header(
        request,
        "x-loc-timezone",
        options.location_timezone.as_deref(),
    )?;
    request = append_optional_header(request, "x-loc-city", options.location_city.as_deref())?;
    request = append_optional_header(request, "x-loc-state", options.location_state.as_deref())?;
    request = append_optional_header(
        request,
        "x-loc-state-name",
        options.location_state_name.as_deref(),
    )?;
    request = append_optional_header(
        request,
        "x-loc-country",
        options.location_country.as_deref(),
    )?;
    append_optional_header(
        request,
        "x-loc-postal-code",
        options.location_postal_code.as_deref(),
    )
}

#[cfg(test)]
fn build_brave_search_url(
    query: &str,
    max_results: usize,
    options: &BraveSearchOptions,
) -> Result<reqwest::Url, String> {
    let params = build_brave_search_params(query, max_results, options, true);

    reqwest::Url::parse_with_params(
        BRAVE_WEB_SEARCH_URL,
        params
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str())),
    )
    .map_err(|error| format!("Could not build Brave Search URL: {error}"))
}

fn build_brave_search_params(
    query: &str,
    max_results: usize,
    options: &BraveSearchOptions,
    include_web_only_params: bool,
) -> Vec<(String, String)> {
    let result_count = max_results.clamp(1, MAX_BRAVE_RESULTS);
    let mut params = vec![
        ("q".to_string(), query.to_string()),
        ("count".to_string(), result_count.to_string()),
    ];

    append_optional_param(&mut params, "country", options.country.as_deref());
    append_optional_param(&mut params, "search_lang", options.search_lang.as_deref());
    append_optional_param(&mut params, "ui_lang", options.ui_lang.as_deref());
    append_optional_param(&mut params, "safesearch", options.safesearch.as_deref());
    append_optional_param(&mut params, "freshness", options.freshness.as_deref());
    append_optional_param(&mut params, "units", options.units.as_deref());
    append_optional_usize_param(
        &mut params,
        "offset",
        options.offset.map(|offset| offset.min(9)),
    );
    append_repeated_optional_param(&mut params, "goggles", options.goggles.as_deref());
    append_bool_param(&mut params, "extra_snippets", options.extra_snippets);
    append_bool_param(&mut params, "spellcheck", options.spellcheck);
    append_bool_param(&mut params, "text_decorations", options.text_decorations);
    append_bool_param(&mut params, "operators", options.operators);
    if include_web_only_params {
        append_bool_param(&mut params, "summary", options.summary);
        append_bool_param(
            &mut params,
            "enable_rich_callback",
            options.enable_rich_callback,
        );
    }
    append_bool_param(
        &mut params,
        "include_fetch_metadata",
        options.include_fetch_metadata,
    );

    if include_web_only_params {
        if let Some(result_filter) = options
            .result_filter
            .as_ref()
            .filter(|filters| !filters.is_empty())
        {
            params.push(("result_filter".to_string(), result_filter.join(",")));
        }
    }

    params
}

fn append_optional_param(params: &mut Vec<(String, String)>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        params.push((key.to_string(), value.to_string()));
    }
}

fn append_repeated_optional_param(
    params: &mut Vec<(String, String)>,
    key: &str,
    values: Option<&[String]>,
) {
    for value in values.unwrap_or_default() {
        append_optional_param(params, key, Some(value));
    }
}

fn append_optional_usize_param(
    params: &mut Vec<(String, String)>,
    key: &str,
    value: Option<usize>,
) {
    if let Some(value) = value {
        params.push((key.to_string(), value.to_string()));
    }
}

fn append_bool_param(params: &mut Vec<(String, String)>, key: &str, value: Option<bool>) {
    if let Some(value) = value {
        params.push((
            key.to_string(),
            (if value { "true" } else { "false" }).to_string(),
        ));
    }
}

fn append_optional_header(
    request: reqwest::RequestBuilder,
    key: &'static str,
    value: Option<&str>,
) -> Result<reqwest::RequestBuilder, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(request);
    };
    let header_value = reqwest::header::HeaderValue::from_str(value)
        .map_err(|error| format!("Invalid Brave Search header {key}: {error}"))?;

    Ok(request.header(key, header_value))
}

fn parse_brave_results(
    payload: &serde_json::Value,
    max_results: usize,
) -> Vec<DuckDuckGoSearchResult> {
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

    for (section, source_type) in [
        ("web", "web"),
        ("news", "news"),
        ("videos", "video"),
        ("discussions", "web"),
        ("faq", "web"),
        ("infobox", "web"),
        ("locations", "place"),
    ] {
        if let Some(items) = payload
            .get(section)
            .and_then(|section_value| section_value.get("results"))
            .and_then(serde_json::Value::as_array)
        {
            collect_brave_result_items(
                items,
                max_results,
                &mut seen_urls,
                &mut results,
                source_type,
            );
        }

        if results.len() >= max_results {
            break;
        }
    }

    results
}

fn parse_brave_vertical_results(
    payload: &serde_json::Value,
    max_results: usize,
    source_type: &str,
    query: &str,
) -> Vec<DuckDuckGoSearchResult> {
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

    for path in [
        &["results"][..],
        &["web", "results"][..],
        &["news", "results"][..],
        &["videos", "results"][..],
        &["images", "results"][..],
        &["locations", "results"][..],
        &["places", "results"][..],
    ] {
        if let Some(items) = json_path(payload, path).and_then(serde_json::Value::as_array) {
            for item in items {
                if results.len() >= max_results {
                    break;
                }

                let Some(result) = parse_brave_result_item(item, source_type, Some(query)) else {
                    continue;
                };

                push_search_result_with_media(&mut results, &mut seen_urls, result, max_results);
            }
        }

        if results.len() >= max_results {
            break;
        }
    }

    results
}

fn collect_brave_result_items(
    items: &[serde_json::Value],
    max_results: usize,
    seen_urls: &mut HashSet<String>,
    results: &mut Vec<DuckDuckGoSearchResult>,
    source_type: &str,
) {
    for item in items {
        if results.len() >= max_results {
            break;
        }

        let Some(result) = parse_brave_result_item(item, source_type, None) else {
            continue;
        };

        push_search_result_with_media(results, seen_urls, result, max_results);
    }
}

fn parse_brave_result_item(
    item: &serde_json::Value,
    source_type: &str,
    fallback_query: Option<&str>,
) -> Option<DuckDuckGoSearchResult> {
    let url = first_json_string(
        item,
        &[
            &["url"],
            &["website"],
            &["provider_url"],
            &["page_url"],
            &["source_url"],
            &["properties", "url"],
            &["profile", "url"],
            &["meta_url", "href"],
        ],
    )
    .or_else(|| fallback_query.and_then(create_brave_search_result_url))?;
    let title = first_json_string(item, &[&["title"], &["name"], &["question"], &["source"]])?;
    let mut snippet_parts = Vec::new();

    if let Some(description) = first_json_string(
        item,
        &[
            &["description"],
            &["short_description"],
            &["description_ai"],
            &["snippet"],
            &["answer"],
            &["text"],
            &["content"],
            &["profile", "long_name"],
            &["profile", "name"],
            &["category"],
            &["address", "displayAddress"],
            &["postal_address", "displayAddress"],
            &["categories"],
            &["serves_cuisine"],
        ],
    ) {
        snippet_parts.push(description);
    }

    if let Some(extra_snippets) = item
        .get("extra_snippets")
        .and_then(serde_json::Value::as_array)
    {
        for snippet in extra_snippets {
            if let Some(text) = snippet
                .as_str()
                .map(collapse_whitespace)
                .filter(|value| !value.is_empty())
            {
                snippet_parts.push(text);
            }
        }
    }
    if let Some(age) = first_json_string(item, &[&["age"], &["published"], &["published_time"]]) {
        snippet_parts.push(format!("Published: {age}"));
    }
    if let Some(source) = first_json_string(item, &[&["source"], &["publisher"], &["provider"]]) {
        snippet_parts.push(format!("Source: {source}"));
    }

    let image_url = first_json_string(
        item,
        &[
            &["properties", "url"],
            &["image", "url"],
            &["image_url"],
            &["thumbnail", "original"],
            &["thumbnail", "src"],
        ],
    );
    let thumbnail_url = first_json_string(
        item,
        &[
            &["thumbnail", "src"],
            &["thumbnail", "url"],
            &["thumbnail"],
            &["properties", "placeholder"],
            &["image", "thumbnail"],
        ],
    );

    Some(DuckDuckGoSearchResult {
        image_url: image_url.filter(|url| is_external_result_url(url)),
        snippet: collapse_whitespace(&snippet_parts.join(" ")),
        source_type: Some(source_type.to_string()),
        thumbnail_url: thumbnail_url.filter(|url| is_external_result_url(url)),
        title: collapse_whitespace(&title),
        url,
    })
}

fn first_json_string(payload: &serde_json::Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(value) = json_path(payload, path)
            .and_then(serde_json::Value::as_str)
            .map(collapse_whitespace)
            .filter(|value| !value.is_empty())
        {
            return Some(value);
        }

        if let Some(value) = json_path(payload, path)
            .and_then(serde_json::Value::as_f64)
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
        {
            return Some(value);
        }

        if let Some(values) = json_path(payload, path).and_then(serde_json::Value::as_array) {
            let joined = values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(collapse_whitespace)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join(", ");

            if !joined.is_empty() {
                return Some(joined);
            }
        }
    }

    None
}

fn json_path<'a>(payload: &'a serde_json::Value, path: &[&str]) -> Option<&'a serde_json::Value> {
    let mut current = payload;

    for segment in path {
        current = if let Ok(index) = segment.parse::<usize>() {
            current.get(index)?
        } else {
            current.get(*segment)?
        };
    }

    Some(current)
}

fn create_brave_search_result_url(query: &str) -> Option<String> {
    reqwest::Url::parse_with_params(BRAVE_SEARCH_PAGE_URL, &[("q", query)])
        .ok()
        .map(|url| url.to_string())
}

fn format_brave_error(
    status: u16,
    response_text: &str,
    headers: &reqwest::header::HeaderMap,
) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(response_text)
        .ok()
        .and_then(|payload| {
            first_json_string(
                &payload,
                &[
                    &["error", "message"],
                    &["error", "detail"],
                    &["error", "reason"],
                    &["error", "code"],
                    &["message"],
                    &["detail"],
                ],
            )
        })
        .unwrap_or_else(|| match status {
            401 | 403 => "Check the Brave Search API key.".to_string(),
            422 => "Check the Brave Search query and filter settings.".to_string(),
            429 => "Brave Search rate limit reached.".to_string(),
            _ => "The Brave Search API returned an error.".to_string(),
        });

    format!(
        "Brave Search failed with HTTP {status}: {detail}. {}",
        format_brave_response_diagnostics(status, headers, response_text)
    )
}

fn format_brave_response_diagnostics(
    status: u16,
    headers: &reqwest::header::HeaderMap,
    response_text: &str,
) -> String {
    let content_type = header_text(headers, reqwest::header::CONTENT_TYPE)
        .unwrap_or_else(|| "unknown content type".to_string());
    let retry_after = header_text(headers, reqwest::header::RETRY_AFTER);
    let rate_remaining = header_text(headers, "x-ratelimit-remaining");
    let rate_reset = header_text(headers, "x-ratelimit-reset");
    let rate_policy = header_text(headers, "x-ratelimit-policy");
    let rate_limit = [rate_remaining, rate_reset, rate_policy]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ");
    let body_preview = preview_response_text(response_text);

    [
        format!("HTTP {status}"),
        format!("content-type: {content_type}"),
        retry_after
            .map(|value| format!("retry-after: {value}"))
            .unwrap_or_default(),
        if rate_limit.is_empty() {
            String::new()
        } else {
            format!("rate-limit: {rate_limit}")
        },
        format!("body: {body_preview}"),
    ]
    .into_iter()
    .filter(|item| !item.is_empty())
    .collect::<Vec<_>>()
    .join("; ")
}

fn header_text<K>(headers: &reqwest::header::HeaderMap, key: K) -> Option<String>
where
    K: reqwest::header::AsHeaderName,
{
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(collapse_whitespace)
        .filter(|value| !value.is_empty())
}

fn preview_response_text(response_text: &str) -> String {
    let normalized = collapse_whitespace(response_text);

    if normalized.is_empty() {
        return "empty".to_string();
    }

    normalized.chars().take(240).collect()
}

async fn fetch_duckduckgo_instant_answer(
    client: &reqwest::Client,
    query: &str,
    max_results: usize,
) -> Result<Vec<DuckDuckGoSearchResult>, String> {
    let url = reqwest::Url::parse_with_params(
        DUCKDUCKGO_API_URL,
        &[
            ("format", "json"),
            ("no_html", "1"),
            ("no_redirect", "1"),
            ("q", query),
            ("skip_disambig", "1"),
        ],
    )
    .map_err(|error| format!("Could not build DuckDuckGo Instant Answer URL: {error}"))?;
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(DUCKDUCKGO_API_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|error| format!("DuckDuckGo Instant Answer request failed: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!(
            "DuckDuckGo Instant Answer request failed with HTTP {status}."
        ));
    }

    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read DuckDuckGo Instant Answer response: {error}"))?;
    let payload = serde_json::from_str::<DuckDuckGoInstantAnswer>(&text)
        .map_err(|error| format!("Could not parse DuckDuckGo Instant Answer response: {error}"))?;

    Ok(parse_instant_answer_results(payload, max_results))
}

fn parse_duckduckgo_results(html: &str, max_results: usize) -> Vec<DuckDuckGoSearchResult> {
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

    collect_anchor_results(html, max_results, true, &mut seen_urls, &mut results);
    collect_anchor_results(html, max_results, false, &mut seen_urls, &mut results);

    if !results.is_empty() {
        return results;
    }

    for chunk in html.split("result__body").skip(1) {
        if results.len() >= max_results {
            break;
        }

        let Some((title, url)) = extract_result_link(chunk) else {
            continue;
        };

        let snippet = first_non_empty(
            extract_inner_text_by_class(chunk, "result__snippet"),
            extract_inner_text_by_class(chunk, "result-snippet"),
        );

        push_search_result(
            &mut results,
            &mut seen_urls,
            title,
            url,
            snippet,
            max_results,
        );
    }

    results
}

fn parse_instant_answer_results(
    payload: DuckDuckGoInstantAnswer,
    max_results: usize,
) -> Vec<DuckDuckGoSearchResult> {
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

    if let (Some(title), Some(url)) = (payload.heading, payload.abstract_url) {
        push_search_result(
            &mut results,
            &mut seen_urls,
            collapse_whitespace(&title),
            url,
            collapse_whitespace(&payload.abstract_text.unwrap_or_default()),
            max_results,
        );
    }

    collect_related_topic_results(payload.results, max_results, &mut seen_urls, &mut results);
    collect_related_topic_results(
        payload.related_topics,
        max_results,
        &mut seen_urls,
        &mut results,
    );
    results
}

fn collect_related_topic_results(
    topics: Option<Vec<DuckDuckGoRelatedTopic>>,
    max_results: usize,
    seen_urls: &mut HashSet<String>,
    results: &mut Vec<DuckDuckGoSearchResult>,
) {
    for topic in topics.unwrap_or_default() {
        if results.len() >= max_results {
            break;
        }

        if let Some(nested_topics) = topic.topics {
            collect_related_topic_results(Some(nested_topics), max_results, seen_urls, results);
            continue;
        }

        let Some(url) = topic.first_url else {
            continue;
        };
        let text = collapse_whitespace(&topic.text.unwrap_or_default());
        let title = collapse_whitespace(
            topic
                .name
                .as_deref()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| text.split(" - ").next().unwrap_or("DuckDuckGo result")),
        );

        push_search_result(results, seen_urls, title, url, text, max_results);
    }
}

fn extend_search_results(
    results: &mut Vec<DuckDuckGoSearchResult>,
    seen_urls: &mut HashSet<String>,
    incoming_results: Vec<DuckDuckGoSearchResult>,
    max_results: usize,
) {
    for result in incoming_results {
        push_search_result(
            results,
            seen_urls,
            result.title,
            result.url,
            result.snippet,
            max_results,
        );

        if results.len() >= max_results {
            break;
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct DuckDuckGoAttempt {
    method: SearchMethod,
    url: &'static str,
}

#[derive(Debug, Clone, Copy)]
enum SearchMethod {
    Get,
    Post,
}

async fn fetch_duckduckgo_html(
    client: &reqwest::Client,
    attempt: DuckDuckGoAttempt,
    query: &str,
) -> Result<String, String> {
    let request = match attempt.method {
        SearchMethod::Get => {
            let url = reqwest::Url::parse_with_params(attempt.url, &[("q", query)])
                .map_err(|error| format!("Could not build DuckDuckGo search URL: {error}"))?;

            client.get(url)
        }
        SearchMethod::Post => client
            .post(attempt.url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(create_form_body("q", query)?),
    };
    let response = request
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(DUCKDUCKGO_HTML_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|error| format!("DuckDuckGo search failed: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("DuckDuckGo search failed with HTTP {status}."));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Could not read DuckDuckGo results: {error}"))
}

fn create_form_body(key: &str, value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse_with_params("https://duckduckgo.local/", &[(key, value)])
        .map_err(|error| format!("Could not encode DuckDuckGo request: {error}"))?;

    Ok(url.query().unwrap_or_default().to_string())
}

fn first_non_empty(primary: String, fallback: String) -> String {
    if primary.is_empty() {
        fallback
    } else {
        primary
    }
}

fn collect_anchor_results(
    html: &str,
    max_results: usize,
    require_result_class: bool,
    seen_urls: &mut HashSet<String>,
    results: &mut Vec<DuckDuckGoSearchResult>,
) {
    let mut cursor = 0;

    while results.len() < max_results {
        let Some(relative_start) = html[cursor..].find("<a") else {
            break;
        };
        let anchor_start = cursor + relative_start;
        let anchor = &html[anchor_start..];
        let Some(tag_end) = anchor.find('>') else {
            break;
        };
        let open_tag = &anchor[..tag_end + 1];
        let lower_open_tag = open_tag.to_ascii_lowercase();

        if require_result_class
            && !(lower_open_tag.contains("result__a") || lower_open_tag.contains("result-link"))
        {
            cursor = anchor_start + tag_end + 1;
            continue;
        }

        let Some(close_index) = anchor[tag_end + 1..].find("</a>") else {
            cursor = anchor_start + tag_end + 1;
            continue;
        };
        let content_start = tag_end + 1;
        let content_end = content_start + close_index;
        let href = extract_attribute(open_tag, "href").unwrap_or_default();
        let title = html_to_text(&anchor[content_start..content_end]);
        let snippet_search_start = anchor_start + content_end + "</a>".len();
        let snippet_search_end = (snippet_search_start + 1600).min(html.len());
        let snippet_window = &html[snippet_search_start..snippet_search_end];
        let snippet = first_non_empty(
            extract_inner_text_by_class(snippet_window, "result__snippet"),
            extract_inner_text_by_class(snippet_window, "result-snippet"),
        );

        if let Some(url) = normalize_duckduckgo_url(&href) {
            push_search_result(results, seen_urls, title, url, snippet, max_results);
        }

        cursor = snippet_search_start;
    }
}

fn push_search_result(
    results: &mut Vec<DuckDuckGoSearchResult>,
    seen_urls: &mut HashSet<String>,
    title: String,
    url: String,
    snippet: String,
    max_results: usize,
) {
    if results.len() >= max_results
        || title.is_empty()
        || !is_external_result_url(&url)
        || !seen_urls.insert(url.clone())
    {
        return;
    }

    results.push(DuckDuckGoSearchResult {
        image_url: None,
        snippet,
        source_type: Some("web".to_string()),
        thumbnail_url: None,
        title,
        url,
    });
}

fn push_search_result_with_media(
    results: &mut Vec<DuckDuckGoSearchResult>,
    seen_urls: &mut HashSet<String>,
    result: DuckDuckGoSearchResult,
    max_results: usize,
) {
    if results.len() >= max_results
        || result.title.is_empty()
        || !is_external_result_url(&result.url)
        || !seen_urls.insert(result.url.clone())
    {
        return;
    }

    results.push(result);
}

fn extract_result_link(chunk: &str) -> Option<(String, String)> {
    let marker_index = chunk
        .find("result__a")
        .or_else(|| chunk.find("result-link"))?;
    let tag_start = chunk[..marker_index].rfind("<a")?;
    let anchor = &chunk[tag_start..];
    let tag_end = anchor.find('>')?;
    let open_tag = &anchor[..tag_end + 1];
    let close_index = anchor[tag_end + 1..].find("</a>")?;
    let title_html = &anchor[tag_end + 1..tag_end + 1 + close_index];
    let href = extract_attribute(open_tag, "href")?;
    let url = normalize_duckduckgo_url(&href)?;
    let title = html_to_text(title_html);

    Some((title, url))
}

fn extract_inner_text_by_class(chunk: &str, class_name: &str) -> String {
    let Some(marker_index) = chunk.find(class_name) else {
        return String::new();
    };
    let Some(tag_start) = chunk[..marker_index].rfind('<') else {
        return String::new();
    };

    let tag = &chunk[tag_start..];
    let Some(tag_end) = tag.find('>') else {
        return String::new();
    };

    let open_tag = &tag[..tag_end + 1];
    let tag_name = open_tag
        .trim_start_matches('<')
        .split(|character: char| character.is_whitespace() || character == '>')
        .next()
        .unwrap_or("");

    if tag_name.is_empty() || tag_name.starts_with('/') {
        return String::new();
    }

    let close_tag = format!("</{tag_name}>");
    let Some(close_index) = tag[tag_end + 1..].find(&close_tag) else {
        return String::new();
    };

    html_to_text(&tag[tag_end + 1..tag_end + 1 + close_index])
}

fn extract_attribute(tag: &str, attribute_name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pattern = format!("{attribute_name}={quote}");

        if let Some(start_index) = tag.find(&pattern) {
            let value_start = start_index + pattern.len();
            let value_end = tag[value_start..].find(quote)? + value_start;

            return Some(decode_html_entities(&tag[value_start..value_end]));
        }
    }

    None
}

fn normalize_duckduckgo_url(raw_url: &str) -> Option<String> {
    let mut candidate = raw_url.trim().to_string();

    if candidate.starts_with("//") {
        candidate = format!("https:{candidate}");
    } else if candidate.starts_with('/') {
        candidate = format!("https://duckduckgo.com{candidate}");
    }

    let parsed = reqwest::Url::parse(&candidate).ok()?;

    if parsed
        .domain()
        .is_some_and(|domain| domain.ends_with("duckduckgo.com"))
    {
        if let Some((_, destination)) = parsed.query_pairs().find(|(key, _)| key == "uddg") {
            return normalize_duckduckgo_url(&destination);
        }
    }

    match parsed.scheme() {
        "http" | "https" => Some(parsed.to_string()),
        _ => None,
    }
}

fn trim_search_query(query: &str, max_chars: usize, max_words: usize) -> String {
    query
        .split_whitespace()
        .take(max_words)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn is_external_result_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.domain().map(|domain| domain.to_ascii_lowercase()))
        .is_some_and(|domain| {
            !domain.ends_with("duckduckgo.com")
                && !domain.ends_with("duck.com")
                && domain != "localhost"
                && domain != "127.0.0.1"
                && domain != "0.0.0.0"
        })
}

fn html_to_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;

    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    collapse_whitespace(&decode_html_entities(&text))
}

fn decode_html_entities(value: &str) -> String {
    let mut decoded = String::new();
    let mut remainder = value;

    while let Some(entity_start) = remainder.find('&') {
        decoded.push_str(&remainder[..entity_start]);
        let after_ampersand = &remainder[entity_start + 1..];

        if let Some(entity_end) = after_ampersand.find(';') {
            let entity = &after_ampersand[..entity_end];

            if let Some(character) = decode_html_entity(entity) {
                decoded.push(character);
                remainder = &after_ampersand[entity_end + 1..];
                continue;
            }
        }

        decoded.push('&');
        remainder = after_ampersand;
    }

    decoded.push_str(remainder);
    decoded
}

fn decode_html_entity(entity: &str) -> Option<char> {
    match entity {
        "amp" => Some('&'),
        "apos" => Some('\''),
        "gt" => Some('>'),
        "lt" => Some('<'),
        "nbsp" => Some(' '),
        "quot" => Some('"'),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => {
            u32::from_str_radix(&entity[2..], 16)
                .ok()
                .and_then(char::from_u32)
        }
        _ if entity.starts_with('#') => entity[1..].parse::<u32>().ok().and_then(char::from_u32),
        _ => None,
    }
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_brave_options() -> BraveSearchOptions {
        BraveSearchOptions {
            api_key: "test-key".to_string(),
            answers_max_completion_tokens: None,
            answers_model: None,
            cache_control_no_cache: None,
            country: None,
            enable_answers: None,
            enable_image_search: None,
            enable_news_search: None,
            enable_place_search: None,
            enable_rich_callback: None,
            enable_video_search: None,
            extra_snippets: None,
            freshness: None,
            goggles: None,
            image_result_count: None,
            include_fetch_metadata: None,
            location_city: None,
            location_country: None,
            location_latitude: None,
            location_longitude: None,
            location_postal_code: None,
            location_state: None,
            location_state_name: None,
            location_timezone: None,
            news_result_count: None,
            offset: None,
            operators: None,
            place_location: None,
            place_radius_meters: None,
            place_result_count: None,
            request_method: None,
            result_filter: None,
            safesearch: None,
            search_lang: None,
            spellcheck: None,
            summary: None,
            text_decorations: None,
            ui_lang: None,
            units: None,
            video_result_count: None,
        }
    }

    #[test]
    fn parses_duckduckgo_html_results_and_caps_at_six() {
        let html = (0..8)
            .map(|index| {
                format!(
                    r#"
                    <div class="result results_links web-result">
                      <div class="links_main result__body">
                        <h2 class="result__title">
                          <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample{index}.com%2Fstory&amp;rut=test">
                            Result {index}
                          </a>
                        </h2>
                        <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample{index}.com%2Fstory&amp;rut=test">
                          Snippet {index}
                        </a>
                      </div>
                    </div>
                    "#
                )
            })
            .collect::<String>();

        let results = parse_duckduckgo_results(&html, MAX_DUCKDUCKGO_RESULTS);

        assert_eq!(results.len(), MAX_DUCKDUCKGO_RESULTS);
        assert_eq!(results[0].title, "Result 0");
        assert_eq!(results[0].url, "https://example0.com/story");
        assert_eq!(results[0].snippet, "Snippet 0");
    }

    #[test]
    fn parses_duckduckgo_lite_links_and_normalizes_redirects() {
        let html = r#"
            <table>
              <tr>
                <td>
                  <a class="result-link" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1%26b%3D2&amp;rut=test">
                    Example &amp; Docs
                  </a>
                </td>
              </tr>
              <tr>
                <td class="result-snippet">Useful &amp; current docs.</td>
              </tr>
              <tr>
                <td>
                  <a class="result-link" href="https://example.com/docs?a=1&amp;b=2">
                    Duplicate direct URL
                  </a>
                </td>
              </tr>
            </table>
        "#;

        let results = parse_duckduckgo_results(html, MAX_DUCKDUCKGO_RESULTS);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Example & Docs");
        assert_eq!(results[0].url, "https://example.com/docs?a=1&b=2");
        assert_eq!(results[0].snippet, "Useful & current docs.");
    }

    #[test]
    fn parses_brave_web_results_with_extra_snippets() {
        let payload = serde_json::json!({
            "web": {
                "results": [
                    {
                        "title": "Brave Search API",
                        "url": "https://api-dashboard.search.brave.com/app/documentation/web-search",
                        "description": "Web Search provides access to Brave's web index.",
                        "extra_snippets": ["Supports freshness filters.", "Supports country and language targeting."]
                    },
                    {
                        "title": "Duplicate",
                        "url": "https://api-dashboard.search.brave.com/app/documentation/web-search",
                        "description": "Duplicate source"
                    }
                ]
            },
            "news": {
                "results": [
                    {
                        "title": "Brave API News",
                        "url": "https://brave.com/search/api/",
                        "description": "API plans and features."
                    }
                ]
            }
        });

        let results = parse_brave_results(&payload, 4);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Brave Search API");
        assert_eq!(
            results[0].url,
            "https://api-dashboard.search.brave.com/app/documentation/web-search"
        );
        assert!(results[0].snippet.contains("freshness filters"));
        assert_eq!(results[1].title, "Brave API News");
    }

    #[test]
    fn builds_brave_url_with_advanced_options() {
        let options = BraveSearchOptions {
            country: Some("US".to_string()),
            enable_rich_callback: Some(true),
            extra_snippets: Some(true),
            freshness: Some("pw".to_string()),
            goggles: Some(vec![
                "https://example.com/first.goggle".to_string(),
                "https://example.com/second.goggle".to_string(),
            ]),
            include_fetch_metadata: Some(true),
            offset: Some(2),
            operators: Some(true),
            result_filter: Some(vec!["web".to_string(), "news".to_string()]),
            safesearch: Some("moderate".to_string()),
            search_lang: Some("en".to_string()),
            spellcheck: Some(true),
            summary: Some(true),
            text_decorations: Some(false),
            ui_lang: Some("en-US".to_string()),
            units: Some("imperial".to_string()),
            ..default_brave_options()
        };

        let url = build_brave_search_url("brave api", 12, &options).expect("valid Brave URL");
        let query = url.query().unwrap_or_default();

        assert!(query.contains("count=6"));
        assert!(query.contains("offset=2"));
        assert!(query.contains("result_filter=web%2Cnews"));
        assert!(query.contains("enable_rich_callback=true"));
        assert!(query.contains("include_fetch_metadata=true"));
        assert_eq!(
            url.query_pairs()
                .filter(|(key, _)| key == "goggles")
                .count(),
            2
        );
    }

    #[test]
    fn builds_brave_post_body_with_typed_values() {
        let params = vec![
            ("q".to_string(), "brave api".to_string()),
            ("count".to_string(), "3".to_string()),
            ("offset".to_string(), "1".to_string()),
            ("spellcheck".to_string(), "true".to_string()),
            ("text_decorations".to_string(), "false".to_string()),
            ("result_filter".to_string(), "web,news".to_string()),
            (
                "goggles".to_string(),
                "https://example.com/first.goggle".to_string(),
            ),
            (
                "goggles".to_string(),
                "https://example.com/second.goggle".to_string(),
            ),
        ];

        let body = create_brave_post_body(&params);

        assert_eq!(body.get("q"), Some(&serde_json::json!("brave api")));
        assert_eq!(body.get("count"), Some(&serde_json::json!(3)));
        assert_eq!(body.get("offset"), Some(&serde_json::json!(1)));
        assert_eq!(body.get("spellcheck"), Some(&serde_json::json!(true)));
        assert_eq!(
            body.get("text_decorations"),
            Some(&serde_json::json!(false))
        );
        assert_eq!(
            body.get("result_filter"),
            Some(&serde_json::json!(["web", "news"]))
        );
        assert_eq!(
            body.get("goggles"),
            Some(&serde_json::json!([
                "https://example.com/first.goggle",
                "https://example.com/second.goggle"
            ]))
        );
    }

    #[test]
    fn parses_brave_image_results_with_media_urls() {
        let payload = serde_json::json!({
            "results": [
                {
                    "title": "Storm shelf cloud",
                    "url": "https://example.com/storm-photo",
                    "source": "Example Images",
                    "thumbnail": {
                        "src": "https://img.example.com/thumb.jpg"
                    },
                    "properties": {
                        "url": "https://img.example.com/full.jpg"
                    }
                }
            ]
        });

        let results = parse_brave_vertical_results(&payload, 4, "image", "storm cloud");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].source_type.as_deref(), Some("image"));
        assert_eq!(
            results[0].thumbnail_url.as_deref(),
            Some("https://img.example.com/thumb.jpg")
        );
        assert_eq!(
            results[0].image_url.as_deref(),
            Some("https://img.example.com/full.jpg")
        );
    }
}
