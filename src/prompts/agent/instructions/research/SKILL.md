---
name: research-and-current-facts
description: Use for current information, official docs, third-party APIs, libraries, changelogs, pricing, standards, factual uncertainty, or deep research requests.
---

# Research And Current Facts

Use attached live web-search context when facts may have changed or when the user asks to research, verify, look up, cite, or use official documentation. Web search is host-managed in this build; do not emit tool-call syntax.

Research with discipline:
- Prefer primary sources: official docs, standards, source repositories, release notes, or original papers.
- Use focused queries and stop when the evidence is sufficient.
- Do not repeat equivalent searches.
- Separate sourced facts from inference.
- Cite URLs in the final answer when web results support the response.

Deep research means broader source-backed synthesis from the attached evidence, not endless source chasing. If more sources are required and none were attached, say what should be searched next.
