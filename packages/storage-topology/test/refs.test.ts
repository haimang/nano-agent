import { describe, it, expect } from "vitest";
// Relative path to the sibling nacp-core package so we can validate
// every produced ref against the real `NacpRefSchema` without adding a
// hard workspace install.
import { NacpRefSchema } from "../../nacp-core/src/envelope.js";
import {
  buildR2Ref,
  buildKvRef,
  buildDoStorageRef,
  validateRefKey,
} from "../src/refs.js";
import type { StorageRef } from "../src/refs.js";
import { R2_KEYS, KV_KEYS, DO_KEYS } from "../src/keys.js";

describe("buildR2Ref", () => {
  const teamUuid = "team-abc-123";

  it("builds ref with correct kind / binding / team_uuid", () => {
    const ref = buildR2Ref(teamUuid, R2_KEYS.sessionTranscript(teamUuid, "s1"));
    expect(ref.kind).toBe("r2");
    expect(ref.binding).toBe("WORKSPACE_R2");
    expect(ref.team_uuid).toBe(teamUuid);
  });

  it("defaults role to 'output'", () => {
    const ref = buildR2Ref(teamUuid, "foo/bar");
    expect(ref.role).toBe("output");
  });

  it("accepts role / content_type / size_bytes / etag / bucket via options", () => {
    const ref = buildR2Ref(teamUuid, "foo/bar", {
      role: "attachment",
      content_type: "text/plain",
      size_bytes: 42,
      etag: "abc",
      bucket: "workspace",
    });
    expect(ref.role).toBe("attachment");
    expect(ref.content_type).toBe("text/plain");
    expect(ref.size_bytes).toBe(42);
    expect(ref.etag).toBe("abc");
    expect(ref.bucket).toBe("workspace");
  });

  it("preserves an already-tenant-prefixed key verbatim", () => {
    const key = R2_KEYS.sessionTranscript(teamUuid, "session-1");
    const ref = buildR2Ref(teamUuid, key);
    expect(ref.key).toBe(key);
  });

  it("auto-prefixes a relative key so it always satisfies NacpRefSchema", () => {
    const ref = buildR2Ref(teamUuid, "attachments/file.bin");
    expect(ref.key).toBe(`tenants/${teamUuid}/attachments/file.bin`);
  });

  it("strips a leading slash on a relative key before auto-prefixing", () => {
    const ref = buildR2Ref(teamUuid, "/attachments/file.bin");
    expect(ref.key).toBe(`tenants/${teamUuid}/attachments/file.bin`);
  });
});

describe("buildKvRef", () => {
  const teamUuid = "team-abc-123";

  it("builds ref with correct kind / binding", () => {
    const ref = buildKvRef(teamUuid, KV_KEYS.providerConfig(teamUuid));
    expect(ref.kind).toBe("kv");
    expect(ref.binding).toBe("TENANT_KV");
    expect(ref.team_uuid).toBe(teamUuid);
  });

  it("defaults role to 'input'", () => {
    const ref = buildKvRef(teamUuid, "config/providers");
    expect(ref.role).toBe("input");
  });

  it("auto-prefixes a relative key", () => {
    const ref = buildKvRef(teamUuid, "config/providers");
    expect(ref.key).toBe(`tenants/${teamUuid}/config/providers`);
  });
});

describe("buildDoStorageRef", () => {
  const teamUuid = "team-abc-123";

  it("builds ref with correct kind / binding", () => {
    const ref = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE);
    expect(ref.kind).toBe("do-storage");
    expect(ref.binding).toBe("SESSION_DO");
    expect(ref.team_uuid).toBe(teamUuid);
  });

  it("defaults role to 'output'", () => {
    const ref = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_MESSAGES);
    expect(ref.role).toBe("output");
  });

  it("auto-prefixes the DO relative key so the ref is NacpRef-valid for do-storage too", () => {
    const ref = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE);
    expect(ref.key).toBe(`tenants/${teamUuid}/session:phase`);
  });
});

describe("validateRefKey", () => {
  const teamUuid = "team-abc-123";

  it("accepts a tenant-prefixed R2 ref", () => {
    const ref = buildR2Ref(teamUuid, R2_KEYS.attachment(teamUuid, "uuid-1"));
    expect(validateRefKey(ref)).toBe(true);
  });

  it("rejects a manually-constructed ref with no tenant prefix", () => {
    const ref: StorageRef = {
      kind: "r2",
      binding: "WORKSPACE_R2",
      team_uuid: teamUuid,
      key: "no-prefix/attachment/uuid-1",
      role: "output",
    };
    expect(validateRefKey(ref)).toBe(false);
  });

  it("rejects a manually-constructed ref with a wrong-tenant prefix", () => {
    const ref: StorageRef = {
      kind: "r2",
      binding: "WORKSPACE_R2",
      team_uuid: teamUuid,
      key: "tenants/other-team/attachments/uuid-1",
      role: "output",
    };
    expect(validateRefKey(ref)).toBe(false);
  });

  it("accepts a tenant-prefixed KV ref", () => {
    const ref = buildKvRef(teamUuid, KV_KEYS.providerConfig(teamUuid));
    expect(validateRefKey(ref)).toBe(true);
  });

  it("accepts a tenant-prefixed DO ref (the do-storage tenant prefix is NOT exempt)", () => {
    const ref = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE);
    expect(validateRefKey(ref)).toBe(true);
  });

  it("rejects a DO ref with an empty key", () => {
    const ref: StorageRef = {
      kind: "do-storage",
      binding: "SESSION_DO",
      team_uuid: teamUuid,
      key: "",
      role: "output",
    };
    expect(validateRefKey(ref)).toBe(false);
  });
});

describe("cross-package alignment with @haimang/nacp-core NacpRefSchema", () => {
  const teamUuid = "team-abc-123";

  it("buildR2Ref output parses under NacpRefSchema", () => {
    const ref = buildR2Ref(teamUuid, R2_KEYS.sessionTranscript(teamUuid, "s1"));
    expect(NacpRefSchema.safeParse(ref).success).toBe(true);
  });

  it("buildKvRef output parses under NacpRefSchema", () => {
    const ref = buildKvRef(teamUuid, KV_KEYS.providerConfig(teamUuid));
    expect(NacpRefSchema.safeParse(ref).success).toBe(true);
  });

  it("buildDoStorageRef output parses under NacpRefSchema (tenant prefix is required)", () => {
    const ref = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE);
    const parsed = NacpRefSchema.safeParse(ref);
    expect(parsed.success).toBe(true);
  });

  it("NacpRefSchema rejects a do-storage ref that is missing the tenant prefix (regression guard)", () => {
    const bad: StorageRef = {
      kind: "do-storage",
      binding: "SESSION_DO",
      team_uuid: teamUuid,
      key: "session:phase", // intentionally non-prefixed
      role: "output",
    };
    expect(NacpRefSchema.safeParse(bad).success).toBe(false);
  });
});
