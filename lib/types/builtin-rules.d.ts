import type { Rule } from './rules.js';
/**
 * 内置规则集：精选高风险行为，默认 deny（git 危险操作部分 warn）。
 * 不可删除、不可改 pattern；可经 builtins.overrides 启停/覆盖动作。
 */
export declare const BUILTIN_RULES: Rule[];
