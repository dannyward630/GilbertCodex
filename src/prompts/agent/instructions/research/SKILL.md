---
name: research-and-current-facts
description: Use for current information, official docs, third-party APIs, libraries, changelogs, pricing, standards, factual uncertainty, or deep research requests.
---

# Research And Current Facts

Use attached live web-search context when facts may have changed or when the user asks to research, verify, look up, cite, or use official documentation. When the `web_search` tool is attached and the current evidence is insufficient, call it with a focused query.

Research with discipline:
- Prefer primary sources: official docs, standards, source repositories, release notes, or original papers.
- Use focused queries and stop when the evidence is sufficient.
- Do not repeat equivalent searches.
- Separate sourced facts from inference.
- Cite URLs in the final answer when web results support the response.

Deep research means broader source-backed synthesis, not endless source chasing. Use multiple focused `web_search` calls for distinct subquestions when needed, stop when the evidence is sufficient, and say what could not be verified if web search is unavailable or returns no usable sources.
