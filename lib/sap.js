import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const SCHEMA = {
  init: 'sap.local/init/v1',
  state: 'sap.local/state/v1',
  export: 'sap.local/export/v1',
  session: 'sap.local/session/v1',
}

export const QUESTIONS = {
  new: [
    '这个项目为谁解决什么问题？用一句话说。',
    '当前阶段最重要的一个可交付结果是什么？',
    '这一阶段明确不做什么？（边界/非目标）',
    '有哪些不能破坏的结构或技术约束？（语言/仓库/部署/接口）',
    '发生取舍时，优先保护什么？（正确性/速度/兼容/成本）',
    '什么信号说明应该暂停或转向？',
  ],
  existing: [
    '项目现在在做什么、为什么？',
    '当前阶段最重要的一个目标是什么？',
    '这一阶段明确不做什么？',
    '已有结构、模块边界、已生效决策中，哪些不能随便动？',
    '发生取舍时，优先保护什么？',
    '什么情况需要重新看方向？',
  ],
}

const HEADINGS = {
  new: ['目标', '当前重点', '非目标', '结构与约束', '取舍原则', '暂停/复核触发'],
  existing: ['项目现状与目标', '当前重点', '非目标', '已有结构与决策', '取舍原则', '复核触发'],
}

export function nowIso() {
  return new Date().toISOString()
}

export function makeId(prefix) {
  const t = Date.now().toString(36)
  const r = crypto.randomBytes(4).toString('hex')
  return `${prefix}-${t}-${r}`
}

export function sapPaths(root) {
  const base = path.join(root, '.sap.local')
  return {
    base,
    direction: path.join(base, 'direction.md'),
    charter: path.join(base, 'charter.md'),
    readme: path.join(base, 'README.md'),
    init: path.join(base, 'init.json'),
    state: path.join(base, 'state.json'),
    briefs: path.join(base, 'briefs'),
    notes: path.join(base, 'notes'),
    work: path.join(base, 'work'),
    sessions: path.join(base, 'sessions'),
    templates: path.join(base, 'templates'),
    detail: path.join(base, 'detail'),
    archive: path.join(base, 'archive'),
    exports: path.join(base, 'exports'),
    backups: path.join(base, 'backups'),
  }
}

export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

export async function readText(p, fallback = '') {
  try {
    return await fs.readFile(p, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function readJson(p, fallback = null) {
  const text = await readText(p, '')
  if (!text.trim()) return fallback
  return JSON.parse(text)
}

export async function atomicWrite(p, content) {
  await ensureDir(path.dirname(p))
  const tmp = `${p}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`
  await fs.writeFile(tmp, content, 'utf8')
  try {
    await fs.rename(tmp, p)
  } catch (error) {
    if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
      await fs.rm(p, { force: true })
      await fs.rename(tmp, p)
    } else {
      await fs.rm(tmp, { force: true })
      throw error
    }
  }
}

export async function writeJson(p, value) {
  await atomicWrite(p, JSON.stringify(value, null, 2) + '\n')
}

export async function writeText(p, value) {
  await atomicWrite(p, value)
}

export async function findRoot(start) {
  let current = path.resolve(start || process.cwd())
  const original = current
  while (true) {
    if (await exists(path.join(current, '.sap.local'))) return current
    if (await exists(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return original
    current = parent
  }
}

export async function detectMode(root) {
  const markers = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'src', 'app']
  for (const marker of markers) {
    if (await exists(path.join(root, marker))) return 'existing'
  }
  return 'new'
}

export async function ensureGitignore(root) {
  const file = path.join(root, '.gitignore')
  const current = await readText(file, '')
  if (!current.split(/\r?\n/).includes('.sap.local/')) {
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    await writeText(file, `${current}${prefix}.sap.local/\n`)
  }
}

export async function ensureSkeleton(root) {
  const p = sapPaths(root)
  for (const dir of [p.base, p.briefs, p.notes, p.work, p.sessions, p.templates, p.detail, p.archive, p.exports, p.backups]) {
    await ensureDir(dir)
  }
  if (!(await exists(p.charter))) await writeText(p.charter, buildCharter())
  if (!(await exists(p.readme))) await writeText(p.readme, buildReadme())
  if (!(await exists(path.join(p.templates, 'brief.md')))) {
    await writeText(path.join(p.templates, 'brief.md'), buildBriefTemplate())
  }
  if (!(await exists(path.join(p.templates, 'note.md')))) {
    await writeText(path.join(p.templates, 'note.md'), buildNoteTemplate())
  }
  await ensureGitignore(root)
}

export async function startInit(root, sessionId, mode = null) {
  await ensureSkeleton(root)
  const p = sapPaths(root)
  const existing = await readJson(p.init, null)
  if (existing && existing.phase !== 'done' && !mode) {
    const q = currentQuestion(existing)
    return { state: existing, question: q, resumed: true }
  }
  const selected = mode || (await detectMode(root))
  if (!QUESTIONS[selected]) throw new Error(`unknown mode: ${selected}`)
  const state = {
    schema: SCHEMA.init,
    mode: selected,
    phase: 'interview',
    current: 0,
    answers: {},
    questions: QUESTIONS[selected].map((text, i) => ({ id: `q${i + 1}`, text })),
    session_id: sessionId,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  await writeJson(p.init, state)
  return { state, question: state.questions[0], resumed: false }
}

export function currentQuestion(state) {
  if (!state || state.phase === 'done') return null
  return state.questions?.[state.current] ?? null
}

export async function initStatus(root) {
  const p = sapPaths(root)
  const state = await readJson(p.init, null)
  const initialized = (await readJson(p.state, null))?.initialized === true
  return {
    initialized,
    state,
    question: currentQuestion(state),
    progress: state ? `${Math.min(state.current, state.questions.length)}/${state.questions.length}` : '0/0',
  }
}

export async function answerInit(root, text) {
  const p = sapPaths(root)
  const state = await readJson(p.init, null)
  if (!state) throw new Error('init not started; run /sap-init first')
  if (state.phase === 'done') throw new Error('init already finalized')
  const question = currentQuestion(state)
  if (!question) throw new Error('no pending question')
  const answer = String(text || '').trim()
  if (!answer) throw new Error('answer is empty')
  state.answers[question.id] = answer
  state.current += 1
  state.updated_at = nowIso()
  if (state.current >= state.questions.length) state.phase = 'ready'
  await writeJson(p.init, state)
  return { state, question: currentQuestion(state) }
}

export function buildDirection(state) {
  const mode = state.mode === 'existing' ? 'existing' : 'new'
  const headings = HEADINGS[mode]
  const lines = [
    '# Direction',
    '',
    `> 由 /sap-init 生成（${mode === 'new' ? '新项目' : '已有项目'}）；最后更新：${nowIso()}`,
    '> 只写方向，不写某个 bug 怎么修。',
    '',
  ]
  state.questions.forEach((q, i) => {
    lines.push(`## ${headings[i]}`)
    lines.push('')
    lines.push(state.answers[q.id] || '（待补充）')
    lines.push('')
  })
  return lines.join('\n')
}

export async function finalizeInit(root, sessionId) {
  const p = sapPaths(root)
  const state = await readJson(p.init, null)
  if (!state) throw new Error('init not started; run /sap-init first')
  const missing = state.questions.filter((q) => !String(state.answers[q.id] || '').trim())
  if (missing.length) {
    throw new Error(`还有 ${missing.length} 个问题未回答：${missing.map((q) => q.id).join(', ')}`)
  }
  await ensureSkeleton(root)
  await writeText(p.direction, buildDirection(state))
  if (!(await exists(p.charter))) await writeText(p.charter, buildCharter())
  if (!(await exists(p.readme))) await writeText(p.readme, buildReadme())
  if (!(await exists(path.join(p.templates, 'brief.md')))) {
    await writeText(path.join(p.templates, 'brief.md'), buildBriefTemplate())
  }
  if (!(await exists(path.join(p.templates, 'note.md')))) {
    await writeText(path.join(p.templates, 'note.md'), buildNoteTemplate())
  }
  await writeJson(p.state, {
    schema: SCHEMA.state,
    initialized: true,
    mode: state.mode,
    direction_version: 1,
    created_at: state.created_at,
    updated_at: nowIso(),
  })
  state.phase = 'done'
  state.finalized_at = nowIso()
  state.updated_at = nowIso()
  await writeJson(p.init, state)
  await setRole(root, sessionId, 'chief')
  return { state, direction: p.direction }
}

export async function setRole(root, sessionId, role) {
  if (!['none', 'chief', 'worker'].includes(role)) throw new Error('role must be none, chief or worker')
  const p = sapPaths(root)
  await ensureDir(p.sessions)
  const file = path.join(p.sessions, `${sessionId}.json`)
  const current = (await readJson(file, null)) || {}
  const next = {
    schema: SCHEMA.session,
    session_id: sessionId,
    role,
    created_at: current.created_at || nowIso(),
    updated_at: nowIso(),
    cleansed_at: current.cleansed_at || null,
  }
  await writeJson(file, next)
  return next
}

export async function getRole(root, sessionId) {
  const p = sapPaths(root)
  const data = await readJson(path.join(p.sessions, `${sessionId}.json`), null)
  return data?.role === 'chief' || data?.role === 'worker' ? data.role : 'none'
}

export async function listSessions(root) {
  const p = sapPaths(root)
  const files = await listFiles(p.sessions, '.json')
  const out = []
  for (const file of files) {
    const data = await readJson(file, null)
    if (data) out.push(data)
  }
  return out
}

export async function countWorkLogs(root) {
  const p = sapPaths(root)
  let count = 0
  try {
    const entries = await fs.readdir(p.work, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && (await exists(path.join(p.work, entry.name, 'log.md')))) count += 1
    }
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  return count
}

export async function listFiles(dir, suffix = '') {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && (!suffix || e.name.endsWith(suffix)))
      .map((e) => path.join(dir, e.name))
      .sort()
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

export function looksLikeOperationalDetail(text) {
  const value = String(text || '')
  return /(^|\n)\s*(at\s+\S+\(|Traceback|diff --git|TypeError|ReferenceError|Error:)/m.test(value)
    || /```(?:bash|sh|js|ts|python|diff)/i.test(value)
}

export function parseFrontmatter(text) {
  const value = String(text || '')
  if (!value.startsWith('---\n') && value !== '---') return { data: {}, body: value }
  const end = value.indexOf('\n---\n', 4)
  if (end < 0) return { data: {}, body: value }
  const data = {}
  for (const line of value.slice(4, end).split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { data, body: value.slice(end + 5) }
}

export function withFrontmatter(data, body) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue
    lines.push(`${key}: ${String(value).replace(/\r?\n/g, ' ')}`)
  }
  lines.push('---')
  return `${lines.join('\n')}\n${String(body || '').replace(/^\n+/, '')}`
}

function titleOf(body, fallback) {
  const m = /^#\s+(.+)$/m.exec(String(body || ''))
  return m ? m[1].trim() : fallback
}

export async function createBrief(root, sessionId, question) {
  const text = String(question || '').trim()
  if (!text) throw new Error('brief question is empty')
  if (text.length > 8000) throw new Error('brief question is too long (max 8000 chars)')
  const p = sapPaths(root)
  await ensureSkeleton(root)
  const id = makeId('brief')
  const body = [
    `# Brief: ${text.split(/\r?\n/)[0].slice(0, 120)}`,
    '',
    `- 会话：${sessionId}`,
    `- 时间：${nowIso()}`,
    '- 方向关联：（待填：哪个目标/原则/决策）',
    `- 问题：${text}`,
    '- 影响：（范围/成本/可逆性/受影响模块）',
    '- 选项：A ... / B ... / 不做或延后',
    '- 建议：（你的建议，标明是建议）',
    '- 需要总工判断：（一句话）',
    '- 证据指针：（路径/commit/报告；不要贴日志正文）',
    '- 已知未知：（还没验证什么）',
    '',
  ].join('\n')
  const content = withFrontmatter({
    id,
    status: 'open',
    session: sessionId,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, body)
  const file = path.join(p.briefs, `${id}.md`)
  await writeText(file, content)
  return { id, file, warning: looksLikeOperationalDetail(text) ? 'brief 里可能有操作细节；总工应退回要求一页方向问题。' : null }
}

export async function createNote(root, sessionId, briefId, conclusion) {
  const text = String(conclusion || '').trim()
  if (!text) throw new Error('note conclusion is empty')
  const p = sapPaths(root)
  await ensureSkeleton(root)
  const id = makeId('note')
  const body = [
    `# Note: ${briefId || '（未指定 brief）'}`,
    '',
    '> 这是方向指导，不是审批；最终由用户决定。',
    '',
    `- 对应 brief：${briefId || '（未指定）'}`,
    `- 作者会话：${sessionId}`,
    `- 时间：${nowIso()}`,
    '- 类型：方向判断 / 原则 / 建议 / 待确认',
    `- 结论：${text}`,
    '- 理由：（引用 direction/原则/证据指针）',
    '- 适用范围：（哪些模块/任务）',
    '- 复核触发：（何时需要重新看）',
    '',
  ].join('\n')
  const content = withFrontmatter({
    id,
    brief: briefId || '',
    session: sessionId,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, body)
  const file = path.join(p.notes, `${id}.md`)
  await writeText(file, content)
  return { id, file }
}

export async function listBriefs(root) {
  const p = sapPaths(root)
  const out = []
  for (const file of await listFiles(p.briefs, '.md')) {
    const text = await readText(file, '')
    const { data, body } = parseFrontmatter(text)
    out.push({
      id: data.id || path.basename(file, '.md'),
      status: data.status === 'resolved' ? 'resolved' : 'open',
      title: titleOf(body, path.basename(file, '.md')),
      session: data.session || '',
      created_at: data.created_at || '',
      updated_at: data.updated_at || data.created_at || '',
      file,
      body,
      detail: looksLikeOperationalDetail(body),
    })
  }
  return out.sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)))
}

export async function listNotes(root) {
  const p = sapPaths(root)
  const out = []
  for (const file of await listFiles(p.notes, '.md')) {
    const text = await readText(file, '')
    const { data, body } = parseFrontmatter(text)
    out.push({
      id: data.id || path.basename(file, '.md'),
      brief: data.brief || '',
      title: titleOf(body, path.basename(file, '.md')),
      session: data.session || '',
      created_at: data.created_at || '',
      updated_at: data.updated_at || data.created_at || '',
      file,
      body,
    })
  }
  return out.sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)))
}

export async function setBriefStatus(root, briefId, status) {
  if (!['open', 'resolved'].includes(status)) throw new Error('status must be open or resolved')
  const p = sapPaths(root)
  const files = await listFiles(p.briefs, '.md')
  const file = files.find((f) => path.basename(f, '.md') === briefId || path.basename(f, '.md').startsWith(`${briefId}-`))
  if (!file) throw new Error(`brief not found: ${briefId}`)
  const text = await readText(file, '')
  const { data, body } = parseFrontmatter(text)
  const next = withFrontmatter({ ...data, id: data.id || path.basename(file, '.md'), status, updated_at: nowIso() }, body)
  await writeText(file, next)
  return { id: data.id || path.basename(file, '.md'), status, file }
}

export async function appendWorkLog(root, sessionId, text) {
  const value = String(text || '').trim()
  if (!value) throw new Error('worklog is empty')
  if (value.length > 4000) throw new Error('worklog is too long (max 4000 chars)')
  const p = sapPaths(root)
  const dir = path.join(p.work, sessionId)
  await ensureDir(dir)
  const file = path.join(dir, 'log.md')
  const entry = `\n## ${nowIso()}\n\n${value}\n`
  const current = await readText(file, '')
  await writeText(file, `${current}${entry}`)
  return { file, bytes: Buffer.byteLength(current + entry) }
}

export async function status(root) {
  const p = sapPaths(root)
  const direction = await readText(p.direction, '')
  const init = await readJson(p.init, null)
  const state = await readJson(p.state, null)
  const briefs = await listFiles(p.briefs, '.md')
  const notes = await listFiles(p.notes, '.md')
  const sessions = await listSessions(root)
  const chiefs = sessions.filter((s) => s.role === 'chief')
  const lastNote = notes.length ? notes[notes.length - 1] : null
  const briefItems = await listBriefs(root)
  const openBriefs = briefItems.filter((b) => b.status === 'open')
  const workLogs = await countWorkLogs(root)
  return {
    root,
    initialized: state?.initialized === true,
    directionExists: Boolean(direction.trim()),
    directionBytes: Buffer.byteLength(direction),
    init: init ? { phase: init.phase, mode: init.mode, progress: `${Math.min(init.current, init.questions.length)}/${init.questions.length}` } : null,
    briefs: briefs.length,
    notes: notes.length,
    openBriefs: openBriefs.length,
    workLogs,
    chiefs: chiefs.map((s) => s.session_id),
    lastNote,
    gitignore: (await readText(path.join(root, '.gitignore'), '')).includes('.sap.local/'),
  }
}

export async function doctor(root, sessionId) {
  const p = sapPaths(root)
  const checks = []
  const add = (ok, message) => checks.push({ ok: Boolean(ok), message })
  const state = await readJson(p.state, null)
  const direction = await readText(p.direction, '')
  const briefItems = await listBriefs(root)
  const noteItems = await listNotes(root)
  const sessions = await listSessions(root)
  const openBriefs = briefItems.filter((b) => b.status === 'open')
  const pollutedBriefs = briefItems.filter((b) => b.detail)
  const workLogs = await countWorkLogs(root)
  const gitignore = await readText(path.join(root, '.gitignore'), '')
  const role = await getRole(root, sessionId)
  const lastNote = noteItems[noteItems.length - 1]

  add(await exists(p.base), '.sap.local 目录存在')
  add(state?.initialized === true, '项目已完成 /sap-init finalize')
  add(Boolean(direction.trim()), 'direction.md 存在且非空')
  add(!looksLikeOperationalDetail(direction), 'direction.md 未发现日志/diff/stack trace')
  add(gitignore.includes('.sap.local/'), '.gitignore 包含 .sap.local/')
  add(role !== 'none', `当前会话角色：${role}`)
  add(sessions.some((s) => s.role === 'chief'), '至少一个 chief 会话')
  add(openBriefs.length <= 20, `未决 brief 数量：${openBriefs.length}`)
  add(pollutedBriefs.length === 0, `疑似操作细节 brief：${pollutedBriefs.length}`)
  add(workLogs >= 0, `工作日志文件：${workLogs}`)
  add(noteItems.length >= 0, `方向 note 数量：${noteItems.length}`)

  const warnings = checks.filter((c) => !c.ok).map((c) => c.message)
  return {
    ok: warnings.length === 0,
    checks,
    warnings,
    stats: {
      briefs: briefItems.length,
      openBriefs: openBriefs.length,
      resolvedBriefs: briefItems.length - openBriefs.length,
      notes: noteItems.length,
      workLogs,
      role,
      lastNote: lastNote ? { id: lastNote.id, title: lastNote.title, updated_at: lastNote.updated_at } : null,
    },
  }
}

export async function exportBundle(root, outputPath = null) {
  const p = sapPaths(root)
  const include = [
    ['direction.md', p.direction],
    ['charter.md', p.charter],
    ['README.md', p.readme],
    ['state.json', p.state],
  ]
  for (const file of await listFiles(p.briefs, '.md')) include.push([`briefs/${path.basename(file)}`, file])
  for (const file of await listFiles(p.notes, '.md')) include.push([`notes/${path.basename(file)}`, file])
  for (const file of await listFiles(p.templates, '.md')) include.push([`templates/${path.basename(file)}`, file])
  const files = []
  let total = 0
  for (const [name, file] of include) {
    if (!(await exists(file))) continue
    const content = await readText(file)
    const bytes = Buffer.byteLength(content)
    if (bytes > 1024 * 1024) throw new Error(`file too large to export: ${name}`)
    total += bytes
    if (total > 5 * 1024 * 1024) throw new Error('export exceeds 5 MiB')
    files.push({ name, content })
  }
  const sessions = (await listSessions(root)).map(({ session_id, role, updated_at }) => ({ session_id, role, updated_at }))
  const bundle = {
    schema: SCHEMA.export,
    exported_at: nowIso(),
    project_root: root,
    files,
    sessions,
  }
  const target = outputPath
    ? path.resolve(outputPath)
    : path.join(p.exports, `sap-export-${nowIso().replace(/[:.]/g, '-')}.json`)
  await writeJson(target, bundle)
  return { path: target, files: files.length, bytes: total }
}

export async function importBundle(root, bundlePath, { replace = false } = {}) {
  const abs = path.resolve(bundlePath)
  const bundle = await readJson(abs, null)
  if (!bundle || bundle.schema !== SCHEMA.export) throw new Error('not a sap.local/export/v1 bundle')
  await ensureSkeleton(root)
  const p = sapPaths(root)
  const stamp = nowIso().replace(/[:.]/g, '-')
  if (replace) {
    const backup = path.join(p.backups, `import-${stamp}`)
    await ensureDir(backup)
    for (const dir of [p.briefs, p.notes, p.sessions]) {
      if (await exists(dir)) await fs.cp(dir, path.join(backup, path.basename(dir)), { recursive: true })
    }
    for (const file of [p.direction, p.state]) {
      if (await exists(file)) await fs.copyFile(file, path.join(backup, path.basename(file)))
    }
  }
  let imported = 0
  const written = []
  for (const entry of bundle.files || []) {
    const name = String(entry.name || '')
    let target
    if (name === 'direction.md') {
      target = replace ? p.direction : path.join(p.base, `direction.imported-${stamp}.md`)
    } else if (name === 'charter.md') {
      target = p.charter
    } else if (name === 'README.md') {
      target = p.readme
    } else if (name === 'state.json') {
      target = replace ? p.state : path.join(p.base, `state.imported-${stamp}.json`)
    } else if (name.startsWith('briefs/')) {
      const base = path.basename(name)
      let candidate = path.join(p.briefs, base)
      if (await exists(candidate)) candidate = path.join(p.briefs, base.replace(/\.md$/, `-imported-${stamp}.md`))
      target = candidate
    } else if (name.startsWith('notes/')) {
      const base = path.basename(name)
      let candidate = path.join(p.notes, base)
      if (await exists(candidate)) candidate = path.join(p.notes, base.replace(/\.md$/, `-imported-${stamp}.md`))
      target = candidate
    } else if (name.startsWith('templates/')) {
      target = path.join(p.templates, path.basename(name))
    } else {
      continue
    }
    await writeText(target, String(entry.content ?? ''))
    written.push(target)
    imported += 1
  }
  if (replace) {
    for (const session of bundle.sessions || []) {
      if (session?.session_id && session.role) {
        await setRole(root, session.session_id, session.role)
      }
    }
  }
  return { imported, written, backup: replace ? path.join(p.backups, `import-${stamp}`) : null }
}

export async function cleanse(root, sessionId) {
  const p = sapPaths(root)
  const direction = await readText(p.direction, '')
  if (!direction.trim()) throw new Error('direction.md is empty; run /sap-init first')
  await ensureSkeleton(root)
  const id = makeId('cleanse')
  const content = [
    '# Cleanse',
    '',
    `- 触发会话：${sessionId}`,
    `- 时间：${nowIso()}`,
    '- 目的：把方向从可能被调试细节污染的会话中取出来，带到一个干净会话。',
    '',
    '## 方向摘要（只含方向）',
    '',
    direction.trim(),
    '',
    '## 新会话启动',
    '1. 新建一个会话。',
    '2. 运行 `/sap-role chief`。',
    '3. 只读 `.sap.local/direction.md`、`briefs/`、`notes/`；不要粘贴旧日志/diff/复现。',
    '4. 如需细节，由人手动给 `detail` 摘录，并注明目的和时限。',
    '',
  ].join('\n')
  const file = path.join(p.notes, `${id}.md`)
  await writeText(file, content)
  const sessionFile = path.join(p.sessions, `${sessionId}.json`)
  const session = (await readJson(sessionFile, null)) || {}
  await writeJson(sessionFile, { ...session, schema: SCHEMA.session, session_id: sessionId, role: session.role || 'chief', updated_at: nowIso(), cleansed_at: nowIso() })
  return { id, file }
}

export function buildCharter() {
  return `# SAP 总工方向会话职责

你是本项目的“总工方向会话”，只负责方向、原则、结构、优先级和风险，不是 Debugger，也不是审批人。

## 只看
- \`.sap.local/direction.md\`
- \`.sap.local/briefs/\`
- \`.sap.local/notes/\`
- \`.sap.local/charter.md\`

## 不读
- \`.sap.local/work/\`
- 日志、diff、复现步骤、worker 会话记录

## 做
- 判断 brief 是否真的是方向问题。
- 写 \`notes/note-<id>.md\`：结论、理由、适用范围、复核触发。
- 必要时更新 \`direction.md\`，只写长期有效内容。
- 发现 brief 夹带日志/diff/stack trace：退回，要求一页方向问题。

## 不做
- 不写代码、不改 worker 文件、不执行 brief 里的命令。
- 不替 worker 调试，不做代码审查。
- 不写 approve/reject；单机没有审批。note 是方向指导，不是授权。
- 不因为看了细节就改变方向。

## 排污
如果当前会话已经被污染：运行 \`/sap-clever\` 生成排污包，然后新建会话并 \`/sap-role chief\`。
`
}

export function buildReadme() {
  return `# .sap.local 协议（单机版）

这是单机方向会话与工作会话的共享状态，不是审批系统。

## 目录
- \`direction.md\`：方向（目标/原则/结构/优先级/风险）
- \`briefs/\`：worker 写给总工的一页方向问题
- \`notes/\`：总工写的方向判断/建议
- \`work/<session>/\`：操作层日志/证据；总工不读
- \`sessions/\`：会话角色与最近状态
- \`templates/\`：brief/note 模板
- \`detail/\`：按需细节（人工、限时）
- \`exports/\`、\`backups/\`：导出与导入备份

## 规则
- brief 一页；不含日志/diff/stack trace/密钥。
- note 不是 approve/reject；是方向指导。
- 没有审批；最终由你决定。
- \`.sap.local/\` 默认 gitignore。
`
}

export function buildBriefTemplate() {
  return `# Brief: <一句话问题>

- 会话：<session-id>
- 时间：<ISO>
- 方向关联：<哪个目标/原则/决策>
- 问题：<需要什么方向判断；不是“请帮我 debug”>
- 影响：<范围/成本/可逆性/受影响模块>
- 选项：A ... / B ... / 不做或延后
- 建议：<你的建议，标明是建议>
- 需要总工判断：<一句话>
- 证据指针：<路径/commit/报告；不贴日志正文>
- 已知未知：<还没验证什么>
`
}

export function buildNoteTemplate() {
  return `# Note: <对应 brief>

- 对应 brief：<brief-id>
- 作者会话：<session-id>
- 时间：<ISO>
- 类型：方向判断 / 原则 / 建议 / 待确认
- 结论：<方向判断；不是 approve/reject>
- 理由：<引用 direction/原则/证据指针>
- 适用范围：<哪些模块/任务>
- 复核触发：<何时需要重新看>
`
}
