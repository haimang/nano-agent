/**
 * Tests for B6 upgrade of `NanoSessionDO.defaultEvalRecords` to a
 * `BoundedEvalSink` (dedup + overflow disclosure).
 *
 * Locks:
 *   - `getDefaultEvalRecords()` still returns a readonly snapshot (API
 *     unchanged for deploy-smoke tests that already depended on it).
 *   - `getDefaultEvalDisclosure()` + `getDefaultEvalStats()` are newly
 *     available and accurate.
 *   - Records that carry a `messageUuid` (on any of the shapes
 *     `extractMessageUuid` understands) are hard-deduped.
 *   - Capacity overflow is NOT silent — produces disclosure records.
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../../src/host/do/nano-session-do.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

function makeDO(): NanoSessionDO {
  return new NanoSessionDO({}, { TEAM_UUID: "team-xyz", SESSION_UUID });
}

function emit(instance: NanoSessionDO, record: unknown): void {
  // The default sink is wired onto `subsystems.eval.emit`. Grab the
  // composed handle and invoke it directly so we exercise exactly the
  // same path that production code would.
  const subsystems = instance.getSubsystems() as {
    eval?: { emit?: (r: unknown) => void };
  };
  subsystems.eval?.emit?.(record);
}

describe("NanoSessionDO default eval sink — B6 dedup", () => {
  it("hard-dedups records carrying `{ messageUuid }` via default sink", () => {
    const instance = makeDO();
    const uuid = "22222222-2222-4222-8222-222222222222";

    emit(instance, { messageUuid: uuid, body: { k: "v" } });
    emit(instance, { messageUuid: uuid, body: { k: "v2" } });
    emit(instance, { messageUuid: uuid, body: { k: "v3" } });

    expect(instance.getDefaultEvalRecords()).toHaveLength(1);
    const stats = instance.getDefaultEvalStats();
    expect(stats.dedupEligible).toBe(1);
    expect(stats.duplicateDropCount).toBe(2);
    expect(stats.capacityOverflowCount).toBe(0);
  });

  it("hard-dedups records carrying `{ envelope: { header: { message_uuid } } }` (NACP envelope shape)", () => {
    const instance = makeDO();
    const frame = {
      envelope: {
        header: { message_uuid: "33333333-3333-4333-8333-333333333333" },
      },
      payload: "X",
    };
    emit(instance, frame);
    emit(instance, frame);

    expect(instance.getDefaultEvalRecords()).toHaveLength(1);
    expect(instance.getDefaultEvalStats().duplicateDropCount).toBe(1);
  });

  it("records without a messageUuid are stored unconditionally (backward compat)", () => {
    const instance = makeDO();
    emit(instance, { bareRecord: 1 });
    emit(instance, { bareRecord: 1 });
    emit(instance, { bareRecord: 1 });

    expect(instance.getDefaultEvalRecords()).toHaveLength(3);
    const stats = instance.getDefaultEvalStats();
    expect(stats.missingMessageUuid).toBe(3);
    expect(stats.duplicateDropCount).toBe(0);
  });

  it("duplicate drop emits a disclosure record", () => {
    const instance = makeDO();
    const uuid = "44444444-4444-4444-8444-444444444444";
    emit(instance, { messageUuid: uuid });
    emit(instance, { messageUuid: uuid });

    const disclosures = instance.getDefaultEvalDisclosure();
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.reason).toBe("duplicate-message");
    expect(disclosures[0]?.messageUuid).toBe(uuid);
  });

  it("capacity overflow is NOT silent — disclosure records appear", () => {
    // The default sink capacity is 1024. Sending 1025 + N records should
    // produce N disclosures. Use a small burst past the cap.
    const instance = makeDO();
    const TARGET = 1030;
    for (let i = 0; i < TARGET; i++) {
      emit(instance, { idx: i });
    }

    const records = instance.getDefaultEvalRecords();
    expect(records).toHaveLength(1024);
    const stats = instance.getDefaultEvalStats();
    // Exactly TARGET - capacity = 6 evictions.
    expect(stats.capacityOverflowCount).toBe(6);
    expect(instance.getDefaultEvalDisclosure().length).toBeGreaterThan(0);
    // Each disclosure is for 1 record (single emit at a time).
    expect(
      instance
        .getDefaultEvalDisclosure()
        .every((d) => d.reason === "capacity-exceeded" && d.droppedCount === 1),
    ).toBe(true);
  });
});
