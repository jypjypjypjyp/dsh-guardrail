# dsh-guardrail

工具调用规范守卫：对 agent 工具调用**输入参数**做字符串匹配，命中危险行为则**拦截（deny）并注入原因**给模型，或**放行但注入警告（warn）**。附规则管理面板。

## 能力

- 挂 `tools/pre-execute`（waterfall）：deny → 工具不执行 + 原因注入模型可见错误；warn → 放行 + `tools/post-execute` 注入独立警告消息
- 内置 11 条高风险规则（删根/提权/管道执行远程代码/强推主分支/fork bomb 等），可启停、可覆盖动作
- 用户规则存 `~/.dsh/guardrail-rules.json`，面板编辑即热加载
- 面板（React 注册为 `conversation.view` 标签页）：规则列表/启停/增删、测试匹配器、审计视图
- 经 webServer 暴露 `/guardrail/api/*`（rules 增删改查、test 试跑、audit）
- 审计：内存环形缓冲（默认 200）+ 可选文件日志
- 匹配/加载异常一律放行（fail-open），不阻断正常流程

## 配置（profile cordis.patch.yml）

```yaml
- id: guardrail
  disabled: false
  config:
    rulesFile: ~/.dsh/guardrail-rules.json
    builtins:
      enabled: true
      overrides:
        - id: git-reset-hard
          action: deny   # 示例：把内置 warn 规则升级为 deny
    audit:
      maxEntries: 500
      logFile: ~/.dsh/guardrail-audit.log
```

## API

`GET /guardrail/api/rules` · `POST /guardrail/api/rules` · `PUT /guardrail/api/rules/:id` · `DELETE /guardrail/api/rules/:id` · `POST /guardrail/api/test` · `GET /guardrail/api/audit`（可 `?action=warn|deny|error`）

错误码：`400`（非法输入/JSON）。内置规则不可删除（`403`）、未知路由 `404`。

## 构建

```bash
bash scripts/build.sh    # 链接 DSH 安装依赖 + tsc（host） + tsdown（client）
```

构建产物 `lib/index.js`（host）、`lib/client.js`（browser bundle）、`lib/types/index.d.ts`。

## 规则字段

`id` · `tools?`（目标工具，空=全部）· `pattern`（正则）· `field?`（可选参数路径，如 `command`）· `action`（`deny`|`warn`）· `reason`（支持 `{tool}`/`{pattern}`）· `enabled`

内置规则 `builtin: true`：不可删除、不可改 pattern，可经 `builtins.overrides` 启停/覆盖动作。

> 注：源文件相对 import 使用 `.js` 扩展（NodeNext ESM 规范），测试文件使用 `.ts`（vitest 转译，且被排除出 host `tsc`）。测试运行用本地 `node_modules/.bin/vitest`。
