// Mood vocabulary shared by the server (to pick which titles to show the model) and the page (live reactions + built-in clerk).
// `npm run sync` copies these into index.html, so the two can never drift apart.
const PATTERNS = {
  grief: "\\b(sad|cry(?:ing)?|grief|griev\\w*|miss(?:ing)? (?:him|her|them|home|someone|my)|lost (?:my|a)|heartbroken|funeral|passed away|died)\\b",
  breakup: "\\b(ghost(?:ed|ing)|breakup|broke up|dumped|situationship|rejected|left on read|my ex)\\b",
  burnout: "\\b(burn(?:ed|t)?[ -]?out|exhaust\\w*|overworked|boss|deadline|meeting|circle back|tired|no sleep|zero sleep|sleep[- ]deprived|drained)\\b",
  pressure: "\\b(exams?|viva|assignments?|backlogs?|placements?|interviews?|semester|attendance|cgpa|resume|internships?|results?|rejection)\\b",
  anxiety: "\\b(anxi\\w*|overthink\\w*|panic\\w*|worried|worry|nervous|stress\\w*|can'?t stop thinking|spiral\\w*)\\b",
  loneliness: "\\b(lonely|alone|no one|nobody|friendless|isolated|homesick)\\b",
  rage: "\\b(angry|furious|annoyed|rage|hate|pissed|irritated|fed up)\\b",
  boredom: "\\b(bored|boring|nothing to do|meh|monday|same old|routine|distract\\w*|killing time|time to kill)\\b",
  fun: "\\b(happy|great|party|weekend|excited|celebrat\\w*|amazing|laugh\\w*|funny|comed\\w*|silly|giggl\\w*)\\b",
  nostalgia: "\\b(nostalg\\w*|childhood|old days|remember when|throwback)\\b",
  adrenaline: "\\b(adrenaline|thrill\\w*|intense|edge of (?:my|the) seat|heart[- ]?pounding|action[- ]packed|chase|survival)\\b",
  curious: "\\b(mystery|mysteries|twist\\w*|mind[- ]?bend\\w*|puzzle\\w*|theor(?:y|ies)|trippy|strange)\\b",
  family: "\\b(family|mom|mum|mother|dad|father|parents?|siblings?|brother|sister|grandma|grandmother|grandpa|grandfather)\\b",
  cozy: "\\b(co[sz][yi]|cuddl\\w*|snuggl\\w*|blanket|rain\\w*|candle\\w*|hot chocolate|chai|autumn)\\b",
  guilt: "\\b(guilt\\w*|regret\\w*|ashamed|shame|my fault|feel bad|screwed up|messed up)\\b",
  paranoia: "\\b(paranoi\\w*|being watched|watching me|followed|stalk\\w*|suspicious|trust issues)\\b",
};
const FRIENDS = "\\b(friends?|roommates?|squad|gang|group|with (?:my )?(?:bf|gf|partner|siblings?))\\b";

// Intent: is the customer telling us HOW SCARY they want it? "scare me" / "nothing too scary" are not feelings, so they get their own check.
// Gentle wins over scare ("I scare easily" must not be read as "scare me"). Self-contained apart from INTENT: `npm run sync` copies both into index.html.
const INTENT = {gentle: "\\b(?:(?:not|nothing|no)\\s+(?:too\\s+|that\\s+|very\\s+|so\\s+|overly\\s+)?(?:scary|intense|gory|heavy|disturbing)|no\\s+(?:jump\\s?scares?|gore|blood)|(?:scare|scared|spook\\w*|freak\\w*)\\s+(?:so\\s+)?easily|easily\\s+(?:scared|spooked|frightened|freaked)|(?:don'?t|do not|can'?t|cannot|won'?t)\\s+(?:really\\s+)?(?:like|want|handle|do|watch|take|enjoy)\\s+(?:\\w+\\s+){0,2}(?:scary|horror|gore|jump\\s?scares?|violence)|(?:hate|dislike|avoid)\\s+(?:\\w+\\s+){0,2}(?:scary|horror|gore|jump\\s?scares?)|chicken|wimp|scaredy|coward|co[sz][yi]|cuddl\\w*|comfort\\w*|wholesome|gentle|light-?hearted|easy\\s+watch|chill\\s+(?:night|vibes?|watch)|relax\\w*|unwind|easy\\s+on\\s+the\\s+(?:scares?|gore|horror))\\b", scare: "\\b(?:(?:scare|terrify|terrorize|frighten|horrify|petrify|traumatize|disturb|spook|freak|wreck|ruin)\\s+(?:the\\s+(?:pants|crap|shit|hell|life|daylights)\\s+(?:off|out\\s+of)\\s+)?(?:me|us)|(?:want|wanna|need|ready|in the mood|down|dying)\\s+(?:\\w+\\s+){0,3}(?:to\\s+)?(?:be|get|feel)\\s+(?:\\w+\\s+){0,2}(?:scared|terrified|frightened|horrified|petrified|spooked|traumati[sz]ed)|(?:something|anything|a movie|a game|a show|stuff)\\s+(?:really\\s+|super\\s+|very\\s+|so\\s+|properly\\s+|genuinely\\s+|actually\\s+)?(?:scary|terrifying|frightening|horrifying|disturbing|brutal|hardcore)|(?:a|some|any)\\s+(?:really\\s+|super\\s+|very\\s+|properly\\s+|genuinely\\s+)?(?:scary|terrifying|frightening|horrifying|disturbing)\\s+(?:movie|film|game|show|series|story)|(?:shit|crap|poop|pee|piss|wet)\\w*\\s+(?:my(?:self)?|me|our)(?:\\s+pants)?|pants\\b.{0,24}\\b(?:shit|crap|wet|soil)|nothing\\s+(?:ever\\s+)?(?:scares|frightens|terrifies)\\s+me|(?:make|let)\\s+me\\s+(?:scream|jump|cry|shake|sweat)|keep\\s+me\\s+up|give\\s+me\\s+nightmares|bring\\s+(?:it\\s+on|the\\s+fear))\\b"};
function detectIntent(text) {
  var s = String(text || '');
  if (new RegExp(INTENT.gentle, 'i').test(s)) return 'gentle';
  if (new RegExp(INTENT.scare, 'i').test(s)) return 'scare';
  return null;
}

// Returns the moods found in `text`, most frequent first: [{ k: 'burnout', n: 2 }, ...]. 'friends' is a tag, not a mood line.
function detectTags(text) {
  const out = [];
  for (const k of Object.keys(PATTERNS)) {
    const n = (String(text).match(new RegExp(PATTERNS[k], 'gi')) || []).length;
    if (n) out.push({ k, n });
  }
  if (new RegExp(FRIENDS, 'i').test(text)) out.push({ k: 'friends', n: 1 });
  return out.sort((a, b) => b.n - a.n);
}

// The scare slider is a TARGET, not just a ceiling: "Bring it on" must give genuinely scary tapes, "Gentle" the cosy ones.
// Keep the titles whose dread is at the chosen level or the one just below it; if that leaves too few, widen downwards;
// if the whole pool is tiny, take the titles closest to the level. Self-contained on purpose: `npm run sync` copies this
// function's source into index.html, so the page and the server always apply exactly the same rule.
function scareWindow(list, tol, min) {
  min = min || 8;
  var lo = Math.max(1, tol - 1);
  var out = list.filter(function (c) { return c.dread <= tol && c.dread >= lo; });
  while (out.length < min && lo > 1) {
    lo--;
    out = list.filter(function (c) { return c.dread <= tol && c.dread >= lo; });
  }
  if (out.length < Math.min(min, 6)) {
    out = list.slice().sort(function (a, b) {
      return Math.abs(a.dread - tol) - Math.abs(b.dread - tol) || a.dread - b.dread || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }).slice(0, Math.min(list.length, 6));
  }
  return out;
}

module.exports = { PATTERNS, FRIENDS, INTENT, detectTags, detectIntent, scareWindow };
