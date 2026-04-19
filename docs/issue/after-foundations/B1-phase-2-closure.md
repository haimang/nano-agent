# [B1 / Phase 2 closure] spike-do-storage 9 probes deployed + real run captured

> **Issue ID**: `B1-phase-2-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: 2 — spike-do-storage 部署与 probe 实现
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19
> **Owner**: sean.z@haimangtech.cn (CF Account 8b611460403095bdb99b6e3448d1f363)

---

## Summary

`spike-do-storage` 真实部署到 Cloudflare 并跑通 9 个 probe，输出 `.out/2026-04-19T08-17-46Z.json`，**已捕获多条真实 platform finding**。所有 9 个 probe 全部 success=true，但其中至少 4 条产生了与 packages/ 假设不同的 platform 真相，将作为 Phase 4 per-finding doc 的输入。

**Live URL**: `https://nano-agent-spike-do-storage.haimang.workers.dev`
**Worker version**: `40ade7d4-2b83-4162-98c7-ccbe4099c636`
**Worker size**: 31.75 KiB / gzip 7.43 KiB
**Worker startup**: 7 ms

## Completed work items

| # | Item | Status | Evidence |
|---|---|---|---|
| P2-01 | Provision CF resources + real deploy | ✅ | KV `f5de37a4139a480683368d39ca4bbb62`、D1 `e9adb012-4896-473e-bf3b-c9e1f4890842` (APAC)、R2 `nano-agent-spike-do-storage-probe` 已创建；wrangler deploy 成功 |
| P2-02 | 6 storage probe handlers (V1) | ✅ | r2-multipart / r2-list-cursor / kv-stale-read / do-transactional / mem-vs-do / d1-transaction |
| P2-03 | V2A capability-parity probe | ✅ | 严格对齐 `filesystem.ts:9,53,120-127` + `search.ts` cap 行为 |
| P2-04 | V2B platform-stress probe | ✅ | 4 memory size + 3 cpu scan probe |
| P2-05 | V2-bash-curl-quota probe | ✅ | counts=[10,25] 跑通；按 Q2 默认 example.com，可 owner override |
| P2-06 | run-all-probes.sh + extract-finding.ts | ✅ | shell 驱动 + TS 自动种子 finding draft |

## Probe run summary（9 probes, all success=true）

| Probe ID | Duration | Observations | Notable |
|---|---|---|---|
| V1-storage-R2-multipart | 3.7s | 5 sizes (1K-10MB) | 全部 single-part 成功；无 multipart 触发 |
| V1-storage-R2-list-cursor | 13.9s (含 preseed) | 50 keys, 3 pages (20+20+10) | cursor 分页正常；`truncated`/`cursor` 字段 contract 一致 |
| V1-storage-KV-stale-read | 18.2s | 4 delays × 10 reads | **40/40 reads 全 fresh**——同 colo 无 stale window 观测到 |
| V1-storage-DO-transactional | 1.3s | 3 scenarios | commit/rollback/kv-outside-tx 全部按预期 |
| V1-storage-Memory-vs-DO | 1.3s | state diff | state + reads 完全一致 |
| V1-storage-D1-transaction | 1.3s | 3 scenarios | happy batch ✅；failing batch atomically rolled back ✅；**SQL BEGIN explicitly rejected** |
| V2A-bash-capability-parity | 1.1s | 3 contract checks | **3/3 hold**：mkdir partial-no-directory-entity / `/_platform/**` rejected / rg cap truncate |
| V2B-bash-platform-stress | 1.5s | memory + cpu scan | **10MB DO put → SQLITE_TOOBIG**；1MB 成功；100/500 key scan < 50ms |
| V2-bash-curl-quota | 28.0s | counts 10/25 | 35/35 fetches succeeded；p50≈800ms (example.com) |

## Notable real findings (preview, finding docs to be written in Phase 4)

### 🟢 Confirmed (packages/ assumption holds)

- **V2A capability-parity 3/3 contract holds**：
  - `MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity"` — 真实 DO storage 无目录 entity，`listDir` 返回空数组
  - `/_platform/**` reserved namespace 拒绝行为成立
  - `rg` inline cap (200 lines / 32KB) 截断行为成立
- **DO transactional contract 成立**：commit / rollback / kv-outside-tx 三个 scenario 全部按预期
- **R2 list cursor**：`truncated` + `cursor` 字段在真实 R2 上一致

### 🟡 Surprising (不同于 packages/ 假设或 Cloudflare 公开文档)

- **V1-storage-KV-stale-read**：40/40 reads 全部 fresh（包括 delay=0ms 立即读）。Cloudflare 公开文档的 "60s eventual consistency" 似乎在 worker-to-KV 同 colo 路径上**未观测到**——但样本量小，需要在 Round 2 用更激进的 worker pool / cross-region 压测确认。**这条不能直接写回 packages/ 假设变更，必须先复现**。
- **V1-storage-D1-transaction**：D1 binding **明确拒绝** SQL `BEGIN`，错误消息是显式 redirect："To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements." —— 这意味着 D1 不支持 client-driven cross-query transaction，且明确指向 DO storage transaction 作为替代。对 `storage-topology/src/refs.ts` 的 D1 manifest 假设有直接影响。

### 🔴 Boundary discovered (writeback impact)

- **V2B-bash-platform-stress memory**：DO `state.storage.put(key, Uint8Array(10MB))` → `SQLITE_TOOBIG` (SQLite value 上限触发)。1MB 成功，10MB 失败——上限在 1-10MB 之间（精确值需追加 probe）。**对 Phase 2 fake-bash extension + Phase 3 context-management async-compact 的 budget policy 都有直接影响**：任何把大 blob 直接塞 DO storage 的设计必须先过 cap check。
- **V2-bash-curl-quota**：example.com 在 25 次 outbound 时仍稳定（rate-limit 未触发）。Owner Q2 应在 Round 2 提供更高 volume / 不同 region 测试 URL。

## Files created (Phase 2)

```
spikes/round-1-bare-metal/spike-do-storage/
├── src/
│   ├── result-shape.ts                            (NEW)
│   ├── probes/
│   │   ├── r2-multipart.ts                        (NEW, 110 lines)
│   │   ├── r2-list-cursor.ts                      (NEW, 99 lines)
│   │   ├── kv-stale-read.ts                       (NEW, 81 lines)
│   │   ├── do-transactional.ts                    (NEW, 47 lines)
│   │   ├── mem-vs-do.ts                           (NEW, 91 lines)
│   │   ├── d1-transaction.ts                      (NEW, 119 lines)
│   │   ├── bash-capability-parity.ts              (NEW, 167 lines)
│   │   ├── bash-platform-stress.ts                (NEW, 91 lines)
│   │   └── bash-curl-quota.ts                     (NEW, 100 lines)
│   ├── do/ProbeDO.ts                              (UPGRADED 28→260 lines, 7 probe DO routes)
│   └── worker.ts                                  (UPGRADED 60→160 lines, 9 probe routes)
├── scripts/
│   ├── run-all-probes.sh                          (NEW, executable)
│   └── extract-finding.ts                         (NEW, executable)
├── wrangler.jsonc                                 (UPDATED: KV/D1/R2 placeholders → real IDs)
└── .out/2026-04-19T08-17-46Z.json                 (NEW: combined run output)
```

## Discipline check (Phase 2)

| 纪律 | 状态 | Evidence |
|---|---|---|
| 1. spikes/ 顶级，不进 packages/ | ✅ | 仍位于 `spikes/round-1-bare-metal/` |
| 2. expiration date | ✅ | 真实部署的 worker `vars.EXPIRATION_DATE` 仍为 2026-08-01 |
| 3. 不接 CI 主链 | ✅ | spike 不在 pnpm workspace；P2 部署完全独立 |
| 4. finding → design doc | ⏳ | Phase 4 才产出 per-finding docs；本 issue 是 Phase 2 closure，预览了 finding |
| 5. 不接生产数据 / 业务能力 | ✅ | spike 只跑 platform probe；不持有业务数据 |
| 6. round-1 与 round-2 分目录 | ✅ | 仍只有 round-1 |
| 7. round-1 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ | spike 代码 0 个 `import "@nano-agent/*"`；V2A capability-parity 显式引用 `filesystem.ts:53,120-127` 行号作为 contract 来源 |

## Phase 2 closure gate verdict

✅ **PASSED** —
- 9/9 probes deployed and runnable
- 9/9 probes returned `success=true` with real platform observations
- Worker live at `https://nano-agent-spike-do-storage.haimang.workers.dev`
- 至少 4 条 surprising/boundary findings 已发现，将驱动 Phase 4 per-finding doc 撰写
- 7/7 spike disciplines satisfied (or process-deferred to Phase 4-6)

## Next: Phase 3 (P3-01 onwards)

- **P3-01..04**: spike-binding-pair 双 worker 部署 + 4 V3 probe 实现 (V3-binding-latency-cancellation / cross-seam-anchor / hooks-callback / eval-fanin)
- **Owner prompt deferred**: Q2 测试 URL —— 当前默认 `example.com` 已能跑通；可在 Round 2 / 业主明确要求时 override

## Owner-facing notes

1. **Spike 资源已创建**（业主 Q1 双标签隔离）：
   - Worker `nano-agent-spike-do-storage` (haimang.workers.dev)
   - KV namespace `nano-agent-spike-do-storage-kv` (id `f5de37a4...`)
   - D1 database `nano_agent_spike_do_storage_d1` (id `e9adb012...`, region APAC)
   - R2 bucket `nano-agent-spike-do-storage-probe`
2. **业主可在 dashboard 查看**真实流量与 cpu_ms 消耗
3. **如要运行重 probe**（如 `large=true` 触发 50+MB R2 put），可手动 curl probe 路由 with `{"large":true}` 重跑

## References

- Charter: `docs/plan-after-foundations.md`
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Design (do-storage): `docs/design/after-foundations/P0-spike-do-storage-design.md` (r2)
- Tracking policy: `docs/issue/README.md`
- Previous issue: `docs/issue/after-foundations/B1-phase-1-closure.md`
- Combined run output: `spikes/round-1-bare-metal/spike-do-storage/.out/2026-04-19T08-17-46Z.json`
