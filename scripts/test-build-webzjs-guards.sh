#!/usr/bin/env bash
# Checks that scripts/build-webzjs.sh refuses to build when something outside the
# committed inputs would change what rustc builds (a toolchain override, a rustc
# wrapper, extra rustflags, foreign cargo configuration), and builds otherwise.
#
# Usage: scripts/test-build-webzjs-guards.sh [path/to/build-webzjs.sh]
#
# Each case runs the build script with a stand-in wasm-pack first on PATH, which
# records the rustc that would build and stops there, so nothing is compiled and
# vendor/ is not touched (the output goes to a temporary directory). Needs what
# the build script needs up to its build step: git and network access (it
# fetches the pinned WebZjs commit into .webzjs/ and applies the patches),
# rustup with the pinned toolchain, and the wasm-bindgen CLI and wasm-opt it
# installs under .webzjs/target/celari-tools/ (installed on the first run).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$(cd "$(dirname "${1:-$ROOT/scripts/build-webzjs.sh}")" && pwd)/$(basename "${1:-build-webzjs.sh}")"
case "$SCRIPT" in
  "$ROOT"/scripts/*) ;;
  *) echo "the script under test must be in $ROOT/scripts/ (it finds the checkout from its own path)" >&2; exit 2 ;;
esac
channel="$(sed -n 's/^+channel *= *"\(.*\)"/\1/p' "$ROOT"/patches/webzjs/0003-*.patch)"
[ -n "$channel" ] || { echo "no toolchain channel in patches/webzjs/0003" >&2; exit 2; }
pinned="$(rustc "+$channel" --version)"

tmp="$(mktemp -d)"
cleanup() {
  rustup override unset --path "$ROOT/.webzjs/crates/webzjs-wallet" >/dev/null 2>&1 || true
  rm -f "$ROOT/.cargo/config.toml"
  rmdir "$ROOT/.cargo" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
if [ -e "$ROOT/.cargo" ]; then
  echo "$ROOT/.cargo exists already; this test creates and removes it, so move it away first" >&2
  exit 2
fi

mkdir -p "$tmp/bin" "$tmp/cargo-home"
cat > "$tmp/bin/wasm-pack" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = --version ]; then echo "wasm-pack 0.15.0 (stand-in)"; exit 0; fi
# Called to build: record what would have built, then stop the script here.
{
  echo "rustc: $(rustc --version)"
  echo "RUSTC_WRAPPER=${RUSTC_WRAPPER-} RUSTFLAGS=${RUSTFLAGS-} CARGO_BUILD_RUSTFLAGS=${CARGO_BUILD_RUSTFLAGS-}"
} > "$WASM_PACK_STAND_IN_LOG"
exit 42
SH
chmod +x "$tmp/bin/wasm-pack"
# A CARGO_HOME whose config.toml sets a rustc wrapper; rustup's proxies, the registry
# and git checkouts are the real CARGO_HOME's.
real_cargo_home="${CARGO_HOME:-$HOME/.cargo}"
for entry in bin registry git; do
  [ ! -e "$real_cargo_home/$entry" ] || ln -s "$real_cargo_home/$entry" "$tmp/cargo-home/$entry"
done
printf '[build]\nrustc-wrapper = "/bin/false"\n' > "$tmp/cargo-home/config.toml"

failures=0
# run <name> <expect: refuse|build> [env assignments...]
run() {
  local name="$1" expect="$2"
  shift 2
  local log="$tmp/$name.log" built="$tmp/$name.built"
  rm -f "$built"
  env "$@" PATH="$tmp/bin:$PATH" WEBZJS_OUT="$tmp/out" WASM_PACK_STAND_IN_LOG="$built" \
    bash "$SCRIPT" >"$log" 2>&1
  local rc=$?
  local got
  if [ -f "$built" ]; then got=build; else got=refuse; fi
  local detail
  if [ "$got" = build ]; then
    detail="$(head -n 1 "$built")"
  else
    detail="$(grep -m 1 '^error:' "$log" || tail -n 1 "$log")"
  fi
  if [ "$got" = "$expect" ] && { [ "$got" = refuse ] || [ "$detail" = "rustc: $pinned" ]; }; then
    echo "ok   $name: $got (exit $rc) - $detail"
  else
    echo "FAIL $name: expected $expect, got $got (exit $rc) - $detail"
    failures=$((failures + 1))
  fi
}

run baseline build
run rustup-toolchain refuse RUSTUP_TOOLCHAIN=stable
run rustc-wrapper refuse RUSTC_WRAPPER=/bin/false
run rustc-workspace-wrapper refuse RUSTC_WORKSPACE_WRAPPER=/bin/false
run rustflags refuse RUSTFLAGS=-Cdebuginfo=1
run encoded-rustflags refuse CARGO_ENCODED_RUSTFLAGS=-Cdebuginfo=1
run build-rustflags refuse CARGO_BUILD_RUSTFLAGS=-Cdebuginfo=1
run cargo-home-config refuse CARGO_HOME="$tmp/cargo-home"

mkdir -p "$ROOT/.cargo"
printf '[build]\nrustflags = ["-Cdebuginfo=1"]\n' > "$ROOT/.cargo/config.toml"
run root-cargo-config refuse
rm -f "$ROOT/.cargo/config.toml"
rmdir "$ROOT/.cargo"

if [ -d "$ROOT/.webzjs/crates/webzjs-wallet" ]; then
  rustup override set stable --path "$ROOT/.webzjs/crates/webzjs-wallet" >/dev/null
  run rustup-override refuse
  rustup override unset --path "$ROOT/.webzjs/crates/webzjs-wallet" >/dev/null
fi

run baseline-again build
echo "$failures failed"
[ "$failures" -eq 0 ]
