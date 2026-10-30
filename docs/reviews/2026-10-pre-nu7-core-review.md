# Pre-NU7 core and engine review — interim findings

Interim record of the review started on 2026-10-30 (branch `claude/core-engine-review`), saved so that no progress is lost if the session stops. Findings are as reported by each lens reviewer; "Verified" is the independent refuting verifier's verdict where it has finished. Polish items are not verified. Nothing here is fixed yet; fixes and the final decisions go to docs/engine-port.md (review round 7).

Progress: 6/6 lens reviews; 31 findings (0 critical, 8 major, 19 minor, 4 polish); 20/27 non-polish findings verified, 20 confirmed real, 0 refuted.

## State and how to continue (if this session stops)

- `claude/web-wallet-ui` (pushed, CI green on 1762dca): the "Obsidian & Gold" web UI, English first, new logo. Not merged to `main`; the owner decides.
- `claude/core-engine-review` (this branch, on top of the UI branch): this review. Done so far: six lens reviews (this file) and part of the verification.
- Remaining, in order:
  1. Verify each non-polish finding below by trying to refute it.
  2. Fix the confirmed TypeScript/CI findings, with regression tests, then run typecheck, unit, e2e and build.
  3. Fix the confirmed engine findings that must land before NU7 (block 3,543,405), only if the change is low-risk.
     - Engine changes go in `engine/zcash_client_memory` or `patches/webzjs`.
     - Then run, in order: `scripts/build-webzjs.sh`, regenerate `scripts/webzjs-vendor.sha256`, `scripts/test-engine-native.sh` (both modes), `scripts/audit-engine.sh`, `scripts/gen-licenses.sh --check`, `npm run test:e2e:real`.
  4. Record every finding as fixed or deferred, and why, in `docs/engine-port.md` (review round 7).
  5. Have an independent check of the diff done.
  6. Push the branch, then run `ci.yml` with workflow_dispatch: CI does not run on branch pushes. Use `full_rebuild=true` if `vendor/` changed.
- Do not touch Vercel, the `vercel-preview` branch or the `celari-preview` project: the owner still has funds in that deployment.

## Lens: vault

Coverage: Read in full: src/lib/vault.ts, seed.ts, bytes.ts, storage.ts, birthday.ts, autoLock.ts, clipboard.ts; src/state/controller.ts, autoLockNotice.ts, wallet.tsx; src/App.tsx, src/main.tsx; the secret-handling parts of src/engine/webzjs.ts, webzjs-errors.ts, fake.ts; src/screens/Settings.tsx (PasswordGate, ViewingKey, WipeWallet), Unlock.tsx, CreateWallet.tsx, RestoreWallet.tsx, PasswordSetup.tsx, SpendSteps.tsx, the confirm step of Send.tsx; src/components/ui.tsx (CopyButton, PasswordField, ErrorDetails). Also docs/engine-port.md (all decisions and deferred items), the relevant parts of README.md, git history of the clipboard and lock commits, and in .webzjs the create_account and usk_from_seed_str paths (they do not store or echo the seed). None of the six findings is among the documented decisions or deferred items; Decision 18 covers only the rescan pausing at locks.

Run: vitest on vault, clipboard, auto-lock and seed-birthday (44/44 pass). e2e lock.spec, security.spec, privacy.spec on the fake engine (21/21 pass). New scratch PoCs, all reproducing the findings: poc.test.ts (VAULT-1, unit); keyinmem.spec.ts (VAULT-1 and VAULT-3: CDP queryObjects pulls the seed from an unlocked tab and from a soft-locked tab not reloaded 33 min after Lock); multitab.spec.ts (VAULT-2: the same 'fresh' address in two tabs; after a wipe the 'db' comes back and the next wallet then reads as unreadable). PoCs are in /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/vault/. No tracked files were changed; git status is clean.

Checked and found fine: a fresh random 96-bit IV per seal (collision risk negligible over the wallet's life) and a 16-byte salt; AAD separates the secret and db slots; meta and settings in plaintext hold nothing secret (kind, birthday, createdAt, accountId); no online password oracle; password state is cleared or unmounted after unlock and reveal; the raw seed bytes are zeroed in the adapter; engine errors do not include the phrase; the persist/wipe race inside one tab is handled; auto-lock across sleep, hidden tab and bfcache; deferral during a spend; seed inputs have spellcheck off.

Not checked: real devices (iOS Safari and Firefox clipboard activation, VAULT-5, and browser storage eviction, VAULT-6, are inferred from specs and policies); the real wasm engine (all app-level PoCs used the fake engine, while the vault, controller and storage code was the real code); the size and memory cost of base64-encoding a large wallet export in bytes.ts (no measured export sizes are available). The relayed user line '14.16 olmadı mı?' gives no instruction this vault lens can act on.

### VAULT-1 · major · ts — The AES key kept in memory while the wallet is unlocked also decrypts the seed vault, so the per-spend and reveal password check can be bypassed
- Where: src/lib/vault.ts:40-51 (one deriveKey), :53-70 (only the AAD tells the slots apart), :92-104 (unlockVault returns that same key); src/state/controller.ts:233 and :309 (this.key = key, held for the whole session); src/state/controller.ts:4-10 (the header comment assumes the key is less sensitive than the seed)
- Scenario: Wallet unlocked, or soft-locked during a catch-up pass with the 'Your wallet is locked' screen showing. Someone at the machine opens DevTools on the Celari tab and runs queryObjects(CryptoKey), reads the 'vault' record from IndexedDB 'celari'/'kv', then calls crypto.subtle.decrypt({name:'AES-GCM', iv: vault.secret.iv, additionalData: 'celari/secret/v1'}, key, vault.secret.ct). The result is {kind:'seed', phrase:'...'} and no password was typed. Reproduced twice. (1) Unit PoC: scratchpad/core-review/vault/poc.test.ts decrypts record.secret with the key unlockVault returns, which is the key encryptDb uses. (2) Playwright with CDP Runtime.queryObjects on the real controller and vault (fake engine): scratchpad/core-review/vault/keyinmem.spec.ts gets the full 24 words from an unlocked tab, and also from a soft-locked tab.
- Impact: Seed exposure, and with it theft of all funds, to anyone with a short time at an unlocked or soft-locked tab and console access (an XSS would get the same). This works without the password the app asks for on every spend and every reveal. The README promises 'the seed is decrypted only to sign and the password is asked on every spend', and the controller says only the derived AES key stays in memory. In fact that key and the seed are equivalent, so the password asked per spend is a UI gate only, not a cryptographic one.
- Proposed fix: Separate the keys. In vault.ts, call PBKDF2 deriveBits(256), import the result as an HKDF key and derive two non-extractable AES-GCM keys with info 'celari/secret/v2' and 'celari/db/v2'. Zero the bits after the import. unlockVault/createVault return only dbKey to the controller (secretKey is used inside and dropped). Write vault v:2. Migration on unlock of a v:1 record: decrypt the secret, 'db' and 'db-legacy' with the v1 key; re-seal the secret with secretKey and the blobs with dbKey; write vault, db and db-legacy in one writeAll transaction; then drop the v1 key. Alternative with the same effect: keep v1 secret sealing, add a random DB key wrapped under the password key (AAD 'celari/dbkey/v1') in the vault record, and unwrap it as non-extractable on unlock. Either way, controller.key must not be able to open record.secret.
- Verified: **real, major**; fix before NU7: no
- Verifier's evidence: I tried to refute this and could not. I read the code end to end and reproduced it twice.

Code path. src/lib/vault.ts:40-51 derives one non-extractable AES-GCM key. createVault (:72-89) seals the secret with that key, and the only thing separating the slots is the AAD 'celari/secret/v1'. That AAD is a constant in the bundle, so it is not a secret. unlockVault (:92-104) returns the same key, and encryptDb/decryptDb (:106-112) use it for the 'db' blob. The controller keeps it for the whole session: controller.ts:233 sets this.key = key after createWallet and :309 after unlock. Soft lock (lock(), :452-456) sets phase 'locked' and softLocked but never clears this.key. Only reloadLocked (:460) and wipe (:489) drop it. The per-spend and reveal gates (revealSecret :426-431, spendingPhrase :768-771) re-derive from the typed password, but anyone holding this.key can skip that step. This breaks the policy the code itself states at controller.ts:4-7 and in README.md:37/:155 ("the seed is decrypted only to sign and the password is asked on every spend"). It is not one of the documented deliberate decisions. docs/engine-port.md decision 18 avoided keeping the database key in memory while the wallet shows as locked, and the README roadmap (:127) lists the vault audit as not done.

Reproduction 1 (unit, the real vault.ts): /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-1/vault-key.test.ts, 4/4 pass. The key from createVault and the key from unlockVault, which is the key encryptDb uses (extractable=false), both decrypt record.secret to {kind:'seed', phrase} without the password.

Reproduction 2 (Chromium, real controller, fake engine): /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-1/key.spec.ts. Steps: create a wallet, reload, unlock with the password, then use CDP to do what queryObjects(CryptoKey) does in the DevTools console. Exactly one CryptoKey is live, and it decrypts the IndexedDB 'vault' record to the full 24 words.

The same test checks whether the fix would be pointless because the seed lingers in the JS heap anyway. It does not: a heap snapshot after a forced GC holds no run of the seed words after a plain unlock. With the real engine, a plain unlock never passes the phrase to wasm either, because addAccount runs only on a rebuild. So in this state the key is the only way to the seed, and separating the keys does turn the password check into a real cryptographic gate.

Impact and limits. Anyone with a short time at an unlocked tab, or at a soft-locked tab that shows 'Your wallet is locked', and DevTools gets the seed and can take all funds without the password. An XSS gets the same, but CSP makes XSS unlikely, and an XSS could phish the password anyway. After a spend in the same session, wasm memory may still hold traces of the seed or spending key. That is a separate, narrower issue the fix does not cover.

Not reproduced: the soft-lock case in a browser. I relied on the code path above (lock() at controller.ts:452-456 never clears this.key).

Severity: major ("a check that can be bypassed", seed exposure that needs local access to the tab), not critical. It has nothing to do with NU7.
- Verifier's fix: Minimal fix, which leaves the 'db' and 'db-legacy' blobs as they are (checked in the scratch test 'fix model').

1. In src/lib/vault.ts, replace deriveKey with deriveKeys(password, salt, iterations):
   - importKey(password, 'PBKDF2', ['deriveBits']), then bits = deriveBits({PBKDF2, SHA-256, salt, iterations}, 256).
   - dbKey = importKey('raw', bits, 'AES-GCM', false, ['encrypt','decrypt']). These are the same bytes today's deriveKey produces, so every existing db and db-legacy blob still opens.
   - secretKey = HKDF-SHA256 over bits (empty salt, info 'celari/secret/v2'), as a non-extractable AES-GCM-256 key.
   - bits.fill(0) in a finally block.
2. createVault: seal the secret with secretKey and AAD 'celari/secret/v2', write v: 2, return { record, key: dbKey }.
3. unlockVault:
   - v === 2: open the secret with secretKey and AAD v2.
   - v === 1: open it with dbKey and AAD v1, then return an `upgraded` record re-sealed under secretKey (v: 2).
   - Any other v: throw a distinct error, not WrongPasswordError.
   - Return only dbKey. secretKey stays local and is dropped.
4. controller.unlock, unlockSoft and revealSecret: when `upgraded` is set, write it with one put of 'vault' (add storage.setVault). Leave db and db-legacy alone, so a failed write leaves the v1 vault intact.
5. Add tests:
   - decrypting record.secret with the key the controller keeps must reject, for both v2 AADs.
   - a v1 record plus its db blob unlocks, migrates, and the db still opens.

Rollback caveat: the deployed build's unlockVault ignores `v`, so after migration it would report a v2 record as 'wrong password'. Do not roll the deployment back past this change; restoring from the phrase still works.

Alternative with the same effect, but it re-encrypts both db blobs: a random DB key wrapped under the password key.

### VAULT-2 · major · ts — No single-instance guard across tabs: a 'fresh, never shown' address is shown in two tabs, and a wipe is undone by the other tab, which then overwrites the next wallet's database
- Where: src/state/controller.ts:180-203 (boot takes no lock), :708-721 (persist overwrites 'db' with this tab's copy), :351 and :358-375 (each tab prepares its own 'next' address from its own copy), :487-492 (wipe does not reach other tabs); src/lib/storage.ts:70 (setDb, last writer wins), :109 (wipeWallet)
- Scenario: Reproduced with Playwright, two pages in one context, fake engine, real controller and storage (scratchpad/core-review/vault/multitab.spec.ts). (a) Tab A creates a wallet, then tab B unlocks it. Receive in A shows [x, y]; Receive in B shows [y, z]. Address y was shown in both tabs as fresh ('For your privacy, Celari shows a new address each time…'). (b) Tab B: Settings > Remove wallet. IndexedDB keys become []. Tab A is still unlocked and persists on its next address or pass, so the keys become ['db']. Tab B creates a new wallet; tab A persists again, writing its old-key blob over the new 'db'. After a lock and unlock, tab B shows 'Celari could not read this wallet's saved data'. Also with two tabs: a send in tab A is lost from storage when tab B's next pass (within 30 s) overwrites 'db'. History then misses the send and its inputs read as unspent until it is mined. The controller's comment at :824-827 says the saved wallet must keep the transaction.
- Impact: Privacy leak beyond what the app tells users: one address goes to two payers as 'never shown before', so their payments can be linked. 'Remove wallet from this browser' does not remove the database while another tab is unlocked. A wallet re-created afterwards (also the only way to change the password, wipe and restore) becomes unreadable: stuck until another wipe and a full rescan. Balance and History are wrong after a send made in the other tab.
- Proposed fix: Take a Web Lock for the page's lifetime at the start of boot(). Call navigator.locks.request('celari-wallet', {ifAvailable: true}, lock => lock ? new Promise(() => {}) : undefined) and resolve whether it was granted. If it was not, go to bootError with an 'already open in another tab' message and never unlock. The lock is released on reload or close, so the lock-reload gets it back. A page holding a Web Lock is also kept out of Chrome's bfcache. If keeping several tabs is wanted instead: a BroadcastChannel 'wipe'/'locked' message that makes other tabs call reloadLocked(), plus a check in persist() that the stored vault salt still matches this.key's vault before setDb.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: The mechanism is real and reproduces. Nothing in src/ coordinates between tabs: there is no navigator.locks, no BroadcastChannel and no storage event. The docs do not list multi-tab use as a decision or a known gap.

- Boot takes no lock: src/state/controller.ts:180-203.
- Each tab works on its own in-memory copy of the engine database. Address handout runs prepareAddress (:358-375), which calls nextShieldedAddress, which calls WebZjs get_next_shielded_address. That reads get_next_available_address on the tab's own in-memory db (patches/webzjs/0004-ironwood-nu7.patch around :6282-6288). Two copies opened from the same 'db' therefore hand out the same next diversified address.
- persist() (:708-721) overwrites 'db' with this tab's export, through storage.setDb (src/lib/storage.ts:70), a plain idb set where the last writer wins. Its only guard is `this.key !== key`, so it never notices that another tab wiped or replaced the vault.
- wipe() (:487-492) clears only this tab's key.

I re-ran the reviewer's spec (copy in scratchpad/core-review/verify-VAULT-2/multitab.spec.ts; fake engine, real controller and storage). Both tests pass:
- The same u1 address was shown as "new address" in tab A (2nd opening) and tab B (1st opening).
- After the wipe in B, the IDB keys were []. Tab A's next persist brought them back to ['db']. After B created a new wallet and A persisted again, B's lock and unlock showed "could not read this wallet's saved data".

The finding leaves out one important limit. I measured it in verify-VAULT-2/bounds.spec.ts:
- useAutoLock (src/App.tsx:28-82, HIDDEN_LOCK_MS = 60_000 in src/lib/autoLock.ts:5) locks and reloads a tab that has been hidden for 60 s. Simulating a background tab, A locked after 60 s.
- Headless Playwright pages are all "visible", so the reviewer's repro never hits this. With two tabs in one window, both are unlocked for at most ~60 s after switching.
- That window grows only in two cases. One is a soft lock during a catch-up pass: the key is kept until the pass is saved, about 5 min. The other is two windows visible side by side: up to the idle lock, 15 min by default.

So the case of overwriting the next wallet's db needs the old tab to stay unlocked through the whole create or restore flow in the other tab. It also needs the old tab to be the last writer. If the new wallet's tab persists once more after the old tab locks, it heals: it persists after every pass, every 30 s.

The lost-send variant is also transient. The other tab's write is undone by the sending tab's next persist (afterSpend calls kickSync, and passes run every 30 s). Even when that write does land last, scanning the block where the transaction is mined brings it back: the spent nullifiers, plus the change and outgoing outputs read through the OVK. A respend from the same notes in the meantime would be refused by the mempool.

Impact:
- No loss of funds and no key exposure.
- The address reuse is an off-chain link only: two payers who compare notes see the same address. Shielded outputs stay unlinkable on-chain.
- The orphan 'db' left after a wipe cannot be decrypted, because the PBKDF2 salt was deleted with the vault. The next saveWallet replaces it.
- An overwritten db is recovered by wiping and restoring from the seed, with a rescan.

All of this needs the user to unlock the same wallet in two tabs at once, so the rating is minor rather than major. It has nothing to do with NU7.
- Verifier's fix: Allow only one Celari page at a time to hold a wallet key, using a Web Lock that is held until the page unloads.

In src/state/controller.ts:

```ts
/** Held until the page unloads: only one Celari page at a time opens the wallet. */
function holdTabLock(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(false); // every browser with crossOriginIsolated + wasm threads has it; fail closed
  return new Promise((resolve) => {
    void navigator.locks.request('celari-wallet', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise<never>(() => {}) : undefined;
    });
  });
}
```

In boot(), right after the isolation check, add `if (!(await holdTabLock())) throw new Error('other-tab');`. In BootError (src/App.tsx), map 'other-tab' to "Celari is already open in another tab or window. Close it, then retry."

I checked that this does not break lock(), which works by reloading the page. Over 20 reloads each in Chromium and Firefox, the reloaded document got the lock every time (20/20). A second page was refused (granted: false). WebKit could not run here because system libraries are missing.

An option with better UX: take the same lock in createWallet() and unlock(), before anything is decrypted or written, instead of in boot(). Then a forgotten tab sitting on the lock screen does not block a new one. A soft-locked tab still holds the lock, which is correct because it still writes.

Add an e2e test: two pages in one context. The second shows the other-tab message. The first page's lock and unlock reload still works.

### VAULT-3 · minor · ts — A soft lock never ends if the catch-up pass hangs: the lock screen shows while the key stays in memory indefinitely
- Where: src/state/controller.ts:451-455 (soft lock), :531 (await this.eng.sync(), no bound), :582-585 (the only reload after a soft lock), :632-672 (watchPass sees the stall at :657 but only flags it); patches/webzjs/0004 pass_budget.rs (the 300 s budget is checked only before the next GetBlockRange, so a stalled download never reaches it)
- Scenario: Restore runs (catch-up pass). The user locks, or auto-lock fires, and the soft lock starts. The pass's download stalls: a half-open connection or a proxy that holds the stream. eng.sync() never settles, so syncLoop's tail at :582 never runs. Only a pass ending, an engine trap or a wrong password reload the page, and SyncInfo.stalled is shown only in Main, which is unmounted. Reproduced with the fake engine (holdPass) and a fake clock: 33 minutes after Lock the page had not reloaded, still showed 'Your wallet is locked', and the seed came out of the heap (scratchpad/core-review/vault/keyinmem.spec.ts, second test).
- Impact: The wallet tells the user it is locked, but the database key (with VAULT-1, the seed) and the decrypted wallet in wasm stay in memory with no time limit. Defence in depth: auto-lock gives no guarantee during a restore.
- Proposed fix: In watchPass read(), after computing stalled: if (stalled && this.lockAfterPass && !this.unlocking) this.reloadLocked(). Also, in lock() when soft-locking, start a cap timer, e.g. this.softLockTimer = setTimeout(() => { if (this.lockAfterPass && !this.unlocking) this.reloadLocked(); }, 15 * 60_000), and clear it in unlockSoft. The cap covers a syncProgress that also stops answering. At most the unsaved part of one pass is lost, and the lock screen already says progress is saved when the pass ends.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I could not refute it. I reproduced it with both the fake engine and the real engine, and the existing code has no timeout at any of these points.

Code path (src/state/controller.ts):
- lock() at :451-455 sets lockAfterPass and the 'locked' phase, and starts no timer.
- The only reloads during a soft lock are three. The syncLoop tail at :582-585 runs only after `await this.eng.sync()` (:531) and the post-pass awaits (readTip, refresh, persist) settle. engineStopped (:484) needs a wasm trap. unlockSoft's catch (:321) reloads only `if (!this.syncing)`, so during a hung pass even a wrong password does not reload. The finding's wording is slightly off on that last point.
- watchPass (:657) computes `stalled` but only passes it to setSync. The stall banner lives in Main (src/screens/Main.tsx:179), which is unmounted while the phase is 'locked'.
- useAutoLock (src/App.tsx:126) is active only when the phase is 'ready'.

Engine side:
- The 0004 PassBudget checks the budget only in `admits()`, before a GetBlockRange goes out, and only after at least one batch (pass_budget.rs ~L2227).
- BudgetedTransport has no timeout. WebZjs builds its tonic-web-wasm-client 0.8 `Client::new(url)` with no `Options.timeout`, so fetch has no deadline.

Reproductions (scratch: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-3):
1. stall.spec.ts (fake engine, holdPass, fake clock):
   - (A) 60 fake minutes after Lock there was still no reload, the lock screen still showed, and 1 CryptoKey was still in the heap.
   - (B) A wrong password during the hung pass did not reload.
   - (C) Control: when the pass ends, the page reloads.
2. real/realstall.spec.ts (production build in verify-VAULT-3/dist, real WebZjs, mainnet zcash-mainnet.chainsafe.dev). context.route held the pass's first GetBlockRange unanswered, and every other RPC went through. Restoring from 2026-10 showed "Syncing · 50,285 blocks left". I pressed Lock and waited 420 s in real time, past the 300 s budget. There was no reload, the lock screen showed "Your wallet is locked", and the CryptoKey count was 1 before and 1 after. So the budget does not bound a stalled download, and nothing else does.

It contradicts a documented intent. docs/engine-port.md Decision 18 records the owner's decision not to keep scanning under the lock screen because that "would keep the database key in memory while the wallet shows as locked". The soft lock is meant to be the bounded exception, at most one pass of about 300 s. The lock-screen text (en.ts 'unlock.softLocked') does not tell users the wait can be unbounded.

Real-world triggers: lightwalletd or a proxy/CDN in front of it holding the stream open without sending data, or a malicious or broken server. A truly dead TCP peer may eventually be dropped by Chrome's TCP keepalive, which ends the pass and reloads the page, so the unbounded case needs a peer that is alive but silent.

Impact: defence in depth only. To exploit it, someone needs access to the running browser tab (DevTools queryObjects(CryptoKey)) while a hung pass keeps the database key, and with VAULT-1 the seed, in memory after auto-lock or Lock. No funds move and nothing reaches the network.

Fix verified in a scratch copy (fixcopy/ + fixtests/fix.spec.ts), 5/5 passing:
- F1: the cap reloads between 14 and 15 minutes.
- F2: with pass counters standing still, the stall check reloads at fake minute 11.
- F3: unlocking clears the cap.
- F4: a wrong password during a hang is still capped.
- F5: a pass that ends still reloads as before.
The existing lock.spec, sync-status.spec (including the soft-lock budgeted-restore test), engine-stop.spec and upgrade.spec all pass on the fixed copy: 25/25. tsc is clean and no tracked files changed.
- Verifier's fix: This is an app-only change in src/state/controller.ts. No engine or vendor rebuild is needed.

(1) The minimal fix is a hard cap on the soft lock. It covers every place a hang can happen: the scan, the data-request serving, and readTip/refresh/persist after the pass, where watchPass only sees running:false and never flags a stall.

```ts
const SOFT_LOCK_MAX_MS = 15 * 60_000;
private softLockTimer: ReturnType<typeof setTimeout> | null = null;

// lock(), soft-lock branch, after this.set({ phase: 'locked', softLocked: true }):
this.softLockTimer ??= setTimeout(() => this.softLockExpired(), SOFT_LOCK_MAX_MS);

private softLockExpired(): void {
  this.softLockTimer = null;
  if (!this.lockAfterPass) return;
  // A password check under way decides first; if it fails while the pass still hangs, the retry reloads.
  if (this.unlocking) { this.softLockTimer = setTimeout(() => this.softLockExpired(), 1_000); return; }
  this.reloadLocked();
}

// unlockSoft(), after this.lockAfterPass = false:
if (this.softLockTimer) clearTimeout(this.softLockTimer);
this.softLockTimer = null;
```

The re-arm while `unlocking` matters. The finding's version (`if (... && !this.unlocking) reloadLocked()`, run once) would be lost if the timer fires during a password check that then fails, because unlockSoft's catch does not reload while `syncing` is true.

(2) Optional, for an earlier reload: in watchPass read(), right after `const stalled = ...`, add:

```ts
if (stalled && this.lockAfterPass && !this.unlocking) { this.reloadLocked(); return; }
```

The cost is at most the unsaved part of one pass, which resumes from the last save after the next unlock. Optionally, say on the lock screen that the reload happens within 15 minutes at the latest.

### VAULT-4 · minor · ts — A recovery phrase copied by hand is never cleared from the clipboard, and that copy cancels a pending clear of the viewing key
- Where: src/screens/CreateWallet.tsx:19-26 (SeedGrid <ol> has no data-clipboard-clear); src/screens/Settings.tsx:384; src/lib/clipboard.ts:143-148 (onCopy: a copy outside [data-clipboard-clear] calls cancel())
- Scenario: Settings > Show recovery phrase (or Create, after Reveal). The grid is selectable (user-select is none only while blurred), so the user selects the words and presses Ctrl+C. copiedInPage(false) then cancels any pending clear. The 24 words stay in the clipboard, and in OS clipboard history or sync, indefinitely. A viewing key copied the same way is cleared after 60 s.
- Impact: The most sensitive secret gets less protection than the viewing key, through a mechanism that is already built. Any app or clipboard-sync service that reads the clipboard later can take the phrase.
- Proposed fix: Add data-clipboard-clear="" to the SeedGrid <ol> in CreateWallet.tsx. watchClipboard's closest() then schedules the 60 s clear for a hand copy of the phrase, both in Create and in Settings. Optionally show the same note as under the viewing key.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I reproduced this in Chromium with Playwright, using the fake-engine dev server. Scratch files: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-4/vault4.spec.ts and /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-4/pw.config.ts. No tracked files were changed and the repo is clean.

Code path:
- watchClipboard() is installed in every phase (src/App.tsx:128), so it also runs during onboarding.
- onCopy (src/lib/clipboard.ts:143-148) takes the selection's commonAncestorContainer, calls closest('[data-clipboard-clear]') on it, then calls copiedInPage(). With no match, copiedInPage (57-60) calls cancel().
- Only the viewing key's <code> carries that attribute (src/screens/Settings.tsx:150).
- The SeedGrid <ol> (src/screens/CreateWallet.tsx:19-26) does not. Settings reuses it at Settings.tsx:384.
- The words can only be selected while revealed: the .seed-grid.blurred rule (styles.css:1041-1044) sets user-select: none only while blurred. After Reveal, computed user-select is 'auto'.

Results:
1. Create > Reveal words, select the grid, Ctrl+C. The clipboard holds all 24 words, interleaved with their numbers. sessionStorage 'celari.clipboardClear' stays null. After 3 minutes plus a click or focus, the clipboard still holds the phrase.
2. Settings: copy the viewing key with the button, which puts a clear in pending. Then Show recovery phrase, select the grid, Ctrl+C. The pending clear is cancelled (storage key goes to null), and after 3 minutes the phrase is still in the clipboard.
3. Proposed fix, simulated by setting data-clipboard-clear on the <ol> in-page. The same hand copy schedules a clear, and the clipboard reads '' after 61 s. Selecting a single .seed-word inside an <li> also matches.

No prior decision covers this:
- Commit c486460 scoped the clear "yalnızca görüntüleme anahtarı için" (only for the viewing key) and gives no reason for leaving a hand copy of the phrase uncleared.
- README.md:127 still lists the clipboard as an open audit item.
- Nothing in docs/engine-port.md addresses it.

Two refinements to the finding:
- Cancelling the viewing-key clear is not a separate defect. The clipboard now holds the phrase instead of the key, so that follows from the design. The real gap is that the phrase itself is never cleared.
- The impact needs the user to copy the phrase on purpose, against the on-screen warning (create.seedWarn2). This is defence-in-depth, so minor is the right severity.

Side effect of the fix: with both gates open in Settings, a hand copy of the phrase also shows the viewing key's "Celari tries to clear the clipboard..." note under the key row. ViewingKey reads the global status. I confirmed the note appears (1 note visible). The note is accurate but sits in the wrong row.
- Verifier's fix: In src/screens/CreateWallet.tsx, add data-clipboard-clear="" to the SeedGrid <ol> (lines 19-26), next to data-testid="seed-grid". Both the Create screen and Settings (Settings.tsx:384) then go through watchClipboard's closest() check, so a hand copy of the phrase schedules the same 60 s best-effort clear.

Follow-ups:
- Update the CLEAR_ATTR doc comment (clipboard.ts:17) and the header comment, which say the clear covers only the viewing key, and README.md:45 so it mentions the phrase.
- Optionally render the settings.clipboardClear / clipboardCleared note under the seed grid too. A copiedHere flag can be set from that grid's own copy event, so the note shows in the right row and not only under the viewing key.
- Add an e2e case to tests/e2e/privacy.spec.ts: Reveal words, grid.selectText(), Ctrl+C, fastForward(CLEAR_AFTER_MS+1s), then expect the clipboard to read ''.

Do not make the grid unselectable or block copy. That would hurt accessibility and users who paste into a password manager.

### VAULT-5 · minor · ts — On touch devices (Safari, Firefox) the clipboard clear is retried on events that give it no user activation, so it may never run
- Where: src/lib/clipboard.ts:150 (retry on 'pointerdown'), together with the 'focus', 'visibilitychange' and timer retries; src/lib/clipboard.ts:63-80 (tryClear)
- Scenario: iPhone Safari: the user copies the viewing key and keeps using Celari by tapping. Safari allows navigator.clipboard.writeText only with transient user activation. Under the HTML spec, pointerdown gives activation only for pointerType 'mouse'; for touch it comes on pointerup or touchend, after the capture listener at :150 has already run. Every retry from a tap, focus or the timer is refused, so the status stays 'pending' and the clipboard keeps the key. INFERRED from the spec's list of activation-triggering events and Safari's gesture rule; not run on a device here, because Playwright's Chromium grants clipboard-write without activation.
- Impact: The 'cleared after 60 seconds' protection does not work on iOS, the main phone platform, even with the tab in front. The note there says 'may happen later'.
- Proposed fix: In watchClipboard, also retry on window 'pointerup' and 'touchend' (capture), or on 'click', and remove them in the cleanup. tryClear already gives way to a copy that happens during the write, because it re-checks deadline.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I reproduced this in the real app (dev server with VITE_FAKE_ENGINE=1) under Playwright WebKit with iPhone 13 emulation and Playwright Firefox with hasTouch. No tracked files were changed; `git status` is clean. One part of the finding is overstated: the clear is not refused on every tap. In the newer engines it fails only while taps are more than 5 s apart.

Why it happens:
- Firefox, dom/events/EventStateManager.cpp: on touch, user activation is set at pointerup, not pointerdown (pointerdown counts only for `mInputSource == MOZ_SOURCE_MOUSE`). nsContentUtils::IsCutCopyAllowed allows a write only while `HasValidTransientUserGestureActivation()` holds, and that lasts `dom.user_activation.transient.timeout` = 5000 ms.
- WebKit main and safari-7625-branch, Modules/async-clipboard/Clipboard.cpp:87: writes need `window->hasTransientActivation()`, which lasts 5 s (LocalDOMWindow.cpp:202). EventHandler.cpp:268-276 treats only TouchEnd as activation-triggering.
- safari-7618 to 7624 branches (Safari up to 26.x): writes need `UserGestureIndicator::processingUserGesture()`, so the write must happen inside the gesture's own handler and there is no 5 s carry-over. Whether a touch pointerdown carries that gesture on iOS is decided in closed WebKitAdditions code (EventHandlerIOSTouch.cpp), so I could not check it. If it does not, taps never clear on those versions; only a key press does.

Probe with one listener per page (pw/act2.mjs), same result in WebKit and Firefox:
- Retry on touch pointerdown: refused when no earlier tap; succeeds 1.5 s after a tap; refused more than 5 s after the last tap. A timer succeeds only within 5 s of a tap.
- Retry on pointerup, touchend or click: succeeds on every tap.

End-to-end in the app (e2e/touch-clear.spec.ts). Copy the viewing key by tapping, then tap the key text. Every write is logged from inside the page, because Playwright's evaluate can grant activation.
- As shipped, WebKit iPhone and Firefox gave the same log:
  - `t=60.0s write('') act=false REJECT NotAllowedError` (the timer)
  - taps at t=63, 71 and 79 s: each `REJECT NotAllowedError`
  - only a tap at t=80.5 s, 1.5 s after the previous one, gives `act=true OK` and 'Clipboard cleared.'
- With a pointerup retry simulated (an init script dispatches 'focus' on pointerup): the first tap after the deadline, at t=63.0 s, gives `act=true OK` and 'Clipboard cleared.' in both browsers.

Not affected:
- Chromium and Android Chrome: they need focus, not activation.
- Desktop mouse use: pointerdown with a mouse is activation-triggering.
- Typing in any field: the keydown retry works everywhere.

Impact: on Safari and Firefox on phones and tablets, the viewing key (UFVK) can stay in the clipboard well past 60 s while the tab is in front. This happens when the user only taps and the taps are more than 5 s apart (tap, read, tap), and on Safari 26 and earlier possibly on every tap. While it stays, Universal Clipboard can sync it to other devices and other apps can paste it. The note (en.ts:377) says the clear depends only on the tab being in front, and that is not true here. This weakens a defence-in-depth feature; it puts no funds at risk and does not expose the spending key, so it is minor.

Repro files:
- /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-5/e2e/touch-clear.spec.ts
- /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-5/e2e/pw.config.ts
- /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-5/pw/act2.mjs

To run Playwright WebKit I installed its system libraries with `npx playwright install-deps webkit` (apt packages only, nothing in the repo).
- Verifier's fix: In src/lib/clipboard.ts watchClipboard, keep the pointerdown listener (mouse) and add one for pointerup, with its removal in the cleanup:
  window.addEventListener('pointerup', retry, true);
  ...
  window.removeEventListener('pointerup', retry, true);
A touch pointerup is activation-triggering in both Gecko and WebKit, and activation is set before listeners run. That is enough for Firefox and Safari 27+. For Safari 26 and earlier (activation checked by gesture token), also add window 'click' with capture, and remove it in the cleanup. The synthetic click after a tap on iOS runs as a user gesture.

This brings no new race with a Copy tap. The window capture listener fires, and starts its write(''), before React's onClick write(key). The writes run in order, and tryClear already gives way through its deadline re-check. The existing pointerdown retry already has the same order.

Optionally, add an e2e test like touch-clear.spec.ts (WebKit iPhone or Firefox with hasTouch) and drop 'while this tab is in front' from the note's claim or soften it.

### VAULT-6 · minor · ts — Vault and database are kept in best-effort storage: navigator.storage.persist() is never requested and users are not warned that the browser can delete them
- Where: src/lib/storage.ts:8 (createStore('celari','kv'), no persist()); src/state/controller.ts:231 (saveWallet, nothing after it); README.md and the Create/Restore copy (no warning)
- Scenario: Safari deletes all script-writable storage of a site that has not been used for 7 days of browser use (WebKit's policy; a site added to the Home Screen is exempt). Chromium can evict a non-persisted origin under storage pressure. A user who holds funds and does not open Celari for a few weeks finds the Welcome screen: vault, meta and db are gone. INFERRED from the browsers' published storage policies; grep shows no persist() call and no warning anywhere.
- Impact: The funds are recoverable only from the recovery phrase, and a full rescan is needed; a user who lost the paper loses access to the funds. The app tells users nothing about this risk.
- Proposed fix: After storage.saveWallet in createWallet, and on unlock when navigator.storage.persisted() is false, call navigator.storage?.persist?.() and ignore any failure. Add a line to the create/restore flow and the README: the browser can delete this site's data (Safari after 7 days without a visit unless Celari is added to the Home Screen), and the recovery phrase is the only backup.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: The gap in the code is confirmed, but the finding overstates what the app tells users.

Code:
- src/lib/storage.ts:8 opens createStore('celari','kv'), an ordinary best-effort IndexedDB store.
- src/state/controller.ts:231 (storage.saveWallet in createWallet) and unlock() (line 246 on) never call navigator.storage.persist() or persisted(). Grepping src/ finds no navigator.storage use at all.
- I ran the fake-engine dev build in Playwright Chromium (scratch script /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-VAULT-6/check.mjs). navigator.storage.persisted() returns false for the app's origin, so its data can be evicted.
- docs/engine-port.md, README.md and the patch/upstream notes do not document this as a deliberate decision.

Browser policies (checked against primary sources):
- WebKit blog 10218: Safari deletes "all of a website's script-writable storage", Indexed DB included, "after seven days of Safari use without user interaction on the site". Home Screen web apps "have their own counter of days of use".
- WebKit blog 14403: Safari grants persist() by heuristics "like whether the website is opened as a Home Screen Web App". A persistent origin is excluded from eviction. The post does not say persistent mode exempts a site from the ITP 7-day removal.
- Chromium evicts non-persistent origins under storage pressure. The WebKit post also lists storage pressure as a trigger.

Eviction itself cannot be reproduced here: there is no Safari, and filling the disk is not practical. The scenario rests on these published policies.

Corrections to the finding:
1. "The app tells users nothing" is wrong. The app tells users the phrase is the only backup: en.ts:41 says "These 24 words are the only backup of your wallet", en.ts:44 says "If you lose these words, your funds cannot be recovered", tr.ts:42/45 say the same, and a verification step makes them re-enter words. A user who kept the phrase loses no funds. What is missing is any word that the browser may erase the wallet on its own. Users get a surprise Welcome screen and a full rescan from the birthday, which the README says can take hours for old birthdays. Only a user who ignored the backup warning loses funds; a view-only wallet needs its uview key to be added back.
2. persist() alone does not fix the Safari case. Safari grants it essentially only to Home Screen web apps, and its effect on the 7-day ITP removal is undocumented. So on Safari, the warning text and the Home Screen advice are the real fix. persist() mainly protects against storage-pressure eviction in Chromium and Firefox.
3. Firefox shows a permission prompt for persist() (expected UX, not a bug).

Nothing here is tied to NU7.
- Verifier's fix: 1. Add a best-effort persistence request in src/state/controller.ts. Put `void requestPersistence();` right after `await storage.saveWallet(record, meta, db);` at line 231, and in unlock() after unlockVault succeeds. Add this helper:

```ts
async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.();
    }
  } catch {}
}
```

Ignore every failure, and never let it block create or unlock.

2. Add one line of copy to the create seed step, next to create.seedIntro in src/i18n/en.ts and tr.ts (rendered in src/screens/CreateWallet.tsx), to the view-only add step, and to the README (TR and EN). For example: "Your browser can delete this site's data on its own: Safari after 7 days of use without opening Celari (unless Celari is added to the Home Screen), and any browser when the disk is full or when you clear site data. Your recovery phrase (or viewing key) is then the only way back."

No engine or storage-format change is needed.

## Lens: spendflow

Coverage: Read in full: src/state/controller.ts, src/engine/webzjs.ts, webzjs-errors.ts, webzjs-crash.ts, webzjs-balances.ts, webzjs-upgrades.ts, lightd.ts, types.ts, index.ts; src/lib/spendWait.ts, network.ts, zec.ts, memo.ts, address.ts, spendRefusal.ts, syncView.ts, storage.ts (db functions), autoLock.ts; src/screens/Send.tsx, SpendSteps.tsx, Shield.tsx, Main.tsx, plus the relevant parts of Home.tsx, Unlock.tsx, App.tsx (useAutoLock) and en.ts. Prior work read: docs/engine-port.md in full and the relevant parts of README.md. The .webzjs/ checkout here is stale: it differs from the committed patches and lacks boundary.rs and data_requests.rs. So I applied patches/webzjs/0001-0004 to a fresh clone of WebZjs a50df944 in the scratch folder (/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/spendflow/wz). There I reviewed wallet.rs (pczt_create, pczt_shield, pczt_prove, pczt_send, catch_up_before_building, sync_pass, change_strategy), boundary.rs, error.rs and bindgen/wallet.rs. I checked the crates.io sources of zcash_client_backend 0.25.0 (create_pczt_from_proposal's single-step rule, the two-step TEX proposals in input_selection, propose_transfer, propose_shielding, refresh_utxos, SplitPolicy, propose_send_max_transfer) and tonic-web-wasm-client 0.9.2 (timeouts). Ran: npx vitest run, 249/249 passed. Not run: scripts/test-engine-native.sh (backend and glue), the wasm build, npm run test:e2e and test:e2e:real, and no browser or mainnet experiment. SPEND-2 (TEX always fails with ProposalNotSupported) and SPEND-3 (fee and Max numbers) come from reading the code, not from a run. The ZIP 317 figures are worked out from the split policy and fee rule. SPEND-1 assumes the restored phrase has UTXOs on more than one t-address within the gap limit; I did not test it on chain. I checked and found sound, so not reported: double-click and double-spend guards (running ref plus the controller's spending flag), the recipient and amount sent match the draft (to.trim(), exact Zatoshis), the 'nothing sent' and 'maybe sent' sorting (refusal codes come only from pre-store checks, and stage-based hints are correct), the beforeBroadcast network re-check (fails closed, 10 s fetch timeout), clearForm timing, ZIP-321 parsing (multi-payment, req-, duplicate keys, memo and amount validation), memo byte counting, parseZec, and the db-legacy and upgrade-rescan conditions.

### SPEND-1 · major · engine — Shield puts every funded transparent address into one transaction, linking them publicly, but the app talks about a single address
- Where: WebZjs crates/webzjs-wallet/src/wallet.rs:781 after patches/webzjs/*.patch are applied (pczt_shield: `from_addrs = transparent_balances.into_keys()`, passed whole to propose_shielding); src/state/controller.ts:789-795 (shield() takes no address); src/screens/Shield.tsx:111-113 and src/i18n/en.ts:311-313 ("The amount and your transparent address are visible on chain"). How funds on several addresses get found: zcash_client_backend 0.25 src/sync.rs:511-517 (refresh_utxos asks about every receiver) and engine/zcash_client_memory/src/ll.rs (generate_transparent_gap_addresses).
- Scenario: A user restores a recovery phrase from a wallet that gives out a new t-address for each receive (Zashi/Zodl). Two external t-addresses inside the gap limit, tA and tB, still hold unshielded UTXOs, for example withdrawals from two different exchanges. Celari's gap-limit address generation and refresh_utxos find both, and Home shows one Transparent total with a Shield button. The user presses Shield. pczt_shield calls get_transparent_balances, gets {tA, tB} and passes both to propose_shielding. GreedyInputSelector spends UTXOs from both addresses in one v6 transaction. The Shield screen only said the amount and "your transparent address" (singular) would be visible.
- Impact: The chain now shows tA and tB as one owner (common-input ownership), and that link is permanent. Two exchange accounts or payers that the earlier wallet kept apart by rotating addresses can now be linked. This leaks more than the app tells the user. The Zcash mobile SDKs refuse this case ("Account has more than one transparent receiver with funds to shield") and shield one receiver at a time. README says shielding has not been tested with real funds yet, so this would show up in the owner's next test with a restored phrase.
- Proposed fix: Engine: give pczt_shield an optional address, `pczt_shield(account_id, address: Option<String>)`. When it is None and `transparent_balances.len() > 1`, return a coded refusal (e.g. `ShieldSeveralAddresses`, listing address and value) before proposing anything. When it is Some, pass `&[addr]` as from_addrs. Add `transparent_balances(account)` to the bindings. App: when more than one address holds funds, shield one address per transaction. Say on screen that shielding them together would link them publicly. Map the new code in webzjs-errors.ts like the other SpendRefusedError codes.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: The engine behaviour is real, and I reproduced it end to end. I could not refute it, but two parts of the finding are wrong or overstated, so I am rating it minor rather than major.

Reproduction (native glue test; scratch only, no tracked files changed):
- The patched WebZjs tree is at /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-1/wz. The test is `review_spend1` at the end of crates/webzjs-wallet/src/tests/nu7_pipeline.rs. I also extended the scratch MockLwd so `GetAddressUtxosStream` serves UTXOs and records which addresses were asked.
- The log is /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-1/test.log.
- Setup: a freshly created account, with one UTXO the server reports on the default address tA (index 0, 0.006 ZEC) and one on tB (external index 3, inside the gap limit of 10, 0.007 ZEC).
- `sync_to_tip` sent one GetAddressUtxos request naming 16 addresses, tA and tB among them. The memory backend's get_transparent_receivers returns every External and Internal gap address, exposed or not (engine/zcash_client_memory/src/wallet_read.rs:983-995, transparent_ops.rs:105-165). Account creation generates those gap addresses (wallet_write.rs:322-338, GapLimits::default: external 10, internal 5).
- get_transparent_balances returned both addresses, and the app's single Transparent total (unshielded_balance) was 1,300,000 zats.
- `pczt_shield` produced 2 transparent inputs with 2 distinct source scripts (tA and tB). After signing (webzjs-keys), proving and `pczt_send`, one transaction was broadcast spending both prevouts.
- The code path is patched wallet.rs:771-797: `from_addrs = transparent_balances.into_keys()` goes whole to propose_shielding. GreedyInputSelector::propose_shielding (zcash_client_backend 0.25, input_selection.rs:2223) gathers inputs from every source address into one single-step proposal.
- The app cannot choose an address. controller.ts:789-795 and the WebWallet.pczt_shield(account_id) binding take no address. The Shield copy says "The amount and your transparent address are visible on chain" (en.ts:311-313, tr.ts:312-313; singular), and nothing anywhere mentions that addresses get linked.
- Nothing in docs/engine-port.md, the README, patches/webzjs/README.md or UPSTREAM.md records this as a decision. docs/reviews/2026-10-pre-nu7-core-review.md is only this review's interim log.

What weakens the finding:
1. Its claim that "the Zcash mobile SDKs refuse this case and shield one receiver at a time" is out of date. In the current zcash-android-wallet-sdk backend (backend-lib/src/main/rust/lib.rs, proposeShielding, about lines 2360-2395), a null transparentReceiver shields every non-ephemeral address whose spendable value meets the threshold, all in one transaction; only ephemeral addresses go one at a time. The Kotlin doc still says it throws, but the code does not. Zodl Android (main, 2026-10-29) calls `proposeShielding(..., transparentReceiver = null)` in ProposalDataSource.kt:207-213. So the reference NU6.3 wallet links funded addresses in exactly the same way. Celari is no worse than the ecosystem default; it is only less candid in its copy.
2. Celari itself never puts funds on a second address. The t1 address it shows is fixed, Receive hands out shielded-only UAs, and ZIP 320 ephemeral outputs are spent by the second transaction of the pair. The multi-address state appears only when restoring, or using alongside Celari, a seed whose other wallet funded several BIP44 addresses or change addresses on account 0. Examples: Trezor or Ledger fresh receive and change addresses, or zcashd UAs at different diversifier indices. I did not confirm the finding's specific example that Zodl rotates t-addresses: Zodl rotates shielded-only UAs, and its t-address comes from getTransparentAddress. The owner's own Celari wallet, with a single t1, is not affected.

Remaining harm: the precondition is narrow, but when it holds, Shield links the addresses on chain permanently, and the screen does not say so. That is a disclosure gap rather than an exploit; the copy and the README privacy section talk about one address.

Pitfalls in the finding's proposed fix:
- A refusal on `transparent_balances.len() > 1` also counts addresses holding only dust: transparent_balances inserts an entry for any non-zero value, adding it as uneconomic value. That would refuse spuriously.
- A hard refusal with no per-address path would leave the funds unshieldable in Celari, which is worse than the leak.
- With per-address shielding, any address below SHIELDING_THRESHOLD (100,000 zats) could never be shielded unless it is combined with another.
- Verifier's fix: Minimal safe fix (app copy only, no engine change; can land at any time):
- In en.ts and tr.ts, change shield.intro and shield.introOrchard to say: "The amount and your transparent address(es) are visible on chain. If your transparent funds are on more than one address (for example after restoring a phrase from another wallet), they move in one transaction, which shows publicly that those addresses belong to the same wallet."
- Add one line to the README privacy paragraph saying the same.

Full fix (engine plus app, after NU7):
1. Patch 0004 / wallet.rs: `pczt_shield(account_id, address: Option<String>)`.
   - Decode the address and check it is one of the account's receivers (as the Android SDK does).
   - With Some(addr), use `from_addrs = [addr]`, only if its spendable value is at least SHIELDING_THRESHOLD.
   - With None, keep the current behaviour.
2. Add a `transparent_balances(account)` binding returning (address, spendable value) pairs, counting only spendable value; leave uneconomic dust out.
3. App: when more than one address is at or above the threshold, offer shielding one address per transaction (each its own sign, prove and send), plus an explicit "shield all together" option that warns the addresses will be linked publicly. Keep the combined option for amounts that only pass the threshold together.
4. Do not hard-refuse more than one funded address without that per-address path, or the funds become unshieldable in Celari.
5. Add a native glue test along the lines of the scratch review_spend1 test, and map any new refusal code in webzjs-errors.ts.

### SPEND-2 · minor · ts — TEX payments can never be built, yet the form accepts them, and the failure tells the user to lower the amount
- Where: src/lib/address.ts:55 (accepts `tex`); src/screens/Send.tsx:77-79 (feeFloor 20,000 for TEX), 326 (texWarn), 333 (failureHint); src/screens/SpendSteps.tsx:101 (every non-refusal error at 'building' gets failureHint); src/i18n/en.ts:247. Engine side: pczt_create calls create_pczt_from_proposal, which in zcash_client_backend 0.25 src/data_api/wallet.rs:2987-2990 returns ProposalNotSupported for any proposal with more than one step. A TEX payment always gets the two-step ZIP 320 proposal: input_selection.rs:956-1004 and 2153-2172.
- Scenario: A user pastes an exchange deposit address `tex1…`, enters 0.5 ZEC and has enough Ironwood funds. Review shows "TEX · public" with a fee of about 0.0002, and the user confirms with the password. pczt_create calls propose_transfer, which builds a ZIP 320 pair: step 0 sends shielded value to an ephemeral t-address, step 1 pays the TEX. create_pczt_from_proposal then fails with ProposalNotSupported. The screen says "Sending failed. The balance may not cover the network fee. Lower the amount slightly and try again." Every retry with a smaller amount fails the same way. Nothing is stored, because ephemeral addresses are only reserved later, in build_proposed_transaction (wallet.rs:2555). Earlier tests did not catch this: the 'measured' TEX case in tests/unit/spend-refusal.test.ts used an empty wallet, so it never got past InsufficientFunds. docs/engine-port.md:351 still lists a TEX send as a real-funds test, while the Deferred section says "Celari builds no such pairs".
- Impact: No funds are at risk, but the app offers a payment type it cannot make and gives wrong advice about why it failed. The same 'lower the amount' hint also appears for other build errors that have nothing to do with the balance: 'Wallet has not been synced yet', 'different consensus branches after syncing; sync again', or an address the engine rejects. Insufficient funds already has its own refusal message (E2E-2).
- Proposed fix: Until the engine can build multi-step PCZTs, refuse TEX in review(): for `check.kind === 'tex'`, set a new `send.err.address.texUnsupported`. Drop the TEX case from feeFloor and remove TEX from the real-funds checklist. Change `send.failedHint` to a neutral 'Nothing was sent' line and keep ErrorDetails, since insufficient funds is already reported separately.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I confirmed the finding by reproducing it natively and tracing the code end to end. I found nothing that refutes it.

ENGINE (reproduced). I wrote a scratch test that copies the setup of engine/zcash_client_memory/src/testing/pczt_branch.rs: a 1 ZEC fake note, NU6.3 active, a 0.5 ZEC payment, propose_transfer with SpendPolicy::default() and no locks, then create_pczt_from_proposal with BundlePadding::DEFAULT. These are the same calls the patched webzjs-wallet makes in Wallet::pczt_create (wallet.rs:875-913 after patches 0001-0004). The change strategy is webzjs's: MultiOutputChangeStrategy, ZIP 317, fallback pool Ironwood. The build used the pinned nightly-2026-10-28, --locked, with features orchard, transparent-inputs and pczt-tests. Output:
  SPEND-2 t1 (control): proposal steps 1, fees per step [30000]; create_pczt_from_proposal -> Ok(pczt, tx_version 6)
  SPEND-2 tex: proposal steps 2, fees per step [30000, 10000]; create_pczt_from_proposal -> Err(ProposalNotSupported)
  test result: ok. 1 passed
The test is at /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-2/engine/zcash_client_memory/src/testing/tex_pczt.rs and the log at /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-2/test2.log.

Why it happens:
- The wasm enables transparent-inputs on zcash_client_backend (webzjs-wallet/Cargo.toml:57; zcash_client_memory features orchard and transparent-inputs).
- So Address::Tex takes the ZIP 320 path (input_selection.rs:984-1004) and Proposal::multi_step (2102-2172).
- zcash_client_backend 0.25 wallet.rs:2987-2990 then rejects any proposal with more than one step ("For now we only support turning single-step proposals into PCZTs").
- Celari calls only pczt_create, pczt_prove and pczt_send (src/engine/webzjs.ts:308-350). There is no non-PCZT fallback, so a TEX payment can never be built.

APP PATH (traced):
- checkAddress accepts `tex` as ok (src/lib/address.ts:55).
- review() only refuses `!check.ok` (src/screens/Send.tsx:228-230), so a TEX draft reaches the confirm screen. That screen shows "TEX · public" (106-107), the texWarn (326) and a 20,000 zat fee floor (78).
- WebzjsEngine.send sets stage 'building' before pczt_create (webzjs.ts:305).
- The engine error is "Failed to create Pczt: ProposalNotSupported". buildError (webzjs-errors.ts:84-95) maps only UpgradePending, PcztWrongBranch, PcztExpired and InsufficientFunds, so this error comes back unchanged.
- SpendSteps.tsx:101 then shows failureHint = send.failedHint (Send.tsx:333): en.ts:247 "The balance may not cover the network fee. Lower the amount slightly and try again." (tr.ts:248 says the same in Turkish). Retrying with any amount fails the same way.
- Nothing is signed, stored or broadcast: the error comes before pczt_sign, and ephemeral addresses are reserved only in build_proposed_transaction.

The same misleading hint appears for other building-stage errors that have nothing to do with the balance, from catch_up_before_building (wallet.rs:550 "Wallet has not been synced yet", 566 "different consensus branches after syncing"). The balance case already has its own message (INSUFFICIENT_FUNDS refusal, E2E-2), so the generic hint is wrong in every case that still reaches it.

WHY TESTS MISSED IT:
- tests/unit/spend-refusal.test.ts:16-17 measured TEX on an empty wallet, so it stopped at InsufficientFunds.
- The fake engine builds TEX payments (fake.ts:144-149 only models a higher fee).
- tests/e2e/spend.spec.ts uses TEX only for the memo-field check.

DOCS:
- docs/engine-port.md:351 lists "a TEX address" in the real-funds send checklist that must pass before NU7.
- Deferred (313-316) says "Celari builds no such pairs". That is true of the engine, but the UI still offers the payment. Neither this nor any other known gap is documented as a deliberate decision.

IMPACT: no funds or privacy at risk, and the transaction is refused before signing. But users cannot pay a TEX address (some exchanges require one for deposits), even though the form presents TEX as supported. They get wrong advice ("lower the amount") and can keep retrying a payment that will never work.
- Verifier's fix: A TypeScript and docs change only; no engine, wasm or vendor hash change.

1. src/screens/Send.tsx:229-230 in review(): refuse TEX the same way an invalid address is refused:
   `linkProblem(parsePaymentInput(to)) ?? (check.ok ? (check.kind === 'tex' ? 'send.err.address.texUnsupported' : null) : `send.err.address.${check.reason}`)`
   Add 'send.err.address.texUnsupported' to en.ts and tr.ts. Suggested text: "Celari cannot pay TEX addresses yet (the payment needs two linked transactions). Nothing was sent; ask the exchange for a t1 address or a unified address." This also covers zcash: payment links, which go through the same review().
   The 'tex' case in feeFloor (Send.tsx:78) and the TEX notice on the confirm screen (Send.tsx:326) become unreachable and can be dropped.

2. Drop `failureHint={t('send.failedHint')}` at Send.tsx:333 (and remove the send.failedHint key from en.ts:247 and tr.ts:248). SpendSteps.tsx:101 then falls back to the neutral 'send.failedRetry' line ("Nothing was sent. You can try again."), and ErrorDetails still shows the engine text. Insufficient funds keeps its own SpendRefusedError message.

3. Tests:
   - Make the fake engine reject a tex1 recipient with 'Failed to create Pczt: ProposalNotSupported' (src/engine/fake.ts send).
   - Add an e2e check in tests/e2e/spend.spec.ts that a TEX recipient is refused on the form with the new message.
   - Add a unit check that the TEX address kind is refused in review().

4. docs/engine-port.md:351: remove "and a TEX address" from the real-funds send checklist. Add to Deferred: "TEX recipients are refused in the Send form: create_pczt_from_proposal (zcash_client_backend 0.25 wallet.rs:2987-2990) turns only single-step proposals into PCZTs, and a TEX payment is a ZIP 320 two-step proposal."

Real TEX support (building the ZIP 320 pair as two PCZTs, or through create_proposed_transactions) is a larger engine change and should not be attempted before NU7.

### SPEND-3 · minor · ts — Max and the fee shown use a fixed 10,000 zats; Celari's own change splitting makes Max fail and the shown fee too low
- Where: src/screens/Send.tsx:176 (`max = available - TYPICAL_FEE_ZATS`), 236 (balance check), 559/563 and 644-652 ("~0.0001" fee and total on the preview, the confirm step and the result); src/engine/types.ts TYPICAL_FEE_ZATS. Engine: WebZjs wallet.rs:235-243 and 262-263 (MultiOutputChangeStrategy with SplitPolicy target_note_count=4, min_split_output_value=0.1 ZEC).
- Scenario: The wallet holds one Ironwood note of 5 ZEC. The user sends 1 ZEC to a u1… address. The confirm step shows a fee of about 0.0001. SplitPolicy aims for 4 notes of at least 0.1 ZEC each, so the change is split into 4 outputs. That makes 5 Ironwood outputs, and ZIP 317 charges 25,000 zats. The result screen still says about 0.0001. The wallet now holds 4 notes. Next the user presses Max: amount = available - 10,000. Spending all 4 notes costs 20,000 under ZIP 317, so the engine refuses with InsufficientFunds ("It needs Y+0.0001 ZEC… Y is spendable") every time. Wallets that have received many small payments pay 5,000 zats per note spent, and the confirm screen still shows about 0.0001.
- Impact: After any send that leaves 0.4 ZEC or more in change, Max fails every time. The real fee is never shown before or after the broadcast, so the total the user confirms can be several times lower than what is paid. No funds are lost and nothing is sent when Max fails, but this is a robustness and wrong-figure problem on the confirm step.
- Proposed fix: Have the engine report the fee. pczt_create and pczt_shield should return the proposal's `balance().fee_required()` with the PCZT (or add a `pczt_fee` helper). Show that exact fee before signing; one option is an `auth.confirmFee(fee)` hook in signProveSend that stops when the fee is above what was shown. For Max, add a binding over zcash_client_backend 0.25 `propose_send_max_transfer` (src/data_api/wallet.rs:1144) that returns the largest sendable amount for the recipient and memo, and use it instead of `available - TYPICAL_FEE_ZATS`.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I reproduced this natively. I took a fresh WebZjs a50df94 checkout, applied patches/webzjs/0001-0004 and engine/webzjs.Cargo.lock, and used an unchanged copy of engine/zcash_client_memory. It matches the enginespend reviewer's tree except for that reviewer's own tests. I added two scratch tests (verify_spend3_*) to the harness in /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-3/wz/crates/webzjs-wallet/src/tests/nu7_pipeline.rs. Logs are run.log and run2.log in the same folder. The tests use the real Wallet::pczt_create with mainnet parameters, NU6.3 active, before NU7.

(1) Fee of a send from one note: the wallet holds one 5 ZEC Ironwood note and pays 1 ZEC to a u1. The PCZT's Ironwood value balance (the fee) is 25,000, with 5 Ironwood actions. proposal fee_required is 25,000, with 4 change outputs of 99,993,750 each. Paying 0.3, 0.25 or 4 ZEC gives the same result: 4 change notes and a fee of 25,000. The cause is the SplitPolicy in wallet.rs:235-243 (target 4 notes, minimum 0.1 ZEC, with 4 notes hardcoded at :262-263). The app never overrides it.

(2) Max after that send: the test framework built and mined that same send with Celari's change strategy. The wallet then holds 4 notes, 399,975,000 spendable. The app's Max sends 399,965,000 (available - TYPICAL_FEE_ZATS, Send.tsx:176). pczt_create refuses it with InsufficientFunds { available: 399975000, required: 399985000 }, so the real fee is 20,000 and nothing is stored (tx count 2 -> 2). Spendable - 15,000 is also refused. Spendable - 20,000 builds (fee 20,000, 4 actions).

Baselines: Max works with 1 or 2 notes (fee 10,000). With 3 notes it is refused (needs 15,000). So Max fails as soon as the wallet holds 3 or more spendable notes. The finding says 0.4 ZEC of change; the real threshold is lower: any send that leaves 0.3 ZEC or more of change from one note.

App side, confirmed:
- The confirm step and the result screen show '~0.0001' (DraftSummary, Send.tsx:589, 645-651; feeFloor :77-79).
- pczt_create runs only after the password (webzjs.ts:305-314, controller.ts:784-785), so the real fee is never seen before signing.

Corrections to the finding:
- The fee is labelled 'Estimated fee ~' and 'Network fee about', and History's TxRow (TxRow.tsx:71-72) shows the engine's real feeZats afterwards. So "never shown after" is too strong, but the result screen does show the low estimate.
- No funds are at risk. The refusal text (send.refused.funds, en.ts:252-253) says nothing was sent and gives the required and spendable amounts, but not the amount that would work.

Prior work: tests/e2e/spend.spec.ts:134-136 (E2E-2) treated a refused Max as an edge case (a TEX-like fee) and only made the message readable. It is not a recorded decision in docs/engine-port.md. The new evidence is that Celari's own split policy makes the refused Max the normal state after the first ordinary send. This is the same root cause as ES-4 (enginespend lens), so the two should be merged.
- Verifier's fix: Stopgap, app only, no engine or wasm rebuild, safe to land at any time:
- When send fails with the refusal insufficientFunds {requiredZats, availableZats}, compute fit = availableZats - (requiredZats - draft.zats). Offer 'Send {fit} ZEC instead', which returns to the form with that amount filled in. The user reviews and confirms again; the confirmed amount must never change silently.
- Why one retry is enough: a Max spend has no change, so requiredZats - draft.zats is exactly the fee of spending every note. Measured: 4 notes give fit = spendable - 20,000 and it builds; 3 notes give spendable - 15,000 and it builds.
- Change the fee line from '~0.0001' to 'from 0.0001', with a note that ZIP 317 adds 0.00005 for each extra note spent or created. Add a unit test for fit in spendRefusal and an e2e test using the fake engine's engineFee knob.

Proper fix (engine, after NU7):
- Add a read-only binding, e.g. propose_fee(account, to, value, memo). It runs propose_transfer with Celari's change_strategy, no input locks and no PCZT, and returns proposal.steps().first().balance().fee_required(). The Review step calls it before the password and shows the exact fee and total.
- Alternatively, return that fee from pczt_create, and have signProveSend stop when it is above the fee the user confirmed.
- Add max_sendable(account, to, memo) over zcash_client_backend 0.25 propose_send_max_transfer (data_api/wallet.rs:1144) with MaxSpendMode::MaxSpendable, and use it for Max instead of available - TYPICAL_FEE_ZATS.
- After that: rebuild vendor/, regenerate scripts/webzjs-vendor.sha256, then run the native tests and the real-engine e2e tests.

### SPEND-4 · minor · ts — A stalled background pass leaves a spend stuck on 'Building' with no notice, and auto-lock never locks the wallet
- Where: src/state/controller.ts:527 (stall watch runs only for catch-up passes), 438-443 (lock() is put off for the whole spend, whatever stage it is in); src/screens/SpendSteps.tsx:69-72 (no wait shown while the pill says 'Up to date'); WebZjs crates/webzjs-wallet/src/bindgen/wallet.rs:144 (`Client::new(url)`: tonic-web-wasm-client 0.9.2 with no FetchOptions timeout); wallet.rs catch_up_before_building (`self.db.read().await`) behind the pass's write lock (wallet.rs:437).
- Scenario: The wallet is up to date and a routine 30-second pass starts. The server or proxy stops answering in the middle of GetBlockRange, or one of the pass's GetTransaction/GetTaddressTxids calls never returns, but the connection stays open. The pass keeps the database write lock forever. The pill keeps showing 'Up to date' (status 'syncing' with networkTip set), and no stall notice appears because only catch-up passes are watched. The user submits a payment: pczt_create waits on db.read() forever. The screen stays on 'Building… Do not close this tab' with navigation and the Lock button disabled. When idle or hidden-tab auto-lock fires, controller.lock() only sets lockAfterSpend, so the wallet stays unlocked with its key in memory while the user is away. A related effect after the broadcast: if a pass grabs the lock right after pczt_send, afterSpend's refresh()/persist() wait behind it. The screen then keeps saying 'do not close' although the payment is out, and closing the tab drops the stored transaction from the saved wallet.
- Impact: Nothing is sent, but the spend hangs with no visible cause, the user can only get out by reloading against the beforeunload prompt, and auto-lock does not work for as long as it hangs.
- Proposed fix: (1) Have spend() record the current stage, and put off lock() only once the stage is 'broadcasting'. Before that nothing has left the wallet, so reload at once. (2) Run watchPass() for every pass, not only catch-up ones, so a stalled pass shows the Reload notice. Also show 'waiting for the sync' while a spend sits in 'building' with `syncing` true. (3) In the engine, construct the client with `Client::new_with_options(url, FetchOptions::new().timeout(...))` for unary calls. (4) In afterSpend, call persist() before refresh().
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: The finding is real. I reproduced it with the real engine on mainnet. I used a scratch production build of this branch; vendor/ matches all 16 hashes in scripts/webzjs-vendor.sha256. Script: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-4/real/repro.mjs. Output: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-4/real/repro.out.

What the run did:
1. Created a new wallet from the tip. The first pass ended with status idle and the pill read 'Up to date · block 3,536,027'.
2. Control: WalletController.send() of 10,000 zats on the empty wallet failed within 0 s with InsufficientFunds.
3. The context route then held the next routine pass's first gRPC request, GetSubtreeRoots, open without answering. Worker fetches are routed; GetBlockRange was seen too.
4. Held state: sync status 'syncing', catchUp null, stalled false. The pill still said 'Up to date', and no sync-stalled notice was shown.
5. The same send() started. 90 s later it was still stuck at stages ['building@0s'] with result pending and spending true.
6. The tab was then hidden (the same visibility override the e2e helper uses). The hidden-tab auto-lock fired: sessionStorage celari.autoLocked was set to 'hidden'. After 150 s hidden the page had not reloaded (samePage stayed true) and phase was still 'ready'. The wallet stayed unlocked.
7. Only when the held request was aborted did the pass fail. The spend then went on, and the deferred lock reloaded to the lock screen.

The browser does not end such a stall by itself. A separate Chromium 153 test (/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-4/stall/stall.mjs) used one stream that sent headers and one frame then went silent, and one request that never got an answer. Both fetches were still pending after 420 s. The engine sets no timeout either:
- bindgen/wallet.rs:144 uses `Client::new` with default FetchOptions (timeout None).
- pass_budget.rs only refuses the next GetBlockRange after the budget runs out.

Code path (wallet.rs line numbers are from patches 0001-0004 applied to WebZjs a50df94 in the scratch folder, because the repo's .webzjs/ is stale):
- sync_pass takes `db.write()` at wallet.rs:440 and holds it across `run(...).await` and serve_transaction_data_requests.
- pczt_create -> catch_up_before_building waits on `db.read()` at wallet.rs:551.
- controller.ts:527 runs watchPass only when catchUp is set.
- controller.ts:440-442 only sets lockAfterSpend.
- controller.ts:513-514: syncLoop has no `spending` guard, so a pass can also start in the middle of a spend.
- Main.tsx:147 disables Lock while spending.

What I did not reproduce:
- The SpendSteps screen itself. I called the real controller directly, because an empty wallet cannot pass Review.
- The pass collision after the broadcast. I only confirmed it from the code: pczt_send drops its write guard (wallet.rs:1018-1026), then send_authorized_transactions takes `db.read()` again (wallet.rs:677-680) behind a writer that was queued on tokio's write-preferring RwLock; afterSpend's refresh and persist also need `db.read()`.

Limits on how often this happens: it needs a server or proxy that keeps the connection alive but stops answering. A dead path is detected by TCP keepalive within minutes. Nothing is sent or lost.

Corrections to the proposed fix:
- (1) as written contradicts deliberate, tested behaviour. tests/e2e/lock.spec.ts:56-82 ('a running send finishes before the lock') defers the lock through 'proving'.
- (4) does not work: persist -> exportDb -> db_to_bytes takes `db.read()` too (wallet.rs:164).
- (3) the tonic-web-wasm-client timeout covers the whole request, streamed body included (the AbortGuard is kept in BodyStream). On a single shared client it would also cut long GetBlockRange batch downloads.
- Verifier's fix: Minimal change, app only, in src/state/controller.ts. No engine change and no vendor rebuild.

(a) Put a time limit on the lock deferral before the broadcast, instead of locking at once.
- In spend(), record the stage: `this.spendStage = s` inside the onStage wrapper; clear it in finally.
- In lock(), when `this.state.spending`, keep `this.lockAfterSpend = true`. If `this.spendStage !== 'broadcasting'`, also arm `this.spendLockTimer ??= setTimeout(() => { if (this.state.spending && this.spendStage !== 'broadcasting') this.reloadLocked(); }, 5 * 60_000)`. Clear the timer in spend()'s finally.
- Before 'broadcasting' nothing has left the wallet, so a reload loses nothing.
- This keeps the tested rule that a send which is proving finishes before the lock, but a spend stuck before the broadcast no longer keeps the wallet unlocked for ever.

(b) In syncLoop, after the existing guard, add `if (this.state.spending) { this.syncTimer = setTimeout(() => void this.syncLoop(), SYNC_RETRY_MS); this.syncing = false; return; }`. Place it before `this.syncing = true`, or reset the flag as shown.
- No new pass can then take the database lock between pczt_send storing the transaction, its broadcast, and afterSpend's refresh and persist. afterSpend's kickSync already starts the next pass.

(c) Optional: start watchPass() for every pass, not only for catch-up passes (`const pass = this.eng.syncProgress ? this.watchPass() : null`). A hung routine pass then shows the existing Reload notice after STALL_MS. syncView ignores `progress` when catchUp is null.

Drop proposal (4): persist also needs db.read(), so reordering it changes nothing.

Leave the engine timeout (3) until after NU7. It needs a second client with FetchOptions.timeout used for unary calls only, because a timeout on the shared client would also cut long GetBlockRange streams. It also needs a patch, a vendor rebuild, a new hash list and a CI run.

Add a fake-engine e2e test: holdStage 'building', hide the tab, fast-forward 6 minutes, expect the lock screen.

### SPEND-5 · minor · ts — Nothing stops a second tab: two unlocked tabs overwrite each other's saved wallet, and a removed wallet comes back
- Where: src/state/controller.ts:180-203 (boot takes no single-instance lock), 708-721 (persist() writes 'db' whenever this tab still holds a key), 487-492 (wipe() clears only this tab's key); src/lib/storage.ts:70, 73-81, 109.
- Scenario: Celari is unlocked in tab A and tab B. In tab A the user removes the wallet (Settings, wipeWallet, reload) and creates a new wallet W2. saveWallet writes W2's vault, meta and db. Tab B still holds W1's key and keeps syncing. Its next persist() calls storage.setDb with W1's blob, encrypted under W1's key, over W2's db. Once tab A reloads or locks, unlocking W2 runs unlockVault (succeeds) and then decryptDb (fails), so WalletDataError appears: "could not read this wallet's saved data". The only way out is to remove W2 and restore it from its new phrase. A lesser version: a payment sent from tab A, and the fresh addresses A handed out, are overwritten by tab B's next save (last writer wins). After a reload the stored transaction and address records are gone until the payment is mined.
- Impact: No funds are lost, but a wallet can be left unopenable, a wallet the user removed has its encrypted data written back, and fresh addresses can be shown twice.
- Proposed fix: At boot, take `navigator.locks.request('celari-wallet', { ifAvailable: true }, () => new Promise(() => {}))` for the life of the page. If it is not granted, show 'Celari is already open in another tab' and do not unlock. As a second guard, have persist() re-read storage.getMeta() and skip setDb when createdAt/accountId no longer match this tab's meta.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I could not refute it. I reproduced it on the fake engine with the real controller and storage: two Playwright pages in one browser context, so they share IndexedDB. The spec is /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-5/specs/two-tabs.spec.ts and the config is /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-5/pw.config.ts. All tests passed and git status is clean.

(1) Main scenario. Tab A creates W1. Tab B unlocks W1. Tab A removes the wallet and creates W2 with the same password. The vault salt is new, so the key is different. Tab B then opens Receive: prepareAddress (controller.ts:365) calls persist(), and persist (:708-721) only checks that this tab's own this.key is unchanged before storage.setDb (storage.ts:70). Measured: "db replaced by tab B: true". Tab A then reloads and unlocks W2. unlockVault succeeds, decryptDb (:261) fails, and the screen shows "Celari could not read this wallet's saved data…". Right after the wipe the store already had a 'db' again with no vault or meta, written by tab B.

(2) Addresses. Each tab's engine has its own in-memory copy of the next diversifier index (zcash_client_memory wallet_write.rs:1270 next_available_address). Measured: A's second Receive equals B's first Receive ("A2===B1: true"). One address is shown in both tabs under the "never shown before" note.

(3) Extra case, same root cause. A tab that booted on Welcome before a wallet existed can create a wallet after one was made in another tab. saveWallet (storage.ts:73-81) replaces W1's vault without asking ("W1 vault overwritten: true"). The user still has W1's phrase from onboarding or restore.

Why it stays minor:
- No funds are lost and the seed is not exposed.
- A background tab locks after 60 s hidden (HIDDEN_LOCK_MS, App.tsx useAutoLock). In the usual one-window case, the front tab's next persist after each pass usually writes the right db back.
- The bad end state needs the stale tab to be the last writer. That is realistic with two visible windows: the stale one keeps writing every 30 s until its 15-minute idle lock after the user leaves the other.
- A left-over W1 blob after a wipe is AES-GCM under a key from the deleted 16-byte salt, so it cannot be read.
- Spending in tab B after W2 exists cannot sign. pczt_sign gets W2's usk and fingerprint for W1's inputs, so nothing valid is broadcast.
- A send lost from storage is found again once mined: nullifiers in compact blocks, plus history enhancement.

This duplicates VAULT-2 in docs/reviews/2026-10-pre-nu7-core-review.md, which was already verified there as real, minor, not needed before NU7. It is not among the documented decisions in docs/engine-port.md.
- Verifier's fix: Two parts, TypeScript only. No engine or vendor/ rebuild is needed.

(a) Single instance. In src/state/controller.ts add:

holdTabLock(): Promise<boolean> { if (!navigator.locks) return Promise.resolve(false); return new Promise(r => void navigator.locks.request('celari-wallet', { ifAvailable: true }, l => { r(l !== null); return l ? new Promise<never>(() => {}) : undefined; })); }

Call it at the start of createWallet() and of the non-soft unlock() path, before anything is decrypted or written. If it is refused, throw a new OtherTabError, and show "Celari is already open in another tab or window. Close it, then try again." on Unlock and on the create/restore password step. Taking the lock there rather than in boot() means a forgotten tab on the lock screen does not block a new one. A soft-locked tab still holds the lock, which is correct because it still writes.

I checked that lock-by-reload still works: 25 of 25 reloads got the lock back with ifAvailable, and a second tab was refused (/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SPEND-5/specs/weblock.spec.ts).

(b) Write guard, atomic. Make storage.setDb(blob, salt) one readwrite transaction through the custom store: get('vault'), and put('db') only if vault?.kdf.salt === salt; return whether it wrote. Have persist() pass the salt of the vault this key came from (keep it next to this.key in createWallet and unlock) and return false when nothing was written. Compare the salt, not meta.createdAt/accountId as the finding proposes. Re-reading meta in a separate transaction leaves a race between the read and the write; the salt identifies the vault and changes on every wipe and restore.

Optionally, have saveWallet refuse when a 'vault' already exists, in the same transaction. That closes the Welcome-tab overwrite.

Add an e2e test with two pages in one context:
- the second page's unlock is refused;
- the first page still locks and unlocks;
- after a wipe in one tab, the other tab's persist writes nothing.

## Lens: platform

Coverage: Read: vite.config.ts, vite.webzjs.ts, index.html, public/_headers, dist/index.html and the dist asset list, package.json, package-lock.json (all resolved URLs are registry.npmjs.org, every entry has integrity; the only install scripts are esbuild and fsevents, both dev), .github/workflows/ci.yml in full, scripts/webzjs-vendor.sha256, the download and pin parts of scripts/build-webzjs.sh, README.md, docs/engine-port.md, patches/webzjs/README.md, engine/zcash_client_memory/UPSTREAM.md, src/main.tsx, src/engine/{index,webzjs,lightd,webzjs-upgrades}.ts, src/lib/{network,storage,clipboard,address}.ts, the QrCode component in src/components/ui.tsx and qrcode's SVG renderer (it embeds no input text), the Settings server and wipe UI, the controller's boot/create/unlock/persist/saveSettings code, the vendor worker snippets, and the playwright configs.

Ran: npm audit; git ls-remote for all four pinned actions (each SHA matches its tag); a comparison of vendor/ and the dist wasm files against the hash list (they match); a URL scan of the built JS and wasm (the only network host is the default lightwalletd); a scratch build showing the CSP silently dropped (PLAT-2); a Playwright check against vite preview that the page CSP is enforced and the worker scripts are served without a CSP (PLAT-3); a two-tab fake-engine Playwright repro of PLAT-1. All scratch files are under /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/platform. No tracked files were changed.

Checked, nothing to report: no dangerouslySetInnerHTML other than the QR, no window message listeners, no location or hash parsing, every form calls preventDefault, external links use rel=noopener, fonts are self-hosted and integrity-pinned, the fake engine is absent from dist, the CI permissions are contents: read with persist-credentials false, and actions are SHA-pinned.

Not re-reported (documented as deliberate): connect-src https:; cache-restore runs trusting the cache as much as the npm cache, where a poisoned tarball could even overwrite the list it is checked against; open-ended ZIP 320 checks; the server's privacy view.

Could not check: the real deployed host's headers (unknown host, so whether _headers, HSTS and X-Frame-Options actually apply there is unverified); a live malicious-lightwalletd test of forged notes (PLAT-4 rests on the light-client model, not a run); the worker-CSP gap only by response headers plus the CSP3 rule, since Playwright cannot evaluate inside the busy rayon workers.

The relayed user message '14.16 olmadı mı?' does not correspond to anything I could identify in this lens.

### PLAT-1 · major · ts — A second Celari tab replaces a stored wallet with no confirmation, and the first tab then overwrites the new wallet's database
- Where: src/state/controller.ts:219-231 (createWallet calls storage.saveWallet and never checks for an existing vault); src/lib/storage.ts:73-81 (saveWallet overwrites vault/meta/db and deletes db-legacy); src/state/controller.ts:708-717 (persist writes 'db' with whatever key this tab holds); src/main.tsx:17-28 (nothing makes the page the only instance)
- Scenario: Reproduced in Chromium with the fake engine, two tabs in one browser profile (scratch spec: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/platform/twotab/twotab.spec.ts). Tab B is opened while no wallet exists, so it shows Welcome. Welcome never locks and never reloads, so B can sit there for days. In tab A the user creates W1, which is then unlocked. Later the user goes back to B and creates or restores a wallet W2. saveWallet replaces W1's vault, meta and db without warning. The only stored copy of W1's encrypted seed is gone. The guarded path (Settings > Remove wallet) shows 'Without your recovery phrase, your funds will be lost for good' and requires typing DELETE; this path skips that guard. Tab A still holds W1's key. On its next persist (here, opening Receive; a soft lock or the end of a pass does the same) it writes W1's db, encrypted under W1's key, over W2's db. When B locks and unlocks with W2's password, the vault opens but decryptDb fails, and the lock screen shows: 'Celari could not read this wallet's saved data, so it changed nothing; your funds are safe...'. Now neither wallet opens in this browser. Recovery needs both recovery phrases, a wipe, a restore and a full rescan. Smaller variant: two unlocked tabs of the same wallet overwrite each other's db (lost updates). A send made in one tab disappears from the other tab's saved state until the transaction is mined.
- Impact: A stale tab silently deletes a funded wallet's encrypted seed from the browser, bypassing the typed-DELETE warning. The funds are lost if the phrase backup is gone. The replacement wallet is left unopenable until it is restored from its phrase and rescanned, which can take hours. Funds are unspendable from Celari in the meantime.
- Proposed fix: (1) Make the page the only instance. In src/main.tsx, before creating the controller: `const owns = await new Promise<boolean>((resolve) => navigator.locks.request('celari-wallet', { ifAvailable: true }, (lock) => { resolve(lock !== null); return lock ? new Promise<never>(() => {}) : undefined; }));`. If `owns` is false, show 'Celari is already open in another tab' and do not call controller.boot() or load the engine. (2) Defence in depth: in createWallet, just before saveWallet, `if (await storage.getVault()) throw new Error('a wallet already exists in this browser')`. Better still, do the check inside writeAll's transaction with s.get('vault') and abort if it exists. Then route the stale tab to a reload, which shows the lock screen. In persist(), skip setDb when the stored vault's kdf.salt differs from the salt of the record this key was unlocked from.
- Verified: **real, major**; fix before NU7: yes
- Verifier's evidence: I reproduced this in Chromium with the fake engine, using the real controller and storage, two tabs in one profile. Spec: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-PLAT-1/plat1.spec.ts. It passes, and it asserts the IndexedDB contents at each step:
1. Tab B opens on Welcome. Tab A creates W1 with password PW1. Vault salt is OuM7….
2. Tab B, never reloaded, creates W2 with PW2. The vault salt becomes UWpX…, so W1's encrypted seed is gone. No dialog or warning appeared (0 dialogs). The typed-DELETE wipe guard is skipped.
3. Tab A opens Receive. The db hash changes (cf9e…→ae93…) while the vault stays W2's. Tab A wrote W1's database, under W1's key, over W2's.
4. Tab B: Lock, then unlock with PW2. It shows "Celari could not read this wallet's saved data…".
5. Tab A: Lock, then unlock with PW1. It shows "Wrong password." Neither wallet opens in this browser any more.

Code path, confirmed end to end:
- src/state/controller.ts:219-236: createWallet calls storage.saveWallet at :231 with no check for an existing wallet.
- boot() reads storage once (:195-199). The Welcome/Onboarding phase never re-reads it, and useAutoLock (App.tsx) runs only in 'ready'.
- src/lib/storage.ts:73-81: saveWallet puts vault, meta and db unconditionally.
- persist() (controller.ts:708-721) writes 'db' with this tab's key. Its only guard is a key change inside this tab (:715).
- main.tsx:17-28 has no single-instance guard, and there is no navigator.locks or BroadcastChannel anywhere in src/.

NEW, worse variant: same password for both wallets (samepw.spec.ts, passes). Tab A still shows W1's balance and addresses. Its "Show recovery phrase" reveals W2's 24 words, because revealSecret (:426-432) re-reads storage.getVault() at :429. A user who re-backs-up from tab A writes down the wrong phrase, and W1's funds (including new deposits to tab A's addresses) are lost when the tab closes. A send from tab A only fails: the fake engine throws 'seed does not match account', and the real engine signs with a seed fingerprint. No wrong transaction is broadcast.

Overlap: the root cause, no single-instance guard, is the same as VAULT-2 and SPEND-5 in docs/reviews/2026-10-pre-nu7-core-review.md. What PLAT-1 adds is that no wipe is needed: createWallet itself replaces a wallet without warning. The real engine keeps its in-memory database per tab and shares only IndexedDB, so it behaves the same way.

Severity: major fits. It takes an unusual user action, but it bypasses the guard and can lead to loss of funds if the phrase backup is gone. This is not related to NU7.
- Verifier's fix: Three small TypeScript-only changes. None touches the engine, the wasm or the hash list.

(1) Single instance (shared with VAULT-2 and SPEND-5). At the start of boot(), or in main.tsx before boot, hold a Web Lock for the life of the page: `navigator.locks.request('celari-wallet', {signal: AbortSignal.timeout(3000)}, () => new Promise<never>(() => {}))`. Resolve "owned" when the callback runs. On AbortError, go to bootError 'other-tab' ("Celari is already open in another tab"), and never load the engine or unlock. I checked that the lock-and-reload path gets the lock back: 50/50 reloads in each of Chromium, Firefox and WebKit, both with ifAvailable and with in-page location.reload() (locks.spec.ts in the same scratch folder). The bounded wait instead of ifAvailable is a cheap margin for slow unloads. Safari 15.2-15.3 has crossOriginIsolated but no Web Locks: either fail closed there, or rely on (2) and (3).

(2) Make saveWallet conditional, in its own readwrite transaction: `s.get('vault')` and `s.get('meta')`. If both exist (the same condition boot() uses for 'locked'), call `s.transaction.abort()`. Otherwise do the puts and the db-legacy delete. In createWallet, map the abort to a "a wallet was added in another tab" error and reload the page, which shows the lock screen. This leaves the normal path unchanged.

(3) Keep the vault salt this tab unlocked or created (`this.vaultSalt = record.kdf.salt`). In persist(), before setDb, re-read the vault. If `stored?.kdf.salt !== this.vaultSalt`, set the key to null, call reloadLocked() and return false. In revealSecret(), refuse in the same case, so a stale tab can never show another wallet's phrase. Ideally do the persist check and put in one transaction.

### PLAT-2 · minor · ts — The production CSP is added by an exact string replace that silently does nothing when index.html changes
- Where: vite.config.ts:30-41 (line 35: html.replace('<meta charset="UTF-8" />', ...)); no test checks that dist/index.html has the policy (tests/e2e-real/mainnet.spec.ts, tests/unit/*)
- Scenario: Reproduced. I copied the app to /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/platform/cspdemo and changed only the charset tag in index.html to `<meta charset="utf-8">`, a formatter or editor rewrite. `vite build` exits 0, and the built index.html contains no Content-Security-Policy (grep count 0). The real-engine smoke test would still pass, because nothing asserts the policy. A cosmetic edit therefore ships a build with no script-src, connect-src, object-src, base-uri or form-action restrictions. With the policy present, I checked that inline scripts and string evals are refused (CSP violation messages in the console).
- Impact: Defence in depth for a page that holds the decrypted seed during a spend. A trivial edit can remove it unnoticed.
- Proposed fix: Fail the build when the injection does not happen: `if (!html.includes(CHARSET)) this.error('cspPlugin: <meta charset> not found')`. Or return a tag descriptor from transformIndexHtml (`{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }`). Also add a check that dist/index.html contains the policy, e.g. in the real e2e: `expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("default-src 'self'")`.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I reproduced this on my own under /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-PLAT-2. Each variant got a copy of index.html, vite.config.ts, vite.webzjs.ts, src and public, with node_modules and vendor symlinked. No tracked files were changed.
- base (unchanged index.html): `vite build` exits 0 and dist/index.html has 1 CSP meta.
- lower (`<meta charset="utf-8">`): exits 0, CSP count 0.
- attr (`<meta charset="UTF-8">`, only the ` /` dropped): exits 0, CSP count 0.

Cause: vite.config.ts:34-38 does `html.replace('<meta charset="UTF-8" />', ...)`, and String.replace does nothing when the string is absent. Nothing else catches it:
- No test or CI step looks for the policy. grep over tests/, both playwright configs and ci.yml finds no CSP assertion.
- The real e2e (playwright.real.config.ts, vite preview) does not check it.
- The fake e2e runs on the dev server, where the plugin is off (`apply: 'build'`).
- public/_headers sends no CSP header, so nothing backs up a missing meta tag.

How far this goes:
- The current build and dist/index.html do have the policy.
- index.html has been edited 4 times since the first commit (ec1645a, 3967db3, efa2437, 917deaf, bcc7b51) and the charset line was never touched.
- The repo has no HTML formatter (no prettier/biome/editorconfig), so the "formatter rewrite" trigger is only hypothetical.
- So this is a latent fragility in a defence-in-depth control. Users and funds are not affected today.

A mistake in the reviewer's proposed fix: `this.error(...)` cannot be used here. Vite 6 types the hook as `(this: void, html, ctx)` (node_modules/vite/dist/node/index.d.ts:3188), and tsconfig.json includes vite.config.ts, so `npm run build` (tsc --noEmit) would reject it. A plain `throw` does work: the fixB-lower variant fails the build with exit 1 and the message `[vite:build-html] celari-csp: ... not found`.

I also checked the tag-descriptor alternative (`injectTo: 'head-prepend'`). It adds the CSP whatever the charset spelling (fixA-lower: count 1). But it changes the output: the meta lands before `<meta charset>`, and the quotes are entity-escaped (&#39;). That is valid HTML, but it is a larger change to what ships.

The relayed user line '14.16 olmadı mı?' does not relate to anything in this finding.
- Verifier's fix: Smallest safe fix: keep the current replace, so the built output stays byte-identical, and make the build fail when the replace does nothing. In vite.config.ts cspPlugin:

```ts
transformIndexHtml(html) {
  const out = html.replace(
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
  );
  if (out === html) throw new Error('celari-csp: <meta charset="UTF-8" /> not found in index.html; the CSP was not added');
  return out;
},
```

Use `throw`, not `this.error`, because the hook's `this` is void. Verified in scratch: with an edited charset the build exits 1 with this message; with the current index.html it builds normally with the CSP.

Optional second check: add a CI step after "Production build" in .github/workflows/ci.yml: `grep -qF "http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'" dist/index.html`. Or assert the meta's content in tests/e2e-real/mainnet.spec.ts.

The tag-descriptor approach (`injectTo: 'head-prepend'`) also works. But it moves the meta and escapes the quotes, so it is a bigger change than this needs.

### PLAT-3 · minor · ts — public/_headers sends no CSP header (workers and framing are not covered) and no HSTS
- Where: public/_headers:2-7; vite.config.ts:10-13 and 71-72 (preview headers)
- Scenario: The CSP exists only as a <meta> tag. Under CSP3, a dedicated worker loaded from a same-origin URL takes its policy from that script's response headers, not from the page. In vite preview I confirmed that the WebZjs worker scripts (workerHelpers-*.js, and the wasm_thread sync worker that makes the gRPC-web fetches) are served with only COOP/COEP. The deployed _headers adds no CSP either, so every engine worker runs with no CSP at all: no connect-src, no eval restriction. frame-ancestors cannot be set from a <meta>, so framing protection rests only on X-Frame-Options. There is no Strict-Transport-Security line. On the custom domain planned in the README roadmap (celariwallet.com), a first visit typed as http:// on a hostile network can be SSL-stripped, and injected script reads the seed at the next unlock or spend, unless the host adds HSTS itself.
- Impact: Defence in depth: the code that runs the wallet engine has no CSP, and transport protection depends on host defaults that the repository does not state.
- Proposed fix: Add to public/_headers under `/*`: `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`. Keep the <meta> for hosts that ignore _headers. Ideally generate both from the one CSP constant in vite.config.ts at build time so they cannot drift.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I reproduced part of this finding. The rest is wrong or does not apply to the deployment that holds the funds.

1) Workers run with no CSP. Confirmed. The engine starts its workers from same-origin URLs: dist/assets/webzjs-*.js calls `new Worker(new URL("/assets/workerHelpers-*.js"))` and `new Worker(new URL("/assets/web_worker_module.bundler-*.js"), {name:"wasm_thread"})`. Under CSP3 such a worker takes its policy from its own response headers, and public/_headers:2-7 has no CSP line.
- Setup: a scratch static server that sends exactly the _headers set (verify-PLAT-3/server.mjs) and a same-origin probe worker, run in Chromium with Playwright (probe.mjs).
- Result: workerHelpers-*.js is served with no CSP. On the page, `new Function` is blocked (EvalError) and a cross-origin `import()` is refused. Inside the probe worker, `new Function`, indirect eval and `import('https://cdn.jsdelivr.net/...')` all run.
- With the proposed CSP header added (MODE=csp), all three are blocked inside the worker too.

2) The fix does not break the engine. `tests/e2e-real/mainnet.spec.ts` passed with the proposed CSP header on every response (wasm, rayon pool, wasm_thread gRPC-web fetches, sync from tip, lock/unlock). Log: verify-PLAT-3/e2e-csp.log.

3) No path to exploit the worker gap was shown, so this is defence in depth only.
- Workers have no DOM and run only bundled same-origin code.
- Data from lightwalletd goes into wasm as bytes and is never evaluated as JS.
- eval is removed at build time (vite.webzjs.ts webzjsNoEval, plus a check over every output chunk).
- connect-src is already `https:`, and mixed-content blocking stops http from an https worker anyway.

4) The framing part is not a gap. X-Frame-Options: DENY is in public/_headers:7 and in vercel.json on vercel-preview, and every current browser honours it. A host that ignored the header file would also drop COOP/COEP, and the app then refuses to boot (src/state/controller.ts:183, `crossOriginIsolated` check).

5) The HSTS scenario is wrong as written.
- An http:// page is a different origin from https://. It cannot read the https origin's IndexedDB vault.
- It is not a secure context: COOP/COEP are ignored, the boot check fails and crypto.subtle is missing. So "injected script reads the seed at the next unlock or spend" cannot happen. What is left is a phishing page that asks the user to restore from their words.
- A plain HSTS header (no `preload`) does not protect a first visit anyway. It only protects visits after the first https one.
- Every host in use today is already preloaded. The funded deployment is on Vercel (vercel-preview branch, vercel.json). hstspreload.org answers `vercel.app: preloaded via "app"`. netlify.app (.app) and pages.dev (.dev) are TLD-preloaded too, and Vercel's own sites send `max-age=31536000; includeSubDomains; preload`.
- HSTS only matters for the future custom domain celariwallet.com (README:135, not yet migrated).

6) public/_headers is not read by Vercel at all, so the proposed edit would not change the deployment that holds the funds.

No tracked files were changed. All scratch files are under /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-PLAT-3. The relayed line "14.16 olmadı mı?" contains no instruction this verification can act on.
- Verifier's fix: Minimal and safe:
(a) public/_headers, under `/*`: add the same policy as the vite.config.ts CSP constant plus `frame-ancestors 'none'`. That is `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Keep the <meta> tag.
(b) vite.config.ts:72: change to `preview: { headers: { ...isolationHeaders, 'Content-Security-Policy': CSP + "; frame-ancestors 'none'" } }`. This lets `npm run test:e2e:real` run the engine workers under the header CSP. Leave `server` (dev) alone, because React refresh needs inline scripts.
(c) Add a unit test that the CSP line in public/_headers equals the CSP constant plus frame-ancestors, so the two cannot drift.
(d) HSTS: add `Strict-Transport-Security: max-age=63072000` only when the celariwallet.com move happens. Add `includeSubDomains` and `preload` (with a preload submission) only when every subdomain is https. Preload is the only thing that covers a first visit. On vercel.app, netlify.app and pages.dev it changes nothing.
(e) For the Vercel deployment, the same CSP entry must go into vercel.json on the deployment branch. That is the owner's call: this review must not touch Vercel.
The scratch mainnet e2e run with exactly this header passed.

### PLAT-4 · minor · docs — Changing the lightwalletd server is one click, and the UI never says that server decides what Celari believes about the chain
- Where: src/i18n/en.ts:357-358 and src/i18n/tr.ts:357-358 (settings.serverHelp); src/screens/Settings.tsx:440-446 ('Save and restart' with no confirmation); README.md:68
- Scenario: A scammer in an OTC trade or a support chat says 'use my faster server' and gives https://evil.example. The user saves it. That server serves compact blocks containing an Orchard/Ironwood output encrypted to the user's own address, which the user gave the scammer. Anyone can encrypt to an address, and the server also supplies the tree state. Celari trial-decrypts the output and shows the amount as received, then spendable after the one confirmation the server reports. The scammer collects the goods. The same server can also withhold blocks so a real payment never appears, or drop the user's broadcasts. The help text and README list only what the server can see (IP, t-addresses, broadcasts, own transactions). They say nothing about what it can fake or hide.
- Impact: A wrong balance can be shown to a user who was persuaded to switch servers. This is inherent to the light-client model, but users are not told about it while the app makes the switch a single click.
- Proposed fix: Add a sentence to settings.serverHelp (en and tr) and README §'Nasıl çalışır' / English: 'The server also decides which blocks Celari sees: a dishonest server can show payments that never happened, hide real ones or not relay what you send. Only use a server you trust, and check large incoming payments on a second server or an explorer.' When saving a URL other than DEFAULT_SERVER, show that sentence in a confirm step before saving and reloading.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I tried to refute the finding and could not. It holds as a disclosure and UX gap. It is not a code defect: the risk comes with the light-client model, and nothing in the repo deals with it or explains it to users.

1. **The server controls what chain the wallet sees.** `.webzjs/crates/webzjs-wallet/src/wallet.rs:281-299` (`sync`) calls upstream `zcash_client_backend::sync::run` against `self.client`, which points at the configured URL. The only checks upstream makes are in `zcash_client_backend-0.25.0/src/scanning.rs:738-751`:
   - `PrevHashMismatch`
   - `BlockHeightDiscontinuity`
   - `TreeSizeMismatch`

   All three compare server-supplied data with other server-supplied data. There is no header, Equihash or proof-of-work check anywhere in the engine (a grep of `.webzjs/crates` found none). Tree state and subtree roots also come from the same server, and the app never cross-checks with a second source. `chainFloor` in `src/engine/webzjs-upgrades.ts` is only a height floor.

2. **Fabricated blocks become spendable funds.** Upstream's backend-independent suite runs against Celari's backend and passes (`docs/engine-port.md:440`, 198 passed). For example, `send_single_step_proposed_transfer` (`zcash_client_backend-0.25.0/src/data_api/testing/pool.rs:295-334`) does this:
   - `add_a_single_note_checking_balance` makes up a compact block with no proof of work, holding a note to the wallet;
   - the scan accepts it and the balance goes up;
   - `propose_transfer(..., ConfirmationsPolicy::MIN)` spends it.

   In Celari a note is spendable after 1 confirmation (`src/engine/webzjs.ts:46-47`), but a fake server could just as easily make up 10 blocks. Anyone can encrypt a note to a known address, so the scenario works as written.

3. **Switching servers takes one click.** In `src/screens/Settings.tsx:438-446`, "Save and restart" calls `controller.saveSettings({...serverUrl}, {restart: true})` straight away. In `src/state/controller.ts:494-498`, that stores the setting and calls `location.reload()`. The wallet database stays, so the new server carries on from the wallet's current tip. Only `isHttpsUrl` is checked, and there is no confirm step.

4. **The copy covers privacy only.** These texts list what the server can see, and nothing about what it can fake, hide or drop:
   - `settings.serverHelp`: `src/i18n/en.ts:357` and `src/i18n/tr.ts:357`;
   - `home.serverSees` and `home.serverSeesHistory`: `en.ts:179-182`;
   - `README.md:68` (Turkish) and `README.md:158` (English).

   `docs/engine-port.md` says nothing about this either. `README.md:128` only lists "kötü niyetli lightwalletd cevapları" as a review still to do, so this is not a documented, deliberate decision.

5. **The app itself tells users to switch, which the finding did not mention.** `network.serverBehind` (`en.ts:142`, `tr.ts:143`) says "The server Celari uses is behind the Zcash network. Choose another server in Settings." It gives no hint about trust. `tests/unit/nu7-guard.test.ts:89-99` shows the banner appears for the 6 blocks before NU7 when a server sends no upgrade fields. That is the window when "use my server" advice is most likely to circulate. With the default server, which announces NU7 as captured, it should not fire.

**Impact:** no keys are exposed and no funds can be stolen through the wallet. A spend of a fake note uses a fake anchor, so the real network would reject it. The harm needs social engineering: a user persuaded to switch can be shown a payment that never happened (and hand over goods in an OTC trade), have real payments hidden, or have their sends silently dropped. "Minor" is the right severity.
- Verifier's fix: A copy-only change, with no engine or state change:

1. **Settings help text.** Append to `settings.serverHelp` in `src/i18n/en.ts:357`: "The server also decides which blocks Celari sees: a dishonest server can show payments that never happened, hide real ones, or not pass on what you send. Use only a server you trust, and check a large incoming payment on another server or a block explorer before you rely on it." Add the same sentence in Turkish to `src/i18n/tr.ts:357`.

2. **The "server behind" banner.** In `network.serverBehind` (`en.ts:142`, `tr.ts:143`), change "Choose another server in Settings." to "Choose another server you trust in Settings." That way the app's own nudge carries the caveat.

3. **README.** Add the same sentence to the "Nasıl çalışır?" bullet at `README.md:68` and to the English paragraph at `README.md:158`.

4. **Optional confirm step.** When `server.trim() !== DEFAULT_SERVER`, have the Save button in `src/screens/Settings.tsx:438-446` show the sentence from step 1 and a second "Save and restart" before it calls `controller.saveSettings(..., { restart: true })`.

Steps 1-3 change only text. No test asserts these strings; the only matches for these keys under `tests/` are `data-network` attribute checks. Step 4 touches UI code and a fake-engine e2e test, so it can wait.

### PLAT-5 · polish · ci — vite is pinned at 6.4.4, which has an npm advisory, and CI never checks npm advisories
- Where: package.json:39 ("vite": "6.4.4"); .github/workflows/ci.yml:36 and 326 (npm ci; no audit step); compare the engine-audit job at ci.yml:53-66
- Scenario: `npm audit` reports GHSA-8g5g-mxqh-grgj, 'Vite: server.fs.deny bypassed with queries', vulnerable exactly =6.4.4, fixed in 6.4.5 (published 2026-10-21). The bug is in the dev server only, so the production bundle is unaffected. It matters when `npm run dev` (which the README suggests for running the real engine) is reachable from the network, e.g. with --host. CI runs cargo-deny against a fresh RustSec database for the engine, but nothing similar for the 42 npm packages that ship to the browser (including @scure/bip39, which generates seeds), so an advisory there would go unnoticed the same way.
- Impact: Dev-only file disclosure today. More generally, browser dependencies have no advisory monitoring.
- Proposed fix: Pin "vite": "6.4.5" and run `npm install` to refresh package-lock.json. Add an `npm audit --omit=dev --audit-level=low` step after `npm ci` in the app job (and optionally a full `npm audit` as a warning).
- Verified: (polish: not verified)

## Lens: enginespend

Coverage: Read: docs/engine-port.md (all decisions and the deferred list), engine/zcash_client_memory/UPSTREAM.md, patches/webzjs/README.md, the Celari engine adapter (src/engine/webzjs.ts, webzjs-errors.ts, types.ts), the send path in src/state/controller.ts, and src/screens/Send.tsx and SpendSteps.tsx as they bear on the spend path.

Built the patched WebZjs tree exactly as build-webzjs.sh does, in a scratch dir: pinned commit a50df944 + 0001-0004 + engine/webzjs.Cargo.lock. Then I read the patched glue in full: wallet.rs, boundary.rs, runtime.rs, error.rs, bindgen/wallet.rs, the pczt_sign and GetStatus paths, and the NU7 tests.

In the backend I read input_source.rs (note selection, confirmations, anchors), the spent/expiry predicates (types/transaction.rs, db_ops.rs) and the anchor and checkpoint queries (queries.rs). In upstream zcash_client_backend 0.25 I read GreedyInputSelector::propose_transaction and pool preference, propose_transfer's ZIP 318 canonical-crossing path, create_pczt_from_proposal (multi-step refusal), select_change_pool and split_count. In zcash_protocol 0.11 I read the zip318 expiry and anchor-grid code, which gives the NU7 block-spacing ratio of 3.

Ran the full glue native suite with pinned nightly-2026-10-28 and --locked: 72 passed, 0 failed, i.e. the 68 existing tests plus 4 scratch tests I added. Scratch copy: /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/enginespend/webzjs/crates/webzjs-wallet/src/tests/nu7_pipeline.rs (tests review_*). They reproduce ES-1 through ES-5: canonical crossing expiry plus failed broadcast, TEX, Sapling-funded u1 payment, and Orchard change pool and fee. No tracked file was modified.

Checked and found sound: the NU7 boundary rules (10-block pause plus activation block, tip re-read under the DB lock, branch and expiry checks before storing). A sync between catch_up_before_building and the proposal is caught again by pczt_send. Default SpendPolicy never spends transparent funds, and no change ever goes to a transparent address. Memo handling, ZIP 321 memo-recipient check and recipient/amount plumbing are correct. Orchard circuit selection follows the branch, and proofs are verified before storing.

Not done: the backend native suite (~15 min) and npm run test:e2e:real. No mainnet broadcast. I did not check whether Zebra or zcashd scale the tx-expiring-soon threshold after NU7. The anchor-retention correctness for bucketed anchors rests on the upstream tests the backend already runs. I did not re-report the documented residual risk of a pre-NU7 transaction left unmined at activation; ES-1 adds that for canonical crossings this means weeks, not minutes.

The relayed user request ('14.16 olmadı mı?') had no actionable content beyond the computed task.

### ES-1 · major · engine — A stored but unbroadcast send is never rebroadcast. For an ordinary round-amount send from Orchard (a ZIP 318 canonical crossing) the note stays locked for weeks.
- Where: pczt_send stores the transaction, then broadcasts it once: patches/webzjs/0004-ironwood-nu7.patch:6688-6699 (.webzjs/crates/webzjs-wallet/src/wallet.rs:1017-1028). GetStatus with no answer only records TxidNotRecognized and never resends: 0004:1826 (data_requests.rs:389). The app never calls send_authorized_transactions: src/engine/webzjs.ts:350. The long expiry comes from upstream zcash_client_backend 0.25 data_api/wallet.rs:2002-2016 (zip318::expiry_height for canonical crossings).
- Scenario: Reproduced natively: scratch test review_canonical_crossing_expiry_and_failed_broadcast, appended to the scratch copy of tests/nu7_pipeline.rs, mainnet params, wallet tip 3,540,400. The wallet holds an existing user's Orchard note of 1.05 ZEC and the user sends 1 ZEC to a u1 address. Because 1 ZEC is a canonical denomination and one Orchard note covers it, upstream builds a canonical crossing: the PCZT has branch 0x37a5165b and expiry 3,594,240, 53,839 blocks ahead (an ordinary send gets +40). SendTransaction then fails with UNAVAILABLE (proxy or lightwalletd hiccup; a node refusal or a later mempool drop such as a backend restart has the same effect). pczt_send returns the gRPC error but the transaction is already stored. Measured results: Orchard spendable 105,000,000 -> 0, total balance 4,985,000. 2,000 blocks later, after a full sync with the server healthy again, spendable is still 0. A new 0.5 ZEC send fails with InsufficientFunds { available: 0 }. The app shows 'may have reached the network anyway', and History shows a pending send that will never be mined. Nothing in the engine or the app rebroadcasts. The GetStatus answer only sets confirmed_unmined_at, and the note counts as spent until the expiry: 3,004 blocks at 75 s plus 50,835 blocks at 25 s after NU7, about 17 days. A crossing built after NU7 uses a 103,680-block modulus, giving 35 to 70 days. Meanwhile the server is asked about this txid every 5 minutes.
- Impact: Funds are stuck and shown as gone for weeks after a transient broadcast failure, a node refusal or a mempool eviction. This hits exactly the existing users with Orchard funds sending common round amounts (0.1, 0.5, 1, 2 ZEC...). For ordinary sends the lock is 40 to 120 blocks, but it still needs a manual wait and is not explained. No loss: the funds come back at expiry.
- Proposed fix: Rebroadcast what the wallet itself stored. In data_requests::serve_one, GetStatus branch, when get_transaction returns None and the tx_table entry has raw bytes, mined_height is None, expiry_height > chain_tip + EXPIRING_SOON_THRESHOLD and its branch is BranchId::for_height(chain_tip + 1): call source.send_transaction(RawTransaction { data: raw, .. }) before recording TxidNotRecognized. Add send_transaction to TxDataSource. Also retry send_transaction 2-3 times on transport errors inside pczt_send before returning. In the app, extend 'send.maybeSent' to say the funds stay reserved until the transaction expires (expose the expiry height).
- Verified: **real, major**; fix before NU7: yes
- Verifier's evidence: The finding holds: I reproduced it natively and could not refute it. Two parts of the write-up are wrong, though, and one of them breaks the proposed fix.

Setup: a fresh WebZjs a50df944 with the committed patches 0001-0004 applied, a copy of engine/, nightly-2026-10-28, --locked. Scratch tests verify_es1_* are in /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-ES-1/webzjs/crates/webzjs-wallet/src/tests/nu7_pipeline.rs, logs in run2.log and run3.log there. All 5 pass.

Code path:
- pczt_send (patched wallet.rs:996-1029) stores the transaction through extract_and_store_minable_pczt, then calls send_authorized_transactions once, with no retry.
- The app maps any error to "maybe sent" (src/engine/webzjs.ts:350). controller.ts:828 then persists the stored transaction (afterSpend), so it survives a reload.
- Nothing in src/ calls send_authorized_transactions.
- A note counts as spent while its spending transaction is unmined and its expiry is at or above the target height (engine/zcash_client_memory/src/types/transaction.rs:137-155, is_mined_or_unexpired_for).
- Canonical crossings get the ZIP 318 rolling expiry: zcash_client_backend 0.25 data_api/wallet.rs:2002-2016 and zcash_protocol 0.11 zip318.rs:195-212.

Measured:
- (a) One 1.05 ZEC Orchard note, 1 ZEC to a u1, tip 3,540,400. The PCZT has branch 0x37a5165b and expiry 3,594,240 (+53,839). SendTransaction fails with UNAVAILABLE and pczt_send returns Err, but the transaction is stored. Orchard spendable goes from 105,000,000 to 0; total is 4,985,000. I then ran 5 full sync passes up to 3,542,400 with the server healthy. SendTransaction was still called only once, the node received 0 transactions, spendable stayed 0, and a new 0.5 ZEC send fails with InsufficientFunds { available: 0, required: 50,010,000 }.
- (b) Same send, accepted by SendTransaction and then never mined (mempool drop): it is never sent again and the note stays locked.
- (c) Control, 0.123 ZEC (not a canonical amount): expiry +40, and the note is spendable again at 3,540,441.
- (e) Wallet with 4 x 0.3 ZEC plus 3 ZEC in Orchard. 1 ZEC is paid from the 3 ZEC note as a crossing (expiry 3,594,240). After the failed broadcast the whole 3 ZEC note is locked; spendable is 1.2 ZEC.
- (d) Wallet holding only one 3 ZEC note: every amount, including 1 and 2 ZEC, gets +40, because the change is split into several notes and the send is not a crossing.

Corrections to the finding:
1. No GetStatus request exists for these sends. Upstream queues a status check only for a transaction that compact-block scanning cannot see (ll/wallet.rs:1150-1157; sqlite wallet.rs:4017-4024), and a shielded spend can be seen. In (a), GetTransaction was called 0 times for that txid over 5 passes, and in (e) transaction_data_requests() has no GetStatus for it. So the server is not asked "every 5 minutes", and a rebroadcast placed in serve_one's GetStatus branch would never run in this case.
2. A crossing needs more than a round amount (Step::is_canonical_crossing, proposal.rs:1128-1160). It needs exactly one Orchard input, a single Ironwood payment of a canonical amount, at most one Orchard change output, an anchor on the ZIP 318 grid, and the standard fee. With Celari's split policy (4 notes, 0.1 ZEC minimum), one change output means the wallet already holds 4 or more notes, or the change is under about 0.2 ZEC. Many users with Orchard funds still meet this, as (a) and (e) show.
3. After NU7 the lock is 30 to 60 days, not 35 to 70: 103,680 to 207,360 blocks at 25 s. Example: a crossing built at 3,543,500 expires at 3,732,480, 188,980 blocks (about 55 days) later. Before NU7, the 17-day figure is right.

The existing JS binding send_authorized_transactions resends the exact stored bytes. In (e) it returned Ok and the node received a transaction with the same txid. So the app can fix this without rebuilding the wasm.

Not rescued by any rebroadcast: a transaction built before NU7 and still unmined at activation has the wrong branch. This is the documented Decision 7 residual risk; for a crossing it lasts until the ZIP 318 expiry.
- Verifier's fix: Rebroadcast what the wallet stored, independently of GetStatus. GetStatus never runs for shielded sends, so do not put the rebroadcast in serve_one.

Minimal fix before NU7, app only (no wasm rebuild, no change to the pinned hashes):
1. Add WebzjsEngine.rebroadcastPending(account).
   - From history(account, ...), take the entries with status 'pending' and valueZats < 0 (the wallet's own unmined sends).
   - For each one, at most once every 5 minutes, call this.open_.send_authorized_transactions(bytes).
   - bytes is the History txid hex decoded and then byte-reversed: TxId::to_string is display order, and TxId::from_bytes expects internal order.
   - Catch and ignore every error: TransactionNotFound for entries with no raw bytes, and node refusals such as "already in mempool" or a wrong branch.
2. Call it from controller.syncLoop after a successful pass and persist(), never while eng.sync() runs (it takes db.read()).
   - Do not await it inside the loop.
   - Give it a timeout (the fetch transport has none).
   - Also run it right after a spend that failed at the 'broadcasting' stage.
3. Change 'send.maybeSent' in en.ts and tr.ts. It currently suggests checking and retrying, which becomes a double payment once the wallet resends by itself. New text: "The payment is saved and Celari keeps sending it until it confirms. Do not pay again. If it never confirms, the funds come back after block {expiry}." Expose the expiry height for this.

Later, with the next engine rebuild:
- In sync_pass, after serving the data requests, resend each tx_table entry that has raw bytes, is not mined, has expiry 0 or above tip+3, and whose stored branch equals BranchId::for_height(tip+1). Use the same 5-minute throttle and only count errors.
- Retry send_transaction 2-3 times with backoff inside pczt_send on Unavailable, Unknown or DeadlineExceeded.
- Add a native test like verify_es1_canonical_crossing_transport_failure that asserts SendTransaction is called again and the note is spent by the mined transaction.

### ES-2 · major · ts — A payment to a u1 that the engine funds from Sapling publishes the whole Sapling input, but Send labels it 'Shielded'
- Where: pczt_create proposes with SpendPolicy::default() (Sapling + Orchard + Ironwood): patches/webzjs/0004-ironwood-nu7.patch:6548 (.webzjs/crates/webzjs-wallet/src/wallet.rs:883). src/screens/Send.tsx:111-118 (recipientOf: an Orchard receiver gives 'shielded', on the assumption 'the pool the funds are in' is Ironwood). src/i18n/en.ts:152 and :295. Home has a notice for an Orchard balance (Home.tsx:272) but none for a Sapling balance.
- Scenario: Reproduced natively: scratch test review_sapling_funds_to_orchard_receiver. The wallet holds 0.3 ZEC in Ironwood and 1 ZEC in Sapling; Sapling notes arrive when a Sapling-only sender pays the Sapling receiver that both Celari addresses carry, or after a restore of an older seed. The user pays 0.5 ZEC to a u1 with an Orchard receiver, and the Send screen shows 'Shielded payment'. Upstream pool preference is Ironwood, Orchard, Sapling, and the first pool that covers the payment alone is Sapling. The PCZT spends the Sapling note, sends the change to Ironwood, and the Sapling value balance is +100,000,000: the full 1 ZEC note value is public on chain. Sapling is used whenever neither Ironwood nor Orchard alone covers amount + fee. A 0.2 ZEC payment from the same wallet has no Sapling bundle.
- Impact: Privacy leak beyond what the app tells users. The app's own wording calls such a pool crossing 'Partly shielded ... the amount ... can be seen on chain', and Home says 'Amounts and parties are hidden on chain'. Here the exact note value leaves Sapling publicly while the confirm screen says Shielded.
- Proposed fix: App side (smallest change): in recipientOf/outcomeKey, return privacy 'partial' with a dedicated message ('funds from the older Sapling pool cross into Ironwood; that amount is visible') when the recipient has an Orchard receiver, summary.balances.sapling > 0, and balances.ironwood < zats + fee and balances.orchard < zats + fee (the condition under which the greedy selector reaches Sapling). Engine alternative: for Orchard-receiver payments call propose_transfer with SpendPolicy::shielded_pools([Orchard, Ironwood]) and return a distinct error, so the app can ask before allowing a Sapling crossing.
- Verified: **real, major**; fix before NU7: yes
- Verifier's evidence: I tried to refute this and could not. I reproduced it on my own copy: WebZjs a50df944 with patches 0001-0004 applied fresh, plus engine/ and the shipped lockfile. My scratch test is verify_es2_sapling_crossing, appended to /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-ES-2/webzjs/crates/webzjs-wallet/src/tests/nu7_pipeline.rs, and its output is in /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-ES-2/run.log. The recipient is a Celari-like shielded-only u1 with Orchard and Sapling receivers. Every case goes through the real Wallet::pczt_create on mainnet parameters at NU6.3 heights.

Results, as (Sapling, Orchard, Ironwood) balances, payment, then what the PCZT does:
- (1.0, 0, 0.3), pay 0.5: spends 1 Sapling note with 2 dummy outputs. Sapling value_balance is +100,000,000 (the whole 1 ZEC is public). Ironwood value_balance is -99,970,000. Fee 30,000.
- (1.0, 0, 0.3), pay 0.2 (control): no Sapling bundle, Ironwood only.
- (1.0, 0.3, 0.3), pay 0.5: Sapling alone is chosen, +1 ZEC public, even though Ironwood and Orchard together would cover the payment.
- (0.1, 0.3, 0.3), pay 0.5: no Sapling. Ironwood and Orchard are combined, and the Orchard turnstile shows +20,020,000 (the documented crossing).
- (1.0, 0, 0), pay 0.01 (a restored old Sapling-only seed): +1 ZEC public for a 0.01 payment.
- (0.4 + 0.4, 0, 0.1), pay 0.6: both notes are spent, +0.8 ZEC public.

Cause:
- patches/webzjs/0004-ironwood-nu7.patch:6548 passes SpendPolicy::default(), which allows all three pools.
- zcash_client_backend 0.25 sends any UA with an Orchard receiver through the Ironwood bundle (input_selection.rs:1016-1041).
- The pool order for that payment is Ironwood, Orchard, Sapling (input_selection.rs:1681-1711). The first pool that covers the payment alone is spent by itself (input_selection.rs:1172-1176).
- select_change_pool (fees/common.rs:186-214) puts the change in Ironwood. Nothing returns to Sapling, so the whole value of the Sapling notes spent becomes public, not just the payment amount.

What the app shows:
- src/screens/Send.tsx:115 marks any u1 with an Orchard receiver 'shielded'. Its comment assumes the funds are already in Ironwood.
- The preview (Send.tsx:566-568) and the confirm chip (Send.tsx:605-611) say "Unified · shielded" and "Shielded payment".
- The app's own wording for a visible pool crossing is 'partial' (en.ts:296-297).
- Home's help text says "Ironwood + Orchard + Sapling. Amounts and parties are hidden on chain." (en.ts:152).
- Only an Orchard balance gets a notice (Home.tsx:272). There is no Sapling notice, and docs/engine-port.md does not document this as a decision.
- History will label the transaction Shielded too: WebZjs only classifies the wallet's own outputs, which are all Ironwood (src/lib/privacy.ts).

How Sapling funds get there: Celari's addresses carry a Sapling receiver (README:18), so a sender that only supports Sapling pays into it. Restoring an older seed also brings Sapling notes.

Scope: the deployed main has no per-recipient "Shielded" label (git show main:src/screens/Send.tsx). The misleading label arrives with this branch's Send redesign, so it ships with the NU7 release if the redesign is part of it. Funds are not at risk; this is purely a privacy disclosure problem.

One correction to the finding: its condition (Sapling > 0, Ironwood < R, Orchard < R, where R is amount plus fee) also fires in the 0.1/0.3/0.3 case, where Sapling is not used. That over-warning is harmless, because that transaction still crosses Orchard into Ironwood visibly. Also, the real fee is 20,000-35,000 zats, not TYPICAL_FEE, because change is split into several notes and Sapling outputs are padded.
- Verifier's fix: App-only, display-side. No engine change, no vendor rebuild, and scripts/webzjs-vendor.sha256 is untouched.

1. src/screens/Send.tsx:
- Give recipientOf(address, kind) a third argument `funds?: { balances: Balances; zats: bigint }`.
- In the unified branch, when receivers include 0x03 and funds are given, compute `R = zats + 50_000n` (a deliberately high fee bound, so it over-warns rather than under-warns).
- If `b.sapling > 0n && b.ironwood < R && b.orchard < R`, return `{ label: 'send.kind.unifiedPartial', privacy: 'partial', outcome: 'send.outcome.fromSapling' }`. Otherwise keep 'shielded'.
- outcomeKey uses `recipient.outcome` when it is set.
- Pass `{ balances: summary.balances, zats: typedZats }` at Send.tsx:180, and the draft's zats with the summary in DraftSummary (Send.tsx:588), so the preview and the confirm chip agree.
- Optional, to cover the documented Orchard crossing too: return 'partial' whenever `b.ironwood < R`.

2. Add i18n keys to en.ts and tr.ts:
- 'send.outcome.fromSapling': "Partly shielded payment: the recipient and the memo stay private, but this payment spends notes from the older Sapling pool, and their whole value moving into Ironwood is visible on chain."
- A Home notice for `b.sapling > 0n` in Home.tsx next to the Orchard note at Home.tsx:272, with the same message.
- Soften 'home.shieldedHelp' (en.ts:152) so it no longer promises hidden amounts for value that crosses pools.

3. Add a unit test for the condition, using the native results above as cases: 1/0/0.3 pay 0.5 gives partial; pay 0.2 gives shielded; 1/0/0 pay 0.01 gives partial.

After NU7 (riskier, since it touches the engine): propose Orchard-receiver payments with SpendPolicy::shielded_pools([Ironwood, Orchard]) first, and fall back to Sapling only after explicit consent, using a distinct error kind.

### ES-3 · minor · engine — Every send to a TEX address fails at building with ProposalNotSupported, but the form accepts TEX and the error hint misleads
- Where: wallet.rs pczt_create calls create_pczt_from_proposal (patches/webzjs/0004-ironwood-nu7.patch:6555-6575). zcash_client_backend 0.25 data_api/wallet.rs:2988 refuses multi-step (ZIP 320) proposals. The app offers TEX as a payable recipient: src/lib/address.ts:55, src/screens/Send.tsx:78, 106-107, 326. Misleading hint: src/screens/SpendSteps.tsx:101 with src/i18n/en.ts:247.
- Scenario: Reproduced natively: scratch test review_tex_send. With 0.2 ZEC in Ironwood at tip 3,543,350, pczt_create(account, tex1zyg3..., 1_000_000) returns Err(PcztCreate("ProposalNotSupported")) and nothing is stored (tx count 1 -> 1). In the app the form accepts the address and shows 'TEX · public' with an estimated fee of 0.0002 ZEC and a warning about the transparent intermediate step. After the password the send fails at 'building' with 'The balance may not cover the network fee. Lower the amount slightly and try again.' Lowering the amount never helps.
- Impact: No loss: nothing is built or stored. But users cannot pay exchanges that require TEX deposit addresses, and are told it is a balance problem. docs/engine-port.md still lists 'send to a TEX address' as a planned real-funds test.
- Proposed fix: Until ZIP 320 pairs are supported (upstream PCZT multi-step, or create_proposed_transactions with the USK), refuse TEX in checkAddress/Send with a clear 'TEX addresses are not supported yet' message. Map Error::PcztCreate("ProposalNotSupported") to a stable code in error.rs so buildError can tell it apart.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I could not refute it. It is real, and it is a duplicate of SPEND-2, which is already verified (real, minor, not before NU7) in docs/reviews/2026-10-pre-nu7-core-review.md:383-430. ES-3 adds nothing new apart from the optional engine error code.

Reproduced natively. I ran the reviewer's glue test (scratchpad/core-review/enginespend/webzjs/crates/webzjs-wallet/src/tests/nu7_pipeline.rs:880, review_tex_send) with --nocapture, using nightly-2026-10-28 and --locked:
  tex address tex1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3rcmznv
  pczt_create to TEX: Some(PcztCreate("ProposalNotSupported"))
  txs 1 -> 1
  test result: ok
I checked that the scratch tree is the shipped code:
- Its engine/zcash_client_memory is identical to the tracked engine.
- I applied patches/webzjs/0001-0004 to a clean clone at a50df94 (/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-ES-3/wz). It differs from the reviewer's tree only under src/tests/ and in Cargo.lock, and the reviewer's Cargo.lock is byte-identical to engine/webzjs.Cargo.lock.
- An earlier backend-level run (verify-SPEND-2/test2.log) shows the cause: the proposal has 2 steps (fees [30000, 10000]), and create_pczt_from_proposal returns Err(ProposalNotSupported). The t1 control case builds a v6 PCZT.

App path, traced:
1. src/lib/address.ts:54 returns {ok:true, kind:'tex'}.
2. review() at src/screens/Send.tsx:228-230 refuses only when !check.ok.
3. The confirm screen shows 'TEX · public' (Send.tsx:106-107), texWarn (:326) and a 20,000-zat fee floor (:78).
4. The engine error "Failed to create Pczt: ProposalNotSupported" carries no code (wallet error.rs: code() covers only UpgradePending, PcztWrongBranch and PcztExpired). buildError (src/engine/webzjs-errors.ts:80-91) passes it through unchanged.
5. SpendSteps.tsx:101 shows failureHint = send.failedHint (Send.tsx:333; en.ts:247), which says "The balance may not cover the network fee. Lower the amount slightly and try again." Every amount fails the same way.

Nothing is signed, stored or broadcast. The TEX row on the real-funds checklist (docs/engine-port.md:351) contradicts the Deferred note "Celari builds no such pairs" (:313-316).

Impact: no loss of funds and no privacy leak. Users cannot pay TEX deposit addresses and are told to lower the amount.

Partly wrong in the finding: the engine-side code mapping is not needed. A form-level refusal stops TEX before pczt_create runs, and adding a code would change the wasm and the vendor hashes for no user benefit.
- Verifier's fix: A TypeScript and docs change only. No engine, wasm or vendor/sha256 change; skip the error.rs code mapping from the finding.
1) In src/screens/Send.tsx review() (:229-230), refuse TEX on the form: `linkProblem(parsePaymentInput(to)) ?? (check.ok ? (check.kind === 'tex' ? 'send.err.address.texUnsupported' : null) : `send.err.address.${check.reason}`)`. Add send.err.address.texUnsupported to en.ts and tr.ts, e.g. "Celari cannot pay TEX addresses yet (the payment needs two linked transactions). Nothing was sent; ask for a t1 or unified address." zcash: payment links go through the same review(), so they are covered too.
2) Drop failureHint={t('send.failedHint')} at Send.tsx:333 and remove the send.failedHint key. SpendSteps.tsx:101 then falls back to the neutral 'send.failedRetry' ("Nothing was sent. You can try again."). Insufficient funds keeps its own SpendRefusedError message.
3) The TEX branches in feeFloor (:78) and the texWarn notice (:326) can no longer be reached; remove them.
4) Tests:
   - Make src/engine/fake.ts reject tex1 recipients with 'Failed to create Pczt: ProposalNotSupported'.
   - Add a unit test that review() refuses kind 'tex'.
   - Add an e2e check in tests/e2e/spend.spec.ts.
5) docs/engine-port.md:351: remove "and a TEX address" from the real-funds checklist, and add to Deferred that TEX is refused because zcash_client_backend 0.25 create_pczt_from_proposal (wallet.rs:2987-2990) accepts only single-step proposals.
Real TEX support (the ZIP 320 pair as two PCZTs, or create_proposed_transactions) is an engine change for after NU7.

### ES-4 · minor · ts — The fee confirmed by the user is a fixed estimate; the engine pays the real ZIP 317 fee, which can be several times higher and is never shown before broadcast
- Where: src/screens/Send.tsx:72-79 (feeFloor), :176 (Max = available - 10,000), :589. src/engine/webzjs.ts:300-353: send builds, signs, proves and broadcasts with no fee check. patches/webzjs/0004 wallet.rs pczt_create returns only the PCZT.
- Scenario: Reproduced natively: scratch test review_orchard_change_pool. An existing user with one 1 ZEC Orchard note pays 0.12345678 ZEC to a u1. The Orchard value balance is 12,380,678 against an Ironwood output of 12,345,678, so the fee is 35,000 zats: the split policy creates up to 4 Orchard change notes, and after NU6.3 each spend and output costs a full action. The confirm screen showed 'Estimated fee 0.0001 ZEC'. A wallet with many small notes pays 5,000 zats per extra input. Max (balance - 10,000) for the same Orchard-only wallet needs a 20,000 fee and is refused with InsufficientFunds.
- Impact: The user authorizes a fee they were not shown. It is the correct ZIP 317 fee, not a protocol overpayment, but it can be 3.5x the estimate or more, and Max fails for Orchard-funded wallets.
- Proposed fix: Return the PCZT's fee from pczt_create, or add a pczt_fee binding: transparent inputs - outputs + Sapling/Orchard/Ironwood value balances, via Pczt::into_effects. In signProveSend, before signing, compare it to the fee the user confirmed. If it is higher, stop and show the real fee for a second confirmation. Compute Max from the engine (MaxSpendMode) rather than balance - 10,000.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: I could not refute ES-4. It has the same root cause as SPEND-3, which is already verified real/minor, and the two should be merged into one finding. It is not a documented decision: docs/engine-port.md, README.md and patches/webzjs/README.md say nothing about the fee estimate, Max or the split policy. The only related prior work is tests/e2e/spend.spec.ts:134-136 (E2E-2), which only makes the refusal message readable.

Setup. In /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-ES-4 I cloned WebZjs a50df944 fresh (fresh/) and applied patches/webzjs/0001-0004. Its crates/ are byte-identical to the scratch tree wz/, apart from the scratch test file. engine/ is identical to the repo's engine/zcash_client_memory, and the lockfile is identical to engine/webzjs.Cargo.lock. I added two scratch tests (verify_es4_*) at the end of wz/crates/webzjs-wallet/src/tests/nu7_pipeline.rs. They call the real Wallet::pczt_create with mainnet parameters, NU6.3 active and NU7 not yet active. Built with nightly-2026-10-28 --locked; 2/2 passed. Output: run.log in the same folder, lines 290-308.

Measured:
(1) ES-4 scenario: one 1 ZEC Orchard note, tip 3,540,400, pay 12,345,678 to a u1.
- The PCZT fee is 35,000. The Orchard value balance is 12,380,678 and the Ironwood value balance is -12,345,678, exactly as reported.
- Orchard has 5 actions (1 spend and 4 change outputs counted separately) and Ironwood has 2. The proposal's fee_required is 35,000, with 4 Orchard change notes of about 21.9M each. This comes from Celari's SplitPolicy (wallet.rs:240-243, 262-263: 4 notes, 0.1 ZEC minimum).
- Paying 0.5 ZEC also costs 35,000. Paying 0.8 to 0.95 ZEC costs 20,000 (1 change note).
- The app shows "Estimated fee ~0.0001 ZEC" for every case: Send.tsx:77-79, :589, :645-646.
(2) Max on that Orchard-only wallet: available - 10,000 = 99,990,000 is refused with InsufficientFunds { available: 100000000, required: 100010000 }, so the fee needed is 20,000. Nothing is stored (1 -> 1 transactions). Available - 15,000 is also refused; available - 20,000 builds (2+2 actions). So an existing user whose funds are one Orchard note can never use Max.
(3) Many small notes: ten Ironwood notes of 0.01 ZEC each.
- Paying 0.05 ZEC uses 6 inputs and costs 30,000. Paying 0.09 ZEC uses 10 inputs and costs 50,000, five times the estimate.
- Max is refused (required 10,040,000) even at available - 25,000.

App path, read end to end:
- review() checks only zats + TYPICAL_FEE_ZATS (Send.tsx:236), and Max is available - 10,000 (:176).
- pczt_create runs only after the password: controller.ts:782-785, webzjs.ts:305-315.
- signProveSend (webzjs.ts:327-352) signs, proves and broadcasts with no fee check. beforeBroadcast is only the network re-check, and pczt_create returns only the PCZT.
- So the real fee is never seen before broadcast. History's TxRow (TxRow.tsx:71-72) shows the real feeZats afterwards.

Limits that keep this minor:
- The amount paid to the recipient is exact, and the fee is the correct ZIP 317 fee, not an overpayment. In absolute terms it is tens of thousands of zats; it is a wrong figure on the confirm step, not a loss of funds.
- The labels say "Estimated" and "~".
- A refused Max sends nothing, and the refusal message (send.refused.funds) gives the required and spendable amounts, so the user can lower the amount by hand.
- Nothing here depends on NU7.
- Verifier's fix: Merge with SPEND-3 and fix it once.

Now, app only, no wasm rebuild, low risk; can land any time:
(a) In Send.tsx, replace "~{fee}" on the preview, the confirm step and the result with a minimum, for example "from 0.0001 ZEC". Add a line saying ZIP 317 adds 0.00005 ZEC for each extra note spent or created, so the total shown is a lower bound.
(b) When a send is refused with insufficientFunds {requiredZats, availableZats}, offer "Send {fit} ZEC instead", where fit = availableZats - (requiredZats - draft.zats). This applies to Max drafts, which have no change, so requiredZats - draft.zats is the exact fee. The button returns to the form with that amount filled in, and the user confirms again; the confirmed amount must never change silently. Measured: an Orchard note gives available - 20,000, and ten notes give available - 50,000; each builds.
(c) Add a unit test for fit in spendRefusal and an e2e test using the fake engine's engineFee knob.

After NU7, engine:
(d) Add a read-only binding such as propose_fee(account, to, value, memo). It runs propose_transfer with the wallet's change_strategy and builds no PCZT and locks no inputs, and returns steps().first().balance().fee_required(). The Review step calls it before the password and shows the exact fee and total.
(e) As defence in depth, have pczt_create also return that fee, or read it from Pczt::into_effects as the sum of the value balances. Have signProveSend refuse before signing if it is above the fee the user confirmed.
(f) Compute Max from propose_send_max_transfer (zcash_client_backend 0.25, MaxSpendMode::MaxSpendable) instead of available - 10,000.
(g) Then rebuild vendor/, regenerate scripts/webzjs-vendor.sha256, run the native suites (backend and glue) and npm run test:e2e:real.

### ES-5 · polish · docs — The Home Orchard notice says spending moves the change into Ironwood, but change from an Orchard spend stays in Orchard
- Where: src/i18n/en.ts:164 ('home.orchardNote') and the matching entry in src/i18n/tr.ts
- Scenario: Measured in review_orchard_change_pool: a payment from an Orchard note gives Orchard value balance = payment + fee, with the change returned to Orchard, as upstream select_change_pool keeps it there while the Orchard balance strictly decreases. The canonical crossing in ES-1 also keeps its change in Orchard. The notice tells the user 'Spending from it moves the change into Ironwood'.
- Impact: Users may expect their Orchard balance to have moved into Ironwood after one payment. In fact every later payment from it crosses the turnstile again, and each crossing amount is public. The per-payment leak itself is disclosed, so this is wording only.
- Proposed fix: Reword: 'Payments from it cross into Ironwood and each crossing amount is visible on chain (ZIP 318 turnstile); the change stays in Orchard.' Apply in both languages.
- Verified: (polish: not verified)

## Lens: sync

Coverage: The relayed user message ("14.16 olmadı mı?", Turkish for roughly "wasn't it 14.16 / didn't 14.16 happen?") has nothing in it that applies to this sync review, so I did only the assigned sync lens.

What I read:
- Docs: docs/engine-port.md, patches/webzjs/README.md, engine/zcash_client_memory/UPSTREAM.md, README privacy and testing sections, git log. The round IDs the task mentions (V-1, NU7-1..3, M1-M4, ENG-SC) appear only in code comments and the task list, not in the docs.
- App: src/engine/lightd.ts, webzjs.ts, webzjs-upgrades.ts (chainFloor), webzjs-balances.ts, webzjs-crash.ts; src/lib/network.ts (nextCheck stickiness), birthday.ts; src/state/controller.ts in full; relevant parts of RestoreWallet.tsx, CreateWallet.tsx, Settings.tsx, App.tsx (auto-lock) and the en.ts strings.
- Glue: a scratch checkout of WebZjs a50df944 with all four patches applied (/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/sync/webzjs). Read wallet.rs, boundary.rs, data_requests.rs, pass_budget.rs, most of progress.rs, and the bindgen/wallet.rs constructor, sync, get_latest_block and detect_birthday.
- Backend: update_chain_tip_internal, set_transaction_status/set_unmined_at, scan_queue replace_queue_entries, MemBlockCache, put_roots, get_transparent_receivers.
- Upstream: zcash_client_backend 0.25 sync.rs, proto.rs CompactBlock accessors, ScanRange; zcash_client_sqlite 0.23 update_chain_tip and set_transaction_status for comparison; tonic-web-wasm-client 0.9.2 fetch options.

What I ran:
- A native probe against the real backend crate (built offline with nightly-2026-10-28 and the engine's Cargo.lock), in /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/sync/tipprobe. It confirmed that a 499M tip survives a later honest update_chain_tip and a save/reload, and that a tip below a new wallet's birthday panics.
- Live gRPC-web queries to zcash-mainnet.chainsafe.dev: GetLatestBlock is served from a cache, and GetLightdInfo came back from 3 different backends in 6 tries (Zebra 7.0.0 and Zakura 1.7.0). A GetBlockRange above the tip is answered with grpc-status 11 OutOfRange.

What I could not check or did not run:
- The native backend and glue suites (scripts/test-engine-native.sh), build-webzjs.sh, npm test, npm run test:e2e:real, and audit-engine.sh.
- No in-browser or wasm reproduction. That panics and out-of-memory become traps that CrashWatch catches, and the stalled-request behaviour in SYNC-5, are inferred from code (panic=abort on wasm32), not observed.
- No mock-server test of the unbounded streams in SYNC-4.
- The SYNC-3 scenario is from reading the code; I did not test it with a real seed that has transparent history.
- I left the zcash_client_backend scanning internals (tree-size and continuity checks, reorg truncation) as upstream behaviour and did not re-verify them.

### SYNC-1 · major · engine — A server-reported chain tip has no upper bound. One inflated tip is saved in the scan queue for good, so sync stays broken after switching servers and funds get stuck until a seed restore
- Where: engine/zcash_client_memory/src/wallet_write.rs:348-411 (update_chain_tip_internal: queue only ever grows; chain_tip_height() = max queue end - 1, types/memory_wallet/mod.rs:254); crates/webzjs-wallet/src/wallet.rs:296-307 after patches/webzjs/0004 (network_tip accepts any u32; also used in catch_up_before_building :548-573 and pczt_send :996-1029, where blocks_behind saturates to 0 when the wallet is ahead); src/engine/lightd.ts:252-286 (networkStatusFor only bounds the tip from below via chainFloor); src/state/controller.ts:594-601 (readTip keeps the max for the page lifetime); src/screens/CreateWallet.tsx:142 (newWalletBirthday(latestHeight))
- Scenario: 1) One GetLatestBlock answer from a malicious or buggy server says 499,000,000. upstream sync::run calls update_chain_tip(499,000,000). 2) Later an honest server answers 3,536,010. I reproduced this with a native probe against the real backend: chain_height stays 499,000,000 and the queue keeps Historic(3530000..499000001) after the honest update and after encode/decode_new. 3) The default server answers any GetBlockRange above its tip with grpc-status 11 'GetBlock: block N is newer than the latest block' (checked live on zcash-mainnet.chainsafe.dev). So every later pass fails at the first batch that reaches past the real tip, and blocks near the tip are never scanned again. 4) The inflated queue is saved even though failed passes are not: prepareAddress() persists on every Receive opening (controller.ts:365), and so does afterSpend. 5) Building uses target = chain_height()+1. Before NU7, branch(499M+1)=NU7 differs from branch(real+1), so the send forces sync_to_tip, which fails, and every send is refused. While the lying server is still in use, it reports the same tip and claims NU7's branch in GetLightdInfo, so networkStatusFor says 'supported'. A NU7 v6 transaction is then built with expiry about 499,000,040. check_minable passes (branch matches, expiry > tip+3), the transaction is stored and its notes are marked spent. If the server drops it, or the real network rejects it (NU7 not active), GetStatus only sets confirmed_unmined_at to the inflated tip, which stays below the expiry. 6) A new wallet created while the inflated tip is served gets birthday = inflated tip - 10, above the real chain, so later payments to it are never scanned (and see SYNC-2).
- Impact: Funds are stuck, not stolen. The spent notes stay locked until the user wipes the wallet and restores from the seed. After switching to an honest server the wallet still cannot sync: new incoming payments stay hidden, the balance freezes, nothing new is saved, sends fail before NU7, and confirmations show nonsense. The app gives no hint that a wipe and restore is the only fix. The only trigger needed is one lie from the configured server (the default is a third-party pool), and the damage outlives that server.
- Proposed fix: (a) Backend, the minimal fix that makes it heal itself: in update_chain_tip_internal, right after the `new_tip < max_scanned` early return (wallet_write.rs:357-361), when `self.chain_tip_height() > Some(new_tip)`, cut every scan-queue entry to end at or below `new_tip + 1` (delete entries that start above it). Every range above new_tip is unscanned there, because max_scanned <= new_tip. The next honest GetLatestBlock then repairs the queue. (b) Clock ceiling: add `chainCeiling(now) = CHAIN_ANCHOR.height + ceil((now + CLOCK_SLACK_MS - CHAIN_ANCHOR.time)/1000/10)` (10 s per block, below NU7's 25 s) to src/engine/webzjs-upgrades.ts. Make networkStatusFor throw when info.blockHeight > ceiling. Ignore higher values in readTip and in the Create/Restore latestHeight() calls. Pass the ceiling to the engine through a setter and refuse a GetLatestBlock height above it in Wallet::network_tip() and before update_chain_tip in sync_pass (for example, check the GetLatestBlock answer in BudgetedTransport).
- Verified: (pending)

### SYNC-3 · major · ts — 'I don't know' birthday detection starts the scan at the first transparent transaction, so earlier shielded funds are silently never found
- Where: src/screens/RestoreWallet.tsx:104-108 (height = detected ?? SAPLING_ACTIVATION_HEIGHT); src/engine/webzjs.ts:179-193; crates/webzjs-wallet/src/bindgen/wallet.rs:746-783 (upstream detect_birthday_from_transparent_address: min height of GetTaddressTxids answers - 100); webzjs-keys/src/keys.rs:183-191 (probes only the default UA's transparent receiver); src/i18n/en.ts:83-84
- Scenario: A user restores a seed that received shielded (Sapling, Orchard or Ironwood) payments from 2021 on and got its first transparent payment, say an exchange withdrawal, at block 2,500,000. On the month step they tick 'I don't know'. detect_birthday returns 2,499,900, the info notice says 'Sync will start at block 2,499,900', and the account is created with that birthday. The engine never scans blocks below it, so notes received earlier and still unspent never appear: the balance is too low and the History is incomplete, with no warning. The help text only says 'We will first look for the earliest transaction on your transparent address'. A malicious server can return one fabricated RawTransaction at height = tip and hide the whole history. A height of 0 (a mempool answer) gives birthday 0, and import_account_ufvk then computes `birthday - 1` on a u32, which wraps in release and makes the restore fail.
- Impact: After a restore the balance is wrong and incoming funds are hidden. The user may think the funds are gone, or discard the seed. Restoring again with an earlier month recovers them, but nothing tells the user to.
- Proposed fix: Do not use a transparent transaction height as the birthday. In RestoreWallet.tsx:104-108, use SAPLING_ACTIVATION_HEIGHT when 'I don't know' is ticked. Alternatively, pre-fill the month field with the detected month and show a warning the user must accept: 'shielded payments received before <month> will not be found; pick an earlier month if unsure'. Ignore detected values <= SAPLING_ACTIVATION_HEIGHT or above latestHeight(). Update restore.birthdayUnknownHelp in en and tr to match.
- Verified: **real, minor**; fix before NU7: no
- Verifier's evidence: The flaw is in the code, but the reported failure (a restore that silently starts too late) does not happen on the default server. What does happen is that "I don't know" always fails.

Code path, read end to end:
- `src/screens/RestoreWallet.tsx:103-108` sets `height = await controller.detectBirthday(...) ?? SAPLING_ACTIVATION_HEIGHT`.
- `src/engine/webzjs.ts:179-193` derives the default-UA transparent receiver and calls the engine with no try/catch.
- `.webzjs/crates/webzjs-wallet/src/bindgen/wallet.rs:654-689` sends `GetTaddressTxids` with start 419200 and end `u64::MAX`, then returns `min(height).saturating_sub(100) as u32`.
- `crates/webzjs-wallet/src/wallet.rs:248-253` asks for the tree state at `birthday - 1`, so nothing below the birthday is ever scanned.

Live reproduction on mainnet (default `DEFAULT_SERVER` `https://zcash-mainnet.chainsafe.dev`; GetLightdInfo reports ECC LightWalletD v0.5.3, Zakura 1.7.0):
1. I replayed the exact WebZjs request over gRPC-web with `/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SYNC-3/detect.py`. The server answered grpc-status 3: "GetTaddressTransactions: block range too wide (18446744073709132415 blocks, limit 10000000)". It gives this answer for every address. The limit is exact: an end of 419200+10,000,000 works, and one block more fails.
2. I ran the production build with the real engine in Playwright (`/tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/verify-SYNC-3/pw/unknown.spec.ts`, dist built into that scratch dir): restore a seed, tick "I don't know", press Continue. The UI shows "Something went wrong. Details: Error returned from GRPC server: code: 'Client specified an invalid argument', message: \"GetTaddressTransactions: block range too wide ...\"". The user stays on the month step.

So with the shipped default, no birthday is ever detected. No restore starts at a late birthday, and the fallback to Sapling activation that the help text promises (`en.ts:83-84`, `tr.ts:84-85`) never happens either. The fake engine always returns null, so the e2e tests never see this.

The flaw is real but dormant. With a bounded range (end = tip) the same server does answer: for t1dncGyY8aPsGShDmvw92FNUvJPaywbwpSW the earliest height is 2,623,578, which would make the birthday 2,623,478. Any shielded notes from before that height would be missed without a warning. That would happen if a server accepted an unbounded range, or if someone fixed the error above by capping `end` in the WebZjs patches. The flaw would then be major, as reported.

Side claims:
- Height 0 → birthday 0 → `(0u32 - 1)` wraps in release (no overflow-checks in the profile) → `get_tree_state(4294967295)` fails, so the restore errors out. Only a buggy or malicious server would answer 0, because `getaddresstxids` returns mined transactions only. The same goes for a fabricated tip-height answer, and the user recovers by restoring with a month. Both are defence-in-depth only.

Funds are never at risk in the current state: a failed detection blocks the restore and the seed is untouched.
- Verifier's fix: Make "I don't know" mean a full scan, and stop using a transparent transaction's height as the birthday. This fixes the error users see today and removes the dormant too-late birthday.

1. `src/screens/RestoreWallet.tsx:103-108`: replace the `if (unknown)` branch with `height = SAPLING_ACTIVATION_HEIGHT;` and drop the `controller.detectBirthday(...)` call. Optionally also remove `detectBirthday` from `src/engine/types.ts:230`, `src/engine/webzjs.ts:179-193`, `src/engine/fake.ts:303` and `src/state/controller.ts:209`. Leaving them unused is also fine.
2. On the busy button (`RestoreWallet.tsx` around line 245), show `t('common.continue')` instead of `restore.birthdayDetecting`. Delete the `restore.birthdayDetecting` key in `en.ts:85` and `tr.ts:86`.
3. Update `restore.birthdayUnknownHelp` (en and tr) to describe the full scan. en: "Celari will scan from Sapling activation in October 2018, so no payment is missed. The first scan can take a day and needs several GB of memory, and it pauses whenever the wallet locks." tr: "Celari Ekim 2018'deki Sapling başlangıcından itibaren tarar, böylece hiçbir ödeme kaçmaz. İlk tarama bir gün sürebilir, birkaç GB bellek ister ve cüzdan her kilitlendiğinde duraklar."
4. Add an e2e assertion with the fake engine: after ticking "I don't know", the password step says "Sync will start at block 419,200".

If detection is kept, it can only be a hint: patch WebZjs to cap `end` at the tip, reject heights of 0, above the tip or below 419200, and show the result only as a pre-filled month with a warning the user must accept that earlier shielded payments will not be found. Never apply it silently.

### SYNC-2 · minor · engine — update_chain_tip panics (engine stops) when a wallet with no scanned block sees a tip below its birthday
- Where: engine/zcash_client_memory/src/wallet_write.rs:379 (min_to_scan = birthday can exceed chain_end) and :386 (ScanRange::from_parts(b..chain_end) asserts end >= start, zcash_client_backend 0.25 data_api/scanning.rs:51); same code in zcash_client_sqlite 0.23
- Scenario: A new wallet's birthday is tip - 10 blocks before NU7 (tip - 30 after), using the tip one pool member reported (CreateWallet.tsx:142, birthday.ts:76). If the first pass's GetLatestBlock comes from a member 12 or more blocks behind, chain_end = new_tip + 1 is below the birthday. The probe shows: 'BlockHeight(3535990)..BlockHeight(3535989) is invalid for ScanRange(Historic)' panic. In wasm that is a trap on the sync worker: CrashWatch reports EngineStoppedError, and after a reload the next pass traps again until the lagging member catches up. A malicious server can cause this at will, and SYNC-1's inflated birthday makes it permanent on an honest server.
- Impact: Robustness. A freshly created or restored wallet cannot sync, and the app shows 'engine stopped' over and over. No funds are lost, but payments to the new address stay invisible while this lasts.
- Proposed fix: In update_chain_tip_internal, before building ranges: `if max_scanned.is_none() && wallet_birthday.is_some_and(|b| b > chain_end) { return Ok(()); }`. Also clamp the shard entry: `let min_to_scan = min(wallet_birthday.filter(|b| b > &h).unwrap_or(h), chain_end);`. Worth reporting upstream as well.
- Verified: (pending)

### SYNC-4 · minor · engine — A malicious server can crash the engine in a loop: unbounded streams (OOM) and panicking compact block accessors
- Where: crates/webzjs-wallet/src/pass_budget.rs:228 (batch_growing never abandons once current <= min_blocks and never compares the message count with the blocks requested); engine/zcash_client_memory/src/block_source.rs:101 and crates/webzjs-wallet/src/progress.rs:311,333 (CompactBlock::height() unwraps a u64 into u32; hash()/prev_hash() panic on non-32-byte fields); crates/webzjs-wallet/src/data_requests.rs:176 (GetTaddressTxids answers collected without limit); upstream GetSubtreeRoots and GetAddressUtxos streams are also uncounted
- Scenario: (a) The server sends large blocks, the batch size shrinks to 20, and the server then answers one 20-block GetBlockRange with millions of small CompactBlock messages. Nothing abandons the download, try_collect grows past the wasm memory limit, and the engine traps. (b) The server sends one CompactBlock with height 2^32: MemBlockCache::insert calls height().unwrap(), which panics and traps. (c) A spend search answered by an endless GetTaddressTxids stream does the same. Each time CrashWatch reports EngineStoppedError, the user reloads, and the next pass crashes again.
- Impact: The tab can be crashed and kept unusable while that server is configured (DoS). No state is lost, because nothing is saved after a trap.
- Proposed fix: In CountedBody/batch_growing, end the download with an error (not a resize) when `counter.messages > batch_blocks`, or when bytes exceed max even at min_blocks (hard cap min_blocks x 4 MiB). In ProgressCache::insert, check each block before passing it on: height <= u32::MAX and inside the requested range, and hash/prev_hash 32 bytes when there is no header. Return a cache error instead of panicking, which needs an error type in place of Infallible. Cap GetTaddressTxids at about 1,000 transactions and return BadData beyond that.
- Verified: (pending)

### SYNC-5 · minor · engine — No timeout on any engine gRPC call: a stalled request freezes the pass, blocks sends at 'building' and holds off auto-lock indefinitely
- Where: crates/webzjs-wallet/src/bindgen/wallet.rs:144 (Client::new with no FetchOptions timeout); crates/webzjs-wallet/src/wallet.rs:440 (the pass takes the db write lock for its whole length) and :551 (catch_up_before_building waits for db.read()); src/state/controller.ts:527 (only catch-up passes are watched for a stall); src/state/controller.ts:440-443 (lock(), including auto-lock from App.tsx:43, is deferred while spending)
- Scenario: While the wallet is up to date, a GetBlockRange, GetTreeState or GetLatestBlock stream stalls: a hostile or broken server, or a dead HTTP/2 connection after a network change. eng.sync() never settles, no stall warning appears because catchUp is null, the balance freezes and passes stop. The user then sends: pczt_create reaches catch_up_before_building and waits forever on db.read(), so the UI sits at 'building' with spending = true. Every auto-lock calls lock(), which only sets lockAfterSpend. The wallet stays unlocked on screen with the AES key, and the seed phrase decrypted for the send, in memory. If the stalled request later fails or finishes, the send continues to sign and broadcast long after the user gave up on it.
- Impact: Defence-in-depth and robustness: auto-lock can be bypassed for as long as a request hangs, the user sees no error, and a delayed payment can still go out.
- Proposed fix: Create the client with `tonic_web_wasm_client::Client::new_with_options(url, FetchOptions::new().timeout(Duration::from_secs(180)))`. The AbortGuard covers the whole response, so 180 s still fits one 32-64 MiB batch. In the app, watch every pass for STALL_MS, not just catch-up passes. In lock(), defer only once the spend has reached 'signing'. During 'building' nothing is signed or stored yet, so reloadLocked() is safe.
- Verified: (pending)

## Lens: drift

Coverage: No critical or major problems found in the drift lens. The findings are three minor and two polish issues. Nothing in the tracked repo was modified; all work was done in three clones under /tmp/claude-0/-home-user-Zcash-wallet/5e91fe3a-29e4-5243-bea0-135f18bac5ff/scratchpad/core-review/drift/ (logs are there).

What I ran:
- **Independent build:** scripts/build-webzjs.sh, cold, in a clone at a different path, using CI's settings (WEBZJS_RUST_TOOLCHAIN, WEBZJS_WASM_BINDGEN_VERSION, CC=clang-18 1:18.1.3-1ubuntu1). It reproduced scripts/webzjs-vendor.sha256 byte-for-byte (16 files). The current vendor/ and the dist/ wasm files have the same hashes.
- **CI:** run 40952847695 on main at 2acc747 has the same engine inputs as this branch and also built from source and matched the list.
- **Crate sources:** all 405 registry crates: each cached .crate matches its lockfile checksum, and the extracted source cargo compiles equals the .crate contents. The wasm_thread checkout is pristine at 9e432077.
- **scripts/audit-engine.sh:** advisories, licences and sources all ok for both lockfiles, with the advisory database fetched fresh (2295466c, 2026-10-30). No vulnerable or yanked crates. Every Zcash crate is at the newest crates.io release (index checked).
  - `cargo tree` for wasm32 confirms the two deny.toml exceptions: atomic-polyfill is in neither wasm, and async-std comes only through wasm_thread.
- **scripts/gen-licenses.sh --check:** up to date.
- **scripts/test-build-webzjs-guards.sh:** 23/23.
- **Cargo-config guard:** I fed `cargo config get --show-origin` tricky foreign config (arrays, inline tables, multi-line strings, `paths`, `[source]`, `[patch]`). The awk filter flagged every case; no bypass found.
- **Native tests:** backend suite 198 passed, 0 failed, 6 ignored. Glue suite 68 passed, 0 failed, on freshly applied committed patches.
- **getrandom:** versions 0.2, 0.3 and 0.4 all handle wasm shared memory correctly.

Upstream drift:
- The import commit 5be4755 is byte-identical to ChainSafe/librustzcash-nu61 at 52efe30, plus the two licence files. That is the revision WebZjs a50df944's Cargo.lock names, as UPSTREAM.md says.
- Behavioural differences versus that upstream:
  - (a) It implements zcash_client_backend 0.25's low-level traits, and put_blocks and store_decrypted_tx delegate to data_api::ll::wallet.
  - (b) The tables follow zcash_client_sqlite 0.23.
  - (c) It adds the Ironwood pool (tree, notes, nullifiers, subtree roots; with_ironwood_tree_mut is overridden).
  - (d) New binary save format. Old protobuf blobs are refused, which triggers a rebuild and rescan. Gap limits and the scan-queue observer are not saved.
  - (e) put_roots skips a subtree root the tree already holds; sqlite inserts into the cap without that check.
  - (f) Spend maps are pruned when a scan completes, and the export buffer is exactly sized.
  - (g) A scan-queue observer reports what is left to scan.
  - (h) Not modelled: witness_stabilized (spendability is therefore more conservative). schedule_next_check returns an error, transparent-key-import is refused, and the ZIP 318 migration store is not ported.
  - All of these are documented.
- The fork's two later commits that touch zcash_client_memory (a7de556 and 01ad759, 2026-02-02) only optimise and test the old received-notes model, so they do not apply to the rewrite.
- I compared these against sqlite 0.23 line by line and found no divergence: scan_complete/extend_range, select_spendable_notes_matching_value, with_pool_balances, the unexpired and spent-note conditions, set_transaction_status, anchor_computable and PRUNING_DEPTH.

Patches: I read 0001, 0002 and 0003 in full. In 0004 I read PCZT sign/prove/send, the boundary rules, runtime.rs, the sync worker, the pczt serde wrapper and the key changes. I found no logic error. Not checked: every one of 0004's 6,768 lines, and every backend module against sqlite. I did not run `npm run test:e2e:real` (CI ran it on main).

About "14.16 olmadı mı?": the only "14.16" in the repo is Node `>=14.16` in .webzjs/docs/package-lock.json, a WebZjs docs site that is neither built nor shipped. If the question is about NU7 timing: the explorer tip was 3,535,988 at 2026-10-30 15:09 UTC, and the last 10,000 blocks averaged 75.3 s. At that rate block 3,543,405 arrives around 2026-11-06 02:15 UTC (05:15 Turkey time), not 14:16. That is an estimate.

### DRIFT-1 · minor · ci — A vendor/ that failed the hash check stays in place, and nothing checks it before it is bundled into dist/
- Where: scripts/build-webzjs.sh:61-66 and 362-381 (on a mismatch: exit 1, vendor/ left in place); package.json:11 ("build": "tsc --noEmit && vite build"); vite.config.ts:43-56 (aliases vendor/ directly). No check anywhere outside CI: grep finds scripts/webzjs-vendor.sha256 only in build-webzjs.sh, ci.yml and the docs.
- Scenario: An x86_64 Linux build where any input differs from the pinned set: a different clang build, a stray untracked engine file (see DRIFT-2), a poisoned .webzjs/target or cached wasm-bindgen (see DRIFT-4). build-webzjs.sh prints the diff and exits 1 but leaves the unpinned vendor/. The README recipe runs `npm run build:webzjs` and then `npm run build` as separate lines (README.md:88-90). The second command bundles that vendor/ without any signal: the dist wasm is a byte copy of vendor/ (checked here: dist/assets/webzjs_wallet_bg-*.wasm has sha256 c8fa1653..., the same as vendor/). On any non-x86_64 host the mismatch is only a warning, so this happens every time.
- Impact: A locally built deployment (the owner deploys a dist/ by hand: vendor/ is git-ignored and README.md:113-122 describes Netlify/Cloudflare uploads) can ship a key-handling wasm that is not the reviewed, pinned one. The hash list exists to stop exactly that, but it is only enforced in CI.
- Proposed fix: (1) In build-webzjs.sh, when the list differs and WEBZJS_LIST_MISMATCH is not `warn`, move the result aside (`mv "$OUT" "$OUT.unpinned"`) before `exit 1`. (2) Add a `prebuild` npm script, or a `buildStart` hook in vite.config.ts. It recomputes `(cd vendor && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum)` and fails `npm run build` unless the result equals scripts/webzjs-vendor.sha256. Allow an explicit opt-out (e.g. CELARI_UNPINNED_ENGINE=1) for engine development only.
- Verified: (pending)

### DRIFT-2 · minor · ci — The clean-tree guard depends on the user's git config, and engine/ reaches cargo through a symlink to the working tree
- Where: scripts/build-webzjs.sh:112 (`git -C "$ROOT" status --porcelain -- patches/webzjs engine`); patches/webzjs/0003 adds `celari-engine -> ../engine`; engine/zcash_client_memory/Cargo.toml [package] has no `build = false`
- Scenario: With `status.showUntrackedFiles=no` in ~/.gitconfig (a common large-repo setting), `git status --porcelain` lists no untracked files. Reproduced in a scratch clone: an untracked engine/zcash_client_memory/build.rs is listed by default but produces empty output under `-c status.showUntrackedFiles=no`. Files ignored through .git/info/exclude or core.excludesFile are never listed either. Because cargo compiles engine/ through the symlink, such a file reaches the build: cargo runs any engine/zcash_client_memory/build.rs automatically. That build script can set cfgs or env, or emit link args, for a crate that holds the wallet's notes and keys.
- Impact: Uncommitted, unreviewed code can reach the engine build. On x86_64 Linux the final hash comparison still catches it (and then DRIFT-1 applies). Off x86_64 it is only a warning. CI is unaffected, because its checkout is clean.
- Proposed fix: Use `git -C "$ROOT" status --porcelain --untracked-files=all --ignored=matching -- patches/webzjs engine` (filtering out engine/**/target if wanted). Better: after the patches are applied, replace the `celari-engine` symlink with a directory extracted from `git -C "$ROOT" archive HEAD engine`, at the same relative path so the panic paths and the output stay identical. Then only committed content can reach cargo. Also add `build = false` to the [package] section of engine/zcash_client_memory/Cargo.toml.
- Verified: (pending)

### DRIFT-3 · minor · engine — The native test script tests whatever is in .webzjs/ and engine/, not the committed patches and sources
- Where: scripts/test-engine-native.sh:75-86 (glue mode only compares .webzjs/Cargo.lock with engine/webzjs.Cargo.lock); :89-120 (backend mode compiles the engine/ working tree with no uncommitted-change check); patches/webzjs/README.md tells developers to edit files inside .webzjs/
- Scenario: A developer follows the README workflow and edits, for example, UPGRADE_SEND_PAUSE in .webzjs/crates/webzjs-wallet/src/boundary.rs. They then run `scripts/test-engine-native.sh glue`, which passes on the edited code, but leave a hunk out of the regenerated 0004 patch. The build resets .webzjs/ and applies the committed 0004, so the shipped wasm differs from what was tested. The same applies to uncommitted engine/ edits in backend mode: build-webzjs.sh refuses them, test-engine-native.sh does not. For this review I ran both suites on a fresh checkout of HEAD: backend 198 passed, 0 failed, 6 ignored; glue 68 passed, 0 failed. So the current documented results do hold.
- Impact: The test evidence recorded in docs/engine-port.md (the Tests table) is the main evidence for the NU7 boundary and spend logic. It can silently describe code that is not what ships.
- Proposed fix: In glue mode, first run `WEBZJS_PREPARE_ONLY=1 bash "$ROOT/scripts/build-webzjs.sh"`. It resets .webzjs/ to the pinned commit plus the committed patches and keeps target/. In backend mode, refuse when `git status --porcelain --untracked-files=all -- engine` is non-empty. In both modes, offer an explicit `--dirty` flag for work in progress, and print it on the result line.
- Verified: (pending)

### DRIFT-4 · polish · ci — Cached tool binaries are trusted by their --version string; only wasm-opt is re-hashed
- Where: scripts/build-webzjs.sh:241-245 (wasm-bindgen-cli); scripts/audit-engine.sh:76-82 (cargo-deny); scripts/gen-licenses.sh:121-128 (cargo-about); compare scripts/build-webzjs.sh:254 (wasm-opt is checksum-checked on every run)
- Scenario: A stale or altered binary under .webzjs/target/celari-tools/ that prints the expected version is reused as is. For cargo-deny this means a local `scripts/audit-engine.sh` can report `advisories ok` without checking anything. For wasm-bindgen it changes the JS glue and the wasm (caught by the list on x86_64 Linux only).
- Impact: Local audit, licence and build results can be wrong. CI is unaffected because it starts with an empty .webzjs/.
- Proposed fix: At install time, write the sha256 of each binary to a file. Re-check it on every run the way wasm-opt is checked, and reinstall on a mismatch. Alternatively, always run `cargo install --locked --root ...`, which is cheap when cargo's build cache is warm.
- Verified: (polish: not verified)

### DRIFT-5 · polish · docs — The docs still say CI has never reproduced the vendor/ list; it has
- Where: docs/engine-port.md:377-378 (checklist item 4) and :429-430 ("INFERRED: that CI's own build reproduces it (no CI run yet)")
- Scenario: CI run 40952847695 (push to main at 2acc747, 2026-10-29) skipped the cache restore, built WebZjs from source, passed "Check vendor/ against scripts/webzjs-vendor.sha256" and saved the cache. `git diff origin/main HEAD` shows no change to scripts/webzjs-vendor.sha256, engine/, patches/webzjs/ or scripts/build-webzjs.sh, so that run pinned exactly this branch's engine. My independent cold build in a scratch clone at another path (clang-18 1:18.1.3-1ubuntu1, nightly-2026-10-28, wasm-pack 0.15.0) also matched all 16 entries.
- Impact: The real-funds checklist shows an item as open that is already done. A reader cannot tell which reproducibility evidence exists.
- Proposed fix: Mark checklist item 4 as done, citing run 40952847695 and commit 2acc747. Change the INFERRED sentence to MEASURED.
- Verified: (polish: not verified)

