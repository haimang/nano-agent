/**
 * Tests for placement hypotheses.
 */

import { describe, it, expect } from "vitest";
import {
  PLACEMENT_HYPOTHESES,
  defaultMimeGate,
  enforceMimeGate,
  getPlacement,
} from "../../src/storage/placement.js";
import { DATA_ITEM_CATALOG } from "../../src/storage/data-items.js";
import type { DataItemClass } from "../../src/storage/data-items.js";

describe("PLACEMENT_HYPOTHESES", () => {
  it("has one hypothesis per data item in the catalog", () => {
    const catalogKeys = Object.keys(DATA_ITEM_CATALOG) as DataItemClass[];
    expect(PLACEMENT_HYPOTHESES.size).toBe(catalogKeys.length);

    for (const key of catalogKeys) {
      expect(PLACEMENT_HYPOTHESES.has(key)).toBe(true);
    }
  });

  it("marks frozen items as non-provisional", () => {
    const sessionPhase = PLACEMENT_HYPOTHESES.get("session-phase");
    expect(sessionPhase).toBeDefined();
    expect(sessionPhase!.provisional).toBe(false);
  });

  it("marks provisional items as provisional", () => {
    const sessionMessages = PLACEMENT_HYPOTHESES.get("session-messages");
    expect(sessionMessages).toBeDefined();
    expect(sessionMessages!.provisional).toBe(true);
  });

  it("maps hot items to do-storage backend", () => {
    const hypothesis = PLACEMENT_HYPOTHESES.get("session-phase");
    expect(hypothesis!.storageBackend).toBe("do-storage");
  });

  it("maps warm items to kv backend", () => {
    const hypothesis = PLACEMENT_HYPOTHESES.get("provider-config");
    expect(hypothesis!.storageBackend).toBe("kv");
  });

  it("maps cold items to r2 backend", () => {
    const hypothesis = PLACEMENT_HYPOTHESES.get("compact-archive");
    expect(hypothesis!.storageBackend).toBe("r2");
  });

  it("carries revisitCondition from the catalog", () => {
    const hypothesis = PLACEMENT_HYPOTHESES.get("session-messages");
    expect(hypothesis!.revisitCondition).toBe(
      DATA_ITEM_CATALOG["session-messages"].revisitCondition,
    );
  });

  it("carries displayName as revisitRationale", () => {
    const hypothesis = PLACEMENT_HYPOTHESES.get("session-messages");
    expect(hypothesis!.revisitRationale).toBe(
      DATA_ITEM_CATALOG["session-messages"].displayName,
    );
  });
});

describe("getPlacement", () => {
  it("returns the hypothesis for a known item", () => {
    const result = getPlacement("session-phase");
    expect(result).toBeDefined();
    expect(result!.dataItem).toBe("session-phase");
    expect(result!.storageBackend).toBe("do-storage");
  });

  it("returns undefined for an unknown item", () => {
    const result = getPlacement("nonexistent" as DataItemClass);
    expect(result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// MIME-gate wiring (2nd-round GPT R2 regression guard)
// ═══════════════════════════════════════════════════════════════════

describe("PlacementHypothesis.mimeGate (2nd-round R2)", () => {
  it("every hypothesis carries a mimeGate field", () => {
    for (const h of PLACEMENT_HYPOTHESES.values()) {
      expect(["gated-by-mime", "workspace-delegated", "not-applicable"]).toContain(h.mimeGate);
    }
  });

  it("workspace-file-small / workspace-file-large / attachment are workspace-delegated", () => {
    for (const key of ["workspace-file-small", "workspace-file-large", "attachment"] as const) {
      expect(PLACEMENT_HYPOTHESES.get(key)!.mimeGate).toBe("workspace-delegated");
    }
  });

  it("compact-archive / session-transcript / audit-trail / audit-archive / system-prompt are gated-by-mime", () => {
    for (const key of [
      "compact-archive",
      "session-transcript",
      "audit-trail",
      "audit-archive",
      "system-prompt",
    ] as const) {
      expect(PLACEMENT_HYPOTHESES.get(key)!.mimeGate).toBe("gated-by-mime");
    }
  });

  it("control / counter items are not-applicable", () => {
    for (const key of [
      "session-phase",
      "replay-buffer",
      "stream-seqs",
      "provider-config",
      "feature-flags",
    ] as const) {
      expect(PLACEMENT_HYPOTHESES.get(key)!.mimeGate).toBe("not-applicable");
    }
  });

  it("defaultMimeGate agrees with the PLACEMENT_HYPOTHESES table for every DataItemClass", () => {
    for (const [key, h] of PLACEMENT_HYPOTHESES) {
      expect(defaultMimeGate(key)).toBe(h.mimeGate);
    }
  });
});

describe("enforceMimeGate", () => {
  it("returns allowed=true for not-applicable placements without consulting the gate", () => {
    const p = PLACEMENT_HYPOTHESES.get("session-phase")!;
    const r = enforceMimeGate(p);
    expect(r.allowed).toBe(true);
    expect(r.gate).toBe("not-applicable");
  });

  it("returns allowed=true for workspace-delegated placements (workspace runs its own gate)", () => {
    const p = PLACEMENT_HYPOTHESES.get("workspace-file-small")!;
    const r = enforceMimeGate(p, {
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });
    expect(r.allowed).toBe(true);
    expect(r.gate).toBe("workspace-delegated");
  });

  it("runs applyMimePolicy on gated-by-mime placements and allows supported MIME types", () => {
    const p = PLACEMENT_HYPOTHESES.get("compact-archive")!;
    const r = enforceMimeGate(p, {
      mimeType: "text/plain",
      sizeBytes: 1024,
    });
    expect(r.allowed).toBe(true);
    expect(r.gate).toBe("gated-by-mime");
    expect(r.decision).toBe("inline");
  });

  it("denies gated-by-mime placements on reject decisions", () => {
    const p = PLACEMENT_HYPOTHESES.get("compact-archive")!;
    const r = enforceMimeGate(p, {
      mimeType: "audio/opus",
      sizeBytes: 1024,
    });
    expect(r.allowed).toBe(false);
    if (r.allowed === false) {
      expect(r.gate).toBe("gated-by-mime");
      expect(r.decision).toBe("reject");
      expect(r.reason).toMatch(/not supported/);
    }
  });

  it("denies gated-by-mime placements when the caller supplies no MIME input", () => {
    const p = PLACEMENT_HYPOTHESES.get("compact-archive")!;
    const r = enforceMimeGate(p);
    expect(r.allowed).toBe(false);
    if (r.allowed === false) {
      expect(r.reason).toMatch(/requires a MIME input/);
    }
  });
});
