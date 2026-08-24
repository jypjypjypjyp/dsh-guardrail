/**
 * 规则引擎：对工具调用输入参数做字符串匹配。
 * 纯函数、无副作用——单测友好，异常一律 fail-open（调用方处理）。
 */
export type RuleAction = 'deny' | 'warn'

export interface Rule {
  id: string
  /** 目标工具名；空/缺省 = 全部工具 */
  tools?: string[]
  /** JS RegExp source */
  pattern: string
  /** 可选：只匹配该参数路径（点号路径，如 "command"） */
  field?: string
  action: RuleAction
  /** 注入给模型的原因，支持 {tool} / {pattern} 占位符 */
  reason: string
  enabled: boolean
  /** 内置规则：不可删除、不可改 pattern，可启停/覆盖动作 */
  builtin?: boolean
}

export interface CompiledRule extends Rule {
  regex: RegExp
}

export interface RuleHit {
  rule: CompiledRule
  /** 实际命中的片段（截断至 120 字符） */
  matched: string
}

export type MatchInput = { name: string; arguments: unknown }

export function compileRule(rule: Rule): { ok: true; rule: CompiledRule } | { ok: false; error: string } {
  try {
    return { ok: true, rule: { ...rule, regex: new RegExp(rule.pattern) } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function compileRules(rules: Rule[]): { compiled: CompiledRule[]; failures: { id: string; error: string }[] } {
  const compiled: CompiledRule[] = []
  const failures: { id: string; error: string }[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const result = compileRule(rule)
    if (result.ok) compiled.push(result.rule)
    else failures.push({ id: rule.id, error: result.error })
  }
  return { compiled, failures }
}

export function pickField(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  let current: unknown = value
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function stringifyForMatch(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

/**
 * 第一个命中的规则生效（按传入顺序：内置在前、用户在后）。
 * 匹配文本 = 工具名 + arguments JSON 全文；field 存在时只匹配该字段。
 */
export function evaluate(input: MatchInput, rules: CompiledRule[]): RuleHit | undefined {
  const needle = stringifyForMatch(input.arguments)
  for (const rule of rules) {
    if (rule.tools && rule.tools.length > 0 && !rule.tools.includes(input.name)) continue
    const target = rule.field ? pickField(input.arguments, rule.field) : `${input.name} ${needle}`
    const text = rule.field ? stringifyForMatch(target) : target as string
    const match = rule.regex.exec(text)
    if (match) return { rule, matched: (match[0] ?? '').slice(0, 120) }
  }
  return undefined
}

export function renderReason(hit: RuleHit): string {
  const tool = hit.rule.tools?.length ? hit.rule.tools.join(',') : '*'
  return hit.rule.reason
    .replaceAll('{tool}', tool)
    .replaceAll('{pattern}', hit.rule.pattern)
}

export function renderDenyReason(hit: RuleHit): string {
  return `[guardrail] 命中规则 ${hit.rule.id}（${hit.rule.action}）：${renderReason(hit)}`
}
