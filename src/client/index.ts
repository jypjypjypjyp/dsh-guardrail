/**
 * dsh-guardrail 管理面板（客户端）。
 *
 * 通过 DSH client 的真实 slot API 注册一个 `conversation.view` 条目（kind:list，
 * 追加式）——在会话视图环里提供 "guardrail" 标签页，渲染规则管理 UI。
 * 不 import 真实 slot 包（宿主在运行时经 module loader 提供 slots 服务与 react），
 * 因此这里用 `ctx.slots` 与 React 外部依赖，构建走 tsdown（browser bundle）。
 *
 * 样式约定：全部视觉只使用 DSH 系统主题 token（`--dsw-alias-*` / `--ds-*`），
 * 不引入自定义硬编码颜色/字体，随主题（亮/暗）自动切换，与整站统一。
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

// 主题相关 CSS：全部取值来自 DSH 系统 token，任何 hover/焦点态随亮暗主题切换。
// 作用域以 #guardrail-panel 前缀限定，避免污染宿主样式。
const STYLE = `
#guardrail-panel {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
#guardrail-panel button,
#guardrail-panel input,
#guardrail-panel select,
#guardrail-panel textarea {
  font-family: inherit;
}
#guardrail-panel button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
  color: var(--dsw-alias-label-primary);
}
#guardrail-panel button:disabled { opacity: .5; cursor: default; }
#guardrail-panel button.gr-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
#guardrail-panel button.gr-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
#guardrail-panel button.gr-ghost {
  background: var(--dsw-alias-bg-layer-1);
  border-color: var(--dsw-alias-border-l2);
}
#guardrail-panel button.gr-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
#guardrail-panel button.gr-danger { color: var(--dsw-alias-state-error-primary); }
#guardrail-panel button.gr-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
#guardrail-panel select,
#guardrail-panel input,
#guardrail-panel textarea {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
}
#guardrail-panel select:focus,
#guardrail-panel input:focus,
#guardrail-panel textarea:focus {
  border-color: var(--dsw-alias-border-l3);
  outline: none;
}
#guardrail-panel .gr-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
`

// 复用 DSH 主题 CSS 变量，与整站视觉保持一致（颜色/边框/圆角/字体均取自主题 token）。
const S = {
  root: { padding: 12 },
  heading: { fontWeight: 700, marginBottom: 8 },
  sub: { fontWeight: 600, margin: '6px 0 4px', color: 'var(--dsw-alias-label-secondary)' },
  card: { margin: '6px 0', padding: 10, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-module-platform)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px', borderRadius: 6 },
  rowDisabled: { textDecoration: 'line-through', opacity: 0.5, color: 'var(--dsw-alias-label-tertiary)' },
  muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
  code: { fontFamily: 'var(--ds-font-family-code)' },
  error: { color: 'var(--dsw-alias-state-error-primary)', marginBottom: 6 },
  label: { display: 'block', margin: '2px 0', color: 'var(--dsw-alias-label-secondary)' },
  result: { whiteSpace: 'pre-wrap', marginTop: 6, color: 'var(--dsw-alias-label-primary)' },
  audit: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
} satisfies Record<string, React.CSSProperties>

// 原生组件做法：state 类徽章用「低饱和底 + 强调色文字」（见 dsh-client-ui-trajectory 的
// tertiary/color-mix 组合），避免实心底与文字撞色，且亮暗主题自适应。
const badge = (kind: 'deny' | 'warn'): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', padding: '0 8px', height: 18, borderRadius: 999,
  fontSize: 11, fontWeight: 600, flexShrink: 0,
  background: kind === 'deny' ? 'var(--dsw-alias-state-error-secondary)' : 'var(--dsw-alias-state-warn-tertiary)',
  color: kind === 'deny' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)',
})

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
  const [newId, setNewId] = React.useState('')
  const [newPattern, setNewPattern] = React.useState('')
  const [newAction, setNewAction] = React.useState<'deny' | 'warn'>('deny')
  const [newReason, setNewReason] = React.useState('')
  const [newTools, setNewTools] = React.useState('')
  const [newField, setNewField] = React.useState('')

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

  const addRule = async (): Promise<void> => {
    const id = newId.trim()
    const pattern = newPattern.trim()
    if (!id || !pattern) { setError('添加规则须填 id 与 pattern'); return }
    const rule: Rule = {
      id, pattern, action: newAction,
      reason: newReason.trim() || `命中规则 ${id}`,
      enabled: true,
    }
    const tools = newTools.trim() ? newTools.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    if (tools && tools.length) rule.tools = tools
    if (newField.trim()) rule.field = newField.trim()
    try {
      await apiSend('POST', '/rules', rule)
      setNewId(''); setNewPattern(''); setNewReason(''); setNewTools(''); setNewField(''); setError('')
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const setRuleAction = async (id: string, action: 'deny' | 'warn'): Promise<void> => {
    try {
      await apiSend('PUT', `/rules/${encodeURIComponent(id)}`, { action })
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const rows: React.ReactElement[] = rules.map((r) =>
    React.createElement('div', { style: { ...S.row, ...(r.enabled ? {} : S.rowDisabled) }, className: 'gr-row', key: r.id },
      React.createElement('span', { style: { fontWeight: 600, ...(r.enabled ? {} : { textDecoration: 'line-through' }) } }, `${r.builtin ? '📦' : '📝'} ${r.id}`),
      React.createElement('span', { style: badge(r.action) }, r.action),
      React.createElement('span', { style: { ...S.muted, ...S.code } },
        `${(r.tools?.length ? r.tools.join(',') : '*')}  ${r.pattern.slice(0, 32)}`),
      React.createElement('button', {
        className: 'gr-ghost',
        style: { marginLeft: 'auto' },
        onClick: () => void (r.builtin ? overrideBuiltin(r.id, { enabled: !r.enabled }) : toggleRule(r.id, r.enabled)),
      }, r.enabled ? '停用' : '启用'),
      React.createElement('select', {
        value: r.action,
        onChange: (e) => void (r.builtin ? overrideBuiltin(r.id, { action: e.target.value as 'deny' | 'warn' }) : setRuleAction(r.id, e.target.value as 'deny' | 'warn')),
      },
        React.createElement('option', { value: 'deny' }, 'deny'),
        React.createElement('option', { value: 'warn' }, 'warn'),
      ),
      !r.builtin
        ? React.createElement('button', { className: 'gr-ghost gr-danger', onClick: () => void removeRule(r.id) }, '删除')
        : null,
    ),
  )

  const audits: React.ReactElement[] = audit.map((e, i) =>
    React.createElement('div', { key: `${e.ts}-${i}`, style: S.audit },
      `[${new Date(e.ts).toLocaleTimeString()}] ${e.action} ${e.tool} → ${e.ruleId} ${e.reason}`),
  )

  return React.createElement('div', { style: S.root, id: 'guardrail-panel' },
    React.createElement('style', { dangerouslySetInnerHTML: { __html: STYLE } }),
    React.createElement('div', { style: S.heading }, '🛡️ guardrail 工具调用守卫'),
    error ? React.createElement('div', { style: S.error }, error) : null,
    React.createElement('div', { style: S.card },
      React.createElement('div', { style: S.sub }, '配置'),
      React.createElement('label', null,
        React.createElement('input', { type: 'checkbox', checked: cfg.enabled, onChange: (e) => void saveConfig({ ...cfg, enabled: e.target.checked }) }),
        '  启用守卫'),
      React.createElement('label', { style: S.label },
        '规则文件 ',
        React.createElement('input', { value: cfg.rulesFile, readOnly: true, style: { width: '70%' } })),
      React.createElement('label', { style: S.label },
        React.createElement('input', { type: 'checkbox', checked: cfg.builtins.enabled, onChange: (e) => void saveConfig({ ...cfg, builtins: { ...cfg.builtins, enabled: e.target.checked } }) }),
        '  启用内置规则'),
      React.createElement('label', { style: S.label },
        ' 审计上限 ',
        React.createElement('input', { type: 'number', value: cfg.audit.maxEntries, onChange: (e) => void saveConfig({ ...cfg, audit: { ...cfg.audit, maxEntries: Number(e.target.value) || 0 } }), style: { width: 80 } })),
      React.createElement('label', { style: S.label },
        ' 日志文件 ',
        React.createElement('input', { value: cfg.audit.logFile ?? '', onChange: (e) => void saveConfig({ ...cfg, audit: { ...cfg.audit, logFile: e.target.value } }), style: { width: '70%' } })),
    ),
    React.createElement('div', { style: S.sub }, '规则（内置规则可直接切换动作/启停，作为覆盖保存）'),
    React.createElement('div', null, rows),
    React.createElement('div', { style: S.card },
      React.createElement('div', { style: S.sub }, '测试 / 添加规则'),
      React.createElement('input', {
        placeholder: '工具名，如 bash',
        value: tool,
        onChange: (e) => setTool(e.target.value),
        style: { width: '100%', margin: '2px 0' },
      }),
      React.createElement('textarea', {
        placeholder: '参数 JSON，如 {"command":"rm -rf /"}',
        value: args,
        onChange: (e) => setArgs(e.target.value),
        style: { width: '100%', height: 48, margin: '2px 0' },
      }),
      React.createElement('button', { className: 'gr-primary', onClick: () => void runTest() }, '试跑'),
      React.createElement('div', { style: S.result }, result),
      React.createElement('div', { style: { marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8 } },
        React.createElement('div', { style: S.sub }, '添加规则'),
        React.createElement('input', { placeholder: 'id（必填）', value: newId, onChange: (e) => setNewId(e.target.value), style: { width: '100%', margin: '2px 0' } }),
        React.createElement('input', { placeholder: '正则 pattern（必填）', value: newPattern, onChange: (e) => setNewPattern(e.target.value), style: { width: '100%', margin: '2px 0' } }),
        React.createElement('select', { value: newAction, onChange: (e) => setNewAction(e.target.value as 'deny' | 'warn'), style: { width: '100%', margin: '2px 0' } },
          React.createElement('option', { value: 'deny' }, 'deny'),
          React.createElement('option', { value: 'warn' }, 'warn')),
        React.createElement('input', { placeholder: 'reason（支持 {tool}/{pattern}）', value: newReason, onChange: (e) => setNewReason(e.target.value), style: { width: '100%', margin: '2px 0' } }),
        React.createElement('input', { placeholder: 'tools，逗号分隔（空=全部）', value: newTools, onChange: (e) => setNewTools(e.target.value), style: { width: '100%', margin: '2px 0' } }),
        React.createElement('input', { placeholder: 'field（可选，如 command）', value: newField, onChange: (e) => setNewField(e.target.value), style: { width: '100%', margin: '2px 0' } }),
        React.createElement('button', { className: 'gr-primary', onClick: () => void addRule() }, '添加规则'),
      ),
    ),
    React.createElement('div', { style: S.sub }, '审计（最近 30 条）'),
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
