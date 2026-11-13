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
} from 'lucide-react';
import {
  loadObstacleModel,
  analyzeDetections,
  emitObstacleAlertEvent,
  emitObstaclesClearEvent,
} from '../utils/obstacleDetector';

const SEVERITY_COLORS = {
  danger: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.18)', badgeBg: '#dc2626' },
  approaching: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.15)', badgeBg: '#d97706' },
  far: { stroke: '#3b82f6', fill: 'rgba(59, 130, 246, 0.10)', badgeBg: '#2563eb' },
};

const INFERENCE_INTERVAL_MS = 180;
const ALERT_COOLDOWN_MS = 1800;

export default function CameraObstacleDetector({
  isOpen,
  onClose,
  onObstacleAlert,
  onObstaclesUpdate,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const modelRef = useRef(null);
  const rafRef = useRef(null);
  const lastInferenceRef = useRef(0);
  const prevObstaclesRef = useRef([]);
  const lastAlertRef = useRef({ key: '', severity: '', time: 0 });
  const hadActiveAlertRef = useRef(false);

  const [facingMode, setFacingMode] = useState('environment');
  const [cameraActive, setCameraActive] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [detectedObstacles, setDetectedObstacles] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);

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
    setCameraActive(false);
    setDetectedObstacles([]);
    setActiveAlert(null);
  }, []);

  const drawOverlay = useCallback((obstacles, width, height) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // Subtle central walking corridor guide lines (28% - 72%)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
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
      const palette = SEVERITY_COLORS[obs.severity] || SEVERITY_COLORS.far;

      ctx.fillStyle = palette.fill;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = obs.severity === 'danger' ? 3.5 : 2.5;
      ctx.strokeRect(x, y, w, h);

      const label = `${obs.labelRo} • ~${obs.distanceMeters}m`;
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
          const predictions = await modelRef.current.detect(video);
          const width = video.videoWidth || 640;
          const height = video.videoHeight || 480;

          const analyzed = analyzeDetections(
            predictions,
            width,
            height,
            prevObstaclesRef.current
          );
          prevObstaclesRef.current = analyzed;

          setDetectedObstacles(analyzed);
          drawOverlay(analyzed, width, height);
          if (onObstaclesUpdate) onObstaclesUpdate(analyzed);

          const primaryThreat = analyzed.find(
            (o) => o.severity === 'danger' || o.severity === 'approaching'
          );

          if (primaryThreat) {
            setActiveAlert(primaryThreat);
            const now = Date.now();
            const alertKey = `${primaryThreat.class}:${primaryThreat.zone}`;
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
                  zone: primaryThreat.zone,
                  zoneRo: primaryThreat.zoneRo,
                  distanceMeters: primaryThreat.distanceMeters,
                  isGrowing: primaryThreat.isGrowing,
                  inCenterPath: primaryThreat.inCenterPath,
                },
                messageRo: primaryThreat.messageRo,
                timestamp: now,
                allObstacles: analyzed,
              };

              emitObstacleAlertEvent(payload);
              if (onObstacleAlert) onObstacleAlert(payload);
            }
          } else {
            setActiveAlert(null);
            if (hadActiveAlertRef.current) {
              hadActiveAlertRef.current = false;
              emitObstaclesClearEvent();
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

  // Stop camera when panel closes or component unmounts
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

  const panelWidth = expanded ? 'min(94vw, 640px)' : 'min(92vw, 360px)';

  return (
    <div
      role="region"
      aria-label="Detector obstacole cu cameră"
      style={{
        position: 'absolute',
        top: 74,
        left: 16,
        width: panelWidth,
        zIndex: 1050,
        background: '#0f172a',
        color: '#f8fafc',
        borderRadius: 18,
        border: activeAlert?.severity === 'danger'
          ? '2.5px solid #ef4444'
          : activeAlert?.severity === 'approaching'
            ? '2.5px solid #f59e0b'
            : '1.5px solid rgba(255,255,255,0.14)',
        boxShadow: '0 20px 45px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
        transition: 'width 0.2s ease, border-color 0.2s ease',
      }}
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
            Detecție Obstacole Cameră
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={handleSwitchCamera}
            title="Schimbă camera (față / spate)"
            aria-label="Schimbă camera"
            style={iconButtonStyle}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? 'Micșorează fereastra' : 'Mărește fereastra'}
            aria-label={expanded ? 'Micșorează fereastra' : 'Mărește fereastra'}
            style={iconButtonStyle}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
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

      {/* Video + Canvas viewport */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          background: '#020617',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
              Pornește camera pentru a detecta obstacolele din față în timp real.
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

        {/* Live proximity alert banner */}
        {cameraActive && activeAlert && (
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
                activeAlert.severity === 'danger'
                  ? 'rgba(220, 38, 38, 0.92)'
                  : 'rgba(217, 119, 6, 0.92)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{activeAlert.messageRo}</span>
          </div>
        )}
      </div>

      {/* Footer status & controls */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: '#0f172a',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
          {cameraActive ? (
            activeAlert ? (
              <>
                <Radio size={14} color="#fbbf24" />
                <span style={{ color: '#fde68a', fontWeight: 600 }}>
                  Alertă emisă ({detectedObstacles.length} obj.)
                </span>
              </>
            ) : (
              <>
                <ShieldCheck size={14} color="#4ade80" />
                <span>
                  {detectedObstacles.length > 0
                    ? `${detectedObstacles.length} obstacol(e) la distanță sigură`
                    : 'Cale liberă în față'}
                </span>
              </>
            )
          ) : (
            <span>{modelReady ? 'Model AI pregătit' : 'Cameră oprită'}</span>
          )}
        </div>

        {cameraActive && (
          <button
            type="button"
            onClick={stopCamera}
            style={{
              padding: '6px 12px',
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CameraOff size={14} />
            Oprește
          </button>
        )}
      </div>
    </div>
  );
}

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
