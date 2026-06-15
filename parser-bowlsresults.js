// parser-bowlsresults.js — parser for bowlsresults.co.uk (Staffordshire Ladies).
// That site has no single team page, so a team view is assembled from four
// per-division/per-team pages: tables, fixtures, results and team averages.
// Pure JS (no DOM / Node APIs); runs at build time and in the browser.

import { stripTags, pickLastNext } from './parser.js';

export const BOWLS_BASE = 'https://bowlsresults.co.uk/results24/';

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// "Thu 11th Jun" -> "2026-06-11"
function toISO(dateStr, year) {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})/.exec(dateStr || '');
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-${String(m[1]).padStart(2, '0')}`;
}

// Split-based extractors — robust against this site's unclosed <td>/<tr> tags.
function getTables(html) {
  return html.split(/<table[^>]*>/i).slice(1).map(p => p.replace(/<\/table>[\s\S]*$/i, ''));
}
function getRows(tbl) {
  return tbl.split(/<tr[^>]*>/i).slice(1).map(p => p.replace(/<\/tr>[\s\S]*$/i, ''));
}
function getCells(row) {
  return row.split(/<t[dh][^>]*>/i).slice(1).map(p => p.replace(/<\/t[dh]>[\s\S]*$/i, '').replace(/<\/tr>[\s\S]*$/i, ''));
}
const detectYear = html => {
  const m = /\b(20\d{2})\b/.exec(html);
  return m ? parseInt(m[1], 10) : new Date().getFullYear();
};

// ---- tables.php?d=N : standings + the team's row -------------------------
function parseTables(html, teamId) {
  const tbl = getTables(html).find(t => /Table for Division/i.test(t));
  const standings = [];
  let summary = {}, position = null, division = '';
  const capM = /Table for (Division\s*[0-9A-Za-z]+)/i.exec(html);
  if (capM) division = capM[1];
  if (tbl) {
    for (const r of getRows(tbl)) {
      const cs = getCells(r);
      if (cs.length < 15) continue;
      const pos = parseInt(stripTags(cs[0]), 10);
      if (!Number.isFinite(pos)) continue; // header rows
      const isW = new RegExp(`[?&]t=${teamId}\\b`).test(r);
      standings.push({
        pos,
        name: stripTags(cs[1]),
        p: parseInt(stripTags(cs[2]), 10) || 0,
        w: parseInt(stripTags(cs[3]), 10) || 0,
        l: parseInt(stripTags(cs[4]), 10) || 0,
        total: parseInt(stripTags(cs[9]), 10) || 0, // aggregate "For"
        ave: stripTags(cs[14]),
        isWestlands: isW,
      });
      if (isW) {
        position = pos;
        summary = {
          played: parseInt(stripTags(cs[2]), 10) || 0,
          won: parseInt(stripTags(cs[3]), 10) || 0,
          lost: parseInt(stripTags(cs[4]), 10) || 0,
          for: parseInt(stripTags(cs[9]), 10) || 0,
          against: parseInt(stripTags(cs[10]), 10) || 0,
        };
      }
    }
  }
  return { division, standings, position, summary, teamsInDivision: standings.length || null };
}

// ---- fixtures.php?d=N : full Westlands schedule (chronological) ----------
// The schedule spans several <table>s, so we walk every row in document order
// (dates are emitted in sequence) rather than a single table.
function parseFixtures(html, teamId, year) {
  const out = [];
  const seen = new Set();
  const tRe = new RegExp(`[?&]t=${teamId}\\b`);
  let date = null;
  for (const r of getRows(html)) {
    const dateHdr = /colspan\s*=\s*["']?3["']?[^>]*>([\s\S]*?)</i.exec(r);
    if (dateHdr && /\d/.test(dateHdr[1])) {
      const clean = /([A-Za-z]{3}\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3})/.exec(stripTags(dateHdr[1]));
      date = clean ? clean[1] : stripTags(dateHdr[1]);
      continue;
    }
    if (!tRe.test(r)) continue;
    const cs = getCells(r);
    if (cs.length < 3) continue;
    const home = stripTags(cs[0]);
    const away = stripTags(cs[2]);
    const homeId = (/[?&]t=(\d+)\b/.exec(cs[0]) || [])[1];
    const westlandsHome = String(homeId) === String(teamId);
    const opponent = westlandsHome ? away : home;
    if (!opponent || /^bye$/i.test(opponent)) continue;
    const dateISO = toISO(date, year);
    if (!dateISO || seen.has(dateISO)) continue;
    seen.add(dateISO);
    out.push({ date, dateISO, venue: westlandsHome ? 'Home' : 'Away', opponent });
  }
  return out;
}

// ---- results.php?d=N : played scores keyed by ISO date -------------------
function parseResults(html, teamNameNorm, year) {
  const map = new Map();
  const norm = s => stripTags(s).toLowerCase();
  for (const tbl of getTables(html)) {
    const capM = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tbl);
    if (!capM) continue;
    const date = stripTags(capM[1]);
    const dateISO = toISO(date, year);
    if (!dateISO) continue;
    const hrefM = /href=["']?(matches\.php[^"'>\s]+)/i.exec(capM[1]);
    const matchUrl = hrefM ? BOWLS_BASE + hrefM[1].replace(/&amp;/g, '&') : null;
    for (const r of getRows(tbl)) {
      const cs = getCells(r);
      if (cs.length < 7) continue;
      const homePts = parseInt(stripTags(cs[1]), 10);
      const awayPts = parseInt(stripTags(cs[5]), 10);
      if (!Number.isFinite(homePts) || !Number.isFinite(awayPts)) continue; // not played
      const home = norm(cs[2]), away = norm(cs[4]);
      const westlandsHome = home === teamNameNorm;
      const westlandsAway = away === teamNameNorm;
      if (!westlandsHome && !westlandsAway) continue;
      const rinks = (parseInt(stripTags(cs[0]), 10) || 0) + (parseInt(stripTags(cs[6]), 10) || 0);
      map.set(dateISO, {
        for: westlandsHome ? homePts : awayPts,
        against: westlandsHome ? awayPts : homePts,
        rinks,
        matchUrl,
      });
    }
  }
  return map;
}

// ---- teamaverages.php?t=N : player stats ---------------------------------
function parsePlayers(html) {
  const players = [];
  for (const tbl of getTables(html)) {
    if (!/indresults\.php/i.test(tbl)) continue;
    for (const r of getRows(tbl)) {
      if (!/indresults\.php/i.test(r)) continue;
      const cs = getCells(r);
      const nameIdx = cs.findIndex(c => /indresults\.php/i.test(c));
      if (nameIdx < 0 || cs.length < nameIdx + 4) continue;
      const name = stripTags(cs[nameIdx]);
      const played = parseInt(stripTags(cs[nameIdx + 1]), 10) || 0;
      if (!name || played <= 0) continue;
      const hrefM = /href=["']?([^"'>\s]+)/i.exec(cs[nameIdx]);
      players.push({
        name,
        played,
        won: parseInt(stripTags(cs[nameIdx + 2]), 10) || 0,
        lost: parseInt(stripTags(cs[nameIdx + 3]), 10) || 0,
        for: parseInt(stripTags(cs[nameIdx + 5]), 10) || 0,     // total shots for
        against: parseInt(stripTags(cs[nameIdx + 6]), 10) || 0, // total shots against
        avgFor: parseFloat(stripTags(cs[nameIdx + 8])) || 0,    // avg score per game (to 21)
        ave: stripTags(cs[cs.length - 1]), // aggregate average, e.g. "+3.50"
        url: hrefM ? BOWLS_BASE + hrefM[1].replace(/&amp;/g, '&') : null,
      });
    }
    if (players.length) break;
  }
  players.sort((a, b) => b.played - a.played || (parseFloat(b.ave) || 0) - (parseFloat(a.ave) || 0));
  return players;
}

// ---- compose, returning the same shape as the cgleague composeTeam -------
export function composeBowls(config, pages) {
  const year = config.season || detectYear(pages.tables || '');
  const teamNameNorm = (config.siteName || config.label).toLowerCase();

  const { standings, position, summary, teamsInDivision, division } = parseTables(pages.tables || '', config.teamId);
  const resultsMap = parseResults(pages.results || '', teamNameNorm, year);
  const fixtures = parseFixtures(pages.fixtures || '', config.teamId, year).map(f => {
    const r = f.dateISO && resultsMap.get(f.dateISO);
    if (r) return { ...f, for: r.for, against: r.against, rinks: r.rinks, played: true, matchUrl: r.matchUrl };
    return { ...f, for: null, against: null, played: false, matchUrl: null };
  });

  const { lastGame, nextGame } = pickLastNext(fixtures);

  return {
    id: config.id,
    source: 'bowlsresults',
    label: config.label,
    leagueShort: config.leagueShort,
    leagueName: config.leagueName,
    division: division || `Division ${config.division}`,
    summary,
    position,
    teamsInDivision,
    fixtures,
    lastGame,
    nextGame,
    standings,
    players: parsePlayers(pages.players || ''),
    urls: config.urls,
    sources: config.sources,
    error: null,
  };
}
