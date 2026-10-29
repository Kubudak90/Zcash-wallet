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
# Needs: git, rustup, curl, clang >= 17 and wasm-pack. The Rust nightly
# toolchain that the patched WebZjs pins (rust-toolchain.toml) is installed
# automatically, and so are the wasm-bindgen CLI of the version Cargo.lock pins
# and, on x86_64 Linux, binaryen's wasm-opt (both into .webzjs/target/).
#
# The output is meant to be reproducible: scripts/webzjs-vendor.sha256 pins it,
# and CI checks every from-source build against that list. Everything that ends
# up in the wasm is therefore pinned: the sources (WEBZJS_COMMIT, the patches,
# engine/), the Rust toolchain, wasm-bindgen and wasm-opt (versions and
# checksums below), and the C compiler for secp256k1-sys, whose version the
# wasm records (CI uses Ubuntu 24.04's clang-18). Absolute paths of this
# machine (the checkout, CARGO_HOME, the toolchain) are trimmed, and checked
# for at the end.
#
# Environment (optional): WEBZJS_PREPARE_ONLY=1 stops once .webzjs/ holds the patched sources
# and the lockfile, before any tool is installed or looked for, wasm-pack included
# (scripts/audit-engine.sh and scripts/gen-licenses.sh use that);
# WEBZJS_OUT, the output directory (default vendor/);
# CC_wasm32_unknown_unknown, the C compiler (default clang);
# WEBZJS_RUST_TOOLCHAIN and WEBZJS_WASM_BINDGEN_VERSION, the toolchain the
# patched rust-toolchain.toml and the wasm-bindgen version the lockfile must
# name (CI sets both); CARGO_TARGET_DIR as cargo reads it;
# WEBZJS_LIST_MISMATCH=warn, see below.
#
# The build sees only an environment of its own: wasm-pack, and with it cargo,
# rustc, the C compiler, wasm-bindgen and wasm-opt, run under `env -i` with the
# variables in BUILD_ENV below (where the tools, CARGO_HOME and RUSTUP_HOME are,
# the target directory and job count, proxy and certificate settings, and cargo's
# CARGO_HTTP_/NET_/TERM_/REGISTRIES_ settings), CC_wasm32_unknown_unknown and the
# trim-paths setting this script exports. Every other variable of the caller is
# dropped (CC, CFLAGS, clang's CCC_OVERRIDE_OPTIONS or CPATH, ...).
#
# Settings someone would set to change the build stop the script instead, since
# the log would then name tools and inputs the output does not come from: a
# RUSTUP_TOOLCHAIN or rustup override other than the pinned toolchain; RUSTC, a
# rustc wrapper, extra rustflags, CARGO_INCREMENTAL and the other CARGO_BUILD_,
# CARGO_TARGET_, CARGO_PROFILE_, CARGO_UNSTABLE_ and CARGO_ENV_ variables; the cc
# crate's settings for the wasm target (CC_, CXX_, AR_, RANLIB_, CFLAGS_, CXXFLAGS_,
# ARFLAGS_ with either spelling of wasm32-unknown-unknown, other than
# CC_wasm32_unknown_unknown; TARGET_CC, TARGET_CFLAGS, ...; CRATE_CC_NO_DEFAULTS);
# wasm-bindgen's (WASM_BINDGEN_*); and cargo configuration from anywhere but the
# patched .webzjs/.cargo/config.toml (a .cargo/ in this checkout or above it, or
# CARGO_HOME's config.toml), whatever the key (`paths` overrides included), except
# the keys that only say where to build, how many jobs, how to download and how to
# print: build.target-dir, build.jobs, net.*, http.*, registries.*, registry.*,
# term.* and alias.*. scripts/test-build-webzjs-guards.sh checks each of these.
#
# At the end the script compares the output with scripts/webzjs-vendor.sha256
# the way CI does. On x86_64 Linux a mismatch is an error (exit 1, vendor/ is
# left in place; the new list is written to .webzjs/target/webzjs-vendor.sha256)
# unless WEBZJS_LIST_MISMATCH=warn, which CI sets because its own check step
# reports the difference and uploads the new list. Elsewhere it is a warning:
# other hosts do not reproduce the list (see wasm-opt below).
set -euo pipefail

WEBZJS_REPO="https://github.com/ChainSafe/WebZjs"
WEBZJS_COMMIT="a50df944c32243cb8da9f86e7d52cb65ac926439"

# binaryen's release for x86_64 Linux. The release publishes the .sha256 of the
# archive; WASM_OPT_SHA256 is the bin/wasm-opt inside it, so a cached copy is
# checked too. wasm-pack 0.15 would otherwise run whatever wasm-opt is on PATH,
# or download version_117 without a checksum.
BINARYEN_VERSION="123"
BINARYEN_SHA256="e959f2170af4c20c552e9de3a0253704d6a9d2766e8fdb88e4d6ac4bae9388fe"
WASM_OPT_SHA256="d66c6724c07334155720eb2def29c434dcaaf741ce859b4f7f389e22674f9c4a"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.webzjs"
OUT="${WEBZJS_OUT:-$ROOT/vendor}"
LOCKFILE="$ROOT/engine/webzjs.Cargo.lock"

# Environment variables meant to change what cargo, rustc, the C compiler or
# wasm-bindgen build (see the header): refused, not just dropped, so that nobody
# takes the output for a build with them. CARGO_TARGET_DIR and CARGO_BUILD_JOBS
# only change where and how fast; CC_wasm32_unknown_unknown is the C compiler
# this script documents; WASM_BINDGEN_VERSION is CI's, and wasm-bindgen does not
# read it. The names come from `env`: the cc crate also reads names that bash
# cannot hold as variables (CC_wasm32-unknown-unknown, before the underscore form).
refused=()
while IFS= read -r var; do
  case "$var" in
    CARGO_TARGET_DIR | CARGO_BUILD_TARGET_DIR | CARGO_BUILD_JOBS | CC_wasm32_unknown_unknown | WASM_BINDGEN_VERSION) ;;
    *) refused+=("$var") ;;
  esac
done < <(env | sed -n 's/^\([^=]*\)=.*/\1/p' | LC_ALL=C sort -u | grep -E \
  -e '^(RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|RUSTDOCFLAGS|CARGO_ENCODED_RUSTDOCFLAGS)$' \
  -e '^(CARGO_INCREMENTAL|CRATE_CC_NO_DEFAULTS)$' \
  -e '^CARGO_(BUILD|TARGET|PROFILE|UNSTABLE|ENV)_' \
  -e '^(CC|CXX|AR|RANLIB|CFLAGS|CXXFLAGS|ARFLAGS)_wasm32[-_]unknown[-_]unknown$' \
  -e '^TARGET_(CC|CXX|AR|RANLIB|CFLAGS|CXXFLAGS|ARFLAGS)$' \
  -e '^WASM_BINDGEN_' || true)
if [ "${#refused[@]}" -gt 0 ]; then
  echo "error: these environment variables would change the build: ${refused[*]}; unset them (the output would not be the pinned one)" >&2
  exit 1
fi

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
if [ "${WEBZJS_PREPARE_ONLY:-}" = 1 ]; then
  echo "Prepared $SRC (WebZjs, patches, lockfile); nothing built (WEBZJS_PREPARE_ONLY=1)"
  exit 0
fi

command -v wasm-pack >/dev/null || { echo "wasm-pack not found: cargo install wasm-pack" >&2; exit 1; }

# The only variables of the caller the build sees (see the header), with the values
# they have when a command starts (PATH gains the pinned tools below); every other
# variable is dropped.
BUILD_ENV=(PATH HOME USER TMPDIR TERM CARGO_HOME RUSTUP_HOME RUSTUP_TOOLCHAIN
  CARGO_TARGET_DIR CARGO_BUILD_TARGET_DIR CARGO_BUILD_JOBS
  HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy SSL_CERT_FILE SSL_CERT_DIR
  RUST_BACKTRACE CC_wasm32_unknown_unknown CARGO_PROFILE_RELEASE_TRIM_PATHS)
in_build_env() {
  local vars=() var
  for var in "${BUILD_ENV[@]}"; do
    [ -z "${!var+set}" ] || vars+=("$var=${!var}")
  done
  while IFS= read -r var; do
    vars+=("$var=${!var}")
  done < <(compgen -e | grep -E '^CARGO_(HTTP|NET|TERM|REGISTRIES)_' || true)
  env -i "${vars[@]}" "$@"
}

channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$SRC/rust-toolchain.toml")"
[ -n "$channel" ] || { echo "error: no channel in $SRC/rust-toolchain.toml" >&2; exit 1; }
if [ -n "${WEBZJS_RUST_TOOLCHAIN:-}" ] && [ "$channel" != "$WEBZJS_RUST_TOOLCHAIN" ]; then
  echo "error: the patched rust-toolchain.toml names $channel, WEBZJS_RUST_TOOLCHAIN is $WEBZJS_RUST_TOOLCHAIN" >&2
  exit 1
fi
if [ -n "${RUSTUP_TOOLCHAIN:-}" ] && [ "$RUSTUP_TOOLCHAIN" != "$channel" ] && [ "${RUSTUP_TOOLCHAIN#"$channel"-}" = "$RUSTUP_TOOLCHAIN" ]; then
  echo "error: RUSTUP_TOOLCHAIN is $RUSTUP_TOOLCHAIN, but the build is pinned to $channel; unset it" >&2
  exit 1
fi
rustup toolchain install "$channel" --profile minimal --component rust-src --target wasm32-unknown-unknown

# The toolchain rustup actually picks where wasm-pack runs cargo: RUSTUP_TOOLCHAIN
# and a `rustup override` for one of these directories win over rust-toolchain.toml.
pinned_rustc="$(in_build_env rustc "+$channel" --version)"
pinned_cargo="$(in_build_env cargo "+$channel" --version)"
for crate in webzjs-wallet webzjs-keys; do
  used_rustc="$(cd "$SRC/crates/$crate" && in_build_env rustc --version)"
  used_cargo="$(cd "$SRC/crates/$crate" && in_build_env cargo --version)"
  if [ "$used_rustc" != "$pinned_rustc" ] || [ "$used_cargo" != "$pinned_cargo" ]; then
    echo "error: in .webzjs/crates/$crate rustup picks $used_rustc / $used_cargo, not the pinned $channel ($pinned_rustc);" \
      "see \`rustup show active-toolchain\` there (a rustup override?)" >&2
    exit 1
  fi
done

# Cargo reads configuration from every .cargo/ directory above the crate and from
# CARGO_HOME. Only the patched .webzjs/.cargo/config.toml may shape the build:
# from anywhere else, any key but the few that say where, how fast, how to
# download and how to print stops it (deny by default: cargo has keys such as
# `paths` that swap a locked crate's source under --locked without touching Cargo.lock).
for crate in webzjs-wallet webzjs-keys; do
  config="$(cd "$SRC/crates/$crate" && in_build_env cargo "+$channel" -Zunstable-options config get --show-origin 2>&1)" || {
    echo "error: cargo config get failed in .webzjs/crates/$crate:" >&2
    echo "$config" >&2
    exit 1
  }
  foreign="$(awk -v ours="$SRC/.cargo/config.toml" -v ours_real="$(cd "$SRC/.cargo" && pwd -P)/config.toml" '
    /^[^ #\]]/ { key = $1 }
    / # / {
      origin = substr($0, index($0, " # ") + 3)
      if (origin == ours || origin == ours_real || origin == "--config cli option") next
      if (key == "build.target-dir" || key == "build.jobs") next
      if (key ~ /^(net|http|registries|registry|term|alias)\./) next
      print key " from " origin
    }' <<<"$config" | sort -u)"
  if [ -n "$foreign" ]; then
    echo "error: cargo configuration outside .webzjs/.cargo/config.toml would apply to the build of $crate" \
      "(from elsewhere only build.target-dir, build.jobs, net, http, registries, registry, term and alias may be set):" >&2
    echo "$foreign" >&2
    exit 1
  fi
done
# Not committed anywhere, so not something a build may depend on, even while it is empty.
if [ -e "$ROOT/.cargo" ]; then
  echo "error: $ROOT/.cargo exists; cargo reads the configuration in it during this build (move it away)" >&2
  exit 1
fi

# wasm-pack runs the wasm-bindgen CLI found on PATH if its version equals the
# wasm-bindgen crate's in Cargo.lock, and otherwise downloads one. Install
# exactly that version from crates.io (--locked: with its own published
# lockfile) and put it first on PATH, so nothing is fetched behind our back.
bindgen="$(awk '$0 == "name = \"wasm-bindgen\"" { getline; gsub(/version = |"/, ""); print; exit }' "$SRC/Cargo.lock")"
[ -n "$bindgen" ] || { echo "error: no wasm-bindgen in $LOCKFILE" >&2; exit 1; }
if [ -n "${WEBZJS_WASM_BINDGEN_VERSION:-}" ] && [ "$bindgen" != "$WEBZJS_WASM_BINDGEN_VERSION" ]; then
  echo "error: $LOCKFILE pins wasm-bindgen $bindgen, WEBZJS_WASM_BINDGEN_VERSION is $WEBZJS_WASM_BINDGEN_VERSION" >&2
  exit 1
fi
tools="$SRC/target/celari-tools/wasm-bindgen-$bindgen"
if [ "$("$tools/bin/wasm-bindgen" --version 2>/dev/null || true)" != "wasm-bindgen $bindgen" ]; then
  echo "Installing wasm-bindgen-cli $bindgen into $tools"
  (cd "$SRC" && in_build_env cargo install --quiet --locked --force --root "$tools" wasm-bindgen-cli --version "$bindgen")
fi
export PATH="$tools/bin:$PATH"
[ "$(wasm-bindgen --version)" = "wasm-bindgen $bindgen" ] || { echo "error: wasm-bindgen $bindgen not on PATH" >&2; exit 1; }

# wasm-opt: binaryen's release, checksum-verified, first on PATH (wasm-pack uses
# the one it finds there). Other hosts must bring that version themselves; their
# output is not checked against the list.
binaryen="$SRC/target/celari-tools/binaryen-$BINARYEN_VERSION"
if [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  if ! echo "$WASM_OPT_SHA256  $binaryen/bin/wasm-opt" | sha256sum --check --status --strict - 2>/dev/null; then
    echo "Installing wasm-opt (binaryen version_$BINARYEN_VERSION) into $binaryen"
    rm -rf "$binaryen"
    mkdir -p "$binaryen/bin"
    tgz="$binaryen/binaryen.tar.gz"
    curl --proto '=https' --tlsv1.2 -sSfL --retry 3 -o "$tgz" \
      "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN_VERSION/binaryen-version_$BINARYEN_VERSION-x86_64-linux.tar.gz"
    echo "$BINARYEN_SHA256  $tgz" | sha256sum --check --strict --quiet - || {
      echo "error: binaryen version_$BINARYEN_VERSION archive does not match its checksum" >&2
      exit 1
    }
    tar -xzf "$tgz" -C "$binaryen/bin" --strip-components=2 "binaryen-version_$BINARYEN_VERSION/bin/wasm-opt"
    rm -f "$tgz"
    echo "$WASM_OPT_SHA256  $binaryen/bin/wasm-opt" | sha256sum --check --strict --quiet - || {
      echo "error: wasm-opt from binaryen version_$BINARYEN_VERSION does not match its checksum" >&2
      exit 1
    }
  fi
  export PATH="$binaryen/bin:$PATH"
else
  echo "warning: not x86_64 Linux: using wasm-opt from PATH; vendor/ may differ from scripts/webzjs-vendor.sha256" >&2
fi
[ "$(wasm-opt --version 2>/dev/null)" = "wasm-opt version $BINARYEN_VERSION (version_$BINARYEN_VERSION)" ] || {
  echo "error: wasm-opt version $BINARYEN_VERSION not on PATH (found: $(wasm-opt --version 2>&1 || true))" >&2
  exit 1
}

# secp256k1-sys is C, compiled by cc-rs with this compiler; the wasm's producers
# section records its version.
export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
command -v "$CC_wasm32_unknown_unknown" >/dev/null || { echo "error: $CC_wasm32_unknown_unknown not found" >&2; exit 1; }

# Panic locations name source files. trim-paths (stable in cargo 1.101) writes
# them as /rustc/<commit>/..., /cargo/registry/..., /cargo/git/... and paths
# relative to the workspace, instead of absolute paths of this machine;
# zcash_client_memory appears as celari-engine/zcash_client_memory/..., through
# the symlink 0003 adds inside the workspace.
export CARGO_PROFILE_RELEASE_TRIM_PATHS=all

echo "Tools: $(cd "$SRC/crates/webzjs-wallet" && in_build_env rustc --version) ($(cd "$SRC/crates/webzjs-wallet" && in_build_env rustup show active-toolchain));" \
  "$(in_build_env wasm-bindgen --version); $(in_build_env wasm-opt --version); $(in_build_env wasm-pack --version);" \
  "$(in_build_env "$CC_wasm32_unknown_unknown" --version | head -n 1)"

build() {
  local crate="$1" features="$2"
  (cd "$SRC/crates/$crate" && in_build_env wasm-pack build -t web --release --scope chainsafe \
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

# No path of this machine may be left in the output: it would make vendor/
# differ between machines and checkouts.
for wasm in "$OUT/webzjs-wallet/webzjs_wallet_bg.wasm" "$OUT/webzjs-keys/webzjs_keys_bg.wasm"; do
  for dir in "$ROOT" "${CARGO_TARGET_DIR:-$SRC/target}" "${CARGO_HOME:-$HOME/.cargo}" "${RUSTUP_HOME:-$HOME/.rustup}"; do
    if grep -F -q -- "$dir/" "$wasm"; then
      echo "error: $wasm contains the path $dir/ (not reproducible elsewhere)" >&2
      exit 1
    fi
  done
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

# The output against the committed list, computed as CI computes it.
list="$ROOT/scripts/webzjs-vendor.sha256"
built="${CARGO_TARGET_DIR:-$SRC/target}/webzjs-vendor.sha256"
(cd "$OUT" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum) > "$built"
if [ ! -f "$list" ]; then
  echo "note: no scripts/webzjs-vendor.sha256 to compare with; this build's list is $built"
elif cmp -s "$list" "$built"; then
  echo "vendor/ matches scripts/webzjs-vendor.sha256 ($(wc -l < "$built") files)."
else
  diff -u "$list" "$built" | cat -v >&2 || true
  if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
    echo "warning: the output differs from scripts/webzjs-vendor.sha256, as expected off x86_64 Linux; it works, but it is not what CI ships" >&2
  elif [ "${WEBZJS_LIST_MISMATCH:-}" = warn ]; then
    echo "warning: the output differs from scripts/webzjs-vendor.sha256 (WEBZJS_LIST_MISMATCH=warn)" >&2
  else
    echo "error: the output differs from scripts/webzjs-vendor.sha256 (diff above). If you changed the build inputs on" \
      "purpose, $built is the new list (CI decides, see .github/workflows/ci.yml); otherwise this vendor/ is not the" \
      "pinned one: check clang (CI: Ubuntu 24.04's clang-18 1:18.1.3-1ubuntu1) and this machine's setup." >&2
    exit 1
  fi
fi
