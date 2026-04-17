import { describe, it, expect } from "vitest";
import { DO_KEYS, KV_KEYS, R2_KEYS } from "../src/keys.js";

describe("DO_KEYS", () => {
  it("has correct static key values", () => {
    expect(DO_KEYS.SESSION_PHASE).toBe("session:phase");
    expect(DO_KEYS.SESSION_MESSAGES).toBe("session:messages");
    expect(DO_KEYS.SESSION_TURN_COUNT).toBe("session:turn_count");
    expect(DO_KEYS.SESSION_SYSTEM_PROMPT).toBe("context:system_prompt");
    expect(DO_KEYS.SESSION_HOOKS_CONFIG).toBe("hooks:session_config");
    expect(DO_KEYS.NACP_SESSION_REPLAY).toBe("nacp_session:replay");
    expect(DO_KEYS.NACP_SESSION_STREAM_SEQS).toBe("nacp_session:stream_seqs");
  });

  it("toolInflight builds key with request UUID", () => {
    const key = DO_KEYS.toolInflight("abc-123");
    expect(key).toBe("tool:inflight:abc-123");
  });

  it("audit builds key with date", () => {
    const key = DO_KEYS.audit("2026-04-16");
    expect(key).toBe("audit:2026-04-16");
  });

  it("workspaceFile builds key with path", () => {
    const key = DO_KEYS.workspaceFile("src/index.ts");
    expect(key).toBe("workspace:file:src/index.ts");
  });
});

describe("KV_KEYS", () => {
  const teamUuid = "team-abc-123";

  it("providerConfig includes tenant prefix", () => {
    const key = KV_KEYS.providerConfig(teamUuid);
    expect(key).toBe(`tenants/${teamUuid}/config/providers`);
    expect(key.startsWith(`tenants/${teamUuid}/`)).toBe(true);
  });

  it("modelRegistry includes tenant prefix", () => {
    const key = KV_KEYS.modelRegistry(teamUuid);
    expect(key).toBe(`tenants/${teamUuid}/config/models`);
    expect(key.startsWith(`tenants/${teamUuid}/`)).toBe(true);
  });

  it("skillManifest includes tenant prefix", () => {
    const key = KV_KEYS.skillManifest(teamUuid);
    expect(key).toBe(`tenants/${teamUuid}/config/skills`);
    expect(key.startsWith(`tenants/${teamUuid}/`)).toBe(true);
  });

  it("hooksPolicy includes tenant prefix", () => {
    const key = KV_KEYS.hooksPolicy(teamUuid);
    expect(key).toBe(`tenants/${teamUuid}/config/hooks_policy`);
    expect(key.startsWith(`tenants/${teamUuid}/`)).toBe(true);
  });

  it("all KV keys use consistent tenants/{uuid}/ prefix", () => {
    const builders = [
      KV_KEYS.providerConfig,
      KV_KEYS.modelRegistry,
      KV_KEYS.skillManifest,
      KV_KEYS.hooksPolicy,
    ];
    for (const builder of builders) {
      const key = builder(teamUuid);
      expect(key).toMatch(/^tenants\/[^/]+\/config\//);
    }
  });
});

describe("R2_KEYS", () => {
  const t = "team-abc-123";
  const s = "session-xyz-789";

  it("workspaceFile builds correct path", () => {
    const key = R2_KEYS.workspaceFile(t, s, "src/main.ts");
    expect(key).toBe(`tenants/${t}/sessions/${s}/workspace/src/main.ts`);
  });

  it("compactArchive builds correct path with range", () => {
    const key = R2_KEYS.compactArchive(t, s, "1-50");
    expect(key).toBe(`tenants/${t}/sessions/${s}/archive/1-50.jsonl`);
  });

  it("sessionTranscript builds correct path", () => {
    const key = R2_KEYS.sessionTranscript(t, s);
    expect(key).toBe(`tenants/${t}/sessions/${s}/transcript.jsonl`);
  });

  it("auditArchive builds correct path with date partition", () => {
    const key = R2_KEYS.auditArchive(t, "2026-04-16", s);
    expect(key).toBe(`tenants/${t}/audit/2026-04-16/${s}.jsonl`);
  });

  it("attachment builds correct path", () => {
    const key = R2_KEYS.attachment(t, "file-uuid-001");
    expect(key).toBe(`tenants/${t}/attachments/file-uuid-001`);
  });

  it("all R2 keys start with tenants/ prefix", () => {
    const keys = [
      R2_KEYS.workspaceFile(t, s, "a.txt"),
      R2_KEYS.compactArchive(t, s, "1-10"),
      R2_KEYS.sessionTranscript(t, s),
      R2_KEYS.auditArchive(t, "2026-01-01", s),
      R2_KEYS.attachment(t, "uuid"),
    ];
    for (const key of keys) {
      expect(key.startsWith(`tenants/${t}/`)).toBe(true);
    }
  });
});
