// scripts/players.mjs — one-off: list every registered Westlands player as
// "Name : League", sorted alphabetically, into players.md.
// (Run with: node scripts/players.mjs)

import { writeFile } from 'node:fs/promises';
import { TEAMS } from '../teams.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const getHtml = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};

const strip = s => String(s || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();
const tables = h => h.split(/<table[^>]*>/i).slice(1).map(p => p.replace(/<\/table>[\s\S]*$/i, ''));
const rows = t => t.split(/<tr[^>]*>/i).slice(1).map(p => p.replace(/<\/tr>[\s\S]*$/i, ''));
const cells = r => r.split(/<t[dh][^>]*>/i).slice(1).map(p => p.replace(/<\/t[dh]>[\s\S]*$/i, '').replace(/<\/tr>[\s\S]*$/i, ''));

// cgleague: every row of the "Registered players" table (played or not).
function cgPlayers(html) {
  const tbl = tables(html).find(t => /registration/i.test(t));
  if (!tbl) return [];
  const out = [];
  for (const r of rows(tbl)) {
    const cs = cells(r);
    if (cs.length < 5) continue;          // skip footer (single button cell)
    const name = strip(cs[0]);
    if (!name || /^team$/i.test(name)) continue; // skip header (empty name cell)
    out.push(name);
  }
  return out;
}

// bowlsresults: players listed on the team averages page.
function bowlsPlayers(html) {
  for (const t of tables(html)) {
    if (!/indresults\.php/i.test(t)) continue;
    const out = [];
    for (const r of rows(t)) {
      if (!/indresults\.php/i.test(r)) continue;
      const name = strip((cells(r).find(c => /indresults\.php/i.test(c))) || '');
      if (name) out.push(name);
    }
    if (out.length) return out;
  }
  return [];
}

const seen = new Set();
const entries = [];
for (const cfg of TEAMS) {
  try {
    const names = cfg.source === 'bowlsresults'
      ? bowlsPlayers(await getHtml(cfg.sources.players))
      : cgPlayers(await getHtml(cfg.urls.team));
    let added = 0;
    for (const name of names) {
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
