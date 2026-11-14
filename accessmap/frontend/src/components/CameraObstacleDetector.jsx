import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  CameraOff,
  RefreshCw,
  AlertTriangle,
  Maximize2,
  Minimize2,
  X,
  Loader2,
  ShieldCheck,
  Radio,
  Smartphone,
  Route,
  CheckCircle2,
  Target,
  Layers,
  ArrowRight,
  ArrowLeft,
  Eye,
  Map as MapIcon,
  Square,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Footprints,
  ShieldAlert,
} from 'lucide-react';
import { getManeuverIcon } from './NavigationGuidance';
import { speechQueue, playAlarmBeep, playTiltBeep, unlockAudioContext } from '../utils/speechQueue';
import {
  loadObstacleModel,
  captureFrameSample,
  analyzeDetections,
  analyzeSidewalkPath,
  detectCrosswalk,
  emitObstacleAlertEvent,
  emitObstaclesClearEvent,
  emitSidewalkStatusEvent,
  emitTiltWarningEvent,
  emitCrosswalkEvent,
} from '../utils/obstacleDetector';
import { distanceMetersBetween } from '../utils/detourStore';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getOrientationPermissionState,
  requestOrientationPermission,
} from '../utils/orientationPermission';

const SEVERITY_COLORS = {
  danger: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', badgeBg: '#dc2626' },
  approaching: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', badgeBg: '#d97706' },
  far: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.10)', badgeBg: '#2563eb' },
};

const INFERENCE_INTERVAL_MS = 180;
const ALERT_COOLDOWN_MS = 5500;
const OBSTACLE_ID_REANNOUNCE_MS = 8500;
// Same kind of obstacle on the same side is not repeated inside this window, however
// many times the tracker loses and re-acquires it
const KIND_REPEAT_COOLDOWN_MS = 6000;
const TILT_VIBRATE_COOLDOWN_MS = 2500;
const SIDEWALK_EVENT_COOLDOWN_MS = 5500;
const TRAFFIC_LIGHT_RED_REMIND_MS = 20000;
const TRAFFIC_LIGHT_FORGET_MS = 4000;
const TRAFFIC_LIGHT_STABLE_FRAMES = 3;
const CROSSWALK_REPEAT_MS = 15000;
const CROSSWALK_FORGET_MS = 3000;
// Tilt thresholds (phone held in portrait, screen facing user, pointing camera forward/down at sidewalk)
// beta = angle from horizontal: 0° = flat on table, 90° = perfectly vertical
// Normal walking camera angle: 50°–80° (pointing at ground 1-2m ahead)
// "Too up" = phone nearly vertical or beyond (pointing at faces/sky): beta > 100°
// "Too down" = phone nearly flat pointing straight down at feet: beta < 25°
// "Roll" = sideways tilt: |gamma| > 40°
const TILT_UP_ENTER_DEG = 100;
const TILT_UP_EXIT_DEG = 92;
const TILT_DOWN_ENTER_DEG = 25;
const TILT_DOWN_EXIT_DEG = 32;
const TILT_ROLL_ENTER_DEG = 40;
const TILT_ROLL_EXIT_DEG = 32;


export default function CameraObstacleDetector({
  isOpen,
  onClose,
  onObstacleAlert,
  onObstaclesUpdate,
  userLocation,
  nearbyDetour,
  onDetourSaved,
  // Navigation & Full-Screen props
  isFullScreen = true,
  onToggleFullScreen,
  isNavigating = false,
  guidance = null,
  crossingAhead = null,
  voiceEnabled = true,
  onToggleVoice,
  isSimulating = false,
  onToggleSimulation,
  onStopNavigation,
}) {
  const isMobile = useIsMobile();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const modelRef = useRef(null);
  const rafRef = useRef(null);
  const lastInferenceRef = useRef(0);
  const prevObstaclesRef = useRef([]);
  const prevSidewalkRef = useRef(null);
  const clearFramesRef = useRef(0);
  const spokenObstaclesRef = useRef(new Map());
  const spokenKindsRef = useRef(new Map());
  const lastTrafficLightRef = useRef({ state: '', time: 0, lastSeen: 0, pending: '', pendingFrames: 0 });
  const prevCrosswalkRef = useRef(null);
  const lastCrosswalkRef = useRef({ active: false, time: 0 });
  const lastCrosswalkSigRef = useRef(false);
  const lastTiltVibrateRef = useRef(0);
  const lastTiltSpokenRef = useRef({ reason: null, time: 0 });
  const tiltSmoothedRef = useRef({ beta: null, gamma: null, activeReason: null });
  const lastSidewalkEventRef = useRef({ status: '', time: 0 });
  const hadActiveAlertRef = useRef(false);
  const isStartingRef = useRef(false);
  const prevOpenRef = useRef(false);
  const inferringRef = useRef(false);
  const sessionRef = useRef(0); // bumped on every start/stop so late inference results are discarded
  const lastObstacleSigRef = useRef('');
  const lastSidewalkSigRef = useRef('');

  // Latest props, readable from the long-lived detection loop without restarting it
  const liveRef = useRef({});
  liveRef.current = { voiceEnabled, onObstacleAlert, onObstaclesUpdate };
  const crossingAheadRef = useRef(null);
  crossingAheadRef.current = crossingAhead;

  useEffect(() => {
    speechQueue.setVoiceEnabled(voiceEnabled);
  }, [voiceEnabled]);

  // Detour recording refs
  const recordingRef = useRef(null); // { obstacleCoords, obstacleClass, labelRo, path: [[lat, lng], ...] }

  const [onlyThreats, setOnlyThreats] = useState(true);
  const onlyThreatsRef = useRef(true);
  onlyThreatsRef.current = onlyThreats;
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [detectedObstacles, setDetectedObstacles] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [sidewalkStatus, setSidewalkStatus] = useState(null);
  const [crosswalkAhead, setCrosswalkAhead] = useState(false);
  const [tiltWarning, setTiltWarning] = useState(false);
  const [tiltMessage, setTiltMessage] = useState('');
  const [orientationPermission, setOrientationPermission] = useState(() =>
    getOrientationPermissionState()
  );
  const [debugBeta, setDebugBeta] = useState(null);
  const [debugGamma, setDebugGamma] = useState(null);
  const [isRecordingDetour, setIsRecordingDetour] = useState(false);
  const [detourToast, setDetourToast] = useState('');
  const [isSimulatedMode, setIsSimulatedMode] = useState(false);

  const stopCamera = useCallback(() => {
    sessionRef.current += 1;
    inferringRef.current = false;
    lastObstacleSigRef.current = '';
    lastSidewalkSigRef.current = '';
    spokenObstaclesRef.current.clear();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    prevObstaclesRef.current = [];
    prevSidewalkRef.current = null;
    clearFramesRef.current = 0;
    tiltSmoothedRef.current = { beta: null, gamma: null, activeReason: null };
    lastTiltSpokenRef.current = { reason: null, time: 0 };
    setCameraActive(false);
    setIsSimulatedMode(false);
    setDetectedObstacles([]);
    setActiveAlert(null);
    setSidewalkStatus(null);
    setTiltWarning(false);
    setTiltMessage('');
  }, []);

  // Phone tilt detection (DeviceOrientationEvent) + vibration + mobile audio feedback
  useEffect(() => {
    if (!isOpen) {
      setTiltWarning(false);
      setTiltMessage('');
      return;
    }

    // Ensure audio is unlocked on mobile
    speechQueue.unlock();
    unlockAudioContext();

    // iOS: permission can only be requested from a tap. If we don't have it yet,
    // show an on-screen button (see "Activează senzorul" below) instead of silently failing.
    setOrientationPermission(getOrientationPermissionState());

    const handleOrientation = (event) => {
      if (event.beta == null) return;
      setOrientationPermission('granted');
      const state = tiltSmoothedRef.current;
      const rawBeta = event.beta;
      const rawGamma = event.gamma ?? 0;

      // Smooth orientation angles with EMA to ignore hand jitter
      state.beta = state.beta == null ? rawBeta : state.beta * 0.75 + rawBeta * 0.25;
      state.gamma = state.gamma == null ? rawGamma : state.gamma * 0.75 + rawGamma * 0.25;

      const beta = state.beta;
      const absGamma = Math.abs(state.gamma);

      // Hysteresis per tilt direction
      let reason = state.activeReason;
      if (reason === 'up') {
        if (beta < TILT_UP_EXIT_DEG) reason = null;
      } else if (reason === 'down') {
        if (beta > TILT_DOWN_EXIT_DEG) reason = null;
      } else if (reason === 'roll') {
        if (absGamma < TILT_ROLL_EXIT_DEG) reason = null;
      }

      if (!reason) {
        if (beta > TILT_UP_ENTER_DEG) reason = 'up';
        else if (beta < TILT_DOWN_ENTER_DEG) reason = 'down';
        else if (absGamma > TILT_ROLL_ENTER_DEG) reason = 'roll';
      }

      state.activeReason = reason;
      const isTilted = Boolean(reason);
      setTiltWarning(isTilted);
      setDebugBeta(Math.round(beta));
      setDebugGamma(Math.round(state.gamma));

      const now = Date.now();

      if (isTilted) {
        const msg =
          reason === 'up'
            ? 'Coboară telefonul.'
            : reason === 'down'
              ? 'Ridică telefonul.'
              : 'Ține telefonul drept.';
        setTiltMessage(msg);

        if (now - lastTiltVibrateRef.current >= TILT_VIBRATE_COOLDOWN_MS) {
          lastTiltVibrateRef.current = now;
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([200, 90, 200]);
          }
          playTiltBeep();
          emitTiltWarningEvent({
            beta: Math.round(beta),
            gamma: Math.round(state.gamma),
            reason,
            messageRo: msg,
            timestamp: now,
          });
        }

        // Avertizare vocală audio (TTS) secvențială prin coada unificată
        const isNewTiltReason = lastTiltSpokenRef.current.reason !== reason;
        const isTiltVoiceCooldownElapsed = now - lastTiltSpokenRef.current.time >= 3500;
        if ((isNewTiltReason || isTiltVoiceCooldownElapsed) && voiceEnabled !== false) {
          lastTiltSpokenRef.current = { reason, time: now };
          speechQueue.speak(msg, { priority: 'normal' });
        }
      } else {
        setTiltMessage('');
        // Dacă telefonul a fost înclinat și utilizatorul l-a readus în poziție corectă, oferim confirmare audio
        if (lastTiltSpokenRef.current.reason) {
          lastTiltSpokenRef.current = { reason: null, time: now };
          speechQueue.speak('Poziție corectă.', { priority: 'normal' });
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('deviceorientationabsolute', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      window.removeEventListener('deviceorientationabsolute', handleOrientation);
    };
  }, [isOpen, voiceEnabled]);

  // Track userLocation while recording a detour around an obstacle
  useEffect(() => {
    if (!isRecordingDetour || !recordingRef.current || !userLocation) return;

    const rec = recordingRef.current;
    const lastPt = rec.path[rec.path.length - 1];
    const currentPt = { lat: userLocation.lat, lng: userLocation.lng };

    if (!lastPt || distanceMetersBetween({ lat: lastPt[0], lng: lastPt[1] }, currentPt) >= 2) {
      rec.path.push([currentPt.lat, currentPt.lng]);
    }

    const distFromObstacle = distanceMetersBetween(rec.obstacleCoords, currentPt);
    // Auto-finish detour when user has walked >= 10m around/past the obstacle
    if (distFromObstacle >= 10 && rec.path.length >= 3) {
      finishDetourRecording();
    }
  }, [userLocation, isRecordingDetour]);

  const startDetourRecording = useCallback(
    (obstacle) => {
      if (recordingRef.current) return;
      const origin = userLocation || { lat: 45.7489, lng: 21.2087 };
      recordingRef.current = {
        obstacleCoords: { lat: origin.lat, lng: origin.lng },
        obstacleClass: obstacle?.class || 'obstacle',
        labelRo: obstacle?.labelRo || 'Obstacol',
        path: [[origin.lat, origin.lng]],
      };
      setIsRecordingDetour(true);
    },
    [userLocation]
  );

  const finishDetourRecording = useCallback(() => {
    const rec = recordingRef.current;
    if (!rec) return;

    // Ensure at least a 2-point detour path if user tested without moving GPS
    if (rec.path.length < 2) {
      const [lat, lng] = rec.path[0];
      rec.path.push([lat + 0.00008, lng + 0.00008]);
      rec.path.push([lat + 0.00015, lng]);
    }

    if (onDetourSaved) {
      onDetourSaved({
        obstacleCoords: rec.obstacleCoords,
        obstacleClass: rec.obstacleClass,
        labelRo: rec.labelRo,
        detourPath: rec.path,
      });
    }

    recordingRef.current = null;
    setIsRecordingDetour(false);
    setDetourToast('Ocolire salvată pentru următorii utilizatori!');
    setTimeout(() => setDetourToast(''), 3200);
  }, [onDetourSaved]);

  const drawOverlay = useCallback((obstacles, sidewalk, width, height) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // Draw detected sidewalk walkable corridor trapezoid in lower frame
    if (sidewalk && sidewalk.status !== 'unknown') {
      let pathFill = 'rgba(34, 197, 94, 0.16)';
      let pathStroke = 'rgba(34, 197, 94, 0.75)';
      if (sidewalk.action === 'steer_right' || sidewalk.action === 'steer_left') {
        pathFill = 'rgba(245, 158, 11, 0.20)';
        pathStroke = 'rgba(245, 158, 11, 0.85)';
      } else if (sidewalk.action === 'stop') {
        pathFill = 'rgba(239, 68, 68, 0.24)';
        pathStroke = 'rgba(239, 68, 68, 0.90)';
      }

      ctx.save();
      ctx.fillStyle = pathFill;
      ctx.strokeStyle = pathStroke;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(width * 0.22, height);
      ctx.lineTo(width * 0.36, height * 0.60);
      ctx.lineTo(width * 0.64, height * 0.60);
      ctx.lineTo(width * 0.78, height);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Highlight left curb/drop-off if drifting left
      if (sidewalk.action === 'steer_right' || sidewalk.leftEdge) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(width * 0.22, height);
        ctx.lineTo(width * 0.36, height * 0.60);
        ctx.lineTo(0, height * 0.60);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw dynamic steering guidance arrow to the right
        ctx.strokeStyle = '#22c55e';
        ctx.fillStyle = '#22c55e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(width * 0.32, height * 0.78);
        ctx.lineTo(width * 0.58, height * 0.78);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(width * 0.58, height * 0.78);
        ctx.lineTo(width * 0.52, height * 0.73);
        ctx.lineTo(width * 0.52, height * 0.83);
        ctx.closePath();
        ctx.fill();
      }

      // Highlight right curb/drop-off if drifting right
      if (sidewalk.action === 'steer_left' || sidewalk.rightEdge) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(width, height);
        ctx.lineTo(width * 0.78, height);
        ctx.lineTo(width * 0.64, height * 0.60);
        ctx.lineTo(width, height * 0.60);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw dynamic steering guidance arrow to the left
        ctx.strokeStyle = '#22c55e';
        ctx.fillStyle = '#22c55e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(width * 0.68, height * 0.78);
        ctx.lineTo(width * 0.42, height * 0.78);
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(width * 0.42, height * 0.78);
        ctx.lineTo(width * 0.48, height * 0.73);
        ctx.lineTo(width * 0.48, height * 0.83);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    // Subtle central walking corridor guide lines (28% - 72%)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(width * 0.28, 0);
    ctx.lineTo(width * 0.28, height);
    ctx.moveTo(width * 0.72, 0);
    ctx.lineTo(width * 0.72, height);
    ctx.stroke();
    ctx.restore();

    obstacles.forEach((obs) => {
      const [x, y, w, h] = obs.bbox;
      let palette = SEVERITY_COLORS[obs.severity] || SEVERITY_COLORS.far;

      // Override traffic light badge color with detected signal color
      if (obs.class === 'traffic light') {
        if (obs.trafficLightState === 'red') {
          palette = SEVERITY_COLORS.danger;
        } else if (obs.trafficLightState === 'green') {
          palette = { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.18)', badgeBg: '#16a34a' };
        } else if (obs.trafficLightState === 'yellow') {
          palette = SEVERITY_COLORS.approaching;
        }
      }

      ctx.fillStyle = palette.fill;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = obs.severity === 'danger' ? 3.5 : 2.5;
      ctx.strokeRect(x, y, w, h);

      let label = `${obs.labelRo} • ~${obs.distanceMeters}m`;
      if (obs.class === 'traffic light') {
        const stateText =
          obs.trafficLightState === 'red'
            ? 'ROȘU'
            : obs.trafficLightState === 'green'
              ? 'VERDE'
              : obs.trafficLightState === 'yellow'
                ? 'GALBEN'
                : 'SEMAFOR';
        label = `Semafor: ${stateText}`;
      } else if (obs.threatReason) {
        label = `${obs.labelRo} (${obs.threatReason}) • ~${obs.distanceMeters}m`;
      }

      ctx.font = '600 13px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const pillX = Math.max(4, x);
      const pillY = y > 26 ? y - 24 : y + 4;

      ctx.fillStyle = palette.badgeBg;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, textWidth + 14, 22, 6);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, pillX + 7, pillY + 15);
    });
  }, []);

  const startDetectionLoop = useCallback(() => {
    const session = ++sessionRef.current;

    const runInference = async (video) => {
      const frameSample = captureFrameSample(video, 160, 120);
      const predictions = await modelRef.current.detect(video, 20, 0.25);
      // Camera was stopped/restarted while the model was running
      if (session !== sessionRef.current) return;

      const { voiceEnabled: voiceOn, onObstacleAlert: notifyAlert, onObstaclesUpdate: notifyUpdate } =
        liveRef.current;
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      const now = Date.now();

      const analyzed = analyzeDetections(
        predictions,
        width,
        height,
        prevObstaclesRef.current,
        frameSample,
        now,
        video
      );
      prevObstaclesRef.current = analyzed;

      // Confirmed obstacles: active threats plus traffic lights (so red/yellow/green are always visible)
      const confirmedObstacles = analyzed.filter(
        (o) =>
          o.isConfirmed &&
          (onlyThreatsRef.current ? o.isThreat || o.class === 'traffic light' : true)
      );

      // Forget announcement history for obstacles no longer visible
      const activeIds = new Set(confirmedObstacles.map((o) => o.id));
      for (const id of spokenObstaclesRef.current.keys()) {
        if (!activeIds.has(id)) spokenObstaclesRef.current.delete(id);
      }

      const sidewalk = analyzeSidewalkPath(frameSample, confirmedObstacles, prevSidewalkRef.current);
      prevSidewalkRef.current = sidewalk;

      // Only touch React state when something visible changed (avoids re-rendering ~5x/s)
      const sidewalkSig = `${sidewalk.status}|${sidewalk.action}|${sidewalk.correctionRo}`;
      if (sidewalkSig !== lastSidewalkSigRef.current) {
        lastSidewalkSigRef.current = sidewalkSig;
        setSidewalkStatus(sidewalk);
      }
      const obstacleSig = confirmedObstacles
        .map((o) => `${o.id}:${o.severity}:${o.distanceMeters}:${o.zone}:${o.trafficLightState || ''}`)
        .join(',');
      if (obstacleSig !== lastObstacleSigRef.current) {
        lastObstacleSigRef.current = obstacleSig;
        setDetectedObstacles(confirmedObstacles);
      }

      const needsSidewalkWarning =
        sidewalk.action && sidewalk.action !== 'straight' && sidewalk.action !== 'unknown';

      if (
        needsSidewalkWarning &&
        (sidewalk.action !== lastSidewalkEventRef.current.action ||
          now - lastSidewalkEventRef.current.time >= SIDEWALK_EVENT_COOLDOWN_MS)
      ) {
        lastSidewalkEventRef.current = { action: sidewalk.action, time: now };
        emitSidewalkStatusEvent({ ...sidewalk, timestamp: now });

        const isStop = sidewalk.action === 'stop';
        if (isStop) playAlarmBeep();
        if (voiceOn !== false) {
          speechQueue.speak(sidewalk.correctionRo, { priority: isStop ? 'danger' : 'urgent' });
        }
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(isStop ? [300, 100, 300, 100, 300] : [220, 90, 220]);
        }
      }

      drawOverlay(confirmedObstacles, sidewalk, width, height);
      if (notifyUpdate) notifyUpdate(confirmedObstacles);

      // Announce the signal only when its state CHANGES and stays stable for a few frames,
      // plus a slow reminder while a pedestrian light stays red. Prevents flicker repeats.
      // Pedestrian signals win over car signals even if a car signal looks bigger, because
      // only the pedestrian one governs the crossing.
      const visibleLights = confirmedObstacles.filter(
        (o) =>
          o.class === 'traffic light' &&
          o.missedFrames === 0 &&
          o.trafficLightState &&
          o.trafficLightState !== 'unknown'
      );
      const trafficLight =
        visibleLights
          .filter((o) => o.lightKind === 'pedestrian')
          .sort((a, b) => b.areaRatio - a.areaRatio)[0] ||
        visibleLights.sort((a, b) => b.areaRatio - a.areaRatio)[0];
      const tl = lastTrafficLightRef.current;
      if (!trafficLight) {
        tl.pending = '';
        tl.pendingFrames = 0;
        // Forget the last announced state after the light has been gone for a while
        if (tl.state && now - tl.lastSeen >= TRAFFIC_LIGHT_FORGET_MS) {
          tl.state = '';
        }
      } else {
        tl.lastSeen = now;
        const state = `${trafficLight.lightKind}:${trafficLight.trafficLightState}`;
        if (state === tl.pending) {
          tl.pendingFrames += 1;
        } else {
          tl.pending = state;
          tl.pendingFrames = 1;
        }
        const isStable = tl.pendingFrames >= TRAFFIC_LIGHT_STABLE_FRAMES;
        const changed = state !== tl.state;
        const isRed =
          trafficLight.trafficLightState === 'red' && trafficLight.lightKind === 'pedestrian';
        const redReminder = isRed && now - tl.time >= TRAFFIC_LIGHT_RED_REMIND_MS;
        if (isStable && (changed || redReminder)) {
          tl.state = state;
          tl.time = now;
          if (voiceOn !== false) {
            if (isRed) playAlarmBeep();
            speechQueue.speak(trafficLight.messageRo, { priority: isRed ? 'danger' : 'high' });
          }
        }
      }

      // The map already announces crossings by distance, which is both earlier and more
      // reliable than reading stripes off the ground. So the camera pass is only used to
      // confirm the kerb is right here, and it speaks only when the map knows nothing
      // about this spot, where a cautious "possible crossing" beats saying nothing.
      const crosswalk = detectCrosswalk(frameSample, prevCrosswalkRef.current);
      prevCrosswalkRef.current = crosswalk;
      const mapKnowsCrossing = crossingAheadRef.current != null;
      const cw = lastCrosswalkRef.current;
      if (crosswalk.detected) {
        const pedLightReadable =
          trafficLight?.lightKind === 'pedestrian' &&
          trafficLight.trafficLightState !== 'unknown';
        if (!cw.active || now - cw.time >= CROSSWALK_REPEAT_MS) {
          cw.active = true;
          cw.time = now;
          emitCrosswalkEvent({ ...crosswalk, confirmsMapCrossing: mapKnowsCrossing, timestamp: now });
          if (voiceOn !== false && !pedLightReadable && !mapKnowsCrossing) {
            speechQueue.speak(crosswalk.messageRo, { priority: 'high' });
          }
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([120, 80, 120]);
          }
        }
      } else if (cw.active && now - cw.time >= CROSSWALK_FORGET_MS) {
        cw.active = false;
      }
      if (crosswalk.detected !== lastCrosswalkSigRef.current) {
        lastCrosswalkSigRef.current = crosswalk.detected;
        setCrosswalkAhead(crosswalk.detected);
      }

      const primaryThreat = confirmedObstacles.find(
        (o) =>
          !o.isReceding &&
          o.missedFrames === 0 &&
          (o.severity === 'danger' || o.severity === 'approaching')
      );

      if (!primaryThreat) {
        clearFramesRef.current += 1;
        if (clearFramesRef.current >= 3) {
          setActiveAlert(null);
          if (hadActiveAlertRef.current) {
            hadActiveAlertRef.current = false;
            // Drop stale queued obstacle alerts once the obstacle is passed/cleared
            speechQueue.clearPendingNonDanger();
            emitObstaclesClearEvent();
          }
        }
        return;
      }

      clearFramesRef.current = 0;
      setActiveAlert((prev) =>
        prev &&
        prev.id === primaryThreat.id &&
        prev.severity === primaryThreat.severity &&
        prev.distanceMeters === primaryThreat.distanceMeters &&
        prev.messageRo === primaryThreat.messageRo
          ? prev
          : primaryThreat
      );

      const prevSpoken = spokenObstaclesRef.current.get(primaryThreat.id);
      const isNewObstacle = !prevSpoken;
      const escalatedToDanger =
        primaryThreat.severity === 'danger' && prevSpoken?.severity !== 'danger';
      const movedMuchCloser =
        prevSpoken &&
        primaryThreat.inCenterPath &&
        prevSpoken.distanceMeters - primaryThreat.distanceMeters >= 0.7 &&
        now - prevSpoken.time >= ALERT_COOLDOWN_MS;
      const longElapsed =
        prevSpoken &&
        primaryThreat.inCenterPath &&
        now - prevSpoken.time >= OBSTACLE_ID_REANNOUNCE_MS;
      if (!isNewObstacle && !escalatedToDanger && !movedMuchCloser && !longElapsed) return;

      // The tracker gives up an obstacle it loses for a few frames and assigns a fresh id
      // when it reappears, which reads as "new" and repeats the same warning. Hold a
      // short cooldown per class and side so one person weaving in and out of view is
      // announced once, not every time the box flickers.
      const kindKey = `${primaryThreat.class}|${primaryThreat.zone}`;
      const kindSpoken = spokenKindsRef.current.get(kindKey);
      if (
        kindSpoken &&
        now - kindSpoken.time < KIND_REPEAT_COOLDOWN_MS &&
        !(primaryThreat.severity === 'danger' && kindSpoken.severity !== 'danger')
      ) {
        return;
      }
      spokenKindsRef.current.set(kindKey, { severity: primaryThreat.severity, time: now });
      if (spokenKindsRef.current.size > 24) {
        spokenKindsRef.current.delete(spokenKindsRef.current.keys().next().value);
      }

      spokenObstaclesRef.current.set(primaryThreat.id, {
        severity: primaryThreat.severity,
        distanceMeters: primaryThreat.distanceMeters,
        time: now,
      });
      hadActiveAlertRef.current = true;

      const payload = {
        type: 'obstacle-alert',
        severity: primaryThreat.severity,
        obstacle: {
          class: primaryThreat.class,
          labelRo: primaryThreat.labelRo,
          trafficLightState: primaryThreat.trafficLightState,
          zone: primaryThreat.zone,
          zoneRo: primaryThreat.zoneRo,
          distanceMeters: primaryThreat.distanceMeters,
          isGrowing: primaryThreat.isGrowing,
          inCenterPath: primaryThreat.inCenterPath,
        },
        sidewalk,
        messageRo: primaryThreat.messageRo,
        timestamp: now,
        allObstacles: confirmedObstacles,
      };

      emitObstacleAlertEvent(payload);
      if (notifyAlert) notifyAlert(payload);

      // Skip when the sidewalk correction already spoke, and for traffic lights (announced above)
      if (!needsSidewalkWarning && primaryThreat.class !== 'traffic light' && voiceOn !== false) {
        const isDanger = primaryThreat.severity === 'danger';
        if (isDanger) playAlarmBeep();
        speechQueue.speak(primaryThreat.messageRo, { priority: isDanger ? 'danger' : 'high' });
      }
    };

    const detectFrame = (timestamp) => {
      if (session !== sessionRef.current) return; // loop superseded or stopped
      rafRef.current = requestAnimationFrame(detectFrame);

      const video = videoRef.current;
      if (
        document.hidden ||
        inferringRef.current ||
        !video ||
        video.readyState < 2 ||
        !modelRef.current ||
        timestamp - lastInferenceRef.current < INFERENCE_INTERVAL_MS
      ) {
        return;
      }

      // Never run two inferences at once: a slow device would otherwise queue them up and stutter
      inferringRef.current = true;
      lastInferenceRef.current = timestamp;
      runInference(video)
        .catch((err) => console.warn('Obstacle detection frame error:', err))
        .finally(() => {
          if (session === sessionRef.current) inferringRef.current = false;
        });
    };

    inferringRef.current = false;
    rafRef.current = requestAnimationFrame(detectFrame);
  }, [drawOverlay]);

  const startCamera = useCallback(
    async (requestedFacingMode = facingMode) => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      setError(null);

      // Unlock Web Audio + SpeechSynthesis synchronously on user gesture (required by iOS Safari)
      unlockAudioContext();
      speechQueue.unlock(true);

      // Orientation permission (iOS) — cached helper, never prompts twice
      requestOrientationPermission().then((res) => setOrientationPermission(res));

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Browserul nu suportă accesul la cameră (necesită HTTPS sau localhost).');
        isStartingRef.current = false;
        return;
      }

      // Stop previous tracks gently before requesting a new stream
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      try {
        if (!modelRef.current) {
          setModelLoading(true);
          modelRef.current = await loadObstacleModel();
          setModelReady(true);
          setModelLoading(false);
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: requestedFacingMode },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            if (playErr.name !== 'AbortError') {
              console.warn('Video play non-fatal warning:', playErr);
            }
          }
        }
        setCameraActive(true);
        startDetectionLoop();
      } catch (err) {
        setModelLoading(false);
        setCameraActive(false);
        if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
        console.error('Camera start error:', err);
        const errMsg = err.message || '';
        if (
          err.name === 'NotAllowedError' ||
          err.name === 'PermissionDeniedError' ||
          err.name === 'SecurityError' ||
          errMsg.toLowerCase().includes('not allowed') ||
          errMsg.toLowerCase().includes('denied')
        ) {
          setError('Permisiunea pentru cameră nu a putut fi accesată sau a fost refuzată de browser. Poți reîncerca permisiunea sau poți continua în modul Asistent Virtual.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError' || errMsg.toLowerCase().includes('not found')) {
          setError('Nu a fost detectată nicio cameră video pe acest dispozitiv.');
        } else if (err.name !== 'AbortError') {
          setError(`Nu s-a putut porni camera: ${errMsg || 'eroare necunoscută'}`);
        }
      } finally {
        isStartingRef.current = false;
      }
    },
    [facingMode, startDetectionLoop]
  );

  const startSimulatedAssistant = useCallback(() => {
    setError(null);
    setIsSimulatedMode(true);
    setCameraActive(true);
    const sidewalk = {
      action: 'straight',
      messageRo: 'Cale liberă înainte — Mod Asistent Virtual activ',
      confidence: 0.95,
      leftEdge: false,
      rightEdge: false,
    };
    setSidewalkStatus(sidewalk);
    setTimeout(() => {
      drawOverlay([], sidewalk, 640, 480);
    }, 80);
    if (voiceEnabled !== false) {
      speechQueue.speak('Mod Asistent Virtual activ.', { priority: 'normal' });
    }
  }, [drawOverlay, voiceEnabled]);

  // Auto-start camera cleanly once whenever isOpen transitions to true
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      startCamera();
    } else if (!isOpen && prevOpenRef.current) {
      stopCamera();
    }
    prevOpenRef.current = isOpen;
  }, [isOpen, startCamera, stopCamera]);

  const handleSwitchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    if (cameraActive) {
      startCamera(nextMode);
    }
  };

  if (!isOpen) return null;

  const panelWidth = isMobile
    ? 'calc(100vw - 24px)'
    : expanded ? 'min(94vw, 640px)' : 'min(92vw, 370px)';

  const containerStyle = isFullScreen
    ? {
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 1200,
        background: '#020617',
        color: '#f8fafc',
        borderRadius: 0,
        border: 'none',
        boxShadow: 'none',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        position: 'absolute',
        top: isMobile ? 60 : 74,
        left: isMobile ? 12 : 16,
        right: isMobile ? 12 : 'auto',
        width: panelWidth,
        maxWidth: isMobile ? 440 : 'none',
        margin: isMobile ? '0 auto' : 0,
        zIndex: 1050,
        background: '#0f172a',
        color: '#f8fafc',
        borderRadius: 18,
        border:
          tiltWarning || activeAlert?.severity === 'danger'
            ? '2.5px solid #ef4444'
            : activeAlert?.severity === 'approaching'
              ? '2.5px solid #f59e0b'
              : '1.5px solid rgba(255,255,255,0.14)',
        boxShadow: '0 20px 45px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
        transition: 'width 0.2s ease, border-color 0.2s ease',
      };

  return (
    <div
      role="region"
      aria-label="Detector obstacole cu cameră"
      style={containerStyle}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'rgba(15, 23, 42, 0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: cameraActive ? '#22c55e' : '#64748b',
              boxShadow: cameraActive ? '0 0 8px #22c55e' : 'none',
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2 }}>
            {isFullScreen && isNavigating ? 'Navigație Cameră Asistivă' : 'Asistent Cameră AI'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setOnlyThreats((prev) => !prev)}
            title={
              onlyThreats
                ? 'Filtru activ: doar obstacolele periculoase spre care te îndrepți'
                : 'Afișare totală: toate obiectele detectate'
            }
            aria-label="Comută filtru pericole apropiate"
            style={{
              ...iconButtonStyle,
              width: 'auto',
              padding: '0 8px',
              fontSize: 11,
              fontWeight: 700,
              background: onlyThreats ? 'rgba(37, 99, 235, 0.4)' : 'rgba(255, 255, 255, 0.1)',
              border: onlyThreats ? '1px solid #3b82f6' : '1px solid transparent',
              color: onlyThreats ? '#93c5fd' : '#cbd5e1',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {onlyThreats ? <Target size={12} /> : <Layers size={12} />}
              <span>{onlyThreats ? 'Doar pericole' : 'Toate detecțiile'}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={handleSwitchCamera}
            title="Schimbă camera (față / spate)"
            aria-label="Schimbă camera"
            style={iconButtonStyle}
          >
            <RefreshCw size={15} />
          </button>
          {onToggleFullScreen ? (
            <button
              type="button"
              onClick={() => onToggleFullScreen(!isFullScreen)}
              title={isFullScreen ? 'Comută pe vedere hartă' : 'Mărește camera pe tot ecranul'}
              aria-label={isFullScreen ? 'Comută pe vedere hartă' : 'Mărește camera pe tot ecranul'}
              style={{
                ...iconButtonStyle,
                ...(isFullScreen ? { width: 'auto', padding: '0 8px', gap: 4, background: '#2563eb', color: '#ffffff' } : {}),
              }}
            >
              {isFullScreen ? (
                <>
                  <MapIcon size={13} />
                  <span style={{ fontSize: 11, fontWeight: 700 }}>Hartă</span>
                </>
              ) : (
                <Maximize2 size={15} />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              title={expanded ? 'Micșorează fereastra' : 'Mărește fereastra'}
              aria-label={expanded ? 'Micșorează fereastra' : 'Mărește fereastra'}
              style={iconButtonStyle}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            title="Închide camera"
            aria-label="Închide camera"
            style={iconButtonStyle}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Nearby saved detour banner (for next users) */}
      {nearbyDetour && (
        <div
          style={{
            padding: '8px 12px',
            background: '#065f46',
            color: '#ecfdf5',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderBottom: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Route size={15} style={{ flexShrink: 0 }} />
          <span>
            Ocolire salvată la {nearbyDetour.distanceMeters}m ({nearbyDetour.detour.labelRo}) — urmează linia verde pe hartă!
          </span>
        </div>
      )}

      {/* Video + Canvas viewport */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          flex: isFullScreen ? 1 : 'none',
          height: isFullScreen ? '100%' : 'auto',
          aspectRatio: isFullScreen ? 'unset' : '4 / 3',
          background: '#020617',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraActive && !isSimulatedMode ? 'block' : 'none',
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            pointerEvents: 'none',
            display: cameraActive ? 'block' : 'none',
          }}
        />

        {/* Idle / Loading / Error states */}
        {!cameraActive && !modelLoading && !error && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Camera size={36} color="#60a5fa" style={{ marginBottom: 10 }} />
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#cbd5e1', lineHeight: 1.45 }}>
              Detectează obstacole, semafoare (roșu/verde) și marginile trotuarului în timp real.
            </p>
            <button
              type="button"
              onClick={() => startCamera()}
              style={{
                padding: '10px 20px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Camera size={17} />
              Pornește Camera
            </button>
          </div>
        )}

        {modelLoading && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Loader2 size={32} color="#60a5fa" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ margin: '10px 0 0', fontSize: 13, color: '#cbd5e1' }}>
              Se încarcă modelul de detecție AI...
            </p>
          </div>
        )}

        {error && (
          <div
            style={{
              textAlign: 'center',
              padding: '24px 20px',
              maxWidth: 380,
              width: 'calc(100% - 32px)',
              background: 'rgba(15, 23, 42, 0.95)',
              borderRadius: 16,
              border: '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
              zIndex: 10,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px',
              }}
            >
              <AlertTriangle size={22} color="#f87171" />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
              Acces Cameră Indisponibil
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45 }}>
              {error}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                onClick={() => startCamera()}
                style={{
                  padding: '10px 16px',
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <RefreshCw size={15} />
                Reîncearcă accesul la cameră
              </button>
              <button
                type="button"
                onClick={startSimulatedAssistant}
                style={{
                  padding: '9px 16px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#93c5fd',
                  border: '1px solid rgba(147, 197, 253, 0.25)',
                  borderRadius: 10,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Eye size={14} />
                Continuă în mod Asistent Virtual
              </button>
            </div>
          </div>
        )}

        {/* Phone tilt warning banner */}
        {tiltWarning && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              right: 12,
              zIndex: 1400,
              padding: '10px 14px',
              borderRadius: 12,
              background: 'rgba(220, 38, 38, 0.96)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 6px 20px rgba(220, 38, 38, 0.5)',
              border: '2px solid #ffffff',
              animation: 'pulse 1.2s infinite',
            }}
          >
            <Smartphone size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, lineHeight: 1.3 }}>{tiltMessage || 'Telefonul e înclinat prea în sus! Coboară-l spre trotuar.'}</span>
          </div>
        )}

        {/* iOS: tilt sensor needs an explicit tap to be enabled */}
        {isOpen && (orientationPermission === 'unknown' || orientationPermission === 'denied') && (
          <button
            type="button"
            onClick={() => {
              requestOrientationPermission().then((res) => setOrientationPermission(res));
            }}
            style={{
              position: 'absolute',
              top: tiltWarning ? 76 : 12,
              left: 12,
              zIndex: 1600,
              padding: '9px 12px',
              borderRadius: 10,
              border: '2px solid #ffffff',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            }}
          >
            {orientationPermission === 'denied'
              ? 'Senzor refuzat — închide Safari complet și reîncearcă'
              : 'Activează senzorul de înclinare'}
          </button>
        )}

        {/* DEBUG overlay — afișează valorile beta/gamma în timp real */}
        {isOpen && debugBeta !== null && (
          <div
            style={{
              position: 'absolute',
              top: tiltWarning ? 76 : 12,
              right: 12,
              zIndex: 1500,
              padding: '5px 10px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.72)',
              color: '#00ff88',
              fontSize: 12,
              fontFamily: 'monospace',
              fontWeight: 700,
              lineHeight: 1.5,
              pointerEvents: 'none',
            }}
          >
            <div>β={debugBeta}°</div>
            <div>γ={debugGamma}°</div>
          </div>
        )}

        {/* Crossing indicator. Map data when the route knows about the crossing, which
            carries a real distance and whether it has signals; otherwise the camera's
            own guess, worded as a possibility. */}
        {cameraActive && (crossingAhead || crosswalkAhead) && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1450,
              padding: '6px 12px',
              borderRadius: 10,
              background: crossingAhead
                ? 'rgba(37, 99, 235, 0.94)'
                : 'rgba(100, 116, 139, 0.94)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              textAlign: 'center',
              boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
              pointerEvents: 'none',
            }}
          >
            {crossingAhead
              ? `${crossingAhead.hasSignals ? 'Trecere cu semafor' : 'Trecere de pietoni'} · ${crossingAhead.distanceMeters} m`
              : 'Posibilă trecere de pietoni'}
          </div>
        )}

        {/* Live proximity / traffic light / sidewalk correction banner (when not navigating) */}
        {cameraActive && !isNavigating && (activeAlert || (sidewalkStatus && sidewalkStatus.action && sidewalkStatus.action !== 'straight')) && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              bottom: 10,
              left: 10,
              right: 10,
              padding: '9px 12px',
              borderRadius: 12,
              background:
                activeAlert?.severity === 'danger' || sidewalkStatus?.action === 'stop'
                  ? 'rgba(220, 38, 38, 0.94)'
                  : 'rgba(217, 119, 6, 0.94)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            }}
          >
            {sidewalkStatus?.action === 'steer_right' ? (
              <ArrowRight size={20} style={{ flexShrink: 0, color: '#fde047' }} />
            ) : sidewalkStatus?.action === 'steer_left' ? (
              <ArrowLeft size={20} style={{ flexShrink: 0, color: '#fde047' }} />
            ) : (
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            )}
            <span style={{ flex: 1, lineHeight: 1.35 }}>
              {activeAlert
                ? activeAlert.messageRo
                : (sidewalkStatus?.correctionRo || sidewalkStatus?.messageRo)}
            </span>
          </div>
        )}

        {/* Bottom Popup Navigation Commands */}
        {isNavigating && guidance && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: 'absolute',
              bottom: isMobile ? 12 : 20,
              left: isMobile ? 10 : 20,
              right: isMobile ? 10 : 20,
              maxWidth: isFullScreen ? (isMobile ? 'calc(100vw - 20px)' : 640) : 'none',
              margin: '0 auto',
              zIndex: 1250,
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderRadius: 22,
              border: guidance.isOffRoute
                ? '2.5px solid #ef4444'
                : activeAlert?.severity === 'danger'
                  ? '2.5px solid #ef4444'
                  : '2.5px solid #2563eb',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
              padding: isMobile ? '12px 14px' : '16px 20px',
              color: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              animation: 'slideUpNav 0.25s ease-out',
            }}
          >
            <style>{`
              @keyframes slideUpNav {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>

            {/* Sidewalk departure / danger alert pill inside popup if active */}
            {sidewalkStatus?.action && sidewalkStatus.action !== 'straight' && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(220, 38, 38, 0.4)',
                }}
              >
                <Footprints size={18} />
                <span>{sidewalkStatus.correctionRo}</span>
              </div>
            )}

            {activeAlert && (!sidewalkStatus || sidewalkStatus.action === 'straight') && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: activeAlert.severity === 'danger' ? '#dc2626' : '#d97706',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <ShieldAlert size={18} />
                <span>
                  {activeAlert.trafficLightState === 'red'
                    ? 'Semafor ROȘU pentru pietoni! Oprește-te.'
                    : activeAlert.trafficLightState === 'green'
                      ? 'Semafor VERDE! Poți traversa în siguranță.'
                      : `${activeAlert.labelRo} la ~${activeAlert.distanceMeters}m!`}
                </span>
              </div>
            )}

            {/* Primary Maneuver Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: isMobile ? 50 : 58,
                  height: isMobile ? 50 : 58,
                  borderRadius: 16,
                  background: guidance.activeStep?.maneuver === 'arrive' ? '#16a34a' : '#2563eb',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 16px rgba(37, 99, 235, 0.45)',
                }}
              >
                {getManeuverIcon(guidance.activeStep?.maneuver, isMobile ? 28 : 34)}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: isMobile ? 24 : 30,
                      fontWeight: 900,
                      color: guidance.isImminent ? '#4ade80' : '#ffffff',
                      letterSpacing: '-0.5px',
                    }}
                  >
                    {guidance.isImminent ? 'ACUM' : `${guidance.distToManeuver} m`}
                  </span>
                  {guidance.remainingDist != null && (
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      (total: {guidance.remainingDist >= 1000 ? `${(guidance.remainingDist / 1000).toFixed(1)} km` : `${guidance.remainingDist} m`})
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: isMobile ? 14.5 : 17,
                    fontWeight: 700,
                    color: '#f8fafc',
                    marginTop: 2,
                    lineHeight: 1.3,
                  }}
                >
                  {guidance.activeStep?.instructionRo || 'Continuați pe traseu'}
                </div>
              </div>
            </div>

            {/* Next step & Quick action buttons */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 8,
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: 12,
                color: '#94a3b8',
              }}
            >
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                {guidance.nextStep ? (
                  <span style={{ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    Urmează: <strong style={{ color: '#e2e8f0' }}>{guidance.nextStep.instructionRo}</strong>
                  </span>
                ) : (
                  <span>Destinația se apropie</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* Voice toggle */}
                <button
                  type="button"
                  onClick={onToggleVoice}
                  title={voiceEnabled ? 'Ghidare audio activă' : 'Ghidare audio oprită'}
                  style={miniControlBtnStyle}
                >
                  {voiceEnabled ? <Volume2 size={15} color="#4ade80" /> : <VolumeX size={15} color="#94a3b8" />}
                </button>

                {/* Demo simulation button */}
                {onToggleSimulation && (
                  <button
                    type="button"
                    onClick={onToggleSimulation}
                    title={isSimulating ? 'Oprește simularea' : 'Simulează mersul pe traseu (Demo)'}
                    style={{
                      ...miniControlBtnStyle,
                      background: isSimulating ? '#16a34a' : 'rgba(255, 255, 255, 0.12)',
                    }}
                  >
                    {isSimulating ? <Pause size={14} color="#ffffff" /> : <Play size={14} color="#38bdf8" />}
                  </button>
                )}

                {/* View map / minimize toggle */}
                {onToggleFullScreen && (
                  <button
                    type="button"
                    onClick={() => onToggleFullScreen(false)}
                    title="Vezi traseul pe hartă"
                    style={{
                      ...miniControlBtnStyle,
                      width: 'auto',
                      padding: '0 8px',
                      fontSize: 11.5,
                      fontWeight: 700,
                      gap: 4,
                      background: 'rgba(255, 255, 255, 0.12)',
                      color: '#ffffff',
                    }}
                  >
                    <MapIcon size={13} />
                    <span>Hartă</span>
                  </button>
                )}

                {/* Stop navigation */}
                {onStopNavigation && (
                  <button
                    type="button"
                    onClick={onStopNavigation}
                    title="Oprește navigarea"
                    style={{
                      ...miniControlBtnStyle,
                      background: 'rgba(239, 68, 68, 0.25)',
                      border: '1px solid #ef4444',
                      color: '#f87171',
                    }}
                  >
                    <Square size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detour toast */}
      {detourToast && (
        <div
          style={{
            padding: '7px 14px',
            background: '#16a34a',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <CheckCircle2 size={14} />
          <span>{detourToast}</span>
        </div>
      )}

      {/* Footer status & controls (only in windowed mode) */}
      {!isFullScreen && (
        <div
          style={{
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
            background: '#0f172a',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
            {cameraActive ? (
              activeAlert ? (
                <>
                  <Radio size={14} color="#ef4444" />
                  <span style={{ color: '#fca5a5', fontWeight: 600 }}>
                    Pericol apropiat ({detectedObstacles.length} {detectedObstacles.length === 1 ? 'obstacol' : 'obstacole'})
                  </span>
                </>
              ) : (
                <>
                  <ShieldCheck size={14} color="#4ade80" />
                  <span>
                    {sidewalkStatus?.messageRo || 'Cale liberă — Niciun pericol spre care te îndrepți'}
                  </span>
                </>
              )
            ) : (
              <span>{modelReady ? 'Model AI pregătit' : 'Cameră oprită'}</span>
            )}
          </div>

          {cameraActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {!isRecordingDetour ? (
                <button
                  type="button"
                  onClick={() => startDetourRecording(activeAlert)}
                  title="Începe înregistrarea traseului de ocolire pentru acest obstacol"
                  style={{
                    padding: '6px 10px',
                    background: '#1e293b',
                    color: '#93c5fd',
                    border: '1px solid #3b82f6',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Route size={13} />
                  Ocolire
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishDetourRecording}
                  style={{
                    padding: '6px 10px',
                    background: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <CheckCircle2 size={13} />
                  Salvează Ocolirea
                </button>
              )}

              <button
                type="button"
                onClick={stopCamera}
                style={{
                  padding: '6px 10px',
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <CameraOff size={13} />
                Oprește
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const miniControlBtnStyle = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: 'none',
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#e2e8f0',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
};

const iconButtonStyle = {
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#e2e8f0',
  border: 'none',
  borderRadius: 8,
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};
