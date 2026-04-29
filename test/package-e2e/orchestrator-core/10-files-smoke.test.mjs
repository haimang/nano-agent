import assert from "node:assert/strict";
import { fetchJson, liveTest } from "../../shared/live.mjs";
import { registerOrchestratorAccount } from "../../shared/orchestrator-auth.mjs";

async function createSession(base, auth) {
  const created = await fetchJson(`${base}/me/sessions`, {
    method: "POST",
    headers: auth.jsonHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.json?.ok, true);
  return created.json?.data?.session_uuid;
}

liveTest("RH4 upload/list/download works through orchestrator-core facade", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const account = await registerOrchestratorAccount({
    realm: "package-e2e-files",
    deviceLabel: "files-smoke",
    deviceKind: "web",
  });
  const sessionUuid = await createSession(base, account);
  assert.equal(typeof sessionUuid, "string");

  const form = new FormData();
  form.set("file", new File([new TextEncoder().encode("hello-rh4")], "hello.txt", { type: "text/plain" }));
  const upload = await fetch(`${base}/sessions/${sessionUuid}/files`, {
    method: "POST",
    headers: account.authHeaders,
    body: form,
  });
  const uploadJson = await upload.json();
  assert.equal(upload.status, 201);
  assert.equal(uploadJson?.ok, true);
  assert.equal(uploadJson?.data?.mime, "text/plain");
  const fileUuid = uploadJson?.data?.file_uuid;
  assert.equal(typeof fileUuid, "string");

  const list = await fetchJson(`${base}/sessions/${sessionUuid}/files`, {
    headers: account.authHeaders,
  });
  assert.equal(list.response.status, 200);
  assert.equal(list.json?.ok, true);
  assert.ok(Array.isArray(list.json?.data?.files));
  assert.equal(list.json.data.files.some((file) => file.file_uuid === fileUuid), true);

  const content = await fetch(`${base}/sessions/${sessionUuid}/files/${fileUuid}/content`, {
    headers: account.authHeaders,
  });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "text/plain");
  assert.equal(await content.text(), "hello-rh4");
});
