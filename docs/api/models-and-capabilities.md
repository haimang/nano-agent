# Models and Capabilities API

> 状态: RH5 executed
> 适用版本: `@haimang/nacp-session@1.4.0`
> 入口 worker: `orchestrator-core`

## 1. Model catalog

`GET /models` 返回当前 team 可用的模型目录。模型真相源是 D1 `nano_models`，并叠加 `nano_team_model_policy` 做 team-level deny 过滤。

成功响应中的每个模型包含：

| 字段 | 说明 |
|---|---|
| `model_id` | Workers AI model id，例如 `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `family` | catalog family，用于 UI 分组 |
| `display_name` | 展示名 |
| `context_window` | 上下文窗口 |
| `capabilities.reasoning` | 是否允许 `reasoning.effort` |
| `capabilities.vision` | 是否允许 `image_url` content part |
| `capabilities.function_calling` | 是否允许工具/function calling |
| `status` | 当前仅 active 模型会返回给 client |

RH5 preview seed 已写入 25 个模型，其中 4 个 vision、8 个 reasoning。

## 2. Session start and messages schema

`@haimang/nacp-session@1.4.0` 新增可选字段：

```ts
{
  model_id?: string;
  reasoning?: { effort: "low" | "medium" | "high" };
}
```

`SessionMessagePostBodySchema` 定义 `/sessions/{session_uuid}/messages` body：

```ts
{
  parts: Array<
    | { kind: "text"; text: string }
    | { kind: "artifact_ref"; artifact_uuid: string; mime?: string; summary?: string }
    | { kind: "image_url"; url: string; mime?: string; mimeType?: string }
  >;
  model_id?: string;
  reasoning?: { effort: "low" | "medium" | "high" };
  trace_uuid?: string;
  context_ref?: unknown;
  stream_seq?: number;
}
```

## 3. Image URL rules

RH5 只允许 session-owned file content endpoint 作为 `image_url` 来源：

```text
/sessions/{session_uuid}/files/{file_uuid}/content
nano-file://{session_uuid}/{file_uuid}
https://.../sessions/{session_uuid}/files/{file_uuid}/content
```

Agent-core 会通过 `FILESYSTEM_CORE.readArtifact` 读取该文件，并在 Workers AI 调用前转换为 provider 可消费的 data URL。不要把任意公网 URL 直接传给 `/messages`。

## 4. Reasoning and capability errors

当请求包含 `reasoning` 时，runtime 会检查目标模型是否支持 reasoning，以及 effort 是否在模型允许范围内。不支持时返回/记录 `CAPABILITY_MISSING`，不会 silent-drop。

当请求包含 `image_url` 时，runtime 会检查目标模型是否支持 vision。不支持时返回/记录 `CAPABILITY_MISSING`，不会 silent-drop。

## 5. Usage evidence

RH5 扩展 `nano_usage_events`，LLM allow event 会记录：

```ts
{
  provider_key: "workers-ai";
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  is_reasoning: 0 | 1;
  is_vision: 0 | 1;
  request_uuid: string;
}
```

这些字段只提供 evidence，不在 RH5 引入 per-model quota 或 billing。
