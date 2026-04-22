# RFC: Remote Compact Delegate（方向性草案）

> 状态：Directional RFC / pre-worker-matrix 输入  
> 直接上游：`docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`  
> 直接下游：worker-matrix `context-core` 设计、`agent-core` ↔ `context-core` binding profile

## 1. 问题定义

仓内今天已经存在 `context.compact.request/response` 这条 formal wire family；同时 `workspace-context-artifacts` 里也已经有 `CompactBoundaryManager`、`ContextAssembler` 这类 runtime seam。真正尚未冻结的是：

**当 compact 从 host-local helper 演进成远端 `context-core` worker 能力时，应该沿用哪一层 contract。**

当前事实锚点：

- `packages/nacp-core/` 中现有 `context.compact.request/response` reality
- `packages/workspace-context-artifacts/src/compact-boundary.ts`
- `packages/workspace-context-artifacts/src/context-assembler.ts`
- `packages/session-do-runtime/src/workspace-runtime.ts`
- `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`

## 2. 本 RFC 的核心结论

**未来 remote compact delegate 应继续沿用现有 `context.compact.request/response` 语义，不新增私有 `compact.delegate.*` family。**

也就是说：

1. `agent-core` 仍然构造 canonical compact request  
2. `context-core` 作为远端执行者消费该 request  
3. 返回 canonical compact response  
4. transport 可以是 service binding，但 message family 仍然是原有 compact contract

## 3. 为什么不发明第二套 family

### 3.1 避免“一份本地 compact + 一份远端 compact”

如果另起 `compact.delegate.*`，后续会同时存在：

- 对 client / session 可见的一套 compact truth
- 对 worker-to-worker 私有的一套 compact truth

这会直接破坏 Phase 0 / B9 之后已经建立的 contract freeze 纪律。

### 3.2 当前仓内已经有足够的 typed seam

`CompactBoundaryManager` 的价值是 runtime 边界与 evidence wiring；它不是理由去创造第二套 wire protocol。远端 delegate 只是**执行位置改变**，不是**contract 本体改变**。

## 4. 建议的远端调用模型

```text
agent-core
  └─ 形成 canonical context.compact.request
     └─ service binding 调 context-core
        └─ context-core 消费 request，调用 compact/assembly substrate
           └─ 返回 canonical context.compact.response
```

### 4.1 service-binding 层只补三类 metadata

1. trace / request correlation
2. team / tenant boundary
3. timeout / retry / transport failure disclosure

### 4.2 service-binding 层不应改写 compact body

不允许：

- 改字段名
- 把 `history_ref` / `summary_ref` 私下换成另一套 internal-only body
- 先转成 shell-ish text 再发给远端 worker

## 5. 本 RFC 对 `context-core` 的最低要求

1. `context-core` 必须把 compact 当成 typed contract，不是字符串处理任务  
2. 远端执行失败时返回 explicit failure，不允许 success-shaped empty summary  
3. compact 前后的 evidence / audit 记录继续保留原有 vocabulary，不因为 remote hop 而换 shape  
4. 若后续加入 rerank / layered selection，它们是 **compact planner** 的前后处理，不是本 RFC 的 wire 变更理由

## 6. 明确不支持 / 不冻结的部分

本 RFC 当前**不冻结**：

1. compact 任务排队/批处理协议
2. cancel / resume 的跨 worker 精细恢复
3. 压缩算法参数目录
4. slot / reranker / intent router 如何并入 context-core
5. compact 结果的持久化位置（DO / R2 / D1）

这些都属于 worker-matrix 与后续 action-plan 再决定的执行问题，而不是 pre-worker-matrix 的协议边界问题。

## 7. 与现有代码事实的对应关系

| 事实 | 当前代码锚点 | 这份 RFC 的含义 |
|---|---|---|
| canonical compact wire 已存在 | `@nano-agent/nacp-core` 现有 compact 消息族 | 不重发明 family |
| runtime compact seam 已存在 | `compact-boundary.ts` / `context-assembler.ts` | 远端只改变执行位置 |
| live runtime 已有 evidence wiring | `session-do-runtime/src/workspace-runtime.ts` | remote compact 也要继续保留 evidence truth |

## 8. 最终判断

`remote compact delegate` 是一个**部署拓扑决定**，不是一个**新协议本体**。这份 RFC 的最终价值，就是提前堵住“为了 context-core worker 化而再造一套 compact 私有消息”的冲动，把 worker-matrix 之后的实现，强制收敛在现有 compact canonical contract 上。
