# filesystem.core — Cloudflare / filesystem evidence

> 目标：把对 `worker-matrix` r2 仍然有用的平台、deploy 与 ancestry 证据收成一处。

---

## 0. 先给结论

**对 `filesystem.core` 来说，pre-worker 之后最重要的平台结论已经变成两层：**

1. **deploy shell 已物理存在**：`workers/filesystem-core`
2. **真正值得吸收的语义本体仍是 typed workspace/storage substrate，而不是 Linux/POSIX/full virtual FS**

因此 r2 的正确第一波姿态仍然是：

> **Cloudflare 上的 typed workspace/storage worker，而不是 Cloudflare 上的完整 Linux 文件系统。**

---

## 1. 当前最直接的平台 / deploy 证据

| 类型 | 路径 | 当前用途 |
|---|---|---|
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 证明 `workers/filesystem-core` shell、CI、dry-run 已 materialize |
| shell config | `workers/filesystem-core/wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy reality 仍是 shell/probe |
| W3 map / blueprint | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-workspace-context-artifacts-split.md` | 定义真正的吸收对象是 D1 + D2 |
| current packages | `packages/workspace-context-artifacts/*`; `packages/storage-topology/*` | 说明当前适合 Workers/Cloudflare 的真实 substrate |

---

## 2. pre-worker 之后，平台层已经被证明的事情

### 2.1 `filesystem-core` 不再只是命名 proposal

当前硬事实：

- `workers/filesystem-core/` 目录存在：`docs/issue/pre-worker-matrix/W4-closure.md:18-21,47-48`
- shell 已通过 dry-run：`docs/issue/pre-worker-matrix/W4-closure.md:238-240`
- wrangler 形状已落盘：`workers/filesystem-core/wrangler.jsonc:1-22`

所以 r2 不应再把 `filesystem.core` 写成“还未 materialize 的 worker 名字”。

### 2.2 当前 Cloudflare deploy reality 仍然是“壳”，不是“authority/runtime 已 workerized”

当前 shell 仍只返回 probe JSON：

- `workers/filesystem-core/src/index.ts:5-22`

因此平台层真相仍是：

> **deploy shell exists; runtime absorption not started inside that shell**

### 2.3 当前 Worker/Cloudflare 友好的 storage 路线已经在 D1/D2 中体现

当前 packages 的现实路线不是：

- Linux path → disk-like FS
- universal overlay root
- full remote filesystem server

而是：

1. mount-based workspace universe
2. DO hot state / small objects
3. R2 promotion / cold objects
4. KV 只保留极窄 metadata/config 角色
5. evidence-driven placement rather than frozen topology

这说明 `filesystem.core` 平台路线今天更应理解为：

> **typed workspace/storage substrate in Cloudflare**, not virtual Linux filesystem in Cloudflare

---

## 3. 当前仍需继承的平台 / ancestry law

虽然当前主入口已转向 pre-worker truth，但下面这些更早结论仍要保留：

1. DO 最适合 hot anchor，不适合无界 blob
2. R2 最适合 promotion / cold object，不适合被误写成 POSIX 目录
3. KV 只承担极窄 metadata/feature-flag 角色
4. longest-prefix mount universe 值得吸收；overlay/full FS/host roots 不该直接照搬

这些结论今天应主要通过：

1. `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
2. `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`
3. `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`
4. `context/just-bash/*`

来作为 ancestry / rationale 使用。

---

## 4. 为什么 just-bash 现在只应作为 ancestry

`context/just-bash` 仍然很有价值，但它对 r2 的作用已经被收窄：

| 应吸收 | 不应直接照搬 |
|---|---|
| mount universe / longest-prefix routing 心智 | Overlay/full FS/real host roots |
| bash-compatible workspace outer shape | Python/HTTPFS/更多 runtime 全家桶 |
| 更严格的 FS 风险意识 | Linux/POSIX 幻觉 |

而 pre-worker W3 已把当前执行基线冻结为：

> **D1 workspace-context-artifacts filesystem slice + D2 storage-topology -> workers/filesystem-core**

所以 r2 不应把 ancestry 误当实现 baseline。

---

## 5. 对 r2 的直接含义

从 Cloudflare / filesystem evidence 角度看，`filesystem.core` 的 r2 写法现在应明确：

1. **worker shell 已存在，不再重开 deploy topology**
2. **真正要吸收的是 typed workspace/storage substrate，不是 full filesystem runtime**
3. **当前 fake-bash consumer path 与 host-local composition 比 remote filesystem service 更接近现实**
4. **just-bash 继续只做 ancestry / anti-drift 参考**

---

## 6. 本文件的最终判断

**pre-worker 之后，`filesystem.core` 的平台结论已经足够明确：它应该做，而且应该做成 typed workspace/storage worker。**

更直白地说：

> **今天最值得写进 worker-matrix r2 的，不是“文件系统能不能上 Cloudflare”，而是“现有 D1/D2 substrate 如何进入 `workers/filesystem-core/` 并保持 typed workspace/storage 边界不漂移”。**
