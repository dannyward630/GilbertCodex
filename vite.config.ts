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

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    strictPort: true,
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
