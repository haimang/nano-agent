/**
 * Export a JSON manifest of eval-observability's trace contract.
 *
 * Output: dist/eval-observability.schema.json
 *
 * The manifest is the team-reviewable artefact for:
 *   - the TraceEvent shape (base fields + evidence extensions)
 *   - the three classification sets (live-only, durable-audit, durable-transcript)
 *   - the 9 canonical session.stream.event kinds the inspector consumes
 *
 * Since `TraceEvent` is a TypeScript interface (not a zod schema), the
 * shape is hand-authored here and kept in lock-step with
 * `src/trace-event.ts`. The runtime classification sets are imported
 * directly so they cannot drift.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVE_ONLY_EVENTS,
  DURABLE_AUDIT_EVENTS,
  DURABLE_TRANSCRIPT_EVENTS,
} from "../src/classification.js";
import { SESSION_STREAM_EVENT_KINDS } from "../src/inspector.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });

/**
 * Hand-authored JSON Schema for TraceEvent. Keep aligned with
 * `src/trace-event.ts` — the `test/trace-event.test.ts` locks the TS shape.
 */
const TraceEventSchema = {
  $id: "https://nano-agent.dev/schemas/eval-observability/v1/TraceEvent",
  type: "object",
  required: ["eventKind", "timestamp", "sessionUuid", "teamUuid", "audience", "layer"],
  properties: {
    eventKind: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    sessionUuid: { type: "string" },
    teamUuid: { type: "string" },
    turnUuid: { type: "string" },
    stepIndex: { type: "integer", minimum: 0 },
    durationMs: { type: "number", minimum: 0 },
    audience: { type: "string", enum: ["internal", "external"] },
    layer: { type: "string", enum: ["live", "durable-audit", "durable-transcript"] },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
    // LLM evidence
    usageTokens: {
      type: "object",
      properties: {
        input: { type: "integer", minimum: 0 },
        output: { type: "integer", minimum: 0 },
        cacheRead: { type: "integer", minimum: 0 },
      },
      required: ["input", "output"],
    },
    ttftMs: { type: "number", minimum: 0 },
    attempt: { type: "integer", minimum: 0 },
    provider: { type: "string" },
    gateway: { type: "string" },
    cacheState: { type: "string" },
    cacheBreakReason: { type: "string" },
    model: { type: "string" },
    // Tool evidence
    toolName: { type: "string" },
    resultSizeBytes: { type: "integer", minimum: 0 },
    // Storage evidence
    storageLayer: { type: "string" },
    key: { type: "string" },
    op: { type: "string" },
    sizeBytes: { type: "integer", minimum: 0 },
  },
  additionalProperties: true,
} as const;

const fullSchema = {
  $id: "https://nano-agent.dev/schemas/eval-observability/v1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "@nano-agent/eval-observability v1 manifest",
  description:
    "Trace event schema, three-way classification sets, and the 9 canonical session.stream.event kinds consumed by SessionInspector.",
  definitions: {
    TraceEvent: TraceEventSchema,
  },
  classification: {
    live: [...LIVE_ONLY_EVENTS].sort(),
    "durable-audit": [...DURABLE_AUDIT_EVENTS].sort(),
    "durable-transcript": [...DURABLE_TRANSCRIPT_EVENTS].sort(),
  },
  sessionStreamEventKinds: [...SESSION_STREAM_EVENT_KINDS],
};

const outPath = join(outDir, "eval-observability.schema.json");
writeFileSync(outPath, JSON.stringify(fullSchema, null, 2));
console.log(`✅ Exported eval-observability manifest → ${outPath}`);
