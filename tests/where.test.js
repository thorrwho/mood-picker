// Tests for lib/tmdb.js and api/where.js with a mocked TMDB (no key or network needed). Run: node tests/where.test.js
const path = require('path');
process.env.TMDB_API_KEY = 'test-tmdb-key';
const tmdb = require(path.join(__dirname, '..', 'lib', 'tmdb.js'));
const handler = require(path.join(__dirname, '..', 'api', 'where.js'));
const { CATALOG } = require(path.join(__dirname, '..', 'lib', 'catalog.js'));
let ok = true; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; };

// ---- realistic TMDB-shaped fixtures ----
const movieResults = { page: 1, results: [
  { id: 694, title: 'The Shining', original_title: 'The Shining', release_date: '1980-05-23', vote_count: 17000, popularity: 60 },
  { id: 999001, title: 'Shining Vale', original_title: 'Shining Vale', release_date: '2022-03-06', vote_count: 50, popularity: 5 },
  { id: 999002, title: 'The Shining', original_title: 'The Shining', release_date: '1997-04-27', vote_count: 900, popularity: 9 } // the 1997 mini-series, wrong year
] };
const tvResults = { page: 1, results: [
  { id: 66732, name: 'Stranger Things', original_name: 'Stranger Things', first_air_date: '2016-07-15', vote_count: 17000, popularity: 200 },
  { id: 999003, name: 'Stranger Things: Tales From \'85', original_name: 'x', first_air_date: '2026-04-01', vote_count: 3, popularity: 1 }
] };
const providers = (extra = {}) => ({ id: 694, results: { IN: { link: 'https://www.themoviedb.org/movie/694-the-shining/watch?locale=IN',
  flatrate: [{ logo_path: '/a.jpg', provider_id: 8, provider_name: 'Netflix', display_priority: 1 }],
  rent: [{ provider_id: 2, provider_name: 'Apple TV' }, { provider_id: 3, provider_name: 'Google Play Movies' }],
  buy: [{ provider_id: 2, provider_name: 'Apple TV' }] },
  GB: { link: 'https://www.themoviedb.org/movie/694-the-shining/watch?locale=GB', flatrate: [{ provider_name: 'Amazon Prime Video' }] },
  US: { link: 'https://www.themoviedb.org/movie/694-the-shining/watch?locale=US', ads: [{ provider_name: 'Tubi TV' }] }, ...extra } });

let calls = [];
function mockTmdb(handlers) { // handlers: [[substring, response|fn]]
  global.fetch = async (url, opts) => {
    calls.push(String(url));
    for (const [sub, resp] of handlers) if (String(url).includes(sub)) {
      const r = typeof resp === 'function' ? resp(String(url)) : resp;
      if (r instanceof Error) throw r;
      return { ok: r.__status === undefined, status: r.__status || 200, json: async () => r.__body !== undefined ? r.__body : r };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const run = (q, method = 'GET', ip = '7.7.7.' + Math.floor(Math.random() * 200)) => new Promise(r => {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(o) { r({ code: this.c, body: o, h: this.h }); } };
  handler({ method, query: q, headers: { 'x-forwarded-for': ip }, socket: {} }, res);
});
const fresh = () => { handler._clearCache(); calls = []; };

(async () => {
  // ---------- lib/tmdb.js (unit) ----------
  t('core() ignores case, accents, punctuation and a leading "the"', tmdb.core("Pan's Labyrinth") === 'pan s labyrinth' && tmdb.core('The Thing') === 'thing' && tmdb.core('Locke & Key') === 'locke and key' && tmdb.core('[REC]') === 'rec' && tmdb.core('Amélie') === 'amelie');
  t('pickMatch picks the right year (not the 1997 mini-series, not "Shining Vale")', tmdb.pickMatch(movieResults.results, 'The Shining', 1980, 'film').id === 694);
  t('pickMatch tolerates a year off by one', tmdb.pickMatch(movieResults.results, 'The Shining', 1981, 'film').id === 694);
  t('pickMatch rejects a year off by two or more (no wrong guess)', tmdb.pickMatch(movieResults.results, 'The Shining', 1983, 'film') === null);
  t('pickMatch rejects a different title with the right year', tmdb.pickMatch(movieResults.results, 'Poltergeist', 1980, 'film') === null);
  t('pickMatch uses name / first_air_date for series', tmdb.pickMatch(tvResults.results, 'Stranger Things', 2016, 'series').id === 66732 && tmdb.pickMatch(tvResults.results, 'Stranger Things', 2016, 'film') === null);
  t('pickMatch prefers the result with the most votes when two match', tmdb.pickMatch([{ id: 1, title: 'Alien', release_date: '1979-05-25', vote_count: 10 }, { id: 2, title: 'Alien', release_date: '1979-05-25', vote_count: 9000 }], 'Alien', 1979, 'film').id === 2);
  t('pickMatch is safe on junk input', tmdb.pickMatch(null, 'x', 2000, 'film') === null && tmdb.pickMatch([null, {}, { id: 'x' }, { id: 5, title: 'x' }], 'x', 2000, 'film') === null && tmdb.pickMatch([], 'x', 2000, 'bogus') === null);
  t('names() strips markup characters, dedupes, caps at 8, ignores non-strings', (() => { const n = tmdb.names([{ provider_name: '<b>Netflix</b>' }, { provider_name: 'Netflix' }, { provider_name: 5 }, null, ...Array.from({ length: 12 }, (_, i) => ({ provider_name: 'P' + i }))]); return n.length === 8 && !n.some(x => /[<>]/.test(x)); })());
  t('searchUrl encodes the title and carries the key; films use `year`, series `first_air_date_year`', (() => { const f = tmdb.searchUrl('film', 'Locke & Key', 2020, 'K'); const s = tmdb.searchUrl('series', 'Locke & Key', 2020, 'K'); return f.includes('/search/movie') && f.includes('query=Locke+%26+Key') && f.includes('year=2020') && f.includes('api_key=K') && s.includes('/search/tv') && s.includes('first_air_date_year=2020'); })());

  // ---------- handler: happy paths ----------
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  let r = await run({ id: 'shining', region: 'IN' });
  t('film: 200, status ok, subscription + rent + buy lists', r.code === 200 && r.body.status === 'ok' && r.body.flatrate[0] === 'Netflix' && r.body.rent.includes('Apple TV') && r.body.buy.length === 1 && r.body.region === 'IN');
  t('credits the source in the payload', r.body.source === 'JustWatch via TMDB');
  t('TMDB deep link is passed through only when it really is a themoviedb.org link', r.body.link === 'https://www.themoviedb.org/movie/694-the-shining/watch?locale=IN');
  t('the TMDB key goes to TMDB but never into our response', calls.every(u => u.includes('api_key=test-tmdb-key')) && !JSON.stringify(r.body).includes('test-tmdb-key') && !JSON.stringify(r.h).includes('test-tmdb-key'));
  t('good answers are CDN-cacheable', /s-maxage=43200/.test(r.h['Cache-Control']));
  t('lowercase region is accepted', (fresh(), mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]), (await run({ id: 'shining', region: 'in' })).body.region === 'IN'));
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  r = await run({ id: 'shining', region: 'uk' });
  t('"uk" is translated to the ISO code GB that TMDB uses', r.code === 200 && r.body.region === 'GB' && r.body.flatrate[0] === 'Amazon Prime Video');
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  r = await run({ id: 'shining', region: 'us' });
  t('free-with-ads providers are reported', r.body.status === 'ok' && r.body.ads[0] === 'Tubi TV' && r.body.flatrate.length === 0);
  fresh(); mockTmdb([['/search/tv', tvResults], ['/tv/66732/watch/providers', { id: 66732, results: { IN: { link: 'https://www.themoviedb.org/tv/66732', flatrate: [{ provider_name: 'Netflix' }] } } }]]);
  r = await run({ id: 'strangerthings', region: 'IN' });
  t('series use /search/tv and /tv/{id}/watch/providers', r.body.status === 'ok' && calls[0].includes('/search/tv') && calls[1].includes('/tv/66732/watch/providers'));
  // pinned TMDB id skips the search entirely
  { const c = CATALOG.find(x => x.id === 'shining'); c.tmdb = 694; fresh(); mockTmdb([['/movie/694/watch/providers', providers()]]);
    r = await run({ id: 'shining', region: 'IN' }); delete c.tmdb;
    t('a pinned `tmdb` id is used directly: no search call', r.body.status === 'ok' && calls.length === 1 && calls[0].includes('/movie/694/watch/providers')); }

  // ---------- honest "nothing" and "unknown" ----------
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  r = await run({ id: 'shining', region: 'JP' });
  t('region with no listing -> status none (not an error, not a guess)', r.code === 200 && r.body.status === 'none' && r.body.region === 'JP');
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', { id: 694, results: { IN: { link: 'https://www.themoviedb.org/x', flatrate: [], rent: [] } } }]]);
  t('region present but every list empty -> none', (await run({ id: 'shining', region: 'IN' })).body.status === 'none');
  fresh(); mockTmdb([['/search/movie', { results: [{ id: 5, title: 'Some Other Film', release_date: '1980-01-01', vote_count: 9 }] }]]);
  r = await run({ id: 'shining', region: 'IN' });
  t('no confident TMDB match -> status unknown, and providers are never requested', r.body.status === 'unknown' && !calls.some(u => u.includes('watch/providers')));
  t('unknown answers are not CDN-cached', r.h['Cache-Control'] === 'no-store');
  fresh(); mockTmdb([['/search/movie', {}], ['/watch/providers', {}]]);
  t('empty / malformed TMDB bodies degrade to unknown, never a crash', (await run({ id: 'shining', region: 'IN' })).body.status === 'unknown');
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', { id: 694 }]]);
  t('providers body without `results` -> none', (await run({ id: 'shining', region: 'IN' })).body.status === 'none');
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', { __status: 404 }]]);
  r = await run({ id: 'shining', region: 'IN' });
  t('TMDB 404 on providers -> unknown (200)', r.code === 200 && r.body.status === 'unknown');

  // ---------- sanitising what comes back ----------
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers({ IN: { link: 'https://evil.example/phish', flatrate: [{ provider_name: '<img src=x onerror=alert(1)>Hax' }] } })]]);
  r = await run({ id: 'shining', region: 'IN' });
  t('a link that is not on themoviedb.org is dropped', r.body.link === null);
  t('markup characters in provider names are stripped', !/[<>=]/.test(JSON.stringify(r.body.flatrate)) && r.body.flatrate.length === 1);

  // ---------- input validation ----------
  fresh(); mockTmdb([['/', {}]]);
  t('games are not supported (TMDB covers movies and TV) -> 400', (await run({ id: 'amnesia', region: 'IN' })).code === 400);
  t('unknown shelf id -> 404 (free text can never reach TMDB)', (await run({ id: 'not-on-the-shelf', region: 'IN' })).code === 404);
  t('a title string instead of an id -> 404, with no TMDB call', (await run({ id: 'The Shining', region: 'IN' })).code === 404 && calls.length === 0);
  t('bad region -> 400', (await run({ id: 'shining', region: 'XYZ' })).code === 400 && (await run({ id: 'shining', region: '1!' })).code === 400);
  t('POST -> 405', (await run({ id: 'shining' }, 'POST')).code === 405);
  t('missing region defaults to IN', (fresh(), mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]), (await run({ id: 'shining' })).body.region === 'IN'));

  // ---------- caching ----------
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  await run({ id: 'shining', region: 'IN' }); const n1 = calls.length;
  r = await run({ id: 'shining', region: 'IN' });
  t('a repeat request is served from cache with zero TMDB calls', n1 === 2 && calls.length === n1 && r.body.status === 'ok');

  // ---------- upstream failures ----------
  fresh(); mockTmdb([['/search/movie', { __status: 500 }]]);
  t('TMDB 500 -> 502', (await run({ id: 'shining', region: 'IN' })).code === 502);
  fresh(); mockTmdb([['/search/movie', { __status: 401 }]]);
  t('TMDB 401 (bad key) -> 502, never exposes the key', (r = await run({ id: 'shining', region: 'IN' })).code === 502 && !JSON.stringify(r).includes('test-tmdb-key'));
  fresh(); const ab = new Error('aborted'); ab.name = 'AbortError'; mockTmdb([['/search/movie', ab]]);
  t('timeout -> 502 "timeout"', (r = await run({ id: 'shining', region: 'IN' })).code === 502 && r.body.error === 'timeout');
  fresh(); mockTmdb([['/search/movie', { __status: 500 }]]); await run({ id: 'shining', region: 'IN' });
  mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]);
  t('failures are not cached: the next request retries and succeeds', (await run({ id: 'shining', region: 'IN' })).body.status === 'ok');

  // ---------- abuse limits + config ----------
  fresh(); mockTmdb([['/search/movie', movieResults], ['/movie/694/watch/providers', providers()]]); let last;
  for (let i = 0; i < 61; i++) last = await run({ id: 'shining', region: 'IN' }, 'GET', '9.9.9.9');
  t('the 61st request in the window is rate-limited (429)', last.code === 429);
  delete process.env.TMDB_API_KEY; fresh();
  t('no TMDB key configured -> 503 (the page then falls back silently)', (await run({ id: 'shining', region: 'IN' })).code === 503);
  console.log(ok ? '\nALL WHERE TESTS PASSED' : '\nSOME WHERE TESTS FAILED'); process.exit(ok ? 0 : 1);
})();
