# Deploying the wallet

https://app.celariwallet.com serves the wallet; https://celariwallet.com serves the
landing page (`landing/`). They are two Vercel projects on two origins, so nothing
of the landing page runs next to the wallet's keys.

The wallet is never built by Vercel. What it serves is CI's `celari-dist` artifact
of a from-source run on `main`, which CI builds only after `vendor/` matched
`scripts/webzjs-vendor.sha256`:

1. Push to `main`; wait for the CI run of that commit (it builds WebZjs from
   source) to pass.
2. Download its `celari-dist` artifact and unpack it.
3. `deploy/make-branch.sh <unpacked-dir> <commit>`: refuses a dist whose wasm
   files are not in that commit's hash list, then commits the dist with
   `deploy/vercel.json` and a README to the branch `deploy/app`.
4. `git push origin deploy/app`, then deploy that commit of `deploy/app` to
   production in the Vercel project of app.celariwallet.com.

`vercel.json` sends COOP/COEP (WebZjs needs a cross-origin isolated page), the
same CSP as `public/_headers` with `frame-ancestors 'none'`
(tests/unit/vite-security.test.ts keeps them equal), HSTS, and caches the
content-hashed `assets/` for a year.

A wallet lives in the browser storage of its origin. Wallets made on an earlier
address (such as the celari-preview deployment) do not move to
app.celariwallet.com by themselves: restore them there from the recovery phrase,
and keep the old address until that is done.
