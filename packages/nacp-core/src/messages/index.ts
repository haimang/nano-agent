/**
 * Message domain re-exports.
 *
 * IMPORTANT: Importing this file has the side-effect of registering all
 * Core message types into the global BODY_SCHEMAS / BODY_REQUIRED / ROLE_GATE maps.
 * This is intentional — it follows the same pattern as SMCP's registry.ts.
 */

// Side-effect imports: each file calls registerMessageType() at module scope
import "./tool.js";
import "./hook.js";
import "./skill.js";
import "./context.js";
import "./system.js";

// Re-export schemas for consumer convenience
export { ToolBodySchemas, ToolCallRequestBodySchema, ToolCallResponseBodySchema, ToolCallCancelBodySchema } from "./tool.js";
export { HookBodySchemas, HookEmitBodySchema, HookOutcomeBodySchema } from "./hook.js";
export { SkillBodySchemas, SkillInvokeRequestBodySchema, SkillInvokeResponseBodySchema } from "./skill.js";
export { ContextBodySchemas, ContextCompactRequestBodySchema, ContextCompactResponseBodySchema } from "./context.js";
export { SystemBodySchemas, SystemErrorBodySchema, AuditRecordBodySchema } from "./system.js";
