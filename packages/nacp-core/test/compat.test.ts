import { describe, it, expect } from "vitest";
import { migrate_noop, migrate_v1_0_to_v1_1 } from "../src/compat/migrations.js";

describe("compat/migrations", () => {
  it("migrate_noop passes through input unchanged", () => {
    const input = { header: { message_type: "test" } };
    expect(migrate_noop(input)).toBe(input);
  });

  it("migrate_noop handles null", () => {
    expect(migrate_noop(null)).toBeNull();
  });

  it("migrate_v1_0_to_v1_1 throws NotImplemented", () => {
    expect(() => migrate_v1_0_to_v1_1({})).toThrow("not yet implemented");
  });
});
