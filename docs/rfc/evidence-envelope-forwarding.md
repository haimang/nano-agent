# RFC: Evidence Envelope Forwarding（方向性草案）

> 状态：Directional RFC / pre-worker-matrix 输入  
> 直接上游：`docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`  
> 直接下游：`agent-core` / `context-core` / `filesystem-core` / `bash-core` 的远端 evidence 回传设计

## 1. 背景

仓内已经有两层相关 reality：

1. **evidence vocabulary 已在 W0 shipped code 中存在**  
2. **审计/广播 envelope 也已有既存消息路径**

真正尚未冻结的是：**当某个 future worker（如 context-core / filesystem-core / bash-core）在远端执行时，它产生的 evidence 该如何“回到 agent-core / eval sink”，又不至于变成第二套 vocabulary。**

当前事实锚点：

- `packages/nacp-core/src/evidence/vocabulary.ts`
- `packages/eval-observability/` 的 trace / audit sink reality
- `packages/session-do-runtime/src/workspace-runtime.ts`
- `packages/workspace-context-artifacts/src/evidence-emitters.ts`
- `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`

## 2. 核心结论

**远端 worker 产生的 evidence，不应在 forwarding hop 上被改写成第二套 payload；forwarding 层只负责 envelope / attribution / transport metadata。**

换句话说：

- **payload shape**：继续使用 W0 evidence vocabulary  
- **forwarding carrier**：复用现有 audit / event forwarding 路径  
- **新增内容**：只允许补 sender worker、trace correlation、request correlation、transport failure disclosure

## 3. Forwarding 的最小模型

```text
remote worker
  └─ 生成 W0 EvidenceRecord
     └─ envelope forward
        └─ agent-core / eval sink 接收
           └─ durable sink / inspector 继续按同一 vocabulary 消费
```

### 3.1 forwarding hop 允许补充的信息

1. `source_worker`
2. `trace_uuid` / request correlation
3. `team_uuid` / tenant attribution
4. forwarding timestamp

### 3.2 forwarding hop 不允许做的事情

1. 改 evidence kind 名称  
2. 把原 record flatten 成另一套 body  
3. 为每个 worker 定义私有 evidence schema  
4. 因为 transport 不方便，就把 structured evidence 降级成纯文本日志

## 4. 为什么这条纪律重要

### 4.1 否则 worker-matrix 后会出现“每个 worker 一套 evidence”

那样 `eval-observability` 的 sink、inspector、verdict aggregation 都会失去统一消费面，最后必须回头做格式适配层，等于把 Phase 2/6 的工作重新做一遍。

### 4.2 当前 live runtime 已经依赖统一 evidence truth

`composeWorkspaceWithEvidence()` 已经说明：assembly / compact / snapshot evidence 是通过统一 sink 发射的。未来 worker 化后，这个 truth 不能因为跨 worker hop 而断开。

## 5. 建议的 envelope discipline

1. **payload first**：EvidenceRecord 原样保留  
2. **carrier second**：复用 audit/event carrier，而不是定义 `evidence.forward.*` 新 family  
3. **attribution explicit**：sender worker / trace / tenant 显式附带  
4. **failure explicit**：forwarding 失败要被显式记录，不能 silent drop

## 6. 与现有代码的映射

| 现有代码事实 | RFC 判断 |
|---|---|
| `workspace-context-artifacts` 已有 evidence emitters | 远端 worker 继续生成同一 payload truth |
| `session-do-runtime` 已有 workspace evidence sink wiring | forwarding 后仍应落回统一 eval sink |
| `eval-observability` 负责 durable trace/audit 消费 | 它应消费统一 evidence vocabulary，而不是 worker-specific payload |

## 7. 明确不在本 RFC 中冻结的内容

本 RFC **不冻结**：

1. evidence forward 具体走哪一个 service binding endpoint
2. batch / retry / backpressure 策略
3. sink durable placement（DO / R2 / D1）
4. `hook.broadcast` 是否与 evidence forward 共享完全同一 envelope

这些都属于 worker-matrix / action-plan 执行问题。

## 8. 最终判断

这份 RFC 的目的不是“新增 evidence 协议”，而是**禁止新增 evidence 协议**。它为 worker-matrix 之后的远端 worker 化提前立了一条硬纪律：**远端可以改变执行位置、改变转发路径，但不能改变 W0 已经给出的 evidence payload truth。**
