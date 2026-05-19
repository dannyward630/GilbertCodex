import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("mapbox-gl")) {
            return "mapbox";
          }

          if (id.includes("@xterm")) {
            return "terminal";
          }

          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("micromark") || id.includes("mdast") || id.includes("hast") || id.includes("unist")) {
            return "markdown";
          }

          if (id.includes("lucide-react")) {
            return "icons";
          }

          if (id.includes("react") || id.includes("react-dom")) {
            return "react";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    host: "localhost",
    strictPort: true,
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
