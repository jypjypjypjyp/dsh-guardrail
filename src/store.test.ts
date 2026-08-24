import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuleStore } from './store.ts'
import type { Rule } from './rules.ts'

const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'guardrail-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const rule = (id: string): Rule => ({ id, pattern: 'x', action: 'deny', reason: 'r', enabled: true })

describe('RuleStore', () => {
  it('load 读取合法 JSON 数组', () => {
    const file = join(tmp(), 'rules.json')
    writeFileSync(file, JSON.stringify([rule('a'), rule('b')]))
    const store = new RuleStore(file)
    const { rules, failures } = store.load()
    expect(rules.map((r) => r.id)).toEqual(['a', 'b'])
    expect(failures).toEqual([])
  })
  it('文件不存在：回退空规则', () => {
    const store = new RuleStore(join(tmp(), 'missing.json'))
    const { rules, failures } = store.load()
    expect(rules).toEqual([])
    expect(failures.length).toBeGreaterThan(0)
  })
  it('损坏文件：备份 .bak 并回退空规则', () => {
    const dir = tmp()
    const file = join(dir, 'rules.json')
    writeFileSync(file, '{broken json')
    const store = new RuleStore(file)
    const { rules } = store.load()
    expect(rules).toEqual([])
    // 至少生成一个 .bak 文件（时间戳后缀，通配检查）
    const baks = readdirSync(dir).filter((f) => f.startsWith('rules.json.bak-'))
    expect(baks.length).toBeGreaterThan(0)
    expect(store.list()).toEqual([])
  })
  it('upsert：新增与按 id 替换并写盘', () => {
    const file = join(tmp(), 'rules.json')
    const store = new RuleStore(file)
    store.load()
    store.upsert(rule('a'))
    store.upsert(rule('b'))
    store.upsert({ ...rule('a'), reason: 'updated' })
    expect(store.list().map((r) => r.id)).toEqual(['a', 'b'])
    expect(store.list().find((r) => r.id === 'a')?.reason).toBe('updated')
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Rule[]
    expect(onDisk.map((r) => r.id)).toEqual(['a', 'b'])
  })
  it('remove：删除并写盘，不存在返回 false', () => {
    const file = join(tmp(), 'rules.json')
    const store = new RuleStore(file)
    store.load()
    store.upsert(rule('a'))
    expect(store.remove('a')).toBe(true)
    expect(store.remove('a')).toBe(false)
    expect(store.list()).toEqual([])
  })
})
