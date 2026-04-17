import { z } from "zod";
import { registerMessageType } from "../envelope.js";

export const SkillInvokeRequestBodySchema = z.object({
  skill_name: z.string().min(1).max(64),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const SkillInvokeResponseBodySchema = z.object({
  status: z.enum(["ok", "error"]),
  result: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

registerMessageType("skill.invoke.request", SkillInvokeRequestBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["session"],
});
registerMessageType("skill.invoke.response", SkillInvokeResponseBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["skill"],
});

export const SkillBodySchemas = {
  "skill.invoke.request": SkillInvokeRequestBodySchema,
  "skill.invoke.response": SkillInvokeResponseBodySchema,
} as const;
