import { useState, useEffect, useRef } from 'react';
import { palette, rgb, radius, shadow, font } from '../theme';
import { useVoiceAssistant } from '../hooks/useVoiceAssistant';
import { findClosestPlace, formatDistance } from '../api/client';
import { speechQueue, playListenBeep, unlockAudioContext } from '../utils/speechQueue';
import { useAuth } from '../context/AuthContext';
import { VOICE_LISTEN_EVENT } from '../utils/helpVoiceBridge';

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 40; // max distance between the two taps
const TAP_MOVE_PX = 15; // more movement than this is a drag/pan, not a tap

function isTextInput(el) {
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

// Double-tap means "listen to a voice command", which is wrong while a dialog is open:
// there the user is filling in a form, and a stray double-tap on a label or on the
// backdrop used to open the microphone in the middle of signing up. The whole gesture is
// suspended while any dialog is on screen, the backdrop included.
function isDialogOpen() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
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
  const [awaitingDest, setAwaitingDest] = useState(false);
  const { user } = useAuth();

  // ── Confirmare vocală a destinației ─────────────────────────────────────
  // After the place is found the app says where it is and how far, asks "Da sau Nu" and
  // opens the microphone. The route only starts on "da". All state the callbacks read lives
  // in refs, because the speech recognizer keeps the callbacks from when it was started.
  const CONFIRM_TIMEOUT_MS = 90_000; // an unanswered question stops waiting after this
  const MAX_CONFIRM_RETRIES = 2; // unclear answers re-asked this many times
  const pendingPlaceRef = useRef(null); // { place, tries }
  const pendingTimerRef = useRef(null);

  const clearPendingPlace = () => {
    pendingPlaceRef.current = null;
    clearTimeout(pendingTimerRef.current);
    setAwaitingDest(false);
  };
  useEffect(() => () => clearTimeout(pendingTimerRef.current), []);

  // Opens the microphone for the answer. Always-on mode already has it open.
  const listenForAnswer = () => {
    const { alwaysOn: on, isListening: listening, startListening: start } = voiceStateRef.current;
    if (on || listening) return;
    playListenBeep();
    if (navigator.vibrate) navigator.vibrate(40);
    start();
  };

  const askToConfirm = (place) => {
    pendingPlaceRef.current = { place, tries: 0 };
    clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(clearPendingPlace, CONFIRM_TIMEOUT_MS);
    setAwaitingDest(true);
    const dist = spokenDistance(place.distanceMeters);
    speak(
      `Am găsit ${place.shortName}${dist ? `, la aproximativ ${dist}` : ''}. Vrei să te duc acolo? Spune Da sau Nu.`,
      { interrupt: true, onEnd: listenForAnswer }
    );
  };

  const handleConfirmYes = () => {
    const pending = pendingPlaceRef.current;
    if (!pending) return;
    const { place } = pending;
    clearPendingPlace();
    setStatusMessage(`Rută către ${place.shortName} (${formatDistance(place.distanceMeters)})`);
    setStatusType('success');
    speak(`Pornesc ruta către ${place.shortName}. Spune Anulează ruta pentru a opri.`, { interrupt: true });
    if (onDestinationSet) {
      onDestinationSet({ name: place.displayName, shortName: place.shortName, lat: place.lat, lng: place.lng });
    }
  };

  // "Nu" alone drops the place; "nu, du-mă la Lidl" goes straight to the new search
  const handleConfirmNo = (newDestination) => {
    clearPendingPlace();
    if (newDestination) {
      handleDestinationRecognized(newDestination);
      return;
    }
    setStatusMessage('Destinație respinsă. Spune unde vrei să mergi.');
    setStatusType('info');
    speak('Bine, nu pornesc ruta. Spune unde vrei să mergi.', { interrupt: true, onEnd: listenForAnswer });
  };

  const handleConfirmUnclear = () => {
    const pending = pendingPlaceRef.current;
    if (!pending) return;
    pending.tries += 1;
    if (pending.tries > MAX_CONFIRM_RETRIES) {
      clearPendingPlace();
      setStatusMessage('Fără răspuns clar. Ruta nu a fost pornită.');
      setStatusType('error');
      speak('Nu am primit un răspuns clar, așa că nu pornesc ruta. Spune din nou unde vrei să mergi.', { interrupt: true });
      return;
    }
    speak(`Nu am înțeles. Vrei să te duc la ${pending.place.shortName}? Spune Da sau Nu.`, {
      interrupt: true,
      onEnd: listenForAnswer,
    });
  };

  // ── Destinație vocală: cea mai apropiată potrivire, ruta pornește imediat ──
  const lookupIdRef = useRef(0);
  const handleDestinationRecognized = async (destination) => {
    clearPendingPlace(); // a new destination replaces any question still open
    // { query, near } from the voice parser; a plain string still works
    const dest = typeof destination === 'string' ? { query: destination, near: null } : destination;
    const spokenAddress = dest.near ? `${dest.query} de lângă ${dest.near}` : dest.query;
    const lookupId = ++lookupIdRef.current;
    setStatusMessage(`Caut cel mai apropiat: "${spokenAddress}"...`);
    setStatusType('info');
    // Immediate spoken feedback: the search can take a few seconds on mobile data
    speak(`Caut ${spokenAddress}.`, { interrupt: true });

    try {
      const place = await findClosestPlace(dest.query, userLocation, dest.near);
      if (lookupId !== lookupIdRef.current) return; // a newer command superseded this one

      if (!place) {
        speak(`Nu am găsit ${spokenAddress}. Încearcă un nume sau o adresă mai precisă.`, { interrupt: true });
        setStatusMessage(`Negăsit: "${spokenAddress}"`);
        setStatusType('error');
        return;
      }

      setStatusMessage(`${place.shortName} (${formatDistance(place.distanceMeters)}): spune Da sau Nu`);
      setStatusType('info');
      askToConfirm(place);
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
      clearPendingPlace();
      setStatusMessage('Rută anulată');
      setStatusType('info');
      if (onCancelRoute) onCancelRoute();
    },
    onStatusQuery: handleStatusQuery,
    awaitingConfirmation: awaitingDest,
    onConfirmYes: handleConfirmYes,
    onConfirmNo: handleConfirmNo,
    onConfirmUnclear: handleConfirmUnclear,
    onMicAlwaysOn: () => turnMicAlwaysOn(),
    onMicOff: () => turnMicOff(),
    alwaysOn: false, // controlăm manual din UI
    isClient: Boolean(user && user.accountType !== 'VOLUNTEER'),
  });

  // Afișăm erorile hook-ului
  useEffect(() => {
    if (error) {
      setStatusMessage(error);
      setStatusType('error');
    }
  }, [error]);

  // ── Toggle always-on ──────────────────────────────────────────────────
  // The recognizer keeps the callbacks it was started with, so these read the current
  // state from voiceStateRef instead of the render they were created in.
  const turnMicAlwaysOn = () => {
    const { alwaysOn: on, startAlwaysOn: startOn } = voiceStateRef.current;
    if (on) {
      speak('Microfonul permanent este deja pornit. Spune Oprește microfonul ca să-l oprești.', { interrupt: true });
      return;
    }
    setAlwaysOn(true);
    setStatusMessage('Microfon permanent activ. Spune „Oprește microfonul” ca să-l oprești.');
    setStatusType('success');
    speak('Microfon permanent activat. Poți spune comenzi oricând. Spune Oprește microfonul ca să-l oprești.', {
      interrupt: true,
      onEnd: () => startOn(),
    });
  };

  const turnMicOff = () => {
    const { alwaysOn: on, stopAlwaysOn: stopOn } = voiceStateRef.current;
    if (!on) {
      stopListening();
      speak('Microfonul este oprit. Atinge ecranul de două ori când vrei să-mi spui ceva.', { interrupt: true });
      return;
    }
    stopOn();
    setAlwaysOn(false);
    setStatusMessage('Microfon oprit');
    setStatusType('info');
    speak('Am oprit microfonul. Atinge ecranul de două ori când vrei să-mi spui ceva.', { interrupt: true });
  };

  const handleToggleAlwaysOn = () => {
    if (alwaysOn) turnMicOff();
    else turnMicAlwaysOn();
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
  voiceStateRef.current = { isListening, alwaysOn, startListening, startAlwaysOn, stopAlwaysOn };

  // ── Întrebare pusă de aplicație (ex: „A fost rezolvat?”) → deschide microfonul ──
  useEffect(() => {
    const onListen = (e) => {
      const { isListening: listening, alwaysOn: on, startListening: start } = voiceStateRef.current;
      if (on) return; // microfonul permanent ascultă deja
      if (listening) return;
      playListenBeep();
      if (navigator.vibrate) navigator.vibrate(40);
      setStatusMessage(e.detail?.prompt || 'Ascult... spune comanda');
      setStatusType('info');
      start();
    };
    window.addEventListener(VOICE_LISTEN_EVENT, onListen);
    return () => window.removeEventListener(VOICE_LISTEN_EVENT, onListen);
  }, []);


  useEffect(() => {
    let down = null; // pointerdown position, to tell taps from drags
    let lastTap = null; // { time, x, y }
    let swallowClickUntil = 0;

    const onPointerDown = (e) => {
      down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    };

    const onPointerUp = (e) => {
      if (
        !e.isPrimary ||
        !down ||
        e.button > 0 ||
        isTextInput(e.target) ||
        isDialogOpen()
      ) {
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
    // Double-tap now means "voice command", so map double-click zoom must not fire too.
    // Inside a dialog the gesture is off, so native double-click behaviour is left alone.
    const blockDblClick = (e) => {
      if (!isTextInput(e.target) && !isDialogOpen()) e.stopPropagation();
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
  const statusTone = {
    info: { color: palette.primary, background: palette.primarySoft, border: palette.primarySoftBorder },
    success: { color: palette.success, background: palette.successSoft, border: palette.successOnDark },
    error: { color: palette.danger, background: palette.dangerSoft, border: palette.dangerSoftBorder },
  }[statusType] || {};

  const listeningColor = alwaysOn ? palette.success : palette.danger;
  const btnLabel = alwaysOn
    ? (isListening ? 'Ascult...' : 'Microfon permanent activ')
    : (isListening ? 'Ascult... atinge pentru a opri' : 'Spune o comandă');

  return (
    <div
      style={{
        margin: '0 12px 12px',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: palette.white,
        border: `1px solid ${palette.slate200}`,
        borderRadius: radius.lg,
        boxShadow: shadow.lg,
        fontFamily: font,
      }}
    >
      {/* ── Buton principal ── */}
      <button
        type="button"
        onClick={handlePressOnce}
        disabled={alwaysOn}
        aria-label={isListening ? 'Oprește ascultarea vocală' : 'Activează comanda vocală'}
        style={{
          width: '100%',
          minHeight: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          background: isListening || alwaysOn ? listeningColor : palette.primary,
          color: palette.white,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 0.1,
          border: 'none',
          borderRadius: radius.md,
          cursor: alwaysOn ? 'default' : 'pointer',
          boxShadow: isListening ? `0 0 0 4px rgba(${alwaysOn ? rgb.success : rgb.danger}, 0.22)` : 'none',
          transition: 'background 0.15s, box-shadow 0.15s',
          fontFamily: font,
          userSelect: 'none',
        }}
      >
        <svg
          width="22" height="22" viewBox="0 0 24 24"
          fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, animation: isListening ? 'micPulse 0.75s ease-in-out infinite alternate' : 'none' }}
        >
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0014 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
        {btnLabel}
      </button>

      {/* ── Status / feedback ── */}
      {statusMessage && (
        <div role="status" style={{
          padding: '8px 12px', borderRadius: radius.sm,
          fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, textAlign: 'center',
          color: statusTone.color, background: statusTone.background, border: `1px solid ${statusTone.border}`,
        }}>
          {statusMessage}
        </div>
      )}

      {permissionGranted === false && (
        <div role="alert" style={{
          padding: '8px 12px', borderRadius: radius.sm, fontSize: 13, fontWeight: 600, lineHeight: 1.35,
          color: palette.danger, background: palette.dangerSoft, border: `1px solid ${palette.dangerSoftBorder}`,
        }}>
          Microfonul este blocat. Permite-l din setările browserului (pictograma lacăt din bara de adresă).
        </div>
      )}

      {transcript && !isListening && (
        <div style={{ fontSize: 12.5, color: palette.slate500, textAlign: 'center', lineHeight: 1.35 }}>
          Am auzit: &ldquo;{transcript}&rdquo;
        </div>
      )}

      {/* ── Rând secundar: indiciu + microfon permanent ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ margin: 0, flex: 1, fontSize: 12.5, color: palette.slate600, lineHeight: 1.4 }}>
          {alwaysOn
            ? <>Ascult permanent. Spune <strong style={{ color: palette.ink }}>„Oprește microfonul”</strong> ca să-l oprești.</>
            : isListening
            ? 'Vorbește acum.'
            : <>Atinge ecranul de două ori, apoi spune de exemplu <strong style={{ color: palette.ink }}>„Du-mă la Kaufland”</strong> sau <strong style={{ color: palette.ink }}>„Am nevoie de ajutor”</strong>.</>}
        </p>
        <button
          type="button"
          onClick={handleToggleAlwaysOn}
          role="switch"
          aria-checked={alwaysOn}
          aria-label="Microfon permanent"
          style={{
            flexShrink: 0,
            minHeight: 40,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: alwaysOn ? palette.successSoft : palette.slate50,
            color: alwaysOn ? palette.success : palette.slate700,
            border: `1px solid ${alwaysOn ? palette.success : palette.slate300}`,
            borderRadius: radius.pill,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: font,
          }}
        >
          <span aria-hidden="true" style={{
            width: 28, height: 16, borderRadius: 8, position: 'relative',
            background: alwaysOn ? palette.success : palette.slate300, transition: 'background 0.15s',
          }}>
            <span style={{
              position: 'absolute', top: 2, left: alwaysOn ? 14 : 2, width: 12, height: 12, borderRadius: '50%',
              background: palette.white, transition: 'left 0.15s',
            }} />
          </span>
          Permanent
        </button>
      </div>

      <style>{`
        @keyframes micPulse {
          from { transform: scale(1); opacity: 1; }
          to   { transform: scale(1.25); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
