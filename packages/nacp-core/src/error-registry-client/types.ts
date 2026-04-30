/**
 * @haimang/nacp-core/error-codes-client — type contracts.
 *
 * RHX2 design v0.5 §7.2 F12 (Q-Obs10 owner-answered, candidate a').
 *
 * Sub-path is **runtime-free**: only static types + a static data table.
 * Browsers, the WeChat mini-program runtime, and Node can all import it
 * without pulling in zod or any other nacp-core sub-tree dependencies.
 */

/**
 * 8-class category seen by client code. Maps loosely from the NACP-side
 * 7-class `NacpErrorCategory` enum, with two extra slots that the web
 * `transport.ts` already had ("auth.expired" and "quota.exceeded") so
 * v0.draft-r3 P8-01 can swap-in `getErrorMeta(code)?.category` without
 * breaking the existing `ApiError.kind` external surface.
 */
export type ClientErrorCategory =
  | "auth.expired"
  | "quota.exceeded"
  | "runtime.error"
  | "request.error"
  | "validation.failed"
  | "security.denied"
  | "dependency.unavailable"
  | "conflict.state";

export interface ClientErrorMeta {
  /** Stable string id (kebab-case for facade codes, UPPER_SNAKE for NACP codes). */
  code: string;
  /** Client-side category — what the UI should do. */
  category: ClientErrorCategory;
  /** Standard HTTP status used by the orchestrator-core facade for this code. */
  http_status: number;
  /** Whether retrying with the same input is meaningful. */
  retryable: boolean;
}
