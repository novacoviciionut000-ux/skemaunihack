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
import {
  loadObstacleModel,
  captureFrameSample,
  analyzeDetections,
  analyzeSidewalkPath,
  emitObstacleAlertEvent,
  emitObstaclesClearEvent,
  emitSidewalkStatusEvent,
  emitTiltWarningEvent,
} from '../utils/obstacleDetector';
import { distanceMetersBetween } from '../utils/detourStore';
import { useIsMobile } from '../hooks/useIsMobile';

const SEVERITY_COLORS = {
  danger: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', badgeBg: '#dc2626' },
  approaching: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', badgeBg: '#d97706' },
  far: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.10)', badgeBg: '#2563eb' },
};

const INFERENCE_INTERVAL_MS = 180;
const ALERT_COOLDOWN_MS = 3000;
const TILT_VIBRATE_COOLDOWN_MS = 2500;
const SIDEWALK_EVENT_COOLDOWN_MS = 3500;
const TILT_UP_ENTER_DEG = 92; // >92 deg means phone is tilted too far upward (sky)
const TILT_UP_EXIT_DEG = 85;
const TILT_DOWN_ENTER_DEG = 18; // <18 deg means phone is pointing straight down at feet
const TILT_DOWN_EXIT_DEG = 24;
const TILT_ROLL_ENTER_DEG = 40; // |gamma| > 40 deg means phone is tilted sideways
const TILT_ROLL_EXIT_DEG = 32;

function playTiltFeedbackTone(audioCtx) {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    // Two short gentle low-mid pulses (works on iPhone where navigator.vibrate is unsupported)
    [0, 0.14].forEach((offset, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 300 : 240, now + offset);
      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.095);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.1);
    });
  } catch {
    // Ignore audio errors if blocked
  }
}

export default function CameraObstacleDetector({
  isOpen,
  onClose,
  onObstacleAlert,
  onObstaclesUpdate,
  userLocation,
  nearbyDetour,
  onDetourSaved,
  // Navigation & Full-Screen props
  isFullScreen = false,
  onToggleFullScreen,
  isNavigating = false,
  guidance = null,
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
  const lastAlertRef = useRef({ key: '', severity: '', time: 0 });
  const lastTiltVibrateRef = useRef(0);
  const lastTiltSpokenRef = useRef({ reason: null, time: 0 });
  const tiltSmoothedRef = useRef({ beta: null, gamma: null, activeReason: null });
  const audioCtxRef = useRef(null);
  const lastSidewalkEventRef = useRef({ status: '', time: 0 });
  const hadActiveAlertRef = useRef(false);

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
  const [tiltWarning, setTiltWarning] = useState(false);
  const [tiltMessage, setTiltMessage] = useState('');
  const [isRecordingDetour, setIsRecordingDetour] = useState(false);
  const [detourToast, setDetourToast] = useState('');

  const stopCamera = useCallback(() => {
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
    prevObstaclesRef.current = [];
    prevSidewalkRef.current = null;
    clearFramesRef.current = 0;
    tiltSmoothedRef.current = { beta: null, gamma: null, activeReason: null };
    lastTiltSpokenRef.current = { reason: null, time: 0 };
    setCameraActive(false);
    setDetectedObstacles([]);
    setActiveAlert(null);
    setSidewalkStatus(null);
    setTiltWarning(false);
    setTiltMessage('');
  }, []);

  // Phone tilt detection (DeviceOrientationEvent) + vibration / iOS audio pulse
  useEffect(() => {
    if (!isOpen || !cameraActive) {
      setTiltWarning(false);
      setTiltMessage('');
      return;
    }

    const handleOrientation = (event) => {
      if (event.beta == null) return;
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

      const now = Date.now();

      if (isTilted) {
        const msg =
          reason === 'up'
            ? 'Telefonul e înclinat prea în sus! Coboară-l ușor spre trotuar.'
            : reason === 'down'
              ? 'Telefonul e înclinat prea în jos! Ridică-l ușor spre înainte.'
              : 'Telefonul e înclinat într-o parte! Ține-l drept spre trotuar.';
        setTiltMessage(msg);

        if (now - lastTiltVibrateRef.current >= TILT_VIBRATE_COOLDOWN_MS) {
          lastTiltVibrateRef.current = now;
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate([200, 90, 200]);
          }
          // iPhone/iOS Safari does not support navigator.vibrate, so play subtle audio pulse
          playTiltFeedbackTone(audioCtxRef.current);
          emitTiltWarningEvent({
            beta: Math.round(beta),
            gamma: Math.round(state.gamma),
            reason,
            messageRo: msg,
            timestamp: now,
          });
        }

        // Avertizare vocală audio (TTS) în limba română pentru poziția telefonului
        const isNewTiltReason = lastTiltSpokenRef.current.reason !== reason;
        const isTiltVoiceCooldownElapsed = now - lastTiltSpokenRef.current.time >= 4000;
        if ((isNewTiltReason || isTiltVoiceCooldownElapsed) && voiceEnabled !== false) {
          lastTiltSpokenRef.current = { reason, time: now };
          if ('speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel();
              const utt = new SpeechSynthesisUtterance(msg);
              utt.lang = 'ro-RO';
              utt.rate = 1.05;
              window.speechSynthesis.speak(utt);
            } catch (err) {
              console.warn('Tilt warning speech synthesis error:', err);
            }
          }
        }
      } else {
        setTiltMessage('');
        // Dacă telefonul a fost înclinat și utilizatorul l-a readus în poziție corectă, oferim confirmare audio
        if (lastTiltSpokenRef.current.reason) {
          lastTiltSpokenRef.current = { reason: null, time: now };
          if ('speechSynthesis' in window && voiceEnabled !== false) {
            try {
              window.speechSynthesis.cancel();
              const utt = new SpeechSynthesisUtterance('Poziție corectă a telefonului.');
              utt.lang = 'ro-RO';
              utt.rate = 1.1;
              window.speechSynthesis.speak(utt);
            } catch {}
          }
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [isOpen, cameraActive, voiceEnabled]);

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
    const detectFrame = async (timestamp) => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !modelRef.current) {
        rafRef.current = requestAnimationFrame(detectFrame);
        return;
      }

      if (timestamp - lastInferenceRef.current >= INFERENCE_INTERVAL_MS) {
        lastInferenceRef.current = timestamp;
        try {
          const frameSample = captureFrameSample(video, 160, 120);
          const predictions = await modelRef.current.detect(video);
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 480;

          const analyzed = analyzeDetections(
            predictions,
            width,
            height,
            prevObstaclesRef.current,
            frameSample
          );
          prevObstaclesRef.current = analyzed;

          // Surface ONLY obstacles that represent active dangers / approaching collision threats
          // unless user toggles to show all raw detections
          const confirmedObstacles = analyzed.filter(
            (o) => o.isConfirmed && (onlyThreatsRef.current ? o.isThreat : true)
          );

          const sidewalk = analyzeSidewalkPath(
            frameSample,
            confirmedObstacles,
            prevSidewalkRef.current
          );
          prevSidewalkRef.current = sidewalk;
          setSidewalkStatus(sidewalk);

          const now = Date.now();
          const needsSidewalkWarning =
            sidewalk.action &&
            sidewalk.action !== 'straight' &&
            sidewalk.action !== 'unknown';

          if (
            needsSidewalkWarning &&
            (sidewalk.action !== lastSidewalkEventRef.current.action ||
              now - lastSidewalkEventRef.current.time >= SIDEWALK_EVENT_COOLDOWN_MS)
          ) {
            lastSidewalkEventRef.current = { action: sidewalk.action, time: now };
            emitSidewalkStatusEvent({ ...sidewalk, timestamp: now });

            // Audible warning and safe direction correction for visually impaired user
            if ('speechSynthesis' in window) {
              try {
                window.speechSynthesis.cancel();
                const utt = new SpeechSynthesisUtterance(sidewalk.correctionRo);
                utt.lang = 'ro-RO';
                utt.rate = 1.05;
                window.speechSynthesis.speak(utt);
              } catch {}
            }
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
              navigator.vibrate([220, 90, 220]);
            }
          }

          setDetectedObstacles(confirmedObstacles);
          drawOverlay(confirmedObstacles, sidewalk, width, height);
          if (onObstaclesUpdate) onObstaclesUpdate(confirmedObstacles);

          const primaryThreat = confirmedObstacles.find(
            (o) => o.severity === 'danger' || o.severity === 'approaching'
          );

          if (primaryThreat) {
            clearFramesRef.current = 0;
            setActiveAlert(primaryThreat);
            const alertKey = `${primaryThreat.class}:${primaryThreat.trafficLightState || ''}:${primaryThreat.zone}`;
            const escalated =
              primaryThreat.severity === 'danger' &&
              lastAlertRef.current.severity !== 'danger';
            const cooldownElapsed = now - lastAlertRef.current.time >= ALERT_COOLDOWN_MS;

            if (alertKey !== lastAlertRef.current.key || escalated || cooldownElapsed) {
              lastAlertRef.current = {
                key: alertKey,
                severity: primaryThreat.severity,
                time: now,
              };
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
              if (onObstacleAlert) onObstacleAlert(payload);

              // Avertizare vocală audio pentru obstacole și semafoare dacă nu se rostește deja avertizarea de trotuar
              if (!needsSidewalkWarning && 'speechSynthesis' in window && voiceEnabled !== false) {
                try {
                  window.speechSynthesis.cancel();
                  const utt = new SpeechSynthesisUtterance(primaryThreat.messageRo);
                  utt.lang = 'ro-RO';
                  utt.rate = 1.05;
                  window.speechSynthesis.speak(utt);
                } catch {}
              }
            }
          } else {
            clearFramesRef.current += 1;
            if (clearFramesRef.current >= 4) {
              setActiveAlert(null);
              if (hadActiveAlertRef.current) {
                hadActiveAlertRef.current = false;
                emitObstaclesClearEvent();
              }
            }
          }
        } catch (err) {
          console.warn('Obstacle detection frame error:', err);
        }
      }

      rafRef.current = requestAnimationFrame(detectFrame);
    };

    rafRef.current = requestAnimationFrame(detectFrame);
  }, [drawOverlay, onObstacleAlert, onObstaclesUpdate]);

  const startCamera = useCallback(
    async (requestedFacingMode = facingMode) => {
      setError(null);

      // Unlock Web Audio on user gesture (used for iPhone tilt feedback since iOS lacks navigator.vibrate)
      if (!audioCtxRef.current && typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          try {
            audioCtxRef.current = new AudioCtx();
          } catch {
            // Non-fatal
          }
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }

      // Request iOS 13+ DeviceOrientation permission on user gesture if needed
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        try {
          await DeviceOrientationEvent.requestPermission();
        } catch {
          // Non-fatal if user declines orientation permission
        }
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Browserul nu suportă accesul la cameră (necesită HTTPS sau localhost).');
        return;
      }

      stopCamera();

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
          await videoRef.current.play();
        }
        setCameraActive(true);
        startDetectionLoop();
      } catch (err) {
        setModelLoading(false);
        console.error('Camera start error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Permisiunea pentru cameră a fost refuzată. Activează accesul la cameră din setările browserului.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('Nu a fost detectată nicio cameră pe acest dispozitiv.');
        } else {
          setError(`Nu s-a putut porni camera: ${err.message || 'eroare necunoscută'}`);
        }
      }
    },
    [facingMode, startDetectionLoop, stopCamera]
  );

  // Auto-start camera when isOpen is set to true
  useEffect(() => {
    if (isOpen && !cameraActive && !modelLoading && !error) {
      startCamera();
    }
  }, [isOpen, cameraActive, modelLoading, error, startCamera]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
    }
    return () => stopCamera();
  }, [isOpen, stopCamera]);

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
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraActive ? 'block' : 'none',
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
          <div style={{ textAlign: 'center', padding: 18 }}>
            <AlertTriangle size={30} color="#f87171" style={{ marginBottom: 8 }} />
            <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#fca5a5', lineHeight: 1.4 }}>
              {error}
            </p>
            <button
              type="button"
              onClick={() => startCamera()}
              style={{
                padding: '8px 16px',
                background: '#334155',
                color: '#ffffff',
                border: 'none',
                borderRadius: 10,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Încearcă din nou
            </button>
          </div>
        )}

        {/* Phone tilt warning banner */}
        {cameraActive && tiltWarning && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              right: 10,
              padding: '8px 12px',
              borderRadius: 10,
              background: 'rgba(185, 28, 28, 0.94)',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            }}
          >
            <Smartphone size={16} style={{ flexShrink: 0 }} />
            <span>{tiltMessage || 'Telefonul e înclinat prea în sus! Coboară-l spre trotuar.'}</span>
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
