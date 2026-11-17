/**
 * SAP Local — browser half.
 * 操作条：角色切换 + 常用操作面板。每次操作都会显示成功/失败回执。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sap-local',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect } = React

    const ROLE_ENDPOINT = '/sap-local/role'
    const OVERVIEW_ENDPOINT = '/sap-local/overview'
    const ROLES = [
      { id: 'none', label: '无角色' },
      { id: 'chief', label: '总工' },
      { id: 'worker', label: '工作' },
    ]
    const ACTIONS = [
      { id: 'brief', label: '写 Brief' },
      { id: 'note', label: '写 Note' },
      { id: 'worklog', label: '工作日志' },
      { id: 'status', label: '状态' },
      { id: 'doctor', label: '医生' },
      { id: 'chief', label: '总工' },
      { id: 'export', label: '导出' },
      { id: 'cleanse', label: '排污' },
    ]

    function sessionIdOf(props) {
      const session = props && props.session
      return (session && (session.sessionId || session.id)) || (props && props.sessionId) || ''
    }

    function cwdOf(props) {
      const session = props && props.session
      return (session && (session.cwd || (session.header && session.header.cwd) || (session.workspace && session.workspace.cwd))) || ''
    }

    function useDark() {
      const [dark, setDark] = useState(() => {
        try {
          const attr = document.documentElement.getAttribute('data-theme')
          if (attr === 'dark') return true
          if (attr === 'light') return false
          return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        } catch { return false }
      })
      useEffect(() => {
        const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        const update = () => {
          try {
            const attr = document.documentElement.getAttribute('data-theme')
            setDark(attr === 'dark' ? true : attr === 'light' ? false : !!(mq && mq.matches))
          } catch {}
        }
        if (mq) {
          if (mq.addEventListener) mq.addEventListener('change', update)
          else if (mq.addListener) mq.addListener(update)
        }
        const obs = new MutationObserver(update)
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
        return () => {
          if (mq) {
            if (mq.removeEventListener) mq.removeEventListener('change', update)
            else if (mq.removeListener) mq.removeListener(update)
          }
          obs.disconnect()
        }
      }, [])
      return dark
    }

    const PALETTE = {
      dark: { bg: '#20242a', border: '#3a4048', text: '#c9ced6', muted: '#9aa1ab', onBg: '#6991d6', onText: '#ffffff', panel: '#16191d', danger: '#e5a0a0' },
      light: { bg: '#ffffff', border: '#d0d5dd', text: '#344054', muted: '#667085', onBg: '#2563eb', onText: '#ffffff', panel: '#f9fafb', danger: '#d92d20' },
    }

    function SapBar(props) {
      const sessionId = sessionIdOf(props)
      const cwd = cwdOf(props)
      const dark = useDark()
      const C = PALETTE[dark ? 'dark' : 'light']
      const [role, setRole] = useState('none')
      const [initialized, setInitialized] = useState(false)
      const [init, setInit] = useState(null)
      const [openBriefs, setOpenBriefs] = useState(0)
      const [chief, setChief] = useState(null)
      const [diag, setDiag] = useState('')
      const [panel, setPanel] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [overview, setOverview] = useState(null)
      const [initAnswer, setInitAnswer] = useState('')
      const [briefQuestion, setBriefQuestion] = useState('')
      const [noteBriefId, setNoteBriefId] = useState('')
      const [noteConclusion, setNoteConclusion] = useState('')
      const [worklogText, setWorklogText] = useState('')
      const [importPath, setImportPath] = useState('')
      const [importReplace, setImportReplace] = useState(false)

      const api = async (path, body) => {
        const res = await fetch(path, {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'same-origin',
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify({ ...body, sessionId, cwd }),
        })
        let data = null
        try { data = await res.json() } catch {}
        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && data.error) || `请求失败（${res.status}）`)
        }
        return data
      }

      const load = async () => {
        if (!sessionId) return
        try {
          const url = `${ROLE_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`
          const res = await fetch(url, { credentials: 'same-origin' })
          if (!res.ok) return
          const data = await res.json()
          setRole(data.role === 'chief' || data.role === 'worker' ? data.role : 'none')
          setInitialized(!!data.initialized)
          setInit(data.init || null)
          setOpenBriefs(Number(data.openBriefs) || 0)
          setChief(data.chief || null)
        } catch {}
      }

      const loadOverview = async () => {
        if (!sessionId) return null
        try {
          const data = await api(`${OVERVIEW_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`)
          setOverview(data)
          setRole(data.role === 'chief' || data.role === 'worker' ? data.role : 'none')
          setInitialized(!!data.initialized)
          setInit(data.init || null)
          setChief(data.chief || null)
          setOpenBriefs(Number(data.briefs?.length) || 0)
          return data
        } catch (error) {
          setNotice(String(error.message || error))
          return null
        }
      }

      useEffect(() => {
        let alive = true
        const run = async () => { if (alive) await load() }
        run()
        const timer = setInterval(() => { if (alive) run() }, 10000)
        return () => { alive = false; clearInterval(timer) }
      }, [sessionId, cwd])

      useEffect(() => {
        if (init) setInitAnswer(init.answer || '')
      }, [init])

      const runAction = async (action) => {
        setBusy(true)
        setNotice('')
        try {
          const result = await action()
          await load()
          return result
        } catch (error) {
          const message = String(error.message || error)
          setNotice(message)
          setDiag(message)
          return null
        } finally {
          setBusy(false)
        }
      }

      const pickRole = (next) => runAction(async () => {
        const result = await api(ROLE_ENDPOINT, { role: next })
        const label = ROLES.find((item) => item.id === next)?.label || next
        setNotice('')
        setDiag(`已选择：${label}`)
        return result
      })

      const openPanel = async (name) => {
        if (!initialized && !['init', 'status'].includes(name)) {
          setNotice('尚未初始化；请先选择“总工”并点击“初始化”。')
          setDiag('尚未初始化')
          return
        }
        setPanel(name)
        setNotice('')
        setDiag('')
        if (['init', 'reinit', 'note', 'status', 'doctor', 'chief'].includes(name)) {
          await loadOverview()
        }
      }

      const startInit = () => runAction(async () => {
        const data = await api('/sap-local/init-start', {})
        setInit(data.init)
        setNotice('已开始初始化；请回答当前问题。')
        return data
      })

      const answerInit = (confirmPrefill) => runAction(async () => {
        const data = await api('/sap-local/init-answer', { answer: confirmPrefill ? (init?.answer || '') : initAnswer })
        setInit(data.init)
        setNotice(confirmPrefill ? '已确认预填回答。' : '已记录回答。')
        return data
      })

      const finalizeInit = () => runAction(async () => {
        await api('/sap-local/init-finalize', {})
        setInitialized(true)
        setInit(null)
        setNotice('初始化完成。')
        return null
      })

      const reinit = () => runAction(async () => {
        const data = await api('/sap-local/init-reinit', {})
        setInit(data.init)
        setNotice(`已开始重新共识；旧方向归档：${data.archive}`)
        return data
      })

      const submitBrief = () => runAction(async () => {
        const data = await api('/sap-local/brief', { question: briefQuestion })
        setBriefQuestion('')
        setNotice(`已写 brief：${data.id}${data.warning ? `；${data.warning}` : ''}`)
        return data
      })

      const submitNote = () => runAction(async () => {
        const data = await api('/sap-local/note', { briefId: noteBriefId, conclusion: noteConclusion })
        setNoteConclusion('')
        setNotice(`已写 note：${data.id}`)
        await loadOverview()
        return data
      })

      const submitWorklog = () => runAction(async () => {
        const data = await api('/sap-local/worklog', { text: worklogText })
        setWorklogText('')
        setNotice(`已记录工作日志：${data.file}`)
        return data
      })

      const chiefTakeover = () => runAction(async () => {
        const data = await api('/sap-local/chief', { action: 'takeover' })
        setNotice('已接管总工方向会话。')
        return data
      })

      const exportBundle = () => runAction(async () => {
        const data = await api('/sap-local/export', {})
        setNotice(`已导出：${data.path}`)
        return data
      })

      const importBundle = () => runAction(async () => {
        const data = await api('/sap-local/import', { path: importPath, replace: importReplace })
        setNotice(`已导入 ${data.imported} 个文件${data.backup ? `；备份：${data.backup}` : ''}`)
        return data
      })

      const cleanse = () => runAction(async () => {
        const data = await api('/sap-local/cleanse', {})
        setNotice(`已生成排污包：${data.file}`)
        return data
      })

      const bar = {
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        padding: '4px 6px', borderRadius: 10,
        border: `1px solid ${C.border}`, background: C.bg,
        fontSize: 12, lineHeight: '20px', userSelect: 'none',
      }
      const label = { opacity: 0.75, marginRight: 2, color: C.muted }
      const button = (on, disabled) => ({
        border: 'none', borderRadius: 7, padding: '3px 10px', fontSize: 12,
        lineHeight: '18px', cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: on ? 600 : 400,
        background: on ? C.onBg : 'transparent',
        color: on ? C.onText : C.text,
        opacity: disabled ? 0.5 : 1,
      })
      const smallButton = button(false, busy)
      const chiefHint = chief && chief.status !== 'online'
        ? (chief.status === 'none' ? '无总工' : `总工${chief.status === 'stale' ? '状态过期' : '离线'}`)
        : null
      const hint = !initialized
        ? (role !== 'chief' ? '请先选择“总工”再初始化' : '点击“初始化”开始')
        : (chiefHint || (openBriefs > 0 ? `未决 brief ${openBriefs}` : (diag || '已就绪')))

      const inputStyle = {
        width: '100%', boxSizing: 'border-box', borderRadius: 8,
        border: `1px solid ${C.border}`, background: C.bg, color: C.text,
        padding: '6px 8px', fontSize: 12, lineHeight: '18px', resize: 'vertical',
      }
      const panelStyle = {
        marginTop: 6, borderRadius: 10, border: `1px solid ${C.border}`,
        background: C.panel, padding: '8px 10px', display: 'flex',
        flexDirection: 'column', gap: 6, fontSize: 12, color: C.text,
      }
      const titleRow = { display: 'flex', alignItems: 'center', gap: 8 }
      const noticeStyle = { color: C.muted, whiteSpace: 'pre-wrap' }
      const errorStyle = { color: C.danger, whiteSpace: 'pre-wrap' }
      const listRow = { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }

      const renderPanel = () => {
        if (!panel) return null
        const close = h('button', {
          type: 'button', style: { ...smallButton, marginLeft: 'auto' },
          onClick: () => setPanel(null),
        }, '关闭')
        const title = h('span', { style: { fontWeight: 600 } }, {
          init: '初始化', reinit: '重新共识', brief: '写 Brief', note: '写 Note',
          worklog: '工作日志', status: '状态', doctor: '医生', chief: '总工',
          export: '导出 / 导入', cleanse: '排污',
        }[panel] || '操作')

        if (panel === 'init') {
          const body = role !== 'chief'
            ? h('div', { style: noticeStyle }, '只有总工方向会话可以初始化。')
            : !init
              ? h('div', { style: { display: 'flex', gap: 6 }, onClick: undefined },
                  h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: startInit }, '开始初始化'))
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', null, `第 ${Math.min(init.current + 1, init.total)}/${init.total} 问`),
                  h('div', { style: { whiteSpace: 'pre-wrap' } }, init.question),
                  h('textarea', {
                    style: { ...inputStyle, minHeight: 72 },
                    value: initAnswer,
                    onChange: (e) => setInitAnswer(e.target.value),
                  }),
                  h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => answerInit(false) }, '提交回答'),
                    h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => answerInit(true) }, '确认预填'),
                    init.phase === 'ready'
                      ? h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: finalizeInit }, '完成初始化')
                      : null,
                    h('button', { type: 'button', style: smallButton, disabled: busy, onClick: reinit }, '重新共识'),
                  ))
          return h('div', { style: panelStyle }, h('div', { style: titleRow }, title, close), body)
        }

        if (panel === 'reinit') {
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('div', null, '归档旧方向并保留 briefs/notes/work，按旧答案预填后重新共识。'),
            h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: reinit }, '开始重新共识'))
        }

        if (panel === 'brief') {
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('textarea', {
              style: { ...inputStyle, minHeight: 84 }, value: briefQuestion,
              placeholder: '一句话方向问题；不要贴日志/diff', onChange: (e) => setBriefQuestion(e.target.value),
            }),
            h('button', { type: 'button', style: button(true, busy), disabled: busy || !briefQuestion.trim(), onClick: submitBrief }, '写 Brief'))
        }

        if (panel === 'note') {
          const briefs = overview?.briefs || []
          const effectiveBriefId = noteBriefId || briefs[0]?.id || ''
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            briefs.length === 0
              ? h('div', { style: noticeStyle }, '没有未决 brief。')
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' } },
                    briefs.map((b) => h('button', {
                      key: b.id, type: 'button',
                      style: button(effectiveBriefId === b.id, busy),
                      onClick: () => setNoteBriefId(b.id),
                    }, `${b.id} ${b.title}`))),
                  h('textarea', {
                    style: { ...inputStyle, minHeight: 72 }, value: noteConclusion,
                    placeholder: '方向判断；不是 approve/reject', onChange: (e) => setNoteConclusion(e.target.value),
                  }),
                  h('button', { type: 'button', style: button(true, busy), disabled: busy || !effectiveBriefId || !noteConclusion.trim(), onClick: submitNote }, '写 Note')))
        }

        if (panel === 'worklog') {
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('textarea', {
              style: { ...inputStyle, minHeight: 72 }, value: worklogText,
              placeholder: '实现/调试记录；总工不读', onChange: (e) => setWorklogText(e.target.value),
            }),
            h('button', { type: 'button', style: button(true, busy), disabled: busy || !worklogText.trim(), onClick: submitWorklog }, '记录'))
        }

        if (panel === 'status') {
          const s = overview?.status
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            s
              ? h('div', { style: listRow },
                  h('div', null, `项目：${s.root}`),
                  h('div', null, `初始化：${s.initialized ? '完成' : '未开始/进行中'}`),
                  h('div', null, `总工：${s.chief?.status || 'none'}${s.chief?.session_id ? `（${s.chief.session_id}）` : ''}`),
                  h('div', null, `briefs：${s.briefs}（未决 ${s.openBriefs}）；notes：${s.notes}；work logs：${s.workLogs}`))
              : h('div', { style: noticeStyle }, '加载中…'),
            h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => loadOverview() }, '刷新'))
        }

        if (panel === 'doctor') {
          const d = overview?.doctor
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            d
              ? h('div', { style: listRow },
                  h('div', { style: { fontWeight: 600 } }, d.ok ? '通过' : '有警告'),
                  ...d.checks.map((c, i) => h('div', { key: i }, `${c.ok ? '✓' : '✗'} ${c.message}`)))
              : h('div', { style: noticeStyle }, '加载中…'),
            h('button', { type: 'button', style: smallButton, disabled: busy, onClick: () => loadOverview() }, '刷新'))
        }

        if (panel === 'chief') {
          const c = overview?.chief || chief
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('div', null, `状态：${c?.status || 'none'}`),
            c?.session_id ? h('div', null, `总会话：${c.session_id}`) : null,
            h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: chiefTakeover }, '接管总工'),
            h('div', { style: noticeStyle }, '总工离线/过期时，当前会话可接管。'))
        }

        if (panel === 'export') {
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: exportBundle }, '导出方向层')),
            h('div', null, '导入 bundle（JSON）：'),
            h('input', {
              style: inputStyle, value: importPath, placeholder: '/path/to/sap-export.json',
              onChange: (e) => setImportPath(e.target.value),
            }),
            h('label', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: importReplace, onChange: (e) => setImportReplace(e.target.checked) }),
              '覆盖（先备份）'),
            h('button', { type: 'button', style: smallButton, disabled: busy || !importPath.trim(), onClick: importBundle }, '导入'))
        }

        if (panel === 'cleanse') {
          return h('div', { style: panelStyle },
            h('div', { style: titleRow }, title, close),
            h('div', null, '生成方向摘要包；建议随后新建会话并选择“总工”。'),
            h('button', { type: 'button', style: button(true, busy), disabled: busy, onClick: cleanse }, '生成排污包'))
        }

        return null
      }

      return h('div', {
        style: { width: '100%', maxWidth: 'var(--dsh-composer-card-max-width, 952px)', margin: '0 auto', display: 'flex', justifyContent: 'flex-end', paddingRight: 2, marginBottom: 6 },
      },
        h('div', { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { style: bar, title: 'SAP 单机：角色 + 操作台' },
            h('span', { style: label }, 'SAP v0.5.1'),
            ...ROLES.map((item) => h('button', {
              key: item.id, type: 'button', style: button(role === item.id, busy),
              disabled: busy, onClick: () => pickRole(item.id),
            }, item.label)),
            initialized
              ? h('button', {
                  key: 'reinit', type: 'button', style: button(panel === 'reinit', busy),
                  disabled: busy, onClick: () => openPanel('reinit'),
                }, '重新共识')
              : h('button', {
                  key: 'init', type: 'button', style: button(panel === 'init', busy),
                  disabled: busy, onClick: () => openPanel('init'),
                }, '初始化'),
            ...ACTIONS.map((item) => h('button', {
              key: item.id, type: 'button', style: button(panel === item.id, busy),
              disabled: busy, onClick: () => openPanel(item.id),
            }, item.label)),
            h('span', { style: { marginLeft: 'auto', opacity: 0.6, fontSize: 10, whiteSpace: 'nowrap', color: C.muted } }, hint),
          ),
          renderPanel(),
          notice ? h('div', { style: { ...errorStyle, padding: '0 4px' } }, notice) : null,
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'sap-local',
        order: 11,
        inject: () => ({}),
      }, SapBar))
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.name = 'sap-local'
    return module.exports
  },
})
