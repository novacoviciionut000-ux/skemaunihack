/**
 * Centralized priority speech queue for AccessMap.
 *
 * - Priority order: danger > urgent > high > normal. Higher priority is spoken first.
 * - A danger/urgent message interrupts a lower-priority utterance that is mid-speech.
 * - Queue items expire after TTL_MS so stale warnings are never read out late.
 * - The same text is not repeated within REPEAT_COOLDOWN_MS.
 * - Utterances are chained with onend (no timers per speak), with a watchdog for
 *   engines that drop onend (mobile Safari, Chrome after long utterances).
 * - Alarm beeps use Web Audio and play concurrently; they bypass the queue.
 * - iOS Safari: speechSynthesis is often muted while the camera is active, so speech is
 *   played through an unlocked <audio> element backed by /api/v1/tts, falling back to
 *   speechSynthesis if that fails.
 */

const PRIORITY_WEIGHT = { danger: 4, urgent: 3, high: 2, normal: 1 };

const TTL_MS = 4_000;
const MAX_QUEUE = 3;
const REPEAT_COOLDOWN_MS = 2_500;
const CANCEL_SETTLE_MS = IS_IOS ? 160 : 60; // speak() right after cancel() is dropped by iOS Safari and Chrome
const DEFAULT_LANG = 'ro-RO';

const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Tiny silent WAV; playing it inside a gesture permanently unlocks audio.play() on iOS
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---------------------------------------------------------------------------
// Beeps (Web Audio)
// ---------------------------------------------------------------------------
let audioCtx = null;

function getAudioCtx() {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function playTones({ freqs, type, step, length, peak }) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const start = now + i * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.01);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  } catch {
    /* audio is best-effort */
  }
}

/** Urgent alarm: three fast descending sawtooth pulses (path blocked / danger). */
export function playAlarmBeep() {
  playTones({ freqs: [880, 660, 440], type: 'sawtooth', step: 0.18, length: 0.14, peak: 0.28 });
}

/** Gentle two-pulse sine tone for phone tilt feedback. */
export function playTiltBeep() {
  playTones({ freqs: [300, 240], type: 'sine', step: 0.14, length: 0.095, peak: 0.18 });
}

/** Resume the AudioContext; call from a user gesture. */
export function unlockAudioContext() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// ---------------------------------------------------------------------------
// Speech queue
// ---------------------------------------------------------------------------
class SpeechQueueManager {
  constructor() {
    /** @type {Array<{text:string, weight:number, lang:string, rate:number, pitch:number, addedAt:number, onEnd:?Function}>} */
    this.queue = [];
    this.current = null; // { item, token } for the utterance being spoken
    this.voiceEnabled = true;
    this.voices = [];
    this._voiceCache = new Map(); // lang prefix -> SpeechSynthesisVoice | null
    this._unlocked = false;
    this._audioEl = null; // <audio> used for server TTS on iOS
    this._audioUnlocked = false;
    this._token = 0;
    this._watchdog = null;
    this._settleTimer = null;
    this._lastSpoken = new Map(); // text -> timestamp

    if (typeof window !== 'undefined') this._init();
  }

  get isSpeaking() {
    return this.current !== null;
  }

  _init() {
    if (hasSpeech()) {
      this._loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
      // Stop talking when the page goes away so the engine is not left in a stuck state
      window.addEventListener('pagehide', () => this.cancel());
    }

    // iOS Safari ignores touchstart for speechSynthesis; touchend/click count as activation.
    const events = ['touchend', 'click', 'keydown'];
    const unlockOnce = () => {
      this.unlock();
      unlockAudioContext();
      if (this._unlocked) {
        events.forEach((evt) => window.removeEventListener(evt, unlockOnce, { capture: true }));
      }
    };
    events.forEach((evt) =>
      window.addEventListener(evt, unlockOnce, { capture: true, passive: true })
    );
  }

  _loadVoices() {
    if (!hasSpeech()) return;
    try {
      this.voices = window.speechSynthesis.getVoices() || [];
    } catch {
      this.voices = [];
    }
    this._voiceCache.clear();
  }

  /** Best voice for a language: exact match first, then same language, preferring on-device voices. */
  getVoice(lang = DEFAULT_LANG) {
    const key = lang.toLowerCase();
    if (this._voiceCache.has(key)) return this._voiceCache.get(key);
    if (!this.voices.length) this._loadVoices();

    const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
    const base = key.split('-')[0];
    const pick = (list) => list.find((v) => v.localService) || list[0] || null;
    const exact = this.voices.filter((v) => norm(v) === key);
    const sameLang = this.voices.filter((v) => norm(v).split('-')[0] === base);
    const voice = pick(exact) || pick(sameLang);

    // Only cache hits, since voices may still be loading
    if (voice) this._voiceCache.set(key, voice);
    return voice;
  }

  getRomanianVoice() {
    return this.getVoice(DEFAULT_LANG);
  }

  _getAudioElement() {
    if (!this._audioEl && typeof Audio !== 'undefined') {
      this._audioEl = new Audio();
      this._audioEl.preload = 'auto';
      this._audioEl.playsInline = true;
    }
    return this._audioEl;
  }

  /**
   * Open the audio channels (HTMLAudio + speechSynthesis). Must run inside a user gesture.
   * @param {boolean} [force=false] redo the unlock even if it already succeeded
   */
  unlock(force = false) {
    if (typeof window === 'undefined') return;

    if (!this._audioUnlocked || force) {
      try {
        const audio = this._getAudioElement();
        if (audio && audio.paused) {
          audio.src = SILENT_WAV;
          const played = audio.play();
          if (played && typeof played.then === 'function') {
            played.then(() => (this._audioUnlocked = true)).catch(() => {});
          } else {
            this._audioUnlocked = true;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if ((this._unlocked && !force) || !hasSpeech()) return;
    try {
      window.speechSynthesis.resume();
      if (!window.speechSynthesis.speaking) {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        silent.lang = DEFAULT_LANG;
        window.speechSynthesis.speak(silent);
      }
      this._unlocked = true;
    } catch {
      /* ignore */
    }
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) this.cancel();
  }

  getVoiceEnabled() {
    return this.voiceEnabled;
  }

  /**
   * @param {string} text
   * @param {object} [options]
   * @param {'danger'|'urgent'|'high'|'normal'} [options.priority='normal']
   * @param {boolean} [options.interrupt=false] cancel everything and speak now
   * @param {number} [options.rate=1.1]
   * @param {number} [options.pitch=1]
   * @param {string} [options.lang='ro-RO']
   * @param {Function} [options.onEnd] called once when spoken, dropped or cancelled
   */
  speak(text, options = {}) {
    const {
      rate = 1.1,
      pitch = 1.0,
      lang = DEFAULT_LANG,
      interrupt = false,
      priority = 'normal',
      onEnd = null,
    } = options;

    const trimmed = text ? String(text).trim() : '';
    if (!this.voiceEnabled || !trimmed || !hasSpeech()) {
      onEnd?.();
      return;
    }

    const weight = PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal;
    const item = { text: trimmed, weight, lang, rate, pitch, onEnd, addedAt: Date.now() };

    if (interrupt) {
      this._cancelAll();
      this._enqueue(item);
      this._scheduleProcess();
      return;
    }

    // Skip repeats: same text queued, being spoken, or spoken very recently
    const now = item.addedAt;
    const recent = this._lastSpoken.get(trimmed);
    if (
      this.queue.some((q) => q.text === trimmed) ||
      this.current?.item.text === trimmed ||
      (recent !== undefined && now - recent < REPEAT_COOLDOWN_MS)
    ) {
      onEnd?.();
      return;
    }

    // Full queue: replace the lowest-priority item only if the new one outranks it
    if (this.queue.length >= MAX_QUEUE) {
      const lowest = this.queue[this.queue.length - 1];
      if (lowest.weight >= weight) {
        onEnd?.();
        return;
      }
      this.queue.pop();
      lowest.onEnd?.();
    }

    this._enqueue(item);

    if (!this.current) {
      this._processQueue();
    } else if (weight >= PRIORITY_WEIGHT.urgent && weight > this.current.item.weight) {
      // Urgent warning beats a lower-priority utterance that is mid-speech
      this._stopCurrent();
      this._scheduleProcess();
    }
  }

  /** Insert keeping the queue sorted by weight (desc), then arrival order. */
  _enqueue(item) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].weight < item.weight) i--;
    this.queue.splice(i, 0, item);
  }

  _scheduleProcess() {
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      this._processQueue();
    }, CANCEL_SETTLE_MS);
  }

  _processQueue() {
    if (this.current || this._settleTimer) return;

    // Drop expired items
    const cutoff = Date.now() - TTL_MS;
    const expired = this.queue.filter((q) => q.addedAt < cutoff);
    if (expired.length) {
      this.queue = this.queue.filter((q) => q.addedAt >= cutoff);
      expired.forEach((q) => q.onEnd?.());
    }

    const item = this.queue.shift();
    if (!item) return;

    const synth = window.speechSynthesis;
    const token = ++this._token;
    this.current = { item, token };
    this._lastSpoken.set(item.text, Date.now());
    if (this._lastSpoken.size > 40) this._lastSpoken.delete(this._lastSpoken.keys().next().value);

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.lang;
    utterance.rate = IS_IOS ? Math.min(item.rate, 1.05) : item.rate;
    utterance.pitch = item.pitch;
    const voice = this.getVoice(item.lang);
    // On iOS, remote voices can fail silently; let the system pick unless the voice is local
    if (voice && (!IS_IOS || voice.localService !== false)) utterance.voice = voice;

    // Ignore callbacks from utterances that were cancelled or replaced
    let started = false;
    let nudgeTimer = null;
    const finish = () => {
      if (!this.current || this.current.token !== token) return;
      clearTimeout(nudgeTimer);
      clearTimeout(this._watchdog);
      this._watchdog = null;
      this.current = null;
      try {
        item.onEnd?.();
      } catch {
        /* caller errors must not stall the queue */
      }
      this._processQueue();
    };

    // If onend never fires, stop the engine so it cannot talk over the next item
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      this._silence();
      finish();
    }, Math.max(4500, item.text.length * 130));

    // iOS may suspend speechSynthesis without setting paused; nudge if nothing started
    nudgeTimer = setTimeout(() => {
      if (!started) {
        try {
          synth.resume();
        } catch {
          /* ignore */
        }
      }
    }, 750);

    const speakViaWebSpeech = () => {
      utterance.onstart = () => {
        started = true;
      };
      utterance.onend = finish;
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[SpeechQueue] error:', e.error, item.text.slice(0, 40));
        }
        finish();
      };
      try {
        synth.resume();
        synth.speak(utterance);
      } catch (err) {
        console.warn('[SpeechQueue] speak() threw:', err);
        finish();
      }
    };

    const audio = IS_IOS ? this._getAudioElement() : null;
    if (!audio) {
      speakViaWebSpeech();
      return;
    }

    // iOS: server-backed TTS through the unlocked <audio> element, speechSynthesis as fallback
    let fellBack = false;
    const fallback = () => {
      if (fellBack || this.current?.token !== token) return;
      fellBack = true;
      audio.onended = null;
      audio.onerror = null;
      speakViaWebSpeech();
    };
    const langCode = (item.lang || 'ro').slice(0, 2).toLowerCase();
    audio.onended = () => {
      started = true;
      finish();
    };
    audio.onerror = fallback;
    audio.onplaying = () => {
      started = true;
    };
    audio.src = `/api/v1/tts?lang=${encodeURIComponent(langCode)}&text=${encodeURIComponent(item.text)}`;
    audio.playbackRate = Math.min(item.rate, 1.15);
    try {
      audio.play()?.catch(fallback);
    } catch {
      fallback();
    }
  }

  /** Halt any audio output (speechSynthesis and the iOS <audio> element). */
  _silence() {
    if (this._audioEl) {
      try {
        this._audioEl.onended = null;
        this._audioEl.onerror = null;
        this._audioEl.onplaying = null;
        this._audioEl.pause();
      } catch {
        /* ignore */
      }
    }
    if (hasSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  /** Stop the utterance in progress without clearing the queue. */
  _stopCurrent() {
    const cur = this.current;
    if (!cur) return;
    clearTimeout(this._watchdog);
    this._watchdog = null;
    this.current = null; // invalidates the token, so its onend/onerror are ignored
    this._silence();
    cur.item.onEnd?.();
  }

  _cancelAll() {
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
    const dropped = this.queue;
    this.queue = [];
    this._stopCurrent();
    this._silence();
    dropped.forEach((q) => q.onEnd?.());
  }

  /** Drop queued messages below danger priority (e.g. once an obstacle has been passed). */
  clearPendingNonDanger() {
    const dropped = this.queue.filter((q) => q.weight < PRIORITY_WEIGHT.danger);
    this.queue = this.queue.filter((q) => q.weight >= PRIORITY_WEIGHT.danger);
    dropped.forEach((q) => q.onEnd?.());
  }

  cancel() {
    this._cancelAll();
  }
}

export const speechQueue = new SpeechQueueManager();
