/**
 * Pedestrian crossings along a route, taken from OpenStreetMap.
 *
 * The camera can only guess at a crossing from the stripe pattern on the ground, and
 * confuses stairs and paving for it. OpenStreetMap already knows where crossings are,
 * and also whether they are marked and whether they have signals, which is the part a
 * blind user actually needs: at an unsignalled crossing there is no light to wait for
 * and traffic has to be judged by ear.
 *
 * Fetched once per route, never during walking, so a slow or failed request cannot
 * interfere with live guidance. The query runs on our backend, which caches it and keeps
 * Overpass from rate-limiting a group of phones on one network.
 */

import { projectOnRoute, getProgressAlongRoute } from './navigationEngine';

// Generous because this request blocks nothing: crossings arriving a few seconds into
// the walk are still useful, since the announcements are driven by distance travelled.
const REQUEST_TIMEOUT_MS = 25000;
// A crossing further than this from the route line belongs to a different street
const MAX_OFFSET_FROM_ROUTE_M = 25;
// Padding on the route bounding box, in degrees (~110 m), so crossings right at the
// start or end of the route are included
const BBOX_PADDING_DEG = 0.001;
// Several OSM nodes, one per carriageway, describe one physical crossing
const MERGE_WITHIN_M = 8;

function routeBoundingBox(coordinates) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const c of coordinates) {
    const lat = typeof c.lat === 'number' ? c.lat : c[0];
    const lng = typeof c.lng === 'number' ? c.lng : c[1];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return {
    south: minLat - BBOX_PADDING_DEG,
    west: minLng - BBOX_PADDING_DEG,
    north: maxLat + BBOX_PADDING_DEG,
    east: maxLng + BBOX_PADDING_DEG,
  };
}

/**
 * Describes a crossing in Romanian, leading with the detail that changes what the user
 * has to do: whether there is a signal to obey. When the tags do not say, no claim is made.
 */
function labelFor(kind) {
  if (kind === 'signals') return 'trecere de pietoni cu semafor';
  if (kind === 'none') return 'trecere de pietoni fără semafor';
  return 'trecere de pietoni';
}

/**
 * Finds the pedestrian crossings that lie on the given route.
 * Returns them ordered by distance from the route start, each with `distanceAlong` in
 * meters, or an empty array if the lookup failed.
 */
export async function fetchCrossingsAlongRoute(coordinates) {
  if (!coordinates || coordinates.length < 2) return [];

  const box = routeBoundingBox(coordinates);
  const params = new URLSearchParams({
    south: String(box.south),
    west: String(box.west),
    north: String(box.north),
    east: String(box.east),
  });

  let elements;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/crossings?${params}`, { signal: controller.signal });
    if (!res.ok) return [];
    elements = await res.json();
  } catch {
    return []; // the camera heuristic remains as the fallback
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(elements)) return [];

  const crossings = [];
  for (const el of elements) {
    if (typeof el?.lat !== 'number' || typeof el?.lng !== 'number') continue;

    // Search the whole route for each crossing: they arrive in no particular order
    const projection = projectOnRoute({ lat: el.lat, lng: el.lng }, coordinates, 0);
    if (projection.distanceOffRoute > MAX_OFFSET_FROM_ROUTE_M) continue;

    crossings.push({
      id: el.id,
      lat: el.lat,
      lng: el.lng,
      hasSignals: Boolean(el.hasSignals),
      hasMarkings: Boolean(el.hasMarkings),
      hasTactilePaving: Boolean(el.hasTactilePaving),
      kind: el.kind || 'unknown',
      labelRo: labelFor(el.kind),
      distanceAlong: Math.round(getProgressAlongRoute(projection, coordinates)),
      offRoute: Math.round(projection.distanceOffRoute),
    });
  }

  crossings.sort((a, b) => a.distanceAlong - b.distanceAlong);

  // Collapse the per-carriageway nodes so the user is told once, not three times
  const merged = [];
  for (const c of crossings) {
    const last = merged[merged.length - 1];
    if (last && c.distanceAlong - last.distanceAlong <= MERGE_WITHIN_M) {
      // Keep the more specific description of the two
      if (last.kind === 'unknown' && c.kind !== 'unknown') {
        merged[merged.length - 1] = { ...c, distanceAlong: last.distanceAlong };
      }
      continue;
    }
    merged.push(c);
  }

  return merged;
}
