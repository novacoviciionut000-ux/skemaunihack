import React, { useEffect, useRef } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  ArrowUpLeft,
  CornerUpRight,
  CornerUpLeft,
  RotateCw,
  RotateCcw,
  CheckCircle2,
  Navigation,
  Volume2,
  VolumeX,
  Crosshair,
  Play,
  Pause,
  X,
  AlertTriangle,
  Clock,
  Compass,
  Camera,
} from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';
import { speechQueue } from '../utils/speechQueue';

export function getManeuverIcon(maneuver, size = 26) {
  switch (maneuver) {
    case 'turn_right':
      return <CornerUpRight size={size} />;
    case 'slight_right':
      return <ArrowUpRight size={size} />;
    case 'sharp_right':
      return <RotateCw size={size} />;
    case 'turn_left':
      return <CornerUpLeft size={size} />;
    case 'slight_left':
      return <ArrowUpLeft size={size} />;
    case 'sharp_left':
      return <RotateCcw size={size} />;
    case 'arrive':
      return <CheckCircle2 size={size} />;
    case 'depart':
      return <Navigation size={size} />;
    case 'straight':
    default:
      return <ArrowUp size={size} />;
  }
}

export default function NavigationGuidance({
  guidance,
  isNavigating,
  onStopNavigation,
  voiceEnabled,
  onToggleVoice,
  followUser,
  onToggleFollowUser,
  isSimulating,
  onToggleSimulation,
  isCameraFullScreen,
  onOpenFullScreenCamera,
}) {
  const isMobile = useIsMobile();
  const lastSpokenRef = useRef({ text: '', stepId: null, milestone: null, time: 0 });

  // Romanian Voice TTS for Live Turn-by-Turn Guidance
  useEffect(() => {
    if (!isNavigating || !voiceEnabled || !guidance?.voicePrompt) return;
    if (!('speechSynthesis' in window)) return;

    const now = Date.now();
    const prompt = guidance.voicePrompt;
    const stepId = guidance.activeStep?.id;
    const dist = guidance.distToManeuver;
    const milestone = dist <= 15 ? 'now' : dist <= 40 ? 'close' : dist <= 85 ? 'medium' : 'far';

    // Speak when step changes, milestone changes, or text is different, with at least 5s cooldown
    const isNewMilestone = milestone !== lastSpokenRef.current.milestone;
    const isNewStep = stepId !== lastSpokenRef.current.stepId;
    const isCooldownElapsed = now - lastSpokenRef.current.time > 6000;

    if (!isNewStep && !isNewMilestone && !guidance.isImminent && !isCooldownElapsed) {
      return;
    }

    if (
      prompt === lastSpokenRef.current.text &&
      !isNewStep &&
      !guidance.isImminent &&
      now - lastSpokenRef.current.time < 9000
    ) {
      return;
    }

    lastSpokenRef.current = { text: prompt, stepId, milestone, time: now };
    speechQueue.speak(prompt, { priority: guidance.isImminent ? 'urgent' : 'high' });
  }, [
    guidance?.voicePrompt,
    guidance?.isImminent,
    guidance?.activeStep?.id,
    guidance?.distToManeuver,
    isNavigating,
    voiceEnabled,
  ]);

  // When camera is taking full screen, hide top HUD banner because commands
  // are displayed prominently in the bottom popup of the full screen camera!
  if (isCameraFullScreen) return null;

  if (!isNavigating || !guidance) return null;

  const {
    activeStep,
    nextStep,
    distToManeuver,
    remainingDist,
    remainingSeconds,
    isOffRoute,
  } = guidance;

  const formatDistance = (m) => {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
    return `${m} m`;
  };

  const formatDuration = (s) => {
    const mins = Math.max(1, Math.round(s / 60));
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const rem = mins % 60;
      return `${h}h ${rem}m`;
    }
    return `${mins} min`;
  };

  return (
    <div
      role="region"
      aria-label="Ghidare navigare în timp real"
      style={{
        position: 'absolute',
        top: isMobile ? 12 : 16,
        left: isMobile ? 12 : '50%',
        right: isMobile ? 12 : 'auto',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        zIndex: 1040,
        width: isMobile ? 'calc(100vw - 24px)' : 'min(94vw, 540px)',
        maxWidth: 540,
        margin: '0 auto',
        background: '#0f172a',
        color: '#ffffff',
        borderRadius: 20,
        border: isOffRoute ? '2px solid #ef4444' : '2px solid #2563eb',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
        animation: 'slideDown 0.25s ease-out',
      }}
    >
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: ${isMobile ? 'translateY(-15px)' : 'translate(-50%, -15px)'}; }
          to { opacity: 1; transform: ${isMobile ? 'translateY(0)' : 'translate(-50%, 0)'}; }
        }
      `}</style>

      {/* Off-route warning banner */}
      {isOffRoute && (
        <div
          style={{
            padding: '7px 12px',
            background: '#b91c1c',
            color: '#fef2f2',
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertTriangle size={15} />
          <span>Ai deviat de la traseu! Reorientează-te spre trotuarul indicat.</span>
        </div>
      )}

      {/* Main Maneuver Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 14px',
          gap: 12,
          background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
        }}
      >
        {/* Turn Direction Icon Badge */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: activeStep?.maneuver === 'arrive' ? '#16a34a' : '#2563eb',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
          }}
        >
          {getManeuverIcon(activeStep?.maneuver, 28)}
        </div>

        {/* Turn text & distance */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: '#60a5fa',
                letterSpacing: -0.5,
              }}
            >
              {formatDistance(distToManeuver)}
            </span>
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
              {activeStep?.shortRo || 'Pas următor'}
            </span>
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: '#f8fafc',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: 1,
            }}
          >
            {activeStep?.instructionRo || 'Continuă pe traseu'}
          </div>
        </div>

        {/* Exit Button */}
        <button
          onClick={onStopNavigation}
          title="Încheie navigarea"
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            borderRadius: 10,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#cbd5e1',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Next Step Preview (if available) */}
      {nextStep && (
        <div
          style={{
            padding: '6px 14px',
            background: 'rgba(30, 41, 59, 0.75)',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: 11.5,
            color: '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Apoi:</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {getManeuverIcon(nextStep.maneuver, 14)}
            <span>{nextStep.instructionRo}</span>
          </span>
        </div>
      )}

      {/* Bottom Status Bar: ETA, Remaining, Voice, Follow, Demo Simulation */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          background: '#090d16',
          fontSize: 12,
        }}
      >
        {/* Remaining ETA and Distance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#38bdf8', fontWeight: 700 }}>
            <Clock size={13} />
            <span>{formatDuration(remainingSeconds)}</span>
          </div>
          <span style={{ color: '#475569' }}>•</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#cbd5e1', fontWeight: 600 }}>
            <Navigation size={12} />
            <span>{formatDistance(remainingDist)}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Voice Prompt Toggle */}
          <button
            onClick={onToggleVoice}
            title={voiceEnabled ? 'Ghidare vocală activă (Română)' : 'Ghidare vocală oprită'}
            style={{
              ...actionBtnStyle,
              background: voiceEnabled ? '#2563eb' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
            }}
          >
            {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>

          {/* Follow User / Re-center Toggle */}
          <button
            onClick={onToggleFollowUser}
            title={followUser ? 'Urmărire automată hartă activă' : 'Centrează pe poziția ta'}
            style={{
              ...actionBtnStyle,
              background: followUser ? '#0284c7' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
            }}
          >
            <Compass size={14} />
          </button>

          {/* Switch to Full-Screen Camera Button */}
          {onOpenFullScreenCamera && (
            <button
              onClick={onOpenFullScreenCamera}
              title="Deschide camera pe tot ecranul"
              style={{
                ...actionBtnStyle,
                width: 'auto',
                padding: '0 8px',
                gap: 5,
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              <Camera size={13} />
              <span>Cameră</span>
            </button>
          )}

          {/* Demo Walk Simulation Button */}
          {onToggleSimulation && (
            <button
              onClick={onToggleSimulation}
              title={isSimulating ? 'Oprește simularea deplasării' : 'Simulează mersul pe traseu (Demo)'}
              style={{
                ...actionBtnStyle,
                width: 'auto',
                padding: '0 8px',
                gap: 4,
                background: isSimulating ? '#16a34a' : 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                fontWeight: 700,
              }}
            >
              {isSimulating ? <Pause size={12} /> : <Play size={12} />}
              <span>{isSimulating ? 'Pauză Demo' : 'Simulare'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const actionBtnStyle = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  fontSize: 11,
};
