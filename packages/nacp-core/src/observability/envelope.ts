/**
 * NACP Observability Envelope — v1.1 placeholder.
 *
 * Type-only export. No runtime implementation in v1.0.
 * Inspired by SMCP's ObservabilityEnvelopeSchema (context/smcp/src/runtime/observability.ts).
 */

import { z } from "zod";

export const NacpAlertSeveritySchema = z.enum(["info", "warning", "error", "critical"]);

export const NacpAlertPayloadSchema = z.object({
  alert_uuid: z.string().uuid(),
  team_uuid: z.string().min(1),
  trace_uuid: z.string().uuid().optional(),
  severity: NacpAlertSeveritySchema,
  category: z.string().min(1),
  message: z.string().min(1),
  labels: z.record(z.string(), z.string()).default({}),
  emitted_at: z.string().datetime({ offset: true }),
});

export const NacpObservabilityEnvelopeSchema = z.object({
  source_worker: z.string().min(1),
  source_role: z.string().min(1),
  alerts: z.array(NacpAlertPayloadSchema).default([]),
  metrics: z.record(z.string(), z.number()).default({}),
  traces: z.record(z.string(), z.unknown()).default({}),
});

export type NacpAlertSeverity = z.infer<typeof NacpAlertSeveritySchema>;
export type NacpAlertPayload = z.infer<typeof NacpAlertPayloadSchema>;
export type NacpObservabilityEnvelope = z.infer<typeof NacpObservabilityEnvelopeSchema>;
