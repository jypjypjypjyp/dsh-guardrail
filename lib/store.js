import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, } from 'node:fs';
import { dirname } from 'node:path';
import { detectLikelyDoubleEscaped } from './rules.js';
/**
 * 用户规则存储：JSON 数组文件。
 * 损坏/缺失 → 备份 .bak（时间戳）+ 回退空规则，绝不崩溃。
 */
export class RuleStore {
    filePath;
    logger;
    rules = [];
    constructor(filePath, logger) {
        this.filePath = filePath;
        this.logger = logger;
    }
    load() {
        if (!existsSync(this.filePath)) {
            this.rules = [];
            return { rules: [], failures: [`rule file not found: ${this.filePath}`], warnings: [] };
        }
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(parsed))
                throw new Error('rule file must be a JSON array');
            this.rules = parsed;
            // 迁移告警：检出疑似双重转义的 pattern（合法但语义不对，compile+evaluate 会静默失效）。
            const warnings = this.rules
                .filter((r) => detectLikelyDoubleEscaped(r.pattern))
                .map((r) => `rule ${r.id} pattern 疑似双重转义，将永不命中：${r.pattern}`);
            return { rules: this.rules, failures: [], warnings };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                copyFileSync(this.filePath, `${this.filePath}.bak-${Date.now()}`);
            }
            catch {
                // 备份失败不阻断回退
            }
            this.rules = [];
            this.logger?.warn?.(`guardrail: rule file broken (${message}); backed up and reset to empty`);
            return { rules: [], failures: [`${message}`], warnings: [] };
        }
    }
    list() {
        return [...this.rules];
    }
    upsert(rule) {
        const index = this.rules.findIndex((r) => r.id === rule.id);
        if (index >= 0)
            this.rules[index] = rule;
        else
            this.rules.push(rule);
        this.save();
    }
    remove(id) {
        const index = this.rules.findIndex((r) => r.id === id);
        if (index < 0)
            return false;
        this.rules.splice(index, 1);
        this.save();
        return true;
    }
    save() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(this.rules, null, 2));
        }
        catch (error) {
            this.logger?.warn?.(`guardrail: failed to persist rules: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
//# sourceMappingURL=store.js.map