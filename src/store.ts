import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import type { Rule } from './rules.js'

export interface RuleStoreLogger {
  warn?: (message: string) => void
}

/**
 * 用户规则存储：JSON 数组文件。
 * 损坏/缺失 → 备份 .bak（时间戳）+ 回退空规则，绝不崩溃。
 */
export class RuleStore {
  private rules: Rule[] = []

  constructor(
    private readonly filePath: string,
    private readonly logger?: RuleStoreLogger,
  ) {}

  load(): { rules: Rule[]; failures: string[] } {
    if (!existsSync(this.filePath)) {
      this.rules = []
      return { rules: [], failures: [`rule file not found: ${this.filePath}`] }
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!Array.isArray(parsed)) throw new Error('rule file must be a JSON array')
      this.rules = parsed as Rule[]
      return { rules: this.rules, failures: [] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        copyFileSync(this.filePath, `${this.filePath}.bak-${Date.now()}`)
      } catch {
        // 备份失败不阻断回退
      }
      this.rules = []
      this.logger?.warn?.(`guardrail: rule file broken (${message}); backed up and reset to empty`)
      return { rules: [], failures: [`${message}`] }
    }
  }

  list(): Rule[] {
    return [...this.rules]
  }

  upsert(rule: Rule): void {
    const index = this.rules.findIndex((r) => r.id === rule.id)
    if (index >= 0) this.rules[index] = rule
    else this.rules.push(rule)
    this.save()
  }

  remove(id: string): boolean {
    const index = this.rules.findIndex((r) => r.id === id)
    if (index < 0) return false
    this.rules.splice(index, 1)
    this.save()
    return true
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.rules, null, 2))
    } catch (error) {
      this.logger?.warn?.(`guardrail: failed to persist rules: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
