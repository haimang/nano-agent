# LLM Delta Policy

> 服务: `nano-agent / orchestrator-core / agent-core`
> 关联 design: `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` P2-02
> 文档状态: `frozen-for-RH2`

---

## 1. 一句话政策

LLM 流式输出走 **semantic-chunk only**:`session.stream.event` 帧 body 携带 `llm.delta { content_type ∈ "text" | "tool_use_start" | "tool_use_delta" }`,以及独立的 `tool.call.result` 帧表示 tool 执行结束。**不**引入 `tool_use_stop`,**不**引入 token-level streaming。

## 2. 帧族

| 帧 body kind | 方向 | 触发时机 | 必含字段 |
|---|---|---|---|
| `llm.delta { content_type: "text", text }` | server → client | LLM 文本片段 | `text: string` |
| `llm.delta { content_type: "tool_use_start", tool_call_id, tool_name }` | server → client | runtime 决定调用 tool 后,执行前 | `tool_call_id`, `tool_name`, optional `tool_input_partial` |
| `llm.delta { content_type: "tool_use_delta", tool_call_id, args_chunk }` | server → client | tool 入参增量构造(provider 流式生成 args 时) | `tool_call_id`, `args_chunk: string` |
| `tool.call.result` | server → client | tool 执行完成(success or error) | `tool_call_id`, `status: "ok" \| "error"`, `output?`, `error?` |

> **不接收**:`tool_use_stop`(原本设想用来表示 args 完成 + 即将 dispatch 的边界帧)。结束语义由 `tool.call.result` 唯一表达,中间状态由 `tool_use_delta` 末尾的"args 完整 JSON 可解析"自然指示。

## 3. 决议背景

| 决议 | 来源 | 理由 |
|---|---|---|
| `tool_use_stop` 不进 schema | `RH2-llm-delta-policy §1.1` | (1) 双信号问题:`tool_use_stop` 与 `tool.call.result` 在同一 round-trip 都标"边界",一旦 frame 顺序乱掉,client 状态机会陷入"已 stop 但 result 未到"歧义。(2) 节流:对于"快速 tool 执行"(<100ms)的 case,`tool_use_stop + tool.call.result` 几乎同时到达,中间帧仅多 ~20 字节传输噪声。 |
| token-level streaming out-of-scope | `RH2-llm-delta-policy §5.2` | (1) Workers AI 当前并不 expose token-level event;runtime 自行 chunk 会引入 provider-specific 差异。(2) Client 渲染 token 级别 chunk 要求专门的 framerate buffer,RH2 客户端简化窗口内不做。延迟到 hero-to-platform。 |
| semantic-chunk = `text \| tool_use_start \| tool_use_delta` 三态 | `design RH2 §3.2` | 这三态足以驱动 client 同时呈现"模型在写文字"+"模型决定调工具"+"工具入参在生成中"三件事;再多状态会让 client 状态机发散。 |

## 4. Client 状态机契约

Client adapter 应用以下规则:

1. **首次收到 `llm.delta` text** → 启动文字渲染缓冲区
2. **首次收到 `llm.delta` tool_use_start** → 在 timeline 上挂出 `tool_call_id` 占位条目,显示工具名 + spinner
3. **收到 `llm.delta` tool_use_delta** → 累加 `args_chunk` 到对应 `tool_call_id` 的入参视图(可选展示)
4. **收到 `tool.call.result`** → 把对应 `tool_call_id` 条目转换为最终结果(成功 / 失败 + output)
5. **收到 `session.usage.update`** → 更新右上角 token / cost 计数
6. **收到 `session.permission.request`** → 弹出 permission UI,等待用户决策回 `session.permission.decision`(此时 frame 不流式,作为 round-trip)

## 5. 帧顺序保证

- 所有上述 frame 走 **同一 stream_uuid**(默认 `"main"`)
- `stream_seq` 在 `session_frame.stream_seq` 单调递增
- Reconnect 时 client 通过 `?last_seen_seq=N` 触发 server 端 `replay(N+1, end)`
- 如果 `tool_use_start` seq=10 与 `tool.call.result` seq=15 之间发生 reconnect 但 client 只看到 seq=10,replay 必会补齐 11-15 中含的 delta + result 帧 — **不允许**只 replay result 跳过 delta

## 6. 与 `RH2-llm-delta-policy.md` 设计文档的关系

本文件是设计文档 `RH2-llm-delta-policy.md` §1.1 / §5 / §6 的"公共 API doc 版本",供:
- 客户端 adapter 实现者(web / wechat)使用作为契约
- 第三方 client 集成方使用作为协议参考
- review 时与 schema 文件互相对照

任何 schema 变更必须先更新 `RH2-llm-delta-policy.md` design,再同步更新本文件。设计文件是 ground truth,本文件是公共 API mirror。
