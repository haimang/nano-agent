import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fetchJson, liveTest } from "../../shared/live.mjs";
import { registerOrchestratorAccount } from "../../shared/orchestrator-auth.mjs";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

liveTest("orchestrator-core accepts nak_ bearer on auth/me and me/team", ["orchestrator-core"], async ({ getUrl }) => {
  const base = getUrl("orchestrator-core");
  const account = await registerOrchestratorAccount({
    realm: "package-e2e-api-key",
    deviceUuid: crypto.randomUUID(),
    deviceLabel: "api-key-bootstrap",
    deviceKind: "web",
  });
  const apiKey = `nak_${crypto.randomUUID()}`;
  const salt = crypto.randomBytes(12).toString("base64url");
  const createdAt = new Date().toISOString();
  const keyHash = sha256Hex(`${salt}:${apiKey}`);

  execFileSync(
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
      "--command",
      `INSERT INTO nano_team_api_keys (
         api_key_uuid, team_uuid, key_hash, key_salt, label,
         key_status, scopes_json, created_at, last_used_at, revoked_at
       ) VALUES (
         '${apiKey}', '${account.teamUuid}', '${keyHash}', '${salt}', 'package-e2e-api-key',
         'active', NULL, '${createdAt}', NULL, NULL
       );`,
    ],
    { cwd: "/workspace/repo/nano-agent", stdio: "pipe" },
  );

  const me = await fetchJson(`${base}/auth/me`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-trace-uuid": crypto.randomUUID(),
    },
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.json?.ok, true);
  assert.equal(me.json?.data?.snapshot?.device_uuid, "");
  assert.equal(me.json?.data?.team?.team_uuid, account.teamUuid);

  const team = await fetchJson(`${base}/me/team`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "x-trace-uuid": crypto.randomUUID(),
    },
  });
  assert.equal(team.response.status, 200);
  assert.equal(team.json?.ok, true);
  assert.equal(team.json?.data?.team_uuid, account.teamUuid);

  const wrongKey = await fetchJson(`${base}/auth/me`, {
    headers: {
      authorization: `Bearer ${apiKey}.tampered`,
      "x-trace-uuid": crypto.randomUUID(),
    },
  });
  assert.equal(wrongKey.response.status, 401);
  assert.equal(wrongKey.json?.error?.code, "invalid-auth");
});
