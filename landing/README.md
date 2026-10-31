# celariwallet.com

The Celari landing page, served at https://celariwallet.com (the wallet itself is
at https://app.celariwallet.com, its own origin: nothing on this site runs next
to the wallet's keys).

- `public/` is the site as served: two static pages (`index.html` in English,
  `tr/index.html` in Turkish), `site.css`, the fonts (Geist, Geist Mono and
  Fraunces with its italic, the wallet's own files, SIL OFL 1.1,
  `FONT_LICENSES.txt`) and the icons.
- `build.py` writes both pages from one template and the texts in it; edit it,
  then run `python3 landing/build.py`. The logo's paths are read from
  `src/components/Brand.tsx`, the icons are copied from
  `src/components/icons.tsx`, and the engraved C behind the hero is the
  wallet's `EngravedC` (`src/screens/AccountLayout.tsx`) drawn from the same
  numbers (the same lines to within 0.02 of its 1200 box).
- The look is the wallet's: its light and dark tokens (`src/styles.css`), so
  the page follows the system theme as the wallet does, and the type and
  ornaments of its welcome screen (`src/styles/account.css`).
- The motion is CSS only: the hero card's loop (a transparent balance shielded,
  balances hidden, a new address each turn), the engraved C's echoes and the
  light that runs through them, the ticker, the counters, the block pipe and
  the payment steps. Where the browser has scroll-driven animations
  (`animation-timeline`), sections rise in as they scroll into view and the
  header shows how far down the page you are; elsewhere the page is simply
  still. `prefers-reduced-motion` stops all of it, and every element rests in
  a readable state.
- `vercel.json` is the Vercel project's configuration (project root
  `landing/`, no build, output `public/`): a CSP that allows no scripts, no
  inline styles and nothing from another origin, HSTS, no framing, and a
  permanent redirect from www.celariwallet.com to celariwallet.com.
- Deploying: the Vercel project `celari-site` (root `landing/`, output
  `public/`, not linked to Git) deploys a commit of `main` on request, like the
  wallet's `celari-app` deploys `deploy/app` (deploy/README.md).

The facts on the page come from the repository's README and
docs/engine-port.md; when those change, change the page with them.
