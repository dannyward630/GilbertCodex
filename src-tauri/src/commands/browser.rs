use base64::Engine;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;
use tauri::Manager;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewCaptureRequest {
    pub clip: Option<BrowserPreviewCaptureClip>,
    pub format: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewCaptureClip {
    pub height: f64,
    pub scale: Option<f64>,
    pub width: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewCaptureResponse {
    pub clip: Option<BrowserPreviewCaptureClip>,
    pub data_url: String,
    pub label: String,
    pub mime_type: String,
    pub size_bytes: usize,
    pub url: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_preview_get_url(
    app: tauri::AppHandle,
    label: String,
) -> Result<Option<String>, String> {
    let webview = match get_browser_preview_webview(&app, &label)? {
        Some(webview) => webview,
        None => return Ok(None),
    };

    webview
        .url()
        .map(|url| Some(url.to_string()))
        .map_err(|error| format!("Could not read browser URL: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_preview_navigate(
    app: tauri::AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    let target_url = validate_browser_preview_url(&url)?;
    let webview = get_browser_preview_webview(&app, &label)?
        .ok_or_else(|| "Browser view is no longer available.".to_string())?;

    webview
        .navigate(target_url)
        .map_err(|error| format!("Could not navigate browser: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_preview_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let webview = get_browser_preview_webview(&app, &label)?
        .ok_or_else(|| "Browser view is no longer available.".to_string())?;

    webview
        .reload()
        .map_err(|error| format!("Could not reload browser: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn browser_preview_capture(
    app: tauri::AppHandle,
    request: BrowserPreviewCaptureRequest,
) -> Result<BrowserPreviewCaptureResponse, String> {
    let label = normalize_browser_preview_capture_label(request.label)?;
    let format = normalize_browser_preview_capture_format(request.format)?;
    let clip = request
        .clip
        .map(validate_browser_preview_capture_clip)
        .transpose()?;
    let webview = get_browser_preview_capture_webview(&app, &label)?
        .ok_or_else(|| "Browser view is no longer available.".to_string())?;
    let url = webview.url().ok().map(|url| url.to_string());
    let params = build_browser_preview_capture_params(&format, clip.as_ref())?;
    let result_json = capture_webview_with_devtools(&webview, params.to_string())?;
    let base64_data = extract_capture_screenshot_data(&result_json)?;
    let size_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map(|bytes| bytes.len())
        .unwrap_or_else(|_| estimate_base64_payload_bytes(&base64_data));

    Ok(BrowserPreviewCaptureResponse {
        clip,
        data_url: format!("data:image/{format};base64,{base64_data}"),
        label,
        mime_type: format!("image/{format}"),
        size_bytes,
        url,
    })
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

fn get_browser_preview_webview(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<Option<tauri::Webview>, String> {
    if !label.starts_with("browser-preview-") {
        return Err("Refusing to control a non-browser webview.".to_string());
    }

    Ok(app.get_webview(label))
}

fn get_browser_preview_capture_webview(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<Option<tauri::Webview>, String> {
    if label == "main" || label.starts_with("browser-preview-") {
        return Ok(app.get_webview(label));
    }

    Err("Refusing to capture a non-browser webview.".to_string())
}

fn validate_browser_preview_url(raw_url: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw_url.trim())
        .map_err(|_| "Browser navigation needs a valid http(s) URL.".to_string())?;
    let scheme = url.scheme();

    if scheme != "http" && scheme != "https" {
        return Err("Browser navigation only supports http(s) URLs.".to_string());
    }

    Ok(url)
}

fn normalize_browser_preview_capture_label(label: Option<String>) -> Result<String, String> {
    let label = label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main")
        .to_string();

    if label == "main" || label.starts_with("browser-preview-") {
        return Ok(label);
    }

    Err(
        "Browser screenshot capture can only target the main app or browser preview webviews."
            .to_string(),
    )
}

fn normalize_browser_preview_capture_format(format: Option<String>) -> Result<String, String> {
    let format = format
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("png")
        .to_ascii_lowercase();

    if format == "png" {
        Ok(format)
    } else {
        Err("Browser screenshot capture currently supports PNG only.".to_string())
    }
}

fn validate_browser_preview_capture_clip(
    clip: BrowserPreviewCaptureClip,
) -> Result<BrowserPreviewCaptureClip, String> {
    if !clip.x.is_finite()
        || !clip.y.is_finite()
        || !clip.width.is_finite()
        || !clip.height.is_finite()
        || clip.scale.is_some_and(|scale| !scale.is_finite())
    {
        return Err("Browser screenshot clip must use finite numbers.".to_string());
    }

    if clip.x < 0.0 || clip.y < 0.0 || clip.width <= 0.0 || clip.height <= 0.0 {
        return Err("Browser screenshot clip needs a positive area.".to_string());
    }

    if clip.scale.is_some_and(|scale| scale <= 0.0) {
        return Err("Browser screenshot clip scale must be greater than zero.".to_string());
    }

    Ok(clip)
}

fn build_browser_preview_capture_params(
    format: &str,
    clip: Option<&BrowserPreviewCaptureClip>,
) -> Result<serde_json::Value, String> {
    let mut params = serde_json::json!({
        "captureBeyondViewport": false,
        "format": format,
        "fromSurface": true,
    });

    if let Some(clip) = clip {
        params["clip"] = serde_json::json!({
            "height": clip.height,
            "scale": clip.scale.unwrap_or(1.0),
            "width": clip.width,
            "x": clip.x,
            "y": clip.y,
        });
    }

    Ok(params)
}

fn extract_capture_screenshot_data(result_json: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(result_json)
        .map_err(|error| format!("Could not parse browser screenshot response: {error}"))?;
    value
        .get("data")
        .and_then(serde_json::Value::as_str)
        .filter(|data| !data.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Browser screenshot response did not include image data.".to_string())
}

fn estimate_base64_payload_bytes(value: &str) -> usize {
    let padding = value
        .chars()
        .rev()
        .take_while(|character| *character == '=')
        .count();
    (value.len() * 3 / 4).saturating_sub(padding)
}

#[cfg(windows)]
fn capture_webview_with_devtools(
    webview: &tauri::Webview,
    params_json: String,
) -> Result<String, String> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let result = capture_windows_platform_webview(platform, params_json);
            let _ = tx.send(result);
        })
        .map_err(|error| format!("Could not access browser webview: {error}"))?;

    rx.recv_timeout(Duration::from_secs(12))
        .map_err(|_| "Timed out while capturing browser screenshot.".to_string())?
}

#[cfg(windows)]
fn capture_windows_platform_webview(
    platform: tauri::webview::PlatformWebview,
    params_json: String,
) -> Result<String, String> {
    use std::sync::mpsc;
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

    let controller = platform.controller();
    let core = unsafe { controller.CoreWebView2() }
        .map_err(|error| format!("Could not access WebView2: {error}"))?;
    let (tx, rx) = mpsc::channel();
    let core_for_call = core.clone();
    let params_for_call = params_json;

    CallDevToolsProtocolMethodCompletedHandler::wait_for_async_operation(
        Box::new(move |handler| unsafe {
            let method = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let params = CoTaskMemPWSTR::from(params_for_call.as_str());
            core_for_call
                .CallDevToolsProtocolMethod(
                    *method.as_ref().as_pcwstr(),
                    *params.as_ref().as_pcwstr(),
                    &handler,
                )
                .map_err(webview2_com::Error::WindowsError)
        }),
        Box::new(move |error_code, result_json| {
            let result = error_code
                .map(|()| result_json)
                .map_err(|error| format!("WebView2 screenshot capture failed: {error}"));
            let _ = tx.send(result);
            Ok(())
        }),
    )
    .map_err(|error| format!("Could not capture browser screenshot: {error}"))?;

    rx.recv_timeout(Duration::from_secs(12))
        .map_err(|_| "Timed out while reading browser screenshot.".to_string())?
}

#[cfg(not(windows))]
fn capture_webview_with_devtools(
    _webview: &tauri::Webview,
    _params_json: String,
) -> Result<String, String> {
    Err("Browser screenshot capture is currently implemented for the Windows WebView2 desktop runtime."
        .to_string())
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
    use super::{
        normalize_browser_preview_capture_label, validate_browser_automation_url,
        validate_browser_preview_capture_clip, BrowserPreviewCaptureClip,
    };

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

    #[test]
    fn browser_capture_allows_only_main_and_preview_labels() {
        assert_eq!(
            normalize_browser_preview_capture_label(None).unwrap(),
            "main"
        );
        assert_eq!(
            normalize_browser_preview_capture_label(Some(" browser-preview-1-tab ".to_string()))
                .unwrap(),
            "browser-preview-1-tab"
        );
        assert!(normalize_browser_preview_capture_label(Some("settings".to_string())).is_err());
    }

    #[test]
    fn browser_capture_rejects_invalid_clip_area() {
        assert!(
            validate_browser_preview_capture_clip(BrowserPreviewCaptureClip {
                height: 200.0,
                scale: Some(1.0),
                width: 300.0,
                x: 0.0,
                y: 0.0,
            })
            .is_ok()
        );
        assert!(
            validate_browser_preview_capture_clip(BrowserPreviewCaptureClip {
                height: 0.0,
                scale: Some(1.0),
                width: 300.0,
                x: 0.0,
                y: 0.0,
            })
            .is_err()
        );
        assert!(
            validate_browser_preview_capture_clip(BrowserPreviewCaptureClip {
                height: 200.0,
                scale: Some(-1.0),
                width: 300.0,
                x: 0.0,
                y: 0.0,
            })
            .is_err()
        );
    }
}
