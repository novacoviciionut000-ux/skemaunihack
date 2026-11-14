import { useState, useEffect, useRef } from 'react';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';
import { findClosestPlace, formatDistance } from '../api/client';
import { speechQueue, playListenBeep, unlockAudioContext } from '../utils/speechQueue';

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 40; // max distance between the two taps
const TAP_MOVE_PX = 15; // more movement than this is a drag/pan, not a tap

function isTextInput(el) {
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function spokenDistance(meters) {
  if (meters == null) return '';
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1).replace('.', ',')} kilometri`
    : `${Math.max(10, Math.round(meters / 10) * 10)} de metri`;
}

export default function VoiceButton({
  onDestinationSet,
  onEmergency,
  onCameraOpen,
  onCameraClose,
  onStartNavigation,
  onCancelRoute,
  routeData,
  userLocation,
}) {
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('info'); // 'info' | 'success' | 'error'
  const [alwaysOn, setAlwaysOn] = useState(false);

  // ── Destinație vocală: cea mai apropiată potrivire, ruta pornește imediat ──
  const lookupIdRef = useRef(0);
  const handleDestinationRecognized = async (spokenAddress) => {
    const lookupId = ++lookupIdRef.current;
    setStatusMessage(`Caut cel mai apropiat: "${spokenAddress}"...`);
    setStatusType('info');

    try {
      const place = await findClosestPlace(spokenAddress, userLocation);
      if (lookupId !== lookupIdRef.current) return; // a newer command superseded this one

      if (!place) {
        speak(`Nu am găsit ${spokenAddress}. Încearcă un nume sau o adresă mai precisă.`, { interrupt: true });
        setStatusMessage(`Negăsit: "${spokenAddress}"`);
        setStatusType('error');
        return;
      }

      setStatusMessage(`Rută către ${place.shortName} (${formatDistance(place.distanceMeters)})`);
      setStatusType('success');
      speak(
        `Pornesc ruta către ${place.shortName}, la ${spokenDistance(place.distanceMeters)}. Spune Anulează ruta pentru a opri.`,
        { interrupt: true }
      );
      if (onDestinationSet) {
        onDestinationSet({ name: place.displayName, shortName: place.shortName, lat: place.lat, lng: place.lng });
      }
    } catch (err) {
      console.error('Place search error:', err);
      speak('Eroare de conexiune. Verifică internetul și încearcă din nou.', { interrupt: true });
      setStatusMessage('Eroare de conexiune');
      setStatusType('error');
    }
  };

  const handleStatusQuery = () => {
    if (!routeData) {
      speak('Nu ai o rută activă momentan. Spune unde vrei să mergi.', { interrupt: true });
      setStatusMessage('Nicio rută activă');
      setStatusType('info');
      return;
    }
    const dist = Math.round(routeData.distanceMeters || 0);
    const mins = routeData.timeSeconds ? Math.max(1, Math.round(routeData.timeSeconds / 60)) : null;
    const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} kilometri` : `${dist} metri`;
    const msg = mins
      ? `Mai ai aproximativ ${distText}, circa ${mins} minute.`
      : `Distanța rutei este de ${distText}.`;
    setStatusMessage(msg);
    setStatusType('info');
    speak(msg, { interrupt: true });
  };

  const {
    isListening,
    transcript,
    error,
    permissionGranted,
    speak,
    startListening,
    stopListening,
    startAlwaysOn,
    stopAlwaysOn,
  } = useVoiceAssistant({
    onDestinationRecognized: handleDestinationRecognized,
    onEmergency: () => {
      setStatusMessage('Urgență 112 activată');
      setStatusType('error');
      if (onEmergency) onEmergency();
    },
    onCameraOpen: () => {
      setStatusMessage('Cameră activă');
      setStatusType('success');
      if (onCameraOpen) onCameraOpen();
    },
    onCameraClose: () => {
      setStatusMessage('Cameră oprită');
      setStatusType('info');
      if (onCameraClose) onCameraClose();
    },
    onStartNavigation: () => {
      setStatusMessage('Navigare în timp real activă');
      setStatusType('success');
      if (onStartNavigation) onStartNavigation();
    },
    onCancelRoute: () => {
      lookupIdRef.current += 1; // drop a search still in flight
      setStatusMessage('Rută anulată');
      setStatusType('info');
      if (onCancelRoute) onCancelRoute();
    },
    onStatusQuery: handleStatusQuery,
    alwaysOn: false, // controlăm manual din UI
  });

  // Afișăm erorile hook-ului
  useEffect(() => {
    if (error) {
      setStatusMessage(error);
      setStatusType('error');
    }
  }, [error]);

  // ── Toggle always-on ──────────────────────────────────────────────────
  const handleToggleAlwaysOn = () => {
    if (alwaysOn) {
      stopAlwaysOn();
      setAlwaysOn(false);
      setStatusMessage('Microfon oprit');
      setStatusType('info');
    } else {
      setAlwaysOn(true);
      setStatusMessage('Ascultare permanentă activă...');
      setStatusType('success');
      speak('Asistent vocal activat. Poți spune comenzi oricând.', {
        interrupt: true,
        onEnd: () => startAlwaysOn(),
      });
    }
  };

  // ── Apăsare o singură dată ─────────────────────────────────────────────
  const handlePressOnce = () => {
    if (isListening && !alwaysOn) {
      stopListening();
      setStatusMessage('');
      return;
    }
    if (alwaysOn) return; // în always-on, butonul de o singură dată nu face nimic
    setStatusMessage('');
    speak('Spune comanda.', {
      interrupt: true,
      onEnd: () => startListening(),
    });
  };

  // ── Atingere dublă oriunde pe ecran → pornește recunoașterea vocală ─────
  const voiceStateRef = useRef({});
  voiceStateRef.current = { isListening, alwaysOn, startListening };

  useEffect(() => {
    let down = null; // pointerdown position, to tell taps from drags
    let lastTap = null; // { time, x, y }
    let swallowClickUntil = 0;

    const onPointerDown = (e) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    };

    const onPointerUp = (e) => {
      if (!e.isPrimary || !down || e.button > 0 || isTextInput(e.target)) {
        lastTap = null;
        return;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_MOVE_PX;
      down = null;
      if (moved) {
        lastTap = null;
        return;
      }

      const now = performance.now();
      const isDouble =
        lastTap &&
        now - lastTap.time <= DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DOUBLE_TAP_SLOP_PX;

      if (!isDouble) {
        lastTap = { time: now, x: e.clientX, y: e.clientY };
        return;
      }
      lastTap = null;
      // The second tap must not also press whatever is under the finger
      swallowClickUntil = now + 500;
      e.preventDefault();

      const { isListening: listening, alwaysOn: on, startListening: start } = voiceStateRef.current;
      if (listening || on) return;

      // Runs inside the gesture, which mobile browsers require for mic + audio
      unlockAudioContext();
      speechQueue.unlock();
      speechQueue.cancel(); // stop talking so the microphone doesn't hear the app
      playListenBeep();
      if (navigator.vibrate) navigator.vibrate(40);
      setStatusMessage('Ascult... spune comanda');
      setStatusType('info');
      start();
    };

    const swallow = (e) => {
      if (performance.now() < swallowClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Double-tap now means "voice command", so map double-click zoom must not fire too
    const blockDblClick = (e) => {
      if (!isTextInput(e.target)) e.stopPropagation();
    };

    const opts = { capture: true };
    window.addEventListener('pointerdown', onPointerDown, opts);
    window.addEventListener('pointerup', onPointerUp, opts);
    window.addEventListener('click', swallow, opts);
    window.addEventListener('dblclick', blockDblClick, opts);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, opts);
      window.removeEventListener('pointerup', onPointerUp, opts);
      window.removeEventListener('click', swallow, opts);
      window.removeEventListener('dblclick', blockDblClick, opts);
    };
  }, []);

  // ── Stiluri ────────────────────────────────────────────────────────────
  const statusColors = {
    info:    { background: 'rgba(15,23,42,0.85)', color: '#93C5FD' },
    success: { background: 'rgba(15,23,42,0.85)', color: '#4ADE80' },
    error:   { background: 'rgba(15,23,42,0.85)', color: '#F87171' },
  };
  const sc = statusColors[statusType] || statusColors.info;

  const btnColor = alwaysOn
    ? (isListening ? '#16a34a' : '#15803d')
    : (isListening ? '#EF4444' : '#2563EB');

  const btnShadow = alwaysOn
    ? (isListening
        ? '0 0 0 4px rgba(22,163,74,0.35), 0 4px 16px rgba(22,163,74,0.5)'
        : '0 4px 16px rgba(21,128,61,0.4)')
    : (isListening
        ? '0 0 0 4px rgba(239,68,68,0.35), 0 4px 16px rgba(239,68,68,0.5)'
        : '0 4px 16px rgba(37,99,235,0.4)');

  const btnLabel = alwaysOn
    ? (isListening ? 'Ascult...' : 'Mereu activ — aștept comandă')
    : (isListening ? 'Ascult... (apasă pt a opri)' : 'Apasă și spune comanda');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        padding: '0 12px 12px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Buton principal o singură dată ── */}
      <button
        onClick={handlePressOnce}
        disabled={alwaysOn}
        aria-label={isListening ? 'Oprește ascultarea vocală' : 'Activează comanda vocală'}
        style={{
          width: '100%',
          minHeight: '58px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          backgroundColor: btnColor,
          color: '#FFFFFF',
          fontSize: '0.95rem',
          fontWeight: '700',
          border: 'none',
          borderRadius: '14px',
          cursor: alwaysOn ? 'default' : 'pointer',
          opacity: alwaysOn ? 0.6 : 1,
          boxShadow: btnShadow,
          transition: 'background 0.2s, box-shadow 0.2s',
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
        }}
      >
        {/* Iconiță SVG microfon cu animație puls */}
        <svg
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            animation: isListening ? 'micPulse 0.75s ease-in-out infinite alternate' : 'none',
          }}
        >
          <rect x="9" y="1" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0014 0" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        {btnLabel}
      </button>

      {/* ── Toggle always-on ── */}
      <button
        onClick={handleToggleAlwaysOn}
        aria-label={alwaysOn ? 'Dezactivează microfonul permanent' : 'Activează microfonul permanent (always-on)'}
        style={{
          width: '100%',
          minHeight: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          backgroundColor: alwaysOn ? '#064e3b' : '#1e293b',
          color: alwaysOn ? '#6ee7b7' : '#94a3b8',
          fontSize: '0.82rem',
          fontWeight: '600',
          border: `1px solid ${alwaysOn ? '#10b981' : '#334155'}`,
          borderRadius: '12px',
          cursor: 'pointer',
          transition: 'all 0.2s',
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
        }}
      >
        {/* Iconiță radio wave */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M2 12C2 12 5 5 12 5s10 7 10 7" opacity="0.4"/>
          <path d="M5 12c0 0 2-4 7-4s7 4 7 4" opacity="0.65"/>
          <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </svg>
        {alwaysOn
          ? 'Microfon mereu activ — apasă pentru a opri'
          : 'Activează microfon permanent'}
      </button>

      {/* ── Indicator permisiune microfon ── */}
      {permissionGranted === false && (
        <div style={{
          padding: '7px 10px', borderRadius: 10, fontSize: '0.78rem',
          fontWeight: 600, background: 'rgba(239,68,68,0.15)',
          color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)',
          fontFamily: 'system-ui, sans-serif',
        }}>
          Permisiune microfon refuzată — apasă pictograma de blocare din bara browserului și permite microfonul.
        </div>
      )}

      {/* ── Status / feedback ── */}
      {statusMessage && (
        <div style={{
          padding: '8px 12px', borderRadius: '10px',
          fontSize: '0.83rem', fontWeight: '600',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center', ...sc,
        }}>
          {statusMessage}
        </div>
      )}

      {/* ── Transcript ultima recunoaștere ── */}
      {transcript && !isListening && (
        <div style={{
          padding: '5px 10px', borderRadius: 8,
          fontSize: '0.78rem', color: '#64748b',
          fontFamily: 'system-ui, sans-serif',
          fontStyle: 'italic', textAlign: 'center',
        }}>
          Am auzit: &ldquo;{transcript}&rdquo;
        </div>
      )}

      {/* ── Hint comenzi ── */}
      {!isListening && !statusMessage && (
        <p style={{
          margin: 0, textAlign: 'center',
          fontSize: '0.76rem', color: '#64748b',
          fontFamily: 'system-ui, sans-serif', lineHeight: 1.5,
        }}>
          Atinge de două ori oriunde pentru comenzi vocale.
          <br />
          &ldquo;Du-mă la Kaufland&rdquo;
          {' · '}&ldquo;Deschide camera&rdquo;
          {' · '}&ldquo;112&rdquo;
        </p>
      )}

      {/* ── CSS animații ── */}
      <style>{`
        @keyframes micPulse {
          from { transform: scale(1); opacity: 1; }
          to   { transform: scale(1.3); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
