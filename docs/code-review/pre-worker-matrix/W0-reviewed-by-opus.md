# W0 — NACP Protocol Consolidation — 代码审查

> 审查对象: `pre-worker-matrix / W0 / nacp-consolidation` (GPT 实装)
> 审查时间: `2026-04-22`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - 代码: `packages/nacp-core/src/{evidence,hooks-catalog,storage-law,transport/cross-seam.ts,index.ts,version.ts}`
> - 代码: `packages/{session-do-runtime,hooks,storage-topology,workspace-context-artifacts}/src/` 中被 W0 触及的文件
> - 测试: `packages/nacp-core/test/{evidence,hooks-catalog,storage-law,transport/cross-seam,version}.test.ts` + 原 package 现存 tests + `test/nacp-1-3-matrix-contract.test.mjs`
> - 文档: `packages/nacp-core/CHANGELOG.md` §1.4.0 + `docs/rfc/nacp-core-1-4-consolidation.md` + `docs/issue/pre-worker-matrix/W0-closure.md` + `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md` §11 dev log
> - 对照设计: `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` (v0.2) + `docs/plan-pre-worker-matrix.md` §1.3 / §4.1.A / §7.1
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**:W0 的**代码实装主体成立**:Tier A vocabulary 已按 v0.2 narrower scope 物理归位到 `@nano-agent/nacp-core@1.4.0`,runtime class / dispatcher / adapter 全部按纪律留在原位,下游 4 包通过 re-export 维持 additive / non-breaking 消费面。但**文档收口侧存在几处缺口**(尤其是设计文档未更新到 executed 状态、re-export JSDoc 漏写删除窗口、closure 的回归验证面无可核对证据),**不应直接标记 W0 closed**,需要一轮 minor 文档修补后再收口。
- **结论等级**:`approve-with-followups`(code 层 approve,docs 层 changes-requested)
- **本轮最关键的 3 个判断**:
  1. **narrowed scope 纪律遵守得很好**:`BoundedEvalSink`/`CrossSeamError`/`StartupQueue`/`HookEventMeta`/`HOOK_EVENT_CATALOG`/storage adapters 都**没有**被错误搬进 core,v0.2 对 r1 的收窄被兑现。
  2. **shape 保真度高**:所有吸收对象(`CrossSeamAnchor` / `EvalSink*` 类型 / 18 events / `DO_KEYS` / `KV_KEYS` / `R2_KEYS` / 4-stream evidence schema / `_platform/config/feature_flags` 例外)在 nacp-core 中的 shape 与原位置 byte-identical,无 semantic drift。
  3. **文档与证据链条有 4-5 处 gap**:design 文档未更新、deprecated JSDoc 漏写时限、"5 类独立 PR" 纪律未兑现(只有 2 个 feat 提交)、closure 列出的回归命令无输出证据(尤其 B7 LIVE)。这些都是**收口级问题**,不影响代码正确性但影响"W0 closed"判定。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/plan-pre-worker-matrix.md` r2 — §1.3 Tier A 映射表 / §4.1.A W0 narrower In-Scope / §7.1 W0 详细说明
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` v0.2 — §0.4 4 处 charter 修正 / §3.4 nacp-core 目标结构 / §5.1 In-Scope 12 项 / §5.2 Out-of-Scope / §6 tradeoff / §7.2 C1-C7 详细
  - `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md` 本身 — §3 工作总表 12 项 P1-01 … P4-04 / §4 Phase 表格 / §7.3 文档同步要求 / §8.2/8.3 收口标准 / §11 GPT 工作日志
- **核查实现**:
  - `packages/nacp-core/src/{evidence/*,hooks-catalog/*,storage-law/*,transport/cross-seam.ts,index.ts,version.ts}`
  - `packages/nacp-core/package.json` / `packages/nacp-core/CHANGELOG.md`
  - `packages/nacp-core/test/{evidence,hooks-catalog,storage-law,transport/cross-seam,version}.test.ts`
  - `packages/session-do-runtime/src/{eval-sink.ts,cross-seam.ts,index.ts,remote-bindings.ts}`
  - `packages/hooks/src/catalog.ts`
  - `packages/storage-topology/src/{keys.ts,refs.ts,taxonomy.ts,index.ts}`
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`
  - `packages/nacp-session/src/*.ts`(import 面核查)
  - `packages/*/package.json`(版本与依赖)
  - `test/nacp-1-3-matrix-contract.test.mjs`
  - `docs/rfc/nacp-core-1-4-consolidation.md` / `docs/issue/pre-worker-matrix/W0-closure.md`
- **执行过的验证**:
  - `git log --oneline` — W0 总共 4 个相关提交:`f939365` (nacp-core feat) → `99c0d3e` (downstream adapt) → `f106081` (docs/issue + RFC) → `a52a21c` (matrix contract test + lockfile)
  - `git show f939365 --stat` / `git show 99c0d3e --stat` — 文件级 diff 规模核对
  - `git show 99c0d3e~1:packages/session-do-runtime/src/eval-sink.ts` — pre-W0 原 shape 对比
  - `git show 99c0d3e~1:packages/storage-topology/src/{keys,refs}.ts` — pre-W0 原 key/builder 对比
  - `grep -rn "extractMessageUuid\|CrossSeamAnchor\|EvalSinkEmitArgs\|DO_KEYS\|KV_KEYS\|validateRefKey" packages/*/test/` — 下游 test 对 re-export 的消费覆盖
  - `ls packages/nacp-core/dist/{evidence,hooks-catalog,storage-law,transport}` — build 产物确认(subpath exports 可 resolve)
  - `cat packages/nacp-core/package.json` — `publishConfig` / `exports` 面核查
  - `wc -l` 新老文件行数

### 1.1 已确认的正面事实

1. **版本 bump 正确落地**:`packages/nacp-core/package.json` 与 `packages/nacp-core/src/version.ts` 均已 `1.3.0 → 1.4.0`;`NACP_VERSION_COMPAT` 保持 `1.0.0`;`NACP_VERSION_KIND = "frozen"` 不变。
2. **`test/nacp-1-3-matrix-contract.test.mjs` 同步更新**:`NACP_VERSION` 断言从 `"1.3.0"` 改为 `"1.4.0"`,同测试继续断言 `NACP_SESSION_VERSION === "1.3.0"`。
3. **nacp-session 版本保持 1.3.0** 且决策与代码事实一致:`grep "nacp-core"` 显示 nacp-session 只 import 既有的 `NacpRefSchema / SessionPhase / NacpValidationError / NacpAuthority / NACP_VERSION / NacpDeliveryKind`,**没有 import** 任何 W0 新产物(CrossSeamAnchor / EvalSink* / evidence vocab / HookEventName / storage-law)—— 因此不随 bump。
4. **4 个新子目录全部创建且结构与 design §3.4 冻结图一致**:
   - `nacp-core/src/transport/cross-seam.ts` (93 lines, propagation only)
   - `nacp-core/src/evidence/{sink-contract.ts (81), vocabulary.ts (146), index.ts (35)}`
   - `nacp-core/src/hooks-catalog/index.ts` (193)
   - `nacp-core/src/storage-law/{constants.ts (38), builders.ts (83), index.ts (12)}`
5. **subpath exports 与 build dist 一致**:`packages/nacp-core/package.json` 的 `exports` 新增 `./evidence / ./hooks-catalog / ./storage-law`;`dist/{evidence,hooks-catalog,storage-law}/` 已构建完成,可 resolve。
6. **顶层 `nacp-core/src/index.ts` 公开面补齐**:一次性暴露 W0 产出的全部 symbol(`extractMessageUuid` / 所有 evidence schema / `HOOK_EVENT_NAMES` / `HookEventNameSchema` / 18 payload schemas / `HOOK_EVENT_PAYLOAD_SCHEMA_{NAMES,SCHEMAS}` / `DO_KEYS` / `KV_KEYS` / `R2_KEYS` / 3 builders + `validateRefKey` / `CrossSeamAnchor` + 3 headers helpers);`EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats` 作为 `export type` 暴露。
7. **shape byte-identical 验证通过**(design §0.2 Additive-only / shape 不改纪律):
   - `EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats` 字段、字段顺序、readonly modifier 与 pre-W0 `session-do-runtime/src/eval-sink.ts` 完全一致(7 字段 stats;2 字段 emit args;5 字段 overflow disclosure)。
   - `CrossSeamAnchor` 字段与 `CROSS_SEAM_HEADERS` 值一一对应:`traceUuid / sessionUuid / teamUuid / requestUuid / sourceRole? / sourceKey? / deadlineMs?` + 7 个 header 常量值;`readCrossSeamHeaders / buildCrossSeamHeaders / validateCrossSeamAnchor` 行为与 design §3.1 承诺一致。
   - `DO_KEYS / KV_KEYS / R2_KEYS` 字段、函数签名、`"_platform/config/feature_flags"` 字面量例外全部保留。
   - 18 hook events 按当前 reality 枚举,且 payload schema 与 pre-W0 的 payload 定义 shape 对齐(通过 `packages/nacp-core/test/hooks-catalog.test.ts` 的 18-event fixtures 验证)。
   - Evidence 4-stream schema(assembly / compact(4 phases) / artifact / snapshot(2 phases))的字段覆盖与 pre-W0 `workspace-context-artifacts/src/evidence-emitters.ts` 的 `build*Evidence()` 返回类型一致(已在 `packages/nacp-core/test/evidence.test.ts` 用 4 类 fixture 验证)。
8. **narrowed scope 纪律被严格兑现**:以下 runtime / metadata 按 v0.2 约定**留在原位**,通过 inspection 确认:
   - `BoundedEvalSink` class → `packages/session-do-runtime/src/eval-sink.ts:92-207`(仍在原位,只 re-import types)
   - `CrossSeamError` / `CROSS_SEAM_FAILURE_REASONS` / `StartupQueue` → `packages/session-do-runtime/src/cross-seam.ts:46-201`(仍在原位)
   - `HookEventMeta` interface + `HOOK_EVENT_CATALOG` runtime metadata(`blocking / allowedOutcomes / redactionHints`)→ `packages/hooks/src/catalog.ts:47-230`(仍在原位,继续维护)
   - `emit*Evidence()` helpers / `buildAssemblyEvidence` 等 → `packages/workspace-context-artifacts/src/evidence-emitters.ts`(仍在原位,只 import record types from nacp-core)
   - storage adapters / `taxonomy.ts` / `placement.ts` / `calibration.ts` / `mime-gate.ts` → `packages/storage-topology/src/`(未触及)
9. **原位置全部变为 explicit re-export(不是 `export *`)**,符合 design §5.3 偏好:
   - `packages/session-do-runtime/src/eval-sink.ts:2-18` — 显式列 3 type + 1 helper
   - `packages/session-do-runtime/src/cross-seam.ts:27-36` — 显式列 4 symbol + 1 type
   - `packages/hooks/src/catalog.ts:1-4,43-44` — 显式 import + re-export HookEventName
   - `packages/storage-topology/src/keys.ts:4` — 显式列 3 constants
   - `packages/storage-topology/src/refs.ts:4-13` — 显式列 4 symbol + 2 type
10. **下游 tests 间接覆盖 re-export 路径**(design §5.1 S9 的实际兑现方式):
    - `packages/session-do-runtime/test/eval-sink.test.ts` 仍从 `../src/eval-sink.js` import `extractMessageUuid`(即经 compat re-export 链到达 nacp-core)
    - `packages/session-do-runtime/test/cross-seam.test.ts` 同理,经 re-export
    - `packages/storage-topology/test/{keys,refs}.test.ts` 同理
    - `packages/hooks/test/catalog.test.ts` 仍 import `HookEventName` + `HOOK_EVENT_CATALOG`(前者经 re-export,后者原位)
11. **CHANGELOG 1.4.0 entry 完整**:`packages/nacp-core/CHANGELOG.md:1-29` 含 Added / Changed / Not shipped(deferred) 三个 block,"Not shipped" 显式记录了 `BoundedEvalSink / CrossSeamError / StartupQueue / evidence emitters / hook runtime metadata / storage adapters / nacp-session 不 bump` 等**所有**不搬项。
12. **RFC 存在且与实装一致**:`docs/rfc/nacp-core-1-4-consolidation.md`(174 lines)§3 normative scope 列 5 类吸收对象 + 边界说明;§4 compat decision;§5 versioning decision(nacp-core 1.4.0 / nacp-session 1.3.0);§6 Not in scope。
13. **W0 closure memo 存在**:`docs/issue/pre-worker-matrix/W0-closure.md`(113 lines)§2 实际交付 / §3 In/Out-of-Scope verdict / §4 验证结果 / §5 遗留项 / §6 最终 verdict。

### 1.2 已确认的负面事实

1. **设计文档 `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` 状态仍为 `draft (v0.2 post-GPT-review narrowing)`**,未同步更新到"executed / shipped"状态或 v0.3 revision — 尽管 action-plan §7.3 显式把它列为"需要同步更新的设计文档"。
2. **Re-export 文件的 `@deprecated` JSDoc 写得过简**:
   - 例:`packages/storage-topology/src/keys.ts:2` 只写 `@deprecated Import storage-law keys from @nano-agent/nacp-core.`
   - design §5.1 S11 明确要求**含"计划在 worker-matrix phase 后删除"说明**;实际 JSDoc 未包含任何删除时间线或指向的 phase
   - 5 个 re-export 文件(eval-sink / cross-seam / catalog / keys / refs)全部如此
3. **"5 类独立 PR / commit" 纪律未兑现**:design §6.1 取舍 2 + action-plan §1.4 约定**每类吸收独立 PR**。实际 git 历史只有 2 个 feat 提交:
   - `f939365` 一次性落下全部 5 类 nacp-core 新内容
   - `99c0d3e` 一次性落下全部 4 个下游 package adapt
   - 未做成 5 个可独立 revert 的 commit
4. **closure memo §4 验证面缺少可核对证据**:
   - §4.2/§4.3 只列**命令**(e.g. `pnpm --filter ... test` / `node --test test/*.test.mjs` / `npm run test:cross`),没有附任何**输出行数 / 通过数 / 失败数**(e.g. 期望样式 "112/112 passed")
   - **B7 LIVE contract(`test/b7-round2-integrated-contract.test.mjs`)未按名字被单独点名**(design §6.2 明确把 B7 LIVE 列为 risk row)。虽然 `node --test test/*.test.mjs` 的 glob 覆盖它,但"B7 LIVE 5/5 green"作为收口硬纪律应当显式证明。
5. **Action-plan §11 dev log 与 closure memo 之间 validation 列表**不一致:
   - action-plan §11.5 列 8 条(含 `node --test test/*.test.mjs` + `npm run test:cross`)
   - closure §4.2 只列 6 条(缺上述两条);§4.3 才补上它们分拆为"仓级验证"
   - 两份记录对"W0 收口前实际跑过什么"表述不完全一致
6. **action-plan 顶部状态仍为 `draft`**:`docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md:14`"文档状态: `draft`",尽管底部 §11 已经是 post-execution dev log。W0 若要 closed,action-plan 的 `文档状态` 字段应至少同步到 `executed` 或 `closed`。
7. **类型在两处重复定义**(非 error,但违反"单一真理源"动机):
   - `ArtifactLifecycleStage` 同时定义在 `packages/nacp-core/src/evidence/vocabulary.ts:89-96`(从 Zod schema 推)**和** `packages/workspace-context-artifacts/src/evidence-emitters.ts:180-185`(plain TS 定义)
   - `CompactEvidencePhase` 同样重复(`nacp-core/src/evidence/vocabulary.ts:36-42` 与 `workspace-context-artifacts/src/evidence-emitters.ts:89`)
   - `StorageBackend` literal union 也重复(`nacp-core/src/storage-law/builders.ts:3` 与 `storage-topology/src/taxonomy.ts:21`)
   - 值是结构等价(string literal union)所以不触发 type error,但"把协议真理收束到单一源"的动机被部分稀释。
8. **`validateRefKey` 签名静默放宽**:
   - 原 `packages/storage-topology/src/refs.ts` 的 `validateRefKey(ref: StorageRef): boolean`(全字段 `StorageRef`)
   - 新 `packages/nacp-core/src/storage-law/builders.ts:80` 的 `validateRefKey(ref: Pick<StorageRef, "team_uuid" | "key">): boolean`
   - 调用兼容(old caller 照旧传入满字段 `StorageRef`),但 design §0.2 写 "shape byte-identical 只换物理家"—— 此处是**签名放宽**,不是 byte-identical。RFC / CHANGELOG / closure 均未 flag。
9. **`StorageRef` 类型结构由 flat interface 变为 `extends NacpRef`**:
   - 原 `packages/storage-topology/src/refs.ts` 中 `StorageRef` 是 flat interface(9 字段明写)
   - 新 `packages/nacp-core/src/storage-law/builders.ts:4-7` 变成 `interface StorageRef extends NacpRef { readonly kind: StorageBackend }`
   - 运行时行为等价(NacpRef 已有相同字段),但"用 type-level `extends` 关联到 NacpRef"是一个**正向改进**(统一 NACP 真理源),却同时是一个 shape 面的小变动 — design §0.2 byte-identical 纪律的边缘案例,未在 RFC/CHANGELOG 中说明。
10. **design 中 §5.1 S12 "W0 closure memo" 交付了,但 W5 链接尚未兑现**:closure §5.2 说"W5 可以消费 W0 closure",但 W5 action-plan / design 目前没有把 W0 closure 纳入 input pack 的交叉引用(该交叉引用属 W5 责任,不是 W0 本轮 blocker,仅作备注)。

---

## 2. 审查发现

### R1. 设计文档 `W0-nacp-consolidation.md` 未更新到 executed 状态

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md:11` 文档状态仍为 `draft (v0.2 post-GPT-review narrowing)`
  - §修订历史仅含 v0.1 + v0.2,没有 v0.3 "executed" 条目
  - `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md:354-356` §7.3 显式要求同步更新该 design 文档
  - W0-W5 design 其他文档(如 W5-closure-and-handoff.md)在每轮执行 / revise 后都追加 revision 条目;W0 design 落后于其他文档的纪律
- **为什么重要**:
  - design 文档是未来 W1/W2/W3/W4 消费"W0 真理"的原文来源。停留在 `draft (v0.2)` 会让其他 phase 的实装者误以为 W0 未落地 / 还在讨论
  - W5 handoff 要把本阶段产出打包给 worker-matrix,如果 design 文档状态未更新,handoff 盘点会漏项
- **审查判断**:
  - 代码已 ship、CHANGELOG/RFC/closure 都已就位,**只差一个文档 status flip**。这是典型的收口级缺口,不影响代码正确性但阻止"W0 closed"判定
- **建议修法**:
  - 在 design §文档头部追加 v0.3 修订条目,描述 "W0 按 v0.2 narrowed scope 落地,参见 `docs/issue/pre-worker-matrix/W0-closure.md` 与 `docs/rfc/nacp-core-1-4-consolidation.md`"
  - 把 `文档状态` 从 `draft (v0.2 post-GPT-review narrowing)` 改为 `executed (v0.3)` 或 `shipped`

### R2. Re-export 文件的 `@deprecated` JSDoc 未含删除时间线

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - design §5.1 S11:`各 re-export 文件加 @deprecated JSDoc 指向 nacp-core 新位置,含"计划在 worker-matrix phase 后删除"说明`
  - 实际:
    - `packages/storage-topology/src/keys.ts:2`:`@deprecated Import storage-law keys from @nano-agent/nacp-core.`
    - `packages/storage-topology/src/refs.ts:1-11`:同样简短
    - `packages/session-do-runtime/src/eval-sink.ts:8,15`:同样简短
    - `packages/session-do-runtime/src/cross-seam.ts:25,33`:同样简短
    - `packages/hooks/src/catalog.ts:43`:同样简短
  - 全部 5 个 re-export 文件均**没有**包含"计划在 worker-matrix phase 后删除"或"预计 3 个月内移除"或类似指向下游 phase 的引导
- **为什么重要**:
  - design §4.2 Barrel re-export pattern + §6.1 取舍 1 明确:**本阶段 re-export 是临时共存 3 个月,而非长期保留**
  - worker-matrix P0 absorption 执行者(未来读者)只看 JSDoc 时,会误以为这是长期 compat 层,从而延迟真正切 import path
  - 没有删除时间线 = 静默的 tech debt
- **审查判断**:
  - 不是 blocker,但是 design 明确条目未兑现;应作为 **re-review 前必补项**
- **建议修法**:
  - 每个 re-export 文件的 JSDoc 扩展为两行:
    ```ts
    /**
     * @deprecated Import from `@nano-agent/nacp-core`.
     * Planned removal: worker-matrix P0 absorption phase (预计 2026-Q3);
     * worker-matrix 起跑前不会主动删除。
     */
    ```
  - 或在 CHANGELOG "Changed" 块的每条 compat 说明后追加 "(planned for removal in worker-matrix P0)" 注释

### R3. "5 类独立 PR / commit" 纪律未兑现

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - design §6.1 取舍 2 + action-plan §3 工作总表(12 项拆成 4 个 Phase) + action-plan §1.4 "先 shape、再 compat、最后版本与文档收口"
  - 实际 git 历史:
    - `f939365 feat(nacp-core): W0 consolidation — absorb evidence, hooks-catalog, storage-law, cross-seam transport`(一次性 5 类 all-in)
    - `99c0d3e feat: adapt hooks, session-do-runtime, storage-topology, workspace-context-artifacts for nacp-core W0 consolidation`(一次性 4 包 all-in)
    - `f106081 docs(issue): add pre-worker-matrix issue tracking and nacp-core 1.4 consolidation RFC`(docs only)
    - `a52a21c test: update nacp 1.3 matrix contract and lockfile for W0 consolidation`(test only)
- **为什么重要**:
  - design §6.1 取舍 2 的明确承诺:`独立 PR 可 review / revert;某类出问题不阻塞其他类进度`
  - 合并提交一旦出问题 → 要回滚 cross-seam 就得把 evidence / hooks-catalog / storage-law 一起回滚
  - 虽然 closure 通过了 test regression,但"revertibility"这一 design 明写的风险控制手段**事实上不存在**
- **审查判断**:
  - 不建议事后强拆提交(会破坏 git 历史线);但应在 closure memo 中**显式承认**这一偏离并说明 tradeoff
- **建议修法**:
  - 在 W0 closure memo §5 新增子节"未按 design §6.1 取舍 2 拆成 5 独立 commit 的理由",说明实际决策与风险评估(e.g. "regression 面统一跑,拆 5 个 commit 会造成 5 次全仓测试,工时与收益不成比例")
  - 或在 RFC §4 compat decision 结尾追加一行说明
  - 后续 phase(W1 RFC 3 篇 / W3 blueprint 2-3 份)应**严格按每类独立 commit** 推进,避免 W0 的合并导致"每个 phase 纪律逐级放宽"的滑坡

### R4. Closure memo 验证面缺少可核对证据 + B7 LIVE 未显式点名

- **严重级别**:`medium`
- **类型**:`test-gap`(实际是 test-evidence-gap,不是 test-not-run)
- **事实依据**:
  - design §5.1 S10:`全包 regression:pnpm -r run test / node --test test/*.test.mjs / npm run test:cross / B7 LIVE 契约保持 green`
  - design §6.2 风险表第 5 行专门列"B7 LIVE 契约被破坏 → BoundedEvalSink dedup 行为偏移 → B7 test 红"
  - `docs/issue/pre-worker-matrix/W0-closure.md:62-89` §4 验证结果:
    - §4.2 只列 6 条 per-package 命令 + `pnpm install`
    - §4.3 只列 3 条仓级命令(`pnpm -r run test` / `node --test test/*.test.mjs` / `npm run test:cross`)
    - 没有任何命令的**输出样本 / 通过数 / 失败数**(e.g. `112/112 passed`)
    - `b7-round2-integrated-contract.test.mjs` 文件名未被单独提及(只能从 `test/*.test.mjs` glob 推断)
  - action-plan §11.5 与 closure §4.2 命令列表不完全一致(见负面事实 #5)
- **为什么重要**:
  - design 把 B7 LIVE 作为硬纪律专门点名(与 after-foundations B9 口径一致);closure 不点名 = 证据链缺口
  - "命令列得出,结果无输出"意味着读者无法快速验证 W0 收口标准是否真的满足,只能信任 GPT 的自述
  - 未来 worker-matrix P0 若发现 B7 LIVE 红,无法定位是 W0 首引入还是 P0 引入
- **审查判断**:
  - 不是"代码没过测试",而是"证据没入 closure"。补救成本很低,效益很高
- **建议修法**:
  - closure §4.3 每条命令后追加 "→ <pass>/<total> passed" 形式的输出摘要,至少列出 4 条核心 regression 的数字:
    1. `pnpm -r run test` → `packages/* 合计 X 条,全绿`(若不方便逐包列数,列总数)
    2. `node --test test/*.test.mjs` → `X 条,全绿`
    3. `npm run test:cross` → `X 条,全绿`
    4. **专门一条**:`b7-round2-integrated-contract.test.mjs → 5/5 passed`(LIVE 契约)
  - 如果本地执行时有保留 log,可以截取 summary line 入 closure 附录
  - 若无法提供 hard numbers,至少把"B7 LIVE 5/5 green"文字写进 closure §4 结尾作为显式断言

### R5. 类型 / 字面量 union 在 nacp-core 与原 package 重复定义

- **严重级别**:`low`
- **类型**:`scope-drift`(微弱)
- **事实依据**:
  - `ArtifactLifecycleStage` 重复:
    - `packages/nacp-core/src/evidence/vocabulary.ts:89-96`(Zod schema + 推 type)
    - `packages/workspace-context-artifacts/src/evidence-emitters.ts:180-185`(plain TS union)
  - `CompactEvidencePhase` 重复:
    - `packages/nacp-core/src/evidence/vocabulary.ts:36-42`
    - `packages/workspace-context-artifacts/src/evidence-emitters.ts:89`
  - `StorageBackend` 重复:
    - `packages/nacp-core/src/storage-law/builders.ts:3`
    - `packages/storage-topology/src/taxonomy.ts:21`
  - RFC §3.3 声明"evidence 的 field 名 / phase 划分 / optional 字段都按当前 workspace-context-artifacts helper 输出 reality 反推"—— 但 helper 文件内未改为 `import type { ArtifactLifecycleStage, CompactEvidencePhase } from "@nano-agent/nacp-core"`
- **为什么重要**:
  - 重复定义不触发 type error(string literal union 结构等价),但违背"NACP 为单一真理源"的 W0 驱动动机
  - 未来任何一方加 stage(e.g. 新增 `"quarantined"` state)会静默 diverge,evidence record schema 与 helper 返回类型可能不再对齐
- **审查判断**:
  - 不是 blocker(现阶段结构等价,test 绿),但是**轻微的真理源 split**
  - worker-matrix P0 absorbing workspace-context-artifacts 时会自然收口,但 pre-phase 的"单一真理源"承诺现在是 3 条 literal 各自保有
- **建议修法**:
  - `workspace-context-artifacts/src/evidence-emitters.ts` 把 `CompactEvidencePhase` / `ArtifactLifecycleStage` 改为 `import type ... from "@nano-agent/nacp-core"`(成本极低)
  - `storage-topology/src/taxonomy.ts` 的 `StorageBackend` 改为 `export type { StorageBackend } from "@nano-agent/nacp-core"`(或保留但加 `@deprecated` 注释指向 nacp-core)
  - 或接受现状,但在 W0 closure §5.1 把这 3 处重复**显式记录为"随 worker-matrix P0 absorption 收口"**,避免默许的 silent drift

### R6. `validateRefKey` 签名放宽 + `StorageRef` 结构由 flat → `extends NacpRef`,未在 RFC/CHANGELOG 标注

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - design §0.2:`Shape 不改 — 吸收过程中,每个原类/函数/schema 的 TS shape 保持 byte-identical;只换物理家`
  - `validateRefKey` 签名:
    - 原:`validateRefKey(ref: StorageRef): boolean`
    - 新:`validateRefKey(ref: Pick<StorageRef, "team_uuid" | "key">): boolean`(`packages/nacp-core/src/storage-law/builders.ts:80`)
  - `StorageRef` 结构:
    - 原:`interface StorageRef { readonly kind: StorageBackend; readonly binding: string; readonly team_uuid: string; readonly key: string; readonly role: "input" | "output" | "attachment"; ... }`(9 字段 flat)
    - 新:`interface StorageRef extends NacpRef { readonly kind: StorageBackend }`(用 extends NacpRef 表达 + kind 收窄)
  - 结构等价(NacpRef 已含所有原字段),但**关系表达法发生变化**,且在 CHANGELOG / RFC / closure 中**都未显式说明这两个"改进性偏移"**
- **为什么重要**:
  - 对现有调用者 100% 兼容(widened signature + structural equivalent),所以不会造成 build 红
  - 但违背 design §0.2"byte-identical"文字承诺;未来读 CHANGELOG 的下游实装者会把"Added: StorageRef / BuildRefOptions"理解成"原 shape 原样搬入",不会注意到这俩细节
- **审查判断**:
  - 这两个改动本身是 **net positive**(放宽签名 + 绑到 NACP 真理源是合理的),但应当在 CHANGELOG 的 "Changed" block 明确出现
- **建议修法**:
  - CHANGELOG 1.4.0 "Changed" block 追加:
    - `validateRefKey` 签名放宽为 `Pick<StorageRef, "team_uuid" | "key">`,放宽不会破坏现有调用
    - `StorageRef` 现通过 `extends NacpRef` 表达,原 flat interface 结构等价保留

### R7. Action-plan / design 文档未随执行更新状态

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md:14`:`文档状态: draft`
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md:11`:`文档状态:draft (v0.2 post-GPT-review narrowing)`
  - 但二者底部都已有 post-execution 痕迹(action-plan §11 GPT 工作日志 / design 结构已被执行)
- **为什么重要**:
  - W5 handoff 盘点会依据每份 action-plan / design 的"status"字段识别完成度
  - 保持 `draft` 会导致 W5 自动化盘点漏报 W0 已 closed
- **审查判断**:
  - 和 R1 属同一主题,但 R7 指向 action-plan 顶部 status 字段(R1 是 design)
- **建议修法**:
  - action-plan 顶部 `文档状态` 改为 `executed` 或 `closed`
  - 若希望保留 draft,则至少在 §11 之前追加一行"§Status: Phase executed on 2026-04-22; see §11 dev log + docs/issue/pre-worker-matrix/W0-closure.md"

### R8. CHANGELOG `@nano-agent/hooks` 未同步描述 catalog.ts 变化

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - `packages/hooks/package.json`:version 仍 `0.2.0`
  - `packages/hooks/CHANGELOG.md:64` 最末条目描述的还是"8-event catalog"时代
  - `packages/hooks/src/catalog.ts` 经 W0 改为 `import { HOOK_EVENT_PAYLOAD_SCHEMA_NAMES, type HookEventName } from "@nano-agent/nacp-core"`;payload-schema-name 由硬编码字面量改为 `HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.XXX` 引用 — 虽然值等价,但 import 拓扑变化值得入 CHANGELOG
  - 同样问题存在于:
    - `packages/session-do-runtime/CHANGELOG.md`(若有)—未见 compat change 记录
    - `packages/storage-topology/CHANGELOG.md`
    - `packages/workspace-context-artifacts/CHANGELOG.md`
- **为什么重要**:
  - W0 的"additive-only,下游无感"只在 consumer 层成立;但下游 package 本身的 **import graph** 与 **内部 source** 实实在在变了
  - 下游包的 CHANGELOG 不记这笔,未来读者会误以为 W0 只改 nacp-core
- **审查判断**:
  - 不是 blocker;属于 "downstream package 维护纪律"
  - design 没有明文要求每个下游包 bump patch,但至少应有 CHANGELOG 记录
- **建议修法**:
  - 4 个下游包各追加一条 CHANGELOG,格式统一,例:
    ```
    ## <current-version> — 2026-04-22 (W0 pre-worker-matrix consolidation adapt)
    ### Changed
    - Re-import vocabulary truth from `@nano-agent/nacp-core@1.4.0` (W0 consolidation).
    - Local file becomes compat re-export; runtime logic unchanged.
    ```
  - 不做 version bump 即可(保持 additive),只补 CHANGELOG 行

---

## 3. In-Scope 逐项对齐审核

对照 `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md` §3 12-项工作总表:

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | cross-seam 落位(propagation) | `done` | `nacp-core/src/transport/cross-seam.ts` 93 行,含 anchor + 7 headers + 3 helpers;failure taxonomy + startup queue 按 design §0.4 第 2 行留原位 |
| P1-02 | sink-contract + barrel 骨架(class 不搬) | `done` | `nacp-core/src/evidence/sink-contract.ts` 81 行仅含 3 types + helper + dedup contract doc;`BoundedEvalSink` class 留在 session-do-runtime |
| P1-03 | storage-law 落位 | `done` | `nacp-core/src/storage-law/{constants,builders}.ts` 完整落地 `DO_KEYS/KV_KEYS/R2_KEYS` + 3 builders + `validateRefKey`;`NacpRefSchema` 未重复定义(沿用 envelope.ts) |
| P2-01 | evidence vocabulary 落位 | `done` | `nacp-core/src/evidence/vocabulary.ts` 含 4-stream Zod schema + `EvidenceAnchorSchema` + `EvidenceRecordSchema` discriminated union;字段覆盖 pre-W0 helper 输出 reality |
| P2-02 | hooks-catalog 落位(wire only) | `done` | `nacp-core/src/hooks-catalog/index.ts` 含 `HOOK_EVENT_NAMES`(18) + `HookEventNameSchema` + 18 payload schemas + 2 registry map;`HookEventMeta` runtime metadata 留 hooks 包 |
| P2-03 | top-level exports | `done` | `nacp-core/src/index.ts` 新增 `// ── Evidence / Hook vocabulary / Storage law ──` 三大 block,W0 所有 public symbol 均可从包顶层 import |
| P3-01 | 原位置 re-export + `@deprecated` JSDoc(含文件清单) | `partial` | 5 个 re-export 文件**都加了** `@deprecated`,但 JSDoc 未含"worker-matrix phase 后删除"说明(design §5.1 S11);参见 R2 |
| P3-02 | regression 回归 | `partial` | closure §4 列出了命令,但未给出数字 / B7 LIVE 未显式点名;代码层回归本身应当通过(build+lint+tests 已在每包 per-filter),但证据入档不完整;参见 R4 |
| P4-01 | `nacp-core` 版本 bump | `done` | `package.json` + `src/version.ts` 都已 `1.3.0 → 1.4.0`;test/nacp-1-3-matrix-contract.test.mjs 同步断言 |
| P4-02 | `nacp-session` 条件分支决策 | `done` | 保持 `1.3.0` 的 evidence 链明确:nacp-session 6 个源文件 grep 过,未 import 任何 W0 新 symbol;RFC §5.2 / closure §2.3 均明确 |
| P4-03 | CHANGELOG + consolidation RFC | `done` | CHANGELOG 1.4.0 entry(Added/Changed/Not shipped 三 block);RFC `docs/rfc/nacp-core-1-4-consolidation.md` 174 行,结构完整 |
| P4-04 | W0 closure memo | `partial` | memo 存在且结构符合模板,但 §4 验证面缺 hard numbers + B7 LIVE 未点名;参见 R4 |

### 3.1 对齐结论

- **done**:9 项(P1-01, P1-02, P1-03, P2-01, P2-02, P2-03, P4-01, P4-02, P4-03)
- **partial**:3 项(P3-01 @deprecated 文案 / P3-02 validation 证据 / P4-04 closure §4 证据)
- **missing**:0 项

> 这更像"W0 **代码面 fully done**,文档面 partial — 缺的都是收口级证据 / 状态 flip / JSDoc 文案",而不是"代码没交付"。整体可以用**一轮小幅度 docs revise** 收口,不需要重开 phase。

---

## 4. Out-of-Scope 核查

对照 action-plan §2.2 + design §5.2:

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 搬 `BoundedEvalSink` class / startup queue / failure taxonomy 等 runtime 实现 | `遵守` | `BoundedEvalSink` 仍在 `session-do-runtime/src/eval-sink.ts:92-207`;`StartupQueue` / `CrossSeamError` / `CROSS_SEAM_FAILURE_REASONS` 仍在 `session-do-runtime/src/cross-seam.ts:42-201` |
| O2 | 搬 `emit*Evidence()` / hook dispatch / storage adapters 等逻辑层代码 | `遵守` | `buildAssemblyEvidence / emitAssemblyEvidence` 等 10 个 helper 仍在 `workspace-context-artifacts/src/evidence-emitters.ts`;hooks dispatcher / outcome reducer / permission 未动;storage adapters/placement/calibration 未动 |
| O3 | 设计任何新跨 worker 协议或 matrix entry(属 W1) | `遵守` | `nacp-core/src/type-direction-matrix.ts` 未新增 entry;`nacp-core/src/messages/` 未新增 message family |
| O4 | 做 worker 级 absorption / 发布流水线 / deploy 脚手架(W2-W4) | `遵守` | 无 `.github/workflows/` 改动,无 `workers/` 目录出现,无 `publishConfig` 新增 |
| O5 | 语义变动(任何吸收对象的行为 / shape / 错误码变化) | `基本遵守(两个微边缘案例)` | shape 全部 byte-identical;**但** `validateRefKey` 签名放宽 + `StorageRef` 改 `extends NacpRef`(参见 R6,非语义变动但非 byte-identical 文字写法) |
| O6 | `evidence-emitters.ts` 的 emit 函数迁移 | `遵守` | emit 函数留原位,只 import record types from nacp-core |
| O7 | `nacp-session` 除非被消费否则不变 | `遵守` | nacp-session 6 个源文件未新增 import,package.json 版本仍 1.3.0 |
| O8 | 原位置文件物理删除 | `遵守` | 5 个 re-export 文件都保留,仅改为 compat 层 |
| O9 | 吸收对象的性能优化或重构 | `遵守` | 所有吸收对象 shape 保真,无性能优化 / 重构(validateRefKey 是签名放宽不算重构) |
| O10 | 新增 NACP 1.4.0 的 message types | `遵守` | messages/*.ts 未新增 |
| O11 | 发布 1.4.0 到 GitHub Packages(属 W2) | `遵守` | package.json 的 publishConfig 字段仍缺失(为 W2 留窗口) |
| O12 | hooks runtime metadata hoist(HookEventMeta) | `遵守` | HookEventMeta / HOOK_EVENT_CATALOG 完整留在 hooks 包 |
| O13 | storage adapter / placement / calibration hoist | `遵守` | 未动 |
| O14 | NACP 1.3.0 → 1.4.0 breaking change | `遵守` | additive-only;下游 test 无需修改 import 即可继续 pass |

> Out-of-Scope 纪律整体优秀。唯一值得记录的微边缘案例是 O5 下的 `validateRefKey` 签名放宽与 `StorageRef` 结构关系变更 — 结构等价且对调用者无感,但 design §0.2 的"byte-identical"文字承诺被微弱触动。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`approve-with-followups` — W0 代码层已完成并达到 narrowed v0.2 scope,但**文档/证据层 5 处 gap 需要补完**方可标记 `closed`
- **是否允许关闭本轮 review**:`no`(需要实现者按 §6 回应并补完 blocker 后再次复核)
- **关闭前必须完成的 blocker**(blockers,按严重度降序):
  1. **R1**:更新 `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` 到 `executed (v0.3)` 状态,并在修订历史追加 v0.3 条目指向 closure / RFC
  2. **R2**:5 个 re-export 文件(eval-sink / cross-seam / catalog / keys / refs)的 `@deprecated` JSDoc 扩展为含"worker-matrix P0 后删除"说明
  3. **R4**:closure `docs/issue/pre-worker-matrix/W0-closure.md` §4 补完命令输出数字 + **显式点名 B7 LIVE(`test/b7-round2-integrated-contract.test.mjs`)5/5 green**
  4. **R7**:`docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md` 顶部 `文档状态` 从 `draft` 改为 `executed`(或 closed)
- **可以后续跟进的 non-blocking follow-up**:
  1. **R3**:在 closure §5 追加一节"未拆 5 独立 commit 的 tradeoff 说明",并在 W1/W3 后续 phase 重申 per-class 独立 commit 纪律
  2. **R5**:`ArtifactLifecycleStage / CompactEvidencePhase / StorageBackend` 三处类型重复,要么改 import 自 nacp-core,要么在 closure §5.1 标记为"随 worker-matrix P0 absorption 收口"
  3. **R6**:CHANGELOG `Changed` block 追加 `validateRefKey` 签名放宽 + `StorageRef extends NacpRef` 两条说明
  4. **R8**:4 个下游包(hooks / session-do-runtime / storage-topology / workspace-context-artifacts)各补一条 CHANGELOG 行,描述 W0 compat adapt
  5. **(非 R 号)**:后续 W5 handoff 时把 W0 closure + RFC + 本 review 一同打包,作为 worker-matrix P0 input pack

> 本轮 review 不收口。请实现者按 §6 回应并再次更新代码/文档后,在本文档底部追加 §7 二次审查结果前,由实现者先按 §6 模板 append 回应。



### 6.1 对本轮审查的回应（GPT-5.4 实填）

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-22`
> 回应范围: `R1–R8`

- **总体回应**:`R1/R2/R4/R5/R6/R7/R8 已完成修补；R3 无法事后重写 git 历史，但已在 closure 中显式记录偏离与后续纪律。`
- **本轮修改策略**:`优先补齐会影响“W0 closed”判定的状态、JSDoc 与验证证据；同时把低成本的 truth 去重一起收口，并把所有下游 compat 变化补入 changelog。对于无法逆转的 commit 颗粒度偏离，只做显式 tradeoff 记录，不改历史。`

### 6.2 逐项回应表（GPT-5.4 实填）

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | design 文档未更新到 executed | `fixed` | 将 W0 design 顶部状态改为 `executed (v0.3 shipped)`，并在修订历史追加 v0.3 executed/shipped 条目，指向 RFC 与 closure。 | `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` |
| R2 | re-export JSDoc 漏写删除窗口 | `fixed` | 为 5 个 compat/re-export 文件的 `@deprecated` JSDoc 全部补入 `worker-matrix P0 absorption phase (target 2026-Q3)` 删除窗口说明。 | `packages/session-do-runtime/src/eval-sink.ts`, `packages/session-do-runtime/src/cross-seam.ts`, `packages/hooks/src/catalog.ts`, `packages/storage-topology/src/keys.ts`, `packages/storage-topology/src/refs.ts` |
| R3 | 5 独立 PR 纪律未兑现 | `partially-fixed` | 未重写 git 历史；在 W0 closure §5.3 明确记录“为何本轮没有拆成 5 个独立 commit”的 tradeoff，并把“后续 W1/W3 恢复细粒度 commit 纪律”写成显式要求。 | `docs/issue/pre-worker-matrix/W0-closure.md` |
| R4 | closure 验证面缺 hard numbers + B7 LIVE 未点名 | `fixed` | 重写 closure §4.2/§4.3，补入 6 个 W0 相关 package 的 test-file/test counts、repo regression 数字、以及 `test/b7-round2-integrated-contract.test.mjs` 的 `5/5` 专门结果；RFC §7 也同步补入数字快照。 | `docs/issue/pre-worker-matrix/W0-closure.md`, `docs/rfc/nacp-core-1-4-consolidation.md` |
| R5 | 类型重复定义(ArtifactLifecycleStage / CompactEvidencePhase / StorageBackend) | `fixed` | `workspace-context-artifacts` 改为直接复用并转发 `@nano-agent/nacp-core` 的 `CompactEvidencePhase` / `ArtifactLifecycleStage`；`storage-topology/src/taxonomy.ts` 改为 re-export `StorageBackend` 自 `@nano-agent/nacp-core`，消除 3 处 truth split。 | `packages/workspace-context-artifacts/src/evidence-emitters.ts`, `packages/storage-topology/src/taxonomy.ts` |
| R6 | validateRefKey 签名放宽 + StorageRef extends NacpRef 未入 CHANGELOG | `fixed` | 将 `validateRefKey()` 收回到 pre-W0 的 `StorageRef` 调用签名；同时在 `nacp-core` CHANGELOG 与 W0 RFC 中补写 `StorageRef extends NacpRef` 与签名决策说明。 | `packages/nacp-core/src/storage-law/builders.ts`, `packages/nacp-core/CHANGELOG.md`, `docs/rfc/nacp-core-1-4-consolidation.md` |
| R7 | action-plan 顶部 status 仍 draft | `fixed` | 将 W0 action-plan 顶部 `文档状态` 从 `draft` 改为 `executed`。 | `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md` |
| R8 | 4 个下游包 CHANGELOG 未同步 | `fixed` | 为 `hooks / session-do-runtime / storage-topology / workspace-context-artifacts` 追加 `Unreleased — 2026-04-22 (W0 pre-worker-matrix compat adapt)` 记录，说明 compat import-topology 变化与“无版本 bump”结论。 | `packages/hooks/CHANGELOG.md`, `packages/session-do-runtime/CHANGELOG.md`, `packages/storage-topology/CHANGELOG.md`, `packages/workspace-context-artifacts/CHANGELOG.md` |

### 6.3 变更文件清单（GPT-5.4 实填）

- `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
- `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`
- `docs/issue/pre-worker-matrix/W0-closure.md`
- `docs/rfc/nacp-core-1-4-consolidation.md`
- `packages/hooks/CHANGELOG.md`
- `packages/hooks/src/catalog.ts`
- `packages/nacp-core/CHANGELOG.md`
- `packages/nacp-core/src/storage-law/builders.ts`
- `packages/session-do-runtime/CHANGELOG.md`
- `packages/session-do-runtime/src/cross-seam.ts`
- `packages/session-do-runtime/src/eval-sink.ts`
- `packages/storage-topology/CHANGELOG.md`
- `packages/storage-topology/src/keys.ts`
- `packages/storage-topology/src/refs.ts`
- `packages/storage-topology/src/taxonomy.ts`
- `packages/workspace-context-artifacts/CHANGELOG.md`
- `packages/workspace-context-artifacts/src/evidence-emitters.ts`

### 6.4 验证结果（GPT-5.4 实填）

```text
W0 package validation
- @nano-agent/nacp-core: 18/18 test files, 259/259 tests passed
- @nano-agent/nacp-session: 14/14 test files, 119/119 tests passed
- @nano-agent/session-do-runtime: 29/29 test files, 357/357 tests passed
- @nano-agent/hooks: 16/16 test files, 198/198 tests passed
- @nano-agent/storage-topology: 15/15 test files, 169/169 tests passed
- @nano-agent/workspace-context-artifacts: 17/17 test files, 192/192 tests passed

Repo validation
- pnpm -r run test: 11 workspace test targets green; aggregated summary lines = 2177/2177 tests passed
- node --test test/*.test.mjs: 98/98 passed
- npm run test:cross: 112/112 passed
- node --test test/b7-round2-integrated-contract.test.mjs: 5/5 passed
```

### 6.5 实现者收口判断（GPT-5.4 实填）

- **实现者自评状态**:`ready-for-rereview`
- **仍然保留的已知限制**:
  1. `R3` 的底层事实仍然存在：W0 git 历史没有被事后拆成 5 个独立可回滚 commit；本轮只做了显式 tradeoff 记录，未改写历史。
  2. 4 个下游 package 的 changelog 新增项属于 source-only / unreleased 维护记录；W0 仍然没有对这些 package 做额外版本 bump。

---

## 7. 二次审查（Claude Opus 4.7 — 2026-04-22）

### 7.1 二次审查结论

> 复核者: `Claude Opus 4.7 (1M context)`
> 复核时间: `2026-04-22`
> 复核依据: `实现者 §6 的回应 + 当前代码事实 + 仓级 build / typecheck / test 再执行 + 跨包 import 链路核查`

- **二次结论**:`W0 可以关闭;W1 可以直接启动。8 条 finding 全部已被实质性修复或以显式 tradeoff 收口;一轮重跑 pnpm/root/cross/B7 证明 GPT §6.4 的数字精确,跨 11 package typecheck+build+test 全绿,无 regression 引入。`
- **是否收口**:`yes`

### 7.2 复核扩大后的验证方法与结果

**本轮二次审查扩大了验证范围**,不止对 §6.4 自述做文字核对,而是独立再执行一轮全仓 build / typecheck / test,覆盖 **W0 未直接触及的 5 个包**(`agent-runtime-kernel / llm-wrapper / eval-observability / capability-runtime / context-management`),以检测 W0 的 re-export 变更是否对间接消费者产生 silent 回归。

**独立重跑的完整结果**(均为本轮复核现场重跑,非引用 §6.4):

| 验证面 | 命令 | 本轮复核实测结果 | §6.4 自述结果 | 是否一致 |
|---|---|---|---|---|
| nacp-core(W0 主产出) | `pnpm --filter @nano-agent/nacp-core test` | `18/18 files, 259/259 tests` | `18/18, 259/259` | ✅ 完全一致 |
| nacp-session(W0 决策保持 1.3.0 的 package) | `pnpm --filter @nano-agent/nacp-session test` | `14/14 files, 119/119 tests` | `14/14, 119/119` | ✅ 完全一致 |
| session-do-runtime(W0 re-export consumer) | `pnpm --filter @nano-agent/session-do-runtime test` | `29/29 files, 357/357 tests` | `29/29, 357/357` | ✅ 完全一致 |
| hooks(W0 consumer) | `pnpm --filter @nano-agent/hooks test` | `16/16 files, 198/198 tests` | `16/16, 198/198` | ✅ 完全一致 |
| storage-topology(W0 consumer + R5 taxonomy fix) | `pnpm --filter @nano-agent/storage-topology test` | `15/15 files, 169/169 tests` | `15/15, 169/169` | ✅ 完全一致 |
| workspace-context-artifacts(W0 consumer + R5 import fix) | `pnpm --filter @nano-agent/workspace-context-artifacts test` | `17/17 files, 192/192 tests` | `17/17, 192/192` | ✅ 完全一致 |
| agent-runtime-kernel(W0 未触及,但间接依赖改了 import 面的 4 个下游包) | 并入 `pnpm -r run test` 输出 | `12/12 files, 123/123 tests` | —(未单独列) | ✅ 无 regression |
| llm-wrapper(同上) | 并入 `pnpm -r run test` 输出 | `11/11 files, 103/103 tests` | —(未单独列) | ✅ 无 regression |
| eval-observability(同上,与 BoundedEvalSink/ evidence vocab 的 shape 直接相关) | 并入 `pnpm -r run test` 输出 | `23/23 files, 208/208 tests` | —(未单独列) | ✅ 无 regression |
| capability-runtime(同上) | 并入 `pnpm -r run test` 输出 | `28/28 files, 352/352 tests` | —(未单独列) | ✅ 无 regression |
| context-management(同上) | 并入 `pnpm -r run test` 输出 | `9/9 files, 97/97 tests` | —(未单独列) | ✅ 无 regression |
| 全仓 `pnpm -r run test` | 累积 11 个 workspace test targets | `2177/2177 passed`(手工累加 11 行 = 259+119+357+198+169+192+123+103+208+352+97 = **2177**) | `2177/2177` | ✅ 完全一致 |
| 根 contract suite | `node --test test/*.test.mjs` | `98/98 passed` | `98/98` | ✅ 完全一致 |
| cross suite | `npm run test:cross` | `112/112 passed` | `112/112` | ✅ 完全一致 |
| B7 LIVE(design §6.2 硬纪律) | `node --test test/b7-round2-integrated-contract.test.mjs` | `5/5 passed` | `5/5` | ✅ 完全一致 |
| 全仓 typecheck | `pnpm -r run typecheck` | 11/11 packages 全绿,无 TS2/TS7/TS9 错误 | —(§6.4 未单列) | ✅ 无 regression |
| 全仓 build | `pnpm -r run build` | 11/11 packages 全绿,`dist/` 产物完整 | —(§6.4 未单列) | ✅ 无 regression |

**独立验证结论**:GPT 在 §6.4 自述的 14 条数字(含 `2177/2177` 累加结论)**与本轮复核实测数字逐行一致**;此外扩大到 W0 未直接触及的 5 个下游包,也确认**零 regression**。这意味着 W0 的 re-export + narrowed scope 变更,对非 W0 包的 import 图没有产生任何 silent break。

### 7.3 已验证有效的修复

对 §5 列出的 4 条 blocker 与 4 条 follow-up 逐条复核:

| 审查编号 | 复核结论 | 依据(文件:行 / 命令 / test) |
|----------|----------|------|
| **R1** design 文档未更新到 executed | `closed` | `docs/design/pre-worker-matrix/W0-nacp-consolidation.md:11` 现为 `文档状态:executed (v0.3 shipped)`;§修订历史新增 `v0.3 (2026-04-22):executed / shipped — W0 已按 narrowed scope 落地;收口见 RFC 与 closure` |
| **R2** re-export JSDoc 漏写删除窗口 | `closed` | 5 个 re-export 文件均已加入 `Planned removal: worker-matrix P0 absorption phase (target 2026-Q3).` 一行,行号:`packages/session-do-runtime/src/eval-sink.ts:9,18` / `cross-seam.ts:26,36` / `packages/hooks/src/catalog.ts:45` / `packages/storage-topology/src/keys.ts:3` / `refs.ts:3,13` |
| **R3** 5 独立 PR 纪律未兑现 | `closed-with-tradeoff`(可接受) | closure §5.3 新增 "本轮未按 design 拆成 5 个独立 commit 的 tradeoff 说明",显式记录偏离与"W1/W3 恢复细粒度 commit 纪律"的后续要求。符合 §5 non-blocking follow-up 预期处理方式 |
| **R4** closure 验证面缺 hard numbers + B7 LIVE 未点名 | `closed` | `docs/issue/pre-worker-matrix/W0-closure.md:77-91`(§4.2/§4.3)现含 6 包 per-filter test counts、3 条仓级命令数字、**B7 LIVE 单独点名** `node --test test/b7-round2-integrated-contract.test.mjs → 5/5 passed`;RFC §7 同步列 9 条数字快照 |
| **R5** 类型重复(ArtifactLifecycleStage / CompactEvidencePhase / StorageBackend) | `closed` | `packages/workspace-context-artifacts/src/evidence-emitters.ts:16-28` 改为 `import type { ArtifactLifecycleStage, CompactEvidencePhase } from "@nano-agent/nacp-core"` + `export type ...` 转发;`packages/storage-topology/src/taxonomy.ts:1,21` 同样把 `StorageBackend` import+re-export 自 nacp-core;实际 storage-topology 的 `promotion-plan.ts / archive-plan.ts / placement.ts / evidence.ts / demotion-plan.ts` 等**下游引用继续从 `./taxonomy.js` import**,通过 taxonomy → nacp-core 链路传递,**间接保证单一真理源** |
| **R6** validateRefKey 签名放宽 + StorageRef extends NacpRef 未入 CHANGELOG | `closed` | `packages/nacp-core/src/storage-law/builders.ts:80` 签名回退为 `validateRefKey(ref: StorageRef): boolean`;CHANGELOG `1.4.0 > Changed` 增加 2 行显式说明(`StorageRef extends NacpRef` + `validateRefKey 保持 pre-W0 签名`);RFC `§4 Compatibility decision` 追加"补充说明"两行 |
| **R7** action-plan 顶部 status 仍 draft | `closed` | `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md:14` 现为 `文档状态: executed` |
| **R8** 4 个下游包 CHANGELOG 未同步 | `closed` | 4 包 `CHANGELOG.md` 顶部均新增 `## Unreleased — 2026-04-22 (W0 pre-worker-matrix compat adapt)` 条目,描述 compat import-topology 变化 + "no version bump" 结论 |

### 7.4 扩大审查后的新发现(3 条 minor,均不阻塞 closure)

在扩大代码审查范围时发现以下 3 条此前未列出的**细粒度微观观察**,严重度均为 `low`,**不作为 blocker**,仅建议作为 non-blocking follow-up:

#### N1(low / docs-gap). `EvidenceAnchorLike` alias 的 @deprecated JSDoc 漏写删除窗口

- **事实**:`packages/workspace-context-artifacts/src/evidence-emitters.ts:37`:`/** @deprecated Import EvidenceAnchor from @nano-agent/nacp-core. */` 是**单行**,未按 R2 的扩展格式加 "Planned removal: worker-matrix P0 absorption phase (target 2026-Q3)"
- **判断**:R2 覆盖 5 个**纯 re-export 文件**;该 alias 所在文件(`evidence-emitters.ts`)是**带 emitter helper 的混合文件**,不属于纯 re-export 清单,所以 R2 fix 未扫到它,这个遗漏是 scope 边界而非失误
- **处理建议**:可选补一行,与 R2 风格保持一致;不补不影响 W0 closure(因为该 alias 的删除窗口最终仍以 workspace-context-artifacts 整包 absorb 时点为准)

#### N2(low / style). taxonomy.ts 与 evidence-emitters.ts 使用 `import type + export type { X } from "..."` 双语句模式

- **事实**:
  - `packages/storage-topology/src/taxonomy.ts:1,21`:`import type { StorageBackend } from "@nano-agent/nacp-core"` + 另一行 `export type { StorageBackend } from "@nano-agent/nacp-core"`
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts:16-28`:同样模式
- **判断**:两语句是正交的(`import type` 把 symbol 引入本地供内部代码引用,`export type from "..."` 做 named re-export)。二者**指向同一模块**但**不是冗余**;TypeScript 编译通过(typecheck 已绿)
- **处理建议**:如果想极致简洁,可改为 `import type { X } from "..."; export type { X };`(本地 re-export,少 1 次 module import resolve)。但当前写法完全合法且更显式;不建议强改

#### N3(observation / git). 本轮 §6 修复对应的 17 个文件变更尚未 commit

- **事实**:`git status` 显示 17 modified + 1 untracked(本审查文件)。§6.3 "变更文件清单" 列出的 17 个文件,目前**都在 working tree 未提交状态**
- **判断**:这**不是**一个代码 / 文档问题,而是 git workflow 观察。代码 / 测试结果均以 working tree 为准,已全绿;提交动作留给 owner / 下游 workflow。但在"W0 closed"正式宣告时,应当把这 17 个 §6 修复文件(加上本 review 自身)一起 commit,才算**git-level closed**
- **处理建议**:建议在进入 W1 之前,由 owner 按下列粒度 commit:
  1. 一条 `docs(review): add W0 code review + second-round re-review`(含本审查文件)
  2. 一条或多条 `fix(W0): apply Opus code review R1–R8 follow-ups`(含 17 个源文件 / 文档变更)
  - 两步分开使本 review 文档与 fix 记录清晰分离,便于审计

### 7.5 二次收口意见

- **必须继续修改的 blocker**:
  - **无** — R1–R8 全部 `closed` 或 `closed-with-tradeoff`
- **可后续跟进的 non-blocking follow-up**:
  1. **N1**:`EvidenceAnchorLike` alias 的 @deprecated 补一行删除窗口,统一 R2 风格
  2. **N3**:把 17 个 §6 修复文件 + 本 review 文档按 2-step commit 入 git 历史
  3. (承接 §5 non-blocking R5 后半句):worker-matrix P0 absorption 实际启动时,把 `storage-topology/src/taxonomy.ts` / `workspace-context-artifacts/src/evidence-emitters.ts` 等文件的"向 nacp-core import / re-export"路径直接展开到吸收目的地,避免保留二跳 compat
  4. (非 R 号)W5 handoff 时把 W0 closure + RFC + 本 review(含 §6/§7)三者一同纳入 worker-matrix P0 input pack

### 7.6 W0 收口 verdict + W1 启动可行性判断

#### W0 收口 verdict

- **W0 代码面**:`closed` — Tier A vocabulary 已按 v0.2 narrowed scope 物理归位到 `@nano-agent/nacp-core@1.4.0`;runtime class / dispatcher / adapter / metadata 全部按纪律留在原位;所有吸收对象 shape byte-identical(包含本轮复核发现的 `validateRefKey` 签名回退到 pre-W0 `StorageRef` 后)。
- **W0 文档面**:`closed` — design / action-plan 的 status 已 flip 到 `executed`;RFC + CHANGELOG + closure memo 三位一体;4 个下游包 CHANGELOG 已补 compat 行;re-export `@deprecated` JSDoc 含明确删除窗口。
- **W0 验证面**:`closed` — 本轮**独立重跑**全仓 `build / typecheck / test` 三类 × 11 包全绿,数字与 §6.4 自述逐行一致;B7 LIVE 5/5 已单独点名;扩大到 W0 未直接触及的 5 个包也 **零 regression**。
- **W0 git 面**:`pending commit`(N3)— working tree 中的 17 个 §6 修复尚未提交,不影响 code / docs 事实,但属于 closure 的最后一步 workflow 动作。

**一句话 W0 收口结论**:**代码 / 文档 / 验证 / narrowed scope 纪律四条线全绿,单一剩余项是 commit 入 git,这是 owner 的 workflow 动作而非 review 问题。** W0 可以标记 `closed`。

#### W1 启动可行性判断

W1(`Cross-Worker Protocol Design`,per charter §7.2 / design)的产出是 **3 份 RFC-only**:

1. **γ workspace service-binding RFC** — 依赖:`storage-law`(W0 已 shipped)+ `cross-seam` 头部契约(W0 已 shipped)+ 既有 tenant law(B9)
2. **β remote compact delegate RFC** — 依赖:既有 `context.compact.request/response` message family(1.3.0)+ W0 的 `evidence` vocabulary
3. **Cross-worker evidence envelope forwarding RFC** — 依赖:W0 的 `evidence/{sink-contract,vocabulary}.ts` + 既有 `audit.record` 契约

**所有 W0 → W1 硬依赖均已在 nacp-core 1.4.0 中就位**,且:
- 跨 11 包 typecheck/build/test 绿 → W1 开始时不需要在 W0 产物上做额外 patch
- 3 份 W1 RFC 本轮复核已经确认 **RFC 草稿已在 `docs/rfc/{nacp-workspace-rpc,remote-compact-delegate,evidence-envelope-forwarding}.md` 就位**(由 `39d619d` commit shipped,先于 W0 收口);形式上 W1 代码产出**就是这 3 份 RFC**,语义上已经由 review-only 进入 ready-for-refinement 状态
- charter §8.3 DAG:W1 是 RFC-only,不 ship code,不会对 W0 产出产生 retroactive 修改 — 不存在"W0 刚 close 就被 W1 反向拖回"风险

**W1 可以直接启动**;建议的下一步动作:
1. owner 批准 W0 收口 + commit 17 files(含本 review)
2. 启动 W1 的 3 份 RFC refinement:对照 W0 shipped vocabulary 做一次 "RFC 引用 ↔ 代码事实" 对齐 pass;不新增 message family,不 ship 代码
3. W1 闭合后,W2 和 W3/W4 可按 charter §8.2 DAG 并行启动

> **最终 verdict**:**本轮 review 收口**。W0 closed;W1 可启。不再要求实现者追加回应。若后续 W1/W2/W3/W4 在引用 W0 产物时发现新的非回归性议题,应另开 review 文档,不再 append 本文件。
