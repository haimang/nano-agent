# ZX4 Action Plan Reviewed by GPT

> 审查对象:
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
> - `docs/issue/zero-to-real/ZX3-closure.md`
> - `docs/action-plan/zero-to-real/ZX4-transport-finalization.md`
> 时间: `2026-04-28`
> 结论标签: **方向正确，但当前 draft 仍需 re-baseline 后再启动**

---

## 0. TL;DR

ZX4 的主方向是对的：**把 ZX2 留下的 transport rollback 窗口真正收口、把 session 语义补齐、把协议/auth 的重复实现收拢**，这三条线都是真问题。

但 **ZX4 现在这份 unified draft 还不适合直接执行**。它的主要问题不是“目标错了”，而是：

1. **scope 过宽**：把 transport finalization、session 语义补完、产品型 endpoint、auth/protocol hardening、`user-do.ts` 大型重构、7 天观察、route 撤销，全揉进一个 plan。
2. **phase 依赖有断点**：`S1-P1 修完 → cross-e2e 14/14 → 才允许 S2/S3` 这个 gate 过粗，且和当前 live-gated 测试结构不完全匹配。
3. **部分前提已经变化**：当前代码已经不是 ZX2/ZX3 刚结束时的状态；例如 `/me/sessions` 重复 start 保护已落地、D1 durable truth 已存在、`WORKER_VERSION` 已在 worker shell 与 wrangler 中落地、`FacadeErrorCode` / `RpcErrorCode` 已基本并齐。
4. **仍有关键盲点**：例如 `pending_sessions` 新表设计会和现有 `nano_conversation_sessions` / `nano_conversations` 形成双重真相；`deploy-preview.yml` 在仓库里并不存在；Stream-2 / Stream-3 被描述为“低交集可并行”，但现实里两边都会频繁改 `orchestrator-core/src/{index,user-do}.ts`。

**我的总体判断**：ZX4 应该保留，但要先把 plan 从“一个大统一计划”改成“1 条 blocking 收口主线 + 2 条可拆分 sibling track”。否则执行时会不断改动完成定义，最后 closure 会再次出现“代码部分完成，但口径先关单”的风险。

---

## 1. 审查方法与事实基线

### 1.1 阅读范围

- ZX3 action-plan / closure / ZX4 action-plan 全文。
- 当前真实 worker / package / test / client / workflow 代码。
- 重点核对:
  - `workers/orchestrator-core/src/{index,user-do,session-truth,frame-compat,auth}.ts`
  - `workers/agent-core/src/host/{do/nano-session-do,remote-bindings}.ts`
  - `workers/orchestrator-auth/src/jwt.ts`
  - `packages/{nacp-core,nacp-session,orchestrator-auth-contract}/src/**`
  - `clients/web/src/client.ts`
  - `clients/wechat-miniprogram/utils/nano-client.js`
  - `test/shared/live.mjs`
  - `.github/workflows/{workers,publish-nacp}.yml`

### 1.2 当前真实拓扑

- 当前真实 `workers/` 仍是 6-worker：`agent-core` / `bash-core` / `context-core` / `filesystem-core` / `orchestrator-auth` / `orchestrator-core`。
- 当前 `packages/` 为 6 个 keep-set：`eval-observability` / `nacp-core` / `nacp-session` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts`。
- 当前 live e2e 的公共入口只有 `orchestrator-core`；`test/shared/live.mjs` 已明确默认只保留 `orchestrator-core` 公网 URL，leaf workers 通过 facade 间接验证。
- 当前 transport profile 文档中，`internal-http-compat` 仍是 `retired-with-rollback`，`session-ws-v1` 仍明确是 lightweight `{kind,...}` wire，而不是直接上 NACP frame wire。

### 1.3 本次核对到的关键代码事实

1. **catalog 路由已存在，但内容仍是空数组占位**  
   `workers/orchestrator-core/src/index.ts:410-433`

2. **`POST /me/sessions` 已 server-mint UUID，但 create 时仍未写 D1 pending truth**  
   `workers/orchestrator-core/src/index.ts:447-500`

3. **同一个 `session_uuid` 的重复 start 已 409 拒绝**  
   `workers/orchestrator-core/src/user-do.ts:960-987`

4. **`/me/sessions` 当前来自 User DO 热索引，不是 pending truth + active truth 合并视图**  
   `workers/orchestrator-core/src/user-do.ts:1593-1623`

5. **D1 durable truth 已经存在，不是空白地带**  
   `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:1-98`  
   `workers/orchestrator-core/src/session-truth.ts:113-250,593-668`

6. **usage endpoint 仍是 shape 已冻结、预算字段仍为空值的中间态**  
   `workers/orchestrator-core/src/user-do.ts:1466-1493`

7. **permission decision 仍只是“记录决定”，未真回流到运行中的 resolver**  
   `workers/orchestrator-core/src/user-do.ts:1522-1564`

8. **WS server frame 仍只是 lightweight wire；`emitServerFrame()` 仍是未来 plumbing seam**  
   `workers/orchestrator-core/src/user-do.ts:1447-1464`  
   `workers/orchestrator-core/src/frame-compat.ts:1-129`

9. **parity log 现在只打 status，不打 body diff**  
   `workers/orchestrator-core/src/user-do.ts:237-258`

10. **R28 对应的 cancel 路径当前仍是 `call()` 后再发单独 `cancel()`**  
    `workers/agent-core/src/host/do/nano-session-do.ts:1617-1699`  
    `workers/agent-core/src/host/remote-bindings.ts:247-331`

11. **`WORKER_VERSION` 已经被各 worker shell 响应使用，wrangler 中也有静态值，但仓库并没有 ZX4 plan 所写的 deploy workflow**  
    `workers/orchestrator-core/src/index.ts:73-83`  
    `workers/orchestrator-core/wrangler.jsonc` / 其他 worker `wrangler.jsonc`  
    `.github/workflows/` 当前只有 `workers.yml` 与 `publish-nacp.yml`

12. **`jwt-shared` 尚不存在，且 orchestrator-core / orchestrator-auth 仍各自复制 JWT helper**  
    `workers/orchestrator-core/src/auth.ts:62-149`  
    `workers/orchestrator-auth/src/jwt.ts:19-175`

13. **`FacadeErrorCode` / `RpcErrorCode` 现已高度对齐，但当前只有 `AuthErrorCode ⊂ FacadeErrorCode` 断言，没有 `FacadeErrorCode ⊂ RpcErrorCode` 的跨包编译期断言**  
    `packages/orchestrator-auth-contract/src/facade-http.ts:39-94`  
    `packages/nacp-core/src/rpc.ts:43-151`

14. **web / wechat client 目前都在手写 heartbeat / resume / ack 行为，没有真正切到 `@haimang/nacp-session` helper**  
    `clients/web/src/client.ts:191-220`  
    `clients/wechat-miniprogram/utils/nano-client.js:44-133`  
    `packages/nacp-session/src/{heartbeat,replay}.ts`

### 1.4 本次抽样验证

- `pnpm test:contracts` → 通过
- `pnpm test:cross-e2e` → 当前为 **1 pass + 13 skip**
- `pnpm --filter @haimang/orchestrator-core-worker test` → `42 passed`
- `pnpm --filter @haimang/orchestrator-auth-worker test` → `8 passed`
- `pnpm --filter @haimang/agent-core-worker test` → `1057 passed`
- `pnpm --filter @haimang/nacp-core test` → `289 passed`
- `pnpm --filter @haimang/nacp-session test` → `146 passed`

---

## 2. 我对 ZX4 scope 的总体判断

ZX4 现在的 scope 里，至少混入了 4 种不同性质的工作：

| 类型 | 代表项 | 是否应阻塞 `internal-http-compat -> retired` |
|---|---|---|
| **transport 真收口** | R28 / R29 / parity body diff / P3-05 flip / R31 | **是** |
| **session 语义补完** | permission round-trip / usage live push / `/me/sessions` pending truth | **部分是** |
| **协议 / auth 卫生** | `jwt-shared` / error enum assert / envelope 收敛 | **不是全部都必须** |
| **产品面扩展** | catalog content / `/me/conversations` / `/messages` / `/files` / `/devices/revoke` | **不是** |

这意味着：**ZX4 现在不是一个单一“transport finalization”计划，而是一个 mixed mega-plan。**

如果继续用现在的 DoD，执行者很容易在两种坏结果之间摇摆：

1. 要么为了关单，把一堆“部分落地”的项目一起写成 done；
2. 要么因为 scope 太大，transport 主线已经可以收口，但 closure 永远等着 product endpoints / refactor / JWT hygiene 一起完成。

所以我认为 **ZX4 应该保留主标题，但必须先重切 blocking / non-blocking 边界**。

---

## 3. 主要问题：盲点与断点

## 3.1 Critical — 现在的 ZX4 把“阻塞收口项”和“产品增强项”绑死了

ZX4 标题叫 `Transport Finalization`，但正文 DoD 已经包含：

- transport rollback 真翻转；
- permission / usage / elicitation round-trip；
- catalog content；
- 4 个产品型 endpoint；
- heartbeat client；
- WORKER_VERSION CI；
- `user-do.ts` 拆分；
- D1 pending truth；
- `jwt-shared`；
- envelope / error enum 收敛。

这不是一个单点 close plan，而是 **transport + protocol + product + refactor 的捆绑 closure**。

**建议**：至少拆成下面三层语义。

1. **ZX4-A / Blocking Close**  
   R28 / R29 / parity body diff / targeted live verify / P3-05 flip / R31
2. **ZX4-B / Session Semantics**  
   permission / usage / elicitation / `/me/sessions` pending truth / 必需 session read-model
3. **ZX4-C / Protocol-Auth Hygiene**  
   `jwt-shared` / `FacadeErrorCode ⊂ RpcErrorCode` assert / client helper migration

而 catalog content 与产品型 endpoints，更像 **产品面 backlog**，不应该再被包装成 transport finalization 的硬门槛。

## 3.2 High — `S1-P1 完成前必须 cross-e2e 14/14` 这个 gate 过粗，且会把不属于 P1 的问题混进来

当前 `pnpm test:cross-e2e` 的真实结构是：

- 总计 14 个 live test；
- 默认本地只跑出 `1 pass + 13 skip`；
- 其中包含 real LLM smoke、session full lifecycle、public facade roundtrip 等多类不同性质测试。

这意味着 `14/14` 不是一个纯粹属于 R28/R29 的 gate，而是一个 **把外部环境、预算、live token、其他 feature readiness 全绑进去的总门槛**。

如果继续沿用现在的 phase 设计，就会出现两个问题：

1. **P1 的 bugfix 成功与否，被 unrelated live case 绑架**；
2. **S2/S3 被 P1 的“全绿 gate”人为阻塞，但这些 stream 里又有不少项本身就是让那 14 个 live case 变绿的前提。**

**建议**：把 gate 改成两层：

- **P1 exit gate**：只要求 R28 / R29 的 targeted preview reproduction + targeted smoke 通过；
- **whole-plan exit gate**：才要求 live suite / parity observation / P3-05 flip。

## 3.3 High — Q2 把 Stream-2 / Stream-3 判断为“交集小可并行”，这和当前代码事实不符

从当前代码看，下面这些任务都会集中改同一个热点面：

- `workers/orchestrator-core/src/index.ts`
- `workers/orchestrator-core/src/user-do.ts`
- `workers/orchestrator-core/src/session-truth.ts`
- session / auth / client 对应测试

尤其是：

- S2-P3 `WS round-trip`
- S2-P4 `product endpoints`
- S2-P6 `user-do refactor`
- S3-P7 `pending truth`

这几项并不是“低交集”。相反，它们会 **同时触碰 user-do / session truth / facade route / tests**。

所以我不同意把 **整个 Stream-2 和整个 Stream-3** 当作可并行单元。

更合理的是：

1. **串行处理会改 `user-do` / session truth 的 phase**  
   S2-P3 / S2-P4 / S2-P6 / S3-P7 不应并行
2. **只把低交集子项并行化**  
   例如 `jwt-shared`、enum assert、client helper migration、catalog content 文档同步

## 3.4 High — S3-P7 的 `pending_sessions` 新表设计与现有 durable truth 体系冲突，存在“双真相”风险

这是我认为 ZX4 草案里**最需要立即改写**的一点。

当前 orchestrator-core 已经有完整 durable truth 体系：

- `nano_conversations`
- `nano_conversation_sessions`
- `nano_conversation_turns`
- `nano_conversation_messages`
- `nano_conversation_context_snapshots`
- `nano_session_activity_logs`

`handleStart()` 也已经在 start 时接入 D1 durable truth。  
因此，ZX4 若再新增一个独立 `pending_sessions` 表，就会造成：

1. create path 的 pending 真相在 A 表；
2. start 后的 active / ended 真相在 B 表；
3. `/me/sessions` 需要跨两套 schema merge；
4. TTL / GC / conversation ownership / replay/history 查询逻辑被拆成两套。

**我不建议引入一张平行的 `pending_sessions` 表**。  
更合理的做法是：

- 要么在现有 `nano_conversation_sessions` 扩展 `pending` 状态；
- 要么在现有 durable truth 体系内加一层 create-stage record，但仍然归属同一 session truth model。

否则 ZX4 会把 session truth 从“尚未完整”升级成“结构性碎片化”。

## 3.5 Medium — `WORKER_VERSION CI` 的 operational 落点并不存在

ZX4 草案写的是：

- `.github/workflows/deploy-preview.yml`
- deploy step 注入 `WORKER_VERSION = worker-name@${GITHUB_SHA}`

但当前仓库里并没有这个 deploy workflow；`.github/workflows/` 只有：

- `workers.yml`
- `publish-nacp.yml`

这意味着 `WORKER_VERSION CI 动态化` 不是“改一下已有 workflow”这么简单，而是：

1. 先确认 preview / live 部署到底在哪里执行；
2. 再决定是 GitHub Actions 注入，还是外部 deploy pipeline 注入；
3. 最后才谈 worker env-fill。

所以这个工作项**不是代码内 phase**，而是 **deployment discipline / owner-operated pipeline** 问题。  
ZX4 如保留此项，应该显式标成 **ops prerequisite / owner-required**，而不是默认的普通工程任务。

## 3.6 Medium — product endpoints 与 catalog content 不应成为 transport finalization 的 closure blocker

当前代码和 docs 已经明确：

- `catalog` route 已存在，且 shape 已冻结；
- `clients/api-docs/catalog.md` 也已明确“当前返回空数组，占位但稳定”；
- web / wechat client 也已经能调用现有 catalog route。

因此 `catalog content fill` 是**业务内容补足**，不是 transport 真收口的 blocker。

同理：

- `/me/conversations`
- `/sessions/{id}/messages`
- `/sessions/{id}/files`
- `/me/devices/revoke`

这些是产品面 capability，不是 rollback 窗口关闭的必要条件。

如果坚持放在 ZX4，也建议改成：

- **ZX4-transport-close**：不阻塞它们；
- **ZX4-business-surface**：单独跟踪。

## 3.7 Medium — `user-do.ts` refactor 的 phase 放得过晚，容易把所有变更都堆到单体热点上

我同意 `user-do.ts` 必须拆；当前它确实承担了太多角色：

- facade action dispatch
- session lifecycle
- parity bridge
- ws attachment
- usage / permission / policy
- hot index / durable truth hydration

但如果把 refactor 放在 **S2-P6，且位于 P3/P4/P5 之后**，结果通常是：

1. 先让前面几个 phase 全部继续往大文件里塞逻辑；
2. 最后再一次性抽骨架；
3. 导致最后的 refactor 变成“高风险大手术”。

更稳的做法是二选一：

1. **早期做轻量 seam extraction**：先把 read-model / ws / parity helper 抽出去；
2. **明确它不是 closure blocker**：让 refactor 独立成 hygiene track，而不是 transport close 的硬条件。

## 3.8 Medium — client heartbeat / replay 的目标写得不够清楚，容易保留“两套实现”

当前 repo 的真实状态是：

- `@haimang/nacp-session` 已经提供 `HeartbeatTracker` / `ReplayBuffer`
- 但 web / wechat client 仍然在各自手写 heartbeat / resume / ack

所以 ZX4 如果只写“客户端集成 heartbeat / replay”，执行时很容易出现两种结果：

1. 只是把现有手写代码再补一点；
2. 或者真正切到 shared helper。

这两种结果差异很大。  
**建议在 plan 里直接冻结目标**：是“替换为 shared helper”，还是“继续手写但只做行为对齐”。否则 ZX4 执行后依旧会留下 duplicated client logic。

## 3.9 Medium — envelope / error enum 任务应写成“单向约束 + 不改 public wire”，而不是泛泛的“收敛”

当前仓库已经处在一个中间态：

- `nacp-core` 有 `Envelope<T>` / `RpcErrorCode`
- `orchestrator-auth-contract` 有 `FacadeEnvelope<T>` / `FacadeErrorCode`
- 当前已有 `AuthErrorCode ⊂ FacadeErrorCode` 断言
- 但还没有 `FacadeErrorCode ⊂ RpcErrorCode` 的跨包编译期断言

因此 ZX4 若继续写“envelope 三 type 收敛”，容易让执行者误以为要大规模改 public contract。

更稳的写法应是：

1. **public facade wire 不变**；
2. `FacadeEnvelope<T>` 保持 public alias / public schema；
3. 新增 `FacadeErrorCode ⊂ RpcErrorCode` 编译期断言；
4. 只收紧“单一来源与编译期关系”，不强推 public wire 改名。

---

## 4. 对 ZX4 阶段设计的修订建议

如果不另开 sibling plan，我建议至少把 ZX4 内部改写成下面的逻辑：

### 4.1 Lane A — Blocking Close（唯一 blocker lane）

只包含真正阻塞 `internal-http-compat: retired` 的项：

1. R28 cancel 路径修复
2. R29 parity body shape 修复
3. parity log body diff
4. targeted preview smoke
5. 7 天 parity 观察
6. P3-05 flip
7. R31 route / workers_dev operational cleanup

### 4.2 Lane B — Session Semantics

只处理 session 语义闭环，不混入产品扩表：

1. permission round-trip
2. usage live push + snapshot 真预算
3. elicitation round-trip
4. `/me/sessions` pending truth（基于现有 durable truth 扩展，不另起平行表）
5. 必需 read-model（如 conversations/sessions 视图）

### 4.3 Lane C — Protocol/Auth Hygiene

1. `jwt-shared`
2. `FacadeErrorCode ⊂ RpcErrorCode`
3. facade alias / envelope 关系文档化
4. web / wechat client helper 归并

### 4.4 Lane D — Product Surface（不阻塞 transport close）

1. catalog content fill
2. `/messages`
3. `/files`
4. `/me/conversations`
5. `/me/devices/revoke`

这样改完后，ZX4 closure 才会有清晰语义：

- **A 完成**：transport 真收口
- **B 完成**：session 语义闭环
- **C 完成**：协议/auth 卫生完成
- **D 完成**：产品面扩展完成

而不是继续用一个 closure 同时声明四件不同的事情。

---

## 5. 对 Q1-Q4 的回答

### Q1 — R28 修复方案是否冻结为 AbortController 同 fetch 链(不重构 transport)?

**我的回答**：**同意“先不做 transport 大重构”，但不同意把实现文字过早冻结成现在这句 AbortController 表述。**

原因：

- 当前真实路径已经不只是旧 fetch compat，还包含 `rpc.call()` + `rpc.cancel()` 两步；
- `bash-core` 内部本身已经有 `AbortController` / executor cancel seam；
- 真正应冻结的是**结果约束**，不是单一实现名词。

我建议把 Q1 改写成：

> **R28 必须改成“取消与执行处于同一请求生命周期 / 同一运行链条”，不得依赖第二条独立 cancel request 作为 preview 主路径；本次不做大 transport 重构。**

也就是说：**同意“先不重构 transport”**，但不建议把 plan 文本写死为某个单一代码手法。

### Q2 — Stream-2 + Stream-3 是否同意并行启动(在 S1-P1 后)?

**我的回答**：**不同意按“整个 Stream”粒度并行。**

原因很简单：当前代码热点并不小。

- S2-P3 / P4 / P6 会改 `orchestrator-core/src/{index,user-do}.ts`
- S3-P7 也会改 `index.ts` / `user-do.ts` / session truth / migrations

这不是“交集小”，而是**交集很大**。

我只同意：

- **低交集子项并行**
  - 例如 `jwt-shared`
  - enum/assert
  - client helper migration
- **高交集子项串行**
  - WS round-trip
  - pending truth
  - `user-do.ts` refactor
  - 会写 route / session truth 的 read-model endpoint

所以 Q2 我给出的明确意见是：**不同意整 stream 并行；同意 phase-by-phase 的细粒度并行。**

### Q3 — `user-do.ts` 拆分按 4 模块还是 3 模块?

**我的回答**：**同意 4 模块，但不要被“每个 ≤ 500 行”这种表层指标绑架。**

我建议的 4 模块比当前文稿更贴近真实职责：

1. `session-lifecycle`
2. `session-read-model`（status / timeline / history / me-sessions / usage）
3. `ws-bridge`
4. `parity-bridge`（internal fetch/RPC dual-track + parity logging）

原因是当前 `user-do.ts` 的真实复杂度不是单纯来自“WS 附件”或“helper”，而是**读模型、写模型、桥接、transport 兼容**混在一起。

所以我的答案是：**4 模块优于 3 模块，但应按职责 seam 拆，不应按机械行数拆。**

### Q4 — 7 天观察期启动时机 = S1-P1 后 还是 全部 P1-P9 完成后?

**我的回答**：**应在全部会影响 parity/path 行为的代码变更完成后再启动；就当前 draft 来说，更接近 “P1-P9 完成后”。**

原因：

- S2 / S3 里后续很多项仍会改 `orchestrator-core/src/{index,user-do}.ts`
- 有些项还会影响 session read/write shape、WS 行为、auth / envelope surface
- 如果在 S1-P1 后立刻开始观察，后续变更带来的噪声会污染观察窗口

因此我不同意 “S1-P1 后立刻开始 7 天观察”。

更稳的口径是：

> **当所有会影响 parity 结果、transport 路径、session public surface 的代码都冻结后，再启动观察。**

在当前 ZX4 草案结构下，这基本等价于 **P1-P9 完成后再开观察**。

---

## 6. 最终结论

**ZX4 应该做，但不应该按当前 unified draft 直接开工。**

我对它的最终判断是：

- **方向**：正确
- **scope**：过宽
- **phase 设计**：存在断点
- **Q1-Q4 中的默认倾向**：Q1 需改写表述；Q2 不同意整 stream 并行；Q3 同意 4 模块但要换 seam；Q4 同意后置观察
- **是否可直接启动**：**不建议**

如果只允许一句话总结：

> **ZX4 最大的问题不是要做错事，而是把“必须先收口的事”和“可以后收口的事”混成了一份 closure 计划；执行前必须先做一次真实代码状态的 re-baseline 与 blocking / non-blocking 重切。**

