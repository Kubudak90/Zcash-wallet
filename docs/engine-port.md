# The wallet engine: NU6.3 "Ironwood" and NU7 port, design record

Celari's wasm engine is ChainSafe's WebZjs, pinned and patched, on top of the
librustzcash releases of 2026-10, which know NU6.2, NU6.3 ("Ironwood", active on
mainnet since block 3,428,143) and NU7 (activates at block 3,543,405, around
5-6 November 2026). This file is the condensed design record of that port: the
decisions and why they were taken, what is deliberately not done (and fails with
an explicit error instead), what must still be tested before real funds depend on
it, and how the build is reproduced and checked. Comments in the code, the
patches and the tests cite it as "docs/engine-port.md, Decision N".

The port was done in a separate working repository (not published) whose log
(`PORT-NOTES.md`) has the full measurements of every round; numbers below are
from there, marked MEASURED when they were measured and INFERRED when they were
not. The decision numbers are that log's, so they are not contiguous by topic.

Contents: [Layout](#layout) · [Decisions](#decisions) ·
[Review round 7](#review-round-7-core-and-engine-before-nu7) ·
[Deferred: explicit errors and known gaps](#deferred-explicit-errors-and-known-gaps) ·
[Before real funds depend on it](#before-real-funds-depend-on-it) ·
[Reproducible vendor/](#reproducible-vendor) · [Tests](#tests) ·
[Dependency audit and licences](#dependency-audit-and-licences)

## Layout

| Path | What it is |
| --- | --- |
| `scripts/build-webzjs.sh` | Checks out WebZjs `a50df944`, applies `patches/webzjs/*.patch`, copies the lockfile in, builds both wasm packages into `vendor/` with pinned tools, checks the result (Decision 19). |
| `patches/webzjs/0001`, `0002` | Celari's original patches: pass counters (`sync_progress()`), a nested-read deadlock fix, memos for `pczt_create`. |
| `patches/webzjs/0003` | Manifests, toolchain (`nightly-2026-10-28`), cargo configuration: the 2026-10 crates from crates.io instead of ChainSafe's NU6.1 fork. |
| `patches/webzjs/0004` | The Rust side: Ironwood balances and spends, NU7 rules, the sync pass, data requests, the browser fixes of rounds 3-7; native tests of the glue. |
| `engine/zcash_client_memory/` | The wallet backend, Celari source (`UPSTREAM.md`: origin, licence, what changed). |
| `engine/webzjs.Cargo.lock` | The whole lockfile of the patched WebZjs workspace; every build is `--locked`. |
| `engine/zcash_client_memory/Cargo.lock` | The backend's own lockfile for its native tests: the one above, pruned to the crate, plus its test-only dev-dependencies. |
| `scripts/webzjs-vendor.sha256` | SHA-256 of every file in `vendor/`; CI ships only a `vendor/` that matches it. |
| `scripts/test-engine-native.sh` | Runs the backend's and the glue's native test suites with the pinned versions. |
| `src/engine/webzjs*.ts` | The adapter between the app and the engine (`ZcashEngine`, `src/engine/types.ts`). |

Crate versions (crates.io, 2026-10-21): zcash_client_backend 0.25.0,
zcash_primitives 0.31.0, zcash_keys 0.17.0, zcash_protocol 0.11.0, pczt 0.10.0,
zip321 0.10.0, zcash_transparent 0.11.0, zcash_address 0.14.0, orchard 0.16,
sapling-crypto 0.9, shardtree 0.8, incrementalmerkletree 0.9, zip32 0.3;
wasm-bindgen 0.2.129.

## Decisions

### 1. Source layout: patches for WebZjs, source for the backend, a whole lockfile

WebZjs stays a pinned upstream commit plus small, reviewable patches. The wallet
backend is rewritten substantially (new trait surface, a third pool, a new note,
nullifier and tree model), so it lives as readable source in
`engine/zcash_client_memory/`, whose first commit is the verbatim import of
ChainSafe's fork at `52efe30e` (so `git log -p -- engine/` shows exactly what
Celari changed). The lockfile is a whole file, not patch hunks: the move to the
crates.io releases rewrites ~1,600 lines of it, which nobody can review as a
diff, while `--locked` proves it matches the manifests and tools read it whole
(see [Dependency audit](#dependency-audit-and-licences)). Licence files and
copyright notices stay next to the code (`engine/zcash_client_memory/LICENSE-*`,
`UPSTREAM.md`); code adapted from zcash_client_sqlite or zcash_client_backend
names its source file and version.
Not chosen: a Celari fork of WebZjs or of librustzcash on GitHub (review outside
this repository, the build depending on a third-party branch); vendoring all of
WebZjs (hides Celari's changes in ~30k unchanged lines); copying the backend into
`.webzjs/` (two copies, and `.webzjs/` is reset on every build).
Amended (Decision 19): the workspace reaches the backend through the symlink
`.webzjs/celari-engine -> ../engine` that 0003 adds.

### 2. Upstream's low-level traits; existing wallets are rebuilt and rescanned

The backend implements zcash_client_backend's `LowLevelWalletRead` /
`LowLevelWalletWrite`, and `put_blocks`, `store_decrypted_tx` and the rest
delegate to `data_api::ll::wallet`, so note accounting, Ironwood nullifier
tracking and ZIP 318 anchor retention are upstream logic, not a bespoke copy
(bespoke copies of that logic are where wallets lose funds). There is no
migration of the old serialized database: the new format has its own magic and
version, an old blob is refused as `UnsupportedFormat(None)`, and the app
rebuilds the wallet from the seed (or viewing key) and its birthday and rescans
(Decision 12).

### 3. Data model: zcash_client_sqlite's tables, in memory

The low-level traits are shaped around zcash_client_sqlite's schema and upsert
rules, which the old memory model (one spend per note, no pool on Orchard notes,
nullifiers without locators) could not express, and it had real bugs (Orchard
progress from the Sapling frontier, swapped tree sizes, `unwrap()` on decoded
data, checkpoints and `marks_removed` not saved). `src/types/` is one module per
sqlite table group, each citing the sqlite function whose rules it follows. The
save format persists the shard trees fully (cap, shards, checkpoints with
`marks_removed`, retained ZIP 318 checkpoints) and every table; decoding
re-checks the unique indices. The generated protobuf code is committed and only
regenerated on request.

### 4. wasm toolchain: shared-memory link flags; wasm-bindgen 0.2.129

Two problems only a real `wasm-pack` build and the browser showed: rustc
`nightly-2026-10-28` no longer passes wasm-ld the shared-memory flags for
`+atomics`, so the patched `.cargo/config.toml` passes them (the build script
checks that both modules create a shared memory); and tonic 0.14.8 rightly
refuses a gRPC-web response without a `grpc-status` trailer, which
tonic-web-wasm-client 0.8.0 never yields, so the engine uses
tonic-web-wasm-client 0.9.2, which needs wasm-bindgen 0.2.129.
Not chosen: pinning tonic 0.14.3 (a stream cut by a proxy would read as complete).

### 5. Subtree roots the tree already holds are not inserted again

Every sync pass sends all subtree roots; shardtree 0.8's checked `insert`
recomputes ~1,000 hashes per root once the siblings are complete, which made each
pass after the first stall ~4 minutes (MEASURED). `put_roots` skips a root whose
shard already holds exactly that value; any new, different or missing one still
goes through the checked insert, so a conflicting root is still refused (test
`subtree_roots_put_again_change_nothing`: 59 s -> 1.3 ms, identical wallet).

### 6. History knows a send's outputs only from its full transaction

Compact-block scanning records a send's change output, so after a rescan a
payment to someone else read as an internal transfer. Outputs count as known
only when the wallet holds the full transaction; otherwise a send shows as `Sent`
with its net change. A payment is never shown as an internal transfer; the full
data comes from the data requests (Decision 9).

### 7. NU7 boundary rules for building and sending

A transaction built for the old consensus branch and mined after an upgrade is
invalid, and its notes stay spent until it expires. So the engine:
- syncs before building when more than 10 blocks behind, when the wallet's and
  the network's next blocks are in different branches, or within 20 blocks of an
  activation height, and checks the branches match afterwards;
- builds and sends nothing from 10 blocks before an activation height until the
  activation block itself is mined (`UpgradePending`; 11 blocks, about 14 minutes
  before NU7);
- in `pczt_send`, reads the network tip again once it holds the database write
  lock (a pass may have held it for minutes), and refuses, before storing or
  broadcasting anything, a branch other than the next block's
  (`PcztWrongBranch`) or an expiry at or below tip + 3 (`PcztExpired`).
Not chosen: clamping the expiry to the activation height (the backend refuses a
caller-set expiry for canonical crossings). Residual risk: a transaction built
11 or more blocks before activation and not mined before it waits for its expiry.

### 8. A pass frees its blocks and has a time budget

A pass used to hold every compact block it downloaded until it ended (693 MiB of
wasm memory for a 119k-block pass, MEASURED). Now each batch is freed once
scanned, and a pass ends at a batch boundary after its time budget (300 s,
`set_sync_pass_seconds`), with everything scanned committed and
`sync_progress().ended_early` set; the app saves after every pass, so a long
restore is saved every ~5 minutes and resumes after a reload.

### 9. The wallet's transaction data requests are served after each pass

Without this a rebuilt wallet never learned the recipients, memos and fees of its
past sends. After each pass (at most 200 per pass): `Enhancement` and `GetStatus`
through lightwalletd `GetTransaction` (answer parsed and its txid checked against
the request), and the bounded spend searches of the wallet's transparent outputs
through `GetTaddressTxids`. Errors never fail the pass; they are counted.
Not served: open-ended `TransactionsInvolvingAddress` requests (checks of ZIP 320
ephemeral addresses over the whole chain): served every pass they would link all
of an account's ephemeral addresses at the server (see Deferred).
Privacy: serving these tells the server which transactions are the wallet's.
That is the standard light-client model and what restores memos and History,
and it is now the user's choice (Decision 22).

### 10. Native tests of the glue

`cargo test -p webzjs-wallet --no-default-features --lib` runs on the host over
zcash_client_backend's test framework, Celari's backend and a mock lightwalletd
that speaks real gRPC, with captured mainnet data
(`engine/zcash_client_memory/testdata/`). See [Tests](#tests).

### 11. A fresh shielded-only address; the current address stays

`get_next_shielded_address` hands out an Orchard + Sapling unified address never
handed out before (Ironwood funds arrive at the Orchard receiver; zcash_keys 0.17
has no Ironwood receiver), recorded in the wallet so funds sent to it, and to
every earlier one, are found. `get_current_address` keeps answering the full
address with its transparent receiver.

### 12. When unlock rebuilds the wallet database, and `db-legacy`

The app rebuilds from the secret only when there is no database or the engine
says it is in the old format (`OldDatabaseFormatError`); the old blob is kept as
`db-legacy`, written in the same IndexedDB transaction, until a pass that reaches
the tip is saved. Any other error (undecryptable, corrupt, a newer format, a
trap) changes nothing stored and is shown on the lock screen. The account id is
kept in the metadata, because the engine answers no summary (and so names no
account) before a pass has set the chain tip.

### 13. A fresh address per opening of Receive, asked for ahead

The engine hands out an address only between passes (it needs the write lock),
so the next one is asked for ahead of time; if none is ready within 1.5 s,
Receive shows the last one again, marked as shown before.

### 14. The fake engine models the ported engine

`src/engine/fake.ts` defaults to the ported engine's behaviour; `OLD_ENGINE`
knobs bring back the engine that stopped at NU6.1 for the network-guard tests.

### 15. A sync batch is bounded by the bytes of its compact blocks

Compact blocks of the 2022-2023 spam era are up to ~100 kB, so a 10,000-block
batch was ~1 GB and trapped the engine (MEASURED, also in the old engine). The
pass's transport counts the gRPC frames of each batch download: batches aim at
32 MiB, a download beyond 64 MiB is abandoned and continued at most half the size,
a batch is never below 20 blocks; only a full batch makes the size grow. Measured
peak in the spam era: 358 MiB of wasm memory, no trap.

### 16. The app notices a stopped engine and a stalled pass

A WebAssembly trap never settles the pending call. `CrashWatch`
(`src/engine/webzjs-crash.ts`) turns a trap into `EngineStoppedError` for every
engine call; nothing more is synced or saved and the app offers a reload. A
catch-up pass whose counters stand still for 10 minutes shows a warning.

### 17. Wallet memory: spend maps pruned at scan completion, exact export

The spend maps of the out-of-order chain-tip range are pruned by the batch that
completes the scan, and `db_to_bytes` returns a buffer of exactly the wallet's
size. Not changed: the full-state snapshot behind every write (Deferred).

### 18. The rescan after the upgrade pauses at every lock, and says so

The forced rescan runs only while the wallet is unlocked; the notice says so and
names the auto-lock time. Keeping it running under the lock screen would keep the
database key in memory while the wallet shows as locked (owner decision, not done).

### 19. vendor/ is the same on every machine with the same tools

Causes of machine dependence found and fixed (MEASURED): absolute paths in panic
locations (cargo `trim-paths`, and a check that no checkout, target, CARGO_HOME
or RUSTUP_HOME path is left in the wasm); an unpinned wasm-opt (binaryen 123,
archive and binary checksum-verified); the C compiler recorded in the wasm (CI
uses Ubuntu 24.04's clang-18 `1:18.1.3-1ubuntu1` and checks the package);
cargo deriving a path package's metadata from its absolute path when it lies
outside the workspace (the `celari-engine` symlink). See
[Reproducible vendor/](#reproducible-vendor).
Not chosen: a pinned Docker image (one more input to maintain; CI's runner is
the reference); `--remap-path-prefix` (it would replace the shared-memory flags).

### 20. Commit history

`engine/zcash_client_memory` enters with the verbatim import of the fork as its
own commit; the port follows as ordinary commits.

### 21. What is left to scan comes from the engine's scan queue

The engine scans the newest ranges first, so the fully scanned height stays at
the birthday until the last batch, across passes: counting from it made "blocks
left" jump back to the whole range at every pass (MEASURED on mainnet: 33,791 ->
48,793). The backend reports its scan queue (blocks of the suggested ranges, up to
the chain tip) after every write; `sync_progress()` gives `unscanned_blocks`,
`wallet_tip` and `unscanned_visited` without waiting for a running pass. The app
counts `max(0, unscanned_blocks - max(0, visited - unscanned_visited)) +
max(0, network tip - wallet_tip)`, which only rises with the tip
(`src/lib/syncView.ts`), and starts the next pass at once when
`ended_early` is set. On every unlock it reads the queue before the summary
shows (`enterReady`): after a reload in the middle of a restore the summary alone
would count the whole range again for up to 1.5 s (a reviewer's mainnet run:
39,175 -> 49,174 -> 29,179).

### 22. History enhancement can be turned off; status checks are spaced out

Settings > Privacy, "Fetch full transactions for History" (default on): off, the
engine serves no `Enhancement` request, so the server is not asked for the
wallet's own transactions (memos, and after a restore the recipients and fees
of past sends, are then missing; turning it on again fetches them). The status
of one pending transaction is asked at most every 5 minutes instead of every
pass. Status checks and the bounded transparent spend searches are served either
way: without them a send paid from transparent inputs only would count as
unmined, and its inputs as unspent again after its expiry. The setting is the
app's (saved with Celari's settings, not in the wallet) and is given to every
`WebWallet` the adapter opens. A restore shows the same switch on its month step
and saves the choice before the wallet is created, so a restore can begin with it
off (before, the first request went out about 10 minutes into a mainnet restore,
unless Settings was reached first).

### 23. The send refusals reach JavaScript with a stable code

`UpgradePending`, `PcztWrongBranch` and `PcztExpired` carry `code` and their
numbers on the JS `Error`, and their message starts with the code. All three are
raised before anything is stored or broadcast, so the app says "nothing was sent"
for them even when they come from `pczt_send`, after the broadcasting stage began
(`src/engine/webzjs-errors.ts`, `SpendRefusedError`). Any other error from
`pczt_send` may mean the transaction is out, and the app says so.

### 24. No tracing-web performance layer; one sync worker per page

During long restores the browser's renderer process grew to 5-9 GB, outside wasm
memory. Two leaks inherited from WebZjs: tracing-web's performance layer wrote
`performance.mark()`/`measure()` entries for every span (two per scanned block),
which the browser keeps until the page unloads; and every `sync()` started a new
Web Worker that was never closed (~2 MiB of wasm memory each). Fixed: no
performance layer; the first `sync()` starts one worker and every pass runs as a
task on it. MEASURED, engine alone: a 2025-01 restore (784k blocks) peaks at
1,034 MiB renderer memory (about 5.3 GB before, with the app), a 2026-04 restore at
821 MiB (2,149 MiB before). After a trap on the sync worker a later `sync()`
never settles; `CrashWatch` already stops the app then.

## Review round 7: core and engine before NU7

A review of the wallet core and the engine before NU7 (2026-10-30/31): six lens
reviews (vault, spend flow, platform, engine spend path, sync, build drift), 31
findings (0 critical, 8 major, 19 minor, 4 polish), and every non-polish finding
checked by an independent verifier trying to refute it; all 27 held. The findings,
their reproductions and the verifiers' fixes are in
[docs/reviews/2026-10-pre-nu7-core-review.md](reviews/2026-10-pre-nu7-core-review.md).
The verifiers marked five for NU7: PLAT-1, ES-1, ES-2, SYNC-1 and DRIFT-1; all five
are fixed. Every fix has a regression test that fails without it, except where
noted.

| Finding | Outcome |
| --- | --- |
| VAULT-1 · major: the database key in memory also opened the seed vault | Partly. A version 2 vault seals the secret under its own HKDF key, which the database key cannot stand in for, and this release reads it; it still writes version 1, because the build deployed before it reads only version 1 and a rollback in the weeks around NU7 would then refuse the password. Switch `VAULT_WRITE_VERSION` to 2 once no rollback to a build before this one is planned. |
| VAULT-2, SPEND-5, PLAT-1 · major (one root cause): pages overwrote each other's saved wallet; a stale tab replaced a stored wallet without the typed-DELETE guard | Fixed. Opening or creating a wallet takes a Web Lock held until the page unloads (`src/lib/tabLock.ts`); `saveWallet` refuses while a wallet is stored; `setDb` and `replaceDb` write only while the stored vault is this page's; `revealSecret` never shows another wallet's phrase. `tests/e2e/tabs.spec.ts`. |
| VAULT-3 · minor: a soft lock behind a hung pass kept the key in memory for ever | Fixed. The soft lock reloads after 15 minutes at the latest, or once the pass is seen to stall; a wrong password meanwhile does not undo it. `tests/e2e/hangs.spec.ts`. |
| VAULT-4 · minor: a recovery phrase copied by hand was never cleared from the clipboard | Fixed. The phrase grid is marked like the viewing key; the note shows under what was copied. |
| VAULT-5 · minor: on touch, Safari and Firefox refused the clearing retries | Fixed: retried on `pointerup` and `click` too. Not tested on a device (Chromium needs no activation). |
| VAULT-6 · minor: storage is best effort and users were not told | Fixed. `navigator.storage.persist()` is asked for on create and unlock (best effort); create, restore and the README say the browser can delete the wallet and the phrase is the only backup. |
| SPEND-1 · minor: Shield links every funded transparent address in one transaction | Copy fixed (Shield, README). Shielding one address at a time needs an engine binding: deferred, below. |
| SPEND-2, ES-3 · minor: every TEX send failed at building, and the hint said to lower the amount | Fixed in the app: the form refuses TEX addresses, also in payment links; the "lower the amount" hint is gone. Paying TEX (a ZIP 320 pair) is deferred, below. |
| SPEND-3, ES-4 · minor: the fee shown was a fixed estimate; Max failed with three or more notes | Partly. The fee and total read "at least"; when the engine refuses for funds, Send offers the amount that fits (spendable less the fee the engine asked), which the user reviews again. The exact fee before signing and an engine Max are deferred, below. |
| SPEND-4 · minor: a spend stuck behind a hung pass kept auto-lock off | Fixed in the app: a lock deferred for a spend waits at most 5 minutes (before the broadcast nothing has left the wallet; during it, the stored transaction is saved first), and no pass starts during a spend. |
| PLAT-2 · minor: the CSP was added by a string replace that could silently miss | Fixed: the build fails when the `<meta charset>` it follows is not there (`vite.security.ts`). |
| PLAT-3 · minor: no CSP header, so the engine's workers ran without one | Fixed: `public/_headers` and `vite preview` send the same policy plus `frame-ancestors 'none'`; a unit test keeps the two equal, the mainnet smoke test checks both. HSTS waits for the custom domain (every host in use is HSTS-preloaded). The deployment that holds the owner's funds (Vercel) reads `vercel.json` on its own branch, which this round did not touch: the same header there is the owner's call. |
| PLAT-4 · minor: switching servers took one click and the UI never said what a server can fake | Fixed: Settings, the "server behind" banner and the README say it; a server other than the default is saved after a second confirmation. |
| PLAT-5 · polish: vite 6.4.4 had an advisory; CI never checked npm | Fixed: vite 6.4.5; CI fails on advisories in shipped packages and warns on dev tools. |
| ES-1 · major: a stored send whose broadcast failed was never sent again; a canonical crossing stayed locked for weeks | Fixed in the app, no wasm change: after each saved pass the wallet's own unmined sends are sent again, byte for byte (`send_authorized_transactions`), at most every 5 minutes, errors logged only. "May have reached the network" now says not to pay again. The engine-side resend and a retry inside `pczt_send` are deferred, below. |
| ES-2 · major: a payment funded from Sapling was labelled Shielded | Fixed: Send labels it partly shielded and says why (`src/lib/poolCrossing.ts`, with a deliberately high fee bound); Home has a Sapling notice. Proposing Orchard-receiver payments without Sapling first is deferred, below. |
| ES-5 · polish: the Orchard notice said the change moves to Ironwood | Fixed: the change stays in Orchard and each later payment crosses again. |
| SYNC-1 · major: one inflated chain tip from a server stayed the wallet's tip for good | Fixed in the backend: a lower tip, as long as it is not below a scanned block, drops the scan queue above it, so a wallet saved with such a tip heals on its first honest pass. A deviation from zcash_client_sqlite 0.23, which has the same behaviour (`engine/zcash_client_memory/UPSTREAM.md`); worth reporting upstream. The glue companion (refuse to build on a wallet tip far above the network's) and a clock ceiling for the tip are deferred, below. |
| SYNC-2 · minor: a tip below the birthday of a wallet that scanned nothing panicked | Fixed in the backend: nothing is queued; the next pass tries again. Also in sqlite 0.23. |
| SYNC-3 · minor: "I don't know" took the first transparent transaction as the birthday | Fixed: "I don't know" scans from Sapling activation (419,200). The default server refused that search anyway (an unbounded range), so it always failed before; `detectBirthday` is gone from the app. |
| SYNC-4 · minor: a malicious server can crash the engine in a loop (unbounded streams, panicking block accessors) | Deferred, below. Needs a malicious or broken server, which can stop sync anyway; the user gets out by changing the server in Settings. |
| SYNC-5 · minor: no timeout on any engine request | App parts fixed: every pass is watched for a stall (the reload notice shows for a hung steady-state pass too), the tip read is bounded to 60 s, and SPEND-4's bounded lock deferral. A per-request idle timeout in the engine is deferred, below; a total timeout (the proposed fix) would fail large batches on slow links for ever. |
| DRIFT-1 · minor: a `vendor/` that failed the hash check, or one left from before a pull, was bundled with no message | Fixed: `vite build` fails unless `vendor/` matches `scripts/webzjs-vendor.sha256` exactly (`CELARI_UNPINNED_ENGINE=1` builds anyway, with a warning, for engine work only). |
| DRIFT-2 · minor: the clean-tree guard could be hidden by git configuration, ignore files and index flags | Fixed: three checks (status with every untracked file, untracked files with no exclude rules, skip-worktree and assume-unchanged entries); `build = false` in the backend's `Cargo.toml`. Four new guard test cases. |
| DRIFT-3 · minor: the native test script tested whatever was in `.webzjs/` and `engine/` | Fixed: both modes refuse what the build would refuse, glue mode refuses a `.webzjs/` that is not the tree the build prepared from the committed patches (a stamp), `--dirty` skips both and says so on the result line. |
| DRIFT-4 · polish: cached tool binaries were trusted by their version string | Fixed: wasm-bindgen, cargo-deny and cargo-about are reused only while their SHA-256, recorded at install time, matches. |
| DRIFT-5 · polish: the docs said CI had never reproduced the list | Fixed: CI run 40952847695 (push to main at 2acc747) built from source and matched it; see [Reproducible vendor/](#reproducible-vendor). |

An independent review of this round's diff (f3ed979..d903579) found six more
things, fixed in a follow-up commit: Shield still showed its fee as an estimate; a
successful send marked an earlier failed one as just resent; the "Send … instead"
offer appeared for an amount a payment link asked for (never offered now);
`vendorList` needed Node 20.12; the guard test could leave a line in
`info/exclude`; the restore screen's storage note named the recovery phrase for a
view-only wallet. One it raised is left as it is: a pass whose counters stand
still for 10 minutes while it serves history requests counts as stalled (the
notice, or a soft lock's reload, which gives up at most that pass's unsaved part);
catch-up passes behaved so before this round.

The engine changed in this round (SYNC-1, SYNC-2), so `vendor/` and the list did:
only `webzjs-wallet/webzjs_wallet_bg.wasm` differs (`de38cd03…`, was `c8fa1653…`).
MEASURED on x86_64 Ubuntu 24.04 with clang-18 `1:18.1.3-1ubuntu1`: the same
machine's build of the previous commit gave the committed list byte for byte (16
files) before the change, and two builds of the new engine gave the new list.
MEASURED in CI: run 41206285784 (`workflow_dispatch`, `full_rebuild`, 7eb52d8)
built from source, matched the new list, passed the production build and the
mainnet smoke test; the app job and the engine audit passed too.

## Deferred: explicit errors and known gaps

None of these is a `todo!()` on a path Celari uses; each returns an error or is
not reached.

- Importing standalone transparent keys (`transparent-key-import`): refused with
  an explicit error.
- `WalletWrite::schedule_next_check`: explicit error (needs a clock and an RNG
  the backend does not hold); only applications call it, Celari does not.
- ZIP 318 pool migration store (planned background Orchard -> Ironwood
  migrations): not ported. Ordinary sends cross from Orchard to Ironwood with
  upstream's canonical-crossing logic, which works on this backend.
- `witness_stabilized` (a sqlite optimisation): not modelled.
- No advisory input locks: one proposal is built, signed and sent at a time in
  Celari; two concurrent sends could pick the same notes, and the network would
  reject the second as a double spend (no loss).
- Open-ended ZIP 320 ephemeral-address checks are not served (Decision 9). The
  value of a ZIP 320 pair whose second transaction expired unmined, made by
  another wallet with the same seed, stays unspendable in Celari (a wallet that
  serves these checks recovers it). Celari builds no such pairs.
- After a reorg orphans a received note seen only in a compact block, it stays in
  the total (not the spendable) balance until 40 blocks past its observed height,
  as in zcash_client_sqlite.
- Memory: every transactional write snapshots the whole wallet first, doubling
  the wallet state while a batch commits; after Decision 24 the renderer still
  grows ~1.4 KiB per block downloaded (2026-04 -> tip; ~0.74 KiB over 2025-01),
  ~0.5 KiB of it wasm memory growing with the wallet state, the rest not
  attributed. A spam-era restore (2022-2023) was not run after the fix.
- Spam-era scan speed: ~1,600 Sapling outputs/s in wasm, so a 2022 birthday
  needs on the order of a day (INFERRED); the restore screen warns beyond
  ~500,000 blocks.
- `db-legacy` is kept for a manual recovery and never read back.
- The history-enhancement setting and the status-check times are not stored in
  the wallet: the first pass after a reload checks pending sends at once.
- After a trap on the sync worker a later `sync()` never settles (Decision 24).
- `async-std` (through `wasm_thread`) is unmaintained (RUSTSEC-2025-0052); see
  [Dependency audit](#dependency-audit-and-licences).
- The pinned wasm-opt is for x86_64 Linux only; elsewhere the build uses a
  version-123 wasm-opt from PATH and its output may differ from the list.
- CI does not run the native test suites (they need the full Rust build and
  ~15 minutes); run `scripts/test-engine-native.sh` before changing the engine.
- From review round 7, each for after NU7 (an engine change, a new `vendor/` and
  list, and native tests each):
  - TEX recipients are refused in the Send form: zcash_client_backend 0.25's
    `create_pczt_from_proposal` turns only single-step proposals into PCZTs, and a
    TEX payment is a ZIP 320 two-step proposal (SPEND-2).
  - The exact fee before signing (a read-only `propose_fee` binding running
    `propose_transfer` with Celari's change strategy), a check in `signProveSend`
    that the PCZT's fee is not above the confirmed one, and Max from
    `propose_send_max_transfer` (SPEND-3, ES-4).
  - Shielding one transparent address at a time (`pczt_shield` with an address,
    a `transparent_balances` binding; never a hard refusal without that path)
    (SPEND-1).
  - Resending stored unmined transactions inside `sync_pass`, and a retry of
    `SendTransaction` in `pczt_send` on transport errors (ES-1; the app resends
    meanwhile).
  - Orchard-receiver payments proposed from Ironwood and Orchard first, Sapling
    only after consent (ES-2; the app labels them meanwhile).
  - A per-request idle timeout in the transport (re-armed on every frame; not
    tonic-web-wasm-client's total timeout) (SYNC-5).
  - Bounds on server answers: more messages than blocks asked for, a height over
    `u32`, a hash that is not 32 bytes, an unbounded `GetTaddressTxids` (SYNC-4).
  - SYNC-1's glue companion (a send re-syncs when the wallet's tip is far above
    the network's) and a clock ceiling for the tip (it would refuse honest tips on
    a device whose clock is behind, and NU7 changes the block time).
  - Writing version 2 vaults (VAULT-1), once no rollback is planned.

## Before real funds depend on it

Nothing below has been done with real funds; every mainnet run used throwaway
wallets that owned nothing.

1. **Real-funds tests on mainnet, small amounts, before NU7 (3,543,405) and again
   after it**, with the production build and the seed also restored in a second
   NU6.3-aware wallet for cross-checks:
   - Receive into Ironwood (a payment to Celari's `u1…` from an NU6.3 wallet: the
     note in the shielded total with its memo after one confirmation, History pool
     `ironwood`), also into a view-only wallet.
   - Send from Ironwood: `pczt_create` -> sign (keys module) -> prove -> `pczt_send`,
     to a `u1…`, a Sapling `zs1…` and a `t1…` (a TEX address is refused by the form,
     review round 7); on an explorer the
     transaction is v6 with branch `0x37A5165B` (after NU7: `0x77190AD9`), change in
     Ironwood, fee by ZIP 317. Natively shown with fake notes only.
   - Send from Orchard (existing users' funds): pays through Ironwood with the
     ZIP 318 canonical crossing; never seen on mainnet from this engine.
   - Shield transparent funds into Ironwood; a Sapling spend; proving time and
     memory in the browser for an Ironwood + Orchard spend.
   - Around NU7: a send in the last 10 blocks before 3,543,405 and in the
     activation block is refused (`UpgradePending`, the app's pause message); a
     transaction built before activation and sent after it is refused before
     anything is stored (`PcztWrongBranch`); once the tip is at or past 3,543,405
     sends build v6 with branch `0x77190AD9`. Natively shown with real signed and
     proven PCZTs against a mock node.
   - History after restoring a wallet with past sends: each send as `Sent` with
     recipient, fee and memo once enhancement ran; `pending_data_requests()` reaches 0;
     the same with enhancement off (net values only, no memos).
   - Fresh addresses: payments to two different addresses Receive showed both arrive.
   - Upgrade of an old-build wallet with Orchard funds and past sends: balance,
     History, `db-legacy`. Also from the exact artifact users run today (main's CI
     vendor/, whose hashes are in main's `scripts/webzjs-vendor.sha256`): the
     measured upgrades started from a local build of main.
2. **Orchard -> Ironwood migration** (`zcash_pool_migration`): not ported; decide
   whether Celari offers it at all (ordinary sends already move Orchard value into
   Ironwood, publicly at the turnstile).
3. **Long restores through the app**: a 2025-01 restore through the app with
   renderer memory sampled (engine alone: 1,034 MiB peak), a spam-era one, a phone.
4. **CI**: done for the round-6 engine (run 40952847695, push to main at 2acc747)
   and for review round 7's engine (run 41206285784, `full_rebuild` on
   `claude/core-engine-review` at 7eb52d8): each built from source and matched the
   list.

## Reproducible vendor/

`scripts/webzjs-vendor.sha256` lists the SHA-256 of every file in `vendor/`,
computed as `(cd vendor && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)`.
CI builds from source on pushes to main, weekly and on request, and ships a
`vendor/` only when it matches; other runs restore a cached one and check it.

What the build pins: the WebZjs commit (fetched by full SHA), the committed
patches and `engine/` (uncommitted, untracked or index-hidden files stop the build,
whatever the git configuration and ignore files say; review round 7, DRIFT-2), the lockfile
(`--locked`), the Rust toolchain (`nightly-2026-10-28`, from the patched
`rust-toolchain.toml`), wasm-bindgen 0.2.129 (`cargo install --locked`), wasm-opt
(binaryen 123, checksums), wasm-pack 0.15.0 (CI: checksum), and the C compiler
(CI: Ubuntu 24.04 `clang-18` `1:18.1.3-1ubuntu1`, checked).

What reaches the build: wasm-pack (and with it cargo, rustc, the C compiler,
wasm-bindgen and wasm-opt) runs under `env -i` with only `PATH`, `HOME`, `USER`,
`TMPDIR`, `TERM`, `CARGO_HOME`, `RUSTUP_HOME`, the pinned `RUSTUP_TOOLCHAIN`, the
target directory and job count, proxy and certificate variables, `RUST_BACKTRACE`,
`CARGO_HTTP_*`/`CARGO_NET_*`/`CARGO_TERM_*`/`CARGO_REGISTRIES_*`,
`CC_wasm32_unknown_unknown` and the trim-paths setting; every other variable
(`CC`, `CFLAGS`, clang's `CCC_OVERRIDE_OPTIONS` or `CPATH`, ...) is dropped.

What it refuses (`scripts/test-build-webzjs-guards.sh` checks each, 27 cases): files
in `engine/` or `patches/webzjs` that are not committed (also when hidden by
`status.showUntrackedFiles`, `info/exclude` or skip-worktree); a
`RUSTUP_TOOLCHAIN` or rustup override other than the pinned toolchain; `RUSTC`,
rustc wrappers, extra rustflags, `CARGO_INCREMENTAL` and the other
`CARGO_BUILD_*`/`CARGO_TARGET_*`/`CARGO_PROFILE_*`/`CARGO_UNSTABLE_*`/`CARGO_ENV_*`
variables; the cc crate's settings for the wasm target in either spelling
(`CC_wasm32-unknown-unknown`, which cc reads before the underscore form,
`CFLAGS_wasm32_unknown_unknown`, `TARGET_CFLAGS`, `CRATE_CC_NO_DEFAULTS`, ...) and
wasm-bindgen's `WASM_BINDGEN_*`; cargo configuration from anywhere but the patched
`.webzjs/.cargo/config.toml` whatever the key (a `paths` override swaps a locked
crate's source under `--locked` without touching `Cargo.lock`), except
`build.target-dir`, `build.jobs`, `net`, `http`, `registries`, `registry`, `term`
and `alias`; and a `.cargo/` at the repository root. `WEBZJS_PREPARE_ONLY=1` (the
audit and licence scripts, CI's `engine-audit` job) stops before any tool is looked
for, wasm-pack included. At the end it compares `vendor/` with the list: on x86_64
Linux a mismatch is an error and the new list is written to
`.webzjs/target/webzjs-vendor.sha256`. MEASURED: a cold build with the `env -i`
script and the previous engine gave the committed list byte for byte.

MEASURED (2026-10-29, this repository's build of the round-7 engine): two cold
builds from a removed `.webzjs/` on x86_64 Ubuntu 24.04 with clang-18 gave
identical lists (list sha256 `8e5ffa12…`) and byte-identical trees; the wallet wasm
is `c8fa1653…`, the keys wasm `2f39260e…` (unchanged since the Integrate phase,
when two checkouts at different paths with separate RUSTUP_HOME and CARGO_HOME
also agreed). After the build script's `env -i` change and the backend change for
the scan queue observer (`queue_rescan`, `prune_scan_queue_below`), three more cold
builds gave the same list again (one on the previous engine, two on the new one):
those two methods are dead code in the wasm, and its panic locations name only
four files of the backend, none of them changed. MEASURED: CI's own build
reproduced it (run 40952847695, a push to main at 2acc747, built from source).

To change the engine: edit, commit the patch and `engine/` changes, run
`npm run build:webzjs`, review the reported list difference, commit the new list
from `.webzjs/target/webzjs-vendor.sha256`, and let CI's from-source run confirm it.

## Tests

| Suite | Command | Last result (MEASURED; 2026-10-31, review round 7, unless noted) |
| --- | --- | --- |
| Backend (`engine/zcash_client_memory`): zcash_client_backend's backend-independent suite, PCZT tests, mainnet Ironwood vectors | `scripts/test-engine-native.sh` | 206 tests: 200 passed, 0 failed, 6 ignored (the ones sqlite ignores); 513 s on 4 cores. The two new ones (SYNC-1, SYNC-2) fail on the engine before the fix. 2026-10-29: 198 passed, 0 failed, 6 ignored, confirmed by a reviewer's run on a clean checkout (the script now refuses an uncommitted engine/, DRIFT-3) |
| Glue (`webzjs-wallet`): history, NU7 rules, sync passes, data requests, against a mock lightwalletd | `bash scripts/build-webzjs.sh && scripts/test-engine-native.sh glue` | 68 passed, 0 failed; 193 s, on the round-7 engine |
| App UI tests (fake engine) | `npm run test:e2e` | 120 passed, 0 failed (5.5 min); unit tests (`npm test`): 269 passed |
| Mainnet smoke test (real engine, production build) | `npm run test:e2e:real` | passed in 12.4 s on the round-7 build, network supported, with the CSP as a header (`vite preview`) and checked as both header and `<meta>` |
| Mainnet restore from 2026-10 (production build, through a proxy; a reviewer's spec outside the repository) | - | 622 s; "blocks left" 49,148 -> 39,148 -> 29,148 -> 19,142 -> 9,142 -> 2,277 -> 1 -> Up to date, one rise of 4 blocks (the chain's growth); before Decision 21 it went back to ~48,800 at the second pass and ended at ~21,100 |
| Upgrade from main's build to this one, mainnet (outside the repository, a reviewer's script) | - | 18/18 checks: rebuilt once, `db-legacy` kept until the tip, notices (en, tr); labels 49,269 -> 39,269, soft-lock reload, 29,274 at the first paint after the unlock (before the fix for the unlock: 49,174 for a moment), 19,264 -> 9,264 -> 2,278 -> "1 block left" -> up to date at 3,534,987 at 628 s; no count rose |
| Build guards | `scripts/test-build-webzjs-guards.sh` | 27 of 27 (4 new clean-tree cases, DRIFT-2). 2026-10-29: 23 of 23 |

The backend's lockfile (`engine/zcash_client_memory/Cargo.lock`) is the shipped
lockfile pruned to the crate; the script checks that every crate the tests compile
is at the version and checksum the wasm ships, or test-only (ciborium, half).
After changing `engine/webzjs.Cargo.lock`, run `scripts/test-engine-native.sh
--refresh-lock` and commit both.

## Dependency audit and licences

`scripts/audit-engine.sh` runs cargo-deny 0.20.2 (pinned, `cargo install --locked`
from crates.io) with `scripts/deny.toml` over the patched WebZjs workspace (every
feature, every target, build and dev dependencies: 364 crates) and over the
backend's test lockfile: RustSec advisories (vulnerabilities, unmaintained, yanked),
sources and licences. CI runs it in the `engine-audit` job, which fetches the
advisory database fresh, so a new advisory fails CI by itself.

Result (MEASURED 2026-10-29, advisory database at `ee1a49a2`, 2026-10-29):
- No vulnerability advisory and no yanked crate.
- Two "unmaintained" notices, reviewed and recorded with their reasons in
  `scripts/deny.toml` (without them the check fails):
  - RUSTSEC-2025-0052, `async-std` 1.13.2, discontinued. It is in the wallet
    wasm, only through `wasm_thread` (git, `ec2/wasm_thread` at `9e432077`), which
    WebZjs uses for its Web Worker threads. No maintained release of either to
    move to; replacing `wasm_thread` is a WebZjs-level change.
  - RUSTSEC-2023-0089, `atomic-polyfill` 1.0.3, unmaintained, from `heapless` 0.7
    <- `postcard` <- `pczt` (librustzcash). Not compiled into either wasm
    (`cargo tree --target wasm32-unknown-unknown` with the build's features does
    not reach it).
- Sources: crates.io and that one git dependency, pinned by full commit.
- Licences: all permissive. 269 crates MIT OR Apache-2.0, 58 MIT, 13 Apache-2.0,
  3 CC0-1.0 (secp256k1, secp256k1-sys, bounded-vec), a few BSD-2/3-Clause, ISC,
  Zlib, Unicode-3.0, CDLA-Permissive-2.0 (webpki-roots, native only); the only
  copyleft option (LGPL-2.1-or-later in `r-efi`) is one choice of three.

Licence notices: `public/THIRD_PARTY_LICENSES.txt` holds the licence text, with its
copyright notice, of every crate compiled into the wasm (webzjs-wallet's crate set
for wasm32 with the build's features, which includes webzjs-keys'), WebZjs's own
notice and that of the C library libsecp256k1 bundled in secp256k1-sys. The app
serves it at `/THIRD_PARTY_LICENSES.txt` and links it from Settings > About.
`scripts/gen-licenses.sh` regenerates it with cargo-about 0.9.3 (pinned, offline,
from the crates' own licence files, so it depends only on the lockfile);
`--check`, also in CI's `engine-audit` job, fails when it is out of date.
