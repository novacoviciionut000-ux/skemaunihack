// API client for AccessMap
// Connects to Spring Boot backend via Vite proxy (/api), with graceful fallbacks
// so the UI remains interactive even while GraphHopper or the backend is warming up.

const request = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
};

// Backend Report { id, latitude, longitude, type, description, upvotes, active }
const toObstacle = (r) => ({ ...r, lat: r.latitude ?? r.lat, lng: r.longitude ?? r.lng });

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
    // Acesta urmează STRICT trotuarele, aleile pietonale, trecerile de pietoni și străzile reale.
    // Nu o ia NICIODATĂ prin clădiri sau proprietăți private!
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
                    // OSRM returnează coordonate GeoJSON [lng, lat] -> le convertim în [lat, lng] pentru Leaflet
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
    { id: 101, lat: 45.7550, lng: 21.2290, type: 'BLOCKED_SIDEWALK', description: 'Construction works on sidewalk' },
    { id: 102, lat: 45.7512, lng: 21.2240, type: 'STAIRS_NO_RAMP', description: 'Underpass stairs without ramp' },
    { id: 103, lat: 45.7455, lng: 21.2180, type: 'BROKEN_ELEVATOR', description: 'Elevator out of service' },
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
export const submitReport = async (lat, lng, type, description = '') => {
    try {
        const saved = await request('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, type, description }),
        });
        if (saved) return toObstacle(saved);
    } catch (err) {
        console.warn('Could not save to backend DB, saving locally:', err);
    }
    return toObstacle({ id: Date.now(), latitude: lat, longitude: lng, type, description });
};

/** POST /api/reports/{id}/upvote */
export const upvoteReport = async (id) => {
    try {
        return await request(`/api/reports/${id}/upvote`, { method: 'POST' });
    } catch {
        return null;
    }
};
