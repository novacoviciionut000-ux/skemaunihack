import { useState, useEffect } from 'react';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';
import { geocodeAddress } from '../api/client';

export default function VoiceButton({ onDestinationSet, onEmergency }) {
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState('info'); // 'info' | 'success' | 'error'
  const [pulse, setPulse] = useState(false);

  // Animație de puls când ascultă
  useEffect(() => {
    let interval;
    if (pulse) {
      interval = setInterval(() => {
        setPulse((p) => !p);
      }, 600);
    }
    return () => clearInterval(interval);
  }, []);

  const handleDestinationRecognized = async (spokenAddress) => {
    setStatusMessage(`🔍 Caut: "${spokenAddress}"...`);
    setStatusType('info');

    try {
      const place = await geocodeAddress(spokenAddress);

      // Extragem coordonatele (vin ca { lat, lng, displayName } din searchSuggestions)
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

      if (onDestinationSet) {
        onDestinationSet({ name: resolvedName, lat, lng });
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      speak('Eroare de conexiune. Verifică internetul și încearcă din nou.');
      setStatusMessage('❌ Eroare de conexiune cu serverul');
      setStatusType('error');
    }
  };

  const { isListening, transcript, error, speak, startListening, stopListening } =
    useVoiceAssistant({
      onDestinationRecognized: handleDestinationRecognized,
      onEmergency: () => {
        setStatusMessage('🚨 URGENȚĂ ACTIVATĂ – se apelează 112');
        setStatusType('error');
        if (onEmergency) onEmergency();
      },
    });

  // Afișăm erorile hook-ului
  useEffect(() => {
    if (error) {
      setStatusMessage(`⚠️ ${error}`);
      setStatusType('error');
    }
  }, [error]);

  // Afișăm transcript-ul în timp real
  useEffect(() => {
    if (transcript && !isListening) {
      // statusMessage deja setat de handleDestinationRecognized
    }
  }, [transcript, isListening]);

  const handlePress = () => {
    if (isListening) {
      stopListening();
      setStatusMessage('');
      return;
    }
    setStatusMessage('');
    // Mic delay ca TTS să nu fie capturat de microfon
    speak('Spune destinația.');
    setTimeout(() => {
      startListening();
    }, 950);
  };

  // ─── Stiluri ─────────────────────────────────────────────────────────
  const statusColors = {
    info: { background: 'rgba(0,0,0,0.75)', color: '#93C5FD' },
    success: { background: 'rgba(0,0,0,0.75)', color: '#4ADE80' },
    error: { background: 'rgba(0,0,0,0.75)', color: '#F87171' },
  };
  const sc = statusColors[statusType] || statusColors.info;

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
      {/* Buton principal */}
      <button
        onClick={handlePress}
        aria-label={isListening ? 'Oprește ascultarea vocală' : 'Activează comanda vocală'}
        style={{
          width: '100%',
          minHeight: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          backgroundColor: isListening ? '#EF4444' : '#2563EB',
          color: '#FFFFFF',
          fontSize: '1rem',
          fontWeight: '700',
          border: 'none',
          borderRadius: '14px',
          cursor: 'pointer',
          boxShadow: isListening
            ? '0 0 0 4px rgba(239,68,68,0.35), 0 4px 16px rgba(239,68,68,0.5)'
            : '0 4px 16px rgba(37,99,235,0.4)',
          transition: 'background 0.2s, box-shadow 0.2s',
          letterSpacing: '0.02em',
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
        }}
      >
        {/* Iconiță microfon (SVG inline) */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            animation: isListening ? 'micPulse 0.8s ease-in-out infinite alternate' : 'none',
          }}
        >
          <rect x="9" y="1" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0014 0" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>

        {isListening
          ? '🎙️ Ascult... apasă pentru a opri'
          : '🎤 Spune unde vrei să mergi'}
      </button>

      {/* Status / feedback */}
      {statusMessage && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: '600',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            ...sc,
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Hint text */}
      {!isListening && !statusMessage && (
        <p
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: '0.78rem',
            color: '#94A3B8',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Ex: &ldquo;Du-mă la Piața Victoriei&rdquo; sau &ldquo;Gara de Nord&rdquo;
        </p>
      )}

      {/* Animație CSS pentru pulsul microfonului */}
      <style>{`
        @keyframes micPulse {
          from { transform: scale(1); opacity: 1; }
          to   { transform: scale(1.25); opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
