// Shared mood vocabulary + scare intent. Run: node tests/moods.test.js
const path = require('path');
const { PATTERNS, FRIENDS, INTENT, detectTags, detectIntent } = require(path.join(__dirname, '..', 'lib', 'moods.js'));
const { TAGS, CATALOG } = require(path.join(__dirname, '..', 'lib', 'catalog.js'));
let ok = true; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) ok = false; };

// ---------- every vocabulary entry is well-formed ----------
t('every mood pattern compiles and is a valid catalog tag (so a detected mood can match titles)', Object.keys(PATTERNS).every(k => { try { new RegExp(PATTERNS[k], 'i'); } catch (e) { return false; } return TAGS.includes(k); }));
t('every mood has at least 2 titles on the shelf that carry its tag', Object.keys(PATTERNS).every(k => CATALOG.filter(c => c.tags.includes(k)).length >= 2));
t('INTENT patterns compile', ['gentle', 'scare'].every(k => { try { new RegExp(INTENT[k], 'i'); return true; } catch (e) { return false; } }));
t('the 16 mood words the clerk understands', Object.keys(PATTERNS).length === 16);

// ---------- intent: HOW scary they want it ----------
const SCARE = ['im in the mood to get my pants shit on', 'scare me', 'Scare Me!', 'i want to be terrified', 'i wanna get so scared i cant sleep', 'give me something really scary', 'something terrifying', 'nothing scares me', 'make me scream', 'scare the pants off me', 'terrify me', 'traumatize me', 'i wanna shit my pants', 'bring it on', 'give me nightmares', 'a scary movie', 'i need to get spooked', 'something brutal', 'wreck me', 'keep me up all night'];
const GENTLE = ['nothing too scary please', 'not too scary', 'i scare easily', 'i get scared easily', 'im a scaredy cat', 'no jump scares', 'i hate jump scares', 'cozy night in', 'cosy night in', 'something cozy', 'dont want anything too scary', 'i cant handle scary stuff', 'easy on the gore', 'im a total chicken', 'something wholesome', 'a light-hearted one', 'something to relax with', 'no gore please'];
const NONE = ['this week was brutal', 'brutal exam week', 'exam week zero sleep', 'i am scared about my results', 'im scared of my boss', 'got ghosted, totally fine', 'placement season is eating me', "boss said let's circle back", 'everything is great (it is not)', "it's Monday", 'i hate my job', 'scarlet letter vibes', 'wet weather and a boring day', 'my boss shit on my idea', 'i feel so guilty', 'i want to cry', 'i want a mystery', 'my mom is annoying', 'what a shitty day', 'i need a laugh', 'so tired', 'hi', ''];
t(`recognises ${SCARE.length} natural ways to ask for fear`, SCARE.every(x => detectIntent(x) === 'scare') || (console.log('   missed:', SCARE.filter(x => detectIntent(x) !== 'scare')), false));
t(`recognises ${GENTLE.length} natural ways to ask for gentle`, GENTLE.every(x => detectIntent(x) === 'gentle') || (console.log('   missed:', GENTLE.filter(x => detectIntent(x) !== 'gentle')), false));
t(`does NOT misread ${NONE.length} ordinary sentences (a brutal week, being scared of exams, a shitty day...)`, NONE.every(x => detectIntent(x) === null) || (console.log('   wrongly matched:', NONE.filter(x => detectIntent(x) !== null)), false));
t('gentle wins over scare: "I scare easily" is never read as "scare me"', detectIntent('i scare easily') === 'gentle' && detectIntent('please dont scare me too much, i scare easily') === 'gentle');
t('a request for both is resolved, not crashed', ['gentle', 'scare'].includes(detectIntent('cozy but also scare me')));

// ---------- the new moods ----------
const MOODS = { 'cozy rainy night': 'cozy', 'cozy night in': 'cozy', 'im feeling guilty about a mistake': 'guilt', 'my mom is driving me crazy': 'family', 'my parents and my sister': 'family', 'i need adrenaline': 'adrenaline', 'something thrilling': 'adrenaline', 'i want a good mystery': 'curious', 'mind bending twist': 'curious', 'i feel like someone is watching me': 'paranoia', 'i feel so paranoid': 'paranoia', 'i need a laugh and a distraction': 'fun', 'something funny': 'fun', 'killing time': 'boredom' };
for (const [txt, tag] of Object.entries(MOODS)) t(`"${txt}" is heard as ${tag}`, detectTags(txt).some(x => x.k === tag));
t('the original moods still work (regression)', detectTags('got ghosted').some(x => x.k === 'breakup') && detectTags('exam week').some(x => x.k === 'pressure') && detectTags('so tired').some(x => x.k === 'burnout') && detectTags('i miss home').some(x => x.k === 'grief') && detectTags('so lonely').some(x => x.k === 'loneliness'));
t('friends is still detected as a tag', detectTags('going out with my friends').some(x => x.k === 'friends') && new RegExp(FRIENDS, 'i').test('squad night'));

// ---------- robustness ----------
t('non-string input never crashes', [null, undefined, 42, {}, [], true].every(x => { try { detectIntent(x); detectTags(x); return true; } catch (e) { return false; } }));
const nasty = ['a '.repeat(300), 'want '.repeat(120), 'not '.repeat(150), 'pants'.repeat(120), 'shit '.repeat(120) + 'pants', ('want to be ' + 'x '.repeat(40)).repeat(5), 'scare the '.repeat(60), ' '.repeat(600), 'x'.repeat(600)];
const t0 = Date.now(); nasty.forEach(x => { detectIntent(x); detectTags(x); });
t(`adversarial 600-character inputs are matched in well under a second (${Date.now() - t0} ms for ${nasty.length})`, Date.now() - t0 < 500);
console.log(ok ? '\nALL MOODS TESTS PASSED' : '\nSOME MOODS TESTS FAILED'); process.exit(ok ? 0 : 1);
