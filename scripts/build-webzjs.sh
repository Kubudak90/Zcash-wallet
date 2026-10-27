#!/usr/bin/env bash
# Builds the WebZjs wallet and keys wasm packages from source into vendor/.
#
# WebZjs is pinned to a reviewed commit; bump WEBZJS_COMMIT deliberately and
# re-run the full test suite (including tests/e2e-real) when you do.
#
# Needs: git, rustup, clang >= 17 and wasm-pack. The Rust nightly toolchain
# that WebZjs pins is installed automatically.
set -euo pipefail

WEBZJS_REPO="https://github.com/ChainSafe/WebZjs"
WEBZJS_COMMIT="a50df944c32243cb8da9f86e7d52cb65ac926439"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.webzjs"
OUT="$ROOT/vendor"

command -v wasm-pack >/dev/null || { echo "wasm-pack not found: cargo install wasm-pack" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$WEBZJS_REPO"
fi
git -C "$SRC" fetch -q --depth 1 origin "$WEBZJS_COMMIT"
git -C "$SRC" checkout -q --force FETCH_HEAD
echo "WebZjs at $(git -C "$SRC" rev-parse HEAD)"

channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$SRC/rust-toolchain.toml")"
rustup toolchain install "$channel" --profile minimal --component rust-src --target wasm32-unknown-unknown

build() {
  local crate="$1" features="$2"
  (cd "$SRC/crates/$crate" && wasm-pack build -t web --release --scope chainsafe \
    --out-dir "$OUT/$crate" --no-default-features --features="$features" \
    -Z build-std="panic_abort,std")
}

rm -rf "$OUT"
build webzjs-wallet "wasm wasm-parallel"
build webzjs-keys ""

# Same step as upstream's add-worker-module.sh: wasm_thread expects a bundler
# worker entry next to its snippet, which wasm-pack does not emit.
thread_dir="$(find "$OUT/webzjs-wallet/snippets" -maxdepth 1 -type d -name 'wasm_thread-*' | head -n 1)"
[ -n "$thread_dir" ] || { echo "wasm_thread snippet not found" >&2; exit 1; }
mkdir -p "$thread_dir/src/wasm32/js"
cat > "$thread_dir/src/wasm32/js/web_worker_module.bundler.js" <<'JS'
// Worker entry for wasm_thread: initialise the shared wasm module and memory
// sent by the main thread, then run the Rust closure it hands over.
import init, { wasm_thread_entry_point } from '../../../../../';

self.onmessage = (event) => {
  const [module, memory, work] = event.data;
  init(module, memory)
    .then(() => wasm_thread_entry_point(work))
    .catch((err) => {
      console.error(err);
      setTimeout(() => {
        throw err;
      });
      throw err;
    });
};
self.onunhandledrejection = (e) => {
  console.error('Worker unhandled rejection:', e.reason);
  throw e.reason;
};
JS

echo "Built: $OUT/webzjs-wallet $OUT/webzjs-keys"
