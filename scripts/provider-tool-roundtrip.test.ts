import test from "node:test";
import assert from "node:assert/strict";
import {
  FORCE_XML_TOOL_PROTOCOL,
  getToolSchema,
  modelSupportsNativeTools,
  toAnthropicTools,
  toOpenAIResponsesTools,
  toOpenAITools,
  type AnthropicTool,
  type OpenAIResponsesFunctionTool,
  type OpenAITool,
} from "../src/services/toolSchemaAdapters.ts";
import { isOpenRouterFreeModel } from "../src/lib/models.ts";
import { createOpenAIResponsesMcpTools, isOpenAiMcpPassthroughAvailable } from "../src/services/mcpTools.ts";
import { normalizeToolName } from "../src/tools/computer/executor/toolNames.ts";
import { createDefaultMcpServer } from "../src/types/mcp.ts";
import { DEFAULT_TOOL_REGISTRY_SETTINGS } from "../src/types/tools.ts";
import type { ProviderSettings } from "../src/types/settings.ts";

function providerSettings(provider: ProviderSettings["provider"], overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    provider,
    model: provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-5.4",
    maxTokens: 1024,
    temperature: 0.2,
    topP: 1,
    topK: 0,
    apiKeys: {},
    baseUrls: {},
    openRouterApiKey: "",
    providerModels: {},
    systemPrompt: "",
    userInstructions: "",
    tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
    mcp: { enabled: false, servers: [] },
    thinking: { enabled: false, effort: "medium" },
    webSearch: {
      brave: {} as ProviderSettings["webSearch"]["brave"],
      enabled: false,
      maxResults: 6,
      provider: "duckduckgo",
    },
    workspaceDependencies: { enabled: false },
    ...overrides,
  };
}

test("create_files schema is registered with files + files_json", () => {
  const schema = getToolSchema("create_files");
  assert.ok(schema, "create_files schema must exist");
  assert.equal(schema!.parameters.type, "object");
  assert.ok(schema!.parameters.properties.files, "create_files needs files array property");
  assert.equal(schema!.parameters.properties.files.type, "array");
  assert.ok(schema!.parameters.properties.files_json, "create_files needs files_json fallback");
  assert.equal(schema!.parameters.properties.files_json.type, "string");
});

test("edit_files schema is registered with edits + edits_json", () => {
  const schema = getToolSchema("edit_files");
  assert.ok(schema, "edit_files schema must exist");
  assert.equal(schema!.parameters.type, "object");
  assert.ok(schema!.parameters.properties.edits, "edit_files needs edits array property");
  assert.equal(schema!.parameters.properties.edits.type, "array");
  assert.ok(schema!.parameters.properties.edits_json, "edit_files needs edits_json fallback");
  assert.equal(schema!.parameters.properties.edits_json.type, "string");
  // Ensure the per-entry shape has the path requirement Gemini OpenAI-compat needs.
  const item = schema!.parameters.properties.edits.items;
  assert.ok(item, "edits array needs items schema");
  assert.deepEqual(item!.required, ["path"]);
});

test("Anthropic adapter emits both create_files and edit_files with input_schema", () => {
  const tools: AnthropicTool[] = toAnthropicTools(["create_files", "edit_files"]);
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.ok(tool.name, "anthropic tool needs name");
    assert.equal(tool.input_schema.type, "object");
    assert.ok(tool.input_schema.properties, "anthropic tool needs properties");
  }
  const names = tools.map((entry) => entry.name);
  assert.ok(names.includes("create_files"));
  assert.ok(names.includes("edit_files"));
});

test("OpenAI adapter emits create_files + edit_files wrapped in function envelope", () => {
  const tools: OpenAITool[] = toOpenAITools(["create_files", "edit_files"]);
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.function.parameters.type, "object");
    assert.ok(tool.function.name);
    assert.ok(tool.function.description);
  }
  const names = tools.map((entry) => entry.function.name);
  assert.ok(names.includes("create_files"));
  assert.ok(names.includes("edit_files"));
});

test("OpenAI Responses adapter emits create_files + edit_files with type=function", () => {
  const tools: OpenAIResponsesFunctionTool[] = toOpenAIResponsesTools(["create_files", "edit_files"]);
  assert.equal(tools.length, 2);
  for (const tool of tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.type, "object");
    assert.ok(tool.name);
  }
});

test("Gemini OpenAI-compat consumes the OpenAI tool schema unchanged", () => {
  // Google's default base URL routes to https://generativelanguage.googleapis.com/v1beta/openai
  // which speaks the OpenAI chat-completions function-calling shape verbatim.
  const tools = toOpenAITools(["create_files", "edit_files"]);
  for (const tool of tools) {
    // Gemini strict mode rejects $ref / oneOf / anyOf — assert none leak in.
    const json = JSON.stringify(tool);
    assert.equal(json.includes("$ref"), false, "Gemini-compat schema must not include $ref");
    assert.equal(json.includes("oneOf"), false, "Gemini-compat schema must not include oneOf");
    assert.equal(json.includes("anyOf"), false, "Gemini-compat schema must not include anyOf");
  }
});

test("OpenRouter free models are still recognized as free routes", () => {
  assert.equal(isOpenRouterFreeModel("deepseek/deepseek-r1:free"), true);
});

test("XML protocol is forced for every provider-native local tool path", () => {
  assert.equal(FORCE_XML_TOOL_PROTOCOL, true);
  assert.equal(modelSupportsNativeTools(providerSettings("anthropic"), "claude-sonnet-4-6"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("openai"), "gpt-5.4"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("openrouter"), "openrouter/free"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("deepseek"), "deepseek-v4-pro"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("groq"), "openai/gpt-oss-120b"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("xai"), "grok-4.3"), false);
  assert.equal(modelSupportsNativeTools(providerSettings("mistral"), "mistral-medium-3.5"), false);
});

test("OpenAI Responses MCP passthrough is also disabled while XML is forced", () => {
  const remoteMcpServer = {
    ...createDefaultMcpServer("remote"),
    enabled: true,
    label: "docs",
    serverUrl: "https://example.com/mcp",
  };
  const settings = providerSettings("openai", {
      mcp: { enabled: true, servers: [remoteMcpServer] },
      thinking: { enabled: true, effort: "medium" },
  });

  assert.equal(isOpenAiMcpPassthroughAvailable(settings), false);
  assert.deepEqual(createOpenAIResponsesMcpTools(settings), []);
});

test("normalizeToolName routes provider-emitted edit_files aliases to canonical name", () => {
  assert.equal(normalizeToolName("edit_files", { edits_json: "[]" }), "edit_files");
  assert.equal(normalizeToolName("edit-files", { edits: "[]" }), "edit_files");
  assert.equal(normalizeToolName("apply_edits", { patches_json: "[]" }), "edit_files");
  assert.equal(normalizeToolName("patch_files", { edits: "[{}]" }), "edit_files");
});

test("normalizeToolName infers edit_files when only args contain edits", () => {
  // Models that emit a placeholder name with the right args should still route.
  assert.equal(normalizeToolName("function", { edits_json: "[]" }), "edit_files");
  assert.equal(normalizeToolName("tool_call", { edits: "[{\"path\":\"a\"}]" }), "edit_files");
});
