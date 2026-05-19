const DSML_MARKER_PATTERN = /<\s*\|\s*DSML\s*\|\s*(?:tool_calls|invoke|parameter)\b/i;
const XML_TOOL_CALL_PATTERN = /<\s*(?:\/?\s*tool_call\b|\/?\s*(?:files_|git_|terminal_|browser_|web_|github_|bridge_)[\w.-]+\b|\/?\s*arg_(?:key|value)\b)/i;
const TOOL_CALLS_JSON_PATTERN = /"tool_calls"\s*:\s*\[/i;
const FENCED_TOOL_CALLS_JSON_PATTERN = /(^|\n)\s{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?"tool_calls"\s*:\s*\[[\s\S]*?\r?\n\s{0,3}\2[ \t]*(?=\r?\n|$)/gi;

/** Removes model-written tool protocol text from content that may be rendered. */
export function stripVisibleToolProtocol(content: string) {
  if (!content) {
    return "";
  }

  let next = content
    .replace(/<<<TOOL_CALL>>>[\s\S]*?(?:<<<END_TOOL_CALL>>>|$)/g, "")
    .replace(/<\s*\|\s*DSML\s*\|\s*tool_calls\s*>[\s\S]*?<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/gi, "")
    .replace(/<\s*\|\s*DSML\s*\|\s*invoke\b[^>]*>[\s\S]*?<\s*\/\s*\|\s*DSML\s*\|\s*invoke\s*>/gi, "")
    .replace(/<tool_call\b[\s\S]*?(?:<\/tool_call>|$)/gi, "")
    .replace(/<\s*(?:files_|git_|terminal_|browser_|web_|github_|bridge_)[\w.-]+\b[\s\S]*?<\s*\/\s*(?:files_|git_|terminal_|browser_|web_|github_|bridge_)[\w.-]+\s*>/gi, "");

  next = stripProviderToolCallJson(next);

  next = stripFromFirstMarker(next, DSML_MARKER_PATTERN);
  next = stripFromFirstMarker(next, XML_TOOL_CALL_PATTERN);
  next = stripProviderToolCallJson(next);

  return next.trim();
}

export function looksLikeVisibleToolProtocol(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  return DSML_MARKER_PATTERN.test(trimmed) || XML_TOOL_CALL_PATTERN.test(trimmed) || TOOL_CALLS_JSON_PATTERN.test(trimmed);
}

function stripProviderToolCallJson(content: string) {
  let next = content.replace(FENCED_TOOL_CALLS_JSON_PATTERN, (match, leading: string) =>
    isProviderToolCallJson(match) ? leading || "" : match,
  );
  const markerMatch = TOOL_CALLS_JSON_PATTERN.exec(next);

  if (!markerMatch || !isProviderToolCallJson(next.slice(Math.max(0, markerMatch.index - 300)))) {
    return next;
  }

  const prefix = next.slice(0, markerMatch.index);
  const objectStart = prefix.lastIndexOf("{");
  const stripIndex = objectStart >= 0 ? objectStart : markerMatch.index;

  next = next.slice(0, stripIndex);
  return next;
}

function isProviderToolCallJson(content: string) {
  return TOOL_CALLS_JSON_PATTERN.test(content);
}

function stripFromFirstMarker(content: string, pattern: RegExp) {
  const match = pattern.exec(content);

  if (!match || match.index < 0) {
    return content;
  }

  return content.slice(0, match.index);
}
