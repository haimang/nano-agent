/**
 * Storage Topology — Typed Error Hierarchy Tests
 *
 * Verifies the error shape contract introduced in v2.0.0 (B2 phase).
 */

import { describe, it, expect } from "vitest";
import {
  StorageError,
  ValueTooLargeError,
  CursorRequiredError,
  StorageNotConnectedError,
} from "../../src/errors.js";

describe("storage errors hierarchy", () => {
  it("StorageError carries optional hint", () => {
    const err = new StorageError("base failure", "do this instead");
    expect(err.name).toBe("StorageError");
    expect(err.message).toBe("base failure");
    expect(err.hint).toBe("do this instead");
    expect(err).toBeInstanceOf(Error);
  });

  it("ValueTooLargeError exposes bytes / cap / adapter and inherits from StorageError", () => {
    const err = new ValueTooLargeError(2_000_000, 1_048_576, "do");
    expect(err).toBeInstanceOf(StorageError);
    expect(err.name).toBe("ValueTooLargeError");
    expect(err.bytes).toBe(2_000_000);
    expect(err.cap).toBe(1_048_576);
    expect(err.adapter).toBe("do");
    expect(err.message).toContain("2000000");
    expect(err.message).toContain("1048576");
    expect(err.message).toContain("do");
    expect(err.hint).toContain("R2");
  });

  it("CursorRequiredError exposes prefix / returnedCount and inherits from StorageError", () => {
    const err = new CursorRequiredError("tenants/t/x/", 20);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.name).toBe("CursorRequiredError");
    expect(err.prefix).toBe("tenants/t/x/");
    expect(err.returnedCount).toBe(20);
    expect(err.message).toContain("tenants/t/x/");
    expect(err.message).toContain("20");
    expect(err.message).toContain("truncated=true");
  });

  it("StorageNotConnectedError exposes operation / adapter and inherits from StorageError", () => {
    const err = new StorageNotConnectedError("doPut", "NullStorageAdapter");
    expect(err).toBeInstanceOf(StorageError);
    expect(err.name).toBe("StorageNotConnectedError");
    expect(err.operation).toBe("doPut");
    expect(err.adapter).toBe("NullStorageAdapter");
    expect(err.message).toBe("NullStorageAdapter: doPut not connected");
  });
});
