# Blueprint — `llm-wrapper` → `workers/agent-core/src/llm/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(A3 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A3 聚合于 A1-A5)
> 相关原始素材：
> - `packages/llm-wrapper/package.json`
> - `packages/llm-wrapper/src/{index,version,usage,errors,canonical,request-builder,attachment-planner,prepared-artifact,executor,stream-normalizer,session-stream-adapter,gateway}.ts`
> - `packages/llm-wrapper/src/adapters/{openai-chat,types}.ts`
> - `packages/llm-wrapper/src/registry/{providers,models,loader}.ts`
> - `packages/llm-wrapper/test/{canonical,attachment-planner,executor,registry,request-builder,session-stream-adapter,stream-normalizer}.test.ts`
> - `packages/llm-wrapper/test/integration/{fake-provider-worker,local-fetch-stream,prepared-artifact-routing,retry-timeout}.test.ts`

---

## 1. 这个 blueprint 解决什么问题

1. `llm-wrapper` 是 `agent.core` 的 LLM 侧 canonical 层:canonical model / provider registry / request builder / stream normalizer / attachment planner / executor + OpenAI adapter。它是 `KernelDelegates` 中 llm 委托的实装点,被 A1 host shell 通过 `InferenceGateway` / `LLMExecutor` 接入。
2. 它代表的是 **"runtime glue 重、adapter 边界清晰、integration test 含 fake-provider-worker"** 的 absorption 难度;规模 ~3121 LOC(src ~1483 含 adapters/registry + test ~1638 含 integration)。
3. 进入 worker-matrix 时,这份 blueprint 让 P1.A / A3 sub-PR 作者少想:
   - 源文件 → 目标文件的映射表(12 root src + 2 adapters + 3 registry = 17 src;7 unit tests + 4 integration tests)
   - `adapters/` 与 `registry/` 子目录原样保留
   - `test/integration/fake-provider-worker.test.ts` 如何处理(见 §5)
   - `PreparedArtifactRef` / `ArtifactRefLike` 与 context-core / filesystem-core 的边界(归 D03 / D04,不在 A3 里 merge)

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/llm-wrapper`
  - 版本:`0.1.0`
  - scripts:`build / typecheck / test / test:coverage`
  - **零 runtime dependency**;`peerDependencies.zod >= 3.22.0`;`devDependencies: typescript / vitest / zod`
- **实测:`src/**` 内零 `@nano-agent/*` 或 `@haimang/*` 跨包 import**(已 grep 验证)
- public surface 由 `src/index.ts`(74 行)汇总导出全 public API
- 实测 LOC:src ~1483(含 adapters / registry)/ test ~1638(含 integration)/ 合计 ~3121

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API aggregator | `packages/llm-wrapper/src/index.ts` | 22 named + type exports |
| version | `src/version.ts` | `LLM_WRAPPER_VERSION` |
| usage & finish reason | `src/usage.ts` | `LLMUsage / FinishReason / createEmptyUsage` |
| errors | `src/errors.ts` | `LlmWrapperError` + `LLMErrorCategory / LLMError` |
| canonical model | `src/canonical.ts` | `CanonicalLLMRequest / CanonicalMessage / ContentPartKind` 等完整 canonical 表达 |
| request builder | `src/request-builder.ts` | `buildExecutionRequest → ExecutionRequest` |
| attachment planner | `src/attachment-planner.ts` | `planAttachment` + `AttachmentRoute / AttachmentPlan` + `SUPPORTED_MIME_TYPES` |
| prepared artifact | `src/prepared-artifact.ts` | `PreparedArtifactRef / ArtifactRefLike` + `toWorkspacePreparedArtifactRef` |
| executor | `src/executor.ts` | `LLMExecutor` class + `LLMExecutorOptions` — 主 runtime |
| stream normalizer | `src/stream-normalizer.ts` | `normalizeStreamChunks` |
| session stream adapter | `src/session-stream-adapter.ts` | `mapLlmEventToSessionBody` + `SessionEventBody / SessionEventKind` |
| gateway interface | `src/gateway.ts` | `InferenceGateway` interface(仅 interface;host 注入实装)|
| OpenAI adapter | `src/adapters/openai-chat.ts` | `OpenAIChatAdapter` — 默认 chat adapter |
| adapter types | `src/adapters/types.ts` | `ChatCompletionAdapter` interface |
| provider registry | `src/registry/providers.ts` | `ProviderRegistry / ProviderProfile` |
| model registry | `src/registry/models.ts` | `ModelRegistry / ModelCapabilities / CapabilityName` |
| registry loader | `src/registry/loader.ts` | `loadRegistryFromConfig / loadRegistryFromEnv` + `RegistryConfig` |
| unit tests | `test/{7 files}.test.ts` | canonical / attachment / executor / registry / request-builder / session-stream / stream-normalizer |
| integration tests | `test/integration/{4 files}.test.ts` | fake-provider-worker / local-fetch-stream / prepared-artifact-routing / retry-timeout |

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/agent-core/
  src/
    llm/
      index.ts                        # A3 public API aggregator
      version.ts
      usage.ts
      errors.ts
      canonical.ts
      request-builder.ts
      attachment-planner.ts
      prepared-artifact.ts
      executor.ts                     # LLMExecutor — 被 A1 host 通过 KernelDelegates 注入
      stream-normalizer.ts
      session-stream-adapter.ts
      gateway.ts                      # InferenceGateway interface
      adapters/
        openai-chat.ts
        types.ts
      registry/
        providers.ts
        models.ts
        loader.ts
  test/
    llm/
      attachment-planner.test.ts
      canonical.test.ts
      executor.test.ts
      registry.test.ts
      request-builder.test.ts
      session-stream-adapter.test.ts
      stream-normalizer.test.ts
      integration/
        fake-provider-worker.test.ts
        local-fetch-stream.test.ts
        prepared-artifact-routing.test.ts
        retry-timeout.test.ts
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `src/index.ts` | `workers/agent-core/src/llm/index.ts` | 重建 exports;byte-identical | 22 exports 保持 |
| `src/{12 root files}` | `llm/{同名}` | 原样迁移 | |
| `src/adapters/{openai-chat,types}.ts` | `llm/adapters/{同名}` | 原样迁移 | adapters/ 保留子目录 |
| `src/registry/{providers,models,loader}.ts` | `llm/registry/{同名}` | 原样迁移 | registry/ 保留子目录 |
| `test/{7 unit}.test.ts` | `test/llm/{同名}` | 调整相对 import | |
| `test/integration/{4 files}.test.ts` | `test/llm/integration/{同名}` | 调整相对 import | fake-provider-worker 需同步 fixture |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency

- `zod`:保持 peerDependency(host shell 已有)
- 无其他外部 runtime dep

### 4.2 跟随 absorb 一起内化

- 全部 17 src + 11 test 文件,包含 `adapters/` 与 `registry/` 子目录
- `InferenceGateway` interface 随 `gateway.ts` 内化;实装由 host 注入(未来可能使用 AI Gateway binding)
- `OpenAIChatAdapter` 随 `adapters/openai-chat.ts` 内化;首波保持 fetch-based 远端调用不走 binding

### 4.3 不在本 blueprint 内解决

- AI Gateway binding 的 wrangler 配置(归 D06 default composition / remote bindings 的 AI binding design;charter §4 远期视图)
- `PreparedArtifactRef` 与 filesystem-core 的 consumer 切换(归 D04;A3 保持 `ArtifactRefLike` 结构 seam)
- fake-provider-worker 的 live worker deploy(package-local integration test 保持 local in-process fake,不进 workers/*)
- provider secret / env gate(归 D06 composition / D08 cutover)

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| 7 unit tests | 1:1 迁到 `workers/agent-core/test/llm/`;仅改相对 import |
| `test/integration/fake-provider-worker.test.ts` | 迁到 `test/llm/integration/`;**fake-provider-worker 保持 in-process local fake**,不新建真实 worker(worker-matrix 不扩面)|
| `test/integration/local-fetch-stream.test.ts` | 同上;LOCAL_FETCH_STREAM = dev-only seam 不扩 |
| `test/integration/prepared-artifact-routing.test.ts` | 同上;artifact ref shape 对齐 D04 D1 slice |
| `test/integration/retry-timeout.test.ts` | 同上 |
| root cross-tests(目前无 llm 专属)| n/a |

实测 root `test/` 目录内无 llm 专属测试,A3 整组 test 迁到 workers/agent-core 内部。

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **import 路径漂移**:`registry/loader.ts` 对 `providers.ts` / `models.ts` 的相对 import 必须在同一 sub-PR 改写
2. **`LLM_WRAPPER_VERSION` 被误 bump**:搬家 ≠ 升级
3. **`PreparedArtifactRef` 被误改接口**:A3 sub-PR 不得改 shape;该类型是 D04 D1 slice 的下游消费点,A3 与 D04 merge 顺序按 charter 决定
4. **host shell 共存期引用两份 executor**:A3 sub-PR merge 时 host 内 `LLMExecutor` import 路径必须同步切到 `workers/agent-core/src/llm/executor.js`
5. **fake-provider-worker integration test 误接真实 provider**:测试必须保持 in-process fake,不得意外调用真实 OpenAI endpoint

### 6.2 明确禁止

1. A3 sub-PR 内新增 adapter(例如 anthropic-chat 不在本 blueprint 范围)
2. A3 sub-PR 内改 canonical model shape(canonical.ts 保持 byte-identical)
3. A3 sub-PR 内把 `InferenceGateway` 接入 AI Gateway binding(归 D06)
4. A3 sub-PR 内删除 `packages/llm-wrapper/`(归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/llm-wrapper/src/{12 root + 2 adapters + 3 registry}` + `test/{7 unit + 4 integration}`
2. **目标路径列表**:`workers/agent-core/src/llm/{12 root + adapters/ + registry/}` + `workers/agent-core/test/llm/{7 unit + integration/}`
3. **依赖处理说明**:零 runtime dep;`zod` 保持 peerDependency;host shell 的 llm import 路径改写
4. **测试迁移说明**:7 unit + 4 integration 1:1 迁;fake-provider-worker 保持 in-process fake
5. **optional / deferred 项声明**:
   - AI Gateway binding / 第二 adapter / provider secret gate 归后续设计
   - `PreparedArtifactRef` consumer 切换由 D04 负责

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~1483 | wc -l src/**/*.ts |
| 测试 LOC | ~1638 | 7 unit + 4 integration |
| 搬家工作量 | **M** | 17 src 含两层子目录;11 test 含 integration |
| 预估时长 | 1.5-2.5 工作日 | A2 更小;B1 更大;A3 中等 |
| 关键风险项 | `PreparedArtifactRef` shape / host import 切换 | 需 pair review D04 |

---

## 9. 一句话 verdict

A3 是 P1.A sub-PR 序列中 **规模中等 / 边界清晰 / integration test 稍重** 的一环:17 src 文件含 adapters/ 与 registry/ 两个子目录,零 runtime dep。A3 合并后 host shell 直接消费 `LLMExecutor`,`InferenceGateway` 作为 future AI Gateway binding 扩展点保留;与 D04 D1 slice 的 `PreparedArtifactRef` 边界必须在 pair review 中对齐。
