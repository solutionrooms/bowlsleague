// scripts/players.mjs — one-off: list every registered Westlands player as
// "Name : League", sorted alphabetically, into players.md.
// (Run with: node scripts/players.mjs)

import { writeFile } from 'node:fs/promises';
import { TEAMS } from '../teams.js';
import { cgNames, bowlsNames, canon } from './roster.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const getHtml = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};

const seen = new Set();
const entries = [];
for (const cfg of TEAMS) {
  try {
    const names = cfg.source === 'bowlsresults'
      ? bowlsNames(await getHtml(cfg.sources.players))
      : cgNames(await getHtml(cfg.urls.team));
    let added = 0;
    for (const raw of names) {
      const name = canon(raw);
      const key = `${name}||${cfg.leagueShort}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, league: cfg.leagueShort });
      added++;
    }
    console.error(`  ${cfg.id.padEnd(10)} ${names.length} players (${added} new)`);
  } catch (e) {
    console.error(`  FAIL ${cfg.id}: ${e.message}`);
  }
}

entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.league.localeCompare(b.league));
const lines = entries.map(e => `- ${e.name} : ${e.league}`).join('\n');
const md = `# Westlands players\n\n${entries.length} entries (name : league), sorted alphabetically by name. The same person may appear under more than one league.\n\n${lines}\n`;
await writeFile('players.md', md);
console.error(`\nWrote players.md — ${entries.length} entries`);
