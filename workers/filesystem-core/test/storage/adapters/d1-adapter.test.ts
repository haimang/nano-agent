/**
 * Storage Topology — D1Adapter Tests
 *
 * Targets B1 finding F06 (D1 batch-only contract). The negative-API
 * shape (no `beginTransaction`, no `commit`, no `rollback`, no `exec`)
 * is asserted both via runtime checks and via type-level constraint:
 * `D1Adapter` does not declare those methods, so referencing them in a
 * test would fail to compile.
 */

import { describe, it, expect } from "vitest";
import {
  D1Adapter,
  type D1DatabaseBinding,
  type D1PreparedStatementLike,
  type D1ResultLike,
} from "../../../src/storage/adapters/d1-adapter.js";

interface FakeRow {
  id: number;
  name: string;
}

function makeStmt(
  exec: (params: unknown[]) => Promise<D1ResultLike<FakeRow>>,
): D1PreparedStatementLike {
  let bound: unknown[] = [];
  const stmt: D1PreparedStatementLike = {
    bind(...params) {
      bound = params;
      return stmt;
    },
    async all() {
      return exec(bound) as Promise<D1ResultLike>;
    },
    async run() {
      return exec(bound) as Promise<D1ResultLike>;
    },
    async first() {
      const result = await exec(bound);
      return (result.results[0] as Record<string, unknown> | undefined) ?? null;
    },
  };
  return stmt;
}

function makeDb(
  rows: FakeRow[] = [],
): { db: D1DatabaseBinding; prepareCalls: string[]; counters: { batchCalls: number } } {
  const prepareCalls: string[] = [];
  const counters = { batchCalls: 0 };
  const db: D1DatabaseBinding = {
    prepare(query) {
      prepareCalls.push(query);
      return makeStmt(async (_params) => ({
        results: rows,
        success: true,
      }));
    },
    async batch(statements) {
      counters.batchCalls += 1;
      const out: D1ResultLike[] = [];
      for (const s of statements) {
        out.push(await s.all());
      }
      return out;
    },
  };
  return { db, prepareCalls, counters };
}

describe("D1Adapter", () => {
  describe("query / first", () => {
    it("query binds params and returns results", async () => {
      const { db, prepareCalls } = makeDb([
        { id: 1, name: "alice" },
        { id: 2, name: "bob" },
      ]);
      const adapter = new D1Adapter(db);
      const result = await adapter.query<FakeRow>("SELECT * FROM users WHERE id > ?", 0);
      expect(prepareCalls).toEqual(["SELECT * FROM users WHERE id > ?"]);
      expect(result.results).toHaveLength(2);
    });

    it("first returns first row or null", async () => {
      const { db } = makeDb([{ id: 1, name: "alice" }]);
      const adapter = new D1Adapter(db);
      const row = await adapter.first<FakeRow>("SELECT * FROM users LIMIT 1");
      expect(row).toEqual({ id: 1, name: "alice" });
    });

    it("first returns null on empty result", async () => {
      const { db } = makeDb([]);
      const adapter = new D1Adapter(db);
      expect(await adapter.first("SELECT * FROM users LIMIT 1")).toBeNull();
    });
  });

  describe("batch (per spike-do-storage-F06)", () => {
    it("batch dispatches all statements through db.batch (atomic group)", async () => {
      const { db, counters } = makeDb([{ id: 1, name: "alice" }]);
      const adapter = new D1Adapter(db);
      const s1 = adapter.prepare("INSERT INTO users(name) VALUES(?)").bind("a");
      const s2 = adapter.prepare("INSERT INTO users(name) VALUES(?)").bind("b");
      const results = await adapter.batch([s1, s2]);
      expect(results).toHaveLength(2);
      expect(counters.batchCalls).toBe(1);
    });
  });

  describe("F06 negative-API contract: no transaction primitives exposed", () => {
    it("D1Adapter does NOT have beginTransaction / commit / rollback / exec", () => {
      const { db } = makeDb();
      const adapter = new D1Adapter(db);
      const surface = adapter as unknown as Record<string, unknown>;
      expect(surface.beginTransaction).toBeUndefined();
      expect(surface.commit).toBeUndefined();
      expect(surface.rollback).toBeUndefined();
      expect(surface.exec).toBeUndefined();
    });

    it("public surface is exactly { query, first, batch, prepare, maxValueBytes }", () => {
      const { db } = makeDb();
      const adapter = new D1Adapter(db);
      const own = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
        .filter((n) => n !== "constructor")
        .sort();
      // adapter.maxValueBytes lives on the instance (readonly field)
      expect(own).toEqual(["batch", "first", "prepare", "query"]);
      expect(adapter.maxValueBytes).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
