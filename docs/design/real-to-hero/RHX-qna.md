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
