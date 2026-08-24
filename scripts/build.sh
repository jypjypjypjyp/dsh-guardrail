#!/bin/bash
# dsh-guardrail build: junction-link deps from the DSH install, tsc host, tsdown client.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── checkout 探测：env → home 源码仓库 → 全局 npm 安装 ──
CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ] || { [ ! -d "$CHECKOUT/packages" ] && [ ! -d "$CHECKOUT/node_modules/@deepseek-ai/dsh-tools" ]; }; then
  CHECKOUT=""
  for c in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$c/packages" ]; then CHECKOUT="$c"; break; fi
  done
fi
if [ -z "$CHECKOUT" ]; then
  GLOBAL_ROOT="$(npm root -g 2>/dev/null || true)"
  if [ -n "$GLOBAL_ROOT" ] && [ -d "$GLOBAL_ROOT/@deepseek-ai/dsh" ]; then
    CHECKOUT="$GLOBAL_ROOT/@deepseek-ai/dsh"
  fi
fi
if [ -z "$CHECKOUT" ]; then
  echo "build: cannot locate a DSH install (set DSH_CHECKOUT)" >&2
  exit 1
fi
echo "=== DSH install: $CHECKOUT ==="

# ── tsc 探测：checkout → devDeps → web profile fallback ──
TSC=""
for t in "$CHECKOUT/node_modules/.bin/tsc" "$ROOT/node_modules/.bin/tsc" "$HOME/.dsh/profiles/web/node_modules/.bin/tsc"; do
  if [ -x "$t" ] || [ -f "$t.cmd" ]; then TSC="$t"; break; fi
done
if [ -z "$TSC" ]; then echo "build: tsc not found" >&2; exit 1; fi

# ── junction link 构建期类型/值依赖（scoped，来自 DSH 安装）──
link_pkg() {
  local link="node_modules/$1" target="$2"
  node -e "
    const fs = require('fs'); const path = require('path');
    const link = path.resolve(process.argv[1]); const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "$link" "$target"
}
mkdir -p node_modules/@deepseek-ai
for pkg in cordis schemastery dsh-tools dsh-llm dsh-host-webserver dsh-session dsh-scope dsh-agent dsh-client-runtime dsh-settings; do
  if [ -d "$CHECKOUT/node_modules/@deepseek-ai/$pkg" ]; then
    link_pkg "@deepseek-ai/$pkg" "$CHECKOUT/node_modules/@deepseek-ai/$pkg"
  fi
done

echo "=== Compiling host (tsc) ==="
"$TSC" -p tsconfig.json

if [ -x "$ROOT/node_modules/.bin/tsdown" ]; then
  echo "=== Compiling client (tsdown) ==="
  "$ROOT/node_modules/.bin/tsdown"
else
  echo "build: tsdown missing, skipping client bundle (pnpm add -D tsdown to enable)"
fi
echo "=== build OK ==="
