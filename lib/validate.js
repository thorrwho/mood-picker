// One definition of "a valid shelf entry", shared by scripts/merge-candidates.js and the tests,
// so the rules the merge step enforces are exactly the rules the test-suite checks on the existing shelf.
const { TAGS, TYPES, PACES } = require('./catalog');
const { core } = require('./tmdb');

const ALLOWED_KEYS = ['id', 'title', 'year', 'type', 'dread', 'pace', 'tags', 'where', 'tmdb', 'blurb'];
const STREAMERS = /^(Netflix|Prime Video|SonyLIV \(India\))$/;
const PLATFORM = /(PC|PlayStation|Xbox|Switch|mobile)/;

// Returns a list of problems (an empty list means the entry is valid).
// opts.existing: entries already on the shelf (for duplicate checks)
// opts.blurbSource: reference text (e.g. a TMDB overview) the premise must NOT simply copy
function validateEntry(e, opts = {}) {
  const { existing = [], blurbSource = null, maxYear = new Date().getFullYear() } = opts;
  const errs = [];
  const bad = m => errs.push(m);
  if (!e || typeof e !== 'object') return ['not an object'];
  for (const k of Object.keys(e)) if (!ALLOWED_KEYS.includes(k)) bad(`unknown field "${k}" (allowed: ${ALLOWED_KEYS.join(', ')})`);
  if (typeof e.id !== 'string' || !/^[a-z0-9]{2,40}$/.test(e.id)) bad('id must be 2-40 lowercase letters/digits');
  if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 80) bad('title is required (max 80 characters)');
  if (!Number.isInteger(e.year) || e.year < 1895 || e.year > maxYear) bad(`year must be a whole number from 1895 to ${maxYear}`);
  if (!TYPES.includes(e.type)) bad(`type must be one of: ${TYPES.join(', ')}`);
  if (!Number.isInteger(e.dread) || e.dread < 1 || e.dread > 5) bad('dread must be a whole number from 1 (gentle) to 5 (brutal)');
  if (!PACES.includes(e.pace)) bad(`pace must be one of: ${PACES.join(', ')}`);
  if (!Array.isArray(e.tags) || e.tags.length < 2) bad('give at least 2 mood tags');
  else {
    const unknown = e.tags.filter(t => !TAGS.includes(t));
    if (unknown.length) bad(`unknown tag(s): ${unknown.join(', ')} (allowed: ${TAGS.join(', ')})`);
    if (new Set(e.tags).size !== e.tags.length) bad('tags must not repeat');
  }
  if (typeof e.blurb !== 'string' || e.blurb.trim().length < 20 || e.blurb.length > 200 || /[\r\n]/.test(e.blurb)) bad('blurb (the one-line premise) must be 20-200 characters on one line');
  else if (blurbSource && core(e.blurb) === core(blurbSource)) bad('blurb is a copy of the reference description: rewrite the premise in your own words');
  if (e.where !== undefined) {
    if (typeof e.where !== 'string' || e.where.trim().length < 3 || e.where.length > 90) bad('where must be a short string, or left out when you are not sure');
    else if (e.type === 'game' && !PLATFORM.test(e.where)) bad('a game\'s where must name platforms (PC, PlayStation, Xbox, Switch, mobile)');
    else if (e.type !== 'game' && TYPES.includes(e.type) && !STREAMERS.test(e.where)) bad('a film/series where must be exactly Netflix, Prime Video or SonyLIV (India), or left out');
  }
  if (e.tmdb !== undefined) {
    if (!Number.isInteger(e.tmdb) || e.tmdb <= 0) bad('tmdb must be a positive whole number');
    else if (e.type === 'game') bad('tmdb ids are for films and series, not games');
  }
  if (typeof e.id === 'string' && existing.some(x => x.id === e.id)) bad(`id "${e.id}" already exists on the shelf`);
  if (typeof e.title === 'string' && Number.isInteger(e.year) && existing.some(x => core(x.title) === core(e.title) && x.year === e.year)) bad(`"${e.title}" (${e.year}) is already on the shelf`);
  if (Number.isInteger(e.tmdb) && existing.some(x => x.tmdb === e.tmdb)) bad(`TMDB id ${e.tmdb} is already on the shelf`);
  return errs;
}

module.exports = { validateEntry, ALLOWED_KEYS };
