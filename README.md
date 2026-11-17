# SuperAgentPlusLocal

单机版方向会话 / 工作会话隔离，以 DeepSeek Harness（DSH）插件 **`dsh-sap-local`** 实现。

一个人用多个会话推进项目时，最大的问题不是“审批”，而是**方向会话被操作细节污染**：日志、diff、复现步骤一多，总工就看不到目标和取舍。这个仓库把方向层（`direction/briefs/notes`）和操作层（`work/`）分开，并用会话角色约束“谁该看什么”。

**没有审批。** 没有 approve/reject、G1/G2/G3、lease/grant/contract；这些属于云端治理，不属于单机。

## 功能

- **SAP 操作条**：输入框上方集中完成角色切换、初始化/重新共识、写 Brief/Note、工作日志、状态、医生、总工接管、导出/导入、排污；每次操作都在面板中显示成功或失败回执。
- **总工状态**：`.sap.local/chief.json` 记录唯一总工；总工离线/过期时角色条提示，`/sap-chief status` 查看、`/sap-chief takeover` 接管。
- **`/sap-init`**：多轮问答初始化，区分新项目 / 已有项目；`reinit` 用于旧项目重新共识，归档旧方向并保留 briefs/notes/work。
- **`/sap-brief` / `/sap-note`**：一页 brief 与方向 note；支持 `from <path>` 导入、`open/resolved` 状态。
- **`/sap-worklog`**：记录 `work/<session>/log.md`，总工不读、不导出。
- **`/sap-doctor`**：文件级健康检查：方向、角色、gitignore、未决 brief、疑似污染。
- **`/sap-export` / `/sap-import`**：换机/交接；只导出方向层，不带 `work/`。
- **`/sap-clever`**：方向会话排污；生成方向摘要包，建议新会话继续。
- **注入**：按角色使用 `agent.ctx.systemPrompt.section`，不写入聊天历史。
- **可选 qingshen 配合**：`/sap-qingshen` 写入 `SAP 总工 / SAP 工作` 模式；与 section 二选一。

## 安装

1. 克隆仓库：

   ```bash
   git clone https://github.com/DouLion/SuperAgentPlusLocal.git
   ```

2. 在 DSH 的 Plugins 页面选择 **Add plugin**，指向仓库根目录；或使用插件管理器的 `install_bundle`，target 为仓库根目录的绝对路径。

3. 新开一个会话，在 SAP 操作条先选“总工”，然后点击“初始化”；后续操作也都在操作条里完成。

## 命令

| 命令 | 作用 |
|---|---|
| `/sap-init` | 开始/继续初始化；自动判断新项目/已有项目 |
| `/sap-init new` / `existing` | 指定初始化模式 |
| `/sap-init reinit` | 旧项目重新共识：归档旧方向，保留 briefs/notes/work，预填旧答案 |
| `/sap-init answer <回答>` | 多轮回答；留空则确认预填 |
| `/sap-init status` / `finalize` | 查看进度 / 生成方向文件并完成；只有总工可初始化 |
| `/sap-chief status\|takeover` | 查看总工状态 / 接管总工 |
| `/sap-brief <问题>` / `from <path>` | worker 写一页方向 brief，或从文件导入 |
| `/sap-brief-status <id> <open\|resolved>` | 更新 brief 状态 |
| `/sap-note <brief-id> <判断>` / `from <path>` | chief 写方向 note（不是审批） |
| `/sap-notes` | 列出未决 brief 与最近 note |
| `/sap-worklog <内容>` | 追加工作日志到 `work/<session>/log.md` |
| `/sap-doctor` | 文件级健康检查 |
| `/sap-status` | 查看状态 |
| `/sap-export [路径]` | 导出方向层 JSON；不含 `work/` |
| `/sap-import <bundle> [--replace]` | 默认合并；`--replace` 先备份再覆盖 |
| `/sap-clever` | chief 排污：生成方向摘要包，建议新会话继续 |
| `/sap-qingshen` | 可选：写入 qingshen 的 SAP 模式 |

## 角色

| 角色 | 能看 | 做什么 |
|---|---|---|
| 无角色 | 不参与 SAP | 零散任务；不注入协议 |
| 总工 | `direction.md`、`briefs/`、`notes/` | 方向/原则/结构/优先级/风险；不读 `work/` |
| 工作 | `direction.md`、`briefs/`、`notes/`、自己的 `work/` | 实现/调试；方向问题写一页 brief |

角色保存在 `.sap.local/sessions/<session-id>.json`。切回“无角色”会立即移除协议 section。

## 目录

```text
.sap.local/
├── direction.md
├── charter.md
├── chief.json
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

## 文档

- [插件细节](docs/DETAIL.md)
- [注入机制调研](docs/RESEARCH.md)
- [方案评审](docs/design/01_方案评审.md)
- [本地协议与目录设计](docs/design/02_本地协议与目录设计.md)
- [MVP 与验证清单](docs/design/03_MVP与验证清单.md)
- [注入提示词草稿](docs/design/04_注入提示词草稿.md)
- [插件实现说明](docs/design/05_插件实现说明.md)
- [云端与单机职责边界](docs/design/06_云端与单机职责边界.md)

## 开发

```bash
node --test test/*.test.js
```

当前版本：`0.5.0`。

## License

Apache License 2.0，见 [LICENSE](LICENSE)。
