# celariwallet.com

The Celari landing page, served at https://celariwallet.com (the wallet itself is
at https://app.celariwallet.com, its own origin: nothing on this site runs next
to the wallet's keys).

- `public/` is the site as served: two static pages (`index.html` in English,
  `tr/index.html` in Turkish), `site.css`, the fonts (Geist and Fraunces, the
  wallet's own files, SIL OFL 1.1, `FONT_LICENSES.txt`) and the icons.
- `build.py` writes both pages from one template and the texts in it; edit it,
  then run `python3 landing/build.py`. The logo's paths are read from
  `src/components/Brand.tsx`.
- `vercel.json` is the Vercel project's configuration (project root
  `landing/`, no build, output `public/`): a CSP that allows no scripts and
  nothing from another origin, HSTS, and no framing.

The facts on the page come from the repository's README and
docs/engine-port.md; when those change, change the page with them.
