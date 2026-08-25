/**
 * 检测疑似「双重转义」的正则：字面 `\\x`（两个反斜杠后跟常见转义字母）。
 * 这类 pattern 是合法的 RegExp，但语义是「匹配字面反斜杠+字母」，几乎总是用户多包了一层转义
 * （如把 `[\s-]` 写成了 `[\\s-]`），导致 compile+evaluate 静默永不命中。仅作告警，不阻断。
 */
export function detectLikelyDoubleEscaped(pattern) {
    // `\\\\` = 两个字面反斜杠，后跟字母/数字（常见正则转义符）。warning-only，宁可略宽。
    return /\\\\[a-zA-Z0-9]/.test(pattern);
}
export function compileRule(rule) {
    try {
        return { ok: true, rule: { ...rule, regex: new RegExp(rule.pattern) } };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
export function compileRules(rules) {
    const compiled = [];
    const failures = [];
    for (const rule of rules) {
        if (!rule.enabled)
            continue;
        const result = compileRule(rule);
        if (result.ok)
            compiled.push(result.rule);
        else
            failures.push({ id: rule.id, error: result.error });
    }
    return { compiled, failures };
}
export function pickField(value, path) {
    if (!path)
        return value;
    let current = value;
    for (const part of path.split('.')) {
        if (current === null || typeof current !== 'object')
            return undefined;
        current = current[part];
    }
    return current;
}
export function stringifyForMatch(value) {
    try {
        return JSON.stringify(value) ?? '';
    }
    catch {
        return String(value);
    }
}
/**
 * 第一个命中的规则生效（按传入顺序：内置在前、用户在后）。
 * 匹配文本 = 工具名 + arguments JSON 全文；field 存在时只匹配该字段。
 */
export function evaluate(input, rules) {
    const needle = stringifyForMatch(input.arguments);
    for (const rule of rules) {
        if (rule.tools && rule.tools.length > 0 && !rule.tools.includes(input.name))
            continue;
        const target = rule.field ? pickField(input.arguments, rule.field) : `${input.name} ${needle}`;
        const text = rule.field ? stringifyForMatch(target) : target;
        const match = rule.regex.exec(text);
        if (match)
            return { rule, matched: (match[0] ?? '').slice(0, 120) };
    }
    return undefined;
}
export function renderReason(hit) {
    const tool = hit.rule.tools?.length ? hit.rule.tools.join(',') : '*';
    return hit.rule.reason
        .replaceAll('{tool}', tool)
        .replaceAll('{pattern}', hit.rule.pattern);
}
export function renderDenyReason(hit) {
    return `[guardrail] 命中规则 ${hit.rule.id}（${hit.rule.action}）：${renderReason(hit)}`;
}
//# sourceMappingURL=rules.js.map