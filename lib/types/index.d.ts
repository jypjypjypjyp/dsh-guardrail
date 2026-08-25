/**
 * dsh-guardrail — 工具调用规范守卫。
 *
 * host 侧：监听 tools/pre-execute（waterfall）对工具调用输入参数做字符串匹配——
 * 命中 deny 规则 → 工具不执行、原因物化为模型可见错误；命中 warn 规则 → 放行并在
 * tools/post-execute 附加独立警告消息。规则 = 内置（代码）+ 用户（JSON 文件，热加载）。
 * 经 webServer 暴露 /guardrail/api/* 供管理面板读写。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type GuardrailDeps } from './handlers.js';
import { type Rule } from './rules.js';
import { RuleStore } from './store.js';
export declare const name = "guardrail";
export declare const inject: string[];
export interface Config {
    enabled: boolean;
    rulesFile: string;
    builtins: {
        enabled: boolean;
        overrides: Rule[];
    };
    audit: {
        maxEntries: number;
        logFile?: string;
    };
}
export declare const Config: z<Config>;
export interface ApiDeps extends GuardrailDeps {
    store: RuleStore;
    builtins: () => Rule[];
    config: {
        get: () => Config;
        put: (cfg: Partial<Config>) => void;
    };
}
/** webServer prefix 路由 handler（/guardrail/api/*），独立导出便于测试。 */
export declare function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export declare function apply(ctx: Context, config?: Config): void;
