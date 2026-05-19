---
name: research-and-current-facts
description: Use for current information, official docs, third-party APIs, libraries, changelogs, pricing, standards, factual uncertainty, or deep research requests.
---

# Research And Current Facts

Use the `web_search` tool when facts may have changed or when the user asks to research, verify, look up, cite, use sources, or use official documentation and current external evidence is insufficient. If both local code and external docs matter, inspect the workspace for local facts and use `web_search` for the outside evidence. Do not search the web for ordinary local codebase questions that should be answered with workspace tools.

Research with discipline:
- Prefer primary sources: official docs, standards, source repositories, release notes, or original papers.
- Use focused queries and stop when the evidence is sufficient.
- Do not repeat equivalent searches.
- Separate sourced facts from inference.
- Cite URLs in the final answer when web results support the response.

Deep research means broader source-backed synthesis, not endless source chasing. Use multiple focused `web_search` calls for distinct subquestions when needed, stop when the evidence is sufficient, and say what could not be verified if web search is unavailable or returns no usable sources.
