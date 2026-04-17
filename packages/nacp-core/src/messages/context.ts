import { z } from "zod";
import { registerMessageType } from "../envelope.js";
import { NacpRefSchema } from "../envelope.js";

export const ContextCompactRequestBodySchema = z.object({
  history_ref: NacpRefSchema,
  target_token_budget: z.number().int().min(1),
});

export const ContextCompactResponseBodySchema = z.object({
  status: z.enum(["ok", "error"]),
  summary_ref: NacpRefSchema.optional(),
  tokens_before: z.number().int().min(0).optional(),
  tokens_after: z.number().int().min(0).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

registerMessageType("context.compact.request", ContextCompactRequestBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["session", "platform"],
});
registerMessageType("context.compact.response", ContextCompactResponseBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["capability"],
});

export const ContextBodySchemas = {
  "context.compact.request": ContextCompactRequestBodySchema,
  "context.compact.response": ContextCompactResponseBodySchema,
} as const;
