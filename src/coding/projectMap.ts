import type { ChatToolCall } from "../types/chat";
import type { ProjectMapLane, ProjectMapNode, ProjectMapRelation, ProjectMapSnapshot } from "../types/coding";
import type { ComputerSearchResult, LocalWorkspaceSettings } from "../types/localWorkspace";
import { inferFilePurpose, inferRiskTags } from "./riskReview";

export interface ProjectMapFileInput {
  content?: string;
  path: string;
  score?: number;
}

const LANES: ProjectMapLane[] = [
  { detail: "Routes, pages, panels, and reusable view components.", id: "ui", label: "UI", nodeIds: [] },
  { detail: "Chat, workspace, prompt, provider, and orchestration code.", id: "runtime", label: "Runtime", nodeIds: [] },
  { detail: "Model-callable bridge tools, schemas, adapters, and execution.", id: "tools", label: "Tool Bridge", nodeIds: [] },
  { detail: "Tauri commands, native storage, terminal, and desktop services.", id: "desktop", label: "Desktop/Tauri", nodeIds: [] },
  { detail: "Durable memory, app storage, context maps, and persistence.", id: "memory", label: "Memory/Storage", nodeIds: [] },
  { detail: "Tests and verification entry points.", id: "tests", label: "Tests", nodeIds: [] },
];

export function createProjectMapSnapshot(options: {
  changedPaths?: string[];
  files?: ProjectMapFileInput[];
  roots?: string[];
  toolCalls?: ChatToolCall[];
  workspace?: LocalWorkspaceSettings;
}): ProjectMapSnapshot {
  const changedPaths = new Set((options.changedPaths ?? extractChangedPaths(options.toolCalls ?? [])).map(normalizePath));
  const files = normalizeProjectMapFiles(options.files ?? [], changedPaths);
  const nodes = files.map((file) => createNodeForFile(file, changedPaths));
  const relations = createRelations(nodes, files);
  const lanes = LANES.map((lane) => ({
    ...lane,
    nodeIds: nodes.filter((node) => node.lane === lane.id).map((node) => node.id),
  })).filter((lane) => lane.nodeIds.length > 0 || lane.id !== "tests");

  return {
    generatedAt: new Date().toISOString(),
    lanes,
    nodes,
    relations,
    roots: options.roots ?? options.workspace?.roots ?? [],
    version: 1,
  };
}

export function searchResultsToProjectMapFiles(results: ComputerSearchResult[]): ProjectMapFileInput[] {
  return results.map((result) => ({
    path: result.path,
    score: result.score,
  }));
}

export function normalizeProjectMapSnapshot(value: unknown): ProjectMapSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ProjectMapSnapshot>;
  const nodes = Array.isArray(candidate.nodes)
    ? candidate.nodes.map(normalizeProjectMapNode).filter((node): node is ProjectMapNode => Boolean(node))
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawLanes = Array.isArray(candidate.lanes)
    ? candidate.lanes.map((lane) => normalizeProjectMapLane(lane, nodeIds)).filter((lane): lane is ProjectMapLane => Boolean(lane))
    : [];
  const lanes = rawLanes.map((lane) => ({
    ...lane,
    nodeIds: lane.nodeIds.length > 0 ? lane.nodeIds : nodes.filter((node) => node.lane === lane.id).map((node) => node.id),
  }));
  const relations = Array.isArray(candidate.relations)
    ? candidate.relations.map(normalizeProjectMapRelation).filter((relation): relation is ProjectMapRelation => Boolean(relation))
    : [];

  return {
    generatedAt: typeof candidate.generatedAt === "string" ? candidate.generatedAt : new Date().toISOString(),
    lanes: lanes.length > 0 ? lanes : LANES.map((lane) => ({
      ...lane,
      nodeIds: nodes.filter((node) => node.lane === lane.id).map((node) => node.id),
    })).filter((lane) => lane.nodeIds.length > 0 || lane.id !== "tests"),
    nodes,
    relations,
    roots: Array.isArray(candidate.roots) ? candidate.roots.filter((root): root is string => typeof root === "string") : [],
    version: 1,
  };
}

function normalizeProjectMapFiles(files: ProjectMapFileInput[], changedPaths: Set<string>) {
  const map = new Map<string, ProjectMapFileInput>();

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || shouldSkipPath(path)) continue;
    map.set(path, {
      ...map.get(path),
      ...file,
      path,
    });
  }

  for (const path of changedPaths) {
    if (!map.has(path) && !shouldSkipPath(path)) {
      map.set(path, { path });
    }
  }

  return [...map.values()]
    .sort((left, right) => scorePath(right, changedPaths) - scorePath(left, changedPaths) || left.path.localeCompare(right.path))
    .slice(0, 72);
}

function createNodeForFile(file: ProjectMapFileInput, changedPaths: Set<string>): ProjectMapNode {
  const lane = inferLane(file.path);
  const tags = inferNodeTags(file.path, file.content);
  const changed = changedPaths.has(file.path);

  return {
    changed,
    detail: inferNodeDetail(file.path, file.content),
    evidenceCount: changed ? 1 : undefined,
    id: nodeId(file.path),
    label: formatNodeLabel(file.path),
    lane,
    path: file.path,
    riskLevel: changed && inferRiskTags(file.path).length > 0 ? "medium" : changed ? "low" : undefined,
    tags,
    type: inferNodeType(file.path, file.content),
  };
}

function createRelations(nodes: ProjectMapNode[], files: ProjectMapFileInput[]): ProjectMapRelation[] {
  const byBasename = new Map<string, ProjectMapNode>();
  nodes.forEach((node) => byBasename.set(stripExtension(lastSegment(node.path ?? node.label)).toLowerCase(), node));
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const relations: ProjectMapRelation[] = [];

  for (const file of files) {
    const from = byPath.get(file.path);
    if (!from || !file.content) continue;

    for (const imported of extractImports(file.content)) {
      const target = resolveImportTarget(imported, from, byBasename);
      if (target && target.id !== from.id) {
        relations.push({ from: from.id, label: "imports", to: target.id });
      }
    }

    for (const command of extractTauriCommands(file.content)) {
      const commandId = `command:${command}`;
      if (!nodes.some((node) => node.id === commandId)) {
        nodes.push({
          detail: "Frontend invokes this Tauri command.",
          id: commandId,
          label: command,
          lane: "desktop",
          tags: ["tauri", "command"],
          type: "command",
        });
      }
      relations.push({ from: from.id, label: "invokes", to: commandId });
    }

    for (const toolId of extractToolIds(file.content)) {
      const toolNodeId = `tool:${toolId}`;
      if (!nodes.some((node) => node.id === toolNodeId)) {
        nodes.push({
          detail: "Tool bridge definition or alias.",
          id: toolNodeId,
          label: toolId,
          lane: "tools",
          tags: ["tool"],
          type: "tool",
        });
      }
      relations.push({ from: from.id, label: "defines", to: toolNodeId });
    }
  }

  return dedupeRelations(relations).slice(0, 140);
}

function inferLane(path: string) {
  if (/\.test\.[tj]sx?$|__tests__|tests?\//i.test(path)) return "tests";
  if (/src\/toolBridge\//i.test(path)) return "tools";
  if (/src-tauri\//i.test(path)) return "desktop";
  if (/src\/(memory|lib\/appStorage|lib\/deviceDatabase)|storage|database/i.test(path)) return "memory";
  if (/src\/(components|pages|styles)\//i.test(path)) return "ui";
  return "runtime";
}

function inferNodeType(path: string, content?: string): ProjectMapNode["type"] {
  if (/\.test\.[tj]sx?$|__tests__/i.test(path)) return "test";
  if (/src-tauri\/src\/commands/i.test(path)) return "command";
  if (/src\/components|src\/pages/i.test(path) || /export function [A-Z]/.test(content ?? "")) return "component";
  if (/type |interface /.test(content ?? "") || /src\/types\//.test(path)) return "type";
  if (/toolBridge/i.test(path)) return "tool";
  return "service";
}

function inferNodeTags(path: string, content?: string) {
  const tags = new Set(inferRiskTags(path));
  const normalized = path.toLowerCase();

  if (normalized.endsWith(".tsx")) tags.add("react");
  if (normalized.endsWith(".rs")) tags.add("rust");
  if (/invoke\s*</.test(content ?? "")) tags.add("tauri");
  if (/createDefaultToolRegistry|ToolDefinition|id:\s*["']/.test(content ?? "")) tags.add("tooling");
  if (/useState|useMemo|useEffect/.test(content ?? "")) tags.add("state");

  return [...tags].slice(0, 6);
}

function inferNodeDetail(path: string, content?: string) {
  const exports = extractExports(content ?? "");
  const purpose = inferFilePurpose(path);

  return exports.length > 0 ? `${purpose}. Exports ${exports.slice(0, 3).join(", ")}.` : purpose;
}

function extractImports(content: string) {
  const imports = new Set<string>();
  const pattern = /import(?:\s+type)?[\s\S]{0,180}?\sfrom\s+["']([^"']+)["']/g;

  for (const match of content.matchAll(pattern)) {
    imports.add(match[1]);
  }

  return [...imports];
}

function extractTauriCommands(content: string) {
  const commands = new Set<string>();
  const pattern = /\binvoke(?:<[^>]+>)?\(\s*["']([a-z0-9_:-]+)["']/gi;

  for (const match of content.matchAll(pattern)) {
    commands.add(match[1]);
  }

  return [...commands];
}

function extractToolIds(content: string) {
  const ids = new Set<string>();
  const pattern = /\bid:\s*["']([a-z0-9_.:-]+)["']/gi;

  for (const match of content.matchAll(pattern)) {
    if (match[1].includes("_") || match[1].includes(".")) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

function extractExports(content: string) {
  const exports = new Set<string>();
  const pattern = /export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g;

  for (const match of content.matchAll(pattern)) {
    exports.add(match[1]);
  }

  return [...exports];
}

function resolveImportTarget(imported: string, from: ProjectMapNode, byBasename: Map<string, ProjectMapNode>) {
  const segment = imported.split(/[\\/]/).filter(Boolean).pop();
  if (!segment || (!imported.startsWith(".") && !imported.startsWith("src"))) {
    return undefined;
  }

  return byBasename.get(stripExtension(segment).toLowerCase()) ?? (from.path && imported.includes(lastSegment(stripExtension(from.path))) ? from : undefined);
}

function extractChangedPaths(toolCalls: ChatToolCall[]) {
  const paths = new Set<string>();
  for (const toolCall of toolCalls) {
    for (const change of toolCall.fileChanges ?? []) paths.add(change.path);
    for (const result of toolCall.batchFileResults ?? []) paths.add(result.path);
  }
  return [...paths];
}

function shouldSkipPath(path: string) {
  return /node_modules|target|dist|build|\.git|\.png$|\.jpg$|\.jpeg$|\.gif$|\.ico$/i.test(path);
}

function scorePath(file: ProjectMapFileInput, changedPaths: Set<string>) {
  let score = file.score ?? 0;
  if (changedPaths.has(file.path)) score += 1000;
  if (/src\/(app|toolBridge|components|pages|services|memory)|src-tauri\/src\/commands/i.test(file.path)) score += 80;
  if (/\.test\.[tj]sx?$|__tests__/i.test(file.path)) score += 30;
  return score;
}

function nodeId(path: string) {
  return `file:${path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function formatNodeLabel(path: string) {
  return lastSegment(path);
}

function lastSegment(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function stripExtension(value: string) {
  return value.replace(/\.[A-Za-z0-9]+$/, "");
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function dedupeRelations(relations: ProjectMapRelation[]) {
  const seen = new Set<string>();
  return relations.filter((relation) => {
    const key = `${relation.from}:${relation.label}:${relation.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProjectMapNode(value: unknown): ProjectMapNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const node = value as Partial<ProjectMapNode>;
  const path = typeof node.path === "string" ? normalizePath(node.path) : undefined;
  const label = typeof node.label === "string" && node.label.trim() ? node.label : path ? formatNodeLabel(path) : "Project area";
  const lane = typeof node.lane === "string" && LANES.some((item) => item.id === node.lane) ? node.lane : path ? inferLane(path) : "runtime";
  const type = isProjectMapNodeType(node.type) ? node.type : path ? inferNodeType(path) : "service";

  return {
    changed: Boolean(node.changed),
    detail: typeof node.detail === "string" && node.detail.trim() ? node.detail : path ? inferNodeDetail(path) : "Project map node.",
    evidenceCount: typeof node.evidenceCount === "number" ? node.evidenceCount : undefined,
    id: typeof node.id === "string" && node.id.trim() ? node.id : path ? nodeId(path) : `node:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label,
    lane,
    path,
    riskLevel: node.riskLevel === "high" || node.riskLevel === "medium" || node.riskLevel === "low" ? node.riskLevel : undefined,
    tags: Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === "string") : path ? inferRiskTags(path) : [],
    type,
  };
}

function normalizeProjectMapLane(value: unknown, nodeIds: Set<string>): ProjectMapLane | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const lane = value as Partial<ProjectMapLane>;
  if (typeof lane.id !== "string" || !LANES.some((item) => item.id === lane.id)) {
    return null;
  }

  const fallback = LANES.find((item) => item.id === lane.id);
  return {
    detail: typeof lane.detail === "string" ? lane.detail : fallback?.detail ?? "",
    id: lane.id,
    label: typeof lane.label === "string" ? lane.label : fallback?.label ?? lane.id,
    nodeIds: Array.isArray(lane.nodeIds) ? lane.nodeIds.filter((id): id is string => typeof id === "string" && nodeIds.has(id)) : [],
  };
}

function normalizeProjectMapRelation(value: unknown): ProjectMapRelation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const relation = value as Partial<ProjectMapRelation>;
  if (typeof relation.from !== "string" || typeof relation.to !== "string") {
    return null;
  }

  return {
    from: relation.from,
    label: typeof relation.label === "string" ? relation.label : "relates",
    to: relation.to,
  };
}

function isProjectMapNodeType(value: unknown): value is ProjectMapNode["type"] {
  return value === "command" || value === "component" || value === "file" || value === "service" || value === "test" || value === "tool" || value === "type";
}
