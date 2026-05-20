import { describe, expect, it } from "vitest";
import {
  detectProjectRunActions,
  mergeDetectedProjectRunActions,
  normalizeProjectRunConfig,
} from "./projectRunConfig";

const ROOT = "/workspace/app";

describe("project run command detection", () => {
  it("detects pnpm Tauri app commands and preserves lockfile package manager", () => {
    const actions = detectProjectRunActions({
      files: ["package.json", "pnpm-lock.yaml", "src-tauri"],
      packageJson: JSON.stringify({
        scripts: {
          "app:dev": "tauri dev",
          build: "vite build",
          test: "vitest",
        },
      }),
      root: ROOT,
    });

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: "pnpm install",
        kind: "setup",
      }),
      expect.objectContaining({
        command: "pnpm run app:dev",
        kind: "dev-server",
        previewUrl: "http://localhost:1420/",
      }),
      expect.objectContaining({
        command: "pnpm run build",
        kind: "build",
      }),
      expect.objectContaining({
        command: "pnpm run test",
        kind: "test",
      }),
    ]));
  });

  it("detects npm, yarn, bun, Rust, Python, CMake, and unknown projects conservatively", () => {
    expect(detectProjectRunActions({
      files: ["package.json", "package-lock.json"],
      packageJson: JSON.stringify({ scripts: { dev: "vite --port 3000" } }),
      root: ROOT,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "npm run dev", previewUrl: "http://localhost:3000/" }),
    ]));

    expect(detectProjectRunActions({
      files: ["package.json", "yarn.lock"],
      packageJson: JSON.stringify({ scripts: { start: "next dev" } }),
      root: ROOT,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "yarn run start" }),
    ]));

    expect(detectProjectRunActions({
      files: ["package.json", "bun.lockb"],
      packageJson: JSON.stringify({ scripts: { serve: "vite" } }),
      root: ROOT,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "bun run serve" }),
    ]));

    expect(detectProjectRunActions({ files: ["Cargo.toml"], root: ROOT })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "cargo run" }),
      expect.objectContaining({ command: "cargo build" }),
      expect.objectContaining({ command: "cargo test" }),
    ]));

    expect(detectProjectRunActions({ files: ["manage.py", "requirements.txt"], root: ROOT })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "python manage.py runserver", previewUrl: "http://localhost:8000/" }),
    ]));

    expect(detectProjectRunActions({ files: ["CMakeLists.txt"], root: ROOT })).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "cmake -S . -B build; cmake --build build" }),
    ]));

    expect(detectProjectRunActions({ files: ["README.md"], root: ROOT })).toEqual([]);
  });
});

describe("project run config storage behavior", () => {
  it("normalizes saved configs and drops unusable actions", () => {
    const config = normalizeProjectRunConfig({
      actions: [
        {
          background: true,
          command: "npm run dev",
          id: "run-dev",
          kind: "dev-server",
          label: "Run",
          previewUrl: "http://127.0.0.1:5173/",
          source: "user",
          updatedAt: "2026-05-19T12:00:00.000Z",
        },
        {
          command: "broken",
        },
      ],
      selectedActionId: "missing",
      version: 0,
    });

    expect(config).toMatchObject({
      actions: [
        expect.objectContaining({
          id: "run-dev",
          previewUrl: "http://localhost:5173/",
        }),
      ],
      selectedActionId: "run-dev",
      version: 1,
    });
  });

  it("does not overwrite user-edited actions when detection refreshes", () => {
    const existing = normalizeProjectRunConfig({
      actions: [
        {
          background: true,
          command: "npm run dev -- --host localhost",
          id: "detected:dev-server",
          kind: "dev-server",
          label: "Run dev server",
          source: "user",
          updatedAt: "2026-05-19T12:00:00.000Z",
        },
      ],
      selectedActionId: "detected:dev-server",
      version: 1,
    });
    const detected = detectProjectRunActions({
      files: ["package.json"],
      packageJson: JSON.stringify({ scripts: { dev: "vite --port 5173" } }),
      root: ROOT,
    });
    const merged = mergeDetectedProjectRunActions(existing, detected);

    expect(merged?.actions.find((action) => action.id === "detected:dev-server")?.command).toBe("npm run dev -- --host localhost");
  });
});
