import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  answerInit,
  cleanse,
  createBrief,
  createNote,
  ensureSkeleton,
  exportBundle,
  finalizeInit,
  findRoot,
  getRole,
  importBundle,
  initStatus,
  readText,
  sapPaths,
  startInit,
} from '../lib/sap.js'

async function tempProject(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `sap-${name}-`))
  await fs.mkdir(path.join(root, '.git'))
  return root
}

test('findRoot finds repository root from nested cwd', async () => {
  const root = await tempProject('root')
  const nested = path.join(root, 'src', 'deep')
  await fs.mkdir(nested, { recursive: true })
  assert.equal(await findRoot(nested), root)
  await fs.rm(root, { recursive: true, force: true })
})

test('init flow creates direction, charter, templates and chief role', async () => {
  const root = await tempProject('init')
  const started = await startInit(root, 'sess-chief', 'new')
  assert.equal(started.state.mode, 'new')
  assert.equal(started.question.id, 'q1')
  const answers = ['为目标用户解决慢', '分页接口', '不做缓存', '不改旧接口', '先正确后速度', '错误率升高就停']
  for (const answer of answers) await answerInit(root, answer)
  const result = await finalizeInit(root, 'sess-chief')
  const direction = await readText(result.direction)
  assert.match(direction, /为目标用户解决慢/)
  assert.match(direction, /不做缓存/)
  assert.equal(await getRole(root, 'sess-chief'), 'chief')
  const p = sapPaths(root)
  assert.match(await readText(p.charter), /总工方向会话/)
  assert.match(await readText(path.join(p.templates, 'brief.md')), /Brief/)
  assert.equal((await initStatus(root)).initialized, true)
  await fs.rm(root, { recursive: true, force: true })
})

test('brief and note are written and brief warns on operational detail', async () => {
  const root = await tempProject('brief')
  await ensureSkeleton(root)
  const brief = await createBrief(root, 'sess-worker', '要不要改公共接口？\nTraceback: boom')
  assert.ok(brief.file.endsWith('.md'))
  assert.match(brief.warning, /操作细节/)
  const note = await createNote(root, 'sess-chief', brief.id, '先保持兼容，不做破坏性变更')
  assert.ok(note.file.endsWith('.md'))
  assert.match(await readText(note.file), /不是审批/)
  await fs.rm(root, { recursive: true, force: true })
})

test('export/import merge keeps direction separate and import --replace backs up', async () => {
  const source = await tempProject('export')
  await startInit(source, 'sess-chief', 'new')
  for (const answer of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) await answerInit(source, answer)
  await finalizeInit(source, 'sess-chief')
  await createNote(source, 'sess-chief', 'brief-x', '方向结论')
  const bundle = await exportBundle(source, path.join(source, 'bundle.json'))

  const target = await tempProject('import')
  await ensureSkeleton(target)
  const merged = await importBundle(target, bundle.path, { replace: false })
  assert.ok(merged.imported >= 1)
  const imported = await fs.readdir(sapPaths(target).notes)
  assert.ok(imported.length >= 1)
  assert.match(await readText(path.join(sapPaths(target).notes, imported[0])), /方向结论/)
  assert.equal((await fs.readdir(sapPaths(target).base)).includes('direction.md'), false)
  assert.ok((await fs.readdir(sapPaths(target).base)).some((name) => name.startsWith('direction.imported-')))

  const replaced = await importBundle(target, bundle.path, { replace: true })
  assert.ok(replaced.backup)
  assert.ok(await fs.stat(replaced.backup))
  assert.match(await readText(sapPaths(target).direction), /a1/)
  await fs.rm(source, { recursive: true, force: true })
  await fs.rm(target, { recursive: true, force: true })
})

test('cleanse writes a direction-only note', async () => {
  const root = await tempProject('cleanse')
  await startInit(root, 'sess-chief', 'new')
  for (const answer of ['目标', '重点', '非目标', '约束', '取舍', '停']) await answerInit(root, answer)
  await finalizeInit(root, 'sess-chief')
  const result = await cleanse(root, 'sess-chief')
  const text = await readText(result.file)
  assert.match(text, /方向摘要/)
  assert.match(text, /不要粘贴旧日志/)
  const session = JSON.parse(await readText(path.join(sapPaths(root).sessions, 'sess-chief.json')))
  assert.ok(session.cleansed_at)
  await fs.rm(root, { recursive: true, force: true })
})
