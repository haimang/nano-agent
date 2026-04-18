/**
 * A9 Phase 1 — planner bash-path narrow surface for `curl` and
 * `ts-exec` (Q17 + Q22). The bash argv only carries the minimum shape:
 *   - `curl <url>`                    (no flags, no extra tokens)
 *   - `ts-exec <inline code>`         (no leading `-flag`)
 * Anything richer must travel through the structured capability call.
 */

import { describe, it, expect } from "vitest";
import {
  CURL_BASH_NARROW_NOTE,
  TS_EXEC_BASH_NARROW_NOTE,
  planFromBashCommand,
} from "../src/planner.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";

function makeRegistry() {
  const r = new InMemoryCapabilityRegistry();
  registerMinimalCommands(r);
  return r;
}

describe("planFromBashCommand — curl narrow surface (A9 Q17)", () => {
  it("accepts `curl <url>` and maps to { url }", () => {
    const plan = planFromBashCommand("curl https://example.com", makeRegistry());
    expect(plan?.capabilityName).toBe("curl");
    expect(plan?.input).toEqual({ url: "https://example.com" });
    expect(plan?.executionTarget).toBe("local-ts");
  });

  it("rejects `curl` without a URL", () => {
    expect(() => planFromBashCommand("curl", makeRegistry())).toThrow(
      /URL required/,
    );
  });

  it("rejects flags like `-X POST` with the structured-path redirect marker", () => {
    expect(() =>
      planFromBashCommand("curl -X POST https://example.com", makeRegistry()),
    ).toThrow(new RegExp(CURL_BASH_NARROW_NOTE));
  });

  it("rejects headers like `-H Foo:bar` with the structured-path redirect marker", () => {
    expect(() =>
      planFromBashCommand("curl -H X-Y:z https://example.com", makeRegistry()),
    ).toThrow(new RegExp(CURL_BASH_NARROW_NOTE));
  });

  it("rejects `--data` style long flags", () => {
    expect(() =>
      planFromBashCommand("curl --data hello https://example.com", makeRegistry()),
    ).toThrow(new RegExp(CURL_BASH_NARROW_NOTE));
  });

  it("rejects extra positional tokens after the URL", () => {
    expect(() =>
      planFromBashCommand("curl https://example.com extra", makeRegistry()),
    ).toThrow(new RegExp(CURL_BASH_NARROW_NOTE));
  });

  it("error message names the structured schema fields so callers know where to go", () => {
    try {
      planFromBashCommand("curl -v https://example.com", makeRegistry());
      throw new Error("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/structured tool call/);
      expect(msg).toMatch(/url/);
      expect(msg).toMatch(/method/);
      expect(msg).toMatch(/headers/);
      expect(msg).toMatch(/body/);
      expect(msg).toMatch(/timeoutMs/);
    }
  });
});

describe("planFromBashCommand — ts-exec narrow surface (A9 Q22)", () => {
  it("accepts `ts-exec <inline code>` and maps to { code }", () => {
    const plan = planFromBashCommand("ts-exec console.log(1)", makeRegistry());
    expect(plan?.capabilityName).toBe("ts-exec");
    expect(plan?.input).toEqual({ code: "console.log(1)" });
  });

  it("joins multiple tokens into the code field", () => {
    const plan = planFromBashCommand("ts-exec let x = 1; x + 2", makeRegistry());
    expect(plan?.input).toEqual({ code: "let x = 1; x + 2" });
  });

  it("rejects `-e` style flags that would dress bash up as a richer runner", () => {
    expect(() =>
      planFromBashCommand("ts-exec -e 'x + 1'", makeRegistry()),
    ).toThrow(new RegExp(TS_EXEC_BASH_NARROW_NOTE));
  });

  it("rejects empty `ts-exec`", () => {
    expect(() => planFromBashCommand("ts-exec", makeRegistry())).toThrow(
      /code required/,
    );
  });
});
