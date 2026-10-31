#!/usr/bin/env bash
# Checks that scripts/build-webzjs.sh refuses to build when something outside the
# committed inputs would change what rustc builds (uncommitted or hidden files in
# engine/ or patches/webzjs, a toolchain override, a rustc
# wrapper, extra rustflags, foreign cargo configuration, C compiler and wasm-bindgen
# settings), that nothing else from the caller's environment reaches the build, and
# that WEBZJS_PREPARE_ONLY=1 needs no wasm-pack.
#
# Usage: scripts/test-build-webzjs-guards.sh [path/to/build-webzjs.sh]
#
# Each case runs the build script with a stand-in wasm-pack first on PATH, which
# records the rustc that would build and the environment it was given, and stops
# there, so nothing is compiled and vendor/ is not touched (the output goes to a
# temporary directory). Needs what the build script needs up to its build step: git
# and network access (it fetches the pinned WebZjs commit into .webzjs/ and applies
# the patches), rustup with the pinned toolchain, and the wasm-bindgen CLI and
# wasm-opt it installs under .webzjs/target/celari-tools/ (installed on the first run).
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
# The clean-tree cases (below) add these and take them away again.
stray="$ROOT/engine/zcash_client_memory/celari-guard-test.rs"
exclude="$(git -C "$ROOT" rev-parse --path-format=absolute --git-path info/exclude)"
# Where info/exclude was before the exclude case: a copy, or "absent" (the case created it).
exclude_was=""
restore_exclude() {
  case "$exclude_was" in
    "") ;;
    absent) rm -f "$exclude" ;;
    *) mv "$exclude_was" "$exclude" ;;
  esac
  exclude_was=""
}
cleanup() {
  rm -f "$stray"
  restore_exclude
  git -C "$ROOT" update-index --no-skip-worktree engine/zcash_client_memory/UPSTREAM.md 2>/dev/null || true
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

# The stand-in writes to a fixed file (the build may hand it no variable of ours).
recorded="$tmp/stand-in.out"
mkdir -p "$tmp/bin"
cat > "$tmp/bin/wasm-pack" <<SH
#!/usr/bin/env bash
if [ "\${1:-}" = --version ]; then echo "wasm-pack 0.15.0 (stand-in)"; exit 0; fi
# Called to build: record what would have built, then stop the script here.
{
  echo "rustc: \$(rustc --version)"
  env | LC_ALL=C sort
} > "$recorded"
exit 42
SH
chmod +x "$tmp/bin/wasm-pack"

# CARGO_HOMEs with a config.toml: rustup's proxies, the registry and git checkouts are
# the real CARGO_HOME's.
real_cargo_home="${CARGO_HOME:-$HOME/.cargo}"
cargo_home() {
  local dir="$tmp/$1" entry
  mkdir -p "$dir"
  for entry in bin registry git; do
    [ ! -e "$real_cargo_home/$entry" ] || ln -s "$real_cargo_home/$entry" "$dir/$entry"
  done
  cat > "$dir/config.toml"
}
# A rustc wrapper.
cargo_home cargo-home <<'TOML'
[build]
rustc-wrapper = "/bin/false"
TOML
# A path override: cargo builds a local copy of a locked crate under --locked without
# touching Cargo.lock (cfg-if is in engine/webzjs.Cargo.lock).
mkdir -p "$tmp/cfg-if/src"
printf '[package]\nname = "cfg-if"\nversion = "1.0.5"\nedition = "2018"\n' > "$tmp/cfg-if/Cargo.toml"
: > "$tmp/cfg-if/src/lib.rs"
cargo_home cargo-home-paths <<TOML
paths = ["$tmp/cfg-if"]
TOML
# Settings that do not change what is built: these may stay.
cargo_home cargo-home-harmless <<'TOML'
[net]
retry = 3
[http]
timeout = 60
[term]
color = "never"
[alias]
xb = "build --release"
TOML

failures=0
# run <name> <expect: refuse|build> [env assignments...]
# A build also needs the pinned rustc, CC_wasm32_unknown_unknown and trim-paths in the
# stand-in's environment, and none of the variables named in $ABSENT.
ABSENT=""
run() {
  local name="$1" expect="$2"
  shift 2
  local log="$tmp/$name.log" built="$tmp/$name.built"
  rm -f "$recorded"
  env "$@" PATH="$tmp/bin:$PATH" WEBZJS_OUT="$tmp/out" bash "$SCRIPT" >"$log" 2>&1
  local rc=$?
  local got detail problem=""
  if [ -f "$recorded" ]; then got=build; mv "$recorded" "$built"; else got=refuse; fi
  if [ "$got" = build ]; then
    detail="$(head -n 1 "$built")"
    [ "$detail" = "rustc: $pinned" ] || problem="not the pinned rustc"
    grep -q '^CC_wasm32_unknown_unknown=' "$built" || problem="$problem; no CC_wasm32_unknown_unknown"
    grep -qx 'CARGO_PROFILE_RELEASE_TRIM_PATHS=all' "$built" || problem="$problem; no trim-paths"
    local var
    for var in $ABSENT; do
      ! grep -q -- "^$var=" "$built" || problem="$problem; $var reached wasm-pack"
    done
  else
    detail="$(grep -m 1 '^error:' "$log" || tail -n 1 "$log")"
  fi
  if [ "$got" = "$expect" ] && [ -z "$problem" ]; then
    echo "ok   $name: $got (exit $rc) - $detail"
  else
    echo "FAIL $name: expected $expect, got $got (exit $rc) - $detail${problem:+ (${problem#; })}"
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
run cargo-incremental refuse CARGO_INCREMENTAL=1
# cc-rs reads CC_<target> before CC_<target with underscores>, the one the script sets.
run cc-target-hyphen refuse 'CC_wasm32-unknown-unknown=gcc'
run cflags-target refuse CFLAGS_wasm32_unknown_unknown=-O0
run cflags-target-hyphen refuse 'CFLAGS_wasm32-unknown-unknown=-O0'
run target-cflags refuse TARGET_CFLAGS=-O0
run crate-cc-no-defaults refuse CRATE_CC_NO_DEFAULTS=1
run wasm-bindgen-setting refuse WASM_BINDGEN_THREADS_STACK_SIZE=65536
run cargo-home-config refuse CARGO_HOME="$tmp/cargo-home"
run cargo-home-paths refuse CARGO_HOME="$tmp/cargo-home-paths"
run cargo-home-harmless build CARGO_HOME="$tmp/cargo-home-harmless"
# What CI's job sets around the script.
run ci-environment build CC_wasm32_unknown_unknown=clang WASM_BINDGEN_VERSION=0.2.129 WASM_PACK_VERSION=0.15.0 \
  CARGO_TERM_COLOR=always
# Variables the script does not refuse (C flags for the host, clang's own settings) stay
# out of the build's environment.
ABSENT="CFLAGS CC CCC_OVERRIDE_OPTIONS CPATH SOURCE_DATE_EPOCH BINARYEN_PASS_DEBUG CELARI_GUARD_TEST"
run foreign-environment build CFLAGS=-O0 CC=gcc CCC_OVERRIDE_OPTIONS=+-O0 CPATH=/nonexistent SOURCE_DATE_EPOCH=1 \
  BINARYEN_PASS_DEBUG=1 CELARI_GUARD_TEST=1
ABSENT=""

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

# WEBZJS_PREPARE_ONLY=1 (scripts/audit-engine.sh, gen-licenses.sh, CI's engine-audit job,
# which installs no wasm-pack) prepares .webzjs/ with no wasm-pack on PATH.
mkdir -p "$tmp/no-wasm-pack"
for tool in cargo rustc rustup; do ln -s "$(command -v "$tool")" "$tmp/no-wasm-pack/$tool"; done
no_wasm_pack_path="$tmp/no-wasm-pack:/usr/bin:/bin"
if PATH="$no_wasm_pack_path" command -v wasm-pack >/dev/null; then
  echo "skip prepare-only-without-wasm-pack: wasm-pack is in /usr/bin or /bin"
else
  log="$tmp/prepare-only.log"
  env PATH="$no_wasm_pack_path" WEBZJS_PREPARE_ONLY=1 bash "$SCRIPT" >"$log" 2>&1
  rc=$?
  if [ "$rc" = 0 ] && grep -q 'nothing built (WEBZJS_PREPARE_ONLY=1)' "$log"; then
    echo "ok   prepare-only-without-wasm-pack: prepared (exit 0)"
  else
    echo "FAIL prepare-only-without-wasm-pack: exit $rc - $(tail -n 1 "$log")"
    failures=$((failures + 1))
  fi
fi

# Files outside what is committed, hidden from a plain `git status` (review round 7,
# DRIFT-2): cargo builds engine/ through a symlink to the working tree.
: > "$stray"
run untracked-engine-file refuse
run untracked-hidden-by-config refuse GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=status.showUntrackedFiles GIT_CONFIG_VALUE_0=no
mkdir -p "$(dirname "$exclude")"
if [ -f "$exclude" ]; then
  exclude_was="$tmp/info-exclude"
  cp "$exclude" "$exclude_was"
else
  exclude_was=absent
fi
echo 'engine/zcash_client_memory/celari-guard-test.rs' >> "$exclude"
run untracked-hidden-by-exclude refuse
restore_exclude
rm -f "$stray"
git -C "$ROOT" update-index --skip-worktree engine/zcash_client_memory/UPSTREAM.md
run skip-worktree refuse
git -C "$ROOT" update-index --no-skip-worktree engine/zcash_client_memory/UPSTREAM.md

run baseline-again build
echo "$failures failed"
[ "$failures" -eq 0 ]
