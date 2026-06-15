# Westlands Bowls — CORS proxy (Cloudflare Worker)

A tiny Worker that fetches the league pages, adds CORS headers, and caches them
at Cloudflare's edge. The static site uses it for fast, reliable live data and
to shield the source sites (cgleague / bowlsresults) from load.

This folder is independent of the GitHub Pages site — Pages ignores it.

## Deploy

From this `proxy/` folder:

```sh
npx wrangler login     # opens your browser to authorise Cloudflare (one-off)
npx wrangler deploy
```

`deploy` prints the URL, e.g. `https://bowls-proxy.<your-subdomain>.workers.dev`.

Then put that URL into `WORKER_PROXY` in `../app.js` and push — the site will
prefer the Worker (public proxies remain as fallback).

## What it does

- Only proxies `cgleague.co.uk` and `bowlsresults.co.uk` (not an open proxy).
- Caches match pages for 30 min and tables/fixtures for 3 min, shared across
  all visitors, so the source sites are hit at most once per window.

Tweak the cache windows or allowed hosts in `src/worker.js`.
