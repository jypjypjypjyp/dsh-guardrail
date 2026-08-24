import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Audit, summarizeArgs, type AuditEntry } from './audit.ts'

const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'guardrail-audit-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const entry = (patch: Partial<AuditEntry> = {}): AuditEntry => ({
  ts: 1, tool: 'bash', argsSummary: 'x', ruleId: 'r', action: 'deny', reason: 'why', ...patch,
})

describe('Audit', () => {
  it('环形缓冲：超过上限裁掉最旧', () => {
    const audit = new Audit(3)
    audit.push(entry({ ts: 1 })); audit.push(entry({ ts: 2 })); audit.push(entry({ ts: 3 })); audit.push(entry({ ts: 4 }))
    expect(audit.list().map((e) => e.ts)).toEqual([2, 3, 4])
  })
  it('list 按 action 过滤', () => {
    const audit = new Audit(10)
    audit.push(entry({ action: 'deny' })); audit.push(entry({ action: 'warn' }))
    expect(audit.list({ action: 'warn' }).map((e) => e.action)).toEqual(['warn'])
  })
  it('logFile：追加 JSON 行', () => {
    const file = join(tmp(), 'audit.log')
    const audit = new Audit(10, file)
    audit.push(entry({ ts: 42 }))
    expect(readFileSync(file, 'utf8')).toContain('"ts":42')
  })
  it('logFile 写入失败不抛', () => {
    const audit = new Audit(10, join(tmp(), 'no', 'such', 'dir.log'))
    expect(() => audit.push(entry())).not.toThrow()
  })
})

describe('summarizeArgs', () => {
  it('截断超长参数', () => {
    const long = 'a'.repeat(500)
    const s = summarizeArgs({ command: long })
    expect(s.length).toBeLessThanOrEqual(121)
    expect(s.endsWith('…')).toBe(true)
  })
  it('undefined 参数安全', () => {
    expect(summarizeArgs(undefined)).toBe('')
  })
})
