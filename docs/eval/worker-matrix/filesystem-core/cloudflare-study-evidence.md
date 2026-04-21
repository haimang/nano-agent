# filesystem.core — cloudflare study evidence

> 目标：把 `filesystem.core` 相关的 Cloudflare 平台事实、B2/B3/A8 的原始结论，以及 `just-bash` 的参考实现放在一起，回答“为什么第一波应薄做、该吸收什么、不该照搬什么”。

---

## 0. 先给结论

**Cloudflare 侧最支持 `filesystem.core` 的，不是“把 Linux 文件系统搬进 Worker”，而是：**

1. **DO 作为 hot state / small object anchor**
2. **R2 作为 cold object / promotion target**
3. **KV 只承担极窄 metadata/feature-flag 角色**
4. **workspace truth 保持 mount-based / in-memory / typed capability-first**

而 `just-bash` 对我们的最大启发也不是“照抄完整虚拟 shell”，而是：

> **吸收 longest-prefix mount universe 与兼容外形；拒绝它的 real-fs/overlay/python/httpfs 全家桶心智。**

---

## 1. 原始素材召回表

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| worker-matrix eval | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `234-295` | GPT 对 “必要但需补平台适配层” 的原始判断 |
| worker-matrix eval | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `226-248` | Opus 对 “第一波只做 memory + R2” 的原始判断 |
| B2 | [`docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`](../../../action-plan/after-foundations/B2-storage-adapter-hardening.md) | `43-59,67-73,153-167,171-179` | 说明 adapters 与 Cloudflare findings 的直接来源 |
| B3 | [`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`](../../../action-plan/after-foundations/B3-fake-bash-extension-and-port.md) | `40-57,64-70,152-173` | 说明 fake-bash 必须消费 typed filesystem truth，而不是回到 shell 幻觉 |
| A8 | [`docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`](../../../action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md) | `24-39,47-64,88-112` | 说明 search/workspace 应以 namespace truth 为中心 |
| storage README | [`packages/storage-topology/README.md`](../../../../packages/storage-topology/README.md) | `9-14,18-63` | 说明 storage-topology 的“语义层，不是 orchestrator”定位 |
| adapters | [`packages/storage-topology/src/adapters/do-storage-adapter.ts`](../../../../packages/storage-topology/src/adapters/do-storage-adapter.ts) / [`r2-adapter.ts`](../../../../packages/storage-topology/src/adapters/r2-adapter.ts) | `6-18,73-178` / `6-17,63-187` | 说明 DO/R2 的平台事实如何被写入代码 |
| key exception | [`packages/storage-topology/src/keys.ts`](../../../../packages/storage-topology/src/keys.ts) | `38-64` | 说明 `_platform` 只保留极窄 KV feature-flags 例外 |
| placement/calibration | [`packages/storage-topology/src/placement.ts`](../../../../packages/storage-topology/src/placement.ts) / [`calibration.ts`](../../../../packages/storage-topology/src/calibration.ts) | `22-57,98-120` / `9-18,75-171,177-240` | 说明 topology 仍是 provisional/evidence-driven |
| just-bash README | [`context/just-bash/README.md`](../../../../context/just-bash/README.md) | `151-220` | 说明它的 FS universe 比我们当前需要的更大 |
| just-bash mount core | [`context/just-bash/src/fs/mountable-fs/mountable-fs.ts`](../../../../context/just-bash/src/fs/mountable-fs/mountable-fs.ts) | `49-62,85-99,181-221` | 说明 longest-prefix mount universe 的原始实现 |
| just-bash tests | [`context/just-bash/src/fs/mountable-fs/mountable-fs.test.ts`](../../../../context/just-bash/src/fs/mountable-fs/mountable-fs.test.ts) | `66-123,126-167,169-233` | 说明它还带 root/baseFs/nested mounts/mkdir 等更重语义 |
| just-bash threat model | [`context/just-bash/THREAT_MODEL.md`](../../../../context/just-bash/THREAT_MODEL.md) | `279-304` | 说明它还涉及 Python/`/host`/`/_jb_http` 等能力面 |

---

## 2. Cloudflare 平台事实：DO 和 R2 支持 `filesystem.core`，但方式很“非 Linux”

## 2.1 DO 最适合做 hot anchor，不适合承载无界 blob

`DOStorageAdapter` 当前把 B2/B1 findings 明确写死成：

- size pre-check：默认 1 MiB conservative cap：`packages/storage-topology/src/adapters/do-storage-adapter.ts:73-125`
- transaction semantics：`throw -> rollback`：`160-178`

配套测试也锁了：

- cap boundary / oversize rejection：`test/adapters/do-storage-adapter.test.ts:133-197`
- throw → rollback：`199-226`

这与 Linux/本地 FS 的心智完全不同：这里不是“随便写大文件到磁盘”，而是：

> **小对象 / 热状态 / 可事务更新 → DO**

## 2.2 R2 适合做 promoted object / archive，不适合被误写成 POSIX 目录

`R2Adapter` 当前把另一半事实写得很清楚：

- list 必须显式 cursor walk：`packages/storage-topology/src/adapters/r2-adapter.ts:120-166`
- `putParallel()` 是为 per-call overhead 做的 pragmatic helper：`168-187`

测试也证明了：

- 50 keys / limit 20 = 3 pages：`test/adapters/r2-adapter.test.ts:149-184`
- `putParallel()` 确实是正式 contract：`198-233`

这意味着第一波 `filesystem.core` 如果需要 durable large object path，最自然的姿态是：

> **DO inline pointer + R2 payload**

而不是“在 Worker 里模拟一个真实磁盘目录树”。

## 2.3 KV 当前只适合极窄 metadata/config，用不了来冒充 full filesystem

`KV_KEYS` 当前唯一允许的 `_platform` 例外只有：

- `featureFlags(): "_platform/config/feature_flags"`：`packages/storage-topology/src/keys.ts:38-64`

这说明 platform-side ambient config 可以用 KV，但：

- per-tenant state 仍必须 tenant-scoped
- KV 并没有被写成 workspace 文件落点

所以把 `filesystem.core` 第一波写成 “KV-backed virtual filesystem” 并没有当前代码与文档支撑。

---

## 3. why thin first-wave：当前 topology 仍应 evidence-driven

`storage-topology/README.md` 和源码都在反复强调一件事：

- 它是 semantics library：`README.md:9-14`
- final frozen thresholds 不在 v1 scope：`52-63`
- placement hypotheses 仍是 provisional：`packages/storage-topology/src/placement.ts:98-120`
- calibration 明确通过 evidence adapter 收 placement log 再重评：`packages/storage-topology/src/calibration.ts:14-18,177-240`

这和 GPT/Opus 的 worker-matrix 原始判断完全对齐：

- GPT：推荐做，但必须承认需要补平台适配层：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:268-295`
- Opus：第一波只做 memory + R2，KV/D1 不要写满：`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:239-248`

因此第一波薄做并不是保守过度，而是对当前 evidence reality 的诚实反映。

---

## 4. `just-bash` 给我们的启发：mount universe 值得吸收

## 4.1 最值得吸收的是 longest-prefix mount universe

`just-bash` 的 `MountableFs` 明确提供了：

- mount-based unified namespace：`README.md:197-220`
- longest-prefix routePath：`src/fs/mountable-fs/mountable-fs.ts:181-221`

这正是 nano-agent 今天在 `MountRouter` 中吸收的核心：`packages/workspace-context-artifacts/src/mounts.ts:1-10,58-85`

所以从 `just-bash` 真正迁移过来的，不是 shell feature，而是这个判断：

> **workspace truth 应该是 mount universe，而不是单一 host path。**

## 4.2 它的测试还提醒了我们：一旦做重 FS，就会很快碰到更多隔离问题

`just-bash` 在 mount tests / security tests 里还覆盖了：

- nested mount validation：`mountable-fs.test.ts:66-123`
- baseFs + mounted fs 合并目录视图：`169-191`
- symlink escape / cross-mount isolation / traversal：`mountable-fs.security.test.ts:18-154`

这说明一旦我们把 `filesystem.core` 做到“更像真实文件系统”，工程复杂度会迅速从：

- path routing

升级到：

- symlink
- cross-mount leakage
- directory semantics
- traversal policy

这正是为什么第一波更适合停在 current substrate，而不是直接许诺 full FS。

---

## 5. `just-bash` 也明确提醒了我们什么**不能**照搬

`just-bash` 的能力面远比当前 nano-agent 需要的大：

- OverlayFs / ReadWriteFs / real directory roots：`README.md:170-195`
- Python via CPython/Emscripten：`THREAT_MODEL.md:279-304`
- `/host` mount、`/_jb_http` HTTPFS、更多 runtime/sandbox 面：同上

而 nano-agent 当前路线已经明确相反：

- fake-bash 只是 typed capability compatibility surface：`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md:40-57`
- command 通过 typed handlers 执行，不 shell out：`packages/capability-runtime/README.md:9-19`
- `service-binding` / `browser-rendering` 仍是 reserved/not-connected target：`packages/capability-runtime/README.md:84-93`

所以我们对 `just-bash` 最健康的使用方式是：

| 吸收 | 不吸收 |
|---|---|
| mount universe / routePath 心智 | real FS / overlay / read-write host roots |
| bash compatibility 外形 | 完整 shell/runtime feature set |
| “shared filesystem, isolated exec state” 的 UX 启发 | Python `/host` / HTTPFS `/ _jb_http` 这类更重执行模型 |

---

## 6. 对 worker-matrix 的直接启示

把上面的平台事实压缩成 worker-matrix 设计建议，大致就是：

1. **`filesystem.core` 可以做，但 first-wave 更像 host-local foundation 或薄 worker，而不是 full filesystem service。**
2. **最稳的 durable ladder 是：Memory/DO inline + R2 promotion。**
3. **KV/D1 暂时只应留在 metadata / future slot / semantics layer，不应被 marketing 成“文件系统已接通”。**
4. **fake-bash 必须继续把 workspace truth 建立在 typed namespace 上，而不是反过来让 workspace 迁就 shell 幻觉。**

---

## 7. 结论

**Cloudflare 真实支持的是“对象/状态分层 + typed mount workspace”，而不是“传统 Linux 文件系统”。**

因此 `filesystem.core` 的最终 verdict 应该是：

> **值得做，而且地基已经很强；但第一波最有工程价值的做法，仍是把它作为 mount-based workspace/storage substrate 薄做推进，而不是急着把它包装成完整 remote filesystem worker。**
