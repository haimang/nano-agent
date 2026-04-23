import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
  validateSessionCheckpoint,
} from "../../packages/session-do-runtime/dist/index.js";
import { createKernelSnapshot, restoreFromFragment } from "../../packages/agent-runtime-kernel/dist/index.js";
import {
  WorkspaceSnapshotBuilder,
  WorkspaceNamespace,
  MountRouter,
  MemoryBackend,
  InMemoryArtifactStore,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import { ReplayBuffer } from "../../packages/nacp-session/dist/replay.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { buildStreamEventBody } from "../../packages/agent-runtime-kernel/dist/events.js";
import { validateRefKey } from "../../packages/storage-topology/dist/index.js";
import { promoteToArtifactRef } from "../../packages/workspace-context-artifacts/dist/index.js";
import { SESSION_UUID, TEAM_UUID, NOW, makeTurnUuid } from "./fixtures/seed-data.mjs";

test("E2E-05: Session Resume — Checkpoint → Restore → Continue Turn", async () => {
  // 1. Workspace snapshot with artifacts + mounts
  const router = new MountRouter();
  const memBackend = new MemoryBackend();
  await memBackend.write("main.ts", "export {}");
  router.addMount({ mountPoint: "/workspace", backend: "memory", access: "writable" }, memBackend);
  const namespace = new WorkspaceNamespace(router);

  const store = new InMemoryArtifactStore();
  const art1 = promoteToArtifactRef(TEAM_UUID, "a", "text/plain", "file", { idFactory: () => "a1" });
  const art2 = promoteToArtifactRef(TEAM_UUID, "b", "text/plain", "image", { idFactory: () => "a2" });
  store.register({ ref: art1, audience: "internal", createdAt: NOW });
  store.register({ ref: art2, audience: "internal", createdAt: NOW });

  const wsBuilder = new WorkspaceSnapshotBuilder(namespace, store);
  const workspaceFragment = await wsBuilder.buildFragment();

  // Validate artifact refs have tenant-scoped keys
  for (const ref of workspaceFragment.artifactRefs) {
    assert.equal(validateRefKey({ kind: ref.kind, team_uuid: ref.team_uuid, key: ref.key }), true);
  }

  // 2. Kernel snapshot (simulated)
  const kernelSnapshot = createKernelSnapshot({
    sessionUuid: SESSION_UUID,
    turnCount: 2,
    messages: [{ role: "system", content: "sys" }],
  });

  // 3. Replay buffer checkpoint
  const replayBuf = new ReplayBuffer();
  for (let i = 0; i < 8; i++) {
    replayBuf.append({
      session_frame: { stream_uuid: "main", stream_seq: 12 + i, body: { kind: "llm.delta", content: `d${i}` } },
    });
  }
  const replayFragment = replayBuf.checkpoint();

  // 4. Build session checkpoint
  const checkpoint = await buildSessionCheckpoint(
    SESSION_UUID,
    TEAM_UUID,
    "attached",
    2,
    { totalTokens: 120, totalTurns: 2, totalDurationMs: 2500 },
    {
      getKernelFragment: () => kernelSnapshot,
      getReplayFragment: async () => replayFragment,
      getStreamSeqs: () => ({ main: 19 }),
      getWorkspaceFragment: async () => workspaceFragment,
      getHooksFragment: () => ({ handlers: [] }),
    },
  );

  assert.equal(validateSessionCheckpoint(checkpoint), true);

  // 5. Restore checkpoint
  let restoredKernel = null;
  let restoredWorkspace = null;
  let restoredReplay = null;

  const restored = await restoreSessionCheckpoint(checkpoint, {
    restoreKernel: (fragment) => {
      restoredKernel = restoreFromFragment(fragment);
      return restoredKernel;
    },
    restoreReplay: async (fragment) => {
      const buf = new ReplayBuffer();
      buf.restore(fragment);
      restoredReplay = buf;
      return buf;
    },
    restoreWorkspace: async (fragment) => {
      restoredWorkspace = WorkspaceSnapshotBuilder.restoreFragment(fragment);
      return restoredWorkspace;
    },
    restoreHooks: (fragment) => fragment,
  });

  assert.equal(restored.actorPhase, "attached");
  assert.equal(restored.turnCount, 2);
  assert.deepEqual(restored.streamSeqs, { main: 19 });

  // 6. Verify replay continuity: replay from baseSeq should return events
  const replayed = restoredReplay.replay("main", 12);
  assert.equal(replayed.length, 8);

  // 7. Verify workspace mount restored by listing files
  // Note: restoredWorkspace only gives mountConfigs + artifactRefs; actual namespace rehydration is harness-level
  assert.equal(restoredWorkspace.mountConfigs.length >= 1, true);
  assert.equal(restoredWorkspace.artifactRefs.length, 2);

  // 8. Simulate new turn after resume
  const turnBeginEvent = {
    type: "turn.started",
    turnId: makeTurnUuid(3),
    timestamp: NOW,
  };
  const body = buildStreamEventBody(turnBeginEvent);
  assert.equal(body.kind, "turn.begin");
  assert.equal(SessionStreamEventBodySchema.safeParse(body).success, true);
});
