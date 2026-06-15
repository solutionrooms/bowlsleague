// Westlands Bowls CORS proxy (Cloudflare Worker).
//
// Fetches a whitelisted league page server-side, adds CORS headers so the
// static site can read it, and caches it at Cloudflare's edge so the source
// sites are hit at most once per cache window no matter how many visitors.
//
// Usage from the page:  https://<worker>.workers.dev/?url=<encoded target>

const ALLOWED = [
  'www.cgleague.co.uk', 'cgleague.co.uk',
  'bowlsresults.co.uk', 'www.bowlsresults.co.uk',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const reqUrl = new URL(request.url);

    // Usage logging: /log?e=event&p=player&d=detail  (country only, no IP)
    if (reqUrl.pathname === '/log') {
      const p = reqUrl.searchParams;
      const event = (p.get('e') || '').slice(0, 40);
      if (event && env.DB) {
        // Salted SHA-256 of the IP (first 64 bits) — counts unique devices
        // without storing the IP. The salt is a secret, so it isn't reversible.
        let iphash = '';
        const ip = request.headers.get('CF-Connecting-IP') || '';
        if (ip && env.IP_SALT) {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.IP_SALT + '|' + ip));
          iphash = [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        try {
          await env.DB.prepare(
            'INSERT INTO events (ts, country, iphash, event, player, detail) VALUES (?,?,?,?,?,?)'
          ).bind(
            new Date().toISOString(),
            request.headers.get('CF-IPCountry') || '',
            iphash,
            event,
            (p.get('p') || '').slice(0, 60),
            (p.get('d') || '').slice(0, 60),
          ).run();
        } catch (e) { /* never block on logging */ }
      }
      return new Response(null, { status: 204, headers: CORS });
    }

    // Private usage dashboard: /stats?pin=…  (PIN is a secret; page is unlinked)
    if (reqUrl.pathname === '/stats') {
      if (!env.STATS_PIN || reqUrl.searchParams.get('pin') !== env.STATS_PIN) {
        return new Response('Forbidden', { status: 401, headers: { 'Content-Type': 'text/plain' } });
      }
      if (!env.DB) return new Response('no database', { status: 500 });
      const q = async sql => ((await env.DB.prepare(sql).all()).results || []);
      const h = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const [tot] = await q("SELECT COUNT(DISTINCT iphash) d, COUNT(*) e FROM events WHERE iphash<>''");
      const players = await q("SELECT player, COUNT(DISTINCT iphash) devices, COUNT(*) actions, MAX(ts) last FROM events WHERE player<>'' GROUP BY player ORDER BY actions DESC LIMIT 60");
      const days = await q("SELECT substr(ts,1,10) day, COUNT(DISTINCT iphash) devices, COUNT(*) events FROM events GROUP BY day ORDER BY day DESC LIMIT 14");
      const recent = await q("SELECT ts, country, event, player, detail FROM events ORDER BY id DESC LIMIT 50");
      const tbl = (cols, rows) => `<table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => `<td>${h(c[1](r))}</td>`).join('')}</tr>`).join('')}</table>`;
      const tm = s => String(s || '').slice(0, 16).replace('T', ' ');
      const html = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Westlands Bowls · usage</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#11140f;color:#e9ede8;padding:16px;font-size:14px;line-height:1.4}h1{font-size:1.15rem;margin:0 0 8px}h2{font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:#98a298;margin:22px 0 6px}table{border-collapse:collapse;width:100%;max-width:700px}th,td{text-align:left;padding:5px 9px;border-bottom:1px solid #2a3128;white-space:nowrap}th{color:#98a298;font-size:.7rem;text-transform:uppercase}td:first-child,th:first-child{white-space:normal}.big{font-size:1.7rem;font-weight:800;color:#36a35a}.muted{color:#98a298;font-size:.8rem}</style></head>
<body><h1>🟢 Westlands Bowls — usage</h1>
<p><span class=big>${tot?.d || 0}</span> unique devices · <span class=big>${tot?.e || 0}</span> events <span class=muted>(since hashed-IP logging began)</span></p>
<h2>Players</h2>${tbl([['Player', r => r.player], ['Devices', r => r.devices], ['Actions', r => r.actions], ['Last seen', r => tm(r.last)]], players)}
<h2>By day</h2>${tbl([['Day', r => r.day], ['Devices', r => r.devices], ['Events', r => r.events]], days)}
<h2>Recent activity</h2>${tbl([['Time', r => tm(r.ts)], ['Ctry', r => r.country], ['Event', r => r.event], ['Player', r => r.player], ['Detail', r => r.detail]], recent)}
<p class=muted>Times are UTC (BST = +1). No IP addresses stored — only a salted hash.</p></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' } });
    }

    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('missing ?url', { status: 400, headers: CORS });

    let t;
    try { t = new URL(target); } catch { return new Response('bad url', { status: 400, headers: CORS }); }
    if (!ALLOWED.includes(t.hostname)) return new Response('host not allowed', { status: 403, headers: CORS });

    t.searchParams.delete('_'); // drop the page's cache-buster so the edge cache stays effective

    // Finished match pages are immutable-ish (cache long); tables/fixtures move (cache short).
    const ttl = /match(es)?\.php/i.test(t.pathname) ? 1800 : 180;

    let upstream;
    try {
      upstream = await fetch(t.toString(), {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        cf: { cacheTtl: ttl, cacheEverything: true },
      });
    } catch (e) {
      return new Response('upstream error: ' + e.message, { status: 502, headers: CORS });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    });
  },
};
