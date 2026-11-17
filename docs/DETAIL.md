# SAP Local

单机方向会话与工作会话隔离插件。它把“方向”和“操作现场”分成两个目录层，让总工方向会话只读 `direction/briefs/notes`，不读 `work/` 的日志、diff、复现。

**没有审批。** 不提供 approve/reject、G1/G2/G3、lease/grant/contract；这些属于云端版。

## 命令

| 命令 | 作用 |
|---|---|
| `/sap-init` | 多轮初始化：新项目 / 已有项目；回答完问题后 `finalize` 生成 `direction.md`、`charter.md`、模板与角色 |
| `/sap-init answer <回答>` | 回答当前问题；`/sap-init status` 看进度 |
| `/sap-role none\|chief\|worker` | 设置当前会话角色；新会话默认“无角色”，不参与 SAP |
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

## 角色条

插件在输入框上方（`conversation.input.dock`）显示：

`SAP  [无角色] [总工] [工作]   saved`

- 默认 **无角色**：该会话不注入协议、不参与 SAP。
- 选择“总工/工作”后，host 把角色写入 `.sap.local/sessions/<session-id>.json`，并按角色注入 section。
- 角色按会话记住；切回“无角色”会移除 section。
- 未初始化时显示“初始化”按钮；点击开始/继续问答，然后在输入框用 `/sap-init answer <回答>` 完成。
- 数据通路：`GET/PUT /sap-local/role`；`POST /sap-local/init` 启动初始化。host 用 webServer 注册。

## brief / note / worklog

- brief/note 文件带 YAML frontmatter：`id`、`status`（brief）、`session`、`created_at`、`updated_at`。
- brief 默认 `status: open`；`/sap-brief-status` 可改为 `resolved`，`/sap-notes` 只列未决。
- `/sap-brief from <path>` 与 `/sap-note <brief-id> from <path>` 从文件导入正文；路径相对当前会话 cwd。
- `/sap-worklog` 追加到 `work/<session>/log.md`，不进方向层，不导出。
- `/sap-doctor` 只证明文件层状态；它不证明方向正确，也不证明总工上下文未被污染。

## 初始化

- **新项目**：`/sap-init` 自动判断；回答 6 个问题（目标、当前重点、非目标、约束、取舍原则、暂停信号）。
- **已有项目**：`/sap-init existing`；问题偏向现状、已有结构、已生效决策、风险、近期目标、复核触发。
- `finalize` 前不要开其他会话正式推进；完成后当前会话是 chief。新会话默认“无角色”，需要在输入框上方的 SAP 角色条选择“工作”或“总工”才参与 SAP。

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
