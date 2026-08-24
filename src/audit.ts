import { appendFileSync } from 'node:fs'

export type AuditAction = 'deny' | 'warn' | 'error'

export interface AuditEntry {
  ts: number
  agent?: string
  tool: string
  argsSummary: string
  ruleId: string
  action: AuditAction
  reason: string
  outcome?: 'denied' | 'allowed'
}

export function summarizeArgs(args: unknown, max = 120): string {
  let s: string
  try {
    s = JSON.stringify(args) ?? ''
  } catch {
    s = String(args)
  }
  return s.length > max ? s.slice(0, max) + '…' : s
}

export class Audit {
  private entries: AuditEntry[] = []

  constructor(
    private readonly maxEntries: number,
    private readonly logFile?: string,
  ) {}

  push(entry: AuditEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, JSON.stringify(entry) + '\n')
      } catch {
        // 日志写入失败不阻断拦截链路
      }
    }
  }

  list(filter?: { action?: AuditAction }): AuditEntry[] {
    if (!filter?.action) return [...this.entries]
    return this.entries.filter((e) => e.action === filter.action)
  }
}
