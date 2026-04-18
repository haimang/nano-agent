/**
 * Exec Capability Handler — A9 Phase 3 `ts-exec` honest partial.
 *
 * Q22 bindings (docs/action-plan/after-skeleton/AX-QNA.md):
 *   - v1 `ts-exec` does NOT execute code. It performs a lightweight
 *     syntax validation pass + code-length acknowledgement and emits a
 *     fixed disclosure marker so prompt / inventory / tests can
 *     grep-check that the partial contract is still honoured.
 *   - The execution substrate upgrade path is reserved for a future
 *     remote tool-runner reached via `ServiceBindingTarget`. The
 *     `tool.call.*` message family and the capability schema stay the
 *     same so that swap is free of churn.
 *
 * Output shape:
 *   `[ts-exec] partial: validated N chars (ts-exec-partial-no-execution;
 *    execution not yet connected — use workspace API or wait for the
 *    future remote tool-runner)`
 *
 * Error shape:
 *   Caller-supplied code with a syntax error is rejected with a
 *   `ts-exec-syntax-error` marker and the underlying message. This
 *   lets the LLM distinguish "your code is not valid" from "execution
 *   is intentionally partial" instead of seeing one opaque string.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

export const TS_EXEC_PARTIAL_NOTE = "ts-exec-partial-no-execution";
export const TS_EXEC_SYNTAX_ERROR_NOTE = "ts-exec-syntax-error";
export const TS_EXEC_MAX_CODE_BYTES = 64 * 1024;
export const TS_EXEC_OUTPUT_CAP = 2 * 1024;

interface ExecInput {
  code?: string;
}

function validateSyntax(code: string): string | null {
  try {
    // Parse-only: `new Function(body)` compiles without executing the
    // body. Compilation covers the classic surface (declarations,
    // statements, expressions) which is what an LLM is likely to
    // produce; it does NOT understand TypeScript type annotations, so
    // callers are expected to emit plain JS today.
    // eslint-disable-next-line @typescript-eslint/no-new-func, no-new-func
    new Function(code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Create the exec capability handler.
 *
 * Returns a Map with a "ts-exec" handler that enforces the Q22
 * honest-partial contract.
 */
export function createExecHandlers(): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();

  handlers.set("ts-exec", async (input) => {
    const { code = "" } = (input ?? {}) as ExecInput;

    if (!code) {
      throw new Error("ts-exec: no code provided");
    }

    if (code.length > TS_EXEC_MAX_CODE_BYTES) {
      throw new Error(
        `ts-exec: code length ${code.length} exceeds cap ${TS_EXEC_MAX_CODE_BYTES}`,
      );
    }

    const syntaxError = validateSyntax(code);
    if (syntaxError) {
      throw new Error(
        `ts-exec: syntax error (${TS_EXEC_SYNTAX_ERROR_NOTE}): ${syntaxError}`,
      );
    }

    return {
      output:
        `[ts-exec] partial: validated ${code.length} chars (${TS_EXEC_PARTIAL_NOTE}; ` +
        `execution not yet connected — use workspace API (cat/rg/write) or wait for ` +
        `the future remote tool-runner)`,
    };
  });

  return handlers;
}
