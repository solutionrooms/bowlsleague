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
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const target = new URL(request.url).searchParams.get('url');
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
