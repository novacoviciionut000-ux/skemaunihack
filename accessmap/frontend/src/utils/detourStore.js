const DETOURS_STORAGE_KEY = 'accessmap_saved_detours';

/**
 * Computes Haversine distance in meters between two { lat, lng } points.
 */
export function distanceMetersBetween(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return Infinity;
  }
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function loadSavedDetours() {
  try {
    const raw = localStorage.getItem(DETOURS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Saves a recorded detour path around an obstacle so subsequent users
 * encountering the same obstacle receive the pre-recorded bypass route.
 */
export function saveDetour(detour) {
  const existing = loadSavedDetours();
  const newRecord = {
    id: detour.id || `detour-${Date.now()}`,
    obstacleCoords: detour.obstacleCoords,
    obstacleClass: detour.obstacleClass || 'obstacle',
    labelRo: detour.labelRo || 'Obstacol',
    detourPath: detour.detourPath || [],
    createdAt: detour.createdAt || Date.now(),
    usesCount: detour.usesCount || 1,
  };

  // Replace if another detour exists within 10m of the same obstacle
  const filtered = existing.filter(
    (item) => distanceMetersBetween(item.obstacleCoords, newRecord.obstacleCoords) > 10
  );
  const updated = [newRecord, ...filtered].slice(0, 50);

  try {
    localStorage.setItem(DETOURS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Could not persist detour in localStorage:', e);
  }
  return updated;
}

/**
 * Finds the nearest saved detour whose obstacle is within maxDistanceMeters
 * of the user's current GPS position.
 */
export function findNearbyDetour(userCoords, detours, maxDistanceMeters = 30) {
  if (!userCoords || !detours || detours.length === 0) return null;

  let closest = null;
  let minDistance = Infinity;

  for (const detour of detours) {
    const dist = distanceMetersBetween(userCoords, detour.obstacleCoords);
    if (dist <= maxDistanceMeters && dist < minDistance) {
      minDistance = dist;
      closest = {
        detour,
        distanceMeters: Math.round(dist),
      };
    }
  }

  return closest;
}

export function emitDetourAvailableEvent(payload) {
  window.dispatchEvent(
    new CustomEvent('accessmap:detour-available', {
      detail: payload,
    })
  );
}
