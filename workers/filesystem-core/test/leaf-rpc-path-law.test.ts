import { describe, expect, it } from "vitest";
import {
  buildCleanupPrefix,
  buildSnapshotKey,
  buildTempFileKey,
  buildTempFileListPrefix,
} from "../src/index.js";

describe("filesystem-core leaf RPC path law", () => {
  const teamUuid = "team-abc";
  const sessionUuid = "session-xyz";
  const checkpointUuid = "checkpoint-123";

  it("normalizes workspace temp-file keys with the HP6 relative-path law", () => {
    expect(buildTempFileKey(teamUuid, sessionUuid, "src/main.ts")).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/src/main.ts`,
    );
  });

  it("rejects traversal and absolute virtual_path input", () => {
    expect(() => buildTempFileKey(teamUuid, sessionUuid, "../secret.txt")).toThrow(
      /virtual_path segment '\.\.' is not allowed/,
    );
    expect(() => buildTempFileKey(teamUuid, sessionUuid, "/etc/passwd")).toThrow(
      /virtual_path must be relative/,
    );
  });

  it("uses the HP7 snapshots/{checkpoint_uuid}/{virtual_path} law for snapshot keys", () => {
    expect(buildSnapshotKey(teamUuid, sessionUuid, checkpointUuid, "notes/summary.md")).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/snapshots/${checkpointUuid}/notes/summary.md`,
    );
  });

  it("pins list prefixes to normalized workspace directories", () => {
    expect(buildTempFileListPrefix(teamUuid, sessionUuid)).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/`,
    );
    expect(buildTempFileListPrefix(teamUuid, sessionUuid, "src/components")).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/src/components/`,
    );
  });

  it("defaults cleanup to workspace scope unless all is explicit", () => {
    expect(buildCleanupPrefix(teamUuid, sessionUuid)).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/`,
    );
    expect(buildCleanupPrefix(teamUuid, sessionUuid, "snapshots")).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/snapshots/`,
    );
    expect(buildCleanupPrefix(teamUuid, sessionUuid, "all")).toBe(
      `tenants/${teamUuid}/sessions/${sessionUuid}/`,
    );
  });
});
