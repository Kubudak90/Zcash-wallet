# zcash_client_memory: origin

This crate is Celari's port of the in-memory wallet backend that ChainSafe
WebZjs uses.

- Origin: https://github.com/ChainSafe/librustzcash-nu61, branch
  `feat/snap-nu61`, commit `52efe30ef39b2d1871be5673d1921ff33472b347`
  (2026-01-27), directory `zcash_client_memory/`. That is the commit ChainSafe
  WebZjs `a50df944c32243cb8da9f86e7d52cb65ac926439` has in its Cargo.lock.
  The fork is upstream librustzcash `main` of 2026-01-10 plus this crate.
- Licence: MIT OR Apache-2.0, as in the origin repository. `LICENSE-MIT` and
  `LICENSE-APACHE` here are that repository's files, unchanged.
- The first commit that adds this directory to the Celari repository is the
  verbatim import of the origin directory; every later change is an ordinary
  commit on top, so `git log -p -- engine/zcash_client_memory` is the full
  record of what Celari changed.

## What Celari changed

- Ported from the fork's librustzcash snapshot (NU6.1) to the crates.io
  releases of 2026-10-21: zcash_client_backend 0.25.0, zcash_primitives 0.31.0,
  zcash_keys 0.17.0, zcash_protocol 0.11.0, orchard 0.16, sapling-crypto 0.9,
  shardtree 0.8. These know NU6.2, NU6.3 (Ironwood) and NU7.
- The wallet implements zcash_client_backend's low-level traits
  (`data_api::ll::LowLevelWalletRead` / `LowLevelWalletWrite`) and delegates
  block and transaction storage to `data_api::ll::wallet`, so note accounting,
  nullifier tracking for all three shielded pools and anchor retention are
  upstream logic.
- A third shielded pool, Ironwood (Orchard-shaped notes in a separate pool with
  its own note commitment tree and nullifier set).
- `Cargo.toml` names its dependencies directly: the crate is a path dependency
  of the WebZjs workspace, not a member of it.
- Code adapted from upstream zcash_client_backend or zcash_client_sqlite
  (MIT OR Apache-2.0, Electric Coin Company) says so in a comment naming the
  source file and version.
