export type ViteProjectVariant = "react" | "react-ts";

export interface ViteProjectScaffoldOptions {
  author?: string;
  projectName: string;
  subtitle?: string;
  title?: string;
  variant?: string;
}

export interface ViteProjectScaffoldFile {
  content: string;
  relativePath: string;
}

export interface ViteProjectScaffold {
  appFile: string;
  entryFile: string;
  files: ViteProjectScaffoldFile[];
  packageName: string;
  variant: ViteProjectVariant;
}

const SAFE_REACT_VERSION = "^18.3.1";
const SAFE_REACT_PLUGIN_VERSION = "^4.3.3";
const SAFE_TYPESCRIPT_VERSION = "^5.6.3";
const SAFE_VITE_VERSION = "^5.4.10";

export function createViteProjectScaffold(options: ViteProjectScaffoldOptions): ViteProjectScaffold {
  const variant = normalizeViteProjectVariant(options.variant);
  const packageName = packageNameFromProject(options.projectName);
  const displayTitle = sanitizeDisplayText(options.title || humanizeProjectName(options.projectName) || "Hello World");
  const subtitle = sanitizeDisplayText(options.subtitle || "Built with Vite + React");
  const author = sanitizeDisplayText(options.author || "");
  const appFile = variant === "react-ts" ? "src/App.tsx" : "src/App.jsx";
  const entryFile = variant === "react-ts" ? "src/main.tsx" : "src/main.jsx";
  const viteConfigFile = variant === "react-ts" ? "vite.config.ts" : "vite.config.js";
  const files: ViteProjectScaffoldFile[] = [
    {
      relativePath: "package.json",
      content: createPackageJson(packageName, variant),
    },
    {
      relativePath: "index.html",
      content: createIndexHtml(displayTitle, entryFile),
    },
    {
      relativePath: viteConfigFile,
      content: lines([
        "import { defineConfig } from 'vite'",
        "import react from '@vitejs/plugin-react'",
        "",
        "export default defineConfig({",
        "  plugins: [react()],",
        "})",
      ]),
    },
    {
      relativePath: entryFile,
      content: createMainFile(variant),
    },
    {
      relativePath: appFile,
      content: createAppFile(displayTitle, subtitle, author),
    },
    {
      relativePath: "src/styles.css",
      content: createStylesFile(),
    },
    {
      relativePath: "README.md",
      content: createReadme(displayTitle),
    },
  ];

  if (variant === "react-ts") {
    files.push(
      {
        relativePath: "tsconfig.json",
        content: createTsConfig(),
      },
      {
        relativePath: "tsconfig.node.json",
        content: createTsConfigNode(viteConfigFile),
      },
      {
        relativePath: "src/vite-env.d.ts",
        content: "/// <reference types=\"vite/client\" />\n",
      },
    );
  }

  return {
    appFile,
    entryFile,
    files,
    packageName,
    variant,
  };
}

export function normalizeViteProjectVariant(value?: string): ViteProjectVariant {
  const normalized = (value || "").trim().toLowerCase();
  return normalized.includes("ts") || normalized.includes("typescript") ? "react-ts" : "react";
}

function createPackageJson(packageName: string, variant: ViteProjectVariant) {
  const packageJson = {
    name: packageName,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: variant === "react-ts" ? "tsc -b && vite build" : "vite build",
      preview: "vite preview",
    },
    dependencies: {
      react: SAFE_REACT_VERSION,
      "react-dom": SAFE_REACT_VERSION,
    },
    devDependencies: {
      "@vitejs/plugin-react": SAFE_REACT_PLUGIN_VERSION,
      vite: SAFE_VITE_VERSION,
      ...(variant === "react-ts"
        ? {
            "@types/react": "^18.3.12",
            "@types/react-dom": "^18.3.1",
            typescript: SAFE_TYPESCRIPT_VERSION,
          }
        : {}),
    },
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function createIndexHtml(title: string, entryFile: string) {
  return lines([
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `    <title>${escapeHtml(title)}</title>`,
    "  </head>",
    "  <body>",
    "    <div id=\"root\"></div>",
    `    <script type=\"module\" src=\"/${entryFile}\"></script>`,
    "  </body>",
    "</html>",
  ]);
}

function createMainFile(variant: ViteProjectVariant) {
  const appImport = "./App";

  return lines([
    "import React from 'react'",
    "import { createRoot } from 'react-dom/client'",
    `import App from '${appImport}'`,
    "import './styles.css'",
    "",
    "createRoot(document.getElementById('root')!).render(",
    "  <React.StrictMode>",
    "    <App />",
    "  </React.StrictMode>,",
    ")",
  ]).replace("document.getElementById('root')!", variant === "react-ts" ? "document.getElementById('root')!" : "document.getElementById('root')");
}

function createAppFile(title: string, subtitle: string, author: string) {
  const authorLine = author ? `      <p className=\"signature\">by ${escapeJsxText(author)}</p>` : "";

  return lines([
    "function App() {",
    "  return (",
    "    <main className=\"app-shell\">",
    "      <section className=\"hero-panel\" aria-label=\"Welcome\">",
    "        <span className=\"eyebrow\">Vite + React</span>",
    `        <h1>${escapeJsxText(title)}</h1>`,
    `        <p className=\"subtitle\">${escapeJsxText(subtitle)}</p>`,
    authorLine,
    "      </section>",
    "    </main>",
    "  )",
    "}",
    "",
    "export default App",
  ].filter((line) => line !== ""));
}

function createStylesFile() {
  return lines([
    ":root {",
    "  color: #f8fafc;",
    "  background: #0b1020;",
    "  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;",
    "  font-synthesis: none;",
    "  text-rendering: optimizeLegibility;",
    "  -webkit-font-smoothing: antialiased;",
    "  -moz-osx-font-smoothing: grayscale;",
    "}",
    "",
    "* {",
    "  box-sizing: border-box;",
    "}",
    "",
    "body {",
    "  margin: 0;",
    "  min-width: 320px;",
    "  min-height: 100vh;",
    "}",
    "",
    ".app-shell {",
    "  min-height: 100vh;",
    "  display: grid;",
    "  place-items: center;",
    "  padding: 32px;",
    "  background:",
    "    radial-gradient(circle at 20% 20%, rgba(56, 189, 248, 0.28), transparent 32%),",
    "    radial-gradient(circle at 82% 72%, rgba(244, 114, 182, 0.22), transparent 30%),",
    "    linear-gradient(135deg, #0b1020 0%, #111827 45%, #172033 100%);",
    "}",
    "",
    ".hero-panel {",
    "  width: min(720px, 100%);",
    "  padding: clamp(32px, 7vw, 72px);",
    "  border: 1px solid rgba(255, 255, 255, 0.14);",
    "  border-radius: 20px;",
    "  background: rgba(15, 23, 42, 0.72);",
    "  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);",
    "  text-align: center;",
    "  backdrop-filter: blur(18px);",
    "}",
    "",
    ".eyebrow {",
    "  display: inline-block;",
    "  margin-bottom: 18px;",
    "  color: #67e8f9;",
    "  font-size: 0.78rem;",
    "  font-weight: 700;",
    "  letter-spacing: 0.14em;",
    "  text-transform: uppercase;",
    "}",
    "",
    "h1 {",
    "  margin: 0;",
    "  font-size: clamp(3rem, 10vw, 6rem);",
    "  line-height: 0.95;",
    "  letter-spacing: 0;",
    "}",
    "",
    ".subtitle {",
    "  margin: 24px auto 0;",
    "  max-width: 520px;",
    "  color: #cbd5e1;",
    "  font-size: clamp(1rem, 2vw, 1.25rem);",
    "  line-height: 1.7;",
    "}",
    "",
    ".signature {",
    "  margin: 22px 0 0;",
    "  color: #f0abfc;",
    "  font-weight: 700;",
    "}",
  ]);
}

function createReadme(title: string) {
  return lines([
    `# ${title}`,
    "",
    "## Scripts",
    "",
    "- `npm install` installs dependencies.",
    "- `npm run dev` starts the local Vite dev server.",
    "- `npm run build` creates a production build.",
  ]);
}

function createTsConfig() {
  return lines([
    "{",
    "  \"compilerOptions\": {",
    "    \"target\": \"ES2020\",",
    "    \"useDefineForClassFields\": true,",
    "    \"lib\": [\"DOM\", \"DOM.Iterable\", \"ES2020\"],",
    "    \"allowJs\": false,",
    "    \"skipLibCheck\": true,",
    "    \"esModuleInterop\": true,",
    "    \"allowSyntheticDefaultImports\": true,",
    "    \"strict\": true,",
    "    \"forceConsistentCasingInFileNames\": true,",
    "    \"module\": \"ESNext\",",
    "    \"moduleResolution\": \"Bundler\",",
    "    \"resolveJsonModule\": true,",
    "    \"isolatedModules\": true,",
    "    \"noEmit\": true,",
    "    \"jsx\": \"react-jsx\"",
    "  },",
    "  \"include\": [\"src\"],",
    "  \"references\": [{ \"path\": \"./tsconfig.node.json\" }]",
    "}",
  ]);
}

function createTsConfigNode(viteConfigFile: string) {
  return lines([
    "{",
    "  \"compilerOptions\": {",
    "    \"composite\": true,",
    "    \"skipLibCheck\": true,",
    "    \"module\": \"ESNext\",",
    "    \"moduleResolution\": \"Bundler\",",
    "    \"allowSyntheticDefaultImports\": true",
    "  },",
    `  "include": ["${viteConfigFile}"]`,
    "}",
  ]);
}

function packageNameFromProject(projectName: string) {
  const normalized = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[._]+/, "");

  return normalized || "vite-react-app";
}

function humanizeProjectName(projectName: string) {
  return projectName
    .replace(/[\\/]+$/g, "")
    .split(/[\\/]+/)
    .pop()
    ?.replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) ?? "";
}

function sanitizeDisplayText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJsxText(value: string) {
  return value.replace(/[{}<>]/g, "");
}

function lines(values: string[]) {
  return `${values.join("\n")}\n`;
}
