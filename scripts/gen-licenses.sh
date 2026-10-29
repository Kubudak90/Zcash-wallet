#!/usr/bin/env bash
# Writes public/THIRD_PARTY_LICENSES.txt: the licences of the Rust crates Celari's wasm engine
# is built from, with their copyright notices, as the MIT and Apache licences ask copies to
# carry. The app serves it at /THIRD_PARTY_LICENSES.txt (linked from Settings > About).
#
#   scripts/gen-licenses.sh           regenerate the file (after a change to engine/webzjs.Cargo.lock)
#   scripts/gen-licenses.sh --check   fail if the committed file is not what this generates
#
# The crate set is webzjs-wallet's for wasm32-unknown-unknown with the features
# scripts/build-webzjs.sh builds (webzjs-keys is one of its dependencies), from the patched
# WebZjs workspace and its lockfile. Licence texts come from the crates' own files in
# CARGO_HOME (cargo fetch --locked; no other network access, so the output depends only on
# the lockfile). cargo-about is pinned and installed from crates.io with --locked into
# .webzjs/target/celari-tools/; scripts/about.toml lists the accepted licences.
set -euo pipefail

CARGO_ABOUT_VERSION="0.9.3"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.webzjs"
OUT="$ROOT/public/THIRD_PARTY_LICENSES.txt"
check=false
[ "${1:-}" = --check ] && check=true

WEBZJS_PREPARE_ONLY=1 bash "$ROOT/scripts/build-webzjs.sh"
channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$SRC/rust-toolchain.toml")"
rustup toolchain install "$channel" --profile minimal

tools="$SRC/target/celari-tools/cargo-about-$CARGO_ABOUT_VERSION"
if [ "$("$tools/bin/cargo-about" --version 2>/dev/null || true)" != "cargo-about $CARGO_ABOUT_VERSION" ]; then
  echo "Installing cargo-about $CARGO_ABOUT_VERSION into $tools"
  build="$SRC/target/celari-tools/cargo-about-build"
  (cd "$SRC" && CARGO_TARGET_DIR="$build" cargo "+$channel" install --quiet --locked --force --features cli \
    --root "$tools" cargo-about --version "$CARGO_ABOUT_VERSION")
  rm -rf "$build"
fi

(cd "$SRC" && RUSTUP_TOOLCHAIN="$channel" cargo fetch --locked --quiet)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$SRC" && RUSTUP_TOOLCHAIN="$channel" "$tools/bin/cargo-about" generate --frozen --fail \
  --no-default-features --features "wasm wasm-parallel" --target wasm32-unknown-unknown \
  -m crates/webzjs-wallet/Cargo.toml -c "$ROOT/scripts/about.toml" -o "$tmp/crates.txt" "$ROOT/scripts/about.hbs") \
  2>"$tmp/about.log" || { cat "$tmp/about.log" >&2; exit 1; }

# The two notices cargo-about does not see: WebZjs's (its crates carry no licence file of
# their own; the workspace root does) and the C library bundled in secp256k1-sys.
secp="$(awk '$0 == "name = \"secp256k1-sys\"" { getline; gsub(/version = |"/, ""); print; exit }' "$SRC/Cargo.lock")"
copying="$(ls "${CARGO_HOME:-$HOME/.cargo}"/registry/src/*/"secp256k1-sys-$secp/depend/secp256k1/COPYING" | head -n 1)"
[ -f "$copying" ] || { echo "error: libsecp256k1's COPYING not found for secp256k1-sys $secp" >&2; exit 1; }
{
  cat "$tmp/crates.txt"
  echo
  echo "--------------------------------------------------------------------------------"
  echo "ChainSafe WebZjs (webzjs-common, webzjs-keys, webzjs-wallet), MIT OR Apache-2.0"
  echo
  cat "$SRC/LICENSE-MIT"
  echo
  echo "--------------------------------------------------------------------------------"
  echo "libsecp256k1, the C library bundled in secp256k1-sys $secp, MIT"
  echo
  cat "$copying"
} > "$tmp/THIRD_PARTY_LICENSES.txt"

if $check; then
  if ! cmp -s "$tmp/THIRD_PARTY_LICENSES.txt" "$OUT"; then
    diff -u "$OUT" "$tmp/THIRD_PARTY_LICENSES.txt" | head -n 40 >&2 || true
    echo "error: public/THIRD_PARTY_LICENSES.txt is not up to date; run scripts/gen-licenses.sh and commit it" >&2
    exit 1
  fi
  echo "public/THIRD_PARTY_LICENSES.txt is up to date."
else
  cp "$tmp/THIRD_PARTY_LICENSES.txt" "$OUT"
  echo "Wrote $OUT"
fi
