# Nano-Agent 代码审查

> 审查对象: `pre-worker-matrix / W0-W4 action-plans`
> 审查时间: `2026-04-21`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
> - `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md`
> - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/action-plan/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> - `docs/action-plan/pre-worker-matrix/W4-workers-scaffolding.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**:`5 份 action-plan 在 narrowed scope 的"叙事面"已与 design v0.2/v0.3 基本对齐,但在"对代码事实的核对"上存在多处明显断点:引用未存在符号、把已存在文件声明为 add、漏掉必须的版本号 bump、缺乏 nacp-session 条件分支决策。若按现文执行,会触发实际的覆盖冲突与未定义符号编译错。`
- **结论等级**:`changes-requested`
- **本轮最关键的 3 个判断**:
  1. `W0 action-plan 完全漏掉 NACP_VERSION 从 1.3.0 bump 到 1.4.0 的物理动作,以及 nacp-session 条件 bump 决策 — 这两项 design §5.1 S6/S7 为硬交付,action-plan 任一 Phase 都没编号承接。`
  2. `W1 / W3 action-plan 把 docs/rfc/ 下 3 份 RFC 与 docs/design/pre-worker-matrix/ 下 map + pattern + TEMPLATE + 3 份 representative blueprint 一律声明为 "add / 新增"。事实:这些文件已全部 shipped(见 §1.2)。按 plan 执行会覆盖已验证内容。`
  3. `W0 action-plan 沿用 design 源头的符号名错误:引用 _PLATFORM_RESERVED / parseTenantKey / HOOK_EVENT_META_REGISTRY,但全仓 grep 零匹配(实际代码:KV_KEYS.featureFlags() 内联字面量 + HOOK_EVENT_CATALOG)。执行者直接按 plan 搬时会发现符号不存在。`

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/plan-pre-worker-matrix.md`(charter r2)
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`(v0.2 narrower)
  - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`(v0.3 RFC-only)
  - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`(v0.2 parallel)
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`(v0.3 map + 2-3 + optional)
  - `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`(v0.3 1 real + 3 dry-run)
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`(v0.3)
  - `docs/templates/code-review.md`
- **核查实现 / 仓库事实**:
  - `packages/nacp-core/package.json`(`"version": "1.3.0"`)
  - `packages/nacp-session/package.json`(`"version": "1.3.0"`)
  - `packages/nacp-core/CHANGELOG.md`(最新 entry 为 `1.3.0 — 2026-04-21 (B9)`)
  - `packages/nacp-core/src/` 子目录清单(含 `tenancy/ transport/ messages/ observability/` 但**不含** `evidence/ hooks-catalog/ storage-law/`)
  - `packages/session-do-runtime/src/eval-sink.ts`(`BoundedEvalSink` 为 runtime class,`EvalSinkEmitArgs/Overflow/Stats` 为 shape types)
  - `packages/hooks/src/catalog.ts`(导出常量名是 `HOOK_EVENT_CATALOG`,非 `HOOK_EVENT_META_REGISTRY`;枚举实测 18 events)
  - `packages/storage-topology/src/keys.ts`(只有 `DO_KEYS / KV_KEYS / R2_KEYS`;`_platform/` 是字面量前缀,**无** `_PLATFORM_RESERVED` 常量)
  - `packages/storage-topology/src/refs.ts`(只有 `buildDoStorageRef / buildR2Ref / buildKvRef`;**无** `parseTenantKey`)
  - `packages/capability-runtime/package.json`(dependencies 段为空;peerDependencies 仅 `zod`)
  - `packages/capability-runtime/src/` 全文 grep `from.*@nano-agent` 0 匹配(跨包 dep 只存在于注释)
  - `packages/capability-runtime/` 实测 src 4989 LOC / test 4484 LOC(design 估算 `~2400 src / ~3400 test` 偏低)
  - `packages/workspace-context-artifacts/package.json`(仍 `workspace:*`, version 0.1.0)
  - `packages/nacp-core/src/messages/context.ts:18/22/28-29`(`context.compact.request/response` 已 shipped)
  - `packages/nacp-core/src/messages/system.ts:20/27`(`audit.record` 已 shipped)
  - `docs/rfc/nacp-workspace-rpc.md`(115 行,已存在)
  - `docs/rfc/remote-compact-delegate.md`(100 行,已存在)
  - `docs/rfc/evidence-envelope-forwarding.md`(96 行,已存在)
  - `docs/design/pre-worker-matrix/W3-absorption-map.md`(140 行,已存在)
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(121 行,已存在)
  - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(118 行,已存在)
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(163 行,已存在)
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(已存在)
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(已存在)
  - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`(113 行,已存在)
  - `docs/rfc/nacp-core-1-4-consolidation.md`(**不**存在 — 需 W0 创建)
  - `pnpm-workspace.yaml`(当前只有 `packages: [packages/*]`;**无** `workers/*` / `dogfood/*`)
  - 仓库根目录:**无** `workers/ dogfood/ .github/` 三目录
- **执行过的验证**:
  - `grep -rn "_PLATFORM_RESERVED\|parseTenantKey" packages/`(0 matches)
  - `grep -rn "HOOK_EVENT_META_REGISTRY" packages/`(0 matches)
  - `wc -l docs/rfc/nacp-workspace-rpc.md`(115)+ 逐 RFC 存在性检查
  - `ls /workspace/repo/nano-agent/`(确认无 workers/ dogfood/ .github/)
  - 读 `packages/nacp-core/CHANGELOG.md`(确认当前最新 entry 为 1.3.0,无 1.4.0)
  - 读 W0-W5 design v0.2/v0.3 全文,对照每份 action-plan 的 Phase / work item / Out-of-Scope 列表

### 1.1 已确认的正面事实

- 5 份 action-plan 顶部前言 / §0 / §2 In-Scope / §2.3 边界判定表 均已写清 narrowed scope,叙事层面与 design v0.2/v0.3 对齐
- W0 action-plan P1-02 `sink-contract` 落点 = design §3.4 / §5.1 S1(v0.2 narrower)shipping shape-only,**class 不搬**,表述一致
- W0 action-plan §2 / §2.3 明确 `BoundedEvalSink class` / `HookEventMeta runtime metadata` = out-of-scope,与 design v0.2 narrowed boundary 一致
- W1 action-plan 全文 Phase 1/2/3 保持 RFC-only 立场,无偷渡 schema/helper/matrix code;与 design v0.3 major downgrade 对齐
- W2 action-plan §2.3 边界判定表把"首次真实发布"标 `defer / depends-on-decision`,与 design v0.2 parallel 对齐
- W3 action-plan §3 / §2 把"其余 7 份 detailed blueprint"标 out-of-scope,与 design v0.3 narrower 对齐
- W4 action-plan §3 P3-01 / P3-02 = 1 real(agent-core)+ 3 dry-run(bash/context/filesystem),与 design v0.3 一致
- W4 action-plan §2 "[S3] 让 shell 支持 `workspace:*` 或 published dual-path"与 design v0.2 parallel 对齐
- `context.compact.request/response` + `audit.record` 已在 nacp-core/messages/ 存在(W1 RFC 的事实锚点);W1 action-plan P1-01 / P1-02 "核对现有 family 是否足够"路径是正确的
- 仓库根目录物理事实:`workers/` / `dogfood/` / `.github/` 均不存在,W4 action-plan P1-01 / P2-02 / P2-02 "add" 类型正确
- W0 action-plan §1.5 目录树(`nacp-core/src/transport/ evidence/ storage-law/ hooks-catalog/`)与 design §3.4 子目录布局一致

### 1.2 已确认的负面事实

- `packages/nacp-core/package.json` 当前 version = `1.3.0`;**W0 action-plan 全文 5 个 Phase / 10 个 work item 无任何 NACP_VERSION bump 编号或动作**。design §5.1 S6 明示"NACP_VERSION 从 1.3.0 bump 到 1.4.0" 为硬交付。
- `packages/nacp-session/package.json` 当前 version = `1.3.0`;**W0 action-plan 无 nacp-session 条件分支决策工作项**。design §5.1 S7 明示"若依赖新 anchor 接口则 bump 到 1.4.0;否则保持 1.3.0" — plan §8.1 仅提了 `pnpm --filter @nano-agent/nacp-session typecheck build test`,没有 bump 决策 work item。
- `grep -rn "_PLATFORM_RESERVED\|parseTenantKey" packages/` 返回 0 匹配;W0 action-plan P1-03 描述"搬 builder helpers 与 `_platform` 常量"沿用 design §5.1 S5 / §8.2 的 `_PLATFORM_RESERVED / parseTenantKey` 符号名,但这些符号**不存在于源码**。实际事实:`KV_KEYS.featureFlags()` 用 **字面量** `"_platform/config/feature_flags"` 内联 `_platform/` 前缀;没有名为 `_PLATFORM_RESERVED` 的导出常量;没有 `parseTenantKey` 函数。
- `packages/hooks/src/catalog.ts:79` 导出的常量名为 `HOOK_EVENT_CATALOG`(不是 `HOOK_EVENT_META_REGISTRY`);action-plan 未直接使用该错名,但 §5.2 P2-02 "18 events 对齐当前 reality" 未明确重命名 / 引用路径,若执行者沿用 W0 design §5.1 S4 / §7.2 C4 / §8.2 的 `HOOK_EVENT_META_REGISTRY` 旧名,会出现符号找不到。
- `docs/rfc/nacp-workspace-rpc.md` / `remote-compact-delegate.md` / `evidence-envelope-forwarding.md` 三份 RFC **已 shipped**;W1 action-plan §3 P2-01 / P2-02 / P2-03 类型全部标 `add`,§5.2 "本 Phase 新增文件" 也列为新建。
- `docs/design/pre-worker-matrix/W3-absorption-map.md`(140)/ `W3-absorption-pattern.md`(121)/ `TEMPLATE-absorption-blueprint.md`(118)/ 3 份 W3-absorption-blueprint-*.md **已 shipped**;W3 action-plan §3 P1-01/02/03 + P2-01/02/03 全部标 `add`,§5.1 / §5.2 "本 Phase 新增文件" 也列为新建。
- `docs/design/pre-worker-matrix/W2-publishing-discipline.md`(113)已 shipped;W2 action-plan §3 P1-02 标 `update`(较准确)但 §1.5 目录树把它放在"Phase 1 新增"位置,语义含糊。
- `docs/rfc/nacp-core-1-4-consolidation.md` **不存在**;W0 action-plan §4.4 P4-01 / §7.3 文档同步都把它列为要产出的文件,OK — 但 §3 表里 type = `update`(而不是 `add`),与实际状态不一致。
- `pnpm-workspace.yaml` 当前无 `workers/*` / `dogfood/*`;W2 action-plan P2-02 dogfood 与 W4 action-plan P2-01 workers 都假设要扩 workspace yaml,但 W2 的改动在 action-plan §4.1 / §4.2 里**没有明确列出 pnpm-workspace.yaml 修改编号**(只在 §5.2 风险提示"dogfood 若进 workspace");W4 action-plan §5.2 明确要改 `pnpm-workspace.yaml`,但未说明是否同时要 `dogfood/` 排除在外。
- `packages/capability-runtime/` 源码 `grep from.*@nano-agent` 零匹配;W3 design v0.3 + action-plan §5.2 "bash-core 代表样本 / 跨包 dep 最复杂" 的选择理由与事实部分不符(capability-runtime 实际跨包 dep = 0,而 context-management 跨包 dep = 3)。
- `packages/capability-runtime/` 实测 src 4989 LOC + test 4484 LOC;远超 W3 design v0.3 §6.1 取舍 2 候选表里的 `~2400 src / ~3400 test` 估算;action-plan §5.3 P3-01 optional dry-run 的"工作量小"口径据此需要重估。

---

## 2. 审查发现

### R1. W0 action-plan 完全漏掉 `NACP_VERSION` 物理 bump 与 nacp-session 条件 bump 决策

- **严重级别**:`critical`
- **类型**:`delivery-gap`
- **事实依据**:
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md:271` 明示 `[S6] NACP_VERSION 从 1.3.0 bump 到 1.4.0;NACP_VERSION_COMPAT 保持 1.0.0`
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md:272` 明示 `[S7] nacp-session 若依赖新 anchor 接口则 bump 到 1.4.0;否则保持 1.3.0`
  - `packages/nacp-core/package.json:3` 当前 `"version": "1.3.0"`
  - `packages/nacp-core/src/version.ts` 当前导出 `NACP_VERSION = "1.3.0"`(B9 shipped,见 CHANGELOG)
  - `packages/nacp-session/package.json:3` 当前 `"version": "1.3.0"`
  - W0 action-plan §3 业务工作总表 10 个 work item(P1-01 到 P4-02)无任何"版本 bump"编号
  - W0 action-plan §4.4 Phase 4 只有两个 work item:P4-01 "CHANGELOG + RFC"(`update` CHANGELOG.md 文本)、P4-02 "W0 closure memo"(`add` closure md)— **均未涉及 `NACP_VERSION` 常量与 package.json version 字段的物理修改**
- **为什么重要**:
  - `NACP_VERSION` bump 是 W0 → W2 → W4 连锁 pipeline 的基线事实:若 W0 shipping 但 `NACP_VERSION` 仍是 "1.3.0",CHANGELOG 叙事说 1.4.0、W2 workflow trigger(`nacp-v1.4.0` tag)、W4 agent-core worker `curl | jq '.nacp_core_version'` 返回期望值 `"1.4.0"`(design W4 §7.2 S7 明示)都会撞到事实不一致
  - nacp-session 条件 bump 若不解决,W2 publish workflow 面对双包首发时 version 策略含糊(同步 bump 还是分别 bump 由 anchor 依赖决定),W2 plan P1-01 双包 publishConfig 也无法冻结
  - 若 execution 只按 W0 plan 的 10 个 work item 走,会出现"documented 1.4.0 but shipped 1.3.0"的软件事实漂移
- **审查判断**:
  - 这不是 wording 小瑕疵,而是 W0 实施路径的**硬交付工作项**完整度问题
- **建议修法**:
  - 在 W0 action-plan §3 业务总表与 §4.4 Phase 4 工作项表增加 `P4-00` 或 `P3-03`(改 `packages/nacp-core/src/version.ts` + `package.json` + nacp-session 对应 decision);至少要写明:
    - work item:bump `NACP_VERSION` from 1.3.0 → 1.4.0(物理改 const)
    - work item:决定 nacp-session 是否跟随 bump(evidence = 是否 import 新 anchor);若跟则改 package.json + CHANGELOG;若不则保留 1.3.0 + CHANGELOG "no delta for W0"
  - §8.3 DoD 增加"NACP_VERSION 常量 = 1.4.0;nacp-session version 决策有证据链"

### R2. W0 action-plan 引用不存在的符号 `_PLATFORM_RESERVED` / `parseTenantKey`;hooks 常量名用旧 `HOOK_EVENT_META_REGISTRY` 而代码实际是 `HOOK_EVENT_CATALOG`

- **严重级别**:`high`
- **类型**:`correctness`
- **事实依据**:
  - `grep -rn "_PLATFORM_RESERVED\|parseTenantKey" packages/` 返回 0 matches
  - `grep -rn "HOOK_EVENT_META_REGISTRY" packages/` 返回 0 matches
  - `packages/storage-topology/src/keys.ts:48-64` 实际导出的是 `KV_KEYS`(包含 `featureFlags: () => "_platform/config/feature_flags"` 函数);**不**存在名为 `_PLATFORM_RESERVED` 的常量
  - `packages/storage-topology/src/refs.ts:92/111/136` 只导出 `buildR2Ref / buildKvRef / buildDoStorageRef`;**不**存在 `parseTenantKey` 函数
  - `packages/hooks/src/catalog.ts:79` 实际导出名为 `HOOK_EVENT_CATALOG`(注释写 "the canonical hook-event catalog";18 events)
  - W0 action-plan §4.1 P1-03 工作内容"搬 builder helpers 与 `_platform` 常量"与 design §5.1 S5 "buildDoStorageRef / buildR2Ref / buildKvRef / KV_KEYS / parseTenantKey / _PLATFORM_RESERVED" 对齐但**继承了同样的符号名错误**
  - W0 action-plan §4.2 P2-02 "吸收事件名与 payload schema,不带 runtime meta" 未明确常量名,但 §5.2 "18 events 对齐当前 reality" 把"当前 reality"作为锚点 — 执行者若仍按 design 原文去 grep `HOOK_EVENT_META_REGISTRY`,找不到目标
- **为什么重要**:
  - 真正动手的工程师会按 plan → design 反向定位源文件;若 grep 无结果,会陷入"code 事实 vs. 文档叙事"的反复定位,浪费时间且最终要回改 plan
  - 这类符号名漂移也会污染后续 re-export 纪律:若 action-plan 要求原文件 re-export `_PLATFORM_RESERVED`,但这个常量不存在,re-export 写不出来
- **审查判断**:
  - 这是 W0 action-plan 继承 design **符号名 stale wording**;action-plan 作为"动手指南"更不应该遗留此类事实不符
- **建议修法**:
  - P1-03 工作内容改为"搬 `buildDoStorageRef / buildR2Ref / buildKvRef` + `DO_KEYS / KV_KEYS / R2_KEYS` 常量集合(其中 `KV_KEYS.featureFlags` 以字面量形式保留 `_platform/` 前缀作为唯一 platform-scoped exception);不搬 `parseTenantKey`(源码无此符号,若需要可在 W0 新 storage-law 子目录里**新增**定义)"
  - P2-02 工作内容明确:"搬 `HOOK_EVENT_CATALOG` 的 wire-level 部分(event name union + payload schema);HookEventMeta interface 与 `HOOK_EVENT_CATALOG` runtime metadata(blocking/allowedOutcomes/redactionHints)**不搬**,原位保留"
  - §8.1 整体测试加 `grep` 校验:W0 完成后,nacp-core/storage-law 应含 3 builder + KV_KEYS;nacp-core/hooks-catalog 应含 `HookEventName` union(18 entries)+ per-event payload schema

### R3. W1 action-plan 把 3 份已 shipped RFC 一律声明为 "add"

- **严重级别**:`critical`
- **类型**:`correctness`
- **事实依据**:
  - `ls docs/rfc/` 显示 3 份 RFC 均存在:`nacp-workspace-rpc.md`(115 行)、`remote-compact-delegate.md`(100 行)、`evidence-envelope-forwarding.md`(96 行)
  - W1 action-plan §3 业务总表 P2-01 / P2-02 / P2-03 类型全部标 `add`
  - W1 action-plan §5.2 "本 Phase 新增文件" 三份 RFC 全部列为新建
  - W1 action-plan §1.5 目录树 "Phase 2: RFC 起草" 下 3 份 RFC 全部在 Phase 2 产出
  - charter + W1 design v0.3 主线:3 份 RFC 是 W1 核心交付物 — 但**并非** pre-worker-matrix 阶段全新起草,而是在 pre-worker-matrix 前或前 0.5 阶段已 shipped
- **为什么重要**:
  - 按 plan 执行会遇到两种错误路径:(a) 作者直接新建 → Git 冲突或覆盖已验证内容;(b) 作者发现已存在 → 决策不清(是全重写、增量 revise、还是视为 done)
  - W1 的 gate 意义是 "3 份 RFC 存在且方向对" — 若 plan 不承认已存在事实,executor 与 reviewer 关于 "已经完成" 的判断会冲突
  - 连带影响 W5 X3 final closure 里 "W1 产出 3 份 RFC" 的 evidence 归档 — 如果按 plan 是 "刚做的",但 git blame 显示 "上周已做",两套时间线冲突
- **审查判断**:
  - W1 是本轮审查里最容易被误判为 done 的一个 phase — action-plan 没有把"已存在"状态 encode
- **建议修法**:
  - P2-01 / P2-02 / P2-03 类型改 `update`(或新增"状态 = already-shipped;本阶段动作 = 引用核对 + 按 W0 narrowed reality 做 revise pass")
  - §5.2 具体功能预期加一条:"每份 RFC:如已存在,只做(i) owner sign-off 状态确认;(ii) 与 W0 shipped path 的交叉引用核对;(iii) 若某 schema 草案与 W0 实际不符则增量 revise;不全重写"
  - §8.2 整体收口加 "3 份 RFC 的 git log 最新 revision 证据 + W0 path 交叉引用通过"

### R4. W3 action-plan 把 map + pattern + TEMPLATE + 3 份 representative blueprint 一律声明为 "add",忽视已存在事实

- **严重级别**:`critical`
- **类型**:`correctness`
- **事实依据**:
  - `ls docs/design/pre-worker-matrix/W3-absorption-*.md` 显示以下文件均已存在:
    - `W3-absorption-map.md`(140 行)
    - `W3-absorption-pattern.md`(121 行)
    - `W3-absorption-blueprint-capability-runtime.md`(163 行)
    - `W3-absorption-blueprint-workspace-context-artifacts-split.md`(shipped)
    - `W3-absorption-blueprint-session-do-runtime.md`(shipped)
    - `TEMPLATE-absorption-blueprint.md`(118 行)
  - W3 action-plan §3 业务总表 P1-01 / P1-02 / P1-03 类型全标 `add`
  - W3 action-plan §3 业务总表 P2-01 / P2-02 / P2-03 类型全标 `add`
  - W3 action-plan §5.1 "本 Phase 新增文件" 3 份 + §5.2 "本 Phase 新增文件" 3 份 全部列为新建
  - W3 action-plan §1.5 目录树 "Phase 1 新增 + Phase 2 新增" 全部标新建
- **为什么重要**:
  - 与 R3 同理,plan 与仓库事实冲突 → executor 判断不清;git 操作不明确(是 `git add` 新文件还是 `git mv` + edit existing);closure evidence 归档时间线断裂
  - W3 是本轮 scope 收窄最大的 phase,design v0.2 / v0.3 narrower 的 map + 2-3 blueprint + pattern 本来就是"已在设计阶段产出";action-plan 不承认这一事实会让 W3 被误判为"从零起步的大 migration phase"(反而回滑到旧 10 份 blueprint 的膨胀定义)
- **审查判断**:
  - W3 action-plan 的 Phase 结构可能完全错位:按 design v0.3,W3 的 action 应该是"按现有 map + 2-3 blueprint 做 verify pass + optional capability-runtime dry-run";但 plan 的 Phase 1 + Phase 2 完全在"写从未写过的 map 与 blueprint"
- **建议修法**:
  - P1-01 / P1-02 / P1-03 / P2-01 / P2-02 / P2-03 类型改为 `update / verify`(以核对 / 补 narrower wording 为主)
  - §1.2 Phase 总览结构重写:
    - Phase 1 → **reality verification pass**:核对已存在的 map / pattern / TEMPLATE / 3 blueprint 与 W0 shipped path 的 import 一致性、与 narrower scope 的 wording 一致性
    - Phase 2 → **增量 revise + gap fix**:若某 blueprint 与 W0 事实不符则补 patch;不重写
    - Phase 3 → **optional capability-runtime dry-run**(保持)
  - §5.1 / §5.2 "本 Phase 新增文件" 列表改为"本 Phase 修改文件"
  - §8.2 整体收口加 "map / blueprint / pattern / TEMPLATE 的 git log 最新 revision 时间合理,且与 W0 CHANGELOG 1.4.0 entry 不矛盾"

### R5. W0 action-plan "sink 子目录" 命名与 design §3.4 冲突;多个 Phase 间文件落点描述不一致

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - design W0 §3.4 明示子目录 `evidence/sink-contract.ts`(`只` shape + helper + dedup contract)
  - action-plan §1.5 "Phase 1 影响目录树" 写 `packages/nacp-core/src/evidence/`(目录层,未细化文件)
  - action-plan §3 P1-02 "sink-contract 落位" 文件 = `packages/nacp-core/src/evidence/sink-contract.ts` ✓
  - action-plan §5.1 Phase 1 "本 Phase 新增文件" 明确 `packages/nacp-core/src/evidence/sink-contract.ts` ✓
  - 但 action-plan §5.2 Phase 2 "本 Phase 新增文件" 又有 `packages/nacp-core/src/evidence/vocabulary.ts` — Phase 间 evidence/ 目录会**两次创建**(Phase 1 先建 sink-contract 触发 mkdir,Phase 2 再补 vocabulary)。未明确:是否 Phase 1 同时建 evidence/index.ts barrel,还是 Phase 2 才建
  - design §7.2 明示 evidence/ 下最终有 `sink-contract.ts` + `vocabulary.ts`,barrel 由 `evidence/index.ts`(action-plan 未显示此文件)
- **为什么重要**:
  - 若 barrel export 文件的创建时机不明,Phase 1 "package typecheck/build" 验证会因 evidence/index.ts 缺失而报错(executor 需临时决定)
  - 后续 Phase 3 re-export 也依赖 barrel 存在
- **审查判断**:
  - 小范围 docs-gap,不会阻塞执行但会增加 1-2 次 cycle
- **建议修法**:
  - P1-02 或 P2-01 的"涉及文件"加 `packages/nacp-core/src/evidence/index.ts`(barrel export;Phase 1 建 skeleton,Phase 2 加 vocabulary export)
  - 同理 `packages/nacp-core/src/storage-law/index.ts` / `hooks-catalog/index.ts` 的 barrel 建议也补上

### R6. W0 action-plan 无 `@deprecated` JSDoc 工作项单拆,re-export 纪律细节不明

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - design W0 §5.1 S11 "各 re-export 文件加 `@deprecated` JSDoc 指向 nacp-core 新位置,含'计划在 worker-matrix phase 后删除'说明"
  - action-plan §3 P3-01 工作项 "原位置 re-export,deprecated JSDoc" ✓(提到)
  - action-plan §4.3 P3-01 收口标准 "消费者零破坏" 未明确 `@deprecated` JSDoc 是否也在 P3-01 范围
  - action-plan §5.3 Phase 3 "本 Phase 修改文件" 列 4 个 package 根目录,但未细化要改的具体文件(`session-do-runtime/src/eval-sink.ts` / `hooks/src/catalog.ts` 等)
  - 无每个 re-export 目标文件的检查清单(design 级别至少应列 4-5 个文件)
- **为什么重要**:
  - `@deprecated` 是下游工程师辨别"这个包还是不是新 import 目标"的唯一机读线索;若漏加,worker-matrix P0 执行者可能继续从 `session-do-runtime/src/eval-sink.ts` 直接 import shape types(而不是 nacp-core),破坏 W0 narrower 立场
  - 文件级未展开意味着 4 个 package 的 re-export 改动没有可复现 checklist
- **审查判断**:
  - 中等风险,需要补细化
- **建议修法**:
  - P3-01 工作内容列 4 个具体文件(`packages/session-do-runtime/src/eval-sink.ts` / `packages/session-do-runtime/src/cross-seam.ts` / `packages/hooks/src/catalog.ts` / `packages/workspace-context-artifacts/src/evidence-emitters.ts` / `packages/storage-topology/src/keys.ts` / `packages/storage-topology/src/refs.ts`)
  - 每个文件的预期改动:(a) import from nacp-core 对应 shape;(b) re-export 保持原 export name;(c) 加 `/** @deprecated moved to @nano-agent/nacp-core/<path>; to be removed in worker-matrix phase */` JSDoc
  - §8.1 整体测试加一条:`grep -n "@deprecated" packages/{session-do-runtime,hooks,workspace-context-artifacts,storage-topology}/src/ | wc -l` 应 ≥ 5

### R7. W1 action-plan 无对 `context.compact.*` / `audit.record` 的事实交叉检查步骤,RFC 可能重复现有 message family

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `packages/nacp-core/src/messages/context.ts:18-29` 已注册 `context.compact.request/response` + body schema
  - `packages/nacp-core/src/messages/system.ts:20/27` 已注册 `audit.record` + body schema
  - W1 design §0.1 fact-check 段明示这两者已 shipped — W1 RFC 的核心立场是"复用,不新增"
  - W1 action-plan §4.1 P1-01 "compact reality 核对" 工作内容 = "核对现有 `context.compact.*` family 是否足够" ✓
  - W1 action-plan §4.1 P1-02 "audit reality 核对" 工作内容 = "核对 `audit.record` 与 evidence payload 的兼容性" ✓
  - 但 §4.2 P2-01 / P2-02 / P2-03 RFC 起草时,没有显式 work item 对"reality 核对的结果"做回写到 RFC 的验收标准
  - §5.2 Phase 2 风险提醒 "最容易回滑到'顺手把 helper 也做了'" ✓(保持 RFC-only 立场)但未提"不要重新设计已存在 family"
- **为什么重要**:
  - 若 RFC 撰写者不知情,可能在 `remote-compact-delegate.md` 里重新定义 compact family 的 request/response shape(违反 W1 设计核心:复用现有)
  - 这会让 W5 X2 (a) 一致性检查(W0 evidence shape ↔ W1 RFC)出现漂移
- **审查判断**:
  - 风险中等,当前 RFC 已存在(事实上已 shipped)所以实际 execution 危险性低;但 action-plan 作为"未来再次修订 RFC 时的指南"仍需明示
- **建议修法**:
  - §4.2 P2-02 收口标准补:"明示复用现有 `context.compact.request/response` — 不新增 compact message type"
  - §4.2 P2-03 收口标准补:"明示复用现有 `audit.record` + 现有 evidence payload — 不新增 evidence-forwarding message type"
  - §8.1 整体测试加 `grep -n "context.compact\|audit.record" docs/rfc/*.md`(期望 RFC 正文引用现有 type 名,不自创新 type)

### R8. W2 action-plan 缺 `pnpm-workspace.yaml` 排除 `dogfood/` 的显式 work item;`.npmrc` 样例未落实

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - design W2 §1.4 "`.npmrc` scope 映射 | dogfood 消费者示例 | 示例用 `@nano-agent:registry=...`"
  - design W2 §2.2 "dogfood 消费者有独立 lockfile;不污染主 repo" + "`pnpm-workspace.yaml` 不包含 dogfood 目录"
  - current `pnpm-workspace.yaml` = `packages: [packages/*]`(只 1 行,未来 W4 要加 `workers/*`;若 dogfood 放 repo 内也要显式排除,或在 packages: pattern 里不 glob 到)
  - W2 action-plan §3 业务总表无 "pnpm-workspace.yaml 修改" 或 "dogfood 排除策略" work item
  - §4.2 P2-02 "dogfood consumer" 涉及文件 = `dogfood/nacp-consume-test/*`(glob),但未列 pnpm-workspace.yaml 动作
  - §5.2 Phase 2 风险提 "dogfood 若进 workspace,会失去验证价值" — 这是提示不是动作
  - §3 P2-03 "auth/permission 文档" 工作内容 = 记录 `packages:write` 与 token 约定 — 但 `.npmrc` 作为物理文件(若 dogfood 要独立 lockfile,`.npmrc` 应在 `dogfood/nacp-consume-test/.npmrc` 落地)未列
- **为什么重要**:
  - 若 dogfood 误入 pnpm workspace,会变成 `workspace:*` link 而不是走 GitHub Packages,首发 verify 失效(P2-02 的验证价值归零)
  - `.npmrc` 具体路径与内容不明,owner 配置时易出错(`@nano-agent:registry=https://npm.pkg.github.com` 还是 `@<owner-scope>:registry=...`)
- **审查判断**:
  - Phase 2 的 dogfood 部分缺 1-2 个具体 work item
- **建议修法**:
  - P2-02 "dogfood consumer" 涉及文件明确列出:`dogfood/nacp-consume-test/package.json`(含 NACP dep version = 1.4.0)、`dogfood/nacp-consume-test/.npmrc`(scope→registry 映射)、`dogfood/nacp-consume-test/src/smoke.ts`(最小 import NACP_VERSION 的断言)、`dogfood/nacp-consume-test/README.md`
  - 新增 P2-04 "pnpm-workspace.yaml 保持排除 dogfood/":动作 = 确认 packages glob 不匹配 `dogfood/*`,或显式加 `!dogfood/*` negation(pnpm 支持)
  - §5.2 收口标准增加:`cd dogfood/nacp-consume-test && pnpm install --registry=https://npm.pkg.github.com && pnpm build` 可 dry-run 成功(若 W2 未首发,则模拟本地 file: fallback)

### R9. W3 action-plan "capability-runtime 跨包 dep 最复杂"的代表性论证与代码事实部分不符

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `packages/capability-runtime/package.json` `dependencies` 段空;`peerDependencies` 仅 `zod` — 不含任何 `@nano-agent/*`
  - `grep -rn "from.*@nano-agent\|import.*@nano-agent" packages/capability-runtime/src/` 返回 0 matches(跨包提及只存在于注释)
  - 对比 `packages/context-management/package.json` `dependencies` 含 3 个 `@nano-agent/*`(storage-topology / workspace-context-artifacts / eval-observability)
  - 对比 `packages/session-do-runtime/package.json` `dependencies` 含 4 个 `@nano-agent/*`
  - W3 design v0.3 §6.1 取舍 2 候选表写 `capability-runtime | 跨 package 依赖 中(nacp / hooks)`— 事实不符
  - W3 action-plan §5.2 Phase 2 风险 "split-package 最容易出现 owner 误判与 consumer path 断裂" 没对此做 follow-up;§2.3 边界表 "capability-runtime dry-run defer / depends-on-decision"(OK)但 §4.2 P2-01 "capability-runtime blueprint" 预期结果 = "bash-core 吸收路径清晰" 未指出 "capability-runtime 跨包 dep = 0" 的事实意义
- **为什么重要**:
  - 若 W3 optional dry-run 要"强化 pattern spec 循环引用节 lessons",capability-runtime 作为 dep=0 的包,和 llm-wrapper 一样**不能**产出循环引用 lessons(这恰是 W3 design 指责 llm-wrapper 代表性低的原因)
  - context-management(3 个 dep)或 session-do-runtime(4 个 dep)才是循环引用 pattern 的真代表
  - 这一事实盲点会在 W3 dry-run 执行或 worker-matrix P0 按 pattern 外推时爆发
- **审查判断**:
  - 这一盲点是 W3 design v0.3 → action-plan 继承,而非 action-plan 独创;但 action-plan 作为 execution 指南有责任校准
- **建议修法**:
  - P2-01 "capability-runtime blueprint" 收口标准补:"明示 capability-runtime 跨包 dep 事实 = 0(只通过注释引用他包);因此本 blueprint 的 representativeness 是 LOC-heavy + seam(fake-bash)+ policy 组合,**不是** circular dep pattern"
  - §6.1 Q 补一条:"若 owner 选择做 optional dry-run 以强化 pattern spec 循环引用节,capability-runtime 代表性是否足够?否则备选 context-management 或 session-do-runtime"
  - §7.1 风险表加 "capability-runtime dry-run 无法覆盖循环引用 pattern" 单独一行

### R10. W3 action-plan `capability-runtime` LOC 估算与代码事实脱节

- **严重级别**:`low`
- **类型**:`correctness`
- **事实依据**:
  - 实测 `find packages/capability-runtime/src -name "*.ts" | xargs wc -l` = 4989 LOC
  - 实测 test dir = 4484 LOC
  - W3 design v0.3 §6.1 取舍 2 候选表写 `capability-runtime | ~2400 / ~3400` — 显著偏低(实测 ≈ 2× 源 + 1.3× 测)
  - W3 action-plan 没有直接引用 LOC 数字,但 §5.3 Phase 3 "optional dry-run" 工作量隐含"规模 ≈ design 估算"假设;预期代码量级未给出但 §1.2 Phase 表把 Phase 3 标 `S`(小工作量)
- **为什么重要**:
  - LOC 偏低 2x 意味着 optional dry-run(若做)实际耗时比预期长,owner 的 "是否做 dry-run" 决策依据不准
  - Pattern spec 里基于实测推导的 "LOC × 0.5min" 估算系数会因 anchor 不准而失真
- **审查判断**:
  - 低风险 — optional work 且不在本阶段 gate
- **建议修法**:
  - P3-01 涉及文件补 "估算 note:capability-runtime src ≈ 5000 / test ≈ 4500;dry-run copy + wire + build 预计 0.5-1 天,而非 S 级"
  - §1.2 Phase 表 Phase 3 工作量从 `S` 改为 `S-M`,并在 Q1 加 "若 dry-run 做,owner 预留 1 天"

### R11. W4 action-plan 对 agent-core 独特 DO slot 与其他 3 workers uniform shell 的结构差异未单独拆 work item

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - design W4 §5.3 边界:agent-core 有 DO slot(stub export `NanoSessionDO` class 作为 binding migration target);其他 3 workers 只有 plain fetch handler
  - action-plan §1.5 目录树 4 workers 并列,无 agent-core 特殊化说明
  - action-plan §4.1 P1-01 / P1-02 "shell 文件" 工作内容 "每个 worker 补 wrangler.jsonc/package.json/src/test/README" — 未提 agent-core 独特的 `src/nano-session-do.ts` DO stub 文件
  - §5.1 "具体功能预期 3" 只一句话提 "`agent-core != binding slot` 的 host 定位可在 shell 层预留 DO slot" — 非可执行 work item
  - design W4 §7.2 S1 明示 agent-core `wrangler.jsonc` 含 `durable_objects.bindings` 声明(slot,不绑真实 DO ID)+ `migrations` block;其他 3 workers 无这些块
  - agent-core `src/index.ts` 需 export `NanoSessionDO` class(DO 约定要求 Worker 模块 export DO class 与同名 binding)
- **为什么重要**:
  - 若 executor 按统一模板建 4 workers,agent-core 的 DO slot 会漏;wrangler deploy(agent-core 1 real)时会因 DO binding 声明缺失而 fail
  - agent-core 的 real deploy 是 W4 唯一外部验证点;这一步 fail 会让 W4 整体 closure 无法推进
- **审查判断**:
  - delivery-gap 明显 — 需要单独 work item
- **建议修法**:
  - §3 新增 P1-03 "agent-core DO slot":工作内容 = 在 `workers/agent-core/src/` 新增 `nano-session-do.ts` stub(class + export);`workers/agent-core/src/index.ts` re-export 该 class 作为 DO binding class;`wrangler.jsonc` 声明 `durable_objects.bindings` slot + `migrations: [{ tag: "v1", new_sqlite_classes: ["NanoSessionDO"] }]`
  - §4.1 Phase 1 表扩为 3 行(P1-01 / P1-02 / P1-03)
  - §5.1 Phase 1 "本 Phase 新增文件" 加 `workers/agent-core/src/nano-session-do.ts`
  - §7.1 风险表加 "agent-core DO slot 漏声明 → wrangler deploy fail → W4 唯一 real deploy 失败"

### R12. W4 action-plan 缺 Cloudflare 凭据不可用时的 fallback 路径;real deploy 外部 gate 影响 W4 closure 不明确

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - design W4 §5.3 边界 / §7.3 非功能:若 owner 未及时提供 Cloudflare 凭据,W4 closure memo 以 "shell deployable,待 owner 提供 Cloudflare credentials 触发" 状态记录(fallback 允许)
  - action-plan §6.1 Q1 "owner 是否提供 Cloudflare 账户与凭据" A = "待 owner 决定" — 未给 fallback 方案
  - action-plan §3 P3-01 "agent-core real deploy" 风险等级 = `high`,但 §4.3 Phase 3 收口标准 "至少 1 个 live URL / live JSON 可访问" — 无 fallback 状态 (shell deployable 但未 deployed)
  - action-plan §7.1 风险 "Cloudflare 凭据" 应对 "先完成 shell/CI,最后再做 real deploy" — 没有 "若凭据始终不可用,W4 以何状态 closure" 的明文
  - §8.2 整体收口 "3. agent-core 完成 1 次真实 deploy" 是硬条件,与 design fallback 冲突
- **为什么重要**:
  - Cloudflare 凭据作为外部 gate 在 pre-worker-matrix 阶段是真实阻塞点;若 action-plan 不给 fallback,W4 closure 会 stuck
  - W5 handoff memo 也会因为"agent-core URL 存在"为硬前置而受影响
- **审查判断**:
  - 中等风险 — design 明示允许 fallback,plan 未继承
- **建议修法**:
  - §3 P3-01 收口标准扩为二元:(A) 若凭据可用 → 1 live URL + curl JSON 可访问;(B) 若凭据不可用 → `wrangler deploy --dry-run` 成功 + closure memo 记录 "agent-core shell deployable,pending owner credentials"
  - §8.2 整体收口 3 改为 "agent-core 完成 1 次真实 deploy **或** shell-deployable 状态明确"
  - §6.1 Q1 默认答案提供:"若 owner 不能在 Phase 3 前提供凭据,W4 按 (B) 路径 closure,real deploy 推迟到 worker-matrix P0 首次 milestone"

### R13. W5 action-plan 完全缺失 — pre-worker-matrix 整体 closure 没有 execution 文档

- **严重级别**:`critical`
- **类型**:`delivery-gap`
- **事实依据**:
  - `ls docs/action-plan/pre-worker-matrix/` 显示 W0-W4 5 份,**无 W5 action-plan**
  - design `docs/design/pre-worker-matrix/W5-closure-and-handoff.md` 明示 X1-X7 + 横向一致性 5 对角线检查 + 6 就绪 handoff memo + charter rewrite trigger 等 7 个核心产出
  - W0-W4 action-plan 各自 `phase 4 / Phase 3` 都产出 "W*-closure.md" 归 W5 消费
  - charter r2 §11 exit criteria 的第 6 条 handoff 就绪 没有对应 execution 计划
- **为什么重要**:
  - 5 份 W0-W4 closure memo 谁来做 aggregate? 按谁的纪律做 X2 横向 5 对角线一致性检查? 如何从 W0-W4 closure 汇总到 pre-worker-matrix-final-closure.md?— 全部悬空
  - 若 executor 认为 "W0-W4 都 close 就算 pre-worker-matrix 完成",会跳过 W5 的横向一致性检查,charter r2 §11 第 6 条 exit 无法验证
- **审查判断**:
  - 这是整组 action-plan 的**最高级别缺口**:5 个 phase 有 4 份 plan,第 5 份(W5)完全缺失
- **建议修法**:
  - 新增 `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md`,按 W5 design X1-X7 7 个核心产出拆 Phase:
    - Phase 1:W0-W4 closure 审阅 + X2 横向 5 对角线检查(X1 + X2)
    - Phase 2:final closure + handoff memo(X3 + X4)
    - Phase 3:meta-doc 更新(X5 + X6)+ charter state flip(X7)
  - 每个 Phase 的收口标准对齐 charter r2 §11 的 6 条 exit criteria
  - 在 W0-W4 action-plan 顶部 "关联设计 / 调研文档" 加 `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md` pointer

### R14. 全部 action-plan §6 Q/A 两条模板化问题都标 "A: 待 owner 决定" — 执行前决策路径不清

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - W0 action-plan §6.1 Q1/Q2 "A: 待 owner 决定"
  - W1 §6.1 Q1/Q2 "A: 待 owner 决定"
  - W2 §6.1 Q1/Q2 "A: 待 owner 决定"
  - W3 §6.1 Q1/Q2 "A: 待 owner 决定"
  - W4 §6.1 Q1/Q2 "A: 待 owner 决定"
  - 总计 10 个 open 问题 等 owner 回答
- **为什么重要**:
  - 其中部分问题 charter r2 已 frozen(W2 Q1 scope / W3 Q1 dry-run decision / W4 Q2 workspace:* interim)— 不需要再问
  - 部分问题 design v0.3 已给默认答案(W0 Q2 "re-export 保留至少 3 个月" / W1 Q2 "RFC-only gate")— action-plan 应默认继承
- **审查判断**:
  - 低风险但会延缓启动
- **建议修法**:
  - 按 charter r2 + design v0.3 默认答案预填各 Q.A:
    - W0 Q1:"A:是,1.4.0 同时承载 W0 narrower;W1 RFC-only 不 bump"
    - W0 Q2:"A:是,至少 3 个月 re-export / deprecated 窗口"
    - W1 Q2:"A:是,W1 只作为 RFC gate(无 code-ship 硬交付)"
    - W2 Q2:"A:否,首次真实发布可 optional parallel(charter r2 §11 未把它列为 exit 硬条件)"
    - W3 Q1:"A:否,optional dry-run 可延期到 worker-matrix P0"
    - W4 Q2:"A:是,全程 workspace:* interim 可接受;切换到 published 由 worker-matrix 阶段决定"
  - Owner 若不同意可 revise;默认答案减少启动摩擦

---

## 3. In-Scope 逐项对齐审核

> 以 W0-W5 design(v0.2/v0.3 narrowed)为真理源,核查 action-plan 是否把 design 的 In-Scope 条目全部承接。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | W0:S1-S12 共 12 条 In-Scope 是否全承接? | `partial` | P3-01 覆盖 S11 deprecated JSDoc 但未细化文件级;**S6 NACP_VERSION bump + S7 nacp-session 条件 bump 完全漏**;S8 RFC 文件名正确;S10 regression 覆盖 |
| S2 | W1:3 份 RFC + 现状核对 + closure + cross-doc | `done (description)` | Phase 1-3 结构与 design Phase 对齐;**但把 3 份已 shipped RFC 标 add** — 见 R3 |
| S3 | W2:skeleton mandatory + first publish optional + dogfood + discipline | `partial` | P1-01/02 + P2-01/02 正确;**pnpm-workspace.yaml 排除 dogfood 无 work item / `.npmrc` 未落文件** — 见 R8 |
| S4 | W3:map + 2-3 blueprint + pattern + optional capability-runtime dry-run + closure | `partial` | 结构对齐 **但已存在文件全标 add** — 见 R4;**capability-runtime 跨包 dep 代表性论证与事实不符** — 见 R9 |
| S5 | W4:workers/ + 4 shell + workspace + CI + agent-core 1 real + 3 dry-run + closure | `partial` | Phase 1-3 结构对齐 **但 agent-core DO slot 未单独拆** — 见 R11;**Cloudflare 凭据 fallback 缺** — 见 R12 |
| S6 | W5:final closure + handoff + X2 5 对角线 + meta-doc + charter flip | `missing` | **W5 action-plan 文件不存在** — 见 R13 |

### 3.1 对齐结论

- **done**: `0`(W1 结构对齐但有 R3 负面事实 — 不计全 done)
- **partial**: `5`
- **missing**: `1`

> 这组 action-plan 当前更像"narrowed scope 已在叙事层接受,但对仓库现有事实(已存在 RFC / 已存在 design 产出 / 仓库符号名 / 版本号现状)未做机读校验"。W5 action-plan 的完全缺失尤其严重,会让整个 pre-worker-matrix phase 缺少收口 execution 路径。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | W0 不搬 `BoundedEvalSink` class / `HookEventMeta` / emit* / dispatch / storage adapters | `遵守` | §2.2 [O1]-[O2] / §2.3 边界表 / §4.1 P1-02 / §5.1 Phase 1 风险 全文保持 shape-only 口径 |
| O2 | W0 不做协议新设计(归 W1) | `遵守` | §2.2 [O3] 明确 |
| O3 | W0 不发布 1.4.0(归 W2) | `遵守` | §2.2 [O4] 明确 |
| O4 | W1 不做 code ship / schema / helper / matrix / tests | `遵守` | §2.2 [O1]-[O3] + §5.2 风险提醒 |
| O5 | W1 不改 worker shell / deploy / publish | `遵守` | §2.2 [O4] 明确 |
| O6 | W2 不发布任何 Tier B package | `遵守` | §2.2 [O1] 明确 |
| O7 | W2 不引入 beta/rc/canary 等复杂 release | `遵守` | §2.2 [O2] 明确 |
| O8 | W2 不把 W4 强绑 "只能从 GitHub Packages 安装" | `遵守` | §2.2 [O3] + §2.3 边界 dual-path |
| O9 | W3 不写全 10 份 detailed blueprint | `遵守` | §2.2 [O1] + §2.3 边界 |
| O10 | W3 不实际 absorb / 不 del 旧 package / 不 deprecated banner | `遵守` | §2.2 [O2]-[O3] + §5.1 风险 |
| O11 | W3 optional dry-run 不升级为硬 gate | `遵守` | §2.2 [O4] + §5.3 风险 |
| O12 | W4 不吸收 Tier B 业务代码 | `遵守` | §2.2 [O1] |
| O13 | W4 不打通真实 service binding 对端 | `遵守` | §2.2 [O2] |
| O14 | W4 不创建真实 DO / KV / R2 / D1 资源 | `遵守` | §2.2 [O3] |
| O15 | W4 不把 4 workers 都做真实业务 deploy | `遵守` | §2.2 [O4] / §2.3 边界(1 real + 3 dry-run) |

Out-of-Scope 的叙事边界整体维护良好;问题集中在 In-Scope 的**漏接 + 事实漂移**。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`W0-W4 action-plan 在 narrowed scope 叙事面对齐 design v0.2/v0.3,但存在 14 条可识别缺口 — 其中 3 条 critical(W0 漏 NACP_VERSION bump;W1/W3 把已存在文件标 add;W5 action-plan 完全缺失),5 条 high/medium 影响执行正确性。现阶段不应作为 pre-worker-matrix 的可直接执行 SSOT。`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. 补齐 W5 action-plan(R13);覆盖 X1-X7 7 个产出 + 横向 5 对角线检查 + 6 就绪 handoff
  2. W0 action-plan 新增 `NACP_VERSION` bump work item 与 nacp-session 条件 bump work item(R1)
  3. W0 / W1 / W3 按仓库现有事实校准"已存在文件"状态:type 从 `add` 改 `update/verify`(R2 / R3 / R4)
  4. W0 action-plan 校准 `_PLATFORM_RESERVED` / `parseTenantKey` / `HOOK_EVENT_META_REGISTRY` 符号名,与代码事实对齐(R2)
  5. W4 action-plan 拆 agent-core DO slot 单独 work item + Cloudflare 凭据不可用时 fallback 路径(R11 / R12)
- **可以后续跟进的 non-blocking follow-up**:
  1. W0 action-plan 补 `evidence/index.ts` / `hooks-catalog/index.ts` / `storage-law/index.ts` barrel export 创建时机;补 `@deprecated` JSDoc 文件级 checklist(R5 / R6)
  2. W2 action-plan 补 `pnpm-workspace.yaml` 排除 dogfood 的显式 work item + `.npmrc` 物理文件落盘(R8)
  3. W1 action-plan 补 "复用现有 `context.compact.*` / `audit.record` 不新增 family" 的收口标准(R7)
  4. W3 action-plan 校准 capability-runtime 跨包 dep 事实 = 0 + LOC 实测 5000/4500 + dry-run 工作量 S → S-M(R9 / R10)
  5. 全部 action-plan §6 Q.A 按 charter r2 / design v0.3 默认答案预填,避免 10 个 "待 owner 决定" 拖慢启动(R14)

> 本轮 review 不收口,等待实现者按 §6 响应并重写相关 action-plan(特别是 W5 从零起草,以及 W0 / W3 的已存在文件状态校准)。

---
