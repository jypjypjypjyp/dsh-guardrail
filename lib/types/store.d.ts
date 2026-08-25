import type { Rule } from './rules.js';
export interface RuleStoreLogger {
    warn?: (message: string) => void;
}
/**
 * 用户规则存储：JSON 数组文件。
 * 损坏/缺失 → 备份 .bak（时间戳）+ 回退空规则，绝不崩溃。
 */
export declare class RuleStore {
    private readonly filePath;
    private readonly logger?;
    private rules;
    constructor(filePath: string, logger?: RuleStoreLogger | undefined);
    load(): {
        rules: Rule[];
        failures: string[];
        warnings: string[];
    };
    list(): Rule[];
    upsert(rule: Rule): void;
    remove(id: string): boolean;
    private save;
}
