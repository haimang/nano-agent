/**
 * 2nd-round R1 — live runtime CrossSeamAnchor propagation regression.
 *
 * The first-wave A4-A5 fix wired anchor stamping at the adapter
 * (`callBindingJson` / `makeProviderFetcher` / hook handle .emit), but
 * the live `NanoSessionDO` orchestrator never gave those adapters a
 * real anchor to stamp — the live `emitHook` payload only carried
 * `{ sessionId, turnId, content, timestamp }`, so the receiving Worker
 * saw no `x-nacp-trace-uuid` headers in production.
 *
 * This integration test drives a real `NanoSessionDO` start-turn flow
 * with `HOOK_WORKER` and `FAKE_PROVIDER_WORKER` bindings injected, then
 * inspects the captured outbound `Request` objects to make sure the
 * cross-seam anchor headers are actually present. Without the
 * 2nd-round fix the `x-nacp-trace-uuid` assertion fails.
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../../src/host/do/nano-session-do.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "team-2nd-round";

const MESSAGE_UUID_SEED = "33333333-3333-4";
let msgCounter = 0;
function nextMessageUuid(): string {
  msgCounter = (msgCounter + 1) % 999;
  const tail = String(msgCounter).padStart(3, "0");
  return `${MESSAGE_UUID_SEED}${tail}-8333-333333333333`;
}

function makeFrame(messageType: string, body?: Record<string, unknown>): string {
  return JSON.stringify({
    header: {
      schema_version: "1.1.0",
      message_uuid: nextMessageUuid(),
      message_type: messageType,
      delivery_kind: "command",
      sent_at: new Date().toISOString(),
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: {
      trace_uuid: "44444444-4444-4444-8444-444444444444",
      session_uuid: SESSION_UUID,
    },
    body,
  });
}

describe("live runtime cross-seam anchor (2nd-round R1)", () => {
  it("emits x-nacp-* headers on the live remote hook seam when a turn starts", async () => {
    const captured: Request[] = [];
    const hookBinding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response(
          JSON.stringify({ kind: "continue", reason: "ok" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    };

    const doInstance = new NanoSessionDO(
      {},
      {
        TEAM_UUID,
        SESSION_UUID,
        HOOK_WORKER: hookBinding,
      },
    );

    // Sanity: env wired the remote factory and the hooks handle has
    // a live emit method. Without these assertions a typo in env
    // would make the rest of the test a silent no-op.
    const subs = doInstance.getSubsystems();
    expect(subs.profile.hooks).toBe("remote");
    expect(typeof (subs.hooks as { emit?: unknown }).emit).toBe("function");

    // Drive a session.start through `webSocketMessage` — this is the
    // live ingress path that fires `SessionStart + UserPromptSubmit`
    // hooks, which now must reach the bound hookWorker with the
    // anchor headers stamped.
    await doInstance.webSocketMessage(
      null,
      makeFrame("session.start", { initial_input: "hello" }),
    );

    // Two hook fires are expected: SessionStart (because turnCount=0)
    // followed by UserPromptSubmit. Both must carry anchor headers.
    expect(captured.length).toBeGreaterThanOrEqual(1);
    for (const req of captured) {
      const h = req.headers;
      expect(h.get("x-nacp-trace-uuid")).toBeTruthy();
      expect(h.get("x-nacp-session-uuid")).toBe(SESSION_UUID);
      expect(h.get("x-nacp-team-uuid")).toBe(TEAM_UUID);
      expect(h.get("x-nacp-request-uuid")).toBeTruthy();
      expect(h.get("x-nacp-source-role")).toBe("session");
      expect(h.get("x-nacp-source-key")).toBe("nano-agent.session.do@v1");
    }
  });

  it("provider fetcher carries anchor headers on every fetch call", async () => {
    const captured: Request[] = [];
    const providerBinding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response(
          JSON.stringify({ choices: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    };

    const doInstance = new NanoSessionDO(
      {},
      {
        TEAM_UUID,
        SESSION_UUID,
        FAKE_PROVIDER_WORKER: providerBinding,
      },
    );
    const subsystems = doInstance.getSubsystems();
    const llm = subsystems.llm as { fetcher?: typeof fetch } | undefined;
    expect(llm?.fetcher).toBeDefined();

    await llm!.fetcher!(
      new Request("https://api.example.com/chat/completions", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(captured).toHaveLength(1);
    const headers = captured[0]!.headers;
    expect(headers.get("x-nacp-trace-uuid")).toBeTruthy();
    expect(headers.get("x-nacp-session-uuid")).toBe(SESSION_UUID);
    expect(headers.get("x-nacp-team-uuid")).toBe(TEAM_UUID);
    expect(headers.get("x-nacp-request-uuid")).toBeTruthy();
  });
});
