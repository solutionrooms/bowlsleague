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
