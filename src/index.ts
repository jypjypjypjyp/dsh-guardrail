/**
 * dsh-guardrail — 工具调用规范守卫。
 *
 * host 侧：监听 tools/pre-execute（waterfall）对工具调用输入参数做字符串匹配——
 * 命中 deny 规则 → 工具不执行、原因物化为模型可见错误；命中 warn 规则 → 放行并在
 * tools/post-execute 附加独立警告消息。规则 = 内置（代码）+ 用户（JSON 文件，热加载）。
 * 经 webServer 暴露 /guardrail/api/* 供管理面板读写。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 拉取 @deepseek-ai/dsh-host-webserver 的 cordis 模块增强（ctx.webServer 类型）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { Audit } from './audit.js'
import { BUILTIN_RULES } from './builtin-rules.js'
import {
  createPostExecuteHandler, createPreExecuteHandler, WarnTracker,
  type GuardrailDeps,
} from './handlers.js'
import { compileRules, evaluate, type CompiledRule, type Rule } from './rules.js'
import { RuleStore } from './store.js'

export const name = 'guardrail'
export const inject = ['webServer']

const RuleSchema = z.object({
  id: z.string(),
  tools: z.array(z.string()).default([]),
  pattern: z.string(),
  // schemastery: 字段缺省即 optional（无 .optional() 方法），故直接声明。
  field: z.string(),
  action: z.union([z.const('deny'), z.const('warn')]),
  reason: z.string(),
  enabled: z.boolean().default(true),
  builtin: z.boolean(),
})

export interface Config {
  enabled: boolean
  rulesFile: string
  builtins: {
    enabled: boolean
    overrides: Rule[]
  }
  audit: {
    maxEntries: number
    logFile?: string
  }
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  rulesFile: z.string().default(join(homedir(), '.dsh', 'guardrail-rules.json')),
  builtins: z.object({
    enabled: z.boolean().default(true),
    overrides: z.array(RuleSchema).default([]),
  }),
  audit: z.object({
    maxEntries: z.number().min(10).max(10000).default(200),
    logFile: z.string(),
  }),
})

/** 当前生效规则：内置（应用 overrides）+ 用户规则，按序（内置在前）。 */
function effectiveRules(config: Config, store: RuleStore): CompiledRule[] {
  if (!config.enabled) return []
  const overrideById = new Map(config.builtins.overrides.map((r) => [r.id, r]))
  const builtins = config.builtins.enabled
    ? BUILTIN_RULES.map((r) => {
        const o = overrideById.get(r.id)
        return o ? { ...r, ...o, id: r.id, builtin: true } : r
      })
    : []
  return compileRules([...builtins, ...store.list()]).compiled
}

export interface ApiDeps extends GuardrailDeps {
  store: RuleStore
  builtins: () => Rule[]
}

const json = (res: ServerResponse, status: number, data: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })

/** webServer prefix 路由 handler（/guardrail/api/*），独立导出便于测试。 */
export function createApiHandler(deps: ApiDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://guardrail.local')
      const rest = url.pathname.replace(/^\/guardrail\/api/, '').replace(/\/+$/, '') || '/'
      const segments = rest.split('/').filter(Boolean)

      if (req.method === 'GET' && rest === '/rules') {
        json(res, 200, { rules: deps.builtins().concat(deps.store.list()) })
        return
      }
      if (req.method === 'GET' && rest === '/audit') {
        const action = url.searchParams.get('action')
        json(res, 200, { entries: deps.audit.list(action ? { action: action as 'deny' | 'warn' | 'error' } : undefined) })
        return
      }
      if (req.method === 'POST' && rest === '/test') {
        const body = JSON.parse(await readBody(req)) as { tool?: string; args?: unknown }
        if (!body.tool) { json(res, 400, { error: 'tool required' }); return }
        const hit = evaluate({ name: body.tool, arguments: body.args }, deps.rules())
        json(res, 200, { hit: Boolean(hit), ruleId: hit?.rule.id ?? null, matched: hit?.matched ?? null })
        return
      }
      if (req.method === 'POST' && rest === '/rules') {
        const parsed = JSON.parse(await readBody(req)) as Rule
        if (!parsed.id || !parsed.pattern || !parsed.action) { json(res, 400, { error: 'id/pattern/action required' }); return }
        deps.store.upsert(parsed)
        json(res, 200, { ok: true })
        return
      }
      if (req.method === 'PUT' && segments.length === 2 && segments[0] === 'rules') {
        const id = segments[1]
        const parsed = JSON.parse(await readBody(req)) as Partial<Rule>
        const existing = deps.store.list().find((r) => r.id === id)
        if (existing) {
          deps.store.upsert({ ...existing, ...parsed, id })
          json(res, 200, { ok: true })
        } else if (deps.builtins().some((r) => r.id === id)) {
          json(res, 200, { ok: true, note: 'builtin override stored by index.ts' })
        } else {
          json(res, 404, { error: 'rule not found' })
        }
        return
      }
      if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'rules') {
        const id = segments[1]
        if (deps.builtins().some((r) => r.id === id)) { json(res, 403, { error: 'builtin rules cannot be deleted' }); return }
        json(res, 200, { ok: deps.store.remove(id) })
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function apply(ctx: Context, config?: Config): void {
  const resolve = (): Config => ({
    enabled: true,
    rulesFile: join(homedir(), '.dsh', 'guardrail-rules.json'),
    builtins: { enabled: true, overrides: [] },
    audit: { maxEntries: 200 },
    ...config,
  })

  const store = new RuleStore(resolve().rulesFile, ctx.logger)
  const loadResult = store.load()
  if (loadResult.failures.length > 0) {
    ctx.logger?.warn?.(`guardrail: rules load issues: ${loadResult.failures.join('; ')}`)
  }

  const audit = new Audit(resolve().audit.maxEntries, resolve().audit.logFile)
  const tracker = new WarnTracker()
  const deps: GuardrailDeps = {
    rules: () => effectiveRules(resolve(), store),
    audit,
  }
  const apiDeps: ApiDeps = {
    ...deps,
    store,
    builtins: () => (resolve().builtins.enabled ? BUILTIN_RULES : []),
  }

  ctx.effect(() => ctx.on('tools/pre-execute', createPreExecuteHandler(deps, tracker)), 'guardrail: pre-execute')
  ctx.effect(() => ctx.on('tools/post-execute', createPostExecuteHandler(deps, tracker)), 'guardrail: post-execute')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/guardrail/api',
    handler: createApiHandler(apiDeps),
  }), 'guardrail: api')
}
