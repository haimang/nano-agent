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
  - 直接依赖：`@nano-agent/nacp-core`、`@nano-agent/nacp-session`、`@nano-agent/workspace-context-artifacts`
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
