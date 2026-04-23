/**
 * 2nd-round R2 — live runtime evidence emitter wiring regression.
 *
 * The first-wave A6/A7 fix wired `ContextAssembler /
 * CompactBoundaryManager / WorkspaceSnapshotBuilder` to accept
 * `{ evidenceSink, evidenceAnchor }`, but `session-do-runtime`
 * had no use-site that constructed those objects with wiring
 * injected — so deploy-time emission stayed at zero. This test
 * proves the new path:
 *
 *   1. Constructing a `NanoSessionDO` with an `eval` sink in
 *      subsystems automatically gets a workspace composition with
 *      `evidenceSink + evidenceAnchor` plumbed in.
 *   2. Driving the DO through a checkpoint causes
 *      `WorkspaceSnapshotBuilder.buildFragment()` to fire and emit
 *      a `snapshot.capture` evidence record into the eval sink.
 *
 * Without the 2nd-round R2 fix the eval sink would only see
 * trace events, never an evidence record from the workspace
 * composition.
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../../src/host/do/nano-session-do.js";
import type { CompositionFactory, SubsystemHandles } from "../../../src/host/composition.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "team-2nd-round-r2";

function makeFactoryWithEvalSink(emitted: unknown[]): CompositionFactory {
  return {
    create(): SubsystemHandles {
      return {
        kernel: undefined,
        llm: undefined,
        capability: undefined,
        workspace: undefined,
        hooks: undefined,
        eval: {
          emit(record: unknown) {
            emitted.push(record);
          },
        },
        storage: undefined,
        profile: { capability: "local", hooks: "local", provider: "local" },
      };
    },
  };
}

describe("live runtime evidence emitter wiring (2nd-round R2)", () => {
  it("constructs a workspace composition with live evidence wiring when eval sink is present", () => {
    const emitted: unknown[] = [];
    const factory = makeFactoryWithEvalSink(emitted);
    const doInstance = new NanoSessionDO(
      {},
      { TEAM_UUID, SESSION_UUID },
      factory,
    );
    const subs = doInstance.getSubsystems();
    expect(subs.workspace).toBeDefined();
    const ws = subs.workspace as {
      assembler?: unknown;
      compactManager?: unknown;
      snapshotBuilder?: unknown;
      captureSnapshot?: unknown;
    };
    expect(typeof ws.assembler).toBe("object");
    expect(typeof ws.compactManager).toBe("object");
    expect(typeof ws.snapshotBuilder).toBe("object");
    expect(typeof ws.captureSnapshot).toBe("function");
  });

  // 3rd-round R2: prove the **default deploy assembly** (no factory
  // override, no eval handle) still emits evidence into the DO's
  // built-in bounded sink. Without this regression, production
  // would silently drop every `snapshot.capture` record because
  // `createDefaultCompositionFactory()` and `makeRemoteBindingsFactory()`
  // both return `eval: undefined`.
  it("default deploy assembly (no factory override) routes evidence into the DO's built-in sink", async () => {
    const stored = new Map<string, unknown>();
    const doStateWithStorage = {
      storage: {
        async get<T>(k: string): Promise<T | undefined> {
          return stored.get(k) as T | undefined;
        },
        async put<T>(k: string, v: T): Promise<void> {
          stored.set(k, v);
        },
      },
    };
    // Crucially: NO compositionFactory argument. This is the
    // default-deploy code path.
    const doInstance = new NanoSessionDO(doStateWithStorage, {
      TEAM_UUID,
      SESSION_UUID,
    });

    // The default eval sink must exist on subsystems (no longer
    // undefined) so the workspace composition has something to
    // emit into.
    expect((doInstance.getSubsystems().eval as { emit?: unknown }).emit).toBeTypeOf(
      "function",
    );

    await doInstance.webSocketClose(null);
    const recorded = doInstance.getDefaultEvalRecords();
    const snapshotEvidences = recorded.filter(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        (r as { stream?: string }).stream === "snapshot",
    );
    expect(snapshotEvidences.length).toBeGreaterThanOrEqual(1);
    const first = snapshotEvidences[0] as {
      phase?: string;
      anchor?: { sessionUuid?: string };
    };
    expect(first.phase).toBe("capture");
    expect(first.anchor?.sessionUuid).toBe(SESSION_UUID);
  });

  it("emits a snapshot.capture evidence record into the eval sink during persistCheckpoint", async () => {
    const emitted: unknown[] = [];
    const factory = makeFactoryWithEvalSink(emitted);
    // Provide a minimal in-memory storage so persistCheckpoint runs.
    const stored = new Map<string, unknown>();
    const doStateWithStorage = {
      storage: {
        async get<T>(k: string): Promise<T | undefined> {
          return stored.get(k) as T | undefined;
        },
        async put<T>(k: string, v: T): Promise<void> {
          stored.set(k, v);
        },
      },
    };
    const doInstance = new NanoSessionDO(
      doStateWithStorage,
      { TEAM_UUID, SESSION_UUID },
      factory,
    );

    // Trigger checkpoint via the DO's webSocketClose path which is
    // the simplest public entry that lands in `persistCheckpoint`.
    await doInstance.webSocketClose(null);

    const snapshotEvidences = emitted.filter(
      (r) => typeof r === "object" && r !== null && (r as { stream?: string }).stream === "snapshot",
    );
    expect(snapshotEvidences.length).toBeGreaterThanOrEqual(1);
    const first = snapshotEvidences[0] as {
      stream: string;
      phase?: string;
      anchor?: { sessionUuid?: string; teamUuid?: string; traceUuid?: string };
    };
    expect(first.phase).toBe("capture");
    expect(first.anchor?.sessionUuid).toBe(SESSION_UUID);
    expect(first.anchor?.teamUuid).toBe(TEAM_UUID);
    expect(first.anchor?.traceUuid).toBeTruthy();
  });
});
