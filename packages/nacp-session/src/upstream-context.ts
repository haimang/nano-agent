/**
 * Upstream context shape — wire contract for the `session.start.body.initial_context`
 * slot.
 *
 * Purpose (B9 / RFC §6): give upstream orchestrators (e.g. a Contexter gateway
 * that holds per-user memory) a stable, narrowed shape to inject context into
 * a fresh nano-agent session. All fields are optional and the root schema is
 * `.passthrough()`, so old loose payloads continue to parse.
 *
 * Consumer responsibility (B9 / GPT-R3): session-do-runtime preserves this
 * field in the validated frame. The actual consumer of `body.initial_context`
 * is the agent.core / context.core subsystem in the worker-matrix phase; B9
 * does NOT introduce a dispatch path here.
 */

import { z } from "zod";

export const SessionStartInitialContextSchema = z
  .object({
    user_memory: z.record(z.string(), z.unknown()).optional(),
    intent: z
      .object({
        route: z.string().min(1).max(256).optional(),
        realm: z.string().min(1).max(128).optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
    warm_slots: z
      .array(
        z.object({
          key: z.string().min(1).max(256),
          value: z.unknown(),
        }),
      )
      .optional(),
    realm_hints: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type SessionStartInitialContext = z.infer<
  typeof SessionStartInitialContextSchema
>;
