import { useState, useRef, useCallback, useEffect } from 'react';
import { speechQueue } from '../utils/speechQueue';

// ─── Normalizare text românesc (fără diacritice, lowercase) ───────────────────
export function normalizeVoiceText(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Comenzile vocale recunoscute (forma normalizată, fără diacritice) ───────
const CAMERA_TRIGGERS = [
  'deschide camera', 'porneste camera', 'activeaza camera',
  'deschide cam', 'camera on', 'vreau camera',
  'deschide-mi camera', 'arata camera', 'arata-mi camera',
];

const CAMERA_CLOSE_TRIGGERS = [
  'inchide camera', 'opreste camera', 'camera off', 'dezactiveaza camera',
];

const EMERGENCY_TRIGGERS = [
  'ajutor', 'urgenta', '112', 'sos',
];

const NAV_GUIDANCE_TRIGGERS = [
  'pe unde trebuie sa o iau', 'pe unde o iau', 'pe unde merg',
  'incotro o iau', 'urmatorul pas', 'pe unde sa merg', 'ghideaza-ma',
  'start navigare', 'porneste navigarea', 'incepe navigarea', 'incepe ghidarea',
  'navigare pas cu pas', 'pe unde tre sa o iau', 'pe unde trebe sa o iau',
];

const YES_TRIGGERS = [
  'da', 'da te rog', 'confirm', 'confirma', 'corect', 'exact',
  'ok', 'bine', 'mergem', 'porneste', 'hai', 'asa e', 'perfect',
];

const NO_TRIGGERS = [
  'nu', 'nu e bine', 'anuleaza', 'opreste', 'gresit', 'altceva', 'alta adresa',
];

const CANCEL_ROUTE_TRIGGERS = [
  'anuleaza ruta', 'opreste navigarea', 'sterge ruta', 'anuleaza traseul', 'opreste traseul',
];

const STATUS_TRIGGERS = [
  'cat mai am', 'cat dureaza', 'status ruta', 'unde merg', 'ce destinatie am', 'cat e pana acolo',
];

const NAV_DESTINATION_PREFIXES = [
  /^(?:hei|ok|te rog|va rog|asistent|accessmap)\s+/i,
  /^(?:vreau|as vrea|as dori|doresc)\s+(?:sa\s+)?(?:ajung|merg|plec|ma duc|ma deplasez)\s+(?:la|in|spre|catre|pe|pana la|pana in)\s+/i,
  /^(?:vreau|as vrea|as dori|doresc)\s+(?:la|in|spre|catre|pe)\s+/i,
  /^(?:cum|pe unde)\s+(?:pot\s+sa\s+)?ajung\s+(?:la|in|spre|catre|pe|pana la|pana in)\s+/i,
  /^(?:du-ma|du ma|ma duci|poti sa ma duci|ma poti duce)\s+(?:la|in|spre|catre|pe|pana la|pana in)\s+/i,
  /^(?:navigheaza|navigare|ghideaza-ma|ghideaza ma|traseu|ruta|drum|drumul)\s+(?:la|in|spre|catre|pe|pana la|pana in)\s+/i,
  /^(?:mergi|du-te|du te|pleaca|porneste|o iau|mergem)\s+(?:la|in|spre|catre|pe|pana la|pana in)\s+/i,
  /^(?:seteaza|pune|alege|cauta|cauta-mi|gaseste|gaseste-mi|arata-mi|arata)\s+(?:destinatia\s+)?(?:drumul\s+)?(?:la|in|spre|catre|pe)?\s*/i,
  /^(?:destinatia|destinatie)\s+(?:este\s+|e\s+|la\s+|in\s+|spre\s+|catre\s+)?/i,
  /^(?:la|in|spre|catre)\s+/i,
  // English ("Take me to Kaufland", "Navigate to the train station", "I want to go to ...")
  /^(?:hey|ok|okay|please)\s+/i,
  /^(?:take|bring|get|guide|walk|lead)\s+me\s+(?:to|towards)\s+/i,
  /^(?:go|navigate|directions|route|walk|head|drive)\s+(?:me\s+)?(?:to|towards)\s+/i,
  /^(?:i\s+)?(?:want|wanna|need|would like|'d like|d like)\s+(?:to\s+)?go\s+(?:to\s+)?/i,
  /^(?:let'?s|lets)\s+go\s+(?:to\s+)?/i,
  /^(?:how do i get|how can i get|how to get)\s+to\s+/i,
  /^(?:find|find me|search for|show me|where is)\s+/i,
  /^(?:the|a|an)\s+/i,
  // "cel mai apropiat Kaufland" / "the nearest Kaufland": the search already picks the closest one
  /^(?:cel|cea)\s+mai\s+(?:apropiat[ae]?|aproape)\s+/i,
  /^(?:nearest|closest)\s+/i,
];

function containsAny(normalizedText, triggers) {
  return triggers.some((t) => normalizedText.includes(t));
}

export function extractAddress(raw) {
  let text = normalizeVoiceText(raw);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of NAV_DESTINATION_PREFIXES) {
      const next = text.replace(pattern, '').trim();
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  text = text
    .replace(/\s+(?:te rog|va rog|multumesc|mersi|acum|repede|please|now|thanks|thank you)$/i, '')
    .replace(/\s+(?:cel|cea)\s+mai\s+(?:apropiat[ae]?|aproape)$/i, '')
    .replace(/\s+(?:near me|nearby|close by)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
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
  onCancelRoute,
  onStatusQuery,
  awaitingConfirmation = false,
  onConfirmYes,
  onConfirmNo,
  alwaysOn = false,          // dacă true, pornește microfonul automat și îl ține activ
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
  const processResult = useCallback((spoken) => {
    const normalized = normalizeVoiceText(spoken);

    // 0. Dacă așteptăm confirmare Da / Nu pentru o destinație propusă
    if (awaitingConfirmRef.current) {
      const isExactYes = YES_TRIGGERS.some(
        (t) => normalized === t || normalized.startsWith(`${t} `)
      );
      const isExactNo = NO_TRIGGERS.some(
        (t) => normalized === t || normalized.startsWith(`${t} `)
      );

      if (isExactYes) {
        if (onConfirmYes) onConfirmYes();
        return;
      }
      if (isExactNo) {
        // Dacă utilizatorul a zis "nu, la <altă adresă>", căutăm direct noua adresă
        const remainder = normalized.replace(/^(?:nu|gresit|altceva)[,\s]*/i, '').trim();
        const maybeNewAddress = extractAddress(remainder);
        if (remainder.length >= 3 && maybeNewAddress.length >= 3) {
          if (onConfirmNo) onConfirmNo(maybeNewAddress);
          return;
        }
        if (onConfirmNo) onConfirmNo(null);
        return;
      }
    }

    // 1. Urgență
    if (containsAny(normalized, EMERGENCY_TRIGGERS)) {
      speak('Alertă de urgență activată! Se pregătesc coordonatele pentru 112.', { interrupt: true });
      if (onEmergency) onEmergency();
      return;
    }

    // 2. Deschide camera
    if (containsAny(normalized, CAMERA_TRIGGERS)) {
      speak('Deschid camera.', { interrupt: true });
      if (onCameraOpen) onCameraOpen();
      return;
    }

    // 3. Închide camera
    if (containsAny(normalized, CAMERA_CLOSE_TRIGGERS)) {
      speak('Închid camera.', { interrupt: true });
      if (onCameraClose) onCameraClose();
      return;
    }

    // 4. Anulează ruta / oprește navigarea
    if (containsAny(normalized, CANCEL_ROUTE_TRIGGERS)) {
      speak('Am anulat ruta.', { interrupt: true });
      if (onCancelRoute) onCancelRoute();
      return;
    }

    // 5. Întrebare status / cât mai am
    if (containsAny(normalized, STATUS_TRIGGERS)) {
      if (onStatusQuery) onStatusQuery();
      return;
    }

    // 6. Solicitare ghidare / start navigare în timp real
    if (containsAny(normalized, NAV_GUIDANCE_TRIGGERS)) {
      speak('Pornesc ghidarea pas-cu-pas în timp real.', { interrupt: true });
      if (onStartNavigation) onStartNavigation();
      return;
    }

    // 7. Destinație navigare
    const hasNavPrefix = NAV_DESTINATION_PREFIXES.some((p) => p.test(normalized));
    const address = extractAddress(spoken);

    if ((hasNavPrefix && address.length >= 2) || address.length >= 3) {
      if (onDestinationRecognized) onDestinationRecognized(address);
      return;
    }

    // 8. Nu am recunoscut comanda
    speak('Nu am înțeles comanda. Spune, de exemplu: Du-mă la Piața Victoriei, Cât mai am, sau Deschide camera.');
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
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    // continuous = false: mai stabil pe Chrome; restartăm manual în onend
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
      setPermissionGranted(true);
    };

    recognition.onresult = (event) => {
      // Alege alternativa cu cel mai mare scor de încredere (implicit prima)
      const results = Array.from(event.results[0]);
      const best = results.reduce((a, b) =>
        (b.confidence || 0) > (a.confidence || 0) ? b : a
      , results[0]);
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
