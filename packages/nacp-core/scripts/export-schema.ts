/**
 * Export all NACP-Core zod schemas as a single JSON Schema file.
 * Usage: pnpm -F @nano-agent/nacp-core build:schema
 * Output: dist/nacp-core.schema.json
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Import schemas (side-effect registers message types)
import "../src/messages/index.js";
import {
  NacpHeaderSchema,
  NacpAuthoritySchema,
  NacpTraceSchema,
  NacpControlSchema,
  NacpRefSchema,
  NacpEnvelopeBaseSchema,
  BODY_SCHEMAS,
} from "../src/envelope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });

const definitions: Record<string, unknown> = {};

definitions["NacpHeader"] = zodToJsonSchema(NacpHeaderSchema, { name: "NacpHeader" });
definitions["NacpAuthority"] = zodToJsonSchema(NacpAuthoritySchema, { name: "NacpAuthority" });
definitions["NacpTrace"] = zodToJsonSchema(NacpTraceSchema, { name: "NacpTrace" });
definitions["NacpControl"] = zodToJsonSchema(NacpControlSchema ?? z.undefined(), { name: "NacpControl" });
definitions["NacpRef"] = zodToJsonSchema(NacpRefSchema, { name: "NacpRef" });
definitions["NacpEnvelope"] = zodToJsonSchema(NacpEnvelopeBaseSchema, { name: "NacpEnvelope" });

for (const [mt, schema] of Object.entries(BODY_SCHEMAS)) {
  const safeName = mt.replace(/\./g, "_");
  definitions[`Body_${safeName}`] = zodToJsonSchema(schema, { name: `Body_${safeName}` });
}

const fullSchema = {
  $id: "https://nano-agent.dev/schemas/nacp-core/v1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "NACP-Core v1 JSON Schema",
  description: "Auto-generated from zod schemas via zod-to-json-schema",
  definitions,
};

const outPath = join(outDir, "nacp-core.schema.json");
writeFileSync(outPath, JSON.stringify(fullSchema, null, 2));
console.log(`✅ Exported JSON Schema → ${outPath}`);
console.log(`   ${Object.keys(definitions).length} definitions`);
