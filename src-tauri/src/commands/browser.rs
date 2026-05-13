use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

const APP_USER_AGENT: &str = "GilbertCodex/0.1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationRequest {
    pub action: String,
    pub text: Option<String>,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationLink {
    pub href: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAutomationResponse {
    pub action: String,
    pub links: Vec<BrowserAutomationLink>,
    pub matched: bool,
    pub status: u16,
    pub target_url: Option<String>,
    pub text_snippet: String,
    pub title: String,
    pub url: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn browser_automation(
    request: BrowserAutomationRequest,
) -> Result<BrowserAutomationResponse, String> {
    let url = validate_browser_automation_url(&request.url)?;

    let client = reqwest::Client::builder()
        .user_agent(browser_user_agent())
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not create browser automation client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Browser automation request failed: {error}"))?;
    let final_url = response.url().to_string();
    let status = response.status().as_u16();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read browser automation response: {error}"))?;
    let html = String::from_utf8_lossy(&bytes).to_string();
    let title = extract_title(&html);
    let text = html_to_text(&html);
    let links = extract_links(&html, &final_url);
    let needle = request.text.unwrap_or_default();
    let needle_lower = needle.to_lowercase();
    let matched = !needle_lower.is_empty() && text.to_lowercase().contains(&needle_lower);
    let target_url = if request.action == "click_link" && !needle_lower.is_empty() {
        links
            .iter()
            .find(|link| link.text.to_lowercase().contains(&needle_lower))
            .map(|link| link.href.clone())
    } else {
        None
    };

    Ok(BrowserAutomationResponse {
        action: request.action,
        links,
        matched,
        status,
        target_url,
        text_snippet: text,
        title,
        url: final_url,
    })
}

fn validate_browser_automation_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url.trim())
        .map_err(|_| "browser automation needs a valid http(s) URL.".to_string())?;
    let scheme = url.scheme();

    if scheme != "http" && scheme != "https" {
        return Err("browser automation needs an http(s) URL.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("browser automation refuses URLs with embedded credentials.".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "browser automation needs a URL host.".to_string())?
        .to_ascii_lowercase();

    if is_loopback_browser_automation_host(&host) {
        return Ok(url);
    }

    if scheme != "https" {
        return Err(
            "browser automation only allows HTTP for localhost/loopback targets; use HTTPS for public web pages."
                .to_string(),
        );
    }

    if host.contains('@')
        || host.ends_with(".local")
        || host.ends_with(".lan")
        || host.ends_with(".internal")
        || host.ends_with(".home")
        || host == "host.docker.internal"
        || !host.contains('.')
    {
        return Err("browser automation blocked a private or local network host.".to_string());
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_special_ip(ip) {
            return Err(
                "browser automation blocked a private or special-use IP address.".to_string(),
            );
        }
    }

    Ok(url)
}

fn is_loopback_browser_automation_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".localhost") || host == "0.0.0.0" {
        return true;
    }

    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn is_private_or_special_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_private_or_special_ipv4(ip),
        IpAddr::V6(ip) => is_private_or_special_ipv6(ip),
    }
}

fn is_private_or_special_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();

    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_unspecified()
        || ip == Ipv4Addr::new(255, 255, 255, 255)
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 169 && octets[1] == 254)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
}

fn is_private_or_special_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    let first = segments[0];

    ip.is_loopback()
        || ip.is_multicast()
        || ip.is_unspecified()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
}

fn browser_user_agent() -> &'static str {
    if cfg!(target_os = "windows") {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GilbertCodex/0.1"
    } else if cfg!(target_os = "macos") {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 GilbertCodex/0.1"
    } else if cfg!(target_os = "linux") {
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 GilbertCodex/0.1"
    } else {
        APP_USER_AGENT
    }
}

fn extract_title(html: &str) -> String {
    let lower = html.to_lowercase();
    let Some(start) = lower.find("<title") else {
        return String::new();
    };
    let Some(open_end) = lower[start..].find('>') else {
        return String::new();
    };
    let content_start = start + open_end + 1;
    let Some(close_start) = lower[content_start..].find("</title>") else {
        return String::new();
    };

    decode_html_entities(&html[content_start..content_start + close_start])
        .trim()
        .to_string()
}

fn extract_links(html: &str, base_url: &str) -> Vec<BrowserAutomationLink> {
    let lower = html.to_lowercase();
    let mut links = Vec::new();
    let mut offset = 0;

    while let Some(anchor_start) = lower[offset..].find("<a") {
        let start = offset + anchor_start;
        let Some(tag_end) = lower[start..].find('>') else {
            break;
        };
        let tag = &html[start..start + tag_end + 1];
        let href = extract_attribute(tag, "href");
        let content_start = start + tag_end + 1;
        let Some(anchor_end) = lower[content_start..].find("</a>") else {
            offset = content_start;
            continue;
        };
        let label = html_to_text(&html[content_start..content_start + anchor_end]);

        if let Some(href) = href {
            if !label.trim().is_empty() {
                links.push(BrowserAutomationLink {
                    href: absolutize_url(base_url, href.trim()),
                    text: label.trim().to_string(),
                });
            }
        }

        offset = content_start + anchor_end + "</a>".len();
    }

    links
}

fn extract_attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let pattern = format!("{name}=");
    let start = lower.find(&pattern)? + pattern.len();
    let value = tag[start..].trim_start();
    let quote = value.chars().next()?;

    if quote == '"' || quote == '\'' {
        let end = value[1..].find(quote)?;
        return Some(decode_html_entities(&value[1..1 + end]));
    }

    let end = value
        .find(|character: char| character.is_whitespace() || character == '>')
        .unwrap_or(value.len());
    Some(decode_html_entities(&value[..end]))
}

fn html_to_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;

    for character in html.chars() {
        match character {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }

    decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn absolutize_url(base_url: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }

    if href.starts_with("//") {
        return format!("https:{href}");
    }

    let origin_end = base_url
        .find("://")
        .and_then(|scheme_end| {
            base_url[scheme_end + 3..]
                .find('/')
                .map(|path_start| scheme_end + 3 + path_start)
        })
        .unwrap_or(base_url.len());
    let origin = &base_url[..origin_end];

    if href.starts_with('/') {
        format!("{origin}{href}")
    } else {
        let directory_end = base_url.rfind('/').unwrap_or(origin_end);
        format!("{}/{}", &base_url[..directory_end], href)
    }
}

#[cfg(test)]
mod tests {
    use super::validate_browser_automation_url;

    #[test]
    fn browser_automation_allows_public_https() {
        assert!(validate_browser_automation_url("https://example.com/page").is_ok());
    }

    #[test]
    fn browser_automation_allows_loopback_http() {
        assert!(validate_browser_automation_url("http://127.0.0.1:5173/").is_ok());
        assert!(validate_browser_automation_url("http://localhost:5173/").is_ok());
    }

    #[test]
    fn browser_automation_blocks_plain_http_public_hosts() {
        assert!(validate_browser_automation_url("http://example.com/").is_err());
    }

    #[test]
    fn browser_automation_blocks_private_and_metadata_ips() {
        assert!(validate_browser_automation_url("https://192.168.1.1/").is_err());
        assert!(
            validate_browser_automation_url("https://169.254.169.254/latest/meta-data/").is_err()
        );
        assert!(validate_browser_automation_url("https://[fd00::1]/").is_err());
    }

    #[test]
    fn browser_automation_blocks_embedded_credentials() {
        assert!(validate_browser_automation_url("https://user:pass@example.com/").is_err());
    }
}
