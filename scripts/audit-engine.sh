#!/usr/bin/env bash
# Audits the engine's Rust dependencies with cargo-deny, against scripts/deny.toml:
#   advisories  the RustSec advisory database (vulnerabilities, unmaintained crates,
#               crates yanked from crates.io), fetched fresh on every run;
#   sources     crates.io and the one git crate the lockfile pins by commit, nothing else;
#   licenses    every crate's licence expression against the allow list.
# Checked: the patched WebZjs workspace (its lockfile is engine/webzjs.Cargo.lock; every
# feature, every target, build and dev dependencies included) and the wallet backend's own
# test lockfile (engine/zcash_client_memory/Cargo.lock).
#
# cargo-deny is pinned (CARGO_DENY_VERSION) and installed from crates.io with
# `cargo install --locked` (crates.io's checksums, its published lockfile) into
# .webzjs/target/celari-tools/. Needs git, rustup and network access; builds nothing of
# the engine. Exit status 0 only if all checks pass. Used by CI (the engine-audit job).
set -euo pipefail

CARGO_DENY_VERSION="0.20.2"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.webzjs"
CONFIG="$ROOT/scripts/deny.toml"

# The patched sources and the lockfile, exactly as a build would have them.
WEBZJS_PREPARE_ONLY=1 bash "$ROOT/scripts/build-webzjs.sh"
channel="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$SRC/rust-toolchain.toml")"
rustup toolchain install "$channel" --profile minimal

tools="$SRC/target/celari-tools/cargo-deny-$CARGO_DENY_VERSION"
if [ "$("$tools/bin/cargo-deny" --version 2>/dev/null || true)" != "cargo-deny $CARGO_DENY_VERSION" ]; then
  echo "Installing cargo-deny $CARGO_DENY_VERSION into $tools"
  build="$SRC/target/celari-tools/cargo-deny-build"
  (cd "$SRC" && CARGO_TARGET_DIR="$build" cargo "+$channel" install --quiet --locked --force --root "$tools" cargo-deny --version "$CARGO_DENY_VERSION")
  rm -rf "$build"
fi
echo "$("$tools/bin/cargo-deny" --version), advisory database: $(grep -o 'https://[^"]*' "$CONFIG" | head -n 1)"

status=0
echo "== WebZjs workspace (engine/webzjs.Cargo.lock)"
(cd "$SRC" && RUSTUP_TOOLCHAIN="$channel" "$tools/bin/cargo-deny" --locked --config "$CONFIG" \
  check advisories sources licenses) || status=1
echo "== engine/zcash_client_memory (its test lockfile)"
(cd "$ROOT/engine/zcash_client_memory" && RUSTUP_TOOLCHAIN="$channel" "$tools/bin/cargo-deny" --locked \
  --config "$CONFIG" check advisories sources licenses) || status=1
exit "$status"
