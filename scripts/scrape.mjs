// scripts/scrape.mjs — build-time scraper.
// Fetches every Westlands team (and its division) from cgleague.co.uk,
// builds the composed view, and writes data.json (both into _site/ for the
// Pages deploy and at the repo root for local dev).

import { writeFile, mkdir } from 'node:fs/promises';
import { TEAMS, SEASON_DEFAULT } from '../teams.js';
import { parseTeamPage, parseDivPage, composeTeam, BASE_URL } from '../parser.js';
import { composeBowls } from '../parser-bowlsresults.js';
import { cgNames, bowlsNames, canon } from './roster.mjs';

// Browser UA: bowlsresults.co.uk returns an empty body to non-browser agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function scrapeCgleague(cfg) {
  const teamHtml = await getHtml(cfg.urls.team);
  const teamData = parseTeamPage(teamHtml);
  let divData = null;
  const divUrl = teamData.divisionPath ? BASE_URL + teamData.divisionPath : null;
  if (divUrl) {
    try { divData = parseDivPage(await getHtml(divUrl)); }
    catch (e) { console.error(`  division fetch failed for ${cfg.id}: ${e.message}`); }
  }
  const team = composeTeam(cfg, teamData, divData);
  team.source = 'cgleague';
  team.error = null;
  return { team, names: cgNames(teamHtml) };
}

async function scrapeBowls(cfg) {
  const [tables, fixtures, results, players] = await Promise.all([
    getHtml(cfg.sources.tables),
    getHtml(cfg.sources.fixtures),
    getHtml(cfg.sources.results),
    getHtml(cfg.sources.players),
  ]);
  return { team: composeBowls(cfg, { tables, fixtures, results, players }), names: bowlsNames(players) };
}

async function scrapeTeam(cfg) {
  try {
    const { team, names } = (cfg.source === 'bowlsresults') ? await scrapeBowls(cfg) : await scrapeCgleague(cfg);
    const pos = team.position ? `${team.position}/${team.teamsInDivision}` : '?';
    console.log(`  ok  ${cfg.id.padEnd(9)} pos ${String(pos).padEnd(6)} fixtures ${team.fixtures.length} roster ${names.length}`);
    return { team, names, league: cfg.leagueShort };
  } catch (e) {
    console.error(`  FAIL ${cfg.id}: ${e.message}`);
    const team = {
      id: cfg.id, source: cfg.source || 'cgleague', label: cfg.label, leagueShort: cfg.leagueShort,
      leagueName: cfg.leagueName, urls: { ...cfg.urls, division: cfg.urls.division || null }, sources: cfg.sources,
      division: '', summary: {}, position: null, teamsInDivision: null,
      fixtures: [], lastGame: null, nextGame: null, standings: [], players: [],
      error: e.message,
    };
    return { team, names: [], league: cfg.leagueShort };
  }
}

const results = [];
for (const cfg of TEAMS) results.push(await scrapeTeam(cfg));
const teams = results.map(r => r.team);

// Club roster: canonical player name -> the leagues they're registered in.
const rosterMap = new Map();
for (const r of results) {
  for (const raw of r.names) {
    const name = canon(raw);
    if (!rosterMap.has(name)) rosterMap.set(name, new Set());
    rosterMap.get(name).add(r.league);
  }
}
const roster = [...rosterMap.entries()]
  .map(([name, set]) => ({ name, leagues: [...set].sort() }))
  .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

const data = { updated: new Date().toISOString(), season: SEASON_DEFAULT, teams, roster };
const json = JSON.stringify(data, null, 2);

await mkdir('_site', { recursive: true });
await writeFile('_site/data.json', json);
await writeFile('data.json', json);

const failed = teams.filter(t => t.error).length;
console.log(`\nWrote data.json — ${teams.length} teams, ${failed} failed.`);
if (failed === teams.length) process.exit(1); // total failure should fail the build
