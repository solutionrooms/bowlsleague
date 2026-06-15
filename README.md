# Westlands Bowls

A single page showing the **latest scores, next games and league tables for every
Westlands bowls team**, across all the leagues they play in.

🔗 **Live site:** https://solutionrooms.github.io/bowlsleague/

Each team gets a card showing its **last result** and **next game** at a glance, with
the full division table, complete fixture list and player averages tucked behind a
**More** expander.

## How it stays live

GitHub Pages is static, so freshness comes from two layers:

1. **Live on every page load** — the page re-fetches each team straight from the
   source sites (through a CORS proxy) and re-parses it in the browser, so it's as
   up to date as the league sites themselves. A ↻ **Refresh** button re-pulls on demand.
2. **Snapshot fallback** — a GitHub Action (`.github/workflows/deploy.yml`) scrapes all
   teams every 30 minutes and on every push, baking a `data.json` into the deploy. The
   page paints instantly from this and falls back to it if the live fetch is ever blocked.

## Data sources

- **cgleague.co.uk** — Thursday/Saturday Parks, Industries, Saturday Mixed, Oakhill,
  Newcastle. Parsed by [`parser.js`](parser.js).
- **bowlsresults.co.uk** — Staffordshire Ladies. Parsed by
  [`parser-bowlsresults.js`](parser-bowlsresults.js).

The parsers are plain ES modules with no dependencies and run **both** in Node (build
time) and in the browser (live refresh), so the parsing logic lives in one place.

The list of tracked teams is in [`teams.js`](teams.js) — add or change a team there.

## Run / build locally

```sh
node scripts/scrape.mjs        # writes data.json (and _site/data.json)
python3 -m http.server 8765    # then open http://localhost:8765/
```

> Unofficial fan page. Not affiliated with any of the leagues. Scores belong to the
> respective league websites.
