# test/ — root, package E2E and cross-worker E2E index

This directory contains repository-level guardians and deploy-oriented E2E suites. Worker/package unit suites live beside their owners under `workers/*/test` and `packages/*/test`.

## Command map

| Command | Scope | Notes |
| --- | --- | --- |
| `pnpm test:contracts` | `test/root-guardians/*.test.mjs` | Root contract/coverage guardians. |
| `pnpm test:e2e` | `test/package-e2e/**/*.test.mjs` + `test/cross-e2e/**/*.test.mjs` | Default local mode; live tests skip unless opted in. |
| `pnpm test:package-e2e` | package-level live/local E2E | One-worker public/probe/product suites. |
| `pnpm test:cross-e2e` | cross-worker E2E | Multi-worker topology and product flow suites. |
| `pnpm test:live:e2e` | same files as E2E | Set live env vars to hit preview workers. |

For live preview runs, prefer sequential execution to avoid probe-concurrency noise masking product failures:

```bash
NANO_AGENT_LIVE_E2E=1 \
node --test --test-concurrency=1 \
  test/package-e2e/**/*.test.mjs \
  test/cross-e2e/**/*.test.mjs
```

## Directory map

```text
test/
├── index.md                         # canonical test index
├── INDEX.md                         # compatibility pointer
├── root-guardians/                  # repo-level contract and script coverage guardians
├── package-e2e/                     # one-worker public/probe/product E2E suites
│   ├── agent-core/
│   ├── bash-core/
│   ├── context-core/
│   ├── filesystem-core/
│   └── orchestrator-core/
├── cross-e2e/                       # multi-worker product/topology E2E suites
└── shared/                          # live gate, auth/JWT helpers and fixtures
```

## Root guardians

| File | Purpose |
| --- | --- |
| `initial-context-schema-contract.test.mjs` | Session initial context schema compatibility. |
| `nacp-1-3-matrix-contract.test.mjs` | NACP session matrix compatibility. |
| `session-registry-doc-sync.test.mjs` | Session registry documentation sync. |
| `storage-topology-contract.test.mjs` | Storage topology contract truth. |
| `test-command-coverage.test.mjs` | Ensures root test scripts cover the expected suites. |
| `tool-call-live-loop.test.mjs` | Tool-call live-loop contract guard. |

## Package E2E coverage

| Worker | Coverage |
| --- | --- |
| `agent-core` | Runtime-host probe and retired-public-edge posture. |
| `bash-core` | Capability runtime, command surface, errors and service-binding transport. |
| `context-core` | Library-worker probe posture and context/runtime expectations. |
| `filesystem-core` | Library-worker probe posture and filesystem/runtime expectations. |
| `orchestrator-core` | Canonical public facade: auth, sessions, devices, files, models, messages and legacy agent retirement. |

## Cross-worker E2E coverage

`cross-e2e/` validates preview inventory, orchestrator↔agent↔bash flows, cancellation, initial context, compact/filesystem posture, library-worker topology, session lifecycle, capability error envelopes, probe concurrency, public facade roundtrip, real LLM smoke, device revoke disconnect, cross-tenant file deny, and ZX2 transport contracts.

## Live environment

| Env | Purpose |
| --- | --- |
| `NANO_AGENT_LIVE_E2E=1` | Opt in to real preview HTTP/WS calls. |
| `NANO_AGENT_ORCHESTRATOR_JWT_SECRET` | Must match preview JWT secret for JWT-authenticated live tests. |
| `NANO_AGENT_*_URL` | Optional worker URL overrides. |

Live tests intentionally skip when `NANO_AGENT_LIVE_E2E` is not set, so local CI can still run the tree without preview credentials.
