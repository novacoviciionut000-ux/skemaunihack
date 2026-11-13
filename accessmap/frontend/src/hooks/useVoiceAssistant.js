import { useState, useRef, useCallback } from 'react';

export function useVoiceAssistant({ onDestinationRecognized, onEmergency }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);

  // ─── 1. Text-to-Speech (vocea aplicației) ─────────────────────────────
  const speak = useCallback((text, lang = 'ro-RO') => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  // ─── 2. Parsare text vorbit → adresă curată ────────────────────────────
  const extractAddress = useCallback((raw) => {
    let text = raw.toLowerCase().trim();

    // Elimină prefixe de comandă
    const prefixes = [
      /^(du-mă la|du ma la|du-mă spre|du ma spre)\s+/,
      /^(vreau să merg la|vreau sa merg la)\s+/,
      /^(navighează (la|către|catre)|navigheaza (la|catre|către))\s+/,
      /^(mergi la|du-te la)\s+/,
      /^(setează destinația la|seteaza destinatia la)\s+/,
      /^(pleacă spre|pleaca spre|pleacă la|pleaca la)\s+/,
      /^(arată-mi drumul (la|spre|către)|arata-mi drumul (la|spre|catre))\s+/,
    ];

    for (const pattern of prefixes) {
      text = text.replace(pattern, '');
    }

    // Curățare finală
    text = text
      .replace(/\s+/g, ' ')
      .replace(/[.!?]$/, '')
      .trim();

    // Capitalizare prima literă a fiecărui cuvânt important
    return text
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }, []);

  // ─── 3. Speech-to-Text ────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Browserul tău nu suportă recunoaștere vocală. Încearcă Chrome sau Edge.');
      speak('Dispozitivul nu suportă recunoaștere vocală. Încearcă Google Chrome.');
      return;
    }

    // Curăță o sesiune anterioară
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    setError(null);
    setTranscript('');

    const recognition = new SpeechRecognition();
    recognition.lang = 'ro-RO';
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;   // 3 variante → alegem prima
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      // Luăm toate alternativele și alegem cea mai lungă (de obicei cea mai completă)
      const results = Array.from(event.results[0]);
      const best = results.reduce((a, b) =>
        a.transcript.length >= b.transcript.length ? a : b
      );
      const spoken = best.transcript.trim();
      setTranscript(spoken);
      const lower = spoken.toLowerCase();

      // ── Urgență ──────────────────────────────────────────────────────
      if (
        lower.includes('ajutor') ||
        lower.includes('urgență') ||
        lower.includes('urgenta') ||
        lower.includes('112')
      ) {
        speak('Alertă de urgență activată! Se pregătesc coordonatele pentru 112.');
        if (onEmergency) onEmergency();
        return;
      }

      // ── Extrage destinația și trimite mai departe ─────────────────────
      const address = extractAddress(spoken);
      if (address.length < 2) {
        speak('Nu am înțeles adresa. Apasă din nou și spune unde vrei să mergi.');
        return;
      }

      if (onDestinationRecognized) {
        onDestinationRecognized(address);
      }
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      console.warn('Voice recognition error:', event.error);
      switch (event.error) {
        case 'no-speech':
          setError('Nu am auzit nimic. Încearcă din nou.');
          speak('Nu am auzit nimic. Apasă butonul și vorbește clar.');
          break;
        case 'not-allowed':
        case 'permission-denied':
          setError('Accesul la microfon a fost refuzat. Permite microfonul în browser.');
          speak('Accesul la microfon a fost refuzat. Verifică setările browserului.');
          break;
        case 'network':
          setError('Eroare de rețea la recunoașterea vocală.');
          speak('Eroare de rețea. Verifică conexiunea la internet.');
          break;
        case 'audio-capture':
          setError('Microfonul nu a putut fi accesat.');
          speak('Microfonul nu a putut fi accesat. Verifică că există un microfon conectat.');
          break;
        default:
          setError(`Eroare: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error('Could not start recognition:', err);
      setIsListening(false);
      setError('Nu s-a putut porni recunoașterea vocală.');
    }
  }, [onDestinationRecognized, onEmergency, speak, extractAddress]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
  }, []);

  return {
    isListening,
    transcript,
    error,
    speak,
    startListening,
    stopListening,
  };
}
