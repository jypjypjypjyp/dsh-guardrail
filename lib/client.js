window.__ModuleLoader__.load({
	id: "dsh-guardrail",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
		/**
		* dsh-guardrail 管理面板（客户端）。
		*
		* 通过 DSH client 的真实 slot API 注册一个 `conversation.view` 条目（kind:list，
		* 追加式）——在会话视图环里提供 "guardrail" 标签页，渲染规则管理 UI。
		* 不 import 真实 slot 包（宿主在运行时经 module loader 提供 slots 服务与 react），
		* 因此这里用 `ctx.slots` 与 React 外部依赖，构建走 tsdown（browser bundle）。
		*
		* 样式约定：全部视觉只使用 DSH 系统主题 token（`--dsw-alias-*` / `--ds-*`），
		* 不引入自定义硬编码颜色/字体，随主题（亮/暗）自动切换，与整站统一。
		*/
		/** 插件注入的服务。 */
		const inject = ["slots"];
		const API = "/guardrail/api";
		const DEFAULT_CFG = {
			enabled: true,
			rulesFile: "",
			builtins: {
				enabled: true,
				overrides: []
			},
			audit: { maxEntries: 200 }
		};
		const STYLE = `
#guardrail-panel {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
#guardrail-panel button,
#guardrail-panel input,
#guardrail-panel select,
#guardrail-panel textarea {
  font-family: inherit;
}
#guardrail-panel button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
  color: var(--dsw-alias-label-primary);
}
#guardrail-panel button:disabled { opacity: .5; cursor: default; }
#guardrail-panel button.gr-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
#guardrail-panel button.gr-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
#guardrail-panel button.gr-ghost {
  background: var(--dsw-alias-bg-layer-1);
  border-color: var(--dsw-alias-border-l2);
}
#guardrail-panel button.gr-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
#guardrail-panel button.gr-danger { color: var(--dsw-alias-state-error-primary); }
#guardrail-panel button.gr-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
#guardrail-panel select,
#guardrail-panel input,
#guardrail-panel textarea {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
  box-sizing: border-box;
  max-width: 100%;
}
#guardrail-panel select:focus,
#guardrail-panel input:focus,
#guardrail-panel textarea:focus {
  border-color: var(--dsw-alias-border-l3);
  outline: none;
}
#guardrail-panel .gr-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
`;
		const S = {
			root: { padding: 12 },
			heading: {
				fontWeight: 700,
				marginBottom: 8
			},
			sub: {
				fontWeight: 600,
				margin: "6px 0 4px",
				color: "var(--dsw-alias-label-secondary)"
			},
			card: {
				margin: "6px 0",
				padding: 10,
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-module-platform)"
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "3px 6px",
				borderRadius: 6
			},
			rowDisabled: {
				textDecoration: "line-through",
				opacity: .5,
				color: "var(--dsw-alias-label-tertiary)"
			},
			muted: {
				color: "var(--dsw-alias-label-secondary)",
				fontSize: 11
			},
			code: { fontFamily: "var(--ds-font-family-code)" },
			error: {
				color: "var(--dsw-alias-state-error-primary)",
				marginBottom: 6
			},
			label: {
				display: "block",
				margin: "2px 0",
				color: "var(--dsw-alias-label-secondary)"
			},
			result: {
				whiteSpace: "pre-wrap",
				marginTop: 6,
				color: "var(--dsw-alias-label-primary)"
			},
			audit: {
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 11
			}
		};
		const badge = (kind) => ({
			display: "inline-flex",
			alignItems: "center",
			padding: "0 8px",
			height: 18,
			borderRadius: 999,
			fontSize: 11,
			fontWeight: 600,
			flexShrink: 0,
			background: kind === "deny" ? "color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, var(--dsw-alias-bg-layer-1))" : "color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, var(--dsw-alias-bg-layer-1))",
			color: kind === "deny" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-warn-primary)"
		});
		async function apiGet(path) {
			const res = await fetch(API + path);
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			return res.json();
		}
		async function apiSend(method, path, body) {
			const text = await (await fetch(API + path, {
				method,
				headers: { "Content-Type": "application/json" },
				body: body === void 0 ? void 0 : JSON.stringify(body)
			})).text();
			return text ? JSON.parse(text) : null;
		}
		function GuardrailPanel() {
			const [rules, setRules] = react.default.useState([]);
			const [audit, setAudit] = react.default.useState([]);
			const [error, setError] = react.default.useState("");
			const [tool, setTool] = react.default.useState("");
			const [args, setArgs] = react.default.useState("");
			const [result, setResult] = react.default.useState("");
			const [cfg, setCfg] = react.default.useState(DEFAULT_CFG);
			const [newId, setNewId] = react.default.useState("");
			const [newPattern, setNewPattern] = react.default.useState("");
			const [newAction, setNewAction] = react.default.useState("deny");
			const [newReason, setNewReason] = react.default.useState("");
			const [newTools, setNewTools] = react.default.useState("");
			const [newField, setNewField] = react.default.useState("");
			const refresh = react.default.useCallback(async () => {
				try {
					const r = await apiGet("/rules");
					setRules(r.rules ?? []);
					const a = await apiGet("/audit");
					setAudit((a.entries ?? []).slice(-30));
					const c = await apiGet("/config");
					if (c.config) setCfg(c.config);
				} catch (e) {
					setError(String(e));
				}
			}, []);
			react.default.useEffect(() => {
				refresh();
				const t = window.setInterval(() => void refresh(), 5e3);
				return () => window.clearInterval(t);
			}, [refresh]);
			const saveConfig = async (next) => {
				try {
					const r = await apiSend("PUT", "/config", next);
					if (r.config) setCfg(r.config);
					setError("");
				} catch (e) {
					setError(String(e));
				}
			};
			const overrideBuiltin = async (id, patch) => {
				const others = (cfg.builtins.overrides ?? []).filter((o) => o.id !== id);
				await saveConfig({
					...cfg,
					builtins: {
						...cfg.builtins,
						overrides: [...others, {
							id,
							...patch
						}]
					}
				});
				await refresh();
			};
			const toggleRule = async (id, enabled) => {
				try {
					await apiSend("PUT", `/rules/${encodeURIComponent(id)}`, { enabled: !enabled });
					await refresh();
				} catch (e) {
					setError(String(e));
				}
			};
			const removeRule = async (id) => {
				try {
					await apiSend("DELETE", `/rules/${encodeURIComponent(id)}`);
					await refresh();
				} catch (e) {
					setError(String(e));
				}
			};
			const runTest = async () => {
				try {
					const data = await apiSend("POST", "/test", {
						tool: tool.trim(),
						args: JSON.parse(args || "{}")
					});
					setResult(data.hit ? `✅ 命中 ${data.ruleId}\n片段：${data.matched}` : "✅ 未命中（放行）");
				} catch (e) {
					setResult(`❌ ${String(e)}`);
				}
			};
			const addRule = async () => {
				const id = newId.trim();
				const pattern = newPattern.trim();
				if (!id || !pattern) {
					setError("添加规则须填 id 与 pattern");
					return;
				}
				const rule = {
					id,
					pattern,
					action: newAction,
					reason: newReason.trim() || `命中规则 ${id}`,
					enabled: true
				};
				const tools = newTools.trim() ? newTools.split(",").map((s) => s.trim()).filter(Boolean) : void 0;
				if (tools && tools.length) rule.tools = tools;
				if (newField.trim()) rule.field = newField.trim();
				try {
					await apiSend("POST", "/rules", rule);
					setNewId("");
					setNewPattern("");
					setNewReason("");
					setNewTools("");
					setNewField("");
					setError("");
					await refresh();
				} catch (e) {
					setError(String(e));
				}
			};
			const setRuleAction = async (id, action) => {
				try {
					await apiSend("PUT", `/rules/${encodeURIComponent(id)}`, { action });
					await refresh();
				} catch (e) {
					setError(String(e));
				}
			};
			const rows = rules.map((r) => react.default.createElement("div", {
				style: {
					...S.row,
					...r.enabled ? {} : S.rowDisabled
				},
				className: "gr-row",
				key: r.id
			}, react.default.createElement("span", { style: {
				fontWeight: 600,
				...r.enabled ? {} : { textDecoration: "line-through" }
			} }, `${r.builtin ? "📦" : "📝"} ${r.id}`), react.default.createElement("span", { style: badge(r.action) }, r.action), react.default.createElement("span", { style: {
				...S.muted,
				...S.code
			} }, `${r.tools?.length ? r.tools.join(",") : "*"}  ${r.pattern.slice(0, 32)}`), react.default.createElement("button", {
				className: "gr-ghost",
				style: { marginLeft: "auto" },
				onClick: () => void (r.builtin ? overrideBuiltin(r.id, { enabled: !r.enabled }) : toggleRule(r.id, r.enabled))
			}, r.enabled ? "停用" : "启用"), react.default.createElement("select", {
				value: r.action,
				onChange: (e) => void (r.builtin ? overrideBuiltin(r.id, { action: e.target.value }) : setRuleAction(r.id, e.target.value))
			}, react.default.createElement("option", { value: "deny" }, "deny"), react.default.createElement("option", { value: "warn" }, "warn")), !r.builtin ? react.default.createElement("button", {
				className: "gr-ghost gr-danger",
				onClick: () => void removeRule(r.id)
			}, "删除") : null));
			const audits = audit.map((e, i) => react.default.createElement("div", {
				key: `${e.ts}-${i}`,
				style: S.audit
			}, `[${new Date(e.ts).toLocaleTimeString()}] ${e.action} ${e.tool} → ${e.ruleId} ${e.reason}`));
			return react.default.createElement("div", {
				style: S.root,
				id: "guardrail-panel"
			}, react.default.createElement("style", { dangerouslySetInnerHTML: { __html: STYLE } }), react.default.createElement("div", { style: S.heading }, "🛡️ guardrail 工具调用守卫"), error ? react.default.createElement("div", { style: S.error }, error) : null, react.default.createElement("div", { style: S.card }, react.default.createElement("div", { style: S.sub }, "配置"), react.default.createElement("label", null, react.default.createElement("input", {
				type: "checkbox",
				checked: cfg.enabled,
				onChange: (e) => void saveConfig({
					...cfg,
					enabled: e.target.checked
				})
			}), "  启用守卫"), react.default.createElement("label", { style: S.label }, "规则文件 ", react.default.createElement("input", {
				value: cfg.rulesFile,
				readOnly: true,
				style: { width: "70%" }
			})), react.default.createElement("label", { style: S.label }, react.default.createElement("input", {
				type: "checkbox",
				checked: cfg.builtins.enabled,
				onChange: (e) => void saveConfig({
					...cfg,
					builtins: {
						...cfg.builtins,
						enabled: e.target.checked
					}
				})
			}), "  启用内置规则"), react.default.createElement("label", { style: S.label }, " 审计上限 ", react.default.createElement("input", {
				type: "number",
				value: cfg.audit.maxEntries,
				onChange: (e) => void saveConfig({
					...cfg,
					audit: {
						...cfg.audit,
						maxEntries: Number(e.target.value) || 0
					}
				}),
				style: { width: 80 }
			})), react.default.createElement("label", { style: S.label }, " 日志文件 ", react.default.createElement("input", {
				value: cfg.audit.logFile ?? "",
				onChange: (e) => void saveConfig({
					...cfg,
					audit: {
						...cfg.audit,
						logFile: e.target.value
					}
				}),
				style: { width: "70%" }
			}))), react.default.createElement("div", { style: S.sub }, "规则（内置规则可直接切换动作/启停，作为覆盖保存）"), react.default.createElement("div", null, rows), react.default.createElement("div", { style: S.card }, react.default.createElement("div", { style: S.sub }, "测试 / 添加规则"), react.default.createElement("input", {
				placeholder: "工具名，如 bash",
				value: tool,
				onChange: (e) => setTool(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("textarea", {
				placeholder: "参数 JSON，如 {\"command\":\"rm -rf /\"}",
				value: args,
				onChange: (e) => setArgs(e.target.value),
				style: {
					width: "100%",
					height: 48,
					margin: "2px 0"
				}
			}), react.default.createElement("button", {
				className: "gr-primary",
				onClick: () => void runTest()
			}, "试跑"), react.default.createElement("div", { style: S.result }, result), react.default.createElement("div", { style: {
				marginTop: 10,
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				paddingTop: 8
			} }, react.default.createElement("div", { style: S.sub }, "添加规则"), react.default.createElement("input", {
				placeholder: "id（必填）",
				value: newId,
				onChange: (e) => setNewId(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("input", {
				placeholder: "正则 pattern（必填）",
				value: newPattern,
				onChange: (e) => setNewPattern(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("select", {
				value: newAction,
				onChange: (e) => setNewAction(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}, react.default.createElement("option", { value: "deny" }, "deny"), react.default.createElement("option", { value: "warn" }, "warn")), react.default.createElement("input", {
				placeholder: "reason（支持 {tool}/{pattern}）",
				value: newReason,
				onChange: (e) => setNewReason(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("input", {
				placeholder: "tools，逗号分隔（空=全部）",
				value: newTools,
				onChange: (e) => setNewTools(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("input", {
				placeholder: "field（可选，如 command）",
				value: newField,
				onChange: (e) => setNewField(e.target.value),
				style: {
					width: "100%",
					margin: "2px 0"
				}
			}), react.default.createElement("button", {
				className: "gr-primary",
				onClick: () => void addRule()
			}, "添加规则"))), react.default.createElement("div", { style: S.sub }, "审计（最近 30 条）"), react.default.createElement("div", null, audits));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "guardrail-panel",
				order: 20,
				label: () => "guardrail"
			}, GuardrailPanel)), "guardrail: panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map