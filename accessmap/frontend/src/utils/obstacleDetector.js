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

// Continuous (unrounded) estimate. Rounding here would create 0.2-0.5 m steps
// that look like movement when a bounding box merely jitters across a boundary.
function estimateDistanceMeters(heightRatio) {
  if (heightRatio <= 0.05) return 8.0;
  return Math.max(0.4, Math.min(8.0, 1.15 / heightRatio));
}

// Quantize for voice/UI only (0.2 m under 2 m, 0.5 m above).
function formatDistance(meters) {
  return meters < 2.0 ? Math.round(meters * 5) / 5 : Math.round(meters * 2) / 2;
}

// Approach tracking: speeds are measured over a window of at least this long,
// so frame-to-frame bounding box noise cannot register as movement.
const TREND_WINDOW_MS = 700;

// Pedestrian-signal filter. COCO-SSD only knows "traffic light", so we tell the two
// kinds apart by shape and size. Car signals have 3 stacked lamps (tall box, h/w >= ~2.3);
// pedestrian signals are squarer (2 lamps / one panel, h/w ~ 0.8-2.0).
const PED_LIGHT_MAX_ASPECT = 2.0; // h/w above this = car signal, ignored
const PED_LIGHT_MIN_ASPECT = 0.6; // h/w below this = not a signal head (noise)
const PED_LIGHT_MIN_HEIGHT_RATIO = 0.045; // smaller than this = too far to matter (~6 m)
const PED_LIGHT_MIN_SCORE = 0.4;
// Only lights roughly ahead are the ones the user is about to cross at
const PED_LIGHT_CENTER_MIN = 0.2;
const PED_LIGHT_CENTER_MAX = 0.8;
const APPROACH_SPEED_MPS = 0.4; // closing faster than this counts as approaching
const FAST_APPROACH_SPEED_MPS = 1.2; // "rapid" approach
const RECEDE_SPEED_MPS = -0.3;
const CENTERING_SHIFT_RATIO = 0.05; // lateral shift toward center, fraction of frame width

function ema(prevVal, nextVal, alpha) {
  if (prevVal == null || Number.isNaN(prevVal)) return nextVal;
  return prevVal * (1 - alpha) + nextVal * alpha;
}

function findPreviousMatch(det, prevObstacles, claimedIds, maxDist) {
  if (!prevObstacles || prevObstacles.length === 0) return null;
  let best = null;
  let bestDist = Infinity;

  for (const prev of prevObstacles) {
    if (prev.class !== det.class || claimedIds.has(prev.id)) continue;
    const dist = Math.hypot(det.centerX - prev.centerX, det.centerY - prev.centerY);
    if (dist < bestDist && dist < maxDist) {
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

      if (r > 135 && r - Math.max(g, b) > 35) {
        redScore += relY < 0.5 ? 1.5 : 1;
      } else if (g > 125 && g - r > 22 && b < 230) {
        greenScore += relY > 0.5 ? 1.5 : 1;
      } else if (r > 150 && g > 120 && b < 130 && Math.abs(r - g) < 85) {
        yellowScore += relY >= 0.25 && relY <= 0.75 ? 1.4 : 1;
      }
    }
  }

  const minPixels = Math.max(2, Math.floor((sw * sh) * 0.02));
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
  let correctionRo = 'Trotuar liber.';
  let messageRo = 'Trotuar liber';

  if (status === 'edge_left') {
    messageRo = 'Deviere stânga';
    if (hasCloseRightObstacle) {
      if (!hasCloseCenterObstacle) {
        action = 'steer_center';
        safeZone = 'center';
        correctionRo = 'Margine stânga. Rămâi pe centru.';
      } else {
        action = 'stop';
        safeZone = 'none';
        correctionRo = 'Stop! Margine stânga, obstacol în față.';
      }
    } else {
      action = 'steer_right';
      safeZone = 'right';
      correctionRo = 'Margine stânga. Pas la dreapta.';
    }
  } else if (status === 'edge_right') {
    messageRo = 'Deviere dreapta';
    if (hasCloseLeftObstacle) {
      if (!hasCloseCenterObstacle) {
        action = 'steer_center';
        safeZone = 'center';
        correctionRo = 'Margine dreapta. Rămâi pe centru.';
      } else {
        action = 'stop';
        safeZone = 'none';
        correctionRo = 'Stop! Margine dreapta, obstacol în față.';
      }
    } else {
      action = 'steer_left';
      safeZone = 'left';
      correctionRo = 'Margine dreapta. Pas la stânga.';
    }
  } else if (status === 'blocked' || hasCloseCenterObstacle) {
    const obsName = (centerObstacles[0]?.labelRo || 'obstacol').toLowerCase();
    messageRo = `Obstacol: ${obsName}`;
    if (!leftEdge && !hasCloseLeftObstacle) {
      action = 'bypass_left';
      safeZone = 'left';
      correctionRo = `${obsName} în față. Ocolește stânga.`;
    } else if (!rightEdge && !hasCloseRightObstacle) {
      action = 'bypass_right';
      safeZone = 'right';
      correctionRo = `${obsName} în față. Ocolește dreapta.`;
    } else {
      action = 'stop';
      safeZone = 'none';
      correctionRo = `Stop! ${obsName} în față.`;
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

// High-risk moving or large hazards that a white cane cannot detect early enough
const HIGH_RISK_CLASSES = new Set([
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'bus',
  'truck',
  'traffic light',
  'stop sign',
  'door',
]);

// Static / low street objects that a white cane sweeps naturally unless huge or at head/chest height
const CANE_DETECTABLE_CLASSES = new Set([
  'fire hydrant',
  'parking meter',
  'bench',
  'chair',
  'couch',
  'dining table',
  'potted plant',
  'suitcase',
  'dog',
  'cat',
  'backpack',
  'handbag',
  'umbrella',
]);

const HAZARDOUS_OBSTACLE_CLASSES = new Set([
  ...HIGH_RISK_CLASSES,
  ...CANE_DETECTABLE_CLASSES,
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
  frameSample = null,
  now = Date.now()
) {
  if (!frameWidth || !frameHeight) return [];

  const frameArea = frameWidth * frameHeight;
  const matchRadius = frameWidth * 0.23;
  const matchedPrevIds = new Set();

  const currentObstacles = predictions
    .filter((p) => {
      // 1. Initial confidence filter (traffic lights are small so allow >= 0.25)
      if (p.class === 'traffic light') {
        if (p.score < PED_LIGHT_MIN_SCORE) return false;
        const [bx, , bw, bh] = p.bbox;
        if (bw <= 0 || bh <= 0) return false;
        const aspect = bh / bw;
        if (aspect > PED_LIGHT_MAX_ASPECT || aspect < PED_LIGHT_MIN_ASPECT) return false; // car signal
        if (bh / frameHeight < PED_LIGHT_MIN_HEIGHT_RATIO) return false; // too far
        const cx = (bx + bw / 2) / frameWidth;
        if (cx < PED_LIGHT_CENTER_MIN || cx > PED_LIGHT_CENTER_MAX) return false; // not ahead
        return true;
      }
      if (p.score < 0.46) return false;

      // 2. White-cane-aware pre-filter: ignore minor non-hazard objects (bottles, cups, laptops, etc.)
      // because a blind user sweeps low/small ground clutter with their white cane.
      const isKnownHazard = HAZARDOUS_OBSTACLE_CLASSES.has(p.class);
      if (!isKnownHazard) return false;

      // Ignore tiny distant cane-detectable items completely
      if (CANE_DETECTABLE_CLASSES.has(p.class)) {
        const heightRatio = p.bbox[3] / frameHeight;
        const areaRatio = (p.bbox[2] * p.bbox[3]) / frameArea;
        if (heightRatio < 0.24 && areaRatio < 0.08) return false;
      }
      return true;
    })
    .map((p, index) => {
      const [rawX, rawY, rawW, rawH] = p.bbox;
      const rawCenterX = rawX + rawW / 2;
      const rawCenterY = rawY + rawH / 2;

      const prev = findPreviousMatch(
        { class: p.class, centerX: rawCenterX, centerY: rawCenterY },
        prevObstacles,
        matchedPrevIds,
        matchRadius
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

      const labelRo = OBSTACLE_LABELS_RO[p.class] || p.class;
      const rawDistance = estimateDistanceMeters(heightRatio);
      const smoothedDistance = prev
        ? ema(prev.rawDistance, rawDistance, 0.3)
        : rawDistance;
      const distanceMeters = formatDistance(smoothedDistance);
      const zoneRo = ZONE_LABELS_RO[zone];

      // ─── Approach assessment ──────────────────────────────────────────────
      // Speed is measured against a reference sample at least TREND_WINDOW_MS old,
      // in m/s, so a person sitting still (bbox jitter) reads as ~0 instead of "approaching".
      let trendTime = prev?.trendTime ?? now;
      let trendDistance = prev?.trendDistance ?? smoothedDistance;
      let trendCenterX = prev?.trendCenterX ?? centerX;
      let closingSpeed = prev?.closingSpeed ?? 0;
      let centeringShift = prev?.centeringShift ?? 0;

      const elapsed = now - trendTime;
      if (prev && elapsed >= TREND_WINDOW_MS) {
        const seconds = elapsed / 1000;
        closingSpeed = ema(prev.closingSpeed, (trendDistance - smoothedDistance) / seconds, 0.5);
        centeringShift =
          (Math.abs(trendCenterX - frameWidth / 2) - Math.abs(centerX - frameWidth / 2)) /
          frameWidth;
        trendTime = now;
        trendDistance = smoothedDistance;
        trendCenterX = centerX;
      }

      const isApproaching = closingSpeed > APPROACH_SPEED_MPS;
      const isFastApproach = closingSpeed > FAST_APPROACH_SPEED_MPS;
      const isReceding = closingSpeed < RECEDE_SPEED_MPS;
      const isCentering = centeringShift > CENTERING_SHIFT_RATIO;
      const isGrowingArea = isApproaching;

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

      // Evaluate Pericol / Threat flag using White-Cane model:
      // - Skip minor low/ground objects that a white cane already sweeps at ~1-1.5m
      // - Always alert on moving hazards, traffic lights, head/chest-height overhangs, and large path blockers
      let isThreat = false;
      let threatReason = '';
      let severity = 'far';

      // Object is in the upper/chest-to-head zone (cane sweeps the ground and misses overhangs)
      const isUpperBodyOrOverhang =
        y < frameHeight * 0.38 && y + height < frameHeight * 0.82;

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
      } else if (HIGH_RISK_CLASSES.has(p.class) && !isReceding) {
        if (inCenterPath) {
          if (smoothedDistance <= 2.2) {
            isThreat = true;
            threatReason = isFastApproach ? 'Te apropii rapid' : isApproaching ? 'Te apropii' : 'În calea ta';
            severity = 'danger';
          } else if (smoothedDistance <= 5.2 && isApproaching) {
            isThreat = true;
            threatReason = 'Te apropii';
            severity = smoothedDistance <= 3.2 ? 'danger' : 'approaching';
          }
        } else {
          if (smoothedDistance <= 1.6 && isApproaching) {
            isThreat = true;
            threatReason = 'Obstacol lateral apropiat';
            severity = 'approaching';
          } else if (isCentering && isApproaching && smoothedDistance <= 4.0) {
            isThreat = true;
            threatReason = 'Se îndreaptă spre calea ta';
            severity = 'approaching';
          }
        }
      } else if (CANE_DETECTABLE_CLASSES.has(p.class) && !isReceding) {
        // Only alert cane-detectable static objects if they are:
        // 1) at chest/head height (overhanging, cane misses them), OR
        // 2) large and directly blocking the center path
        const isLargeBlocker = heightRatio >= 0.34 || areaRatio >= 0.14;
        if (inCenterPath && isUpperBodyOrOverhang && smoothedDistance <= 3.5) {
          isThreat = true;
          threatReason = 'Obstacol la nivelul capului';
          severity = smoothedDistance <= 2.0 ? 'danger' : 'approaching';
        } else if (inCenterPath && isLargeBlocker && smoothedDistance <= 3.5 && isApproaching) {
          isThreat = true;
          threatReason = 'Obstacol mare în față';
          severity = smoothedDistance <= 2.0 ? 'danger' : 'approaching';
        }
      }

      // Alert message in Romanian (concise, clear, fast to speak)
      let messageRo = `${labelRo} ${zoneRo}, ${distanceMeters} metri.`;
      if (p.class === 'traffic light') {
        if (trafficLightState === 'red') {
          messageRo = 'Semafor pietoni roșu. Oprește!';
        } else if (trafficLightState === 'yellow') {
          messageRo = 'Semafor pietoni galben.';
        } else if (trafficLightState === 'green') {
          messageRo = 'Semafor pietoni verde. Poți traversa.';
        }
      } else if (severity === 'danger') {
        messageRo = `Atenție! ${labelRo} ${zoneRo}, ${distanceMeters} metri.`;
      } else if (severity === 'approaching') {
        messageRo = `${labelRo} ${zoneRo}, ${distanceMeters} metri.`;
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
        closingSpeed,
        trendTime,
        trendDistance,
        trendCenterX,
        centeringShift,
        isGrowing: isGrowingArea,
        isApproaching,
        isFastApproach,
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
    })
    // A signal with no lit lamp is usually seen from behind/side: not useful, drop it
    .filter((o) => !(o.class === 'traffic light' && o.trafficLightState === 'unknown'));

  // Keep recently confirmed obstacles for up to 2 missed frames for visual continuity,
  // but mark them as non-threatening so they never re-trigger voice alerts after passing
  const coasted = prevObstacles
    .filter(
      (prev) =>
        !matchedPrevIds.has(prev.id) &&
        prev.isConfirmed &&
        (prev.missedFrames || 0) < 2
    )
    .map((prev) => ({
      ...prev,
      isThreat: false,
      severity: 'far',
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
