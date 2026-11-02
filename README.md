# Celari

**Wallet: https://app.celariwallet.com** · Website: https://celariwallet.com

**An open-source, privacy-first Zcash wallet that runs in your browser.**
No token, no points, no airdrop promises. Just a private ZEC wallet that works.

> *Celare* (Latin): to hide, to conceal.

> [!WARNING]
> Celari is early software and **has not had an independent security audit**. The WebZjs library it is built on also says in its README that it is not audited yet. Do not use it for amounts you cannot afford to lose.

> [!IMPORTANT]
> **This release runs on Zcash's NU6.3 (Ironwood) rules and knows NU7; real-funds tests on mainnet cover receiving, sending and shielding in Ironwood, not yet NU7 or spending from Orchard.** Mainnet moved to Ironwood on 28 July 2026 at block 3,428,143; NU7 activates at block 3,543,405 (early November 2026). Celari's engine is built with the librustzcash releases that implement these upgrades.
>
> - **What was tested, and what was not:** on mainnet, with wallets that own nothing: scanning Ironwood blocks (the engine's count of Ironwood outputs matched the server's tree sizes exactly), addresses, the network check and the upgrade from the previous release. With small real amounts, at the end of October and on 1 November 2026, between two Celari wallets (every transaction v6, mined under Ironwood rules, branch `0x37A5165B`): receiving into Ironwood, also from a wallet paying from transparent funds (block 3,537,815); a fully shielded Ironwood-to-Ironwood payment with a memo, which the other wallet showed (3,537,819, fee 0.0001 ZEC); sending from Ironwood to a transparent address with the change back in Ironwood (3,535,070 in October; 3,538,099 and 3,538,109, fee 0.00015 ZEC); shielding two transparent outputs into Ironwood in one transaction (3,538,114, fee 0.0002 ZEC). The transactions are listed in [`docs/engine-port.md`](docs/engine-port.md#before-real-funds-depend-on-it). Spending from Orchard, a Sapling recipient, and the NU7 pause and sending after NU7 were tested only locally, with fake notes, so far. Until those tests are done, use only small amounts you can afford to lose.
> - **A one-time rescan after the update:** the new engine cannot read the old wallet database. On the first unlock after the update the wallet is rebuilt from the recovery phrase (a view-only wallet from its key) and its starting block, and rescanned; the old copy is kept untouched until the rescan reaches the network tip. The rescan runs only while the wallet is unlocked, pauses at every lock and continues after the next unlock; the app says so. A month of blocks (about 48,000) took about 11 minutes when measured; a very old starting block (especially 2022-2023) can take hours and several GB of memory in the browser tab. The recipients, memos and fees of past sends are fetched again from the server during the rescan (while the switch under Settings > Privacy is on, the default).
> - **A wallet belongs to the address it was opened on:** it lives in that address's browser storage. A wallet made on an earlier address (such as the preview deployment) does not move to app.celariwallet.com by itself; restore it there from its recovery phrase.
> - **An old starting month is costly:** if the month chosen for a restore means scanning more than about 500,000 blocks (~14 months with the safety margin), the app says so at that step; it does not stop the restore. Measured with the engine alone (without the app): a restore from January 2025 (784,000 blocks) took 51 minutes and the browser process peaked at ~1 GB. A start in the 2022-2023 spam era is estimated at about a day and can need several GB; it was not measured after the memory fix. Choose the latest month you are sure of.
> - **Sending and shielding are on.** Payments received in Ironwood show in the balance; change and shielded funds go to Ironwood. An Orchard balance stays spendable: a payment from it crosses into Ironwood and the amount that crosses is visible on chain (ZIP 318); the change stays in Orchard, so each later payment from it crosses again. Celari does not offer a gradual, private Orchard-to-Ironwood migration yet. No transaction is built for the NU7 activation block or the 10 blocks before it (about 14 minutes), and one built just before is not sent under the wrong rules.
> - **A fresh address on every opening:** Receive shows a new shielded-only unified address each time (Orchard and Sapling receivers, no transparent receiver; Ironwood payments go to the Orchard receiver). Addresses shown before keep working. The transparent (`t1…`) address is shown separately and stays the same.

## Features

- **Private by default:** Receive shows a new shielded-only unified address every time it opens; if the sender's wallet supports it, the payment goes to a shielded pool, today Ironwood. Earlier addresses keep working; the transparent address is kept apart.
- **One-click shielding:** a transparent (t-address) balance is pointed out and moved into the shielded balance, in Ironwood: all of it, in one transaction, from 0.001 ZEC (the engine's minimum; the fee, at least 0.00015 ZEC, comes out of it). Below that, Balance says how much is needed. A transparent payment shows once it is in a block (the light client does not watch the mempool).
- **Network version guard:** Celari asks the server which consensus rules the network runs (lightwalletd `GetLightdInfo`) at start-up and on every sync, again before every spend and once more right before the broadcast. If the engine does not support those rules, or no answer comes, sending and shielding are switched off and the screen says why; an announced upgrade the engine will not support is shown in advance.
- **Care at an upgrade boundary:** the engine builds no transaction for an upgrade's activation block or the 10 blocks before it, and if the network has moved to new rules it refuses a transaction built under the old ones before storing anything.
- **Keys never leave the browser:** the recovery phrase and the wallet database are stored only encrypted (PBKDF2-SHA256, 600,000 rounds, and AES-256-GCM).
- **The recovery phrase is the only backup:** the browser can delete this site's data on its own: Safari after 7 days of use without opening Celari (unless it is added to the Home Screen), any browser when the disk is full or site data is cleared. Celari asks for persistent storage and the create and restore screens say so, but the only way back is the recovery phrase (for a view-only wallet, its viewing key).
- **Password on every spend:** the recovery phrase is sealed under its own key, derived from the password and not kept while the wallet is unlocked, so the key that opens the wallet's database cannot open it. It is decrypted only to sign and is not kept in memory. A wallet stored in the older format is moved to this one at its next unlock.
- **View-only mode:** follow a balance and its history with a viewing key (UFVK). It cannot spend, but anyone with the key sees all past and future transactions; share it only with someone you fully trust.
- **Smart starting block:** a restore works out where to start syncing from "when did you first use this wallet?"; if you do not know, it scans from Sapling activation in October 2018, so no payment is missed (the first scan can take a day). A device clock that is behind does not move the start later: the network's latest block sets a floor under the date.
- **Typo protection:** addresses are checked against their bech32, bech32m or base58check checksum before sending, and testnet addresses are refused. `zcash:` payment links (ZIP-321) are read, the memo they ask for is filled in, and links that do not follow ZIP-321 are refused rather than guessed at.
- **Privacy labels:** every transaction is marked "Shielded", "Partly shielded" or "Transparent · public", in words and with a shape, not only in colour. History judges only by the wallet's own outputs, as WebZjs reports them, and leaves a transaction whose pool is not known unlabelled; Send never calls a payment that crosses from an older pool shielded.
- **Encrypted memos:** a payment to a shielded address can carry a memo of up to 512 bytes, readable only by you and the recipient. Transparent and TEX addresses cannot receive one, and the form says so. TEX addresses (the deposit addresses of some exchanges) cannot be paid yet: such a payment needs two linked transactions the engine cannot build, so the form refuses the address.
- **A payment that did not reach the network is sent again:** a payment or shielding whose broadcast failed, or that the network dropped, stays saved in the wallet and is sent again, byte for byte, every few minutes until it is mined; the screen says not to pay again. If the browser could not save the wallet after a transaction, the screen says that too.
- **Honest fees:** fees follow ZIP 317 and grow with every extra note spent or created, so the screen shows them as a lower bound. When the spendable balance does not cover the real fee, Celari offers the amount that fits, which you confirm again.
- **English and Turkish** interface (English on the first visit; a chosen language stays), with Turkish decimal commas (`0,25`).
- **Use your own server:** the lightwalletd proxy can be changed in Settings.
- **Privacy in plain sight:** the eye button on Home hides balances and amounts in History (the choice stays; the amount being sent is always shown on the confirm and result screens). A copied viewing key, and a recovery phrase copied by hand, are cleared from the clipboard after 60 seconds, as far as the browser allows.
- **Auto-lock:** the wallet locks after the chosen idle time, or when its tab has been in the background for a minute; time asleep counts too. During a long restore the lock screen shows at once and the page reloads as soon as the running scan pass (one ends about every 5 minutes) is saved, or after 15 minutes at the latest if the pass hangs; the scan continues at the next unlock. A lock asked for during a spend waits for it at most 5 minutes.
- **Says when the engine stops:** if the engine crashes (running out of memory, for example), the app does not sit at "Syncing" for ever: it says so and offers a reload, which continues from the last save. A sync that stops moving for 10 minutes is flagged too.
- A step that checks the written-down recovery phrase, dark and light themes, a web app with a sidebar on wide screens and bottom tabs on phones. The fonts (Geist, Geist Mono, Fraunces) are served by the app itself; no request goes to a third party.

## How it works

```
Browser ──────────────────────────────────────────────┐
│  React interface (src/screens)                      │
│      │                                              │
│  WalletController (src/state) ── encrypted IndexedDB│
│      │                                              │
│  ZcashEngine interface (src/engine/types.ts)        │
│      │                                              │
│  WebZjs (Rust → WebAssembly, multi-threaded)        │
│    + engine/zcash_client_memory (wallet backend)    │
└──────┼──────────────────────────────────────────────┘
       │ gRPC-web
  lightwalletd proxy (default: zcash-mainnet.chainsafe.dev)
```

- The engine: ChainSafe [WebZjs](https://github.com/ChainSafe/WebZjs) at a pinned commit, Celari's patches in `patches/webzjs/`, and `engine/zcash_client_memory` (the wallet's in-memory backend, kept in this repository as readable source; its origin is in `UPSTREAM.md`), built with the October 2026 librustzcash releases (zcash_client_backend 0.25, zcash_protocol 0.11: NU6.2, NU6.3 Ironwood, NU7).
- Blocks are scanned in the browser, so the server cannot see your shielded balance or who sends you shielded payments. **It does see your IP address, your transparent addresses (asked about on every sync) and the transactions you broadcast.** Celari also asks it for its own transactions in full, for memos and, after a restore, for fees and recipients, so **the server can tell which transactions are yours.** Settings > Privacy > **Fetch full transactions for History** turns that off (on by default; the same switch is on a restore's month step, so a restore can start with it off): the server then does not learn it this way, but History shows no memos and, after a restore, past payments only by their net amount; turning it back on fetches what is missing. Either way the status of a payment you sent is asked about, at most every 5 minutes, until it confirms.
- If your transparent funds are on more than one address (after restoring a phrase from another wallet, for example), shielding moves them in one transaction, which shows publicly that those addresses belong to the same wallet.
- The server also decides which blocks Celari sees: a dishonest server can show payments that never happened, hide real ones, or not pass on what you send. Use only a server you trust (Settings saves a server other than the default only after a second confirmation that says so), and check a large incoming payment on another server or a block explorer. For more privacy, run your own proxy or use a VPN or Tor.
- Transactions are built as PCZTs: *create → sign (webzjs-keys) → prove → broadcast*.
- Recovery phrases are generated not with WebZjs's `generate_seed_phrase` but with the audited `@scure/bip39`, which uses the browser's secure random number generator; WebZjs's own documentation says its function may not use secure randomness in a browser.

## Development

Requirements: Node 22. To build WebZjs, also rustup, curl, clang 17 or later and wasm-pack. The Rust toolchain (`nightly-2026-10-28`), the wasm-bindgen CLI (the version in the lockfile, `cargo install --locked`) and, on x86_64 Linux, binaryen's wasm-opt (checksum-verified) are installed by the build script.

```bash
npm install

# UI work with the fake engine (no wasm or network needed)
npm run dev:fake

# Tests
npm run typecheck
npm test               # unit tests
npm run test:e2e       # UI flows (Playwright, fake engine)

# The real engine: build WebZjs from the pinned commit, then run it
npm run build:webzjs   # builds the wasm packages into vendor/
npm run dev            # http://localhost:5173
npm run build          # dist/ (fails unless vendor/ matches scripts/webzjs-vendor.sha256)
npm run test:e2e:real  # mainnet smoke test of the production build
```

The fake engine (`src/engine/fake.ts`) is enabled only on the dev server with `VITE_FAKE_ENGINE=1` and never reaches the production bundle.

`build:webzjs` applies the patches in `patches/webzjs/` to the pinned commit in order (scan progress counters, a lock fix, memo support, the librustzcash 2026-10 releases with Ironwood and NU7), copies `engine/webzjs.Cargo.lock` as the lockfile and builds with `--locked`. A patch that does not apply, or an uncommitted, untracked or index-hidden file under `patches/webzjs/` or `engine/`, stops the build. Details: [`patches/webzjs/README.md`](patches/webzjs/README.md).

The engine's native (non-wasm) tests, with the versions pinned in the repository (`--locked`):

```bash
scripts/test-engine-native.sh          # the wallet backend (engine/zcash_client_memory), ~15 min
scripts/test-engine-native.sh glue     # the webzjs-wallet glue, after build:webzjs
scripts/audit-engine.sh                # RustSec advisories, sources and licences (cargo-deny)
scripts/gen-licenses.sh                # regenerates public/THIRD_PARTY_LICENSES.txt
```

The engine's design decisions, what it deliberately does not do (and fails with an explicit error instead), the tests still to do with real funds, and how the build is reproduced: [`docs/engine-port.md`](docs/engine-port.md).

### CI

CI builds WebZjs from source and compares the SHA-256 of every file in `vendor/` with the list in `scripts/webzjs-vendor.sha256`. Pushes to `main`, the weekly run and runs started by hand with `full_rebuild` always build from source, fail if the list does not match, and only then save `vendor/` to the cache. Pull requests check the cached `vendor/` against the same list, and build from source if it does not match. A change to `WEBZJS_COMMIT`, to a patch under `patches/webzjs/`, to a file under `engine/` or to a tool version must update the list too: CI uploads the new one as the `webzjs-vendor-sha256` artifact (`gh run download <run-id> -n webzjs-vendor-sha256 -D scripts`). The build script trims this machine's paths from the wasm, pins its tools, runs the build with an allow-listed environment and refuses settings meant to change the output (another toolchain, rustc wrappers, extra rustflags, `CARGO_INCREMENTAL`, C compiler and wasm-bindgen settings for the wasm target, cargo configuration from outside the patched workspace). A local build on x86_64 Ubuntu 24.04 with clang-18 (`1:18.1.3-1ubuntu1`) is meant to give CI's list, but CI decides: its own build fails unless it matches. CI also audits npm advisories (failing on shipped packages, warning on dev tools) and the engine's Rust dependencies. Details are in the comments of `.github/workflows/ci.yml`.

## Deployment

The wallet runs at **https://app.celariwallet.com** and the website at **https://celariwallet.com**, on Vercel: two projects on two origins, so nothing of the website runs next to the wallet's keys. Vercel does not build the wallet. What it serves is the `celari-dist` artifact of CI's from-source build of `main`; `deploy/make-branch.sh` puts it on a temporary `deploy/app` branch only if its wasm files are in `scripts/webzjs-vendor.sha256`, and the branch is deleted after the release, so `main` is the repository's only branch. The steps are in [`deploy/README.md`](deploy/README.md); the website is in [`landing/`](landing/README.md).

To host it yourself: WebZjs uses `SharedArrayBuffer`, so the page must be **cross-origin isolated**. The server must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`public/_headers` does this for Netlify and Cloudflare Pages, together with a strict Content-Security-Policy header (for Vercel, the same is in `deploy/vercel.json`). GitHub Pages cannot send custom headers, so it does not work. The production build also carries the policy as a `<meta>` tag, and the build fails if it cannot add it.

## Roadmap

- [ ] Independent security audit
- [x] Internal pre-NU7 review of the wallet core and the engine (October 2026, round 7): vault, storage, spend flow, platform, the engine's spend path, sync and the build; all 31 findings fixed, or deferred to after NU7 with their reasons ([`docs/reviews/2026-10-pre-nu7-core-review.md`](docs/reviews/2026-10-pre-nu7-core-review.md), [`docs/engine-port.md`](docs/engine-port.md)). It does not replace an independent audit.
- [x] External review (31 October 2026, two reports): eight app findings fixed (version 2 vaults by default, wallet removal across tabs, resending shieldings, saving after a send, restore and network check with a wrong clock, pasting grouped amounts, the server address); its engine notes join the work deferred to after NU7 ([`docs/engine-port.md`](docs/engine-port.md#review-round-8-two-external-reports)). It does not replace an independent audit.
- [ ] Engine work deferred to after NU7: paying TEX addresses, the exact fee before signing, shielding one address at a time, resending inside the engine, request timeouts, bounds on server answers
- [ ] Signing with Ledger or Keystone hardware wallets (the PCZT flow is ready for it)
- [ ] Browser extension (to keep keys in a process apart from the page)
- [x] NU6.3 (Ironwood) and NU7 support (librustzcash 2026-10 releases)
- [x] Real-funds mainnet tests before NU7 (October and 1 November 2026, two Celari wallets): receiving into Ironwood, a shielded Ironwood payment with a memo, sending to a transparent address with change, shielding
- [ ] Remaining real-funds mainnet tests: spending from Orchard, a Sapling recipient, the NU7 pause and sending after NU7
- [x] Web wallet interface: a sidebar on wide screens, English as the primary language, a new logo
- [x] Move to celariwallet.com (the wallet at app.celariwallet.com, the website at celariwallet.com)
- [ ] Gradual, private migration from Orchard to Ironwood
- [x] Memos on sends
- [ ] Several accounts, ZIP-321 links with several recipients
- [ ] Testnet mode, a guide to running your own lightwalletd proxy
- [ ] Offline use (PWA)

## License

MIT or Apache-2.0, at your option. WebZjs © ChainSafe Systems, MIT / Apache-2.0. `engine/zcash_client_memory` © Electric Coin Company, MIT / Apache-2.0 (licence files and origin in its directory). The licences and copyright notices of the Rust crates compiled into the wallet engine are in `public/THIRD_PARTY_LICENSES.txt`, which the app serves at `/THIRD_PARTY_LICENSES.txt` (Settings > About).
