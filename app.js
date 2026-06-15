// app.js — paints from the data.json snapshot, then re-fetches each team live
// from the source sites (via a CORS proxy). Supports "signing in" as a player
// (stored locally + in the URL) to filter to that player's leagues.

import { parseTeamPage, parseDivPage, composeTeam, parseMatchPage } from './parser.js?v=DEV';
import { composeBowls } from './parser-bowlsresults.js?v=DEV';

const $ = id => document.getElementById(id);
const board = $('board'), nextupEl = $('nextup'), refreshBtn = $('refresh'), updTime = $('upd-time');
const meBtn = $('me-btn'), scopeEl = $('scope'), clubstatEl = $('clubstat');
const gamesView = $('games-view'), rankingsView = $('rankings-view'), rankingsEl = $('rankings');
const picker = $('picker'), pickerList = $('picker-list'), pickerSearch = $('picker-search');

const LS_ME = 'wb.me', LS_SCOPE = 'wb.scope', LS_TAB = 'wb.tab', LS_MATCHES = 'wb.matches', LS_CUTOFF = 'wb.cutoff';
const MATCH_CACHE_VER = 2; // bump when parseMatchPage changes, to drop stale cached parses
const state = {
  teams: [], roster: [], aliases: {}, rowEls: new Map(), weekExpanded: false,
  me: null, scope: 'mine', tab: 'games',
  matches: {}, matchTs: 0, playerStats: [], clubGame: null, cutoff: true, rankExpanded: false,
};
const canonC = n => state.aliases[n] || n;

// Fire-and-forget usage logging via the Worker (country + event + player; no IP).
function logEvent(event, detail) {
  try {
    if (!WORKER_PROXY) return;
    const u = `${WORKER_PROXY}/log?e=${encodeURIComponent(event)}&p=${encodeURIComponent(state.me || '')}&d=${encodeURIComponent(detail || '')}`;
    if (navigator.sendBeacon) navigator.sendBeacon(u);
    else fetch(u, { method: 'POST', mode: 'no-cors', keepalive: true }).catch(() => {});
  } catch { /* never block on logging */ }
}

// ---- helpers -------------------------------------------------------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
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

// ---- identity / filtering ------------------------------------------------
const rosterEntry = name => state.roster.find(x => x.name.toLowerCase() === String(name || '').toLowerCase());
const rosterLeagues = name => (rosterEntry(name) || {}).leagues || [];
const rosterTeams = name => (rosterEntry(name) || {}).teams || [];
// Games board filters by the exact teams the player has turned out for...
function allowedTeams() {
  if (!state.me || state.scope !== 'mine') return null;
  const t = rosterTeams(state.me);
  return t.length ? new Set(t) : null;
}
// ...rankings filter by the leagues those teams are in.
function allowedLeaguesSet() {
  if (!state.me || state.scope !== 'mine') return null;
  const l = rosterLeagues(state.me);
  return l.length ? new Set(l) : null;
}
function saveIdentity() {
  if (state.me) {
    localStorage.setItem(LS_ME, state.me);
    localStorage.setItem(LS_SCOPE, state.scope);
    history.replaceState(null, '', '#me=' + encodeURIComponent(state.me));
  } else {
    localStorage.removeItem(LS_ME);
    history.replaceState(null, '', location.pathname + location.search);
  }
}
function readIdentity() {
  const m = /[#&]me=([^&]+)/.exec(location.hash);
  const fromUrl = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  state.me = fromUrl || localStorage.getItem(LS_ME) || null;
  state.scope = localStorage.getItem(LS_SCOPE) || 'mine';
}
function setMe(name) { state.me = name; saveIdentity(); updateChrome(); renderAll(); logEvent('pick', name); }
function clearMe() { state.me = null; saveIdentity(); updateChrome(); renderAll(); }
function setScope(s) { state.scope = s; saveIdentity(); updateChrome(); renderAll(); logEvent('scope', s); }

function updateChrome() {
  if (state.me) {
    meBtn.textContent = '👤 ' + state.me;
    meBtn.classList.add('on');
    scopeEl.hidden = false;
    scopeEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.scope === state.scope));
  } else {
    meBtn.textContent = '👤 It\'s me';
    meBtn.classList.remove('on');
    scopeEl.hidden = true;
  }
}
function setTab(tab) {
  state.tab = tab;
  localStorage.setItem(LS_TAB, tab);
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  gamesView.hidden = tab !== 'games';
  rankingsView.hidden = tab !== 'rankings';
}

// ---- rendering -----------------------------------------------------------
function teamRowHTML(t) {
  const teamLink = t.urls.team;
  if (t.error) {
    return `<div class="t-id"><a class="name" href="${esc(teamLink)}">${esc(t.label)}</a><span class="div">couldn't load — tap to open</span></div>`;
  }
  const divLink = t.urls.division || t.urls.tables;
  const posCls = t.position ? (t.position <= Math.ceil((t.teamsInDivision || 1) / 3) ? 'top' : t.position === t.teamsInDivision ? 'bottom' : '') : '';
  const posHtml = t.position ? `<span class="pos ${posCls}">${ordinal(t.position)}</span>` : '';

  const lg = t.lastGame;
  const lastHtml = lg
    ? `<a class="g ${lg.result === 'W' ? 'win' : lg.result === 'L' ? 'loss' : 'draw'}" href="${esc(lg.matchUrl || teamLink)}"><b class="res">${lg.result}</b><span class="sc">${lg.for}–${lg.against}</span><span class="opp">${esc(lg.opponent)} ${venueTag(lg.venue)}</span></a>`
    : `<span class="g empty"><b class="res">·</b>no result yet</span>`;
  const ng = t.nextGame;
  const nextHtml = ng
    ? `<a class="g next" href="${esc(ng.matchUrl || teamLink)}"><span class="d">▸ ${esc(fShort(ng.dateISO, ng.date))}</span><span class="opp">${esc(ng.opponent)} ${venueTag(ng.venue)}</span></a>`
    : `<span class="g empty next"><span class="d">▸</span>season done</span>`;

  return `<div class="t-id">${posHtml}<a class="name" href="${esc(teamLink)}">${esc(t.label)}</a><a class="div" href="${esc(divLink)}">${esc(divLabel(t))}</a></div>
    <div class="games">${lastHtml}${nextHtml}</div>`;
}

function render() {
  const allowed = allowedTeams();
  state.rowEls.clear();
  board.innerHTML = '';
  const order = [];
  const by = new Map();
  for (const t of state.teams) {
    if (allowed && !allowed.has(t.id)) continue;
    if (!by.has(t.leagueShort)) { by.set(t.leagueShort, []); order.push(t.leagueShort); }
    by.get(t.leagueShort).push(t);
  }
  if (!order.length) {
    board.innerHTML = `<p class="loading">No leagues to show.</p>`;
    return;
  }
  for (const key of order) {
    const teams = by.get(key);
    const sec = document.createElement('section');
    sec.className = 'lg';
    sec.innerHTML = `<a class="lg-h" href="${esc(teams[0].urls.tables)}">${esc(key)} <span class="arr">↗</span></a>`;
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
}

function replaceRow(t) {
  const el = state.rowEls.get(t.id);
  if (el) el.innerHTML = teamRowHTML(t);
}

function renderNextUp() {
  const allowed = allowedTeams();
  const list = [];
  for (const t of state.teams) {
    if (allowed && !allowed.has(t.id)) continue;
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
  const days = [];
  const byDay = new Map();
  for (const x of list) {
    if (!byDay.has(x.dateISO)) { byDay.set(x.dateISO, []); days.push(x.dateISO); }
    byDay.get(x.dateISO).push(x);
  }
  const renderDay = iso => {
    const games = byDay.get(iso).map(x => {
      const home = x.venue === 'Home';
      return `<a class="nu" href="${esc(x.link)}"><span class="nu-lg">${esc(x.league)}</span><span class="nu-t">${esc(x.team)}</span><span class="nu-vs">${home ? 'vs' : 'at'} ${esc(x.opponent)} · <span class="nu-loc ${home ? 'home' : 'away'}">${home ? 'Home' : 'Away'}</span></span></a>`;
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

// Club average. Once results are loaded we can show average score per game
// (to 21), split home/away — comparable across leagues. Before then, fall back
// to the per-match aggregate (which isn't comparable across leagues).
function renderClubStat() {
  if (state.clubGame && (state.clubGame.home.games || state.clubGame.away.games)) {
    const g = state.clubGame;
    const avg = o => (o.games ? (o.for / o.games).toFixed(1) : '–');
    clubstatEl.hidden = false;
    clubstatEl.innerHTML = `<div class="cs-big">${avg(g.home)}<span class="vs"> home · </span>${avg(g.away)}<span class="vs"> away</span></div>
      <div class="cs-sub">club average <b>score per game</b> (to 21) · ${g.home.games + g.away.games} games played</div>`;
    return;
  }
  let P = 0, W = 0, L = 0, n = 0;
  for (const t of state.teams) {
    const s = t.summary;
    if (!s || s.played == null) continue;
    P += s.played || 0; W += s.won || 0; L += s.lost || 0; n++;
  }
  if (!P) { clubstatEl.hidden = true; return; }
  clubstatEl.hidden = false;
  clubstatEl.innerHTML = `<div class="cs-sub"><b>${W}W</b>–<b>${L}L</b> across ${n} teams · tap “Get latest results” for average score per game</div>`;
}

// Aggregate per-player and per-venue scoring. Bowls averages come free from
// data.json; cgleague comes from on-demand match pages cached in state.matches.
function buildAgg() {
  const agg = new Map();
  const get = name => {
    if (!agg.has(name)) agg.set(name, { name, games: 0, sumFor: 0, sumAgainst: 0, won: 0, lost: 0, leagues: new Set() });
    return agg.get(name);
  };
  const club = { home: { for: 0, against: 0, games: 0 }, away: { for: 0, against: 0, games: 0 } };
  let haveCg = false;
  for (const t of state.teams) {
    if (t.source === 'bowlsresults') {
      for (const p of (t.players || [])) {
        const e = get(canonC(p.name));
        e.games += p.played || 0; e.sumFor += p.for || 0; e.sumAgainst += p.against || 0;
        e.won += p.won || 0; e.lost += p.lost || 0; e.leagues.add(t.leagueShort);
      }
      for (const f of (t.fixtures || [])) {
        if (f.played && f.rinks) { const v = f.venue === 'Home' ? 'home' : 'away'; club[v].for += f.for; club[v].against += f.against; club[v].games += f.rinks; }
      }
    } else {
      for (const f of (t.fixtures || [])) {
        const m = f.played && f.matchUrl && state.matches[f.matchUrl];
        if (!m) continue;
        haveCg = true;
        const home = f.venue === 'Home';
        for (const g of m.games) {
          const pl = home ? g.hp : g.ap, sf = home ? g.hs : g.as, sa = home ? g.as : g.hs;
          if (!pl || sf > 30 || sa > 30) continue; // guard against summary rows in stale caches
          const e = get(canonC(pl));
          e.games++; e.sumFor += sf; e.sumAgainst += sa; e.won += sf > sa ? 1 : 0; e.lost += sf < sa ? 1 : 0; e.leagues.add(t.leagueShort);
          const v = home ? 'home' : 'away'; club[v].for += sf; club[v].against += sa; club[v].games++;
        }
      }
    }
  }
  state.playerStats = [...agg.values()].map(e => ({
    name: e.name, games: e.games, avgFor: e.games ? e.sumFor / e.games : 0,
    won: e.won, lost: e.lost, leagues: [...e.leagues].sort(),
  }));
  state.clubGame = haveCg ? club : null;
  state.haveCg = haveCg;
}

// Player rankings — by average score per game (to 21). Top 10, then "more".
function renderRankings() {
  const allowed = allowedLeaguesSet();
  let list = state.playerStats.filter(p => !allowed || p.leagues.some(l => allowed.has(l)));
  if (state.cutoff) list = list.filter(p => p.games >= 5);
  list.sort((a, b) => b.avgFor - a.avgFor || b.games - a.games || a.name.localeCompare(b.name));
  const meName = (state.me || '').toLowerCase();
  const shown = state.rankExpanded ? list : list.slice(0, 10);
  const rows = shown.map((p, i) =>
    `<div class="rank-row clk ${p.name.toLowerCase() === meName ? 'me' : ''}" data-name="${esc(p.name)}"><span class="rk-pos">${i + 1}</span>` +
    `<div class="rk-main"><div class="rk-line1"><span class="rk-name">${esc(p.name)}</span><span class="rk-gp">${p.games} games · ${p.won}–${p.lost}</span></div>` +
    `<div class="rk-sub">${esc(p.leagues.join(' · '))}</div></div>` +
    `<span class="rk-pct">${p.avgFor.toFixed(1)}</span></div>`
  ).join('');
  const ctl = `<div class="rk-ctl"><span>avg score per game${allowed ? ' · your leagues' : ''}</span><button class="rk-cut ${state.cutoff ? 'on' : ''}" type="button" data-cut>Min 5 games</button></div>`;
  const note = state.haveCg ? '' : `<div class="rk-note">Showing Staffordshire Ladies only — tap “Get latest results” above to include the cgleague leagues.</div>`;
  const more = list.length > 10
    ? (state.rankExpanded ? `<button class="nu-expand" type="button" data-rk="less">Show top 10 ▴</button>` : `<button class="nu-expand" type="button" data-rk="more">Show all ${list.length} ▾</button>`)
    : '';
  const body = shown.length ? `<div class="rank-list">${rows}</div>${more}` : `<div class="rk-empty">No players (try turning off the 5-game minimum).</div>`;
  rankingsEl.innerHTML = ctl + note + body;
}

function renderAll() { buildAgg(); render(); renderNextUp(); renderClubStat(); renderRankings(); }

// ---- expand / scope / picker events --------------------------------------
nextupEl.addEventListener('click', e => {
  if (e.target.closest('.nu-expand')) { state.weekExpanded = !state.weekExpanded; renderNextUp(); }
});
scopeEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setScope(b.dataset.scope);
});
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (b) { setTab(b.dataset.tab); logEvent('tab', b.dataset.tab); }
});

function pickerItems(filter) {
  const f = filter.trim().toLowerCase();
  const matches = state.roster.filter(r => !f || r.name.toLowerCase().includes(f));
  if (!matches.length) return `<div class="pk-none">No players match “${esc(filter)}”.</div>`;
  return matches.map(r =>
    `<button class="pk-item ${r.name === state.me ? 'cur' : ''}" data-name="${esc(r.name)}"><span class="pk-name">${esc(r.name)}</span><span class="pk-lg">${esc(r.leagues.join(' · '))}</span></button>`
  ).join('');
}
function openPicker() {
  pickerSearch.value = '';
  pickerList.innerHTML = pickerItems('');
  picker.hidden = false;
  pickerSearch.focus();
}
function closePicker() { picker.hidden = true; }

// A player's full game-by-game list (from cached cgleague match pages).
function playerGames(name) {
  const target = canonC(name).toLowerCase();
  const out = [];
  for (const t of state.teams) {
    if (t.source === 'bowlsresults') continue; // bowls has no per-rink detail
    for (const f of (t.fixtures || [])) {
      const m = f.played && f.matchUrl && state.matches[f.matchUrl];
      if (!m) continue;
      const home = f.venue === 'Home';
      for (const g of m.games) {
        const pl = home ? g.hp : g.ap, my = home ? g.hs : g.as, opp = home ? g.as : g.hs, oppP = home ? g.ap : g.hp;
        if (my > 30 || opp > 30) continue;
        if (canonC(pl).toLowerCase() === target) {
          out.push({ dateISO: f.dateISO, date: f.date, oppTeam: f.opponent, venue: f.venue, my, opp, oppP, url: f.matchUrl });
        }
      }
    }
  }
  out.sort((a, b) => (a.dateISO || '').localeCompare(b.dateISO || ''));
  return out;
}
function openPlayerModal(name) {
  $('pm-name').textContent = name;
  const games = playerGames(name);
  let html;
  if (games.length) {
    const w = games.filter(g => g.my > g.opp).length, l = games.filter(g => g.my < g.opp).length;
    const avg = (games.reduce((s, g) => s + g.my, 0) / games.length).toFixed(1);
    const rows = games.map(g => {
      const res = g.my > g.opp ? 'win' : g.my < g.opp ? 'loss' : 'draw';
      return `<a class="pg" href="${esc(g.url)}"><span class="pg-d">${esc(fShort(g.dateISO, g.date))}</span>` +
        `<span class="pg-opp">${esc(g.oppP)} · ${esc(g.oppTeam)} ${g.venue === 'Home' ? '(H)' : '(A)'}</span>` +
        `<span class="pg-sc ${res}">${g.my}–${g.opp}</span></a>`;
    }).join('');
    html = `<div class="pm-sum">${games.length} games · ${w}–${l} · avg ${avg}</div>${rows}`;
  } else {
    const bowls = state.teams.some(t => t.source === 'bowlsresults' && (t.players || []).some(p => canonC(p.name).toLowerCase() === canonC(name).toLowerCase()));
    html = `<div class="pk-none">${bowls
      ? 'Per-game detail isn’t published for Staffordshire Ladies (only averages).'
      : 'Tap “Get latest results” first to load match scores.'}</div>`;
  }
  $('pm-list').innerHTML = html;
  $('pmodal').hidden = false;
}
function closePlayerModal() { $('pmodal').hidden = true; }
$('pm-close').addEventListener('click', closePlayerModal);
$('pmodal').addEventListener('click', e => { if (e.target === $('pmodal')) closePlayerModal(); });

meBtn.addEventListener('click', openPicker);
$('picker-close').addEventListener('click', closePicker);
$('picker-clear').addEventListener('click', () => { closePicker(); clearMe(); });
picker.addEventListener('click', e => { if (e.target === picker) closePicker(); });
pickerSearch.addEventListener('input', () => { pickerList.innerHTML = pickerItems(pickerSearch.value); });
pickerList.addEventListener('click', e => {
  const item = e.target.closest('.pk-item');
  if (item) { closePicker(); setMe(item.dataset.name); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!picker.hidden) closePicker();
  if (!$('pmodal').hidden) closePlayerModal();
});

// ---- live refresh via CORS proxy -----------------------------------------
// Our own Cloudflare Worker (reliable + caches, kind to the source sites).
// Paste your deployed URL here to prefer it; public proxies stay as fallback.
const WORKER_PROXY = 'https://bowls-proxy.jon-scott.workers.dev';
const PROXIES = [
  ...(WORKER_PROXY ? [u => `${WORKER_PROXY}/?url=${encodeURIComponent(u)}`] : []),
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
      const txt = await res.text();
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
  buildAgg();
  renderClubStat();
  renderRankings();
  refreshBtn.disabled = false;
  refreshBtn.textContent = '↻ Update';
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  updTime.textContent = ok ? `Updated ${now}` : 'Showing saved data';
}

// ---- on-demand match results (player averages, per-game club stat) -------
function loadMatches() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_MATCHES) || '{}');
    if (c.ver === MATCH_CACHE_VER) { state.matches = c.matches || {}; state.matchTs = c.ts || 0; }
  } catch { /* ignore */ }
}
function saveMatches() {
  try { localStorage.setItem(LS_MATCHES, JSON.stringify({ ver: MATCH_CACHE_VER, ts: state.matchTs, matches: state.matches })); } catch { /* quota */ }
}
async function getResults() {
  const btn = $('get-results'), note = $('gr-note');
  logEvent('results');
  const urls = [];
  for (const t of state.teams) {
    if (t.source === 'bowlsresults') continue; // bowls averages come free in data.json
    for (const f of (t.fixtures || [])) {
      if (f.played && f.matchUrl && !state.matches[f.matchUrl]) urls.push(f.matchUrl);
    }
  }
  btn.disabled = true;
  let ok = 0;
  if (urls.length) {
    let done = 0;
    note.textContent = ` · loading 0/${urls.length}…`;
    await mapLimit(urls, 6, async url => {
      try { const r = parseMatchPage(await proxyFetch(url)); if (r.games.length) { state.matches[url] = r; ok++; } } catch { /* skip failed */ }
      done++; note.textContent = ` · loading ${done}/${urls.length}…`;
    });
    if (ok) { state.matchTs = Date.now(); saveMatches(); }
  }
  btn.disabled = false;
  const stamp = state.matchTs ? ` · updated ${new Date(state.matchTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
  note.textContent = (urls.length && !ok) ? ' · couldn’t reach results — try again' : stamp;
  buildAgg(); renderClubStat(); renderRankings();
}

$('get-results').addEventListener('click', getResults);
rankingsEl.addEventListener('click', e => {
  if (e.target.closest('[data-rk="more"]')) { state.rankExpanded = true; renderRankings(); }
  else if (e.target.closest('[data-rk="less"]')) { state.rankExpanded = false; renderRankings(); }
  else if (e.target.closest('[data-cut]')) { state.cutoff = !state.cutoff; localStorage.setItem(LS_CUTOFF, state.cutoff ? 'on' : 'off'); renderRankings(); }
  else { const row = e.target.closest('.rank-row'); if (row && row.dataset.name) { openPlayerModal(row.dataset.name); logEvent('player', row.dataset.name); } }
});

// ---- boot ----------------------------------------------------------------
async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    const data = await res.json();
    state.teams = data.teams || [];
    state.roster = data.roster || [];
    state.aliases = data.aliases || {};
    state.cutoff = localStorage.getItem(LS_CUTOFF) !== 'off';
    loadMatches();
    readIdentity();
    setTab(localStorage.getItem(LS_TAB) || 'games');
    updateChrome();
    renderAll();
    logEvent('open');
    if (state.matchTs) $('gr-note').textContent = ` · updated ${new Date(state.matchTs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    if (data.updated) updTime.textContent = `Snapshot ${new Date(data.updated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    board.innerHTML = `<p class="loading">Couldn't load saved data — fetching live…</p>`;
  }
  liveRefresh();
}

refreshBtn.addEventListener('click', liveRefresh);
init();
