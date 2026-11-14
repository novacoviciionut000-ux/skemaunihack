import { useState, useRef, useCallback, useEffect } from 'react';

// ─── Comenzile vocale recunoscute ─────────────────────────────────────────────
const CAMERA_TRIGGERS = [
  'deschide camera', 'pornește camera', 'porneste camera', 'activează camera',
  'activeaza camera', 'deschide cam', 'camera on', 'vreau camera',
  'deschide-mi camera', 'arată camera', 'arata camera',
];

const CAMERA_CLOSE_TRIGGERS = [
  'închide camera', 'inchide camera', 'oprește camera', 'opreste camera',
  'camera off', 'dezactivează camera', 'dezactiveaza camera',
];

const EMERGENCY_TRIGGERS = [
  'ajutor', 'urgență', 'urgenta', '112', 'sos',
];

const NAV_GUIDANCE_TRIGGERS = [
  'pe unde trebuie să o iau', 'pe unde o iau', 'pe unde merg',
  'încotro o iau', 'incotro o iau', 'următorul pas', 'urmatorul pas',
  'pe unde să merg', 'pe unde sa merg', 'ghidează-mă', 'ghideaza-ma',
  'start navigare', 'pornește navigarea', 'porneste navigarea', 'navigare pas cu pas',
  'pe unde tre sa o iau', 'pe unde trebe sa o iau',
];

const NAV_DESTINATION_PREFIXES = [
  /^(du-mă la|du ma la|du-mă spre|du ma spre)\s+/,
  /^(vreau să merg la|vreau sa merg la)\s+/,
  /^(navighează (la|către|catre)|navigheaza (la|catre|către))\s+/,
  /^(mergi la|du-te la)\s+/,
  /^(setează destinația la|seteaza destinatia la)\s+/,
  /^(pleacă spre|pleaca spre|pleacă la|pleaca la)\s+/,
  /^(arată-mi drumul (la|spre|către)|arata-mi drumul (la|spre|catre))\s+/,
  /^(navigare la|navigare spre)\s+/,
];

function containsAny(text, triggers) {
  return triggers.some((t) => text.includes(t));
}

function extractAddress(raw) {
  let text = raw.toLowerCase().trim();
  for (const pattern of NAV_DESTINATION_PREFIXES) {
    text = text.replace(pattern, '');
  }
  text = text.replace(/\s+/g, ' ').replace(/[.!?]$/, '').trim();
  // Capitalizează fiecare cuvânt
  return text.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useVoiceAssistant({
  onDestinationRecognized,
  onEmergency,
  onCameraOpen,
  onCameraClose,
  onStartNavigation,
  alwaysOn = false,          // dacă true, pornește microfonul automat și îl ține activ
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [permissionGranted, setPermissionGranted] = useState(null); // null | true | false

  const recognitionRef = useRef(null);
  const shouldRestartRef = useRef(false);  // controlăm restart-ul continuu
  const isSpeakingRef = useRef(false);     // blocăm microfonul în timp ce vorbește aplicația

  // ─── TTS ─────────────────────────────────────────────────────────────────
  const speak = useCallback((text, lang = 'ro-RO') => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    utterance.onstart = () => { isSpeakingRef.current = true; };
    utterance.onend = () => { isSpeakingRef.current = false; };
    utterance.onerror = () => { isSpeakingRef.current = false; };

    window.speechSynthesis.speak(utterance);
  }, []);

  // ─── Procesare rezultat recunoscut ───────────────────────────────────────
  const processResult = useCallback((spoken) => {
    const lower = spoken.toLowerCase().trim();

    // 1. Urgență
    if (containsAny(lower, EMERGENCY_TRIGGERS)) {
      speak('Alertă de urgență activată! Se pregătesc coordonatele pentru 112.');
      if (onEmergency) onEmergency();
      return;
    }

    // 2. Deschide camera
    if (containsAny(lower, CAMERA_TRIGGERS)) {
      speak('Deschid camera.');
      if (onCameraOpen) onCameraOpen();
      return;
    }

    // 3. Închide camera
    if (containsAny(lower, CAMERA_CLOSE_TRIGGERS)) {
      speak('Închid camera.');
      if (onCameraClose) onCameraClose();
      return;
    }

    // 4. Solicitare ghidare / start navigare în timp real
    if (containsAny(lower, NAV_GUIDANCE_TRIGGERS)) {
      speak('Pornesc ghidarea pas-cu-pas în timp real.');
      if (onStartNavigation) onStartNavigation();
      return;
    }

    // 5. Destinație navigare
    const hasNavPrefix = NAV_DESTINATION_PREFIXES.some((p) => p.test(lower));
    const address = extractAddress(spoken);

    if (hasNavPrefix || address.length >= 3) {
      if (onDestinationRecognized) onDestinationRecognized(address);
      return;
    }

    // 6. Nu am recunoscut comanda
    speak('Nu am înțeles comanda. Spune, de exemplu: Du-mă la Piața Victoriei, Pe unde trebuie să o iau, sau Deschide camera.');
  }, [speak, onEmergency, onCameraOpen, onCameraClose, onStartNavigation, onDestinationRecognized]);

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
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    // continuous = false: mai stabil pe Chrome; restartăm manual în onend
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setPermissionGranted(true);
    };

    recognition.onresult = (event) => {
      // Alege cea mai lungă alternativă
      const results = Array.from(event.results[0]);
      const best = results.reduce((a, b) =>
        a.transcript.length >= b.transcript.length ? a : b
      );
      const spoken = best.transcript.trim();
      setTranscript(spoken);
      processResult(spoken);
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
