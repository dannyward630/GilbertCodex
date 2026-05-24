# Plugin Marketplace Notes

Gilbert Codex now treats plugins as a marketplace-backed surface instead of only three hand-built cards.

## What Gilbert Is Doing

Gilbert Codex plugins are marketplace entries that point at plugin folders. A plugin can bundle:

- `skills/` for reusable workflow instructions.
- `.app.json` for hosted app or connector mappings.
- `.mcp.json` for bundled MCP server configuration.
- hooks and assets for richer install surfaces.

Gilbert loads an upstream public plugin catalog in Apps > Plugins so users can discover broad plugin bundles without us manually recreating every card.

## What Gilbert Can Actually Run

Gilbert should only mark a plugin usable when there is a real local execution route:

- Native route: Gmail, Google Calendar, and GitHub continue using Gilbert's app-owned auth and tool bridge.
- MCP route: plugins such as Figma, Stripe, Vercel, Notion, Linear, Atlassian, Cloudflare, Supabase, and Sentry map to curated MCP presets, then reuse Save, Test, secure storage, and chat MCP tools.
- Skill route: plugins with bundled `SKILL.md` files can import those skills into Gilbert's local skill registry.
- Registry route: app-only marketplace entries search the public MCP Registry for a runnable server replacement.

Hosted `.app.json` connector IDs are not enough for Gilbert to call tools directly. Those IDs depend on another hosted connector runtime, so the app must not claim them as live tools unless a native or MCP implementation exists.

## Sources Checked

- Codex plugin docs: plugins bundle skills, app integrations, and MCP servers; marketplace files live under repo or personal `.agents/plugins/marketplace.json`.
- Public plugin repo: `openai/plugins` contains the upstream curated marketplace and plugin manifests.
- MCP docs: remote MCP servers and connectors expose tools through list/call flows.
- MCP Registry docs: the public registry is the official metadata and install-hint source for publicly accessible MCP servers.
