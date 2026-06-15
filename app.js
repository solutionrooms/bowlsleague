// app.js — loads the baseline data.json for an instant paint, renders the
// board, then re-fetches every team LIVE from cgleague (via a CORS proxy)
// and re-renders each card as fresh data arrives.

import { parseTeamPage, parseDivPage, composeTeam } from './parser.js';
import { composeBowls } from './parser-bowlsresults.js';

const board = document.getElementById('board');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');
const nextupEl = document.getElementById('nextup');
const footUpdated = document.getElementById('foot-updated');

const state = { teams: [], cardEls: new Map() };

// ---- helpers -------------------------------------------------------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = n => {
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const divShort = d => (d || '').split(' - ')[0] || '';
const venueTag = v => (v ? `(${v[0].toUpperCase()})` : '');

function relTime(iso) {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function setStatus(kind, text) {
  statusEl.className = 'status ' + kind;
  statusEl.textContent = text;
}

// ---- rendering -----------------------------------------------------------
function gameBlock(label, g, cls) {
  if (!g) {
    const msg = label === 'Next' ? 'Season complete' : 'Not started';
    return `<div class="game ${cls}"><div class="game-label">${label}</div><div class="empty">${msg}</div></div>`;
  }
  const opp = `<div class="game-opp">vs ${esc(g.opponent)} <span class="ha">${venueTag(g.venue)}</span></div>`;
  if (g.played) {
    const r = g.result === 'W' ? 'win' : g.result === 'L' ? 'loss' : 'draw';
    return `<div class="game ${cls}">
      <div class="game-label">${label}</div>
      <div class="game-date">${esc(g.date)}</div>${opp}
      <div class="game-score ${r}">${g.for}–${g.against} <span class="badge ${r}">${g.result}</span></div>
    </div>`;
  }
  return `<div class="game ${cls}">
    <div class="game-label">${label}</div>
    <div class="game-date">${esc(g.date)}</div>${opp}
  </div>`;
}

function standingsTable(t) {
  if (!t.standings || !t.standings.length) return '';
  const rows = t.standings.map(s => `<tr class="${s.isWestlands ? 'me' : ''}">
    <td>${s.pos}</td><td class="name">${esc(s.name)}</td>
    <td>${s.p}</td><td>${s.w}</td><td>${s.l}</td><td>${s.total}</td><td>${esc(s.ave)}</td></tr>`).join('');
  return `<table class="mini"><thead><tr><th>#</th><th class="name">Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>Ave</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function fixturesTable(t) {
  if (!t.fixtures || !t.fixtures.length) return '<p class="note">No fixtures listed.</p>';
  const nextDate = t.nextGame ? t.nextGame.date : null;
  const rows = t.fixtures.map(f => {
    if (f.played) {
      const r = f.for > f.against ? 'res-w' : f.for < f.against ? 'res-l' : 'res-d';
      const res = f.for > f.against ? 'W' : f.for < f.against ? 'L' : 'D';
      const link = f.matchUrl ? `<a href="${esc(f.matchUrl)}" target="_blank" rel="noopener">${f.for}–${f.against}</a>` : `${f.for}–${f.against}`;
      return `<tr><td>${esc(f.date)}</td><td class="name">${esc(f.opponent)}</td><td>${venueTag(f.venue)}</td><td>${link} <span class="${r}">${res}</span></td></tr>`;
    }
    const isNext = f.date === nextDate;
    return `<tr class="upcoming ${isNext ? 'nextrow' : ''}"><td>${esc(f.date)}</td><td class="name">${esc(f.opponent)}</td><td>${venueTag(f.venue)}</td><td>${isNext ? 'next' : '—'}</td></tr>`;
  }).join('');
  return `<table class="mini"><thead><tr><th>Date</th><th class="name">Opponent</th><th>H/A</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function playersTable(t) {
  if (!t.players || !t.players.length) return '';
  const rows = t.players.map(p => {
    const name = p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name);
    return `<tr><td class="name">${name}</td><td>${p.played}</td><td class="w">${p.won}</td><td class="l">${p.lost}</td><td>${esc(p.ave)}</td></tr>`;
  }).join('');
  return `<table class="mini"><thead><tr><th class="name">Player</th><th>P</th><th>W</th><th>L</th><th>Ave</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function cardHTML(t) {
  const pos = t.position
    ? `<div class="pos ${t.position <= Math.ceil(t.teamsInDivision / 3) ? 'top' : t.position === t.teamsInDivision ? 'bottom' : ''}">${ordinal(t.position)}<small>of ${t.teamsInDivision}</small></div>`
    : '';

  if (t.error) {
    return `<div class="card-head"><div><span class="team-name">${esc(t.label)}</span><span class="division">${esc(t.leagueShort)}</span></div></div>
      <div class="more" style="display:block"><p class="note">Couldn't load this team right now. <a href="${esc(t.urls.team)}" target="_blank" rel="noopener">Open on cgleague ↗</a></p></div>`;
  }

  // Build the expandable tabs only for sections that have data.
  const tabs = [];
  if (t.standings && t.standings.length) tabs.push(['table', 'Table', standingsTable(t)]);
  tabs.push(['fixtures', 'Fixtures', fixturesTable(t)]);
  if (t.players && t.players.length) tabs.push(['players', 'Players', playersTable(t)]);

  const tabBtns = tabs.map((tb, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${tb[0]}">${tb[1]}</button>`).join('');
  const panels = tabs.map((tb, i) => `<div class="panel ${i === 0 ? 'active' : ''}" data-panel="${tb[0]}">${tb[2]}</div>`).join('');

  const sm = t.summary || {};
  const record = (sm.played != null) ? `<p class="note">Played ${sm.played} · Won ${sm.won} · Lost ${sm.lost} · ${sm.for}–${sm.against} pts</p>` : '';

  return `
    <div class="card-head">
      <div><span class="team-name">${esc(t.label)}</span><span class="division">${esc(divShort(t.division) || t.leagueShort)}</span></div>
      ${pos}
    </div>
    <div class="games">
      ${gameBlock('Last', t.lastGame, 'last')}
      ${gameBlock('Next', t.nextGame, 'next')}
    </div>
    <div class="card-links">
      <a href="${esc(t.urls.team)}" target="_blank" rel="noopener">Team page <span class="arr">↗</span></a>
      ${t.urls.division ? `<a href="${esc(t.urls.division)}" target="_blank" rel="noopener">Division table <span class="arr">↗</span></a>` : ''}
      <a href="${esc(t.urls.tables)}" target="_blank" rel="noopener">League tables <span class="arr">↗</span></a>
    </div>
    <button class="more-btn" type="button">More <span class="chev">▾</span></button>
    <div class="more">${record}<div class="tabs">${tabBtns}</div>${panels}</div>`;
}

function makeCard(t) {
  const el = document.createElement('article');
  el.className = 'card' + (t.error ? ' err' : '');
  el.dataset.id = t.id;
  el.innerHTML = cardHTML(t);
  return el;
}

function render() {
  state.cardEls.clear();
  board.innerHTML = '';
  // Group by leagueShort, preserving the order teams appear in the data.
  const groups = [];
  const byKey = new Map();
  for (const t of state.teams) {
    if (!byKey.has(t.leagueShort)) { byKey.set(t.leagueShort, []); groups.push(t.leagueShort); }
    byKey.get(t.leagueShort).push(t);
  }
  for (const key of groups) {
    const section = document.createElement('section');
    section.className = 'league';
    section.innerHTML = `<h2>${esc(key)}</h2>`;
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (const t of byKey.get(key)) {
      const el = makeCard(t);
      state.cardEls.set(t.id, el);
      cards.appendChild(el);
    }
    section.appendChild(cards);
    board.appendChild(section);
  }
  renderNextUp();
}

function replaceCard(t) {
  const old = state.cardEls.get(t.id);
  if (!old) return;
  const wasOpen = old.classList.contains('open');
  const activeTab = old.querySelector('.tab.active')?.dataset.tab;
  const el = makeCard(t);
  if (wasOpen) {
    el.classList.add('open');
    if (activeTab) selectTab(el, activeTab);
  }
  old.replaceWith(el);
  state.cardEls.set(t.id, el);
}

function renderNextUp() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.teams
    .filter(t => t.nextGame && t.nextGame.dateISO && t.nextGame.dateISO >= today)
    .sort((a, b) => a.nextGame.dateISO.localeCompare(b.nextGame.dateISO));
  if (!upcoming.length) { nextupEl.hidden = true; return; }
  const t = upcoming[0];
  const g = t.nextGame;
  nextupEl.hidden = false;
  nextupEl.innerHTML = `<span class="nu-label">Next up</span>
    <strong>${esc(t.label)}</strong> (${esc(t.leagueShort)}) vs ${esc(g.opponent)} ${venueTag(g.venue)} — ${esc(g.date)}`;
}

// ---- expand / tabs (event delegation) ------------------------------------
function selectTab(card, tab) {
  card.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  card.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}
board.addEventListener('click', e => {
  const moreBtn = e.target.closest('.more-btn');
  if (moreBtn) { moreBtn.closest('.card').classList.toggle('open'); return; }
  const tab = e.target.closest('.tab');
  if (tab) { selectTab(tab.closest('.card'), tab.dataset.tab); }
});

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
    try {
      const res = await fetch(proxy(target), { cache: 'no-store' });
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const txt = await res.text();
      if (txt && txt.length > 600 && /<\/(table|body|html)>/i.test(txt)) return txt;
      lastErr = new Error('unexpected content');
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('all proxies failed');
}

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
  const teamData = parseTeamPage(await proxyFetch(team.urls.team));
  let divData = null;
  if (team.urls.division) {
    try { divData = parseDivPage(await proxyFetch(team.urls.division)); } catch { /* keep prior standings */ }
  }
  const updated = composeTeam(config, teamData, divData);
  updated.error = null;
  return updated;
}
const extractTeamId = url => (/[?&]t=(\d+)\b/.exec(url || '') || [])[1];

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

async function liveRefresh() {
  refreshBtn.disabled = true;
  setStatus('snapshot', 'Fetching live scores…');
  let ok = 0, fail = 0;
  await mapLimit(state.teams.slice(), 3, async (team, idx) => {
    try {
      const fresh = await refreshTeam(team);
      state.teams[idx] = fresh;
      replaceCard(fresh);
      ok++;
    } catch { fail++; }
    renderNextUp();
  });
  if (ok > 0) {
    setStatus('live', `Live · updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
    footUpdated.textContent = `Last live refresh: ${new Date().toLocaleString('en-GB')}${fail ? ` · ${fail} team(s) couldn't refresh` : ''}`;
  } else {
    setStatus('snapshot', 'Showing saved snapshot · live refresh unavailable');
  }
  refreshBtn.disabled = false;
}

// ---- boot ----------------------------------------------------------------
async function init() {
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    const data = await res.json();
    state.teams = data.teams || [];
    render();
    setStatus('snapshot', `Snapshot · ${relTime(data.updated)}`);
    if (data.updated) footUpdated.textContent = `Snapshot built: ${new Date(data.updated).toLocaleString('en-GB')}`;
  } catch (e) {
    board.innerHTML = `<p class="loading">Couldn't load saved data. Trying live…</p>`;
  }
  liveRefresh();
}

refreshBtn.addEventListener('click', liveRefresh);
init();
