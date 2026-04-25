import test from "node:test";
import assert from "node:assert/strict";

const DEFAULT_URLS = {
  "agent-core": "https://nano-agent-agent-core-preview.haimang.workers.dev",
  "orchestrator-core": "https://nano-agent-orchestrator-core-preview.haimang.workers.dev",
  "orchestrator-auth": "https://nano-agent-orchestrator-auth-preview.haimang.workers.dev",
  "bash-core": "https://nano-agent-bash-core-preview.haimang.workers.dev",
  "context-core": "https://nano-agent-context-core-preview.haimang.workers.dev",
  "filesystem-core": "https://nano-agent-filesystem-core-preview.haimang.workers.dev",
};

const ENV_KEYS = {
  "agent-core": "NANO_AGENT_AGENT_CORE_URL",
  "orchestrator-core": "NANO_AGENT_ORCHESTRATOR_CORE_URL",
  "orchestrator-auth": "NANO_AGENT_ORCHESTRATOR_AUTH_URL",
  "bash-core": "NANO_AGENT_BASH_CORE_URL",
  "context-core": "NANO_AGENT_CONTEXT_CORE_URL",
  "filesystem-core": "NANO_AGENT_FILESYSTEM_CORE_URL",
};

export function liveEnabled() {
  return process.env.NANO_AGENT_LIVE_E2E === "1";
}

export function workerUrl(worker) {
  return process.env[ENV_KEYS[worker]] ?? DEFAULT_URLS[worker] ?? null;
}

export function liveTest(name, workers, fn) {
  const enabled = liveEnabled();
  const missing = workers.filter((worker) => !workerUrl(worker));
  const skip =
    !enabled
      ? "set NANO_AGENT_LIVE_E2E=1 to enable live deploy E2E"
      : missing.length > 0
        ? `missing live URLs for: ${missing.join(", ")}`
        : false;

  test(name, { skip }, async () => {
    const urls = Object.fromEntries(
      workers.map((worker) => [worker, workerUrl(worker)]),
    );
    await fn({
      getUrl(worker) {
        const url = urls[worker];
        assert.ok(url, `missing URL for ${worker}`);
        return url;
      },
    });
  });
}

export async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, text, json };
}

export function randomSessionId() {
  return crypto.randomUUID();
}

export function expectProbe(body, expected) {
  assert.ok(body && typeof body === "object", "expected JSON object body");
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(body[key], value, `expected probe field ${key}`);
  }
}
