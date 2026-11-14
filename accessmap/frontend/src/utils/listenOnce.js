/**
 * Listens for one short answer and resolves with what was heard (best guess first),
 * or [] if nothing was understood. Used for yes/no questions asked by the app.
 */
export function listenOnce({ lang = 'ro-RO', timeoutMs = 8000 } = {}) {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) return Promise.resolve([]);

  return new Promise((resolve) => {
    let done = false;
    let partial = [];
    const rec = new SR();
    const finish = (alts) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rec.abort(); } catch { /* already stopped */ }
      resolve(alts.filter(Boolean));
    };
    const timer = setTimeout(() => finish(partial), timeoutMs);

    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true; // iOS Safari rarely sends a final result
    rec.maxAlternatives = 3;
    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last) return;
      const alts = Array.from(last).map((a) => (a.transcript || '').trim());
      if (last.isFinal) finish(alts);
      else partial = alts;
    };
    rec.onerror = () => finish(partial);
    rec.onend = () => finish(partial);
    try {
      rec.start();
    } catch {
      finish([]);
    }
  });
}
