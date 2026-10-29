#!/usr/bin/env bash
# Builds the WebZjs wallet and keys wasm packages from source into vendor/.
#
# WebZjs is pinned to a reviewed commit, with the patches in patches/webzjs/
# applied on top; bump WEBZJS_COMMIT deliberately, refresh the patches and
# re-run the full test suite (including tests/e2e-real) when you do.
#
# The wallet backend (zcash_client_memory) is Celari source in
# engine/zcash_client_memory, which the patched WebZjs workspace uses by path
# (.webzjs/ and engine/ are siblings), and the whole Cargo.lock of the patched
# workspace is engine/webzjs.Cargo.lock, so cargo runs --locked against a
# lockfile this repository holds in full.
#
# Needs: git, rustup, clang >= 17 and wasm-pack. The Rust nightly toolchain
# that the patched WebZjs pins (rust-toolchain.toml) is installed
# automatically, and so is the wasm-bindgen CLI of the version Cargo.lock pins
# (into .webzjs/target/).
#
# Environment (optional): WEBZJS_OUT, the output directory (default vendor/);
# CARGO_TARGET_DIR as cargo reads it.
set -euo pipefail

WEBZJS_REPO="https://github.com/ChainSafe/WebZjs"
WEBZJS_COMMIT="a50df944c32243cb8da9f86e7d52cb65ac926439"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.webzjs"
OUT="${WEBZJS_OUT:-$ROOT/vendor}"
LOCKFILE="$ROOT/engine/webzjs.Cargo.lock"

command -v wasm-pack >/dev/null || { echo "wasm-pack not found: cargo install wasm-pack" >&2; exit 1; }

# Only files committed to this repository count: an uncommitted or edited patch,
# engine source or lockfile stops the build rather than slipping into vendor/.
if [ -n "$(git -C "$ROOT" status --porcelain -- patches/webzjs engine)" ]; then
  echo "error: patches/webzjs or engine has uncommitted changes:" >&2
  git -C "$ROOT" status --short -- patches/webzjs engine >&2
  exit 1
fi
[ -f "$LOCKFILE" ] || { echo "error: $LOCKFILE not found" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$WEBZJS_REPO"
fi
git -C "$SRC" fetch -q --depth 1 origin "$WEBZJS_COMMIT"
git -C "$SRC" checkout -q --force FETCH_HEAD
# Files a previous run's patches added are untracked, so checkout leaves them;
# drop them too (ignored files such as target/ stay) so the patches apply again.
git -C "$SRC" clean -q -d --force
echo "WebZjs at $(git -C "$SRC" rev-parse HEAD)"

# Celari's patches on top of the pinned commit (see patches/webzjs/README.md),
# applied in file name order. git apply changes nothing unless the whole patch
# applies, and a patch that does not apply stops the build.
mapfile -t patches < <(git -C "$ROOT" ls-files -- 'patches/webzjs/*.patch' | LC_ALL=C sort | sed "s|^|$ROOT/|")
[ "${#patches[@]}" -gt 0 ] || { echo "no patches found in $ROOT/patches/webzjs" >&2; exit 1; }
for patch in "${patches[@]}"; do
  echo "Applying ${patch#"$ROOT/"}"
  git -C "$SRC" apply "$patch" || {
    echo "error: ${patch#"$ROOT/"} does not apply to WebZjs $WEBZJS_COMMIT" >&2
    exit 1
  }
done

# The lockfile of the patched workspace, as a whole file (the patches carry no
# Cargo.lock hunk that counts). --locked below fails if it does not match the
# manifests.
cp "$LOCKFILE" "$SRC/Cargo.lock"

channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$SRC/rust-toolchain.toml")"
[ -n "$channel" ] || { echo "error: no channel in $SRC/rust-toolchain.toml" >&2; exit 1; }
rustup toolchain install "$channel" --profile minimal --component rust-src --target wasm32-unknown-unknown

# wasm-pack runs the wasm-bindgen CLI found on PATH if its version equals the
# wasm-bindgen crate's in Cargo.lock, and otherwise downloads one. Install
# exactly that version from crates.io (--locked: with its own published
# lockfile) and put it first on PATH, so nothing is fetched behind our back.
bindgen="$(awk '$0 == "name = \"wasm-bindgen\"" { getline; gsub(/version = |"/, ""); print; exit }' "$SRC/Cargo.lock")"
[ -n "$bindgen" ] || { echo "error: no wasm-bindgen in $LOCKFILE" >&2; exit 1; }
tools="$SRC/target/celari-tools/wasm-bindgen-$bindgen"
if [ "$("$tools/bin/wasm-bindgen" --version 2>/dev/null || true)" != "wasm-bindgen $bindgen" ]; then
  echo "Installing wasm-bindgen-cli $bindgen into $tools"
  (cd "$SRC" && cargo install --quiet --locked --force --root "$tools" wasm-bindgen-cli --version "$bindgen")
fi
export PATH="$tools/bin:$PATH"
[ "$(wasm-bindgen --version)" = "wasm-bindgen $bindgen" ] || { echo "error: wasm-bindgen $bindgen not on PATH" >&2; exit 1; }

build() {
  local crate="$1" features="$2"
  (cd "$SRC/crates/$crate" && wasm-pack build -t web --release --scope chainsafe \
    --out-dir "$OUT/$crate" --no-default-features --features="$features" \
    -Z build-std="panic_abort,std" --locked)
}

rm -rf "$OUT"
build webzjs-wallet "wasm wasm-parallel"
build webzjs-keys ""

# Both modules must import one shared memory, or the thread pool cannot share
# the heap. Up to the 2025-01 nightly rustc passed the linker flags for that by
# itself; the patched .cargo/config.toml now does. A module built without them
# still loads and only fails once a worker starts, so check here.
for glue in "$OUT/webzjs-wallet/webzjs_wallet.js" "$OUT/webzjs-keys/webzjs_keys.js"; do
  grep -q 'new WebAssembly.Memory({[^)]*shared:true' "$glue" || {
    echo "error: $glue does not create a shared memory (threads would not work)" >&2
    exit 1
  }
done

# Same step as upstream's add-worker-module.sh: wasm_thread expects a bundler
# worker entry next to its snippet, which wasm-pack does not emit. init() takes
# one object since wasm-bindgen 0.2.9x (the positional form still works but
# warns on every worker start).
thread_dir="$(find "$OUT/webzjs-wallet/snippets" -maxdepth 1 -type d -name 'wasm_thread-*' | head -n 1)"
[ -n "$thread_dir" ] || { echo "wasm_thread snippet not found" >&2; exit 1; }
mkdir -p "$thread_dir/src/wasm32/js"
cat > "$thread_dir/src/wasm32/js/web_worker_module.bundler.js" <<'JS'
// Worker entry for wasm_thread: initialise the shared wasm module and memory
// sent by the main thread, then run the Rust closure it hands over.
import init, { wasm_thread_entry_point } from '../../../../../';

self.onmessage = (event) => {
  const [module, memory, work] = event.data;
  init({ module_or_path: module, memory })
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

echo "Built: $OUT/webzjs-wallet $OUT/webzjs-keys (wasm-bindgen $bindgen)"
