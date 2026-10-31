# deploy/app

The production build of Celari that https://app.celariwallet.com serves: CI's
`celari-dist` artifact of commit f92daa1f3981d4465d0b0009b6b9fdd2555d472b
(https://github.com/Kubudak90/Zcash-wallet/commit/f92daa1f3981d4465d0b0009b6b9fdd2555d472b), built from source and
checked against that commit's `scripts/webzjs-vendor.sha256`, plus
`vercel.json` (deploy/vercel.json at that commit). No source code here; written by
deploy/make-branch.sh.
