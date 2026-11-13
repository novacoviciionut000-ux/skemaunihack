import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let modelPromise = null;
let offscreenCanvas = null;
let offscreenCtx = null;

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

function getOffscreenContext(width, height) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
  }
  return offscreenCtx;
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

function getZone(centerX, frameWidth) {
  const ratio = centerX / frameWidth;
  if (ratio < 0.35) return 'left';
  if (ratio > 0.65) return 'right';
  return 'center';
}

function estimateDistanceMeters(heightRatio) {
  if (heightRatio <= 0.05) return 8.0;
  const approx = 1.15 / heightRatio;
  return Math.max(0.4, Math.min(8.0, Math.round(approx * 10) / 10));
}

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
 * Captures a downscaled copy of the current video frame for fast pixel-level
 * analysis (traffic light colors & sidewalk surface/curb boundaries).
 */
export function captureFrameSample(video, sampleWidth = 160, sampleHeight = 120) {
  if (!video || video.readyState < 2) return null;
  const ctx = getOffscreenContext(sampleWidth, sampleHeight);
  ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
  return {
    ctx,
    width: sampleWidth,
    height: sampleHeight,
    imageData: ctx.getImageData(0, 0, sampleWidth, sampleHeight),
  };
}

/**
 * Classifies the active color of a detected traffic light by inspecting pixels
 * inside its bounding box on the sampled frame.
 */
function detectTrafficLightState(bbox, frameWidth, frameHeight, frameSample) {
  if (!frameSample) return 'unknown';

  const scaleX = frameSample.width / frameWidth;
  const scaleY = frameSample.height / frameHeight;

  const sx = Math.max(0, Math.floor(bbox[0] * scaleX));
  const sy = Math.max(0, Math.floor(bbox[1] * scaleY));
  const sw = Math.max(2, Math.min(frameSample.width - sx, Math.ceil(bbox[2] * scaleX)));
  const sh = Math.max(2, Math.min(frameSample.height - sy, Math.ceil(bbox[3] * scaleY)));

  const { data, width } = frameSample.imageData;
  let redScore = 0;
  let greenScore = 0;
  let yellowScore = 0;

  for (let py = sy; py < sy + sh; py++) {
    const relY = (py - sy) / sh;
    for (let px = sx; px < sx + sw; px++) {
      const idx = (py * width + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (r > 155 && r > g * 1.45 && r > b * 1.45) {
        redScore += relY < 0.45 ? 1.5 : 1;
      } else if (g > 145 && g > r * 1.2 && b < 210) {
        greenScore += relY > 0.55 ? 1.5 : 1;
      } else if (r > 165 && g > 135 && b < 110 && Math.abs(r - g) < 75) {
        yellowScore += relY >= 0.3 && relY <= 0.7 ? 1.4 : 1;
      }
    }
  }

  const minPixels = Math.max(3, Math.floor((sw * sh) * 0.03));
  if (redScore >= minPixels && redScore > greenScore && redScore > yellowScore) {
    return 'red';
  }
  if (greenScore >= minPixels && greenScore > redScore && greenScore > yellowScore) {
    return 'green';
  }
  if (yellowScore >= minPixels && yellowScore > redScore && yellowScore > greenScore) {
    return 'yellow';
  }
  return 'unknown';
}

/**
 * Analyzes the lower portion of the frame to detect the sidewalk corridor
 * and warn if the user is drifting toward a curb / road edge.
 */
export function analyzeSidewalkPath(frameSample, obstacles = []) {
  if (!frameSample) {
    return {
      status: 'unknown',
      leftEdge: false,
      rightEdge: false,
      messageRo: '',
    };
  }

  const { data, width, height } = frameSample.imageData;
  const yStart = Math.floor(height * 0.62);
  const yEnd = Math.floor(height * 0.94);

  const sampleRegion = (xMinRatio, xMaxRatio) => {
    const xStart = Math.floor(width * xMinRatio);
    const xEnd = Math.floor(width * xMaxRatio);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x < xEnd; x++) {
        const idx = (y * width + x) * 4;
        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count++;
      }
    }

    if (count === 0) return { r: 0, g: 0, b: 0, lum: 0 };
    const r = rSum / count;
    const g = gSum / count;
    const b = bSum / count;
    return { r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b };
  };

  const centerPatch = sampleRegion(0.36, 0.64);
  const leftPatch = sampleRegion(0.06, 0.24);
  const rightPatch = sampleRegion(0.76, 0.94);

  const colorDiff = (a, b) =>
    Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

  const leftDiff = colorDiff(centerPatch, leftPatch);
  const rightDiff = colorDiff(centerPatch, rightPatch);

  // Significant surface contrast (e.g. sidewalk vs asphalt/curb/grass)
  const EDGE_THRESHOLD = 46;
  const leftEdge = leftDiff > EDGE_THRESHOLD;
  const rightEdge = rightDiff > EDGE_THRESHOLD;

  const centerBlocked = obstacles.some(
    (o) =>
      o.class !== 'traffic light' &&
      o.inCenterPath &&
      (o.severity === 'danger' || o.severity === 'approaching')
  );

  let status = 'clear';
  let messageRo = 'Trotuar liber în față';

  if (centerBlocked) {
    status = 'blocked';
    messageRo = 'Obstacol pe trotuar în față';
  } else if (leftEdge && !rightEdge) {
    status = 'edge_left';
    messageRo = 'Margine trotuar în stânga — mergi ușor spre dreapta';
  } else if (rightEdge && !leftEdge) {
    status = 'edge_right';
    messageRo = 'Margine trotuar în dreapta — mergi ușor spre stânga';
  }

  return {
    status,
    leftEdge,
    rightEdge,
    leftDiff: Math.round(leftDiff),
    rightDiff: Math.round(rightDiff),
    messageRo,
  };
}

/**
 * Processes raw COCO-SSD predictions into structured obstacle objects
 * with zone, proximity severity, approach trend, traffic light state,
 * and Romanian alert text.
 */
export function analyzeDetections(
  predictions,
  frameWidth,
  frameHeight,
  prevObstacles = [],
  frameSample = null
) {
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

      let trafficLightState = null;
      if (p.class === 'traffic light') {
        trafficLightState = detectTrafficLightState(
          p.bbox,
          frameWidth,
          frameHeight,
          frameSample
        );
      }

      let messageRo = `${labelRo} ${zoneRo} (~${distanceMeters}m)`;
      if (p.class === 'traffic light') {
        if (trafficLightState === 'red') {
          messageRo = `Semafor ROȘU ${zoneRo} — oprește!`;
          severity = 'danger';
        } else if (trafficLightState === 'green') {
          messageRo = `Semafor VERDE ${zoneRo} — poți traversa`;
          if (severity === 'far') severity = 'approaching';
        } else if (trafficLightState === 'yellow') {
          messageRo = `Semafor GALBEN ${zoneRo} — atenție`;
          if (severity === 'far') severity = 'approaching';
        } else {
          messageRo = `Semafor detectat ${zoneRo}`;
        }
      } else if (severity === 'danger') {
        messageRo = `Pericol! ${labelRo} foarte aproape ${zoneRo} (~${distanceMeters}m)`;
      } else if (severity === 'approaching') {
        messageRo = `Atenție, te apropii de ${labelRo.toLowerCase()} ${zoneRo} (~${distanceMeters}m)`;
      }

      return {
        id: `${p.class}-${index}`,
        class: p.class,
        labelRo,
        trafficLightState,
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

export function emitSidewalkStatusEvent(sidewalkStatus) {
  window.dispatchEvent(
    new CustomEvent('accessmap:sidewalk-status', {
      detail: sidewalkStatus,
    })
  );
}

export function emitTiltWarningEvent(tiltPayload) {
  window.dispatchEvent(
    new CustomEvent('accessmap:tilt-warning', {
      detail: tiltPayload,
    })
  );
}
