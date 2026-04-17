import { describe, it, expect } from "vitest";
import {
  resolveErrorDefinition,
  listErrorDefinitions,
  registerErrorDefinition,
  isRetryableCategory,
  mapErrorCategoryToStatus,
  type NacpErrorCategory,
} from "../src/error-registry.js";

describe("NACP_ERROR_REGISTRY", () => {
  it("has at least 18 built-in error codes", () => {
    expect(listErrorDefinitions().length).toBeGreaterThanOrEqual(18);
  });

  it("resolves every built-in code", () => {
    const codes = [
      "NACP_VALIDATION_FAILED",
      "NACP_UNKNOWN_MESSAGE_TYPE",
      "NACP_SIZE_EXCEEDED",
      "NACP_VERSION_INCOMPATIBLE",
      "NACP_DEADLINE_EXCEEDED",
      "NACP_IDEMPOTENCY_CONFLICT",
      "NACP_CAPABILITY_DENIED",
      "NACP_RATE_LIMITED",
      "NACP_BINDING_UNAVAILABLE",
      "NACP_HMAC_INVALID",
      "NACP_TIMESTAMP_SKEW",
      "NACP_TENANT_MISMATCH",
      "NACP_TENANT_BOUNDARY_VIOLATION",
      "NACP_TENANT_QUOTA_EXCEEDED",
      "NACP_DELEGATION_INVALID",
      "NACP_STATE_MACHINE_VIOLATION",
      "NACP_REPLY_TO_CLOSED",
      "NACP_PRODUCER_ROLE_MISMATCH",
      "NACP_REPLAY_OUT_OF_RANGE",
    ];
    for (const code of codes) {
      const def = resolveErrorDefinition(code);
      expect(def, `missing definition for ${code}`).not.toBeNull();
      expect(def!.code).toBe(code);
    }
  });

  it("returns null for unknown code", () => {
    expect(resolveErrorDefinition("UNKNOWN_CODE")).toBeNull();
  });

  it("allows runtime registration of new codes", () => {
    registerErrorDefinition({
      code: "CUSTOM_TEST_ERROR",
      category: "transient",
      retryable: true,
      message: "test error",
    });
    const def = resolveErrorDefinition("CUSTOM_TEST_ERROR");
    expect(def).not.toBeNull();
    expect(def!.retryable).toBe(true);
  });
});

describe("isRetryableCategory", () => {
  const retryable: NacpErrorCategory[] = ["transient", "dependency", "quota"];
  const nonRetryable: NacpErrorCategory[] = [
    "validation",
    "permanent",
    "security",
    "conflict",
  ];

  for (const cat of retryable) {
    it(`${cat} is retryable`, () => {
      expect(isRetryableCategory(cat)).toBe(true);
    });
  }
  for (const cat of nonRetryable) {
    it(`${cat} is not retryable`, () => {
      expect(isRetryableCategory(cat)).toBe(false);
    });
  }
});

describe("mapErrorCategoryToStatus", () => {
  it("maps validation → 400", () => expect(mapErrorCategoryToStatus("validation")).toBe(400));
  it("maps security → 403", () => expect(mapErrorCategoryToStatus("security")).toBe(403));
  it("maps quota → 429", () => expect(mapErrorCategoryToStatus("quota")).toBe(429));
  it("maps conflict → 409", () => expect(mapErrorCategoryToStatus("conflict")).toBe(409));
  it("maps transient → 503", () => expect(mapErrorCategoryToStatus("transient")).toBe(503));
  it("maps dependency → 503", () => expect(mapErrorCategoryToStatus("dependency")).toBe(503));
  it("maps permanent → 500", () => expect(mapErrorCategoryToStatus("permanent")).toBe(500));
});
