import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      "/api": {
        target:
          process.env.VITE_NANO_BASE_URL ??
          "https://nano-agent-orchestrator-core-preview.haimang.workers.dev",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
