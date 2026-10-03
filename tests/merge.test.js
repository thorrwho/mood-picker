// Validator + merge tests, run against a TEMPORARY copy of the catalog (the real shelf is never touched). Run: node tests/merge.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const { validateEntry } = require(path.join(__dirname, '..', 'lib', 'validate.js'));
const { CATALOG } = require(path.join(__dirname, '..', 'lib', 'catalog.js'));
const merge = require(path.join(__dirname, '..', 'scripts', 'merge-candidates.js'));
let ok = true; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; };

const REAL = path.join(__dirname, '..', 'lib', 'catalog.js');
const realBefore = fs.readFileSync(REAL, 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
let n = 0;
function setup(candidates, tweakCatalog) {
  const d = path.join(dir, 'run' + (++n)); fs.mkdirSync(d);
  const cat = path.join(d, 'catalog.js'); let src = realBefore; if (tweakCatalog) src = tweakCatalog(src);
  fs.writeFileSync(cat, src);
  const file = path.join(d, 'candidates.json'); fs.writeFileSync(file, JSON.stringify({ candidates }, null, 2));
  return { cat, file, read: () => fs.readFileSync(cat, 'utf8'), load: () => { delete require.cache[require.resolve(cat)]; return require(cat).CATALOG; }, cand: () => JSON.parse(fs.readFileSync(file, 'utf8')).candidates };
}
const film = (o = {}) => ({ approved: true, id: 'hollowlarkspur', title: 'Hollow Larkspur', year: 2012, type: 'film', dread: 4, pace: 'slow', tags: ['paranoia', 'family'], blurb: 'A true-crime writer moves his family into a house where a killer lived, and finds old films.', _source: 'tmdb', _votes: 6000, _hint: 'x', ...o });
const game = (o = {}) => ({ approved: true, id: 'moonwell', title: 'Moonwell', year: 2020, type: 'game', dread: 5, pace: 'slow', tags: ['anxiety', 'loneliness'], blurb: 'You wander a haunted house where every room remembers something awful.', where: 'PC (Steam)', ...o });
const series = (o = {}) => ({ approved: true, id: 'ashenhour', title: 'The Ashen Hour', year: 2016, type: 'series', dread: 4, pace: 'slow', tags: ['curious', 'paranoia'], blurb: 'Each season adapts a creepypasta into a strange small-town mystery.', ...o });
const quiet = fn => { const l = console.log; const out = []; console.log = (...a) => out.push(a.join(' ')); try { return [fn(), out]; } finally { console.log = l; } };
const run = (ctx, extra = {}) => quiet(() => merge.merge({ file: ctx.file, catalogPath: ctx.cat, sync: false, log: m => {}, ...extra }))[0];
const lines = ctx => { const out = []; merge.merge({ file: ctx.file, catalogPath: ctx.cat, sync: false, log: m => out.push(m), ...{} }); return out; };

// ---------- validator ----------
t('EVERY entry already on the shelf passes the validator (rules and shelf agree), including no duplicates', CATALOG.every(e => validateEntry(e, { existing: CATALOG.filter(x => x !== e) }).length === 0));
const good = film(); delete good.approved; delete good._source; delete good._votes; delete good._hint;
t('a complete entry validates', validateEntry(good).length === 0);
const bad = (patch, re) => { const e = { ...good, ...patch }; const p = validateEntry(e); return p.length > 0 && (!re || p.some(x => re.test(x))); };
t('rejects: bad id, empty title, year out of range', bad({ id: 'Bad Id!' }, /id must/) && bad({ title: ' ' }, /title/) && bad({ year: 1800 }, /year/) && bad({ year: 2999 }, /year/) && bad({ year: '2012' }, /year/));
t('rejects: unknown type, dread out of range, bad pace', bad({ type: 'book' }, /type/) && bad({ dread: 0 }, /dread/) && bad({ dread: 6 }, /dread/) && bad({ dread: 2.5 }, /dread/) && bad({ pace: 'glacial' }, /pace/));
t('rejects: fewer than 2 tags, unknown tags, repeated tags', bad({ tags: ['anxiety'] }, /at least 2/) && bad({ tags: ['anxiety', 'spicy'] }, /unknown tag/) && bad({ tags: ['anxiety', 'anxiety'] }, /repeat/) && bad({ tags: 'anxiety' }, /at least 2/));
t('rejects: missing/short/long/multi-line blurb', bad({ blurb: '' }, /blurb/) && bad({ blurb: 'too short' }, /blurb/) && bad({ blurb: 'x'.repeat(201) }, /blurb/) && bad({ blurb: 'line one is long enough\nline two' }, /blurb/));
t('rejects a blurb that copies the reference description (any case/punctuation)', validateEntry(good, { blurbSource: good.blurb.toUpperCase() + '!!' }).some(x => /own words/.test(x)));
t('rejects unknown fields (typos like "tag")', bad({ tag: ['x'] }, /unknown field/) && bad({ imdb: 'tt1' }, /unknown field/));
t('where: films/series only Netflix | Prime Video | SonyLIV (India)', validateEntry({ ...good, where: 'Netflix' }).length === 0 && validateEntry({ ...good, where: 'Prime Video' }).length === 0 && bad({ where: 'Hulu' }, /Netflix, Prime Video or SonyLIV/) && bad({ where: 'Netflix, Hulu' }, /where/));
t('where: games must name platforms; a streaming service is not one', validateEntry({ ...good, type: 'game', where: 'PC (Steam), Switch' }).length === 0 && bad({ type: 'game', where: 'Netflix' }, /platforms/));
t('tmdb must be a positive integer, and is not allowed on games', validateEntry({ ...good, tmdb: 123 }).length === 0 && bad({ tmdb: -1 }, /tmdb/) && bad({ tmdb: '12' }, /tmdb/) && bad({ type: 'game', where: 'PC (Steam)', tmdb: 5 }, /not games/));
t('duplicates: same id, same title+year (even with "the"/punctuation differences), same tmdb id', validateEntry({ ...good, id: CATALOG[0].id }, { existing: CATALOG }).some(x => x.includes('id "' + CATALOG[0].id + '"')) && validateEntry({ ...good, id: 'x1', title: CATALOG[0].title.replace(/^The /, '').toUpperCase() + '!', year: CATALOG[0].year }, { existing: CATALOG }).some(x => /already on the shelf/.test(x)) && validateEntry({ ...good, tmdb: 7 }, { existing: [{ id: 'z', title: 'Z', year: 2000, tmdb: 7 }] }).some(x => /TMDB id/.test(x)));
t('the same title in a different year is allowed (a remake is a different entry)', validateEntry({ ...good, id: 'remakeid', title: CATALOG[0].title, year: CATALOG[0].year + 17 }, { existing: CATALOG }).length === 0);

// ---------- merging ----------
let c = setup([film(), game(), series(), film({ id: 'mothhour', title: 'Moth Hour', year: 2013, approved: false })]);
const before = CATALOG.length;
let r = run(c);
const after = c.load();
t('merges the approved entries: ok, 3 added', r.ok && r.merged === 3 && after.length === before + 3);
t('the unapproved candidate was NOT added', !after.some(e => e.id === 'mothhour'));
t('new entries are exactly what was approved (underscore/approved fields stripped)', (() => { const s = after.find(e => e.id === 'hollowlarkspur'); return s && !('_source' in s) && !('approved' in s) && s.title === 'Hollow Larkspur' && s.year === 2012 && s.dread === 4 && s.tags.join() === 'paranoia,family'; })());
t('the game keeps its `where`', after.find(e => e.id === 'moonwell').where === 'PC (Steam)');
t('sections stay in order: all films, then all games, then all series (nothing interleaved)', (() => { const rank = { film: 0, game: 1, series: 2 }; return after.every((e, i) => i === 0 || rank[e.type] >= rank[after[i - 1].type]); })());
t('new film is placed at the end of the films, the new series at the very end', after.filter(e => e.type === 'film').pop().id === 'hollowlarkspur' && after[after.length - 1].id === 'ashenhour');
t('existing entries are untouched and in the same order', CATALOG.every(e => JSON.stringify(after.find(x => x.id === e.id)) === JSON.stringify(e)));
t('the file is still valid JavaScript with the same exports', (() => { const m = require(c.cat); return Array.isArray(m.CATALOG) && Array.isArray(m.TAGS) && Array.isArray(m.TYPES) && Array.isArray(m.PACES); })());
t('merged candidates are marked merged and un-approved in the candidates file', c.cand().filter(x => x.merged === true && x.approved === false).length === 3 && c.cand().find(x => x.id === 'mothhour').approved === false);
const afterText = c.read();
r = run(c);
t('running it again does nothing (idempotent): no duplicates, file unchanged', r.ok && r.merged === 0 && c.read() === afterText);

// ---------- all-or-nothing ----------
c = setup([film(), game({ dread: 9 }), series({ tags: ['curious'] }), film({ id: 'dup1', title: CATALOG[0].title, year: CATALOG[0].year }), film({ id: 'copy1', title: 'Copycat Film', blurb: 'Copy of the overview text that is long enough.', _overview: 'Copy of the overview text that is long enough.' })]);
const textBefore = c.read(), candBefore = fs.readFileSync(c.file, 'utf8');
const logs = []; r = merge.merge({ file: c.file, catalogPath: c.cat, sync: false, log: m => logs.push(m) });
t('if ANY approved entry is invalid, nothing is written (even the valid one)', r.ok === false && c.read() === textBefore && fs.readFileSync(c.file, 'utf8') === candBefore);
t('every problem is reported at once, not just the first', r.errors.length === 4 && r.errors.map(e => e.id).sort().join() === 'ashenhour,copy1,dup1,moonwell');
t('the report names the entry and says what is wrong in plain words', logs.some(l => /Moonwell/.test(l)) && logs.some(l => /dread must be/.test(l)) && logs.some(l => /at least 2 mood tags/.test(l)) && logs.some(l => /already on the shelf/.test(l)) && logs.some(l => /own words/.test(l)));
t('the valid entry was not partially merged', !c.load().some(e => e.id === 'hollowlarkspur'));

// two approved entries that collide with EACH OTHER
c = setup([film(), film({ id: 'hollowlarkspur' }), film({ id: 'other', title: 'Hollow Larkspur' })]);
r = run(c);
t('duplicates inside one batch are caught (same id, same title+year)', r.ok === false && r.errors.length === 2 && c.load().length === CATALOG.length);

// ---------- safety nets ----------
c = setup([film()], s => s.replace('module.exports = { CATALOG, TAGS, TYPES, PACES };', 'module.exports = { CATALOG: CATALOG.filter(c => c.id !== "hollowlarkspur"), TAGS, TYPES, PACES };'));
const tb = c.read(); let threw = null; try { quiet(() => merge.merge({ file: c.file, catalogPath: c.cat, sync: false, log: () => {} })); } catch (e) { threw = e; }
t('if the written file does not read back exactly right, it is rolled back and the error says so', threw && /Rolled back/.test(threw.message) && c.read() === tb);
t('...and the candidates stay un-merged after a rollback', c.cand().every(x => !x.merged && x.approved === true));
c = setup([film()], s => s.replace('  // ---- games ----', '  // (section marker removed)'));
const tb2 = c.read(); threw = null; try { quiet(() => merge.merge({ file: c.file, catalogPath: c.cat, sync: false, log: () => {} })); } catch (e) { threw = e; }
t('a missing section marker stops cleanly with the file untouched', threw && /marker/.test(threw.message) && c.read() === tb2);

// ---------- escaping and formats ----------
c = setup([film({ id: 'tricky', title: "Pan's Edge: A \\ Story & Co", year: 2001, blurb: "A boy's \"quote\" with a back\\slash and an apostrophe's trouble, all on one line." })]);
r = run(c); const e1 = c.load().find(e => e.id === 'tricky');
t('apostrophes, quotes, backslashes and & survive the round trip exactly', r.ok && e1.title === "Pan's Edge: A \\ Story & Co" && e1.blurb === "A boy's \"quote\" with a back\\slash and an apostrophe's trouble, all on one line.");
c = setup([film({ where: 'Netflix', tmdb: 4242 })]); r = run(c); const e2 = c.load().find(e => e.id === 'hollowlarkspur');
t('optional `where` and `tmdb` are written and read back as the right types', e2.where === 'Netflix' && e2.tmdb === 4242 && typeof e2.tmdb === 'number');
c = setup([film({ where: null, tmdb: null, imdb: 'tt1', _genres: ['Horror'], _overview: 'Different words entirely.' })]); r = run(c); const e3 = c.load().find(e => e.id === 'hollowlarkspur');
t('null where/tmdb, the imdb id and _fields are simply left out', r.ok && !('where' in e3) && !('tmdb' in e3) && !('imdb' in e3));
c = setup({ candidates: [film()] }.candidates); fs.writeFileSync(c.file, JSON.stringify([film()])); r = run(c);
t('a bare array (no {candidates} wrapper) is accepted too', r.ok && r.merged === 1);

// ---------- dry run + CLI ----------
c = setup([film(), game()]); const tb3 = c.read(); const out = [];
r = merge.merge({ file: c.file, catalogPath: c.cat, sync: false, dryRun: true, log: m => out.push(m) });
t('--dry-run shows what would be added and changes nothing', r.ok && r.dryRun && r.wouldAdd === 2 && c.read() === tb3 && out.some(l => /id:'hollowlarkspur'/.test(l)) && c.cand().every(x => x.approved === true && !x.merged));
c = setup([film({ approved: false })]); r = run(c);
t('with nothing approved it says so and exits ok', r.ok && r.merged === 0);
const [code] = quiet(() => merge.main(['--file', path.join(dir, 'nope.json'), '--dry-run'])); const oe = console.error; console.error = () => {}; const code2 = merge.main(['--file', path.join(dir, 'nope.json')]); console.error = oe;
t('main() on a missing candidates file returns a non-zero exit code', code2 === 1);
t('the REAL lib/catalog.js was never modified by any of these tests', fs.readFileSync(REAL, 'utf8') === realBefore);
console.log(ok ? '\nALL MERGE TESTS PASSED' : '\nSOME MERGE TESTS FAILED'); process.exit(ok ? 0 : 1);
