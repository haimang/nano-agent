# Real-to-Hero — RH5 Closure Memo

> 阶段: `real-to-hero / RH5 — Multi-Model Multimodal Reasoning`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Copilot`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.6
> 关联 design: `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> 文档状态: `closed`

---

## 0. 一句话 verdict

> **RH5 主链已闭合并上线 preview**：`@haimang/nacp-session@1.4.0` 已发布；migration `011-model-capabilities-seed.sql` 已 apply 到 preview D1，模型目录达到 `25` 个模型（`4` vision / `8` reasoning）；agent-core runtime 从 D1 读取模型能力并执行指定 `model_id`；`/messages` 已支持 `image_url` + `reasoning.effort`；session file image 会经 filesystem-core 读取并转换为 data URL 后交给 Workers AI；usage event 已记录 `{model_id,input_tokens,output_tokens,estimated_cost_usd,is_reasoning,is_vision,request_uuid}`。

> 本轮还补了一个 live-only schema debt：preview D1 的 `nano_usage_events.session_uuid` FK 残留指向 table-swap 旧表 `nano_conversation_sessions_old_v6`，导致 LLM postprocess 写 usage 失败；已通过 `012-usage-events-fk-repair.sql` forward-only rebuild 修正到 `nano_conversation_sessions`。

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|---|---|---|
| Phase 1 — Schema 前置扩展 | ✅ closed | `SessionStartBodySchema` / `SessionFollowupInputBodySchema` 增加 `model_id` + `reasoning`；新增并导出 `SessionMessagePostBodySchema`；`CanonicalLLMRequest.reasoning` 落地 |
| Phase 2 — Migration 011 + Seed | ✅ closed | `011-model-capabilities-seed.sql` seed 25 模型；preview D1 `model_count=25, vision_count=4, reasoning_count=8` |
| Phase 3 — Request-builder + Adapter | ✅ closed | request-builder 对 reasoning/vision 做 capability gate；Workers AI adapter 传递显式 model、`reasoning_effort` 与 image content |
| Phase 4 — Vision 激活 | ✅ closed | `/messages` 接受 `image_url`；agent-core 通过 filesystem-core 解析 session file image 为 data URL；live image smoke 通过 |
| Phase 5 — Reasoning Effort 贯通 | ✅ closed | `reasoning.effort` 从 client body → TurnInput → canonical request → Workers AI adapter → usage evidence 全链路贯通 |
| Phase 6 — Usage Event 扩字段 | ✅ closed | `nano_usage_events` 增加 RH5 evidence 字段；`012` 修复 stale FK 后 live 写入恢复 |
| Phase 7 — E2E + Preview Smoke | ✅ closed | 新增 RH5 package live e2e；preview 6/6 health；real LLM、image、reasoning、usage evidence 全部验证通过 |

---

## 2. Preview 证据

| 项 | 结果 |
|---|---|
| `@haimang/nacp-session` | `1.4.0` 已发布到 GitHub Packages |
| migration 011 | ✅ preview remote applied |
| migration 012 | ✅ preview remote applied；`PRAGMA foreign_key_list(nano_usage_events)` 指向 `nano_conversation_sessions` |
| preview deploy | agent-core / orchestrator-core / bash-core / context-core / filesystem-core 已刷新 |
| `/debug/workers/health` | `live: 6 / total: 6`，除 orchestrator-auth 外 5 个 NACP worker 均返回 `nacp_session_version=1.4.0` |
| D1 model seed | `model_count=25`, `vision_count=4`, `reasoning_count=8` |
| live LLM smoke | `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` 通过，usage anchor `d67dab27-b9c5-4d0c-93c4-1369b89244ce` |
| live RH5 smoke | `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs` 通过 |
| final image/reasoning evidence | session `a5b13d38-e85d-4bb9-abcc-6530c025e696`，file `482bb284-1787-4f5e-9f15-2fc2b319ef9c`，usage `model_id=@cf/meta/llama-4-scout-17b-16e-instruct`, `is_reasoning=1`, `is_vision=1`, `input_tokens=2169`, `output_tokens=9` |

---

## 3. 已知 carry-over

| 项 | 状态 | 去向 |
|---|---|---|
| RH4 Lane E agent-core workspace consumer sunset | 仍是 RH4 已记录的 carry-over；RH5 只消费 client-facing files surface + filesystem-core RPC `readArtifact` | RH6 / follow-up Lane E |
| 多 provider / per-model quota / billing | 按 RH5 design 明确 out-of-scope；RH5 只记录 usage evidence | hero-to-platform |
| exhaustive 4-model live matrix | 本轮用 `/models` 目录 + D1 seed + 1 条真实 vision/reasoning live smoke 收口；未把 4 个模型逐一实时调用作为强 gate | 后续成本/稳定性允许时扩展 e2e |

---

## 4. RH6 入口判断

RH5 已满足 RH6 入口所需的模型目录、reasoning、vision image、usage evidence 与 preview deploy 条件。RH6 可以启动；但如果 RH6 需要继续扩大 filesystem/megafile 路径，应同时关注 RH4 Lane E consumer sunset carry-over。
