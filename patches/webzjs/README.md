# WebZjs patches

`scripts/build-webzjs.sh` checks out the pinned WebZjs commit and applies every
`*.patch` here that is committed to this repository, with `git apply`, in file
name order. A patch that does not apply stops the build, and so does any
uncommitted change in this directory or in `engine/`, so nothing unreviewed
reaches `vendor/`.

The lockfile of the patched workspace is not in the patches: it is
`engine/webzjs.Cargo.lock`, a whole file, which the build script copies into
`.webzjs/` after the patches and before cargo runs with `--locked`. A patch that
changes dependencies goes with a new `engine/webzjs.Cargo.lock` in the same
commit; `--locked` fails the build if the two disagree. (0001 still carries a
`Cargo.lock` hunk against the pinned commit's lockfile; it applies, and the copy
replaces the result.)

The wallet backend, `zcash_client_memory`, is source in `engine/zcash_client_memory`
(see its `UPSTREAM.md`); 0003 points the WebZjs workspace at it by path
(`../engine/zcash_client_memory`, with `.webzjs/` and `engine/` side by side).

Each file starts with a description; the diff follows.

| Patch | What it changes | Used by |
| --- | --- | --- |
| `0001-sync-progress.patch` | `WebWallet.sync_progress()`: lock-free block counters for the running sync pass. Also fixes a possible deadlock in `get_transaction_history` (a second `db.read()` while holding the first one). | `WebzjsEngine.syncProgress()`, the Home sync bar |
| `0002-memo.patch` | `WebWallet.pczt_create(account, to, value, memo?)`: an optional UTF-8 text memo (at most 512 bytes) for shielded recipients. A memo to a transparent or TEX address is rejected, as ZIP 321 requires. | `WebzjsEngine.send(..., memo)` |
| `0003-librustzcash-2026-10.patch` | Manifests, toolchain and cargo configuration: the librustzcash crates of 2026-10 from crates.io (NU6.2, NU6.3 Ironwood, NU7), `zcash_client_memory` from `../engine`, wasm-bindgen 0.2.129 and tonic-web-wasm-client 0.9.2, `nightly-2026-10-28`, the shared-memory linker flags. Builds only together with 0004. | the whole engine |
| `0004-ironwood-nu7.patch` | The Rust side of the same move: Ironwood balances, spends (proposal, PCZT, signing, proving with the branch's Orchard circuit, extraction), change to Ironwood from NU6.3, v6 transactions from NU7; per-pool counts in `sync_progress()`. Review round 3: NU7 boundary rules for building and sending PCZTs, history of rescanned sends, sync passes that free each batch and end after a time budget (`set_sync_pass_seconds`, `sync_progress().ended_early`), serving of the wallet's transaction data requests after each pass (`pending_data_requests()`), `AccountBalance.unshielded_pending`, `get_next_shielded_address`. Review round 5: batches bounded by the bytes of their compact blocks (`sync_progress().batch_blocks`, `batches_abandoned`, `largest_batch_bytes`), the tip read again under the database lock before a PCZT is stored, no build or send for an upgrade's activation block, `GetStatus` answers checked against the requested txid, an exactly sized `db_to_bytes`. Native tests in `crates/webzjs-wallet/src/tests/`. | `WebzjsEngine` (balances, send, shield, sync loop, Receive), the network check |

The native tests of the patched glue run on the host, with the test vectors in
`engine/zcash_client_memory/testdata/` (read through the same relative path):

```sh
cd .webzjs && cargo test -p webzjs-wallet --no-default-features --lib
```

0001 and 0002 are meant to go upstream to ChainSafe/WebZjs; drop a patch once
the pinned commit contains the change. 0003 and 0004 move WebZjs off
ChainSafe's librustzcash fork, which stops at NU6.1.

To change a patch or add one, work in the checkout the build script leaves in
`.webzjs/`:

```sh
bash scripts/build-webzjs.sh            # checkout + patches + lockfile + build
cd .webzjs
git add -A && git commit -qm base       # the current patches as one commit
# ...edit...
git diff -- . ':!Cargo.lock' > ../patches/webzjs/0005-something.patch   # then put a description on top
cp Cargo.lock ../engine/webzjs.Cargo.lock                            # if dependencies changed
```

Commit the new or edited patch (and lockfile) before the next build: the build
script refuses to run with uncommitted changes here or in `engine/`. It then
resets `.webzjs/` to the pinned commit and applies the patches again, so a patch
that only applies on top of local edits is caught there.
