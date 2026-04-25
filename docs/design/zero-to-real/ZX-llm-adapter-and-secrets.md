# Nano-Agent 功能簇设计模板

> 功能簇: `ZX LLM Adapter and Secrets`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`、`docs/eval/zero-to-real/plan-hardening-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前 `agent.core` 已有 kernel scaffold，但 provider 主路径仍不够真实。与此同时，zero-to-real 又必须控制复杂度，因此本设计文档要把“provider strategy + secrets engineering + adapter boundary”一次性定清：本阶段 required first provider 只有 Workers AI；DeepSeek 只保留 optional adapter skeleton / fallback track，不得反客为主。

- **项目定位回顾**：Z3 需要 real provider，但不能因此把 zero-to-real 变成大型多 provider secrets 项目。
- **本次讨论的前置共识**：
  - Workers AI first 是 charter 显式决策。
  - `workers/agent-core/src/llm/gateway.ts` 当前仍是未来 seam/stub。
  - DeepSeek 可保留 skeleton，但不是 Z3 required path。
  - BYO key / per-tenant secrets 若进入，必须走受控表与 cache discipline。
- **显式排除的讨论范围**：
  - full fallback chain
  - multi-provider routing 平台
  - 完整 KMS/tenant secret governance 大工程

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`ZX LLM Adapter and Secrets`
- **一句话定义**：冻结 zero-to-real 的 provider baseline、adapter boundary、secret 存放与 rotation/cache 纪律。
- **边界描述**：本功能簇**包含** Workers AI first、DeepSeek optional skeleton、tenant secret reserved path、adapter execution boundary；**不包含** full model marketplace。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| required provider | Z3 通过 real runtime proof 必须接通的 provider | 本阶段只有 Workers AI |
| optional adapter skeleton | 允许保留代码与配置扩展位，但不承诺成为 production baseline | 适用于 DeepSeek |
| provider adapter | 把外部 provider API 归一化到 agent runtime 的实现 | 不直接暴露给 client |
| tenant secret | 属于 team/tenant 的 provider credential | 本阶段尽量避免 required |
| secret cache | 在 hot-state 短时缓存解密后的 secret/material | 只能是辅助层 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1.8 / §7.4
- `docs/eval/zero-to-real/plan-hardening-by-GPT.md` — §5.3 / §5.5
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **real model boundary** 的角色。
- 它服务于：
  - `agent.core`
  - Z3 runtime proof
  - later DeepSeek / BYO key evolution
- 它依赖：
  - kernel loop
  - D1 minimal schema
  - quota / evidence wiring
- 它被谁依赖：
  - `Z3-real-runtime-and-quota.md`
  - later admin/secret governance

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Runtime/quota | provider -> runtime | 强 | Z3 的核心执行边界 |
| D1 schema | secret -> persistence | 中 | 仅当 BYO key 进入时 |
| NACP realization | provider -> evidence | 中 | llm evidence 要可 trace-linked |
| Clients | weak | 弱 | provider 不应直接泄漏到 client contract |
| Auth/tenant | secret scoping | 中 | tenant-level secret 需要 team boundary |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`ZX LLM Adapter and Secrets` 是 **real provider 的边界设计文档**，负责 **把 provider 主路径、fallback 位、tenant secret 纪律一次性收紧**，对上游提供 **可持续扩展的 adapter seam**，对下游要求 **Z3 只以 Workers AI first 达成 required runtime truth**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 多 provider required baseline | 通用推理网关思路 | 会显著扩大 Z3 复杂度 | 是 |
| per-tenant BYO key day-1 必需 | 面向平台化的 advanced feature | 不是 first real run 必需条件 | 是 |
| provider 原生 stream 直透客户端 | 省事但泄漏 provider 细节 | 应由 session/runtime 归一化 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| adapter registry | `provider -> adapter` 映射 | Workers AI + optional DeepSeek skeleton | 更多 provider |
| tenant secrets | `nano_tenant_secrets` / equivalent | reserved / optional | BYO key / rotation policy |
| fallback policy | config / runtime policy | 不强制启用 | 多 provider fallback |
| secret cache | DO SQLite hot cache | 短时缓存 | richer TTL / revalidation |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：provider adapter vs client-visible stream format
- **解耦原因**：客户端看到的应是 session stream truth，而不是 provider API 原形。
- **依赖边界**：provider 层只输出给 runtime/kernel/session mapper，不直接向外暴露。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：provider choice、secret discipline、fallback rules
- **聚合形式**：由本设计集中冻结
- **为什么不能分散**：否则 Z3 会同时出现多套 provider/secrets 假设。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：provider abstraction 相对轻。
- **亮点**：
  - 起步简单
- **值得借鉴**：
  - 不要为了未来 provider 扩展把当前 required path 写得过重
- **不打算照抄的地方**：
  - 继续停留在轻量、不可持续的 provider boundary

### 4.2 codex 的做法

- **实现概要**：provider/执行层抽象较明确。
- **亮点**：
  - 归一化边界清楚
- **值得借鉴**：
  - adapter 层与上层 runtime 解耦
- **不打算照抄的地方**：
  - 本地执行环境前提

### 4.3 claude-code 的做法

- **实现概要**：更强调上层控制与本地交互。
- **亮点**：
  - 上层控制面对下层 provider 细节有隔离
- **值得借鉴**：
  - provider 细节不要泄漏进 client-facing contract
- **不打算照抄的地方**：
  - 把本地网络/SDK 假设外推到 Worker runtime

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| provider abstraction | 低 | 中高 | 中 | 中高 |
| multi-provider first wave | 低 | 中 | 中 | 低 |
| secret engineering emphasis | 低 | 中 | 中 | 中 |
| client/provider decoupling | 低 | 高 | 高 | 高 |
| worker-native suitability | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** Workers AI first provider baseline
- **[S2]** provider adapter boundary 冻结
- **[S3]** optional DeepSeek adapter skeleton
- **[S4]** tenant secret reserved path / optional table位
- **[S5]** basic secret rotation/cache discipline

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 多 provider required baseline
- **[O2]** full BYO key 平台
- **[O3]** 完整 secret governance / KMS 平台
- **[O4]** provider-native raw event 直接暴露给客户端

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| DeepSeek adapter skeleton | in-scope | 作为后续可控扩展位 |
| DeepSeek production baseline | out-of-scope（Z3） | 会把 Z3 扩到 secrets 大工程 |
| `nano_tenant_secrets` | conditional in-scope | 只有当 BYO key/tenant secret 确实进入时才必须落地 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **Workers AI first** 而不是 **DeepSeek primary**
   - **为什么**：Workers AI 是 platform-native binding，可最快让 fake provider 退场。
   - **我们接受的代价**：first-wave 灵活性较低。
   - **未来重评条件**：当 Z3 已闭合且 BYO key 成为真实需求时。

2. **取舍 2**：我们选择 **DeepSeek skeleton** 而不是 **完全不留位**
   - **为什么**：这样后续扩张不会推翻当前 adapter 边界。
   - **我们接受的代价**：设计文档要多处理一层 optional path。
   - **未来重评条件**：如果 owner 明确不再考虑外部 provider，可移除。

3. **取舍 3**：我们选择 **secret discipline 前置冻结** 而不是 **先硬编码、后面再说**
   - **为什么**：一旦 real provider 进主路径，secret 管理就不能是临时补丁。
   - **我们接受的代价**：需要提前考虑表位、cache、rotation。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| Z3 scope 失控 | 把 DeepSeek/BYO key 也当 required | runtime 闭环延期 | 固定 Workers AI 为唯一 required provider |
| secret truth 漂移 | env、DO cache、D1 没有纪律 | 无法轮换与审计 | 单独冻结 secret path |
| provider detail 泄漏 | client 直接消费 provider-native stream | 未来 adapter 难替换 | 统一经 runtime/session mapper 输出 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：能快速把 fake provider 从主路径拿掉。
- **对 nano-agent 的长期演进**：后续 DeepSeek/BYO key 进入时不必重写核心边界。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：真实模型输出是这些能力进入真实使用面的前提。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Workers AI Baseline | 让 real provider 进入主路径 | ✅ **fake provider 不再是 production default** |
| F2 | Adapter Boundary | provider 输出统一经 runtime/session 映射 | ✅ **provider 细节不泄漏到 client contract** |
| F3 | Secret Discipline | secret 来源、cache、rotation 基线明确 | ✅ **真实 provider 不依赖硬编码/隐式 env 假设** |
| F4 | DeepSeek Skeleton | optional fallback track 预留 | ✅ **未来扩展不推翻当前架构** |

### 7.2 详细阐述

#### F1: `Workers AI Baseline`

- **输入**：LLM request / runtime messages
- **输出**：真实模型响应与 usage/evidence
- **主要调用者**：`agent.core`
- **核心逻辑**：Z3 required path 只要求 Workers AI 进入主路径。
- **边界情况**：
  - 需要与 quota gate 串联
  - 输出仍归一化为 session stream truth
- **一句话收口目标**：✅ **agent loop 已返回真实模型内容**

#### F2: `Secret Discipline`

- **输入**：env secrets、optional tenant secrets、hot cache
- **输出**：受控 secret 读取与轮换纪律
- **主要调用者**：provider adapter、runtime host
- **核心逻辑**：platform secret 优先；tenant secret 仅作为条件扩展位。
- **边界情况**：
  - 是否引入 `nano_tenant_secrets` 由 Q8 决定
  - cache 只能是辅助层，不是 secret 真相层
- **一句话收口目标**：✅ **provider secret 已有可审计、可轮换、可缓存的明确路线**

### 7.3 非功能性要求

- **性能目标**：provider 引入后，延迟变化应可观测。
- **可观测性要求**：llm usage / model / provider 选择应进入 trace/evidence。
- **稳定性要求**：provider 不可继续通过 stub/gateway placeholder 掩盖。
- **测试覆盖要求**：Workers AI happy path、fallback-disabled path、secret missing negative case 要有证明。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 简单模型调用思路 | 提醒 provider abstraction 不要过度膨胀 | 仅作克制提醒 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | 执行边界与抽象层 | adapter 与上层 runtime 要清楚分层 | 对 provider boundary 有启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | 上层控制与下层执行解耦 | provider 细节不应泄漏到交互层 | 间接启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/llm/gateway.ts` | 当前仅是未来 seam/stub | Z3 要把真实 provider 接进主路径，而不是继续停在 placeholder |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

ZX-LLM 负责把“真实 provider”这件事收紧到可执行的范围内：Workers AI first，DeepSeek skeleton second，secret discipline 前置。它既避免 Z3 失控，又给未来 provider 扩展留了清晰边界。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有真实 provider，就没有 real runtime |
| 第一版实现的性价比 | 4 | Workers AI first 明显优于多 provider 同时上 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | provider 真路径建立后，后续能力才能真实压测 |
| 对开发者自己的日用友好度 | 4 | secret / adapter 边界清楚后，后续接模型更稳 |
| 风险可控程度 | 4 | 通过 required/optional 分层控制 scope |
| **综合价值** | **5** | **这是 Z3 能否真实化的前置边界文档** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q8。
- [ ] **关联 Issue / PR**：Workers AI adapter、secret path、optional DeepSeek skeleton。
- [ ] **待深入调查的子问题**：
  - tenant secret 表位是否在 Z3 就需要
  - provider usage evidence 最小字段集
  - fallback 触发条件是否要先显式留空
- [ ] **需要更新的其他设计文档**：
  - `Z3-real-runtime-and-quota.md`
  - `ZX-d1-schema-and-migrations.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否一开始就让 DeepSeek 进入 required baseline
  - **A 方观点**：更灵活
  - **B 方观点**：会把 zero-to-real 扩成 secrets 项目
  - **最终共识**：Workers AI first，DeepSeek skeleton second

### B. 开放问题清单（可选）

- [ ] **Q8**：DeepSeek 的角色与 `nano_tenant_secrets` 是否在 Z3 进入主线

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
