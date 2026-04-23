/**
 * A8 Phase 1 — workspace truth + path law tests.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORKSPACE_ROOT,
  RESERVED_NAMESPACE_PREFIX,
  isReservedNamespacePath,
  resolveWorkspacePath,
  resolveWorkspacePathOrThrow,
} from "../../src/capabilities/workspace-truth.js";

describe("path law constants", () => {
  it("workspace root defaults to /workspace", () => {
    expect(DEFAULT_WORKSPACE_ROOT).toBe("/workspace");
  });
  it("reserved namespace is /_platform", () => {
    expect(RESERVED_NAMESPACE_PREFIX).toBe("/_platform");
  });
});

describe("resolveWorkspacePath — happy paths", () => {
  it("relative paths resolve under the workspace root", () => {
    expect(resolveWorkspacePath("/workspace", "foo/bar.txt").path).toBe(
      "/workspace/foo/bar.txt",
    );
  });
  it("absolute paths are honoured against the workspace root", () => {
    expect(resolveWorkspacePath("/workspace", "/foo/bar.txt").path).toBe(
      "/foo/bar.txt",
    );
  });
  it("`.` resolves to the workspace root", () => {
    expect(resolveWorkspacePath("/workspace", ".").path).toBe("/workspace");
  });
  it("empty string resolves to the workspace root", () => {
    expect(resolveWorkspacePath("/workspace", "").path).toBe("/workspace");
  });
  it("collapses redundant `.` segments and trailing slashes", () => {
    expect(resolveWorkspacePath("/workspace", "./a/./b/").path).toBe(
      "/workspace/a/b",
    );
  });
  it("`..` pops one segment", () => {
    expect(resolveWorkspacePath("/workspace", "a/b/../c").path).toBe(
      "/workspace/a/c",
    );
  });
});

describe("resolveWorkspacePath — refusals", () => {
  it("flags paths under /_platform as reserved-namespace", () => {
    const r = resolveWorkspacePath("/workspace", "/_platform/secret.json");
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toBe("reserved-namespace");
  });
  it("flags traversal that climbs above the workspace root", () => {
    const r = resolveWorkspacePath("/workspace", "../escape.txt");
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toBe("escapes-workspace-root");
  });
  it("/_platform alone (no suffix) is also reserved", () => {
    const r = resolveWorkspacePath("/workspace", "/_platform");
    expect(r.ok).toBe(false);
    expect(r.error?.reason).toBe("reserved-namespace");
  });
});

describe("resolveWorkspacePathOrThrow", () => {
  it("returns the canonical path on success", () => {
    expect(resolveWorkspacePathOrThrow("/workspace", "a/b")).toBe(
      "/workspace/a/b",
    );
  });
  it("throws with reserved-namespace reason in the message", () => {
    expect(() =>
      resolveWorkspacePathOrThrow("/workspace", "/_platform/x"),
    ).toThrow(/reserved \/_platform namespace/);
  });
  it("throws with the escapes-workspace-root reason", () => {
    expect(() => resolveWorkspacePathOrThrow("/workspace", "../x")).toThrow(
      /escapes workspace root/,
    );
  });
});

describe("isReservedNamespacePath", () => {
  it("matches the prefix and any descendants", () => {
    expect(isReservedNamespacePath("/_platform")).toBe(true);
    expect(isReservedNamespacePath("/_platform/secret.json")).toBe(true);
  });
  it("rejects neighbours that share the leading underscore", () => {
    expect(isReservedNamespacePath("/_platforms")).toBe(false);
    expect(isReservedNamespacePath("/workspace/_platform")).toBe(false);
  });
});
