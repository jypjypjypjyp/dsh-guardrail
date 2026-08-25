import { appendFileSync } from 'node:fs';
export function summarizeArgs(args, max = 120) {
    let s;
    try {
        s = JSON.stringify(args) ?? '';
    }
    catch {
        s = String(args);
    }
    return s.length > max ? s.slice(0, max) + '…' : s;
}
export class Audit {
    maxEntries;
    logFile;
    entries = [];
    constructor(maxEntries, logFile) {
        this.maxEntries = maxEntries;
        this.logFile = logFile;
    }
    push(entry) {
        this.entries.push(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.splice(0, this.entries.length - this.maxEntries);
        }
        if (this.logFile) {
            try {
                appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
            }
            catch {
                // 日志写入失败不阻断拦截链路
            }
        }
    }
    list(filter) {
        if (!filter?.action)
            return [...this.entries];
        return this.entries.filter((e) => e.action === filter.action);
    }
}
//# sourceMappingURL=audit.js.map