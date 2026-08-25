# 如何发布一个 DSH 插件（简报）

> 基于 dsh-guardrail 的实际发布过程整理。目标：把一个写好的 DSH 插件上架到官方清单。核心结论：**插件自己不放 npm / 不进市场 APP，只往「插件目录仓库」提一个 PR 加一条 YAML 即可上架。**

---

## 一、先搞清三层结构（大部分人卡在这）

| 仓库 | 是什么 | 你要做什么 |
|---|---|---|
| `dsh-market/dsh-market` | **市场 APP** 本体（发布到 npm 叫 `dshmarket`），用来浏览/安装插件 | ❌ 不用往它提 PR |
| `awesome-dsh-plugin/awesome-dsh-plugin` | **插件清单（目录仓库）**，人工精选的注册表 | ✅ 提一个 PR 加一条 YAML 就上架 |
| 你的插件仓库（如 `jypjypjypjyp/dsh-guardrail`） | 插件本体（`dsh.bundle` + 预编译产物） | ✅ 设为 public，可带 GitHub Release tarball |

> ⚠️ 不要在 dsh-market 里找"发布插件"入口——它是市场 APP，插件清单在 awesome-dsh-plugin。

---

## 二、插件发布前必须满足（前置门槛）

1. **仓库根有 `dsh.bundle`**，指向你的 `cordis.patch.yml`：
   ```json
   { "patch": "./cordis.patch.yml" }
   ```
2. **有预编译产物**：一个 `.tgz`，内含 `lib/`（host）+ `lib/client.js`（UI）+ `cordis.patch.yml`。
3. **`package.json` 的 `@deepseek-ai/*` peer 范围**必须用**显式 `||` prerelease 分支**：
   ```
   ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.2.0-0"
   ```
   旧写法 `>=0.0.1-rc <2` 会**静默排除**真实的 `0.1.0-rc.7` → 别人 `npm i` 时 ERESOLVE。
4. **仓库设为 public**（否则目录条目指向的 release 不可达）。
5. 建议打个 **GitHub Release v0.0.1**，把 tarball 作为资产上传，目录 `tarball:` 直指它。

---

## 三、发布方式：按优先级选

| 优先级 | 方式 | 需要什么 | 说明 |
|---|---|---|---|
| ✅ 首选 | `npm publish` | 有 npm auth token | 最标准，但很多人（包括我）没有 token |
| ✅ 我们选的 | **GitHub Release tarball** | 无需 npm token | 依赖 `releases/latest/download/<pkg>-<ver>.tgz`，`302→200 octet-stream` 即可 |
| ⚠️ 兜底 | 源码 | 无 | 目录支持 `repo`+`path` 指向源码 |

- 若走 **Release tarball**，目录 YAML 的 `tarball:` 字段要用**你在 GitHub Release 上的 HTTPS 直链**（推荐 `releases/latest/download/`，最稳）。
- `npm publish` 不是必须——没有 npm token 时，public 仓库 + Release tarball 就是推荐路径。

---

## 四、上架到目录仓库的步骤

1. **fork** `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 在 fork 里新建分支，添加你的条目文件：
   `data/plugins/<owner>__<repo>.yml`
   ```yaml
   - name: dsh-guardrail
     description: Guardrail 工具调用拦截
     author: jypjypjypjyp
     repository: https://github.com/jypjypjypjyp/dsh-guardrail
     tarball: https://github.com/jypjypjypjyp/dsh-guardrail/releases/latest/download/dsh-guardrail-0.0.1.tgz
     category: security
   ```
   > 形如 `owner`（owner 名）与 `repo`（仓库名）必须和 GitHub 上一致。
3. **重新生成 README**（目录用脚本生成 `README.md` / `README.zh.md`，不能手改，否则一致性校验会挂）。
4. 跑校验：`validateEntries` → 必须 `PASS`，且 diff 只留下**你自己的那一条**。
5. 确认 YAML 可解析（注意 `: ` 后有空格是 key 分隔符，中文可用全角冒号避开）。
6. **提 PR** 到 `awesome-dsh-plugin/awesome-dsh-plugin`，base 为 main。

---

## 五、自动门槛（CI 强制，`scripts/check-submission.mjs`）

```
MIN_AGE_DAYS = 1      # 仓库创建满 24 小时
MIN_COMMITS  = 10     # 仓库提交数 ≥10
```

此外还会校验：
- 仓库树里任一 `package.json` 含 `dsh.bundle`；
- README 与 `data/` 一致。

> 🔴 **年龄门槛是真实硬门**：仓库不满 1 天，无论 YAML 多规范都会被 `pr-gate.yml` 自动打回。所以 **PR 必须在仓库满 24h 之后再开**，不能提前。

---

## 六、经验与坑（别人踩过的）

- **peer 范围**：必须 `||` prerelease 分支（见 §二，用真实 `0.1.0-rc.7` 验证过）。
- **双重转义**：用户写正则进 `~/.dsh/guardrail-rules.json` 时若多打一层反斜杠（`\\s`→字面 `\s`），compile+evaluate 会**永不命中**；补回归测试"JSON→compile→evaluate 仍命中"。
- **UI 零硬编码颜色**：只用 DSH 主题 token（`--dsw-alias-*`/`--ds-*`），否则暗主题下红底红字不可读。
- **发布物脱敏**：`lib/` 不入库、`.gitignore` 含 `*.tgz`、README 截图里的绝对路径（如 `/home/me`）应改 `~`。
- **别热重载核心组合插件**：`dev_reload_package` 只适合 bundling 插件；对 `dsh-client-modules` 这类组合插件热重载会导致 client bundle 404。
