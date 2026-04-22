import { z } from "zod";

export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
  "Setup",
  "Stop",
  "PermissionRequest",
  "PermissionDenied",
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
  "EvalSinkOverflow",
] as const;

export const HookEventNameSchema = z.enum(HOOK_EVENT_NAMES);
export type HookEventName = z.infer<typeof HookEventNameSchema>;

const NullableSessionUuidSchema = z.string().min(1).nullable().optional();
const LooseObjectSchema = z.object({}).passthrough();

export const SessionStartPayloadSchema = z.object({
  sessionUuid: NullableSessionUuidSchema,
  turnId: z.string().min(1),
  content: z.string(),
});

export const SessionEndPayloadSchema = z
  .object({
    turnCount: z.number().int().min(0).optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
    reason: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.turnCount !== undefined ||
      value.timestamp !== undefined ||
      value.reason !== undefined,
    { message: "SessionEnd payload must carry turnCount, timestamp, or reason" },
  );

export const UserPromptSubmitPayloadSchema = z.object({
  turnId: z.string().min(1),
  content: z.string(),
});

export const PreToolUsePayloadSchema = z.object({
  tool_name: z.string().min(1).optional(),
  tool_input: z.unknown().optional(),
  request_uuid: z.string().min(1).optional(),
});

export const PostToolUsePayloadSchema = z.object({
  tool_name: z.string().min(1).optional(),
  tool_output: z.unknown().optional(),
  request_uuid: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

export const PostToolUseFailurePayloadSchema = z.object({
  tool_name: z.string().min(1).optional(),
  error_details: z.unknown().optional(),
  error_code: z.string().min(1).optional(),
  request_uuid: z.string().min(1).optional(),
});

export const PreCompactPayloadSchema = z.object({
  reason: z.string().min(1).optional(),
  historyRef: z.unknown().optional(),
  history_ref: z.unknown().optional(),
});

export const PostCompactPayloadSchema = z.object({
  summaryRef: z.unknown().optional(),
  summary_ref: z.unknown().optional(),
  tokensBefore: z.number().int().min(0).optional(),
  tokensAfter: z.number().int().min(0).optional(),
  reason: z.string().min(1).optional(),
});

export const SetupPayloadSchema = z.object({
  sessionUuid: NullableSessionUuidSchema,
  turnId: z.string().min(1),
});

export const StopPayloadSchema = z.object({
  reason: z.string().min(1),
});

export const PermissionRequestPayloadSchema = z.object({
  capabilityName: z.string().min(1),
  tool_input: z.unknown().optional(),
});

export const PermissionDeniedPayloadSchema = z.object({
  capabilityName: z.string().min(1),
  reason: z.string().min(1),
  tool_input: z.unknown().optional(),
});

export const ContextPressurePayloadSchema = z.object({
  usagePct: z.number().min(0),
  nextAction: z.string().min(1).optional(),
  retry: z.boolean().optional(),
});

export const ContextCompactArmedPayloadSchema = z.object({
  usagePct: z.number().min(0),
  retry: z.boolean().optional(),
  retriesUsed: z.number().int().min(0).optional(),
});

export const ContextCompactPrepareStartedPayloadSchema = z.object({
  prepareJobId: z.string().min(1),
  snapshotVersion: z.number().int().min(0),
  tokenEstimate: z.number().int().min(0),
});

export const ContextCompactCommittedPayloadSchema = z.object({
  oldVersion: z.number().int().min(0),
  newVersion: z.number().int().min(0),
  summary: LooseObjectSchema,
  reason: z.string().min(1).optional(),
});

export const ContextCompactFailedPayloadSchema = z.object({
  reason: z.string().min(1),
  retriesUsed: z.number().int().min(0),
  retryBudget: z.number().int().min(0),
  terminal: z.boolean(),
});

export const EvalSinkOverflowPayloadSchema = z.object({
  droppedCount: z.number().int().min(0),
  capacity: z.number().int().min(1),
  reason: z.enum(["capacity-exceeded", "duplicate-message"]).optional(),
  messageUuid: z.string().min(1).optional(),
  sinkId: z.string().min(1).optional(),
  at: z.string().datetime({ offset: true }).optional(),
});

export const HOOK_EVENT_PAYLOAD_SCHEMA_NAMES = {
  SessionStart: "SessionStartPayload",
  SessionEnd: "SessionEndPayload",
  UserPromptSubmit: "UserPromptSubmitPayload",
  PreToolUse: "PreToolUsePayload",
  PostToolUse: "PostToolUsePayload",
  PostToolUseFailure: "PostToolUseFailurePayload",
  PreCompact: "PreCompactPayload",
  PostCompact: "PostCompactPayload",
  Setup: "SetupPayload",
  Stop: "StopPayload",
  PermissionRequest: "PermissionRequestPayload",
  PermissionDenied: "PermissionDeniedPayload",
  ContextPressure: "ContextPressurePayload",
  ContextCompactArmed: "ContextCompactArmedPayload",
  ContextCompactPrepareStarted: "ContextCompactPrepareStartedPayload",
  ContextCompactCommitted: "ContextCompactCommittedPayload",
  ContextCompactFailed: "ContextCompactFailedPayload",
  EvalSinkOverflow: "EvalSinkOverflowPayload",
} as const satisfies Record<HookEventName, string>;

export type HookPayloadSchemaName =
  (typeof HOOK_EVENT_PAYLOAD_SCHEMA_NAMES)[HookEventName];

export const HOOK_EVENT_PAYLOAD_SCHEMAS = {
  SessionStart: SessionStartPayloadSchema,
  SessionEnd: SessionEndPayloadSchema,
  UserPromptSubmit: UserPromptSubmitPayloadSchema,
  PreToolUse: PreToolUsePayloadSchema,
  PostToolUse: PostToolUsePayloadSchema,
  PostToolUseFailure: PostToolUseFailurePayloadSchema,
  PreCompact: PreCompactPayloadSchema,
  PostCompact: PostCompactPayloadSchema,
  Setup: SetupPayloadSchema,
  Stop: StopPayloadSchema,
  PermissionRequest: PermissionRequestPayloadSchema,
  PermissionDenied: PermissionDeniedPayloadSchema,
  ContextPressure: ContextPressurePayloadSchema,
  ContextCompactArmed: ContextCompactArmedPayloadSchema,
  ContextCompactPrepareStarted: ContextCompactPrepareStartedPayloadSchema,
  ContextCompactCommitted: ContextCompactCommittedPayloadSchema,
  ContextCompactFailed: ContextCompactFailedPayloadSchema,
  EvalSinkOverflow: EvalSinkOverflowPayloadSchema,
} as const satisfies Record<HookEventName, z.ZodTypeAny>;
