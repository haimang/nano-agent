import { describe, expect, it } from "vitest";
import {
  DO_KEYS,
  KV_KEYS,
  R2_KEYS,
  NacpRefSchema,
  buildDoStorageRef,
  buildKvRef,
  buildR2Ref,
  validateRefKey,
} from "../src/index.js";

const teamUuid = "team-storage";

describe("storage-law consolidation", () => {
  it("keeps the existing DO/KV/R2 builders and keys", () => {
    expect(DO_KEYS.SESSION_PHASE).toBe("session:phase");
    expect(KV_KEYS.featureFlags()).toBe("_platform/config/feature_flags");
    expect(R2_KEYS.sessionTranscript(teamUuid, "session-1")).toBe(
      "tenants/team-storage/sessions/session-1/transcript.jsonl",
    );
  });

  it("builds NacpRef-compatible refs with tenant-prefixed keys", () => {
    const refs = [
      buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE),
      buildKvRef(teamUuid, "config/providers"),
      buildR2Ref(teamUuid, "sessions/s-1/workspace/a.txt"),
    ];
    for (const ref of refs) {
      expect(validateRefKey(ref)).toBe(true);
      expect(NacpRefSchema.safeParse(ref).success).toBe(true);
    }
  });
});
