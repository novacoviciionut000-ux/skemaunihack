import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let modelPromise = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let lightCropCanvas = null;
let lightCropCtx = null;

/**
 * Small separate canvas for traffic-light crops, so sampling a lamp never disturbs
 * the full-frame sample used for sidewalk and crosswalk analysis.
 */
function getLightCropContext(width, height) {
  if (typeof document === 'undefined') return null;
  if (!lightCropCanvas) {
    lightCropCanvas = document.createElement('canvas');
    lightCropCtx = lightCropCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (lightCropCanvas.width !== width || lightCropCanvas.height !== height) {
    lightCropCanvas.width = width;
    lightCropCanvas.height = height;
  }
  return lightCropCtx;
}

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

const TRAFFIC_COLOR_RO = {
  red: 'roșu',
  yellow: 'galben',
  green: 'verde',
  unknown: '',
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
// Distance from apparent size, using a pinhole model and the real-world height of each
// class. A single height for everything was the earlier approach and it misjudged badly:
// a bench is 0.9 m and a bus is 3 m, so the same box size means very different distances.
const VERTICAL_FOV_DEG = 62; // typical phone rear camera
const FOV_SCALE = 2 * Math.tan((VERTICAL_FOV_DEG / 2) * (Math.PI / 180));

const CLASS_HEIGHT_M = {
  person: 1.7,
  bicycle: 1.1,
  motorcycle: 1.2,
  car: 1.5,
  bus: 3.0,
  truck: 2.8,
  'traffic light': 0.8,
  'stop sign': 0.75,
  'fire hydrant': 0.75,
  'parking meter': 1.2,
  bench: 0.9,
  chair: 0.9,
  couch: 0.8,
  'dining table': 0.75,
  'potted plant': 0.6,
  suitcase: 0.7,
  backpack: 0.5,
  handbag: 0.35,
  umbrella: 1.0,
  dog: 0.55,
  cat: 0.3,
  door: 2.0,
};
const DEFAULT_HEIGHT_M = 1.2;
// Shoulder width, used when a person's box is cut off by the bottom of the frame
const PERSON_WIDTH_M = 0.5;
// Tracking has to start well before the alert thresholds, otherwise closing speed is
// still unknown when a vehicle arrives. A car at 5 m/s crosses 8 m in under two seconds.
const MAX_DISTANCE_M = 15.0;

/**
 * Estimates distance in meters from the bounding box.
 *
 * Pixel scale is isotropic, so width and height can both be measured against the frame
 * height. That matters for people: up close their legs leave the frame, the visible box
 * is short, and a height-only estimate would place them further away than they are,
 * which is exactly when an early warning counts.
 */
function estimateDistanceMeters(cls, width, height, boxBottom, frameHeight) {
  const objectHeight = CLASS_HEIGHT_M[cls] ?? DEFAULT_HEIGHT_M;
  const heightRatio = height / frameHeight;
  if (heightRatio <= 0.005) return MAX_DISTANCE_M;

  let distance = objectHeight / (FOV_SCALE * heightRatio);

  const isClipped = boxBottom >= frameHeight - 2;
  if (cls === 'person' && isClipped && width > 0) {
    const fromWidth = PERSON_WIDTH_M / (FOV_SCALE * (width / frameHeight));
    // Clipping can only inflate the height-based estimate, never shrink it
    distance = Math.min(distance, fromWidth);
  }

  return Math.max(0.4, Math.min(MAX_DISTANCE_M, distance));
}

// Smoothing the distance has to follow a real approach without chasing box jitter, so the
// weight adapts: gentle for small wobble, quick when the object is genuinely moving.
// A fixed slow weight was the main reason alerts arrived late, lagging a fast approach
// by more than two meters.
function distanceAlpha(prevDistance, rawDistance) {
  const change = Math.abs(rawDistance - prevDistance);
  if (change < 0.3) return 0.35;
  if (change < 0.8) return 0.6;
  return 0.85;
}

// Quantize for voice/UI only (0.2 m under 2 m, 0.5 m above).
function formatDistance(meters) {
  return meters < 2.0 ? Math.round(meters * 5) / 5 : Math.round(meters * 2) / 2;
}

// Approach tracking: speeds are measured over a window of at least this long,
// so frame-to-frame bounding box noise cannot register as movement.
const TREND_WINDOW_MS = 400;

// Telling pedestrian signals from car signals. COCO-SSD only knows one class,
// "traffic light", so the two kinds are separated by the shape of the box: a car
// signal stacks 3 lamps and is clearly tall and narrow, a pedestrian signal holds
// 2 lamps or one panel and is much squarer.
//
// These thresholds stay deliberately permissive. A stricter earlier version rejected
// almost every real signal, so shape now only *labels* a light rather than discarding
// it, and the spoken message says which kind it is.
const PED_LIGHT_MAX_ASPECT = 2.2; // h/w at or below this reads as a pedestrian signal
const CAR_LIGHT_MIN_ASPECT = 2.6; // h/w at or above this reads as a car signal
const LIGHT_MIN_HEIGHT_RATIO = 0.025; // below this the light is too far to be useful
const LIGHT_MIN_SCORE = 0.28;
// Lights far out at the edge of the frame belong to another crossing
const LIGHT_CENTER_MIN = 0.1;
const LIGHT_CENTER_MAX = 0.9;
// Aspect ratio is only trustworthy once the box has some pixels to measure
const LIGHT_SHAPE_MIN_HEIGHT_PX = 22;

// Zebra crossing pattern thresholds. Deliberately strict: telling a blind user there is
// a crossing where there is none can put them in the road, so a missed crossing is the
// safer failure. Stairs are the hardest look-alike and are rejected by brightness level.
const CROSSWALK_MIN_BANDS = 5; // alternating light/dark stripes needed
const CROSSWALK_MIN_CONTRAST = 65; // brightness swing between paint and asphalt
const CROSSWALK_MIN_BRIGHT_LEVEL = 150; // painted stripes are near-white
const CROSSWALK_MAX_DARK_LEVEL = 110; // asphalt between them is dark
const CROSSWALK_MIN_EVENNESS = 0.55; // stripes are evenly spaced
const CROSSWALK_MAX_SATURATION = 0.3; // grey asphalt and white paint, not coloured surfaces
const CROSSWALK_CONFIRM_FRAMES = 4;
const APPROACH_SPEED_MPS = 0.4; // closing faster than this counts as approaching
const FAST_APPROACH_SPEED_MPS = 1.2; // "rapid" approach
const RECEDE_SPEED_MPS = -0.3;
const CENTERING_SHIFT_RATIO = 0.05; // lateral shift toward center, fraction of frame width

// Alert thresholds. A blind user walking at ~1.2 m/s needs a few seconds to stop or step
// aside, so warnings are given on both distance and time to impact, whichever comes first.
const DANGER_DISTANCE_M = 2.5;
const DANGER_TTC_S = 2.0;
const WARN_DISTANCE_M = 6.0;
const WARN_TTC_S = 4.5;
// Half the width of the lane a walking person needs. An object whose nearest edge is
// further than this to the side gets passed, not collided with.
const WALKING_CORRIDOR_HALF_M = 0.6;

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
 * inside its bounding box.
 *
 * Reads the box straight off the video at native resolution rather than from the
 * downscaled frame sample: a signal 5% of the frame tall is only ~6 px in a 160x120
 * sample, which is far too few pixels to tell red from green reliably.
 */
function detectTrafficLightState(bbox, frameWidth, frameHeight, frameSample, video) {
  const crop = cropRegion(video, bbox, frameWidth, frameHeight);
  const source = crop || cropFromSample(bbox, frameWidth, frameHeight, frameSample);
  if (!source) return 'unknown';

  const { data, width, height } = source;
  let redScore = 0;
  let greenScore = 0;
  let yellowScore = 0;
  let litPixels = 0;

  for (let py = 0; py < height; py++) {
    const relY = py / height;
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // A lit lamp is both colorful and brighter than the dark signal housing
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 90 || max - min < 30) continue;
      litPixels++;

      if (r > 120 && r - Math.max(g, b) > 30) {
        redScore += relY < 0.5 ? 1.5 : 1;
      } else if (g > 110 && g - r > 20 && b < 235) {
        greenScore += relY > 0.5 ? 1.5 : 1;
      } else if (r > 140 && g > 110 && b < 140 && Math.abs(r - g) < 90) {
        yellowScore += relY >= 0.25 && relY <= 0.75 ? 1.4 : 1;
      }
    }
  }

  // Require a real cluster of lit pixels, not a few stray colorful ones
  const minPixels = Math.max(6, Math.floor(width * height * 0.015));
  if (litPixels < minPixels) return 'unknown';

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
 * Draws just the bounding box out of the live video into a small canvas, so the
 * lamp is examined at the camera's own resolution.
 */
function cropRegion(video, bbox, frameWidth, frameHeight) {
  if (!video || video.readyState < 2) return null;
  const nativeW = video.videoWidth || frameWidth;
  const nativeH = video.videoHeight || frameHeight;
  if (!nativeW || !nativeH) return null;

  const scaleX = nativeW / frameWidth;
  const scaleY = nativeH / frameHeight;
  const sx = Math.max(0, Math.floor(bbox[0] * scaleX));
  const sy = Math.max(0, Math.floor(bbox[1] * scaleY));
  const sw = Math.min(nativeW - sx, Math.ceil(bbox[2] * scaleX));
  const sh = Math.min(nativeH - sy, Math.ceil(bbox[3] * scaleY));
  if (sw < 3 || sh < 3) return null;

  const outW = Math.max(8, Math.min(48, Math.round(sw)));
  const outH = Math.max(8, Math.min(96, Math.round(sh)));
  const ctx = getLightCropContext(outW, outH);
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  const imageData = ctx.getImageData(0, 0, outW, outH);
  return { data: imageData.data, width: outW, height: outH };
}

/**
 * Fallback color source: the already-captured downscaled frame, used when the video
 * frame itself is not readable.
 */
function cropFromSample(bbox, frameWidth, frameHeight, frameSample) {
  if (!frameSample) return null;
  const scaleX = frameSample.width / frameWidth;
  const scaleY = frameSample.height / frameHeight;
  const sx = Math.max(0, Math.floor(bbox[0] * scaleX));
  const sy = Math.max(0, Math.floor(bbox[1] * scaleY));
  const sw = Math.max(2, Math.min(frameSample.width - sx, Math.ceil(bbox[2] * scaleX)));
  const sh = Math.max(2, Math.min(frameSample.height - sy, Math.ceil(bbox[3] * scaleY)));

  const src = frameSample.imageData;
  const out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const from = ((sy + y) * src.width + (sx + x)) * 4;
      const to = (y * sw + x) * 4;
      out[to] = src.data[from];
      out[to + 1] = src.data[from + 1];
      out[to + 2] = src.data[from + 2];
      out[to + 3] = src.data[from + 3];
    }
  }
  return { data: out, width: sw, height: sh };
}

/**
 * Detects a zebra crossing ahead by looking for the alternating bright/dark bands
 * its stripes make in the lower-center of the frame.
 *
 * COCO-SSD has no crosswalk class, so this is pixel analysis, not recognition: the
 * row-average brightness down the walking corridor is scanned for a regular
 * oscillation with strong contrast. Painted stripes produce several wide, evenly
 * spaced swings; plain asphalt or pavers produce almost none.
 *
 * Being a pattern heuristic, it can be fooled by stairs, strongly tiled paving or
 * long shadows across the path, so confirmation over several frames is required
 * before anything is announced.
 */
export function detectCrosswalk(frameSample, prevState = null) {
  const idle = {
    detected: false,
    confidence: 0,
    bandCount: 0,
    contrast: 0,
    candidateFrames: 0,
    messageRo: '',
  };
  if (!frameSample) return idle;

  const { data, width, height } = frameSample.imageData;
  // Lower-center corridor: the stretch of ground the user is about to step onto
  const yStart = Math.floor(height * 0.55);
  const yEnd = Math.floor(height * 0.97);
  const xStart = Math.floor(width * 0.22);
  const xEnd = Math.floor(width * 0.78);
  const rowCount = yEnd - yStart;
  if (rowCount < 8 || xEnd - xStart < 8) return idle;

  // Per row: mean brightness, and mean color saturation. Road paint is white-on-grey,
  // so a colourful surface (grass, red brick, tiles) is not a crossing.
  const rows = new Float32Array(rowCount);
  let saturationSum = 0;
  let saturationCount = 0;
  for (let y = yStart; y < yEnd; y++) {
    let sum = 0;
    let count = 0;
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      saturationSum += max === 0 ? 0 : (max - min) / max;
      saturationCount++;
      count++;
    }
    rows[y - yStart] = sum / count;
  }
  const meanSaturation = saturationCount ? saturationSum / saturationCount : 1;
  if (meanSaturation > CROSSWALK_MAX_SATURATION) return idle;

  let mean = 0;
  for (let i = 0; i < rowCount; i++) mean += rows[i];
  mean /= rowCount;

  let minRow = Infinity;
  let maxRow = -Infinity;
  for (let i = 0; i < rowCount; i++) {
    if (rows[i] < minRow) minRow = rows[i];
    if (rows[i] > maxRow) maxRow = rows[i];
  }
  const contrast = maxRow - minRow;

  // Collect bands: runs of rows that stay clearly above or below the mean. A band only
  // counts once it is a few rows thick, which rejects fine texture and single shadows.
  const margin = Math.max(8, contrast * 0.2);
  const minBandRows = Math.max(2, Math.round(rowCount * 0.045));
  const bands = [];
  let currentSign = 0;
  let runLength = 0;
  let runSum = 0;

  const closeBand = () => {
    if (currentSign !== 0 && runLength >= minBandRows) {
      bands.push({ sign: currentSign, rows: runLength, level: runSum / runLength });
    }
  };

  for (let i = 0; i < rowCount; i++) {
    const sign = rows[i] > mean + margin ? 1 : rows[i] < mean - margin ? -1 : 0;
    if (sign !== 0 && sign === currentSign) {
      runLength++;
      runSum += rows[i];
    } else {
      closeBand();
      currentSign = sign;
      runLength = sign === 0 ? 0 : 1;
      runSum = sign === 0 ? 0 : rows[i];
    }
  }
  closeBand();

  const brightBands = bands.filter((b) => b.sign === 1);
  const darkBands = bands.filter((b) => b.sign === -1);

  // Zebra paint is genuinely bright and the asphalt between it genuinely dark.
  // Concrete stairs and paving slabs sit in the mid greys and fail this.
  const brightLevel = brightBands.length
    ? brightBands.reduce((s, b) => s + b.level, 0) / brightBands.length
    : 0;
  const darkLevel = darkBands.length
    ? darkBands.reduce((s, b) => s + b.level, 0) / darkBands.length
    : 255;

  // Stripes are evenly spaced, so band thicknesses must be similar. Stairs seen in
  // perspective, and random shadows, give wildly uneven bands.
  let evenness = 0;
  if (bands.length >= 2) {
    const thicknesses = bands.map((b) => b.rows);
    const meanThickness = thicknesses.reduce((s, t) => s + t, 0) / thicknesses.length;
    const spread =
      Math.sqrt(
        thicknesses.reduce((s, t) => s + (t - meanThickness) ** 2, 0) / thicknesses.length
      ) / meanThickness;
    evenness = Math.max(0, 1 - spread);
  }

  const hasPattern =
    bands.length >= CROSSWALK_MIN_BANDS &&
    brightBands.length >= 2 &&
    darkBands.length >= 2 &&
    contrast >= CROSSWALK_MIN_CONTRAST &&
    brightLevel >= CROSSWALK_MIN_BRIGHT_LEVEL &&
    darkLevel <= CROSSWALK_MAX_DARK_LEVEL &&
    evenness >= CROSSWALK_MIN_EVENNESS;

  const candidateFrames = hasPattern ? (prevState?.candidateFrames || 0) + 1 : 0;
  const detected = candidateFrames >= CROSSWALK_CONFIRM_FRAMES;

  return {
    detected,
    confidence: Math.min(1, evenness * (contrast / 120)),
    bandCount: bands.length,
    contrast: Math.round(contrast),
    evenness: Math.round(evenness * 100) / 100,
    brightLevel: Math.round(brightLevel),
    darkLevel: Math.round(darkLevel),
    saturation: Math.round(meanSaturation * 100) / 100,
    candidateFrames,
    // Worded as a possibility on purpose. The pattern test is strict but still a
    // heuristic, and sunlit concrete stairs remain a plausible look-alike, so the
    // user is cued to verify with the cane rather than told a crossing is there.
    messageRo: detected ? 'Posibilă trecere de pietoni în față.' : '',
  };
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
  now = Date.now(),
  video = null
) {
  if (!frameWidth || !frameHeight) return [];

  const frameArea = frameWidth * frameHeight;
  const matchRadius = frameWidth * 0.23;
  const matchedPrevIds = new Set();

  const currentObstacles = predictions
    .filter((p) => {
      // 1. Initial confidence filter (traffic lights are small so allow >= 0.25)
      if (p.class === 'traffic light') {
        if (p.score < LIGHT_MIN_SCORE) return false;
        const [bx, , bw, bh] = p.bbox;
        if (bw <= 0 || bh <= 0) return false;
        if (bh / frameHeight < LIGHT_MIN_HEIGHT_RATIO) return false; // too far to matter
        const cx = (bx + bw / 2) / frameWidth;
        if (cx < LIGHT_CENTER_MIN || cx > LIGHT_CENTER_MAX) return false; // another crossing
        return true;
      }
      if (p.score < 0.46) return false;

      // 2. White-cane-aware pre-filter: ignore minor non-hazard objects (bottles, cups, laptops, etc.)
      // because a blind user sweeps low/small ground clutter with their white cane.
      const isKnownHazard = HAZARDOUS_OBSTACLE_CLASSES.has(p.class);
      if (!isKnownHazard) return false;

      // Ignore tiny distant cane-detectable items completely. The thresholds are low
      // enough to start tracking a bollard or bench standing in the walking corridor
      // while there is still time to stop; the threat rules below decide whether it is
      // worth mentioning at all.
      if (CANE_DETECTABLE_CLASSES.has(p.class)) {
        const heightRatio = p.bbox[3] / frameHeight;
        const areaRatio = (p.bbox[2] * p.bbox[3]) / frameArea;
        if (heightRatio < 0.18 && areaRatio < 0.05) return false;
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

      const labelRo = OBSTACLE_LABELS_RO[p.class] || p.class;
      const rawDistance = estimateDistanceMeters(p.class, width, height, y + height, frameHeight);
      const smoothedDistance = prev
        ? ema(prev.rawDistance, rawDistance, distanceAlpha(prev.rawDistance, rawDistance))
        : rawDistance;
      const distanceMeters = formatDistance(smoothedDistance);
      const zoneRo = ZONE_LABELS_RO[zone];

      // Whether the object stands in the walking corridor, measured in meters rather than
      // in image space. A parked car beside the pavement is wide enough that its box
      // covers the middle of the picture, and the old pixel-overlap test called that "in
      // your path", so every parked vehicle raised an alert as the user walked past.
      const pxPerMeter = frameHeight / (FOV_SCALE * smoothedDistance);
      const lateralOffsetM = (centerX - frameWidth / 2) / pxPerMeter;
      const objectWidthM = width / pxPerMeter;
      const lateralGapM = Math.abs(lateralOffsetM) - objectWidthM / 2;
      const coversFrameCenter = x < frameWidth / 2 && x + width > frameWidth / 2;
      const inCenterPath =
        lateralGapM <= WALKING_CORRIDOR_HALF_M ||
        // Something filling the middle of the view from close up counts regardless of
        // what the distance estimate says, because that estimate is least reliable there
        (coversFrameCenter && smoothedDistance <= 2.5);

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

      // Seconds until contact at the current closing speed. Infinite when not closing.
      const timeToImpact =
        closingSpeed > 0.2 ? smoothedDistance / closingSpeed : Number.POSITIVE_INFINITY;

      let trafficLightState = null;
      let trafficLightHold = 0;
      let lightKind = null;
      if (p.class === 'traffic light') {
        // Shape tells the two kinds apart, but only once the box is big enough to measure.
        const aspect = height / width;
        if (height < LIGHT_SHAPE_MIN_HEIGHT_PX) {
          lightKind = 'unknown';
        } else if (aspect <= PED_LIGHT_MAX_ASPECT) {
          lightKind = 'pedestrian';
        } else if (aspect >= CAR_LIGHT_MIN_ASPECT) {
          lightKind = 'car';
        } else {
          lightKind = 'unknown';
        }
        if (prev?.lightKind && prev.lightKind !== 'unknown' && lightKind === 'unknown') {
          lightKind = prev.lightKind; // keep an earlier, closer-range judgement
        }

        const detectedColor = detectTrafficLightState(
          [x, y, width, height],
          frameWidth,
          frameHeight,
          frameSample,
          video
        );
        if (detectedColor !== 'unknown') {
          trafficLightState = detectedColor;
          trafficLightHold = 3;
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
        // A red pedestrian signal is the one case that must stop the user
        if (lightKind === 'pedestrian' && trafficLightState === 'red') {
          isThreat = true;
          threatReason = 'Semafor pietoni roșu';
          severity = 'danger';
        } else if (lightKind === 'pedestrian' && trafficLightState === 'yellow') {
          isThreat = true;
          threatReason = 'Semafor pietoni galben';
          severity = 'approaching';
        } else {
          // Green, car signals and unreadable lights are informational, not hazards
          isThreat = false;
          severity = 'far';
        }
      } else if (HIGH_RISK_CLASSES.has(p.class) && !isReceding) {
        // Time to collision is what decides how urgent something is. Distance alone
        // treats a cyclist at 5 m the same as someone standing there, when one arrives
        // in a second and the other not at all.
        if (inCenterPath) {
          if (smoothedDistance <= DANGER_DISTANCE_M || timeToImpact <= DANGER_TTC_S) {
            isThreat = true;
            threatReason = isFastApproach ? 'Te apropii rapid' : isApproaching ? 'Te apropii' : 'În calea ta';
            severity = 'danger';
          } else if (smoothedDistance <= WARN_DISTANCE_M || timeToImpact <= WARN_TTC_S) {
            isThreat = true;
            // A brand new box has no trend yet, so it is reported as being in the way
            // rather than waiting most of a second to learn whether it is approaching
            threatReason = isApproaching ? 'Te apropii' : 'În calea ta';
            severity = 'approaching';
          }
        } else {
          // Out of the corridor: closing distance does not mean collision, because the
          // user walks past. Only something drifting into the corridor, or already
          // brushing it, is worth saying anything about.
          if (isCentering && smoothedDistance <= 4.0) {
            isThreat = true;
            threatReason = 'Se îndreaptă spre calea ta';
            severity = smoothedDistance <= 2.0 ? 'danger' : 'approaching';
          } else if (lateralGapM <= 0.35 && smoothedDistance <= 1.5) {
            isThreat = true;
            threatReason = 'Obstacol lateral apropiat';
            severity = 'approaching';
          }
        }
      } else if (CANE_DETECTABLE_CLASSES.has(p.class) && !isReceding) {
        // A cane finds ground clutter on its own, so these only matter when they are at
        // body height, or big enough to block the way. No approach requirement: something
        // standing in the path is just as solid whether or not it is moving.
        const isLargeBlocker = heightRatio >= 0.2 || areaRatio >= 0.06;
        if (inCenterPath && isUpperBodyOrOverhang && smoothedDistance <= 4.0) {
          isThreat = true;
          threatReason = 'Obstacol la nivelul capului';
          severity = smoothedDistance <= 2.5 ? 'danger' : 'approaching';
        } else if (inCenterPath && isLargeBlocker && smoothedDistance <= 3.5) {
          isThreat = true;
          threatReason = 'Obstacol mare în față';
          severity = smoothedDistance <= 2.0 ? 'danger' : 'approaching';
        }
      }

      // Alert message in Romanian (concise, clear, fast to speak)
      let messageRo = `${labelRo} ${zoneRo}, ${distanceMeters} metri.`;
      if (p.class === 'traffic light') {
        // Only a pedestrian signal may carry a crossing instruction. Telling someone to
        // cross on a car signal's green would send them into moving traffic.
        if (lightKind === 'pedestrian') {
          if (trafficLightState === 'red') {
            messageRo = 'Semafor pietoni roșu. Nu traversa.';
          } else if (trafficLightState === 'yellow') {
            messageRo = 'Semafor pietoni galben. Așteaptă.';
          } else if (trafficLightState === 'green') {
            messageRo = 'Semafor pietoni verde. Poți traversa.';
          } else {
            messageRo = 'Semafor pietoni în față.';
          }
        } else if (lightKind === 'car') {
          messageRo =
            trafficLightState === 'unknown'
              ? 'Semafor pentru mașini în față.'
              : `Semafor mașini ${TRAFFIC_COLOR_RO[trafficLightState]}.`;
        } else {
          messageRo =
            trafficLightState === 'unknown'
              ? 'Semafor în față.'
              : `Semafor ${TRAFFIC_COLOR_RO[trafficLightState]}.`;
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
        lightKind,
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
    });

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

export function emitCrosswalkEvent(crosswalkPayload) {
  window.dispatchEvent(
    new CustomEvent('accessmap:crosswalk', {
      detail: crosswalkPayload,
    })
  );
}
