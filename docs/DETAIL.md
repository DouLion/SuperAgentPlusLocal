# SAP Local

单机方向会话与工作会话隔离插件。它把“方向”和“操作现场”分成两个目录层，让总工方向会话只读 `direction/briefs/notes`，不读 `work/` 的日志、diff、复现。

**没有审批。** 不提供 approve/reject、G1/G2/G3、lease/grant/contract；这些属于云端版。

## 命令

| 命令 | 作用 |
|---|---|
| `/sap-init` | 多轮初始化：新项目 / 已有项目；回答完问题后 `finalize` 生成 `direction.md`、`charter.md`、模板与角色 |
| `/sap-init answer <回答>` | 回答当前问题；`/sap-init status` 看进度 |
| `/sap-init status` / `finalize` | 查看进度 / 生成方向文件并完成；只有总工可初始化 |
| `/sap-chief status\|takeover` | 查看总工在线状态；总工离线/过期时接管 |
| `/sap-brief <一句话问题>` | worker 写一页方向 brief；`from <path>` 从文件导入 |
| `/sap-brief-status <brief-id> <open\|resolved>` | 更新 brief 状态 |
| `/sap-note <brief-id> <方向判断>` | chief 写方向 note（不是审批）；`from <path>` 从文件导入 |
| `/sap-notes` | 列出未决 brief 与最近 note |
| `/sap-worklog <内容>` | 追加 `work/<session>/log.md`；总工不读 |
| `/sap-doctor` | 文件级健康检查：方向/角色/gitignore/未决 brief/疑似污染 |
| `/sap-status` | 查看 direction/briefs/notes/角色/未决 brief/work logs |
| `/sap-export [路径]` | 导出方向层（direction/briefs/notes/templates），不含 work |
| `/sap-import <bundle.json> [--replace]` | 导入；默认合并，`--replace` 先备份再覆盖 |
| `/sap-clever` | chief 排污：生成方向摘要包，建议新建会话继续 |
| `/sap-qingshen` | 可选：把 SAP 总工/工作协议写入本机 `dsh-qingshen/modes.json` |

## 操作条（composer 上方）

插件在输入框上方渲染 SAP 操作条：

`SAP  [无角色] [总工] [工作]  [初始化] [重新共识] [写 Brief] [写 Note] [工作日志] [状态] [医生] [总工] [导出] [排污]`

- 默认 **无角色**：该会话不注入协议、不参与 SAP。
- 角色只通过操作条按钮切换；不提供 `/sap-role` 命令。
- 未初始化时先选 **总工**，才会出现“初始化”按钮；worker/无角色不能初始化。
- 点击操作按钮打开面板，表单提交后**必须在面板中显示成功或失败回执**；失败显示 host 返回的 error。
- 面板覆盖：初始化/重新共识、写 Brief、写 Note、工作日志、状态、医生、总工接管、导出/导入、排污。
- 数据通路：`GET /sap-local/overview`、`GET/PUT /sap-local/role`、`POST /sap-local/init-*`、`POST /sap-local/brief`、`POST /sap-local/note`、`POST /sap-local/worklog`、`POST /sap-local/chief`、`POST /sap-local/export`、`POST /sap-local/import`、`POST /sap-local/cleanse`。

## brief / note / worklog

- brief/note 文件带 YAML frontmatter：`id`、`status`（brief）、`session`、`created_at`、`updated_at`。
- brief 默认 `status: open`；`/sap-brief-status` 可改为 `resolved`，`/sap-notes` 只列未决。
- `/sap-brief from <path>` 与 `/sap-note <brief-id> from <path>` 从文件导入正文；路径相对当前会话 cwd。
- `/sap-worklog` 追加到 `work/<session>/log.md`，不进方向层，不导出。
- `/sap-doctor` 只证明文件层状态；它不证明方向正确，也不证明总工上下文未被污染。

## 总工状态与唯一性

- `.sap.local/chief.json` 记录当前总工：`session_id`、`started_at`、`last_seen_at`、`host_pid`。
- 一个工作区同一时刻只允许一个**在线**总工；已有在线总工时，其他会话选“总工”会被拒绝。
- 总工状态：
  - `online`：`host_pid` 匹配且该 session 的 agent 仍在注册表里；
  - `offline`：同一 host 内 agent 已销毁/未恢复；
  - `stale`：host 进程重启过（`host_pid` 不匹配）。
- `agent/created` / `agent/status` 会刷新 `last_seen_at`；`agent/disposed` 后状态转为离线。
- 角色条会在总工 `offline`/`stale`/`none` 时提示；`/sap-chief status` 可查看，`/sap-chief takeover` 或角色条选“总工”可接管。
- `/sap-doctor` 会报告总工是否在线、chief 会话是否超过一个。

## 初始化

- **新项目**：`/sap-init` 自动判断；回答 6 个问题（目标、当前重点、非目标、约束、取舍原则、暂停信号）。
- **已有项目**：`/sap-init existing`；问题偏向现状、已有结构、已生效决策、风险、近期目标、复核触发。
- **重新共识**：`/sap-init reinit`；归档旧 `direction.md/init.json/state.json/chief.json` 到 `archive/reinit-*`，保留 `briefs/notes/work/sessions`，并把旧方向答案按顺序预填。
- **只有总工方向会话可以初始化**；无角色/工作会话会被拒绝。`finalize` 前不要开其他会话正式推进；完成后当前会话是 chief。

## 目录

```text
.sap.local/
├── direction.md
├── charter.md
├── briefs/
├── notes/
├── work/<session>/
├── sessions/
├── templates/
├── detail/
├── exports/
└── backups/
```

`work/` 是操作层；总工方向会话不读。brief 一页，不含日志/diff/stack trace。

## 注入方式

- 插件在 `agent/session-start` 时按角色给当前 agent 注册一个 `systemPrompt.section`（order 80），不写入聊天历史。
- 角色来自 `.sap.local/sessions/<session-id>.json`；没有 `.sap.local` 时不注入。
- host 按 `sessionId` 解析项目根：先查会话缓存，再用 `workspaceRegistry` 反查工作区路径，最后回退到会话 cwd。
- 插件卸载时会释放 section；agent 销毁时由 agent 作用域自动清理。

## 与 dsh-qingshen 的关系

本机已安装 `dsh-qingshen` 2.2.0。它在 `agent/pre-step` 把 `modes.json` 里的文本追加到最后一条人类消息，文本进入历史；适合“每轮提醒”，但不是隔离边界。

- 默认：本插件用 `systemPrompt.section` 自动按角色注入，不进入历史。
- 可选：`/sap-qingshen` 把 `SAP 总工` / `SAP 工作` 两个模式写入 qingshen 的 `modes.json`，然后刷新页面、按会话选择。
- **二选一**：同时用 section 和 qingshen 会重复注入。
- qingshen 的注入不提供锁/权限，也不能阻止会话读 `work/`。

## 限制

- 单机、单用户；不做多人审批。
- 不替代 Git/CI；不自动执行代码。
- `systemPrompt.section` 不可用时只记录警告，不强行注入。
- `sap-clever` 不能删除旧会话历史；它生成方向摘要包，真正排污需要新建会话。
- 插件不依赖 `dsh-qingshen`；但可选择与它配合（`/sap-qingshen`）。

## 参考实现

- DSH 命令注册：`@deepseek-ai/dsh-commands` 的 `ctx.commands.register`。
- DSH 提示注入：`@deepseek-ai/dsh-system-prompt` 的 `ctx.systemPrompt.section` / agent 作用域。
- 工作区指令插件：`@deepseek-ai/dsh-agent-instructions` 的 `agent/pre-step` + 持久 user-role 注入（本插件不用它，避免把协议写进聊天历史）。
- qingshen 的 `agent/pre-step` 追加实现：`$DSH_HOME/plugins/dsh-qingshen\index.js`（本机 2.2.0）。
- Claude Code 的 SessionStart hook 也采用“启动时注入上下文”的模式；本插件选择 agent 作用域 section，避免历史污染。
- 详细调研与代码位置见 `docs/RESEARCH.md`。
