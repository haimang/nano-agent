import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../shared/live.mjs";
import { registerOrchestratorAccount } from "../shared/orchestrator-auth.mjs";

async function createSession(base, auth) {
  const created = await fetchJson(`${base}/me/sessions`, {
    method: "POST",
    headers: auth.jsonHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(created.response.status, 201);
  return created.json?.data?.session_uuid;
}

liveTest("RH4 session files deny cross-tenant list/download", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const owner = await registerOrchestratorAccount({
    realm: "cross-e2e-files-owner",
    deviceLabel: "files-owner",
    deviceKind: "web",
  });
  const stranger = await registerOrchestratorAccount({
    realm: "cross-e2e-files-stranger",
    deviceLabel: "files-stranger",
    deviceKind: "web",
  });
  const sessionUuid = await createSession(base, owner);
  assert.equal(typeof sessionUuid, "string");

  const form = new FormData();
  form.set("file", new File([new TextEncoder().encode("blocked")], "blocked.txt", { type: "text/plain" }));
  const uploaded = await fetch(`${base}/sessions/${sessionUuid}/files`, {
    method: "POST",
    headers: owner.authHeaders,
    body: form,
  });
  const uploadJson = await uploaded.json();
  assert.equal(uploaded.status, 201);
  const fileUuid = uploadJson?.data?.file_uuid;
  assert.equal(typeof fileUuid, "string");

  const listDenied = await fetchJson(`${base}/sessions/${sessionUuid}/files`, {
    headers: stranger.authHeaders,
  });
  assert.equal(listDenied.response.status, 403);
  assert.equal(listDenied.json?.error?.code, "permission-denied");

  const contentDenied = await fetchJson(`${base}/sessions/${sessionUuid}/files/${fileUuid}/content`, {
    headers: stranger.authHeaders,
  });
  assert.equal(contentDenied.response.status, 403);
  assert.equal(contentDenied.json?.error?.code, "permission-denied");
});
