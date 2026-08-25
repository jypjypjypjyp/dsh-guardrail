# dsh-guardrail

工具调用规范守卫：对 agent 工具调用**输入参数**做字符串匹配，命中危险行为则**拦截（deny）并注入原因**给模型，或**放行但注入警告（warn）**。附规则管理面板（配置/启停/增删/试跑/审计全部可在 UI 完成）。

## 能力

- 挂 `tools/pre-execute`（waterfall）：deny → 工具不执行 + 原因注入模型可见错误；warn → 放行 + `tools/post-execute` 注入独立警告消息
- 内置 11 条高风险规则（删根/提权/管道执行远程代码/强推主分支/fork bomb 等），可启停、可覆盖动作（deny/warn）
- 用户规则存 `~/.dsh/guardrail-rules.json`，面板编辑即热加载
- 面板（React 注册为会话视图 `guardrail` 标签页）：规则列表/启停/增删/动作切换、测试匹配器、添加规则、审计视图
- 经 webServer 暴露 `/guardrail/api/*`（rules 增删改查、test 试跑、audit、config）
- 审计：内存环形缓冲（默认 200）+ 可选文件日志
- 匹配/加载异常一律放行（fail-open），不阻断正常流程
- 正则支持 lookbehind（需 Node/浏览器 V8），可写「必须 uv pip」这类约束规则
- 面板样式**只使用 DSH 系统主题 token（`--dsw-alias-*` / `--ds-*`）**，无自定义硬编码颜色；随亮/暗主题自动切换，与整站统一

## 安装

> **注意**：仓库 `.gitignore` 排除 `lib/`（构建产物不提交）。克隆或下载后**必须构建**才能被 DSH 装配。

```bash
git clone <repo-url> dsh-guardrail
cd dsh-guardrail
bash scripts/build.sh        # 链接 DSH 安装依赖 + tsc(host) + tsdown(client)
```

构建产物：`lib/index.js`（host）、`lib/client.js`（browser bundle）、`lib/types/index.d.ts`。

### 装配进 web profile（持久化，重启自动加载）

本地做以下两步即装配（免重启可用注入器，重启后仍生效）：

1. `package.json` 加 `dsh.bundle.patch`（已内置 `cordis.patch.yml`）。
2. 在 profile 的 `dsh.profile.bundles` 数组追加 `dsh-guardrail`（并建 `node_modules` 的 `link:` 指向本仓库）。

或使用 dsh-super-injector 的 `dev_inject_plugin` / `dev_install_package` 热装配。启动后浏览器进入任一会话，右上标签页出现 **guardrail** 即加载成功。

## 使用说明（图文）

### 1. 找到面板

打开 DSH 网页（如 `http://127.0.0.1:3080`），进入任意会话，在顶部标签栏点击 **guardrail**（位于「对话 / 轨迹」右侧）。

### 2. 配置区（顶部卡片，见图「面板-配置与规则」上部）

- **启用守卫**：总开关，关闭后所有规则不再拦截/警告
- **规则文件**：用户规则 JSON 路径（只读展示），默认 `~/.dsh/guardrail-rules.json`
- **启用内置规则**：是否启用 11 条内置规则
- **审计上限**：内存环形缓冲条数（如 200）
- **日志文件**：可选，把审计写入该文件

### 3. 规则管理

![面板-配置与规则](docs/images/panel-config-rules.png)

每条规则一行，含：

- **图标**：📦=内置规则、📝=用户规则
- **动作徽章**：🟥 deny 拦截 / 🟨 warn 警告
- **目标工具 + 正则**（截断显示）
- **停用 / 启用**：切换启停；**停用后整行加划线**，更醒目
- **deny / warn 下拉**：切换动作——内置规则经 `builtins.overrides` 保存，用户规则直接改记录
- **删除**：仅用户规则有（内置规则不可删，删需 API 403）

所有修改即时持久化到 `~/.dsh/guardrail-config.json` 与 `~/.dsh/guardrail-rules.json`。

### 4. 测试匹配器与添加规则

![面板-测试与审计](docs/images/panel-test-add-audit.png)

- **测试 / 添加规则**：填「工具名」（如 `bash`）+「参数 JSON」（如 `{"command":"rm -rf /"}`），点 **试跑**，下方显示命中的规则与片段：
  - `✅ 命中 rm-root · 片段: rm -rf /` → 该输入会被对应规则拦截/警告
  - `未命中` → 匹配不到任何启用规则

![面板-试跑结果](docs/images/panel-test-result.png)

- **添加规则**：填 `id`（必填）、正则 `pattern`（必填）、动作 `deny/warn`、`reason`（可用 `{tool}` / `{pattern}` 占位）、`tools`（逗号分隔，空=全部）、`field`（可选参数路径，如 `command`），点 **添加规则** 即热加载。

### 5. 审计

面板底部「审计（最近 30 条）」实时展示：`[时间] action tool → ruleId reason`。为拦截/警告行为留痕。

## 规则字段

`id` · `tools?`（目标工具，空=全部）· `pattern`（正则）· `field?`（可选参数路径，如 `command`）· `action`（`deny`|`warn`）· `reason`（支持 `{tool}`/`{pattern}`）· `enabled`

内置规则 `builtin: true`：不可删除、不可改 pattern，可经 `builtins.overrides` 启停/覆盖动作。

### 用 lookbehind 约束「必须走 uv」

例：pip 必须用 `uv pip`、python 必须走 `uv run`：

- deny `(?<!uv[\s-])\bpip3?\b` —— 禁止直接 `pip` 安装
- warn `(?<!uv\s+run\s+)\bpython3?\b` —— 直接 `python` 走 warn

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

`GET /guardrail/api/rules` · `POST /guardrail/api/rules` · `PUT /guardrail/api/rules/:id` · `DELETE /guardrail/api/rules/:id` · `POST /guardrail/api/test` · `GET /guardrail/api/audit`（可 `?action=warn|deny|error`） · `GET /guardrail/api/config` · `PUT /guardrail/api/config`

错误码：`400`（非法输入/JSON）。内置规则不可删除（`403`）、未知路由 `404`。

> `POST /rules` 只要求 `id`/`pattern`/`action`（服务端校验），`reason`/`enabled` 走默认值，`tools`/`field` 可选透传。

## 构建

```bash
bash scripts/build.sh    # 链接 DSH 安装依赖 + tsc（host） + tsdown（client）
```

> 注：源文件相对 import 使用 `.js` 扩展（NodeNext ESM 规范），测试文件使用 `.ts`（vitest 转译，且被排除出 host `tsc`）。测试运行用本地 `node_modules/.bin/vitest`。
