/**
 * Turns what speech recognition heard into a command.
 *
 * Speech recognition output is messy: "Du-mă la Kaufland" can arrive as "Dumă la Kaufland",
 * "du mi la kaufland", "Du-mă la Cofland" or "Du-mă la Kaufland-ul de pe Gheorghe Lazăr".
 * This module is pure (no React, no network) so it can be unit tested.
 */

/** Lowercase, no diacritics, single spaces. Keeps hyphens and digits. */
export function normalizeVoiceText(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:"„”«»()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words the recognizer glues together or splits differently than they are written
const SPOKEN_FIXES = [
  [/\bdu-?ma\b/g, 'du ma'],
  [/\bduma\b/g, 'du ma'],
  [/\bdu-?mi\b/g, 'du ma'],
  [/\bdumi\b/g, 'du ma'],
  [/\bdu-?ne\b/g, 'du ne'],
  [/\bdu-?te\b/g, 'du te'],
  [/\bcondu-?ma\b/g, 'condu ma'],
  [/\bghideaza-?ma\b/g, 'ghideaza ma'],
  [/\bia-?ma\b/g, 'ia ma'],
  [/\barata-?mi\b/g, 'arata mi'],
  [/\bcauta-?mi\b/g, 'cauta mi'],
  [/\bgaseste-?mi\b/g, 'gaseste mi'],
  [/\bspune-?mi\b/g, 'spune mi'],
  // Romanian definite article glued with a hyphen to foreign names: "Kaufland-ul", "Lidl-ul"
  [/([a-z0-9])-(?:ul|ului|uri|urile|ul)\b/g, '$1'],
];

function prepare(raw) {
  let text = normalizeVoiceText(raw);
  for (const [re, rep] of SPOKEN_FIXES) text = text.replace(re, rep);
  return text.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Command phrases (matched as whole words, never inside other words) ────────
// Real emergencies: always the 112 screen
const EMERGENCY = ['urgenta', '112', 'sos', 'ambulanta', 'ambulanta', 'salvarea', 'politia', 'pompierii', 'suna la 112'];
// Just "ajutor" / "help": a client gets a volunteer, everyone else the 112 screen
const BARE_HELP = ['ajutor', 'help', 'ajutor ajutor'];
const CAMERA_OPEN = [
  'deschide camera', 'porneste camera', 'activeaza camera', 'deschide cam', 'camera on',
  'vreau camera', 'deschide mi camera', 'arata camera', 'arata mi camera', 'open camera',
];
const CAMERA_CLOSE = ['inchide camera', 'opreste camera', 'camera off', 'dezactiveaza camera', 'close camera'];
const CANCEL_ROUTE = [
  'anuleaza ruta', 'opreste navigarea', 'sterge ruta', 'anuleaza traseul', 'opreste traseul',
  'anuleaza navigarea', 'cancel route', 'stop navigation',
];
const STATUS = [
  'cat mai am', 'cat dureaza', 'status ruta', 'ce destinatie am', 'cat e pana acolo', 'cat mai e',
];
const NAV_GUIDANCE = [
  'pe unde trebuie sa o iau', 'pe unde o iau', 'pe unde merg', 'incotro o iau', 'urmatorul pas',
  'pe unde sa merg', 'start navigare', 'porneste navigarea', 'incepe navigarea', 'incepe ghidarea',
  'navigare pas cu pas', 'pe unde tre sa o iau', 'pe unde trebe sa o iau',
];
// Help system ("buton de ajutor" for clients, deeds for volunteers). "ajutor" alone stays 112.
// Client
const CALL_VOLUNTEER = [
  'cheama un voluntar', 'cheama voluntar', 'cheama voluntarul', 'cheama pe cineva', 'cheama ajutor',
  'am nevoie de un voluntar', 'am nevoie de voluntar', 'am nevoie de ajutor', 'am nevoie de cineva',
  'am nevoie de o mana de ajutor', 'imi trebuie ajutor', 'vreau ajutor', 'vreau un voluntar',
  'trimite un voluntar', 'trimite pe cineva', 'trimite ajutor', 'sa vina cineva', 'vreau sa vina cineva',
  'cer ajutor', 'cere ajutor', 'semnal de ajutor', 'trimite semnal', 'trimite alerta', 'trimite semnalul',
  'ajuta ma', 'ajutati ma', 'ma ajuta cineva', 'poate sa ma ajute cineva', 'ajutor te rog', 'ajutor va rog',
  'i need help', 'call a volunteer', 'send help',
];
const CANCEL_HELP = [
  'anuleaza cererea', 'anuleaza ajutorul', 'anuleaza semnalul', 'anuleaza voluntarul',
  'nu mai am nevoie de ajutor', 'nu mai am nevoie', 'opreste cererea', 'opreste semnalul',
];
const HELP_STATUS = [
  'unde e voluntarul', 'unde este voluntarul', 'cand vine voluntarul', 'vine cineva', 'vine voluntarul',
  'a acceptat cineva', 'cat mai dureaza voluntarul', 'cat de departe e voluntarul', 'ce face cererea',
  'stadiul cererii', 'status cerere',
];
// Volunteer
const DEED_FINISHED = [
  'fapta e gata', 'fapta este gata', 'fapta terminata', 'am terminat fapta', 'am terminat', 'am ajutat',
  'gata am ajutat', 'am rezolvat', 'deed finished',
];
const ACCEPT_HELP = [
  'accept', 'accept cererea', 'accepta', 'accepta cererea', 'preiau', 'preiau cererea', 'ajut eu',
  'o ajut', 'il ajut', 'ajut', 'merg eu', 'ma duc eu', 'vin eu',
];
const RELEASE_HELP = [
  'nu mai pot ajunge', 'nu pot ajunge', 'nu pot sa ajung', 'renunt', 'renunt la cerere', 'nu mai pot',
  'trimite la altcineva', 'da o altcuiva',
];
const DUTY_ON = ['intru in serviciu', 'intra in serviciu', 'sunt disponibil', 'sunt in serviciu', 'porneste serviciul'];
const DUTY_OFF = ['ies din serviciu', 'iesi din serviciu', 'nu sunt disponibil', 'opreste serviciul', 'termin serviciul'];
const MY_POINTS = ['cate puncte am', 'punctele mele', 'ce nivel am', 'cate fapte am', 'scorul meu'];

export const YES = ['da', 'da te rog', 'confirm', 'confirma', 'corect', 'exact', 'ok', 'bine', 'mergem', 'porneste', 'hai', 'asa e', 'perfect', 'yes'];
export const NO = ['nu', 'nu e bine', 'anuleaza', 'opreste', 'gresit', 'altceva', 'alta adresa', 'no'];

/** Whole-word phrase match: "sos" matches "sos" but not "soseaua". */
export function hasPhrase(text, phrases) {
  const padded = ` ${text} `;
  return phrases.some((p) => padded.includes(` ${p} `));
}

/** Text starts with one of the phrases as whole words ("da", "da te rog ..."). */
export function startsWithPhrase(text, phrases) {
  return phrases.some((p) => text === p || text.startsWith(`${p} `));
}

// ─── Destination intent ───────────────────────────────────────────────────────
// A "going" word followed (within a few words) by a preposition marks a destination:
// "du ma la X", "vreau sa merg la X", "cum ajung la X", "take me to X".
const GO_WORDS = new Set([
  'du', 'duce', 'duci', 'ducem', 'duceti', 'ajung', 'ajunge', 'ajungem', 'merg', 'mergi', 'mergem',
  'plec', 'pleaca', 'plecam', 'navigheaza', 'navigare', 'navigatie', 'condu', 'conduce', 'ghideaza',
  'indruma', 'drum', 'drumul', 'ruta', 'traseu', 'traseul', 'vreau', 'vrea', 'hai', 'haide', 'ia',
  'take', 'bring', 'go', 'navigate', 'get', 'directions', 'head', 'walk', 'lead', 'guide', 'route',
]);
const TO_WORDS = new Set(['la', 'spre', 'catre', 'in', 'pe', 'pana', 'to', 'towards']);
// "cauta Kaufland", "unde e cel mai apropiat Lidl": the destination follows directly
const SEARCH_WORDS = new Set(['cauta', 'gaseste', 'arata', 'find', 'search', 'show', 'unde', 'where']);
const SKIP_AFTER_SEARCH = new Set(['mi', 'me', 'for', 'e', 'este', 'is', 'gasesc', 'se', 'afla', 'the', 'a', 'drumul', 'spre', 'la', 'catre']);

const POLITE_TAIL = /\s+(?:te rog|va rog|multumesc|mersi|acum|repede|please|now|thanks|thank you)$/;
const NEAREST = /\b(?:(?:cel|cea)\s+mai\s+(?:apropiat[ae]?|aproape)|(?:the\s+)?(?:nearest|closest)|near me|nearby|close by|de langa mine|langa mine)\b/g;
// "Kaufland de pe Gheorghe Lazar": the part after is only a hint for picking among stores
const QUALIFIER = /\s+(?:de pe|de la|de langa|langa|din|on|near)\s+(.+)$/;

/** Places people ask for by voice, with spellings speech recognition commonly produces. */
const KNOWN_PLACES = [
  ['Kaufland', ['kaufland', 'kauflan', 'kofland', 'koflan', 'cofland', 'caufland', 'kau fland', 'kaufeland', 'kaufland u']],
  ['Lidl', ['lidl', 'lidel', 'lidal', 'lidle', 'lidu']],
  ['Carrefour', ['carrefour', 'carefour', 'carfur', 'karfur', 'carrefur', 'kerfur', 'carfour']],
  ['Auchan', ['auchan', 'osan', 'oshan', 'ausan', 'auchan u']],
  ['Profi', ['profi', 'profy']],
  ['Penny', ['penny', 'peni', 'penni']],
  ['Mega Image', ['mega image', 'mega imaj', 'megaimage', 'mega imagine', 'mega imag']],
  ['Selgros', ['selgros', 'sel gros', 'selgross']],
  ['Metro', ['metro cash', 'metro']],
  ['Dedeman', ['dedeman', 'dede man', 'dedemann']],
  ['Hornbach', ['hornbach', 'hornbah', 'hornbak']],
  ['IKEA', ['ikea', 'ichea', 'ikeea', 'ikeia']],
  ['Decathlon', ['decathlon', 'decatlon', 'decathlon u']],
  ['McDonalds', ['mcdonalds', 'mc donalds', 'mac donalds', 'mekdonalds', 'mec donalds', 'meci donalds', 'mcdonald']],
  ['KFC', ['kfc', 'ka ef ce', 'ca ef ce']],
  ['Starbucks', ['starbucks', 'starbacs', 'star bucks', 'starbax']],
  ['Altex', ['altex', 'altecs']],
  ['Flanco', ['flanco', 'flanko']],
  ['Pepco', ['pepco', 'pepko']],
  ['Catena', ['catena', 'farmacia catena']],
  ['Iulius Town', ['iulius town', 'iulius mall', 'iulius', 'iuliu mall', 'julius mall', 'julius town']],
  ['Shopping City', ['shopping city', 'soping city', 'shoping city']],
];

// Spellings that sound the same in Romanian: c/k/q, ph/f, w/v, y/i, doubled letters
function soundKey(s) {
  return s
    .replace(/\s+/g, '')
    .replace(/ph/g, 'f')
    .replace(/ch/g, 'k')
    .replace(/[cq]/g, 'k')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/x/g, 'ks')
    .replace(/(.)\1+/g, '$1');
}

function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

const PLACE_KEYS = KNOWN_PLACES.flatMap(([name, aliases]) => aliases.map((a) => ({ name, key: soundKey(a) })));

/**
 * Replaces a misheard brand ("cofland", "carfur") with its real name.
 * Only whole groups of 1-3 words are compared, with a tolerance that grows with length,
 * so ordinary words are not "corrected".
 * @returns {{ text: string, known: string|null }}
 */
const STREET_WORDS = new Set(['strada', 'str', 'bulevardul', 'bd', 'calea', 'piata', 'aleea', 'splaiul', 'intrarea', 'soseaua']);

function matchKnownPlace(phrase) {
  const key = soundKey(phrase);
  if (key.length < 3) return null;
  // Also try without a Romanian article stuck to the end: "kauflandul", "lidlul", "carrefourului"
  const variants = [key, key.replace(/ului$/, ''), key.replace(/ul$/, ''), key.replace(/u$/, '')];
  for (const v of variants) {
    if (v.length < 3) continue;
    const hit = PLACE_KEYS.find((p) => {
      // tolerance follows the brand's length, so short brands must match exactly
      const tolerance = p.key.length >= 8 ? 2 : p.key.length >= 6 ? 1 : 0;
      return Math.abs(p.key.length - v.length) <= tolerance && editDistance(p.key, v) <= tolerance;
    });
    if (hit) return hit;
  }
  return null;
}

export function correctPlaceName(text) {
  const words = text.split(' ').filter(Boolean);
  // A street address is never a brand ("Strada Iuliu Maniu" must not become "Iulius Town")
  if (words.length && STREET_WORDS.has(words[0])) return { text, known: null };
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const hit = matchKnownPlace(words.slice(i, i + size).join(' '));
      if (hit) {
        const out = [...words.slice(0, i), hit.name, ...words.slice(i + size)].join(' ');
        return { text: out, known: hit.name };
      }
    }
  }
  return { text, known: null };
}

function titleCase(s) {
  return s.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

function cleanDestination(tokens) {
  let text = tokens.join(' ');
  text = text.replace(POLITE_TAIL, '').replace(NEAREST, ' ').replace(/\s+/g, ' ').trim();
  // leading articles / prepositions left over ("la la", "pana la", "the")
  text = text.replace(/^(?:(?:la|spre|catre|in|pe|pana|the|a|an|to)\s+)+/, '').trim();

  let near = null;
  const q = text.match(QUALIFIER);
  if (q && text.length - q[0].length >= 2) {
    near = q[1].trim();
    text = text.slice(0, text.length - q[0].length).trim();
  }

  const corrected = correctPlaceName(text);
  if (!corrected.text || corrected.text.length < 2) return null;
  return {
    query: corrected.known ? corrected.text : titleCase(corrected.text),
    near: near ? titleCase(near) : null,
    knownPlace: corrected.known,
  };
}

/** Destination after a go-word + preposition, or after a search word. Null if no such intent. */
function destinationFromIntent(words) {
  const limit = Math.min(words.length, 6); // intent words come first in a command
  for (let i = 0; i < limit; i++) {
    if (GO_WORDS.has(words[i])) {
      for (let j = i + 1; j < Math.min(words.length, i + 6); j++) {
        if (TO_WORDS.has(words[j])) {
          let k = j + 1;
          if (words[j] === 'pana' && words[k] === 'la') k++;
          const dest = cleanDestination(words.slice(k));
          if (dest) return dest;
        }
      }
    }
    if (SEARCH_WORDS.has(words[i])) {
      let k = i + 1;
      while (k < words.length && SKIP_AFTER_SEARCH.has(words[k])) k++;
      const dest = cleanDestination(words.slice(k));
      if (dest) return dest;
    }
  }
  return null;
}

/**
 * @param {string} transcript what the recognizer heard
 * @param {{ awaitingConfirmation?: boolean }} [ctx]
 * @returns {{ type: string, transcript: string, destination?: {query, near, knownPlace}, newDestination?: object|null }}
 *   type: confirm-yes | confirm-no | destination | emergency | camera-open | camera-close |
 *         cancel-route | status | start-navigation | call-volunteer | cancel-help | help-status |
 *         deed-finished | accept-help | release-help | duty-on | duty-off | my-points | unknown
 * ctx.isClient: logged in as a client, so a bare "ajutor" calls a volunteer instead of 112
 */
export function parseVoiceCommand(transcript, ctx = {}) {
  const text = prepare(transcript);
  const words = text.split(' ').filter(Boolean);
  const result = (type, extra = {}) => ({ type, transcript, ...extra });

  if (!text) return result('unknown');

  if (ctx.awaitingConfirmation) {
    if (startsWithPhrase(text, YES)) return result('confirm-yes');
    if (startsWithPhrase(text, NO)) {
      const rest = text.replace(/^(?:nu|gresit|altceva|no)\s*/, '').split(' ').filter(Boolean);
      const dest = rest.length ? destinationFromIntent(rest) || cleanDestination(rest) : null;
      return result('confirm-no', { newDestination: dest && dest.query.length >= 3 ? dest : null });
    }
  }

  // Control phrases first: "anuleaza ruta" also contains the go-word "ruta"
  if (hasPhrase(text, CANCEL_HELP)) return result('cancel-help');
  if (hasPhrase(text, HELP_STATUS)) return result('help-status');
  if (hasPhrase(text, DEED_FINISHED)) return result('deed-finished');
  if (hasPhrase(text, RELEASE_HELP)) return result('release-help');
  if (hasPhrase(text, DUTY_OFF)) return result('duty-off');
  if (hasPhrase(text, DUTY_ON)) return result('duty-on');
  if (hasPhrase(text, MY_POINTS)) return result('my-points');
  // Whole utterance only: "ajut" must not fire inside "ajuta-ma sa ajung la ..."
  if (startsWithPhrase(text, ACCEPT_HELP) && words.length <= 3) return result('accept-help');
  if (hasPhrase(text, CANCEL_ROUTE)) return result('cancel-route');
  if (hasPhrase(text, CAMERA_CLOSE)) return result('camera-close');
  if (hasPhrase(text, CAMERA_OPEN)) return result('camera-open');
  if (hasPhrase(text, STATUS)) return result('status');
  if (hasPhrase(text, NAV_GUIDANCE)) return result('start-navigation');

  // An explicit "take me to ..." wins over emergency words inside a place name
  // ("du-ma la spitalul de urgenta", "du-ma pe soseaua sagului").
  const intent = destinationFromIntent(words);
  if (intent) return result('destination', { destination: intent });

  if (hasPhrase(text, EMERGENCY)) return result('emergency');
  // After destinations, so "ajuta-ma sa ajung la gara" navigates instead of calling a volunteer
  if (hasPhrase(text, CALL_VOLUNTEER)) return result('call-volunteer');
  if (BARE_HELP.includes(text) || hasPhrase(text, BARE_HELP)) {
    return result(ctx.isClient ? 'call-volunteer' : 'emergency');
  }

  // No command words at all: treat the whole phrase as a place name ("Kaufland"). Noise
  // ("eee", "hmm", one stray syllable) is noise, not a destination.
  const bare = cleanDestination(words);
  const looksLikeName = (q) => q.replace(/\s/g, '').length >= 4 && !/^(.)\1*$/i.test(q.replace(/\s/g, '')) && /[aeiouy]/i.test(q);
  if (bare && (bare.knownPlace || looksLikeName(bare.query))) return result('destination', { destination: bare });

  return result('unknown');
}

/**
 * Picks the most useful of the recognizer's alternatives: a destination naming a known place
 * beats a plain destination, which beats any other command, which beats nothing.
 * @param {string[]} transcripts best-first, as the recognizer returned them
 */
export function pickBestCommand(transcripts, ctx = {}) {
  const parsed = transcripts.filter(Boolean).map((t) => parseVoiceCommand(t, ctx));
  if (!parsed.length) return parseVoiceCommand('', ctx);
  const rank = (c) => {
    if (c.type === 'destination') return c.destination.knownPlace ? 3 : 2;
    return c.type === 'unknown' ? 0 : 1;
  };
  // Stable: among equal ranks the recognizer's own first choice stays first
  return parsed.reduce((best, c) => (rank(c) > rank(best) ? c : best), parsed[0]);
}
