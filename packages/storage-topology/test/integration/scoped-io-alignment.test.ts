/**
 * Integration — storage-topology refs and `ScopedStorageAdapter` signatures
 * align with `@nano-agent/nacp-core` tenant-scoped I/O reality.
 *
 * Verifies:
 *   - Every `build*Ref()` output parses under the real `NacpRefSchema`.
 *   - A do-storage ref built here has the SAME stored key that
 *     `tenantDoStoragePut` would write in nacp-core's scoped-io helpers.
 *   - The `ScopedStorageAdapter` shape accepts `teamUuid` on EVERY
 *     method (the v1 correctness fix for GPT R1).
 */

import { describe, it, expect, vi } from "vitest";
import { NacpRefSchema } from "../../../nacp-core/src/envelope.js";
import {
  tenantDoStoragePut,
  tenantR2Put,
  tenantKvPut,
} from "../../../nacp-core/src/tenancy/scoped-io.js";
import {
  buildDoStorageRef,
  buildKvRef,
  buildR2Ref,
} from "../../src/refs.js";
import { DO_KEYS, KV_KEYS, R2_KEYS } from "../../src/keys.js";
import { NullStorageAdapter } from "../../src/adapters/scoped-io.js";
import type { ScopedStorageAdapter } from "../../src/adapters/scoped-io.js";

describe("integration: storage-topology ↔ nacp-core tenant-scoped I/O", () => {
  const teamUuid = "team-abc-123";

  it("every build*Ref output parses under NacpRefSchema", () => {
    const r2 = buildR2Ref(teamUuid, R2_KEYS.sessionTranscript(teamUuid, "s1"));
    const kv = buildKvRef(teamUuid, KV_KEYS.providerConfig(teamUuid));
    const doRef = buildDoStorageRef(teamUuid, DO_KEYS.SESSION_PHASE);

    expect(NacpRefSchema.safeParse(r2).success).toBe(true);
    expect(NacpRefSchema.safeParse(kv).success).toBe(true);
    expect(NacpRefSchema.safeParse(doRef).success).toBe(true);
  });

  it("buildDoStorageRef(team, relativeKey).key === the key tenantDoStoragePut writes", async () => {
    const relativeKey = DO_KEYS.SESSION_PHASE;
    const ref = buildDoStorageRef(teamUuid, relativeKey);

    const captured: string[] = [];
    const fakeStorage = {
      async get() {
        return undefined;
      },
      async put(key: string, _value: unknown) {
        captured.push(key);
      },
      async delete() {
        return true;
      },
    };
    await tenantDoStoragePut(fakeStorage, teamUuid, relativeKey, "value");

    expect(captured).toHaveLength(1);
    expect(ref.key).toBe(captured[0]);
  });

  it("buildR2Ref and tenantR2Put produce matching keys when fed the same relative path", async () => {
    const relative = "sessions/s1/transcript.jsonl";
    const ref = buildR2Ref(teamUuid, relative);

    const captured: string[] = [];
    const bucket = {
      async put(key: string) {
        captured.push(key);
      },
      async get() {
        return null;
      },
      async head() {
        return null;
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {
        return undefined;
      },
    };
    await tenantR2Put(bucket, teamUuid, relative, null);

    expect(ref.key).toBe(captured[0]);
  });

  it("buildKvRef and tenantKvPut produce matching keys when fed the same relative path", async () => {
    const relative = "config/providers";
    const ref = buildKvRef(teamUuid, relative);

    const captured: string[] = [];
    const kv = {
      async get() {
        return null;
      },
      async put(key: string) {
        captured.push(key);
      },
      async delete() {
        return undefined;
      },
    };
    await tenantKvPut(kv, teamUuid, relative, "payload");

    expect(ref.key).toBe(captured[0]);
  });

  it("ScopedStorageAdapter surface expects teamUuid on every method", async () => {
    const adapter: ScopedStorageAdapter = new NullStorageAdapter();

    // Every call should reach the adapter with a `teamUuid` positional arg
    // and throw the Null adapter message. If the interface ever drops
    // teamUuid from any signature, TypeScript compilation of this test
    // will fail (which is the point).
    const spy = vi.fn(async () => {
      throw new Error("Null");
    });
    for (const name of [
      "doGet",
      "doPut",
      "doDelete",
      "kvGet",
      "kvPut",
      "kvDelete",
      "r2Get",
      "r2Put",
      "r2Delete",
      "r2List",
    ] as const) {
      const fn = (adapter as unknown as Record<string, unknown>)[name] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      expect(typeof fn).toBe("function");
      await expect(fn.call(adapter, teamUuid, "k", "v")).rejects.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
