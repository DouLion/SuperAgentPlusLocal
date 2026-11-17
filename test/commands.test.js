import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'
import { setRole } from '../lib/sap.js'

function makeHarness(cwd, webServer, workspaceRegistry) {
  const commands = new Map()
  const sections = []
  const ctx = {
    commands: {
      register(definition) {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      },
    },
    on() {
      return () => {}
    },
    effect(fn) {
      try { fn() } catch {}
    },
    inject(_names, fn) {
      try { fn() } catch {}
    },
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'workspaceRegistry') return workspaceRegistry
      return undefined
    },
    logger: { warn() {} },
  }
  apply(ctx, {})
  const agent = {
    id: 'sess-chief',
    session: { header: { cwd } },
    ctx: {
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {}
        },
      },
    },
  }
  return { commands, sections, agent }
}

function fakeExchange(method, url, body) {
  let status = 0
  let payload = ''
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  const res = {
    writeHead(code) { status = code },
    end(value) { payload = String(value || '') },
  }
  return { req, res, get status() { return status }, get json() { return payload ? JSON.parse(payload) : null } }
}

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sap-cmd-'))
  await fs.mkdir(path.join(root, '.git'))
  return root
}

async function makeChief(root, agent) {
  await setRole(root, agent.id, 'chief')
}

test('role route persists none/chief/worker for the session', async () => {
  const root = await tempRoot()
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const { commands, agent } = makeHarness(root, webServer)
  await makeChief(root, agent)
  const init = commands.get('sap-init')
  await init.handler({ agent, rawInput: '' })
  for (const answer of ['目标', '重点', '非目标', '约束', '取舍', '停']) {
    await init.handler({ agent, rawInput: `answer ${answer}` })
  }
  await init.handler({ agent, rawInput: 'finalize' })
  const route = routes.find((item) => item.path === '/sap-local/role')
  assert.ok(route)

  let exchange = fakeExchange('GET', `/sap-local/role?sessionId=sess-chief&cwd=${encodeURIComponent(root)}`)
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 200)
  assert.equal(exchange.json.role, 'chief')
  assert.equal(exchange.json.initialized, true)

  exchange = fakeExchange('PUT', '/sap-local/role', { sessionId: 'sess-chief', cwd: root, role: 'none' })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 200)
  const file = path.join(root, '.sap.local', 'sessions', 'sess-chief.json')
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).role, 'none')

  exchange = fakeExchange('GET', `/sap-local/role?sessionId=sess-chief&cwd=${encodeURIComponent(root)}`)
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.json.role, 'none')
  await fs.rm(root, { recursive: true, force: true })
})

test('qingshen mode writer adds SAP modes and backs up', async () => {
  const root = await tempRoot()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sap-profile-'))
  const qdir = path.join(profile, 'node_modules', 'dsh-qingshen')
  await fs.mkdir(qdir, { recursive: true })
  await fs.writeFile(path.join(qdir, 'modes.json'), JSON.stringify({ default: 'zhangfei', modes: [{ id: 'zhangfei', label: '张飞', prompt: 'x' }] }), 'utf8')
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = profile
  try {
    const { commands, agent } = makeHarness(root)
    const result = await commands.get('sap-qingshen').handler({ agent, rawInput: '' })
    assert.equal(result.kind, 'success')
    const modes = JSON.parse(await fs.readFile(path.join(qdir, 'modes.json'), 'utf8'))
    assert.ok(modes.modes.some((mode) => mode.id === 'sap-chief'))
    assert.ok(modes.modes.some((mode) => mode.id === 'sap-worker'))
    const backups = (await fs.readdir(qdir)).filter((name) => name.includes('.bak-'))
    assert.ok(backups.length >= 1)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(profile, { recursive: true, force: true })
  }
})

test('command surface covers init/export/import/clever and injects chief protocol', async () => {
  const root = await tempRoot()
  const { commands, sections, agent } = makeHarness(root)
  for (const name of ['sap-init', 'sap-export', 'sap-import', 'sap-clever', 'sap-brief', 'sap-note', 'sap-status']) {
    assert.ok(commands.has(name), `missing ${name}`)
  }
  assert.equal(commands.has('sap-role'), false)
  await makeChief(root, agent)
  const init = commands.get('sap-init')
  let result = await init.handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'success')
  for (const answer of ['目标', '重点', '非目标', '约束', '取舍', '停']) {
    result = await init.handler({ agent, rawInput: `answer ${answer}` })
    assert.equal(result.kind, 'success')
  }
  result = await init.handler({ agent, rawInput: 'finalize' })
  assert.equal(result.kind, 'success')
  assert.ok(sections.some((section) => section.text.includes('总工方向会话')))

  const brief = await commands.get('sap-brief').handler({ agent, rawInput: '要不要改公共接口？' })
  assert.equal(brief.kind, 'success')
  const briefId = /brief-[a-z0-9-]+/.exec(brief.text)?.[0]
  assert.ok(briefId)

  const note = await commands.get('sap-note').handler({ agent, rawInput: `${briefId} 保持兼容` })
  assert.equal(note.kind, 'success')

  const status = await commands.get('sap-status').handler({ agent, rawInput: '' })
  assert.equal(status.kind, 'success')
  assert.match(status.text, /briefs：1/)

  const exported = await commands.get('sap-export').handler({ agent, rawInput: path.join(root, 'bundle.json') })
  assert.equal(exported.kind, 'success')
  assert.ok(await fs.stat(path.join(root, 'bundle.json')))

  const cleanse = await commands.get('sap-clever').handler({ agent, rawInput: '' })
  assert.equal(cleanse.kind, 'success')
  assert.match(cleanse.text, /排污包/)
  await fs.rm(root, { recursive: true, force: true })
})

test('init route starts the interview when uninitialized', async () => {
  const root = await tempRoot()
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const { agent } = makeHarness(root, webServer)
  await makeChief(root, agent)
  const route = routes.find((item) => item.path === '/sap-local/init')
  assert.ok(route)
  const exchange = fakeExchange('POST', '/sap-local/init', { sessionId: agent.id, cwd: root })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 200)
  assert.equal(exchange.json.initialized, false)
  assert.ok(exchange.json.init.question)
  await fs.rm(root, { recursive: true, force: true })
})

test('init route refuses a non-chief session', async () => {
  const root = await tempRoot()
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const { agent } = makeHarness(root, webServer)
  const route = routes.find((item) => item.path === '/sap-local/init')
  const exchange = fakeExchange('POST', '/sap-local/init', { sessionId: agent.id, cwd: root })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 409)
  assert.equal(exchange.json.error, 'chief-role-required')
  await fs.rm(root, { recursive: true, force: true })
})

test('role route allows chief selection before initialization', async () => {
  const root = await tempRoot()
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const { agent } = makeHarness(root, webServer)
  const route = routes.find((item) => item.path === '/sap-local/role')
  const exchange = fakeExchange('PUT', '/sap-local/role', { sessionId: agent.id, cwd: root, role: 'chief' })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 200)
  assert.ok(await fs.stat(path.join(root, '.sap.local', 'sessions', `${agent.id}.json`)))
  await fs.rm(root, { recursive: true, force: true })
})

test('sap-init command refuses a non-chief session', async () => {
  const root = await tempRoot()
  const { commands, agent } = makeHarness(root)
  const result = await commands.get('sap-init').handler({ agent, rawInput: '' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /总工/)
  await fs.rm(root, { recursive: true, force: true })
})

test('brief status, notes, worklog and doctor close the loop', async () => {
  const root = await tempRoot()
  const { commands, agent } = makeHarness(root)
  await makeChief(root, agent)
  const init = commands.get('sap-init')
  await init.handler({ agent, rawInput: '' })
  for (const answer of ['目标', '重点', '非目标', '约束', '取舍', '停']) {
    await init.handler({ agent, rawInput: `answer ${answer}` })
  }
  await init.handler({ agent, rawInput: 'finalize' })

  const brief = await commands.get('sap-brief').handler({ agent, rawInput: '是否调整公共接口？' })
  assert.equal(brief.kind, 'success')
  const briefId = /brief-[a-z0-9-]+/.exec(brief.text)?.[0]

  const notes = await commands.get('sap-notes').handler({ agent, rawInput: '' })
  assert.match(notes.text, new RegExp(briefId))

  const resolved = await commands.get('sap-brief-status').handler({ agent, rawInput: `${briefId} resolved` })
  assert.equal(resolved.kind, 'success')
  const afterResolve = await commands.get('sap-notes').handler({ agent, rawInput: '' })
  assert.doesNotMatch(afterResolve.text, new RegExp(briefId))

  const note = await commands.get('sap-note').handler({ agent, rawInput: `${briefId} 保持兼容` })
  assert.equal(note.kind, 'success')

  const log = await commands.get('sap-worklog').handler({ agent, rawInput: '完成接口兼容检查' })
  assert.equal(log.kind, 'success')
  assert.ok(await fs.stat(path.join(root, '.sap.local', 'work', agent.id, 'log.md')))

  const doctor = await commands.get('sap-doctor').handler({ agent, rawInput: '' })
  assert.equal(doctor.kind, 'success')
  assert.match(doctor.text, /通过|有警告/)
  assert.match(doctor.text, /未决 brief：0/)
  await fs.rm(root, { recursive: true, force: true })
})

test('brief from file imports the file body', async () => {
  const root = await tempRoot()
  const { commands, agent } = makeHarness(root)
  await makeChief(root, agent)
  const init = commands.get('sap-init')
  await init.handler({ agent, rawInput: '' })
  for (const answer of ['目标', '重点', '非目标', '约束', '取舍', '停']) {
    await init.handler({ agent, rawInput: `answer ${answer}` })
  }
  await init.handler({ agent, rawInput: 'finalize' })
  const file = path.join(root, 'draft-brief.md')
  await fs.writeFile(file, '方向问题：是否拆分模块？\n\n影响：发布节奏。\n', 'utf8')
  const result = await commands.get('sap-brief').handler({ agent, rawInput: `from ${file}` })
  assert.equal(result.kind, 'success')
  const briefId = /brief-[a-z0-9-]+/.exec(result.text)?.[0]
  const text = await fs.readFile(path.join(root, '.sap.local', 'briefs', `${briefId}.md`), 'utf8')
  assert.match(text, /是否拆分模块？/)
  await fs.rm(root, { recursive: true, force: true })
})

test('workspace registry resolves root when client has no cwd', async () => {
  const root = await tempRoot()
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const registry = {
    list() {
      return [{ path: root, sessionIds: ['sess-chief'] }]
    },
  }
  const { agent } = makeHarness('', webServer, registry)
  await makeChief(root, agent)
  const route = routes.find((item) => item.path === '/sap-local/init')
  const exchange = fakeExchange('POST', '/sap-local/init', { sessionId: agent.id })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 200)
  assert.ok(await fs.stat(path.join(root, '.sap.local', 'init.json')))
  await fs.rm(root, { recursive: true, force: true })
})

test('init route refuses to guess a root without cwd or workspace', async () => {
  const routes = []
  const webServer = {
    register(definition) {
      routes.push(definition)
      return () => {}
    },
  }
  const { agent } = makeHarness('', webServer)
  const route = routes.find((item) => item.path === '/sap-local/init')
  const exchange = fakeExchange('POST', '/sap-local/init', { sessionId: agent.id })
  await route.handler(exchange.req, exchange.res)
  assert.equal(exchange.status, 409)
  assert.equal(exchange.json.error, 'cannot-resolve-root')
})


