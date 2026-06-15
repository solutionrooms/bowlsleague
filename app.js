// app.js — paints from the data.json snapshot, then re-fetches each team live
// from the source sites (via a CORS proxy) and re-renders rows in place.

import { parseTeamPage, parseDivPage, composeTeam } from './parser.js';
import { composeBowls } from './parser-bowlsresults.js';

const board = document.getElementById('board');
const nextupEl = document.getElementById('nextup');
const refreshBtn = document.getElementById('refresh');
const updTime = document.getElementById('upd-time');

const state = { teams: [], rowEls: new Map(), weekExpanded: false };

// ---- helpers -------------------------------------------------------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
// Division headings vary ("Division 2 - Season 2026", "Thursday Division - Division 3 - Season 2026",
// or just "Season 2026"). Prefer the "Division X" segment; fall back to the D code in the link.
function divShort(d) {
  const parts = (d || '').split(' - ').map(s => s.trim()).filter(s => s && !/^season\b/i.test(s));
  const pick = parts.find(p => /^division\s+\S+/i.test(p)) || parts.find(p => /division/i.test(p)) || parts[parts.length - 1] || '';
  return pick.replace(/^Division\s*/i, 'Div ');
}
function divLabel(t) {
  const s = divShort(t.division);
  if (s) return s;
  const m = /[?&]d=([^&]+)/i.exec(t.urls.division || '');
  return m ? 'Div ' + decodeURIComponent(m[1]) : t.leagueShort;
}
const venueTag = v => (v ? `(${v[0].toUpperCase()})` : '');

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = iso => { const [y, m, d] = (iso || '').split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const fShort = (iso, raw) => { const dt = ymd(iso); return dt ? `${WD[dt.getDay()]} ${dt.getDate()}` : (raw || ''); };
const fFull = (iso, raw) => { const dt = ymd(iso); return dt ? `${WD[dt.getDay()]} ${dt.getDate()} ${MO[dt.getMonth()]}` : (raw || ''); };
const localISO = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const TODAY = localISO(new Date());
const PLUS7 = localISO(new Date(Date.now() + 7 * 864e5));

// ---- a single compact team row -------------------------------------------
function teamRowHTML(t) {
  const teamLink = t.urls.team;
  if (t.error) {
    return `<div class="t-id"><a class="name" href="${esc(teamLink)}" target="_blank" rel="noopener">${esc(t.label)}</a><span class="div">couldn't load — tap to open</span></div>`;
  }
  const divLink = t.urls.division || t.urls.tables;
  const posCls = t.position ? (t.position <= Math.ceil((t.teamsInDivision || 1) / 3) ? 'top' : t.position === t.teamsInDivision ? 'bottom' : '') : '';
  const posHtml = t.position ? `<span class="pos ${posCls}">${ordinal(t.position)}</span>` : '';
  const divText = divLabel(t);

  const lg = t.lastGame;
  const lastHtml = lg
    ? `<a class="g ${lg.result === 'W' ? 'win' : lg.result === 'L' ? 'loss' : 'draw'}" href="${esc(lg.matchUrl || teamLink)}" target="_blank" rel="noopener"><b class="res">${lg.result}</b><span class="sc">${lg.for}–${lg.against}</span><span class="opp">${esc(lg.opponent)} ${venueTag(lg.venue)}</span></a>`
    : `<span class="g empty"><b class="res">·</b>no result yet</span>`;

  const ng = t.nextGame;
  const nextHtml = ng
    ? `<a class="g next" href="${esc(ng.matchUrl || teamLink)}" target="_blank" rel="noopener"><span class="d">▸ ${esc(fShort(ng.dateISO, ng.date))}</span><span class="opp">${esc(ng.opponent)} ${venueTag(ng.venue)}</span></a>`
    : `<span class="g empty next"><span class="d">▸</span>season done</span>`;

  return `<div class="t-id">${posHtml}<a class="name" href="${esc(teamLink)}" target="_blank" rel="noopener">${esc(t.label)}</a><a class="div" href="${esc(divLink)}" target="_blank" rel="noopener">${esc(divText)}</a></div>
    <div class="games">${lastHtml}${nextHtml}</div>`;
}

function render() {
  state.rowEls.clear();
  board.innerHTML = '';
  const order = [];
  const by = new Map();
  for (const t of state.teams) {
    if (!by.has(t.leagueShort)) { by.set(t.leagueShort, []); order.push(t.leagueShort); }
    by.get(t.leagueShort).push(t);
  }
  for (const key of order) {
    const teams = by.get(key);
    const sec = document.createElement('section');
    sec.className = 'lg';
    sec.innerHTML = `<a class="lg-h" href="${esc(teams[0].urls.tables)}" target="_blank" rel="noopener">${esc(key)} <span class="arr">↗</span></a>`;
    const cont = document.createElement('div');
    cont.className = 'teams';
    for (const t of teams) {
      const el = document.createElement('div');
      el.className = 'team';
      el.dataset.id = t.id;
      el.innerHTML = teamRowHTML(t);
      state.rowEls.set(t.id, el);
      cont.appendChild(el);
    }
    sec.appendChild(cont);
    board.appendChild(sec);
  }
  renderNextUp();
}

function replaceRow(t) {
  const el = state.rowEls.get(t.id);
  if (el) el.innerHTML = teamRowHTML(t);
}

function renderNextUp() {
  const list = [];
  for (const t of state.teams) {
    for (const f of (t.fixtures || [])) {
      if (!f.played && f.dateISO && f.dateISO >= TODAY && f.dateISO <= PLUS7) {
        list.push({ dateISO: f.dateISO, league: t.leagueShort, team: t.label, opponent: f.opponent, venue: f.venue, link: f.matchUrl || t.urls.team });
      }
    }
  }
  list.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.league.localeCompare(b.league) || a.team.localeCompare(b.team));
  if (!list.length) {
    nextupEl.innerHTML = `<h2>Next games</h2><div class="nu-empty">No games scheduled in the next 7 days.</div>`;
    return;
  }
  // Group by day; show only the next matchday, with the rest behind an expander.
  const days = [];
  const byDay = new Map();
  for (const x of list) {
    if (!byDay.has(x.dateISO)) { byDay.set(x.dateISO, []); days.push(x.dateISO); }
    byDay.get(x.dateISO).push(x);
  }
  const renderDay = iso => {
    const games = byDay.get(iso).map(x => {
      const home = x.venue === 'Home';
      return `<a class="nu" href="${esc(x.link)}" target="_blank" rel="noopener"><span class="nu-lg">${esc(x.league)}</span><span class="nu-t">${esc(x.team)}</span><span class="nu-vs">${home ? 'vs' : 'at'} ${esc(x.opponent)} · <span class="nu-loc ${home ? 'home' : 'away'}">${home ? 'Home' : 'Away'}</span></span></a>`;
    }).join('');
    return `<div class="nu-day">${esc(fFull(iso))}</div>${games}`;
  };
  const restDays = days.slice(1);
  let extra = '';
  if (restDays.length) {
    if (state.weekExpanded) {
      extra = restDays.map(renderDay).join('') + `<button class="nu-expand" type="button">Show less ▴</button>`;
    } else {
      const more = restDays.reduce((n, iso) => n + byDay.get(iso).length, 0);
      extra = `<button class="nu-expand" type="button">Full week · ${more} more ▾</button>`;
    }
  }
  nextupEl.innerHTML = `<h2>Next games</h2>${renderDay(days[0])}${extra}`;
}

// ---- live refresh via CORS proxy -----------------------------------------
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
];
const bust = u => u + (u.includes('?') ? '&' : '?') + '_=' + Date.now();

async function proxyFetch(url) {
  const target = bust(url);
  let lastErr;
  for (const proxy of PROXIES) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(proxy(target), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const txt = await res.text(); // body read is covered by the same timeout/abort
      if (txt && txt.length > 600 && /<\/(table|body|html)>/i.test(txt)) return txt;
      lastErr = new Error('unexpected content');
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('all proxies failed');
}

const extractTeamId = url => (/[?&]t=(\d+)\b/.exec(url || '') || [])[1];

async function refreshTeam(team) {
  if (team.source === 'bowlsresults') {
    const s = team.sources;
    const [tables, fixtures, results, players] = await Promise.all([
      proxyFetch(s.tables), proxyFetch(s.fixtures), proxyFetch(s.results), proxyFetch(s.players),
    ]);
    const config = {
      id: team.id, label: team.label, siteName: team.label.toUpperCase(),
      leagueShort: team.leagueShort, leagueName: team.leagueName,
      teamId: extractTeamId(s.players), division: team.division, urls: team.urls, sources: s,
    };
    return composeBowls(config, { tables, fixtures, results, players });
  }
  const config = { id: team.id, label: team.label, leagueShort: team.leagueShort, leagueName: team.leagueName, urls: team.urls };
  // Fetch the team page and division table in parallel (not sequentially).
  const [teamHtml, divHtml] = await Promise.all([
    proxyFetch(team.urls.team),
    team.urls.division ? proxyFetch(team.urls.division).catch(() => null) : Promise.resolve(null),
  ]);
  const teamData = parseTeamPage(teamHtml);
  const divData = divHtml ? parseDivPage(divHtml) : null;
  const updated = composeTeam(config, teamData, divData);
  updated.source = 'cgleague';
  updated.error = null;
  return updated;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

async function liveRefresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '↻ Updating…';
  let ok = 0;
  await mapLimit(state.teams.slice(), 6, async (team, idx) => {
    try { const fresh = await refreshTeam(team); state.teams[idx] = fresh; replaceRow(fresh); ok++; } catch { /* keep snapshot row */ }
    renderNextUp();
  });
  refreshBtn.disabled = false;
  refreshBtn.textContent = '↻ Update';
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  updTime.textContent = ok ? `Updated ${now}` : 'Showing saved data';
}

// ---- boot ----------------------------------------------------------------
async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    const data = await res.json();
    state.teams = data.teams || [];
    render();
    if (data.updated) updTime.textContent = `Snapshot ${new Date(data.updated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    board.innerHTML = `<p class="loading">Couldn't load saved data — fetching live…</p>`;
  }
  liveRefresh();
}

refreshBtn.addEventListener('click', liveRefresh);
nextupEl.addEventListener('click', e => {
  if (e.target.closest('.nu-expand')) { state.weekExpanded = !state.weekExpanded; renderNextUp(); }
});
init();
