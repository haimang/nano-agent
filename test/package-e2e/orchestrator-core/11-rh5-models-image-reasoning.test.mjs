import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fetchJson, liveTest, randomSessionId } from "../../shared/live.mjs";
import { registerOrchestratorAccount } from "../../shared/orchestrator-auth.mjs";

const VISION_REASONING_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ONE_PIXEL_RED_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0,
  0, 3, 1, 1, 0, 24, 221, 141, 176, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

function queryD1(sql) {
  const output = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "NANO_AGENT_DB",
      "--config",
      "workers/orchestrator-core/wrangler.jsonc",
      "--env",
      "preview",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const jsonStart = output.indexOf("[");
  assert.ok(jsonStart >= 0, `wrangler did not return JSON output: ${output}`);
  const parsed = JSON.parse(output.slice(jsonStart));
  return Array.isArray(parsed?.[0]?.results) ? parsed[0].results : [];
}

async function waitForTimelineDelta(base, sessionUuid, authHeaders) {
  let observed = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const timeline = await fetchJson(`${base}/sessions/${sessionUuid}/timeline`, { headers: authHeaders });
    assert.equal(timeline.response.status, 200);
    observed = timeline.json?.events ?? [];
    const flat = JSON.stringify(observed);
    assert.equal(flat.includes("LLM_EXECUTION_FAILED"), false, flat);
    if (flat.includes("llm.delta") && flat.includes("turn.end")) return observed;
  }
  throw new Error(`timed out waiting for RH5 LLM delta; observed=${JSON.stringify(observed)}`);
}

liveTest("RH5 models, image_url, reasoning, and usage evidence work live", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const account = await registerOrchestratorAccount({
    realm: "package-e2e-rh5",
    deviceLabel: "rh5",
    deviceKind: "web",
  });

  const models = await fetchJson(`${base}/models`, { headers: account.authHeaders });
  assert.equal(models.response.status, 200);
  const modelRows = models.json?.models ?? models.json?.data?.models ?? [];
  assert.equal(modelRows.length >= 25, true);
  const visionReasoning = modelRows.find((model) => model.model_id === VISION_REASONING_MODEL);
  assert.equal(visionReasoning?.capabilities?.vision, true);
  assert.equal(visionReasoning?.capabilities?.reasoning, true);

  const sessionUuid = randomSessionId();
  const start = await fetchJson(`${base}/sessions/${sessionUuid}/start`, {
    method: "POST",
    headers: account.jsonHeaders,
    body: JSON.stringify({ initial_input: "RH5 image/reasoning smoke bootstrap." }),
  });
  assert.equal(start.response.status, 200, JSON.stringify(start.json));

  const form = new FormData();
  form.set("file", new File([ONE_PIXEL_RED_PNG], "red-dot.png", { type: "image/png" }));
  const upload = await fetch(`${base}/sessions/${sessionUuid}/files`, {
    method: "POST",
    headers: account.authHeaders,
    body: form,
  });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(uploadJson));
  const fileUuid = uploadJson?.data?.file_uuid;
  assert.match(fileUuid, UUID_RE);

  const message = await fetchJson(`${base}/sessions/${sessionUuid}/messages`, {
    method: "POST",
    headers: account.jsonHeaders,
    body: JSON.stringify({
      model_id: VISION_REASONING_MODEL,
      reasoning: { effort: "low" },
      parts: [
        { kind: "text", text: "Describe this tiny image in one short sentence." },
        { kind: "image_url", url: `/sessions/${sessionUuid}/files/${fileUuid}/content`, mime: "image/png" },
      ],
    }),
  });
  assert.equal(message.response.status, 200, JSON.stringify(message.json));

  await waitForTimelineDelta(base, sessionUuid, account.authHeaders);

  const [usage] = queryD1(
    `SELECT model_id, input_tokens, output_tokens, is_reasoning, is_vision, request_uuid
       FROM nano_usage_events
      WHERE session_uuid='${sessionUuid}'
        AND resource_kind='llm'
        AND verdict='allow'
      ORDER BY created_at DESC
      LIMIT 1;`,
  );
  assert.equal(usage?.model_id, VISION_REASONING_MODEL);
  assert.equal(Number(usage?.is_reasoning), 1);
  assert.equal(Number(usage?.is_vision), 1);
  assert.equal(Number(usage?.input_tokens) > 0, true);
  assert.equal(Number(usage?.output_tokens) > 0, true);
  assert.equal(typeof usage?.request_uuid, "string");
});
