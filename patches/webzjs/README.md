# WebZjs patches

`scripts/build-webzjs.sh` checks out the pinned WebZjs commit and applies every
`*.patch` here that is committed to this repository, with `git apply`, in file
name order. A patch that does not apply stops the build, and so does any
uncommitted change in this directory, so nothing unreviewed reaches `vendor/`.
cargo runs with `--locked`: a patch that changes dependencies must also carry
the matching `Cargo.lock` change. Each file starts with a description; the diff
follows.

| Patch | What it changes | Used by |
| --- | --- | --- |
| `0001-sync-progress.patch` | `WebWallet.sync_progress()`: lock-free block counters for the running sync pass. Also fixes a possible deadlock in `get_transaction_history` (a second `db.read()` while holding the first one). | `WebzjsEngine.syncProgress()`, the Home sync bar |
| `0002-memo.patch` | `WebWallet.pczt_create(account, to, value, memo?)`: an optional UTF-8 text memo (at most 512 bytes) for shielded recipients. A memo to a transparent or TEX address is rejected, as ZIP 321 requires. | `WebzjsEngine.send(..., memo)` |

Both are meant to go upstream to ChainSafe/WebZjs; drop a patch once the pinned
commit contains the change.

To change a patch or add one, work in the checkout the build script leaves in
`.webzjs/`:

```sh
bash scripts/build-webzjs.sh            # checkout + patches + build
cd .webzjs
git add -A && git commit -qm base       # the current patches as one commit
# ...edit...
git diff > ../patches/webzjs/0003-something.patch   # then put a description on top
```

Commit the new or edited patch before the next build: the build script refuses
to run with uncommitted changes here. It then resets `.webzjs/` to the pinned
commit and applies the patches again, so a patch that only applies on top of
local edits is caught there.
