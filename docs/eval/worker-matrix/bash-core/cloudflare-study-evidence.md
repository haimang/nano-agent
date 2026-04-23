# bash.core — Cloudflare / fake-bash evidence

> 目标：把对 `worker-matrix` r2 仍然有用的平台、deploy 与 fake-bash 证据收成一处。

---

## 0. 先给结论

**对 `bash.core` 来说，pre-worker 之后最重要的平台结论已经变成两层：**

1. **deploy shell 已物理存在**：`workers/bash-core`
2. **真正值得吸收的 fake-bash 语义本体仍是 governed subset engine，而不是 full shell runtime**

因此 r2 的正确第一波姿态仍然是：

> **Cloudflare 上的 governed fake-bash worker，而不是 Cloudflare 上的 full bash。**

---

## 1. 当前最直接的平台 / deploy 证据

| 类型 | 路径 | 当前用途 |
|---|---|---|
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 证明 `workers/bash-core` shell、CI、dry-run 已 materialize |
| shell config | `workers/bash-core/wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy reality 仍是 shell/probe |
| W3 map / blueprint | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-capability-runtime.md` | 定义真正的吸收对象是 B1 capability-runtime |
| fake-bash engine | `packages/capability-runtime/README.md`; `src/targets/service-binding.ts` | 说明当前 V8/Worker-friendly execution path |

---

## 2. pre-worker 之后，平台层已经被证明的事情

### 2.1 `bash-core` 不再只是命名 proposal

当前硬事实：

- `workers/bash-core/` 目录存在：`docs/issue/pre-worker-matrix/W4-closure.md:18-21,43-48`
- shell 已通过 dry-run：`docs/issue/pre-worker-matrix/W4-closure.md:214-233`
- wrangler 形状已落盘：`workers/bash-core/wrangler.jsonc:1-22`

所以 r2 不应再把 `bash.core` 写成“还未 materialize 的 worker 名字”。

### 2.2 当前 Cloudflare deploy reality 仍然是“壳”，不是“引擎已远端化”

当前 shell 仍只返回 probe JSON：

- `workers/bash-core/src/index.ts:5-22`

因此平台层真相仍是：

> **deploy shell exists; runtime absorption not started inside that shell**

### 2.3 当前 Worker/V8 友好的 execution 路线已经在 engine 中体现

`capability-runtime` README 仍明确强调：

1. never shell out to a real process
2. typed handlers in V8 isolate
3. no silent success
4. cancellation / timeout first-class

锚点：

- `packages/capability-runtime/README.md:1-18`

这说明 `bash.core` 平台路线今天更应理解为：

> **safe typed capability execution in V8**, not shell emulation in V8

---

## 3. 当前仍需继承的 fake-bash 平台 law

虽然当前主入口已转向 pre-worker truth，但下面这些 fake-bash 平台结论仍要保留：

1. bash-shaped interface 对 LLM 是必要的
2. governed subset 比 full shell 更符合 Worker / isolate 安全与资源边界
3. budget / disclosure / honest partial 不能因为 worker 化而丢掉

这些结论今天应主要通过：

1. `docs/eval/vpa-fake-bash-by-GPT.md`
2. `docs/spikes/fake-bash-platform-findings.md`
3. `context/just-bash/*`

来作为 ancestry / rationale 使用。

---

## 4. 为什么 just-bash 现在只应作为 ancestry

`context/just-bash` 仍然很有价值，但它对 r2 的作用已经被收窄：

| 应吸收 | 不应直接照搬 |
|---|---|
| registry discipline | full shell grammar |
| threat model consciousness | OverlayFS / CLI host mental model |
| AI-agent aware command surface thinking | Python/JS runtimes、广语法、Linux 幻觉 |

而 pre-worker W3 已把当前执行基线冻结为：

> **B1 capability-runtime -> workers/bash-core**

所以 r2 不应把 just-bash 当作实现 baseline，更不应把 B1 吸收写偏成“port upstream shell runtime”。

---

## 5. 对 r2 的直接含义

从 Cloudflare / fake-bash 角度看，`bash.core` 的 r2 写法现在应明确：

1. **worker shell 已存在，不再重开 deploy topology**
2. **真正要吸收的是 governed fake-bash engine，不是 full shell runtime**
3. **当前 service-binding / tool-call 路线比 full shell API 更接近可执行 reality**
4. **just-bash 继续只做 ancestry / anti-drift 参考**

---

## 6. 本文件的最终判断

**pre-worker 之后，`bash.core` 的平台结论已经足够明确：它应该做，而且应该做成 Worker-native governed fake-bash worker。**

更直白地说：

> **今天最值得写进 worker-matrix r2 的，不是“bash 能不能上 Cloudflare”，而是“现有 B1 engine 如何进入 `workers/bash-core/` 并保持 governed subset 不漂移”。**
