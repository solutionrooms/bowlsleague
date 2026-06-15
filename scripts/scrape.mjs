// scripts/scrape.mjs — build-time scraper.
// Fetches every Westlands team (and its division) from cgleague.co.uk,
// builds the composed view, and writes data.json (both into _site/ for the
// Pages deploy and at the repo root for local dev).

import { writeFile, mkdir } from 'node:fs/promises';
import { TEAMS, SEASON_DEFAULT } from '../teams.js';
import { parseTeamPage, parseDivPage, composeTeam, BASE_URL } from '../parser.js';
import { composeBowls } from '../parser-bowlsresults.js';

// Browser UA: bowlsresults.co.uk returns an empty body to non-browser agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function scrapeCgleague(cfg) {
  const teamData = parseTeamPage(await getHtml(cfg.urls.team));
  let divData = null;
  const divUrl = teamData.divisionPath ? BASE_URL + teamData.divisionPath : null;
  if (divUrl) {
    try { divData = parseDivPage(await getHtml(divUrl)); }
    catch (e) { console.error(`  division fetch failed for ${cfg.id}: ${e.message}`); }
  }
  const team = composeTeam(cfg, teamData, divData);
  team.source = 'cgleague';
  team.error = null;
  return team;
}

async function scrapeBowls(cfg) {
  const [tables, fixtures, results, players] = await Promise.all([
    getHtml(cfg.sources.tables),
    getHtml(cfg.sources.fixtures),
    getHtml(cfg.sources.results),
    getHtml(cfg.sources.players),
  ]);
  return composeBowls(cfg, { tables, fixtures, results, players });
}

async function scrapeTeam(cfg) {
  try {
    const team = (cfg.source === 'bowlsresults') ? await scrapeBowls(cfg) : await scrapeCgleague(cfg);
    const pos = team.position ? `${team.position}/${team.teamsInDivision}` : '?';
    console.log(`  ok  ${cfg.id.padEnd(9)} pos ${String(pos).padEnd(6)} fixtures ${team.fixtures.length} players ${team.players.length}`);
    return team;
  } catch (e) {
    console.error(`  FAIL ${cfg.id}: ${e.message}`);
    return {
      id: cfg.id, source: cfg.source || 'cgleague', label: cfg.label, leagueShort: cfg.leagueShort,
      leagueName: cfg.leagueName, urls: { ...cfg.urls, division: cfg.urls.division || null }, sources: cfg.sources,
      division: '', summary: {}, position: null, teamsInDivision: null,
      fixtures: [], lastGame: null, nextGame: null, standings: [], players: [],
      error: e.message,
    };
  }
}

const teams = [];
for (const cfg of TEAMS) teams.push(await scrapeTeam(cfg));

const data = { updated: new Date().toISOString(), season: SEASON_DEFAULT, teams };
const json = JSON.stringify(data, null, 2);

await mkdir('_site', { recursive: true });
await writeFile('_site/data.json', json);
await writeFile('data.json', json);

const failed = teams.filter(t => t.error).length;
console.log(`\nWrote data.json — ${teams.length} teams, ${failed} failed.`);
if (failed === teams.length) process.exit(1); // total failure should fail the build
