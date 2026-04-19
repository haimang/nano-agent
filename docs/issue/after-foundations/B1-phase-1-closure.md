# [B1 / Phase 1 closure] spike Round 1 skeletons + dry-runs (P1-01..P1-04)

> **Issue ID**: `B1-phase-1-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: 1 — Spike 壳与 finding 模板就位
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19
> **Owner**: sean.z@haimangtech.cn (CF Account 8b611460403095bdb99b6e3448d1f363)
>
> **Tracking model note**: 业主决策（2026-04-19）—— 本项目所有 issue 均在 `docs/issue/{phase}/` 下以 markdown 文件管理，**不**使用 GitHub Issue tracker，避免双真相层。曾创建过的 GitHub issue（如 https://github.com/haimang/nano-agent/issues/1）已在本文件 ship 后 close 并指向本路径。

---

## Summary

Phase 1 of `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` is closed. Two disposable Cloudflare Worker skeletons are wired and pass `wrangler deploy --dry-run`.

## Completed work items

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-01 | Spike top-level dirs + 3 READMEs | ✅ | `spikes/README.md`, `spikes/round-1-bare-metal/spike-do-storage/README.md`, `spikes/round-1-bare-metal/spike-binding-pair/README.md` (含 EXPIRATION_DATE=2026-08-01 + 7 纪律 link) |
| P1-02 | Template path uniqueness check | ✅ | active charter / design / action-plan 全部指向 `docs/templates/_TEMPLATE-spike-finding.md`；2 处历史 eval 文档残留已加 strikethrough 并标注业主决策 |
| P1-03 | spike-do-storage skeleton + dry-run | ✅ | `wrangler deploy --dry-run` → 1.73 KiB worker；DO_PROBE / KV_PROBE / D1_PROBE / R2_PROBE + 5 env vars 全部识别 |
| P1-04 | spike-binding-pair worker-a/b skeleton + dry-run | ✅ | worker-b dry-run → 0.95 KiB；worker-a dry-run → 1.49 KiB（含 WORKER_B service binding） |

## Files created (18)

```
spikes/
├── README.md                                        (顶级 spike workspace 索引 + 7 纪律 + 命名约定 + expiration)
└── round-1-bare-metal/
    ├── spike-do-storage/
    │   ├── README.md
    │   ├── .gitignore
    │   ├── package.json                             (wrangler 4.83.0 + workers-types + ts 5.6 devDeps)
    │   ├── wrangler.jsonc                           (DO_PROBE + KV_PROBE + R2_PROBE + D1_PROBE + 5 vars)
    │   ├── tsconfig.json
    │   └── src/
    │       ├── worker.ts                            (healthz only; 9 probes planned for Phase 2)
    │       └── do/ProbeDO.ts                        (skeleton; SQLite-backed)
    └── spike-binding-pair/
        ├── README.md
        ├── .gitignore
        ├── worker-a/
        │   ├── package.json
        │   ├── wrangler.jsonc                       (services: WORKER_B → nano-agent-spike-binding-pair-b)
        │   ├── tsconfig.json
        │   └── src/worker.ts                        (healthz + healthz/binding sanity check)
        └── worker-b/
            ├── package.json
            ├── wrangler.jsonc
            ├── tsconfig.json
            └── src/worker.ts                        (healthz only; 5 handlers planned for Phase 3)
```

## Resource naming (per owner B1 Q1: nano-agent + spike dual-tag)

| Resource | Name |
|---|---|
| Worker (do-storage) | `nano-agent-spike-do-storage` |
| Worker (binding-pair caller) | `nano-agent-spike-binding-pair-a` |
| Worker (binding-pair callee) | `nano-agent-spike-binding-pair-b` |
| R2 bucket | `nano-agent-spike-do-storage-probe` |
| KV namespace title | `nano-agent-spike-do-storage-kv` (id placeholder; provision in P2-01) |
| D1 database | `nano_agent_spike_do_storage_d1` (id placeholder; provision in P2-01) |
| DO class | `ProbeDO` (binding `DO_PROBE`) |

## Discipline check (preview)

| 纪律 | 状态 | Evidence |
|---|---|---|
| 1. spikes/ 顶级，不进 packages/ | ✅ | `pnpm-workspace.yaml` 仅含 `packages/*` |
| 2. expiration date | ✅ | `EXPIRATION_DATE=2026-08-01` 在 3 个 wrangler.jsonc + 3 个 README |
| 3. 不接 CI 主链 | ✅ | spike 不在 pnpm workspace；本仓库根 scripts 不涉及 spikes/ |
| 4. finding → design doc | ⏳ | 模板就位 (`docs/templates/_TEMPLATE-spike-finding.md`)；finding 由 P4 产出 |
| 5. 不接生产数据 / 不持业务数据 / 不实现新业务能力 | ✅ | spike worker.ts 仅 healthz；无 LLM key；无业务 logic |
| 6. round-1 与 round-2 分目录 | ✅ | `round-1-bare-metal/` 已建；round-2 待 B7 |
| 7. round-1 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ | spike 代码无 `import "@nano-agent/*"`；wrangler.jsonc 注释引用 packages/ contract |

## Dry-run outputs

```
spike-do-storage:           Total Upload 1.73 KiB / gzip 0.78 KiB; bindings: DO_PROBE + KV_PROBE + D1_PROBE + R2_PROBE + 5 env vars
spike-binding-pair worker-b: Total Upload 0.95 KiB / gzip 0.55 KiB; 6 env vars (no bindings other than env)
spike-binding-pair worker-a: Total Upload 1.49 KiB / gzip 0.71 KiB; bindings: WORKER_B (service) + 6 env vars
```

## Phase 1 closure gate verdict

✅ **PASSED** — all P1-01..P1-04 done; 3 dry-runs successful; 7 纪律 self-check 6/7 ✅ + 1 ⏳ (纪律 4 是 process discipline，validation 在 Phase 4-6)

## Next: Phase 2 (P2-01 onwards)

- **P2-01**: 真实部署 spike-do-storage (需在 wrangler.jsonc 替换 KV_PROBE/D1_PROBE 的 `PLACEHOLDER_*_ID`，先 `wrangler kv namespace create` + `wrangler d1 create`)
- **P2-02..06**: 实现 9 个 probe handler (V1×6 + V2A + V2B + V2-curl-quota)
- **P2-06 prompt to owner**: V2-bash-curl-quota 需要业主提供测试 URL (B1 Q2)

## References

- Charter: `docs/plan-after-foundations.md`
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Design (matrix): `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` (r2)
- Design (do-storage): `docs/design/after-foundations/P0-spike-do-storage-design.md` (r2)
- Design (binding-pair): `docs/design/after-foundations/P0-spike-binding-pair-design.md` (r2)
- GPT review: `docs/design/after-foundations/P0-reviewed-by-GPT.md`
- Finding template: `docs/templates/_TEMPLATE-spike-finding.md`
- Tracking policy: `docs/issue/README.md`（待写）
