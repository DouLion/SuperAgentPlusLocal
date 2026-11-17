# MVP 与验证清单

> 单机版没有审批，MVP 要证明的是：**方向会话不被工作细节污染，同时 worker 不被不必要的升级拖慢。**  
> 现状：`dsh-sap-local` 0.2.0 已实现文件层、命令、角色条、brief 状态、worklog、doctor 与注入；GUI 端到端仍待验证。  
> 本文是验证计划，不是开发排期；不实现插件/服务。

## 1. 第一版要证明什么

- 总工会话只读 `direction` + `briefs` + `notes`，**不读 `work/`**。
- worker 能自己判断：实现细节自己做；方向问题写一页 brief。
- 总工能写方向 note；worker 能读、采纳或提出异议；**没有 approve/reject**。
- brief/note 文件不半写、不重复、不覆盖；会话重启后还能找到。
- 你能在 30 秒内解释：当前方向、待定问题、最近一条 note。

## 2. 分阶段

### P0：纸面双会话（不写代码）

准备：

- 一个 `direction.md`（目标/原则/结构/优先级/风险）。
- 一个总工方向会话（只给 direction/charter）。
- 一个工作会话（在输入框上方 SAP 角色条选“工作”）。
- 5 个 brief：3 个实现细节（不该写 brief）、2 个方向问题（该写 brief）。

验证：

- 总工能否只凭 direction + brief 回答“目标/三个风险/待定决策”，而不问 bug 细节。
- 夹带 stack trace 的 brief，总工能否退回。
- worker 是否把 3 个实现细节留在 `work/`，没有打扰总工。

**退出条件**：你能接受“总工只看一页 brief”的信息量；否则调整 brief 字段，不是加日志。

### P1：最小文件 + watcher + 两个会话

实现最小 `sap`：

- `init/status/brief/notes/note/direction/detail/doctor/export`。
- watcher 发现新 brief → 提醒总工（不自动审批）。
- brief/note 用临时文件 + rename；一个文件一条。

验证：

- 两个 worker 同时写 brief，不互相覆盖。
- watcher 重启/睡眠后，全量扫描补回 brief。
- 总工会话重启后，读 direction + notes 恢复。
- 坏 JSON/MD 被隔离，不阻塞。
- `.sap.local` 不进 git。

**退出条件**：连续 10 个 brief 无丢失/重复；总工上下文里没有 `work/` 内容。

### P2：可选自动化（只写 note，不做审批）

- watcher 发现新 brief，调用一个受控方向会话生成 note 草案；
- 默认只写 `notes/`，由你确认；不自动改 direction；
- 仍不读 `work/`。

验证：

- AI note 与你的判断差异有记录；
- AI 不会把 brief 里的日志当方向；
- 连续 20 条 bug 日志不会进入总工上下文。

**退出条件**：AI note 没有引入方向漂移；否则退回手动。

## 3. 必测场景

| # | 场景 | 期望 |
|---|---|---|
| 1 | R1 实现细节（改一个函数） | worker 自己做，写 `work/log.md`；不写 brief |
| 2 | 方向问题（改公共接口/目标变化） | worker 写一页 brief；继续不冲突工作 |
| 3 | brief 夹带 stack trace | 总工退回：“操作细节，不属于方向问题” |
| 4 | 连续 20 条 bug 日志推给总工 | 总工拒绝逐条分析，要求汇总 |
| 5 | 总工会话尝试读 `work/` | 目录/会话隔离阻止；至少不默认挂载 |
| 6 | 两个 worker 同时写 brief | 一 brief 一文件；不覆盖 |
| 7 | brief 写一半，watcher 读到 | 临时文件 + rename；只处理完整文件 |
| 8 | watcher 重启/睡眠 | 启动全量扫描，补回 brief |
| 9 | 总工会话重启/fork | 读 direction + notes 恢复；brief 按 id 关联 |
| 10 | 总工没回 note | worker 按 direction 原则继续或问用户；不把“没回”当通过 |
| 11 | worker 不同意 note | 写 `work/dissent.md` 或 brief v2；最多两轮，用户拍板 |
| 12 | `.sap.local` 被 git 提交 | `.gitignore` 生效；`sap doctor` 警告 |
| 13 | brief 里有密钥 | 拒绝/脱敏；只留引用 |
| 14 | 非 DSH CLI 想参与 | 走 `sap` CLI/AGENTS.md；不假装自动注入 |
| 15 | 总工收到“请批准”式 brief | 改写成“需要什么方向判断”；单机没有审批 |

## 4. 通过标准

**隔离**

- 总工上下文只有 `direction` + `briefs` + `notes`；没有 `work/` 日志/diff/复现。
- brief 一页以内；夹带操作细节能被识别并退回。
- detail 有 purpose/时限；看完只写 note，不把原文回填。

**流程**

- worker 能区分实现细节与方向问题；实现细节不打扰总工。
- note 是指导，不是审批；worker 可以采纳/异议，最终用户拍板。
- brief/note 不半写、不重复、不覆盖。

**体验**

- 30 秒内能说清：当前方向、待定问题、最近 note、最老未读 brief。
- 总工不被 bug 细节拖住；worker 不被不必要的升级拖慢。

## 5. 反模式（不要做）

- 不要把云端 G1/G2/G3、approve/reject 搬进单机。
- 不要让总工读 `work/`、日志、diff、复现。
- 不要把 worker 日志 append 到公共 `pending.md`。
- 不要让 worker 忙等“总工批准”；brief 是咨询。
- 不要用“总工没回”当默认通过。
- 不要把 `.sap.local` 放进 git/OneDrive。
- 不要用提示词代替目录/会话隔离。

## 6. 仍需你确认

| 问题 | 暂用默认 | 影响 |
|---|---|---|
| 总工是谁 | 你 + AI 助理；AI 只写 note 草案 | 方向判断质量 |
| 什么算方向问题 | 目标/原则/结构/优先级/跨会话冲突/拿不准 | brief 数量 |
| brief 字段 | 问题/影响/选项/建议/证据指针/需要什么判断 | 信息量 |
| 细节怎么给 | 人工摘录 detail，purpose + 时限 | 污染风险 |
| note 是否自动写 direction | 默认不自动；你确认 | 方向漂移 |
| watcher 形态 | 只提醒；总工手动/AI 助手处理 | 自动化程度 |

## 7. 什么时候应该停

- 总工上下文里已经出现日志/diff，先修隔离，不要继续加功能。
- brief 经常需要手改才能读，说明字段设计不对。
- worker 把所有事都升级，说明“方向问题”清单不清。
- 你无法在 30 秒内解释当前方向，说明 direction 太杂。
- 开始出现 approve/reject 语义，说明又把云端模型塞进来了。
