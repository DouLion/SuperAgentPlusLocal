# 信息注入的参考实现（调研记录）

> 目标：确认 DSH 插件怎样给会话注入协议文本，以及“注入”与“隔离”的边界。  
> 结论：**systemPrompt.section 不进入聊天历史，适合角色协议；qingshen 的 agent/pre-step 改写人类消息，会进入历史，适合每轮提醒，不适合做隔离边界。**

## 1. dsh-system-prompt：agent 作用域 section

- 服务：`ctx.systemPrompt.section({ name, order, text })`。
- `agent.ctx` 注册只影响该 agent；卸载/销毁时释放。
- 不写入聊天历史；每次 prompt 组装时注入。
- 官方 README：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-system-prompt/README.md`。

**本插件采用**：在 `agent/session-start` 时按角色注册 section（order 80）。这是默认注入路径。

## 2. dsh-qingshen 2.2.0：agent/pre-step 追加热消息

参考路径：`$DSH_HOME/plugins/dsh-qingshen`。

- `index.js` 监听 `agent/pre-step` 瀑布，`await next()` 后改写 `decision.messages`。
- 只改最后一条人类消息，把 `modes.json` 的 `prompt` 追加到其最后一个 text block。
- 注入文本进入会话日志；模式按会话选择，存在宿主内存。
- `modes.json` 可配置模式、标签、提示词；默认“张飞”。

关键代码：`index.js` L188-L215（`agent/pre-step`）、L148-L162（`appendText`）。  
参考：本机 qingshen 的 README（`$DSH_HOME/plugins/dsh-qingshen/README.md`）中的 L16-L27 架构图、L113-L117 限制。

**评价**：适合“每轮提醒”，但会重复 token、进入历史；如果文本带操作细节会加重污染。本插件不把它当隔离边界，只提供可选 `/sap-qingshen` 写入模式。

## 3. dsh-agent-instructions：工作区指令注入

- 在首个 `agent/pre-step` 把 `AGENTS.md` 基线折进第一批消息；后续文件变化通过 `agent.inject()` 排队。
- 使用持久 user-role 消息，进入历史；读取 `$DSH_HOME/AGENTS.md` 与项目层级文件。
- 官方 README：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-instructions/README.md`。

**评价**：适合“项目规则”，但会进入历史；本插件不采用，避免协议文本每轮堆积。

## 4. dsh-project-instructions：多 cwd / per-agent 注入

公开实现（GitHub）：使用 `agent/pre-step` / `agent/request` 与 `agent.inject()`，按 agent 的 cwd 注入，避免全局单例串项目。  
参考：[dsh-project-instructions AGENTS.md](https://raw.githubusercontent.com/Zenjibad/skill-injector-plugin/c9fd5986ac0ca16006ed9ba89936e7b3f23dd0fc/AGENTS.md#1)。

**评价**：验证了“per-agent 作用域”是正确方向；本插件用 `agent.ctx.systemPrompt.section` 达到类似隔离，但不写历史。

## 5. Claude Code SessionStart hooks

- SessionStart hook 可以把 stdout 作为上下文加入会话，或返回 `additionalContext`。
- 适合启动时注入项目约定；与 DSH 的 section 思路相近。
- 参考：[Claude Code Hooks reference](https://code.claude.com/docs/ja/hooks#6)。

## 6. 决策

| 方案 | 进历史 | 每轮提醒 | 角色自动区分 | 本插件 |
|---|---|---|---|---|
| systemPrompt.section | 否 | 每次组装 | 是（读 sessions） | **默认** |
| qingshen pre-step | 是 | 是 | 需手动选模式 | 可选 `/sap-qingshen` |
| agent-instructions | 是 | 文件变化时 | 否 | 不用 |
| 输入框预填 | 不适用 | 不适用 | 否 | 不用 |

**最终选择**：section 做角色协议；qingshen 只作为可选“每轮提醒”；目录/会话隔离才是边界。
