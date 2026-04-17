import { zodToJsonSchema } from "zod-to-json-schema";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionStartBodySchema, SessionResumeBodySchema, SessionCancelBodySchema, SessionEndBodySchema, SessionStreamAckBodySchema, SessionHeartbeatBodySchema } from "../src/messages.js";
import { SessionStreamEventBodySchema } from "../src/stream-event.js";
import { NacpSessionFrameSchema, SessionFrameFieldsSchema, NacpClientFrameSchema } from "../src/frame.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "dist");
mkdirSync(outDir, { recursive: true });

const definitions: Record<string, unknown> = {};
definitions["SessionStartBody"] = zodToJsonSchema(SessionStartBodySchema, { name: "SessionStartBody" });
definitions["SessionResumeBody"] = zodToJsonSchema(SessionResumeBodySchema, { name: "SessionResumeBody" });
definitions["SessionCancelBody"] = zodToJsonSchema(SessionCancelBodySchema, { name: "SessionCancelBody" });
definitions["SessionEndBody"] = zodToJsonSchema(SessionEndBodySchema, { name: "SessionEndBody" });
definitions["SessionStreamAckBody"] = zodToJsonSchema(SessionStreamAckBodySchema, { name: "SessionStreamAckBody" });
definitions["SessionHeartbeatBody"] = zodToJsonSchema(SessionHeartbeatBodySchema, { name: "SessionHeartbeatBody" });
definitions["SessionStreamEventBody"] = zodToJsonSchema(SessionStreamEventBodySchema, { name: "SessionStreamEventBody" });
definitions["SessionFrameFields"] = zodToJsonSchema(SessionFrameFieldsSchema, { name: "SessionFrameFields" });
definitions["NacpSessionFrame"] = zodToJsonSchema(NacpSessionFrameSchema, { name: "NacpSessionFrame" });
definitions["NacpClientFrame"] = zodToJsonSchema(NacpClientFrameSchema, { name: "NacpClientFrame" });

const fullSchema = {
  $id: "https://nano-agent.dev/schemas/nacp-session/v1",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "NACP-Session v1 JSON Schema",
  description: "Auto-generated from zod schemas",
  definitions,
};

const outPath = join(outDir, "nacp-session.schema.json");
writeFileSync(outPath, JSON.stringify(fullSchema, null, 2));
console.log(`✅ Exported Session JSON Schema → ${outPath} (${Object.keys(definitions).length} definitions)`);
