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
(see its `UPSTREAM.md`); 0003 points the WebZjs workspace at it by path, through
the symlink `celari-engine` -> `../engine` that 0003 adds (`.webzjs/` and `engine/`
side by side). The symlink keeps the crate inside the workspace's directory: cargo
derives a path package's `-C metadata` from its path relative to the workspace
root, but from its absolute path when it lies outside, and the wasm then depended
on where the checkout was.

Each file starts with a description; the diff follows.

| Patch | What it changes | Used by |
| --- | --- | --- |
| `0001-sync-progress.patch` | `WebWallet.sync_progress()`: lock-free block counters for the running sync pass. Also fixes a possible deadlock in `get_transaction_history` (a second `db.read()` while holding the first one). | `WebzjsEngine.syncProgress()`, the Home sync bar |
| `0002-memo.patch` | `WebWallet.pczt_create(account, to, value, memo?)`: an optional UTF-8 text memo (at most 512 bytes) for shielded recipients. A memo to a transparent or TEX address is rejected, as ZIP 321 requires. | `WebzjsEngine.send(..., memo)` |
| `0003-librustzcash-2026-10.patch` | Manifests, toolchain and cargo configuration: the librustzcash crates of 2026-10 from crates.io (NU6.2, NU6.3 Ironwood, NU7), `zcash_client_memory` from `../engine`, wasm-bindgen 0.2.129 and tonic-web-wasm-client 0.9.2, `nightly-2026-10-28`, the shared-memory linker flags. Builds only together with 0004. | the whole engine |
| `0004-ironwood-nu7.patch` | The Rust side of the same move: Ironwood balances, spends (proposal, PCZT, signing, proving with the branch's Orchard circuit, extraction), change to Ironwood from NU6.3, v6 transactions from NU7; per-pool counts in `sync_progress()`. Review round 3: NU7 boundary rules for building and sending PCZTs, history of rescanned sends, sync passes that free each batch and end after a time budget (`set_sync_pass_seconds`, `sync_progress().ended_early`), serving of the wallet's transaction data requests after each pass (`pending_data_requests()`), `AccountBalance.unshielded_pending`, `get_next_shielded_address`. Review round 5: batches bounded by the bytes of their compact blocks (`sync_progress().batch_blocks`, `batches_abandoned`, `largest_batch_bytes`), the tip read again under the database lock before a PCZT is stored, no build or send for an upgrade's activation block, `GetStatus` answers checked against the requested txid, an exactly sized `db_to_bytes`. Round 6: what is left to scan without waiting for a pass (`sync_progress().unscanned_blocks`, `wallet_tip`, `unscanned_visited`, from the memory backend's scan queue observer), history enhancement that can be turned off (`set_history_enhancement`) and status checks spaced out (`set_status_check_seconds`, default 300 s; `sync_progress().data_requests_skipped`), and the send refusals with a stable `code` (`UpgradePending`, `PcztWrongBranch`, `PcztExpired`; also the start of the message). Round 7: no `tracing-web` performance layer (its `performance.mark()`/`measure()` entries, several per scanned block, stayed in the browser until a reload) and one sync worker for every `sync()` call instead of a new Web Worker per call that was never closed. Native tests in `crates/webzjs-wallet/src/tests/`. | `WebzjsEngine` (balances, send, shield, sync loop, Receive), the network check |

## Native tests

The engine's own tests run on the host (not in the browser), with the dependency
versions this repository pins (`cargo --locked`), through
`scripts/test-engine-native.sh`:

```sh
scripts/test-engine-native.sh            # the backend: engine/zcash_client_memory (~15 min)
bash scripts/build-webzjs.sh && scripts/test-engine-native.sh glue   # the patched webzjs-wallet glue (~5 min)
scripts/test-engine-native.sh -- mainnet_blocks --nocapture          # a filter, as with cargo test
```

- The backend suite is the main evidence for the code that holds the funds: the memory
  backend under zcash_client_backend's backend-independent test suite (the same tests
  zcash_client_sqlite runs), the PCZT tests, and real mainnet blocks with Ironwood actions
  from `engine/zcash_client_memory/testdata/`. The crate is not a member of the WebZjs
  workspace, so it has its own lockfile, `engine/zcash_client_memory/Cargo.lock`:
  `engine/webzjs.Cargo.lock` pruned by cargo to this crate, plus its test-only
  dev-dependencies. Before testing, the script checks that every crate the tests compile
  is at the version and checksum `engine/webzjs.Cargo.lock` ships (or is test-only). After
  a change to `engine/webzjs.Cargo.lock`, `scripts/test-engine-native.sh --refresh-lock`
  regenerates it; commit the two together.
- The glue suite (`crates/webzjs-wallet/src/tests/` after 0004) tests the history, the
  NU7 boundary rules, the sync passes and the serving of data requests against a mock
  lightwalletd and the same test vectors (read as
  `../../../engine/zcash_client_memory/testdata/` from the crate).
- Both build into `.webzjs/target/native-tests` (a few GB; remove it when done).
- CI does not run them yet (see `docs/engine-port.md`, Deferred).

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
