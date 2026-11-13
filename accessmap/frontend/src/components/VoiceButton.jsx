import { useState, useEffect } from 'react';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';
import { geocodeAddress } from '../api/client';

export default function VoiceButton({ onDestinationSet, onEmergency, onCameraOpen, onCameraClose }) {
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('info'); // 'info' | 'success' | 'error'
  const [alwaysOn, setAlwaysOn] = useState(false);

  // ── Geocodare adresă recunoscută vocal ─────────────────────────────────
  const handleDestinationRecognized = async (spokenAddress) => {
    setStatusMessage(`🔍 Caut: "${spokenAddress}"...`);
    setStatusType('info');

    try {
      const place = await geocodeAddress(spokenAddress);
      const lat = place?.lat ?? place?.coordinate?.lat;
      const lng = place?.lng ?? place?.coordinate?.lng;

      if (!lat || !lng) {
        speak(`Nu am găsit "${spokenAddress}" în Timișoara. Încearcă o adresă mai precisă.`);
        setStatusMessage(`❌ Adresă negăsită: "${spokenAddress}"`);
        setStatusType('error');
        return;
      }

      const resolvedName = place.displayName || place.name || spokenAddress;
      setStatusMessage(`✅ Destinație: ${resolvedName}`);
      setStatusType('success');
      speak(`Am setat destinația către ${resolvedName}. Calculez ruta accesibilă.`);

      if (onDestinationSet) onDestinationSet({ name: resolvedName, lat, lng });
    } catch (err) {
      console.error('Geocoding error:', err);
      speak('Eroare de conexiune. Verifică internetul și încearcă din nou.');
      setStatusMessage('❌ Eroare de conexiune cu serverul');
      setStatusType('error');
    }
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
      setStatusMessage('🚨 URGENȚĂ ACTIVATĂ – se apelează 112');
      setStatusType('error');
      if (onEmergency) onEmergency();
    },
    onCameraOpen: () => {
      setStatusMessage('📷 Camera deschisă');
      setStatusType('success');
      if (onCameraOpen) onCameraOpen();
    },
    onCameraClose: () => {
      setStatusMessage('📷 Camera închisă');
      setStatusType('info');
      if (onCameraClose) onCameraClose();
    },
    alwaysOn: false, // controlăm manual din UI
  });

  // Afișăm erorile hook-ului
  useEffect(() => {
    if (error) {
      setStatusMessage(`⚠️ ${error}`);
      setStatusType('error');
    }
  }, [error]);

  // ── Toggle always-on ──────────────────────────────────────────────────
  const handleToggleAlwaysOn = () => {
    if (alwaysOn) {
      stopAlwaysOn();
      setAlwaysOn(false);
      setStatusMessage('🔇 Microfon oprit');
      setStatusType('info');
    } else {
      speak('Asistent vocal activat. Poți spune comenzi oricând.');
      setTimeout(() => {
        startAlwaysOn();
        setAlwaysOn(true);
        setStatusMessage('🎙️ Ascult permanent...');
        setStatusType('success');
      }, 1200);
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
    speak('Spune comanda.');
    setTimeout(() => startListening(), 950);
  };

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
    ? (isListening ? '🎙️ Ascult...' : '🟢 Mereu activ – aștept comandă')
    : (isListening ? '🎙️ Ascult... (apasă pt a opri)' : '🎤 Apasă și spune comanda');

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
          ? '🟢 Microfon mereu activ — apasă pentru a opri'
          : '⬜ Activează microfon permanent'}
      </button>

      {/* ── Indicator permisiune microfon ── */}
      {permissionGranted === false && (
        <div style={{
          padding: '7px 10px', borderRadius: 10, fontSize: '0.78rem',
          fontWeight: 600, background: 'rgba(239,68,68,0.15)',
          color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)',
          fontFamily: 'system-ui, sans-serif',
        }}>
          🔒 Permisiune microfon refuzată — apasă 🔒 în bara browserului și permite microfonul.
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
          Comenzi: &ldquo;Du-mă la Piața Victoriei&rdquo;
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
