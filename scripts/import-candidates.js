#!/usr/bin/env node
// Proposes new shelf titles from a dataset. It NEVER edits the shelf.
// It writes data/candidates.json with the facts a dataset knows (title, year, type, ids, votes) and leaves everything
// that needs judgment (dread, pace, mood tags, the one-line premise) blank for a human to fill in.
//
//   TMDB_API_KEY=... node scripts/import-candidates.js --source tmdb [--types film,series] [--limit 60]
//   node scripts/import-candidates.js --source imdb --basics title.basics.tsv.gz --ratings title.ratings.tsv.gz [--limit 60]
//
// Data terms: TMDB is free for non-commercial use with attribution; the IMDb files are for personal, non-commercial use only.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), readline = require('readline');
const tmdb = require('../lib/tmdb');
const { CATALOG } = require('../lib/catalog');

const MOVIE_GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };
const TV_GENRES = { 10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics', 37: 'Western' };
const HINT = 'Fill dread (1-5), pace (slow/medium/fast), 2+ mood tags and a one-line premise in YOUR OWN words, optionally where (only if sure), then set "approved": true.';
const sleep = ms => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

// ---------- helpers ----------
function slugOf(title, year, taken) {
  let s = String(title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 30) || 'title';
  if (taken.has(s)) s = (s.slice(0, 26) + year);
  let n = 2; const base = s;
  while (taken.has(s)) s = base + n++;
  taken.add(s);
  return s;
}
// "already on the shelf?" Same name (ignoring "the", punctuation, accents) and a year within 1.
function existingIndex(catalog = CATALOG) {
  const byTitle = new Map();
  for (const c of catalog) { const k = tmdb.core(c.title); (byTitle.get(k) || byTitle.set(k, []).get(k)).push(c.year); }
  return { has: (title, year) => (byTitle.get(tmdb.core(title)) || []).some(y => Math.abs(y - year) <= 1) };
}
function candidate({ title, year, type, source, tmdbId, imdb, votes, rating, genres, overview }, taken) {
  const c = { approved: false, id: slugOf(title, year, taken), title, year, type, dread: null, pace: null, tags: [], blurb: '', where: null };
  if (tmdbId) c.tmdb = tmdbId;
  if (imdb) c.imdb = imdb;
  c._source = source; c._votes = votes || 0; c._rating = rating || null; c._genres = genres || [];
  if (overview) c._overview = overview; // reference only; the merge step refuses a blurb that copies it
  c._hint = HINT;
  return c;
}

// ---------- TMDB ----------
async function fromTmdb({ key, fetchImpl = fetch, types = ['film', 'series'], limit = 60, pages = 8, minVotes = { film: 2000, series: 500 }, delay = 120, existing = existingIndex(), taken = new Set(CATALOG.map(c => c.id)), log = () => {} }) {
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const getJson = async u => {
    const r = await fetchImpl(u);
    if (!r.ok) throw new Error('TMDB request failed with HTTP ' + r.status); // never include the URL (it carries the key)
    await sleep(delay);
    return r.json();
  };
  const out = [], seen = new Set(); let skippedExisting = 0; const notes = [];
  const run = async (kind, path, params, titleKey, dateKey, genreMap) => {
    let n = 0;
    for (let page = 1; page <= pages && n < limit; page++) {
      const j = await getJson(tmdb.url(path, { ...params, include_adult: 'false', language: 'en-US', page }, key));
      for (const r of (j && j.results) || []) {
        if (n >= limit) break;
        const title = r[titleKey], year = tmdb.yearOf(r[dateKey]);
        if (!title || !year || typeof r.id !== 'number' || seen.has(kind + r.id)) continue;
        seen.add(kind + r.id);
        if (existing.has(title, year)) { skippedExisting++; continue; }
        out.push(candidate({ title, year, type: kind, source: 'tmdb', tmdbId: r.id, votes: r.vote_count, rating: r.vote_average, genres: (r.genre_ids || []).map(g => genreMap[g] || String(g)), overview: r.overview }, taken));
        n++;
      }
      if (!j || !j.results || !j.results.length || page >= (j.total_pages || page)) break;
    }
    log(`${kind}: ${n} new candidates`);
  };
  if (types.includes('film')) await run('film', '/discover/movie', { with_genres: 27, sort_by: 'vote_count.desc', 'vote_count.gte': minVotes.film }, 'title', 'release_date', MOVIE_GENRES);
  if (types.includes('series')) {
    const k = await getJson(tmdb.url('/search/keyword', { query: 'horror' }, key));
    const kw = ((k && k.results) || []).find(x => tmdb.norm(x.name) === 'horror');
    if (!kw) notes.push('Could not find a "horror" keyword on TMDB, so no series were fetched.');
    else await run('series', '/discover/tv', { with_keywords: kw.id, sort_by: 'vote_count.desc', 'vote_count.gte': minVotes.series }, 'name', 'first_air_date', TV_GENRES);
  }
  return { candidates: out, skippedExisting, notes };
}

// ---------- IMDb non-commercial dataset files ----------
async function* lines(file) {
  const stream = fs.createReadStream(file);
  const input = /\.gz$/i.test(file) ? stream.pipe(zlib.createGunzip()) : stream;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const l of rl) yield l;
}
async function fromImdb({ basicsPath, ratingsPath, limit = 60, minVotes = { film: 20000, series: 5000, game: 1000 }, existing = existingIndex(), taken = new Set(CATALOG.map(c => c.id)) }) {
  if (!basicsPath || !ratingsPath) throw new Error('--basics and --ratings are required for --source imdb');
  const floor = Math.min(...Object.values(minVotes));
  const ratings = new Map(); let first = true;
  for await (const line of lines(ratingsPath)) {
    if (first) { first = false; continue; }
    const [id, avg, votes] = line.split('\t'); const v = +votes;
    if (v >= floor) ratings.set(id, { rating: +avg, votes: v });
  }
  const TYPE = { movie: 'film', tvMovie: 'film', tvSeries: 'series', tvMiniSeries: 'series', videoGame: 'game' };
  const pool = { film: [], series: [], game: [] }; first = true;
  for await (const line of lines(basicsPath)) {
    if (first) { first = false; continue; }
    const c = line.split('\t'); if (c.length < 9) continue;
    const [tconst, ttype, primary, , isAdult, start, , , genres] = c;
    const type = TYPE[ttype];
    if (!type || isAdult !== '0' || start === '\\N' || !/^\d{4}$/.test(start)) continue;
    if (!genres.split(',').includes('Horror')) continue;
    const r = ratings.get(tconst);
    if (!r || r.votes < minVotes[type]) continue;
    pool[type].push({ title: primary, year: +start, type, source: 'imdb', imdb: tconst, votes: r.votes, rating: r.rating, genres: genres.split(',') });
  }
  const out = []; let skippedExisting = 0;
  for (const type of ['film', 'series', 'game']) {
    pool[type].sort((a, b) => b.votes - a.votes || a.title.localeCompare(b.title));
    let n = 0;
    for (const p of pool[type]) {
      if (n >= limit) break;
      if (existing.has(p.title, p.year)) { skippedExisting++; continue; }
      out.push(candidate(p, taken)); n++;
    }
  }
  return { candidates: out, skippedExisting, notes: ['IMDb data is noisy: check every title, year and genre before approving.'] };
}

// ---------- CLI ----------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; a[k] = v; } else a._.push(argv[i]);
  }
  return a;
}
async function main(argv = process.argv.slice(2), env = process.env) {
  const a = parseArgs(argv);
  const limit = a.limit ? Math.max(1, parseInt(a.limit, 10) || 60) : 60;
  const out = path.resolve(a.out || path.join(__dirname, '..', 'data', 'candidates.json'));
  let res;
  if (a.source === 'tmdb') {
    const types = String(a.types || 'film,series').split(',').map(s => s.trim()).filter(t => ['film', 'series'].includes(t));
    res = await fromTmdb({ key: env.TMDB_API_KEY, types, limit, pages: a.pages ? parseInt(a.pages, 10) : 8, log: m => console.log('  ' + m) });
  } else if (a.source === 'imdb') {
    res = await fromImdb({ basicsPath: a.basics, ratingsPath: a.ratings, limit });
  } else {
    console.error('Usage:\n  TMDB_API_KEY=... node scripts/import-candidates.js --source tmdb [--types film,series] [--limit 60]\n  node scripts/import-candidates.js --source imdb --basics title.basics.tsv.gz --ratings title.ratings.tsv.gz [--limit 60]');
    return 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), source: a.source, note: HINT, candidates: res.candidates }, null, 2) + '\n');
  const by = t => res.candidates.filter(c => c.type === t).length;
  console.log(`Wrote ${res.candidates.length} candidates to ${path.relative(process.cwd(), out)} (${by('film')} films, ${by('series')} series, ${by('game')} games). Skipped ${res.skippedExisting} already on the shelf.`);
  res.notes.forEach(n => console.log('Note: ' + n));
  console.log('Next: open the file, fill in dread / pace / tags / blurb for the ones you want, set "approved": true, then run: npm run merge');
  return 0;
}
module.exports = { slugOf, existingIndex, candidate, fromTmdb, fromImdb, parseArgs, main, HINT };
if (require.main === module) main().then(c => process.exit(c), e => { console.error('Import failed:', e.message); process.exit(1); });
