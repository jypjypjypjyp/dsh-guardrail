/**
 * dsh-guardrail 管理面板（客户端）。
 *
 * 通过 DSH client 的真实 slot API 注册一个 `conversation.view` 条目（kind:list，
 * 追加式）——在会话视图环里提供 "guardrail" 标签页，渲染规则管理 UI。
 * 不 import 真实 slot 包（宿主在运行时经 module loader 提供 slots 服务与 react），
 * 因此这里用 `ctx.slots` 与 React 外部依赖，构建走 tsdown（browser bundle）。
 */
import React from 'react'

/** 插件注入的服务。 */
export const inject = ['slots']

type ClientContext = {
  effect(fn: () => void, name?: string): void
  slots: {
    inject(key: string, cb: () => () => void): () => void
    register(spec: Record<string, unknown>, component: React.ComponentType): () => void
  }
  [key: string]: unknown
}

const API = '/guardrail/api'

interface Rule {
  id: string
  tools?: string[]
  pattern: string
  action: 'deny' | 'warn'
  reason: string
  enabled: boolean
  builtin?: boolean
}

interface AuditEntry {
  ts: number
  tool: string
  ruleId: string
  action: string
  reason: string
}

interface GuardrailConfig {
  enabled: boolean
  rulesFile: string
  builtins: { enabled: boolean; overrides: Rule[] }
  audit: { maxEntries: number; logFile?: string }
}

const DEFAULT_CFG: GuardrailConfig = {
  enabled: true,
  rulesFile: '',
  builtins: { enabled: true, overrides: [] },
  audit: { maxEntries: 200 },
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(API + path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

function GuardrailPanel(): React.ReactElement {
  const [rules, setRules] = React.useState<Rule[]>([])
  const [audit, setAudit] = React.useState<AuditEntry[]>([])
  const [error, setError] = React.useState('')
  const [tool, setTool] = React.useState('')
  const [args, setArgs] = React.useState('')
  const [result, setResult] = React.useState('')
  const [cfg, setCfg] = React.useState<GuardrailConfig>(DEFAULT_CFG)

  const refresh = React.useCallback(async () => {
    try {
      const r = await apiGet<{ rules: Rule[] }>('/rules')
      setRules(r.rules ?? [])
      const a = await apiGet<{ entries: AuditEntry[] }>('/audit')
      setAudit((a.entries ?? []).slice(-30))
      const c = await apiGet<{ config: GuardrailConfig }>('/config')
      if (c.config) setCfg(c.config)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(t)
  }, [refresh])

  const saveConfig = async (next: GuardrailConfig): Promise<void> => {
    try {
      const r = await apiSend<{ ok: boolean; config: GuardrailConfig }>('PUT', '/config', next)
      if (r.config) setCfg(r.config)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }
  const overrideBuiltin = async (id: string, patch: Partial<Rule>): Promise<void> => {
    const others = (cfg.builtins.overrides ?? []).filter((o) => o.id !== id)
    await saveConfig({ ...cfg, builtins: { ...cfg.builtins, overrides: [...others, { id, ...patch }] } })
    await refresh()
  }

  const toggleRule = async (id: string, enabled: boolean): Promise<void> => {
    try {
      await apiSend('PUT', `/rules/${encodeURIComponent(id)}`, { enabled: !enabled })
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }
  const removeRule = async (id: string): Promise<void> => {
    try {
      await apiSend('DELETE', `/rules/${encodeURIComponent(id)}`)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }
  const runTest = async (): Promise<void> => {
    try {
      const data = await apiSend<{ hit: boolean; ruleId?: string | null; matched?: string | null }>(
        'POST', '/test', { tool: tool.trim(), args: JSON.parse(args || '{}') },
      )
      setResult(data.hit ? `✅ 命中 ${data.ruleId}\n片段：${data.matched}` : '✅ 未命中（放行）')
    } catch (e) {
      setResult(`❌ ${String(e)}`)
    }
  }

  const badge = (color: string): React.CSSProperties => ({
    display: 'inline-block', padding: '0 6px', borderRadius: 8, fontSize: 11,
    background: color, marginLeft: 6,
  })

  const rows: React.ReactElement[] = rules.map((r) =>
    React.createElement('div', {
      key: r.id,
      style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', borderBottom: '1px solid #333' },
    },
      React.createElement('span', { style: { fontWeight: 600 } }, `${r.builtin ? '📦' : '📝'} ${r.id}`),
      React.createElement('span', { style: badge(r.action === 'deny' ? '#7a1f1f' : '#7a5f1f') }, r.action),
      React.createElement('span', { style: { color: '#999', fontSize: 11 } },
        `${(r.tools?.length ? r.tools.join(',') : '*')}  ${r.pattern.slice(0, 32)}`),
      React.createElement('button', {
        style: { marginLeft: 'auto' },
        onClick: () => void (r.builtin ? overrideBuiltin(r.id, { enabled: !r.enabled }) : toggleRule(r.id, r.enabled)),
      }, r.enabled ? '停用' : '启用'),
      r.builtin
        ? React.createElement('select', {
            value: r.action,
            onChange: (e) => void overrideBuiltin(r.id, { action: e.target.value as 'deny' | 'warn' }),
            style: { fontSize: 11 },
          },
          React.createElement('option', { value: 'deny' }, 'deny'),
          React.createElement('option', { value: 'warn' }, 'warn'),
        )
        : React.createElement('button', { onClick: () => void removeRule(r.id) }, '删除'),
    ),
  )

  const audits: React.ReactElement[] = audit.map((e, i) =>
    React.createElement('div', {
      key: `${e.ts}-${i}`,
      style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#999', fontSize: 11 },
    }, `[${new Date(e.ts).toLocaleTimeString()}] ${e.action} ${e.tool} → ${e.ruleId} ${e.reason}`),
  )

  return React.createElement('div', { style: { fontFamily: 'ui-monospace,monospace', fontSize: 12, padding: 12 } },
    React.createElement('div', { style: { fontWeight: 700, marginBottom: 8 } }, '🛡️ guardrail 工具调用守卫'),
    error ? React.createElement('div', { style: { color: '#e0a0a0', marginBottom: 6 } }, error) : null,
    React.createElement('div', { style: { margin: '6px 0', padding: 8, border: '1px solid #333', borderRadius: 6 } },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '配置'),
      React.createElement('label', null,
        React.createElement('input', { type: 'checkbox', checked: cfg.enabled, onChange: (e) => void saveConfig({ ...cfg, enabled: e.target.checked }) }),
        '  启用守卫'),
      React.createElement('label', { style: { display: 'block' } },
        '规则文件 ',
        React.createElement('input', { value: cfg.rulesFile, readOnly: true, style: { width: '70%' } })),
      React.createElement('label', { style: { display: 'block' } },
        React.createElement('input', { type: 'checkbox', checked: cfg.builtins.enabled, onChange: (e) => void saveConfig({ ...cfg, builtins: { ...cfg.builtins, enabled: e.target.checked } }) }),
        '  启用内置规则'),
      React.createElement('label', { style: { display: 'block' } },
        ' 审计上限 ',
        React.createElement('input', { type: 'number', value: cfg.audit.maxEntries, onChange: (e) => void saveConfig({ ...cfg, audit: { ...cfg.audit, maxEntries: Number(e.target.value) || 0 } }), style: { width: 80 } })),
      React.createElement('label', { style: { display: 'block' } },
        ' 日志文件 ',
        React.createElement('input', { value: cfg.audit.logFile ?? '', onChange: (e) => void saveConfig({ ...cfg, audit: { ...cfg.audit, logFile: e.target.value } }), style: { width: '70%' } })),
    ),
    React.createElement('div', { style: { fontWeight: 600, margin: '6px 0 4px' } }, '规则（内置规则可直接切换动作/启停，作为覆盖保存）'),
    React.createElement('div', null, rows),
    React.createElement('div', { style: { margin: '10px 0', padding: 8, border: '1px solid #333', borderRadius: 6 } },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 4 } }, '测试匹配'),
      React.createElement('input', {
        placeholder: '工具名，如 bash',
        value: tool,
        onChange: (e) => setTool(e.target.value),
        style: { width: '100%' },
      }),
      React.createElement('textarea', {
        placeholder: '参数 JSON，如 {"command":"rm -rf /"}',
        value: args,
        onChange: (e) => setArgs(e.target.value),
        style: { width: '100%', height: 64 },
      }),
      React.createElement('button', { onClick: () => void runTest() }, '试跑'),
      React.createElement('div', { style: { whiteSpace: 'pre-wrap', marginTop: 4 } }, result),
    ),
    React.createElement('div', { style: { fontWeight: 600, margin: '8px 0 4px' } }, '审计（最近 30 条）'),
    React.createElement('div', null, audits),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'guardrail-panel',
      order: 20,
      label: () => 'guardrail',
    }, GuardrailPanel),
  ), 'guardrail: panel')
}
