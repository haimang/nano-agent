/**
 * Export a JSON manifest of hooks' public contract.
 *
 * Output: dist/hooks.schema.json
 *
 * The manifest is the team-reviewable artefact for:
 *   - the 8-event catalog (blocking semantics + allowed outcome fields +
 *     redaction hints + payload-schema references)
 *   - the per-event registry shape
 *   - the NACP-Core / Session / audit body shapes this package is
 *     aligned to
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { HOOK_EVENT_CATALOG } from "../src/catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });

const manifest = {
  $id: "https://nano-agent.dev/schemas/hooks/v1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "@nano-agent/hooks v1 manifest",
  description:
    "Hook event catalog, outcome allowlists, redaction hints, and the NACP bodies hooks produce/consume.",
  catalog: HOOK_EVENT_CATALOG,
  wireBodies: {
    "hook.emit": {
      type: "object",
      required: ["event_name", "event_payload"],
      properties: {
        event_name: { type: "string", minLength: 1, maxLength: 64 },
        event_payload: { type: "object" },
      },
    },
    "hook.outcome": {
      type: "object",
      required: ["ok"],
      properties: {
        ok: { type: "boolean" },
        block: {
          type: "object",
          required: ["reason"],
          properties: { reason: { type: "string" } },
        },
        updated_input: {},
        additional_context: { type: "string", maxLength: 8192 },
        stop: { type: "boolean" },
        diagnostics: { type: "string" },
      },
    },
    "hook.broadcast": {
      type: "object",
      required: ["kind", "event_name", "payload_redacted"],
      properties: {
        kind: { const: "hook.broadcast" },
        event_name: { type: "string", minLength: 1 },
        payload_redacted: {},
        aggregated_outcome: {},
      },
    },
    "audit.record": {
      type: "object",
      required: ["event_kind"],
      properties: {
        event_kind: { type: "string", minLength: 1, maxLength: 64 },
        ref: { type: "object" },
        detail: { type: "object" },
      },
    },
  },
};

const outPath = join(outDir, "hooks.schema.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`✅ Exported hooks manifest → ${outPath}`);
