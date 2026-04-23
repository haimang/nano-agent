import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";

liveTest("context/filesystem workers remain probe-only library workers", ["context-core", "filesystem-core"], async ({ getUrl }) => {
  const context = await fetchJson(`${getUrl("context-core")}/runtime`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ smoke: true }),
  });
  assert.equal(context.response.status, 404);

  const filesystem = await fetchJson(`${getUrl("filesystem-core")}/runtime`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ smoke: true }),
  });
  assert.equal(filesystem.response.status, 404);
});
