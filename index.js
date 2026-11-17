import path from 'node:path'
import fs from 'node:fs/promises'
import {
  answerInit,
  appendWorkLog,
  chiefStatus,
  cleanse,
  clearChief,
  createBrief,
  createNote,
  doctor,
  ensureSkeleton,
  exists,
  exportBundle,
  finalizeInit,
  findRoot,
  getRole,
  importBundle,
  initStatus,
  listBriefs,
  listNotes,
  nowIso,
  readChief,
  readJson,
  readText,
  setBriefStatus,
  setChief,
  setRole,
  sapPaths,
  startInit,
  status,
  touchChief,
  writeJson,
} from './lib/sap.js'

export const inject = ['commands']

const PROTOCOL_NAME = 'sap-local:protocol'

function splitArgs(input) {
  const text = String(input || '').trim()
  if (!text) return []
  const out = []
  let current = ''
  let quote = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

function firstLine(text, max = 80) {
  return String(text || '').split(/\r?\n/)[0].slice(0, max)
}

function commandText(value) {
  return { kind: 'success', text: value }
}

function commandError(error) {
  return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
}

function jsonSender(res) {
  return (status, body) => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    })
    res.end(payload)
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function protocolText(role, init) {
  const common = [
    '【SAP 单机会话】',
    role === 'chief'
      ? '你是总工方向会话：只负责方向、原则、结构、优先级、风险。'
      : '你是工作会话：负责实现与调试，不是方向会话。',
    '',
    '文件：',
    '- .sap.local/direction.md（方向）',
    '- .sap.local/briefs/（worker 写的一页方向问题）',
    '- .sap.local/notes/（总工写的方向笔记）',
    '- .sap.local/work/<session>/（操作层；总工不读）',
    '',
  ]
  if (role === 'chief') {
    common.push(
      '规则：',
      '- 只读 direction.md、briefs/、notes/；不要读 work/、日志、diff、复现。',
      '- 用 /sap-notes 看未决 brief；写 notes/note-<id>.md；必要时更新 direction.md。',
      '- 用 /sap-doctor 做文件级检查；它不证明方向正确或上下文未被污染。',
      '- 用 /sap-chief 报告总工状态；你是在线总工时保持会话存活。',
      '- brief 夹带日志/diff/stack trace 时：退回，要求一页方向问题。',
      '- 没有审批；不要写 approve/reject。note 是方向指导，不是授权。',
      '- 当前会话被污染时：运行 /sap-clever 生成排污包，然后新建会话并在 SAP 角色条选择“总工”。',
    )
  } else {
    common.push(
      '规则：',
      '- 先读 direction.md。',
      '- 实现细节：自己做，用 /sap-worklog 记录到 work/<session>/log.md；不要打扰总工。',
      '- 方向问题：照 templates/brief.md 写 briefs/brief-<id>.md；一页，不含日志/diff/stack trace；继续做不冲突的部分。',
      '- 读 notes/ 的方向判断；采纳/调整/在 work/<session>/dissent.md 提异议；不要等批准。',
      '- 用 /sap-brief-status 标记 resolved；不要把 work/ 的日志或对话贴进 brief 或总工会话。',
      '- 用 /sap-chief 查看总工是否在线；总工离线时提醒用户拉起，不要自行改方向。',
    )
  }
  if (init && init.phase !== 'done') {
    common.push(
      '',
      '【初始化进行中】',
      '当前应通过 /sap-init 与用户达成共识；在 finalize 前不要开其他会话正式推进项目。',
      `进度：${Math.min(init.current, init.questions.length)}/${init.questions.length}；下一步：/sap-init answer <回答> 或 /sap-init status。`,
    )
  }
  return common.join('\n')
}

function qingshenPrompt(role) {
  if (role === 'chief') {
    return [
      '[SAP 总工方向会话]',
      '只负责方向、原则、结构、优先级、风险；不是 Debugger，也不是审批人。',
      '只读 .sap.local/direction.md、briefs/、notes/；不要读 work/、日志、diff、复现。',
      '写 notes/note-<id>.md；必要时更新 direction.md。',
      'brief 夹带操作细节时退回，要求一页方向问题。',
      '没有审批；不要写 approve/reject。',
      '如果当前会话被污染：运行 /sap-clever，新建会话并在 SAP 角色条选择“总工”。',
    ].join('\n')
  }
  return [
    '[SAP 工作会话]',
    '先读 .sap.local/direction.md。',
    '实现细节自己做，写 work/<session>/log.md；不要打扰总工。',
    '方向问题照 templates/brief.md 写 briefs/brief-<id>.md；一页，不含日志/diff/stack trace。',
    '读 notes/ 的方向判断；采纳/异议；不要等批准。',
    '不要把 work/ 的日志或对话贴进 brief 或总工会话。',
  ].join('\n')
}

function serviceFromAgent(agent, name) {
  const ctx = agent?.ctx
  if (!ctx) return undefined
  if (ctx[name]) return ctx[name]
  if (typeof ctx.get === 'function') return ctx.get(name)
  return undefined
}

function serviceFromCtx(context, name) {
  if (!context) return undefined
  if (context[name]) return context[name]
  if (typeof context.get === 'function') return context.get(name)
  return undefined
}

async function rootForSession(context, roots, sessionId, cwd, { strict = false } = {}) {
  const cached = roots.get(sessionId)
  if (cached) return cached
  const registry = serviceFromCtx(context, 'workspaceRegistry')
  if (registry && typeof registry.list === 'function') {
    try {
      const workspace = registry.list().find((item) => item && Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
      if (workspace?.path) return workspace.path
    } catch {}
  }
  if (cwd) return findRoot(cwd)
  if (strict) return null
  return findRoot(process.cwd())
}

function liveAgentIds(context) {
  const registry = serviceFromCtx(context, 'agents')
  if (!registry || typeof registry.list !== 'function') return []
  try {
    return registry.list().map((agent) => String(agent?.id))
  } catch {
    return []
  }
}

function chiefOptions(context) {
  return { liveIds: liveAgentIds(context), hostPid: process.pid }
}

async function refreshChief(context, root, agent) {
  if (!root || !agent) return
  const record = await readChief(root)
  if (record?.session_id === String(agent.id)) {
    await touchChief(root, record.session_id, chiefOptions(context))
  }
}

export function apply(ctx, _config = {}) {
  const disposers = []
  const protocolDisposers = new Map()
  const sessionRoots = new Map()
  const sessionAgents = new Map()

  const refreshProtocol = async (agent, force = true) => {
    try {
      if (!agent) return
      const cwd = agent.session?.header?.cwd || process.cwd()
      const root = await rootForSession(ctx, sessionRoots, agent.id, cwd)
      if (!(await exists(path.join(root, '.sap.local')))) return
      sessionRoots.set(agent.id, root)
      sessionAgents.set(agent.id, agent)
      await refreshChief(ctx, root, agent)
      const role = await getRole(root, agent.id)
      const disposeOld = () => {
        const old = protocolDisposers.get(agent)
        if (old) {
          try { old() } catch {}
          protocolDisposers.delete(agent)
        }
      }
      if (role === 'none') {
        disposeOld()
        return
      }
      const init = await readInit(root)
      const systemPrompt = serviceFromAgent(agent, 'systemPrompt')
      if (!systemPrompt || typeof systemPrompt.section !== 'function') {
        ctx.logger?.warn?.('[sap-local] systemPrompt service unavailable; protocol section not installed')
        return
      }
      if (force) disposeOld()
      if (protocolDisposers.has(agent)) return
      const off = systemPrompt.section({
        name: PROTOCOL_NAME,
        order: 80,
        text: protocolText(role, init),
      })
      if (typeof off === 'function') protocolDisposers.set(agent, off)
    } catch (error) {
      ctx.logger?.warn?.(`[sap-local] protocol install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const cmd = (definition) => {
    const off = ctx.commands.register(definition)
    if (typeof off === 'function') disposers.push(off)
  }

  cmd({
    name: 'sap-init',
    description: '初始化 SAP 单机方向（多轮共识；新项目/已有项目）',
    input: { hint: 'new | existing | answer <回答> | status | finalize' },
    recordInput: false,
    async handler(invocation) {
      try {
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const args = splitArgs(invocation.rawInput)
        const action = args[0] || ''
        const initialized = (await readJson(sapPaths(root).state, null))?.initialized === true
        const mutating = ['', 'new', 'existing', 'answer', 'finalize'].includes(action)
        if (mutating && !initialized && (await getRole(root, invocation.agent.id)) !== 'chief') {
          return commandError('只有总工方向会话可以初始化；请先在 SAP 角色条选择“总工”。')
        }
        if (action === 'help') {
          return commandText([
            '用法：',
            '/sap-init                 开始/继续初始化',
            '/sap-init new             按新项目初始化',
            '/sap-init existing        按已有项目初始化',
            '/sap-init answer <回答>   回答当前问题',
            '/sap-init status          查看进度',
            '/sap-init finalize        生成 direction.md/charter 并完成',
          ].join('\n'))
        }
        if (action === 'status') {
          const s = await initStatus(root)
          if (!s.state) return commandText('尚未开始初始化。运行 /sap-init 开始。')
          return commandText(formatInitStatus(s))
        }
        if (action === 'answer') {
          if (args.length < 2) return commandError('请提供回答：/sap-init answer <回答>')
          const result = await answerInit(root, args.slice(1).join(' '))
          await refreshProtocol(invocation.agent, true)
          const s = await initStatus(root)
          return commandText(formatInitStatus(s))
        }
        if (action === 'finalize') {
          const result = await finalizeInit(root, invocation.agent.id, chiefOptions(ctx))
          await refreshProtocol(invocation.agent, true)
          return commandText([
            '初始化完成。',
            `- direction: ${result.direction}`,
            '- 当前会话已设为 chief（总工方向会话）。',
            '- 下一步：新建会话，在输入框上方的 SAP 角色条选择“工作”；它会获得 worker 协议。',
            '- 需要把另一个会话设为总工时：在新会话的 SAP 角色条选择“总工”。',
            '- 如果方向会话被污染：/sap-clever。',
          ].join('\n'))
        }
        if (action === 'new' || action === 'existing') {
          const s = await initStatus(root)
          if (s.initialized && s.state?.phase === 'done') {
            return commandError('项目已初始化；如需重新初始化，请先手动归档/删除 .sap.local/init.json 与 direction.md')
          }
          const started = await startInit(root, invocation.agent.id, action)
          await refreshProtocol(invocation.agent, true)
          return commandText(formatInitStatus(await initStatus(root)))
        }
        if (action) return commandError(`未知参数：${action}；/sap-init help 查看用法`)
        const s = await initStatus(root)
        if (s.initialized && s.state?.phase === 'done') {
          return commandText([
            '项目已初始化。',
            `- direction: ${sapPaths(root).direction}`,
            '- 新会话默认无角色；在输入框上方的 SAP 角色条选择“工作”或“总工”。',
            '- 查看状态：/sap-status',
          ].join('\n'))
        }
        const started = await startInit(root, invocation.agent.id)
        await refreshProtocol(invocation.agent, true)
        return commandText(formatInitStatus(await initStatus(root)))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-chief',
    description: '查看总工状态或接管总工：status | takeover',
    input: { hint: 'status | takeover' },
    recordInput: false,
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        const action = args[0] || 'status'
        if (!['status', 'takeover', 'revive'].includes(action)) return commandError('用法：/sap-chief status | takeover')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        if (!(await exists(path.join(root, '.sap.local')))) return commandError('尚未初始化；请先选择总工并初始化。')
        const chief = chiefStatus(await readChief(root), liveAgentIds(ctx), process.pid)
        if (action === 'status') {
          const lines = [
            `总工状态：${chief.status}`,
            chief.session_id ? `总工会话：${chief.session_id}` : null,
            chief.last_seen_at ? `最近心跳：${chief.last_seen_at}` : null,
            chief.age_ms !== null ? `距今：${Math.round(chief.age_ms / 1000)}s` : null,
          ].filter(Boolean)
          if (chief.status === 'offline' || chief.status === 'stale') {
            lines.push('总工不在线；可在当前会话运行 /sap-chief takeover，或在 SAP 角色条选择“总工”接管。')
          }
          return commandText(lines.join('\n'))
        }
        await setChief(root, invocation.agent.id, chiefOptions(ctx))
        await refreshProtocol(invocation.agent, true)
        return commandText('已接管总工方向会话；当前会话角色为 chief。')
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-brief',
    description: '写一页方向 brief（worker 用；不要贴日志/diff）',
    input: { hint: '<一句话方向问题>' },
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        let text = String(invocation.rawInput || '').trim()
        if (args[0] === 'from' && args[1]) {
          const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
          const file = path.isAbsolute(args[1]) ? args[1] : path.resolve(cwd, args.slice(1).join(' '))
          text = await readText(file, '')
          if (!text.trim()) return commandError(`文件为空或不存在：${file}`)
        }
        if (!text) return commandError('用法：/sap-brief <一句话方向问题> | /sap-brief from <path>')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await createBrief(root, invocation.agent.id, text)
        return commandText([
          `已写 brief：${result.file}`,
          result.warning ? `注意：${result.warning}` : null,
          '下一步：补全模板字段；总工用 /sap-notes 或直接读 briefs/。',
        ].filter(Boolean).join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-brief-status',
    description: '更新 brief 状态：open | resolved',
    input: { hint: '<brief-id> <open|resolved>' },
    recordInput: false,
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        if (args.length < 2) return commandError('用法：/sap-brief-status <brief-id> <open|resolved>')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await setBriefStatus(root, args[0], args[1])
        return commandText(`brief ${result.id} 已设为 ${result.status}。`)
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-note',
    description: '写方向 note（chief 用；不是 approve/reject）',
    input: { hint: '<brief-id> <方向判断> | <brief-id> from <path>' },
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        if (args.length < 2) return commandError('用法：/sap-note <brief-id> <方向判断> | /sap-note <brief-id> from <path>')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        let conclusion = args.slice(1).join(' ')
        if (args[1] === 'from' && args[2]) {
          const file = path.isAbsolute(args[2]) ? args[2] : path.resolve(cwd, args.slice(2).join(' '))
          conclusion = await readText(file, '')
          if (!conclusion.trim()) return commandError(`文件为空或不存在：${file}`)
        }
        const result = await createNote(root, invocation.agent.id, args[0], conclusion)
        return commandText(`已写 note：${result.file}\n注意：这是方向指导，不是审批。`)
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-worklog',
    description: '记录工作会话操作日志（写 work/<session>/log.md；总工不读）',
    input: { hint: '<工作内容>' },
    async handler(invocation) {
      try {
        const text = String(invocation.rawInput || '').trim()
        if (!text) return commandError('用法：/sap-worklog <工作内容>')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await appendWorkLog(root, invocation.agent.id, text)
        return commandText(`已记录工作日志：${result.file}`)
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-doctor',
    description: '检查 SAP 单机状态：方向/角色/gitignore/未决 brief/疑似污染',
    async handler(invocation) {
      try {
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await doctor(root, invocation.agent.id, chiefOptions(ctx))
        const lines = [
          `SAP doctor：${result.ok ? '通过' : '有警告'}`,
          ...result.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.message}`),
          '',
          `未决 brief：${result.stats.openBriefs}；notes：${result.stats.notes}；work logs：${result.stats.workLogs}`,
          '注意：这是文件级检查，不证明方向正确或会话上下文未被污染。',
        ]
        return commandText(lines.join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-notes',
    description: '列出未决 brief 与最近 note',
    async handler(invocation) {
      try {
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const briefs = (await listBriefs(root)).filter((b) => b.status === 'open')
        const notes = (await listNotes(root)).slice(-5).reverse()
        const lines = ['未决 brief：']
        lines.push(...briefs.slice(0, 10).map((b) => `- ${b.id} ${b.title}`))
        if (!briefs.length) lines.push('（无）')
        lines.push('', '最近 note：')
        lines.push(...notes.map((n) => `- ${n.id} ${n.title}${n.brief ? `（brief ${n.brief}）` : ''}`))
        if (!notes.length) lines.push('（无）')
        return commandText(lines.join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-status',
    description: '查看 SAP 单机状态（direction/briefs/notes/角色）',
    async handler(invocation) {
      try {
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const s = await status(root, chiefOptions(ctx))
        return commandText(formatStatus(s, await getRole(root, invocation.agent.id)))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-export',
    description: '导出方向层（direction/briefs/notes）用于换机/交接',
    input: { hint: '[输出路径]' },
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await exportBundle(root, args[0] || null)
        return commandText(`已导出：${result.path}\n文件数：${result.files}；字节：${result.bytes}\n注意：只导出方向层，不含 work/ 操作细节。`)
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-import',
    description: '导入方向层；默认合并，--replace 覆盖并备份',
    input: { hint: '<bundle.json> [--replace]' },
    async handler(invocation) {
      try {
        const args = splitArgs(invocation.rawInput)
        if (!args[0]) return commandError('用法：/sap-import <bundle.json> [--replace]')
        const replace = args.includes('--replace')
        const bundlePath = args.find((a) => a !== '--replace')
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const result = await importBundle(root, bundlePath, { replace })
        return commandText([
          `已导入 ${result.imported} 个文件。`,
          replace ? `已备份原方向层：${result.backup}` : '默认合并；direction 写入 direction.imported-*.md，请人工确认后再替换。',
          '完成后可运行 /sap-status 查看。',
        ].join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-clever',
    description: '方向会话排污：生成方向摘要包，建议新会话继续',
    async handler(invocation) {
      try {
        const cwd = invocation.agent?.session?.header?.cwd || process.cwd()
        const root = await rootForSession(ctx, sessionRoots, invocation.agent.id, cwd)
        const role = await getRole(root, invocation.agent.id)
        if (role !== 'chief') return commandError('只有 chief 方向会话可以排污；请先在 SAP 角色条选择“总工”。')
        const result = await cleanse(root, invocation.agent.id)
        return commandText([
          `已生成排污包：${result.file}`,
          '下一步：新建一个会话，在 SAP 角色条选择“总工”；只读 direction/briefs/notes。',
          '当前会话不要继续承载方向判断；不要粘贴旧日志/diff/复现。',
        ].join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  cmd({
    name: 'sap-qingshen',
    description: '把 SAP 总工/工作协议写入 dsh-qingshen 的 modes.json（可选）',
    async handler(invocation) {
      try {
        const profileDir = process.env.DSH_PROFILE_DIR
        if (!profileDir) return commandError('DSH_PROFILE_DIR 未设置；无法定位 dsh-qingshen')
        const modesPath = path.join(profileDir, 'node_modules', 'dsh-qingshen', 'modes.json')
        if (!(await exists(modesPath))) return commandError(`未找到 qingshen modes.json：${modesPath}`)
        const modes = await readJson(modesPath, null)
        if (!modes || !Array.isArray(modes.modes)) return commandError('qingshen modes.json 格式不认识')
        const backup = `${modesPath}.bak-${nowIso().replace(/[:.]/g, '-')}`
        await fs.copyFile(modesPath, backup)
        modes.modes = modes.modes.filter((mode) => !['sap-chief', 'sap-worker'].includes(mode.id))
        modes.modes.push({ id: 'sap-chief', label: 'SAP 总工', prompt: qingshenPrompt('chief') })
        modes.modes.push({ id: 'sap-worker', label: 'SAP 工作', prompt: qingshenPrompt('worker') })
        await writeJson(modesPath, modes)
        return commandText([
          `已写入 qingshen 模式：${modesPath}`,
          `备份：${backup}`,
          '下一步：刷新页面，在输入框上方选择 SAP 总工 / SAP 工作。',
          '注意：qingshen 会把文本追加到每条人类消息并进入历史；本插件的 systemPrompt section 不进入历史。二选一，不要同时开。',
        ].join('\n'))
      } catch (error) {
        return commandError(error)
      }
    },
  })

  let routesRegistered = false
  const ensureRoutes = () => {
    if (routesRegistered) return
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (!webServer || typeof webServer.register !== 'function') return
    routesRegistered = true
    const disposeRoute = webServer.register({
      kind: 'exact',
      path: '/sap-local/role',
      handler: async (req, res) => {
        const send = jsonSender(res)
        try {
          const url = new URL(req.url, 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') || ''
          const cwd = url.searchParams.get('cwd') || ''
          if (req.method === 'GET' || req.method === 'HEAD') {
            const root = await rootForSession(ctx, sessionRoots, sessionId, cwd, { strict: true })
            if (!root || !(await exists(path.join(root, '.sap.local')))) {
              send(200, { role: 'none', initialized: false })
              return
            }
            sessionRoots.set(sessionId, root)
            const initialized = (await readJson(sapPaths(root).state, null))?.initialized === true
            const role = await getRole(root, sessionId)
            const initState = await readJson(sapPaths(root).init, null)
            const init = initState && initState.phase !== 'done'
              ? {
                  phase: initState.phase,
                  current: Math.min(initState.current, initState.questions.length),
                  total: initState.questions.length,
                  question: initState.questions[Math.min(initState.current, initState.questions.length - 1)]?.text || '',
                }
              : null
            const briefItems = await listBriefs(root)
            const chief = chiefStatus(await readChief(root), liveAgentIds(ctx), process.pid)
            send(200, { role, initialized, init, openBriefs: briefItems.filter((b) => b.status === 'open').length, chief, root })
            return
          }
          if (req.method !== 'PUT' && req.method !== 'POST') {
            send(405, { error: 'method-not-allowed' })
            return
          }
          const body = await readBody(req)
          const sid = typeof body.sessionId === 'string' ? body.sessionId : ''
          const role = body.role
          if (!sid) {
            send(400, { error: 'sessionId required' })
            return
          }
          if (!['none', 'chief', 'worker'].includes(role)) {
            send(400, { error: 'role must be none|chief|worker' })
            return
          }
          let root = await rootForSession(ctx, sessionRoots, sid, typeof body.cwd === 'string' ? body.cwd : '', { strict: true })
          if (!root) {
            send(409, { error: 'cannot-resolve-root' })
            return
          }
          if (role !== 'none') await ensureSkeleton(root)
          sessionRoots.set(sid, root)
          if (role === 'chief') {
            try {
              await setChief(root, sid, chiefOptions(ctx))
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (message === 'chief-already-online') {
                send(409, { error: 'chief-already-online' })
                return
              }
              throw error
            }
          } else {
            await setRole(root, sid, role)
            const oldChief = await readChief(root)
            if (oldChief?.session_id === sid) await clearChief(root, sid)
          }
          const agent = sessionAgents.get(sid)
          if (agent) await refreshProtocol(agent, true)
          send(200, { ok: true, role })
        } catch (error) {
          send(500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    if (typeof ctx.effect === 'function') ctx.effect(() => disposeRoute, 'sap-local: role route')
    else disposers.push(disposeRoute)

    const disposeInitRoute = webServer.register({
      kind: 'exact',
      path: '/sap-local/init',
      handler: async (req, res) => {
        const send = jsonSender(res)
        try {
          if (req.method !== 'POST' && req.method !== 'PUT') {
            send(405, { error: 'method-not-allowed' })
            return
          }
          const body = await readBody(req)
          const sid = typeof body.sessionId === 'string' ? body.sessionId : ''
          if (!sid) {
            send(400, { error: 'sessionId required' })
            return
          }
          let root = await rootForSession(ctx, sessionRoots, sid, typeof body.cwd === 'string' ? body.cwd : '', { strict: true })
          if (!root) {
            send(409, { error: 'cannot-resolve-root' })
            return
          }
          await ensureSkeleton(root)
          sessionRoots.set(sid, root)
          const state = await readJson(sapPaths(root).state, null)
          if (state?.initialized) {
            send(200, { ok: true, initialized: true })
            return
          }
          if ((await getRole(root, sid)) !== 'chief') {
            send(409, { error: 'chief-role-required' })
            return
          }
          try {
            await setChief(root, sid, chiefOptions(ctx))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (message === 'chief-already-online') {
              send(409, { error: 'chief-already-online' })
              return
            }
            throw error
          }
          const started = await startInit(root, sid)
          const initState = started.state
          send(200, {
            ok: true,
            initialized: false,
            init: {
              phase: initState.phase,
              current: Math.min(initState.current, initState.questions.length),
              total: initState.questions.length,
              question: initState.questions[Math.min(initState.current, initState.questions.length - 1)]?.text || '',
            },
          })
        } catch (error) {
          send(500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    if (typeof ctx.effect === 'function') ctx.effect(() => disposeInitRoute, 'sap-local: init route')
    else disposers.push(disposeInitRoute)
  }
  ensureRoutes()
  try { ctx.inject(['webServer'], () => ensureRoutes()) } catch {}

  const onStart = ctx.on('agent/session-start', async ({ agent }) => {
    await refreshProtocol(agent, false)
  })
  if (typeof onStart === 'function') disposers.push(onStart)
  const onCreated = ctx.on('agent/created', async ({ agent }) => {
    await refreshProtocol(agent, false)
    const root = sessionRoots.get(agent.id)
    if (root) await refreshChief(ctx, root, agent)
  })
  if (typeof onCreated === 'function') disposers.push(onCreated)
  const onStatus = ctx.on('agent/status', async ({ agent }) => {
    const root = sessionRoots.get(agent.id)
    if (root) await refreshChief(ctx, root, agent)
  })
  if (typeof onStatus === 'function') disposers.push(onStatus)
  const onDisposed = ctx.on('agent/disposed', ({ agent }) => {
    protocolDisposers.delete(agent)
    const root = sessionRoots.get(agent.id)
    if (root) void refreshChief(ctx, root, agent)
  })
  if (typeof onDisposed === 'function') disposers.push(onDisposed)

  return () => {
    for (const off of protocolDisposers.values()) {
      try { off() } catch {}
    }
    protocolDisposers.clear()
    for (const off of disposers) {
      try { off() } catch {}
    }
  }
}

async function readInit(root) {
  return readJson(sapPaths(root).init, null)
}

function formatInitStatus(s) {
  if (!s.state) return '尚未开始初始化。运行 /sap-init 开始。'
  if (s.initialized && s.state.phase === 'done') {
    return [
      '项目已初始化。',
      `- mode: ${s.state.mode}`,
      '- 当前会话可用 SAP 角色条设为总工；新会话默认无角色。',
      '- 查看状态：/sap-status',
    ].join('\n')
  }
  const q = s.question
  return [
    `SAP 初始化（${s.state.mode === 'existing' ? '已有项目' : '新项目'}）`,
    `进度：${s.progress}`,
    q ? `当前问题：${q.text}` : '所有问题已回答，运行 /sap-init finalize 生成 direction.md。',
    '',
    q ? '回答：/sap-init answer <你的回答>' : '完成：/sap-init finalize',
    '查看：/sap-init status；帮助：/sap-init help',
  ].join('\n')
}

function formatStatus(s, role) {
  return [
    `SAP 状态（${role}）`,
    `- 项目：${s.root}`,
    `- direction：${s.directionExists ? '已存在' : '缺失'}（${s.directionBytes} bytes）`,
    `- 初始化：${s.initialized ? '完成' : s.init ? `进行中 ${s.init.progress}` : '未开始'}`,
    `- briefs：${s.briefs}（未决 ${s.openBriefs}）；notes：${s.notes}；work logs：${s.workLogs}`,
    `- 总工：${s.chief?.status || 'none'}${s.chief?.session_id ? `（${s.chief.session_id}）` : ''}`,
    `- .gitignore：${s.gitignore ? '已包含 .sap.local/' : '未包含 .sap.local/'}`,
    s.lastNote ? `- 最近 note：${s.lastNote}` : null,
    '',
    '命令：/sap-init /sap-chief /sap-brief /sap-brief-status /sap-note /sap-notes /sap-worklog /sap-doctor /sap-status /sap-export /sap-import /sap-clever /sap-qingshen',
  ].filter(Boolean).join('\n')
}
