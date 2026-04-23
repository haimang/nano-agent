# context.core — Cloudflare / context evidence

> 目标：把对 `worker-matrix` r2 仍然有用的平台、deploy 与 ancestry 证据收成一处。

---

## 0. 先给结论

**对 `context.core` 来说，pre-worker 之后最重要的平台结论已经变成两层：**

1. **deploy shell 已物理存在**：`workers/context-core`
2. **真正值得吸收的语义本体仍是薄的 context substrate，而不是厚的 semantic context engine**

因此 r2 的正确第一波姿态仍然是：

> **Cloudflare 上的薄 context worker，而不是 Cloudflare 上的完整语义上下文大脑。**

---

## 1. 当前最直接的平台 / deploy 证据

| 类型 | 路径 | 当前用途 |
|---|---|---|
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 证明 `workers/context-core` shell、CI、dry-run 已 materialize |
| shell config | `workers/context-core/wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy reality 仍是 shell/probe |
| W3 map / blueprint | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-workspace-context-artifacts-split.md` | 定义真正的吸收对象是 C1 + C2 |
| current packages | `packages/context-management/*`; `packages/workspace-context-artifacts/*` | 说明当前适合 Worker/V8 的真实 substrate |

---

## 2. pre-worker 之后，平台层已经被证明的事情

### 2.1 `context-core` 不再只是命名 proposal

当前硬事实：

- `workers/context-core/` 目录存在：`docs/issue/pre-worker-matrix/W4-closure.md:18-21,45-48`
- shell 已通过 dry-run：`docs/issue/pre-worker-matrix/W4-closure.md:235-240`
- wrangler 形状已落盘：`workers/context-core/wrangler.jsonc:1-22`

所以 r2 不应再把 `context.core` 写成“还未 materialize 的 worker 名字”。

### 2.2 当前 Cloudflare deploy reality 仍然是“壳”，不是“引擎已 workerized”

当前 shell 仍只返回 probe JSON：

- `workers/context-core/src/index.ts:5-22`

因此平台层真相仍是：

> **deploy shell exists; runtime absorption not started inside that shell**

### 2.3 当前 Worker/V8 友好的 execution 路线已经在 C1/C2 中体现

当前 packages 的现实路线不是：

- 厚的 local vector engine
- 公网默认 inspector control plane
- 大量开放式 remote APIs

而是：

1. compact/budget governance
2. typed assembly/snapshot/evidence
3. host-local composition
4. tenant/ref-aware storage substrate

这说明 `context.core` 平台路线今天更应理解为：

> **safe typed context substrate in Workers**, not semantic context super-engine in Workers

---

## 3. 当前仍需继承的平台 / ancestry law

虽然当前主入口已转向 pre-worker truth，但下面这些更早结论仍要保留：

1. DO/R2/tenant-ref law 非常适合 compact/snapshot/evidence
2. slot / reranker / local vector engine 当然可行，但属于更重下一波
3. inspector/control 面必须谨慎开放

这些结论今天应主要通过：

1. `docs/eval/after-foundations/smind-contexter-learnings.md`
2. `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
3. `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`

来作为 ancestry / rationale 使用。

---

## 4. 为什么 `smind-contexter` 现在只应作为 ancestry

`smind-contexter` 仍然很有价值，但它对 r2 的作用已经被收窄：

| 应吸收 | 不应直接照搬 |
|---|---|
| DO-native stateful context actor 心智 | 厚 slot/rerank/vector engine 直接进入 first-wave |
| 上游 orchestration 与 runtime 分层 | 把所有智能上下文能力都塞进 C1/C2 首波 |
| 对未来 slot / intent / rerank 的数据模型启发 | 把这些未来能力误写成当前 worker reality |

而 pre-worker W3 已把当前执行基线冻结为：

> **C1 context-management + C2 workspace-context-artifacts context slice -> workers/context-core**

所以 r2 不应把 ancestry 误当实现 baseline。

---

## 5. 对 r2 的直接含义

从 Cloudflare / context evidence 角度看，`context.core` 的 r2 写法现在应明确：

1. **worker shell 已存在，不再重开 deploy topology**
2. **真正要吸收的是薄 context substrate，不是厚语义 engine**
3. **当前 host-local composition 比 remote context service 更接近现实**
4. **`smind-contexter` 继续只做 ancestry / anti-drift 参考**

---

## 6. 本文件的最终判断

**pre-worker 之后，`context.core` 的平台结论已经足够明确：它应该做，而且应该做成薄的 context worker。**

更直白地说：

> **今天最值得写进 worker-matrix r2 的，不是“context engine 能不能上 Cloudflare”，而是“现有 C1/C2 substrate 如何进入 `workers/context-core/` 并保持薄 worker 边界不漂移”。**
