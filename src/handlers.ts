import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  PostToolDecision, PreToolDecision, ToolExecution,
} from '@deepseek-ai/dsh-tools'
import type { Audit, AuditEntry } from './audit.js'
import { summarizeArgs } from './audit.js'
import { evaluate, renderDenyReason, renderReason, type CompiledRule, type RuleHit } from './rules.js'

export interface GuardrailDeps {
  /** 当前生效的已编译规则（内置 + 用户，按优先级排序） */
  rules: () => CompiledRule[]
  audit: Audit
}

/** pre-execute 登记、post-execute 消费的 warn 命中标记（按 callId）。 */
export class WarnTracker {
  private readonly map = new Map<string, RuleHit>()

  set(callId: string, hit: RuleHit): void {
    this.map.set(callId, hit)
  }

  take(callId: string): RuleHit | undefined {
    const hit = this.map.get(callId)
    this.map.delete(callId)
    return hit
  }

  clear(): void {
    this.map.clear()
  }
}

export function createPreExecuteHandler(deps: GuardrailDeps, tracker: WarnTracker) {
  return async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    try {
      const hit = evaluate({ name: exec.name, arguments: exec.arguments }, deps.rules())
      if (!hit) return next()
      const entry: AuditEntry = {
        ts: Date.now(), agent: exec.agent?.id, tool: exec.name,
        argsSummary: summarizeArgs(exec.arguments), ruleId: hit.rule.id,
        action: hit.rule.action, reason: renderReason(hit),
        outcome: hit.rule.action === 'deny' ? 'denied' : 'allowed',
      }
      deps.audit.push(entry)
      if (hit.rule.action === 'deny') {
        return { kind: 'deny', reason: renderDenyReason(hit) }
      }
      tracker.set(exec.callId, hit)
      return { kind: 'allow' }
    } catch (error) {
      deps.audit.push({
        ts: Date.now(), agent: exec.agent?.id, tool: exec.name,
        argsSummary: summarizeArgs(exec.arguments), ruleId: '<engine>',
        action: 'error', reason: error instanceof Error ? error.message : String(error),
      })
      return next()
    }
  }
}

export function createPostExecuteHandler(deps: GuardrailDeps, tracker: WarnTracker) {
  return async (
    exec: ToolExecution,
    _result: Readonly<unknown>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const hit = tracker.take(exec.callId)
    if (!hit) return next()
    return {
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{
          type: 'text',
          text: `[guardrail] 警告：命中规则 ${hit.rule.id}（${renderReason(hit)}）。该调用已放行，请谨慎对待相关操作。`,
        }],
        source: { kind: 'plugin', plugin: 'guardrail' },
      })],
    }
  }
}
