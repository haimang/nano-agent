import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NACP_SESSION_VERSION,
  NACP_SESSION_VERSION_COMPAT,
  NACP_SESSION_WS_SUBPROTOCOL,
  SESSION_MESSAGE_TYPES,
  SESSION_BODY_REQUIRED,
  STREAM_EVENT_KINDS,
} from "../../packages/nacp-session/dist/index.js";

const REGISTRY_DOC = readFileSync(
  new URL("../../docs/nacp-session-registry.md", import.meta.url),
  "utf8",
);
const README = readFileSync(
  new URL("../../packages/nacp-session/README.md", import.meta.url),
  "utf8",
);

function parseRegistryRows(markdown, headingPattern, rowPattern) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => headingPattern.test(line));
  assert.notEqual(start, -1, `missing section for ${headingPattern}`);
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const match = line.match(rowPattern);
    if (match) rows.push(match);
  }
  return rows;
}

test("nacp-session registry doc stays aligned with exported versions and subprotocol", () => {
  assert.match(REGISTRY_DOC, new RegExp(`^# NACP-Session Registry — v${NACP_SESSION_VERSION}$`, "m"));
  assert.match(
    REGISTRY_DOC,
    new RegExp(`^> Subprotocol: \`${NACP_SESSION_WS_SUBPROTOCOL}\`$`, "m"),
  );
  assert.match(
    README,
    new RegExp(`\\*\\*Baseline\\*\\*: \`${NACP_SESSION_VERSION}\` \\(frozen\\)`),
  );
  assert.match(README, new RegExp(`NACP_VERSION_COMPAT = "${NACP_SESSION_VERSION_COMPAT}"`));
  assert.match(README, /session\.followup_input/);
});

test("nacp-session registry doc lists the canonical session message table", () => {
  const rows = parseRegistryRows(
    REGISTRY_DOC,
    /^## Session Message Types$/,
    /^\|\s*`([^`]+)`\s*\|\s*(✅|—)\s*\|$/,
  );
  const actual = rows.map(([, messageType, bodyRequired]) => ({
    messageType,
    bodyRequired: bodyRequired === "✅",
  }));
  const expected = [...SESSION_MESSAGE_TYPES].map((messageType) => ({
    messageType,
    bodyRequired: SESSION_BODY_REQUIRED.has(messageType),
  }));
  const byMessageType = (a, b) => a.messageType.localeCompare(b.messageType);
  assert.deepEqual(actual.sort(byMessageType), expected.sort(byMessageType));
});

test("nacp-session registry doc lists the canonical stream-event kinds in order", () => {
  const rows = parseRegistryRows(
    REGISTRY_DOC,
    /^## Stream Event Kinds \(`session\.stream\.event`\)$/,
    /^\|\s*`([^`]+)`\s*\|\s*—\s*\|$/,
  );
  assert.deepEqual(
    rows.map(([, kind]) => kind),
    [...STREAM_EVENT_KINDS],
  );
});
