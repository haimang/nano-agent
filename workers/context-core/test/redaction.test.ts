/**
 * Tests for preview / redaction helpers. Verifies that the local
 * `redactPayload()` matches `@haimang/nacp-session`'s behaviour and
 * that `redactForClient()` properly uses it for JSON previews.
 */

import { describe, it, expect } from "vitest";
import { redactPayload as sessionRedactPayload } from "../../../packages/nacp-session/src/redaction.js";
import {
  buildPreview,
  redactArtifactPayload,
  redactForClient,
  redactPayload,
} from "../src/redaction.js";
import type {
  ArtifactMetadata,
  ArtifactRef,
} from "@nano-agent/workspace-context-artifacts";

function makeRef(): ArtifactRef {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: "tenants/team-1/artifacts/file/x",
    role: "attachment",
    artifactKind: "file",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

describe("redactPayload alignment with @haimang/nacp-session", () => {
  it("produces the same output as the nacp-session version for the same inputs", () => {
    const payload = { a: { b: "secret" }, c: "public" };
    const hints = ["a.b"];
    expect(redactPayload(payload, hints)).toEqual(sessionRedactPayload(payload, hints));
  });

  it("is a no-op when hints is empty", () => {
    const payload = { a: 1 };
    expect(redactPayload(payload, [])).toEqual(payload);
  });

  it("handles missing paths gracefully", () => {
    const payload = { a: { b: "secret" } };
    expect(redactPayload(payload, ["a.missing"])).toEqual(payload);
  });

  it("deeply nested paths get scrubbed", () => {
    const payload = { outer: { middle: { inner: "secret" } } };
    const out = redactPayload(payload, ["outer.middle.inner"]);
    expect((out.outer as Record<string, Record<string, unknown>>).middle.inner).toBe("[redacted]");
  });
});

describe("redactForClient", () => {
  it("returns refOnly=true for internal-audience artifacts", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "internal",
      previewText: "secret",
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    expect(redactForClient(meta)).toEqual({ refOnly: true });
  });

  it("returns refOnly=true when previewText is missing", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "client-visible",
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    expect(redactForClient(meta)).toEqual({ refOnly: true });
  });

  it("returns the preview unchanged for plain-text previews with no hints", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "client-visible",
      previewText: "hello world",
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    expect(redactForClient(meta)).toEqual({ previewText: "hello world", refOnly: false });
  });

  it("scrubs JSON previews through redactPayload when hints are supplied", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "client-visible",
      previewText: JSON.stringify({ secret: "top", public: "ok" }),
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    const result = redactForClient(meta, { redactionHints: ["secret"] });
    expect(result.refOnly).toBe(false);
    const parsed = JSON.parse(result.previewText!);
    expect(parsed.secret).toBe("[redacted]");
    expect(parsed.public).toBe("ok");
  });

  it("honours a caller-supplied payloadRedactor (e.g. nacp-session's redactPayload)", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "client-visible",
      previewText: JSON.stringify({ nested: { secret: "s" } }),
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    const result = redactForClient(meta, {
      redactionHints: ["nested.secret"],
      payloadRedactor: sessionRedactPayload,
    });
    const parsed = JSON.parse(result.previewText!);
    expect(parsed.nested.secret).toBe("[redacted]");
  });

  it("leaves plain-text previews alone even when hints are supplied", () => {
    const meta: ArtifactMetadata = {
      ref: makeRef(),
      audience: "client-visible",
      previewText: "not JSON — just text",
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    const result = redactForClient(meta, { redactionHints: ["anything"] });
    expect(result.previewText).toBe("not JSON — just text");
  });
});

describe("buildPreview", () => {
  it("returns short content unchanged", () => {
    expect(buildPreview("short", 200)).toBe("short");
  });

  it("truncates long content and appends ellipsis", () => {
    const result = buildPreview("x".repeat(400), 200);
    expect(result.length).toBe(203);
    expect(result.endsWith("...")).toBe(true);
  });

  it("defaults to a 200-character limit", () => {
    const result = buildPreview("x".repeat(500));
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("redactArtifactPayload", () => {
  it("delegates to the local redactPayload by default", () => {
    const payload = { secret: "top" };
    expect(redactArtifactPayload(payload, ["secret"])).toEqual({ secret: "[redacted]" });
  });

  it("accepts a caller-supplied redactor (e.g. nacp-session's redactPayload)", () => {
    const payload = { secret: "top" };
    expect(redactArtifactPayload(payload, ["secret"], sessionRedactPayload)).toEqual({
      secret: "[redacted]",
    });
  });
});
