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

// 命令锚定版：只拦「真正执行的 pip/python 命令」，不误伤只提到这个词的命令。
// 这是 uv 两条规则从裸 \b 词边界版收紧后的目标语义（见 README）。
const anchoredPython = (compileRules([{
  id: 'uv-python', tools: ['bash'],
  pattern: '(?:^|[;&|]\\s*|"command":")(?:[^\\s"]*/)?python3?\\b',
  action: 'deny', reason: 'rp', enabled: true,
}])).compiled
const anchoredPip = (compileRules([{
  id: 'uv-pip-only', tools: ['bash'],
  pattern: '(?:^|[;&|]\\s*|"command":")(?:[^\\s"]*/)?pip3?\\b',
  action: 'deny', reason: 'rp', enabled: true,
}])).compiled

describe('命令锚定版 uv 规则（收紧后语义）', () => {
  it('uv-python：真正执行的 python 命令被拦，仅提到词的命令放行', () => {
    // deny：命令起点（JSON "command":" 前缀 / 分隔符后 / 开头的绝对路径）
    expect(evaluate({ name: 'bash', arguments: { command: 'python -c "x"' } }, anchoredPython)?.rule.id).toBe('uv-python')
    expect(evaluate({ name: 'bash', arguments: { command: 'python3 -m venv .venv' } }, anchoredPython)?.rule.id).toBe('uv-python')
    expect(evaluate({ name: 'bash', arguments: { command: '/usr/bin/python -c x' } }, anchoredPython)?.rule.id).toBe('uv-python')
    // pass：uv 前缀、纯文本提到、cd/grep/echo、变量赋值
    expect(evaluate({ name: 'bash', arguments: { command: 'uv run python -c "x"' } }, anchoredPython)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'echo python' } }, anchoredPython)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'grep -rn python src/' } }, anchoredPython)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'cd python && ls' } }, anchoredPython)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'echo "python"' } }, anchoredPython)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'v="python"; echo $v' } }, anchoredPython)).toBeUndefined()
  })
  it('uv-pip-only：真正执行的 pip 命令被拦，仅提到词的命令放行', () => {
    expect(evaluate({ name: 'bash', arguments: { command: 'pip install requests' } }, anchoredPip)?.rule.id).toBe('uv-pip-only')
    expect(evaluate({ name: 'bash', arguments: { command: 'uv pip install requests' } }, anchoredPip)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'echo pip' } }, anchoredPip)).toBeUndefined()
    expect(evaluate({ name: 'bash', arguments: { command: 'pip' } }, anchoredPip)?.rule.id).toBe('uv-pip-only')
  })
})
