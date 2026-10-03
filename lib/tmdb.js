// Small TMDB helpers shared by the live lookup (api/where.js) and the import script (scripts/import-candidates.js).
// TMDB data is used under TMDB's API terms (non-commercial, with attribution). Watch-provider data is sourced from JustWatch and must credit it.
const BASE = 'https://api.themoviedb.org/3';

// "Pan's Labyrinth" / "Locke & Key" / "[REC]" -> comparable lowercase words
const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const core = s => norm(s).replace(/^(the|a|an) /, '');
const yearOf = d => { const m = /^(\d{4})/.exec(d || ''); return m ? +m[1] : null; };

// kind: 'film' (a TMDB movie) or 'series' (a TMDB tv show)
const FIELDS = {
  film: { names: ['title', 'original_title'], date: 'release_date', path: 'movie' },
  series: { names: ['name', 'original_name'], date: 'first_air_date', path: 'tv' }
};

// Pick the TMDB search result that is really our title: same name (ignoring "the", punctuation, accents) and a release year within 1.
// Returns null when nothing matches clearly. A wrong match is worse than no match.
function pickMatch(results, title, year, kind) {
  const f = FIELDS[kind];
  if (!f || !Array.isArray(results)) return null;
  const want = core(title);
  const ok = results.filter(r => {
    if (!r || typeof r.id !== 'number') return false;
    const y = yearOf(r[f.date]);
    if (y === null || Math.abs(y - year) > 1) return false;
    return f.names.some(k => r[k] && core(r[k]) === want);
  });
  if (!ok.length) return null;
  ok.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0) || (b.popularity || 0) - (a.popularity || 0));
  return ok[0];
}

function url(path, params, key) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  u.searchParams.set('api_key', key);
  return u.toString();
}
const searchUrl = (kind, title, year, key) => kind === 'film'
  ? url('/search/movie', { query: title, year, include_adult: 'false', language: 'en-US' }, key)
  : url('/search/tv', { query: title, first_air_date_year: year, include_adult: 'false', language: 'en-US' }, key);
const providersUrl = (kind, id, key) => url('/' + FIELDS[kind].path + '/' + id + '/watch/providers', {}, key);

// Short, safe provider names for display
function names(arr) {
  const out = [];
  for (const p of Array.isArray(arr) ? arr : []) {
    const n = p && typeof p.provider_name === 'string' ? p.provider_name.replace(/[^\p{L}\p{N} +&.'’:()-]/gu, '').trim().slice(0, 40) : '';
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= 8) break;
  }
  return out;
}

module.exports = { BASE, norm, core, yearOf, FIELDS, pickMatch, url, searchUrl, providersUrl, names };
