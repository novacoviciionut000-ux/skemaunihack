// API client for AccessMap
// Connects to Spring Boot backend via Vite proxy (/api), with graceful fallbacks
// so the UI remains interactive even while GraphHopper or the backend is warming up.

const TOKEN_KEY = 'accessmap_jwt_token';
const USER_KEY = 'accessmap_user_data';

export const getStoredToken = () => {
    try {
        return localStorage.getItem(TOKEN_KEY) || null;
    } catch {
        return null;
    }
};

export const setStoredAuth = (token, user) => {
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {
        console.warn('Could not save auth in localStorage:', e);
    }
};

export const getStoredUser = () => {
    try {
        const u = localStorage.getItem(USER_KEY);
        return u ? JSON.parse(u) : null;
    } catch {
        return null;
    }
};

export const clearStoredAuth = () => {
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    } catch (e) {
        console.warn('Could not clear auth in localStorage:', e);
    }
};

const request = async (url, options = {}) => {
    const token = getStoredToken();
    const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
    };

    if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...options, headers });
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

// ==================== AUTHENTICATION API ====================

/**
 * POST /api/auth/login
 * @param {{ usernameOrEmail: string, password: string }} credentials
 */
export const authLogin = async ({ usernameOrEmail, password }) => {
    try {
        const res = await request('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernameOrEmail, password }),
        });
        if (res && res.token) {
            setStoredAuth(res.token, res);
        }
        return res;
    } catch (err) {
        // Dacă backend-ul nu este pornit încă (ex. offline dev mode), oferim cont demo de rezervă
        if (err.message && err.message.includes('Failed to fetch')) {
            console.warn('Backend unavailable, using simulated local authentication for dev preview');
            if (usernameOrEmail === 'demo' || usernameOrEmail === 'demo@accessmap.ro') {
                const mock = {
                    token: 'mock_jwt_token_demo_user',
                    id: 999,
                    username: 'utilizator_demo',
                    email: 'demo@accessmap.ro',
                    fullName: 'Utilizator Demo',
                    role: 'ROLE_USER',
                    provider: 'LOCAL',
                    preferredProfile: 'wheelchair',
                    message: 'Autentificare demonstrativă offline reușită!',
                };
                setStoredAuth(mock.token, mock);
                return mock;
            }
        }
        throw err;
    }
};

/**
 * POST /api/auth/register
 * @param {{ username: string, email: string, password: string, fullName?: string, preferredProfile?: string }} data
 */
export const authRegister = async (data) => {
    try {
        const res = await request('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (res && res.token) {
            setStoredAuth(res.token, res);
        }
        return res;
    } catch (err) {
        if (err.message && err.message.includes('Failed to fetch')) {
            console.warn('Backend unavailable, using simulated registration for dev preview');
            const mock = {
                token: 'mock_jwt_token_new_user',
                id: Date.now(),
                username: data.username,
                email: data.email,
                fullName: data.fullName || data.username,
                role: 'ROLE_USER',
                provider: 'LOCAL',
                preferredProfile: data.preferredProfile || 'wheelchair',
                message: 'Cont demonstrativ creat offline!',
            };
            setStoredAuth(mock.token, mock);
            return mock;
        }
        throw err;
    }
};

/**
 * POST /api/auth/oauth
 * @param {'google' | 'facebook'} provider
 * @param {{ token?: string, email: string, name?: string, providerId?: string, avatarUrl?: string }} payload
 */
export const authOAuth = async (provider, payload) => {
    try {
        const res = await request('/api/auth/oauth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, ...payload }),
        });
        if (res && res.token) {
            setStoredAuth(res.token, res);
        }
        return res;
    } catch (err) {
        if (err.message && err.message.includes('Failed to fetch')) {
            console.warn('Backend unavailable, using simulated OAuth response for dev preview');
            const mock = {
                token: `mock_jwt_${provider}_token`,
                id: Date.now(),
                username: payload.name ? payload.name.toLowerCase().replace(/\s+/g, '_') : 'social_user',
                email: payload.email || `${provider}_user@accessmap.ro`,
                fullName: payload.name || `Utilizator ${provider.toUpperCase()}`,
                avatarUrl: payload.avatarUrl || null,
                role: 'ROLE_USER',
                provider: provider.toUpperCase(),
                preferredProfile: 'wheelchair',
                message: `Autentificare demonstrativă ${provider.toUpperCase()} reușită!`,
            };
            setStoredAuth(mock.token, mock);
            return mock;
        }
        throw err;
    }
};

/**
 * GET /api/auth/me
 */
export const authGetMe = async () => {
    try {
        const user = await request('/api/auth/me');
        if (user) {
            setStoredAuth(getStoredToken(), user);
        }
        return user;
    } catch (err) {
        if (err.status === 401) {
            clearStoredAuth();
        }
        throw err;
    }
};

/**
 * PUT /api/auth/profile
 */
export const authUpdateProfile = async (profileData) => {
    const updated = await request('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
    });
    if (updated) {
        const current = getStoredUser() || {};
        setStoredAuth(getStoredToken(), { ...current, ...updated });
    }
    return updated;
};

// ==================== ROUTING & REPORTS API ====================

// Backend Report { id, latitude, longitude, type, description, upvotes, active, authorId, authorName }
const toObstacle = (r) => ({
    ...r,
    lat: r.latitude ?? r.lat,
    lng: r.longitude ?? r.lng,
    authorName: r.authorName || (r.author_name ? r.author_name : null),
});

/** Haversine distance in meters */
const getDistance = (c1, c2) => {
    const R = 6371e3;
    const p1 = (c1.lat * Math.PI) / 180;
    const p2 = (c2.lat * Math.PI) / 180;
    const dp = ((c2.lat - c1.lat) * Math.PI) / 180;
    const dl = ((c2.lng - c1.lng) * Math.PI) / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const TIMISOARA_LANDMARKS = [
    { displayName: 'Piața Victoriei, Timișoara', lat: 45.7538, lng: 21.2257 },
    { displayName: 'Piața Unirii, Timișoara', lat: 45.7579, lng: 21.2289 },
    { displayName: 'Piața Libertății, Timișoara', lat: 45.7557, lng: 21.2272 },
    { displayName: 'Iulius Town / Mall, Timișoara', lat: 45.7663, lng: 21.2291 },
    { displayName: 'Gara de Nord, Timișoara', lat: 45.7505, lng: 21.2084 },
    { displayName: 'Universitatea Politehnica Timișoara (UPT)', lat: 45.7489, lng: 21.2280 },
    { displayName: 'Spitalul Clinic Județean de Urgență, Timișoara', lat: 45.7408, lng: 21.2415 },
    { displayName: 'Parcul Rozelor, Timișoara', lat: 45.7508, lng: 21.2312 },
    { displayName: 'Catedrala Mitropolitană, Timișoara', lat: 45.7513, lng: 21.2245 },
];

/** Search and autocomplete locations as user types */
export const searchSuggestions = async (query) => {
    if (!query || query.trim().length < 2) return [];
    const trimmed = query.trim();

    // 1. Try backend /api/geocode/suggest
    try {
        const r = await request(`/api/geocode/suggest?q=${encodeURIComponent(trimmed)}&limit=5`);
        if (Array.isArray(r) && r.length > 0) {
            return r
                .filter((item) => item && item.coordinate)
                .map((item) => ({
                    lat: item.coordinate.lat,
                    lng: item.coordinate.lng,
                    displayName: item.displayName || item.query,
                }));
        }
    } catch {
        // Backend offline or error -> fall through to OSM Nominatim
    }

    // 2. Direct client-side OpenStreetMap Nominatim API
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(trimmed)}&limit=5&countrycodes=ro`
        );
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                return data.map((item) => ({
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                    displayName: item.display_name,
                }));
            }
        }
    } catch {
        // Network unavailable -> fall through to local landmarks
    }

    // 3. Fallback to local landmarks
    const qLower = trimmed.toLowerCase();
    return TIMISOARA_LANDMARKS.filter((l) => l.displayName.toLowerCase().includes(qLower));
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
export const geocodeAddress = async (query) => {
    const list = await searchSuggestions(query);
    return list && list.length > 0 ? list[0] : null;
};

/** GET /api/v1/route -> { coordinates: [[lat, lng]], distanceMeters, timeSeconds } */
export const getRoute = async (startCoords, endCoords, profile = 'wheelchair') => {
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