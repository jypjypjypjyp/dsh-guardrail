export type AuditAction = 'deny' | 'warn' | 'error';
export interface AuditEntry {
    ts: number;
    agent?: string;
    tool: string;
    argsSummary: string;
    ruleId: string;
    action: AuditAction;
    reason: string;
    outcome?: 'denied' | 'allowed';
}
export declare function summarizeArgs(args: unknown, max?: number): string;
export declare class Audit {
    private readonly maxEntries;
    private readonly logFile?;
    private entries;
    constructor(maxEntries: number, logFile?: string | undefined);
    push(entry: AuditEntry): void;
    list(filter?: {
        action?: AuditAction;
    }): AuditEntry[];
}
