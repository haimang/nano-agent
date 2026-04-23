# W3 Absorption Pattern Spec

> 状态：pre-worker-matrix / W3 配套子文档  
> 配套主文：`W3-absorption-blueprint-and-dryrun.md`、`W3-absorption-map.md`

## 1. 文档目的

map 解决“去哪里”，blueprint 解决“这个代表样本怎么搬”。  
本文件解决的是第三个问题：

**当 worker-matrix 开始真实吸收时，哪些共通模式必须统一，否则不同 worker 会各自发明一套迁移方法。**

## 2. Pattern 1 — owner-first，不做“半吸收半共享”的暧昧状态

每个 absorption unit 在某个时点只能有一个主 owner：

- `agent-core`
- `bash-core`
- `context-core`
- `filesystem-core`

在共存期里，旧 package 可以继续存在，但它只是**迁移来源 / 兼容来源**，不再和目标 worker 共同声称自己是长期 owner。

## 3. Pattern 2 — contract 留在 NACP，runtime 去 worker

worker absorption 期间，不得把以下内容跟着 package 一起私有化：

1. `nacp-core` 的 canonical wire vocabulary
2. `nacp-session` 的 session edge legality
3. W1 RFC 里冻结的跨 worker contract 方向

也就是说：**worker 吸收的是 runtime residual，不是再造协议中心。**

## 4. Pattern 3 — split package 先按职责切，不按文件数量切

`workspace-context-artifacts` 是最典型样本。它的拆分顺序必须是：

1. 先分清 context / filesystem / mixed helper 三类职责
2. 再决定文件挪哪里

不能因为“某个目录文件多”就把它当成一个整体塞给单一 worker。

## 5. Pattern 4 — 直接 import 少，不代表吸收简单

`capability-runtime` 的代表意义就在这里：

- **package.json `dependencies: {}`(实测零)**;src/test 中也没有任何 `@nano-agent/*` 或 `@haimang/*` 形式的 cross-package import
- 但 fake-bash surface、policy gate、partial disclosure、remote target seam、honest-partial 纪律都很重
- source + test LOC 合计 ~9473,体量本身也足够 battle-test 搬迁流水线

所以 worker-matrix 期间不能用 "npm graph 很轻" 或 "dependencies 空" 来判断吸收复杂度。**真正的循环引用 / 跨 worker seam 样本在 `workspace-context-artifacts` split,不在 capability-runtime**。

## 6. Pattern 5 — 共存期 bugfix 先修原包，再同步新落点

只要旧 package 仍是当前 consumer 的真实来源：

1. bugfix 先修原包
2. 如果已有 worker dry-run/landing，再同步过去

不要反过来只修 worker 侧副本，让旧 package 留着已知错误继续服务现有测试与 consumer。

## 7. Pattern 6 — root cross tests 继续留在 root

吸收后不要把所有测试都搬进 worker 包里。至少以下测试类型应继续留在仓库根：

1. protocol contract tests
2. cross-package / cross-worker contract tests
3. end-to-end / verification ladder tests

worker 内适合拥有的是：

- package-local unit tests
- deploy-shaped smoke
- worker-local integration tests

## 8. Pattern 7 — deprecated banner 不是 pre-worker-matrix 的工作

本阶段 blueprint 可以写清楚 deprecated 时机，但**不在现在提前加 banner**。  
真正加 `DEPRECATED` 的时点，应是 worker-matrix 中该 worker 完成真实吸收、consumer path 已切换之后。

## 9. Pattern 8 — honest partial / unsupported 语言必须原封保留

迁移时不能因为进了 worker 就把这些能力自动升格：

1. `mkdir`
2. restricted `curl`
3. `ts-exec`
4. readonly `git`
5. search bounded output

worker landing 只改变 owner 与部署位置，不改变成熟度 truth。

## 10. Pattern 9 — evidence sink owner 与 evidence builder owner 分开看

尤其在 `workspace-context-artifacts` split 场景中：

- evidence builder 可能跟随 context/filesystem slice 吸收
- 但 evidence sink / durable persistence owner 仍更接近 `agent-core` / eval plane

因此不要因为某个 helper 里有 `emit*Evidence()`，就机械断定整块代码都应归 `agent-core`。

## 11. Pattern 10 — blueprint 只解决 landing，不替代 action-plan

blueprint 必须回答：

1. 源路径去哪里
2. 依赖如何分
3. 测试如何承接
4. 哪些风险不在本次处理

但 blueprint **不应**承担：

1. 执行排期
2. phase checklist
3. rollout / rollback 脚本
4. code-review gate

这些属于后续 action-plan。

## 12. 一句话 verdict

这份 pattern spec 的价值，是让 worker-matrix 的实现从第一天起就建立在统一迁移方法上：**同一套 owner discipline、同一套 test discipline、同一套 partial disclosure discipline、同一套 deprecated timing discipline。**
