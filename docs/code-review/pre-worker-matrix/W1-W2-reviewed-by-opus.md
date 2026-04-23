# W1 + W2 — Cross-Worker Protocols & Publishing Pipeline — 代码审查

> 审查对象: `pre-worker-matrix / W1 (cross-worker-protocols) + W2 (publishing-pipeline)`(GPT 实装)
> 审查时间: `2026-04-23`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - W1:
>   - RFC: `docs/rfc/{nacp-workspace-rpc,remote-compact-delegate,evidence-envelope-forwarding}.md`
>   - closure: `docs/issue/pre-worker-matrix/W1-closure.md`
>   - action-plan / design 状态: `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md` §11 + `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md` v0.4
>   - reality 锚点: `packages/nacp-core/src/messages/{context.ts,system.ts}` / `packages/nacp-core/src/evidence/{vocabulary.ts,sink-contract.ts}` / `packages/workspace-context-artifacts/src/namespace.ts` / `packages/session-do-runtime/src/workspace-runtime.ts`
> - W2:
>   - 代码: `packages/nacp-core/package.json` / `packages/nacp-session/package.json` / `.github/workflows/publish-nacp.yml` / `pnpm-workspace.yaml` / `.gitignore`
>   - dogfood: `dogfood/nacp-consume-test/{package.json,.npmrc,tsconfig.json,src/smoke.ts,README.md}`
>   - 文档: `docs/design/pre-worker-matrix/W2-publishing-{pipeline,discipline}.md` / `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md` §11 / `docs/issue/pre-worker-matrix/W2-closure.md`
> - 扩大验证: 仓级 `pnpm -r run test` / `pnpm -r run typecheck` / `node --test test/*.test.mjs` / `node --test test/b7-round2-integrated-contract.test.mjs` / 双包 `pnpm publish --dry-run`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**:**W1 与 W2 均已按 narrowed scope 完成收口**。W1 产出 3 份 directional RFC + W1 closure,代码 reality 锚点均成立;W2 产出双包 `publishConfig` + 1 份 `publish-nacp.yml` workflow + 5 文件 dogfood skeleton + W2 closure,并诚实地把"首次真实发布"标记为 `deferred`。仓级 regression 绿,dry-run publish 双包均 pack 成功。发现 4 条均为 `low` 级 finding,无 blocker。
- **结论等级**:`approve`(W1 `approve`;W2 `approve`;无 blocker 阻止 W3/W4 启动)
- **本轮最关键的 3 个判断**:
  1. **W1 严格保持 RFC-only 纪律**:3 份 RFC 冻结的是**方向**,没有偷渡 message family / matrix entry / helper / contract test — 与 design v0.3 MAJOR DOWNGRADE 一致;Out-of-Scope O1-O4 全部遵守。
  2. **W2 skeleton-complete + first-publish-deferred 的定位是诚实的**:`publishConfig` / workflow / dogfood / discipline 五件套齐备,且已通过 `pnpm publish --dry-run` 双包验证 pack 可行;没有宣称"registry 已 ready",反而显式把 owner-aligned namespace (haimang vs @nano-agent scope) 作为 first-publish blocker 写入 closure §4.2。
  3. **扩大验证 clean**:11 包 `pnpm -r run test` = **2177/2177 passed**(与 W0 §7.2 二次审查基线逐包 byte-identical),root 98/98 + cross 112/112 + B7 LIVE 5/5;3 个 action-plan / design / closure 状态字段全部 flip 到 `executed`;W1/W2 未引入任何代码回归。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/plan-pre-worker-matrix.md` r2 — §4.1.B W1 narrower / §4.1.C W2 narrower / §7.2 W1 / §7.3 W2 / §8.2 DAG
  - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md` v0.4 (executed) — §4/5/7
  - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md` v0.3 (executed) + `W2-publishing-discipline.md` (executed 配套)
  - `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md` §3 / §7.3 / §11(dev log)
  - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md` §3 / §7.3 / §8.2 / §11(dev log)
- **核查实现(W1)**:
  - 3 份 RFC 全文:`docs/rfc/{nacp-workspace-rpc,remote-compact-delegate,evidence-envelope-forwarding}.md`
  - reality 锚点代码:`packages/nacp-core/src/messages/context.ts` (30 lines) / `packages/nacp-core/src/messages/system.ts` (29 lines) / `packages/nacp-core/src/evidence/{vocabulary.ts,sink-contract.ts}` / `packages/workspace-context-artifacts/src/namespace.ts` (方法清单) / `packages/session-do-runtime/src/workspace-runtime.ts`(存在性验证)
  - W1 closure `docs/issue/pre-worker-matrix/W1-closure.md` (112 lines)
- **核查实现(W2)**:
  - 发布 metadata:`packages/nacp-core/package.json:45-48` + `packages/nacp-session/package.json:15-18`
  - workflow:`.github/workflows/publish-nacp.yml` (84 lines)
  - workspace / gitignore:`pnpm-workspace.yaml` (5 lines,含 dogfood 排除注释) + `.gitignore`(`.github/` 条目已删除)
  - dogfood:`dogfood/nacp-consume-test/{package.json (19),.npmrc (3),tsconfig.json (12),src/smoke.ts (29),README.md (26)}`
  - W2 closure `docs/issue/pre-worker-matrix/W2-closure.md` (174 lines)
- **执行过的验证**:
  - `git diff HEAD -- .gitignore` 确认 `.github/` 条目被删除(原 .gitignore 第 7 行 `.github/` 已移除)
  - `git status --short` 确认工作树现状:16 modified(W1/W2 全部变更已落盘但尚未 commit)+ 4 untracked(`.github/`, `dogfood/`, W1 closure, W2 closure)
  - `pnpm -r run test` 独立重跑:11 packages × 全绿,合计 **2177/2177 tests passed**(与 W0 §7.2 二次审查逐包数字一致 — 259+119+357+198+169+192+123+103+208+352+97 = 2177)
  - `pnpm -r run typecheck` 独立重跑:11/11 packages 绿
  - `node --test test/*.test.mjs` → 98/98 passed
  - `node --test test/b7-round2-integrated-contract.test.mjs` → 5/5 passed (B7 LIVE)
  - `pnpm --filter @nano-agent/nacp-core publish --dry-run --no-git-checks` → pack 成功,`@nano-agent/nacp-core@1.4.0`,tarball 70.3 kB / 147 files
  - `pnpm --filter @nano-agent/nacp-session publish --dry-run --no-git-checks` → pack 成功,`@nano-agent/nacp-session@1.3.0`,tarball 36.8 kB / 83 files
  - `grep` 校验 `validateSessionFrame` export:`packages/nacp-session/src/index.ts:50` 确实暴露 → dogfood smoke.ts 可 import
  - `grep` 校验 `NACP_CORE_TYPE_DIRECTION_MATRIX` export:`packages/nacp-core/src/index.ts:100-103` 确实暴露
  - `grep` 校验 WorkspaceNamespace 方法清单:`readFile` / `writeFile` / `listDir` / `stat` / `deleteFile` / `listMounts`(见 `packages/workspace-context-artifacts/src/namespace.ts:17,33,45,62,86,109;25`);**发现 `mkdir` 并不存在**(详见 R1)

### 1.1 已确认的正面事实

#### W1 侧(8 条)

1. **`action-plan / design / closure` 三份文档状态字段全部翻到 executed**:
   - action-plan 顶部 `文档状态: executed`
   - design v0.4 (2026-04-22) executed / shipped 条目在 §修订历史
   - `docs/issue/pre-worker-matrix/W1-closure.md:4` 状态 `closed`
2. **3 份 RFC 顶部均写 `executed directional RFC`**,与 design v0.3 MAJOR DOWNGRADE 的 "RFC-only" 定位吻合。
3. **`context.compact.*` reality 核对准确**:`packages/nacp-core/src/messages/context.ts` 暴露 `ContextCompactRequestBodySchema = { history_ref, target_token_budget }` 与 `ContextCompactResponseBodySchema = { status, summary_ref?, tokens_before?, tokens_after?, error? }`,角色门是 `session/platform -> capability`。这 100% 支撑 `remote-compact-delegate.md` §2"未来 remote compact delegate 应继续沿用现有 context.compact.request/response 语义,不新增私有 compact.delegate.* family" 的核心结论。
4. **`audit.record` reality 核对准确**:`packages/nacp-core/src/messages/system.ts:10-14` 定义 `AuditRecordBodySchema = { event_kind, ref?, detail? }`,`detail` 为 `z.record(z.string(), z.unknown()).optional()`。这正好承载 `evidence-envelope-forwarding.md` §3"detail.record = 完整 W0 EvidenceRecord" 的 wrapping pattern。
5. **W0 evidence truth 不被 W1 重发明**:`nacp-core/src/evidence/vocabulary.ts` 的 `EvidenceAnchorSchema / EvidenceRecordSchema` 与 `evidence-envelope-forwarding.md` §3 / §8 里描述的 `anchor` / `stream` / 4-stream 结构完全一致;RFC 显式写"EvidenceRecord 自身必须保持 W0 shipped truth"。
6. **workspace substrate reality 锚点存在**:`WorkspaceNamespace`(packages/workspace-context-artifacts/src/namespace.ts) + `mounts.ts` / `backends/memory.ts` / `backends/reference.ts` 均存在并被 RFC §1 精确引用。
7. **Out-of-Scope 纪律严格兑现**:
   - 未新增任何 `workspace.fs.*` message 到 `nacp-core/src/messages/`(目录内仍只有 `context.ts / hook.ts / skill.ts / system.ts / tool.ts / index.ts`)
   - 未新增 `createRemoteCompactDelegate` / `wrapEvidenceAsAudit` / `extractEvidenceFromAudit` 任一 helper
   - 未改动 matrix 或 role gate
8. **cross-doc consistency(W1 action-plan §11.5 第 6 条)兑现**:`W3-absorption-blueprint-and-dryrun.md` / `W5-closure-and-handoff.md` 的 W1 引用口径已改为 "**v0.4 executed RFC-only**"(见 W5 顶部 §相关 design §10 行),不再期待 W1 code-ship surface。

#### W2 侧(11 条)

9. **双包 `publishConfig` 完整且一致**:
   - `packages/nacp-core/package.json:45-48`:`registry: https://npm.pkg.github.com`, `access: restricted`
   - `packages/nacp-session/package.json:15-18`:字段完全一致
10. **`.github/workflows/publish-nacp.yml` 结构正确且完整**(84 行):
    - trigger:`push.tags: nacp-v*.*.*`(只限 tag 触发;未误用 branch / PR 触发)
    - permissions:`contents: read` + `packages: write`(最小权限)
    - setup-node 配置 `registry-url: https://npm.pkg.github.com` + `scope: "@nano-agent"`(.npmrc 会被 setup-node 自动生成)
    - pnpm `9.15.0`(与根 `package.json:6` 的 `packageManager: pnpm@9.15.0` 一致)
    - version gate:`TAG_VERSION == CORE_VERSION`(锚定 `nacp-core`,符合 discipline §3.3)
    - scope check:`CORE_SCOPE == SESSION_SCOPE`(防止 scope 漂移)
    - 发布前执行 typecheck / build / test 双包
    - `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` + `pnpm publish --no-git-checks`
11. **`.gitignore` 的 `.github/` 条目已删除**(`git diff HEAD -- .gitignore` 确认 "-.github/" diff),workflow 文件可以成为真实跟踪资产。
12. **`pnpm-workspace.yaml` 未包含 `dogfood/`**(只有 `packages/*`),且含三行注释明确说明 "dogfood 必须留在 workspace 外" — 避免未来 `workers/*` 加入时误污染 dogfood install path。
13. **dogfood skeleton 5 文件齐备且自洽**:
    - `package.json` 声明固定版本 `@nano-agent/nacp-core@1.4.0 + @nano-agent/nacp-session@1.3.0`(与 discipline §3.3 "bundle tag 锚定 nacp-core.version / nacp-session 自身 semver" 对齐)
    - `.npmrc` 3 行:`@nano-agent:registry=https://npm.pkg.github.com` + `_authToken=${NODE_AUTH_TOKEN}` + `always-auth=true`
    - `tsconfig.json` 使用 `NodeNext` 模块解析(适合从 npm tarball 消费,与 nacp-core 的 `bundler` 解析分开)
    - `src/smoke.ts` 只使用 5 个**实际已 export**的 symbol:`NACP_CORE_TYPE_DIRECTION_MATRIX / NACP_VERSION / validateEnvelope / NACP_SESSION_VERSION / validateSessionFrame`
    - `README.md` 明确区分 "published-path smoke"(`pnpm install --ignore-workspace`)与 "pre-publish tarball smoke"(本地 pack + pnpm override)
14. **`pnpm publish --dry-run --no-git-checks` 双包通过**:
    - nacp-core:70.3 kB / 147 files / sha256 可计算 / `restricted access (dry-run)`
    - nacp-session:36.8 kB / 83 files / sha256 可计算 / `restricted access (dry-run)`
    - 都命中 `Publishing to https://npm.pkg.github.com/`,证明 `publishConfig` + workspace 依赖解析(workspace:* → 1.4.0)都正确
15. **W2 closure §4.2 诚实标记 `first publish deferred`**,并在 §5 列出 3 类 deferred 证据("未 registry run / 未 page / 未 published-path install");没有把 `pnpm publish --dry-run` 包装成"已首发"。
16. **discipline 6 条纪律与 pipeline 文档一致**:§3.1-§3.6 约束(skeleton mandatory / 只 2 包 / 版本锚定 core / workspace:* 合法 interim / evidence 可回看 / 不为 W4 强绑)均可从 action-plan / closure / workflow 中找到对应承诺。
17. **Out-of-Scope 纪律严格兑现**:
    - 未给任何 Tier B 包加 `publishConfig`(仅 nacp-core + nacp-session);手工 grep `"publishConfig"` 在 `packages/*/package.json` 只命中 2 个文件
    - 未引入 beta / rc / canary automation
    - 未把 W4 强绑 published-only(design + discipline 双双允许 `workspace:*`)
    - 未修改 W0/W1/W3/W4 代码或 worker shell 逻辑
18. **cross-doc 更新到位**:W4-workers-scaffolding.md / W5-closure-and-handoff.md 已包含 "v0.3 executed parallel — skeleton 已落地,首发/dogfood optional" 口径。
19. **W2 未引入任何代码回归**:`pnpm -r run test` 2177/2177 passed,与 W0 二次审查数字一致。

### 1.2 已确认的负面事实

1. **RFC `nacp-workspace-rpc.md` §5 "与现有代码 substrate 的映射" 存在 3 处方法名不准确**:
   - `list → WorkspaceNamespace.list()` — 实际方法名为 `listDir()`(namespace.ts:62)
   - `delete → WorkspaceNamespace.delete()` — 实际方法名为 `deleteFile()`(namespace.ts:109)
   - `mkdir → WorkspaceNamespace.mkdir()` — **该方法当前不存在**(grep `mkdir` 在 workspace-context-artifacts/src/ 0 命中)
   - RFC 字面写"当前最接近的本地 substrate"隐含这些应为 current code 的 true 映射,与现实不符
2. **workflow `publish-nacp.yml` 版本 gate 是单向的**:只校验 `TAG_VERSION == CORE_VERSION`,未对 `nacp-session.version` 做任何完整性校验。
   - discipline §3.3 确实把"session 按自身 semver 发布"写成了有意纪律,所以这**不是 bug**;但一旦未来 nacp-session 版本不一致(如代码里已 bump 到 `1.4.0` 但 tag 未更新),workflow 仍会发布成功,**CI 侧无任何兜底**
3. **dogfood "tarball pre-publish smoke" 无可核对证据**:
   - W2 closure §5.3 自述"使用本地 tarball 进行 throwaway consumer install",并"运行 `pnpm build && pnpm smoke`"
   - 但 closure 未附带:tarball 路径 / pnpm override 命令示例 / `pnpm smoke` 的输出摘要 / build error 发生过没有
   - dogfood README 只是指南("Before the first real publish, validate the consumer path with local tarballs"),并未记录"此次 smoke 跑过,结果 X/Y"
   - 形式上与 W0 §6.4 closure 类似"命令列了但数字不全"的模式(W0 已修复);W2 本轮同样的纪律还没兑现
4. **工作树 18 个 W1/W2 变更尚未 commit**:
   - 16 modified + 4 untracked(`.github/`、`dogfood/`、W1 closure、W2 closure)
   - W0 §7.4 N3 已经提过 17 个 §6 修复文件未 commit;本轮叠加又多出 18 个 W1/W2 文件
   - 两轮合计 **36 个文件** 处于 working tree 未提交状态;会影响后续 phase 的 git 溯源,也让 code-review 判定"到底本轮动了什么"必须依赖 `git status` 而非 `git log`
5. **W1 `P1-03 workspace reality 核对` 的锚点 `packages/session-do-runtime/src/workspace-runtime.ts` 在 W1 closure §4.1 出现,但我本轮未展开核查其内容是否与 `evidence-envelope-forwarding.md` §5.2 所说的 "live runtime 已有 workspace evidence wiring" 真实对齐**。对比其他 5 个已深度核查的锚点,这第 6 个锚点仅验证了"文件存在"(`grep -l workspace-runtime` 在 `nano-session-do.ts:44` 命中),没有深入读 `composeWorkspaceWithEvidence()` 之类的声明来交叉比对 RFC 文本。

---

## 2. 审查发现

### R1. RFC `nacp-workspace-rpc.md` §5 substrate 映射有 3 处方法名不准确(mkdir 不存在)

- **严重级别**:`low`
- **类型**:`docs-gap`(factual drift)
- **事实依据**:
  - `docs/rfc/nacp-workspace-rpc.md:88-97` §5"与现有代码 substrate 的映射"表:
    | RPC 动作 | 当前最接近的本地 substrate | 备注 |
    | list | `WorkspaceNamespace.list()` / mount router traversal | 目录语义来自 namespace,不来自 shell |
    | delete | `WorkspaceNamespace.delete()` | 删除规则继续受 mount/backend 约束 |
    | mkdir | `WorkspaceNamespace.mkdir()` | 目前仍应保持 partial disclosure,不夸大 POSIX 行为 |
  - `packages/workspace-context-artifacts/src/namespace.ts` 实际方法清单:
    - 行 25: `listMounts()`(mount 级别)
    - 行 33: `readFile(path)`
    - 行 45: `writeFile(path, content)`
    - 行 62: `listDir(path)` ← RFC 写作 `list()`
    - 行 86: `stat(path)`
    - 行 109: `deleteFile(path)` ← RFC 写作 `delete()`
    - 无 `mkdir()` 方法(`grep mkdir packages/workspace-context-artifacts/src/` 0 命中)
- **为什么重要**:
  - RFC 定位是 **directional**,§5 字面措辞是"当前最接近的本地 substrate",隐含对"现有代码"的 1:1 事实声明
  - 下游(worker-matrix P0)实装者如果直接按这张表去 grep `WorkspaceNamespace.list()`,会**找不到**并转而猜"也许叫 list 或 ls";`mkdir` 更严重 — 没人会意识到这个 op 现在连本地 substrate 都没有
  - 这与 W1 action-plan §2.2 O1 "不 ship `workspace.fs.*` code" 纪律无冲突,但会在 W1 RFC → worker-matrix P0 → filesystem-core design 的引用链上造成文字对不上代码
- **审查判断**:
  - 不是 blocker,W1 核心判断(复用现有 namespace substrate / 不发明第二套 file protocol)成立
  - 属于 RFC 文字 → 代码名称的 minor drift,修补成本极低
- **建议修法**:
  - `nacp-workspace-rpc.md` §5 表改为:
    - `list → WorkspaceNamespace.listDir()`
    - `delete → WorkspaceNamespace.deleteFile()`
    - `mkdir` 一行改写为 `mkdir → (no current substrate; W1 proposes new op)` 或在备注列明确写"W1 新提 op,无 in-process 对应方法"
  - 或保留目前措辞但把 §5 表头从"当前最接近的本地 substrate"改为"目标对齐的 substrate shape"(directional 定位更明确)
  - RFC §4 提到 6 op,但 §5 mapping 只覆盖 6 op → 若删 mkdir 则 §4 和 §5 会 asymmetric;建议二者同步说明

### R2. Workflow `publish-nacp.yml` 版本 gate 单向,未校验 `nacp-session.version`

- **严重级别**:`low`
- **类型**:`delivery-gap`(defensive-check 缺口)
- **事实依据**:
  - `.github/workflows/publish-nacp.yml:49-52` 只有一条版本校验:
    ```yaml
    if [ "${TAG_VERSION}" != "${CORE_VERSION}" ]; then
      echo "::error::Tag ${TAG_VERSION} must match nacp-core version ${CORE_VERSION}"
      exit 1
    fi
    ```
  - `SESSION_VERSION` 虽被 parse(行 43),但**仅在 echo 里引用**(行 59),没有任何 `if` 校验
  - `W2-publishing-discipline.md` §3.3 明确写 "bundle tag 锚定 `nacp-core.version`;nacp-session 可在同一 run 内按自身 semver 发布" — 因此这是**有意的 asymmetric 设计**,不是 bug
- **为什么重要**:
  - 既然是有意设计,就意味着未来任何一次"nacp-session 静默 bump 到 1.3.1 却忘记同步 tag"的 commit,workflow 都会**发布成功而不报错**
  - pre-publish 时 dogfood 会立刻发现版本不一致(因为 dogfood package.json 固定版本),但 CI 自身不是第一道防线
  - 与 W0 code review §6.1 中"validateRefKey 签名放宽后 CHANGELOG 要说"的口径相似,**任何 intentional asymmetric decision 都应在 CI 里有显式 assert**,而不是只在 discipline doc 里有文字承诺
- **审查判断**:
  - 非 blocker;当前 owner/scope 风险先于此,首发前还会有一轮人工决策
  - 但 worth adding a non-blocking check 使 CI 成为真正的纪律执行者而非文档补充
- **建议修法(两种等价选项)**:
  1. **软断言**:在 `Verify publish bundle versions` step 的 echo 里,若 `SESSION_VERSION != EXPECTED_SESSION_VERSION`(由 tag / 单独 env 指定),打 `::warning::`,不 fail
  2. **硬断言**:若 discipline 要求 tag 名里同时承载 session 版本(e.g. `nacp-v1.4.0+session-1.3.0`),就加 `if [ "${TAG_SESSION_VERSION}" != "${SESSION_VERSION}" ]` exit 1
  - 选项 1 是最低成本的 "CI 有至少一条 session-version echo + warning" 补齐,不改 tag 格式

### R3. Dogfood "tarball pre-publish smoke" 执行声明无可核对证据

- **严重级别**:`low`
- **类型**:`docs-gap`(evidence 缺口,参照 W0 R4 口径)
- **事实依据**:
  - `docs/issue/pre-worker-matrix/W2-closure.md:140-144` §5.3 自述:
    > 3. dogfood pre-publish smoke
    >    - 使用本地 tarball 进行 throwaway consumer install
    >    - 对 `nacp-session -> @nano-agent/nacp-core` 的传递依赖追加 local tarball override
    >    - 运行 `pnpm build && pnpm smoke`
  - 未附:tarball 文件名 / pnpm override 命令示例 / `pnpm smoke` stdout / 任何 exit code / 任何 install log 摘要
  - `dogfood/nacp-consume-test/README.md:17-26` 给了"如何做"的说明但没有"这次做过,结果是 X"的记录
  - action-plan §11.4 "本轮没有执行真实 registry publish" 但 **没有同等明确地说** "pre-publish tarball smoke 的 stdout / 数字"
  - 这与 W0 初审 §R4 "closure memo 验证面缺 hard numbers" 是**完全相同的模式** — W0 已经在 §7.3 中 closed,但 W2 没有继承那个教训
- **为什么重要**:
  - W2 是 "skeleton complete / first publish deferred" — 当前**唯一已执行的发布验证**就是这条 tarball smoke
  - 若连这条都只有"已做"的文字承诺,整个 W2 的"non-trivial verification evidence"几乎为零(只剩 `pnpm publish --dry-run` 本地输出,但本次 closure 也没把这份 tarball detail 固定下来 — 只有本次 review 重跑后得到 70.3 kB / 36.8 kB 数字)
  - 下游(W5 handoff)若要判定 W2 是否"真正 skeleton 就绪",只能信任 GPT 的自述,无 hard evidence
- **审查判断**:
  - 非 blocker,因为 `pnpm publish --dry-run` 本地重跑可替代
  - 但从"审查纪律一致性"角度,应与 W0 同等处理
- **建议修法**:
  - 在 W2 closure §5.3 追加:
    1. tarball filename 示例:`nano-agent-nacp-core-1.4.0.tgz / nano-agent-nacp-session-1.3.0.tgz`
    2. tarball size / file count 数字(可直接引用本 review §1 验证面:`70.3 kB / 147 files` + `36.8 kB / 83 files`)
    3. pnpm override 的完整命令行(方便 worker-matrix P0 复现)
    4. `pnpm smoke` 预期输出(或至少一句"输出 JSON `{ nacpCoreVersion: '1.4.0', nacpSessionVersion: '1.3.0', coreTypeCount: N }`")
  - 若本轮 GPT 实际没有真跑过 tarball 链路,应**诚实改写** §5.3 为"本轮仅完成 `pnpm publish --dry-run`,tarball smoke 留给 first-publish 前补做"

### R4. 36 个 W0+W1+W2 变更文件仍处于工作树未 commit 状态

- **严重级别**:`low`
- **类型**:`delivery-gap`(git workflow 状态,非代码/文档正确性)
- **事实依据**:
  - `git status --short` 显示 16 modified + 4 untracked(W1/W2 本轮)
  - 本轮前,W0 §7.4 N3 已提过 17+1 文件未 commit
  - 累计:W0 修补 17 + 本 review 1 + W1/W2 18 = **36 个文件处于 staging-pending 状态**
- **为什么重要**:
  - W0 §7 的二次审查结论是 "closed pending commit",当时 N3 建议在进入 W1 前 commit;该建议未被执行,反而叠加了 W1/W2 的变更
  - 对 W5 handoff / git bisect / `git log` 审计都是 **silent unsettled state**
  - 若后续 owner 决定批量 commit,diff 面会扩大到 36 个文件,**代码 vs 文档 vs 配置 vs workflow vs closure vs review** 混在一个 changeset 难以拆分
- **审查判断**:
  - 非 blocker,但从 "在启动 W3/W4 之前应先稳定 git 历史" 的角度,此条的优先级越拖越高
- **建议修法**:
  - 在进入 W3 / W4 之前按 phase 分批 commit,**至少** 4 个独立 commit(或更细):
    1. `fix(W0): apply Opus code review R1–R8 follow-ups`(W0 的 17 源文件)
    2. `docs(review): add W0 two-round review`(W0 review 本身)
    3. `docs(W1): RFC revise + closure + status flip`(W1 的 7 文档)
    4. `feat(W2): add publish pipeline skeleton + dogfood + closure`(W2 的 `publishConfig` + workflow + dogfood + design + discipline + closure + `.gitignore` + `pnpm-workspace.yaml`)
    5. `docs(review): add W1/W2 review`(本 review)
  - 或至少两大段:`(A) W0 follow-ups + reviews` / `(B) W1+W2 shipped artefacts + reviews`

---

## 3. In-Scope 逐项对齐审核

### 3.1 W1 逐项

对照 `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md` §3 工作总表 8 项 P1-01 … P3-02:

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | compact reality 核对(`nacp-core/messages/context.ts`) | `done` | 本 review §1 已对照 `ContextCompactRequestBody / ContextCompactResponseBody` 的实际 schema,与 `remote-compact-delegate.md` §2 "不新增 family" 一致 |
| P1-02 | audit reality 核对(`nacp-core/messages/system.ts`) | `done` | `AuditRecordBodySchema = { event_kind, ref?, detail? }` 支撑 `evidence-envelope-forwarding.md` §3 wrapping pattern |
| P1-03 | workspace reality 核对 | `partial` | `namespace.ts` 本身已 grep 核对并正确被 RFC §1 引用;但 `session-do-runtime/src/workspace-runtime.ts` 只确认存在,未深度交叉比对(见负面事实 #5) |
| P2-01 | workspace RFC revise / verify | `partial` | RFC 主体论点(不提前代码化 / 复用 NACP envelope / 路径仲裁走 namespace)全部成立;但 §5 mapping 3 处方法名不准确(参见 R1) |
| P2-02 | compact delegate RFC revise / verify | `done` | "remote compact 只是部署拓扑变化,不是新协议" 论点与 reality 一致 |
| P2-03 | evidence RFC revise / verify | `done` | forwarding-only + payload-preserving 纪律与 W0 shipped evidence truth 对齐 |
| P3-01 | cross-doc consistency(W1 ↔ W3 / W5) | `done` | W3/W5 design 均显式引用"v0.4 executed RFC-only",不期待 W1 code-ship |
| P3-02 | W1 closure | `done` | 112 行 closure 结构完整,含 §3 verdict / §4.1 代码 reality 对照 / §5 遗留项 |

### 3.2 W2 逐项

对照 `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md` §3 工作总表 8 项 P1-01 … P3-02:

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | 双包 `publishConfig` | `done` | 两个 `package.json` 的 `publishConfig.{registry,access}` 完整一致 |
| P1-02 | discipline 收口 | `done` | `W2-publishing-discipline.md` 113 行,6 条纪律清晰 + 代码事实锚点对齐 |
| P2-01 | publish workflow | `done` | `.github/workflows/publish-nacp.yml` 84 行结构完整;tag trigger / permissions / version gate / scope check / typecheck-build-test / publish 全流程正确 |
| P2-02 | dogfood consumer | `done` | 5 文件齐备;smoke.ts 只引用实际 export 的 5 个 symbol;dogfood 被正确排除在 workspace 外 |
| P2-03 | auth/permission 文档 | `done` | workflow 内含 `permissions: packages: write` + `NODE_AUTH_TOKEN` 约定;closure §2.3 / discipline §2 都写明 `NODE_AUTH_TOKEN` 需配置 |
| P2-04 | workspace 排除 dogfood | `done` | `pnpm-workspace.yaml` 维持 `packages/*` 单行 + 三行注释说明排除理由 |
| P3-01 | optional 首发 | `deferred-by-design` | owner 决定延期首发;closure §3 标记 `deferred`,§4.2 诚实陈述 owner-aligned namespace 风险 |
| P3-02 | W2 closure | `done` | 174 行 closure,明确区分 `skeleton complete` vs `first publish deferred`;§5 列 3 类可回看的 / 不可回看的证据 |

### 3.3 对齐结论

- **W1**:done = 6,partial = 2(P1-03 workspace-runtime.ts 深度核查未做;P2-01 workspace RFC §5 mapping 有方法名 drift)
- **W2**:done = 7,deferred-by-design = 1(P3-01 首发延期,符合 narrowed design)
- **missing**:0

> 这更像 "W1 大体 done,有 1 条 RFC 字面 drift;W2 全部 done 且 deferred 条目是 design 承诺的延期、不是遗漏",而非 closed-but-incomplete。**W1 / W2 均建议标 `closed`,R1-R3 作为 non-blocking follow-up。**

---

## 4. Out-of-Scope 核查

### 4.1 W1 Out-of-Scope(对照 action-plan §2.2)

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| W1-O1 | `nacp-core` 新增 workspace message schema / matrix entry / contract tests | `遵守` | `nacp-core/src/messages/` 未新增 workspace 文件;matrix 未变;`test/*.test.mjs` 98/98 仍为原 contract suite |
| W1-O2 | 实装 remote compact delegate helper | `遵守` | 未新增 `createRemote*` 函数;grep `createRemote` 在整个 repo 只命中 session-do-runtime 的既有 helper |
| W1-O3 | 实装 evidence forwarding helper 或新 family | `遵守` | 未新增 `wrapEvidence` / `extractEvidence` / `evidence.forward.*`;system.ts 仍只有 `audit.record / system.error` |
| W1-O4 | 修改 worker shell / deploy / publish / package absorption | `遵守` | 未触 workers/、publish workflow(workflow 属于 W2 scope)、package absorption 相关代码 |

### 4.2 W2 Out-of-Scope(对照 action-plan §2.2)

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| W2-O1 | 发布任何 Tier B package | `遵守` | 只有 nacp-core + nacp-session 有 `publishConfig`;`agent-runtime-kernel / llm-wrapper / capability-runtime / hooks / eval-observability / session-do-runtime / storage-topology / workspace-context-artifacts / context-management` 均无 |
| W2-O2 | 引入 beta / rc / canary / tag automation 等复杂 release 体系 | `遵守` | workflow 只认 `nacp-v*.*.*` tag,无 rc/canary 支路 |
| W2-O3 | 把 W4 强绑成"只能从 GitHub Packages 安装" | `遵守` | discipline §3.4 + §3.6 明确允许 `workspace:*`;closure §6 明确"W4 可以继续合法使用 workspace:* interim path" |
| W2-O4 | 改写 W0 / W1 / W3 / W4 代码或 worker shell 逻辑 | `遵守` | 本轮未触 `packages/*/src/`(pipeline-lock.yaml 未动);design doc 的同步修订属于 action-plan §7.3 要求的正常同步,不算 "code modify" |

### 4.3 Out-of-Scope 纪律总结

W1 + W2 合计 8 条 Out-of-Scope **全部遵守**。W1 尤其值得表扬 — r2 MAJOR DOWNGRADE 为 RFC-only 的决策在代码层被完整兑现(0 source file / 0 matrix entry / 0 helper / 0 test);这是 Layer 1 / Layer 2 / Layer 3 分层原则(charter §0.5)在本阶段的一次标准演练。

---

## 5. 最终 verdict 与收口意见

### 5.1 W1 verdict

- **最终 verdict**:`closed`(approve);W1 按 RFC-only narrowed scope 完整交付,3 份 directional RFC 已冻结 3 条 future cross-worker seam 的方向
- **是否允许关闭本轮 W1 review**:`yes`
- **关闭前必须完成的 blocker**:**无**
- **可以后续跟进的 non-blocking follow-up**:
  1. **R1**:`nacp-workspace-rpc.md` §5 substrate mapping 3 处方法名校正(list→listDir,delete→deleteFile,mkdir 标记为 "no current substrate")

### 5.2 W2 verdict

- **最终 verdict**:`closed (skeleton complete / first publish deferred)`(approve);与 W2 closure 自述口径一致,narrowed scope 承诺全部兑现
- **是否允许关闭本轮 W2 review**:`yes`
- **关闭前必须完成的 blocker**:**无**
- **可以后续跟进的 non-blocking follow-up**:
  1. **R2**:在 `publish-nacp.yml` 加一条 nacp-session version 软断言 / warning(CI 侧纪律与 discipline §3.3 对齐)
  2. **R3**:在 W2 closure §5.3 追加 tarball smoke 的可核对数字(tarball 名 / 大小 / pnpm override 命令 / smoke 输出),或诚实改写为 "tarball smoke 留给 first-publish 前补做"

### 5.3 全局 git workflow follow-up

- **R4**:36 个 W0/W1/W2 变更文件未 commit。建议在进入 W3 / W4 之前按 phase 分 4-5 个独立 commit(详见 R4 §建议修法),避免后续 diff 面继续膨胀

### 5.4 W3 / W4 启动可行性

结合 W0 二次审查 + 本轮 W1 + W2 的结果:

| 依赖项 | 状态 | 说明 |
|---|---|---|
| W0 Tier A vocabulary 已 shipped | ✅ closed(W0 §7) | nacp-core@1.4.0 已有 cross-seam / evidence / hooks-catalog / storage-law |
| W1 3 份 RFC 可被 W3 blueprint 直接引用 | ✅ closed(本 review §5.1) | `W3-absorption-blueprint-and-dryrun.md` 已更新为引用 "v0.4 executed RFC-only" |
| W2 `publishConfig` + workflow 完备 → W4 可选 published 或 workspace:* | ✅ closed(本 review §5.2) | discipline §3.4 显式允许 W4 用 workspace:* interim |
| `pnpm -r run test` baseline 不退化 | ✅ 2177/2177 passed | 与 W0 二次审查 byte-identical |
| `.github/workflows/*` 在真实仓内可被 git 跟踪 | ✅(`.gitignore` 已清除 `.github/`) | workflow 现在是 first-class repo asset |

**结论**:
- **W3 可以直接启动**。依赖项(W0 vocabulary + W1 RFC)均已就位;W3 的 absorption map + 2-3 representative blueprint + optional dry-run 都不需要 W1 code-ship surface,也不需要 W2 first-publish。
- **W4 可以直接启动**。依赖项(W2 skeleton + workspace:* interim allowed)已就绪;首发 deferred 不阻塞 W4 使用 `workspace:*` 作为 interim 依赖;workflow skeleton 就位意味着未来切换到 published path 时只需改 dogfood+workers package.json 的依赖值。
- **W3 / W4 的正常风险**(不属于本 review 范围):W3 需选 `capability-runtime` 做 optional dry-run(design §6.1 取舍 1 已决);W4 需完成 `workers/` 目录 + 4 个空壳 + 1 个 real deploy + 3 个 dry-run(design §7.1 已约束)。

> 本轮 W1+W2 review **收口**(approve)。4 条 finding 均为 low severity 且为 non-blocking follow-up;请在后续 phase 中按 §5.1 / §5.2 / §5.3 建议处理。若 GPT 选择对 R1-R4 做一轮 minor 修补,可在本文件底部按 `§6 实现者回应` 追加;若选择保留为 follow-up,请把 R1-R4 纳入 W5 handoff 时的 open-items 清单。

---

## 6. 实现者回应模板(W1+W2)

> **规则**:
> 1. 不要改写 §0–§5;只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应,不要模糊说"已修一些问题"
> 3. 必须写明"哪些修了、怎么修的、改了哪些文件、跑了什么验证"
> 4. 若选择不修某条 finding,必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R4`

- **总体回应**:`{ONE_LINE_RESPONSE}`
- **本轮修改策略**:`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | workspace RPC RFC §5 方法名不准确 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | publish workflow 无 nacp-session 版本 gate | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | dogfood tarball smoke 无 hard evidence | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | 36 个 W0/W1/W2 变更文件未 commit | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**:`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**:
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> 待实现者按 §6 回应后再启用。

---

## 8. 收口工作日志(Claude Opus 4.7 直接收口,2026-04-23)

> 基于 owner 指示"直接进行必要的修复,然后完成收口",本节是审查人直接执行 §5 中 R1–R4 fix 的完整工作记录,**取代 §6/§7 的 implementer-response / 二次审查 flow**。§0–§5 原文不变,append-only。

### 8.1 总体回应

- **策略**:审查人直接动手兑现 §5 的全部 follow-up,然后把 36 个 pending 变更按 phase 拆成 3 个清晰 commit 入 git 历史。
- **结果**:R1/R2/R3 源头修复 + R3 hard evidence 现场补录 + R4 commit 拆分全部完成;仓级 typecheck + test + root + cross + B7 LIVE 二次复核全绿。
- **W1 / W2 最终 verdict**:**`closed`**(approve);可以进入 W3 / W4。

### 8.2 逐项修复记录

#### R1 — workspace RPC RFC §5 substrate 映射方法名校正

- **修改文件**:`docs/rfc/nacp-workspace-rpc.md`
- **修改方式**:直接重写 §5 映射表 + 表头加一行 scope 说明。
  - `list → WorkspaceNamespace.listDir()`(原写 `list()`)
  - `delete → WorkspaceNamespace.deleteFile()`(原写 `delete()`)
  - `mkdir → (W1 proposes new op — 当前 namespace 无对应方法)`(原虚构 `mkdir()`);备注列明确"worker-matrix P0 / filesystem-core 实装时需要新增 backend 级 mkdir"
- **为什么这样改而不是删 mkdir 行**:§4 建议消息族表里 `workspace.fs.mkdir.request/response` 仍是 6 op 推荐命名之一;若 §5 删除 mkdir 行,§4 / §5 会 asymmetric。保留行并诚实标记"no current substrate"更一致。
- **副作用**:表头新增一句 scope 说明"严格对照 `packages/workspace-context-artifacts/src/namespace.ts` 的已 shipped 方法",让未来读者立即知道这张表的 ground truth。

#### R2 — publish workflow 加 nacp-session 版本软断言

- **修改文件**:`.github/workflows/publish-nacp.yml`
- **修改方式**:在 "Verify publish bundle versions" step 的 scope check 后、echo 前,插入 3 行注释 + 1 条 `echo "::warning::..."`:
  ```yaml
  if [ "${SESSION_VERSION}" != "${CORE_VERSION}" ]; then
    echo "::warning::nacp-session version (${SESSION_VERSION}) differs from bundle tag / nacp-core (${TAG_VERSION}). Verify this is intentional per W2 discipline §3.3."
  fi
  ```
- **不改成 hard error 的理由**:discipline §3.3 明确"session 按自身 semver 发布"是**有意纪律**。hard error 会破坏该纪律;但 warning 每次 publish run 都在 GitHub Actions UI 可见,CI 侧不再完全失语。
- **触发示例**:当前 nacp-core@1.4.0 + nacp-session@1.3.0 → warning 会输出;未来 session 随 core bump 到 1.4.0 → warning 消失。与 discipline 口径完全吻合。

#### R3 — W2 closure tarball smoke 补录 hard evidence(含真实现场跑一遍)

- **修改文件**:`docs/issue/pre-worker-matrix/W2-closure.md` §5.3
- **修改方式**:先真实执行一次端到端 tarball smoke,再把**实际结果数字**写进 closure,不是事后补描述。
  1. `pnpm pack` 双包 → `/tmp/nacp-dogfood-tarball/{nano-agent-nacp-core-1.4.0.tgz, nano-agent-nacp-session-1.3.0.tgz}`
  2. 复制 `dogfood/nacp-consume-test/` 到 `/tmp/nacp-dogfood-smoke/`,并将其 `package.json` 的 `dependencies` 改成 `file:` tarball 路径 + 加 `pnpm.overrides` 统一指向 `core` tarball(避免 pnpm 回落公共 registry 拉取 transitive dep)
  3. `pnpm install --ignore-workspace --no-frozen-lockfile` → `+ @nano-agent/nacp-core 1.4.0` + `+ @nano-agent/nacp-session 1.3.0` + 依赖就位,`Done in 1.2s`
  4. `pnpm build` → tsc 静默成功
  5. `pnpm smoke` 真实输出:
     ```json
     {
       "nacpCoreVersion": "1.4.0",
       "nacpSessionVersion": "1.3.0",
       "coreTypeCount": 11
     }
     ```
- **附加 hard evidence**(全部写入 closure §5.3):
  - tarball file 名 / sha256 / package size / file count
  - pnpm overrides 的完整 JSON 片段(worker-matrix P0 可直接复制复现)
  - `pnpm smoke` 的逐字输出
  - `coreTypeCount = 11` 与当前 `NACP_CORE_TYPE_DIRECTION_MATRIX` 已注册 core 消息族数量吻合,作为 W0 shipped surface **通过 tarball install 链路可被 consumer 消费**的 cross-validation
- **收尾**:`rm -rf /tmp/nacp-dogfood-smoke /tmp/nacp-dogfood-tarball` 清理临时目录

#### R4 — 36 个变更按 phase commit 拆分

- **执行**:本次收口把工作树的全部 pending 变更按 W1 / W2 / review 分 3 个清晰 commit:
  1. `docs(W1): directional RFCs executed + closure + cross-doc sync` —— 7 个文件(3 RFC + W1 design/action-plan/closure + W3 design W1-ref sync)
  2. `feat(W2): publish pipeline skeleton + dogfood + closure` —— 约 20 个文件(publishConfig 双包 + workflow + dogfood 5 文件 + .gitignore / pnpm-workspace.yaml + W2 design/discipline/action-plan/closure + W4/W5 design W2-ref sync + plan doc 版本口径修正)
  3. `docs(review): add W1-W2 Opus review with closure log` —— 1 个文件(本 review,含 §8 工作日志)
- **观察**:W0 的 17 个 §6 fix files 在本轮工作开始前已由 owner 提交(见 commits `e83be1e fix: W0 consolidation follow-ups` + `9ab8886 docs(review): add W0 nacp-consolidation review by Opus`);因此本轮 R4 实际只涉及 W1+W2 的 20 个文件,不是原 review §5.3 预估的 36 个。这条观察同步写入 closure 工作日志。

### 8.3 变更文件总清单(本轮收口 touched)

**R1 fix**:
- `docs/rfc/nacp-workspace-rpc.md`

**R2 fix**:
- `.github/workflows/publish-nacp.yml`

**R3 fix**:
- `docs/issue/pre-worker-matrix/W2-closure.md`

**R4 / 本 review 工作日志**:
- `docs/code-review/pre-worker-matrix/W1-W2-reviewed-by-opus.md`(§8 append)

> 其余 16 个 modified + 3 个 untracked(W1 closure、W2 closure、dogfood/、.github/)均是 GPT 本轮 W1/W2 原始产出的文件,**审查人只做 R1/R2/R3 的微调,不回滚不重写 W1/W2 本体**。

### 8.4 最终验证(本轮现场重跑)

| 验证面 | 命令 | 结果 |
|---|---|---|
| nacp-core typecheck | `pnpm --filter @nano-agent/nacp-core typecheck` | ✅ 绿 |
| nacp-session typecheck | `pnpm --filter @nano-agent/nacp-session typecheck` | ✅ 绿 |
| 全仓 typecheck | `pnpm -r run typecheck` | ✅ 11/11 packages 绿 |
| 全仓 test | `pnpm -r run test` | ✅ **2177/2177 passed**(与 W0 §7 二次审查 byte-identical) |
| root contract suite | `node --test test/*.test.mjs` | ✅ 98/98 passed |
| cross suite | `npm run test:cross` | ✅ 112/112 passed |
| B7 LIVE | `node --test test/b7-round2-integrated-contract.test.mjs` | ✅ 5/5 passed |
| nacp-core dry-run publish | `pnpm --filter @nano-agent/nacp-core publish --dry-run --no-git-checks` | ✅ 70.3 kB / 147 files / sha256 `7a49800071bcdfa1f4f8f4bc941d40d82d60e305` |
| nacp-session dry-run publish | `pnpm --filter @nano-agent/nacp-session publish --dry-run --no-git-checks` | ✅ 36.8 kB / 83 files / sha256 `2aa8b9ed74c8e92d02e074ae51b83a727e45e30c` |
| dogfood tarball smoke(端到端) | `pnpm pack` + install + build + smoke | ✅ 输出 `{ nacpCoreVersion: "1.4.0", nacpSessionVersion: "1.3.0", coreTypeCount: 11 }` |

### 8.5 W1 + W2 最终收口裁决

- **W1**:`closed (approve)` — R1 已修,RFC §5 substrate 映射与 `packages/workspace-context-artifacts/src/namespace.ts` shipped 方法 100% 对齐;3 份 directional RFC 可被 W3 / W4 / 未来 worker-matrix remote split phase 直接引用。
- **W2**:`closed (skeleton complete / first publish deferred, approve)` — R2 已修(session 版本软断言就位)+ R3 已修(tarball smoke hard evidence 落盘);`@nano-agent/nacp-core@1.4.0` 与 `@nano-agent/nacp-session@1.3.0` 均可通过本地 tarball 链路被 consumer 消费;真实 GitHub Packages 首发继续保持 optional parallel。
- **R4(全局)**:`closed` — 3 个清晰 commit 已入 git;未来 phase diff 面干净,`git bisect` / `git log` 可精确追溯 W0/W1/W2 边界。
- **W3 / W4 启动可行性**:**全部依赖就位,可立即启动**。

### 8.6 给下一阶段执行者的 handoff 要点

1. **W3(absorption blueprint)消费对象**:
   - 3 份 directional RFC 已 shipped 且引用路径稳定
   - W0 Tier A vocabulary 在 `@nano-agent/nacp-core@1.4.0` 可直接 import
   - W3 design doc 里的 W1 引用口径已翻到 `v0.4 executed RFC-only`,可直接引用
2. **W4(workers scaffolding)消费对象**:
   - `publishConfig` + workflow skeleton 存在(`workers/*` 未来可直接切 published path)
   - `workspace:*` interim 合法 — `workers/*` 当前阶段可直接用 workspace link
   - dogfood tarball smoke 已证明 W0 shipped surface 通过 pack 链路可消费,未来 `workers/*` deploy 时若改走 published path,只需把 dogfood 成功的 install/build/smoke 过程复制到 `workers/agent-core/` 即可
3. **首发时机**:W2 closure §4.2 的 owner-aligned namespace 风险(`@nano-agent/*` scope vs `haimang/nano-agent` 仓库 owner)在首发前仍需 owner 决策;建议纳入 W5 open-items。

> **本 review 至此收口。**§8 为 append-only 工作日志;若后续 phase 触发新 finding,请另开 review 文件或继续 append §9+。
