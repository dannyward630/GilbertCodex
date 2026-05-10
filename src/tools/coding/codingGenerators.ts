import type { GeneratedCodingFile } from "./codingToolTypes";

export function createSqlSchemaFile(args: Record<string, string>, roots: string[]): GeneratedCodingFile {
  const name = firstArg(args, ["name", "database", "title"]) ?? "app";
  const path = firstArg(args, ["path", "file_path", "file"]) ?? joinLocalPath(roots[0], ["database", "schema.sql"]);
  const content =
    firstArg(args, ["content", "sql", "schema"]) ??
    [
      `-- ${name} database schema`,
      "CREATE TABLE IF NOT EXISTS users (",
      "  id TEXT PRIMARY KEY,",
      "  email TEXT NOT NULL UNIQUE,",
      "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ");",
      "",
      "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
    ].join("\n");

  return createGeneratedFile(path, normalizeSql(content), "SQL schema");
}

export function createSqlMigrationFile(args: Record<string, string>, roots: string[]): GeneratedCodingFile {
  const name = slugify(firstArg(args, ["name", "title"]) ?? "new migration");
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const path = firstArg(args, ["path", "file_path", "file"]) ?? joinLocalPath(roots[0], ["database", "migrations", `${timestamp}_${name}.sql`]);
  const content = firstArg(args, ["content", "sql", "migration"]) ?? `-- Migration: ${name}\n\nBEGIN;\n\n-- Add schema changes here.\n\nCOMMIT;`;

  return createGeneratedFile(path, normalizeSql(content), "SQL migration");
}

export function createReactNativeScreenFile(args: Record<string, string>, roots: string[]): GeneratedCodingFile {
  const screenName = createPascalName(firstArg(args, ["name", "screen", "title"]) ?? "GeneratedScreen");
  const path = firstArg(args, ["path", "file_path", "file"]) ?? joinLocalPath(roots[0], ["src", "screens", `${screenName}.tsx`]);
  const content =
    firstArg(args, ["content", "tsx", "code"]) ??
    [
      "import { StyleSheet, Text, View } from \"react-native\";",
      "",
      `export function ${screenName}() {`,
      "  return (",
      "    <View style={styles.container}>",
      `      <Text style={styles.title}>${screenName}</Text>`,
      "    </View>",
      "  );",
      "}",
      "",
      "const styles = StyleSheet.create({",
      "  container: {",
      "    flex: 1,",
      "    alignItems: \"center\",",
      "    justifyContent: \"center\",",
      "    padding: 24,",
      "  },",
      "  title: {",
      "    fontSize: 24,",
      "    fontWeight: \"600\",",
      "  },",
      "});",
    ].join("\n");

  return createGeneratedFile(path, content, "React Native screen");
}

export function createUnitTestFile(args: Record<string, string>, roots: string[]): GeneratedCodingFile {
  const targetPath = firstArg(args, ["target_path", "target", "source_path", "source"]);
  const explicitPath = firstArg(args, ["path", "file_path", "file"]);
  const testPath = explicitPath ?? inferTestPath(targetPath, roots[0]);
  const subject = createPascalName(firstArg(args, ["name", "subject"]) ?? targetPath ?? "subject");
  const content =
    firstArg(args, ["content", "test", "code"]) ??
    [
      `describe("${subject}", () => {`,
      "  it(\"has behavior covered by a real assertion\", () => {",
      "    expect(true).toBe(true);",
      "  });",
      "});",
    ].join("\n");

  return createGeneratedFile(testPath, content, "unit test");
}

export function createApiRouteFile(args: Record<string, string>, roots: string[]): GeneratedCodingFile {
  const routeName = slugify(firstArg(args, ["name", "route", "title"]) ?? "health");
  const framework = (firstArg(args, ["framework"]) ?? "next").toLowerCase();
  const path =
    firstArg(args, ["path", "file_path", "file"]) ??
    (framework.includes("express")
      ? joinLocalPath(roots[0], ["src", "routes", `${routeName}.ts`])
      : joinLocalPath(roots[0], ["src", "app", "api", routeName, "route.ts"]));
  const content =
    firstArg(args, ["content", "code"]) ??
    (framework.includes("express")
      ? [
          "import { Router } from \"express\";",
          "",
          "export const router = Router();",
          "",
          "router.get(\"/\", (_request, response) => {",
          `  response.json({ status: "ok", route: "${routeName}" });`,
          "});",
        ].join("\n")
      : [
          "import { NextResponse } from \"next/server\";",
          "",
          "export async function GET() {",
          `  return NextResponse.json({ status: "ok", route: "${routeName}" });`,
          "}",
        ].join("\n"));

  return createGeneratedFile(path, content, "API route");
}

export function formatReactNativeSetupReport(packageJson: string | undefined) {
  const content = packageJson ?? "";
  const hasReactNative = /"react-native"\s*:/.test(content);
  const hasExpo = /"expo"\s*:/.test(content);
  const hasAndroid = /"android"\s*:/.test(content);
  const hasIos = /"ios"\s*:/.test(content);

  return [
    `React Native dependency: ${hasReactNative ? "found" : "missing"}`,
    `Expo dependency: ${hasExpo ? "found" : "not detected"}`,
    `Android script: ${hasAndroid ? "found" : "missing"}`,
    `iOS script: ${hasIos ? "found" : "missing"}`,
    hasReactNative || hasExpo ? "Status: React Native project signals found." : "Status: no React Native package signals found in package.json.",
  ].join("\n");
}

export function formatDependencyAuditReport(packageJson: string | undefined) {
  if (!packageJson) {
    return "No package.json was readable at the workspace root.";
  }

  try {
    const parsed = JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
    const dependencies = Object.keys(parsed.dependencies ?? {});
    const devDependencies = Object.keys(parsed.devDependencies ?? {});
    const scripts = Object.keys(parsed.scripts ?? {});

    return [
      `Dependencies: ${dependencies.length}`,
      `Dev dependencies: ${devDependencies.length}`,
      `Scripts: ${scripts.join(", ") || "none"}`,
      dependencies.includes("typescript") || devDependencies.includes("typescript") ? "TypeScript: present" : "TypeScript: not listed",
      dependencies.includes("react-native") ? "React Native: present" : "React Native: not listed",
      "Run npm audit or the package-manager equivalent from Terminal when a network-enabled vulnerability report is needed.",
    ].join("\n");
  } catch {
    return "package.json exists but could not be parsed as JSON.";
  }
}

function createGeneratedFile(path: string, content: string, description: string): GeneratedCodingFile {
  return {
    content: `${content.replace(/\s+$/g, "")}\n`,
    createParentDirs: true,
    description,
    overwrite: false,
    path,
  };
}

function inferTestPath(targetPath: string | undefined, root: string) {
  if (!targetPath) {
    return joinLocalPath(root, ["src", "__tests__", "generated.test.ts"]);
  }

  const extensionMatch = targetPath.match(/(\.[^.\\/]+)$/);
  const extension = extensionMatch?.[1] ?? ".test.ts";
  return targetPath.replace(/(\.[^.\\/]+)?$/, `.test${extension}`);
}

function normalizeSql(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalized = normalizeArgName(name);
    const value = args[normalized];

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function createPascalName(value: string) {
  const baseName = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? value;
  const words = baseName.match(/[a-zA-Z0-9]+/g) ?? ["Generated"];
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return /^[A-Z]/.test(name) ? name : `Generated${name}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "generated";
}

function joinLocalPath(root: string, parts: string[]) {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""))].join(separator);
}
