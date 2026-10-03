// Vercel serverless function: GET /api/where?id=<shelf id>&region=<country code>
// Live "where to watch" for a title that is ALREADY on the shelf, from TMDB's watch-provider data (sourced from JustWatch).
// The TMDB key lives ONLY in the TMDB_API_KEY environment variable. It is never sent to the browser.
// Only shelf ids are accepted (never free text), so this cannot be used as a general-purpose proxy.
const { CATALOG } = require('../lib/catalog');
const tmdb = require('../lib/tmdb');

const byId = new Map(CATALOG.map(c => [c.id, c]));
const TIMEOUT_MS = 6000;
const TTL_OK = 12 * 60 * 60 * 1000;      // keep good answers for 12 hours (availability changes, and TMDB limits how long data may be cached)
const TTL_UNKNOWN = 60 * 60 * 1000;      // retry unmatched titles after an hour
const cache = new Map();                  // "id|REGION" -> { t, ttl, body }

const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 60;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) { const e = new Error('upstream'); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(timer); }
}

function send(res, code, body, cacheable) {
  res.setHeader('Cache-Control', cacheable ? 'public, s-maxage=43200, stale-while-revalidate=86400' : 'no-store');
  return res.status(code).json(body);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.setHeader('Cache-Control', 'no-store'); return res.status(405).json({ error: 'GET only' }); }
  const key = process.env.TMDB_API_KEY;
  if (!key) return send(res, 503, { error: 'no_key' }, false);

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'x').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'rate_limited' }, false);

  let q = req.query;
  if (!q) { try { q = Object.fromEntries(new URL(req.url, 'http://x').searchParams); } catch (e) { q = {}; } }
  const id = typeof q.id === 'string' ? q.id : '';
  let region = typeof q.region === 'string' ? q.region.trim().toUpperCase() : 'IN';
  if (region === 'UK') region = 'GB';
  if (!/^[A-Z]{2}$/.test(region)) return send(res, 400, { error: 'bad_region' }, false);

  const c = byId.get(id);
  if (!c) return send(res, 404, { error: 'not_found' }, false);
  if (c.type === 'game') return send(res, 400, { error: 'not_supported' }, false); // TMDB covers movies and TV only

  const ck = id + '|' + region, now = Date.now(), hit = cache.get(ck);
  if (hit && now - hit.t < hit.ttl) return send(res, 200, hit.body, hit.body.status === 'ok' || hit.body.status === 'none');

  try {
    let tid = Number.isInteger(c.tmdb) ? c.tmdb : null;
    if (!tid) {
      const found = await getJson(tmdb.searchUrl(c.type, c.title, c.year, key));
      const m = tmdb.pickMatch(found && found.results, c.title, c.year, c.type);
      tid = m ? m.id : null;
    }
    let body;
    if (!tid) {
      body = { status: 'unknown', region };
    } else {
      const data = await getJson(tmdb.providersUrl(c.type, tid, key));
      const r = data && data.results && data.results[region];
      const lists = r ? { flatrate: tmdb.names(r.flatrate), free: tmdb.names(r.free), ads: tmdb.names(r.ads), rent: tmdb.names(r.rent), buy: tmdb.names(r.buy) } : null;
      const any = lists && Object.values(lists).some(a => a.length);
      body = any
        ? { status: 'ok', region, ...lists, link: typeof r.link === 'string' && r.link.startsWith('https://www.themoviedb.org/') ? r.link : null, source: 'JustWatch via TMDB' }
        : { status: 'none', region };
    }
    cache.set(ck, { t: now, ttl: body.status === 'unknown' ? TTL_UNKNOWN : TTL_OK, body });
    if (cache.size > 2000) cache.clear();
    return send(res, 200, body, body.status === 'ok' || body.status === 'none');
  } catch (e) {
    if (e && e.status === 404) return send(res, 200, { status: 'unknown', region }, false);
    return send(res, 502, { error: e && e.name === 'AbortError' ? 'timeout' : 'upstream' }, false);
  }
};
module.exports._clearCache = () => { cache.clear(); hits.clear(); };
