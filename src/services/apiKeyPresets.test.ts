import { describe, expect, it } from "vitest";
import { API_KEY_PRESETS } from "./apiKeyPresets";

describe("API key presets", () => {
  it("keeps model provider API keys out of the Keys page preset catalog", () => {
    const labels = API_KEY_PRESETS.map((preset) => preset.label);

    expect(API_KEY_PRESETS.some((preset) => (preset.kind as string) === "provider")).toBe(false);
    expect(labels).not.toContain("OpenAI API key");
    expect(labels).not.toContain("Anthropic API key");
    expect(labels).not.toContain("OpenRouter API key");
    expect(labels).not.toContain("Google AI Studio API key");
  });

  it("covers curated MCP requirements that need saved credentials", () => {
    const namesByService = new Set(API_KEY_PRESETS.map((preset) => `${preset.service}:${preset.keyName}`));

    expect(namesByService).toContain("stripe:STRIPE_SECRET_KEY");
    expect(namesByService).toContain("context7:CONTEXT7_API_KEY");
    expect(namesByService).toContain("mongodb:MDB_MCP_CONNECTION_STRING");
    expect(namesByService).toContain("mongodb:MDB_MCP_API_CLIENT_ID");
    expect(namesByService).toContain("mongodb:MDB_MCP_API_CLIENT_SECRET");
    expect(namesByService).toContain("redis:REDIS_URL");
    expect(namesByService).toContain("github:Authorization");
    expect(namesByService).toContain("cloudflare:Authorization");
    expect(namesByService).toContain("aws:AWS_ACCESS_KEY_ID");
    expect(namesByService).toContain("aws:AWS_SECRET_ACCESS_KEY");
    expect(namesByService).toContain("aws:AWS_SESSION_TOKEN");
    expect(namesByService).toContain("apify:APIFY_TOKEN");
    expect(namesByService).toContain("brave-search:BRAVE_API_KEY");
    expect(namesByService).toContain("browserbase:BROWSERBASE_API_KEY");
    expect(namesByService).toContain("browserbase:BROWSERBASE_PROJECT_ID");
    expect(namesByService).toContain("exa:EXA_API_KEY");
    expect(namesByService).toContain("firecrawl:FIRECRAWL_API_KEY");
    expect(namesByService).toContain("heroku:HEROKU_API_KEY");
    expect(namesByService).toContain("netlify:NETLIFY_PERSONAL_ACCESS_TOKEN");
    expect(namesByService).toContain("pulumi:PULUMI_ACCESS_TOKEN");
    expect(namesByService).toContain("slack:SLACK_BOT_TOKEN");
    expect(namesByService).toContain("slack:SLACK_TEAM_ID");
    expect(namesByService).toContain("tavily:TAVILY_API_KEY");
  });

  it("covers bundled non-model skill credentials", () => {
    const namesByService = new Set(API_KEY_PRESETS.map((preset) => `${preset.service}:${preset.keyName}`));

    expect(namesByService).toContain("firebase:FIREBASE_TOKEN");
    expect(namesByService).toContain("figma:FIGMA_ACCESS_TOKEN");
    expect(namesByService).toContain("github:GITHUB_TOKEN");
    expect(namesByService).toContain("remotion:REMOTION_MAPBOX_TOKEN");
    expect(namesByService).toContain("elevenlabs:ELEVENLABS_API_KEY");
    expect(namesByService).toContain("sentry:SENTRY_AUTH_TOKEN");
    expect(namesByService).toContain("slack:SLACK_SIGNING_SECRET");
  });

  it("covers non-model app and service credentials", () => {
    const namesByService = new Set(API_KEY_PRESETS.map((preset) => `${preset.service}:${preset.keyName}`));

    expect(namesByService).toContain("brave-search:BRAVE_SEARCH_API_KEY");
    expect(namesByService).toContain("discord:DISCORD_APPLICATION_ID");
    expect(namesByService).toContain("discord:DISCORD_BOT_TOKEN");
    expect(namesByService).toContain("discord:DISCORD_PUBLIC_KEY");
    expect(namesByService).toContain("discord:DISCORD_WEBHOOK_URL");
    expect(namesByService).toContain("github:GITHUB_OAUTH_CLIENT_ID");
    expect(namesByService).toContain("google:GOOGLE_OAUTH_CLIENT_ID");
    expect(namesByService).toContain("google:GOOGLE_OAUTH_CLIENT_SECRET");
    expect(namesByService).toContain("mapbox:MAPBOX_ACCESS_TOKEN");
    expect(namesByService).toContain("ngrok:NGROK_AUTHTOKEN");
  });
});
