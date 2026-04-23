# Blueprint（Optional）— `session-do-runtime` Host Shell → `workers/agent-core/`

> 类型：optional representative blueprint  
> 状态：非 gate，但建议保留  
> 直接上游：`W3-absorption-map.md`  
> 相关原始素材：
> - `packages/session-do-runtime/package.json`
> - `packages/session-do-runtime/wrangler.jsonc`
> - `packages/session-do-runtime/src/do/nano-session-do.ts`
> - `packages/session-do-runtime/src/session-edge.ts`
> - `packages/session-do-runtime/src/http-controller.ts`
> - `packages/session-do-runtime/src/ws-controller.ts`
> - `packages/session-do-runtime/src/composition.ts`
> - `packages/session-do-runtime/src/remote-bindings.ts`
> - `packages/session-do-runtime/src/workspace-runtime.ts`
> - `packages/session-do-runtime/src/worker.ts`

## 1. 为什么它值得作为 optional 样本

`session-do-runtime` 是 `agent-core` 的 host shell 原型。它的代表意义不在“包拆分复杂”，而在：

1. 它已经是 deploy-shaped Worker/DO 壳
2. 它真实依赖 `nacp-core` / `nacp-session` / `workspace-context-artifacts`
3. 它是最接近未来 `agent-core` host worker 的现成骨架

因此，如果 W3 想额外给 worker-matrix 提供一份 host-side 样本，这份 blueprint 是最合适的 optional 候选。

## 2. 当前代码事实

### 2.1 package-level reality

- `packages/session-do-runtime/package.json`
  - 当前版本：`0.3.0`
  - 直接依赖：`@haimang/nacp-core`、`@haimang/nacp-session`、`@nano-agent/workspace-context-artifacts`
- `wrangler.jsonc`
  - 已有 deploy-shaped binding skeleton
  - 已声明 `SESSION_DO`、fake hook / capability / fake-provider services、KV/R2 预留

### 2.2 核心源码锚点

| 职责 | 源路径 |
|---|---|
| DO host | `src/do/nano-session-do.ts` |
| session ingress | `src/session-edge.ts` / `src/turn-ingress.ts` |
| controllers | `src/http-controller.ts` / `src/ws-controller.ts` |
| composition | `src/composition.ts` / `src/remote-bindings.ts` |
| workspace/evidence bridge | `src/workspace-runtime.ts` |
| worker entry | `src/worker.ts` |

## 3. 建议目标目录

```text
workers/agent-core/
  src/
    host/
      do/
      controllers/
      composition/
      routes/
      workspace/
      health/
      traces/
    worker.ts
  wrangler.jsonc
```

## 4. 吸收纪律

1. **保留 `nacp-core` / `nacp-session` 作为外部 contract 依赖**  
   host shell 进 `agent-core`，不等于把协议包私有化。

2. **不要在这份 blueprint 里一并吸收 `agent-runtime-kernel` / `llm-wrapper`**  
   它们是同一目标 worker 的其他 absorption units，应在后续 action-plan 中按组装顺序接入。

3. **wrangler / binding skeleton 跟随 host shell 走**  
   这是它成为 optional representative blueprint 的关键价值。

## 5. 不在本 blueprint 中承诺的内容

1. live agent turn loop 已完全闭合
2. 远端 provider / capability / hook binding 已全部变成真实 cloud path
3. Worker entry 的 production profile 已做最终定案

这份 blueprint 只提供 host shell landing 方案，不代替后续 runtime closure。

## 6. 一句话 verdict

这份 optional blueprint 的价值，是给 `agent-core` 提前准备一份**真实 host shell 如何从 package 形态迁入 worker 形态**的样板；它不是 gate，但对后续 action-plan 很有参考价值。

## 7. worker-matrix 下 D01 / D05 / D06 消费本 blueprint 的要点(reality-check)

进入 worker-matrix 后,本 blueprint 作为 A1(host shell)代表样本被 D01 F1-F5 与 D05 / D06 直接引用。以下事实锚点需要对齐,本 blueprint 不改结构:

1. **A1 host shell 落点 = `workers/agent-core/src/host/do/nano-session-do.ts`(per D01 F1)** — `packages/session-do-runtime/src/do/nano-session-do.ts` 的搬迁目标是 host/do/,保留原文件名;同期 session-edge / http-controller / ws-controller / composition / remote-bindings / workspace-runtime / worker.ts 分别落 host/controllers/ / host/composition/ / host/routes/ / host/workspace/。
2. **host consumer 读 assembler 的正确入口是 `composition?.workspace?.assembler`(per D05 v0.2 R1)** — 本 blueprint §2.2 的 "composition" 源锚点保留;但 D05 host consumer 不得用 top-level `assembler` 句柄(不存在),也不得通过 `appendLayer` 直接 mutate assembler(assembler 只有 `assemble(layers)` + `setEvidenceWiring()`)。consumer 必须维护 helper-level pending layers,在 `assemble()` 调用时合并。
3. **initial context payload 的 wire truth 是 `session.start.body.initial_input`(per D05 v0.2 R2)** — `turn_input` 只是 `TurnInput` runtime internal 类型,不是 NACP wire kind;consumer 读 `initial_input` + `session.followup_input.body.text` 两个 wire 字段,输出映射到 canonical `session` / `injected` 层 kind(不是自造 `initial_context` kind)。
4. **依赖事实**:`packages/session-do-runtime/package.json` 当前直接依赖 `@haimang/nacp-core`(workspace:\*)、`@haimang/nacp-session`(workspace:\*)、`@nano-agent/workspace-context-artifacts`(workspace:\*);host shell 搬入 workers/agent-core 后,前两者继续保留作为 published 协议依赖,`@nano-agent/workspace-context-artifacts` 的 consumer 切换归 D04 / C2+D1 共存期处理。
5. **D01 F4 A4 hooks residual / F5 A5 eval observability residual 需复用本 blueprint 的 host shell 骨架** — hooks / eval observability 的 runtime sink 落在 agent-core host 内(非 package 内),共同驻留 host shell 的 "composition-time wire" 层。
