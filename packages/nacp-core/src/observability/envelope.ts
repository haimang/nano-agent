/**
 * NACP Observability Envelope.
 *
 * Carries alerts / metrics / traces emitted by a worker on an out-of-band
 * channel (not over the normal message queue). This is NOT where request-
 * scoped trace events live — those belong to `@nano-agent/eval-observability`.
 *
 * A3 Phase 1 trace law (AX-QNA Q6 + Q7):
 *   - `NacpAlertPayload.trace_uuid` is only allowed to be omitted when
 *     `scope === "platform"`. Any `request` / `session` / `turn` scoped
 *     alert MUST carry a `trace_uuid`; the schema enforces this via refine().
 *   - `session_uuid` / `turn_uuid` are optional tracking hints — helpful for
 *     attribution but not a substitute for `trace_uuid`.
 *
 * Pattern inspired by SMCP's `ObservabilityEnvelopeSchema`
 * (`context/smcp/src/runtime/observability.ts`).
 */

import { z } from "zod";

export const NacpAlertSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

/**
 * Alert scope — decides whether `trace_uuid` may be omitted.
 *
 *   - `platform`   : cross-tenant platform-level alert (queue backpressure,
 *                    Cloudflare degraded, secret rotation). May omit
 *                    `trace_uuid` because no single trace owns it.
 *   - `request`    : alert tied to a specific accepted request.
 *   - `session`    : alert tied to a session but not a specific request.
 *   - `turn`       : alert tied to a specific turn.
 *
 * `request` / `session` / `turn` alerts MUST carry `trace_uuid`.
 */
export const NacpAlertScopeSchema = z.enum([
  "platform",
  "request",
  "session",
  "turn",
]);
export type NacpAlertScope = z.infer<typeof NacpAlertScopeSchema>;

export const NacpAlertPayloadSchema = z
  .object({
    alert_uuid: z.string().uuid(),
    team_uuid: z.string().min(1),
    scope: NacpAlertScopeSchema.default("platform"),
    trace_uuid: z.string().uuid().optional(),
    session_uuid: z.string().uuid().optional(),
    turn_uuid: z.string().uuid().optional(),
    severity: NacpAlertSeveritySchema,
    category: z.string().min(1),
    message: z.string().min(1),
    labels: z.record(z.string(), z.string()).default({}),
    emitted_at: z.string().datetime({ offset: true }),
  })
  .refine(
    (p) => p.scope === "platform" || typeof p.trace_uuid === "string",
    {
      message:
        "non-platform alerts must carry trace_uuid (A3 Phase 1 trace law)",
      path: ["trace_uuid"],
    },
  );

export const NacpObservabilityEnvelopeSchema = z.object({
  source_worker: z.string().min(1),
  source_role: z.string().min(1),
  alerts: z.array(NacpAlertPayloadSchema).default([]),
  metrics: z.record(z.string(), z.number()).default({}),
  traces: z.record(z.string(), z.unknown()).default({}),
});

export type NacpAlertSeverity = z.infer<typeof NacpAlertSeveritySchema>;
export type NacpAlertPayload = z.infer<typeof NacpAlertPayloadSchema>;
export type NacpObservabilityEnvelope = z.infer<
  typeof NacpObservabilityEnvelopeSchema
>;
