#!/usr/bin/env bash
# Native (host) tests of the wasm engine, with the dependency versions this
# repository pins (cargo --locked).
#
#   scripts/test-engine-native.sh [--dirty] [backend|glue] [cargo test args...] [-- libtest args]
#
# Both modes test only what ships (review round 7, DRIFT-3): they refuse uncommitted,
# untracked or index-hidden files in engine/ or patches/webzjs, as scripts/build-webzjs.sh
# does (glue compiles ../engine too, through .webzjs/celari-engine), and glue mode refuses a
# .webzjs/ that is not the tree scripts/build-webzjs.sh prepared from the committed patches
# (edited since, or prepared before the patches changed). --dirty, for work in progress,
# skips both checks and says so on the result line: those results are not what ships.
#
#   backend (default)  engine/zcash_client_memory's own suite: zcash_client_backend's
#                      backend-independent tests run against it, the PCZT tests, and the
#                      mainnet vectors in testdata/. Features: orchard transparent-inputs
#                      pczt-tests (FEATURES overrides them).
#   glue               webzjs-wallet's tests in .webzjs/crates/webzjs-wallet/src/tests/
#                      (history, NU7 boundary rules, sync passes, data requests, against a
#                      mock lightwalletd). Run scripts/build-webzjs.sh first: they test the
#                      patched sources it leaves in .webzjs/, with the lockfile it copied there.
#
# The backend crate is not a member of the WebZjs workspace, so it has a lockfile of
# its own: engine/zcash_client_memory/Cargo.lock. It is engine/webzjs.Cargo.lock
# pruned by cargo to this crate (every version kept), plus the crate's test-only
# dev-dependencies. Before testing, the script checks that every crate the tests
# compile is at the version and checksum engine/webzjs.Cargo.lock ships, or is
# test-only (not in that lockfile at all), so the suite tests what goes into the wasm.
# After a change to engine/webzjs.Cargo.lock, refresh it with `--refresh-lock`:
#
#   scripts/test-engine-native.sh --refresh-lock    # then review and commit it
#
# Both suites build into .webzjs/target/native-tests (CARGO_TARGET_DIR overrides it)
# with the toolchain patches/webzjs/0003 pins, dependencies optimised (the proofs
# take minutes per test unoptimised), no debug info for dependencies and no
# incremental cache (disk: a full backend build is a few GB). The backend suite
# takes ~15 minutes on 4 cores, the glue suite ~5.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$ROOT/engine/zcash_client_memory"
SHIPPED_LOCK="$ROOT/engine/webzjs.Cargo.lock"
channel="$(sed -n 's/^+channel *= *"\(.*\)"/\1/p' "$ROOT"/patches/webzjs/0003-*.patch)"
[ -n "$channel" ] || { echo "error: no toolchain channel in patches/webzjs/0003" >&2; exit 1; }
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/.webzjs/target/native-tests}"
export CARGO_INCREMENTAL=0
profile=(
  --config 'profile.dev.package."*".opt-level=3'
  --config 'profile.dev.package."*".debug=false'
  --config 'profile.dev.debug="line-tables-only"'
)

# name version checksum, one line per [[package]] of a Cargo.lock (no checksum: "-").
lock_entries() {
  awk '
    /^\[\[package\]\]/ { if (name != "") print name, version, (sum == "" ? "-" : sum); name = version = sum = "" }
    /^name = / { name = $3 }
    /^version = / { version = $3 }
    /^checksum = / { sum = $3 }
    END { if (name != "") print name, version, (sum == "" ? "-" : sum) }
  ' "$1" | tr -d '"' | LC_ALL=C sort -u
}

dirty_ok=0
if [ "${1:-}" = --dirty ]; then
  dirty_ok=1
  shift
fi
mode=backend
case "${1:-}" in
  backend | glue) mode="$1"; shift ;;
  --refresh-lock)
    rustup toolchain install "$channel" --profile minimal >/dev/null
    cp "$SHIPPED_LOCK" "$ENGINE/Cargo.lock"
    # Without --locked cargo prunes what this crate does not use and adds its
    # dev-dependencies; it keeps the versions the seed already holds.
    (cd "$ENGINE" && cargo "+$channel" metadata --format-version 1 >/dev/null)
    echo "engine/zcash_client_memory/Cargo.lock refreshed from engine/webzjs.Cargo.lock;" \
      "compared with the shipped lockfile:"
    LC_ALL=C comm -13 <(lock_entries "$SHIPPED_LOCK") <(lock_entries "$ENGINE/Cargo.lock") | sed 's/^/  only here: /'
    exit 0
    ;;
esac

rustup toolchain install "$channel" --profile minimal >/dev/null

# The build's own check (scripts/build-webzjs.sh): git configuration, ignore files and index
# flags hide nothing.
dirty="$(
  git -C "$ROOT" status --porcelain --untracked-files=all -- patches/webzjs engine
  git -C "$ROOT" ls-files --others --directory -- patches/webzjs engine | grep -v -E '^engine/(.+/)?target/$' || true
  git -C "$ROOT" ls-files -v -- patches/webzjs engine | grep -v '^H ' || true
)"
dirty_note=""
if [ "$dirty_ok" = 1 ]; then
  dirty_note=" (DIRTY: --dirty, uncommitted working tree, not what ships)"
elif [ -n "$dirty" ]; then
  echo "error: uncommitted, untracked or index-hidden files in patches/webzjs or engine (the build would refuse them);" \
    "commit them, or pass --dirty for work in progress:" >&2
  echo "$dirty" >&2
  exit 1
fi

if [ "$mode" = glue ]; then
  [ -f "$ROOT/.webzjs/crates/webzjs-wallet/Cargo.toml" ] || {
    echo "error: no patched WebZjs in .webzjs/; run scripts/build-webzjs.sh first" >&2
    exit 1
  }
  cmp -s "$SHIPPED_LOCK" "$ROOT/.webzjs/Cargo.lock" || {
    echo "error: .webzjs/Cargo.lock is not engine/webzjs.Cargo.lock; run scripts/build-webzjs.sh again" >&2
    exit 1
  }
  if [ "$dirty_ok" != 1 ]; then
    stamp="$(cat "$ROOT/.webzjs/target/celari-prepared" 2>/dev/null || true)"
    stamp_index="$(mktemp -u)"
    now="$(GIT_INDEX_FILE="$stamp_index" git -C "$ROOT/.webzjs" add -A &&
      echo "$(GIT_INDEX_FILE="$stamp_index" git -C "$ROOT/.webzjs" write-tree) $(git -C "$ROOT" rev-parse HEAD:patches/webzjs)")"
    rm -f "$stamp_index"
    if [ -z "$stamp" ] || [ "$stamp" != "$now" ]; then
      echo "error: .webzjs/ is not the committed patches (edited after scripts/build-webzjs.sh, or the patches" \
        "changed since); run scripts/build-webzjs.sh again, or pass --dirty for work in progress" >&2
      exit 1
    fi
  fi
  cd "$ROOT/.webzjs"
  echo "glue tests$dirty_note: $(rustc --version), target $CARGO_TARGET_DIR"
  exec cargo "+$channel" "${profile[@]}" test --locked -p webzjs-wallet --no-default-features --lib "$@"
fi

[ -f "$ENGINE/Cargo.lock" ] || {
  echo "error: engine/zcash_client_memory/Cargo.lock is missing; create it with $0 --refresh-lock" >&2
  exit 1
}
features="${FEATURES:-orchard transparent-inputs pczt-tests}"

# Every crate the tests compile, at its locked version, against the shipped lockfile.
compiled="$(cd "$ENGINE" && cargo "+$channel" tree --locked -e normal,build,dev --features "$features" \
  --prefix none --format '{p}' | awk '$2 ~ /^v/ && $3 !~ /^\(\// { sub(/^v/, "", $2); print $1, $2 }' | LC_ALL=C sort -u)"
engine_lock="$(lock_entries "$ENGINE/Cargo.lock")"
shipped="$(lock_entries "$SHIPPED_LOCK")"
drift=""
test_only=""
while read -r name version; do
  [ -n "$name" ] || continue
  ours="$(awk -v n="$name" -v v="$version" '$1 == n && $2 == v { print; exit }' <<<"$engine_lock")"
  if awk -v n="$name" '$1 == n { found = 1 } END { exit !found }' <<<"$shipped"; then
    grep -qxF -- "$ours" <<<"$shipped" || drift+="  $name $version (shipped: $(awk -v n="$name" '$1 == n { printf "%s ", $2 }' <<<"$shipped"))"$'\n'
  else
    test_only+="$name $version, "
  fi
done <<<"$compiled"
if [ -n "$drift" ]; then
  printf 'error: the tests would compile crates at versions the wasm does not ship:\n%s' "$drift" >&2
  echo "refresh engine/zcash_client_memory/Cargo.lock with $0 --refresh-lock" >&2
  exit 1
fi
echo "$(wc -l <<<"$compiled") crates compiled, all at the shipped version and checksum except the test-only ${test_only%, }"

cd "$ENGINE"
echo "backend tests$dirty_note (features: $features): $(rustc "+$channel" --version), target $CARGO_TARGET_DIR"
exec cargo "+$channel" "${profile[@]}" test --locked --lib --features "$features" "$@"
