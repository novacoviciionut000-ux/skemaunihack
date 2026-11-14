// API client for AccessMap
// Connects to Spring Boot backend via Vite proxy (/api), with graceful fallbacks
// so the UI remains interactive even while GraphHopper or the backend is warming up.

// The session JWT lives in an HttpOnly cookie set by the backend, so page scripts can't read it.
// Remove what older versions of the app left in localStorage.
try {
    localStorage.removeItem('accessmap_jwt_token');
    localStorage.removeItem('accessmap_user_data');
} catch {
    /* storage unavailable */
}

const request = async (url, options = {}) => {
    const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
    };

    const res = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    if (!res.ok) {
        const message = (data && typeof data === 'object' && (data.error || data.message))
            ? (data.error || data.message)
            : (typeof data === 'string' && data.length < 200 ? data : `Eroare HTTP ${res.status}`);
        const err = new Error(message);
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
};

const postJson = (url, body) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

// ==================== AUTHENTICATION API ====================

/** POST /api/auth/login -> user profile; the session cookie is set by the server */
export const authLogin = ({ usernameOrEmail, password }) =>
    postJson('/api/auth/login', { usernameOrEmail, password });

/** POST /api/auth/register */
export const authRegister = (data) => postJson('/api/auth/register', data);

/**
 * POST /api/auth/oauth
 * @param {'google'} provider
 * @param {{ token: string }} payload  identity is taken from the verified Google token server-side
 */
export const authOAuth = (provider, payload) => postJson('/api/auth/oauth', { provider, ...payload });

/** POST /api/auth/logout: clears the HttpOnly session cookie */
export const authLogout = () => request('/api/auth/logout', { method: 'POST' });

/** GET /api/auth/me */
export const authGetMe = () => request('/api/auth/me');

/** PUT /api/auth/profile */
export const authUpdateProfile = (profileData) => request('/api/auth/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profileData),
});

export const authCheckUsername = async (username) => {
    if (!username || !username.trim()) {
        return { available: false, message: 'Numele de utilizator este obligatoriu.' };
    }
    try {
        return await request(`/api/auth/check-username?username=${encodeURIComponent(username.trim())}`);
    } catch {
        return { available: true, message: 'Verificarea nu a putut fi efectuată acum.' };
    }
};

/** GET /api/auth/oauth-config */
export const authGetOAuthConfig = async () => {
    try {
        return await request('/api/auth/oauth-config');
    } catch {
        return { googleClientId: null, googleConfigured: false, mailConfigured: false };
    }
};

/** POST /api/auth/test-email: sends to the logged-in user's own address */
export const authTestEmail = () => request('/api/auth/test-email', { method: 'POST' });

// ==================== HELP: DISTRESS SIGNAL, VOLUNTEERS, DEED POINTS ====================

/** Client presses the distress button. Pressing again returns the same active request. */
export const helpCreate = (lat, lng, note = '') =>
    postJson('/api/help', { latitude: lat, longitude: lng, note: note || null });

/** Client's own active request, or null. */
export const helpActive = async () => (await request('/api/help/active'))?.asClient || null;

export const helpCancel = (id) => request(`/api/help/${id}/cancel`, { method: 'POST' });

/** Client's answer to "was it really done?". */
export const helpConfirm = (id, completed) => postJson(`/api/help/${id}/confirm`, { completed });

/** Volunteer heartbeat: sends position, returns points, nearby requests and the active job. */
export const volunteerPresence = (lat, lng, onDuty) =>
    postJson('/api/volunteers/presence', { latitude: lat, longitude: lng, onDuty });

export const helpAccept = (id) => request(`/api/help/${id}/accept`, { method: 'POST' });
export const helpRelease = (id) => request(`/api/help/${id}/release`, { method: 'POST' });
export const helpFinish = (id) => request(`/api/help/${id}/finish`, { method: 'POST' });

export const volunteerLeaderboard = () => request('/api/volunteers/leaderboard');

// ==================== ROUTING & REPORTS API ====================

// Backend Report { id, latitude, longitude, type, description, upvotes, active, authorId, authorName }
const toObstacle = (r) => ({
    ...r,
    lat: r.latitude ?? r.lat,
    lng: r.longitude ?? r.lng,
    authorName: r.authorName || (r.author_name ? r.author_name : null),
});

/** Haversine distance in meters */
export const getDistance = (c1, c2) => {
    if (!c1 || !c2 || c1.lat == null || c2.lat == null) return 0;
    const R = 6371e3;
    const p1 = (c1.lat * Math.PI) / 180;
    const p2 = (c2.lat * Math.PI) / 180;
    const dp = ((c2.lat - c1.lat) * Math.PI) / 180;
    const dl = ((c2.lng - c1.lng) * Math.PI) / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const formatDistance = (meters) => {
    if (meters == null || isNaN(meters)) return '';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
};

export const normalizeSearchText = (str) =>
    (str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const TIMISOARA_LANDMARKS = [
    { displayName: 'Piața Victoriei (Centru / Operă), Timișoara', lat: 45.7538, lng: 21.2257, keywords: ['centru', 'opera', 'piata operei', 'victoriei', 'piata victoriei', 'teatru'] },
    { displayName: 'Catedrala Mitropolitană, Timișoara', lat: 45.7513, lng: 21.2245, keywords: ['catedrala', 'mitropolie', 'biserica', 'centru'] },
    { displayName: 'Piața Unirii (Centrul Vechi), Timișoara', lat: 45.7579, lng: 21.2289, keywords: ['unirii', 'piata unirii', 'dom', 'baroc', 'centru vechi'] },
    { displayName: 'Piața Libertății, Timișoara', lat: 45.7557, lng: 21.2272, keywords: ['libertatii', 'piata libertatii', 'primarie'] },
    { displayName: 'Bastionul Maria Theresia, Timișoara', lat: 45.7568, lng: 21.2335, keywords: ['bastion', 'bastionul', 'theresia', 'muzeu'] },
    { displayName: 'Iulius Town / Iulius Mall, Timișoara', lat: 45.7663, lng: 21.2291, keywords: ['iulius', 'iulius town', 'iulius mall', 'mall', 'shopping', 'openville', 'aradului'] },
    { displayName: 'Shopping City Timișoara (Calea Șagului)', lat: 45.7228, lng: 21.2062, keywords: ['shopping city', 'mall sagului', 'sagului', 'carrefour'] },
    { displayName: 'Gara de Nord, Timișoara', lat: 45.7505, lng: 21.2084, keywords: ['gara', 'gara de nord', 'tren', 'cfr'] },
    { displayName: 'Gara de Est, Timișoara', lat: 45.7560, lng: 21.2580, keywords: ['gara de est', 'est', 'fabric'] },
    { displayName: 'Universitatea Politehnica Timișoara (UPT)', lat: 45.7489, lng: 21.2280, keywords: ['upt', 'politehnica', 'electro', 'rectorat', 'facultate'] },
    { displayName: 'Universitatea de Vest din Timișoara (UVT)', lat: 45.7471, lng: 21.2315, keywords: ['uvt', 'universitatea de vest', 'parvan', 'studentesc'] },
    { displayName: 'Universitatea de Medicină și Farmacie (UMFT), Timișoara', lat: 45.7563, lng: 21.2266, keywords: ['umft', 'medicina', 'universitatea de medicina', 'eftimie murgu'] },
    { displayName: 'Complexul Studențesc, Timișoara', lat: 45.7460, lng: 21.2380, keywords: ['complex', 'complexul', 'complexu', 'complex studentesc', 'complexul studentesc', 'camine', 'camin', 'cantina', 'studenti'] },
    { displayName: 'Spitalul Clinic Județean de Urgență, Timișoara', lat: 45.7408, lng: 21.2415, keywords: ['spital', 'spitalul judetean', 'judetean', 'urgenta', 'sanatate'] },
    { displayName: 'Spitalul Municipal (Clinicile Noi), Timișoara', lat: 45.7585, lng: 21.2230, keywords: ['spital', 'municipal', 'clinicile noi', 'botanic'] },
    { displayName: 'Spitalul de Copii Louis Țurcanu, Timișoara', lat: 45.7530, lng: 21.2210, keywords: ['spital', 'copii', 'louis turcanu', 'pediatrie'] },
    { displayName: 'Parcul Rozelor, Timișoara', lat: 45.7508, lng: 21.2312, keywords: ['parc', 'rozelor', 'parcul rozelor', 'trandafiri', 'bega'] },
    { displayName: 'Parcul Central Anton Scudier, Timișoara', lat: 45.7510, lng: 21.2215, keywords: ['parcul central', 'scudier', 'parc'] },
    { displayName: 'Parcul Botanic, Timișoara', lat: 45.7600, lng: 21.2250, keywords: ['parcul botanic', 'botanic', 'parc'] },
    { displayName: 'Faleza Râului Bega (Podul Michelangelo)', lat: 45.7495, lng: 21.2340, keywords: ['bega', 'faleza', 'michelangelo', 'pod'] },
    { displayName: 'Piața Bălcescu, Timișoara', lat: 45.7400, lng: 21.2260, keywords: ['balcescu', 'piata balcescu', 'elisabetin'] },
    { displayName: 'Piața Traian, Timișoara', lat: 45.7570, lng: 21.2505, keywords: ['traian', 'piata traian', 'fabric'] },
    { displayName: 'Piața Maria (Sfânta Maria), Timișoara', lat: 45.7475, lng: 21.2185, keywords: ['maria', 'piata maria', 'sfanta maria', 'tramvai'] },
    { displayName: 'Piața 700, Timișoara', lat: 45.7565, lng: 21.2235, keywords: ['piata 700', '700'] },
    { displayName: 'Piața Badea Cârțan, Timișoara', lat: 45.7615, lng: 21.2440, keywords: ['badea cartan', 'piata badea cartan'] },
    { displayName: 'Stadionul Dan Păltinișanu, Timișoara', lat: 45.7403, lng: 21.2442, keywords: ['stadion', 'dan paltinisanu', 'paltinisanu'] },
    { displayName: 'Calea Torontalului, Timișoara', lat: 45.7730, lng: 21.2150, keywords: ['torontalului', 'calea torontalului', 'nord'] },
    { displayName: 'Calea Aradului, Timișoara', lat: 45.7750, lng: 21.2280, keywords: ['aradului', 'calea aradului', 'agronomie'] },
    { displayName: 'Calea Șagului, Timișoara', lat: 45.7320, lng: 21.2100, keywords: ['sagului', 'calea sagului', 'dambovita'] },
    { displayName: 'Calea Girocului (Calea Martirilor), Timișoara', lat: 45.7360, lng: 21.2400, keywords: ['girocului', 'martirilor', 'calea martirilor', 'soarelui'] },
    { displayName: 'Bulevardul Take Ionescu, Timișoara', lat: 45.7600, lng: 21.2400, keywords: ['take ionescu', 'politie'] },
    { displayName: 'Bulevardul Republicii, Timișoara', lat: 45.7515, lng: 21.2150, keywords: ['republicii', 'bulevardul republicii'] },
    { displayName: 'Aeroportul Internațional Traian Vuia Timișoara', lat: 45.8100, lng: 21.3380, keywords: ['aeroport', 'aeroportul', 'traian vuia', 'avion', 'terminal'] },
];

const SEARCH_STOPWORDS = new Set([
    'la', 'in', 'pe', 'cu', 'de', 'din', 'spre', 'catre', 'pana',
    'un', 'o', 'sa', 'si', 'sau', 'cel', 'cea', 'lui', 'al', 'a', 'ai', 'ale',
    'timisoara',
]);

const GENERIC_PLACE_WORDS = new Set([
    'strada', 'str', 'bulevardul', 'bd', 'blvd', 'calea', 'piata', 'aleea',
    'splaiul', 'intrarea', 'parcul', 'parc', 'spitalul', 'spital', 'universitatea',
    'soseaua', 'sos', 'sosea', 'bulevard',
]);

function wordMatchesToken(targetWords, token) {
    return targetWords.some((w) => {
        if (w === token) return true;
        // Potrivire de prefix pentru articole hotărâte / forme vorbite (ex: complex <-> complexul / complexu)
        const minLen = Math.min(w.length, token.length);
        if (minLen >= 4 && (w.startsWith(token) || token.startsWith(w))) {
            return true;
        }
        return false;
    });
}

/** Search and autocomplete locations as user types, with relevance-first + proximity sorting */
export const searchSuggestions = async (query = '', userLocation = null) => {
    const refCoords = userLocation && userLocation.lat != null
        ? { lat: Number(userLocation.lat), lng: Number(userLocation.lng) }
        : { lat: 45.7538, lng: 21.2257 }; // Fallback la Piața Victoriei (Centrul Timișoarei)

    const cleanQ = normalizeSearchText(query);
    const allTokens = cleanQ.length > 0 ? cleanQ.split(' ').filter(Boolean) : [];
    const meaningfulTokens = allTokens.filter((t) => !SEARCH_STOPWORDS.has(t));
    const queryTokens = meaningfulTokens.length > 0 ? meaningfulTokens : allTokens;
    const distinctiveTokens = queryTokens.filter((t) => !GENERIC_PLACE_WORDS.has(t));
    const effectiveTokens = distinctiveTokens.length > 0 ? distinctiveTokens : queryTokens;
    const effectivePhrase = effectiveTokens.join(' ');

    // Helper to score landmark relevance
    const getLandmarkRelevance = (item) => {
        if (queryTokens.length === 0) return 1;
        const normTitle = normalizeSearchText(item.displayName);
        const normKeywords = (item.keywords || []).map(normalizeSearchText);
        const targetWords = Array.from(new Set(
            `${normTitle} ${normKeywords.join(' ')}`.split(' ').filter(Boolean)
        ));

        if (normTitle.startsWith(cleanQ) || normKeywords.some((k) => k === cleanQ || (effectivePhrase && k === effectivePhrase))) {
            return 100;
        }
        if (
            (cleanQ.length >= 4 && (normTitle.includes(cleanQ) || normKeywords.some((k) => k.includes(cleanQ)))) ||
            (effectivePhrase.length >= 4 && (normTitle.includes(effectivePhrase) || normKeywords.some((k) => k.includes(effectivePhrase))))
        ) {
            return 92;
        }

        const matchedDistinctive = effectiveTokens.filter((token) => wordMatchesToken(targetWords, token));
        if (matchedDistinctive.length === 0) return 0;

        if (matchedDistinctive.length === effectiveTokens.length) {
            return 85;
        }

        return Math.round(45 * (matchedDistinctive.length / effectiveTokens.length));
    };

    // 1. Gather local matching landmarks
    let candidates = [];
    if (queryTokens.length === 0) {
        // Când nu a tastat nimic (câmpul a primit focus), afișăm direct cele mai apropiate locații de interes
        candidates = TIMISOARA_LANDMARKS.map((item) => ({
            ...item,
            relevance: 1,
            distanceMeters: Math.round(getDistance(refCoords, item)),
        }));
    } else {
        TIMISOARA_LANDMARKS.forEach((item) => {
            const rel = getLandmarkRelevance(item);
            if (rel > 0) {
                candidates.push({
                    displayName: item.displayName,
                    lat: item.lat,
                    lng: item.lng,
                    relevance: rel,
                    distanceMeters: Math.round(getDistance(refCoords, item)),
                });
            }
        });
    }

    // 2. If user typed >= 2 chars, also query backend Google Geocoding & Nominatim with Timișoara geographic bias
    if (cleanQ.length >= 2) {
        const searchQuery = cleanQ.includes('timisoara') ? query.trim() : `${query.trim()}, Timișoara`;

        // Încercăm întâi backend-ul local dacă este pornit
        try {
            const r = await request(`/api/geocode/suggest?q=${encodeURIComponent(query.trim())}&limit=5`);
            if (Array.isArray(r) && r.length > 0) {
                r.filter((item) => item && item.coordinate).forEach((item, idx) => {
                    const lat = Number(item.coordinate.lat);
                    const lng = Number(item.coordinate.lng);
                    candidates.push({
                        displayName: item.displayName || item.query,
                        lat,
                        lng,
                        relevance: Math.max(65, 78 - idx * 2),
                        distanceMeters: Math.round(getDistance(refCoords, { lat, lng })),
                    });
                });
            }
        } catch {
            // Ignorăm eroarea backend-ului și mergem la Nominatim
        }

        // Direct client-side OpenStreetMap Nominatim API with Timișoara viewbox
        try {
            const viewbox = '21.12,45.68,21.36,45.84'; // Bounding box Timișoara metropolitan
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(searchQuery)}&viewbox=${viewbox}&bounded=0&limit=8&countrycodes=ro`
            );
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    data.forEach((item, idx) => {
                        const lat = parseFloat(item.lat);
                        const lng = parseFloat(item.lon);
                        candidates.push({
                            displayName: item.display_name,
                            lat,
                            lng,
                            relevance: Math.max(50, 62 - idx * 2),
                            distanceMeters: Math.round(getDistance(refCoords, { lat, lng })),
                        });
                    });
                }
            }
        } catch {
            // Rețea indisponibilă, candidații locali rămân suficienți
        }
    }

    // 3. Deduplicate by approx lat/lng coordinates (within ~20 meters)
    const unique = [];
    candidates.forEach((cand) => {
        const isDuplicate = unique.some(
            (u) => Math.abs(u.lat - cand.lat) < 0.0003 && Math.abs(u.lng - cand.lng) < 0.0003
        );
        if (!isDuplicate) {
            unique.push(cand);
        }
    });

    // 4. Sort by relevance first; distance breaks ties within the same relevance tier
    unique.sort((a, b) => {
        const relDiff = (b.relevance || 0) - (a.relevance || 0);
        if (Math.abs(relDiff) > 5) {
            return relDiff;
        }
        return a.distanceMeters - b.distanceMeters;
    });

    // 5. Format results with human-readable distance badge
    return unique.slice(0, 7).map((item) => ({
        displayName: item.displayName,
        lat: item.lat,
        lng: item.lng,
        distanceMeters: item.distanceMeters,
        distanceFormatted: formatDistance(item.distanceMeters),
    }));
};

/** GET /api/geocode?q=... single lookup */
export const geocodeQuery = async (query) => {
    const list = await searchSuggestions(query);
    if (list && list.length > 0) {
        return [{ lat: list[0].lat, lon: list[0].lng, display_name: list[0].displayName }];
    }
    return [];
};

/** Folosit de VoiceButton.jsx: caută adresa prin Google Geocoding (/api/geocode/suggest) + fallback-uri */
export const geocodeAddress = async (query, userLocation = null) => {
    const list = await searchSuggestions(query, userLocation);
    return list && list.length > 0 ? list[0] : null;
};

// ==================== VOICE DESTINATION: CLOSEST MATCH ====================

const TIMISOARA_CENTER = { lat: 45.7538, lng: 21.2257 };
const NEARBY_RADIUS_DEG = 0.15; // ~15 km search box around the user
const UNREACHABLE_OSM_TYPES = new Set(['construction', 'disused', 'abandoned', 'proposed', 'demolished']);
// Bus stops, bike docks etc. are often named after a nearby store ("Kaufland" bus stop).
// They rank just below the store itself so "du-ma la Kaufland" leads to the shop.
const NAMED_AFTER_PLACE_TYPES = new Set(['bus_stop', 'platform', 'stop_position', 'tram_stop', 'bicycle_rental', 'parking', 'parking_entrance', 'taxi']);
const NEARBY_WORDS = /\b(?:cel|cea)\s+mai\s+(?:apropiat[ae]?|aproape)\b|\b(?:nearest|closest|near me|nearby|apropiat[ae]?|de langa mine|langa mine)\b/g;

// Spoken commands wrap the destination in intent words: "vreau sa ajung la kaufland",
// "trebuie sa ajung la gara", "cum ajung la spitalul judetean". Those words used to reach
// the geocoder as part of the query, so nothing matched, and they also diluted the name
// score (1 of 3 tokens matching "kaufland" scored 0.33, below the 0.5 acceptance bar).
//
// Filtering word by word rather than by sentence pattern, so word order and phrasing do
// not matter. These are matched against already-normalized text, so there are no
// diacritics or hyphens left: "du-mă" has become "du ma" by this point.
const VOICE_FILLER_WORDS = new Set([
  // politeness and address
  'te', 'va', 'rog', 'multumesc', 'mersi', 'hei', 'hey', 'ok', 'okay', 'asistent', 'accessmap',
  // wanting / needing
  'vreau', 'vreu', 'as', 'vrea', 'dori', 'doresc', 'trebuie', 'nevoie', 'am', 'aș',
  'pot', 'poti', 'hai', 'haide', 'sa', 'sal', 'fiu', 'dus', 'duca',
  // going
  'ajung', 'ajunge', 'merg', 'mergi', 'mergem', 'mergeti', 'plec', 'duc', 'duci', 'du',
  'condu', 'ghideaza', 'indreapta', 'deplasez', 'navigheaza', 'navigare', 'navigatie',
  // asking
  'cum', 'unde', 'incotro', 'e', 'este', 'fac',
  // searching / showing
  'caut', 'cauta', 'gaseste', 'arata', 'seteaza', 'pune', 'alege',
  // route nouns
  'ruta', 'rute', 'traseu', 'traseul', 'drum', 'drumul', 'destinatia', 'destinatie',
  'porneste', 'calculeaza', 'incepe',
  // pronouns and leftovers
  'ma', 'mi', 'mie', 'acum', 'repede', 'acolo',
  // English equivalents
  'i', 'want', 'wanna', 'need', 'would', 'like', 'take', 'bring', 'get', 'guide', 'walk',
  'lead', 'me', 'to', 'go', 'navigate', 'directions', 'route', 'please', 'show', 'find',
  'where', 'is', 'how', 'do', 'can',
]);

// Dropped only when they come first. In the middle they are part of the name,
// as in "Gara de Nord" or "Spitalul de Copii".
const VOICE_LEADING_PREPOSITIONS = new Set([
  'la', 'in', 'spre', 'catre', 'pe', 'pana', 'de', 'din', 'cu', 'the', 'a', 'an',
]);

/**
 * Strips spoken command wrappers so only the destination is left.
 * Returns the normalized original if stripping would leave nothing usable, so the
 * caller can reject a command that carried no destination at all.
 *
 * Trade-off: a single letter spoken as a word is treated as filler, so a name like
 * "Strada E. Murgu" reduces to "strada murgu". The geocoder still resolves that.
 */
export const stripVoiceIntent = (text) => {
  const normalized = normalizeSearchText(text);
  if (!normalized) return '';

  let tokens = normalized.split(' ').filter((t) => t && !VOICE_FILLER_WORDS.has(t));
  while (tokens.length && VOICE_LEADING_PREPOSITIONS.has(tokens[0])) {
    tokens = tokens.slice(1);
  }

  const out = tokens.join(' ');
  return out.length >= 2 ? out : normalized;
};

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
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

/** Token match tolerant of speech-recognition spelling errors ("kaufland" vs "kauflant"). */
function fuzzyTokenMatch(token, words) {
    const maxEdits = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    return words.some((w) => {
        if (w === token) return true;
        if (token.length >= 4 && w.length >= 4 && (w.startsWith(token) || token.startsWith(w))) return true;
        // Same first letter required: otherwise "sagului" matched "raului" (Faleza Raului Bega)
        return maxEdits > 0 && w[0] === token[0] && Math.abs(w.length - token.length) <= maxEdits && levenshtein(w, token) <= maxEdits;
    });
}

/** Fraction (0..1) of the query's distinctive words found in the candidate's name. */
function nameMatchScore(queryTokens, candidateText) {
    if (!queryTokens.length) return 0;
    const words = normalizeSearchText(candidateText).split(' ').filter(Boolean);
    const matched = queryTokens.filter((t) => fuzzyTokenMatch(t, words)).length;
    return matched / queryTokens.length;
}

function shortPlaceName(name, address) {
    const street = address ? [address.road, address.house_number].filter(Boolean).join(' ') : '';
    const area = address ? address.suburb || address.city_district || address.neighbourhood || '' : '';
    return [name, street || area].filter(Boolean).join(', ');
}

/**
 * Finds the place the user most likely means, and among equally good name matches picks the
 * one CLOSEST to the user. "Kaufland" -> nearest Kaufland store, not just the first result.
 *
 * @returns {Promise<{displayName, shortName, lat, lng, distanceMeters} | null>}
 */
export const findClosestPlace = async (query, userLocation = null, near = null) => {
    const ref = userLocation && userLocation.lat != null
        ? { lat: Number(userLocation.lat), lng: Number(userLocation.lng) }
        : TIMISOARA_CENTER;

    const cleanQ = stripVoiceIntent(query).replace(NEARBY_WORDS, ' ').replace(/\s+/g, ' ').trim();
    if (cleanQ.length < 2) return null;

    const tokens = cleanQ.split(' ').filter((t) => t && !SEARCH_STOPWORDS.has(t));
    const distinctive = tokens.filter((t) => !GENERIC_PLACE_WORDS.has(t));
    const queryTokens = distinctive.length ? distinctive : tokens;

    const candidates = [];
    const add = (c) => {
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
        candidates.push({ ...c, distanceMeters: Math.round(getDistance(ref, c)) });
    };

    // 1. Built-in landmarks
    TIMISOARA_LANDMARKS.forEach((lm) => {
        const score = Math.max(
            nameMatchScore(queryTokens, lm.displayName),
            nameMatchScore(queryTokens, (lm.keywords || []).join(' '))
        );
        if (score > 0) add({ displayName: lm.displayName, shortName: lm.displayName.split(',')[0], lat: lm.lat, lng: lm.lng, score });
    });

    // 2. OpenStreetMap: every matching place in a box around the user (all Kaufland stores, etc.)
    const nominatim = async (bounded) => {
        const d = NEARBY_RADIUS_DEG;
        const viewbox = `${ref.lng - d},${ref.lat + d},${ref.lng + d},${ref.lat - d}`;
        const params = new URLSearchParams({
            format: 'jsonv2',
            q: cleanQ,
            viewbox,
            bounded: bounded ? '1' : '0',
            limit: '25',
            countrycodes: 'ro',
            addressdetails: '1',
            namedetails: '1',
            'accept-language': 'ro',
        });
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
            if (!res.ok) return;
            const data = await res.json();
            if (!Array.isArray(data)) return;
            data.forEach((item) => {
                // Skip places you can't actually go to (e.g. a Kaufland that is still being built)
                if (UNREACHABLE_OSM_TYPES.has(item.type)) return;
                const name = item.name || item.namedetails?.name || item.display_name.split(',')[0];
                const brand = item.namedetails?.brand || '';
                let score = Math.max(nameMatchScore(queryTokens, `${name} ${brand}`), 0.5 * nameMatchScore(queryTokens, item.display_name));
                if (NAMED_AFTER_PLACE_TYPES.has(item.type)) score *= 0.9;
                add({
                    displayName: item.display_name,
                    shortName: shortPlaceName(name, item.address),
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                    score,
                });
            });
        } catch {
            /* offline: other sources still apply */
        }
    };

    // 3. Backend (Google Geocoding), useful for street addresses
    const backend = async () => {
        try {
            const r = await request(`/api/geocode/suggest?q=${encodeURIComponent(cleanQ)}&limit=5`);
            (Array.isArray(r) ? r : []).forEach((item) => {
                if (!item?.coordinate) return;
                const name = item.displayName || item.query || '';
                add({
                    displayName: name,
                    shortName: name.split(',').slice(0, 2).join(',').trim(),
                    lat: Number(item.coordinate.lat),
                    lng: Number(item.coordinate.lng),
                    score: nameMatchScore(queryTokens, name),
                });
            });
        } catch {
            /* backend down */
        }
    };

    await Promise.all([nominatim(true), backend()]);
    if (!candidates.some((c) => c.score >= 0.5)) {
        await nominatim(false); // nothing nearby: widen to the whole country
    }

    const good = candidates.filter((c) => c.score >= 0.5);
    if (!good.length) return null;

    // Best name-match tier first. Inside it, a spoken hint ("Kaufland de pe Gheorghe Lazar")
    // picks the store on that street; otherwise the nearest one wins.
    const bestScore = Math.max(...good.map((c) => c.score));
    const tier = good.filter((c) => c.score >= bestScore - 0.01);
    const nearTokens = near
        ? normalizeSearchText(near).split(' ').filter((t) => t && !SEARCH_STOPWORDS.has(t) && !GENERIC_PLACE_WORDS.has(t))
        : [];
    const nearScore = (c) => (nearTokens.length ? nameMatchScore(nearTokens, c.displayName) : 0);
    const best = tier.sort((a, b) => (nearScore(b) - nearScore(a)) || (a.distanceMeters - b.distanceMeters))[0];

    return {
        displayName: best.displayName,
        shortName: best.shortName || best.displayName,
        lat: best.lat,
        lng: best.lng,
        distanceMeters: best.distanceMeters,
        distanceFormatted: formatDistance(best.distanceMeters),
    };
};

/** GET /api/v1/route -> { coordinates: [[lat, lng]], distanceMeters, timeSeconds } */
export const getRoute = async (startCoords, endCoords, profile = 'low_vision') => {
    // 1. Încercăm backend-ul Spring Boot (care apelează GraphHopper local cu profilul dedicat de mobilitate)
    try {
        const params = new URLSearchParams({
            startLat: startCoords.lat,
            startLng: startCoords.lng,
            endLat: endCoords.lat,
            endLng: endCoords.lng,
            profile,
        });
        const r = await request(`/api/v1/route?${params}`);
        if (r && r.path && r.path.length > 1) {
            return {
                coordinates: r.path.map((p) => [p.lat, p.lng]),
                distanceMeters: r.distanceMeters,
                timeSeconds: r.timeSeconds,
                isFallback: false,
            };
        }
    } catch (err) {
        console.warn('Backend routing unavailable, attempting real pedestrian street routing:', err);
    }

    // 2. Ruterul real de pietoni OpenStreetMap (OSRM Foot Router)
    const osrmEndpoints = [
        `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson`,
        `https://router.project-osrm.org/route/v1/foot/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=geojson`,
    ];

    for (const url of osrmEndpoints) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data && data.routes && data.routes.length > 0) {
                    const route = data.routes[0];
                    const coords = (route.geometry?.coordinates || []).map((c) => [c[1], c[0]]);
                    if (coords.length > 1) {
                        const speedFactor = profile === 'wheelchair' ? 1.1 : profile === 'limited_mobility' ? 1.25 : 1.0;
                        return {
                            coordinates: coords,
                            distanceMeters: Math.round(route.distance),
                            timeSeconds: Math.round(route.duration * speedFactor),
                            isFallback: false,
                        };
                    }
                }
            }
        } catch {
            // încercăm următorul endpoint OSRM
        }
    }

    // 3. Fallback de siguranță dacă nu există conexiune la internet
    const dist = getDistance(startCoords, endCoords);
    return {
        coordinates: [
            [startCoords.lat, startCoords.lng],
            [endCoords.lat, endCoords.lng],
        ],
        distanceMeters: Math.round(dist),
        timeSeconds: Math.round(dist / 1.1),
        isFallback: true,
    };
};

const DEFAULT_REPORTS = [
    { id: 101, lat: 45.7550, lng: 21.2290, type: 'BLOCKED_SIDEWALK', description: 'Lucrări pe trotuar, acces impracticabil', authorName: 'Andrei Popa' },
    { id: 102, lat: 45.7512, lng: 21.2240, type: 'STAIRS_NO_RAMP', description: 'Trepte fără rampă la pasajul pietonal', authorName: 'Elena Ionescu' },
    { id: 103, lat: 45.7455, lng: 21.2180, type: 'BROKEN_ELEVATOR', description: 'Lift exterior defect', authorName: 'Marius D.' },
];

/** GET /api/reports */
export const getReports = async () => {
    try {
        const reports = await request('/api/reports');
        if (Array.isArray(reports) && reports.length > 0) {
            return reports.map(toObstacle);
        }
    } catch (err) {
        console.warn('Backend reports unavailable, using default sample obstacles:', err);
    }
    return DEFAULT_REPORTS.map(toObstacle);
};

/** POST /api/reports */
export const submitReport = async (lat, lng, type, description = '', author = null) => {
    const payload = {
        latitude: lat,
        longitude: lng,
        type,
        description,
        ...(author ? { authorId: author.id, authorName: author.fullName || author.username } : {}),
    };

    try {
        const saved = await request('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (saved) return toObstacle(saved);
    } catch (err) {
        console.warn('Could not save to backend DB, saving locally:', err);
    }
    return toObstacle({
        id: Date.now(),
        latitude: lat,
        longitude: lng,
        type,
        description,
        authorName: author ? (author.fullName || author.username) : 'Anonim',
    });
};

/** POST /api/reports/{id}/upvote */
export const upvoteReport = async (id) => {
    try {
        return await request(`/api/reports/${id}/upvote`, { method: 'POST' });
    } catch {
        return null;
    }
};