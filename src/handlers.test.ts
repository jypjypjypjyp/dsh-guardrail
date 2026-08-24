import { describe, expect, it, vi } from 'vitest'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { Audit, type AuditEntry } from './audit.ts'
import {
  WarnTracker, createPostExecuteHandler, createPreExecuteHandler,
  type GuardrailDeps,
} from './handlers.ts'
import { compileRules, type CompiledRule } from './rules.ts'

const RULES: CompiledRule[] = (compileRules([
  { id: 'deny-r', pattern: 'rm\\s+-rf\\s+/', action: 'deny', reason: '禁止删根', enabled: true },
  { id: 'warn-r', pattern: 'git\\s+reset\\s+--hard', action: 'warn', reason: '小心回退', enabled: true },
])).compiled

const makeExec = (patch: Partial<ToolExecution> = {}): ToolExecution => ({
  callId: 'call-1', rootCallId: 'call-1',
  name: 'bash', arguments: { command: 'rm -rf /' },
  signal: new AbortController().signal,
  ...patch,
} as ToolExecution)

const makeDeps = (): GuardrailDeps & { audit: Audit; entries: AuditEntry[] } => {
  const audit = new Audit(10)
  return { rules: () => RULES, audit, entries: [] }
}

describe('createPreExecuteHandler', () => {
  it('deny：命中 deny 规则短路返回 deny + 注入原因', async () => {
    const deps = makeDeps()
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const decision = await createPreExecuteHandler(deps, new WarnTracker())(makeExec(), next)
    expect(decision).toEqual({ kind: 'deny', reason: expect.stringContaining('[guardrail] 命中规则 deny-r（deny）') })
    expect(next).not.toHaveBeenCalled()
  })
  it('warn：命中 warn 规则放行并登记标记', async () => {
    const deps = makeDeps()
    const tracker = new WarnTracker()
    const exec = makeExec({ arguments: { command: 'git reset --hard HEAD' } })
    const decision = await createPreExecuteHandler(deps, tracker)(exec, async () => ({ kind: 'allow' as const }))
    expect(decision).toEqual({ kind: 'allow' })
    expect(tracker.take(exec.callId)?.rule.id).toBe('warn-r')
  })
  it('未命中：委托 next()', async () => {
    const deps = makeDeps()
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const exec = makeExec({ arguments: { command: 'ls -la' } })
    const decision = await createPreExecuteHandler(deps, new WarnTracker())(exec, next)
    expect(decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })
  it('评估异常：fail-open 委托 next 并记录 error 审计', async () => {
    const deps = makeDeps()
    deps.rules = () => { throw new Error('boom') }
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const audit = deps.audit
    const spy = vi.spyOn(audit, 'push')
    await createPreExecuteHandler(deps, new WarnTracker())(makeExec(), next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ action: 'error' }))
  })
})

describe('createPostExecuteHandler', () => {
  it('warn 标记：附加独立警告 UserMessage（source=plugin/guardrail）', async () => {
    const deps = makeDeps()
    const tracker = new WarnTracker()
    const exec = makeExec({ arguments: { command: 'git reset --hard HEAD' } })
    const hit = { rule: RULES[1], matched: 'git reset --hard' }
    tracker.set(exec.callId, hit)
    const next = vi.fn(async () => ({ kind: 'accept' as const }))
    const decision = await createPostExecuteHandler(deps, tracker)(exec, {} as never, next)
    expect(next).not.toHaveBeenCalled()
    expect(decision.kind).toBe('accept')
    if (decision.kind === 'accept') {
      const ctx = decision.additionalContexts?.[0]
      expect(ctx).toBeDefined()
      const msg = decision.additionalContexts![0]!
      expect(msg.role).toBe('user')
      expect(msg.source).toEqual({ kind: 'plugin', plugin: 'guardrail' })
      expect(msg.content[0].type).toBe('text')
      if (msg.content[0].type === 'text') expect(msg.content[0].text).toContain('[guardrail] 警告：命中规则 warn-r')
    }
  })
  it('无标记：委托 next()', async () => {
    const deps = makeDeps()
    const next = vi.fn(async () => ({ kind: 'accept' as const }))
    const decision = await createPostExecuteHandler(deps, new WarnTracker())(makeExec(), {} as never, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ kind: 'accept' })
  })
})
