import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";

liveTest("context-core rejects non-probe routes", ["context-core"], async ({ getUrl }) => {
  const { response, text } = await fetchJson(`${getUrl("context-core")}/runtime`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ smoke: true }),
  });
  assert.equal(response.status, 404);
  assert.equal(text, "Not Found");
});
