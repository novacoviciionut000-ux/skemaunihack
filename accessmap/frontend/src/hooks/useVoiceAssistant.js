import { useState, useRef, useCallback, useEffect } from 'react';
import { speechQueue } from '../utils/speechQueue';
import { pickBestCommand } from '../utils/voiceCommands';
import { helpConfirmBridge, emitHelpCommand } from '../utils/helpVoiceBridge';

// Command parsing lives in utils/voiceCommands.js (pure, unit-tested).
export { normalizeVoiceText } from '../utils/voiceCommands';

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useVoiceAssistant({
  onDestinationRecognized,
  onEmergency,
  onCameraOpen,
  onCameraClose,
  onStartNavigation,
  onCancelRoute,
  onStatusQuery,
  awaitingConfirmation = false,
  onConfirmYes,
  onConfirmNo,
  onConfirmUnclear,          // așteptăm „da”/„nu” dar s-a auzit altceva
  onMicAlwaysOn,             // „activează microfonul permanent”
  onMicOff,                  // „oprește microfonul”
  alwaysOn = false,          // dacă true, pornește microfonul automat și îl ține activ
  isClient = false,          // client logat: „ajutor” cheamă un voluntar în loc de 112
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(null); // null | true | false

  const recognitionRef = useRef(null);
  const shouldRestartRef = useRef(false);  // controlăm restart-ul continuu
  const isSpeakingRef = useRef(false);     // blocăm microfonul în timp ce vorbește aplicația
  const awaitingConfirmRef = useRef(awaitingConfirmation);

  useEffect(() => {
    awaitingConfirmRef.current = awaitingConfirmation;
  }, [awaitingConfirmation]);

  const isClientRef = useRef(isClient);
  isClientRef.current = isClient;

  // ─── TTS secvențial prin speechQueue ────────────────────────────────────
  const speak = useCallback((text, options = {}) => {
    const { lang = 'ro-RO', interrupt = false, onEnd = null } =
      typeof options === 'string' ? { lang: options } : options;

    if (!speechQueue._unlocked) {
      speechQueue.unlock();
    }
    isSpeakingRef.current = true;
    speechQueue.speak(text, {
      lang,
      priority: 'high',
      interrupt,
      onEnd: () => {
        isSpeakingRef.current = false;
        if (onEnd) onEnd();
      },
    });
  }, []);

  // ─── Procesare rezultat recunoscut ───────────────────────────────────────
  // `alternatives`: everything the recognizer offered, best guess first. The parser picks
  // the one that makes sense ("du-mă la Kaufland" over a misheard "du-mă la cauza").
  const processResult = useCallback((alternatives) => {
    const list = Array.isArray(alternatives) ? alternatives : [alternatives];
    // The help system may be waiting for "da" / "nu" (was the deed really done?)
    const helpAwaiting = helpConfirmBridge.isAwaiting();
    const cmd = pickBestCommand(list, {
      awaitingConfirmation: awaitingConfirmRef.current || helpAwaiting,
      isClient: isClientRef.current,
    });

    // Waiting for "da" / "nu": anything else asks again instead of running another command
    if (helpAwaiting && cmd.type !== 'confirm-yes' && cmd.type !== 'confirm-no') {
      helpConfirmBridge.unclear();
      return;
    }

    switch (cmd.type) {
      case 'confirm-yes':
        if (helpAwaiting) helpConfirmBridge.answer(true);
        else if (onConfirmYes) onConfirmYes();
        return;
      case 'confirm-no':
        if (helpAwaiting) helpConfirmBridge.answer(false);
        else if (onConfirmNo) onConfirmNo(cmd.newDestination || null);
        return;
      case 'call-volunteer':
      case 'cancel-help':
      case 'help-status':
      case 'deed-finished':
      case 'accept-help':
      case 'release-help':
      case 'duty-on':
      case 'duty-off':
      case 'mic-always-on':
        if (onMicAlwaysOn) onMicAlwaysOn();
        return;
      case 'mic-off':
        if (onMicOff) onMicOff();
        return;
      case 'my-points':
        emitHelpCommand(cmd.type);
        return;
      case 'emergency':
        speak('Alertă de urgență activată! Se pregătesc coordonatele pentru 112.', { interrupt: true });
        if (onEmergency) onEmergency();
        return;
      case 'camera-open':
        speak('Deschid camera.', { interrupt: true });
        if (onCameraOpen) onCameraOpen();
        return;
      case 'camera-close':
        speak('Închid camera.', { interrupt: true });
        if (onCameraClose) onCameraClose();
        return;
      case 'cancel-route':
        speak('Am anulat ruta.', { interrupt: true });
        if (onCancelRoute) onCancelRoute();
        return;
      case 'status':
        if (onStatusQuery) onStatusQuery();
        return;
      case 'start-navigation':
        speak('Pornesc ghidarea pas-cu-pas în timp real.', { interrupt: true });
        if (onStartNavigation) onStartNavigation();
        return;
      case 'destination':
        if (onDestinationRecognized) onDestinationRecognized(cmd.destination);
        return;
      default:
        // A yes/no question is open: ask it again instead of explaining the other commands
        if (awaitingConfirmRef.current && onConfirmUnclear) {
          onConfirmUnclear();
          return;
        }
        speak(
          list[0]
            ? `Am auzit: ${list[0]}. Nu am înțeles comanda. Spune, de exemplu: Du-mă la Kaufland.`
            : 'Nu am auzit nimic. Atinge de două ori și spune, de exemplu: Du-mă la Kaufland.',
          { interrupt: true }
        );
    }
  }, [
    speak,
    onEmergency,
    onCameraOpen,
    onCameraClose,
    onCancelRoute,
    onStatusQuery,
    onStartNavigation,
    onDestinationRecognized,
    onConfirmYes,
    onConfirmNo,
    onConfirmUnclear,
    onMicAlwaysOn,
    onMicOff,
  ]);

  // ─── Pornire recognition ──────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Browserul tău nu suportă recunoaștere vocală. Încearcă Chrome sau Edge.');
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    setError(null);

    const recognition = new SpeechRecognition();
    recognition.lang = 'ro-RO';
    // Interim results on: iOS Safari sends them regardless, and on end we can still use the
    // last partial phrase if the engine never marks one final (it often doesn't on iOS).
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    // continuous = false: mai stabil pe Chrome; restartăm manual în onend
    recognition.continuous = false;

    // One utterance per session (continuous = false): handle it exactly once, either when the
    // engine marks it final or, failing that, with the last partial text when listening ends.
    let handled = false;
    let lastPartial = [];
    const handle = (alternatives) => {
      if (handled) return;
      const clean = alternatives.map((a) => (a || '').trim()).filter(Boolean);
      if (!clean.length) return;
      handled = true;
      setTranscript(clean[0]);
      processResult(clean);
    };

    recognition.onstart = () => {
      // Always-on mode restarts this same instance, so each session starts fresh
      handled = false;
      lastPartial = [];
      setIsListening(true);
      setPermissionGranted(true);
    };

    recognition.onresult = (event) => {
      // Join all result segments (some engines split one sentence into several results)
      const segments = Array.from(event.results);
      const best = segments.map((r) => r[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim();
      // Alternatives of the last segment, prefixed with the earlier segments' best text
      const head = segments.slice(0, -1).map((r) => r[0]?.transcript || '').join(' ');
      const last = segments[segments.length - 1];
      const alts = last ? Array.from(last).map((a) => `${head} ${a.transcript}`.replace(/\s+/g, ' ').trim()) : [];
      const alternatives = [best, ...alts.filter((a) => a !== best)];

      if (segments.length && segments.every((r) => r.isFinal)) {
        handle(alternatives);
      } else {
        lastPartial = alternatives;
        setTranscript(best);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      console.warn('Voice recognition error:', event.error);

      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setPermissionGranted(false);
        setError('Accesul la microfon a fost refuzat. Permite microfonul în bara de adresă a browserului.');
        shouldRestartRef.current = false; // nu mai restartăm dacă nu avem permisiune
      } else if (event.error === 'no-speech') {
        // Liniște normală — nu afișăm eroare, doar restartăm
      } else if (event.error === 'network') {
        setError('Eroare de rețea pentru recunoașterea vocală.');
        shouldRestartRef.current = false;
      } else if (event.error === 'audio-capture') {
        setError('Microfonul nu a putut fi accesat. Verifică că există un microfon conectat.');
        shouldRestartRef.current = false;
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      handle(lastPartial);
      // Restart automat dacă suntem în modul always-on și nu vorbim noi
      if (shouldRestartRef.current) {
        const delay = isSpeakingRef.current ? 1200 : 300;
        setTimeout(() => {
          if (shouldRestartRef.current) {
            try {
              recognition.start();
              setIsListening(true);
            } catch {
              // recognition în curs — creăm o instanță nouă
              startListening();
            }
          }
        }, delay);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error('Could not start recognition:', err);
      setError('Nu s-a putut porni recunoașterea vocală.');
      setIsListening(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processResult]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
  }, []);

  const startAlwaysOn = useCallback(() => {
    shouldRestartRef.current = true;
    startListening();
  }, [startListening]);

  const stopAlwaysOn = useCallback(() => {
    shouldRestartRef.current = false;
    stopListening();
  }, [stopListening]);

  // ─── Pornire automată dacă alwaysOn=true (montare componentă) ────────────
  useEffect(() => {
    if (alwaysOn) {
      // Mic delay pentru a nu bloca randarea inițială
      const t = setTimeout(() => {
        shouldRestartRef.current = true;
        startListening();
      }, 1500);
      return () => {
        clearTimeout(t);
        shouldRestartRef.current = false;
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch {}
        }
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysOn]);

  return {
    isListening,
    transcript,
    error,
    permissionGranted,
    speak,
    startListening,
    stopListening,
    startAlwaysOn,
    stopAlwaysOn,
  };
}
