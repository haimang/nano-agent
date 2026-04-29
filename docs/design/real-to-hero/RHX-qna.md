# Real-to-Hero — RHX QNA

> 范围：`real-to-hero / RH0-RH6`
> 目的：把会影响后续 `docs/design/real-to-hero/*.md`、`docs/action-plan/real-to-hero/*.md` 与 RH0-RH6 gate 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`open question register (Q1-Q5 pending owner answers)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 这些问题**不阻断当前 design 文档产出**，但会阻断对应 phase 的 implementation start gate；各题的最晚冻结时点以 `docs/charter/plan-real-to-hero.md` §12 为准。

---

## 1. 租户 / 产品面

### Q1 — `team_slug 唯一性 / 长度 / charset 策略`（来源：`docs/charter/plan-real-to-hero.md` §12 Q1、`docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`）

- **影响范围**：`workers/orchestrator-auth/**`、`packages/orchestrator-auth-contract/**`、RH3 migration 009 schema、`PATCH /me/team`、注册时 team display 自动生成
- **为什么必须确认**：RH3 需要把 `team_name/team_slug` 变成真实产品面；如果 slug law 不冻结，migration 009、注册流程、冲突处理和 `/auth/me` 返回形状都会摇摆。
- **当前建议 / 倾向**：**采用 `slugify(ASCII-fallback) + '-' + random6chars`，global unique，长度 ≤ 32，字符集 `[a-z0-9-]`。**
- **Reasoning**：这个问题会出现，是因为 RH3 不是只加“展示名”，而是第一次把 team identity 暴露给真实 client 和 server-to-server 调用方。当前推荐路线更稳，是因为它同时满足三件事：可读、可索引、可在 D1 里做稳定唯一约束；如果不拍板，RH2/RH3 并行时 migration 009 的字段约束会悬空，后续只能靠临时补丁修 schema 和数据清洗。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 real-to-hero 阶段的 team_slug baseline 采用 ASCII slug + random6chars、global unique、长度 ≤ 32、字符集 [a-z0-9-]？如果不同意，请直接给出唯一性范围、长度上限与字符集。`
- **业主回答**：

---

## 2. 迁移 / Runtime / 模型策略

### Q2 — `Lane E dual-track sunset 时间盒长度`（来源：`docs/charter/plan-real-to-hero.md` §12 Q2、`docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`）

- **影响范围**：`workers/agent-core/wrangler.jsonc`、`workers/agent-core/src/host/**`、`workers/filesystem-core/**`、Lane E cutover 验收口径
- **为什么必须确认**：RH4 明确允许短期 `library import + RPC consumer` 并存，但 charter 同时把“不能永久并存”写成硬纪律；如果没有 owner 时间盒，RH4 很容易以“先能跑”为理由长期停在双轨状态。
- **当前建议 / 倾向**：**`≤ 2 周`。**
- **Reasoning**：这个问题会出现，是因为 RH4 既要把 filesystem-core 变成真实业务 RPC，又不能一次性把 agent-core 的旧 library path 全部拔掉，短期双轨是合理工程手段；但没有 sunset 的双轨几乎一定会变成永久遗留。当前推荐路线更稳，是因为它给 RH4 一个明确的“迁移窗口”而不是“技术债许可”；如果不拍板，RH4 的 closure 将很难判定到底是“已经 consumer migration”还是“只是又多了一条 path”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 RH4 的 Lane E dual-track sunset 时间盒为 ≤ 2 周？如果不同意，请明确允许的最长并存窗口。`
- **业主回答**：

### Q3 — `per-model quota 是否在 RH5 引入`（来源：`docs/charter/plan-real-to-hero.md` §12 Q4、`docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`）

- **影响范围**：`GET /models` policy surface、`nano_usage_events`、quota gate、RH5 scope 边界
- **为什么必须确认**：RH5 会把 13+4+8 模型推到真实 product surface；如果同时引入 per-model quota，RH5 会从“能力上线”膨胀为“计费策略设计”，直接越界到 hero-to-platform。
- **当前建议 / 倾向**：**不在 RH5 引入 per-model quota；只记录 `model_id` 到 usage evidence。**
- **Reasoning**：这个问题会出现，是因为 reasoning / vision 模型天然成本更高，看起来很诱人去做细粒度配额控制；但 RH5 当前真正要解决的是“模型选择、能力校验、reasoning 参数贯通、多模态可用”。当前推荐路线更稳，是因为它把 quota 问题收敛成“记录事实，不立即做策略”；如果不拍板，RH5 很容易把注意力从 runtime wiring 转移到 billing-like policy，拖慢整个 phase。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 RH5 不引入 per-model quota，只做 model_id usage 记录与 team policy filter？如果不同意，请明确是按模型、按模型族，还是按 reasoning/vision 能力做配额。`
- **业主回答**：

---

## 3. Evidence / Bootstrap / Gate

### Q4 — `manual evidence 真机品牌 / 微信版本范围`（来源：`docs/charter/plan-real-to-hero.md` §12 Q3、`docs/design/real-to-hero/RH6-do-megafile-decomposition.md`）

- **影响范围**：RH6 manual evidence pack、`docs/evidence/**`、closure 通过标准
- **为什么必须确认**：RH6 的 evidence 不是“拍几张图”，而是 final closure 的硬闸之一；如果覆盖范围不冻结，closure 阶段会反复争论“这套证据够不够”。
- **当前建议 / 倾向**：**`iOS 17 Safari + Android 14 Chrome + 微信 8.0 真机各 1 套；微信开发者工具最新 stable 1 套；浏览器 Chrome stable 1 套。`**
- **Reasoning**：这个问题会出现，是因为 RH6 要同时证明 web、wechat-devtool 和真实设备三条链路可持续使用，而不是单一 happy-path demo。当前推荐路线更稳，是因为它足够覆盖 first-wave 客户端分布，又没有把 evidence 范围膨胀成测试矩阵工程；如果不拍板，RH6 closure 很容易在“还差哪台设备/哪个版本”上反复返工。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 RH6 manual evidence 的基线覆盖范围为 iOS 17 Safari、Android 14 Chrome、微信 8.0 真机、微信开发者工具 stable、Chrome stable 浏览器各 1 套？如果不同意，请直接给出你要求的设备 / 版本组合。`
- **业主回答**：

### Q5 — `RH0 P0-F owner-action 凭据 checklist 验证执行`（来源：`docs/charter/plan-real-to-hero.md` §12 Q5、`docs/design/real-to-hero/RH0-bug-fix-and-prep.md`）

- **影响范围**：RH0 start gate、`docs/owner-decisions/real-to-hero-tooling.md`、preview deploy 准备、凭据可用性审计
- **为什么必须确认**：charter 已经把 tooling / credential readiness 从“记忆中的前提”升级成必须可审计的 owner action；如果这一步不被真正执行并签字，RH0 的 Start Gate 仍然是不完整的。
- **当前建议 / 倾向**：**在 RH0 启动当天，由 owner 执行并回填 6 步 checklist：`wrangler whoami`、`gh auth status`、`pnpm --filter @haimang/jwt-shared build`（带 `NODE_AUTH_TOKEN`）、`wrangler r2 bucket list`、`wrangler kv namespace list`、`wrangler ai models --json | wc -l`。**
- **Reasoning**：这个问题会出现，是因为 RH0 的很多工作表面上是“代码 prep”，但真实 gate 其实取决于外部凭据、Cloudflare 资源和包发布权限是否齐备。当前推荐路线更稳，是因为它把环境 readiness 明确成一次 owner 可审计动作，而不是把失败推迟到 implementation 中途才暴露；如果不拍板，RH0 可能在完成一半代码后才发现 deploy / build 根本无法执行，造成整阶段空转。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 RH0 启动当天由 owner 执行并回填这 6 步 tooling checklist，并把结果写入 docs/owner-decisions/real-to-hero-tooling.md？`
- **业主回答**：

---

## 4. 使用约束

### 4.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 4.2 哪些问题不应进入 QNA

- **实现细节微调**：例如局部命名、内部脚本组织、单个测试文件布局
- **已有 frozen answer 的重复提问**：除非本次要正式推翻旧答案
- **只影响单个函数或单个包内部实现、不会改变外部治理边界的问题**

### 4.3 `Reasoning` 的写法要求

- 要写给**非项目作者、但需要做决策的人**
- 要解释：
  1. **这个问题为什么会出现**
  2. **为什么当前推荐路线更稳**
  3. **如果不拍板，会导致什么工程或业务后果**
- 避免只写“建议这样做”，而不解释其背后的 trade-off

### 4.4 `问题` 的写法要求

- 必须是**业主可以直接作答**的句子
- 尽量避免把多个独立决策捆成一题
- 若问题天然包含两个子决策，需在问题里明确写出“如果确认，请同时回答 X / Y”

### 4.5 `业主回答` 的使用要求

- 业主回答应尽量简洁、明确、可执行
- 一旦填写，应同步成为后续 design / action-plan / review 的唯一口径
- 如果后续要推翻答案，应在同一份 QNA 中追加修订说明，而不是在别处悄悄改口
