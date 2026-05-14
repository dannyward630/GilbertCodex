import codingWorkflow from "./instructions/coding/SKILL.md?raw";
import coreInstructions from "./instructions/core.md?raw";
import frontendQuality from "./instructions/frontend/SKILL.md?raw";
import nodeProjectSkill from "./instructions/languages/node/SKILL.md?raw";
import pythonProjectSkill from "./instructions/languages/python/SKILL.md?raw";
import planningMode from "./instructions/planning/SKILL.md?raw";
import researchFacts from "./instructions/research/SKILL.md?raw";
import codeReview from "./instructions/review/SKILL.md?raw";

export type PromptChunkKind = "core" | "mode" | "skill" | "tool";

export interface PromptChunk {
  alwaysInclude?: boolean;
  content: string;
  id: string;
  keywords: string[];
  kind: PromptChunkKind;
  maxTokens?: number;
  priority: number;
  title: string;
}

export const PROMPT_CATALOG: PromptChunk[] = [
  {
    alwaysInclude: true,
    content: coreInstructions,
    id: "core.gilbert-codex",
    keywords: ["agent", "core", "senior engineer", "local coding assistant", "safe edits", "verification"],
    kind: "core",
    maxTokens: 420,
    priority: 100,
    title: "Gilbert Codex Core",
  },
  {
    content: codingWorkflow,
    id: "skill.coding-agent-workflow",
    keywords: [
      "code",
      "coding",
      "edit",
      "implementation",
      "debug",
      "fix",
      "refactor",
      "tests",
      "build",
      "repo",
      "repository",
      "senior dev",
      "production",
    ],
    kind: "skill",
    maxTokens: 360,
    priority: 80,
    title: "Coding Agent Workflow",
  },
  {
    content: frontendQuality,
    id: "skill.frontend-product-quality",
    keywords: ["ui", "ux", "frontend", "screen", "component", "css", "layout", "responsive", "visual", "browser", "preview", "polish"],
    kind: "skill",
    maxTokens: 320,
    priority: 65,
    title: "Frontend Product Quality",
  },
  {
    content: planningMode,
    id: "mode.planning",
    keywords: ["plan", "planning", "brainstorm", "architecture", "design", "compare", "tradeoff", "do not code", "before coding"],
    kind: "mode",
    maxTokens: 320,
    priority: 70,
    title: "Planning Mode",
  },
  {
    content: researchFacts,
    id: "skill.research-current-facts",
    keywords: ["research", "deep research", "web", "official docs", "latest", "current", "changelog", "api", "provider", "standards", "citations"],
    kind: "skill",
    maxTokens: 340,
    priority: 72,
    title: "Research And Current Facts",
  },
  {
    content: codeReview,
    id: "skill.code-review",
    keywords: ["review", "audit", "production-ready", "risk", "bug hunt", "security", "regression", "findings", "pr"],
    kind: "skill",
    maxTokens: 260,
    priority: 60,
    title: "Code Review",
  },
  {
    content: nodeProjectSkill,
    id: "skill.language-node",
    keywords: [
      "node",
      "nodejs",
      "node.js",
      "npm",
      "pnpm",
      "yarn",
      "bun",
      "package.json",
      "javascript",
      "typescript",
      "react",
      "next",
      "nextjs",
      "vite",
      "express",
      "tauri",
      "expo",
      "react native",
      "monorepo",
      "workspaces",
    ],
    kind: "skill",
    maxTokens: 340,
    priority: 78,
    title: "Node Project Recipe",
  },
  {
    content: pythonProjectSkill,
    id: "skill.language-python",
    keywords: [
      "python",
      "py",
      "pip",
      "pipenv",
      "poetry",
      "uv",
      "venv",
      "virtualenv",
      "pyproject",
      "requirements.txt",
      "django",
      "flask",
      "fastapi",
      "pytest",
      "mypy",
      "ruff",
      "conda",
      "anaconda",
    ],
    kind: "skill",
    maxTokens: 340,
    priority: 78,
    title: "Python Project Recipe",
  },
];

export function createPromptChunkSearchText(chunk: PromptChunk) {
  return [chunk.title, chunk.kind, chunk.keywords.join(" "), chunk.content].join("\n");
}
