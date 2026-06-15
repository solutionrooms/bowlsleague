// teams.js — the list of Westlands teams to track (build-time only).
// The browser does not need this; it reads everything from data.json.

import { BASE_URL } from './parser.js';
import { BOWLS_BASE } from './parser-bowlsresults.js';

export const SEASON_DEFAULT = 2026;

const teamUrl = (L, T) => `${BASE_URL}/archives/team.php?L=${L}&T=${encodeURIComponent(T).replace(/%20/g, '+')}`;
const slUrl = (page, extra) => `${BOWLS_BASE}${page}?${extra}&yearid=2026&web=staffordshireladies&leagueid=1`;

// leagueShort drives the grouping headings on the page (in this order).
export const TEAMS = [
  {
    id: 'parks-thu', label: 'Westlands', leagueShort: 'Thursday Parks',
    leagueName: 'North Staffs Parks — Thursday', L: 'NSPThu',
    urls: { team: teamUrl('NSPThu', 'Westlands'), tables: 'https://www.cgleague.co.uk/north-staffs-parks/tablesthu.php' },
  },
  {
    id: 'parks-sat', label: 'Westlands', leagueShort: 'Saturday Parks',
    leagueName: 'North Staffs Parks — Saturday', L: 'NSPSat',
    urls: { team: teamUrl('NSPSat', 'Westlands'), tables: 'https://www.cgleague.co.uk/north-staffs-parks/tablessat.php' },
  },
  {
    id: 'nsi-a', label: 'Westlands A', leagueShort: 'Industries',
    leagueName: 'North Staffs Industries', L: 'NSI',
    urls: { team: teamUrl('NSI', 'Westlands A'), tables: 'https://www.cgleague.co.uk/north-staffs-industries/tables.php' },
  },
  {
    id: 'nsi-b', label: 'Westlands B', leagueShort: 'Industries',
    leagueName: 'North Staffs Industries', L: 'NSI',
    urls: { team: teamUrl('NSI', 'Westlands B'), tables: 'https://www.cgleague.co.uk/north-staffs-industries/tables.php' },
  },
  {
    id: 'smbl-a', label: 'Westlands A', leagueShort: 'Saturday Mixed',
    leagueName: 'Saturday Mixed Bowls League', L: 'SMBL',
    urls: { team: teamUrl('SMBL', 'Westlands A'), tables: 'https://www.cgleague.co.uk/archives/tables.php?L=SMBL' },
  },
  {
    id: 'oak-a', label: 'Westlands A', leagueShort: 'Oakhill',
    leagueName: 'Oakhill & District', L: 'OJ',
    urls: { team: teamUrl('OJ', 'Westlands A'), tables: 'https://www.cgleague.co.uk/oakhill/tables.php' },
  },
  {
    id: 'oak-b', label: 'Westlands B', leagueShort: 'Oakhill',
    leagueName: 'Oakhill & District', L: 'OJ',
    urls: { team: teamUrl('OJ', 'Westlands B'), tables: 'https://www.cgleague.co.uk/oakhill/tables.php' },
  },
  {
    id: 'oak-c', label: 'Westlands C', leagueShort: 'Oakhill',
    leagueName: 'Oakhill & District', L: 'OJ',
    urls: { team: teamUrl('OJ', 'Westlands C'), tables: 'https://www.cgleague.co.uk/oakhill/tables.php' },
  },
  {
    id: 'ncl-1', label: 'Westlands 1', leagueShort: 'Newcastle',
    leagueName: 'Newcastle & District', L: 'Ncl',
    urls: { team: teamUrl('Ncl', 'Westlands 1'), tables: 'https://www.cgleague.co.uk/newcastle/tables.php' },
  },
  {
    id: 'ncl-2', label: 'Westlands 2', leagueShort: 'Newcastle',
    leagueName: 'Newcastle & District', L: 'Ncl',
    urls: { team: teamUrl('Ncl', 'Westlands 2'), tables: 'https://www.cgleague.co.uk/newcastle/tables.php' },
  },
  // Staffordshire Ladies sits on a different site (bowlsresults.co.uk).
  {
    id: 'sl-1', source: 'bowlsresults', label: 'Westlands 1', siteName: 'WESTLANDS 1',
    leagueShort: 'Staffordshire Ladies', leagueName: 'Staffordshire Ladies Bowls League',
    teamId: 16, division: 2, season: SEASON_DEFAULT,
    urls: {
      team: slUrl('teamfixtures.php', 'f=1&t=16&if=0'),
      division: slUrl('tables.php', 'f=0&d=2&m=0'),
      tables: slUrl('tables.php', 'f=0&d=-1&m=0'),
    },
    sources: {
      tables: slUrl('tables.php', 'f=0&d=2&m=0'),
      fixtures: slUrl('fixtures.php', 'f=0&d=2&m=0'),
      results: slUrl('results.php', 'f=0&d=2&m=0'),
      players: slUrl('teamaverages.php', 't=16&m=0&if=0'),
    },
  },
];
