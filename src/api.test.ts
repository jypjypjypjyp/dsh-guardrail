import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Audit } from './audit.ts'
import { BUILTIN_RULES } from './builtin-rules.ts'
import { compileRules } from './rules.ts'
import { RuleStore } from './store.ts'
import { createApiHandler, type ApiDeps } from './index.ts'
import type { Rule } from './rules.ts'

const dirs: string[] = []
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'guardrail-api-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const rule = (id: string): Rule => ({ id, pattern: 'x', action: 'deny', reason: 'r', enabled: true })

const makeDeps = (): ApiDeps => {
  const file = join(tmp(), 'rules.json')
  writeFileSync(file, '[]')
  const store = new RuleStore(file)
  store.load()
  return {
    store,
    audit: new Audit(20),
    // 试跑评估用：需命中内置 rm-root（'rm -rf /'）
    rules: () => compileRules(BUILTIN_RULES).compiled,
    // 展示用：GET /rules 期望仅用户规则存储（此处为空）
    builtins: () => [],
    config: {
      get: () => ({ enabled: true, rulesFile: file, builtins: { enabled: true, overrides: [] }, audit: { maxEntries: 20 } }),
      put: () => {},
    },
  }
}

const call = (deps: ApiDeps, method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> => {
  const req = {
    method, url,
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data' && body !== undefined) { cb(Buffer.from(JSON.stringify(body))) }
      if (event === 'end') { cb() }
      return req
    },
  } as unknown as IncomingMessage
  let status = 0
  let payload = ''
  const res = {
    writeHead: (s: number) => { status = s; return res },
    end: (chunk?: unknown) => { payload = String(chunk ?? '') },
  } as unknown as ServerResponse
  return createApiHandler(deps)(req, res).then(() => ({
    status, json: payload ? JSON.parse(payload) : null,
  }))
}

describe('createApiHandler', () => {
  it('GET /rules 返回规则列表', async () => {
    const deps = makeDeps()
    const { status, json } = await call(deps, 'GET', '/guardrail/api/rules')
    expect(status).toBe(200)
    expect((json as { rules: Rule[] }).rules).toEqual([])
  })
  it('POST /rules 新增用户规则并持久化', async () => {
    const deps = makeDeps()
    const { status } = await call(deps, 'POST', '/guardrail/api/rules', rule('new-1'))
    expect(status).toBe(200)
    expect(deps.store.list().map((r) => r.id)).toContain('new-1')
  })
  it('PUT /rules/:id 覆盖动作/启停', async () => {
    const deps = makeDeps()
    deps.store.upsert(rule('a'))
    const { status } = await call(deps, 'PUT', '/guardrail/api/rules/a', { ...rule('a'), enabled: false })
    expect(status).toBe(200)
    expect(deps.store.list().find((r) => r.id === 'a')?.enabled).toBe(false)
  })
  it('DELETE /rules/:id 删除用户规则', async () => {
    const deps = makeDeps()
    deps.store.upsert(rule('a'))
    const { status } = await call(deps, 'DELETE', '/guardrail/api/rules/a')
    expect(status).toBe(200)
    expect(deps.store.list()).toEqual([])
  })
  it('POST /test 试跑返回命中', async () => {
    const deps = makeDeps()
    const { status, json } = await call(deps, 'POST', '/guardrail/api/test', {
      tool: 'bash', args: { command: 'rm -rf /' },
    })
    expect(status).toBe(200)
    expect((json as { hit: boolean }).hit).toBe(true)
  })
  it('GET /audit 返回审计', async () => {
    const deps = makeDeps()
    deps.audit.push({ ts: 1, tool: 'bash', argsSummary: 'x', ruleId: 'r', action: 'deny', reason: 'why' })
    const { status, json } = await call(deps, 'GET', '/guardrail/api/audit')
    expect(status).toBe(200)
    expect((json as { entries: unknown[] }).entries.length).toBe(1)
  })
  it('非法 JSON body → 400', async () => {
    const deps = makeDeps()
    const { status } = await call(deps, 'POST', '/guardrail/api/rules', undefined)
    expect(status).toBe(400)
  })
  it('GET /config 返回当前配置', async () => {
    const deps = makeDeps()
    const { status, json } = await call(deps, 'GET', '/guardrail/api/config')
    expect(status).toBe(200)
    expect((json as { config: { enabled: boolean } }).config.enabled).toBe(true)
  })
  it('PUT /config 更新配置（浅层+嵌套合并）', async () => {
    const deps = makeDeps()
    const pid = vi.fn()
    ;(deps.config as { put: (c: unknown) => void }).put = pid
    const { status } = await call(deps, 'PUT', '/guardrail/api/config', { enabled: false, audit: { maxEntries: 9 } })
    expect(status).toBe(200)
    expect(pid).toHaveBeenCalledWith({ enabled: false, audit: { maxEntries: 9 } })
  })
})
