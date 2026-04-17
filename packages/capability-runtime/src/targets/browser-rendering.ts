/**
 * Browser Rendering Execution Target — Stub
 *
 * Placeholder for capabilities that require a headless browser (e.g.
 * screenshotting, PDF generation, JS-heavy page scraping). Currently
 * returns `not-connected`; will be implemented once the browser
 * rendering service protocol is defined.
 *
 * Respects AbortSignal for consistent cancel semantics.
 */

import type { CapabilityPlan } from "../types.js";
import type { CapabilityResult } from "../result.js";
import type { TargetHandler } from "../executor.js";

/**
 * BrowserRenderingTarget is a stub that rejects all executions with a
 * `not-connected` error. It exists to reserve the target slot in the
 * executor's target map.
 */
export class BrowserRenderingTarget implements TargetHandler {
  async execute(
    plan: CapabilityPlan,
    signal?: AbortSignal,
  ): Promise<CapabilityResult> {
    if (signal?.aborted) {
      return {
        kind: "cancelled",
        capabilityName: plan.capabilityName,
        requestId: `req-${Date.now()}-br`,
        error: {
          code: "cancelled",
          message: `Capability "${plan.capabilityName}" was cancelled`,
        },
        durationMs: 0,
      };
    }
    return {
      kind: "error",
      capabilityName: plan.capabilityName,
      requestId: `req-${Date.now()}-br`,
      error: {
        code: "not-connected",
        message:
          "browser-rendering target not connected — headless browser execution is not yet available",
      },
      durationMs: 0,
    };
  }
}
