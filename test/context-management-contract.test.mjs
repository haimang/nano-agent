import test from "node:test";
import assert from "node:assert/strict";

import {
  InspectorFacade,
  mountInspectorFacade,
} from "../packages/context-management/dist/index.js";
import { routeRequest } from "../packages/session-do-runtime/dist/routes.js";

function makeFacade(sessionUuid) {
  return new InspectorFacade({
    sessionUuid,
    providers: {
      async getUsageSnapshot() {
        return {
          totalTokens: 10_000,
          maxTokens: 100_000,
          responseReserveTokens: 4_000,
          categories: [{ name: "system", tokens: 10_000 }],
        };
      },
      async getCompactStateSnapshot() {
        return {
          state: "idle",
          stateId: "cs-1",
          enteredAt: "2026-04-20T00:00:00.000Z",
        };
      },
      async getBufferPolicy() {
        return { hardLimitTokens: 100_000, responseReserveTokens: 4_000 };
      },
      async getCompactPolicy() {
        return {
          softTriggerPct: 0.75,
          hardFallbackPct: 0.95,
          minHeadroomTokensForBackground: 5_000,
          backgroundTimeoutMs: 30_000,
          maxRetriesAfterFailure: 1,
          disabled: false,
        };
      },
      async getSnapshots() {
        return [];
      },
      async getLayers() {
        return [];
      },
    },
  });
}

test("context-management root export exposes mount helper and keeps inspect seam explicit", async () => {
  assert.equal(typeof mountInspectorFacade, "function");

  const request = new Request("https://x/inspect/sessions/sess-1/context/usage");
  assert.deepEqual(routeRequest(request), { type: "not-found" });

  const response = await mountInspectorFacade({
    env: { INSPECTOR_FACADE_ENABLED: "1" },
    request,
    facadeFactory: makeFacade,
  });

  assert.equal(response?.status, 200);
});
