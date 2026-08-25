import type { PostToolDecision, PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { Audit } from './audit.js';
import { type CompiledRule, type RuleHit } from './rules.js';
export interface GuardrailDeps {
    /** 当前生效的已编译规则（内置 + 用户，按优先级排序） */
    rules: () => CompiledRule[];
    audit: Audit;
}
/** pre-execute 登记、post-execute 消费的 warn 命中标记（按 callId）。 */
export declare class WarnTracker {
    private readonly map;
    set(callId: string, hit: RuleHit): void;
    take(callId: string): RuleHit | undefined;
    clear(): void;
}
export declare function createPreExecuteHandler(deps: GuardrailDeps, tracker: WarnTracker): (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>;
export declare function createPostExecuteHandler(deps: GuardrailDeps, tracker: WarnTracker): (exec: ToolExecution, _result: Readonly<unknown>, next: () => Promise<PostToolDecision>) => Promise<PostToolDecision>;
