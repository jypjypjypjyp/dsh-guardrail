import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { Audit } from './audit.js';
import { BUILTIN_RULES } from './builtin-rules.js';
import { createPostExecuteHandler, createPreExecuteHandler, WarnTracker, } from './handlers.js';
import { compileRules, detectLikelyDoubleEscaped, evaluate } from './rules.js';
import { RuleStore } from './store.js';
export const name = 'guardrail';
export const inject = ['webServer'];
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
});
export const Config = z.object({
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
});
/** 内置规则列表，应用 config.builtins.overrides（反映 enabled/action 覆盖）。 */
function builtinRules(config) {
    if (!config.builtins.enabled)
        return [];
    const overrideById = new Map(config.builtins.overrides.map((o) => [o.id, o]));
    return BUILTIN_RULES.map((r) => {
        const o = overrideById.get(r.id);
        return o ? { ...r, ...o, id: r.id, builtin: true } : r;
    });
}
/** 当前生效规则：内置（应用 overrides）+ 用户规则，按序（内置在前）。 */
function effectiveRules(config, store) {
    if (!config.enabled)
        return [];
    return compileRules([...builtinRules(config), ...store.list()]).compiled;
}
/** 用户可在 UI 改写的插件配置：持久化到 `~/.dsh/guardrail-config.json`。 */
const CONFIG_FILE = join(homedir(), '.dsh', 'guardrail-config.json');
function loadConfig() {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function saveConfig(cfg) {
    try {
        mkdirSync(dirname(CONFIG_FILE), { recursive: true });
        writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    }
    catch {
        // 配置写盘失败不阻断拦截链路
    }
}
const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
});
/** webServer prefix 路由 handler（/guardrail/api/*），独立导出便于测试。 */
export function createApiHandler(deps) {
    return async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://guardrail.local');
            const rest = url.pathname.replace(/^\/guardrail\/api/, '').replace(/\/+$/, '') || '/';
            const segments = rest.split('/').filter(Boolean);
            if (req.method === 'GET' && rest === '/rules') {
                json(res, 200, { rules: deps.builtins().concat(deps.store.list()) });
                return;
            }
            if (req.method === 'GET' && rest === '/audit') {
                const action = url.searchParams.get('action');
                json(res, 200, { entries: deps.audit.list(action ? { action: action } : undefined) });
                return;
            }
            if (req.method === 'GET' && rest === '/config') {
                json(res, 200, { config: deps.config.get() });
                return;
            }
            if (req.method === 'PUT' && rest === '/config') {
                const body = JSON.parse(await readBody(req));
                deps.config.put(body);
                json(res, 200, { ok: true, config: deps.config.get() });
                return;
            }
            if (req.method === 'POST' && rest === '/test') {
                const body = JSON.parse(await readBody(req));
                if (!body.tool) {
                    json(res, 400, { error: 'tool required' });
                    return;
                }
                const hit = evaluate({ name: body.tool, arguments: body.args }, deps.rules());
                json(res, 200, { hit: Boolean(hit), ruleId: hit?.rule.id ?? null, matched: hit?.matched ?? null });
                return;
            }
            if (req.method === 'POST' && rest === '/rules') {
                const parsed = JSON.parse(await readBody(req));
                if (!parsed.id || !parsed.pattern || !parsed.action) {
                    json(res, 400, { error: 'id/pattern/action required' });
                    return;
                }
                deps.store.upsert(parsed);
                const warning = detectLikelyDoubleEscaped(parsed.pattern)
                    ? `pattern 疑似双重转义（将永不命中）：${parsed.pattern}`
                    : undefined;
                json(res, 200, { ok: true, warning });
                return;
            }
            if (req.method === 'PUT' && segments.length === 2 && segments[0] === 'rules') {
                const id = segments[1];
                const parsed = JSON.parse(await readBody(req));
                const existing = deps.store.list().find((r) => r.id === id);
                if (existing) {
                    deps.store.upsert({ ...existing, ...parsed, id });
                    json(res, 200, { ok: true });
                }
                else if (deps.builtins().some((r) => r.id === id)) {
                    json(res, 200, { ok: true, note: 'builtin override stored by index.ts' });
                }
                else {
                    json(res, 404, { error: 'rule not found' });
                }
                return;
            }
            if (req.method === 'DELETE' && segments.length === 2 && segments[0] === 'rules') {
                const id = segments[1];
                if (deps.builtins().some((r) => r.id === id)) {
                    json(res, 403, { error: 'builtin rules cannot be deleted' });
                    return;
                }
                json(res, 200, { ok: deps.store.remove(id) });
                return;
            }
            json(res, 404, { error: 'not found' });
        }
        catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
    };
}
export function apply(ctx, config) {
    const defaults = {
        enabled: true,
        rulesFile: join(homedir(), '.dsh', 'guardrail-rules.json'),
        builtins: { enabled: true, overrides: [] },
        audit: { maxEntries: 200 },
    };
    const entry = { ...defaults, ...config };
    // 有效配置 = 组合传入 + 默认 + 用户经 UI 写入的配置文件（文件覆盖）。
    let current = { ...entry, ...loadConfig() };
    const resolve = () => current;
    // 注册 settings 命名空间（让"设置"页可寻址该配置）；setSource 回流合并进 current。
    installSettingsSection(ctx, settingsNamespace('guardrail'), Config, entry, {
        setSource: (get) => { current = { ...current, ...get() }; },
        onChange: () => { },
    });
    const store = new RuleStore(resolve().rulesFile, ctx.logger);
    const loadResult = store.load();
    if (loadResult.failures.length > 0) {
        ctx.logger?.warn?.(`guardrail: rules load issues: ${loadResult.failures.join('; ')}`);
    }
    if (loadResult.warnings.length > 0) {
        ctx.logger?.warn?.(`guardrail: ${loadResult.warnings.join('; ')}`);
    }
    const audit = new Audit(resolve().audit.maxEntries, resolve().audit.logFile);
    const tracker = new WarnTracker();
    const deps = {
        rules: () => effectiveRules(resolve(), store),
        audit,
    };
    const apiDeps = {
        ...deps,
        store,
        builtins: () => builtinRules(resolve()),
        config: {
            get: () => ({ ...current }),
            put: (cfg) => {
                current = {
                    ...current,
                    ...cfg,
                    builtins: { ...current.builtins, ...(cfg.builtins ?? {}) },
                    audit: { ...current.audit, ...(cfg.audit ?? {}) },
                };
                saveConfig(current);
            },
        },
    };
    ctx.effect(() => ctx.on('tools/pre-execute', createPreExecuteHandler(deps, tracker)), 'guardrail: pre-execute');
    ctx.effect(() => ctx.on('tools/post-execute', createPostExecuteHandler(deps, tracker)), 'guardrail: post-execute');
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: '/guardrail/api',
        handler: createApiHandler(apiDeps),
    }), 'guardrail: api');
}
//# sourceMappingURL=index.js.map