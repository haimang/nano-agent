# Real-to-Hero — RHX QNA

> 范围：`real-to-hero / RH0-RH6`
> 目的：把会影响后续 `docs/design/real-to-hero/*.md`、`docs/action-plan/real-to-hero/*.md` 与 RH0-RH6 gate 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`owner-answered register (Q1-Q5 + Q-Obs1-Q-Obs14 已回填)`
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

- **Opus的对问题的分解**：这题实际上由 4 个子决策组成：(1) **唯一性范围** = global / per-team-namespace / per-user？(2) **生成方式** = 用户 input / 自动 slugify(team_name) / 自动 slugify+random suffix？(3) **长度** = 上限多少？(4) **字符集** = ASCII-only / 是否允许 unicode？这 4 项一旦冻结，会同时影响 `migration 009 nano_teams.team_slug` 列约束、`AuthTeamSchema` 字段校验、`/me/team` patch 的 input validation、注册时自动生成逻辑与冲突重试策略，以及未来 hero-to-platform 阶段引入"通过 slug 寻址 team"（如 `https://app/{team_slug}/...`）时的 URL 安全性。
- **Opus的对GPT推荐线路的分析**：GPT 给出的 `slugify(ASCII-fallback) + '-' + random6chars` + global-unique + ≤32 char + `[a-z0-9-]` 是**保守且无后路**的选择。优势：(a) global-unique 不需要后续 hero-to-platform 再升级唯一性范围；(b) `+random6chars` 把"如果第一次冲突怎么办"的复杂度从注册流程内嵌的 retry-loop 转化为概率近 0 的常数生成（6 个 base36 字符给 ≈ 21 亿组合）；(c) `[a-z0-9-]` URL-safe 且与 RFC 3986 unreserved subset 兼容，未来做 path-routing 不会再被 percent-encoding 困扰；(d) ≤32 给后续 prefix（如 `team-` 之类）留余量。**潜在弱点**：(a) `+random6chars` 让 slug 在 UI 中变难看（"acme-corp-a3kf9z"），如果 owner 期待"slug 等于 team 名的简洁形式"，这条路会失望；(b) 不允许 unicode，对中文/日文 team 名会被 fallback 转拼音或直接退化，业主需要接受这一点。**替代路线**：可以让 user 在注册或 patch 时 **可选** 指定 slug（带冲突 retry），失败才 fallback 到 `slugify+random6chars`；这给"想要漂亮 slug"的用户一条路，但代价是注册流程多一次 D1 unique check 往返。我的判断：first-wave 不值得为这点 UX 抖动注册路径，**直接采纳 GPT 路线**，把"可选 user-supplied slug"留到 hero-to-platform 的 admin plane 一并解决。
- **Opus的最终回答**：**采纳 GPT 推荐路线，不做修改**。`slugify(ASCII-fallback)` + `'-'` + 6 个 base36 字符随机后缀，global unique（D1 `UNIQUE` constraint），长度上限 32，字符集 `[a-z0-9-]`；非 ASCII team_name 走 ICU/transliteration fallback 转 ASCII；slug 完全自动生成，first-wave 不暴露 user-supplied slug 入口。同时建议 `nano_teams.team_slug` 在 migration 009 中加 `UNIQUE NOT NULL`（不是 `DEFAULT ''`），让无 slug 注册路径直接失败，避免历史脏数据。

- **问题**：`是否确认 real-to-hero 阶段的 team_slug baseline 采用 ASCII slug + random6chars、global unique、长度 ≤ 32、字符集 [a-z0-9-]？如果不同意，请直接给出唯一性范围、长度上限与字符集。`
- **业主回答**：同意 Opus 的推荐线路。

---

## 2. 迁移 / Runtime / 模型策略

### Q2 — `Lane E dual-track sunset 时间盒长度`（来源：`docs/charter/plan-real-to-hero.md` §12 Q2、`docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`）

- **影响范围**：`workers/agent-core/wrangler.jsonc`、`workers/agent-core/src/host/**`、`workers/filesystem-core/**`、Lane E cutover 验收口径
- **为什么必须确认**：RH4 明确允许短期 `library import + RPC consumer` 并存，但 charter 同时把“不能永久并存”写成硬纪律；如果没有 owner 时间盒，RH4 很容易以“先能跑”为理由长期停在双轨状态。
- **当前建议 / 倾向**：**`≤ 2 周`。**
- **Reasoning**：这个问题会出现，是因为 RH4 既要把 filesystem-core 变成真实业务 RPC，又不能一次性把 agent-core 的旧 library path 全部拔掉，短期双轨是合理工程手段；但没有 sunset 的双轨几乎一定会变成永久遗留。当前推荐路线更稳，是因为它给 RH4 一个明确的“迁移窗口”而不是“技术债许可”；如果不拍板，RH4 的 closure 将很难判定到底是“已经 consumer migration”还是“只是又多了一条 path”。

- **Opus的对问题的分解**：这题表面上是"时间盒长度"，实际上由 3 个子决策组成：(1) **sunset 起点定义** = "RPC-first env flag 启用日"还是"RH4 phase merge 日"？(2) **sunset 期间的 owner gate** = 是否允许在 sunset 内 ship 新 PR 继续依赖 library import path？(3) **sunset 到期后的处置** = 强制删除 library import / 转为 `@deprecated` 一周后再删 / 留在仓库直到 hero-to-platform？没有清晰的 (1)(2)(3)，"≤ 2 周"会变成"看心情删的 2 周"。
- **Opus的对GPT推荐线路的分析**：`≤ 2 周` 在工程现实里是**正好的窗口**：太短（≤ 1 周）会让 RH4 merge 后的 hot-fix 无 fallback 余地，等于硬切；太长（≥ 1 个月）会让 dual-track 被下游 RH5 / RH6 吸纳为"既成事实"，最终演变成永久遗留。2 周覆盖了一个 sprint + 一次 owner 复核窗口，足够在真实流量下发现 RPC path 的边界 bug 但又不至于让团队习惯于"两条都能跑"。**潜在弱点**：(a) 没有明确 sunset 起点，建议用"RPC-first env flag 在 prod 启用之日"为起点而不是 merge 日，因为"启用"才是真正暴露 RPC path 风险的时刻；(b) 2 周窗口期间还允许 PR 用 library import 路径会让 sunset 形同虚设——必须配 `@deprecated` 注解 + lint rule 阻止新引用；(c) 到期后必须 **物理删除** 而不是只 deprecate，否则 RH6 cleanup 又会捡到尾巴。**替代路线**：(a) "≤ 1 周"——硬切式 sunset，要求 RH4 PR 自带 RPC-first 完整切换，risk 最低也最激进；(b) "≤ 4 周"——给跨 phase merge 留余量，但等于授权 RH5 在 dual-track 上施工，明确反对。我的判断：**采纳 ≤ 2 周但补 (a)(b)(c) 三个限定**，让"≤ 2 周"从模糊承诺变成可审计的 phase law。
- **Opus的对GPT推荐线路的分析（追加澄清）**：还有一个隐性子决策——dual-track 期间 **failure-fallback policy**：如果 RPC-first path 在 prod 触发 5xx，是 (i) 自动 fallback 到 library import（但这等于"夜里悄悄变回 dual-track"），还是 (ii) 直接抛错让 client 看到？建议 (ii)——只有 sunset 期间能看到真实问题，sunset 才有意义。
- **Opus的最终回答**：**采纳 GPT 路线 ≤ 2 周，但补 4 项限定**：(1) sunset 起点 = "RPC-first env flag 在 production 启用之日"（不是 merge 日）；(2) sunset 期间 `agent-core/src/host/runtime-mainline.ts` 的 library import 路径必须打 `@deprecated` 注解 + 加 ESLint `no-restricted-imports` rule，阻止新增引用；(3) sunset 期间 RPC-first 失败不允许 silent fallback 到 library import，必须 throw，让监控能看见真实问题；(4) sunset 到期当天必须 **物理删除** library import 代码 + `wrangler.jsonc` 内嵌 library 引用，并以 PR 形式归档。

- **问题**：`是否确认 RH4 的 Lane E dual-track sunset 时间盒为 ≤ 2 周？如果不同意，请明确允许的最长并存窗口。`
- **业主回答**：同意 Opus 的推荐线路。

### Q3 / Charter-Q4 — `per-model quota 是否在 RH5 引入`（来源：`docs/charter/plan-real-to-hero.md` §12 Q4、`docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`）

> ⚠ **编号映射注**：本文件 Q 编号与 charter §12 Q 编号在 Q3/Q4 上**互换**（GPT R7 提出）。所有下游引用必须使用 **`RHX Q3 (= Charter Q4)`** 双编号写法，避免 owner 回答时 anchor 错位。如果将来要统一，必须双向同步修改。

- **影响范围**：`GET /models` policy surface、`nano_usage_events`、quota gate、RH5 scope 边界
- **为什么必须确认**：RH5 会把 13+4+8 模型推到真实 product surface；如果同时引入 per-model quota，RH5 会从“能力上线”膨胀为“计费策略设计”，直接越界到 hero-to-platform。
- **当前建议 / 倾向**：**不在 RH5 引入 per-model quota；只记录 `model_id` 到 usage evidence。**
- **Reasoning**：这个问题会出现，是因为 reasoning / vision 模型天然成本更高，看起来很诱人去做细粒度配额控制；但 RH5 当前真正要解决的是“模型选择、能力校验、reasoning 参数贯通、多模态可用”。当前推荐路线更稳，是因为它把 quota 问题收敛成“记录事实，不立即做策略”；如果不拍板，RH5 很容易把注意力从 runtime wiring 转移到 billing-like policy，拖慢整个 phase。

- **Opus的对问题的分解**：这题由 3 个相互独立的子决策组成：(1) **是否引入** per-model quota？(2) 如果不引入，**model_id 是否依然记录到 `nano_usage_events`**？(3) **team policy filter** 的粒度——是否允许"team 级别禁用某个模型"？这 3 项决定了 RH5 的 scope 范围、`nano_usage_events` schema 是否需要 alter、以及 hero-to-platform 启动时 quota 设计的起跑线。
- **Opus的对GPT推荐线路的分析**：`不引入 per-model quota，只记录 model_id` 是 first-wave 阶段**唯一正确**的选择，理由如下：(a) 引入 per-model quota 必然牵出 5 个连锁问题——quota 单位（请求数 / token / cost）、quota 周期（日 / 月 / 滚动窗口）、quota 失败行为（reject / soft-warn / queue）、quota 显示（实时 push 还是 snapshot）、quota 跨模型互相影响（reasoning 模型按 token 还是按 invocation？），其中任何一项都足够 single-handedly 把 RH5 拉成 hero-to-platform 级别的工程量。(b) "只记录 model_id" 让 hero-to-platform 阶段引入 quota 时，**已经有 ≥ 1 个 phase 的真实 usage data 可用作 budget calibration**；如果 RH5 不记录，未来 quota 设计会变成纯拍脑袋。(c) team policy filter 能实现"对 team A 关闭昂贵模型"的轻量需求，**且不需要新引擎**——只在 `/models` 返回时按 team policy filter，在 `/messages` 时校验同一 policy。**潜在弱点**：(a) 不做 quota 在 RH 阶段意味着 `claude-opus-4-7` 类高成本模型可能被 first-wave 用户突发消耗；建议依靠 Cloudflare account 级别的 AI binding rate limit + 业主对头部模型设 team-level disable 作为 first-wave 防线，不在 application layer 做 quota。(b) "只记录 model_id" 不足以支撑未来 quota，还需要同步记录 input/output token、cost-estimate、is_reasoning、is_multimodal——建议在 RH5 的 usage event 字段内一并加上，让未来 quota 实施变成"加聚合规则"而不是"重新埋点"。
- **Opus的最终回答**：**采纳 GPT 路线，不引入 per-model quota；但建议把 RH5 的 usage event 字段从 GPT 描述的"`model_id`"扩展为"`{model_id, input_tokens, output_tokens, estimated_cost_usd, is_reasoning, is_vision, request_uuid}`"完整 evidence**——这样 hero-to-platform 引入 quota 时只需要新增聚合 + budget table，不需要重新埋点。team policy filter 在 RH5 内实施粒度限定为：team-level boolean disable（默认 enable，业主可在 internal 命令把某 model_id 对某 team 设 disabled），**不**做按 reasoning/vision capability 做配额 / 不做按模型族做配额——这两类策略一旦做就回不去。

- **问题**：`是否确认 RH5 不引入 per-model quota，只做 model_id usage 记录与 team policy filter？如果不同意，请明确是按模型、按模型族，还是按 reasoning/vision 能力做配额。`
- **业主回答**：同意 Opus 的推荐线路。

---

## 3. Evidence / Bootstrap / Gate

### Q4 / Charter-Q3 — `manual evidence 真机品牌 / 微信版本范围`（来源：`docs/charter/plan-real-to-hero.md` §12 Q3、`docs/design/real-to-hero/RH6-do-megafile-decomposition.md`）

> ⚠ **编号映射注**：本文件 Q4 = Charter §12 Q3。所有下游引用使用 **`RHX Q4 (= Charter Q3)`** 双编号。

- **影响范围**：RH6 manual evidence pack、`docs/evidence/**`、closure 通过标准
- **为什么必须确认**：RH6 的 evidence 不是“拍几张图”，而是 final closure 的硬闸之一；如果覆盖范围不冻结，closure 阶段会反复争论“这套证据够不够”。
- **当前建议 / 倾向**：**`iOS 17 Safari + Android 14 Chrome + 微信 8.0 真机各 1 套；微信开发者工具最新 stable 1 套；浏览器 Chrome stable 1 套。`**
- **Reasoning**：这个问题会出现，是因为 RH6 要同时证明 web、wechat-devtool 和真实设备三条链路可持续使用，而不是单一 happy-path demo。当前推荐路线更稳，是因为它足够覆盖 first-wave 客户端分布，又没有把 evidence 范围膨胀成测试矩阵工程；如果不拍板，RH6 closure 很容易在“还差哪台设备/哪个版本”上反复返工。

- **Opus的对问题的分解**：这题表面是"哪些设备 / 版本"，实际由 4 个子决策组成：(1) **覆盖维度**——按操作系统 × 浏览器 × WeChat 客户端 × 网络环境的组合空间是 4 维，是否所有维度都有 1+ sample？(2) **每个 sample 的 evidence depth**——只录 happy-path 还是必含 device revoke / image upload / permission deny / WS reconnect 4 条 must-cover scenario？(3) **evidence 形态**——仅截屏、还是必含 network log + WS frame log？(4) **owner 时间盒**——RH6 closure 当天采集还是允许提前一周采集？如果只回答"哪些设备"而不冻结后 3 项，evidence pack 仍然会在 closure 时被反复争议"还差什么"。
- **Opus的对GPT推荐线路的分析**：GPT 推荐的 `iOS 17 Safari + Android 14 Chrome + 微信 8.0 真机 + 微信开发者工具 stable + Chrome stable` 是**最小可证 first-wave 客户端拓扑闭环**的组合：(a) Safari/Chrome 双 desktop 浏览器覆盖了 web client 的 80%+ 现实流量；(b) iOS 17 + Android 14 是 2026 年仍在活跃的两大手机 OS 主版本；(c) 微信 8.0 真机 + 微信开发者工具是 wechat adapter 的 must-have（mini-program 上线流程对 devtool 和真机版本都有最低要求）；(d) 5 个 sample 是 owner 单人在 1 个工作日内可完成的现实工作量。**潜在弱点**：(a) 没有覆盖 wechat 开发者工具与真机的 RPC subtle 差异（如真机 cookie/storage 行为不同），但 5 个 sample 内做不到完整 matrix；(b) 没有 specify "网络环境"（4G/5G/Wi-Fi 是否各试一次），real-device 上 WS 在切网时的 reconnect 行为只有 4G/5G 切换才能真实验证；(c) iOS 17 在 2026 年已不是 latest——iOS 18 才是；但 owner 已有 iOS 17 真机，强行升级 iOS 18 会让"覆盖最新"变成成本驱动，得不偿失。**替代路线**：(a) 收紧到 4 套（去掉微信开发者工具 stable）——但这会把 mini-program "提交审核前最后一步"的 evidence 拿掉，不建议；(b) 扩到 8 套（加 Android 13 / iOS 16 / 微信 7.x）——明显超出 first-wave 价值。
- **Opus的最终回答**：**采纳 GPT 路线 5 套基线，但补 4 项限定**：(1) 每套 sample 必须覆盖 4 条 must-cover scenario：(a) 注册→start session→发 1 条带 image_url 的消息→收到 LLM 响应；(b) 触发一次 permission request 并 deny；(c) 在另一台设备登录同帐号触发 device revoke，验证当前 WS 立即被 force-disconnect；(d) 主动断网 30s 再恢复，验证 WS reconnect + replay 不丢消息。(2) evidence 形态 = 屏幕录像（含网络指示）+ network log（HAR 或 chrome devtools dump）+ WS frame log（浏览器 console 或 wechat devtool 输出），三者合一打成 zip 入 `docs/evidence/real-to-hero/RH6/{device-name}/`。(3) owner 在 RH6 closure 当天 ±3 个工作日内完成采集，超时由业主决定延期还是放行。(4) 网络环境 = web 用 Wi-Fi，真机用 5G/Wi-Fi 各采集 1 次（仅针对 reconnect scenario），其他 scenario 默认 Wi-Fi 即可。这 4 项让 5-set baseline 从 "拍 5 张图" 升级为可被 reviewer 二次复核的 evidence pack。

- **问题**：`是否确认 RH6 manual evidence 的基线覆盖范围为 iOS 17 Safari、Android 14 Chrome、微信 8.0 真机、微信开发者工具 stable、Chrome stable 浏览器各 1 套？如果不同意，请直接给出你要求的设备 / 版本组合。`
- **业主回答**：同意 Opus 的推荐线路。

### Q5 — `RH0 P0-F owner-action 凭据 checklist 验证执行`（来源：`docs/charter/plan-real-to-hero.md` §12 Q5、`docs/design/real-to-hero/RH0-bug-fix-and-prep.md`）

- **影响范围**：RH0 start gate、`docs/owner-decisions/real-to-hero-tooling.md`、preview deploy 准备、凭据可用性审计
- **为什么必须确认**：charter 已经把 tooling / credential readiness 从“记忆中的前提”升级成必须可审计的 owner action；如果这一步不被真正执行并签字，RH0 的 Start Gate 仍然是不完整的。
- **当前建议 / 倾向**：**在 RH0 启动当天，由 owner 执行并回填 6 步 checklist：`wrangler whoami`、`gh auth status`、`pnpm --filter @haimang/jwt-shared build`（带 `NODE_AUTH_TOKEN`）、`wrangler r2 bucket list`、`wrangler kv namespace list`、`wrangler ai models --json | wc -l`。**
- **Reasoning**：这个问题会出现，是因为 RH0 的很多工作表面上是“代码 prep”，但真实 gate 其实取决于外部凭据、Cloudflare 资源和包发布权限是否齐备。当前推荐路线更稳，是因为它把环境 readiness 明确成一次 owner 可审计动作，而不是把失败推迟到 implementation 中途才暴露；如果不拍板，RH0 可能在完成一半代码后才发现 deploy / build 根本无法执行，造成整阶段空转。

- **Opus的对问题的分解**：这题由 3 个子决策组成：(1) **执行时点**——RH0 启动当天 / RH0 进入 implementation 之前 / 持续每周复核？(2) **失败处置**——某一步失败时是 (i) RH0 直接挂起等业主修复，还是 (ii) RH0 仍可启动，把失败步骤记入 todo 等下游 phase 处理？(3) **6 步 checklist 的具体内容**——除 GPT 列出的 6 步外，是否还需要补 `pnpm install --frozen-lockfile`（rebuilt lockfile 验证）、`wrangler deploy --dry-run` 跨 6 worker 全跑等？
- **Opus的对GPT推荐线路的分析**：GPT 推荐的 6 步 `wrangler whoami` / `gh auth status` / `pnpm --filter @haimang/jwt-shared build`（带 NODE_AUTH_TOKEN）/ `wrangler r2 bucket list` / `wrangler kv namespace list` / `wrangler ai models --json | wc -l` 覆盖了**真实 deploy / build / 凭据 readiness 的最薄合理切片**：(a) 前两步检查 owner 身份，保证 deploy / PR / release 都能 by 实际人员执行；(b) 第 3 步是 jwt-shared 包装 + GitHub Packages npm auth pattern 是否成立的唯一 spike；(c) 第 4-5 步检查 R2 / KV 资源是否存在于 Cloudflare account（用于 RH4 binding readiness）；(d) 第 6 步用模型数量验证 Workers AI binding `ai:write` 权限（未授权会拿不到 list）。**潜在弱点**：(a) 缺 `pnpm install --frozen-lockfile` 验证——RH0 P0-A 修复 lockfile 后必须有一步证明 fresh checkout 下确定可解析，不然 RH0 P0-A 的成功只是局部；(b) 缺 `wrangler deploy --dry-run` 跨 6 worker 验证——KV/R2 binding 占位声明完成后必须有一步证明 dry-run 通过，否则 RH4 启动时才发现配置错误为时过晚；(c) 没有失败处置政策——如果 owner 当天发现 `wrangler r2 bucket list` 返回空（账号没有 r2 quota），RH0 是挂起还是降级？没有明确 policy。**替代路线**：扩到 10+ 步会把 owner 单日 readiness 变成"半天的运维劳动"，不可持续；保留 6 步 + 补 2 步关键验证 + 加失败处置 policy 是最优。
- **Opus的最终回答**：**采纳 GPT 路线 6 步，但扩至 8 步并补失败处置政策**：(1) 在 GPT 6 步基础上追加 (7) `pnpm install --frozen-lockfile`（验证 RH0 P0-A 完成的 lockfile 在 fresh checkout 下确定可解析）+ (8) `for w in 6 workers; do wrangler deploy --dry-run --config $w/wrangler.jsonc; done`（验证 RH0 P0-C 的 KV/R2 binding 占位声明在所有 worker 中 dry-run 通过）。(2) **失败处置政策**：8 步中任何 1 步失败都属于 RH0 Start Gate 失败，业主必须在 24h 内决定：(a) 修复后重跑 checklist；(b) 把失败步骤升级为 RH0 in-scope 工作（修配额 / 申请 R2 quota 等）；(c) 业主以书面形式写明可降级的理由并签字 —— 三选一，不允许"先开工再补"。(3) 执行时点 = RH0 启动当天，结果写入 `docs/owner-decisions/real-to-hero-tooling.md`，每条 step 记录 timestamp + 输出 hash + verdict（pass/fail/owner-override）。(4) RH0 implementation 期间如有 deploy / preview / build 路径失败，必须先回这份 checklist 文档复核是否凭据已变化，再决定是否需要 owner 重新执行。

- **问题**：`是否确认 RH0 启动当天由 owner 执行并回填这 6 步 tooling checklist，并把结果写入 docs/owner-decisions/real-to-hero-tooling.md？`
- **业主回答**：同意 Opus 的推荐线路。

---

## 4. RHX2 / Observability & Auditability

### Q-Obs1 — `nano_error_log / nano_audit_log 是否走 orchestrator-core 单写点`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F4 / F11、跨 worker 持久化、team 边界、D1 写入路径
- **当前建议 / 倾向**：**走 orchestrator-core 单写点，但 caller 侧必须保留 `rpc_log_failed` 标记的 console / memory fallback。**
- **Reasoning**：当前 shared D1、authority 校验和 team 边界都集中在 orchestrator-core，first-wave 若改成多写点会把 observability 先做成 tenancy 新问题。单写点本身没有问题，真正的问题是“单写失败时是否静默黑洞”；因此答案必须同时冻结 durable single-writer 与 caller-side fallback 两件事。
- **问题**：`是否确认 RHX2 的 error/audit durable write 都由 orchestrator-core 统一落库，同时要求其他 worker 在 RPC/D1 失败时保留 console/memory fallback 并打 rpc_log_failed 标记？`
- **业主回答**：确认。走 orchestrator-core 单写点；但 durable 写失败不能静默吞掉，caller 必须保留 `console + memory-ring + rpc_log_failed:true` 的降级证据。

### Q-Obs2 — `RHX1 DDL SSOT 收敛后，RHX2 migration 编号是否直接承接 next slot = 006`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F4 / F11 migration 文件命名、action-plan、preview apply
- **当前建议 / 倾向**：**是，直接使用 `006-error-and-audit-log.sql`。**
- **Reasoning**：RHX1 已把当前 `workers/orchestrator-core/migrations/` 收敛为 `001`–`005` 的 SSOT。继续讨论旧碎片时代的 `011/012`，只会让 action-plan 和真实 DDL 状态脱节。
- **问题**：`是否确认 RHX2 第一张新增 migration 直接承接 RHX1 SSOT 的 next slot = 006，而不再沿用旧碎片时代的 011/012 讨论？`
- **业主回答**：确认。RHX2 migration 直接使用 `006-error-and-audit-log.sql`。

### Q-Obs3 — `error 14d / audit 90d retention 是否冻结`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F4 / F11 retention、清理策略、owner 预期
- **当前建议 / 倾向**：**first-wave 固定为 error 14d、audit 90d，不做 severity 分层。**
- **Reasoning**：14 天足够承接开发 / preview / 用户反馈回溯，90 天才有资格承接安全 / 审计链路；再往下做按 severity 分层，会把 first-wave 过早拉进平台治理。先把 retention 变成稳定契约，比一开始就追求“最优层级”更重要。
- **问题**：`是否确认 RHX2 first-wave 的 retention 冻结为 nano_error_log 14 天、nano_audit_log 90 天，暂不做 severity 分层？`
- **业主回答**：确认。first-wave 固定为 error 14d、audit 90d，severity 分层延后。

### Q-Obs4 — `system.error 是否新增 stream-event kind`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F7、web / 微信小程序 WS 消费、协议兼容
- **当前建议 / 倾向**：**新增 kind，但必须把 client 消费路径一并纳入交付。**
- **Reasoning**：只在协议层新增 `system.error` 而不补客户端消费，会把当前“未知错误只在日志里”的问题，变成“未知 kind 出现在界面里”的新问题。新增 kind 本身是对的，但必须连同消费侧一起冻结。
- **问题**：`是否确认新增 system.error stream-event kind，并把 web / 微信小程序对 system.error 的消费路径纳入 RHX2 first-wave？`
- **业主回答**：确认。新增 `system.error`；同时要求 web / 微信小程序同步补齐消费逻辑，不能只做 server-side emit。

### Q-Obs5 — `/debug/logs` 与 `/debug/audit` 的可见范围（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F5 / F11、权限模型、产品边界
- **当前建议 / 倾向**：**`/debug/logs` 仅 team；`/debug/audit` owner-only；不做 owner 全租户面板。**
- **Reasoning**：当前 clients/web 与微信小程序都不是 control plane，没有“owner 跨租户浏览所有日志”的产品面。把产品调试口直接扩成全租户面板，会把 RHX2 变成 platform/admin phase。
- **问题**：`是否确认 /debug/logs 只开放给 authenticated same-team 查询、/debug/audit 只开放给 owner 查询本 team 范围，不做 owner 全租户自助查询面板？`
- **业主回答**：确认。`/debug/logs` 仅 team；`/debug/audit` owner-only 且只限本 team，不做全租户面板。

### Q-Obs6 — `F11 first-wave audit event_kind 是否需要扩成 8 类`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F11、客户端排障、审计写量
- **当前建议 / 倾向**：**需要。除原 6 类外，再加 `session.attachment.superseded` 与 `session.replay_lost`。**
- **Reasoning**：真实客户端最需要解释的不是高频 `session.start/end`，而是“为什么我被顶下线”“为什么这次必须全量补拉 timeline”。这两类都是低频、高价值、直接对应 web / 微信小程序当前链路的边界事件。
- **问题**：`是否确认 F11 first-wave 审计集从 6 类扩成 8 类，在原集合上补 session.attachment.superseded 与 session.replay_lost，并继续排除高频 session.start/end？`
- **业主回答**：确认。first-wave 审计集扩成 8 类，新增 `session.attachment.superseded` 与 `session.replay_lost`；仍不纳入高频 `session.start/end`。

### Q-Obs7 — `F2 × F7 交叉时 HTTP 与 WS 是否必须 code 一致`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F2 × F7 去重、前端 UX、错误映射
- **当前建议 / 倾向**：**trace_uuid 必须一致；code 可不同；前端按 trace_uuid 去重。**
- **Reasoning**：同一逻辑错误跨越 facade 包装层与 kernel/source 层时，完全可能出现不同 code，但它们仍然属于同一次用户操作。真正稳定的关联键是 `trace_uuid`，不是每一层都能 1:1 对齐的 `code`。
- **问题**：`是否确认 F2 × F7 的强一致主键是 trace_uuid，而不是 code；当前端同时收到 HTTP error 与 WS system.error 时，按 trace_uuid 去重？`
- **业主回答**：确认。`trace_uuid` 必须一致；`code` 可不同；UI 去重键统一使用 `trace_uuid`。

### Q-Obs8 — `TTL 清理用 DO alarm 还是 Cloudflare cron trigger`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F4 / F11 housekeeping、运维形态
- **当前建议 / 倾向**：**Cloudflare cron trigger。**
- **Reasoning**：`nano_error_log` / `nano_audit_log` 是 shared D1 truth，不归属于某个 DO 实例生命周期；TTL 清理是全局 housekeeping，而不是 session-local 任务。用 cron 比用 alarm 更符合职责边界。
- **问题**：`是否确认 RHX2 的 TTL 清理统一使用 Cloudflare cron trigger，而不是 DO alarm？`
- **业主回答**：确认。TTL 清理统一走 Cloudflare cron trigger。

### Q-Obs9 — `bash-core 7 个 ad-hoc string codes 是否必须 first-wave 归化为 zod enum`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md`）

- **影响范围**：F9 / F3、错误码收口、client 消费
- **当前建议 / 倾向**：**不强制归化为 zod enum，但必须进入 registry/docs 的 client-safe 查询面。**
- **Reasoning**：强行在 first-wave 改 bash-core contract 会把 RHX2 拉向协议重构；但如果这些 code 仍只存在于 bash-core 自己体内，web / 微信小程序就会继续各自手搓分类逻辑。真正要冻结的是“这些 code 必须能被消费方查到”，而不是“今天就一定变 enum”。
- **问题**：`是否确认 bash-core 7 个 ad-hoc string codes first-wave 不强制改成 zod enum，但必须进入 runtime registry / docs 镜像的 client-safe 查询面？`
- **业主回答**：确认。first-wave 不强制改成 zod enum；但必须进入 registry/docs 的 client-safe 查询面，不能继续只在 bash-core 内部可见。

### Q-Obs10 — `client-safe error meta 出口形态`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.3 / GPT R1）

- **影响范围**：F12、`clients/web/src/apis/transport.ts:50-57` 与 `clients/wechat-miniprogram/utils/nano-client.js:11-28 classifyError()` 的改造路径、跨端复用形态、CI 一致性测试入口。
- **当前建议 / 倾向**：**候选 a' — 扩展 `@haimang/nacp-core` 新增 `nacp-core/error-codes-client` 子路径导出（v0.4 修订）**。原候选 a（新建独立 `packages/error-codes-client/` 共享包）与 owner 长期"只保留 3 个 published 包（nacp-core / nacp-session / jwt-shared）"策略冲突；改为在已发布的 `nacp-core` 内新增子路径导出，所有"零 runtime 依赖 / 浏览器+微信+Node 三端可用 / CI 一致性测试"功能边界与候选 a 等价。微信小程序 build 时反射 `node_modules/@haimang/nacp-core/dist/error-registry-client/data.js` 拷贝到 `miniprogram/utils/error-codes-client.json`。候选 b（`error-codes.json` 静态文件）+ 候选 c（`GET /catalog/error-codes` 端点）保留为 future fallback，不在 first-wave 实装。
- **Reasoning**：候选 a' 在保持候选 a 全部技术优势的同时，避免增加 published 包数量；server `resolveErrorMeta()` 与 client `getErrorMeta()` 在同一包内不同 sub-path，CI 一致性测试更紧凑。候选 b 需要额外 build script 同步 + 两端各自加载逻辑；候选 c 多一次 RPC + 缓存 / ETag 复杂度。
- **问题**：`是否确认 client-safe error meta 出口 first-wave 采用候选 a'（扩展 @haimang/nacp-core 新增 nacp-core/error-codes-client 子路径导出 + 微信小程序 build 时反射拷贝）？`
- **业主回答**：确认。first-wave 采用候选 a'：在 `@haimang/nacp-core` 内新增 `error-registry-client` 子模块；package.json `exports` map 增 `./error-codes-client` sub-path；nacp-core minor bump 1.4.0 → 1.5.0 重发 GitHub Packages；web 直接 `import { getErrorMeta } from '@haimang/nacp-core/error-codes-client'`；微信小程序在 build script 中反射拷贝。**不新建独立 `packages/error-codes-client/` 包**。候选 b/c 留作 future fallback。

### Q-Obs13 — `jwt-shared 是否必须 RHX2 内正式发布 / 撤销 v0.4 RHX3 carry-over`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5 / owner critical 反馈）

- **影响范围**：F14、RHX2 closure 门禁、3 published 包长期策略、deploy 链路 CI gate、所有 phase 的认知正确性
- **当前建议 / 倾向**：**必须 RHX2 内正式发布 `@haimang/jwt-shared@0.1.0`**；撤销 v0.4 中"RHX3 carry-over"的判断；不接受"永久 workspace-only 删 publishConfig"或"合并入 nacp-core"两个替代方案。
- **Reasoning**：v0.4 把 jwt-shared 未发布判为 carry-over 是 critical 门禁认知错误——它意味着我们曾在某些 phase closure 中宣告完成，但实际 deploy 进生产 worker 的代码究竟从线上还是本地来、是哪个版本，没有真相源可查。这破坏了所有过去 closure 的事实假设，比 latent runtime bug 更深一层。Owner 立场："我们仅能依靠一个唯一真相：要么是线上 package，要么是本库内 package；不能存在任何模糊空间。"jwt-shared 跨两个 worker 是真实多 consumer 共享代码，永久 workspace-only 与"3 published 包"长期策略冲突；合并入 nacp-core 会污染 NACP 协议层关注点。
- **问题**：`是否确认 @haimang/jwt-shared@0.1.0 必须在 RHX2 first-wave Phase 1 内 publish 到 GitHub Packages，并且 RHX2 closure 必须包含 publish 已成功的机器可验证证据？同时撤销 v0.draft-r2 中 RHX3 carry-over 的处置。`
- **业主回答**：确认。撤销 v0.draft-r2 / v0.4 的 RHX3 carry-over 处置；jwt-shared@0.1.0 必须在 RHX2 first-wave Phase 1 publish；RHX2 closure 必须含 `curl -sI -H "Authorization: Bearer $NODE_AUTH_TOKEN" https://npm.pkg.github.com/@haimang%2Fjwt-shared` 返回 HTTP 200 + versions 列表含 0.1.0 的证据截图。这不是可推迟项；不通过门禁不允许宣告 phase 完成。

### Q-Obs14 — `/debug/packages 在 worker runtime 没有 GitHub Packages PAT 时如何拉 registry`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5 / 部署时 secret 注入）

- **影响范围**：F15、worker runtime 凭据治理、`/debug/packages` 响应可靠性、跨环境调试能力
- **当前建议 / 倾向**：**registry 段 graceful 降级**——worker runtime 不持有 PAT（避免长期凭据驻留 worker 环境）；`/debug/packages` 拉 registry 时使用未授权 GET；当 GitHub Packages 对 restricted 包返回 401 时，response 把 `registry` 段标 `"auth-not-available-in-runtime"`；**`deployed` 段始终可用**（来自 inline manifest，无需任何外部 fetch）。
- **Reasoning**：把 PAT 注入 worker 环境会带来长期凭据泄漏风险（Cloudflare secret + 子调用泄露面）；本接口最重要的事实——deploy 进 worker 的版本——本来就 inline 在 bundle，不需要 PAT；registry 段是辅助佐证，缺它不影响主用途。Owner 立场：宁愿前端见到 "auth-not-available-in-runtime" 也不要长期 PAT 挂在 worker。如果未来真要 strict 模式启用 PAT 注入，可以由独立 phase 决议，那时 `/debug/packages` 自然返完整双段。重要的是：当 deployed 段不可用（inline manifest 缺失）时，owner 与前端必须警觉，因为这意味着 build 时门禁没正确注入。
- **问题**：`是否确认 /debug/packages 在 first-wave 不在 worker 环境注入 PAT；registry 段 graceful 降级到 "auth-not-available-in-runtime"；deployed 段始终来自 inline manifest 必须可用？`
- **业主回答**：确认。worker runtime 不注入 PAT；registry 段允许 graceful 降级；但 deployed 段必须始终可用——deployed 段缺失视同 build 门禁失败，必须修而不是降级。`/debug/packages` 响应中明确区分 `deployed` 与 `registry` 两段的可用性状态。

### Q-Obs11 — `system.error + system.notify(severity=error) 双发降级窗口长度`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.3 / GPT R2）

- **影响范围**：F13、server F7 切单发的时点、web + 微信小程序 client rollout 节奏、双通道下 dedupe 风险窗口。
- **当前建议 / 倾向**：**默认 4 周**（要求双发已运行 ≥14 天观察期 **且** web / 微信至少一端已发布 `case 'system.error'` 消费 PR）。
- **Reasoning**：4 周给 client 发布、灰度、用户升级到新版本留出实际窗口；< 14 天观察期不足以捕捉低频故障；> 8 周会让"双发降级"变成事实上的永久双发，让前端在 dedupe 上长期承担额外复杂度。窗口结束前禁止切单发；窗口结束后 server 改为只发 `system.error`，老 client 不再收到 system.notify(severity=error)。
- **问题**：`是否确认 system.error 双发降级窗口默认 4 周，且必须满足"≥14 天观察期 + 至少一端 client 发布消费 PR"两个准入条件？`
- **业主回答**：确认。窗口默认 4 周，准入条件双满足后才切单发；不满足时窗口顺延（不静默切）；切单发的决定记入 RHX2 closure。

### Q-Obs12 — `三套 durable 真相（activity_logs / error_log / audit_log）的索引引用规则是否在 first-wave 强制`（来源：`docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.3 / GPT R4）

- **影响范围**：§3.6 三套 durable 真相边界、F4 / F11 写入路径、`/debug/logs` + `/debug/audit` + replay/inspector 的排障路径、跨表数据一致性。
- **当前建议 / 倾向**：**强制 first-wave**：
  1. audit 写时只引 `ref={kind, uuid}`，**不复制** `nano_session_activity_logs` 的 payload 全文；
  2. `nano_error_log` **不允许写"正常事件"**（仅 severity ≥ warn）；
  3. cross-tenant deny 等安全事件 **主真相 = `nano_audit_log`**，副真相 = `nano_error_log`（severity=warn）；
  4. session-边界事件（`session.attachment.superseded` / `session.replay_lost`）必须 **同时** 写 `nano_audit_log`（主真相）+ `nano_session_activity_logs`（保持 session 时间线完整）。
- **Reasoning**：三套 durable 真相若不在 first-wave 划清边界，排障面会从"信息太少"变成"信息太散"——同一事件在三处对照费时、payload 漂移、查询路径不可预测。强制规则是 RHX2 价值能否被前端 / owner 真正使用的前提。
- **问题**：`是否确认 §3.6 的索引引用 4 条规则在 first-wave 强制执行（不复制 payload 全文 / error_log 不写正常事件 / 安全事件主真相在 audit_log / session 边界事件双写）？`
- **业主回答**：确认。4 条规则 first-wave 强制执行；写入路径必须有单测覆盖每条规则；违反规则的 PR 由 ESLint / 单测拦截。

---

## 5. 使用约束

### 5.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 5.2 哪些问题不应进入 QNA

- **实现细节微调**：例如局部命名、内部脚本组织、单个测试文件布局
- **已有 frozen answer 的重复提问**：除非本次要正式推翻旧答案
- **只影响单个函数或单个包内部实现、不会改变外部治理边界的问题**

### 5.3 `Reasoning` 的写法要求

- 要写给**非项目作者、但需要做决策的人**
- 要解释：
  1. **这个问题为什么会出现**
  2. **为什么当前推荐路线更稳**
  3. **如果不拍板，会导致什么工程或业务后果**
- 避免只写“建议这样做”，而不解释其背后的 trade-off

### 5.4 `问题` 的写法要求

- 必须是**业主可以直接作答**的句子
- 尽量避免把多个独立决策捆成一题
- 若问题天然包含两个子决策，需在问题里明确写出“如果确认，请同时回答 X / Y”

### 5.5 `业主回答` 的使用要求

- 业主回答应尽量简洁、明确、可执行
- 一旦填写，应同步成为后续 design / action-plan / review 的唯一口径
- 如果后续要推翻答案，应在同一份 QNA 中追加修订说明，而不是在别处悄悄改口
