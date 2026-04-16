# Action-Plan 终审报告 — Go/No-Go 裁决与执行编排

> 审核对象: 全部 10 份 action-plan
> - `nacp-core.md` — 已执行完毕（210 tests, 2 commits）
> - `nacp-session.md` — 已执行完毕（103 tests, 3 commits）
> - `agent-runtime-kernel.md` — 待执行
> - `llm-wrapper.md` — 待执行
> - `capability-runtime.md` — 待执行
> - `workspace-context-artifacts.md` — 待执行
> - `hooks.md` — 待执行
> - `eval-observability.md` — 待执行
> - `storage-topology.md` — 待执行
> - `session-do-runtime.md` — 待执行
> 终审者: `Claude Opus 4.6 (1M context)`
> 终审时间: `2026-04-16`
> 终审依据:
> - `docs/investigation/action-batch-1-reviewed-by-opus.md`（Batch 1 审核，51 项引用全部通过）
> - `docs/investigation/action-batch-2-reviewed-by-opus.md`（Batch 2 审核，18 项引用全部通过）
> - `docs/plan-after-nacp.md`（总体规划蓝图）
> - `README.md`（项目精神与技术栈）
> - `packages/nacp-core/` + `packages/nacp-session/`（已实现代码基座）
> - `context/codex/` + `context/claude-code/` + `context/mini-agent/` + `context/just-bash/`（参考代码事实）
> - Batch 1 + Batch 2 审核意见的二次更新确认
> 文档状态: `final-review`

---

## 0. 终审范围与方法

本文不重复 Batch 1 和 Batch 2 中已确认的内容（代码引用验证、逐份 Phase 评审、跨文档对齐表），而是站在**立即执行的全局视角**，回答三个问题：

1. **Go or No-Go**：8 份待执行 action-plan 是否全部达到可执行标准？
2. **执行编排**：10 个包的 Phase 如何编排才能最快到达"最小可运行 session skeleton"？
3. **残余模糊空间**：是否还有需要业主拍板的决策点？

---

## 1. Go/No-Go 裁决

### 1.1 前置条件检查

| 前置条件 | 状态 |
|---------|------|
| `nacp-core` 已收口（210 tests） | ✅ |
| `nacp-session` 已收口（103 tests） | ✅ |
| 全部 8 份设计文档已完成 | ✅ |
| 全部 8 份 action-plan 已完成 | ✅ |
| Cross-doc alignment（Stage C）已通过 GPT/Kimi/Opus 三轮交叉审核 | ✅ |
| Batch 1 审核意见已被二次更新吸收 | ✅ 已验证 |
| Batch 2 审核意见已被二次更新吸收 | ✅ 已验证 |
| 69 项代码/文档引用全部通过验证 | ✅ |
| 全部 Q&A 已回答（除 session-do Q2/Q3 推荐答案可直接采纳） | ⚠️ 见 §4 |

### 1.2 Batch 1/2 审核意见的吸收验证

| 审核意见 | 吸收状态 | 验证方式 |
|---------|---------|---------|
| capability-runtime Q1 全量 just-bash 移植与正文矛盾 | ✅ 已改为 "allowlist / deferred / OOM-risk 分阶段" | grep 确认正文已更新 |
| llm-wrapper API key 轮换字段缺失 | ✅ 已加入 `api_keys[]` + `key_rotation_policy` | grep 确认 P2-01 已更新 |
| llm-wrapper mime_type 路由缺失 | ✅ 已在 attachment planner 中纳入 | grep 确认 |
| eval-observability DurablePromotionRegistry 缺失 | ✅ 已新增 `durable-promotion-registry.ts` 到目录树和 Phase 1 | grep 确认 |
| storage-topology mime_type 作为 placement 输入 | ✅ 已加入 P3-01 和 S7 | grep 确认 |
| storage-topology 每个 provisional plan 附带 revisit rationale | ✅ 已加入收口标准 | grep 确认 |

### 1.3 最终裁决

| 包 | 裁决 | 条件 |
|----|------|------|
| `agent-runtime-kernel` | **GO** | 无前置条件 |
| `llm-wrapper` | **GO** | 无前置条件 |
| `workspace-context-artifacts` | **GO** | 无前置条件 |
| `capability-runtime` | **GO** | 无前置条件 |
| `hooks` | **GO** | 无前置条件 |
| `eval-observability` | **GO** | 无前置条件 |
| `storage-topology` | **GO** | 无前置条件 |
| `session-do-runtime` | **GO** | 业主需先采纳 Q2/Q3 推荐答案（见 §4） |

> **全部 8 份 action-plan 裁决为 GO。nano-agent 可以进入 Stage E（代码实现）。**

---

## 2. 执行编排：从 10 个包到最小可运行骨架

### 2.1 核心原则

`plan-after-nacp.md` §5.5 已给出编排框架。本节在其基础上做精确到 Phase 的编排，目标是：

> **用最短路径到达"一次完整的 attach → turn → tool call → checkpoint → resume"端到端验证。**

### 2.2 依赖图

```
nacp-core ────────────────────────────────────────────┐
nacp-session ─────────────────────────────────────────┤
                                                      ▼
┌─────────────────── Phase 1 并行（只依赖 NACP 包）──────────────────┐
│  kernel P1        workspace P1       hooks P1       eval P1       │
│  llm P1           capability P1      storage P1                   │
└──────────────┬────────────┬──────────┬─────────┬──────────────────┘
               │            │          │         │
               ▼            ▼          ▼         ▼
┌──── Phase 2 优先推进 ──────────────────────────────────────────────┐
│  storage P2 (key/ref builders)    独立                             │
│  eval P2 (sink/codec/timeline)    独立                             │
│  hooks P2-P3 (registry/dispatcher/runtime)   独立                  │
│  kernel P2 (reducer/scheduler)    独立                             │
│  workspace P2 (mount/backends)    独立                             │
│  llm P2 (registry/builder/planner)  需要 workspace P1 类型         │
│  capability P2 (planner/fake-bash)  需要 workspace P1 类型         │
└──────────────┬────────────────────────────────────────────────────┘
               │
               ▼
┌──── Phase 3-5 推进 ───────────────────────────────────────────────┐
│  kernel P3-P5         需要 nacp-session stream reality            │
│  llm P3-P5            需要 workspace P1 PreparedArtifactRef       │
│  capability P3-P5     需要 workspace P3 artifact promotion        │
│  hooks P4-P5          需要 nacp-core/session adapters             │
│  eval P3-P5           需要 nacp-session stream reality            │
│  storage P3-P5        需要 eval P4 StoragePlacementLog            │
│  workspace P3-P5      需要 nacp-core context.compact contract     │
└──────────────┬────────────────────────────────────────────────────┘
               │
               ▼
┌──── session-do-runtime 组装 ──────────────────────────────────────┐
│  session-do P1 ─── 可与上面并行                                    │
│  session-do P2 ─── 需要 nacp-session ingress                      │
│  session-do P3 ─── 需要 kernel P1 + hooks P1 类型                 │
│  session-do P4 ─── 需要所有子系统至少 Phase 1                      │
│  session-do P5 ─── 需要 eval + storage + workspace Phase 2+       │
│  session-do P6 ─── 最终跨包集成测试                                │
└───────────────────────────────────────────────────────────────────┘
```

### 2.3 推荐执行波次

#### Wave 0 — 已完成
- `nacp-core`（210 tests）
- `nacp-session`（103 tests）

#### Wave 1 — 全部 Phase 1 并行（约 1 周）

同时启动所有 8 个包的 Phase 1。这些 Phase 只依赖 NACP 包的类型，互不依赖。

| 包 | Phase 1 产出 | 可并行执行者 |
|----|-------------|------------|
| kernel | types / state / delegates | 执行者 A |
| workspace | paths / refs / context-layers / snapshot types | 执行者 A |
| llm-wrapper | canonical / usage / errors | 执行者 B |
| capability | types / events / result / registry interfaces | 执行者 B |
| hooks | catalog / outcome / types | 执行者 C |
| eval | trace-event / classification / DurablePromotionRegistry / metric-names | 执行者 C |
| storage | taxonomy / data-items / evidence | 执行者 D |
| session-do | env / composition / turn-ingress | 执行者 D |

**Wave 1 的 exit criteria**：所有 8 个包可独立 `build` + `typecheck`，核心 public types 冻结。

#### Wave 2 — 基础设施 Phase 2 + kernel Phase 2（约 1-2 周）

| 包 | Phase | 前置 | 理由 |
|----|-------|------|------|
| storage P2 | key/ref builders + scoped-io | storage P1 | 所有包共享的 key/ref 真相 |
| eval P2 | sink/codec/timeline | eval P1 | durable trace 基础设施 |
| hooks P2-P3 | registry/dispatcher/runtime/guards | hooks P1 | hooks runtime 完整 |
| kernel P2 | reducer/scheduler/interrupt/runner | kernel P1 | 主循环心脏 |
| workspace P2 | mount/namespace/backends | workspace P1 | fake bash 和 capability 的读写底座 |

**Wave 2 的 exit criteria**：kernel 可用 fake delegates 跑通 step loop；eval 可落 durable trace；storage key/ref builders 可被其他包消费。

#### Wave 3 — 子系统 Phase 3-5 + session-do P2-P3（约 2-3 周）

| 包 | Phase | 前置 |
|----|-------|------|
| kernel P3-P5 | event mapping / checkpoint / scenarios | kernel P2 + nacp-session |
| llm P2-P5 | registry / adapter / executor / normalizer / session mapping | llm P1 + workspace P1 |
| capability P2-P5 | planner / fake-bash / policy / targets / commands | capability P1 + workspace P2 |
| workspace P3-P5 | artifacts / prepared / context / compact / snapshot | workspace P2 + nacp-core context.compact |
| hooks P4-P5 | session mapping / audit / snapshot / integration | hooks P3 + nacp adapters |
| eval P3-P5 | inspector / runner / replay / evidence / attribution | eval P2 + nacp-session |
| storage P3-P5 | placement / checkpoint / calibration | storage P2 + eval P4 |
| session-do P2-P3 | WS/HTTP ingress / actor lifecycle / health | session-do P1 + nacp-session |

**Wave 3 的 exit criteria**：所有子系统包可独立 `build` + `typecheck` + `test`，fake delegate scenario tests 全部通过。

#### Wave 4 — session-do-runtime 组装 + 最终集成（约 1-2 周）

| 包 | Phase | 前置 |
|----|-------|------|
| session-do P4 | kernel orchestration / delegate wiring | 所有子系统 Phase 1 types + session-do P3 |
| session-do P5 | checkpoint / alarm / shutdown | session-do P4 + workspace + eval + storage |
| session-do P6 | integration tests: start → turn → checkpoint → resume | session-do P5 + 所有子系统 |

**Wave 4 的 exit criteria**：一次完整的 `attach → session.start → LLM delta → tool call → hook emit → checkpoint → detach → resume → continue` 端到端路径跑通。

### 2.4 总时间线估算

| Wave | 预估时长 | 累计 |
|------|---------|------|
| Wave 1 | 1 周 | 1 周 |
| Wave 2 | 1-2 周 | 2-3 周 |
| Wave 3 | 2-3 周 | 4-6 周 |
| Wave 4 | 1-2 周 | 5-8 周 |

> **从 Go 到最小可运行骨架，预估 5-8 周。**

---

## 3. 全局风险与缓解

### 3.1 v1 骨架的 5 个硬约束

这些是从 README、NACP 现实和已回答的 Q&A 中提取的不可协商约束：

| 编号 | 约束 | 来源 |
|------|------|------|
| H1 | Single-active-turn，无 sub-agent，无并发 lane | README §4.2 + kernel Q1 |
| H2 | Session WebSocket legality 只走 `nacp-session`，不拖回 Core | session-do §0 + GPT review Blocker A |
| H3 | 不引入 D1、不提前冻结 storage placement | plan-after-nacp §7 + storage Q1 |
| H4 | Chat Completions 作为唯一外部 wire，不引入 vendor-specific adapter | llm Q1 |
| H5 | just-bash 只作参考代码，不作 runtime dependency | capability §0 |

### 3.2 最可能导致返工的 3 个风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| **workspace mount 语义与 fake bash 理解不一致** | 中 | capability runtime 的所有文件操作都会漂移 | Wave 2 中 workspace P2 和 capability P2 必须在同一轮完成，确保 mount 语义共享 |
| **checkpoint shape 在 Wave 3/4 膨胀失控** | 中 | session-do P5 的 checkpoint 无法 restore | storage-topology 的 provisional checkpoint candidate + eval evidence 校准机制是防线 |
| **HTTP fallback controller 在 Wave 3 变成第二套 runtime** | 中 | WS 和 HTTP 的 output body 分叉 | session-do P2-03 和 P4-03 必须强制共享同一 normalized output shape |

### 3.3 远期愿景的接口保留

v1 骨架中显式为以下远期能力预留了 seam：

| 远期能力 | 预留接口 | 所在包 |
|---------|---------|-------|
| Sub-agent / multi-DO federation | kernel `InterruptReason` 可扩展 | kernel |
| Multi-client attach / observer mode | session-do composition factory | session-do |
| Background capability lane | kernel `StepDecision` 可扩展 | kernel |
| Skill runtime + skill-registered hooks | hooks registry `source` 层级 | hooks |
| Inference gateway worker | llm-wrapper `gateway.ts` seam | llm |
| D1 / structured query | storage-topology `defer` policy | storage |
| Browser rendering | capability `service-binding` target | capability |
| Full OTEL exporter | eval `TraceSink` interface | eval |
| Virtual git subset | capability `vcs.ts` seam | capability |

---

## 4. 残余 Q&A — 需要业主拍板

### 4.1 session-do-runtime Q2（HTTP fallback 写入口）

> **Q**: v1 的 HTTP fallback 是否接受"写入口最小可用 + 读取 durable 结果/状态 + 实时流仍由 WebSocket 承担"的分层策略？

**推荐答案**：是。HTTP fallback 同时支持最小写入口（start / input / cancel / end）与 durable 读取，但实时 event push 仍坚持 WebSocket-first。

**如果不回答的影响**：session-do P2-03 的 HTTP controller 无法确定设计范围。

### 4.2 session-do-runtime Q3（archive 触发责任）

> **Q**: v1 是否同意让 session-do-runtime 只承担 archive/flush 触发责任，而把最终 archive 物理策略留给 storage-topology + observability 证据收敛？

**推荐答案**：是。Session DO 只触发 seam，不写死 R2 archive 策略。

**如果不回答的影响**：session-do P5 的 checkpoint/archive 范围无法冻结。

> **建议**：这两个问题的推荐答案都是整个架构的自然推论。建议业主直接采纳推荐答案。


业主回复：是，采用推荐路径。

---

## 5. 对业主的最终建议

### 5.1 立即行动（今天）

1. **回答 session-do Q2 和 Q3**（采纳推荐答案即可）
2. **确认 Wave 1 启动**：全部 8 个包的 Phase 1 可以立即并行开始

### 5.2 第一周结束时

- 所有包的 Phase 1 完成
- 8 个包都可独立 `build` + `typecheck`
- 核心 public types 冻结，不再需要跨包 type 返工

### 5.3 第二至三周

- Wave 2 完成：kernel 可跑 step loop、eval 可落 trace、storage 有 key builders
- Wave 3 启动：子系统各自推进 Phase 3-5

### 5.4 第五至八周

- Wave 4 完成：session-do Phase 6 跑通端到端骨架
- 可以开始讨论"真实 LLM provider 接入"和"production deployment 策略"

---

## 6. 总结

### 6.1 一句话

> **10 份 action-plan 形成了完整、自洽、可执行的技术蓝图。69 项代码引用全部通过验证，全部审核意见已被吸收。裁决：全部 GO。建议立即启动 Wave 1。**

### 6.2 从协议到骨架的完整路径

```
已完成                          待执行
─────                          ─────
nacp-core (210 tests)          Wave 1: 8 包 Phase 1 并行
nacp-session (103 tests)       Wave 2: 基础设施 + kernel 心脏
                               Wave 3: 子系统 Phase 3-5
                               Wave 4: session-do 组装 + 端到端验证
```

这条路径的核心保障是：
- **协议层已冻结**（nacp-core + nacp-session = 313 tests）
- **子系统已设计**（8 份 design docs + 8 份 action plans）
- **交叉审核已完成**（GPT + Kimi + Opus 三轮）
- **所有 provisional 决策都有 evidence calibration seam**

nano-agent 的下一步不是"再讨论一轮"，而是**写代码**。

---

## 附录

### A. 10 包完整状态表

| 包 | 类型 | 状态 | Tests | Go/No-Go |
|----|------|------|-------|----------|
| nacp-core | 协议层 | ✅ 已完成 | 210 | — |
| nacp-session | 协议层 | ✅ 已完成 | 103 | — |
| agent-runtime-kernel | 运行时 | 待执行 | — | **GO** |
| llm-wrapper | 运行时 | 待执行 | — | **GO** |
| capability-runtime | 运行时 | 待执行 | — | **GO** |
| workspace-context-artifacts | 数据层 | 待执行 | — | **GO** |
| hooks | 治理层 | 待执行 | — | **GO** |
| eval-observability | 验证层 | 待执行 | — | **GO** |
| storage-topology | 存储语义层 | 待执行 | — | **GO** |
| session-do-runtime | 组装层 | 待执行 | — | **GO**（需先答 Q2/Q3） |

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v1.0 | 2026-04-16 | Opus 4.6 | 终审报告 |
