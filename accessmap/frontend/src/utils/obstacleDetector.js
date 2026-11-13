import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let modelPromise = null;

/**
 * Loads and caches the COCO-SSD model once for the browser session.
 * Uses lite_mobilenet_v2 for fast real-time inference on mobile and desktop.
 */
export async function loadObstacleModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.ready();
      return cocoSsd.load({ base: 'lite_mobilenet_v2' });
    })();
  }
  return modelPromise;
}

const OBSTACLE_LABELS_RO = {
  person: 'Persoană',
  bicycle: 'Bicicletă',
  car: 'Mașină',
  motorcycle: 'Motocicletă',
  bus: 'Autobuz',
  truck: 'Camion',
  'traffic light': 'Semafor',
  'fire hydrant': 'Hidrant',
  'stop sign': 'Indicator stop',
  'parking meter': 'Parcometru',
  bench: 'Bancă',
  dog: 'Câine',
  cat: 'Pisică',
  backpack: 'Rucsac',
  umbrella: 'Umbrelă',
  handbag: 'Geantă',
  suitcase: 'Valiză',
  chair: 'Scaun',
  couch: 'Canapea',
  'potted plant': 'Ghiveci',
  'dining table': 'Masă',
  tv: 'Ecran',
  laptop: 'Laptop',
  bottle: 'Sticlă',
  cup: 'Pahar',
  door: 'Ușă',
};

const ZONE_LABELS_RO = {
  left: 'în stânga',
  center: 'în față',
  right: 'în dreapta',
};

/**
 * Determines horizontal zone relative to the user's walking path.
 */
function getZone(centerX, frameWidth) {
  const ratio = centerX / frameWidth;
  if (ratio < 0.35) return 'left';
  if (ratio > 0.65) return 'right';
  return 'center';
}

/**
 * Rough heuristic distance in meters based on bounding-box height ratio.
 * Intended as an approximate proximity cue, not a calibrated LiDAR measurement.
 */
function estimateDistanceMeters(heightRatio) {
  if (heightRatio <= 0.05) return 8.0;
  const approx = 1.15 / heightRatio;
  return Math.max(0.4, Math.min(8.0, Math.round(approx * 10) / 10));
}

/**
 * Matches current detections against previous frame detections to detect
 * whether an obstacle is growing in size (approaching the user).
 */
function findPreviousMatch(det, prevObstacles) {
  if (!prevObstacles || prevObstacles.length === 0) return null;
  let best = null;
  let bestDist = Infinity;

  for (const prev of prevObstacles) {
    if (prev.class !== det.class) continue;
    const dx = det.centerX - prev.centerX;
    const dy = det.centerY - prev.centerY;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist && dist < 140) {
      bestDist = dist;
      best = prev;
    }
  }
  return best;
}

/**
 * Processes raw COCO-SSD predictions into structured obstacle objects
 * with zone, proximity severity, approach trend, and Romanian alert text.
 */
export function analyzeDetections(predictions, frameWidth, frameHeight, prevObstacles = []) {
  if (!frameWidth || !frameHeight) return [];

  const frameArea = frameWidth * frameHeight;

  return predictions
    .filter((p) => p.score >= 0.45)
    .map((p, index) => {
      const [x, y, width, height] = p.bbox;
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const area = width * height;
      const areaRatio = area / frameArea;
      const heightRatio = height / frameHeight;
      const zone = getZone(centerX, frameWidth);
      const inCenterPath =
        x + width > frameWidth * 0.28 && x < frameWidth * 0.72;

      const prev = findPreviousMatch({ class: p.class, centerX, centerY }, prevObstacles);
      const areaGrowthRate = prev && prev.area > 0 ? (area - prev.area) / prev.area : 0;
      const isGrowing = areaGrowthRate > 0.06;

      let severity = 'far';
      if (
        heightRatio >= 0.55 ||
        areaRatio >= 0.24 ||
        (inCenterPath && (heightRatio >= 0.42 || areaRatio >= 0.16))
      ) {
        severity = 'danger';
      } else if (
        heightRatio >= 0.28 ||
        areaRatio >= 0.09 ||
        (inCenterPath && heightRatio >= 0.22) ||
        (isGrowing && heightRatio >= 0.16)
      ) {
        severity = 'approaching';
      }

      const labelRo = OBSTACLE_LABELS_RO[p.class] || p.class;
      const distanceMeters = estimateDistanceMeters(heightRatio);
      const zoneRo = ZONE_LABELS_RO[zone];

      let messageRo = `${labelRo} ${zoneRo} (~${distanceMeters}m)`;
      if (severity === 'danger') {
        messageRo = `Pericol! ${labelRo} foarte aproape ${zoneRo} (~${distanceMeters}m)`;
      } else if (severity === 'approaching') {
        messageRo = `Atenție, te apropii de ${labelRo.toLowerCase()} ${zoneRo} (~${distanceMeters}m)`;
      }

      return {
        id: `${p.class}-${index}`,
        class: p.class,
        labelRo,
        score: p.score,
        bbox: [x, y, width, height],
        centerX,
        centerY,
        area,
        areaRatio,
        heightRatio,
        areaGrowthRate,
        isGrowing,
        zone,
        zoneRo,
        inCenterPath,
        severity,
        distanceMeters,
        messageRo,
      };
    })
    .sort((a, b) => {
      const rank = { danger: 3, approaching: 2, far: 1 };
      if (rank[b.severity] !== rank[a.severity]) {
        return rank[b.severity] - rank[a.severity];
      }
      return b.areaRatio - a.areaRatio;
    });
}

/**
 * Dispatches a standardized browser CustomEvent for the voice-alert module
 * implemented by another team member.
 */
export function emitObstacleAlertEvent(alertPayload) {
  window.dispatchEvent(
    new CustomEvent('accessmap:obstacle-alert', {
      detail: alertPayload,
    })
  );
}

export function emitObstaclesClearEvent() {
  window.dispatchEvent(
    new CustomEvent('accessmap:obstacles-clear', {
      detail: { timestamp: Date.now() },
    })
  );
}
