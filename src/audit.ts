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
  const s = JSON.stringify(args) ?? ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

export class Audit {
  private entries: AuditEntry[] = []
  constructor(private readonly maxEntries: number) {}
  push(entry: AuditEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries)
    }
  }
  list(): AuditEntry[] {
    return [...this.entries]
  }
}
