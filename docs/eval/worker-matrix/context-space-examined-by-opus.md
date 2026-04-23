# Worker-Matrix 上下文空间审查 — Opus Review Recalibrated

> **Origin**: `2026-04-21` independent Opus review
> **Current role**: preserve the still-valid judgment from that review after pre-worker closure and the 2026-04-23 refresh of the entire worker-matrix eval tree
> **Last refreshed**: `2026-04-23`

---

## 0. 一句话结论

**Opus 当时指出的 4 个关键补丁方向是对的，而且现在都已经落地；因此这份文件不再是“施工前仍待补齐的 blocker 清单”，而是一份对方法论、结构完整性与 conservative-first 基调仍然有效的独立审查记录。**

---

## 1. 原始审查里哪些判断仍然成立

下面这些结论在今天仍然成立，而且仍值得保留：

1. **5-doc-per-worker scheme 是好的结构**
2. **证据优先级纪律是这个上下文包最有价值的工程纪律之一**
3. **conservative-first / 薄做** 是 worker-matrix 最应该保持的设计基调
4. **cross-worker 视角、global readiness 视角、`skill.core` deferral discoverability** 的确需要根目录层文档来承接

换句话说，Opus 审查抓到的问题不是错了，而是它们现在已经从“待补丁”变成“已吸收成新的根目录真相层”。

---

## 2. 原始审查里哪些判断现在已被 supersede

### 2.1 “meta-doc 仍 stale” 已不再是当前事实

`00-contexts/` 现在已经整体重建，direct gate truth 已切到：

1. pre-worker final closure / handoff
2. current worker/code reality
3. W3 absorption map / blueprints

所以原始审查里对旧 meta-doc 漂移的批评，今天应视为**历史上成立、现在已整改**。

### 2.2 “还缺 cross-worker matrix / readiness / skill note” 已不再成立

原始 4 个补丁项现在都已有对应物：

| 原始缺口 | 当前状态 |
|---|---|
| meta-doc 同步 | 已由刷新后的 `00-contexts/` 承接 |
| cross-worker interaction matrix | 已由 `cross-worker-interaction-matrix.md` 承接 |
| global readiness stratification | 已由 `worker-readiness-stratification.md` 承接 |
| `skill.core` discoverability gap | 已由 `skill-core-deferral-rationale.md` 承接 |

### 2.3 “4 worker 仍缺 deploy shell” 已不再是当前入口判断

W4 已经 materialize 了：

1. `workers/agent-core`
2. `workers/bash-core`
3. `workers/context-core`
4. `workers/filesystem-core`

因此今天的根问题已经从：

> “这些 worker 是否存在？”

转成了：

> “这些已存在 shell 应按什么吸收顺序和 wiring 顺序进入 r2？”

---

## 3. 今天仍值得保留的独立评价

### 3.1 结构评价仍然高

Opus 对这套文档方法论最重要的肯定仍然成立：

1. worker 视角切分比一份超大总文档更稳
2. `index / realized / internal / external / cloudflare` 五分法确实降低了认知噪声
3. “当前应冻结的判断 + 当前仍开放的 gap” 的写法很适合后续 charter 消费

### 3.2 诚实度评价仍然成立

今天整棵 `docs/eval/worker-matrix/` 仍然最可贵的地方，是没有把项目写成：

1. “一切都已 closed”
2. 也没有写成 “什么都还没准备好”

它保留的是中间态：

> substrate 和 worker shell 已经足够成熟，真正剩下的是 absorption / assembly / wiring。

### 3.3 conservative-first 仍然是正确基调

这一点今天反而更重要，因为 4 个 worker shell 已经真实存在，最容易发生的新错误就是：

1. 因为 shell 存在，就误以为 remote runtime 已经该全部展开
2. 因为 context/filesystem 进入 first wave，就误以为必须立刻给它们发明重型 RPC
3. 因为 `skill.core` 有名字，就误以为应该补成第五个 first-wave worker

Opus 当时对“薄做”的强支持，今天依旧完全成立。

---

## 4. 现在应该如何使用这份文件

今天的正确用法是：

1. **把它当作独立 review 的 ancestry 记录**
2. **把它当作对整个文档方法论的第三方肯定**
3. **把它当作对“为什么根目录层还需要 derived docs”的解释**

今天的错误用法是：

1. 把它当作当前 gate truth
2. 把它当作比 `00-contexts/` 或 4 worker packs 更高的优先级
3. 继续把它里面的“待补丁”语言当成 live blocker

如果这里与当前代码、`00-contexts/`、或刷新后的 worker/root docs 冲突，**以当前刷新后的真相层为准**。

---

## 5. 对 r2 rewrite 的 surviving takeaway

把原始 Opus 审查压缩成今天仍然有效的 5 条 takeaway，就是：

1. 4 worker pack 的整体结构是可用的
2. 证据优先级纪律必须继续保留
3. cross-worker derived docs 是必须的，而不是可选附件
4. `skill.core` 的 defer 必须显式写出
5. worker-matrix r2 应继续坚持 conservative-first，而不是 scope 爆炸

---

## 6. 最终 recalibrated verdict

如果今天重新给这份 Opus 审查一个简化 verdict，它应是：

> **原始审查结论方向正确；原始指出的 4 个根目录缺口现在已全部吸收；该文件保留为历史独立审查与方法论证据，而不再承担当前施工 gate。**
