// Copies lib/catalog.js and lib/moods.js into index.html (between the marker comments) so the page and the server never drift apart.
// Run with: npm run sync
const fs = require('fs'), path = require('path');
const { CATALOG } = require('../lib/catalog.js');
const { PATTERNS, FRIENDS, INTENT, detectIntent, scareWindow } = require('../lib/moods.js');
const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const re = /\/\*CATALOG_START\*\/[\s\S]*?\/\*CATALOG_END\*\//;
if (!re.test(html)) { console.error('CATALOG markers not found in index.html'); process.exit(1); }
const reMoods = /\/\*MOODS_START\*\/[\s\S]*?\/\*MOODS_END\*\//;
if (!reMoods.test(html)) { console.error('MOODS markers not found in index.html'); process.exit(1); }
let out = html.replace(re, () => '/*CATALOG_START*/\nconst CATALOG=' + JSON.stringify(CATALOG) + ';\n/*CATALOG_END*/');
out = out.replace(reMoods, () => '/*MOODS_START*/\nconst MOOD_PATTERNS=' + JSON.stringify(PATTERNS) + ';const MOOD_FRIENDS=' + JSON.stringify(FRIENDS) + ';\n/*MOODS_END*/');
const reScare = /\/\*SCARE_START\*\/[\s\S]*?\/\*SCARE_END\*\//;
if (!reScare.test(out)) { console.error('SCARE markers not found in index.html'); process.exit(1); }
out = out.replace(reScare, () => '/*SCARE_START*/\nconst scareWindow=' + scareWindow.toString() + ';\n/*SCARE_END*/');
const reIntent = /\/\*INTENT_START\*\/[\s\S]*?\/\*INTENT_END\*\//;
if (!reIntent.test(out)) { console.error('INTENT markers not found in index.html'); process.exit(1); }
out = out.replace(reIntent, () => '/*INTENT_START*/\nconst INTENT=' + JSON.stringify(INTENT) + ';\nconst detectIntent=' + detectIntent.toString() + ';\n/*INTENT_END*/');
fs.writeFileSync(file, out);
console.log('synced ' + CATALOG.length + ' titles and ' + Object.keys(PATTERNS).length + ' mood patterns into index.html');
