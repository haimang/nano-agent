# @haimang/nacp-core

> NACP-Core — the internal envelope layer of the Nano-Agent Communication Protocol family.

NACP is the protocol that all nano-agent modules use to talk to each other: session DO ↔ skill workers, hook dispatchers ↔ hook runtimes, queue producers ↔ consumers, and audit pipelines.

## Quick Start

```typescript
import {
  validateEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  NACP_VERSION,
} from "@haimang/nacp-core";

// Build an envelope
const envelope = {
  header: {
    schema_version: NACP_VERSION,
    message_uuid: crypto.randomUUID(),
    message_type: "tool.call.request",
    delivery_kind: "command",
    sent_at: new Date().toISOString(),
    producer_role: "session",
    producer_id: "nano-agent.session.do@v1",
    priority: "normal",
  },
  authority: {
    team_uuid: "your-team-uuid",
    plan_level: "pro",
    stamped_by: "nano-agent.platform.ingress@v1",
    stamped_at: new Date().toISOString(),
  },
  trace: {
    trace_id: crypto.randomUUID(),
    session_uuid: crypto.randomUUID(),
  },
  body: {
    tool_name: "bash",
    tool_input: { command: "ls -la" },
  },
};

// Validate (5 layers) + encode (with 96KB size guard)
const json = encodeEnvelope(envelope);

// Decode + validate on the receiving end
const decoded = decodeEnvelope(json);
console.log(decoded.header.message_type); // "tool.call.request"
```

## Protocol Family

NACP is a **protocol family**, not a single protocol:

| Layer | Package | Purpose |
|-------|---------|---------|
| **NACP-Core** (this package) | `@haimang/nacp-core` | Internal worker/DO/queue envelope |
| **NACP-Session** | `@haimang/nacp-session` | Client ↔ session DO WebSocket profile |
| **Transport Profiles** | (part of core) | Per-wire rules (service-binding, queue, DO-RPC, HTTP) |

## Multi-Tenant First-Class

Every envelope carries `authority.team_uuid`. Anonymous messages are rejected. All resource references (`refs[]`) must be tenant-namespaced (`tenants/{team_uuid}/...`). Cross-tenant access requires explicit delegation with HMAC signature.

```typescript
import { verifyTenantBoundary } from "@haimang/nacp-core";

// After validateEnvelope, before business logic:
await verifyTenantBoundary(envelope, {
  serving_team_uuid: myTeamUuid,
  accept_delegation: false,
});
```

## Message Types (Core)

| Type | Direction | Body Required |
|------|-----------|---------------|
| `tool.call.request` | session → capability | ✅ |
| `tool.call.response` | capability → session | ✅ |
| `tool.call.cancel` | session → capability | — |
| `hook.emit` | session → hook | ✅ |
| `hook.outcome` | hook → session | ✅ |
| `skill.invoke.request` | session → skill | ✅ |
| `skill.invoke.response` | skill → session | ✅ |
| `context.compact.request` | session → compactor | ✅ |
| `context.compact.response` | compactor → session | ✅ |
| `system.error` | any → audit | ✅ |
| `audit.record` | any → audit | ✅ |

## Commands

```bash
pnpm build           # TypeScript compilation
pnpm typecheck       # Type checking only
pnpm test            # Run all tests
pnpm test:coverage   # Run tests with coverage
pnpm build:schema    # Export JSON Schema → dist/nacp-core.schema.json
pnpm build:docs      # Generate registry doc → docs/nacp-core-registry.md
```

## Publish (Future)

> This package is currently used as an internal pnpm workspace dependency.
> Publishing to GitHub Packages will be configured when nacp-core reaches production readiness.

When ready, publish as a private package to GitHub Packages:

```bash
# Future: npm publish --registry https://npm.pkg.github.com
# Requires .npmrc with GITHUB_PACKAGES_TOKEN
```

## Related Documents

- `docs/nacp-by-opus.md` — protocol design specification (v2)
- `docs/nacp-reviewed-by-GPT.md` — GPT review with 13 corrections
- `docs/action-plan/nacp-core.md` — execution plan for this package
- `docs/nacp-core-registry.md` — auto-generated message/error registry
