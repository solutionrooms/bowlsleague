// parser.js — shared, dependency-free parser for cgleague.co.uk pages.
// Runs in BOTH Node (build-time scrape) and the browser (live refresh),
// so the parsing logic lives in exactly one place. Pure string/regex work,
// no DOM and no Node APIs.

export const BASE_URL = 'https://www.cgleague.co.uk';

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, m => ENTITIES[m]);
}

export function stripTags(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// The cgleague tables are never nested, so non-greedy matching is safe.
function getTables(html) {
  const out = [];
  const re = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function getRows(tbl) {
  const out = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tbl))) out.push(m[1]);
  return out;
}

function getCells(row) {
  const out = [];
  const re = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(row))) out.push(m[1]);
  return out;
}

function firstHref(s) {
  const m = /href=['"]([^'"]+)['"]/i.exec(s || '');
  return m ? decodeEntities(m[1]) : null;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// "Mon 27 Apr" -> "2026-04-27" (year supplied by the season).
function toISO(dateStr, year) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})/.exec(dateStr || '');
  if (!m) return null;
  const dd = String(m[1]).padStart(2, '0');
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-${dd}`;
}

// ---- team.php ------------------------------------------------------------
export function parseTeamPage(html) {
  const title = stripTags((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const divisionHeading = stripTags((/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html) || [])[1] || '');
  const seasonM = /Season\s+(\d{4})/.exec(divisionHeading) || /Season\s+(\d{4})/.exec(html);
  const season = seasonM ? parseInt(seasonM[1], 10) : null;

  // The team's own division link, e.g. /archives/div.php?L=NSI&D=2
  const divM = /href=['"](\/archives\/div\.php\?L=([^&'"]+)&(?:amp;)?D=([^'"&]+))['"]/i.exec(html);
  const divisionPath = divM ? decodeEntities(divM[1]) : null;

  const num = re => {
    const m = re.exec(html);
    return m ? parseInt(m[1], 10) : null;
  };
  const summary = {
    played: num(/Played<\/td>\s*<td[^>]*>\s*<div class='R'>(\d+)<\/div>/i),
    won: num(/Won<\/td>\s*<td[^>]*>\s*<div class='R'>(\d+)<\/div>/i),
    lost: num(/Lost<\/td>\s*<td[^>]*>\s*<div class='R'>(\d+)<\/div>/i),
    for: num(/Points scored<\/td>\s*<td[^>]*><div class='R'>(\d+)<\/div>/i),
    against: num(/Points conceded<\/td>\s*<td[^>]*><div class='R'>(\d+)<\/div>/i),
  };

  const tbls = getTables(html);

  // Fixtures: the table whose header contains "Opponents". Column order varies
  // by league (some add a "Planned/actual date" column), so locate columns by
  // their header text rather than fixed positions.
  const fixtures = [];
  const fixTbl = tbls.find(t => /Opponents/i.test(t));
  if (fixTbl) {
    const fxRows = getRows(fixTbl);
    const head = getCells(fxRows[0] || '').map(c => stripTags(c).toLowerCase());
    const oppI = Math.max(0, head.findIndex(h => h.includes('opponent')));
    const venI = head.findIndex(h => h.includes('venue'));
    const dateI = (() => { const i = head.findIndex(h => h.includes('fixture')); return i >= 0 ? i : 2; })();
    const forI = head.findIndex(h => h === 'for');
    const agstI = head.findIndex(h => h.includes('agst') || h.includes('against'));
    for (let i = 1; i < fxRows.length; i++) {
      const cs = getCells(fxRows[i]);
      if (cs.length <= Math.max(forI, agstI)) continue;
      const opponent = stripTags(cs[oppI]);
      if (!opponent) continue;
      const forS = forI >= 0 ? stripTags(cs[forI]) : '';
      const agstS = agstI >= 0 ? stripTags(cs[agstI]) : '';
      const played = forS !== '' && agstS !== '';
      const href = firstHref(cs[oppI]);
      fixtures.push({
        opponent,
        venue: venI >= 0 ? stripTags(cs[venI]) : '',
        date: dateI >= 0 ? stripTags(cs[dateI]) : '',
        for: played ? parseInt(forS, 10) : null,
        against: played ? parseInt(agstS, 10) : null,
        played,
        matchUrl: href ? BASE_URL + href : null,
      });
    }
  }

  // Registered players: the table whose header mentions "registration".
  // Column layout varies between leagues (some have an extra "Team" column),
  // so locate the registration column from the header; P/W/L/Ave follow it.
  // Keep only players who have actually played, sorted by games then average.
  const players = [];
  const plTbl = tbls.find(t => /registration/i.test(t));
  if (plTbl) {
    const plRows = getRows(plTbl);
    const headerRow = plRows.find(r => /registration/i.test(r));
    const regIdx = headerRow
      ? getCells(headerRow).findIndex(c => /registration/i.test(c))
      : -1;
    if (regIdx > 0) {
      for (const r of plRows) {
        const cs = getCells(r);
        if (cs.length < regIdx + 5) continue;
        if (!/^\d/.test(stripTags(cs[regIdx]))) continue; // data rows start the reg cell with a day number
        const name = stripTags(cs[0]);
        const played = parseInt(stripTags(cs[regIdx + 1]), 10) || 0;
        if (!name || played <= 0) continue;
        const href = firstHref(cs[0]);
        players.push({
          name,
          played,
          won: parseInt(stripTags(cs[regIdx + 2]), 10) || 0,
          lost: parseInt(stripTags(cs[regIdx + 3]), 10) || 0,
          ave: stripTags(cs[regIdx + 4]),
          url: href ? BASE_URL + href : null,
        });
      }
      players.sort((a, b) => b.played - a.played || (parseFloat(b.ave) || 0) - (parseFloat(a.ave) || 0));
    }
  }

  return { title, divisionHeading, divisionPath, season, summary, fixtures, players };
}

// ---- div.php -------------------------------------------------------------
export function parseDivPage(html) {
  const divisionHeading = stripTags((/<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html) || [])[1] || '');
  const tbls = getTables(html);
  // The standings table has the DivName column class and a "Total" header;
  // the results-by-date table has neither.
  const stdTbl =
    tbls.find(t => /DivName/i.test(t)) ||
    tbls.find(t => /Total/i.test(t)) ||
    tbls[0];

  const standings = [];
  if (stdTbl) {
    const rows = getRows(stdTbl);
    // Header columns vary (some divisions add a "D" draws column), so map by header text.
    const head = getCells(rows.find(r => /<div[^>]*>\s*P\s*<\/div>|>P<\/td>/i.test(r)) || rows[0] || '')
      .map(c => stripTags(c).toLowerCase());
    const col = (label, fallback) => { const i = head.findIndex(h => h === label); return i >= 0 ? i : fallback; };
    const colStarts = (label, fallback) => { const i = head.findIndex(h => h.startsWith(label)); return i >= 0 ? i : fallback; };
    const pI = col('p', 1), wI = col('w', 2), lI = col('l', 3), totI = colStarts('total', 4), aveI = colStarts('ave', 5);
    for (const r of rows) {
      const cs = getCells(r);
      if (cs.length <= aveI) continue;
      const name = stripTags(cs[0]);
      if (!name || name === 'P') continue; // header / footer
      standings.push({
        name,
        p: parseInt(stripTags(cs[pI]), 10) || 0,
        w: parseInt(stripTags(cs[wI]), 10) || 0,
        l: parseInt(stripTags(cs[lI]), 10) || 0,
        total: parseInt(stripTags(cs[totI]), 10) || 0,
        ave: stripTags(cs[aveI]),
      });
    }
  }
  return { divisionHeading, standings };
}

// ---- match.php : per-rink player scores ----------------------------------
// Each rink is "first to 21". The winner's cell carries an extra GAIN value,
// so column positions shift — detect the away block by the first non-numeric
// cell after the home score.
export function parseMatchPage(html) {
  const tbl = getTables(html).find(t => /SCORE/i.test(t)) || '';
  const games = [];
  for (const r of getRows(tbl)) {
    const c = getCells(r).map(stripTags);
    if (c.length < 4) continue;
    if (/^name$/i.test(c[0]) || /^total$/i.test(c[0]) || !c[0]) continue;
    const hs = parseInt(c[1], 10);
    // away name = first non-empty, non-numeric cell after the home score
    // (skips the GAIN column, which is empty for the loser).
    let k = 2;
    while (k < c.length && (c[k] === '' || /^\d+$/.test(c[k]))) k++;
    const ap = c[k];
    const as = parseInt(c[k + 1], 10);
    if (!c[0] || !ap || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
    games.push({ hp: c[0], hs, ap, as });
  }
  return { games };
}

// ---- compose a finished team view ---------------------------------------
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

// Last result = most recent played; next game = soonest unplayed fixture that
// is today-or-later (so a postponed past fixture without a score isn't shown as
// "next"), falling back to the earliest unplayed if none are in the future.
export function pickLastNext(fixtures, todayISO = new Date().toISOString().slice(0, 10)) {
  const played = fixtures.filter(f => f.played);
  let lastGame = played.length
    ? played.reduce((a, b) => ((a.dateISO || '') >= (b.dateISO || '') ? a : b))
    : null;
  const unplayed = fixtures.filter(f => !f.played);
  const future = unplayed.filter(f => f.dateISO && f.dateISO >= todayISO).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const nextGame = future[0] || unplayed[0] || null;
  if (lastGame) {
    lastGame = { ...lastGame, result: lastGame.for > lastGame.against ? 'W' : lastGame.for < lastGame.against ? 'L' : 'D' };
  }
  return { lastGame, nextGame };
}

export function composeTeam(config, teamData, divData) {
  const season = teamData.season || new Date().getFullYear();
  const fixtures = (teamData.fixtures || []).map(f => ({ ...f, dateISO: toISO(f.date, season) }));
  const { lastGame, nextGame } = pickLastNext(fixtures);

  const standings = (divData && divData.standings) || [];
  let position = null;
  const marked = standings.map((row, i) => {
    const isWestlands = norm(row.name) === norm(config.label);
    if (isWestlands) position = i + 1;
    return { ...row, pos: i + 1, isWestlands };
  });

  return {
    id: config.id,
    label: config.label,
    leagueShort: config.leagueShort,
    leagueName: config.leagueName,
    division: (divData && divData.divisionHeading) || teamData.divisionHeading || '',
    summary: teamData.summary || {},
    position,
    teamsInDivision: standings.length || null,
    fixtures,
    lastGame,
    nextGame,
    standings: marked,
    players: teamData.players || [],
    urls: {
      team: config.urls.team,
      division: teamData.divisionPath ? BASE_URL + teamData.divisionPath : config.urls.division || null,
      tables: config.urls.tables,
    },
  };
}
