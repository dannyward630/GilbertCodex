---
name: web-search-tool
description: Use when web search is enabled and the answer depends on current facts, official docs, external APIs, package behavior, provider models, brand data, changelogs, or source-backed claims.
---

# Web Search Tool

Use `web_search` before answering when the user asks for current or source-backed information, or when package/API/provider behavior could have changed.

After results arrive:
- Treat them as live evidence.
- Cite supported claims with Markdown links using only listed URLs.
- Say when the results are insufficient instead of filling gaps from memory.
- Do not repeat the same search unless the query needs a materially different source.

XML shape:

```xml
<tool_call>
web_search
<arg_key>query</arg_key><arg_value>official docs query</arg_value>
</tool_call>
```
