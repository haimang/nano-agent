/**
 * A9 Phase 3 — `ts-exec` honest partial baseline (Q22).
 *
 * Covers:
 *   1. valid code → partial output line carries the disclosure marker
 *      and the exact length acknowledgement
 *   2. empty code → explicit error
 *   3. code over the 64 KiB cap → explicit error
 *   4. syntax-error code → typed `ts-exec-syntax-error` marker so the
 *      LLM distinguishes "your code is bad" from "execution is partial"
 */

import { describe, it, expect } from "vitest";
import {
  createExecHandlers,
  TS_EXEC_PARTIAL_NOTE,
  TS_EXEC_SYNTAX_ERROR_NOTE,
  TS_EXEC_MAX_CODE_BYTES,
} from "../../src/capabilities/exec.js";

describe("ts-exec — honest partial (A9 Q22)", () => {
  const handlers = createExecHandlers();

  it("acknowledges valid code with the partial disclosure marker + length", async () => {
    const code = "const x = 1 + 2; x";
    const res = (await handlers.get("ts-exec")!({ code })) as { output: string };
    expect(res.output).toContain(TS_EXEC_PARTIAL_NOTE);
    expect(res.output).toContain(`${code.length}`);
    // The marker explicitly says execution is not connected — guarding
    // against a future regression that silently starts executing code.
    expect(res.output).toContain("not yet connected");
  });

  it("rejects empty code", async () => {
    await expect(handlers.get("ts-exec")!({ code: "" })).rejects.toThrow(
      /no code provided/,
    );
  });

  it("rejects code above the code-length cap", async () => {
    const big = "a".repeat(TS_EXEC_MAX_CODE_BYTES + 1);
    await expect(handlers.get("ts-exec")!({ code: big })).rejects.toThrow(
      /exceeds cap/,
    );
  });

  it("rejects code with a syntax error using the typed marker", async () => {
    await expect(
      handlers.get("ts-exec")!({ code: "const x = ;" }),
    ).rejects.toThrow(new RegExp(TS_EXEC_SYNTAX_ERROR_NOTE));
  });

  it("partial output never leaks the actual code body back to the caller", async () => {
    const secret = "const SECRET = 'plaintext-secret-value'; SECRET";
    const res = (await handlers.get("ts-exec")!({ code: secret })) as {
      output: string;
    };
    expect(res.output).not.toContain("plaintext-secret-value");
  });
});
