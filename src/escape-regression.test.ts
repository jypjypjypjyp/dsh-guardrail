import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuleStore } from './store.ts'
import { compileRules, detectLikelyDoubleEscaped, evaluate } from './rules.ts'

/**
 * 回归：规则从 JSON 文件读出（含转义）后 compile + evaluate 仍然命中。
 * 底 bug：用户规则 JSON 里把 `[\s-]` 写成 `[\\s-]`（双转义），RegExp 语义变成"字面反斜杠+字母"，
 * 合法却不匹配任何东西，导致规则静默失效。这里用真实的 JSON 文件往返来钉死正确单转义行为。
 */
const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'guardrail-esc-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('转义回归：JSON 读回 → compile → evaluate', () => {
  it('正确的单转义 pattern 经 JSON 往返后仍命中「裸 pip」', () => {
    const file = join(tmp(), 'rules.json')
    // 用 JSON.stringify 写出与用户文件完全一致的形态：`[\s-]` 在 JSON 文本里是 `[\\s-]`。
    writeFileSync(file, JSON.stringify([{
      id: 'uv-pip-only',
      tools: ['bash'],
      pattern: '(?<!uv[\\s-])\\bpip3?\\b',
      action: 'deny',
      reason: '禁止裸 pip',
      enabled: true,
    }], null, 2))

    const { rules, failures, warnings } = new RuleStore(file).load()
    expect(failures).toEqual([])
    expect(warnings).toEqual([])
    expect(rules).toHaveLength(1)

    const { compiled } = compileRules(rules)
    // 裸 pip → 命中
    expect(evaluate({ name: 'bash', arguments: { command: 'pip install requests' } }, compiled)?.rule.id).toBe('uv-pip-only')
    // uv 紧邻 pip（`uv pip`）→ 放行（lookbehind 生效）
    expect(evaluate({ name: 'bash', arguments: { command: 'uv pip --version' } }, compiled)).toBeUndefined()
    // uv run pip：`run ` 在 uv 与 pip 之间，lookbehind `(?<!uv[\s-])` 仍命中 → 被拦（符合该 pattern 语义）
    expect(evaluate({ name: 'bash', arguments: { command: 'uv run pip --version' } }, compiled)?.rule.id).toBe('uv-pip-only')
  })

  it('README 第二个 lookbehind 例子（python 走 uv run）经 JSON 往返仍命中裸 python', () => {
    const file = join(tmp(), 'rules.json')
    writeFileSync(file, JSON.stringify([{
      id: 'uv-python',
      tools: ['bash'],
      pattern: '(?<!uv\\s+run\\s+)\\bpython3?\\b',
      action: 'deny',
      reason: '禁止裸 python，请用 uv run',
      enabled: true,
    }], null, 2))

    const { rules, failures, warnings } = new RuleStore(file).load()
    expect(failures).toEqual([])
    expect(warnings).toEqual([])

    const { compiled } = compileRules(rules)
    // 裸 python → 命中
    expect(evaluate({ name: 'bash', arguments: { command: 'python -c "print(1)"' } }, compiled)?.rule.id).toBe('uv-python')
    // uv run python → 放行（lookbehind `(?<!uv\s+run\s+)` 生效）
    expect(evaluate({ name: 'bash', arguments: { command: 'uv run python -c "print(1)"' } }, compiled)).toBeUndefined()
  })

  it('双重转义的 pattern 读回后不命中（记录 bug 形态），且被告警检出', () => {
    const file = join(tmp(), 'rules.json')
    // 用户手写双重转义：JSON 文本里是 `[\\\\s-]`，读回后 RegExp 变成"字面反斜杠+s"。
    writeFileSync(file, JSON.stringify([{
      id: 'uv-pip-only',
      tools: ['bash'],
      pattern: '(?<!uv[\\\\s-])\\\\bpip3?\\\\b',
      action: 'deny',
      reason: '禁止裸 pip',
      enabled: true,
    }], null, 2))

    const { rules, warnings } = new RuleStore(file).load()
    expect(warnings.length).toBe(1)
    const { compiled } = compileRules(rules)
    expect(evaluate({ name: 'bash', arguments: { command: 'pip install requests' } }, compiled)).toBeUndefined()
  })
})

describe('detectLikelyDoubleEscaped', () => {
  it('检出双重转义（README 两个 lookbehind 例子的 bug 形态）', () => {
    expect(detectLikelyDoubleEscaped('(?<!uv[\\\\s-])\\\\bpip3?\\\\b')).toBe(true)
    expect(detectLikelyDoubleEscaped('(?<!uv\\\\s+run\\\\s+)\\\\bpython3?\\\\b')).toBe(true)
  })
  it('不误伤单转义（README 正确形态）与无转义', () => {
    expect(detectLikelyDoubleEscaped('(?<!uv[\\s-])\\bpip3?\\b')).toBe(false)
    expect(detectLikelyDoubleEscaped('(?<!uv\\s+run\\s+)\\bpython3?\\b')).toBe(false)
    expect(detectLikelyDoubleEscaped('rm\\s+-rf\\s+/')).toBe(false)
  })
})
