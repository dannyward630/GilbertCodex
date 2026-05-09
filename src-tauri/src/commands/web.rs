use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;

const DUCKDUCKGO_API_URL: &str = "https://api.duckduckgo.com/";
const DUCKDUCKGO_HTML_URL: &str = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_LITE_URL: &str = "https://lite.duckduckgo.com/lite/";
const MAX_DUCKDUCKGO_RESULTS: usize = 6;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GilbertCodex/0.1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckDuckGoSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
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
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|error| format!("Could not create DuckDuckGo client: {error}"))?;
    let mut results = Vec::new();
    let mut seen_urls = HashSet::new();

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
        snippet,
        title,
        url,
    });
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
}
