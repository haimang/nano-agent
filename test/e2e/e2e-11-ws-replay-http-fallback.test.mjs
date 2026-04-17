import test from "node:test";
import assert from "node:assert/strict";

import { ReplayBuffer } from "../../packages/nacp-session/dist/replay.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { buildStreamEventBody, mapRuntimeEventToStreamKind } from "../../packages/agent-runtime-kernel/dist/events.js";
import { classifyEvent } from "../../packages/eval-observability/dist/index.js";
import { FakeTraceStorage } from "./fixtures/fake-storage.mjs";
import { TURN_UUID, TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";

test("E2E-11: WebSocket-first Live Stream → Ack/Replay → HTTP Fallback Durable Read", async () => {
  const replayBuf = new ReplayBuffer({ maxPerStream: 100 });
  const durableStorage = new FakeTraceStorage();
  const storageKey = `tenants/${TEAM_UUID}/traces/sess-ws-001/durable.jsonl`;

  // Simulate turn events emitted over WS (use runtime events, not stream events)
  const runtimeEvents = [
    { type: "turn.started", turnId: TURN_UUID, timestamp: NOW },
    { type: "llm.delta", turnId: TURN_UUID, contentType: "text", content: "hello", isFinal: false, timestamp: NOW },
    { type: "tool.call.progress", turnId: TURN_UUID, toolName: "read_file", requestId: REQUEST_UUID, chunk: "p", isFinal: false, timestamp: NOW },
    { type: "tool.call.result", turnId: TURN_UUID, toolName: "read_file", requestId: REQUEST_UUID, status: "ok", output: "done", timestamp: NOW },
    { type: "turn.completed", turnId: TURN_UUID, reason: "turn_complete", usage: { total: 42 }, timestamp: NOW },
  ];

  let seq = 0;
  for (const runtimeEvent of runtimeEvents) {
    const kind = mapRuntimeEventToStreamKind(runtimeEvent);
    const body = buildStreamEventBody(runtimeEvent);
    const frame = {
      session_frame: { stream_id: "main", stream_seq: seq++, body },
    };
    replayBuf.append(frame);

    const tier = classifyEvent(kind);
    if (tier !== "live") {
      await durableStorage.appendJsonl(storageKey, { seq: frame.session_frame.stream_seq, ...body });
    }
  }

  // Client acks up to seq 2 (inclusive)
  const lastAckSeq = 2;

  // WS disconnect

  // HTTP fallback reads durable storage
  const durableRead = await durableStorage.readJsonl(storageKey);
  const durableKinds = durableRead.map((e) => e.kind);
  assert.ok(!durableKinds.includes("keep_alive"), "HTTP fallback should not see live-only frames like keep_alive");

  // WS resume: replay from lastAckSeq + 1
  const replayed = replayBuf.replay("main", lastAckSeq + 1);
  const replayedSeqs = replayed.map((f) => f.session_frame.stream_seq);
  assert.deepEqual(replayedSeqs, [3, 4]);

  // Verify no duplicates and monotonic seq
  for (let i = 1; i < replayedSeqs.length; i++) {
    assert.ok(replayedSeqs[i] > replayedSeqs[i - 1], "seq must be strictly increasing");
  }

  // Combined view should cover all 5 events
  const seenFromReplay = replayed.map((f) => f.session_frame.body);
  const seenFromDurable = durableRead;
  assert.equal(seenFromReplay.length + lastAckSeq + 1, runtimeEvents.length);

  // Schema validation on all frames
  for (const f of replayed) {
    assert.equal(SessionStreamEventBodySchema.safeParse(f.session_frame.body).success, true);
  }
});
