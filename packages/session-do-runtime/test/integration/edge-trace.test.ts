/**
 * Integration — A4 Phase 4 edge trace wiring.
 *
 * Proves that attach / resume / close all emit trace events through the
 * composition's eval sink, carrying the A3 trace-first carriers
 * (`traceUuid`, `sourceRole`, `sessionUuid`, `teamUuid`).
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../src/do/nano-session-do.js";
import type {
  CompositionFactory,
  SubsystemHandles,
} from "../../src/composition.js";
import { validateTraceEvent } from "@nano-agent/eval-observability";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TRACE = "22222222-2222-4222-8222-222222222222";

function makeFrame(
  messageType: string,
  body?: Record<string, unknown>,
): string {
  return JSON.stringify({
    header: {
      schema_version: "1.1.0",
      message_uuid: crypto.randomUUID(),
      message_type: messageType,
      delivery_kind: "command",
      sent_at: new Date().toISOString(),
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: { trace_uuid: TRACE, session_uuid: SESSION_UUID },
    body,
  });
}

function makeFactoryWithRecordingEval(
  sink: { events: unknown[] },
): CompositionFactory {
  return {
    create(): SubsystemHandles {
      return {
        kernel: {},
        llm: {},
        capability: {},
        workspace: {},
        hooks: {},
        eval: {
          async emit(event: unknown) {
            sink.events.push(event);
          },
        },
        storage: {},
      };
    },
  };
}

describe("Edge trace wiring (A4 Phase 4)", () => {
  it("emits session.edge.resume with a trace-law-compliant payload", async () => {
    const sink = { events: [] as unknown[] };
    const factory = makeFactoryWithRecordingEval(sink);
    const store = new Map<string, unknown>();
    const doInstance = new NanoSessionDO(
      {
        storage: {
          get: async <T,>(k: string) => store.get(k) as T | undefined,
          put: async <T,>(k: string, v: T) => {
            store.set(k, v);
          },
        },
      },
      { TEAM_UUID: "team-edge", SESSION_UUID },
      factory,
    );

    await doInstance.webSocketMessage(
      null,
      makeFrame("session.start", { initial_input: "hi" }),
    );
    await doInstance.webSocketMessage(
      null,
      makeFrame("session.resume", { last_seen_seq: 3 }),
    );

    const resumeEvent = sink.events.find(
      (e) =>
        (e as { eventKind?: string }).eventKind === "session.edge.resume",
    );
    expect(resumeEvent).toBeDefined();
    expect(validateTraceEvent(resumeEvent as never)).toEqual([]);
  });

  it("emits session.edge.detach on webSocketClose", async () => {
    const sink = { events: [] as unknown[] };
    const factory = makeFactoryWithRecordingEval(sink);
    const doInstance = new NanoSessionDO(
      {},
      { TEAM_UUID: "team-edge", SESSION_UUID },
      factory,
    );

    await doInstance.webSocketMessage(
      null,
      makeFrame("session.start", { initial_input: "hi" }),
    );
    await doInstance.webSocketClose(null);

    const detach = sink.events.find(
      (e) =>
        (e as { eventKind?: string }).eventKind === "session.edge.detach",
    );
    expect(detach).toBeDefined();
    expect(validateTraceEvent(detach as never)).toEqual([]);
  });

  it("drops edge traces when no team/session identity is available", async () => {
    const sink = { events: [] as unknown[] };
    const factory = makeFactoryWithRecordingEval(sink);
    // No TEAM_UUID / SESSION_UUID provided — DO has no anchor.
    const doInstance = new NanoSessionDO({}, {}, factory);
    await doInstance.webSocketClose(null);
    const hit = sink.events.find(
      (e) =>
        typeof (e as { eventKind?: unknown }).eventKind === "string" &&
        ((e as { eventKind: string }).eventKind as string).startsWith(
          "session.edge.",
        ),
    );
    expect(hit).toBeUndefined();
  });
});
