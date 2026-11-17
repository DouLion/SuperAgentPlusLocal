/**
 * SAP Local — browser half.
 * Composer dock bar: 无角色 / 总工 / 工作. The host persists the role per session;
 * "无角色" means this session does not participate in SAP at all.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sap-local',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef } = React

    const ENDPOINT = '/sap-local/role'
    const ROLES = [
      { id: 'none', label: '无角色' },
      { id: 'chief', label: '总工' },
      { id: 'worker', label: '工作' },
    ]

    function sessionIdOf(props) {
      const session = props && props.session
      return (session && (session.id || session.sessionId)) || (props && props.sessionId) || ''
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
      dark: { bg: '#20242a', border: '#3a4048', text: '#c9ced6', muted: '#9aa1ab', onBg: '#6991d6', onText: '#ffffff' },
      light: { bg: '#ffffff', border: '#d0d5dd', text: '#344054', muted: '#667085', onBg: '#2563eb', onText: '#ffffff' },
    }

    function SapBar(props) {
      const sessionId = sessionIdOf(props)
      const cwd = cwdOf(props)
      const dark = useDark()
      const C = PALETTE[dark ? 'dark' : 'light']
      const [role, setRole] = useState('none')
      const [initialized, setInitialized] = useState(false)
      const [init, setInit] = useState(null)
      const [diag, setDiag] = useState('')
      const initializedRef = useRef(false)

      const load = async () => {
        if (!sessionId) return
        try {
          const url = `${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`
          const res = await fetch(url, { credentials: 'same-origin' })
          if (!res.ok) return
          const data = await res.json()
          setRole(data.role === 'chief' || data.role === 'worker' ? data.role : 'none')
          setInitialized(!!data.initialized)
          setInit(data.init || null)
          initializedRef.current = !!data.initialized
        } catch {}
      }

      useEffect(() => {
        let alive = true
        const run = async () => { if (alive) await load() }
        run()
        const timer = setInterval(() => {
          if (alive && !initializedRef.current) run()
        }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [sessionId, cwd])

      const startInit = async () => {
        setDiag('初始化中…')
        try {
          const res = await fetch('/sap-local/init', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, cwd }),
          })
          if (!res.ok) { setDiag('init ' + res.status); return }
          const data = await res.json()
          setInit(data.init || null)
          setDiag(data.initialized ? '已初始化' : '已开始；在输入框输入 /sap-init')
        } catch { setDiag('init err') }
      }

      const pick = async (next) => {
        if (!initialized) { setDiag('先 /sap-init'); return }
        setRole(next)
        setDiag('saving…')
        try {
          const res = await fetch(ENDPOINT, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, cwd, role: next }),
          })
          if (!res.ok) { setDiag('save ' + res.status); return }
          setDiag('saved')
        } catch { setDiag('save err') }
      }

      const bar = {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 6px', borderRadius: 10,
        border: `1px solid ${C.border}`, background: C.bg,
        fontSize: 12, lineHeight: '20px', userSelect: 'none',
      }
      const label = { opacity: 0.75, marginRight: 2, color: C.muted }
      const button = (on) => ({
        border: 'none', borderRadius: 7, padding: '3px 12px', fontSize: 12,
        lineHeight: '18px', cursor: 'pointer',
        fontWeight: on ? 600 : 400,
        background: on ? C.onBg : 'transparent',
        color: on ? C.onText : C.text,
        opacity: 1,
      })
      const hint = initialized
        ? diag
        : (init
            ? `第 ${Math.min(init.current + 1, init.total)}/${init.total} 问：${String(init.question || '').slice(0, 28)}${String(init.question || '').length > 28 ? '…' : ''} · /sap-init answer`
            : '未初始化 · 点击初始化或输入 /sap-init')

      const roleButtons = ROLES.map((item) => h('button', {
        key: item.id,
        type: 'button',
        style: button(role === item.id),
        onClick: () => pick(item.id),
      }, item.label))

      const initButton = h('button', {
        key: 'init',
        type: 'button',
        style: button(true),
        onClick: startInit,
      }, init ? `继续初始化 ${Math.min(init.current + 1, init.total)}/${init.total}` : '初始化')

      return h('div', {
        style: { width: '100%', maxWidth: 'var(--dsh-composer-card-max-width, 952px)', margin: '0 auto', display: 'flex', justifyContent: 'flex-end', paddingRight: 2, marginBottom: 6 },
      },
        h('div', { style: bar, title: 'SAP 单机角色：无角色=不参与；总工=只读方向；工作=实现/调试' },
          h('span', { style: label }, 'SAP'),
          ...(initialized ? roleButtons : [initButton]),
          h('span', { style: { marginLeft: 'auto', opacity: 0.6, fontSize: 10, whiteSpace: 'nowrap', color: C.muted } }, hint),
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
