import { z } from "zod";
import { registerMessageType } from "../envelope.js";

export const HookEmitBodySchema = z.object({
  event_name: z.string().min(1).max(64),
  event_payload: z.record(z.string(), z.unknown()),
});

export const HookOutcomeBodySchema = z.object({
  ok: z.boolean(),
  block: z.object({ reason: z.string() }).optional(),
  updated_input: z.unknown().optional(),
  additional_context: z.string().max(8192).optional(),
  stop: z.boolean().optional(),
  diagnostics: z.string().optional(),
});

registerMessageType("hook.emit", HookEmitBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["session", "hook"],
});
registerMessageType("hook.outcome", HookOutcomeBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["hook"],
});

export const HookBodySchemas = {
  "hook.emit": HookEmitBodySchema,
  "hook.outcome": HookOutcomeBodySchema,
} as const;
