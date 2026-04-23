export const TURN_UUID = "11111111-1111-4111-8111-111111111111";
export const SESSION_UUID = "22222222-2222-4222-8222-222222222222";
export const TEAM_UUID = "team-001";
export const NOW = "2026-04-17T00:00:00.000Z";

export function makeTurnUuid(n) {
  return `11111111-1111-4111-8111-${n.toString().padStart(12, "0")}`;
}

export function makeArtifactRef(overrides = {}) {
  return {
    kind: "do-storage",
    binding: "SESSION_DO",
    team_uuid: TEAM_UUID,
    key: `tenants/${TEAM_UUID}/artifacts/document/art-001`,
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 100_000,
    artifactKind: "document",
    createdAt: NOW,
    ...overrides,
  };
}

export function makeNacpRef(overrides = {}) {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: TEAM_UUID,
    key: `tenants/${TEAM_UUID}/sessions/sess-001/archive/0-3.jsonl`,
    role: "output",
    ...overrides,
  };
}
