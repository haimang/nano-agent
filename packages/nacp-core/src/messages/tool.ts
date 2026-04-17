import { z } from "zod";
import { registerMessageType } from "../envelope.js";

export const ToolCallRequestBodySchema = z.object({
  tool_name: z.string().min(1).max(64),
  tool_input: z.record(z.string(), z.unknown()),
});

export const ToolCallResponseBodySchema = z.object({
  status: z.enum(["ok", "error"]),
  output: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const ToolCallCancelBodySchema = z.object({
  reason: z.string().max(256).optional(),
});

registerMessageType("tool.call.request", ToolCallRequestBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["session"],
});
registerMessageType("tool.call.response", ToolCallResponseBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["capability", "skill"],
});
registerMessageType("tool.call.cancel", ToolCallCancelBodySchema, {
  bodyRequired: false,
  allowedProducerRoles: ["session"],
});

export const ToolBodySchemas = {
  "tool.call.request": ToolCallRequestBodySchema,
  "tool.call.response": ToolCallResponseBodySchema,
  "tool.call.cancel": ToolCallCancelBodySchema,
} as const;
