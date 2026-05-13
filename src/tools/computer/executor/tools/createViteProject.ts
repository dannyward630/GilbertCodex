import type { ChatToolCall } from "../../../../types/chat";
import { buildComputerFileIndex, writeComputerTextFile } from "../../files";
import { createViteProjectScaffold } from "../../../projectScaffold/viteProject";
import { assertSyntaxBeforeWrite } from "../../syntaxValidation";
import { collectTextQualityWarnings, formatTextQualityWarnings } from "../../textQuality";
import {
  baseName,
  booleanArg,
  directoryName,
  firstArg,
  joinLocalPath,
  normalizeComparablePath,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
} from "../argHelpers";
import { createFileChangeSummary } from "../fileChanges";
import { recoverableToolFailure } from "../results";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { getWritePolicy } from "../workspacePolicy";
import { computerPathExists } from "./fileCreationCommon";

export async function executeCreateViteProjectHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return {
      content: [
        "Skipped because no local workspace roots are selected.",
        "Ask the user to pick a workspace folder, or use Full computer access with an explicit project_path such as C:\\Users\\Kobe Work\\Documents\\hello.",
      ].join("\n"),
      executed: false,
    };
  }

  return executeCreateViteProjectTool(call, context);
}

async function executeCreateViteProjectTool(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const { roots, settings } = context;
  const explicitProjectPath = firstArg(call.args, ["project_path", "projectPath", "path", "directory_path", "directoryPath", "folder_path", "folderPath", "cwd", "target"]);
  const requestedNameArg = firstArg(call.args, ["project_name", "projectName", "name", "app_name", "appName", "package_name", "packageName"]);

  if (!explicitProjectPath && settings.scope === "full-computer") {
    return {
      content: [
        "Skipped create_vite_project because Full computer scope needs an explicit project_path.",
        "Use a concrete destination such as C:\\Users\\Kobe Work\\Documents\\hello so Gilbert does not guess a drive root.",
      ].join("\n"),
      executed: false,
    };
  }

  const projectRoot = resolveCreateViteProjectRoot(explicitProjectPath, roots);
  const requestedName = requestedNameArg || baseName(projectRoot) || "vite-react-app";
  const title = firstArg(call.args, ["title", "heading", "headline"]) || baseName(projectRoot) || requestedName;
  const scaffold = createViteProjectScaffold({
    author: firstArg(call.args, ["author", "byline"]),
    projectName: requestedName || baseName(projectRoot),
    subtitle: firstArg(call.args, ["subtitle", "description", "tagline"]),
    title,
    variant: firstArg(call.args, ["variant", "template", "language", "stack"]),
  });
  const packageJsonPath = joinLocalPath(projectRoot, ["package.json"]);
  const hasPackageJson = await computerPathExists(packageJsonPath, roots);
  const repairMissingRequested = booleanArg(call.args, ["repair_missing", "repairMissing", "fill_missing", "fillMissing", "repair", "overwrite", "overwrite_existing", "overwriteExisting", "force"], false);

  if (hasPackageJson && !repairMissingRequested) {
    return {
      content: [
        `Skipped create_vite_project because ${packageJsonPath} already exists.`,
        "For an existing app, inspect and edit the current files with edit_file/inline_edit instead of re-scaffolding.",
        "To repair an interrupted scaffold without touching existing files, call create_vite_project with repair_missing=true.",
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "create_retry",
        "Inspect the existing app files and use edit_file/inline_edit for changes, or retry create_vite_project with repair_missing=true only to fill missing starter files.",
      ),
    };
  }

  const writes = scaffold.files.map((file) => ({
    ...file,
    path: joinLocalPath(projectRoot, file.relativePath.split("/")),
  }));

  for (const write of writes) {
    const policy = getWritePolicy(settings, roots, write.path);

    if (!policy.allowed) {
      return {
        content: `Vite project creation blocked for ${write.path}: ${policy.reason}`,
        executed: false,
      };
    }
  }

  const results: Array<{ bytesWritten: number; created: boolean; path: string }> = [];
  const fileChanges: NonNullable<ChatToolCall["fileChanges"]> = [];
  const qualityWarnings: string[] = [];
  const skippedExistingPaths: string[] = [];

  if (writes.length > 0) {
    context.onTerminalProgress?.({
      output: `Preparing Vite project writes: ${writes.length} files`,
    });
  }

  for (const write of writes) {
    const existedBeforeWrite = await computerPathExists(write.path, roots);

    if (hasPackageJson && existedBeforeWrite) {
      skippedExistingPaths.push(write.path);
      continue;
    }

    const originalContent = await readOriginalContentForSyntaxCheck(write.path);

    try {
      assertSyntaxBeforeWrite(write.path, write.content, { originalContent });
    } catch (error) {
      return {
        content: `Vite project creation blocked for ${write.path}: ${error instanceof Error ? error.message : String(error)}`,
        executed: false,
        is_error: true,
        errorCode: "pre_write_syntax_check",
        recovery: recoverableToolFailure(
          "syntax_retry",
          "Fix the scaffold content that failed syntax validation, then retry file creation for the affected file.",
        ),
      };
    }

    const result = await writeComputerTextFile(write.path, write.content, roots, {
      createParentDirs: true,
      overwrite: !hasPackageJson,
    });

    results.push({
      bytesWritten: result.bytesWritten,
      created: result.created,
      path: result.path,
    });
    const fileChange = createFileChangeSummary(result.path, originalContent, write.content, result.created ? "create" : "update");
    if (fileChange) {
      fileChanges.push(fileChange);
    }
    context.onTerminalProgress?.({
      fileChanges: [...fileChanges],
      output: `Writing Vite project files ${results.length}/${writes.length}: ${result.path}`,
    });
    qualityWarnings.push(...collectTextQualityWarnings(result.path, write.content).map((warning) => `${result.path}: ${warning}`));
  }

  const summary = await buildComputerFileIndex([projectRoot], settings.scope).catch(() => undefined);

  return {
    content: [
      "Vite React project scaffolded.",
      `Project path: ${projectRoot}`,
      `Variant: ${scaffold.variant === "react-ts" ? "React + TypeScript" : "React + JavaScript"}`,
      `Package name: ${scaffold.packageName}`,
      `Files written: ${results.length}`,
      `Created files: ${results.filter((result) => result.created).length}`,
      `Existing starter files preserved: ${skippedExistingPaths.length}`,
      "Overwrote existing starter files: no",
      hasPackageJson ? "Repair mode: filled missing starter files only; existing files were not rewritten." : "",
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      !explicitProjectPath ? "Destination rule: project_path was omitted, so the selected workspace folder was used directly." : "",
      "",
      "Required verification commands:",
      `cwd: ${projectRoot}`,
      "1. npm install",
      "2. npm run build",
      "3. npm run dev",
      "",
      "Starter files:",
      ...results.map((result) => `- ${result.path} (${result.bytesWritten} bytes)`),
      skippedExistingPaths.length > 0 ? "Preserved existing files:" : "",
      ...skippedExistingPaths.map((path) => `- ${path}`),
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: true,
    fileChanges,
    recovery: qualityWarnings.length > 0
      ? recoverableToolFailure(
          "create_retry",
          "Inspect or edit the scaffolded files and fix the quality warnings before finalizing.",
        )
      : undefined,
  };
}

function resolveCreateViteProjectRoot(explicitProjectPath: string | undefined, roots: string[]) {
  if (!explicitProjectPath) {
    return roots[0];
  }

  return collapseDuplicatedWorkspaceProjectFolder(resolveWorkspacePath(explicitProjectPath, roots), roots);
}

function collapseDuplicatedWorkspaceProjectFolder(projectRoot: string, roots: string[]) {
  const parent = directoryName(projectRoot);
  const projectFolderName = baseName(projectRoot);

  for (const root of roots.slice().sort((left, right) => right.length - left.length)) {
    if (
      normalizeComparablePath(parent) === normalizeComparablePath(root) &&
      comparableProjectFolderName(projectFolderName) === comparableProjectFolderName(baseName(root))
    ) {
      return root;
    }
  }

  return projectRoot;
}

function comparableProjectFolderName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
