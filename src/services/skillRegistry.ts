import codingWorkflow from "../prompts/agent/instructions/coding/SKILL.md?raw";
import frontendQuality from "../prompts/agent/instructions/frontend/SKILL.md?raw";
import researchFacts from "../prompts/agent/instructions/research/SKILL.md?raw";
import codeReview from "../prompts/agent/instructions/review/SKILL.md?raw";
import { loadPersistentString, savePersistentString } from "../lib/appStorage";
import { pickComputerFolder, readComputerTextFile } from "../localWorkspace/files";
import type { AppSkill, SkillDraft, SkillPreset, SkillPromptMatch, SkillRegistryState, SkillSafetyLevel, SkillSource } from "../types/skills";

const SKILL_REGISTRY_KEY = "gilbert-codex.skills.v1";
const SKILL_REGISTRY_CHANGED_EVENT = "gilbert-codex.skills.changed";
const MAX_AVAILABLE_SKILLS_IN_PROMPT = 18;
const MAX_ACTIVE_SKILLS_IN_PROMPT = 3;
const MAX_SKILL_INSTRUCTION_CHARS = 4_500;
const SEMANTIC_MATCH_THRESHOLD = 0.12;

export const SKILL_PRESETS: SkillPreset[] = [
  {
    author: "Gilbert Codex",
    category: "Engineering",
    defaultInstalled: true,
    description: "Investigate, edit, verify, and summarize code changes with real workspace evidence.",
    id: "coding-agent-workflow",
    instructions: codingWorkflow,
    name: "Coding Agent Workflow",
    safetyLevel: "medium",
    tags: ["code", "debug", "files", "tests", "workspace"],
    trigger: "$coding",
  },
  {
    author: "Gilbert Codex",
    category: "Design",
    defaultInstalled: true,
    description: "Build polished frontend UI with responsive layout, visual QA, and practical interaction details.",
    id: "frontend-product-quality",
    instructions: frontendQuality,
    name: "Frontend Product Quality",
    safetyLevel: "medium",
    tags: ["ui", "ux", "frontend", "css", "responsive"],
    trigger: "$frontend",
  },
  {
    author: "Gilbert Codex",
    category: "Quality",
    defaultInstalled: true,
    description: "Review code changes for defects, regressions, security risk, and missing verification.",
    id: "code-review",
    instructions: codeReview,
    name: "Code Review",
    safetyLevel: "low",
    tags: ["review", "audit", "security", "regression", "tests"],
    trigger: "$review",
  },
  {
    author: "Gilbert Codex",
    category: "Research",
    defaultInstalled: true,
    description: "Use current sources and official documentation when facts, APIs, pricing, or behavior can change.",
    id: "research-current-facts",
    instructions: researchFacts,
    name: "Current Facts Research",
    safetyLevel: "low",
    tags: ["research", "docs", "latest", "citations", "web"],
    trigger: "$research",
  },
  {
    author: "Gilbert Codex",
    category: "Authoring",
    defaultInstalled: true,
    description: "Create or improve reusable skills with short triggers, tight instructions, assets, and validation notes.",
    id: "skill-creator",
    instructions: [
      "---",
      "name: skill-creator",
      "description: Create or improve reusable skills for repeatable work.",
      "---",
      "",
      "Use this skill when the user wants to create, refine, evaluate, or package a reusable skill.",
      "",
      "A strong skill has a concise name, an accurate description, clear trigger guidance, short primary instructions, and only the supporting files it needs. Keep the instructions focused on repeatable behavior rather than one-off project facts. If the skill can run commands, access private data, or make changes, call out the approval and verification expectations explicitly.",
      "",
      "When creating a skill, produce a valid `SKILL.md` with YAML front matter containing `name` and `description`. Prefer examples, scripts, or templates only when they reduce ambiguity for future runs.",
    ].join("\n"),
    name: "Skill Creator",
    safetyLevel: "low",
    tags: ["skills", "authoring", "workflow", "templates"],
    trigger: "$skill-creator",
  },
  {
    author: "Gilbert Codex",
    category: "Operations",
    defaultInstalled: false,
    description: "Run repeatable release or maintenance checklists with explicit verification and rollback notes.",
    id: "release-checklist",
    instructions: [
      "---",
      "name: release-checklist",
      "description: Prepare and verify release or maintenance work.",
      "---",
      "",
      "Use this skill for repeatable release prep, maintenance sweeps, or pre-publish checks.",
      "",
      "Identify the release target, inspect current repo state, run the smallest meaningful verification first, then broaden checks only where risk warrants it. Keep user-visible output focused on changed files, commands run, failures, and the exact artifact or branch that is ready.",
    ].join("\n"),
    name: "Release Checklist",
    safetyLevel: "medium",
    tags: ["release", "checklist", "verification", "maintenance"],
    trigger: "$release",
  },
];

export function loadSkillRegistry(): SkillRegistryState {
  const stored = readStoredSkillRegistry();
  const now = new Date().toISOString();

  if (!stored) {
    return {
      skills: SKILL_PRESETS.filter((preset) => preset.defaultInstalled).map((preset) => createSkillFromPreset(preset, now, true)),
      updatedAt: now,
      version: 1,
    };
  }

  const mergedSkills = mergePresetUpdates((stored.skills ?? []).map(normalizeStoredSkill).filter(Boolean) as AppSkill[]);

  return {
    skills: sortSkills(mergedSkills),
    updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : now,
    version: 1,
  };
}

export function saveSkillRegistry(state: SkillRegistryState) {
  const normalizedState: SkillRegistryState = {
    skills: sortSkills(state.skills.map(normalizeStoredSkill).filter(Boolean) as AppSkill[]),
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  savePersistentString(SKILL_REGISTRY_KEY, JSON.stringify(normalizedState));
  dispatchSkillRegistryChanged(normalizedState);
}

export function subscribeSkillRegistry(listener: (state: SkillRegistryState) => void) {
  function handleRegistryChanged(event: Event) {
    listener(event instanceof CustomEvent ? loadSkillRegistryFromDetail(event.detail) : loadSkillRegistry());
  }

  window.addEventListener(SKILL_REGISTRY_CHANGED_EVENT, handleRegistryChanged);
  return () => window.removeEventListener(SKILL_REGISTRY_CHANGED_EVENT, handleRegistryChanged);
}

export function listSkillPresets() {
  return SKILL_PRESETS;
}

export function installSkillPreset(presetId: string) {
  const state = loadSkillRegistry();
  const preset = SKILL_PRESETS.find((candidate) => candidate.id === presetId);

  if (!preset) {
    throw new Error("That premade skill is not available.");
  }

  const now = new Date().toISOString();
  const existing = state.skills.find((skill) => skill.id === preset.id && skill.source === "premade");
  const skills = existing
    ? state.skills.map((skill) =>
        skill.id === preset.id && skill.source === "premade"
          ? {
              ...createSkillFromPreset(preset, skill.createdAt, true),
              enabled: true,
              updatedAt: now,
            }
          : skill,
      )
    : [...state.skills, createSkillFromPreset(preset, now, true)];

  saveSkillRegistry({
    skills,
    updatedAt: now,
    version: 1,
  });
}

export function uninstallSkill(skillId: string) {
  const state = loadSkillRegistry();
  const now = new Date().toISOString();

  saveSkillRegistry({
    skills: state.skills.flatMap((skill) => {
      if (skill.id !== skillId) {
        return [skill];
      }

      if (skill.source === "premade") {
        return [{
          ...skill,
          enabled: false,
          installed: false,
          updatedAt: now,
        }];
      }

      return [];
    }),
    updatedAt: now,
    version: 1,
  });
}

export function setSkillEnabled(skillId: string, enabled: boolean) {
  const state = loadSkillRegistry();
  const now = new Date().toISOString();

  saveSkillRegistry({
    skills: state.skills.map((skill) =>
      skill.id === skillId
        ? {
            ...skill,
            enabled,
            installed: skill.installed || enabled,
            updatedAt: now,
          }
        : skill,
    ),
    updatedAt: now,
    version: 1,
  });
}

export function upsertCustomSkill(draft: SkillDraft) {
  const state = loadSkillRegistry();
  const now = new Date().toISOString();
  const source = draft.source === "imported" ? "imported" : "custom";
  const id = normalizeSkillId(draft.id || draft.name);
  const existing = state.skills.find((skill) => skill.id === id);

  if (existing?.source === "premade") {
    throw new Error("That skill id is reserved by a premade skill.");
  }

  const skill = normalizeStoredSkill({
    author: source === "custom" ? "You" : "Imported",
    category: normalizeSkillCategory(draft.category),
    createdAt: existing?.createdAt ?? now,
    description: draft.description,
    enabled: draft.enabled ?? true,
    id,
    installed: true,
    instructions: draft.instructions,
    name: draft.name,
    path: draft.path,
    safetyLevel: normalizeSafetyLevel(draft.safetyLevel),
    source,
    tags: normalizeSkillTags(draft.tags ?? []),
    trigger: draft.trigger || `$${id}`,
    updatedAt: now,
    version: existing?.version ?? 1,
  });

  if (!skill) {
    throw new Error("Skill needs a name, description, and instructions.");
  }

  saveSkillRegistry({
    skills: existing ? state.skills.map((candidate) => (candidate.id === id ? skill : candidate)) : [...state.skills, skill],
    updatedAt: now,
    version: 1,
  });

  return skill;
}

export async function importSkillFromFolder() {
  const folder = await pickComputerFolder();

  if (!folder) {
    return null;
  }

  return await importSkillFromPath(folder);
}

export async function importSkillFromPath(folderPath: string) {
  const normalizedFolderPath = folderPath.trim();

  if (!normalizedFolderPath) {
    throw new Error("Choose a skill folder first.");
  }

  const manifest = await readSkillManifestFromFolder(normalizedFolderPath);
  const parsed = parseSkillMarkdown(manifest.content);
  const skill = upsertCustomSkill({
    category: parsed.category || "Imported",
    description: parsed.description,
    enabled: false,
    instructions: manifest.content,
    name: parsed.name,
    path: normalizedFolderPath,
    safetyLevel: "medium",
    source: "imported",
    tags: parsed.tags,
    trigger: parsed.trigger,
  });

  return skill;
}

export function parseSkillMarkdown(markdown: string): { category?: string; description: string; name: string; tags: string[]; trigger?: string } {
  const frontMatter = parseFrontMatter(markdown);
  const name = normalizeSkillName(frontMatter.name || inferSkillNameFromMarkdown(markdown));
  const description = normalizeSkillDescription(frontMatter.description || inferSkillDescriptionFromMarkdown(markdown));
  const tags = normalizeSkillTags(parseTags(frontMatter.tags));
  const trigger = typeof frontMatter.trigger === "string" ? normalizeSkillTrigger(frontMatter.trigger, normalizeSkillId(name)) : undefined;

  if (!name || !description) {
    throw new Error("SKILL.md needs front matter with at least name and description.");
  }

  return {
    category: typeof frontMatter.category === "string" ? normalizeSkillCategory(frontMatter.category) : undefined,
    description,
    name,
    tags,
    trigger,
  };
}

export function getInstalledSkills() {
  return loadSkillRegistry().skills.filter((skill) => skill.installed);
}

export function getEnabledSkills() {
  return loadSkillRegistry().skills.filter((skill) => skill.installed && skill.enabled);
}

export function getInstalledSkillMentionOptions() {
  return getEnabledSkills().map((skill) => ({
    aliases: [`@${skill.id}`, skill.name],
    category: skill.category,
    description: skill.description,
    id: skill.id,
    mention: skill.trigger,
    plugin: skill.source === "premade" ? "Premade Skills" : skill.source === "imported" ? "Imported Skills" : "Custom Skills",
    pluginId: `skills:${skill.source}`,
    status: "installed" as const,
    tags: skill.tags,
    title: skill.name,
  }));
}

export function findSkillPromptMatches(prompt: string, skills = getEnabledSkills()): SkillPromptMatch[] {
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt || skills.length === 0) {
    return [];
  }

  const promptTerms = createTermSet(normalizedPrompt);
  const matches = skills.flatMap((skill): SkillPromptMatch[] => {
    if (hasExplicitSkillInvocation(normalizedPrompt, skill)) {
      return [{ reason: "explicit", score: 1, skill }];
    }

    const score = scoreSemanticSkillMatch(promptTerms, skill);
    return score >= SEMANTIC_MATCH_THRESHOLD ? [{ reason: "semantic", score, skill }] : [];
  });

  return matches
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, MAX_ACTIVE_SKILLS_IN_PROMPT);
}

export function formatSkillsPromptSection(latestUserPrompt: string) {
  if (/\b(?:system\s+prompt|prompt\s+(?:for|tokens?|budget|optimization)|tools?\s+(?:prompt|tokens?|budget)|token\s+(?:budget|usage|uses?))\b/i.test(latestUserPrompt)) {
    return "";
  }

  const enabledSkills = getEnabledSkills();

  if (enabledSkills.length === 0) {
    return "";
  }

  const activeMatches = findSkillPromptMatches(latestUserPrompt, enabledSkills);
  const shouldListSkills = /\b(?:apps?|connectors?|plugins?|skills?|tools?|capabilit(?:y|ies)|what\s+can\s+you\s+do|available)\b/i.test(latestUserPrompt);

  if (activeMatches.length === 0 && !shouldListSkills) {
    return "";
  }

  const availableSkills = enabledSkills.slice(0, MAX_AVAILABLE_SKILLS_IN_PROMPT);
  const omittedCount = enabledSkills.length - availableSkills.length;
  const lines = [
    "# Skills",
    "Installed Skills are reusable user-managed instruction bundles. Treat this section as user prompt context. Prefer a skill when the user invokes its trigger/name or the task clearly matches its description. Do not claim a skill ran unless these instructions or the user request support that claim.",
    "",
    "Available enabled skills:",
    ...availableSkills.map((skill) => `- ${skill.trigger} ${skill.name}: ${skill.description}${skill.path ? ` (path: ${skill.path})` : ""}`),
    omittedCount > 0 ? `- ${omittedCount} more enabled skill${omittedCount === 1 ? "" : "s"} omitted from this compact list.` : "",
  ].filter(Boolean);

  if (activeMatches.length === 0) {
    return lines.join("\n");
  }

  lines.push("", "Active skill instructions loaded for this turn:");

  for (const match of activeMatches) {
    lines.push(
      "",
      `## ${match.skill.name} (${match.skill.trigger})`,
      `Match: ${match.reason}. Source: ${match.skill.source}. Safety: ${match.skill.safetyLevel}.`,
      clampSkillInstructions(match.skill.instructions),
    );
  }

  return lines.join("\n");
}

function readStoredSkillRegistry(): Partial<SkillRegistryState> | null {
  try {
    const rawValue = loadPersistentString(SKILL_REGISTRY_KEY);
    return rawValue ? (JSON.parse(rawValue) as Partial<SkillRegistryState>) : null;
  } catch {
    return null;
  }
}

function loadSkillRegistryFromDetail(detail: unknown): SkillRegistryState {
  if (typeof detail === "object" && detail) {
    const maybeState = detail as Partial<SkillRegistryState>;

    if (Array.isArray(maybeState.skills)) {
      return {
        skills: maybeState.skills.map(normalizeStoredSkill).filter(Boolean) as AppSkill[],
        updatedAt: typeof maybeState.updatedAt === "string" ? maybeState.updatedAt : new Date().toISOString(),
        version: 1,
      };
    }
  }

  return loadSkillRegistry();
}

function dispatchSkillRegistryChanged(state: SkillRegistryState) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<SkillRegistryState>(SKILL_REGISTRY_CHANGED_EVENT, { detail: state }));
}

function mergePresetUpdates(skills: AppSkill[]) {
  const merged = [...skills];

  for (const preset of SKILL_PRESETS) {
    const existingIndex = merged.findIndex((skill) => skill.id === preset.id && skill.source === "premade");

    if (existingIndex < 0) {
      if (preset.defaultInstalled) {
        merged.push(createSkillFromPreset(preset, new Date().toISOString(), true));
      }
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...createSkillFromPreset(preset, existing.createdAt, existing.installed),
      enabled: existing.enabled,
      installed: existing.installed,
      updatedAt: existing.updatedAt,
    };
  }

  return merged;
}

function createSkillFromPreset(preset: SkillPreset, timestamp: string, installed: boolean): AppSkill {
  return {
    author: preset.author,
    category: preset.category,
    createdAt: timestamp,
    description: preset.description,
    enabled: installed,
    id: preset.id,
    installed,
    instructions: preset.instructions,
    name: preset.name,
    safetyLevel: preset.safetyLevel,
    source: "premade",
    tags: preset.tags,
    trigger: normalizeSkillTrigger(preset.trigger, preset.id),
    updatedAt: timestamp,
    version: 1,
  };
}

function normalizeStoredSkill(value: unknown): AppSkill | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const stored = value as Partial<AppSkill>;
  const name = normalizeSkillName(stored.name);
  const id = normalizeSkillId(stored.id || name);
  const description = normalizeSkillDescription(stored.description);
  const instructions = typeof stored.instructions === "string" ? stored.instructions.trim() : "";

  if (!id || !name || !description || !instructions) {
    return null;
  }

  return {
    author: normalizeOptionalText(stored.author, 80),
    category: normalizeSkillCategory(stored.category),
    createdAt: normalizeDate(stored.createdAt),
    description,
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
    id,
    installed: typeof stored.installed === "boolean" ? stored.installed : true,
    instructions,
    name,
    path: normalizeOptionalText(stored.path, 512),
    safetyLevel: normalizeSafetyLevel(stored.safetyLevel),
    source: normalizeSkillSource(stored.source),
    tags: normalizeSkillTags(stored.tags),
    trigger: normalizeSkillTrigger(stored.trigger, id),
    updatedAt: normalizeDate(stored.updatedAt),
    version: 1,
  };
}

async function readSkillManifestFromFolder(folderPath: string) {
  const candidates = [joinSkillPath(folderPath, "SKILL.md"), joinSkillPath(folderPath, "skill.md")];
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await readComputerTextFile(candidate, 120_000);
      return {
        content: result.content,
        path: candidate,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Could not find SKILL.md in ${folderPath}. ${errors[0] ?? ""}`.trim());
}

function parseFrontMatter(markdown: string) {
  const match = markdown.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*/);
  const values: Record<string, string> = {};

  if (!match) {
    return values;
  }

  for (const rawLine of match[1].split(/\r?\n/)) {
    const separator = rawLine.indexOf(":");

    if (separator < 1) {
      continue;
    }

    const key = rawLine.slice(0, separator).trim().toLowerCase();
    const rawValue = rawLine.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return values;
}

function inferSkillNameFromMarkdown(markdown: string) {
  return markdown.match(/^\s*#\s+(.+)$/m)?.[1] ?? "";
}

function inferSkillDescriptionFromMarkdown(markdown: string) {
  return markdown
    .replace(/^\s*---[\s\S]*?---\s*/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";
}

function parseTags(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",");
}

function scoreSemanticSkillMatch(promptTerms: Set<string>, skill: AppSkill) {
  if (promptTerms.size === 0) {
    return 0;
  }

  const skillTerms = createTermSet([skill.name, skill.description, skill.category, ...skill.tags].join(" "));
  let matches = 0;

  for (const term of skillTerms) {
    if (promptTerms.has(term)) {
      matches += 1;
    }
  }

  return matches / Math.max(skillTerms.size, 1);
}

function hasExplicitSkillInvocation(prompt: string, skill: AppSkill) {
  const escapedTrigger = escapeRegExp(skill.trigger);
  const escapedId = escapeRegExp(skill.id);
  const escapedName = escapeRegExp(skill.name);

  return (
    new RegExp(`(^|\\s)${escapedTrigger}(?=$|\\s|[.,;:!?)]|-)`, "i").test(prompt) ||
    new RegExp(`(^|\\s)@${escapedId}(?=$|\\s|[.,;:!?)]|-)`, "i").test(prompt) ||
    new RegExp(`\\buse\\s+(?:the\\s+)?${escapedName}\\s+skill\\b`, "i").test(prompt) ||
    new RegExp(`\\b${escapedName}\\s+skill\\b`, "i").test(prompt)
  );
}

function createTermSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[$@]/g, " ")
      .split(/[^a-z0-9.#+-]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  );
}

function clampSkillInstructions(value: string) {
  const trimmed = value.trim();

  if (trimmed.length <= MAX_SKILL_INSTRUCTION_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_SKILL_INSTRUCTION_CHARS - 80).trimEnd()}\n\n[Skill instructions truncated for prompt budget.]`;
}

function sortSkills(skills: AppSkill[]) {
  return [...skills].sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }

    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    const sourceOrder = getSourceOrder(left.source) - getSourceOrder(right.source);
    return sourceOrder || left.name.localeCompare(right.name);
  });
}

function getSourceOrder(source: SkillSource) {
  if (source === "custom") {
    return 0;
  }

  if (source === "imported") {
    return 1;
  }

  return 2;
}

function normalizeSkillId(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/^[$@]+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeSkillTrigger(value: unknown, fallbackId: string) {
  const normalized = normalizeSkillId(typeof value === "string" ? value : fallbackId);
  return `$${normalized || fallbackId || "skill"}`;
}

function normalizeSkillName(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

function normalizeSkillDescription(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 220) : "";
}

function normalizeSkillCategory(value: unknown) {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 40) : "General";
}

function normalizeSkillTags(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const tag = item.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().slice(0, 32);

    if (tag) {
      tags.add(tag);
    }
  }

  return [...tags].slice(0, 8);
}

function normalizeSafetyLevel(value: unknown): SkillSafetyLevel {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function normalizeSkillSource(value: unknown): SkillSource {
  return value === "premade" || value === "imported" || value === "custom" ? value : "custom";
}

function normalizeDate(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  return new Date().toISOString();
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function joinSkillPath(folderPath: string, fileName: string) {
  const separator = folderPath.includes("\\") ? "\\" : "/";
  return `${folderPath.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
