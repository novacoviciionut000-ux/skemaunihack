// Real API client. Vite proxies /api -> http://localhost:8080 (see vite.config.js).
// Backend responses are adapted to the shapes the components already expect.

const request = async (url, options) => {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
};

// Backend Report { id, latitude, longitude, type, description, upvotes, active }
const toObstacle = (r) => ({ ...r, lat: r.latitude, lng: r.longitude });

/** GET /api/geocode?q=... -> [{ lat, lon, display_name }] */
export const geocodeQuery = async (query) => {
    const r = await request(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!r || !r.coordinate) return [];
    return [{ lat: r.coordinate.lat, lon: r.coordinate.lng, display_name: r.displayName }];
};

/** GET /api/v1/route -> { coordinates: [[lat, lng]], distanceMeters, timeSeconds } */
export const getRoute = async (startCoords, endCoords, profile) => {
    const params = new URLSearchParams({
        startLat: startCoords.lat,
        startLng: startCoords.lng,
        endLat: endCoords.lat,
        endLng: endCoords.lng,
        profile,
    });
    const r = await request(`/api/v1/route?${params}`);
    return {
        coordinates: (r.path || []).map((p) => [p.lat, p.lng]),
        distanceMeters: r.distanceMeters,
        timeSeconds: r.timeSeconds,
    };
};

/** GET /api/reports */
export const getReports = async () => {
    const reports = await request('/api/reports');
    return (reports || []).map(toObstacle);
};

/** POST /api/reports */
export const submitReport = async (lat, lng, type, description = '') => {
    const saved = await request('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng, type, description }),
    });
    return toObstacle(saved);
};

/** POST /api/reports/{id}/upvote */
export const upvoteReport = (id) =>
    request(`/api/reports/${id}/upvote`, { method: 'POST' });