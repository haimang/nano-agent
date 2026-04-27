import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // ZX2 Phase 3 P3-03 — bash-core became a WorkerEntrypoint; shim
      // the Cloudflare runtime symbol for unit tests like agent-core does.
      "cloudflare:workers": fileURLToPath(
        new URL("./test/support/cloudflare-workers-shim.ts", import.meta.url),
      ),
    },
  },
});
