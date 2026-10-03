// Importer tests (mocked TMDB, tiny fixture IMDb files). Run: node tests/import.test.js
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const imp = require(path.join(__dirname, '..', 'scripts', 'import-candidates.js'));
const { CATALOG } = require(path.join(__dirname, '..', 'lib', 'catalog.js'));
let ok = true; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; };
const KEY = 'secret-tmdb-key-123';
// A tiny fixture shelf so these tests never depend on what is on the real shelf.
const FIX = [{ id: 'oldghost', title: 'Old Ghost', year: 1980 }, { id: 'secondspook', title: 'Second Spook', year: 2010 }, { id: 'thirdphantom', title: 'Third Phantom', year: 1995 }];
const EXI = () => imp.existingIndex(FIX), TAKEN = () => new Set(FIX.map(c => c.id));

function mockFetch(routes, calls) {
  return async url => {
    calls.push(String(url));
    for (const [sub, resp] of routes) if (String(url).includes(sub)) {
      const r = typeof resp === 'function' ? resp(String(url)) : resp;
      return { ok: r.__status === undefined, status: r.__status || 200, json: async () => (r.__body !== undefined ? r.__body : r) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const movie = (id, title, date, votes, genres = [27], overview = 'A description from TMDB.') => ({ id, title, release_date: date, vote_count: votes, vote_average: 6.5, genre_ids: genres, overview });
const tv = (id, name, date, votes) => ({ id, name, first_air_date: date, vote_count: votes, vote_average: 7.1, genre_ids: [9648, 18], overview: 'A show.' });

(async () => {
  // ---------- helpers ----------
  const taken = new Set(['hollowlarkspur']);
  t('slugOf makes a simple lowercase key', imp.slugOf("Pan's Labyrinth", 2006, new Set()) === 'panslabyrinth' && imp.slugOf('[REC]', 2007, new Set()) === 'rec' && imp.slugOf('Amélie', 2001, new Set()) === 'amelie');
  t('slugOf never collides: adds the year, then a counter', (() => { const s = new Set(['hollowlarkspur']); const a = imp.slugOf('Hollow Larkspur', 2012, s); const b = imp.slugOf('Hollow Larkspur', 2012, s); return a === 'hollowlarkspur2012' && b === 'hollowlarkspur20122' && s.size === 3; })());
  t('slugOf copes with a title that has no letters', imp.slugOf('???', 2000, new Set()) === 'title');
  const ex = imp.existingIndex(FIX);
  t('existingIndex matches shelf titles ignoring "the"/punctuation and allows a year off by one', ex.has('Old Ghost', 1980) && ex.has('old   ghost!', 1981) && ex.has('The Old Ghost', 1979) && !ex.has('Old Ghost', 1990) && !ex.has('Hollow Larkspur', 2012));
  t('parseArgs handles flags with and without values', (() => { const a = imp.parseArgs(['--source', 'tmdb', '--limit', '5', '--dry']); return a.source === 'tmdb' && a.limit === '5' && a.dry === true; })());

  // ---------- TMDB source ----------
  let calls = [];
  const page1 = { page: 1, total_pages: 2, results: [movie(1, 'Old Ghost', '1980-05-23', 17000, [27, 18]), movie(2, 'Hollow Larkspur', '2012-10-12', 6000, [27, 53], 'A washed-up true-crime writer finds a box of old home movies.'), movie(3, 'Moth Hour', '2013-04-11', 4000), movie(4, 'Hollow Larkspur', '2012-10-12', 90), movie(5, '', '2000-01-01', 10), movie(6, 'No Date', '', 10), movie(7, 'Second Spook', '2010-09-14', 7000)] };
  const page2 = { page: 2, total_pages: 2, results: [movie(2, 'Hollow Larkspur', '2012-10-12', 6000), movie(8, 'Pale Orchard', '2014-10-03', 3000, [27, 53])] };
  const routes = () => [
    ['/discover/movie', u => u.includes('page=2') ? page2 : page1],
    ['/search/keyword', { results: [{ id: 99999, name: 'horror' }, { id: 5, name: 'horror comedy' }] }],
    ['/discover/tv', { page: 1, total_pages: 1, results: [tv(10, 'Third Phantom', '1995-10-27', 900), tv(11, 'The Ashen Hour', '2016-10-11', 500), tv(12, 'Grey Lantern', '2013-04-19', 400)] }]
  ];
  let res = await imp.fromTmdb({ key: KEY, fetchImpl: mockFetch(routes(), calls), delay: 0, limit: 60, existing: EXI(), taken: TAKEN() });
  const films = res.candidates.filter(c => c.type === 'film'), series = res.candidates.filter(c => c.type === 'series');
  t('asks TMDB for horror (genre 27) sorted by votes, with a vote floor and adult titles excluded', calls[0].includes('/discover/movie') && calls[0].includes('with_genres=27') && calls[0].includes('sort_by=vote_count.desc') && calls[0].includes('vote_count.gte=2000') && calls[0].includes('include_adult=false'));
  t('titles already on the shelf are skipped and counted (Old Ghost, Second Spook, Third Phantom)', !res.candidates.some(c => /old ghost|second spook|third phantom/i.test(c.title)) && res.skippedExisting === 3);
  t('rows without a title or a release year are skipped', !res.candidates.some(c => !c.title || !c.year));
  t('the same TMDB id on two pages is only proposed once', films.filter(c => c.tmdb === 2).length === 1);
  t('new films are proposed with the TMDB id, votes and genre names', (() => { const s = films.find(c => c.tmdb === 2); return s && s.title === 'Hollow Larkspur' && s.year === 2012 && s._votes === 6000 && s._genres.join() === 'Horror,Thriller' && s._source === 'tmdb'; })());
  t('everything that needs judgment is left blank: not approved, no dread/pace/tags/blurb', res.candidates.every(c => c.approved === false && c.dread === null && c.pace === null && c.tags.length === 0 && c.blurb === ''));
  t('the TMDB description is kept for reference only (_overview), never as the blurb', films.find(c => c.tmdb === 2)._overview.includes('true-crime') && films.every(c => c.blurb === ''));
  t('slugs are unique even for two films with the same title and year', (() => { const ids = res.candidates.map(c => c.id); return new Set(ids).size === ids.length && ids.includes('hollowlarkspur') && ids.includes('hollowlarkspur2012'); })());
  t('no proposed id collides with an id already on the shelf (fixture or real)', res.candidates.every(c => !FIX.some(x => x.id === c.id) && !CATALOG.some(x => x.id === c.id)));
  t('it paged through to the last page (2 pages of films)', calls.filter(u => u.includes('/discover/movie')).length === 2);
  t('series: resolves the exact "horror" keyword (not "horror comedy") and uses it', calls.some(u => u.includes('/search/keyword')) && calls.some(u => u.includes('/discover/tv') && u.includes('with_keywords=99999')));
  t('series candidates use name / first_air_date and type "series"', series.length === 2 && series.every(c => c.type === 'series') && series.some(c => c.title === 'The Ashen Hour' && c.year === 2016));
  t('every candidate carries a hint telling the human what to fill in', res.candidates.every(c => /YOUR OWN words/.test(c._hint)));
  calls = []; res = await imp.fromTmdb({ key: KEY, fetchImpl: mockFetch(routes(), calls), delay: 0, limit: 1, types: ['film'], existing: EXI(), taken: TAKEN() });
  t('--limit is respected, and --types film never touches the TV endpoints', res.candidates.length === 1 && !calls.some(u => u.includes('/tv') || u.includes('keyword')));
  calls = []; res = await imp.fromTmdb({ key: KEY, fetchImpl: mockFetch([['/search/keyword', { results: [{ id: 1, name: 'zombies' }] }]], calls), delay: 0, types: ['series'] });
  t('no "horror" keyword -> no series, with an explanatory note (not a crash)', res.candidates.length === 0 && res.notes.some(n => /horror/.test(n)));
  let err = null; try { await imp.fromTmdb({ key: KEY, fetchImpl: mockFetch([['/discover/movie', { __status: 401 }]], []), delay: 0, types: ['film'] }); } catch (e) { err = e; }
  t('an HTTP error throws, and the message never contains the API key or URL', err && /401/.test(err.message) && !err.message.includes(KEY) && !/themoviedb/.test(err.message));
  err = null; try { await imp.fromTmdb({ key: '', fetchImpl: mockFetch([], []), delay: 0 }); } catch (e) { err = e; }
  t('a missing key is reported clearly', err && /TMDB_API_KEY/.test(err.message));

  // ---------- IMDb files ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imdb-'));
  const H = 'tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres';
  const row = (id, type, title, adult, year, genres) => [id, type, title, title, adult, year, '\\N', '100', genres].join('\t');
  const basics = [H,
    row('tt01', 'movie', 'Hollow Larkspur', '0', '2012', 'Horror,Mystery,Thriller'),
    row('tt02', 'movie', 'Moth Hour', '0', '2013', 'Horror,Mystery'),
    row('tt03', 'short', 'Tiny Horror', '0', '2010', 'Horror'),
    row('tt04', 'movie', 'Adult Thing', '1', '2011', 'Horror'),
    row('tt05', 'movie', 'Not Horror', '0', '2011', 'Comedy'),
    row('tt06', 'movie', 'Obscure Horror', '0', '2011', 'Horror'),
    row('tt07', 'tvSeries', 'The Ashen Hour', '0', '2016', 'Horror,Mystery'),
    row('tt08', 'tvMiniSeries', 'Mini Spook', '0', '2020', 'Horror'),
    row('tt09', 'videoGame', 'Spooky Game', '0', '2019', 'Horror,Action'),
    row('tt10', 'movie', 'Old Ghost', '0', '1980', 'Drama,Horror'),
    row('tt11', 'tvMovie', 'TV Spooker', '0', '2005', 'Horror'),
    row('tt12', 'movie', 'Future Date', '0', '\\N', 'Horror'),
    row('tt13', 'tvEpisode', 'One Episode', '0', '2014', 'Horror'),
    row('tt14', 'movie', 'Horror Lite', '0', '2015', 'Horror')].join('\n') + '\n';
  const R = 'tconst\taverageRating\tnumVotes';
  const ratings = [R, 'tt01\t6.8\t250000', 'tt02\t6.5\t120000', 'tt03\t5\t90000', 'tt04\t5\t99999', 'tt05\t7\t500000', 'tt06\t4\t500', 'tt07\t7.2\t8000', 'tt08\t6.1\t6000', 'tt09\t7.5\t1500', 'tt10\t8.4\t900000', 'tt11\t5.5\t30000', 'tt12\t5\t99999', 'tt13\t8\t99999', 'tt14\t5\t25000'].join('\n') + '\n';
  const bp = path.join(dir, 'title.basics.tsv.gz'), rp = path.join(dir, 'title.ratings.tsv.gz');
  fs.writeFileSync(bp, zlib.gzipSync(basics)); fs.writeFileSync(rp, zlib.gzipSync(ratings));
  let im = await imp.fromImdb({ basicsPath: bp, ratingsPath: rp, limit: 60, existing: EXI(), taken: TAKEN() });
  const byT = ty => im.candidates.filter(c => c.type === ty);
  t('IMDb: only horror feature films above the vote floor make it in, most-voted first (tvMovie counts as a film)', byT('film').map(c => c.title).join('|') === 'Hollow Larkspur|Moth Hour|TV Spooker|Horror Lite');
  t('IMDb: shorts, episodes, adult titles, non-horror, low-vote and year-less rows are all excluded', !im.candidates.some(c => /Tiny Horror|Adult Thing|Not Horror|Obscure|Future Date|One Episode/.test(c.title)));
  t('IMDb: titles already on the shelf are skipped and counted', !im.candidates.some(c => c.title === 'Old Ghost') && im.skippedExisting === 1);
  t('IMDb: sorted by votes (most-voted first)', byT('film')[0].title === 'Hollow Larkspur' && byT('film')[0]._votes === 250000 && byT('film')[1].title === 'Moth Hour');
  t('IMDb: tvMovie counts as a film; tvMiniSeries counts as a series; videoGame as a game', byT('film').some(c => c.title === 'TV Spooker') && byT('series').some(c => c.title === 'Mini Spook') && byT('game').map(c => c.title).join() === 'Spooky Game');
  t('IMDb: carries the imdb id and rating, and no tmdb id', (() => { const s = byT('film')[0]; return s.imdb === 'tt01' && s._rating === 6.8 && s.tmdb === undefined && s._source === 'imdb'; })());
  t('IMDb: candidates are blank for the human, like TMDB ones', im.candidates.every(c => c.approved === false && c.dread === null && c.blurb === '' && c.tags.length === 0));
  im = await imp.fromImdb({ basicsPath: bp, ratingsPath: rp, limit: 1, existing: EXI(), taken: TAKEN() });
  t('IMDb: --limit applies per type', byT('film').length === 1 && byT('series').length === 1 && byT('game').length === 1);
  im = await imp.fromImdb({ basicsPath: bp, ratingsPath: rp, minVotes: { film: 200000, series: 5000, game: 100000 }, existing: EXI(), taken: TAKEN() });
  t('IMDb: vote floors are adjustable per type', byT('film').length === 1 && byT('game').length === 0 && byT('series').length === 2);
  const bpPlain = path.join(dir, 'basics.tsv'), rpPlain = path.join(dir, 'ratings.tsv'); fs.writeFileSync(bpPlain, basics); fs.writeFileSync(rpPlain, ratings);
  im = await imp.fromImdb({ basicsPath: bpPlain, ratingsPath: rpPlain, existing: EXI(), taken: TAKEN() });
  t('IMDb: plain (uncompressed) TSV files work too', im.candidates.length > 0);
  err = null; try { await imp.fromImdb({ basicsPath: bp }); } catch (e) { err = e; }
  t('IMDb: missing --ratings is reported clearly', err && /--ratings/.test(err.message));
  t('IMDb: always warns that the data is noisy and must be checked', (await imp.fromImdb({ basicsPath: bp, ratingsPath: rp, existing: EXI(), taken: TAKEN() })).notes.some(n => /noisy/i.test(n)));

  // ---------- CLI main ----------
  const out = path.join(dir, 'out', 'candidates.json'); const logs = []; const oldLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  const code = await imp.main(['--source', 'imdb', '--basics', bp, '--ratings', rp, '--out', out]);
  console.log = oldLog;
  const written = JSON.parse(fs.readFileSync(out, 'utf8'));
  t('main() writes data/candidates.json-style output with a candidates array and exits 0', code === 0 && Array.isArray(written.candidates) && written.candidates.length > 0 && written.source === 'imdb');
  t('main() tells the human what to do next', logs.some(l => /npm run merge/.test(l)));
  const oldErr = console.error; console.error = () => {}; const usage = await imp.main([]); console.error = oldErr;
  t('main() with no --source prints usage and exits non-zero', usage === 1);
  err = null; try { await imp.main(['--source', 'tmdb'], {}); } catch (e) { err = e; }
  t('main() --source tmdb without TMDB_API_KEY fails clearly', err && /TMDB_API_KEY/.test(err.message));
  console.log(ok ? '\nALL IMPORT TESTS PASSED' : '\nSOME IMPORT TESTS FAILED'); process.exit(ok ? 0 : 1);
})();
