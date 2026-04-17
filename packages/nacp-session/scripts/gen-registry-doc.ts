import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SESSION_MESSAGE_TYPES, SESSION_BODY_REQUIRED } from "../src/messages.js";
import { STREAM_EVENT_KINDS } from "../src/stream-event.js";
import { SESSION_ERROR_CODES } from "../src/errors.js";
import { NACP_SESSION_VERSION, NACP_SESSION_WS_SUBPROTOCOL } from "../src/version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lines: string[] = [];

lines.push(`# NACP-Session Registry — v${NACP_SESSION_VERSION}`);
lines.push("");
lines.push(`> Subprotocol: \`${NACP_SESSION_WS_SUBPROTOCOL}\``);
lines.push("> Auto-generated. Do not edit manually.");
lines.push("");

lines.push("## Session Message Types");
lines.push("");
lines.push("| message_type | body_required |");
lines.push("|---|---|");
for (const mt of [...SESSION_MESSAGE_TYPES].sort()) {
  lines.push(`| \`${mt}\` | ${SESSION_BODY_REQUIRED.has(mt) ? "✅" : "—"} |`);
}
lines.push("");

lines.push("## Stream Event Kinds (`session.stream.event`)");
lines.push("");
lines.push("| kind | description |");
lines.push("|---|---|");
for (const k of STREAM_EVENT_KINDS) {
  lines.push(`| \`${k}\` | — |`);
}
lines.push("");

lines.push("## Session Error Codes");
lines.push("");
lines.push("| code |");
lines.push("|---|");
for (const code of Object.values(SESSION_ERROR_CODES)) {
  lines.push(`| \`${code}\` |`);
}
lines.push("");

const outDir = join(__dirname, "..", "..", "..", "docs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "nacp-session-registry.md");
writeFileSync(outPath, lines.join("\n"));
console.log(`✅ Generated Session registry doc → ${outPath}`);
