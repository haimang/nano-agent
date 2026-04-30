/**
 * ZX2 Phase 3 P3-03 — bash-core WorkerEntrypoint RPC tests.
 *
 * Covers the canonical happy path plus authority / request_uuid / shape
 * rejections so the contract behaves like the orchestrator-core ↔
 * agent-core hop.
 */

import { describe, expect, it } from "vitest";
import BashCoreEntrypoint from "../src/index.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";

const TEAM_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STAMPED_AT = "2026-04-27T00:00:00.000+00:00";
const NACP_AUTHORITY = {
  team_uuid: TEAM_UUID,
  plan_level: "pro" as const,
  stamped_by_key: "nano-agent.orchestrator-core@v1",
  stamped_at: STAMPED_AT,
};

function makeEntrypoint(env: { ENVIRONMENT?: string } = {}) {
  return new BashCoreEntrypoint({
    ENVIRONMENT: env.ENVIRONMENT ?? "preview",
  } as never);
}

describe("bash-core rpc — call", () => {
  it("returns ok envelope on a valid pwd call", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      {
        requestId: "rpc-call-1",
        capabilityName: "pwd",
        body: { tool_name: "pwd", tool_input: {} },
      },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
        session_uuid: SESSION,
        request_uuid: REQ,
        source: "session.runtime",
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("ok");
      expect(typeof res.data.output).toBe("string");
    }
  });

  it("persists structured error logs when capability execution fails", async () => {
    const records: Array<{ code?: string; msg: string }> = [];
    const ep = new BashCoreEntrypoint({
      ENVIRONMENT: "production",
      ORCHESTRATOR_CORE: {
        async recordErrorLog(record) {
          records.push({ code: record.code, msg: record.msg });
          return { ok: true };
        },
      },
    } as never);
    const res = await ep.call(
      {
        requestId: "rpc-call-preview-only",
        capabilityName: "__px_sleep",
        body: { tool_name: "__px_sleep", tool_input: {} },
      },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
        session_uuid: SESSION,
        request_uuid: REQ,
        source: "session.runtime",
      },
    );
    expect(res.ok).toBe(true);
    await Promise.resolve();
    expect(records).toContainEqual({
      code: "preview-only-tool",
      msg: "capability-rpc-failed",
    });
  });

  it("rejects when meta.authority is missing", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      { requestId: "rpc-call-2", body: { tool_name: "pwd", tool_input: {} } },
      { trace_uuid: TRACE, caller: "agent-core", request_uuid: REQ },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-authority");
  });

  it("rejects when meta.request_uuid is missing", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      { requestId: "rpc-call-3", body: { tool_name: "pwd", tool_input: {} } },
      { trace_uuid: TRACE, caller: "agent-core", authority: NACP_AUTHORITY },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-meta");
  });

  it("rejects when meta is wholly invalid", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      { requestId: "rpc-call-4", body: { tool_name: "pwd", tool_input: {} } },
      { caller: "agent-core" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-meta");
  });

  it("rejects when input shape is invalid", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      { not: "a request" },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
        request_uuid: REQ,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-input");
  });
});

describe("bash-core rpc — cancel", () => {
  it("returns ok envelope (cancelled=false when no pending call)", async () => {
    const ep = makeEntrypoint();
    const res = await ep.cancel(
      { requestId: "rpc-cancel-1", body: { reason: "no-op" } },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
        session_uuid: SESSION,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ok).toBe(true);
      expect(typeof res.data.cancelled).toBe("boolean");
    }
  });

  it("does NOT require request_uuid (only call does)", async () => {
    const ep = makeEntrypoint();
    const res = await ep.cancel(
      { requestId: "rpc-cancel-2" },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
      },
    );
    expect(res.ok).toBe(true);
  });

  it("rejects when input shape is invalid", async () => {
    const ep = makeEntrypoint();
    const res = await ep.cancel(
      { wrong: "shape" },
      {
        trace_uuid: TRACE,
        caller: "agent-core",
        authority: NACP_AUTHORITY,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-input");
  });
});

// ZX1-ZX2 review (Kimi R5 / GLM): bash-core only admits internal callers
// (orchestrator-core | agent-core | runtime). Free strings — even those
// the schema-level RpcCallerSchema accepts, e.g. `web` or `cli` — must
// be rejected with `invalid-caller`.
describe("bash-core rpc — caller enum check", () => {
  it("rejects caller='web' even with valid authority + request_uuid", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      {
        requestId: "rpc-caller-web",
        capabilityName: "pwd",
        body: { tool_name: "pwd", tool_input: {} },
      },
      {
        trace_uuid: TRACE,
        caller: "web",
        authority: NACP_AUTHORITY,
        request_uuid: REQ,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-caller");
  });

  it("rejects caller='cli' on cancel path", async () => {
    const ep = makeEntrypoint();
    const res = await ep.cancel(
      { requestId: "rpc-caller-cli" },
      {
        trace_uuid: TRACE,
        caller: "cli",
        authority: NACP_AUTHORITY,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid-caller");
  });

  it("admits caller='orchestrator-core'", async () => {
    const ep = makeEntrypoint();
    const res = await ep.call(
      {
        requestId: "rpc-caller-oc",
        capabilityName: "pwd",
        body: { tool_name: "pwd", tool_input: {} },
      },
      {
        trace_uuid: TRACE,
        caller: "orchestrator-core",
        authority: NACP_AUTHORITY,
        request_uuid: REQ,
      },
    );
    expect(res.ok).toBe(true);
  });

  it("rejects caller='runtime' (ghost value removed from allowlist)", async () => {
    const ep = makeEntrypoint();
    const res = await ep.cancel(
      { requestId: "rpc-caller-runtime" },
      {
        trace_uuid: TRACE,
        caller: "runtime",
        authority: NACP_AUTHORITY,
      },
    );
    expect(res.ok).toBe(false);
  });
});

describe("bash-core rpc — fetch handler still works for legacy callers", () => {
  it("legacy fetch path remains 401 without binding-secret", async () => {
    const ep = makeEntrypoint();
    const res = await ep.fetch(
      new Request("https://example.com/capability/call", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("legacy fetch /health still returns 200", async () => {
    const ep = makeEntrypoint();
    const res = await ep.fetch(new Request("https://example.com/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { worker: string };
    expect(body.worker).toBe("bash-core");
  });
});
