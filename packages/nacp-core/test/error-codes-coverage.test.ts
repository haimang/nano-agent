/**
 * RHX2 P2-03 — registry ↔ docs parity gate.
 *
 * Reads `docs/api/error-codes.md`, parses every markdown table row, and
 * asserts:
 *   1. every code in the markdown has a matching ErrorMeta in the
 *      runtime registry (same category / http_status / retryable);
 *   2. every code in the runtime registry has a row in the markdown.
 *
 * If you add or change a code in `error-registry.ts`, the test will
 * fail until you also update the markdown — that's the point.
 */

import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  listErrorMetas,
  type ErrorMeta,
} from "../src/error-registry.js";

const DOC_PATH = new URL("../../../docs/api/error-codes.md", import.meta.url);

interface DocRow {
  code: string;
  category: string;
  http_status: number;
  retryable: boolean;
}

function parseDoc(): DocRow[] {
  const text = readFileSync(DOC_PATH, "utf8");
  const rows: DocRow[] = [];
  const re = /^\|\s*`([^`]+)`\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(yes|no)\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    rows.push({
      code: m[1]!,
      category: m[2]!,
      http_status: Number.parseInt(m[3]!, 10),
      retryable: m[4] === "yes",
    });
  }
  return rows;
}

describe("docs/api/error-codes.md ↔ resolveErrorMeta() parity", () => {
  it("docs file exists at the expected path", () => {
    expect(existsSync(DOC_PATH)).toBe(true);
  });

  it("every doc row matches the runtime registry exactly", () => {
    const rows = parseDoc();
    expect(rows.length).toBeGreaterThan(0);
    const registry = new Map(listErrorMetas().map((m) => [m.code, m] as const));
    const mismatches: string[] = [];
    for (const r of rows) {
      const meta = registry.get(r.code);
      if (!meta) {
        mismatches.push(
          `[doc-only] code "${r.code}" exists in markdown but not in registry`,
        );
        continue;
      }
      if (meta.category !== r.category) {
        mismatches.push(
          `[category drift] ${r.code}: doc=${r.category} registry=${meta.category}`,
        );
      }
      if (meta.http_status !== r.http_status) {
        mismatches.push(
          `[http_status drift] ${r.code}: doc=${r.http_status} registry=${meta.http_status}`,
        );
      }
      if (meta.retryable !== r.retryable) {
        mismatches.push(
          `[retryable drift] ${r.code}: doc=${r.retryable} registry=${meta.retryable}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every registry code is mentioned in the docs", () => {
    const rows = parseDoc();
    const docCodes = new Set(rows.map((r) => r.code));
    const missing: string[] = [];
    for (const meta of listErrorMetas()) {
      if (!docCodes.has(meta.code)) {
        missing.push(`[registry-only] ${meta.code} (source=${meta.source})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("docs row count >= 75 (sanity floor; current registry size = 78)", () => {
    const rows = parseDoc();
    expect(rows.length).toBeGreaterThanOrEqual(75);
  });
});

describe("listErrorMetas() shape invariants", () => {
  function checkMeta(m: ErrorMeta): void {
    expect(m.code.length).toBeGreaterThan(0);
    expect([
      "validation",
      "transient",
      "dependency",
      "permanent",
      "security",
      "quota",
      "conflict",
    ]).toContain(m.category);
    expect(m.http_status).toBeGreaterThanOrEqual(400);
    expect(m.http_status).toBeLessThanOrEqual(599);
    expect(typeof m.retryable).toBe("boolean");
    expect(m.message.length).toBeGreaterThan(0);
  }

  it("every meta entry has well-formed shape", () => {
    for (const meta of listErrorMetas()) checkMeta(meta);
  });

  it("no two entries share the same code (dedupe invariant)", () => {
    const seen = new Set<string>();
    for (const meta of listErrorMetas()) {
      expect(seen.has(meta.code)).toBe(false);
      seen.add(meta.code);
    }
  });
});
