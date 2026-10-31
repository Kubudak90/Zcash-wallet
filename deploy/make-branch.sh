#!/usr/bin/env bash
# Puts a production build of the wallet on the deploy branch that the Vercel
# project serving https://app.celariwallet.com deploys from (deploy/README.md).
#
#   deploy/make-branch.sh <dist-dir> <commit>
#
# <dist-dir> is CI's `celari-dist` artifact of a from-source run on main (built only
# after vendor/ matched scripts/webzjs-vendor.sha256), unpacked; <commit> is the
# commit that run built. The script refuses a dist whose wasm files are not in the
# list of <commit>, writes the branch `deploy/app` as one new commit (the dist, this
# directory's vercel.json and a README naming the source), and prints its id. It
# pushes nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$(cd "$1" && pwd)"
commit="$(git -C "$ROOT" rev-parse --verify "$2^{commit}")"
branch=deploy/app

[ -f "$dist/index.html" ] || { echo "error: $dist/index.html not found" >&2; exit 1; }
grep -q 'http-equiv="Content-Security-Policy"' "$dist/index.html" || { echo "error: no CSP in $dist/index.html" >&2; exit 1; }

# Every wasm the build ships is a byte copy of one in vendor/, so its hash is in the list.
list="$(git -C "$ROOT" show "$commit:scripts/webzjs-vendor.sha256")"
mapfile -t wasms < <(find "$dist" -name '*.wasm' -type f | LC_ALL=C sort)
[ "${#wasms[@]}" -gt 0 ] || { echo "error: no wasm in $dist" >&2; exit 1; }
for w in "${wasms[@]}"; do
  sum="$(sha256sum "$w" | cut -d' ' -f1)"
  grep -q "^$sum  \./.*\.wasm$" <<<"$list" || { echo "error: ${w#"$dist/"} ($sum) is not in scripts/webzjs-vendor.sha256 at $commit" >&2; exit 1; }
  echo "ok  ${w#"$dist/"}  $sum"
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$dist/." "$work/"
git -C "$ROOT" show "$commit:deploy/vercel.json" > "$work/vercel.json"
cat > "$work/README.md" <<MD
# deploy/app

The production build of Celari that https://app.celariwallet.com serves: CI's
\`celari-dist\` artifact of commit $commit
(https://github.com/Kubudak90/Zcash-wallet/commit/$commit), built from source and
checked against that commit's \`scripts/webzjs-vendor.sha256\`, plus
\`vercel.json\` (deploy/vercel.json at that commit). No source code here; written by
deploy/make-branch.sh.
MD

gitdir="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
index="$(mktemp -u)"
tree="$(cd "$work" && export GIT_DIR="$gitdir" GIT_WORK_TREE="$work" GIT_INDEX_FILE="$index" && git add -A -f . && git write-tree)"
rm -f "$index"
parent=()
if git -C "$ROOT" rev-parse -q --verify "refs/heads/$branch" >/dev/null; then parent=(-p "$branch"); fi
new="$(git -C "$ROOT" commit-tree "$tree" "${parent[@]}" -m "Production build of ${commit:0:7} for app.celariwallet.com")"
git -C "$ROOT" update-ref "refs/heads/$branch" "$new"
echo "$branch -> $new (tree $tree)"
