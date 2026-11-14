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

function getZone(centerX, frameWidth, prevZone = null) {
  const ratio = centerX / frameWidth;
  if (prevZone === 'left') {
    if (ratio < 0.39) return 'left';
  } else if (prevZone === 'right') {
    if (ratio > 0.61) return 'right';
  } else if (prevZone === 'center') {
    if (ratio >= 0.31 && ratio <= 0.69) return 'center';
  }
  if (ratio < 0.35) return 'left';
  if (ratio > 0.65) return 'right';
  return 'center';
}

function estimateDistanceMeters(heightRatio) {
  if (heightRatio <= 0.05) return 8.0;
  const approx = 1.15 / heightRatio;
  const clamped = Math.max(0.4, Math.min(8.0, approx));
  // Quantize gently (0.2m under 2m, 0.5m above 2m) so voice/UI readings stay calm
  return clamped < 2.0
    ? Math.round(clamped * 5) / 5
    : Math.round(clamped * 2) / 2;
}

function ema(prevVal, nextVal, alpha) {
  if (prevVal == null || Number.isNaN(prevVal)) return nextVal;
  return prevVal * (1 - alpha) + nextVal * alpha;
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
    if (dist < bestDist && dist < 150) {
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
 * Uses shadow-invariant chromaticity, curb gradient energy, texture contrast,
 * obstacle boundary cues, and temporal EMA + hysteresis.
 */
export function analyzeSidewalkPath(frameSample, obstacles = [], prevState = null) {
  if (!frameSample) {
    return {
      status: 'unknown',
      leftEdge: false,
      rightEdge: false,
      leftScore: 0,
      rightScore: 0,
      candidateStatus: 'unknown',
      candidateFrames: 0,
      messageRo: '',
    };
  }

  const { data, width, height } = frameSample.imageData;
  const yStart = Math.floor(height * 0.58);
  const yEnd = Math.floor(height * 0.94);

  const sampleRegion = (xMinRatio, xMaxRatio) => {
    const xStart = Math.floor(width * xMinRatio);
    const xEnd = Math.floor(width * xMaxRatio);
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let textureSum = 0;
    let count = 0;

    for (let y = yStart; y < yEnd; y++) {
      let prevLum = -1;
      for (let x = xStart; x < xEnd; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        rSum += r;
        gSum += g;
        bSum += b;
        if (prevLum >= 0) {
          textureSum += Math.abs(lum - prevLum);
        }
        prevLum = lum;
        count++;
      }
    }

    if (count === 0) {
      return { r: 0, g: 0, b: 0, lum: 0, cr: 0.33, cg: 0.33, cb: 0.33, texture: 0 };
    }
    const r = rSum / count;
    const g = gSum / count;
    const b = bSum / count;
    const rgbSum = r + g + b + 1;
    return {
      r,
      g,
      b,
      lum: 0.299 * r + 0.587 * g + 0.114 * b,
      cr: r / rgbSum,
      cg: g / rgbSum,
      cb: b / rgbSum,
      texture: textureSum / count,
    };
  };

  // Measure horizontal curb/edge gradient energy across a boundary strip
  const measureBoundaryGradient = (xCenterRatio, halfBandRatio = 0.05) => {
    const xStart = Math.max(1, Math.floor(width * (xCenterRatio - halfBandRatio)));
    const xEnd = Math.min(width - 2, Math.floor(width * (xCenterRatio + halfBandRatio)));
    let gradSum = 0;
    let count = 0;

    for (let y = yStart; y < yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const idxL = (y * width + (x - 1)) * 4;
        const idxR = (y * width + (x + 1)) * 4;
        const lumL = 0.299 * data[idxL] + 0.587 * data[idxL + 1] + 0.114 * data[idxL + 2];
        const lumR = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2];
        gradSum += Math.abs(lumR - lumL);
        count++;
      }
    }
    return count > 0 ? gradSum / count : 0;
  };

  const centerPatch = sampleRegion(0.35, 0.65);
  const leftPatch = sampleRegion(0.05, 0.24);
  const rightPatch = sampleRegion(0.76, 0.95);

  const leftBoundaryGrad = measureBoundaryGradient(0.28);
  const rightBoundaryGrad = measureBoundaryGradient(0.72);

  const computeEdgeScore = (sidePatch, boundaryGrad, sideZone) => {
    // Shadow-invariant chromaticity distance (0..~0.5 -> scaled)
    const chromaDiff =
      Math.hypot(
        centerPatch.cr - sidePatch.cr,
        centerPatch.cg - sidePatch.cg,
        centerPatch.cb - sidePatch.cb
      ) * 260;

    // Moderated luminance difference (shadows alone shouldn't trigger)
    const lumDiff = Math.abs(centerPatch.lum - sidePatch.lum) * 0.28;

    // Texture contrast (e.g., pavers vs smooth asphalt/grass)
    const textureDiff = Math.abs(centerPatch.texture - sidePatch.texture) * 2.2;

    // Curb/edge line energy along the corridor boundary
    const gradScore = Math.max(0, boundaryGrad - 5) * 1.4;

    // Nearby roadside obstacles (cars, benches, bikes) reinforce sidewalk edge
    const hasBoundaryObstacle = obstacles.some(
      (o) =>
        o.zone === sideZone &&
        o.distanceMeters <= 4.5 &&
        ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'bench', 'potted plant'].includes(o.class)
    );
    const obstacleBoost = hasBoundaryObstacle ? 16 : 0;

    return Math.min(100, chromaDiff + lumDiff + textureDiff + gradScore + obstacleBoost);
  };

  const rawLeftScore = computeEdgeScore(leftPatch, leftBoundaryGrad, 'left');
  const rawRightScore = computeEdgeScore(rightPatch, rightBoundaryGrad, 'right');

  const leftScore = ema(prevState?.leftScore, rawLeftScore, 0.32);
  const rightScore = ema(prevState?.rightScore, rawRightScore, 0.32);

  // Hysteresis thresholds for edge detection
  const ENTER_EDGE = 48;
  const EXIT_EDGE = 36;
  const prevLeftEdge = Boolean(prevState?.leftEdge);
  const prevRightEdge = Boolean(prevState?.rightEdge);

  const leftEdge = prevLeftEdge ? leftScore >= EXIT_EDGE : leftScore >= ENTER_EDGE;
  const rightEdge = prevRightEdge ? rightScore >= EXIT_EDGE : rightScore >= ENTER_EDGE;

  const centerBlocked = obstacles.some(
    (o) =>
      o.isConfirmed !== false &&
      o.class !== 'traffic light' &&
      o.inCenterPath &&
      (o.severity === 'danger' || o.severity === 'approaching')
  );

  let rawStatus = 'clear';
  if (centerBlocked) {
    rawStatus = 'blocked';
  } else if (leftEdge && (!rightEdge || leftScore > rightScore + 8)) {
    rawStatus = 'edge_left';
  } else if (rightEdge && (!leftEdge || rightScore > leftScore + 8)) {
    rawStatus = 'edge_right';
  }

  // Require 2 consecutive frames to switch status (except immediate 'blocked' danger)
  let status = prevState?.status && prevState.status !== 'unknown' ? prevState.status : rawStatus;
  let candidateStatus = rawStatus;
  let candidateFrames = 1;

  if (rawStatus === 'blocked') {
    status = 'blocked';
    candidateFrames = 2;
  } else if (prevState && rawStatus === prevState.candidateStatus) {
    candidateFrames = (prevState.candidateFrames || 1) + 1;
    if (candidateFrames >= 2) {
      status = rawStatus;
    }
  } else if (!prevState) {
    status = rawStatus;
  }

  // Group detected obstacles by zone to ensure steering corrections do not cause collisions
  const leftObstacles = obstacles.filter(
    (o) => o.isConfirmed !== false && o.zone === 'left' && o.distanceMeters <= 3.8
  );
  const centerObstacles = obstacles.filter(
    (o) => o.isConfirmed !== false && o.zone === 'center' && o.distanceMeters <= 4.0
  );
  const rightObstacles = obstacles.filter(
    (o) => o.isConfirmed !== false && o.zone === 'right' && o.distanceMeters <= 3.8
  );

  const hasCloseCenterObstacle = centerObstacles.some((o) => o.distanceMeters <= 2.5);
  const hasCloseLeftObstacle = leftObstacles.some((o) => o.distanceMeters <= 2.2);
  const hasCloseRightObstacle = rightObstacles.some((o) => o.distanceMeters <= 2.2);

  let action = 'straight';
  let safeZone = 'center';
  let correctionRo = 'Traiectorie sigură pe trotuar — continuă înainte.';
  let messageRo = 'Trotuar liber în față';

  if (status === 'edge_left') {
    messageRo = 'Deviere spre marginea stângă a trotuarului';
    if (hasCloseRightObstacle) {
      if (!hasCloseCenterObstacle) {
        action = 'steer_center';
        safeZone = 'center';
        const obsName = (rightObstacles[0]?.labelRo || 'obstacol').toLowerCase();
        correctionRo = `Atenție: margine în stânga! Rămâi pe centru — ai ${obsName} în dreapta.`;
      } else {
        action = 'stop';
        safeZone = 'none';
        correctionRo = 'Oprește-te! Bordură în stânga și obstacol în față pe trotuar.';
      }
    } else {
      action = 'steer_right';
      safeZone = 'right';
      correctionRo = 'Te abați spre marginea din stânga! Fă 2 pași spre dreapta pentru a rămâne pe trotuar.';
    }
  } else if (status === 'edge_right') {
    messageRo = 'Deviere spre marginea dreaptă a trotuarului';
    if (hasCloseLeftObstacle) {
      if (!hasCloseCenterObstacle) {
        action = 'steer_center';
        safeZone = 'center';
        const obsName = (leftObstacles[0]?.labelRo || 'obstacol').toLowerCase();
        correctionRo = `Atenție: margine în dreapta! Rămâi pe centru — ai ${obsName} în stânga.`;
      } else {
        action = 'stop';
        safeZone = 'none';
        correctionRo = 'Oprește-te! Bordură în dreapta și obstacol în față pe trotuar.';
      }
    } else {
      action = 'steer_left';
      safeZone = 'left';
      correctionRo = 'Te abați spre marginea din dreapta! Fă 2 pași spre stânga pentru a rămâne pe trotuar.';
    }
  } else if (status === 'blocked' || hasCloseCenterObstacle) {
    const obsName = (centerObstacles[0]?.labelRo || 'obstacol').toLowerCase();
    messageRo = `Obstacol pe trotuar în față: ${obsName}`;
    if (!leftEdge && !hasCloseLeftObstacle) {
      action = 'bypass_left';
      safeZone = 'left';
      correctionRo = `Atenție, ${obsName} în față! Ocolește ușor prin stânga, trotuarul continuă liber.`;
    } else if (!rightEdge && !hasCloseRightObstacle) {
      action = 'bypass_right';
      safeZone = 'right';
      correctionRo = `Atenție, ${obsName} în față! Ocolește ușor prin dreapta, trotuarul continuă liber.`;
    } else {
      action = 'stop';
      safeZone = 'none';
      correctionRo = `Oprește-te! ${obsName.toUpperCase()} în față și trotuar îngust fără trecere sigură.`;
    }
  }

  return {
    status,
    action,
    safeZone,
    correctionRo,
    messageRo,
    leftEdge,
    rightEdge,
    leftScore: Math.round(leftScore),
    rightScore: Math.round(rightScore),
    candidateStatus,
    candidateFrames,
  };
}

const HAZARDOUS_OBSTACLE_CLASSES = new Set([
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'bus',
  'truck',
  'traffic light',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'bench',
  'chair',
  'couch',
  'dining table',
  'potted plant',
  'suitcase',
  'dog',
]);

/**
 * Processes raw COCO-SSD predictions into temporally smoothed, tracked obstacle
 * objects with zone hysteresis, proximity severity, approach trend, traffic light
 * state, and Romanian alert text ready for UI and voice synthesis.
 *
 * Implements intelligent threat filtering: filters out background clutter,
 * distant static objects, and objects moving away — highlighting ONLY objects
 * you are actively approaching and that pose a collision hazard in your path.
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
  const matchedPrevIds = new Set();

  const currentObstacles = predictions
    .filter((p) => {
      // 1. Initial confidence filter
      if (p.score < 0.46) return false;

      // 2. Filter out non-hazard trivial items unless very large in foreground
      const isKnownHazard = HAZARDOUS_OBSTACLE_CLASSES.has(p.class);
      if (!isKnownHazard) {
        const heightRatio = p.bbox[3] / frameHeight;
        if (heightRatio < 0.35) return false;
      }
      return true;
    })
    .map((p, index) => {
      const [rawX, rawY, rawW, rawH] = p.bbox;
      const rawCenterX = rawX + rawW / 2;
      const rawCenterY = rawY + rawH / 2;

      const prev = findPreviousMatch(
        { class: p.class, centerX: rawCenterX, centerY: rawCenterY },
        prevObstacles
      );
      if (prev) {
        matchedPrevIds.add(prev.id);
      }

      // Smooth bounding box with EMA so boxes and distance don't jump abruptly
      const alpha = prev ? 0.38 : 1;
      const x = prev ? ema(prev.bbox[0], rawX, alpha) : rawX;
      const y = prev ? ema(prev.bbox[1], rawY, alpha) : rawY;
      const width = prev ? ema(prev.bbox[2], rawW, alpha) : rawW;
      const height = prev ? ema(prev.bbox[3], rawH, alpha) : rawH;

      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const area = width * height;
      const areaRatio = area / frameArea;
      const heightRatio = height / frameHeight;
      const zone = getZone(centerX, frameWidth, prev?.zone || null);
      const inCenterPath =
        x + width > frameWidth * 0.28 && x < frameWidth * 0.72;

      const areaGrowthRate =
        prev && prev.area > 0 ? (area - prev.area) / prev.area : 0;

      const labelRo = OBSTACLE_LABELS_RO[p.class] || p.class;
      const rawDistance = estimateDistanceMeters(heightRatio);
      const smoothedDistance = prev
        ? ema(prev.rawDistance ?? prev.distanceMeters, rawDistance, 0.3)
        : rawDistance;
      const distanceMeters =
        smoothedDistance < 2.0
          ? Math.round(smoothedDistance * 5) / 5
          : Math.round(smoothedDistance * 2) / 2;
      const zoneRo = ZONE_LABELS_RO[zone];

      // ─── Dynamic Approach & Threat Assessment ─────────────────────────────
      // Track whether the user is approaching the obstacle (or obstacle is approaching user)
      const prevDist = prev ? (prev.rawDistance ?? prev.distanceMeters) : null;
      const distDelta = prevDist != null ? prevDist - smoothedDistance : 0; // > 0 means getting closer
      const isDistanceClosing = distDelta > 0.05; // >= 5cm closing
      const isDistanceOpening = distDelta < -0.12; // moving away
      const isGrowingArea = areaGrowthRate > 0.04;
      const isShrinkingArea = areaGrowthRate < -0.06;

      // An object is "approaching" if distance is closing, area is expanding, or within collision range
      const isApproaching =
        isDistanceClosing ||
        isGrowingArea ||
        (smoothedDistance <= 2.2 && !isDistanceOpening);

      // An object is receding if distance is increasing AND area is shrinking
      const isReceding = isDistanceOpening && isShrinkingArea;

      // Check lateral movement towards user's central walking trajectory
      const isCentering = prev
        ? Math.abs(centerX - frameWidth / 2) < Math.abs(prev.centerX - frameWidth / 2) - 8
        : false;

      let trafficLightState = null;
      let trafficLightHold = 0;
      if (p.class === 'traffic light') {
        const detectedColor = detectTrafficLightState(
          [x, y, width, height],
          frameWidth,
          frameHeight,
          frameSample
        );
        if (detectedColor !== 'unknown') {
          trafficLightState = detectedColor;
          trafficLightHold = 2;
        } else if (prev?.trafficLightState && (prev.trafficLightHold || 0) > 0) {
          trafficLightState = prev.trafficLightState;
          trafficLightHold = prev.trafficLightHold - 1;
        } else {
          trafficLightState = 'unknown';
        }
      }

      // Evaluate Pericol / Threat flag: ONLY take objects that pose a real danger
      // and that the user is approaching or in direct collision path.
      let isThreat = false;
      let threatReason = '';
      let severity = 'far';

      if (p.class === 'traffic light') {
        if (trafficLightState === 'red') {
          isThreat = true;
          threatReason = 'Semafor roșu';
          severity = 'danger';
        } else if (trafficLightState === 'yellow') {
          isThreat = true;
          threatReason = 'Semafor galben';
          severity = 'approaching';
        } else if (trafficLightState === 'green') {
          // Green light is safe to pass, not a hazard
          isThreat = false;
          severity = 'far';
        }
      } else if (HAZARDOUS_OBSTACLE_CLASSES.has(p.class)) {
        if (inCenterPath) {
          if (smoothedDistance <= 2.2) {
            // Immediate collision hazard in forward path
            isThreat = true;
            threatReason = isApproaching ? 'Te apropii rapid' : 'În calea ta';
            severity = 'danger';
          } else if (smoothedDistance <= 5.2 && isApproaching && !isReceding) {
            // Approaching obstacle in forward path
            isThreat = true;
            threatReason = 'Te apropii';
            severity = smoothedDistance <= 3.2 ? 'danger' : 'approaching';
          }
        } else {
          // In side corridors (left / right):
          if (smoothedDistance <= 1.6 && isApproaching && !isReceding) {
            // Close lateral obstacle user might clip with shoulder or wheel
            isThreat = true;
            threatReason = 'Obstacol lateral apropiat';
            severity = 'approaching';
          } else if (isCentering && isApproaching && smoothedDistance <= 4.0) {
            // Crossing into user's path (e.g. crossing pedestrian, bike, car)
            isThreat = true;
            threatReason = 'Se îndreaptă spre calea ta';
            severity = 'approaching';
          }
        }
      } else if (inCenterPath && smoothedDistance <= 1.5 && isApproaching) {
        // Ground tripping hazard right in front of feet
        isThreat = true;
        threatReason = 'Obstacol la sol în cale';
        severity = 'approaching';
      }

      // Alert message in Romanian
      let messageRo = `${labelRo} ${zoneRo} (~${distanceMeters}m)`;
      if (p.class === 'traffic light') {
        if (trafficLightState === 'red') {
          messageRo = `Semafor ROȘU ${zoneRo} — oprește!`;
        } else if (trafficLightState === 'yellow') {
          messageRo = `Semafor GALBEN ${zoneRo} — atenție`;
        } else if (trafficLightState === 'green') {
          messageRo = `Semafor VERDE ${zoneRo} — poți traversa`;
        }
      } else if (severity === 'danger') {
        messageRo = `Pericol! ${labelRo} foarte aproape ${zoneRo} (~${distanceMeters}m) — ${threatReason || 'atenție'}`;
      } else if (severity === 'approaching') {
        messageRo = `Atenție, ${threatReason.toLowerCase() || 'te apropii de'} ${labelRo.toLowerCase()} ${zoneRo} (~${distanceMeters}m)`;
      }

      const framesSeen = (prev?.framesSeen || 0) + 1;

      return {
        id: prev?.id || `${p.class}-${Date.now()}-${index}`,
        class: p.class,
        labelRo,
        trafficLightState,
        trafficLightHold,
        score: p.score,
        bbox: [x, y, width, height],
        centerX,
        centerY,
        area,
        areaRatio,
        heightRatio,
        areaGrowthRate,
        isGrowing: isGrowingArea,
        isApproaching,
        isReceding,
        isThreat,
        threatReason,
        zone,
        zoneRo,
        inCenterPath,
        severity,
        rawDistance: smoothedDistance,
        distanceMeters,
        framesSeen,
        missedFrames: 0,
        isConfirmed: framesSeen >= 2,
        messageRo,
      };
    });

  // Keep recently confirmed obstacles for up to 2 missed frames to avoid single-frame dropouts
  const coasted = prevObstacles
    .filter(
      (prev) =>
        !matchedPrevIds.has(prev.id) &&
        prev.isConfirmed &&
        (prev.missedFrames || 0) < 2
    )
    .map((prev) => ({
      ...prev,
      missedFrames: (prev.missedFrames || 0) + 1,
    }));

  return [...currentObstacles, ...coasted].sort((a, b) => {
    // Sort threats first, then by severity and size
    if (b.isThreat !== a.isThreat) return b.isThreat ? 1 : -1;
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
