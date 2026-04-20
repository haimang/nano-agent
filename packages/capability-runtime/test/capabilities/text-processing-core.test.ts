/**
 * B3 wave 1 — text-processing core handlers (wc / head / tail / jq /
 * sed / awk).
 *
 * Each test uses a tiny in-memory `WorkspaceFsLike` fixture so the
 * package stays decoupled from `workspace-context-artifacts`.
 */

import { describe, it, expect } from "vitest";
import {
  createTextProcessingHandlers,
  TEXT_OUTPUT_MAX_BYTES,
  TEXT_OUTPUT_TRUNCATED_NOTE,
  SED_UNSUPPORTED_NOTE,
  AWK_UNSUPPORTED_NOTE,
  JQ_UNSUPPORTED_NOTE,
} from "../../src/capabilities/text-processing.js";

function makeWorkspace(seed: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    namespace: {
      async readFile(path: unknown) {
        return files.get(String(path)) ?? null;
      },
      async writeFile(path: unknown, content: string) {
        files.set(String(path), content);
      },
      async listDir() {
        return [];
      },
      async deleteFile(path: unknown) {
        return files.delete(String(path));
      },
    },
  };
}

function build(seed: Record<string, string> = {}) {
  const ws = makeWorkspace(seed);
  return {
    ws,
    handlers: createTextProcessingHandlers({
      workspacePath: "/workspace",
      namespace: ws.namespace,
    }),
  };
}

describe("text-processing — wc", () => {
  it("emits POSIX-style 'lines words bytes path' for a small file", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "alpha beta gamma\nlorem ipsum dolor\nsit amet\n",
    });
    const out = await handlers.get("wc")!({ path: "a.txt" });
    // 16 + 1 + 17 + 1 + 8 + 1 = 44 bytes (3 newlines, 8 whitespace-separated words)
    expect(out.output).toBe("3 8 44 /workspace/a.txt");
  });

  it("counts UTF-8 bytes, not UTF-16 code units", async () => {
    const { handlers } = build({
      "/workspace/emoji.txt": "Hello \u{1F600}",
    });
    const out = await handlers.get("wc")!({ path: "emoji.txt" });
    // "Hello " = 6 bytes; emoji = 4 bytes → 10 bytes total, 0 newlines, 2 words
    expect(out.output).toBe("0 2 10 /workspace/emoji.txt");
  });

  it("rejects empty path with deterministic error", async () => {
    const { handlers } = build();
    await expect(handlers.get("wc")!({ path: "" })).rejects.toThrow(
      "wc: no file path provided",
    );
  });

  it("rejects /_platform/** reserved namespace (F07 contract preserved)", async () => {
    const { handlers } = build();
    await expect(handlers.get("wc")!({ path: "/_platform/secret" })).rejects.toThrow(
      "/_platform",
    );
  });

  it("returns deterministic 'not connected' stub when no namespace is supplied", async () => {
    const handlers = createTextProcessingHandlers({ workspacePath: "/workspace" });
    const out = await handlers.get("wc")!({ path: "a.txt" });
    expect(out.output).toContain("not connected");
  });
});

describe("text-processing — head", () => {
  it("returns first 10 lines by default", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const { handlers } = build({ "/workspace/x.txt": lines.join("\n") });
    const out = await handlers.get("head")!({ path: "x.txt" });
    expect(out.output).toBe(lines.slice(0, 10).join("\n"));
  });

  it("respects structured `lines` count", async () => {
    const { handlers } = build({
      "/workspace/x.txt": "a\nb\nc\nd\ne\n",
    });
    const out = await handlers.get("head")!({ path: "x.txt", lines: 2 });
    expect(out.output).toBe("a\nb");
  });

  it("respects structured `bytes` count and stays UTF-8 boundary safe", async () => {
    const { handlers } = build({ "/workspace/x.txt": "Hello \u{1F600} world" });
    const out = await handlers.get("head")!({ path: "x.txt", bytes: 8 });
    // 6 ASCII bytes + the emoji's first byte falls inside its 4-byte
    // sequence → walked back, leaving "Hello " (6 bytes).
    expect(out.output).toBe("Hello ");
  });

  it("returns empty string when n=0", async () => {
    const { handlers } = build({ "/workspace/x.txt": "a\nb\n" });
    const out = await handlers.get("head")!({ path: "x.txt", lines: 0 });
    expect(out.output).toBe("");
  });
});

describe("text-processing — tail", () => {
  it("returns last 10 lines by default", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const { handlers } = build({ "/workspace/x.txt": lines.join("\n") + "\n" });
    const out = await handlers.get("tail")!({ path: "x.txt" });
    expect(out.output).toBe(lines.slice(-10).join("\n") + "\n");
  });

  it("respects structured `lines` count", async () => {
    const { handlers } = build({ "/workspace/x.txt": "a\nb\nc\nd\ne\n" });
    const out = await handlers.get("tail")!({ path: "x.txt", lines: 2 });
    expect(out.output).toBe("d\ne\n");
  });

  it("respects structured `bytes` count and stays UTF-8 boundary safe", async () => {
    const { handlers } = build({ "/workspace/x.txt": "Hello \u{1F600} world" });
    const out = await handlers.get("tail")!({ path: "x.txt", bytes: 6 });
    // Last 6 bytes = " world" (single ASCII; trims forward off the
    // emoji continuation if needed).
    expect(out.output).toBe(" world");
  });
});

describe("text-processing — jq", () => {
  it("supports identity '.'", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ a: 1, b: [2, 3] }),
    });
    const out = await handlers.get("jq")!({ query: ".", path: "data.json" });
    expect(JSON.parse(out.output)).toEqual({ a: 1, b: [2, 3] });
  });

  it("supports nested field access", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ a: { b: { c: "deep" } } }),
    });
    const out = await handlers.get("jq")!({ query: ".a.b.c", path: "data.json" });
    expect(out.output).toBe("\"deep\"");
  });

  it("supports array index '.array[N]'", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ items: [10, 20, 30] }),
    });
    const out = await handlers.get("jq")!({ query: ".items[1]", path: "data.json" });
    expect(out.output).toBe("20");
  });

  it("supports iterate '.array[]'", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ items: ["a", "b", "c"] }),
    });
    const out = await handlers.get("jq")!({ query: ".items[]", path: "data.json" });
    expect(out.output).toBe('"a"\n"b"\n"c"');
  });

  it("supports 'keys' on an object", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ b: 1, a: 1, c: 1 }),
    });
    const out = await handlers.get("jq")!({ query: "keys", path: "data.json" });
    expect(out.output).toBe('"a"\n"b"\n"c"');
  });

  it("supports 'length'", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ items: [1, 2, 3, 4] }),
    });
    const out = await handlers.get("jq")!({ query: ".items | length", path: "data.json" }).catch((e) => e);
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toContain(JQ_UNSUPPORTED_NOTE);

    const out2 = await handlers.get("jq")!({ query: "length", path: "data.json" });
    expect(out2.output).toBe("1");
  });

  it("rejects unsupported query forms with JQ_UNSUPPORTED_NOTE marker", async () => {
    const { handlers } = build({
      "/workspace/data.json": JSON.stringify({ a: 1 }),
    });
    await expect(
      handlers.get("jq")!({ query: ".a + 1", path: "data.json" }),
    ).rejects.toThrow(JQ_UNSUPPORTED_NOTE);
  });

  it("rejects invalid JSON with deterministic error mentioning the path", async () => {
    const { handlers } = build({ "/workspace/bad.json": "{not-json" });
    await expect(
      handlers.get("jq")!({ query: ".", path: "bad.json" }),
    ).rejects.toThrow(/invalid JSON in \/workspace\/bad.json/);
  });
});

describe("text-processing — sed", () => {
  it("supports a single 's/.../.../' substitution (replaces first match)", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hello hello world" });
    const out = await handlers.get("sed")!({
      expression: "s/hello/HI/",
      path: "x.txt",
    });
    expect(out.output).toBe("HI hello world");
  });

  it("supports the 'g' flag", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hello hello world" });
    const out = await handlers.get("sed")!({
      expression: "s/hello/HI/g",
      path: "x.txt",
    });
    expect(out.output).toBe("HI HI world");
  });

  it("supports the 'i' flag", async () => {
    const { handlers } = build({ "/workspace/x.txt": "Hello WORLD" });
    const out = await handlers.get("sed")!({
      expression: "s/hello/HI/i",
      path: "x.txt",
    });
    expect(out.output).toBe("HI WORLD");
  });

  it("rejects unsupported sed commands (e.g. 'd') with marker", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hi" });
    await expect(
      handlers.get("sed")!({ expression: "1d", path: "x.txt" }),
    ).rejects.toThrow(SED_UNSUPPORTED_NOTE);
  });

  it("rejects unsupported flags with marker", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hi" });
    await expect(
      handlers.get("sed")!({ expression: "s/a/b/x", path: "x.txt" }),
    ).rejects.toThrow(SED_UNSUPPORTED_NOTE);
  });
});

describe("text-processing — awk", () => {
  it("supports '{ print $N }' for column extraction", async () => {
    const { handlers } = build({
      "/workspace/data.txt": "alice 30 NYC\nbob 25 LA\n",
    });
    const out = await handlers.get("awk")!({
      program: "{ print $1 }",
      path: "data.txt",
    });
    expect(out.output).toBe("alice\nbob\n");
  });

  it("supports '{ print $1, $3 }' multi-field", async () => {
    const { handlers } = build({
      "/workspace/data.txt": "alice 30 NYC\nbob 25 LA\n",
    });
    const out = await handlers.get("awk")!({
      program: "{ print $1, $3 }",
      path: "data.txt",
    });
    expect(out.output).toBe("alice NYC\nbob LA\n");
  });

  it("supports 'NR == K { print }' line selection", async () => {
    const { handlers } = build({
      "/workspace/data.txt": "first\nsecond\nthird\n",
    });
    const out = await handlers.get("awk")!({
      program: "NR == 2 { print }",
      path: "data.txt",
    });
    expect(out.output).toBe("second\n");
  });

  it("supports '/PATTERN/ { print }' regex selection", async () => {
    const { handlers } = build({
      "/workspace/data.txt": "apple\nbanana\napricot\n",
    });
    const out = await handlers.get("awk")!({
      program: "/^ap/ { print }",
      path: "data.txt",
    });
    expect(out.output).toBe("apple\napricot\n");
  });

  it("rejects BEGIN/END blocks with AWK_UNSUPPORTED_NOTE", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hi" });
    await expect(
      handlers.get("awk")!({
        program: "BEGIN { print } { print }",
        path: "x.txt",
      }),
    ).rejects.toThrow(AWK_UNSUPPORTED_NOTE);
  });

  it("rejects multi-statement actions", async () => {
    const { handlers } = build({ "/workspace/x.txt": "hi" });
    await expect(
      handlers.get("awk")!({
        program: "{ x = $1; print x }",
        path: "x.txt",
      }),
    ).rejects.toThrow(AWK_UNSUPPORTED_NOTE);
  });
});

describe("text-processing — output cap", () => {
  it("truncates output above TEXT_OUTPUT_MAX_BYTES with the disclosure marker", async () => {
    // Build a file whose post-processing output will exceed the cap.
    // A simple identity 'sed s/X/X/' on a > 64 KiB body is sufficient.
    const big = "x".repeat(TEXT_OUTPUT_MAX_BYTES + 1024);
    const { handlers } = build({ "/workspace/big.txt": big });
    const out = await handlers.get("sed")!({
      expression: "s/y/y/",
      path: "big.txt",
    });
    expect(out.output).toContain(TEXT_OUTPUT_TRUNCATED_NOTE);
    expect(out.output.length).toBeGreaterThan(TEXT_OUTPUT_MAX_BYTES);
    // The actual capped content portion must be <= cap.
    const splitIdx = out.output.indexOf(`\n[${TEXT_OUTPUT_TRUNCATED_NOTE}`);
    const body = out.output.slice(0, splitIdx);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      TEXT_OUTPUT_MAX_BYTES,
    );
  });
});
