import { z } from "zod";
import { registerMessageType, NacpRefSchema } from "../envelope.js";
import { NacpErrorSchema } from "../error-registry.js";

export const SystemErrorBodySchema = z.object({
  error: NacpErrorSchema,
  context: z.record(z.string(), z.unknown()).optional(),
});

export const AuditRecordBodySchema = z.object({
  event_kind: z.string().min(1).max(64),
  ref: NacpRefSchema.optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

registerMessageType("system.error", SystemErrorBodySchema, {
  bodyRequired: true,
  // system.error is the catch-all — any producer role may emit it
});
registerMessageType("audit.record", AuditRecordBodySchema, {
  bodyRequired: true,
  // audit.record is also open to all roles
});

export const SystemBodySchemas = {
  "system.error": SystemErrorBodySchema,
  "audit.record": AuditRecordBodySchema,
} as const;
