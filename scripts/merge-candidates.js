#!/usr/bin/env node
// The only code that ever edits lib/catalog.js. Takes candidates you have reviewed and approved,
// validates ALL of them first, and writes nothing unless every one is valid.
//   node scripts/merge-candidates.js [--file data/candidates.json] [--dry-run]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { validateEntry } = require('../lib/validate');

const ROOT = path.join(__dirname, '..');
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const KEYS = ['id', 'title', 'year', 'type', 'dread', 'pace', 'tags', 'where', 'tmdb', 'blurb'];

function render(e) {
  const parts = [`id:${q(e.id)}`, `title:${q(e.title)}`, `year:${e.year}`, `type:${q(e.type)}`, `dread:${e.dread}`, `pace:${q(e.pace)}`, `tags:[${e.tags.map(q).join(',')}]`];
  if (e.where !== undefined) parts.push(`where:${q(e.where)}`);
  if (e.tmdb !== undefined) parts.push(`tmdb:${e.tmdb}`);
  parts.push(`blurb:${q(e.blurb)}`);
  return '  {' + parts.join(',') + '}';
}
function toEntry(c) { const e = {}; for (const k of KEYS) if (c[k] !== undefined && c[k] !== null && c[k] !== '') e[k] = c[k]; return e; }
function loadCatalog(p) { delete require.cache[require.resolve(p)]; return require(p).CATALOG; }

// films go at the end of the films section, games at the end of games, series at the end of the array
function insert(text, by) {
  let out = text;
  const addBefore = (marker, entries) => {
    if (!entries.length) return;
    const i = out.indexOf(marker);
    if (i < 0) throw new Error('section marker not found: ' + marker.trim());
    out = out.slice(0, i) + entries.map(render).join(',\n') + ',\n' + out.slice(i);
  };
  addBefore('  // ---- games ----', by.film);
  addBefore('  // ---- series ----', by.game);
  if (by.series.length) {
    const end = out.lastIndexOf('}\n];');
    if (end < 0) throw new Error('end of the CATALOG array not found');
    out = out.slice(0, end) + '},\n' + by.series.map(render).join(',\n') + '\n];' + out.slice(end + 4);
  }
  return out;
}

function merge({ file, catalogPath = path.join(ROOT, 'lib', 'catalog.js'), dryRun = false, sync = true, log = console.log }) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.candidates;
  if (!Array.isArray(list)) throw new Error('candidates file has no "candidates" array');
  const approved = list.filter(c => c && c.approved === true && !c.merged);
  if (!approved.length) { log('Nothing to merge: no candidates with "approved": true.'); return { ok: true, merged: 0 }; }

  const before = fs.readFileSync(catalogPath, 'utf8');
  const existing = loadCatalog(catalogPath).slice();
  const accepted = [], errors = [];
  for (const c of approved) {
    const e = toEntry(c);
    const problems = validateEntry(e, { existing: existing.concat(accepted), blurbSource: c._overview });
    if (problems.length) errors.push({ id: c.id, title: c.title, problems });
    else accepted.push(e);
  }
  if (errors.length) {
    log(`Nothing was changed. ${errors.length} of ${approved.length} approved candidate(s) need fixing:`);
    for (const er of errors) { log(`  - ${er.title} (${er.id})`); er.problems.forEach(p => log('      * ' + p)); }
    return { ok: false, errors };
  }
  const by = { film: [], game: [], series: [] };
  accepted.forEach(e => by[e.type].push(e));
  const after = insert(before, by);
  if (dryRun) { log(`Dry run: would add ${accepted.length} title(s):`); accepted.forEach(e => log(render(e))); return { ok: true, merged: 0, dryRun: true, wouldAdd: accepted.length }; }

  fs.writeFileSync(catalogPath, after);
  try { // re-read what we wrote and make sure it is exactly what we meant to write
    const ids = new Set(accepted.map(e => e.id));
    const now = loadCatalog(catalogPath);
    const added = now.filter(e => ids.has(e.id));       // new entries sit inside their sections, not at the end
    const kept = now.filter(e => !ids.has(e.id));
    const same = now.length === existing.length + accepted.length
      && JSON.stringify(kept) === JSON.stringify(existing) // every old entry unchanged and in the same order
      && accepted.every(e => added.some(x => JSON.stringify(x) === JSON.stringify(e)));
    if (!same) throw new Error('written catalog does not match the approved entries');
  } catch (err) { fs.writeFileSync(catalogPath, before); throw new Error('Rolled back, catalog unchanged: ' + err.message); }

  const done = new Set(accepted.map(e => e.id));
  for (const c of list) if (c && done.has(c.id) && c.approved === true) { c.merged = true; c.approved = false; }
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  if (sync) execFileSync(process.execPath, [path.join(__dirname, 'sync-catalog.js')], { cwd: ROOT, stdio: 'inherit' });
  log(`Added ${accepted.length} title(s) to lib/catalog.js. ${sync ? 'index.html is synced.' : 'Now run: npm run sync'} Then run: npm test`);
  return { ok: true, merged: accepted.length };
}

function main(argv = process.argv.slice(2)) {
  const get = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const file = path.resolve(get('file') || path.join(ROOT, 'data', 'candidates.json'));
  if (!fs.existsSync(file)) { console.error('No candidates file at ' + file + '. Run an import first (npm run import:tmdb or import:imdb).'); return 1; }
  const r = merge({ file, dryRun: argv.includes('--dry-run') });
  return r.ok ? 0 : 1;
}
module.exports = { render, toEntry, insert, merge, main };
if (require.main === module) { try { process.exit(main()); } catch (e) { console.error(e.message); process.exit(1); } }
