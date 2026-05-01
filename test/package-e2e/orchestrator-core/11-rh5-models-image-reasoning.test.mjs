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

async function waitForTurnRow(sessionUuid, turnUuid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const [turn] = queryD1(
      `SELECT requested_model_id, effective_model_id, effective_reasoning_effort
         FROM nano_conversation_turns
        WHERE session_uuid='${sessionUuid}'
          AND turn_uuid='${turnUuid}'
        LIMIT 1;`,
    );
    if (turn) return turn;
  }
  throw new Error(`timed out waiting for durable turn row ${turnUuid}`);
}

liveTest("RH5 models, image_url, and reasoning metadata work live", ["orchestrator-core"], async ({ getUrl }) => {
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
  const turnUuid = message.json?.turn_uuid;
  assert.match(turnUuid, UUID_RE);

  const turn = await waitForTurnRow(sessionUuid, turnUuid);
  assert.equal(turn?.requested_model_id, VISION_REASONING_MODEL);
  assert.equal(turn?.effective_model_id, VISION_REASONING_MODEL);
  assert.equal(turn?.effective_reasoning_effort, "low");

  const [persistedMessage] = queryD1(
    `SELECT body_json
       FROM nano_conversation_messages
      WHERE session_uuid='${sessionUuid}'
        AND turn_uuid='${turnUuid}'
        AND message_kind='user.input.multipart'
      ORDER BY created_at DESC
      LIMIT 1;`,
  );
  const persistedParts = JSON.parse(String(persistedMessage?.body_json ?? "{}")).parts ?? [];
  assert.equal(Array.isArray(persistedParts), true);
  assert.equal(
    persistedParts.some((part) => part?.kind === "image_url" && String(part?.url ?? "").includes(`/sessions/${sessionUuid}/files/${fileUuid}/content`)),
    true,
  );
});
